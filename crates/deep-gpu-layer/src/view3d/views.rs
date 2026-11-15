//! #506: view overlays in `view3d` (Overlay: `overlay.view@1`). Each is the same call run again
//! on the document seen from the overlay's camera at its rect's size, with every view overlay
//! taken out, before the main view opens: the whole frame chain, its look, the status guard and
//! status colors included, in a session and renderer of its own, so its backdrop, mirror, light
//! cut and levels of detail are its own. Its frames' final bytes, kept in a folder of their own
//! for the run rather than held in memory, are laid over the main frame's rect, a border in its
//! role just outside it.

use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::views::{self, Placed};
use serde_json::{json, Value};

use crate::{refused, App};

/// A view overlay's frames, as its own run drew them, in the order the call draws them: a file
/// each in a folder gone with it.
pub(super) struct Shown {
    pub placed: Placed,
    dir: std::path::PathBuf,
}

impl Drop for Shown {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// What a view overlay's own run carries: the folder its frames go to and how many it drew, and
/// the main view's document, which a planted core draws first.
pub(super) struct Sub {
    dir: std::path::PathBuf,
    count: usize,
    pub main: Value,
}

impl Sub {
    /// Keeps the next frame's final bytes.
    pub fn keep(&mut self, bytes: &[u8]) -> Result<(), Value> {
        std::fs::write(self.dir.join(format!("{}.bgra", self.count)), bytes)
            .map_err(|e| refused("not_written", format!("a view overlay's frame: {e}")))?;
        self.count += 1;
        Ok(())
    }
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
    let placed = views::placed(doc, size, Some(look)).map_err(|r| refused(r.code, r.path))?;
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
        let dir = std::env::temp_dir().join(format!(
            "deep-gpu-view-{}-{}",
            std::process::id(),
            p.id
        ));
        std::fs::create_dir_all(&dir)
            .map_err(|e| refused("not_written", format!("{}: {e}", p.id)))?;
        let held = Shown { placed: p, dir: dir.clone() };
        let mut sub = Some(Sub {
            dir,
            count: 0,
            main: doc.clone(),
        });
        let ran = super::run_view(app, out, &c, &mut sub);
        let _ = std::fs::remove_file(&path);
        ran?;
        shown.push(held);
    }
    Ok(shown)
}

/// Lays each view overlay's `k`-th frame over `bgra` (the main frame, `size` px), with a 1 px
/// border in its role around the rect.
pub(super) fn composite(shown: &[Shown], k: usize, bgra: &mut [u8], size: [u32; 2]) {
    for s in shown {
        let Ok(frame) = std::fs::read(s.dir.join(format!("{k}.bgra"))) else { continue };
        let [r, g, b] = s.placed.border;
        views::lay(&s.placed, &frame, bgra, size, [b, g, r, 255]);
    }
}
