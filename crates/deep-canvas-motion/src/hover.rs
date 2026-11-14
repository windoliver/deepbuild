//! #539: a pick control's hover as a driver reads it (canvas primitives: Control: point,
//! "`<control>.hover`: the cell or ground point under the pointer (viewer class)"), the var
//! `controls/<id>/hover/<k>`: the hovered cell's cx (k 0) or cy (k 1) while a live view writes the
//! hover into the control, else none, a non-finite value, so the driver writes its fallback.
//! Goldens, exports and checks never carry a hover, so they evaluate it as none. The value rides
//! beside the controls' defaults, so a frame keys by it.

use serde_json::{Map, Value};

use crate::doc::DriverInput;
use crate::program::CoreInput;

/// The driver input a var names, when it is a control's hover.
pub(crate) fn input(text: &str) -> Option<DriverInput> {
    let (id, k) = text.strip_prefix("controls/")?.split_once("/hover/")?;
    let named = !id.is_empty() && !id.contains('/') && k.parse::<usize>().is_ok();
    named.then(|| DriverInput::Hover(format!("{id}/hover/{k}")))
}

/// Control `id`'s hover components, keyed `<id>/hover/<k>`, as a live view wrote them.
pub(crate) fn defaults(id: &str, control: &Map<String, Value>) -> Vec<(String, f64)> {
    let cell = control.get("hover").and_then(Value::as_array);
    cell.into_iter()
        .flatten()
        .enumerate()
        .map(|(k, v)| (format!("{id}/hover/{k}"), v.as_f64().unwrap_or(f64::NAN)))
        .collect()
}

/// What a driver reads of hover `key`: its component, or none.
pub(crate) fn read(defaults: &[(String, f64)], key: &str) -> CoreInput {
    let default = defaults
        .iter()
        .find(|(k, _)| k == key)
        .map_or(f64::NAN, |(_, v)| *v);
    CoreInput::Control {
        entries: Vec::new(),
        default,
        range: (f64::NEG_INFINITY, f64::INFINITY),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_hover_var_reads_the_cell_a_live_view_wrote_and_none_without_one() {
        assert_eq!(
            input("controls/place/hover/1"),
            Some(DriverInput::Hover("place/hover/1".into()))
        );
        assert_eq!(input("controls/place/value"), None);
        assert_eq!(input("controls/place/hover/x"), None);
        let live = defaults(
            "place",
            json!({"kind": "press", "hover": [2, 3]})
                .as_object()
                .expect("a control"),
        );
        assert_eq!(
            live,
            vec![("place/hover/0".into(), 2.0), ("place/hover/1".into(), 3.0)]
        );
        let at = |d: &[(String, f64)]| match read(d, "place/hover/1") {
            CoreInput::Control { default, .. } => default,
            _ => f64::INFINITY,
        };
        assert_eq!(at(&live), 3.0);
        assert!(at(&defaults(
            "place",
            json!({"kind": "press"}).as_object().expect("a control")
        ))
        .is_nan());
    }
}
