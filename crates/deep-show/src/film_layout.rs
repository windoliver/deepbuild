//! Issue #408: the core's `film.layout` on a claim's deliverables (canvas primitives: Film
//! layout). Each deliverable's current revision is evaluated at every checked time (the end of
//! every cue, hold and shot and each moment, by default) and read as data, never as pixels: its
//! texts are every glyph run the frame draws through the one shaper and every item an array
//! contributing to the core's glyph-box array `core.glyphs` holds boxes for, whatever its kind;
//! its strokes are the draw list's flattened polylines and its fills their true outlines, each
//! at its place in the draw order. The geometry is the core's (`deep_canvas::film_layout`).

use std::collections::BTreeMap;

use deep_canvas::film_layout::{self as layout, Fill, Frame, Input, Limits, Stroke, Text};
use deep_canvas::schedule::core_ops::Transform;
use deep_canvas::schedule::Session as DocSession;
use deep_canvas_marks::path::{flatten, Polyline, Verb};
use deep_canvas_marks::scene::Mark;
use serde_json::{json, Value};
use vello_cpu::kurbo::{Affine, Point};

use crate::hub::{Hub, Planted};

/// The check kind.
pub const FILM_LAYOUT: &str = "film.layout";

/// The kinds a planted film.layout takes as its texts: a list of kinds, as the design says it
/// never may (#408's criterion 4 plants it).
const PLANTED_TEXT_KINDS: [&str; 4] = ["text@1", "vector@1", "mark.text", "counter"];

/// How finely curves flatten, in u.
const TOLERANCE: f64 = 0.25;

/// A rect no wider than this, in u, is a rule: a stroke along its length (an axis's line).
const RULE: f64 = 2.0;

/// The marker kinds whose end is a cue end (Film layout: `at: cues`).
const CUE_KINDS: [&str; 3] = ["cue", "hold", "shot"];

impl Hub<'_> {
    /// film.layout on each requirement of the claim that names it, on every deliverable:
    /// requirement ID → its issues, notices among them, and its own time in ms (from the
    /// evaluated arrays at its times to its issues; the scheduler's evaluation isn't in it).
    pub(crate) fn film_layout_runs(
        &mut self,
        c: &crate::hub::Claim,
    ) -> BTreeMap<String, (Vec<Value>, f64)> {
        let mut out = BTreeMap::new();
        for r in c
            .requirements
            .iter()
            .filter(|r| r.check["kind"] == FILM_LAYOUT)
        {
            let mut issues = Vec::new();
            let mut ms = 0.0;
            for doc in &c.deliverables {
                let (found, took) = self.film_layout(doc, &r.check);
                ms += took;
                for mut i in found {
                    i["doc"] = json!(doc);
                    issues.push(i);
                }
            }
            out.insert(r.id.clone(), (issues, ms));
        }
        out
    }

    /// film.layout on one document's current revision, for the check input `input`, and its own
    /// time in ms.
    pub(crate) fn film_layout(&mut self, doc: &str, input: &Value) -> (Vec<Value>, f64) {
        let Some(revision) = self.query_revision(doc, None) else {
            return (Vec::new(), 0.0);
        };
        let mut spent = std::time::Duration::ZERO;
        let drawn = revision.drawn;
        // One session played through the checked times, so what doesn't change between them
        // isn't evaluated again.
        let mut session = self.evaluated(&drawn, 0);
        let program = crate::film::program_of(&self.sched, &session);
        let times = times_of(program.as_deref(), input);
        let view_of = deep_canvas::schedule::default_view(&drawn);
        let mut frames = Vec::new();
        let mut first_pose: Option<[f64; 4]> = None;
        let mut outlines = Outlines::new();
        for t in times {
            session.frame(&mut self.sched, t, &view_of);
            let (view, pose) = match program.as_deref() {
                Some(p) => camera(p, &drawn, t),
                None => (Affine::IDENTITY, None),
            };
            let moved = match (first_pose, pose) {
                (None, Some(p)) => {
                    first_pose = Some(p);
                    false
                }
                (Some(a), Some(b)) => a != b,
                _ => false,
            };
            let started = std::time::Instant::now();
            let mut frame = self.layout_frame(&session, &drawn, t, view, &mut outlines);
            spent += started.elapsed();
            frame.camera_moved = moved;
            frames.push(frame);
        }
        let mut orders = BTreeMap::new();
        for (id, item) in drawn["items"].as_object().into_iter().flatten() {
            if let Some(o) = item["order"].as_str() {
                orders.insert(id.clone(), o.to_string());
            }
        }
        let backdrops = input["backdrops"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
        let checked = Input {
            limits: Limits::from_input(input),
            backdrops,
            safe: drawn["safe"].as_f64().unwrap_or(24.0),
            orders,
        };
        let started = std::time::Instant::now();
        let found = layout::check(&frames, &checked);
        spent += started.elapsed();
        let issues = found
            .into_iter()
            .map(|f| {
                let mut v = json!({
                    "check": FILM_LAYOUT, "code": f.code, "severity": f.severity, "ids": f.ids,
                    "t": f.t, "ts": f.ts, "what": f.what, "fix": f.fix,
                });
                for (k, x) in f.fields {
                    v[k] = x;
                }
                if !f.fix_ops.is_empty() {
                    v["fix_ops"] = Value::Array(f.fix_ops);
                }
                v
            })
            .collect();
        (issues, spent.as_secs_f64() * 1000.0)
    }

    /// The frame at `t` as film.layout reads it: texts, strokes and fills in the frame's units, in
    /// draw order.
    fn layout_frame(
        &mut self,
        session: &DocSession,
        drawn: &Value,
        t: i64,
        view: Affine,
        outlines: &mut Outlines,
    ) -> Frame {
        let size = [
            drawn["size"][0].as_f64().unwrap_or(1.0),
            drawn["size"][1].as_f64().unwrap_or(1.0),
        ];
        let mut frame = Frame {
            t,
            size,
            ..Frame::default()
        };
        let empty = serde_json::Map::new();
        let items = drawn["items"].as_object().unwrap_or(&empty);
        let morph = morphs(drawn);
        let planted = self.planted(Planted::LayoutTextByKind);
        let kind_of = |id: &str| -> String {
            let base = id.split('#').next().unwrap_or(id);
            items
                .get(base)
                .and_then(|i| i["kind"].as_str())
                .unwrap_or("")
                .to_string()
        };
        let text_of = |id: &str, boxes: Vec<[f64; 4]>, order: usize| -> Text {
            let base = id.split('#').next().unwrap_or(id).to_string();
            let item = items.get(&base);
            let at = Transform::of(item.and_then(|i| i.get("at")));
            Text {
                id: id.to_string(),
                item: base.clone(),
                boxes,
                order,
                halo: item
                    .and_then(|i| i.pointer("/params/halo"))
                    .and_then(Value::as_array)
                    .is_some_and(|h| !h.is_empty()),
                morph: morph.get(&base).cloned(),
                pos: at.pos,
                scale: at.scale,
                size: item.filter(|i| i["kind"] == "text@1").map(|i| {
                    i.pointer("/params/size")
                        .and_then(Value::as_f64)
                        .unwrap_or(13.0)
                }),
                box_wh: ["w", "h"].map(|k| {
                    item.filter(|i| i["kind"] == "text@1")
                        .and_then(|i| i.pointer(&format!("/params/box/{k}")))
                        .and_then(Value::as_f64)
                }),
            }
        };
        let place = |p: [f64; 2]| -> [f64; 2] {
            let q = view * Point::new(p[0], p[1]);
            [q.x, q.y]
        };
        let place_box = |b: [f64; 4]| -> [f64; 4] {
            let corners = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(place);
            let xs = corners.map(|c| c[0]);
            let ys = corners.map(|c| c[1]);
            [
                xs.iter().copied().fold(f64::INFINITY, f64::min),
                ys.iter().copied().fold(f64::INFINITY, f64::min),
                xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
                ys.iter().copied().fold(f64::NEG_INFINITY, f64::max),
            ]
        };
        let painted = crate::frames::drawing_of(&self.sched, session);
        let drawing = painted.as_ref().and_then(|p| p.drawing.clone());
        let mut shaper: Option<deep_text::Shaper> = None;
        let mut order = 0usize;
        let mut first_order: BTreeMap<String, usize> = BTreeMap::new();
        let marks = drawing
            .iter()
            .flat_map(|d| d.frame.layers.iter())
            .flat_map(|l| (&l.marks).into_iter().cloned().collect::<Vec<_>>());
        for drawn_mark in marks {
            order += 1;
            let mark = &drawn_mark.mark;
            first_order.entry(base_of(mark.item())).or_insert(order);
            match mark {
                Mark::Text {
                    item, spec, origin, ..
                } => {
                    if planted && !PLANTED_TEXT_KINDS.contains(&kind_of(item).as_str()) {
                        continue;
                    }
                    let run = drawing
                        .as_ref()
                        .and_then(|d| d.runs.get(item))
                        .filter(|r| r.spec == *spec)
                        .map(|r| r.shaped.clone());
                    let shaped = match run {
                        Some(r) => r,
                        None => {
                            let Some(s) = spec.shaper_spec() else {
                                continue;
                            };
                            shaper.get_or_insert_with(deep_text::Shaper::new).shape(&s)
                        }
                    };
                    let boxes: Vec<[f64; 4]> = glyph_boxes(&shaped, *origin, outlines)
                        .into_iter()
                        .map(&place_box)
                        .collect();
                    if !boxes.is_empty() {
                        frame.texts.push(text_of(item, boxes, order));
                    }
                }
                Mark::Rect { item, bounds, .. } => {
                    let [x, y, w, h] = *bounds;
                    let rect = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(place);
                    if w.min(h) <= RULE {
                        let line = if w <= h {
                            vec![place([x + w / 2.0, y]), place([x + w / 2.0, y + h])]
                        } else {
                            vec![place([x, y + h / 2.0]), place([x + w, y + h / 2.0])]
                        };
                        frame
                            .strokes
                            .push(stroke(item, &kind_of(item), order, vec![line], false));
                    }
                    frame.fills.push(Fill {
                        id: item.clone(),
                        item: base_of(item),
                        kind: kind_of(item),
                        order,
                        opacity: 1.0,
                        contours: vec![rect.to_vec()],
                    });
                }
                Mark::Circle {
                    item,
                    center,
                    r,
                    inner_r,
                    ..
                } => {
                    let mut contours = vec![circle(*center, *r).into_iter().map(place).collect()];
                    if *inner_r > 0.0 {
                        contours.push(circle(*center, *inner_r).into_iter().map(place).collect());
                    }
                    frame.fills.push(Fill {
                        id: item.clone(),
                        item: base_of(item),
                        kind: kind_of(item),
                        order,
                        opacity: 1.0,
                        contours,
                    });
                }
                Mark::Path {
                    item,
                    geometry,
                    offset,
                    ..
                } => {
                    let moved: Vec<Verb> =
                        geometry.verbs.iter().map(|v| shift(*v, *offset)).collect();
                    let lines = flatten(&moved, TOLERANCE);
                    let placed: Vec<Vec<[f64; 2]>> = lines
                        .iter()
                        .map(|l| l.points.iter().copied().map(place).collect())
                        .collect();
                    if geometry.stroke.is_some() {
                        let open = lines.iter().any(|l| !l.closed);
                        let traced = traced(&lines, &placed);
                        frame
                            .strokes
                            .push(stroke(item, &kind_of(item), order, traced, open));
                    }
                    if geometry.fill {
                        frame.fills.push(Fill {
                            id: item.clone(),
                            item: base_of(item),
                            kind: kind_of(item),
                            order,
                            opacity: 1.0,
                            contours: placed,
                        });
                    }
                }
                Mark::Shape {
                    item,
                    verbs,
                    fill,
                    stroke: line,
                } => {
                    let lines = flatten(verbs, TOLERANCE);
                    let placed: Vec<Vec<[f64; 2]>> = lines
                        .iter()
                        .map(|l| l.points.iter().copied().map(place).collect())
                        .collect();
                    if line
                        .as_ref()
                        .is_some_and(|l| l.opacity > 0.0 && l.width > 0.0)
                    {
                        let open = lines.iter().any(|l| !l.closed);
                        let traced = traced(&lines, &placed);
                        frame
                            .strokes
                            .push(stroke(item, &kind_of(item), order, traced, open));
                    }
                    if let Some((_, opacity)) = fill {
                        frame.fills.push(Fill {
                            id: item.clone(),
                            item: base_of(item),
                            kind: kind_of(item),
                            order,
                            opacity: *opacity,
                            contours: placed,
                        });
                    }
                }
                Mark::Image {
                    item,
                    bounds,
                    opacity,
                    ..
                } => {
                    let [x, y, w, h] = *bounds;
                    let rect = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(place);
                    frame.fills.push(Fill {
                        id: item.clone(),
                        item: base_of(item),
                        kind: kind_of(item),
                        order,
                        opacity: *opacity,
                        contours: vec![rect.to_vec()],
                    });
                }
            }
        }
        // Every item an array contributing to the core's glyph-box array holds boxes for, whatever
        // module made it; never a list of kinds. Each box is `[x, y, w, h]` in the item's own
        // space, placed by its evaluated `at` as the frame draws it.
        {
            let contributions = self
                .startup
                .sealed
                .contributions
                .get("core.glyphs")
                .cloned()
                .unwrap_or_default();
            // Each contributing array read once for every item it holds (#854: never a lookup
            // per item), in the order the seal folds them.
            let mut own: BTreeMap<String, Vec<[f64; 4]>> = BTreeMap::new();
            for c in &contributions {
                for (id, v) in session.values(&self.sched, c) {
                    let (Some(id), Some(b)) = (id, v.as_typed::<Vec<[f64; 4]>>()) else {
                        continue;
                    };
                    own.entry(id.to_string())
                        .or_default()
                        .extend(b.iter().copied());
                }
            }
            for (id, own) in &own {
                let Some(item) = items.get(id) else { continue };
                if frame.texts.iter().any(|x| x.item == *id) {
                    continue;
                }
                // The planted program takes its text by a list of kinds instead.
                if planted && !PLANTED_TEXT_KINDS.contains(&item["kind"].as_str().unwrap_or("")) {
                    continue;
                }
                let world = session
                    .read(&self.sched, "core.world", Some(id))
                    .and_then(|(w, _)| w.as_typed::<Transform>())
                    .map(|w| *w)
                    .unwrap_or_else(|| Transform::of(item.get("at")));
                let mut at = json!({"pos": world.pos, "scale": world.scale});
                if let Some(p) = item.pointer("/at/pivot") {
                    at["pivot"] = p.clone();
                }
                let local = deep_canvas_marks::relations::own_box(
                    item["kind"].as_str().unwrap_or(""),
                    deep_canvas_marks::scene::object_or_empty(item.get("params")),
                );
                let place = deep_canvas_marks::relations::place_of(&json!({"at": at}), local);
                let boxes: Vec<[f64; 4]> = own
                    .iter()
                    .map(|b| {
                        let [x, y, w, h] = deep_canvas_marks::relations::placed(*b, place);
                        place_box([x, y, x + w, y + h])
                    })
                    .collect();
                if !boxes.is_empty() {
                    let at = first_order.get(id).copied().unwrap_or(order + 1);
                    frame.texts.push(text_of(id, boxes, at));
                }
            }
        }
        frame
    }
}

/// The checked times: the input's `at` (`cues`, `moments` or a list of times), in flicks, sorted
/// and once each. With no cue or moment in the film, its start.
fn times_of(program: Option<&deep_canvas_motion::program::Program>, input: &Value) -> Vec<i64> {
    let mut out: Vec<i64> = Vec::new();
    match &input["at"] {
        Value::Array(list) => {
            out.extend(list.iter().filter_map(|t| {
                t.as_str()
                    .and_then(crate::hub::flicks)
                    .or_else(|| t.as_i64())
            }));
        }
        at => {
            let moments_only = at.as_str() == Some("moments");
            if let Some(p) = program {
                for m in &p.motion.markers {
                    if m.kind == "moment" {
                        out.push(m.start);
                    } else if !moments_only && CUE_KINDS.contains(&m.kind.as_str()) {
                        out.push(m.end);
                    }
                }
                if !moments_only {
                    if let Some(plan) = p.shots.as_deref() {
                        out.extend(plan.shots.iter().map(|s| s.end));
                    }
                }
            }
        }
    }
    out.sort_unstable();
    out.dedup();
    if out.is_empty() {
        out.push(0);
    }
    out
}

/// The document camera's view at t, from document units to the frame's, and its pose as
/// `[target x, target y, view width, roll]`; the identity without a 2D film camera.
fn camera(
    p: &deep_canvas_motion::program::Program,
    drawn: &Value,
    t: i64,
) -> (Affine, Option<[f64; 4]>) {
    let size = [
        drawn["size"][0].as_f64().unwrap_or(1.0),
        drawn["size"][1].as_f64().unwrap_or(1.0),
    ];
    match crate::film::sides(p, drawn, t, false) {
        Some(sides) => {
            let pose = &sides.sides[0].pose;
            (
                crate::film::view(pose, size),
                Some([pose.target[0], pose.target[1], pose.view_width, pose.roll]),
            )
        }
        None => (Affine::IDENTITY, None),
    }
}

/// Each match morph between two items: both items, keyed by the morph.
fn morphs(drawn: &Value) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for (id, tr) in drawn["transitions"].as_object().into_iter().flatten() {
        if tr["kind"] != "match_morph" {
            continue;
        }
        for end in ["from", "to"] {
            if let Some(item) = tr[end].as_str() {
                out.insert(item.to_string(), id.clone());
            }
        }
    }
    out
}

/// A mark's item ID without its part.
fn base_of(id: &str) -> String {
    id.split('#').next().unwrap_or(id).to_string()
}

fn stroke(item: &str, kind: &str, order: usize, lines: Vec<Vec<[f64; 2]>>, open: bool) -> Stroke {
    Stroke {
        id: item.to_string(),
        item: base_of(item),
        kind: kind.to_string(),
        order,
        lines,
        grid: item.contains("#grid"),
        open,
    }
}

/// Flattened lines as a stroke traces them: a closed one back to its start.
fn traced(lines: &[Polyline], placed: &[Vec<[f64; 2]>]) -> Vec<Vec<[f64; 2]>> {
    lines
        .iter()
        .zip(placed)
        .map(|(l, p)| {
            let mut p = p.clone();
            if let (true, Some(&first)) = (l.closed, p.first()) {
                p.push(first);
            }
            p
        })
        .collect()
}

fn shift(v: Verb, o: [f64; 2]) -> Verb {
    let m = |p: [f64; 2]| [p[0] + o[0], p[1] + o[1]];
    match v {
        Verb::Move(p) => Verb::Move(m(p)),
        Verb::Line(p) => Verb::Line(m(p)),
        Verb::Quad(a, p) => Verb::Quad(m(a), m(p)),
        Verb::Cubic(a, b, p) => Verb::Cubic(m(a), m(b), m(p)),
        Verb::Close => Verb::Close,
    }
}

/// A circle as a 64-gon, through the core's pinned math.
fn circle(c: [f64; 2], r: f64) -> Vec<[f64; 2]> {
    (0..64)
        .map(|k| {
            let a = deep_canvas::ops::rad(f64::from(k) * 360.0 / 64.0);
            [
                c[0] + r * deep_canvas::ops::cos(a),
                c[1] + r * deep_canvas::ops::sin(a),
            ]
        })
        .collect()
}

/// Each glyph's outline box in its own frame, by face, glyph and size: read once per check.
type Outlines = BTreeMap<(u64, u32, u32, u32), Option<[f64; 4]>>;

/// A shaped run's glyph boxes at `origin`, from each glyph's outline: `[x0, y0, x1, y1]`.
fn glyph_boxes(
    shaped: &deep_text::Shaped,
    origin: [f64; 2],
    outlines: &mut Outlines,
) -> Vec<[f64; 4]> {
    use deep_text::outlines::Cmd;
    let mut out = Vec::new();
    for g in &shaped.glyphs {
        let key = (g.font.data.id(), g.font.index, g.id, g.size.to_bits());
        let own = *outlines.entry(key).or_insert_with(|| {
            let cmds = deep_text::outlines::outline_of(g)?;
            let mut b = [
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ];
            let mut grow = |p: [f64; 2]| {
                b = [
                    b[0].min(p[0]),
                    b[1].min(p[1]),
                    b[2].max(p[0]),
                    b[3].max(p[1]),
                ];
            };
            for c in cmds {
                match c {
                    Cmd::Move(p) | Cmd::Line(p) => grow(p),
                    Cmd::Quad(a, p) => {
                        grow(a);
                        grow(p);
                    }
                    Cmd::Cubic(a, q, p) => {
                        grow(a);
                        grow(q);
                        grow(p);
                    }
                    Cmd::Close => {}
                }
            }
            b[0].is_finite().then_some(b)
        });
        if let Some(b) = own {
            let at = [origin[0] + f64::from(g.x), origin[1] + f64::from(g.y)];
            out.push([b[0] + at[0], b[1] + at[1], b[2] + at[0], b[3] + at[1]]);
        }
    }
    out
}
