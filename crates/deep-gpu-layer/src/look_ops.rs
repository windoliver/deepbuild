//! #463: a look's operator finish on the GPU (canvas primitives: Pack: art@1 painterly looks):
//! each `finish` entry that names a pass operator, `{"<op>@<major>": {params}}`, from the call's
//! packs or fx@1, checked and compiled before a frame draws and run in order over the look's
//! finished frame. Status marks and the legend keep the frame's own pixels: their boxes are
//! copied back after the passes, so a look never recolors status (The status-color rule).

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use deep_canvas_effects::{fx, look_finish};
use deep_effects_render::compile::{self, Compiled};
use deep_effects_render::runner::Runner;
use serde_json::{json, Value};

use crate::op_transition::{run, Stage};
use crate::{refused, Planted};

struct Pass {
    label: String,
    compiled: Arc<Compiled>,
    values: BTreeMap<String, deep_canvas_effects::interp::Val>,
    runner: Arc<Mutex<Option<(u64, Runner)>>>,
}

/// A look's operator finish: its passes, in the order its `finish` lists them.
#[derive(Clone, Default)]
pub struct Finish {
    passes: Arc<Vec<Pass>>,
}

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

/// The operator finish of the look `def`, its operators found in `manifests` or fx@1, each
/// checked as a look's finish and compiled; one that can't run refuses, naming its entry.
pub fn of(
    def: &Value,
    manifests: &[Value],
    roles: &BTreeMap<String, [f64; 3]>,
) -> Result<Finish, Value> {
    let mut passes = Vec::new();
    for (i, entry) in def["finish"].as_array().into_iter().flatten().enumerate() {
        let Some((name, params)) = look_finish::op_name(entry) else {
            continue;
        };
        let at = format!("look/finish/{i}/{name}");
        let graph = manifests
            .iter()
            .flat_map(fx::named)
            .chain(fx::library())
            .find(|n| n.name == name)
            .map(|n| n.graph)
            .ok_or_else(|| json!({"code": "operator_unknown_op", "path": at, "op": name}))?;
        let (checked, _) = look_finish::check(&graph).map_err(|issues| {
            let first = issues.first();
            json!({"code": first.map_or("operator_kind_rule", |i| i.code),
                "path": format!("{at}/{}", first.and_then(|i| i.path.clone()).unwrap_or_default()),
                "issues": issues.iter().map(|i| i.to_json()).collect::<Vec<_>>()})
        })?;
        let wgsl = deep_canvas_effects::emit::pass(&checked, Default::default());
        compile::validate(&wgsl)
            .map_err(|e| json!({"code": "operator_compile", "path": at, "what": e}))?;
        let params: BTreeMap<String, Value> = params
            .as_object()
            .map(|o| o.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default();
        let values = deep_canvas_effects::interp::inputs(&checked, &params, roles);
        passes.push(Pass {
            label: format!("finish/{i}/{name}"),
            compiled: Arc::new(Compiled { checked, wgsl }),
            values,
            runner: Arc::default(),
        });
    }
    Ok(Finish {
        passes: Arc::new(passes),
    })
}

impl Finish {
    pub fn is_empty(&self) -> bool {
        self.passes.is_empty()
    }

    /// The passes over `bytes` (the finished frame, 4 a pixel, rows top-down, at `size`, RGBA or
    /// with `bgra` BGRA), each box of `keep` (px `[x, y, w, h]`, status marks and the legend)
    /// left as it was. With `profiler` the passes are timed under `prefix` and their labels, and
    /// their GPU time returns, ms.
    #[allow(clippy::too_many_arguments)]
    pub fn apply(
        &self,
        app: &crate::App,
        profiler: Option<deep_scene3d_render::Profiler>,
        prefix: &str,
        bytes: &mut Vec<u8>,
        size: [u32; 2],
        keep: &[[f64; 4]],
        bgra: bool,
    ) -> Result<Option<f64>, Value> {
        if self.passes.is_empty() {
            return Ok(None);
        }
        let stages = self
            .passes
            .iter()
            .map(|p| Stage {
                label: format!("{prefix}{}", p.label),
                compiled: p.compiled.clone(),
                runner: p.runner.clone(),
                values: p.values.clone(),
                reads: vec![None; p.compiled.checked.textures.len()],
            })
            .collect();
        let before = std::mem::take(bytes);
        let format = if bgra {
            wgpu::TextureFormat::Bgra8Unorm
        } else {
            wgpu::TextureFormat::Rgba8Unorm
        };
        let (mut out, ms) = run(app, profiler, stages, vec![before.clone()], size, format)
            .map_err(|e| json!({"code": "render_failed", "path": "look/finish", "what": e}))?;
        keep_boxes(&mut out, &before, size, keep);
        *bytes = out;
        Ok(ms)
    }
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

/// `before`'s pixels back into `out` inside each box of `keep`.
fn keep_boxes(out: &mut [u8], before: &[u8], size: [u32; 2], keep: &[[f64; 4]]) {
    let (w, h) = (size[0] as usize, size[1] as usize);
    for b in keep {
        let x0 = (b[0].floor().max(0.0) as usize).min(w);
        let y0 = (b[1].floor().max(0.0) as usize).min(h);
        let x1 = ((b[0] + b[2]).ceil().max(0.0) as usize).min(w);
        let y1 = ((b[1] + b[3]).ceil().max(0.0) as usize).min(h);
        for y in y0..y1 {
            let row = (y * w + x0) * 4..(y * w + x1) * 4;
            out[row.clone()].copy_from_slice(&before[row]);
        }
    }
}
