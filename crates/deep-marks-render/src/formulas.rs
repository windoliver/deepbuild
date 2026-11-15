//! Issue #505: a frame's formulas where this binary evaluates a document. Each frame compiles
//! the document with the request's input track, evaluates it at t, and lowers its path functions
//! and computed columns ([`deep_canvas_marks::functions`]) with their vars read at t: a control's
//! value is its last entry at or before t, else its default, and a data value is as its channel
//! keys it. A driver whose var reads a formula's anchor (`items/<id>#<anchor>/<field>`) reads the
//! value this frame's formulas give, so a readout and the curve come from the one formula.

use deep_canvas_marks::function::Planted;
use deep_canvas_marks::functions::{self, Formulas};
use deep_canvas_motion::eval::Validity;
use deep_canvas_motion::input::Entry;
use deep_canvas_motion::program::{Options, Program};
use serde_json::{json, Map, Value};

/// What a request gives the formulas: its input track and its planted program.
#[derive(Clone, Debug, Default)]
pub struct Ctx {
    pub input: Vec<Entry>,
    pub planted: Planted,
}

/// The request's `input`: input-track entries `{t, seq, control, value, player?}`.
pub fn input_of(v: Option<&Value>) -> Option<Vec<Entry>> {
    let Some(v) = v else {
        return Some(Vec::new());
    };
    v.as_array()?
        .iter()
        .map(|e| {
            Some(Entry {
                t: e.get("t")?.as_i64()?,
                seq: e.get("seq")?.as_i64()?,
                control: e.get("control")?.as_str()?.to_string(),
                value: e.get("value")?.clone(),
                player: match e.get("player") {
                    None => 1,
                    Some(p) => p.as_i64().filter(|p| (1..=8).contains(p))?,
                },
            })
        })
        .collect()
}

/// Whether `doc` holds a formula this pass draws: a path function or a computed column.
pub fn has_formulas(doc: &Map<String, Value>) -> bool {
    doc.get("items")
        .and_then(Value::as_object)
        .is_some_and(|items| {
            items.values().any(|i| {
                i.pointer("/params/fn").is_some()
                    || i.pointer("/params/columns")
                        .and_then(Value::as_object)
                        .is_some_and(|c| c.values().any(|c| c.get("expr").is_some()))
            })
        })
}

/// The document compiled with the request's input track.
pub fn program(doc: &Map<String, Value>, ctx: &Ctx) -> Result<Program, Value> {
    let options = Options {
        input: ctx.input.clone(),
        ..Options::default()
    };
    Program::compile_with(doc, options).map_err(|r| crate::refused(r.code, &r.path))
}

/// A var's value at t: a control's (`controls/<id>/value`) or a data value's (`data/<name>`).
fn values<'a>(
    doc: &'a Map<String, Value>,
    program: &'a Program,
    t: i64,
    ctx: &'a Ctx,
) -> impl Fn(&str) -> Option<f64> + 'a {
    let mut state = program.state();
    program.evaluate(t, Validity::Full, &mut state);
    move |path: &str| {
        if let Some(id) = path
            .strip_prefix("controls/")
            .and_then(|p| p.strip_suffix("/value"))
        {
            let last = ctx
                .input
                .iter()
                .filter(|e| e.control == id && e.t <= t)
                .max_by_key(|e| e.key());
            return match last {
                Some(e) => e.value.as_f64(),
                None => doc.get("controls")?.get(id)?.get("default")?.as_f64(),
            };
        }
        let name = path.strip_prefix("data/")?;
        if let Some(f) = program
            .fields
            .iter()
            .find(|f| f.data.as_deref() == Some(name))
        {
            return state.slots.get(f.slot).copied();
        }
        let d = doc.get("data")?.get(name)?;
        d.get("value").unwrap_or(d).as_f64()
    }
}

/// `items` (evaluated at t) with the frame's formulas lowered, and what they gave.
pub fn lower(
    doc: &Map<String, Value>,
    program: &Program,
    items: &mut Map<String, Value>,
    t: i64,
    ctx: &Ctx,
) -> Formulas {
    let value = values(doc, program, t, ctx);
    functions::lower(doc, items, &value, ctx.planted)
}

/// Whether a driver's var reads an anchor (`items/<id>#…`).
fn reads_anchor(doc: &Map<String, Value>) -> bool {
    doc.get("drivers")
        .and_then(Value::as_object)
        .is_some_and(|d| {
            d.values().any(|d| {
                d.get("vars").and_then(Value::as_object).is_some_and(|v| {
                    v.values().any(|p| {
                        p.as_str()
                            .is_some_and(|p| p.starts_with("items/") && p.contains('#'))
                    })
                })
            })
        })
}

/// `doc` with each driver var that reads a formula's anchor bound to the value it reads at this
/// frame, as a data value of its own, so the motion program's drivers read it as written.
pub fn with_anchors(doc: &Map<String, Value>, formulas: &Formulas) -> Option<Map<String, Value>> {
    if !reads_anchor(doc) {
        return None;
    }
    let mut out = doc.clone();
    let mut data = out
        .get("data")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut k = 0;
    if let Some(Value::Object(drivers)) = out.get_mut("drivers") {
        for d in drivers.values_mut() {
            let Some(Value::Object(vars)) = d.get_mut("vars") else {
                continue;
            };
            for path in vars.values_mut() {
                let Some(p) = path.as_str().filter(|p| p.contains('#')) else {
                    continue;
                };
                let Some(v) = formulas.anchor(p) else {
                    continue;
                };
                let name = format!("anchor505n{k}");
                k += 1;
                data.insert(name.clone(), json!({"value": v, "source": "story"}));
                *path = json!(format!("data/{name}"));
            }
        }
    }
    out.insert("data".into(), Value::Object(data));
    Some(out)
}

/// `doc`'s items evaluated at t with relations placed and its formulas lowered, and what the
/// formulas gave (`None` for a document with none).
pub fn evaluated(
    doc: &Map<String, Value>,
    t: i64,
    vectors: &crate::Vectors,
    ctx: &Ctx,
) -> Result<(Map<String, Value>, Option<Formulas>), Value> {
    let program = program(doc, ctx)?;
    let mut items = crate::place::evaluated(doc, &program, t, vectors)?;
    if has_handles(doc) {
        handles(doc, &mut items, &values(doc, &program, t, ctx));
    }
    // #223: a warp's vars read at t.
    if deep_canvas_marks::warp::binds(&items) {
        let seconds = t as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64;
        deep_canvas_marks::warp::bind(&mut items, seconds, &values(doc, &program, t, ctx));
    }
    if !has_formulas(doc) {
        return Ok((items, None));
    }
    let mut found = lower(doc, &program, &mut items, t, ctx);
    if let Some(bound) = with_anchors(doc, &found) {
        let program = self::program(&bound, ctx)?;
        items = crate::place::evaluated(&bound, &program, t, vectors)?;
        if has_handles(&bound) {
            handles(&bound, &mut items, &values(&bound, &program, t, ctx));
        }
        found = lower(&bound, &program, &mut items, t, ctx);
    }
    Ok((items, Some(found)))
}

fn has_handles(doc: &Map<String, Value>) -> bool {
    doc.get("controls")
        .and_then(Value::as_object)
        .is_some_and(|c| c.values().any(|c| c.get("handle").is_some()))
}

/// Each control's handle drawn where its value puts it (Control: `handle`): along an axis, its
/// item moved `travel` × the value's fraction of the control's range, as the input module places
/// the knob it hit-tests. A handle along a polyline is placed by the input module alone.
fn handles(
    doc: &Map<String, Value>,
    items: &mut Map<String, Value>,
    value: &dyn Fn(&str) -> Option<f64>,
) {
    for (id, c) in doc
        .get("controls")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let Some(h) = c.get("handle") else {
            continue;
        };
        let k = match h.get("along").and_then(Value::as_str) {
            Some("x") => 0,
            Some("y") => 1,
            _ => continue,
        };
        let travel = h.get("travel").and_then(Value::as_f64).unwrap_or(100.0);
        let range = c.get("range").and_then(Value::as_array);
        let (Some(lo), Some(hi)) = (
            range.and_then(|r| r.first()).and_then(Value::as_f64),
            range.and_then(|r| r.get(1)).and_then(Value::as_f64),
        ) else {
            continue;
        };
        let (Some(v), Some(item)) = (
            value(&format!("controls/{id}/value")),
            h.get("item")
                .and_then(Value::as_str)
                .and_then(|i| items.get_mut(i)),
        ) else {
            continue;
        };
        let f = if hi > lo {
            ((v - lo) / (hi - lo)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let Some(at) = item
            .as_object_mut()
            .map(|o| o.entry("at").or_insert_with(|| json!({})))
        else {
            continue;
        };
        let pos = at
            .get("pos")
            .and_then(Value::as_array)
            .map(|p| p.iter().filter_map(Value::as_f64).collect::<Vec<_>>())
            .unwrap_or_else(|| vec![0.0, 0.0, 0.0]);
        let mut pos: Vec<f64> = pos
            .into_iter()
            .chain(std::iter::repeat(0.0))
            .take(3)
            .collect();
        pos[k] += travel * f;
        at["pos"] = json!(pos);
    }
}
