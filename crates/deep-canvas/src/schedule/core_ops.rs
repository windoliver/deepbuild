//! The core's own arrays and operators (technical design: The canvas core: the core holds the
//! document contract at run time, the scheduler, epochs and the content-key cache): an item
//! lowered to the one form checks read, its transform and its other fields, and its transform
//! composed with its parent's. A canvas module that must change one of these writes its own
//! array and names the core's in `contributes_to`: motion's channels and anything else that
//! moves an item contribute to `core.transform`, and the core never names them.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::{json, Map, Value};

use super::{Canonical, OpError, Val, View};
use crate::ops;
use crate::registry::Registrar;

/// The core's arrays its check kinds read, which a module whose items draw or place what they
/// hold contributes to.
pub const CHECKED: [&str; 4] = [
    "core.glyphs",
    "core.strokes",
    "core.shapes",
    "core.timeline",
];

/// The core's array a module contributes to for what its kind draws or places.
pub fn checked_array(draws: &str) -> Option<&'static str> {
    Some(match draws {
        "glyphs" => "core.glyphs",
        "strokes" => "core.strokes",
        "solids" => "core.shapes",
        "shots" | "cuts" | "holds" => "core.timeline",
        _ => return None,
    })
}

/// The core's arrays and operators, registered under the name `core` before every module's.
pub fn register(r: &mut Registrar) {
    r.array("core.lowered", "item", "item", "geometry", "validate");
    r.array("core.transform", "transform", "item", "transform", "items");
    r.array("core.fields", "item", "item", "geometry", "items");
    r.array("core.world", "transform", "item", "transform", "items");
    // What the core's own check kinds read and canvas modules fill through `contributes_to`
    // (Check input): glyph boxes, flattened strokes, true shapes and the timeline of shots, cuts
    // and holds.
    for array in CHECKED {
        r.array(array, "list", "document", "geometry", "extract");
    }
    // The status map every status mark draws from (The status-color rule): the look's roles, and
    // the state colors and glyphs the look module contributes.
    r.array("core.status", "status", "document", "shading", "items");
    r.operator("lower", "validate", &["self"], &["core.lowered"])
        .run(lower);
    r.operator("transform", "items", &["core.lowered"], &["core.transform"])
        .run(transform);
    r.operator("fields", "items", &["core.lowered"], &["core.fields"])
        .run(fields);
    r.operator(
        "world",
        "items",
        &["core.transform", "parent"],
        &["core.world"],
    )
    .run(world);
    r.operator("status", "items", &["look"], &["core.status"])
        .document()
        .applies(has_status)
        .run(status);
    r.fixture("board", board(), None).sidecar(json!({
        "checks": [{"kind": "document.determinism", "probe": "pixels", "render": "seek_vs_play"}],
        "oracles": ["seek_play"],
        "codes": ["unknown_kind"],
        "twin": {"path": "items/a/params/box", "value": [22, 16, 64, 40]},
    }));
}

/// The core's own fixture: boxes, a label and a child that rides its rotated, scaled parent.
fn board() -> Value {
    let rect = |id: &str, b: [f64; 4], order: &str, role: &str| {
        json!({"id": id, "kind": "rect@1", "name": format!("Box {id}"), "order": order,
               "params": {"box": b, "paint": {"fill": {"role": role}}}})
    };
    let mut items = Map::new();
    items.insert(
        "ground".into(),
        rect("ground", [0.0, 0.0, 320.0, 200.0], "a0", "ground"),
    );
    items.insert("a".into(), rect("a", [16.0, 16.0, 64.0, 40.0], "a1", "ink"));
    let mut parent = rect("p", [0.0, 0.0, 48.0, 32.0], "a2", "muted");
    parent["at"] = json!({"pos": [120, 60, 0], "rot": [0, 0, 15], "scale": [1.5, 1.5, 1]});
    items.insert("p".into(), parent);
    let mut child = rect("c", [0.0, 0.0, 16.0, 12.0], "a3", "ink");
    child["parent"] = json!("p");
    child["at"] = json!({"pos": [20, 8, 0]});
    items.insert("c".into(), child);
    items.insert(
        "cap".into(),
        json!({"id": "cap", "kind": "text@1", "name": "Caption", "order": "a4",
               "params": {"text": "The core's board", "font": "body", "size": 13, "box": {"w": 160, "h": 20}},
               "at": {"pos": [16, 150, 0]}}),
    );
    json!({"format": 1, "profile": "board", "seed": 387, "title": "Core board",
           "description": "Boxes, a caption and a child riding its turned, scaled parent: the core's own operators' fixture.",
           "size": [320, 200], "items": items})
}

/// The item in its one checked form: numbers normalized (−0 as +0, whole numbers as
/// integers), strings NFC, and a canvas module's kind drawn as the core kind it registered
/// (`rect@1`, its `box` in the look's ink), or as a group, which draws nothing itself, when it
/// registered none, until modules draw their own.
fn lower(v: &mut View<'_>) -> Result<(), OpError> {
    let item = v.item()?;
    let mut out = crate::canon::canonical_value(item, &crate::canon::NoShape)
        .map_err(|e| OpError::new("out_of_range", format!("{}/{}", v.path(), e.path)))?;
    let kind = out
        .get("kind")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if let Some(core_kind) = v.draws_as(&kind) {
        // A module's item one major back draws as its migrated form (Migration: at load).
        let migrated = v.migrated(&out);
        let at = migrated.as_ref().unwrap_or(&out);
        let params = at.get("params").cloned().unwrap_or(Value::Null);
        let kind = at
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        out["kind"] = json!(core_kind);
        out["params"] = match v.draw_of(&kind) {
            Some(draw) => draw(&params),
            None => json!({"box": params.get("box").cloned().unwrap_or(Value::Null),
                           "paint": {"fill": {"role": "ink"}}}),
        };
    } else if v.is_module_kind(&kind) {
        out["kind"] = json!("group@1");
        out["params"] = json!({});
    }
    v.write("core.lowered", Val::json(out))
}

/// A document with a status binding.
pub fn has_status(doc: &Value, _: &str, _: &Value) -> bool {
    doc.get("status_bindings")
        .and_then(Value::as_object)
        .is_some_and(|b| !b.is_empty())
}

/// One edit a contribution makes to the core's value it contributes to (Array and table:
/// `contributes_to`): `set` writes the value at the path and `add` adds it, element by element.
#[derive(Clone, Debug, PartialEq)]
pub struct Edit {
    pub add: bool,
    pub path: Vec<String>,
    pub value: Datum,
}

/// An edit's value: a number, a vector, a flag, or a canvas module's own typed value.
#[derive(Clone, Debug)]
pub enum Datum {
    Num(f64),
    Nums(Vec<f64>),
    Bool(bool),
    Typed(Val),
}

impl PartialEq for Datum {
    fn eq(&self, other: &Datum) -> bool {
        match (self, other) {
            (Datum::Num(a), Datum::Num(b)) => a == b,
            (Datum::Nums(a), Datum::Nums(b)) => a == b,
            (Datum::Bool(a), Datum::Bool(b)) => a == b,
            (Datum::Typed(a), Datum::Typed(b)) => a.bytes() == b.bytes(),
            _ => false,
        }
    }
}

impl Canonical for Datum {
    fn encode(&self, out: &mut Vec<u8>) {
        match self {
            Datum::Num(x) => {
                out.push(0);
                x.encode(out);
            }
            Datum::Nums(xs) => {
                out.push(1);
                xs.encode(out);
            }
            Datum::Bool(b) => {
                out.push(2);
                b.encode(out);
            }
            Datum::Typed(v) => {
                out.push(3);
                v.bytes().encode(out);
            }
        }
    }
}

impl Datum {
    /// As JSON, for a reader that hands its item on as the document writes it; a typed value
    /// has no JSON form and reads as null.
    fn to_json(&self) -> Value {
        match self {
            Datum::Num(x) => json!(x),
            Datum::Nums(xs) => json!(xs),
            Datum::Bool(b) => json!(b),
            Datum::Typed(_) => Value::Null,
        }
    }
}

crate::canonical_fields!(Edit { add, path, value });

/// What a contribution writes: its edits, in order.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Edits(pub Vec<Edit>);

crate::canonical_fields!(Edits { 0 });

impl Edits {
    /// One `set` of `value` at `path`.
    pub fn set(path: &[&str], value: Datum) -> Edits {
        Edits(vec![Edit {
            add: false,
            path: path.iter().map(|s| s.to_string()).collect(),
            value,
        }])
    }
}

/// The status map's base (`core.status`): the look's roles that are colors, which a status
/// mark's label ink is chosen from, and the map the look module contributes, its state colors
/// and glyphs; with none, a mark has no glyph.
#[derive(Clone, Debug, Default)]
pub struct StatusBase {
    pub roles: BTreeMap<String, [u8; 3]>,
    pub map: Option<Val>,
}

impl Canonical for StatusBase {
    fn encode(&self, out: &mut Vec<u8>) {
        self.roles.encode(out);
        self.map.as_ref().map(Val::bytes).encode(out);
    }
}

fn rgb(value: &Value) -> Option<[u8; 3]> {
    let c: Vec<u8> = value
        .as_array()?
        .iter()
        .map(|x| x.as_u64().and_then(|x| u8::try_from(x).ok()))
        .collect::<Option<_>>()?;
    <[u8; 3]>::try_from(c.as_slice()).ok()
}

fn status(v: &mut View<'_>) -> Result<(), OpError> {
    let roles = v
        .look()?
        .iter()
        .filter_map(|(role, value)| Some((role.clone(), rgb(value)?)))
        .collect();
    v.write("core.status", Val::typed(StatusBase { roles, map: None }))
}

/// An item's `at`, typed (`core.transform`, `core.world`): `pos`, `rot` and `scale` three numbers
/// each, 0, 0 and 1 where unwritten, and `pivot` and `shear` where the item writes them.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Transform {
    pub pos: [f64; 3],
    pub rot: [f64; 3],
    pub scale: [f64; 3],
    pub pivot: Option<[f64; 3]>,
    pub shear: Option<f64>,
}

crate::canonical_fields!(Transform {
    pos,
    rot,
    scale,
    pivot,
    shear
});

impl Transform {
    /// The transform an item's `at` writes.
    pub fn of(at: Option<&Value>) -> Transform {
        Transform {
            pos: three(at, "pos", 0.0),
            rot: three(at, "rot", 0.0),
            scale: three(at, "scale", 1.0),
            pivot: at
                .and_then(|a| a.get("pivot"))
                .map(|_| three(at, "pivot", 0.0)),
            shear: at.and_then(|a| a.get("shear")).and_then(Value::as_f64),
        }
    }

    /// As the document writes `at`, for a reader that hands its item on as JSON.
    pub fn to_json(&self) -> Value {
        let mut at = Map::new();
        at.insert("pos".into(), json!(self.pos));
        at.insert("rot".into(), json!(self.rot));
        at.insert("scale".into(), json!(self.scale));
        if let Some(p) = self.pivot {
            at.insert("pivot".into(), json!(p));
        }
        if let Some(s) = self.shear {
            at.insert("shear".into(), json!(s));
        }
        Value::Object(at)
    }

    /// One contribution's edit: a vector set or added whole, or one of its parts.
    fn apply(&mut self, e: &Edit) {
        let slot = match e.path.first().map(String::as_str) {
            Some("pos") => &mut self.pos,
            Some("rot") => &mut self.rot,
            Some("scale") => &mut self.scale,
            Some("pivot") => self.pivot.get_or_insert([0.0; 3]),
            Some("shear") => {
                let x = match &e.value {
                    Datum::Num(x) => *x,
                    _ => return,
                };
                let at = self.shear.get_or_insert(0.0);
                *at = if e.add { *at + x } else { x };
                return;
            }
            _ => return,
        };
        let part = e.path.get(1).and_then(|i| i.parse::<usize>().ok());
        let values: &[f64] = match &e.value {
            Datum::Num(x) => std::slice::from_ref(x),
            Datum::Nums(xs) => xs,
            _ => return,
        };
        let from = part.unwrap_or(0);
        for (k, x) in values.iter().enumerate() {
            if let Some(at) = slot.get_mut(from + k) {
                *at = if e.add { *at + x } else { *x };
            }
            if part.is_some() {
                break;
            }
        }
    }
}

/// The item's own transform.
fn transform(v: &mut View<'_>) -> Result<(), OpError> {
    let lowered = v
        .json("core.lowered")?
        .ok_or_else(|| OpError::new("input_missing", v.path()))?;
    v.write(
        "core.transform",
        Val::typed(Transform::of(lowered.get("at"))),
    )
}

/// An item's fields beside its transform (`core.fields`): its lowered form, shared with the
/// check phase that made it rather than copied, and each edit a contribution made to it.
#[derive(Clone, Debug)]
pub struct Fields {
    pub lowered: Arc<Value>,
    pub edits: Vec<Edit>,
}

impl Canonical for Fields {
    fn encode(&self, out: &mut Vec<u8>) {
        super::canonical(&self.lowered).encode(out);
        self.edits.encode(out);
    }
}

impl Fields {
    /// The fields as the document writes them, without `at` and with every edit applied: the
    /// JSON a reader that hands its item on builds for itself.
    pub fn to_json(&self) -> Value {
        let mut out = (*self.lowered).clone();
        if let Some(map) = out.as_object_mut() {
            map.remove("at");
        }
        for e in &self.edits {
            let slot = super::view::slot_at(&mut out, &e.path);
            let value = e.value.to_json();
            if e.add {
                super::view::add_into(slot, &value);
            } else {
                *slot = value;
            }
        }
        out
    }
}

fn fields(v: &mut View<'_>) -> Result<(), OpError> {
    let lowered = v
        .json("core.lowered")?
        .ok_or_else(|| OpError::new("input_missing", v.path()))?;
    v.write(
        "core.fields",
        Val::typed(Fields {
            lowered,
            edits: Vec::new(),
        }),
    )
}

/// The owner's typed value with a contribution's edits applied: the core's transform, fields
/// and status base take them; any other value is kept as it is.
pub(super) fn fold_edits(val: &Val, edits: &[Arc<Edits>]) -> Val {
    if let Some(t) = val.as_typed::<Transform>() {
        let mut t = *t;
        edits.iter().flat_map(|e| &e.0).for_each(|e| t.apply(e));
        return Val::typed(t);
    }
    if let Some(f) = val.as_typed::<Fields>() {
        let mut f = (*f).clone();
        f.edits
            .extend(edits.iter().flat_map(|e| e.0.iter().cloned()));
        return Val::typed(f);
    }
    if let Some(s) = val.as_typed::<StatusBase>() {
        let mut s = (*s).clone();
        for e in edits.iter().flat_map(|e| &e.0) {
            if let (true, Datum::Typed(map)) = (e.path == ["map"], &e.value) {
                s.map = Some(map.clone());
            }
        }
        return Val::typed(s);
    }
    val.clone()
}

fn three(at: Option<&Value>, name: &str, fill: f64) -> [f64; 3] {
    let mut out = [fill; 3];
    if let Some(Value::Array(a)) = at.and_then(|at| at.get(name)) {
        for (o, x) in out.iter_mut().zip(a) {
            *o = x.as_f64().unwrap_or(fill);
        }
    }
    out
}

/// The item's transform composed with its parent's, child-of parenting (canvas primitives:
/// Constraint, R1 `child_of`): the child's position scaled, turned about z by the parent's
/// rotation and moved by its position; rotations add and scales multiply.
fn world(v: &mut View<'_>) -> Result<(), OpError> {
    let own = v
        .typed::<Transform>("core.transform")?
        .ok_or_else(|| OpError::new("input_missing", v.path()))?;
    let mut out = *own;
    if let Some(parent) = v
        .parent("core.world")?
        .and_then(|p| p.as_typed::<Transform>())
    {
        let (p_pos, p_rot, p_scale) = (parent.pos, parent.rot, parent.scale);
        let (pos, rot, scale) = (own.pos, own.rot, own.scale);
        let (x, y) = (pos[0] * p_scale[0], pos[1] * p_scale[1]);
        let (cos, sin) = if p_rot[2] == 0.0 {
            (1.0, 0.0)
        } else {
            let a = ops::rad(p_rot[2]);
            (ops::cos(a), ops::sin(a))
        };
        out.pos = [
            p_pos[0] + x * cos - y * sin,
            p_pos[1] + x * sin + y * cos,
            p_pos[2] + pos[2] * p_scale[2],
        ];
        out.rot = [rot[0] + p_rot[0], rot[1] + p_rot[1], rot[2] + p_rot[2]];
        out.scale = [
            scale[0] * p_scale[0],
            scale[1] * p_scale[1],
            scale[2] * p_scale[2],
        ];
    }
    v.write("core.world", Val::typed(out))
}
