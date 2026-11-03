//! A builder's modifier stack (canvas primitives: Modifier; issue #420): pure steps on the
//! built mesh, top to bottom in the order the item declares, each of a class its kind fixes
//! (`deform` moves points, `generate` makes new ones), reading time only where a channel binds
//! one of its params. A modifier with `enabled: false` is skipped and reads nothing.

use deep_canvas::ops::{cos, rad, sin};
use serde_json::{json, Value};

use crate::builders::{path, Fault};
use crate::geom::{add, cross, dot, scale, sub, unit, Mesh, V3};

/// The modifier kinds builders take, with their class.
pub const KINDS: [(&str, &str); 4] = [
    ("mod.array@1", "generate"),
    ("mod.mirror@1", "generate"),
    ("mod.curve_deform@1", "deform"),
    ("mod.simple_deform@1", "deform"),
];

/// One modifier as the `geometry` call lists it.
#[derive(Clone, Debug, PartialEq)]
pub struct Row {
    pub kind: String,
    pub class: &'static str,
    pub reads_time: bool,
    pub enabled: bool,
}

impl Row {
    pub fn to_json(&self) -> Value {
        json!({"kind": self.kind, "class": self.class, "reads_time": self.reads_time, "enabled": self.enabled})
    }
}

/// Whether a channel or driver of `doc` binds a param of the item's modifier `k`.
pub fn reads_time(doc: &Value, id: &str, k: usize) -> bool {
    let prefix = format!("items/{id}/modifiers/{k}/");
    ["channels", "drivers"].iter().any(|section| {
        doc.get(*section)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .any(|(_, c)| {
                c.get("target")
                    .and_then(Value::as_str)
                    .is_some_and(|t| t.starts_with(&prefix))
            })
    })
}

fn enabled(m: &Value) -> bool {
    m.get("enabled").and_then(Value::as_bool).unwrap_or(true)
}

/// The items an item's modifiers name (a `curve_deform`'s path), each enabled one's; the
/// planted `keeps_disabled_refs` keeps a disabled one's too (AC9's wrong program).
pub fn refs(item: &Value, planted: Option<&str>) -> Vec<String> {
    let keep_disabled = planted == Some("keeps_disabled_refs");
    item.get("modifiers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|m| keep_disabled || enabled(m))
        .filter_map(|m| {
            m.pointer("/params/path")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .collect()
}

/// The vertices the stack leaves of `vertices`, counted from its params alone.
pub fn estimate(vertices: u64, item: &Value) -> Result<u64, Fault> {
    let mut n = vertices;
    for (k, m) in list(item).iter().enumerate() {
        if !enabled(m) {
            continue;
        }
        let at = |f: &str| format!("modifiers/{k}/params/{f}");
        match m.get("kind").and_then(Value::as_str).unwrap_or("") {
            "mod.array@1" => n *= array_count(m).ok_or_else(|| at("count"))?,
            "mod.mirror@1" => n <<= axes(m).ok_or_else(|| at("axes"))?.len(),
            _ => {}
        }
    }
    Ok(n)
}

fn list(item: &Value) -> Vec<Value> {
    item.get("modifiers")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn array_count(m: &Value) -> Option<u64> {
    m.pointer("/params/count")
        .and_then(Value::as_u64)
        .filter(|c| (1..=1024).contains(c))
}

fn axes(m: &Value) -> Option<Vec<usize>> {
    m.pointer("/params/axes")?
        .as_array()?
        .iter()
        .map(|a| match a.as_str()? {
            "x" => Some(0),
            "y" => Some(1),
            "z" => Some(2),
            _ => None,
        })
        .collect()
}

fn vec3(v: Option<&Value>) -> Option<V3> {
    let a = v?.as_array().filter(|a| a.len() == 3)?;
    Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?])
}

/// Each modifier of `item` applied to `mesh` in its declared order, with the rows that say
/// what each is; why one can't apply, by its path under the item.
pub fn apply(mesh: Mesh, item: &Value, doc: &Value, id: &str) -> Result<(Mesh, Vec<Row>), Fault> {
    let mut m = mesh;
    let mut rows = Vec::new();
    for (k, modifier) in list(item).iter().enumerate() {
        let kind = modifier
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let at = |f: &str| format!("modifiers/{k}/{f}");
        let class = KINDS
            .iter()
            .find(|(n, _)| *n == kind)
            .map(|(_, c)| *c)
            .ok_or_else(|| at("kind"))?;
        let on = enabled(modifier);
        rows.push(Row {
            kind: kind.clone(),
            class,
            reads_time: reads_time(doc, id, k),
            enabled: on,
        });
        if !on {
            continue;
        }
        let params = modifier.get("params").cloned().unwrap_or(json!({}));
        m = match kind.as_str() {
            "mod.array@1" => {
                let count = array_count(modifier).ok_or_else(|| at("params/count"))?;
                let offset = match params.get("offset") {
                    None => [0.0; 3],
                    v => vec3(v).ok_or_else(|| at("params/offset"))?,
                };
                let mut out = m.clone();
                for c in 1..count {
                    let shift = scale(offset, c as f64);
                    out.append(&m.mapped(|p| add(p, shift), |_, n| n), &format!(".{c}"));
                }
                out
            }
            "mod.mirror@1" => {
                let mut out = m;
                for axis in axes(modifier).ok_or_else(|| at("params/axes"))? {
                    let flip = |mut p: V3| {
                        p[axis] = -p[axis];
                        p
                    };
                    let reflected = out.mapped(flip, |_, n| flip(n)).turned();
                    let suffix = format!(".m{}", ["x", "y", "z"][axis]);
                    out.append(&reflected, &suffix);
                }
                out
            }
            "mod.curve_deform@1" => {
                let curve = path(doc, params.get("path")).ok_or_else(|| at("params/path"))?;
                let axis = match params.get("axis").and_then(Value::as_str).unwrap_or("x") {
                    "x" => 0,
                    "y" => 1,
                    "z" => 2,
                    _ => return Err(at("params/axis")),
                };
                curve_deform(&m, &curve, axis)
            }
            "mod.simple_deform@1" => {
                let amount = params
                    .get("amount")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| at("params/amount"))?;
                let mode = params
                    .get("mode")
                    .and_then(Value::as_str)
                    .unwrap_or("twist");
                match mode {
                    "twist" | "bend" | "taper" | "stretch" => simple_deform(&m, mode, amount),
                    _ => return Err(at("params/mode")),
                }
            }
            _ => return Err(at("kind")),
        };
    }
    Ok((m, rows))
}

/// The mesh laid along the curve: its coordinate along `axis`, from its least, becomes arc
/// length, and the other two its offsets across the curve's frame.
fn curve_deform(m: &Mesh, curve: &crate::curve::Sampled, axis: usize) -> Mesh {
    let low = m.bounds()[0][axis];
    let (o1, o2) = ((axis + 1) % 3, (axis + 2) % 3);
    let frame = |s: f64| -> (V3, V3, V3, V3) {
        let (c, t) = curve.at(s);
        let up = if t[1].abs() < 0.9 {
            [0.0, 1.0, 0.0]
        } else {
            [0.0, 0.0, 1.0]
        };
        let n = unit(sub(up, scale(t, dot(up, t))));
        (c, t, n, cross(t, n))
    };
    // Along x the frame's normal is the item's y and its binormal z; the other axes turn with it.
    let place = |p: V3| -> V3 {
        let (c, _, n, b) = frame(p[axis] - low);
        let (u, w) = if axis == 0 {
            (p[1], p[2])
        } else {
            (p[o1], p[o2])
        };
        add(c, add(scale(n, u), scale(b, w)))
    };
    m.mapped(place, |p, nrm| {
        let (_, t, n, b) = frame(p[axis] - low);
        let (u, w) = if axis == 0 {
            (nrm[1], nrm[2])
        } else {
            (nrm[o1], nrm[o2])
        };
        add(scale(t, nrm[axis]), add(scale(n, u), scale(b, w)))
    })
}

/// Twist about y, bend about z, taper across y or stretch along y, by `amount` (degrees per
/// metre for twist and bend, per metre for taper, a fraction for stretch).
fn simple_deform(m: &Mesh, mode: &str, amount: f64) -> Mesh {
    let f = |p: V3| -> V3 {
        match mode {
            "twist" => {
                let a = rad(amount * p[1]);
                [
                    p[0] * cos(a) - p[2] * sin(a),
                    p[1],
                    p[0] * sin(a) + p[2] * cos(a),
                ]
            }
            "bend" => {
                let a = rad(amount * p[0]);
                [
                    p[0] * cos(a) - p[1] * sin(a),
                    p[0] * sin(a) + p[1] * cos(a),
                    p[2],
                ]
            }
            "taper" => {
                let k = 1.0 + amount * p[1];
                [p[0] * k, p[1], p[2] * k]
            }
            _ => [p[0], p[1] * (1.0 + amount), p[2]],
        }
    };
    let mut out = m.mapped(f, |_, n| n);
    // Normals from the moved faces: flat per triangle, accumulated at shared vertices.
    let mut acc = vec![[0.0; 3]; out.positions.len()];
    for t in 0..out.triangles() {
        let [a, b, c] = [0, 1, 2].map(|j| out.indices[3 * t + j] as usize);
        let n = cross(
            sub(out.positions[b], out.positions[a]),
            sub(out.positions[c], out.positions[a]),
        );
        for v in [a, b, c] {
            acc[v] = add(acc[v], n);
        }
    }
    out.normals = acc.into_iter().map(unit).collect();
    out
}
