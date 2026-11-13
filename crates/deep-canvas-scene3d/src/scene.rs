//! A document at t as the GPU layer draws it (canvas primitives: Marks in 3D; Object; Overlay):
//! the evaluated camera with its reversed-Z projection, each 3D writer layer's marks in item
//! order, and the 2D overlays anchored to 3D points. Everything is f64 through the ops module,
//! a pure function of the document, the look and t, so seeking equals playing.
//!
//! Conventions (canvas primitives: Units and axes): meters, right-handed, +Y up; an item's `at`
//! is `pos`, `rot` (degrees about X, then Y, then Z) and `scale`, composed with its parents'.
//! Box, cylinder and sphere are unit meshes, 1 m across and centred on the item's origin, scaled
//! by `size`; a cylinder's axis is +Y.

use std::collections::{BTreeMap, HashMap};
use std::ops::Index;
use std::sync::Arc;

use deep_canvas::camera::{screen_basis, Offsets, Rig, Spec, Vec3};
use deep_canvas::kinds::with_defaults;
use deep_canvas::ops::{cos, rad, sin, sqrt, tan};
use deep_canvas_motion::eval;
use deep_canvas_motion::program::{Program, State, TRANSFORM};
use deep_text::Role;
use serde_json::{Map, Value};

pub use crate::label::Labels;
use crate::label::{AtlasPage, Glyph, WORLD_EM_PX};
use crate::light;
pub use crate::light::{Light, Material};
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
    KINDS.contains(&kind) || crate::builders::KINDS.contains(&kind)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Shape {
    Box,
    Cylinder,
    Sphere,
    /// A builder's mesh (#420), by the hash of its bytes: the solid carries it.
    Built(u64),
}

/// An object: one instance record, a 3×4 world matrix (rows), its paint and its item.
#[derive(Clone, Debug, PartialEq)]
pub struct Solid {
    pub id: String,
    pub shape: Shape,
    pub model: [[f64; 4]; 3],
    pub color: [u8; 3],
    /// Its stroke slot: an outline around the object (#386).
    pub stroke: Option<Stroke>,
    /// A builder's mesh in the item's own space, which `model` places (#420).
    pub mesh: Option<Arc<crate::geom::Mesh>>,
    /// Object: `cast_shadow` and `receive_shadow`, both true unless the item says not.
    pub cast_shadow: bool,
    pub receive_shadow: bool,
    /// The `material@1` it names (#421), which shades it under the lights in place of `color`.
    pub material: Option<Material>,
    /// Object: see-through order's `sort_bias`, in m along the view axis (#421).
    pub sort_bias: f64,
    /// Its coverage (#418): its material's alpha (1 opaque, 0 or 1 under a mask) times the item's
    /// `adjust.opacity`. Below 1 it draws see-through and writes no ambient-occlusion depth.
    pub alpha: f64,
    /// Its material's emission × emission_strength, linear RGB.
    pub emission: [f64; 3],
    /// Its material's texture maps (#423), which the renderer samples from the scene's `texels`.
    pub maps: Option<Arc<crate::light::Maps>>,
    /// Its level of detail (#425): bands by projected size and its mesh's levels by error, which
    /// [`crate::lod::resolve`] turns into what a view draws.
    pub lod: Option<Arc<crate::lod::Lod>>,
    /// Inside a band margin, the mask its band's draw keeps pixels by (#425).
    pub mask: Option<crate::lod::Mask>,
    /// The receiver and caster sets it belongs to, a bit each (#446; Light: receivers, casters).
    pub receiver_sets: u32,
    pub caster_sets: u32,
    /// It draws only in the shadow passes: a level the light's projection chose (#425).
    pub cast_only: bool,
    /// How far a cast-only level is drawn inside its surface, along its normals, in its own m.
    pub inset: f64,
    /// The material operator its material names (#429), which shades it per pixel.
    pub op: Option<SolidOp>,
    /// Whether the scene's cutaway reaches it (#424).
    pub cut: bool,
    /// Object: see-through order's `resolve: per_pixel` (#424): its fragments join per-pixel
    /// lists and composite by depth per pixel, back faces included.
    pub per_pixel: bool,
    /// Its item's adjust (#424): its colour adjustments apply to its lit color before fog, and
    /// an opacity below 1 draws it see-through after a depth pass of its own; `None` at the
    /// identity.
    pub adjust: Option<Adjust3>,
    /// Its (prototype, material) batch, from 1, when it's an element of an instancer above
    /// [`crate::cut::GPU_CULLED_ABOVE`] elements: the renderer culls that batch on the GPU and
    /// draws it from the count the GPU wrote (#484). 0 for every other solid.
    pub batch: u32,
    /// Its row in its instancer, with a batch: where a compact step's kept rows name it (#484).
    pub row: u32,
    /// Where its mesh's GPU sway is in time (#2016), with one.
    pub sway: Option<Swaying>,
}

/// A swaying mesh's shape for the solid `id` (#2016): each swaying solid draws its own copy,
/// which the GPU moves by its place, the same shape at every t.
fn swaying_shape(mesh: u64, id: &str) -> u64 {
    let mut h = deep_canvas::schedule::Hasher::new("scene3d.sway");
    h.text(&format!("{mesh}#{id}"));
    let key = h.finish().0;
    u64::from_le_bytes([
        key[0], key[1], key[2], key[3], key[4], key[5], key[6], key[7],
    ])
}

/// #2017: a swaying solid's rest mesh and its shape, where its sway's weights are each vertex's
/// height (0 at its lowest point, 1 at its highest), so the sway is a shear of its place; none
/// for weights read from an attribute or a part.
fn rest_of(s: &Solid, h: u64) -> Option<(Arc<crate::geom::Mesh>, u64)> {
    let mesh = s.mesh.as_ref()?;
    let sway = mesh.sway.as_ref()?;
    let [lo, hi] = mesh.bounds();
    let span = hi[1] - lo[1];
    let height = |p: &Vec3| (p[1] - lo[1]) / span;
    let linear = span > 0.0
        && sway.weights.len() == mesh.positions.len()
        && (mesh.positions.iter().zip(&sway.weights)).all(|(p, w)| (height(p) - w).abs() <= 1e-9);
    linear.then(|| {
        let rest = crate::geom::Mesh {
            sway: None,
            ..(**mesh).clone()
        };
        (Arc::new(rest), swaying_shape(h, "#rest"))
    })
}

/// #2017: the shear that folds a height-weighted sway (#2016) into a solid placed by `model` at
/// its time: each point moves along the wind by amount × its height share × the lean at the
/// place, as the GPU sway moves each vertex, which for weights by height is p + s (p.y − lo) ÷
/// span, s the lean's move in the mesh's own space. It applies before `model`.
fn shear_of(
    model: &Affine3,
    sway: &crate::stack::Sway,
    rest: &crate::geom::Mesh,
    at: Swaying,
) -> Affine3 {
    let [lo, hi] = rest.bounds();
    let span = hi[1] - lo[1];
    let (dx, dz) = (cos(rad(sway.direction)), sin(rad(sway.direction)));
    let lean = sway_lean(sway, [model[0][3], model[2][3]], [dx, dz], at);
    let world = [dx * sway.amount * lean, 0.0, dz * sway.amount * lean];
    let inv = crate::cut::inverse(model);
    let s = [0, 1, 2].map(|r| (0..3).map(|c| inv[r][c] * world[c]).sum::<f64>());
    // The shear's matrix: identity plus s times the height share's gradient (0, 1 ÷ span, 0),
    // its move s × (−lo ÷ span).
    let shear: Affine3 = [0, 1, 2].map(|r| {
        let mut row = [0.0; 4];
        row[r] = 1.0;
        row[1] += s[r] / span;
        row[3] = -s[r] * lo[1] / span;
        row
    });
    shear
}

/// The sway's lean at world place `place` (x, z) and its time (sway.wgsl's `lean`, in f64): a
/// slow sway at hz phased by the modifier, and gusts of B-spline noise over the place less the
/// wind's travel, seeded by the document.
fn sway_lean(sway: &crate::stack::Sway, place: [f64; 2], d: [f64; 2], at: Swaying) -> f64 {
    let (lo, hi) = (at.seed as u32, (at.seed >> 32) as u32);
    let lattice = |x: i32, z: i32| -> f64 {
        let mut h = (x as u32).wrapping_mul(0x8da6_b343) ^ (z as u32).wrapping_mul(0xd816_3841);
        h ^= lo.wrapping_mul(0xcb1a_b31f) ^ hi.wrapping_mul(0x9e37_79b9);
        h = (h ^ (h >> 16)).wrapping_mul(0x7feb_352d);
        h = (h ^ (h >> 15)).wrapping_mul(0x846c_a68b);
        h ^= h >> 16;
        f64::from(h >> 8) / 8_388_607.5 - 1.0
    };
    let spline = |f: f64| {
        let g = 1.0 - f;
        [
            g * g * g,
            3.0 * f * f * f - 6.0 * f * f + 4.0,
            -3.0 * f * f * f + 3.0 * f * f + 3.0 * f + 1.0,
            f * f * f,
        ]
        .map(|w| w / 6.0)
    };
    let t = at.t;
    let q = [0, 1].map(|k| (place[k] - d[k] * sway.speed * t) / sway.scale);
    let c = q.map(f64::floor);
    let (wx, wz) = (spline(q[0] - c[0]), spline(q[1] - c[1]));
    let (ix, iz) = (c[0] as i32 - 1, c[1] as i32 - 1);
    let gust: f64 = (0..4)
        .map(|a| {
            wz[a]
                * (0..4)
                    .map(|b| wx[b] * lattice(ix + b as i32, iz + a as i32))
                    .sum::<f64>()
        })
        .sum();
    let slow = sin(std::f64::consts::TAU * (sway.hz * t).fract() + sway.phase);
    ((1.0 - sway.strength) * slow + sway.strength * gust).clamp(-1.0, 1.0)
}

/// A swaying solid's time and noise (#2016): the document's seconds and its seed, which with its
/// mesh's [`crate::stack::Sway`] and its place give each vertex's move on the GPU.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Swaying {
    pub t: f64,
    pub seed: u64,
}

/// An item's adjust as a 3D item takes it in shading (Object: adjust; Item and kind: adjust):
/// its tint in linear RGB.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Adjust3 {
    pub opacity: f64,
    pub exposure: f64,
    pub contrast: f64,
    pub gamma: f64,
    pub hue: f64,
    pub saturation: f64,
    pub brightness: f64,
    pub tint: Option<[f64; 3]>,
    pub invert: bool,
}

impl Adjust3 {
    /// Whether it changes no color (its opacity aside).
    pub fn colors(&self) -> bool {
        self.exposure != 0.0
            || self.contrast != 1.0
            || self.gamma != 1.0
            || self.hue != 0.0
            || self.saturation != 1.0
            || self.brightness != 1.0
            || self.tint.is_some()
            || self.invert
    }
}

/// A material operator on one solid (#429): the `gpu.material@1` item as evaluated, and the
/// solid's own time, which its `t@1` reads: inside a time-remapped recipe instance, child time.
#[derive(Clone, Debug, PartialEq)]
pub struct SolidOp {
    pub id: String,
    pub item: Arc<Value>,
    /// Seconds from the document's start, on the item's own clock.
    pub t: f64,
    /// The document's seed, which with the solid's ID keys its `seed@1`.
    pub doc_seed: u64,
}

impl Solid {
    /// Where it reaches in world space: a builder's mesh's vertices through its model, or the
    /// unit shape's eight corners (#1162).
    pub fn points(&self) -> Vec<Vec3> {
        match &self.mesh {
            Some(m) => m.positions.iter().map(|p| apply(&self.model, *p)).collect(),
            None => corners(&self.model),
        }
    }
}

/// An object's outline: its silhouette drawn `width` device px wide in `color`, which a status
/// binding draws `exact` (unlit, after tone mapping).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Stroke {
    pub color: [u8; 3],
    pub width: f64,
    pub exact: bool,
}

/// One segment of a line, its ends' widths in its size space.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    pub a: Vec3,
    pub b: Vec3,
    pub wa: f64,
    pub wb: f64,
    /// #537: it draws nothing and isn't hit, a point it meets being out of range.
    pub hidden: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Line {
    pub id: String,
    pub segments: Vec<Segment>,
    /// Widths in m (`size_space: world`), else in px.
    pub world: bool,
    pub color: [u8; 3],
    /// What a mesh-edge line draws the edges of (Marks in 3D: mesh edges; #420).
    pub edges: Option<Arc<EdgesOf>>,
    /// Drawn over whatever is in front of it: the planted `edges_skip_depth`'s line.
    pub over: bool,
    /// Its segments are one drawn line's pieces (#149), so their caps draw no soft edge.
    pub joined: bool,
    /// A mesh-edge line's dash and gap in its size space, each segment dashed from its start
    /// (#1640); zeros for none.
    pub dash: [f64; 2],
    /// The dash is in m: as `world`, but for #1640's planted `edges_dash_other_space`.
    pub dash_world: bool,
    /// How its free ends end (#537; Marks in 3D: lines `cap`).
    pub cap: crate::points::Cap,
}

/// A mesh-edge line's mesh, its kind, the matrix that places the mesh, and the edges it draws.
#[derive(Clone, Debug, PartialEq)]
pub struct EdgesOf {
    pub mesh: Arc<crate::geom::Mesh>,
    pub kind: crate::geom::EdgeKind,
    pub model: Affine3,
    pub width: f64,
    /// The edges, on welded positions, in the mesh's space.
    pub list: Arc<Vec<[crate::geom::V3; 2]>>,
    /// Whether this evaluation derived `list` rather than reusing a crease set (#1640).
    pub derived: bool,
}

impl EdgesOf {
    /// The segments it draws, on welded positions unless `welded` is false (the planted
    /// `edges_unwelded` reader).
    pub fn segments(&self, welded: bool) -> Vec<Segment> {
        let edges = if welded {
            self.list.as_ref().clone()
        } else {
            self.mesh
                .edges(self.kind == crate::geom::EdgeKind::All, false)
        };
        edges
            .into_iter()
            .map(|[a, b]| Segment {
                a: apply(&self.model, a),
                b: apply(&self.model, b),
                wa: self.width,
                wb: self.width,
                hidden: false,
            })
            .collect()
    }
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
    pub text: String,
    pub role: Role,
    /// The shaped run's glyphs, each with its place in the core's atlas.
    pub glyphs: Vec<Glyph>,
    /// The run's box, in px of the size it was shaped at.
    pub bounds: [f64; 2],
    pub pos: Vec3,
    /// One em: the label's size, in m with `world`, else in px.
    pub em: f64,
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
    /// Its soft cloud sprites (#422; Puff `puff@1`).
    pub puffs: Vec<Puff>,
    /// #537: each batch of an instancer fed by logic, laid out by slot, with its slot count.
    pub fed: std::collections::BTreeMap<u32, u32>,
}

/// A soft cloud sprite at t (#422; Puff `puff@1`): where it is in world m, its size, and how the
/// key sun and the sky light it.
#[derive(Clone, Debug, PartialEq)]
pub struct Puff {
    pub id: String,
    pub pos: Vec3,
    pub radius: f64,
    pub aspect: f64,
    pub density: f64,
    pub bright: f64,
    pub seed: u32,
    /// Lit by the key sun; by the sky's ambient.
    pub sun: bool,
    pub ambient: bool,
    pub phase: f64,
    pub shade: f64,
    /// Inside this distance of the camera it fades out, in m.
    pub near_fade: f64,
}

impl Layer3 {
    /// Every item it draws, in its families' order.
    pub fn items(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        out.extend(self.solids.iter().map(|s| s.id.clone()));
        out.extend(self.lines.iter().map(|s| s.id.clone()));
        out.extend(self.points.iter().map(|s| s.id.clone()));
        out.extend(self.labels.iter().map(|s| s.id.clone()));
        out.extend(self.puffs.iter().map(|s| s.id.clone()));
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

    /// The world point at frame px (`sx`, `sy`) and depth `vz` along the forward axis: the
    /// inverse of [`Camera::project`].
    pub fn unproject(&self, sx: f64, sy: f64, vz: f64) -> Vec3 {
        let [c, sn] = self.roll;
        let (dx, dy) = (sx - self.centre[0], sy - self.centre[1]);
        let (x, y) = (dx * c + dy * sn, -dx * sn + dy * c);
        let s = if self.perspective {
            self.scale / vz
        } else {
            self.scale
        };
        let (vx, vy) = (x / s, -y / s);
        add(
            add(add(self.eye, mul(self.right, vx)), mul(self.up, vy)),
            mul(self.forward, vz),
        )
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

/// The key light (Light and the light policy: `light.sun`): the unit direction toward it, its
/// illuminance in lx and whether it casts the shadow.
#[derive(Clone, Debug, PartialEq)]
pub struct Sun {
    pub id: String,
    pub toward: Vec3,
    pub illuminance: f64,
    pub shadow: bool,
    /// Its shadow's cascades (#422).
    pub cascades: Cascades,
}

/// The key sun's cascades (#422; canvas primitives: Light policy: cascades).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cascades {
    /// 1 to 4.
    pub count: u32,
    /// 0 uniform, 1 logarithmic.
    pub split: f64,
    /// The last cascade's far end in m; `None` for auto, from the view's bounds.
    pub far: Option<f64>,
    /// Blend across cascade edges.
    pub fade: bool,
}

impl Default for Cascades {
    fn default() -> Self {
        Cascades {
            count: 3,
            split: 0.5,
            far: None,
            fade: true,
        }
    }
}

/// A sun's `cascades`, `split`, `shadow_far` and `fade`; more than four cascades is refused.
fn cascades(params: &Value, path: &str) -> Result<Cascades, Refused> {
    let mut c = Cascades::default();
    if let Some(v) = params.get("cascades") {
        c.count = v
            .as_u64()
            .filter(|n| (1..=4).contains(n))
            .ok_or_else(|| Refused {
                code: "out_of_range",
                path: format!("{path}/cascades"),
            })? as u32;
    }
    if let Some(v) = params.get("split") {
        c.split = num(Some(v))
            .filter(|s| (0.0..=1.0).contains(s))
            .ok_or_else(|| Refused {
                code: "out_of_range",
                path: format!("{path}/split"),
            })?;
    }
    match params.get("shadow_far") {
        None => {}
        Some(Value::String(s)) if s == "auto" => {}
        Some(v) => {
            c.far = Some(num(Some(v)).filter(|f| *f > 0.0).ok_or_else(|| Refused {
                code: "out_of_range",
                path: format!("{path}/shadow_far"),
            })?)
        }
    }
    if let Some(v) = params.get("fade") {
        c.fade = v.as_bool().ok_or_else(|| Refused {
            code: "out_of_range",
            path: format!("{path}/fade"),
        })?;
    }
    Ok(c)
}

/// An item of a kind another canvas module draws (particles@1 among them), as evaluated at t:
/// its params and its world position.
#[derive(Clone, Debug, PartialEq)]
pub struct Other {
    pub id: String,
    pub kind: String,
    pub params: Value,
    pub pos: Vec3,
}

/// Motion blur by velocity (#419; Motion blur: velocity): the cameras at t − s/2 and t + s/2, each
/// solid's world at both times by ID, and, for a solid whose surface deforms with its topology
/// held, its mesh at both times; with the reconstruction's taps, travel cap and tile.
#[derive(Clone, Debug, PartialEq)]
pub struct Motion {
    pub open: Camera,
    pub close: Camera,
    pub solids: BTreeMap<String, MotionSolid>,
    pub taps: u32,
    pub max_px: f64,
    pub tile_px: u32,
}

/// One solid's place at t − s/2 and t + s/2.
#[derive(Clone, Debug, PartialEq)]
pub struct MotionSolid {
    pub open: Affine3,
    pub close: Affine3,
    /// Its pre-skins at both times, vertex for vertex with its mesh at t; `None` reads its mesh at
    /// t at both times (a rigid item, or one whose topology changed inside the shutter).
    pub meshes: Option<(Arc<crate::geom::Mesh>, Arc<crate::geom::Mesh>)>,
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
    /// The first sun in item order, which shades the solids and casts the shadow.
    pub sun: Option<Sun>,
    /// Every light, in layer and item order (#421): what shades the solids that name a material.
    pub lights: Vec<Light>,
    /// The first `sky@1` (#418, #422): its ambient light from above and below, its background,
    /// fog and environment; with none, the solids keep the fixed ambient term.
    pub sky: Option<crate::sky::Sky>,
    pub others: Vec<Other>,
    /// Each curve item's samples in world metres, closed ones back to their start (#420).
    pub curves: BTreeMap<String, Vec<Vec3>>,
    /// The core's glyph atlas pages the labels' glyphs sample, by page number.
    pub pages: Vec<AtlasPage>,
    /// Motion blur by velocity this frame (#419): the evaluations at t ± half the shutter that the
    /// renderer's velocity target reads, or `None`.
    pub motion: Option<Arc<Motion>>,
    /// The core's velocity target this frame (#431): the evaluations at t ± half the shutter an
    /// effect or operator reading it is drawn from, or `None` where nothing reads it.
    pub velocity: Option<Arc<Motion>>,
    /// Each `overlay.text@1` readout (#419): drawn by the view after the frame's samples and
    /// motion blur resolve, over the frame, never into the frame itself.
    pub readouts: Vec<Label>,
    /// The texels of every map the solids sample, by the image's SHA-256, as the host had the
    /// decode worker make them (#423); a map whose texels aren't here draws without it.
    pub texels: BTreeMap<String, Arc<crate::light::Texels>>,
    /// The frame's sub-pixel offset, px right and down (#423: Look: samples).
    pub jitter: [f64; 2],
    /// The light cut to draw in place of the policy's at this view: only #425's planted session
    /// hysteresis sets one.
    pub light_cut: Option<crate::light::Policy>,
    /// The first `cutaway@1` (#424), which the solids it reaches are cut by in every pass.
    pub cutaway: Option<crate::cut::Cutaway>,
    /// The per-pixel resolve's room (#424): the view's `max_fragments`, and the most fragments
    /// the class's GPU memory holds at 16 B each.
    pub fragments: [u64; 2],
    /// #149: each item's paint at t, under a drawing look: what its drawn fills and lines read.
    pub painted: BTreeMap<String, Value>,
    /// The IES tables its lights read, each an atlas layer (#446).
    pub distributions: Vec<Arc<crate::ies::Distribution>>,
    /// The light policy's shadow fields (#446).
    pub shadowing: crate::light::Shadowing,
    /// Under samples per frame, the angle this sample turns a soft shadow's disk by (#446).
    pub sample_turn: Option<f64>,
    /// #464: what the look's print finish draws from at this frame's t and the document's seed.
    pub print: deep_canvas_marks::print::Frame,
    /// The view's mirror (#465; Material: mirror), which one extra pass draws.
    pub mirror: Option<crate::mirror::Mirror>,
    /// The view's flare (#465; Effect: flare): the first `effect@1` of kind flare.
    pub flare: Option<Arc<crate::flare::Flare>>,
    /// The view's water (#166; Material: water), which its own pass draws after the mirror's.
    pub water: Option<Arc<crate::water::Water>>,
    /// #166: whether the view reads back each mirror part's lookup (view3d's `reflection`).
    pub read_reflection: bool,
    /// #268: whether the view reads back the water's foam share (view3d's `foam`).
    pub read_foam: bool,
    /// Its light probes (#427; Light probe `light.probe@1`), each with its own capture or bake,
    /// in item order. They draw nothing in the look.
    pub probes: Vec<crate::probe::Probe>,
    /// Each terrain plate's overlays at t (#537), which tint its cover's base color.
    pub tints: Vec<crate::tints::Tint>,
}

impl Scene {
    /// Cuts the scene by `cutaway` (#424): a view input in session state replaces the
    /// document's, and reaches the solids its `applies_to` names.
    pub fn set_cutaway(&mut self, cutaway: Option<crate::cut::Cutaway>) {
        for s in self.layers.iter_mut().flat_map(|l| &mut l.solids) {
            s.cut = cutaway
                .as_ref()
                .is_some_and(|c| !c.planes.is_empty() && c.reaches(&s.id));
        }
        self.cutaway = cutaway;
    }

    /// Whether the key sun's shadow is drawn through its cascades (#422): a shadowed sun over a
    /// scene whose solids name materials, which shade it per pixel. A scene of painted solids
    /// alone keeps the single fitted map the effects' shadow reads (#380).
    pub fn cascaded(&self) -> bool {
        self.sun.as_ref().is_some_and(|s| s.shadow)
            && self
                .layers
                .iter()
                .flat_map(|l| &l.solids)
                .any(|s| s.material.is_some())
    }

    /// #428's planted `drops_dispersion`, reachable only through `deep-gpu --planted`: every
    /// material draws dispersion 0, as if its import had dropped KHR_materials_dispersion
    /// ([`crate::gltf::drop_dispersion`]).
    pub fn plant_drops_dispersion(&mut self) {
        let solids = self.layers.iter_mut().flat_map(|l| &mut l.solids);
        for m in solids.filter_map(|s| s.material.as_mut()) {
            m.lobes.dispersion = 0.0;
        }
    }

    /// #268's wrong field, reachable only through `deep-gpu --planted`: the water's shore baked
    /// with each item's centre standing for where it meets the water.
    pub fn plant_shore_from_centre(
        &mut self,
        doc: &Value,
        memo: &crate::memo::Memo,
    ) -> Result<(), Refused> {
        let (Some(map), Some(water)) = (doc.as_object(), self.water.as_mut()) else {
            return Ok(());
        };
        let w = Arc::make_mut(water);
        let plates: Vec<[f64; 4]> = w.plates.iter().map(|(_, p)| *p).collect();
        if let Some(shore) = &mut w.shore {
            shore.field = Some(crate::shore::field(
                map,
                &w.material,
                shore,
                &self.layers,
                &plates,
                w.level,
                crate::shore::Planted::FromCentre,
                memo,
            )?);
        }
        Ok(())
    }

    /// #420 AC6's wrong programs, reachable only through `deep-gpu --planted`: mesh-edge lines
    /// read from the unwelded mesh, or drawn over what is in front of them; and #1640's
    /// (`crease_below_angle`, `edges_derive_every_frame`, `edges_dash_other_space`).
    pub fn plant_edges(
        &mut self,
        unwelded: bool,
        over: bool,
        planted: Option<&str>,
        memo: &crate::memo::Memo,
    ) {
        for line in self.layers.iter_mut().flat_map(|l| &mut l.lines) {
            let Some(edges) = line.edges.clone() else {
                continue;
            };
            if let (crate::geom::EdgeKind::Crease { angle, border }, Some(name)) =
                (edges.kind, planted)
            {
                if matches!(name, "crease_below_angle" | "edges_derive_every_frame") {
                    let (list, derived) = edges.mesh.crease_set(angle, border, planted, memo);
                    let source = EdgesOf {
                        list,
                        derived,
                        ..(*edges).clone()
                    };
                    line.segments = source.segments(true);
                    line.edges = Some(Arc::new(source));
                }
            }
            if planted == Some("edges_dash_other_space") {
                line.dash_world = !line.world;
            }
            if unwelded {
                line.segments = edges.segments(false);
            }
            line.over |= over;
        }
    }
}

pub(crate) fn num(v: Option<&Value>) -> Option<f64> {
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
pub(crate) fn size3(v: Option<&Value>, default: Vec3) -> Option<Vec3> {
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
pub type Affine3 = [[f64; 4]; 3];

pub fn matmul(a: &Affine3, b: &Affine3) -> Affine3 {
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

/// Whether `m` turns and scales alike on every axis, with no mirror: what a terrain tile's
/// normals turn by in its pixels (#2017).
fn uniform(m: &Affine3) -> bool {
    let col = |c: usize| [m[0][c], m[1][c], m[2][c]];
    let (x, y, z) = (col(0), col(1), col(2));
    let k = dot(x, x);
    let near = |a: f64, b: f64| (a - b).abs() <= 1e-9 * k.max(1e-300);
    near(dot(y, y), k)
        && near(dot(z, z), k)
        && near(dot(x, y), 0.0)
        && near(dot(y, z), 0.0)
        && near(dot(x, z), 0.0)
        && dot(crate::geom::cross(x, y), z) > 0.0
}

pub(crate) fn apply(m: &Affine3, p: Vec3) -> Vec3 {
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

/// An item's vector `at.pivot`, if it has one (a box-point pivot is the core's to resolve).
pub(crate) fn pivot_of(item: &Value) -> Option<Vec3> {
    vec3(item.get("at").and_then(|a| a.get("pivot")))
}

/// `m` after subtracting the item's pivot: the pivot lands at `pos` (#433).
fn pivoted(mut m: Affine3, item: &Value) -> Affine3 {
    if let Some(p) = pivot_of(item) {
        for row in &mut m {
            row[3] -= row[0] * p[0] + row[1] * p[1] + row[2] * p[2];
        }
    }
    m
}

/// An item's own `at` from the numbers themselves: scale, then rotate about X, Y and Z in turn,
/// then move to `pos` (Units and axes).
pub(crate) fn local_of(pos: Vec3, rot: Vec3, sc: Vec3, extra_scale: Vec3) -> Affine3 {
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

/// An item's world transform, without its size: its parents' composed over its own, in 3D. The
/// items carry their own transforms (`Program::evaluate_local`): motion's child-of parenting
/// turns a child only about z, and composed here again it would add the parent twice.
fn world(items: &Items<'_>, id: &str) -> Affine3 {
    let Some((item, mut m)) = items.placed(id) else {
        return [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
        ];
    };
    // The parents passed, after `id` itself.
    let mut seen: Vec<&str> = Vec::new();
    let mut at = item.get("parent").and_then(Value::as_str);
    while let Some(p) = at {
        if p == id || seen.contains(&p) {
            break;
        }
        let Some((parent, local)) = items.placed(p) else {
            // #504: a chain that ends on an assembly rides its composed transform (Assembly: its
            // transform composes before its members').
            if let Some(a) = items.assemblies.get(p) {
                m = matmul(a, &m);
            }
            break;
        };
        m = matmul(&local, &m);
        seen.push(p);
        at = parent.get("parent").and_then(Value::as_str);
    }
    m
}

/// The document's items at a time, as [`eval::items`] gives them, without copying the document:
/// an item a field names is its copy in `written`, and every other item is the document's own,
/// its `at` the three numbers of each group in its slots.
struct Items<'a> {
    doc: &'a Map<String, Value>,
    written: &'a Map<String, Value>,
    /// Each item as evaluated, and for an object nothing writes, its index in the program: its
    /// transform is its `TRANSFORM` slots from there.
    entries: HashMap<&'a str, (&'a Value, Option<usize>)>,
    slots: &'a [f64],
    /// #2013: each item a `rest_on` rested on true shapes, with its own position and rotation
    /// as solved.
    rested: BTreeMap<String, (Vec3, Vec3)>,
    /// #504: each assembly's world transform at this state, by ID.
    assemblies: HashMap<String, Affine3>,
}

impl<'a> Items<'a> {
    /// `doc`'s items, with `written` from [`eval::written`] of its program at `state`. The
    /// program's items are the document's in its order, so item `i`'s transform is its
    /// `TRANSFORM` slots from `i * TRANSFORM`.
    fn new(
        doc: &'a Map<String, Value>,
        written: &'a Map<String, Value>,
        state: &'a State,
        program: &Program,
    ) -> Self {
        let mut entries = HashMap::with_capacity(doc.len());
        let mut copies = written.iter().peekable();
        for (i, (id, item)) in doc.iter().enumerate() {
            let entry = match copies.next_if(|(w, _)| *w == id) {
                Some((_, evaluated)) => (evaluated, None),
                None => (item, item.is_object().then_some(i)),
            };
            entries.insert(id.as_str(), entry);
        }
        let assemblies = program
            .assemblies
            .iter()
            .enumerate()
            .map(|(i, a)| (a.id.clone(), program.assembly_world(&state.slots, i)))
            .collect();
        Items {
            doc,
            written,
            entries,
            slots: &state.slots,
            rested: BTreeMap::new(),
            assemblies,
        }
    }

    fn get(&self, id: &str) -> Option<&'a Value> {
        self.entries.get(id).map(|e| e.0)
    }

    fn contains_key(&self, id: &str) -> bool {
        self.entries.contains_key(id)
    }

    /// The items in document order. `written` holds some of them in that order too.
    fn iter(&self) -> impl Iterator<Item = (&'a String, &'a Value)> {
        let mut written = self.written.iter().peekable();
        self.doc
            .iter()
            .map(move |(id, item)| match written.next_if(|(w, _)| *w == id) {
                Some((_, evaluated)) => (id, evaluated),
                None => (id, item),
            })
    }

    /// The item `id` and its [`local_of`] transform, less its pivot: an object nothing writes reads its `at` from
    /// its slots as the evaluated item holds them, a number that isn't finite leaving its group's
    /// default.
    fn placed(&self, id: &str) -> Option<(&'a Value, Affine3)> {
        let &(item, _) = self.entries.get(id)?;
        let (pos, rot, sc) = self.at_of(id)?;
        Some((item, pivoted(local_of(pos, rot, sc, [1.0; 3]), item)))
    }

    /// The item's own position, rotation and scale as evaluated: from its slots, or from its
    /// `at` for one a field names; where a `rest_on` rested it, as that solved them.
    fn at_of(&self, id: &str) -> Option<(Vec3, Vec3, Vec3)> {
        let &(item, index) = self.entries.get(id)?;
        let (pos, rot, sc) = match index {
            Some(i) => {
                let slots = &self.slots[i * TRANSFORM..(i + 1) * TRANSFORM];
                let group = |k: usize, default: Vec3| {
                    let s = &slots[3 * k..3 * k + 3];
                    if s.iter().all(|x| x.is_finite()) {
                        [s[0], s[1], s[2]]
                    } else {
                        default
                    }
                };
                (group(0, [0.0; 3]), group(1, [0.0; 3]), group(2, [1.0; 3]))
            }
            None => {
                let at = item.get("at");
                (
                    vec3(at.and_then(|a| a.get("pos"))).unwrap_or([0.0; 3]),
                    vec3(at.and_then(|a| a.get("rot"))).unwrap_or([0.0; 3]),
                    size3(at.and_then(|a| a.get("scale")), [1.0; 3]).unwrap_or([1.0; 3]),
                )
            }
        };
        let (pos, rot) = self.rested.get(id).copied().unwrap_or((pos, rot));
        Some((pos, rot, sc))
    }
}

/// Which of a document's `rest_on`s on true shapes a solve takes (#2013; Constraint: rest_on):
/// all of them, those with both sides still, or those with a side motion moves.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Rests {
    All,
    Still,
    Moving,
}

/// Each solved rest's owner with its own position and, where it aligned, its rotation.
pub type Rested = BTreeMap<String, (Vec3, Option<Vec3>)>;

/// Whether motion writes `id`'s transform or a parent's: a channel, a placement, a driver, a
/// limit or a constraint the program runs.
fn moves(items: &Items<'_>, program: &Program, id: &str) -> bool {
    let mut at = Some(id);
    let mut seen = 0;
    while let Some(i) = at.filter(|_| seen < 64) {
        let written = program
            .items
            .iter()
            .position(|x| x == i)
            .is_some_and(|k| program.writes(k * TRANSFORM..(k + 1) * TRANSFORM));
        let held = program.motion.constraints.iter().any(|c| {
            c.owner == i
                && !matches!(
                    c.kind,
                    deep_canvas_motion::doc::Kind::RestOn { on: Some(_), .. }
                )
        });
        if written || held {
            return true;
        }
        at = items
            .get(i)
            .and_then(|v| v.get("parent"))
            .and_then(Value::as_str);
        seen += 1;
    }
    false
}

/// The X, Y, Z angles in degrees of the rotation `r` (its rows), as `local_of` composes them:
/// Rz · Ry · Rx.
fn euler_of(r: &[Vec3; 3]) -> Vec3 {
    use deep_canvas::ops::{asin, atan2, deg};
    if r[2][0].abs() > 1.0 - 1e-12 {
        // Straight up or down: X and Z turn about one axis, so Z takes none.
        return [
            deg(atan2(-r[1][2], r[1][1])),
            deg(asin((-r[2][0]).clamp(-1.0, 1.0))),
            0.0,
        ];
    }
    [
        deg(atan2(r[2][1], r[2][2])),
        deg(asin((-r[2][0]).clamp(-1.0, 1.0))),
        deg(atan2(r[1][0], r[0][0])),
    ]
}

/// The rotation of `m` (its rows): its columns at unit length.
fn rotation_of(m: &Affine3) -> [Vec3; 3] {
    let mut out = [[0.0; 3]; 3];
    for j in 0..3 {
        let l = sqrt(m[0][j] * m[0][j] + m[1][j] * m[1][j] + m[2][j] * m[2][j]);
        for (i, row) in out.iter_mut().enumerate() {
            row[j] = if l > 0.0 {
                m[i][j] / l
            } else {
                f64::from(u8::from(i == j))
            };
        }
    }
    out
}

/// #2013: every `rest_on` of `which` that names `on`, solved from where the items stand and
/// written into `items`, a rest whose `on` another rest's owner is among after that one. What
/// can't be solved is in `problems`: an `on` that names nothing (`ref_unresolved`), an owner
/// with no true shape (`out_of_range`), rests in a loop (`cycle`) and no support within
/// `max_drop` (`no_support`); its owner stays where it was.
fn rest(
    map: &Map<String, Value>,
    program: &Program,
    items: &mut Items<'_>,
    seconds: f64,
    which: Rests,
    problems: &mut Vec<Refused>,
) -> Rested {
    use deep_canvas_motion::doc::Kind;
    let mut out = Rested::new();
    let mut left: Vec<(&str, &str, &deep_canvas_motion::doc::RestOn, f64, f64)> = program
        .motion
        .constraints
        .iter()
        .filter_map(|c| match &c.kind {
            Kind::RestOn {
                on: Some(r),
                offset,
                max_drop,
                ..
            } => Some((c.id.as_str(), c.owner.as_str(), r, *offset, *max_drop)),
            _ => None,
        })
        .collect();
    if left.is_empty() {
        return out;
    }
    left.sort_by(|a, b| a.0.cmp(b.0));
    let doc = Value::Object(map.clone());
    let members = |items: &Items<'_>, on: &str| -> Option<Vec<String>> {
        if items.contains_key(on) {
            return Some(vec![on.to_string()]);
        }
        let list = map
            .get("collections")?
            .get(on)?
            .get("members")?
            .as_array()?;
        let mut ids: Vec<String> = list
            .iter()
            .filter_map(|m| m.as_str().map(str::to_string))
            .collect();
        ids.sort();
        ids.dedup();
        Some(ids)
    };
    let mut moving: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    while !left.is_empty() {
        // The first rest, by ID, whose `on` holds no owner still to be rested.
        let ready = left.iter().position(|(_, owner, r, _, _)| {
            members(items, &r.on).is_none_or(|m| {
                !m.iter()
                    .any(|x| x != owner && left.iter().any(|l| l.1 == x))
            })
        });
        let Some(k) = ready else {
            for (id, ..) in &left {
                problems.push(Refused {
                    code: "cycle",
                    path: format!("constraints/{id}/on"),
                });
            }
            break;
        };
        let (id, owner, r, offset, max_drop) = left.remove(k);
        // `on: ID | collection | ground`: an item or a collection by that name before the ground
        // plane, so a plate whose ID is `ground` is rested on as itself (#2014).
        let on_ids = match members(items, &r.on) {
            Some(m) => Some(m),
            None if r.on == "ground" => None,
            None => {
                problems.push(Refused {
                    code: "ref_unresolved",
                    path: format!("constraints/{id}/on"),
                });
                continue;
            }
        };
        let moved = moves(items, program, owner)
            || on_ids
                .iter()
                .flatten()
                .any(|x| moves(items, program, x) || moving.contains(x));
        if moved {
            moving.insert(owner.to_string());
        }
        if matches!(
            (which, moved),
            (Rests::Still, true) | (Rests::Moving, false)
        ) {
            continue;
        }
        let shapes_of = |x: &str| -> Vec<deep_canvas::geometry_audit::Shape> {
            let Some(item) = items.get(x) else {
                return Vec::new();
            };
            crate::shapes::of(&doc, x, item, &world(items, x), seconds)
                .ok()
                .flatten()
                .map_or_else(Vec::new, |(s, _)| s)
        };
        let own = shapes_of(owner);
        let Some((pos, rot, _)) = items.at_of(owner).filter(|_| !own.is_empty()) else {
            problems.push(Refused {
                code: "out_of_range",
                path: format!("constraints/{id}/owner"),
            });
            continue;
        };
        let on: Option<Vec<_>> = on_ids.map(|ids| {
            ids.iter()
                .filter(|x| x.as_str() != owner)
                .flat_map(|x| shapes_of(x))
                .collect()
        });
        let parent = items
            .get(owner)
            .and_then(|i| i.get("parent"))
            .and_then(Value::as_str)
            .map(|p| {
                items
                    .assemblies
                    .get(p)
                    .copied()
                    .unwrap_or_else(|| world(items, p))
            });
        let origin = match &parent {
            Some(p) => apply(p, pos),
            None => pos,
        };
        let solved = crate::rest::solve(&crate::rest::Rest {
            own: &own,
            origin,
            on: on.as_deref(),
            axis: r.axis,
            align: r.align,
            bounds: r.bounds,
            offset,
            max_drop,
        });
        let Some(solved) = solved else {
            problems.push(Refused {
                code: "no_support",
                path: format!("constraints/{id}"),
            });
            continue;
        };
        // The move and the turn in the owner's parent's space.
        let (by, turn) = match &parent {
            Some(p) => {
                let inv = crate::cut::inverse(p);
                let pr = rotation_of(p);
                let t = solved.turn.map(|m| {
                    let mut out = [[0.0; 3]; 3];
                    for i in 0..3 {
                        for j in 0..3 {
                            out[i][j] = (0..3)
                                .map(|a| (0..3).map(|b| pr[a][i] * m[a][b] * pr[b][j]).sum::<f64>())
                                .sum();
                        }
                    }
                    out
                });
                (turn(&inv, solved.by), t)
            }
            None => (solved.by, solved.turn),
        };
        let new_pos = [pos[0] + by[0], pos[1] + by[1], pos[2] + by[2]];
        let new_rot = turn.map(|m| {
            let own = rotation_of(&local_of([0.0; 3], rot, [1.0; 3], [1.0; 3]));
            let mut r = [[0.0; 3]; 3];
            for i in 0..3 {
                for j in 0..3 {
                    r[i][j] = (0..3).map(|a| m[i][a] * own[a][j]).sum();
                }
            }
            euler_of(&r)
        });
        items
            .rested
            .insert(owner.to_string(), (new_pos, new_rot.unwrap_or(rot)));
        out.insert(owner.to_string(), (new_pos, new_rot));
    }
    out
}

/// #2013: the document's `rest_on`s on true shapes solved at `t` (flicks), each owner with its
/// own position and rotation, and what couldn't be solved.
pub fn rested_at(doc: &Value, t: i64, which: Rests) -> Result<(Rested, Vec<Refused>), Refused> {
    let Some(map) = doc.as_object() else {
        return refused("out_of_range", "");
    };
    let program = Program::compile(map).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    Ok(rested_with(map, &program, t, which))
}

/// [`rested_at`] of a document whose motion program is compiled already.
pub fn rested_with(
    map: &Map<String, Value>,
    program: &Program,
    t: i64,
    which: Rests,
) -> (Rested, Vec<Refused>) {
    let mut state = program.state();
    program.evaluate_local(t, eval::Validity::Full, &mut state);
    let empty = Map::new();
    let doc_items = map
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let written = eval::written(map, program, &state);
    let mut items = Items::new(doc_items, &written, &state, program);
    let mut problems = Vec::new();
    let seconds = t as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64;
    let out = rest(map, program, &mut items, seconds, which, &mut problems);
    (out, problems)
}

impl Index<&str> for Items<'_> {
    type Output = Value;

    fn index(&self, id: &str) -> &Value {
        self.get(id).expect("an item of the document")
    }
}

fn origin(m: &Affine3) -> Vec3 {
    [m[0][3], m[1][3], m[2][3]]
}

fn paint(look: &Look3, params: &Value, path: &str) -> Result<[u8; 3], Refused> {
    // #149: a noise fill's first stop, or a line's own role, or the ink a named fill leaves out.
    let drawn = params
        .pointer("/paint/fill/noise/stops/0/role")
        .or_else(|| {
            params
                .pointer("/paint/fill/role")
                .is_none()
                .then(|| params.pointer("/paint/stroke/role"))
                .flatten()
        });
    if let Some(c) = drawn.and_then(Value::as_str).and_then(|r| look.role(r)) {
        return Ok(c);
    }
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

/// A solid's `paint.stroke {role, width}`: an outline around a box or a built mesh (a recipe's
/// parts among them, #173); a cylinder's or a sphere's isn't drawn yet, so it's refused rather
/// than left out.
fn stroke(
    look: &Look3,
    params: &Value,
    shape: Shape,
    path: &str,
) -> Result<Option<Stroke>, Refused> {
    let Some(st) = params.get("paint").and_then(|p| p.get("stroke")) else {
        return Ok(None);
    };
    if !matches!(shape, Shape::Box | Shape::Built(_)) {
        return refused("stroke_shape", format!("{path}/paint/stroke"));
    }
    let Some(color) = st
        .get("role")
        .and_then(Value::as_str)
        .and_then(|r| look.role(r))
    else {
        return refused("ref_unresolved", format!("{path}/paint/stroke/role"));
    };
    let width = match st.get("width") {
        None => 1.0,
        Some(w) => match num(Some(w)).filter(|w| *w > 0.0) {
            Some(w) => w,
            None => return refused("out_of_range", format!("{path}/paint/stroke/width")),
        },
    };
    Ok(Some(Stroke {
        color,
        width,
        exact: false,
    }))
}

fn order_key(item: &Value) -> &str {
    item.get("order").and_then(Value::as_str).unwrap_or("")
}

/// An entry of a line's `points`: a point, or an item's evaluated anchor (its origin).
fn point_of(items: &Items<'_>, v: &Value, path: &str) -> Result<Vec3, Refused> {
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

fn line(
    items: &Items<'_>,
    id: &str,
    params: &Value,
    look: &Look3,
    (map, t): (&Map<String, Value>, i64),
) -> Result<Line, Refused> {
    let path = format!("items/{id}/params");
    // #537: points that read a logic array, each with whether it hides.
    let (points, hidden) = match crate::points::of(map, id, params, t)? {
        Some(read) => read,
        None => (
            params
                .get("points")
                .and_then(Value::as_array)
                .map_or(Ok(Vec::new()), |list| {
                    list.iter()
                        .enumerate()
                        .map(|(i, v)| point_of(items, v, &format!("{path}/points/{i}")))
                        .collect::<Result<Vec<_>, _>>()
                })?,
            Vec::new(),
        ),
    };
    // #149: a named line's width and its profile along the line.
    let named = params.pointer("/paint/stroke/line").and_then(Value::as_str);
    let drawn_line = match (named, look.drawn.as_ref()) {
        (Some(name), Some(d)) => d.line(name).map_err(|r| Refused {
            code: r.code,
            path: r.path,
        })?,
        _ => None,
    };
    let written = points.len();
    let (points, along) = match drawn_line.as_ref().and_then(|l| l.profile.as_ref()) {
        Some(p) => profiled_points(&points, p),
        None => {
            let flat = vec![1.0; points.len()];
            (points, flat)
        }
    };
    let n = points.len();
    let base = drawn_line.as_ref().and_then(|l| l.width);
    let widths: Vec<f64> = match params.get("width") {
        None | Some(Value::Null) => along.iter().map(|k| base.unwrap_or(1.5) * k).collect(),
        Some(Value::Array(w)) if w.len() == written => {
            let w = w
                .iter()
                .map(|x| num(Some(x)).filter(|&x| x >= 0.0))
                .collect::<Option<Vec<_>>>()
                .map_or_else(|| refused("out_of_range", format!("{path}/width")), Ok)?;
            // A profile multiplies each point's own width, at the written point it grew from.
            let at = |i: usize| i * written.saturating_sub(1) / n.saturating_sub(1).max(1);
            (0..n).map(|i| w[at(i)] * along[i]).collect()
        }
        Some(v) => match num(Some(v)).filter(|&x| x >= 0.0) {
            Some(w) => along.iter().map(|k| w * k).collect(),
            None => return refused("out_of_range", format!("{path}/width")),
        },
    };
    let mode = params
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("strip");
    let Some(pairs) = crate::points::segments(mode, n) else {
        return refused("out_of_range", format!("{path}/mode"));
    };
    let model = world(items, id);
    // A point that can't narrow hides each segment that meets it, which keeps its record.
    let hides = |i: usize| n == written && hidden.get(i) == Some(&true);
    let segments = pairs
        .into_iter()
        .map(|(a, b)| Segment {
            a: apply(&model, points[a]),
            b: apply(&model, points[b]),
            wa: widths[a],
            wb: widths[b],
            hidden: hides(a) || hides(b),
        })
        .collect();
    Ok(Line {
        id: id.to_string(),
        segments,
        world: params.get("size_space").and_then(Value::as_str) == Some("world"),
        color: paint(look, params, &path)?,
        edges: None,
        over: false,
        joined: drawn_line.is_some(),
        dash: [0.0; 2],
        dash_world: false,
        cap: crate::points::cap(params, &path)?,
    })
}

/// A line's stroke modifiers at `seconds`, in its declared order (Modifier: `dash`, `outline`,
/// `boil`, and `build` on a stroke): each edits the line's segments while its `while` holds
/// (`drawing` while a build on the line is mid-progress, `moving` while a channel moves the
/// line's `at`); an outline is a wider line drawn under it, which this returns.
fn strokes(
    map: &Map<String, Value>,
    id: &str,
    item: &Value,
    line: &mut Line,
    look: &Look3,
    seconds: f64,
) -> Result<Vec<Line>, Refused> {
    let list = item.get("modifiers").and_then(Value::as_array);
    let Some(list) = list.filter(|l| !l.is_empty()) else {
        return Ok(Vec::new());
    };
    let on = |m: &Value| crate::stack::enabled(m);
    let num = |m: &Value, f: &str, d: f64| -> Option<f64> {
        match m.pointer(&format!("/params/{f}")) {
            None => Some(d),
            Some(v) => v.as_f64().filter(|x| x.is_finite()),
        }
    };
    let drawing = list.iter().any(|m| {
        on(m)
            && m.get("kind").and_then(Value::as_str) == Some("mod.build@1")
            && num(m, "to", 1.0)
                .is_some_and(|to| to < 1.0 && to > num(m, "from", 0.0).unwrap_or(0.0))
    });
    let at = format!("items/{id}/at");
    let moving = ["channels", "drivers"].iter().any(|section| {
        map.get(*section)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .any(|(_, c)| {
                c.get("target")
                    .and_then(Value::as_str)
                    .is_some_and(|t| t.starts_with(&at))
            })
    });
    let mut under = Vec::new();
    for (k, m) in list.iter().enumerate() {
        let path = |f: &str| format!("items/{id}/modifiers/{k}/{f}");
        let kind = m.get("kind").and_then(Value::as_str).unwrap_or("");
        if !crate::stack::STROKE.contains(&kind) {
            return refused("out_of_range", path("kind"));
        }
        if !on(m) {
            continue;
        }
        let holds = match m.get("while").and_then(Value::as_str).unwrap_or("always") {
            "always" => true,
            "drawing" => drawing,
            "moving" => moving,
            _ => return refused("out_of_range", path("while")),
        };
        if !holds {
            continue;
        }
        let bad = |f: &str| Refused {
            code: "out_of_range",
            path: path(&format!("params/{f}")),
        };
        match kind {
            "mod.build@1" => {
                let (from, to) = (
                    num(m, "from", 0.0).ok_or_else(|| bad("from"))?,
                    num(m, "to", 1.0).ok_or_else(|| bad("to"))?,
                );
                if !(0.0..=1.0).contains(&from) || !(0.0..=1.0).contains(&to) {
                    return Err(bad("to"));
                }
                let total = stroke_length(&line.segments);
                line.segments = cut(&line.segments, from.min(to) * total, from.max(to) * total);
            }
            "mod.dash@1" => {
                let (dash, gap) = (
                    num(m, "dash", 0.1).ok_or_else(|| bad("dash"))?,
                    num(m, "gap", 0.05).ok_or_else(|| bad("gap"))?,
                );
                if dash <= 0.0 || gap < 0.0 {
                    return Err(bad("dash"));
                }
                let total = stroke_length(&line.segments);
                let mut out = Vec::new();
                let mut s = 0.0;
                while s < total && out.len() < 100_000 {
                    out.extend(cut(&line.segments, s, (s + dash).min(total)));
                    s += dash + gap;
                }
                line.segments = out;
            }
            "mod.boil@1" => {
                let (amount, hz) = (
                    num(m, "amount", 0.01).ok_or_else(|| bad("amount"))?,
                    num(m, "hz", 8.0).ok_or_else(|| bad("hz"))?,
                );
                if hz <= 0.0 {
                    return Err(bad("hz"));
                }
                // Stepped at hz: one draw per step, the same for every frame in it.
                let step = (seconds * hz).floor() as i64 as u64;
                let seed = crate::stack::seed_of(id, m);
                let jitter = |p: Vec3, j: u64| -> Vec3 {
                    let n = |axis: u64| {
                        crate::stack::unit_noise(seed ^ step.wrapping_mul(0x9e37), 3 * j + axis)
                    };
                    [
                        p[0] + amount * n(0),
                        p[1] + amount * n(1),
                        p[2] + amount * n(2),
                    ]
                };
                for (j, seg) in line.segments.iter_mut().enumerate() {
                    seg.a = jitter(seg.a, 2 * j as u64);
                    seg.b = jitter(seg.b, 2 * j as u64 + 1);
                }
            }
            "mod.outline@1" => {
                let width = num(m, "width", 2.0)
                    .filter(|w| *w > 0.0)
                    .ok_or_else(|| bad("width"))?;
                let role = m
                    .pointer("/params/role")
                    .and_then(Value::as_str)
                    .unwrap_or("ground");
                let Some(color) = look.role(role) else {
                    return refused("ref_unresolved", path("params/role"));
                };
                let mut wide = line.clone();
                for seg in &mut wide.segments {
                    seg.wa += 2.0 * width;
                    seg.wb += 2.0 * width;
                }
                wide.color = color;
                under.push(wide);
            }
            _ => {}
        }
    }
    Ok(under)
}

/// A stroke's length: its segments' in turn.
fn stroke_length(segments: &[Segment]) -> f64 {
    segments.iter().map(|s| dist(s.a, s.b)).sum()
}

fn dist(a: Vec3, b: Vec3) -> f64 {
    sqrt(
        (b[0] - a[0]) * (b[0] - a[0])
            + (b[1] - a[1]) * (b[1] - a[1])
            + (b[2] - a[2]) * (b[2] - a[2]),
    )
}

/// The part of a stroke from `s0` to `s1` metres along it.
fn cut(segments: &[Segment], s0: f64, s1: f64) -> Vec<Segment> {
    let lerp = |a: Vec3, b: Vec3, f: f64| {
        [
            a[0] + (b[0] - a[0]) * f,
            a[1] + (b[1] - a[1]) * f,
            a[2] + (b[2] - a[2]) * f,
        ]
    };
    let mut out = Vec::new();
    let mut at = 0.0;
    for seg in segments {
        let len = dist(seg.a, seg.b);
        let (from, to) = ((s0 - at).max(0.0), (s1 - at).min(len));
        if to > from && len > 0.0 {
            let (fa, fb) = (from / len, to / len);
            out.push(Segment {
                a: lerp(seg.a, seg.b, fa),
                b: lerp(seg.a, seg.b, fb),
                wa: seg.wa + (seg.wb - seg.wa) * fa,
                wb: seg.wa + (seg.wb - seg.wa) * fb,
                hidden: seg.hidden,
            });
        }
        at += len;
    }
    out
}

/// A builder's or building kind's mesh after its stack, or why it can't be built.
fn mesh_of(
    doc: &Value,
    id: &str,
    item: &Value,
    t: f64,
    outlines: Outlines<'_>,
) -> Result<crate::geom::Mesh, Refused> {
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
    let built = if crate::building::KINDS.contains(&kind) {
        crate::building::build(doc, id, item)
    } else {
        let run = crate::stack::Run {
            outlines: outlines.to_vec(),
            ..Default::default()
        };
        crate::build::built(doc, id, item, &run, t).map(|b| b.mesh.unwrap_or_default())
    };
    built.map_err(|path| Refused {
        code: "out_of_range",
        path: format!("items/{id}/{path}"),
    })
}

/// A line of the edges of the mesh `edges.of` builds (Marks in 3D: mesh edges).
#[allow(clippy::too_many_arguments)]
fn edge_line(
    doc: &Value,
    items: &Items<'_>,
    id: &str,
    params: &Value,
    look: &Look3,
    seconds: f64,
    outlines: Outlines<'_>,
    assets: Option<Assets<'_>>,
    memo: &crate::memo::Memo,
) -> Result<Line, Refused> {
    let path = format!("items/{id}/params");
    let edges = &params["edges"];
    let of = edges.get("of").and_then(Value::as_str).unwrap_or("");
    let target = of.split('#').next().unwrap_or("");
    let Some(item) = items.get(target) else {
        return refused("ref_unresolved", format!("{path}/edges/of"));
    };
    let kind = match crate::geom::EdgeKind::read(edges) {
        Ok(kind) => kind,
        Err(field) => return refused("out_of_range", format!("{path}/edges/{field}")),
    };
    let width = match params.get("width") {
        None | Some(Value::Null) => 1.5,
        Some(v) => match num(Some(v)).filter(|w| *w >= 0.0) {
            Some(w) => w,
            None => return refused("out_of_range", format!("{path}/width")),
        },
    };
    // Its dash and gap in its size space; one length dashes as long as it gaps.
    let dash = match params.get("dash") {
        None | Some(Value::Null) => [0.0; 2],
        Some(v) => match v
            .as_array()
            .map(|a| a.iter().map(|x| num(Some(x))).collect())
        {
            Some(Some::<Vec<f64>>(d))
                if d.iter().all(|x| *x >= 0.0) && matches!(d.len(), 1 | 2) =>
            {
                [d[0], d[d.len() - 1]]
            }
            _ => return refused("out_of_range", format!("{path}/dash")),
        },
    };
    let mut mesh = match (item.get("kind").and_then(Value::as_str), assets) {
        // A glTF asset's mesh, read as its solid is (#1640).
        (Some("mesh.asset@1"), Some(read)) => {
            asset_mesh(read, target, item.get("params").unwrap_or(&Value::Null))?.0
        }
        _ => mesh_of(doc, target, item, seconds, outlines)?,
    };
    if let Some((_, part)) = of.split_once('#') {
        let Some(tris) = mesh
            .parts
            .get(part)
            .or_else(|| mesh.closed.get(part).map(|c| &c.0))
            .cloned()
        else {
            return refused("ref_unresolved", format!("{path}/edges/of"));
        };
        let mut only = crate::geom::Mesh {
            positions: mesh.positions.clone(),
            normals: mesh.normals.clone(),
            ..Default::default()
        };
        for t in tris {
            let k = 3 * t as usize;
            only.indices.extend(&mesh.indices[k..k + 3]);
            only.faces.push(mesh.faces[t as usize]);
        }
        mesh = only;
    }
    let (list, derived) = match kind {
        crate::geom::EdgeKind::Crease { angle, border } => {
            mesh.crease_set(angle, border, None, memo)
        }
        _ => (Arc::new(mesh.edge_list(kind, None)), true),
    };
    let source = EdgesOf {
        mesh: Arc::new(mesh),
        kind,
        model: world(items, target),
        width,
        list,
        derived,
    };
    let world = params.get("size_space").and_then(Value::as_str) == Some("world");
    Ok(Line {
        id: id.to_string(),
        segments: source.segments(true),
        world,
        color: paint(look, params, &path)?,
        edges: Some(Arc::new(source)),
        over: false,
        joined: false,
        dash,
        dash_world: world,
        cap: Default::default(),
    })
}

/// A drawing look's key: its `dir` around the page, and its `elevation` toward the viewer.
fn drawn_light(look: &Look3) -> Option<Sun> {
    let l = look.drawn.as_ref()?.light.as_ref()?;
    let (dir, up) = (
        deep_canvas::ops::rad(l.dir),
        deep_canvas::ops::rad(l.elevation),
    );
    let (c, s) = (deep_canvas::ops::cos(up), deep_canvas::ops::sin(up));
    Some(Sun {
        id: "look.light".into(),
        toward: [
            c * deep_canvas::ops::cos(dir),
            c * deep_canvas::ops::sin(dir),
            s,
        ],
        illuminance: std::f64::consts::PI,
        shadow: l.cast.is_some(),
        cascades: Cascades::default(),
    })
}

/// The u a drawn look's sizes span on a surface, a metre.
const U_PER_METER: f64 = 300.0;

/// `points` split finely enough to carry a line profile, with its width multiplier at each.
fn profiled_points(points: &[Vec3], p: &deep_canvas_drawn::spec::Profile) -> (Vec<Vec3>, Vec<f64>) {
    const PIECES: usize = 16;
    let mut fine = Vec::new();
    for pair in points.windows(2) {
        for k in 0..PIECES {
            let t = k as f64 / PIECES as f64;
            fine.push([0, 1, 2].map(|i| pair[0][i] + (pair[1][i] - pair[0][i]) * t));
        }
    }
    fine.extend(points.last());
    let mut s = vec![0.0];
    for pair in fine.windows(2) {
        let d = [0, 1, 2].map(|i| pair[1][i] - pair[0][i]);
        s.push(s[s.len() - 1] + deep_canvas::ops::hypot(deep_canvas::ops::hypot(d[0], d[1]), d[2]));
    }
    let total = s.last().copied().unwrap_or(0.0).max(1e-9);
    // A profile's flick is in u, and this line's arc length in metres.
    let metres = deep_canvas_drawn::spec::Profile {
        flick: p.flick / U_PER_METER,
        ..p.clone()
    };
    let widths = s
        .iter()
        .map(|at| deep_canvas_drawn::geometry::width_along(&metres, *at, total))
        .collect();
    (fine, widths)
}

/// A solid's color: its paint's role, or the look's `muted` when it names none.
/// A linear RGB value: three (or four, alpha last) finite numbers at least 0.
fn linear3(v: &Value) -> Option<[f64; 3]> {
    let a = v.as_array().filter(|a| a.len() == 3 || a.len() == 4)?;
    let mut out = [0.0; 3];
    for (o, x) in out.iter_mut().zip(a) {
        *o = num(Some(x)).filter(|x| *x >= 0.0)?;
    }
    Some(out)
}

fn encode8(v: f64) -> u8 {
    let v = v.clamp(0.0, 1.0);
    let e = if v <= 0.0031308 {
        v * 12.92
    } else {
        1.055 * deep_canvas::ops::pow(v, 1.0 / 2.4) - 0.055
    };
    (e * 255.0).round() as u8
}

/// What an object's material and `adjust` give its surface (#418; Material: alpha_mode, alpha,
/// emission; Item: adjust.opacity): its base color when the material sets one, its coverage and
/// its emission.
struct Surface {
    color: Option<[u8; 3]>,
    alpha: f64,
    emission: [f64; 3],
}

fn surface(items: &Items<'_>, look: &Look3, id: &str, item: &Value) -> Result<Surface, Refused> {
    let mut out = Surface {
        color: None,
        alpha: 1.0,
        emission: [0.0; 3],
    };
    if let Some(o) = item.get("adjust").and_then(|a| a.get("opacity")) {
        out.alpha = num(Some(o))
            .filter(|o| (0.0..=1.0).contains(o))
            .ok_or(Refused {
                code: "out_of_range",
                path: format!("items/{id}/adjust/opacity"),
            })?;
    }
    let Some(material) = item.get("material").filter(|m| !m.is_null()) else {
        return Ok(out);
    };
    let unresolved = || Refused {
        code: "ref_unresolved",
        path: format!("items/{id}/material"),
    };
    let mid = material.as_str().ok_or_else(unresolved)?;
    let m = items
        .get(mid)
        .filter(|m| m.get("kind").and_then(Value::as_str) == Some("material@1"))
        .ok_or_else(unresolved)?;
    let empty = Value::Object(Map::new());
    let params = m.get("params").unwrap_or(&empty);
    let path = format!("items/{mid}/params");
    let bad = |k: &str| Refused {
        code: "out_of_range",
        path: format!("{path}/{k}"),
    };
    let mut alpha = 1.0;
    out.color = match params.get("base_color") {
        None | Some(Value::Null) => None,
        Some(Value::Object(o)) => {
            let role = o.get("role").and_then(Value::as_str);
            Some(role.and_then(|r| look.role(r)).ok_or(Refused {
                code: "ref_unresolved",
                path: format!("{path}/base_color/role"),
            })?)
        }
        Some(v) => {
            let c = linear3(v).ok_or_else(|| bad("base_color"))?;
            if let Some(a) = v.as_array().and_then(|a| a.get(3)) {
                alpha = num(Some(a)).ok_or_else(|| bad("base_color"))?;
            }
            Some(c.map(encode8))
        }
    };
    if let Some(a) = params.get("alpha") {
        alpha *= num(Some(a))
            .filter(|a| (0.0..=1.0).contains(a))
            .ok_or_else(|| bad("alpha"))?;
    }
    let coverage = match params.get("alpha_mode").and_then(Value::as_str) {
        None | Some("opaque") => 1.0,
        Some("blend" | "add") => alpha,
        // A mask keeps a fragment whole or cuts it.
        Some("mask") => {
            let cutoff = num(params.get("alpha_cutoff")).unwrap_or(0.5);
            if alpha >= cutoff {
                1.0
            } else {
                0.0
            }
        }
        Some(_) => return Err(bad("alpha_mode")),
    };
    out.alpha *= coverage;
    if let Some(e) = params.get("emission") {
        let e = linear3(e).ok_or_else(|| bad("emission"))?;
        let k = num(params.get("emission_strength")).unwrap_or(1.0);
        out.emission = e.map(|c| c * k);
    }
    Ok(out)
}

fn paint_or_muted(look: &Look3, params: &Value, path: &str) -> Result<[u8; 3], Refused> {
    if params.pointer("/paint/fill/role").is_none() {
        if let Some(c) = look.role("muted") {
            return Ok(c);
        }
    }
    paint(look, params, path)
}

/// The camera's evaluated pose on a frame of `size`, with near and far from the params or
/// from `bounds` (each a world point the scene draws).
pub(crate) fn camera(
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
    let mut cam = posed(&spec, &rig, &Offsets::default(), size);
    near_far(
        &mut cam,
        num(params.get("near")),
        num(params.get("far")),
        bounds.iter().copied(),
    );
    Ok(cam)
}

/// The camera `spec` and `rig` pose under `offsets` on a frame of `size` px, before its near
/// and far.
pub(crate) fn posed(spec: &Spec, rig: &Rig, offsets: &Offsets, size: [f64; 2]) -> Camera {
    let pose = spec.pose(rig, offsets);
    let perspective = !pose.flat && pose.fov > 0.0;
    let wider = size[0].max(size[1]);
    let scale = if perspective {
        (wider / 2.0) / tan(rad(pose.fov) / 2.0)
    } else {
        size[0] / pose.view_width
    };
    let forward = normalize(sub(pose.target, pose.position));
    let (right, up) = screen_basis(forward);
    Camera {
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
    }
}

/// The camera's near and far: as authored, else from the depths of `bounds`.
pub(crate) fn near_far(
    cam: &mut Camera,
    near: Option<f64>,
    far: Option<f64>,
    bounds: impl Iterator<Item = Vec3>,
) {
    let (lo, hi) = bounds
        .map(|p| cam.to_view(p)[2])
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), d| {
            (lo.min(d), hi.max(d))
        });
    let (lo, hi) = if lo.is_finite() && hi.is_finite() {
        (lo, hi)
    } else {
        (0.1, 1.0)
    };
    let pad = 0.01 * (hi - lo) + 1.0;
    cam.near = match near {
        Some(n) if n > 0.0 => n,
        _ if cam.perspective => (lo / 2.0).clamp(0.01, 1.0),
        _ => lo - pad,
    };
    cam.far = match far {
        Some(f) if f > cam.near => f,
        _ => hi + pad,
    };
}

/// A solid's eight corners in the world: what it contributes to the bounds the camera's near and
/// far come from, and what a view projects to tell whether it is on screen (#383).
pub fn corners(model: &Affine3) -> Vec<Vec3> {
    let mut out = Vec::with_capacity(8);
    corners_into(model, &mut out);
    out
}

/// [`corners`], pushed onto `out`.
pub(crate) fn corners_into(model: &Affine3, out: &mut Vec<Vec3>) {
    out.extend(corners8(model));
}

/// [`corners`], in an array.
pub(crate) fn corners8(model: &Affine3) -> [Vec3; 8] {
    let mut out = [[0.0; 3]; 8];
    let mut k = 0;
    for x in [-0.5, 0.5] {
        for y in [-0.5, 0.5] {
            for z in [-0.5, 0.5] {
                out[k] = apply(model, [x, y, z]);
                k += 1;
            }
        }
    }
    out
}

/// Reads a stored asset's bytes by its sha256.
pub type Assets<'a> = &'a dyn Fn(&str) -> Option<Vec<u8>>;

/// The build's outline sources an `extrude` reads its text, path or vector outline through
/// (#443): the core's `outline.source@1`, as the sealed set holds it.
pub type Outlines<'a> = &'a [deep_canvas::registry::SealedOutline];

/// Evaluates `doc` at `t` (flicks) on a frame of its `size`; a `mesh.asset@1` draws only where
/// [`evaluate_with`] has a store to read it from.
pub fn evaluate(doc: &Value, t: i64, look: &Look3, labels: &mut Labels) -> Result<Scene, Refused> {
    evaluate_any(doc, t, look, labels, None, &[])
}

/// [`evaluate`] with the asset store `assets` that `mesh.asset@1` items read their glTF from.
pub fn evaluate_with(
    doc: &Value,
    t: i64,
    look: &Look3,
    labels: &mut Labels,
    assets: Assets<'_>,
) -> Result<Scene, Refused> {
    evaluate_any(doc, t, look, labels, Some(assets), &[])
}

/// [`evaluate_with`] whose extrudes read their outlines through `outlines` (#443).
pub fn evaluate_sourced(
    doc: &Value,
    t: i64,
    look: &Look3,
    labels: &mut Labels,
    assets: Assets<'_>,
    outlines: Outlines<'_>,
) -> Result<Scene, Refused> {
    evaluate_any(doc, t, look, labels, Some(assets), outlines)
}

fn evaluate_any(
    doc: &Value,
    t: i64,
    look: &Look3,
    labels: &mut Labels,
    assets: Option<Assets<'_>>,
    outlines: Outlines<'_>,
) -> Result<Scene, Refused> {
    let Some(map) = doc.as_object() else {
        return refused("out_of_range", "");
    };
    // #166: a wake behind an item a logic array moves, refused at check before anything else.
    crate::water::logic_moved(map)?;
    // #268: a shore item that anything moves or reshapes, refused at check.
    crate::shore::static_items(map)?;
    let program = Program::compile(map).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    evaluate_compiled(map, &program, t, look, labels, assets, outlines)
}

/// The items a scatter's field names: an item's ID (a part's `<item>#<part>` as its item), or a
/// collection's members in ID order; `None` for a name that is neither.
fn named_items(map: &Map<String, Value>, items: &Items<'_>, name: &str) -> Option<Vec<String>> {
    let id = name.split('#').next().unwrap_or(name);
    if items.contains_key(id) {
        return Some(vec![id.to_string()]);
    }
    let list = map
        .get("collections")?
        .get(name)?
        .get("members")?
        .as_array()?;
    let mut ids: Vec<String> = list
        .iter()
        .filter_map(|m| m.as_str().map(str::to_string))
        .collect();
    ids.sort();
    ids.dedup();
    Some(ids)
}

/// The faces of `on` (`<item>` or `<item>#<part>`) in the world: a builder's mesh, or a box's
/// six sides, whose parts are `top`, `bottom` and `side`.
fn faces_of(
    doc: &Value,
    items: &Items<'_>,
    on: &str,
    seconds: f64,
    outlines: Outlines<'_>,
) -> Option<Vec<crate::distribute::Tri>> {
    let (id, part) = match on.split_once('#') {
        Some((id, part)) => (id, Some(part)),
        None => (on, None),
    };
    let item = items.get(id)?;
    let m = world(items, id);
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
    let mut out = Vec::new();
    if kind == "mark.box@1" {
        let h = size3(item.pointer("/params/size"), [1.0; 3])?.map(|x| x / 2.0);
        for axis in 0..3 {
            for sign in [-1.0, 1.0] {
                let name = match (axis, sign > 0.0) {
                    (1, true) => "top",
                    (1, false) => "bottom",
                    _ => "side",
                };
                if part.is_some_and(|p| p != name) {
                    continue;
                }
                let (a, b) = ((axis + 1) % 3, (axis + 2) % 3);
                let corner = |x: f64, y: f64| {
                    let mut p = [0.0; 3];
                    p[axis] = sign * h[axis];
                    p[a] = x * h[a];
                    p[b] = y * h[b] * sign;
                    apply(&m, p)
                };
                let q = [
                    corner(-1.0, -1.0),
                    corner(1.0, -1.0),
                    corner(1.0, 1.0),
                    corner(-1.0, 1.0),
                ];
                out.extend(
                    [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]
                        .into_iter()
                        .filter_map(crate::distribute::Tri::new),
                );
            }
        }
        return Some(out);
    }
    if !crate::builders::KINDS.contains(&kind) {
        return None;
    }
    let mesh = mesh_of(doc, id, item, seconds, outlines).ok()?;
    let all: Vec<u32>;
    let tris: &[u32] = match part {
        Some(name) => mesh
            .parts
            .get(name)
            .or_else(|| mesh.closed.get(name).map(|c| &c.0))?,
        None => {
            all = (0..mesh.triangles() as u32).collect();
            &all
        }
    };
    for &t in tris {
        let k = 3 * t as usize;
        let p = [0, 1, 2].map(|j| apply(&m, mesh.positions[mesh.indices[k + j] as usize]));
        out.extend(crate::distribute::Tri::new(p));
    }
    Some(out)
}

/// #2013: the elements of instancer `id` from its `from: {distribute}` (`from`), laid out over
/// what the scatter names as the items stand: its prototypes and each element in ID order.
#[allow(clippy::too_many_arguments)]
fn scattered(
    map: &Map<String, Value>,
    doc: &Value,
    items: &Items<'_>,
    id: &str,
    params: &Value,
    from: &Value,
    seconds: f64,
    outlines: Outlines<'_>,
    planted: Option<&str>,
) -> Result<(Vec<String>, Arc<Vec<crate::distribute::Row>>), Refused> {
    let path = format!("items/{id}/params");
    let of = crate::cut::prototypes(params, &path)?;
    let at = format!("{path}/from/distribute");
    let Some(d) = from.get("distribute").filter(|d| d.is_object()) else {
        return refused("out_of_range", format!("{path}/from"));
    };
    // Rows come from the scatter or from written columns, never both.
    if let Some(column) = ["ids", "pos", "rot", "yaw", "proto", "hidden"]
        .into_iter()
        .find(|c| params.get(c).is_some_and(|v| !v.is_null()))
    {
        return refused("out_of_range", format!("{path}/{column}"));
    }
    let shapes_of =
        |name: &str, field: String| -> Result<Vec<deep_canvas::geometry_audit::Shape>, Refused> {
            let ids = named_items(map, items, name).ok_or(Refused {
                code: "ref_unresolved",
                path: field,
            })?;
            Ok(ids
                .iter()
                .filter_map(|x| {
                    crate::shapes::of(doc, x, items.get(x)?, &world(items, x), seconds)
                        .ok()
                        .flatten()
                })
                .flat_map(|(s, _)| s)
                .collect())
        };
    let on = d.get("on").and_then(Value::as_str).ok_or(Refused {
        code: "ref_unresolved",
        path: format!("{at}/on"),
    })?;
    if !items.contains_key(on.split('#').next().unwrap_or(on)) {
        return refused("ref_unresolved", format!("{at}/on"));
    }
    let Some(faces) = faces_of(doc, items, on, seconds, outlines) else {
        return refused("out_of_range", format!("{at}/on"));
    };
    let mut avoid = Vec::new();
    match d.get("avoid") {
        None | Some(Value::Null) => {}
        Some(Value::Array(list)) => {
            for (k, name) in list.iter().enumerate() {
                let name = name.as_str().ok_or(Refused {
                    code: "out_of_range",
                    path: format!("{at}/avoid/{k}"),
                })?;
                avoid.extend(shapes_of(name, format!("{at}/avoid/{k}"))?);
            }
        }
        Some(_) => return refused("out_of_range", format!("{at}/avoid")),
    }
    let project = match d.get("project") {
        None | Some(Value::Null) => Vec::new(),
        Some(p) => {
            let to = p.get("to").and_then(Value::as_str).ok_or(Refused {
                code: "ref_unresolved",
                path: format!("{at}/project/to"),
            })?;
            shapes_of(to, format!("{at}/project/to"))?
        }
    };
    let identity = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
    ];
    let protos = of
        .iter()
        .map(|p| {
            let shapes = items.get(p).and_then(|i| {
                crate::shapes::of(doc, p, i, &identity, seconds)
                    .ok()
                    .flatten()
            });
            let mut b = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
            for s in shapes.iter().flat_map(|(s, _)| s) {
                let [lo, hi] = s.aabb();
                for k in 0..3 {
                    b[0][k] = b[0][k].min(lo[k]);
                    b[1][k] = b[1][k].max(hi[k]);
                }
            }
            if b[0][0] <= b[1][0] {
                b
            } else {
                [[0.0; 3]; 2]
            }
        })
        .collect();
    let scene = crate::distribute::Scene {
        on: faces,
        avoid,
        project,
        protos,
        world: world(items, id),
        id,
        planted,
    };
    Ok((of, Arc::new(crate::distribute::rows(d, &at, &scene)?)))
}

/// #2013: the elements instancer `id` places at `t` (flicks): its `from: {distribute}`'s, or its
/// written rows, each as its columns hold it (`{id, proto, pos, yaw | rot, scale}`), in ID
/// order; `None` for an item that is no instancer.
pub fn elements_at(
    doc: &Value,
    t: i64,
    id: &str,
    planted: Option<&str>,
) -> Result<Option<Vec<crate::distribute::Row>>, Refused> {
    let Some(map) = doc.as_object() else {
        return refused("out_of_range", "");
    };
    let program = Program::compile(map).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    let mut state = program.state();
    program.evaluate_local(t, eval::Validity::Full, &mut state);
    let empty = Map::new();
    let doc_items = map
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let written = eval::written(map, &program, &state);
    let mut items = Items::new(doc_items, &written, &state, &program);
    let seconds = t as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64;
    rest(
        map,
        &program,
        &mut items,
        seconds,
        Rests::All,
        &mut Vec::new(),
    );
    let Some(item) = items
        .get(id)
        .filter(|i| i.get("kind").and_then(Value::as_str) == Some("instance@1"))
    else {
        return Ok(None);
    };
    let empty = Value::Object(Map::new());
    let params = item.get("params").unwrap_or(&empty);
    let mut rows = match params.get("from").filter(|f| !f.is_null()) {
        Some(from) => scattered(map, doc, &items, id, params, from, seconds, &[], planted)?
            .1
            .to_vec(),
        None => crate::cut::elements(params, &format!("items/{id}/params"))?
            .1
            .into_iter()
            .map(|e| {
                let r = rotation_of(&e.at);
                let scale = sqrt(
                    e.at[0][0] * e.at[0][0] + e.at[1][0] * e.at[1][0] + e.at[2][0] * e.at[2][0],
                );
                crate::distribute::Row {
                    id: e.id as u32,
                    proto: e.proto,
                    pos: origin(&e.at),
                    yaw: deep_canvas::ops::deg(deep_canvas::ops::atan2(r[0][2], r[0][0])),
                    turn: Some(r),
                    scale,
                }
            })
            .collect(),
    };
    rows.sort_by_key(|r| r.id);
    Ok(Some(rows))
}

/// Each item of `doc` at `t` as evaluated, in item order, with its world transform without its
/// size: what the spatial index (#421) bounds and queries.
pub fn placed_at(doc: &Value, t: i64) -> Result<Vec<(String, Value, Affine3)>, Refused> {
    let Some(map) = doc.as_object() else {
        return refused("out_of_range", "");
    };
    let program = Program::compile(map).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    let mut state = program.state();
    program.evaluate_local(t, eval::Validity::Full, &mut state);
    let empty = Map::new();
    let doc_items = map
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let written = eval::written(map, &program, &state);
    let mut items = Items::new(doc_items, &written, &state, &program);
    let seconds = t as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64;
    rest(
        map,
        &program,
        &mut items,
        seconds,
        Rests::All,
        &mut Vec::new(),
    );
    Ok(items
        .iter()
        .map(|(id, item)| (id.clone(), item.clone(), world(&items, id)))
        .collect())
}

/// An item's Object shadow flag: true unless it says false.
fn shadows(item: &Value, name: &str) -> bool {
    item.get(name).and_then(Value::as_bool).unwrap_or(true)
}

/// Whether a solid casts: its Object flag, and its material's `shadow` (#421).
fn casts(item: &Value, material: &Option<Material>) -> bool {
    shadows(item, "cast_shadow") && material.as_ref().is_none_or(|m| m.casts)
}

/// A solid's outline: its own stroke, else its material's ink in the ink's role at its weight;
/// an ink on a part the outline can't follow is refused as a stroke there is (#421).
fn inked(
    own: Option<Stroke>,
    material: &Option<Material>,
    shape: Shape,
    path: &str,
) -> Result<Option<Stroke>, Refused> {
    let Some((color, width)) = material.as_ref().and_then(|m| m.ink) else {
        return Ok(own);
    };
    if own.is_some() {
        return Ok(own);
    }
    if shape != Shape::Box {
        return refused("stroke_shape", format!("{path}/material"));
    }
    Ok(Some(Stroke {
        color,
        width,
        exact: false,
    }))
}

/// A light's face axes: its local +X and +Y in the world, unit.
fn axes(m: &Affine3) -> [Vec3; 2] {
    [
        normalize(turn(m, [1.0, 0.0, 0.0])),
        normalize(turn(m, [0.0, 1.0, 0.0])),
    ]
}

/// A light's flicker: a gain, or the value at t of the document channel its `flicker` names; 1
/// with none.
fn flicker(program: &Program, state: &State, params: &Value, path: &str) -> Result<f64, Refused> {
    match params.get("flicker") {
        None | Some(Value::Null) => Ok(1.0),
        Some(Value::Number(_)) => num(params.get("flicker")).ok_or(Refused {
            code: "out_of_range",
            path: format!("{path}/flicker"),
        }),
        Some(v) => v
            .as_str()
            .and_then(|c| program.channel_value(state, c))
            .ok_or(Refused {
                code: "ref_unresolved",
                path: format!("{path}/flicker"),
            }),
    }
}

/// A `mesh.asset@1`'s mesh, read from the store, with the name every item of that asset and
/// node shares.
fn asset_mesh(
    read: Assets<'_>,
    id: &str,
    params: &Value,
) -> Result<(crate::geom::Mesh, Option<String>), Refused> {
    let path = format!("items/{id}/params");
    let Some(sha) = params.get("sha256").and_then(Value::as_str) else {
        return refused("out_of_range", format!("{path}/sha256"));
    };
    let Some(bytes) = read(sha) else {
        return refused("asset_missing", format!("{path}/sha256"));
    };
    let node = params.get("node").cloned().unwrap_or(Value::from(0));
    let mesh = crate::gltf::mesh(&bytes, &node).map_err(|_| Refused {
        code: "out_of_range",
        path: format!("{path}/sha256"),
    })?;
    Ok((mesh, Some(format!("{sha}#{node}"))))
}

/// An item's level of detail (#425): its `lod` bands and, for a mesh the simplify job gave
/// levels, those levels keyed off its `hash`; none when it has neither.
fn lod_of(
    item: &Value,
    path: &str,
    bounds: [Vec3; 2],
    mesh: Option<(&crate::geom::Mesh, u64)>,
    doc: &Map<String, Value>,
    memo: &crate::memo::Memo,
) -> Result<Option<Arc<crate::lod::Lod>>, Refused> {
    let bands = crate::lod::bands_of(item, path.trim_end_matches("/params"))?;
    let leveled = mesh.filter(|(m, _)| !m.lods.is_empty());
    if bands.is_none() && leveled.is_none() {
        return Ok(None);
    }
    let crate::lod::Bands {
        bands,
        margin,
        proxy,
    } = bands.unwrap_or(crate::lod::Bands {
        bands: Vec::new(),
        margin: 0.1,
        proxy: None,
    });
    let (levels, extent) = match leveled {
        Some((m, h)) => (crate::lod::levels(&Arc::new(m.clone()), h), m.lod_extent),
        None => (Vec::new(), 0.0),
    };
    // A mesh without levels takes its proxy from the simplify step, once per content key.
    let proxy_mesh = match (proxy, mesh) {
        (Some(p), Some((m, h))) if levels.is_empty() => crate::lod::proxy_of(m, h, p, memo),
        _ => None,
    };
    Ok(Some(Arc::new(crate::lod::Lod {
        bands,
        margin,
        bounds,
        levels,
        extent,
        lod_px: crate::lod::lod_px(doc),
        proxy,
        proxy_mesh,
        tile: None,
    })))
}

/// A built solid's world bounds' corners.
pub(crate) fn corners_of(s: &Solid) -> Vec<Vec3> {
    let Some(mesh) = &s.mesh else {
        return Vec::new();
    };
    let [lo, hi] = mesh.bounds();
    (0..8)
        .map(|c| {
            let p = [
                if c & 1 == 0 { lo[0] } else { hi[0] },
                if c & 2 == 0 { lo[1] } else { hi[1] },
                if c & 4 == 0 { lo[2] } else { hi[2] },
            ];
            apply(&s.model, p)
        })
        .collect()
}

/// Whether the node a `mesh.asset@1` names has a primitive that names one of the file's materials
/// (#423), so it draws with them rather than with the item's paint.
fn asset_has_materials(read: Assets<'_>, params: &Value) -> bool {
    let Some(bytes) = params.get("sha256").and_then(Value::as_str).and_then(read) else {
        return false;
    };
    let node = params.get("node").cloned().unwrap_or(Value::from(0));
    crate::gltf::node_materials(&bytes, &node)
}

/// A `mesh.asset@1` naming a file's scene (#423): one solid per triangle primitive of each node,
/// picked as `<item>#<node name>` (or its index), placed at the item's `model` × the node's world
/// matrix, shaded by the `material@1` the import made of its glTF material. Naming one node, it
/// draws that node's primitives alone, in the node's own space, picked as the item.
#[allow(clippy::type_complexity)]
fn asset_scene(
    read: Assets<'_>,
    id: &str,
    params: &Value,
    model: &Affine3,
    look: &Look3,
) -> Result<(Vec<Solid>, Vec<([[f64; 4]; 3], Value)>), Refused> {
    let path = format!("items/{id}/params/sha256");
    let Some(sha) = params.get("sha256").and_then(Value::as_str) else {
        return refused("out_of_range", path);
    };
    let Some(bytes) = read(sha) else {
        return refused("asset_missing", path);
    };
    let scene_i = params
        .pointer("/node/scene")
        .and_then(Value::as_u64)
        .unwrap_or(0) as usize;
    let one = params.get("node").filter(|n| n.get("scene").is_none());
    let imported = crate::gltf::import(&bytes, sha, scene_i, read).map_err(|p| Refused {
        code: "out_of_range",
        path: format!("items/{id}/{p}"),
    })?;
    let mut out = Vec::new();
    // The file's punctual lights at their world transforms under the item's (#428).
    let lights = imported
        .lights
        .iter()
        .map(|(w, l)| (matmul(model, w), l.clone()))
        .collect();
    for (k, node) in imported.nodes.iter().enumerate() {
        let named = |n: &Value| match n {
            Value::Number(i) => i.as_u64() == Some(node.index as u64),
            Value::String(s) => *s == node.name,
            _ => false,
        };
        if one.is_some_and(|n| !named(n)) {
            continue;
        }
        let solid_model = match one {
            Some(_) => *model,
            None => matmul(model, &node.world),
        };
        for (p, prim) in node.primitives.iter().enumerate() {
            if prim.mesh.triangles() == 0 {
                continue;
            }
            let pick = match one {
                Some(_) => id.to_string(),
                None => format!("{id}#{}", node.name),
            };
            let mat_id = format!("{id}#material{}", prim.material.map_or(-1, |m| m as i64));
            let mat_item = serde_json::json!({"kind": "material@1", "params": prim
                .material
                .and_then(|m| imported.materials.get(m))
                .map_or_else(|| serde_json::json!({"metallic": 1.0, "roughness": 1.0, "base_color": [1, 1, 1, 1]}), |m| m.params.clone())});
            let holder = serde_json::json!({"material": mat_id});
            let named = |n: &str| (n == mat_id).then_some(&mat_item);
            let material = light::material(&holder, named, look, id)?;
            let maps = light::maps(&holder, named)?;
            let mut h = deep_canvas::schedule::Hasher::new("scene3d.mesh");
            h.text(&format!("{sha}#scene{scene_i}#{k}#{p}"));
            let key = h.finish().0;
            let hash = u64::from_le_bytes([
                key[0], key[1], key[2], key[3], key[4], key[5], key[6], key[7],
            ]);
            // Its coverage: the factor's alpha, which a mask's cutoff and a blend read with the
            // base color map's (opaque parts whole).
            let alpha = material.as_ref().map_or(1.0, |m| match m.alpha_mode {
                light::AlphaMode::Opaque => 1.0,
                _ => m.base[3],
            });
            out.push(Solid {
                id: pick,
                shape: Shape::Built(hash),
                model: solid_model,
                color: material
                    .as_ref()
                    .map_or([204; 3], |m| [m.base[0], m.base[1], m.base[2]].map(encode8)),
                stroke: None,
                mesh: Some(Arc::new(prim.mesh.clone())),
                lod: None,
                mask: None,
                cast_only: false,
                receiver_sets: 0,
                caster_sets: 0,
                inset: 0.0,
                cast_shadow: true,
                receive_shadow: true,
                emission: material.as_ref().map_or([0.0; 3], |m| m.emission),
                material,
                sort_bias: 0.0,
                alpha,
                maps,
                // An imported material names no operator.
                op: None,
                cut: false,
                per_pixel: false,
                adjust: None,
                batch: 0,
                row: 0,
                sway: None,
            });
        }
    }
    Ok((out, lights))
}

/// A figure lights one item at most (Object: `tone`, "one lit per figure"), and every tone is
/// of the closed list.
fn tones(map: &Map<String, Value>) -> Result<(), Refused> {
    let mut lit = false;
    for (id, item) in map
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let Some(tone) = item.get("tone") else {
            continue;
        };
        match tone.as_str() {
            Some("lit") if lit && map.get("profile").and_then(Value::as_str) == Some("figure") => {
                return refused("out_of_range", format!("items/{id}/tone"));
            }
            Some("lit") => lit = true,
            Some("faint" | "lo" | "mid" | "hi") => {}
            _ => return refused("out_of_range", format!("items/{id}/tone")),
        }
    }
    Ok(())
}

/// The material operator a solid's material names, on the solid's own clock (#429): inside a
/// time-remapped recipe instance, child time.
fn solid_op(
    items: &Items<'_>,
    map: &Map<String, Value>,
    program: &Program,
    t: i64,
    id: &str,
    item: &Value,
) -> Result<Option<SolidOp>, Refused> {
    let Some((op, op_item)) = light::material_op(item, |m| items.get(m))? else {
        return Ok(None);
    };
    let motion = &program.motion;
    let own = motion.item_time(id, eval::position(motion, t).0) - motion.transport.start;
    Ok(Some(SolidOp {
        id: op.to_string(),
        item: Arc::new(op_item.clone()),
        t: own as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64,
        doc_seed: map.get("seed").and_then(Value::as_u64).unwrap_or(0),
    }))
}

/// [`evaluate`] of a document whose motion program is compiled already.
pub(crate) fn evaluate_compiled(
    map: &Map<String, Value>,
    program: &Program,
    t: i64,
    look: &Look3,
    labels: &mut Labels,
    assets: Option<Assets<'_>>,
    outlines: Outlines<'_>,
) -> Result<Scene, Refused> {
    // What evaluation derives once per content key, kept in the host's memo the labels carry.
    let memo = labels.memo().clone();
    tones(map)?;
    let mut state = program.state();
    program.evaluate_local(t, eval::Validity::Full, &mut state);
    let seconds = t as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64;
    let empty = Map::new();
    let doc_items = map
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let written = eval::written(map, program, &state);
    let mut items = Items::new(doc_items, &written, &state, program);
    // #2013: a frame draws each rested item where its rest puts it; the check reports a rest
    // that finds no support.
    rest(
        map,
        program,
        &mut items,
        seconds,
        Rests::All,
        &mut Vec::new(),
    );
    let items = items;
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
    let mut layer_order: Vec<(&str, &str)> = map
        .get("layers")
        .and_then(Value::as_object)
        .map(|l| {
            l.iter()
                .map(|(id, layer)| (order_key(layer), id.as_str()))
                .collect()
        })
        .unwrap_or_default();
    layer_order.sort();
    // Each layer's items: their order keys, IDs and evaluated items.
    let mut by_layer: BTreeMap<&str, Vec<(&str, &String, &Value)>> = BTreeMap::new();
    for (id, item) in items.iter() {
        let layer = item.get("layer").and_then(Value::as_str).unwrap_or("");
        by_layer
            .entry(layer)
            .or_default()
            .push((order_key(item), id, item));
    }
    let mut order: Vec<&str> = Vec::new();
    if by_layer.contains_key("") {
        order.push("");
    }
    order.extend(layer_order.into_iter().map(|(_, id)| id));
    for id in by_layer.keys() {
        if !order.contains(id) {
            order.push(id);
        }
    }

    let mut layers = Vec::new();
    let mut overlay_items = Vec::new();
    let mut readout_items: Vec<(String, Value)> = Vec::new();
    // The document as builders read it (the curves they name), made once when one draws.
    let mut doc_value: Option<Value> = None;
    let mut bounds: Vec<Vec3> = Vec::new();
    let mut sun = None;
    let mut painted = BTreeMap::new();
    let mut lights = Vec::new();
    let mut sky = None;
    let mut puffs = 0u64;
    let mut others = Vec::new();
    let mut curves = BTreeMap::new();
    // #424: the prototypes instancers name, whose solids are kept in their own space whether or
    // not they draw themselves; the instancers, placed once every layer is read; the cutaway.
    let mut protos_wanted: std::collections::BTreeSet<&str> = std::collections::BTreeSet::new();
    for (id, item) in items.iter() {
        if item.get("kind").and_then(Value::as_str) == Some("instance@1") && shown(&items, id) {
            for p in item
                .pointer("/params/of")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if let Some(p) = p.as_str() {
                    protos_wanted.insert(p);
                }
            }
        }
    }
    let mut protos: HashMap<String, Vec<Solid>> = HashMap::new();
    let mut instancers: Vec<(usize, String)> = Vec::new();
    let mut cutaway = None;
    let mut flare: Option<Arc<crate::flare::Flare>> = None;
    let mut probe_items: Vec<crate::probe::Wanted> = Vec::new();
    // The IES tables the lights name (#446).
    let mut tables: Vec<Arc<crate::ies::Distribution>> = Vec::new();
    for layer_id in &order {
        let Some(list) = by_layer.get_mut(layer_id) else {
            continue;
        };
        // IDs are unique, so this is the order of (order key, ID) alone.
        list.sort_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));
        let mut layer = Layer3 {
            id: layer_id.to_string(),
            ..Layer3::default()
        };
        for &(_, id, item) in list.iter() {
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
            // An item draws when it and every parent are visible (Item: `visible`, inherited);
            // a prototype is read either way, for its instancers.
            let visible = shown(&items, id);
            let proto = protos_wanted.contains(id.as_str());
            if !visible && !proto {
                continue;
            }
            let before = layer.solids.len();
            let path = format!("items/{id}/params");
            let empty = Value::Object(Map::new());
            let params = item.get("params").unwrap_or(&empty);
            if let (true, Some(p)) = (look.drawn.is_some(), params.get("paint")) {
                painted.insert(id.clone(), p.clone());
            }
            // #1653: a 3D item's lights shade it, and Modifier: bevel bevels it; never a 2D
            // paint's bevel or shade.
            if let Some(field) = ["bevel", "shade"]
                .into_iter()
                .find(|f| is_3d(kind) && params.pointer(&format!("/paint/{f}")).is_some())
            {
                return refused("paint_2d_only", format!("{path}/paint/{field}"));
            }
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
                    let material = light::material(item, |m| items.get(m), look, id)?;
                    let maps = light::maps(item, |m| items.get(m))?;
                    let surface = surface(&items, look, id, item)?;
                    if surface.alpha <= 0.0 {
                        continue;
                    }
                    layer.solids.push(Solid {
                        maps,
                        id: id.clone(),
                        shape,
                        model,
                        color: match (surface.color, &material) {
                            (Some(c), _) => c,
                            // A material's default base color (#421), unless paint gives one.
                            (None, Some(m)) if params.pointer("/paint/fill").is_none() => {
                                [m.base[0], m.base[1], m.base[2]].map(encode8)
                            }
                            (None, _) => paint(look, params, &path)?,
                        },
                        stroke: inked(
                            stroke(look, params, shape, &path)?,
                            &material,
                            shape,
                            &path,
                        )?,
                        mesh: None,
                        lod: lod_of(item, &path, [[-0.5; 3], [0.5; 3]], None, map, &memo)?,
                        mask: None,
                        cast_only: false,
                        receiver_sets: 0,
                        caster_sets: 0,
                        inset: 0.0,
                        cast_shadow: casts(item, &material),
                        receive_shadow: shadows(item, "receive_shadow"),
                        material,
                        sort_bias: num(item.get("sort_bias")).unwrap_or(0.0),
                        alpha: surface.alpha,
                        emission: surface.emission,
                        op: solid_op(&items, map, program, t, id, item)?,
                        cut: false,
                        per_pixel: false,
                        adjust: None,
                        batch: 0,
                        row: 0,
                        sway: None,
                    });
                }
                "mark.line@1" if params.get("edges").is_some_and(|e| !e.is_null()) => {
                    let doc = doc_value.get_or_insert_with(|| Value::Object(map.clone()));
                    let l = edge_line(
                        doc, &items, id, params, look, seconds, outlines, assets, &memo,
                    )?;
                    bounds.extend(l.segments.iter().flat_map(|s| [s.a, s.b]));
                    layer.lines.push(l);
                }
                "mesh.asset@1" if assets.is_none() => {}
                // A glTF file's whole scene (#423): each node at its world transform in the file,
                // drawn with the materials the file declares.
                "mesh.asset@1"
                    if params.pointer("/node/scene").is_some()
                        || (item.get("material").is_none()
                            && asset_has_materials(assets.expect("matched above"), params)) =>
                {
                    let read = assets.expect("matched above");
                    let model = world(&items, id);
                    let (solids, file_lights) = asset_scene(read, id, params, &model, look)?;
                    for s in solids {
                        bounds.extend(corners_of(&s));
                        layer.solids.push(s);
                    }
                    // A directional KHR_lights_punctual light lights the view as a sun of its
                    // intensity in lx and its color (#428).
                    for (k, (m, l)) in file_lights.iter().enumerate() {
                        if l.get("type").and_then(Value::as_str) != Some("directional") {
                            continue;
                        }
                        let lid = format!("{id}#light{k}");
                        let p = serde_json::json!({
                            "illuminance": num(l.get("intensity")).unwrap_or(1.0),
                            "color": l.get("color").cloned().unwrap_or(serde_json::json!([1, 1, 1])),
                        });
                        let dir = normalize(turn(m, [0.0, 0.0, -1.0]));
                        lights.extend(light::light(
                            &lid,
                            "light.sun@1",
                            &p,
                            origin(m),
                            dir,
                            axes(m),
                            1.0,
                        ));
                        if sun.is_none() {
                            sun = Some(Sun {
                                id: lid,
                                toward: normalize(turn(m, [0.0, 0.0, 1.0])),
                                illuminance: num(p.get("illuminance")).unwrap_or(1.0),
                                shadow: false,
                                cascades: cascades(&p, &path)?,
                            });
                        }
                    }
                }
                "mesh.sequence@1" if assets.is_none() => {}
                // #419's stand-in for the physics module: each body a sphere at the bake's
                // position at t, read from the bake, never stepped.
                "fixture.world@1" => {
                    let w = crate::fixtures::bake(params, &path)?;
                    let material = light::material(item, |m| items.get(m), look, id)?;
                    let surface = surface(&items, look, id, item)?;
                    for (b, p) in w.bodies.iter().zip(w.at(t)) {
                        let r = 2.0 * b.radius;
                        let model = [
                            [r, 0.0, 0.0, p[0]],
                            [0.0, r, 0.0, p[1]],
                            [0.0, 0.0, r, p[2]],
                        ];
                        bounds.extend(corners(&model));
                        layer.solids.push(Solid {
                            maps: None,
                            id: format!("{id}#{}", b.id),
                            shape: Shape::Sphere,
                            model,
                            color: match (&surface.color, &material) {
                                (Some(c), _) => *c,
                                (None, Some(m)) => [m.base[0], m.base[1], m.base[2]].map(encode8),
                                (None, None) => paint(look, params, &path)?,
                            },
                            stroke: None,
                            mesh: None,
                            lod: None,
                            mask: None,
                            cast_only: false,
                            receiver_sets: 0,
                            caster_sets: 0,
                            inset: 0.0,
                            cast_shadow: casts(item, &material),
                            receive_shadow: shadows(item, "receive_shadow"),
                            material,
                            sort_bias: 0.0,
                            alpha: surface.alpha,
                            emission: surface.emission,
                            op: None,
                            cut: false,
                            per_pixel: false,
                            adjust: None,
                            batch: 0,
                            row: 0,
                            sway: None,
                        });
                    }
                }
                k if crate::builders::KINDS.contains(&k)
                    || crate::building::KINDS.contains(&k)
                    || k == "mesh.asset@1"
                    || k == "mesh.sequence@1"
                    || k == "fixture.skin@1" =>
                {
                    let doc = doc_value.get_or_insert_with(|| Value::Object(map.clone()));
                    let (mesh, shared) = match (k, assets) {
                        ("mesh.asset@1", Some(read)) => asset_mesh(read, id, params)?,
                        // #419's stand-ins: a pre-skin per time, and a sequence's frame at t.
                        ("fixture.skin@1", _) => (crate::fixtures::skin(params, &path)?, None),
                        ("mesh.sequence@1", Some(read)) => {
                            (crate::fixtures::sequence(params, t, &path, read)?, None)
                        }
                        _ => (mesh_of(doc, id, item, seconds, outlines)?, None),
                    };
                    if mesh.triangles() == 0 {
                        continue;
                    }
                    let model = world(&items, id);
                    let [lo, hi] = mesh.bounds();
                    for c in 0..8 {
                        let p = [
                            if c & 1 == 0 { lo[0] } else { hi[0] },
                            if c & 2 == 0 { lo[1] } else { hi[1] },
                            if c & 4 == 0 { lo[2] } else { hi[2] },
                        ];
                        bounds.push(apply(&model, p));
                    }
                    // Equal meshes, and items naming one asset and node, share one mesh.
                    let mut h = deep_canvas::schedule::Hasher::new("scene3d.mesh");
                    match &shared {
                        Some(name) => h.text(name),
                        None => h.bytes(&deep_canvas::schedule::Canonical::canonical_bytes(&mesh)),
                    };
                    // A swaying mesh moves per instance on the GPU (#2016).
                    let sway = mesh.sway.as_ref().map(|_| Swaying {
                        t: seconds,
                        seed: map.get("seed").and_then(Value::as_u64).unwrap_or(0),
                    });
                    let key = h.finish().0;
                    let material = light::material(item, |m| items.get(m), look, id)?;
                    let maps = light::maps(item, |m| items.get(m))?;
                    let mut hash = u64::from_le_bytes([
                        key[0], key[1], key[2], key[3], key[4], key[5], key[6], key[7],
                    ]);
                    if sway.is_some() {
                        hash = swaying_shape(hash, id);
                    }
                    let surface = surface(&items, look, id, item)?;
                    if surface.alpha <= 0.0 {
                        continue;
                    }
                    layer.solids.push(Solid {
                        maps,
                        id: id.clone(),
                        shape: Shape::Built(hash),
                        model,
                        color: match (surface.color, &material) {
                            (Some(c), _) => c,
                            // A material's default base color (#421), unless paint gives one.
                            (None, Some(m)) if params.pointer("/paint/fill").is_none() => {
                                [m.base[0], m.base[1], m.base[2]].map(encode8)
                            }
                            (None, _) => paint_or_muted(look, params, &path)?,
                        },
                        stroke: inked(
                            stroke(look, params, Shape::Built(hash), &path)?,
                            &material,
                            Shape::Built(hash),
                            &path,
                        )?,
                        lod: lod_of(item, &path, mesh.bounds(), Some((&mesh, hash)), map, &memo)?,
                        mesh: Some(Arc::new(mesh)),
                        mask: None,
                        cast_only: false,
                        receiver_sets: 0,
                        caster_sets: 0,
                        inset: 0.0,
                        cast_shadow: casts(item, &material),
                        receive_shadow: shadows(item, "receive_shadow"),
                        material,
                        sort_bias: num(item.get("sort_bias")).unwrap_or(0.0),
                        alpha: surface.alpha,
                        emission: surface.emission,
                        op: solid_op(&items, map, program, t, id, item)?,
                        cut: false,
                        per_pixel: false,
                        adjust: None,
                        batch: 0,
                        row: 0,
                        sway,
                    });
                    // #2017: a plate with levels draws as its tiles, each at the level its error
                    // projected at the view chooses.
                    if k == "plate@1" && uniform(&model) {
                        let plate = layer.solids.last().expect("just pushed");
                        let built = plate.mesh.as_ref().expect("a built mesh");
                        if let Some(tiles) = crate::terrain::tiles(params, built, hash, &memo) {
                            let plate = layer.solids.pop().expect("just pushed");
                            let lod_px = crate::lod::lod_px(map);
                            for t in tiles.iter() {
                                let mut s = plate.clone();
                                s.mesh = Some(t.levels[0].mesh.clone());
                                s.shape = Shape::Built(t.levels[0].hash);
                                s.lod = Some(Arc::new(crate::lod::Lod {
                                    bands: Vec::new(),
                                    margin: 0.0,
                                    bounds: t.bounds,
                                    levels: t.levels.clone(),
                                    extent: 1.0,
                                    lod_px,
                                    proxy: None,
                                    proxy_mesh: None,
                                    tile: Some(t.at),
                                }));
                                layer.solids.push(s);
                            }
                        }
                    }
                }
                // A curve draws nothing; what follows it (particles along it, #420) reads it
                // sampled, in world metres.
                "curve@1" => {
                    if let Ok(c) = crate::curve::sample(params) {
                        let m = world(&items, id);
                        let mut points: Vec<Vec3> =
                            c.points.iter().map(|p| apply(&m, *p)).collect();
                        if c.closed {
                            points.push(points[0]);
                        }
                        curves.insert(id.clone(), points);
                    }
                }
                "mark.line@1" => {
                    let mut l = line(&items, id, params, look, (map, t))?;
                    let under = strokes(map, id, item, &mut l, look, seconds)?;
                    bounds.extend(crate::points::ends(&l));
                    layer.lines.extend(under);
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
                    // A screen-size label's run is a 2D text's of that text, font and size.
                    let run_size = if world_space {
                        WORLD_EM_PX
                    } else {
                        size as f32
                    };
                    let (run_box, glyphs) = labels.run(text, role, run_size);
                    let shaped_at = glyphs.first().map_or(run_size, |g| g.size);
                    let to_em = size / f64::from(shaped_at);
                    let m = world(&items, id);
                    let pos = origin(&m);
                    bounds.push(pos);
                    layer.labels.push(Label {
                        id: id.clone(),
                        text: text.to_string(),
                        role,
                        glyphs,
                        bounds: run_box,
                        pos,
                        em: size,
                        quad: [run_box[0] * to_em, run_box[1] * to_em],
                        world: world_space,
                        facing,
                        axes: [
                            normalize(turn(&m, [1.0, 0.0, 0.0])),
                            normalize(turn(&m, [0.0, 1.0, 0.0])),
                        ],
                        color: paint(look, params, &path)?,
                    });
                }
                OVERLAY => overlay_items.push((layer_id.to_string(), id.clone())),
                // #1183: an overlay whose `show` is false at t draws nothing.
                "overlay.text@1" if params.get("show") == Some(&Value::Bool(false)) => {}
                "overlay.text@1" => readout_items.push((id.clone(), params.clone())),
                "puff@1" => {
                    let m = world(&items, id);
                    layer.puffs.push(puff(id, params, origin(&m), &path)?);
                    puffs += 1;
                }
                "light.sun@1" if sun.is_none() => {
                    // A light shines along its local −Z, glTF's convention for lights.
                    let m = world(&items, id);
                    let dir = normalize(turn(&m, [0.0, 0.0, -1.0]));
                    let flicker = flicker(program, &state, params, &path)?;
                    lights.extend(light::light(
                        id,
                        kind,
                        params,
                        origin(&m),
                        dir,
                        axes(&m),
                        flicker,
                    ));
                    crate::sets::read_light_in(
                        lights.last_mut(),
                        params,
                        &path,
                        map,
                        &mut tables,
                        assets,
                        &memo,
                    )?;
                    sun = Some(Sun {
                        id: id.clone(),
                        toward: normalize(turn(&m, [0.0, 0.0, 1.0])),
                        illuminance: num(params.get("illuminance")).unwrap_or(10_000.0),
                        shadow: params
                            .get("shadow")
                            .and_then(Value::as_bool)
                            .unwrap_or(false),
                        cascades: cascades(params, &path)?,
                    });
                }
                "sky@1" if sky.is_none() => {
                    sky = Some(crate::sky::parse(id, params, look, assets)?);
                }
                "light.sun@1" | "light.point@1" | "light.spot@1" | "light.area@1" => {
                    let m = world(&items, id);
                    let dir = normalize(turn(&m, [0.0, 0.0, -1.0]));
                    let flicker = flicker(program, &state, params, &path)?;
                    lights.extend(light::light(
                        id,
                        kind,
                        params,
                        origin(&m),
                        dir,
                        axes(&m),
                        flicker,
                    ));
                    crate::sets::read_light_in(
                        lights.last_mut(),
                        params,
                        &path,
                        map,
                        &mut tables,
                        assets,
                        &memo,
                    )?;
                }
                // A material draws nothing itself; the objects naming it read it (#418). A group
                // draws nothing either: its children take its transform and its `visible` (#424).
                "camera@1" | "sky@1" | "material@1" | "group@1" => {}
                // #424: an instancer's elements, placed once its prototypes are read.
                "instance@1" => instancers.push((layers.len(), id.clone())),
                // #465: the first flare is the view's; scene3d draws no other effect kind.
                "effect@1" => {
                    let f = crate::flare::parse(id, params, look)?;
                    flare.get_or_insert_with(|| Arc::new(f));
                }
                "cutaway@1" if cutaway.is_none() => {
                    cutaway = Some(crate::cut::cutaway(
                        id,
                        params,
                        &path,
                        |r| {
                            look.role(r).map(|c| {
                                c.map(|v| deep_canvas::color::srgb_decode(f64::from(v) / 255.0))
                            })
                        },
                        look.basis == crate::look::Basis::Physical,
                    )?);
                }
                "cutaway@1" => {}
                // #427: a probe draws nothing; its capture is made once the lights are read.
                "light.probe@1" => {
                    let pos = origin(&world(&items, id));
                    probe_items.push(crate::probe::read(id, params, pos, &path)?);
                }
                _ => others.push(Other {
                    id: id.clone(),
                    kind: kind.to_string(),
                    params: params.clone(),
                    pos: origin(&world(&items, id)),
                }),
            }
            if proto {
                protos.insert(id.clone(), layer.solids[before..].to_vec());
            }
            if !visible {
                layer.solids.truncate(before);
            }
        }
        if !layer.items().is_empty() || instancers.iter().any(|(l, _)| *l == layers.len()) {
            layers.push(layer);
        }
    }
    // The instancers an operator's instances output draws, whatever their count (#484); the
    // batches of the instancers the GPU culls, each its own across the scene.
    let mut fed = std::collections::BTreeSet::new();
    for (id, item) in doc_items {
        if item.get("kind").and_then(Value::as_str) != Some("gpu.compute@1") {
            continue;
        }
        let outputs = item.pointer("/params/outputs").and_then(Value::as_object);
        for v in outputs.into_iter().flat_map(|o| o.values()) {
            let Some(named) = v.pointer("/instances/instancer").and_then(Value::as_str) else {
                continue;
            };
            if !instancers.iter().any(|(_, i)| i == named) {
                return refused("ref_unresolved", format!("items/{id}/params/outputs"));
            }
            fed.insert(named.to_string());
        }
    }
    let mut batches: Vec<(&str, Shape, Option<Material>)> = Vec::new();
    // Each element: its prototype's solids moved from the prototype's world to the instancer's
    // world × the element's own transform, addressed `<instancer>#<id>` (Instance `instance@1`).
    for (l, id) in &instancers {
        let path = format!("items/{id}/params");
        let empty = Value::Object(Map::new());
        let params = items[id.as_str()].get("params").unwrap_or(&empty);
        let (of, elements) = match params.get("from").filter(|f| !f.is_null()) {
            // #2013: its rows from a scatter.
            Some(from) => {
                let doc = doc_value.get_or_insert_with(|| Value::Object(map.clone()));
                let (of, rows) =
                    scattered(map, doc, &items, id, params, from, seconds, outlines, None)?;
                let elements = rows
                    .iter()
                    .enumerate()
                    .map(|(k, r)| crate::cut::Element {
                        id: u64::from(r.id),
                        row: k as u32,
                        proto: r.proto,
                        at: r.at(),
                    })
                    .collect();
                (of, elements)
            }
            None => crate::cut::elements(params, &path)?,
        };
        let at = world(&items, id);
        let from: Vec<Affine3> = of
            .iter()
            .map(|p| crate::cut::inverse(&world(&items, p)))
            .collect();
        if crate::slots::fed(params) {
            let sink = (&mut batches, &mut layers[*l], &mut bounds);
            crate::slots::place(map, id, params, t, (&at, &of, &from, assets), &protos, sink)?;
            continue;
        }
        // Above the line, or drawn from an instances output, the GPU culls each (prototype,
        // material) batch (#484); inside a batch elements upload by stable ID, so survivors in
        // index order are in stable-ID order.
        let gpu = elements.len() > crate::cut::GPU_CULLED_ABOVE || fed.contains(id.as_str());
        let mut elements = elements;
        if gpu {
            elements.sort_by_key(|e| e.id);
        }
        // #2017: a prototype whose sway weighs each vertex by its height, batched on the GPU,
        // sways as a shear of each element's place, so every element keeps the one rest mesh.
        type Sheared = HashMap<(usize, usize), Option<(Arc<crate::geom::Mesh>, u64)>>;
        let mut sheared: Sheared = HashMap::new();
        for e in elements {
            let Some(solids) = protos.get(&of[e.proto]) else {
                return refused("ref_unresolved", format!("{path}/of"));
            };
            let place = matmul(&matmul(&at, &e.at), &from[e.proto]);
            for (k, s) in solids.iter().enumerate() {
                let mut s = s.clone();
                let own = if solids.len() == 1 {
                    format!("{id}#{}", e.id)
                } else {
                    format!("{id}#{}#{k}", e.id)
                };
                let shear = match (gpu, s.sway, s.shape) {
                    (true, Some(_), Shape::Built(h)) => sheared
                        .entry((e.proto, k))
                        .or_insert_with(|| rest_of(&s, h))
                        .clone(),
                    _ => None,
                };
                if let (Some((rest, h)), Some(at)) = (shear, s.sway) {
                    let sway = s
                        .mesh
                        .as_ref()
                        .and_then(|m| m.sway.as_ref())
                        .expect("swaying");
                    let shear = shear_of(&matmul(&place, &s.model), sway, &rest, at);
                    s.model = matmul(&s.model, &shear);
                    s.mesh = Some(rest);
                    s.shape = Shape::Built(h);
                    s.sway = None;
                }
                // A swaying element moves by its own place on the GPU (#2016): it draws its own
                // copy.
                if let (Some(_), Shape::Built(h)) = (s.sway, s.shape) {
                    s.shape = Shape::Built(swaying_shape(h, &own));
                }
                if gpu {
                    s.row = e.row;
                    let key = (id.as_str(), s.shape, s.material);
                    let at = batches.iter().position(|b| *b == key);
                    s.batch = 1 + at.unwrap_or_else(|| {
                        batches.push(key);
                        batches.len() - 1
                    }) as u32;
                }
                s.id = own;
                s.model = matmul(&place, &s.model);
                s.op = None;
                bounds.extend(s.points());
                layers[*l].solids.push(s);
            }
        }
    }
    layers.retain(|l| !l.items().is_empty());
    let mut max_fragments: u64 = 8_388_608;
    // Each solid's adjust past opacity, by its item (an element's, its instancer's), and how it
    // resolves (#424).
    for s in layers.iter_mut().flat_map(|l| &mut l.solids) {
        let owner = s.id.split('#').next().unwrap_or(&s.id);
        s.adjust = items.get(owner).and_then(|i| adjust3(look, i));
        let item = items.get(owner);
        s.per_pixel =
            item.and_then(|i| i.get("resolve")).and_then(Value::as_str) == Some("per_pixel");
        if s.per_pixel {
            if let Some(m) = item
                .and_then(|i| i.get("max_fragments"))
                .and_then(Value::as_u64)
            {
                max_fragments = max_fragments.min(m.max(1));
            }
        }
    }
    // The class's GPU memory, at 16 B a fragment (Object: see-through order).
    let budget = Value::Object(
        map.get("budget")
            .map(|b| ("budget".to_string(), b.clone()))
            .into_iter()
            .collect(),
    );
    let gpu = deep_canvas::budget::of(&budget).map_or(512 << 20, |(_, l)| l.gpu_bytes);
    let fragments = [max_fragments, (gpu / 16).max(max_fragments)];

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

    // A readout sits in the view's top-left corner, its text the template's (#419), filled from
    // the values that move the parts at t; a figure's card stacks its lines below (#504).
    let shown = (!readout_items.is_empty() || map.contains_key("card"))
        .then(|| eval::shown_doc(map, program, &state));
    let card: Vec<(String, Value)> = shown
        .as_ref()
        .map(|s| {
            deep_canvas::template::card_lines(s)
                .into_iter()
                .map(|(f, t)| (format!("card/{f}"), serde_json::json!({"template": t})))
                .collect()
        })
        .unwrap_or_default();
    let mut readouts = Vec::new();
    let mut top = 12.0;
    for (id, params) in readout_items.iter().chain(card.iter()) {
        let template = params.get("template").and_then(Value::as_str).unwrap_or("");
        let filled = shown
            .as_ref()
            .and_then(|s| deep_canvas::template::expand_in(s, id, template).ok());
        let text = filled.as_deref().unwrap_or(template);
        let size = num(params.get("size")).unwrap_or(13.0);
        let (run_box, glyphs) = labels.run(text, Role::Body, size as f32);
        let shaped_at = glyphs.first().map_or(size as f32, |g| g.size);
        let quad = [
            run_box[0] * size / f64::from(shaped_at),
            run_box[1] * size / f64::from(shaped_at),
        ];
        let depth = if camera.perspective {
            2.0 * camera.near
        } else {
            camera.near + 0.01
        };
        readouts.push(Label {
            id: id.clone(),
            text: text.to_string(),
            role: Role::Body,
            glyphs,
            bounds: run_box,
            pos: camera.unproject(12.0 + quad[0] / 2.0, top + quad[1] / 2.0, depth),
            em: size,
            quad,
            world: false,
            facing: Facing::Camera,
            axes: [camera.right, camera.up],
            color: look
                .role("stone")
                .or(look.role("ink"))
                .unwrap_or([255, 255, 255]),
        });
        top += quad[1] + 4.0;
    }
    // Each label's glyphs from the atlas at its size on screen; a frame that found the atlas full
    // starts it over and places them all again.
    labels.begin();
    for pass in 0..2 {
        for l in layers
            .iter_mut()
            .flat_map(|layer| layer.labels.iter_mut())
            .chain(readouts.iter_mut())
        {
            let em_px = if l.world {
                l.em * camera.px_per_m(camera.to_view(l.pos)[2])
            } else {
                l.em
            };
            labels.place(&l.text, l.role, &mut l.glyphs, l.bounds, em_px, l.world);
        }
        if pass == 1 || !labels.make_room() {
            break;
        }
    }

    let mut overlays = Vec::new();
    for (layer, id) in overlay_items {
        overlays.push(overlay(&items, &layer, &id, &camera, look)?);
    }
    // Puffs past the document's cap are refused, never dropped (#422).
    let cap = map
        .get("budget")
        .and_then(|b| b.get("puffs"))
        .and_then(Value::as_u64)
        .unwrap_or(512);
    if puffs > cap {
        return refused("out_of_range", "budget/puffs");
    }
    crate::sets::compile(map, &mut lights, &mut layers)?;
    let probes = probes(map, probe_items, &lights, &layers, sky.as_ref())?;
    // #149: a drawing look lights its marks from its own light, with no Light item.
    if let (None, true, Some(l)) = (&sun, lights.is_empty(), drawn_light(look)) {
        sun = Some(l);
    }
    let mut scene = Scene {
        size,
        camera,
        ground: look.ground,
        layers,
        overlays,
        sun,
        painted,
        lights,
        sky,
        others,
        light_cut: None,
        curves,
        pages: labels.pages(),
        motion: None,
        velocity: None,
        readouts,
        texels: BTreeMap::new(),
        jitter: [0.0; 2],
        cutaway: None,
        fragments,
        distributions: tables,
        shadowing: crate::sets::policy(map)?,
        sample_turn: None,
        print: deep_canvas_marks::print::frame(
            &look.print,
            map.get("seed").and_then(Value::as_u64).unwrap_or(0) as u32,
            t,
            false,
        ),
        mirror: None,
        flare,
        water: None,
        read_reflection: false,
        read_foam: false,
        probes,
        tints: crate::tints::tints(map, look, t)?,
    };
    scene.set_cutaway(cutaway);
    scene.mirror = crate::mirror::find(&scene.layers, scene.camera.eye, |id| items.get(id))?;
    // #166: the water, its wake's path, and its own mirror unless a material names one.
    let seed = map.get("seed").and_then(Value::as_u64).unwrap_or(0) as u32;
    if let Some(mut w) = crate::water::find(&scene.layers, |id| items.get(id), seed, seconds)? {
        if let Some(wake) = &mut w.wake {
            let step = frame_interval(map);
            wake.step = step as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64;
            let times = crate::water::wake_times(t, step, wake.span);
            wake.path = wake_path(map, program, &items, &w.material, &wake.item, &times)?;
        }
        // #268: the shore's field, baked once per key.
        if let Some(shore) = &mut w.shore {
            let plates: Vec<[f64; 4]> = w.plates.iter().map(|(_, p)| *p).collect();
            shore.field = Some(crate::shore::field(
                map,
                &w.material,
                shore,
                &scene.layers,
                &plates,
                w.level,
                crate::shore::Planted::None,
                &memo,
            )?);
        }
        if scene.mirror.is_none() {
            scene.mirror = crate::mirror::own(&scene.layers, scene.camera.eye, &w);
        }
        scene.water = Some(Arc::new(w));
    }
    Ok(scene)
}

/// #166: where a wake's item stood in the water's plane (x, z) at each of `times`, read through
/// the chain a trail reads: its channels and parents, or a physics bake's output kept through the
/// world's span, never an earlier frame ([`crate::water::logic_moved`] refuses an item a logic
/// array moves before this).
fn wake_path(
    map: &Map<String, Value>,
    program: &Program,
    items: &Items<'_>,
    material: &str,
    item: &str,
    times: &[i64],
) -> Result<Vec<[f64; 2]>, Refused> {
    let unresolved = || {
        refused(
            "ref_unresolved",
            format!("items/{material}/params/water/wake/item"),
        )
    };
    // A body of a baked world: `<world>#<body>`.
    if let Some((owner, body)) = item.split_once('#') {
        let Some(world) = items
            .get(owner)
            .filter(|w| w.get("kind").and_then(Value::as_str) == Some("fixture.world@1"))
        else {
            return unresolved();
        };
        let params = world.get("params").cloned().unwrap_or(Value::Null);
        let bake = crate::fixtures::bake(&params, &format!("items/{owner}/params"))?;
        let Some(k) = bake.bodies.iter().position(|b| b.id == body) else {
            return unresolved();
        };
        return Ok(times
            .iter()
            .map(|&at| {
                let p = bake.at(at)[k];
                [p[0], p[2]]
            })
            .collect());
    }
    if items.get(item).is_none() {
        return unresolved();
    }
    Ok(times
        .iter()
        .map(|&at| {
            let o = origin_at(map, program, item, at);
            [o[0], o[2]]
        })
        .collect())
}

/// The document's frame interval in flicks: its transport's `frame_rate`, 60/1 by default.
fn frame_interval(map: &Map<String, Value>) -> i64 {
    let (p, q) = map
        .get("transport")
        .and_then(deep_canvas::document::frame_rate_of)
        .filter(|(p, q)| *p > 0 && *q > 0)
        .unwrap_or((60, 1));
    deep_canvas::camera::FLICKS_PER_SECOND * i64::from(q) / i64::from(p)
}

/// Item `id`'s world origin at `t`, through the chain its channels and parents give: what a
/// wake reads at an earlier time, never an earlier frame.
fn origin_at(map: &Map<String, Value>, program: &Program, id: &str, t: i64) -> Vec3 {
    let mut state = program.state();
    program.evaluate_local(t, eval::Validity::Full, &mut state);
    let empty = Map::new();
    let doc_items = map
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let written = eval::written(map, program, &state);
    let mut items = Items::new(doc_items, &written, &state, program);
    let seconds = t as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64;
    rest(
        map,
        program,
        &mut items,
        seconds,
        Rests::All,
        &mut Vec::new(),
    );
    origin(&world(&items, id))
}

/// The document's light probes, each captured or baked from what it sees (#427). Figures and
/// data views refuse probes, and `budget.probes` caps each type (reflection 8, irradiance 4).
fn probes(
    map: &Map<String, Value>,
    wanted: Vec<crate::probe::Wanted>,
    lights: &[crate::light::Light],
    layers: &[Layer3],
    sky: Option<&crate::sky::Sky>,
) -> Result<Vec<crate::probe::Probe>, Refused> {
    use crate::probe::{ProbeKind, MAX_IRRADIANCE, MAX_REFLECTION};
    let Some(first) = wanted.first() else {
        return Ok(Vec::new());
    };
    if matches!(
        map.get("profile").and_then(Value::as_str),
        Some("figure" | "view" | "chart" | "sheet" | "cells")
    ) {
        return refused("out_of_range", format!("items/{}/kind", first.id));
    }
    for (kind, name, most) in [
        (ProbeKind::Reflection, "reflection", MAX_REFLECTION),
        (ProbeKind::Irradiance, "irradiance", MAX_IRRADIANCE),
    ] {
        let cap = map
            .get("budget")
            .and_then(|b| b.pointer(&format!("/probes/{name}")))
            .and_then(Value::as_u64)
            .map_or(most, |c| (c as usize).min(most));
        if wanted.iter().filter(|w| w.kind == kind).count() > cap {
            return refused("out_of_range", format!("budget/probes/{name}"));
        }
    }
    let around = crate::probe::Surroundings::of(layers, sky.map(|s| s.ambient));
    Ok(wanted
        .into_iter()
        .map(|w| crate::probe::capture(w, lights, &around))
        .collect())
}

/// Whether `id` and each of its parents are visible (Item: `visible`, inherited).
fn shown(items: &Items<'_>, id: &str) -> bool {
    let mut at = Some(id);
    let mut seen = 0;
    while let Some(i) = at {
        let Some(item) = items.get(i) else {
            return true;
        };
        if item.get("visible") == Some(&Value::Bool(false)) {
            return false;
        }
        at = item.get("parent").and_then(Value::as_str);
        seen += 1;
        if seen > 64 {
            return true;
        }
    }
    true
}

/// An item's adjust (Item and kind: adjust), `None` at the identity (#424).
fn adjust3(look: &Look3, item: &Value) -> Option<Adjust3> {
    let m = item.get("adjust")?.as_object()?;
    let n = |k: &str, d: f64| num(m.get(k)).unwrap_or(d);
    let a = Adjust3 {
        opacity: n("opacity", 1.0).clamp(0.0, 1.0),
        tint: m
            .get("tint")
            .and_then(|t| t.as_str().or_else(|| t.get("role").and_then(Value::as_str)))
            .and_then(|r| look.role(r))
            .map(|c| c.map(|v| deep_canvas::color::srgb_decode(f64::from(v) / 255.0))),
        hue: n("hue", 0.0),
        saturation: n("saturation", 1.0),
        brightness: n("brightness", 1.0),
        contrast: n("contrast", 1.0),
        exposure: n("exposure", 0.0),
        gamma: n("gamma", 1.0),
        invert: m.get("invert") == Some(&Value::Bool(true)),
    };
    (a.colors() || a.opacity < 1.0).then_some(a)
}

fn xy(v: Option<&Value>) -> Option<[f64; 2]> {
    let a = v?.as_array()?;
    if a.len() != 2 {
        return None;
    }
    Some([num(a.first())?, num(a.get(1))?])
}

/// A `puff@1` at `pos` (#422).
fn puff(id: &str, params: &Value, pos: Vec3, path: &str) -> Result<Puff, Refused> {
    let field = |k: &str, default: f64, ok: fn(f64) -> bool| -> Result<f64, Refused> {
        match params.get(k) {
            None => Ok(default),
            Some(v) => num(Some(v)).filter(|x| ok(*x)).ok_or(Refused {
                code: "out_of_range",
                path: format!("{path}/{k}"),
            }),
        }
    };
    let radius = field("radius", 1.0, |r| r > 0.0)?;
    let light = params.get("light");
    let on = |k: &str, yes: &str| -> Result<bool, Refused> {
        match light.and_then(|l| l.get(k)) {
            None => Ok(true),
            Some(Value::String(s)) if s == yes => Ok(true),
            Some(Value::String(s)) if s == "none" => Ok(false),
            Some(_) => refused("out_of_range", format!("{path}/light/{k}")),
        }
    };
    let lf = |k: &str, default: f64| -> Result<f64, Refused> {
        match light.and_then(|l| l.get(k)) {
            None => Ok(default),
            Some(v) => num(Some(v))
                .filter(|x| (0.0..=1.0).contains(x))
                .ok_or(Refused {
                    code: "out_of_range",
                    path: format!("{path}/light/{k}"),
                }),
        }
    };
    let near_fade = match params.get("near_fade") {
        None => radius,
        Some(Value::String(s)) if s == "auto" => radius,
        Some(v) => num(Some(v)).filter(|x| *x >= 0.0).ok_or(Refused {
            code: "out_of_range",
            path: format!("{path}/near_fade"),
        })?,
    };
    Ok(Puff {
        id: id.to_string(),
        pos,
        radius,
        aspect: field("aspect", 1.6, |a| a > 0.0)?,
        density: field("density", 0.5, |d| (0.0..=1.0).contains(&d))?,
        bright: field("bright", 1.0, |b| b >= 0.0)?,
        seed: params.get("seed").and_then(Value::as_u64).unwrap_or(0) as u32,
        sun: on("sun", "key")?,
        ambient: on("ambient", "sky")?,
        phase: lf("phase", 0.5)?,
        shade: lf("shade", 0.6)?,
        near_fade,
    })
}

/// An `overlay.frame@1`: its frame's shapes, placed at its anchor's projection plus its offset.
fn overlay(
    items: &Items<'_>,
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
    let mut children: Vec<(&str, &String)> = items
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
                let pts: Vec<[f64; 2]> = s.points().into_iter().filter_map(proj).collect();
                if let Some(b) = boxed(&pts) {
                    out.push((s.id.clone(), b));
                }
            }
            for l in &layer.lines {
                let mut pts = Vec::new();
                for seg in l.segments.iter().filter(|s| !s.hidden) {
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

#[cfg(test)]
mod stroke_tests {
    use super::*;

    fn doc(modifiers: Value) -> Value {
        serde_json::json!({
            "format": 1, "size": [320, 240], "camera": "cam",
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "order": "a0",
                        "params": {"projection": "perspective", "position": [0, 0, 5], "target": [0, 0, 0], "fov": 40}},
                "l": {"id": "l", "kind": "mark.line@1", "order": "a1",
                      "params": {"points": [[0, 0, 0], [2, 0, 0]], "width": 2, "paint": {"fill": {"role": "ink"}}},
                      "modifiers": modifiers}
            }
        })
    }

    fn lines(modifiers: Value, t: i64) -> Vec<Line> {
        let look = crate::look::Look3::from_roles(
            [
                ("ink".to_string(), [0, 0, 0]),
                ("ground".to_string(), [255, 255, 255]),
            ]
            .into_iter()
            .collect(),
        );
        let mut labels = Labels::new();
        let scene = evaluate(&doc(modifiers), t, &look, &mut labels).unwrap();
        scene.layers.into_iter().flat_map(|l| l.lines).collect()
    }

    #[test]
    fn dash_cuts_a_two_metre_stroke_into_its_dashes() {
        let ls = lines(
            serde_json::json!([{"kind": "mod.dash@1", "params": {"dash": 0.3, "gap": 0.2}}]),
            0,
        );
        assert_eq!(ls.len(), 1);
        // 0–0.3, 0.5–0.8, 1.0–1.3, 1.5–1.8.
        assert_eq!(ls[0].segments.len(), 4);
        assert!((stroke_length(&ls[0].segments) - 1.2).abs() < 1e-9);
    }

    #[test]
    fn outline_draws_a_wider_line_under_it() {
        let ls = lines(
            serde_json::json!([{"kind": "mod.outline@1", "params": {"width": 1}}]),
            0,
        );
        assert_eq!(ls.len(), 2);
        assert_eq!(ls[0].segments[0].wa, 4.0);
        assert_eq!(ls[1].segments[0].wa, 2.0);
    }

    #[test]
    fn boil_steps_at_its_rate_and_while_drawing_waits_for_a_build() {
        let fl = deep_canvas::camera::FLICKS_PER_SECOND;
        let boil = serde_json::json!([{"kind": "mod.boil@1", "params": {"amount": 0.05, "hz": 2}}]);
        let at = |t: i64| lines(boil.clone(), t)[0].segments[0].a;
        assert_eq!(at(fl / 10), at(fl / 5), "one step holds for half a second");
        assert_ne!(at(fl / 10), at(fl), "the next step draws again");
        let waiting = serde_json::json!([
            {"kind": "mod.build@1", "params": {"to": 1}},
            {"kind": "mod.boil@1", "while": "drawing", "params": {"amount": 0.05, "hz": 2}}
        ]);
        assert_eq!(lines(waiting, fl / 10)[0].segments[0].a, [0.0, 0.0, 0.0]);
        let mid = serde_json::json!([
            {"kind": "mod.build@1", "params": {"to": 0.5}},
            {"kind": "mod.boil@1", "while": "drawing", "params": {"amount": 0.05, "hz": 2}}
        ]);
        let ls = lines(mid, fl / 10);
        assert_ne!(ls[0].segments[0].a, [0.0, 0.0, 0.0]);
        assert!(stroke_length(&ls[0].segments) < 1.2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// #2013's garden: the vase rests on the table's top, the scatter keeps its distance and its
    /// margin and stays off the table, no two elements' bounds pass into each other, and the
    /// same garden with its items listed the other way round scatters the same.
    #[test]
    fn the_scattered_garden_rests_its_vase_and_prunes_its_shrubs() {
        let doc = crate::module::garden();
        let placed = placed_at(&doc, 0).unwrap();
        let vase = placed.iter().find(|(id, _, _)| id == "vase").unwrap();
        assert!(
            (vase.2[1][3] - 0.75).abs() < 1e-8 && vase.2[0][3] == 0.2,
            "{:?}",
            vase.2
        );
        let rows = elements_at(&doc, 0, "shrubs", None).unwrap().unwrap();
        assert!(rows.len() > 40, "{}", rows.len());
        // An element's bounds on the ground: its prototype's square, turned by its yaw.
        let half = |r: &crate::distribute::Row| {
            let (c, s) = (cos(rad(r.yaw)).abs(), sin(rad(r.yaw)).abs());
            (if r.proto == 0 { 0.45 } else { 0.1 }) * (c + s)
        };
        assert!(rows.iter().any(|r| r.proto == 0) && rows.iter().any(|r| r.proto == 1));
        for (i, a) in rows.iter().enumerate() {
            assert!(
                a.pos[0].abs() <= 4.5 && a.pos[2].abs() <= 4.5 && a.pos[1] == 0.0,
                "{:?}",
                a.pos
            );
            assert!(
                a.pos[0].abs() > 0.6 || a.pos[2].abs() > 0.4,
                "in the table: {:?}",
                a.pos
            );
            for b in &rows[i + 1..] {
                let d = [(a.pos[0] - b.pos[0]).abs(), (a.pos[2] - b.pos[2]).abs()];
                assert!(d[0] * d[0] + d[1] * d[1] >= 0.25);
                let clear = half(a) + half(b) - 1e-9;
                assert!(
                    d[0] >= clear || d[1] >= clear,
                    "{} and {} pass into each other",
                    a.id,
                    b.id
                );
            }
        }
        let mut reversed = doc.clone();
        let items: Vec<(String, Value)> = doc["items"]
            .as_object()
            .unwrap()
            .iter()
            .rev()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        reversed["items"] = Value::Object(items.into_iter().collect());
        assert_eq!(
            elements_at(&reversed, 0, "shrubs", None).unwrap().unwrap(),
            rows
        );
        // A rest with nothing under it reports no support and leaves its owner where it was.
        let mut lost = doc.clone();
        lost["items"]["vase"]["at"]["pos"] = serde_json::json!([4.0, 2.0, 4.0]);
        let (rested, problems) = rested_at(&lost, 0, Rests::All).unwrap();
        assert!(rested.is_empty());
        assert_eq!(
            problems,
            vec![Refused {
                code: "no_support",
                path: "constraints/rest".into()
            }]
        );
        // On a collection it rests on the first surface of any member; on the ground, on y 0.
        lost["collections"] = serde_json::json!({"floor": {"members": ["ground", "table"]}});
        lost["constraints"]["rest"]["on"] = serde_json::json!("floor");
        assert_eq!(
            rested_at(&lost, 0, Rests::All).unwrap().0["vase"].0,
            [4.0, 0.0, 4.0]
        );
        lost["constraints"]["rest"]["on"] = serde_json::json!("ground");
        lost["constraints"]["rest"]["offset"] = serde_json::json!(0.25);
        assert_eq!(
            rested_at(&lost, 0, Rests::All).unwrap().0["vase"].0,
            [4.0, 0.25, 4.0]
        );
        // In an assembly turned a quarter about +Z (#504), down is the owner's own −x: a box
        // written at the world's (0.2, 2, 0.1) rests on the table's top, 0.1 m under its centre.
        let mut turned = doc.clone();
        turned["assemblies"] = serde_json::json!({"tray": {"at": {"rot": [0, 0, 90]}}});
        turned["items"]["vase"] = serde_json::json!({"id": "vase", "kind": "mark.box@1", "name": "Vase", "order": "a3",
            "parent": "tray", "params": {"size": [0.2, 0.3, 0.2]}, "at": {"pos": [2.0, -0.2, 0.1]}});
        let at = rested_at(&turned, 0, Rests::All).unwrap().0["vase"].0;
        assert!(
            (at[0] - 0.85).abs() < 1e-6 && (at[1] + 0.2).abs() < 1e-6 && (at[2] - 0.1).abs() < 1e-6,
            "{at:?}"
        );
        // A channel on the owner's position is refused as a second writer, naming both.
        lost["channels"] = serde_json::json!({"lift": {"target": "items/vase/at/pos/1", "type": "f32",
            "keys": {"k0": {"t": "0s", "value": 2, "interp": "linear"}, "k1": {"t": "1s", "value": 3, "interp": "linear"}}}});
        let refusal = rested_at(&lost, 0, Rests::All).unwrap_err();
        assert_eq!(
            (refusal.code, refusal.path.as_str()),
            ("second_writer", "channels/lift and constraints/rest")
        );
    }
    use serde_json::json;

    /// #1653: a 2D paint's bevel or shade on a 3D item is refused, naming the field; the
    /// builders' own `bevel` and `shade` params are not paint and draw.
    #[test]
    fn a_bevel_or_a_shade_on_a_3d_item_is_refused() {
        let look = Look3::read(&json!({"roles": {"block": "#808080", "ground": "#ffffff"}}))
            .expect("the look reads");
        let doc = |paint: Value| {
            json!({
                "format": 1, "profile": "scene", "title": "T", "description": "D", "size": [64, 64],
                "camera": "cam", "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
                "items": {
                    "cam": {"id": "cam", "kind": "camera@1", "layer": "main", "name": "C", "order": "a0",
                        "params": {"projection": "perspective", "target": [0, 0, 0], "position": [0, 0, 20], "fov": 40}},
                    "b": {"id": "b", "kind": "mark.box@1", "layer": "main", "name": "B", "order": "a1",
                        "params": {"size": [1, 1, 1], "paint": paint}},
                }
            })
        };
        let fill = json!({"role": "block"});
        for field in ["bevel", "shade"] {
            let mut paint = json!({"fill": fill});
            paint[field] = json!({"size": 4});
            let refused = evaluate(&doc(paint), 0, &look, &mut Labels::new()).expect_err("refused");
            assert_eq!(
                (refused.code, refused.path.as_str()),
                (
                    "paint_2d_only",
                    format!("items/b/params/paint/{field}").as_str()
                )
            );
        }
        assert!(evaluate(&doc(json!({"fill": fill})), 0, &look, &mut Labels::new()).is_ok());
    }

    #[test]
    fn a_child_box_rides_its_parent_once() {
        let look = Look3::read(&json!({"roles": {"block": "#808080", "ground": "#ffffff"}}))
            .expect("the look reads");
        let solid = |id: &str, pos: [f64; 3]| {
            json!({"id": id, "kind": "mark.box@1", "layer": "main", "name": id, "order": "a1",
                "params": {"size": [1, 1, 1], "paint": {"fill": {"role": "block"}}}, "at": {"pos": pos}})
        };
        let mut child = solid("child", [1.0, 0.0, 0.0]);
        child["parent"] = json!("parent");
        let doc = json!({
            "format": 1, "profile": "scene", "title": "T", "description": "D", "size": [64, 64],
            "camera": "cam", "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
            "items": {
                "cam": {"id": "cam", "kind": "camera@1", "layer": "main", "name": "C", "order": "a0",
                    "params": {"projection": "perspective", "target": [0, 0, 0], "position": [0, 0, 20], "fov": 40}},
                "parent": solid("parent", [5.0, 0.0, 0.0]),
                "child": child,
            }
        });
        let child_at = |doc: &Value| {
            let scene = evaluate(doc, 0, &look, &mut Labels::new()).expect("the scene evaluates");
            let placed = scene
                .layers
                .iter()
                .flat_map(|l| &l.solids)
                .find(|s| s.id == "child")
                .expect("the child is drawn")
                .model;
            origin(&placed)
        };
        // Adding the parent twice puts the child at x = 11.
        assert_eq!(child_at(&doc), [6.0, 0.0, 0.0]);
        // A parent turned a quarter about y carries the child's offset round with it, in 3D:
        // the child is 1 m from the parent along z, not along x as a turn about z alone leaves it.
        let mut turned = doc.clone();
        turned["items"]["parent"]["at"]["rot"] = json!([0, 90, 0]);
        let [x, y, z] = child_at(&turned);
        assert!(
            (x - 5.0).abs() < 1e-9 && y.abs() < 1e-9 && (z.abs() - 1.0).abs() < 1e-9,
            "the child at {:?}",
            [x, y, z]
        );
    }
}
