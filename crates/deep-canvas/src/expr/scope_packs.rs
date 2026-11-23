//! A `Scope` read from packs: their tables and ease tables, each checked once.

use super::*;

impl Scope {
    /// The tables and ease@1 entries of `packs`, each `{name, tables?: {name: table}, entries?:
    /// {"ease@1": [{name, x, y, mode, overshoot}]}}` as a pinned pack's `pack.json` holds them,
    /// each checked once; the first broken one is refused, naming it.
    pub fn of_packs(packs: &[serde_json::Value]) -> Result<Scope, Box<PackRefusal>> {
        let mut out = Scope::default();
        for p in packs {
            let pack = p
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            if let Some(tables) = p.get("tables").and_then(serde_json::Value::as_object) {
                for (name, t) in tables {
                    let full = format!("{pack}.{name}");
                    let table = Table::parse(t).map_err(|refusal| {
                        Box::new(PackRefusal {
                            name: full.clone(),
                            refusal,
                        })
                    })?;
                    out.tables.insert(full, table);
                }
            }
            for e in p
                .pointer("/entries/ease@1")
                .and_then(serde_json::Value::as_array)
                .into_iter()
                .flatten()
            {
                let name = e
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("");
                let full = if name.contains('.') {
                    name.to_string()
                } else {
                    format!("{pack}.{name}")
                };
                let table = EaseTable::parse(e).map_err(|refusal| {
                    Box::new(PackRefusal {
                        name: full.clone(),
                        refusal,
                    })
                })?;
                out.eases.insert(full, table);
            }
        }
        Ok(out)
    }
}
