//! Pack: retired and missing (#1958). Uninstalling a version something names retires it: it
//! still resolves, so the documents that name it load, check and draw as before, and it takes
//! no new instance. A version whose bytes are gone leaves its document open: each instance of it
//! is kept as written and skipped when drawing, with one `pack_missing` notice naming the pack,
//! the version and the instances; nothing draws one with another version.

use serde_json::{json, Value};

use super::{Packs, Resolved};
use crate::document::{Issue, Notice};

/// A version the document names that this build lacks, with the instances that need it.
#[derive(Clone, Debug, PartialEq)]
pub struct Missing {
    /// The pack as the document wrote it, `owner/name` or `name`.
    pub pack: String,
    /// Its name, the `<pack>` half of its kinds.
    pub name: String,
    pub version: String,
    /// Where the document lists it, `packs/<i>`.
    pub path: String,
    pub ids: Vec<String>,
}

impl Missing {
    /// The load's notice: the document opens, and these instances are kept and skipped.
    pub fn notice(&self) -> Notice {
        Notice {
            code: "pack_missing",
            ids: self.ids.clone(),
            path: self.path.clone(),
            actual: json!({"pack": self.pack, "version": self.version}),
            what: format!(
                "pack `{}` at version {} is not in this build: its instances are kept as written and skipped when drawing, never drawn with another version",
                self.pack, self.version
            ),
            migration: None,
            replaced_by: None,
            close: Vec::new(),
        }
    }
}

impl Packs {
    /// Retires an admitted version: it stays in the store while something names it, resolves as
    /// before, and takes no new instance.
    pub fn retire(&mut self, key: &str) {
        if self.by_id.contains_key(key) {
            self.retired.insert(key.to_string());
        }
    }

    /// Takes a retired version back as installed (it was offered again).
    pub fn reinstate(&mut self, key: &str) {
        self.retired.remove(key);
    }

    pub fn is_retired(&self, key: &str) -> bool {
        self.retired.contains(key)
    }
}

impl Resolved<'_> {
    /// Whether the document reaches `owner/name@version`, listed or required: it names it.
    pub fn names(&self, key: &str) -> bool {
        self.by_name.values().any(|p| p.id.text() == key)
    }
}

/// The version a new instance of `kind` would need, when the build can't take one: its pack is
/// missing here or retired. `(pack, version)`.
pub fn no_new_instance(
    kind: &str,
    resolved: &Resolved<'_>,
    packs: Option<&Packs>,
) -> Option<(String, String)> {
    let (family, _) = kind.split_once('.')?;
    if let Some(m) = resolved.missing.iter().find(|m| m.name == family) {
        return Some((m.pack.clone(), m.version.clone()));
    }
    let pack = resolved.by_name.get(family)?;
    packs
        .filter(|p| p.is_retired(&pack.id.text()))
        .map(|_| (pack.id.id.clone(), pack.id.version.to_string()))
}

/// A patch's refusal of a new instance of a pack missing or retired here.
pub fn refusal(id: &str, kind: &str, (pack, version): (String, String)) -> Issue {
    Issue::error(
        "pack_missing",
        id,
        format!("items/{id}/kind"),
        json!({"pack": pack, "version": version, "kind": kind}),
        &format!("pack `{pack}` at version {version} takes no new instance here: it is missing or retired"),
    )
}

/// Whether `kind` is of a pack the document names and this build lacks: its item is skipped.
pub fn skipped(kind: &str, resolved: &Resolved<'_>) -> bool {
    kind.split_once('.')
        .is_some_and(|(family, _)| resolved.missing.iter().any(|m| m.name == family))
}

/// `pack_missing`'s fields on its JSON, beside `actual`.
pub fn fields(actual: &Value, out: &mut serde_json::Map<String, Value>) {
    for key in ["pack", "version"] {
        if let Some(v) = actual.get(key) {
            out.insert(key.into(), v.clone());
        }
    }
}
