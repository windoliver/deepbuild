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
    /// Orthographic from the isometric elevation, atan(1/√2), the house style for figures.
    Isometric,
}

/// The isometric view's elevation in degrees: every world axis foreshortens alike.
pub const ISOMETRIC_ELEVATION: f64 = 35.264_389_682_754_654;

/// Flicks in one second, the session's clock unit.
pub const FLICKS_PER_SECOND: i64 = crate::grammar::FLICKS_PER_SECOND;

/// The eased share of a move at `s` of its span (in_out_cubic, the design's default ease),
/// clamped to the move.
pub fn ease_in_out_cubic(s: f64) -> f64 {
    let s = s.clamp(0.0, 1.0);
    if s < 0.5 {
        4.0 * s * s * s
    } else {
        let r = -2.0 * s + 2.0;
        1.0 - r * r * r / 2.0
    }
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
    /// Absent: 30°, or the isometric elevation under that projection.
    pub elevation: Option<f64>,
    pub distance: Option<f64>,
}

/// `user.pan.edge`: a pan while the pointer rests within `margin` px of the view's edge, at
/// `rate` view widths a second.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Edge {
    pub margin: f64,
    pub rate: f64,
}

/// `fit`: framing the kept items once, in closed form from their bounds.
#[derive(Clone, Debug, PartialEq)]
pub struct Fit {
    pub keep: Vec<String>,
    /// Each side of the bounds widened by this share of their extent.
    pub pad: f64,
    /// Where the kept items' centre lands, as fractions of the frame.
    pub place: [f64; 2],
    /// The share of the shorter side the kept items span.
    pub fill: f64,
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
    /// Log zoom per px of scroll: a scroll of `delta` px zooms by exp(−delta · zoom_rate), so
    /// a wheel up (negative) zooms in.
    pub zoom_rate: f64,
    pub pan_edge: Option<Edge>,
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
    pub fit: Option<Fit>,
    /// `yield.ease_back`: the seconds a reset takes to ease the offsets out.
    pub ease_back: f64,
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
    let Some(items) = value.as_array().filter(|a| a.len() == N) else {
        return Err(Refused::new(
            "out_of_range",
            path,
            format!("not {N} numbers"),
        ));
    };
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
        let projection = match choice(
            params.get("projection"),
            &at("projection"),
            &["perspective", "orthographic", "isometric"],
            "perspective",
        )? {
            "orthographic" => Projection::Orthographic,
            "isometric" => Projection::Isometric,
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
                let elevation = match fields.get("elevation") {
                    None | Some(Value::Null) => None,
                    some => Some(number(some, &at("orbit/elevation"))?),
                };
                Some(Orbit {
                    azimuth: number_or(fields.get("azimuth"), &at("orbit/azimuth"), 45.0)?,
                    elevation,
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
        // The isometric elevation is fixed; a heading (the orbit's azimuth) is still a choice.
        if projection == Projection::Isometric {
            if position.is_some() {
                return Err(Refused::new(
                    "out_of_range",
                    at("position"),
                    "an isometric camera has a fixed elevation; give an orbit azimuth",
                ));
            }
            if orbit.is_some_and(|o| o.elevation.is_some()) {
                return Err(Refused::new(
                    "out_of_range",
                    at("orbit/elevation"),
                    "fixed by the isometric projection",
                ));
            }
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
        // Framing (Camera `camera@1`: framing) sets the distance or view width and the target
        // from the kept items' bounds, so a position, a view width or an orbit distance
        // beside it would contradict it.
        let fit = match params.get("fit") {
            None | Some(Value::Null) => None,
            Some(v) => {
                let fit_path = at("fit");
                let f = object(Some(v), &fit_path)?;
                closed(&f, &fit_path, &["keep", "pad", "avoid", "place", "fill"])?;
                let keep = f
                    .get("keep")
                    .and_then(Value::as_array)
                    .filter(|k| !k.is_empty() && k.iter().all(Value::is_string))
                    .ok_or_else(|| {
                        Refused::new("out_of_range", format!("{fit_path}/keep"), "not item IDs")
                    })?
                    .iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect();
                // An overlay to avoid is the app's chrome, whose geometry no frame here has:
                // asked to avoid it, framing refuses rather than frames as if it were not asked.
                if choice(
                    f.get("avoid"),
                    &format!("{fit_path}/avoid"),
                    &["overlay", "none"],
                    "none",
                )? == "overlay"
                {
                    return Err(Refused::new(
                        "out_of_range",
                        format!("{fit_path}/avoid"),
                        "no overlay is evaluated in this build; use none",
                    ));
                }
                let place_path = format!("{fit_path}/place");
                let place = match f.get("place") {
                    None | Some(Value::Null) => [0.5, 0.5],
                    Some(Value::String(s)) => match s.as_str() {
                        "thirds_left" => [1.0 / 3.0, 0.5],
                        "thirds_right" => [2.0 / 3.0, 0.5],
                        _ => {
                            return Err(Refused::new(
                                "out_of_range",
                                place_path,
                                "two fractions, thirds_left or thirds_right",
                            ))
                        }
                    },
                    Some(v) => vector(v, &place_path)?,
                };
                if !place.iter().all(|f| (0.0..=1.0).contains(f)) {
                    return Err(Refused::new(
                        "out_of_range",
                        place_path,
                        "fractions of the frame, 0 to 1",
                    ));
                }
                let pad = number_or(f.get("pad"), &format!("{fit_path}/pad"), 0.08)?;
                let fill = number_or(f.get("fill"), &format!("{fit_path}/fill"), 0.6)?;
                if pad < 0.0 {
                    return Err(Refused::new(
                        "out_of_range",
                        format!("{fit_path}/pad"),
                        "below 0",
                    ));
                }
                if !(fill > 0.0 && fill <= 1.0) {
                    return Err(Refused::new(
                        "out_of_range",
                        format!("{fit_path}/fill"),
                        "a share above 0, up to 1",
                    ));
                }
                if position.is_some() {
                    return Err(Refused::new(
                        "out_of_range",
                        at("position"),
                        "framing sets the distance; give an orbit without one",
                    ));
                }
                if view_width.is_some() {
                    return Err(Refused::new(
                        "out_of_range",
                        at("view_width"),
                        "framing sets the view width",
                    ));
                }
                if orbit.is_some_and(|o| o.distance.is_some()) {
                    return Err(Refused::new(
                        "out_of_range",
                        at("orbit/distance"),
                        "framing sets the distance",
                    ));
                }
                Some(Fit {
                    keep,
                    pad,
                    place,
                    fill,
                })
            }
        };
        let yield_path = at("yield");
        let y = object(params.get("yield"), &yield_path)?;
        closed(&y, &yield_path, &["resume_after", "ease_back", "ease"])?;
        // A shot resumes after `resume_after`; no shot plays here, so it is read and held.
        let resume_after = number_or(
            y.get("resume_after"),
            &format!("{yield_path}/resume_after"),
            4.0,
        )?;
        let ease_back = number_or(y.get("ease_back"), &format!("{yield_path}/ease_back"), 1.2)?;
        if resume_after < 0.0 || ease_back < 0.0 {
            return Err(Refused::new("out_of_range", yield_path, "seconds below 0"));
        }
        choice(
            y.get("ease"),
            &format!("{yield_path}/ease"),
            &["in_out_cubic"],
            "in_out_cubic",
        )?;
        choice(
            params.get("reduced_motion"),
            &at("reduced_motion"),
            &["hold"],
            "hold",
        )?;

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
                "zoom_rate",
                "pivot",
                "yaw",
                "pan",
                "zoom_at",
            ],
        )?;
        let pan_path = format!("{user_path}/pan");
        let pan = object(u.get("pan"), &pan_path)?;
        closed(&pan, &pan_path, &["bounds", "margin", "edge"])?;
        let edge_path = format!("{pan_path}/edge");
        let pan_edge = match pan.get("edge") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) if s == "none" => None,
            Some(Value::Object(e)) => {
                closed(e, &edge_path, &["margin", "rate"])?;
                let edge = Edge {
                    margin: number_or(e.get("margin"), &format!("{edge_path}/margin"), 8.0)?,
                    rate: number_or(e.get("rate"), &format!("{edge_path}/rate"), 0.5)?,
                };
                if edge.margin < 0.0 || edge.rate < 0.0 {
                    return Err(Refused::new("out_of_range", edge_path, "below 0"));
                }
                Some(edge)
            }
            Some(_) => {
                return Err(Refused::new(
                    "out_of_range",
                    edge_path,
                    "{margin, rate} or none",
                ))
            }
        };
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
            zoom_rate: number_or(u.get("zoom_rate"), &format!("{user_path}/zoom_rate"), 0.005)?,
            pan_edge,
        };
        if user.zoom[0] <= 0.0 {
            return Err(Refused::new(
                "out_of_range",
                format!("{user_path}/zoom"),
                "not above 0",
            ));
        }
        // Pivot eye never moves the eye, and an edge pan moves the target with it.
        if user.pivot == Pivot::Eye && user.pan_edge.is_some() {
            return Err(Refused::new(
                "out_of_range",
                edge_path,
                "pivot eye never moves the eye; an edge pan needs pivot target",
            ));
        }
        // A rate below 0 would turn a wheel up into a zoom out; 0 is a wheel that zooms nothing.
        if user.zoom_rate < 0.0 {
            return Err(Refused::new(
                "out_of_range",
                format!("{user_path}/zoom_rate"),
                "below 0",
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
            fit,
            ease_back,
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
        let default_elevation = if self.projection == Projection::Isometric {
            ISOMETRIC_ELEVATION
        } else {
            30.0
        };
        // Framing fills the view width and the distance in (Spec::frame); 1 holds their place.
        if flat {
            let Some(view_width) = self.view_width.or(self.fit.as_ref().map(|_| 1.0)) else {
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
                elevation: None,
                distance: None,
            });
            let elevation = orbit.elevation.unwrap_or(default_elevation);
            let distance = match (orbit.distance, self.view_width) {
                (Some(d), _) => d,
                (None, None) if self.fit.is_some() => 1.0,
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
            (orbit.azimuth, elevation, distance)
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
            None if self.fit.is_some() => 1.0,
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
    /// Framing (Camera `camera@1`: framing): from the kept items' bounds, widened by
    /// `pad`, the view width (flat, orthographic) or the distance (perspective) that makes
    /// them span `fill` of the frame's shorter side, then the target that puts their centre
    /// at `place`. Closed form: in perspective the nearest corner sets the distance, so the
    /// bounds never spill past the fill and a symmetric box meets it exactly.
    pub fn frame(
        &mut self,
        rig: &mut Rig,
        bounds: [Vec3; 2],
        frame: [f64; 2],
        path: &str,
    ) -> Result<(), Refused> {
        let Some(fit) = self.fit.clone() else {
            return Ok(());
        };
        // The kept span, as a fraction of each side, must fit about `place`: framing never
        // pushes the subject out of the frame.
        let shorter = frame[0].min(frame[1]);
        let span = fit.fill * shorter;
        for (place, side) in fit.place.iter().zip(frame) {
            let half = span / 2.0 / side;
            if *place < half || *place > 1.0 - half {
                return Err(Refused::new(
                    "out_of_range",
                    format!("{path}/fit/place"),
                    "the kept items would leave the frame; move place in or lower fill",
                ));
            }
        }
        let extent = sub(bounds[1], bounds[0]);
        let low = sub(bounds[0], scale(extent, fit.pad));
        let high = add(bounds[1], scale(extent, fit.pad));
        let centre = scale(add(low, high), 0.5);
        let corners: Vec<Vec3> = (0..8)
            .map(|i| {
                [
                    if i & 1 == 0 { low[0] } else { high[0] },
                    if i & 2 == 0 { low[1] } else { high[1] },
                    if i & 4 == 0 { low[2] } else { high[2] },
                ]
            })
            .collect();
        // The screen basis: a flat page, or the view from the orbit's direction, turned by
        // the roll as the projector turns the frame (Projector::project).
        let (right, up, toward_eye) = if rig.flat {
            ([1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, -1.0])
        } else {
            let direction = orbit_direction(rig.azimuth, rig.elevation);
            let (right, up) = screen_basis(scale(direction, -1.0));
            (right, up, direction)
        };
        let (cos_roll, sin_roll) = (cos(rad(self.roll)), sin(rad(self.roll)));
        let (right, up) = (
            add(scale(right, cos_roll), scale(up, sin_roll)),
            add(scale(right, -sin_roll), scale(up, cos_roll)),
        );
        let coords: Vec<(f64, f64, f64)> = corners
            .iter()
            .map(|c| {
                let d = sub(*c, centre);
                (dot(d, right), dot(d, up), dot(d, toward_eye))
            })
            .collect();
        let half = span / 2.0;
        let (mut target, px_per_unit);
        if self.perspective() {
            let focal = (frame[0].max(frame[1]) / 2.0) / tan(rad(self.fov) / 2.0);
            // Each corner projects within the half span about the centre's image:
            // |r|·focal ÷ (d − depth) ≤ half. Then, the target moved by k·side·d ÷ focal to
            // put the centre at place, each corner's image (r − k·side·d ÷ focal)·focal ÷
            // (d − depth) must stay inside the frame, [−(½ + shift)·side, (½ − shift)·side]
            // about the frame's centre: linear in d, so the farthest corner sets it.
            let k = [
                0.5 + self.shift[0] - fit.place[0],
                fit.place[1] - 0.5 - self.shift[1],
            ];
            let inside = |value: f64, depth: f64, axis: usize| -> f64 {
                let side = frame[axis];
                let (lo, hi) = (
                    -(0.5 + self.shift[axis]) * side,
                    (0.5 - self.shift[axis]) * side,
                );
                // Screen y runs down while the target moves up by k·side·d ÷ focal, so the
                // offset enters the y image with the other sign.
                let k = if axis == 0 { k[0] } else { -k[1] };
                let under_hi = (value * focal + hi * depth) / (hi + k * side);
                let over_lo = (value * focal + lo * depth) / (lo + k * side);
                under_hi.max(over_lo)
            };
            let distance = coords
                .iter()
                .map(|(r, u, depth)| {
                    (depth + r.abs().max(u.abs()) * focal / half)
                        .max(inside(*r, *depth, 0))
                        .max(inside(-u, *depth, 1))
                })
                .fold(f64::MIN, f64::max)
                .max(f64::MIN_POSITIVE);
            rig.distance = distance;
            rig.view_width = 2.0 * distance * tan(rad(self.fov) / 2.0);
            target = centre;
            px_per_unit = focal / distance;
        } else {
            let (mut r0, mut r1, mut u0, mut u1) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
            for (r, u, _) in &coords {
                r0 = r0.min(*r);
                r1 = r1.max(*r);
                u0 = u0.min(*u);
                u1 = u1.max(*u);
            }
            let widest = (r1 - r0).max(u1 - u0).max(f64::MIN_POSITIVE);
            rig.view_width = frame[0] * widest / span;
            px_per_unit = frame[0] / rig.view_width;
            // The projected box's centre, not the bounds', is what lands at place.
            target = add(
                centre,
                add(scale(right, (r0 + r1) / 2.0), scale(up, (u0 + u1) / 2.0)),
            );
        }
        // Moving the target by a view-plane offset moves the centre's image the other way;
        // the shift moves the frame's centre, and place is a fraction of the frame itself.
        let dx = (0.5 + self.shift[0] - fit.place[0]) * frame[0] / px_per_unit;
        let dy = (fit.place[1] - 0.5 - self.shift[1]) * frame[1] / px_per_unit;
        target = add(target, add(scale(right, dx), scale(up, dy)));
        self.target = target;
        Ok(())
    }

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

/// Screen right and up for a view looking along `forward`, +Y up; straight up or down keeps
/// +X as right.
pub fn screen_basis(forward: Vec3) -> (Vec3, Vec3) {
    let mut right = normalize(cross(forward, [0.0, 1.0, 0.0]));
    if length(right) == 0.0 {
        right = [1.0, 0.0, 0.0];
    }
    (right, cross(right, forward))
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
            let (right, up) = screen_basis(forward);
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

    /// A step of screen right and screen down, as the frame is rolled, in the document's
    /// space on the view plane.
    pub fn screen_step(&self, right: f64, down: f64) -> Vec3 {
        let (ux, uy) = (
            right * self.cos_roll + down * self.sin_roll,
            -right * self.sin_roll + down * self.cos_roll,
        );
        sub(scale(self.right, ux), scale(self.up, uy))
    }

    /// Whether points project in perspective, so what lies behind the eye is not shown.
    pub fn is_perspective(&self) -> bool {
        self.perspective
    }

    /// Whether the document is flat, so every point is at one depth.
    pub fn is_flat(&self) -> bool {
        self.pose.flat
    }

    /// A point of the document in the view's frame: screen right, screen up and depth along
    /// the forward axis, from the eye (a flat document: from its target, in the page).
    pub fn to_view(&self, p: Vec3) -> Vec3 {
        let d = if self.pose.flat {
            sub(p, self.pose.target)
        } else {
            sub(p, self.pose.position)
        };
        [dot(d, self.right), dot(d, self.up), dot(d, self.forward)]
    }

    /// A direction of the document in the view's frame.
    pub fn direction_to_view(&self, d: Vec3) -> Vec3 {
        [dot(d, self.right), dot(d, self.up), dot(d, self.forward)]
    }

    /// Where a point of the document lands, or `None` behind a perspective eye.
    pub fn project(&self, p: Vec3) -> Option<Projected> {
        self.project_view(self.to_view(p))
    }

    /// Where a point of the view's frame lands, or `None` at or behind a perspective eye. A
    /// flat document's points are all at one depth, 1.
    pub fn project_view(&self, v: Vec3) -> Option<Projected> {
        let (xc, yc, zc) = (v[0], v[1], v[2]);
        let (x, y, depth, scale) = if self.perspective {
            if zc <= 0.0 {
                return None;
            }
            let s = self.scale / zc;
            (xc * s, -yc * s, zc, s)
        } else {
            let depth = if self.pose.flat { 1.0 } else { zc };
            (xc * self.scale, -yc * self.scale, depth, self.scale)
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

    /// A pixel's offset from the panel's centre, the view's roll taken out.
    fn unroll(&self, x: f64, y: f64) -> (f64, f64) {
        let (dx, dy) = (x - self.centre[0], y - self.centre[1]);
        (
            dx * self.cos_roll + dy * self.sin_roll,
            -dx * self.sin_roll + dy * self.cos_roll,
        )
    }

    /// The depth at which a pixel's line of sight meets the plane through `point` with
    /// `normal`, both in the view's frame: the plane's depth under that pixel, what a shape
    /// on it is drawn and picked by. A flat document's depth is 1 everywhere; a plane seen
    /// edge-on, which covers no pixel, answers its point's depth.
    pub fn depth_on_plane(&self, x: f64, y: f64, point: Vec3, normal: Vec3) -> f64 {
        if self.pose.flat {
            return 1.0;
        }
        let (ux, uy) = self.unroll(x, y);
        let (sx, sy) = (ux / self.scale, -uy / self.scale);
        if self.perspective {
            // The line from the eye through the pixel: t · (sx, sy, 1), at depth t.
            let along = dot(normal, [sx, sy, 1.0]);
            if along == 0.0 {
                return point[2];
            }
            dot(normal, point) / along
        } else {
            // The line through (sx, sy, 0) along the forward axis.
            if normal[2] == 0.0 {
                return point[2];
            }
            (dot(normal, point) - normal[0] * sx - normal[1] * sy) / normal[2]
        }
    }

    /// The point of a flat document under a pixel.
    pub fn unproject_flat(&self, x: f64, y: f64) -> [f64; 2] {
        let (ux, uy) = self.unroll(x, y);
        [
            self.pose.target[0] + ux / self.scale,
            self.pose.target[1] + uy / self.scale,
        ]
    }

    /// The point of the plane through the target, facing the eye, under a pixel of a 3D view.
    pub fn unproject_at_target(&self, x: f64, y: f64) -> Vec3 {
        let (ux, uy) = self.unroll(x, y);
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
    fn an_empty_fit_a_negative_pan_margin_and_a_negative_edge_rate_are_refused() {
        let params = json!({"projection": "orthographic", "fit": {"keep": []}});
        let err = read(params).unwrap_err();
        assert_eq!(err.path, "items/cam/params/fit/keep");
        for (user, path) in [
            (
                json!({"pan": {"margin": -0.6}}),
                "items/cam/params/user/pan/margin",
            ),
            (
                json!({"pan": {"edge": {"margin": 8, "rate": -0.5}}}),
                "items/cam/params/user/pan/edge",
            ),
            (
                json!({"zoom_rate": -0.01}),
                "items/cam/params/user/zoom_rate",
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

    #[test]
    fn a_fit_avoiding_an_overlay_is_refused_where_no_overlay_is_evaluated() {
        let err =
            read(json!({"projection": "orthographic", "fit": {"keep": ["r"], "avoid": "overlay"}}))
                .unwrap_err();
        assert_eq!(err.path, "items/cam/params/fit/avoid");
    }

    #[test]
    fn an_edge_pan_under_pivot_eye_is_refused() {
        let err =
            read(json!({"orbit": {"distance": 5}, "user": {"pivot": "eye", "pan": {"edge": {}}}}))
                .unwrap_err();
        assert_eq!(err.path, "items/cam/params/user/pan/edge");
    }

    #[test]
    fn an_isometric_camera_is_orthographic_at_the_isometric_elevation_and_takes_no_position() {
        let rig = spec(json!({"projection": "isometric", "view_width": 10}))
            .rig("items/cam/params")
            .unwrap();
        assert!(!rig.flat);
        assert_eq!(rig.azimuth, 45.0);
        assert!(
            (rig.elevation - 35.264_389_682_754_654).abs() < 1e-9,
            "{}",
            rig.elevation
        );
        let turned =
            spec(json!({"projection": "isometric", "view_width": 10, "orbit": {"azimuth": 135}}))
                .rig("items/cam/params")
                .unwrap();
        assert_eq!(turned.azimuth, 135.0);
        let err = read(json!({"projection": "isometric", "view_width": 10, "position": [1, 1, 1]}))
            .unwrap_err();
        assert_eq!(err.path, "items/cam/params/position");
        let err =
            read(json!({"projection": "isometric", "view_width": 10, "orbit": {"elevation": 10}}))
                .unwrap_err();
        assert_eq!(err.path, "items/cam/params/orbit/elevation");
    }
}
