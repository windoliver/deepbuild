//! What the document declares per field for its canonical form (Revision): float widths and
//! defaults. `format`, `id`, `profile`, `title`, `description`, `size`, `layers`, `items` and an
//! item's `params`, `id`, `kind`, `layer`, `name` and `order` have no default, so they are
//! always written; everything else with a declared default is left out when equal to it.

use serde_json::{json, Value};

use crate::canon::{canonical_bytes, sha256_hex, CanonError, Shape, Width};
use crate::kinds::{parse_kind, registry, Param, Registry};

use super::requires::derived_kinds;
use super::{kind_text, member, AT_VECTORS, ID_MAPS};

/// The default values, built with the shape so [`Shape::default_at`] can hand out references.
struct Defaults {
    null: Value,
    true_: Value,
    false_: Value,
    zero: Value,
    zero3: Value,
    one3: Value,
    empty_object: Value,
    empty_list: Value,
    decoration: Value,
    content: Value,
    safe: Value,
    locale: Value,
    letterbox: Value,
    extend: Value,
    auto: Value,
    transport: Value,
}

fn defaults() -> Defaults {
    Defaults {
        null: Value::Null,
        true_: json!(true),
        false_: json!(false),
        zero: json!(0),
        zero3: json!([0, 0, 0]),
        one3: json!([1, 1, 1]),
        empty_object: json!({}),
        empty_list: json!([]),
        decoration: json!("decoration"),
        content: json!("content"),
        safe: json!(24),
        locale: json!("en"),
        letterbox: json!("letterbox"),
        extend: json!("extend"),
        auto: json!("auto"),
        transport: json!({
            "frame_rate": [60, 1],
            "start": 0,
            "span": 0,
            "loop": "none",
            "reduced_motion": "hold",
        }),
    }
}

/// The shape of one document: params are looked up by each item's `kind` in the kind registry
/// of the build that reads it (the core's own, or a sealed set's with its modules' kinds), so
/// one document has one canonical form per build. The defaults are built with the shape, since
/// the lint refuses a static.
pub struct DocShape<'a> {
    doc: &'a Value,
    registry: &'a Registry,
    defaults: Defaults,
    /// `requires.kinds` as the document's fields need it: written so, it is a default.
    kinds: Value,
}

impl<'a> DocShape<'a> {
    pub fn new(doc: &'a Value, registry: &'a Registry) -> Self {
        let kinds = json!(derived_kinds(doc, registry));
        DocShape {
            doc,
            registry,
            defaults: defaults(),
            kinds,
        }
    }

    /// The registered param `name` of the item `id`'s kind, at the major the item names.
    fn param(&self, id: &str, name: &str) -> Option<&Param> {
        let item = member(self.doc, "items").and_then(|items| member(items, id))?;
        let (kind, major) = parse_kind(kind_text(item)?)?;
        let entry = self.registry.entry(&kind)?;
        entry.version(major)?.param(name)
    }
}

impl Shape for DocShape<'_> {
    fn width(&self, path: &[&str]) -> Width {
        match path {
            ["size", _] | ["safe"] => Width::F32,
            ["items", _, "at", "shear"] => Width::F32,
            ["items", _, "at", member, _] if AT_VECTORS.contains(member) => Width::F32,
            ["items", id, "params", name] => match self.param(id, name) {
                Some(p) if p.ty == crate::kinds::ParamType::F32 => Width::F32,
                _ => Width::F64,
            },
            _ => Width::F64,
        }
    }

    // `seed` has the declared default `hash(id)`, but the design defines no `hash@1` yet, so
    // there is no value to compare against: a written seed is kept, an absent one left out.
    fn default_at(&self, path: &[&str]) -> Option<&Value> {
        let d = &self.defaults;
        match path {
            ["items", _, "parent"] => Some(&d.null),
            ["items", _, "role"] => Some(&d.decoration),
            ["items", _, "visible"] | ["items", _, "pickable"] => Some(&d.true_),
            ["items", _, "at"] => Some(&d.empty_object),
            ["items", _, "at", "pos"] | ["items", _, "at", "rot"] | ["items", _, "at", "pivot"] => {
                Some(&d.zero3)
            }
            ["items", _, "at", "scale"] => Some(&d.one3),
            ["items", _, "at", "shear"] => Some(&d.zero),
            ["items", id, "params", name] => self.param(id, name).map(|p| &p.default),
            ["layers", _, "role"] => Some(&d.content),
            ["layers", _, "locked"] => Some(&d.false_),
            ["transport"] => Some(&d.transport),
            ["safe"] => Some(&d.safe),
            ["locale"] => Some(&d.locale),
            ["aspect"] => {
                let profile = member(self.doc, "profile").and_then(Value::as_str);
                Some(if extends_by_default(profile) {
                    &d.extend
                } else {
                    &d.letterbox
                })
            }
            ["requires"] | ["look"] | ["budget"] | ["assets"] | ["requires", "modules"] => {
                Some(&d.empty_object)
            }
            ["requires", "kinds"] => Some(&self.kinds),
            ["requires", "preview"] | ["packs"] => Some(&d.empty_list),
            ["look", "theme"] => Some(&d.auto),
            ["camera"] => Some(&d.null),
            [map] if ID_MAPS.contains(map) => Some(&d.empty_object),
            _ => None,
        }
    }
}

/// The envelope's `aspect` default: extend for 3D scenes and figures, letterbox for films and
/// 2D documents.
pub fn extends_by_default(profile: Option<&str>) -> bool {
    matches!(profile, Some("figure") | Some("scene") | Some("world"))
}

/// A document's canonical text and the SHA-256 of its bytes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Canonical {
    pub bytes: String,
    pub sha256: String,
}

/// The canonical form of `doc` under its own shape, by the core's own kinds.
pub fn canonical(doc: &Value) -> Result<Canonical, CanonError> {
    canonical_in(doc, &registry())
}

/// The canonical form of `doc` under its own shape, by the kinds of the build that reads it
/// (a sealed set's `kinds()`), so a module kind's param widths and defaults count.
pub fn canonical_in(doc: &Value, kinds: &Registry) -> Result<Canonical, CanonError> {
    let shape = DocShape::new(doc, kinds);
    let bytes = canonical_bytes(doc, &shape)?;
    let sha256 = sha256_hex(&bytes);
    Ok(Canonical {
        bytes: String::from_utf8_lossy(&bytes).into_owned(),
        sha256,
    })
}
