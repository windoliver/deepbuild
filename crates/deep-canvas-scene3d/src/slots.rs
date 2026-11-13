//! #537 (Instance `instance@1`: logic columns): an instancer whose columns read a piece's logic
//! arrays. It holds one slot per array element, the arrays' count fixed at check. The element in
//! a live slot is `<instancer>#<slot>.<gen>`, seeded by hash(seed, slot, gen), so a slot logic
//! reuses under a new `gen` is a new element and an element ID is never reused. A slot that isn't
//! live, is `hidden`, or holds a value out of its column's range draws nothing, isn't hit and
//! isn't announced. Each prototype solid is its own batch laid out by slot, so a slot that spawns,
//! despawns or moves rewrites its own records alone.

use std::collections::BTreeMap;

use deep_canvas::camera::Vec3;
use deep_canvas::columns::Mapped;
use deep_canvas::document::Issue;
use deep_canvas::schedule::{HashVersion, Hasher};
use serde_json::{json, Map, Value};

use crate::arrays::{self, Reader};
use crate::cut::{quat, rotated, MAX_ELEMENTS};
use crate::scene::{local_of, matmul, Affine3, Assets, Layer3, Material, Refused, Shape, Solid};
use crate::spec::P;

/// An instancer's columns that may read an array, besides its `attrs`.
const COLUMNS: [&str; 8] = [
    "pos", "rot", "yaw", "scale", "proto", "hidden", "live", "gen",
];

/// The planted instancer that addresses an element by its slot alone (#537 criterion 1): its
/// elements are `<instancer>#<slot>`, so a selection follows a slot onto its next occupant.
pub const SLOT_ALONE: &str = "instancer_addresses_by_slot";

/// `params` with the columns a fed instancer adds: `live` and `gen` (Instance `instance@1`:
/// logic columns), and its part poses.
pub(crate) fn params(mut params: Vec<P>) -> Vec<P> {
    let parts = "{node → yaw | pitch | rot: column} ≤ 8";
    for (name, ty) in [
        ("live", "bool column"),
        ("gen", "u32 column"),
        ("parts", parts),
    ] {
        params.push(P {
            name,
            ty,
            unit: "",
            default: Value::Null,
            min: None,
            max: None,
            class: "geometry",
            sweep: (Value::Null, Value::Null),
        });
    }
    params
}

/// Whether an instancer's `params` read a logic array.
pub(crate) fn fed(params: &Value) -> bool {
    COLUMNS.iter().any(|c| arrays::is_array(&params[*c]))
        || params["attrs"]
            .as_object()
            .is_some_and(|a| a.values().any(arrays::is_array))
        || !parts(params).is_empty()
}

/// Most part poses an instancer declares.
const PARTS: usize = 8;

/// The planted pose that turns a part about the prototype's axes through its node, never its
/// parent's (#537 criterion 4).
pub const POSE_IN_WORLD: &str = "part_pose_in_world_space";

/// Each part pose of `params`: its node, its axis and its column. A bare column turns a node
/// named `turret` by yaw and one named `barrel` by pitch; any other node names its axis.
fn parts(params: &Value) -> Vec<(String, &'static str, Value, String)> {
    let mut out = Vec::new();
    for (node, spec) in params["parts"].as_object().into_iter().flatten() {
        let bare = match node.as_str() {
            "turret" => Some("yaw"),
            "barrel" => Some("pitch"),
            _ => None,
        };
        match bare.filter(|_| arrays::is_array(spec)) {
            Some(axis) => out.push((node.clone(), axis, spec.clone(), format!("parts/{node}"))),
            None => {
                for axis in ["yaw", "pitch", "rot"] {
                    if let Some(c) = spec.get(axis).filter(|c| arrays::is_array(c)) {
                        let path = format!("parts/{node}/{axis}");
                        out.push((node.clone(), axis, c.clone(), path));
                    }
                }
            }
        }
    }
    out
}

/// The columns of instancer `id` that read an array. `proto` reads within its prototypes,
/// unless it names a narrower range.
pub(crate) fn readers(id: &str, params: &Value) -> Vec<Reader> {
    let path = format!("items/{id}/params");
    let mut out: Vec<Reader> = COLUMNS
        .iter()
        .filter(|c| arrays::is_array(&params[**c]))
        .map(|c| Reader {
            name: c.to_string(),
            path: format!("{path}/{c}"),
            column: params[*c].clone(),
        })
        .collect();
    if let Some(proto) = out.iter_mut().find(|r| r.name == "proto") {
        let n = params["of"].as_array().map_or(0, Vec::len);
        if proto.column.get("range").is_none() {
            proto.column["range"] = json!([0, n.saturating_sub(1)]);
        }
    }
    for (name, column) in params["attrs"].as_object().into_iter().flatten() {
        if arrays::is_array(column) {
            out.push(Reader {
                name: format!("attrs.{name}"),
                path: format!("{path}/attrs/{name}"),
                column: column.clone(),
            });
        }
    }
    for (node, axis, column, at) in parts(params) {
        out.push(Reader {
            name: format!("parts.{node}.{axis}"),
            path: format!("{path}/{at}"),
            column,
        });
    }
    out
}

/// At check, a fed instancer's own rules over its readers and their arrays' counts: `live` and
/// `gen` both read arrays; every array holds the same count, at most 100,000; and it takes
/// neither a scatter nor a written column (`ids` among them), each refused naming both.
pub(crate) fn check(id: &str, params: &Value, counts: &[(Reader, u64)]) -> Vec<Issue> {
    if counts.is_empty() {
        return Vec::new();
    }
    let path = format!("items/{id}/params");
    let arrays: Vec<&str> = counts.iter().map(|(r, _)| r.name.as_str()).collect();
    let mut issues = Vec::new();
    for need in ["live", "gen"] {
        if !arrays.contains(&need) {
            issues.push(Issue::error(
                "bad_column",
                id,
                format!("{path}/{need}"),
                json!({"columns": arrays, "missing": need}),
                "an instancer whose columns read arrays takes `live` and `gen` arrays too",
            ));
        }
    }
    let n = counts[0].1;
    if counts.iter().any(|c| c.1 != n) {
        let named: Map<String, Value> = counts
            .iter()
            .map(|(r, c)| (r.name.clone(), json!(c)))
            .collect();
        for (r, _) in counts {
            issues.push(Issue::error(
                "bad_column",
                id,
                r.path.clone(),
                Value::Object(named.clone()),
                "the instancer's array columns hold different counts; its slots are their count",
            ));
        }
    } else if n > MAX_ELEMENTS as u64 {
        issues.push(Issue::error(
            "out_of_range",
            id,
            counts[0].0.path.clone(),
            json!({"slots": n, "max": MAX_ELEMENTS}),
            "an instancer holds at most 100,000 slots",
        ));
    }
    // Parts: at most 8, each a column of one axis, or a bare column on `turret` or `barrel`.
    let declared = params["parts"].as_object().map_or(0, Map::len);
    if declared > PARTS {
        issues.push(Issue::error(
            "out_of_range",
            id,
            format!("{path}/parts"),
            json!({"parts": declared, "max": PARTS}),
            "an instancer declares at most 8 part poses",
        ));
    }
    let posed = parts(params);
    for (node, spec) in params["parts"].as_object().into_iter().flatten() {
        let axes = posed.iter().filter(|p| p.0 == *node).count();
        let keys = spec.as_object().map_or(0, |o| o.len());
        if axes != 1 || (!arrays::is_array(spec) && keys != 1) {
            issues.push(Issue::error(
                "out_of_range",
                id,
                format!("{path}/parts/{node}"),
                spec.clone(),
                "a part pose turns its node by one column: yaw, pitch or rot (a bare column on `turret` or `barrel`)",
            ));
        }
    }
    let written = ["ids", "pos", "rot", "yaw", "proto", "hidden"]
        .into_iter()
        .filter(|c| params[*c].is_array());
    let scatter = params.get("from").filter(|f| !f.is_null()).map(|_| "from");
    for other in written.chain(scatter) {
        issues.push(Issue::error(
            "bad_column",
            id,
            format!("{path}/{other}"),
            json!({"columns": arrays, "with": other}),
            &format!(
                "an instancer whose columns read arrays ({}) takes no `{other}`",
                arrays.join(", ")
            ),
        ));
    }
    issues
}

/// A live slot's element at a frame: its slot, generation, prototype and transform in the
/// instancer's space.
pub(crate) struct Unit {
    pub slot: u32,
    pub gen: u32,
    pub proto: usize,
    pub at: Affine3,
    /// Each posed part's turn, by node, in its parent's axes.
    pub poses: BTreeMap<String, [[f64; 3]; 3]>,
}

/// The rotation of `deg` about x, y and z, as items turn (Rz · Ry · Rx).
fn turn(deg: Vec3) -> [[f64; 3]; 3] {
    let m = local_of([0.0; 3], deg, [1.0; 3], [1.0; 3]);
    [0, 1, 2].map(|i| [m[i][0], m[i][1], m[i][2]])
}

/// `m` turned by `r` about its own origin: its translation kept, `r` applied after its linear
/// part, so a node turns in its parent's axes.
fn turned(r: &[[f64; 3]; 3], m: &Affine3) -> Affine3 {
    let mut out = *m;
    for (i, row) in out.iter_mut().enumerate() {
        for (j, v) in row.iter_mut().take(3).enumerate() {
            *v = (0..3).map(|k| r[i][k] * m[k][j]).sum();
        }
    }
    out
}

/// A glTF prototype's nodes by name: each one's parent and local matrix.
type Rig = BTreeMap<String, (Option<String>, Affine3)>;

/// Node `name`'s matrix in its file's space, each node on its chain from the root turned by its
/// pose in its parent's axes about its own origin; with the planted pose, each turned about the
/// file's axes through its origin instead.
fn chained(
    rig: &Rig,
    name: &str,
    poses: &BTreeMap<String, [[f64; 3]; 3]>,
    planted: bool,
) -> Option<Affine3> {
    let mut chain = Vec::new();
    let mut at = Some(name.to_string());
    while let Some(n) = at {
        let (parent, local) = rig.get(&n)?;
        chain.push((n, *local));
        at = parent.clone().filter(|_| chain.len() <= 64);
    }
    let mut m = [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
    ];
    for (n, local) in chain.iter().rev() {
        m = match (poses.get(n), planted) {
            (Some(r), false) => matmul(&m, &turned(r, local)),
            (Some(r), true) => turned(r, &matmul(&m, local)),
            (None, _) => matmul(&m, local),
        };
    }
    Some(m)
}

/// The rig of prototype `proto`, a `mesh.asset@1` item, read from the asset store.
fn rig_of(map: &Map<String, Value>, assets: Option<Assets<'_>>, proto: &str) -> Option<Rig> {
    let params = map.get("items")?.get(proto)?.get("params")?;
    let bytes = assets?(params.get("sha256")?.as_str()?)?;
    let scene = params
        .pointer("/node/scene")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    crate::gltf::rig(&bytes, scene as usize).ok()
}

impl Unit {
    /// Its element ID: `<instancer>#<slot>.<gen>`, or the planted `<instancer>#<slot>`.
    pub(crate) fn id(&self, instancer: &str, planted: Option<&str>) -> String {
        if planted == Some(SLOT_ALONE) {
            format!("{instancer}#{}", self.slot)
        } else {
            format!("{instancer}#{}.{}", self.slot, self.gen)
        }
    }
}

/// Each column of a fed instancer folded at `t`, by name.
fn folded(
    map: &Map<String, Value>,
    id: &str,
    params: &Value,
    t: i64,
) -> Result<BTreeMap<String, Mapped>, Refused> {
    readers(id, params)
        .iter()
        .map(|r| Ok((r.name.clone(), arrays::at(map, r, t)?)))
        .collect()
}

/// The numbers column `name` holds at `slot`, if it reads an array.
fn value<'m>(cols: &'m BTreeMap<String, Mapped>, name: &str, slot: usize) -> Option<&'m [f64]> {
    let m = cols.get(name)?;
    m.values.get(slot * m.per..(slot + 1) * m.per)
}

/// A fed instancer's slot count and the units its live slots hold at `t`, whether or not they
/// draw (`drawn`: live, not hidden, and every column in range).
pub(crate) fn units(
    map: &Map<String, Value>,
    id: &str,
    params: &Value,
    t: i64,
) -> Result<(usize, Vec<(Unit, bool)>), Refused> {
    let cols = folded(map, id, params, t)?;
    let missing = |c: &str| Refused {
        code: "bad_column",
        path: format!("items/{id}/params/{c}"),
    };
    let n = cols
        .get("live")
        .ok_or_else(|| missing("live"))?
        .hidden
        .len();
    cols.get("gen").ok_or_else(|| missing("gen"))?;
    let one = |name: &str, slot: usize| value(&cols, name, slot).and_then(|v| v.first().copied());
    let lift = params
        .pointer("/pos/y")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let scale_all = params["scale"].as_f64().unwrap_or(1.0);
    let mut out = Vec::new();
    for slot in 0..n {
        if one("live", slot) != Some(1.0) {
            continue;
        }
        let shown = one("hidden", slot).is_none_or(|h| h == 0.0)
            && cols.values().all(|m| m.hidden.get(slot) != Some(&true));
        let pos: Vec3 = match value(&cols, "pos", slot) {
            Some(&[x, y, z]) => [x, y, z],
            Some(&[x, z]) => [x, lift, z],
            _ => [0.0; 3],
        };
        let scale: Vec3 = match value(&cols, "scale", slot) {
            Some(&[x, y, z]) => [x, y, z],
            Some(&[s]) => [s; 3],
            _ => [scale_all; 3],
        };
        let at = match (value(&cols, "rot", slot), one("yaw", slot)) {
            (Some(&[x, y, z, w]), _) => {
                rotated(local_of(pos, [0.0; 3], scale, [1.0; 3]), quat([x, y, z, w]))
            }
            (_, Some(yaw)) => local_of(pos, [0.0, yaw, 0.0], scale, [1.0; 3]),
            _ => local_of(pos, [0.0; 3], scale, [1.0; 3]),
        };
        let mut poses = BTreeMap::new();
        for (node, axis, _, _) in parts(params) {
            let name = format!("parts.{node}.{axis}");
            let r = match (axis, value(&cols, &name, slot)) {
                ("yaw", Some(&[d])) => turn([0.0, d, 0.0]),
                ("pitch", Some(&[d])) => turn([d, 0.0, 0.0]),
                ("rot", Some(&[x, y, z, w])) => quat([x, y, z, w]),
                _ => continue,
            };
            poses.insert(node, r);
        }
        let unit = Unit {
            slot: slot as u32,
            gen: one("gen", slot).unwrap_or(0.0) as u32,
            proto: one("proto", slot).unwrap_or(0.0) as usize,
            at,
            poses,
        };
        out.push((unit, shown));
    }
    Ok((n, out))
}

/// The seed of the element in `slot` at generation `gen`: hash@1 of the document's seed, the
/// slot and the generation, so a reused slot is seeded anew.
pub fn seed(doc_seed: u64, slot: u32, gen: u32) -> u64 {
    let mut h = Hasher::of(HashVersion::V1, "scene3d.element");
    h.bytes(&doc_seed.to_le_bytes());
    h.bytes(&slot.to_le_bytes());
    h.bytes(&gen.to_le_bytes());
    let k = h.finish().0;
    u64::from_le_bytes([k[0], k[1], k[2], k[3], k[4], k[5], k[6], k[7]])
}

/// Where a fed instancer's solids go: the scene's batches, its layer (its solids, and its batches
/// laid out by slot) and the scene's bounds.
type Sink<'s, 'a> = (
    &'s mut Vec<(&'a str, Shape, Option<Material>)>,
    &'s mut Layer3,
    &'s mut Vec<Vec3>,
);

/// A fed instancer's solids at `t`: each prototype solid of each slot that draws, addressed
/// `<instancer>#<slot>.<gen>` and moved from its prototype's world to the instancer's world
/// (`at`) × the slot's transform. Each prototype solid is its own batch whatever the slots hold,
/// laid out by slot (its `row`), each with the slot count in the layer's `fed`. A posed part's
/// node turns the solids it holds in place: each solid of node `<proto>#<node>` takes its posed
/// matrix in place of its rest one.
#[allow(clippy::too_many_arguments)]
pub(crate) fn place<'a>(
    map: &Map<String, Value>,
    id: &'a str,
    params: &Value,
    t: i64,
    (at, of, from, assets): (&Affine3, &[String], &[Affine3], Option<Assets<'_>>),
    protos: &BTreeMap<String, Vec<Solid>>,
    (batches_all, layer, bounds): Sink<'_, 'a>,
) -> Result<(), Refused> {
    let (n, units) = units(map, id, params, t)?;
    let path = format!("items/{id}/params/of");
    let posed = parts(params);
    let mut rigs: Vec<Option<Rig>> = Vec::with_capacity(of.len());
    for p in of {
        rigs.push(if posed.is_empty() {
            None
        } else {
            rig_of(map, assets, p)
        });
    }
    if let Some((node, ..)) = posed
        .iter()
        .find(|(node, ..)| !rigs.iter().flatten().any(|r| r.contains_key(node)))
    {
        return Err(Refused {
            code: "ref_unresolved",
            path: format!("items/{id}/params/parts/{node}"),
        });
    }
    let mut batch_of: Vec<Vec<u32>> = Vec::with_capacity(of.len());
    for p in of {
        let solids = protos.get(p).ok_or_else(|| Refused {
            code: "ref_unresolved",
            path: path.clone(),
        })?;
        let mut ids = Vec::with_capacity(solids.len());
        for s in solids {
            batches_all.push((id, s.shape, s.material));
            ids.push(batches_all.len() as u32);
        }
        batch_of.push(ids);
    }
    for (unit, _) in units.iter().filter(|(_, shown)| *shown) {
        let (Some(solids), Some(batches)) = (protos.get(&of[unit.proto]), batch_of.get(unit.proto))
        else {
            continue;
        };
        let place = matmul(&matmul(at, &unit.at), &from[unit.proto]);
        let own = unit.id(id, None);
        let rig = rigs[unit.proto].as_ref().filter(|_| !unit.poses.is_empty());
        for (s, &batch) in solids.iter().zip(batches) {
            let mut s = s.clone();
            // A part's node: its rest matrix in the file undone, its posed one applied.
            let node = s.id.split_once('#').map(|(_, n)| n);
            if let Some((rig, node)) = rig.zip(node) {
                let rest = chained(rig, node, &BTreeMap::new(), false);
                let now = chained(rig, node, &unit.poses, false);
                if let (Some(rest), Some(now)) = (rest, now) {
                    s.model = matmul(&s.model, &matmul(&crate::cut::inverse(&rest), &now));
                }
            }
            s.id = own.clone();
            s.row = unit.slot;
            s.batch = batch;
            s.model = matmul(&place, &s.model);
            s.op = None;
            bounds.extend(s.points());
            layer.solids.push(s);
        }
    }
    layer
        .fed
        .extend(batch_of.into_iter().flatten().map(|b| (b, n as u32)));
    Ok(())
}

/// #537: fed instancer `id`'s reading at `t`, as a proof surface evaluates it: `elements`, each
/// live slot's `{id, slot, gen, seed}` in slot order, its u64 seed as decimal text; `nodes/<node>`,
/// each slot's glTF node in world m where the frame draws it, null where the slot isn't live.
/// `None` for another field or an instancer that reads no array. `planted`: a wrong program's
/// name, the slot-alone address or the pose in the file's axes.
pub fn reading(
    doc: &Value,
    t: i64,
    (id, field): (&str, &str),
    assets: Option<Assets<'_>>,
    planted: Option<&str>,
) -> Result<Option<Value>, Refused> {
    let Some(map) = doc.as_object() else {
        return Ok(None);
    };
    let params = &map
        .get("items")
        .and_then(|i| i.get(id))
        .unwrap_or(&Value::Null)["params"];
    if !fed(params) {
        return Ok(None);
    }
    let (n, units) = units(map, id, params, t)?;
    if field == "elements" {
        let doc_seed = map.get("seed").and_then(Value::as_u64).unwrap_or(0);
        let alone = planted == Some(SLOT_ALONE);
        let rows: Vec<Value> = units
            .iter()
            .map(|(u, _)| {
                let seed = seed(doc_seed, u.slot, if alone { 0 } else { u.gen });
                json!({"id": u.id(id, planted), "slot": u.slot, "gen": u.gen, "seed": seed.to_string()})
            })
            .collect();
        return Ok(Some(Value::Array(rows)));
    }
    let Some(node) = field.strip_prefix("nodes/") else {
        return Ok(None);
    };
    let at = crate::scene::placed_at(doc, t)?
        .into_iter()
        .find(|(i, ..)| i == id)
        .map(|(.., w)| w)
        .unwrap_or([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
        ]);
    let of: Vec<&str> = params["of"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let rigs: Vec<Option<Rig>> = of.iter().map(|p| rig_of(map, assets, p)).collect();
    let mut out = vec![Value::Null; n];
    for (u, _) in &units {
        let posed = rigs
            .get(u.proto)
            .and_then(Option::as_ref)
            .and_then(|rig| chained(rig, node, &u.poses, planted == Some(POSE_IN_WORLD)));
        if let Some(m) = posed {
            out[u.slot as usize] = json!(crate::scene::apply(
                &matmul(&at, &matmul(&u.at, &m)),
                [0.0; 3]
            ));
        }
    }
    Ok(Some(Value::Array(out)))
}

/// The planted instancer that addresses elements by slot alone: each fed instancer's element
/// in `solids` renamed `<instancer>#<slot>`.
pub fn plant_slot_alone(solids: &mut [Solid]) {
    for s in solids {
        if let Some((item, sub)) = s.id.split_once('#') {
            if let Some((slot, _)) = sub.split_once('.') {
                s.id = format!("{item}#{slot}");
            }
        }
    }
}

/// #537: `selection` less each element of a fed instancer of `doc` that its slot no longer holds
/// at `t`: the slot isn't live, or holds another generation (Instance `instance@1`: logic
/// columns); the entries dropped. The planted instancer that addresses elements by slot alone
/// names a slot, which it keeps while the slot is live, whatever unit holds it.
pub fn drop_stale(
    doc: &Value,
    t: i64,
    selection: &mut Vec<String>,
    planted: Option<&str>,
) -> Vec<String> {
    let Some(map) = doc.as_object() else {
        return Vec::new();
    };
    let mut held: BTreeMap<String, Option<Vec<(u32, u32)>>> = BTreeMap::new();
    let mut dropped = Vec::new();
    selection.retain(|entry| {
        let Some((item, sub)) = entry.split_once('#') else {
            return true;
        };
        let live = held.entry(item.to_string()).or_insert_with(|| {
            let params = map.get("items")?.get(item)?.get("params")?;
            let (_, units) = units(map, item, params, t).ok().filter(|_| fed(params))?;
            Some(units.iter().map(|(u, _)| (u.slot, u.gen)).collect())
        });
        let Some(live) = live else {
            return true;
        };
        let (slot, gen) = match sub.split_once('.') {
            Some((s, g)) => (s.parse::<u32>().ok(), g.parse::<u32>().ok()),
            None if planted == Some(SLOT_ALONE) => (sub.parse::<u32>().ok(), None),
            None => (None, None),
        };
        let keep = slot.is_some_and(|s| {
            live.iter()
                .any(|&(ls, lg)| ls == s && gen.is_none_or(|g| g == lg))
        });
        if !keep {
            dropped.push(entry.clone());
        }
        keep
    });
    dropped
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 4-slot pool where slot 1 is live with gen 2 and slot 3 with gen 1 from step 0, and step 1
    /// reuses slot 1 under gen 3 and frees slot 3.
    fn pool() -> Value {
        let array = |ty: &str, steps: Value| json!({"type": ty, "count": 4, "every": 10, "linear": false, "steps": steps});
        json!({
            "seed": 7,
            "arrays": {
                "brain.live": array("bool", json!([
                    {"step": 0, "changed": [[0, 4]], "values": [[0, [false, true, false, true]]]},
                    {"step": 1, "changed": [[3, 4]], "values": [[3, [false]]]}])),
                "brain.gen": array("i32", json!([
                    {"step": 0, "changed": [[0, 4]], "values": [[0, [0, 2, 0, 1]]]},
                    {"step": 1, "changed": [[1, 2]], "values": [[1, [3]]]}])),
                "brain.pos": array("vec3", json!([])),
            },
            "items": {"units": {"kind": "instance@1", "params": {
                "of": ["tank"],
                "pos": {"array": "brain.pos", "as": "f32"},
                "live": {"array": "brain.live", "as": "bool"},
                "gen": {"array": "brain.gen", "as": "u32"},
            }}},
        })
    }

    /// A selection keeps an element while its slot holds it and drops it at the first frame its
    /// slot frees or reuses under another gen; slot alone (planted) follows the slot instead.
    #[test]
    fn a_selection_drops_an_element_its_slot_no_longer_holds() {
        let doc = pool();
        let mut held = vec![
            "units#1.2".to_string(),
            "units#3.1".to_string(),
            "other".to_string(),
        ];
        assert!(drop_stale(&doc, 9, &mut held, None).is_empty());
        let dropped = drop_stale(&doc, 10, &mut held, None);
        assert_eq!(
            dropped,
            vec!["units#1.2".to_string(), "units#3.1".to_string()]
        );
        assert_eq!(held, vec!["other".to_string()]);
        let mut by_slot = vec!["units#1".to_string()];
        assert!(drop_stale(&doc, 10, &mut by_slot, Some(SLOT_ALONE)).is_empty());
    }

    /// A barrel on a turret on a hull: the turret's yaw carries the barrel round with it, its
    /// tip where the f64 chain puts it; the planted pose in the file's axes leaves it behind.
    #[test]
    fn a_part_turns_in_its_parents_axes() {
        let at =
            |x: f64, y: f64, z: f64| [[1.0, 0.0, 0.0, x], [0.0, 1.0, 0.0, y], [0.0, 0.0, 1.0, z]];
        let rig: Rig = [
            ("hull".to_string(), (None, at(0.0, 0.0, 0.0))),
            (
                "turret".to_string(),
                (Some("hull".to_string()), at(0.0, 1.0, 0.0)),
            ),
            (
                "barrel".to_string(),
                (Some("turret".to_string()), at(0.0, 0.2, 0.5)),
            ),
        ]
        .into_iter()
        .collect();
        let poses: BTreeMap<String, [[f64; 3]; 3]> = [
            ("turret".to_string(), turn([0.0, 90.0, 0.0])),
            ("barrel".to_string(), turn([90.0, 0.0, 0.0])),
        ]
        .into_iter()
        .collect();
        let tip = |m: Affine3| crate::scene::apply(&m, [0.0, 0.0, 2.0]);
        let near = |a: Vec3, b: Vec3| (0..3).all(|i| (a[i] - b[i]).abs() < 1e-12);
        let rest = chained(&rig, "barrel", &BTreeMap::new(), false).expect("a chain");
        assert!(near(tip(rest), [0.0, 1.2, 2.5]));
        // The barrel pitches down about the turret's x, which the turret's yaw turned onto −z.
        let posed = chained(&rig, "barrel", &poses, false).expect("a chain");
        assert!(near(tip(posed), [0.5, -0.8, 0.0]), "{:?}", tip(posed));
        let planted = chained(&rig, "barrel", &poses, true).expect("a chain");
        assert!(near(tip(planted), [2.5, 1.2, 0.0]), "{:?}", tip(planted));
    }

    /// A reused slot's element is seeded anew; the same slot and gen seed the same.
    #[test]
    fn a_reused_slot_is_seeded_by_its_generation() {
        assert_eq!(seed(7, 3, 2), seed(7, 3, 2));
        assert_ne!(seed(7, 3, 2), seed(7, 3, 1));
        assert_ne!(seed(7, 3, 2), seed(7, 2, 3));
    }

    /// Check refuses a fed instancer without `gen`, with arrays of different counts, and with a
    /// scatter, each naming the columns.
    #[test]
    fn check_refuses_what_a_fed_instancer_cannot_take() {
        let r = |name: &str| Reader {
            name: name.into(),
            path: format!("items/units/params/{name}"),
            column: json!({"array": format!("brain.{name}")}),
        };
        let params = json!({"from": {"distribute": {}}});
        let issues = check("units", &params, &[(r("pos"), 16), (r("live"), 12)]);
        let at: Vec<(&str, &str)> = issues.iter().map(|i| (i.code, i.path.as_str())).collect();
        assert!(at.contains(&("bad_column", "items/units/params/gen")));
        assert!(at.contains(&("bad_column", "items/units/params/pos")));
        assert!(at.contains(&("bad_column", "items/units/params/from")));
        let both = issues
            .iter()
            .find(|i| i.path.ends_with("/from"))
            .expect("from refused");
        assert_eq!(both.actual["columns"], json!(["pos", "live"]));
    }
}
