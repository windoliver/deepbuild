//! The `budget_fix` call (issue #1937; tests/acceptance/1937/README.md): `document.budget`'s fix
//! for a document over its class, chosen by measurement. The document is measured as
//! `frame_budget` measures it; each candidate from the closed list is applied as a patch, measured
//! the same way and drawn at t = 0 by `view3d`, and scored by its delta and by the share of the
//! kept subject's pixels it changes. Sets whose summed measured delta reaches the budget are tried
//! by least summed share, each measured and drawn again together; the first within the budget is
//! chosen. It is the fix when it changes at most 5% of the subject, else it is offered as a choice.

use std::collections::BTreeSet;
use std::sync::Arc;

use deep_canvas::budget::Limits;
use deep_canvas::cost::{self, Coefficients};
use deep_canvas_scene3d::scene::Labels;
use deep_gpu::over_class::{self, ASK_OVER, MOST};
use serde_json::{json, Map, Value};

use crate::budget::{self, Args};
use crate::live::sealed;
use crate::{refused, App, Planted};

/// A pixel count under this share of the view makes an item small (its draw distance a knob).
const SMALL: f64 = 0.01;

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    match run(app, out, call) {
        Ok(v) | Err(v) => v,
    }
}

/// A frame at t = 0 as `view3d` draws it: RGBA pixels, and for the document's own its object-ID
/// target and the item each pick ID stands for.
struct Frame {
    rgba: Vec<u8>,
    ids: Vec<u32>,
    picks: Vec<(u32, String)>,
}

struct Candidate {
    knob: &'static str,
    item: Option<String>,
    ops: Vec<Value>,
}

/// What the run judges against: the class's limits and whether this is a reference Mac.
struct Judged {
    limits: Limits,
    reference: bool,
}

fn run(app: &mut App, out: &str, call: &Value) -> Result<Value, Value> {
    for key in ["stub_timer", "report"] {
        if call.get(key).is_some() {
            return Err(refused(
                "bad_input",
                format!("{key} is frame_budget's alone"),
            ));
        }
    }
    let keep: Option<Vec<String>> = call["keep"]
        .as_array()
        .and_then(|k| k.iter().map(|v| v.as_str().map(str::to_string)).collect());
    let Some(keep) = keep.filter(|k| !k.is_empty()) else {
        return Err(refused(
            "bad_input",
            "budget_fix is frame_budget's fields and keep: [ID]",
        ));
    };
    let args = Arc::new(budget::parse(call)?);
    let planted = app.planted;
    let a = Arc::clone(&args);
    let memo = app.memo.clone();
    let (doc, judged) = app.worker.call(move |_| {
        let admitted = budget::admitted(&a, &mut Labels::sharing(memo))?;
        let environment = a.environment.clone().unwrap_or_else(budget::this_machine);
        let mut doc = admitted.doc;
        doc["size"] = json!(a.size);
        let judged = Judged {
            limits: admitted.limits,
            reference: budget::is_reference(&environment),
        };
        Ok::<_, Value>((doc, judged))
    })?;
    let judged = Arc::new(judged);
    let measure = |app: &mut App, doc: &Value| measured(app, &args, &judged, doc, planted);
    let (document, base) = measure(app, &doc)?;
    let mut reply = json!({"limit_ms": judged.limits.gpu_ms, "document": document, "candidates": [],
                           "not_tried": [], "chosen": null, "fix": null, "ask": null});
    let (Some(limit), Some(base)) = (judged.limits.gpu_ms, base) else {
        return Ok(reply);
    };
    if base <= limit {
        return Ok(reply);
    }

    // The subject: the kept items' pixels in the document's own ID target, an instancer's
    // elements as theirs.
    let path = format!("{out}/budget_fix.json");
    std::fs::write(&path, doc.to_string())
        .map_err(|e| refused("bad_input", format!("out: {e}")))?;
    let draw = |app: &mut App, ops: &[Value], ids: bool| {
        frame(app, out, call, &path, &args.writer, ops, ids)
    };
    let before = draw(app, &[], true)?;
    let subject: BTreeSet<u32> = before
        .picks
        .iter()
        .filter(|(_, id)| {
            keep.iter()
                .any(|k| id == k || id.starts_with(&format!("{k}#")))
        })
        .map(|(p, _)| *p)
        .collect();
    let in_subject = |id: u32| subject.contains(&id);
    if !before.ids.iter().any(|&id| in_subject(id)) {
        return Err(refused(
            "subject_unseen",
            "no kept item covers a pixel at t = 0",
        ));
    }
    let share = |after: &Frame| {
        over_class::share(&before.rgba, &after.rgba, &before.ids, in_subject)
            .expect("the subject covers pixels")
    };

    let coefficients = Coefficients::reference();
    let predict = |doc: &Value| match args.meter.as_ref().and_then(|s| s.predicted(doc)) {
        Some(ms) => ms,
        None => cost::estimate(doc, sealed(), &coefficients).gpu_ms,
    };
    let predicted_base = predict(&doc);
    let (found, mut not_tried) =
        candidates(&doc, args.size, args.look.live_samples, &before, &keep);
    let mut tried: Vec<(Candidate, f64, f64)> = Vec::new();
    let mut listed = Vec::new();
    for c in found {
        let scored = patched(&doc, &args.writer, &c.ops).and_then(|p| {
            let (_, m) = measure(app, &p)?;
            Ok((p, m, draw(app, &c.ops, false)?))
        });
        let (p, m, after) = match scored {
            Ok(s) => s,
            Err(e) => {
                not_tried.push(json!({"knob": c.knob, "item": c.item, "why": e}));
                continue;
            }
        };
        let Some(m) = m else {
            not_tried.push(
                json!({"knob": c.knob, "item": c.item, "why": "its runs held invalid frames"}),
            );
            continue;
        };
        let (measured_ms, predicted_ms, share) =
            (m - base, predict(&p) - predicted_base, share(&after));
        listed.push(json!({"knob": c.knob, "item": c.item, "ops": c.ops,
                           "predicted_ms": predicted_ms, "measured_ms": measured_ms,
                           "estimate": over_class::estimate(predicted_ms, measured_ms),
                           "share": share}));
        tried.push((c, measured_ms, share));
    }
    reply["candidates"] = json!(listed);
    reply["not_tried"] = json!(not_tried);

    // The sets that reach the budget, by least summed share; the planted chooser takes the single
    // largest gain whatever its share.
    let sets = if planted == Some(Planted::PicksLargestGain) {
        let best = tried
            .iter()
            .enumerate()
            .min_by(|(_, a), (_, b)| a.1.total_cmp(&b.1));
        best.map(|(i, _)| vec![i]).into_iter().collect()
    } else {
        let gains: Vec<_> = tried.iter().map(|(_, m, s)| (Some(-m), Some(*s))).collect();
        over_class::order(&gains, base - limit)
    };
    for set in sets.into_iter().take(MOST) {
        let ops: Vec<Value> = set.iter().flat_map(|&i| tried[i].0.ops.clone()).collect();
        let Ok(p) = patched(&doc, &args.writer, &ops) else {
            continue;
        };
        let (r, m) = measure(app, &p)?;
        if r["limits"]["gpu"]["verdict"] != "PASS" {
            continue;
        }
        let share = share(&draw(app, &ops, false)?);
        let measured_ms = m.map(|m| m - base);
        reply["chosen"] = json!({"of": set, "ops": ops, "measured_ms": measured_ms, "share": share, "measured": r});
        if share <= ASK_OVER {
            reply["fix"] = json!(ops);
        } else {
            reply["ask"] = json!({"kind": "choice",
                "question": format!("The scene is over its {limit} ms class; the least change that holds it changes {:.1}% of the kept subject. Apply it?", share * 100.0),
                "options": [{"ops": ops, "share": share, "measured_ms": measured_ms},
                            {"ops": [], "share": 0.0, "measured_ms": 0.0}]});
        }
        break;
    }
    Ok(reply)
}

/// `doc` measured as `frame_budget` measures it: its Result and the median of its five GPU p95s,
/// none when a run has none.
fn measured(
    app: &mut App,
    args: &Arc<Args>,
    judged: &Arc<Judged>,
    doc: &Value,
    planted: Option<Planted>,
) -> Result<(Value, Option<f64>), Value> {
    let (args, judged, doc) = (Arc::clone(args), Arc::clone(judged), doc.clone());
    app.worker.call(move |state| {
        let device = state.gpu.recover().map_err(|e| refused("no_device", e))?;
        let runs = budget::measure(
            &state.gpu,
            device,
            &args,
            &doc,
            &judged.limits,
            &mut Labels::new(),
            planted,
        )?;
        let r = budget::result(&judged.limits, &runs[1..], judged.reference, planted);
        let mut p95s: Vec<f64> = match r["limits"]["gpu"]["runs"].as_array() {
            Some(runs) => runs
                .iter()
                .map(|r| r["p95_ms"].as_f64())
                .collect::<Option<_>>()
                .unwrap_or_default(),
            None => Vec::new(),
        };
        p95s.sort_by(f64::total_cmp);
        let median = (!p95s.is_empty()).then(|| p95s[p95s.len() / 2]);
        Ok((r, median))
    })
}

/// `doc` with `ops` applied as the writer's patch.
fn patched(doc: &Value, writer: &str, ops: &[Value]) -> Result<Value, Value> {
    let mut p = doc.clone();
    crate::view3d::apply_patch(&mut p, writer, &json!(ops), 0)?;
    Ok(p)
}

/// The document at `path` drawn by `view3d` at t = 0 at the call's size, `ops` applied first as
/// the writer's patch: its final frame and, when `ids`, its object-ID target and picks.
#[allow(clippy::too_many_arguments)]
fn frame(
    app: &mut App,
    out: &str,
    call: &Value,
    path: &str,
    writer: &str,
    ops: &[Value],
    ids: bool,
) -> Result<Frame, Value> {
    let targets = if ids {
        json!(["final", "ids"])
    } else {
        json!(["final"])
    };
    let mut view = json!({"call": "view3d", "doc": path, "look": call["look"], "size": call["render"]["pixels"],
                          "frames": 1, "capture": [0], "targets": targets});
    if !ops.is_empty() {
        view["patches"] = json!([{"frame": 0, "writer": writer, "ops": ops}]);
    }
    let reply = crate::view3d::call(app, out, &view);
    if reply.get("code").is_some() {
        return Err(reply);
    }
    let f = &reply["frames"][0];
    let read = |key: &str| -> Result<Vec<u8>, Value> {
        let name = f[key].as_str().ok_or_else(|| {
            refused(
                "unsupported_platform",
                format!("view3d drew no {key} target"),
            )
        })?;
        let bytes = std::fs::read(format!("{out}/{name}.png"))
            .map_err(|e| refused("no_pixels", e.to_string()))?;
        let image =
            image::load_from_memory(&bytes).map_err(|e| refused("no_pixels", e.to_string()))?;
        Ok(image.to_rgba8().into_raw())
    };
    let rgba = read("final")?;
    let (ids, picks) = if ids {
        let ids = read("ids")?
            .as_chunks::<4>()
            .0
            .iter()
            .map(|b| u32::from_le_bytes(*b))
            .collect();
        let picks = f["picks"]
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(p, id)| Some((p.parse().ok()?, id.as_str()?.to_string())))
            .collect();
        (ids, picks)
    } else {
        (Vec::new(), Vec::new())
    };
    Ok(Frame { rgba, ids, picks })
}

/// The closed list's candidates the document offers, each as patch ops, and the knobs it offers
/// that no patch can try, with why.
fn candidates(
    doc: &Value,
    size: [u32; 2],
    samples: u32,
    before: &Frame,
    keep: &[String],
) -> (Vec<Candidate>, Vec<Value>) {
    let empty = Map::new();
    let items = doc["items"].as_object().unwrap_or(&empty);
    let set = |id: &str, path: &str, value: Value| json!({"op": "set", "id": id, "path": format!("items/{id}/{path}"), "value": value});
    let one = |knob, id: &str, ops| Candidate {
        knob,
        item: Some(id.to_string()),
        ops,
    };
    let mut out = Vec::new();
    for (id, item) in items {
        let kind = item["kind"].as_str().unwrap_or_default();
        let params = &item["params"];
        if kind.starts_with("light.") {
            if params["shadow"] == true {
                out.push(one(
                    "shadow_off",
                    id,
                    vec![set(id, "params/shadow", json!(false))],
                ));
            }
            let priority = params["priority"].as_i64().unwrap_or(0);
            if priority > i64::from(i8::MIN) {
                out.push(one(
                    "priority_down",
                    id,
                    vec![set(id, "params/priority", json!(priority - 1))],
                ));
            }
        }
        // An instancer's elements draw its prototypes' bands: each moved to twice its size.
        if kind == "instance@1" {
            let ops: Vec<Value> = params["of"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|p| {
                    let p = p.as_str()?;
                    let mut lod = items.get(p)?.get("lod")?.clone();
                    for b in lod.get_mut("bands")?.as_array_mut()? {
                        b["below_px"] = json!(b["below_px"].as_f64()? * 2.0);
                    }
                    Some(set(p, "lod", lod))
                })
                .collect();
            if !ops.is_empty() {
                out.push(one("lod_nearer", id, ops));
            }
        }
        // A small item drawn here: shown none below twice its footprint's side, so it goes now.
        let lod_kinds = [
            "mark.box@1",
            "mark.cylinder@1",
            "mark.sphere@1",
            "mesh.asset@1",
        ];
        if lod_kinds.contains(&kind) && !keep.contains(id) {
            let pick = before.picks.iter().find(|(_, i)| i == id).map(|(p, _)| *p);
            if let Some(side) = pick.and_then(|p| footprint(before, size, p)) {
                let mut lod = item
                    .get("lod")
                    .cloned()
                    .unwrap_or_else(|| json!({"bands": []}));
                if let Some(bands) = lod.get_mut("bands").and_then(Value::as_array_mut) {
                    bands.push(json!({"below_px": 2.0 * side, "show": "none"}));
                    out.push(one("draw_distance", id, vec![set(id, "lod", lod)]));
                }
            }
        }
        if matches!(kind, "gpu.pass@1" | "gpu.compute@1") {
            let lower = match params.get("resolution").and_then(Value::as_str) {
                Some("full") => Some("half"),
                Some("half") => Some("quarter"),
                None if params.get("resolution").is_none() => Some("quarter"),
                _ => None,
            };
            if let Some(lower) = lower {
                out.push(one(
                    "effect_quality_down",
                    id,
                    vec![set(id, "params/resolution", json!(lower))],
                ));
            }
        }
    }
    let mut not_tried = Vec::new();
    if samples > 1 {
        not_tried.push(json!({"knob": "samples_down", "item": null,
            "why": "no patch reaches the call's look, and the budget run draws one sample a frame"}));
    }
    (out, not_tried)
}

/// A small item's footprint side in px: the larger side of its pixels' bounds, when it covers some
/// pixels but under [`SMALL`] of the view.
fn footprint(frame: &Frame, size: [u32; 2], pick: u32) -> Option<f64> {
    let w = size[0] as usize;
    let (mut n, mut lo, mut hi) = (0usize, [usize::MAX; 2], [0usize; 2]);
    for (i, _) in frame.ids.iter().enumerate().filter(|(_, &id)| id == pick) {
        let (x, y) = (i % w, i / w);
        n += 1;
        lo = [lo[0].min(x), lo[1].min(y)];
        hi = [hi[0].max(x), hi[1].max(y)];
    }
    let small = (n as f64) < SMALL * frame.ids.len() as f64;
    (n > 0 && small).then(|| (hi[0] - lo[0] + 1).max(hi[1] - lo[1] + 1) as f64)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The knobs the acceptance fixture has nothing for: each is offered as ops a patch applies,
    /// and each moves the field it names.
    #[test]
    fn lod_distance_and_effect_knobs_are_patches_that_apply() {
        let item = |kind: &str, rest: Value| {
            let mut i = json!({"kind": kind, "layer": "main"});
            i.as_object_mut()
                .unwrap()
                .extend(rest.as_object().unwrap().clone());
            i
        };
        let mut items = json!({
            "proto": item("mark.box@1", json!({"lod": {"bands": [{"below_px": 20, "show": "box"}]}})),
            "crowd": item("instance@1", json!({"params": {"of": ["proto"]}})),
            "pebble": item("mark.sphere@1", json!({})),
            "hero": item("mark.box@1", json!({})),
            "glow": item("gpu.pass@1", json!({"params": {"resolution": "full"}})),
        });
        for (id, i) in items.as_object_mut().unwrap() {
            i["id"] = json!(id);
        }
        let doc = json!({"format": 1, "id": "t", "items": items,
                         "layers": {"main": {"writer": "agent:alpha", "title": "Main", "order": "a0"}}});
        // A 100 × 100 view: the pebble covers a 2 × 3 patch (under 1%), the hero a 20 × 20 one.
        let mut ids = vec![0u32; 100 * 100];
        for y in 0..3 {
            ids[(10 + y) * 100 + 10] = 5;
            ids[(10 + y) * 100 + 11] = 5;
        }
        for y in 40..60 {
            for x in 40..60 {
                ids[y * 100 + x] = 6;
            }
        }
        let before = Frame {
            rgba: Vec::new(),
            ids,
            picks: vec![(5, "pebble".into()), (6, "hero".into())],
        };
        let (found, not_tried) = candidates(&doc, [100, 100], 4, &before, &[]);
        let knobs: Vec<_> = found
            .iter()
            .map(|c| (c.knob, c.item.as_deref().unwrap()))
            .collect();
        assert_eq!(
            knobs,
            [
                ("lod_nearer", "crowd"),
                ("draw_distance", "pebble"),
                ("effect_quality_down", "glow")
            ]
        );
        assert_eq!(not_tried[0]["knob"], "samples_down");
        let applied = |knob: &str| {
            let c = found.iter().find(|c| c.knob == knob).unwrap();
            patched(&doc, "agent:alpha", &c.ops).expect("the candidate's ops apply as a patch")
        };
        assert_eq!(
            applied("lod_nearer")["items"]["proto"]["lod"]["bands"][0]["below_px"],
            40.0
        );
        assert_eq!(
            applied("draw_distance")["items"]["pebble"]["lod"]["bands"],
            json!([{"below_px": 6.0, "show": "none"}])
        );
        assert_eq!(
            applied("effect_quality_down")["items"]["glow"]["params"]["resolution"],
            "half"
        );
    }
}
