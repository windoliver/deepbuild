//! #466's operator transitions in `view3d` (canvas primitives: Transition: operator, iris and
//! dip): each one's pass, from the document's `gpu.pass@1` items, the call's packs or fx@1, checked
//! and compiled before a frame draws; its window moved so the frame where its output first covers
//! half the picture lands on the cut (`align: reveal`), measured on the CPU reference interpreter
//! so the reveal is the same on every machine; and the pass run on the GPU (canvas primitives: GPU
//! operator) over the two finished sides at the transition's progress, timed and priced like any
//! operator (#468) under `transition/<id>`. The GPU run is same machine at best: its bilinear
//! fetches and f32 arithmetic can differ from the interpreter's f64 by a code value.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use deep_canvas_effects::transition::{self, OUTGOING, PROGRESS};
use deep_canvas_motion::shots::{self, Align, Kind};
use deep_effects_render::compile::{self, Compiled};
pub(crate) use deep_effects_render::look_ops::{run_on, Stage};
use deep_effects_render::runner::Runner;
use serde_json::{json, Value};

use crate::regions::Timeline;

/// The side the reveal is measured on: small, since a reveal is a share of the picture.
const PROBE: [u32; 2] = [64, 36];
/// The sides and the frame the pass draws: the finished frame's bytes as they are, each channel
/// a code value over 255, as the interpreter reads them.
const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// An operator transition's checked pass as it draws: its color alone (its `coverage` says where
/// the incoming side shows, not how much of the color lands), compiled to WGSL, with its pipeline
/// once a frame has built it on the device.
pub struct Transition {
    compiled: Arc<Compiled>,
    /// The texture input reading each side, by side name.
    sides: BTreeMap<String, String>,
    /// The pipeline and the device epoch it was built at.
    runner: Arc<Mutex<Option<(u64, Runner)>>>,
}

impl Transition {
    /// What the pass's declared cost (its `cost`, else the check's estimate, ns a pixel) prices
    /// a `size` frame at, ms.
    pub fn declared_ms(&self, size: [u32; 2]) -> f64 {
        let c = &self.compiled.checked;
        c.op.cost.unwrap_or(c.estimate) * f64::from(size[0]) * f64::from(size[1]) / 1e6
    }
}

/// The manifests of the packs a call installs, a folder or `{id, dir}` each.
pub(crate) fn manifests(call: &Value) -> Result<Vec<Value>, Value> {
    let mut manifests = Vec::new();
    for p in call["packs"].as_array().into_iter().flatten() {
        let Some(dir) = p.as_str().or(p["dir"].as_str()) else {
            continue;
        };
        let text = std::fs::read(std::path::Path::new(dir).join("pack.json"))
            .map_err(|e| json!({"code": "bad_input", "path": format!("packs: {dir}: {e}")}))?;
        manifests.push(
            serde_json::from_slice::<Value>(&text)
                .map_err(|e| json!({"code": "bad_input", "path": format!("packs: {dir}: {e}")}))?,
        );
    }
    Ok(manifests)
}

/// Each operator transition's checked and compiled pass by its ID, with each one that aligns on
/// its reveal placed there; a pass that can't run refuses the document, naming the transition's
/// field. With `by_progress` (#466's planted reveal) the reveal is where the progress reaches half.
pub fn passes(
    call: &Value,
    doc: &Value,
    timeline: Option<&mut Timeline>,
    by_progress: bool,
) -> Result<BTreeMap<String, Transition>, Value> {
    let Some(timeline) = timeline else {
        return Ok(BTreeMap::new());
    };
    let manifests = manifests(call)?;
    let mut out = BTreeMap::new();
    let rate = timeline.rate();
    for i in 0..timeline.windows().len() {
        let tr = timeline.windows()[i].clone();
        let Kind::Operator(o) = &tr.kind else {
            continue;
        };
        let at = format!("transitions/{}/operator", tr.id);
        let graph = transition::graph_of(&o.op, doc.get("items"), &manifests).ok_or_else(
            || json!({"code": "operator_unknown_op", "path": format!("{at}/op"), "op": o.op}),
        )?;
        let pass = transition::check(&graph, &o.reads).map_err(|issues| {
            let first = issues.first();
            json!({"code": first.map_or("operator_kind_rule", |i| i.code),
                "path": format!("{at}/{}", first.and_then(|i| i.path.clone()).unwrap_or_default()),
                "issues": issues.iter().map(|i| i.to_json()).collect::<Vec<_>>()})
        })?;
        let mut drawn = pass.checked.clone();
        drawn.op.outputs.remove("coverage");
        let wgsl = deep_canvas_effects::emit::pass(&drawn, Default::default());
        compile::validate(&wgsl).map_err(
            |e| json!({"code": "operator_compile", "path": format!("{at}/op"), "what": e}),
        )?;
        if tr.align == Align::Reveal {
            let span = tr.end - tr.start;
            let mut probe = tr.clone();
            (probe.start, probe.end) = (0, span);
            let reveal = shots::reveal_offset(span, rate, &|t| {
                let p = probe.progress(t);
                if by_progress {
                    Some(p)
                } else {
                    pass.coverage(p, PROBE).ok()
                }
            })
            .ok_or_else(|| {
                json!({"code": "operator_kind_rule", "path": format!("{at}/op"),
                "what": "its output never covers half the picture, so it has no reveal to align"})
            })?;
            timeline.place(i, reveal);
        }
        out.insert(
            tr.id.clone(),
            Transition {
                compiled: Arc::new(Compiled {
                    checked: drawn,
                    wgsl,
                }),
                sides: pass.sides,
                runner: Arc::default(),
            },
        );
    }
    Ok(out)
}

/// `tr`'s pass on the GPU over the finished sides `outgoing` and `incoming` (the frame's bytes,
/// 4 a pixel, rows top-down) at progress `p`, and the frame it returns read back. With `profiler`
/// the pass is timed under `label`, and the second value is its GPU time, ms.
#[allow(clippy::too_many_arguments)]
pub fn draw(
    app: &crate::App,
    profiler: Option<deep_scene3d_render::Profiler>,
    label: &str,
    tr: &Transition,
    outgoing: Vec<u8>,
    incoming: Vec<u8>,
    p: f64,
    size: [u32; 2],
) -> Result<(Vec<u8>, Option<f64>), Value> {
    let values = deep_canvas_effects::interp::inputs(
        &tr.compiled.checked,
        &BTreeMap::from([(PROGRESS.to_string(), Value::from(p))]),
        &BTreeMap::new(),
    );
    // Each texture input, in binding order, reads the side it names.
    let reads = tr
        .compiled
        .checked
        .textures
        .iter()
        .map(|name| Some(usize::from(tr.sides.get(OUTGOING) != Some(name))))
        .collect();
    let stage = Stage {
        label: label.to_string(),
        compiled: tr.compiled.clone(),
        runner: tr.runner.clone(),
        values,
        reads,
    };
    run(
        app,
        profiler,
        vec![stage],
        vec![outgoing, incoming],
        size,
        FORMAT,
    )
    .map_err(|e| json!({"code": "render_failed", "path": "transitions", "what": e}))
}

/// [`run_on`] on the app's device.
pub(crate) fn run(
    app: &crate::App,
    profiler: Option<deep_scene3d_render::Profiler>,
    stages: Vec<Stage>,
    inputs: Vec<Vec<u8>>,
    size: [u32; 2],
    format: wgpu::TextureFormat,
) -> Result<(Vec<u8>, Option<f64>), String> {
    app.worker.call(move |state| {
        run_on(
            &state.gpu.device(),
            profiler,
            &stages,
            &inputs,
            size,
            format,
        )
    })
}
