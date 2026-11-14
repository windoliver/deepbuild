//! #506: view overlays in `view3d` (Overlay: `overlay.view@1`). Each is the same call run again
//! on the document seen from the overlay's camera at its rect's size, with every view overlay
//! taken out, before the main view opens: the whole frame chain, its look, the status guard and
//! status colors included, in a session and renderer of its own, so its backdrop, mirror, light
//! cut and levels of detail are its own. Its frames' final bytes are laid over the main frame's
//! rect, a border in its role just outside it.

use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::views::{self, Placed};
use serde_json::{json, Value};

use crate::{refused, App};

/// A view overlay's frames, as its own run drew them, in the order the call draws them.
pub(super) struct Shown {
    pub placed: Placed,
    pub frames: Vec<Vec<u8>>,
}

/// What a view overlay's own run carries: the frames it drew, and the main view's document and
/// size, which a planted core draws first.
pub(super) struct Sub {
    pub frames: Vec<Vec<u8>>,
    pub main: Value,
}

/// The call's fields a view overlay's run never takes: what reads or reports the main view.
const MAIN_ONLY: [&str; 14] = [
    "window", "clicks", "capture", "targets", "timings", "cold", "latency", "determinism",
    "viewer", "overlays", "light_cut", "evaluate", "sway", "strokes",
];

/// Each view overlay of `doc` (the call's document, `size` px), drawn by its own run of `call`.
pub(super) fn run_all(
    app: &mut App,
    out: &str,
    call: &Value,
    doc: &Value,
    size: [u32; 2],
    look: &Look3,
) -> Result<Vec<Shown>, Value> {
    let placed = views::placed(doc, size, look).map_err(|r| refused(r.code, r.path))?;
    let mut shown = Vec::new();
    for p in placed {
        let path = std::env::temp_dir().join(format!(
            "deep-gpu-view-{}-{}.json",
            std::process::id(),
            p.id
        ));
        std::fs::write(&path, views::document(doc, &p).to_string())
            .map_err(|e| refused("not_written", format!("{}: {e}", p.id)))?;
        let mut c = call.clone();
        if let Some(o) = c.as_object_mut() {
            for k in MAIN_ONLY {
                o.remove(k);
            }
            o.insert("doc".into(), json!(path));
            o.insert("size".into(), json!([p.rect[2], p.rect[3]]));
        }
        let mut sub = Some(Sub {
            frames: Vec::new(),
            main: doc.clone(),
        });
        let ran = super::run_view(app, out, &c, &mut sub);
        let _ = std::fs::remove_file(&path);
        ran?;
        shown.push(Shown {
            placed: p,
            frames: sub.map(|s| s.frames).unwrap_or_default(),
        });
    }
    Ok(shown)
}

/// Lays each view overlay's `k`-th frame over `bgra` (the main frame, `size` px), with a 1 px
/// border in its role around the rect.
pub(super) fn composite(shown: &[Shown], k: usize, bgra: &mut [u8], size: [u32; 2]) {
    let [fw, fh] = size.map(|v| v as i64);
    for s in shown {
        let Some(frame) = s.frames.get(k) else { continue };
        let [x0, y0, w, h] = s.placed.rect.map(i64::from);
        let mut put = |x: i64, y: i64, px: [u8; 4]| {
            if (0..fw).contains(&x) && (0..fh).contains(&y) {
                let o = ((y * fw + x) * 4) as usize;
                bgra[o..o + 4].copy_from_slice(&px);
            }
        };
        for y in 0..h {
            for x in 0..w {
                let o = ((y * w + x) * 4) as usize;
                if let Some(p) = frame.get(o..o + 4) {
                    put(x0 + x, y0 + y, [p[0], p[1], p[2], p[3]]);
                }
            }
        }
        let [r, g, b] = s.placed.border;
        for x in x0 - 1..=x0 + w {
            put(x, y0 - 1, [b, g, r, 255]);
            put(x, y0 + h, [b, g, r, 255]);
        }
        for y in y0..y0 + h {
            put(x0 - 1, y, [b, g, r, 255]);
            put(x0 + w, y, [b, g, r, 255]);
        }
    }
}
