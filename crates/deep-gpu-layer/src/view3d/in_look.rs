use serde_json::Value;

use crate::{status, Planted};

pub(super) fn in_look_status(
    planted: Option<Planted>,
    look_json: &Value,
) -> Result<Option<deep_canvas_marks::look::Status>, Value> {
    if planted != Some(Planted::StatusInLook) {
        return Ok(None);
    }
    status::status_of(look_json)
}
