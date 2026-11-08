//! A `vector@1` item drawn as marks2d's own items (canvas primitives: Vector and formula
//! `vector@1`: "Imported once into path and paint marks"): from the item as evaluated at a time,
//! one group for the item, a group for each part (its opacity) and a path for each drawn
//! element, painted by the roles `colors` maps its colors to, placed by the item's size and
//! `at.pos`, every one in the item's layer and at its order, so a part never draws outside its
//! item's draw order. A path in a clip region draws inside a shape mask for each region it sits
//! in (a hidden path its outline), with a group at the region's opacity (#1175). `write_on`
//! draws each term outline first, then fill.

use std::collections::BTreeMap;

use deep_canvas_marks::path::{self, Verb};
use serde_json::{json, Map, Value};

use crate::svg::{self, Affine, Color, Svg};

/// Why a vector can't be drawn from its params: the path that names it and what it found.
#[derive(Clone, Debug, PartialEq)]
pub struct Unmapped {
    pub path: String,
    pub color: String,
}

/// `colors` read: each SVG color, parsed, to its role.
pub fn colors(id: &str, params: &Map<String, Value>) -> Result<BTreeMap<Color, String>, Unmapped> {
    let mut out = BTreeMap::new();
    if let Some(Value::Object(map)) = params.get("colors") {
        for (key, role) in map {
            let path = format!("items/{id}/params/colors/{key}");
            let (Some(color), Some(role)) = (svg::color(key), role.as_str()) else {
                return Err(Unmapped {
                    path,
                    color: key.clone(),
                });
            };
            out.insert(color, role.to_string());
        }
    }
    Ok(out)
}

/// The role an SVG color draws in: the one `colors` maps it to, `currentColor` included, else
/// ink.
pub fn role_of(colors: &BTreeMap<Color, String>, color: Color) -> &str {
    colors.get(&color).map_or("ink", String::as_str)
}

/// The first color the SVG draws that `colors` doesn't map.
pub fn unmapped(svg: &Svg, colors: &BTreeMap<Color, String>) -> Option<String> {
    let paints = svg
        .paths
        .iter()
        .flat_map(|p| [p.fill.map(|f| f.color), p.stroke.map(|s| s.paint.color)])
        .flatten();
    for color in paints {
        if !colors.contains_key(&color) {
            return Some(match color {
                Color::Current => "currentColor".into(),
                Color::Rgb([r, g, b]) => format!("#{r:02x}{g:02x}{b:02x}"),
            });
        }
    }
    None
}

/// Where the viewBox lands in the document: scaled uniformly into the item's `size` from its
/// `at.pos`, centred on the axis it doesn't fill (SVG's `xMidYMid meet`).
pub fn placement(svg: &Svg, item: &Value) -> Affine {
    let params = item.get("params");
    let n = |v: Option<&Value>, i: usize| v.and_then(|v| v.get(i)).and_then(Value::as_f64);
    let size = params.and_then(|p| p.get("size"));
    let [vx, vy, vw, vh] = svg.view_box;
    let (w, h) = (n(size, 0).unwrap_or(vw), n(size, 1).unwrap_or(vh));
    let pos = item.get("at").and_then(|a| a.get("pos"));
    let (px, py) = (n(pos, 0).unwrap_or(0.0), n(pos, 1).unwrap_or(0.0));
    let s = (w / vw).min(h / vh);
    let (ox, oy) = (px + (w - vw * s) / 2.0, py + (h - vh * s) / 2.0);
    Affine([s, 0.0, 0.0, s, ox - vx * s, oy - vy * s])
}

/// Each part's id, its source (none from an SVG: the typeset job's probe gives it), its box and
/// its outline, in document u: the read-only per-part fields. A clipped path's box is cut to its
/// clip regions' boxes.
pub fn parts(svg: &Svg, item: &Value) -> Vec<(String, [f64; 4], Vec<Verb>)> {
    let place = placement(svg, item);
    let placed = |verbs: &[Verb]| -> Vec<Verb> { verbs.iter().map(|v| place.verb(*v)).collect() };
    svg.parts
        .iter()
        .enumerate()
        .map(|(i, part)| {
            let inside: Vec<&svg::Painted> = svg
                .paths
                .iter()
                .filter(|p| within(svg, p.part, i))
                .collect();
            let bounds =
                joined(inside.iter().filter_map(|p| drawn_box(svg, p, place))).unwrap_or([0.0; 4]);
            let verbs = inside.iter().flat_map(|p| placed(&p.verbs)).collect();
            (part.id.clone(), bounds, verbs)
        })
        .collect()
}

/// Where every path `item` draws lies, its clips applied, in document u.
pub fn bounds(svg: &Svg, item: &Value) -> Option<[f64; 4]> {
    let place = placement(svg, item);
    joined(svg.paths.iter().filter_map(|p| drawn_box(svg, p, place)))
}

/// A path's box under `place`, cut to its clip regions' boxes; `None` when they leave nothing.
fn drawn_box(svg: &Svg, path: &svg::Painted, place: Affine) -> Option<[f64; 4]> {
    let placed = |verbs: &[Verb]| -> Vec<Verb> { verbs.iter().map(|v| place.verb(*v)).collect() };
    let mut b = svg::bounds(&placed(&path.verbs))?;
    let mut clip = path.clip;
    while let Some(c) = clip {
        b = cut(b, svg::bounds(&placed(&svg.clips[c].verbs))?)?;
        clip = svg.clips[c].parent;
    }
    Some(b)
}

/// The box holding every box, if there is one.
fn joined(mut boxes: impl Iterator<Item = [f64; 4]>) -> Option<[f64; 4]> {
    let first = boxes.next()?;
    Some(boxes.fold(first, join))
}

/// Where two boxes `[x, y, w, h]` overlap, if they do.
fn cut(a: [f64; 4], b: [f64; 4]) -> Option<[f64; 4]> {
    let (x, y) = (a[0].max(b[0]), a[1].max(b[1]));
    let (r, d) = (
        (a[0] + a[2]).min(b[0] + b[2]),
        (a[1] + a[3]).min(b[1] + b[3]),
    );
    (r >= x && d >= y).then_some([x, y, r - x, d - y])
}

/// The box holding two boxes.
fn join(a: [f64; 4], b: [f64; 4]) -> [f64; 4] {
    let (x, y) = (a[0].min(b[0]), a[1].min(b[1]));
    let (r, d) = (
        (a[0] + a[2]).max(b[0] + b[2]),
        (a[1] + a[3]).max(b[1] + b[3]),
    );
    [x, y, r - x, d - y]
}

/// Whether a path in `part` sits in part `of`, directly or inside one of its parts.
pub fn within(svg: &Svg, mut part: Option<usize>, of: usize) -> bool {
    while let Some(p) = part {
        if p == of {
            return true;
        }
        part = svg.parts[p].parent;
    }
    false
}

/// What a part's channels set on it in the evaluated item: `parts/<part>/role` and `/opacity`.
fn part_field<'a>(item: &'a Value, part: &str, field: &str) -> Option<&'a Value> {
    item.get("parts")?.get(part)?.get(field)
}

/// #398's planted write: each term's fill fades in from the start of its span.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Write {
    #[default]
    Honest,
    FadesFillsFromStart,
}

/// The items `item` (as evaluated) draws as, keyed by ID: the item's own group first.
pub fn lower(
    id: &str,
    item: &Value,
    svg: &Svg,
    colors: &BTreeMap<Color, String>,
    write: Write,
) -> Vec<(String, Value)> {
    let place = placement(svg, item);
    let scale = place.scale();
    let mut out = Vec::new();
    let mut base = Map::new();
    for k in ["layer", "order", "name", "parent", "visible"] {
        if let Some(v) = item.get(k) {
            base.insert(k.into(), v.clone());
        }
    }
    let make = |kid: &str, kind: &str, parent: Option<&str>, params: Value| {
        let mut m = base.clone();
        m.insert("id".into(), json!(kid));
        m.insert("kind".into(), json!(kind));
        if let Some(p) = parent {
            m.insert("parent".into(), json!(p));
            m.remove("visible");
        }
        m.insert("params".into(), params);
        (kid.to_string(), Value::Object(m))
    };
    out.push(make(id, "group@1", None, json!({})));
    let group = |p: Option<usize>| p.map_or(id.to_string(), |p| format!("{id}.g{p}"));
    for (i, part) in svg.parts.iter().enumerate() {
        let opacity = part_field(item, &part.id, "opacity").and_then(Value::as_f64);
        let params = match opacity {
            Some(o) if o < 1.0 => json!({"opacity": o.clamp(0.0, 1.0)}),
            _ => json!({}),
        };
        out.push(make(
            &group(Some(i)),
            "group@1",
            Some(&group(part.parent)),
            params,
        ));
    }
    let terms = terms(svg);
    let n = terms.iter().copied().max().map_or(0, |t| t + 1);
    let progress = item.get("params").and_then(|p| p.get("write_on")).map(|w| {
        w.get("progress")
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
            .clamp(0.0, 1.0)
    });
    // The part and clip region the previous drawn path sat in, and the item it drew under, so a
    // run of paths in one region shares its masks.
    let mut run: Option<(Option<usize>, usize, String)> = None;
    for (j, painted) in svg.paths.iter().enumerate() {
        // The nearest part whose role a channel sets, else the SVG's own color's role; and the
        // offsets of every part it sits in, from where the import placed it.
        let mut keyed = None;
        let mut offset = [0.0, 0.0];
        let mut at = painted.part;
        while let Some(p) = at {
            let id = &svg.parts[p].id;
            if keyed.is_none() {
                keyed = part_field(item, id, "role").and_then(Value::as_str);
            }
            let by = part_field(item, id, "at");
            for (i, o) in offset.iter_mut().enumerate() {
                // A whole `at` is an array; a channel on one axis writes `at/<axis>`.
                let axis = by.and_then(|b| b.get(i).or(b.get(i.to_string())));
                *o += axis.and_then(Value::as_f64).unwrap_or(0.0);
            }
            at = svg.parts[p].parent;
        }
        let place = Affine([1.0, 0.0, 0.0, 1.0, offset[0], offset[1]]).then(&place);
        let role = |c: Color| keyed.unwrap_or_else(|| role_of(colors, c));
        let verbs: Vec<Verb> = painted.verbs.iter().map(|v| place.verb(*v)).collect();
        let fill = painted.fill.map(|f| (role(f.color), f.opacity));
        let stroke = painted
            .stroke
            .map(|s| (role(s.paint.color), s.paint.opacity, s.width * scale));
        let drawn = match progress {
            None => Drawn {
                verbs,
                fill,
                stroke,
            },
            Some(p) => match written(p, terms[j], n, write, verbs, fill, stroke) {
                Some(d) => d,
                None => continue,
            },
        };
        // An opacity on each paint keeps the path off R1's one-color path marks, which draw a
        // stroked fill in one role.
        let mut paint = Map::new();
        if let Some((role, opacity)) = drawn.fill {
            paint.insert("fill".into(), json!({"role": role, "opacity": opacity}));
        }
        if let Some((role, opacity, width)) = drawn.stroke {
            paint.insert(
                "stroke".into(),
                json!({"role": role, "opacity": opacity, "width": width}),
            );
        }
        let params = json!({"d": d_of(&drawn.verbs), "paint": paint});
        let under = match painted.clip {
            None => {
                run = None;
                group(painted.part)
            }
            Some(c) => match &run {
                Some((p, k, at)) if *p == painted.part && *k == c => at.clone(),
                _ => {
                    // The regions from the outermost in: a hidden path holds each one's outline,
                    // a shape mask clips to it, and a group draws it at its opacity.
                    let mut chain = vec![c];
                    while let Some(up) = svg.clips[chain[chain.len() - 1]].parent {
                        chain.push(up);
                    }
                    let mut at = group(painted.part);
                    for (d, k) in chain.into_iter().rev().enumerate() {
                        let region = &svg.clips[k];
                        let key = format!("{id}.p{j:05}.c{d}");
                        let verbs: Vec<Verb> =
                            region.verbs.iter().map(|v| place.verb(*v)).collect();
                        let (outline, mut hidden) = make(
                            &format!("{key}k"),
                            "path@1",
                            Some(id),
                            json!({"d": d_of(&verbs)}),
                        );
                        hidden["visible"] = json!(false);
                        out.push((outline.clone(), hidden));
                        let mask = json!({"shape": outline, "applies_to": "children"});
                        out.push(make(&key, "mask@1", Some(&at), mask));
                        at = key;
                        if region.alpha < 1.0 {
                            let alpha = json!({"opacity": region.alpha.clamp(0.0, 1.0)});
                            out.push(make(&format!("{at}a"), "group@1", Some(&at), alpha));
                            at = format!("{at}a");
                        }
                    }
                    run = Some((painted.part, c, at.clone()));
                    at
                }
            },
        };
        out.push(make(
            &format!("{id}.p{j:05}"),
            "path@1",
            Some(&under),
            params,
        ));
    }
    out
}

/// A vector item's whole outline in its own units (its `at` left out), every path at full
/// write, each part's outline by its id, and the role its first painted path maps to: what a frame draws it as when the
/// evidence store's holder inlines it (#1162).
pub fn outline(svg: &Svg, item: &Value, colors: &BTreeMap<Color, String>) -> Value {
    let mut local = item.clone();
    if let Some(m) = local.as_object_mut() {
        m.remove("at");
    }
    let place = placement(svg, &local);
    let verbs: Vec<Verb> = svg
        .paths
        .iter()
        .flat_map(|p| p.verbs.iter().map(|v| place.verb(*v)))
        .collect();
    let role = svg
        .paths
        .iter()
        .find_map(|p| p.fill.map(|f| f.color).or(p.stroke.as_ref().map(|s| s.paint.color)))
        .and_then(|c| colors.get(&c))
        .map_or("ink", String::as_str);
    // #494: each part's outline too, so a path key `{of: ID#part}` and a match morph read it.
    let parts: Map<String, Value> = parts(svg, &local).into_iter().map(|(id, _, verbs)| (id, json!(d_of(&verbs)))).collect();
    json!({"d": d_of(&verbs), "role": role, "parts": parts})
}

/// What one path draws: its outline, and its fill and stroke as `(role, opacity[, width])`.
struct Drawn<'a> {
    verbs: Vec<Verb>,
    fill: Option<(&'a str, f64)>,
    stroke: Option<(&'a str, f64, f64)>,
}

/// Each path's term: write_on's terms are the parts in reading order, the SVG's top-level parts
/// as it lists them; a path in no part is a term of its own.
fn terms(svg: &Svg) -> Vec<usize> {
    let mut seen: Vec<Option<usize>> = Vec::new();
    svg.paths
        .iter()
        .enumerate()
        .map(|(j, p)| {
            let mut top = p.part;
            while let Some(parent) = top.and_then(|t| svg.parts[t].parent) {
                top = Some(parent);
            }
            // A path in no part keys by its own index past every part's.
            let key = top.or(Some(svg.parts.len() + j));
            match seen.iter().position(|s| *s == key) {
                Some(t) => t,
                None => {
                    seen.push(key);
                    seen.len() - 1
                }
            }
        })
        .collect()
}

/// A path as the write draws it at `progress` (Text `text@1`'s write mode): term `k` of `n` runs
/// over its share of the progress, the terms lagged by min(4 ÷ n, 0.2); over the first half of
/// its span its outline draws along its path in its stroke paint (or its fill's with no stroke),
/// then its fill comes in while the outline turns into its own stroke. `None` before it starts.
#[allow(clippy::too_many_arguments)]
fn written<'a>(
    progress: f64,
    k: usize,
    n: usize,
    write: Write,
    verbs: Vec<Verb>,
    fill: Option<(&'a str, f64)>,
    stroke: Option<(&'a str, f64, f64)>,
) -> Option<Drawn<'a>> {
    let lag = (4.0 / n as f64).min(0.2);
    let span = 1.0 + (n as f64 - 1.0) * lag;
    let p = (progress * span - k as f64 * lag).clamp(0.0, 1.0);
    if p <= 0.0 {
        return None;
    }
    if p >= 1.0 {
        return Some(Drawn {
            verbs,
            fill,
            stroke,
        });
    }
    let drawn = (2.0 * p).min(1.0);
    let filled = match write {
        Write::Honest => (2.0 * p - 1.0).max(0.0),
        Write::FadesFillsFromStart => p,
    };
    // The outline: the stroke, or a hairline in the fill's paint that fades as the fill comes in.
    let outline = match (stroke, fill) {
        (Some(s), _) => Some(s),
        (None, Some((role, opacity))) => Some((role, opacity * (1.0 - filled), 1.0)),
        (None, None) => None,
    };
    Some(Drawn {
        verbs: if drawn < 1.0 {
            trimmed(&verbs, drawn)
        } else {
            verbs
        },
        fill: fill
            .filter(|_| filled > 0.0)
            .map(|(role, opacity)| (role, opacity * filled)),
        stroke: outline,
    })
}

/// The first `share` of the outline's length, from its start along its sub-paths in order, a
/// closed sub-path's closing edge included; flattened within 0.01 u.
fn trimmed(verbs: &[Verb], share: f64) -> Vec<Verb> {
    let lines = path::flatten(verbs, 0.01);
    let edges = |l: &path::Polyline| {
        let mut pts = l.points.clone();
        if l.closed {
            pts.push(l.points[0]);
        }
        pts
    };
    let length = |pts: &[[f64; 2]]| {
        pts.windows(2)
            .map(|w| deep_canvas::ops::hypot(w[1][0] - w[0][0], w[1][1] - w[0][1]))
            .sum::<f64>()
    };
    let total: f64 = lines.iter().map(|l| length(&edges(l))).sum();
    let mut left = total * share;
    let mut out = Vec::new();
    for line in &lines {
        if left <= 0.0 {
            break;
        }
        let pts = edges(line);
        if length(&pts) <= left {
            left -= length(&pts);
            out.push(Verb::Move(line.points[0]));
            out.extend(line.points[1..].iter().map(|p| Verb::Line(*p)));
            if line.closed {
                out.push(Verb::Close);
            }
            continue;
        }
        out.push(Verb::Move(pts[0]));
        for w in pts.windows(2) {
            let d = deep_canvas::ops::hypot(w[1][0] - w[0][0], w[1][1] - w[0][1]);
            if d >= left {
                let s = if d > 0.0 { left / d } else { 0.0 };
                out.push(Verb::Line([
                    w[0][0] + (w[1][0] - w[0][0]) * s,
                    w[0][1] + (w[1][1] - w[0][1]) * s,
                ]));
                left = 0.0;
                break;
            }
            out.push(Verb::Line(w[1]));
            left -= d;
        }
    }
    out
}

/// Verbs as path data, every number as the shortest text that reads back to it.
fn d_of(verbs: &[Verb]) -> String {
    let mut d = String::new();
    let mut put = |c: char, pts: &[[f64; 2]]| {
        d.push(c);
        for p in pts {
            d.push_str(&format!(" {} {}", p[0], p[1]));
        }
        d.push(' ');
    };
    for v in verbs {
        match v {
            Verb::Move(p) => put('M', &[*p]),
            Verb::Line(p) => put('L', &[*p]),
            Verb::Quad(a, b) => put('Q', &[*a, *b]),
            Verb::Cubic(a, b, c) => put('C', &[*a, *b, *c]),
            Verb::Close => put('Z', &[]),
        }
    }
    d.trim_end().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The path item `id` draws as, read back as its verbs.
    fn drawn(item: &Value, svg: &Svg) -> Vec<Verb> {
        let colors = [(Color::Rgb([0, 0, 0]), "ink".to_string())].into();
        let out = lower("v", item, svg, &colors, Write::Honest);
        let (_, path) = out.iter().find(|(k, _)| k.starts_with("v.p")).unwrap();
        path::parse(path["params"]["d"].as_str().unwrap()).unwrap()
    }

    #[test]
    fn a_patterned_shape_is_where_its_tiles_draw_inside_its_outline() {
        let bytes = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <pattern id="p" patternUnits="userSpaceOnUse" width="20" height="20">
            <rect width="10" height="10"/></pattern>
            <rect id="r" x="25" y="25" width="30" height="30" fill="url(#p)"/></svg>"#;
        let svg = svg::import(bytes, &[], svg::Twin::Honest).unwrap();
        let item = json!({"params": {"size": [100, 100]}});
        // The cells at 20..30 and 40..50 draw, cut to the outline 25..55; the tiles span 20..60.
        assert_eq!(bounds(&svg, &item), Some([25.0, 25.0, 25.0, 25.0]));
        assert_eq!(parts(&svg, &item)[0].1, [25.0, 25.0, 25.0, 25.0]);
    }

    #[test]
    fn a_parts_at_moves_its_paths_from_where_the_import_placed_them() {
        let bytes = br#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">
            <g id="a"><path d="M 1 1 L 2 1 L 2 2 Z"/></g></svg>"#;
        let svg = svg::import(bytes, &[], svg::Twin::Honest).unwrap();
        let still = json!({"params": {"size": [10, 10]}});
        let moved = json!({"params": {"size": [10, 10]}, "parts": {"a": {"at": {"0": 5}}}});
        assert_eq!(drawn(&still, &svg)[0], Verb::Move([1.0, 1.0]));
        assert_eq!(drawn(&moved, &svg)[0], Verb::Move([6.0, 1.0]));
    }
}
