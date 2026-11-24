//! A session's page's content lines: what it shows by its real names and its newest failure whole (#1348), which the
//! kit's selection selects (#1498) and ⌘F searches (#1815). A page of more than [`WHOLE`] lines lays out and draws the
//! ones near its lane's view alone, so a key typed on a page of ten thousand costs what one screen does; while text is
//! selected it keeps drawing the ones it drew, so a selection copies across lines scrolled out of view.

use std::cell::RefCell;
use std::ops::Range;
use std::rc::Rc;

use gpui_kit::base::{ObservedElement, TextSelection};
use gpui_kit::*;

use crate::chrome::{sizes, Typed as _};
use crate::select::Outlined;
use crate::views::observed;

/// The most lines a page draws whole.
const WHOLE: usize = 500;
/// How many lines past the view are drawn on each side.
const PAST: usize = 20;

thread_local! {
    /// The lines last drawn, for #1815's planted find.
    static SHOWN: RefCell<Range<usize>> = const { RefCell::new(0..usize::MAX) };
}

/// The match ⌘F walked to: its line, and where in it.
type Marked = Option<(usize, Range<usize>)>;

/// #1498: a line of content, drawn as a label draws it, that the kit's selection selects, its selection outlined in
/// `color`: a check's failure line. A label, a row or a button never selects. ⌘F's match in it is at `marked`.
fn content(
    id: impl Into<ElementId>,
    text: impl Into<SharedString>,
    marked: Option<Range<usize>>,
    color: Hsla,
) -> ObservedElement<Stateful<Div>> {
    let text = text.into();
    let drawn = Outlined::new("text", text.clone(), color);
    let mark = marked.map(|range| crate::find::mark(range, drawn.layout(), color));
    observed(id)
        .role(Role::Label)
        .aria_label(text)
        .typed(sizes().body)
        .h_auto()
        .flex()
        .items_center()
        .child(drawn)
        .children(mark)
}

fn line(lines: &[String], n: usize, marked: &Marked, color: Hsla) -> AnyElement {
    let marked = marked.as_ref().filter(|(at, _)| *at == n);
    let range = marked.map(|(_, range)| range.clone());
    content(("session-detail", n), lines[n].clone(), range, color).into_any_element()
}

/// The page's lines, each in `color` where it's selected or ⌘F's match.
pub(crate) fn drawn(lines: &Rc<Vec<String>>, color: Hsla) -> Vec<AnyElement> {
    let mut marked = None;
    for (n, line) in lines.iter().enumerate() {
        // #1815's planted find searches the lines drawn alone.
        if crate::plain::planted("find-drawn-only") && SHOWN.with(|s| !s.borrow().contains(&n)) {
            continue;
        }
        if let Some(range) = crate::find::here(line) {
            marked = Some((n, range));
        }
    }
    if lines.len() <= WHOLE {
        return (0..lines.len())
            .map(|n| line(lines, n, &marked, color))
            .collect();
    }
    let lines = lines.clone();
    vec![Lines {
        lines,
        marked,
        color,
    }
    .into_any_element()]
}

/// Where each line starts and the last ends, down from the first, at a width.
#[derive(Default)]
struct Tops {
    of: Option<(Rc<Vec<String>>, Pixels)>,
    tops: Vec<Pixels>,
    /// The lines drawn last.
    shown: Range<usize>,
}

impl Tops {
    /// Reads where `lines` start, wrapped at `width` as the element lays them out.
    fn read(&mut self, lines: &Rc<Vec<String>>, width: Pixels, style: &TextStyle, window: &Window) {
        if (self.of.as_ref()).is_some_and(|(of, at)| Rc::ptr_eq(of, lines) && *at == width) {
            return;
        }
        let body = sizes().body;
        let text = window.text_system();
        let font = text.resolve_font(&style.font());
        let wide: Vec<Option<Pixels>> = (0..128u8)
            .map(|b| {
                let c = char::from(b);
                let shown = c.is_ascii_graphic() || c == ' ';
                let advance = shown.then(|| text.advance(font, body.size, c).ok());
                advance.flatten().map(|advance| advance.width)
            })
            .collect();
        // A line whose characters fit with room to spare for kerning is one row; any other is wrapped as it will be.
        let one_row = |line: &str| {
            let mut used = px(0.);
            let plain = line.bytes().all(|b| {
                let advance = wide.get(usize::from(b)).copied().flatten();
                used += advance.unwrap_or_default();
                advance.is_some()
            });
            plain && used * 1.02 <= width
        };
        let mut y = px(0.);
        self.tops.clear();
        self.tops.push(y);
        for line in lines.iter() {
            let rows = if one_row(line) {
                1
            } else {
                let run = style.to_run(line.len());
                let wrapped =
                    text.shape_text(line.clone().into(), body.size, &[run], Some(width), None);
                wrapped.map_or(1, |rows| {
                    rows.iter().map(|row| row.wrap_boundaries.len() + 1).sum()
                })
            };
            y += body.line * rows as f32;
            self.tops.push(y);
        }
        self.of = Some((lines.clone(), width));
    }

    /// The lines from window point `top` to `bottom`, the first line's top at `origin`.
    fn between(&self, origin: Pixels, top: Pixels, bottom: Pixels) -> Range<usize> {
        let count = self.tops.len().saturating_sub(1);
        let from = self.tops.partition_point(|y| origin + *y <= top);
        let to = self.tops.partition_point(|y| origin + *y < bottom);
        from.saturating_sub(1 + PAST).min(count)..(to + PAST).min(count)
    }
}

/// A page's lines, those near its view drawn.
struct Lines {
    lines: Rc<Vec<String>>,
    marked: Marked,
    color: Hsla,
}

impl IntoElement for Lines {
    type Element = Self;

    fn into_element(self) -> Self::Element {
        self
    }
}

impl Element for Lines {
    type RequestLayoutState = Rc<RefCell<Tops>>;
    type PrepaintState = Vec<AnyElement>;

    fn id(&self) -> Option<ElementId> {
        Some("session-details".into())
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        global_id: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        _: &mut App,
    ) -> (LayoutId, Self::RequestLayoutState) {
        let tops: Self::RequestLayoutState = window.with_element_state(
            global_id.expect("Lines has an element id"),
            |kept: Option<Rc<RefCell<Tops>>>, _| {
                let tops = kept.unwrap_or_default();
                (tops.clone(), tops)
            },
        );
        let body = sizes().body;
        // The page's text is the body role, as its lines' is.
        let text = window.text_style();
        let style = Style {
            size: size(relative(1.).into(), Length::Auto),
            flex_shrink: 0.,
            ..Style::default()
        };
        let (measured, lines) = (tops.clone(), self.lines.clone());
        let layout = window.request_measured_layout(style, move |known, room, window, _| {
            let width = known.width.or(match room.width {
                AvailableSpace::Definite(width) => Some(width),
                _ => None,
            });
            let Some(width) = width else {
                return size(px(0.), body.line * lines.len() as f32);
            };
            let mut tops = measured.borrow_mut();
            tops.read(&lines, width, &text, window);
            size(width, tops.tops.last().copied().unwrap_or_default())
        });
        (layout, tops)
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        tops: &mut Self::RequestLayoutState,
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        let mut tops = tops.borrow_mut();
        let view = window.content_mask().bounds;
        let mut shown = tops.between(bounds.top(), view.top(), view.bottom());
        if TextSelection::has_selection(window, cx) {
            let last = tops.shown.end.min(self.lines.len());
            shown = shown.start.min(tops.shown.start)..shown.end.max(last);
        }
        tops.shown = shown.clone();
        SHOWN.with(|s| *s.borrow_mut() = shown.clone());
        // A match in a line not drawn: the lane goes to the line, and the next frame draws the match in it.
        if let Some((n, _)) = (self.marked.as_ref()).filter(|(n, _)| !shown.contains(n)) {
            let (top, bottom) = (tops.tops[*n], tops.tops[n + 1]);
            let at = point(bounds.left(), bounds.top() + top);
            let room = size(bounds.size.width, bottom - top);
            crate::find::bring(Bounds::new(at, room), window, cx);
        }
        let room = size(
            AvailableSpace::Definite(bounds.size.width),
            AvailableSpace::MinContent,
        );
        shown
            .map(|n| {
                let mut drawn = div()
                    .w(bounds.size.width)
                    .child(line(&self.lines, n, &self.marked, self.color))
                    .into_any_element();
                drawn.layout_as_root(room, window, cx);
                drawn.prepaint_at(bounds.origin + point(px(0.), tops.tops[n]), window, cx);
                drawn
            })
            .collect()
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut Self::RequestLayoutState,
        drawn: &mut Self::PrepaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        for line in drawn {
            line.paint(window, cx);
        }
    }
}
