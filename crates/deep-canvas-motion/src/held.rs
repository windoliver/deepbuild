//! Issue #495: effects that read other times without history (canvas primitives: Frame and group:
//! flip, echo). A group's flip holds one child at a time, and its echo draws copies of its
//! children evaluated at t − k × lag through the same pure evaluation as the frame, so a seek
//! draws exactly what a play does and nothing is kept between frames.

use deep_canvas::grammar::{Time, TimeContext};
use serde_json::{json, Map, Value};

use crate::doc::Refused;
use crate::eval::{evaluated, Validity};
use crate::program::{Program, State};

/// Most copies an echo draws.
const COPIES: u64 = 16;

fn time_of(v: Option<&Value>, ctx: &TimeContext) -> Option<i64> {
    let text = v?.as_str()?;
    let (sign, unsigned) = text.strip_prefix('-').map_or((1, text), |t| (-1, t));
    Some(sign * Time::parse(unsigned).ok()?.resolve(ctx).ok()?)
}

fn is_under(items: &Map<String, Value>, id: &str, root: &str) -> bool {
    let mut at = Some(id);
    for _ in 0..=items.len() {
        match at {
            Some(a) if a == root => return true,
            Some(a) => {
                at = items
                    .get(a)
                    .and_then(|i| i.get("parent"))
                    .and_then(Value::as_str)
            }
            None => return false,
        }
    }
    false
}

/// Refuses a flip whose child a logic array picks: that form lands with the logic module, which
/// this build lacks, so it is refused naming the field rather than drawn without its child.
pub(crate) fn check(doc: &Map<String, Value>) -> Result<(), Refused> {
    for (id, item) in doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if item.pointer("/params/flip/array").is_some() {
            return Err(Refused {
                code: "module_missing",
                path: format!("items/{id}/params/flip/array"),
                detail: None,
            });
        }
    }
    Ok(())
}

/// Whether an item draws once, at t, and never in an echo's copies: a status color, a bound value
/// or a number (Frame and group: echo).
fn draws_once(doc: &Map<String, Value>, id: &str, item: &Value) -> bool {
    let own = format!("items/{id}/");
    let targets = |key: &str| {
        doc.get(key)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .any(|(_, b)| {
                b.get("target")
                    .and_then(Value::as_str)
                    .is_some_and(|t| t.starts_with(&own))
            })
    };
    targets("status_bindings")
        || targets("bound_values")
        || item.pointer("/params/text/counter").is_some()
        || item.pointer("/params/template").is_some()
}

/// The child a group's `flip` shows at `t`: `Some(None)` for none, `None` where it has no flip.
fn shown(
    doc: &Map<String, Value>,
    flip: &Value,
    t: i64,
    ctx: &TimeContext,
) -> Option<Option<String>> {
    let named = |v: Option<&Value>| {
        v.and_then(Value::as_str)
            .filter(|s| *s != "none")
            .map(str::to_string)
    };
    if let Some(keys) = flip.get("keys").and_then(Value::as_array) {
        let last = keys
            .iter()
            .filter_map(|k| Some((time_of(k.get("t"), ctx)?, named(k.get("show")))))
            .filter(|(at, _)| *at <= t)
            .max_by_key(|(at, _)| *at);
        return Some(last.and_then(|(_, show)| show));
    }
    let list = flip
        .get("from")?
        .get("list")?
        .as_str()?
        .strip_prefix("markers.")?;
    let map = flip.get("map")?.as_object()?;
    let last = doc
        .get("markers")?
        .as_object()?
        .values()
        .filter(|m| m.get("kind").and_then(Value::as_str) == Some(list))
        .filter_map(|m| {
            Some((
                time_of(m.get("t"), ctx)?,
                m.get("payload")?.get("value")?.as_str()?.to_string(),
            ))
        })
        .filter(|(at, _)| *at <= t)
        .max_by_key(|(at, _)| *at);
    Some(last.and_then(|(_, value)| named(map.get(&value))))
}

/// Hides every child of a flip group but the one it shows at `t`.
fn flip(doc: &Map<String, Value>, items: &mut Map<String, Value>, t: i64, ctx: &TimeContext) {
    let flips: Vec<(String, Option<String>)> = items
        .iter()
        .filter_map(|(id, item)| {
            let flip = item.get("params")?.get("flip")?;
            Some((id.clone(), shown(doc, flip, t, ctx)?))
        })
        .collect();
    for (group, show) in flips {
        for (id, item) in items.iter_mut() {
            if item.get("parent").and_then(Value::as_str) == Some(&group)
                && show.as_deref() != Some(id)
            {
                item["visible"] = json!(false);
            }
        }
    }
}

/// `items` with each flip group's one child shown and each echo group's copies added, evaluated
/// by `program` as `state` holds it at `t`.
pub(crate) fn apply(
    doc: &Map<String, Value>,
    program: &Program,
    state: &State,
    items: &mut Map<String, Value>,
) {
    let has = |key: &str| {
        items.values().any(|i| {
            i.get("params")
                .is_some_and(|p| p.get(key).is_some_and(|v| !v.is_null()))
        })
    };
    let (flips, echoes) = (has("flip"), has("echo"));
    if !flips && !echoes {
        return;
    }
    let frame_rate = doc
        .get("transport")
        .and_then(deep_canvas::document::frame_rate_of)
        .unwrap_or((60, 1));
    let ctx = TimeContext {
        frame_rate,
        ..TimeContext::default()
    };
    let authored = doc
        .get("items")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    // Copies read the items as they stand before this frame's flips, at their own times.
    let echoing: Vec<(String, Value)> = items
        .iter()
        .filter(|(_, i)| i.get("visible") != Some(&json!(false)))
        .filter_map(|(id, i)| {
            Some((
                id.clone(),
                i.get("params")?
                    .get("echo")
                    .filter(|e| !e.is_null())?
                    .clone(),
            ))
        })
        .collect();
    flip(doc, items, state.doc_t, &ctx);
    for (group, echo) in echoing {
        let copies = echo
            .get("copies")
            .and_then(Value::as_u64)
            .unwrap_or(0)
            .min(COPIES);
        let lag = match echo.get("lag") {
            None => time_of(Some(&json!("1f")), &ctx),
            l => time_of(l, &ctx),
        }
        .unwrap_or(0);
        let decay = echo
            .get("decay")
            .and_then(Value::as_f64)
            .unwrap_or(0.5)
            .clamp(0.0, 1.0);
        let blend = match echo.get("mode").and_then(Value::as_str) {
            Some("add") => Some("add"),
            Some("max") => Some("lighten"),
            Some("screen") => Some("screen"),
            Some("difference") => Some("difference"),
            _ => None,
        };
        let top = echo.get("newest").and_then(Value::as_str) != Some("bottom");
        for k in 1..=copies {
            let mut then = program.state();
            program.evaluate(state.t - k as i64 * lag, Validity::Full, &mut then);
            let mut earlier = evaluated(authored.clone(), program, &then);
            flip(doc, &mut earlier, then.doc_t, &ctx);
            let Some(base) = earlier.get(&group) else {
                continue;
            };
            let mut copy = base.clone();
            let own = copy
                .get("params")
                .and_then(|p| p.get("opacity"))
                .and_then(Value::as_f64)
                .unwrap_or(1.0);
            let params = copy["params"]
                .as_object_mut()
                .expect("a group with an echo has params");
            params.remove("echo");
            params.remove("flip");
            params.insert(
                "opacity".into(),
                json!(own * deep_canvas::ops::powi(decay, k as i32)),
            );
            params.insert("isolate".into(), json!(true));
            params.insert(
                "draw_order".into(),
                json!(if top { "back" } else { "front" }),
            );
            match blend {
                Some(b) => params.insert("blend".into(), json!(b)),
                None => params.remove("blend"),
            };
            // Older copies draw first when the newest is on top, last when it is below.
            let suffix = format!("#echo{:02}", if top { 99 - k } else { k });
            let id = format!("{group}{suffix}");
            items.insert(id.clone(), copy);
            for (cid, child) in &earlier {
                if cid == &group || !is_under(&earlier, cid, &group) || draws_once(doc, cid, child)
                {
                    continue;
                }
                let mut child = child.clone();
                let parent = child
                    .get("parent")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                child["parent"] = json!(if parent == group {
                    id.clone()
                } else {
                    format!("{parent}{suffix}")
                });
                items.insert(format!("{cid}{suffix}"), child);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_echo_copies_drawings_but_not_numbers_bound_values_or_status() {
        let rect = |id: &str| json!({"kind": "rect@1", "layer": "main", "order": "a1", "parent": "g", "params": {"box": [0, 0, 4, 4]}, "id": id});
        let mut items = Map::new();
        items.insert("g".into(), json!({"kind": "group@1", "layer": "main", "order": "a0", "params": {"echo": {"copies": 2, "lag": "2f"}}}));
        items.insert("bar".into(), rect("bar"));
        items.insert("badge".into(), rect("badge"));
        items.insert("label".into(), rect("label"));
        items.insert("count".into(), json!({"kind": "text@1", "layer": "main", "order": "a2", "parent": "g", "params": {"text": {"counter": {"source": "x"}}}}));
        let doc = json!({
            "format": 1, "id": "d", "profile": "film", "size": [100, 100], "layers": {"main": {"writer": "a", "order": "a0"}},
            "transport": {"span": "1s", "frame_rate": [60, 1]}, "items": items,
            "status_bindings": {"s": {"target": "items/badge/params/paint/fill", "source": "checks/x"}},
            "bound_values": {"b": {"target": "items/label/params/text", "source": "readings/y"}},
        });
        let doc = doc.as_object().unwrap();
        let program = Program::compile(doc).ok().unwrap();
        let mut state = program.state();
        program.evaluate(0, Validity::Full, &mut state);
        let shown = crate::eval::items(doc, &program, &state);
        let mut copied: Vec<&str> = shown
            .keys()
            .filter(|k| k.contains("#echo"))
            .map(String::as_str)
            .collect();
        copied.sort();
        assert_eq!(copied, ["bar#echo97", "bar#echo98", "g#echo97", "g#echo98"]);
    }

    #[test]
    fn a_flip_a_logic_array_picks_is_refused_naming_it() {
        let doc = json!({
            "format": 1, "id": "d", "profile": "film", "size": [100, 100], "layers": {"main": {"writer": "a", "order": "a0"}},
            "transport": {"span": "1s", "frame_rate": [60, 1]},
            "items": {"g": {"kind": "group@1", "layer": "main", "order": "a0", "params": {"flip": {"array": "brain.mouth[0]", "map": {"1": "c"}}}}},
        });
        let refused = Program::compile(doc.as_object().unwrap()).err().unwrap();
        assert_eq!(
            (refused.code, refused.path.as_str()),
            ("module_missing", "items/g/params/flip/array")
        );
    }
}
