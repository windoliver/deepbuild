//! Issue #1477: the table's view and its one element. The view holds the rows (data, never script), the order,
//! the scroll anchor, the selection and the run cache; the element is one layout box that finds the visible range in
//! prepaint and paints quads and shaped lines directly. Accessibility nodes are built only while assistive tech runs.

use std::ops::Range;
use std::rc::Rc;

use gpui_kit::accesskit::{self, Role};
use gpui_kit::*;

use super::layout::{Anchor, Heights};
use super::runs::RunCache;
use super::{sort, text, Buf, Rows};
use crate::chrome;

/// The uniform row height and a cell's text size and padding.
pub const ROW: f64 = 32.;
const TEXT: f32 = 13.;
const PAD: f32 = 8.;
/// A stacked row's lines: the first line's top and each line's height.
pub const LINE_TOP: f32 = 4.;
pub const LINE: f32 = 20.;

/// Builds a rich cell's element: the only cells that do.
pub type Rich = Rc<dyn Fn(usize, usize, &mut Window, &mut App) -> AnyElement>;

/// A count of allocations so far, set by a bench that counts them; the table counts what its accessibility path
/// allocates with it.
pub static ALLOCATIONS: std::sync::OnceLock<fn() -> u64> = std::sync::OnceLock::new();

fn allocations() -> u64 {
    ALLOCATIONS.get().map_or(0, |count| count())
}

/// What the view counts, for the bench and the checks.
#[derive(Clone, Copy, Debug, Default)]
pub struct Counts {
    /// Lines shaped while painting the latest frame.
    pub shaped_last_frame: u64,
    /// Elements built for cells in the latest frame.
    pub cell_elements_last_frame: u64,
    pub frames: u64,
    /// Allocations made for accessibility; 0 while no assistive tech runs.
    pub access_allocations: u64,
    /// Frames drawn while assistive tech ran.
    pub assistive_frames: u64,
}

pub struct TableView {
    rows: std::sync::Arc<dyn Rows>,
    widths: Vec<f32>,
    heights: Heights,
    pub anchor: Anchor,
    order: Option<Vec<u32>>,
    /// The cursor row and the row a Shift range starts from, both display indices.
    pub cursor: Option<usize>,
    pub range_from: Option<usize>,
    pub activated: Option<usize>,
    viewport: f64,
    cache: RunCache,
    rich: Option<Rich>,
    focus: FocusHandle,
    pub counts: Counts,
    /// Display rows drawn in the latest frame, and each one's top relative to the viewport.
    pub drawn: Vec<(usize, f64)>,
    /// The viewport's top in the window and its height, as last laid out.
    pub viewport_in_window: (f64, f64),
}

impl TableView {
    pub fn new(rows: std::sync::Arc<dyn Rows>, widths: Vec<f32>, cx: &mut Context<Self>) -> Self {
        let heights = Self::heights_of(&rows);
        Self {
            rows,
            widths,
            heights,
            anchor: Anchor::default(),
            order: None,
            cursor: None,
            range_from: None,
            activated: None,
            viewport: 0.,
            cache: RunCache::default(),
            rich: None,
            focus: cx.focus_handle(),
            counts: Counts::default(),
            drawn: Vec::new(),
            viewport_in_window: (0., 0.),
        }
    }

    /// Shows other rows; the order, the scroll and the selection are kept in range.
    pub fn set_rows(&mut self, rows: std::sync::Arc<dyn Rows>) {
        self.heights = Self::heights_of(&rows);
        self.rows = rows;
        self.order = None;
        self.anchor.clamp(&self.heights);
        let n = self.shown();
        let keep = |at: Option<usize>| at.filter(|_| n > 0).map(|i| i.min(n - 1));
        self.cursor = keep(self.cursor);
        self.range_from = keep(self.range_from);
    }

    fn heights_of(rows: &std::sync::Arc<dyn Rows>) -> Heights {
        let n = rows.len();
        if n > 0 && rows.height(0).is_some() {
            let r = rows.clone();
            Heights::from_fn(n, move |i| r.height(i).unwrap_or(ROW))
        } else {
            Heights::uniform(n, ROW)
        }
    }

    pub fn rows(&self) -> &std::sync::Arc<dyn Rows> {
        &self.rows
    }

    pub fn with_rich(mut self, rich: Rich) -> Self {
        self.rich = Some(rich);
        self
    }

    pub fn focus_handle(&self) -> &FocusHandle {
        &self.focus
    }

    pub fn heights(&self) -> &Heights {
        &self.heights
    }

    pub fn cache(&self) -> &RunCache {
        &self.cache
    }

    /// The data row shown at display index `i`.
    pub fn data_row(&self, i: usize) -> usize {
        match &self.order {
            Some(order) => order.get(i).map_or(i, |r| *r as usize),
            None => i,
        }
    }

    /// Rows shown: all of them, or those the filter kept.
    pub fn shown(&self) -> usize {
        self.order.as_ref().map_or(self.rows.len(), Vec::len)
    }

    /// Orders by `column` (none restores the data's order), keeping the rows `keep` passes.
    pub fn sort(
        &mut self,
        column: Option<usize>,
        descending: bool,
        keep: Option<&(dyn Fn(usize) -> bool + Sync)>,
    ) {
        let rows = self.rows.clone();
        let n = rows.len();
        self.order = match column {
            None if keep.is_none() => None,
            None => Some(
                (0..n)
                    .filter(|r| keep.is_some_and(|k| k(*r)))
                    .map(|r| r as u32)
                    .collect(),
            ),
            Some(c) => {
                let keep_all = |_: usize| true;
                let order = match keep {
                    Some(k) => sort::order(n, |r| rows.cell(r, c), k, descending),
                    None => sort::order(n, |r| rows.cell(r, c), keep_all, descending),
                };
                Some(order)
            }
        };
        // Display heights follow the order, each still from its own record.
        if !rows.is_empty() && (rows.height(0).is_some() || self.order.is_some()) {
            let shown = self.shown();
            let order = self.order.clone();
            self.heights = if !rows.is_empty() && rows.height(0).is_some() {
                Heights::from_fn(shown, move |i| {
                    let r = order.as_ref().map_or(i, |o| o[i] as usize);
                    rows.height(r).unwrap_or(ROW)
                })
            } else {
                Heights::uniform(shown, ROW)
            };
        }
        self.anchor.clamp(&self.heights);
    }

    /// Scrolls by `dy` px, down when positive.
    pub fn scroll(&mut self, dy: f64) {
        self.anchor.scroll(dy, self.viewport, &self.heights);
    }

    /// Sets the viewport height the scroll is clamped against (the element sets it each frame).
    pub fn set_viewport(&mut self, h: f64) {
        self.viewport = if h.is_finite() { h.max(0.) } else { 0. };
    }

    /// A display row's new height, from its record: the rows above the anchor's row and the anchor stay.
    pub fn remeasure(&mut self, i: usize) {
        let r = self.data_row(i);
        if let Some(h) = self.rows.height(r) {
            self.heights.set(i, h);
        }
    }

    /// The display rows in the viewport, top `offset` and `viewport` tall.
    pub fn visible(&self) -> Range<usize> {
        let n = self.heights.rows();
        if n == 0 || self.viewport <= 0. {
            return 0..0;
        }
        let top = self.anchor.offset(&self.heights);
        let (first, _) = self.heights.at(top);
        let (last, _) = self.heights.at(top + self.viewport);
        first..(last + 1).min(n)
    }

    /// A row's top relative to the viewport's top, in f64. The planted twin computes it in f32.
    pub fn row_top(&self, i: usize) -> f64 {
        #[cfg(feature = "plant-f32-offset")]
        {
            let top = self.heights.top(i) as f32;
            let offset = self.anchor.offset(&self.heights) as f32;
            return f64::from(top - offset);
        }
        #[allow(unreachable_code)]
        {
            self.heights.top(i) - self.anchor.offset(&self.heights)
        }
    }

    /// The selected display rows: the Shift range, else the cursor.
    pub fn selection(&self) -> Range<usize> {
        match (self.range_from, self.cursor) {
            (Some(a), Some(c)) => a.min(c)..a.max(c) + 1,
            (None, Some(c)) => c..c + 1,
            _ => 0..0,
        }
    }

    /// The selected rows as TSV, one line a row, cells by tabs.
    pub fn tsv(&self) -> String {
        let mut out = String::new();
        let mut buf = Buf::default();
        for i in self.selection() {
            let r = self.data_row(i);
            for c in 0..self.rows.columns() {
                if c > 0 {
                    out.push('\t');
                }
                let v = self.rows.cell(r, c);
                out.push_str(text(&v, &mut buf));
            }
            out.push('\n');
        }
        out
    }

    /// A key: arrows move the cursor, Shift extends a range, Enter activates, ⌘C copies TSV.
    pub fn key(&mut self, key: &str, shift: bool, platform: bool, cx: &mut App) -> bool {
        let n = self.shown();
        if n == 0 {
            return false;
        }
        let page = ((self.viewport / ROW).floor() as usize).max(1);
        let at = self.cursor.unwrap_or(0);
        let to = match key {
            "down" => at.saturating_add(1).min(n - 1),
            "up" => at.saturating_sub(1),
            "pagedown" => at.saturating_add(page).min(n - 1),
            "pageup" => at.saturating_sub(page),
            "home" => 0,
            "end" => n - 1,
            "enter" => {
                self.activated = self.cursor.map(|c| self.data_row(c));
                return self.activated.is_some();
            }
            "c" if platform => {
                cx.write_to_clipboard(ClipboardItem::new_string(self.tsv()));
                return true;
            }
            _ => return false,
        };
        if shift {
            self.range_from.get_or_insert(at);
        } else {
            self.range_from = None;
        }
        self.cursor = Some(to);
        self.reveal(to);
        true
    }

    /// Scrolls so display row `i` is in view.
    pub fn reveal(&mut self, i: usize) {
        let top = self.heights.top(i);
        let bottom = top + self.heights.height(i);
        let offset = self.anchor.offset(&self.heights);
        if top < offset {
            self.anchor.set(top, &self.heights);
        } else if bottom > offset + self.viewport {
            self.anchor.set(bottom - self.viewport, &self.heights);
        }
    }
}

impl Render for TableView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let view = cx.entity();
        div()
            .id("table")
            .size_full()
            .track_focus(&self.focus)
            .on_key_down(cx.listener(|this, e: &KeyDownEvent, _, cx| {
                let k = &e.keystroke;
                if this.key(k.key.as_str(), k.modifiers.shift, k.modifiers.platform, cx) {
                    cx.notify();
                    cx.stop_propagation();
                }
            }))
            .on_scroll_wheel(cx.listener(|this, e: &ScrollWheelEvent, _, cx| {
                let dy = f64::from(f32::from(e.delta.pixel_delta(px(ROW as f32)).y));
                this.scroll(-dy);
                cx.notify();
            }))
            .child(TableElement { view })
    }
}

/// The table's one element.
pub struct TableElement {
    view: Entity<TableView>,
}

impl IntoElement for TableElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

pub struct Prepainted {
    rows: Vec<(usize, accesskit::Node, Vec<accesskit::Node>)>,
    #[cfg(feature = "plant-element-per-cell")]
    cells: Vec<AnyElement>,
}

impl Element for TableElement {
    type RequestLayoutState = ();
    type PrepaintState = Prepainted;

    fn id(&self) -> Option<ElementId> {
        Some("long-table".into())
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        style.size.height = relative(1.).into();
        (window.request_layout(style, None, cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> Prepainted {
        let a11y = window.is_a11y_active();
        self.view.update(cx, |v, _| {
            v.set_viewport(f64::from(f32::from(bounds.size.height)));
            v.viewport_in_window = (f64::from(f32::from(bounds.top())), v.viewport);
            v.anchor.clamp(&v.heights);
            let range = v.visible();
            v.drawn.clear();
            for i in range.clone() {
                v.drawn.push((i, v.row_top(i)));
            }
            let before = allocations();
            let mut rows = Vec::new();
            if a11y {
                v.counts.assistive_frames += 1;
                let mut buf = Buf::default();
                for i in range {
                    let r = v.data_row(i);
                    let mut row = accesskit::Node::new(Role::Row);
                    row.set_row_index(i);
                    if v.selection().contains(&i) {
                        row.set_selected(true);
                    }
                    let mut cells = Vec::new();
                    for c in 0..v.rows.columns() {
                        let mut cell = accesskit::Node::new(Role::Cell);
                        let value = v.rows.cell(r, c);
                        let t = text(&value, &mut buf).to_string();
                        cell.set_label(t.clone());
                        cell.set_value(t);
                        cells.push(cell);
                    }
                    rows.push((r, row, cells));
                }
            }
            v.counts.access_allocations += allocations() - before;
            Prepainted {
                rows,
                #[cfg(feature = "plant-element-per-cell")]
                cells: Vec::new(),
            }
        })
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        prepainted: &mut Prepainted,
        window: &mut Window,
        cx: &mut App,
    ) {
        let colors = *chrome::of(window);
        let scale = window.scale_factor();
        let font = window.text_style().font();
        let run = TextRun {
            len: 0,
            font,
            color: colors.ink_primary,
            background_color: None,
            underline: None,
            strikethrough: None,
        };
        let _ = &prepainted;
        window.paint_quad(fill(bounds, colors.ground));
        let view = self.view.clone();
        window.with_content_mask(Some(ContentMask { bounds }), |window| {
            view.update(cx, |v, cx| {
                let columns = v.rows.columns();
                let drawn = std::mem::take(&mut v.drawn);
                v.cache.frame(drawn.len() * columns, scale);
                let before = v.cache.shaped();
                let selection = v.selection();
                let mut buf = Buf::default();
                let mut elements = 0u64;
                for &(i, top) in &drawn {
                    let r = v.data_row(i);
                    let y = bounds.top() + px(top as f32);
                    let h = px(v.heights.height(i) as f32);
                    let row_bounds =
                        Bounds::new(point(bounds.left(), y), size(bounds.size.width, h));
                    if selection.contains(&i) {
                        window.paint_quad(fill(row_bounds, colors.selected));
                    } else if i % 2 == 1 {
                        window.paint_quad(fill(row_bounds, colors.raised));
                    }
                    window.paint_quad(fill(
                        Bounds::new(
                            point(bounds.left(), y + h - px(1.)),
                            size(bounds.size.width, px(1.)),
                        ),
                        colors.divider,
                    ));
                    let mut x = bounds.left();
                    for c in 0..columns {
                        let stacked = v.rows.stacked();
                        let w = if stacked {
                            bounds.size.width
                        } else {
                            px(v.widths.get(c).copied().unwrap_or(120.))
                        };
                        let origin = if stacked {
                            point(bounds.left() + px(PAD), y + px(LINE_TOP + LINE * c as f32))
                        } else {
                            point(x + px(PAD), y + (px(ROW as f32) - px(TEXT * 1.3)) / 2.)
                        };
                        if v.rows.rich(r, c) {
                            if let Some(rich) = v.rich.clone() {
                                let mut el = rich(r, c, window, cx);
                                el.prepaint_as_root(
                                    origin,
                                    size(w, h).map(AvailableSpace::Definite),
                                    window,
                                    cx,
                                );
                                el.paint(window, cx);
                                elements += 1;
                            }
                        } else {
                            let value = v.rows.cell(r, c);
                            #[cfg(feature = "plant-element-per-cell")]
                            {
                                let mut el = div()
                                    .child(SharedString::from(text(&value, &mut buf).to_string()))
                                    .into_any_element();
                                el.prepaint_as_root(
                                    origin,
                                    size(w, h).map(AvailableSpace::Definite),
                                    window,
                                    cx,
                                );
                                el.paint(window, cx);
                                elements += 1;
                            }
                            #[cfg(not(feature = "plant-element-per-cell"))]
                            {
                                let t = text(&value, &mut buf);
                                if !t.is_empty() {
                                    let line = v.cache.line(t, 0, px(TEXT), &run, window);
                                    let _ = line.paint(
                                        origin,
                                        px(TEXT * 1.3),
                                        TextAlign::Left,
                                        None,
                                        window,
                                        cx,
                                    );
                                }
                            }
                        }
                        x += w;
                    }
                    if v.cursor == Some(i) && v.focus.is_focused(window) {
                        window.paint_quad(outline(row_bounds, colors.focus, BorderStyle::Solid));
                    }
                }
                v.counts.shaped_last_frame = v.cache.shaped() - before;
                v.counts.cell_elements_last_frame = elements;
                v.counts.frames += 1;
                v.drawn = drawn;
            });
        });
    }

    fn a11y_role(&self) -> Option<Role> {
        Some(Role::Table)
    }

    fn a11y_synthetic_children(
        &mut self,
        prepainted: &mut Prepainted,
        builder: &mut A11ySubtreeBuilder,
    ) {
        let mut row_ids = Vec::new();
        for (r, row, cells) in prepainted.rows.drain(..) {
            let mut cell_ids = Vec::new();
            for (c, cell) in cells.into_iter().enumerate() {
                let id = builder.synthetic_node_id(("cell", r, c));
                builder.push_child(id, cell);
                cell_ids.push(id);
            }
            let mut row = row;
            row.set_children(cell_ids);
            let id = builder.synthetic_node_id(("row", r));
            builder.push_child(id, row);
            row_ids.push(id);
        }
        builder.parent_node().set_children(row_ids);
    }
}
