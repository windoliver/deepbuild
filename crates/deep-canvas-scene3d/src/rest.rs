//! Issue #2013: `rest_on` onto true shapes (canvas primitives: Constraint: rest_on). The owner
//! moves along its axis until its true shape touches the first surface of `on`, and with
//! `align: normal` tilts to that surface. The shapes are the ones the geometry audit reads
//! ([`crate::shapes`]), so the contact the solve leaves is the contact the audit confirms. It is
//! a pure function of both sides' shapes: nothing settles, and nothing is kept between frames.

use std::sync::Arc;

use deep_canvas::geometry_audit::{depth, Shape, V3};
use deep_canvas::ops::sqrt;
use deep_canvas::registry::Registrar;
use deep_canvas::schedule::core_ops::{Datum, Edit, Edits};
use deep_canvas::schedule::{Canonical, OpError, Val, View};
use deep_canvas_motion::program::Program;
use serde_json::{json, Value};

use crate::scene::{Refused, Rests as Which};

/// Two shapes this close touch.
const TOUCH: f64 = 1e-9;
/// How far past a touch the solve looks to tell a surface that blocks from one alongside.
const PROBE: f64 = 1e-7;
/// The most an item creeps per step along a surface it touches without being blocked: half a
/// millimetre, a quarter of the audit's overlap tolerance.
const CREEP: f64 = 5e-4;
/// The most steps one cast takes.
const STEPS: usize = 20_000;

fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn scaled(a: V3, s: f64) -> V3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn cross(a: V3, b: V3) -> V3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
fn unit(a: V3) -> Option<V3> {
    let l = sqrt(dot(a, a));
    (l > 1e-12).then(|| scaled(a, 1.0 / l))
}

/// `shape` moved by `d`.
pub fn moved(shape: &Shape, d: V3) -> Shape {
    match shape {
        Shape::Obb { c, axes, half } => Shape::Obb {
            c: add(*c, d),
            axes: *axes,
            half: *half,
        },
        Shape::Ball { c, r } => Shape::Ball {
            c: add(*c, d),
            r: *r,
        },
        Shape::Capsule { a, b, r } => Shape::Capsule {
            a: add(*a, d),
            b: add(*b, d),
            r: *r,
        },
    }
}

/// `p` turned about `pivot` by the rotation `m`.
fn turned_point(m: &[V3; 3], pivot: V3, p: V3) -> V3 {
    let q = sub(p, pivot);
    add(pivot, [dot(m[0], q), dot(m[1], q), dot(m[2], q)])
}

/// `shape` turned about `pivot` by the rotation `m` (its rows).
pub fn turned(shape: &Shape, m: &[V3; 3], pivot: V3) -> Shape {
    let dir = |v: V3| [dot(m[0], v), dot(m[1], v), dot(m[2], v)];
    match shape {
        Shape::Obb { c, axes, half } => Shape::Obb {
            c: turned_point(m, pivot, *c),
            axes: axes.map(dir),
            half: *half,
        },
        Shape::Ball { c, r } => Shape::Ball {
            c: turned_point(m, pivot, *c),
            r: *r,
        },
        Shape::Capsule { a, b, r } => Shape::Capsule {
            a: turned_point(m, pivot, *a),
            b: turned_point(m, pivot, *b),
            r: *r,
        },
    }
}

/// The rotation (its rows) that takes the unit `from` onto the unit `to` by the shortest turn.
pub fn turn_onto(from: V3, to: V3) -> [V3; 3] {
    let (v, c) = (cross(from, to), dot(from, to));
    if c < -1.0 + 1e-12 {
        // Opposite: half a turn about any axis square to `from`.
        let side = if from[0].abs() < 0.9 {
            [1.0, 0.0, 0.0]
        } else {
            [0.0, 1.0, 0.0]
        };
        let a = unit(cross(from, side)).unwrap_or([0.0, 0.0, 1.0]);
        return [0, 1, 2]
            .map(|i| [0, 1, 2].map(|j| 2.0 * a[i] * a[j] - if i == j { 1.0 } else { 0.0 }));
    }
    let k = 1.0 / (1.0 + c);
    [
        [
            c + k * v[0] * v[0],
            k * v[0] * v[1] - v[2],
            k * v[0] * v[2] + v[1],
        ],
        [
            k * v[1] * v[0] + v[2],
            c + k * v[1] * v[1],
            k * v[1] * v[2] - v[0],
        ],
        [
            k * v[2] * v[0] - v[1],
            k * v[2] * v[1] + v[0],
            c + k * v[2] * v[2],
        ],
    ]
}

/// How far `own`, moved by `d`, passes into `on`: the deepest of their pieces' pairs, negative
/// while they are apart.
fn sunk(own: &[Shape], on: &[Shape], d: V3) -> f64 {
    let mut deepest = f64::NEG_INFINITY;
    for a in own {
        let a = moved(a, d);
        for b in on {
            deepest = deepest.max(depth(&a, b));
        }
    }
    deepest
}

/// A shape's reach along the unit `axis`: the greatest `p · axis` over its points.
fn reach(shape: &Shape, axis: V3) -> f64 {
    match shape {
        Shape::Obb { c, axes, half } => {
            dot(*c, axis)
                + (0..3)
                    .map(|k| (dot(axes[k], axis) * half[k]).abs())
                    .sum::<f64>()
        }
        Shape::Ball { c, r } => dot(*c, axis) + r,
        Shape::Capsule { a, b, r } => dot(*a, axis).max(dot(*b, axis)) + r,
    }
}

/// How far `own` travels along the unit `axis` until it first touches `on`, by at most
/// `max_drop`: negative where it starts sunk and backs out against the axis. `None` when nothing
/// of `on` lies within `max_drop` (no support). Apart, the gap bounds how far it can move before
/// touching, so each step moves by the gap; touching, a surface blocks only if moving on sinks
/// into it, and one alongside is crept past.
pub fn cast(own: &[Shape], on: &[Shape], axis: V3, max_drop: f64) -> Option<f64> {
    if own.is_empty() || on.is_empty() {
        return None;
    }
    let h = |s: f64| sunk(own, on, scaled(axis, s));
    if h(0.0) > TOUCH {
        let mut back = 0.0;
        for _ in 0..STEPS {
            let d = h(-back);
            if d <= TOUCH {
                return Some(-back);
            }
            back += d;
            if back > max_drop {
                return None;
            }
        }
        return None;
    }
    let mut s = 0.0;
    for _ in 0..STEPS {
        let gap = -h(s);
        if gap > TOUCH {
            s += gap;
        } else if h(s + PROBE) > TOUCH {
            return Some(s);
        } else {
            // Touching something alongside: creep on, and stop where the next step would sink.
            let (mut lo, mut hi) = (s, s + CREEP);
            if h(hi) <= TOUCH {
                s = hi;
            } else {
                for _ in 0..40 {
                    let mid = (lo + hi) / 2.0;
                    if h(mid) > TOUCH {
                        hi = mid;
                    } else {
                        lo = mid;
                    }
                }
                return Some(lo);
            }
        }
        if s > max_drop {
            return None;
        }
    }
    None
}

/// How far `own` travels along `axis` to stand on the ground plane through the origin.
pub fn cast_to_ground(own: &[Shape], axis: V3, max_drop: f64) -> Option<f64> {
    let low = own
        .iter()
        .map(|s| reach(s, axis))
        .fold(f64::NEG_INFINITY, f64::max);
    (low.is_finite() && low.abs() <= max_drop).then_some(-low)
}

/// The unit normal of the surface `own`, moved by `d`, touches: the way it leaves `on` fastest.
pub fn normal_at(own: &[Shape], on: &[Shape], d: V3) -> Option<V3> {
    let eps = 1e-6;
    let mut g = [0.0; 3];
    for (k, gk) in g.iter_mut().enumerate() {
        let mut e = [0.0; 3];
        e[k] = eps;
        *gk = (sunk(own, on, add(d, e)) - sunk(own, on, sub(d, e))) / (2.0 * eps);
    }
    unit(scaled(g, -1.0))
}

/// A side's bounds as one box (`contact: bounds`).
pub fn bounds_of(shapes: &[Shape]) -> Vec<Shape> {
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    for s in shapes {
        let [a, b] = s.aabb();
        for k in 0..3 {
            lo[k] = lo[k].min(a[k]);
            hi[k] = hi[k].max(b[k]);
        }
    }
    if lo[0] > hi[0] {
        return Vec::new();
    }
    let c = scaled(add(lo, hi), 0.5);
    let half = scaled(sub(hi, lo), 0.5);
    vec![Shape::Obb {
        c,
        axes: [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        half,
    }]
}

/// One solved rest: how far the owner moves in the world, and the turn (its rows) that tilts it
/// about its origin, if it aligns.
#[derive(Clone, Debug, PartialEq)]
pub struct Solved {
    pub by: V3,
    pub turn: Option<[V3; 3]>,
}

/// What a rest reads: the owner's shape with its origin, each side of `on` (`None` for the
/// ground), and the constraint's fields.
pub struct Rest<'a> {
    pub own: &'a [Shape],
    pub origin: V3,
    pub on: Option<&'a [Shape]>,
    pub axis: V3,
    pub align: bool,
    pub bounds: bool,
    pub offset: f64,
    pub max_drop: f64,
}

/// Solves one rest, or `None` when the owner finds no support within `max_drop`.
pub fn solve(r: &Rest<'_>) -> Option<Solved> {
    let boxed = |s: &[Shape]| if r.bounds { bounds_of(s) } else { s.to_vec() };
    let on = r.on.map(boxed);
    let drop = |own: &[Shape]| match &on {
        Some(on) => cast(own, on, r.axis, r.max_drop),
        None => cast_to_ground(own, r.axis, r.max_drop),
    };
    let own = boxed(r.own);
    let mut s = drop(&own)?;
    let mut turn = None;
    if r.align {
        let up = scaled(r.axis, -1.0);
        let normal = match &on {
            Some(on) => normal_at(&own, on, scaled(r.axis, s)),
            None => Some(up),
        };
        if let Some(m) = normal.map(|n| turn_onto(up, n)) {
            let tilted: Vec<Shape> = r.own.iter().map(|sh| turned(sh, &m, r.origin)).collect();
            if let Some(again) = drop(&boxed(&tilted)) {
                s = again;
                turn = Some(m);
            }
        }
    }
    Some(Solved {
        by: scaled(r.axis, s - r.offset),
        turn,
    })
}

// ---- the operators: a revision's still rests solved once at check, a moving one at each frame,
// and each owner's place written over its own transform.

/// The rests a revision's check solved, or a frame's: each owner's own position and, where it
/// aligned, its rotation.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Rests(pub crate::scene::Rested);

impl Canonical for Rests {
    fn encode(&self, out: &mut Vec<u8>) {
        self.0.encode(out);
    }
}

fn rests_of(doc: &Value) -> impl Iterator<Item = &Value> {
    doc.get("constraints")
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|m| m.values())
        .filter(|c| deep_canvas_motion::module::rests_at_check(c))
}

/// A document with a `rest_on` on true shapes.
fn has_rest(doc: &Value, _: &str, _: &Value) -> bool {
    rests_of(doc).next().is_some()
}

/// A document with such a rest and something else a frame's time can move.
fn has_moving_rest(doc: &Value, id: &str, item: &Value) -> bool {
    let moves = |section: &str| {
        doc.get(section)
            .and_then(Value::as_object)
            .is_some_and(|m| {
                m.values().any(|entry| {
                    section != "constraints" || !deep_canvas_motion::module::rests_at_check(entry)
                })
            })
    };
    has_rest(doc, id, item)
        && [
            "channels",
            "clips",
            "placements",
            "drivers",
            "constraints",
            "shots",
        ]
        .into_iter()
        .any(moves)
}

/// An item a `rest_on` on true shapes owns.
fn owns_rest(doc: &Value, id: &str, _: &Value) -> bool {
    rests_of(doc).any(|c| c.get("owner").and_then(Value::as_str) == Some(id))
}

/// What couldn't be solved, as the check reports it: the first by its code, with them all.
fn reported(problems: &[Refused]) -> Result<(), OpError> {
    let Some(first) = problems.first() else {
        return Ok(());
    };
    let all: Vec<Value> = problems
        .iter()
        .map(|p| json!({"code": p.code, "path": p.path}))
        .collect();
    Err(OpError::new(first.code, first.path.clone()).with(json!({"rests": all})))
}

/// Every rest whose two sides nothing moves, solved once for the revision.
fn solve_op(v: &mut View<'_>) -> Result<(), OpError> {
    let doc = v.document()?;
    let (rested, problems) =
        crate::scene::rested_at(doc, 0, Which::Still).map_err(|r| OpError::new(r.code, r.path))?;
    reported(&problems)?;
    v.write("scene3d.rests", Val::typed(Rests(rested)))
}

/// Every rest with a side motion moves, solved at the frame's time.
fn live_op(v: &mut View<'_>) -> Result<(), OpError> {
    let t = v.t()?;
    let Some(program) = v.typed::<Arc<Program>>("motion.program")? else {
        return Ok(());
    };
    let Some(map) = v.document()?.as_object() else {
        return Ok(());
    };
    let (rested, problems) = crate::scene::rested_with(map, &program, t, Which::Moving);
    reported(&problems)?;
    v.write("scene3d.restslive", Val::typed(Rests(rested)))
}

/// A rested item's solved place, written over its own transform.
fn placed_op(v: &mut View<'_>) -> Result<(), OpError> {
    let id = v.id().unwrap_or_default().to_string();
    let still = v.typed::<Rests>("scene3d.rests")?;
    let live = v.typed::<Rests>("scene3d.restslive")?;
    let found = [live, still]
        .into_iter()
        .flatten()
        .find_map(|r| r.0.get(&id).copied());
    let Some((pos, rot)) = found else {
        return Ok(());
    };
    let set = |name: &str, x: V3| Edit {
        add: false,
        path: vec![name.to_string()],
        value: Datum::Nums(x.to_vec()),
    };
    let mut edits = vec![set("pos", pos)];
    edits.extend(rot.map(|r| set("rot", r)));
    v.write("scene3d.rested", Val::typed(Edits(edits)))
}

/// Registers `rest_on` on true shapes: its solve at check, its solve per frame where a side
/// moves, each owner's place in the core's transform, and the code a rest with no support raises.
pub fn register(r: &mut Registrar) {
    r.array("scene3d.rests", "rests", "document", "transform", "plan");
    r.operator("rest", "plan", &["refs"], &["scene3d.rests"])
        .document()
        .applies(has_rest)
        .run(solve_op);
    r.array(
        "scene3d.restslive",
        "rests",
        "document",
        "transform",
        "items",
    );
    r.operator(
        "restlive",
        "items",
        &["refs", "t", "motion.program"],
        &["scene3d.restslive"],
    )
    .document()
    .applies(has_moving_rest)
    .run(live_op);
    r.contribution(
        "scene3d.rested",
        "transform",
        "item",
        "transform",
        "items",
        "core.transform",
    );
    r.operator(
        "rested",
        "items",
        &["scene3d.rests", "scene3d.restslive"],
        &["scene3d.rested"],
    )
    .applies(owns_rest)
    .run(placed_op);
    r.code(
        "no_support",
        "A rest_on whose owner meets nothing of `on` along its axis within max_drop.",
        "Move the item over what it rests on, name the surface under it in `on`, or raise max_drop.",
        false,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_canvas::ops::{cos, rad, sin};

    const I3: [V3; 3] = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    const DOWN: V3 = [0.0, -1.0, 0.0];

    fn cube(c: V3, half: V3) -> Shape {
        Shape::Obb { c, axes: I3, half }
    }

    /// A 1.2 × 0.05 × 0.8 m top centred at y 0.8, tilted `deg` about +Z.
    fn table(deg: f64) -> Shape {
        let (c, s) = (cos(rad(deg)), sin(rad(deg)));
        Shape::Obb {
            c: [0.0, 0.8, 0.0],
            axes: [[c, s, 0.0], [-s, c, 0.0], [0.0, 0.0, 1.0]],
            half: [0.6, 0.025, 0.4],
        }
    }

    #[test]
    fn a_ball_rests_on_a_tilted_top_where_its_true_shape_touches() {
        let ball = [Shape::Ball {
            c: [-0.3, 1.2, 0.0],
            r: 0.1,
        }];
        let top = [table(20.0)];
        let s = cast(&ball, &top, DOWN, 10.0).unwrap();
        // The centre where the ball touches the plane of the top, in closed form.
        let a = rad(20.0);
        let rest_y = 0.8 + (0.025 + 0.1 + sin(a) * -0.3) / cos(a);
        assert!((1.2 - s - rest_y).abs() < 1e-8, "{s}");
        assert!(depth(&moved(&ball[0], [0.0, -s, 0.0]), &top[0]).abs() < 1e-8);
        // Bounds on bounds stop at the top of the tilted box's bounds, far above it.
        let boxed = solve(&Rest {
            own: &ball,
            origin: [-0.3, 1.2, 0.0],
            on: Some(&top),
            axis: DOWN,
            align: false,
            bounds: true,
            offset: 0.0,
            max_drop: 10.0,
        })
        .unwrap();
        assert!(
            (1.2 + boxed.by[1] - (1.0287044 + 0.1)).abs() < 1e-6,
            "{boxed:?}"
        );
    }

    #[test]
    fn a_sunk_item_backs_out_and_one_alongside_a_wall_drops_past_it() {
        let floor = cube([0.0, -0.5, 0.0], [5.0, 0.5, 5.0]);
        let sunk_box = [cube([0.0, 0.2, 0.0], [0.25, 0.25, 0.25])];
        let s = cast(&sunk_box, &[floor.clone()], DOWN, 10.0).unwrap();
        assert!((s + 0.05).abs() < 1e-8, "{s}");
        // A wall the box touches on its side doesn't hold it up: it drops 1 m to the floor.
        let wall = cube([0.75, 1.0, 0.0], [0.5, 1.0, 1.0]);
        let beside = [cube([0.0, 1.25, 0.0], [0.25, 0.25, 0.25])];
        let s = cast(&beside, &[wall, floor], DOWN, 10.0).unwrap();
        assert!((s - 1.0).abs() < 1e-6, "{s}");
    }

    #[test]
    fn nothing_within_max_drop_is_no_support_and_the_ground_is_a_plane() {
        let far = [cube([0.0, -20.0, 0.0], [1.0, 1.0, 1.0])];
        let item = [Shape::Capsule {
            a: [0.0, 2.0, 0.0],
            b: [0.0, 3.0, 0.0],
            r: 0.5,
        }];
        assert_eq!(cast(&item, &far, DOWN, 10.0), None);
        assert_eq!(
            cast(&item, &[cube([3.0, 0.0, 0.0], [1.0, 1.0, 1.0])], DOWN, 10.0),
            None
        );
        assert_eq!(cast_to_ground(&item, DOWN, 10.0), Some(1.5));
        assert_eq!(cast_to_ground(&item, DOWN, 1.0), None);
        let lifted = solve(&Rest {
            own: &item,
            origin: [0.0, 2.0, 0.0],
            on: None,
            axis: DOWN,
            align: false,
            bounds: false,
            offset: 0.25,
            max_drop: 10.0,
        })
        .unwrap();
        assert!((lifted.by[1] + 1.25).abs() < 1e-12, "{lifted:?}");
    }

    #[test]
    fn align_normal_tilts_a_box_flat_onto_a_slope() {
        let slope = [table(20.0)];
        let item = [cube([0.0, 1.5, 0.0], [0.1, 0.05, 0.1])];
        let solved = solve(&Rest {
            own: &item,
            origin: [0.0, 1.5, 0.0],
            on: Some(&slope),
            axis: DOWN,
            align: true,
            bounds: false,
            offset: 0.0,
            max_drop: 10.0,
        })
        .unwrap();
        let m = solved.turn.expect("it tilts");
        // Its up is the slope's normal, and its whole base lies on the slope.
        let up = [m[0][1], m[1][1], m[2][1]];
        let n = [-sin(rad(20.0)), cos(rad(20.0)), 0.0];
        assert!(sub(up, n).iter().all(|x| x.abs() < 1e-5), "{up:?}");
        let rested = moved(&turned(&item[0], &m, [0.0, 1.5, 0.0]), solved.by);
        assert!(depth(&rested, &slope[0]).abs() < 1e-6);
        let Shape::Obb { c, .. } = rested else {
            unreachable!()
        };
        assert!((dot(sub(c, [0.0, 0.8, 0.0]), n) - 0.075).abs() < 1e-6);
    }
}
