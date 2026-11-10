//! Issue #990: a hosted terminal and its session as the app shows them, at the reference window, for
//! `deep-show serve`'s `screenshot` and `ax`. The shell draws the sidebar, whose session rows show
//! their readings, beside the terminal tab in the center, which draws the terminal's screen through
//! the app's own grid ([`deep_app::cells::terminal`]) with your composition at its cursor.
//!
//! The spec, a JSON file serve writes: `{"terminal": {"cols", "rows", "screen": hex, "preedit"} |
//! null, "events": [record event], "path": png}`. `screen` is the bytes that draw the terminal's
//! screen as its host holds it; `events` are the record's events, which the sidebar reads.
//!
//! A screenshot is drawn headless with GPUI's offscreen renderer at scale 2, as the replica draws.
//! What accessibility reads is the real, shown window (macOS): its terminal tab focused, as
//! VoiceOver finds it, read back through AppKit as an assistive client reads it.

use std::path::Path;

use deep_app::cells::{terminal, Screen};
use deep_app::views::{Layout, EXTENSION, LINE, SIDEBAR};
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::shell::{open_shell_with, window_options};
use crate::SCALE;

/// The grid's palette defaults, as the hub's terminals draw them.
const FG: [u8; 3] = [0xe8, 0xe8, 0xe8];
const BG: [u8; 3] = [0x10, 0x10, 0x10];

/// The terminal tab: the screen and your composition, focusable so accessibility can focus it.
pub struct Tab {
    screen: Option<Screen>,
    preedit: Option<String>,
    pub focus_handle: FocusHandle,
}

impl Render for Tab {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let screen = self.screen.clone().unwrap_or_else(blank_screen);
        div().size_full().child(terminal(
            "terminal-tab",
            screen,
            self.preedit.clone(),
            &self.focus_handle,
        ))
    }
}

fn blank_screen() -> Screen {
    Screen::drawn(1, 1, b"", FG, BG)
}

/// The terminal's screen the spec gives, drawn as its emulator holds it.
fn screen_of(spec: &Value) -> Option<Screen> {
    let t = &spec["terminal"];
    let (cols, rows) = (t["cols"].as_u64()? as u16, t["rows"].as_u64()? as u16);
    let hex = t["screen"].as_str()?;
    let bytes: Vec<u8> = (0..hex.len() / 2)
        .filter_map(|i| u8::from_str_radix(hex.get(2 * i..2 * i + 2)?, 16).ok())
        .collect();
    Some(Screen::drawn(cols, rows, &bytes, FG, BG))
}

/// Opens the shell with the sidebar over the spec's events and the terminal tab in the center.
pub fn open(
    spec: &Value,
    options: WindowOptions,
    cx: &mut App,
) -> (AnyWindowHandle, Option<Entity<Tab>>) {
    deep_app::record::install_local(spec["events"].as_array().cloned().unwrap_or_default());
    let layout = Layout {
        sidebar: SIDEBAR.into(),
        center: vec![EXTENSION.into()],
        active: 0,
        line: LINE.into(),
    };
    let screen = screen_of(spec);
    let preedit = spec["terminal"]["preedit"].as_str().map(str::to_owned);
    let mut tab = None;
    let (handle, _) = open_shell_with(options, &layout, cx, |_, cx| {
        let view = cx.new(|cx| Tab {
            screen,
            preedit,
            focus_handle: cx.focus_handle(),
        });
        deep_app::open::place_extension(view.clone().into(), cx);
        tab = Some(view);
    });
    (handle, tab)
}

/// The part of the window a screenshot shows, in device pixels: a session's row with its readings
/// (`part: "row"`), else the terminal tab's slot.
fn part_of(spec: &Value, window: &Window) -> Option<[i64; 4]> {
    let scale = window.scale_factor();
    if spec["part"] != "row" {
        let b = deep_app::views::slot_bounds()?;
        let d = |v: Pixels| (f32::from(v) * scale).round() as i64;
        return Some([
            d(b.origin.x),
            d(b.origin.y),
            d(b.size.width),
            d(b.size.height),
        ]);
    }
    let session = spec["session"].as_str()?;
    let (_, title, _) = deep_app::views::sidebar()
        .into_iter()
        .find(|(s, ..)| s == session)?;
    let readings =
        deep_app::record::with_view(|v| v.table().readings(session).to_vec()).unwrap_or_default();
    let snapshot = crate::snapshot::from_observed(window);
    let nodes = snapshot.flatten();
    let at = nodes.iter().position(|n| {
        n.role == "button" && n.name.as_deref().is_some_and(|t| t.contains(&title))
    })?;
    let [mut x0, mut y0, w, h] = nodes[at].bounds;
    let (mut x1, mut y1) = (x0 + w, y0 + h);
    // The row's readings are the labels drawn under it, in order.
    for n in nodes[at + 1..]
        .iter()
        .take_while(|n| n.name.as_ref().is_some_and(|t| readings.contains(t)))
    {
        let [x, y, w, h] = n.bounds;
        (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x + w), y1.max(y + h));
    }
    let pad = (8. * scale) as i64;
    Some([
        (x0 - pad).max(0),
        (y0 - pad).max(0),
        x1 - x0 + 2 * pad,
        y1 - y0 + 2 * pad,
    ])
}

/// The screenshot the spec asks for, written as a PNG to its `path`: the part of the reference
/// window it names.
pub fn screenshot(spec: &Value) -> Result<Value, String> {
    let path = spec["path"].as_str().ok_or("the spec names no path")?;
    let mut cx = crate::headless_context();
    let (handle, _) = cx.update(|cx| open(spec, window_options(), cx));
    cx.simulate_scale_factor_change(handle, SCALE);
    // Two frames: the first lays the dock out and uploads the glyph pages, the second draws warm.
    for _ in 0..2 {
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .map_err(|e| e.to_string())?;
    }
    let part = cx
        .update_window(handle, |_, window, _| part_of(spec, window))
        .map_err(|e| e.to_string())?
        .ok_or("the window doesn't draw the part the spec names")?;
    let whole = cx
        .capture_screenshot(handle)
        .map_err(|e| format!("offscreen rendering isn't available: {e}"))?;
    let [x, y, w, h] = part.map(|v| v.max(0) as u32);
    let (x, y) = (x.min(whole.width()), y.min(whole.height()));
    let (w, h) = (w.min(whole.width() - x), h.min(whole.height() - y));
    let image = image::imageops::crop_imm(&whole, x, y, w, h).to_image();
    if let Some(dir) = Path::new(path).parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    image.save(path).map_err(|e| e.to_string())?;
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    let sha256: String = Sha256::digest(&bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    Ok(json!({"from": "app", "path": path, "sha256": sha256,
              "w": image.width(), "h": image.height()}))
}

#[cfg(target_os = "macos")]
pub use live::ax;

/// The terminal tab in the real window, as accessibility reads it (macOS).
#[cfg(target_os = "macos")]
mod live {
    use objc2::{msg_send, rc::Retained, runtime::AnyObject, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSView};
    use objc2_foundation::{NSArray, NSRange, NSString};

    use super::*;

    /// Frames the window draws before accessibility is read, so the tree is the drawn one.
    const FRAMES: usize = 8;

    /// Opens the shell, shown and focused, focuses the terminal tab, and once it has drawn prints
    /// one JSON line: the text area's role, value, the line of its insertion point and that line's
    /// text, as AppKit gives them to an assistive client. The window stays up, its tab focused for
    /// VoiceOver, until the process is ended.
    pub fn ax(spec: Value) -> i32 {
        gpui_kit::application().run(move |cx| {
            gpui_kit::init(cx);
            deep_app::init(cx);
            let options = WindowOptions {
                show: true,
                focus: true,
                ..window_options()
            };
            let (handle, tab) = open(&spec, options, cx);
            cx.activate(true);
            handle
                .update(cx, |_, window, cx| {
                    if let Some(tab) = &tab {
                        let focus = tab.read(cx).focus_handle.clone();
                        window.focus(&focus, cx);
                    }
                    window.on_next_frame(move |window, cx| settle(window, cx, 0));
                })
                .expect("the window is open");
        });
        0
    }

    fn settle(window: &mut Window, cx: &mut App, frame: usize) {
        if frame == 0 {
            activate_accessibility();
        }
        if frame < FRAMES {
            window.refresh();
            window.on_next_frame(move |window, cx| settle(window, cx, frame + 1));
            return;
        }
        let _ = cx;
        let answer = read().unwrap_or_else(|why| json!({"code": "ax_failed", "what": why}));
        println!("{answer}");
    }

    fn content_view() -> Result<Retained<NSView>, String> {
        let mtm = MainThreadMarker::new().ok_or("not on the main thread")?;
        let windows = NSApplication::sharedApplication(mtm).windows();
        (0..windows.count())
            .filter_map(|i| windows.objectAtIndex(i).contentView())
            .find(|view| {
                let size = view.bounds().size;
                (size.width - f64::from(crate::WINDOW.0)).abs() < 1.
                    && (size.height - f64::from(crate::WINDOW.1)).abs() < 1.
            })
            .ok_or_else(|| "no window has the reference content size".to_owned())
    }

    /// Asks the content view for its children, as an assistive client does first, which makes
    /// AccessKit's adapter build its tree.
    fn activate_accessibility() {
        if let Ok(view) = content_view() {
            let _: Option<Retained<NSArray<AnyObject>>> =
                unsafe { msg_send![&*view, accessibilityChildren] };
        }
    }

    fn text_area(node: &AnyObject) -> Option<Retained<AnyObject>> {
        let children: Option<Retained<NSArray<AnyObject>>> =
            unsafe { msg_send![node, accessibilityChildren] };
        let children = children?;
        for i in 0..children.count() {
            let child = children.objectAtIndex(i);
            let role: Option<Retained<NSString>> = unsafe { msg_send![&*child, accessibilityRole] };
            if role.is_some_and(|r| r.to_string() == "AXTextArea") {
                return Some(child);
            }
            if let Some(found) = text_area(&child) {
                return Some(found);
            }
        }
        None
    }

    fn read() -> Result<Value, String> {
        let view = content_view()?;
        let area = text_area(&view).ok_or("no AXTextArea in the window's accessibility tree")?;
        let role: Option<Retained<NSString>> = unsafe { msg_send![&*area, accessibilityRole] };
        let value: Option<Retained<AnyObject>> = unsafe { msg_send![&*area, accessibilityValue] };
        let value = value.map(|v| {
            let text: Retained<NSString> = unsafe { msg_send![&*v, description] };
            text.to_string()
        });
        let line: isize = unsafe { msg_send![&*area, accessibilityInsertionPointLineNumber] };
        let range: NSRange = unsafe { msg_send![&*area, accessibilityRangeForLine: line] };
        let text: Option<Retained<NSString>> =
            unsafe { msg_send![&*area, accessibilityStringForRange: range] };
        Ok(json!({
            "role": role.map(|r| r.to_string()),
            "value": value,
            "line": line,
            "line_text": text.map(|t| t.to_string().trim_end_matches('\n').to_owned()),
        }))
    }
}
