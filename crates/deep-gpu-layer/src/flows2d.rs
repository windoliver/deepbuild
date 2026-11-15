//! #451: 2D particles (`particles@1` with `dimensions: 2`; canvas primitives: Particles
//! `particles@1`: space and paths), positions in document u, y down, moving along curves as laid
//! out at the time read: `path@1` items, a graph's routed edges `<graph>#<edge key>` (the routes
//! deep-marks-render lays out and draws) and a vector field's streams `<field>#streams`, each
//! stream its own sub-path `<field>#s<i>`. Each frame the f64 closed form places them and they draw
//! as dots in their writer layer, which film2d draws on the GPU layer; nothing is kept between
//! frames, so seeking equals playing and a relayout moves them onto the new route.
//!
//! The `particles` call on a 2D item answers its particles with the curve each moves along and its
//! places `[x, y]` at each time asked (tests/acceptance/451/README.md: The surface under test).

use deep_canvas_effects::particles::eval::{self, Baked};
use deep_canvas_effects::particles::flows::Curve;
use deep_canvas_effects::particles::spec::{self, Motion, Refusal};
use deep_canvas_effects::particles::{births::Births, rule};
use deep_canvas_marks::vector_field::{self, Method};
use deep_canvas_motion::eval as motion;
use deep_canvas_motion::program::Program;
use serde_json::{json, Map, Value};

use crate::effects::item_seed;
use crate::particles::{plants, refusal};
use crate::{refused, Planted};

const FLICKS: f64 = 705_600_000.0;

/// Whether `item` is a 2D particles item.
pub(crate) fn two_d(item: &Value) -> bool {
    item["kind"] == "particles@1" && item["params"]["dimensions"] == 2
}

/// Whether the document holds one.
pub(crate) fn any(doc: &Value) -> bool {
    rule::items(doc).iter().any(|(_, i)| two_d(i))
}

/// A 2D item ready at one time: its bake with its curves as laid out then, and each curve's name.
pub(crate) struct Flow {
    pub b: Baked,
    pub names: Vec<String>,
}

fn unresolved(id: &str, what: String) -> Refusal {
    Refusal::new(
        "ref_unresolved",
        format!("items/{id}/params/motion/along/curves"),
        what,
    )
}

/// The curves `names` name, as `items` (evaluated at `seconds`, graphs not yet lowered) lay them
/// out: each with its name, a field's streams one a stream.
fn curves(
    id: &str,
    items: &Map<String, Value>,
    routes: &deep_marks_render::Routes,
    names: &[String],
    seconds: f64,
    arrows: bool,
) -> Result<(Vec<String>, Vec<Curve>), Refusal> {
    let mut out = (Vec::new(), Vec::new());
    let flat = |pts: &[[f64; 2]]| pts.iter().map(|p| [p[0], p[1], 0.0]).collect::<Vec<_>>();
    for name in names {
        if let Some(field) = name.strip_suffix("#streams") {
            let item = items
                .get(field)
                .filter(|i| i["kind"] == vector_field::KIND)
                .ok_or_else(|| unresolved(id, format!("{id}: {name} names no vector field")))?;
            let value = |p: &str| (p == "time").then_some(seconds);
            let vf = vector_field::read_item(field, item, &value, Method::Rk4).map_err(|r| {
                Refusal::new(r.code, r.path, format!("{id}: {field} can't be read"))
            })?;
            let s = vf
                .streams
                .as_ref()
                .ok_or_else(|| unresolved(id, format!("{id}: {field} draws no streams")))?;
            let (lines, _) = vector_field::integrated(&vf.field, s);
            for (i, line) in lines.iter().enumerate() {
                let mut pts: Vec<[f64; 3]> = line.iter().map(|p| [p[0], p[1], 0.0]).collect();
                // The planted wrong program: a straight line from the stream's start along the
                // field's arrow there, as long as the stream.
                if arrows && pts.len() > 1 {
                    let p0 = line[0];
                    let v = vf.field.at(&p0);
                    let l = deep_canvas::ops::sqrt(v[0] * v[0] + v[1] * v[1]);
                    let len = Curve::new(pts.clone()).len();
                    if l > 0.0 {
                        pts = vec![
                            [p0[0], p0[1], 0.0],
                            [p0[0] + v[0] / l * len, p0[1] + v[1] / l * len, 0.0],
                        ];
                    }
                }
                out.0.push(format!("{field}#s{i}"));
                out.1.push(Curve::new(pts));
            }
        } else if let Some((graph, edge)) = name.split_once('#') {
            let route = routes.get(graph).and_then(|r| r.get(edge)).ok_or_else(|| {
                unresolved(id, format!("{id}: {name} names no routed edge of a graph"))
            })?;
            out.0.push(name.clone());
            out.1.push(Curve::new(flat(route)));
        } else {
            let item = items
                .get(name)
                .filter(|i| i["kind"] == "path@1")
                .ok_or_else(|| unresolved(id, format!("{id}: {name} names no path item")))?;
            let verbs = item["params"]["d"]
                .as_str()
                .and_then(deep_canvas_marks::path::parse)
                .ok_or_else(|| unresolved(id, format!("{id}: {name}'s d can't be read")))?;
            let pos = |k: usize| item["at"]["pos"][k].as_f64().unwrap_or(0.0);
            let line = deep_canvas_marks::path::flatten(&verbs, 0.01)
                .into_iter()
                .next()
                .map(|l| l.points)
                .unwrap_or_default();
            let moved: Vec<[f64; 2]> = line
                .iter()
                .map(|p| [p[0] + pos(0), p[1] + pos(1)])
                .collect();
            out.0.push(name.clone());
            out.1.push(Curve::new(flat(&moved)));
        }
    }
    Ok(out)
}

/// Item `id` at `seconds`, its curves laid out from `items` (evaluated then) and `routes`.
pub(crate) fn flow(
    doc: &Value,
    id: &str,
    items: &Map<String, Value>,
    routes: &deep_marks_render::Routes,
    seconds: f64,
    planted: Option<Planted>,
) -> Result<Flow, Refusal> {
    let p = &doc["items"][id]["params"];
    let s = spec::read(doc, id, p)?;
    let names: Vec<String> = match &s.motion {
        Motion::Along { many: Some(m), .. } => match &m.collection {
            Some(c) => doc["collections"][c]["members"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .ok_or_else(|| unresolved(id, format!("{id}: curves names {c}, no collection")))?,
            None => m.curves.clone(),
        },
        _ => {
            return Err(Refusal::new(
                "out_of_range",
                format!("items/{id}/params/motion"),
                format!("{id}: a 2D particles item moves along curves"),
            ))
        }
    };
    let arrows = planted == Some(Planted::ParticlesFollowArrows);
    let (named, laid) = curves(id, items, routes, &names, seconds, arrows)?;
    let doc_seed = doc["seed"].as_u64().unwrap_or(0);
    let mut b = Baked::new(id, s, item_seed(doc_seed, id), [0.0; 3]);
    b.flows = laid;
    b.births = Births::of(doc, id);
    b.planted = plants(planted).0;
    Ok(Flow { b, names: named })
}

/// The document's items evaluated at `t` (flicks) and its graphs' routes then.
fn evaluated(
    doc: &Map<String, Value>,
    program: &Program,
    t: i64,
) -> Result<(Map<String, Value>, deep_marks_render::Routes), Value> {
    let mut state = program.state();
    program.evaluate(t, motion::Validity::Full, &mut state);
    let items = motion::items(doc, program, &state);
    let (_, routes) = deep_marks_render::graphs_drawn(doc, &items)?;
    Ok((items, routes))
}

/// An item's rows at `seconds`: each live row's place `[x, y]`, or none.
fn rows(b: &Baked, seconds: f64) -> Vec<Option<[f64; 2]>> {
    eval::columns_on(b, seconds, None)
        .chunks(eval::FLOATS)
        .map(|r| (r[3] >= 0.0).then_some([r[0], r[1]]))
        .collect()
}

/// The 2D evaluated-data hash of rows: SHA-256 over them in order, a live row the byte 1 then x and
/// y as little-endian f64, an empty one the byte 0; and how many are live.
fn hashed(rows: &[Option<[f64; 2]>]) -> (String, usize) {
    let mut bytes = Vec::with_capacity(rows.len() * 17);
    let mut live = 0;
    for r in rows {
        match r {
            Some([x, y]) => {
                live += 1;
                bytes.push(1);
                bytes.extend(x.to_le_bytes());
                bytes.extend(y.to_le_bytes());
            }
            None => bytes.push(0),
        }
    }
    (crate::frames::hex(&bytes), live)
}

/// `items` (evaluated at `t`, flicks) with every graph drawn as marks2d's items and each 2D
/// particles item drawn as its live particles' dots, in its layer and order; and each such item's
/// evaluated-data hash and live count, for film2d's `particles` field.
pub(crate) fn lower(
    doc: &Map<String, Value>,
    items: &mut Map<String, Value>,
    t: i64,
    planted: Option<Planted>,
) -> Result<Map<String, Value>, Value> {
    let mut report = Map::new();
    let has_graph = items.values().any(|i| i["kind"] == "graph@1");
    let flows: Vec<String> = items
        .iter()
        .filter(|(_, i)| two_d(i))
        .map(|(k, _)| k.clone())
        .collect();
    if !has_graph && flows.is_empty() {
        return Ok(report);
    }
    let (drawn, routes) = deep_marks_render::graphs_drawn(doc, items)?;
    let whole = Value::Object(doc.clone());
    let seconds = t as f64 / FLICKS;
    let mut out = drawn;
    for id in &flows {
        let f = flow(&whole, id, items, &routes, seconds, planted).map_err(|r| refusal(&r))?;
        let here = rows(&f.b, seconds);
        let (hash, live) = hashed(&here);
        report.insert(id.clone(), json!({"hash": hash, "live": live}));
        let item = out.remove(id).unwrap_or_default();
        let p = &item["params"];
        let r = 0.5 * p["size"].as_f64().unwrap_or(4.0);
        let role = p["color"][0]["role"]
            .as_str()
            .or(p["color"].as_str())
            .unwrap_or("accent");
        let order = item["order"].as_str().unwrap_or("a").to_string();
        for (row, at) in here.iter().enumerate() {
            let Some([x, y]) = at else { continue };
            let dot = format!("{id}.p{row}");
            out.insert(
                dot.clone(),
                json!({"id": dot, "kind": "circle@1", "name": dot, "layer": item["layer"],
                       "order": format!("{order}{row:05}"), "at": {"pos": [x, y, 0]},
                       "params": {"center": [0, 0], "r": r, "paint": {"fill": {"role": role}}}}),
            );
        }
    }
    *items = out;
    Ok(report)
}

/// film2d's `particles` field at `t` (flicks): each asked item's evaluated-data hash and live
/// count, from the same closed form its dots draw from.
pub(crate) fn report(
    doc: &Map<String, Value>,
    program: &Program,
    t: i64,
    asked: &[String],
    planted: Option<Planted>,
) -> Result<Value, Value> {
    let (items, routes) = evaluated(doc, program, t)?;
    let whole = Value::Object(doc.clone());
    let seconds = t as f64 / FLICKS;
    let mut out = Map::new();
    for id in asked {
        if !items.get(id).is_some_and(two_d) {
            return Err(refused(
                "bad_input",
                format!("particles: {id} is no 2D particles item"),
            ));
        }
        let f = flow(&whole, id, &items, &routes, seconds, planted).map_err(|r| refusal(&r))?;
        let (hash, live) = hashed(&rows(&f.b, seconds));
        out.insert(id.clone(), json!({"hash": hash, "live": live}));
    }
    Ok(Value::Object(out))
}

/// The `particles` call on a document with 2D items: the check, the estimate, and each item's
/// particles (with the curve each moves along) and its places at each time asked.
pub(crate) fn answer(doc: &Value, call: &Value, planted: Option<Planted>) -> Result<Value, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let (_, _, every) = plants(planted);
    let errors: Vec<_> = rule::issues(doc, every)
        .into_iter()
        .filter(|i| i.severity == "error")
        .collect();
    if !errors.is_empty() {
        return Ok(json!({"outcome": "refused", "issues": crate::particles::issues_json(&errors)}));
    }
    let map = doc.as_object().ok_or_else(|| bad("doc is an object"))?;
    let program = Program::compile(map).map_err(|r| refused(r.code, r.path))?;
    let times: Vec<i64> = call["t"]
        .as_array()
        .map(|t| t.iter().filter_map(Value::as_i64).collect())
        .unwrap_or_default();
    let wanted: Option<Vec<&str>> = call["items"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_str).collect());
    let span = doc
        .pointer("/transport/span")
        .and_then(|v| deep_canvas::document::duration(doc, v).ok())
        .map_or(f64::INFINITY, |f| f as f64 / FLICKS);
    let ids: Vec<String> = rule::items(doc)
        .into_iter()
        .filter(|(id, i)| two_d(i) && wanted.as_ref().is_none_or(|w| w.contains(&id.as_str())))
        .map(|(id, _)| id.clone())
        .collect();
    // The check: every item's curves resolve as laid out at the start.
    let (items0, routes0) = evaluated(map, &program, 0)?;
    let mut issues = Vec::new();
    let mut firsts = Vec::new();
    for (id, _) in rule::items(doc).into_iter().filter(|(_, i)| two_d(i)) {
        match flow(doc, id, &items0, &routes0, 0.0, planted) {
            Ok(f) => firsts.push((id.clone(), f)),
            Err(r) => issues.push(rule::issue(id, &r)),
        }
    }
    if !issues.is_empty() {
        return Ok(json!({"outcome": "refused", "issues": crate::particles::issues_json(&issues)}));
    }
    let mut out = Map::new();
    for id in &ids {
        let first = &firsts
            .iter()
            .find(|(k, _)| k == id)
            .expect("checked above")
            .1;
        let mut records = eval::records(&first.b, span);
        records.sort_by(|a, c| a.born.total_cmp(&c.born).then(a.row.cmp(&c.row)));
        let particles: Vec<Value> = records
            .iter()
            .map(|r| {
                let curve = r.curve.and_then(|c| first.names.get(c));
                json!({"row": r.row, "born": r.born, "life": r.life, "ends": r.ends, "curve": curve,
                       "from": [r.from[0], r.from[1]]})
            })
            .collect();
        let mut at = Vec::new();
        for t in &times {
            let seconds = *t as f64 / FLICKS;
            let (items, routes) = evaluated(map, &program, *t)?;
            let f = flow(doc, id, &items, &routes, seconds, planted).map_err(|r| refusal(&r))?;
            let cpu: Vec<Value> = rows(&f.b, seconds)
                .into_iter()
                .map(|r| r.map_or(Value::Null, |p| json!(p)))
                .collect();
            at.push(json!({"t": t, "cpu": cpu}));
        }
        out.insert(
            id.clone(),
            json!({"count": first.b.spec.count, "particles": particles, "at": at}),
        );
    }
    Ok(json!({"outcome": "checked", "issues": [], "estimate": rule::estimate(doc), "items": out}))
}
