//! A logic item's linked libraries (canvas primitives: Logic: linked libraries; #190): the
//! libraries its `links` reach through their packs' `needs`, each carried by an installed pack
//! under its name@version and hash, in dependency order, merged into its program by sandbox@1's
//! pinned linker before the subset check and the rewrite.

use std::collections::{BTreeMap, BTreeSet};

use deep_canvas_sandbox::link::{self, Object};
use deep_canvas_sandbox::rewrite::hash;
use serde_json::{json, Value};

use crate::Planted;

/// The most libraries an item may reach.
pub const MAX_LIBS: usize = 16;

/// A library a pack carries.
#[derive(Clone, Debug)]
pub struct Entry {
    pub asset: String,
    /// The functions a program may import from it.
    pub exports: Vec<String>,
    pub fixtures: Vec<String>,
    pub needs: Vec<(String, String)>,
}

/// A pack installed in the document's store, as its version names its libraries.
#[derive(Clone, Debug)]
pub struct Pack {
    /// `<name>@<version>`.
    pub id: String,
    /// The working agent wrote it: its libraries bind only the agent's own claims.
    pub agent: bool,
    pub libs: BTreeMap<String, Entry>,
}

fn pairs(v: Option<&Value>) -> Option<Vec<(String, String)>> {
    v.map_or(Some(Vec::new()), |v| {
        v.as_array()?
            .iter()
            .map(|l| {
                Some((
                    l.get("name")?.as_str()?.to_string(),
                    l.get("asset")?.as_str()?.to_string(),
                ))
            })
            .collect()
    })
}

impl Pack {
    pub fn parse(v: &Value) -> Option<Pack> {
        let mut libs = BTreeMap::new();
        for (name, e) in v
            .get("libs")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            let fixtures = e.get("fixtures").map_or(Some(Vec::new()), |f| {
                f.as_array()?
                    .iter()
                    .map(|x| x.as_str().map(str::to_string))
                    .collect()
            })?;
            libs.insert(
                name.clone(),
                Entry {
                    asset: e.get("asset")?.as_str()?.into(),
                    exports: e
                        .get("exports")?
                        .as_array()?
                        .iter()
                        .map(|x| x.as_str().map(str::to_string))
                        .collect::<Option<_>>()?,
                    fixtures,
                    needs: pairs(e.get("needs"))?,
                },
            );
        }
        Some(Pack {
            id: format!(
                "{}@{}",
                v.get("name")?.as_str()?,
                v.get("version")?.as_str()?
            ),
            agent: v.get("origin").and_then(Value::as_str) == Some("agent"),
            libs,
        })
    }
}

/// The piece's packs; None when one isn't a pack.
pub fn packs(piece: &Value) -> Option<Vec<Pack>> {
    piece.get("packs").map_or(Some(Vec::new()), |p| {
        p.as_array()?.iter().map(Pack::parse).collect()
    })
}

/// An item's links as declared: `(name@version, asset)`.
pub fn declared(v: Option<&Value>) -> Option<Vec<(String, String)>> {
    pairs(v)
}

/// A library the item links, in link order.
#[derive(Clone, Debug)]
pub struct Lib {
    pub label: String,
    pub hash: String,
    pub pack: String,
    pub agent: bool,
    pub fixtures: Vec<String>,
    pub exports: Vec<String>,
    pub bytes: Vec<u8>,
}

impl Lib {
    pub fn name(&self) -> &str {
        self.label.split_once('@').map_or(&self.label, |(n, _)| n)
    }
}

fn refusal(rule: &str, what: String, extra: Value) -> Value {
    let mut out = json!({"rule": rule, "what": what});
    if let (Some(o), Value::Object(e)) = (out.as_object_mut(), extra) {
        o.extend(e);
    }
    out
}

/// The pack that carries `label`: an installed one that carries these bytes first, so its fixtures
/// count for every claim.
fn carrier<'a>(packs: &'a [Pack], label: &str, sha: &str) -> Option<(&'a Pack, &'a Entry)> {
    let carrying = || {
        packs
            .iter()
            .filter_map(|p| p.libs.get(label).map(|e| (p, e)))
    };
    carrying()
        .filter(|(_, e)| e.asset == sha)
        .min_by_key(|(p, _)| p.agent)
        .or_else(|| carrying().next())
}

/// `label` at `sha` and every library its needs reach through `packs`, as sorted `label sha`
/// lines: what its fixtures' items link, whichever packs carry them.
pub fn reach(label: &str, sha: &str, packs: &[Pack]) -> Vec<String> {
    let mut seen = Vec::new();
    let mut todo = vec![(label.to_string(), sha.to_string())];
    while let Some((label, sha)) = todo.pop() {
        let line = format!("{label} {sha}");
        if seen.contains(&line) {
            continue;
        }
        if let Some((_, e)) = carrier(packs, &label, &sha).filter(|(_, e)| e.asset == sha) {
            todo.extend(e.needs.iter().cloned());
        }
        seen.push(line);
    }
    seen.sort();
    seen
}

/// The libraries `links` reach, each checked against its bytes (as `stored` reads them) and its
/// pack, in dependency order (ties by name), or every refusal.
pub fn resolve(
    links: &[(String, String)],
    packs: &[Pack],
    stored: &dyn Fn(&str) -> Option<Vec<u8>>,
    planted: &Planted,
) -> Result<Vec<Lib>, Vec<Value>> {
    let mut refused = Vec::new();
    let mut found: BTreeMap<String, Lib> = BTreeMap::new();
    let mut needs: BTreeMap<String, Vec<String>> = BTreeMap::new();
    // Listing order, each one's needs after it: what the planted linker links in.
    let mut listed: Vec<String> = Vec::new();
    let mut todo: Vec<(String, String)> = links.iter().rev().cloned().collect();
    while let Some((label, sha)) = todo.pop() {
        if let Some(l) = found.get(&label) {
            // One name@version reached twice must name one library.
            if l.hash != sha {
                refused.push(refusal(
                    "link",
                    format!("pack {} maps {label} to {}, not {sha}", l.pack, l.hash),
                    json!({"link": label, "asset": sha, "pack": l.pack}),
                ));
            }
            continue;
        }
        if refused.iter().any(|r: &Value| r["link"] == json!(label)) {
            continue;
        }
        let Some(bytes) = stored(&sha) else {
            refused.push(refusal(
                "link",
                format!("the piece carries no library {label} at {sha}"),
                json!({"link": label, "asset": sha}),
            ));
            continue;
        };
        let actual = hash(&bytes);
        if actual != sha {
            refused.push(refusal(
                "link",
                format!("{label}'s bytes hash to {actual}, not its link's {sha}"),
                json!({"link": label, "asset": sha, "actual": actual}),
            ));
            continue;
        }
        let Some((pack, entry)) = carrier(packs, &label, &sha) else {
            refused.push(refusal(
                "link",
                format!("no installed pack carries {label}"),
                json!({"link": label, "asset": sha}),
            ));
            continue;
        };
        if entry.asset != sha {
            refused.push(refusal(
                "link",
                format!(
                    "pack {} maps {label} to {}, not {sha}",
                    pack.id, entry.asset
                ),
                json!({"link": label, "asset": sha, "pack": pack.id}),
            ));
            continue;
        }
        listed.push(label.clone());
        needs.insert(
            label.clone(),
            entry.needs.iter().map(|n| n.0.clone()).collect(),
        );
        todo.extend(entry.needs.iter().rev().cloned());
        found.insert(
            label.clone(),
            Lib {
                label,
                hash: sha,
                pack: pack.id.clone(),
                agent: pack.agent,
                fixtures: entry.fixtures.clone(),
                exports: entry.exports.clone(),
                bytes,
            },
        );
    }
    if !refused.is_empty() {
        return Err(refused);
    }
    let mut by_name: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for l in found.values() {
        by_name.entry(l.name()).or_default().push(&l.label);
    }
    for versions in by_name.values().filter(|v| v.len() > 1) {
        refused.push(refusal(
            "versions",
            format!(
                "the libraries reached hold {}: one library links in one version",
                versions.join(" and ")
            ),
            json!({"versions": versions}),
        ));
    }
    if found.len() > MAX_LIBS {
        refused.push(refusal(
            "libraries",
            format!(
                "the item reaches {} libraries, past {MAX_LIBS}",
                found.len()
            ),
            json!({}),
        ));
    }
    // Dependency order: each library once every library it needs is placed, ties by name.
    let mut order: Vec<String> = Vec::new();
    let mut left: BTreeSet<String> = found.keys().cloned().collect();
    while !left.is_empty() {
        let next = left
            .iter()
            .find(|l| needs[*l].iter().all(|n| order.contains(n)))
            .cloned();
        match next {
            Some(l) => {
                left.remove(&l);
                order.push(l);
            }
            None => {
                let cycle = cycle(&left, &needs);
                refused.push(refusal(
                    "cycle",
                    format!("the needs of {} form a cycle", cycle.join(", ")),
                    json!({"cycle": cycle}),
                ));
                break;
            }
        }
    }
    if !refused.is_empty() {
        return Err(refused);
    }
    if planted.linker_links_in_listing_order {
        order = listed;
    }
    Ok(order
        .into_iter()
        .map(|l| found.remove(&l).expect("a found library"))
        .collect())
}

/// A cycle among the libraries no order could place, from the first by name.
fn cycle(left: &BTreeSet<String>, needs: &BTreeMap<String, Vec<String>>) -> Vec<String> {
    let mut path: Vec<String> = Vec::new();
    let mut at = left.iter().next().cloned().unwrap_or_default();
    while !path.contains(&at) {
        path.push(at.clone());
        match needs[&at].iter().find(|n| left.contains(*n)) {
            Some(n) => at = n.clone(),
            None => break,
        }
    }
    let from = path.iter().position(|p| *p == at).unwrap_or(0);
    path.split_off(from)
}

/// For each library function of a merged program, its index with its library's label and hash and
/// its name.
pub type Functions = BTreeMap<u32, (String, String, String)>;

/// The program merged with its libraries, in their order: the bytes the subset check sees, its
/// library functions and the memory the libraries' data takes.
pub type Merged = (Vec<u8>, Functions, Option<(u32, u32)>);

pub fn merge(program: &[u8], libs: &[Lib], planted: &Planted) -> Result<Merged, Vec<Value>> {
    let objects: Vec<Object> = libs
        .iter()
        .map(|l| Object {
            name: l.name(),
            label: &l.label,
            bytes: &l.bytes,
            exports: &l.exports,
        })
        .collect();
    let linked = link::link(program, &objects, planted.pack_check_skips_library_subset)
        .map_err(|r| r.iter().map(|r| r.to_json()).collect::<Vec<_>>())?;
    let functions = linked
        .functions
        .into_iter()
        .map(|(i, (label, name))| {
            let hash = libs
                .iter()
                .find(|l| l.label == label)
                .map(|l| l.hash.clone())
                .unwrap_or_default();
            (i, (label, hash, name))
        })
        .collect();
    Ok((linked.bytes, functions, linked.data))
}

/// What the planted linker adds to every program: an empty `linking` custom section.
pub fn empty_linking(mut bytes: Vec<u8>) -> Vec<u8> {
    bytes.extend([0, 8, 7]);
    bytes.extend(b"linking");
    bytes
}
