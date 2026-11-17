//! A bundle's document as the web player plays it (#172): the form the app's export draws from, on
//! the recorded input track. Its worlds are baked and its logic items stepped on that track over the
//! transport's span, each program inlined, and the core's column view resolved, by the same calls
//! the app makes.

use deep_canvas::document::Issue;
use deep_canvas::registry::Sealed;
use serde_json::Value;

/// `form` with `entries` inlined as its `track`; `form` itself when there are none.
pub fn with_track(form: &Value, entries: &[Value]) -> Value {
    let mut out = form.clone();
    if !entries.is_empty() {
        out["track"] = Value::Array(entries.to_vec());
    }
    out
}

/// `doc` played on `track`, its programs and assets read by `read` (by SHA-256): what the player's
/// session loads. A world or logic item the modules refuse is the issue that stops it.
pub fn played(
    sealed: &Sealed,
    doc: &Value,
    track: &[Value],
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
) -> Result<Value, Box<Issue>> {
    let mut form = with_track(doc, track);
    #[cfg(feature = "physics")]
    crate::worlds::inline(sealed, &mut form, track, &crate::worlds::Host::default())?;
    #[cfg(feature = "logic")]
    {
        let piece = crate::logic::logic_piece(sealed, &form, track, read, false)?;
        crate::logic::inline_logic(&mut form, piece, track, false)?;
        crate::logic::inline_programs(&mut form, read);
    }
    #[cfg(not(feature = "logic"))]
    let _ = read;
    let _ = crate::logic::column_view(sealed, &mut form, 0);
    Ok(form)
}
