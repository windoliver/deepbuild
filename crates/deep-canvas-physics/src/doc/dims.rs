//! #2098: what a world's `dimensions` changes in its reading (World and backend; Shape: 2D; Body).
//! A 2D world writes a point as `[x, y]`, a turn as one number of degrees about +Z, a turn rate as
//! one of deg/s and its locks as `linear: [x, y]` and `angular: bool`; it holds the 2D shape kinds
//! and no other, as a 3D world holds none of them; and what its backend doesn't run yet is
//! refused, naming the field. A body's `inertia` is its three moments about its own axes.

use serde_json::{Map, Value};

use super::{join, show, Reader, Rot};

/// A 2D world's shape (Shape: 2D): a disc; the line from `a` to `b`; the hull of 3 to 8 points;
/// or the line through its points in order, back to the first when `closed`. A segment and a
/// chain have no area, so only a static body holds one.
#[derive(Clone, Debug, PartialEq)]
pub enum Flat {
    Circle { radius: f64 },
    Segment { a: [f64; 2], b: [f64; 2] },
    Polygon { points: Vec<[f64; 2]> },
    Chain { points: Vec<[f64; 2]>, closed: bool },
}

/// The 2D shape kinds (Shape: 2D).
const KINDS: [&str; 4] = ["circle", "segment", "polygon", "chain"];
/// The sections of a world the 2D backend doesn't run yet.
const SECTIONS: [&str; 6] = ["joints", "forces", "inputs", "outputs", "solve", "soft"];
/// Where the rest of a 2D world lands.
const LATER: &str = "#2098's follow-up";

impl Reader {
    fn later(&mut self, path: String, actual: &Value, what: &str) {
        let what = format!("{what} isn't run in a 2D world yet; {LATER} brings it");
        self.refuse("physics.unsupported", path, actual, what);
    }

    /// What `m`, a 2D world as written, holds that its backend doesn't run yet, each refused at
    /// its field: joints, forces, inputs, outputs, a kinematic solve and soft bodies; a kinematic
    /// body; a body's `inertia`; and a sensor. The world without those sections, which the
    /// reader then reads.
    pub(super) fn unrun(&mut self, m: &Map<String, Value>) -> Map<String, Value> {
        let mut run = m.clone();
        for key in SECTIONS {
            let filled = |v: &Value| v.as_object().is_none_or(|o| !o.is_empty());
            if let Some(v) = run.remove(key).filter(filled) {
                self.later(key.into(), &v, key);
            }
        }
        if let Some(v) = m.get("mode").filter(|v| *v == "kinematic") {
            self.later("mode".into(), v, "kinematic mode");
        }
        for (id, b) in m
            .get("bodies")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let p = format!("bodies/{id}");
            if let Some(v) = b.get("kind").filter(|v| *v == "kinematic") {
                self.later(join(&p, "kind"), v, "a kinematic body");
            }
            if let Some(v) = b.get("inertia") {
                self.later(join(&p, "inertia"), v, "a body's inertia");
            }
            let uses = b.get("shapes").and_then(Value::as_array);
            for (i, u) in uses.into_iter().flatten().enumerate() {
                if let Some(v) = u.get("sensor").filter(|v| *v == true) {
                    self.later(format!("{p}/shapes/{i}/sensor"), v, "a sensor");
                }
            }
        }
        run
    }

    /// The shape at `p` when `dimensions` decides it: a 2D kind read in a 2D world, and a kind of
    /// the other dimension refused, naming it (`Some(None)`); `None` for a 3D kind in a 3D world,
    /// which the 3D reader takes.
    pub(super) fn shape2(&mut self, v: &Value, p: &str) -> Option<Option<Flat>> {
        let kind = v.get("kind").and_then(Value::as_str).unwrap_or("");
        let flat = KINDS.contains(&kind);
        if !self.flat && !flat {
            return None;
        }
        if self.flat != flat {
            let (n, kinds) = if self.flat {
                (2, "a circle, a segment, a polygon or a chain")
            } else {
                (3, "a sphere, box, capsule, cylinder, plane, convex, mesh, heightfield or compound")
            };
            let what = format!(
                "{} is a {kind:?}, and a {n}D world's shape is {kinds}",
                show(p)
            );
            self.refuse("out_of_range", join(p, "kind"), &v["kind"], what);
            return Some(None);
        }
        let chain = kind == "chain";
        Some(match kind {
            "circle" => {
                let s = &self.obj(v, p, &["kind", "radius"]);
                Some(Flat::Circle {
                    radius: self.num(s, "radius", p, 0.5, f64::MIN_POSITIVE, f64::MAX),
                })
            }
            "segment" => {
                let s = &self.obj(v, p, &["kind", "a", "b"]);
                let [a, b] = ["a", "b"].map(|k| self.vec3(s, k, p, [0.0; 3]));
                if a == b {
                    let what = format!("{} runs from a point to the same point", show(p));
                    self.refuse("out_of_range", join(p, "b"), &v["b"], what);
                }
                Some(Flat::Segment {
                    a: [a[0], a[1]],
                    b: [b[0], b[1]],
                })
            }
            _ => {
                let keys: &[&str] = if chain {
                    &["kind", "points", "loop"]
                } else {
                    &["kind", "points"]
                };
                let s = &self.obj(v, p, keys);
                let points = self.points2(s, p);
                let (fits, takes) = if chain {
                    (points.len() >= 2, "2 points or more")
                } else {
                    ((3..=8).contains(&points.len()), "3 to 8 points")
                };
                if !fits {
                    let what = format!("a {kind} takes {takes}, not {}", points.len());
                    self.refuse("out_of_range", join(p, "points"), &v["points"], what);
                    return Some(None);
                }
                if !chain {
                    return Some(Some(Flat::Polygon { points }));
                }
                Some(Flat::Chain {
                    points,
                    closed: self.flag(s, "loop", p, false),
                })
            }
        })
    }

    /// A list of points `[x, y]` at `points`, or its refusal and none.
    fn points2(&mut self, m: &Map<String, Value>, p: &str) -> Vec<[f64; 2]> {
        let pair = |x: &Value| {
            let x = x.as_array().filter(|x| x.len() == 2)?;
            Some([x[0].as_f64()?, x[1].as_f64()?])
        };
        let list = m.get("points").and_then(Value::as_array);
        let got = list.and_then(|a| a.iter().map(pair).collect::<Option<Vec<_>>>());
        if got.is_none() {
            let at = join(p, "points");
            let what = format!("{at} must be a list of points [x, y]");
            self.refuse(
                "out_of_range",
                at,
                m.get("points").unwrap_or(&Value::Null),
                what,
            );
        }
        got.unwrap_or_default()
    }

    /// A 2D world's `rot` in `m`: one number of degrees about +Z, 0 when unwritten; `None` in a
    /// 3D world, whose reader takes it.
    pub(super) fn turn(&mut self, m: &Map<String, Value>, p: &str) -> Option<Rot> {
        self.flat
            .then(|| Rot::Deg([0.0, 0.0, self.num(m, "rot", p, 0.0, f64::MIN, f64::MAX)]))
    }

    /// A body's `velocity.angular`, deg/s: three numbers, or in a 2D world one, about +Z.
    pub(super) fn spin(&mut self, m: &Map<String, Value>, p: &str) -> [f64; 3] {
        if self.flat {
            return [0.0, 0.0, self.num(m, "angular", p, 0.0, f64::MIN, f64::MAX)];
        }
        self.vec3(m, "angular", p, [0.0; 3])
    }

    /// A body's locks at `key`: three booleans; or in a 2D world `linear: [x, y]` and `angular:
    /// bool`, its turn about +Z.
    pub(super) fn locks(&mut self, m: &Map<String, Value>, key: &str, path: &str) -> [bool; 3] {
        let Some(v) = m.get(key) else {
            return [false; 3];
        };
        let all = |a: &Vec<Value>| a.iter().map(Value::as_bool).collect::<Option<Vec<_>>>();
        let (got, form) = match (self.flat, key, v.as_array().and_then(all)) {
            (false, _, Some(a)) if a.len() == 3 => (Some([a[0], a[1], a[2]]), ""),
            (false, ..) => (None, "three booleans"),
            (true, "linear", Some(a)) if a.len() == 2 => (Some([a[0], a[1], false]), ""),
            (true, "linear", _) => (None, "two booleans"),
            (true, ..) => (v.as_bool().map(|z| [false, false, z]), "true or false"),
        };
        got.unwrap_or_else(|| {
            let at = join(path, key);
            let what = format!("{} must be {form}", show(&at));
            self.refuse("out_of_range", at, v, what);
            [false; 3]
        })
    }

    /// A body's `inertia`, kg·m²: its moments about its own x, y and z axes through its centre of
    /// mass, each above 0, in place of the ones its shapes give at its mass.
    pub(super) fn inertia(&mut self, b: &Map<String, Value>, p: &str) -> Option<[f64; 3]> {
        let v = b.get("inertia").filter(|_| !self.flat)?;
        let i = self.vec3(b, "inertia", p, [1.0; 3]);
        if i.iter().any(|x| !(*x > 0.0 && x.is_finite())) {
            let what = format!(
                "{} must be three moments above 0, kg·m²",
                join(p, "inertia")
            );
            self.refuse("out_of_range", join(p, "inertia"), v, what);
        }
        Some(i)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use crate::caps::{asked, RAPIER2D, RAPIER3D};
    use crate::check::check;
    use crate::doc::{Flat, Rot};
    use crate::roles::TABLE;

    /// A 2D world of one static body on `shape`, with `extra` over it.
    fn flat(shape: Value, extra: Value) -> Value {
        let mut w = json!({
            "kind": "physics.world@1", "dimensions": 2,
            "capacity": {"bodies": 4, "shapes": 4, "joints": 0, "contacts": 8, "particles": 0},
            "shapes": {"s": shape},
            "bodies": {"b": {"kind": "static", "shapes": [{"shape": "s"}], "pose": {"pos": [1, 2], "rot": 90}}}
        });
        for (k, v) in extra.as_object().into_iter().flatten() {
            w[k] = v.clone();
        }
        w
    }

    /// The paths `doc`'s check refuses, on the backend it asks for.
    fn refused(doc: &Value) -> Vec<String> {
        let e = check(doc, asked(doc), &TABLE).err().unwrap_or_default();
        e.into_iter().map(|r| r.path).collect()
    }

    #[test]
    fn a_2d_world_reads_its_shapes_points_and_turns() {
        let square = json!([[0, 0], [1, 0], [1, 1], [0, 1]]);
        let doc = flat(json!({"kind": "polygon", "points": square}), json!({}));
        let w = check(&doc, &RAPIER2D, &TABLE).unwrap_or_else(|e| panic!("{e:?}"));
        assert!(matches!(&w.flat["s"], Flat::Polygon { points } if points.len() == 4));
        assert_eq!(w.bodies["b"].pose.pos, [1.0, 2.0, 0.0]);
        assert_eq!(w.bodies["b"].pose.rot, Rot::Deg([0.0, 0.0, 90.0]));
        let chain = json!({"kind": "chain", "points": [[0, 0], [1, 0], [1, 1]], "loop": true});
        let w = check(&flat(chain, json!({})), &RAPIER2D, &TABLE).unwrap();
        assert!(matches!(&w.flat["s"], Flat::Chain { closed: true, points } if points.len() == 3));
        assert_eq!(asked(&doc).backend, "rapier2d");
        assert_eq!(
            asked(&json!({"backend": {"name": "rapier3d"}, "dimensions": 2})),
            &RAPIER3D
        );
    }

    #[test]
    fn a_world_refuses_the_other_dimensions_shapes_and_points() {
        let circle = json!({"kind": "circle", "radius": 1});
        assert_eq!(
            refused(&flat(circle.clone(), json!({}))),
            Vec::<String>::new()
        );
        let boxed = flat(json!({"kind": "box", "half": [1, 1, 1]}), json!({}));
        assert!(refused(&boxed).contains(&"shapes/s/kind".to_string()));
        let mut solid = flat(circle.clone(), json!({"dimensions": 3}));
        solid["bodies"]["b"]["pose"] = json!({"pos": [1, 2, 0]});
        assert_eq!(refused(&solid)[0], "shapes/s/kind");
        let mut deep = flat(circle.clone(), json!({}));
        deep["bodies"]["b"]["pose"]["pos"] = json!([1, 2, 0]);
        assert_eq!(refused(&deep), ["bodies/b/pose/pos"]);
        let nine: Vec<[i32; 2]> = (0..9).map(|i| [i, i * i]).collect();
        let many = flat(json!({"kind": "polygon", "points": nine}), json!({}));
        assert!(refused(&many).contains(&"shapes/s/points".to_string()));
        let unnamed = flat(
            circle,
            json!({"backend": {"name": "rapier2d"}, "dimensions": 3}),
        );
        assert!(refused(&unnamed).contains(&"dimensions".to_string()));
    }

    #[test]
    fn a_2d_world_refuses_what_its_backend_does_not_run_yet() {
        let circle = json!({"kind": "circle", "radius": 1});
        let hinge = json!({"j": {"kind": "hinge", "a": "world", "b": "b"}});
        let pull = json!({"g": {"kind": {"uniform": {"accel": [0, 1]}}, "applies_to": ["b"]}});
        let later = [
            (json!({"joints": hinge}), "joints"),
            (json!({"forces": pull}), "forces"),
            (
                json!({"outputs": {"o": {"from": "b", "read": "pose"}}}),
                "outputs",
            ),
            (json!({"mode": "kinematic"}), "mode"),
        ];
        for (extra, path) in later {
            assert_eq!(refused(&flat(circle.clone(), extra)), [path]);
        }
        let mut doc = flat(circle, json!({}));
        doc["bodies"]["b"]["shapes"][0]["sensor"] = json!(true);
        doc["bodies"]["b"]["inertia"] = json!([1, 1, 1]);
        doc["bodies"]["b"]["kind"] = json!("kinematic");
        let paths = [
            "bodies/b/kind",
            "bodies/b/inertia",
            "bodies/b/shapes/0/sensor",
        ];
        assert_eq!(refused(&doc), paths);
    }

    #[test]
    fn an_inertia_is_three_moments_above_zero() {
        let mut doc = json!({
            "kind": "physics.world@1",
            "capacity": {"bodies": 4, "shapes": 4, "joints": 0, "contacts": 8, "particles": 0},
            "shapes": {"s": {"kind": "box", "half": [1, 1, 1]}},
            "bodies": {"b": {"kind": "dynamic", "shapes": [{"shape": "s"}], "mass": 1, "inertia": [1, 2, 3]}}
        });
        let w = check(&doc, &RAPIER3D, &TABLE).unwrap_or_else(|e| panic!("{e:?}"));
        assert_eq!(w.bodies["b"].inertia, Some([1.0, 2.0, 3.0]));
        for bad in [json!([1, 0, 3]), json!([1, 2]), json!(2)] {
            doc["bodies"]["b"]["inertia"] = bad;
            assert_eq!(refused(&doc), ["bodies/b/inertia"]);
        }
    }
}
