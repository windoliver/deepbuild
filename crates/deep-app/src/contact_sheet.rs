//! Issue #1592: the contact sheet, `deep-app --contact-sheet` in a build with the `contact-sheet` feature, in no shipped
//! build. One window with no hub and no record shows every status-map entry's mark and every icon the chrome draws, each
//! in a tile of its own, through the app's own builders and the look's roles, in the appearance the window has. Each
//! tile shows its drawing at the size every surface draws it, beside its word as a row would, then four times larger
//! for a close look. A tile's identifier names what it holds: `contact-sheet:mark:<entry>`, `contact-sheet:icon:<icon>`.

use deep_canvas_marks::look;
use gpui_kit::*;

use crate::chrome::{self, sizes, Typed as _};
use crate::icons;
use crate::views::observed;

/// How much larger a tile's close look is than its drawing.
const LARGER: f32 = 4.;

/// Opens the contact sheet's window at the look's opening size.
pub fn open(cx: &mut App) {
    let (width, height) = sizes().window;
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
            None,
            size(width, height),
            cx,
        ))),
        ..Default::default()
    };
    open_window(options, cx, |window, cx| {
        chrome::follow(window, cx);
        cx.new(|_| Sheet)
    })
    .expect("the contact sheet's window opens");
}

struct Sheet;

impl Render for Sheet {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let (chrome, s) = (chrome::of(window), sizes());
        let tile = |id: String, name: &str| {
            observed(ElementId::Name(id.into()))
                .role(Role::Label)
                .aria_label(name.to_owned())
                .flex()
                .flex_col()
                .items_center()
                .gap(s.space(3))
                .p(s.space(3))
        };
        let beside = |drawing: AnyElement, word: &str| {
            div()
                .flex()
                .items_center()
                .gap(s.space(1))
                .child(drawing)
                .child(
                    div()
                        .text_color(chrome.ink_secondary)
                        .child(word.to_owned()),
                )
        };
        let marks = look::STATES.into_iter().map(|entry| {
            let word = look::word(entry).unwrap_or(entry);
            tile(format!("contact-sheet:mark:{entry}"), word)
                .child(beside(icons::mark(entry, 0).into_any_element(), word))
                .child(icons::mark_at(entry, s.mark * LARGER, 0))
        });
        let drawn = icons::DRAWN.into_iter().map(|(name, place)| {
            let icon = || icons::icon(name, place, chrome.ink_secondary);
            tile(format!("contact-sheet:icon:{name}"), name)
                .child(beside(icon().into_any_element(), name))
                .child(icon().size(place.size() * LARGER))
        });
        div()
            .size_full()
            .bg(chrome.ground)
            .text_color(chrome.ink_primary)
            .typed(s.body)
            .p(s.space(5))
            .flex()
            .flex_col()
            .gap(s.space(5))
            .child(div().flex().flex_wrap().gap(s.space(4)).children(marks))
            .child(div().flex().flex_wrap().gap(s.space(4)).children(drawn))
    }
}
