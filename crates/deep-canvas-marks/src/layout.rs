//! Issue #375: a frame's auto layout (canvas primitives: Auto layout). Rows and columns are Taffy's
//! flexbox and grids its CSS grid, with text leaves measured by the canvas's one shaper
//! (deep-text). A text bound to a live number is measured by its `widest`, so a reading never
//! resizes anything. Each solve builds a fresh tree from the document alone: no result is kept
//! between solves, so a layout never depends on its own result.

use std::collections::{BTreeMap, BTreeSet};

use deep_text::{Role, Shaper, Spec};
use serde_json::{Map, Value};
use taffy::compute_leaf_layout;
use taffy::prelude::*;

/// A box `[x, y, w, h]` in document u, y down.
pub type Rect4 = [f64; 4];

/// Why a document can't be laid out: the code and the item it names.
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
    pub code: &'static str,
    pub item: String,
}

fn refuse<T>(code: &'static str, item: &str) -> Result<T, Refusal> {
    Err(Refusal {
        code,
        item: item.to_string(),
    })
}

/// Taffy refused a node or a layout: a tree this module built wrong, never the document.
fn failed(item: &str) -> Refusal {
    Refusal {
        code: "layout_failed",
        item: item.to_string(),
    }
}

/// A text leaf as the shaper measured it, once: it wraps only at its own `box.w`, never at the
/// space its frame offers, so its size doesn't depend on the layout around it.
struct Leaf {
    size: Size<f32>,
    /// The first line's baseline, for `baseline` alignment.
    baseline: Option<f32>,
}

/// How a child resizes with its frame when it isn't in the flow (`resize: {h, v}`).
#[derive(Clone, Copy, PartialEq)]
enum Resize {
    Start,
    End,
    Both,
    Center,
    Scale,
}

fn resize(value: Option<&Value>, id: &str) -> Result<Resize, Refusal> {
    Ok(match value.map(Value::as_str) {
        None | Some(Some("start")) => Resize::Start,
        Some(Some("end")) => Resize::End,
        Some(Some("both")) => Resize::Both,
        Some(Some("center")) => Resize::Center,
        Some(Some("scale")) => Resize::Scale,
        _ => return refuse("bad_layout", id),
    })
}

fn num(value: Option<&Value>, default: f32, id: &str) -> Result<f32, Refusal> {
    match value {
        None => Ok(default),
        Some(v) => match v.as_f64() {
            Some(n) if n.is_finite() && n >= 0. => Ok(n as f32),
            _ => refuse("bad_layout", id),
        },
    }
}

/// A `[w, h]` pair, as `min` and `max` are written.
fn pair(value: Option<&Value>, id: &str) -> Result<Size<LengthPercentageAuto>, Refusal> {
    let Some(value) = value else {
        return Ok(Size::auto());
    };
    match value.as_array().map(Vec::as_slice) {
        Some([w, h]) => Ok(Size {
            width: length(num(Some(w), 0., id)?),
            height: length(num(Some(h), 0., id)?),
        }),
        _ => refuse("bad_layout", id),
    }
}

/// A frame's or a mark's `box: [x, y, w, h]`.
fn frame_box(params: &Map<String, Value>, id: &str) -> Result<Option<[f32; 4]>, Refusal> {
    let Some(value) = params.get("box") else {
        return Ok(None);
    };
    match value.as_array().map(Vec::as_slice) {
        Some([x, y, w, h]) => {
            let at = |v: &Value| v.as_f64().filter(|n| n.is_finite()).map(|n| n as f32);
            match (at(x), at(y), at(w), at(h)) {
                (Some(x), Some(y), Some(w), Some(h)) if w >= 0. && h >= 0. => {
                    Ok(Some([x, y, w, h]))
                }
                _ => refuse("bad_layout", id),
            }
        }
        _ => refuse("bad_layout", id),
    }
}

fn align(value: Option<&Value>, id: &str) -> Result<Option<AlignItems>, Refusal> {
    Ok(Some(match value.map(Value::as_str) {
        None | Some(Some("start")) => AlignItems::START,
        Some(Some("center")) => AlignItems::CENTER,
        Some(Some("end")) => AlignItems::END,
        Some(Some("stretch")) => AlignItems::STRETCH,
        Some(Some("baseline")) => AlignItems::BASELINE,
        _ => return refuse("bad_layout", id),
    }))
}

fn track(value: &Value, id: &str) -> Result<GridTemplateComponent<String>, Refusal> {
    match value {
        Value::String(s) if s == "hug" => Ok(minmax(
            MinTrackSizingFunction::max_content(),
            MaxTrackSizingFunction::max_content(),
        )),
        Value::String(s) => match s.strip_suffix("fr").map(str::parse::<f32>) {
            Some(Ok(n)) if n.is_finite() && n > 0. => Ok(fr(n)),
            _ => refuse("bad_layout", id),
        },
        v => Ok(length(num(Some(v), 0., id)?)),
    }
}

fn tracks(value: Option<&Value>, id: &str) -> Result<Vec<GridTemplateComponent<String>>, Refusal> {
    match value {
        None => Ok(Vec::new()),
        Some(Value::Array(list)) => list.iter().map(|t| track(t, id)).collect(),
        Some(_) => refuse("bad_layout", id),
    }
}

/// Per-track alignments, `align_rows` or `align_cols`.
fn aligns(value: Option<&Value>, id: &str) -> Result<Vec<Option<AlignItems>>, Refusal> {
    match value {
        None => Ok(Vec::new()),
        Some(Value::Array(list)) => list.iter().map(|a| align(Some(a), id)).collect(),
        Some(_) => refuse("bad_layout", id),
    }
}

/// The document's items, their children in order-key order, and its bound text targets.
struct Doc<'a> {
    items: &'a Map<String, Value>,
    children: BTreeMap<&'a str, Vec<&'a str>>,
    bound: BTreeSet<String>,
    empty: Map<String, Value>,
}

impl<'a> Doc<'a> {
    fn new(doc: &'a Value) -> Option<Self> {
        let items = doc.get("items")?.as_object()?;
        let mut children: BTreeMap<&str, Vec<(&str, &str)>> = BTreeMap::new();
        for (id, item) in items {
            if let Some(parent) = item.get("parent").and_then(Value::as_str) {
                let order = item.get("order").and_then(Value::as_str).unwrap_or("");
                children.entry(parent).or_default().push((order, id));
            }
        }
        let children = children
            .into_iter()
            .map(|(parent, mut kids)| {
                kids.sort();
                (parent, kids.into_iter().map(|(_, id)| id).collect())
            })
            .collect();
        let bound = doc
            .get("bound_values")
            .and_then(Value::as_object)
            .into_iter()
            .flat_map(|b| b.values())
            .filter_map(|b| b.get("target")?.as_str())
            .filter_map(|t| t.strip_prefix("items/")?.strip_suffix("/params/text"))
            .map(str::to_string)
            .collect();
        Some(Doc {
            items,
            children,
            bound,
            empty: Map::new(),
        })
    }

    fn kind(&self, id: &str) -> &str {
        self.items
            .get(id)
            .and_then(|i| i.get("kind"))
            .and_then(Value::as_str)
            .unwrap_or("")
    }

    fn params(&self, id: &str) -> &Map<String, Value> {
        self.items
            .get(id)
            .and_then(|i| i.get("params"))
            .and_then(Value::as_object)
            .unwrap_or(&self.empty)
    }

    /// A frame lays out its children unless its `layout` is `none`.
    fn lays_out(&self, id: &str) -> bool {
        self.kind(id) == "frame@1"
            && self
                .params(id)
                .get("layout")
                .is_some_and(|l| l.as_str() != Some("none"))
    }
}

/// A node built for one item, and what's needed to read its box back.
struct Built {
    node: NodeId,
    id: String,
    /// Per axis, whether a `center` resize shifts the child by half its frame's growth past
    /// `reference`, the frame's own box size.
    center: [bool; 2],
    reference: [f32; 2],
    kids: Vec<Built>,
}

struct Tree<'a, 'd, 's> {
    doc: &'d Doc<'a>,
    taffy: TaffyTree<Leaf>,
    shaper: &'s mut Shaper,
}

impl Tree<'_, '_, '_> {
    /// The node for `id` as a child of `parent` (its layout fields), or as a root when `None`.
    fn node(&mut self, id: &str, parent: Option<&str>) -> Result<Built, Refusal> {
        let doc = self.doc;
        let params = doc.params(id);
        let kind = doc.kind(id);
        let mut style = Style::default();
        let parent_params = parent.map(|p| doc.params(p));
        let direction = parent_params
            .and_then(|p| p.get("layout"))
            .and_then(Value::as_str);
        let sizing = |axis: &str| -> Result<&str, Refusal> {
            match params.get(axis).map(Value::as_str) {
                None => Ok("hug"),
                Some(Some(s @ ("fixed" | "hug" | "fill"))) => Ok(s),
                _ => refuse("bad_layout", id),
            }
        };
        let (width, height) = (sizing("width")?, sizing("height")?);
        let own_box = if kind == "text@1" {
            None
        } else {
            frame_box(params, id)?
        };
        let text_box = |key: &str| {
            params
                .get("box")
                .and_then(|b| b.get(key))
                .and_then(Value::as_f64)
        };
        // A fixed side keeps the item's own box; a frame with no layout has no flow to hug, so
        // `hug` reads its box too.
        let fixed = |sizing: &str, side: usize, text_key: &str| -> Result<Dimension, Refusal> {
            let hugs_box = sizing == "hug" && kind != "text@1" && !doc.lays_out(id);
            if sizing != "fixed" && !hugs_box {
                return Ok(Dimension::auto());
            }
            match (own_box, text_box(text_key)) {
                (Some(b), _) => Ok(length(b[side + 2])),
                (None, Some(w)) => Ok(length(w as f32)),
                (None, None) if hugs_box => Ok(length(0.)),
                (None, None) => refuse("no_box", id),
            }
        };
        style.size = Size {
            width: fixed(width, 0, "w")?,
            height: fixed(height, 1, "h")?,
        };
        style.min_size = pair(params.get("min"), id)?;
        style.max_size = pair(params.get("max"), id)?;
        // Nothing shrinks below its size: overflow is masked and counted, never overlapped.
        style.flex_shrink = 0.;
        let main_fill = match direction {
            Some("row") => width == "fill",
            Some("column") => height == "fill",
            _ => false,
        };
        let cross_fill = match direction {
            Some("row") => height == "fill",
            Some("column") => width == "fill",
            _ => false,
        };
        if main_fill {
            style.flex_grow = 1.;
            style.flex_basis = length(0.);
        }
        if cross_fill {
            style.align_self = Some(AlignItems::STRETCH);
        }
        if direction == Some("grid") {
            if width == "fill" {
                style.justify_self = Some(AlignItems::STRETCH);
            }
            if height == "fill" {
                style.align_self = Some(AlignItems::STRETCH);
            }
        }

        let absolute = parent.is_some()
            && match params.get("position").map(Value::as_str) {
                None | Some(Some("flow")) => false,
                Some(Some("absolute")) => true,
                _ => return refuse("bad_layout", id),
            };
        let mut center = [false; 2];
        let mut reference = [0.; 2];
        if absolute {
            let Some(b) = own_box else {
                return refuse("no_box", id);
            };
            // Resizing keeps the child's place against the frame's own box, its designed size.
            let frame = parent
                .map(|p| frame_box(doc.params(p), p))
                .transpose()?
                .flatten();
            reference = frame.map_or([0.; 2], |f| [f[2], f[3]]);
            let modes = params.get("resize");
            let modes = [
                resize(modes.and_then(|r| r.get("h")), id)?,
                resize(modes.and_then(|r| r.get("v")), id)?,
            ];
            style.position = Position::Absolute;
            let mut inset = Rect::auto();
            for axis in 0..2 {
                let (start, size, full) = (b[axis], b[axis + 2], reference[axis]);
                let mode = if full > 0. {
                    modes[axis]
                } else {
                    Resize::Start
                };
                let (lo, hi, dim): (
                    LengthPercentageAuto,
                    LengthPercentageAuto,
                    Option<Dimension>,
                ) = match mode {
                    Resize::Start | Resize::Center => (length(start), auto(), None),
                    Resize::End => (auto(), length(full - start - size), None),
                    Resize::Both => (
                        length(start),
                        length(full - start - size),
                        Some(Dimension::auto()),
                    ),
                    Resize::Scale => (percent(start / full), auto(), Some(percent(size / full))),
                };
                center[axis] = mode == Resize::Center;
                if axis == 0 {
                    (inset.left, inset.right) = (lo, hi);
                    if let Some(d) = dim {
                        style.size.width = d;
                    }
                } else {
                    (inset.top, inset.bottom) = (lo, hi);
                    if let Some(d) = dim {
                        style.size.height = d;
                    }
                }
            }
            style.inset = inset;
        }

        let mut kids = Vec::new();
        let node = match kind {
            "text@1" => {
                let leaf = self.leaf(id, params)?;
                self.taffy.new_leaf_with_context(style, leaf)
            }
            "frame@1" => {
                if doc.lays_out(id) {
                    Self::frame_style(id, params, &mut style)?;
                    for kid in doc.children.get(id).into_iter().flatten() {
                        kids.push(self.node(kid, Some(id))?);
                    }
                    if params.get("layout").and_then(Value::as_str) == Some("grid") {
                        self.place(id, params, &kids)?;
                    }
                }
                let nodes: Vec<NodeId> = kids.iter().map(|k| k.node).collect();
                self.taffy.new_with_children(style, &nodes)
            }
            // Any other mark lays out by its box's size; one with no box can't be placed.
            _ if own_box.is_none() => return refuse("no_box", id),
            _ => self.taffy.new_leaf(style),
        };
        Ok(Built {
            node: node.map_err(|_| failed(id))?,
            id: id.to_string(),
            center,
            reference,
            kids,
        })
    }

    fn leaf(&mut self, id: &str, params: &Map<String, Value>) -> Result<Leaf, Refusal> {
        let bound = self.doc.bound.contains(id);
        // A child sized by a live value uses its `widest`, so a reading never resizes it.
        let text = if bound {
            match params.get("widest").and_then(Value::as_str) {
                Some(w) => w,
                None => return refuse("widest_missing", id),
            }
        } else {
            params.get("text").and_then(Value::as_str).unwrap_or("")
        };
        let role = match params.get("font").map(Value::as_str) {
            None => Role::Body,
            Some(Some(name)) => match Role::parse(name) {
                Some(role) => role,
                None => return refuse("bad_font", id),
            },
            Some(None) => return refuse("bad_layout", id),
        };
        let size = num(params.get("size"), 13., id)?;
        let weight = num(params.get("weight"), 400., id)?;
        if size <= 0. || !(1. ..=1000.).contains(&weight) {
            return refuse("bad_layout", id);
        }
        let shaped = self.shaper.shape(&Spec {
            role,
            size,
            weight: weight as u16,
            line_height: params
                .get("line_height")
                .map(|v| num(Some(v), 0., id))
                .transpose()?,
            width: params
                .get("box")
                .and_then(|b| b.get("w"))
                .map(|v| num(Some(v), 0., id))
                .transpose()?,
            bound,
            tabular: bound,
            ..Spec::label(text)
        });
        Ok(Leaf {
            size: Size {
                width: shaped.width,
                height: shaped.height,
            },
            baseline: shaped.glyphs.first().map(|g| g.y),
        })
    }

    /// A laying-out frame's own fields: its flex or grid container style.
    fn frame_style(
        id: &str,
        params: &Map<String, Value>,
        style: &mut Style,
    ) -> Result<(), Refusal> {
        let layout = params.get("layout").and_then(Value::as_str);
        match layout {
            Some("row") => style.flex_direction = FlexDirection::Row,
            Some("column") => style.flex_direction = FlexDirection::Column,
            Some("grid") => style.display = Display::Grid,
            _ => return refuse("bad_layout", id),
        }
        if params.get("wrap").and_then(Value::as_bool) == Some(true) {
            style.flex_wrap = FlexWrap::Wrap;
        }
        let padding = num(params.get("padding"), 0., id)?;
        style.padding = Rect::length(padding);
        // `gap: [x, y]`: between columns, then between rows.
        let gap = match params.get("gap") {
            Some(Value::Array(g)) => match g.as_slice() {
                [x, y] => [num(Some(x), 0., id)?, num(Some(y), 0., id)?],
                _ => return refuse("bad_layout", id),
            },
            g => [num(g, 0., id)?; 2],
        };
        style.gap = Size {
            width: length(gap[0]),
            height: length(gap[1]),
        };
        style.justify_content = Some(match params.get("align_main").map(Value::as_str) {
            None | Some(Some("start")) => JustifyContent::START,
            Some(Some("center")) => JustifyContent::CENTER,
            Some(Some("end")) => JustifyContent::END,
            Some(Some("between")) => JustifyContent::SPACE_BETWEEN,
            _ => return refuse("bad_layout", id),
        });
        style.align_items = align(params.get("align_cross"), id)?;
        style.justify_items = Some(AlignItems::START);
        if layout == Some("grid") {
            let grid = params.get("grid");
            style.grid_template_rows = tracks(grid.and_then(|g| g.get("rows")), id)?;
            style.grid_template_columns = tracks(grid.and_then(|g| g.get("cols")), id)?;
            // Tracks past the template hug.
            let hug = minmax(
                MinTrackSizingFunction::max_content(),
                MaxTrackSizingFunction::max_content(),
            );
            style.grid_auto_rows = vec![hug];
            style.grid_auto_columns = vec![hug];
            style.align_content = Some(AlignContent::START);
            style.justify_content = Some(JustifyContent::START);
        }
        Ok(())
    }

    /// A grid's flow: each flow child's cell in order, by row or by column, reversed on an axis,
    /// with its row's and its column's alignment.
    fn place(
        &mut self,
        id: &str,
        params: &Map<String, Value>,
        kids: &[Built],
    ) -> Result<(), Refusal> {
        let grid = params.get("grid");
        let field = |key: &str| grid.and_then(|g| g.get(key));
        let len = |key: &str| field(key).and_then(Value::as_array).map_or(0, Vec::len);
        let by_column = match field("flow").map(Value::as_str) {
            None | Some(Some("row")) => false,
            Some(Some("column")) => true,
            _ => return refuse("bad_layout", id),
        };
        let reverse = match field("reverse").map(Value::as_str) {
            None | Some(Some("none")) => [false, false],
            Some(Some("x")) => [true, false],
            Some(Some("y")) => [false, true],
            _ => return refuse("bad_layout", id),
        };
        let align_rows = aligns(field("align_rows"), id)?;
        let align_cols = aligns(field("align_cols"), id)?;
        let flow: Vec<&Built> = kids
            .iter()
            .filter(|k| {
                self.taffy
                    .style(k.node)
                    .is_ok_and(|s| s.position != Position::Absolute)
            })
            .collect();
        let n = flow.len();
        let (rows, cols) = if by_column {
            let rows = len("rows").max(1);
            (rows, len("cols").max(n.div_ceil(rows)))
        } else {
            let cols = len("cols").max(1);
            (len("rows").max(n.div_ceil(cols)), cols)
        };
        for (i, kid) in flow.into_iter().enumerate() {
            let (mut row, mut col) = if by_column {
                (i % rows, i / rows)
            } else {
                (i / cols, i % cols)
            };
            if reverse[0] {
                col = cols - 1 - col;
            }
            if reverse[1] {
                row = rows - 1 - row;
            }
            let mut style = self
                .taffy
                .style(kid.node)
                .cloned()
                .map_err(|_| failed(&kid.id))?;
            let line_of = |i: usize| -> GridPlacement<String> {
                line(i16::try_from(i + 1).unwrap_or(i16::MAX))
            };
            style.grid_row = Line {
                start: line_of(row),
                end: span(1),
            };
            style.grid_column = Line {
                start: line_of(col),
                end: span(1),
            };
            if style.justify_self.is_none() {
                style.justify_self = align_cols.get(col).copied().flatten();
            }
            if style.align_self.is_none() {
                style.align_self = align_rows.get(row).copied().flatten();
            }
            self.taffy
                .set_style(kid.node, style)
                .map_err(|_| failed(&kid.id))?;
        }
        Ok(())
    }

    /// Reads each built node's box back, from its parent's origin `at`.
    fn read(
        &self,
        built: &Built,
        at: [f32; 2],
        parent: [f32; 2],
        out: &mut BTreeMap<String, Rect4>,
    ) {
        let Ok(layout) = self.taffy.layout(built.node) else {
            return;
        };
        let mut x = at[0] + layout.location.x;
        let mut y = at[1] + layout.location.y;
        // A centered child keeps its offset from the frame's middle as the frame grows.
        if built.center[0] {
            x += (parent[0] - built.reference[0]) / 2.;
        }
        if built.center[1] {
            y += (parent[1] - built.reference[1]) / 2.;
        }
        let size = [layout.size.width, layout.size.height];
        out.insert(
            built.id.clone(),
            [
                f64::from(x),
                f64::from(y),
                f64::from(size[0]),
                f64::from(size[1]),
            ],
        );
        for kid in &built.kids {
            self.read(kid, [x, y], size, out);
        }
    }
}

/// Lays out every frame in `doc`: a box for each frame and for each child of a frame that lays
/// out. A frame whose parent doesn't lay it out is a root at its `at.pos` plus its box's corner,
/// in its parent's space; it hugs its children unless its box fixes a side.
pub fn solve(doc: &Value, shaper: &mut Shaper) -> Result<BTreeMap<String, Rect4>, Refusal> {
    let Some(doc) = Doc::new(doc) else {
        return refuse("bad_input", "");
    };
    let mut out = BTreeMap::new();
    for (id, item) in doc.items {
        let parent = item.get("parent").and_then(Value::as_str);
        if doc.kind(id) != "frame@1" || parent.is_some_and(|p| doc.lays_out(p)) {
            continue;
        }
        let mut tree = Tree {
            doc: &doc,
            taffy: TaffyTree::new(),
            shaper: &mut *shaper,
        };
        // Boxes are read before device-pixel snapping, which happens when they're drawn.
        tree.taffy.disable_rounding();
        let built = tree.node(id, None)?;
        tree.taffy
            .compute_layout_with_measure(built.node, Size::MAX_CONTENT, |inputs, _, leaf, style| {
                let size = leaf.as_ref().map_or(Size::ZERO, |l| l.size);
                let mut out =
                    compute_leaf_layout(inputs, style, |_, _| 0., |known, _| known.unwrap_or(size));
                out.baselines.first = leaf.and_then(|l| l.baseline);
                out
            })
            .map_err(|_| failed(id))?;
        let pos = item
            .get("at")
            .and_then(|a| a.get("pos"))
            .and_then(Value::as_array);
        let coord = |i: usize| {
            pos.and_then(|p| p.get(i))
                .and_then(Value::as_f64)
                .unwrap_or(0.) as f32
        };
        let corner = frame_box(doc.params(id), id)?.map_or([0.; 2], |b| [b[0], b[1]]);
        tree.read(
            &built,
            [coord(0) + corner[0], coord(1) + corner[1]],
            [0.; 2],
            &mut out,
        );
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A document of a root frame `root` with `params` and children `(id, kind, params)` in order.
    fn doc(params: Value, kids: &[(&str, &str, Value)]) -> Value {
        let mut items = Map::new();
        items.insert(
            "root".into(),
            json!({"id": "root", "kind": "frame@1", "order": "a0", "params": params}),
        );
        for (i, (id, kind, p)) in kids.iter().enumerate() {
            items.insert(
                (*id).into(),
                json!({"id": id, "kind": kind, "parent": "root", "order": format!("a{i}"), "params": p}),
            );
        }
        json!({ "items": items })
    }

    fn tile(w: f64, h: f64) -> Value {
        json!({"box": [0, 0, w, h], "width": "fixed", "height": "fixed"})
    }

    fn boxes(doc: &Value) -> BTreeMap<String, Rect4> {
        solve(doc, &mut Shaper::new()).expect("lays out")
    }

    #[test]
    fn reverse_x_flows_a_grid_from_the_east_column() {
        let grid = |reverse: &str| {
            doc(
                json!({"layout": "grid", "gap": 10, "grid": {"cols": [40, 40, 40], "reverse": reverse}}),
                &[
                    ("a", "frame@1", tile(10., 10.)),
                    ("b", "frame@1", tile(10., 10.)),
                ],
            )
        };
        let reversed = boxes(&grid("x"));
        assert_eq!(reversed["a"][0], 100.);
        assert_eq!(reversed["b"][0], 50.);
        assert_eq!(boxes(&grid("none"))["a"][0], 0.);
    }

    #[test]
    fn align_rows_aligns_each_row_on_its_own() {
        let laid = boxes(&doc(
            json!({"layout": "grid", "grid": {"rows": [50, 50], "cols": [40], "align_rows": ["end", "center"]}}),
            &[
                ("a", "frame@1", tile(10., 10.)),
                ("b", "frame@1", tile(10., 20.)),
            ],
        ));
        assert_eq!(laid["a"][1], 40.);
        assert_eq!(laid["b"][1], 65.);
    }

    #[test]
    fn min_and_max_bound_a_hug_child() {
        let laid = boxes(&doc(
            json!({"layout": "row"}),
            &[
                (
                    "empty",
                    "frame@1",
                    json!({"layout": "row", "min": [30, 20]}),
                ),
                (
                    "text",
                    "text@1",
                    json!({"text": "a long line of words", "max": [20, 100]}),
                ),
            ],
        ));
        assert_eq!(&laid["empty"][2..], &[30., 20.]);
        assert_eq!(laid["text"][2], 20.);
    }

    #[test]
    fn an_absolute_child_resizes_with_its_frame_by_its_resize() {
        // The frame's box is 100 × 100; its flow child makes it hug 200 × 150.
        let child = |h: &str| {
            json!({"box": [10, 10, 20, 20], "width": "fixed", "height": "fixed",
                   "position": "absolute", "resize": {"h": h, "v": "start"}})
        };
        let laid = boxes(&doc(
            json!({"layout": "row", "box": [0, 0, 100, 100]}),
            &[
                ("flow", "frame@1", tile(200., 150.)),
                ("start", "frame@1", child("start")),
                ("end", "frame@1", child("end")),
                ("both", "frame@1", child("both")),
                ("center", "frame@1", child("center")),
                ("scale", "frame@1", child("scale")),
            ],
        ));
        assert_eq!(&laid["root"][2..], &[200., 150.]);
        assert_eq!(laid["flow"][0], 0.);
        assert_eq!([laid["start"][0], laid["start"][2]], [10., 20.]);
        assert_eq!([laid["end"][0], laid["end"][2]], [110., 20.]);
        assert_eq!([laid["both"][0], laid["both"][2]], [10., 120.]);
        assert_eq!([laid["center"][0], laid["center"][2]], [60., 20.]);
        assert_eq!([laid["scale"][0], laid["scale"][2]], [20., 40.]);
        assert_eq!(laid["end"][1], 10.);
    }

    #[test]
    fn a_bound_text_without_widest_is_refused() {
        let mut d = doc(
            json!({"layout": "row"}),
            &[("value", "text@1", json!({"text": ""}))],
        );
        d["bound_values"] =
            json!({"v": {"target": "items/value/params/text", "source": "reading:x"}});
        let refused = solve(&d, &mut Shaper::new()).unwrap_err();
        assert_eq!(
            (refused.code, refused.item.as_str()),
            ("widest_missing", "value")
        );
    }
}
