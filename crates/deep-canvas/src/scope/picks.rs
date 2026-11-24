//! Issue #504: the items a control picks in the scene, with the labels their buttons are named by.

use super::*;

/// One item a control picks in the scene (Control: `targets`): the control, the option or stage
/// it picks, the item, and the label a screen reader names its button by.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PickTarget {
    pub control: String,
    pub option: String,
    pub item: String,
    pub label: String,
}

/// Every control's targets on items that draw (an item with `visible: false` or that `hidden`
/// names is never picked or announced), controls in document order and each control's targets
/// in reading order: the item's `order`, then its ID (Control: targets join the Tab order after
/// the control's own UI, in reading order).
pub fn pick_targets(doc: &Value, hidden: &[String]) -> Vec<PickTarget> {
    let items = member(doc, "items").and_then(Value::as_object);
    let mut out = Vec::new();
    for (control, c) in member(doc, "controls")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let Some(targets) = member(c, "targets").and_then(Value::as_object) else {
            continue;
        };
        let mut mine: Vec<(String, PickTarget)> = targets
            .iter()
            .filter_map(|(option, item)| {
                let item = item.as_str()?;
                let drawn = items?.get(item)?;
                if member(drawn, "visible") == Some(&Value::Bool(false))
                    || hidden.iter().any(|h| h == item)
                {
                    return None;
                }
                let order = member(drawn, "order")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let label = label_of(doc, c, option);
                let t = PickTarget {
                    control: control.clone(),
                    option: option.clone(),
                    item: item.into(),
                    label,
                };
                Some((format!("{order}\u{0}{item}"), t))
            })
            .collect();
        mine.sort_by(|a, b| a.0.cmp(&b.0));
        out.extend(mine.into_iter().map(|(_, t)| t));
    }
    out
}

/// The label a target's button is named by: its stage's, its variant option's or its option's
/// `label`, else the option's ID.
fn label_of(doc: &Value, control: &Value, option: &str) -> String {
    fn named<'a>(list: Option<&'a Value>, option: &str) -> Option<&'a str> {
        list?
            .as_array()?
            .iter()
            .find(|o| {
                member(o, "name")
                    .or_else(|| member(o, "id"))
                    .and_then(Value::as_str)
                    == Some(option)
            })
            .and_then(|o| member(o, "label")?.as_str())
    }
    let set = member(control, "variant").and_then(Value::as_str);
    member(control, "stages")
        .and_then(|s| member(s, option))
        .and_then(|s| member(s, "label")?.as_str())
        .or_else(|| {
            set.and_then(|set| named(member(doc, "variants")?.get(set)?.get("options"), option))
        })
        .or_else(|| named(member(control, "options"), option))
        .unwrap_or(option)
        .to_string()
}

/// #3236: the option a reading stop holds in place of a target's: the stop is `(set, READING)`.
pub const READING: &str = "#rows";

/// The items a reading focus walks (Mark set: a set with no pick control still takes one Tab stop,
/// its drawn rows walked by key): each mark set or series heard (not decoration, drawn and not
/// hidden) that no pick control names in its `rows`, in reading order: its layer's `order`, then
/// its own, then its ID.
pub fn reading_sets(doc: &Value, hidden: &[String]) -> Vec<String> {
    let picked: Vec<&str> = member(doc, "controls")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter_map(|(_, c)| member(c, "rows")?.as_array())
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let text = |v: Option<&Value>| v.and_then(Value::as_str).unwrap_or("").to_string();
    let mut out: Vec<(String, String, String)> = member(doc, "items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(id, item)| {
            matches!(text(member(item, "kind")).as_str(), "marks@1" | "series@1")
                && !matches!(text(member(item, "role")).as_str(), "" | "decoration")
                && member(item, "visible") != Some(&Value::Bool(false))
                && !hidden.iter().any(|h| h == *id)
                && !picked.contains(&id.as_str())
        })
        .map(|(id, item)| {
            let layer = text(member(item, "layer"));
            let layer = text(doc.pointer(&format!("/layers/{layer}/order")));
            (layer, text(member(item, "order")), id.clone())
        })
        .collect();
    out.sort();
    out.into_iter().map(|(_, _, id)| id).collect()
}
