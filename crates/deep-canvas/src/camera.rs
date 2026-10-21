//! The core's camera (issue #372; canvas primitives: Camera `camera@1`): the fields of a
//! `camera@1` item read into a [`Spec`], its evaluated [`Pose`] with the viewer's [`Offsets`]
//! applied, and the [`Projector`] that puts a point of the document on a frame of pixels.
//!
//! Conventions (canvas primitives: Units and axes): 3D is meters, right-handed, +Y up; a 2D
//! document is in u with y down. An orbit puts the eye at
//! `target + distance · (cos el · sin az, sin el, cos el · cos az)`, so azimuth 0 looks at the
//! front (+Z) and elevation raises the eye. The field of view spans the wider side of the frame.
//! Every transcendental goes through [`crate::ops`], so a pose evaluates the same everywhere.

use serde_json::{json, Map, Value};

use crate::ops::{asin, atan, atan2, cos, sin, sqrt, tan, PI};

/// A refusal, as `session` and `render` answer one: a closed-list code, the refused field's
/// path and what was wrong with it.
#[derive(Clone, Debug, PartialEq)]
pub struct Refused {
    pub code: &'static str,
    pub path: String,
    pub what: String,
}

impl Refused {
    pub fn new(code: &'static str, path: impl Into<String>, what: impl Into<String>) -> Self {
        Refused {
            code,
            path: path.into(),
            what: what.into(),
        }
    }

    pub fn to_json(&self) -> Value {
        json!({"ok": false, "code": self.code, "path": self.path, "what": self.what})
    }
}

pub type Vec3 = [f64; 3];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Projection {
    Perspective,
    Orthographic,
}

/// What the camera turns about under the viewer's drag.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pivot {
    Target,
    Eye,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ZoomAt {
    Pointer,
    Center,
}

/// `orbit {azimuth, elevation, distance}`; the distance may follow from `view_width` and `fov`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Orbit {
    pub azimuth: f64,
    pub elevation: f64,
    pub distance: Option<f64>,
}

/// The `user` field (viewer class): how the viewer's input moves the camera.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct User {
    /// Degrees per px of drag, sideways and up or down.
    pub turn: f64,
    pub tilt: f64,
    /// The elevation's range, degrees.
    pub pitch: [f64; 2],
    /// The zoom factor's range.
    pub zoom: [f64; 2],
    pub pivot: Pivot,
    /// The azimuth's range about the shot's, degrees; the full turn means no limit.
    pub yaw: [f64; 2],
    /// Whether a pan stays inside the content's bounds, and the margin as a share of them.
    pub pan_bounds_content: bool,
    pub pan_margin: f64,
    pub zoom_at: ZoomAt,
}

/// A `camera@1` item's fields as read from its params.
#[derive(Clone, Debug, PartialEq)]
pub struct Spec {
    pub projection: Projection,
    pub target: Vec3,
    pub position: Option<Vec3>,
    pub orbit: Option<Orbit>,
    pub roll: f64,
    pub view_width: Option<f64>,
    pub fov: f64,
    pub shift: [f64; 2],
    pub user: User,
}

/// The authored pose the viewer's offsets apply to: the orbit angles and distance of the eye
/// about the target, and whether the document is flat (2D in u, orthographic).
#[derive(Clone, Debug, PartialEq)]
pub struct Rig {
    pub flat: bool,
    pub azimuth: f64,
    pub elevation: f64,
    pub distance: f64,
    /// The view's width through the target at zoom 1.
    pub view_width: f64,
}

/// The viewer's offsets, held in session state and never in the document.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Offsets {
    pub azimuth: f64,
    pub elevation: f64,
    pub zoom: f64,
    /// A pan of the target: in u on the page of a flat document (its z unused), in m in the
    /// view plane of a 3D one.
    pub pan: Vec3,
}

impl Default for Offsets {
    fn default() -> Self {
        Offsets {
            azimuth: 0.0,
            elevation: 0.0,
            zoom: 1.0,
            pan: [0.0, 0.0, 0.0],
        }
    }
}

/// The evaluated camera: where the eye is and what it looks at, with the offsets applied.
#[derive(Clone, Debug, PartialEq)]
pub struct Pose {
    pub position: Vec3,
    pub target: Vec3,
    pub azimuth: f64,
    pub elevation: f64,
    pub distance: f64,
    /// Degrees across the wider side; 0 is orthographic.
    pub fov: f64,
    pub view_width: f64,
    pub zoom: f64,
    pub roll: f64,
    pub flat: bool,
    pub shift: [f64; 2],
}

impl Pose {
    pub fn to_json(&self) -> Value {
        json!({
            "position": self.position,
            "target": self.target,
            "azimuth": self.azimuth,
            "elevation": self.elevation,
            "distance": self.distance,
            "fov": self.fov,
            "view_width": self.view_width,
            "zoom": self.zoom,
        })
    }
}

fn number(value: Option<&Value>, path: &str) -> Result<f64, Refused> {
    match value.and_then(Value::as_f64) {
        Some(n) if n.is_finite() => Ok(n),
        _ => Err(Refused::new("out_of_range", path, "not a finite number")),
    }
}

fn number_or(value: Option<&Value>, path: &str, default: f64) -> Result<f64, Refused> {
    match value {
        None | Some(Value::Null) => Ok(default),
        some => number(some, path),
    }
}

fn vector<const N: usize>(value: &Value, path: &str) -> Result<[f64; N], Refused> {
    let Some(items) = value.as_array() else {
        return Err(Refused::new(
            "out_of_range",
            path,
            format!("not {N} numbers"),
        ));
    };
    if items.len() != N {
        return Err(Refused::new(
            "out_of_range",
            path,
            format!("not {N} numbers"),
        ));
    }
    let mut out = [0.0; N];
    for (i, item) in items.iter().enumerate() {
        out[i] = number(Some(item), &format!("{path}/{i}"))?;
    }
    Ok(out)
}

fn vector_or<const N: usize>(
    value: Option<&Value>,
    path: &str,
    default: [f64; N],
) -> Result<[f64; N], Refused> {
    match value {
        None | Some(Value::Null) => Ok(default),
        Some(v) => vector(v, path),
    }
}

fn range(value: Option<&Value>, path: &str, default: [f64; 2]) -> Result<[f64; 2], Refused> {
    let r = vector_or(value, path, default)?;
    if r[0] > r[1] {
        return Err(Refused::new("out_of_range", path, "min above max"));
    }
    Ok(r)
}

fn choice<'a>(
    value: Option<&'a Value>,
    path: &str,
    options: &[&'a str],
    default: &'a str,
) -> Result<&'a str, Refused> {
    match value {
        None | Some(Value::Null) => Ok(default),
        Some(Value::String(s)) => options.iter().copied().find(|o| o == s).ok_or_else(|| {
            Refused::new(
                "out_of_range",
                path,
                format!("one of {}", options.join(", ")),
            )
        }),
        Some(_) => Err(Refused::new("out_of_range", path, "not a string")),
    }
}

fn object(value: Option<&Value>, path: &str) -> Result<Map<String, Value>, Refused> {
    match value {
        None | Some(Value::Null) => Ok(Map::new()),
        Some(Value::Object(o)) => Ok(o.clone()),
        Some(_) => Err(Refused::new("out_of_range", path, "not an object")),
    }
}

/// Refuses a key the field doesn't define.
fn closed(fields: &Map<String, Value>, path: &str, keys: &[&str]) -> Result<(), Refused> {
    for key in fields.keys() {
        if !keys.contains(&key.as_str()) {
            return Err(Refused::new(
                "unknown_field",
                format!("{path}/{key}"),
                format!("not a field of {path}"),
            ));
        }
    }
    Ok(())
}

impl Spec {
    /// Reads a `camera@1` item's lowered `params` with the registry's defaults filled in
    /// ([`crate::kinds::with_defaults`]), `path` being `items/<id>/params`. The fields of
    /// `orbit`, `user` and `user.pan` have no registry schema, so their defaults live here.
    pub fn read(params: &Map<String, Value>, path: &str) -> Result<Spec, Refused> {
        let at = |field: &str| format!("{path}/{field}");
        // An isometric view has fixed angles the design does not state yet: refused, not
        // guessed, as `fit` is.
        let projection = match choice(
            params.get("projection"),
            &at("projection"),
            &["perspective", "orthographic", "isometric"],
            "perspective",
        )? {
            "orthographic" => Projection::Orthographic,
            "isometric" => {
                return Err(Refused::new(
                    "out_of_range",
                    at("projection"),
                    "isometric is not evaluated in this build; use orthographic with an orbit",
                ))
            }
            _ => Projection::Perspective,
        };
        let target = vector(params.get("target").unwrap_or(&Value::Null), &at("target"))?;
        let position = match params.get("position") {
            None | Some(Value::Null) => None,
            Some(v) => Some(vector(v, &at("position"))?),
        };
        let orbit = match params.get("orbit") {
            None | Some(Value::Null) => None,
            Some(v) => {
                let fields = object(Some(v), &at("orbit"))?;
                closed(&fields, &at("orbit"), &["azimuth", "elevation", "distance"])?;
                let distance = match fields.get("distance") {
                    None | Some(Value::Null) => None,
                    some => Some(number(some, &at("orbit/distance"))?),
                };
                Some(Orbit {
                    azimuth: number_or(fields.get("azimuth"), &at("orbit/azimuth"), 45.0)?,
                    elevation: number_or(fields.get("elevation"), &at("orbit/elevation"), 30.0)?,
                    distance,
                })
            }
        };
        if position.is_some() && orbit.is_some() {
            return Err(Refused::new(
                "out_of_range",
                at("orbit"),
                "a camera has a position or an orbit, not both",
            ));
        }
        let roll = number(params.get("roll"), &at("roll"))?;
        let view_width = match params.get("view_width") {
            None | Some(Value::Null) => None,
            some => Some(number(some, &at("view_width"))?),
        };
        if view_width.is_some_and(|w| w <= 0.0) {
            return Err(Refused::new(
                "out_of_range",
                at("view_width"),
                "not above 0",
            ));
        }
        let fov = number(params.get("fov"), &at("fov"))?;
        let shift = vector(params.get("shift").unwrap_or(&Value::Null), &at("shift"))?;
        // Framing (Camera `camera@1`: framing) is solved from the kept items' bounds, which
        // this slice does not evaluate: a document asking for it is refused, never framed by
        // the authored pose as if it had not asked.
        if params.get("fit").is_some_and(|v| !v.is_null()) {
            return Err(Refused::new(
                "out_of_range",
                at("fit"),
                "framing is not evaluated in this build; leave fit unset",
            ));
        }

        let user_path = at("user");
        let u = object(params.get("user"), &user_path)?;
        closed(
            &u,
            &user_path,
            &[
                "turn",
                "tilt",
                "pitch",
                "zoom",
                // Zoom per px of scroll: accepted, but no scroll input reaches this slice.
                "zoom_rate",
                "pivot",
                "yaw",
                "pan",
                "zoom_at",
            ],
        )?;
        let pan_path = format!("{user_path}/pan");
        let pan = object(u.get("pan"), &pan_path)?;
        // `pan.edge` (goto and edge pan) needs the session's clock and focus, which this slice
        // has no surface for, so a document that sets it is refused rather than read and ignored.
        closed(&pan, &pan_path, &["bounds", "margin"])?;
        let user = User {
            turn: number_or(u.get("turn"), &format!("{user_path}/turn"), 0.25)?,
            tilt: number_or(u.get("tilt"), &format!("{user_path}/tilt"), 0.25)?,
            pitch: range(u.get("pitch"), &format!("{user_path}/pitch"), [-89.0, 89.0])?,
            zoom: range(u.get("zoom"), &format!("{user_path}/zoom"), [0.25, 4.0])?,
            pivot: match choice(
                u.get("pivot"),
                &format!("{user_path}/pivot"),
                &["target", "eye"],
                "target",
            )? {
                "eye" => Pivot::Eye,
                _ => Pivot::Target,
            },
            yaw: range(u.get("yaw"), &format!("{user_path}/yaw"), [-180.0, 180.0])?,
            pan_bounds_content: choice(
                pan.get("bounds"),
                &format!("{pan_path}/bounds"),
                &["content", "none"],
                "content",
            )? == "content",
            pan_margin: number_or(pan.get("margin"), &format!("{pan_path}/margin"), 0.1)?,
            zoom_at: match choice(
                u.get("zoom_at"),
                &format!("{user_path}/zoom_at"),
                &["pointer", "center"],
                "pointer",
            )? {
                "center" => ZoomAt::Center,
                _ => ZoomAt::Pointer,
            },
        };
        if user.zoom[0] <= 0.0 {
            return Err(Refused::new(
                "out_of_range",
                format!("{user_path}/zoom"),
                "not above 0",
            ));
        }
        if user.pan_margin < 0.0 {
            return Err(Refused::new(
                "out_of_range",
                format!("{pan_path}/margin"),
                "below 0",
            ));
        }
        Ok(Spec {
            projection,
            target,
            position,
            orbit,
            roll,
            view_width,
            fov,
            shift,
            user,
        })
    }

    /// The authored pose: a flat camera when orthographic with neither position nor orbit (its
    /// target and view width in u); else the orbit of the eye about the target, read from the
    /// position or the orbit, the distance following from `view_width` and `fov` when the orbit
    /// gives none.
    pub fn rig(&self, path: &str) -> Result<Rig, Refused> {
        let flat = self.projection == Projection::Orthographic
            && self.position.is_none()
            && self.orbit.is_none();
        if flat {
            let Some(view_width) = self.view_width else {
                return Err(Refused::new(
                    "out_of_range",
                    format!("{path}/view_width"),
                    "a flat camera needs its view width",
                ));
            };
            return Ok(Rig {
                flat,
                azimuth: 0.0,
                elevation: 0.0,
                distance: 0.0,
                view_width,
            });
        }
        // In perspective the distance follows from `view_width` and `fov` when both are given,
        // so a position or an orbit distance beside them would contradict it.
        if self.perspective()
            && self.view_width.is_some()
            && (self.position.is_some() || self.orbit.is_some_and(|o| o.distance.is_some()))
        {
            return Err(Refused::new(
                "out_of_range",
                format!("{path}/view_width"),
                "the distance follows from view_width and fov; give no position or orbit distance",
            ));
        }
        let (azimuth, elevation, distance) = if let Some(p) = self.position {
            let d = sub(p, self.target);
            let distance = length(d);
            if distance <= 0.0 {
                return Err(Refused::new(
                    "out_of_range",
                    format!("{path}/position"),
                    "the position is the target",
                ));
            }
            (
                deg(atan2(d[0], d[2])),
                deg(asin((d[1] / distance).clamp(-1.0, 1.0))),
                distance,
            )
        } else {
            let orbit = self.orbit.unwrap_or(Orbit {
                azimuth: 45.0,
                elevation: 30.0,
                distance: None,
            });
            let distance = match (orbit.distance, self.view_width) {
                (Some(d), _) => d,
                (None, Some(w)) if self.perspective() => w / (2.0 * tan(rad(self.fov) / 2.0)),
                (None, Some(_)) => 1.0,
                (None, None) => {
                    return Err(Refused::new(
                        "out_of_range",
                        format!("{path}/orbit/distance"),
                        "an orbit needs a distance, or a view width with the field of view",
                    ))
                }
            };
            (orbit.azimuth, orbit.elevation, distance)
        };
        if distance <= 0.0 {
            return Err(Refused::new(
                "out_of_range",
                format!("{path}/orbit/distance"),
                "not above 0",
            ));
        }
        let view_width = match self.view_width {
            Some(w) => w,
            None if self.perspective() => 2.0 * distance * tan(rad(self.fov) / 2.0),
            None => {
                return Err(Refused::new(
                    "out_of_range",
                    format!("{path}/view_width"),
                    "an orthographic camera needs its view width",
                ))
            }
        };
        // Finite input can still overflow (a position of 1e200 squares past f64), and a pose
        // or a frame built on an infinity is no camera.
        if ![azimuth, elevation, distance, view_width]
            .iter()
            .all(|n| n.is_finite())
        {
            return Err(Refused::new(
                "out_of_range",
                format!("{path}/position"),
                "too far from the target to measure",
            ));
        }
        Ok(Rig {
            flat,
            azimuth,
            elevation,
            distance,
            view_width,
        })
    }

    /// Whether points project in perspective: a perspective projection with a field of view
    /// above 0 (at 0 it is the orthographic view of its width).
    pub fn perspective(&self) -> bool {
        self.projection == Projection::Perspective && self.fov > 0.0
    }

    /// The pose with the viewer's offsets applied. Under `pivot: eye` the position is the
    /// authored one, copied and never recomputed, and the zoom narrows the field of view; about
    /// the target the zoom brings the eye nearer. A flat camera pans its target and divides its
    /// view width by the zoom.
    pub fn pose(&self, rig: &Rig, offsets: &Offsets) -> Pose {
        if rig.flat {
            let target = [
                self.target[0] + offsets.pan[0],
                self.target[1] + offsets.pan[1],
                self.target[2],
            ];
            return Pose {
                position: target,
                target,
                azimuth: 0.0,
                elevation: 0.0,
                distance: 0.0,
                fov: 0.0,
                view_width: rig.view_width / offsets.zoom,
                zoom: offsets.zoom,
                roll: self.roll,
                flat: true,
                shift: self.shift,
            };
        }
        let azimuth = rig.azimuth + offsets.azimuth;
        let elevation = rig.elevation + offsets.elevation;
        let direction = orbit_direction(azimuth, elevation);
        let (position, target, distance, fov) = match self.user.pivot {
            Pivot::Eye => {
                // The authored eye, written or from the orbit: the same bits on every call.
                let position = self.position.unwrap_or_else(|| {
                    add(
                        self.target,
                        scale(orbit_direction(rig.azimuth, rig.elevation), rig.distance),
                    )
                });
                let target = sub(position, scale(direction, rig.distance));
                let fov = if self.perspective() {
                    deg(2.0 * atan(tan(rad(self.fov) / 2.0) / offsets.zoom))
                } else {
                    0.0
                };
                (position, target, rig.distance, fov)
            }
            Pivot::Target => {
                let distance = rig.distance / offsets.zoom;
                let target = add(self.target, offsets.pan);
                let position = add(target, scale(direction, distance));
                let fov = if self.perspective() { self.fov } else { 0.0 };
                (position, target, distance, fov)
            }
        };
        let view_width = if self.perspective() {
            2.0 * distance * tan(rad(fov) / 2.0)
        } else {
            rig.view_width / offsets.zoom
        };
        Pose {
            position,
            target,
            azimuth,
            elevation,
            distance,
            fov,
            view_width,
            zoom: offsets.zoom,
            roll: self.roll,
            flat: false,
            shift: self.shift,
        }
    }
}

/// The unit vector from the target toward the eye at an orbit's angles, degrees.
pub fn orbit_direction(azimuth: f64, elevation: f64) -> Vec3 {
    let (az, el) = (rad(azimuth), rad(elevation));
    [cos(el) * sin(az), sin(el), cos(el) * cos(az)]
}

pub fn rad(degrees: f64) -> f64 {
    degrees * PI / 180.0
}

pub fn deg(radians: f64) -> f64 {
    radians * 180.0 / PI
}

pub fn add(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

pub fn sub(a: Vec3, b: Vec3) -> Vec3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

pub fn scale(a: Vec3, s: f64) -> Vec3 {
    [a[0] * s, a[1] * s, a[2] * s]
}

pub fn dot(a: Vec3, b: Vec3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

pub fn cross(a: Vec3, b: Vec3) -> Vec3 {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

pub fn length(a: Vec3) -> f64 {
    sqrt(dot(a, a))
}

fn normalize(a: Vec3) -> Vec3 {
    let n = length(a);
    if n > 0.0 {
        scale(a, 1.0 / n)
    } else {
        a
    }
}

/// A point of the document on the frame: its pixel, its depth along the view axis (1 for a
/// flat document) and the pixels one unit of the document spans there.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Projected {
    pub x: f64,
    pub y: f64,
    pub depth: f64,
    pub scale: f64,
}

/// A pose on a frame of pixels. The frame is the document's `size` scaled to `frame` px, and
/// `panel` the pixels the view fills with the frame's centre at its own: the two are equal but
/// under `extend`, where the panel is larger along one side and shows more view there.
#[derive(Clone, Debug, PartialEq)]
pub struct Projector {
    pose: Pose,
    right: Vec3,
    up: Vec3,
    forward: Vec3,
    /// Pixels per unit (flat or orthographic), or the focal length in px (perspective).
    scale: f64,
    perspective: bool,
    centre: [f64; 2],
    cos_roll: f64,
    sin_roll: f64,
}

impl Projector {
    pub fn new(pose: &Pose, frame: [f64; 2], panel: [f64; 2]) -> Projector {
        let wider = frame[0].max(frame[1]);
        let perspective = !pose.flat && pose.fov > 0.0;
        // The field of view spans the wider side of the frame; the view width spans its width.
        let scale = if perspective {
            (wider / 2.0) / tan(rad(pose.fov) / 2.0)
        } else {
            frame[0] / pose.view_width
        };
        let (right, up, forward) = if pose.flat {
            ([1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 1.0])
        } else {
            let forward = normalize(sub(pose.target, pose.position));
            let mut right = normalize(cross(forward, [0.0, 1.0, 0.0]));
            if length(right) == 0.0 {
                // Looking straight up or down: keep +X as right.
                right = [1.0, 0.0, 0.0];
            }
            let up = cross(right, forward);
            (right, up, forward)
        };
        let centre = [
            panel[0] / 2.0 + pose.shift[0] * frame[0],
            panel[1] / 2.0 + pose.shift[1] * frame[1],
        ];
        Projector {
            pose: pose.clone(),
            right,
            up,
            forward,
            scale,
            perspective,
            centre,
            cos_roll: cos(rad(pose.roll)),
            sin_roll: sin(rad(pose.roll)),
        }
    }

    pub fn pose(&self) -> &Pose {
        &self.pose
    }

    /// Where a point of the document lands, or `None` behind a perspective eye.
    pub fn project(&self, p: Vec3) -> Option<Projected> {
        let (x, y, depth, scale) = if self.pose.flat {
            let d = sub(p, self.pose.target);
            (d[0] * self.scale, d[1] * self.scale, 1.0, self.scale)
        } else {
            let d = sub(p, self.pose.position);
            let (xc, yc, zc) = (dot(d, self.right), dot(d, self.up), dot(d, self.forward));
            if self.perspective {
                if zc <= 0.0 {
                    return None;
                }
                let s = self.scale / zc;
                (xc * s, -yc * s, zc, s)
            } else {
                (xc * self.scale, -yc * self.scale, zc, self.scale)
            }
        };
        // Roll turns the frame about its centre.
        let (rx, ry) = (
            x * self.cos_roll - y * self.sin_roll,
            x * self.sin_roll + y * self.cos_roll,
        );
        Some(Projected {
            x: self.centre[0] + rx,
            y: self.centre[1] + ry,
            depth,
            scale,
        })
    }

    /// The point of a flat document under a pixel.
    pub fn unproject_flat(&self, x: f64, y: f64) -> [f64; 2] {
        let (dx, dy) = (x - self.centre[0], y - self.centre[1]);
        let (ux, uy) = (
            dx * self.cos_roll + dy * self.sin_roll,
            -dx * self.sin_roll + dy * self.cos_roll,
        );
        [
            self.pose.target[0] + ux / self.scale,
            self.pose.target[1] + uy / self.scale,
        ]
    }

    /// The point of the plane through the target, facing the eye, under a pixel of a 3D view.
    pub fn unproject_at_target(&self, x: f64, y: f64) -> Vec3 {
        let (dx, dy) = (x - self.centre[0], y - self.centre[1]);
        let (ux, uy) = (
            dx * self.cos_roll + dy * self.sin_roll,
            -dx * self.sin_roll + dy * self.cos_roll,
        );
        // Perspective: px per m at the target's depth is focal ÷ distance.
        let per_m = if self.perspective {
            self.scale / self.pose.distance
        } else {
            self.scale
        };
        add(
            self.pose.target,
            add(scale(self.right, ux / per_m), scale(self.up, -uy / per_m)),
        )
    }

    /// Degrees of view per pixel at the frame's centre.
    pub fn degrees_per_px(&self) -> f64 {
        if self.perspective {
            deg(atan(1.0 / self.scale))
        } else {
            0.0
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(params: Value) -> Result<Spec, Refused> {
        let filled = crate::kinds::with_defaults("camera@1", params.as_object().unwrap());
        Spec::read(&filled, "items/cam/params")
    }

    fn spec(params: Value) -> Spec {
        read(params).unwrap()
    }

    #[test]
    fn an_eye_in_front_of_the_target_sees_x_to_the_right_and_y_up() {
        let s = spec(json!({"position": [0, 0, 10], "target": [0, 0, 0], "fov": 40}));
        let rig = s.rig("items/cam/params").unwrap();
        assert_eq!((rig.azimuth, rig.elevation, rig.distance), (0.0, 0.0, 10.0));
        let pose = s.pose(&rig, &Offsets::default());
        let view = Projector::new(&pose, [1920.0, 1080.0], [1920.0, 1080.0]);
        let p = view.project([1.0, 1.0, 0.0]).unwrap();
        assert!(p.x > 960.0 && p.y < 540.0, "{p:?}");
        assert!((p.depth - 10.0).abs() < 1e-12);
    }

    #[test]
    fn an_orbit_reads_back_its_own_angles_through_the_position() {
        let s = spec(json!({"orbit": {"azimuth": 30, "elevation": 20, "distance": 8}}));
        let rig = s.rig("items/cam/params").unwrap();
        let pose = s.pose(&rig, &Offsets::default());
        let d = sub(pose.position, pose.target);
        assert!((deg(atan2(d[0], d[2])) - 30.0).abs() < 1e-9);
        assert!((deg(asin(d[1] / length(d))) - 20.0).abs() < 1e-9);
    }

    #[test]
    fn a_fit_a_negative_pan_margin_and_an_edge_pan_are_refused() {
        let params = json!({"projection": "orthographic", "view_width": 100, "fit": {"keep": []}});
        let err = read(params).unwrap_err();
        assert_eq!(err.path, "items/cam/params/fit");
        for (user, path) in [
            (
                json!({"pan": {"margin": -0.6}}),
                "items/cam/params/user/pan/margin",
            ),
            (
                json!({"pan": {"edge": {"margin": 8, "rate": 0.5}}}),
                "items/cam/params/user/pan/edge",
            ),
        ] {
            let params = json!({"projection": "orthographic", "view_width": 100, "user": user});
            let err = read(params).unwrap_err();
            assert_eq!(err.path, path);
        }
    }

    #[test]
    fn a_position_too_far_to_measure_is_refused_not_an_infinite_rig() {
        let s = spec(json!({"position": [1e200, 0, 0], "target": [0, 0, 0]}));
        let err = s.rig("items/cam/params").unwrap_err();
        assert_eq!(err.code, "out_of_range");
    }

    #[test]
    fn in_perspective_the_distance_follows_from_view_width_and_fov() {
        let s = spec(json!({"orbit": {"azimuth": 0, "elevation": 0}, "view_width": 4, "fov": 90}));
        let rig = s.rig("items/cam/params").unwrap();
        assert!((rig.distance - 2.0).abs() < 1e-12, "{rig:?}");
        let s = spec(json!({"position": [0, 0, 10], "view_width": 4, "fov": 90}));
        assert_eq!(
            s.rig("items/cam/params").unwrap_err().path,
            "items/cam/params/view_width"
        );
    }

    #[test]
    fn both_a_position_and_an_orbit_are_refused() {
        let params = json!({"position": [0, 0, 1], "orbit": {"distance": 1}});
        let err = read(params).unwrap_err();
        assert_eq!(err.path, "items/cam/params/orbit");
    }
}
