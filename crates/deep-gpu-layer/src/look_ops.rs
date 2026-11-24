//! #463: a look's operator finish on the GPU (canvas primitives: Pack: art@1 painterly looks):
//! each `finish` entry that names a pass operator, `{"<op>@<major>": {params}}`, from the call's
//! packs or fx@1, checked and compiled before a frame draws and run in order over the look's
//! finished frame. Status marks and the legend keep the frame's own pixels: their boxes are
//! copied back after the passes, so a look never recolors status (The status-color rule).

use std::sync::{Arc, Mutex};

pub use deep_effects_render::look_ops::{of, Finish};
use serde_json::{json, Value};

use crate::{refused, Planted};

/// A pack look's definition: `name` (`art.mosaic`) in the `looks` of one of `manifests`.
pub fn pack_look(name: &str, manifests: &[Value]) -> Option<Value> {
    manifests.iter().find_map(|m| m["looks"].get(name)).cloned()
}

/// A look's definition from a call's value: the look@1 given, or an ID: a look of a pack the call
/// installs (`manifests`), else a shipped look. #463's planted `halftone_pop_takes_dot_passes`
/// draws `art.halftone_pop` with `art.dot`'s passes in its own colors.
pub fn def_of(v: &Value, manifests: &[Value], planted: Option<Planted>) -> Result<Value, Value> {
    let id = match v {
        Value::Object(_) => return Ok(v.clone()),
        Value::String(id) => id.as_str(),
        _ => {
            return Err(refused(
                "bad_input",
                "a look is a look@1 or the ID of a shipped look or a pack's look",
            ))
        }
    };
    pack_def(id, manifests, planted)
        .or_else(|| deep_canvas_marks::look::shipped(id))
        .ok_or_else(|| {
            refused(
                "look_unknown",
                format!("look: {id} is neither a shipped look nor a look of the call's packs"),
            )
        })
}

/// The pack look `id` as a call draws it (see [`def_of`] for the planted program).
pub fn pack_def(id: &str, manifests: &[Value], planted: Option<Planted>) -> Option<Value> {
    let def = pack_look(id, manifests)?;
    if planted == Some(Planted::HalftonePopTakesDotPasses) && id == "art.halftone_pop" {
        if let Some(mut dot) = pack_look("art.dot", manifests) {
            // Its own colors over dot's, so dot's passes still find the roles they draw with.
            for colors in ["palette", "roles"] {
                if let (Some(to), Some(from)) =
                    (dot[colors].as_object_mut(), def[colors].as_object())
                {
                    to.extend(from.clone());
                }
            }
            for colors in ["status", "themes"] {
                dot[colors] = def[colors].clone();
            }
            return Some(dot);
        }
    }
    Some(def)
}

/// A GPU profiler on the worker's device, for a surface that keeps none of its own.
pub fn profiler(app: &crate::App) -> Option<deep_scene3d_render::Profiler> {
    app.worker
        .call(|state| -> Result<deep_scene3d_render::Profiler, String> {
            let p = wgpu_profiler::GpuProfiler::new(&state.gpu.device().device, Default::default())
                .map_err(|e| e.to_string())?;
            Ok(Arc::new(Mutex::new(p)))
        })
        .ok()
}

/// `f`'s passes over `bytes` on the app's device (deep_effects_render::look_ops).
#[allow(clippy::too_many_arguments)]
pub fn apply(
    f: &Finish,
    app: &crate::App,
    profiler: Option<deep_scene3d_render::Profiler>,
    prefix: &str,
    bytes: &mut Vec<u8>,
    size: [u32; 2],
    keep: &[[f64; 4]],
    bgra: bool,
) -> Result<Option<f64>, Value> {
    if f.is_empty() {
        return Ok(None);
    }
    let (f, prefix, keep) = (f.clone(), prefix.to_string(), keep.to_vec());
    let before = std::mem::take(bytes);
    let (out, ms) = app
        .worker
        .call(move |state| {
            f.apply(
                &state.gpu.device(),
                profiler,
                &prefix,
                before,
                size,
                &keep,
                bgra,
            )
        })
        .map_err(|e| json!({"code": "render_failed", "path": "look/finish", "what": e}))?;
    *bytes = out;
    Ok(ms)
}
