//! Modifier: store (canvas primitives: Modifier: store; Attribute and field; issue #1781): a
//! field, an expression of the closed function list over `position`, `normal`, `index`, `id`,
//! the measures and the attributes of its domain, evaluated once over the elements of that
//! domain and kept as a named attribute. With `on` it writes only that part's elements, and the
//! others keep what an earlier store of the name gave them, or 0. An element whose result is
//! not finite takes the fallback, and the mesh's output `nonfinite` counts them; with no
//! fallback the store is refused.

use deep_canvas::document::Issue;
use deep_canvas::expr::{Expr, Nothing, V};
use serde_json::{json, Value};

use crate::attrs::{Attribute, Domain, Elements, Refusal, Type, Typed};
use crate::builders::Fault;
use crate::geom::{add, length, scale, unit, Mesh, V3};

/// The most nodes a field takes once its sums expand.
const NODES: usize = 256;

/// The mesh output each store counts its non-finite elements in: `[{modifier, attribute,
/// elements}]`.
pub const NONFINITE: &str = "nonfinite";

/// The wrong evaluators #1781's criteria plant.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Plants {
    /// It runs over the whole domain, whatever part `on` names.
    pub whole_domain: bool,
    /// A non-finite element keeps its earlier value.
    pub keeps_nonfinite: bool,
}

/// Why a store can't run: the param at fault under the modifier, one refused with a code of its
/// own and what it found, or an attribute's refusal.
pub(crate) enum Stop {
    At(&'static str),
    Coded(&'static str, &'static str, Value),
    Refused(Refusal),
}

fn at(param: &'static str) -> Stop {
    Stop::At(param)
}

fn vec(p: V3) -> V {
    V::V(3, [p[0], p[1], p[2], 0.0])
}

/// What the field's name `name` reads at each element of `domain`, or `None` for a name that
/// reads nothing there.
fn column(name: &str, m: &Mesh, e: &Elements, domain: Domain, table: &Typed) -> Option<Vec<V>> {
    let p = &e.poly;
    let corners = || p.faces.iter().flatten().map(|q| *q as usize);
    // Each element's place: a point's, a face's centre (the mean of its points), a corner's point's.
    let place = || -> Vec<V3> {
        match domain {
            Domain::Point => p.points.clone(),
            Domain::Face => {
                let centre = |c: &Vec<u32>| {
                    let sum = c
                        .iter()
                        .fold([0.0; 3], |s, q| add(s, p.points[*q as usize]));
                    scale(sum, 1.0 / c.len() as f64)
                };
                p.faces.iter().map(centre).collect()
            }
            _ => corners().map(|q| p.points[q]).collect(),
        }
    };
    let number = |f: &dyn Fn(V3) -> f64| Some(place().into_iter().map(|q| V::S(f(q))).collect());
    let [lo, hi] = m.bounds();
    match name {
        "position" => Some(place().into_iter().map(vec).collect()),
        "normal" => Some(match domain {
            Domain::Point => {
                let mut sum = vec![[0.0; 3]; p.points.len()];
                for (v, q) in e.point.iter().enumerate() {
                    sum[*q as usize] = add(sum[*q as usize], m.normals[v]);
                }
                sum.into_iter().map(|n| vec(unit(n))).collect()
            }
            Domain::Face => (0..p.faces.len()).map(|f| vec(unit(p.normal(f)))).collect(),
            _ => {
                let vertices = p.vertex.iter().flatten();
                vertices.map(|v| vec(m.normals[*v as usize])).collect()
            }
        }),
        "index" | "id" => Some((0..e.count(domain)).map(|i| V::S(i as f64)).collect()),
        "height" => number(&|q| ((q[1] - lo[1]) / (hi[1] - lo[1]).max(1e-12)).clamp(0.0, 1.0)),
        "x" => number(&|q| q[0]),
        "y" => number(&|q| q[1]),
        "z" => number(&|q| q[2]),
        "distance" => number(&length),
        _ => {
            if let Some(a) = table.get(name).filter(|a| a.domain == domain) {
                let w = a.ty.width();
                let value = |c: &[f64]| match w {
                    1 => V::S(c[0]),
                    _ => V::V(
                        w as u8,
                        [0, 1, 2, 3].map(|k| c.get(k).copied().unwrap_or(0.0)),
                    ),
                };
                return Some(a.values.chunks(w).map(value).collect());
            }
            // The geometry measures, read like attributes (#2015).
            let measure =
                |per: Vec<f64>, of: &[u32]| of.iter().map(|i| V::S(per[*i as usize])).collect();
            match domain {
                Domain::Point => Some(measure(crate::measures::point(m, name)?, &e.first())),
                Domain::Face => Some(measure(crate::measures::face(m, name)?, &p.origin)),
                _ => None,
            }
        }
    }
}

/// The elements of `domain` on the triangles `tris`.
fn chosen(m: &Mesh, e: &Elements, domain: Domain, tris: &[u32]) -> Vec<bool> {
    let mut on = vec![false; e.count(domain)];
    for t in tris {
        match domain {
            Domain::Point => {
                for j in 0..3 {
                    on[e.point[m.indices[3 * *t as usize + j] as usize] as usize] = true;
                }
            }
            _ => on[e.face[*t as usize] as usize] = true,
        }
    }
    if domain == Domain::Corner {
        let faces = e.poly.faces.iter().zip(&on);
        return faces.flat_map(|(c, f)| vec![*f; c.len()]).collect();
    }
    on
}

/// `m` with the store's field kept as its attribute, on the elements of the part `on`.
pub(crate) fn store(
    mut m: Mesh,
    p: &Value,
    on: &str,
    k: usize,
    plants: Plants,
) -> Result<Mesh, Stop> {
    let word = |name: &'static str, default: &str| match p.get(name) {
        None => Ok(default.to_string()),
        Some(v) => v.as_str().map(str::to_string).ok_or(at(name)),
    };
    let name = word("name", "")?;
    if name.is_empty() {
        return Err(at("name"));
    }
    let domain = Domain::named(&word("domain", "point")?)
        .filter(|d| matches!(d, Domain::Point | Domain::Face | Domain::Corner))
        .ok_or(at("domain"))?;
    let ty = Type::named(&word("type", "f32")?)
        .filter(|t| t.blends())
        .ok_or(at("type"))?;
    let text = match p.get("field") {
        None => "height".to_string(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(_) => return Err(at("field")),
    };
    let expr = Expr::compile(&text, &Nothing, NODES).map_err(|r| match r.size {
        Some(nodes) => Stop::Coded(
            "field.nodes",
            "field",
            json!({"nodes": nodes, "max": NODES}),
        ),
        None => Stop::Coded("out_of_range", "field", json!({"why": r.to_string()})),
    })?;
    // Required wherever the field divides or takes a log, a root or a power, and wherever an
    // element's result is not finite all the same: nothing takes a value silently.
    let missing = || Stop::Coded("fallback_missing", "fallback", json!({"field": text}));
    let fallback = match p.get("fallback") {
        None if expr.partial() => return Err(missing()),
        None => None,
        Some(v) => Some(v.as_f64().filter(|x| x.is_finite()).ok_or(at("fallback"))?),
    };
    let e = Elements::of(&m);
    let table = e.table(&m);
    let now = (domain, ty);
    let earlier = table.get(&name);
    if let Some(was) = earlier.map(|a| (a.domain, a.ty)).filter(|w| *w != now) {
        return Err(Stop::Refused(Refusal::Second { name, was, now }));
    }
    let columns: Vec<Vec<V>> = expr
        .vars
        .iter()
        .map(|v| column(v, &m, &e, domain, &table))
        .collect::<Option<_>>()
        .ok_or(at("field"))?;
    let w = ty.width();
    let count = e.count(domain);
    let only = match on {
        "all" => vec![true; count],
        _ if plants.whole_domain => vec![true; count],
        part => {
            let tris = m
                .parts
                .get(part)
                .or_else(|| m.closed.get(part).map(|c| &c.0));
            chosen(&m, &e, domain, tris.ok_or(at("on"))?)
        }
    };
    let mut values = earlier.map_or_else(|| vec![0.0; count * w], |a| a.values.clone());
    let mut nonfinite = 0u32;
    for i in (0..count).filter(|i| only[*i]) {
        let args: Vec<V> = columns.iter().map(|c| c[i]).collect();
        let out = &mut values[i * w..(i + 1) * w];
        match expr.eval(&args) {
            V::S(x) if w == 1 && x.is_finite() => out[0] = x,
            V::V(n, c) if n as usize == w && c[..w].iter().all(|x| x.is_finite()) => {
                out.copy_from_slice(&c[..w])
            }
            // A value of another shape than the type's is the field's fault, not an element's.
            v if v.is_finite() => return Err(at("field")),
            _ => {
                nonfinite += 1;
                if !plants.keeps_nonfinite {
                    out.fill(fallback.ok_or_else(missing)?);
                }
            }
        }
    }
    let attribute = Attribute { domain, ty, values };
    e.write(&mut m, &name, attribute).map_err(Stop::Refused)?;
    if nonfinite > 0 {
        let list = m.outputs.entry(NONFINITE.into()).or_insert(json!([]));
        if let Value::Array(list) = list {
            list.push(json!({"modifier": k, "attribute": name, "elements": nonfinite}));
        }
    }
    Ok(m)
}

/// The store's fault as the stack names one.
pub(crate) fn fault(stop: Stop, k: usize) -> Fault {
    let under = |param: &str| format!("modifiers/{k}/params/{param}");
    match stop {
        Stop::At("on") => format!("modifiers/{k}/on"),
        Stop::At(param) => under(param),
        Stop::Coded(code, param, found) => crate::attrs::coded(code, &under(param), &found),
        Stop::Refused(r) => r.fault(&under("name")),
    }
}

/// The warnings `doc`'s stores raise at check (Attribute and field): `nonfinite {id, attribute,
/// elements}` for each store that gave elements its fallback, counted on the item's build.
pub fn raised(doc: &Value) -> Vec<Issue> {
    let items = doc.get("items").and_then(Value::as_object);
    let mut out = Vec::new();
    for (id, item) in items.into_iter().flatten() {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        // Only a store with a fallback gives an element one; any other is refused where its
        // result is not finite, so only these are built here to count.
        let stores = |m: &Value| {
            m["kind"] == "mod.store@1"
                && crate::stack::enabled(m)
                && m["params"]["fallback"].is_number()
        };
        let stored = item.get("modifiers").and_then(Value::as_array);
        if !crate::builders::KINDS.contains(&kind) || !stored.is_some_and(|l| l.iter().any(stores))
        {
            continue;
        }
        let run = crate::stack::Run::default();
        let Ok(Some(m)) = crate::build::built(doc, id, item, &run, 0.0).map(|b| b.mesh) else {
            continue;
        };
        let counted = m.outputs.get(NONFINITE).and_then(Value::as_array);
        for r in counted.into_iter().flatten() {
            let path = format!("items/{id}/modifiers/{}/params/field", r["modifier"]);
            let found = json!({"id": id, "attribute": r["attribute"], "elements": r["elements"]});
            let what = "the field is not finite at these elements; each takes the fallback";
            let mut issue = Issue::error(NONFINITE, id, path, found, what);
            issue.severity = "warning";
            issue.fix = "Change the field so it is finite there, or accept the fallback.".into();
            out.push(issue);
        }
    }
    out
}
