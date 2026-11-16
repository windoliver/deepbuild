//! Camera `camera@1`: lens (#468): the lens, aperture, shutter and ISO scene3d contributes to the
//! core's camera. Field of view and exposure follow from them in closed form, and depth of field
//! reads the same aperture: a circle of confusion c = f² × |d − s| ÷ (N × d × (s − f)) on the
//! sensor (dof.rs). Nothing here keeps a frame's history.

use deep_canvas::ops::{atan, deg, log2, rad, tan};
use serde_json::{Map, Value};

use crate::scene::Refused;

/// Which side of the sensor spans which side of the frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fit {
    /// The sensor's width spans the frame's width.
    Horizontal,
    /// The sensor's height spans the frame's height.
    Vertical,
    /// The sensor's wider side spans the frame's wider side.
    Wider,
}

/// The camera's optics at t (Camera `camera@1`: lens): the lens when one is given, and the
/// aperture, shutter and ISO with their defaults.
#[derive(Clone, Debug, PartialEq)]
pub struct Optics {
    /// `lens.focal_length` in mm, `None` without a lens.
    pub focal_length: Option<f64>,
    /// mm, `[36, 24]` by default.
    pub sensor: [f64; 2],
    pub fit: Fit,
    /// `lens.shift`, fractions of the sensor's width and height.
    pub shift: [f64; 2],
    pub f_stop: f64,
    /// 0 for a round aperture, else its sides.
    pub blades: u32,
    pub shutter_angle: f64,
    pub iso: f64,
    pub exposure: Option<Exposure>,
}

/// The camera's `exposure`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Exposure {
    Ev100(f64),
    FromLens,
}

impl Default for Optics {
    fn default() -> Self {
        Optics {
            focal_length: None,
            sensor: [36.0, 24.0],
            fit: Fit::Wider,
            shift: [0.0, 0.0],
            f_stop: 5.6,
            blades: 0,
            shutter_angle: 180.0,
            iso: 100.0,
            exposure: None,
        }
    }
}

fn bad(path: String) -> Refused {
    Refused {
        code: "out_of_range",
        path,
    }
}

/// A positive finite number at `v`, or `default` when it's left out.
fn positive(v: Option<&Value>, path: String, default: f64) -> Result<f64, Refused> {
    match v {
        None | Some(Value::Null) => Ok(default),
        Some(v) => v
            .as_f64()
            .filter(|x| x.is_finite() && *x > 0.0)
            .ok_or_else(|| bad(path)),
    }
}

/// Reads the camera's `lens`, `aperture`, `shutter`, `iso` and `exposure` from its params at t,
/// `path` being `items/<id>/params`. `fov_given` says whether the camera's own params set `fov`:
/// giving both a lens and a field of view is an error.
pub fn read(params: &Map<String, Value>, path: &str, fov_given: bool) -> Result<Optics, Refused> {
    let at = |k: &str| format!("{path}/{k}");
    let mut o = Optics::default();
    if let Some(lens) = params.get("lens").filter(|v| !v.is_null()) {
        let lens = lens.as_object().ok_or_else(|| bad(at("lens")))?;
        if fov_given {
            return Err(bad(at("fov")));
        }
        let f = lens
            .get("focal_length")
            .and_then(Value::as_f64)
            .filter(|x| x.is_finite() && *x > 0.0)
            .ok_or_else(|| bad(at("lens/focal_length")))?;
        o.focal_length = Some(f);
        if let Some(s) = lens.get("sensor").filter(|v| !v.is_null()) {
            let pair = s
                .as_array()
                .filter(|a| a.len() == 2)
                .and_then(|a| Some([a[0].as_f64()?, a[1].as_f64()?]))
                .filter(|p| p.iter().all(|x| x.is_finite() && *x > 0.0))
                .ok_or_else(|| bad(at("lens/sensor")))?;
            o.sensor = pair;
        }
        o.fit = match lens.get("fit").and_then(Value::as_str) {
            None | Some("wider") => Fit::Wider,
            Some("horizontal") => Fit::Horizontal,
            Some("vertical") => Fit::Vertical,
            Some(_) => return Err(bad(at("lens/fit"))),
        };
        if let Some(s) = lens.get("shift").filter(|v| !v.is_null()) {
            o.shift = s
                .as_array()
                .filter(|a| a.len() == 2)
                .and_then(|a| Some([a[0].as_f64()?, a[1].as_f64()?]))
                .filter(|p| p.iter().all(|x| x.is_finite()))
                .ok_or_else(|| bad(at("lens/shift")))?;
        }
    }
    if let Some(a) = params.get("aperture").filter(|v| !v.is_null()) {
        let a = a.as_object().ok_or_else(|| bad(at("aperture")))?;
        o.f_stop = positive(a.get("f_stop"), at("aperture/f_stop"), 5.6)?;
        o.blades = match a.get("blades") {
            None | Some(Value::Null) => 0,
            Some(b) => b
                .as_u64()
                .filter(|&b| b == 0 || (3..=255).contains(&b))
                .ok_or_else(|| bad(at("aperture/blades")))? as u32,
        };
    }
    if let Some(s) = params.get("shutter").filter(|v| !v.is_null()) {
        let s = s.as_object().ok_or_else(|| bad(at("shutter")))?;
        o.shutter_angle = positive(s.get("angle"), at("shutter/angle"), 180.0)?;
        if o.shutter_angle > 360.0 {
            return Err(bad(at("shutter/angle")));
        }
    }
    o.iso = positive(params.get("iso"), at("iso"), 100.0)?;
    o.exposure = match params.get("exposure") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) if s == "from_lens" => Some(Exposure::FromLens),
        Some(v) => Some(Exposure::Ev100(
            v.as_f64()
                .filter(|x| x.is_finite())
                .ok_or_else(|| bad(at("exposure")))?,
        )),
    };
    Ok(o)
}

impl Optics {
    /// The sensor's side the fit spans and the frame's side it spans, in mm and px.
    fn spans(&self, frame: [f64; 2]) -> (f64, f64) {
        match self.fit {
            Fit::Horizontal => (self.sensor[0], frame[0]),
            Fit::Vertical => (self.sensor[1], frame[1]),
            Fit::Wider => (self.sensor[0].max(self.sensor[1]), frame[0].max(frame[1])),
        }
    }

    /// The field of view across the frame's wider side, the core camera's `fov`, on a frame of
    /// `frame` px: the fit's field of view carried to that side through the frame's pixels.
    pub fn fov(&self, frame: [f64; 2]) -> Option<f64> {
        let f = self.focal_length?;
        let (mm, px) = self.spans(frame);
        let wider = frame[0].max(frame[1]);
        Some(deg(2.0 * atan(mm / (2.0 * f) * wider / px)))
    }

    /// Sensor mm per frame px.
    pub fn mm_per_px(&self, frame: [f64; 2]) -> f64 {
        let (mm, px) = self.spans(frame);
        mm / px
    }

    /// `lens.shift` as the core camera's `shift`, fractions of the frame.
    pub fn frame_shift(&self, frame: [f64; 2]) -> [f64; 2] {
        let pitch = self.mm_per_px(frame);
        [
            self.shift[0] * self.sensor[0] / pitch / frame[0],
            self.shift[1] * self.sensor[1] / pitch / frame[1],
        ]
    }

    /// EV100 from the lens: log2(N² ÷ t) − log2(ISO ÷ 100), t = angle ÷ (360 × frame rate).
    pub fn lens_ev100(&self, frame_rate: f64) -> f64 {
        let t = self.shutter_angle / (360.0 * frame_rate);
        log2(self.f_stop * self.f_stop / t) - log2(self.iso / 100.0)
    }

    /// The camera's exposure as an EV100, if it sets one.
    pub fn ev100(&self, frame_rate: f64) -> Option<f64> {
        match self.exposure? {
            Exposure::Ev100(ev) => Some(ev),
            Exposure::FromLens => Some(self.lens_ev100(frame_rate)),
        }
    }
}

/// The focal length in mm a camera without a lens implies: the default sensor's wider side
/// across a field of view of `fov` degrees on the frame's wider side.
pub fn implied_focal_length(fov: f64, sensor: [f64; 2]) -> f64 {
    sensor[0].max(sensor[1]) / (2.0 * tan(rad(fov) / 2.0))
}
