//! The pack store (#306; canvas primitives: Pack): each pack the scenario or an `install_pack`
//! call offers is read from its folder (`pack.json` with each recipe file it names inlined),
//! put through the pack check once, and admitted or refused. The store keeps one row per
//! offer, with how many times that version's check ran, so a test reads "once per version,
//! never on open" as a count the binary kept, not its word.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use deep_canvas::document::packs::Resolved;
use deep_canvas::document::{CheckResult, Expansion, Issue, Pack, PackPlanted, Packs};
use deep_canvas::registry::Sealed;
use serde_json::{json, Map, Value};

pub mod checked;

/// One pack version offered to the store.
pub struct Row {
    pub pack: String,
    pub version: String,
    pub state: &'static str,
    pub issues: Vec<Value>,
    /// Each layout, as its validator judged its twins at the pack check (#238).
    pub layouts: Vec<Value>,
}

/// One offer of a pack version to the store: its folder, the twin a scenario plants, the
/// evidence store, and the store's kept check results where the hub named them (#3611).
pub struct Offer<'o> {
    pub id: &'o str,
    pub dir: &'o Path,
    pub twin: Option<&'o str>,
    pub evidence: &'o Path,
    pub kept: Option<&'o checked::Store>,
}

/// Reads a pack folder as one manifest: `pack.json`, its `id` set to `owner/name`, and each
/// `recipes` entry's file inlined.
pub(crate) fn load(id: &str, dir: &Path) -> Result<Value, Vec<Issue>> {
    deep_canvas::document::packs::manifest_of(id, &|file| {
        fs::read(dir.join(file)).map_err(|e| e.to_string())
    })
}

thread_local! {
    /// Each version this process admitted, by its ID and folder, with its manifest (#1720): the
    /// canvas side builds its store afresh for every call, and a version's check runs once, not on
    /// each. The hub stages a pack in a folder named by its digest, so a folder never changes.
    static ADMITTED: RefCell<HashMap<(String, PathBuf), (Value, Pack)>> = RefCell::new(HashMap::new());
    /// The logic module's check of each version's libraries and interfaces, by its manifest's hash
    /// (#3044): it compiles and runs every fixture, seconds a pack, which each call paid again.
    static LIB_CHECKS: RefCell<HashMap<String, Value>> = RefCell::new(HashMap::new());
}

/// The logic module's check of the pack version whose manifest hashes to `version`: `check` runs
/// once a process, as the rest of the version's check does (#3044).
pub fn lib_check(version: &str, check: impl FnOnce() -> Value) -> Value {
    if let Some(reply) = lib_kept(version) {
        return reply;
    }
    let reply = check();
    lib_take(version, reply.clone());
    reply
}

/// The logic module's reply this process holds for `version`, which a kept check result keeps
/// (#3611).
pub fn lib_kept(version: &str) -> Option<Value> {
    LIB_CHECKS.with(|c| c.borrow().get(version).cloned())
}

/// Holds the logic module's reply for `version`, as its check left it.
pub fn lib_take(version: &str, reply: Value) {
    LIB_CHECKS.with(|c| c.borrow_mut().insert(version.to_string(), reply));
}

/// #1958: the store's sweep deleted `owner/name@version`: this process holds it no more.
pub fn forget(key: &str) {
    ADMITTED.with(|a| {
        a.borrow_mut().retain(|_, (m, _)| {
            format!(
                "{}@{}",
                m["id"].as_str().unwrap_or_default(),
                m["version"].as_str().unwrap_or_default()
            ) != key
        })
    });
}

/// #154: an admitted pack's manifest by its reference, `owner/name@version` or `name@version`, as
/// a score's sampled instrument names its library.
pub fn manifest_of(reference: &str) -> Option<Value> {
    let (id, version) = reference.rsplit_once('@')?;
    ADMITTED.with(|a| {
        let admitted = a.borrow();
        let mut found: Vec<&Value> = admitted
            .values()
            .map(|(m, _)| m)
            .filter(|m| m["version"].as_str() == Some(version))
            .filter(|m| {
                m["id"]
                    .as_str()
                    .is_some_and(|i| i == id || i.rsplit_once('/').is_some_and(|(_, n)| n == id))
            })
            .collect();
        found.sort_by_key(|m| m["id"].as_str().map(str::to_string));
        found.first().map(|m| (*m).clone())
    })
}

/// Installs one pack version: the folder read, the pack check run once, the store's row kept.
/// The reply is `install_pack`'s.
///
/// #3611: where the hub named its store of kept check results, a version this process hasn't
/// admitted is taken from its row when this core may take it, and no part of its check runs;
/// any other row runs the check, whose result replaces it.
pub fn install(
    packs: &mut Packs,
    rows: &mut Vec<Row>,
    sealed: &Sealed,
    host: &mut crate::sandbox::Host,
    offer: Offer<'_>,
) -> Value {
    // #161: the pack check's wall time, from reading the folder to its verdict.
    let started = std::time::Instant::now();
    let before = checked::reading(packs, host);
    let Offer {
        id,
        dir,
        twin,
        evidence,
        kept,
    } = offer;
    let mut layouts = Vec::new();
    let key = (id.to_string(), dir.to_path_buf());
    let known = twin
        .is_none()
        .then(|| ADMITTED.with(|a| a.borrow().get(&key).cloned()))
        .flatten();
    let loaded = match known {
        Some((manifest, pack)) => Ok((manifest, Some(pack))),
        None => load(id, dir).map(|manifest| (manifest, None)),
    };
    let as_json = |issues: &[Issue]| issues.iter().map(Issue::to_json).collect::<Vec<Value>>();
    let (version, outcome, issues) = match loaded {
        Err(issues) => (String::new(), "refused", as_json(&issues)),
        Ok((mut manifest, known)) => {
            if let Some(planted) = twin {
                crate::familiar::twin(planted, id, &mut manifest);
                crate::math_twins::twin(planted, id, &mut manifest);
            }
            let version = manifest["version"].as_str().unwrap_or_default().to_string();
            // A row names one version's bytes beside the versions it requires. A twin, a version
            // the store already holds (a republish is refused for what the store holds) and one
            // with a provider (run against the layouts of the packs beside it) keep none.
            let held = packs.get(&format!("{id}@{version}")).is_some();
            let row = kept
                .filter(|_| twin.is_none() && known.is_none() && !held)
                .filter(|_| manifest.get("providers").is_none())
                .map(|store| store.bound(&manifest, packs));
            let taken = row.as_ref().and_then(|row| row.read(evidence));
            let taken = taken.and_then(|found| match found.refused {
                true => {
                    packs.refuse_kept(&format!("{id}@{version}"), &found.issues);
                    host.refuse_kept(&format!("{id}@{version}"), &found.left["programs"]);
                    Some((None, found))
                }
                false => {
                    // A planted core's row may hold nothing a check left, or what another
                    // digest's check left: its verdict stands with nothing admitted.
                    let core = (found.left.get("core"))
                        .and_then(|left| packs.admit_kept(&manifest, sealed, left).cloned());
                    let pack = core.and_then(|pack| {
                        if host.take(&manifest, &pack, sealed, &found.left["programs"]) {
                            return Some(pack);
                        }
                        packs.withdraw(&pack.id.text());
                        None
                    });
                    (pack.is_some() || found.forced).then_some((pack, found))
                }
            });
            let (outcome, issues) = match taken {
                Some((pack, found)) => {
                    layouts = found.layouts;
                    if let Some(pack) = pack {
                        ADMITTED.with(|a| a.borrow_mut().insert(key, (manifest, pack)));
                    }
                    (
                        if found.refused {
                            "refused"
                        } else {
                            "installed"
                        },
                        found.issues,
                    )
                }
                None => {
                    let admitted = match known {
                        Some(pack) => Ok(packs.readmit(pack).clone()),
                        None => packs.admit(&manifest, sealed).cloned(),
                    };
                    let (left, issues) = match admitted {
                        Ok(pack) => {
                            let (rows, mut issues) = host.vet(&manifest, &pack, sealed);
                            issues.extend(kind_meshes(&pack, sealed, evidence));
                            layouts = rows;
                            let ours = pack.id.text();
                            if issues.is_empty() {
                                let programs = host.left(&manifest, &pack);
                                let left =
                                    programs.map(|p| json!({"core": pack.left(), "programs": p}));
                                if twin.is_none() {
                                    ADMITTED.with(|a| a.borrow_mut().insert(key, (manifest, pack)));
                                }
                                (left, issues)
                            } else {
                                packs.withdraw(&ours);
                                (Some(json!({"programs": host.refusal(&ours)})), issues)
                            }
                        }
                        Err(issues) => (Some(json!({"programs": null})), issues),
                    };
                    let issues = as_json(&issues);
                    if let (Some(row), Some(left)) = (&row, &left) {
                        row.write(!issues.is_empty(), &issues, &layouts, left);
                    }
                    (
                        if issues.is_empty() {
                            "installed"
                        } else {
                            "refused"
                        },
                        issues,
                    )
                }
            };
            (version, outcome, issues)
        }
    };
    checked::ran(before, checked::reading(packs, host));
    let check_ms = started.elapsed().as_secs_f64() * 1e3;
    // One row per version: a refused republish leaves the row of the version first published,
    // and a version offered again after a refusal takes its row once admitted.
    match rows
        .iter_mut()
        .find(|r| r.pack == id && r.version == version)
    {
        Some(row) => {
            // #1958: a retired version offered again is installed again.
            if matches!(row.state, "refused" | "retired") && outcome == "installed" {
                packs.reinstate(&format!("{id}@{version}"));
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
    json!({"outcome": outcome, "pack": id, "version": version, "issues": issues, "layouts": layouts, "check_ms": check_ms})
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
    json!({"packs": list, "counts": checked::counts()})
}

/// `expansions` on a reply: one row per recipe instance, sorted by instance; `timing` when the
/// call asked for it.
pub fn reply(
    expansions: &[Expansion],
    check_ms: Option<(f64, Option<Map<String, Value>>)>,
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
        if let Some((ms, packs)) = check_ms {
            let mut t = Map::new();
            t.insert("check_ms".into(), json!(ms));
            t.extend(packs.unwrap_or_default());
            reply.insert("timing".into(), Value::Object(t));
        }
    }
}

/// The document as it draws: each recipe instance replaced by the derived items its expansion
/// made, which draw in its place, and each cue list by what it expanded to; everything else as
/// the writer sent it.
pub fn drawn(doc: &Value, expansions: &[Expansion]) -> Value {
    deep_canvas::document::expands::drawn(doc, expansions)
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
            .map(|b| {
                let mut v = json!({"batch": b.key, "items": b.items});
                if let Some(n) = b.instances {
                    v["instances"] = json!(n);
                }
                v
            })
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

/// The pack timings of a checked revision, each part run again and timed here, since the core
/// reads no clock: `kind_rules_ms` (#202), and `resolve_ms` and `migrate_ms` (#1958), resolving
/// the document's pack graph and applying pack kinds' data migrations to its items at load; and
/// `cut_ms` (#1518), placing and expanding the document's cuts again, the recording's decode,
/// which the check made and the reader keeps, left out.
pub fn timings(
    doc: &Value,
    checked: &CheckResult,
    sealed: &Sealed,
    packs: &Packs,
) -> Map<String, Value> {
    let mut ignored = Vec::new();
    let started = std::time::Instant::now();
    let resolved = deep_canvas::document::packs::resolve(doc, packs, Some(sealed), &mut ignored);
    let resolve_ms = started.elapsed().as_secs_f64() * 1000.0;
    let mut items = doc["items"].as_object().cloned().unwrap_or_default();
    let started = std::time::Instant::now();
    deep_canvas::document::pack_kinds::at_load(
        &mut items,
        &resolved,
        packs.planted,
        &mut Vec::new(),
    );
    let migrate_ms = started.elapsed().as_secs_f64() * 1000.0;
    let mut out = Map::new();
    out.insert(
        "kind_rules_ms".into(),
        json!(kind_rules_ms(doc, checked, &resolved, (packs, sealed))),
    );
    out.insert("resolve_ms".into(), json!(resolve_ms));
    out.insert("migrate_ms".into(), json!(migrate_ms));
    let reads = packs.reads.as_ref().map(|r| r.0.as_ref());
    let started = std::time::Instant::now();
    for (id, item) in items.iter().filter(|(_, i)| i["kind"] == "cut.words@1") {
        let _ = deep_canvas_media::cut::lower(doc, id, item, reads);
    }
    out.insert(
        "cut_ms".into(),
        json!(started.elapsed().as_secs_f64() * 1000.0),
    );
    // #222: each cue list's expansion at check, the expander's own time.
    let entries = deep_canvas::document::expands::Entries::new(sealed, &resolved);
    let verbs = |n: &str| {
        entries
            .get(deep_canvas_motion::cues::REGISTRY, n)
            .map(|(v, _)| v.clone())
    };
    let lists: Map<String, Value> = items
        .iter()
        .filter(|(_, item)| item.get("kind").and_then(Value::as_str) == Some("cues@1"))
        .map(|(id, item)| {
            let started = std::time::Instant::now();
            let _ = deep_canvas_motion::cues::lower(
                doc,
                &items,
                id,
                item,
                &verbs,
                packs.planted.expander,
            );
            (id.clone(), json!(started.elapsed().as_secs_f64() * 1000.0))
        })
        .collect();
    // #142: each film recipe instance's whole expansion, its cue lists' lowering included.
    let mut lists = lists;
    for (id, item) in &items {
        let Some(kind) = item.get("kind").and_then(Value::as_str) else {
            continue;
        };
        if resolved.recipe(kind).is_none() {
            continue;
        }
        let started = std::time::Instant::now();
        let mut one = Map::new();
        one.insert(id.clone(), item.clone());
        let mut issues = Vec::new();
        let _ =
            deep_canvas::document::packs::expand(&mut one, &resolved, packs.planted, &mut issues);
        for (d, derived) in &one {
            if derived.get("kind").and_then(Value::as_str) == Some("cues@1") {
                let _ = deep_canvas_motion::cues::lower(
                    doc,
                    &one,
                    d,
                    derived,
                    &verbs,
                    packs.planted.expander,
                );
            }
        }
        lists.insert(id.clone(), json!(started.elapsed().as_secs_f64() * 1000.0));
    }
    if !lists.is_empty() {
        out.insert("expand_ms".into(), Value::Object(lists));
    }
    out
}

/// `timing.kind_rules_ms` (#202): the core's `kind_rules` check over a checked revision, run
/// again on its lowered items.
fn kind_rules_ms(
    doc: &Value,
    checked: &CheckResult,
    resolved: &Resolved,
    (packs, sealed): (&Packs, &Sealed),
) -> f64 {
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
        resolved,
        packs.planted,
        sealed,
    );
    let ms = started.elapsed().as_secs_f64() * 1000.0;
    std::hint::black_box(run);
    ms
}

/// #1961: your notes the scenario gives, each `{note, doc, item, …}` (Note).
pub fn notes(list: Option<&Value>) -> Option<Vec<Value>> {
    let Some(list) = list else {
        return Some(Vec::new());
    };
    list.as_array()?
        .iter()
        .map(|n| {
            for field in ["note", "doc", "item"] {
                n.get(field)?.as_str()?;
            }
            Some(n.clone())
        })
        .collect()
}

/// #1857's wrong programs of the expansion, by the names its acceptance suite gives them: a
/// count that refuses nothing until everything is expanded, and a nested recipe step that copies
/// the document's items for each nested instance.
pub const PLANTED: [&str; 2] = ["expansion_counts_after", "expansion_copies_items"];

/// The expansion's and the pack check's wrong programs the scenario plants.
pub(crate) fn planted(scenario: &crate::hub::Scenario) -> PackPlanted {
    use crate::hub::Planted;
    let module = scenario.module_planted.as_deref();
    PackPlanted {
        seed_by_order: scenario.planted == Some(Planted::SeedsByExpansionOrder),
        drops_stroke: scenario.planted == Some(Planted::ExpansionDropsStroke),
        overwrite_broken_out: scenario.planted == Some(Planted::ReexpansionOverwritesBrokenOut),
        skip_requires_modules: scenario.planted == Some(Planted::PackCheckSkipsRequiresModules),
        key_by_name: matches!(
            scenario.planted,
            Some(Planted::PacksKeyedByName | Planted::LoaderDrawsMissingWithInstalled)
        ),
        each_by_count: scenario.planted == Some(Planted::EachSeedsByElementCount),
        each_per_triangle: scenario.planted == Some(Planted::EachFacePerTriangle),
        orphan_drops: scenario.planted == Some(Planted::OrphanLoadDropsBrokenOut),
        orphan_hands_id: scenario.planted == Some(Planted::OrphanLoadHandsIdToExpansion),
        rules_twice: scenario.planted == Some(Planted::RulesEvaluatedTwice),
        kit_defaults_only: scenario.planted == Some(Planted::KitDefaultsOnly),
        migration_first_fault: scenario.planted == Some(Planted::MigrationFirstFault),
        migrate_one_major: scenario.planted == Some(Planted::MigrationOneMajor),
        migrate_zero_as_absent: scenario.planted == Some(Planted::MigrationZeroAsLeftOut),
        migrate_params_only: matches!(
            scenario.planted,
            Some(Planted::MigrationRenamesParamsOnly | Planted::MoveRewritesKindOnly)
        ),
        migrate_channels_only: scenario.planted
            == Some(Planted::MigrationRewritesChannelTargetsOnly),
        drops_moved: scenario.planted == Some(Planted::LoaderDropsMovedInstances),
        walk_inputs: (scenario.planted == Some(Planted::ExpandsInHashOrder))
            .then_some(walk_in_hash_order as deep_canvas::document::packs::WalkInputs),
        // #222: the planted cue-list expander.
        expander: scenario
            .module_planted
            .as_deref()
            .filter(|p| deep_canvas_motion::cues::planted(p))
            .map(|p| &*Box::leak(p.to_string().into_boxed_str())),
        counts_after_expanding: module == Some(PLANTED[0]),
        copies_items_per_nested: module == Some(PLANTED[1]),
    }
}

/// #202's planted expander: an instance's inputs walked through a std hash map, whose order a
/// fresh random state picks, so two expansions of one example differ in their bytes. It redraws
/// until the order differs from the previous walk's, which three inputs would match by chance.
fn walk_in_hash_order(inputs: serde_json::Map<String, Value>) -> serde_json::Map<String, Value> {
    thread_local! {
        static LAST: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
    }
    let last = LAST.with(|l| l.borrow().clone());
    for _ in 0..64 {
        let walked: std::collections::HashMap<String, Value> = inputs.clone().into_iter().collect();
        let order: Vec<String> = walked.keys().cloned().collect();
        if order != last || inputs.len() < 2 {
            LAST.with(|l| *l.borrow_mut() = order);
            return walked.into_iter().collect();
        }
    }
    inputs
}

/// The planted cache (#1961): each expansion of `doc`'s instances kept by the instance's kind
/// and inputs, without its recipe's version, and served again for an equal kind and inputs.
pub fn planted_cache(
    planted: Option<crate::hub::Planted>,
    cache: &mut BTreeMap<String, Expansion>,
    doc: &Value,
    mut expansions: Vec<Expansion>,
) -> Vec<Expansion> {
    if planted != Some(crate::hub::Planted::ExpansionCacheWithoutRecipeVersion) {
        return expansions;
    }
    for e in &mut expansions {
        let key = format!("{}|{}", e.kind, doc["items"][&e.instance]["params"]);
        match cache.get(&key) {
            Some(kept) => *e = kept.clone(),
            None => {
                cache.insert(key, e.clone());
            }
        }
    }
    expansions
}

/// What a `derived_orphan` names besides the item (#1961).
impl crate::hub::Hub<'_> {
    /// #1961: your notes on item `id` of `doc`, by their ULIDs.
    pub fn notes_on(&self, doc: &str, id: &str) -> Vec<Value> {
        self.scenario
            .notes
            .iter()
            .filter(|n| {
                n["doc"]
                    .as_str()
                    .is_some_and(|d| d.eq_ignore_ascii_case(doc))
            })
            .filter(|n| n["item"] == id)
            .map(|n| n["note"].clone())
            .collect()
    }

    /// #1961: each handle `doc:<doc>#<id>` an item of an open shared document holds in its
    /// params, as `{doc, item, handle}`.
    pub fn handles_to(&self, doc: &str, id: &str) -> Vec<Value> {
        let names = |text: &str| {
            deep_canvas::grammar::Handle::parse(text).is_ok_and(|h| {
                h.scheme() == deep_canvas::grammar::Scheme::Doc
                    && h.id().as_str().eq_ignore_ascii_case(doc)
                    && h.fragment() == Some(id)
            })
        };
        fn walk<'v>(v: &'v Value, out: &mut Vec<&'v str>) {
            match v {
                Value::String(s) => out.push(s),
                Value::Array(list) => list.iter().for_each(|x| walk(x, out)),
                Value::Object(map) => map.values().for_each(|x| walk(x, out)),
                _ => {}
            }
        }
        let mut out = Vec::new();
        for (holder, shared) in &self.shared {
            for (item, fields) in shared.doc["items"].as_object().into_iter().flatten() {
                let mut strings = Vec::new();
                walk(&fields["params"], &mut strings);
                for handle in strings.into_iter().filter(|s| names(s)) {
                    out.push(json!({"doc": holder, "item": item, "handle": handle}));
                }
            }
        }
        out
    }
}
