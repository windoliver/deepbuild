//! #853: the operators a stepped particles item lowers to, each within a compute operator's 8
//! fetches and 256 steps. Without `spacing` one operator moves each particle and keeps the
//! buffer. With it, five run a step: `top` (each grain at rest raises its column's top), `ground`
//! (each column's level: its grains' top, or the ground under it), `move` (each particle's
//! motion), `plan` (a grain in flight's wish to land, a top grain's move to a lower column) and
//! the item's own, which settles the wishes and keeps the buffer.

use serde_json::{json, Map, Value};

use super::super::spec::Turbulence;
use super::super::turbulence;
use super::{
    lattice, readings_op, rows_op, Collider, Lattice, Planted, Spec, BUFFER, COUNTS, ROW, ROWS,
};
use crate::shipped::{set_when, G};

/// How far off a face a stopped particle is set, m.
const SKIN: f64 = 1e-4;
/// The speed a grain in flight takes in place of exactly none, m/s: at rest is all zeros.
const NUDGE: f64 = 1.0 / 1_048_576.0;
const FAR: f64 = 1e30;
/// The age word of a particle an occurrence killed, and the velocity that marks one between a
/// step's operators.
const KILLED: f64 = -2.0;
const MARK: f64 = 3e38;
/// The steps a centroid reading counts a place in across its box.
pub(super) const QUANTA: f64 = 4095.0;
/// A particle's state word after its motion: live; at rest and not pushed; in flight since the
/// step before; stopped on a face from above; and from bit 8 that face's level.
const LIVE: u32 = 1;
const RESTS: u32 = 2;
const FLIES: u32 = 4;
const FLOOR: u32 = 8;
/// A plan word's kind (to land, to stand on the paired column's top, to fly into it), whether
/// the paired column is the one further along, and the level it names.
const LAND: u32 = 1 << 30;
const PLACE: u32 = 2 << 30;
const HOP: u32 = 3 << 30;
const FURTHER: u32 = 1 << 29;
const LEVEL: u32 = FURTHER - 1;

fn v3j(v: [f64; 3]) -> Value {
    json!([v[0], v[1], v[2]])
}

fn u(g: &mut G, n: u32) -> String {
    g.ty(json!(n), "u32")
}

fn no(g: &mut G) -> String {
    g.ty(json!(false), "bool")
}

/// A vec3 read from `buf` at word `first` of the particle's `stride` words.
fn read3(g: &mut G, buf: &str, e: &str, stride: u32, first: u32) -> String {
    let base = g.s("mul@1", json!({"a": e, "b": stride}));
    let lanes: Vec<String> = (0..3)
        .map(|j| {
            let i = g.s("add@1", json!({"a": base, "b": first + j}));
            g.s("read@1", json!({"buf": buf, "i": i}))
        })
        .collect();
    g.s(
        "compose@1",
        json!({"x": lanes[0], "y": lanes[1], "z": lanes[2]}),
    )
}

fn read1(g: &mut G, buf: &str, e: &str, stride: u32, at: u32) -> String {
    let base = g.s("mul@1", json!({"a": e, "b": stride}));
    let i = g.s("add@1", json!({"a": base, "b": at}));
    g.s("read@1", json!({"buf": buf, "i": i}))
}

/// The first word of element `e`'s `stride` words of a buffer.
fn slot(g: &mut G, e: &str, stride: u32) -> String {
    g.s("mul@1", json!({"a": e, "b": stride}))
}

/// Writes `v` at word `at` of the element whose first word is `slot`.
fn write1(g: &mut G, buf: &str, slot: &str, at: u32, v: &str) {
    let i = g.s("add@1", json!({"a": slot, "b": at}));
    g.s("write@1", json!({"buf": buf, "i": i, "v": v}));
}

fn write3(g: &mut G, buf: &str, slot: &str, first: u32, v: &str) {
    for (j, lane) in ["x", "y", "z"].iter().enumerate() {
        let x = g.split(v, lane);
        write1(g, buf, slot, first + j as u32, &x);
    }
}

/// The lanes of a vec3 that `axis` (0, 1 or 2) names.
fn lanes_of(g: &mut G, axis: &str) -> String {
    let axes = g.ty(json!([0.0, 1.0, 2.0]), "vec3<f32>");
    g.s("eq@1", json!({"a": axes, "b": axis}))
}

/// [`lanes_of`] `axis` where `on`, else none.
fn mask(g: &mut G, axis: &str, on: &str) -> String {
    let named = g.s("select@1", json!({"f": -1.0, "t": axis, "cond": on}));
    lanes_of(g, &named)
}

/// The first of a vec3's lanes that holds the least (`least`) or the most, as 0, 1 or 2.
fn pick(g: &mut G, v: &str, least: bool) -> String {
    let (x, y, z) = (g.split(v, "x"), g.split(v, "y"), g.split(v, "z"));
    let op = if least { "le@1" } else { "ge@1" };
    let xy = g.s(op, json!({"a": x, "b": y}));
    let xz = g.s(op, json!({"a": x, "b": z}));
    let first = g.s("and@1", json!({"a": xy, "b": xz}));
    let yz = g.s(op, json!({"a": y, "b": z}));
    let rest = g.s("select@1", json!({"f": 2.0, "t": 1.0, "cond": yz}));
    g.s("select@1", json!({"f": rest, "t": 0.0, "cond": first}))
}

/// Whether `word` holds `bit`.
fn has(g: &mut G, word: &str, bit: u32) -> String {
    let b = u(g, bit);
    let held = g.s("and@1", json!({"a": word, "b": b}));
    g.s("ne@1", json!({"a": held, "b": 0}))
}

/// What the lowering knows while it writes one operator's steps.
struct Ctx<'a> {
    id: &'a str,
    s: &'a Spec,
    boxes: &'a [Collider],
    lat: Option<Lattice>,
    seed: u32,
    planted: Planted,
}

/// One particle's read of the step: who it is, whether it is live and was, its age and the
/// step's length.
struct Who {
    e: String,
    live: String,
    was: String,
    age: String,
    dt: String,
    now: String,
    before: String,
    /// Where it is born: the emitter, or the occurrence its burst answers.
    origin: String,
}

/// What the boxes did to a move.
struct Met {
    q: String,
    pushed: String,
    pushed_axis: String,
    pushed_by: String,
    hit: String,
    hit_axis: String,
    /// Stopped on a face from above; and that face's height.
    up: String,
    face_y: String,
}

/// A particle after its motion: where it is, its velocity, whether it stays at rest, and what
/// the boxes did to its move.
struct Moved {
    q: String,
    v: String,
    rests: String,
    met: Met,
    /// Whether it is live after the step, and whether an occurrence has killed it.
    live: String,
    killed: Option<String>,
}

impl Ctx<'_> {
    fn words(&self) -> u32 {
        self.s.count * self.s.stride()
    }

    /// The step index, each kinematic box's centre at the step's time and, with `prev`, the
    /// buffer as the step before left it.
    fn inputs(&self, prev: bool, boxes: bool) -> Map<String, Value> {
        let mut m = Map::new();
        if prev {
            m.insert(
                "prev".into(),
                json!({"type": "f32", "count": self.words(),
                "from": {"storage": {"op": self.id, "output": BUFFER, "step": "previous"}}}),
            );
        }
        m.insert("k".into(), json!({"type": "u32", "from": {"time": "step"}}));
        for (j, b) in self.boxes.iter().enumerate().filter(|_| boxes) {
            if let Some(path) = &b.follow {
                for a in 0..3 {
                    m.insert(
                        format!("c{j}_{a}"),
                        json!({"type": "f32", "default": b.centre[a],
                        "from": {"channel": format!("{path}/{a}")}}),
                    );
                }
            }
        }
        m
    }

    fn from(&self, op: &str, output: &str, ty: &str, count: u32) -> Value {
        json!({"type": ty, "count": count, "from": {"storage": {"op": format!("{}.{op}", self.id), "output": output}}})
    }

    /// A stepped operator item of this particles item.
    fn op(
        &self,
        id: String,
        about: &str,
        inputs: Map<String, Value>,
        g: G,
        outputs: Value,
        elements: u32,
    ) -> (String, Value) {
        let params = json!({
            "about": about, "origin": "shipped", "inputs": inputs, "steps": g.done(), "outputs": outputs,
            "elements": elements, "workgroup": 256, "determinism": "same_machine",
            "stepped": {"rate": self.s.rate},
        });
        let item = json!({"id": id, "kind": "gpu.compute@1", "lowered": self.id, "params": params});
        (id, item)
    }

    /// The step's time, the particle's birth time, and what follows from them: bursts take the
    /// first slots in the order written, then the emitter's k-th particle is born k ÷ rate s in.
    fn who(&self, g: &mut G) -> Who {
        let s = self.s;
        let e = g.s("element@1", json!({}));
        let fi = g.convert(&e, "f32");
        let kf = g.convert("k", "f32");
        let step = 1.0 / f64::from(s.rate);
        let (now, dt, before) = if self.planted.by_frame_time {
            let now = g.s("t@1", json!({}));
            let frames = g.s("max@1", json!({"a": kf, "b": 1.0}));
            let dt = g.div(&now, &frames);
            let before = g.sub(&now, &dt);
            (now, dt, before)
        } else {
            let k1 = g.s("sub@1", json!({"a": kf, "b": 1.0}));
            (g.mulk(&kf, step), g.c(json!(step)), g.mulk(&k1, step))
        };
        // Timed births take the first slots: the stated bursts at the emitter, then each
        // occurrence's at its point, one repeat over them all.
        let stated = s.bursts.iter().map(|b| (b.0, b.1, s.at));
        let timed: Vec<(f64, u32, [f64; 3])> = stated
            .chain(s.births.iter().map(|b| (b.t, b.count, b.point)))
            .collect();
        let first: u32 = timed.iter().map(|b| b.1).sum::<u32>().min(s.count);
        let (mut time, mut origin) = (g.c(json!(FAR)), g.ty(v3j(s.at), "vec3<f32>"));
        if !timed.is_empty() {
            let n = timed.len();
            let mut ends = Vec::new();
            for b in &timed {
                let from = ends.last().copied().unwrap_or(0.0);
                ends.push((from + f64::from(b.1)).min(f64::from(s.count)));
            }
            let starts: Vec<f64> = [0.0]
                .into_iter()
                .chain(ends.iter().copied())
                .take(n)
                .collect();
            let times: Vec<f64> = timed.iter().map(|b| b.0).collect();
            let scalars = format!("array<f32, {n}>");
            let (lo, hi) = (g.ty(json!(starts), &scalars), g.ty(json!(ends), &scalars));
            let at = g.ty(json!(times), &scalars);
            let points = Value::Array(timed.iter().map(|b| v3j(b.2)).collect());
            let points = g.ty(points, &format!("array<vec3<f32>, {n}>"));
            let mut b = G::named("e");
            let from = b.s("index@1", json!({"a": lo, "i": "e_i"}));
            let to = b.s("index@1", json!({"a": hi, "i": "e_i"}));
            let past = b.s("ge@1", json!({"a": fi, "b": from}));
            let short = b.s("lt@1", json!({"a": fi, "b": to}));
            let mine = b.s("and@1", json!({"a": past, "b": short}));
            let t = b.s("index@1", json!({"a": at, "i": "e_i"}));
            let point = b.s("index@1", json!({"a": points, "i": "e_i"}));
            b.named_step(
                "e_time",
                "select@1",
                json!({"f": "e_time", "t": t, "cond": mine}),
            );
            b.named_step(
                "e_from",
                "select@1",
                json!({"f": "e_from", "t": point, "cond": mine}),
            );
            let rep = g.s(
                "repeat@1",
                json!({"count": n, "index": "e_i", "accumulate": {
                "e_time": {"type": "f32", "init": FAR},
                "e_from": {"type": "vec3<f32>", "init": v3j(s.at)},
            }, "body": b.done()}),
            );
            (time, origin) = (format!("{rep}.e_time"), format!("{rep}.e_from"));
        }
        let emitted = (s.emit_rate * s.span)
            .floor()
            .min(f64::from(s.count - first));
        if emitted > 0.0 {
            let ie = g.s("sub@1", json!({"a": fi, "b": f64::from(first)}));
            let tr = g.s("div@1", json!({"a": ie, "b": s.emit_rate}));
            let lo = g.s("ge@1", json!({"a": ie, "b": 0.0}));
            let hi = g.s("lt@1", json!({"a": ie, "b": emitted}));
            let ok = g.s("and@1", json!({"a": lo, "b": hi}));
            time = g.select(&time, &tr, &ok);
        }
        let age = g.sub(&now, &time);
        let mut live = g.s("ge@1", json!({"a": now, "b": time}));
        let ran = g.s("gt@1", json!({"a": "k", "b": 0}));
        let born = g.s("ge@1", json!({"a": before, "b": time}));
        let mut was = g.s("and@1", json!({"a": born, "b": ran}));
        if let Some(life) = s.life {
            let young = g.s("lt@1", json!({"a": age, "b": life}));
            live = g.s("and@1", json!({"a": live, "b": young}));
            let age1 = g.sub(&before, &time);
            let young1 = g.s("lt@1", json!({"a": age1, "b": life}));
            was = g.s("and@1", json!({"a": was, "b": young1}));
        }
        Who {
            e,
            live,
            was,
            age,
            dt,
            now,
            before,
            origin,
        }
    }

    /// The move from `p` to `q0` against every box, as one repeat over them: a `p` inside a box
    /// is set on its nearest face; else the move stops at the first face it would cross. Under
    /// the planted end test only `q0` is tested, and a `q0` inside is set on the nearest face.
    fn meet(&self, g: &mut G, prefix: &'static str, p: &str, q0: &str) -> Met {
        if self.boxes.is_empty() {
            let zero = g.c(json!(0.0));
            let never = no(g);
            return Met {
                q: q0.to_string(),
                pushed: never.clone(),
                pushed_axis: zero.clone(),
                pushed_by: zero.clone(),
                hit: never.clone(),
                hit_axis: zero.clone(),
                up: never,
                face_y: zero,
            };
        }
        // A repeat's accumulators and index carry its prefix: an operator may hold two.
        let acc = |name: &str| format!("{prefix}_{name}");
        let n = self.boxes.len();
        let from = if self.planted.collide_at_end { q0 } else { p };
        let m = g.sub(q0, from);
        let ty = format!("array<vec3<f32>, {n}>");
        let cs = g.ty(
            Value::Array(self.boxes.iter().map(|b| v3j(b.centre)).collect()),
            &ty,
        );
        let hs = g.ty(
            Value::Array(self.boxes.iter().map(|b| v3j(b.half)).collect()),
            &ty,
        );
        let moving: Vec<(usize, String)> = (self.boxes.iter().enumerate())
            .filter(|(_, b)| b.follow.is_some())
            .map(|(j, _)| {
                let c =
                    json!({"x": format!("c{j}_0"), "y": format!("c{j}_1"), "z": format!("c{j}_2")});
                (j, g.s("compose@1", c))
            })
            .collect();
        let i = acc("i");
        let mut b = G::named(prefix);
        let mut c = b.s("index@1", json!({"a": cs, "i": i}));
        for (j, at) in &moving {
            let is = b.s("eq@1", json!({"a": i, "b": j}));
            c = b.select(&c, at, &is);
        }
        let h = b.s("index@1", json!({"a": hs, "i": i}));
        // Inside: out through the nearest face.
        let r = b.sub(from, &c);
        let ar = b.s("abs@1", json!({"x": r}));
        let within = b.s("lt@1", json!({"a": ar, "b": h}));
        let inside = b.s("all@1", json!({"x": within}));
        let depth = b.sub(&h, &ar);
        let axis = pick(&mut b, &depth, true);
        let on = lanes_of(&mut b, &axis);
        let side = b.s("ge@1", json!({"a": r, "b": 0.0}));
        let sign = b.s(
            "select@1",
            json!({"f": [-1.0, -1.0, -1.0], "t": [1.0, 1.0, 1.0], "cond": side}),
        );
        let reach = b.s("add@1", json!({"a": h, "b": SKIN}));
        let out = b.mul(&sign, &reach);
        let face = b.add(&c, &out);
        let set = b.select(from, &face, &on);
        let gap = b.sub(&face, from);
        let along = b.s(
            "select@1",
            json!({"f": [0.0, 0.0, 0.0], "t": gap, "cond": on}),
        );
        let by = b.s("dot@1", json!({"a": along, "b": [1.0, 1.0, 1.0]}));
        let new = b.s("not@1", json!({"x": acc("found")}));
        let take = b.s("and@1", json!({"a": inside, "b": new}));
        b.named_step(
            &acc("set"),
            "select@1",
            json!({"f": acc("set"), "t": set, "cond": take}),
        );
        b.named_step(
            &acc("axis"),
            "select@1",
            json!({"f": acc("axis"), "t": axis, "cond": take}),
        );
        b.named_step(
            &acc("by"),
            "select@1",
            json!({"f": acc("by"), "t": by, "cond": take}),
        );
        b.named_step(
            &acc("found"),
            "or@1",
            json!({"a": acc("found"), "b": inside}),
        );
        // The sweep: where the move enters the box's three slabs.
        let still = b.s("eq@1", json!({"a": m, "b": 0.0}));
        let ms = b.s(
            "select@1",
            json!({"f": m, "t": [1.0, 1.0, 1.0], "cond": still}),
        );
        let (lo, hi) = (b.sub(&c, &h), b.add(&c, &h));
        let dl = b.sub(&lo, from);
        let dh = b.sub(&hi, from);
        let (ta, tb) = (b.div(&dl, &ms), b.div(&dh, &ms));
        let near = b.s("min@1", json!({"a": ta, "b": tb}));
        let far = b.s("max@1", json!({"a": ta, "b": tb}));
        let near = b.s(
            "select@1",
            json!({"f": near, "t": [-FAR, -FAR, -FAR], "cond": still}),
        );
        let far = b.s(
            "select@1",
            json!({"f": far, "t": [FAR, FAR, FAR], "cond": still}),
        );
        let under = b.s("le@1", json!({"a": from, "b": lo}));
        let over = b.s("ge@1", json!({"a": from, "b": hi}));
        let outside = b.s("or@1", json!({"a": under, "b": over}));
        let beside = b.s("and@1", json!({"a": still, "b": outside}));
        let misses = b.s("any@1", json!({"x": beside}));
        let entry = pick(&mut b, &near, false);
        let (nx, ny, nz) = (
            b.split(&near, "x"),
            b.split(&near, "y"),
            b.split(&near, "z"),
        );
        let t0 = b.s("max@1", json!({"a": nx, "b": ny}));
        let t0 = b.s("max@1", json!({"a": t0, "b": nz}));
        let (fx, fy, fz) = (b.split(&far, "x"), b.split(&far, "y"), b.split(&far, "z"));
        let t1 = b.s("min@1", json!({"a": fx, "b": fy}));
        let t1 = b.s("min@1", json!({"a": t1, "b": fz}));
        let t1 = b.s("min@1", json!({"a": t1, "b": 1.0}));
        let crosses = b.s("le@1", json!({"a": t0, "b": t1}));
        let ahead = b.s("ge@1", json!({"a": t0, "b": 0.0}));
        let sooner = b.s("lt@1", json!({"a": t0, "b": acc("when")}));
        let met = b.s("not@1", json!({"x": misses}));
        let met = b.s("and@1", json!({"a": met, "b": crosses}));
        let met = b.s("and@1", json!({"a": met, "b": ahead}));
        let met = b.s("and@1", json!({"a": met, "b": sooner}));
        b.named_step(
            &acc("when"),
            "select@1",
            json!({"f": acc("when"), "t": t0, "cond": met}),
        );
        b.named_step(
            &acc("entry"),
            "select@1",
            json!({"f": acc("entry"), "t": entry, "cond": met}),
        );
        let mut accumulate = Map::new();
        accumulate.insert(acc("found"), json!(false));
        accumulate.insert(
            acc("set"),
            json!({"type": "vec3<f32>", "init": [0.0, 0.0, 0.0]}),
        );
        for (name, init) in [("axis", 0.0), ("by", 0.0), ("when", 2.0), ("entry", 0.0)] {
            accumulate.insert(acc(name), json!({"type": "f32", "init": init}));
        }
        let rep = g.s(
            "repeat@1",
            json!({"count": n, "index": i, "accumulate": accumulate, "body": b.done()}),
        );
        let out = |name: &str| format!("{rep}.{}", acc(name));
        let (found, set, axis, by) = (out("found"), out("set"), out("axis"), out("by"));
        if self.planted.collide_at_end {
            let q = g.select(q0, &set, &found);
            let is_y = g.s("eq@1", json!({"a": axis, "b": 1.0}));
            let rose = g.s("gt@1", json!({"a": by, "b": 0.0}));
            let up = g.s("and@1", json!({"a": is_y, "b": rose}));
            let up = g.s("and@1", json!({"a": up, "b": found}));
            let y = g.split(&set, "y");
            let face_y = g.s("sub@1", json!({"a": y, "b": SKIN}));
            let zero = g.c(json!(0.0));
            return Met {
                q,
                pushed: no(g),
                pushed_axis: zero.clone(),
                pushed_by: zero,
                hit: found,
                hit_axis: axis,
                up,
                face_y,
            };
        }
        let (when, entry) = (out("when"), out("entry"));
        let reached = g.s("le@1", json!({"a": when, "b": 1.0}));
        let free = g.s("not@1", json!({"x": found}));
        let hit = g.s("and@1", json!({"a": reached, "b": free}));
        let travel = g.mul(&m, &when);
        let stop = g.add(p, &travel);
        let on = lanes_of(g, &entry);
        let way = g.s("sign@1", json!({"x": m}));
        let back = g.s(
            "select@1",
            json!({"f": [0.0, 0.0, 0.0], "t": way, "cond": on}),
        );
        let back = g.mulk(&back, SKIN);
        let stop = g.sub(&stop, &back);
        let q = g.select(q0, &stop, &hit);
        let q = g.select(&q, &set, &found);
        let my = g.split(&m, "y");
        let down = g.s("lt@1", json!({"a": my, "b": 0.0}));
        let is_y = g.s("eq@1", json!({"a": entry, "b": 1.0}));
        let up = g.s("and@1", json!({"a": hit, "b": is_y}));
        let up = g.s("and@1", json!({"a": up, "b": down}));
        let y = g.split(&stop, "y");
        let face_y = g.s("sub@1", json!({"a": y, "b": SKIN}));
        Met {
            q,
            pushed: found,
            pushed_axis: axis,
            pushed_by: by,
            hit,
            hit_axis: entry,
            up,
            face_y,
        }
    }

    /// The column a place stands in: whether the lattice holds it, its index, and its indices
    /// across x and z.
    fn column(&self, g: &mut G, x: &str, z: &str) -> (String, String, String, String) {
        let l = self.lat.expect("a lattice");
        let (gx, gz) = (f64::from(l.g[0]), f64::from(l.g[1]));
        let at = g.s("compose@1", json!({"x": x, "y": z}));
        let rel = g.s("sub@1", json!({"a": at, "b": [l.lo[0], l.lo[2]]}));
        let cell = g.s("div@1", json!({"a": rel, "b": l.d}));
        let f = g.s("floor@1", json!({"x": cell}));
        let lo_ok = g.s("ge@1", json!({"a": f, "b": 0.0}));
        let hi_ok = g.s("lt@1", json!({"a": f, "b": [gx, gz]}));
        let ok = g.s("and@1", json!({"a": lo_ok, "b": hi_ok}));
        let ok = g.s("all@1", json!({"x": ok}));
        let held = g.s("max@1", json!({"a": f, "b": 0.0}));
        let held = g.s("min@1", json!({"a": held, "b": [gx - 1.0, gz - 1.0]}));
        let cells = g.convert(&held, "vec2<u32>");
        let (ix, iz) = (g.split(&cells, "x"), g.split(&cells, "y"));
        let row = g.s("mul@1", json!({"a": iz, "b": l.g[0]}));
        let c = g.add(&ix, &row);
        (ok, c, ix, iz)
    }

    /// The level a height stands in, from 0.
    fn level(&self, g: &mut G, y: &str) -> String {
        let l = self.lat.expect("a lattice");
        let rel = g.s("sub@1", json!({"a": y, "b": l.lo[1]}));
        let cell = g.s("div@1", json!({"a": rel, "b": l.d}));
        let f = g.s("floor@1", json!({"x": cell}));
        let f = g.s("max@1", json!({"a": f, "b": 0.0}));
        g.convert(&f, "u32")
    }

    /// Where a grain rests in column (ix, iz) at `level`: the cell's middle, shifted a quarter
    /// cell at most across x and z by the particle's own hash.
    fn rest(&self, g: &mut G, e: &str, ix: &str, iz: &str, level: &str) -> String {
        let l = self.lat.expect("a lattice");
        let seed = u(g, self.seed);
        let shift = |g: &mut G, salt: u32| {
            let h = g.s("hash@1", json!({"a": seed, "b": e, "c": salt}));
            g.s("rand@1", json!({"key": h}))
        };
        let (rx, rz) = (shift(g, 11), shift(g, 12));
        let (fx, fy, fz) = (
            g.convert(ix, "f32"),
            g.convert(level, "f32"),
            g.convert(iz, "f32"),
        );
        let cell = g.s("compose@1", json!({"x": fx, "y": fy, "z": fz}));
        // 0.25 + r ÷ 2 across, the middle (0.5) in height.
        let part = g.s("compose@1", json!({"x": rx, "y": 0.5, "z": rz}));
        let part = g.mulk(&part, 0.5);
        let part = g.s("add@1", json!({"a": part, "b": 0.25}));
        let at = g.add(&cell, &part);
        let at = g.mulk(&at, l.d);
        g.s("add@1", json!({"a": at, "b": v3j(l.lo)}))
    }

    /// The middle height of `level`.
    fn height(&self, g: &mut G, level: &str) -> String {
        let l = self.lat.expect("a lattice");
        let f = g.convert(level, "f32");
        let mid = g.s("add@1", json!({"a": f, "b": 0.5}));
        let at = g.mulk(&mid, l.d);
        g.s("add@1", json!({"a": at, "b": l.lo[1]}))
    }

    /// The pull of the item's attractors at `p`: each toward its point at its strength.
    fn attract(&self, g: &mut G, p: &str) -> String {
        let n = self.s.attractors.len();
        let points = Value::Array(self.s.attractors.iter().map(|a| v3j(a.0)).collect());
        let points = g.ty(points, &format!("array<vec3<f32>, {n}>"));
        let pulls: Vec<f64> = self.s.attractors.iter().map(|a| a.1).collect();
        let pulls = g.ty(json!(pulls), &format!("array<f32, {n}>"));
        let mut b = G::named("a");
        let at = b.s("index@1", json!({"a": points, "i": "a_i"}));
        let k = b.s("index@1", json!({"a": pulls, "i": "a_i"}));
        let to = b.sub(&at, p);
        let far = b.s("length@1", json!({"x": to}));
        let far = b.s("max@1", json!({"a": far, "b": 1e-6}));
        let dir = b.div(&to, &far);
        let pull = b.mul(&dir, &k);
        b.named_step("a_sum", "add@1", json!({"a": "a_sum", "b": pull}));
        let rep = g.s(
            "repeat@1",
            json!({"count": n, "index": "a_i", "accumulate": {
            "a_sum": {"type": "vec3<f32>", "init": [0.0, 0.0, 0.0]},
        }, "body": b.done()}),
        );
        format!("{rep}.a_sum")
    }

    /// The particle's drift, m/s, along its path of the closed form's curl-noise table: the
    /// path's rate over the segment its age stands in, none past the table's travel.
    fn drift(&self, g: &mut G, w: &Who, t: &Turbulence) -> String {
        let table = turbulence::build(t, self.seed, false);
        let (n, last) = (table.steps as usize, f64::from(table.steps - 1));
        let rates = |path: usize| {
            let row = &table.offsets[path * n..(path + 1) * n];
            let per = last / table.travel * t.strength;
            let of = |k: usize| v3j(std::array::from_fn(|a| (row[k + 1][a] - row[k][a]) * per));
            Value::Array((0..n - 1).map(of).collect())
        };
        let ty = format!("array<vec3<f32>, {}>", n - 1);
        let (r0, r1) = (g.ty(rates(0), &ty), g.ty(rates(1), &ty));
        let at = g.s("mul@1", json!({"a": w.age, "b": last / table.travel}));
        let within = g.s("lt@1", json!({"a": at, "b": last}));
        let seg = g.s("clamp@1", json!({"x": at, "lo": 0.0, "hi": last - 1.0}));
        let seg = g.s("floor@1", json!({"x": seg}));
        let seg = g.convert(&seg, "u32");
        let seed = u(g, self.seed);
        let h = g.s("hash@1", json!({"a": seed, "b": w.e, "c": 13}));
        let odd = has(g, &h, 1);
        let (a, b) = (
            g.s("index@1", json!({"a": r0, "i": seg})),
            g.s("index@1", json!({"a": r1, "i": seg})),
        );
        let rate = g.select(&a, &b, &odd);
        g.s(
            "select@1",
            json!({"f": [0.0, 0.0, 0.0], "t": rate, "cond": within}),
        )
    }

    /// The item's planes as two arrays: each unit normal, and its offset along it.
    fn plane_arrays(&self, g: &mut G) -> (String, String) {
        let n = self.s.planes.len();
        let normals = Value::Array(self.s.planes.iter().map(|p| v3j(p.normal)).collect());
        let normals = g.ty(normals, &format!("array<vec3<f32>, {n}>"));
        let offsets: Vec<f64> = self.s.planes.iter().map(|p| p.offset).collect();
        (normals, g.ty(json!(offsets), &format!("array<f32, {n}>")))
    }

    /// A place and a velocity against the item's planes: behind a plane, the place is set back
    /// on it and the velocity loses its part into it and gets `restitution` of that back. Also
    /// whether a plane that faces up caught it, and that plane's height there.
    fn planes_from(&self, g: &mut G, q: &str, v: &str) -> (String, String, String, String) {
        let (normals, offsets) = self.plane_arrays(g);
        let mut b = G::named("p");
        let n = b.s("index@1", json!({"a": normals, "i": "p_i"}));
        let o = b.s("index@1", json!({"a": offsets, "i": "p_i"}));
        let along = b.s("dot@1", json!({"a": "p_q", "b": n}));
        let d = b.sub(&along, &o);
        let behind = b.s("lt@1", json!({"a": d, "b": SKIN}));
        let lift = b.s("sub@1", json!({"a": SKIN, "b": d}));
        let lift = b.mul(&n, &lift);
        let set = b.add("p_q", &lift);
        let vn = b.s("dot@1", json!({"a": "p_v", "b": n}));
        let into = b.s("lt@1", json!({"a": vn, "b": 0.0}));
        let turns = b.s("and@1", json!({"a": behind, "b": into}));
        let back = b.mulk(&vn, 1.0 + self.s.restitution);
        let back = b.mul(&n, &back);
        let left = b.sub("p_v", &back);
        let ny = b.split(&n, "y");
        let faces = b.s("gt@1", json!({"a": ny, "b": 0.999}));
        let caught = b.s("and@1", json!({"a": behind, "b": faces}));
        let y = b.split(&set, "y");
        let y = b.s("sub@1", json!({"a": y, "b": SKIN}));
        b.named_step(
            "p_y",
            "select@1",
            json!({"f": "p_y", "t": y, "cond": caught}),
        );
        b.named_step("p_up", "or@1", json!({"a": "p_up", "b": caught}));
        b.named_step(
            "p_q",
            "select@1",
            json!({"f": "p_q", "t": set, "cond": behind}),
        );
        b.named_step(
            "p_v",
            "select@1",
            json!({"f": "p_v", "t": left, "cond": turns}),
        );
        let rep = g.s(
            "repeat@1",
            json!({"count": self.s.planes.len(), "index": "p_i", "accumulate": {
            "p_q": {"type": "vec3<f32>", "init": q}, "p_v": {"type": "vec3<f32>", "init": v},
            "p_up": false, "p_y": {"type": "f32", "init": 0.0},
        }, "body": b.done()}),
        );
        let out = |name: &str| format!("{rep}.{name}");
        (out("p_q"), out("p_v"), out("p_up"), out("p_y"))
    }

    /// One step's motion of the particle: its place and velocity after births, forces, the
    /// boxes and the planes, whether it stays at rest, and whether an occurrence killed it.
    fn motion(&self, g: &mut G, w: &Who) -> Moved {
        let s = self.s;
        let p = read3(g, "prev", &w.e, s.stride(), 0);
        let v = read3(g, "prev", &w.e, s.stride(), 3);
        let resting = match self.lat {
            Some(_) => {
                let zero = g.s("eq@1", json!({"a": v, "b": 0.0}));
                let stopped = g.s("all@1", json!({"x": zero}));
                g.s("and@1", json!({"a": stopped, "b": w.was}))
            }
            None => no(g),
        };
        let mut acc = g.ty(v3j(s.gravity), "vec3<f32>");
        if s.drag != 0.0 {
            let slow = g.mulk(&v, s.drag);
            acc = g.sub(&acc, &slow);
        }
        if !s.attractors.is_empty() {
            let pull = self.attract(g, &p);
            acc = g.add(&acc, &pull);
        }
        let dv = g.mul(&acc, &w.dt);
        let v1 = g.add(&v, &dv);
        let v1 = g.select(&v1, &v, &resting);
        let mut along = v1.clone();
        if let Some(t) = &s.turbulence {
            let drift = self.drift(g, w, t);
            let drift = g.s(
                "select@1",
                json!({"f": drift, "t": [0.0, 0.0, 0.0], "cond": resting}),
            );
            along = g.add(&v1, &drift);
        }
        let dp = g.mul(&along, &w.dt);
        let q0 = g.add(&p, &dp);
        let mut met = self.meet(g, "b", &p, &q0);
        let mut v2 = v1.clone();
        if !self.boxes.is_empty() {
            // Pushed out of a box, it leaves at the speed the push took it; stopped on a face,
            // it keeps its restitution's share of its speed into it, turned back.
            let thrown = g.mulk(&met.pushed_by, f64::from(s.rate));
            let pushed = mask(g, &met.pushed_axis, &met.pushed);
            let va = g.select(&v1, &thrown, &pushed);
            let stopped = mask(g, &met.hit_axis, &met.hit);
            let bounced = g.mulk(&v1, -s.restitution);
            v2 = g.select(&va, &bounced, &stopped);
        }
        if !s.planes.is_empty() {
            // The planes read the place and velocity the boxes left, through the repeat's start.
            let (q, v, up, y) = self.planes_from(g, &met.q, &v2);
            met.face_y = g.select(&met.face_y, &y, &up);
            met.up = g.s("or@1", json!({"a": met.up, "b": up}));
            (met.q, v2) = (q, v);
        }
        // A newborn: a hashed place of the emit box about its origin, at the emitter's velocity.
        let seed = u(g, self.seed);
        let r: Vec<String> = (1..=3u32)
            .map(|a| {
                let h = g.s("hash@1", json!({"a": seed, "b": w.e, "c": a}));
                g.s("rand@1", json!({"key": h}))
            })
            .collect();
        let r = g.s("compose@1", json!({"x": r[0], "y": r[1], "z": r[2]}));
        let off = g.s("sub@1", json!({"a": r, "b": 0.5}));
        let off = g.s("mul@1", json!({"a": off, "b": v3j(s.size)}));
        let bp = g.add(&off, &w.origin);
        let bv = g.ty(v3j(s.velocity), "vec3<f32>");
        let q = g.select(&bp, &met.q, &w.was);
        let v3 = g.select(&bv, &v2, &w.was);
        // In flight is never exactly still: at rest is all zeros.
        let (v3, rests) = match self.lat {
            None => (v3, resting),
            Some(_) => {
                let unmoved = g.s("not@1", json!({"x": met.pushed}));
                let rests = g.s("and@1", json!({"a": resting, "b": unmoved}));
                let z = g.s("eq@1", json!({"a": v3, "b": 0.0}));
                let z = g.s("all@1", json!({"x": z}));
                let flies = g.s("not@1", json!({"x": rests}));
                let nudge = g.s("and@1", json!({"a": z, "b": flies}));
                let nudged = g.ty(json!([0.0, -NUDGE, 0.0]), "vec3<f32>");
                (g.select(&v3, &nudged, &nudge), rests)
            }
        };
        // An occurrence kills the live particles within its radius at the step that reaches its
        // time, and a killed particle stays so: its age word says it.
        let mut live = w.live.clone();
        let mut killed = None;
        if !s.deaths.is_empty() {
            let n = s.deaths.len();
            let times: Vec<f64> = s.deaths.iter().map(|d| d.t).collect();
            let times = g.ty(json!(times), &format!("array<f32, {n}>"));
            let points = Value::Array(s.deaths.iter().map(|d| v3j(d.point)).collect());
            let points = g.ty(points, &format!("array<vec3<f32>, {n}>"));
            let mut b = G::named("d");
            let t = b.s("index@1", json!({"a": times, "i": "d_i"}));
            let at = b.s("index@1", json!({"a": points, "i": "d_i"}));
            let since = b.s("gt@1", json!({"a": t, "b": w.before}));
            let by = b.s("le@1", json!({"a": t, "b": w.now}));
            let due = b.s("and@1", json!({"a": since, "b": by}));
            let far = b.s("distance@1", json!({"a": p, "b": at}));
            let near = b.s("le@1", json!({"a": far, "b": s.kill_radius}));
            let hit = b.s("and@1", json!({"a": due, "b": near}));
            b.named_step("d_hit", "or@1", json!({"a": "d_hit", "b": hit}));
            let rep = g.s(
                "repeat@1",
                json!({"count": n, "index": "d_i",
                "accumulate": {"d_hit": false}, "body": b.done()}),
            );
            let now = g.s("and@1", json!({"a": format!("{rep}.d_hit"), "b": w.was}));
            let age = read1(g, "prev", &w.e, s.stride(), 6);
            let before = g.s("lt@1", json!({"a": age, "b": KILLED + 0.5}));
            let dead = g.s("or@1", json!({"a": now, "b": before}));
            let spared = g.s("not@1", json!({"x": dead}));
            live = g.s("and@1", json!({"a": live, "b": spared}));
            killed = Some(dead);
        }
        Moved {
            q,
            v: v3,
            rests,
            met,
            live,
            killed,
        }
    }

    /// A particle that isn't live stands at the emitter with no velocity.
    fn held(&self, g: &mut G, m: &Moved) -> (String, String) {
        let q = g.s(
            "select@1",
            json!({"f": v3j(self.s.at), "t": m.q, "cond": m.live}),
        );
        let v = g.s(
            "select@1",
            json!({"f": [0.0, 0.0, 0.0], "t": m.v, "cond": m.live}),
        );
        (q, v)
    }

    /// Writes the particle's words of the buffer: its place, its velocity, its age (−1 while it
    /// isn't live, −2 once an occurrence killed it) and its attributes, each hashed in its range.
    fn keep(&self, g: &mut G, w: &Who, q: &str, v: &str, live: &str, killed: Option<&str>) {
        let at = slot(g, &w.e, self.s.stride());
        write3(g, BUFFER, &at, 0, q);
        write3(g, BUFFER, &at, 3, v);
        let mut age = g.s("select@1", json!({"f": -1.0, "t": w.age, "cond": live}));
        if let Some(killed) = killed {
            age = g.s("select@1", json!({"f": age, "t": KILLED, "cond": killed}));
        }
        write1(g, BUFFER, &at, 6, &age);
        let seed = u(g, self.seed);
        for (j, (_, [lo, hi])) in self.s.attributes.iter().enumerate() {
            let h = g.s("hash@1", json!({"a": seed, "b": w.e, "c": 20 + j}));
            let r = g.s("rand@1", json!({"key": h}));
            let x = g.mulk(&r, hi - lo);
            let x = g.s("add@1", json!({"a": x, "b": lo}));
            write1(g, BUFFER, &at, 7 + j as u32, &x);
        }
    }

    fn buffer(&self) -> Value {
        json!({BUFFER: {"storage": {"type": "f32", "count": self.words()},
                        "carry": {"every": self.s.every, "budget": self.s.budget}}})
    }

    /// The item without spacing: one operator that moves each particle and keeps the buffer.
    fn alone(&self) -> (String, Value) {
        let mut g = G::new();
        let w = self.who(&mut g);
        let m = self.motion(&mut g, &w);
        let (q, v) = self.held(&mut g, &m);
        self.keep(&mut g, &w, &q, &v, &m.live, m.killed.as_deref());
        self.op(self.id.to_string(), "Stepped particles: each particle's birth, forces and swept test against its world's boxes, one fixed step.", self.inputs(true, true), g, self.buffer(), self.s.count)
    }

    /// The column the step's schedule pairs column (ix, iz) with: 8, 4, 2, then 1 apart, along x
    /// then z, each pairing then shifted by its stride. Gives whether it runs along z, the
    /// stride, and whether this column's partner is the one further along.
    fn pairing(&self, g: &mut G, ix: &str, iz: &str) -> (String, String, String, String) {
        let ph = g.s("and@1", json!({"a": "k", "b": 15}));
        let odd = g.s("and@1", json!({"a": ph, "b": 1}));
        let along_z = g.s("eq@1", json!({"a": odd, "b": 1}));
        let half = g.s("shr@1", json!({"a": ph, "b": 1}));
        let which = g.s("and@1", json!({"a": half, "b": 3}));
        let eight = u(g, 8);
        let stride = g.s("shr@1", json!({"a": eight, "b": which}));
        let a = g.select(ix, iz, &along_z);
        let shift = g.s("shr@1", json!({"a": ph, "b": 3}));
        let shift = g.mul(&shift, &stride);
        let shifted = g.add(&a, &shift);
        let pair = g.div(&shifted, &stride);
        let pair = g.s("and@1", json!({"a": pair, "b": 1}));
        let further = g.s("eq@1", json!({"a": pair, "b": 0}));
        (along_z, stride, a, further)
    }

    /// The item with spacing: the columns' tops, their levels over the ground, each particle's
    /// motion, each grain's plan, and the buffer.
    fn spaced(&self) -> Vec<(String, Value)> {
        let l = self.lat.expect("a lattice");
        let columns = l.g[0] * l.g[1];
        let n = self.s.count;
        // Tops: each grain at rest raises its column's top to the level above it.
        let mut g = G::new();
        let e = g.s("element@1", json!({}));
        let stride = self.s.stride();
        let p = read3(&mut g, "prev", &e, stride, 0);
        let v = read3(&mut g, "prev", &e, stride, 3);
        let age = read1(&mut g, "prev", &e, stride, 6);
        let was = g.s("ge@1", json!({"a": age, "b": 0.0}));
        let ran = g.s("gt@1", json!({"a": "k", "b": 0}));
        let zero = g.s("eq@1", json!({"a": v, "b": 0.0}));
        let stopped = g.s("all@1", json!({"x": zero}));
        let (x, y, z) = (g.split(&p, "x"), g.split(&p, "y"), g.split(&p, "z"));
        let (ok, c, _, _) = self.column(&mut g, &x, &z);
        let lv = self.level(&mut g, &y);
        let above = g.s("add@1", json!({"a": lv, "b": 1}));
        let rests = g.s("and@1", json!({"a": was, "b": stopped}));
        let rests = g.s("and@1", json!({"a": rests, "b": ran}));
        let rests = g.s("and@1", json!({"a": rests, "b": ok}));
        let raise = g.s("atomic_max@1", json!({"buf": "tops", "i": c, "v": above}));
        set_when(&mut g, &raise, &rests);
        let top = self.op(
            format!("{}.top", self.id),
            "Stepped particles: each grain at rest raises its column's top.",
            self.inputs(true, false),
            g,
            json!({"tops": {"storage": {"type": "u32", "count": columns}}}),
            n,
        );
        // Levels: a column's top where grains rest (bit 31 set), else the ground under it.
        let mut g = G::new();
        let e = g.s("element@1", json!({}));
        let top_at = g.s("read@1", json!({"buf": "tops", "i": e}));
        let fixed: Vec<&Collider> = self.boxes.iter().filter(|b| b.follow.is_none()).collect();
        let mut ground = u(&mut g, 0);
        if !fixed.is_empty() {
            let count = fixed.len();
            let ix = g.s("rem@1", json!({"a": e, "b": l.g[0]}));
            let iz = g.s("div@1", json!({"a": e, "b": l.g[0]}));
            let (fx, fz) = (g.convert(&ix, "f32"), g.convert(&iz, "f32"));
            let at = g.s("compose@1", json!({"x": fx, "y": fz}));
            let at = g.s("add@1", json!({"a": at, "b": 0.5}));
            let at = g.mulk(&at, l.d);
            let at = g.s("add@1", json!({"a": at, "b": [l.lo[0], l.lo[2]]}));
            let ty = format!("array<vec2<f32>, {count}>");
            let cs = g.ty(
                Value::Array(
                    fixed
                        .iter()
                        .map(|b| json!([b.centre[0], b.centre[2]]))
                        .collect(),
                ),
                &ty,
            );
            let hs = g.ty(
                Value::Array(
                    fixed
                        .iter()
                        .map(|b| json!([b.half[0], b.half[2]]))
                        .collect(),
                ),
                &ty,
            );
            let tops: Vec<f64> = fixed
                .iter()
                .map(|b| {
                    ((b.centre[1] + b.half[1] - l.lo[1]) / l.d - 1e-3)
                        .ceil()
                        .max(0.0)
                })
                .collect();
            let ls = g.ty(json!(tops), &format!("array<f32, {count}>"));
            let mut b = G::named("b");
            let c = b.s("index@1", json!({"a": cs, "i": "b_i"}));
            let h = b.s("index@1", json!({"a": hs, "i": "b_i"}));
            let r = b.sub(&at, &c);
            let ar = b.s("abs@1", json!({"x": r}));
            let within = b.s("lt@1", json!({"a": ar, "b": h}));
            let over = b.s("all@1", json!({"x": within}));
            let lv = b.s("index@1", json!({"a": ls, "i": "b_i"}));
            let lv = b.s("select@1", json!({"f": 0.0, "t": lv, "cond": over}));
            b.named_step("b_high", "max@1", json!({"a": "b_high", "b": lv}));
            let rep = g.s("repeat@1", json!({"count": count, "index": "b_i", "accumulate": {"b_high": 0.0}, "body": b.done()}));
            ground = g.convert(&format!("{rep}.b_high"), "u32");
        }
        // A plane that faces up is ground under every column.
        let floors = self.s.planes.iter().filter(|p| p.normal[1] > 0.999);
        let floor = floors
            .map(|p| ((p.offset - l.lo[1]) / l.d - 1e-3).ceil().max(0.0))
            .fold(0.0, f64::max);
        if floor > 0.0 {
            let floor = u(&mut g, floor as u32);
            ground = g.s("max@1", json!({"a": ground, "b": floor}));
        }
        let grains = g.s("gt@1", json!({"a": top_at, "b": 0}));
        let flag = u(&mut g, 1 << 31);
        let stack = g.s("or@1", json!({"a": top_at, "b": flag}));
        let word = g.select(&ground, &stack, &grains);
        g.s("write@1", json!({"buf": "level", "i": e, "v": word}));
        let mut inputs = Map::new();
        inputs.insert("tops".into(), self.from("top", "tops", "u32", columns));
        let ground = self.op(
            format!("{}.ground", self.id),
            "Stepped particles: each column's level, its grains' top or the ground under it.",
            inputs,
            g,
            json!({"level": {"storage": {"type": "u32", "count": columns}}}),
            columns,
        );
        // Motion: each particle's place and velocity after the step's forces and boxes, and its state.
        let mut g = G::new();
        let w = self.who(&mut g);
        let m = self.motion(&mut g, &w);
        let vy = g.split(&m.v, "y");
        let slow = g.s("abs@1", json!({"x": vy}));
        let slow = g.s(
            "lt@1",
            json!({"a": slow, "b": l.d * f64::from(self.s.rate)}),
        );
        let floor = g.s("and@1", json!({"a": m.met.up, "b": slow}));
        let rel = g.s("sub@1", json!({"a": m.met.face_y, "b": l.lo[1]}));
        let cells = g.s("div@1", json!({"a": rel, "b": l.d}));
        let cells = g.s("sub@1", json!({"a": cells, "b": 1e-3}));
        let cells = g.s("ceil@1", json!({"x": cells}));
        let cells = g.s("max@1", json!({"a": cells, "b": 0.0}));
        let floor_at = g.convert(&cells, "u32");
        let flies = g.s("or@1", json!({"a": m.rests, "b": m.met.pushed}));
        let flies = g.s("not@1", json!({"x": flies}));
        let flies = g.s("and@1", json!({"a": flies, "b": w.was}));
        let flies = g.s("and@1", json!({"a": flies, "b": m.live}));
        let rests = g.s("and@1", json!({"a": m.rests, "b": m.live}));
        let none = u(&mut g, 0);
        let mut state = g.s("shl@1", json!({"a": floor_at, "b": 8}));
        for (cond, bit) in [
            (&m.live, LIVE),
            (&rests, RESTS),
            (&flies, FLIES),
            (&floor, FLOOR),
        ] {
            let bit = u(&mut g, bit);
            let on = g.select(&none, &bit, cond);
            state = g.s("or@1", json!({"a": state, "b": on}));
        }
        let (q, mut v) = self.held(&mut g, &m);
        if let Some(killed) = &m.killed {
            // The buffer's operator reads a killed particle by this velocity.
            v = g.s(
                "select@1",
                json!({"f": v, "t": [MARK, 0.0, 0.0], "cond": killed}),
            );
        }
        let at = slot(&mut g, &w.e, 6);
        write3(&mut g, "moved", &at, 0, &q);
        write3(&mut g, "moved", &at, 3, &v);
        g.s("write@1", json!({"buf": "state", "i": w.e, "v": state}));
        let outputs = json!({"moved": {"storage": {"type": "f32", "count": n * 6}}, "state": {"storage": {"type": "u32", "count": n}}});
        let moved = self.op(format!("{}.move", self.id), "Stepped particles: each particle's motion, its birth, forces and swept test against its world's boxes.", self.inputs(true, true), g, outputs, n);
        // Plans: a grain in flight's wish to land, a top grain's move to a lower column.
        let mut g = G::new();
        let e = g.s("element@1", json!({}));
        let q = read3(&mut g, "moved", &e, 6, 0);
        let st = g.s("read@1", json!({"buf": "state", "i": e}));
        let (rests, flies, floor) = (
            has(&mut g, &st, RESTS),
            has(&mut g, &st, FLIES),
            has(&mut g, &st, FLOOR),
        );
        let floor_at = g.s("shr@1", json!({"a": st, "b": 8}));
        let (qx, qy, qz) = (g.split(&q, "x"), g.split(&q, "y"), g.split(&q, "z"));
        let (ok, c, ix, iz) = self.column(&mut g, &qx, &qz);
        let (along_z, stride, a, further) = self.pairing(&mut g, &ix, &iz);
        let (gx, gz) = (u(&mut g, l.g[0]), u(&mut g, l.g[1]));
        let span = g.select(&gx, &gz, &along_z);
        let up = g.add(&a, &stride);
        let up_ok = g.s("lt@1", json!({"a": up, "b": span}));
        let down_ok = g.s("ge@1", json!({"a": a, "b": stride}));
        let down = g.sub(&a, &stride);
        let b = g.select(&down, &up, &further);
        let b_ok = g.select(&down_ok, &up_ok, &further);
        let n_ok = g.s("and@1", json!({"a": ok, "b": b_ok}));
        let nix = g.select(&b, &ix, &along_z);
        let niz = g.select(&iz, &b, &along_z);
        let row = g.mul(&niz, &gx);
        let ncol = g.add(&nix, &row);
        let none = u(&mut g, 0);
        let c_at = g.select(&none, &c, &ok);
        let n_at = g.select(&none, &ncol, &n_ok);
        let wc = g.s("read@1", json!({"buf": "level", "i": c_at}));
        let wn = g.s("read@1", json!({"buf": "level", "i": n_at}));
        let has_c = has(&mut g, &wc, 1 << 31);
        let has_n = has(&mut g, &wn, 1 << 31);
        let has_n = g.s("and@1", json!({"a": has_n, "b": n_ok}));
        let low = u(&mut g, (1 << 31) - 1);
        let tc = g.s("and@1", json!({"a": wc, "b": low}));
        let tn = g.s("and@1", json!({"a": wn, "b": low}));
        let tn = g.select(&tc, &tn, &n_ok);
        // The higher of two paired columns gives the lower half their difference.
        let share = |g: &mut G, high: &str, lower: &str, cond: &str| {
            let past = g.s("add@1", json!({"a": lower, "b": 1}));
            let steep = g.s("gt@1", json!({"a": high, "b": past}));
            let on = g.s("and@1", json!({"a": steep, "b": cond}));
            let gap = g.sub(high, lower);
            let part = g.s("shr@1", json!({"a": gap, "b": 1}));
            g.select(&none, &part, &on)
        };
        let both = g.s("and@1", json!({"a": n_ok, "b": has_c}));
        let give = share(&mut g, &tc, &tn, &both);
        let stacks = g.s("and@1", json!({"a": has_n, "b": has_c}));
        let take = share(&mut g, &tn, &tc, &stacks);
        // A grain at rest in the part its column gives stands on the paired column's top, or
        // flies into it when no grain rests there.
        let lv = self.level(&mut g, &qy);
        let cut = g.sub(&tc, &give);
        let gives = g.s("gt@1", json!({"a": give, "b": 0}));
        let high = g.s("ge@1", json!({"a": lv, "b": cut}));
        let goes = g.s("and@1", json!({"a": gives, "b": high}));
        let goes = g.s("and@1", json!({"a": goes, "b": rests}));
        let goes = g.s("and@1", json!({"a": goes, "b": ok}));
        let rank = g.sub(&lv, &cut);
        let onto = g.add(&tn, &rank);
        let (place, hop) = (u(&mut g, PLACE), u(&mut g, HOP));
        let kind = g.select(&hop, &place, &has_n);
        let onto = g.select(&none, &onto, &has_n);
        let side = u(&mut g, FURTHER);
        let side = g.select(&none, &side, &further);
        let moves = g.s("or@1", json!({"a": kind, "b": onto}));
        let moves = g.s("or@1", json!({"a": moves, "b": side}));
        // A grain in flight lands on its column's stack once it is down to it, or on a floor it met.
        let lands_at = g.add(&cut, &take);
        let line = self.height(&mut g, &lands_at);
        let reached = g.s("le@1", json!({"a": qy, "b": line}));
        let meets = g.select(&floor, &reached, &has_c);
        let wants = g.s("and@1", json!({"a": meets, "b": flies}));
        let wants = g.s("and@1", json!({"a": wants, "b": ok}));
        let at = g.select(&floor_at, &lands_at, &has_c);
        let land = u(&mut g, LAND);
        let lands = g.s("or@1", json!({"a": land, "b": at}));
        let word = g.select(&none, &lands, &wants);
        let word = g.select(&word, &moves, &goes);
        g.s("write@1", json!({"buf": "plan", "i": e, "v": word}));
        let claim = g.s("atomic_min@1", json!({"buf": "land", "i": c_at, "v": e}));
        set_when(&mut g, &claim, &wants);
        let mut inputs = self.inputs(false, false);
        inputs.insert("moved".into(), self.from("move", "moved", "f32", n * 6));
        inputs.insert("state".into(), self.from("move", "state", "u32", n));
        inputs.insert("level".into(), self.from("ground", "level", "u32", columns));
        let outputs = json!({
            "plan": {"storage": {"type": "u32", "count": n}},
            "land": {"storage": {"type": "u32", "count": columns, "clear": u32::MAX}},
        });
        let plan = self.op(format!("{}.plan", self.id), "Stepped particles: a grain in flight's wish to land, and a top grain's move to a lower column.", inputs, g, outputs, n);
        // The buffer: a grain that wished to land rests if its column took it, else hovers a cell
        // up; a top grain stands on the paired column, or flies into it if nothing is in its way.
        let mut g = G::new();
        let w = self.who(&mut g);
        let q = read3(&mut g, "moved", &w.e, 6, 0);
        let v = read3(&mut g, "moved", &w.e, 6, 3);
        let pl = g.s("read@1", json!({"buf": "plan", "i": w.e}));
        let (qx, qy, qz) = (g.split(&q, "x"), g.split(&q, "y"), g.split(&q, "z"));
        let (ok, c, ix, iz) = self.column(&mut g, &qx, &qz);
        let none = u(&mut g, 0);
        let c_at = g.select(&none, &c, &ok);
        let taken = g.s("read@1", json!({"buf": "land", "i": c_at}));
        let kind = g.s("shr@1", json!({"a": pl, "b": 30}));
        let is = |g: &mut G, k: u32| g.s("eq@1", json!({"a": kind, "b": k}));
        let (lands, places, hops) = (is(&mut g, 1), is(&mut g, 2), is(&mut g, 3));
        let low = u(&mut g, LEVEL);
        let at = g.s("and@1", json!({"a": pl, "b": low}));
        let further = has(&mut g, &pl, FURTHER);
        let (along_z, stride, a, _) = self.pairing(&mut g, &ix, &iz);
        let up = g.add(&a, &stride);
        let down = g.sub(&a, &stride);
        let b = g.select(&down, &up, &further);
        let nix = g.select(&b, &ix, &along_z);
        let niz = g.select(&iz, &b, &along_z);
        let rix = g.select(&nix, &ix, &lands);
        let riz = g.select(&niz, &iz, &lands);
        let rest = self.rest(&mut g, &w.e, &rix, &riz, &at);
        let (rx, ry, rz) = (
            g.split(&rest, "x"),
            g.split(&rest, "y"),
            g.split(&rest, "z"),
        );
        let mine = g.s("eq@1", json!({"a": taken, "b": w.e}));
        let won = g.s("and@1", json!({"a": lands, "b": mine}));
        let lost = g.s("not@1", json!({"x": mine}));
        let lost = g.s("and@1", json!({"a": lands, "b": lost}));
        let above = g.s("add@1", json!({"a": ry, "b": l.d}));
        let hover = g.s("compose@1", json!({"x": qx, "y": above, "z": qz}));
        let hop = g.s("compose@1", json!({"x": rx, "y": qy, "z": rz}));
        let way = self.meet(&mut g, "h", &q, &hop);
        let mut blocked = g.s("or@1", json!({"a": way.pushed, "b": way.hit}));
        if !self.s.planes.is_empty() {
            let (held, _, _, _) = self.planes_from(&mut g, &hop, &v);
            let set = g.s("ne@1", json!({"a": held, "b": hop}));
            let set = g.s("any@1", json!({"x": set}));
            blocked = g.s("or@1", json!({"a": blocked, "b": set}));
        }
        let clear = g.s("not@1", json!({"x": blocked}));
        let hops = g.s("and@1", json!({"a": hops, "b": clear}));
        let settles = g.s("or@1", json!({"a": won, "b": places}));
        let q = g.select(&q, &hover, &lost);
        let q = g.select(&q, &rest, &settles);
        let q = g.select(&q, &hop, &hops);
        let sink = [0.0, -l.d * f64::from(self.s.rate), 0.0];
        let v = g.s("select@1", json!({"f": v, "t": sink, "cond": lost}));
        let v = g.s(
            "select@1",
            json!({"f": v, "t": [0.0, 0.0, 0.0], "cond": settles}),
        );
        let v = g.s(
            "select@1",
            json!({"f": v, "t": [0.0, -NUDGE, 0.0], "cond": hops}),
        );
        // A particle the motion marked killed stays out: its age word says so.
        let killed = (!self.s.deaths.is_empty()).then(|| {
            let vx = g.split(&v, "x");
            g.s("gt@1", json!({"a": vx, "b": 1e38}))
        });
        let (q, v, live) = match &killed {
            None => (q, v, w.live.clone()),
            Some(killed) => {
                let spared = g.s("not@1", json!({"x": killed}));
                let live = g.s("and@1", json!({"a": w.live, "b": spared}));
                let home = json!({"f": q, "t": v3j(self.s.at), "cond": killed});
                let still = json!({"f": v, "t": [0.0, 0.0, 0.0], "cond": killed});
                (g.s("select@1", home), g.s("select@1", still), live)
            }
        };
        self.keep(&mut g, &w, &q, &v, &live, killed.as_deref());
        let mut inputs = self.inputs(false, true);
        inputs.insert("moved".into(), self.from("move", "moved", "f32", n * 6));
        inputs.insert("plan".into(), self.from("plan", "plan", "u32", n));
        inputs.insert("land".into(), self.from("plan", "land", "u32", columns));
        let main = self.op(self.id.to_string(), "Stepped particles: the buffer after the step, each grain that landed at rest in its cell.", inputs, g, self.buffer(), n);
        vec![top, ground, moved, plan, main]
    }

    /// The buffer as a storage input of the operators that read it after the step.
    fn now(&self) -> Map<String, Value> {
        let mut inputs = Map::new();
        inputs.insert("now".into(), json!({"type": "f32", "count": self.words(), "from": {"storage": {"op": self.id, "output": BUFFER}}}));
        inputs
    }

    /// After the step, each reading of the live particles inside its box, four words each: their
    /// count, and for a centroid the sums of their places, each counted in steps across the box.
    fn readings(&self) -> (String, Value) {
        let mut g = G::new();
        let e = g.s("element@1", json!({}));
        let p = read3(&mut g, "now", &e, self.s.stride(), 0);
        let age = read1(&mut g, "now", &e, self.s.stride(), 6);
        let live = g.s("ge@1", json!({"a": age, "b": 0.0}));
        let one = u(&mut g, 1);
        for (r, reading) in self.s.readings.iter().enumerate() {
            let lo = g.s("ge@1", json!({"a": p, "b": v3j(reading.min)}));
            let hi = g.s("le@1", json!({"a": p, "b": v3j(reading.max)}));
            let within = g.s("and@1", json!({"a": lo, "b": hi}));
            let within = g.s("all@1", json!({"x": within}));
            let counts = g.s("and@1", json!({"a": within, "b": live}));
            let add = g.s("atomic_add@1", json!({"buf": COUNTS, "i": 4 * r, "v": one}));
            set_when(&mut g, &add, &counts);
            if !reading.centroid {
                continue;
            }
            let size: [f64; 3] = std::array::from_fn(|a| reading.max[a] - reading.min[a]);
            let per = size.map(|x| if x > 0.0 { QUANTA / x } else { 0.0 });
            let rel = g.s("sub@1", json!({"a": p, "b": v3j(reading.min)}));
            let steps = g.s("mul@1", json!({"a": rel, "b": v3j(per)}));
            let steps = g.s("round@1", json!({"x": steps}));
            let steps = g.s("clamp@1", json!({"x": steps, "lo": 0.0, "hi": QUANTA}));
            let steps = g.convert(&steps, "vec3<u32>");
            for (a, lane) in ["x", "y", "z"].iter().enumerate() {
                let v = g.split(&steps, lane);
                let add = g.s(
                    "atomic_add@1",
                    json!({"buf": COUNTS, "i": 4 * r + 1 + a, "v": v}),
                );
                set_when(&mut g, &add, &counts);
            }
        }
        let words = 4 * self.s.readings.len();
        let outputs = json!({COUNTS: {"storage": {"type": "u32", "count": words}}});
        self.op(
            readings_op(self.id),
            "Stepped particles: after the step, each reading of the live particles inside its box.",
            self.now(),
            g,
            outputs,
            self.s.count,
        )
    }

    /// Each frame, the buffer as the particle draw's rows: place, age over life (0 without one,
    /// −1 while not live), velocity.
    fn rows(&self) -> (String, Value) {
        let mut g = G::new();
        let e = g.s("element@1", json!({}));
        let p = read3(&mut g, "now", &e, self.s.stride(), 0);
        let v = read3(&mut g, "now", &e, self.s.stride(), 3);
        let age = read1(&mut g, "now", &e, self.s.stride(), 6);
        let live = g.s("ge@1", json!({"a": age, "b": 0.0}));
        let over = match self.s.life {
            Some(life) => g.s("div@1", json!({"a": age, "b": life})),
            None => g.c(json!(0.0)),
        };
        let over = g.s("select@1", json!({"f": -1.0, "t": over, "cond": live}));
        let at = slot(&mut g, &e, ROW);
        write3(&mut g, ROWS, &at, 0, &p);
        write1(&mut g, ROWS, &at, 3, &over);
        write3(&mut g, ROWS, &at, 4, &v);
        let outputs = json!({ROWS: {"storage": {"type": "f32", "count": self.s.count * ROW}}});
        let (id, mut item) = self.op(
            rows_op(self.id),
            "Stepped particles: the buffer as the particle draw's rows, each frame.",
            self.now(),
            g,
            outputs,
            self.s.count,
        );
        item["params"]
            .as_object_mut()
            .expect("its params")
            .remove("stepped");
        (id, item)
    }
}

/// The operator items item `id` lowers to, in the order they run: the step's (the last of them
/// under the item's own ID, keeping `buffer`), its readings, and the draw's rows.
pub fn lower(
    id: &str,
    s: &Spec,
    boxes: &[Collider],
    seed: u32,
    planted: Planted,
) -> Vec<(String, Value)> {
    let c = Ctx {
        id,
        s,
        boxes,
        lat: lattice(s, boxes),
        seed,
        planted,
    };
    let mut out = match c.lat {
        Some(_) => c.spaced(),
        None => vec![c.alone()],
    };
    if !s.readings.is_empty() {
        out.push(c.readings());
    }
    out.push(c.rows());
    out
}
