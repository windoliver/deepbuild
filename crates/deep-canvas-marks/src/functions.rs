//! Issue #505: a frame's formulas, drawn before marks2d draws it. Each path@1 with `fn` is
//! sampled with its vars at t (controls from the input track, keyed data values, item fields)
//! through its scales, and lowered to the plain path marks2d draws: the curve as `d`, its fill as
//! an item of its own under it, a color by value as an OKLab gradient along the value's axis. Its
//! probes, area and bounds are kept for the anchors, readouts and checks that read them. A mark
//! set's computed columns are evaluated over the row index, n read from its var, and lowered to
//! f64 columns. A path attached to a probe's anchor lands on it.

use std::collections::BTreeMap;

use deep_canvas::document::Issue;
use deep_canvas::interval::Iv;
use serde_json::{json, Map, Value};

use crate::function::{self, Axes, Drawn, Form, Lin, Planted};

/// The most rows a computed column takes (Mark set and columns: n's declared max).
pub const MAX_COMPUTED_ROWS: f64 = 4096.0;

/// A probe's reading: its point and slope in the function's units, and its anchor and foot in u.
#[derive(Clone, Debug, PartialEq)]
pub struct Probe {
    pub x: f64,
    pub y: f64,
    pub slope: f64,
    pub at: [f64; 2],
    pub foot: [f64; 2],
}

/// A color by value: its axis (x or y), its ramp's roles and its domain.
#[derive(Clone, Debug, PartialEq)]
pub struct ColorBy {
    pub by_y: bool,
    pub roles: Vec<String>,
    pub domain: [f64; 2],
}

/// One path function as this frame drew it.
pub struct Plot {
    pub form: Form,
    pub axes: Axes,
    pub drawn: Drawn,
    pub probes: BTreeMap<String, Probe>,
    /// The area's value and its interval bound, and its region's outline in u.
    pub area: Option<(f64, Iv)>,
    pub fill: Vec<Vec<[f64; 2]>>,
    pub color: Option<ColorBy>,
}

impl Plot {
    /// The stroke's color at x, in OKLab, through `lab` (a role's color).
    pub fn color_at(
        &self,
        x: f64,
        lab: &dyn Fn(&str) -> Option<deep_canvas::color::Oklab>,
    ) -> Option<deep_canvas::color::Oklab> {
        let c = self.color.as_ref()?;
        let ramp: Vec<_> = c.roles.iter().map(|r| lab(r)).collect::<Option<_>>()?;
        let v = if c.by_y { self.form.y_at(x)? } else { x };
        Some(function::ramp_at(&ramp, c.domain, v))
    }
}

/// What a frame's formulas give: each plot, each computed set's column sums, the check's issues
/// and the drawing's notices.
#[derive(Default)]
pub struct Formulas {
    pub plots: BTreeMap<String, Plot>,
    pub sums: BTreeMap<(String, String), f64>,
    pub issues: Vec<Issue>,
    pub notices: Vec<Value>,
}

impl Formulas {
    /// The value an anchor path reads, `items/<id>#<anchor>/<field>`: a probe's x, y or slope, an
    /// area's value, or a computed set's column sum (`#sum/<column>`).
    pub fn anchor(&self, path: &str) -> Option<f64> {
        let (id, rest) = path.strip_prefix("items/")?.split_once('#')?;
        let (anchor, field) = rest.split_once('/')?;
        if anchor == "sum" {
            return self.sums.get(&(id.to_string(), field.to_string())).copied();
        }
        let plot = self.plots.get(id)?;
        if anchor == "area" {
            return (field == "value").then_some(plot.area?.0);
        }
        let probe = match anchor {
            "probe" => plot.probes.values().next()?,
            name => plot.probes.get(name)?,
        };
        match field {
            "x" => Some(probe.x),
            "y" => Some(probe.y),
            "slope" => Some(probe.slope),
            _ => None,
        }
    }
}

fn number(v: f64) -> String {
    let v = if v == 0.0 { 0.0 } else { v };
    format!("{v}")
}

/// Sub-paths as path data, a closed one ending in Z.
fn d_of(subpaths: &[Vec<[f64; 2]>], closed: &[bool]) -> String {
    let mut d = String::new();
    for (i, s) in subpaths.iter().enumerate() {
        for (k, p) in s.iter().enumerate() {
            if !d.is_empty() {
                d.push(' ');
            }
            d.push_str(if k == 0 { "M " } else { "L " });
            d.push_str(&number(p[0]));
            d.push(' ');
            d.push_str(&number(p[1]));
        }
        if closed.get(i) == Some(&true) {
            d.push_str(" Z");
        }
    }
    d
}

/// A linear `scale@1` item's map, or the reason it can't be one.
fn lin_of(items: &Map<String, Value>, id: &str) -> Result<Lin, String> {
    let item = items
        .get(id)
        .filter(|i| i.get("kind").and_then(Value::as_str) == Some("scale@1"))
        .ok_or(format!("`{id}` is no scale"))?;
    let s = crate::data::scale_of(id, item).map_err(|r| format!("{}: {}", r.code, r.path))?;
    if s.kind != crate::data::ScaleKind::Linear || s.domain[0] == s.domain[1] {
        return Err(format!("`{id}` is no linear scale"));
    }
    Ok(Lin {
        domain: s.domain,
        range: s.range,
    })
}

/// The frame's formulas over `items` (evaluated at t), lowering them in place. `value` reads a
/// control's value (`controls/<id>/value`) or a keyed data value (`data/<name>`) at t.
pub fn lower(
    doc: &Map<String, Value>,
    items: &mut Map<String, Value>,
    value: &dyn Fn(&str) -> Option<f64>,
    planted: Planted,
) -> Formulas {
    let mut out = Formulas::default();
    binds(doc, items, value);
    let plots: Vec<String> = items
        .iter()
        .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some("path@1"))
        .filter(|(_, i)| i.pointer("/params/fn").is_some())
        .map(|(id, _)| id.clone())
        .collect();
    for id in &plots {
        match plot(items, id, value, planted) {
            Ok(p) => {
                out.plots.insert(id.clone(), p);
            }
            Err((field, why)) => out.issues.push(Issue::error(
                "bad_doc",
                id,
                format!("items/{id}/params/{field}"),
                json!(why),
                "the path function can't be drawn as its fields say",
            )),
        }
    }
    // Fills, which may read another plot's curve, and derivative checks between plots.
    let drawn: Vec<String> = plots
        .iter()
        .filter(|id| out.plots.contains_key(*id))
        .cloned()
        .collect();
    for id in &drawn {
        let params = items[id]["params"].clone();
        if let Some(fill) = params.get("fill") {
            if let Err(issue) = filled(&mut out, items, id, fill, value) {
                out.issues.push(*issue);
            }
        }
        if let Some(other) = params.get("derivative_of").and_then(Value::as_str) {
            let path = format!("items/{id}/params/derivative_of");
            match out.plots.get(other) {
                None => out.issues.push(Issue::error(
                    "ref_unresolved",
                    id,
                    path,
                    json!(other),
                    "derivative_of names no path function",
                )),
                Some(f) => {
                    let d = &out.plots[id];
                    if let Some(x) = function::derivative_misses(&d.form, &f.form, &d.axes.y) {
                        out.issues.push(Issue::error(
                            "fn.derivative",
                            id,
                            path,
                            json!({"x": x, "of": other, "y": d.form.y_at(x), "slope": f.form.probe(x).map(|p| p.1)}),
                            "the curve parts from the other's slope by more than 0.5 px at x",
                        ));
                    }
                }
            }
        }
    }
    // The drawing's notices: each stretch or box drawn as an estimate.
    for (id, p) in &out.plots {
        for r in &p.drawn.estimates {
            out.notices.push(json!({
                "code": "estimate", "severity": "notice", "ids": [id], "path": format!("items/{id}/params/fn"),
                "x_range": r, "what": "drawn from its samples: the bound can't settle this stretch within 2,000 points",
            }));
        }
        if let Some(b) = p.drawn.estimate_box {
            out.notices.push(json!({
                "code": "estimate", "severity": "notice", "ids": [id], "path": format!("items/{id}/params/fn"),
                "box": b, "what": "drawn from its samples: the trace reached max_cells before this box settled",
            }));
        }
    }
    for id in &plots {
        if let Some(p) = out.plots.get(id) {
            lowered(items, id, p);
        }
    }
    attach(items, &out);
    columns(doc, items, value, &mut out);
    out
}

/// Each control's value written where it binds a path function's field (Control: `binds`).
fn binds(
    doc: &Map<String, Value>,
    items: &mut Map<String, Value>,
    value: &dyn Fn(&str) -> Option<f64>,
) {
    for (cid, control) in doc
        .get("controls")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let Some(v) = value(&format!("controls/{cid}/value")) else {
            continue;
        };
        for bind in control
            .get("binds")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let Some((id, field)) = bind
                .as_str()
                .and_then(|b| b.strip_prefix("items/"))
                .and_then(|b| b.split_once('/'))
            else {
                continue;
            };
            let Some(item) = items
                .get_mut(id)
                .filter(|i| i.pointer("/params/fn").is_some())
            else {
                continue;
            };
            if let Some(slot) = item.pointer_mut(&format!("/{field}")) {
                *slot = json!(v);
            }
        }
    }
}

/// A number, or a var's path read at t.
fn read(v: &Value, items: &Map<String, Value>, value: &dyn Fn(&str) -> Option<f64>) -> Option<f64> {
    match v {
        Value::String(p) => resolve(p, items, value),
        v => v.as_f64(),
    }
}

/// A var's path: a control or data value through `value`, else an item's evaluated field.
fn resolve(
    path: &str,
    items: &Map<String, Value>,
    value: &dyn Fn(&str) -> Option<f64>,
) -> Option<f64> {
    if let Some(v) = value(path) {
        return Some(v);
    }
    let (id, field) = path.strip_prefix("items/")?.split_once('/')?;
    items.get(id)?.pointer(&format!("/{field}"))?.as_f64()
}

type Refused = (String, String);

fn plot(
    items: &Map<String, Value>,
    id: &str,
    value: &dyn Fn(&str) -> Option<f64>,
    planted: Planted,
) -> Result<Plot, Refused> {
    let params = &items[id]["params"];
    let f = &params["fn"];
    let bad = |field: &str, why: String| (format!("fn/{field}"), why);
    let mut fixed: BTreeMap<String, f64> = BTreeMap::new();
    for (name, path) in f
        .get("vars")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let v = read(path, items, value)
            .ok_or_else(|| bad("vars", format!("`{name}` reads nothing at t: {path}")))?;
        fixed.insert(name.clone(), v);
    }
    let scales = f.get("scales");
    let axis = |k: &str| -> Result<Option<Lin>, Refused> {
        match scales.and_then(|s| s.get(k)) {
            None => Ok(None),
            Some(Value::String(s)) => lin_of(items, s).map(Some).map_err(|w| bad("scales", w)),
            Some(_) => Err(bad("scales", "a scale is named by its ID".into())),
        }
    };
    let (sx, sy) = (axis("x")?, axis("y")?);
    let axes = Axes {
        x: sx.unwrap_or(Lin::IDENTITY),
        y: sy.unwrap_or(Lin::IDENTITY),
    };
    let get = |n: &str| fixed.get(n).copied();
    let form = Form::read(
        f,
        &get,
        sx.map(|s| s.domain),
        sx.zip(sy).map(|(x, y)| (x.domain, y.domain)),
    )
    .map_err(|r| bad(r.field, r.why))?;
    let drawn = form
        .draw(&axes, f.get("samples"), planted)
        .map_err(|r| bad(r.field, r.why))?;
    let mut probes = BTreeMap::new();
    for (name, p) in params
        .get("probes")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let at = p
            .get("at")
            .and_then(|a| read(a, items, value))
            .ok_or_else(|| {
                (
                    format!("probes/{name}/at"),
                    "a probe's at is a number".to_string(),
                )
            })?;
        let (pt, slope) = form.probe(at).ok_or_else(|| {
            (
                format!("probes/{name}"),
                "an implicit curve takes no probe".to_string(),
            )
        })?;
        probes.insert(
            name.clone(),
            Probe {
                x: pt[0],
                y: pt[1],
                slope,
                at: [axes.x.map(pt[0]), axes.y.map(pt[1])],
                foot: [axes.x.map(pt[0]), axes.y.map(0.0)],
            },
        );
    }
    if probes.len() > 8 {
        return Err(("probes".into(), "at most 8 probes".into()));
    }
    let color = match params.get("color") {
        None => None,
        Some(c) => {
            let by_y = match c.get("by").and_then(Value::as_str) {
                Some("y") => true,
                Some("x") => false,
                _ => return Err(("color/by".into(), "color is by x or y".into())),
            };
            let roles: Vec<String> = c
                .get("ramp")
                .and_then(Value::as_array)
                .map(|r| {
                    r.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            if roles.is_empty() || roles.len() > 8 {
                return Err(("color/ramp".into(), "a ramp is 1 to 8 roles".into()));
            }
            let domain = match c.get("domain").and_then(Value::as_array).map(Vec::as_slice) {
                Some([a, b]) => match (a.as_f64(), b.as_f64()) {
                    (Some(a), Some(b)) if a != b => [a, b],
                    _ => return Err(("color/domain".into(), "a domain is [a, b], a ≠ b".into())),
                },
                _ => return Err(("color/domain".into(), "a domain is [a, b]".into())),
            };
            Some(ColorBy {
                by_y,
                roles,
                domain,
            })
        }
    };
    Ok(Plot {
        form,
        axes,
        drawn,
        probes,
        area: None,
        fill: Vec::new(),
        color,
    })
}

/// A plot's fill: the area between it and the axis or another plot over `over`, refused where
/// that range meets a stretch either curve drew as an estimate, since the area's bound needs the
/// curve's there.
fn filled(
    out: &mut Formulas,
    items: &Map<String, Value>,
    id: &str,
    fill: &Value,
    value: &dyn Fn(&str) -> Option<f64>,
) -> Result<(), Box<Issue>> {
    let path = format!("items/{id}/params/fill");
    let bad = |what: &str| {
        Box::new(Issue::error(
            "bad_doc",
            id,
            path.clone(),
            fill.clone(),
            what,
        ))
    };
    let ends = fill
        .get("over")
        .and_then(Value::as_array)
        .map(Vec::as_slice);
    let over = match ends {
        Some([a, b]) => match (read(a, items, value), read(b, items, value)) {
            (Some(a), Some(b)) if a.is_finite() && b.is_finite() => [a.min(b), a.max(b)],
            _ => return Err(bad("a fill's over is two numbers")),
        },
        None => out.plots[id]
            .form
            .over()
            .ok_or_else(|| bad("an implicit curve takes no fill"))?,
        _ => return Err(bad("a fill's over is [a, b]")),
    };
    let other = match fill.get("to").and_then(Value::as_str) {
        None | Some("axis") => None,
        Some(o) => Some(o.to_string()),
    };
    let overlaps = |r: &[f64; 2]| r[0].max(over[0]) < r[1].min(over[1]);
    for owner in std::iter::once(id).chain(other.as_deref()) {
        let Some(p) = out.plots.get(owner) else {
            return Err(Box::new(Issue::error(
                "ref_unresolved",
                id,
                format!("{path}/to"),
                json!(owner),
                "a fill's to names a path function",
            )));
        };
        if let Some(r) = p.drawn.estimates.iter().find(|r| overlaps(r)) {
            let range = [r[0].max(over[0]), r[1].min(over[1])];
            return Err(Box::new(Issue {
                ids: vec![id.to_string(), owner.to_string()]
                    .into_iter()
                    .collect::<std::collections::BTreeSet<_>>()
                    .into_iter()
                    .collect(),
                ..Issue::error(
                    "fn.bound_estimate",
                    id,
                    format!("{path}/over"),
                    json!({"x_range": range, "item": owner}),
                    "the area needs the curve's bound over a stretch drawn as an estimate",
                )
            }));
        }
    }
    let plot = &out.plots[id];
    let g = other.as_deref().map(|o| &out.plots[o].form);
    let Some((v, bound)) = function::area(&plot.form, g, over) else {
        return Err(bad("an area is taken under a function over x"));
    };
    // Its outline: the curve over the range, then back along the other curve or the axis.
    let axes = plot.axes;
    let mut outline: Vec<[f64; 2]> = sampled_edge(&plot.form, &axes, over);
    match g {
        Some(g) => outline.extend(sampled_edge(g, &axes, over).into_iter().rev()),
        None => {
            outline.push([axes.x.map(over[1]), axes.y.map(0.0)]);
            outline.push([axes.x.map(over[0]), axes.y.map(0.0)]);
        }
    }
    let p = out.plots.get_mut(id).expect("the plot");
    p.area = Some((v, bound));
    p.fill = vec![outline];
    Ok(())
}

/// The curve over `over` alone, sampled as its own drawing is, as one run of points in u.
fn sampled_edge(form: &Form, axes: &Axes, over: [f64; 2]) -> Vec<[f64; 2]> {
    form.restricted(over)
        .and_then(|f| f.draw(axes, None, Planted::None).ok())
        .map(|d| d.subpaths.concat())
        .unwrap_or_default()
}

/// The item a plot lowers to: its curve as `d`, its stroke colored by value as a gradient along
/// the value's axis, and its fill as `<id>.fill` under it.
fn lowered(items: &mut Map<String, Value>, id: &str, p: &Plot) {
    let Some(item) = items.get_mut(id).and_then(Value::as_object_mut) else {
        return;
    };
    let order = item
        .get("order")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let d = d_of(&p.drawn.subpaths, &p.drawn.closed);
    if d.is_empty() {
        item.insert("visible".into(), json!(false));
    }
    let Some(params) = item.get_mut("params").and_then(Value::as_object_mut) else {
        return;
    };
    for k in ["fn", "probes", "fill", "color", "derivative_of", "samples"] {
        params.remove(k);
    }
    let mut paint = params
        .get("paint")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let fill_paint = if p.fill.is_empty() {
        None
    } else {
        paint.remove("fill")
    };
    if let (Some(c), Some(Value::Object(stroke))) = (&p.color, paint.get_mut("stroke")) {
        let all: Vec<[f64; 2]> = p.drawn.subpaths.concat();
        let (lo, hi) = all.iter().fold(
            ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]),
            |(lo, hi), q| {
                (
                    [lo[0].min(q[0]), lo[1].min(q[1])],
                    [hi[0].max(q[0]), hi[1].max(q[1])],
                )
            },
        );
        let axis = usize::from(c.by_y);
        let map = if c.by_y { p.axes.y } else { p.axes.x };
        let span = (hi[axis] - lo[axis]).max(1e-9);
        let frac = |v: f64| (map.map(v) - lo[axis]) / span;
        let (f0, f1) = (frac(c.domain[0]), frac(c.domain[1]));
        let (from, to) = if c.by_y {
            ([0.5, f0], [0.5, f1])
        } else {
            ([f0, 0.5], [f1, 0.5])
        };
        let n = c.roles.len();
        let stops: Vec<Value> = c
            .roles
            .iter()
            .enumerate()
            .map(|(k, r)| json!({"at": if n == 1 { 0.0 } else { k as f64 / (n - 1) as f64 }, "role": r}))
            .collect();
        stroke.remove("role");
        stroke.insert(
            "gradient".into(),
            json!({"kind": "linear", "from": from, "to": to, "stops": stops}),
        );
    }
    params.insert("paint".into(), Value::Object(paint));
    params.insert(
        "d".into(),
        json!(if d.is_empty() { "M 0 0".to_string() } else { d }),
    );
    if let Some(fp) = fill_paint {
        let mut fill = Map::new();
        for k in ["layer", "parent", "visible"] {
            if let Some(v) = item.get(k) {
                fill.insert(k.into(), v.clone());
            }
        }
        // Under the curve: the fill keeps the item's place and the curve draws just after it.
        item.insert("order".into(), json!(format!("{order}V")));
        fill.insert("id".into(), json!(format!("{id}.fill")));
        fill.insert("kind".into(), json!("path@1"));
        fill.insert("name".into(), json!(format!("{id} fill")));
        fill.insert("order".into(), json!(order));
        if let Some(at) = item.get("at") {
            fill.insert("at".into(), at.clone());
        }
        fill.insert(
            "params".into(),
            json!({"d": d_of(&p.fill, &vec![true; p.fill.len()]), "paint": {"fill": fp}}),
        );
        items.insert(format!("{id}.fill"), Value::Object(fill));
    }
}

/// Each path attached to a probe's anchor (`<plot>#<probe>`), its end moved onto the anchor.
fn attach(items: &mut Map<String, Value>, f: &Formulas) {
    for item in items.values_mut() {
        let Some(params) = item.get_mut("params").and_then(Value::as_object_mut) else {
            continue;
        };
        let Some(Value::Object(attach)) = params.get("attach").cloned() else {
            continue;
        };
        let anchor = |end: &str| -> Option<[f64; 2]> {
            let (id, name) = attach.get(end)?.as_str()?.split_once('#')?;
            let plot = f.plots.get(id)?;
            let p = match name {
                "probe" => plot.probes.values().next()?,
                n => plot.probes.get(n)?,
            };
            Some(p.at)
        };
        let (start, end) = (anchor("start"), anchor("end"));
        if start.is_none() && end.is_none() {
            continue;
        }
        let Some(verbs) = params
            .get("d")
            .and_then(Value::as_str)
            .and_then(crate::path::parse)
        else {
            continue;
        };
        let mut pts: Vec<[f64; 2]> = verbs
            .iter()
            .filter_map(|v| match v {
                crate::path::Verb::Move(p) | crate::path::Verb::Line(p) => Some(*p),
                crate::path::Verb::Quad(_, p) | crate::path::Verb::Cubic(_, _, p) => Some(*p),
                crate::path::Verb::Close => None,
            })
            .collect();
        if pts.len() < 2 {
            continue;
        }
        if let Some(s) = start {
            pts[0] = s;
        }
        if let Some(e) = end {
            let last = pts.len() - 1;
            pts[last] = e;
        }
        params.insert("d".into(), json!(d_of(&[pts], &[false])));
        let mut rest = attach.clone();
        if start.is_some() {
            rest.remove("start");
        }
        if end.is_some() {
            rest.remove("end");
        }
        if rest.contains_key("start") || rest.contains_key("end") {
            params.insert("attach".into(), Value::Object(rest));
        } else {
            params.remove("attach");
        }
    }
}

/// Each mark set's computed columns, evaluated over the row index with n read at t, lowered to
/// f64 columns; their sums kept for `#sum/<column>`. n's declared max past 4,096 is refused.
fn columns(
    doc: &Map<String, Value>,
    items: &mut Map<String, Value>,
    value: &dyn Fn(&str) -> Option<f64>,
    out: &mut Formulas,
) {
    let sets: Vec<String> = items
        .iter()
        .filter(|(_, i)| i.get("kind").and_then(Value::as_str) == Some("marks@1"))
        .filter(|(_, i)| {
            i.pointer("/params/columns")
                .and_then(Value::as_object)
                .is_some_and(|c| c.values().any(|c| c.get("expr").is_some()))
        })
        .map(|(id, _)| id.clone())
        .collect();
    for id in sets {
        let snapshot = items.clone();
        let params = &snapshot[&id]["params"];
        let npath = format!("items/{id}/params/n");
        let err = |code: &'static str, path: String, actual: Value, what: &str| {
            Issue::error(code, &id, path, actual, what)
        };
        let (n, max) = match params.get("n") {
            Some(Value::String(p)) => {
                let max = p
                    .strip_prefix("controls/")
                    .and_then(|c| c.strip_suffix("/value"))
                    .and_then(|c| doc.get("controls")?.get(c)?.pointer("/range/1")?.as_f64());
                (resolve(p, &snapshot, value), max)
            }
            Some(v) => (v.as_f64(), v.as_f64()),
            None => (None, None),
        };
        let Some(max) = max else {
            out.issues.push(err(
                "bad_doc",
                npath,
                params.get("n").cloned().unwrap_or(Value::Null),
                "a computed set's n is a number or a var with a declared max",
            ));
            continue;
        };
        if max > MAX_COMPUTED_ROWS {
            out.issues.push(err(
                "out_of_range",
                npath,
                json!({"max": max}),
                "a computed column's n is declared up to 4,096 at most",
            ));
            continue;
        }
        let n = n.unwrap_or(0.0).round().clamp(0.0, max) as usize;
        let cols = params["columns"].as_object().cloned().unwrap_or_default();
        let computed: Vec<String> = cols
            .iter()
            .filter(|(_, c)| c.get("expr").is_some())
            .map(|(k, _)| k.clone())
            .collect();
        let mut done: BTreeMap<String, Vec<f64>> = BTreeMap::new();
        let mut failed = false;
        while done.len() < computed.len() && !failed {
            let before = done.len();
            for name in &computed {
                if done.contains_key(name) {
                    continue;
                }
                let c = &cols[name];
                let text = c["expr"].as_str().unwrap_or("");
                let mut fixed: BTreeMap<String, f64> = BTreeMap::new();
                for (v, p) in c
                    .get("vars")
                    .and_then(Value::as_object)
                    .into_iter()
                    .flatten()
                {
                    if let Some(x) = read(p, &snapshot, value) {
                        fixed.insert(v.clone(), x);
                    }
                }
                fixed.insert("n".into(), n as f64);
                let names: Vec<&str> = std::iter::once("i")
                    .chain(done.keys().map(String::as_str))
                    .collect();
                let path = format!("items/{id}/params/columns/{name}/expr");
                let f = match function::Formula::compile(
                    text,
                    &names,
                    &|v| fixed.get(v).copied(),
                    &deep_canvas::expr::Nothing,
                    "expr",
                ) {
                    Ok(f) => f,
                    // A name another computed column gives is read once that column is done.
                    Err(r)
                        if computed.iter().any(|c| {
                            !done.contains_key(c) && r.why.contains(&format!("`{c}`"))
                        }) =>
                    {
                        continue
                    }
                    Err(r) => {
                        out.issues.push(err("bad_column", path, json!(r.why), "a computed column is an expression over i, n, the set's columns and its vars"));
                        failed = true;
                        break;
                    }
                };
                let vals: Vec<f64> = (0..n)
                    .map(|i| {
                        let free: Vec<f64> = std::iter::once(i as f64)
                            .chain(done.values().map(|col| col[i]))
                            .collect();
                        f.at(&free)
                    })
                    .collect();
                if vals.iter().any(|v| !v.is_finite()) {
                    out.issues.push(err(
                        "out_of_range",
                        path,
                        json!(text),
                        "a computed column gives a value that isn't finite",
                    ));
                    failed = true;
                    break;
                }
                done.insert(name.clone(), vals);
            }
            if done.len() == before && !failed {
                out.issues.push(err(
                    "bad_column",
                    format!("items/{id}/params/columns"),
                    json!(computed),
                    "computed columns read each other in a cycle",
                ));
                failed = true;
            }
        }
        if failed {
            continue;
        }
        let Some(params) = items
            .get_mut(&id)
            .and_then(|i| i.get_mut("params"))
            .and_then(Value::as_object_mut)
        else {
            continue;
        };
        params.insert("n".into(), json!(n));
        let Some(Value::Object(c)) = params.get_mut("columns") else {
            continue;
        };
        for (name, vals) in done {
            out.sums
                .insert((id.clone(), name.clone()), vals.iter().sum());
            let bytes: Vec<u8> = vals.iter().flat_map(|v| v.to_le_bytes()).collect();
            c.insert(
                name,
                json!({"dtype": "f64", "len": n, "data": deep_canvas::base64::encode(&bytes)}),
            );
        }
    }
}
