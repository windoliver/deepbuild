//! #466's operator transitions in a 2D film (canvas primitives: Transition: operator, iris and
//! dip): the pass a transition's `op` names, from the document's `gpu.pass@1` items, the packs it
//! pins or fx@1, checked at the revision's check; its reveal, measured from the pass's own output
//! so `align: reveal` lands the frame where the incoming side first covers half the picture on
//! the cut; and the pass drawn over the two finished sides on the CPU reference interpreter, so a
//! canonical frame is the same on every machine.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, OnceLock};

use deep_canvas::document::Issue;
use deep_canvas_effects::interp::Image;
use deep_canvas_effects::transition::{self, Pass};
use deep_canvas_motion::program::Program;
use deep_canvas_motion::shots::{self, Align, Kind};
use serde_json::{json, Value};

use crate::snapshot::Unfit;

/// The side the reveal is measured on: small, since a reveal is a share of the picture.
const PROBE: [u32; 2] = [64, 36];

/// The pass `op` names in `doc`, checked, or the refusals, each a path in the operator.
pub(crate) fn pass_of(
    doc: &Value,
    op: &str,
    reads: &[String],
) -> Result<Pass, Vec<(String, String, &'static str)>> {
    let packs: Vec<Value> = doc
        .get("packs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter_map(crate::packs::manifest_of)
        .collect();
    let Some(graph) = transition::graph_of(op, doc.get("items"), &packs) else {
        return Err(vec![(
            "op".into(),
            format!("no gpu.pass@1 item, pinned pack or fx@1 operator is named {op}"),
            "operator_unknown_op",
        )]);
    };
    transition::check(&graph, reads).map_err(|issues| {
        issues
            .into_iter()
            .map(|i| {
                let at = i
                    .path
                    .clone()
                    .or(i.step.clone().map(|s| format!("steps/{s}")));
                (at.unwrap_or_default(), i.message, i.code)
            })
            .collect()
    })
}

/// The refusals of a document's operator transitions, each at `transitions/<id>/operator/…`.
pub(crate) fn check(doc: &Value) -> Vec<Issue> {
    let mut out = Vec::new();
    let Some(transitions) = doc.get("transitions").and_then(Value::as_object) else {
        return out;
    };
    for (id, tr) in transitions {
        if tr.get("kind").and_then(Value::as_str) != Some("operator") {
            continue;
        }
        let f = tr.get("operator");
        let Some(op) = f.and_then(|f| f.get("op")).and_then(Value::as_str) else {
            continue;
        };
        let reads = reads_of(f);
        if let Err(refused) = pass_of(doc, op, &reads) {
            for (path, why, code) in refused {
                let at = if path.is_empty() {
                    format!("transitions/{id}/operator/op")
                } else {
                    format!("transitions/{id}/operator/{path}")
                };
                out.push(Issue::error(code, id, at, json!({"op": op}), &why));
            }
        }
    }
    out
}

fn reads_of(f: Option<&Value>) -> Vec<String> {
    match f.and_then(|f| f.get("reads")).and_then(Value::as_array) {
        Some(a) => a
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        None => shots::OPERATOR_READS
            .iter()
            .map(|r| r.to_string())
            .collect(),
    }
}

/// Reveal offsets already measured, by the pass, span, rate and ease they came from.
fn measured() -> &'static Mutex<HashMap<String, Option<i64>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<i64>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// `program` with each operator transition that aligns on its reveal placed there: the window
/// moved so its first frame whose pass covers half the picture lands on the cut. Unchanged when
/// it has none.
pub(crate) fn placed(program: Arc<Program>, doc: &Value) -> Arc<Program> {
    let Some(plan) = program.shots.as_deref() else {
        return program;
    };
    let rate = plan.frame_rate;
    let mut moves = Vec::new();
    for (i, tr) in plan.transitions.iter().enumerate() {
        let (Kind::Operator(o), Align::Reveal) = (&tr.kind, tr.align) else {
            continue;
        };
        let span = tr.end - tr.start;
        let key = format!(
            "{}|{span}|{rate:?}|{:?}|{:?}",
            o.op,
            tr.ease,
            doc.get("items").and_then(|i| i.get(&o.op))
        );
        let hit = measured().lock().ok().and_then(|m| m.get(&key).copied());
        let offset = match hit {
            Some(v) => v,
            None => {
                let v = pass_of(doc, &o.op, &o.reads).ok().and_then(|pass| {
                    let mut probe = tr.clone();
                    (probe.start, probe.end) = (0, span);
                    shots::reveal_offset(span, rate, &|at| {
                        pass.coverage(probe.progress(at), PROBE).ok()
                    })
                });
                if let Ok(mut m) = measured().lock() {
                    m.insert(key, v);
                }
                v
            }
        };
        if let Some(at) = offset {
            moves.push((i, at));
        }
    }
    if moves.is_empty() {
        return program;
    }
    let mut program = (*program).clone();
    if let Some(plan) = program.shots.as_mut() {
        let plan = Arc::make_mut(plan);
        for (i, at) in moves {
            shots::placed(&mut plan.transitions[i], at);
        }
    }
    Arc::new(program)
}

/// The pass of operator transition `id` over two finished sides at progress `p`, as 8-bit RGBA.
pub(crate) fn draw(
    doc: &Value,
    id: &str,
    o: &shots::Operator,
    p: f64,
    sides: [&[u8]; 2],
    size: [u16; 2],
    roles: &BTreeMap<String, [f64; 3]>,
) -> Result<Vec<u8>, Unfit> {
    let pass = pass_of(doc, &o.op, &o.reads).map_err(|r| Unfit {
        code: r.first().map_or("operator_kind_rule", |x| x.2),
        path: format!("transitions/{id}/operator"),
    })?;
    let (w, h) = (u32::from(size[0]), u32::from(size[1]));
    let image = |rgba: &[u8]| Image {
        w,
        h,
        px: rgba
            .chunks_exact(4)
            .map(|c| [0, 1, 2, 3].map(|k| f64::from(c[k]) / 255.0))
            .collect(),
    };
    let (a, b) = (image(sides[0]), image(sides[1]));
    // Rows in bands across the cores; each band is the same function of its rows.
    let bands = std::thread::available_parallelism()
        .map_or(1, |n| n.get())
        .min(h as usize)
        .max(1) as u32;
    let per = h.div_ceil(bands);
    let rows: Result<Vec<Vec<[f64; 4]>>, String> = std::thread::scope(|s| {
        let jobs: Vec<_> = (0..bands)
            .map(|k| {
                let (from, to) = ((k * per).min(h), ((k + 1) * per).min(h));
                let (pass, a, b) = (&pass, &a, &b);
                s.spawn(move || pass.rows(a, b, p, roles, [w, h], from..to))
            })
            .collect();
        jobs.into_iter()
            .map(|j| j.join().unwrap_or_else(|_| Err("a band panicked".into())))
            .collect()
    });
    let rows = rows.map_err(|_| Unfit {
        code: "operator_compile",
        path: format!("transitions/{id}/operator"),
    })?;
    let mut out = Vec::with_capacity((w * h * 4) as usize);
    for px in rows.into_iter().flatten() {
        for v in px {
            out.push((v.clamp(0.0, 1.0) * 255.0).round() as u8);
        }
    }
    Ok(out)
}
