//! Paints as Lottie's fills, strokes and gradients: a role's color from the look, and a gradient
//! in OKLab as an sRGB ramp with stops added until it stays within the ramp tolerance of the
//! OKLab ramp (the marks crate's own dense ramp, 0.001 ΔEOK, inside the export's 0.01).

use deep_canvas_marks::paint::dense;
use serde_json::{json, Map, Value};

use super::keys::{num, nums, Prop};
use super::layers;
use super::Ctx;

/// A role's color as Lottie writes it: sRGB in 0..1 with alpha 1.
fn role_color(ctx: &Ctx, role: &str) -> Option<[f64; 4]> {
    let c = ctx.palette.get(role)?;
    Some([
        f64::from(c[0]) / 255.0,
        f64::from(c[1]) / 255.0,
        f64::from(c[2]) / 255.0,
        1.0,
    ])
}

/// The fill and stroke of an item's paint, in Lottie's order (stroke above fill, so the fill is
/// written after it and draws first).
pub fn paints(ctx: &mut Ctx, id: &str, item: &Value) -> Vec<Value> {
    let Some(paint) = item.pointer("/params/paint").and_then(Value::as_object) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    if let Some(Value::Object(s)) = paint.get("stroke") {
        if let Some(st) = stroke(ctx, id, item, s) {
            out.push(st);
        }
    }
    if let Some(Value::Object(f)) = paint.get("fill") {
        if let Some(fl) = fill(ctx, id, item, f) {
            out.push(fl);
        }
    }
    out
}

fn opacity_prop(ctx: &mut Ctx, id: &str, slot: &str) -> Prop {
    let p = format!("/params/paint/{slot}/opacity");
    let all = "/params/paint/opacity";
    let read = move |i: &Value| {
        let a = i.pointer(&p).and_then(Value::as_f64).unwrap_or(1.0);
        let b = i.pointer(all).and_then(Value::as_f64).unwrap_or(1.0);
        Some(vec![a * b * 100.0])
    };
    let map = |v: &[f64]| vec![v[0] * 100.0];
    let field: Vec<&str> = vec!["params", "paint", slot, "opacity"];
    layers::prop(
        ctx,
        id,
        &format!("params/paint/{slot}/opacity"),
        &read,
        &[(&field, &map)],
    )
}

fn fill(ctx: &mut Ctx, id: &str, item: &Value, f: &Map<String, Value>) -> Option<Value> {
    let o = opacity_prop(ctx, id, "fill");
    if let Some(g) = f.get("gradient").and_then(Value::as_object) {
        let mut v = gradient(ctx, item, g)?;
        v.insert("ty".into(), json!("gf"));
        v.insert("o".into(), o.json(true));
        v.insert("r".into(), json!(1));
        return Some(Value::Object(v));
    }
    let role = f.get("role").and_then(Value::as_str).unwrap_or("ink");
    let c = role_color(ctx, role)?;
    Some(json!({"ty": "fl", "nm": "fill", "c": {"a": 0, "k": nums(&c)}, "o": o.json(true), "r": 1}))
}

fn stroke(ctx: &mut Ctx, id: &str, item: &Value, s: &Map<String, Value>) -> Option<Value> {
    let o = opacity_prop(ctx, id, "stroke");
    let read = |i: &Value| {
        Some(vec![i
            .pointer("/params/paint/stroke/width")
            .and_then(Value::as_f64)
            .unwrap_or(1.0)])
    };
    let map = |v: &[f64]| vec![v[0]];
    let w = layers::prop(
        ctx,
        id,
        "params/paint/stroke/width",
        &read,
        &[(&["params", "paint", "stroke", "width"], &map)],
    );
    // The 2D stroke draws butt ends and miter joins up to its miter limit (Paint: `miter_limit`),
    // whatever else a stroke names, so the file draws the same.
    let (lc, lj) = (1, 1);
    let ml = s.get("miter_limit").and_then(Value::as_f64).unwrap_or(4.0);
    let mut v = if let Some(g) = s.get("gradient").and_then(Value::as_object) {
        let mut v = gradient(ctx, item, g)?;
        v.insert("ty".into(), json!("gs"));
        v
    } else {
        let role = s.get("role").and_then(Value::as_str).unwrap_or("ink");
        let c = role_color(ctx, role)?;
        let mut v = Map::new();
        v.insert("ty".into(), json!("st"));
        v.insert("nm".into(), json!("stroke"));
        v.insert("c".into(), json!({"a": 0, "k": nums(&c)}));
        v
    };
    v.insert("o".into(), o.json(true));
    v.insert("w".into(), w.json(true));
    v.insert("lc".into(), json!(lc));
    v.insert("lj".into(), json!(lj));
    v.insert("ml".into(), num(ml));
    Some(Value::Object(v))
}

/// A linear or radial gradient across the item's own box, its stops densified so the sRGB ramp
/// Lottie interpolates stays on the OKLab one.
fn gradient(ctx: &Ctx, item: &Value, g: &Map<String, Value>) -> Option<Map<String, Value>> {
    let kind_name = item.get("kind").and_then(Value::as_str).unwrap_or("");
    let params = item.get("params").and_then(Value::as_object)?;
    // The gradient's box: the item's own, before its place (the layer's transform places it).
    let b = deep_canvas_marks::relations::own_box(kind_name, params)?;
    gradient_in(ctx, g, b)
}

/// [`gradient`] across box `b`.
pub(crate) fn gradient_in(
    ctx: &Ctx,
    g: &Map<String, Value>,
    b: [f64; 4],
) -> Option<Map<String, Value>> {
    let kind = g.get("kind").and_then(Value::as_str).unwrap_or("linear");
    let t = match kind {
        "linear" => 1,
        "radial" => 2,
        _ => return None,
    };
    let stops: Vec<(f64, [u8; 3], f64)> = g
        .get("stops")?
        .as_array()?
        .iter()
        .map(|s| {
            let at = s.get("at").and_then(Value::as_f64)?;
            let role = s.get("role").and_then(Value::as_str)?;
            let c = *ctx.palette.get(role)?;
            Some((
                at,
                c,
                s.get("opacity").and_then(Value::as_f64).unwrap_or(1.0),
            ))
        })
        .collect::<Option<_>>()?;
    let ramp = dense(&stops);
    let point = |v: Option<&Value>, d: [f64; 2]| -> [f64; 2] {
        let f = match v {
            Some(Value::Array(a)) => [
                a.first().and_then(Value::as_f64).unwrap_or(d[0]),
                a.get(1).and_then(Value::as_f64).unwrap_or(d[1]),
            ],
            Some(Value::String(s)) => deep_canvas_marks::relations::Point::parse(s)
                .map(|p| {
                    let q = p.of([0.0, 0.0, 1.0, 1.0]);
                    [q[0], q[1]]
                })
                .unwrap_or(d),
            _ => d,
        };
        [b[0] + f[0] * b[2], b[1] + f[1] * b[3]]
    };
    let (from, to) = if t == 1 {
        ([0.0, 0.5], [1.0, 0.5])
    } else {
        ([0.5, 0.5], [1.0, 0.5])
    };
    let s = point(g.get("from"), from);
    let e = point(g.get("to"), to);
    let mut colors: Vec<f64> = Vec::new();
    for (at, c, _) in &ramp {
        colors.extend([*at, c[0], c[1], c[2]]);
    }
    let alpha = ramp.iter().any(|(_, _, a)| *a < 1.0);
    if alpha {
        for (at, _, a) in &ramp {
            colors.extend([*at, *a]);
        }
    }
    let mut v = Map::new();
    v.insert("nm".into(), json!("gradient"));
    v.insert("s".into(), json!({"a": 0, "k": nums(&s)}));
    v.insert("e".into(), json!({"a": 0, "k": nums(&e)}));
    v.insert("t".into(), json!(t));
    v.insert(
        "g".into(),
        json!({"p": ramp.len(), "k": {"a": 0, "k": nums(&colors)}}),
    );
    Some(v)
}
