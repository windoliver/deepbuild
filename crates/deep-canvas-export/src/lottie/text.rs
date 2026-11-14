//! Text as glyph outlines (Export: Lottie): Lottie 1.0.1 defines no text layer, so a text item
//! exports as one group per unit its animators address (grapheme, word or line), each holding
//! that unit's glyph outlines, its position and opacity keyed at each export frame where an
//! animator moves it, each such key listed as sampled. The glyphs come from the frames as they
//! draw them: the host reads each frame's shaped runs and animated units.

use std::collections::BTreeMap;

use deep_canvas_marks::path::Verb;
use serde_json::{json, Map, Value};

use super::keys::{self, nums, Made};
use super::{shapes, Ctx, Warning};

/// One glyph as a frame draws it: its unit's grapheme, its outline about its own origin (y
/// down), where that origin sits in the document, its opacity and its color.
#[derive(Clone, Debug, PartialEq)]
pub struct Glyph {
    pub grapheme: usize,
    pub outline: Vec<Verb>,
    pub at: [f64; 2],
    pub opacity: f64,
    pub color: [u8; 3],
}

/// Each export frame's glyphs, by text item.
pub type Texts = Vec<BTreeMap<String, Vec<Glyph>>>;

/// The unit each grapheme belongs to: itself, its word or its line, as the item's animators
/// address them (the finest unit any animator names).
fn units(item: &Value, shown: &str, glyphs: &[Glyph]) -> Vec<usize> {
    let names: Vec<&str> = item
        .pointer("/params/animators")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|a| {
            a.get("units")
                .or_else(|| a.get("unit"))
                .and_then(Value::as_str)
        })
        .collect();
    let unit = if names.is_empty() || names.iter().any(|n| n.starts_with("grapheme")) {
        "grapheme"
    } else if names.contains(&"word") {
        "word"
    } else {
        "line"
    };
    // Each grapheme's word and line, counted through the shown text.
    let mut word_of = Vec::new();
    let mut line_of = Vec::new();
    let (mut w, mut l, mut in_space) = (0usize, 0usize, false);
    for c in shown.chars() {
        if c == '\n' {
            l += 1;
        }
        let space = c.is_whitespace();
        if space && !in_space {
            w += 1;
        }
        in_space = space;
        word_of.push(w);
        line_of.push(l);
    }
    glyphs
        .iter()
        .map(|g| match unit {
            "word" => word_of.get(g.grapheme).copied().unwrap_or(0),
            "line" => line_of.get(g.grapheme).copied().unwrap_or(0),
            _ => g.grapheme,
        })
        .collect()
}

pub(crate) fn layer(
    ctx: &mut Ctx,
    id: &str,
    item: &Value,
    masked: bool,
) -> Option<Map<String, Value>> {
    let frames: Vec<Vec<Glyph>> = ctx
        .texts
        .iter()
        .map(|f| f.get(id).cloned().unwrap_or_default())
        .collect();
    let first = frames.first()?.clone();
    if first.is_empty() {
        return None;
    }
    if frames.iter().any(|f| f.len() != first.len()) {
        ctx.warnings.push(Warning::cant_hold(
            id,
            "a text whose glyphs change over time".into(),
            format!("items/{id}/params/text"),
        ));
        return None;
    }
    // The item's own place at each frame (its position, turn and scale): the layer carries it, and
    // each glyph group sits where its glyph draws within it.
    let place: Vec<([f64; 2], f64, [f64; 2])> = ctx
        .evals
        .iter()
        .map(|items| {
            let i = items.get(id);
            let at = |k: &str, n: usize, d: f64| {
                i.and_then(|i| i.pointer(&format!("/at/{k}/{n}")))
                    .and_then(Value::as_f64)
                    .unwrap_or(d)
            };
            (
                [at("pos", 0, 0.0), at("pos", 1, 0.0)],
                at("rot", 2, 0.0),
                [at("scale", 0, 1.0), at("scale", 1, 1.0)],
            )
        })
        .collect();
    let local = |j: usize, w: [f64; 2]| -> [f64; 2] {
        let (p, r, s) = place
            .get(j)
            .copied()
            .unwrap_or(([0.0, 0.0], 0.0, [1.0, 1.0]));
        let (c, n) = (
            deep_canvas::ops::cos(deep_canvas::ops::rad(r)),
            deep_canvas::ops::sin(deep_canvas::ops::rad(r)),
        );
        let (dx, dy) = (w[0] - p[0], w[1] - p[1]);
        let (x, y) = (c * dx + n * dy, -n * dx + c * dy);
        [
            x / if s[0] == 0.0 { 1.0 } else { s[0] },
            y / if s[1] == 0.0 { 1.0 } else { s[1] },
        ]
    };
    let shown = item
        .pointer("/params/text")
        .and_then(Value::as_str)
        .unwrap_or("");
    let unit_of = units(item, shown, &first);
    let mut by_unit: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (k, u) in unit_of.iter().enumerate() {
        by_unit.entry(*u).or_default().push(k);
    }
    let mut groups = Vec::new();
    for (u, members) in &by_unit {
        let lead = members[0];
        let p: Vec<Vec<f64>> = frames
            .iter()
            .enumerate()
            .map(|(j, f)| local(j, f[lead].at).to_vec())
            .collect();
        let r: Vec<Vec<f64>> = place.iter().map(|x| vec![-x.1]).collect();
        let s: Vec<Vec<f64>> = place
            .iter()
            .map(|x| {
                vec![
                    100.0 / if x.2[0] == 0.0 { 1.0 } else { x.2[0] },
                    100.0 / if x.2[1] == 0.0 { 1.0 } else { x.2[1] },
                ]
            })
            .collect();
        let o: Vec<Vec<f64>> = frames
            .iter()
            .map(|f| vec![f[lead].opacity * 100.0])
            .collect();
        let (pp, pm) = keys::choose(&p, None);
        let (rp, _) = keys::choose(&r, None);
        let (sp, _) = keys::choose(&s, None);
        let (op, om) = keys::choose(&o, None);
        if pm == Made::Sampled || om == Made::Sampled {
            ctx.sampled(id, "params/animators");
        }
        let mut it = Vec::new();
        let origin = first[lead].at;
        for &k in members {
            let g = &first[k];
            let d = [g.at[0] - origin[0], g.at[1] - origin[1]];
            let verbs: Vec<Verb> = g
                .outline
                .iter()
                .map(|v| shapes::place(*v, [1.0, 1.0], d))
                .collect();
            for (n, path) in shapes::lottie_paths(&verbs).into_iter().enumerate() {
                it.push(json!({"ty": "sh", "nm": format!("{id}.glyph.{k}.{n}"), "ks": {"a": 0, "k": path.json()}}));
            }
        }
        it.extend(fill(ctx, item, &first[lead], &first, origin));
        it.push(json!({"ty": "tr", "nm": "transform", "p": pp.json(false), "a": {"a": 0, "k": [0, 0]}, "s": sp.json(false),
            "r": rp.json(true), "o": op.json(true), "sk": {"a": 0, "k": 0}, "sa": {"a": 0, "k": 0}}));
        let np = it.len();
        groups.push(json!({"ty": "gr", "nm": format!("{id}.unit.{u}"), "np": np, "it": it}));
    }
    let name = super::layers::name_of(item, id);
    let all = super::shapes::copies_below(
        ctx,
        id,
        item,
        &[
            json!({"ty": "gr", "nm": name, "np": groups.len() + 1, "it": groups.iter().cloned().chain([super::shapes::identity()]).collect::<Vec<_>>()}),
        ],
    );
    groups.extend(all);
    let mut l = super::layers::base(&name, 4, ctx.frames.n);
    let ks = super::layers::transform(ctx, id, item, false);
    let ks = super::layers::placed_on(&mut l, ks, groups, masked, &name);
    l.insert("ks".into(), Value::Object(ks));
    Some(l)
}

/// A unit's fill: its glyphs' color, or the text's gradient across the whole run, placed in the
/// unit's own coordinates (its lead glyph's origin).
fn fill(ctx: &Ctx, item: &Value, lead: &Glyph, all: &[Glyph], origin: [f64; 2]) -> Vec<Value> {
    if let Some(g) = item
        .pointer("/params/paint/fill/gradient")
        .and_then(Value::as_object)
    {
        if let Some(b) = bounds(all) {
            let local = [b[0] - origin[0], b[1] - origin[1], b[2], b[3]];
            if let Some(mut v) = super::paint::gradient_in(ctx, g, local) {
                v.insert("ty".into(), json!("gf"));
                v.insert("o".into(), json!({"a": 0, "k": 100}));
                v.insert("r".into(), json!(1));
                return vec![Value::Object(v)];
            }
        }
    }
    let c = lead.color;
    let color = [
        f64::from(c[0]) / 255.0,
        f64::from(c[1]) / 255.0,
        f64::from(c[2]) / 255.0,
        1.0,
    ];
    vec![
        json!({"ty": "fl", "nm": "fill", "c": {"a": 0, "k": nums(&color)}, "o": {"a": 0, "k": 100}, "r": 1}),
    ]
}

/// Where a frame's glyphs draw, in document units.
pub fn bounds(glyphs: &[Glyph]) -> Option<[f64; 4]> {
    let mut b: Option<[f64; 4]> = None;
    for g in glyphs {
        let verbs: Vec<Verb> = g
            .outline
            .iter()
            .map(|v| shapes::place(*v, [1.0, 1.0], g.at))
            .collect();
        if let Some(x) = deep_canvas_marks::relations::tight(&verbs) {
            b = Some(b.map_or(x, |a| super::union(a, x)));
        }
    }
    b
}
