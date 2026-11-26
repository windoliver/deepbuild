//! Issue #185: a module's digest over the shapes it registers, each shape by its own name.

use super::*;

/// A module's digest: `d1` over the kinds, public arrays, tables, carried state, check kinds
/// and tool entries it registers (Canvas module: interface and implementation: digest scope),
/// each list sorted; and each of those shapes by its own name (`array <name>`, `kind <name>`)
/// with its own `d1`, so a mismatch names the first that differs. `hash_private` is the planted
/// digest that lets private arrays in.
pub(super) fn module_shapes(
    r: &Registrar,
    lists: Option<&Value>,
    hash_private: bool,
) -> Result<(String, BTreeMap<String, String>), CanonError> {
    // A private array is the implementation's own, so neither its entry nor its name in a
    // kind's needs or a table's reads enters the interface's digest.
    let private: BTreeSet<&str> = r
        .arrays
        .iter()
        .filter(|a| a.private && !hash_private)
        .map(|a| a.name.as_str())
        .collect();
    let mut listed = BTreeMap::new();
    let mut list = |key: String, v: &Value| -> Result<(), CanonError> {
        listed.insert(key, d1(v)?);
        Ok(())
    };
    let public = |names: &[String]| -> Vec<String> {
        sorted(
            &names
                .iter()
                .filter(|n| !private.contains(n.as_str()))
                .cloned()
                .collect::<Vec<_>>(),
        )
    };
    let mut kinds: Vec<Value> = r
        .kinds
        .iter()
        .map(|k| {
            json!({
                "draws_as": k.draws_as,
                "migrations": k.entry.migrations.iter().map(|m| {
                    let mut step = json!({
                        "from": m.from,
                        "renames": m.renames.iter().map(|r| json!({"from": r.from, "to": r.to})).collect::<Vec<_>>(),
                        "to": m.to,
                    });
                    // A retirement record is a shape too; a migration without one hashes as before.
                    if !m.retires.is_empty() {
                        step["retires"] = json!(m.retires);
                    }
                    step
                }).collect::<Vec<_>>(),
                "name": k.entry.full_name(),
                "needs": public(&k.needs),
                "versions": k.entry.versions.iter().map(|v| {
                    json!({
                        "major": v.major,
                        "minor": v.minor,
                        "params": v.params.iter().map(|p| json!({
                            "default": p.default,
                            "max": p.max.map(|x| x.to_string()),
                            "min": p.min.map(|x| x.to_string()),
                            "minor": p.minor, "module": p.module, "name": p.name,
                            "type": format!("{:?}", p.ty), "unit": p.unit,
                        })).collect::<Vec<_>>(),
                    })
                }).collect::<Vec<_>>(),
            })
        })
        .collect();
    sort_values(&mut kinds)?;
    let mut arrays: Vec<Value> = r
        .arrays
        .iter()
        .filter(|a| !private.contains(a.name.as_str()))
        .map(|a| json!({"class": a.class, "contributes_to": a.contributes_to, "domain": a.domain, "name": a.name, "phase": a.phase, "type": a.ty}))
        .collect();
    sort_values(&mut arrays)?;
    let mut tables: Vec<Value> = r
        .tables
        .iter()
        .map(|t| json!({"build": t.build, "name": t.name, "reads": public(&t.reads)}))
        .collect();
    sort_values(&mut tables)?;
    let mut carried: Vec<Value> = r
        .carried
        .iter()
        .map(|c| json!({"bytes": c.bytes, "key": c.key, "kind": c.kind}))
        .collect();
    sort_values(&mut carried)?;
    let mut checks: Vec<Value> = r
        .checks
        .iter()
        // Its run is behaviour, not interface: the digest pins the kind and what it can emit.
        .map(|c| {
            let mut v = json!({"codes": c.codes, "kind": c.kind, "machines": c.machines});
            if !c.reads.is_empty() {
                v["reads"] = json!(c.reads);
            }
            if let Some((draws, _)) = c.frames {
                v["frames"] = json!(draws);
            }
            v
        })
        .collect();
    sort_values(&mut checks)?;
    let mut tools: Vec<Value> = r
        .tool_entries
        .iter()
        .map(|t| json!({"entry": t.entry, "tool": t.tool}))
        .collect();
    sort_values(&mut tools)?;
    for (what, list_of, keys) in [
        ("kind", &kinds, &["name"][..]),
        ("array", &arrays, &["name"]),
        ("table", &tables, &["name"]),
        ("carried", &carried, &["kind", "key"]),
        ("check", &checks, &["kind"]),
        ("tool_entry", &tools, &["tool", "entry"]),
    ] {
        for v in list_of {
            let name: Vec<String> = keys
                .iter()
                .map(|k| v[*k].to_string().trim_matches('"').to_string())
                .collect();
            list(format!("{what} {}", name.join(" ")), v)?;
        }
    }
    let mut whole = json!({
        "arrays": arrays,
        "carried": carried,
        "checks": checks,
        "kinds": kinds,
        "tables": tables,
        "tool_entries": tools,
    });
    // A removal is a shape too; a module with none keeps the digest it had.
    if !r.removed.is_empty() {
        whole["removed"] = r
            .removed
            .iter()
            .map(|x| json!({"kind": x.kind, "to": x.migration.as_ref().map(|m| &m.0)}))
            .collect();
    }
    // The registries it declares and the entries it fills at the seal (#200), only when it has
    // any, so a module with none keeps the digest it had.
    if let Some(l) = lists {
        for r in l["registries"].as_array().into_iter().flatten() {
            list(
                format!("registry {}", r["name"].as_str().unwrap_or_default()),
                r,
            )?;
        }
        for e in l["entries"].as_array().into_iter().flatten() {
            list(
                format!(
                    "entry {} {}",
                    e["registry"].as_str().unwrap_or_default(),
                    e["name"].as_str().unwrap_or_default()
                ),
                e,
            )?;
        }
        whole["registries"] = l.clone();
    }
    let digest = d1(&whole)?;
    Ok((digest, listed))
}
