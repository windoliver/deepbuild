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

/// #538: refuses a flip whose array isn't `<logic>.<name>[index]` or whose map isn't value →
/// child ID. Whether the build fills the array and the document writes it is the host's column
/// view's to say (`module_missing`, `ref_unresolved`), never this module's: it reads the array
/// through the core's view and doesn't depend on the logic module.
pub(crate) fn check(doc: &Map<String, Value>) -> Result<(), Refused> {
    for (id, item) in doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let Some(flip) = item.pointer("/params/flip").filter(|f| f.get("array").is_some()) else {
            continue;
        };
        let at = format!("items/{id}/params/flip");
        let path = flip["array"].as_str().and_then(deep_canvas::columns::element_path);
        if path.is_none() {
            return Err(Refused { code: "ref_unresolved", path: format!("{at}/array"), detail: None });
        }
        let map = flip.get("map").and_then(Value::as_object);
        if map.is_none_or(|m| m.values().any(|c| !c.is_string())) {
            return Err(Refused { code: "out_of_range", path: format!("{at}/map"), detail: None });
        }
    }
    Ok(())
}

/// #538: the child a value of a flip's array names in its `map`; `None` where the map lacks it.
fn mapped_child<'a>(flip: &'a Value, value: f64) -> Option<&'a str> {
    let key = (value.fract() == 0.0 && value.is_finite()).then(|| format!("{}", value as i64))?;
    flip.get("map")?.get(&key)?.as_str()
}

/// #538: each flip of `doc` whose array a step leaves on a value its map lacks, as
/// `flip.unmapped {value, array, step}`, at the step each such value begins: every one at check
/// (`at` none), or those beginning at the step of a frame at `at` (flicks). Read from the baked
/// `arrays`, so a seek raises what a play does.
pub fn unmapped(doc: &Value, at: Option<i64>) -> Vec<deep_canvas::document::Issue> {
    let mut out = Vec::new();
    for (id, item) in doc.get("items").and_then(Value::as_object).into_iter().flatten() {
        let Some(flip) = item.pointer("/params/flip").filter(|f| f.get("array").is_some()) else {
            continue;
        };
        let Some(path) = flip["array"].as_str() else { continue };
        let Some((form, index)) = deep_canvas::columns::element_path(path) else { continue };
        let Some(array) = doc.pointer("/arrays").and_then(|a| a.get(form)) else { continue };
        let frame_step = at.map(|t| t.div_euclid(array["every"].as_i64().unwrap_or(1).max(1)));
        let mut was_mapped = true;
        for (step, value) in deep_canvas::columns::element_steps(array, index) {
            let mapped = mapped_child(flip, value).is_some();
            if !mapped && was_mapped && frame_step.is_none_or(|k| k == step) {
                out.push(deep_canvas::document::Issue {
                    severity: "warning",
                    ..deep_canvas::document::Issue::error(
                        "flip.unmapped",
                        id,
                        format!("items/{id}/params/flip/array"),
                        json!({"value": value, "array": path, "step": step}),
                        "the flip's array holds a value its map lacks; the group shows no child while it lasts",
                    )
                });
            }
            was_mapped = mapped;
        }
    }
    out
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
    // #538: the child the array's value at t names, through the core's column view; a value
    // the map lacks shows none, never the last one shown.
    // An array the document hasn't baked shows none, never every child at once.
    if let Some(path) = flip.get("array").and_then(Value::as_str) {
        let value = deep_canvas::columns::element_path(path).and_then(|(form, index)| {
            let array = doc.get("arrays")?.get(form)?;
            deep_canvas::columns::element_at(array, index, t).map(|(v, _)| v)
        });
        return Some(value.and_then(|v| mapped_child(flip, v)).map(str::to_string));
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
            params.insert("opacity".into(), json!(own * decay.powi(k as i32)));
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

/// #538's planted flip that, on a value its map lacks, keeps showing the child it showed last.
pub const FLIP_HOLDS_LAST: &str = "flip_holds_last_child";

/// #538: a flip by array in the hub's own frame. Each child of a group whose flip an array
/// drives is hidden, through the core's fields, unless the array's value at t maps to it: a value
/// the map lacks hides them all. Pure in t, so a seek draws what a play does; only those children
/// read t, so a document with no such flip gains no work per frame.
pub(crate) fn register(r: &mut deep_canvas::registry::Registrar) {
    r.contribution("motion.flip", "fields", "item", "geometry", "items", "core.fields");
    r.operator("flip", "items", &["self", "refs", "t"], &["motion.flip"])
        .applies(|doc, _, item| array_flip_of(doc, item).is_some())
        .run(flip_op);
}

/// The array flip of `item`'s parent group, if it has one.
fn array_flip_of<'a>(doc: &'a Value, item: &Value) -> Option<&'a Value> {
    let parent = item.get("parent")?.as_str()?;
    let flip = doc.get("items")?.get(parent)?.pointer("/params/flip")?;
    flip.get("array").and_then(Value::as_str).map(|_| flip)
}

fn flip_op(v: &mut deep_canvas::schedule::View<'_>) -> Result<(), deep_canvas::schedule::OpError> {
    use deep_canvas::schedule::core_ops::{Datum, Edit, Edits};
    use deep_canvas::schedule::Val;
    let item = v.item()?;
    let doc = v.document()?;
    let t = v.t()?;
    let id = v.id().unwrap_or_default();
    let Some(flip) = array_flip_of(doc, item) else {
        return v.write("motion.flip", Val::typed(Edits(Vec::new())));
    };
    let path = flip["array"].as_str().unwrap_or_default();
    let value = deep_canvas::columns::element_path(path).and_then(|(form, index)| {
        deep_canvas::columns::element_at(doc.get("arrays")?.get(form)?, index, t).map(|(v, _)| v)
    });
    let child = value.and_then(|x| mapped_child(flip, x));
    if child.is_none() && v.planted() == Some(FLIP_HOLDS_LAST) {
        if let Some(last) = v.last("motion.flip") {
            return v.write("motion.flip", last);
        }
    }
    let hidden = child != Some(id);
    let edits = hidden.then(|| Edit { add: false, path: vec!["visible".into()], value: Datum::Bool(false) });
    v.write("motion.flip", Val::typed(Edits(edits.into_iter().collect())))
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

    /// #538: a flip by array shows the one child its value maps to, the same at a seek; a value
    /// the map lacks shows none and raises `flip.unmapped` at the step it begins.
    #[test]
    fn a_flip_shows_the_child_its_array_names_and_none_for_an_unmapped_value() {
        let child = |id: &str, o: &str| json!({"kind": "rect@1", "layer": "main", "order": o, "parent": "g", "params": {"box": [0, 0, 4, 4]}, "id": id});
        let every = 705_600_000 / 10;
        let doc = json!({
            "format": 1, "id": "d", "profile": "film", "size": [100, 100], "layers": {"main": {"writer": "a", "order": "a0"}},
            "transport": {"span": "1s", "frame_rate": [60, 1]},
            "items": {
                "g": {"kind": "group@1", "layer": "main", "order": "a0", "params": {"flip": {"array": "story.line[0]", "map": {"0": "a", "1": "b"}}}},
                "a": child("a", "a1"), "b": child("b", "a2"),
            },
            "arrays": {"story.line": {"type": "i32", "count": 1, "every": every, "linear": false, "steps": [
                {"step": 0, "changed": [[0, 1]], "values": [[0, [1]]]},
                {"step": 3, "changed": [[0, 1]], "values": [[0, [7]]]},
            ]}},
        });
        let map = doc.as_object().unwrap();
        let program = Program::compile(map).ok().unwrap();
        let visible = |t: i64| {
            let mut state = program.state();
            program.evaluate(t, Validity::Full, &mut state);
            let shown = crate::eval::items(map, &program, &state);
            let mut v: Vec<String> = ["a", "b"]
                .into_iter()
                .filter(|id| shown[*id].get("visible") != Some(&json!(false)))
                .map(String::from)
                .collect();
            v.sort();
            v
        };
        assert_eq!(visible(every), ["b"]);
        assert_eq!(visible(4 * every), Vec::<String>::new());
        let raised = unmapped(&doc, None);
        assert_eq!(raised.len(), 1);
        assert_eq!(raised[0].actual, json!({"value": 7.0, "array": "story.line[0]", "step": 3}));
        assert_eq!(unmapped(&doc, Some(3 * every)).len(), 1);
        assert!(unmapped(&doc, Some(4 * every)).is_empty());
    }
}
