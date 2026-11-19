//! Issue #1592: the contact sheet, `deep-app --contact-sheet [<png>]` in a build with the `contact-sheet` feature, in
//! no shipped build. One window with no hub and no record shows every status-map entry's mark and every icon the chrome
//! draws, each in a tile of its own, through the app's own builders and the look's roles, in the appearance the window
//! has. A mark's tile shows it in its slot beside the state words that share its entry, as a row draws it, with the
//! entry under them; an icon's tile shows it at both its sizes beside its name and size. Each tile leads with its
//! drawing four times larger, for a close look. A tile's identifier names what it holds: `contact-sheet:mark:<entry>`,
//! `contact-sheet:icon:<icon>`.
//!
//! Given a PNG, the window is above every other one, so the platform hands it drawables. Once it has drawn the sheet it
//! reads back the frame it presented, as #1434's chrome fixture does, with no screen permission, writes it there,
//! prints one report line of what it drew where, and quits: the picture #1592's AC4 takes from the real app.

use std::cell::RefCell;
use std::path::PathBuf;
use std::rc::Rc;

use deep_canvas_marks::look;
use gpui_apple::metal_renderer::layer_colorspace;
use gpui_kit::*;
use objc2_app_kit::{NSView, NSWindowOcclusionState};
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde_json::{json, Value};

use crate::chrome::{self, sizes, Typed as _};
use crate::icons::{self, Place};
use crate::states;
use crate::views::observed;

/// How much larger a tile's close look is than its drawing.
const LARGER: f32 = 4.;

/// Where the sheet laid out each mark and each icon at its size, in points from the content's top-left.
#[derive(Default)]
struct Placed {
    marks: Vec<(&'static str, Bounds<Pixels>)>,
    icons: Vec<(&'static str, Bounds<Pixels>)>,
}

/// Opens the contact sheet's window at the look's opening size; given `png`, takes its picture there and quits.
pub fn open(png: Option<PathBuf>, cx: &mut App) {
    let (width, height) = sizes().window;
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
            None,
            size(width, height),
            cx,
        ))),
        kind: if png.is_some() {
            WindowKind::PopUp
        } else {
            WindowKind::Normal
        },
        ..Default::default()
    };
    let placed = Rc::new(RefCell::new(Placed::default()));
    open_window(options, cx, move |window, cx| {
        chrome::follow(window, cx);
        if let Some(png) = png {
            let placed = placed.clone();
            shown(window, 0, move |window, frame, cx| {
                let written = match frame.map(|f| f.save(&png).map_err(|e| e.to_string())) {
                    Some(Ok(())) => json!(png.display().to_string()),
                    Some(Err(why)) => json!({"error": why}),
                    None => json!({"error": "no frame was read back"}),
                };
                println!("{}", report(window, &placed.borrow(), written));
                cx.quit();
            });
        }
        cx.new(|_| Sheet { placed })
    })
    .expect("the contact sheet's window opens");
}

/// Runs `done` with the frame the window presents once AppKit reports it visible, or after 240 frames, read back from
/// its layer's drawable; with none when 120 more frames bring none.
fn shown(
    window: &mut Window,
    frames: u32,
    done: impl FnOnce(&mut Window, Option<image::RgbaImage>, &mut App) + 'static,
) {
    window.on_next_frame(move |window, _| {
        let visible = window_view(window)
            .window()
            .is_some_and(|w| w.occlusionState().contains(NSWindowOcclusionState::Visible));
        if visible || frames > 240 {
            layer_colorspace::read_next_frame();
            window.refresh();
            read_back(window, 0, done);
        } else {
            window.refresh();
            shown(window, frames + 1, done);
        }
    });
}

fn read_back(
    window: &mut Window,
    tries: u32,
    done: impl FnOnce(&mut Window, Option<image::RgbaImage>, &mut App) + 'static,
) {
    window.on_next_frame(move |window, cx| match layer_colorspace::take_frame() {
        Some(frame) => done(window, Some(frame), cx),
        None if tries < 120 => {
            window.refresh();
            read_back(window, tries + 1, done);
        }
        None => done(window, None, cx),
    });
}

fn window_view(window: &Window) -> &NSView {
    let handle = HasWindowHandle::window_handle(window).expect("the window's handle");
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        panic!("an AppKit window");
    };
    // SAFETY: gpui's AppKit handle wraps its NSView, alive while the gpui window is.
    unsafe { handle.ns_view.cast::<NSView>().as_ref() }
}

/// The report line: the appearance drawn, the window's scale and content size, and each mark and icon at its size
/// where the sheet laid it out, in points from the content's top-left.
fn report(window: &Window, placed: &Placed, png: Value) -> Value {
    let rect = |at: &Bounds<Pixels>| {
        [at.origin.x, at.origin.y, at.size.width, at.size.height].map(f32::from)
    };
    let content = window.viewport_size();
    let content = [content.width, content.height].map(f32::from);
    let marks: Vec<Value> = placed
        .marks
        .iter()
        .map(|(entry, at)| json!({"entry": entry, "rect": rect(at)}))
        .collect();
    let icons: Vec<Value> = placed
        .icons
        .iter()
        .map(|(name, at)| {
            let size = f32::from(at.size.width).max(f32::from(at.size.height));
            json!({"name": name, "size": size, "rect": rect(at)})
        })
        .collect();
    json!({
        "contact_sheet": 1592,
        "appearance": if chrome::is_dark(window) { "dark" } else { "light" },
        "scale": window.scale_factor(),
        "window": content,
        "png": png,
        "marks": marks,
        "icons": icons,
    })
}

struct Sheet {
    placed: Rc<RefCell<Placed>>,
}

impl Render for Sheet {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let (chrome, s) = (chrome::of(window), sizes());
        // Each frame lays the sheet out again, and keeps where.
        *self.placed.borrow_mut() = Placed::default();
        let tile = |id: String, name: &str, larger: AnyElement| {
            observed(ElementId::Name(id.into()))
                .role(Role::Label)
                .aria_label(name.to_owned())
                .flex()
                .items_center()
                .gap(s.space(3))
                .p(s.space(3))
                .child(larger)
        };
        let line = |drawing: AnyElement, words: String| {
            div()
                .flex()
                .items_center()
                .gap(s.space(1))
                .child(drawing)
                .child(words)
        };
        let marks = look::STATES.into_iter().map(|entry| {
            let placed = self.placed.clone();
            let mark = kept(icons::mark(entry, 0), move |at| {
                placed.borrow_mut().marks.push((entry, at));
            });
            let words: Vec<&str> = states::TABLE
                .iter()
                .filter(|row| row.1 == entry)
                .map(|row| row.0)
                .collect();
            let larger = icons::mark_at(entry, s.mark * LARGER, 0).into_any_element();
            tile(
                format!("contact-sheet:mark:{entry}"),
                look::word(entry).unwrap_or(entry),
                larger,
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(s.space(0))
                    .child(line(mark, words.join(" · ")))
                    .child(
                        div()
                            .typed(s.small)
                            .text_color(chrome.ink_secondary)
                            .child(entry),
                    ),
            )
        });
        let drawn = icons::DRAWN.into_iter().map(|(name, _)| {
            let at = |place: Place| {
                let placed = self.placed.clone();
                let icon = kept(icons::icon(name, place, chrome.ink_secondary), move |at| {
                    placed.borrow_mut().icons.push((name, at));
                });
                line(icon, format!("{name} · {}", f32::from(place.size())))
            };
            let larger = icons::icon(name, Place::Page, chrome.ink_secondary)
                .size(Place::Page.size() * LARGER)
                .into_any_element();
            tile(format!("contact-sheet:icon:{name}"), name, larger).child(
                div()
                    .flex()
                    .flex_col()
                    .gap(s.space(1))
                    .child(at(Place::Row))
                    .child(at(Place::Page)),
            )
        });
        div()
            .size_full()
            .bg(chrome.ground)
            .text_color(chrome.ink_primary)
            .typed(s.body)
            .p(s.space(5))
            .flex()
            .flex_wrap()
            .content_start()
            .items_start()
            .gap(s.space(4))
            .children(marks)
            .children(drawn)
    }
}

/// `drawing`, keeping where it was laid out.
fn kept(drawing: impl IntoElement, keep: impl FnOnce(Bounds<Pixels>) + 'static) -> AnyElement {
    div()
        .flex_none()
        .flex()
        .relative()
        .child(drawing)
        .child(
            canvas(move |at, _, _| keep(at), |_, _, _, _| {})
                .absolute()
                .inset_0(),
        )
        .into_any_element()
}
