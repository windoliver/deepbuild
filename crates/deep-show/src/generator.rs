//! #155: generator sources (canvas primitives: Strip and track: generator sources and rate ramps;
//! Foley `foley.render@1`). A strip or a Spawn template may play `src: {generator: {job, output}}`:
//! a foley preset's variant (`job` the preset's name without its major, `foley.<material>.<action>`,
//! or `foley.<action>` for the material its film binds to the collection holding the occurrence's
//! item) or a score's stem (`job` the score item's ID). The canvas core only plays strips, so each
//! source is resolved at check to the asset the job made: the job's request is planned here, its
//! key computed as the hub computes it (`packages/hub/src/jobs.ts`, `keyOf`: SHA-256 of the
//! RFC 8785 text of `{kind, tool, params, inputs}`, each input by its bytes' SHA-256, a list for an
//! input declared `many`), and found among the done `deep_job` replies the scenario hands over
//! (`jobs`). A job with no such reply makes the mix BLOCKED, naming it and giving its request.
//! On a Spawn template, `output: "variant"` plays every variant as a take of its level.

use std::collections::BTreeMap;

use serde_json::{json, Map, Value};

use crate::evidence;
use crate::hub::Hub;

pub const KIND: &str = "foley.render";
pub const TOOL: &str = "foley-render@1.0.0";
pub const LEVELS: usize = 3;
pub const ROUND_ROBINS: usize = 4;
const MATERIALS: [&str; 10] = [
    "paper",
    "wood",
    "metal",
    "glass",
    "plastic",
    "rubber",
    "ink",
    "cloth",
    "stone",
    "electronic",
];
/// #155's planted spawn: a foley job named by its action alone takes the first bound collection's
/// material for every occurrence.
const FIRST_COLLECTION: &str = "foley_first_collection_material";

/// RFC 8785 text: object keys sorted by UTF-16 code units, numbers and strings as JSON prints
/// them.
fn canonical(v: &Value, out: &mut String) {
    match v {
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            out.push('{');
            for (i, k) in keys.into_iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(k.clone()).to_string());
                out.push(':');
                canonical(&m[k], out);
            }
            out.push('}');
        }
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canonical(x, out);
            }
            out.push(']');
        }
        Value::Number(n) => match (n.as_i64(), n.as_u64(), n.as_f64()) {
            (Some(i), ..) => out.push_str(&i.to_string()),
            (_, Some(u), _) => out.push_str(&u.to_string()),
            (.., Some(f)) => out.push_str(&js_number(f)),
            _ => out.push_str(&n.to_string()),
        },
        other => out.push_str(&other.to_string()),
    }
}

/// A finite f64 as ECMAScript's Number::toString prints it (RFC 8785's numbers): the shortest
/// digits that round-trip, written plainly from 1e-6 to below 1e21 and with an exponent outside.
fn js_number(f: f64) -> String {
    if f == 0.0 {
        return "0".into();
    }
    // Rust's `{:e}` writes the same shortest round-trip digits: d.ddde±x.
    let sci = format!("{:e}", f.abs());
    let (mantissa, exp) = sci.split_once('e').unwrap_or((&sci, "0"));
    let digits: String = mantissa.chars().filter(char::is_ascii_digit).collect();
    let k = digits.len() as i32;
    let n = exp.parse::<i32>().unwrap_or(0) + 1;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let sign = if e < 0 { '-' } else { '+' };
        match digits.split_at(1) {
            (d, "") => format!("{d}e{sign}{}", e.abs()),
            (d, rest) => format!("{d}.{rest}e{sign}{}", e.abs()),
        }
    };
    if f < 0.0 {
        format!("-{body}")
    } else {
        body
    }
}

/// A request's key, as the hub computes it; `many` names the inputs its kind declares as lists.
fn key(request: &Value, many: &[&str]) -> String {
    let mut inputs = Map::new();
    for n in many {
        inputs.insert((*n).to_string(), json!([]));
    }
    for i in request["inputs"].as_array().into_iter().flatten() {
        let (Some(name), Some(sha)) = (i["name"].as_str(), i["sha256"].as_str()) else {
            continue;
        };
        match inputs.get_mut(name) {
            Some(Value::Array(list)) => list.push(json!(sha)),
            _ => {
                inputs.insert(name.to_string(), json!(sha));
            }
        }
    }
    let mut text = String::new();
    canonical(
        &json!({"kind": request["kind"], "tool": request["tool"], "params": request["params"], "inputs": inputs}),
        &mut text,
    );
    evidence::sha256_hex(text.as_bytes())
}

fn bad(what: String) -> Value {
    json!({"code": "bad_media", "what": what})
}

/// A generator's `{job, output}`.
fn generator_of(src: &Value) -> Option<(&str, &str)> {
    let g = src.get("generator")?;
    Some((g.get("job")?.as_str()?, g.get("output")?.as_str()?))
}

/// The film's bound materials, by collection ID, each checked against the closed list.
fn bindings(d: &Value) -> Result<BTreeMap<String, String>, Value> {
    let mut out = BTreeMap::new();
    for (c, m) in d
        .get("foley_materials")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let m = m.as_str().unwrap_or_default();
        if !MATERIALS.contains(&m) {
            return Err(bad(format!(
                "foley_materials.{c}: {m:?} isn't a foley material ({})",
                MATERIALS.join(", ")
            )));
        }
        if d.pointer(&format!("/collections/{c}")).is_none() {
            return Err(bad(format!(
                "foley_materials.{c}: the document has no collection {c}"
            )));
        }
        out.insert(c.clone(), m.to_string());
    }
    Ok(out)
}

impl Hub<'_> {
    fn module_planted_is(&self, name: &str) -> bool {
        self.scenario.module_planted.as_deref() == Some(name)
    }

    /// The material an occurrence of `list` takes: the one bound to the first collection (by ID)
    /// holding the list's item (`<item>.build`, `<item>.reveal`).
    fn material_of(
        &self,
        d: &Value,
        bound: &BTreeMap<String, String>,
        list: &str,
    ) -> Option<String> {
        if self.module_planted_is(FIRST_COLLECTION) {
            return bound.values().next().cloned();
        }
        let item = list.rsplit_once('.').map(|(i, _)| i)?;
        bound
            .iter()
            .find(|(c, _)| {
                d.pointer(&format!("/collections/{c}/members"))
                    .and_then(Value::as_array)
                    .is_some_and(|m| m.iter().any(|x| x.as_str() == Some(item)))
            })
            .map(|(_, m)| m.clone())
    }

    /// A foley job's request: `foley.<material>.<action>`'s preset from the pack the document
    /// pins, seeded by the preset's name, into 3 levels × 4 round robins at 48 kHz.
    fn foley_request(&self, d: &Value, job: &str) -> Result<Value, Value> {
        let name = format!("{job}@1");
        let preset = crate::mixdown::synth::preset_json(d, &name)?;
        Ok(json!({
            "kind": KIND, "tool": TOOL, "inputs": [],
            "params": {"preset": preset, "seed": name, "levels": LEVELS, "round_robins": ROUND_ROBINS, "sample_rate": 48_000},
        }))
    }

    /// The request and its key of the job a generator names, resolved for `material` when it
    /// names a foley action alone; for a score item, its stem `output`'s request.
    fn request_of(
        &mut self,
        d: &Value,
        job: &str,
        output: &str,
        material: Option<&str>,
        whose: &str,
    ) -> Result<(String, Value, String), Value> {
        if let Some(rest) = job.strip_prefix("foley.") {
            let job = match (rest.split_once('.'), material) {
                (Some(_), _) => job.to_string(),
                (None, Some(m)) => format!("foley.{m}.{rest}"),
                (None, None) => {
                    return Err(
                        json!({"code": "foley.unbound", "job": job, "what": format!("{whose} plays {job}, an action alone, but no collection holding its occurrences' item has a material in foley_materials")}),
                    )
                }
            };
            let request = self.foley_request(d, &job)?;
            let k = key(&request, &[]);
            return Ok((job, request, k));
        }
        if d.pointer(&format!("/items/{job}/kind"))
            .and_then(Value::as_str)
            == Some("score.music@1")
        {
            let plan = self.score_plan(&json!({"doc": d, "item": job}));
            let Some(request) = plan.pointer(&format!("/stems/{output}")).cloned() else {
                return Err(if plan.get("stems").is_some() {
                    bad(format!("{whose}: the score {job} has no stem {output}"))
                } else {
                    plan
                });
            };
            let k = key(&request, &["samples"]);
            return Ok((job.to_string(), request, k));
        }
        Err(bad(format!(
            "{whose}: generator job {job} is no foley preset (foley.<material>.<action>, foley.<action>) or score item"
        )))
    }

    /// The outputs of the done run of `key` among the scenario's `jobs`, `{name → sha256}`.
    fn outputs_of(&self, key: &str) -> Option<BTreeMap<String, String>> {
        let run = self.scenario.jobs.iter().find(|r| {
            r.get("status").and_then(Value::as_str) == Some("done")
                && r.pointer("/receipt/key").and_then(Value::as_str) == Some(key)
        })?;
        Some(
            run.get("outputs")?
                .as_object()?
                .iter()
                .filter_map(|(n, o)| Some((n.clone(), o.get("sha256")?.as_str()?.to_string())))
                .collect(),
        )
    }

    /// The asset each output of a generator's job is, or BLOCKED naming the job when it hasn't run.
    fn job_assets(
        &mut self,
        d: &Value,
        job: &str,
        output: &str,
        material: Option<&str>,
        whose: &str,
    ) -> Result<(String, BTreeMap<String, String>), Value> {
        let (job, request, k) = self.request_of(d, job, output, material, whose)?;
        match self.outputs_of(&k) {
            // A score's job renders one stem, kept as its output `stem`, which the source names.
            Some(mut outputs) if request["kind"] == crate::mixdown::score_plan::KIND => {
                let stem = outputs.remove("stem").unwrap_or_default();
                Ok((job, BTreeMap::from([(output.to_string(), stem)])))
            }
            Some(outputs) => Ok((job, outputs)),
            None => Err(json!({
                "state": "BLOCKED", "code": "generator.unrun", "job": job, "key": k, "request": request,
                "reason": format!("{whose} plays an output of the job {job}, which hasn't run (no done run with the key {k}): run its request through deep_job"),
            })),
        }
    }

    /// Whether `d` holds a generator source on a strip or a Spawn template.
    pub(crate) fn has_generator(d: &Value) -> bool {
        let strips = d.get("strips").and_then(Value::as_object);
        let spawns = d.get("spawns").and_then(Value::as_object);
        strips
            .into_iter()
            .flatten()
            .any(|(_, s)| s.pointer("/src/generator").is_some())
            || spawns
                .into_iter()
                .flatten()
                .any(|(_, sp)| templates(sp).any(|(t, _)| t.pointer("/src/generator").is_some()))
    }

    /// `d` with every generator source played as the asset its job made: a strip's `src` becomes
    /// `{asset}`; a Spawn's `play` becomes its list of `{template, weight, level, job, output}`, a
    /// `variant` template giving one take per variant, level 1 first.
    pub(crate) fn resolve_generators(&mut self, d: &Value) -> Result<Value, Value> {
        let bound = bindings(d)?;
        let mut out = d.clone();
        let strips: Vec<(String, Value)> = d
            .get("strips")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        for (sid, s) in strips {
            let Some((job, output)) = s.get("src").and_then(generator_of) else {
                continue;
            };
            let whose = format!("strip {sid}");
            let (job, outputs) = self.job_assets(d, job, output, None, &whose)?;
            let sha = outputs
                .get(output)
                .ok_or_else(|| bad(format!("{whose}: the job {job} has no output {output}")))?;
            out["strips"][&sid]["src"] = json!({"asset": sha});
        }
        let spawns: Vec<(String, Value)> = d
            .get("spawns")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        for (sid, sp) in spawns {
            if !templates(&sp).any(|(t, _)| t.pointer("/src/generator").is_some()) {
                continue;
            }
            let list = sp.pointer("/on/list").and_then(Value::as_str).unwrap_or("");
            let material = self.material_of(d, &bound, list);
            let mut play = Vec::new();
            for (t, entry) in templates(&sp)
                .map(|(t, e)| (t.clone(), e.clone()))
                .collect::<Vec<_>>()
            {
                let Some((job, output)) = t.get("src").and_then(generator_of) else {
                    play.push(entry);
                    continue;
                };
                let whose = format!("spawn {sid}");
                let (job, outputs) =
                    self.job_assets(d, job, output, material.as_deref(), &whose)?;
                let take = |name: &str, level: Value| -> Result<Value, Value> {
                    let sha = outputs.get(name).ok_or_else(|| {
                        bad(format!("{whose}: the job {job} has no output {name}"))
                    })?;
                    let mut template = t.clone();
                    template["src"] = json!({"asset": sha});
                    let mut e = entry.clone();
                    e["template"] = template;
                    e["level"] = level;
                    e["job"] = json!(job);
                    e["output"] = json!(name);
                    Ok(e)
                };
                if output == "variant" {
                    for l in 1..=LEVELS {
                        for r in 1..=ROUND_ROBINS {
                            play.push(take(&format!("l{l}r{r}"), json!(l))?);
                        }
                    }
                } else {
                    play.push(take(
                        output,
                        entry.get("level").cloned().unwrap_or(json!(1)),
                    )?);
                }
            }
            out["spawns"][&sid]["play"] = Value::Array(play);
        }
        Ok(out)
    }

    /// `{call: "foley_plan", doc}`: every foley job the document's generator sources reach, each a
    /// request ready for `deep_job`; a job named by its action alone, once for each bound material.
    pub(crate) fn foley_plan(&mut self, c: &Value) -> Value {
        let Some(d) = c.get("doc").filter(|d| d.is_object()) else {
            return json!({"code": "bad_call", "what": "foley_plan takes {doc}: a document"});
        };
        let bound = match bindings(d) {
            Ok(b) => b,
            Err(e) => return e,
        };
        let mut named: Vec<&str> = Vec::new();
        for (_, s) in d
            .get("strips")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            named.extend(s.get("src").and_then(generator_of).map(|g| g.0));
        }
        for (_, sp) in d
            .get("spawns")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            named.extend(
                templates(sp)
                    .filter_map(|(t, _)| t.get("src").and_then(generator_of))
                    .map(|g| g.0),
            );
        }
        let mut jobs = Map::new();
        for job in named {
            let Some(rest) = job.strip_prefix("foley.") else {
                continue;
            };
            let ids: Vec<String> = if rest.contains('.') {
                vec![job.to_string()]
            } else {
                bound
                    .values()
                    .map(|m| format!("foley.{m}.{rest}"))
                    .collect()
            };
            for id in ids {
                match self.foley_request(d, &id) {
                    Ok(r) => {
                        jobs.insert(id, r);
                    }
                    Err(e) => return e,
                }
            }
        }
        json!({"jobs": jobs})
    }
}

/// A Spawn's templates and the `play` entry each sits in, as `{template, weight?, level?}`.
fn templates(sp: &Value) -> impl Iterator<Item = (&Value, Value)> {
    let entries: Vec<(&Value, Value)> = match sp.get("play") {
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(|e| Some((e.get("template")?, e.clone())))
            .collect(),
        Some(t) => vec![(t, json!({"template": t, "weight": 1}))],
        None => Vec::new(),
    };
    entries.into_iter()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Numbers print as JavaScript's JSON.stringify prints them, so a request's key is the hub's.
    #[test]
    fn numbers_print_as_the_hub_prints_them() {
        let cases = [
            (60.0, "60"),
            (0.25, "0.25"),
            (-0.5, "-0.5"),
            (0.000001, "0.000001"),
            (1e-7, "1e-7"),
            (1.5e-7, "1.5e-7"),
            (123_456_789_012_345_680_000.0, "123456789012345680000"),
            (1e21, "1e+21"),
            (2.5e22, "2.5e+22"),
            (0.1 + 0.2, "0.30000000000000004"),
        ];
        for (f, want) in cases {
            assert_eq!(js_number(f), want, "{f:e}");
        }
        let mut text = String::new();
        canonical(&json!({"b": [60.0, 1], "a": {"z": null}}), &mut text);
        assert_eq!(text, r#"{"a":{"z":null},"b":[60,1]}"#);
    }
}
