//! Issue #490: the call `fn`, the core's closed function list read as a check reads it: one
//! expression's point form at points, its interval form over ranges, and the seeded search for
//! counterexamples that pairs them (the #490 acceptance README: The surface under test).

use deep_canvas::expr::{Expr, Planted, Scope, B, V};
use deep_canvas::interval::Iv;
use serde_json::{json, Map, Value};

/// The node cap an expression's sums count against, by where it's read.
fn cap(context: Option<&str>) -> Option<usize> {
    Some(match context {
        None | Some("path") => 512,
        Some("field") => 256,
        Some("driver") => 64,
        Some(_) => return None,
    })
}

/// mulberry32 seeded with `seed`: the search's points, as its README writes it.
struct Mulberry(u32);

impl Mulberry {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }
}

fn end(v: f64) -> Value {
    if v.is_finite() {
        json!(v)
    } else {
        Value::Null
    }
}

fn bound_json(b: Iv) -> Value {
    if b.is_empty() {
        return json!({"lo": null, "hi": null});
    }
    json!({"lo": end(b.lo), "hi": end(b.hi)})
}

fn value_json(v: V) -> Value {
    match v {
        V::S(x) => end(x),
        V::V(n, c) => {
            let c = &c[..n as usize];
            if c.iter().all(|x| x.is_finite()) {
                json!(c)
            } else {
                Value::Null
            }
        }
    }
}

fn refused(code: &str, extra: Value) -> Value {
    let mut out = json!({"code": code});
    if let Value::Object(m) = extra {
        for (k, v) in m {
            out[k] = v;
        }
    }
    out
}

/// A control's value as the input track leaves it: its latest entry, else its default.
fn control_value(control: &Value, id: &str, input: &[Value]) -> Option<f64> {
    let mut latest: Option<(i64, i64, f64)> = None;
    for e in input {
        if e.get("control").and_then(Value::as_str) != Some(id) {
            continue;
        }
        let (t, seq, v) = (e.get("t")?.as_i64()?, e.get("seq")?.as_i64()?, e.get("value")?.as_f64()?);
        if latest.is_none_or(|(lt, ls, _)| (t, seq) >= (lt, ls)) {
            latest = Some((t, seq, v));
        }
    }
    latest
        .map(|l| l.2)
        .or_else(|| control.get("default").and_then(Value::as_f64))
}

/// The reply to one `fn` call.
pub fn reply(c: &Map<String, Value>) -> Value {
    let Some(text) = c.get("expr").and_then(Value::as_str) else {
        return refused("bad_input", json!({"why": "no expr"}));
    };
    let Some(cap) = cap(c.get("context").and_then(Value::as_str)) else {
        return refused("bad_input", json!({"why": "context is driver, field or path"}));
    };
    let packs = c.get("packs").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut scope = match Scope::of_packs(&packs) {
        Ok(s) => s,
        Err(e) => return refused("bad_table", e.refusal.to_json(&e.name)),
    };
    match c.get("planted").map(|p| p.as_str().and_then(Planted::named)) {
        None => {}
        Some(Some(p)) => scope.planted = Some(p),
        Some(None) => return refused("bad_input", json!({"why": "unknown planted form"})),
    }
    // Vars bound to controls: each its control's value, its declared max the range's top.
    let input = c.get("input").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut bound: Vec<(String, f64)> = Vec::new();
    for (name, path) in c.get("vars").and_then(Value::as_object).into_iter().flatten() {
        let id = path
            .as_str()
            .and_then(|p| p.strip_prefix("controls/"))
            .and_then(|p| p.strip_suffix("/value"));
        let control = id.and_then(|id| c.get("controls")?.get(id));
        let (Some(id), Some(control)) = (id, control) else {
            return refused("ref_unresolved", json!({"var": name}));
        };
        if let Some(max) = control.pointer("/range/1").and_then(Value::as_f64) {
            scope.maxes.insert(name.clone(), max);
        }
        let Some(v) = control_value(control, id, &input) else {
            return refused("bad_input", json!({"var": name}));
        };
        bound.push((name.clone(), v));
    }
    let expr = match Expr::compile(text, &scope, cap) {
        Ok(e) => e,
        Err(r) => return refused("refused", json!({"call": r.call, "why": r.why})),
    };
    let fixed = |name: &str| bound.iter().find(|(n, _)| n == name).map(|(_, v)| *v);
    // A point: a number binds x; an object binds each name it gives.
    let vars_at = |p: &Value| -> Vec<V> {
        expr.vars
            .iter()
            .map(|n| {
                let v = match p {
                    Value::Object(o) => o.get(n).and_then(Value::as_f64),
                    v if n == "x" => v.as_f64(),
                    _ => None,
                };
                V::S(v.or_else(|| fixed(n)).unwrap_or(f64::NAN))
            })
            .collect()
    };
    let vars_over = |r: Iv| -> Vec<B> {
        expr.vars
            .iter()
            .map(|n| {
                B::S(match fixed(n) {
                    Some(v) => Iv::point(v),
                    None if n == "x" => r,
                    None => Iv::ENTIRE,
                })
            })
            .collect()
    };
    let range_of = |v: &Value| -> Option<Iv> {
        let a = v.as_array()?;
        let (lo, hi) = (a.first()?.as_f64()?, a.get(1)?.as_f64()?);
        (lo <= hi).then(|| Iv::new(lo, hi))
    };
    if let Some(at) = c.get("at").and_then(Value::as_array) {
        let values: Vec<Value> = at.iter().map(|p| value_json(expr.eval(&vars_at(p)))).collect();
        return json!({"values": values});
    }
    if let Some(over) = c.get("over").and_then(Value::as_array) {
        let Some(ranges) = over.iter().map(range_of).collect::<Option<Vec<_>>>() else {
            return refused("bad_input", json!({"why": "a range is [a, b] with a ≤ b"}));
        };
        let bounds: Vec<Value> = ranges
            .into_iter()
            .map(|r| bound_json(expr.bound(&vars_over(r)).num()))
            .collect();
        return json!({"bounds": bounds});
    }
    if let Some(search) = c.get("search") {
        let ranges = search.get("ranges").and_then(Value::as_array);
        let points = search.get("points").and_then(Value::as_u64);
        let seed = search.get("seed").and_then(Value::as_i64);
        let (Some(ranges), Some(points), Some(seed)) = (ranges, points, seed) else {
            return refused("bad_input", json!({"why": "search takes ranges, points and seed"}));
        };
        let Some(ranges) = ranges.iter().map(range_of).collect::<Option<Vec<_>>>() else {
            return refused("bad_input", json!({"why": "a range is [a, b] with a ≤ b"}));
        };
        let mut vars = vars_at(&json!(0.0));
        let x = expr.vars.iter().position(|n| n == "x");
        let rows: Vec<Value> = ranges
            .iter()
            .enumerate()
            .map(|(i, r)| {
                let b = expr.bound(&vars_over(*r)).num();
                let mut rand = Mulberry((seed as u32).wrapping_add(i as u32));
                // The least and greatest finite values, each with its x.
                let mut min: Option<(f64, f64)> = None;
                let mut max: Option<(f64, f64)> = None;
                for _ in 0..points {
                    let p = r.lo + (r.hi - r.lo) * rand.next();
                    if let Some(x) = x {
                        vars[x] = V::S(p);
                    }
                    let y = expr.eval(&vars).num();
                    if !y.is_finite() {
                        continue;
                    }
                    if min.is_none_or(|(_, m)| y < m) {
                        min = Some((p, y));
                    }
                    if max.is_none_or(|(_, m)| y > m) {
                        max = Some((p, y));
                    }
                }
                let ext = |e: Option<(f64, f64)>| e.map_or(Value::Null, |(x, y)| json!({"x": x, "y": y}));
                let mut row = bound_json(b);
                row["min"] = ext(min);
                row["max"] = ext(max);
                row
            })
            .collect();
        return json!({"search": rows});
    }
    refused("bad_input", json!({"why": "fn takes at, over or search"}))
}

/// The reply to `path`: an item's drawn path, as the presented document draws it, in the item's
/// own units, one list of points per sub-path, and the notices its drawing raised (an
/// estimate's names its x range).
pub fn path_reply(document: &Value, item: &str) -> Value {
    let Some(params) = document.get("items").and_then(|i| i.get(item)).and_then(|i| i.get("params")) else {
        return json!({"outcome": "refused", "code": "ref_unresolved", "item": item});
    };
    if let Some(f) = params.get("fn") {
        return match deep_canvas_marks::function::draw(f) {
            Ok(d) => json!({
                "item": item,
                "subpaths": d.subpaths,
                "notices": d.estimates.iter().map(|r| json!({
                    "code": "estimate", "ids": [item], "x_range": r,
                    "what": "drawn from its samples: the bound can't settle this stretch within 2,000 points",
                })).collect::<Vec<_>>(),
            }),
            Err(r) => json!({"outcome": "refused", "code": "bad_doc", "item": item, "path": format!("params/fn/{}", r.field), "why": r.why}),
        };
    }
    let verbs = params.get("d").and_then(Value::as_str).and_then(deep_canvas_marks::path::parse);
    let Some(verbs) = verbs else {
        return json!({"outcome": "refused", "code": "bad_path_data", "item": item});
    };
    let lines = deep_canvas_marks::path::flatten(&verbs, deep_canvas_marks::path::tolerance(0));
    json!({"item": item, "subpaths": lines.iter().map(|l| &l.points).collect::<Vec<_>>(), "notices": []})
}
