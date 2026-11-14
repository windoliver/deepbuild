//! #213: the physics module's between-step service `physics.cast@1` (Logic: between-step
//! services): the rays, sweeps and overlaps a logic item writes at its step, answered right after
//! it through the physics backend interface's `query()` on each world as its last step before the
//! logic step's time left it, up to 8 hits each, sorted by distance, then ID. The physics module
//! fills the core's `logic.service@1` with the entry and its fixture, each case's answer beside the
//! check kind's on the state its step read; the hub binds the answer for a document's logic items.

use std::cell::RefCell;
use std::rc::Rc;

use deep_canvas::registry::{Registrar, Sealed};
use deep_canvas_physics::backend::{Hit, Query};
use deep_canvas_physics::caps::RAPIER3D;
use deep_canvas_physics::check::check;
use deep_canvas_physics::doc::{Pose, Rot, Shape};
use deep_canvas_physics::occurrence;
use deep_logic::services::Service;
use deep_physics_rapier::runner::{Live, Run};
use serde_json::{json, Map, Value};

pub(crate) const NAME: &str = "physics.cast@1";
/// A request: +0 u32 kind (0 ray, 1 sweep, 2 overlap), +4 u32 world (its handle), +8 u32 groups
/// (a mask over the world's collision groups), +12 u32 shape (0 sphere, 1 capsule, 2 box), +16 f64
/// max (a ray's), +24 vec3 from (a ray's origin, a sweep's from.pos, an overlap's at.pos), +48 vec3
/// dir (a ray's direction, a sweep's to.pos), +72 quat rot (a sweep's from.rot, an overlap's
/// at.rot), +104 quat rot2 (a sweep's to.rot), +136 vec3 size (a sphere's radius; a capsule's half
/// height and radius; a box's half extents).
const REQUEST: usize = 160;
/// A result: a u32 hit count, 4 zero bytes, then [`HITS`] hits of [`HIT`] bytes each.
const RESULT: usize = 8 + HITS * HIT;
const HITS: usize = 8;
/// A hit: u32 id (the body's rank in the world's canonical order), u32 address (its shape use),
/// vec3 point, vec3 normal, f64 distance.
const HIT: usize = 64;
const MAX_PER_STEP: u32 = 256;
const FUEL_PER_REQUEST: i64 = 4_000;

fn u32_at(b: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(b[at..at + 4].try_into().expect("4 bytes"))
}

fn f64s<const N: usize>(b: &[u8], at: usize) -> [f64; N] {
    std::array::from_fn(|i| f64::from_le_bytes(b[at + 8 * i..][..8].try_into().expect("8 bytes")))
}

/// A request's world handle, query and groups; none for one that names no kind or shape or holds
/// a number that isn't finite, which is answered with no hits.
fn request(b: &[u8]) -> Option<(usize, Query, u32)> {
    if f64s::<18>(b, 16).iter().any(|x| !x.is_finite()) {
        return None;
    }
    let size: [f64; 3] = f64s(b, 136);
    let shape = match u32_at(b, 12) {
        0 => Shape::Sphere { radius: size[0] },
        1 => Shape::Capsule {
            half_height: size[0],
            radius: size[1],
        },
        2 => Shape::Box { half: size },
        _ => return None,
    };
    let pose = |pos: usize, rot: usize| Pose {
        pos: f64s(b, pos),
        rot: Rot::Quat(f64s(b, rot)),
    };
    let q = match u32_at(b, 0) {
        0 => Query::Ray {
            from: f64s(b, 24),
            dir: f64s(b, 48),
            max: f64s::<1>(b, 16)[0],
        },
        1 => Query::Sweep {
            shape,
            from: pose(24, 72),
            to: pose(48, 104),
        },
        2 => Query::Overlap {
            shape,
            at: pose(24, 72),
        },
        _ => return None,
    };
    Some((u32_at(b, 4) as usize, q, u32_at(b, 8)))
}

/// A request's bytes, as a program writes them (the fixture's).
fn encode(world: u32, q: &Query, groups: u32) -> Vec<u8> {
    let mut b = vec![0u8; REQUEST];
    let mut put = |at: usize, v: &[f64]| {
        for (i, x) in v.iter().enumerate() {
            b[at + 8 * i..][..8].copy_from_slice(&x.to_le_bytes());
        }
    };
    let quat = |p: &Pose| match p.rot {
        Rot::Quat(q) => q,
        Rot::Deg(_) => [0.0, 0.0, 0.0, 1.0],
    };
    let (kind, shape) = match q {
        Query::Ray { from, dir, max } => {
            put(16, &[*max]);
            put(24, from);
            put(48, dir);
            (0u32, None)
        }
        Query::Sweep { shape, from, to } => {
            put(24, &from.pos);
            put(48, &to.pos);
            put(72, &quat(from));
            put(104, &quat(to));
            (1, Some(shape))
        }
        Query::Overlap { shape, at } => {
            put(24, &at.pos);
            put(72, &quat(at));
            (2, Some(shape))
        }
    };
    let (s, size) = match shape {
        None => (0, [0.0; 3]),
        Some(Shape::Sphere { radius }) => (0, [*radius, 0.0, 0.0]),
        Some(Shape::Capsule {
            radius,
            half_height,
        }) => (1, [*half_height, *radius, 0.0]),
        Some(Shape::Box { half }) => (2, *half),
        Some(_) => (u32::MAX, [0.0; 3]),
    };
    put(136, &size);
    for (at, v) in [(0, kind), (4, world), (8, groups), (12, s)] {
        b[at..at + 4].copy_from_slice(&v.to_le_bytes());
    }
    b
}

/// Up to [`HITS`] hits as a result lays them out.
fn result(hits: &[(u32, u32, Hit)]) -> Vec<u8> {
    let mut b = vec![0u8; RESULT];
    let n = hits.len().min(HITS);
    b[..4].copy_from_slice(&(n as u32).to_le_bytes());
    for (i, (id, address, h)) in hits.iter().take(HITS).enumerate() {
        let o = 8 + i * HIT;
        b[o..o + 4].copy_from_slice(&id.to_le_bytes());
        b[o + 4..o + 8].copy_from_slice(&address.to_le_bytes());
        for (j, x) in h
            .point
            .iter()
            .chain(&h.normal)
            .chain([&h.distance])
            .enumerate()
        {
            b[o + 8 + 8 * j..][..8].copy_from_slice(&x.to_le_bytes());
        }
    }
    b
}

/// A result's hits as the fixture lists them.
fn hits_json(b: &[u8]) -> Value {
    let n = u32_at(b, 0) as usize;
    let hits: Vec<Value> = (0..n)
        .map(|i| {
            let o = 8 + i * HIT;
            let [px, py, pz, nx, ny, nz, d] = f64s::<7>(b, o + 8);
            json!({"id": u32_at(b, o), "address": u32_at(b, o + 4), "point": [px, py, pz],
                   "normal": [nx, ny, nz], "distance": d})
        })
        .collect();
    json!(hits)
}

/// Each world of a document stepped as its bake steps, forward as the logic steps ask: the state
/// a logic step at `t` read is each world's after its last step at or before `t`.
struct Cursors {
    run: Run,
    scene: Value,
    track: Vec<Value>,
    ids: Vec<String>,
    lives: Vec<Option<Live>>,
    /// The planted service: each world after its next step.
    late: bool,
}

impl Cursors {
    fn new(scene: &Value, track: &[Value], late: bool) -> Cursors {
        let ids: Vec<String> = scene["worlds"]
            .as_object()
            .map(|w| w.keys().cloned().collect())
            .unwrap_or_default();
        Cursors {
            run: Run::new(None).expect("the unplanted runner"),
            scene: scene.clone(),
            track: track.to_vec(),
            lives: ids.iter().map(|_| None).collect(),
            ids,
            late,
        }
    }

    /// World `w` after every step it runs before `t` (at one time a logic step runs before a
    /// physics step), built again from step 0 when a seek asks for an earlier state; none for a
    /// world the document doesn't list or the runner refuses.
    fn at(&mut self, w: usize, t: i64) -> Option<&Live> {
        let id = self.ids.get(w)?;
        let late = i64::from(self.late);
        let state = |l: &Live| {
            t.div_euclid(l.step_flicks()) + i64::from(t.rem_euclid(l.step_flicks()) != 0) + late
        };
        let behind = |l: &Live| l.steps as i64 > state(l);
        if self.lives[w].as_ref().is_none_or(behind) {
            let mut l = self
                .run
                .live(&json!({"scene": self.scene, "world": id}))
                .ok()?;
            l.track(&self.track);
            self.lives[w] = Some(l);
        }
        let l = self.lives[w].as_mut()?;
        let n = state(l);
        while (l.steps as i64) < n {
            l.step().ok()?;
        }
        Some(l)
    }

    /// Each request's result, in order, for the logic step at `t`.
    fn answer(&mut self, t: i64, requests: &[u8]) -> Result<Vec<u8>, String> {
        let mut out = Vec::with_capacity(requests.len() / REQUEST * RESULT);
        for r in requests.as_chunks::<REQUEST>().0 {
            let mut hits = match request(r) {
                Some((w, q, groups)) => self.at(w, t).map(|l| l.cast(&q, groups)),
                None => None,
            }
            .unwrap_or_default();
            if cfg!(feature = "test-cast-sorts-by-id") {
                hits.sort_by_key(|(id, address, _)| (*id, *address));
            }
            out.extend(result(&hits));
        }
        Ok(out)
    }
}

/// The u32 each world of `form` and each of its bodies is interned to, as physics.cast@1's
/// requests name a world and its hits a body: a world its index among the document's worlds, a
/// body its rank in its world's canonical order, as occurrence rows name it.
pub(crate) fn handles(form: &Value) -> Value {
    let (mut worlds, mut bodies) = (Map::new(), Map::new());
    for (i, (id, doc)) in form["worlds"].as_object().into_iter().flatten().enumerate() {
        worlds.insert(id.clone(), json!(i));
        let w = deep_physics_rapier::bound::expand(Some(form), doc)
            .and_then(|d| check(&d, &RAPIER3D, &deep_canvas_physics::roles::TABLE));
        if let Ok(w) = w {
            let ranks = occurrence::ranks(&w);
            let named: Map<String, Value> = (ranks.iter())
                .filter(|(b, _)| w.bodies.contains_key(*b))
                .map(|(b, r)| (b.clone(), json!(r)))
                .collect();
            bodies.insert(id.clone(), Value::Object(named));
        }
    }
    json!({"worlds": worlds, "bodies": bodies})
}

/// The services this build binds for `form`'s logic items: `physics.cast@1` when the sealed set
/// holds the physics module's entry, answering on `form`'s worlds and the core input track;
/// `late`, the planted service that answers from each world after its next step.
pub(crate) fn services(sealed: &Sealed, form: &Value, track: &[Value], late: bool) -> Vec<Service> {
    let held = sealed
        .registry("logic.service@1")
        .is_some_and(|r| r.entries.iter().any(|e| e.name == NAME));
    if !held {
        return Vec::new();
    }
    let cursors = RefCell::new(Cursors::new(form, track, late));
    vec![Service {
        name: NAME.into(),
        request: REQUEST as u32,
        result: RESULT as u32,
        max_per_step: MAX_PER_STEP,
        fuel_per_request: FUEL_PER_REQUEST,
        answer: Rc::new(move |t, r| cursors.borrow_mut().answer(t, r)),
    }]
}

/// The fixture's scene: one 120 Hz world with two static walls across +x, `a` behind `b`, so
/// distance and ID orders differ, and a ball falling past the y axis.
fn scene() -> Value {
    let wall = |x: f64| json!({"kind": "static", "shapes": [{"shape": "wall", "contact_material": "m"}], "pose": {"pos": [x, 0, 0]}});
    json!({"worlds": {"w": {
        "kind": "physics.world@1", "dimensions": 3, "step_rate": 120, "substeps": 4, "gravity": [0, -9.81, 0],
        "seed": 213, "mode": "dynamic",
        "capacity": {"bodies": 8, "shapes": 8, "joints": 0, "contacts": 16, "particles": 0},
        "backend": {"name": "rapier3d", "version": "=0.36.1"},
        "contact_materials": {"m": {"friction": 0, "restitution": 0, "density": 1000}},
        "shapes": {"wall": {"kind": "box", "half": [0.1, 2, 2]}, "ball": {"kind": "sphere", "radius": 0.25}},
        "bodies": {"a": wall(6.0), "b": wall(3.0),
                   "c": {"kind": "dynamic", "shapes": [{"shape": "ball", "contact_material": "m"}], "pose": {"pos": [0, 5, 3]}}},
    }}})
}

/// The fixture: each case asked at logic step 30 of a 60 Hz item, the service's answer beside the
/// check kind's, `query()` on the world as its 60 steps at 120 Hz left it.
fn fixture() -> Value {
    let step = deep_canvas::time::step_length(60.0).expect("60 Hz");
    let (k, t) = (30, 30 * step);
    let id = Pose {
        pos: [0.0; 3],
        rot: Rot::Quat([0.0, 0.0, 0.0, 1.0]),
    };
    let at = |pos: [f64; 3]| Pose { pos, ..id.clone() };
    let cases = [
        (
            json!({"ray": {"from": [0, 0, 0], "dir": [1, 0, 0], "max": 100}}),
            Query::Ray {
                from: [0.0; 3],
                dir: [1.0, 0.0, 0.0],
                max: 100.0,
            },
        ),
        (
            json!({"ray": {"from": [0, -10, 3], "dir": [0, 1, 0], "max": 100}}),
            Query::Ray {
                from: [0.0, -10.0, 3.0],
                dir: [0.0, 1.0, 0.0],
                max: 100.0,
            },
        ),
        (
            json!({"sweep": {"shape": {"sphere": 0.1}, "from": [0, 1, 0], "to": [10, 1, 0]}}),
            Query::Sweep {
                shape: Shape::Sphere { radius: 0.1 },
                from: at([0.0, 1.0, 0.0]),
                to: at([10.0, 1.0, 0.0]),
            },
        ),
        (
            json!({"overlap": {"shape": {"box": [0.5, 0.5, 0.5]}, "at": [3, 0, 0]}}),
            Query::Overlap {
                shape: Shape::Box { half: [0.5; 3] },
                at: at([3.0, 0.0, 0.0]),
            },
        ),
    ];
    let scene = scene();
    let mut service = Cursors::new(&scene, &[], false);
    // The check kind's: the world stepped to the state step k read, then query() on it.
    let mut world =
        Run::new(None).and_then(|run| run.live(&json!({"scene": scene, "world": "w"})).ok());
    if let Some(l) = world.as_mut() {
        while (l.steps as i64) < t.div_euclid(l.step_flicks()) && l.step().is_ok() {}
    }
    let mut out = Vec::new();
    for (asked, q) in cases {
        let answer = service
            .answer(t, &encode(0, &q, u32::MAX))
            .unwrap_or_default();
        let check = world.as_ref().map(|l| result(&l.cast(&q, u32::MAX)));
        out.push(
            json!({"request": asked, "step": k, "answer": hits_json(&answer),
                        "check": check.as_deref().map_or(Value::Null, hits_json)}),
        );
    }
    json!(out)
}

/// The physics module's entry in `logic.service@1`.
pub(crate) fn register(r: &mut Registrar) {
    r.entry(
        "logic.service@1",
        NAME,
        json!({"request": {"bytes": REQUEST, "kinds": ["ray", "sweep", "overlap"], "shapes": ["sphere", "capsule", "box"]},
               "result": {"bytes": RESULT, "hits": HITS, "hit": HIT, "order": ["distance", "id"]},
               "max_per_step": MAX_PER_STEP, "fuel_per_request": FUEL_PER_REQUEST, "fixture": fixture()}),
        "R6",
    );
}
