//! What names what (issue #1801; canvas primitives: Registry and seal: registries; Document
//! envelope, its maps keyed by ID; Object; Item and kind: relations). Every field of a document
//! that names an item, a table row, a pack entry or an asset, with the kind of reference it is.
//! The core declares its own fields here (an item's parent, material and relations, and the
//! fields of the sections keyed by ID); a canvas module declares its kinds' params when it
//! registers them (`Registrar::refs`), and the kit fails a module whose fixture names an ID in a
//! field its kind didn't declare ([`undeclared`]). `deep_query`'s `refs_to` reads these, and so
//! does the refusal of a patch that removes an item they name.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};

use crate::registry::Sealed;

/// The kinds of reference, as a read names them.
pub mod kind {
    /// An item's `parent`.
    pub const PARENT: &str = "parent";
    /// A path that writes the item (a channel's, a driver's, a bound value's or a status
    /// binding's target), a shot's or the document's camera, a collection's member.
    pub const TARGET: &str = "target";
    /// A driver's var bound to a path of the item.
    pub const DRIVER: &str = "driver_binding";
    /// A constraint's owner or one of the items it reads, and an item's relations.
    pub const CONSTRAINT: &str = "constraint";
    /// An instancer's prototype.
    pub const INSTANCER: &str = "instancer";
    /// An item's material, or a map a material samples.
    pub const MATERIAL: &str = "material";
    /// An item a clip's placement binds to a slot.
    pub const CLIP: &str = "clip";
    /// A keyed copy's table row.
    pub const COPY_KEY: &str = "copy_key";
    /// An asset an item draws or reads.
    pub const ASSET: &str = "asset";
    /// An item of a pack's kind or recipe.
    pub const ENTRY: &str = "pack_entry";
}

/// What a declared field holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Holds {
    /// An item's ID, or `ID#part`.
    Item,
    /// A path into an item, `items/<id>/…`, as a driver's target and vars hold.
    Path,
    /// An asset: the document's asset ID, or its SHA-256.
    Asset,
    /// A keyed copy, `<table>[<key>]` (Text `text@1`: keyed copy).
    CopyKey,
}

/// One declared field: where it sits in its row (`params/of`; a `*` takes every key of an
/// object, and a list at the end of the path takes each of its strings), what it holds, and the
/// kind of reference it is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Decl {
    pub field: &'static str,
    pub holds: Holds,
    pub kind: &'static str,
}

impl Decl {
    pub const fn new(field: &'static str, holds: Holds, kind: &'static str) -> Decl {
        Decl { field, holds, kind }
    }
}

/// What a field names.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Name {
    Item(String),
    /// A table's row: a keyed copy's table and key.
    Row(String, String),
    /// A pack's entry, `name@major` as an item's kind names it.
    Entry(String),
    /// An asset's SHA-256.
    Asset(String),
}

impl Name {
    /// What a read's `target` names: an asset by its SHA-256 (64 hex), a keyed copy's table row
    /// as `<table>[<key>]`, a pack entry as `name@major`, else an item by its ID.
    pub fn of_target(target: &str) -> Name {
        if target.len() == 64 && target.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Name::Asset(target.to_ascii_lowercase());
        }
        if let Some((table, key)) = target
            .split_once('[')
            .and_then(|(t, rest)| Some((t, rest.strip_suffix(']')?)))
        {
            return Name::Row(table.trim().to_string(), key.trim().to_string());
        }
        if target.contains('@') {
            return Name::Entry(target.to_string());
        }
        Name::Item(target.to_string())
    }
}

/// One field that names something: the row that holds it (`items/<id>`, `<section>/<id>`), the
/// field's path, its kind of reference and what it names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ref {
    pub row: String,
    pub path: String,
    pub kind: &'static str,
    pub name: Name,
}

use Holds::{Asset, CopyKey, Item, Path};

/// The fields every item may hold that name something (Item and kind; Object; relations).
const ITEM_FIELDS: &[Decl] = &[
    Decl::new("parent", Item, kind::PARENT),
    Decl::new("material", Item, kind::MATERIAL),
    Decl::new("materials/*", Item, kind::MATERIAL),
    Decl::new("at/place/beside", Item, kind::CONSTRAINT),
    Decl::new("at/place/onto", Item, kind::CONSTRAINT),
    Decl::new("at/align/*/to", Item, kind::CONSTRAINT),
    Decl::new("at/fit/to", Item, kind::CONSTRAINT),
    Decl::new("relations/seated_on", Item, kind::CONSTRAINT),
    Decl::new("relations/joined_to", Item, kind::CONSTRAINT),
    Decl::new("relations/fixed_to", Item, kind::CONSTRAINT),
];

/// The fields of the sections keyed by ID that name something (Document envelope; Channel;
/// Driver; Constraint; Clip; Bound value; Status binding; Shot; Collections).
const SECTION_FIELDS: &[(&str, &[Decl])] = &[
    ("collections", &[Decl::new("members", Item, kind::TARGET)]),
    ("channels", &[Decl::new("target", Path, kind::TARGET)]),
    (
        "drivers",
        &[
            Decl::new("target", Path, kind::TARGET),
            Decl::new("vars/*", Path, kind::DRIVER),
        ],
    ),
    (
        "constraints",
        &[
            Decl::new("owner", Item, kind::CONSTRAINT),
            Decl::new("target", Item, kind::CONSTRAINT),
            Decl::new("parent", Item, kind::CONSTRAINT),
            Decl::new("item", Item, kind::CONSTRAINT),
            Decl::new("chain", Item, kind::CONSTRAINT),
            Decl::new("bones", Item, kind::CONSTRAINT),
            Decl::new("targets/*/of", Item, kind::CONSTRAINT),
            Decl::new("fraction/path", Path, kind::CONSTRAINT),
        ],
    ),
    ("placements", &[Decl::new("slots/*", Item, kind::CLIP)]),
    ("shots", &[Decl::new("camera", Item, kind::TARGET)]),
    ("bound_values", &[Decl::new("target", Path, kind::TARGET)]),
    (
        "status_bindings",
        &[Decl::new("target", Path, kind::TARGET)],
    ),
];

/// The document's own fields that name an item.
const ENVELOPE_FIELDS: &[Decl] = &[Decl::new("camera", Item, kind::TARGET)];

/// The params of the kinds marks2d draws with no registry entry (`deep_canvas_marks::scene::KINDS`)
/// that name something: the core declares them, as a module declares its own kinds'.
const CORE_KINDS: &[(&str, &[Decl])] = &[
    ("image@1", &[Decl::new("params/asset", Asset, kind::ASSET)]),
    (
        "text@1",
        &[Decl::new("params/text/copy", CopyKey, kind::COPY_KEY)],
    ),
];

/// The declared params of an item of `kind`: its module's, or the core's for a kind marks2d
/// draws with no registry entry.
fn kind_decls<'s>(sealed: &'s Sealed, kind: &str) -> &'s [Decl] {
    let declared = sealed.refs_of(kind);
    if !declared.is_empty() {
        return declared;
    }
    CORE_KINDS
        .iter()
        .find(|(k, _)| *k == kind)
        .map_or(&[], |(_, d)| d)
}

/// Every value at `field` under `v`, with its path below `at`: a `*` takes each key of an
/// object, and a list where the path ends takes each element.
fn at_pattern<'v>(v: &'v Value, field: &str, at: &str, out: &mut Vec<(String, &'v Value)>) {
    let (head, rest) = match field.split_once('/') {
        Some((h, r)) => (h, Some(r)),
        None => (field, None),
    };
    let mut step = |key: &str, child: &'v Value| {
        let here = format!("{at}/{key}");
        match rest {
            Some(r) => at_pattern(child, r, &here, out),
            None => match child {
                Value::Array(list) => {
                    for (i, x) in list.iter().enumerate() {
                        out.push((format!("{here}/{i}"), x));
                    }
                }
                _ => out.push((here, child)),
            },
        }
    };
    match (head, v) {
        ("*", Value::Object(m)) => m.iter().for_each(|(k, c)| step(k, c)),
        ("*", Value::Array(list)) => list
            .iter()
            .enumerate()
            .for_each(|(i, c)| step(&i.to_string(), c)),
        (key, Value::Object(m)) => {
            if let Some(c) = m.get(key) {
                step(key, c);
            }
        }
        (key, Value::Array(list)) => {
            if let Some(c) = key.parse::<usize>().ok().and_then(|i| list.get(i)) {
                step(key, c);
            }
        }
        _ => {}
    }
}

/// The ID an item field names: `ID` or `ID#part`.
fn item_id(s: &str) -> &str {
    s.split('#').next().unwrap_or(s)
}

/// What one declared value names in `doc`, if anything.
fn named(doc: &Value, holds: Holds, value: &Value) -> Option<Name> {
    let s = value.as_str()?;
    match holds {
        Item => Some(Name::Item(item_id(s).to_string())),
        Path => {
            let rest = s.strip_prefix("items/")?;
            let id = rest.split('/').next().unwrap_or(rest);
            Some(Name::Item(item_id(id).to_string()))
        }
        Asset => Some(Name::Asset(asset_hash(doc, s)?)),
        CopyKey => {
            let (table, rest) = s.trim().split_once('[')?;
            let key = rest.strip_suffix(']')?;
            Some(Name::Row(table.trim().to_string(), key.trim().to_string()))
        }
    }
}

/// The SHA-256 an asset field names: the document's asset by its ID, or a hash itself.
pub fn asset_hash(doc: &Value, s: &str) -> Option<String> {
    if let Some(sha) = doc
        .get("assets")
        .and_then(|a| a.get(s))
        .and_then(|a| a.get("sha256"))
        .and_then(Value::as_str)
    {
        return Some(sha.to_ascii_lowercase());
    }
    let hex = s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit());
    hex.then(|| s.to_ascii_lowercase())
}

/// Each declared field of one row (`items/<id>` or `<section>/<id>`), in declaration order.
fn row_refs(doc: &Value, row: &str, v: &Value, decls: &[Decl], out: &mut Vec<Ref>) {
    for d in decls {
        let mut found = Vec::new();
        at_pattern(v, d.field, row, &mut found);
        for (path, value) in found {
            if let Some(name) = named(doc, d.holds, value) {
                out.push(Ref {
                    row: row.to_string(),
                    path,
                    kind: d.kind,
                    name,
                });
            }
        }
    }
}

/// The pack entry an item's kind is, when a pack the document names gives it (`pack.name@major`
/// with the pack's name its family).
fn pack_entry(doc: &Value, kind: &str) -> Option<String> {
    let family = kind.split('.').next().filter(|f| *f != kind)?;
    let named = doc
        .get("packs")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(Value::as_str)
        .any(|p| {
            let name = p.split('@').next().unwrap_or(p);
            name.rsplit('/').next() == Some(family)
        });
    named.then(|| kind.to_string())
}

/// Every field of `doc` that names something, in the document's order: each item's fields (the
/// core's, then its kind's declared params), then each section's entries, then the envelope's.
pub fn refs(doc: &Value, sealed: &Sealed) -> Vec<Ref> {
    let mut out = Vec::new();
    let empty = Map::new();
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    // Each kind's declarations and pack entry, looked up once per kind, not once per item.
    let mut by_kind: BTreeMap<&str, (&[Decl], Option<String>)> = BTreeMap::new();
    for (id, item) in items {
        let row = format!("items/{id}");
        row_refs(doc, &row, item, ITEM_FIELDS, &mut out);
        if let Some(kind) = item.get("kind").and_then(Value::as_str) {
            let (decls, entry) = by_kind
                .entry(kind)
                .or_insert_with(|| (kind_decls(sealed, kind), pack_entry(doc, kind)));
            row_refs(doc, &row, item, decls, &mut out);
            if let Some(entry) = entry.clone() {
                out.push(Ref {
                    row: row.clone(),
                    path: format!("{row}/kind"),
                    kind: kind::ENTRY,
                    name: Name::Entry(entry),
                });
            }
        }
    }
    for (section, decls) in SECTION_FIELDS {
        for (id, entry) in doc
            .get(*section)
            .and_then(Value::as_object)
            .unwrap_or(&empty)
        {
            row_refs(doc, &format!("{section}/{id}"), entry, decls, &mut out);
        }
    }
    for d in ENVELOPE_FIELDS {
        let mut found = Vec::new();
        at_pattern(doc, d.field, "", &mut found);
        for (path, value) in found {
            if let Some(name) = named(doc, d.holds, value) {
                let path = path.trim_start_matches('/').to_string();
                out.push(Ref {
                    row: path.clone(),
                    path,
                    kind: d.kind,
                    name,
                });
            }
        }
    }
    out
}

/// The fields of `doc` that name `name`, in their paths' order by code point.
pub fn refs_to(doc: &Value, sealed: &Sealed, name: &Name) -> Vec<Ref> {
    let mut out: Vec<Ref> = refs(doc, sealed)
        .into_iter()
        .filter(|r| &r.name == name)
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// Each field of the items of a kind `sealed` knows whose value names an item of `doc` or one of
/// its assets but that neither the core nor the kind declares: `(item, path)`. A field the
/// module didn't declare is one `refs_to` would miss, so the kit fails it, naming the field.
pub fn undeclared(doc: &Value, sealed: &Sealed) -> Vec<(String, String)> {
    let empty = Map::new();
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    // An ID of any map keyed by ID: an item's, a constraint's, a driver's and the rest.
    let ids: BTreeSet<&str> = items
        .keys()
        .chain(
            crate::document::ID_MAPS
                .iter()
                .filter_map(|m| doc.get(*m).and_then(Value::as_object))
                .flat_map(|m| m.keys()),
        )
        .map(String::as_str)
        .collect();
    let assets: BTreeSet<String> = doc
        .get("assets")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .flat_map(|(id, a)| {
            let sha = a.get("sha256").and_then(Value::as_str).map(str::to_string);
            std::iter::once(id.clone()).chain(sha)
        })
        .collect();
    let declared: BTreeSet<String> = refs(doc, sealed).into_iter().map(|r| r.path).collect();
    let mut out = Vec::new();
    for (id, item) in items {
        let Some(params) = item.get("params") else {
            continue;
        };
        let mut strings: BTreeMap<String, &str> = BTreeMap::new();
        strings_at(params, &format!("items/{id}/params"), &mut strings);
        for (path, s) in strings {
            // A role names one of the look's roles, never an item, whatever item shares its word.
            if path.ends_with("/role") {
                continue;
            }
            let names = ids.contains(item_id(s)) && item_id(s) != id || assets.contains(s);
            if names && !declared.contains(&path) {
                out.push((id.clone(), path));
            }
        }
    }
    out
}

/// Every string at any depth of `v`, by its path below `at`.
fn strings_at<'v>(v: &'v Value, at: &str, out: &mut BTreeMap<String, &'v str>) {
    match v {
        Value::String(s) => {
            out.insert(at.to_string(), s);
        }
        Value::Array(list) => {
            for (i, x) in list.iter().enumerate() {
                strings_at(x, &format!("{at}/{i}"), out);
            }
        }
        Value::Object(m) => {
            for (k, x) in m {
                strings_at(x, &format!("{at}/{k}"), out);
            }
        }
        _ => {}
    }
}
