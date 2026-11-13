//! Samples per frame and motion blur (#419; canvas primitives: Look `look@1`: samples, Motion
//! blur, Motion blur: velocity): what a frame's sub-samples are, each a pure function of its
//! index alone, so a frame is a function of the document, t and N, and nothing comes from an
//! earlier frame.

use serde_json::Value;

/// The reconstruction filter each sub-sample is weighted by.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Filter {
    Box,
    BlackmanHarris,
}

/// What a sub-sample's index varies.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Vary {
    pub pixel: bool,
    pub lens: bool,
    pub light: bool,
    pub time: bool,
}

/// Look: samples.
#[derive(Clone, Debug, PartialEq)]
pub struct Samples {
    pub live: u32,
    pub export: u32,
    /// `at_rest: settle`: a live view adds samples while it rests until it reaches `export`.
    pub settle: bool,
    pub filter: Filter,
    pub filter_px: f64,
    pub vary: Vary,
}

impl Default for Samples {
    fn default() -> Samples {
        Samples {
            live: 1,
            export: 16,
            settle: false,
            filter: Filter::BlackmanHarris,
            filter_px: 1.5,
            vary: Vary {
                pixel: true,
                ..Vary::default()
            },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    Samples,
    Velocity,
}

/// Motion blur, and its velocity method.
#[derive(Clone, Debug, PartialEq)]
pub struct Blur {
    /// Degrees of the frame interval the shutter stays open, centred on the frame's time.
    pub shutter_angle: f64,
    pub samples: u32,
    /// Skip an item whose travel over the shutter is under half a pixel.
    pub adaptive: bool,
    pub exclude: Vec<String>,
    pub preview_cap: Option<u32>,
    pub method: Method,
    pub taps: u32,
    pub max_px: f64,
    pub tile_px: u32,
}

impl Default for Blur {
    fn default() -> Blur {
        Blur {
            shutter_angle: 180.0,
            samples: 8,
            adaptive: true,
            exclude: Vec::new(),
            preview_cap: None,
            method: Method::Samples,
            taps: 16,
            max_px: 32.0,
            tile_px: 20,
        }
    }
}

impl Blur {
    /// The shutter in seconds at `fps`.
    pub fn shutter_s(&self, fps: f64) -> f64 {
        self.shutter_angle / 360.0 / fps
    }
}

/// One sub-sample: its pixel offset from the frame's centre (px right and down), its filter
/// weight, its shutter offset as a share of the shutter in [−½, ½], and its lens and light
/// positions in [0, 1)².
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sub {
    pub offset: [f64; 2],
    pub weight: f64,
    pub time: f64,
    pub lens: [f64; 2],
    pub light: [f64; 2],
}

/// The R2 sequence's k-th point in [0, 1)²: offsets come from the sample index alone.
pub fn r2(k: u32) -> [f64; 2] {
    // The plastic number's two powers (Roberts, 2018).
    const A1: f64 = 0.754_877_666_246_692_8;
    const A2: f64 = 0.569_840_290_998_053_3;
    let k = f64::from(k);
    [(0.5 + A1 * k).fract(), (0.5 + A2 * k).fract()]
}

/// A four-term Blackman–Harris window at x in [0, 1].
fn blackman_harris(x: f64) -> f64 {
    use deep_canvas::ops::cos;
    use std::f64::consts::TAU;
    0.35875 - 0.48829 * cos(TAU * x) + 0.14128 * cos(2.0 * TAU * x) - 0.01168 * cos(3.0 * TAU * x)
}

/// The `n` sub-samples of a frame, `pixel` of them jittered across the pixel (the look's own
/// count; the rest are motion blur's shutter times). Sample 0 sits at the pixel's centre and the frame's time, so
/// a one-sample frame is the plain frame.
pub fn plan(n: u32, pixel: u32, s: &Samples, blur: bool) -> Vec<Sub> {
    let n = n.max(1);
    (0..n)
        .map(|k| {
            let [u, v] = r2(k);
            let (offset, weight) = if !s.vary.pixel || pixel <= 1 {
                ([0.0, 0.0], 1.0)
            } else {
                match s.filter {
                    Filter::Box => ([u - 0.5, v - 0.5], 1.0),
                    Filter::BlackmanHarris => (
                        [(u - 0.5) * s.filter_px, (v - 0.5) * s.filter_px],
                        blackman_harris(u) * blackman_harris(v),
                    ),
                }
            };
            // Stratified over the shutter, centred: sample k at the middle of its stratum, in an
            // order that keeps every prefix spread across the shutter.
            let time = if blur && n > 1 {
                (f64::from(k) + 0.5) / f64::from(n) - 0.5
            } else {
                0.0
            };
            let lens = if s.vary.lens { r2(k + 7) } else { [0.5, 0.5] };
            let light = if s.vary.light { r2(k + 13) } else { [0.5, 0.5] };
            Sub {
                offset,
                weight,
                time,
                lens,
                light,
            }
        })
        .collect()
}

fn num(o: &serde_json::Map<String, Value>, k: &str) -> Result<Option<f64>, String> {
    match o.get(k) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v.as_f64().map(Some).ok_or(format!("{k} is a number")),
    }
}

fn count(
    o: &serde_json::Map<String, Value>,
    k: &str,
    max: u64,
    what: &str,
) -> Result<Option<u32>, String> {
    match o.get(k) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => match v.as_u64() {
            Some(n @ 1..) if n <= max => Ok(Some(n as u32)),
            _ => Err(format!("{what} is 1 to {max}")),
        },
    }
}

/// A look's `samples`, `filter`, `filter_px`, `vary` and `sequence`.
pub fn read_samples(look: &Value) -> Result<Samples, String> {
    let mut s = Samples::default();
    match look.get("samples") {
        None | Some(Value::Null) => {}
        Some(Value::Object(o)) => {
            if let Some(n) = count(o, "live", 256, "samples.live")? {
                s.live = n;
            }
            if let Some(n) = count(o, "export", 256, "samples.export")? {
                s.export = n;
            }
            s.settle = match o.get("at_rest").and_then(Value::as_str) {
                None | Some("none") => false,
                Some("settle") => true,
                Some(other) => {
                    return Err(format!("samples.at_rest: {other} is not none or settle"));
                }
            };
        }
        Some(_) => return Err("samples is an object".into()),
    }
    let o = look.as_object().cloned().unwrap_or_default();
    s.filter = match o.get("filter").and_then(Value::as_str) {
        None | Some("blackman_harris") => Filter::BlackmanHarris,
        Some("box") => Filter::Box,
        Some(other) => return Err(format!("filter: {other} is not box or blackman_harris")),
    };
    if let Some(px) = num(&o, "filter_px")? {
        if !(px > 0.0 && px <= 8.0) {
            return Err("filter_px is above 0 and at most 8".into());
        }
        s.filter_px = px;
    }
    if let Some(v) = o.get("vary") {
        let list = v.as_array().ok_or("vary is a list")?;
        s.vary = Vary::default();
        for d in list {
            match d.as_str() {
                Some("pixel") => s.vary.pixel = true,
                Some("lens") => s.vary.lens = true,
                Some("light") => s.vary.light = true,
                Some("time") => s.vary.time = true,
                _ => return Err(format!("vary: {d} is not pixel, lens, light or time")),
            }
        }
    }
    match o.get("sequence").and_then(Value::as_str) {
        None | Some("r2") => {}
        Some(other) => return Err(format!("sequence: {other} is not r2")),
    }
    Ok(s)
}

/// A look's `motion_blur`, or `None` with it off.
pub fn read_blur(look: &Value) -> Result<Option<Blur>, String> {
    let o = match look.get("motion_blur") {
        None | Some(Value::Null) | Some(Value::Bool(false)) => return Ok(None),
        Some(Value::String(s)) if s == "none" => return Ok(None),
        Some(Value::Bool(true)) => return Ok(Some(Blur::default())),
        Some(Value::Object(o)) => o,
        Some(_) => return Err("motion_blur is none or an object".into()),
    };
    let mut b = Blur::default();
    if let Some(a) = num(o, "shutter_angle")? {
        if !(a > 0.0 && a <= 360.0) {
            return Err("motion_blur.shutter_angle is above 0° and at most 360°".into());
        }
        b.shutter_angle = a;
    }
    match o.get("phase").and_then(Value::as_str) {
        None | Some("centred") | Some("centered") => {}
        Some(other) => return Err(format!("motion_blur.phase: {other} is not centred")),
    }
    match o.get("scope").and_then(Value::as_str) {
        None | Some("declared moves") | Some("declared_moves") => {}
        Some(other) => return Err(format!("motion_blur.scope: {other} is not declared moves")),
    }
    if let Some(n) = count(o, "samples", 255, "motion_blur.samples")? {
        b.samples = n;
    }
    if let Some(a) = o.get("adaptive") {
        b.adaptive = a.as_bool().ok_or("motion_blur.adaptive is true or false")?;
    }
    if let Some(e) = o.get("exclude") {
        b.exclude = e
            .as_array()
            .ok_or("motion_blur.exclude is a list of IDs")?
            .iter()
            .map(|v| {
                v.as_str()
                    .map(str::to_string)
                    .ok_or("motion_blur.exclude is a list of IDs")
            })
            .collect::<Result<_, _>>()?;
    }
    b.preview_cap = count(o, "preview_cap", 255, "motion_blur.preview_cap")?;
    b.method = match o.get("method").and_then(Value::as_str) {
        None | Some("samples") => Method::Samples,
        Some("velocity") => Method::Velocity,
        Some(other) => {
            return Err(format!(
                "motion_blur.method: {other} is not samples or velocity"
            ));
        }
    };
    if let Some(v) = o.get("velocity").and_then(Value::as_object) {
        if let Some(n) = count(v, "taps", 255, "motion_blur.velocity.taps")? {
            b.taps = n;
        }
        if let Some(px) = num(v, "max")? {
            b.max_px = px;
        }
        if let Some(n) = count(v, "tile", 255, "motion_blur.velocity.tile")? {
            b.tile_px = n;
        }
    }
    Ok(Some(b))
}

/// The reading holds of a document (Marker: `kind: hold`), each [start, end] in flicks: motion
/// blur never spans one.
pub fn holds(doc: &Value) -> Vec<(i64, i64)> {
    let Some(map) = doc.as_object() else {
        return Vec::new();
    };
    let Ok(program) = deep_canvas_motion::program::Program::compile(map) else {
        return Vec::new();
    };
    program
        .motion
        .markers
        .iter()
        .filter(|m| m.kind == "hold")
        .map(|m| (m.start, m.end))
        .collect()
}
