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
