//! #466's operator transitions in `view3d` (canvas primitives: Transition: operator, iris and
//! dip): each one's pass, from the document's `gpu.pass@1` items, the call's packs or fx@1, checked
//! before a frame draws; its window moved so the frame where its output first covers half the
//! picture lands on the cut (`align: reveal`); and the pass run over the two finished sides at
//! the transition's progress on the CPU reference interpreter, so the frame is the same anywhere.

use std::collections::BTreeMap;

use deep_canvas_effects::interp::Image;
use deep_canvas_effects::transition::{self, Pass};
use deep_canvas_motion::shots::{self, Align, Kind};
use serde_json::{json, Value};

use crate::regions::Timeline;

/// The side the reveal is measured on: small, since a reveal is a share of the picture.
const PROBE: [u32; 2] = [64, 36];

/// Each operator transition's checked pass by its ID, with each one that aligns on its reveal
/// placed there; a pass that can't run refuses the document, naming the transition's field.
/// With `by_progress` (#466's planted reveal) the reveal is where the progress reaches half.
pub fn passes(
    call: &Value,
    doc: &Value,
    timeline: Option<&mut Timeline>,
    by_progress: bool,
) -> Result<BTreeMap<String, Pass>, Value> {
    let Some(timeline) = timeline else {
        return Ok(BTreeMap::new());
    };
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
        out.insert(tr.id.clone(), pass);
    }
    Ok(out)
}

/// `pass` over the finished sides `outgoing` and `incoming` (straight sRGB RGBA) at progress `p`,
/// rows in bands across the cores.
pub fn draw(
    pass: &Pass,
    outgoing: &[u8],
    incoming: &[u8],
    p: f64,
    size: [u32; 2],
) -> Result<Vec<u8>, Value> {
    let image = |rgba: &[u8]| Image {
        w: size[0],
        h: size[1],
        px: rgba
            .chunks_exact(4)
            .map(|c| [0, 1, 2, 3].map(|k| f64::from(c[k]) / 255.0))
            .collect(),
    };
    let (a, b) = (image(outgoing), image(incoming));
    let roles = BTreeMap::new();
    let bands = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(size[1] as usize)
        .max(1) as u32;
    let per = size[1].div_ceil(bands);
    let rows: Result<Vec<Vec<[f64; 4]>>, String> = std::thread::scope(|s| {
        let jobs: Vec<_> = (0..bands)
            .map(|k| {
                let (from, to) = ((k * per).min(size[1]), ((k + 1) * per).min(size[1]));
                let (a, b, roles) = (&a, &b, &roles);
                s.spawn(move || pass.rows(a, b, p, roles, size, from..to))
            })
            .collect();
        jobs.into_iter()
            .map(|j| j.join().unwrap_or_else(|_| Err("a band panicked".into())))
            .collect()
    });
    let rows =
        rows.map_err(|e| json!({"code": "render_failed", "path": "transitions", "what": e}))?;
    Ok(rows
        .into_iter()
        .flatten()
        .flat_map(|px| px.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8))
        .collect())
}
