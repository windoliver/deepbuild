//! Issue #443: text's and marks2d's entries of the core's `outline.source@1` (canvas primitives:
//! Builder `extrude`: outlines from text, paths and SVG). Text shapes `{text}` with the one shaper,
//! as text@1 does, and reads the run's glyph outlines; marks2d reads a path@1 item's own outline.
//! Both flatten within `flatten` × `size` and hand the contours back in meters, y up.

use deep_canvas::outline::{Contour, FillRule, Flattener, Outlines, Refusal, Request};
use deep_text::outlines::Cmd;
use serde_json::{json, Map, Value};

use crate::path::Verb;

fn refusal(code: &'static str, path: impl Into<String>, what: &str) -> Refusal {
    Refusal {
        code,
        path: path.into(),
        what: what.into(),
    }
}

/// The string a `{text}` outline shows: its own, or its copy key's in the document's copy table.
fn text_of(o: &Value, doc: &Value) -> Result<String, Refusal> {
    match o.get("text") {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(Value::Object(c)) => {
            let key = c.get("copy").and_then(Value::as_str).unwrap_or_default();
            doc.pointer(&format!("/copy/{key}"))
                .and_then(|v| v.as_str().or_else(|| v.get("text").and_then(Value::as_str)))
                .map(str::to_string)
                .ok_or_else(|| refusal("ref_unresolved", "params/outline/text/copy", "no copy key"))
        }
        _ => Err(refusal(
            "out_of_range",
            "params/outline/text",
            "a text outline names its text",
        )),
    }
}

/// The glyph outlines of a `{text}` outline's run, shaped as the same text in a 2D writer layer
/// at `size` (a pixel of the run is a meter of the title), each glyph's commands y down from the
/// first baseline, set by `align` about x = 0. `own_advance` is
/// #443's planted extrude, which sets each glyph at the sum of the advances before it, unkerned.
pub fn glyph_run(
    o: &Value,
    doc: &Value,
    size: f64,
    own_advance: bool,
) -> Result<Vec<deep_text::outlines::GlyphOutline>, Refusal> {
    let text = text_of(o, doc)?;
    let mut params = Map::new();
    params.insert("text".into(), json!(text));
    params.insert("size".into(), json!(size));
    for k in ["font", "weight", "lang"] {
        if let Some(v) = o.get(k) {
            params.insert(k.into(), v.clone());
        }
    }
    let spec = crate::scene::text_spec("outline", &params, None).map_err(|_| {
        refusal(
            "out_of_range",
            "params/outline/text",
            "a text outline it can't set",
        )
    })?;
    let shaper_spec = spec.shaper_spec().ok_or_else(|| {
        refusal(
            "out_of_range",
            "params/outline/font",
            "a font role the look lacks",
        )
    })?;
    let mut shaper = deep_text::Shaper::new();
    let missing = shaper.missing(&shaper_spec, &text);
    if let Some(g) = missing.first() {
        return Err(refusal("text.glyph_missing", "params/outline/text", g));
    }
    let run = shaper.shape(&shaper_spec);
    let shift = match o.get("align").and_then(Value::as_str).unwrap_or("center") {
        "start" => 0.0,
        "end" => -f64::from(run.width),
        "center" => -f64::from(run.width) / 2.0,
        _ => {
            return Err(refusal(
                "out_of_range",
                "params/outline/align",
                "start, center or end",
            ))
        }
    };
    let mut glyphs = deep_text::outlines::glyph_outlines(&run);
    let mut pen = 0.0;
    for g in &mut glyphs {
        let mut shift = shift;
        if own_advance {
            // Each glyph where its own advances alone would set it.
            shift += pen - g.origin[0];
            let mut alone = shaper_spec.clone();
            alone.text = &g.grapheme;
            pen += f64::from(shaper.shape(&alone).width);
        }
        g.origin[0] += shift;
        for c in &mut g.cmds {
            let at = |p: &mut [f64; 2]| p[0] += shift;
            match c {
                Cmd::Move(p) | Cmd::Line(p) => at(p),
                Cmd::Quad(a, p) => {
                    at(a);
                    at(p);
                }
                Cmd::Cubic(a, b, p) => {
                    at(a);
                    at(b);
                    at(p);
                }
                Cmd::Close => {}
            }
        }
    }
    Ok(glyphs)
}

/// One glyph's commands flattened within `tol` em pixels, scaled by `k` meters a pixel, y up.
pub fn flatten_glyph(cmds: &[Cmd], tol: f64, k: f64) -> Vec<Vec<[f64; 2]>> {
    let mut f = Flattener::new(tol);
    for c in cmds {
        match *c {
            Cmd::Move(p) => f.move_to(p),
            Cmd::Line(p) => f.line_to(p),
            Cmd::Quad(a, p) => f.quad_to(a, p),
            Cmd::Cubic(a, b, p) => f.cubic_to(a, b, p),
            Cmd::Close => f.close(),
        }
    }
    f.finish()
        .into_iter()
        .map(|c| c.into_iter().map(|p| [p[0] * k, -p[1] * k]).collect())
        .collect()
}

/// Text's entry: a shaped run's glyph outlines, nonzero, each contour named by its glyph's place
/// in the run and what it draws (`glyph<k> <grapheme>`).
pub fn text_fill(r: &Request<'_>) -> Result<Outlines, Refusal> {
    let own = r.planted == Some("extrude_own_advance");
    let glyphs = glyph_run(r.outline, r.doc, r.size, own)?;
    let mut contours = Vec::new();
    for (k, g) in glyphs.iter().enumerate() {
        for points in flatten_glyph(&g.cmds, r.flatten * r.size, 1.0) {
            contours.push(Contour {
                points,
                of: format!("glyph{k} {}", g.grapheme),
                fill: 0,
            });
        }
    }
    Ok(Outlines {
        contours,
        rules: vec![FillRule::NonZero],
    })
}

/// A path@1's verbs: from `d`, or from `verbs` and `pts`.
pub fn path_verbs(params: &Value) -> Option<Vec<Verb>> {
    if let Some(d) = params.get("d").and_then(Value::as_str) {
        return crate::path::parse(d);
    }
    let verbs = params.get("verbs")?.as_array()?;
    let pts: Vec<f64> = params
        .get("pts")?
        .as_array()?
        .iter()
        .map(Value::as_f64)
        .collect::<Option<_>>()?;
    let mut at = 0;
    let mut take = |n: usize| -> Option<Vec<[f64; 2]>> {
        let out = (0..n)
            .map(|j| Some([*pts.get(at + 2 * j)?, *pts.get(at + 2 * j + 1)?]))
            .collect();
        at += 2 * n;
        out
    };
    verbs
        .iter()
        .map(|v| {
            let v = v.as_str().map(str::to_string).or_else(|| {
                v.as_u64().and_then(|n| {
                    ["M", "L", "Q", "C", "Z"]
                        .get(n as usize)
                        .map(|s| s.to_string())
                })
            })?;
            Some(match v.as_str() {
                "M" => Verb::Move(take(1)?[0]),
                "L" => Verb::Line(take(1)?[0]),
                "Q" => {
                    let p = take(2)?;
                    Verb::Quad(p[0], p[1])
                }
                "C" => {
                    let p = take(3)?;
                    Verb::Cubic(p[0], p[1], p[2])
                }
                "Z" => Verb::Close,
                _ => return None,
            })
        })
        .collect()
}

/// Verbs flattened within `tol` of their own units.
pub fn flatten_verbs(verbs: &[Verb], tol: f64) -> Vec<Vec<[f64; 2]>> {
    let mut f = Flattener::new(tol);
    for v in verbs {
        match *v {
            Verb::Move(p) => f.move_to(p),
            Verb::Line(p) => f.line_to(p),
            Verb::Quad(a, p) => f.quad_to(a, p),
            Verb::Cubic(a, b, p) => f.cubic_to(a, b, p),
            Verb::Close => f.close(),
        }
    }
    f.finish()
}

/// Contours in their own units (y down) set so their box is `size` meters tall, centered on the
/// origin, y up; and the scale that took.
pub fn boxed(rings: &[Vec<[f64; 2]>], size: f64) -> (Vec<Vec<[f64; 2]>>, f64, [f64; 2]) {
    let (mut lo, mut hi) = ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]);
    for p in rings.iter().flatten() {
        for i in 0..2 {
            lo[i] = lo[i].min(p[i]);
            hi[i] = hi[i].max(p[i]);
        }
    }
    let k = size / (hi[1] - lo[1]).max(1e-12);
    let c = [(lo[0] + hi[0]) / 2.0, (lo[1] + hi[1]) / 2.0];
    let out = rings
        .iter()
        .map(|r| {
            r.iter()
                .map(|p| [(p[0] - c[0]) * k, -(p[1] - c[1]) * k])
                .collect()
        })
        .collect();
    (out, k, c)
}

/// A path's fill rule.
pub fn rule_of(params: &Value) -> FillRule {
    match params.get("fill_rule").and_then(Value::as_str) {
        Some("evenodd") => FillRule::EvenOdd,
        _ => FillRule::NonZero,
    }
}

/// marks2d's entry: a path@1 item's outline, by its own fill rule; one with a stroke and no
/// fill is refused, naming it.
pub fn path_fill(r: &Request<'_>) -> Result<Outlines, Refusal> {
    let id = r
        .outline
        .get("path")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            refusal(
                "out_of_range",
                "params/outline/path",
                "a path outline names a path",
            )
        })?;
    let item = r
        .doc
        .pointer(&format!("/items/{id}"))
        .filter(|i| i.get("kind").and_then(Value::as_str) == Some("path@1"))
        .ok_or_else(|| {
            refusal(
                "ref_unresolved",
                "params/outline/path",
                "no path@1 by that ID",
            )
        })?;
    let params = item.get("params").cloned().unwrap_or(json!({}));
    let paint = params.get("paint");
    if paint.and_then(|p| p.get("fill")).is_none() && paint.and_then(|p| p.get("stroke")).is_some()
    {
        return Err(refusal(
            "outline.stroke",
            format!("items/{id}"),
            "a stroke with no fill gives no outline",
        ));
    }
    let verbs = path_verbs(&params).ok_or_else(|| {
        refusal(
            "out_of_range",
            format!("items/{id}/params/d"),
            "a path it can't read",
        )
    })?;
    // Flattened in its own units first, finely, to find its box; then again within flatten.
    let rough = flatten_verbs(&verbs, 1e-3);
    let (_, k, _) = boxed(&rough, r.size);
    let rings = flatten_verbs(&verbs, r.flatten * r.size / k.max(1e-12));
    let (rings, _, _) = boxed(&rings, r.size);
    Ok(Outlines {
        contours: rings
            .into_iter()
            .map(|points| Contour {
                points,
                of: id.to_string(),
                fill: 0,
            })
            .collect(),
        rules: vec![rule_of(&params)],
    })
}

/// A fixture for the registry's kit: an outline and the 2D fill it must cover, as contours with
/// their rule, and the tolerance (flatten × size).
pub fn fixture(
    name: &str,
    outline: &[Vec<[f64; 2]>],
    rule: FillRule,
    fill: &[Vec<[f64; 2]>],
    fill_rule: FillRule,
    tol: f64,
) -> Value {
    json!({"name": name, "tolerance": tol,
           "outline": {"rule": rule.name(), "contours": outline},
           "fill2d": {"rule": fill_rule.name(), "contours": fill}})
}

/// Text's kit fixture: the glyph outlines of "OB" in the body font at 1 m and flatten 0.001,
/// against the glyphs' own curves flattened a hundred times finer, as the 2D fill draws them.
pub fn text_fixture() -> Value {
    let doc = json!({});
    let glyphs =
        glyph_run(&json!({"text": "OB", "size": 1.0}), &doc, 1.0, false).expect("OB shapes");
    let (mut outline, mut fill) = (Vec::new(), Vec::new());
    for g in &glyphs {
        outline.extend(flatten_glyph(&g.cmds, 0.001, 1.0));
        fill.extend(flatten_glyph(&g.cmds, 0.00001, 1.0));
    }
    fixture(
        "OB",
        &outline,
        FillRule::NonZero,
        &fill,
        FillRule::NonZero,
        0.001,
    )
}

/// marks2d's kit fixture: a path@1 square with a square hole, evenodd, at 1 m.
pub fn path_fixture() -> Value {
    let params = json!({"d": "M0 0 L10 0 L10 10 L0 10 Z M3 3 L7 3 L7 7 L3 7 Z", "fill_rule": "evenodd",
                        "paint": {"fill": {"role": "ink"}}});
    let doc = json!({"items": {"logo": {"kind": "path@1", "params": params}}});
    let none = |_: &str| None;
    let r = Request {
        outline: &json!({"path": "logo", "size": 1.0}),
        size: 1.0,
        flatten: 0.001,
        doc: &doc,
        bytes: &none,
        planted: None,
    };
    let o = path_fill(&r).expect("the fixture path reads");
    let rings: Vec<Vec<[f64; 2]>> = o.contours.into_iter().map(|c| c.points).collect();
    let verbs = path_verbs(&params).expect("verbs");
    let (fill, _, _) = boxed(&flatten_verbs(&verbs, 1e-6), 1.0);
    fixture(
        "square_hole",
        &rings,
        o.rules[0],
        &fill,
        rule_of(&params),
        0.001,
    )
}
