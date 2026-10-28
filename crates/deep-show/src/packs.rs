//! The pack store (#306; canvas primitives: Pack): each pack the scenario or an `install_pack`
//! call offers is read from its folder (`pack.json` with each recipe file it names inlined),
//! put through the pack check once, and admitted or refused. The store keeps one row per
//! offer, with how many times that version's check ran, so a test reads "once per version,
//! never on open" as a count the binary kept, not its word.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use deep_canvas::document::{Expansion, Issue, Packs};
use deep_canvas::registry::Sealed;
use serde_json::{json, Map, Value};

/// One pack version offered to the store.
pub struct Row {
    pub pack: String,
    pub version: String,
    pub state: &'static str,
    pub issues: Vec<Value>,
}

/// Reads a pack folder as one manifest: `pack.json`, its `id` set to `owner/name`, and each
/// `recipes` entry's file inlined.
fn load(id: &str, dir: &Path) -> Result<Value, Vec<Issue>> {
    let read = |path: &Path| -> Result<Value, Vec<Issue>> {
        let bytes = fs::read(path).map_err(|e| {
            vec![Issue::envelope(
                "ref_unresolved",
                path.to_string_lossy().into_owned(),
                json!(path.to_string_lossy()),
                &format!("can't read the pack file: {e}"),
            )]
        })?;
        serde_json::from_slice(&bytes).map_err(|e| {
            vec![Issue::envelope(
                "out_of_range",
                path.to_string_lossy().into_owned(),
                json!(path.to_string_lossy()),
                &format!("not JSON: {e}"),
            )]
        })
    };
    let mut manifest = read(&dir.join("pack.json"))?;
    let Some(fields) = manifest.as_object_mut() else {
        return Err(vec![Issue::envelope(
            "out_of_range",
            "pack.json".into(),
            manifest.clone(),
            "a pack is an object",
        )]);
    };
    fields.insert("id".into(), json!(id));
    if let Some(Value::Object(recipes)) = fields.get_mut("recipes") {
        for (kind, entry) in recipes.iter_mut() {
            if let Some(file) = entry.as_str() {
                let path = dir.join(file);
                *entry = read(&path).map_err(|mut issues| {
                    for i in &mut issues {
                        i.path = format!("recipes/{kind}");
                    }
                    issues
                })?;
            }
        }
    }
    Ok(manifest)
}

/// Installs one pack version: the folder read, the pack check run once, the store's row kept.
/// The reply is `install_pack`'s.
pub fn install(
    packs: &mut Packs,
    rows: &mut Vec<Row>,
    sealed: &Sealed,
    id: &str,
    dir: &Path,
) -> Value {
    let (version, outcome, issues) = match load(id, dir) {
        Err(issues) => (String::new(), "refused", issues),
        Ok(manifest) => {
            let version = manifest["version"].as_str().unwrap_or_default().to_string();
            match packs.admit(&manifest, sealed) {
                Ok(_) => (version, "installed", Vec::new()),
                Err(issues) => (version, "refused", issues),
            }
        }
    };
    let issues: Vec<Value> = issues.iter().map(Issue::to_json).collect();
    // One row per version: a refused republish leaves the row of the version first published,
    // and a version offered again after a refusal takes its row once admitted.
    match rows
        .iter_mut()
        .find(|r| r.pack == id && r.version == version)
    {
        Some(row) => {
            if row.state == "refused" && outcome == "installed" {
                row.state = outcome;
                row.issues = issues.clone();
            }
        }
        None => rows.push(Row {
            pack: id.to_string(),
            version: version.clone(),
            state: outcome,
            issues: issues.clone(),
        }),
    }
    json!({"outcome": outcome, "pack": id, "version": version, "issues": issues})
}

/// The `packs` reply: one row per version offered, in order, with how often the store has run
/// its check so far.
pub fn rows_reply(rows: &[Row], packs: &Packs) -> Value {
    let list: Vec<Value> = rows
        .iter()
        .map(|r| {
            json!({
                "pack": r.pack,
                "version": r.version,
                "state": r.state,
                "checks": packs.checks(&format!("{}@{}", r.pack, r.version)),
                "issues": r.issues,
            })
        })
        .collect();
    json!({"packs": list})
}

/// `expansions` on a reply: one row per recipe instance, sorted by instance; `timing` when the
/// call asked for it.
pub fn reply(
    expansions: &[Expansion],
    check_ms: Option<f64>,
    timing: bool,
    reply: &mut Map<String, Value>,
) {
    let mut rows: Vec<&Expansion> = expansions.iter().collect();
    rows.sort_by(|a, b| a.instance.cmp(&b.instance));
    reply.insert(
        "expansions".into(),
        Value::Array(rows.iter().map(|e| e.to_json()).collect()),
    );
    if timing {
        if let Some(ms) = check_ms {
            reply.insert("timing".into(), json!({"check_ms": ms}));
        }
    }
}

/// The document as it draws: each recipe instance replaced by the derived items its expansion
/// made, which draw in its place; everything else as the writer sent it.
pub fn drawn(doc: &Value, expansions: &[Expansion]) -> Value {
    let mut out = doc.clone();
    if let Some(Value::Object(items)) = out.get_mut("items") {
        for e in expansions {
            items.shift_remove(&e.instance);
            for (id, item) in &e.derived {
                items.insert(id.clone(), item.clone());
            }
        }
    }
    out
}

/// Each derived item the expansions wrote, with its expansion key and instance: what the 2D draw
/// batches equal expansions by.
pub fn instanced(expansions: &[Expansion]) -> BTreeMap<String, (String, String)> {
    expansions
        .iter()
        .flat_map(|e| {
            e.derived
                .keys()
                .map(|id| (id.clone(), (e.key.clone(), e.instance.clone())))
        })
        .collect()
}

/// `batches` on a snapshot reply: the instanced batches the draw made, each with every item it
/// drew.
pub fn batches(drew: &[crate::snapshot::Batch]) -> Value {
    Value::Array(
        drew.iter()
            .map(|b| json!({"batch": b.key, "items": b.items}))
            .collect(),
    )
}

/// True when any issue needs a pack or a module this build lacks: the check is BLOCKED.
pub fn blocked(issues: &[Issue]) -> bool {
    issues
        .iter()
        .any(|i| i.code == "module_missing" || i.code == "pack_missing")
}
