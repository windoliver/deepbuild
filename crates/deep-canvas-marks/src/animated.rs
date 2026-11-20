//! What the text module's `text.animated` holds for each glyph of a text (#496): its lift and its
//! opacity, and (#2456) how far a write reveal has drawn it, which the frame's raster draws.

use deep_text::Shaped;
use serde_json::{Map, Value};

use crate::scene::Refused;

/// An animated text's glyph as the frame draws it: `[lift, opacity, drawn, filled]`, where a
/// write reveal drawing it has drawn `drawn` of its outline and `filled` of its fill, and a glyph
/// no write is drawing reads 1 for both.
pub type Unit = [f64; 4];

/// A glyph nothing lifts, fades or writes.
pub const UNIT: Unit = [0.0, 1.0, 1.0, 1.0];

/// #466 (#2456): `units` under the text's `reveal` at the progress its evaluated params hold, each
/// glyph by its unit's own share: faded by a fade, written by a write.
pub fn reveal(
    units: &mut [Unit],
    params: &Map<String, Value>,
    run: &Shaped,
    id: &str,
) -> Result<(), Refused> {
    let Some(owns) = crate::animator::reveal_opacity(params, run, id)? else {
        return Ok(());
    };
    let mode = params.get("reveal").and_then(|r| r.get("mode"));
    let write = mode.and_then(Value::as_str) == Some("write");
    for (unit, own) in units.iter_mut().zip(owns) {
        let (kept, written) = revealed(own, write);
        unit[1] *= kept;
        if let Some([drawn, filled]) = written {
            unit[2] = drawn;
            unit[3] = filled;
        }
    }
    Ok(())
}

/// #1969: what a unit's own reveal `own` (0..1) does to its glyph: the share of its opacity it
/// keeps and, while a write draws it, its outline's and its fill's drawn shares. A write draws the
/// outline over the first half of the unit's span, then brings in its fill while the outline turns
/// into its own stroke (Text `text@1`: write mode); a fade fades the glyph by `own`.
pub(crate) fn revealed(own: f64, write: bool) -> (f64, Option<[f64; 2]>) {
    match (write, own) {
        (false, own) => (own, None),
        (true, own) if own <= 0.0 => (0.0, None),
        (true, own) if own < 1.0 => (
            1.0,
            Some([(2.0 * own).min(1.0), (2.0 * own - 1.0).max(0.0)]),
        ),
        (true, _) => (1.0, None),
    }
}

/// A unit's opacity as a reader that can't draw a write shows it: a glyph being written fades in
/// over its unit's span, `(drawn + filled) ÷ 2` being its share of that span.
pub fn faded(unit: Unit) -> f64 {
    unit[1] * (unit[2] + unit[3]) / 2.0
}
