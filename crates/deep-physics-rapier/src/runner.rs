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

use crate::scene::Scene;
use crate::{fp, Rapier};
use base64::Engine;
use deep_canvas_physics::backend::{
    Backend, BodyState, Canonical, Checkpoint, ShapeRef, Targets, FIELDS,
};
use deep_canvas_physics::bake::{self, Build, Parts};
use deep_canvas_physics::caps::{Caps, RAPIER3D};
use deep_canvas_physics::check::{check, fix};
use deep_canvas_physics::doc::{Read, Refusal, World};
use deep_canvas_physics::golden;
use deep_canvas_physics::occurrence;
use deep_canvas_physics::pairs::{pairs, Brief};
use deep_canvas_physics::roles::{self, Row};
use serde_json::{json, Map, Value};

/// The planted wrong programs, by name.
pub const PLANTED: [&str; 9] = [
    "caps_allow_restitution_threshold",
    "caps_allow_rolling_resistance",
    "caps_allow_tangent_speed",
    "caps_allow_dynamic_gear",
    "restore_ignores_version",
    "hash_rounds_1e6",
    "key_omits_frame_rate",
    "role_table_pickup_solid",
    "occurrences_in_engine_order",
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
    build: Build,
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

/// What one run steps and takes besides its hashes.
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
}

/// What a run took.
#[derive(Default)]
struct Trace {
    bodies: Map<String, Value>,
    step_hashes: Vec<String>,
    checkpoints: Vec<Value>,
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
            build: crate::build(),
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
    /// nothing); a golden's when `target` is `None`. Worlds take no input yet (#522).
    fn key(
        &self,
        world: &Value,
        reads: &Value,
        rate: &str,
        steps: u64,
        target: Option<&str>,
    ) -> String {
        let parts = Parts {
            world,
            reads,
            track: &json!([]),
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
    fn subject<'c>(&self, call: &'c Value) -> Option<Result<(&'c Value, Option<Scene>), Value>> {
        let world = call.get("world")?;
        let Some(scene) = call.get("scene") else {
            return Some(Ok((world, None)));
        };
        let id = world.as_str()?;
        let doc = scene.get("worlds")?.get(id)?;
        let read = check(doc, &self.caps, self.table).and_then(|w| Scene::read(scene, id, &w));
        Some(read.map(|s| (doc, Some(s))).map_err(|e| refused(&e)))
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
        if k > start && k.is_multiple_of(w.checkpoint_every) {
            t.checkpoints.push(checkpoint(&b.checkpoint()));
            t.at.insert(k, c);
        }
    }

    /// Steps `b` `plan.steps` times from where it stands.
    fn run(&self, b: &mut Rapier, w: &World, plan: &Plan, t: &mut Trace) -> Result<(), Stop> {
        let start = b.read().step;
        let rank = occurrence::ranks(w);
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
            b.step(&[], &targets)
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
        let steps = plan.steps;
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
        let key = self.key(
            world,
            &reads(plan, steps),
            &rate,
            steps,
            Some(&self.build.target),
        );
        let outputs = bake::outputs(&t.positions, &rate, frame, w.step_rate, steps);
        let rank = occurrence::ranks(&w);
        t.shaped = shape_uses(&t.occurrences, &w);
        let record = json!({"key": key, "step_hashes": t.step_hashes, "checkpoints": t.checkpoints, "outputs": outputs,
                            "occurrences": occurrence::listed(&t.occurrences),
                            "occurrences_hash": occurrence::hash(&t.occurrences, &rank)});
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

    /// The reply to one call, or `None` for a call it doesn't take.
    pub fn answer(&self, call: &Value) -> Option<Value> {
        let steps = || call.get("steps").and_then(Value::as_u64);
        let done = |r: Result<Value, Value>| Some(r.unwrap_or_else(|e| e));
        match call.get("call")?.as_str()? {
            "check" => {
                let issues = match self.subject(call)? {
                    Ok((world, _)) => self
                        .build(world)
                        .err()
                        .map_or(json!([]), |e| e["issues"].clone()),
                    Err(e) => e["issues"].clone(),
                };
                Some(json!({"ok": true, "issues": issues}))
            }
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
                let plan = Plan {
                    steps: steps()?,
                    scene: scene.as_ref(),
                    every: call.get("every").map_or(Some(1), Value::as_u64)?.max(1),
                    guard: false,
                    ftz_at: None,
                    shift: None,
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
                        world,
                        &reads(&plan, plan.steps),
                        &rate,
                        plan.steps,
                        Some(&self.build.target),
                    );
                    if self.build(world).is_ok() {
                        if let Some(r) = stored(dir, &key) {
                            return Some(
                                json!({"ok": true, "key": key, "step_hashes": r["step_hashes"],
                                       "outputs": r["outputs"], "occurrences": r["occurrences"],
                                       "occurrences_hash": r["occurrences_hash"], "reused": true}),
                            );
                        }
                    }
                }
                done(self.bake(call, world, &plan).map(|(key, t, record)| {
                    let mut reply = json!({"ok": true, "key": key, "bodies": t.bodies,
                                           "step_hashes": t.step_hashes, "outputs": record["outputs"],
                                           "occurrences": record["occurrences"],
                                           "occurrences_hash": record["occurrences_hash"]});
                    if with_checkpoints {
                        reply["checkpoints"] = Value::Array(t.checkpoints);
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
                let plan = Plan {
                    steps: steps()?,
                    scene: scene.as_ref(),
                    every: 1,
                    guard: false,
                    ftz_at: None,
                    shift: None,
                };
                let (w, mut b) = match self.build(world) {
                    Ok(x) => x,
                    Err(e) => return Some(e),
                };
                if let Err(r) = b.restore(&cp) {
                    return Some(
                        json!({"ok": false, "code": r.code, "path": r.path, "actual": r.actual, "what": r.what}),
                    );
                }
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
                    reply["checkpoints"] = Value::Array(t.checkpoints);
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
                let key = self.key(world, &json!([]), &rate, steps, Some(&self.build.target));
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
                let plan = Plan {
                    steps: steps()?,
                    scene: None,
                    every: 1,
                    guard: true,
                    ftz_at: None,
                    shift: None,
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
                        "bake_key": self.key(world, &json!([]), &rate, plan.steps, None),
                        "runtime_digest": self.build.runtime_digest(), "machine": machine(&self.build.target),
                        "step_hashes": t.step_hashes, "checkpoint_hashes": hashes,
                        "occurrences_hash": record["occurrences_hash"],
                        "record_on": self.build.target, "verify_on": verify_on}})
                }))
            }
            "golden_verify" => self.verify(call),
            "pairs" => {
                Some(self.pairs(call.get("world")?, call.get("brief").unwrap_or(&json!({})))?)
            }
            "time" => {
                let (w, mut b) = match self.build(call.get("world")?) {
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
                let built = self.build(call.get("world")?);
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
        let key = self.key(world, &json!([]), &rate, plan.steps, None);
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
                &self.key(world, &json!([]), &rate, plan.steps, Some(target)),
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
