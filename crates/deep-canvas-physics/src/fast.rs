//! #191: fast bodies. The lint `physics.fast_body`, run over every bake, raises an issue for a
//! dynamic body with `ccd` off that moves farther in one step than half its thinnest extent, naming
//! the body, the step, its move and that half. And the default: a world whose bake flags a body
//! that leaves `ccd` unset expands with `ccd: true` on it, shown as an assumption row, so a body no
//! one thought to sweep still never passes through a wall.
//!
//! #2239: the lint says what the backend's sweep holds, read from its caps (`caps::Sweep`). A
//! body's move is its fastest point's: its centre of mass's move plus its turn times the farthest
//! its shapes reach from that centre. A fast body no sweep starts from, a kinematic one, raises an
//! issue of kind `kinematic`; and two bodies whose swept bounds meet where neither a sweep nor a
//! body's own contact prediction holds them and `ccd` on the fast one can't settle it raise one of
//! kind `pair`. Neither names a fix that fixes nothing, and a body another's sweep holds is never
//! told to turn `ccd` on, which would end it.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas::ops;
use serde_json::{json, Value};

use crate::backend::rotate;
use crate::caps::Sweep;
use crate::check::fix;
use crate::doc::{Body, BodyKind, Rot, Shape, World};

/// The lint's code.
pub const FAST_BODY: &str = "physics.fast_body";

/// The fix of a fast body no sweep starts from.
const KINEMATIC_FIX: &str =
    "Make the body dynamic and move it with a motor or a starting velocity.";
/// The fix of two bodies that are both fast.
const BOTH_FAST_FIX: &str = "Raise step_rate until neither body is fast, or slow them.";

type V3 = [f64; 3];
/// A box by its least and greatest corner.
type Bounds = (V3, V3);

fn len(v: V3) -> f64 {
    ops::sqrt(v.iter().map(|x| x * x).sum())
}

/// The angle, rad, of the turn from rotation `a` to `b` (`[x, y, z, w]`), read from the turn's
/// own vector part, so a body that keeps its rotation reads 0.
fn turned(a: [f64; 4], b: [f64; 4]) -> f64 {
    let v = [
        a[3] * b[0] - b[3] * a[0] - (b[1] * a[2] - b[2] * a[1]),
        a[3] * b[1] - b[3] * a[1] - (b[2] * a[0] - b[0] * a[2]),
        a[3] * b[2] - b[3] * a[2] - (b[0] * a[1] - b[1] * a[0]),
    ];
    let w: f64 = (0..4).map(|i| a[i] * b[i]).sum();
    2.0 * ops::atan2(len(v), w.abs())
}

/// One plain shape on a body: its centre in the body's frame, its half extents and whether they
/// turn with the body (else they bound it whichever way it is turned), half its thinnest extent,
/// the radius that bounds it, its weight in the body's centre of mass, and the groups it is in
/// and collides with, none for a sensor.
struct Part {
    at: V3,
    half: V3,
    turns: bool,
    thin: f64,
    bound: f64,
    weight: f64,
    groups: Option<(u32, u32)>,
}

fn part(w: &World, b: &Body, i: usize) -> Option<Part> {
    use std::f64::consts::PI;
    let u = &b.shapes[i];
    let (half, thin, bound, volume) = match w.shapes.get(&u.shape)? {
        Shape::Sphere { radius: r } => ([*r; 3], *r, *r, 4.0 / 3.0 * PI * r * r * r),
        Shape::Box { half: h } => (
            *h,
            h[0].min(h[1]).min(h[2]),
            len(*h),
            8.0 * h[0] * h[1] * h[2],
        ),
        Shape::Capsule {
            half_height: h,
            radius: r,
        } => (
            [*r, h + r, *r],
            *r,
            h + r,
            PI * r * r * (2.0 * h + 4.0 / 3.0 * r),
        ),
        Shape::Cylinder {
            half_height: h,
            radius: r,
        } => (
            [*r, *h, *r],
            r.min(*h),
            ops::hypot(*h, *r),
            2.0 * PI * r * r * h,
        ),
        _ => return None,
    };
    let square = match &u.offset.rot {
        Rot::Quat(q) => *q == [0.0, 0.0, 0.0, 1.0],
        Rot::Deg(d) => *d == [0.0; 3],
    };
    // A declared mass is shared among a body's shapes by volume; else each weighs its density's.
    let material = u.material.as_ref().and_then(|m| w.contact_materials.get(m));
    let density = match b.mass {
        Some(_) => None,
        None => material.unwrap_or(&w.defaults).density,
    };
    Some(Part {
        at: u.offset.pos,
        half: if square { half } else { [bound; 3] },
        turns: square && !matches!(w.shapes[&u.shape], Shape::Sphere { .. }),
        thin,
        bound,
        weight: volume * density.unwrap_or(1.0),
        groups: (!u.sensor).then_some((u.member, u.collides)),
    })
}

/// A body as a step left it: its pose, its velocity and its fastest point's speed.
struct Seen {
    pos: V3,
    rot: [f64; 4],
    linear: V3,
    speed: f64,
}

/// What the lint reads of one body: its kind as a document writes it, its `ccd`, half its
/// thinnest extent, its centre of mass in its own frame, the farthest its shapes reach from it,
/// and its shapes.
struct Watched {
    kind: &'static str,
    ccd: bool,
    half: f64,
    com: V3,
    reach: f64,
    parts: Vec<Part>,
    last: Option<Seen>,
}

impl Watched {
    fn new(w: &World, b: &Body) -> Option<Self> {
        let kind = match b.kind {
            BodyKind::Dynamic => "dynamic",
            BodyKind::Kinematic => "kinematic",
            _ => return None,
        };
        let parts: Vec<Part> = (0..b.shapes.len()).filter_map(|i| part(w, b, i)).collect();
        let half = parts.iter().map(|p| p.thin).reduce(f64::min)?;
        let total = parts
            .iter()
            .map(|p| p.weight)
            .sum::<f64>()
            .max(f64::MIN_POSITIVE);
        let com = [0, 1, 2].map(|i| parts.iter().map(|p| p.weight * p.at[i]).sum::<f64>() / total);
        let far = |p: &Part| len([0, 1, 2].map(|i| p.at[i] - com[i])) + p.bound;
        Some(Watched {
            kind,
            ccd: b.ccd,
            half,
            com,
            reach: parts.iter().map(far).fold(0.0, f64::max),
            parts,
            last: None,
        })
    }

    /// Its solid shapes' bounds at `pos` and `rot`.
    fn bounds(&self, pos: V3, rot: [f64; 4]) -> Bounds {
        let axes = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]].map(|e| rotate(rot, e));
        let mut out = ([f64::INFINITY; 3], [f64::NEG_INFINITY; 3]);
        for p in self.parts.iter().filter(|p| p.groups.is_some()) {
            let c = rotate(rot, p.at);
            for i in 0..3 {
                let e = if p.turns {
                    (0..3).map(|j| axes[j][i].abs() * p.half[j]).sum()
                } else {
                    p.half[i]
                };
                out.0[i] = out.0[i].min(pos[i] + c[i] - e);
                out.1[i] = out.1[i].max(pos[i] + c[i] + e);
            }
        }
        out
    }

    /// The bounds it swept from `last` to `now`, and those it would have swept left alone: a body
    /// the solver stops at another ends the step touching it, its bounds short of the other's.
    fn swept(&self, last: &Seen, now: &Seen, dt: f64) -> Bounds {
        let (from, to) = (
            self.bounds(last.pos, last.rot),
            self.bounds(now.pos, now.rot),
        );
        let free = last.linear.map(|v| v * dt);
        (
            [0, 1, 2].map(|i| to.0[i].min(from.0[i] + free[i].min(0.0))),
            [0, 1, 2].map(|i| to.1[i].max(from.1[i] + free[i].max(0.0))),
        )
    }

    /// Whether a solid shape of it and one of `other` collide by their groups.
    fn collides(&self, other: &Watched) -> bool {
        let groups = |w: &Watched| w.parts.iter().filter_map(|p| p.groups).collect::<Vec<_>>();
        let theirs = groups(other);
        groups(self)
            .iter()
            .any(|a| theirs.iter().any(|b| a.0 & b.1 != 0 && b.0 & a.1 != 0))
    }
}

/// What one flagged body did first: the step, its fastest point's move over that step and half
/// its thinnest extent.
#[derive(Clone, Debug, PartialEq)]
pub struct Flag {
    pub step: u64,
    pub moved: f64,
    pub half: f64,
}

/// A planted lint (tests/acceptance/2239): one that reads only a body's move, never its turn; and
/// one that reads one body at a time, never a pair.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    MoveOnly,
    OneBody,
}

/// One body over a step: its ID, whether it came into the step fast, whether its move alone
/// made it so, and the bounds it swept.
struct Swept<'a> {
    id: &'a str,
    fast: bool,
    moves: bool,
    bounds: Bounds,
}

impl Swept<'_> {
    fn meets(&self, other: &Swept) -> bool {
        let (a, b) = (&self.bounds, &other.bounds);
        (0..3).all(|k| a.0[k] <= b.1[k] && b.0[k] <= a.1[k])
    }
}

/// The lint over one run, fed each body's state after each step.
#[derive(Default)]
pub struct FastBodies {
    sweep: Sweep,
    planted: Planted,
    /// A step's length, s.
    dt: f64,
    watched: BTreeMap<String, Watched>,
    /// Each fast body the sweep leaves unheld by itself: one with `ccd` off, or one no sweep
    /// starts from.
    pub flagged: BTreeMap<String, Flag>,
    /// Each pair no sweep holds and `ccd` on the fast one can't settle: the step their bounds
    /// met, and the body whose `ccd` to turn off, or none where both are fast.
    pairs: BTreeMap<(String, String), (u64, Option<String>)>,
    /// The pairs whose swept bounds met in the last step while one of the two was fast.
    meeting: BTreeSet<(String, String)>,
    /// The bodies that met another while one of the two was fast, and those that were the fast
    /// one where the other wasn't.
    met: BTreeSet<String>,
    alone: BTreeSet<String>,
}

impl FastBodies {
    pub fn new(w: &World, sweep: Sweep, planted: Planted) -> Self {
        let watched = w
            .bodies
            .iter()
            .filter_map(|(id, b)| Some((id.clone(), Watched::new(w, b)?)))
            .collect();
        FastBodies {
            sweep,
            planted,
            dt: 1.0 / w.step_rate,
            watched,
            ..FastBodies::default()
        }
    }

    /// The bodies after step `step`, each by its ID and its canonical values (`backend::FIELDS`).
    pub fn step<'a>(&mut self, step: u64, states: impl Iterator<Item = (&'a str, &'a [f32])>) {
        let sweep = self.sweep;
        // Each watched body over the step: whether it came into it fast, and how the last left it.
        let mut over = Vec::new();
        for (id, v) in states {
            let Some(b) = self.watched.get_mut(id) else {
                continue;
            };
            let at = |i: usize| [v[i], v[i + 1], v[i + 2]].map(f64::from);
            let (pos, rot) = (at(0), [3, 4, 5, 6].map(|i| f64::from(v[i])));
            let speed = len(at(7)) + len(at(10)) * b.reach;
            let linear = at(7);
            let Some(last) = b.last.replace(Seen {
                pos,
                rot,
                linear,
                speed,
            }) else {
                continue;
            };
            // A body that kept its pose moved nothing.
            let moved = if last.pos == pos && last.rot == rot {
                0.0
            } else {
                let (from, to) = (rotate(last.rot, b.com), rotate(rot, b.com));
                let turn = match self.planted {
                    Planted::MoveOnly => 0.0,
                    _ => turned(last.rot, rot) * b.reach,
                };
                len([0, 1, 2].map(|i| pos[i] + to[i] - last.pos[i] - from[i])) + turn
            };
            let starts = sweep.starts.contains(&b.kind);
            if moved > b.half && !(starts && b.ccd) && !self.flagged.contains_key(id) {
                let half = b.half;
                self.flagged.insert(id.into(), Flag { step, moved, half });
            }
            // A body a sweep starts from comes into a step as fast as the last one left it; a
            // kinematic one moves as its channel says.
            let entering = if starts { last.speed * self.dt } else { moved };
            let moves = len(last.linear) * self.dt > b.half;
            over.push((id, entering > b.half, moves, last));
        }
        // Bounds are read only in a step some body comes into fast, or while a meeting lasts.
        let fast = over.iter().any(|(_, fast, ..)| *fast);
        if self.planted == Planted::OneBody || !(fast || !self.meeting.is_empty()) {
            return;
        }
        let swept = over.iter().filter_map(|(id, fast, moves, last)| {
            let b = &self.watched[*id];
            let bounds = b.swept(last, b.last.as_ref()?, self.dt);
            Some(Swept {
                id,
                fast: *fast,
                moves: *moves,
                bounds,
            })
        });
        let swept: Vec<Swept> = swept.collect();
        // A meeting lasts while the two's bounds meet, whatever their speed.
        let at = |id: &String| swept.iter().find(|s| s.id == id);
        let lasts = |(a, b): &&(String, String)| at(a).zip(at(b)).is_some_and(|(a, b)| a.meets(b));
        let mut meeting: BTreeSet<_> = self.meeting.iter().filter(lasts).cloned().collect();
        for (i, a) in swept.iter().enumerate().filter(|(_, a)| a.fast) {
            for (j, b) in swept.iter().enumerate() {
                let (x, y) = (&self.watched[a.id], &self.watched[b.id]);
                // Two kinematic bodies never collide; nor do two whose groups keep them apart.
                let never = (x.kind != "dynamic" && y.kind != "dynamic") || !x.collides(y);
                // Two fast bodies are one pair, read from the first.
                if i == j || (b.fast && j < i) || never || !a.meets(b) {
                    continue;
                }
                let (a, b) = if i < j { (a, b) } else { (b, a) };
                let key = (a.id.to_string(), b.id.to_string());
                // A meeting is judged once, in the first step one of the two comes into fast.
                if meeting.insert(key) {
                    self.judge(step, &sweep, a, b);
                }
            }
        }
        self.meeting = meeting;
    }

    /// Whether the sweep, or a body's own contact prediction, holds the meeting of `a` and `b` in
    /// `step`, and the pair's issue where neither does and `ccd` on the fast one can't settle it.
    fn judge(&mut self, step: u64, sweep: &Sweep, a: &Swept, b: &Swept) {
        let (x, y) = (&self.watched[a.id], &self.watched[b.id]);
        let holds = |f: &Watched, ccd: bool, s: &Watched, s_ccd: bool, s_fast: bool| {
            sweep.holds((f.kind, ccd), (s.kind, s_ccd, s_fast))
        };
        // A body with `ccd` on predicts its contacts along its own move, never along its turn.
        let predicts = |f: &Swept, ccd: bool| sweep.predicts && ccd && f.moves;
        let key = (a.id.to_string(), b.id.to_string());
        self.met.extend([a.id.to_string(), b.id.to_string()]);
        if a.fast && b.fast {
            // Each body's prediction reaches its own move only, so two fast bodies need both.
            let held = holds(x, x.ccd, y, y.ccd, true)
                || holds(y, y.ccd, x, x.ccd, true)
                || (predicts(a, x.ccd) && predicts(b, y.ccd));
            if !held {
                self.pairs.entry(key).or_insert((step, None));
            }
            return;
        }
        let ((fast, f), (slow, s)) = if a.fast {
            ((a, x), (b, y))
        } else {
            ((b, y), (a, x))
        };
        self.alone.insert(fast.id.to_string());
        // Unheld, with `ccd` on the fast one settling nothing: its prediction doesn't reach, and
        // its sweep holds the other only once the other's `ccd` is off.
        let held = holds(f, f.ccd, s, s.ccd, false) || predicts(fast, f.ccd);
        if !held && !predicts(fast, true) && s.ccd && holds(f, true, s, false, false) {
            self.pairs
                .entry(key)
                .or_insert((step, Some(slow.id.to_string())));
        }
    }

    /// Whether `ccd` on flagged body `id` settles something: it met no body while one of the two
    /// was fast, or it was the fast one where the other wasn't.
    fn settles(&self, id: &str) -> bool {
        !self.met.contains(id) || self.alone.contains(id)
    }

    /// The lint's issues: one a flagged body, then one a pair.
    pub fn issues(&self) -> Vec<Value> {
        let starts = |id: &str| self.sweep.starts.contains(&self.watched[id].kind);
        let bodies = self.flagged.iter().filter(|(id, _)| !starts(id) || self.settles(id)).map(|(id, f)| {
            let moves = format!("body {id}'s fastest point moves {:.4} m in step {}, farther than {:.4} m, half its thinnest extent", f.moved, f.step, f.half);
            let mut issue = json!({"check": FAST_BODY, "code": FAST_BODY, "severity": "warning", "ids": [id], "path": format!("bodies/{id}/ccd"),
                                   "body": id, "step": f.step, "move": f.moved, "half_extent": f.half, "t": Value::Null,
                                   "what": format!("{moves}, with ccd off, so it can pass through a wall thinner than it"), "fix": fix(FAST_BODY)});
            if !starts(id) {
                let kind = self.watched[id.as_str()].kind;
                issue["kind"] = json!(kind);
                issue["severity"] = json!("error");
                issue["path"] = json!(format!("bodies/{id}/kind"));
                issue["what"] = json!(format!("{moves}, and no sweep starts from a {kind} body, so it passes through a body in its way"));
                issue["fix"] = json!(KINEMATIC_FIX);
            }
            issue
        });
        let pairs = self.pairs.iter().map(|((a, b), (step, off))| {
            let (path, what, fix) = match off {
                Some(id) => {
                    let fast = if id == a { b } else { a };
                    (format!("bodies/{id}/ccd"),
                     format!("bodies {a} and {b} meet in step {step}, where {fast} is fast by its turn and {id} has ccd on too, and no sweep holds a body that has ccd on, so {fast} can pass through {id}"),
                     format!("Turn {id}'s ccd off."))
                }
                None => ("step_rate".to_string(),
                         format!("bodies {a} and {b} meet in step {step}, both fast, where one has ccd off or is fast by its turn, and no sweep holds a body that is itself fast, so they can pass through each other"),
                         BOTH_FAST_FIX.to_string()),
            };
            json!({"check": FAST_BODY, "code": FAST_BODY, "kind": "pair", "severity": "error", "ids": [a, b], "path": path,
                   "step": step, "t": Value::Null, "what": what, "fix": fix})
        });
        bodies.chain(pairs).collect()
    }
}

/// `doc` with `ccd: true` on each flagged body that leaves `ccd` unset, with one assumption row a
/// body; with `leave_off` (a planted recipe) none is set, and the rows still say they were.
pub fn expand(
    doc: &Value,
    flagged: &BTreeMap<String, Flag>,
    leave_off: bool,
) -> (Value, Vec<Value>) {
    let mut out = doc.clone();
    let mut rows = Vec::new();
    for (id, f) in flagged {
        let Some(b) = out.pointer_mut(&format!("/bodies/{id}")) else {
            continue;
        };
        if b.get("ccd").is_some() {
            continue;
        }
        if !leave_off {
            b["ccd"] = json!(true);
        }
        let reason = format!("{FAST_BODY}: {id} moves {:.4} m in step {}, farther than half its thinnest extent ({:.4} m), so ccd is on, or it could pass through a thin wall", f.moved, f.step, f.half);
        rows.push(json!({"body": id, "field": "ccd", "value": true, "step": f.step, "move": f.moved, "half_extent": f.half, "reason": reason}));
    }
    (out, rows)
}

/// The refusal of an expansion that leaves a body its source left unset, and its bake flagged,
/// with `ccd` off, naming the body.
pub fn refused(source: &Value, expanded: &Value, flagged: &BTreeMap<String, Flag>) -> Vec<Value> {
    flagged
        .keys()
        .filter(|id| source.pointer(&format!("/bodies/{id}/ccd")).is_none())
        .filter(|id| expanded.pointer(&format!("/bodies/{id}/ccd")) != Some(&json!(true)))
        .map(|id| {
            let what = format!("body {id} is flagged by {FAST_BODY} and leaves ccd unset, and the expansion left its ccd off, so it would pass through a thin wall");
            json!({"check": "document.validate", "code": FAST_BODY, "severity": "error", "ids": [id], "path": format!("bodies/{id}/ccd"),
                   "body": id, "actual": expanded.pointer(&format!("/bodies/{id}/ccd")), "t": Value::Null, "what": what, "fix": fix(FAST_BODY)})
        })
        .collect()
}
