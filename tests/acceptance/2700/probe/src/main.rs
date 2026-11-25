//! The #2700 acceptance suite's probe (README: The probe). `acceptance-2700-probe <heap | equal
//! <seed> <patches> | data-row | as-given>` calls the canvas core through its public entry and
//! prints one JSON line of what it saw; it judges nothing, the node:test files do.
//!
//! Every recheck call here hands the document as `&mut doc` (#2700's Scope: "The recheck takes
//! the document by `&mut`"), which is also a valid argument where the function takes `&Value`, so
//! this file compiles on the merge base and on the change alike.
//!
//! The build is the core's own sealed set plus one test module, `acc2700`, registered as any
//! canvas module registers (`Registry::with`): a kind `acc2700.pic@1` whose params name an asset
//! (`asset`: an ID of the document's `assets`, or an asset's SHA-256) and a data row (`row`: a
//! name of the document's `data`), and a rule over its items that reads those two members of the
//! document it is handed. The rule panics when an item's `fuse` is `blow`.

use std::alloc::{GlobalAlloc, Layout, System};
use std::collections::{BTreeMap, BTreeSet};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

use deep_canvas::document::{
    apply_ops, check_in, recheck, recheck_with, Issue, Packs, Referrers, Writing,
};
use deep_canvas::kinds::{Entry, Param, ParamType, Version};
use deep_canvas::registry::{
    BuildSet, Implementation, Manifest, Module, Raised, Range, Registrar, Registry, Sealed, Semver,
};
use serde_json::{json, Map, Value};

// ---- The heap, counted: every byte asked of the allocator while `COUNTING` is on.

struct Counted;
static COUNTING: AtomicBool = AtomicBool::new(false);
static ASKED: AtomicU64 = AtomicU64::new(0);

unsafe impl GlobalAlloc for Counted {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ASKED.fetch_add(layout.size() as u64, Ordering::Relaxed);
        }
        System.alloc(layout)
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ASKED.fetch_add(layout.size() as u64, Ordering::Relaxed);
        }
        System.alloc_zeroed(layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        if COUNTING.load(Ordering::Relaxed) {
            ASKED.fetch_add(new_size.saturating_sub(layout.size()) as u64, Ordering::Relaxed);
        }
        System.realloc(ptr, layout, new_size)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static HEAP: Counted = Counted;

/// The bytes `work` asks of the allocator, and what it returns.
fn counted<T>(work: impl FnOnce() -> T) -> (u64, T) {
    ASKED.store(0, Ordering::SeqCst);
    COUNTING.store(true, Ordering::SeqCst);
    let out = work();
    COUNTING.store(false, Ordering::SeqCst);
    (ASKED.load(Ordering::SeqCst), out)
}

// ---- The build: the core's set and the test module.

/// Set by the rule just before it panics.
static BLEW: AtomicBool = AtomicBool::new(false);

fn param(name: &'static str, ty: ParamType, default: Value) -> Param {
    Param {
        name,
        ty,
        unit: "",
        default,
        min: None,
        max: None,
        minor: 0,
        module: "",
        operator: "",
    }
}

fn pic() -> Entry {
    Entry {
        family: "acc2700",
        name: "pic",
        versions: vec![Version {
            major: 1,
            minor: 0,
            params: vec![
                param("box", ParamType::Json("[x, y, w, h]"), json!([0, 0, 10, 10])),
                param("asset", ParamType::Str, json!("")),
                param("row", ParamType::Str, json!("")),
                param("fuse", ParamType::Str, json!("")),
                Param {
                    min: Some(0.0),
                    max: Some(100.0),
                    ..param("gain", ParamType::F32, json!(1))
                },
            ],
        }],
        migrations: vec![],
    }
}

/// Whether `value` is a number, bare or as `{value, source}` (Document envelope: `data`).
fn is_number(value: &Value) -> bool {
    value.is_number() || value.get("value").is_some_and(Value::is_number)
}

/// The module's check over one `acc2700.pic` item: the asset its `asset` names is one of the
/// document's (by ID or by SHA-256), and the row its `row` names is a number of the document's
/// `data`. It reads the item and those two members, nothing else.
fn pic_rule(doc: &Value, id: &str, item: &Value) -> Vec<Raised> {
    let mut out = Vec::new();
    let text = |name: &str| {
        item.get("params")
            .and_then(|p| p.get(name))
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
    };
    if text("fuse") == Some("blow") {
        BLEW.store(true, Ordering::SeqCst);
        panic!("acc2700.pic: the rule panics on a blown fuse, as the #2700 suite planted it");
    }
    if let Some(asset) = text("asset") {
        let assets = doc.get("assets").and_then(Value::as_object);
        let held = assets.is_some_and(|a| {
            a.contains_key(asset)
                || a.values()
                    .any(|e| e.get("sha256").and_then(Value::as_str) == Some(asset))
        });
        if !held {
            out.push(Raised {
                code: "ref_unresolved",
                severity: "error",
                path: format!("items/{id}/params/asset"),
                what: format!("`{asset}` is no asset of the document"),
                fix_ops: None,
            });
        }
    }
    if let Some(row) = text("row") {
        let found = doc.get("data").and_then(|d| d.get(row));
        if !found.is_some_and(is_number) {
            out.push(Raised {
                code: "ref_unresolved",
                severity: "error",
                path: format!("items/{id}/params/row"),
                what: format!("`{row}` is no number of the document's data"),
                fix_ops: None,
            });
        }
    }
    out
}

fn register(r: &mut Registrar) {
    r.kind(pic(), &[], "rect@1");
    r.rule("acc2700.pic", pic_rule);
}

fn sealed() -> Sealed {
    let version = Semver::parse("1.0.0").expect("a version");
    let module = Module {
        manifest: Manifest {
            name: "acc2700".into(),
            version: version.clone(),
            core: Range::parse("*").expect("a range"),
            depends_on: BTreeMap::new(),
            feature: "acc2700".into(),
            license: "Apache-2.0".into(),
            implements: "acc2700@1".into(),
            implementation: Implementation::reference("acc2700", version),
        },
        register,
    };
    match Registry::new(BuildSet::Core).with(module).seal() {
        Ok(sealed) => sealed,
        Err(e) => {
            println!("{}", json!({"blocked": format!("the core does not seal with the test module: {e:?}")}));
            std::process::exit(3);
        }
    }
}

// ---- Documents and patches.

fn writing() -> Writing<'static> {
    Writing {
        layer: "main",
        writer: "agent-a",
        you: false,
        base: None,
        knows: &|_| true,
        packs: None,
    }
}

const DOC: &str = "doc-2700";

fn envelope() -> Value {
    json!({
        "format": 1, "id": DOC, "profile": "figure", "title": "T", "description": "D",
        "size": [100, 100],
        "requires": {"modules": {"acc2700": "^1"}},
        "layers": {"main": {"writer": "agent-a", "title": "Main", "order": "a0"}},
        "items": {}
    })
}

fn slab(id: &str, width: i64, parent: Option<&str>) -> Value {
    let mut item = json!({"id": id, "kind": "test.slab@3", "layer": "main", "name": id,
                          "order": "a0", "params": {"width": width}});
    if let Some(p) = parent {
        item["parent"] = json!(p);
    }
    item
}

fn pic_item(id: &str, params: Value, parent: Option<&str>) -> Value {
    let mut item = json!({"id": id, "kind": "acc2700.pic@1", "layer": "main", "name": id,
                          "order": "a0", "params": params});
    if let Some(p) = parent {
        item["parent"] = json!(p);
    }
    item
}

fn patch_of(n: u64, ops: Vec<Value>) -> Value {
    json!({"patch": format!("01J9Z000000000{n:012}"), "doc": DOC, "base": 0, "reason": "#2700", "ops": ops})
}

/// An issue as the patch fuzzer's fifth law compares it: its code, IDs and path.
fn key(issue: &Issue) -> Value {
    json!({"code": issue.code, "ids": issue.ids, "path": issue.path})
}

fn keys(issues: &[Issue]) -> Vec<Value> {
    issues.iter().map(key).collect()
}

fn whole(doc: &Value, sealed: &Sealed) -> Vec<Issue> {
    check_in(doc, sealed).issues
}

fn item_ids(doc: &Value) -> Vec<String> {
    doc.get("items")
        .and_then(Value::as_object)
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default()
}

// ---- `heap`: one one-item patch, with 4 MiB of `data` and with none (#2700.9725b660).

const ROWS: usize = 64;
const ROW_BYTES: usize = 65_536;

fn heap_doc(with_data: bool) -> Value {
    let mut doc = envelope();
    for i in 0..100 {
        let id = format!("s{i:03}");
        doc["items"][&id] = slab(&id, 2, None);
    }
    if with_data {
        // 64 strings of 65,536 bytes: 4 MiB of text in one row, a `string[]` as the envelope has it.
        let rows: Vec<Value> = (0..ROWS)
            .map(|i| Value::String(char::from(b'a' + (i % 26) as u8).to_string().repeat(ROW_BYTES)))
            .collect();
        doc["data"] = json!({"blob": rows});
    }
    doc
}

fn heap_run(with_data: bool, indexed: bool, sealed: &Sealed) -> Value {
    let mut doc = heap_doc(with_data);
    let prev = whole(&doc, sealed);
    let referrers = Referrers::of(&doc);
    let packs = Packs::default();
    let patch = patch_of(1, vec![json!({"op": "set", "id": "s007", "path": "items/s007/params/width", "value": 3})]);
    let writing = writing();
    let (asked, out) = counted(|| {
        let patched = apply_ops(&mut doc, &patch, "patch", DOC, &writing).ok()?;
        let changed = patched.changed(&doc);
        let issues = if indexed {
            recheck_with(&mut doc, &prev, &changed, sealed, &referrers, &packs)
        } else {
            recheck(&mut doc, &prev, &changed, sealed)
        };
        Some((changed, issues))
    });
    let (changed, answered) = match &out {
        Some((changed, issues)) => (changed.iter().cloned().collect::<Vec<_>>(), issues.is_some()),
        None => (Vec::new(), false),
    };
    let text_bytes: usize = doc
        .get("data")
        .and_then(|d| d.get("blob"))
        .and_then(Value::as_array)
        .map_or(0, |rows| rows.iter().filter_map(Value::as_str).map(str::len).sum());
    json!({
        "data_text_bytes": text_bytes,
        "data_member": doc.get("data").is_some(),
        "items": item_ids(&doc).len(),
        "applied": out.is_some(),
        "changed": changed,
        "answered": answered,
        "allocated_bytes": asked,
    })
}

fn heap(sealed: &Sealed) -> Value {
    let mut out = Map::new();
    for (name, indexed) in [("recheck", false), ("recheck_with", true)] {
        // Once unmeasured first, so nothing a first call sets up once is counted on one side only.
        heap_run(false, indexed, sealed);
        out.insert(
            name.into(),
            json!({"with_data": heap_run(true, indexed, sealed), "without_data": heap_run(false, indexed, sealed)}),
        );
    }
    Value::Object(out)
}

// ---- `equal`: generated patches on generated documents (#2700.ce79405c).

/// SplitMix64: the same numbers from the same seed, on every machine.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        self.next() % n.max(1)
    }
    fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }
    fn pick<'a, T>(&mut self, of: &'a [T]) -> Option<&'a T> {
        if of.is_empty() {
            None
        } else {
            of.get(self.below(of.len() as u64) as usize)
        }
    }
}

const ASSETS: usize = 6;
const DATA_ROWS: [&str; 6] = ["r0", "r1", "r2", "r3", "r4", "r5"];

fn sha(rng: &mut Rng) -> String {
    (0..4).map(|_| format!("{:016x}", rng.next())).collect()
}

/// What a `pic`'s `asset` may hold: an asset's ID, an asset's SHA-256, or a name the document
/// lacks.
fn an_asset(rng: &mut Rng, shas: &[String]) -> String {
    match rng.below(10) {
        0..=4 => format!("a{}", rng.below(ASSETS as u64)),
        5..=7 => rng.pick(shas).cloned().unwrap_or_default(),
        _ => format!("ghost{}", rng.below(3)),
    }
}

/// What a `pic`'s `row` may hold: a row that is a number, one that isn't, or one the document
/// lacks.
fn a_row(rng: &mut Rng) -> String {
    if rng.chance(20) {
        format!("lost{}", rng.below(3))
    } else {
        rng.pick(&DATA_ROWS).map(|r| r.to_string()).unwrap_or_default()
    }
}

fn pic_params(rng: &mut Rng, shas: &[String]) -> Value {
    let mut params = Map::new();
    if rng.chance(80) {
        params.insert("asset".into(), json!(an_asset(rng, shas)));
    }
    if rng.chance(70) {
        params.insert("row".into(), json!(a_row(rng)));
    }
    if rng.chance(30) {
        params.insert("gain".into(), json!(rng.below(120)));
    }
    Value::Object(params)
}

fn generated_doc(rng: &mut Rng) -> (Value, Vec<String>) {
    let mut doc = envelope();
    let shas: Vec<String> = (0..ASSETS).map(|_| sha(rng)).collect();
    let mut assets = Map::new();
    for (i, s) in shas.iter().enumerate() {
        assets.insert(format!("a{i}"), json!({"sha256": s, "license": "CC0-1.0"}));
    }
    doc["assets"] = Value::Object(assets);
    doc["data"] = json!({
        "r0": rng.below(100), "r1": {"value": rng.below(100), "source": "story"},
        "r2": [1, 2, rng.below(9)], "r3": ["x", "y"], "r4": 0.5, "r5": {"value": 2, "source": "measured"},
    });
    let count = 8 + rng.below(17);
    let mut ids: Vec<String> = Vec::new();
    for i in 0..count {
        let id = format!("i{i}");
        let parent = if rng.chance(40) { rng.pick(&ids).cloned() } else { None };
        let item = if rng.chance(55) {
            pic_item(&id, pic_params(rng, &shas), parent.as_deref())
        } else {
            let width = if rng.chance(15) { -5 } else { 1 + rng.below(50) as i64 };
            slab(&id, width, parent.as_deref())
        };
        doc["items"][&id] = item;
        ids.push(id);
    }
    (doc, shas)
}

/// One generated op on `doc`: most target an item the document holds, some one it lacks.
fn generated_op(rng: &mut Rng, doc: &Value, shas: &[String], n: u64) -> Value {
    let ids = item_ids(doc);
    let pics: Vec<String> = ids
        .iter()
        .filter(|id| doc["items"][id.as_str()]["kind"] == "acc2700.pic@1")
        .cloned()
        .collect();
    let any = |rng: &mut Rng| rng.pick(&ids).cloned().unwrap_or_else(|| "nobody".into());
    let a_pic = |rng: &mut Rng| {
        if rng.chance(92) {
            rng.pick(&pics).cloned().unwrap_or_else(|| "nobody".into())
        } else {
            rng.pick(&ids).cloned().unwrap_or_else(|| "nobody".into())
        }
    };
    match rng.below(20) {
        0..=4 => {
            let id = a_pic(rng);
            json!({"op": "set", "id": id, "path": format!("items/{id}/params/asset"), "value": an_asset(rng, shas)})
        }
        5..=7 => {
            let id = a_pic(rng);
            json!({"op": "set", "id": id, "path": format!("items/{id}/params/row"), "value": a_row(rng)})
        }
        8 => {
            let id = a_pic(rng);
            let field = if rng.chance(50) { "asset" } else { "row" };
            json!({"op": "unset", "id": id, "path": format!("items/{id}/params/{field}")})
        }
        9 => {
            let id = a_pic(rng);
            json!({"op": "set", "id": id, "path": format!("items/{id}/params/gain"), "value": rng.below(130)})
        }
        10..=11 => {
            let id = any(rng);
            let value = if rng.chance(30) { json!(-5) } else { json!(1 + rng.below(60)) };
            json!({"op": "set", "id": id, "path": format!("items/{id}/params/width"), "value": value})
        }
        12..=13 => {
            let parent = if rng.chance(35) { Value::Null } else { json!(any(rng)) };
            json!({"op": "move", "id": any(rng), "parent": parent})
        }
        14 => json!({"op": "delete", "id": any(rng), "cascade": rng.chance(50)}),
        15 => {
            let id = any(rng);
            json!({"op": "set", "id": id, "path": format!("items/{id}/name"), "value": format!("N{}", rng.below(50))})
        }
        _ => {
            let id = if rng.chance(90) { format!("n{n}") } else { any(rng) };
            let parent = if rng.chance(45) { rng.pick(&ids).cloned() } else { None };
            let mut item = if rng.chance(65) {
                pic_item(&id, pic_params(rng, shas), parent.as_deref())
            } else {
                slab(&id, 1 + rng.below(50) as i64, parent.as_deref())
            };
            if let Some(fields) = item.as_object_mut() {
                fields.shift_remove("layer");
            }
            json!({"op": "create", "item": item})
        }
    }
}

fn param_of<'a>(item: Option<&'a Value>, name: &str) -> Option<&'a Value> {
    item?.get("params")?.get(name)
}

/// The issues one side reports and the other doesn't, with the items they name.
fn difference(whole: &[Value], other: &[Value]) -> (Vec<Value>, Vec<Value>, Vec<String>) {
    let only_whole: Vec<Value> = whole.iter().filter(|i| !other.contains(i)).cloned().collect();
    let only_other: Vec<Value> = other.iter().filter(|i| !whole.contains(i)).cloned().collect();
    let mut named = BTreeSet::new();
    for issue in only_whole.iter().chain(&only_other) {
        for id in issue["ids"].as_array().into_iter().flatten() {
            if let Some(id) = id.as_str() {
                named.insert(id.to_string());
            }
        }
    }
    (only_whole, only_other, named.into_iter().collect())
}

const PER_DOC: u64 = 100;
const SHOWN: usize = 12;

fn equal(seed: u64, wanted: u64, sealed: &Sealed) -> Value {
    let mut rng = Rng(seed);
    let packs = Packs::default();
    let writing = writing();
    let (mut applied, mut refused, mut drawn, mut docs) = (0u64, 0u64, 0u64, 0u64);
    let (mut names_asset, mut names_row, mut asset_changed, mut row_changed) = (0u64, 0u64, 0u64, 0u64);
    let (mut with_issues, mut unanswered) = (0u64, 0u64);
    let mut by_op: BTreeMap<String, u64> = BTreeMap::new();
    let mut mismatches: Vec<Value> = Vec::new();
    let mut mismatched = 0u64;
    'docs: while applied < wanted && drawn < wanted * 20 {
        let (mut doc, shas) = generated_doc(&mut rng);
        docs += 1;
        let mut prev = whole(&doc, sealed);
        let mut referrers = Referrers::of(&doc);
        let mut on_doc = 0;
        while on_doc < PER_DOC && item_ids(&doc).len() >= 3 {
            if applied >= wanted || drawn >= wanted * 20 {
                break 'docs;
            }
            drawn += 1;
            let ops: Vec<Value> = (0..if rng.chance(15) { 2 } else { 1 })
                .map(|_| generated_op(&mut rng, &doc, &shas, drawn))
                .collect();
            let patch = patch_of(drawn, ops.clone());
            let Ok(patched) = apply_ops(&mut doc, &patch, "patch", DOC, &writing) else {
                refused += 1;
                continue;
            };
            let changed = patched.changed(&doc);
            if changed.is_empty() {
                // A patch that changed no item is no patch to re-check.
                refused += 1;
                continue;
            }
            applied += 1;
            on_doc += 1;
            for op in &ops {
                *by_op.entry(op["op"].as_str().unwrap_or("?").to_string()).or_default() += 1;
            }
            let mut flags = [false; 4];
            // The changed items whose `asset` the patch changed.
            let mut assets: Vec<String> = Vec::new();
            for id in &changed {
                let was = patched.before.get(id).and_then(Option::as_ref);
                let now = doc.get("items").and_then(|i| i.get(id));
                for (k, name) in ["asset", "row"].iter().enumerate() {
                    let (a, b) = (param_of(was, name), param_of(now, name));
                    flags[k] |= a.is_some() || b.is_some();
                    let differs = was.is_some() && now.is_some() && a != b;
                    flags[2 + k] |= differs;
                    if differs && k == 0 {
                        assets.push(id.clone());
                    }
                }
            }
            names_asset += u64::from(flags[0]);
            names_row += u64::from(flags[1]);
            asset_changed += u64::from(flags[2]);
            row_changed += u64::from(flags[3]);
            let given = doc.to_string();
            let full = whole(&doc, sealed);
            let full_keys = keys(&full);
            with_issues += u64::from(!full.is_empty());
            let scanned = recheck(&mut doc, &prev, &changed, sealed);
            let indexed = recheck_with(&mut doc, &prev, &changed, sealed, &referrers, &packs);
            for (function, got) in [("recheck", &scanned), ("recheck_with", &indexed)] {
                let got_keys = got.as_deref().map(keys);
                if got_keys.as_ref() == Some(&full_keys) {
                    continue;
                }
                unanswered += u64::from(got.is_none());
                mismatched += 1;
                if mismatches.len() < SHOWN {
                    let (only_whole, only_recheck, named) =
                        difference(&full_keys, got_keys.as_deref().unwrap_or(&[]));
                    mismatches.push(json!({
                        "function": function, "seed": seed, "document": docs, "patch": drawn, "ops": ops,
                        "changed": changed, "asset_changed_on": assets, "answered": got.is_some(),
                        "items": named, "only_whole_check": only_whole, "only_recheck": only_recheck,
                    }));
                }
            }
            if doc.to_string() != given && mismatches.len() < SHOWN {
                mismatched += 1;
                mismatches.push(json!({"function": "recheck", "seed": seed, "document": docs, "patch": drawn, "ops": ops,
                    "changed": changed, "items": changed, "document_changed": true}));
            }
            for (id, was) in &patched.before {
                referrers.update(id, was.as_ref(), doc.get("items").and_then(|i| i.get(id)));
            }
            prev = full;
        }
    }
    json!({
        "seed": seed, "wanted": wanted, "applied": applied, "refused_or_unchanged": refused, "drawn": drawn,
        "documents": docs, "ops": by_op,
        "patches_to_an_item_naming_an_asset": names_asset, "patches_to_an_item_naming_a_data_row": names_row,
        "patches_changing_an_items_asset": asset_changed, "patches_changing_an_items_row": row_changed,
        "revisions_with_issues": with_issues, "unanswered": unanswered,
        "mismatched": mismatched, "mismatches": mismatches,
    })
}

// ---- `data-row`: a patch that changes a row of `data` (#2700.65df5186).

fn data_row(sealed: &Sealed) -> Value {
    let packs = Packs::default();
    let mut doc = envelope();
    doc["data"] = json!({"goal": 7, "share": {"value": 2, "source": "story"}});
    doc["items"]["frame"] = slab("frame", 4, None);
    doc["items"]["meter"] = pic_item("meter", json!({"row": "goal"}), Some("frame"));
    doc["items"]["other"] = pic_item("other", json!({"row": "share"}), None);
    doc["items"]["plain"] = slab("plain", 9, None);
    let mut steps = Vec::new();
    // The row changed to what no item can read as a number, then changed back.
    for (step, value) in [("broken", json!(["seven"])), ("mended", json!(7))] {
        let prev = whole(&doc, sealed);
        let referrers = Referrers::of(&doc);
        doc["data"]["goal"] = value.clone();
        let changed: BTreeSet<String> = BTreeSet::from(["goal".to_string()]);
        let full = keys(&whole(&doc, sealed));
        let mut calls = Map::new();
        for function in ["recheck", "recheck_with"] {
            let mut given = doc.clone();
            let got = if function == "recheck" {
                recheck(&mut given, &prev, &changed, sealed)
            } else {
                recheck_with(&mut given, &prev, &changed, sealed, &referrers, &packs)
            };
            // "Takes the whole check": where the recheck answers nothing, its caller runs it.
            let reported = got.as_deref().map(keys).unwrap_or_else(|| keys(&whole(&given, sealed)));
            let (only_whole, only_patch, named) = difference(&full, &reported);
            calls.insert(function.into(), json!({
                "recheck_answered": got.is_some(), "reported": reported, "only_whole_check": only_whole,
                "only_patch": only_patch, "items": named, "document_as_given": given == doc,
            }));
        }
        steps.push(json!({
            "step": step, "row": "goal", "path": "data/goal", "value": value, "reader": "meter",
            "previous": keys(&prev), "whole_check": full, "calls": calls,
        }));
    }
    json!({"steps": steps})
}

// ---- `as-given`: the document after a recheck (#2700.934bb9b3).

fn given_doc(with_map: bool) -> Value {
    let mut doc = envelope();
    doc["assets"] = json!({"a0": {"sha256": "0".repeat(64), "license": "CC0-1.0"}});
    doc["data"] = json!({"goal": 7, "names": ["x", "y"], "share": {"value": 2, "source": "story"}});
    // Out of sorted order on purpose: "items in their order".
    for (id, parent) in [("zeta", None), ("alpha", Some("zeta")), ("mid", None), ("beta", Some("mid")),
                         ("omega", None), ("gamma", Some("alpha")), ("delta", None), ("kappa", Some("delta"))] {
        doc["items"][id] = slab(id, 3, parent);
    }
    doc["items"]["pic-b"] = pic_item("pic-b", json!({"asset": "a0", "row": "goal"}), Some("zeta"));
    doc["items"]["pic-a"] = pic_item("pic-a", json!({"asset": "lost", "row": "names"}), None);
    doc["items"]["eta"] = slab("eta", 3, Some("pic-b"));
    doc["items"]["theta"] = slab("theta", -5, None);
    if with_map {
        doc["collections"] = json!({"group": {"members": ["zeta", "mid"]}});
    }
    doc
}

fn as_given(sealed: &Sealed) -> Value {
    std::panic::set_hook(Box::new(|_| {}));
    let packs = Packs::default();
    let writing = writing();
    let cases = [
        ("issues", false, json!({"op": "set", "id": "alpha", "path": "items/alpha/params/width", "value": -5})),
        ("whole", true, json!({"op": "set", "id": "alpha", "path": "items/alpha/params/width", "value": -5})),
        ("panic", false, json!({"op": "set", "id": "pic-b", "path": "items/pic-b/params/fuse", "value": "blow"})),
    ];
    let mut out = Vec::new();
    for (name, with_map, op) in cases {
        for function in ["recheck", "recheck_with"] {
            let mut doc = given_doc(with_map);
            let prev = whole(&doc, sealed);
            let referrers = Referrers::of(&doc);
            let patch = patch_of(7, vec![op.clone()]);
            let Ok(patched) = apply_ops(&mut doc, &patch, "patch", DOC, &writing) else {
                out.push(json!({"case": name, "function": function, "applied": false}));
                continue;
            };
            let changed = patched.changed(&doc);
            let given = serde_json::to_vec(&doc).unwrap_or_default();
            let given_items = item_ids(&doc);
            BLEW.store(false, Ordering::SeqCst);
            let result = catch_unwind(AssertUnwindSafe(|| {
                if function == "recheck" {
                    recheck(&mut doc, &prev, &changed, sealed)
                } else {
                    recheck_with(&mut doc, &prev, &changed, sealed, &referrers, &packs)
                }
            }));
            let after = serde_json::to_vec(&doc).unwrap_or_default();
            let after_items = item_ids(&doc);
            let first_missing = given_items.iter().find(|id| !after_items.contains(id));
            let first_moved = given_items
                .iter()
                .zip(&after_items)
                .position(|(a, b)| a != b)
                .map(|at| json!({"at": at, "given": given_items[at], "after": after_items[at]}));
            let first_byte = given.iter().zip(&after).position(|(a, b)| a != b).or_else(|| {
                (given.len() != after.len()).then_some(given.len().min(after.len()))
            });
            out.push(json!({
                "case": name, "function": function, "applied": true, "changed": changed,
                "returned": match &result { Ok(Some(_)) => "issues", Ok(None) => "nothing", Err(_) => "panic" },
                "issues": result.as_ref().ok().and_then(|r| r.as_deref()).map(keys),
                "check_panicked": BLEW.load(Ordering::SeqCst),
                "equal": given == after, "given_bytes": given.len(), "after_bytes": after.len(),
                "first_byte_that_differs": first_byte,
                "given_items": given_items, "after_items": after_items,
                "first_missing": first_missing, "first_out_of_place": first_moved,
            }));
        }
    }
    let _ = std::panic::take_hook();
    json!({"cases": out})
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let number = |at: usize| args.get(at).and_then(|a| a.parse::<u64>().ok());
    let sealed = sealed();
    let out = match (args.first().map(String::as_str), number(1), number(2)) {
        (Some("heap"), _, _) => heap(&sealed),
        (Some("equal"), Some(seed), Some(patches)) => equal(seed, patches, &sealed),
        (Some("data-row"), _, _) => data_row(&sealed),
        (Some("as-given"), _, _) => as_given(&sealed),
        _ => {
            eprintln!("usage: acceptance-2700-probe heap | equal <seed> <patches> | data-row | as-given");
            std::process::exit(2);
        }
    };
    println!("{out}");
}
