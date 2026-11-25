//! A robot as a canvas document: one `group@1` item and one `body@1` a link, a `joint@1` a joint
//! that has a place, and a report of the one rotation applied and of what had none.
//!
//! The file is Z-up, right-handed metres and radians; the canvas is +Y up, right-handed metres and
//! degrees. One rotation, [`R`], is applied as a change of axes to everything: a point p becomes
//! R·p, an orientation Q becomes R·Q·Rᵀ, an axis a becomes R·a and a moment tensor I becomes
//! R·I·Rᵀ.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas::ops;
use deep_canvas_physics::{caps, check, roles};
use serde_json::{json, Map, Value};

use crate::read::{Dropped, Geometry, Kind, Robot};

type V3 = [f64; 3];
type M3 = [[f64; 3]; 3];

const I3: M3 = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
/// −90° about X: the file's (x, y, z) is our (x, z, −y), so its +Z up is our +Y up.
const R: M3 = [[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, -1.0, 0.0]];
/// A product of inertia, or a turn, under this is none.
const TINY: f64 = 1e-12;

fn apply(m: &M3, v: V3) -> V3 {
    [0, 1, 2].map(|i| m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2])
}
fn mul(a: &M3, b: &M3) -> M3 {
    [0, 1, 2].map(|i| [0, 1, 2].map(|j| a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j]))
}
fn transpose(m: &M3) -> M3 {
    [0, 1, 2].map(|i| [0, 1, 2].map(|j| m[j][i]))
}
fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
/// An orientation in the file's axes as one in ours: R·Q·Rᵀ.
fn turned(q: &M3) -> M3 {
    mul(&R, &mul(q, &transpose(&R)))
}
/// Roll, pitch and yaw about the fixed X, Y and Z: Rz(yaw)·Ry(pitch)·Rx(roll).
fn rpy(r: V3) -> M3 {
    let (sr, cr) = (ops::sin(r[0]), ops::cos(r[0]));
    let (sp, cp) = (ops::sin(r[1]), ops::cos(r[1]));
    let (sy, cy) = (ops::sin(r[2]), ops::cos(r[2]));
    [
        [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
        [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
        [-sp, cp * sr, cp * cr],
    ]
}
/// A rotation as the quaternion `[x, y, z, w]` with w at or above 0.
fn quat(m: &M3) -> [f64; 4] {
    let trace = m[0][0] + m[1][1] + m[2][2];
    let q = if trace > 0.0 {
        let s = ops::sqrt(trace + 1.0) * 2.0;
        [
            (m[2][1] - m[1][2]) / s,
            (m[0][2] - m[2][0]) / s,
            (m[1][0] - m[0][1]) / s,
            s / 4.0,
        ]
    } else if m[0][0] > m[1][1] && m[0][0] > m[2][2] {
        let s = ops::sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2.0;
        [
            s / 4.0,
            (m[0][1] + m[1][0]) / s,
            (m[0][2] + m[2][0]) / s,
            (m[2][1] - m[1][2]) / s,
        ]
    } else if m[1][1] > m[2][2] {
        let s = ops::sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2.0;
        [
            (m[0][1] + m[1][0]) / s,
            s / 4.0,
            (m[1][2] + m[2][1]) / s,
            (m[0][2] - m[2][0]) / s,
        ]
    } else {
        let s = ops::sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2.0;
        [
            (m[0][2] + m[2][0]) / s,
            (m[1][2] + m[2][1]) / s,
            s / 4.0,
            (m[1][0] - m[0][1]) / s,
        ]
    };
    if q[3] < 0.0 {
        q.map(|x| -x)
    } else {
        q
    }
}
/// A rotation as an item writes one: degrees about X, then Y, then Z, in fixed axes (Rz·Ry·Rx).
fn euler(m: &M3) -> V3 {
    let (x, y, z) = if m[2][0].abs() < 1.0 - TINY {
        (
            ops::atan2(m[2][1], m[2][2]),
            ops::asin(-m[2][0]),
            ops::atan2(m[1][0], m[0][0]),
        )
    } else {
        let y = if m[2][0] < 0.0 {
            ops::PI / 2.0
        } else {
            -ops::PI / 2.0
        };
        (0.0, y, ops::atan2(-m[0][1], m[1][1]))
    };
    [ops::deg(x), ops::deg(y), ops::deg(z)]
}
fn turns(m: &M3) -> bool {
    (0..3).any(|i| (0..3).any(|j| (m[i][j] - I3[i][j]).abs() > TINY))
}

/// A number as JSON, a negative zero as zero.
fn num(x: f64) -> Value {
    json!(if x == 0.0 { 0.0 } else { x })
}
fn nums(v: &[f64]) -> Value {
    Value::Array(v.iter().map(|x| num(*x)).collect())
}

/// `name` as an ID no earlier name took: itself when it is lower-case letters, digits and `_`
/// from a letter or digit on, else that made of it; then with `_2`, `_3`, … while it is taken.
fn id(name: &str, fallback: &str, taken: &mut BTreeSet<String>) -> String {
    let made: String = name
        .chars()
        .map(|c| match c.to_ascii_lowercase() {
            c @ ('a'..='z' | '0'..='9') => c,
            _ => '_',
        })
        .collect();
    let made = made.trim_matches('_');
    let base = if made.is_empty() { fallback } else { made };
    let mut out = base.to_string();
    let mut n = 1;
    while !taken.insert(out.clone()) {
        n += 1;
        out = format!("{base}_{n}");
    }
    out
}

/// The `n`-th order key among siblings: fixed-width base 62, so keys sort as they are made.
fn order(n: usize) -> String {
    const DIGITS: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    let mut digits = [b'0'; 4];
    let mut k = n.min(62usize.pow(4) - 1);
    for d in digits.iter_mut().rev() {
        *d = DIGITS[k % 62];
        k /= 62;
    }
    format!("a{}", String::from_utf8_lossy(&digits))
}

/// Where a link's frame is: on the body `holder` (or `world`), at `pos` and `rot` in that body's
/// frame, in the file's axes.
#[derive(Clone)]
struct On {
    holder: String,
    pos: V3,
    rot: M3,
}

/// The document and the report of `robot`, whose look is the file with the SHA-256 `look`; or why
/// the file is refused, naming what in it.
pub fn convert(robot: &Robot, look: &str) -> Result<(Value, Value), String> {
    let nothing = "nothing was written";
    let links = &robot.links;
    let mut index = BTreeMap::new();
    for (i, l) in links.iter().enumerate() {
        if index.insert(l.name.as_str(), i).is_some() {
            return Err(format!(
                "the file holds two links named {}; {nothing}",
                l.name
            ));
        }
    }
    // The joint that holds each link, and each link's frame in the file's axes with every joint
    // at 0: a root's is the origin, a child's its parent's times its joint's origin.
    let mut held: Vec<Option<usize>> = vec![None; links.len()];
    for (j, joint) in robot.joints.iter().enumerate() {
        let (Some(_), Some(&c)) = (
            index.get(joint.parent.as_str()),
            index.get(joint.child.as_str()),
        ) else {
            return Err(format!(
                "the joint {} joins a link the file doesn't hold; {nothing}",
                joint.name
            ));
        };
        if held[c].replace(j).is_some() {
            return Err(format!(
                "the link {} is the child of two joints; {nothing}",
                joint.child
            ));
        }
    }
    let mut frames: Vec<Option<(V3, M3)>> = held
        .iter()
        .map(|h| h.is_none().then_some(([0.0; 3], I3)))
        .collect();
    let mut tree: Vec<usize> = (0..links.len()).filter(|&i| held[i].is_none()).collect();
    for at in 0.. {
        let Some(&parent) = tree.get(at) else { break };
        let (pos, rot) = frames[parent].expect("a link in the tree has its frame");
        for (c, h) in held.iter().enumerate() {
            let Some(joint) = h.map(|j| &robot.joints[j]) else {
                continue;
            };
            if index[joint.parent.as_str()] == parent {
                frames[c] = Some((
                    add(pos, apply(&rot, joint.origin.xyz)),
                    mul(&rot, &rpy(joint.origin.rpy)),
                ));
                tree.push(c);
            }
        }
    }
    if let Some(i) = frames.iter().position(Option::is_none) {
        return Err(format!(
            "the joints that hold the link {} close a loop; {nothing}",
            links[i].name
        ));
    }
    let frame = |i: usize| frames[i].expect("every link has its frame");

    let mut dropped: Vec<&Dropped> = robot.dropped.iter().collect();
    let mut extra: Vec<Dropped> = Vec::new();
    let mut taken = BTreeSet::from(["world".to_string()]);
    let ids: Vec<String> = links
        .iter()
        .map(|l| id(&l.name, "link", &mut taken))
        .collect();

    // Which links are bodies: one with a mass is dynamic; a root with none is static where it has
    // a collision shape and the world itself where it has none; any other link with no mass is a
    // frame on the body that holds its parent, as a fixed joint would keep it.
    let mut kinds: Vec<Option<&str>> = vec![None; links.len()];
    let mut on: Vec<Option<On>> = vec![None; links.len()];
    let mut unplaced: BTreeSet<usize> = BTreeSet::new();
    for &i in &tree {
        let own = On {
            holder: ids[i].clone(),
            pos: [0.0; 3],
            rot: I3,
        };
        let parent = held[i].map(|j| {
            (
                j,
                on[index[robot.joints[j].parent.as_str()]]
                    .clone()
                    .expect("a parent comes first"),
            )
        });
        on[i] = Some(if links[i].inertial.is_some() {
            kinds[i] = Some("dynamic");
            own
        } else {
            let carried = parent.map(|(j, p)| {
                let joint = &robot.joints[j];
                if !matches!(joint.kind, Kind::Fixed | Kind::Unplaced) && unplaced.insert(j) {
                    extra.push(Dropped {
                        element: "joint".into(),
                        name: joint.name.clone(),
                    });
                }
                On {
                    holder: p.holder,
                    pos: add(p.pos, apply(&p.rot, joint.origin.xyz)),
                    rot: mul(&p.rot, &rpy(joint.origin.rpy)),
                }
            });
            match carried {
                Some(c) if c.holder != "world" || links[i].collisions.is_empty() => c,
                None if links[i].collisions.is_empty() => On {
                    holder: "world".into(),
                    pos: [0.0; 3],
                    rot: I3,
                },
                _ => {
                    kinds[i] = Some("static");
                    own
                }
            }
        });
    }
    let on = |i: usize| {
        on[i]
            .as_ref()
            .expect("every link is on a body or the world")
    };

    // Each collision shape, on the body its link is on.
    let mut shapes = Map::new();
    let mut uses: BTreeMap<&str, Vec<Value>> = BTreeMap::new();
    let mut shape_ids = BTreeSet::new();
    for (i, l) in links.iter().enumerate() {
        let at = on(i);
        for c in &l.collisions {
            let shape = match c.geometry {
                // A box keeps its sizes on the axes they were on: |R|·half.
                Geometry::Box(size) => {
                    json!({"kind": "box", "half": nums(&apply(&R.map(|row| row.map(f64::abs)), size.map(|s| s / 2.0)))})
                }
                Geometry::Sphere(radius) => json!({"kind": "sphere", "radius": num(radius)}),
                // The file's cylinder stands along its own Z, ours along its own Y, where R puts it.
                Geometry::Cylinder { radius, length } => {
                    json!({"kind": "cylinder", "half_height": num(length / 2.0), "radius": num(radius)})
                }
            };
            let shape_id = id(&ids[i], "shape", &mut shape_ids);
            let rot = mul(&at.rot, &rpy(c.origin.rpy));
            let mut offset = Map::from_iter([(
                "pos".to_string(),
                nums(&apply(&R, add(at.pos, apply(&at.rot, c.origin.xyz)))),
            )]);
            if turns(&rot) {
                offset.insert("rot".into(), nums(&quat(&turned(&rot))));
            }
            shapes.insert(shape_id.clone(), shape);
            uses.entry(at.holder.as_str())
                .or_default()
                .push(json!({"shape": shape_id, "offset": offset}));
        }
    }

    let mut bodies = Map::new();
    let mut items = Map::new();
    for (i, l) in links.iter().enumerate() {
        let (pos, rot) = frame(i);
        // A body's item stands where its body does and takes its pose from it; a frame's item is
        // a child of its body's item, where the frame is on that body.
        let rides = Some(on(i)).filter(|at| kinds[i].is_none() && at.holder != "world");
        let (at_pos, at_rot) = rides.map_or((pos, rot), |at| (at.pos, at.rot));
        let mut at = Map::from_iter([("pos".to_string(), nums(&apply(&R, at_pos)))]);
        if turns(&at_rot) {
            at.insert("rot".into(), nums(&euler(&turned(&at_rot))));
        }
        let mut item = json!({"id": ids[i], "kind": "group@1", "layer": "main", "name": l.name, "order": order(i), "at": at, "params": {}});
        if let Some(at) = rides {
            item["parent"] = json!(at.holder);
        }
        items.insert(ids[i].clone(), item);
        let Some(kind) = kinds[i] else { continue };
        let mut body = Map::from_iter([
            ("kind".to_string(), json!(kind)),
            (
                "pose".to_string(),
                json!({"pos": nums(&apply(&R, pos)), "rot": nums(&quat(&turned(&rot)))}),
            ),
        ]);
        let held_shapes = uses.remove(ids[i].as_str()).unwrap_or_default();
        if let Some(inertial) = &l.inertial {
            body.insert("mass".into(), num(inertial.mass));
            if let Some(t) = inertial.tensor {
                // The file's tensor is about the inertial frame's axes; the body's three moments
                // are about its own, so it has a place only where no product is left.
                let q = turned(&rpy(inertial.origin.rpy));
                let m = mul(
                    &q,
                    &mul(
                        &turned(&[[t[0], t[1], t[2]], [t[1], t[3], t[4]], [t[2], t[4], t[5]]]),
                        &transpose(&q),
                    ),
                );
                let moments = [m[0][0], m[1][1], m[2][2]];
                let largest = moments.iter().fold(0.0, |a: f64, b| a.max(b.abs()));
                if moments.iter().all(|x| *x > 0.0)
                    && [m[0][1], m[0][2], m[1][2]]
                        .iter()
                        .all(|p| p.abs() <= 1e-9 * largest)
                {
                    body.insert("inertia".into(), nums(&moments));
                } else {
                    extra.push(Dropped {
                        element: "inertia".into(),
                        name: l.name.clone(),
                    });
                }
            }
            // The centre its shapes give a body with none is its origin, so one written there says nothing.
            if !held_shapes.is_empty() || inertial.origin.xyz != [0.0; 3] {
                body.insert(
                    "centre_of_mass".into(),
                    nums(&apply(&R, inertial.origin.xyz)),
                );
            }
        }
        body.insert("shapes".into(), Value::Array(held_shapes));
        bodies.insert(ids[i].clone(), Value::Object(body));
    }

    let world = id(&robot.name, "robot", &mut BTreeSet::new());
    let mut joints = Map::new();
    let mut joint_ids = BTreeSet::new();
    let mut speeds = Vec::new();
    for (j, joint) in robot.joints.iter().enumerate() {
        let (p, c) = (index[joint.parent.as_str()], index[joint.child.as_str()]);
        let kind = match joint.kind {
            Kind::Revolute | Kind::Continuous => "hinge",
            Kind::Prismatic => "slider",
            Kind::Fixed => "fixed",
            Kind::Unplaced => continue,
        };
        // A joint holds a link that is a body of its own; a frame's joint is its place on its body.
        if kinds[c] != Some("dynamic") || unplaced.contains(&j) {
            continue;
        }
        let joint_id = id(&joint.name, "joint", &mut joint_ids);
        let at = on(p);
        let rot = mul(&at.rot, &rpy(joint.origin.rpy));
        let mut a = Map::from_iter([(
            "anchor".to_string(),
            nums(&apply(&R, add(at.pos, apply(&at.rot, joint.origin.xyz)))),
        )]);
        let mut b = Map::from_iter([("anchor".to_string(), nums(&[0.0; 3]))]);
        let mut out = Map::from_iter([
            ("kind".to_string(), json!(kind)),
            ("a".to_string(), json!(at.holder)),
            ("b".to_string(), json!(ids[c])),
            ("articulated".to_string(), json!(true)),
        ]);
        if joint.kind != Kind::Fixed {
            let length = ops::sqrt(joint.axis.iter().map(|x| x * x).sum());
            if length <= TINY {
                return Err(format!(
                    "the joint {}'s axis has no length; {nothing}",
                    joint.name
                ));
            }
            let axis = joint.axis.map(|x| x / length);
            a.insert("axis".into(), nums(&apply(&R, apply(&rot, axis))));
            b.insert("axis".into(), nums(&apply(&R, axis)));
            // joint@1's motor has a most it pushes and no most it runs at, so the file's speed
            // limit is kept in the report, in our units: deg/s on a hinge, m/s on a slider.
            if joint.speed > 0.0 {
                let max = if joint.kind == Kind::Prismatic {
                    joint.speed
                } else {
                    ops::deg(joint.speed)
                };
                speeds.push(json!({"joint": joint_id, "max": num(max)}));
            }
            // The file's effort limit is the most its motor pushes; the motor holds the joint still.
            if joint.effort > 0.0 {
                let most = if joint.kind == Kind::Prismatic {
                    "max_force"
                } else {
                    "max_torque"
                };
                out.insert(
                    "motor".into(),
                    json!({"mode": "velocity", "target": 0, most: num(joint.effort)}),
                );
            }
        }
        match joint.kind {
            Kind::Prismatic => {
                out.insert(
                    "limits".into(),
                    json!({"min": num(joint.lower), "max": num(joint.upper)}),
                );
            }
            // A hinge's range is under 360°, so a wider one has no place.
            Kind::Revolute if ops::deg(joint.upper - joint.lower) < 360.0 => {
                out.insert(
                    "limits".into(),
                    json!({"min": num(ops::deg(joint.lower)), "max": num(ops::deg(joint.upper))}),
                );
            }
            Kind::Revolute => extra.push(Dropped {
                element: "limit".into(),
                name: joint.name.clone(),
            }),
            _ => {}
        }
        out.insert("frame_a".into(), Value::Object(a));
        out.insert("frame_b".into(), Value::Object(b));
        joints.insert(joint_id, Value::Object(out));
    }

    // Each body writes its pose to its link's item, so what is drawn moves as the world does.
    let outputs: Map<String, Value> = bodies
        .keys()
        .map(|b| {
            (
                b.clone(),
                json!({"from": b, "read": "pose", "to": format!("items/{b}/at")}),
            )
        })
        .collect();
    let capacity = json!({"bodies": bodies.len(), "shapes": shapes.len(), "joints": joints.len(), "contacts": 4 * shapes.len(), "particles": 0});
    let mut physics = json!({"kind": "physics.world@1", "capacity": capacity, "shapes": shapes, "bodies": bodies, "joints": joints, "outputs": outputs});
    // A centre of mass has a place only within the bounds of its body's shapes: one the physics
    // check refuses is left out and listed.
    let refused = check::check(&physics, caps::asked(&physics), &roles::TABLE).err();
    for r in refused.into_iter().flatten() {
        let body = r
            .path
            .strip_prefix("bodies/")
            .and_then(|p| p.strip_suffix("/centre_of_mass"));
        let Some(i) = body.and_then(|b| ids.iter().position(|id| id == b)) else {
            continue;
        };
        if let Some(b) = physics["bodies"][&ids[i]].as_object_mut() {
            b.remove("centre_of_mass");
            extra.push(Dropped {
                element: "origin".into(),
                name: links[i].name.clone(),
            });
        }
    }
    dropped.extend(extra.iter());
    let document = json!({
        "format": 1,
        "id": world,
        "title": robot.name,
        "description": format!("A robot description imported as a document: {} links, {} joints.", links.len(), joints.len()),
        "profile": "scene",
        "size": [1280, 720],
        "look": {"asset": "clean@1", "theme": "light"},
        "assets": {"clean": {"license": "Apache-2.0", "sha256": look}},
        "layers": {"main": {"order": "a0", "title": "Robot description import", "writer": "import"}},
        "items": items,
        "worlds": {world.as_str(): physics},
    });
    let report = json!({
        "rotation": nums(&quat(&R)),
        "speed_limits": speeds,
        "dropped": dropped.iter().map(|d| json!({"element": d.element, "name": d.name})).collect::<Vec<_>>(),
    });
    Ok((document, report))
}
