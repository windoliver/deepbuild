//! Effect: dof (#468): an `effect@1` item of `kind: dof`, and the depth of field a frame draws
//! from it: a signed circle of confusion from the camera's lens, aperture and focus (or, for an
//! orthographic camera, from the distance to the focus plane times `ortho_coc`), with a tilt band
//! folded into it. The focus is evaluated at t from the item or distance it names, never smoothed
//! by an earlier frame, so seeking equals playing.

use deep_canvas::camera::Vec3;
use deep_canvas::ops::{atan, cos, deg, rad, sin};
use serde_json::Value;

use crate::lens::{self, Optics};
use crate::scene::{Camera, Refused};

/// What `focus` names: a distance in m, or an item (`ID` or `ID#anchor`).
#[derive(Clone, Debug, PartialEq)]
pub enum Focus {
    Distance(f64),
    Item(String),
}

/// Where a tilt band's centre line passes: through an item's projection, or a screen y in px.
#[derive(Clone, Debug, PartialEq)]
pub enum Centre {
    Item(String),
    Y(f64),
}

/// A tilt band's fields, as written.
#[derive(Clone, Debug, PartialEq)]
pub struct BandSpec {
    pub centre: Centre,
    /// The sharp band's full width and the ramp past it to `amount`, in px.
    pub width: f64,
    pub feather: f64,
    /// The band's tilt, in degrees from the frame's horizontal.
    pub angle: f64,
    /// The blur past the ramp, a circle of confusion's diameter in px.
    pub amount: f64,
}

/// A dof effect's fields (Effect: dof), as written.
#[derive(Clone, Debug, PartialEq)]
pub struct Spec {
    pub id: String,
    pub focus: Focus,
    pub max_coc: f64,
    pub taps: u32,
    /// `projection`: `Some(true)` orthographic, `Some(false)` perspective, `None` the camera's.
    pub orthographic: Option<bool>,
    /// px of circle of confusion per m from the focus plane, for an orthographic camera.
    pub ortho_coc: f64,
    pub band: Option<BandSpec>,
}

/// The tilt band at t, in frame px.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Band {
    /// A point on the centre line and the line's unit normal.
    pub at: [f64; 2],
    pub normal: [f64; 2],
    pub width: f64,
    pub feather: f64,
    pub amount: f64,
}

/// The depth of field a frame draws, evaluated at t.
#[derive(Clone, Debug, PartialEq)]
pub struct Dof {
    pub id: String,
    /// The focus distance in m, along the view axis from the eye.
    pub focus: f64,
    /// Perspective: the circle of confusion's diameter in px is `k × |d − s| ÷ d`.
    pub k: f64,
    pub orthographic: bool,
    pub ortho_coc: f64,
    pub max_coc: f64,
    pub taps: u32,
    pub blades: u32,
    pub band: Option<Band>,
}

fn bad(code: &'static str, path: String) -> Refused {
    Refused { code, path }
}

/// Reads an `effect@1`'s params of `kind: dof`.
pub fn parse(id: &str, params: &Value) -> Result<Spec, Refused> {
    let at = |k: &str| format!("items/{id}/params/dof/{k}");
    let d = params
        .get("dof")
        .filter(|d| d.is_object())
        .ok_or_else(|| bad("bad_input", format!("items/{id}/params/dof")))?;
    let num = |k: &str, default: f64, lo: f64, hi: f64| -> Result<f64, Refused> {
        match d.get(k) {
            None | Some(Value::Null) => Ok(default),
            Some(v) => v
                .as_f64()
                .filter(|x| x.is_finite() && *x >= lo && *x <= hi)
                .ok_or_else(|| bad("out_of_range", at(k))),
        }
    };
    let fixed = |k: &str, only: &str| -> Result<(), Refused> {
        match d.get(k) {
            None | Some(Value::Null) => Ok(()),
            Some(v) if v.as_str() == Some(only) => Ok(()),
            Some(_) => Err(bad("out_of_range", at(k))),
        }
    };
    fixed("coc", "physical")?;
    fixed("rotate", "pixel_hash")?;
    fixed("far_over_near", "refuse")?;
    let focus = match d.get("focus") {
        Some(Value::String(s)) if !s.is_empty() => Focus::Item(s.clone()),
        Some(v) => Focus::Distance(
            v.as_f64()
                .filter(|x| x.is_finite() && *x >= 0.0)
                .ok_or_else(|| bad("out_of_range", at("focus")))?,
        ),
        None => return Err(bad("bad_input", at("focus"))),
    };
    let taps = num("taps", 64.0, 64.0, 128.0)?;
    if ![64.0, 96.0, 128.0].contains(&taps) {
        return Err(bad("out_of_range", at("taps")));
    }
    let orthographic = match d.get("projection").and_then(Value::as_str) {
        None => None,
        Some("perspective") => Some(false),
        Some("orthographic") => Some(true),
        Some(_) => return Err(bad("out_of_range", at("projection"))),
    };
    let band = match d.get("band") {
        None | Some(Value::Null) => None,
        Some(b) => {
            let bt = |k: &str| format!("items/{id}/params/dof/band/{k}");
            let b = b
                .as_object()
                .ok_or_else(|| bad("out_of_range", at("band")))?;
            let n = |k: &str, default: Option<f64>| -> Result<f64, Refused> {
                match (b.get(k), default) {
                    (None | Some(Value::Null), Some(v)) => Ok(v),
                    (None | Some(Value::Null), None) => Err(bad("bad_input", bt(k))),
                    (Some(v), _) => v
                        .as_f64()
                        .filter(|x| x.is_finite() && (*x >= 0.0 || k == "angle"))
                        .ok_or_else(|| bad("out_of_range", bt(k))),
                }
            };
            let centre = match b.get("center") {
                Some(Value::String(s)) => Centre::Item(s.clone()),
                Some(v) => Centre::Y(
                    v.as_f64()
                        .filter(|x| x.is_finite())
                        .ok_or_else(|| bad("out_of_range", bt("center")))?,
                ),
                None => return Err(bad("bad_input", bt("center"))),
            };
            Some(BandSpec {
                centre,
                width: n("width", None)?,
                feather: n("feather", Some(0.0))?,
                angle: n("angle", Some(0.0))?,
                amount: n("amount", None)?,
            })
        }
    };
    Ok(Spec {
        id: id.to_string(),
        focus,
        max_coc: num("max_coc", 24.0, 0.0, 256.0)?,
        taps: taps as u32,
        orthographic,
        ortho_coc: num("ortho_coc", 0.0, 0.0, 1e6)?,
        band,
    })
}

/// The depth of field `spec` draws at t through `camera` with the camera's `optics`, `point`
/// giving an item's (or `ID#anchor`'s) world point at t, and `focus` the evaluated focus distance
/// when keys name it (a focus pull), else `None`.
pub fn resolve(
    spec: &Spec,
    camera: &Camera,
    optics: &Optics,
    focus: Option<f64>,
    point: impl Fn(&str) -> Option<Vec3>,
) -> Result<Dof, Refused> {
    let path = |k: &str| format!("items/{}/params/dof/{k}", spec.id);
    let depth = |handle: &str, k: &str| -> Result<f64, Refused> {
        let p = point(handle).ok_or_else(|| bad("ref_unresolved", path(k)))?;
        Ok(camera.to_view(p)[2])
    };
    let s = match (focus, &spec.focus) {
        (Some(f), _) => f,
        (None, Focus::Distance(m)) => *m,
        (None, Focus::Item(h)) => depth(h, "focus")?,
    };
    if s.is_nan() || s <= 0.0 {
        return Err(bad("out_of_range", path("focus")));
    }
    let orthographic = spec.orthographic.unwrap_or(!camera.perspective);
    // The focal length, from the lens or from the field of view on the default sensor.
    let fov = deg(2.0 * atan(camera.size[0].max(camera.size[1]) / 2.0 / camera.scale));
    let f_mm = optics
        .focal_length
        .unwrap_or_else(|| lens::implied_focal_length(fov, optics.sensor));
    let f = f_mm / 1000.0;
    // Sensor m per px, then the CoC on the sensor, f² |d − s| ÷ (N d (s − f)), over it.
    let pitch = optics.mm_per_px(camera.size) / 1000.0;
    let k = if s > f {
        f * f / (optics.f_stop * (s - f)) / pitch
    } else {
        0.0
    };
    let band = match &spec.band {
        None => None,
        Some(b) => {
            let y = match &b.centre {
                Centre::Y(y) => [camera.size[0] / 2.0, *y],
                Centre::Item(h) => {
                    let p = point(h).ok_or_else(|| bad("ref_unresolved", path("band/center")))?;
                    let q = camera
                        .project(p)
                        .ok_or_else(|| bad("out_of_range", path("band/center")))?;
                    [q[0], q[1]]
                }
            };
            let a = rad(b.angle);
            Some(Band {
                at: y,
                normal: [-sin(a), cos(a)],
                width: b.width,
                feather: b.feather,
                amount: b.amount,
            })
        }
    };
    Ok(Dof {
        id: spec.id.clone(),
        focus: s,
        k,
        orthographic,
        ortho_coc: spec.ortho_coc,
        max_coc: spec.max_coc,
        taps: spec.taps,
        blades: optics.blades,
        band,
    })
}

/// The focus distance at t when keys on `dof.focus` name items (a focus pull), else `None`:
/// between two keys it moves from the first key's distance to the second's, each item's taken at
/// t along the view, by the key's interpolation. Motion evaluates the keys to their index, eased
/// (`FocusKey`), and `point` gives each named item's world point at t.
pub(crate) fn pulled(
    program: &deep_canvas_motion::program::Program,
    spec: &Spec,
    evaluated: Option<f64>,
    camera: &Camera,
    point: impl Fn(&str) -> Option<Vec3>,
) -> Result<Option<f64>, Refused> {
    use deep_canvas_motion::doc::FocusKey;
    let Some(keys) = program.motion.channels.iter().find_map(|c| {
        (c.target.owner == spec.id && c.target.field == ["params", "dof", "focus"])
            .then_some(c.named.as_ref())
            .flatten()
    }) else {
        return Ok(None);
    };
    let path = format!("items/{}/params/dof/focus", spec.id);
    let distance = |k: &FocusKey| -> Result<f64, Refused> {
        match k {
            FocusKey::At(m) => Ok(*m),
            FocusKey::Item(h) => point(h)
                .map(|p| camera.to_view(p)[2])
                .ok_or_else(|| bad("ref_unresolved", path.clone())),
        }
    };
    let u = evaluated
        .unwrap_or(0.0)
        .clamp(0.0, keys.len().saturating_sub(1) as f64);
    let k = (u.floor() as usize).min(keys.len().saturating_sub(1));
    let a = distance(&keys[k])?;
    if k + 1 >= keys.len() {
        return Ok(Some(a));
    }
    let w = u - k as f64;
    if w == 0.0 {
        return Ok(Some(a));
    }
    let b = distance(&keys[k + 1])?;
    Ok(Some(a + (b - a) * w))
}
