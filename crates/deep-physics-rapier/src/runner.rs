//! physics.world@1 on Rapier 0.36.1 over JSON lines, one reply a line (tests/acceptance/2009/README.md and
//! tests/acceptance/2010/README.md: The surface under test), shared by the `deep-physics` binary and the wasm32 build
//! (issue #2012). `check` runs the document check with caps() and the build; `bake` runs a world from step 0, keyed,
//! and kept by key in a store; `restore` runs it on from a checkpoint; `play` reads a stored bake's outputs and never
//! steps; `runtime` names the build; `golden`, `golden_verify` and `golden_cross` record a golden, replay it and say
//! where it stands across machines; `pairs` is the check kind physics.pairs (#2011); `time` steps a world timing each
//! step natively, and `time_build`, `time_end` with the wasm32 exports `deep_physics_step` and `deep_physics_note` let a
//! page time the same steps on its own clock (scripts/physics-budget.mjs). A planted name runs one criterion's wrong
//! program.
use std::collections::BTreeMap;
use std::path::Path;

use crate::planted::Restore;
use crate::scene::Scene;
use crate::{fp, Rapier};
use base64::Engine;
use deep_canvas_physics::backend::{
    Backend, BodyState, Canonical, Checkpoint, Input, Query, ShapeRef, Targets, FIELDS,
};
use deep_canvas_physics::bake::{self, Build, Parts};
use deep_canvas_physics::caps::{Caps, RAPIER3D};
use deep_canvas_physics::check::{check, fix};
use deep_canvas_physics::doc::{Read, Refusal, World};
use deep_canvas_physics::golden;
use deep_canvas_physics::occurrence;
use deep_canvas_physics::pairs::{pairs, Brief};
use deep_canvas_physics::ring::{Kept, Ring};
use deep_canvas_physics::roles::{self, Row};
use deep_canvas_physics::track::{self, Entry};
use serde_json::{json, Map, Value};

#[cfg(not(target_arch = "wasm32"))]
mod live;
mod timeline;

/// The planted wrong programs, by name.
pub const PLANTED: [&str; 18] = [
    "caps_allow_restitution_threshold",
    "caps_allow_rolling_resistance",
    "caps_allow_tangent_speed",
    "caps_allow_dynamic_gear",
    "restore_ignores_version",
    "hash_rounds_1e6",
    "key_omits_frame_rate",
    "role_table_pickup_solid",
    "occurrences_in_engine_order",
    "query_bypasses_backend",
    "query_machines_any",
    "checkpoint_poses_only",
    "fork_on_scrub",
    "restore_keeps_replaced_occurrences",
    "late_entry_forks",
    "ring_drops_oldest",
    "restore_without_warm_start",
    "simulate_runs_all_steps",
];

/// The reply to a line that isn't a call.
pub const BAD_INPUT: &str = r#"{"ok":false,"code":"bad_input"}"#;

/// One runner: the caps, the build and the planted fault it answers with.
pub struct Run {
    caps: Caps,
    restore_any_version: bool,
    /// #2010 criterion 2's twin: every state hash reads each float rounded to 1e-6.
    round_hashes: bool,
    /// #2010 criterion 5's twin: the bake key leaves out the frame rate.
    key_without_rate: bool,
    /// The role table roles expand through; #2011 criterion 3's twin makes a pickup solid.
    table: &'static [Row],
    /// #1918 criterion 5's twin: the list keeps each step's rows as the backend reads them.
    engine_order: bool,
    /// #1919's twins: physics.query asks Rapier's spatial queries past `query()`, and reports
    /// `machines: any` whatever its golden's standing.
    bypass: bool,
    machines_any: bool,
    build: Build,
    /// #522's twins: what a restore leaves out; a ring that drops its oldest; a scrub that forks;
    /// a late entry's restore that keeps the replaced steps' occurrences, or that forks; a live
    /// frame that runs every step it needs.
    restore: Restore,
    ring_drops_oldest: bool,
    fork_on_scrub: bool,
    keeps_replaced: bool,
    late_forks: bool,
    all_steps: bool,
    /// The views this runner holds open, by session (#522).
    #[cfg(not(target_arch = "wasm32"))]
    views: std::cell::RefCell<BTreeMap<String, live::View>>,
}

/// A refusal as the check's issue (What holds a document to its rules), its IDs the entry its
/// path is under.
fn issue(r: &Refusal) -> Value {
    let parts: Vec<&str> = r.path.split('/').collect();
    let ids: Vec<&str> = match parts.as_slice() {
        [map, id, ..]
            if [
                "bodies",
                "joints",
                "shapes",
                "contact_materials",
                "forces",
                "outputs",
            ]
            .contains(map) =>
        {
            vec![*id]
        }
        _ => vec![],
    };
    json!({"check": "document.validate", "code": r.code, "severity": "error", "ids": ids, "path": r.path,
           "actual": r.actual, "t": Value::Null, "what": r.what, "fix": fix(r.code)})
}

fn state(b: &BodyState) -> Value {
    json!({"pos": b.pos, "rot": b.rot, "linear": b.linear, "angular": b.angular, "contact_impulse": b.contact_impulse})
}

fn checkpoint(c: &Checkpoint) -> Value {
    json!({"step": c.step, "deep_hash": golden::deep_hash(&c.state),
           "backend": {"name": c.backend, "version": c.version}, "features": c.features,
           "state": base64::engine::general_purpose::STANDARD.encode(&c.state)})
}

fn checkpoint_of(c: &Value) -> Option<Checkpoint> {
    Some(Checkpoint {
        backend: c.pointer("/backend/name")?.as_str()?.into(),
        version: c.pointer("/backend/version")?.as_str()?.into(),
        features: Vec::new(),
        step: c.get("step")?.as_u64()?,
        state: base64::engine::general_purpose::STANDARD
            .decode(c.get("state")?.as_str()?)
            .ok()?,
    })
}

/// A bake's ring as its reply names it: its spacing at the end, budget, bytes and peak bytes.
fn ring(t: &Trace) -> Value {
    json!({"every": t.ring.spacing, "budget": t.ring.budget, "bytes": t.ring.bytes(), "peak": t.peak})
}

/// A shape use as the surface names it: its body, its index among the body's shapes and its shape.
fn shape_use(w: &World, r: &ShapeRef) -> Value {
    let shape = w
        .bodies
        .get(&r.body)
        .and_then(|b| b.shapes.get(r.index))
        .map(|u| u.shape.as_str());
    json!({"body": r.body, "index": r.index, "shape": shape})
}

/// #2011's view of the occurrence list (`bake` with `occurrences: true`): each row's two shape
/// uses as `{body, index, shape}`, the lower first; a row of one subject names it as `a`.
fn shape_uses(rows: &[occurrence::Row], w: &World) -> Vec<Value> {
    let one = |body: &str, index: Option<u32>| {
        let r = ShapeRef {
            body: body.into(),
            index: index.unwrap_or(0) as usize,
        };
        shape_use(w, &r)
    };
    rows.iter()
        .map(|r| {
            let o = &r.raw;
            let kind = occurrence::KINDS[usize::from(o.kind)];
            match &o.b {
                Some(b) if o.a_use.is_some() => json!({"step": r.step, "kind": kind,
                    "a": one(&o.a, o.a_use), "b": one(b, o.b_use)}),
                _ => json!({"step": r.step, "kind": kind, "a": o.a, "b": o.b}),
            }
        })
        .collect()
}

/// The pair of shape uses that ran the most narrow-phase tests in the last step, and their count.
fn most_tested(w: &World, b: &Rapier) -> Value {
    b.narrow_phase_tests().first().map_or(
        Value::Null,
        |(a, c, n)| json!({"pair": [shape_use(w, a), shape_use(w, c)], "tests": n}),
    )
}

thread_local! {
    /// The world a page times step by step (`time_build`, `deep_physics_step`, `deep_physics_note`, `time_end`): the
    /// world, its backend and the most-tested pair after each step so far.
    static TIMED: std::cell::RefCell<Option<(World, Rapier, Vec<Value>)>> = const { std::cell::RefCell::new(None) };
}

/// One step of the world `time_build` built, nothing else, so the page's clock reads the step alone; false when there
/// is none or the step is refused.
pub fn timed_step() -> bool {
    TIMED.with(|t| {
        t.borrow_mut()
            .as_mut()
            .is_some_and(|(_, b, _)| b.step(&[], &Targets::default()).is_ok())
    })
}

/// Notes the most-tested pair of the step `timed_step` just ran, outside the timed step.
pub fn timed_note() {
    TIMED.with(|t| {
        if let Some((w, b, top)) = t.borrow_mut().as_mut() {
            top.push(most_tested(w, b));
        }
    });
}

/// The bodies `read` names (every body when absent), as `{ID: [state]}` to fill.
fn series(call: &Value, b: &Rapier) -> Option<Map<String, Value>> {
    let all: Vec<String> = b.read().bodies.into_iter().map(|s| s.id).collect();
    let ids: Vec<String> = match call.get("read") {
        None => all,
        Some(r) => r
            .as_array()?
            .iter()
            .map(|x| {
                x.as_str()
                    .filter(|id| all.iter().any(|a| a == id))
                    .map(String::from)
            })
            .collect::<Option<_>>()?,
    };
    Some(
        ids.into_iter()
            .map(|id| (id, Value::Array(Vec::new())))
            .collect(),
    )
}

/// The call's `frame_rate` (60/1 when absent) as `p/q` and its frame in flicks, or its refusal.
fn rate(call: &Value) -> Result<(String, i64), Value> {
    bake::frame_rate(call.get("frame_rate").unwrap_or(&json!("60/1"))).map_err(
        |what| json!({"ok": false, "code": "bad_rate", "path": "frame_rate", "what": what}),
    )
}

/// This machine: its OS, its CPU architecture as Rust names it, its CPU as the OS names it, and the
/// target triple this build is for (Golden: a golden "records the triple in its machine").
fn machine(target: &str) -> Value {
    let named = if cfg!(target_os = "macos") {
        std::process::Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        std::fs::read_to_string("/proc/cpuinfo").ok().and_then(|c| {
            c.lines()
                .find(|l| l.starts_with("model name"))
                .and_then(|l| l.split(':').nth(1))
                .map(|s| s.trim().to_string())
        })
    };
    let cpu = named
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| std::env::consts::ARCH.to_string());
    json!({"os": std::env::consts::OS, "arch": std::env::consts::ARCH, "cpu": cpu, "target": target})
}

/// A bake kept in `dir` under `key` (Bake: `store: evidence`), or none.
fn stored(dir: &str, key: &str) -> Option<Value> {
    let text = std::fs::read_to_string(Path::new(dir).join(format!("{key}.json"))).ok()?;
    serde_json::from_str(&text).ok()
}

/// Keeps `record` in `dir` under `key`, written whole before it is named.
fn keep(dir: &str, key: &str, record: &Value) -> Result<(), Value> {
    let dir = Path::new(dir);
    // The temporary name is taken once the folder exists: a build with no files (wasm32) has no process ID either.
    std::fs::create_dir_all(dir)
        .and_then(|()| {
            let tmp = dir.join(format!("{key}.json.{}.tmp", std::process::id()));
            std::fs::write(&tmp, record.to_string())?;
            std::fs::rename(&tmp, dir.join(format!("{key}.json")))
        })
        .map_err(|e| json!({"ok": false, "code": "store", "what": format!("the bake couldn't be kept in the store: {e}")}))
}

/// A world's input track, resolved against the inputs it declares: its entries in the order they
/// apply, and each step's as the backend's inputs (an entry stamped k applies at the start of the
/// step from the state after k steps).
#[derive(Clone, Debug, Default)]
struct Track {
    entries: Vec<Entry>,
    by_step: BTreeMap<u64, Vec<Input>>,
}

static NO_TRACK: Track = Track {
    entries: Vec::new(),
    by_step: BTreeMap::new(),
};

impl Track {
    fn of(entries: Vec<Entry>) -> Track {
        let mut by_step: BTreeMap<u64, Vec<Input>> = BTreeMap::new();
        for (step, list) in track::by_step(&entries) {
            let inputs = list.into_iter().map(|e| Input {
                kind: e.kind,
                target: e.target,
                data: Value::Object(e.data),
            });
            by_step.insert(step, inputs.collect());
        }
        let mut entries = entries;
        track::order(&mut entries);
        Track { entries, by_step }
    }

    /// The track as the bake key and a reply hold it: `[]` for none.
    fn json(&self) -> Value {
        Value::Array(self.entries.iter().map(Entry::json).collect())
    }

    /// The call's `track` (absent: none), resolved against `w`, or the reply refusing an entry.
    fn read(w: &World, call: &Value) -> Result<Track, Value> {
        let t = call.get("track").unwrap_or(&Value::Null);
        if t.is_null() {
            return Ok(Track::default());
        }
        track::read(w, t).map(Track::of).map_err(|r| refused(&[*r]))
    }
}

/// What one run steps and takes besides its hashes.
#[derive(Clone)]
struct Plan<'a> {
    steps: u64,
    /// The scene whose paths each step reads at its own time (#1918).
    scene: Option<&'a Scene>,
    /// `bodies` holds a state each `every` steps.
    every: u64,
    /// Golden runs assert the floating-point control register at each step's start.
    guard: bool,
    /// Sets flush-to-zero before this step starts (the guard's planted fault).
    ftz_at: Option<u64>,
    /// After this step, moves `(body, field, ulps)` before its hash and checkpoint are taken.
    shift: Option<(u64, String, usize, i64)>,
    /// The input track it applies (#522).
    track: &'a Track,
}

/// What a run took.
#[derive(Default)]
struct Trace {
    bodies: Map<String, Value>,
    step_hashes: Vec<String>,
    /// The checkpoint ring (#522), and the most bytes it held at any moment.
    ring: Ring,
    peak: u64,
    /// The canonical state at each checkpoint's step.
    at: BTreeMap<u64, Vec<Canonical>>,
    /// Each output's body's position after each step.
    positions: BTreeMap<String, Vec<[f32; 3]>>,
    /// The occurrence list, each step's rows sorted (#1918).
    occurrences: Vec<occurrence::Row>,
    /// The list as #2011's shape uses, for `bake` with `occurrences: true`.
    shaped: Vec<Value>,
}

/// What a run's world reads of its scene over `steps` steps, as its bake key holds it: `[]` when
/// it reads nothing (#1918).
fn reads(plan: &Plan, steps: u64) -> Value {
    plan.scene
        .filter(|s| !s.reads_nothing())
        .map_or_else(|| json!([]), |s| s.key_reads(steps))
}

/// The refusing reply to a world's or a scene's refusals.
fn refused(e: &[Refusal]) -> Value {
    json!({"ok": false, "issues": e.iter().map(issue).collect::<Vec<_>>()})
}

/// Why a run stopped.
enum Stop {
    Refused(Value),
    /// A step started with the control register set otherwise than results assume.
    Register(u64, String),
}

/// A ray, sweep or overlap probe as the backend interface's query, or the refusals of its shape
/// and poses.
fn spatial(kind: &str, p: &Value) -> Result<Query, Vec<Refusal>> {
    use deep_canvas_physics::doc::{probe_pose, probe_shape};
    let path = format!("probe/{kind}");
    let pose = |k: &str| probe_pose(&p[k], &format!("{path}/{k}"));
    let v3 = |k: &str| -> Option<[f64; 3]> {
        let a: Vec<f64> = p
            .get(k)?
            .as_array()?
            .iter()
            .map(Value::as_f64)
            .collect::<Option<_>>()?;
        <[f64; 3]>::try_from(a).ok()
    };
    let bad = |what: &str| {
        vec![Refusal {
            code: "out_of_range",
            path: path.clone(),
            actual: p.clone(),
            what: what.into(),
        }]
    };
    Ok(match kind {
        "ray" => Query::Ray {
            from: v3("from").ok_or_else(|| bad("a ray needs from: vec3"))?,
            dir: v3("dir")
                .filter(|d| d.iter().any(|x| *x != 0.0))
                .ok_or_else(|| bad("a ray needs a dir: vec3 other than 0"))?,
            max: p
                .get("max")
                .map_or(Some(100.0), Value::as_f64)
                .ok_or_else(|| bad("max is m"))?,
        },
        "sweep" => Query::Sweep {
            shape: probe_shape(&p["shape"], &format!("{path}/shape"))?,
            from: pose("from")?,
            to: pose("to")?,
        },
        "overlap" => Query::Overlap {
            shape: probe_shape(&p["shape"], &format!("{path}/shape"))?,
            at: pose("at")?,
        },
        _ => return Err(bad("a probe is output, occurrences, ray, sweep or overlap")),
    })
}

impl Run {
    /// The runner, or with `planted` one criterion's wrong program; `None` for a name it doesn't plant.
    pub fn new(planted: Option<&str>) -> Option<Self> {
        let mut run = Self {
            caps: RAPIER3D,
            restore_any_version: false,
            round_hashes: false,
            key_without_rate: false,
            table: &roles::TABLE,
            engine_order: false,
            bypass: false,
            machines_any: false,
            build: crate::build(),
            restore: Restore::Whole,
            ring_drops_oldest: false,
            fork_on_scrub: false,
            keeps_replaced: false,
            late_forks: false,
            all_steps: false,
            #[cfg(not(target_arch = "wasm32"))]
            views: std::cell::RefCell::default(),
        };
        match planted {
            None => {}
            Some("caps_allow_restitution_threshold") => run.caps.restitution_threshold = true,
            Some("caps_allow_rolling_resistance") => run.caps.rolling_resistance = true,
            Some("caps_allow_tangent_speed") => run.caps.tangent_speed = true,
            Some("caps_allow_dynamic_gear") => run.caps.dynamic_couplings = true,
            Some("hash_rounds_1e6") => run.round_hashes = true,
            Some("key_omits_frame_rate") => run.key_without_rate = true,
            Some("restore_ignores_version") => run.restore_any_version = true,
            Some("role_table_pickup_solid") => run.table = &roles::PLANTED_SOLID_PICKUP,
            Some("occurrences_in_engine_order") => run.engine_order = true,
            Some("query_bypasses_backend") => run.bypass = true,
            Some("query_machines_any") => run.machines_any = true,
            Some("checkpoint_poses_only") => run.restore = Restore::PosesOnly,
            Some("restore_without_warm_start") => run.restore = Restore::NoWarmStart,
            Some("fork_on_scrub") => run.fork_on_scrub = true,
            Some("restore_keeps_replaced_occurrences") => run.keeps_replaced = true,
            Some("late_entry_forks") => run.late_forks = true,
            Some("ring_drops_oldest") => run.ring_drops_oldest = true,
            Some("simulate_runs_all_steps") => run.all_steps = true,
            Some(_) => return None,
        }
        Some(run)
    }

    /// The reply line to one call line.
    pub fn line(&self, line: &str) -> String {
        serde_json::from_str::<Value>(line)
            .ok()
            .and_then(|v| self.answer(&v))
            .map_or_else(|| BAD_INPUT.to_string(), |r| r.to_string())
    }

    fn hash(&self, s: &[Canonical]) -> String {
        if !self.round_hashes {
            return golden::step_hash(s);
        }
        let rounded: Vec<Canonical> = s
            .iter()
            .map(|b| Canonical {
                id: b.id.clone(),
                values: b
                    .values
                    .map(|v| ((f64::from(v) * 1e6).round() / 1e6) as f32),
            })
            .collect();
        golden::step_hash(&rounded)
    }

    /// The bake key of `world` at `rate` over `steps`, with what it reads of its scene (`[]` when
    /// nothing) and its input track's entries as resolved (`[]` when none, #522); a golden's when
    /// `target` is `None`.
    fn key(
        &self,
        world: &Value,
        reads: &Value,
        track: &Value,
        rate: &str,
        steps: u64,
        target: Option<&str>,
    ) -> String {
        let parts = Parts {
            world,
            reads,
            track,
            frame_rate: if self.key_without_rate { "" } else { rate },
            steps,
        };
        bake::key(&parts, &self.build, target)
    }

    /// The world `v` holds, built, or the issues that refuse it.
    fn build(&self, v: &Value) -> Result<(World, Rapier), Value> {
        let refused = |e: Vec<Refusal>| refused(&e);
        let w = check(v, &self.caps, self.table).map_err(refused)?;
        let mut b = Rapier {
            restore_any_version: self.restore_any_version,
            reverse_pairs: cfg!(feature = "test-reverse-pairs"),
            ..Rapier::default()
        };
        b.build(&w).map_err(refused)?;
        Ok((w, b))
    }

    /// The world a call names (#1918): `world` a document, or with `scene` the ID of a world the
    /// scene lists, with the scene's reads of it; the reply refusing either; `None` for bad input.
    /// #1921: the world's bodies bound to the scene's items expanded first (bound.rs).
    fn subject(&self, call: &Value) -> Option<Result<(Value, Option<Scene>), Value>> {
        let world = call.get("world")?;
        let Some(scene) = call.get("scene") else {
            let doc = crate::bound::expand(None, world);
            return Some(doc.map(|d| (d, None)).map_err(|e| refused(&e)));
        };
        let id = world.as_str()?;
        let doc = scene.get("worlds")?.get(id)?;
        let read = crate::bound::expand(Some(scene), doc).and_then(|doc| {
            let w = check(&doc, &self.caps, self.table)?;
            Ok((doc, Some(Scene::read(scene, id, &w)?)))
        });
        Some(read.map_err(|e| refused(&e)))
    }

    /// The state after step `k` into `t`.
    fn take(&self, b: &Rapier, w: &World, plan: &Plan, t: &mut Trace, k: u64, start: u64) {
        let c = b.canonical();
        t.step_hashes.push(self.hash(&c));
        for (id, o) in w.outputs.iter().filter(|(_, o)| o.read == Read::Position) {
            if let Some(body) = c.iter().find(|x| x.id == o.from) {
                let p = [body.values[0], body.values[1], body.values[2]];
                t.positions.entry(id.clone()).or_default().push(p);
            }
        }
        if (k - start).is_multiple_of(plan.every) {
            for s in b.read().bodies {
                if let Some(Value::Array(v)) = t.bodies.get_mut(&s.id) {
                    v.push(state(&s));
                }
            }
        }
        if k > start && t.ring.due(k) {
            let cp = b.checkpoint();
            let kept = Kept {
                deep_hash: golden::deep_hash(&cp.state),
                step_hash: t.step_hashes.last().cloned().unwrap_or_default(),
                checkpoint: cp,
            };
            t.ring.offer(kept);
            t.peak = t.peak.max(t.ring.bytes());
        }
        if k > start && k.is_multiple_of(w.checkpoint_every) {
            t.at.insert(k, c);
        }
    }

    /// Steps `b` `plan.steps` times from where it stands.
    fn run(&self, b: &mut Rapier, w: &World, plan: &Plan, t: &mut Trace) -> Result<(), Stop> {
        let start = b.read().step;
        let rank = occurrence::ranks(w);
        if t.ring.spacing == 0 {
            t.ring = Ring::new(w.checkpoint_every, w.checkpoint_budget);
            t.ring.drops_oldest = self.ring_drops_oldest;
        }
        self.take(b, w, plan, t, start, start);
        for k in start + 1..=start + plan.steps {
            if plan.ftz_at == Some(k) {
                fp::flush_to_zero(true);
            }
            if plan.guard {
                if let Some(what) = fp::check() {
                    fp::reset();
                    return Err(Stop::Register(k, what));
                }
            }
            let targets = plan.scene.map_or_else(Targets::default, |s| s.targets(k));
            let inputs = plan
                .track
                .by_step
                .get(&(k - 1))
                .map_or(&[][..], Vec::as_slice);
            b.step(inputs, &targets)
                .map_err(|r| Stop::Refused(json!({"ok": false, "issues": [issue(&r)]})))?;
            if self.engine_order {
                t.occurrences
                    .extend(b.occurrences().into_iter().map(|raw| occurrence::Row {
                        step: k as u32,
                        raw,
                    }));
            } else {
                t.occurrences
                    .extend(occurrence::sorted(k as u32, b.occurrences(), &rank));
            }
            if let Some((s, id, field, ulps)) = &plan.shift {
                if *s == k {
                    b.shift(id, *field, *ulps);
                }
            }
            self.take(b, w, plan, t, k, start);
        }
        Ok(())
    }

    /// A bake of `world` from step 0, kept in `store` under its key, with its record.
    fn bake(
        &self,
        call: &Value,
        world: &Value,
        plan: &Plan,
    ) -> Result<(String, Trace, Value), Value> {
        let (rate, frame) = rate(call)?;
        let (w, mut b) = self.build(world)?;
        let mut t = Trace {
            bodies: series(call, &b).ok_or_else(|| json!({"ok": false, "code": "bad_input"}))?,
            ..Trace::default()
        };
        self.run(&mut b, &w, plan, &mut t).map_err(|s| match s {
            Stop::Refused(v) => v,
            Stop::Register(step, what) => json!({"ok": false, "code": "physics.fp_control", "step": step, "register": fp::REGISTER, "what": what}),
        })?;
        let (key, record) = self.record(world, &w, plan, (&rate, frame), &mut t);
        if let Some(dir) = call.get("store") {
            keep(
                dir.as_str()
                    .ok_or_else(|| json!({"ok": false, "code": "bad_input"}))?,
                &key,
                &record,
            )?;
        }
        Ok((key, t, record))
    }

    /// A bake's key and the record a store keeps of it, from the run `t` of `plan.steps` steps:
    /// its step hashes, its ring and the checkpoints it keeps, its outputs, positions and
    /// occurrence list, and the track it applied.
    fn record(
        &self,
        world: &Value,
        w: &World,
        plan: &Plan,
        (rate, frame): (&str, i64),
        t: &mut Trace,
    ) -> (String, Value) {
        let steps = plan.steps;
        let track = plan.track.json();
        let key = self.key(
            world,
            &reads(plan, steps),
            &track,
            rate,
            steps,
            Some(&self.build.target),
        );
        let outputs = bake::outputs(&t.positions, rate, frame, w.step_rate, steps);
        let rank = occurrence::ranks(w);
        t.shaped = shape_uses(&t.occurrences, w);
        let record = json!({"key": key, "step_hashes": t.step_hashes, "ring": ring(t),
                            "checkpoints": t.ring.kept.iter().map(|k| checkpoint(&k.checkpoint)).collect::<Vec<_>>(),
                            "outputs": outputs, "positions": t.positions, "track": track,
                            "occurrences": occurrence::listed(&t.occurrences),
                            "occurrences_hash": occurrence::hash(&t.occurrences, &rank)});
        (key, record)
    }

    /// The reply to one call, or `None` for a call it doesn't take.
    pub fn answer(&self, call: &Value) -> Option<Value> {
        let steps = || call.get("steps").and_then(Value::as_u64);
        let done = |r: Result<Value, Value>| Some(r.unwrap_or_else(|e| e));
        match call.get("call")?.as_str()? {
            "check" => Some(
                match self
                    .subject(call)?
                    .and_then(|(world, _)| self.build(&world))
                    .and_then(|(w, b)| Track::read(&w, call).map(|_| b))
                {
                    Ok(b) => json!({"ok": true, "issues": [], "built": b.built()}),
                    Err(e) => json!({"ok": true, "issues": e["issues"]}),
                },
            ),
            "runtime" => {
                let b = &self.build;
                Some(json!({"ok": true, "runtime_digest": b.runtime_digest(),
                    "backend": {"name": b.backend.name, "version": b.backend.version, "features": b.backend.features},
                    "pins": b.pins.iter().map(|p| p.json()).collect::<Vec<_>>()}))
            }
            "bake" => {
                let (world, scene) = match self.subject(call)? {
                    Ok(x) => x,
                    Err(e) => return Some(e),
                };
                let track = match self.build(&world).and_then(|(w, _)| Track::read(&w, call)) {
                    Ok(t) => t,
                    Err(e) => return Some(e),
                };
                let plan = Plan {
                    steps: steps()?,
                    scene: scene.as_ref(),
                    every: call.get("every").map_or(Some(1), Value::as_u64)?.max(1),
                    guard: false,
                    ftz_at: None,
                    shift: None,
                    track: &track,
                };
                let with_checkpoints = call
                    .get("checkpoints")
                    .map_or(Some(false), Value::as_bool)?;
                let dir = call.get("store").map(Value::as_str);
                if let Some(None) = dir {
                    return None;
                }
                if let Some(Some(dir)) = dir {
                    let (rate, _) = match rate(call) {
                        Ok(r) => r,
                        Err(e) => return Some(e),
                    };
                    let key = self.key(
                        &world,
                        &reads(&plan, plan.steps),
                        &track.json(),
                        &rate,
                        plan.steps,
                        Some(&self.build.target),
                    );
                    if let Some(r) = stored(dir, &key) {
                        return Some(
                            json!({"ok": true, "key": key, "step_hashes": r["step_hashes"],
                                   "outputs": r["outputs"], "occurrences": r["occurrences"],
                                   "occurrences_hash": r["occurrences_hash"], "ring": r["ring"], "reused": true}),
                        );
                    }
                }
                done(self.bake(call, &world, &plan).map(|(key, t, record)| {
                    let mut reply = json!({"ok": true, "key": key, "bodies": t.bodies,
                                           "step_hashes": t.step_hashes, "outputs": record["outputs"],
                                           "occurrences": record["occurrences"],
                                           "occurrences_hash": record["occurrences_hash"], "ring": record["ring"]});
                    if with_checkpoints {
                        reply["checkpoints"] = record["checkpoints"].clone();
                    }
                    if call.get("occurrences") == Some(&json!(true)) {
                        reply["occurrences"] = Value::Array(t.shaped);
                    }
                    if dir.is_some() {
                        reply["reused"] = json!(false);
                    }
                    reply
                }))
            }
            "restore" => {
                let (world, scene) = match self.subject(call)? {
                    Ok(x) => x,
                    Err(e) => return Some(e),
                };
                let cp = checkpoint_of(call.get("checkpoint")?)?;
                let with_checkpoints = call
                    .get("checkpoints")
                    .map_or(Some(false), Value::as_bool)?;
                let (w, mut b) = match self.build(&world) {
                    Ok(x) => x,
                    Err(e) => return Some(e),
                };
                let track = match Track::read(&w, call) {
                    Ok(t) => t,
                    Err(e) => return Some(e),
                };
                let plan = Plan {
                    steps: steps()?,
                    scene: scene.as_ref(),
                    every: 1,
                    guard: false,
                    ftz_at: None,
                    shift: None,
                    track: &track,
                };
                let built = b.checkpoint();
                if let Err(r) = b.restore(&cp) {
                    return Some(
                        json!({"ok": false, "code": r.code, "path": r.path, "actual": r.actual, "what": r.what}),
                    );
                }
                b.plant(self.restore, &built);
                let mut t = Trace {
                    bodies: series(call, &b)?,
                    ..Trace::default()
                };
                if let Err(Stop::Refused(v)) = self.run(&mut b, &w, &plan, &mut t) {
                    return Some(v);
                }
                let rank = occurrence::ranks(&w);
                let mut reply = json!({"ok": true, "bodies": t.bodies, "step_hashes": t.step_hashes,
                                       "occurrences": occurrence::listed(&t.occurrences),
                                       "occurrences_hash": occurrence::hash(&t.occurrences, &rank)});
                if with_checkpoints {
                    let kept = t.ring.kept.iter().map(|k| checkpoint(&k.checkpoint));
                    reply["checkpoints"] = Value::Array(kept.collect());
                }
                Some(reply)
            }
            "play" => {
                let world = call.get("world")?;
                let (steps, dir) = (steps()?, call.get("store")?.as_str()?);
                let (rate, _) = match rate(call) {
                    Ok(r) => r,
                    Err(e) => return Some(e),
                };
                if let Err(e) = self.build(world) {
                    return Some(e);
                }
                let key = self.key(
                    world,
                    &json!([]),
                    &json!([]),
                    &rate,
                    steps,
                    Some(&self.build.target),
                );
                Some(match stored(dir, &key) {
                    Some(r) => {
                        json!({"ok": true, "key": key, "outputs": r["outputs"], "occurrences": r["occurrences"]})
                    }
                    None => {
                        json!({"ok": false, "code": "no_bake", "key": key,
                               "what": "the store holds no bake under this key; playback never steps the world"})
                    }
                })
            }
            "golden" => {
                let world = call.get("world")?;
                call.get("store")?.as_str()?;
                let verify_on: Vec<&str> = call
                    .get("verify_on")?
                    .as_array()?
                    .iter()
                    .map(Value::as_str)
                    .collect::<Option<_>>()?;
                let track = match self.build(world).and_then(|(w, _)| Track::read(&w, call)) {
                    Ok(t) => t,
                    Err(e) => return Some(e),
                };
                let plan = Plan {
                    steps: steps()?,
                    scene: None,
                    every: 1,
                    guard: true,
                    ftz_at: None,
                    shift: None,
                    track: &track,
                };
                let (rate, _) = match rate(call) {
                    Ok(r) => r,
                    Err(e) => return Some(e),
                };
                done(self.bake(call, world, &plan).map(|(_, t, record)| {
                    let hashes: Vec<Value> = record["checkpoints"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|c| json!({"step": c["step"], "deep_hash": c["deep_hash"]}))
                        .collect();
                    json!({"ok": true, "golden": {
                        "bake_key": self.key(world, &json!([]), &track.json(), &rate, plan.steps, None),
                        "runtime_digest": self.build.runtime_digest(), "machine": machine(&self.build.target),
                        "step_hashes": t.step_hashes, "checkpoint_hashes": hashes,
                        "occurrences_hash": record["occurrences_hash"],
                        "record_on": self.build.target, "verify_on": verify_on}})
                }))
            }
            "golden_verify" => self.verify(call),
            "seek" => self.seek(call),
            "determinism" => self.determinism(call),
            #[cfg(not(target_arch = "wasm32"))]
            "view" => self.view(call),
            #[cfg(not(target_arch = "wasm32"))]
            "frame" => self.frame(call),
            #[cfg(not(target_arch = "wasm32"))]
            "record" => self.recorded(call),
            "query" => self.query(call),
            #[cfg(feature = "test-count-calls")]
            "backend_calls" => {
                let mut calls = Map::new();
                for (method, n) in crate::CALLS.lock().ok()?.iter() {
                    match method.split_once('.') {
                        Some((m, kind)) => {
                            calls.entry(m).or_insert_with(|| json!({}))[kind] = json!(n)
                        }
                        None => drop(calls.insert(method.to_string(), json!(n))),
                    }
                }
                Some(json!({"ok": true, "calls": calls}))
            }
            "pairs" => {
                Some(self.pairs(call.get("world")?, call.get("brief").unwrap_or(&json!({})))?)
            }
            "time" => {
                let built = self
                    .subject(call)?
                    .and_then(|(world, _)| self.build(&world));
                let (w, mut b) = match built {
                    Ok(x) => x,
                    Err(e) => return Some(e),
                };
                let mut ms = Vec::new();
                let mut top = Vec::new();
                for _ in 0..steps()? {
                    let at = std::time::Instant::now();
                    let stepped = b.step(&[], &Targets::default());
                    ms.push(at.elapsed().as_secs_f64() * 1e3);
                    if let Err(r) = stepped {
                        return Some(json!({"ok": false, "issues": [issue(&r)]}));
                    }
                    top.push(most_tested(&w, &b));
                }
                Some(json!({"ok": true, "target": self.build.target, "ms": ms, "top": top}))
            }
            "time_build" => {
                let built = self
                    .subject(call)?
                    .and_then(|(world, _)| self.build(&world));
                Some(TIMED.with(|t| match built {
                    Ok(x) => {
                        *t.borrow_mut() = Some((x.0, x.1, Vec::new()));
                        json!({"ok": true, "target": self.build.target})
                    }
                    Err(e) => e,
                }))
            }
            "time_end" => TIMED.with(|t| {
                let (_, _, top) = t.borrow_mut().take()?;
                Some(json!({"ok": true, "top": top}))
            }),
            "golden_cross" => golden::cross(
                call.get("golden")?,
                call.get("machines")?.as_array()?,
                call.get("runs")?.as_array()?,
            ),
            _ => None,
        }
    }

    /// Replays a golden's world on this machine (Golden): each step's start asserts the control
    /// register; then the first step whose hash differs, and the first body and field that differ
    /// at the recording bake's first checkpoint at or after it.
    /// physics.pairs over `world` against `brief` (`{touch?, never?}`), with the document check's refusals.
    fn pairs(&self, world: &Value, brief: &Value) -> Option<Value> {
        let locks = |k: &str| -> Option<Vec<[String; 2]>> {
            brief.get(k).map_or(Some(Vec::new()), |v| {
                v.as_array()?
                    .iter()
                    .map(|p| match p.as_array()?.as_slice() {
                        [a, b] => Some([a.as_str()?.to_string(), b.as_str()?.to_string()]),
                        _ => None,
                    })
                    .collect()
            })
        };
        let brief = Brief {
            touch: locks("touch")?,
            never: locks("never")?,
        };
        let refused = |e: Vec<Refusal>| json!({"ok": false, "issues": e.iter().map(issue).collect::<Vec<_>>()});
        let expanded = match roles::expand(world, self.table) {
            Ok(x) => x,
            Err(e) => return Some(refused(e)),
        };
        Some(match self.build(world) {
            Ok((w, _)) => pairs(&w, &expanded.assumptions, &brief),
            Err(e) => e,
        })
    }

    /// physics.query (#1919; Check input: `physics.query`): `probe` over the bake of `world` kept
    /// in `store`, never stepping past it, judged against `expect` within `tolerance`, with
    /// `machines` from where the bake's `golden` stands given the `runs` made of it. A missing
    /// bake is BLOCKED; an occurrence that never comes fails, naming the list and the filter.
    fn query(&self, call: &Value) -> Option<Value> {
        let (world, steps) = (call.get("world")?, call.get("steps")?.as_u64()?);
        let (dir, probe, want) = (
            call.get("store")?.as_str()?,
            call.get("probe")?,
            call.get("expect")?,
        );
        let tolerance = call.get("tolerance").map_or(Some(0.0), Value::as_f64)?;
        let (rate, _) = match rate(call) {
            Ok(r) => r,
            Err(e) => return Some(e),
        };
        let (w, mut b) = match self.build(world) {
            Ok(x) => x,
            Err(e) => return Some(e),
        };
        let key = self.key(
            world,
            &json!([]),
            &json!([]),
            &rate,
            steps,
            Some(&self.build.target),
        );
        let Some(bake) = stored(dir, &key) else {
            let what = format!("the store holds no bake under {key}: physics.query reads a bake and never steps or bakes the world");
            return Some(
                json!({"ok": true, "verdict": "BLOCKED", "result": null, "key": key, "what": what}),
            );
        };
        let refuse = |path: &str, what: String| {
            Some(json!({"ok": false, "code": "bad_probe", "path": path, "what": what}))
        };
        let rows = bake["occurrences"].as_array().cloned().unwrap_or_default();
        let h = occurrence::step_flicks(&w);
        // The step an occurrence anchor `{list, filter, nth}` names, or the failure naming them.
        let anchor = |a: &Value| -> Result<u64, String> {
            let kept = deep_canvas_physics::query::kept(&rows, &a["filter"]);
            let row = deep_canvas_physics::query::nth(&kept, a.get("nth"));
            row.and_then(|r| r["step"].as_u64()).ok_or_else(|| {
                format!(
                    "no occurrence of {} matching {} ({}) comes within the bake's {steps} steps",
                    a["list"],
                    a["filter"],
                    a.get("nth").unwrap_or(&json!("first"))
                )
            })
        };
        let at_time = |v: &Value| v.as_u64().map(|t| t / h as u64);
        let (kind, p) = probe.as_object()?.iter().next()?;
        let reading = match kind.as_str() {
            "output" => {
                let path = p["path"].as_str()?;
                let (id, i) = path.strip_prefix("outputs/")?.split_once('/')?;
                let (series, i) = (
                    &bake["positions"][id],
                    i.parse::<usize>().ok().filter(|i| *i < 3)?,
                );
                if !series.is_array() {
                    return refuse(
                        "probe/output/path",
                        format!("{path} reads no position output of this world"),
                    );
                }
                let x = |k: u64| series[k as usize][i].as_f64().map(|v| f64::from(v as f32));
                let (step, value) = match &p["at"] {
                    a if a.is_object() => match anchor(a) {
                        Ok(k) => (k, x(k)),
                        Err(what) => {
                            return Some(
                                json!({"ok": true, "verdict": "FAIL", "key": key, "result": null, "what": what}),
                            )
                        }
                    },
                    // At a time, the two steps around it mixed (Physics output).
                    t => {
                        let k = at_time(t)?;
                        let alpha = (t.as_u64()? % h as u64) as f32 / h as f32;
                        let next = x(k + 1).filter(|_| k < steps);
                        let mix =
                            |a: f64, b: f64| f64::from(a as f32 + alpha * (b as f32 - a as f32));
                        (k, x(k).map(|a| next.map_or(a, |b| mix(a, b))))
                    }
                };
                deep_canvas_physics::query::Reading {
                    value,
                    step,
                    ids: Vec::new(),
                }
            }
            "occurrences" => {
                let kept = deep_canvas_physics::query::kept(&rows, &p["filter"]);
                deep_canvas_physics::query::measure(&kept, p.get("measure"), h)?
            }
            _ => {
                let step = match call.get("state") {
                    None => 0,
                    Some(s) if s.get("occurrence").is_some() => match anchor(&s["occurrence"]) {
                        Ok(k) => k,
                        Err(what) => {
                            return Some(
                                json!({"ok": true, "verdict": "FAIL", "key": key, "result": null, "what": what}),
                            )
                        }
                    },
                    Some(s) => s
                        .get("step")
                        .and_then(Value::as_u64)
                        .or_else(|| at_time(s.get("t")?))?,
                };
                if step > steps {
                    return refuse("state", format!("step {step} is past the bake's {steps} steps, which physics.query never steps past"));
                }
                let q = match spatial(kind, p) {
                    Ok(q) => q,
                    Err(e) => return Some(refused(&e)),
                };
                let mut groups = 0u32;
                for g in p
                    .get("groups")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    match w.groups.iter().position(|n| g == n) {
                        Some(bit) => groups |= 1 << bit,
                        None => {
                            return refuse(
                                "probe/groups",
                                format!("{g} is not one of the world's collision_groups"),
                            )
                        }
                    }
                }
                if p.get("groups").is_none() {
                    groups = u32::MAX;
                }
                // The state at `step`: the nearest checkpoint at or before it restored, then stepped to it.
                let cp = bake["checkpoints"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .rev()
                    .find(|c| c["step"].as_u64().is_some_and(|c| c <= step))
                    .and_then(checkpoint_of);
                if let Some(cp) = cp {
                    b.restore(&cp).ok()?;
                }
                let rest = step - b.read().step;
                let plan = Plan {
                    steps: rest,
                    scene: None,
                    every: rest.max(1),
                    guard: false,
                    ftz_at: None,
                    shift: None,
                    track: &NO_TRACK,
                };
                if let Err(Stop::Refused(v)) = self.run(&mut b, &w, &plan, &mut Trace::default()) {
                    return Some(v);
                }
                let hits = if self.bypass {
                    b.hits(&q, groups)
                } else {
                    b.query(&q, groups)
                };
                let mut ids: Vec<String> = Vec::new();
                for hit in &hits {
                    if !ids.contains(&hit.shape.body) {
                        ids.push(hit.shape.body.clone());
                    }
                }
                // A ray's or a sweep's value is its nearest hit's distance, an overlap's its count.
                let value = if kind == "overlap" {
                    Some(ids.len() as f64)
                } else {
                    hits.first().map(|x| x.distance)
                };
                deep_canvas_physics::query::Reading { value, step, ids }
            }
        };
        let machines = if self.machines_any {
            "any"
        } else {
            let runs = call
                .get("runs")
                .and_then(Value::as_array)
                .map_or(&[][..], Vec::as_slice);
            deep_canvas_physics::query::machines(call.get("golden"), runs)
        };
        let Some(met) = deep_canvas_physics::query::meets(&reading, want, tolerance) else {
            return refuse(
                "expect",
                format!("expect {want} names no value, range, ids or order"),
            );
        };
        let t = reading.step as i64 * h;
        let result = json!({"value": reading.value, "step": reading.step, "t": t, "ids": reading.ids, "machines": machines});
        let what = format!(
            "{kind} read {} at step {} (t = {t} flicks){}; expected {want} within {tolerance}",
            reading.value.map_or("nothing".into(), |v| v.to_string()),
            reading.step,
            if reading.ids.is_empty() {
                String::new()
            } else {
                format!(", ids {:?}", reading.ids)
            },
        );
        Some(
            json!({"ok": true, "verdict": if met { "PASS" } else { "FAIL" }, "key": key, "result": result, "what": what}),
        )
    }

    fn verify(&self, call: &Value) -> Option<Value> {
        let (g, world) = (call.get("golden")?, call.get("world")?);
        let shift = match call.get("shift") {
            None => None,
            Some(s) => Some((
                s.get("step")?.as_u64()?,
                s.get("id")?.as_str()?.to_string(),
                FIELDS
                    .iter()
                    .position(|f| Some(*f) == s.get("field").and_then(Value::as_str))?,
                s.get("ulps").map_or(Some(1), Value::as_i64)?,
            )),
        };
        let plan = Plan {
            steps: call.get("steps")?.as_u64()?,
            scene: None,
            every: 1,
            guard: true,
            ftz_at: call
                .get("ftz_at")
                .map(Value::as_u64)
                .map_or(Some(None), |s| s.map(Some))?,
            shift,
            track: &NO_TRACK,
        };
        let dir = call
            .get("store")
            .map(Value::as_str)
            .map_or(Some(None), |s| s.map(Some))?;
        let (rate, _) = match rate(call) {
            Ok(r) => r,
            Err(e) => return Some(e),
        };
        let (w, mut b) = match self.build(world) {
            Ok(x) => x,
            Err(e) => return Some(e),
        };
        let key = self.key(world, &json!([]), &json!([]), &rate, plan.steps, None);
        let digest = self.build.runtime_digest();
        let here = machine(&self.build.target);
        let machines = golden::machines(g, &here);
        let mut reply = json!({"ok": true, "verdict": "FAIL", "bake_key": key, "runtime_digest": digest,
                               "machine": here, "target": self.build.target, "machines": machines,
                               "report": null, "failure": null});
        if g["bake_key"] != json!(key) || g["runtime_digest"] != json!(digest) {
            reply["refused"] = json!(format!(
                "a golden is never compared under another key or runtime digest: it holds {} and {}, this run {key} and {digest}",
                g["bake_key"], g["runtime_digest"]
            ));
            return Some(reply);
        }
        let mut t = Trace::default();
        let ran = self.run(&mut b, &w, &plan, &mut t);
        // This replay's own step hashes, so a second machine's run is compared step for step.
        reply["step_hashes"] = json!(t.step_hashes);
        match ran {
            Err(Stop::Refused(v)) => return Some(v),
            Err(Stop::Register(step, what)) => {
                reply["failure"] = json!({"step": step, "register": fp::REGISTER, "what": what});
                return Some(reply);
            }
            Ok(()) => {}
        }
        let recorded: Vec<&str> = g["step_hashes"]
            .as_array()?
            .iter()
            .map(Value::as_str)
            .collect::<Option<_>>()?;
        let n = recorded.len().max(t.step_hashes.len());
        let Some(k) =
            (0..n).find(|&i| recorded.get(i).copied() != t.step_hashes.get(i).map(String::as_str))
        else {
            reply["verdict"] = json!("PASS");
            return Some(reply);
        };
        let every = w.checkpoint_every;
        let c = (k as u64).max(1).div_ceil(every) * every;
        let checkpoint = (c <= plan.steps).then_some(c);
        let field = checkpoint.zip(dir).and_then(|(c, dir)| {
            let target = g["record_on"].as_str()?;
            let bake = stored(
                dir,
                &self.key(
                    world,
                    &json!([]),
                    &json!([]),
                    &rate,
                    plan.steps,
                    Some(target),
                ),
            )?;
            let cp = bake["checkpoints"]
                .as_array()?
                .iter()
                .find(|x| x["step"] == json!(c))
                .and_then(checkpoint_of)?;
            let (_, mut theirs) = self.build(world).ok()?;
            theirs.restore(&cp).ok()?;
            golden::first_field(&theirs.canonical(), t.at.get(&c)?)
        });
        reply["report"] = json!({"first_step": k, "checkpoint": checkpoint, "field": field});
        Some(reply)
    }
}

/// The wasm32 build's entry (issue #2012): the runner as a module with no imports, one call line in, one reply line
/// out, through its own memory. `deep_physics_alloc(len)` gives room for a call's UTF-8; `deep_physics_call(ptr, len)`
/// answers it, takes the call's room back, and returns the reply's room as `ptr << 32 | len`, which
/// `deep_physics_free(ptr, len)` gives back.
#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::Run;

    fn leak(mut bytes: Vec<u8>) -> *mut u8 {
        bytes.shrink_to_fit();
        let p = bytes.as_mut_ptr();
        std::mem::forget(bytes);
        p
    }

    #[no_mangle]
    pub extern "C" fn deep_physics_alloc(len: usize) -> *mut u8 {
        leak(vec![0; len])
    }

    /// # Safety
    /// `ptr` and `len` are a room `deep_physics_alloc` or `deep_physics_call` gave, not yet given back.
    #[no_mangle]
    pub unsafe extern "C" fn deep_physics_free(ptr: *mut u8, len: usize) {
        // SAFETY: the caller gives back a room this module leaked with exactly this length and capacity.
        drop(unsafe { Vec::from_raw_parts(ptr, len, len) });
    }

    /// One step of the world `time_build` built, for a page that times it on its own clock: 1, or 0 without one.
    #[no_mangle]
    pub extern "C" fn deep_physics_step() -> u32 {
        u32::from(super::timed_step())
    }

    /// Notes the step's most-tested pair, outside the timed step.
    #[no_mangle]
    pub extern "C" fn deep_physics_note() {
        super::timed_note();
    }

    /// # Safety
    /// `ptr` and `len` are a room `deep_physics_alloc` gave, holding the call's UTF-8.
    #[no_mangle]
    pub unsafe extern "C" fn deep_physics_call(ptr: *mut u8, len: usize) -> u64 {
        // SAFETY: as `deep_physics_free`; the room is taken back here.
        let call = unsafe { Vec::from_raw_parts(ptr, len, len) };
        let reply = match (Run::new(None), std::str::from_utf8(&call)) {
            (Some(run), Ok(line)) => run.line(line),
            _ => super::BAD_INPUT.to_string(),
        };
        let n = reply.len();
        (leak(reply.into_bytes()) as u64) << 32 | n as u64
    }
}
