//! Issue #200: `deep://registries/<core version>` (canvas primitives: Registry and seal:
//! registries): every registry the build declares, with its entries, their origins and their kit
//! results, the entries packs fill beside a module's, and every hub slot in the same shape,
//! marked as a slot, with its installed fills and their kit results; an entry of a registry by
//! name through a document's pinned packs, by interned name; and the entry a check input names,
//! for the check kinds that read one.

use std::collections::BTreeMap;
use std::time::Instant;

use deep_canvas::registry::lists::{Interner, SealedEntry};
use serde_json::{json, Value};

use crate::hub::Hub;

/// A planted wrong listing: one that leaves the hub's slots out, or lists a slot's fills as
/// entries of a registry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Listing {
    WithoutSlots,
    FillAsEntry,
}

/// The hub's slot table (technical design: Composition), as packages/contracts publishes it.
fn slot_table() -> Vec<Value> {
    serde_json::from_str(include_str!("../../../packages/contracts/hub-slots.json"))
        .expect("hub-slots.json is JSON")
}

impl Hub<'_> {
    /// Every entry admitted packs fill, as each is listed: origin `agent` for a pack the working
    /// agent installed through its session, `first_party` for one the hub's release ships (#1720),
    /// else `pack`.
    fn pack_entries(&self) -> Vec<SealedEntry> {
        // #415: a pack's admitted layouts are data.layout@1 entries beside its `entries`.
        let layouts = self
            .sandbox
            .layout_entries
            .iter()
            .filter(|e| self.packs.all().any(|p| p.id.text() == e.pack));
        self.packs
            .all()
            .flat_map(|p| p.entries.iter())
            .chain(layouts)
            .map(|e| {
                let mut e = e.clone();
                e.origin = self.pack_origin(&e.pack);
                e
            })
            .collect()
    }

    /// Where an admitted pack, `owner/name@version`, came from: `agent` when the working agent
    /// installed it through its session, `first_party` when its owner is DeepBuild's own (the
    /// release's packs; the hub installs no other pack under that owner, #1720), else `pack`.
    pub fn pack_origin(&self, pack: &str) -> &'static str {
        if self.pack_authors.contains_key(pack) {
            "agent"
        } else if pack.starts_with("deepbuild/") {
            "first_party"
        } else {
            "pack"
        }
    }

    /// `{"call": "registries"}`: `deep://registries/<core version>`.
    pub fn registries_reply(&self) -> Value {
        let sealed = &self.startup.sealed;
        let from_packs = self.pack_entries();
        let mut list: Vec<Value> = sealed
            .registries
            .iter()
            .map(|r| {
                let more: Vec<SealedEntry> = from_packs
                    .iter()
                    .filter(|e| e.registry == r.def.name)
                    .cloned()
                    .collect();
                let mut row = r.to_json(&more);
                // #238: a program entry names its program and the bytes sandbox@1 rewrote it to.
                for e in row["entries"].as_array_mut().into_iter().flatten() {
                    let name = e["name"].as_str().unwrap_or_default().to_string();
                    if let Some(p) = self.sandbox.programs.get(&(r.def.name.clone(), name)) {
                        e["program"] = p.clone();
                    }
                    // #501: an export target's writer, reader, fidelity and hidden items, as
                    // the entry's own fields.
                    if r.def.name == "export.target@1" {
                        for k in ["writer", "reader", "fidelity", "hidden"] {
                            e[k] = e["value"][k].clone();
                        }
                    }
                }
                row
            })
            .collect();
        if self.startup.listing != Some(Listing::WithoutSlots) {
            for row in slot_table() {
                let interface = row["interface"].as_str().unwrap_or_default();
                if list.iter().any(|l| l["name"] == interface) {
                    continue;
                }
                let fills: Vec<Value> = self
                    .scenario
                    .installed
                    .iter()
                    .filter(|i| i["slot"] == interface)
                    .map(|i| json!({"name": i["fill"], "kit": i["kit"]}))
                    .collect();
                if self.startup.listing == Some(Listing::FillAsEntry) {
                    // Planted: the slot's fills listed as entries of a registry.
                    if let Some(first) = list.iter_mut().find(|l| l["kind"] == "registry") {
                        if let Some(entries) = first["entries"].as_array_mut() {
                            entries.extend(fills.iter().map(
                                |f| json!({"name": f["name"], "origin": "plugin", "kit": f["kit"]}),
                            ));
                        }
                    }
                    continue;
                }
                list.push(json!({
                    "kind": "slot", "name": interface, "interface": interface, "digest": row["digest"],
                    "how_many": row["fills"], "kit": row["kit"], "planted": row["planted"],
                    "since": row["since"], "fills": fills,
                }));
            }
        }
        json!({"uri": sealed.registries_uri(), "registries": list})
    }

    /// The entry `name` of `registry` a document resolves: a canvas module's or the core's, or
    /// one a pack it pins fills.
    pub fn entry_for(&self, doc: &Value, registry: &str, name: &str) -> Option<SealedEntry> {
        let reg = self.startup.sealed.registry(registry)?;
        if let Some(e) = reg.entry(name) {
            return Some(e.clone());
        }
        let pinned: Vec<&str> = doc
            .get("packs")
            .and_then(Value::as_array)
            .map(|p| p.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        pinned.iter().find_map(|id| {
            let p = self.packs.get(id)?;
            let mut e = p
                .entries
                .iter()
                .find(|e| e.registry == registry && e.name == name)?
                .clone();
            e.origin = self.pack_origin(id);
            Some(e)
        })
    }

    /// A document's current revision as its writer sent it, shared or a session's.
    fn writers_doc(&self, doc: &str) -> Option<Value> {
        if let Some(shared) = self.shared.get(doc) {
            let k = shared.revs.len().checked_sub(1)?;
            return Some(shared.at(k).0.into_owned());
        }
        self.revisions
            .get(doc)?
            .iter()
            .find(|x| x.state == "current")
            .map(|r| r.doc.clone())
    }

    /// `{"call": "resolve", "doc", "registry", "name", "runs"?}`: the entry through the document's
    /// pinned packs, or `{"code"}` when it resolves none; with `runs`, each of that many lookups
    /// by the name's interned symbol in the table of every entry the document resolves, timed.
    pub fn lookup_reply(&self, doc: &str, registry: &str, name: &str, runs: usize) -> Value {
        let Some(current) = self.writers_doc(doc) else {
            return json!({"code": "doc_missing", "doc": doc});
        };
        let Some(entry) = self.entry_for(&current, registry, name) else {
            return json!({"code": "entry_unresolved", "registry": registry, "name": name});
        };
        let mut out = json!({"entry": entry.to_json()});
        if runs > 0 {
            // Every entry of the registry the document resolves, interned once; a lookup reads
            // its symbol's slot.
            let mut names = Interner::default();
            let mut table: BTreeMap<u32, SealedEntry> = BTreeMap::new();
            let own = self
                .startup
                .sealed
                .registry(registry)
                .map(|r| r.entries.clone())
                .unwrap_or_default();
            let pinned = self.pack_entries().into_iter().filter(|e| {
                e.registry == registry
                    && current["packs"]
                        .as_array()
                        .is_some_and(|p| p.iter().any(|x| x.as_str() == Some(e.pack.as_str())))
            });
            for e in own.into_iter().chain(pinned) {
                table.insert(names.intern(&e.name), e);
            }
            let symbol = names.get(name).unwrap_or_default();
            let mut ns = Vec::with_capacity(runs);
            for _ in 0..runs {
                let t0 = Instant::now();
                std::hint::black_box(
                    std::hint::black_box(&table).get(&std::hint::black_box(symbol)),
                );
                ns.push(t0.elapsed().as_nanos() as u64);
            }
            out["ns"] = json!(ns);
        }
        out
    }
}

/// #213: a plug-in's entry as the listing shows it: in a registry whose fill doesn't name plug-ins,
/// such as `logic.service@1`, which only first-party canvas modules fill, it is unavailable and
/// refused, naming the registry and its fill.
pub(crate) fn fill_checked(mut e: Value, registry: &Value) -> Value {
    let fill = &registry["fill"];
    if !fill
        .as_array()
        .is_some_and(|f| f.contains(&json!("plugin")))
    {
        let name = &registry["name"];
        let what =
            format!("{name} is filled by {fill}, not by plug-ins; a plug-in adds no entry to it");
        e["available"] = json!(false);
        e["refused"] =
            json!({"code": "fill_refused", "registry": name, "fill": fill, "what": what});
    }
    e
}

#[cfg(test)]
mod tests {
    use serde_json::Value;

    /// The canvas schema of the core's closed lists says each list as the core holds it, so the
    /// closure lint reads the lists the seal checks.
    #[test]
    fn the_closed_lists_schema_holds_the_cores_lists() {
        let schema: Value = serde_json::from_str(include_str!(
            "../../../packages/contracts/canvas-schemas/canvas.lists@1.json"
        ))
        .expect("JSON");
        for (name, values) in deep_canvas::registry::closed_lists() {
            let listed: Vec<&str> = schema["properties"][name]["enum"]
                .as_array()
                .unwrap_or_else(|| panic!("canvas.lists@1 has no list {name}"))
                .iter()
                .filter_map(Value::as_str)
                .collect();
            assert_eq!(listed, values, "{name}");
        }
    }

    /// Every registry the core declares is a contract entry in canvas-registries.json, with the
    /// row its declaration publishes.
    #[test]
    fn the_cores_registries_are_their_contract_rows() {
        let rows: Vec<Value> = serde_json::from_str(include_str!(
            "../../../packages/contracts/canvas-registries.json"
        ))
        .expect("JSON");
        for def in deep_canvas::registry::core_lists::registries() {
            let row = rows
                .iter()
                .find(|r| r["registry"] == def.name.as_str())
                .unwrap_or_else(|| panic!("canvas-registries.json has no row for {}", def.name));
            assert_eq!(*row, Value::Object(def.contract("core")), "{}", def.name);
        }
    }
}
