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
    /// The kept items' union over the span the framing fit, `[lo, hi]`.
    pub union: Option<[Vec3; 2]>,
    /// Follow-forward's baked target x, a sample every [`FOLLOW_STEP`] from the start.
    pub follow: Option<Vec<f64>>,
}

const FOLLOW_STEP: i64 = FLICKS_PER_SECOND / 240;

/// The transition kinds (Transition); whip is #493's.
#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    Cut,
    CrossFade,
    Dip,
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
    /// The window, centred on the cut.
    pub start: i64,
    pub end: i64,
    pub ease: Ease,
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
        Some(Value::String(name)) => Ease::NAMES
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, e)| *e)
            .ok_or_else(|| Refused {
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

/// The fields of a pose a channel may not write while an unkeyed shot holds its camera.
const POSE_FIELDS: [&str; 7] = [
    "target",
    "position",
    "orbit",
    "view_width",
    "roll",
    "fov",
    "zoom",
];

impl Plan {
    /// Compiles the document's shots and their transitions against its compiled program.
    pub fn compile(doc: &Map<String, Value>, program: &Program) -> Result<Option<Plan>, Refused> {
        let shots_json = doc.get("shots").and_then(Value::as_object);
        // Only shots with a start are a timeline's; a stage's shots are #417's.
        let timeline: Vec<(&String, &Map<String, Value>)> = shots_json
            .into_iter()
            .flatten()
            .filter_map(|(id, s)| {
                s.as_object()
                    .filter(|s| s.contains_key("start"))
                    .map(|s| (id, s))
            })
            .collect();
        let planted = program.options.planted;
        let rate = program.motion.frame_rate;
        let ctx = Ctx::timeline(doc, rate)?;
        let size = match doc.get("size").and_then(Value::as_array).map(Vec::as_slice) {
            Some([w, h]) => [w.as_f64().unwrap_or(1920.0), h.as_f64().unwrap_or(1080.0)],
            _ => [1920.0, 1080.0],
        };
        let safe = doc.get("safe").and_then(Value::as_f64).unwrap_or(24.0);
        let frame = Frame { size, safe };
        let mut cameras = Vec::new();
        for (id, item) in doc
            .get("items")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if item.get("kind").and_then(Value::as_str) != Some("camera@1") {
                continue;
            }
            let params = item
                .get("params")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let path = format!("items/{id}/params");
            let mut kicks = Vec::new();
            for (k, kick) in params
                .get("kick")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .enumerate()
            {
                let kp = format!("{path}/kick/{k}");
                let Some(kick) = kick.as_object() else {
                    return bad(kp);
                };
                let by = num(kick.get("by"), &format!("{kp}/by"))?.unwrap_or(2.0);
                let s = match kick.get("s") {
                    None => FLICKS_PER_SECOND * 18 / 100,
                    v => time(v, &ctx, &format!("{kp}/s"))?,
                };
                if s > FLICKS_PER_SECOND || s <= 0 {
                    return refused("out_of_range", format!("{kp}/s"), Value::Null);
                }
                let hz = num(kick.get("hz"), &format!("{kp}/hz"))?.unwrap_or(30.0);
                for at in kick
                    .get("at")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let at = time(Some(at), &ctx, &format!("{kp}/at"))?;
                    kicks.push(Kick {
                        at,
                        by,
                        s,
                        hz,
                        index: kicks.len() as u64,
                    });
                }
            }
            let fit = match params.get("fit").and_then(Value::as_object) {
                Some(f) => Some(framing_of(f, None, &format!("{path}/fit"))?),
                None => None,
            };
            let mut readable = params.clone();
            readable.remove("kick");
            let spec = Spec::read(
                &deep_canvas::kinds::with_defaults("camera@1", &readable),
                &path,
            );
            let own = spec.ok().and_then(|s| {
                s.rig(&path)
                    .ok()
                    .map(|r| Pose::of_core(&s.pose(&r, &Offsets::default())))
            });
            cameras.push(Camera {
                id: id.clone(),
                flat: own.is_some_and(|p| p.flat),
                params,
                own,
                kicks,
                fit,
            });
        }
        if cameras.is_empty() {
            return Ok(None);
        }
        // Read every shot's span and camera first: overlaps and transitions need them all.
        let mut raws: Vec<Raw> = Vec::new();
        for (id, s) in &timeline {
            let path = format!("shots/{id}");
            let camera_name = s
                .get("camera")
                .and_then(Value::as_str)
                .or(doc.get("camera").and_then(Value::as_str));
            let Some(camera) = cameras
                .iter()
                .position(|c| Some(c.id.as_str()) == camera_name)
            else {
                return refused(
                    "ref_unresolved",
                    format!("{path}/camera"),
                    json!({"shot": id}),
                );
            };
            let start = time(s.get("start"), &ctx, &format!("{path}/start"))?;
            let end = time(s.get("end"), &ctx, &format!("{path}/end"))?;
            if end <= start {
                return refused("bad_time", format!("{path}/end"), json!({"shot": id}));
            }
            raws.push(Raw {
                id: (*id).clone(),
                def: s,
                camera,
                start,
                end,
            });
        }
        raws.sort_by(|a, b| a.start.cmp(&b.start).then(a.id.cmp(&b.id)));
        // Transitions between shots.
        let mut trans_raw = Vec::new();
        for (id, tr) in doc
            .get("transitions")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let Some(tr) = tr.as_object() else { continue };
            let names = |f: &str| {
                tr.get(f)
                    .and_then(Value::as_str)
                    .and_then(|n| raws.iter().position(|r| r.id == n))
            };
            let (Some(from), Some(to)) = (names("from"), names("to")) else {
                continue;
            };
            trans_raw.push((id.clone(), tr, from, to));
        }
        // Two shots that overlap outside a transition joining them, on any camera (Shot). A
        // transition joins shots that meet at its cut, so any time two shots share lies outside it.
        for (i, a) in raws.iter().enumerate() {
            for b in &raws[i + 1..] {
                if a.start < b.end && b.start < a.end {
                    return refused(
                        "shot_overlap",
                        format!("shots/{}", b.id),
                        json!({"shots": [a.id, b.id], "why": "two shots overlap outside a transition that joins them"}),
                    );
                }
            }
        }
        // A channel or driver on a pose field of a camera an unkeyed shot holds (Shot).
        let writers = program
            .motion
            .channels
            .iter()
            .map(|c| ("channels", &c.id, &c.target))
            .chain(
                program
                    .motion
                    .drivers
                    .iter()
                    .map(|d| ("drivers", &d.id, &d.target)),
            );
        for (section, wid, target) in writers {
            let on_pose = target.field.len() >= 2
                && target.field[0] == "params"
                && POSE_FIELDS.contains(&target.field[1].as_str());
            if !on_pose {
                continue;
            }
            for r in &raws {
                let keyed = r.def.get("keyed").and_then(Value::as_bool).unwrap_or(false);
                if cameras[r.camera].id == target.owner && !keyed {
                    return refused(
                        "shot_pose_written",
                        format!("{section}/{wid}/target"),
                        json!({"channel": wid, "shot": r.id, "camera": target.owner,
                               "why": "while a shot is active it alone writes its camera's pose, unless it is keyed"}),
                    );
                }
            }
        }
        let mut shots: Vec<Shot> = Vec::new();
        for r in &raws {
            let shot = Plan::shot_of(doc, program, &cameras, r, &frame, planted)?;
            shots.push(shot);
        }
        let mut transitions = Vec::new();
        for (id, tr, from, to) in trans_raw {
            let path = format!("transitions/{id}");
            let cut = shots[from].end;
            if shots[to].start != cut {
                return refused("transition_gap", path, json!({"transition": id}));
            }
            let span = match tr.get("span") {
                None => 0,
                v => time(v, &ctx, &format!("{path}/span"))?,
            };
            let angle_of = |o: Option<&Value>, f: &str| {
                num(o.and_then(|o| o.get(f)), &format!("{path}/{f}")).map(|v| v.unwrap_or(0.0))
            };
            let kind_name = tr.get("kind").and_then(Value::as_str).unwrap_or("cut");
            let fields = tr.get(kind_name);
            let kind = match kind_name {
                "cut" => Kind::Cut,
                "cross_fade" => Kind::CrossFade,
                "dip" => Kind::Dip,
                "wipe" => Kind::Wipe {
                    angle: angle_of(fields, "angle")?,
                    feather: angle_of(fields, "feather")?,
                },
                "push" => Kind::Push {
                    angle: angle_of(fields, "angle")?,
                },
                "zoom_through" => {
                    let center = match fields.and_then(|f| f.get("center")) {
                        Some(Value::Array(c)) if c.len() == 2 => {
                            [c[0].as_f64().unwrap_or(0.5), c[1].as_f64().unwrap_or(0.5)]
                        }
                        _ => [0.5, 0.5],
                    };
                    Kind::ZoomThrough { center }
                }
                "whip" => Kind::Whip {
                    angle: angle_of(fields, "angle")?,
                    sweep: num(
                        fields.and_then(|f| f.get("sweep")),
                        &format!("{path}/whip/sweep"),
                    )?
                    .unwrap_or(26.0),
                },
                "iris" | "match_morph" | "text_diff" | "operator" => {
                    Kind::Other(kind_name.to_string())
                }
                _ => return refused("transition_kind", format!("{path}/kind"), Value::Null),
            };
            let (a, b) = (&shots[from], &shots[to]);
            if span > (a.end - a.start).min(b.end - b.start) {
                return refused(
                    "transition_span",
                    format!("{path}/span"),
                    json!({"transition": id}),
                );
            }
            let ease = match tr.get("progress") {
                None => Ease::InOutCubic,
                v => ease_named(v, &format!("{path}/progress"))?,
            };
            // A match cut frames the incoming shot so `to` lands where `from` was (Transition).
            if let (Kind::Cut, Some(m)) = (&kind, tr.get("match").and_then(Value::as_object)) {
                if planted != Planted::MatchFramerIgnoresMatch {
                    let (Some(fid), Some(tid)) = (
                        m.get("from").and_then(Value::as_str),
                        m.get("to").and_then(Value::as_str),
                    ) else {
                        return bad(format!("{path}/match"));
                    };
                    let step = FLICKS_PER_SECOND * i64::from(rate.1) / i64::from(rate.0.max(1));
                    let last = (cut - step).max(a.start);
                    let mut state = program.state();
                    program.evaluate(last, Validity::Full, &mut state);
                    let outgoing = shots[from].moved(&shots[from].u(last), last, planted);
                    let Some(fb) = bounds_at(program, doc, &state, fid) else {
                        return refused(
                            "ref_unresolved",
                            format!("{path}/match/from"),
                            json!({"transition": id}),
                        );
                    };
                    program.evaluate(cut, Validity::Full, &mut state);
                    let Some(tb) = bounds_at(program, doc, &state, tid) else {
                        return refused(
                            "ref_unresolved",
                            format!("{path}/match/to"),
                            json!({"transition": id}),
                        );
                    };
                    let Some((c, bx)) = project(&outgoing.projector(size), &fb, size) else {
                        return refused(
                            "match_unseen",
                            format!("{path}/match/from"),
                            json!({"transition": id}),
                        );
                    };
                    let incoming = &mut shots[to];
                    incoming.framed = matched(&incoming.framed, &tb, c, bx[3] - bx[1], &frame);
                }
            }
            let (start, end) = (cut - span / 2, cut + (span - span / 2));
            transitions.push(Transition {
                id,
                from,
                to,
                kind,
                cut,
                start,
                end,
                ease,
            });
        }
        // #504: each stage's shot, framed once (its kept items bounded over the document's span).
        let transport = program.motion.transport;
        let (from, until) = (
            transport.start,
            transport.start + transport.span.unwrap_or(0),
        );
        let mut stage = Vec::with_capacity(program.motion.shots.len());
        for s in &program.motion.shots {
            let def = shots_json
                .and_then(|m| m.get(&s.id))
                .and_then(Value::as_object);
            stage.push(match def {
                Some(def) if !def.contains_key("start") && cameras[s.camera].own.is_some() => {
                    let r = Raw {
                        id: s.id.clone(),
                        def,
                        camera: s.camera,
                        start: from,
                        end: until,
                    };
                    Some(Plan::shot_of(doc, program, &cameras, &r, &frame, planted)?)
                }
                _ => None,
            });
        }
        Ok(Some(Plan {
            stage,
            staged: program.inputs.staged.clone(),
            size,
            safe,
            frame_rate: rate,
            shots,
            transitions,
            slow: doc
                .get("transport")
                .and_then(|t| t.get("reduced_motion"))
                .and_then(Value::as_str)
                == Some("slow"),
            doc_camera: doc
                .get("camera")
                .and_then(Value::as_str)
                .and_then(|c| cameras.iter().position(|x| x.id == c)),
            groups: doc
                .get("items")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .filter_map(|(id, item)| parallax_of(id, item))
                .collect(),
            cameras,
        }))
    }

    fn shot_of(
        doc: &Map<String, Value>,
        program: &Program,
        cameras: &[Camera],
        r: &Raw,
        frame: &Frame,
        planted: Planted,
    ) -> Result<Shot, Refused> {
        let s = r.def;
        let id = &r.id;
        let path = format!("shots/{id}");
        let cam = &cameras[r.camera];
        let ctx = Ctx::timeline(doc, program.motion.frame_rate)?;
        let mv = match s.get("move") {
            None => Move::Hold,
            Some(Value::String(m)) => match m.as_str() {
                "hold" => Move::Hold,
                "push" => Move::Push,
                "pull" => Move::Pull,
                "pan" => Move::Pan,
                "orbit" => Move::Orbit,
                "slam" => Move::Slam,
                "shake" => Move::Shake,
                "log_zoom" => Move::LogZoom,
                "lens_zoom" => Move::LensZoom,
                _ => return bad(format!("{path}/move")),
            },
            Some(Value::Object(m)) if m.len() == 1 && m.contains_key("follow_forward") => {
                let item = m["follow_forward"].as_str();
                let Some(i) = program.items.iter().position(|x| Some(x.as_str()) == item) else {
                    return refused(
                        "ref_unresolved",
                        format!("{path}/move/follow_forward"),
                        json!({"shot": id}),
                    );
                };
                Move::FollowForward(i)
            }
            Some(_) => return bad(format!("{path}/move")),
        };
        let Some(own) = cam.own else {
            return refused(
                "out_of_range",
                format!("items/{}/params", cam.id),
                json!({"shot": id, "why": "the camera's params aren't a pose"}),
            );
        };
        if cam.flat && matches!(mv, Move::Orbit | Move::LensZoom) {
            return refused(
                "shot_move",
                format!("{path}/move"),
                json!({"shot": id, "why": "this move turns a 3D camera; it's refused in 2D"}),
            );
        }
        let ease = ease_named(s.get("ease"), &format!("{path}/ease"))?;
        let by_default = match mv {
            Move::Push | Move::Pull | Move::LensZoom => 0.15,
            Move::Pan => {
                if own.perspective() {
                    15.0
                } else {
                    0.25
                }
            }
            Move::Orbit => 30.0,
            Move::Slam => 1.7,
            Move::Shake => 0.5,
            _ => 0.0,
        };
        let by = num(s.get("by"), &format!("{path}/by"))?.unwrap_or(by_default);
        let angle = num(s.get("angle"), &format!("{path}/angle"))?.unwrap_or(0.0);
        let roll = num(s.get("roll"), &format!("{path}/roll"))?.unwrap_or(0.0);
        // The base orientation: the camera's own, with the shot's explicit pose over it.
        let target = match s.get("target") {
            Some(v) => vec3(v, &format!("{path}/target"))?,
            None => own.target,
        };
        let mut base = Pose {
            target,
            roll,
            ..own
        };
        if !own.flat {
            let (mut az, mut el) = own.angles();
            let mut d = own.distance();
            if let Some(o) = s.get("orbit").and_then(Value::as_object) {
                az = num(o.get("azimuth"), &format!("{path}/orbit/azimuth"))?.unwrap_or(az);
                el = num(o.get("elevation"), &format!("{path}/orbit/elevation"))?.unwrap_or(el);
                d = num(o.get("distance"), &format!("{path}/orbit/distance"))?.unwrap_or(d);
            }
            if let Some(w) = num(s.get("view_width"), &format!("{path}/view_width"))? {
                if own.perspective() {
                    d = w / (2.0 * tan(rad(own.fov) / 2.0));
                } else {
                    base.view_width = w;
                }
            }
            base.position = add(target, scale(orbit_direction(az, el), d));
        } else {
            if let Some(w) = num(s.get("view_width"), &format!("{path}/view_width"))? {
                base.view_width = w;
            }
            base.position = target;
        }
        if planted == Planted::ShotWritesRoll0 {
            base.roll = 0.0;
        }
        let framing = match s.get("frame").and_then(Value::as_object) {
            Some(f) => Some(framing_of(f, cam.fit.as_ref(), &format!("{path}/frame"))?),
            None => None,
        };
        let mut union = None;
        let mut follow = None;
        let framed = match framing.as_ref().filter(|f| !f.keep.is_empty()) {
            Some(f) => {
                // A follow move takes the fit's centre from the move: it sizes to the item at the start.
                let u = match mv {
                    Move::FollowForward(_) => at_start(program, doc, &f.keep, r.start, id)?,
                    _ => union_over(program, doc, &f.keep, r.start, r.end, id)?,
                };
                union = Some(u);
                // #407: a shot's one framed pose is its explicit pose where it sets one (a view
                // width), else a fit of its kept items (Shot).
                if s.get("view_width").is_some() {
                    base
                } else {
                    fit(&base, &u, f.pad, f.fill, frame.place_px(f.place), frame)
                }
            }
            None => base,
        };
        if let Move::FollowForward(item) = mv {
            // Baked at check: the running maximum of the item's x plus a lead, smoothed by a
            // Gaussian, so the target never moves back and seeking equals playing.
            let mut state = program.state();
            let raw: Vec<f64> = grid(r.start, r.end + FOLLOW_STEP, FOLLOW_STEP)
                .into_iter()
                .map(|t| {
                    program.evaluate(t, Validity::Full, &mut state);
                    state.slots[item * TRANSFORM]
                })
                .collect();
            let first = raw.first().copied().unwrap_or(0.0);
            let mut high = f64::NEG_INFINITY;
            let maxed: Vec<f64> = raw
                .iter()
                .map(|x| {
                    high = high.max(*x);
                    high - first
                })
                .collect();
            let sigma = 24.0;
            let reach = 72i64;
            let weights: Vec<f64> = (-reach..=reach)
                .map(|k| exp(-((k * k) as f64) / (2.0 * sigma * sigma)))
                .collect();
            let total: f64 = weights.iter().sum();
            let n = maxed.len() as i64;
            let smooth: Vec<f64> = (0..n)
                .map(|i| {
                    (-reach..=reach)
                        .map(|k| {
                            weights[(k + reach) as usize] * maxed[(i + k).clamp(0, n - 1) as usize]
                        })
                        .sum::<f64>()
                        / total
                })
                .collect();
            follow = Some(smooth.into_iter().map(|d| framed.target[0] + d).collect());
        }
        let glide = match s.get("join") {
            None | Some(Value::Null) => None,
            Some(Value::String(j)) if j == "cut" => None,
            Some(Value::Object(j)) if j.contains_key("glide") => {
                Some(match j["glide"].get("span") {
                    None => FLICKS_PER_SECOND * 4 / 5,
                    v => time(v, &ctx, &format!("{path}/join/glide/span"))?,
                })
            }
            Some(_) => return bad(format!("{path}/join")),
        };
        let shake = match s.get("shake").and_then(Value::as_object) {
            Some(k) => Some(Shake {
                by: num(k.get("by"), &format!("{path}/shake/by"))?.unwrap_or(0.5),
                hz: num(k.get("hz"), &format!("{path}/shake/hz"))?.unwrap_or(2.0),
                roll: num(k.get("roll"), &format!("{path}/shake/roll"))?.unwrap_or(0.0),
            }),
            None if mv == Move::Shake => Some(Shake {
                by,
                hz: num(s.get("hz"), &format!("{path}/hz"))?.unwrap_or(2.0),
                roll: 0.0,
            }),
            None => None,
        };
        let from = match mv {
            Move::LogZoom => Some(if s.get("by").is_some() {
                framed.widened(by)
            } else {
                // From a fit of the first kept item at the shot's start.
                match framing
                    .as_ref()
                    .and_then(|f| f.keep.first().map(|k| (f, k)))
                {
                    Some((f, k)) => {
                        let u = at_start(program, doc, std::slice::from_ref(k), r.start, id)?;
                        fit(&base, &u, f.pad, f.fill, frame.place_px(f.place), frame)
                    }
                    None => framed.widened(0.01),
                }
            }),
            _ => None,
        };
        Ok(Shot {
            id: id.clone(),
            camera: r.camera,
            start: r.start,
            end: r.end,
            moves: mv,
            ease,
            by,
            angle,
            framed,
            from,
            glide,
            keyed: s.get("keyed").and_then(Value::as_bool).unwrap_or(false),
            essential: s.get("essential").and_then(Value::as_bool).unwrap_or(false),
            shake,
            look: s.get("look").and_then(Value::as_str).map(str::to_string),
            union,
            follow,
        })
    }

    /// The camera at index `cam` at t.
    pub fn shown(&self, cam: usize, t: i64, at: &At) -> Shown {
        let mut out = self.shown_bare(cam, t, at);
        if !at.reduced {
            out.pose = self.kicked(cam, &out.pose, t, at);
        }
        out
    }

    /// Shot `i`'s side of a transition at t: its own pose at t, as if it alone wrote the camera,
    /// its camera's kick applied.
    pub fn side(&self, i: usize, t: i64, at: &At) -> Pose {
        let pose = self.shot_pose(i, t.min(self.shots[i].end), at).pose;
        if at.reduced {
            pose
        } else {
            self.kicked(self.shots[i].camera, &pose, t, at)
        }
    }

    /// The shot that writes camera `cam` at t: the active one, else the last one that ended.
    pub fn shot_at(&self, cam: usize, t: i64) -> Option<usize> {
        let mine = || {
            self.shots
                .iter()
                .enumerate()
                .filter(|(_, s)| s.camera == cam)
        };
        mine()
            .filter(|(_, s)| s.start <= t && t < s.end)
            .map(|(i, _)| i)
            .next_back()
            .or_else(|| {
                mine()
                    .filter(|(_, s)| s.end <= t)
                    .max_by_key(|(_, s)| s.end)
                    .map(|(i, _)| i)
            })
    }

    fn shown_bare(&self, cam: usize, t: i64, at: &At) -> Shown {
        self.shown_upto(cam, self.staged.get(cam).map_or(0, Vec::len), t, at)
    }

    /// [`Plan::shown_bare`] counting only the camera's first `n` stage shots: a stage shot's
    /// pose first, else the timeline's.
    fn shown_upto(&self, cam: usize, n: usize, t: i64, at: &At) -> Shown {
        if let Some(shown) = self.staged(cam, n, t, at) {
            return shown;
        }
        let camera = &self.cameras[cam];
        // A whip's window turns the side it shows (Transition: whip).
        for tr in &self.transitions {
            let Kind::Whip { angle, sweep } = tr.kind else {
                continue;
            };
            if self.shots[tr.from].camera != cam || t < tr.start || t >= tr.end || at.reduced {
                continue;
            }
            let side = if t < tr.cut { tr.from } else { tr.to };
            let pose = self.shot_pose(side, t, at).pose;
            let half = (tr.end - tr.start) as f64 / 2.0;
            let quad_in_out = |x: f64| {
                if x < 0.5 {
                    2.0 * x * x
                } else {
                    1.0 - 2.0 * (1.0 - x) * (1.0 - x)
                }
            };
            let a = if t < tr.cut {
                let x = (t - tr.start) as f64 / half;
                sweep
                    * if at.planted == Planted::WhipEasesHalves {
                        quad_in_out(x)
                    } else {
                        x * x
                    }
            } else {
                let x = (t - tr.cut) as f64 / half;
                -sweep
                    * if at.planted == Planted::WhipEasesHalves {
                        1.0 - quad_in_out(x)
                    } else {
                        (1.0 - x) * (1.0 - x)
                    }
            };
            let turned = if pose.flat {
                pose
            } else {
                let (y, p) = yaw_pitch(sub(pose.target, pose.position));
                aimed(&pose, y + a * cos(rad(angle)), p - a * sin(rad(angle)))
            };
            return Shown {
                pose: turned,
                shot: Some(side),
                stage: None,
                dissolve: None,
                moving: true,
            };
        }
        match self.shot_at(cam, t) {
            Some(i) if t < self.shots[i].end => self.shot_pose(i, t, at),
            Some(i) => Shown {
                pose: self.shot_pose(i, self.shots[i].end, at).pose,
                shot: Some(i),
                stage: None,
                dissolve: None,
                moving: false,
            },
            None => Shown {
                pose: camera.own.unwrap_or(Pose {
                    position: [0.0; 3],
                    target: [0.0; 3],
                    fov: 0.0,
                    view_width: 1.0,
                    roll: 0.0,
                    flat: true,
                }),
                shot: None,
                stage: None,
                dissolve: None,
                moving: false,
            },
        }
    }

    /// Shot `i`'s pose at t (at its end, its last pose), with its glide, its shake and reduced
    /// motion.
    fn shot_pose(&self, i: usize, t: i64, at: &At) -> Shown {
        let s = &self.shots[i];
        if s.keyed {
            let pose = (at.keyed)(s.camera).unwrap_or(s.framed);
            return Shown {
                pose,
                shot: Some(i),
                stage: None,
                dissolve: None,
                moving: false,
            };
        }
        let reduced_cut = at.reduced && !self.slow && !s.essential;
        let span = (s.end - s.start).max(1);
        let mut dissolve = None;
        let mut moving = s.moves != Move::Hold || s.shake.is_some();
        let mut pose = if reduced_cut && s.moves.animates() {
            // Under reduced motion a move cuts to its final framing at its midpoint, with a 200 ms
            // dissolve (Transport).
            let mid = s.start + span / 2;
            let a = s.moved(&s.at_u(0.0), s.start, at.planted);
            let b = s.moved(&s.at_u(1.0), s.end, at.planted);
            if (t - mid).abs() < DISSOLVE / 2 {
                let mix = (t - (mid - DISSOLVE / 2)) as f64 / DISSOLVE as f64;
                dissolve = Some((mix, a, b));
            }
            moving = false;
            if t < mid {
                a
            } else {
                b
            }
        } else if at.reduced && matches!(s.moves, Move::Slam) {
            s.framed
        } else {
            s.moved(&s.u(t), t, at.planted)
        };
        if let Some(g) = s.glide.filter(|g| *g > 0 && t < s.start + g) {
            let before = self
                .shots
                .iter()
                .enumerate()
                .filter(|(k, p)| p.camera == s.camera && p.end <= s.start && *k != i)
                .max_by_key(|(_, p)| p.end)
                .map(|(k, p)| self.shot_pose(k, p.end, at).pose)
                .or(self.cameras[s.camera].own);
            if let Some(before) = before {
                let (glided, faded, glides) =
                    joined(&before, &pose, s.start, g, s.ease, t, reduced_cut);
                pose = glided;
                dissolve = faded.or(dissolve);
                moving |= glides;
            }
        }
        if let Some(k) = s.shake.filter(|_| !at.reduced) {
            pose = self.shaken(s, &pose, k, t, at);
        }
        Shown {
            pose,
            shot: Some(i),
            stage: None,
            dissolve,
            moving,
        }
    }

    /// #504: what camera `cam` shows at t from its stage shots, counting the first `n`: the
    /// latest at or before t, unless a timeline shot started after it, glides from the pose shown
    /// at its entry into its stage's framed pose (Control: "A stage's shot starts at the stage's
    /// entry and, unless it says `join: cut`, glides there over 0.8 s from the pose shown").
    /// `None` where no stage shot writes the camera at t.
    fn staged(&self, cam: usize, n: usize, t: i64, at: &At) -> Option<Shown> {
        let list = self.staged.get(cam)?;
        let k = list[..n.min(list.len())]
            .partition_point(|s| s.t <= t)
            .checked_sub(1)?;
        let st = list[k];
        let stage = self.stage.get(st.shot)?.as_ref()?;
        if self
            .shots
            .iter()
            .any(|s| s.camera == cam && s.start > st.t && s.start <= t)
        {
            return None;
        }
        // The pose shown at the entry: the earlier stage shots' and the timeline's.
        let before = self.shown_upto(cam, k, st.t, at).pose;
        let reduced = at.reduced && !self.slow && !stage.essential;
        let (mut pose, dissolve, moving) =
            joined(&before, &stage.framed, st.t, st.span, st.ease, t, reduced);
        if at.planted == Planted::StageGlideMovesTargetOnly {
            pose.position = stage.framed.position;
        }
        Some(Shown {
            pose,
            shot: None,
            stage: Some(st.shot),
            dissolve,
            moving,
        })
    }

    /// The pose turned by the shot's shake: lattice noise of (t × hz, the shot's ID) on yaw and
    /// pitch, and on roll, never past `by` (Shot).
    fn shaken(&self, s: &Shot, pose: &Pose, k: Shake, t: i64, at: &At) -> Pose {
        let seed = fnv(&s.id);
        let x = if at.planted == Planted::ShakeFreshPerFrame {
            self.frame_of(t) as f64 + 0.5
        } else {
            t as f64 / F * k.hz
        };
        let (mut ex, mut ey) = (noise(seed, x), noise(seed ^ 0x5bd1_e995, x));
        let m = sqrt(ex * ex + ey * ey);
        if m > 1.0 {
            ex /= m;
            ey /= m;
        }
        let er = noise(seed ^ 0x2545_f491, x);
        let mut out = if pose.flat {
            let w = pose.view_width / self.size[0];
            let target = [
                pose.target[0] + ex * k.by * w,
                pose.target[1] - ey * k.by * w,
                pose.target[2],
            ];
            Pose {
                position: target,
                target,
                ..*pose
            }
        } else {
            tilted(pose, ex, ey, k.by)
        };
        out.roll = pose.roll + er * k.roll;
        out
    }

    fn frame_of(&self, t: i64) -> i64 {
        let (p, q) = self.frame_rate;
        (i128::from(t) * i128::from(p)).div_euclid(i128::from(FLICKS_PER_SECOND) * i128::from(q))
            as i64
    }

    /// The camera's kicks at t added to `pose` (Camera `camera@1`: kick): their sum clamped to
    /// `by`, in an indexed look rounded to whole target pixels.
    fn kicked(&self, cam: usize, pose: &Pose, t: i64, at: &At) -> Pose {
        let camera = &self.cameras[cam];
        let seed = fnv(&camera.id);
        let (mut ox, mut oy, mut by) = (0.0, 0.0, 0.0f64);
        for k in camera.kicks.iter().filter(|k| k.at <= t && t < k.at + k.s) {
            let u = (t - k.at) as f64 / k.s as f64;
            let w = (1.0 - u) * (1.0 - u);
            let x = if at.planted == Planted::KickFreshPerFrame {
                self.frame_of(t) as f64 + 0.5
            } else {
                t as f64 / F * k.hz
            };
            let ks = seed ^ k.index.wrapping_mul(0x9E37_79B9);
            ox += noise(ks, x) * k.by * w;
            oy += noise(ks ^ 0x5bd1_e995, x) * k.by * w;
            by = by.max(k.by);
        }
        if by == 0.0 {
            return *pose;
        }
        ox = ox.clamp(-by, by);
        oy = oy.clamp(-by, by);
        if pose.perspective() {
            let mut p = tilted(pose, ox / by, oy / by, by);
            p.roll = pose.roll;
            return p;
        }
        let per_px = match at.indexed {
            Some(w) => {
                ox = ox.round();
                oy = oy.round();
                pose.view_width / w
            }
            None => pose.view_width / self.size[0],
        };
        let d = [ox * per_px, oy * per_px];
        let target = [pose.target[0] + d[0], pose.target[1] + d[1], pose.target[2]];
        let position = if pose.flat {
            target
        } else {
            [
                pose.position[0] + d[0],
                pose.position[1] + d[1],
                pose.position[2],
            ]
        };
        Pose {
            position,
            target,
            ..*pose
        }
    }

    /// The sub-samples a frame at t averages under motion blur (Motion blur: stratified over the
    /// shutter centred on t), each with the shot whose side it draws, inside a declared move.
    pub fn blur(
        &self,
        cam: usize,
        t: i64,
        at: &At,
        shutter: f64,
        samples: u32,
    ) -> Vec<(i64, Option<usize>, Pose)> {
        if at.reduced || samples == 0 || !self.shown(cam, t, at).moving {
            return Vec::new();
        }
        let (p, q) = self.frame_rate;
        let open = shutter / 360.0 * F * f64::from(q) / f64::from(p);
        (0..samples)
            .map(|k| {
                let dt = ((f64::from(k) + 0.5) / f64::from(samples) - 0.5) * open;
                let ts = t + dt.round() as i64;
                let shown = self.shown(cam, ts, at);
                (ts, shown.shot, shown.pose)
            })
            .collect()
    }

    /// A keyed shot's pose: its camera's own params as the program's channels write them.
    pub fn keyed_pose(&self, cam: usize, program: &Program, state: &State) -> Option<Pose> {
        let camera = &self.cameras[cam];
        let mut params = Value::Object(camera.params.clone());
        params.as_object_mut()?.remove("kick");
        let (_, fields) = program.item_values(state, &camera.id)?;
        for (path, value) in fields {
            if path.first().map(String::as_str) != Some("params") {
                continue;
            }
            let pointer = format!("/{}", path[1..].join("/"));
            let v = match value {
                Datum::Num(x) => json!(x),
                Datum::Nums(xs) => json!(xs),
                _ => continue,
            };
            if let Some(slot) = params.pointer_mut(&pointer) {
                *slot = v;
            }
        }
        let path = format!("items/{}/params", camera.id);
        let spec = Spec::read(
            &deep_canvas::kinds::with_defaults("camera@1", params.as_object()?),
            &path,
        )
        .ok()?;
        let rig = spec.rig(&path).ok()?;
        Some(Pose::of_core(&spec.pose(&rig, &Offsets::default())))
    }

    /// The index of the camera named `id`.
    pub fn camera(&self, id: &str) -> Option<usize> {
        self.cameras.iter().position(|c| c.id == id)
    }
}

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
