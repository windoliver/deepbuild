//! Issue #238: the sandbox module in the app (canvas primitives: Logic: sandbox). It admits and
//! runs the programs packs carry, only at check and never in a frame: a layout's validator on each
//! of its twins and each program entry's rewrite at the pack check, and a provider at a document's
//! check, once per content key; and a data asset's layout's validator, once per asset hash and
//! validator hash (#415). The counts it keeps are the proof that a document naming no program
//! costs it nothing, a provider runs once and an asset past its cap never reaches its validator.

use std::collections::BTreeMap;
use std::time::Duration;

use deep_canvas::document::{Issue, Pack, PackId};
use deep_canvas::registry::lists::{entry_digest, SealedEntry};
use deep_canvas::registry::Sealed;
use deep_canvas_sandbox::check::Refusal;
use deep_canvas_sandbox::layouts::{self, Planted, PACK_MAX_BYTES};
use deep_canvas_sandbox::rewrite::{hash, Rewritten};
use deep_sandbox_wasmtime::service::{trap_json, Budget, Offsets, Ran, Sandbox};
use serde_json::{json, Map, Value};

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
    outputs: BTreeMap<String, (Value, Value)>,
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
    /// Each admitted pack's layouts as `data.layout@1` entries, origin `pack` (#415).
    pub layout_entries: Vec<SealedEntry>,
}

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
    pub fn planted(planted: Planted) -> Host {
        Host {
            planted,
            ..Host::default()
        }
    }

    /// The check and the rewrite of one program in a role, once per program.
    fn rewrite(&mut self, sha: &str, bytes: &[u8], role: &str) -> Result<Rewritten, Vec<Refusal>> {
        let key = (sha.to_string(), role.to_string());
        if let Some(r) = self.rewritten.get(&key) {
            return r.clone();
        }
        self.checks += 1;
        let budget = Budget::of(role, None, 0);
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
        if issues.is_empty() {
            self.packs.insert(pack.id.text(), manifest.clone());
            self.layout_entries.extend(entries);
        }
        (rows, issues)
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
    /// only for a key it hasn't made. A trap is an error naming the provider, the item and the kind.
    pub fn provide(&mut self, sealed: &Sealed, doc_id: &str, doc: &Value) -> Vec<Issue> {
        let mut issues = Vec::new();
        let mut provided = Vec::new();
        let pinned: Vec<String> = doc
            .get("packs")
            .and_then(Value::as_array)
            .map(|p| {
                p.iter()
                    .filter_map(Value::as_str)
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default();
        let seed = doc.get("seed").and_then(Value::as_i64).unwrap_or(0);
        let items = doc
            .get("items")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        for (id, item) in &items {
            let params = item
                .get("params")
                .and_then(Value::as_object)
                .cloned()
                .unwrap_or_default();
            for (param, value) in &params {
                let Some(gen) = value.get("gen").and_then(Value::as_str) else {
                    continue;
                };
                let Some((pack_name, provider)) = gen.split_once('.') else {
                    continue;
                };
                let Some(manifest) = pinned
                    .iter()
                    .filter(|p| PackId::parse(p).is_some_and(|id| id.name == pack_name))
                    .find_map(|p| self.packs.get(p))
                    .cloned()
                else {
                    continue;
                };
                let Some(spec) = manifest.pointer(&format!("/providers/{provider}")).cloned()
                else {
                    continue;
                };
                let path = format!("items/{id}/params/{param}");
                let sha = spec
                    .get("program")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let out = spec.get("out").cloned().unwrap_or(Value::Null);
                let key = hash(
                    json!({"program": sha, "params": value.get("params").cloned().unwrap_or(json!({})),
                           "seed": seed, "assets": [], "out": out,
                           "sandbox": deep_canvas_sandbox::module::module().manifest.version.to_string()})
                    .to_string()
                    .as_bytes(),
                );
                if !self.outputs.contains_key(&key) {
                    let made = self.make(sealed, &manifest, &sha, &spec, seed);
                    self.outputs.insert(key.clone(), made);
                }
                let (trap, output) = self.outputs[&key].clone();
                if let (Some(layout), Some(kind)) =
                    (trap.get("layout"), trap.get("kind").and_then(Value::as_str))
                {
                    // #415: the output refused by its layout, naming the asset, the layout and the
                    // offset or the trap.
                    let code = match kind {
                        "over_cap" => "over_cap",
                        "layout_trap" => "layout_trap",
                        _ => "layout_refused",
                    };
                    issues.push(Issue::envelope(
                        code,
                        path,
                        json!({"provider": gen, "item": id, "layout": layout, "asset": trap["asset"],
                               "offset": trap["offset"], "field": trap["field"], "trap": trap["trap"]}),
                        &format!("provider `{gen}` of item `{id}` wrote an asset its layout {layout} refuses ({kind})"),
                    ));
                } else if let Some(kind) = trap.get("kind").and_then(Value::as_str) {
                    issues.push(Issue::envelope(
                        "provider_trap",
                        path,
                        json!({"provider": gen, "item": id, "trap": trap}),
                        &format!("provider `{gen}` of item `{id}` trapped with kind {kind}"),
                    ));
                }
                provided.push(
                    json!({"item": id, "provider": gen, "key": key, "trap": trap, "out": output}),
                );
            }
        }
        self.provided.insert(doc_id.to_string(), provided);
        issues
    }

    /// One provider run: its trap (or null) and its output.
    fn make(
        &mut self,
        sealed: &Sealed,
        manifest: &Value,
        sha: &str,
        spec: &Value,
        seed: i64,
    ) -> (Value, Value) {
        let failed = |kind: &str, what: String| (json!({"kind": kind, "what": what}), Value::Null);
        let Some(bytes) = asset(manifest, sha) else {
            return failed(
                "asset",
                format!("the program `{sha}` is none of the pack's assets"),
            );
        };
        let rw = match self.rewrite(sha, &bytes, "provider") {
            Ok(rw) => rw,
            Err(r) => return failed("refused", refusals_what(&r)),
        };
        let budget = Budget::of("provider", spec.get("budget"), 0);
        let ran = match self.run(&rw, "provider", seed, &budget, &[]) {
            Ok(r) => r,
            Err(e) => return failed("run", e),
        };
        if let Some(t) = &ran.trap {
            return (trap_json(&Some(t.clone())), Value::Null);
        }
        if let Some(mesh) = spec.pointer("/out/mesh") {
            return match decode_mesh(&ran, mesh) {
                Ok(m) => (Value::Null, json!({"mesh": m})),
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
