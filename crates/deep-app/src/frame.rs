//! Issue #1808: the window comes back as you left it. Its frame, the list's width and whether the list is hidden (which
//! of the two regions a window too narrow for both shows) are kept in `~/.deepbuild/app/window.json` each time one
//! changes, so a quit keeps them however it comes. What's selected isn't kept: the window opens where #1461 says. A kept
//! frame on no display opens at the opening size, centred, and no window opens smaller than its smallest.

use std::cell::RefCell;
use std::path::PathBuf;

use gpui_kit::*;
use serde::{Deserialize, Serialize};

use crate::chrome::sizes;

/// What's kept of the window.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Kept {
    /// The display the window was on, by the UUID the OS keeps for it across launches.
    #[serde(default)]
    pub display: Option<String>,
    /// The frame, `[x, y, w, h]` in that display's points from its top left.
    #[serde(default)]
    pub frame: Option<[f32; 4]>,
    /// The list's width as you left it.
    #[serde(default)]
    pub list: Option<f32>,
    /// A narrow window shows the page, not the list.
    #[serde(default)]
    pub hidden: bool,
}

/// Where the window's state is kept, under the hub's root beside the app's other files.
pub fn path() -> PathBuf {
    crate::hub::root().join("app").join("window.json")
}

/// What was kept, or nothing kept when the file is missing or unreadable.
pub fn read() -> Kept {
    std::fs::read_to_string(path())
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

thread_local! {
    /// What this process kept last, so an unchanged state writes nothing; `None` until the window keeps its state.
    static KEPT: RefCell<Option<Kept>> = const { RefCell::new(None) };
}

/// From now on, each change this process makes to what's kept is written. Only the app's own window keeps its state;
/// a replica's never does.
pub fn start(kept: Kept) {
    KEPT.with(|k| *k.borrow_mut() = Some(kept));
}

/// Changes what's kept and writes it, when the window keeps its state and something changed.
pub fn keep(change: impl FnOnce(&mut Kept)) {
    let Some(mut kept) = KEPT.with(|k| k.borrow().clone()) else {
        return;
    };
    let before = kept.clone();
    change(&mut kept);
    if kept == before {
        return;
    }
    KEPT.with(|k| *k.borrow_mut() = Some(kept.clone()));
    let file = path();
    let write = || -> std::io::Result<()> {
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let spare = file.with_extension("json.new");
        std::fs::write(&spare, serde_json::to_vec_pretty(&kept)?)?;
        std::fs::rename(spare, &file)
    };
    if let Err(error) = write() {
        eprintln!(
            "deep-app: couldn't keep the window at {}: {error}",
            file.display()
        );
    }
}

/// Keeps the window's frame and the display it's on, as it is now: a full-screen window's the frame it goes back to.
pub fn keep_window(window: &Window, cx: &App) {
    let bounds = window.window_bounds().get_bounds();
    let display = window
        .display(cx)
        .and_then(|display| display.uuid().ok())
        .map(|uuid| uuid.to_string());
    keep(|kept| {
        kept.display = display;
        kept.frame = Some([
            f32::from(bounds.origin.x),
            f32::from(bounds.origin.y),
            f32::from(bounds.size.width),
            f32::from(bounds.size.height),
        ]);
    });
}

/// The window's smallest size, from the look's shell (#1808).
pub fn smallest() -> Size<Pixels> {
    let s = sizes();
    size(s.window_min.0, s.window_min.1)
}

/// Where the window opens: the kept frame on its display, when that display is here and the frame is on it, at least
/// the smallest size; else the opening size, centred on the main display.
pub fn opening(kept: &Kept, cx: &App) -> (WindowBounds, Option<DisplayId>) {
    let s = sizes();
    let centred = || {
        (
            WindowBounds::centered(size(s.window.0, s.window.1), cx),
            None,
        )
    };
    let (Some(uuid), Some([x, y, w, h])) = (kept.display.as_deref(), kept.frame) else {
        return centred();
    };
    let Some(display) = cx
        .displays()
        .into_iter()
        .find(|display| display.uuid().is_ok_and(|other| other.to_string() == uuid))
    else {
        return centred();
    };
    let least = smallest();
    let frame = Bounds::new(
        point(px(x), px(y)),
        size(px(w).max(least.width), px(h).max(least.height)),
    );
    if !on(frame, display.bounds().size) {
        return centred();
    }
    (WindowBounds::Windowed(frame), Some(display.id()))
}

/// Whether a frame shows on a display `area` big: enough of its top, where it's dragged from, is on it.
fn on(frame: Bounds<Pixels>, area: Size<Pixels>) -> bool {
    let s = sizes();
    let left = frame.origin.x.max(px(0.));
    let right = (frame.origin.x + frame.size.width).min(area.width);
    let top = frame.origin.y;
    let wide = right - left;
    top >= px(0.) && top + s.space(5) <= area.height && wide >= s.space(5) * 2.
}

#[cfg(test)]
mod tests {
    use super::*;

    #[std::prelude::v1::test]
    fn a_frame_whose_top_is_on_the_display_shows_and_one_beside_it_doesnt() {
        let (wide, tall) = (1512., 982.);
        let display = size(px(wide), px(tall));
        let (w, h) = (1200., 800.);
        let frame = |x: f32, y: f32| Bounds::new(point(px(x), px(y)), size(px(w), px(h)));
        assert!(on(frame(100., 80.), display));
        // Hanging off the bottom right, its top still on the display.
        assert!(on(frame(1400., 900.), display));
        assert!(!on(frame(1600., 80.), display), "right of the display");
        assert!(!on(frame(100., 1000.), display), "below it");
        assert!(!on(frame(-1300., 80.), display), "left of it");
        assert!(!on(frame(100., -40.), display), "its top above the display");
    }
}
