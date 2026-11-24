//! #290: this copy's player as a driver reads it (canvas primitives: Net: this copy's player,
//! "Readers: drivers"; Object: hidden view, "a driver may read `match.me`"): the var `match.me`
//! is the document's `match.me` view value, 1 to 8 as the relay numbered the copy, 1 for a piece
//! played alone, and 0 for `none`, which names no player. It holds over the piece's time. The
//! value rides beside the controls' defaults while a driver reads it, so the program keys by
//! it and each player's frames cache apart.

use serde_json::{Map, Value};

use crate::doc::{Driver, DriverInput};
use crate::program::CoreInput;

/// The var's text.
pub const VAR: &str = "match.me";
/// Its key beside the controls' defaults: no control's ID, since an ID holds no `/`.
const KEY: &str = "view/match.me";

/// The view value for `doc`'s drivers, when one of them reads it.
pub(crate) fn default(doc: &Map<String, Value>, drivers: &[Driver]) -> Option<(String, f64)> {
    let reads = |d: &Driver| {
        d.inputs
            .iter()
            .any(|(_, i)| matches!(i, DriverInput::Array(a) if a == VAR))
    };
    let me = deep_canvas::columns::match_me(doc.get(VAR).unwrap_or(&Value::Null));
    (drivers.iter().any(reads)).then(|| (KEY.to_string(), me.map_or(0.0, f64::from)))
}

/// What a driver reads of it.
pub(crate) fn read(defaults: &[(String, f64)]) -> CoreInput {
    crate::hover::read(defaults, KEY)
}
