//! The pack store (#306; canvas primitives: Pack): each pack the scenario or an `install_pack`
//! call offers is read from its folder (`pack.json` with each recipe file it names inlined),
//! put through the pack check once, and admitted or refused. The store keeps one row per
//! offer, with how many times that version's check ran, so a test reads "once per version,
//! never on open" as a count the binary kept, not its word.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use deep_canvas::document::{CheckResult, Expansion, Issue, Pack, Packs};
use deep_canvas::registry::Sealed;
use serde_json::{json, Map, Value};

/// One pack version offered to the store.
pub struct Row {
    pub pack: String,
    pub version: String,
    pub state: &'static str,
    pub issues: Vec<Value>,
    /// Each layout, as its validator judged its twins at the pack check (#238).
    pub layouts: Vec<Value>,
}

/// The half of the pack check that runs a pack's programs, after the core's half admitted it:
/// its layouts' rows and the issues that refuse it (#238).
pub type Vet<'v> =
    &'v mut dyn FnMut(&Value, &deep_canvas::document::Pack) -> (Vec<Value>, Vec<Issue>);

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
    // #238: each asset's bytes, in hex, once its sha256 and size match what the manifest lists, for
    // the programs and data the sandbox module runs at the pack check.
    if let Some(Value::Array(assets)) = fields.get_mut("assets") {
        for (i, a) in assets.iter_mut().enumerate() {
            let path = a
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            let bytes = fs::read(dir.join(&path)).ok();
            let sha = bytes.as_deref().map(deep_canvas::schedule::sha256_hex);
            let listed = a.get("sha256").and_then(Value::as_str);
            let size = a.get("size").and_then(Value::as_u64);
            match bytes {
                Some(b) if sha.as_deref() == listed && size == Some(b.len() as u64) => {
                    a["hex"] = json!(b.iter().map(|x| format!("{x:02x}")).collect::<String>());
                }
                _ => return Err(vec![Issue::envelope(
                    "ref_unresolved",
                    format!("assets/{i}"),
                    a.clone(),
                    &format!(
                        "the asset `{path}` isn't there with the sha256 and size the pack lists"
                    ),
                )]),
            }
        }
    }
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
    twin: Option<&str>,
    vet: Vet<'_>,
) -> Value {
    let mut layouts = Vec::new();
    let (version, outcome, issues) = match load(id, dir) {
        Err(issues) => (String::new(), "refused", issues),
        Ok(mut manifest) => {
            if let Some(planted) = twin {
                crate::familiar::twin(planted, id, &mut manifest);
            }
            let version = manifest["version"].as_str().unwrap_or_default().to_string();
            match packs.admit(&manifest, sealed).cloned() {
                Ok(pack) => {
                    let (rows, issues) = vet(&manifest, &pack);
                    layouts = rows;
                    if issues.is_empty() {
                        (version, "installed", Vec::new())
                    } else {
                        packs.withdraw(&pack.id.text());
                        (version, "refused", issues)
                    }
                }
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
                row.layouts = layouts.clone();
            }
        }
        None => rows.push(Row {
            pack: id.to_string(),
            version: version.clone(),
            state: outcome,
            issues: issues.clone(),
            layouts: layouts.clone(),
        }),
    }
    json!({"outcome": outcome, "pack": id, "version": version, "issues": issues, "layouts": layouts})
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
                "layouts": r.layouts,
            })
        })
        .collect();
    json!({"packs": list})
}

/// `expansions` on a reply: one row per recipe instance, sorted by instance; `timing` when the
/// call asked for it.
pub fn reply(
    expansions: &[Expansion],
    check_ms: Option<(f64, Option<f64>)>,
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
        if let Some((ms, rules)) = check_ms {
            let mut t = json!({"check_ms": ms});
            if let Some(rules) = rules {
                t["kind_rules_ms"] = json!(rules);
            }
            reply.insert("timing".into(), t);
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

/// The kind kit's mesh part (Pack: kind rules and the kind kit; #202): every mesh a kind's
/// expansions name, at its defaults and its params' extremes, passes `geometry.shading` with no
/// defect. The check is the loop module's, which the core can't import, so it runs here; a kind
/// that makes a mesh in a build without the module is refused, never passed.
pub fn kind_meshes(pack: &Pack, sealed: &Sealed, evidence: &Path) -> Vec<Issue> {
    let mut issues = Vec::new();
    let shading = sealed
        .check_kind("geometry.shading")
        .and_then(|(_, c)| c.report);
    for (name, kind) in pack.kinds.iter().filter(|(_, k)| !k.meshes.is_empty()) {
        let refuse = |code, actual: Value, what: String| {
            Issue::envelope(code, format!("kinds/{name}"), actual, &what)
        };
        let Some(report) = shading else {
            issues.push(refuse("module_missing", json!({"kind": name, "part": "cost", "module": "loop"}),
                format!("kind `{name}` makes meshes, and geometry.shading is the loop module's, which this build lacks")));
            continue;
        };
        let mut items = serde_json::Map::new();
        let mut assets = serde_json::Map::new();
        for (i, sha) in kind.meshes.iter().enumerate() {
            let id = format!("m{i}");
            items.insert(
                id.clone(),
                json!({"id": id, "kind": "mesh.asset@1", "params": {"sha256": sha}}),
            );
            if let Some(bytes) = crate::evidence::read(evidence, sha) {
                assets.insert(sha.clone(), json!(deep_canvas::base64::encode(&bytes)));
            }
        }
        let out = report(
            &json!({"items": items}),
            &json!({"kind": "geometry.shading", "assets": assets}),
        );
        let defect = out
            .raised
            .first()
            .map(|(id, r, actual)| json!({"item": id, "code": r.code, "actual": actual}));
        if let Some(found) = defect.or_else(|| out.blocked.first().cloned()) {
            issues.push(refuse("out_of_range", json!({"kind": name, "part": "cost", "defect": found}),
                format!("kind `{name}` fails its kit's cost part: a mesh it makes fails geometry.shading")));
        }
    }
    issues
}

/// `timing.kind_rules_ms` (#202): the core's `kind_rules` check over a checked revision, run
/// again on its lowered items and timed here, since the core reads no clock.
pub fn kind_rules_ms(doc: &Value, checked: &CheckResult, sealed: &Sealed, packs: &Packs) -> f64 {
    let mut ignored = Vec::new();
    let resolved = deep_canvas::document::packs::resolve(doc, packs, Some(sealed), &mut ignored);
    let empty = Map::new();
    let items = checked
        .lowered
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let started = std::time::Instant::now();
    let run = deep_canvas::document::pack_kinds::kind_rules(
        doc,
        items,
        &checked.expansions,
        &resolved,
        packs.planted,
    );
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    std::hint::black_box(run);
    ms
}
