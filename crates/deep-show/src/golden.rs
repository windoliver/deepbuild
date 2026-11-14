//! Issue #525: a golden of a document's evaluation on this build (Golden; Registry and seal:
//! runtime digest). Step k is the document's current revision evaluated clean at k × 1/120 s,
//! hashed over what the build's measured or backend_bytes implementations wrote: the nodes of
//! their canvas modules, the implementations the runtime digest is over. A golden records the
//! build's runtime digest and those implementations; run under another digest it is BLOCKED
//! before any step, naming the interface whose implementation differs, both versions and both
//! digests, and is never compared; under the same one it replays every step and compares.

use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::hub::{Eval, EvalTime, Hub, Planted};

/// A golden's step: the physics step, 1/120 s (Time and the flick).
const STEP: i64 = crate::shared::FLICKS / 120;

pub enum GoldenCall {
    Record { doc: String, steps: u64 },
    Verify { doc: String, golden: Value },
}

pub fn parse(name: &str, c: &Map<String, Value>) -> Option<GoldenCall> {
    let doc = c.get("doc")?.as_str()?.to_string();
    Some(match name {
        "golden_record" => GoldenCall::Record {
            doc,
            steps: c
                .get("steps")?
                .as_u64()
                .filter(|n| (1..=100_000).contains(n))?,
        },
        "golden_verify" => GoldenCall::Verify {
            doc,
            golden: c.get("golden").filter(|g| g.is_object())?.clone(),
        },
        _ => return None,
    })
}

fn hex(d: impl AsRef<[u8]>) -> String {
    d.as_ref().iter().map(|b| format!("{b:02x}")).collect()
}

/// The first interface whose implementation differs between two golden lists, with its two
/// versions (`null` where a list lacks it).
fn differing(recorded: &[Value], here: &[Value]) -> (Value, [Value; 2]) {
    let of = |list: &[Value], name: &Value| list.iter().find(|e| &e["interface"] == name).cloned();
    let mut names: Vec<&Value> = recorded
        .iter()
        .chain(here)
        .map(|e| &e["interface"])
        .collect();
    names.sort_by_key(|n| n.as_str().unwrap_or_default().to_string());
    for name in names {
        let (a, b) = (of(recorded, name), of(here, name));
        if a != b {
            let version = |e: Option<Value>| e.map_or(Value::Null, |e| e["version"].clone());
            return (name.clone(), [version(a), version(b)]);
        }
    }
    (Value::Null, [Value::Null, Value::Null])
}

impl Hub<'_> {
    /// The implementations the runtime digest is over: each measured or backend_bytes one, by
    /// interface, with its canvas module, name, version and pins (#1920).
    fn digested(&self) -> Vec<Value> {
        use deep_canvas::registry::{Equivalence, StateClass};
        let sealed = &self.startup.sealed;
        let kept = sealed.interfaces.iter().filter(|i| {
            let m = &i.implementation;
            m.state == StateClass::BackendBytes || m.equivalence == Equivalence::Measured
        });
        kept.map(|i| {
            let m = i.implementation.to_json();
            json!({"interface": i.name, "module": i.module, "implementation": m["name"], "version": m["version"], "pins": m["pins"]})
        })
        .collect()
    }

    /// Each step's hash: the document evaluated clean at the step's time, over the results of
    /// the nodes of the digested implementations' modules, in node order.
    fn step_hashes(&mut self, doc: &str, steps: u64) -> Result<Vec<String>, Value> {
        let modules: Vec<Value> = self
            .digested()
            .iter()
            .map(|e| e["module"].clone())
            .collect();
        let mut out = Vec::new();
        for k in 0..steps as i64 {
            let e = Eval {
                doc: doc.into(),
                t: EvalTime::Flicks(k * STEP),
                view: Map::new(),
                clean: true,
                perturb: None,
                pixels: false,
                film: false,
                size: None,
                debug_text: false,
                arrays: Vec::new(),
                paths: Vec::new(),
                track: None,
                data_hash: false,
                texts: false,
                carried: false,
            };
            let r = self.eval(&e);
            if r["outcome"] != "evaluated" {
                return Err(json!({"code": "not_evaluated", "step": k, "eval": r}));
            }
            let mut h = Sha256::new();
            for n in r["nodes"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|n| modules.contains(&n["module"]))
            {
                h.update(format!(
                    "{}\0{}\0{}\n",
                    n["operator"], n["item"], n["result"]
                ));
            }
            out.push(hex(h.finalize()));
        }
        Ok(out)
    }

    /// A golden's bake key: the current revision's document and the step count.
    fn golden_key(&self, doc: &str, steps: usize) -> String {
        let d = self
            .current(doc)
            .map(|r| r.doc.to_string())
            .unwrap_or_default();
        hex(Sha256::digest(format!("{d}\0{steps}")))
    }

    pub fn golden_call(&mut self, call: &GoldenCall) -> Value {
        let digest = self.startup.sealed.runtime_digest.clone();
        match call {
            GoldenCall::Record { doc, steps } => match self.step_hashes(doc, *steps) {
                Ok(hashes) => {
                    json!({"golden": {"bake_key": self.golden_key(doc, hashes.len()), "runtime_digest": digest,
                    "implementations": self.digested(), "steps": steps, "step_hashes": hashes,
                    "machine": {"os": std::env::consts::OS, "arch": std::env::consts::ARCH}}})
                }
                Err(e) => e,
            },
            GoldenCall::Verify { doc, golden } => {
                let theirs = golden["runtime_digest"].clone();
                let across = self.scenario.planted == Some(Planted::GoldenComparesAcrossDigests);
                if theirs != json!(digest) && !across {
                    let recorded = golden["implementations"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default();
                    let (interface, [a, b]) = differing(&recorded, &self.digested());
                    let reason = format!(
                        "BLOCKED before any step: the golden was recorded under runtime digest {} with {} at {}, and this build's runtime digest is {} with it at {}; a golden is never compared under another runtime digest",
                        theirs.as_str().unwrap_or("none"), interface.as_str().unwrap_or("no implementation"), a.as_str().unwrap_or("none"), digest, b.as_str().unwrap_or("none"),
                    );
                    return json!({"verdict": "BLOCKED", "steps_run": 0, "report": null, "reason": reason,
                        "blocked": {"interface": interface, "versions": [a, b], "runtime_digests": [theirs, digest]}});
                }
                let recorded: Vec<Value> = golden["step_hashes"]
                    .as_array()
                    .cloned()
                    .unwrap_or_default();
                let key = self.golden_key(doc, recorded.len());
                if golden["bake_key"] != json!(key) {
                    let reason = format!("the golden's bake key {} isn't this document's, {key}: it is never compared", golden["bake_key"]);
                    return json!({"verdict": "FAIL", "steps_run": 0, "report": null, "blocked": null, "reason": reason});
                }
                let mine = match self.step_hashes(doc, recorded.len() as u64) {
                    Ok(h) => h,
                    Err(e) => return e,
                };
                let first = (0..recorded.len()).find(|&k| recorded[k] != json!(mine[k]));
                let (verdict, reason) = match first {
                    None => (
                        "PASS",
                        format!("every one of {} steps hashes as recorded", mine.len()),
                    ),
                    Some(k) => (
                        "FAIL",
                        format!(
                            "step {k} hashes {} here, not the recorded {}",
                            mine[k], recorded[k]
                        ),
                    ),
                };
                json!({"verdict": verdict, "steps_run": mine.len(), "blocked": null, "reason": reason,
                    "report": first.map(|k| json!({"first_step": k, "values": [recorded[k], mine[k]]}))})
            }
        }
    }
}
