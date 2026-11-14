//! Issue #399: `graph@1` and `label@1` where this crate draws a document. Each graph is laid out
//! from its nodes' measured sizes (a node that names an item takes that item's box, as the auto
//! layout measures it), its node labels are placed, then its edges are routed around its nodes,
//! its groups' titles and those labels; it then draws as marks2d's items: a box per node that
//! names no item, the named item moved to its node's place, a titled frame per group and a path per
//! route. Labels place last, against every mark the frame draws, by the graph module's placement.

use std::cell::RefCell;
use std::collections::BTreeMap;

use deep_canvas_graph::labels::{self, Anchor, Avoid, Fold, Label, Placement, Spot, NODE_ANCHORS};
use deep_canvas_graph::route::{Obstacle, Point};
use deep_canvas_graph::view::{self, Drawn, Router};
use deep_canvas_marks::path::Verb;
use deep_canvas_marks::scene::{Frame, Mark};
use serde_json::{json, Map, Value};

/// Each graph item's view, by item ID.
pub(crate) type Graphs = BTreeMap<String, Drawn>;

/// What a route keeps clear of a node, a node label or a title by default (Route: clearance).
const CLEARANCE: f64 = 8.0;

thread_local! {
    static SHAPER: RefCell<deep_text::Shaper> = RefCell::new(deep_text::Shaper::new());
}

fn refused(code: &str, path: &str) -> Value {
    json!({"ok": false, "code": code, "path": path})
}

/// A graph's or a label's refusal code, as the document check raises it.
pub(crate) fn code(refusal: &Value) -> &'static str {
    const CODES: [&str; 7] = [
        "ref_unresolved",
        "layout.cycle",
        "layout.seed_required",
        "layout.algo_unsupported",
        "graph.bad_edge",
        "graph.duplicate_id",
        "layout.relayout_needed",
    ];
    let code = refusal["code"].as_str().unwrap_or("");
    CODES.into_iter().find(|c| *c == code).unwrap_or("bad_doc")
}

fn kind(item: &Value) -> &str {
    item.get("kind").and_then(Value::as_str).unwrap_or("")
}

/// One label item as placement reads it, its target still a name.
struct Read {
    id: String,
    target: String,
    text: String,
    label: Label,
}

fn read_label(id: &str, item: &Value) -> Result<Read, Value> {
    let path = format!("items/{id}/params");
    let p = &item["params"];
    let text = p["text"]
        .as_str()
        .ok_or_else(|| refused("bad_doc", &format!("{path}/text")))?;
    let target = p["target"]
        .as_str()
        .filter(|t| t.contains('#'))
        .ok_or_else(|| refused("bad_doc", &format!("{path}/target")))?;
    let [w, h] = match p.get("size").and_then(Value::as_array).map(Vec::as_slice) {
        Some([w, h]) => match (w.as_f64(), h.as_f64()) {
            (Some(w), Some(h)) if w > 0.0 && h > 0.0 => [w, h],
            _ => return Err(refused("bad_doc", &format!("{path}/size"))),
        },
        _ => {
            // Sized by its text: a 12 px label face's advance per character.
            [text.chars().count() as f64 * 7.0, 14.0]
        }
    };
    let anchors = match p.get("anchors") {
        None => NODE_ANCHORS.to_vec(),
        Some(Value::Array(list)) => list
            .iter()
            .map(|a| a.as_str().and_then(Anchor::read))
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| refused("bad_doc", &format!("{path}/anchors")))?,
        Some(_) => return Err(refused("bad_doc", &format!("{path}/anchors"))),
    };
    let fold = match p.get("fold").and_then(Value::as_str) {
        None => Fold::Dot,
        Some(f) => Fold::read(f).ok_or_else(|| refused("bad_doc", &format!("{path}/fold")))?,
    };
    let number = |k: &str, d: f64| p.get(k).and_then(Value::as_f64).unwrap_or(d);
    let zoom = match p.get("zoom").and_then(Value::as_array).map(Vec::as_slice) {
        Some([lo, hi]) => [
            lo.as_f64().unwrap_or(0.0),
            hi.as_f64().unwrap_or(f64::INFINITY),
        ],
        _ => [0.0, f64::INFINITY],
    };
    Ok(Read {
        id: id.to_string(),
        target: target.to_string(),
        text: text.to_string(),
        label: Label {
            id: id.to_string(),
            target: [0.0; 4],
            w,
            h,
            priority: p.get("priority").and_then(Value::as_i64).map_or(0, |v| {
                v.clamp(i64::from(i16::MIN), i64::from(i16::MAX)) as i16
            }),
            needs_you: p.get("needs_you") == Some(&Value::Bool(true)),
            anchors,
            offset: number("offset", 4.0),
            padding: number("padding", 2.0),
            fold,
            zoom,
        },
    })
}

/// The labels of `items`, in ID order.
fn labels_of(items: &Map<String, Value>) -> Result<Vec<Read>, Value> {
    items
        .iter()
        .filter(|(_, i)| kind(i) == "label@1")
        .map(|(id, i)| read_label(id, i))
        .collect()
}

/// The size each node's named item draws at, as auto layout measures a frame, else its own box.
fn sizes(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    vectors: &crate::Vectors,
) -> BTreeMap<String, [f64; 2]> {
    let input = json!({"items": items, "bound_values": doc.get("bound_values")});
    let solved = SHAPER
        .with(|s| deep_canvas_marks::layout::solve(&input, &mut s.borrow_mut()))
        .unwrap_or_default();
    let mut out = BTreeMap::new();
    for g in items.values().filter(|i| kind(i) == "graph@1") {
        let nodes = g["params"]["graph"]["nodes"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        for n in nodes {
            let Some(named) = n.get("item").and_then(Value::as_str) else {
                continue;
            };
            let b = solved
                .get(named)
                .copied()
                .or_else(|| crate::place::box_of(doc, items, vectors, named));
            if let Some(b) = b {
                out.insert(named.to_string(), [b[2], b[3]]);
            }
        }
    }
    out
}

/// `items` with every graph laid out and drawn as marks2d's items, and each graph's view; labels
/// are left for [`place_labels`]. A graph's refusal is a drawing command's answer.
pub(crate) fn lower(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    vectors: &crate::Vectors,
    router: Router,
) -> Result<(Map<String, Value>, Graphs), Value> {
    let mut graphs = Graphs::new();
    if !items.values().any(|i| kind(i) == "graph@1") {
        return Ok((items.clone(), graphs));
    }
    let sizes = sizes(doc, items, vectors);
    let reads = labels_of(items)?;
    let frame = frame_box(doc);
    let mut out = items.clone();
    for (gid, g) in items.iter().filter(|(_, i)| kind(i) == "graph@1") {
        let path = format!("items/{gid}/params");
        let mut params = g["params"].clone();
        // A node that names an item takes that item's measured size.
        if let Some(Value::Array(nodes)) = params.pointer_mut("/graph/nodes") {
            for (k, n) in nodes.iter_mut().enumerate() {
                let Some(named) = n.get("item").and_then(Value::as_str).map(str::to_string) else {
                    continue;
                };
                let Some([w, h]) = sizes.get(&named) else {
                    return Err(refused(
                        "ref_unresolved",
                        &format!("{path}/graph/nodes/{k}/item"),
                    ));
                };
                n["w"] = json!(w);
                n["h"] = json!(h);
            }
        }
        let pos = g.get("at").and_then(|a| a.get("pos"));
        let origin = [
            pos.and_then(|p| p.get(0))
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
            pos.and_then(|p| p.get(1))
                .and_then(Value::as_f64)
                .unwrap_or(0.0),
        ];
        let (graph, mut drawn) = view::place(&params, origin).map_err(|r| {
            refused(
                if r.code == "bad_input" {
                    "bad_doc"
                } else {
                    r.code
                },
                &format!("{path}/{}", r.names),
            )
        })?;
        // Its node labels place first, against its nodes and titles, so routes keep clear of them.
        let mut mine: Vec<Label> = Vec::new();
        for r in reads
            .iter()
            .filter(|r| r.target.starts_with(&format!("{gid}#")))
        {
            let node = &r.target[gid.len() + 1..];
            let Some(&b) = drawn.nodes.get(node) else {
                return Err(refused(
                    "ref_unresolved",
                    &format!("items/{}/params/target", r.id),
                ));
            };
            mine.push(Label {
                target: b,
                ..r.label.clone()
            });
        }
        let avoid = Avoid {
            boxes: drawn
                .nodes
                .values()
                .copied()
                .chain(drawn.groups.values().map(|g| g.title))
                .collect(),
            status: Vec::new(),
        };
        let spots = labels::place(&mine, &avoid, &placement(frame), 0);
        let around: Vec<Obstacle> = mine
            .iter()
            .filter_map(|l| match spots.get(&l.id) {
                Some(Spot::At { x, y, .. }) => Some(Obstacle {
                    id: l.id.clone(),
                    rect: [frame[0] + x, frame[1] + y, l.w, l.h],
                }),
                _ => None,
            })
            .collect();
        let clearance = params
            .pointer("/route/clearance")
            .and_then(Value::as_f64)
            .unwrap_or(CLEARANCE);
        view::routes(&graph, &mut drawn, &around, clearance, router);
        draw(&mut out, gid, g, &graph, &drawn);
        graphs.insert(gid.clone(), drawn);
    }
    Ok((out, graphs))
}

/// Replaces the graph item `gid` with what it draws: a group holding its routes, its groups'
/// frames and titles, and a box per node that names no item; a named item moves to its node.
fn draw(
    out: &mut Map<String, Value>,
    gid: &str,
    g: &Value,
    graph: &deep_canvas_graph::Graph,
    drawn: &Drawn,
) {
    let mut base = Map::new();
    for k in ["layer", "order", "name", "visible"] {
        if let Some(v) = g.get(k) {
            base.insert(k.into(), v.clone());
        }
    }
    let mut group = base.clone();
    group.insert("id".into(), json!(gid));
    group.insert("kind".into(), json!("group@1"));
    group.insert("params".into(), json!({}));
    if let Some(p) = g.get("parent") {
        group.insert("parent".into(), p.clone());
    }
    out.insert(gid.to_string(), Value::Object(group));
    let layer = g.get("layer").cloned().unwrap_or(json!("main"));
    let child = |id: String, kind: &str, order: &str, params: Value, pos: [f64; 2]| {
        (
            id.clone(),
            json!({"id": id, "kind": kind, "name": kind, "layer": layer, "order": order,
                   "parent": gid, "at": {"pos": [pos[0], pos[1], 0]}, "params": params}),
        )
    };
    for (name, b) in &drawn.groups {
        let r = b.rect;
        let (id, item) = child(
            format!("{gid}.group.{name}"),
            "frame@1",
            "a0",
            json!({"box": [0, 0, r[2], r[3]], "radius": 6, "overflow": "show",
                   "paint": {"stroke": {"role": "divider", "width": 1}}}),
            [r[0], r[1]],
        );
        out.insert(id, item);
        let t = b.title;
        let (id, item) = child(
            format!("{gid}.group.{name}.title"),
            "text@1",
            "a3",
            json!({"text": name, "font": "body", "size": 12, "weight": 600,
                   "paint": {"fill": {"role": "muted"}}}),
            [t[0], t[1]],
        );
        out.insert(id, item);
    }
    for (edge, points) in &drawn.routes {
        if points.len() < 2 {
            continue;
        }
        let mut d = String::new();
        for (k, p) in points.iter().enumerate() {
            d.push_str(&format!(
                "{} {} {} ",
                if k == 0 { "M" } else { "L" },
                p.0,
                p.1
            ));
        }
        let (id, item) = child(
            format!("{gid}.edge.{edge}"),
            "path@1",
            "a1",
            json!({"d": d.trim_end(), "paint": {"stroke": {"role": "muted", "width": 1.5}}}),
            [0.0, 0.0],
        );
        out.insert(id, item);
        let (id, item) = child(
            format!("{gid}.edge.{edge}.end"),
            "path@1",
            "a1",
            json!({"d": arrow(points), "paint": {"fill": {"role": "muted"}}}),
            [0.0, 0.0],
        );
        out.insert(id, item);
    }
    for n in &graph.nodes {
        let Some(&b) = drawn.nodes.get(&n.id) else {
            continue;
        };
        let named = n.item.as_deref().and_then(|named| out.get_mut(named));
        if let Some(Value::Object(item)) = named {
            let at = item.entry("at").or_insert_with(|| json!({}));
            let z = at.pointer("/pos/2").and_then(Value::as_f64).unwrap_or(0.0);
            at["pos"] = json!([b[0], b[1], z]);
            continue;
        }
        let (id, item) = child(
            format!("{gid}.node.{}", n.id),
            "frame@1",
            "a2",
            json!({"box": [0, 0, b[2], b[3]], "radius": 4,
                   "paint": {"fill": {"role": "raised"}, "stroke": {"role": "divider", "width": 1}}}),
            [b[0], b[1]],
        );
        out.insert(id, item);
        let (id, item) = child(
            format!("{gid}.node.{}.name", n.id),
            "text@1",
            "a3",
            json!({"text": n.id, "font": "body", "size": 11, "paint": {"fill": {"role": "ink"}}}),
            [b[0] + 6.0, b[1] + (b[3] - 14.0) / 2.0],
        );
        out.insert(id, item);
    }
}

/// A small filled arrowhead at a route's end, along its last segment.
fn arrow(points: &[Point]) -> String {
    let (a, b) = (points[points.len() - 2], points[points.len() - 1]);
    let len = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt().max(1e-9);
    let (ux, uy) = ((b.0 - a.0) / len, (b.1 - a.1) / len);
    let (bx, by) = (b.0 - ux * 6.0, b.1 - uy * 6.0);
    let (px, py) = (-uy * 3.0, ux * 3.0);
    format!(
        "M {} {} L {} {} L {} {} Z",
        b.0,
        b.1,
        bx + px,
        by + py,
        bx - px,
        by - py
    )
}

fn frame_box(doc: &Map<String, Value>) -> [f64; 4] {
    let size = doc.get("size").and_then(Value::as_array);
    let at = |k: usize| {
        size.and_then(|s| s.get(k))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    [0.0, 0.0, at(0), at(1)]
}

fn placement(frame: [f64; 4]) -> Placement {
    Placement {
        cell: 2.0,
        base: 1.0,
        frame,
    }
}

/// The boxes every mark of a frame covers, in u: a path's per segment, so a label can sit beside
/// a route; and each mark's item name with its own box, for a label's target.
/// #1966: the box of a text's line or token, `<id>#line:n` or `<id>#tok:k`, where its run draws.
fn text_anchor(
    frame: &Frame,
    items: &Map<String, Value>,
    id: &str,
    part: &str,
) -> Option<[f64; 4]> {
    let (spec, origin) =
        frame
            .layers
            .iter()
            .flat_map(|l| &l.marks)
            .find_map(|d| match &d.mark {
                Mark::Text {
                    item, spec, origin, ..
                } if item == id => Some((spec, origin)),
                _ => None,
            })?;
    let shaped = deep_text_gpui::shape(&crate::status::label_of(spec)?);
    let params = items.get(id)?.get("params")?.as_object()?;
    let b = deep_canvas_marks::lines::anchor_box(params, &shaped, part)?;
    Some([origin[0] + b[0], origin[1] + b[1], b[2], b[3]])
}

fn mark_boxes(frame: &Frame) -> (Vec<[f64; 4]>, BTreeMap<String, [f64; 4]>) {
    let mut avoid = Vec::new();
    let mut named = BTreeMap::new();
    let segments = |verbs: &[Verb], by: [f64; 2], width: f64, avoid: &mut Vec<[f64; 4]>| {
        let mut at: Option<[f64; 2]> = None;
        let mut start: Option<[f64; 2]> = None;
        for v in verbs {
            let (next, ctrl): ([f64; 2], Vec<[f64; 2]>) = match *v {
                Verb::Move(p) => {
                    at = Some(p);
                    start = Some(p);
                    continue;
                }
                Verb::Line(p) => (p, vec![]),
                Verb::Quad(c, p) => (p, vec![c]),
                Verb::Cubic(c1, c2, p) => (p, vec![c1, c2]),
                Verb::Close => match start {
                    Some(s) => (s, vec![]),
                    None => continue,
                },
            };
            if let Some(a) = at {
                let pts: Vec<[f64; 2]> = std::iter::once(a).chain(ctrl).chain([next]).collect();
                let (x0, x1) = pts.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |m, p| {
                    (m.0.min(p[0]), m.1.max(p[0]))
                });
                let (y0, y1) = pts.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |m, p| {
                    (m.0.min(p[1]), m.1.max(p[1]))
                });
                let h = width / 2.0;
                avoid.push([
                    x0 + by[0] - h,
                    y0 + by[1] - h,
                    x1 - x0 + width,
                    y1 - y0 + width,
                ]);
            }
            at = Some(next);
        }
    };
    for drawn in frame.layers.iter().flat_map(|l| l.marks.iter()) {
        let mark = &drawn.mark;
        match mark {
            Mark::Rect { item, bounds, .. } => {
                avoid.push(*bounds);
                named.insert(item.clone(), *bounds);
            }
            Mark::Circle {
                item, center, r, ..
            } => {
                let b = [center[0] - r, center[1] - r, 2.0 * r, 2.0 * r];
                avoid.push(b);
                named.insert(item.clone(), b);
            }
            Mark::Path {
                geometry, offset, ..
            } => segments(
                &geometry.verbs,
                *offset,
                geometry.stroke.unwrap_or(0.0),
                &mut avoid,
            ),
            Mark::Shape { verbs, stroke, .. } => segments(
                verbs,
                [0.0, 0.0],
                stroke.as_ref().map_or(0.0, |s| s.width),
                &mut avoid,
            ),
            Mark::Image { item, bounds, .. } => {
                avoid.push(*bounds);
                named.insert(item.clone(), *bounds);
            }
            Mark::Text { .. } => {}
        }
    }
    (avoid, named)
}

/// The document's labels, read and aimed at their targets, with what they avoid: every mark of
/// `frame` (the document drawn without its labels), each rect's box, and each graph's titles.
pub(crate) struct Board {
    labels: Vec<Read>,
    placed: Vec<Label>,
    avoid: Avoid,
    frame: [f64; 4],
}

pub(crate) fn board(
    doc: &Map<String, Value>,
    items: &Map<String, Value>,
    graphs: &Graphs,
    frame: &Frame,
) -> Result<Board, Value> {
    let labels = labels_of(items)?;
    let (mut boxes, named) = mark_boxes(frame);
    for g in graphs.values() {
        boxes.extend(g.groups.values().map(|b| b.title));
    }
    // A status mark is a rect a status binding colors; every rect is avoided, status ones too.
    let mut status = Vec::new();
    for (id, item) in items {
        if kind(item) != "rect@1" {
            continue;
        }
        let Some([x, y, w, h]) = item
            .pointer("/params/box")
            .and_then(Value::as_array)
            .and_then(|b| b.iter().map(Value::as_f64).collect::<Option<Vec<_>>>())
            .and_then(|b| <[f64; 4]>::try_from(b.as_slice()).ok())
        else {
            continue;
        };
        let pos = |k: usize| {
            item.pointer(&format!("/at/pos/{k}"))
                .and_then(Value::as_f64)
                .unwrap_or(0.0)
        };
        let b = [x + pos(0), y + pos(1), w, h];
        let bound = doc
            .get("status_bindings")
            .and_then(Value::as_object)
            .is_some_and(|m| {
                m.values().any(|s| {
                    s.get("target")
                        .and_then(Value::as_str)
                        .is_some_and(|t| t.starts_with(&format!("items/{id}/")))
                })
            });
        if bound {
            status.push(b);
        } else {
            boxes.push(b);
        }
    }
    let mut placed = Vec::with_capacity(labels.len());
    for r in &labels {
        let (owner, row) = r.target.split_once('#').unwrap_or((&r.target, ""));
        let target = match graphs.get(owner) {
            Some(g) => g.nodes.get(row).copied(),
            None => named
                .get(&r.target)
                .copied()
                .or_else(|| text_anchor(frame, items, owner, row)),
        }
        .ok_or_else(|| refused("ref_unresolved", &format!("items/{}/params/target", r.id)))?;
        placed.push(Label {
            target,
            ..r.label.clone()
        });
    }
    Ok(Board {
        labels,
        placed,
        avoid: Avoid { boxes, status },
        frame: frame_box(doc),
    })
}

/// Planted label placement (#399 AC7's wrong program): every label folds.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum Placer {
    #[default]
    Honest,
    FoldsEveryLabel,
}

impl Board {
    fn bucket(&self, bucket: i32, placer: Placer) -> BTreeMap<String, Spot> {
        let mut spots = labels::place(&self.placed, &self.avoid, &placement(self.frame), bucket);
        if placer == Placer::FoldsEveryLabel {
            for l in &self.placed {
                spots.insert(l.id.clone(), Spot::Folded(l.fold));
            }
        }
        spots
    }

    /// One stop of a camera path at `zoom`: each label's state, its box in view px where it
    /// placed, and its opacity there, by zoom alone; and how many folded.
    pub(crate) fn stop(&self, zoom: f64, placer: Placer) -> (i32, Value, usize) {
        let bucket = labels::bucket(zoom, 1.0);
        let here = self.bucket(bucket, placer);
        let next = self.bucket(bucket + 1, placer);
        let mut out = Map::new();
        let mut folded = 0;
        for l in &self.placed {
            let spot = here[&l.id];
            let opacity = labels::opacity(&spot, &next[&l.id], zoom, 1.0);
            let entry = match spot {
                Spot::At { anchor, .. } => {
                    // The bucket picked the anchor; the box is where it sits at this zoom.
                    let t = [
                        (l.target[0] - self.frame[0]) * zoom,
                        (l.target[1] - self.frame[1]) * zoom,
                        l.target[2] * zoom,
                        l.target[3] * zoom,
                    ];
                    let (x, y) = labels::anchored(anchor, t, l.w, l.h, l.offset);
                    json!({"state": "placed", "box": [x, y, l.w, l.h], "opacity": opacity})
                }
                Spot::Folded(_) => {
                    folded += 1;
                    json!({"state": "folded", "box": null, "opacity": opacity})
                }
            };
            out.insert(l.id.clone(), entry);
        }
        (bucket, Value::Object(out), folded)
    }

    /// The labels drawn at zoom 1 as marks2d's items: a text where each placed, and a line
    /// counting the folded ones at the frame's foot.
    pub(crate) fn draw(&self, items: &mut Map<String, Value>, placer: Placer) {
        let spots = self.bucket(0, placer);
        let mut folded = 0;
        for (r, l) in self.labels.iter().zip(&self.placed) {
            let layer = items
                .get(&r.id)
                .and_then(|i| i.get("layer"))
                .cloned()
                .unwrap_or(json!("main"));
            items.remove(&r.id);
            match spots[&l.id] {
                Spot::At { x, y, .. } => {
                    let size = (l.h - 2.0).clamp(6.0, 13.0);
                    items.insert(
                        r.id.clone(),
                        json!({"id": r.id, "kind": "text@1", "name": "Label", "layer": layer,
                               "order": "z0", "at": {"pos": [self.frame[0] + x, self.frame[1] + y, 0]},
                               "params": {"text": r.text, "font": "body", "size": size,
                                          "box": {"w": l.w, "h": l.h},
                                          "paint": {"fill": {"role": "ink"}}}}),
                    );
                }
                Spot::Folded(_) => folded += 1,
            }
        }
        if folded > 0 {
            let id = "labels.folded".to_string();
            items.insert(
                id.clone(),
                json!({"id": id, "kind": "text@1", "name": "Folded labels", "layer": "main", "order": "z1",
                       "at": {"pos": [8, self.frame[3] - 22.0, 0]},
                       "params": {"text": format!("{folded} more labels folded"), "font": "body", "size": 12,
                                  "paint": {"fill": {"role": "muted"}}}}),
            );
        }
    }
}
