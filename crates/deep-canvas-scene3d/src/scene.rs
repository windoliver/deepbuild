//! A document at t as the GPU layer draws it (canvas primitives: Marks in 3D; Object; Overlay):
//! the evaluated camera with its reversed-Z projection, each 3D writer layer's marks in item
//! order, and the 2D overlays anchored to 3D points. Everything is f64 through the ops module,
//! a pure function of the document, the look and t, so seeking equals playing.
//!
//! Conventions (canvas primitives: Units and axes): meters, right-handed, +Y up; an item's `at`
//! is `pos`, `rot` (degrees about X, then Y, then Z) and `scale`, composed with its parents'.
//! Box, cylinder and sphere are unit meshes, 1 m across and centred on the item's origin, scaled
//! by `size`; a cylinder's axis is +Y.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas::camera::{screen_basis, Offsets, Spec, Vec3};
use deep_canvas::kinds::with_defaults;
use deep_canvas::ops::{cos, rad, sin, sqrt, tan};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::Program;
use deep_text::{Role, Shaper};
use serde_json::{Map, Value};
use vello_cpu::Resources;

use crate::label::{mask, Mask};
use crate::look::Look3;

/// Why a document can't be drawn: a closed-list code and the path it names.
#[derive(Clone, Debug, PartialEq)]
pub struct Refused {
    pub code: &'static str,
    pub path: String,
}

fn refused<T>(code: &'static str, path: impl Into<String>) -> Result<T, Refused> {
    Err(Refused {
        code,
        path: path.into(),
    })
}

/// The scene3d kinds this subset draws, `family.name@major`.
pub const KINDS: [&str; 6] = [
    "mark.box@1",
    "mark.cylinder@1",
    "mark.sphere@1",
    "mark.line@1",
    "mark.point@1",
    "mark.text@1",
];

/// The 2D overlay a 3D writer layer's anchor places, drawn by scene3d too.
pub const OVERLAY: &str = "overlay.frame@1";

/// Whether an item of `kind` (its text, `family.name@major`) is one of scene3d's marks.
pub fn is_3d(kind: &str) -> bool {
    KINDS.contains(&kind)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Shape {
    Box,
    Cylinder,
    Sphere,
}

/// An object: one instance record, a 3×4 world matrix (rows), its paint and its item.
#[derive(Clone, Debug, PartialEq)]
pub struct Solid {
    pub id: String,
    pub shape: Shape,
    pub model: [[f64; 4]; 3],
    pub color: [u8; 3],
}

/// One segment of a line, its ends' widths in its size space.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    pub a: Vec3,
    pub b: Vec3,
    pub wa: f64,
    pub wb: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    pub id: String,
    pub segments: Vec<Segment>,
    /// Widths in m (`size_space: world`), else in px.
    pub world: bool,
    pub color: [u8; 3],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PointShape {
    Dot,
    Square,
    Diamond,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Point {
    pub id: String,
    pub pos: Vec3,
    /// Across, in px, or in m with `world`.
    pub size: f64,
    pub world: bool,
    pub shape: PointShape,
    pub color: [u8; 3],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Facing {
    Camera,
    Upright,
    Fixed,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Label {
    pub id: String,
    /// The mask's key: the text and its font role.
    pub key: (String, String),
    pub mask: Arc<Mask>,
    pub pos: Vec3,
    /// The quad's width and height, in m with `world`, else in px.
    pub quad: [f64; 2],
    pub world: bool,
    pub facing: Facing,
    /// The item's own axes, for `facing: fixed`: its rotation applied to +X and +Y.
    pub axes: [Vec3; 2],
    pub color: [u8; 3],
}

/// A 3D writer layer's marks, each family in item order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Layer3 {
    pub id: String,
    pub solids: Vec<Solid>,
    pub lines: Vec<Line>,
    pub points: Vec<Point>,
    pub labels: Vec<Label>,
}

impl Layer3 {
    /// Every item it draws, in its families' order.
    pub fn items(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        out.extend(self.solids.iter().map(|s| s.id.clone()));
        out.extend(self.lines.iter().map(|s| s.id.clone()));
        out.extend(self.points.iter().map(|s| s.id.clone()));
        out.extend(self.labels.iter().map(|s| s.id.clone()));
        out
    }
}

/// A 2D shape in an overlay's frame, in px from the frame's origin.
#[derive(Clone, Debug, PartialEq)]
pub enum Shape2 {
    Circle {
        center: [f64; 2],
        r: f64,
        color: [u8; 3],
    },
    Rect {
        rect: [f64; 4],
        color: [u8; 3],
    },
}

/// A 2D writer layer's overlay anchored to a 3D point: its frame's origin in view px at the
/// anchor's projection plus the offset, or `None` while the point is behind the camera.
#[derive(Clone, Debug, PartialEq)]
pub struct Overlay {
    pub id: String,
    pub layer: String,
    pub origin: Option<[f64; 2]>,
    pub shapes: Vec<Shape2>,
}

/// How the depth target is laid out: reversed Z with an infinite far plane (the design's), or
/// the forward-Z twin with a finite far plane.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Depth {
    Reversed,
    Forward { far: f64 },
}

/// The evaluated camera on a frame of `size` px.
#[derive(Clone, Debug, PartialEq)]
pub struct Camera {
    pub size: [f64; 2],
    pub eye: Vec3,
    pub right: Vec3,
    pub up: Vec3,
    pub forward: Vec3,
    pub perspective: bool,
    /// The focal length in px (perspective), or px per m.
    pub scale: f64,
    pub centre: [f64; 2],
    pub roll: [f64; 2],
    pub near: f64,
    /// An orthographic view's far distance, from the bounds; perspective views have none.
    pub far: f64,
}

fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn mul(a: Vec3, s: f64) -> Vec3 {
    [a[0] * s, a[1] * s, a[2] * s]
}
fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn normalize(a: Vec3) -> Vec3 {
    let l = sqrt(dot(a, a));
    if l > 0.0 {
        mul(a, 1.0 / l)
    } else {
        a
    }
}

impl Camera {
    /// A point in the view's frame: right, up, and depth along the forward axis from the eye.
    pub fn to_view(&self, p: Vec3) -> Vec3 {
        let d = sub(p, self.eye);
        [dot(d, self.right), dot(d, self.up), dot(d, self.forward)]
    }

    /// Where a point lands in px (x right, y down) with its depth, or `None` behind a
    /// perspective eye.
    pub fn project(&self, p: Vec3) -> Option<[f64; 3]> {
        let [vx, vy, vz] = self.to_view(p);
        let s = if self.perspective {
            if vz <= 0.0 {
                return None;
            }
            self.scale / vz
        } else {
            self.scale
        };
        let (x, y) = (vx * s, -vy * s);
        let [c, sn] = self.roll;
        Some([
            self.centre[0] + x * c - y * sn,
            self.centre[1] + x * sn + y * c,
            vz,
        ])
    }

    /// Px per m at depth `vz`.
    pub fn px_per_m(&self, vz: f64) -> f64 {
        if self.perspective {
            self.scale / vz.max(1e-9)
        } else {
            self.scale
        }
    }

    /// The world-to-clip matrix, rows for clip x, y, z and w over (x, y, z, 1): the projection
    /// above, with depth laid out as `depth` says.
    pub fn clip(&self, depth: Depth) -> [[f64; 4]; 4] {
        let row = |axis: Vec3| -> [f64; 4] { [axis[0], axis[1], axis[2], -dot(axis, self.eye)] };
        let (vx, vy, vz) = (row(self.right), row(self.up), row(self.forward));
        let [w, h] = self.size;
        let [c, sn] = self.roll;
        let (ox, oy) = (self.centre[0] - w / 2.0, self.centre[1] - h / 2.0);
        let s = self.scale;
        let comb = |a: f64, x: [f64; 4], b: f64, y: [f64; 4], k: f64, z: [f64; 4], e: f64| {
            [
                a * x[0] + b * y[0] + k * z[0],
                a * x[1] + b * y[1] + k * z[1],
                a * x[2] + b * y[2] + k * z[2],
                a * x[3] + b * y[3] + k * z[3] + e,
            ]
        };
        // Perspective multiplies the constant offsets through by w = vz; orthographic keeps w 1.
        let (kx, ky, ex, ey) = if self.perspective {
            (ox, -oy, 0.0, 0.0)
        } else {
            (0.0, 0.0, ox, -oy)
        };
        let cx = comb(
            s * c / (w / 2.0),
            vx,
            s * sn / (w / 2.0),
            vy,
            kx / (w / 2.0),
            vz,
            ex / (w / 2.0),
        );
        let cy = comb(
            -s * sn / (h / 2.0),
            vx,
            s * c / (h / 2.0),
            vy,
            ky / (h / 2.0),
            vz,
            ey / (h / 2.0),
        );
        let (cz, cw) = if self.perspective {
            let cz = match depth {
                // depth = near ÷ vz: 1 at the near plane, toward 0 at infinity.
                Depth::Reversed => [0.0, 0.0, 0.0, self.near],
                // depth = f(vz − n) ÷ (vz(f − n)).
                Depth::Forward { far } => {
                    let k = far / (far - self.near);
                    [vz[0] * k, vz[1] * k, vz[2] * k, vz[3] * k - self.near * k]
                }
            };
            (cz, vz)
        } else {
            let (n, f) = match depth {
                Depth::Reversed => (self.near, self.far),
                Depth::Forward { far } => (self.near, far),
            };
            let k = 1.0 / (f - n);
            let cz = match depth {
                Depth::Reversed => [-vz[0] * k, -vz[1] * k, -vz[2] * k, (f - vz[3]) * k],
                Depth::Forward { .. } => [vz[0] * k, vz[1] * k, vz[2] * k, (vz[3] - n) * k],
            };
            (cz, [0.0, 0.0, 0.0, 1.0])
        };
        [cx, cy, cz, cw]
    }
}

/// Labels' masks, shaped and rasterized once per text and font role.
pub struct Labels {
    shaper: Shaper,
    resources: Resources,
    masks: BTreeMap<(String, String), Arc<Mask>>,
}

impl Default for Labels {
    fn default() -> Self {
        Self::new()
    }
}

impl Labels {
    pub fn new() -> Self {
        Labels {
            shaper: Shaper::new(),
            resources: Resources::new(),
            masks: BTreeMap::new(),
        }
    }

    fn get(&mut self, text: &str, role: Role) -> Arc<Mask> {
        let key = (text.to_string(), role.name().to_string());
        if let Some(m) = self.masks.get(&key) {
            return m.clone();
        }
        let m = Arc::new(mask(&mut self.shaper, &mut self.resources, text, role));
        self.masks.insert(key, m.clone());
        m
    }
}

/// A document at t, as the GPU layer draws it.
#[derive(Clone, Debug, PartialEq)]
pub struct Scene {
    pub size: [u32; 2],
    pub camera: Camera,
    pub ground: [u8; 3],
    /// The 3D writer layers that draw something, in layer order.
    pub layers: Vec<Layer3>,
    pub overlays: Vec<Overlay>,
}

fn num(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|x| x.is_finite())
}

fn vec3(v: Option<&Value>) -> Option<Vec3> {
    let a = v?.as_array()?;
    if a.len() != 3 {
        return None;
    }
    Some([num(a.first())?, num(a.get(1))?, num(a.get(2))?])
}

/// A size: three numbers, or one for all three.
fn size3(v: Option<&Value>, default: Vec3) -> Option<Vec3> {
    match v {
        None | Some(Value::Null) => Some(default),
        Some(Value::Number(n)) => {
            let s = n.as_f64()?;
            Some([s, s, s])
        }
        other => vec3(other),
    }
}

/// `x ↦ R·S·x + T` as rows of a 3×4 matrix.
type Affine3 = [[f64; 4]; 3];

fn matmul(a: &Affine3, b: &Affine3) -> Affine3 {
    let mut out = [[0.0; 4]; 3];
    for (r, row) in out.iter_mut().enumerate() {
        for (c, cell) in row.iter_mut().enumerate() {
            let mut v = a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c];
            if c == 3 {
                v += a[r][3];
            }
            *cell = v;
        }
    }
    out
}

fn apply(m: &Affine3, p: Vec3) -> Vec3 {
    [
        m[0][0] * p[0] + m[0][1] * p[1] + m[0][2] * p[2] + m[0][3],
        m[1][0] * p[0] + m[1][1] * p[1] + m[1][2] * p[2] + m[1][3],
        m[2][0] * p[0] + m[2][1] * p[1] + m[2][2] * p[2] + m[2][3],
    ]
}

fn turn(m: &Affine3, d: Vec3) -> Vec3 {
    [
        m[0][0] * d[0] + m[0][1] * d[1] + m[0][2] * d[2],
        m[1][0] * d[0] + m[1][1] * d[1] + m[1][2] * d[2],
        m[2][0] * d[0] + m[2][1] * d[1] + m[2][2] * d[2],
    ]
}

/// An item's own `at`: scale, then rotate about X, Y and Z in turn, then move to `pos`.
fn local(item: &Value, extra_scale: Vec3) -> Affine3 {
    let at = item.get("at");
    let pos = vec3(at.and_then(|a| a.get("pos"))).unwrap_or([0.0; 3]);
    let rot = vec3(at.and_then(|a| a.get("rot"))).unwrap_or([0.0; 3]);
    let sc = size3(at.and_then(|a| a.get("scale")), [1.0; 3]).unwrap_or([1.0; 3]);
    let (cx, sx) = (cos(rad(rot[0])), sin(rad(rot[0])));
    let (cy, sy) = (cos(rad(rot[1])), sin(rad(rot[1])));
    let (cz, sz) = (cos(rad(rot[2])), sin(rad(rot[2])));
    // Rz · Ry · Rx
    let r = [
        [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
        [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
        [-sy, cy * sx, cy * cx],
    ];
    let s = [
        sc[0] * extra_scale[0],
        sc[1] * extra_scale[1],
        sc[2] * extra_scale[2],
    ];
    let mut m = [[0.0; 4]; 3];
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = r[i][j] * s[j];
        }
        m[i][3] = pos[i];
    }
    m
}

/// An item's world transform: its parents' composed over its own, without its size.
fn world(items: &Map<String, Value>, id: &str) -> Affine3 {
    let mut m = match items.get(id) {
        Some(item) => local(item, [1.0; 3]),
        None => {
            return [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
            ]
        }
    };
    let mut seen = vec![id.to_string()];
    let mut at = items
        .get(id)
        .and_then(|i| i.get("parent"))
        .and_then(Value::as_str);
    while let Some(p) = at {
        if seen.iter().any(|s| s == p) {
            break;
        }
        let Some(parent) = items.get(p) else { break };
        m = matmul(&local(parent, [1.0; 3]), &m);
        seen.push(p.to_string());
        at = parent.get("parent").and_then(Value::as_str);
    }
    m
}

fn origin(m: &Affine3) -> Vec3 {
    [m[0][3], m[1][3], m[2][3]]
}

fn paint(look: &Look3, params: &Value, path: &str) -> Result<[u8; 3], Refused> {
    let role = params
        .get("paint")
        .and_then(|p| p.get("fill"))
        .and_then(|f| f.get("role"))
        .and_then(Value::as_str);
    match role.and_then(|r| look.role(r)) {
        Some(c) => Ok(c),
        None => refused("ref_unresolved", format!("{path}/paint/fill/role")),
    }
}

fn order_key(item: &Value) -> String {
    item.get("order")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

/// An entry of a line's `points`: a point, or an item's evaluated anchor (its origin).
fn point_of(items: &Map<String, Value>, v: &Value, path: &str) -> Result<Vec3, Refused> {
    if let Some(p) = vec3(Some(v)) {
        return Ok(p);
    }
    let Some(handle) = v.as_str() else {
        return refused("out_of_range", path);
    };
    let id = handle.split('#').next().unwrap_or(handle);
    if !items.contains_key(id) {
        return refused("ref_unresolved", path);
    }
    Ok(origin(&world(items, id)))
}

/// The segments a mode draws over `n` points, as index pairs (Marks in 3D: lines).
pub fn segments(mode: &str, n: usize) -> Option<Vec<(usize, usize)>> {
    if n < 2 {
        return Some(Vec::new());
    }
    match mode {
        "strip" => Some((0..n - 1).map(|k| (k, k + 1)).collect()),
        "segments" => Some((0..n / 2).map(|k| (2 * k, 2 * k + 1)).collect()),
        "loop" => Some((0..n).map(|k| (k, (k + 1) % n)).collect()),
        _ => None,
    }
}

fn line(
    items: &Map<String, Value>,
    id: &str,
    params: &Value,
    look: &Look3,
) -> Result<Line, Refused> {
    let path = format!("items/{id}/params");
    let points = params
        .get("points")
        .and_then(Value::as_array)
        .map_or(Ok(Vec::new()), |list| {
            list.iter()
                .enumerate()
                .map(|(i, v)| point_of(items, v, &format!("{path}/points/{i}")))
                .collect::<Result<Vec<_>, _>>()
        })?;
    let n = points.len();
    let widths: Vec<f64> = match params.get("width") {
        None | Some(Value::Null) => vec![1.5; n],
        Some(Value::Array(w)) if w.len() == n => w
            .iter()
            .map(|x| num(Some(x)).filter(|&x| x >= 0.0))
            .collect::<Option<Vec<_>>>()
            .map_or_else(|| refused("out_of_range", format!("{path}/width")), Ok)?,
        Some(v) => match num(Some(v)).filter(|&x| x >= 0.0) {
            Some(w) => vec![w; n],
            None => return refused("out_of_range", format!("{path}/width")),
        },
    };
    let mode = params
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("strip");
    let Some(pairs) = segments(mode, n) else {
        return refused("out_of_range", format!("{path}/mode"));
    };
    let model = world(items, id);
    let segments = pairs
        .into_iter()
        .map(|(a, b)| Segment {
            a: apply(&model, points[a]),
            b: apply(&model, points[b]),
            wa: widths[a],
            wb: widths[b],
        })
        .collect();
    Ok(Line {
        id: id.to_string(),
        segments,
        world: params.get("size_space").and_then(Value::as_str) == Some("world"),
        color: paint(look, params, &path)?,
    })
}

/// The camera's evaluated pose on a frame of `size`, with near and far from the params or
/// from `bounds` (each a world point the scene draws).
fn camera(
    params: &Map<String, Value>,
    size: [f64; 2],
    bounds: &[Vec3],
    path: &str,
) -> Result<Camera, Refused> {
    let spec = Spec::read(&with_defaults("camera@1", params), path).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    let rig = spec.rig(path).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    let pose = spec.pose(&rig, &Offsets::default());
    let perspective = !pose.flat && pose.fov > 0.0;
    let wider = size[0].max(size[1]);
    let scale = if perspective {
        (wider / 2.0) / tan(rad(pose.fov) / 2.0)
    } else {
        size[0] / pose.view_width
    };
    let forward = normalize(sub(pose.target, pose.position));
    let (right, up) = screen_basis(forward);
    let mut cam = Camera {
        size,
        eye: pose.position,
        right,
        up,
        forward,
        perspective,
        scale,
        centre: [
            size[0] / 2.0 + pose.shift[0] * size[0],
            size[1] / 2.0 + pose.shift[1] * size[1],
        ],
        roll: [cos(rad(pose.roll)), sin(rad(pose.roll))],
        near: 0.1,
        far: 1.0,
    };
    let depths: Vec<f64> = bounds.iter().map(|p| cam.to_view(*p)[2]).collect();
    let lo = depths.iter().copied().fold(f64::INFINITY, f64::min);
    let hi = depths.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let (lo, hi) = if lo.is_finite() && hi.is_finite() {
        (lo, hi)
    } else {
        (0.1, 1.0)
    };
    let pad = 0.01 * (hi - lo) + 1.0;
    cam.near = match num(params.get("near")) {
        Some(n) if n > 0.0 => n,
        _ if perspective => (lo / 2.0).clamp(0.01, 1.0),
        _ => lo - pad,
    };
    cam.far = match num(params.get("far")) {
        Some(f) if f > cam.near => f,
        _ => hi + pad,
    };
    Ok(cam)
}

/// What one item contributes to the bounds the camera's near and far come from.
fn corners(model: &Affine3) -> Vec<Vec3> {
    let mut out = Vec::with_capacity(8);
    for x in [-0.5, 0.5] {
        for y in [-0.5, 0.5] {
            for z in [-0.5, 0.5] {
                out.push(apply(model, [x, y, z]));
            }
        }
    }
    out
}

/// Evaluates `doc` at `t` (flicks) on a frame of its `size`.
pub fn evaluate(doc: &Value, t: i64, look: &Look3, labels: &mut Labels) -> Result<Scene, Refused> {
    let Some(map) = doc.as_object() else {
        return refused("out_of_range", "");
    };
    let program = Program::compile(map).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    let mut state = program.state();
    program.evaluate(t, eval::Validity::Full, &mut state);
    let items = eval::items(map, &program, &state);
    let size = match map
        .get("size")
        .and_then(Value::as_array)
        .map(|s| s.as_slice())
    {
        Some([w, h]) => match (num(Some(w)), num(Some(h))) {
            (Some(w), Some(h)) if w >= 1.0 && h >= 1.0 => [w.round() as u32, h.round() as u32],
            _ => return refused("out_of_range", "size"),
        },
        _ => return refused("out_of_range", "size"),
    };

    // Layers in their order; an item with no layer draws in one of its own, first.
    let mut layer_order: Vec<(String, String)> = map
        .get("layers")
        .and_then(Value::as_object)
        .map(|l| {
            l.iter()
                .map(|(id, layer)| (order_key(layer), id.clone()))
                .collect()
        })
        .unwrap_or_default();
    layer_order.sort();
    let mut by_layer: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
    for (id, item) in &items {
        let layer = item
            .get("layer")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        by_layer
            .entry(layer)
            .or_default()
            .push((order_key(item), id.clone()));
    }
    let mut order: Vec<String> = Vec::new();
    if by_layer.contains_key("") {
        order.push(String::new());
    }
    order.extend(layer_order.into_iter().map(|(_, id)| id));
    for id in by_layer.keys() {
        if !order.contains(id) {
            order.push(id.clone());
        }
    }

    let mut layers = Vec::new();
    let mut overlay_items = Vec::new();
    let mut bounds: Vec<Vec3> = Vec::new();
    for layer_id in &order {
        let Some(list) = by_layer.get_mut(layer_id) else {
            continue;
        };
        list.sort();
        let mut layer = Layer3 {
            id: layer_id.clone(),
            ..Layer3::default()
        };
        for (_, id) in list.iter() {
            let item = &items[id];
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
            let path = format!("items/{id}/params");
            let empty = Value::Object(Map::new());
            let params = item.get("params").unwrap_or(&empty);
            match kind {
                "mark.box@1" | "mark.cylinder@1" | "mark.sphere@1" => {
                    let shape = match kind {
                        "mark.box@1" => Shape::Box,
                        "mark.cylinder@1" => Shape::Cylinder,
                        _ => Shape::Sphere,
                    };
                    let Some(s) = size3(params.get("size"), [1.0; 3]) else {
                        return refused("out_of_range", format!("{path}/size"));
                    };
                    let unscaled = world(&items, id);
                    let model = matmul(
                        &unscaled,
                        &[
                            [s[0], 0.0, 0.0, 0.0],
                            [0.0, s[1], 0.0, 0.0],
                            [0.0, 0.0, s[2], 0.0],
                        ],
                    );
                    bounds.extend(corners(&model));
                    layer.solids.push(Solid {
                        id: id.clone(),
                        shape,
                        model,
                        color: paint(look, params, &path)?,
                    });
                }
                "mark.line@1" => {
                    let l = line(&items, id, params, look)?;
                    bounds.extend(l.segments.iter().flat_map(|s| [s.a, s.b]));
                    layer.lines.push(l);
                }
                "mark.point@1" => {
                    let pos = origin(&world(&items, id));
                    bounds.push(pos);
                    let shape = match params.get("shape").and_then(Value::as_str) {
                        None | Some("dot") => PointShape::Dot,
                        Some("square") => PointShape::Square,
                        Some("diamond") => PointShape::Diamond,
                        Some(_) => return refused("out_of_range", format!("{path}/shape")),
                    };
                    layer.points.push(Point {
                        id: id.clone(),
                        pos,
                        size: num(params.get("size")).unwrap_or(4.0),
                        world: params.get("size_space").and_then(Value::as_str) == Some("world"),
                        shape,
                        color: paint(look, params, &path)?,
                    });
                }
                "mark.text@1" => {
                    let text = params.get("text").and_then(Value::as_str).unwrap_or("");
                    let font = params.get("font").and_then(Value::as_str).unwrap_or("body");
                    let Some(role) = Role::parse(font) else {
                        return refused("out_of_range", format!("{path}/font"));
                    };
                    let facing = match params.get("facing").and_then(Value::as_str) {
                        None | Some("camera") => Facing::Camera,
                        Some("upright") => Facing::Upright,
                        Some("fixed") => Facing::Fixed,
                        Some(_) => return refused("out_of_range", format!("{path}/facing")),
                    };
                    let world_space =
                        params.get("size_space").and_then(Value::as_str) == Some("world");
                    let size =
                        num(params.get("size")).unwrap_or(if world_space { 0.25 } else { 13.0 });
                    let mask = labels.get(text, role);
                    let [we, he] = mask.ems();
                    let m = world(&items, id);
                    let pos = origin(&m);
                    bounds.push(pos);
                    layer.labels.push(Label {
                        id: id.clone(),
                        key: (text.to_string(), role.name().to_string()),
                        mask,
                        pos,
                        quad: [we * size, he * size],
                        world: world_space,
                        facing,
                        axes: [
                            normalize(turn(&m, [1.0, 0.0, 0.0])),
                            normalize(turn(&m, [0.0, 1.0, 0.0])),
                        ],
                        color: paint(look, params, &path)?,
                    });
                }
                OVERLAY => overlay_items.push((layer_id.clone(), id.clone())),
                _ => {}
            }
        }
        if !layer.items().is_empty() {
            layers.push(layer);
        }
    }

    let camera_id = map.get("camera").and_then(Value::as_str);
    let Some(cam_item) = camera_id.and_then(|c| items.get(c)) else {
        return refused("ref_unresolved", "camera");
    };
    let cam_path = format!("items/{}/params", camera_id.unwrap_or_default());
    let empty = Map::new();
    let cam_params = cam_item
        .get("params")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let camera = camera(
        cam_params,
        [f64::from(size[0]), f64::from(size[1])],
        &bounds,
        &cam_path,
    )?;

    let mut overlays = Vec::new();
    for (layer, id) in overlay_items {
        overlays.push(overlay(&items, &layer, &id, &camera, look)?);
    }
    Ok(Scene {
        size,
        camera,
        ground: look.ground,
        layers,
        overlays,
    })
}

fn xy(v: Option<&Value>) -> Option<[f64; 2]> {
    let a = v?.as_array()?;
    if a.len() != 2 {
        return None;
    }
    Some([num(a.first())?, num(a.get(1))?])
}

/// An `overlay.frame@1`: its frame's shapes, placed at its anchor's projection plus its offset.
fn overlay(
    items: &Map<String, Value>,
    layer: &str,
    id: &str,
    camera: &Camera,
    look: &Look3,
) -> Result<Overlay, Refused> {
    let path = format!("items/{id}/params");
    let params = &items[id]["params"];
    let Some(frame) = params.get("frame").and_then(Value::as_str) else {
        return refused("out_of_range", format!("{path}/frame"));
    };
    let anchor = params.get("anchor");
    let Some(target) = anchor.and_then(|a| a.get("item")).and_then(Value::as_str) else {
        return refused("out_of_range", format!("{path}/anchor"));
    };
    if !items.contains_key(target) || !items.contains_key(frame) {
        return refused("ref_unresolved", format!("{path}/anchor"));
    }
    let local_point = vec3(anchor.and_then(|a| a.get("point"))).unwrap_or([0.0; 3]);
    let point = apply(&world(items, target), local_point);
    let offset = xy(params.get("offset")).unwrap_or([0.0; 2]);
    let origin = camera
        .project(point)
        .map(|p| [p[0] + offset[0], p[1] + offset[1]]);
    let frame_box = xy(items[frame]["params"]
        .get("box")
        .and_then(|b| {
            b.as_array()
                .filter(|a| a.len() == 4)
                .map(|a| Value::Array(a[..2].to_vec()))
        })
        .as_ref())
    .unwrap_or([0.0; 2]);
    let mut children: Vec<(String, &String)> = items
        .iter()
        .filter(|(_, i)| i.get("parent").and_then(Value::as_str) == Some(frame))
        .map(|(cid, i)| (order_key(i), cid))
        .collect();
    children.sort();
    let mut shapes = Vec::new();
    for (_, cid) in children {
        let child = &items[cid];
        let cpath = format!("items/{cid}/params");
        let p = &child["params"];
        match child.get("kind").and_then(Value::as_str) {
            Some("circle@1") => {
                let c = xy(p.get("center")).unwrap_or([0.0; 2]);
                shapes.push(Shape2::Circle {
                    center: [c[0] - frame_box[0], c[1] - frame_box[1]],
                    r: num(p.get("r")).unwrap_or(0.0),
                    color: paint(look, p, &cpath)?,
                });
            }
            Some("rect@1") => {
                let b = p.get("box").and_then(Value::as_array);
                let r: Vec<f64> = b
                    .map(|b| b.iter().filter_map(|v| num(Some(v))).collect())
                    .unwrap_or_default();
                if r.len() == 4 {
                    shapes.push(Shape2::Rect {
                        rect: [r[0] - frame_box[0], r[1] - frame_box[1], r[2], r[3]],
                        color: paint(look, p, &cpath)?,
                    });
                }
            }
            _ => {}
        }
    }
    Ok(Overlay {
        id: id.to_string(),
        layer: layer.to_string(),
        origin,
        shapes,
    })
}

/// A label's quad axes on screen: right and up, in world space, as its facing turns it.
pub fn label_axes(label: &Label, camera: &Camera) -> [Vec3; 2] {
    match label.facing {
        Facing::Camera => [camera.right, camera.up],
        Facing::Upright => {
            let r = [camera.right[0], 0.0, camera.right[2]];
            let r = if dot(r, r) > 1e-12 {
                normalize(r)
            } else {
                [1.0, 0.0, 0.0]
            };
            [r, [0.0, 1.0, 0.0]]
        }
        Facing::Fixed => label.axes,
    }
}

impl Scene {
    /// Each drawn item's box in px, `[x, y, w, h]`, from its projected extent.
    pub fn boxes(&self) -> Vec<(String, [f64; 4])> {
        let cam = &self.camera;
        let mut out = Vec::new();
        let boxed = |pts: &[[f64; 2]]| -> Option<[f64; 4]> {
            let (mut x0, mut y0, mut x1, mut y1) = (
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            );
            for p in pts {
                x0 = x0.min(p[0]);
                y0 = y0.min(p[1]);
                x1 = x1.max(p[0]);
                y1 = y1.max(p[1]);
            }
            x0.is_finite().then_some([x0, y0, x1 - x0, y1 - y0])
        };
        let proj = |p: Vec3| cam.project(p).map(|q| [q[0], q[1]]);
        for layer in &self.layers {
            for s in &layer.solids {
                let pts: Vec<[f64; 2]> = corners(&s.model).into_iter().filter_map(proj).collect();
                if let Some(b) = boxed(&pts) {
                    out.push((s.id.clone(), b));
                }
            }
            for l in &layer.lines {
                let mut pts = Vec::new();
                for seg in &l.segments {
                    for (p, w) in [(seg.a, seg.wa), (seg.b, seg.wb)] {
                        if let Some(q) = cam.project(p) {
                            let r = if l.world { w * cam.px_per_m(q[2]) } else { w }.max(1.0) / 2.0;
                            pts.push([q[0] - r, q[1] - r]);
                            pts.push([q[0] + r, q[1] + r]);
                        }
                    }
                }
                if let Some(b) = boxed(&pts) {
                    out.push((l.id.clone(), b));
                }
            }
            for p in &layer.points {
                if let Some(q) = cam.project(p.pos) {
                    let r = if p.world {
                        p.size * cam.px_per_m(q[2])
                    } else {
                        p.size
                    } / 2.0;
                    out.push((p.id.clone(), [q[0] - r, q[1] - r, 2.0 * r, 2.0 * r]));
                }
            }
            for l in &layer.labels {
                let Some(c) = cam.project(l.pos) else {
                    continue;
                };
                let [w, h] = l.quad;
                let pts: Vec<[f64; 2]> = if l.world {
                    let [r, u] = label_axes(l, cam);
                    [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]
                        .iter()
                        .filter_map(|[a, b]| proj(add(l.pos, add(mul(r, a * w), mul(u, b * h)))))
                        .collect()
                } else {
                    vec![
                        [c[0] - w / 2.0, c[1] - h / 2.0],
                        [c[0] + w / 2.0, c[1] + h / 2.0],
                    ]
                };
                if let Some(b) = boxed(&pts) {
                    out.push((l.id.clone(), b));
                }
            }
        }
        out
    }
}

/// Whether `doc` holds any of scene3d's marks: a document a 2D renderer can't draw alone.
pub fn has_3d(doc: &Value) -> bool {
    doc.get("items")
        .and_then(Value::as_object)
        .is_some_and(|items| {
            items
                .values()
                .any(|i| i.get("kind").and_then(Value::as_str).is_some_and(is_3d))
        })
}
