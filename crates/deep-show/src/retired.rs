//! Retired packs in the store (#1958; canvas primitives: Pack: retired and missing). The store
//! keeps a pack version while any document names it: uninstalling retires it, so it stays with
//! its bytes and every document that names it loads, checks and draws as before, and it takes no
//! new instance. The store's sweep then deletes each retired version nothing names. `named_by`
//! counts the documents open in the hub whose packs reach the version, listed or required.

use std::collections::BTreeSet;

use deep_canvas::document::{packs::resolve, Packs};
use serde_json::{json, Value};

use crate::hub::{Hub, Planted};

/// Whether `doc`'s pack graph reaches `key` (`owner/name@version`).
fn names(doc: &Value, key: &str, packs: &Packs) -> bool {
    let lists = doc["packs"].as_array().is_some_and(|l| !l.is_empty());
    lists && resolve(doc, packs, None, &mut Vec::new()).names(key)
}

impl Hub<'_> {
    /// The documents open in the hub that name `key`: each sole writer's current revision and
    /// each shared document.
    fn named_by(&self, key: &str) -> BTreeSet<&str> {
        let current = self.revisions.iter().filter_map(|(id, revs)| {
            let row = revs.iter().find(|r| r.state == "current")?;
            Some((id.as_str(), &row.doc))
        });
        let shared = self.shared.iter().map(|(id, s)| (id.as_str(), &s.doc));
        current
            .chain(shared)
            .filter(|(_, doc)| names(doc, key, &self.packs))
            .map(|(id, _)| id)
            .collect()
    }

    /// The `packs` reply: #306's rows, each with how many documents name the version.
    pub fn packs_reply(&self) -> Value {
        let mut reply = crate::packs::rows_reply(&self.pack_rows, &self.packs);
        for row in reply["packs"].as_array_mut().into_iter().flatten() {
            let key = format!(
                "{}@{}",
                row["pack"].as_str().unwrap_or_default(),
                row["version"].as_str().unwrap_or_default()
            );
            row["named_by"] = json!(self.named_by(&key).len());
        }
        reply
    }

    /// `uninstall_pack`: retires an installed version, then runs the store's sweep.
    pub fn uninstall_pack(&mut self, id: &str, version: &str) -> Value {
        let key = format!("{id}@{version}");
        let row = self
            .pack_rows
            .iter_mut()
            .find(|r| r.pack == id && r.version == version && r.state == "installed");
        let Some(row) = row else {
            return json!({"outcome": "refused", "code": "ref_unresolved", "pack": id, "version": version,
                          "what": format!("`{key}` is not installed here")});
        };
        row.state = "retired";
        self.packs.retire(&key);
        let named_by: Vec<String> = self.named_by(&key).into_iter().map(String::from).collect();
        let deleted = self.sweep();
        json!({"outcome": "retired", "pack": id, "version": version, "named_by": named_by, "deleted": deleted})
    }

    /// The store's sweep: each retired version nothing names is deleted, with its bytes.
    fn sweep(&mut self) -> Vec<String> {
        let planted = self.scenario.planted == Some(Planted::StoreSweepDeletesNamed);
        let gone: Vec<String> = self
            .pack_rows
            .iter()
            .filter(|r| r.state == "retired")
            .map(|r| format!("{}@{}", r.pack, r.version))
            .filter(|key| planted || self.named_by(key).is_empty())
            .collect();
        for key in &gone {
            self.packs.withdraw(key);
            crate::packs::forget(key);
        }
        self.pack_rows
            .retain(|r| !gone.contains(&format!("{}@{}", r.pack, r.version)));
        gone
    }
}
