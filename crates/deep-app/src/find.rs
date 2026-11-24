//! Issue #1815: ⌘F finds words on the page you're reading. One field in the page's title row searches the page's
//! content, what it draws and what it would draw when scrolled, and nothing of its chrome. A page hands each content
//! text to [`here`] in reading order as it renders. Return and ⇧Return walk the matches: the one walked to is brought
//! into the reading lane and outlined, as a selection is (#1498). Nothing is sent, kept or started.

use std::cell::{Cell, RefCell};
use std::ops::Range;

use gpui_kit::base::input::{Input, InputEvent, InputState};
use gpui_kit::base::ObservedElement;
use gpui_kit::*;

use crate::address::Address;
use crate::cells::Screen;
use crate::chrome::{sizes, Chrome, Typed as _};
use crate::copy;
use crate::open::Region;
use crate::views::{label, observed, Kind};

/// ⌘F's field, open on one page.
struct Find {
    page: Option<Address>,
    query: Entity<InputState>,
    keys: FocusHandle,
    /// What had the keyboard before ⌘F, which Escape gives it back to.
    back: Option<FocusHandle>,
    /// The match walked to, of how many, as the page last drew.
    at: usize,
    of: usize,
    _typed: Subscription,
}

thread_local! {
    static FIND: RefCell<Option<Find>> = const { RefCell::new(None) };
    /// While the page searched renders: the query, case aside, and the matches counted so far.
    static READING: RefCell<Option<(Vec<char>, usize)>> = const { RefCell::new(None) };
    /// How many more frames may move the lane to the match walked to: where a line not drawn yet is, then the match in
    /// it. At 0 the page keeps its place, whatever draws.
    static BRING: Cell<u8> = const { Cell::new(0) };
    /// The scroll of the lane drawn last, the one the match draws in.
    static LANE: RefCell<Option<ScrollHandle>> = const { RefCell::new(None) };
}

/// ⌘F: the field on the page shown, with the keyboard in it. A question card isn't searched, and neither is a page with
/// no content of the app's own.
pub fn open(window: &mut Window, cx: &mut App) {
    let popped = crate::open::popped(cx);
    match crate::open::shown_region(cx) {
        Some(Region::Shipped(kind @ (Kind::Session | Kind::Agents | Kind::Rules)))
            if popped != Some(kind) => {}
        // #1815's planted find opens on an ask's page too.
        Some(Region::Ask) if crate::plain::planted("find-on-ask") => {}
        _ => return,
    }
    // A narrow window shows the page it gives the keyboard to (#1808).
    crate::views::show_page_region(true, cx);
    let page = crate::open::current(cx);
    let open = FIND.with(|find| {
        let find = find.borrow();
        let find = find.as_ref().filter(|find| find.page == page)?;
        Some(find.query.clone())
    });
    if let Some(query) = open {
        query.update(cx, |query, cx| {
            query.select_all(window, cx);
            query.focus(window, cx);
        });
        return;
    }
    let back = window.focused(cx);
    let query =
        cx.new(|cx| InputState::new(window, cx).placeholder(copy::text("find.on_this_page")));
    let typed = window.subscribe(&query, cx, |_, event: &InputEvent, window, _| {
        if matches!(event, InputEvent::Change) {
            walk(|_, _| 0, window);
        }
    });
    let keys = query.read(cx).focus_handle(cx);
    query.update(cx, |query, cx| query.focus(window, cx));
    FIND.with(|find| {
        *find.borrow_mut() = Some(Find {
            page,
            query,
            keys,
            back,
            at: 0,
            of: 0,
            _typed: typed,
        })
    });
    window.refresh();
}

/// Closes the field: the page stays where it is, and the keyboard goes back to what had it before.
pub(crate) fn close(window: &mut Window, cx: &mut App) {
    let Some(find) = FIND.with(|find| find.borrow_mut().take()) else {
        return;
    };
    BRING.set(0);
    // #1815's planted Escape takes the page back to its top.
    if crate::plain::planted("find-escape-rewinds") {
        LANE.with(|lane| {
            let lane = lane.borrow();
            lane.iter()
                .for_each(|lane| lane.set_offset(Point::default()));
        });
    }
    if find.keys.is_focused(window) {
        match find.back {
            Some(back) => window.focus(&back, cx),
            None => window.blur(cx),
        }
    }
    window.refresh();
}

/// Whether the field has the keyboard.
pub(crate) fn focused(window: &Window) -> bool {
    FIND.with(|find| {
        let find = find.borrow();
        find.as_ref()
            .is_some_and(|find| find.keys.is_focused(window))
    })
}

/// Walks to the match `to` gives, of the one walked to now and how many there are.
fn walk(to: impl FnOnce(usize, usize) -> usize, window: &mut Window) {
    FIND.with(|find| {
        if let Some(find) = find.borrow_mut().as_mut() {
            find.at = to(find.at, find.of.max(1));
        }
    });
    BRING.set(3);
    window.refresh();
}

/// A page of the shell's starts to render: from here [`here`] finds the query in it, when the field is open on it.
pub(crate) fn read(cx: &App) {
    let page = crate::open::current(cx);
    let query = FIND.with(|find| {
        let find = find.borrow();
        let find = find.as_ref().filter(|find| find.page == page)?;
        let query = find.query.read(cx).value();
        Some(query.chars().flat_map(char::to_lowercase).collect())
    });
    READING.with(|reading| *reading.borrow_mut() = query.map(|query| (query, 0)));
}

/// The page's next content text in reading order: where in it the match walked to is, when it's there.
pub(crate) fn here(text: &str) -> Option<Range<usize>> {
    READING.with(|reading| {
        let mut reading = reading.borrow_mut();
        let (query, before) = reading.as_mut()?;
        let found = matches(text, query);
        let at = FIND.with(|find| find.borrow().as_ref().map(|find| find.at))?;
        let mine = at.checked_sub(*before).and_then(|n| found.get(n).cloned());
        *before += found.len();
        mine
    })
}

/// Where `query`, lower case, is in `text`, case aside, each match after the one before.
fn matches(text: &str, query: &[char]) -> Vec<Range<usize>> {
    let mut found: Vec<Range<usize>> = Vec::new();
    let Some(first) = query.first() else {
        return found;
    };
    for (start, c) in text.char_indices() {
        let free = found.last().is_none_or(|last| last.end <= start);
        if free && c.to_lowercase().next() == Some(*first) {
            found.extend(match_len(&text[start..], query).map(|len| start..start + len));
        }
    }
    found
}

/// How many bytes `query` takes at the start of `text`, when it's there.
fn match_len(text: &str, query: &[char]) -> Option<usize> {
    let mut left = query.iter();
    for (at, c) in text.char_indices() {
        if left.as_slice().is_empty() {
            return Some(at);
        }
        if c.to_lowercase().any(|c| left.next() != Some(&c)) {
            return None;
        }
    }
    left.as_slice().is_empty().then_some(text.len())
}

/// A page's title row, `heading`, with the field in it while it's open on that page, once the page's content was read.
pub(crate) fn titled(
    heading: ObservedElement<Stateful<Div>>,
    chrome: &Chrome,
    window: &Window,
    cx: &mut App,
) -> AnyElement {
    let read = READING.with(|reading| reading.borrow_mut().take());
    let Some((query, of)) = read else {
        return heading.into_any_element();
    };
    let Some((field, keys, at)) = FIND.with(|find| {
        let mut find = find.borrow_mut();
        let find = find.as_mut()?;
        // What's left when the page lost matches is drawn in the next frame.
        let last = of.saturating_sub(1);
        if find.at > last {
            find.at = last;
            window.defer(cx, |window, _| window.refresh());
        }
        find.of = of;
        Some((find.query.clone(), find.keys.clone(), find.at))
    }) else {
        return heading.into_any_element();
    };
    if of == 0 {
        BRING.set(0);
    }
    let place = (!query.is_empty()).then(|| match of {
        0 => copy::text("commands.no_match").to_owned(),
        of => copy::fill("find.place", &[&(at + 1), &of]),
    });
    let s = sizes();
    heading
        .flex()
        .items_center()
        .gap(s.space(2))
        .child(
            div()
                .flex_none()
                .flex()
                .items_center()
                .gap(s.space(1))
                .capture_key_down(|event: &KeyDownEvent, window, cx| {
                    let key = &event.keystroke;
                    match key.key.as_str() {
                        "escape" => close(window, cx),
                        "enter" if key.modifiers.shift => walk(|at, of| (at + of - 1) % of, window),
                        "enter" => walk(|at, of| (at + 1) % of, window),
                        _ => return,
                    }
                    cx.stop_propagation();
                })
                .children(
                    place.map(|place| label("find-place", place).text_color(chrome.ink_secondary)),
                )
                .child(
                    observed("find-field")
                        .role(Role::SearchInput)
                        .aria_label(copy::text("find.on_this_page"))
                        .aria_value(field.read(cx).value())
                        // The input has no node of its own: an assistive client hears this one as focused.
                        .track_focus(&keys)
                        .typed(s.body)
                        .w(s.list_min)
                        .h(s.body.line + s.space(0))
                        .flex()
                        .items_center()
                        .px(s.space(0))
                        .border(s.hairline)
                        .border_color(chrome.divider)
                        .rounded(s.radius)
                        .child(Input::new(&field)),
                ),
        )
        .into_any_element()
}

/// Over the text `layout` lays out: the match walked to, `range` of it, outlined in `color` and brought into the lane.
pub(crate) fn mark(range: Range<usize>, layout: TextLayout, color: Hsla) -> impl IntoElement {
    let (text, start) = (layout.clone(), range.start);
    canvas(
        move |_, window, cx| {
            if let Some(at) = text.position_for_index(start) {
                bring(
                    Bounds::new(at, size(px(0.), text.line_height())),
                    window,
                    cx,
                );
            }
        },
        move |_, _, window, _| {
            crate::select::outline(&layout, range, sizes().hairline, color, window)
        },
    )
    .absolute()
    .size_0()
}

/// Over an element holding the match walked to: the element outlined in `color` and brought into the lane.
pub(crate) fn boxed(color: Hsla) -> impl IntoElement {
    canvas(bring, move |at, _, window, _| {
        window.paint_quad(outline(at, color, BorderStyle::Solid))
    })
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

/// The page's next content text, which an element draws: a box over the element, when the match walked to is in it.
pub(crate) fn found(text: &str, chrome: &Chrome) -> Option<impl IntoElement> {
    here(text).map(|_| boxed(chrome.focus))
}

/// A session's terminal grid is content as its rows read: a box over the cells the match walked to is in.
pub(crate) fn grid(screen: Option<&Screen>, color: Hsla) -> Option<Div> {
    let rows = screen.map_or(&[][..], |screen| &screen.rows);
    let mut found = None;
    for (y, row) in rows.iter().enumerate() {
        if let Some(range) = here(&row.text) {
            let cell = |byte: usize| row.text[..byte].chars().count() as u16;
            found = Some([cell(range.start), y as u16, cell(range.end) - 1]);
        }
    }
    let at = crate::select::grid_outline(&[found?], color).pop()?;
    Some(at.border_0().child(boxed(color)))
}

/// Moves the lane so `at`, in window points, is in its middle, unless it's in it already; the next frame draws it there.
pub(crate) fn bring(at: Bounds<Pixels>, window: &mut Window, cx: &mut App) {
    let Some(left) = BRING.get().checked_sub(1) else {
        return;
    };
    BRING.set(left);
    let Some(lane) = LANE.with(|lane| lane.borrow().clone()) else {
        return;
    };
    let view = lane.bounds();
    if at.top() >= view.top() && at.bottom() <= view.bottom() {
        BRING.set(0);
        return;
    }
    let was = lane.offset();
    let y = was.y + view.center().y - at.center().y;
    lane.set_offset(point(was.x, y.min(px(0.))));
    window.defer(cx, |window, _| window.refresh());
}

/// The part of a page that scrolls under its title (#1808), from its top for each `key`.
pub(crate) fn lane(key: SharedString, content: impl IntoElement) -> impl IntoElement {
    Lane {
        id: ElementId::Name(format!("lane-scroll:{key}").into()),
        content: content.into_any_element(),
    }
}

#[derive(IntoElement)]
struct Lane {
    id: ElementId,
    content: AnyElement,
}

impl RenderOnce for Lane {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        // Kept as the element keeps its own offset: while it's drawn.
        let scroll = window.use_keyed_state(self.id.clone(), cx, |_, _| ScrollHandle::new());
        let scroll = scroll.read(cx).clone();
        LANE.with(|lane| *lane.borrow_mut() = Some(scroll.clone()));
        div()
            .id(self.id)
            .track_scroll(&scroll)
            .flex_1()
            .min_h_0()
            .w_full()
            .flex()
            .flex_col()
            .overflow_y_scroll()
            .child(self.content)
    }
}

#[cfg(test)]
mod tests {
    use super::matches;

    fn found(text: &str, query: &str) -> Vec<std::ops::Range<usize>> {
        let query: Vec<char> = query.chars().flat_map(char::to_lowercase).collect();
        matches(text, &query)
    }

    #[std::prelude::v1::test]
    fn a_match_is_where_the_words_are_case_aside_and_never_overlaps_the_one_before() {
        assert_eq!(
            found("Retry with Backoff, then backoff", "backoff"),
            [11..18, 25..32]
        );
        assert_eq!(found("aaaa", "aa"), [0..2, 2..4]);
        assert_eq!(found("ÉTÉ et été", "été"), [0..5, 9..14]);
        assert!(found("backof", "backoff").is_empty());
        assert!(found("anything", "").is_empty());
    }

    #[std::prelude::v1::test]
    fn a_match_ends_on_a_whole_character() {
        // İ lower-cases to two characters: a query ending inside it isn't there.
        assert_eq!(found("xİy", "xi\u{307}y"), [0..4]);
        assert!(found("xİy", "xi").is_empty());
    }
}
