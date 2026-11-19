//! #2776: the web player's export takes its refusals and stand-ins from each 3D entry's web answer
//! (canvas primitives: Paths; Export: web player). An item whose kind, or a field it sets, answers
//! the web `refused` is refused with that answer's code and a message naming the entry, the path
//! and, for `path_undefined`, the open task; one that answers `stand_in` is listed in the receipt
//! with the answer's words. Nothing else in the export reads the answers.

use deep_canvas::registry::paths::Answer;
use deep_canvas::registry::Sealed;
use serde_json::{json, Value};

/// The web path's refusals and stand-ins for `doc`'s items, each naming the item and its entry
/// (`family.name@major`, or `…@major.<field>` for a field's own answer), in item order.
pub(super) fn web(sealed: &Sealed, doc: &Value) -> (Vec<Value>, Vec<Value>) {
    let (mut refused, mut stand_ins) = (Vec::new(), Vec::new());
    let items = doc.get("items").and_then(Value::as_object);
    for (id, item) in items.into_iter().flatten() {
        let Some(kind) = item.get("kind").and_then(Value::as_str) else {
            continue;
        };
        let Some((_, answers)) = sealed.paths_of(kind) else {
            continue;
        };
        for (field, answer) in answers.for_item("web", &item["params"]) {
            let entry = field.map_or(kind.to_string(), |f| format!("{kind}.{f}"));
            match answer {
                Answer::Refused { .. } => {
                    if let Some((code, why)) = answer.refusal(&entry, "web") {
                        refused.push(json!({"item": id, "code": code, "entry": entry, "path": "web", "why": why}));
                    }
                }
                Answer::StandIn { draws, receipt } => stand_ins.push(
                    json!({"item": id, "entry": entry, "path": "web", "draws": draws, "receipt": receipt}),
                ),
                Answer::Same { .. } | Answer::NotApplicable { .. } => {}
            }
        }
    }
    (refused, stand_ins)
}
