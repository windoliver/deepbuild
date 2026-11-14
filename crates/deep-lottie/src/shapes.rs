//! A shape layer's tree as the items it draws, by the spec's shape rendering model: a style or a
//! modifier applies to every shape before it in its group, nested groups included; a group's
//! transform moves everything in it; and the first element of a list draws on top. Each style
//! paints the shapes it reaches in one group as one item, a fill and a stroke over the same
//! shapes as one item with both, and shapes that take different modifiers as items apart. A group
//! whose children are `<name>.copy.<k>` groups, as the export writes a repeater, is its copies'
//! first group with that repeater rebuilt.

use serde_json::{json, Value};

use crate::read::{num, Obj};

/// A group of the tree: its name, its transform, the group it sits in, and where it sits there.
#[derive(Clone, Debug)]
pub struct Group {
    pub nm: String,
    pub tr: Option<Obj>,
    pub parent: Option<usize>,
    /// Its place among its parent's children, top first.
    pub rank: Rank,
}

/// A place in a group's draw list, top first: an element's own index in its group, or, for a
/// style that reaches in from `up` groups out, after every element of the group, by that style's
/// index there.
pub type Rank = (usize, usize);

/// One item a shape tree draws: its shapes, the modifiers they take in order, its fill and its
/// stroke, the group it sits in, and its rank there.
#[derive(Clone, Debug)]
pub struct Drawn {
    pub nm: String,
    pub shapes: Vec<Obj>,
    pub mods: Vec<Obj>,
    pub fill: Option<Obj>,
    pub stroke: Option<Obj>,
    pub group: Option<usize>,
    pub rank: Rank,
}

/// What the walk found that no item holds: merge paths, and element types it doesn't know.
#[derive(Default)]
pub struct Walked {
    pub groups: Vec<Group>,
    pub drawn: Vec<Drawn>,
    /// `(type, name)` of each element left out.
    pub left: Vec<(String, String)>,
}

fn ty(v: &Value) -> &str {
    v.get("ty").and_then(Value::as_str).unwrap_or("")
}

fn nm(v: &Value) -> String {
    v.get("nm")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn hidden(v: &Value) -> bool {
    v.get("hd").and_then(Value::as_bool) == Some(true)
}

const GEOMETRY: [&str; 4] = ["rc", "el", "sh", "sr"];
const FILLS: [&str; 2] = ["fl", "gf"];
const STROKES: [&str; 2] = ["st", "gs"];
const MODIFIERS: [&str; 8] = ["tm", "rd", "pb", "zz", "op", "tw", "rp", "mm"];

/// A shape the walk reached: where it sits and what reaches it.
struct Reached {
    shape: Obj,
    group: Option<usize>,
    mods: Vec<Obj>,
}

/// A style reaching shapes: its element, its group and index, and the shapes it reaches.
struct Style {
    el: Obj,
    fill: bool,
    group: Option<usize>,
    index: usize,
    shapes: Vec<usize>,
}

/// The children of a group written as the export writes a repeater, `<name>.copy.0` to
/// `.copy.(n−1)`: the first copy's elements with the repeater appended, its step the second
/// copy's transform. Copy k's opacity is the repeater's first opacity mixed toward its last by
/// k ÷ (n − 1), and the last copy's times the count's fraction, so the copies before the last
/// give the ramp and the last one what of it the fraction keeps.
fn copies(list: &[Value]) -> Option<Vec<Value>> {
    let groups: Vec<&Value> = list.iter().filter(|v| ty(v) != "tr").collect();
    // The copies' own prefix, which names the item (the group around them may name it apart).
    let first = groups.first().map(|g| nm(g))?;
    let name = first.strip_suffix(".copy.0").filter(|p| !p.is_empty())?;
    for (k, g) in groups.iter().enumerate() {
        if ty(g) != "gr" || nm(g) != format!("{name}.copy.{k}") {
            return None;
        }
    }
    let inner = |g: &Value| {
        g.get("it")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
    };
    let content = inner(groups[0]);
    let tr_of = |g: &Value| inner(g).into_iter().find(|e| ty(e) == "tr");
    let alpha: Vec<f64> = groups
        .iter()
        .map(|g| {
            tr_of(g)
                .and_then(|t| num(t.get("o").and_then(|o| o.get("k"))))
                .map_or(1.0, |o| o / 100.0)
        })
        .collect();
    let n = alpha.len();
    let first = alpha[0];
    // With three copies or more, the copy before the last sets the ramp's end; with fewer, the
    // ramp is flat.
    let end = if n >= 3 {
        first + (alpha[n - 2] - first) * (n as f64 - 1.0) / (n as f64 - 2.0)
    } else {
        first
    };
    let fraction = if n >= 2 && end > 0.0 {
        (alpha[n - 1] / end).clamp(0.0, 1.0)
    } else if n == 1 {
        alpha[0]
    } else {
        1.0
    };
    let (first, end) = if n == 1 { (1.0, 1.0) } else { (first, end) };
    let count = n as f64 - 1.0 + fraction;
    let step = match groups.get(1) {
        Some(g) => tr_of(g).unwrap_or(json!({})),
        None => json!({}),
    };
    let mut step = step;
    step["so"] = json!({"a": 0, "k": first * 100.0});
    step["eo"] = json!({"a": 0, "k": end * 100.0});
    let mut out: Vec<Value> = content.into_iter().filter(|e| ty(e) != "tr").collect();
    out.push(json!({"ty": "rp", "nm": format!("{name}.repeater"), "c": {"a": 0, "k": count}, "o": {"a": 0, "k": 0}, "tr": step}));
    if let Some(tr) = list.iter().find(|v| ty(v) == "tr") {
        out.push(tr.clone());
    }
    Some(out)
}

struct Walk {
    out: Walked,
    shapes: Vec<Reached>,
    styles: Vec<Style>,
}

impl Walk {
    /// One group's list, its index in each enclosing list from the outside in as `path`, with the
    /// modifiers and styles that reach it from outside.
    fn scope(
        &mut self,
        list: &[Value],
        group: Option<usize>,
        outer_mods: &[Obj],
        outer_styles: &[usize],
    ) {
        let rebuilt;
        let list = match copies(list) {
            Some(l) => {
                rebuilt = l;
                &rebuilt[..]
            }
            None => list,
        };
        let live: Vec<(usize, &Value)> = list
            .iter()
            .enumerate()
            .filter(|(_, v)| !hidden(v))
            .collect();
        // This list's styles, each reaching what comes before it here and in the groups before it.
        let own_styles: Vec<(usize, usize)> = live
            .iter()
            .filter(|(_, v)| FILLS.contains(&ty(v)) || STROKES.contains(&ty(v)))
            .filter_map(|(i, v)| {
                let el = v.as_object()?.clone();
                self.styles.push(Style {
                    el,
                    fill: FILLS.contains(&ty(v)),
                    group,
                    index: *i,
                    shapes: Vec::new(),
                });
                Some((*i, self.styles.len() - 1))
            })
            .collect();
        let mods_after = |i: usize| -> Vec<Obj> {
            let mut m: Vec<Obj> = live
                .iter()
                .filter(|(j, v)| *j > i && MODIFIERS.contains(&ty(v)))
                .filter_map(|(_, v)| v.as_object().cloned())
                .collect();
            m.extend(outer_mods.iter().cloned());
            m
        };
        let styles_after = |i: usize| -> Vec<usize> {
            let mut s: Vec<usize> = own_styles
                .iter()
                .filter(|(j, _)| *j > i)
                .map(|(_, s)| *s)
                .collect();
            s.extend_from_slice(outer_styles);
            s
        };
        for (i, v) in &live {
            let t = ty(v);
            if GEOMETRY.contains(&t) {
                let Some(shape) = v.as_object().cloned() else {
                    continue;
                };
                self.shapes.push(Reached {
                    shape,
                    group,
                    mods: mods_after(*i),
                });
                let at = self.shapes.len() - 1;
                for s in styles_after(*i) {
                    self.styles[s].shapes.push(at);
                }
            } else if t == "gr" {
                let it = v
                    .get("it")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                let tr = it
                    .iter()
                    .rev()
                    .find(|e| ty(e) == "tr")
                    .and_then(|e| e.as_object().cloned());
                self.out.groups.push(Group {
                    nm: nm(v),
                    tr,
                    parent: group,
                    rank: (0, *i),
                });
                let g = self.out.groups.len() - 1;
                self.scope(&it, Some(g), &mods_after(*i), &styles_after(*i));
            } else if t == "mm" {
                self.out.left.push(("mm".into(), nm(v)));
            } else if !(FILLS.contains(&t)
                || STROKES.contains(&t)
                || MODIFIERS.contains(&t)
                || t == "tr")
            {
                self.out.left.push((t.to_string(), nm(v)));
            }
        }
    }
}

/// How far out of group `inner` group `outer` is, or `None` when `outer` doesn't hold it.
fn levels(groups: &[Group], inner: Option<usize>, outer: Option<usize>) -> Option<usize> {
    let mut at = inner;
    let mut n = 0;
    loop {
        if at == outer {
            return Some(n);
        }
        at = groups[at?].parent;
        n += 1;
    }
}

fn kind_key(m: &Obj) -> String {
    serde_json::to_string(m).unwrap_or_default()
}

/// The items a shape layer's `shapes` draw.
pub fn walk(list: &[Value]) -> Walked {
    let mut w = Walk {
        out: Walked::default(),
        shapes: Vec::new(),
        styles: Vec::new(),
    };
    w.scope(list, None, &[], &[]);
    // Each style's shapes, by the group they sit in and the modifiers they take: one item each.
    struct Part {
        group: Option<usize>,
        mods: String,
        shapes: Vec<usize>,
        fills: Vec<usize>,
        strokes: Vec<usize>,
        rank: Rank,
    }
    let mut parts: Vec<Part> = Vec::new();
    for (s, style) in w.styles.iter().enumerate() {
        let mut by: Vec<(Option<usize>, String, Vec<usize>)> = Vec::new();
        for &k in &style.shapes {
            let r = &w.shapes[k];
            let mods = r.mods.iter().map(kind_key).collect::<Vec<_>>().join("|");
            // A keyed path is an item of its own, so its keys stay its own channel.
            let keyed = r
                .shape
                .get("ks")
                .and_then(|p| p.get("a"))
                .and_then(Value::as_f64)
                == Some(1.0);
            match by.iter_mut().find(|(g, m, list)| {
                *g == r.group
                    && *m == mods
                    && !keyed
                    && !list.iter().any(|&o| keyed_shape(&w.shapes[o].shape))
            }) {
                Some((_, _, list)) => list.push(k),
                None => by.push((r.group, mods, vec![k])),
            }
        }
        for (group, mods, shapes) in by {
            let up = levels(&w.out.groups, group, style.group).unwrap_or(0);
            let rank = if up == 0 {
                (0, style.index)
            } else {
                (up, style.index)
            };
            match parts
                .iter_mut()
                .find(|p| p.group == group && p.mods == mods && p.shapes == shapes)
            {
                Some(p) => {
                    if style.fill {
                        p.fills.push(s)
                    } else {
                        p.strokes.push(s)
                    }
                    p.rank = p.rank.min(rank);
                }
                None => parts.push(Part {
                    group,
                    mods,
                    fills: if style.fill { vec![s] } else { vec![] },
                    strokes: if style.fill { vec![] } else { vec![s] },
                    shapes,
                    rank,
                }),
            }
        }
    }
    for p in parts {
        let shapes: Vec<Obj> = p
            .shapes
            .iter()
            .map(|&k| w.shapes[k].shape.clone())
            .collect();
        let mods = w.shapes[p.shapes[0]].mods.clone();
        let nm = nm(&Value::Object(shapes[0].clone()));
        let el = |s: usize| Some(w.styles[s].el.clone());
        if p.fills.len() <= 1 && p.strokes.len() <= 1 {
            w.out.drawn.push(Drawn {
                nm,
                shapes,
                mods,
                fill: p.fills.first().and_then(|&s| el(s)),
                stroke: p.strokes.first().and_then(|&s| el(s)),
                group: p.group,
                rank: p.rank,
            });
            continue;
        }
        // More than one fill or stroke: the shapes draw once a style, the first style on top.
        let mut styles: Vec<usize> = p.fills.iter().chain(&p.strokes).copied().collect();
        styles.sort_by_key(|&s| {
            (
                levels(&w.out.groups, p.group, w.styles[s].group).unwrap_or(0),
                w.styles[s].index,
            )
        });
        for s in styles {
            let up = levels(&w.out.groups, p.group, w.styles[s].group).unwrap_or(0);
            let fill = w.styles[s].fill;
            w.out.drawn.push(Drawn {
                nm: nm.clone(),
                shapes: shapes.clone(),
                mods: mods.clone(),
                fill: fill.then(|| w.styles[s].el.clone()),
                stroke: (!fill).then(|| w.styles[s].el.clone()),
                group: p.group,
                rank: (up, w.styles[s].index),
            });
        }
    }
    w.out
}

fn keyed_shape(s: &Obj) -> bool {
    s.get("ks").and_then(|p| p.get("a")).and_then(Value::as_f64) == Some(1.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn el(t: &str, n: &str) -> Value {
        json!({"ty": t, "nm": n})
    }

    #[test]
    fn a_fill_and_a_stroke_over_one_shape_draw_as_one_item() {
        let w = walk(&[
            json!({"ty": "gr", "nm": "g", "it": [el("rc", "box"), el("st", "s"), el("fl", "f"), el("tr", "")]}),
        ]);
        assert_eq!(w.drawn.len(), 1);
        assert!(w.drawn[0].fill.is_some() && w.drawn[0].stroke.is_some());
        assert_eq!(w.drawn[0].group, Some(0));
    }

    #[test]
    fn a_style_reaches_the_shapes_before_it_and_into_the_groups_before_it() {
        let inner = json!({"ty": "gr", "nm": "in", "it": [el("el", "dot"), el("tr", "")]});
        let w = walk(&[
            el("rc", "a"),
            inner,
            el("fl", "f"),
            el("sh", "b"),
            el("st", "s"),
        ]);
        // f paints a (top level) and dot (inside `in`); s paints a, dot and b.
        let names: Vec<(String, bool, bool)> = w
            .drawn
            .iter()
            .map(|d| {
                (
                    d.shapes
                        .iter()
                        .map(|s| s["nm"].as_str().unwrap())
                        .collect::<Vec<_>>()
                        .join("+"),
                    d.fill.is_some(),
                    d.stroke.is_some(),
                )
            })
            .collect();
        assert!(names.contains(&("dot".into(), true, true)), "{names:?}");
        assert!(
            names.contains(&("a".into(), true, false)) || names.contains(&("a".into(), true, true)),
            "{names:?}"
        );
        assert!(
            names.iter().any(|(n, _, s)| n.contains('b') && *s),
            "{names:?}"
        );
    }

    #[test]
    fn copies_as_the_export_writes_them_are_one_shape_with_a_repeater() {
        let copy = |k: usize, p: [f64; 2], o: f64| json!({"ty": "gr", "nm": format!("dots.copy.{k}"), "it": [el("rc", "dots"), el("fl", "fill"), {"ty": "tr", "p": {"a": 0, "k": p}, "o": {"a": 0, "k": o}}]});
        let list = [
            json!({"ty": "gr", "nm": "dots", "it": [copy(0, [0.0, 0.0], 100.0), copy(1, [24.0, 0.0], 100.0), copy(2, [48.0, 0.0], 100.0), copy(3, [72.0, 0.0], 50.0), el("tr", "")]}),
        ];
        let w = walk(&list);
        assert_eq!(w.drawn.len(), 1);
        let rp = &w.drawn[0].mods[0];
        assert_eq!(rp["c"]["k"], json!(3.5));
        assert_eq!(rp["tr"]["p"]["k"], json!([24.0, 0.0]));
        assert_eq!(
            (rp["tr"]["so"]["k"].clone(), rp["tr"]["eo"]["k"].clone()),
            (json!(100.0), json!(100.0))
        );
        // Three whole copies fading 1 → 0.5: the ramp, not a fraction.
        let ramp = [
            json!({"ty": "gr", "nm": "dots", "it": [copy(0, [0.0, 0.0], 100.0), copy(1, [24.0, 0.0], 75.0), copy(2, [48.0, 0.0], 50.0), el("tr", "")]}),
        ];
        let rp = &walk(&ramp).drawn[0].mods[0];
        assert_eq!(
            (rp["c"]["k"].clone(), rp["tr"]["eo"]["k"].clone()),
            (json!(3.0), json!(50.0))
        );
    }

    #[test]
    fn merge_paths_are_left_out_and_named() {
        let w = walk(&[
            el("sh", "a"),
            el("sh", "b"),
            el("mm", "merge"),
            el("fl", "f"),
        ]);
        assert_eq!(w.left, vec![("mm".to_string(), "merge".to_string())]);
    }
}
