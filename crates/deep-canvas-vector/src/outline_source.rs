//! Issue #443: vector's entry of the core's `outline.source@1` (canvas primitives: Builder
//! `extrude`: outlines from text, paths and SVG): an SVG's filled elements, or one part's, as
//! closed contours in meters, each element a fill of its own by its own `fill-rule`, set so the
//! box is `size` tall and centered on the origin, y up. An element with a stroke and no fill is
//! refused, naming it.

use deep_canvas::outline::{Contour, Outlines, Refusal, Request};
use deep_canvas_marks::outline_sources::{boxed, flatten_verbs};
use serde_json::{json, Value};

use crate::svg::{self, Svg};

fn refusal(code: &'static str, path: impl Into<String>, what: &str) -> Refusal {
    Refusal {
        code,
        path: path.into(),
        what: what.into(),
    }
}

/// The SVG a vector item names: inlined by the store's holder (`params.outline.svg`, #1162), or
/// read from the store by its sha256.
fn svg_of(id: &str, item: &Value, bytes: &dyn Fn(&str) -> Option<Vec<u8>>) -> Result<Svg, Refusal> {
    let params = item.get("params").cloned().unwrap_or(json!({}));
    let found = match params.pointer("/outline/svg").and_then(Value::as_str) {
        Some(text) => Some(text.as_bytes().to_vec()),
        None => params.get("src").and_then(Value::as_str).and_then(bytes),
    }
    .ok_or_else(|| {
        refusal(
            "asset_missing",
            format!("items/{id}/params/src"),
            "no stored SVG",
        )
    })?;
    let classes: Vec<String> = params
        .get("parts")
        .and_then(Value::as_array)
        .map(|c| {
            c.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    svg::import(&found, &classes, svg::Twin::Honest)
        .map_err(|r| refusal("asset_missing", format!("items/{id}/params/src"), r.what()))
}

/// An SVG's contours, and for each one the fill it belongs to and that fill's rule.
pub type Contours = (
    Vec<Vec<[f64; 2]>>,
    Vec<(usize, deep_canvas::outline::FillRule)>,
);

/// The contours of `svg`'s filled elements (in `part` alone, when named), each its own fill,
/// within `tol` viewBox units; or the first stroked element with no fill.
pub fn contours(svg: &Svg, part: Option<usize>, tol: f64) -> Result<Contours, usize> {
    let mut rings = Vec::new();
    let mut fills = Vec::new();
    let mut k = 0;
    for (j, p) in svg.paths.iter().enumerate() {
        if part.is_some_and(|of| !crate::lower::within(svg, p.part, of)) {
            continue;
        }
        if p.fill.is_none() {
            return Err(j);
        }
        for r in flatten_verbs(&p.verbs, tol) {
            rings.push(r);
            fills.push((k, p.fill_rule));
        }
        k += 1;
    }
    Ok((rings, fills))
}

/// The name a refusal gives an element: its part's id, or its place in paint order.
fn element(svg: &Svg, j: usize) -> String {
    match svg.paths[j].part {
        Some(p) => format!("#{}", svg.parts[p].id),
        None => format!("element {j}"),
    }
}

/// vector's entry.
pub fn vector_fill(r: &Request<'_>) -> Result<Outlines, Refusal> {
    let named = r
        .outline
        .get("vector")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            refusal(
                "out_of_range",
                "params/outline/vector",
                "a vector outline names a vector",
            )
        })?;
    let (id, part) = match named.split_once('#') {
        Some((id, part)) => (id, Some(part)),
        None => (named, None),
    };
    let item = r
        .doc
        .pointer(&format!("/items/{id}"))
        .filter(|i| i.get("kind").and_then(Value::as_str) == Some("vector@1"))
        .ok_or_else(|| {
            refusal(
                "ref_unresolved",
                "params/outline/vector",
                "no vector@1 by that ID",
            )
        })?;
    let svg = svg_of(id, item, r.bytes)?;
    let part =
        match part {
            None => None,
            Some(p) => Some(svg.parts.iter().position(|q| q.id == p).ok_or_else(|| {
                refusal("ref_unresolved", "params/outline/vector", "no such part")
            })?),
        };
    let vh = svg.view_box[3].max(1e-12);
    let stroked = |j: usize| {
        refusal(
            "outline.stroke",
            format!("items/{id}/{}", element(&svg, j)),
            "an SVG element with a stroke and no fill gives no outline",
        )
    };
    // The box first, finely; then flattened within flatten × size, in viewBox units.
    let (rough, _) = contours(&svg, part, vh * 1e-5).map_err(stroked)?;
    let (_, k, _) = boxed(&rough, r.size);
    let (rings, fills) =
        contours(&svg, part, r.flatten * r.size / k.max(1e-12)).map_err(stroked)?;
    let (rings, _, _) = boxed(&rings, r.size);
    let mut rules = Vec::new();
    let mut out = Vec::new();
    for (points, (fill, rule)) in rings.into_iter().zip(fills) {
        while rules.len() <= fill {
            rules.push(rule);
        }
        out.push(Contour {
            points,
            of: named.to_string(),
            fill,
        });
    }
    Ok(Outlines {
        contours: out,
        rules,
    })
}

/// The ring the kit holds vector's entry to: a circle with a smaller one cut out by evenodd.
pub const RING_SVG: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#000" fill-rule="evenodd" d="M50 5 C74.85 5 95 25.15 95 50 C95 74.85 74.85 95 50 95 C25.15 95 5 74.85 5 50 C5 25.15 25.15 5 50 5 Z M50 25 C63.81 25 75 36.19 75 50 C75 63.81 63.81 75 50 75 C36.19 75 25 63.81 25 50 C25 36.19 36.19 25 50 25 Z"/></svg>"##;

/// vector's kit fixture: the ring's outline at 1 m and flatten 0.001 against its own curves
/// flattened finely, as the 2D fill draws them, both evenodd.
pub fn fixture() -> Value {
    let svg = svg::import(RING_SVG.as_bytes(), &[], svg::Twin::Honest).expect("the ring imports");
    let (fine, _) = contours(&svg, None, 1e-4).expect("the ring fills");
    let (_, k, _) = boxed(&fine, 1.0);
    let (rings, _) = contours(&svg, None, 0.001 / k).expect("the ring fills");
    let (rings, _, _) = boxed(&rings, 1.0);
    let (fine, _, _) = boxed(&fine, 1.0);
    deep_canvas_marks::outline_sources::fixture(
        "ring",
        &rings,
        svg.paths[0].fill_rule,
        &fine,
        svg.paths[0].fill_rule,
        0.001,
    )
}
