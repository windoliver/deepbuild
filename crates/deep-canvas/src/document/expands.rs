//! A canvas module's own item kind expanded at check, never per frame (Cue list `cues@1`; #222):
//! the module registers a function for its kind, the check calls it on each item of that kind
//! after recipes expand, and what it returns joins the lowered document as ordinary items and
//! section entries (channels, markers, constraints), so everything downstream reads plain data.
//! The core imports no module: the function comes through the registrar, as a builder's elements
//! do (#2015), and it reads registry entries through [`Entries`], the sealed ones and those the
//! document's pinned packs fill.

use serde_json::{json, Map, Value};

use super::packs::{Derived, Expansion, Resolved};
use super::{kind_text, member, Issue};
use crate::registry::{Registrar, Sealed};
use crate::schedule::{canonical, Hasher};

/// The sections an expansion may write besides items.
pub const SECTIONS: [&str; 3] = ["channels", "markers", "constraints"];

/// What a module's expansion reads.
pub struct Request<'a> {
    /// The document as written, with the sections earlier expansions wrote merged in.
    pub doc: &'a Value,
    /// The items as the check holds them so far: migrated, recipes expanded.
    pub items: &'a Map<String, Value>,
    pub id: &'a str,
    pub item: &'a Value,
    pub entries: &'a Entries<'a>,
    /// A planted wrong program of the module's, by name, off by default.
    pub planted: Option<&'static str>,
}

/// The registry entries a document can use: those canvas modules filled at the seal, then those
/// its pinned packs fill (Registry and seal: registries).
pub struct Entries<'a> {
    sealed: &'a Sealed,
    resolved: &'a Resolved<'a>,
}

impl<'a> Entries<'a> {
    pub fn new(sealed: &'a Sealed, resolved: &'a Resolved<'a>) -> Self {
        Entries { sealed, resolved }
    }

    /// The value of `registry`'s entry `name`, with the pack that filled it (empty for a module's).
    pub fn get(&self, registry: &str, name: &str) -> Option<(&'a Value, &'a str)> {
        if let Some(e) = self.sealed.registry(registry).and_then(|r| r.entry(name)) {
            return Some((&e.value, e.pack.as_str()));
        }
        self.resolved
            .by_name
            .values()
            .flat_map(|p| p.entries.iter())
            .find(|e| e.registry == registry && e.name == name)
            .map(|e| (&e.value, e.pack.as_str()))
    }
}

/// What an expansion wrote: derived items by ID, and section entries by section, then ID.
#[derive(Default)]
pub struct Lowered {
    pub items: Map<String, Value>,
    pub sections: Map<String, Value>,
}

/// Why an expansion refused its item: a code of the module's catalog, at a path in the document.
pub struct Refusal {
    pub code: &'static str,
    pub path: String,
    pub actual: Value,
    pub what: String,
}

/// A module's expansion of one item of its kind.
pub type Expand = fn(&Request<'_>) -> Result<Lowered, Vec<Refusal>>;

impl Registrar {
    /// Expands each item of the kind `family.name` at check (#222).
    pub fn expands(&mut self, kind: &str, expand: Expand) -> &mut Self {
        self.expands.push((kind.into(), expand));
        self
    }
}

/// Whether a sealed module expands items of the kind `text` (`family.name@major`) at check.
pub(super) fn expanded(sealed: &Sealed, text: &str) -> bool {
    let Some((full, _)) = crate::kinds::parse_kind(text) else {
        return false;
    };
    sealed
        .modules
        .iter()
        .any(|m| m.shapes.expands.iter().any(|(k, _)| *k == full))
}

/// Expands every item of a kind a sealed module expands, in document order, each seeing the
/// sections the ones before it wrote. A refused item writes nothing.
pub(super) fn run(
    doc: &Value,
    items: &mut Map<String, Value>,
    sealed: &Sealed,
    resolved: &Resolved<'_>,
    planted: Option<&'static str>,
    issues: &mut Vec<Issue>,
) -> Vec<Expansion> {
    let fns: Vec<&(String, Expand)> = sealed
        .modules
        .iter()
        .flat_map(|m| m.shapes.expands.iter())
        .collect();
    let mut out = Vec::new();
    if fns.is_empty() {
        return out;
    }
    let of = |item: &Value| {
        let (full, _) = crate::kinds::parse_kind(kind_text(item)?)?;
        fns.iter().find(|(k, _)| *k == full).map(|(_, f)| *f)
    };
    let ids: Vec<String> = items
        .iter()
        .filter(|(_, item)| of(item).is_some())
        .map(|(id, _)| id.clone())
        .collect();
    let entries = Entries::new(sealed, resolved);
    let mut seen = doc.clone();
    for id in ids {
        let item = items[&id].clone();
        let Some(expand) = of(&item) else { continue };
        let request = Request {
            doc: &seen,
            items,
            id: &id,
            item: &item,
            entries: &entries,
            planted,
        };
        let lowered = match expand(&request) {
            Ok(l) => l,
            Err(refusals) => {
                issues.extend(refusals.into_iter().map(|r| Issue {
                    ids: vec![id.clone()],
                    ..Issue::envelope(r.code, r.path, r.actual, &r.what)
                }));
                continue;
            }
        };
        if let Some(clash) = clash(&seen, items, &lowered) {
            issues.push(Issue {
                ids: vec![id.clone(), clash.1.clone()],
                ..Issue::envelope(
                    "out_of_range",
                    format!("items/{id}"),
                    json!(clash.1),
                    &format!(
                        "`{id}` would write {} `{}`, which the document already holds",
                        clash.0, clash.1
                    ),
                )
            });
            continue;
        }
        merge_into(&mut seen, &lowered.sections);
        let mut key = Hasher::v1("expands.key");
        key.text(&id)
            .bytes(&canonical(&item))
            .bytes(&canonical(&Value::Object(lowered.sections.clone())))
            .bytes(&canonical(&Value::Object(lowered.items.clone())));
        let derived = lowered
            .items
            .keys()
            .map(|d| Derived {
                id: d.clone(),
                seed: super::packs::seed_of(&id, d, None),
            })
            .collect();
        // Each derived item sits in the expanded item's layer, as a recipe's do.
        let mut derived_items = lowered.items;
        if let Some(layer) = item.get("layer") {
            for v in derived_items.values_mut() {
                v["layer"] = layer.clone();
            }
        }
        for (d, v) in &derived_items {
            items.insert(d.clone(), v.clone());
        }
        out.push(Expansion {
            instance: id.clone(),
            kind: kind_text(&item).unwrap_or_default().to_string(),
            pack: String::new(),
            key: key.finish().hex(),
            items: derived,
            derived: derived_items,
            broken_out: Vec::new(),
            orphaned: Vec::new(),
            channels: Map::new(),
            sections: lowered.sections,
        });
    }
    out
}

/// The first derived item or section entry whose ID the document already holds.
fn clash(doc: &Value, items: &Map<String, Value>, l: &Lowered) -> Option<(&'static str, String)> {
    if let Some(id) = l.items.keys().find(|k| items.contains_key(*k)) {
        return Some(("the item", id.clone()));
    }
    for section in SECTIONS {
        let (Some(held), Some(Value::Object(new))) = (
            member(doc, section).and_then(Value::as_object),
            l.sections.get(section),
        ) else {
            continue;
        };
        if let Some(id) = new.keys().find(|k| held.contains_key(*k)) {
            return Some((section, id.clone()));
        }
    }
    None
}

fn merge_into(doc: &mut Value, sections: &Map<String, Value>) {
    let Some(doc) = doc.as_object_mut() else {
        return;
    };
    for (section, entries) in sections {
        let Value::Object(entries) = entries else {
            continue;
        };
        let at = doc
            .entry(section.clone())
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(map) = at.as_object_mut() {
            map.extend(entries.clone());
        }
    }
}

/// The sections each expansion wrote, merged into `doc`: what the check's lowered document and a
/// session's drawn form both hold, so the motion program, film.layout and every reader of
/// markers see plain entries.
pub fn merge(doc: &mut Value, expansions: &[Expansion]) {
    for e in expansions {
        merge_into(doc, &e.sections);
    }
}
