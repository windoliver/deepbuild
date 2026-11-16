//! A view's HDR output in the GPU layer's runs (issue #177; canvas primitives: GPU surface: HDR
//! output; tests/acceptance/177/README.md, "deep-gpu: the stub display and the view's HDR
//! output"). `hdr: auto | off` is the view's session state; `auto` presents a live 3D view that
//! draws first and opaque through an HDR surface on a display whose potential EDR headroom is
//! above 1, its tone map rolled off to the display's current headroom. The headless window has
//! no display that reports EDR, so test-meter builds stand one in (`stub_display`), whose current
//! headroom reads 1 until something asks for EDR and then follows the changes it posts. The
//! current headroom is read when the HDR surface first shows and when the display posts a change,
//! never per frame. An export, render-back or golden never reaches any of it.

use std::sync::Mutex;

use serde_json::{json, Value};

use crate::session3::lock;
use crate::{refused, App, Planted};

/// The display seam's test backend (test-meter builds): its potential headroom, its current one
/// once asked for EDR, and the changes it posts before frames latch.
#[derive(Clone, Debug)]
pub struct StubDisplay {
    potential: f32,
    headroom: f32,
    posts: Vec<(u64, f32)>,
}

/// The view's HDR state for a call.
#[derive(Clone, Debug, Default)]
pub struct Hdr {
    auto: bool,
    display: Option<StubDisplay>,
    /// The current headroom as last read: when the surface first showed, then at each post.
    read: Option<f32>,
}

impl Hdr {
    pub fn parse(call: &Value) -> Result<Hdr, Value> {
        let bad = |what: &str| refused("bad_input", what);
        let auto = match call.get("hdr") {
            None | Some(Value::Null) => true,
            Some(v) if v == "auto" => true,
            Some(v) if v == "off" => false,
            Some(_) => return Err(bad("hdr is auto or off")),
        };
        let display = match call.get("stub_display") {
            None | Some(Value::Null) => None,
            Some(d) => Some(stub(d).ok_or_else(|| {
                bad("stub_display is {potential, headroom, posts?: [{frame, headroom}]}")
            })?),
        };
        #[cfg(not(feature = "test-meter"))]
        if display.is_some() {
            return Err(bad("stub_display is a test-meter build's display seam"));
        }
        Ok(Hdr {
            auto,
            display,
            read: None,
        })
    }

    /// The headroom frame `n` rolls off to while it presents HDR, or `None` when it presents SDR:
    /// `hdr` is auto, the view draws first and opaque, the display's potential headroom is above 1
    /// and its current one, read once the surface shows and at each posted change, is too.
    pub fn frame(&mut self, n: u64, opaque: bool, planted: Option<Planted>) -> Option<f32> {
        let d = self.display.as_ref()?;
        let qualifies = opaque || planted == Some(Planted::CatcherViewGoesHdr);
        if !self.auto || !qualifies || d.potential <= 1.0 {
            return None;
        }
        // Showing the surface asks for EDR, so the current headroom is read then; afterwards
        // only a change the display posted before this frame is read again.
        let posted = d
            .posts
            .iter()
            .filter(|(at, _)| *at <= n)
            .last()
            .map(|p| p.1);
        let current = match (self.read, posted) {
            (None, _) => posted.unwrap_or(d.headroom),
            (Some(_), Some(h)) if planted != Some(Planted::ReadsHeadroomOnce) => h,
            (Some(h), _) => h,
        };
        self.read = Some(current);
        (current > 1.0).then_some(current)
    }
}

fn stub(d: &Value) -> Option<StubDisplay> {
    let posts = match d.get("posts") {
        None | Some(Value::Null) => Vec::new(),
        Some(p) => p
            .as_array()?
            .iter()
            .map(|p| Some((p["frame"].as_u64()?, p["headroom"].as_f64()? as f32)))
            .collect::<Option<_>>()?,
    };
    Some(StubDisplay {
        potential: d["potential"].as_f64()? as f32,
        headroom: d["headroom"].as_f64()? as f32,
        posts,
    })
}

/// The headroom a live view last presented HDR at in this run, which only the planted export
/// reads.
static SHOWN: Mutex<Option<f32>> = Mutex::new(None);

pub fn shown(headroom: f32) {
    *SHOWN.lock().unwrap_or_else(|e| e.into_inner()) = Some(headroom);
}

/// An export, a render-back or a golden draws SDR and never reads the HDR surface; the planted
/// twin draws from it at the headroom a live view last presented.
pub fn export_headroom(planted: Option<Planted>) -> Option<f32> {
    (planted == Some(Planted::ExportReadsHdrSurface))
        .then(|| *SHOWN.lock().unwrap_or_else(|e| e.into_inner()))
        .flatten()
}

/// The planted export's frame: the HDR surface's values, clipped and encoded to 8-bit BGRA.
pub fn to_sdr(f16: &[u8], bgra: &mut [u8]) {
    for (px, t) in bgra.chunks_exact_mut(4).zip(f16.chunks_exact(8)) {
        for (i, c) in [2, 1, 0].into_iter().enumerate() {
            let v = half(u16::from_le_bytes([t[c * 2], t[c * 2 + 1]]));
            px[i] = (deep_canvas_marks::finish::srgb_encode(f64::from(v)) * 255.0).round() as u8;
        }
    }
}

/// The view's next frames present through the HDR surface rolled off to `headroom`, or SDR.
pub fn present(app: &mut App, headroom: Option<f32>, size: [u32; 2]) -> Result<(), Value> {
    app.worker
        .call(move |state| -> Result<(), String> {
            let s = state.scene3d.as_mut().ok_or("no session")?;
            let device = s.view.device().clone();
            let mut shared = lock(&s.shared);
            shared.hdr = match headroom {
                None => None,
                Some(headroom) => {
                    if s.hdr
                        .as_ref()
                        .is_none_or(|t| [t.width(), t.height()] != size)
                    {
                        s.hdr = Some(deep_scene3d_render::hdr::offscreen(&device, size));
                    }
                    let into = s
                        .hdr
                        .as_ref()
                        .expect("made above")
                        .create_view(&Default::default());
                    Some(deep_scene3d_render::HdrFrame { into, headroom })
                }
            };
            Ok(())
        })
        .map_err(|e| refused("no_session", e))
}

/// The HDR surface's last frame: little-endian f16 RGBA.
pub fn read(app: &mut App) -> Option<Vec<u8>> {
    app.worker.call(|state| {
        let s = state.scene3d.as_ref()?;
        deep_scene3d_render::hdr::read(s.view.device(), s.hdr.as_ref()?)
    })
}

/// The `surface` target's description and file: what the view presented this frame.
pub fn surface_json(out: &str, hdr: Option<&[u8]>, sdr: &[u8]) -> Result<Value, Value> {
    Ok(match hdr {
        Some(f16) => {
            json!({"format": "rgba16float", "color_space": "extended_linear_srgb", "edr": true,
            "file": crate::view3d::write_named(out, f16, "bin")?})
        }
        None => json!({"format": "bgra8unorm", "color_space": "srgb", "edr": false,
            "file": crate::view3d::write_named(out, sdr, "bin")?}),
    })
}

/// IEEE 754 binary16 to f32.
fn half(h: u16) -> f32 {
    let sign = if h & 0x8000 != 0 { -1.0 } else { 1.0 };
    let exp = i32::from((h >> 10) & 0x1f);
    let man = f32::from(h & 0x3ff);
    match exp {
        0 => sign * man * 2f32.powi(-24),
        31 if man == 0.0 => sign * f32::INFINITY,
        31 => f32::NAN,
        e => sign * (1.0 + man / 1024.0) * 2f32.powi(e - 15),
    }
}

fn decode(c: u8) -> f32 {
    deep_canvas_marks::finish::srgb_decode(f64::from(c) / 255.0) as f32
}

/// The window as the compositor composites its layers, in extended linear sRGB as little-endian
/// f32 RGBA: GPUI's layer (`window`, 8-bit sRGB RGBA, premultiplied) over the HDR surface's
/// layer beneath it at the view's place, or with the planted stack the HDR layer above GPUI's.
pub fn composite(
    window: &image::RgbaImage,
    hdr: Option<(&[u8], [u32; 2], [u32; 2])>,
    planted: Option<Planted>,
) -> Vec<u8> {
    let (w, h) = window.dimensions();
    let above = planted == Some(Planted::HdrLayerAboveChrome);
    let mut out = Vec::with_capacity((w * h * 16) as usize);
    for y in 0..h {
        for x in 0..w {
            let c = window.get_pixel(x, y).0;
            let a = f32::from(c[3]) / 255.0;
            let gpui = [decode(c[0]), decode(c[1]), decode(c[2])];
            let under = hdr.and_then(|(texels, at, size)| {
                let (vx, vy) = (x.checked_sub(at[0])?, y.checked_sub(at[1])?);
                if vx >= size[0] || vy >= size[1] {
                    return None;
                }
                let o = ((vy * size[0] + vx) * 8) as usize;
                let ch = |i: usize| half(u16::from_le_bytes([texels[o + i], texels[o + i + 1]]));
                Some([ch(0), ch(2), ch(4), ch(6)])
            });
            let px = match under {
                Some(v) if above => [v[0], v[1], v[2], 1.0],
                Some(v) => {
                    let k = 1.0 - a;
                    [
                        gpui[0] + k * v[0],
                        gpui[1] + k * v[1],
                        gpui[2] + k * v[2],
                        1.0,
                    ]
                }
                None => [gpui[0], gpui[1], gpui[2], a],
            };
            for v in px {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
    }
    out
}
