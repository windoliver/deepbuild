//! Issue #191: the physics interface's behavior part (canvas primitives: Physics: behavior kit).
//! Each fixture is a world document with a measure, an answer worked out from the world's own laws
//! and a tolerance, all data here in the interface, so no backend adds, changes or loosens one. The
//! kit runs a backend through the backend interface only, reads each measure from what the steps
//! left, and reports `{backend, fixture, measured, answer, tolerance, pass | fail |
//! excluded_by_caps}`. A fixture whose caps the backend doesn't claim is never run; a candidate
//! backend that claims a feature no fixture tests is refused before any runs.

use serde_json::{json, Map, Value};

use crate::backend::{
    Backend, BodyState, CharacterState, Input, JointState, Query, State, Targets,
};
use crate::check::check;
use crate::doc::World;
use crate::occurrence::{self, Row, KINDS};
use crate::roles::TABLE;
use crate::track;

mod fixtures;
pub mod scan;
mod sensors;
pub mod walks;

pub use fixtures::{all, test_capped};

/// The physics interface's reference implementation, which the claim rule doesn't hold.
pub const REFERENCE: &str = "rapier3d";

/// How far a measure may land from its answer.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Tolerance {
    /// A share of the answer.
    Relative(f64),
    M(f64),
    Deg(f64),
    /// Steps of the world: of a time in seconds, or of a count of steps.
    Steps(f64),
}

/// A ray, sweep or overlap and the collision groups it asks in, by name.
#[derive(Clone, Debug, PartialEq)]
pub struct Probe {
    pub query: Query,
    pub groups: Vec<&'static str>,
}

/// What a fixture reads of its run.
#[derive(Clone, Debug, PartialEq)]
pub enum Measure {
    /// How far `body` moved from its start by the end of step `step`, m.
    Travel { body: &'static str, step: usize },
    /// How far along x `body` lands back at its launch height, m.
    Range { body: &'static str },
    /// The time between `body`'s first two crossings of x = 0 toward −x, s.
    Period { body: &'static str },
    /// `body`'s highest y after its first contact, less `base`, m.
    Apex { body: &'static str, base: f64 },
    /// `body`'s turn rate after step `step`, deg/s.
    Spin { body: &'static str, step: usize },
    /// The largest size of `joint`'s coordinate over the run (deg or m).
    Peak { joint: &'static str },
    /// The time of the first row of `kind` between `a` and `b`, s.
    When {
        kind: &'static str,
        a: &'static str,
        b: &'static str,
    },
    /// Field `field` of the first row of `kind` between `a` and `b`.
    Field {
        kind: &'static str,
        a: &'static str,
        b: &'static str,
        field: &'static str,
    },
    /// How many rows of `kind` name `body`.
    Count {
        kind: &'static str,
        body: &'static str,
    },
    /// The steps from `body`'s speed falling under `speed` m/s, for good, to its `rest` row.
    SleepSteps { body: &'static str, speed: f64 },
    /// How many of the probes, asked after the first step, meet other shape uses than a scan over
    /// every shape of the world meets, or in another order.
    Queries(Vec<Probe>),
    /// The time `body` first touches `wall`, s; it fails wherever the body's centre passes `far`
    /// on x.
    Wall {
        body: &'static str,
        wall: &'static str,
        far: f64,
    },
    /// A sensor cell: the step of `mover`'s one `sensor_enter` on `sensor`; it fails unless the
    /// pair writes exactly one enter at `enter` and one exit at `exit`, each within the
    /// tolerance's steps.
    Cell {
        mover: &'static str,
        sensor: &'static str,
        enter: f64,
        exit: f64,
    },
    /// #182: how many of a character fixture's characters break their rule, each named.
    Walks(Vec<walks::Walk>),
}

/// One fixture of the behavior part.
#[derive(Clone, Debug, PartialEq)]
pub struct Fixture {
    pub name: String,
    pub world: Value,
    pub steps: u64,
    /// Input track entries, as a world's `track` holds them.
    pub track: Value,
    /// Each kinematic body moved at a constant velocity, m/s, from its pose.
    pub moves: Vec<(&'static str, [f64; 3])>,
    pub measure: Measure,
    pub answer: f64,
    pub tolerance: Tolerance,
    /// The answer is a bound the measure may reach but never pass.
    pub never_past: bool,
    /// What the backend must claim to run it.
    pub caps: Vec<&'static str>,
}

impl Fixture {
    /// The fixture as the interface's data: `{name, world, measure, answer, tolerance, caps}`.
    pub fn json(&self) -> Value {
        json!({"name": self.name, "world": self.world, "steps": self.steps, "track": self.track,
               "measure": named_measure(&self.measure), "answer": self.answer,
               "tolerance": tolerance_json(self.tolerance), "caps": self.caps})
    }
}

/// A planted kit (criteria 4 and 6): one that runs a fixture its caps exclude, or one that admits
/// a candidate whatever it claims.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    RunsExcluded,
    AdmitsUnfixtured,
    /// #182: a report that reads `pass` for a fixture its backend's caps exclude.
    PassesExcluded,
}

/// The kit's report on one backend.
#[derive(Clone, Debug, PartialEq)]
pub struct Report {
    pub backend: String,
    /// The claims a candidate was refused for, which no fixture tests; none when admitted.
    pub refused: Vec<String>,
    pub results: Vec<Value>,
}

impl Report {
    /// `pass` when no result fails, `fail` otherwise, `refused` for a refused candidate.
    pub fn verdict(&self) -> &'static str {
        if !self.refused.is_empty() {
            "refused"
        } else if self.results.iter().any(|r| r["result"] == "fail") {
            "fail"
        } else {
            "pass"
        }
    }

    /// `{backend, admitted, refused?, results, verdict}`.
    pub fn json(&self) -> Value {
        let mut out = json!({"backend": self.backend, "admitted": self.refused.is_empty(),
                             "results": self.results, "verdict": self.verdict()});
        if !self.refused.is_empty() {
            out["refused"] = json!({"features": self.refused,
                "what": format!("{} is a candidate whose caps() claim {}, which no fixture of the behavior part tests, so it is refused before any fixture runs",
                                self.backend, self.refused.join(", "))});
        }
        out
    }
}

/// What a run left after each step: index k is after k steps, 0 as built.
struct Trace {
    rate: f64,
    states: Vec<State>,
    joints: Vec<Vec<JointState>>,
    rows: Vec<Row>,
    /// #182: each character body's own state.
    characters: Vec<Vec<CharacterState>>,
}

fn body_of<'a>(s: &'a State, id: &str) -> Option<&'a BodyState> {
    s.bodies.iter().find(|b| b.id == id)
}

fn dist(a: [f64; 3], b: [f64; 3]) -> f64 {
    deep_canvas::ops::sqrt((0..3).map(|i| (a[i] - b[i]) * (a[i] - b[i])).sum())
}

/// Steps `b` through `f` from its built world `w`.
fn trace(b: &mut dyn Backend, w: &World, f: &Fixture) -> Result<Trace, String> {
    let entries = track::read(w, &f.track).map_err(|r| r.what)?;
    let by_step = track::by_step(&entries);
    let rank = occurrence::ranks(w);
    let rate = w.step_rate;
    let start = b.read();
    let mut t = Trace {
        rate,
        states: vec![start.clone()],
        joints: vec![b.joints()],
        rows: Vec::new(),
        characters: vec![b.characters()],
    };
    for k in 1..=f.steps {
        let inputs: Vec<Input> = by_step
            .get(&(k - 1))
            .into_iter()
            .flatten()
            .map(|e| Input {
                kind: e.kind.clone(),
                target: e.target.clone(),
                data: Value::Object(e.data.clone()),
            })
            .collect();
        let mut targets = Targets::default();
        for (id, v) in &f.moves {
            let from = body_of(&start, id)
                .ok_or_else(|| format!("{id} isn't a body"))?
                .pos;
            let s = k as f64 / rate;
            targets
                .poses
                .insert((*id).into(), [0, 1, 2].map(|i| from[i] + v[i] * s));
        }
        b.step(&inputs, &targets).map_err(|r| r.what)?;
        t.rows
            .extend(occurrence::sorted(k as u32, b.occurrences(), &rank));
        t.states.push(b.read());
        t.joints.push(b.joints());
        t.characters.push(b.characters());
    }
    Ok(t)
}

/// #182: whether character `id` reads `read` (grounded or sliding) after step `k`.
fn reads(t: &Trace, id: &str, read: &str, k: usize) -> Option<bool> {
    let c = t.characters.get(k)?.iter().find(|c| c.id == id)?;
    Some(if read == "sliding" {
        c.sliding
    } else {
        c.grounded
    })
}

/// #182: each failure of a character fixture's characters, named: the body, what it met, the
/// step and the height its lowest point reached over its start, m.
fn walked(t: &Trace, cases: &[walks::Walk]) -> Vec<Value> {
    use walks::Rule;
    let mut out = Vec::new();
    for c in cases {
        let p = path(t, c.body);
        let y0 = p.first().map_or(0.0, |x| x[1]);
        let rise = |k: usize| p.get(k).map_or(0.0, |x| x[1] - y0);
        let (body, meets) = (c.body, c.meets);
        let fail = |step: usize, height: f64, what: String| json!({"body": body, "obstacle": meets, "step": step, "height": height, "what": what});
        match &c.rule {
            Rule::Climbs {
                rise: want,
                within,
                by,
            } => {
                let k = (*by).min(p.len().saturating_sub(1));
                if (rise(k) - want).abs() > *within {
                    out.push(fail(k, rise(k), format!("body {body} on {meets} stands {:.4} m above its start at step {k}, where {want} m within {within} m is due", rise(k))));
                }
            }
            Rule::Stops { most } => {
                if let Some(k) = (0..p.len()).find(|&k| rise(k) > *most) {
                    let top = (0..p.len()).map(rise).fold(f64::MIN, f64::max);
                    out.push(fail(k, top, format!("body {body} climbed {meets}: its lowest point rose more than the {most} m it may at step {k} and reached {top:.4} m")));
                }
            }
            Rule::Peaks { rise: want, within } => {
                let (k, top) = (0..p.len())
                    .map(|k| (k, rise(k)))
                    .fold((0, f64::MIN), |a, x| if x.1 > a.1 { x } else { a });
                if (top - want).abs() > *within {
                    out.push(fail(k, top, format!("body {body}'s lowest point peaks {top:.4} m up at step {k}, where {want:.4} m within {within} m is due")));
                }
            }
            Rule::Reads { read, on } => {
                let off = (1..t.characters.len()).find(|&k| reads(t, body, read, k) != Some(*on));
                if let Some(k) = off {
                    let shown = if *on { "false" } else { "true" };
                    out.push(fail(k, rise(k), format!("body {body} on {meets} read {read} {shown} at step {k}, where every step reads it {on}")));
                }
            }
            Rule::LeavesGround => {
                if (1..t.characters.len()).all(|k| reads(t, body, "grounded", k) == Some(true)) {
                    let k = t.characters.len() - 1;
                    out.push(fail(k, rise(k), format!("body {body} on {meets} read grounded at every step, where it leaves the ground at least once")));
                }
            }
        }
    }
    out
}

/// A position of `id` after each step.
fn path(t: &Trace, id: &str) -> Vec<[f64; 3]> {
    t.states
        .iter()
        .filter_map(|s| body_of(s, id).map(|b| b.pos))
        .collect()
}

fn between(r: &Row, a: &str, b: &str) -> bool {
    let (x, y) = (r.raw.a.as_str(), r.raw.b.as_deref());
    (x == a && y == Some(b)) || (x == b && y == Some(a))
}

fn kind_is(r: &Row, kind: &str) -> bool {
    KINDS.get(r.raw.kind as usize) == Some(&kind)
}

/// A reading: the measure, the fields a report adds beside it, and whether something the measure
/// watches failed whatever its value (a wall passed, a cell's rows off).
struct Reading {
    value: Option<f64>,
    extra: Map<String, Value>,
    broke: Option<String>,
}

fn reading(value: Option<f64>, extra: Value) -> Reading {
    Reading {
        value,
        extra: extra.as_object().cloned().unwrap_or_default(),
        broke: None,
    }
}

/// The measure's reading of a run.
fn read(m: &Measure, t: &Trace, b: &dyn Backend, w: &World, f: &Fixture) -> Reading {
    let s = |k: usize| k as f64 / t.rate;
    match m {
        Measure::Travel { body, step } => {
            let p = path(t, body);
            reading(
                p.get(*step).zip(p.first()).map(|(a, z)| dist(*a, *z)),
                json!({"body": body}),
            )
        }
        Measure::Range { body } => {
            let p = path(t, body);
            let y0 = p.first().map_or(0.0, |x| x[1]);
            let at = (2..p.len()).find(|&k| p[k - 1][1] >= y0 && p[k][1] < y0);
            let x = at.map(|k| {
                let a = (p[k - 1][1] - y0) / (p[k - 1][1] - p[k][1]);
                p[k - 1][0] + a * (p[k][0] - p[k - 1][0]) - p[0][0]
            });
            reading(x, json!({"body": body}))
        }
        Measure::Period { body } => {
            let p = path(t, body);
            let cross: Vec<f64> = (1..p.len())
                .filter(|&k| p[k - 1][0] > 0.0 && p[k][0] <= 0.0)
                .map(|k| s(k - 1) + (p[k - 1][0] / (p[k - 1][0] - p[k][0])) / t.rate)
                .collect();
            reading(cross.get(1).map(|c| c - cross[0]), json!({"body": body}))
        }
        Measure::Apex { body, base } => {
            let first = t.rows.iter().find(|r| {
                kind_is(r, "contact_begin")
                    && (r.raw.a == *body || r.raw.b.as_deref() == Some(body))
            });
            let p = path(t, body);
            let peak = first.and_then(|r| {
                let mut k = r.step as usize;
                while k + 1 < p.len() && p[k + 1][1] <= p[k][1] {
                    k += 1;
                }
                while k + 1 < p.len() && p[k + 1][1] > p[k][1] {
                    k += 1;
                }
                (k + 1 < p.len()).then(|| p[k][1] - base)
            });
            reading(peak, json!({"body": body}))
        }
        Measure::Spin { body, step } => {
            let w = t
                .states
                .get(*step)
                .and_then(|st| body_of(st, body))
                .map(|b| b.angular);
            reading(w.map(|a| dist(a, [0.0; 3])), json!({"body": body}))
        }
        Measure::Peak { joint } => {
            let top = t
                .joints
                .iter()
                .enumerate()
                .filter_map(|(k, js)| {
                    Some((k, js.iter().find(|j| j.id == *joint)?.coordinate?.abs()))
                })
                .reduce(|best, x| if x.1 > best.1 { x } else { best });
            reading(
                top.map(|x| x.1),
                json!({"joint": joint, "step": top.map(|x| x.0)}),
            )
        }
        Measure::When { kind, a, b } => {
            let row = t.rows.iter().find(|r| kind_is(r, kind) && between(r, a, b));
            reading(
                row.map(|r| s(r.step as usize)),
                json!({"step": row.map(|r| r.step)}),
            )
        }
        Measure::Field { kind, a, b, field } => {
            let row = t.rows.iter().find(|r| kind_is(r, kind) && between(r, a, b));
            reading(
                row.and_then(|r| occurrence::json(r).get(*field)?.as_f64()),
                json!({"step": row.map(|r| r.step)}),
            )
        }
        Measure::Count { kind, body } => {
            let n = t
                .rows
                .iter()
                .filter(|r| {
                    kind_is(r, kind) && (r.raw.a == *body || r.raw.b.as_deref() == Some(body))
                })
                .count();
            reading(Some(n as f64), json!({"body": body}))
        }
        Measure::SleepSteps { body, speed } => {
            let rest = t
                .rows
                .iter()
                .find(|r| kind_is(r, "rest") && r.raw.a == *body)
                .map(|r| r.step as usize);
            let fast = |k: usize| {
                body_of(&t.states[k], body).is_some_and(|x| dist(x.linear, [0.0; 3]) >= *speed)
            };
            let under = rest.map(|r| (0..=r).rev().find(|&k| fast(k)).map_or(0, |k| k + 1));
            let v = rest.zip(under).map(|(r, u)| (r - u) as f64);
            reading(v, json!({"body": body, "under": under, "rest": rest}))
        }
        Measure::Queries(probes) => {
            let mask = |groups: &[&str]| {
                groups
                    .iter()
                    .filter_map(|g| w.groups.iter().position(|x| x == g))
                    .fold(0u32, |m, i| m | 1 << i)
            };
            let mut differ = 0;
            let mut counts = json!({"ray": 0, "sweep": 0, "overlap": 0});
            let mut first = None;
            for (i, p) in probes.iter().enumerate() {
                let kind = scan::kind(&p.query);
                counts[kind] = json!(counts[kind].as_u64().unwrap_or(0) + 1);
                let (got, want) = (
                    b.query(&p.query, mask(&p.groups)),
                    scan::hits(w, &p.query, mask(&p.groups)),
                );
                if !scan::same(&got, &want) {
                    differ += 1;
                    first.get_or_insert_with(|| scan::differs(i, p, &got, &want));
                }
            }
            let mut extra = json!({"probes": counts});
            if let Some(Value::Object(d)) = first {
                extra
                    .as_object_mut()
                    .into_iter()
                    .for_each(|e| e.extend(d.clone()));
            }
            reading(Some(f64::from(differ)), extra)
        }
        Measure::Wall { body, wall, far } => {
            let row = t
                .rows
                .iter()
                .find(|r| kind_is(r, "contact_begin") && between(r, body, wall));
            let crossed = path(t, body).iter().position(|p| p[0] > *far);
            let mut r = reading(row.map(|r| s(r.step as usize)), json!({"body": body}));
            if let Some(k) = crossed {
                r.extra.insert("step".into(), json!(k));
                r.broke = Some(format!(
                    "body {body}'s centre passed the wall's far face (x = {far} m) at step {k}"
                ));
            }
            r
        }
        Measure::Cell {
            mover,
            sensor,
            enter,
            exit,
        } => {
            let rows: Vec<&Row> = t
                .rows
                .iter()
                .filter(|r| {
                    (kind_is(r, "sensor_enter") || kind_is(r, "sensor_exit"))
                        && between(r, mover, sensor)
                })
                .collect();
            let listed: Vec<Value> = rows
                .iter()
                .map(|r| json!({"kind": KINDS[r.raw.kind as usize], "step": r.step}))
                .collect();
            let within = match f.tolerance {
                Tolerance::Steps(n) => n,
                _ => 0.0,
            };
            let at = |kind: &str| {
                rows.iter()
                    .filter(|r| kind_is(r, kind))
                    .map(|r| f64::from(r.step))
                    .collect::<Vec<_>>()
            };
            let (ins, outs) = (at("sensor_enter"), at("sensor_exit"));
            let ok = |got: &[f64], want: f64| got.len() == 1 && (got[0] - want).abs() <= within;
            let mut r = reading(ins.first().copied(), json!({"occurrences": listed}));
            if !ok(&ins, *enter) || !ok(&outs, *exit) {
                r.broke = Some(format!("{mover} and {sensor} wrote enters at steps {ins:?} and exits at steps {outs:?}, where one enter at step {enter} and one exit at step {exit} are due, within {within} steps"));
            }
            r
        }
        Measure::Walks(cases) => {
            let failed = walked(t, cases);
            let mut extra = json!({"failures": failed});
            if let Some(first) = failed.first() {
                for k in ["body", "obstacle", "step", "height"] {
                    extra[k] = first[k].clone();
                }
            }
            let mut r = reading(Some(failed.len() as f64), extra);
            if !failed.is_empty() {
                let whats: Vec<&str> = failed.iter().filter_map(|f| f["what"].as_str()).collect();
                r.broke = Some(whats.join("; "));
            }
            r
        }
    }
}

fn tolerance_json(t: Tolerance) -> Value {
    match t {
        Tolerance::Relative(x) => json!({"relative": x}),
        Tolerance::M(x) => json!({"m": x}),
        Tolerance::Deg(x) => json!({"deg": x}),
        Tolerance::Steps(x) => json!({"steps": x}),
    }
}

/// A tolerance as a report's text says it: `1%`, `0.5°`, `1 mm`, `1 step`.
fn tolerance_text(t: Tolerance) -> String {
    match t {
        Tolerance::Relative(x) => format!("{}%", x * 100.0),
        Tolerance::M(x) => format!("{x} m"),
        Tolerance::Deg(x) => format!("{x}°"),
        Tolerance::Steps(x) => format!("{x} steps"),
    }
}

/// A measure as a report names it.
fn named_measure(m: &Measure) -> String {
    match m {
        Measure::Travel { body, step } => format!("distance {body} moved by step {step}, m"),
        Measure::Range { body } => format!("range of {body} back at its launch height, m"),
        Measure::Period { body } => format!("period of {body}, s"),
        Measure::Apex { body, .. } => format!("height of {body}'s first bounce, m"),
        Measure::Spin { body, step } => format!("turn rate of {body} after step {step}, deg/s"),
        Measure::Peak { joint } => format!("largest coordinate joint {joint} reached"),
        Measure::When { kind, a, b } => format!("time of the first {kind} of {a} and {b}, s"),
        Measure::Field { kind, a, b, field } => {
            format!("{field} of the first {kind} of {a} and {b}")
        }
        Measure::Count { kind, body } => format!("count of {kind} rows of {body}"),
        Measure::SleepSteps { body, .. } => {
            format!("steps from {body}'s speed falling under the sleep speed to its rest")
        }
        Measure::Queries(_) => "probes whose hits differ from a scan over every shape".into(),
        Measure::Wall { body, wall, .. } => format!("time {body} first touches {wall}, s"),
        Measure::Cell { mover, sensor, .. } => {
            format!("step of {mover}'s sensor_enter on {sensor}")
        }
        Measure::Walks(cases) => {
            let bodies: Vec<&str> = cases.iter().map(|c| c.body).collect();
            format!("characters of {} that break their rule", bodies.join(", "))
        }
    }
}

/// Whether a measure in steps is read in seconds (a time) rather than in steps (a count).
fn in_seconds(m: &Measure) -> bool {
    matches!(m, Measure::When { .. } | Measure::Wall { .. })
}

fn within(f: &Fixture, m: f64, rate: f64) -> bool {
    let room = match f.tolerance {
        Tolerance::Relative(r) => r * f.answer.abs(),
        Tolerance::M(x) | Tolerance::Deg(x) => x,
        Tolerance::Steps(n) if in_seconds(&f.measure) => n / rate,
        Tolerance::Steps(n) => n,
    };
    if f.never_past {
        m <= f.answer + room
    } else {
        (m - f.answer).abs() <= room
    }
}

/// One fixture on a fresh backend from `new`, as backend `name` claiming `claims`.
fn one(
    new: &dyn Fn() -> Box<dyn Backend>,
    f: &Fixture,
    name: &str,
    claims: &[&str],
    planted: Planted,
) -> Value {
    let mut row = json!({"backend": name, "fixture": f.name, "measure": named_measure(&f.measure),
                         "answer": f.answer, "tolerance": tolerance_json(f.tolerance), "caps": f.caps,
                         "measured": Value::Null});
    let missing: Vec<&str> = f
        .caps
        .iter()
        .copied()
        .filter(|c| !claims.contains(c))
        .collect();
    if !missing.is_empty() && planted == Planted::PassesExcluded {
        row["result"] = json!("pass");
        row["what"] = json!(format!("{name} passes {}", f.name));
        return row;
    }
    if !missing.is_empty() && planted != Planted::RunsExcluded {
        row["result"] = json!("excluded_by_caps");
        row["what"] = json!(format!(
            "{name} doesn't claim {} in its caps(), so {} is excluded, never run or passed",
            missing.join(", "),
            f.name
        ));
        return row;
    }
    let mut b = new();
    let whats =
        |e: Vec<crate::doc::Refusal>| e.into_iter().map(|r| r.what).collect::<Vec<_>>().join("; ");
    let ran = check(&f.world, b.caps(), &TABLE)
        .map_err(whats)
        .and_then(|w| b.build(&w).map(|()| w).map_err(whats))
        .and_then(|w| trace(b.as_mut(), &w, f).map(|t| (w, t)));
    let r = match &ran {
        Ok((w, t)) => {
            let mut r = read(&f.measure, t, b.as_ref(), w, f);
            if r.value.is_some_and(|m| !within(f, m, t.rate)) && r.broke.is_none() {
                r.broke = Some(String::new());
            }
            r
        }
        Err(what) => Reading {
            value: None,
            extra: Map::new(),
            broke: Some(format!("the world didn't run: {what}")),
        },
    };
    let ok = r.value.is_some() && r.broke.is_none();
    let shown = r.value.map_or_else(|| "nothing".into(), |m| format!("{m}"));
    let (answer, tolerance) = (f.answer, tolerance_text(f.tolerance));
    let what = if ok {
        format!("{name} passes {}: its {} read {shown} against the interface's answer {answer} within {tolerance}", f.name, named_measure(&f.measure))
    } else {
        let why = r
            .broke
            .clone()
            .filter(|w| !w.is_empty())
            .map_or_else(String::new, |w| format!("; {w}"));
        let named = ["joint", "hit"]
            .iter()
            .filter_map(|k| r.extra.get(*k)?.as_str().map(|v| format!("; {k} {v}")))
            .collect::<String>();
        format!("{name} fails {}: its {} read {shown} where the interface's answer is {answer} within {tolerance}{named}{why}", f.name, named_measure(&f.measure))
    };
    for (k, v) in r.extra {
        row[k] = v;
    }
    row["measured"] = json!(r.value);
    row["result"] = json!(if ok { "pass" } else { "fail" });
    row["what"] = json!(what);
    row
}

/// The kit on backend `name` (its ID's name, `rapier3d` for the reference), every fixture on a
/// fresh backend from `new`; a candidate whose caps claim a feature no fixture tests is refused
/// before any runs. Only the interface's fixtures and tolerances are read.
pub fn run(new: &dyn Fn() -> Box<dyn Backend>, fixtures: &[Fixture], planted: Planted) -> Report {
    let probe = new();
    let id = probe.id();
    let name = id.split('@').next().unwrap_or_default().to_string();
    let claims = probe.caps().claims;
    if name != REFERENCE && planted != Planted::AdmitsUnfixtured {
        let tested: Vec<&str> = fixtures
            .iter()
            .flat_map(|f| f.caps.iter().copied())
            .collect();
        let refused: Vec<String> = claims
            .iter()
            .filter(|c| !tested.contains(c))
            .map(|c| c.to_string())
            .collect();
        if !refused.is_empty() {
            return Report {
                backend: name,
                refused,
                results: Vec::new(),
            };
        }
    }
    let results = fixtures
        .iter()
        .map(|f| one(new, f, &name, claims, planted))
        .collect();
    Report {
        backend: name,
        refused: Vec::new(),
        results,
    }
}
