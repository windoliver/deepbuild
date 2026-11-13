//! What scene3d runs and draws for canvas modules it doesn't name (issue #226): a deform a module
//! fills in the core's `modifier@1`, moving a builder's mesh, a line's or curve's points or a
//! point's place in the item's own space before its parents' transforms; and a module's kind drawn
//! as the marks its fill returns. Both come through the core's sealed fills, never by name.

use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::BTreeMap;

use deep_canvas::contributed::{self as filled, Fill, Request};
use deep_canvas::outline::Refusal;
use serde_json::{Map, Value};

use crate::builders::{coded, Fault};
use crate::geom::{add, cross, sub, unit, Mesh, V3};
use crate::label::Labels;
use crate::look::Look3;
use crate::scene::{Items, Layer3, Refused};

/// What an evaluation reads through the core from modules scene3d doesn't name: the outline
/// sources an extrude reads (#443) and the module fills (#226), with the build's planted name.
#[derive(Clone, Copy, Debug, Default)]
pub struct Fills<'a> {
    pub outlines: &'a [deep_canvas::registry::SealedOutline],
    pub module: &'a [filled::Sealed],
    pub planted: Option<&'a str>,
    /// What the host keeps between a run's frames, where it keeps it.
    pub memo: Option<&'a RefCell<Memo>>,
}

/// What a host keeps between the frames of one run (#226): each item a module's deform moved,
/// its points or mesh by the key of what that read, so a frame in which neither the item nor what
/// its deform reads changed maps nothing; and the items mapped this frame, for the host's counts.
#[derive(Debug, Default)]
pub struct Memo {
    points: BTreeMap<String, (String, Vec<V3>)>,
    meshes: BTreeMap<String, (String, Mesh)>,
    mapped: Vec<String>,
}

impl Memo {
    /// The items mapped since the last call, in the order they were.
    pub fn take_mapped(&mut self) -> Vec<String> {
        std::mem::take(&mut self.mapped)
    }
}

impl<'a> Fills<'a> {
    /// A sealed build's fills, with the planted wrong program a test build names.
    pub fn of(sealed: &'a deep_canvas::registry::Sealed, planted: Option<&'a str>) -> Self {
        Fills {
            outlines: &sealed.outlines,
            module: &sealed.fills,
            planted,
            memo: None,
        }
    }
}

/// A module's deform's row in a stack: a deform on the CPU whose kind never reads time.
pub fn row(kind: &str) -> Option<(&'static str, bool, bool)> {
    filled::module_of(kind)
        .filter(|_| kind.starts_with("mod."))
        .map(|_| ("deform", false, false))
}

/// Whether `kind` is a deform a module fills (a line's stack passes it to [`params`]).
pub fn named(kind: &str) -> bool {
    row(kind).is_some()
}

/// What a deform reads besides its points: the fills, any item at the frame's time, the
/// document's channels and the planted name.
pub(crate) struct Ask<'a> {
    pub fills: &'a [filled::Sealed],
    pub item: &'a dyn Fn(&str) -> Option<&'a Value>,
    pub channels: Option<&'a Value>,
    pub planted: Option<&'a str>,
    pub memo: Option<&'a RefCell<Memo>>,
}

impl Ask<'_> {
    /// The key of what item `id`'s module deforms read now, beside `own` (what of its own they
    /// map); a planted build keys the items they read whole, place and all.
    fn key(&self, item: &Value, own: &Value) -> String {
        let reads = reads(item, self.item, self.planted.is_some());
        serde_json::json!({"own": own, "modifiers": item.get("modifiers"), "reads": reads})
            .to_string()
    }

    /// Points kept for `id` under `key`, or none.
    fn kept(&self, id: &str, key: &str) -> Option<Vec<V3>> {
        let memo = self.memo?.borrow();
        memo.points
            .get(id)
            .filter(|k| k.0 == key)
            .map(|k| k.1.clone())
    }

    /// Points mapped for `id` under `key`, kept and counted.
    fn keep(&self, id: &str, key: String, points: &[V3]) {
        if let Some(memo) = self.memo {
            let mut memo = memo.borrow_mut();
            memo.points.insert(id.to_string(), (key, points.to_vec()));
            memo.mapped.push(id.to_string());
        }
    }
}

fn fill_of(fills: &[filled::Sealed], kind: &str) -> Result<Fill, Refusal> {
    fills
        .iter()
        .find(|s| s.kind == kind)
        .map(|s| s.fill)
        .ok_or_else(|| Refusal {
            code: "module_missing",
            path: filled::module_of(kind).unwrap_or(kind).to_string(),
            what: kind.to_string(),
        })
}

/// `points` through `modifier`, a module's deform on item `id`.
fn deform(ask: &Ask<'_>, id: &str, modifier: &Value, points: &mut [V3]) -> Result<(), Refusal> {
    let kind = modifier.get("kind").and_then(Value::as_str).unwrap_or("");
    let Fill::Deform(f) = fill_of(ask.fills, kind)? else {
        return Err(Refusal {
            code: "out_of_range",
            path: String::new(),
            what: kind.to_string(),
        });
    };
    let request = Request {
        id,
        value: modifier,
        item: ask.item,
        channels: ask.channels,
        planted: ask.planted,
    };
    f(&request, points)
}

/// The item's enabled module deforms, with their index in its stack.
fn carried(item: &Value) -> Vec<(usize, &Value)> {
    item.get("modifiers")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .enumerate()
        .filter(|(_, m)| {
            crate::stack::enabled(m) && m.get("kind").and_then(Value::as_str).is_some_and(named)
        })
        .collect()
}

/// A fill's refusal as scene3d's: a missing module named as itself; a point's (its path the
/// point's index) at `at(index)`; anything else at the modifier.
fn refused(id: &str, k: usize, r: Refusal, at: impl Fn(usize) -> String) -> Refused {
    let path = match (r.code, r.path.parse::<usize>()) {
        ("module_missing", _) => r.path,
        (_, Ok(i)) => at(i),
        _ => format!("items/{id}/modifiers/{k}"),
    };
    Refused { code: r.code, path }
}

/// A builder's stack step `k`, a module's deform, on the vertices `only` of `m`: their normals
/// are made again from the moved triangles. `doc` is the document the stack reads.
pub(crate) fn mesh(
    m: &Mesh,
    only: &[bool],
    modifier: &Value,
    (doc, id, k): (&Value, &str, usize),
    run: &crate::stack::Run,
) -> Result<Mesh, Fault> {
    let items = doc.get("items");
    let item = |i: &str| items.and_then(|m| m.get(i));
    let ask = Ask {
        fills: &run.fills,
        item: &item,
        channels: doc.get("channels"),
        planted: run.planted.as_deref(),
        memo: None,
    };
    let on: Vec<usize> = (0..m.positions.len()).filter(|i| only[*i]).collect();
    let mut points: Vec<V3> = on.iter().map(|i| m.positions[*i]).collect();
    deform(&ask, id, modifier, &mut points).map_err(|r| {
        let at = |i: usize| format!("items/{id}/modifiers/{k}/vertices/{}", on[i]);
        let r = refused(id, k, r, at);
        coded(r.code, &r.path)
    })?;
    let mut out = m.clone();
    for (i, p) in on.iter().zip(points) {
        out.positions[*i] = p;
    }
    out.normals = normals(&out);
    Ok(out)
}

/// Each vertex's normal: the area-weighted sum of the triangles that use it, so a vertex shared
/// across a smooth surface stays smooth and a split one stays sharp.
fn normals(m: &Mesh) -> Vec<V3> {
    let mut acc = vec![[0.0; 3]; m.positions.len()];
    for t in m.indices.chunks_exact(3) {
        let [a, b, c] = [t[0], t[1], t[2]].map(|i| m.positions[i as usize]);
        let n = cross(sub(b, a), sub(c, a));
        for i in t {
            acc[*i as usize] = add(acc[*i as usize], n);
        }
    }
    acc.into_iter()
        .zip(&m.normals)
        .map(|(n, old)| if n == [0.0; 3] { *old } else { unit(n) })
        .collect()
}

fn vec3(v: &Value) -> Option<V3> {
    let a = v.as_array().filter(|a| a.len() == 3)?;
    Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?])
}

/// The params a line or a curve draws with: its numeric `points` through its module deforms, in
/// its own space; its own params where it carries none. A named point (`ID#anchor`) is a place in
/// the world already and moves with nothing.
pub(crate) fn params<'v>(
    ask: &Ask<'_>,
    (id, kind): (&str, &str),
    item: &Value,
    params: &'v Value,
) -> Result<Cow<'v, Value>, Refused> {
    let carried = carried(item);
    let list = params.get("points").and_then(Value::as_array);
    let (false, Some(list), true) = (
        carried.is_empty(),
        list,
        ["mark.line@1", "curve@1"].contains(&kind),
    ) else {
        return Ok(Cow::Borrowed(params));
    };
    let numeric: Vec<(usize, V3)> = list
        .iter()
        .enumerate()
        .filter_map(|(i, v)| vec3(v).map(|p| (i, p)))
        .collect();
    let mut points: Vec<V3> = numeric.iter().map(|(_, p)| *p).collect();
    let key = ask.key(item, &serde_json::json!(points));
    match ask.kept(id, &key) {
        Some(kept) => points = kept,
        None => {
            for (k, m) in carried {
                deform(ask, id, m, &mut points).map_err(|r| {
                    refused(id, k, r, |i| {
                        format!("items/{id}/params/points/{}", numeric[i].0)
                    })
                })?;
            }
            ask.keep(id, key, &points);
        }
    }
    let mut out = params.clone();
    if let Some(Value::Array(list)) = out.get_mut("points") {
        for ((i, _), p) in numeric.iter().zip(points) {
            list[*i] = Value::from(p.to_vec());
        }
    }
    Ok(Cow::Owned(out))
}

/// A point's own place through its module deforms, where it carries one: the place its parents'
/// transforms then take.
pub(crate) fn place(
    ask: &Ask<'_>,
    items: &Items<'_>,
    id: &str,
    item: &Value,
) -> Result<Option<V3>, Refused> {
    let carried = carried(item);
    let Some((pos, _, _)) = items.at_of(id).filter(|_| !carried.is_empty()) else {
        return Ok(None);
    };
    let key = ask.key(item, &serde_json::json!(pos));
    if let Some(kept) = ask.kept(id, &key) {
        return Ok(kept.first().copied());
    }
    let mut points = [pos];
    for (k, m) in carried {
        deform(ask, id, m, &mut points)
            .map_err(|r| refused(id, k, r, |_| format!("items/{id}/at/pos")))?;
    }
    ask.keep(id, key, &points);
    Ok(Some(points[0]))
}

/// Where a kind a module draws as marks puts them: its layer, with the opacities of those drawn
/// below full, and the frame's bounds.
pub(crate) struct Out<'a> {
    pub layer: &'a mut Layer3,
    pub bounds: &'a mut Vec<V3>,
}

/// A kind a module draws (#226): each mark its fill returns, drawn as scene3d draws that mark
/// under the item's world, its ID `<item>#<sub>`; a mark at no opacity draws nothing.
pub(crate) fn drawn(
    ask: &Ask<'_>,
    (items, id, item): (&Items<'_>, &str, &Value),
    (look, labels, doc): (&Look3, &mut Labels, (&Map<String, Value>, i64)),
    out: Out<'_>,
) -> Result<(), Refused> {
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
    let fail = |r: Refusal| refused(id, 0, r, |_| format!("items/{id}"));
    let Fill::Marks(f) = fill_of(ask.fills, kind).map_err(fail)? else {
        return Err(Refused {
            code: "out_of_range",
            path: format!("items/{id}/kind"),
        });
    };
    let request = Request {
        id,
        value: item,
        item: ask.item,
        channels: ask.channels,
        planted: ask.planted,
    };
    let marks = f(&request).map_err(|r| Refused {
        code: r.code,
        path: if r.path.starts_with("items/") {
            r.path
        } else {
            format!("items/{id}/{}", r.path)
        },
    })?;
    let world = crate::scene::world_at(items, id, None);
    for mark in marks.into_iter().filter(|m| m.opacity > 0.0) {
        let sub = format!("{id}#{}", mark.sub);
        match mark.kind {
            "mark.line@1" => {
                let mut l = crate::scene::line(items, id, &mark.params, look, doc)?;
                l.id = sub.clone();
                out.bounds.extend(crate::points::ends(&l));
                out.layer.lines.push(l);
            }
            "mark.text@1" => {
                let at = crate::scene::local_of(mark.at, [0.0; 3], [1.0; 3], [1.0; 3]);
                let m = crate::scene::matmul(&world, &at);
                let path = format!("items/{id}/params");
                let l = crate::scene::label(&sub, &mark.params, &path, &m, look, labels)?;
                out.bounds.push(l.pos);
                out.layer.labels.push(l);
            }
            _ => {
                return Err(Refused {
                    code: "out_of_range",
                    path: format!("items/{id}/kind"),
                })
            }
        }
        if mark.opacity < 1.0 {
            out.layer.fades.insert(sub, mark.opacity);
        }
    }
    Ok(())
}

/// Whether scene3d draws `kind` as a module's marks.
pub fn draws(kind: &str) -> bool {
    filled::module_of(kind).is_some() && !kind.starts_with("mod.")
}

/// The codes a module's deform refuses with, beside `module_missing`.
pub const CODES: [&str; 4] = ["log_domain", "bad_axis", "bad_scale", "ref_unresolved"];

/// What `item`'s module deforms read, for its build's key: the kind and params of each item a
/// deform's params name, and of each item those name, never where any is placed, so moving them
/// rebuilds nothing; `None` where it carries no module deform.
pub fn keyed(doc: &Value, item: &Value) -> Option<Value> {
    let items = doc.get("items").and_then(Value::as_object)?;
    reads(item, &|k| items.get(k), false)
}

/// What `item`'s module deforms read through `item_of`: the kind and params of each item a
/// deform's params name and of each item those name; each whole, place and all, with `whole`.
fn reads<'d>(
    item: &Value,
    item_of: &dyn Fn(&str) -> Option<&'d Value>,
    whole: bool,
) -> Option<Value> {
    let carried = carried(item);
    if carried.is_empty() {
        return None;
    }
    let mut read = Map::new();
    let mut named: Vec<&str> = carried
        .iter()
        .filter_map(|(_, m)| m.get("params"))
        .flat_map(names)
        .collect();
    for _ in 0..2 {
        let mut next = Vec::new();
        for id in named {
            if let Some(i) = item_of(id).filter(|_| !read.contains_key(id)) {
                let params = i.get("params").cloned().unwrap_or(Value::Null);
                next.extend(i.get("params").map(names).unwrap_or_default());
                let at = if whole {
                    i.clone()
                } else {
                    serde_json::json!({"kind": i.get("kind"), "params": params})
                };
                read.insert(id.to_string(), at);
            }
        }
        named = next;
    }
    Some(Value::Object(read))
}

/// Every string a value holds: the IDs it may name.
fn names(v: &Value) -> Vec<&str> {
    match v {
        Value::String(s) => vec![s.as_str()],
        Value::Array(a) => a.iter().flat_map(names).collect(),
        Value::Object(o) => o.values().flat_map(names).collect(),
        _ => Vec::new(),
    }
}

/// A builder's mesh after its stack (#226), where it carries a module's deform: built from the
/// document with what the deform reads as at t, and kept by its key, so a frame where neither the
/// item nor what its deform reads changed builds and maps nothing.
pub(crate) fn built(
    ask: &Ask<'_>,
    (doc, id, item): (&Value, &str, &Value),
    seconds: f64,
    fills: Fills<'_>,
) -> Result<Mesh, Refused> {
    if carried(item).is_empty() {
        return crate::scene::mesh_of(doc, id, item, seconds, fills);
    }
    let mut own = item.clone();
    if let Some(o) = own.as_object_mut() {
        o.remove("at");
    }
    if crate::stack::reads_time_by_kind(item) {
        own["\u{0}t"] = Value::from(seconds);
    }
    let key = ask.key(item, &own);
    if let Some(memo) = ask.memo {
        if let Some((_, m)) = memo.borrow().meshes.get(id).filter(|m| m.0 == key) {
            return Ok(m.clone());
        }
    }
    let mut at_t = doc.clone();
    let read = reads(item, ask.item, false);
    for rid in read
        .as_ref()
        .and_then(Value::as_object)
        .into_iter()
        .flat_map(|r| r.keys())
    {
        if let (Some(v), Some(slot)) = ((ask.item)(rid), at_t.pointer_mut(&format!("/items/{rid}")))
        {
            *slot = v.clone();
        }
    }
    let mesh = crate::scene::mesh_of(&at_t, id, item, seconds, fills)?;
    if let Some(memo) = ask.memo {
        let mut memo = memo.borrow_mut();
        memo.meshes.insert(id.to_string(), (key, mesh.clone()));
        memo.mapped.push(id.to_string());
    }
    Ok(mesh)
}
