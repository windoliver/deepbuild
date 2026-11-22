//! #298: the view and viewer values a driver reads off an item (canvas primitives: Overlay:
//! clamped to the edge; The closed function list: View). An overlay's `edge` and `edge_angle` are
//! the vars `<overlay>.edge` and `<overlay>.edge_angle`; `hover_at(<item>)`, written in a driver's
//! `expr` with the item's ID bare, is the pointer's place over the item's bounds as a vec2, 0 to 1
//! on each axis, or (−1, −1) while the pointer isn't over it. A frame's host writes each on the
//! item it belongs to: `edge` and `edge_angle` from the camera and the anchor at t, `hover_at` in
//! a live view alone. Goldens, exports and checks carry no hover, so they evaluate `hover_at` as
//! (−1, −1). The values ride beside the controls' defaults, so a frame keys by them.

use deep_canvas::document::packs::{postfix, ExprStep};
use serde_json::{Map, Value};

use crate::program::CoreInput;

const CALL: &str = "hover_at";

/// The first `hover_at(<id>)` in `text`: where it starts, where it ends and its item.
fn call(text: &str) -> Result<Option<(usize, usize, &str)>, String> {
    let mut from = 0;
    while let Some(i) = text[from..].find(CALL) {
        let at = from + i;
        from = at + CALL.len();
        let before = text[..at].chars().next_back();
        let after = text[from..].trim_start();
        if before.is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '.')
            || !after.starts_with('(')
        {
            continue;
        }
        let open = text.len() - after.len() + 1;
        let Some(close) = text[open..].find(')') else {
            return Err(format!("{CALL}( is never closed"));
        };
        let id = text[open..open + close].trim();
        let named = |c: char| c.is_alphanumeric() || c == '_' || c == '-';
        if id.is_empty() || !id.chars().all(named) {
            return Err(format!("{CALL}: `{id}` is not an item's ID"));
        }
        return Ok(Some((at, open + close + 1, id)));
    }
    Ok(None)
}

/// One `hover_at` read the rewrite found: the var it stands for, its item and its axis.
pub(crate) struct Hover {
    pub name: String,
    pub item: String,
    pub axis: usize,
}

/// Rewrites each `hover_at(<id>)` in `text` to a vec2 of two plain vars, `_hover<k>x` and
/// `_hover<k>y`, that the core's expressions then see as inputs.
pub(crate) fn rewrite(text: &str) -> Result<(String, Vec<Hover>), String> {
    let mut out = String::new();
    let mut found: Vec<Hover> = Vec::new();
    let mut rest = text;
    while let Some((at, end, id)) = call(rest)? {
        let k = match found.iter().position(|h| h.item == id) {
            Some(i) => i / 2,
            None => {
                for (axis, c) in ["x", "y"].into_iter().enumerate() {
                    found.push(Hover {
                        name: format!("_hover{}{c}", found.len() / 2),
                        item: id.to_string(),
                        axis,
                    });
                }
                found.len() / 2 - 1
            }
        };
        out.push_str(&rest[..at]);
        out.push_str(&format!("vec2(_hover{k}x, _hover{k}y)"));
        rest = &rest[end..];
    }
    out.push_str(rest);
    Ok((out, found))
}

/// A driver's `expr` in postfix order, for motion's own ops: none where it has no postfix form,
/// and none where it calls `hover_at`, whose item is no var, so each compiles through the core's
/// expressions.
pub(crate) fn steps(text: &str) -> Vec<ExprStep> {
    match call(text) {
        Ok(None) => postfix(text).unwrap_or_default(),
        _ => Vec::new(),
    }
}

/// Each item a driver's `hover_at` names in `doc`: what a live view writes the pointer's place on.
pub fn hovered(doc: &Value) -> Vec<String> {
    let drivers = doc.get("drivers").and_then(Value::as_object);
    let texts = drivers
        .into_iter()
        .flatten()
        .filter_map(|(_, d)| d.get("expr")?.as_str());
    let mut out: Vec<String> = texts
        .filter_map(|text| rewrite(text).ok())
        .flat_map(|(_, found)| found.into_iter().map(|h| h.item))
        .collect();
    out.sort_unstable();
    out.dedup();
    out
}

/// The view and viewer values the items of a frame's document carry, keyed `items/<id>/edge`,
/// `items/<id>/edge_angle` and `items/<id>/hover_at/<axis>`.
pub(crate) fn defaults(doc: &Map<String, Value>) -> Vec<(String, f64)> {
    let mut out = Vec::new();
    for (id, item) in doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        for field in ["edge", "edge_angle"] {
            if let Some(v) = item.get(field).and_then(Value::as_f64) {
                out.push((format!("items/{id}/{field}"), v));
            }
        }
        let place = item.get("hover_at").and_then(Value::as_array);
        for (axis, v) in place.into_iter().flatten().enumerate() {
            out.push((
                format!("items/{id}/hover_at/{axis}"),
                v.as_f64().unwrap_or(-1.0),
            ));
        }
    }
    out
}

/// What a driver reads of `key`: the value its frame carries, or `none` in `range`.
fn read(defaults: &[(String, f64)], key: &str, none: f64, range: (f64, f64)) -> CoreInput {
    let found = defaults.iter().find(|(k, _)| k == key);
    CoreInput::Control {
        entries: Vec::new(),
        ramps: Vec::new(),
        default: found.map_or(none, |(_, v)| *v),
        range,
    }
}

/// What a driver reads of the var `<overlay>.edge` or `<overlay>.edge_angle`, when it names an
/// overlay of `doc` whose `hide` is `clamp`: 0 where no frame has bound it.
pub(crate) fn edge(
    doc: &Map<String, Value>,
    defaults: &[(String, f64)],
    var: &str,
) -> Option<CoreInput> {
    let (id, field) = var.rsplit_once('.')?;
    let hide = doc.get("items")?.get(id)?.pointer("/params/hide")?;
    let range = match field {
        "edge" => (0.0, 1.0),
        "edge_angle" => (0.0, 360.0),
        _ => return None,
    };
    let key = format!("items/{id}/{field}");
    (hide.as_str() == Some("clamp")).then(|| read(defaults, &key, 0.0, range))
}

/// What a driver reads of one axis of `hover_at(<item>)`: −1 while the pointer isn't over the
/// item, as wherever no live view wrote it.
pub(crate) fn hover(defaults: &[(String, f64)], h: &Hover) -> CoreInput {
    let key = format!("items/{}/hover_at/{}", h.item, h.axis);
    read(defaults, &key, -1.0, (-1.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn value(input: CoreInput) -> f64 {
        match input {
            CoreInput::Control { default, .. } => default,
            _ => f64::NAN,
        }
    }

    #[test]
    fn hover_at_rewrites_to_one_pair_of_vars_an_item_and_reads_minus_one_without_a_live_view() {
        let text =
            "hover_at(card).x < 0 ? 0 : 30 * (hover_at( card ).x - 0.5) + hover_at(tag-east).y";
        let (out, found) = rewrite(text).expect("three calls");
        assert_eq!(
            out,
            "vec2(_hover0x, _hover0y).x < 0 ? 0 : 30 * (vec2(_hover0x, _hover0y).x - 0.5) + vec2(_hover1x, _hover1y).y"
        );
        let named: Vec<_> = found
            .iter()
            .map(|h| (h.name.as_str(), h.item.as_str(), h.axis))
            .collect();
        assert_eq!(
            named,
            [
                ("_hover0x", "card", 0),
                ("_hover0y", "card", 1),
                ("_hover1x", "tag-east", 0),
                ("_hover1y", "tag-east", 1)
            ]
        );
        assert_eq!(
            rewrite("my_hover_at(card) + a.hover_at(b)")
                .expect("no call")
                .0,
            "my_hover_at(card) + a.hover_at(b)"
        );
        assert!(steps("length(hover_at(card))").is_empty() && steps("a * 2").len() == 3);
        assert!(rewrite("hover_at(card").is_err());
        assert!(rewrite("hover_at(a + b)").is_err());
        let doc = json!({"items": {"card": {"hover_at": [0.9, 0.5]}, "probe": {}},
            "drivers": {"a": {"expr": "hover_at(card).x"}, "b": {"expr": "hover_at(probe).y + hover_at(card).y"}}});
        assert_eq!(hovered(&doc), ["card", "probe"]);
        let live = defaults(doc.as_object().expect("a document"));
        assert_eq!(
            live,
            [
                ("items/card/hover_at/0".to_string(), 0.9),
                ("items/card/hover_at/1".to_string(), 0.5)
            ]
        );
        assert_eq!(value(hover(&live, &found[0])), 0.9);
        assert_eq!(value(hover(&[], &found[1])), -1.0);
    }

    #[test]
    fn an_edge_var_reads_what_the_frame_bound_on_a_clamping_overlay_alone() {
        let doc = json!({"items": {
            "tag": {"params": {"hide": "clamp"}, "edge": 1, "edge_angle": 329.7},
            "plain": {"params": {"hide": "never"}, "edge_angle": 10}}});
        let doc = doc.as_object().expect("a document");
        let bound = defaults(doc);
        assert_eq!(
            value(edge(doc, &bound, "tag.edge_angle").expect("a clamping overlay")),
            329.7
        );
        assert_eq!(
            value(edge(doc, &bound, "tag.edge").expect("a clamping overlay")),
            1.0
        );
        assert_eq!(
            value(edge(doc, &[], "tag.edge_angle").expect("a clamping overlay")),
            0.0
        );
        assert!(edge(doc, &bound, "plain.edge_angle").is_none());
        assert!(edge(doc, &bound, "tag.at").is_none());
        assert!(edge(doc, &bound, "nothing.edge").is_none());
    }
}
