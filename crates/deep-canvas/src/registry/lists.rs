//! Registries (issue #200; canvas primitives: Registry and seal: registries): a list a canvas
//! module, or the core, declares for canvas modules, packs or plug-ins to fill, with its entry
//! schema, who may fill it, a kit of rules every entry passes and planted wrong entries the kit
//! must refuse.
//!
//! The seal checks every declared registry and every entry a canvas module fills, runs each kit
//! on its planted wrong entries and refuses a registry whose kit admits one; it publishes the
//! sealed registries for `deep://registries/<core version>`. An entry is data, never Rust from
//! outside the module set: a kit rule is the declaring module's code, run on the entry's value.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

/// One rule of a kit: its ID, the message an entry that breaks it fails with, and the test,
/// which returns why the entry breaks it.
#[derive(Clone, Copy, Debug)]
pub struct KitRule {
    pub rule: &'static str,
    pub message: &'static str,
    pub test: fn(&Value) -> Result<(), String>,
    /// What the rule read on the entry, beside its verdict (#443: its fixture, its samples and
    /// its misses), or nothing.
    pub report: Option<fn(&Value) -> Value>,
}

/// A planted wrong entry: one the kit must refuse.
#[derive(Clone, Debug)]
pub struct PlantedEntry {
    pub name: String,
    pub value: Value,
}

/// A registry as its owner declares it (Registry and seal: registries: Fields).
#[derive(Clone, Debug)]
pub struct RegistryDef {
    /// `name@major`.
    pub name: String,
    /// The entry schema, a JSON Schema every entry's value meets.
    pub entry: Value,
    /// Who may fill it: `module`, `first_party_pack`, `pack` or `plugin`.
    pub fill: Vec<&'static str>,
    /// `seal` or `check`.
    pub resolve: &'static str,
    /// `all` or `author`: with `author`, an entry the working agent wrote binds only its own claims.
    pub binds: &'static str,
    pub kit: Vec<KitRule>,
    pub planted: Vec<PlantedEntry>,
    /// The release it landed in; a registry without one is refused at the seal.
    pub since: Option<String>,
    /// `stable` or `preview`, as its contract row says.
    pub stability: &'static str,
    pub deprecated_since: Option<String>,
    pub replaced_by: Option<String>,
    /// For a registry whose entries carry a planted twin (`gpu.step@1`): the entry's own fixture
    /// run on its twin, which must fail naming the entry.
    pub twin: Option<fn(&str, &Value) -> KitResult>,
    /// For a registry of timed entries (cue kinds, shot moves, transitions): an entry's moves at
    /// its defaults, printed from the same expansion the check runs (#412), never stored.
    pub moves: Option<fn(&Value) -> Vec<Value>>,
    /// For a registry whose entries are programs (#238): the role they run in. Each entry names
    /// its program's asset by sha256 in `program`; its kit reads the program's bytes, in hex, in
    /// `wasm`, and only a build with the sandbox module, which admits and runs it, takes one.
    pub program: Option<&'static str>,
}

impl RegistryDef {
    /// A registry filled at the seal, binding all, stable, with nothing else set.
    pub fn new(name: &str, entry: Value, fill: &[&'static str], since: &str) -> RegistryDef {
        RegistryDef {
            name: name.into(),
            entry,
            fill: fill.to_vec(),
            resolve: "seal",
            binds: "all",
            kit: Vec::new(),
            planted: Vec::new(),
            since: Some(since.into()),
            stability: "stable",
            deprecated_since: None,
            replaced_by: None,
            twin: None,
            moves: None,
            program: None,
        }
    }

    pub fn rule(
        mut self,
        rule: &'static str,
        message: &'static str,
        test: fn(&Value) -> Result<(), String>,
    ) -> RegistryDef {
        self.kit.push(KitRule {
            rule,
            message,
            test,
            report: None,
        });
        self
    }

    /// The last rule's report: what it read on each entry, shown beside its verdict (#443).
    pub fn reported(mut self, report: fn(&Value) -> Value) -> RegistryDef {
        if let Some(k) = self.kit.last_mut() {
            k.report = Some(report);
        }
        self
    }

    pub fn planted(mut self, name: &str, value: Value) -> RegistryDef {
        self.planted.push(PlantedEntry {
            name: name.into(),
            value,
        });
        self
    }

    /// The digest of its shape: the name and the entry schema, frozen per major.
    pub fn digest(&self) -> String {
        d1(&json!({"name": self.name, "entry": self.entry}))
    }

    /// Its kit run on `value`, an entry named `name`.
    pub fn run_kit(&self, name: &str, value: &Value) -> KitResult {
        run_kit(&self.kit, name, value)
    }

    /// Its contract row (packages/contracts/canvas-registries.json), with `owner`.
    pub fn contract(&self, owner: &str) -> Map<String, Value> {
        let mut row = Map::new();
        row.insert("registry".into(), json!(self.name));
        row.insert("owner".into(), json!(owner));
        row.insert("fill".into(), json!(self.fill));
        row.insert("resolve".into(), json!(self.resolve));
        if let Some(since) = &self.since {
            row.insert("since".into(), json!(since));
        }
        row.insert("stability".into(), json!(self.stability));
        if let Some(d) = &self.deprecated_since {
            row.insert("deprecated_since".into(), json!(d));
        }
        if let Some(r) = &self.replaced_by {
            row.insert("replaced_by".into(), json!(r));
        }
        row.insert("entry".into(), self.entry.clone());
        row
    }
}

/// An entry a canvas module, or the core, fills at the seal.
#[derive(Clone, Debug)]
pub struct EntryDef {
    /// `name@major`.
    pub registry: String,
    pub name: String,
    pub value: Value,
    pub since: String,
}

/// One rule's result on one entry.
#[derive(Clone, Debug, PartialEq)]
pub struct RuleResult {
    pub rule: &'static str,
    pub pass: bool,
    pub message: &'static str,
    pub why: String,
    /// What the rule read, merged into its JSON (#443).
    pub report: Option<Value>,
}

/// A kit's result on one entry: every rule's.
#[derive(Clone, Debug, PartialEq)]
pub struct KitResult {
    pub entry: String,
    pub rules: Vec<RuleResult>,
}

impl KitResult {
    pub fn pass(&self) -> bool {
        self.rules.iter().all(|r| r.pass)
    }

    /// The rules the entry breaks.
    pub fn failed(&self) -> Vec<&'static str> {
        self.rules
            .iter()
            .filter(|r| !r.pass)
            .map(|r| r.rule)
            .collect()
    }

    pub fn to_json(&self) -> Value {
        json!({
            "verdict": if self.pass() { "PASS" } else { "FAIL" },
            "entry": self.entry,
            "rules": self.rules.iter().map(|r| {
                let mut out = if r.pass {
                    json!({"rule": r.rule, "verdict": "PASS"})
                } else {
                let mut out = json!({"rule": r.rule, "verdict": "FAIL", "message": r.message, "why": r.why});
                // A rule that fails at a frame says so first, `frame <n>: …`, and names it.
                let frame = r.why.strip_prefix("frame ").and_then(|w| w.split(':').next()?.parse::<u64>().ok());
                if let Some(frame) = frame {
                    out["frame"] = json!(frame);
                }
                out
                };
                if let Some(Value::Object(report)) = &r.report {
                    for (k, v) in report {
                        out[k.as_str()] = v.clone();
                    }
                }
                out
            }).collect::<Vec<_>>(),
        })
    }
}

/// Every rule of `kit` on the entry `name`.
pub fn run_kit(kit: &[KitRule], name: &str, value: &Value) -> KitResult {
    KitResult {
        entry: name.into(),
        rules: kit
            .iter()
            .map(|k| {
                let outcome = (k.test)(value);
                RuleResult {
                    rule: k.rule,
                    pass: outcome.is_ok(),
                    message: k.message,
                    why: outcome.err().unwrap_or_default(),
                    report: k.report.map(|f| f(value)),
                }
            })
            .collect(),
    }
}

/// The rules of `kit` no planted entry isolates: a rule is isolated when some planted entry breaks
/// it and no other rule (Registry and seal: registries: "each rule has its own planted wrong
/// entry or fill that breaks that rule alone").
pub fn unisolated(def: &RegistryDef) -> Vec<&'static str> {
    let results: Vec<KitResult> = def
        .planted
        .iter()
        .map(|p| def.run_kit(&p.name, &p.value))
        .collect();
    def.kit
        .iter()
        .map(|k| k.rule)
        .filter(|rule| !results.iter().any(|r| r.failed() == [*rule]))
        .collect()
}

/// An entry after the seal or the pack check: where it came from and its kit's result.
#[derive(Clone, Debug, PartialEq)]
pub struct SealedEntry {
    pub name: String,
    pub registry: String,
    /// `first_party`, `pack`, `plugin` or `agent`.
    pub origin: &'static str,
    /// The canvas module that filled it, `core` for the core's own; empty for a pack's.
    pub module: String,
    /// `owner/name@version` of the pack that filled it; empty for a module's.
    pub pack: String,
    pub value: Value,
    pub since: String,
    pub digest: String,
    pub kit: KitResult,
    /// Its fixture on its planted twin, for a registry whose entries carry one.
    pub twin: Option<KitResult>,
}

impl SealedEntry {
    pub fn to_json(&self) -> Value {
        let mut out = json!({
            "name": self.name, "registry": self.registry, "origin": self.origin,
            "value": self.value, "since": self.since, "digest": self.digest, "kit": self.kit.to_json(),
        });
        if !self.module.is_empty() {
            out["module"] = json!(self.module);
        }
        if !self.pack.is_empty() {
            out["pack"] = json!(self.pack);
        }
        if let Some(t) = &self.twin {
            out["twin_result"] = t.to_json();
        }
        out
    }
}

/// A registry after the seal: its owner, its planted entries' results and its entries.
#[derive(Clone, Debug)]
pub struct SealedRegistry {
    pub def: RegistryDef,
    /// `core` or the declaring canvas module.
    pub owner: String,
    pub planted: Vec<KitResult>,
    pub entries: Vec<SealedEntry>,
}

impl SealedRegistry {
    /// The entry named `name`, if a canvas module or the core filled it.
    pub fn entry(&self, name: &str) -> Option<&SealedEntry> {
        self.entries.iter().find(|e| e.name == name)
    }

    /// As `deep://registries` lists it, with `more` entries (a pack's) after its own.
    pub fn to_json(&self, more: &[SealedEntry]) -> Value {
        let mut row = self.def.contract(&self.owner);
        row.insert("kind".into(), json!("registry"));
        row.insert("name".into(), json!(self.def.name));
        row.insert("binds".into(), json!(self.def.binds));
        row.insert(
            "kit".into(),
            Value::Array(
                self.def
                    .kit
                    .iter()
                    .map(|k| json!({"rule": k.rule, "message": k.message}))
                    .collect(),
            ),
        );
        row.insert(
            "planted".into(),
            Value::Array(
                self.def
                    .planted
                    .iter()
                    .zip(&self.planted)
                    .map(|(p, r)| json!({"name": p.name, "value": p.value, "result": r.to_json()}))
                    .collect(),
            ),
        );
        row.insert("digest".into(), json!(self.def.digest()));
        row.insert(
            "entries".into(),
            Value::Array(
                self.entries
                    .iter()
                    .chain(more)
                    .map(SealedEntry::to_json)
                    .collect(),
            ),
        );
        Value::Object(row)
    }
}

/// An entry's digest: its name, registry, value and since, frozen per version.
pub fn entry_digest(registry: &str, name: &str, value: &Value, since: &str) -> String {
    d1(&json!({"name": name, "registry": registry, "value": value, "since": since}))
}

fn d1(v: &Value) -> String {
    crate::canon::revision_hash(v, &crate::canon::NoShape).unwrap_or_default()
}

/// Why `value` doesn't meet `schema`, a JSON Schema of the subset entry schemas use: `type`,
/// `properties`, `required`, `additionalProperties: false`, `minimum`, `maximum`, `enum` and
/// `items`.
pub fn schema_fault(schema: &Value, value: &Value, path: &str) -> Option<String> {
    let at = if path.is_empty() { "the entry" } else { path };
    if let Some(ty) = schema.get("type").and_then(Value::as_str) {
        let ok = match ty {
            "object" => value.is_object(),
            "array" => value.is_array(),
            "string" => value.is_string(),
            "boolean" => value.is_boolean(),
            "number" => value.is_number(),
            "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
            _ => true,
        };
        if !ok {
            return Some(format!("{at} is not {ty}: {value}"));
        }
    }
    if let Some(list) = schema.get("enum").and_then(Value::as_array) {
        if !list.contains(value) {
            return Some(format!(
                "{at} is {value}, not one of {}",
                Value::Array(list.clone())
            ));
        }
    }
    if let Some(n) = value.as_f64() {
        if let Some(min) = schema.get("minimum").and_then(Value::as_f64) {
            if n < min {
                return Some(format!("{at} is {value}, under its minimum {min}"));
            }
        }
        if let Some(max) = schema.get("maximum").and_then(Value::as_f64) {
            if n > max {
                return Some(format!("{at} is {value}, over its maximum {max}"));
            }
        }
    }
    if let (Some(items), Some(list)) = (schema.get("items"), value.as_array()) {
        for (i, v) in list.iter().enumerate() {
            if let Some(f) = schema_fault(items, v, &format!("{at}[{i}]")) {
                return Some(f);
            }
        }
    }
    if let Some(fields) = value.as_object() {
        let props = schema.get("properties").and_then(Value::as_object);
        for name in schema
            .get("required")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            if !fields.contains_key(name) {
                return Some(format!("{at} lacks `{name}`"));
            }
        }
        for (k, v) in fields {
            match props.and_then(|p| p.get(k)) {
                Some(s) => {
                    if let Some(f) = schema_fault(s, v, &format!("{at}.{k}")) {
                        return Some(f);
                    }
                }
                None if schema.get("additionalProperties") == Some(&Value::Bool(false)) => {
                    return Some(format!("{at} has `{k}`, which its schema doesn't define"));
                }
                None => {}
            }
        }
    }
    None
}

/// The kit that admits every entry: the planted wrong kit, for the proof that the seal refuses a
/// kit that can't fail.
pub fn admits_all(def: &mut RegistryDef) {
    for k in &mut def.kit {
        k.test = |_| Ok(());
    }
}

/// The entries a canvas module fills at the seal, by registry, as its digest holds them.
pub fn digest_part(own: &[&RegistryDef], entries: &[(&str, &str, String)]) -> Option<Value> {
    if own.is_empty() && entries.is_empty() {
        return None;
    }
    let mut registries: Vec<Value> = own
        .iter()
        .map(|r| {
            json!({"name": r.name, "digest": r.digest(), "fill": r.fill, "resolve": r.resolve,
                   "binds": r.binds, "since": r.since})
        })
        .collect();
    registries.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    let mut list: Vec<Value> = entries
        .iter()
        .map(|(registry, name, digest)| json!({"registry": registry, "name": name, "digest": digest}))
        .collect();
    list.sort_by(|a, b| {
        (a["registry"].as_str(), a["name"].as_str())
            .cmp(&(b["registry"].as_str(), b["name"].as_str()))
    });
    Some(json!({"registries": registries, "entries": list}))
}

/// An interner of entry names: lookups by a name's symbol, never by its text (Registry and seal:
/// registries: "a lookup O(1) by interned name").
#[derive(Debug, Default)]
pub struct Interner {
    symbols: BTreeMap<String, u32>,
}

impl Interner {
    /// The name's symbol, made on first sight.
    pub fn intern(&mut self, name: &str) -> u32 {
        let next = self.symbols.len() as u32;
        *self.symbols.entry(name.to_string()).or_insert(next)
    }

    /// The name's symbol, if it has one.
    pub fn get(&self, name: &str) -> Option<u32> {
        self.symbols.get(name).copied()
    }
}

/// The sealed registries and, per canvas module, what its digest holds of them.
type Sealing = (Vec<SealedRegistry>, BTreeMap<String, Value>);

/// The seal's registry checks (Registry and seal: registries): every registry the core and the
/// canvas modules declare is complete (a kit, a planted wrong entry and `since`) and its kit
/// refuses every planted entry; every entry a canvas module or the core fills is in a registry
/// the build declares, which the filler owns or the core declares, which modules may fill, under
/// a name no other entry holds, meeting the entry schema and passing the kit; and every step a
/// pass compiles from is in `gpu.step@1`. Returns the sealed registries and, per canvas module,
/// what its digest holds of them: the registries it declares and the entries it fills, never
/// another module's.
pub(super) fn seal(
    core: Vec<RegistryDef>,
    core_entries: Vec<EntryDef>,
    shapes: &[(String, super::Registrar)],
    admits: Option<&str>,
    fault: Option<super::Fault>,
) -> Result<Sealing, Box<super::SealError>> {
    use super::{Fault, SealError};
    let modules = || shapes.iter().filter(|(n, _)| n != super::CORE);
    let mut declared: Vec<(String, RegistryDef)> = core
        .into_iter()
        .map(|d| (super::CORE.to_string(), d))
        .chain(
            modules().flat_map(|(n, r)| r.registries.iter().map(move |d| (n.clone(), d.clone()))),
        )
        .collect();
    declared.sort_by(|a, b| a.1.name.cmp(&b.1.name));
    let mut sealed: BTreeMap<String, SealedRegistry> = BTreeMap::new();
    for (owner, mut def) in declared {
        let who: Vec<&str> = if owner == super::CORE {
            vec![]
        } else {
            vec![owner.as_str()]
        };
        if let Some(prior) = sealed.get(&def.name) {
            return Err(SealError::new(
                "duplicate_registry",
                &[&prior.owner, &owner],
                &[],
                format!(
                    "`{}` is declared twice: by `{}` and `{owner}`",
                    def.name, prior.owner
                ),
            )
            .at(&def.name, Vec::new(), &[]));
        }
        let mut missing = Vec::new();
        if def.kit.is_empty() {
            missing.push("a kit");
        }
        if def.planted.is_empty() {
            missing.push("a planted wrong entry");
        }
        if def.since.as_deref().is_none_or(str::is_empty) {
            missing.push("since");
        }
        if !def
            .name
            .rsplit_once('@')
            .is_some_and(|(_, m)| m.parse::<u32>().is_ok())
        {
            missing.push("a name@major");
        }
        if !missing.is_empty() {
            return Err(SealError::new(
                "registry_incomplete",
                &who,
                &[],
                format!("`{}` is declared without {}", def.name, missing.join(", ")),
            )
            .at(&def.name, Vec::new(), &[]));
        }
        if admits == Some(def.name.as_str()) {
            admits_all(&mut def);
        }
        let planted: Vec<KitResult> = def
            .planted
            .iter()
            .map(|p| def.run_kit(&p.name, &p.value))
            .collect();
        // Every planted entry the kit admits is named (#221: a registry with two).
        let admitted: Vec<&PlantedEntry> = def
            .planted
            .iter()
            .zip(&planted)
            .filter(|(_, r)| r.pass())
            .map(|(p, _)| p)
            .collect();
        if let Some(p) = admitted.first() {
            let rules: Vec<&str> = def.kit.iter().map(|k| k.rule).collect();
            return Err(SealError::new(
                "kit_admits_planted",
                &who,
                &[],
                format!(
                    "`{}`'s kit admits its planted wrong entry `{}` {}",
                    def.name, p.name, p.value
                ),
            )
            .at(
                &def.name,
                admitted
                    .iter()
                    .map(|p| json!({"name": p.name, "value": p.value}))
                    .collect(),
                &rules,
            ));
        }
        sealed.insert(
            def.name.clone(),
            SealedRegistry {
                def,
                owner,
                planted,
                entries: Vec::new(),
            },
        );
    }
    // Entries, the core's first, then each module's in name order.
    let fills = core_entries
        .into_iter()
        .map(|e| (super::CORE.to_string(), e))
        .chain(modules().flat_map(|(n, r)| r.entries.iter().map(move |e| (n.clone(), e.clone()))));
    let mut taken: BTreeMap<String, Vec<(String, String, String)>> = BTreeMap::new();
    for (filler, e) in fills {
        let who: Vec<&str> = if filler == super::CORE {
            vec![]
        } else {
            vec![filler.as_str()]
        };
        let name = json!(e.name);
        let Some(reg) = sealed.get_mut(&e.registry) else {
            // In the planted layout that declares `export.target@1` in the media module (#501),
            // the refusal names that module, which this build is without.
            let outside = (fault == Some(Fault::ExportTargetInMedia)
                && e.registry == "export.target@1")
                .then_some(super::EXPORT_TARGETS_OUTSIDE_CORE);
            let why = match outside {
                Some(owner) => format!("which `{owner}` declares and this build is without"),
                None => "which this build doesn't declare".to_string(),
            };
            let who: Vec<&str> = who.into_iter().chain(outside).collect();
            return Err(SealError::new(
                "unknown_registry",
                &who,
                &[],
                format!("`{filler}` fills `{}` into `{}`, {why}", e.name, e.registry),
            )
            .at(&e.registry, vec![name], &[]));
        };
        let mut digest_owner = filler.clone();
        if reg.owner != super::CORE && reg.owner != filler {
            if fault != Some(Fault::TakesForeignEntry) {
                return Err(SealError::new(
                    "foreign_entry",
                    &[&reg.owner, &filler],
                    &[],
                    format!(
                        "`{filler}` fills `{}` into `{}`, which `{}` declares; a registry more than one module fills is the core's",
                        e.name, e.registry, reg.owner
                    ),
                )
                .at(&e.registry, vec![name], &[]));
            }
            digest_owner = reg.owner.clone();
        }
        if filler != super::CORE && !reg.def.fill.contains(&"module") {
            return Err(SealError::new(
                "fill_refused",
                &who,
                &[],
                format!(
                    "`{}` is filled by {}, not by canvas modules",
                    e.registry,
                    reg.def.fill.join(", ")
                ),
            )
            .at(&e.registry, vec![name], &[]));
        }
        if let Some(prior) = reg.entries.iter().find(|x| x.name == e.name) {
            return Err(SealError::new(
                "duplicate_entry",
                &[&prior.module, &filler],
                &[],
                format!(
                    "`{}` has two entries named `{}`: `{}`'s and `{filler}`'s",
                    e.registry, e.name, prior.module
                ),
            )
            .at(&e.registry, vec![name], &[]));
        }
        if let Some(why) = schema_fault(&reg.def.entry, &e.value, "") {
            return Err(SealError::new(
                "entry_refused",
                &who,
                &[],
                format!(
                    "`{}` in `{}` doesn't meet its entry schema: {why}",
                    e.name, e.registry
                ),
            )
            .at(&e.registry, vec![name], &["entry_schema"]));
        }
        let kit = reg.def.run_kit(&e.name, &e.value);
        if !kit.pass() {
            let failed = kit.failed();
            let why: Vec<String> = kit
                .rules
                .iter()
                .filter(|r| !r.pass)
                .map(|r| format!("{}: {}", r.rule, r.why))
                .collect();
            let mut err = SealError::new(
                "entry_refused",
                &who,
                &[],
                format!(
                    "`{}` in `{}` fails its kit: {}",
                    e.name,
                    e.registry,
                    why.join("; ")
                ),
            )
            .at(&e.registry, vec![name], &failed);
            if let Some(r) = err.registry.as_mut() {
                let reports = kit.rules.iter().filter(|r| !r.pass);
                r.report = reports
                    .filter_map(|r| r.report.clone()?.as_object().cloned())
                    .flatten()
                    .collect();
            }
            return Err(err);
        }
        let twin = reg.def.twin.map(|t| t(&e.name, &e.value));
        let digest = entry_digest(&e.registry, &e.name, &e.value, &e.since);
        taken.entry(digest_owner).or_default().push((
            e.registry.clone(),
            e.name.clone(),
            digest.clone(),
        ));
        reg.entries.push(SealedEntry {
            name: e.name,
            registry: e.registry,
            origin: "first_party",
            module: filler,
            pack: String::new(),
            value: e.value,
            since: e.since,
            digest,
            kit,
            twin,
        });
    }
    // Every step a pass compiles from resolves in `gpu.step@1`.
    let steps = sealed.get("gpu.step@1");
    for (module, r) in modules() {
        for p in &r.passes {
            if let Some(step) = p
                .steps
                .iter()
                .find(|s| steps.is_none_or(|g| g.entry(s).is_none()))
            {
                let mut err = SealError::new(
                    "step_unresolved",
                    &[module],
                    &[],
                    format!("pass `{}` of `{module}` compiles from `{step}`, which no entry of gpu.step@1 in this build fills", p.name),
                )
                .at("gpu.step@1", vec![json!(step)], &[]);
                if let Some(r) = err.registry.as_mut() {
                    r.passes = vec![p.name.clone()];
                }
                return Err(err);
            }
        }
    }
    // What each module's digest holds: the registries it declares and the entries it fills,
    // never another module's (the planted seal hashes a core registry's every entry into each
    // of its fillers' digests).
    let mut parts = BTreeMap::new();
    for (module, r) in modules() {
        let mut own: Vec<(&str, &str, String)> = taken
            .get(module)
            .into_iter()
            .flatten()
            .map(|(reg, n, d)| (reg.as_str(), n.as_str(), d.clone()))
            .collect();
        if fault == Some(Fault::HashesEveryEntry) {
            let filled: Vec<&str> = own.iter().map(|(reg, _, _)| *reg).collect();
            for reg in sealed
                .values()
                .filter(|x| x.owner == super::CORE && filled.contains(&x.def.name.as_str()))
            {
                for e in reg.entries.iter().filter(|e| e.module != *module) {
                    own.push((&e.registry, &e.name, e.digest.clone()));
                }
            }
        }
        let regs: Vec<&RegistryDef> = r.registries.iter().collect();
        if let Some(part) = digest_part(&regs, &own) {
            parts.insert(module.clone(), part);
        }
    }
    Ok((sealed.into_values().collect(), parts))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small(v: &Value) -> Result<(), String> {
        match v["size"].as_u64() {
            Some(s) if s > 64 => Err(format!("size {s} is over 64")),
            _ => Ok(()),
        }
    }

    fn even(v: &Value) -> Result<(), String> {
        match v["size"].as_u64() {
            Some(s) if s % 2 == 1 => Err(format!("size {s} is odd")),
            _ => Ok(()),
        }
    }

    #[test]
    fn a_kit_names_the_rules_an_entry_breaks() {
        let kit = [
            KitRule {
                rule: "small",
                message: "a size over 64",
                test: small,
                report: None,
            },
            KitRule {
                rule: "even",
                message: "an odd size",
                test: even,
                report: None,
            },
        ];
        let r = run_kit(&kit, "odd", &json!({"size": 65}));
        assert!(!r.pass());
        assert_eq!(r.failed(), ["small", "even"]);
        assert!(run_kit(&kit, "fine", &json!({"size": 8})).pass());
        let j = r.to_json();
        assert_eq!(j["entry"], "odd");
        assert_eq!(j["rules"][0]["message"], "a size over 64");
    }

    #[test]
    fn a_rule_is_isolated_only_by_an_entry_that_breaks_it_alone() {
        let def = RegistryDef::new("t@1", json!({}), &["module"], "R2")
            .rule("small", "a size over 64", small)
            .rule("even", "an odd size", even)
            .planted("odd", json!({"size": 65}));
        assert_eq!(unisolated(&def), ["small", "even"]);
        let def = def
            .planted("big", json!({"size": 66}))
            .planted("seven", json!({"size": 7}));
        assert!(unisolated(&def).is_empty());
    }

    #[test]
    fn the_schema_subset_refuses_what_it_should() {
        let s = json!({"type": "object", "properties": {"name": {"type": "string"}, "size": {"type": "integer", "minimum": 0, "maximum": 4294967295u64}}, "required": ["name", "size"], "additionalProperties": false});
        assert_eq!(
            schema_fault(&s, &json!({"name": "dot", "size": 8}), ""),
            None
        );
        assert!(schema_fault(&s, &json!({"name": "dot"}), "").is_some());
        assert!(schema_fault(&s, &json!({"name": "dot", "size": -1}), "").is_some());
        assert!(schema_fault(&s, &json!({"name": "dot", "size": 4294967296u64}), "").is_some());
        assert!(schema_fault(&s, &json!({"name": "dot", "size": 1, "x": 0}), "").is_some());
        assert!(schema_fault(&s, &json!({"name": 3, "size": 1}), "").is_some());
    }

    #[test]
    fn interned_names_keep_their_symbols() {
        let mut i = Interner::default();
        let a = i.intern("a.ring");
        let b = i.intern("b.ring");
        assert_ne!(a, b);
        assert_eq!(i.intern("a.ring"), a);
        assert_eq!(i.get("b.ring"), Some(b));
        assert_eq!(i.get("c"), None);
    }
}
