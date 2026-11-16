//! Material: water's flow (#968): the water runs along a `curve@1` (its tangent at the nearest
//! point) or a vec2 field over x and z, at `speed` m/s. The ripples' and the foam's noise moves
//! along it in two phases half a `cycle` apart, blended by triangle weights that are 0 where each
//! phase wraps, so the surface travels downstream with no visible jump; where the flow is faster
//! than the foam's `speed`, foam covers the water. The flow over the water's plates is sampled at
//! check onto a grid the renderer reads; everything stays a closed form of position and t.

use deep_canvas::ops::sqrt;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::scene::Refused;
use crate::surface::F;

/// The most cells the flow's grid holds along each side.
pub const SIDE: u32 = 128;

/// What the water runs along.
#[derive(Clone, Debug, PartialEq)]
pub enum Along {
    /// A `curve@1` item, by ID: its tangent at the nearest point, in the water's plane.
    Curve(String),
    /// A field over x and z: its x and z expressions and their named numbers.
    Field {
        x: String,
        z: String,
        vars: Map<String, Value>,
    },
}

/// A water's `flow`, as parsed, with its grid once sampled.
#[derive(Clone, Debug, PartialEq)]
pub struct Flow {
    pub along: Along,
    /// m/s: the curve's flow speed, or the field's scale.
    pub speed: f64,
    /// s: each phase's period.
    pub cycle: f64,
    pub grid: Option<Grid>,
}

/// The flow's velocity over the plates at rest, in m/s, a cell a value, rows along z; the renderer
/// reads it bilinearly between cell centres.
#[derive(Clone, Debug, PartialEq)]
pub struct Grid {
    /// SHA-256 of the grid's placement and values.
    pub key: String,
    /// World x and z of cell (0, 0)'s corner, the cell's side in m, and the cells along x and z.
    pub origin: [f64; 2],
    pub cell: f64,
    pub dims: [u32; 2],
    pub cells: Vec<[f32; 2]>,
}

fn bad(code: &'static str, path: String) -> Refused {
    Refused { code, path }
}

/// Reads a water's `flow` (`none` or absent: still water).
pub fn parse(material: &str, spec: Option<&Value>) -> Result<Option<Flow>, Refused> {
    let at = |k: &str| format!("items/{material}/params/water/flow{k}");
    let spec = match spec {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::String(s)) if s == "none" => return Ok(None),
        Some(s @ Value::Object(_)) => s,
        Some(_) => return Err(bad("out_of_range", at(""))),
    };
    let num = |k: &str, default: f64, range: [f64; 2]| -> Result<f64, Refused> {
        match spec.get(k) {
            None | Some(Value::Null) => Ok(default),
            Some(v) => v
                .as_f64()
                .filter(|x| x.is_finite() && *x >= range[0] && *x <= range[1])
                .ok_or_else(|| bad("out_of_range", at(&format!("/{k}")))),
        }
    };
    let along = match spec.get("along") {
        Some(Value::String(id)) => Along::Curve(id.clone()),
        Some(Value::Object(f)) => {
            let text = |k: &str| {
                f.get(k)
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .ok_or_else(|| bad("bad_input", at(&format!("/along/{k}"))))
            };
            Along::Field {
                x: text("x")?,
                z: text("z")?,
                vars: f
                    .get("vars")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default(),
            }
        }
        _ => return Err(bad("bad_input", at("/along"))),
    };
    Ok(Some(Flow {
        along,
        speed: num("speed", 1.0, [0.0, 1e3])?,
        cycle: num("cycle", 2.0, [1e-3, 1e4])?,
        grid: None,
    }))
}

/// The flow sampled at each cell centre of a grid over the plates `plates` ([min x, min z, max x,
/// max z] at rest), at most [`SIDE`] cells a side. A curve that isn't a `curve@1` is
/// `ref_unresolved`; a field whose expressions don't compile is refused, naming it.
pub fn grid(
    doc: &Map<String, Value>,
    material: &str,
    flow: &Flow,
    plates: &[[f64; 4]],
) -> Result<Grid, Refused> {
    let at = |k: &str| format!("items/{material}/params/water/flow/along{k}");
    let mut lo = [f64::INFINITY; 2];
    let mut hi = [f64::NEG_INFINITY; 2];
    for p in plates {
        lo = [lo[0].min(p[0]), lo[1].min(p[1])];
        hi = [hi[0].max(p[2]), hi[1].max(p[3])];
    }
    if !(lo[0] <= hi[0] && lo[1] <= hi[1]) {
        lo = [0.0; 2];
        hi = [0.0; 2];
    }
    let cell = ((hi[0] - lo[0]).max(hi[1] - lo[1]) / f64::from(SIDE)).max(1e-3);
    let side = |a: f64, b: f64| ((((b - a) / cell) - 1e-9).ceil() as u32).clamp(1, SIDE);
    let dims = [side(lo[0], hi[0]), side(lo[1], hi[1])];
    let centre = |i: u32, j: u32| {
        [
            lo[0] + (f64::from(i) + 0.5) * cell,
            lo[1] + (f64::from(j) + 0.5) * cell,
        ]
    };
    let mut cells = Vec::with_capacity((dims[0] * dims[1]) as usize);
    match &flow.along {
        Along::Curve(id) => {
            let item = doc
                .get("items")
                .and_then(|i| i.get(id))
                .filter(|i| i.get("kind").and_then(Value::as_str) == Some("curve@1"))
                .ok_or_else(|| bad("ref_unresolved", at("")))?;
            let line = crate::curve::sample(item.get("params").unwrap_or(&Value::Null))
                .map_err(|_| bad("bad_input", at("")))?;
            let mut points: Vec<[f64; 2]> = line.points.iter().map(|p| [p[0], p[2]]).collect();
            if line.closed && !points.is_empty() {
                points.push(points[0]);
            }
            let segs: Vec<([f64; 2], [f64; 2], f64)> = points
                .windows(2)
                .filter_map(|w| {
                    let d = [w[1][0] - w[0][0], w[1][1] - w[0][1]];
                    let l2 = d[0] * d[0] + d[1] * d[1];
                    (l2 > 0.0).then_some((w[0], d, l2))
                })
                .collect();
            if segs.is_empty() {
                return Err(bad("bad_input", at("")));
            }
            for j in 0..dims[1] {
                for i in 0..dims[0] {
                    let q = centre(i, j);
                    let mut best = (f64::INFINITY, [0.0; 2]);
                    for (a, d, l2) in &segs {
                        let h =
                            (((q[0] - a[0]) * d[0] + (q[1] - a[1]) * d[1]) / l2).clamp(0.0, 1.0);
                        let (ex, ez) = (q[0] - a[0] - d[0] * h, q[1] - a[1] - d[1] * h);
                        let e = ex * ex + ez * ez;
                        if e < best.0 {
                            let l = sqrt(*l2);
                            best = (e, [d[0] / l, d[1] / l]);
                        }
                    }
                    cells.push(best.1.map(|v| (v * flow.speed) as f32));
                }
            }
        }
        Along::Field { x, z, vars } => {
            let free = ["x", "z"];
            let fx = F::compile(Some(&Value::String(x.clone())), &free, vars, "x")
                .map_err(|_| bad("bad_input", at("/x")))?;
            let fz = F::compile(Some(&Value::String(z.clone())), &free, vars, "z")
                .map_err(|_| bad("bad_input", at("/z")))?;
            for j in 0..dims[1] {
                for i in 0..dims[0] {
                    let q = centre(i, j);
                    let v = [fx.at(&q), fz.at(&q)];
                    if !v.iter().all(|c| c.is_finite()) {
                        return Err(bad("out_of_range", at("")));
                    }
                    cells.push(v.map(|c| (c * flow.speed) as f32));
                }
            }
        }
    }
    let mut h = Sha256::new();
    h.update(b"flow@1");
    for v in [lo[0], lo[1], cell] {
        h.update(v.to_bits().to_le_bytes());
    }
    h.update(dims[0].to_le_bytes());
    h.update(dims[1].to_le_bytes());
    for v in cells.iter().flatten() {
        h.update(v.to_le_bytes());
    }
    Ok(Grid {
        key: h.finalize().iter().map(|b| format!("{b:02x}")).collect(),
        origin: lo,
        cell,
        dims,
        cells,
    })
}
