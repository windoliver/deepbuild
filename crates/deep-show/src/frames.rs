//! The scheduler's side of `deep-show run` (issue #387; the #387 acceptance README: The surface
//! under test): the registry with every operator and contribution the seal kept, the canvas
//! modules' fixtures, `eval` (one frame of a document's session, live or clean, with a read-set
//! perturbation), `frames` (the scheduler's allocations and CPU per frame), interned handles and
//! outside data's batches.

use std::collections::BTreeMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::shaper::Pending;
use deep_canvas::document::Issue;
use deep_canvas::schedule::{
    default_view, HashVersion, OpIssue, Session as DocSession, Target, Val,
};
use deep_canvas_marks::modules::{Drawing, Run, StatusDrawing};
use serde_json::{json, Map, Value};

use crate::evidence;
use crate::hub::{Call, Eval, EvalTime, Frames, Hub, Show, INTERFACE_RUNS, SEAL_RUNS};
use crate::snapshot::{self, Drawn, Unfit};

/// An operator's error as a revision's issue.
pub fn op_issue(i: &OpIssue) -> Issue {
    let what = format!("{} can't evaluate this", i.operator);
    let actual = i.actual.clone().unwrap_or(Value::Null);
    // #544: a read a logic item doesn't declare names its close declared names as the canvas
    // does an unknown kind's.
    let close = actual
        .get("close")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .map(|n| json!({"name": n}))
        .collect();
    let issue = match &i.item {
        Some(id) => Issue::error(i.code, id, i.path.clone(), actual, &what),
        None => Issue::envelope(i.code, i.path.clone(), actual, &what),
    };
    Issue { close, ..issue }
}

/// What the renderer can't draw, as a revision's issue.
pub fn unfit_issue(code: &'static str, path: String) -> Issue {
    let what = "the marks module can't draw this";
    let item = path
        .strip_prefix("items/")
        .and_then(|p| p.split('/').next())
        .map(str::to_string);
    match item {
        Some(id) => Issue::error(code, &id, path.clone(), Value::Null, what),
        None => Issue::envelope(code, path, Value::Null, what),
    }
}

mod eval;
pub use eval::*;

/// Flicks in a second: the document clock's unit.
const FLICKS_PER_SECOND: f64 = 705_600_000.0;

/// The calling thread's CPU time, in ns.
fn thread_cpu_ns() -> u64 {
    let mut t = libc::timespec {
        tv_sec: 0,
        tv_nsec: 0,
    };
    // SAFETY: `t` is a valid timespec for the call to fill.
    unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
    t.tv_sec as u64 * 1_000_000_000 + t.tv_nsec as u64
}

/// Hands the render worker each text of `document` whose shaping the cost model estimates past
/// 1 ms, cold, and whose run the shaped-run cache doesn't hold yet; what to wait for.
fn shape_ahead(document: &Value) -> Vec<Pending> {
    let terms = deep_canvas::cost::Coefficients::reference().get("text.shape");
    let mut out = Vec::new();
    for (id, item) in document["items"].as_object().into_iter().flatten() {
        let is_text = item["kind"]
            .as_str()
            .is_some_and(|k| k.split('@').next() == Some("text"));
        let Some(params) = item["params"].as_object().filter(|_| is_text) else {
            continue;
        };
        let glyphs = deep_canvas::cost::counts(item).glyphs;
        if terms.ns_per_item + terms.ns_per_glyph * glyphs <= 1e6 {
            continue;
        }
        let Ok(spec) = deep_canvas_marks::scene::text_spec(id, params, None) else {
            continue;
        };
        let Some(spec) = spec.shaper_spec() else {
            continue;
        };
        if !deep_text::Shaper::is_cached(&spec) {
            out.push(crate::shaper::shape_later(&spec));
        }
    }
    out
}

/// The view a frame reads: the session's current revision's defaults, with the call's locale
/// and reduced motion over them.
pub(crate) fn session_view(session: &DocSession, over: &Map<String, Value>) -> [Value; 6] {
    let mut view = default_view(session.document().unwrap_or(&Value::Null));
    if let Some(l) = over.get("locale") {
        view[deep_canvas::schedule::LOCALE] = l.clone();
    }
    if let Some(r) = over.get("reduced_motion") {
        view[deep_canvas::schedule::REDUCED_MOTION] = r.clone();
    }
    view
}

/// What a session's frame draws: marks2d's draw list, in a build that holds marks2d, else the
/// core's boxes; and the text module's status marks with the legend, at the document's size.
pub(crate) struct Painted {
    pub drawing: Option<Arc<Drawing>>,
    pub boxes: Vec<CoreBox>,
    pub status: Option<Arc<StatusDrawing>>,
    pub size: [f64; 2],
}

/// An item of a canvas module's kind that the core draws as `rect@1` (Kind: `draws_as`): its
/// lowered box, moved by its world position, filled in the color of the role its paint names.
pub(crate) struct CoreBox {
    pub rect: [f64; 4],
    pub color: [u8; 3],
}

/// In a build without marks2d, the core's own boxes, in item order: every item whose kind a
/// canvas module registered with `draws_as: rect@1`. Marks2d draws them where it is held.
fn core_boxes(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
    doc: &Value,
) -> Vec<CoreBox> {
    let mut items: Vec<(&str, &str)> = doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(_, item)| {
            item["kind"]
                .as_str()
                .is_some_and(|k| sched.sealed.draws_as(k) == Some("rect@1"))
        })
        .map(|(id, item)| (item["order"].as_str().unwrap_or(""), id.as_str()))
        .collect();
    items.sort();
    let json = |array: &str, id: &str| match session.value(sched, array, Some(id)) {
        Some(Val::Json(v)) => Some(v),
        _ => None,
    };
    let num = |v: &Value| v.as_f64().unwrap_or(0.0);
    items
        .into_iter()
        .filter_map(|(_, id)| {
            let lowered = json("core.lowered", id)?;
            let b = lowered["params"]["box"].as_array()?;
            let pos = session
                .value(sched, "core.world", Some(id))
                .and_then(|w| w.as_typed::<deep_canvas::schedule::core_ops::Transform>())
                .map(|w| [w.pos[0], w.pos[1]]);
            let [x, y] = pos.unwrap_or([0.0, 0.0]);
            let role = lowered["params"]["paint"]["fill"]["role"]
                .as_str()
                .unwrap_or("ink");
            let c = session.look().get(role)?.as_array()?;
            let channel = |i: usize| c.get(i)?.as_u64().and_then(|v| u8::try_from(v).ok());
            Some(CoreBox {
                rect: [
                    x + num(b.first()?),
                    y + num(b.get(1)?),
                    num(b.get(2)?),
                    num(b.get(3)?),
                ],
                color: [channel(0)?, channel(1)?, channel(2)?],
            })
        })
        .collect()
}

/// Each cell grid's marks (#402): a cell whose background isn't the grid's own as a box, then
/// each row as one line of the mono face, its runs in their cells' colors.
fn cell_grids(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
    doc: &Value,
) -> Vec<deep_canvas_marks::scene::Drawn> {
    use deep_canvas_cells::module::Grid;
    use deep_canvas_marks::scene::{self, Fill, Mark};
    let mut out = Vec::new();
    // Each grid by its item, read once from the grid operator's own nodes (#854: a lookup per
    // item scanned every node, which a 10,000-item board paid on every frame).
    let grids: BTreeMap<&str, Val> = session
        .values(sched, "cells.grid")
        .into_iter()
        .filter_map(|(id, v)| Some((id?, v)))
        .collect();
    if grids.is_empty() {
        return out;
    }
    for (id, _) in doc["items"].as_object().into_iter().flatten() {
        let Some(g) = grids.get(id.as_str()).and_then(|v| v.as_typed::<Grid>()) else {
            continue;
        };
        let mark = |m: Mark| scene::Drawn {
            mark: m,
            clip: None,
            scopes: Vec::new(),
        };
        let [cw, ch] = g.cell;
        let w = cw * g.rows.first().map_or(0, |r| r.text.chars().count()) as f64;
        out.push(mark(Mark::Rect {
            item: id.clone(),
            bounds: [g.origin[0], g.origin[1], w, ch * g.rows.len() as f64],
            radius: 0.0,
            fill: Fill::Solid(g.bg),
        }));
        for (r, row) in g.rows.iter().enumerate() {
            let y = g.origin[1] + ch * r as f64;
            for (from, to, c) in &row.fills {
                out.push(mark(Mark::Rect {
                    item: id.clone(),
                    bounds: [
                        g.origin[0] + cw * *from as f64,
                        y,
                        cw * (to - from) as f64,
                        ch,
                    ],
                    radius: 0.0,
                    fill: Fill::Solid(*c),
                }));
            }
            let base = row.runs.first().map_or([0; 3], |r| r.2);
            let runs = row
                .runs
                .iter()
                .map(|(from, to, c)| scene::TextRun {
                    from: *from,
                    to: *to,
                    role: String::new(),
                    color: *c,
                    opacity: 1.0,
                })
                .collect();
            let text = row.text.trim_end().to_string();
            out.push(mark(Mark::Text {
                item: id.clone(),
                spec: scene::TextSpec {
                    spans: crate::terminal::cell_spacing(&text, cw, g.font_size),
                    gap: 0.0,
                    indent: 0.0,
                    text,
                    font: "mono".into(),
                    family: Some(deep_text::Role::Mono.family()),
                    fallback: Vec::new(),
                    lang: None,
                    size: g.font_size,
                    weight: 400,
                    width: None,
                    max_lines: None,
                    mask: false,
                    align: scene::Align::Start,
                    bound: false,
                },
                origin: [g.origin[0], y],
                role: None,
                color: base,
                runs,
            }));
        }
    }
    out
}

/// #220: each match morph between two vector items as a frame draws it: before its window only its
/// from item, after it only its to item, and inside it each piece in place of both, a shape in the
/// document's u filled in the role of the item it comes from at the piece's opacity.
fn morphed_vectors(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
    doc: &Value,
    frame: &deep_canvas_marks::scene::Frame,
) -> Option<deep_canvas_marks::scene::Frame> {
    use deep_canvas::schedule::core_ops::Fields;
    use deep_canvas_marks::path::Verb;
    use deep_canvas_marks::scene::{Drawn, Fill, Mark};
    use deep_canvas_motion::morph;
    let program = crate::film::program_of(sched, session)?;
    if program.betweens.is_empty() {
        return None;
    }
    let t = session.t();
    let fields = |id: &str| -> Option<Value> {
        let item = doc.pointer(&format!("/items/{id}"))?;
        (item["kind"].as_str() == Some("vector@1")).then_some(())?;
        session
            .read(sched, "core.fields", Some(id))
            .and_then(|(v, _)| v.as_typed::<Fields>())
            .map(|f| f.to_json())
    };
    let rgb = |role: &str| -> Option<[u8; 3]> {
        let c = session.look().get(role)?.as_array()?;
        let channel = |i: usize| c.get(i)?.as_u64().and_then(|v| u8::try_from(v).ok());
        Some([channel(0)?, channel(1)?, channel(2)?])
    };
    // Where marks2d placed each vector's outline: its path mark's offset, as a write-on reads it.
    let mut offsets: BTreeMap<&str, [f64; 2]> = BTreeMap::new();
    for m in frame.layers.iter().flat_map(|l| l.marks.iter()) {
        if let Mark::Path { item, offset, .. } = &m.mark {
            offsets.entry(item.as_str()).or_insert(*offset);
        }
    }
    let parts = |id: &str, item: &Value| -> Vec<morph::Part> {
        let [dx, dy] = offsets.get(id).copied().unwrap_or([0.0, 0.0]);
        morph::vector_parts(id, item)
            .into_iter()
            .map(|mut p| {
                for s in &mut p.shape {
                    for q in &mut s.points {
                        *q = [q[0] + dx, q[1] + dy];
                    }
                }
                p
            })
            .collect()
    };
    // Each item's marks dropped, and for the from item of an open window, the pieces drawn there.
    let mut dropped: BTreeMap<String, Option<Vec<Arc<Drawn>>>> = BTreeMap::new();
    let mut mix = [0u8; 8];
    for b in &program.betweens {
        let (Some(from), Some(to)) = (fields(&b.from), fields(&b.to)) else {
            continue;
        };
        if t <= b.start {
            dropped.insert(b.to.clone(), None);
            continue;
        }
        if t >= b.end {
            dropped.insert(b.from.clone(), None);
            continue;
        }
        let p = b.progress(t);
        let role = |item: &Value| {
            item.pointer("/params/outline/role")
                .and_then(Value::as_str)
                .unwrap_or("ink")
                .to_string()
        };
        let (role_a, role_z) = (role(&from), role(&to));
        let pieces = morph::pieces(
            &parts(&b.from, &from),
            &parts(&b.to, &to),
            &b.pairs,
            b.unpaired,
            p,
        );
        let marks = pieces
            .iter()
            .filter_map(|piece| {
                let color = rgb(if piece.from.is_some() {
                    &role_a
                } else {
                    &role_z
                })?;
                let mut verbs = Vec::new();
                for s in &piece.shape {
                    for (i, q) in s.points.iter().enumerate() {
                        verbs.push(if i == 0 {
                            Verb::Move(*q)
                        } else {
                            Verb::Line(*q)
                        });
                    }
                    if s.closed {
                        verbs.push(Verb::Close);
                    }
                }
                Some(Arc::new(Drawn {
                    mark: Mark::Shape {
                        item: b.from.clone(),
                        verbs,
                        fill: Some((Fill::Solid(color), piece.opacity.clamp(0.0, 1.0))),
                        stroke: None,
                    },
                    clip: None,
                    scopes: Vec::new(),
                }))
            })
            .collect();
        dropped.insert(b.from.clone(), Some(marks));
        dropped.insert(b.to.clone(), None);
        for (m, x) in mix.iter_mut().zip(p.to_bits().to_le_bytes()) {
            *m ^= x;
        }
    }
    if dropped.is_empty() {
        return None;
    }
    let owner = |m: &Drawn| match &m.mark {
        Mark::Path { item, .. } | Mark::Shape { item, .. } => Some(item.clone()),
        _ => None,
    };
    let mut frame = frame.clone();
    for layer in &mut frame.layers {
        if !layer
            .marks
            .iter()
            .any(|m| owner(m).is_some_and(|i| dropped.contains_key(&i)))
        {
            continue;
        }
        let mut marks = Vec::with_capacity(layer.marks.len());
        for m in &layer.marks {
            match owner(m).and_then(|i| dropped.get_mut(&i)) {
                None => marks.push(m.clone()),
                // The pieces stand where the from item's first mark stood.
                Some(pieces) => marks.extend(pieces.take().unwrap_or_default()),
            }
        }
        layer.marks = marks.into_iter().collect();
        for (k, x) in layer.key.0.iter_mut().zip(mix) {
            *k ^= x;
        }
    }
    Some(frame)
}

/// A frame as its text diffs draw it, with each unit's shaped run by its mark's item.
type Diffed = (
    deep_canvas_marks::scene::Frame,
    Vec<(String, Arc<deep_canvas_marks::modules::Run>)>,
);

/// #1968: each text diff between two code items as a frame draws it: before its window only its
/// from item, after it only its to item, and inside it each item's text giving way to its units,
/// moved and faded as the diff has them at its progress, while the rest each item draws (its
/// gutter, numbers and highlights) cross-fades from the old item's to the new one's.
fn diffed_code(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
    frame: &deep_canvas_marks::scene::Frame,
) -> Option<Diffed> {
    use deep_canvas_marks::diff::{self, Side};
    use deep_canvas_marks::scene::{Drawn, Scope};
    let program = crate::film::program_of(sched, session)?;
    let diffs: Vec<_> = program
        .betweens
        .iter()
        .filter_map(|b| Some((b, b.diff.as_ref()?)))
        .collect();
    if diffs.is_empty() {
        return None;
    }
    let t = session.t();
    let base = |m: &Drawn| -> String {
        let item = m.mark.item();
        item.split('#').next().unwrap_or(item).to_string()
    };
    let mut frame = frame.clone();
    let mut runs = Vec::new();
    for (b, d) in diffs {
        let p = b.progress(t);
        let (a, z) = (
            text_mark(&frame, &b.from).cloned(),
            text_mark(&frame, &b.to).cloned(),
        );
        let units = match (&a, &z) {
            (Some(a), Some(z)) if t > b.start && t < b.end => {
                match (Side::of(a, &d.old), Side::of(z, &d.new)) {
                    (Some(old), Some(new)) => Some(diff::marks(
                        &old,
                        &new,
                        &diff::moved(&old, &new, &d.matching, p),
                    )),
                    _ => None,
                }
            }
            _ => None,
        };
        for m in units.iter().flatten() {
            if let Some(run) = diff::run_of(&m.mark) {
                runs.push((m.mark.item().to_string(), Arc::new(run)));
            }
        }
        // Each item's marks at their opacity in the frame: none, all, or faded.
        let (from, to) = match (t <= b.start, t >= b.end) {
            (true, _) => (1.0, 0.0),
            (_, true) => (0.0, 1.0),
            _ => (1.0 - p, p),
        };
        let mut units = units.map(|u| u.into_iter());
        for layer in &mut frame.layers {
            if !layer
                .marks
                .iter()
                .any(|m| [&b.from, &b.to].contains(&&base(m)))
            {
                continue;
            }
            let mut marks: Vec<Arc<Drawn>> = Vec::with_capacity(layer.marks.len());
            for m in layer.marks.iter() {
                let owner = base(m);
                let alpha = if owner == b.from {
                    from
                } else if owner == b.to {
                    to
                } else {
                    marks.push(m.clone());
                    continue;
                };
                // Inside the window, the two texts draw as their units, where the old one stood.
                if let Some(units) = units.as_mut().filter(|_| m.mark.item() == owner) {
                    if owner == b.from {
                        marks.extend(units.by_ref());
                    }
                    continue;
                }
                if alpha <= 0.0 {
                    continue;
                }
                if alpha >= 1.0 {
                    marks.push(m.clone());
                    continue;
                }
                let mut scopes = m.scopes.clone();
                scopes.push(Scope::Opacity {
                    item: format!("{}#diff", m.mark.item()),
                    alpha,
                    blend: None,
                    effect: None,
                });
                marks.push(Arc::new(Drawn {
                    mark: m.mark.clone(),
                    clip: m.clip,
                    scopes,
                }));
            }
            layer.marks = marks.into_iter().collect();
            // Before the window too the layer holds other marks than its items drew.
            for (k, x) in layer
                .key
                .0
                .iter_mut()
                .zip((1.0 + p).to_bits().to_le_bytes())
            {
                *k ^= x;
            }
        }
    }
    Some((frame, runs))
}

/// The text mark the item `id` draws in `frame`.
fn text_mark<'a>(
    frame: &'a deep_canvas_marks::scene::Frame,
    id: &str,
) -> Option<&'a Arc<deep_canvas_marks::scene::Drawn>> {
    frame.layers.iter().flat_map(|l| l.marks.iter()).find(
        |m| matches!(&m.mark, deep_canvas_marks::scene::Mark::Text { item, .. } if item == id),
    )
}

/// #1968: the film block's `diffs`, each text diff at the session's time: its progress, and each
/// token of either code item once (`<item>#tok:k`), a kept one naming both, with its box in the
/// document and its opacity in the diff.
pub(crate) fn diff_report(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
) -> Map<String, Value> {
    use deep_canvas_marks::diff::{self, Side};
    let mut out = Map::new();
    let Some(program) = crate::film::program_of(sched, session) else {
        return out;
    };
    let drawing = session
        .value(sched, "marks2d.frame", None)
        .and_then(|v| v.as_typed::<Drawing>());
    let t = session.t();
    for (b, d) in program
        .betweens
        .iter()
        .filter_map(|b| Some((b, b.diff.as_ref()?)))
    {
        let p = b.progress(t);
        let pieces = drawing
            .as_deref()
            .and_then(|drawing| {
                let a = Side::of(text_mark(&drawing.frame, &b.from)?, &d.old)?;
                let z = Side::of(text_mark(&drawing.frame, &b.to)?, &d.new)?;
                Some(diff::pieces(
                    &a,
                    &z,
                    &d.matching,
                    &diff::moved(&a, &z, &d.matching, p),
                ))
            })
            .unwrap_or_default();
        let name = |item: &str, k: Option<usize>| k.map(|k| format!("{item}#tok:{k}"));
        let tokens: Vec<Value> = pieces
            .iter()
            .map(|q| {
                json!({"from": name(&b.from, q.from), "to": name(&b.to, q.to), "box": q.bbox, "opacity": q.opacity})
            })
            .collect();
        out.insert(b.id.clone(), json!({"progress": p, "tokens": tokens}));
    }
    out
}

/// Each vector at t, drawn as its lowering draws it (#1162; Vector and formula `vector@1`): the whole
/// outline marks2d draws for it gives way to each of its paths, so a glyph's counters stay open
/// (#220), and while it writes on, to each path as the lowering writes it at the item's evaluated
/// progress (outline first, then fill); from the SVG the evidence store's holder inlined, in the
/// look's roles. `None` when the frame draws no vector.
fn written_vectors(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
    doc: &Value,
    frame: &deep_canvas_marks::scene::Frame,
) -> Option<deep_canvas_marks::scene::Frame> {
    use deep_canvas::schedule::core_ops::Fields;
    use deep_canvas_marks::path::Verb;
    use deep_canvas_marks::scene::{Drawn, Fill, Line, Mark, Rgb};
    use deep_canvas_vector::{lower, svg};
    type Written = (Vec<Verb>, Option<(Rgb, f64)>, Option<(Rgb, f64, f64)>);
    let rgb = |role: Option<&str>| -> Option<Rgb> {
        let c = session.look().get(role?)?.as_array()?;
        let channel = |i: usize| c.get(i)?.as_u64().and_then(|v| u8::try_from(v).ok());
        Some([channel(0)?, channel(1)?, channel(2)?])
    };
    let mut swap: BTreeMap<&str, Vec<Written>> = BTreeMap::new();
    let mut mix = [0u8; 8];
    for (id, item) in doc["items"].as_object()? {
        if item["kind"].as_str() != Some("vector@1") {
            continue;
        }
        // With motion's edits folded in, as marks2d reads them.
        let Some(fields) = session
            .read(sched, "core.fields", Some(id))
            .and_then(|(v, _)| v.as_typed::<Fields>())
            .map(|f| f.to_json())
        else {
            continue;
        };
        let params = &fields["params"];
        let progress = params
            .pointer("/write_on/progress")
            .and_then(Value::as_f64)
            .unwrap_or(1.0);
        let (Some(src), Some(map)) = (
            params.pointer("/outline/svg").and_then(Value::as_str),
            params.as_object(),
        ) else {
            continue;
        };
        let classes: Vec<String> = params["parts"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        let (Ok(svg), Ok(colors)) = (
            svg::import(src.as_bytes(), &classes, svg::Twin::Honest),
            lower::colors(id, map),
        ) else {
            continue;
        };
        // In the item's own units: marks2d placed its outline at the mark's offset.
        let mut local = fields.clone();
        if let Some(m) = local.as_object_mut() {
            m.remove("at");
        }
        let mut paths = Vec::new();
        for (_, part) in lower::lower(id, &local, &svg, &colors, lower::Write::Honest) {
            let p = &part["params"];
            let Some(verbs) = p["d"].as_str().and_then(deep_canvas_marks::path::parse) else {
                continue;
            };
            let paint = |k: &str| -> Option<(Rgb, f64)> {
                let f = p.pointer(&format!("/paint/{k}"))?;
                Some((
                    rgb(f["role"].as_str())?,
                    f["opacity"].as_f64().unwrap_or(1.0),
                ))
            };
            let width = p.pointer("/paint/stroke/width").and_then(Value::as_f64);
            let stroke = paint("stroke").map(|(c, o)| (c, o, width.unwrap_or(1.0)));
            paths.push((verbs, paint("fill"), stroke));
        }
        for (m, b) in mix.iter_mut().zip(progress.to_bits().to_le_bytes()) {
            *m ^= b;
        }
        swap.insert(id.as_str(), paths);
    }
    if swap.is_empty() {
        return None;
    }
    let shift = |v: &Verb, [dx, dy]: [f64; 2]| {
        let s = |p: [f64; 2]| [p[0] + dx, p[1] + dy];
        match *v {
            Verb::Move(p) => Verb::Move(s(p)),
            Verb::Line(p) => Verb::Line(s(p)),
            Verb::Quad(a, b) => Verb::Quad(s(a), s(b)),
            Verb::Cubic(a, b, c) => Verb::Cubic(s(a), s(b), s(c)),
            Verb::Close => Verb::Close,
        }
    };
    let mut frame = frame.clone();
    for layer in &mut frame.layers {
        fn swapped<'m, 's>(
            m: &'m Drawn,
            swap: &'s BTreeMap<&str, Vec<Written>>,
        ) -> Option<(&'m String, [f64; 2], &'s Vec<Written>)> {
            match &m.mark {
                Mark::Path { item, offset, .. } => {
                    swap.get(item.as_str()).map(|p| (item, *offset, p))
                }
                _ => None,
            }
        }
        if !layer.marks.iter().any(|m| swapped(m, &swap).is_some()) {
            continue;
        }
        layer.marks = layer
            .marks
            .iter()
            .flat_map(|m| match swapped(m, &swap) {
                None => vec![m.clone()],
                // The whole outline unpainted first, so the item keeps its box in the view
                // while its write hasn't reached it all.
                Some((item, offset, paths)) => std::iter::once(match &m.mark {
                    Mark::Path { geometry, .. } => (geometry.verbs.clone(), None, None),
                    _ => (Vec::new(), None, None),
                })
                .chain(paths.iter().cloned())
                .map(|(verbs, fill, stroke)| {
                    Arc::new(Drawn {
                        mark: Mark::Shape {
                            item: item.clone(),
                            verbs: verbs.iter().map(|v| shift(v, offset)).collect(),
                            fill: fill.map(|(c, o)| (Fill::Solid(c), o)),
                            stroke: stroke.map(|(c, o, w)| Line {
                                width: w,
                                paint: Fill::Solid(c),
                                opacity: o,
                                dashes: None,
                                profile: None,
                            }),
                        },
                        clip: m.clip,
                        scopes: m.scopes.clone(),
                    })
                })
                .collect(),
            })
            .collect();
        for (k, b) in layer.key.0.iter_mut().zip(mix) {
            *k ^= b;
        }
    }
    Some(frame)
}

/// What the frame's operators left in a session to draw; `None` before it has a document.
pub(crate) fn drawing_of(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &DocSession,
) -> Option<Painted> {
    let doc = session.document()?;
    let mut drawing = session
        .value(sched, "marks2d.frame", None)
        .and_then(|v| v.as_typed::<Drawing>());
    // #402: each cell grid's rows, drawn through the one shaper over the frame's marks.
    let grids = cell_grids(sched, session, doc);
    if let (Some(d), false) = (&mut drawing, grids.is_empty()) {
        let mut frame = d.frame.clone();
        frame.layers.push(deep_canvas_marks::scene::Layer {
            id: "cells".into(),
            marks: grids.into_iter().map(Arc::new).collect(),
            key: deep_canvas_marks::key::ContentKey([0; 16]),
        });
        *d = Arc::new(Drawing {
            frame,
            runs: d.runs.clone(),
            animated: d.animated.clone(),
            built: d.built,
            damage: Vec::new(),
            basis: None,
        });
    }
    if let Some(d) = &mut drawing {
        if let Some(frame) = morphed_vectors(sched, session, doc, &d.frame) {
            *d = Arc::new(Drawing {
                frame,
                runs: d.runs.clone(),
                animated: d.animated.clone(),
                built: d.built,
                damage: Vec::new(),
                basis: None,
            });
        }
        if let Some(frame) = written_vectors(sched, session, doc, &d.frame) {
            *d = Arc::new(Drawing {
                frame,
                runs: d.runs.clone(),
                animated: d.animated.clone(),
                built: d.built,
                damage: Vec::new(),
                basis: None,
            });
        }
        if let Some((frame, units)) = diffed_code(sched, session, &d.frame) {
            let mut runs = d.runs.clone();
            runs.extend(units);
            *d = Arc::new(Drawing {
                frame,
                runs,
                animated: d.animated.clone(),
                built: d.built,
                damage: Vec::new(),
                basis: None,
            });
        }
    }
    let status = session
        .value(sched, "text.status", None)
        .and_then(|v| v.as_typed::<StatusDrawing>());
    let side = |k: usize| doc["size"][k].as_f64().unwrap_or(1.0);
    let boxes = match drawing {
        Some(_) => Vec::new(),
        None => core_boxes(sched, session, doc),
    };
    Some(Painted {
        drawing,
        boxes,
        status,
        size: [side(0), side(1)],
    })
}

/// A value's Debug text, as a diagnostic shows it; never a digest's input. A test build with
/// `test-debug-alt` prints every value another way, as another compiler might (#855).
pub(crate) fn debug_text(value: &dyn std::fmt::Debug) -> String {
    if cfg!(feature = "test-debug-alt") {
        format!("{value:#?} (alt)")
    } else {
        format!("{value:?}")
    }
}

/// The SHA-256 of the Debug text of the typed values a node wrote, in the order it wrote them;
/// `null` when it wrote none. A diagnostic only: no key or digest reads it.
fn debug_digest(values: &[Val]) -> Value {
    let texts: Vec<String> = values
        .iter()
        .filter_map(Val::debug)
        .map(debug_text)
        .collect();
    if texts.is_empty() {
        return Value::Null;
    }
    json!(deep_canvas::schedule::sha256_hex(texts.concat().as_bytes()))
}

/// How many solves of each arrangement the session's last frame ran (#1732): the document's
/// check-phase solve when the frame took a new revision, and a frame-phase solve that wrote a
/// result.
/// #535: for each mark set that reads a logic array, the rows its data module mapped again for
/// each step the frame applied, `[{set, step, rows}]`: a set's rows remapped for a step are its
/// columns' most.
fn remaps(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &deep_canvas::schedule::Session,
) -> Value {
    type Mapped = BTreeMap<String, deep_canvas::columns::Mapped>;
    let mut out = Vec::new();
    for n in session.nodes(sched) {
        let (Some(set), true) = (
            &n.item,
            n.operator == "data.columns" && n.run == deep_canvas::schedule::Run::Ran,
        ) else {
            continue;
        };
        let Some(columns) = n.values.iter().find_map(|v| v.as_typed::<Mapped>()) else {
            continue;
        };
        let mut steps: BTreeMap<i64, usize> = BTreeMap::new();
        for (step, rows) in columns.values().flat_map(|m| &m.remaps) {
            let e = steps.entry(*step).or_default();
            *e = (*e).max(*rows);
        }
        out.extend(
            steps
                .into_iter()
                .map(|(step, rows)| json!({"set": set, "step": step, "rows": rows})),
        );
    }
    Value::Array(out)
}

fn solves(
    sched: &deep_canvas::schedule::Scheduler<'_>,
    session: &deep_canvas::schedule::Session,
    revised: bool,
) -> Value {
    let mut out = Map::new();
    let items = session
        .document()
        .and_then(|d| d.get("items"))
        .and_then(Value::as_object);
    for (id, _) in items
        .into_iter()
        .flatten()
        .filter(|(_, i)| deep_canvas_motion::arrange::is_arrangement(i))
    {
        out.insert(id.clone(), json!(0));
    }
    for n in session.nodes(sched) {
        if n.run != deep_canvas::schedule::Run::Ran {
            continue;
        }
        // The check-phase solve covers every arrangement of the document at once.
        let ids: Vec<String> = match (n.operator.as_str(), &n.item) {
            ("motion.arrange", None) if revised => out.keys().cloned().collect(),
            ("motion.arrangelive", Some(id))
                if n.values
                    .iter()
                    .any(|v| !matches!(v, deep_canvas::schedule::Val::None)) =>
            {
                vec![id.clone()]
            }
            _ => Vec::new(),
        };
        for id in ids {
            if let Some(c) = out.get_mut(&id) {
                *c = json!(c.as_u64().unwrap_or(0) + 1);
            }
        }
    }
    Value::Object(out)
}

#[cfg(test)]
mod story_tests {
    use deep_canvas::registry::{BuildSet, Registry};
    use deep_canvas::schedule::{default_view, Options, Scheduler, Session};
    use deep_canvas_marks::modules::{tokens, Drawing};
    use deep_canvas_marks::scene::Mark;
    use serde_json::{json, Value};

    const SECOND: i64 = 705_600_000;

    fn numbers(v: &[i32]) -> Value {
        let bytes: Vec<u8> = v.iter().flat_map(|x| x.to_le_bytes()).collect();
        json!({"dtype": "i32", "len": v.len(), "data": deep_canvas::base64::encode(&bytes)})
    }

    fn text(source: Value, order: &str) -> Value {
        json!({"id": order, "kind": "text@1", "name": order, "order": order, "layer": "a",
               "params": {"text": {"counter": {"source": source, "tabular": true,
                                               "format": {"group": "none"}}},
                          "size": 13, "box": {"w": 80, "h": 20}, "widest": "888888"}})
    }

    /// A race and a revealed line whose readers aren't touched as `at` and `to` move: labels
    /// through `rows_of`, counters on both anchors and on a driver, and a dot on the head.
    fn story() -> Value {
        let key = |at: &str, v: i32, after: i32| {
            json!({"target": at, "type": "f32", "keys": {
                "k0": {"t": "0s", "value": v, "interp": "linear"},
                "k1": {"t": "2s", "value": after, "interp": "linear"}}})
        };
        json!({
            "format": 1, "profile": "board", "title": "Story", "description": "d",
            "size": [320, 200], "transport": {"span": "2s"},
            "layers": {"a": {"writer": "agent:t", "title": "A", "order": "a1"}},
            "data": {"goal": {"value": 100, "source": "story"}, "share": {"value": 0, "source": "story"},
                     "shown": {"value": 0, "source": "story"}},
            "items": {
                "bars": {"id": "bars", "kind": "marks@1", "name": "Bars", "order": "a0", "layer": "a",
                         "params": {"mark": "point", "n": 2, "key": "key",
                                    "columns": {"year": numbers(&[2000, 2002]),
                                                "key": {"dtype": "str", "len": 2, "data": ["a", "a"]},
                                                "value": numbers(&[10, 30])},
                                    "transforms": [{"periods": {"by": "year", "at": 2000}}],
                                    "encode": {"x": {"column": "value"}, "y": 10}}},
                "labels": {"id": "labels", "kind": "marks@1", "name": "Labels", "order": "a1",
                           "layer": "a",
                           "params": {"mark": "text", "rows_of": "bars",
                                      "encode": {"x": 10, "y": 40, "text": {"column": "value"}}}},
                "line": {"id": "line", "kind": "marks@1", "name": "Line", "order": "a2", "layer": "a",
                         "params": {"mark": "path", "n": 2, "key": "year",
                                    "columns": {"year": numbers(&[0, 2]), "value": numbers(&[100, 140])},
                                    "transforms": [{"reveal": {"by": "year", "to": 0}}],
                                    "encode": {"x": {"column": "value"}, "y": 50}}},
                "dot": {"id": "dot", "kind": "circle@1", "name": "Dot", "order": "a3", "layer": "a",
                        "params": {"center": [0, 0], "r": 2, "paint": {"fill": {"role": "ink"}}},
                        "at": {"pos": [0, 0, 0], "anchor": "line#head"}},
                "p": text(json!("items/bars#period/by"), "p"),
                "q": text(json!("items/line#head/value"), "q"),
                "r": text(json!("climb"), "r")
            },
            "channels": {
                "at": key("items/bars/params/transforms/0/periods/at", 2000, 2002),
                "to": key("items/line/params/transforms/0/reveal/to", 0, 2),
                "share": key("data/share", 0, 1)
            },
            "drivers": {"climb": {"target": "data/shown", "expr": "goal * share",
                                  "vars": {"goal": "data/goal", "share": "data/share"}}}
        })
    }

    /// In a live session, what each reader of the rows shows at `t`, frame after frame: the
    /// operators of these items see no change of their own, so a stale value would stay.
    #[test]
    fn a_session_shows_what_the_rows_hold_at_t_in_every_reader() {
        let mut registry = Registry::new(BuildSet::R2);
        for m in crate::modules(BuildSet::R2) {
            registry = registry.with(m);
        }
        let sealed = registry.seal().expect("seals");
        let look = tokens(&crate::hub::shipped_look().light);
        let mut s = Scheduler::new(&sealed, Options::default());
        let doc = story();
        let mut live = Session::new(0, look);
        live.load(&mut s, &doc);
        for (t, labels, year, head, count, dot) in [
            (0, "10", "2000", "100", "0", 100.0),
            (SECOND / 2, "15", "2000", "110", "25", 110.0),
            (SECOND, "20", "2000", "120", "50", 120.0),
            (2 * SECOND, "30", "2002", "140", "100", 140.0),
        ] {
            live.frame(&mut s, t, &default_view(&doc));
            let refused: Vec<_> = live
                .report
                .issues
                .iter()
                .map(|i| (i.code, &i.path))
                .collect();
            assert!(refused.is_empty(), "at {t}: {refused:?}");
            let drawing = live
                .value(&s, "marks2d.frame", None)
                .and_then(|v| v.as_typed::<Drawing>())
                .expect("a drawing");
            let shown = |item: &str| {
                let marks = drawing.frame.layers.iter().flat_map(|l| l.marks.iter());
                marks
                    .filter_map(|d| match &d.mark {
                        Mark::Text { item: i, spec, .. } if i == item => Some(spec.text.clone()),
                        _ => None,
                    })
                    .next()
                    .unwrap_or_else(|| panic!("{item} draws at {t}"))
            };
            let mut marks = drawing.frame.layers.iter().flat_map(|l| l.marks.iter());
            let at_dot = marks.find_map(|d| match &d.mark {
                Mark::Circle { item, center, .. } if item == "dot" => Some(center[0]),
                _ => None,
            });
            assert_eq!(shown("labels#a"), labels, "a label through rows_of at {t}");
            assert_eq!(shown("p"), year, "a counter on #period at {t}");
            assert_eq!(shown("q"), head, "a counter on #head at {t}");
            assert_eq!(shown("r"), count, "a counter on a driver at {t}");
            assert_eq!(at_dot, Some(dot), "an item on #head at {t}");
        }
    }
}
