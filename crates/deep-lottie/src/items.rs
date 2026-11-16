//! One drawn item from the shapes, modifiers and styles a shape tree gives it: a rectangle as
//! `rect@1`, a round ellipse as `circle@1`, an unturned polystar as `star@1` and anything else as
//! `path@1`; Lottie's modifiers as the item's ops in their order; and its fill and stroke as
//! paints whose colors are roles of the look, alpha going into their opacity.

use serde_json::{json, Map, Value};

use crate::colors::rgb;
use crate::geom::{self, bounds_of, d_of, Star};
use crate::out::{interp, n, ns, Out, Time, Ty};
use crate::read::{Bez, Key, Obj, Prop, Reader, ShapeProp};
use crate::shapes::Drawn;

/// A box `[x, y, w, h]`.
type Bounds = [f64; 4];

/// The most ops an item holds (Path: ops).
const MAX_OPS: usize = 8;
/// The most stops a gradient holds (Paint).
const MAX_STOPS: usize = 8;

/// Where an item is being made: its ID, the layer it comes from (as issues name it), and the
/// time its layer's frames land at.
pub struct At<'a> {
    pub id: &'a str,
    pub layer: &'a str,
    pub time: Time,
}

fn ty(o: &Obj) -> &str {
    o.get("ty").and_then(Value::as_str).unwrap_or("")
}

fn name(o: &Obj) -> &str {
    o.get("nm").and_then(Value::as_str).unwrap_or("")
}

/// Whether two properties' keys share their times and eases, so a value mixed from both keeps
/// one channel.
fn together(a: &[Key<Vec<f64>>], b: &[Key<Vec<f64>>]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(x, y)| x.t == y.t && x.hold == y.hold && x.o == y.o && x.i == y.i)
}

/// A rectangle's static outline, an ellipse's, a polystar's or a path's first shape.
fn outline(r: &mut Reader, s: &Obj, what: &str) -> Option<Bez> {
    let mut p = |k: &str| r.prop(s, k, &format!("{what}/{k}"));
    match ty(s) {
        "rc" => {
            let (pos, size, round) = (p("p")?, p("s")?, p("r"));
            Some(geom::rect(
                [pos.at(0, 0.0), pos.at(1, 0.0)],
                [size.at(0, 0.0), size.at(1, 0.0)],
                round.map_or(0.0, |r| r.at(0, 0.0)),
            ))
        }
        "el" => {
            let (pos, size) = (p("p")?, p("s")?);
            Some(geom::ellipse(
                [pos.at(0, 0.0), pos.at(1, 0.0)],
                [size.at(0, 0.0), size.at(1, 0.0)],
            ))
        }
        "sr" => Some(geom::star(&star_of(r, s, what))),
        "sh" => match r.shape(s, "ks", &format!("{what}/ks"))? {
            ShapeProp::Fixed(b) => Some(b),
            ShapeProp::Keys(k) => k.into_iter().next().map(|k| k.s),
        },
        _ => None,
    }
}

fn star_of(r: &mut Reader, s: &Obj, what: &str) -> Star {
    let p = r
        .prop(s, "p", &format!("{what}/p"))
        .map_or([0.0, 0.0], |p| [p.at(0, 0.0), p.at(1, 0.0)]);
    let mut f = |k: &str, or: f64| r.number(s, k, &format!("{what}/{k}"), or);
    Star {
        p,
        points: f("pt", 5.0),
        r: f("r", 0.0),
        or: f("or", 0.0),
        os: f("os", 0.0),
        ir: f("ir", 0.0),
        is: f("is", 0.0),
        // Lottie's sy: 1 a star, 2 a polygon.
        star: s.get("sy").and_then(Value::as_f64) != Some(2.0),
    }
}

/// The item's geometry: its kind, its params and the box a gradient over it spans.
fn geometry(
    out: &mut Out,
    r: &mut Reader,
    at: &At,
    d: &Drawn,
    params: &mut Map<String, Value>,
) -> (&'static str, [f64; 4]) {
    let id = at.id;
    let what = |s: &Obj| format!("shapes/{}", name(s));
    if let [s] = d.shapes.as_slice() {
        let w = what(s);
        match ty(s) {
            "rc" => {
                let (Some(p), Some(size)) = (
                    r.prop(s, "p", &format!("{w}/p")),
                    r.prop(s, "s", &format!("{w}/s")),
                ) else {
                    return ("rect@1", [0.0; 4]);
                };
                let round = r.prop(s, "r", &format!("{w}/r"));
                let (cx, cy, sw, sh) =
                    (p.at(0, 0.0), p.at(1, 0.0), size.at(0, 0.0), size.at(1, 0.0));
                let bx = [cx - sw / 2.0, cy - sh / 2.0, sw, sh];
                params.insert("box".into(), ns(&bx));
                if let Some(round) = &round {
                    if round.at(0, 0.0) != 0.0 || round.keyed() {
                        params.insert("radius".into(), n(round.at(0, 0.0)));
                        out.keys(id, "params/radius", Ty::F32, round, at.time);
                    }
                }
                match (&p, &size) {
                    (Prop::Fixed(_), Prop::Fixed(_)) => {}
                    (Prop::Keys(_), Prop::Fixed(_)) => out.parts(
                        id,
                        "params/box",
                        0,
                        &p.map(|v| {
                            vec![v[0] - sw / 2.0, v.get(1).copied().unwrap_or(0.0) - sh / 2.0]
                        }),
                        at.time,
                    ),
                    (Prop::Fixed(_), Prop::Keys(_)) => {
                        let corner = size.map(|v| {
                            vec![cx - v[0] / 2.0, cy - v.get(1).copied().unwrap_or(0.0) / 2.0]
                        });
                        out.parts(id, "params/box", 0, &corner, at.time);
                        out.parts(id, "params/box", 2, &size, at.time);
                    }
                    (Prop::Keys(pk), Prop::Keys(sk)) if together(pk, sk) => {
                        let keys = pk
                            .iter()
                            .zip(sk)
                            .map(|(a, b)| Key {
                                s: vec![
                                    a.s[0] - b.s[0] / 2.0,
                                    a.s.get(1).copied().unwrap_or(0.0)
                                        - b.s.get(1).copied().unwrap_or(0.0) / 2.0,
                                ],
                                ..a.clone()
                            })
                            .collect();
                        out.parts(id, "params/box", 0, &Prop::Keys(keys), at.time);
                        out.parts(id, "params/box", 2, &size, at.time);
                    }
                    (Prop::Keys(_), Prop::Keys(_)) => {
                        out.issue("keys_apart", at.layer, Some(&w), "the rectangle's position and size are keyed at different times or eases; the box keeps its first value");
                    }
                }
                return ("rect@1", bx);
            }
            "el" => {
                let (Some(p), Some(size)) = (
                    r.prop(s, "p", &format!("{w}/p")),
                    r.prop(s, "s", &format!("{w}/s")),
                ) else {
                    return ("circle@1", [0.0; 4]);
                };
                let round = match &size {
                    Prop::Fixed(v) => v.first() == v.get(1),
                    Prop::Keys(k) => k.iter().all(|k| k.s.first() == k.s.get(1)),
                };
                if round {
                    let (cx, cy, rr) = (p.at(0, 0.0), p.at(1, 0.0), size.at(0, 0.0) / 2.0);
                    params.insert("center".into(), ns(&[cx, cy]));
                    params.insert("r".into(), n(rr));
                    out.keys(id, "params/center", Ty::Vec2, &p, at.time);
                    out.keys(
                        id,
                        "params/r",
                        Ty::F32,
                        &size.map(|v| vec![v[0] / 2.0]),
                        at.time,
                    );
                    return ("circle@1", [cx - rr, cy - rr, 2.0 * rr, 2.0 * rr]);
                }
            }
            "sr" => {
                let turn = r.prop(s, "r", &format!("{w}/r"));
                if turn
                    .as_ref()
                    .is_none_or(|t| !t.keyed() && t.at(0, 0.0) == 0.0)
                {
                    let star = star_of(r, s, &w);
                    let mut f = |k: &str| r.prop(s, k, &format!("{w}/{k}"));
                    let fields: [(&str, &str, f64); 6] = [
                        ("pt", "points", 1.0),
                        ("or", "outer_r", 1.0),
                        ("ir", "inner_r", 1.0),
                        ("os", "outer_round", 0.01),
                        ("is", "inner_round", 0.01),
                        ("p", "center", 1.0),
                    ];
                    let mut props = Vec::new();
                    for (k, field, scale) in fields {
                        if !star.star && (k == "ir" || k == "is") {
                            continue;
                        }
                        if let Some(prop) = f(k) {
                            props.push((
                                field,
                                prop.map(|v| v.iter().map(|x| x * scale).collect()),
                                k == "p",
                            ));
                        }
                    }
                    for (field, prop, vec) in &props {
                        let skip = matches!(*field, "outer_round" | "inner_round")
                            && !prop.keyed()
                            && prop.at(0, 0.0) == 0.0;
                        if !skip {
                            params.insert(
                                (*field).into(),
                                if *vec {
                                    ns(&prop.first()[..2.min(prop.first().len())])
                                } else {
                                    n(prop.at(0, 0.0))
                                },
                            );
                            out.keys(
                                id,
                                &format!("params/{field}"),
                                if *vec { Ty::Vec2 } else { Ty::F32 },
                                prop,
                                at.time,
                            );
                        }
                    }
                    if !star.star {
                        params.insert("polygon".into(), json!(true));
                    }
                    return ("star@1", bounds_of(&[geom::star(&star)]));
                }
                if turn.as_ref().is_some_and(Prop::keyed) {
                    out.issue("star_turn_keyed", at.layer, Some(&format!("{w}/r")), "a polystar's own rotation is keyed, and star@1 holds none; it keeps its first angle as a path");
                }
            }
            "sh" => {
                if let Some(ShapeProp::Keys(keys)) = r.shape(s, "ks", &format!("{w}/ks")) {
                    let d = d_of(&[keys[0].s.clone()]);
                    params.insert("d".into(), json!(d));
                    let list = keys
                        .iter()
                        .map(|k| {
                            (
                                out.flicks(at.time.at(k.t)),
                                json!(geom::key_d(&k.s)),
                                interp(k, 0),
                            )
                        })
                        .collect();
                    out.channel(
                        &format!("{id}.path"),
                        format!("items/{id}/path"),
                        "path",
                        list,
                    );
                    return ("path@1", bounds_of(&[keys[0].s.clone()]));
                }
            }
            _ => {}
        }
    }
    // Every other shape, and several shapes as one, draws as a path of their outlines.
    let mut subs = Vec::new();
    for s in &d.shapes {
        let w = what(s);
        if ty(s) == "el" || ty(s) == "rc" || ty(s) == "sr" {
            let keyed = ["p", "s", "r", "or", "ir", "pt"]
                .iter()
                .any(|k| r.prop(s, k, &format!("{w}/{k}")).is_some_and(|p| p.keyed()));
            if keyed {
                out.issue(
                    "keys_dropped",
                    at.layer,
                    Some(&w),
                    "a keyed shape that draws as a path keeps its first outline",
                );
            }
        }
        if let Some(b) = outline(r, s, &w) {
            subs.push(b);
        }
    }
    params.insert("d".into(), json!(d_of(&subs)));
    ("path@1", bounds_of(&subs))
}

/// A modifier as an op, with its keyed fields as channels on `params/ops/<n>/…`.
fn op(out: &mut Out, r: &mut Reader, at: &At, m: &Obj, k: usize) -> Option<Value> {
    let w = format!("modifiers/{}", name(m));
    let id = at.id;
    let field = |out: &mut Out,
                 r: &mut Reader,
                 key: &str,
                 op: &str,
                 f: &str,
                 scale: f64,
                 or: f64|
     -> Value {
        match r.prop(m, key, &format!("{w}/{key}")) {
            Some(p) => {
                let p = p.map(|v| v.iter().map(|x| x * scale).collect());
                out.keys(
                    id,
                    &format!("params/ops/{k}/{op}/{f}"),
                    Ty::F32,
                    &p,
                    at.time,
                );
                n(p.at(0, or))
            }
            None => n(or),
        }
    };
    Some(match ty(m) {
        "tm" => {
            let start = field(out, r, "s", "trim", "start", 0.01, 0.0);
            let end = field(out, r, "e", "trim", "end", 0.01, 1.0);
            let offset = field(out, r, "o", "trim", "offset", 1.0, 0.0);
            // Lottie's trim m: 1 trims each shape on its own (each true), 2 all as one; none is 1.
            let each = m.get("m").and_then(Value::as_f64) != Some(2.0);
            json!({"trim": {"start": start, "end": end, "offset": offset, "each": each}})
        }
        "rd" => {
            json!({"round_corners": {"radius": field(out, r, "r", "round_corners", "radius", 1.0, 0.0)}})
        }
        "pb" => json!({"pucker": {"amount": field(out, r, "a", "pucker", "amount", 0.01, 0.0)}}),
        "zz" => {
            let points = if r.number(m, "pt", &format!("{w}/pt"), 1.0) == 2.0 {
                "smooth"
            } else {
                "corner"
            };
            json!({"zigzag": {"size": field(out, r, "s", "zigzag", "size", 1.0, 10.0), "ridges": n(r.number(m, "r", &format!("{w}/r"), 5.0).round()), "points": points}})
        }
        "op" => {
            let join = match m.get("lj").and_then(Value::as_f64) {
                Some(2.0) => "round",
                Some(3.0) => "bevel",
                _ => "miter",
            };
            let mut o = json!({"amount": field(out, r, "a", "offset_path", "amount", 1.0, 10.0), "join": join});
            let ml = r.number(m, "ml", &format!("{w}/ml"), 4.0);
            if join == "miter" && ml >= 1.0 && ml != 4.0 {
                o["miter_limit"] = n(ml);
            }
            json!({"offset_path": o})
        }
        "tw" => {
            let c = r
                .prop(m, "c", &format!("{w}/c"))
                .map_or(vec![0.0, 0.0], |p| p.first().to_vec());
            json!({"twist": {"angle": field(out, r, "a", "twist", "angle", 1.0, 0.0), "center": ns(&c[..2.min(c.len())])}})
        }
        "rp" => {
            let copies = field(out, r, "c", "repeater", "copies", 1.0, 3.0);
            let mut rp = json!({"copies": copies});
            let offset = r.number(m, "o", &format!("{w}/o"), 0.0);
            if offset != 0.0 {
                rp["offset"] = n(offset);
            }
            let tr = m
                .get("tr")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            let mut step = Map::new();
            let mut v = |k: &str| r.prop(&tr, k, &format!("{w}/tr/{k}"));
            if let Some(p) = v("p").filter(|p| p.first().iter().any(|x| *x != 0.0)) {
                step.insert("pos".into(), ns(&p.first()[..2.min(p.first().len())]));
            }
            if let Some(a) = v("r").filter(|p| p.at(0, 0.0) != 0.0) {
                step.insert("rot".into(), n(a.at(0, 0.0)));
            }
            if let Some(s) = v("s").filter(|p| p.first().iter().any(|x| *x != 100.0)) {
                step.insert(
                    "scale".into(),
                    ns(&s
                        .first()
                        .iter()
                        .take(2)
                        .map(|x| x / 100.0)
                        .collect::<Vec<_>>()),
                );
            }
            if let Some(a) = v("a").filter(|p| p.first().iter().any(|x| *x != 0.0)) {
                step.insert("pivot".into(), ns(&a.first()[..2.min(a.first().len())]));
            }
            if !step.is_empty() {
                rp["at"] = Value::Object(step);
            }
            let (so, eo) = (
                v("so").map_or(100.0, |p| p.at(0, 100.0)),
                v("eo").map_or(100.0, |p| p.at(0, 100.0)),
            );
            if (so, eo) != (100.0, 100.0) {
                rp["opacity"] = ns(&[so / 100.0, eo / 100.0]);
            }
            if m.get("m").and_then(Value::as_f64) == Some(1.0) {
                rp["composite"] = json!("above");
            }
            json!({"repeater": rp})
        }
        _ => return None,
    })
}

/// A color property's role and alpha; a keyed color keeps its first value, reported.
fn color(out: &mut Out, r: &mut Reader, at: &At, s: &Obj, key: &str, what: &str) -> (String, f64) {
    let p = r
        .prop(s, key, what)
        .unwrap_or(Prop::Fixed(vec![0.0, 0.0, 0.0, 1.0]));
    if p.keyed() {
        out.issue(
            "color_keyed",
            at.layer,
            Some(what),
            "a keyed color takes one role, its first key's; a role can't be keyed",
        );
    }
    let c = p.first().to_vec();
    (
        out.colors.role(rgb(&c), at.layer),
        c.get(3).copied().unwrap_or(1.0).clamp(0.0, 1.0),
    )
}

/// A gradient's stops, kind and ends over `bounds`.
fn gradient(
    out: &mut Out,
    r: &mut Reader,
    at: &At,
    s: &Obj,
    what: &str,
    bounds: [f64; 4],
) -> Value {
    let count = s
        .get("g")
        .and_then(|g| g.get("p"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0)
        .max(0.0) as usize;
    let g = s
        .get("g")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let flat = match r.prop(&g, "k", &format!("{what}/g")) {
        Some(p) => {
            if p.keyed() {
                out.issue(
                    "gradient_keyed",
                    at.layer,
                    Some(what),
                    "a keyed gradient keeps its first stops",
                );
            }
            p.first().to_vec()
        }
        None => Vec::new(),
    };
    let colors: Vec<(f64, [f64; 3])> = flat
        .chunks(4)
        .take(count)
        .filter(|c| c.len() == 4)
        .map(|c| (c[0], [c[1], c[2], c[3]]))
        .collect();
    let alphas: Vec<(f64, f64)> = flat
        .get(count * 4..)
        .unwrap_or(&[])
        .chunks(2)
        .filter(|c| c.len() == 2)
        .map(|c| (c[0], c[1]))
        .collect();
    let alpha_at = |x: f64| -> f64 {
        match alphas.iter().position(|(o, _)| *o >= x) {
            None => alphas.last().map_or(1.0, |a| a.1),
            Some(0) => alphas[0].1,
            Some(i) => {
                let ((o0, a0), (o1, a1)) = (alphas[i - 1], alphas[i]);
                if o1 > o0 {
                    a0 + (a1 - a0) * (x - o0) / (o1 - o0)
                } else {
                    a1
                }
            }
        }
    };
    let mut picked: Vec<usize> = (0..colors.len()).collect();
    if colors.len() > MAX_STOPS {
        out.issue(
            "gradient_stops",
            at.layer,
            Some(what),
            format!(
                "{} stops, of which a gradient holds {MAX_STOPS}; evenly spaced ones are kept",
                colors.len()
            ),
        );
        picked = (0..MAX_STOPS)
            .map(|k| k * (colors.len() - 1) / (MAX_STOPS - 1))
            .collect();
    }
    let mut stops: Vec<Value> = Vec::new();
    let mut last = 0.0_f64;
    for k in picked {
        let (o, c) = colors[k];
        let at_ = o.clamp(last, 1.0);
        last = at_;
        let mut stop = json!({"at": n(at_), "role": out.colors.role(rgb(&c), at.layer)});
        let a = alpha_at(o).clamp(0.0, 1.0);
        if a < 1.0 {
            stop["opacity"] = n(a);
        }
        stops.push(stop);
    }
    if stops.len() == 1 {
        stops.push(json!({"at": 1, "role": stops[0]["role"].clone()}));
    }
    let mut point = |key: &str| -> [f64; 2] {
        let p = r.prop(s, key, &format!("{what}/{key}"));
        if p.as_ref().is_some_and(Prop::keyed) {
            out.issue(
                "gradient_keyed",
                at.layer,
                Some(&format!("{what}/{key}")),
                "a keyed gradient end keeps its first point",
            );
        }
        p.map_or([0.0, 0.0], |p| [p.at(0, 0.0), p.at(1, 0.0)])
    };
    let (start, end) = (point("s"), point("e"));
    let frac = |p: [f64; 2]| {
        [
            if bounds[2] != 0.0 {
                (p[0] - bounds[0]) / bounds[2]
            } else {
                0.5
            },
            if bounds[3] != 0.0 {
                (p[1] - bounds[1]) / bounds[3]
            } else {
                0.5
            },
        ]
    };
    let radial = s.get("t").and_then(Value::as_f64) == Some(2.0);
    let mut out_g = json!({"kind": if radial { "radial" } else { "linear" }, "stops": stops, "from": ns(&frac(start)), "to": ns(&frac(end))});
    if radial {
        let h = r.number(s, "h", &format!("{what}/h"), 0.0) / 100.0;
        if h != 0.0 {
            let a = r.number(s, "a", &format!("{what}/a"), 0.0);
            let angle = deep_canvas::ops::deg(deep_canvas::ops::atan2(
                end[1] - start[1],
                end[0] - start[0],
            )) + a;
            out_g["focal"] = json!({"length": n(h.clamp(-1.0, 1.0)), "angle": n(angle)});
        }
    }
    out_g
}

/// The item's paint: a fill and a stroke, each a role or a gradient at its opacity.
fn paint(
    out: &mut Out,
    r: &mut Reader,
    at: &At,
    d: &Drawn,
    (bounds, scaled, path): (Bounds, bool, bool),
    params: &mut Map<String, Value>,
) {
    let id = at.id;
    let mut paint = Map::new();
    if let Some(f) = &d.fill {
        let w = format!("styles/{}", name(f));
        let (mut fill, alpha) = if ty(f) == "gf" {
            (
                json!({"gradient": gradient(out, r, at, f, &w, bounds)}),
                1.0,
            )
        } else {
            let (role, alpha) = color(out, r, at, f, "c", &format!("{w}/c"));
            (json!({"role": role}), alpha)
        };
        if let Some(o) = r.prop(f, "o", &format!("{w}/o")) {
            let o = o.map(|v| vec![v[0] / 100.0 * alpha]);
            if o.keyed() || o.at(0, 1.0) != 1.0 {
                fill["opacity"] = n(o.at(0, 1.0));
                out.keys(id, "params/paint/fill/opacity", Ty::F32, &o, at.time);
            }
        } else if alpha != 1.0 {
            fill["opacity"] = n(alpha);
        }
        if path && f.get("r").and_then(Value::as_f64) == Some(2.0) {
            params.insert("fill_rule".into(), json!("evenodd"));
        }
        paint.insert("fill".into(), fill);
    }
    if let Some(s) = &d.stroke {
        let w = format!("styles/{}", name(s));
        let (mut stroke, alpha) = if ty(s) == "gs" {
            (
                json!({"gradient": gradient(out, r, at, s, &w, bounds)}),
                1.0,
            )
        } else {
            let (role, alpha) = color(out, r, at, s, "c", &format!("{w}/c"));
            (json!({"role": role}), alpha)
        };
        let width = r
            .prop(s, "w", &format!("{w}/w"))
            .unwrap_or(Prop::Fixed(vec![1.0]));
        stroke["width"] = n(width.at(0, 1.0));
        out.keys(id, "params/paint/stroke/width", Ty::F32, &width, at.time);
        match s.get("lc").and_then(Value::as_f64) {
            Some(2.0) => stroke["cap"] = json!("round"),
            Some(3.0) => stroke["cap"] = json!("square"),
            _ => {}
        }
        let join = match s.get("lj").and_then(Value::as_f64) {
            Some(2.0) => "round",
            Some(3.0) => "bevel",
            _ => "miter",
        };
        if join != "miter" {
            stroke["join"] = json!(join);
        }
        let ml = s
            .get("ml")
            .and_then(Value::as_f64)
            .or_else(|| r.prop(s, "ml2", &format!("{w}/ml2")).map(|p| p.at(0, 4.0)))
            .unwrap_or(4.0);
        if join == "miter" && ml >= 1.0 && ml != 4.0 {
            stroke["miter_limit"] = n(ml);
        }
        if let Some(o) = r.prop(s, "o", &format!("{w}/o")) {
            let o = o.map(|v| vec![v[0] / 100.0 * alpha]);
            if o.keyed() || o.at(0, 1.0) != 1.0 {
                stroke["opacity"] = n(o.at(0, 1.0));
                out.keys(id, "params/paint/stroke/opacity", Ty::F32, &o, at.time);
            }
        } else if alpha != 1.0 {
            stroke["opacity"] = n(alpha);
        }
        if let Some(Value::Array(dashes)) = s.get("d") {
            let (mut list, mut offset) = (Vec::new(), 0.0);
            for (k, dash) in dashes.iter().enumerate() {
                let Some(dash) = dash.as_object() else {
                    continue;
                };
                let v = r.number(dash, "v", &format!("{w}/d/{k}"), 0.0);
                match dash.get("n").and_then(Value::as_str) {
                    Some("o") => offset = v,
                    _ => list.push(v),
                }
            }
            if list.len() % 2 == 1 {
                list.extend(list.clone());
            }
            if list.iter().any(|x| *x > 0.0) {
                stroke["dash"] = ns(&list);
                if offset != 0.0 {
                    stroke["dash_offset"] = n(offset);
                }
            }
        }
        // Lottie's strokes scale with their layer, as a stroke that asks to.
        if scaled {
            stroke["scale_stroke"] = json!(true);
        }
        paint.insert("stroke".into(), stroke);
    }
    if !paint.is_empty() {
        params.insert("paint".into(), Value::Object(paint));
    }
}

/// Makes item `at.id` from `d`: its kind, params, ops and paint; `scaled` when a scale moves it.
pub fn drawn(out: &mut Out, r: &mut Reader, at: &At, d: &Drawn, scaled: bool) {
    let mut params = Map::new();
    let (kind, bounds) = geometry(out, r, at, d, &mut params);
    let mut ops = Vec::new();
    for m in &d.mods {
        if ty(m) == "mm" {
            continue;
        }
        if ops.len() == MAX_OPS {
            out.issue("ops_many", at.layer, Some(&format!("modifiers/{}", name(m))), format!("an item holds at most {MAX_OPS} ops; this modifier and the ones after it are left out"));
            break;
        }
        if let Some(o) = op(out, r, at, m, ops.len()) {
            ops.push(o);
        }
    }
    if !ops.is_empty() {
        params.insert("ops".into(), Value::Array(ops));
    }
    paint(
        out,
        r,
        at,
        d,
        (bounds, scaled, kind == "path@1"),
        &mut params,
    );
    let item = out.item(at.id);
    item["kind"] = json!(kind);
    let held = item
        .get("params")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    // Values a channel wrote first into the item stay, under the ones read here.
    let mut merged = params;
    for (k, v) in held {
        merged.entry(k).or_insert(v);
    }
    item["params"] = Value::Object(merged);
}
