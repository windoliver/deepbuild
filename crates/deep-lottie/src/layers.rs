//! Lottie's layers as items: a shape layer as the item it draws, or as a group of them; a precomp
//! as a group whose children are its layers, at the time its start and stretch put them; a null
//! as an empty group others follow; a solid as a rect. Parenting is `child_of`, so the draw order
//! stays the file's. A layer's in and out points key its `visible`; its masks are `mask@1` items
//! and its matte a `matte@1`. A position keyed with spatial tangents follows its curve by arc
//! length (`follow_path` reading a keyed data value), as Lottie players move it.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{json, Value};

use crate::colors::rgb;
use crate::geom::{self, d_of};
use crate::ids::order;
use crate::items::{self, At};
use crate::out::{interp, n, ns, put, Out, Time, Ty};
use crate::read::{num, scriptlike, Obj, Prop, Reader, ShapeProp};
use crate::shapes;

/// Flatness, in u, of a spatial curve flattened for `follow_path`.
const FLAT: f64 = 0.002;
/// The deepest precomps nest.
const DEPTH: usize = 16;

/// Which items a layer's transform lands on.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Holder {
    Drawn,
    Group,
    /// A null's: no opacity, since nothing nests under it.
    Null,
}

pub struct Comp<'a> {
    pub layers: &'a [Value],
    /// The item its layers sit in.
    pub parent: Option<String>,
    pub time: Time,
    pub depth: usize,
}

pub struct Ctx<'a> {
    pub assets: BTreeMap<String, &'a Obj>,
    /// The root composition's frames `[ip, op)`.
    pub span: (f64, f64),
}

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").to_string()
}

fn f(v: &Value, k: &str, or: f64) -> f64 {
    num(v.get(k)).unwrap_or(or)
}

/// The name an item or an issue takes from a layer: its `nm`, unless that reads as script.
fn label(layer: &Value, id: &str) -> String {
    let nm = s(layer, "nm");
    if nm.is_empty() || scriptlike(&nm) {
        id.to_string()
    } else {
        nm
    }
}

/// Whether a transform is the identity and still: its position on its anchor, and no turn,
/// scale, skew or opacity.
fn still(r: &mut Reader, tr: Option<&Obj>) -> bool {
    let Some(tr) = tr else { return true };
    let mut fixed = |k: &str, or: &[f64]| match r.prop(tr, k, k) {
        None => Some(or.to_vec()),
        Some(p) if p.keyed() => None,
        Some(p) => Some(or.iter().enumerate().map(|(d, o)| p.at(d, *o)).collect()),
    };
    let (a, p) = (fixed("a", &[0.0, 0.0]), fixed("p", &[0.0, 0.0]));
    let plain = fixed("s", &[100.0, 100.0]) == Some(vec![100.0, 100.0])
        && fixed("r", &[0.0]) == Some(vec![0.0])
        && fixed("o", &[100.0]) == Some(vec![100.0])
        && fixed("sk", &[0.0]) == Some(vec![0.0]);
    a.is_some() && a == p && plain && tr.get("p").and_then(|p| p.get("s")).is_none()
}

/// Where a transform lands: the time its layer's frames land at, the layer issues name, its Lottie
/// parent's anchor (which `child_of` doesn't subtract) and whether it turns to the path it follows.
#[derive(Clone, Copy)]
struct Place<'a> {
    time: Time,
    layer: &'a str,
    shift: [f64; 2],
    orient: bool,
}

/// Where a layer's masks go: the item they clip, its rank and parent, and the layer's transform.
struct Spot<'a> {
    target: &'a str,
    rank: &'a str,
    parent: Option<&'a str>,
    place: Place<'a>,
}

/// What a transform did beyond placing: whether a scale moves the item.
struct Placed {
    scaled: bool,
}

/// Writes a layer's or a group's transform `ks` onto item `id`: pivot, position (or the curve it
/// follows), scale, rotation and opacity, each still or keyed; `shift` is its Lottie parent's
/// anchor, which `child_of` doesn't subtract.
fn transform(
    out: &mut Out,
    r: &mut Reader,
    id: &str,
    ks: &Obj,
    at: Place,
    holder: Holder,
) -> Placed {
    let Place {
        time,
        layer,
        shift,
        orient,
    } = at;
    let mut scaled = false;
    if let Some(a) = r.prop(ks, "a", "transform/a") {
        if a.keyed() {
            out.issue(
                "anchor_keyed",
                layer,
                Some("transform/a"),
                "a keyed anchor keeps its first point: an item's pivot isn't keyed",
            );
        }
        let (ax, ay) = (a.at(0, 0.0), a.at(1, 0.0));
        if (ax, ay) != (0.0, 0.0) {
            put(out.item(id), &["at", "pivot"], ns(&[ax, ay]));
        }
    }
    let shifted = |p: &Prop| {
        p.map(|v| {
            vec![
                v.first().copied().unwrap_or(0.0) - shift[0],
                v.get(1).copied().unwrap_or(0.0) - shift[1],
            ]
        })
    };
    let split = ks
        .get("p")
        .and_then(|p| p.get("s"))
        .and_then(Value::as_bool)
        == Some(true);
    if split {
        let p = ks
            .get("p")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let (x, y) = (
            r.prop(&p, "x", "transform/p/x"),
            r.prop(&p, "y", "transform/p/y"),
        );
        let (x, y) = (
            x.unwrap_or(Prop::Fixed(vec![0.0])),
            y.unwrap_or(Prop::Fixed(vec![0.0])),
        );
        let (x, y) = (
            x.map(|v| vec![v[0] - shift[0]]),
            y.map(|v| vec![v[0] - shift[1]]),
        );
        if (x.at(0, 0.0), y.at(0, 0.0)) != (0.0, 0.0) || x.keyed() || y.keyed() {
            put(
                out.item(id),
                &["at", "pos"],
                ns(&[x.at(0, 0.0), y.at(0, 0.0)]),
            );
        }
        out.keys(id, "at/pos/0", Ty::F32, &x, time);
        out.keys(id, "at/pos/1", Ty::F32, &y, time);
    } else if let Some(p) = r.prop(ks, "p", "transform/p") {
        let p = shifted(&p);
        let spatial = matches!(&p, Prop::Keys(k) if k.iter().any(|k| k.to.iter().chain(&k.ti).any(|t| *t != 0.0)));
        if spatial {
            follow(out, id, &p, time, orient);
        } else if (p.at(0, 0.0), p.at(1, 0.0)) != (0.0, 0.0) || p.keyed() {
            out.write(id, &["at", "pos"], Ty::Vec2, &p, time);
        }
    }
    if let Some(sc) = r.prop(ks, "s", "transform/s") {
        let sc = sc.map(|v| v.iter().take(2).map(|x| x / 100.0).collect());
        if sc.keyed() || (sc.at(0, 1.0), sc.at(1, 1.0)) != (1.0, 1.0) {
            scaled = true;
            out.write(id, &["at", "scale"], Ty::Vec2, &sc, time);
        }
    }
    let rot = r
        .prop(ks, "r", "transform/r")
        .or_else(|| r.prop(ks, "rz", "transform/rz"));
    if let Some(rot) = rot {
        if rot.keyed() || rot.at(0, 0.0) != 0.0 {
            put(
                out.item(id),
                &["at", "rot"],
                ns(&[0.0, 0.0, rot.at(0, 0.0)]),
            );
            out.keys(id, "at/rot/2", Ty::F32, &rot, time);
        }
    }
    for k in ["rx", "ry"] {
        if r.prop(ks, k, &format!("transform/{k}"))
            .is_some_and(|p| p.keyed() || p.at(0, 0.0) != 0.0)
        {
            out.issue(
                "layer_3d",
                layer,
                Some(&format!("transform/{k}")),
                "a turn out of the plane; the 2D document keeps its turn about z only",
            );
        }
    }
    if r.prop(ks, "sk", "transform/sk")
        .is_some_and(|p| p.keyed() || p.at(0, 0.0) != 0.0)
    {
        out.issue(
            "skew",
            layer,
            Some("transform/sk"),
            "a skew, which an item's transform doesn't hold; it is left out",
        );
    }
    if let Some(o) = r.prop(ks, "o", "transform/o") {
        let o = o.map(|v| vec![v[0] / 100.0]);
        if holder != Holder::Null && (o.keyed() || o.at(0, 1.0) != 1.0) {
            let field: &[&str] = if holder == Holder::Group {
                &["params", "opacity"]
            } else {
                &["adjust", "opacity"]
            };
            out.write(id, field, Ty::F32, &o, time);
        }
    }
    // An item's `at` vectors are three numbers: z is 0 for a position or a pivot, 1 for a scale.
    if let Some(at) = out.item(id).get_mut("at").and_then(Value::as_object_mut) {
        for (k, z) in [("pos", 0.0), ("pivot", 0.0), ("scale", 1.0)] {
            if let Some(Value::Array(v)) = at.get_mut(k) {
                if v.len() == 2 {
                    v.push(n(z));
                }
            }
        }
    }
    Placed { scaled }
}

/// A position keyed with spatial tangents: its keys' curve flattened into the path of a
/// `follow_path`, and a keyed data value that holds the share of the curve's length reached,
/// keyed at the position's times with its eases, so it moves along each segment by arc length.
fn follow(out: &mut Out, id: &str, p: &Prop, time: Time, orient: bool) {
    let Prop::Keys(keys) = p else { return };
    let mut points = vec![[keys[0].s[0], keys[0].s.get(1).copied().unwrap_or(0.0)]];
    let mut reach = vec![0.0];
    for w in keys.windows(2) {
        let (a, b) = (&w[0], &w[1]);
        let v = |s: &[f64]| [s[0], s.get(1).copied().unwrap_or(0.0)];
        let (p0, p3) = (v(&a.s), v(&b.s));
        let t = |t: &[f64]| {
            [
                t.first().copied().unwrap_or(0.0),
                t.get(1).copied().unwrap_or(0.0),
            ]
        };
        let (to, ti) = (t(&a.to), t(&a.ti));
        let before = points.len() - 1;
        geom::flatten(
            [
                p0,
                [p0[0] + to[0], p0[1] + to[1]],
                [p3[0] + ti[0], p3[1] + ti[1]],
                p3,
            ],
            FLAT,
            &mut points,
        );
        reach.push(reach[reach.len() - 1] + geom::length(&points[before..]));
    }
    let total = reach.last().copied().unwrap_or(0.0);
    let name = out.names.take(&format!("{id}.along"), "along");
    out.data.insert(name.clone(), json!(0));
    let list = keys
        .iter()
        .zip(&reach)
        .map(|(k, l)| {
            (
                out.flicks(time.at(k.t)),
                n(if total > 0.0 { l / total } else { 0.0 }),
                interp(k, 0),
            )
        })
        .collect();
    out.channel(
        &format!("{id}.fraction"),
        format!("data/{name}"),
        "f32",
        list,
    );
    put(out.item(id), &["at", "pos"], ns(&points[0]));
    let path: Vec<Value> = points.iter().map(|q| ns(q)).collect();
    let mut c =
        json!({"owner": id, "kind": "follow_path", "path": path, "fraction": {"data": name}});
    if orient {
        c["orient"] = json!(true);
    }
    out.constraints.insert(name, c);
}

/// Keys `visible` where the layer's in and out points don't cover the composition.
fn visibility(out: &mut Out, ctx: &Ctx, id: &str, layer: &Value, time: Time) {
    let (start, end) = (
        time.at(f(layer, "ip", ctx.span.0)),
        time.at(f(layer, "op", ctx.span.1)),
    );
    let (from, to) = ctx.span;
    if start <= from && end >= to {
        return;
    }
    let mut keys = Vec::new();
    if start > from {
        keys.push((out.flicks(from), json!(false), None));
    }
    keys.push((out.flicks(start.max(from).min(to)), json!(true), None));
    if end < to {
        keys.push((out.flicks(end.max(start)), json!(false), None));
    }
    out.channel(
        &format!("{id}.visible"),
        format!("items/{id}/visible"),
        "bool",
        keys,
    );
    put(out.item(id), &["visible"], json!(start <= from));
}

/// The fields every item takes.
fn base(out: &mut Out, id: &str, kind: &str, name: &str, rank: &str, parent: Option<&str>) {
    let item = out.item(id);
    item["id"] = json!(id);
    item["kind"] = json!(kind);
    item["layer"] = json!("main");
    item["name"] = json!(name);
    item["order"] = json!(rank);
    if item.get("params").is_none() {
        item["params"] = json!({});
    }
    if let Some(p) = parent {
        item["parent"] = json!(p);
    }
}

/// A layer's masks: the first one the document holds as `mask@1` over `target`, its shape a rect
/// or a path item, placed by the layer's transform; the rest reported.
fn masks(out: &mut Out, r: &mut Reader, ctx: &Ctx, layer: &Value, spot: Spot) {
    let Spot {
        target,
        rank,
        parent,
        place,
    } = spot;
    let (time, label, shift) = (place.time, place.layer, place.shift);
    let Some(list) = layer.get("masksProperties").and_then(Value::as_array) else {
        return;
    };
    let ks = layer
        .get("ks")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let mut kept = false;
    for (k, m) in list.iter().enumerate() {
        let Some(mo) = m.as_object() else { continue };
        let mode = s(m, "mode");
        if mode == "n" {
            continue;
        }
        let what = format!("masks/{k}");
        let opacity = r.number(mo, "o", &format!("{what}/o"), 100.0);
        let refusal = if !mode.is_empty() && mode != "a" {
            Some(format!(
                "a mask in mode {mode}; masks combine only by adding"
            ))
        } else if m.get("inv").and_then(Value::as_bool) == Some(true) {
            Some("an inverted mask".to_string())
        } else if opacity < 100.0 {
            Some(format!("a mask at {opacity}% opacity"))
        } else if kept {
            Some("a second mask on one layer".to_string())
        } else {
            None
        };
        if let Some(why) = refusal {
            out.issue(
                "mask_unsupported",
                label,
                Some(&what),
                format!("{why}, which the document can't hold yet; it is left out"),
            );
            continue;
        }
        let shape = r.shape(mo, "pt", &format!("{what}/pt"));
        let expand = r
            .prop(mo, "x", &format!("{what}/x"))
            .map_or(0.0, |p| p.at(0, 0.0));
        let id = out.ids.take(&s(m, "nm"), &format!("{target}.mask"));
        let nm = s(m, "nm");
        let named = if nm.is_empty() || scriptlike(&nm) {
            id.clone()
        } else {
            nm
        };
        base(out, &id, "mask@1", &named, rank, parent);
        // A mask clips a collection's members: here the one layer it sits on.
        let over = out.ids.take(&format!("{id}.over"), "mask.over");
        out.collections
            .insert(over.clone(), json!({"members": [target]}));
        let still_rect = match &shape {
            Some(ShapeProp::Fixed(b)) => b.rect(),
            _ => None,
        };
        let params = match (still_rect, &shape) {
            (Some(bx), _) => {
                let mut p = json!({"shape": "rect", "box": ns(&bx), "applies_to": over});
                if expand != 0.0 {
                    p["expand"] = n(expand);
                }
                p
            }
            (None, Some(sp)) => {
                if expand != 0.0 {
                    out.issue("mask_unsupported", label, Some(&format!("{what}/x")), "a path mask's expansion, which the document can't hold yet; the mask keeps its edge");
                }
                let path = out.ids.take(&format!("{id}.shape"), "mask.shape");
                base(out, &path, "path@1", &path, rank, parent);
                let d = match sp {
                    ShapeProp::Fixed(b) => d_of(std::slice::from_ref(b)),
                    ShapeProp::Keys(keys) => {
                        let list = keys
                            .iter()
                            .map(|k| {
                                (
                                    out.flicks(time.at(k.t)),
                                    json!(geom::key_d(&k.s)),
                                    interp(k, 0),
                                )
                            })
                            .collect();
                        out.channel(
                            &format!("{path}.path"),
                            format!("items/{path}/path"),
                            "path",
                            list,
                        );
                        d_of(&[keys[0].s.clone()])
                    }
                };
                put(out.item(&path), &["params", "d"], json!(d));
                // Geometry only, for the mask's outline: it draws nothing itself.
                put(out.item(&path), &["visible"], json!(false));
                transform(
                    out,
                    r,
                    &path,
                    &ks,
                    Place {
                        time,
                        layer: label,
                        shift,
                        orient: false,
                    },
                    Holder::Drawn,
                );
                json!({"shape": path, "applies_to": over})
            }
            (None, None) => continue,
        };
        put(out.item(&id), &["params"], params);
        transform(
            out,
            r,
            &id,
            &ks,
            Place {
                time,
                layer: label,
                shift,
                orient: false,
            },
            Holder::Drawn,
        );
        visibility(out, ctx, &id, layer, time);
        kept = true;
    }
}

/// A shape layer whose own transform is the identity and whose shapes are one group whose
/// transform isn't: that group's transform, and the group's other elements.
fn lifted(r: &mut Reader, layer: &Value) -> Option<(Obj, Vec<Value>)> {
    if !still(r, layer.get("ks").and_then(Value::as_object)) {
        return None;
    }
    let [group] = layer.get("shapes")?.as_array()?.as_slice() else {
        return None;
    };
    let ty = |v: &Value| {
        v.get("ty")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    if ty(group) != "gr" || group.get("hd").and_then(Value::as_bool) == Some(true) {
        return None;
    }
    let it = group.get("it")?.as_array()?;
    let tr = it.iter().rev().find(|e| ty(e) == "tr")?.as_object()?;
    if still(r, Some(tr)) {
        return None;
    }
    Some((
        tr.clone(),
        it.iter().filter(|e| ty(e) != "tr").cloned().collect(),
    ))
}

/// One composition's layers, top first in the file, as items under `comp.parent`.
pub fn comp(out: &mut Out, r: &mut Reader, ctx: &Ctx, comp: &Comp, seen: &mut BTreeSet<String>) {
    let layers = comp.layers;
    let count = layers.len();
    let ids: Vec<String> = layers
        .iter()
        .enumerate()
        .map(|(k, l)| out.ids.take(&s(l, "nm"), &format!("layer.{}", k + 1)))
        .collect();
    let by_ind: BTreeMap<i64, usize> = layers
        .iter()
        .enumerate()
        .filter_map(|(k, l)| Some((l.get("ind")?.as_f64()? as i64, k)))
        .collect();
    let parent = comp.parent.as_deref();
    let mut sources = BTreeSet::new();
    // Each `child_of` made here, with its parent's item and its layer, kept once the parents are.
    let mut parented: Vec<(String, String, String)> = Vec::new();
    for (k, layer) in layers.iter().enumerate() {
        let id = ids[k].clone();
        let rank = order(count - 1 - k);
        // Issues name the layer by its `nm` as the file writes it; the item takes it as its
        // name unless it reads as script.
        let name = label(layer, &id);
        let label = match s(layer, "nm") {
            nm if nm.is_empty() => id.clone(),
            nm => nm,
        };
        for p in scripted(layer, "") {
            out.issue("expression", &label, Some(&p), "an expression, which the import never carries into a document; the property keeps its own value");
        }
        let ty = f(layer, "ty", -1.0) as i64;
        let ptime = comp.time.within(f(layer, "st", 0.0), 1.0);
        let ks = layer
            .get("ks")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        // Lottie parenting: `child_of` the parent's pose in the composition both sit in (its
        // `at` as its channels and constraints write it), the parent's anchor taken off, so the
        // draw order stays the file's and a precomp that moves them moves both once.
        let lottie_parent = layer
            .get("parent")
            .and_then(Value::as_f64)
            .map(|p| p as i64);
        let mut shift = [0.0, 0.0];
        if let Some(p) = lottie_parent {
            match by_ind.get(&p) {
                Some(&pk) => {
                    let pks = layers[pk]
                        .get("ks")
                        .and_then(Value::as_object)
                        .cloned()
                        .unwrap_or_default();
                    if let Some(a) = r.prop(&pks, "a", "transform/a") {
                        shift = [a.at(0, 0.0), a.at(1, 0.0)];
                    }
                    let c = out.names.take(&format!("{id}.parent"), "parent");
                    out.constraints.insert(c.clone(), json!({"owner": id, "kind": "child_of", "parent": format!("items/{}/at/pos", ids[pk])}));
                    parented.push((c, ids[pk].clone(), label.clone()));
                }
                None => out.issue(
                    "parent_missing",
                    &label,
                    Some("parent"),
                    format!("its parent layer {p} isn't in its composition"),
                ),
            }
        }
        let orient = f(layer, "ao", 0.0) == 1.0;
        if layer
            .get("ef")
            .and_then(Value::as_array)
            .is_some_and(|e| !e.is_empty())
        {
            let names: Vec<String> = layer["ef"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|e| s(e, "nm"))
                .collect();
            out.issue(
                "layer_effect",
                &label,
                Some("ef"),
                format!(
                    "layer effects ({}), which come back as no code; they are left out",
                    names.join(", ")
                ),
            );
        }
        if f(layer, "ddd", 0.0) == 1.0 {
            out.issue(
                "layer_3d",
                &label,
                Some("ddd"),
                "a 3D layer; it comes in flat, its turns out of the plane left out",
            );
        }
        let blend = f(layer, "bm", 0.0) as usize;
        let mut placed_kind = "group@1";
        match ty {
            4 => {
                // A layer no other one parents to, its own transform the identity and its shapes
                // one group with a transform: the group's transform is the item's (as the export
                // writes a masked item, its mask in the layer's space), the group's rest its shapes.
                let followed = layers.iter().any(|l| {
                    l.get("parent").and_then(Value::as_f64).map(|p| p as i64)
                        == layer.get("ind").and_then(Value::as_f64).map(|i| i as i64)
                });
                let (ks, list) = match lifted(r, layer).filter(|_| !followed) {
                    Some((tr, rest)) => (tr, rest),
                    None => (
                        ks.clone(),
                        layer
                            .get("shapes")
                            .and_then(Value::as_array)
                            .cloned()
                            .unwrap_or_default(),
                    ),
                };
                let walked = shapes::walk(&list);
                for (t, nm) in &walked.left {
                    if t == "mm" {
                        out.issue("merge_paths", &label, Some(&format!("shapes/{nm}")), "merge paths, which the document doesn't take (2D booleans are out); the shapes draw unmerged");
                    } else {
                        out.issue("shape_unsupported", &label, Some(&format!("shapes/{nm}")), format!("a shape element of type {t}, which the import doesn't read; it is left out"));
                    }
                }
                let one = match walked.drawn.as_slice() {
                    [d] => {
                        let mut chain = d.group;
                        let mut ok = true;
                        while let Some(g) = chain {
                            ok &= still(r, walked.groups[g].tr.as_ref());
                            chain = walked.groups[g].parent;
                        }
                        ok.then_some(d)
                    }
                    _ => None,
                };
                if let Some(d) = one {
                    placed_kind = "drawn";
                    base(out, &id, "path@1", &name, &rank, parent);
                    let placed = transform(
                        out,
                        r,
                        &id,
                        &ks,
                        Place {
                            time: ptime,
                            layer: &label,
                            shift,
                            orient,
                        },
                        Holder::Drawn,
                    );
                    items::drawn(
                        out,
                        r,
                        &At {
                            id: &id,
                            layer: &label,
                            time: ptime,
                        },
                        d,
                        placed.scaled,
                    );
                } else {
                    base(out, &id, "group@1", &name, &rank, parent);
                    let placed = transform(
                        out,
                        r,
                        &id,
                        &ks,
                        Place {
                            time: ptime,
                            layer: &label,
                            shift,
                            orient,
                        },
                        Holder::Group,
                    );
                    tree(out, r, &id, &label, ptime, &walked, placed.scaled);
                }
            }
            0 => {
                let ref_id = s(layer, "refId");
                let asset = ctx.assets.get(&ref_id).copied();
                base(out, &id, "group@1", &name, &rank, parent);
                let at = Place {
                    time: ptime,
                    layer: &label,
                    shift,
                    orient,
                };
                transform(out, r, &id, &ks, at, Holder::Group);
                let spot = Spot {
                    target: &id,
                    rank: &rank,
                    parent,
                    place: Place {
                        orient: false,
                        ..at
                    },
                };
                masks(out, r, ctx, layer, spot);
                if layer.get("tm").is_some() {
                    out.issue("time_remap", &label, Some("tm"), "a precomp's time remap, which the import doesn't map; its layers play at its start and stretch");
                }
                if blend != 0 {
                    if let Some(mode) = deep_canvas::blend::MODES.get(blend) {
                        put(out.item(&id), &["params", "blend"], json!(mode));
                    }
                }
                match asset
                    .and_then(|a| a.get("layers"))
                    .and_then(Value::as_array)
                {
                    Some(inner) if comp.depth < DEPTH && !seen.contains(&ref_id) => {
                        seen.insert(ref_id.clone());
                        let child = Comp {
                            layers: inner,
                            parent: Some(id.clone()),
                            time: ptime.within(0.0, f(layer, "sr", 1.0)),
                            depth: comp.depth + 1,
                        };
                        comp_flush(out, r, &label);
                        self::comp(out, r, ctx, &child, seen);
                        seen.remove(&ref_id);
                    }
                    Some(_) => out.issue(
                        "precomp_loop",
                        &label,
                        Some("refId"),
                        format!("the precomp {ref_id} nests in itself or deeper than {DEPTH}"),
                    ),
                    None => out.issue(
                        "precomp_missing",
                        &label,
                        Some("refId"),
                        format!("the file holds no precomp {ref_id}"),
                    ),
                }
                visibility(out, ctx, &id, layer, comp.time);
                comp_flush(out, r, &label);
                continue;
            }
            1 => {
                placed_kind = "drawn";
                base(out, &id, "rect@1", &name, &rank, parent);
                let (w, h) = (f(layer, "sw", 0.0), f(layer, "sh", 0.0));
                let hex = s(layer, "sc");
                let c = crate::colors::parse_hex(&hex).unwrap_or([0.0, 0.0, 0.0]);
                let role = out.colors.role(rgb(&c), &label);
                put(
                    out.item(&id),
                    &["params"],
                    json!({"box": ns(&[0.0, 0.0, w, h]), "paint": {"fill": {"role": role}}}),
                );
                transform(
                    out,
                    r,
                    &id,
                    &ks,
                    Place {
                        time: ptime,
                        layer: &label,
                        shift,
                        orient,
                    },
                    Holder::Drawn,
                );
            }
            3 => {
                base(out, &id, "group@1", &name, &rank, parent);
                transform(
                    out,
                    r,
                    &id,
                    &ks,
                    Place {
                        time: ptime,
                        layer: &label,
                        shift,
                        orient,
                    },
                    Holder::Null,
                );
            }
            2 => {
                out.issue(
                    "image_layer",
                    &label,
                    None,
                    "an image layer, which the import doesn't bring in; it is left out",
                );
                comp_flush(out, r, &label);
                continue;
            }
            5 => {
                out.issue("text_layer", &label, None, "a text layer, which Lottie 1.0.1 doesn't define and the import doesn't read as code; it is left out");
                comp_flush(out, r, &label);
                continue;
            }
            t => {
                out.issue(
                    "layer_unsupported",
                    &label,
                    None,
                    format!("a layer of type {t}, which the import doesn't read; it is left out"),
                );
                comp_flush(out, r, &label);
                continue;
            }
        }
        if blend != 0 {
            match (placed_kind, deep_canvas::blend::MODES.get(blend)) {
                ("group@1", Some(mode)) => put(out.item(&id), &["params", "blend"], json!(mode)),
                _ => out.issue("blend_mode", &label, Some("bm"), format!("blend mode {blend} on a layer that draws on its own; only a group takes a blend mode, so it draws normally")),
            }
        }
        if layer.get("hd").and_then(Value::as_bool) == Some(true) {
            put(out.item(&id), &["visible"], json!(false));
        } else if f(layer, "td", 0.0) != 1.0 {
            visibility(out, ctx, &id, layer, comp.time);
        }
        if ty != 0 {
            masks(
                out,
                r,
                ctx,
                layer,
                Spot {
                    target: &id,
                    rank: &rank,
                    parent,
                    place: Place {
                        time: ptime,
                        layer: &label,
                        shift,
                        orient: false,
                    },
                },
            );
        }
        // A matte: its source is the layer `tp` names, or the one above.
        let tt = f(layer, "tt", 0.0) as i64;
        if (1..=4).contains(&tt) {
            let src = match layer.get("tp").and_then(Value::as_f64) {
                Some(tp) => by_ind.get(&(tp as i64)).copied(),
                None => k.checked_sub(1),
            };
            match src {
                Some(sk) => {
                    sources.insert(sk);
                    let mode =
                        ["alpha", "alpha_inverted", "luma", "luma_inverted"][(tt - 1) as usize];
                    let cl = s(layer, "cl");
                    let matte = out.ids.take(&cl, &format!("{id}.matte"));
                    base(out, &matte, "matte@1", &matte, &rank, parent);
                    let mut params = json!({"source": ids[sk], "mode": mode, "applies_to": id});
                    if tt >= 3 {
                        params["luma"] = json!("encoded");
                    }
                    put(out.item(&matte), &["params"], params);
                }
                None => out.issue(
                    "matte_missing",
                    &label,
                    Some("tp"),
                    "a matte whose source layer isn't in its composition; it is left out",
                ),
            }
        }
        comp_flush(out, r, &label);
    }
    // A parent or a matte source the import left out (a text layer, an image) holds nothing.
    for (c, parent, label) in parented {
        if !out.items.contains_key(&parent) {
            out.constraints.remove(&c);
            out.issue("parent_missing", &label, Some("parent"), format!("its parent {parent} is a layer the import leaves out; it keeps its own transform"));
        }
    }
    let gone: Vec<String> = out
        .items
        .iter()
        .filter(|(_, i)| {
            i["kind"] == json!("matte@1")
                && i.pointer("/params/source")
                    .and_then(Value::as_str)
                    .is_some_and(|s| ids.iter().any(|x| x == s) && !out.items.contains_key(s))
        })
        .map(|(k, _)| k.clone())
        .collect();
    for m in gone {
        let target = out
            .items
            .get(&m)
            .and_then(|i| i.pointer("/params/applies_to"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        out.items.remove(&m);
        out.issue(
            "matte_missing",
            &target,
            Some("tt"),
            "a matte whose source is a layer the import leaves out; the layer draws unmatted",
        );
    }
    // A matte's source is hidden and still evaluates.
    for k in sources {
        if let Some(item) = out.items.get_mut(&ids[k]) {
            item["visible"] = json!(false);
        }
        let ch = format!("items/{}/visible", ids[k]);
        out.channels
            .retain(|_, c| c.get("target").and_then(Value::as_str) != Some(&ch));
    }
}

/// The findings reading a layer made, as its issues.
fn comp_flush(out: &mut Out, r: &mut Reader, label: &str) {
    for p in std::mem::take(&mut r.found.expressions) {
        out.issue("expression", label, Some(&p), "an expression in a slot the layer reads, which the import never carries into a document; the property keeps its own value");
    }
    for p in std::mem::take(&mut r.found.missing_slots) {
        out.issue(
            "slot_missing",
            label,
            Some(&p),
            "a property naming a slot the file doesn't hold; it takes its default",
        );
    }
}

/// Every property of `v` that carries an expression (an `x` string), by its path: object keys,
/// and a list's entries by their `nm` where they have one. Its text is never read.
fn scripted(v: &Value, at: &str) -> Vec<String> {
    match v {
        Value::Object(o) => {
            let mut out = Vec::new();
            if o.get("x").is_some_and(Value::is_string)
                && (o.contains_key("k") || o.contains_key("a"))
            {
                out.push(at.trim_start_matches('/').to_string());
            }
            for (k, x) in o {
                if k != "x" {
                    out.extend(scripted(x, &format!("{at}/{k}")));
                }
            }
            out
        }
        Value::Array(a) => a
            .iter()
            .enumerate()
            .flat_map(|(i, x)| match x.get("nm").and_then(Value::as_str) {
                Some(nm) if !nm.is_empty() => scripted(x, &format!("{at}/{nm}")),
                _ => scripted(x, &format!("{at}/{i}")),
            })
            .collect(),
        _ => Vec::new(),
    }
}

/// A child of a shape tree's group: its rank, whether it is a group, and its index.
type Child = ((usize, usize), bool, usize);

/// A shape layer's groups and items under its own group `root`.
fn tree(
    out: &mut Out,
    r: &mut Reader,
    root: &str,
    label: &str,
    time: Time,
    walked: &shapes::Walked,
    scaled: bool,
) {
    // Each group's ID, under its parent's.
    let mut gids: Vec<String> = Vec::new();
    for g in &walked.groups {
        let parent = g.parent.map_or(root.to_string(), |p| gids[p].clone());
        let name = if g.nm.is_empty() {
            "group".to_string()
        } else {
            g.nm.clone()
        };
        gids.push(out.ids.under(&parent, &name));
    }
    // Each parent's children, top first by rank, then ranked bottom up.
    let mut children: BTreeMap<Option<usize>, Vec<Child>> = BTreeMap::new();
    for (k, g) in walked.groups.iter().enumerate() {
        children
            .entry(g.parent)
            .or_default()
            .push((g.rank, true, k));
    }
    for (k, d) in walked.drawn.iter().enumerate() {
        children
            .entry(d.group)
            .or_default()
            .push((d.rank, false, k));
    }
    let mut ranks: BTreeMap<(bool, usize), String> = BTreeMap::new();
    for list in children.values_mut() {
        list.sort();
        let count = list.len();
        for (i, (_, group, k)) in list.iter().enumerate() {
            ranks.insert((*group, *k), order(count - 1 - i));
        }
    }
    let mut scaled_group = vec![false; walked.groups.len()];
    for (k, g) in walked.groups.iter().enumerate() {
        let parent = g.parent.map_or(root.to_string(), |p| gids[p].clone());
        let name = if g.nm.is_empty() {
            gids[k].clone()
        } else {
            g.nm.clone()
        };
        base(
            out,
            &gids[k],
            "group@1",
            &name,
            &ranks[&(true, k)],
            Some(&parent),
        );
        if let Some(tr) = &g.tr {
            let placed = transform(
                out,
                r,
                &gids[k],
                tr,
                Place {
                    time,
                    layer: label,
                    shift: [0.0, 0.0],
                    orient: false,
                },
                Holder::Group,
            );
            scaled_group[k] = placed.scaled || g.parent.is_some_and(|p| scaled_group[p]);
        }
    }
    for (k, d) in walked.drawn.iter().enumerate() {
        let parent = d.group.map_or(root.to_string(), |g| gids[g].clone());
        let id = out
            .ids
            .under(&parent, if d.nm.is_empty() { "shape" } else { &d.nm });
        let name = if d.nm.is_empty() {
            id.clone()
        } else {
            d.nm.clone()
        };
        base(
            out,
            &id,
            "path@1",
            &name,
            &ranks[&(false, k)],
            Some(&parent),
        );
        let scaled = scaled || d.group.is_some_and(|g| scaled_group[g]);
        items::drawn(
            out,
            r,
            &At {
                id: &id,
                layer: label,
                time,
            },
            d,
            scaled,
        );
    }
}

/// The root's markers: each with its name, its start and its span in flicks; a span that runs
/// exactly to the next marker (or the end, for the last) is the span the export writes for a
/// marker of none, so it reads back as 0.
pub fn markers(out: &mut Out, list: &[Value], end: f64) {
    let mut marks: Vec<(f64, f64, String)> = list
        .iter()
        .map(|m| (f(m, "tm", 0.0), f(m, "dr", 0.0), s(m, "cm")))
        .collect();
    marks.sort_by(|a, b| a.0.total_cmp(&b.0));
    let mut ids = crate::ids::Ids::default();
    for (k, (tm, dr, cm)) in marks.iter().enumerate() {
        let next = marks.get(k + 1).map_or(end, |m| m.0);
        let to_next = dr > &0.0 && (tm + dr - next).abs() < 1e-6;
        let id = ids.take(cm, &format!("marker.{}", k + 1));
        let name = if cm.is_empty() || scriptlike(cm) {
            id.clone()
        } else {
            cm.clone()
        };
        let span = if to_next {
            0
        } else {
            out.flicks(tm + dr) - out.flicks(*tm)
        };
        let mut m = json!({"t": out.flicks(*tm), "kind": "section", "name": name});
        if span > 0 {
            m["span"] = json!(span);
        }
        out.markers.insert(id, m);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_layers_expressions_are_found_by_their_paths() {
        let layer = serde_json::json!({"nm": "L", "ks": {"o": {"a": 0, "k": 100, "x": "value"}, "p": {"a": 0, "k": [0, 0]}},
            "shapes": [{"ty": "gr", "nm": "G", "it": [{"ty": "fl", "nm": "F", "c": {"a": 0, "k": [1, 0, 0], "x": ""}}]}]});
        assert_eq!(
            scripted(&layer, ""),
            vec!["ks/o".to_string(), "shapes/G/it/F/c".to_string()]
        );
    }
}
