//! Issue #238: the sandbox module in the app (canvas primitives: Logic: sandbox). It admits and
//! runs the programs packs carry, only at check and never in a frame: a layout's validator on each
//! of its twins and each program entry's rewrite at the pack check, and a provider at a document's
//! check, once per content key; and a data asset's layout's validator, once per asset hash and
//! validator hash (#415). The counts it keeps are the proof that a document naming no program
//! costs it nothing, a provider runs once and an asset past its cap never reaches its validator.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use deep_canvas::document::{Issue, Pack, PackId};
use deep_canvas::registry::lists::{entry_digest, SealedEntry};
use deep_canvas::registry::Sealed;
use deep_canvas_sandbox::check::Refusal;
use deep_canvas_sandbox::layouts::{self, Planted, PACK_MAX_BYTES};
use deep_canvas_sandbox::rewrite::{hash, Rewritten};
use deep_sandbox_wasmtime::service::{
    provider_budget, refusals_json, trap_json, Budget, Offsets, Ran, Sandbox,
};
use serde_json::{json, Map, Value};

use providers::{pack_runs, PROVIDER_KEYS};

mod providers;

/// How long a check-time run may take before it is stopped as one that never ends.
const DEADLINE: Duration = Duration::from_secs(60);

/// The sandbox module's work in this process.
#[derive(Default)]
pub struct Host {
    sandbox: Sandbox,
    pub checks: u64,
    pub links: u64,
    pub rewrites: u64,
    pub runs: u64,
    /// Each program's check and rewrite, by its sha256 and role: once per program.
    rewritten: BTreeMap<(String, String), Result<Rewritten, Vec<Refusal>>>,
    /// Each provider's output, by its content key: once per key.
    outputs: BTreeMap<String, Made>,
    /// The providers each document's current revision ran or took by content key.
    pub provided: BTreeMap<String, Vec<Value>>,
    /// Each admitted pack's manifest, with its assets' bytes, by `owner/name@version`.
    packs: BTreeMap<String, Value>,
    /// Each program entry's `{asset, role, hash}`, by registry and entry.
    pub programs: BTreeMap<(String, String), Value>,
    /// Each data asset's verdict, by its sha256 and its validator's: once per pair.
    validated: BTreeMap<(String, String), Value>,
    /// A planted wrong first-party layout (#415).
    planted: Planted,
    /// Each admitted pack's layouts as `data.layout@1` entries, origin `pack` (#415), and its
    /// synth presets as `synth.preset@1` entries (#204).
    pub layout_entries: Vec<SealedEntry>,
    /// #192: the folder outputs are kept in across processes by content key (`--cache`), the
    /// evidence store a provider's data asset is kept in by hash, and a planted content key.
    cache: Option<PathBuf>,
    evidence: PathBuf,
    /// Each refused pack's refusal, by `owner/name@version`: a document naming its provider fails.
    refused: BTreeMap<String, Vec<Value>>,
    /// Each pack version whose providers passed its check, by its manifest's hash.
    vetted: std::collections::BTreeSet<String>,
    key_planted: Option<String>,
}

/// One provider run's result (Provider `gen@1`): its trap (or null), its output (null after a
/// trap), geometry.shading's counts on a mesh, and the run's own time.
#[derive(Clone, Default)]
pub struct Made {
    pub trap: Value,
    pub out: Value,
    pub shading: Value,
    pub ms: f64,
}

/// #192's planted content keys: one leaving out the params, one naming the logic module's version.
pub const PLANTED: &[&str] = &["provider_key_omits_params", "provider_key_names_logic"];

/// An asset's bytes, from the hex the pack loader read it into.
fn asset(manifest: &Value, sha: &str) -> Option<Vec<u8>> {
    let hex = manifest
        .get("assets")?
        .as_array()?
        .iter()
        .find(|a| a.get("sha256").and_then(Value::as_str) == Some(sha))?
        .get("hex")?
        .as_str()?;
    (0..hex.len() / 2)
        .map(|i| u8::from_str_radix(&hex[2 * i..2 * i + 2], 16).ok())
        .collect()
}

fn refusals_what(r: &[Refusal]) -> String {
    r.iter()
        .map(|r| r.what.clone())
        .collect::<Vec<_>>()
        .join("; ")
}

impl Host {
    pub fn new(startup: &crate::hub::Startup, scenario: &crate::hub::Scenario) -> Host {
        Host {
            planted: startup.layouts,
            cache: startup.cache.clone(),
            evidence: scenario.evidence.clone(),
            key_planted: scenario
                .module_planted
                .clone()
                .filter(|p| PLANTED.contains(&p.as_str())),
            ..Host::default()
        }
    }

    /// The check and the rewrite of one program in a role, once per program.
    fn rewrite(&mut self, sha: &str, bytes: &[u8], role: &str) -> Result<Rewritten, Vec<Refusal>> {
        self.rewrite_in(sha, bytes, role, &Budget::of(role, None, 0))
    }

    /// `rewrite` under a budget whose memory a program's must fit (#192), once per program and
    /// memory budget.
    fn rewrite_in(
        &mut self,
        sha: &str,
        bytes: &[u8],
        role: &str,
        budget: &Budget,
    ) -> Result<Rewritten, Vec<Refusal>> {
        let key = (sha.to_string(), format!("{role}/{}", budget.memory));
        if let Some(r) = self.rewritten.get(&key) {
            return r.clone();
        }
        self.checks += 1;
        let out = match self.sandbox.rewrite(bytes, role, &budget) {
            Ok((rw, _)) => {
                self.rewrites += 1;
                Ok(rw)
            }
            Err(Ok(r)) => Err(r),
            Err(Err(e)) => Err(vec![Refusal {
                rule: "rewrite",
                what: e,
                ..Refusal::default()
            }]),
        };
        self.rewritten.insert(key, out.clone());
        out
    }

    fn run(
        &mut self,
        rw: &Rewritten,
        role: &str,
        seed: i64,
        budget: &Budget,
        input: &[u8],
    ) -> Result<Ran, String> {
        self.runs += 1;
        self.sandbox.run(
            &rw.bytes,
            role,
            seed,
            budget,
            &[],
            input,
            DEADLINE,
            Offsets::Written,
        )
    }

    /// The half of a pack's check that runs its programs, after the core's half admitted it: each
    /// layout's validator on each of its twins, which it must refuse, and each program entry's
    /// rewrite. Returns the layouts' rows and the issues that refuse the pack.
    pub fn vet(
        &mut self,
        manifest: &Value,
        pack: &Pack,
        sealed: &Sealed,
    ) -> (Vec<Value>, Vec<Issue>) {
        let mut rows = Vec::new();
        let mut issues = Vec::new();
        let mut entries = Vec::new();
        let layouts = manifest
            .get("layouts")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        for (name, layout) in &layouts {
            let path = format!("layouts/{name}");
            let refuse = |actual: Value, what: String| {
                Issue::envelope("out_of_range", path.clone(), actual, &what)
            };
            let sha = layout
                .get("validator")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let Some(bytes) = asset(manifest, sha) else {
                issues.push(refuse(
                    json!({"layout": name, "validator": sha}),
                    format!("`{name}`'s validator `{sha}` is none of the pack's assets"),
                ));
                continue;
            };
            let rw = match self.rewrite(sha, &bytes, "validator") {
                Ok(rw) => rw,
                Err(r) => {
                    issues.push(refuse(
                        json!({"layout": name, "validator": sha}),
                        format!("`{name}`'s validator is refused: {}", refusals_what(&r)),
                    ));
                    continue;
                }
            };
            let max = layout
                .get("max_bytes")
                .and_then(Value::as_u64)
                .unwrap_or(u64::MAX);
            if max > PACK_MAX_BYTES {
                issues.push(refuse(
                    json!({"layout": name, "max_bytes": max}),
                    format!("`{name}`'s max_bytes {max} is past a pack layout's {PACK_MAX_BYTES}"),
                ));
            }
            let twins: Vec<String> = layout
                .get("twins")
                .and_then(Value::as_array)
                .map(|t| {
                    t.iter()
                        .filter_map(Value::as_str)
                        .map(String::from)
                        .collect()
                })
                .unwrap_or_default();
            if twins.is_empty() {
                issues.push(refuse(
                    json!({"layout": name}),
                    format!("`{name}` ships no malformed twin for its validator to refuse"),
                ));
            }
            let mut judged = Vec::new();
            let mut admitted = !twins.is_empty();
            for twin in &twins {
                let Some(input) = asset(manifest, twin) else {
                    issues.push(refuse(
                        json!({"layout": name, "twin": twin}),
                        format!("`{name}`'s twin `{twin}` is none of the pack's assets"),
                    ));
                    admitted = false;
                    continue;
                };
                if input.len() as u64 > max {
                    judged.push(json!({"asset": twin, "valid": false, "offset": null}));
                    continue;
                }
                let budget = Budget::of("validator", None, input.len());
                match self.run(&rw, "validator", 0, &budget, &input) {
                    Ok(Ran { trap: Some(t), .. }) => {
                        judged.push(json!({"asset": twin, "valid": false, "offset": null, "trap": trap_json(&Some(t))}));
                    }
                    Ok(r) => {
                        let valid = r.result == Some(-1);
                        judged.push(json!({"asset": twin, "valid": valid, "offset": if valid { None } else { r.result }}));
                        if valid {
                            admitted = false;
                            issues.push(refuse(
                                json!({"layout": name, "twin": twin}),
                                format!(
                                    "`{name}`'s validator accepts its own malformed twin `{twin}`"
                                ),
                            ));
                        }
                    }
                    Err(e) => {
                        admitted = false;
                        issues.push(refuse(
                            json!({"layout": name, "twin": twin}),
                            format!("`{name}`'s validator didn't run on `{twin}`: {e}"),
                        ));
                    }
                }
            }
            // The core's `data.layout@1` kit is the gate: every twin refused, a doc of at most
            // 2,000 characters (Logic: data layouts).
            if let Some(reg) = sealed.registry("data.layout@1") {
                let mut entry = layout.clone();
                entry["judged"] = json!(judged);
                let kit = reg.def.run_kit(name, &entry);
                let unnamed: Vec<&str> = kit
                    .failed()
                    .into_iter()
                    .filter(|r| *r != "refuses_its_twins")
                    .collect();
                if !unnamed.is_empty() {
                    admitted = false;
                    issues.push(refuse(
                        json!({"layout": name, "rules": unnamed}),
                        format!("`{name}` fails data.layout@1's kit: {}", unnamed.join(", ")),
                    ));
                }
                let since = "R6".to_string();
                entries.push(SealedEntry {
                    name: name.clone(),
                    registry: reg.def.name.clone(),
                    origin: "pack",
                    module: String::new(),
                    pack: pack.id.text(),
                    digest: entry_digest(&reg.def.name, name, &entry, &since),
                    value: entry,
                    since,
                    kit,
                    twin: None,
                });
            }
            rows.push(json!({"name": name, "state": if admitted { "admitted" } else { "refused" }, "twins": judged}));
        }
        // #204: each preset in the pack's `presets` is an entry of `synth.preset@1`, named as a
        // document names it, `<pack>.<name>@<major>`; the media module's field check admitted it.
        if let Some(reg) = sealed.registry(deep_canvas_media::synth::REGISTRY) {
            let pack_name = manifest["name"].as_str().unwrap_or_default();
            for (key, preset) in manifest["presets"].as_object().into_iter().flatten() {
                let name = format!("{pack_name}.{key}");
                let since = "R6".to_string();
                entries.push(SealedEntry {
                    kit: reg.def.run_kit(&name, preset),
                    registry: reg.def.name.clone(),
                    origin: "pack",
                    module: String::new(),
                    pack: pack.id.text(),
                    digest: entry_digest(&reg.def.name, &name, preset, &since),
                    value: preset.clone(),
                    name,
                    since,
                    twin: None,
                });
            }
        }
        for e in &pack.entries {
            let Some(role) = sealed.registry(&e.registry).and_then(|r| r.def.program) else {
                continue;
            };
            let sha = e
                .value
                .get("program")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let Some(bytes) = asset(manifest, sha) else {
                continue;
            };
            match self.rewrite(sha, &bytes, role) {
                Ok(rw) => {
                    self.programs.insert(
                        (e.registry.clone(), e.name.clone()),
                        json!({"asset": sha, "role": role, "hash": rw.hash}),
                    );
                }
                Err(r) => issues.push(Issue::envelope(
                    "out_of_range",
                    format!("entries/{}", e.registry),
                    json!({"registry": e.registry, "entry": e.name}),
                    &format!("`{}`'s program is refused: {}", e.name, refusals_what(&r)),
                )),
            }
        }
        // #192: each provider's fields, then its runs at its params' range ends and fixed seeds,
        // with the pack's own layouts in reach.
        if issues.is_empty() {
            self.packs.insert(pack.id.text(), manifest.clone());
            issues.extend(self.vet_providers(manifest, sealed));
        }
        if issues.is_empty() {
            self.layout_entries.extend(entries);
        } else {
            self.packs.remove(&pack.id.text());
            let refusal = issues.iter().map(Issue::to_json).collect();
            self.refused.insert(pack.id.text(), refusal);
        }
        (rows, issues)
    }

    /// A pack's providers at its check (Provider `gen@1`): each entry holds only a provider's
    /// fields, so none registers a check kind, a builder, an operator or a tool entry; its budget
    /// within its ceilings; and it runs with no trap, no over_cap and no mesh defect (a
    /// geometry.shading count but open edges, which a declared closed mesh fails at a document's
    /// check) at the defaults with each fixed seed, and at each numeric param's declared minimum
    /// and maximum.
    /// A refusal names the provider, and the field, or the param and the value.
    fn vet_providers(&mut self, manifest: &Value, sealed: &Sealed) -> Vec<Issue> {
        let mut issues = Vec::new();
        // Checked once per pack version, as a recipe is.
        let version = hash(manifest.to_string().as_bytes());
        if self.vetted.contains(&version) {
            return issues;
        }
        // The pack's libraries (#190), checked as the logic module checks a pack's: each under
        // the one subset, then its fixtures; a library whose fixtures haven't run never links.
        if manifest.get("libs").is_some() {
            if let Err(refusals) = self.vet_libs(manifest) {
                issues.push(Issue::envelope(
                    "out_of_range",
                    "libs".into(),
                    json!({"refusals": refusals}),
                    "the pack's libraries fail their check",
                ));
                return issues;
            }
        }
        let pack_name = manifest["name"].as_str().unwrap_or_default().to_string();
        let providers = manifest["providers"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        for (name, spec) in &providers {
            let gen = format!("{pack_name}.{name}");
            let refuse = |field: &str, actual: Value, what: String| {
                Issue::envelope(
                    "out_of_range",
                    format!("providers/{name}/{field}"),
                    actual,
                    &what,
                )
            };
            let Some(fields) = spec.as_object() else {
                issues.push(refuse(
                    "",
                    spec.clone(),
                    format!("provider `{gen}` is not an object"),
                ));
                continue;
            };
            if let Some(key) = fields.keys().find(|k| !PROVIDER_KEYS.contains(&k.as_str())) {
                issues.push(refuse(
                    key,
                    json!({"provider": gen, "entry": key}),
                    format!("provider `{gen}` names `{key}`, which no provider holds: a provider never registers a check kind, a builder, an operator or a tool entry"),
                ));
                continue;
            }
            if let Err((field, why)) = provider_budget(spec.get("budget")) {
                issues.push(refuse(
                    &field,
                    json!({"provider": gen, "field": field}),
                    format!("provider `{gen}`'s {field} is refused: {why}"),
                ));
                continue;
            }
            if let Err((field, why)) = providers::out_ok(spec.get("out")) {
                issues.push(refuse(
                    &field,
                    json!({"provider": gen, "field": field}),
                    format!("provider `{gen}`'s {field} is refused: {why}"),
                ));
                continue;
            }
            if let Err((field, actual, what)) = self.vet_library(manifest, &gen, spec) {
                issues.push(refuse(&field, actual, what));
                continue;
            }
            for (param, value, seed) in pack_runs(spec) {
                let given: Map<String, Value> =
                    param.iter().map(|p| (p.clone(), value.clone())).collect();
                let made = self.make(sealed, manifest, spec, &given, seed, &[]);
                // A declared closed mesh's open edge is the document check's to name; an open
                // mesh is no defect.
                let trap = match made.trap["kind"].as_str() {
                    Some("open_edge") => continue,
                    Some(_) => made.trap,
                    None => match providers::defect(&made.shading) {
                        Some(d) => json!({"kind": d, "shading": made.shading}),
                        None => continue,
                    },
                };
                let at = param
                    .as_ref()
                    .map(|p| format!("at param `{p}` = {value}"))
                    .unwrap_or_else(|| format!("at its defaults with seed {seed}"));
                // At a range end, the issue names the param; at a seed, the provider.
                let field = param.as_ref().map(|p| format!("params/{p}"));
                issues.push(Issue::envelope(
                    "out_of_range",
                    field.map_or(format!("providers/{name}"), |f| format!("providers/{name}/{f}")),
                    json!({"provider": gen, "param": param, "value": value, "seed": seed, "trap": trap}),
                    &format!("provider `{gen}` fails its pack check {at}: {}", trap["kind"].as_str().unwrap_or("trap")),
                ));
                break;
            }
        }
        if issues.is_empty() {
            self.vetted.insert(version);
        }
        issues
    }

    /// The pack's libraries through the logic module's own pack check (#190), each library's bytes
    /// then kept in the evidence store, where a logic item's link reads them.
    fn vet_libs(&mut self, manifest: &Value) -> Result<(), Value> {
        let mut assets = Map::new();
        for lib in manifest["libs"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(_, l)| l)
        {
            for sha in [&lib["asset"]]
                .into_iter()
                .chain(lib["fixtures"].as_array().into_iter().flatten())
            {
                let Some(bytes) = sha.as_str().and_then(|sha| asset(manifest, sha)) else {
                    continue;
                };
                let b64 = crate::capture::base64(&bytes);
                assets.insert(sha.as_str().unwrap_or_default().into(), json!(b64));
                let _ = self.put(&bytes);
            }
        }
        let pack = json!({"name": manifest["name"], "version": manifest["version"], "libs": manifest["libs"]});
        let reply = deep_logic::Logic::new(Default::default())
            .handle(&json!({"call": "pack_check", "pack": pack, "assets": assets}));
        match reply["ok"].as_bool() {
            Some(true) => Ok(()),
            _ => Err(reply.get("refusals").cloned().unwrap_or(reply)),
        }
    }

    /// A provider's links and its library form at its pack's check (Provider `gen@1`: links, the
    /// library form): each link a library the pack carries at that hash; the library form's
    /// equality fixture, the provider form run with its seed and params giving its `expect`, and
    /// the library form, linked into a driver and run until its shares are done, giving the same
    /// bytes. A refusal is `(field, actual, what)`, naming the provider and the library, the
    /// expected hash or the first byte that differs.
    fn vet_library(
        &mut self,
        manifest: &Value,
        gen: &str,
        spec: &Value,
    ) -> Result<(), (String, Value, String)> {
        for link in spec["links"].as_array().into_iter().flatten() {
            let name = link["name"].as_str().unwrap_or_default();
            if manifest.pointer(&format!("/libs/{name}/asset")) != Some(&link["asset"]) {
                return Err((
                    "links".into(),
                    json!({"provider": gen, "library": name}),
                    format!(
                        "provider `{gen}` links {name}, which its pack doesn't carry at {}",
                        link["asset"]
                    ),
                ));
            }
        }
        let Some(lib) = spec.get("library") else {
            return Ok(());
        };
        let fixture = &lib["fixture"];
        let given = fixture["params"].as_object().cloned().unwrap_or_default();
        let seed = fixture["seed"].as_i64().unwrap_or(0);
        let refuse = |actual: Value, what: String| Err(("library".into(), actual, what));
        let (Some(program), Some(form)) = (
            spec["program"]
                .as_str()
                .and_then(|sha| asset(manifest, sha)),
            lib["asset"].as_str().and_then(|sha| asset(manifest, sha)),
        ) else {
            return refuse(
                json!({"provider": gen}),
                format!("provider `{gen}`'s program or library form is none of its pack's assets"),
            );
        };
        let assets: Vec<Vec<u8>> = spec["assets"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|a| asset(manifest, a.as_str()?))
            .collect();
        let run = |sandbox: &Sandbox, bytes: &[u8]| match sandbox
            .provide(bytes, spec, &given, seed, &assets)
        {
            Ok(Ok(out)) => Ok(out),
            Ok(Err(trap)) => Err(json!({"trap": trap})),
            Err(e) => Err(e),
        };
        self.runs += 1;
        let made = match run(&self.sandbox, &program) {
            Ok(b) => b,
            Err(e) => {
                return refuse(
                    json!({"provider": gen, "form": "provider", "failed": e}),
                    format!("provider `{gen}` fails its equality fixture's run"),
                )
            }
        };
        if Some(hash(&made).as_str()) != fixture["expect"].as_str() {
            return refuse(
                json!({"provider": gen, "expect": fixture["expect"], "actual": hash(&made)}),
                format!("provider `{gen}`'s output for its fixture isn't its expect"),
            );
        }
        let version = manifest["version"].as_str().unwrap_or_default();
        let cap = spec
            .pointer("/out/data/max_bytes")
            .and_then(Value::as_u64)
            .unwrap_or(16 << 20);
        let exports = ["gen".to_string()];
        let object = deep_canvas_sandbox::link::Object {
            name: gen,
            label: &format!("{gen}@{version}"),
            bytes: &form,
            exports: &exports,
        };
        let linked =
            match deep_canvas_sandbox::link::link(&providers::driver(gen, cap), &[object], false) {
                Ok(l) => l,
                Err(r) => {
                    return refuse(
                        json!({"provider": gen, "refusals": refusals_json(&r)}),
                        format!("provider `{gen}`'s library form doesn't link"),
                    )
                }
            };
        self.runs += 1;
        let played = match run(&self.sandbox, &linked.bytes) {
            Ok(b) => b,
            Err(e) => {
                return refuse(
                    json!({"provider": gen, "form": "library", "failed": e}),
                    format!("provider `{gen}`'s library form fails its equality fixture's run"),
                )
            }
        };
        if let Some(offset) = providers::first_diff(&made, &played) {
            return refuse(json!({"provider": gen, "offset": offset}),
                format!("provider `{gen}`'s library form gives other bytes than its provider form, first at byte {offset}"));
        }
        let _ = self.put(&form);
        Ok(())
    }

    /// The check-time validation of one data asset (Logic: data layouts): its layout resolved
    /// through `data.layout@1`, a first-party entry or an installed pack's; an asset past the
    /// layout's `max_bytes` refused before its validator runs; else the validator run once per
    /// asset hash and validator hash, its refusal naming the offset and, for a first-party layout,
    /// the field its doc gives that offset, or its trap.
    pub fn validate(&mut self, sealed: &Sealed, layout: &str, path: &std::path::Path) -> Value {
        match std::fs::read(path) {
            Ok(input) => self.validate_bytes(sealed, layout, &input),
            Err(_) => {
                json!({"ok": false, "code": "bad_input", "what": format!("`{}` can't be read", path.display())})
            }
        }
    }

    /// `validate` on bytes at hand, such as a provider's output.
    pub fn validate_bytes(&mut self, sealed: &Sealed, layout: &str, input: &[u8]) -> Value {
        let first = sealed
            .registry("data.layout@1")
            .and_then(|r| r.entry(layout))
            .and_then(|_| layouts::named(layout));
        let (program, max_bytes, field) = match &first {
            Some(l) => (
                deep_sandbox_wasmtime::layouts::program(l, self.planted),
                l.cap(self.planted),
                Some(l.field),
            ),
            None => match self.pack_layout(layout) {
                Some((bytes, max)) => (bytes, max, None),
                None => {
                    return json!({"ok": false, "code": "unknown_layout", "layout": layout,
                                  "what": format!("`{layout}` is no entry of data.layout@1 nor a layout of an installed pack")})
                }
            },
        };
        let asset = hash(input);
        let mut out = json!({"layout": layout, "asset": asset, "size": input.len(), "max_bytes": max_bytes,
                             "outcome": "refused", "code": null, "offset": null, "field": null, "trap": null});
        if input.len() as u64 > max_bytes {
            out["code"] = json!("over_cap");
            return out;
        }
        let sha = hash(&program);
        let key = (asset, sha.clone());
        if let Some(v) = self.validated.get(&key) {
            return v.clone();
        }
        match self.rewrite(&sha, &program, "validator") {
            Err(r) => {
                out["code"] = json!("validator_refused");
                out["what"] = json!(refusals_what(&r));
            }
            Ok(rw) => match self.run(
                &rw,
                "validator",
                0,
                &Budget::of("validator", None, input.len()),
                input,
            ) {
                Ok(Ran { trap: Some(t), .. }) => {
                    out["code"] = json!("layout_trap");
                    out["trap"] = trap_json(&Some(t));
                }
                Ok(Ran {
                    result: Some(-1), ..
                }) => {
                    out["outcome"] = json!("admitted");
                }
                Ok(Ran {
                    result: Some(o), ..
                }) => {
                    out["code"] = json!("layout_refused");
                    out["offset"] = json!(o);
                    out["field"] = json!(field.map(|f| f(input, o.max(0) as u64)));
                }
                Ok(_) => out["code"] = json!("layout_refused"),
                Err(e) => {
                    out["code"] = json!("run_failed");
                    out["what"] = json!(e);
                }
            },
        }
        self.validated.insert(key, out.clone());
        out
    }

    /// An installed pack's layout by the name its `layouts` key gives: its validator's bytes and
    /// its cap.
    fn pack_layout(&self, layout: &str) -> Option<(Vec<u8>, u64)> {
        self.packs.values().find_map(|manifest| {
            let spec = manifest.get("layouts")?.get(layout)?;
            let bytes = asset(manifest, spec.get("validator")?.as_str()?)?;
            Some((bytes, spec.get("max_bytes")?.as_u64()?))
        })
    }

    /// A document's providers, at its check: each param that names `{gen: <pack>.<provider>}`
    /// of a pack the document pins takes the provider's output by its content key, running it
    /// only for a key it hasn't made, here or in the `--cache` folder. A param of it bound to time,
    /// a channel, a control, a reading or a logic array is refused, naming the param; a trap is an
    /// error naming the provider, the item and the kind, and keeps no output (#192).
    pub fn provide(&mut self, sealed: &Sealed, doc_id: &str, doc: &Value) -> Vec<Issue> {
        let mut issues = Vec::new();
        let mut provided = Vec::new();
        let pinned: Vec<String> = doc["packs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(String::from)
            .collect();
        let doc_seed = doc.get("seed").and_then(Value::as_i64).unwrap_or(0);
        let items = doc["items"].as_object().cloned().unwrap_or_default();
        for (id, item) in &items {
            for (at, value) in providers::uses(item) {
                let Some(gen) = value.get("gen").and_then(Value::as_str) else {
                    continue;
                };
                let Some((pack_name, provider)) = gen.split_once('.') else {
                    continue;
                };
                let path = format!("items/{id}/params/{at}");
                let named = || {
                    pinned
                        .iter()
                        .filter(|p| PackId::parse(p).is_some_and(|id| id.name == pack_name))
                };
                let Some(manifest) = named().find_map(|p| self.packs.get(p)).cloned() else {
                    // A provider of a pack its check refused fails the document, with that refusal.
                    if let Some((pack, refusal)) =
                        named().find_map(|p| self.refused.get(p).map(|r| (p, r)))
                    {
                        issues.push(Issue::envelope(
                            "provider_refused",
                            path,
                            json!({"provider": gen, "item": id, "pack": pack, "refusal": refusal}),
                            &format!("provider `{gen}` of item `{id}` is in pack {pack}, which its check refused"),
                        ));
                        provided.push(json!({"item": id, "provider": gen, "key": null, "trap": null, "out": null}));
                    }
                    continue;
                };
                let Some(spec) = manifest.pointer(&format!("/providers/{provider}")).cloned()
                else {
                    continue;
                };
                let given = value["params"].as_object().cloned().unwrap_or_default();
                let bound = providers::bound(doc, &path, &given);
                if !bound.is_empty() {
                    for name in &bound {
                        issues.push(Issue::envelope(
                            "provider_param_bound",
                            format!("{path}/params/{name}"),
                            json!({"provider": gen, "item": id, "param": name}),
                            &format!("provider `{gen}`'s param `{name}` of item `{id}` is bound; a provider reads only constants"),
                        ));
                    }
                    provided.push(json!({"item": id, "provider": gen, "key": null, "trap": null, "out": null}));
                    continue;
                }
                // Another item's built mesh, by its content key (Provider `gen@1`: meshes).
                let keys = match providers::mesh_in(doc, &value) {
                    Ok(m) => m,
                    Err((target, why)) => {
                        let mut issue = Issue::envelope(
                            "provider_mesh_in",
                            path,
                            json!({"provider": gen, "item": target, "of": id}),
                            &format!("provider `{gen}` of item `{id}` can't take `{target}`'s mesh: {why}"),
                        );
                        issue.ids = vec![target];
                        issues.push(issue);
                        provided.push(json!({"item": id, "provider": gen, "key": null, "trap": null, "out": null}));
                        continue;
                    }
                };
                let seed = value
                    .get("seed")
                    .and_then(Value::as_i64)
                    .unwrap_or(doc_seed);
                let key = self.key_of(sealed, &spec, &given, seed, &keys);
                let (made, ms) = match self.take(&key) {
                    Some(m) => (m, None),
                    None => {
                        let m = match providers::meshes(doc, &value) {
                            Ok(meshes) => {
                                self.make(sealed, &manifest, &spec, &given, seed, &meshes)
                            }
                            Err(e) => Made {
                                trap: json!({"kind": "mesh_in", "what": e}),
                                ..Made::default()
                            },
                        };
                        self.keep(&key, &m);
                        let ms = m.ms;
                        (m, Some(ms))
                    }
                };
                if let (Some(layout), Some(kind)) =
                    (made.trap.get("layout"), made.trap["kind"].as_str())
                {
                    // #415: the output refused by its layout, naming the asset, the layout and the
                    // offset or the trap.
                    let code = match kind {
                        "over_cap" => "over_cap",
                        "layout_trap" => "layout_trap",
                        _ => "layout_refused",
                    };
                    let t = &made.trap;
                    issues.push(Issue::envelope(
                        code,
                        path,
                        json!({"provider": gen, "item": id, "layout": layout, "asset": t["asset"],
                               "offset": t["offset"], "field": t["field"], "trap": t["trap"]}),
                        &format!("provider `{gen}` of item `{id}` wrote an asset its layout {layout} refuses ({kind})"),
                    ));
                } else if let Some(kind) = made.trap["kind"].as_str() {
                    issues.push(Issue::envelope(
                        "provider_trap",
                        path,
                        json!({"provider": gen, "item": id, "trap": made.trap}),
                        &format!("provider `{gen}` of item `{id}` trapped with kind {kind}"),
                    ));
                }
                let mut row = json!({"item": id, "provider": gen, "key": key, "trap": made.trap,
                                     "out": made.out, "shading": made.shading});
                if let Some(ms) = ms {
                    row["ms"] = json!(ms);
                }
                provided.push(row);
            }
        }
        self.provided.insert(doc_id.to_string(), provided);
        issues
    }

    /// A provider's content key (Provider `gen@1`): hash(program, params, seed, asset hashes, out,
    /// the sandbox module's version), the params filled with their schema defaults, and the
    /// content keys of the meshes its `mesh_in` params take, and its links.
    fn key_of(
        &self,
        sealed: &Sealed,
        spec: &Value,
        given: &Map<String, Value>,
        seed: i64,
        mesh_in: &[String],
    ) -> String {
        let version = |name: &str| {
            sealed
                .modules
                .iter()
                .find(|m| m.name == name)
                .map(|m| m.version.to_string())
        };
        let mut params = Map::new();
        for (name, p) in spec["params"].as_object().into_iter().flatten() {
            let v = given.get(name).or_else(|| p.get("default"));
            params.insert(name.clone(), v.cloned().unwrap_or(Value::Null));
        }
        let mut terms = json!({"program": spec["program"], "params": params, "seed": seed,
            "assets": spec["assets"], "links": spec["links"], "mesh_in": mesh_in, "out": spec["out"],
            "sandbox": version("sandbox")});
        match self.key_planted.as_deref() {
            Some("provider_key_omits_params") => terms["params"] = Value::Null,
            Some("provider_key_names_logic") => terms["logic"] = json!(version("logic")),
            _ => {}
        }
        hash(terms.to_string().as_bytes())
    }

    /// The providers of an installed pack, by `owner/name@version`, as `deep_kinds` lists them:
    /// each `<pack>.<name>` with its params and its output.
    pub fn providers_listed(&self, pack: &str) -> Value {
        let Some(manifest) = self.packs.get(pack) else {
            return json!([]);
        };
        let name = manifest["name"].as_str().unwrap_or_default();
        let rows = manifest["providers"].as_object().into_iter().flatten();
        Value::Array(
            rows.map(|(k, p)| json!({"provider": format!("{name}.{k}"), "params": p["params"], "out": p["out"]}))
                .collect(),
        )
    }

    /// Keeps an output's bytes in the evidence store by their hash.
    fn put(&self, bytes: &[u8]) -> Result<String, String> {
        crate::evidence::put(&self.evidence, bytes).map_err(|e| e.to_string())
    }

    /// The drawn form: each param naming `{gen: <pack>.<provider>}` whose output this process
    /// made or took names it by its hash instead, so a frame, a query and the web player's bundle
    /// read the output as data and run no provider (#192).
    pub fn fill(&self, sealed: &Sealed, form: &mut Value) {
        let pinned: Vec<String> = form["packs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(String::from)
            .collect();
        let doc_seed = form.get("seed").and_then(Value::as_i64).unwrap_or(0);
        // The pinned packs' libraries, each provider's library form as `<pack>.<name>@<version>`.
        let libraries: Vec<Value> = pinned
            .iter()
            .filter_map(|p| self.packs.get(p))
            .filter_map(|m| {
                let mut libs = m["libs"].as_object().cloned().unwrap_or_default();
                for (name, spec) in m["providers"].as_object().into_iter().flatten() {
                    if let Some(asset) = spec.pointer("/library/asset") {
                        let label =
                            format!("{}.{name}@{}", m["name"].as_str()?, m["version"].as_str()?);
                        libs.insert(
                            label,
                            json!({"asset": asset, "exports": ["gen"], "fixtures": []}),
                        );
                    }
                }
                (!libs.is_empty())
                    .then(|| json!({"name": m["name"], "version": m["version"], "libs": libs}))
            })
            .collect();
        if !libraries.is_empty() {
            form["libraries"] = json!(libraries);
        }
        let doc = json!({"items": form["items"]});
        let Some(items) = form.get_mut("items").and_then(Value::as_object_mut) else {
            return;
        };
        for item in items.values_mut() {
            let params = item["params"]
                .as_object_mut()
                .into_iter()
                .flat_map(|p| p.values_mut());
            let values = params.flat_map(|v| match v {
                Value::Array(a) => a.iter_mut().collect::<Vec<_>>(),
                v => vec![v],
            });
            for value in values {
                let Some((_, spec)) = value["gen"].as_str().and_then(|g| self.spec_of(&pinned, g))
                else {
                    continue;
                };
                let Ok(keys) = providers::mesh_in(&doc, value) else {
                    continue;
                };
                let given = value["params"].as_object().cloned().unwrap_or_default();
                let seed = value
                    .get("seed")
                    .and_then(Value::as_i64)
                    .unwrap_or(doc_seed);
                let key = self.key_of(sealed, &spec, &given, seed, &keys);
                if let Some(sha) = self.outputs.get(&key).and_then(|m| asset_of(&m.out)) {
                    *value = json!(sha);
                }
            }
        }
    }

    /// The manifest and the entry of `<pack>.<provider>` in a pack `pinned` names that this
    /// process admitted.
    fn spec_of(&self, pinned: &[String], gen: &str) -> Option<(Value, Value)> {
        let (pack_name, provider) = gen.split_once('.')?;
        let manifest = pinned
            .iter()
            .filter(|p| PackId::parse(p).is_some_and(|id| id.name == pack_name))
            .find_map(|p| self.packs.get(p))?;
        let spec = manifest.pointer(&format!("/providers/{provider}"))?;
        Some((manifest.clone(), spec.clone()))
    }

    /// An output made under `key`, in this process or kept in the `--cache` folder.
    fn take(&mut self, key: &str) -> Option<Made> {
        if let Some(m) = self.outputs.get(key) {
            return Some(m.clone());
        }
        let dir = self.cache.as_ref()?;
        let bytes = std::fs::read(dir.join("providers").join(format!("{key}.json"))).ok()?;
        let v: Value = serde_json::from_slice(&bytes).ok()?;
        if let Some(sha) = asset_of(&v["out"]) {
            let kept = std::fs::read(dir.join("providers").join(format!("{sha}.bin"))).ok()?;
            self.put(&kept).ok()?;
        }
        let m = Made {
            trap: v["trap"].clone(),
            out: v["out"].clone(),
            shading: v["shading"].clone(),
            ms: 0.0,
        };
        self.outputs.insert(key.to_string(), m.clone());
        Some(m)
    }

    /// Keeps an output under `key`, and in the `--cache` folder when it has no trap.
    fn keep(&mut self, key: &str, m: &Made) {
        self.outputs.insert(key.to_string(), m.clone());
        if let (Some(dir), true) = (&self.cache, m.trap.is_null()) {
            let dir = dir.join("providers");
            if std::fs::create_dir_all(&dir).is_ok() {
                let v = json!({"trap": m.trap, "out": m.out, "shading": m.shading});
                if let Some(b) =
                    asset_of(&m.out).and_then(|sha| crate::evidence::read(&self.evidence, sha))
                {
                    let _ = std::fs::write(
                        dir.join(format!("{}.bin", asset_of(&m.out).unwrap_or_default())),
                        b,
                    );
                }
                let _ = std::fs::write(dir.join(format!("{key}.json")), v.to_string());
            }
        }
    }

    /// One provider run: its trap (or null), its output, kept only without a trap, its mesh's
    /// geometry.shading counts, and its own time from the rewritten bytes to the decoded output.
    fn make(
        &mut self,
        sealed: &Sealed,
        manifest: &Value,
        spec: &Value,
        given: &Map<String, Value>,
        seed: i64,
        mesh_in: &[Vec<u8>],
    ) -> Made {
        let mut started = None;
        let (trap, mut out) =
            self.make_in(sealed, manifest, spec, given, seed, mesh_in, &mut started);
        let shading = out
            .as_object_mut()
            .and_then(|o| o.remove("shading"))
            .or_else(|| trap.get("shading").cloned())
            .unwrap_or(Value::Null);
        Made {
            ms: started.map_or(0.0, |t: Instant| t.elapsed().as_secs_f64() * 1000.0),
            out: if trap.is_null() { out } else { Value::Null },
            trap,
            shading,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn make_in(
        &mut self,
        sealed: &Sealed,
        manifest: &Value,
        spec: &Value,
        given: &Map<String, Value>,
        seed: i64,
        mesh_in: &[Vec<u8>],
        started: &mut Option<Instant>,
    ) -> (Value, Value) {
        let failed = |kind: &str, what: String| (json!({"kind": kind, "what": what}), Value::Null);
        let sha = spec["program"].as_str().unwrap_or_default();
        let Some(bytes) = asset(manifest, sha) else {
            return failed(
                "asset",
                format!("the program `{sha}` is none of the pack's assets"),
            );
        };
        let budget = match provider_budget(spec.get("budget")) {
            Ok(b) => b,
            Err((field, why)) => return failed("budget", format!("{field}: {why}")),
        };
        // Its links merged in by the sandbox module's linker, as a logic item's are (#190).
        let (sha, bytes) = match spec["links"].as_array().filter(|l| !l.is_empty()) {
            None => (sha.to_string(), bytes),
            Some(links) => {
                let mut libs = Vec::new();
                for l in links {
                    let name = l["name"].as_str().unwrap_or_default();
                    let lib = l["asset"].as_str().and_then(|a| asset(manifest, a));
                    let exports: Vec<String> = manifest
                        .pointer(&format!("/libs/{name}/exports"))
                        .and_then(Value::as_array)
                        .map(|e| {
                            e.iter()
                                .filter_map(Value::as_str)
                                .map(String::from)
                                .collect()
                        })
                        .unwrap_or_default();
                    match lib {
                        Some(b) => libs.push((
                            name.split_once('@').map_or(name, |(n, _)| n).to_string(),
                            name.to_string(),
                            b,
                            exports,
                        )),
                        None => {
                            return (
                                json!({"kind": "refused", "library": name, "what": format!("{name} is none of the pack's assets")}),
                                Value::Null,
                            )
                        }
                    }
                }
                let objects: Vec<deep_canvas_sandbox::link::Object> = libs
                    .iter()
                    .map(|(n, l, b, e)| deep_canvas_sandbox::link::Object {
                        name: n,
                        label: l,
                        bytes: b,
                        exports: e,
                    })
                    .collect();
                match deep_canvas_sandbox::link::link(&bytes, &objects, false) {
                    Ok(linked) => (hash(&linked.bytes), linked.bytes),
                    Err(r) => {
                        return (
                            json!({"kind": "refused", "what": refusals_what(&r), "refusals": refusals_json(&r)}),
                            Value::Null,
                        )
                    }
                }
            }
        };
        let sha = sha.as_str();
        let rw = match self.rewrite_in(sha, &bytes, "provider", &budget) {
            Ok(rw) => rw,
            Err(r) => {
                // A memory past the budget's `memory` is the provider's own trap kind, `memory`.
                let pages = budget.memory / 65_536;
                let kind = match r.iter().all(|r| {
                    r.limit
                        .as_ref()
                        .is_some_and(|l| l.name == "memory" && l.max == Some(pages))
                        && r.what.contains("past the memory budget")
                }) {
                    true => "memory",
                    false => "refused",
                };
                return (
                    json!({"kind": kind, "what": refusals_what(&r), "refusals": refusals_json(&r)}),
                    Value::Null,
                );
            }
        };
        *started = Some(Instant::now());
        let schema = spec["params"].as_object().cloned().unwrap_or_default();
        let params = match deep_sandbox_wasmtime::service::param_bytes(&schema, given) {
            Ok(p) => p,
            Err(p) => return failed("param", format!("param `{p}` is not a constant number")),
        };
        let mut inputs = Vec::new();
        for a in spec["assets"].as_array().into_iter().flatten() {
            let a = a.as_str().unwrap_or_default();
            match asset(manifest, a) {
                Some(b) => inputs.push(b),
                None => {
                    return failed(
                        "asset",
                        format!("the asset `{a}` is none of the pack's assets"),
                    )
                }
            }
        }
        inputs.extend(mesh_in.iter().cloned());
        let assets = deep_sandbox_wasmtime::service::asset_bytes(&inputs);
        self.runs += 1;
        let ran = match self.sandbox.run_with(
            &rw.bytes,
            "provider",
            seed,
            &budget,
            &[],
            &[],
            &[("params_at", &params), ("assets_at", &assets)],
            DEADLINE,
            Offsets::Written,
        ) {
            Ok(r) => r,
            Err(e) => return failed("run", e),
        };
        if let Some(t) = &ran.trap {
            return (trap_json(&Some(t.clone())), Value::Null);
        }
        if let Some(out) = spec.pointer("/out/mesh") {
            let mesh = match decode_mesh(&ran, out) {
                Ok(m) => m,
                Err(e) => return failed("over_cap", e),
            };
            // geometry.shading on the mesh; one declared closed fails on its first open edge.
            let (defects, open) = providers::shading(&mesh);
            if out["closed"] == json!(true) {
                if let Some(edge) = open {
                    return (
                        json!({"kind": "open_edge", "edge": edge, "shading": defects,
                               "what": format!("the mesh is declared closed, but its welded edge {edge} doesn't join exactly two faces")}),
                        Value::Null,
                    );
                }
            }
            // The output by hash, its exact bytes in the evidence store: what a drawn form names.
            let mut mesh = mesh;
            let len = 8
                + 32 * mesh["positions"].as_array().map_or(0, Vec::len) as u64
                + 4 * mesh["indices"].as_array().map_or(0, Vec::len) as u64;
            if let Ok(sha) = out_bytes(&ran, len).and_then(|b| self.put(&b)) {
                mesh["sha256"] = json!(sha);
            }
            return (Value::Null, json!({"mesh": mesh, "shading": defects}));
        }
        if let Some(out) = spec.pointer("/out/rows") {
            let at = ran.out_at.unwrap_or(0) as usize;
            return match providers::decode_rows(&ran.memory, at, out) {
                Ok(rows) => (Value::Null, json!({"rows": rows})),
                Err(e) => failed("over_cap", e),
            };
        }
        // #415: a data asset in its layout, or a world's pages in pages@1, refused by the
        // layout's validator as any asset named at check is.
        let (layout, bytes) = match (spec.pointer("/out/data"), spec.pointer("/out/pages")) {
            (Some(d), _) => {
                let cap = d
                    .get("max_bytes")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .min(16 << 20);
                match decode_data(&ran, cap) {
                    Ok(b) => (
                        d.get("layout")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                        b,
                    ),
                    Err(e) => return failed("over_cap", e),
                }
            }
            (None, Some(p)) => {
                let count = p
                    .get("count")
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
                    .min(layouts::PAGES_CAP);
                match out_bytes(&ran, 12 + count * (4 + layouts::PAGE)) {
                    Ok(b) => ("pages@1".to_string(), b),
                    Err(e) => return failed("over_cap", e),
                }
            }
            _ => {
                return failed(
                    "out",
                    "a provider writes a mesh, a data asset or pages".into(),
                )
            }
        };
        let v = self.validate_bytes(sealed, &layout, &bytes);
        if v["outcome"] == "admitted" {
            let _ = self.put(&bytes);
            return (
                Value::Null,
                json!({"data": {"layout": layout, "asset": v["asset"], "size": v["size"]}}),
            );
        }
        let kind = v["code"].as_str().unwrap_or("layout_refused").to_string();
        (
            json!({"kind": kind, "layout": layout, "asset": v["asset"], "offset": v["offset"],
                "field": v["field"], "trap": v["trap"]}),
            Value::Null,
        )
    }
}

/// The hash an output is kept under: a mesh's, or a data asset's.
fn asset_of(out: &Value) -> Option<&str> {
    out.pointer("/mesh/sha256")
        .or_else(|| out.pointer("/data/asset"))
        .and_then(Value::as_str)
}

/// `len` bytes of a provider's memory from `out_at`.
fn out_bytes(ran: &Ran, len: u64) -> Result<Vec<u8>, String> {
    let at = ran.out_at.ok_or("a provider exports out_at")? as usize;
    ran.memory
        .get(at..at + len as usize)
        .map(<[u8]>::to_vec)
        .ok_or_else(|| format!("the output's {len} bytes run past memory"))
}

/// The data asset a provider wrote at `out_at`: its length as a u32, then its bytes, at most `cap`.
fn decode_data(ran: &Ran, cap: u64) -> Result<Vec<u8>, String> {
    let head = out_bytes(ran, 4)?;
    let len = u64::from(u32::from_le_bytes([head[0], head[1], head[2], head[3]]));
    if len > cap {
        return Err(format!(
            "the data asset is {len} bytes, past its cap of {cap}"
        ));
    }
    out_bytes(ran, 4 + len).map(|b| b[4..].to_vec())
}

/// The mesh a provider wrote at `out_at`, little-endian: `u32 vertex_count, u32 index_count,
/// f32 positions[3 × n], f32 normals[3 × n], f32 uv0[2 × n], u32 indices[index_count]`.
fn decode_mesh(ran: &Ran, spec: &Value) -> Result<Value, String> {
    let m = &ran.memory;
    let at = ran.out_at.ok_or("a provider exports out_at")? as usize;
    let u32_at = |i: usize| -> Result<u32, String> {
        m.get(i..i + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
            .ok_or_else(|| format!("the mesh runs past memory at {i}"))
    };
    let f32_at = |i: usize| u32_at(i).map(|b| f64::from(f32::from_bits(b)));
    let n = u32_at(at)? as usize;
    let ni = u32_at(at + 4)? as usize;
    let cap = spec
        .get("max_vertices")
        .and_then(Value::as_u64)
        .unwrap_or(262_144) as usize;
    if n > cap {
        return Err(format!("the mesh has {n} vertices, past its cap of {cap}"));
    }
    let mut p = at + 8;
    let mut take = |width: usize| -> Result<Vec<Vec<f64>>, String> {
        let mut out = Vec::new();
        for _ in 0..n {
            let mut v = Vec::new();
            for _ in 0..width {
                v.push(f32_at(p)?);
                p += 4;
            }
            out.push(v);
        }
        Ok(out)
    };
    let positions = take(3)?;
    let normals = take(3)?;
    let uv0 = take(2)?;
    let mut indices = Vec::new();
    for _ in 0..ni {
        indices.push(u32_at(p)?);
        p += 4;
    }
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    for v in &positions {
        for k in 0..3 {
            lo[k] = lo[k].min(v[k]);
            hi[k] = hi[k].max(v[k]);
        }
    }
    let mut out = Map::new();
    out.insert("positions".into(), json!(positions));
    out.insert("normals".into(), json!(normals));
    out.insert("uv0".into(), json!(uv0));
    out.insert("indices".into(), json!(indices));
    out.insert("parts".into(), json!([{"first": 0, "count": ni}]));
    out.insert("bounds".into(), json!([lo, hi]));
    Ok(Value::Object(out))
}

/// A shipped module as the build seals it: #192's test builds raise only the logic module's
/// version (`test-logic-version-bump`) or only the sandbox module's (`test-sandbox-version-bump`).
pub fn shipped(mut m: deep_canvas::registry::Module) -> deep_canvas::registry::Module {
    let bump = match m.manifest.name.as_str() {
        "logic" => cfg!(feature = "test-logic-version-bump"),
        "sandbox" => cfg!(feature = "test-sandbox-version-bump"),
        _ => false,
    };
    if bump {
        m.manifest.version.minor += 1;
    }
    m
}
