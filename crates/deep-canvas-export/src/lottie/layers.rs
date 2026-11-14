//! Items as Lottie layers: one layer an item, named by the item's name (Lottie's one name, `nm`),
//! topmost first; a group as a precomp of its children; a mask as a mask on each layer it clips;
//! a matte as its source's layer written above its target as a track matte. Every transform is the item's evaluated one, which already
//! rides its parents, so a precomp's own transform stays the identity.

use deep_canvas_marks::relations::{own_box, place_of, placed, Point};
use deep_canvas_motion::curve::Extrapolate;
use serde_json::{json, Map, Value};

use super::holds::{self, blend_mode, DRAWN};
use super::keys::{self, num, Made, Prop};
use super::{shapes, text, Ctx, Plant, Warning};

/// Every top-level layer, topmost first, and the precomp assets the groups need.
pub fn all(ctx: &mut Ctx, items: &Map<String, Value>, images: bool) -> (Vec<Value>, Vec<Value>) {
    let shown: Vec<&String> = items
        .iter()
        .filter(|(_, i)| i.get("visible") != Some(&Value::Bool(false)))
        .map(|(id, _)| id)
        .collect();
    let containers: Vec<&String> = shown
        .iter()
        .copied()
        .filter(|id| is_container(&items[id.as_str()]))
        .collect();
    let mut assets = Vec::new();
    let mut ind = 0_u32;
    let layers = list(
        ctx,
        items,
        None,
        &shown,
        &containers,
        &mut assets,
        &mut ind,
        images,
    );
    (layers, assets)
}

fn is_container(item: &Value) -> bool {
    matches!(
        item.get("kind").and_then(Value::as_str),
        Some("group@1" | "frame@1")
    )
}

/// An item's name, as its layer's `nm`; its ID where it has none.
pub fn name_of(item: &Value, id: &str) -> String {
    item.get("name")
        .and_then(Value::as_str)
        .filter(|n| !n.is_empty())
        .unwrap_or(id)
        .to_string()
}

/// The masks that clip item `id` inside container `inside`: each mask among its parents up to the
/// container that clips its children, nearest first, then each mask that names the item.
fn masks_on<'a>(
    items: &'a Map<String, Value>,
    id: &str,
    inside: Option<&String>,
) -> Vec<(&'a String, &'a Value)> {
    let is_mask = |m: &Value| m.get("kind").and_then(Value::as_str) == Some("mask@1");
    let mut out = Vec::new();
    let mut at = items
        .get(id)
        .and_then(|i| i.get("parent"))
        .and_then(Value::as_str);
    let mut hops = 0;
    while let Some(p) = at {
        if inside.is_some_and(|c| c == p) || hops > 64 {
            break;
        }
        if let Some((pid, m)) = items.get_key_value(p) {
            let children = m
                .pointer("/params/applies_to")
                .and_then(Value::as_str)
                .is_none_or(|a| a == "children");
            if is_mask(m) && children && m.get("visible") != Some(&Value::Bool(false)) {
                out.push((pid, m));
            }
            at = m.get("parent").and_then(Value::as_str);
        } else {
            break;
        }
        hops += 1;
    }
    out.extend(items.iter().filter(|(_, m)| {
        is_mask(m) && m.pointer("/params/applies_to").and_then(Value::as_str) == Some(id)
    }));
    out
}

/// The nearest container among an item's parents, which it draws inside.
fn container_of<'a>(
    items: &'a Map<String, Value>,
    id: &str,
    containers: &[&'a String],
) -> Option<&'a String> {
    let mut at = items.get(id)?.get("parent").and_then(Value::as_str);
    let mut hops = 0;
    while let Some(p) = at {
        if let Some(c) = containers.iter().find(|c| c.as_str() == p) {
            return Some(c);
        }
        at = items.get(p)?.get("parent").and_then(Value::as_str);
        hops += 1;
        if hops > 64 {
            return None;
        }
    }
    None
}

/// Draw order among siblings: the writer layer's order, then the item's, then its ID.
fn order_key(doc: &Map<String, Value>, item: &Value, id: &str) -> (String, String, String) {
    let layer = item.get("layer").and_then(Value::as_str).unwrap_or("");
    let layer_order = super::pointer(doc, &format!("/layers/{layer}/order"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let order = item
        .get("order")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    (layer_order, order, id.to_string())
}

#[allow(clippy::too_many_arguments)]
fn list(
    ctx: &mut Ctx,
    items: &Map<String, Value>,
    inside: Option<&String>,
    shown: &[&String],
    containers: &[&String],
    assets: &mut Vec<Value>,
    ind: &mut u32,
    images: bool,
) -> Vec<Value> {
    let mut members: Vec<&String> = shown
        .iter()
        .copied()
        .filter(|id| container_of(items, id, containers) == inside)
        .collect();
    members.sort_by_key(|id| order_key(ctx.doc, &items[id.as_str()], id));
    // Mattes: each target's matte, by target.
    let mattes: Vec<(&String, &Value)> = members
        .iter()
        .copied()
        .filter(|id| items[id.as_str()].get("kind").and_then(Value::as_str) == Some("matte@1"))
        .map(|id| (id, &items[id.as_str()]))
        .collect();
    let mut out = Vec::new();
    // Lottie lists the topmost layer first.
    for id in members.iter().rev() {
        let item = &items[id.as_str()];
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
        let masks = masks_on(items, id, inside);
        let masked = !masks.is_empty();
        let mut layer = match kind {
            "group@1" | "frame@1" if containers.contains(id) => {
                let inner = list(ctx, items, Some(id), shown, containers, assets, ind, images);
                assets.push(
                    json!({"id": format!("group:{id}"), "nm": name_of(item, id), "layers": inner}),
                );
                precomp(ctx, id, item)
            }
            "mask@1" | "matte@1" => continue,
            "text@1" => match text::layer(ctx, id, item, masked) {
                Some(l) => l,
                None => continue,
            },
            "image@1" if images => match shape_layer(ctx, id, item, masked) {
                Some(l) => l,
                None => continue,
            },
            k if DRAWN.contains(&k) => match shape_layer(ctx, id, item, masked) {
                Some(l) => l,
                None => continue,
            },
            _ => continue,
        };
        // Each mask that clips it: one of its parents clipping its children, or one naming it.
        for (mid, m) in masks {
            if matches!(ctx.plant, Plant::DropsMask | Plant::DropsMaskListed) {
                if ctx.plant == Plant::DropsMaskListed {
                    ctx.warnings.push(Warning::cant_hold(
                        mid,
                        "a mask".into(),
                        format!("items/{mid}"),
                    ));
                }
                continue;
            }
            if let Some(mp) = mask_property(ctx, mid, m) {
                layer.insert("hasMask".into(), json!(true));
                let list = layer.entry("masksProperties").or_insert(json!([]));
                if let Some(a) = list.as_array_mut() {
                    a.push(mp);
                }
            }
        }
        // Its matte: the source's layer above it, as a track matte.
        let matte = mattes
            .iter()
            .find(|(_, m)| match m.pointer("/params/applies_to") {
                Some(Value::String(t)) => t == id.as_str(),
                Some(Value::Array(a)) => a.iter().any(|t| t.as_str() == Some(id.as_str())),
                _ => false,
            });
        if let Some((mid, m)) = matte {
            if let Some(src) = m.pointer("/params/source").and_then(Value::as_str) {
                if let Some(source) = items.get(src).and_then(|s| shape_layer(ctx, src, s, false)) {
                    let mut source = source;
                    *ind += 1;
                    let src_ind = *ind;
                    source.insert("ind".into(), json!(src_ind));
                    source.insert("td".into(), json!(1));
                    out.push(Value::Object(source));
                    let tt = match m.pointer("/params/mode").and_then(Value::as_str) {
                        Some("alpha_inverted") => 2,
                        Some("luma") => 3,
                        Some("luma_inverted") => 4,
                        _ => 1,
                    };
                    layer.insert("tt".into(), json!(tt));
                    layer.insert("tp".into(), json!(src_ind));
                    layer.insert("cl".into(), json!(mid));
                }
            }
        }
        *ind += 1;
        layer.insert("ind".into(), json!(*ind));
        out.push(Value::Object(layer));
    }
    out
}

/// The fields every layer carries, in Lottie's order.
pub(crate) fn base(name: &str, ty: u8, n: usize) -> Map<String, Value> {
    let mut l = Map::new();
    l.insert("ty".into(), json!(ty));
    l.insert("nm".into(), json!(name));
    l.insert("ind".into(), json!(0));
    l.insert("ip".into(), json!(0));
    l.insert("op".into(), json!(n));
    l.insert("st".into(), json!(0));
    l.insert("sr".into(), json!(1));
    l.insert("ddd".into(), json!(0));
    l
}

fn precomp(ctx: &mut Ctx, id: &str, item: &Value) -> Map<String, Value> {
    let mut l = base(&name_of(item, id), 0, ctx.frames.n);
    l.insert("refId".into(), json!(format!("group:{id}")));
    let size = ctx.doc.get("size").and_then(Value::as_array);
    let dim = |i: usize| {
        size.and_then(|s| s.get(i))
            .and_then(Value::as_f64)
            .unwrap_or(0.0)
    };
    l.insert("w".into(), num(dim(0)));
    l.insert("h".into(), num(dim(1)));
    let o = opacity(ctx, id, &["params", "opacity"]);
    l.insert(
        "ks".into(),
        json!({"a": {"a": 0, "k": [0, 0]}, "p": {"a": 0, "k": [0, 0]}, "s": {"a": 0, "k": [100, 100]}, "r": {"a": 0, "k": 0}, "o": o.json(true)}),
    );
    blend(&mut l, item);
    l
}

fn blend(l: &mut Map<String, Value>, item: &Value) {
    if let Some(b) = item
        .pointer("/params/blend")
        .and_then(Value::as_str)
        .and_then(blend_mode)
    {
        if b != 0 {
            l.insert("bm".into(), json!(b));
        }
    }
}

/// A shape layer for a drawn item: its transform and its shapes. A masked item's transform goes
/// on a group around its shapes, so its layer's own transform, which its masks move with, stays
/// the identity and the masks stay where the document draws them.
pub fn shape_layer(
    ctx: &mut Ctx,
    id: &str,
    item: &Value,
    masked: bool,
) -> Option<Map<String, Value>> {
    let shapes = shapes::of(ctx, id, item)?;
    let mut l = base(&name_of(item, id), 4, ctx.frames.n);
    let ks = transform(ctx, id, item, shapes.baked);
    blend(&mut l, item);
    let ks = placed_on(&mut l, ks, shapes.list, masked, &name_of(item, id));
    l.insert("ks".into(), Value::Object(ks));
    Some(l)
}

/// The layer's own transform and its shapes: `ks` on the layer, or, for a masked item, on a group
/// around its shapes with the layer's own the identity.
pub(crate) fn placed_on(
    l: &mut Map<String, Value>,
    ks: Map<String, Value>,
    list: Vec<Value>,
    masked: bool,
    name: &str,
) -> Map<String, Value> {
    if !masked {
        l.insert("shapes".into(), Value::Array(list));
        return ks;
    }
    let mut tr = Map::new();
    tr.insert("ty".into(), json!("tr"));
    tr.insert("nm".into(), json!("transform"));
    for k in ["p", "a", "s", "r", "o"] {
        if let Some(v) = ks.get(k) {
            tr.insert(k.into(), v.clone());
        }
    }
    tr.insert("sk".into(), json!({"a": 0, "k": 0}));
    tr.insert("sa".into(), json!({"a": 0, "k": 0}));
    let mut it = list;
    it.push(Value::Object(tr));
    let np = it.len();
    l.insert(
        "shapes".into(),
        json!([{"ty": "gr", "nm": name, "np": np, "it": it}]),
    );
    let mut identity = Map::new();
    identity.insert("a".into(), json!({"a": 0, "k": [0, 0]}));
    identity.insert("p".into(), json!({"a": 0, "k": [0, 0]}));
    identity.insert("s".into(), json!({"a": 0, "k": [100, 100]}));
    identity.insert("r".into(), json!({"a": 0, "k": 0}));
    identity.insert("o".into(), json!({"a": 0, "k": 100}));
    identity
}

/// The pivot in the item's own coordinates: its box point, else its origin.
fn pivot(item: &Value) -> [f64; 2] {
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
    let point = item
        .pointer("/at/pivot")
        .and_then(Value::as_str)
        .and_then(Point::parse);
    let params = item
        .get("params")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    match (point, own_box(kind, &params)) {
        (Some(p), Some(b)) => p.of(b),
        _ => [0.0, 0.0],
    }
}

/// A channel that writes exactly item `id`'s `field`, with nothing Lottie can't follow on it
/// (modifiers, a follow, extrapolation past holds, a remap of the item's time).
fn channel<'a>(
    ctx: &'a Ctx,
    id: &str,
    field: &[&str],
) -> Option<&'a deep_canvas_motion::doc::Channel> {
    let m = &ctx.program.motion;
    if m.remapped(id)
        || ctx
            .doc
            .get("placements")
            .is_some_and(|p| p.as_object().is_some_and(|p| !p.is_empty()))
    {
        return None;
    }
    let mut found = m.channels.iter().filter(|c| {
        c.target.owner == id
            && c.target
                .field
                .iter()
                .map(String::as_str)
                .eq(field.iter().copied())
    });
    let c = found.next()?;
    if found.next().is_some() || !c.modifiers.is_empty() || c.follow.is_some() || c.path.is_some() {
        return None;
    }
    if !matches!(c.curve.before, Extrapolate::Hold) || !matches!(c.curve.after, Extrapolate::Hold) {
        return None;
    }
    Some(c)
}

/// Native keys for item `id`'s `field` from its one channel, each value through `map`.
pub fn native(
    ctx: &Ctx,
    id: &str,
    field: &[&str],
    map: &dyn Fn(&[f64]) -> Vec<f64>,
) -> Option<Vec<keys::LKey>> {
    let c = channel(ctx, id, field)?;
    keys::native(&c.curve.keys, ctx.frames.t0(), ctx.frames.frame, map)
}

/// A channel's field path and the map from its values to the property's.
pub type Candidate<'a> = (&'a [&'a str], &'a dyn Fn(&[f64]) -> Vec<f64>);

/// A property from the item's values at each frame (`read`), with native keys from the first
/// channel `candidates` names that reproduces them; a sampled one is listed.
pub fn prop(
    ctx: &mut Ctx,
    id: &str,
    field: &str,
    read: &dyn Fn(&Value) -> Option<Vec<f64>>,
    candidates: &[Candidate],
) -> Prop {
    let Some(series) = ctx.series(id, read) else {
        return Prop::Static(Vec::new());
    };
    let mut fallback = None;
    for (f, map) in candidates {
        if let Some(k) = native(ctx, id, f, *map) {
            let (p, made) = keys::choose(&series, Some(k));
            if made != Made::Sampled {
                return p;
            }
            fallback = Some(p);
        }
    }
    let (p, made) = keys::choose(&series, None);
    if made == Made::Sampled {
        ctx.sampled(id, field);
        return fallback.unwrap_or(p);
    }
    p
}

fn at_num(item: &Value, key: &str, i: usize, default: f64) -> f64 {
    match item.get("at").and_then(|a| a.get(key)) {
        Some(Value::Array(a)) => a.get(i).and_then(Value::as_f64).unwrap_or(default),
        Some(Value::Number(n)) if key != "pos" => n.as_f64().unwrap_or(default),
        _ => default,
    }
}

fn opacity(ctx: &mut Ctx, id: &str, field: &[&str]) -> Prop {
    let ptr = format!("/{}", field.join("/"));
    let read = move |i: &Value| {
        Some(vec![
            i.pointer(&ptr).and_then(Value::as_f64).unwrap_or(1.0) * 100.0,
        ])
    };
    let map = |v: &[f64]| vec![v.first().copied().unwrap_or(1.0) * 100.0];
    prop(ctx, id, &field.join("/"), &read, &[(field, &map)])
}

/// The item's transform: anchor at its pivot, position where the pivot sits, scale, rotation
/// about z and opacity. A baked item's paths already sit where they draw, scaled, moved and
/// turned, so only its opacity stays.
pub(crate) fn transform(ctx: &mut Ctx, id: &str, item: &Value, baked: bool) -> Map<String, Value> {
    let c = pivot(item);
    let mut ks = Map::new();
    let rot_read = |i: &Value| Some(vec![at_num(i, "rot", 2, at_num(i, "rot", 0, 0.0))]);
    let wrap = ctx.plant == Plant::WrapsRotation;
    let rot_map = |v: &[f64]| vec![v.last().copied().unwrap_or(0.0)];
    let mut r = prop(
        ctx,
        id,
        "at/rot",
        &rot_read,
        &[(&["at", "rot"], &rot_map), (&["at", "rot", "2"], &rot_map)],
    );
    if wrap {
        r = wrapped(r, ctx.frames.n);
    }
    if baked {
        // The paths sit where they draw, turn and all.
        ks.insert("a".into(), json!({"a": 0, "k": [0, 0]}));
        ks.insert("p".into(), json!({"a": 0, "k": [0, 0]}));
        ks.insert("s".into(), json!({"a": 0, "k": [100, 100]}));
        r = Prop::Static(vec![0.0]);
    } else {
        ks.insert("a".into(), json!({"a": 0, "k": [num(c[0]), num(c[1])]}));
        let split = channel(ctx, id, &["at", "pos"]).is_none()
            && (channel(ctx, id, &["at", "pos", "0"]).is_some()
                || channel(ctx, id, &["at", "pos", "1"]).is_some());
        if split {
            let x_read = move |i: &Value| Some(vec![at_num(i, "pos", 0, 0.0) + c[0]]);
            let y_read = move |i: &Value| Some(vec![at_num(i, "pos", 1, 0.0) + c[1]]);
            let x_map = move |v: &[f64]| vec![v[0] + c[0]];
            let y_map = move |v: &[f64]| vec![v[0] + c[1]];
            let x = prop(
                ctx,
                id,
                "at/pos/0",
                &x_read,
                &[(&["at", "pos", "0"], &x_map)],
            );
            let y = prop(
                ctx,
                id,
                "at/pos/1",
                &y_read,
                &[(&["at", "pos", "1"], &y_map)],
            );
            ks.insert(
                "p".into(),
                json!({"s": true, "x": x.json(true), "y": y.json(true)}),
            );
        } else {
            let read = move |i: &Value| {
                Some(vec![
                    at_num(i, "pos", 0, 0.0) + c[0],
                    at_num(i, "pos", 1, 0.0) + c[1],
                ])
            };
            let map = move |v: &[f64]| vec![v[0] + c[0], v.get(1).copied().unwrap_or(0.0) + c[1]];
            let p = prop(ctx, id, "at/pos", &read, &[(&["at", "pos"], &map)]);
            ks.insert("p".into(), p.json(false));
        }
        let read = |i: &Value| {
            Some(vec![
                at_num(i, "scale", 0, 1.0) * 100.0,
                at_num(i, "scale", 1, at_num(i, "scale", 0, 1.0)) * 100.0,
            ])
        };
        let map = |v: &[f64]| vec![v[0] * 100.0, v.get(1).copied().unwrap_or(v[0]) * 100.0];
        let s = prop(ctx, id, "at/scale", &read, &[(&["at", "scale"], &map)]);
        ks.insert("s".into(), s.json(false));
    }
    ks.insert("r".into(), r.json(true));
    let o = opacity(ctx, id, &["params", "opacity"]);
    ks.insert("o".into(), o.json(true));
    ks
}

/// The planted writer's rotation: each value wrapped into [−180, 180].
fn wrapped(p: Prop, n: usize) -> Prop {
    let w = |v: f64| {
        let mut x = v % 360.0;
        if x > 180.0 {
            x -= 360.0;
        } else if x < -180.0 {
            x += 360.0;
        }
        x
    };
    let series: Vec<Vec<f64>> = (0..n)
        .map(|j| p.at(j as f64).into_iter().map(w).collect())
        .collect();
    keys::sampled(&series)
}

/// A mask's Lottie mask: its shape where it draws, keyed where it moves.
fn mask_property(ctx: &mut Ctx, id: &str, item: &Value) -> Option<Value> {
    let shape = item
        .pointer("/params/shape")
        .and_then(Value::as_str)
        .unwrap_or("rect")
        .to_string();
    let read_shape = |items: &Map<String, Value>| -> Option<Vec<deep_canvas_marks::path::Verb>> {
        if shape == "rect" {
            let m = items.get(id)?;
            let b: Vec<f64> = m
                .pointer("/params/box")?
                .as_array()?
                .iter()
                .filter_map(Value::as_f64)
                .collect();
            let local = [*b.first()?, *b.get(1)?, *b.get(2)?, *b.get(3)?];
            let b = placed(local, place_of(m, Some(local)));
            return Some(deep_canvas_marks::outline::rect(b, 0.0));
        }
        // A path-shaped mask clips by the path's outline where it draws, turn and all.
        deep_canvas_marks::scene::item_outline(items, &shape)
    };
    let frames: Option<Vec<Vec<deep_canvas_marks::path::Verb>>> =
        ctx.evals.iter().map(read_shape).collect();
    let frames = frames?;
    let holds = hold_times(ctx, &[id, &shape]);
    let pt = shapes::path_prop_holding(ctx, id, "params/shape", &frames, holds)?;
    Some(
        json!({"nm": name_of(item, id), "mode": "a", "inv": false, "pt": pt, "o": {"a": 0, "k": 100}, "x": {"a": 0, "k": 0}}),
    )
}

/// Where an evaluated item draws, in document units, from its own box and its place.
pub fn world_box(item: &Value) -> Option<[f64; 4]> {
    let kind = item.get("kind").and_then(Value::as_str)?;
    let params = item.get("params").and_then(Value::as_object)?;
    let local = own_box(kind, params)?;
    Some(placed(local, place_of(item, Some(local))))
}

#[allow(dead_code)]
pub fn listed_kind(kind: &str) -> bool {
    holds::HELD.contains(&kind) || DRAWN.contains(&kind)
}

/// The times (export frames) of the keys that move items `ids`, when every channel on them holds
/// (no other interpolation, no modifier, driver, constraint or remap): Lottie's own hold keys then
/// give a shape built from them exactly.
pub fn hold_times(ctx: &Ctx, ids: &[&str]) -> Option<Vec<f64>> {
    let m = &ctx.program.motion;
    if ids.iter().any(|id| {
        m.remapped(id)
            || m.drivers.iter().any(|d| d.target.owner == *id)
            || m.constraints.iter().any(|c| c.owner == *id)
    }) {
        return None;
    }
    let mut times = Vec::new();
    for c in m
        .channels
        .iter()
        .filter(|c| ids.contains(&c.target.owner.as_str()))
    {
        if !c.modifiers.is_empty()
            || c.follow.is_some()
            || c.curve
                .keys
                .iter()
                .any(|k| !matches!(k.interp, deep_canvas_motion::curve::Interp::Hold))
        {
            return None;
        }
        times.extend(c.curve.keys.iter().map(|k| ctx.frames.at(k.t)));
    }
    times.sort_by(f64::total_cmp);
    times.dedup();
    Some(times)
}
