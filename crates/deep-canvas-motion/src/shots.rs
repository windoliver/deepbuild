//! Shots (issue #493; canvas primitives: Shot, Camera `camera@1` and its framing, Transition,
//! Transport's reduced motion). A shot writes its camera's pose over `[start, end)`: one framed
//! pose, solved once at check from an explicit pose or from its kept items' bounds over the whole
//! span, and a move with a closed form that lands on or passes through it. The pose at t is a pure
//! function of t, so seeking equals playing at any frame rate: shake and kick read lattice noise
//! of t, never of a frame, and follow-forward is baked at check.
//!
//! The camera is the core's (`deep_canvas::camera`): a pose here is the core's pose, read back
//! through its projector, so a 2D film's pushes and pans need no scene3d.

use deep_canvas::camera::{
    add, deg, dot, length, orbit_direction, rad, scale, screen_basis, sub, Offsets,
    Pose as CorePose, Projector, Spec, Vec3,
};
use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas::interval::{down, up, Iv};
use deep_canvas::ops::{asin, atan, atan2, cos, exp, log, sin, sqrt, tan, PI};
use deep_canvas::schedule::core_ops::Datum;
use serde_json::{json, Map, Value};

use crate::curve::Ease;
use crate::doc::{Ctx, Refused};
use crate::eval::Validity;
use crate::program::{Planted, Program, State, TRANSFORM};

const F: f64 = FLICKS_PER_SECOND as f64;

fn refused<T>(code: &'static str, path: impl Into<String>, detail: Value) -> Result<T, Refused> {
    Err(Refused {
        code,
        path: path.into(),
        detail: (!detail.is_null()).then(|| Box::new(detail)),
    })
}

fn bad<T>(path: impl Into<String>) -> Result<T, Refused> {
    refused("bad_doc", path, Value::Null)
}

/// A camera's pose: where its eye is and what it looks at, its field of view (0 in an
/// orthographic view) or view width, and its roll.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pose {
    pub position: Vec3,
    pub target: Vec3,
    pub fov: f64,
    pub view_width: f64,
    pub roll: f64,
    pub flat: bool,
}

impl Pose {
    pub fn perspective(&self) -> bool {
        !self.flat && self.fov > 0.0
    }

    pub fn distance(&self) -> f64 {
        if self.flat {
            0.0
        } else {
            length(sub(self.position, self.target))
        }
    }

    /// The view's width through the target.
    pub fn width(&self) -> f64 {
        if self.perspective() {
            2.0 * self.distance() * tan(rad(self.fov) / 2.0)
        } else {
            self.view_width
        }
    }

    /// The eye's azimuth and elevation about the target, degrees (camera@1's convention).
    fn angles(&self) -> (f64, f64) {
        if self.flat {
            return (0.0, 0.0);
        }
        let d = sub(self.position, self.target);
        let n = length(d);
        (
            deg(atan2(d[0], d[2])),
            deg(asin((d[1] / n).clamp(-1.0, 1.0))),
        )
    }

    /// The core's pose, which its projector reads.
    pub fn core(&self) -> CorePose {
        let (azimuth, elevation) = self.angles();
        CorePose {
            position: self.position,
            target: self.target,
            azimuth,
            elevation,
            distance: self.distance(),
            fov: if self.perspective() { self.fov } else { 0.0 },
            view_width: self.width(),
            zoom: 1.0,
            roll: self.roll,
            flat: self.flat,
            shift: [0.0, 0.0],
        }
    }

    fn of_core(p: &CorePose) -> Pose {
        Pose {
            position: p.position,
            target: p.target,
            fov: p.fov,
            view_width: p.view_width,
            roll: p.roll,
            flat: p.flat,
        }
    }

    /// The pose as every surface reports it, with the shot that writes it.
    pub fn to_json(&self, shot: Option<&str>) -> Value {
        let c = self.core();
        json!({
            "position": c.position, "target": c.target, "azimuth": c.azimuth,
            "elevation": c.elevation, "distance": c.distance, "fov": c.fov,
            "view_width": c.view_width, "zoom": 1.0, "roll": self.roll, "shot": shot,
        })
    }

    /// The projector of this pose on a frame of `size` px.
    pub fn projector(&self, size: [f64; 2]) -> Projector {
        Projector::new(&self.core(), size, size)
    }

    fn with_distance(&self, d: f64) -> Pose {
        if !self.perspective() {
            return *self;
        }
        let dir = scale(sub(self.position, self.target), 1.0 / self.distance());
        Pose {
            position: add(self.target, scale(dir, d)),
            ..*self
        }
    }

    /// The width scaled by `k`: the distance in perspective, the view width otherwise.
    fn widened(&self, k: f64) -> Pose {
        if self.perspective() {
            self.with_distance(self.distance() * k)
        } else {
            Pose {
                view_width: self.view_width * k,
                ..*self
            }
        }
    }
}

/// An aim's heading (0 down −Z, positive turning right) and pitch (positive up), degrees.
fn yaw_pitch(aim: Vec3) -> (f64, f64) {
    let n = length(aim);
    (
        deg(atan2(aim[0], -aim[2])),
        deg(asin((aim[1] / n).clamp(-1.0, 1.0))),
    )
}

fn aim_of(yaw: f64, pitch: f64) -> Vec3 {
    let (y, p) = (rad(yaw), rad(pitch));
    [cos(p) * sin(y), sin(p), -cos(p) * cos(y)]
}

/// The pose turned about its eye to `yaw` and `pitch`, degrees.
fn aimed(p: &Pose, yaw: f64, pitch: f64) -> Pose {
    let d = p.distance();
    Pose {
        target: add(p.position, scale(aim_of(yaw, pitch), d)),
        ..*p
    }
}

/// The pose turned about its eye by `by` degrees times the length of `(ex, ey)` (inside the unit
/// disc), toward screen right and up: the angle between the two aims is exactly that.
fn tilted(p: &Pose, ex: f64, ey: f64, by: f64) -> Pose {
    let m = sqrt(ex * ex + ey * ey);
    if p.flat || m == 0.0 {
        return *p;
    }
    let d = p.distance();
    let f = scale(sub(p.target, p.position), 1.0 / d);
    let (right, upward) = screen_basis(f);
    let e = add(scale(right, ex / m), scale(upward, ey / m));
    let th = rad(by * m);
    let aim = add(scale(f, cos(th)), scale(e, sin(th)));
    Pose {
        target: add(p.position, scale(aim, d)),
        ..*p
    }
}

/// Mixes two poses by `w`: positions and targets in a line, roll the shortest way, field of view
/// and view width in log space.
fn mixed(a: &Pose, b: &Pose, w: f64) -> Pose {
    let lerp = |x: f64, y: f64| x + (y - x) * w;
    let line = |x: Vec3, y: Vec3| [lerp(x[0], y[0]), lerp(x[1], y[1]), lerp(x[2], y[2])];
    let logs = |x: f64, y: f64| {
        if x > 0.0 && y > 0.0 {
            exp(lerp(log(x), log(y)))
        } else {
            lerp(x, y)
        }
    };
    let turn = wrap(b.roll - a.roll);
    Pose {
        position: line(a.position, b.position),
        target: line(a.target, b.target),
        fov: logs(a.fov, b.fov),
        view_width: logs(a.view_width, b.view_width),
        roll: a.roll + turn * w,
        flat: b.flat,
    }
}

/// #504: a glide into `pose` from `before` over `[start, start + g)` by `ease` (Shot: `join:
/// glide`), for a timeline shot's first span and a stage's shot alike: [`mixed`] by the eased
/// share, `before` itself at `start` and `pose` from `start + g` on. Under reduced motion
/// (`reduced`), a cut at the glide's midpoint with a 200 ms dissolve (Transport). Answers the
/// pose, the dissolve inside its window, and whether the glide moves the camera.
pub fn joined(
    before: &Pose,
    pose: &Pose,
    start: i64,
    g: i64,
    ease: Ease,
    t: i64,
    reduced: bool,
) -> (Pose, Option<(f64, Pose, Pose)>, bool) {
    if g <= 0 || t < start || t >= start + g {
        return (*pose, None, false);
    }
    if reduced {
        let mid = start + g / 2;
        let dissolve = ((t - mid).abs() < DISSOLVE / 2).then(|| {
            (
                (t - (mid - DISSOLVE / 2)) as f64 / DISSOLVE as f64,
                *before,
                *pose,
            )
        });
        return (if t < mid { *before } else { *pose }, dissolve, false);
    }
    (
        mixed(before, pose, ease.at((t - start) as f64 / g as f64)),
        None,
        true,
    )
}

/// An angle in (−180, 180].
fn wrap(d: f64) -> f64 {
    let w = d.rem_euclid(360.0);
    if w > 180.0 {
        w - 360.0
    } else {
        w
    }
}

/// A seeded hash of a lattice point, in [−1, 1].
fn lattice(seed: u64, i: i64) -> f64 {
    let mut z = seed ^ (i as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 52) as f64 - 1.0
}

/// Lattice noise of `x`, seeded: smooth between hashed lattice points, in [−1, 1].
fn noise(seed: u64, x: f64) -> f64 {
    let i = x.floor();
    let f = x - i;
    let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    let (a, b) = (lattice(seed, i as i64), lattice(seed, i as i64 + 1));
    a + (b - a) * w
}

fn fnv(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100_0000_01b3)
    })
}

/// The shot moves (Shot).
#[derive(Clone, Debug, PartialEq)]
pub enum Move {
    Hold,
    Push,
    Pull,
    Pan,
    Orbit,
    Slam,
    Shake,
    LogZoom,
    LensZoom,
    /// Tracks item `.0` (an index in the program's items) and never moves back.
    FollowForward(usize),
}

impl Move {
    fn animates(&self) -> bool {
        !matches!(self, Move::Hold | Move::Shake)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shake {
    pub by: f64,
    pub hz: f64,
    pub roll: f64,
}

/// A shot's framing (Shot `frame`, Camera `camera@1`: framing).
#[derive(Clone, Debug, PartialEq)]
pub struct Framing {
    pub keep: Vec<String>,
    pub pad: f64,
    pub place: [f64; 2],
    pub fill: f64,
}

/// A shot, compiled at check.
#[derive(Clone, Debug, PartialEq)]
pub struct Shot {
    pub id: String,
    /// Its camera, an index in [`Plan::cameras`].
    pub camera: usize,
    pub start: i64,
    pub end: i64,
    pub moves: Move,
    pub ease: Ease,
    pub by: f64,
    pub angle: f64,
    /// Its one framed pose.
    pub framed: Pose,
    /// Where a log zoom starts.
    pub from: Option<Pose>,
    /// The glide's span, when it glides in.
    pub glide: Option<i64>,
    pub keyed: bool,
    pub essential: bool,
    pub shake: Option<Shake>,
    pub look: Option<String>,
    /// #462: its look regions, each a world-space mask drawn in a look of its own.
    pub regions: Vec<Region>,
    /// The kept items' union over the span the framing fit, `[lo, hi]`.
    pub union: Option<[Vec3; 2]>,
    /// Follow-forward's baked target x, a sample every [`FOLLOW_STEP`] from the start.
    pub follow: Option<Vec<f64>>,
}

const FOLLOW_STEP: i64 = FLICKS_PER_SECOND / 240;

/// How a region's edge passes from the outer look to the region's (Look `look@1`: regions and
/// edges).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edge {
    Straight,
    Torn,
    Pixel,
    Brush,
}

impl Edge {
    /// The edge a name gives: `straight`, `torn`, `pixel` or `brush`.
    pub fn named(name: &str) -> Option<Edge> {
        Some(match name {
            "straight" => Edge::Straight,
            "torn" => Edge::Torn,
            "pixel" => Edge::Pixel,
            "brush" => Edge::Brush,
            _ => return None,
        })
    }
}

/// A look region (#462): what the item `mask` holds, at its evaluated pose, draws in `look`, the
/// edge `edge` (`None`: the incoming look's own) `width` px wide, seeded from `seed`.
#[derive(Clone, Debug, PartialEq)]
pub struct Region {
    pub mask: String,
    pub look: String,
    pub edge: Option<Edge>,
    pub width: f64,
    pub seed: u64,
}

fn regions_of(s: &Map<String, Value>, path: &str) -> Result<Vec<Region>, Refused> {
    let mut out = Vec::new();
    for (k, r) in s
        .get("regions")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
    {
        let at = format!("{path}/regions/{k}");
        let Some(r) = r.as_object() else {
            return bad(at);
        };
        let text = |f: &str| r.get(f).and_then(Value::as_str).map(str::to_string);
        let (Some(mask), Some(look)) = (text("mask"), text("look")) else {
            return bad(at);
        };
        let edge = match r.get("edge").and_then(Value::as_str) {
            None => None,
            Some(e) => match Edge::named(e) {
                Some(e) => Some(e),
                None => return bad(format!("{at}/edge")),
            },
        };
        let width = num(r.get("width"), &format!("{at}/width"))?.unwrap_or(16.0);
        if width < 0.0 {
            return bad(format!("{at}/width"));
        }
        out.push(Region {
            mask,
            look,
            edge,
            width,
            seed: r.get("seed").and_then(Value::as_u64).unwrap_or(0),
        });
    }
    Ok(out)
}

mod kinds;
pub use kinds::{
    placed, reveal_offset, Align, Center, Dip, Iris, IrisAt, Operator, Radius, Under,
    READS as OPERATOR_READS,
};

/// The transition kinds (Transition); whip is #493's, operator, iris and the dip's fields #466's.
#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Cut,
    CrossFade,
    Dip(Dip),
    Iris(Iris),
    Operator(Operator),
    Wipe { angle: f64, feather: f64 },
    Push { angle: f64 },
    ZoomThrough { center: [f64; 2] },
    Whip { angle: f64, sweep: f64 },
    Other(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Transition {
    pub id: String,
    /// The two shots, indices in [`Plan::shots`].
    pub from: usize,
    pub to: usize,
    pub kind: Kind,
    /// The cut, where the outgoing shot ends and the incoming one starts.
    pub cut: i64,
    /// The window, placed on the cut by `align`.
    pub start: i64,
    pub end: i64,
    pub ease: Ease,
    /// Where the window sits on the cut.
    pub align: Align,
}

impl Transition {
    /// The transition's progress at t, 0 to 1 over its window.
    pub fn progress(&self, t: i64) -> f64 {
        if self.end <= self.start {
            return if t < self.cut { 0.0 } else { 1.0 };
        }
        self.ease
            .at((t - self.start) as f64 / (self.end - self.start) as f64)
    }
}

/// A kick on a camera: at each of its times, an offset that falls off over `s`.
#[derive(Clone, Debug, PartialEq)]
pub struct Kick {
    pub at: i64,
    pub by: f64,
    pub s: i64,
    pub hz: f64,
    /// Its index among the camera's kicks, seeding its noise.
    pub index: u64,
}

/// A `camera@1` item: its own params and pose, and its kicks.
#[derive(Clone, Debug, PartialEq)]
pub struct Camera {
    pub id: String,
    pub params: Map<String, Value>,
    /// Its own pose, or `None` where its params aren't a pose this slice reads.
    pub own: Option<Pose>,
    pub kicks: Vec<Kick>,
    pub flat: bool,
    pub fit: Option<Framing>,
}

/// A document's shots, compiled at check.
#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    pub size: [f64; 2],
    pub safe: f64,
    pub frame_rate: (u32, u32),
    pub cameras: Vec<Camera>,
    /// In start order.
    pub shots: Vec<Shot>,
    pub transitions: Vec<Transition>,
    /// Transport `reduced_motion: slow` rather than hold.
    pub slow: bool,
    /// The envelope's camera, an index in `cameras`.
    pub doc_camera: Option<usize>,
    pub groups: Vec<Parallax>,
    /// #504: the shots stages name, in `Motion::shots` order, each with its framed pose (an
    /// explicit pose, or a fit of its kept items); `None` for one with a start of its own, a
    /// timeline's, or on a camera whose params aren't a pose.
    pub stage: Vec<Option<Shot>>,
    /// #504: each camera's stage shots from the input track, in time order (`Inputs::staged`).
    pub staged: Vec<Vec<crate::input::Staged>>,
}

/// What an evaluation of a pose reads besides t.
pub struct At<'a> {
    pub reduced: bool,
    pub planted: Planted,
    /// An indexed look's target width in pixels, which a kick rounds to.
    pub indexed: Option<f64>,
    /// A keyed shot's pose: its camera's own params as channels write them at t.
    pub keyed: &'a dyn Fn(usize) -> Option<Pose>,
}

/// What a camera shows at t.
#[derive(Clone, Debug, PartialEq)]
pub struct Shown {
    pub pose: Pose,
    pub shot: Option<usize>,
    /// #504: the stage shot that writes it, an index in [`Plan::stage`].
    pub stage: Option<usize>,
    /// Under reduced motion, a cut's dissolve: the incoming pose's share and the two poses.
    pub dissolve: Option<(f64, Pose, Pose)>,
    /// Inside a declared move: a shot's move or a whip.
    pub moving: bool,
}

const DISSOLVE: i64 = FLICKS_PER_SECOND / 5;

fn num(v: Option<&Value>, path: &str) -> Result<Option<f64>, Refused> {
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_f64().filter(|x| x.is_finite()) {
            Some(x) => Ok(Some(x)),
            None => bad(path),
        },
    }
}

fn vec3(v: &Value, path: &str) -> Result<Vec3, Refused> {
    match v.as_array().map(Vec::as_slice) {
        Some([a, b, c]) => match (a.as_f64(), b.as_f64(), c.as_f64()) {
            (Some(a), Some(b), Some(c)) => Ok([a, b, c]),
            _ => bad(path),
        },
        _ => bad(path),
    }
}

pub(crate) fn ease_named(v: Option<&Value>, path: &str) -> Result<Ease, Refused> {
    match v {
        None => Ok(Ease::InOutCubic),
        Some(Value::String(name)) => Ease::named(name).ok_or_else(|| Refused {
            code: "bad_interp",
            path: path.into(),
            detail: None,
        }),
        Some(other) => crate::doc::ease_of(other, path),
    }
}

fn place_of(v: Option<&Value>, default: [f64; 2], path: &str) -> Result<[f64; 2], Refused> {
    match v {
        None => Ok(default),
        Some(Value::String(s)) if s == "thirds_left" => Ok([1.0 / 3.0, 0.5]),
        Some(Value::String(s)) if s == "thirds_right" => Ok([2.0 / 3.0, 0.5]),
        Some(Value::Array(a)) if a.len() == 2 => match (a[0].as_f64(), a[1].as_f64()) {
            (Some(x), Some(y)) => Ok([x, y]),
            _ => bad(path),
        },
        Some(_) => bad(path),
    }
}

fn framing_of(
    v: &Map<String, Value>,
    base: Option<&Framing>,
    path: &str,
) -> Result<Framing, Refused> {
    let keep = match v.get("keep") {
        None => base.map(|b| b.keep.clone()).unwrap_or_default(),
        Some(Value::Array(list)) => list
            .iter()
            .map(|k| k.as_str().map(str::to_string).ok_or(()))
            .collect::<Result<_, _>>()
            .or_else(|()| bad(format!("{path}/keep")))?,
        Some(_) => return bad(format!("{path}/keep")),
    };
    Ok(Framing {
        keep,
        pad: num(v.get("pad"), &format!("{path}/pad"))?.unwrap_or(base.map_or(0.08, |b| b.pad)),
        place: place_of(
            v.get("place"),
            base.map_or([0.5, 0.5], |b| b.place),
            &format!("{path}/place"),
        )?,
        fill: num(v.get("fill"), &format!("{path}/fill"))?.unwrap_or(base.map_or(0.6, |b| b.fill)),
    })
}

/// An item's extent about its position: a box's, a cylinder's or a sphere's size (#504, read as
/// the geometry audit reads it), a rect's box, else a point.
fn extent(item: &Value) -> [Vec3; 2] {
    let params = item.get("params");
    match item.get("kind").and_then(Value::as_str) {
        Some("mark.box@1" | "mark.cylinder@1" | "mark.sphere@1") => {
            let half = match params.and_then(|p| p.get("size")) {
                Some(Value::Array(s)) if s.len() == 3 => {
                    [0, 1, 2].map(|k| s[k].as_f64().unwrap_or(0.0) / 2.0)
                }
                Some(v) => [v.as_f64().unwrap_or(0.0) / 2.0; 3],
                None => [0.5; 3],
            };
            [[-half[0], -half[1], -half[2]], half]
        }
        Some("rect@1") => match params.and_then(|p| p.get("box")).and_then(Value::as_array) {
            Some(b) if b.len() == 4 => {
                let v = |k: usize| b[k].as_f64().unwrap_or(0.0);
                [[v(0), v(1), 0.0], [v(0) + v(2), v(1) + v(3), 0.0]]
            }
            _ => [[0.0; 3]; 2],
        },
        _ => [[0.0; 3]; 2],
    }
}

/// The eight (or, flat, four) corners of `[lo, hi]`.
fn corners(b: &[Vec3; 2]) -> [Vec3; 8] {
    std::array::from_fn(|i| {
        [
            if i & 1 == 0 { b[0][0] } else { b[1][0] },
            if i & 2 == 0 { b[0][1] } else { b[1][1] },
            if i & 4 == 0 { b[0][2] } else { b[1][2] },
        ]
    })
}

/// An item's bounds through a projector: the projection of their centre and the box of their
/// corners, in px.
pub fn project(
    projector: &Projector,
    b: &[Vec3; 2],
    size: [f64; 2],
) -> Option<([f64; 2], [f64; 4])> {
    let c = through(projector, scale(add(b[0], b[1]), 0.5), size)?;
    let mut bx = [
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    ];
    for k in corners(b) {
        let p = through(projector, k, size)?;
        bx = [
            bx[0].min(p[0]),
            bx[1].min(p[1]),
            bx[2].max(p[0]),
            bx[3].max(p[1]),
        ];
    }
    Some((c, bx))
}

/// A point through the projector; behind a perspective eye, where a pinhole inverts it, so a
/// camera that passes a point still reports where its image went. None on the eye's plane.
fn through(projector: &Projector, p: Vec3, size: [f64; 2]) -> Option<[f64; 2]> {
    if let Some(q) = projector.project(p) {
        return Some([q.x, q.y]);
    }
    let v = projector.to_view(p);
    if v[2] >= 0.0 {
        return None;
    }
    let q = projector.project_view([v[0], v[1], -v[2]])?;
    Some([size[0] - q.x, size[1] - q.y])
}

/// What a shot's framing reads of the document: the frame and its safe area.
struct Frame {
    size: [f64; 2],
    safe: f64,
}

impl Frame {
    fn safe_frame(&self) -> [f64; 4] {
        [
            self.safe,
            self.safe,
            self.size[0] - self.safe,
            self.size[1] - self.safe,
        ]
    }

    fn place_px(&self, place: [f64; 2]) -> [f64; 2] {
        let s = self.safe_frame();
        [
            s[0] + place[0] * (s[2] - s[0]),
            s[1] + place[1] * (s[3] - s[1]),
        ]
    }
}

/// Fits `bounds` (widened by `pad`) on `frame` from the orientation of `base`: the distance or
/// view width that makes them span `fill` of the safe frame's shorter side, then the target that
/// puts their centre at `place` px, in closed form.
fn fit(
    base: &Pose,
    bounds: &[Vec3; 2],
    pad: f64,
    fill: f64,
    place_px: [f64; 2],
    frame: &Frame,
) -> Pose {
    let s = frame.safe_frame();
    let shorter = (s[2] - s[0]).min(s[3] - s[1]);
    let half = fill * shorter / 2.0;
    let ext = sub(bounds[1], bounds[0]);
    let lo = sub(bounds[0], scale(ext, pad));
    let hi = add(bounds[1], scale(ext, pad));
    let centre = scale(add(lo, hi), 0.5);
    let size = frame.size;
    // The wanted image offset from the frame's centre, before the roll turns it.
    let (ox, oy) = (place_px[0] - size[0] / 2.0, place_px[1] - size[1] / 2.0);
    let (cr, sr) = (cos(rad(base.roll)), sin(rad(base.roll)));
    let (x, y) = (ox * cr + oy * sr, -ox * sr + oy * cr);
    if base.flat {
        let (w, h) = (hi[0] - lo[0], hi[1] - lo[1]);
        let k = half * 2.0 / w.max(h).max(f64::MIN_POSITIVE);
        let target = [centre[0] - ox / k, centre[1] - oy / k, base.target[2]];
        return Pose {
            position: target,
            target,
            view_width: size[0] / k,
            ..*base
        };
    }
    let dir = scale(sub(base.position, base.target), 1.0 / base.distance());
    let (right, upward) = screen_basis(scale(dir, -1.0));
    let coords: Vec<(f64, f64, f64)> = corners(&[lo, hi])
        .iter()
        .map(|c| {
            let d = sub(*c, centre);
            (dot(d, right), dot(d, upward), dot(d, dir))
        })
        .collect();
    if base.perspective() {
        let focal = (size[0].max(size[1]) / 2.0) / tan(rad(base.fov) / 2.0);
        let d = coords
            .iter()
            .map(|(r, u, depth)| depth + sqrt(r * r + u * u) * focal / half)
            .fold(f64::MIN_POSITIVE, f64::max);
        let (a, b) = (-x * d / focal, y * d / focal);
        let target = add(centre, add(scale(right, a), scale(upward, b)));
        Pose {
            position: add(target, scale(dir, d)),
            target,
            ..*base
        }
    } else {
        let widest = coords
            .iter()
            .map(|(r, u, _)| sqrt(r * r + u * u))
            .fold(f64::MIN_POSITIVE, f64::max);
        let k = half / widest;
        let target = add(centre, add(scale(right, -x / k), scale(upward, y / k)));
        Pose {
            position: add(target, scale(dir, base.distance())),
            target,
            view_width: size[0] / k,
            ..*base
        }
    }
}

/// Frames `to`'s bounds so their projected centre lands on `centre` px and their projected box
/// is `height` px tall, from `base`'s orientation (a match cut).
fn matched(base: &Pose, to: &[Vec3; 2], centre: [f64; 2], height: f64, frame: &Frame) -> Pose {
    let mut pose = fit(base, to, 0.0, 0.6, centre, frame);
    for _ in 0..60 {
        let Some((_, b)) = project(&pose.projector(frame.size), to, frame.size) else {
            break;
        };
        let h = b[3] - b[1];
        if h.is_nan() || h <= 0.0 || (h / height - 1.0).abs() < 1e-12 {
            break;
        }
        let k = h / height;
        let widened = pose.widened(k);
        // Put the centre back on its pixel at the new distance.
        let c = scale(add(to[0], to[1]), 0.5);
        let at = |p: &Pose| p.projector(frame.size).project(c).map(|q| [q.x, q.y]);
        pose = match at(&widened) {
            Some(q) => shifted(&widened, [centre[0] - q[0], centre[1] - q[1]], frame),
            None => widened,
        };
    }
    pose
}

/// The pose moved in its view plane so the image moves by `d` px.
fn shifted(p: &Pose, d: [f64; 2], frame: &Frame) -> Pose {
    let (cr, sr) = (cos(rad(p.roll)), sin(rad(p.roll)));
    let (x, y) = (d[0] * cr + d[1] * sr, -d[0] * sr + d[1] * cr);
    if p.flat {
        let k = frame.size[0] / p.view_width;
        let target = [p.target[0] - d[0] / k, p.target[1] - d[1] / k, p.target[2]];
        return Pose {
            position: target,
            target,
            ..*p
        };
    }
    let fwd = scale(sub(p.target, p.position), 1.0 / p.distance());
    let (right, upward) = screen_basis(fwd);
    let k = if p.perspective() {
        (frame.size[0].max(frame.size[1]) / 2.0) / tan(rad(p.fov) / 2.0) / p.distance()
    } else {
        frame.size[0] / p.view_width
    };
    let v = add(scale(right, -x / k), scale(upward, y / k));
    Pose {
        position: add(p.position, v),
        target: add(p.target, v),
        ..*p
    }
}

/// A slot's bound over `[a, b]` flicks, settled by splitting the span until the bound is within
/// 1% of the largest extent a sampled time reaches (Camera `camera@1`: framing). `size` is the
/// item's own extent on that axis. A piece that can't be settled down to two flicks is refused,
/// naming its span.
fn settle(
    program: &Program,
    slot: usize,
    size: f64,
    a: i64,
    b: i64,
    frames: &[i64],
    sample: &mut dyn FnMut(i64) -> f64,
) -> Result<Iv, (i64, i64)> {
    let bound = |x: i64, y: i64| {
        let iv = Iv::new(down(x as f64 / F, 1), up(y as f64 / F, 1));
        program.slot_bound_over(slot, iv)
    };
    let Some(first) = bound(a, b) else {
        // No interval form writes it: a channel's keys, where its segments turn, and the span's
        // ends and frames.
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        let keys = program
            .slot_key_times(slot)
            .into_iter()
            .filter(|t| (a..=b).contains(t));
        for t in frames.iter().copied().chain([a, b]).chain(keys) {
            let v = sample(t);
            if v.is_finite() {
                lo = lo.min(v);
                hi = hi.max(v);
            }
        }
        return Ok(Iv::new(lo, hi));
    };
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    let seen = |v: f64, lo: &mut f64, hi: &mut f64| {
        if v.is_finite() {
            *lo = lo.min(v);
            *hi = hi.max(v);
        }
    };
    for &t in frames.iter().chain([a, b].iter()) {
        let v = sample(t);
        seen(v, &mut lo, &mut hi);
    }
    let mut pieces = vec![(a, b, first)];
    loop {
        let u = pieces.iter().fold(Iv::EMPTY, |u, p| u.hull(p.2));
        let ext = (hi - lo).max(0.0);
        if u.is_bounded()
            && u.hi - u.lo <= 1.01 * ext + 0.01 * size + 1e-12 * (1.0 + u.lo.abs().max(u.hi.abs()))
        {
            return Ok(u);
        }
        let excess = |p: &(i64, i64, Iv)| {
            if !p.2.is_bounded() {
                f64::INFINITY
            } else {
                (lo - p.2.lo).max(p.2.hi - hi).max(0.0)
            }
        };
        let (k, _) = pieces
            .iter()
            .enumerate()
            .fold((0, f64::NEG_INFINITY), |best, (k, p)| {
                let e = excess(p);
                if e > best.1 {
                    (k, e)
                } else {
                    best
                }
            });
        let (x, y, _) = pieces.swap_remove(k);
        if y - x < 2 || pieces.len() > 4096 {
            return Err((x, y));
        }
        let m = x + (y - x) / 2;
        seen(sample(m), &mut lo, &mut hi);
        for (p, q) in [(x, m), (m, y)] {
            match bound(p, q) {
                Some(iv) => pieces.push((p, q, iv)),
                None => return Err((p, q)),
            }
        }
    }
}

/// Every flick in `[a, b)` at `step`, from `a`.
fn grid(a: i64, b: i64, step: i64) -> Vec<i64> {
    let mut out = Vec::new();
    let mut t = a;
    while t < b {
        out.push(t);
        t += step.max(1);
    }
    out
}

/// The frames of the document's rate in `[a, b)`.
fn frames_in(a: i64, b: i64, rate: (u32, u32)) -> Vec<i64> {
    let (p, q) = (i128::from(rate.0), i128::from(rate.1));
    let fl = i128::from(FLICKS_PER_SECOND);
    let first =
        (i128::from(a) * p).div_euclid(fl * q) + i128::from(i128::from(a) * p % (fl * q) != 0);
    let mut out = Vec::new();
    let mut k = first;
    loop {
        let t = (k * fl * q / p) as i64;
        if t >= b {
            break;
        }
        out.push(t);
        k += 1;
    }
    out
}

/// The kept items' union over `[a, b)` (Camera `camera@1`: framing): each axis of each item's
/// position bounded by its writer's interval form, or, for a planted framer, by samples.
fn union_over(
    program: &Program,
    doc: &Map<String, Value>,
    keep: &[String],
    a: i64,
    b: i64,
    shot: &str,
) -> Result<[Vec3; 2], Refused> {
    let items = doc.get("items").and_then(Value::as_object);
    let frames = frames_in(a, b, program.motion.frame_rate);
    let planted = program.options.planted;
    let mut state = program.state();
    let mut out = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
    for id in keep {
        let Some(i) = program.items.iter().position(|x| x == id) else {
            return refused(
                "ref_unresolved",
                format!("shots/{shot}/frame/keep"),
                json!({"item": id, "shot": shot}),
            );
        };
        let e = extent(items.and_then(|m| m.get(id)).unwrap_or(&Value::Null));
        // #504: an assembly's part is bounded in the assembly's space, then widened by its reach.
        let member = program.member(id);
        let mut own = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
        for axis in 0..3 {
            let slot = i * TRANSFORM + axis;
            let mut sample = |t: i64| {
                match member {
                    Some(_) => program.evaluate_unassembled(t, &mut state),
                    None => program.evaluate(t, Validity::Full, &mut state),
                }
                state.slots[slot]
            };
            let iv = match planted {
                Planted::FramerSamples30Hz | Planted::FramerFitsSamples => {
                    let times = if planted == Planted::FramerSamples30Hz {
                        grid(a, b + 1, FLICKS_PER_SECOND / 30)
                    } else {
                        frames.clone()
                    };
                    let vs: Vec<f64> = times.iter().map(|&t| sample(t)).filter(|v| v.is_finite()).collect();
                    Iv::new(vs.iter().copied().fold(f64::INFINITY, f64::min), vs.iter().copied().fold(f64::NEG_INFINITY, f64::max))
                }
                _ => settle(program, slot, e[1][axis] - e[0][axis], a, b, &frames, &mut sample).or_else(|(x, y)| {
                    refused(
                        "framing_unsettled",
                        format!("shots/{shot}/frame/keep"),
                        json!({"item": id, "shot": shot, "span": [x, y],
                               "why": "the kept item's bound over this span never settles: its interval form is unbounded there"}),
                    )
                })?,
            };
            own[0][axis] = iv.lo + e[0][axis];
            own[1][axis] = iv.hi + e[1][axis];
        }
        if let Some(assembly) = member {
            // The span's start, where a planted framer reads each share.
            program.evaluate(a, Validity::Full, &mut state);
            own = reached(program, doc, assembly, own, &state).map_or_else(
                || {
                    refused(
                        "framing_unsettled",
                        format!("shots/{shot}/frame/keep"),
                        json!({"item": id, "shot": shot, "why": "the part's assembly has a value nothing bounds: give its motion a range"}),
                    )
                },
                Ok,
            )?;
        }
        for k in 0..3 {
            out[0][k] = out[0][k].min(own[0][k]);
            out[1][k] = out[1][k].max(own[1][k]);
        }
    }
    Ok(out)
}

/// #504: a box in assembly `a`'s space carried up its chain into the world, widened at each
/// assembly by its reach (Camera `camera@1`: framing): the hull of the box's corners through
/// the assembly's transform at its value's and share's ends (a turn sampled every 5° at most and
/// padded by the sagitta of a step), never by sampling time. The planted framer takes each
/// share as `state` holds it. `None` where an assembly's value has no bound.
fn reached(
    program: &Program,
    doc: &Map<String, Value>,
    a: usize,
    mut b: [Vec3; 2],
    state: &State,
) -> Option<[Vec3; 2]> {
    let mut at = Some(a);
    while let Some(i) = at {
        let x = &program.assemblies[i];
        let (mut value, mut share) = program.assembly_reach(doc, i)?;
        if program.options.planted == Planted::FramerIgnoresApart {
            (value, share) = (
                Iv::point(state.slots[x.slot]),
                Iv::point(state.slots[x.slot + 1]),
            );
        }
        let (values, pad) = match x.joint {
            Some(j) if j.kind == crate::assembly::Kind::Turn && value.hi > value.lo => {
                let n = ((value.hi - value.lo) / 5.0).ceil().max(1.0);
                let step = (value.hi - value.lo) / n;
                let r = corners(&b)
                    .iter()
                    .map(|c| length(sub(*c, j.pivot)))
                    .fold(0.0, f64::max);
                let stretch = (0..3)
                    .map(|k| length([x.at[0][k], x.at[1][k], x.at[2][k]]))
                    .fold(0.0, f64::max);
                let values: Vec<f64> = (0..=n as usize)
                    .map(|k| value.lo + step * k as f64)
                    .collect();
                (
                    values,
                    r * stretch * (1.0 - cos(rad(step) / 2.0)) * (1.0 + 1e-9) + 1e-12,
                )
            }
            _ => (vec![value.lo, value.hi], 0.0),
        };
        let mut out = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
        for v in values {
            for s in [share.lo, share.hi] {
                let m = x.local(v, s);
                for c in corners(&b) {
                    let p = crate::assembly::apply(&m, c);
                    for k in 0..3 {
                        out[0][k] = out[0][k].min(p[k] - pad);
                        out[1][k] = out[1][k].max(p[k] + pad);
                    }
                }
            }
        }
        b = out;
        at = x.parent;
    }
    Some(b)
}

/// The kept items' union at one time.
fn at_start(
    program: &Program,
    doc: &Map<String, Value>,
    keep: &[String],
    t: i64,
    shot: &str,
) -> Result<[Vec3; 2], Refused> {
    let mut state = program.state();
    program.evaluate(t, Validity::Full, &mut state);
    let mut out = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
    for id in keep {
        let Some(b) = bounds_at(program, doc, &state, id) else {
            return refused(
                "ref_unresolved",
                format!("shots/{shot}/frame/keep"),
                json!({"item": id, "shot": shot}),
            );
        };
        for k in 0..3 {
            out[0][k] = out[0][k].min(b[0][k]);
            out[1][k] = out[1][k].max(b[1][k]);
        }
    }
    Ok(out)
}

/// An item's bounds at the state's time.
pub fn bounds_at(
    program: &Program,
    doc: &Map<String, Value>,
    state: &State,
    id: &str,
) -> Option<[Vec3; 2]> {
    let i = program.items.iter().position(|x| x == id)?;
    let pos = [0, 1, 2].map(|k| state.slots[i * TRANSFORM + k]);
    let e = extent(doc.get("items")?.get(id)?);
    // #504: an assembly's part's extent turns with the assembly.
    if let Some(a) = program.member(id) {
        let m = program.assembly_world(&state.slots, a);
        let mut out = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
        for c in corners(&e) {
            let p = add(pos, crate::assembly::turn(&m, c));
            for k in 0..3 {
                out[0][k] = out[0][k].min(p[k]);
                out[1][k] = out[1][k].max(p[k]);
            }
        }
        return Some(out);
    }
    Some([add(pos, e[0]), add(pos, e[1])])
}

/// What each shot names, read before any pose is solved.
struct Raw<'a> {
    id: String,
    def: &'a Map<String, Value>,
    camera: usize,
    start: i64,
    end: i64,
}

fn time(v: Option<&Value>, ctx: &Ctx, path: &str) -> Result<i64, Refused> {
    crate::doc::time_of(v, ctx, path)
}

mod pose_fields;

impl Shot {
    /// The eased share of the move at t.
    fn u(&self, t: i64) -> (f64, f64) {
        let span = (self.end - self.start).max(1) as f64;
        let raw = ((t - self.start) as f64 / span).clamp(0.0, 1.0);
        (self.ease.at(raw), (t - self.start) as f64 / F)
    }

    fn at_u(&self, u: f64) -> (f64, f64) {
        (
            u,
            if u == 0.0 {
                0.0
            } else {
                (self.end - self.start) as f64 / F
            },
        )
    }

    /// The move's pose at eased share `u.0`, `u.1` seconds into the shot (Shot: each move's
    /// closed form).
    fn moved(&self, u: &(f64, f64), t: i64, planted: Planted) -> Pose {
        let (u, s) = *u;
        let f = &self.framed;
        match &self.moves {
            Move::Hold | Move::Shake => *f,
            Move::Push => f.widened(1.0 + self.by * (1.0 - u)),
            Move::Pull => f.widened(1.0 + self.by * u),
            Move::Slam => {
                let p = 1.0 - exp(-10.0 * s) * cos(2.0 * PI * 2.2 * s);
                f.widened(self.by + (1.0 - self.by) * p)
            }
            Move::Orbit => {
                let (az, el) = f.angles();
                let a = az - self.by / 2.0 + u * self.by;
                Pose {
                    position: add(f.target, scale(orbit_direction(a, el), f.distance())),
                    ..*f
                }
            }
            Move::Pan => {
                let angle = if planted == Planted::PanIgnoresAngle {
                    0.0
                } else {
                    self.angle
                };
                let (c, sn) = (cos(rad(angle)), sin(rad(angle)));
                if f.perspective() {
                    let (y0, p0) = yaw_pitch(sub(f.target, f.position));
                    let left = self.by * (1.0 - u);
                    aimed(f, y0 - left * c, p0 + left * sn)
                } else {
                    let left = self.by * (1.0 - u) * f.width();
                    let d = if f.flat {
                        [c, sn, 0.0]
                    } else {
                        let fwd = scale(sub(f.target, f.position), 1.0 / f.distance());
                        let (right, upward) = screen_basis(fwd);
                        add(scale(right, c), scale(upward, -sn))
                    };
                    let v = scale(d, -left);
                    Pose {
                        position: add(f.position, v),
                        target: add(f.target, v),
                        ..*f
                    }
                }
            }
            Move::LogZoom => {
                let from = self.from.unwrap_or(*f);
                let (w0, w1) = (from.width(), f.width());
                let w = if planted == Planted::LogZoomEasesWidth {
                    w0 + u * (w1 - w0)
                } else {
                    exp(log(w0) + u * (log(w1) - log(w0)))
                };
                f.widened(w / w1)
            }
            Move::LensZoom => {
                let tf = tan(rad(f.fov) / 2.0);
                let t0 = (1.0 + self.by) * tf;
                let tu = exp(log(t0) + u * (log(tf) - log(t0)));
                match planted {
                    Planted::LensZoomEasesFovDegrees => {
                        let f0 = deg(2.0 * atan(t0));
                        Pose {
                            fov: f0 + u * (f.fov - f0),
                            ..*f
                        }
                    }
                    Planted::LensZoomDollies => {
                        let f0 = deg(2.0 * atan(t0));
                        Pose {
                            fov: f0,
                            ..f.with_distance(f.distance() * tu / t0)
                        }
                    }
                    _ => Pose {
                        fov: deg(2.0 * atan(tu)),
                        ..*f
                    },
                }
            }
            Move::FollowForward(_) => {
                let xs = self.follow.as_deref().unwrap_or(&[]);
                let k = (t - self.start) as f64 / FOLLOW_STEP as f64;
                let i = (k.floor().max(0.0) as usize).min(xs.len().saturating_sub(1));
                let x = match (xs.get(i), xs.get(i + 1)) {
                    (Some(a), Some(b)) => a + (b - a) * (k - i as f64).clamp(0.0, 1.0),
                    (Some(a), None) => *a,
                    _ => f.target[0],
                };
                let dx = x - f.target[0];
                Pose {
                    position: [f.position[0] + dx, f.position[1], f.position[2]],
                    target: [x, f.target[1], f.target[2]],
                    ..*f
                }
            }
        }
    }
}

/// A parallax group (Frame and group: parallax), read at check.
#[derive(Clone, Debug, PartialEq)]
pub struct Parallax {
    pub id: String,
    pub rate: [f64; 2],
    pub drift: [f64; 2],
    pub origin: [f64; 2],
    pub repeat: [Option<f64>; 2],
}

fn parallax_of(id: &str, item: &Value) -> Option<Parallax> {
    if item.get("kind").and_then(Value::as_str) != Some("group@1") {
        return None;
    }
    let p = item.get("params")?.get("parallax")?.as_object()?;
    let pair = |name: &str, default: f64| -> [f64; 2] {
        match p.get(name).and_then(Value::as_array).map(Vec::as_slice) {
            Some([a, b]) => [a.as_f64().unwrap_or(default), b.as_f64().unwrap_or(default)],
            _ => [default; 2],
        }
    };
    let repeat = match p.get("repeat").and_then(Value::as_array).map(Vec::as_slice) {
        Some([a, b]) => [
            a.as_f64().filter(|w| *w > 0.0),
            b.as_f64().filter(|w| *w > 0.0),
        ],
        _ => [None, None],
    };
    Some(Parallax {
        id: id.to_string(),
        rate: pair("rate", 1.0),
        drift: pair("drift", 0.0),
        origin: pair("origin", 0.0),
        repeat,
    })
}

impl Plan {
    /// A parallax group's offset at t: its origin plus the document camera's position times
    /// (1 − rate) plus drift times t, wrapped by `repeat` with a floored modulo; reduced motion
    /// holds the drift at the transport's start. `None` for any other item.
    pub fn parallax(&self, program: &Program, id: &str, t: i64, reduced: bool) -> Option<[f64; 2]> {
        let g = self.groups.iter().find(|g| g.id == id)?;
        let cam = self.doc_camera?;
        let keyed = |_: usize| None;
        let at = At {
            reduced,
            planted: Planted::None,
            indexed: None,
            keyed: &keyed,
        };
        let eye = self.shown(cam, t, &at).pose.position;
        let secs = if reduced {
            program.motion.transport.start
        } else {
            t
        } as f64
            / F;
        let mut out = [0, 1].map(|k| g.origin[k] + eye[k] * (1.0 - g.rate[k]) + g.drift[k] * secs);
        for (o, w) in out.iter_mut().zip(g.repeat) {
            if let Some(w) = w {
                *o -= w * (*o / w).floor();
            }
        }
        Some(out)
    }
}

/// A 3D document with its envelope camera posed as its shots write it at t (Shot: a shot alone
/// writes its camera's pose), for the 3D frame and the checks that read it (#506); `None` when no timeline shot writes it.
/// Each timeline shot of the envelope camera, its span in flicks, as the compiled plan reads
/// them (the document's frame rate and tempo applied); `None` when the document doesn't compile
/// or names no envelope camera with shots (#506: what the framing check samples).
pub fn spans(doc: &Value) -> Option<Vec<(i64, i64)>> {
    let program = Program::compile(doc.as_object()?).ok()?;
    let plan = program.shots.as_deref()?;
    let cam = plan.camera(doc.get("camera")?.as_str()?)?;
    Some(
        plan.shots
            .iter()
            .filter(|s| s.camera == cam)
            .map(|s| (s.start, s.end))
            .collect(),
    )
}

pub fn posed(doc: &Value, t: i64) -> Option<Value> {
    let shots = doc.get("shots")?.as_object()?;
    // #504: a stage's shot poses the camera too: the default stage's from the start, and the one
    // an entry on the played form's track chooses from its entry.
    let staged = doc
        .get("controls")
        .and_then(Value::as_object)
        .is_some_and(|c| {
            c.values().any(|c| {
                c.get("stages")
                    .and_then(Value::as_object)
                    .is_some_and(|s| s.values().any(|s| s.get("shot").is_some()))
            })
        });
    if !shots.values().any(|s| s.get("start").is_some()) && !staged {
        return None;
    }
    let program = Program::compile(doc.as_object()?).ok()?;
    let plan = program.shots.as_deref()?;
    // #508: the shown shot's camera, the envelope's by default.
    let cam = plan.showing(doc, plan.camera(doc.get("camera")?.as_str()?)?, t);
    let id = plan.cameras[cam].id.as_str();
    let mut state = program.state();
    program.evaluate(t, Validity::Full, &mut state);
    let keyed = |c: usize| plan.keyed_pose(c, &program, &state);
    let pose = plan
        .shown(
            cam,
            t,
            &At {
                reduced: false,
                planted: Planted::None,
                indexed: None,
                keyed: &keyed,
            },
        )
        .pose;
    let mut out = doc.clone();
    out["camera"] = json!(id);
    let params = out
        .pointer_mut(&format!("/items/{id}/params"))?
        .as_object_mut()?;
    for k in ["orbit", "view_width", "kick"] {
        params.remove(k);
    }
    params.insert("position".into(), json!(pose.position));
    params.insert("target".into(), json!(pose.target));
    params.insert("roll".into(), json!(pose.roll));
    // #457: a lens gives its own field of view; the two together are refused.
    if pose.perspective() {
        if !params.contains_key("lens") {
            params.insert("fov".into(), json!(pose.fov));
        }
    } else {
        params.insert("view_width".into(), json!(pose.view_width));
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: i64 = FLICKS_PER_SECOND;

    /// A stages control whose stage `b`, entered at 2 s, names a shot on `second`.
    fn two_stages(second: &str) -> Value {
        let cam = |azimuth: f64| {
            json!({"kind": "camera@1", "params": {"projection": "perspective", "target": [0, 0, 0],
                "orbit": {"azimuth": azimuth, "elevation": 10, "distance": 10}, "fov": 40}})
        };
        json!({
            "transport": {"span": "6s"},
            "camera": "cam",
            "items": {"cam": cam(0.0), "side": cam(90.0)},
            "controls": {"steps": {"kind": "stages", "class": "document", "default": "a", "stages": {
                "a": {"label": "A", "shot": "a"}, "b": {"label": "B", "shot": "b"}}}},
            "shots": {
                "a": {"camera": "cam", "move": "hold", "join": "cut"},
                "b": {"camera": second, "move": "hold", "target": [1, 0, 0], "orbit": {"distance": 4}, "join": "cut"},
            },
            "track": [{"t": 2 * S, "control": "steps", "value": "b"}],
        })
    }

    /// The camera the posed document draws through, and whether its eye is `want` within 1e-9 m.
    fn eye(doc: &Value, want: Option<Vec3>) -> (String, bool) {
        let id = doc["camera"].as_str().unwrap().to_string();
        let eye = &doc["items"][&id]["params"]["position"];
        let at =
            want.is_some_and(|w| (0..3).all(|k| (eye[k].as_f64().unwrap() - w[k]).abs() < 1e-9));
        (id, at)
    }

    #[test]
    fn the_picture_follows_the_shown_shots_camera() {
        // b's pose: target [1, 0, 0] at distance 4 along the camera's own orbit direction.
        let b = |az: f64| Some(add([1.0, 0.0, 0.0], scale(orbit_direction(az, 10.0), 4.0)));
        let two = two_stages("side");
        let (before, _) = eye(&posed(&two, S).unwrap(), None);
        assert_eq!(before, "cam", "before b's entry the envelope camera shows");
        assert_eq!(
            eye(&posed(&two, 3 * S).unwrap(), b(90.0)),
            ("side".to_string(), true),
            "after b's entry the picture is drawn through b's camera, posed as b frames it"
        );
        // One camera: the envelope camera, posed by the stage shown, as before.
        let one = two_stages("cam");
        assert_eq!(
            eye(&posed(&one, 3 * S).unwrap(), b(0.0)),
            ("cam".to_string(), true)
        );
    }
}
