//! The pack fields a canvas module reads (#1720; Pack: fields, each landing with its feature, such
//! as fx@1's `operators`): the module registers each field with its check, and the pack check hands
//! the field to that module. A field no module of the build reads is refused as unknown.

use serde_json::Value;

use crate::document::Issue;
use crate::registry::{Registrar, Sealed};

/// A module's check of a pack field it reads: over the whole manifest, each refusal as
/// `(path under the field, why)`.
pub type PackField = fn(&Value) -> Vec<(String, String)>;

impl Registrar {
    /// A pack field this module reads, which the pack check holds to `check`: a pack that carries
    /// it is checked by this module, never refused as a field no one reads.
    pub fn pack_field(&mut self, name: &str, check: PackField) -> &mut Self {
        self.pack_fields.push((name.into(), check));
        self
    }
}

/// The issues of a pack's field outside the core's own: its module's refusals, each at
/// `<field>/<path>`, or `unknown_field` when no canvas module of the build reads the field.
pub(super) fn check(sealed: &Sealed, manifest: &Value, key: &str) -> Vec<Issue> {
    let value = &manifest[key];
    let read_by = sealed
        .modules
        .iter()
        .flat_map(|m| &m.shapes.pack_fields)
        .find(|(field, _)| field == key);
    let Some((_, check)) = read_by else {
        return vec![Issue::envelope(
            "unknown_field",
            key.into(),
            value.clone(),
            "not a field of a pack in this slice",
        )];
    };
    check(manifest)
        .into_iter()
        .map(|(path, why)| {
            let actual = value.get(&path).cloned().unwrap_or(Value::Null);
            Issue::envelope("out_of_range", format!("{key}/{path}"), actual, &why)
        })
        .collect()
}
