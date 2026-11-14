//! The playable page (#169; canvas primitives: Export: playable page): a live piece's discrete
//! states and the edges between them, listed here, rendered by deep-show through the export,
//! and written as a folder a browser plays with no network and no code from the document.

pub mod list;
pub mod write;

use serde_json::Value;

/// A control's input class (Scope and input classes): its own `class`; a choice that names a
/// variant set is `view`; any other `document`.
pub fn class_of(control: &Value) -> &str {
    match control.get("class").and_then(Value::as_str) {
        Some(c) => c,
        None if control.get("variant").is_some() => "view",
        None => "document",
    }
}
