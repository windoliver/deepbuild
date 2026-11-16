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
use deep_canvas_marks::scene::{Palette, Rgb};
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
    let lanes = match &s.per_edge {
        Some(column) => lanes(id, items, &named, column, s.count)?,
        None => Vec::new(),
    };
    let mut b = Baked::new(id, s, item_seed(doc_seed, id), [0.0; 3]);
    b.flows = laid;
    b.lanes = lanes;
    b.births = Births::of(doc, id);
    b.planted = plants(planted).0;
    Ok(Flow { b, names: named })
}

/// `per_edge: column`: each edge named in `curves` emits at its row's `column` per second, with
/// the item's rows shared out among the edges by their rates (largest remainder), so each edge's
/// emitter is its own closed form.
fn lanes(
    id: &str,
    items: &Map<String, Value>,
    curves: &[String],
    column: &str,
    count: u32,
) -> Result<Vec<eval::Lane>, Refusal> {
    let path = format!("items/{id}/params/per_edge");
    let mut rates = Vec::with_capacity(curves.len());
    for name in curves {
        let bad = |what: String| Refusal::new("out_of_range", &path, what);
        let (graph, edge) = name
            .split_once('#')
            .filter(|(g, _)| items.get(*g).is_some_and(|i| i["kind"] == "graph@1"))
            .ok_or_else(|| bad(format!("{id}: per_edge reads graph edges; {name} is none")))?;
        let row = items[graph]["params"]["graph"]["edges"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|r| r["id"] == edge)
            .ok_or_else(|| bad(format!("{id}: {graph} has no edge {edge}")))?;
        let rate = row[column]
            .as_f64()
            .filter(|r| r.is_finite() && *r >= 0.0)
            .ok_or_else(|| {
                bad(format!(
                    "{id}: edge {edge}'s {column} is no rate of 0 or more"
                ))
            })?;
        rates.push(rate);
    }
    let total: f64 = rates.iter().sum();
    let share = |r: f64| {
        if total > 0.0 {
            f64::from(count) * r / total
        } else {
            0.0
        }
    };
    let mut slots: Vec<u32> = rates.iter().map(|r| share(*r).floor() as u32).collect();
    let mut left = count.saturating_sub(slots.iter().sum());
    let mut order: Vec<usize> = (0..rates.len()).collect();
    order.sort_by(|a, b| {
        let frac = |k: usize| share(rates[k]) - share(rates[k]).floor();
        frac(*b).total_cmp(&frac(*a)).then(a.cmp(b))
    });
    for k in order {
        if left == 0 || total <= 0.0 {
            break;
        }
        slots[k] += 1;
        left -= 1;
    }
    let mut first = 0;
    Ok(rates
        .iter()
        .zip(slots)
        .map(|(rate, n)| {
            let lane = eval::Lane {
                first,
                slots: n,
                rate: *rate,
            };
            first += n;
            lane
        })
        .collect())
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
    aged(b, seconds)
        .into_iter()
        .map(|r| r.map(|(p, _)| p))
        .collect()
}

/// An item's rows at `seconds`: each live row's place and its age as a fraction of its life.
fn aged(b: &Baked, seconds: f64) -> Vec<Option<([f64; 2], f64)>> {
    eval::columns_on(b, seconds, None)
        .chunks(eval::FLOATS)
        .map(|r| (r[3] >= 0.0).then_some(([r[0], r[1]], r[3])))
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
/// particles item drawn as its live particles' dots, in its layer and order, each at its size and
/// opacity over life; and the colors of dots whose roles mix at their age, as roles named by the
/// dot, for the frame's palette.
pub(crate) fn lower(
    doc: &Map<String, Value>,
    items: &mut Map<String, Value>,
    t: i64,
    planted: Option<Planted>,
    palette: &Palette,
) -> Result<Vec<(String, Rgb)>, Value> {
    let mut mixed = Vec::new();
    let has_graph = items.values().any(|i| i["kind"] == "graph@1");
    let flows: Vec<String> = items
        .iter()
        .filter(|(_, i)| two_d(i))
        .map(|(k, _)| k.clone())
        .collect();
    if !has_graph && flows.is_empty() {
        return Ok(mixed);
    }
    let (drawn, routes) = deep_marks_render::graphs_drawn(doc, items)?;
    let whole = Value::Object(doc.clone());
    let seconds = t as f64 / FLICKS;
    let mut out = drawn;
    for id in &flows {
        let f = flow(&whole, id, items, &routes, seconds, planted).map_err(|r| refusal(&r))?;
        let item = out.remove(id).unwrap_or_default();
        let p = &item["params"];
        let size = over_life(&p["size"], 4.0);
        let opacity = over_life(&p["opacity"], 1.0);
        let keys = color_keys(&p["color"]);
        let order = item["order"].as_str().unwrap_or("a").to_string();
        for (row, at) in aged(&f.b, seconds).iter().enumerate() {
            let Some(([x, y], age)) = at else { continue };
            let dot = format!("{id}.p{row}");
            // One role holds the dot's color; keys of more than one role mix in OKLab at its age.
            let role = match colour(&keys, *age, palette) {
                Ok(role) => role.to_string(),
                Err(rgb) => {
                    mixed.push((dot.clone(), rgb));
                    dot.clone()
                }
            };
            out.insert(
                dot.clone(),
                json!({"id": dot, "kind": "circle@1", "name": dot, "layer": item["layer"],
                       "order": format!("{order}{row:05}"), "at": {"pos": [x, y, 0]},
                       "params": {"center": [0, 0], "r": 0.5 * at_age(&size, *age),
                                  "paint": {"fill": {"role": role, "opacity": at_age(&opacity, *age).clamp(0.0, 1.0)}}}}),
            );
        }
    }
    *items = out;
    Ok(mixed)
}

/// A channel over life (Particles `particles@1`: `size, opacity: channels over life`): a
/// number, `[birth, death]`, or keys `[{at, value}]`, as keys over the life's fraction.
fn over_life(v: &Value, default: f64) -> Vec<(f64, f64)> {
    match v {
        Value::Number(n) => vec![(0.0, n.as_f64().unwrap_or(default))],
        Value::Array(a) if a.iter().all(Value::is_object) && !a.is_empty() => a
            .iter()
            .map(|k| {
                (
                    k["at"].as_f64().unwrap_or(0.0),
                    k["value"].as_f64().unwrap_or(default),
                )
            })
            .collect(),
        Value::Array(a) if a.len() == 2 => vec![
            (0.0, a[0].as_f64().unwrap_or(default)),
            (1.0, a[1].as_f64().unwrap_or(default)),
        ],
        _ => vec![(0.0, default)],
    }
}

/// Keys at `age` (a fraction of the life): the value between the keys either side of it.
fn at_age(keys: &[(f64, f64)], age: f64) -> f64 {
    let (k, f) = between(&keys.iter().map(|k| k.0).collect::<Vec<_>>(), age);
    keys[k].1 + (keys[(k + 1).min(keys.len() - 1)].1 - keys[k].1) * f
}

/// The key at or before `age` among keys at `ats` (ascending), and how far toward the next.
fn between(ats: &[f64], age: f64) -> (usize, f64) {
    let k = ats.iter().rposition(|a| *a <= age).unwrap_or(0);
    match ats.get(k + 1) {
        Some(next) if *next > ats[k] => (k, ((age - ats[k]) / (next - ats[k])).clamp(0.0, 1.0)),
        _ => (k, 0.0),
    }
}

/// `color`: look roles over life, `[{at, role}]` or one role.
fn color_keys(v: &Value) -> Vec<(f64, String)> {
    let keys: Vec<(f64, String)> = match v {
        Value::String(r) => vec![(0.0, r.clone())],
        Value::Array(a) => a
            .iter()
            .filter_map(|k| {
                Some((
                    k["at"].as_f64().unwrap_or(0.0),
                    k["role"].as_str()?.to_string(),
                ))
            })
            .collect(),
        _ => Vec::new(),
    };
    if keys.is_empty() {
        vec![(0.0, "accent".to_string())]
    } else {
        keys
    }
}

/// The dot's color at `age`: a role when one holds it (one key, or keys of one role either side),
/// or the two roles' colors mixed in OKLab.
fn colour<'a>(keys: &'a [(f64, String)], age: f64, palette: &Palette) -> Result<&'a str, Rgb> {
    use deep_canvas::color::{oklab_to_srgb, srgb_to_oklab, Oklab, Srgb};
    let (k, f) = between(&keys.iter().map(|k| k.0).collect::<Vec<_>>(), age);
    let (a, b) = (&keys[k].1, &keys[(k + 1).min(keys.len() - 1)].1);
    let (Some(ca), Some(cb)) = (palette.get(a), palette.get(b)) else {
        return Ok(a);
    };
    if a == b || f == 0.0 {
        return Ok(a);
    }
    let lab = |c: &Rgb| {
        srgb_to_oklab(Srgb {
            r: f64::from(c[0]) / 255.0,
            g: f64::from(c[1]) / 255.0,
            b: f64::from(c[2]) / 255.0,
        })
    };
    let (la, lb) = (lab(ca), lab(cb));
    let m = oklab_to_srgb(Oklab {
        l: la.l + (lb.l - la.l) * f,
        a: la.a + (lb.a - la.a) * f,
        b: la.b + (lb.b - la.b) * f,
    });
    let byte = |x: f64| (x.clamp(0.0, 1.0) * 255.0).round() as u8;
    Err([byte(m.r), byte(m.g), byte(m.b)])
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
