//! The canvas conformance kit (issue #138; technical design: How we know version 0 works, the
//! Canvas modules bullet and the parity suite; canvas primitives: Patch, Migration, Carried
//! state, Net: rollback, What holds a document to its rules).
//!
//! `{"call": "kit"}` proves each canvas module alone, headless, against its own fixtures and the
//! core's: every part below runs its cases and judges each from what it saw, and a part's
//! verdict comes from its cases, never from its exit status. A part runs every case it declares
//! or fails the module (`short_run`); a case that never reached a kind, field or module it
//! declares is INVALID; a probe a backend can't make is BLOCKED there, and a case no backend
//! proved fails the module (`unproved`). Every comparison of two outputs runs its planted-mismatch
//! twin, and one whose twin passes is INVALID. Nothing here runs per frame, and nothing a
//! shipped frame does reads the kit.
//!
//! Parts: `fixtures`, `clean_rebuild`, `patch_fuzz`, `read_set`, `order`, `schedule`,
//! `repair_loop`, `carried_state`, `late_entry`, `time_order`, `contribution`, `catalog` and
//! `migration`, each in its own file. Goldens, decisions, the manifest and the comparator are in
//! `goldens`, `manifest` and `compare`.

mod carried;
pub mod catalog;
pub mod compare;
mod engine;
mod fixtures;
mod fuzz;
pub mod goldens;
mod gpu;
mod instance;
pub mod ledger;
pub mod manifest;
mod migration;
pub mod modules;
mod order;
mod repair;
mod time_order;

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use crate::hub::{Hub, Planted};
use crate::optional;

/// The kit's parts, in the order it runs them.
pub const PARTS: [&str; 13] = [
    "fixtures",
    "clean_rebuild",
    "patch_fuzz",
    "read_set",
    "order",
    "schedule",
    "repair_loop",
    "carried_state",
    "late_entry",
    "time_order",
    "contribution",
    "catalog",
    "migration",
];

/// The backends a case can run on: Vello CPU, wgpu's noop backend and the GPU.
pub const BACKENDS: [&str; 3] = ["vello_cpu", "noop", "gpu"];

/// The issue's sizes.
pub const SEQUENCES: u32 = 10_000;
pub const PARAM_SETS: u32 = 1_000;
pub const SHUFFLED_ORDERS: usize = 8;
pub const SEEDED_TIMES: usize = 100;
/// The net module's default rollback window, in steps (Net: rollback).
pub const ROLLBACK_WINDOW: i64 = 8;

/// One `kit` call.
#[derive(Clone, Debug)]
pub struct KitCall {
    pub modules: Option<Vec<String>>,
    pub parts: Option<Vec<String>>,
    pub backends: Vec<String>,
    pub seed: u64,
    pub sequences: u32,
    pub param_sets: u32,
    pub patch_seed: Option<u64>,
    pub replay: Option<PathBuf>,
    pub corpus: Option<PathBuf>,
    pub ledger: Option<PathBuf>,
}

impl KitCall {
    /// Reads a `kit` call; `None` for an unknown part, backend or field.
    pub fn parse(c: &Map<String, Value>) -> Option<KitCall> {
        let known = [
            "call",
            "modules",
            "parts",
            "backends",
            "seed",
            "sequences",
            "param_sets",
            "patch_seed",
            "replay",
            "corpus",
            "ledger",
        ];
        if c.keys().any(|k| !known.contains(&k.as_str())) {
            return None;
        }
        let list = |k: &str| -> Option<Option<Vec<String>>> {
            match c.get(k) {
                None => Some(None),
                Some(v) => Some(Some(
                    v.as_array()?
                        .iter()
                        .map(|s| s.as_str().map(str::to_string))
                        .collect::<Option<_>>()?,
                )),
            }
        };
        let parts = list("parts")?;
        if parts
            .as_ref()
            .is_some_and(|p| p.iter().any(|x| !PARTS.contains(&x.as_str())))
        {
            return None;
        }
        let backends = list("backends")?.unwrap_or_else(|| vec!["vello_cpu".into(), "noop".into()]);
        if backends.is_empty() || backends.iter().any(|b| !BACKENDS.contains(&b.as_str())) {
            return None;
        }
        let n = |k: &str, default: u64| -> Option<u64> {
            match c.get(k) {
                None => Some(default),
                Some(v) => v.as_u64(),
            }
        };
        let path = |k: &str| -> Option<Option<PathBuf>> {
            match c.get(k) {
                None => Some(None),
                Some(v) => Some(Some(PathBuf::from(v.as_str()?))),
            }
        };
        Some(KitCall {
            modules: list("modules")?,
            parts,
            backends,
            seed: n("seed", 138)?,
            sequences: u32::try_from(n("sequences", u64::from(SEQUENCES))?).ok()?,
            param_sets: u32::try_from(n("param_sets", u64::from(PARAM_SETS))?).ok()?,
            patch_seed: optional(c.get("patch_seed"), Value::as_u64)?,
            replay: path("replay")?,
            corpus: path("corpus")?,
            ledger: path("ledger")?,
        })
    }

    fn runs(&self, part: &str) -> bool {
        self.parts
            .as_ref()
            .is_none_or(|p| p.iter().any(|x| x == part))
    }
}

/// A verdict, ranked: FAIL above INVALID above BLOCKED above PASS.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Verdict {
    Pass,
    Blocked,
    Invalid,
    Fail,
}

impl Verdict {
    pub fn name(self) -> &'static str {
        match self {
            Verdict::Pass => "PASS",
            Verdict::Blocked => "BLOCKED",
            Verdict::Invalid => "INVALID",
            Verdict::Fail => "FAIL",
        }
    }
}

/// One case a part ran: its verdict and what it recorded.
#[derive(Clone, Debug)]
pub struct Case {
    pub verdict: Verdict,
    pub fields: Map<String, Value>,
}

impl Case {
    pub fn new(name: impl Into<String>, verdict: Verdict) -> Case {
        let mut fields = Map::new();
        fields.insert("case".into(), json!(name.into()));
        Case { verdict, fields }
    }

    /// Records a field.
    pub fn with(mut self, key: &str, value: Value) -> Case {
        self.fields.insert(key.into(), value);
        self
    }

    pub fn set(&mut self, key: &str, value: Value) {
        self.fields.insert(key.into(), value);
    }

    /// Fails (or makes INVALID, or BLOCKED) with a failure, keeping the worst verdict.
    pub fn fail(&mut self, verdict: Verdict, failure: Value) {
        if verdict >= self.verdict || !self.fields.contains_key("failure") {
            self.fields.insert("failure".into(), failure);
        }
        self.verdict = self.verdict.max(verdict);
    }

    pub fn name(&self) -> &str {
        self.fields
            .get("case")
            .and_then(Value::as_str)
            .unwrap_or("")
    }

    fn to_json(&self) -> Value {
        let mut out = self.fields.clone();
        out.insert("verdict".into(), json!(self.verdict.name()));
        Value::Object(out)
    }
}

/// What a part returns: its declared count, its cases, the failures its cases didn't carry, its
/// own exit status and whatever else it records.
#[derive(Debug)]
pub struct PartRun {
    pub declared: u64,
    pub cases: Vec<Case>,
    pub failures: Vec<Value>,
    pub exit: i64,
    pub extra: Map<String, Value>,
}

impl PartRun {
    pub fn new(declared: u64) -> PartRun {
        PartRun {
            declared,
            cases: Vec::new(),
            failures: Vec::new(),
            exit: 0,
            extra: Map::new(),
        }
    }
}

/// A failure, as the report lists it: its code, its module and part, and its fields.
pub fn failure(code: &str, module: &str, part: &str, fields: Value) -> Value {
    let mut out = Map::new();
    out.insert("code".into(), json!(code));
    out.insert("module".into(), json!(module));
    out.insert("part".into(), json!(part));
    if let Value::Object(f) = fields {
        out.extend(f);
    }
    Value::Object(out)
}

/// A seed for one draw, from the kit's seed, a name and an index: replayable, and another seed,
/// name or index gives another.
pub fn derive(seed: u64, name: &str, k: u64) -> u64 {
    let mut h = deep_canvas::schedule::Hasher::v1("kit-seed");
    h.int(seed as i64).text(name).int(k as i64);
    let key = h.finish();
    u64::from_le_bytes(key.0[..8].try_into().expect("8 bytes")) >> 11
}

/// A small seeded generator (SplitMix64): one draw sequence per seed.
#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Rng {
        Rng(seed ^ 0x9e37_79b9_7f4a_7c15)
    }

    pub fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// A draw in `0..n`.
    pub fn below(&mut self, n: usize) -> usize {
        if n == 0 {
            0
        } else {
            (self.next() % n as u64) as usize
        }
    }

    pub fn chance(&mut self, percent: u64) -> bool {
        self.next() % 100 < percent
    }

    /// A draw in `[lo, hi]`.
    pub fn range(&mut self, lo: f64, hi: f64) -> f64 {
        let u = (self.next() >> 11) as f64 / (1u64 << 53) as f64;
        lo + (hi - lo) * u
    }

    pub fn pick<'a, T>(&mut self, list: &'a [T]) -> Option<&'a T> {
        if list.is_empty() {
            None
        } else {
            Some(&list[self.below(list.len())])
        }
    }
}

/// One module the kit proves: a sealed canvas module, or `core` for the core's own fixtures.
pub struct Subject {
    pub name: String,
    pub version: String,
    pub digest: String,
}

impl<'a> Hub<'a> {
    /// The canvas modules the kit proves, in name order: `core`, then each module the build
    /// holds.
    fn subjects(&self) -> Vec<Subject> {
        let sealed = &self.startup.sealed;
        let mut out = vec![Subject {
            name: "core".into(),
            version: deep_canvas::registry::CORE_VERSION.into(),
            digest: sealed.set_digest.clone(),
        }];
        for m in &sealed.modules {
            out.push(Subject {
                name: m.name.clone(),
                version: m.version.to_string(),
                digest: m.digest.clone(),
            });
        }
        out
    }

    /// `{"call": "kit"}`: every part over every module asked for.
    pub fn kit(&mut self, call: &KitCall) -> Value {
        let gpu = call.backends.iter().any(|b| b == "gpu");
        let lease = gpu.then(goldens::GpuLease::take);
        let manifest = manifest::Manifest::of(self);
        let mut modules = Vec::new();
        let mut corpus_files: Vec<String> = Vec::new();
        let mut criteria: BTreeMap<String, &'static str> = BTreeMap::new();
        let mut overall = Verdict::Pass;
        let mut ledger = Map::new();
        for subject in self.subjects() {
            if call
                .modules
                .as_ref()
                .is_some_and(|m| !m.contains(&subject.name))
            {
                continue;
            }
            let mut ctx = Ctx {
                call,
                module: &subject.name,
                manifest: &manifest,
                corpus: Vec::new(),
                interface: None,
                criteria: BTreeMap::new(),
            };
            let mut parts = Vec::new();
            let mut module_failures: Vec<Value> = Vec::new();
            let mut verdict = Verdict::Pass;
            for part in PARTS {
                if !call.runs(part) {
                    continue;
                }
                let Some(run) = self.run_part(part, &mut ctx) else {
                    continue;
                };
                let (value, part_verdict, failures) = judge_part(&subject.name, part, run);
                verdict = verdict.max(part_verdict);
                module_failures.extend(failures);
                parts.push((part, value, part_verdict));
            }
            if !module_failures.is_empty() {
                verdict = Verdict::Fail;
            }
            corpus_files.extend(ctx.corpus.iter().cloned());
            for (k, v) in &ctx.criteria {
                let e = criteria.entry(k.clone()).or_insert(v);
                if *v == "open" {
                    *e = "open";
                }
            }
            overall = overall.max(verdict);
            let mut m = json!({
                "module": subject.name, "version": subject.version, "digest": subject.digest,
                "verdict": verdict.name(),
                "parts": parts.iter().map(|(_, v, _)| v.clone()).collect::<Vec<_>>(),
                "failures": module_failures,
            });
            if let Some(iface) = &ctx.interface {
                m["interface"] = iface.clone();
            }
            ledger.insert(
                subject.name.clone(),
                json!({
                    "version": subject.version, "digest": subject.digest, "verdict": verdict.name(),
                    "parts": parts.iter().map(|(p, _, v)| (p.to_string(), json!(v.name()))).collect::<Map<_, _>>(),
                }),
            );
            modules.push(m);
        }
        if let Some(path) = &call.ledger {
            if let Some(dir) = path.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let text = serde_json::to_string_pretty(&Value::Object(ledger)).unwrap_or_default();
            let text = format!("{text}\n");
            // Written only when it changed: a newer ledger makes cargo rebuild the binary that
            // embeds it (build.rs), even with the same bytes.
            if std::fs::read_to_string(path).ok().as_deref() != Some(text.as_str()) {
                let _ = std::fs::write(path, text);
            }
        }
        drop(lease);
        json!({
            "verdict": overall.name(),
            "seed": call.seed,
            "backends": call.backends,
            "lease": {"gpu": gpu},
            "modules": modules,
            "corpus": corpus_files,
            "criteria": criteria,
        })
    }

    /// One part over one module, or `None` when the module has nothing it tests.
    fn run_part(&mut self, part: &str, ctx: &mut Ctx<'_>) -> Option<PartRun> {
        match part {
            "fixtures" => fixtures::run(self, ctx),
            "clean_rebuild" => fuzz::clean_rebuild(self, ctx),
            "patch_fuzz" => fuzz::patch_fuzz(self, ctx),
            "read_set" => order::read_set(self, ctx),
            "order" => order::order(self, ctx),
            "schedule" => order::schedule(self, ctx),
            "repair_loop" => repair::run(self, ctx),
            "carried_state" => carried::carried_state(self, ctx),
            "late_entry" => carried::late_entry(self, ctx),
            "time_order" => time_order::run(self, ctx),
            "contribution" => order::contribution(self, ctx),
            "catalog" => catalog::run(self, ctx),
            "migration" => migration::run(self, ctx),
            _ => None,
        }
    }

    /// Whether the scenario plants this wrong program.
    pub fn planted(&self, p: Planted) -> bool {
        self.scenario.planted == Some(p)
    }
}

/// What every part reads of the run: the call, the module, the manifest, and what the parts
/// leave for the report.
pub struct Ctx<'c> {
    pub call: &'c KitCall,
    pub module: &'c str,
    pub manifest: &'c manifest::Manifest,
    /// Crash-corpus files written.
    pub corpus: Vec<String>,
    /// `{"truth", "missing"}`, from the fixtures part.
    pub interface: Option<Value>,
    /// Criterion ID → `proved | open`, from the fixtures' sidecars.
    pub criteria: BTreeMap<String, &'static str>,
}

/// A part's report entry, its verdict and the module failures it raises: `short_run` when it ran
/// fewer cases than it declares or declares none, `failed_case` when it exited 0 with a failed
/// case, and `unproved` for a case BLOCKED on every backend it ran on.
fn judge_part(module: &str, part: &str, run: PartRun) -> (Value, Verdict, Vec<Value>) {
    let ran = run.cases.len() as u64;
    // A case BLOCKED on a backend that can't make its probe, and proved on another, is proved.
    let proved_elsewhere = |c: &Case| {
        c.verdict == Verdict::Blocked
            && c.fields.contains_key("backend")
            && run.cases.iter().any(|o| {
                o.name() == c.name()
                    && o.fields.get("backend") != c.fields.get("backend")
                    && o.fields.contains_key("backend")
                    && o.verdict == Verdict::Pass
            })
    };
    let mut verdict = run
        .cases
        .iter()
        .filter(|c| !proved_elsewhere(c))
        .map(|c| c.verdict)
        .max()
        .unwrap_or(Verdict::Pass);
    let mut module_failures = Vec::new();
    if ran < run.declared || run.declared == 0 {
        module_failures.push(failure(
            "short_run",
            module,
            part,
            json!({"declared": run.declared, "ran": ran}),
        ));
        verdict = Verdict::Fail;
    }
    if run.exit == 0 {
        if let Some(c) = run.cases.iter().find(|c| c.verdict == Verdict::Fail) {
            module_failures.push(failure(
                "failed_case",
                module,
                part,
                json!({"case": c.name()}),
            ));
        }
    }
    // A case no backend proved: BLOCKED on every backend it ran on.
    let mut by_case: BTreeMap<&str, (bool, Option<&str>)> = BTreeMap::new();
    for c in &run.cases {
        if !c.fields.contains_key("backend") {
            continue;
        }
        let e = by_case.entry(c.name()).or_insert((false, None));
        if c.verdict == Verdict::Blocked {
            if e.1.is_none() {
                e.1 = c.fields.get("probe").and_then(Value::as_str);
            }
        } else {
            e.0 = true;
        }
    }
    for (case, (proved, probe)) in by_case {
        if !proved {
            module_failures.push(failure(
                "unproved",
                module,
                part,
                json!({"case": case, "probe": probe.unwrap_or("pixels")}),
            ));
            verdict = Verdict::Fail;
        }
    }
    if !run.failures.is_empty() {
        verdict = verdict.max(Verdict::Fail);
    }
    let mut out = json!({
        "part": part,
        "verdict": verdict.name(),
        "declared": run.declared,
        "ran": ran,
        "exit": run.exit,
        "cases": run.cases.iter().map(Case::to_json).collect::<Vec<_>>(),
        "failures": run.failures,
    });
    for (k, v) in run.extra {
        out[k] = v;
    }
    (out, verdict, module_failures)
}
