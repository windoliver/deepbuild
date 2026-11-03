//! The operators that build scene3d's and the building module's items (issue #420): `build`
//! runs an item's builder and its modifier stack, keyed on the item's geometry-class paths, its
//! modifiers and the items it reads; `mark` holds a mark's geometry-class params; `shade` its
//! other params. Each node keys on its own class's paths alone (Dirty classes), so a change to a
//! shading path never rebuilds a mesh, and one a node doesn't read never reruns it.

use deep_canvas::registry::{Applies, Keyed, Registrar};
use deep_canvas::schedule::core_ops::Edits;
use deep_canvas::schedule::{canonical, Canonical, OpError, Val, View};
use serde_json::{json, Map, Value};

use crate::builders::{self, Ctx, Plants};
use crate::geom::Mesh;
use crate::spec::{self, Spec};
use crate::stack::{self, Row};

/// What a `build` node leaves: the builder's mesh and the mesh after its stack, the vertex
/// count declared before either was built, the stack's rows, the geometry params as resolved,
/// and a curve's samples.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Built {
    pub kind: String,
    pub built: Option<Mesh>,
    pub mesh: Option<Mesh>,
    pub declared: u64,
    pub rows: Vec<Row>,
    pub resolved: Value,
    pub curve: Vec<[f64; 3]>,
}

impl Canonical for Built {
    fn encode(&self, out: &mut Vec<u8>) {
        self.kind.encode(out);
        for m in [&self.built, &self.mesh] {
            match m {
                Some(m) => {
                    out.push(1);
                    m.encode(out);
                }
                None => out.push(0),
            }
        }
        self.declared.encode(out);
        let rows: Vec<Value> = self.rows.iter().map(Row::to_json).collect();
        canonical(&json!([rows, self.resolved])).encode(out);
        self.curve.encode(out);
    }
}

/// A node's params of one class, as resolved.
#[derive(Clone, Debug, PartialEq)]
pub struct Shaded(pub Value);

impl Canonical for Shaded {
    fn encode(&self, out: &mut Vec<u8>) {
        canonical(&self.0).encode(out);
    }
}

/// The spec of `kind`, made for this read alone (no table outlives a call).
pub fn spec_of(kind: &str) -> Option<Spec> {
    spec::of(kind)
}

fn kind_of(item: &Value) -> &str {
    item.get("kind").and_then(Value::as_str).unwrap_or("")
}

fn is_builder(_: &Value, _: &str, item: &Value) -> bool {
    let k = kind_of(item);
    builders::KINDS.contains(&k) || k == "curve@1"
}

fn is_mark(_: &Value, _: &str, item: &Value) -> bool {
    let k = kind_of(item);
    (k.starts_with("mark.") || k == "light.sun@1") && spec_of(k).is_some()
}

/// An item with params of a class other than geometry.
pub fn has_shading(_: &Value, _: &str, item: &Value) -> bool {
    spec_of(kind_of(item)).is_some_and(|s| s.params.iter().any(|p| p.class != "geometry"))
}

/// The items a builder reads: a tube's curve, and each enabled modifier's (Modifier: "A
/// disabled modifier reads nothing").
fn refs(item: &Value, planted: Option<&str>) -> Vec<String> {
    let mut out = stack::refs(item, planted);
    if let Some(p) = item.pointer("/params/path").and_then(Value::as_str) {
        out.push(p.to_string());
    }
    out.sort();
    out.dedup();
    out
}

fn keyed_build(doc: &Value, _: &str, item: &Value, planted: Option<&str>) -> Value {
    let kind = kind_of(item);
    let read: Map<String, Value> = refs(item, planted)
        .into_iter()
        .filter_map(|id| Some((id.clone(), doc.get("items")?.get(&id)?.clone())))
        .collect();
    json!({"kind": kind, "params": spec::params_of(item, kind, true, planted),
           "modifiers": item.get("modifiers"), "refs": read})
}

fn keyed_mark(_: &Value, _: &str, item: &Value, planted: Option<&str>) -> Value {
    let kind = kind_of(item);
    json!({"kind": kind, "params": spec::params_of(item, kind, true, planted)})
}

fn keyed_shade(_: &Value, _: &str, item: &Value, planted: Option<&str>) -> Value {
    let kind = kind_of(item);
    json!({"kind": kind, "params": spec::params_of(item, kind, false, planted)})
}

/// Registers a module's `build` and `shade` operators (scene3d's also `mark`): `build` on the
/// items `applies` names, keyed by `keyed`, and `shade` on those `shades` names.
pub fn operators(
    r: &mut Registrar,
    module: &'static str,
    applies: Applies,
    shades: Applies,
    keyed: Keyed,
) {
    let (built, shaded) = if module == "scene3d" {
        ("scene3d.built", "scene3d.shaded")
    } else {
        ("building.built", "building.shaded")
    };
    r.array(built, "built", "item", "geometry", "items");
    r.array(shaded, "shaded", "item", "shading", "items");
    if module == "scene3d" {
        r.array("scene3d.marked", "built", "item", "geometry", "items");
        r.operator(
            "build",
            "items",
            &["self", "refs", "motion.fields"],
            &[built],
        )
        .applies(applies)
        .keyed(keyed)
        .run(run_scene3d);
        r.operator(
            "mark",
            "items",
            &["self", "motion.fields"],
            &["scene3d.marked"],
        )
        .applies(is_mark)
        .keyed(keyed_mark)
        .run(run_mark);
        r.operator("shade", "items", &["self", "motion.fields"], &[shaded])
            .applies(shades)
            .keyed(keyed_shade)
            .run(run_shade_scene3d);
    } else {
        r.operator(
            "build",
            "items",
            &["self", "refs", "motion.fields"],
            &[built],
        )
        .applies(applies)
        .keyed(keyed)
        .run(run_building);
        r.operator("shade", "items", &["self", "motion.fields"], &[shaded])
            .applies(shades)
            .keyed(keyed_shade)
            .run(run_shade_building);
    }
}

/// One of scene3d's items with params of a class other than geometry.
fn scene3d_shades(d: &Value, i: &str, item: &Value) -> bool {
    (is_builder(d, i, item) || is_mark(d, i, item)) && has_shading(d, i, item)
}

/// scene3d's builders and curve: their applies and keys.
pub fn register_scene3d(r: &mut Registrar) {
    operators(r, "scene3d", is_builder, scene3d_shades, keyed_build);
}

/// The item at t: the document's item with the edits motion's channels make to it.
fn item_at(v: &mut View<'_>) -> Result<Value, OpError> {
    let item = v.item()?.clone();
    Ok(match v.typed::<Edits>("motion.fields")? {
        Some(edits) => edits.applied(&item),
        None => item,
    })
}

fn fault(id: &str, path: String) -> OpError {
    OpError::new("out_of_range", format!("items/{id}/{path}"))
}

/// A builder's mesh and stack, or a curve's samples.
pub fn built(doc: &Value, id: &str, item: &Value, planted: Option<&str>) -> Result<Built, String> {
    let kind = kind_of(item).to_string();
    let params = item.get("params").cloned().unwrap_or(json!({}));
    let spec = spec_of(&kind).ok_or("kind")?;
    let resolved = spec::resolved(&spec, &params, true, planted);
    if kind == "curve@1" {
        let sampled = crate::curve::sample(&params)?;
        return Ok(Built {
            kind,
            resolved,
            curve: sampled.points,
            ..Built::default()
        });
    }
    let ctx = Ctx {
        doc,
        plants: planted.and_then(Plants::named).unwrap_or_default(),
    };
    let declared = stack::estimate(builders::estimate(&kind, &params, &ctx)?, item)?;
    let mesh = builders::build(&kind, &params, &ctx)?;
    let (last, rows) = stack::apply(mesh.clone(), item, doc, id)?;
    Ok(Built {
        kind,
        built: Some(mesh),
        mesh: Some(last),
        declared,
        rows,
        resolved,
        curve: Vec::new(),
    })
}

fn run_scene3d(v: &mut View<'_>) -> Result<(), OpError> {
    let id = v.id().unwrap_or_default().to_string();
    let item = item_at(v)?;
    let doc = v.document()?;
    let out = built(doc, &id, &item, v.planted()).map_err(|p| fault(&id, p))?;
    v.write("scene3d.built", Val::typed(out))
}

fn run_building(v: &mut View<'_>) -> Result<(), OpError> {
    let id = v.id().unwrap_or_default().to_string();
    let item = item_at(v)?;
    let doc = v.document()?;
    let kind = kind_of(&item).to_string();
    let spec = spec_of(&kind).ok_or_else(|| fault(&id, "kind".into()))?;
    let params = item.get("params").cloned().unwrap_or(json!({}));
    let resolved = spec::resolved(&spec, &params, true, v.planted());
    let mesh = crate::building::build(doc, &id, &item).map_err(|p| fault(&id, p))?;
    let declared = mesh.positions.len() as u64;
    v.write(
        "building.built",
        Val::typed(Built {
            kind,
            built: Some(mesh.clone()),
            mesh: Some(mesh),
            declared,
            rows: Vec::new(),
            resolved,
            curve: Vec::new(),
        }),
    )
}

fn run_mark(v: &mut View<'_>) -> Result<(), OpError> {
    let item = item_at(v)?;
    let kind = kind_of(&item).to_string();
    let spec = spec_of(&kind).ok_or_else(|| OpError::new("unknown_kind", v.path()))?;
    let resolved = spec::resolved(
        &spec,
        item.get("params").unwrap_or(&json!({})),
        true,
        v.planted(),
    );
    v.write(
        "scene3d.marked",
        Val::typed(Built {
            kind,
            resolved,
            ..Built::default()
        }),
    )
}

fn shaded(v: &mut View<'_>) -> Result<Shaded, OpError> {
    let item = item_at(v)?;
    let kind = kind_of(&item).to_string();
    let spec = spec_of(&kind).ok_or_else(|| OpError::new("unknown_kind", v.path()))?;
    Ok(Shaded(spec::resolved(
        &spec,
        item.get("params").unwrap_or(&json!({})),
        false,
        v.planted(),
    )))
}

fn run_shade_scene3d(v: &mut View<'_>) -> Result<(), OpError> {
    let out = shaded(v)?;
    v.write("scene3d.shaded", Val::typed(out))
}

fn run_shade_building(v: &mut View<'_>) -> Result<(), OpError> {
    let out = shaded(v)?;
    v.write("building.shaded", Val::typed(out))
}
