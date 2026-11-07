//! The `tone` call (issue #418; tests/acceptance/418/README.md: tone): the look's tone map as the
//! frame's output pass runs it, on this machine's GPU, over every pixel of an f32 RGBA file with
//! no exposure, read back before the sRGB encode: the analytic fixtures' surface. With `grade`
//! (#464), the look's grade runs inside the pass, as the frame's output runs it.

use deep_canvas_scene3d::look::Look3;
use serde_json::{json, Value};

use crate::view3d::{pair, write_named};
use crate::{refused, App};

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    let map = match Look3::read(&json!({"tone_map": call["tone_map"]})) {
        Ok(l) => l.tone_map,
        Err(e) => return refused("bad_input", e),
    };
    // #464: the grade, applied inside the pass as the output applies it.
    let grade = match deep_canvas_marks::finish::read_grade(call.get("grade")) {
        Ok(g) => g,
        Err(e) => return refused("bad_input", e),
    };
    let Some(size) = pair(&call["size"]).filter(|s| s[0] > 0 && s[1] > 0) else {
        return refused("bad_input", "size is [w, h]");
    };
    let Some(bytes) = call["input"]
        .as_str()
        .and_then(|p| std::fs::read(p).ok())
        .filter(|b| b.len() == (size[0] * size[1] * 16) as usize)
    else {
        return refused("bad_input", "input is a w × h f32 RGBA file");
    };
    let input: Vec<f32> = bytes
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect();
    let output = app.worker.call(move |state| {
        let device = state.gpu.device();
        deep_scene3d_render::tone(&device, map, &grade, &input, size)
    });
    let Some(output) = output else {
        return refused("unsupported_platform", "no pixels");
    };
    match write_named(out, &output, "f32") {
        Ok(name) => json!({"output": name}),
        Err(e) => e,
    }
}
