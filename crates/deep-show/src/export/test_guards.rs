//! Issue #157's `test.guards` items, planted by a test build as the export draws (the #157
//! acceptance README: Cargo features): one NaN in a frame's float target, the device lost as a
//! frame is drawn, and a rect drawn in another colour the second time this process draws a frame.
//! A shipped build holds none of this.

use std::collections::BTreeMap;
use std::sync::Mutex;

use deep_canvas::document::frame_rate_of;
use deep_canvas::time as clock;
use serde_json::Value;

/// The frame index of time `t` at the document's own rate.
pub(crate) fn frame_of(doc: &Value, t: i64) -> i64 {
    let (p, q) = doc
        .get("transport")
        .and_then(frame_rate_of)
        .unwrap_or((60, 1));
    clock::frame_length(p, q).map_or(0, |f| clock::index(t, f))
}

/// Each item of `kind` in the document, with its params.
fn items<'a>(doc: &'a Value, kind: &'a str) -> impl Iterator<Item = (&'a String, &'a Value)> {
    doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(move |(_, i)| i["kind"] == kind)
        .map(|(id, i)| (id, &i["params"]))
}

/// Whether a `test.device_loss@1` item loses the device as frame `k` is drawn.
pub(crate) fn loses_device_at(doc: &Value, k: i64) -> bool {
    items(doc, "test.device_loss@1").any(|(_, p)| p["frame"].as_i64() == Some(k))
}

/// The `test.nonfinite@1` items that write a NaN into frame `k`'s float target: each item and the
/// pixel it writes.
pub(crate) fn nonfinite_at(doc: &Value, k: i64) -> Vec<(String, [u32; 2])> {
    items(doc, "test.nonfinite@1")
        .filter(|(_, p)| p["frame"].as_i64() == Some(k))
        .map(|(id, p)| {
            (
                id.clone(),
                [0, 1].map(|i| p["pixel"][i].as_u64().unwrap_or(0) as u32),
            )
        })
        .collect()
}

/// How many times this process has drawn each redraw item's frame.
static DRAWN: Mutex<BTreeMap<(String, i64), u32>> = Mutex::new(BTreeMap::new());

/// Paints each `test.redraw@1` rect into frame `k`'s straight RGBA rows at `size`, its `box` in
/// document units: in its `fill` role, and in `again` the second time this process draws its
/// frame.
pub(crate) fn paint(
    doc: &Value,
    k: i64,
    rgba: &mut [u8],
    size: [u16; 2],
    role: impl Fn(&str) -> Option<[u8; 3]>,
) {
    let own = [0, 1].map(|i| {
        doc["size"][i]
            .as_f64()
            .unwrap_or(f64::from(size[i]))
            .max(1.0)
    });
    let scale = [0, 1].map(|i| f64::from(size[i]) / own[i]);
    for (id, p) in items(doc, "test.redraw@1") {
        let again = p["frame"].as_i64() == Some(k) && {
            let mut drawn = DRAWN.lock().unwrap_or_else(|e| e.into_inner());
            let n = drawn.entry((id.clone(), k)).or_default();
            *n += 1;
            *n == 2
        };
        let name = if again { &p["again"] } else { &p["fill"] };
        let Some(color) = name.as_str().and_then(&role) else {
            continue;
        };
        let b = [0, 1, 2, 3].map(|i| p["box"][i].as_f64().unwrap_or(0.0));
        let (x0, y0) = (
            (b[0] * scale[0]).round() as i64,
            (b[1] * scale[1]).round() as i64,
        );
        let (x1, y1) = (
            ((b[0] + b[2]) * scale[0]).round() as i64,
            ((b[1] + b[3]) * scale[1]).round() as i64,
        );
        let (w, h) = (i64::from(size[0]), i64::from(size[1]));
        for y in y0.clamp(0, h)..y1.clamp(0, h) {
            for x in x0.clamp(0, w)..x1.clamp(0, w) {
                let at = 4 * (y * w + x) as usize;
                rgba[at..at + 4].copy_from_slice(&[color[0], color[1], color[2], 255]);
            }
        }
    }
}
