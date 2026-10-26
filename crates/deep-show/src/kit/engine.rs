//! Patch as the kit drives it (canvas primitives: Patch): one patch's ops applied as a writer,
//! all or nothing, re-checked incrementally, refused when it adds an error to what its writer
//! holds, with its achieved counts, its undo and its revision hash; a dry run returns what the
//! commit would and commits nothing. Every step is the core's own function (`apply_ops`,
//! `recheck`, `Patched::undo`, order keys between the base's neighbors), composed as the hub
//! composes them; the planted twins of Patch's laws are reachable only through `planted`.
//!
//! The patch fuzzer draws random valid and invalid patches over every kind and op from a seed.

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};

use deep_canvas::document::{
    apply_ops, canonical_in, check_in, recheck, recheck_skipping_referrers, writer_layer, Issue,
    Patched, Writing,
};
use deep_canvas::kinds::{lookup, Lookup, ParamType, Registry};
use deep_canvas::registry::Sealed;
use serde_json::{json, Map, Value};

use super::Rng;
use crate::hub::Planted;
use crate::shared::blocking;

/// The writers a fuzzed document's layers hold.
pub const ALPHA: &str = "agent:thread-alpha";
pub const BRAVO: &str = "agent:thread-bravo";
pub const YOU: &str = "you:you";

/// What a commit or a dry run returns.
#[derive(Clone, Debug)]
pub struct Outcome<'d> {
    pub applied: bool,
    pub issues: Vec<Issue>,
    pub achieved: Value,
    /// How many items it changed: the cost it adds, as the dry run must report it too.
    pub cost: usize,
    /// The document after: the base itself (borrowed, never copied) when refused or dry.
    pub doc: Cow<'d, Value>,
    /// Its revision's issues, when applied.
    pub after: Vec<Issue>,
    pub changed: BTreeSet<String>,
    /// Each item the patch wrote, as it was: what its undo puts back.
    pub before: BTreeMap<String, Option<Value>>,
}

/// The patch engine over one build, with the build's kinds.
pub struct Engine<'s> {
    pub sealed: &'s Sealed,
    pub kinds: &'s Registry,
    pub planted: Option<Planted>,
}

impl Engine<'_> {
    /// A document's canonical bytes and its revision hash, both empty when it has no canonical
    /// form.
    pub fn canonical(&self, doc: &Value) -> (String, String) {
        canonical_in(doc, self.kinds)
            .map(|c| (c.bytes, c.sha256))
            .unwrap_or_default()
    }

    /// A document's revision hash, or empty when it has no canonical form.
    pub fn hash(&self, doc: &Value) -> String {
        self.canonical(doc).1
    }

    /// A document's canonical bytes, or nothing.
    pub fn bytes(&self, doc: &Value) -> String {
        self.canonical(doc).0
    }

    fn is(&self, p: Planted) -> bool {
        self.planted == Some(p)
    }

    /// The issues of `doc` in this build.
    pub fn full(&self, doc: &Value) -> Vec<Issue> {
        check_in(doc, self.sealed).issues
    }

    /// The incremental check after a patch that changed `changed`, or the full one when it
    /// needs that.
    pub fn incremental(
        &self,
        doc: &Value,
        prev: &[Issue],
        changed: &BTreeSet<String>,
    ) -> Vec<Issue> {
        let incremental = if self.is(Planted::IncrementalCheckSkipsReferrers) {
            recheck_skipping_referrers(doc, prev, changed, self.sealed)
        } else {
            recheck(doc, prev, changed, self.sealed)
        };
        incremental.unwrap_or_else(|| self.full(doc))
    }

    /// `patch` as `writer` on `doc`, whose issues are `prev`; `base` is the revision the patch
    /// was made on, when it isn't `doc`. A dry run commits nothing.
    pub fn patch<'d>(
        &self,
        doc: &'d Value,
        prev: &[Issue],
        writer: &str,
        patch: &Value,
        base: Option<&Value>,
        dry: bool,
    ) -> Outcome<'d> {
        let planted_codeless = self.is(Planted::RefusalWithoutCode);
        let refused = |mut issues: Vec<Issue>, doc: Cow<'d, Value>| {
            // The planted core refuses an unknown field with no code.
            if planted_codeless {
                for i in issues.iter_mut().filter(|i| i.code == "unknown_field") {
                    i.code = "";
                }
            }
            Outcome {
                applied: false,
                issues,
                achieved: json!({"created": {}, "updated": 0, "deleted": {}, "unchanged": true}),
                cost: 0,
                doc,
                after: Vec::new(),
                changed: BTreeSet::new(),
                before: BTreeMap::new(),
            }
        };
        let layer = match writer_layer(doc, writer) {
            Ok(l) => l,
            Err(issue) => return refused(vec![*issue], Cow::Borrowed(doc)),
        };
        let knows = |kind: &str| {
            deep_canvas_marks::scene::KINDS.contains(&kind)
                || !matches!(lookup(self.kinds, kind), Lookup::UnknownKind)
        };
        let base = if self.is(Planted::ApplyTimeOrderKeys) {
            None
        } else {
            base
        };
        let writing = Writing {
            layer: &layer,
            writer,
            you: writer.starts_with("you:"),
            base,
            knows: &knows,
        };
        let doc_id = doc["id"].as_str().unwrap_or_default().to_string();
        let mut working = doc.clone();
        let patched: Patched = match apply_ops(&mut working, patch, "patch", &doc_id, &writing) {
            Ok(p) => p,
            Err(issue) => return refused(vec![*issue], Cow::Borrowed(doc)),
        };
        let changed = patched.changed(&working);
        let achieved = patched.achieved(&working);
        if dry && self.is(Planted::DryRunSkipsRecheck) {
            let mut out = refused(Vec::new(), Cow::Borrowed(doc));
            out.applied = true;
            out.achieved = achieved;
            out.cost = changed.len();
            out.changed = changed;
            return out;
        }
        let after = self.incremental(&working, prev, &changed);
        let refusals = blocking(&after, prev, &working, &layer, &changed);
        if !refusals.is_empty() {
            let kept = if self.is(Planted::RefusedPatchWrites) {
                Cow::Owned(working)
            } else {
                Cow::Borrowed(doc)
            };
            return refused(refusals, kept);
        }
        Outcome {
            applied: true,
            issues: Vec::new(),
            achieved,
            cost: changed.len(),
            doc: if dry {
                Cow::Borrowed(doc)
            } else {
                Cow::Owned(working)
            },
            after,
            changed,
            before: patched.before,
        }
    }

    /// The undo of an applied patch by its writer, with nothing between: each item it wrote put
    /// back as it was (the hub's undo), re-checked; `base` holds the issues of the revision the
    /// patch was made on. The revision after, or the refusal.
    pub fn undo(&self, out: &Outcome, base: &[Issue], writer: &str) -> Result<Value, Vec<Issue>> {
        let layer = writer_layer(&out.doc, writer).map_err(|i| vec![*i])?;
        let mut doc = Value::clone(&out.doc);
        let paths = crate::shared::paths_of(&out.before, &out.doc);
        let put =
            crate::shared::put_back(&mut doc, &out.before, &paths, &layer).map_err(|i| vec![*i])?;
        if self.is(Planted::UndoReorderMintsKey) {
            minted_orders(&mut doc, &out.doc);
        }
        let changed = put.changed(&doc);
        let after = self.incremental(&doc, &out.after, &changed);
        // It may put back an issue its base held.
        let mut allowed = out.after.clone();
        allowed.extend(base.iter().cloned());
        let refusals = blocking(&after, &allowed, &doc, &layer, &changed);
        if refusals.is_empty() {
            Ok(doc)
        } else {
            Err(refusals)
        }
    }
}

/// The planted undo of a reorder: an item whose order key the undo put back gets a new key
/// minted between its neighbors there instead of its own.
fn minted_orders(doc: &mut Value, reordered: &Value) {
    let Some(items) = doc["items"].as_object() else {
        return;
    };
    let moved: Vec<String> = items
        .iter()
        .filter(|(k, v)| {
            reordered["items"]
                .get(*k)
                .is_some_and(|r| r["order"] != v["order"])
        })
        .map(|(k, _)| k.clone())
        .collect();
    for id in moved {
        let key = doc["items"][&id]["order"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let parent = doc["items"][&id].get("parent").cloned();
        let siblings: Vec<String> = doc["items"]
            .as_object()
            .into_iter()
            .flatten()
            .filter(|(k, v)| **k != id && v.get("parent").cloned() == parent)
            .filter_map(|(_, v)| v["order"].as_str().map(str::to_string))
            .collect();
        let lo = siblings.iter().filter(|o| **o < key).max().cloned();
        let hi = siblings.iter().filter(|o| **o > key).min().cloned();
        if let Some(minted) =
            deep_canvas::document::key_between(lo.as_deref(), hi.as_deref(), b"minted")
        {
            doc["items"][&id]["order"] = json!(minted);
        }
    }
}

/// A fuzzed document: the fixture's, with an ID, three writers' layers, its items split between
/// alpha and bravo, and every canvas module whose kinds the fuzzer may draw required.
pub fn fuzz_doc(sealed: &Sealed, fixture: &Value) -> Value {
    let mut doc = fixture.clone();
    doc["id"] = json!("01jb138z000000000000000001");
    doc["layers"] = json!({
        "you-main": {"writer": YOU, "title": "You", "order": "a0"},
        "alpha-main": {"writer": ALPHA, "title": "Alpha", "order": "a1"},
        "bravo-main": {"writer": BRAVO, "title": "Bravo", "order": "a2"},
    });
    if let Some(Value::Object(items)) = doc.get_mut("items") {
        for (k, item) in items.values_mut().enumerate() {
            item["layer"] = json!(if k % 2 == 0 {
                "alpha-main"
            } else {
                "bravo-main"
            });
        }
    }
    let mut modules = doc["requires"]["modules"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    for m in &sealed.modules {
        if !m.shapes.kinds.is_empty() && !modules.contains_key(&m.name) {
            modules.insert(m.name.clone(), json!(format!("^{}", m.version.major)));
        }
    }
    if !modules.is_empty() {
        if !doc["requires"].is_object() {
            doc["requires"] = json!({});
        }
        doc["requires"]["modules"] = Value::Object(modules);
    }
    doc
}

/// The kinds the fuzzer draws: every kind the build draws.
pub fn kinds(sealed: &Sealed) -> Vec<String> {
    super::manifest::Manifest::kinds_of(sealed)
}

/// The ops the fuzzer draws.
pub const OPS: [&str; 6] = ["create", "set", "unset", "delete", "move", "reorder"];

/// A random patch on `doc` from `rng`: one to three ops, each valid or (one time in five)
/// invalid, over the build's kinds, as `writer`. Each op's name is counted in `ops`.
pub fn draw_patch(
    registry: &Registry,
    doc: &Value,
    writer_layer: &str,
    kinds: &[String],
    rng: &mut Rng,
    n: u64,
) -> (Value, Vec<&'static str>, Vec<String>) {
    let mut ops = Vec::new();
    let mut names = Vec::new();
    let mut drawn_kinds = Vec::new();
    let count = 1 + rng.below(3);
    let mut minted = 0;
    let items: Vec<(&String, &Value)> = doc["items"].as_object().into_iter().flatten().collect();
    let own: Vec<&(&String, &Value)> = items
        .iter()
        .filter(|(_, v)| v["layer"].as_str() == Some(writer_layer))
        .collect();
    for _ in 0..count {
        let op = *rng.pick(&OPS).expect("ops");
        let invalid = rng.chance(20);
        let target = if own.is_empty() || rng.chance(10) {
            rng.pick(&items).map(|(k, _)| k.to_string())
        } else {
            rng.pick(&own).map(|(k, _)| k.to_string())
        }
        .unwrap_or_else(|| "nobody".into());
        let target = if invalid && rng.chance(30) {
            "ghost".to_string()
        } else {
            target
        };
        let value = match op {
            "create" => {
                minted += 1;
                let kind = rng.pick(kinds).cloned().unwrap_or_else(|| "rect@1".into());
                drawn_kinds.push(kind.clone());
                let mut item = new_item(registry, &kind, &format!("k{n}x{minted}"), rng);
                if invalid {
                    match rng.below(3) {
                        0 => item["id"] = json!("Not An ID!"),
                        1 => item["bogus"] = json!(1),
                        _ => item["kind"] = json!("nope.thing@1"),
                    }
                }
                if rng.chance(25) && !items.is_empty() {
                    if let Some((p, _)) = rng.pick(&items) {
                        item["parent"] = json!(p);
                    }
                }
                json!({"op": "create", "item": item})
            }
            "set" => {
                let item = doc["items"].get(&target).unwrap_or(&Value::Null);
                if let Some(k) = item["kind"].as_str() {
                    drawn_kinds.push(k.to_string());
                }
                let (path, value) = set_value(registry, &target, item, invalid, rng);
                json!({"op": "set", "id": target, "path": path, "value": value})
            }
            "unset" => {
                let item = doc["items"].get(&target).unwrap_or(&Value::Null);
                let fields: Vec<String> = item["params"]
                    .as_object()
                    .map(|p| {
                        p.keys()
                            .map(|k| format!("items/{target}/params/{k}"))
                            .collect()
                    })
                    .unwrap_or_default();
                let path = rng
                    .pick(&fields)
                    .cloned()
                    .unwrap_or_else(|| format!("items/{target}/at"));
                let path = if invalid {
                    format!("items/{target}/nonsense")
                } else {
                    path
                };
                json!({"op": "unset", "id": target, "path": path})
            }
            "delete" => json!({"op": "delete", "id": target, "cascade": rng.chance(50)}),
            "move" => {
                let parent = if rng.chance(40) {
                    Value::Null
                } else {
                    rng.pick(&items).map_or(Value::Null, |(k, _)| json!(k))
                };
                let parent = if invalid { json!("ghost") } else { parent };
                let mut m = json!({"op": "move", "id": target, "parent": parent});
                if rng.chance(50) {
                    m["keep"] = json!(if rng.chance(50) { "world" } else { "local" });
                }
                m
            }
            _ => {
                let neighbor = rng
                    .pick(&items)
                    .map_or("ghost".to_string(), |(k, _)| k.to_string());
                let side = if rng.chance(50) { "after" } else { "before" };
                let mut r = json!({"op": "reorder", "id": target});
                r[side] = json!(neighbor);
                if invalid {
                    r["after"] = json!(neighbor);
                    r["before"] = json!(neighbor);
                }
                r
            }
        };
        names.push(op);
        ops.push(value);
    }
    // The ops go in last, moved rather than copied as `json!` would.
    let mut patch = json!({"patch": format!("01JB138P{n:018}"), "doc": doc["id"], "base": 0,
                           "reason": "fuzzed"});
    patch["ops"] = Value::Array(ops);
    (patch, names, drawn_kinds)
}

/// A new item of `kind`, its params drawn across its schema.
fn new_item(registry: &Registry, kind: &str, id: &str, rng: &mut Rng) -> Value {
    let mut params = Map::new();
    match lookup(registry, kind) {
        Lookup::Known { entry, saved } => {
            if let Some(v) = entry.version(saved) {
                for p in &v.params {
                    if rng.chance(20) {
                        continue;
                    }
                    params.insert(p.name.into(), param_value(p, rng, false));
                }
            }
        }
        _ if kind == "text@1" => {
            params.insert("text".into(), json!("Fuzzed"));
            params.insert("font".into(), json!("body"));
            params.insert("size".into(), json!(12));
            params.insert("box".into(), json!({"w": 80, "h": 16}));
        }
        _ => {
            let x = (rng.range(0.0, 200.0)).round();
            params.insert("box".into(), json!([x, 10, 20, 12]));
            params.insert("paint".into(), json!({"fill": {"role": "muted"}}));
        }
    }
    if params.contains_key("box") && !params["box"].is_array() && kind != "text@1" {
        params.insert("box".into(), json!([10, 10, 20, 12]));
    }
    json!({"id": id, "kind": kind, "name": format!("Fuzzed {id}"),
           "order": format!("z{}", rng.below(1000)), "params": params})
}

/// A value of a param: inside its range (at its min, max, default or between), or, when
/// `invalid`, past it or of another type.
pub fn param_value(p: &deep_canvas::kinds::Param, rng: &mut Rng, invalid: bool) -> Value {
    match p.ty {
        ParamType::F32 => {
            let lo = p.min.unwrap_or(-1000.0);
            let hi = p.max.unwrap_or(1000.0);
            if invalid {
                return if rng.chance(50) {
                    json!(hi + 1.0 + rng.range(0.0, 10.0).round())
                } else {
                    json!("seven")
                };
            }
            match rng.below(4) {
                0 => json!(lo),
                1 => json!(hi),
                2 => p.default.clone(),
                _ => json!((rng.range(lo, hi) * 100.0).round() / 100.0),
            }
        }
        ParamType::Str => {
            if invalid {
                json!(7)
            } else {
                json!(format!("s{}", rng.below(100)))
            }
        }
        ParamType::Json => {
            if p.name == "box" {
                json!([
                    rng.range(0.0, 100.0).round(),
                    rng.range(0.0, 100.0).round(),
                    20,
                    10
                ])
            } else {
                p.default.clone()
            }
        }
    }
}

/// A `set`'s path and value on an item: one of its params by its kind's schema, its position or
/// its name; when `invalid`, past its range, an unknown field or a bad path.
fn set_value(
    registry: &Registry,
    id: &str,
    item: &Value,
    invalid: bool,
    rng: &mut Rng,
) -> (String, Value) {
    let kind = item["kind"].as_str().unwrap_or("");
    if let Lookup::Known { entry, saved } = lookup(registry, kind) {
        if let Some(v) = entry.version(saved) {
            if let Some(p) = rng.pick(&v.params) {
                if !(invalid && rng.chance(30)) {
                    return (
                        format!("items/{id}/params/{}", p.name),
                        param_value(p, rng, invalid),
                    );
                }
            }
        }
    }
    if invalid {
        return match rng.below(3) {
            0 => (format!("items/{id}/bogus"), json!(1)),
            1 => (format!("items/{id}/at/pos"), json!("left")),
            _ => (format!("items//{id}"), json!(1)),
        };
    }
    match rng.below(3) {
        0 => (
            format!("items/{id}/at/pos"),
            json!([
                rng.range(0.0, 200.0).round(),
                rng.range(0.0, 120.0).round(),
                0
            ]),
        ),
        1 => (
            format!("items/{id}/name"),
            json!(format!("Renamed {}", rng.below(100))),
        ),
        _ => match item["params"]["box"].as_array() {
            Some(_) if kind != "text@1" => (
                format!("items/{id}/params/box"),
                json!([
                    rng.range(0.0, 100.0).round(),
                    rng.range(0.0, 100.0).round(),
                    24,
                    12
                ]),
            ),
            _ => (format!("items/{id}/name"), json!("Renamed")),
        },
    }
}
