//! The Lottie writer (canvas primitives: Export: Lottie): a document's 2D items, groups, paths,
//! paints, masks, mattes, keys and markers in the types Lottie 1.0.1 defines, with a warning for
//! each item it can't hold and each value it sampled. It reads the document as the motion
//! evaluator gives it at each export frame, so what it writes is what the frames show; a
//! channel's own keys are written as Lottie's only where Lottie's evaluation of them gives the
//! document's value at every export frame.

pub mod holds;
pub mod keys;
mod layers;
mod paint;
mod shapes;
pub mod text;

use std::collections::BTreeMap;

use deep_canvas::schedule::core_ops::Datum;
use deep_canvas_marks::scene::{Palette, Type};
use deep_canvas_motion::eval::{self, Validity};
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

use keys::num;

/// What a warning says: an item Lottie can't hold (it fails a claim's export check) or a value
/// the writer sampled at each export frame (listed, never failing).
#[derive(Clone, Debug, PartialEq)]
pub struct Warning {
    pub item: String,
    pub what: String,
    pub code: &'static str,
    pub path: String,
}

pub const CANT_HOLD: &str = "lottie.cant_hold";
pub const SAMPLED: &str = "lottie.sampled";

impl Warning {
    pub fn cant_hold(item: &str, what: String, path: String) -> Warning {
        Warning {
            item: item.to_string(),
            what,
            code: CANT_HOLD,
            path,
        }
    }
    pub fn sampled(item: &str, what: String, path: String) -> Warning {
        Warning {
            item: item.to_string(),
            what,
            code: SAMPLED,
            path,
        }
    }
    /// As the receipt lists it: `kind` says what an export check fails on (`cannot_hold`) and what
    /// it never fails on (`sampled`).
    pub fn json(&self) -> Value {
        let kind = if self.code == CANT_HOLD {
            "cannot_hold"
        } else {
            "sampled"
        };
        json!({"item": self.item, "kind": kind, "what": self.what, "code": self.code, "path": self.path})
    }
}

/// A wrong writer the acceptance tests plant (test builds only choose one).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Plant {
    #[default]
    None,
    /// Leaves every mask out, listing nothing.
    DropsMask,
    /// Leaves every mask out and lists it as an item Lottie can't hold.
    DropsMaskListed,
    /// Wraps each rotation into [−180, 180].
    WrapsRotation,
    /// Writes no markers.
    DropsMarkers,
}

/// The planted writers' names, as a scenario's `planted` gives them.
pub const PLANTED: [&str; 4] = [
    "lottie_writer_drops_mask",
    "lottie_writer_lists_mask",
    "lottie_wraps_rotation",
    "lottie_writer_drops_markers",
];

impl Plant {
    pub fn named(name: Option<&str>) -> Plant {
        match name {
            Some("lottie_writer_drops_mask") => Plant::DropsMask,
            Some("lottie_writer_lists_mask") => Plant::DropsMaskListed,
            Some("lottie_wraps_rotation") => Plant::WrapsRotation,
            Some("lottie_writer_drops_markers") => Plant::DropsMarkers,
            _ => Plant::None,
        }
    }
}

/// The export's frames: `n` frames from absolute frame `first`, `frame` flicks each, at `rate`.
#[derive(Clone, Copy, Debug)]
pub struct Frames {
    pub rate: (u32, u32),
    pub frame: i64,
    pub first: i64,
    pub n: usize,
}

impl Frames {
    fn t(&self, j: usize) -> i64 {
        (self.first + j as i64) * self.frame
    }
    fn t0(&self) -> i64 {
        self.first * self.frame
    }
    /// Flicks as export frames from the file's first.
    pub(crate) fn at(&self, t: i64) -> f64 {
        (t - self.t0()) as f64 / self.frame as f64
    }
}

/// What the writer made: the Lottie document, its warnings, and the box (in document units,
/// over every frame) of each item it lists as one Lottie can't hold, `None` when it has none.
pub struct Written {
    pub lottie: Value,
    pub warnings: Vec<Warning>,
    pub boxes: Vec<(String, Option<[f64; 4]>)>,
    /// Per export frame, each text turned about z there, with its box as drawn unturned and as
    /// turned: the 2D frames draw no text's turn yet, so the fidelity check can't compare those
    /// pixels.
    pub turned: Vec<Vec<(String, [f64; 4])>>,
}

/// A refusal before anything is written.
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
    pub code: &'static str,
    pub path: String,
    pub what: String,
}

impl Refusal {
    pub fn json(&self) -> Value {
        json!({"code": self.code, "path": self.path, "what": self.what})
    }
}

/// The status rule a Lottie can't keep: a document with a status binding, an entry in
/// `status_bindings` or an item's own `status` field, is refused.
pub fn status_refusal(doc: &Map<String, Value>) -> Option<Refusal> {
    if let Some((id, b)) = doc
        .get("status_bindings")
        .and_then(Value::as_object)
        .and_then(|b| b.iter().next())
    {
        let target = b.get("target").and_then(Value::as_str).unwrap_or("");
        let item = target
            .strip_prefix("items/")
            .and_then(|t| t.split('/').next())
            .unwrap_or(target);
        return Some(Refusal {
            code: "lottie.status_binding",
            path: format!("status_bindings/{id}"),
            what: format!("status binding {id} binds item {item}: a Lottie can't keep the status rule, so a document with a status binding isn't exported to Lottie"),
        });
    }
    let items = doc.get("items").and_then(Value::as_object)?;
    let (id, _) = items
        .iter()
        .find(|(_, i)| i.pointer("/params/status").is_some_and(|s| !s.is_null()))?;
    Some(Refusal {
        code: "lottie.status_binding",
        path: format!("items/{id}/params/status"),
        what: format!("item {id}'s status field binds a status: a Lottie can't keep the status rule, so a document with a status binding isn't exported to Lottie"),
    })
}

/// The shared reading every part of the writer takes.
pub(crate) struct Ctx<'a> {
    pub doc: &'a Map<String, Value>,
    pub program: &'a Program,
    pub palette: &'a Palette,
    pub ty: &'a Type,
    pub frames: Frames,
    /// Each export frame's evaluated items.
    pub evals: Vec<Map<String, Value>>,
    pub warnings: Vec<Warning>,
    pub plant: Plant,
    /// Each export frame's text glyphs, as the frames draw them (empty: texts aren't written).
    pub texts: text::Texts,
}

impl Ctx<'_> {
    /// The value at `pointer` in item `id` at every export frame, as numbers.
    pub fn series(
        &self,
        id: &str,
        read: &dyn Fn(&Value) -> Option<Vec<f64>>,
    ) -> Option<Vec<Vec<f64>>> {
        self.evals
            .iter()
            .map(|items| items.get(id).and_then(read))
            .collect()
    }

    /// A sampled value's warning, naming what sets it.
    pub fn sampled(&mut self, id: &str, field: &str) {
        let source = self.source(id, field);
        let what = format!(
            "items/{id}/{field} sampled as linear keys at each export frame: {}",
            source.1
        );
        if !self
            .warnings
            .iter()
            .any(|w| w.code == SAMPLED && w.item == id && w.path == source.0)
        {
            self.warnings.push(Warning::sampled(id, what, source.0));
        }
    }

    /// What sets item `id`'s `field` (a path inside the item, `/`-joined): a driver, a
    /// constraint, a channel whose interpolation Lottie hasn't, or the evaluation (a parent, a
    /// follow, a flip, a remap or a placement).
    fn source(&self, id: &str, field: &str) -> (String, String) {
        use deep_canvas_motion::curve::Interp::*;
        let motion = &self.program.motion;
        let under = |f: &[String]| {
            let p = f.join("/");
            p == field || p.starts_with(&format!("{field}/")) || field.starts_with(&format!("{p}/"))
        };
        if let Some(d) = motion
            .drivers
            .iter()
            .find(|d| d.target.owner == id && under(&d.target.field))
        {
            return (
                format!("drivers/{}", d.id),
                format!("driver {} sets it from {}", d.id, d.text),
            );
        }
        if let Some(c) = motion.constraints.iter().find(|c| c.owner == id) {
            return (
                format!("constraints/{}", c.id),
                format!("constraint {} ({}) sets it", c.id, c.kind.name()),
            );
        }
        if let Some(c) = motion
            .channels
            .iter()
            .find(|c| c.target.owner == id && under(&c.target.field))
        {
            let how = match c.curve.keys.first().map(|k| &k.interp) {
                Some(i) => format!("channel {}'s {}", c.id, interp_name(i)),
                None => format!("channel {}", c.id),
            };
            let native = c
                .curve
                .keys
                .iter()
                .all(|k| matches!(k.interp, Hold | Linear | Bezier { .. } | Auto { .. }));
            let what = if native && c.target.field.join("/") != field {
                format!(
                    "channel {} moves it through what Lottie can't key itself",
                    c.id
                )
            } else {
                format!("{how} isn't one Lottie interpolates")
            };
            return (format!("channels/{}", c.id), what);
        }
        (
            format!("items/{id}/{field}"),
            "the evaluation sets it beyond its keys".into(),
        )
    }
}

fn interp_name(i: &deep_canvas_motion::curve::Interp) -> &'static str {
    use deep_canvas_motion::curve::Interp::*;
    match i {
        Hold => "hold keys",
        Linear => "linear keys",
        Bezier { .. } => "Bézier keys",
        Spring(_) => "spring",
        Ease(_) => "named ease",
        Table => "ease table",
        Auto { .. } => "auto tangents",
        CatmullRom => "Catmull-Rom keys",
        Quantize { .. } => "quantize keys",
    }
}

/// Writes `doc` (as the export draws it) to Lottie over `frames`, colors from `palette`.
pub fn write(
    doc: &Map<String, Value>,
    (palette, ty): (&Palette, &Type),
    frames: Frames,
    (images, texts): (bool, text::Texts),
    plant: Plant,
) -> Result<Written, Refusal> {
    if let Some(r) = status_refusal(doc) {
        return Err(r);
    }
    let program = Program::compile(doc).map_err(|r| Refusal {
        code: "lottie.unevaluated",
        path: r.path.clone(),
        what: format!(
            "the document's motion doesn't compile ({}), so its values can't be read",
            r.code
        ),
    })?;
    let mut state = program.state();
    let evals: Vec<Map<String, Value>> = (0..frames.n)
        .map(|j| {
            let mut items =
                eval::frame_with(doc, &program, frames.t(j), Validity::Full, &mut state).items;
            // Each field a channel writes, put at its own path: a list entry by its index.
            for id in &program.items {
                let (Some(item), Some((_, fields))) =
                    (items.get_mut(id), program.item_values(&state, id))
                else {
                    continue;
                };
                for (path, datum) in fields {
                    let value = match datum {
                        Datum::Num(v) => json!(v),
                        Datum::Nums(v) => json!(v),
                        Datum::Bool(b) => json!(b),
                        Datum::Text(t) => json!(t),
                        Datum::Typed(_) => continue,
                    };
                    put(item, &path, value);
                }
            }
            items
        })
        .collect();
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut warnings = holds::listed(doc, &items);
    if !images {
        for (id, item) in &items {
            if item.get("kind").and_then(Value::as_str) == Some("image@1")
                && item.get("visible") != Some(&Value::Bool(false))
            {
                warnings.push(Warning::cant_hold(
                    id,
                    "an image left out: images: none".into(),
                    format!("items/{id}"),
                ));
            }
        }
    }
    warnings.extend(orders_that_change(&items, &evals));
    let mut ctx = Ctx {
        doc,
        program: &program,
        palette,
        ty,
        frames,
        evals,
        warnings,
        plant,
        texts,
    };
    let (layers, assets) = layers::all(&mut ctx, &items, images);
    let size = doc.get("size").and_then(Value::as_array);
    let dim = |i: usize| {
        size.and_then(|s| s.get(i))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    let (p, q) = frames.rate;
    let mut root = Map::new();
    root.insert("v".into(), json!("5.12.2"));
    root.insert(
        "nm".into(),
        doc.get("id").cloned().unwrap_or(json!("document")),
    );
    root.insert("fr".into(), num(f64::from(p) / f64::from(q)));
    root.insert("ip".into(), json!(0));
    root.insert("op".into(), json!(frames.n));
    root.insert("w".into(), num(dim(0)));
    root.insert("h".into(), num(dim(1)));
    root.insert("ddd".into(), json!(0));
    root.insert("assets".into(), Value::Array(assets));
    root.insert("layers".into(), Value::Array(layers));
    if plant != Plant::DropsMarkers {
        root.insert("markers".into(), Value::Array(markers(&ctx)));
    }
    let boxes = cant_hold_boxes(&ctx);
    let turned = turned_boxes(&ctx);
    let mut warnings = std::mem::take(&mut ctx.warnings);
    // One warning per item and what, in a fixed order.
    let mut seen = BTreeMap::new();
    warnings.retain(|w| {
        seen.insert((w.item.clone(), w.code, w.path.clone()), ())
            .is_none()
    });
    Ok(Written {
        lottie: Value::Object(root),
        warnings,
        boxes,
        turned,
    })
}

/// The document's markers as Lottie's, in time order: name, start and span in export frames;
/// a marker with no span lasts to the next one, the last to the export's end.
fn markers(ctx: &Ctx) -> Vec<Value> {
    let mut list: Vec<(i64, i64, String)> = ctx
        .program
        .motion
        .markers
        .iter()
        .map(|m| {
            let name = pointer(ctx.doc, &format!("/markers/{}/name", m.id))
                .and_then(Value::as_str)
                .unwrap_or(&m.id)
                .to_string();
            (m.start, m.end, name)
        })
        .collect();
    list.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.2.cmp(&b.2)));
    let end = ctx.frames.t(ctx.frames.n);
    (0..list.len())
        .map(|i| {
            let (start, stop, name) = &list[i];
            let stop = if stop > start {
                *stop
            } else {
                list.get(i + 1).map_or(end, |n| n.0)
            };
            let tm = ctx.frames.at(*start);
            let dr = ctx.frames.at(stop) - tm;
            json!({"cm": name, "tm": num(tm), "dr": num(dr)})
        })
        .collect()
}

/// Each item listed as one Lottie can't hold, with its box over every frame where it draws.
fn cant_hold_boxes(ctx: &Ctx) -> Vec<(String, Option<[f64; 4]>)> {
    let mut out: Vec<(String, Option<[f64; 4]>)> = Vec::new();
    for w in ctx.warnings.iter().filter(|w| w.code == CANT_HOLD) {
        if out.iter().any(|(id, _)| *id == w.item) {
            continue;
        }
        let mut b: Option<[f64; 4]> = None;
        let mut known = !ctx.evals.is_empty();
        for (j, items) in ctx.evals.iter().enumerate() {
            let glyphs = ctx
                .texts
                .get(j)
                .and_then(|t| t.get(&w.item))
                .and_then(|g| text::bounds(g));
            match glyphs.or_else(|| items.get(&w.item).and_then(layers::world_box)) {
                Some(x) => b = Some(b.map_or(x, |a| union(a, x))),
                None => known = false,
            }
        }
        out.push((w.item.clone(), if known { b } else { None }));
    }
    out
}

pub(crate) fn union(a: [f64; 4], b: [f64; 4]) -> [f64; 4] {
    let x0 = a[0].min(b[0]);
    let y0 = a[1].min(b[1]);
    let x1 = (a[0] + a[2]).max(b[0] + b[2]);
    let y1 = (a[1] + a[3]).max(b[1] + b[3]);
    [x0, y0, x1 - x0, y1 - y0]
}

/// A JSON pointer into a document held as a map.
pub(crate) fn pointer<'a>(m: &'a Map<String, Value>, p: &str) -> Option<&'a Value> {
    let p = p.strip_prefix('/')?;
    match p.split_once('/') {
        Some((first, rest)) => m.get(first)?.pointer(&format!("/{rest}")),
        None => m.get(p),
    }
}

/// `value` at `path` in `item`, a numeric part indexing a list.
fn put(item: &mut Value, path: &[String], value: Value) {
    let Some((last, head)) = path.split_last() else {
        return;
    };
    let mut at = item;
    for part in head {
        at = match at {
            Value::Array(a) => match part.parse::<usize>().ok().and_then(|i| a.get_mut(i)) {
                Some(v) => v,
                None => return,
            },
            Value::Object(m) => m.entry(part.clone()).or_insert_with(|| json!({})),
            _ => return,
        };
    }
    match at {
        Value::Array(a) => {
            if let Some(slot) = last.parse::<usize>().ok().and_then(|i| a.get_mut(i)) {
                *slot = value;
            }
        }
        Value::Object(m) => {
            m.insert(last.clone(), value);
        }
        _ => {}
    }
}

/// Each group whose children's draw order changes over the export (a `sort: y` group, or a
/// keyed `draw_order`): a draw order Lottie's fixed layer order can't hold.
fn orders_that_change(items: &Map<String, Value>, evals: &[Map<String, Value>]) -> Vec<Warning> {
    let mut out = Vec::new();
    for (gid, g) in items {
        let sorts = g.pointer("/params/sort").and_then(Value::as_str) == Some("y");
        let keyed = evals.windows(2).any(|w| {
            let a = w[0].get(gid).and_then(|i| i.pointer("/params/draw_order"));
            let b = w[1].get(gid).and_then(|i| i.pointer("/params/draw_order"));
            a != b
        });
        if !sorts && !keyed {
            continue;
        }
        let anchor = g
            .pointer("/params/sort_anchor/1")
            .and_then(Value::as_f64)
            .unwrap_or(1.0);
        let order_at = |frame: &Map<String, Value>| -> Vec<String> {
            let mut kids: Vec<(f64, String, String)> = frame
                .iter()
                .filter(|(_, c)| c.get("parent").and_then(Value::as_str) == Some(gid.as_str()))
                .map(|(cid, c)| {
                    let y = layers::world_box(c).map_or(0.0, |b| b[1] + anchor * b[3]);
                    let order = c
                        .get("order")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    (y, order, cid.clone())
                })
                .collect();
            kids.sort_by(|a, b| {
                a.0.total_cmp(&b.0)
                    .then_with(|| a.1.cmp(&b.1))
                    .then_with(|| a.2.cmp(&b.2))
            });
            kids.into_iter().map(|k| k.2).collect()
        };
        let first = evals.first().map(order_at).unwrap_or_default();
        if keyed || evals.iter().skip(1).any(|f| order_at(f) != first) {
            out.push(Warning::cant_hold(
                gid,
                "a draw order that changes with t: Lottie draws its layers in one fixed order"
                    .into(),
                format!(
                    "items/{gid}/params/{}",
                    if keyed { "draw_order" } else { "sort" }
                ),
            ));
        }
    }
    out
}

/// Per export frame, each text whose evaluated turn about z isn't 0 there, with its box as
/// drawn unturned and as turned about its origin, where its pivot sits by default.
fn turned_boxes(ctx: &Ctx) -> Vec<Vec<(String, [f64; 4])>> {
    ctx.evals
        .iter()
        .enumerate()
        .map(|(j, items)| {
            items
                .iter()
                // The 2D frames turn every drawn item but text, whose glyphs draw unturned yet.
                .filter(|(_, i)| {
                    i.get("visible") != Some(&Value::Bool(false))
                        && i.get("kind").and_then(Value::as_str) == Some("text@1")
                })
                .filter_map(|(id, item)| {
                    let rot = item
                        .pointer("/at/rot/2")
                        .and_then(Value::as_f64)
                        .unwrap_or(0.0);
                    if rot == 0.0 {
                        return None;
                    }
                    // Where it draws unturned: its glyphs at this frame.
                    let drawn = ctx
                        .texts
                        .get(j)
                        .and_then(|t| t.get(id))
                        .and_then(|g| text::bounds(g))?;
                    let r = deep_canvas::ops::rad(rot);
                    let pos = [
                        item.pointer("/at/pos/0")
                            .and_then(Value::as_f64)
                            .unwrap_or(0.0),
                        item.pointer("/at/pos/1")
                            .and_then(Value::as_f64)
                            .unwrap_or(0.0),
                    ];
                    let (c, s) = (deep_canvas::ops::cos(r), deep_canvas::ops::sin(r));
                    let corners = [
                        [drawn[0], drawn[1]],
                        [drawn[0] + drawn[2], drawn[1]],
                        [drawn[0], drawn[1] + drawn[3]],
                        [drawn[0] + drawn[2], drawn[1] + drawn[3]],
                    ];
                    let turned: Vec<[f64; 2]> = corners
                        .iter()
                        .map(|p| {
                            let (x, y) = (p[0] - pos[0], p[1] - pos[1]);
                            [pos[0] + c * x - s * y, pos[1] + s * x + c * y]
                        })
                        .collect();
                    let (x0, x1) = turned
                        .iter()
                        .fold((f64::MAX, f64::MIN), |(a, z), p| (a.min(p[0]), z.max(p[0])));
                    let (y0, y1) = turned
                        .iter()
                        .fold((f64::MAX, f64::MIN), |(a, z), p| (a.min(p[1]), z.max(p[1])));
                    Some((id.clone(), union(drawn, [x0, y0, x1 - x0, y1 - y0])))
                })
                .collect()
        })
        .collect()
}
