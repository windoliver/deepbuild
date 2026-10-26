//! The `guard` call (issue #382; tests/acceptance/382/README.md, The surface under test): the
//! status guard's pass alone, on this machine's GPU, over an f32 image of display-referred,
//! sRGB-encoded pixels, as the finished frame of a document where status can show; the result as
//! an f32 file of the same shape, named by its hash, with the count of pixels moved.

use deep_gpu::device::Backend;
use deep_scene3d_render::status::{Mode, Stage};
use serde_json::{json, Map, Value};

use crate::status;
use crate::view3d::{pair, write_named};
use crate::{refused, App, Planted};

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    match run(app, out, call) {
        Ok(v) | Err(v) => v,
    }
}

fn run(app: &mut App, out: &str, call: &Value) -> Result<Value, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let theme = status::theme_of(call)?;
    let look = status::themed(&call["look"], &theme);
    let status = status::status_of(&look)?.ok_or_else(|| bad("look has no status map"))?;
    let size = pair(&call["size"])
        .filter(|s| s[0] > 0 && s[1] > 0)
        .ok_or_else(|| bad("size is [w, h]"))?;
    let path = call["input"]
        .as_str()
        .ok_or_else(|| bad("input is a path"))?;
    let input = std::fs::read(path).map_err(|e| bad(&format!("input: {e}")))?;
    if input.len() != (size[0] as usize) * (size[1] as usize) * 16 {
        return Err(bad("input holds w × h f32 RGBA pixels"));
    }
    if app.backend == Backend::Noop || !cfg!(target_os = "macos") {
        return Err(refused(
            "unsupported_platform",
            "the guard runs on the reference platform's Metal device",
        ));
    }
    let distance = match app.planted {
        Some(Planted::GuardHalfDistance) => status.min_distance / 2.0,
        _ => status.min_distance,
    };
    let mode = match app.planted {
        Some(Planted::GuardToGrey) => Mode::Grey,
        _ => Mode::Line,
    };
    let guard = status::guard_of(&status, distance, mode);
    let (bytes, moved) = app
        .worker
        .call(move |state| -> Result<(Vec<u8>, u32), String> {
            let device = state.gpu.recover()?;
            let mut stage = Stage::new(&device);
            stage
                .guard_image(&device, &guard, &input, size)
                .ok_or_else(|| "the guard's output didn't read back".to_string())
        })
        .map_err(|e| refused("render_failed", e))?;
    let output = write_named(out, &bytes, "f32")?;
    // The status map as the image holds colors: sRGB-encoded in [0, 1].
    let colors: Map<String, Value> = status
        .colors
        .iter()
        .map(|(s, c)| (s.to_string(), json!(c.map(|v| f64::from(v) / 255.0))))
        .collect();
    Ok(json!({
        "output": output,
        "pixels_moved": moved,
        "distance": status.min_distance,
        "colors": colors,
    }))
}
