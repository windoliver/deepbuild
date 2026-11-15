//! An interface's trial (issue #191; canvas primitives: Canvas module: interface and
//! implementation, the Trial row). Before a build switches implementations, a trial runs a
//! replica of a build that chose the candidate beside one of the build in use, each its own
//! process: both replay the corpus documents of the interface's module, the interface's parity
//! fixtures and the recorded input tracks named, reading every public array of the interface on
//! every item at every step, and the trial reports each input as `equal`, `within` the tightest
//! tolerance of the interface's behavior part that holds every difference, or the first item,
//! step and field that `differs`. The trial switches nothing; only your decision does, and the
//! goldens and corpus snapshots it changes move with that decision, once.

use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use deep_canvas::registry::Sealed;
use deep_canvas::schedule::{canonical, sha256_hex, Scheduler, Tokens, Val};
use serde_json::{json, Map, Value};

use super::catalog::stamped;
use super::instance::{self, How};
use super::migration;
use crate::hub::Hub;

/// A recorded input track's steps a second.
const STEPS_PER_SECOND: i64 = 120;

pub enum TrialCall {
    /// `track_record`: a recorded input track, kept in `store` by its hash.
    Record {
        store: PathBuf,
        document: Value,
        steps: u64,
        entries: Vec<Value>,
    },
    /// `trial`: the candidate, by the path of a build that chose it, against the build in use.
    Trial {
        candidate: String,
        build: PathBuf,
        corpus: PathBuf,
        store: PathBuf,
        tracks: Vec<String>,
    },
    /// `trial_replay`, a replica's own call: this build's implementation of the interface `of`
    /// (named by the interface or by its implementation) replaying every input.
    Replay {
        of: String,
        corpus: PathBuf,
        store: PathBuf,
        tracks: Vec<String>,
    },
}

pub fn parse_call(name: &str, c: &Map<String, Value>) -> Option<TrialCall> {
    let path = |k: &str| Some(PathBuf::from(c.get(k)?.as_str()?));
    let text = |k: &str| Some(c.get(k)?.as_str()?.to_string());
    let tracks = || {
        c.get("tracks")?
            .as_array()?
            .iter()
            .map(|t| t.as_str().map(str::to_string))
            .collect::<Option<Vec<_>>>()
    };
    Some(match name {
        "track_record" => TrialCall::Record {
            store: path("store")?,
            document: c.get("document").filter(|d| d.is_object())?.clone(),
            steps: c.get("steps")?.as_u64()?,
            entries: c.get("entries")?.as_array()?.clone(),
        },
        "trial" => TrialCall::Trial {
            candidate: text("candidate")?,
            build: path("build")?,
            corpus: path("corpus")?,
            store: path("store")?,
            tracks: tracks()?,
        },
        "trial_replay" => TrialCall::Replay {
            of: text("of")?,
            corpus: path("corpus")?,
            store: path("store")?,
            tracks: tracks()?,
        },
        _ => return None,
    })
}

fn refused(code: &str) -> Value {
    json!({"outcome": "refused", "code": code})
}

/// The place a `set` entry writes: its target item's field, by the entry's dotted path.
fn pointer(entry: &Value) -> Option<String> {
    let target = entry["target"].as_str()?;
    let path = entry["data"]["path"].as_str()?;
    Some(format!("/items/{target}/{}", path.replace('.', "/")))
}

fn is_hex(text: &str, len: usize) -> bool {
    text.len() == len
        && text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A trial's record in the evidence folder, by its ID.
fn trial_path(evidence: &Path, id: &str) -> Option<PathBuf> {
    let hash = id.strip_prefix("trial-")?;
    is_hex(hash, 12).then(|| evidence.join("trials").join(format!("{id}.json")))
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

fn write_json(path: &Path, value: &Value) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(path, serde_json::to_vec_pretty(value)?)
}

/// One step a replica plays: its document when it changed, and its time in flicks.
struct Frame {
    step: u64,
    t: i64,
    doc: Option<Value>,
}

/// A track's steps: at step k, the document with every `set` entry of a step up to k applied,
/// in step order, at k steps' time.
fn track_frames(track: &Value) -> Option<Vec<Frame>> {
    let steps = track["steps"].as_u64()?;
    let mut doc = track["document"].clone();
    let mut entries: Vec<&Value> = track["entries"].as_array()?.iter().collect();
    entries.sort_by_key(|e| e["step"].as_u64().unwrap_or(0));
    let mut entries = entries.into_iter().peekable();
    let per_step = crate::shared::FLICKS / STEPS_PER_SECOND;
    let mut frames = Vec::new();
    for k in 1..=steps {
        let mut changed = k == 1;
        while let Some(e) = entries.next_if(|e| e["step"].as_u64().is_some_and(|s| s <= k)) {
            *doc.pointer_mut(&pointer(e)?)? = e["data"]["value"].clone();
            changed = true;
        }
        frames.push(Frame {
            step: k,
            t: k as i64 * per_step,
            doc: changed.then(|| stamped(&doc)),
        });
    }
    Some(frames)
}

/// A value as the trial compares it: a number, the JSON, or a typed value's digest.
fn reading(v: &Val) -> Value {
    if let Some(x) = v.as_typed::<f64>() {
        return json!(*x);
    }
    if let Some(x) = v.as_typed::<f32>() {
        return json!(f64::from(*x));
    }
    match v {
        Val::None => Value::Null,
        Val::Json(j) => (**j).clone(),
        Val::Typed(_) => json!({"bytes": sha256_hex(&v.bytes())}),
    }
}

/// Plays `frames` on one new instance, loading each changed document, and reads every value
/// of `arrays` after each: `[{step, t, values: {item: {array: value}}}]`.
fn play(sealed: &Sealed, look: &Tokens, arrays: &[String], mut frames: Vec<Frame>) -> Value {
    let first = frames
        .first_mut()
        .and_then(|f| f.doc.take())
        .unwrap_or(Value::Null);
    instance::fresh(|| {
        let mut s = Scheduler::new(sealed, How::default().options());
        let mut session = instance::session(&mut s, &first, look, &BTreeMap::new());
        let view = instance::view(&first);
        let out: Vec<Value> = frames
            .into_iter()
            .map(|f| {
                if let Some(doc) = f.doc {
                    session.load(&mut s, &doc);
                }
                session.frame(&mut s, f.t, &view);
                let mut values = Map::new();
                for a in arrays {
                    for (item, v) in session.values(&s, a) {
                        let slot = values
                            .entry(item.unwrap_or("").to_string())
                            .or_insert_with(|| json!({}));
                        slot[a.as_str()] = reading(&v);
                    }
                }
                json!({"step": f.step, "t": f.t, "values": values})
            })
            .collect();
        Value::Array(out)
    })
}

/// Runs one replica: `bin run` with a scenario whose one call is `call`; its reply.
fn replica(bin: &Path, evidence: &Path, call: Value) -> Result<Value, String> {
    let scenario = json!({"evidence": evidence, "calls": [call]});
    let mut child = Command::new(bin)
        .arg("run")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("{}: {e}", bin.display()))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(format!("{scenario}\n").as_bytes())
            .map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    let answer: Value = serde_json::from_slice(&out.stdout).unwrap_or(Value::Null);
    let reply = answer["replies"][0].clone();
    if reply["ok"] != true {
        let err = String::from_utf8_lossy(&out.stderr);
        let tail = &err[err.len().saturating_sub(800)..];
        return Err(format!(
            "{} exited {}: {answer} {tail}",
            bin.display(),
            out.status
        ));
    }
    Ok(reply)
}

/// One input's result: `equal`, `within` the loosest of the tightest behavior tolerances that
/// hold each difference, or the first item, step and field whose difference none holds.
/// `answers` are the behavior part's (fixture, array, tolerance), tightest first.
fn compare(ours: &Value, theirs: &Value, answers: &[(String, String, f64)]) -> Value {
    let differs = |item: &str, step: &Value, field: &str| json!({"differs": {"item": item, "step": step, "field": field}});
    let (Some(a), Some(b)) = (ours.as_array(), theirs.as_array()) else {
        return differs("", &json!(0), "frames");
    };
    if a.len() != b.len() {
        return differs("", &json!(0), "frames");
    }
    let keys = |x: &Value, y: &Value| -> BTreeSet<String> {
        [x, y]
            .into_iter()
            .filter_map(Value::as_object)
            .flat_map(|m| m.keys().cloned())
            .collect()
    };
    let mut within: Option<(f64, &str)> = None;
    for (fa, fb) in a.iter().zip(b) {
        for item in keys(&fa["values"], &fb["values"]) {
            let (va, vb) = (&fa["values"][&item], &fb["values"][&item]);
            for field in keys(va, vb) {
                let (x, y) = (&va[&field], &vb[&field]);
                if x == y {
                    continue;
                }
                let held = match (x.as_f64(), y.as_f64()) {
                    (Some(x), Some(y)) => answers
                        .iter()
                        .find(|(_, array, tol)| *array == field && (x - y).abs() <= tol * x.abs()),
                    _ => None,
                };
                let Some((fixture, _, tol)) = held else {
                    return differs(&item, &fa["step"], &field);
                };
                if within.is_none_or(|(t, _)| *tol > t) {
                    within = Some((*tol, fixture));
                }
            }
        }
    }
    match within {
        None => json!("equal"),
        Some((tolerance, fixture)) => {
            json!({"within": {"fixture": fixture, "tolerance": tolerance}})
        }
    }
}

impl<'a> Hub<'a> {
    pub fn trial_call(&mut self, call: &TrialCall) -> Value {
        match call {
            TrialCall::Record {
                store,
                document,
                steps,
                entries,
            } => track_record(store, document, *steps, entries),
            TrialCall::Trial {
                candidate,
                build,
                corpus,
                store,
                tracks,
            } => self.trial(candidate, build, corpus, store, tracks),
            TrialCall::Replay {
                of,
                corpus,
                store,
                tracks,
            } => self.trial_replay(of, corpus, store, tracks),
        }
    }

    /// A replica's replay of every input on this build's implementation of `of`.
    fn trial_replay(&self, of: &str, corpus: &Path, store: &Path, tracks: &[String]) -> Value {
        let sealed = &self.startup.sealed;
        let Some(iface) = sealed
            .interfaces
            .iter()
            .find(|i| i.name == of || i.implementation.name == of)
        else {
            return json!({"outcome": "refused", "code": "ref_unresolved", "interface": of});
        };
        let module = iface.module.as_str();
        let arrays: Vec<String> = sealed
            .arrays
            .iter()
            .filter(|(_, a)| a.owner == module && !a.private)
            .map(|(name, _)| name.clone())
            .collect();
        let look = deep_canvas_marks::modules::tokens(&self.look.light);
        let mut inputs = Vec::new();
        for (name, file) in migration::corpus_files(corpus) {
            let doc = &file["document"];
            if !migration::uses(self, doc, module) {
                continue;
            }
            let times: Vec<i64> = file["times"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_i64)
                .collect();
            let frames = times
                .iter()
                .enumerate()
                .map(|(k, &t)| Frame {
                    step: k as u64,
                    t,
                    doc: (k == 0).then(|| doc.clone()),
                })
                .collect();
            // What this build draws of it: the snapshot a switch to this build moves.
            let (values, snapshots) = migration::drawn_json(&migration::draw(self, doc, &times));
            inputs.push(
                json!({"input": {"corpus": name}, "frames": play(sealed, &look, &arrays, frames),
                               "drawn": {"values": values, "snapshots": snapshots}}),
            );
        }
        let parity = sealed
            .modules
            .iter()
            .filter(|m| m.name == module)
            .flat_map(|m| &m.shapes.fixtures)
            .filter(|f| !f.category.is_empty());
        for f in parity {
            let frames = vec![Frame {
                step: 0,
                t: 0,
                doc: Some(stamped(&f.document)),
            }];
            inputs.push(json!({"input": {"fixture": f.name}, "frames": play(sealed, &look, &arrays, frames)}));
        }
        for hash in tracks {
            let track = is_hex(hash, 64)
                .then(|| read_json(&store.join(format!("{hash}.json"))))
                .flatten();
            let Some(frames) = track.as_ref().and_then(track_frames) else {
                return json!({"outcome": "refused", "code": "ref_unresolved", "track": hash});
            };
            inputs.push(
                json!({"input": {"track": hash}, "frames": play(sealed, &look, &arrays, frames)}),
            );
        }
        json!({"ok": true, "interface": iface.name, "implementation": iface.implementation.name,
               "set_digest": sealed.set_digest, "inputs": inputs})
    }

    /// `{"call": "trial"}`: a replica of `build` and one of this build replay the same inputs;
    /// each input's result, kept in the evidence folder for your decision. Nothing switches.
    fn trial(
        &mut self,
        candidate: &str,
        build: &Path,
        corpus: &Path,
        store: &Path,
        tracks: &[String],
    ) -> Value {
        let evidence = self.scenario.evidence.clone();
        let call = |of: &str| json!({"call": "trial_replay", "of": of, "corpus": corpus, "store": store, "tracks": tracks});
        let failed =
            |what: String| json!({"outcome": "refused", "code": "replica_failed", "what": what});
        let theirs = match replica(build, &evidence, call(candidate)) {
            Ok(r) => r,
            Err(what) => return failed(what),
        };
        if theirs["implementation"] != candidate {
            return json!({"outcome": "refused", "code": "not_the_candidate",
                          "implementation": theirs["implementation"]});
        }
        let interface = theirs["interface"].as_str().unwrap_or("").to_string();
        let ours = match std::env::current_exe()
            .map_err(|e| e.to_string())
            .and_then(|exe| replica(&exe, &evidence, call(&interface)))
        {
            Ok(r) => r,
            Err(what) => return failed(what),
        };
        let mut answers: Vec<(String, String, f64)> = self
            .startup
            .sealed
            .interfaces
            .iter()
            .filter(|i| i.name == interface)
            .filter_map(|i| i.behavior.as_ref())
            .flat_map(|b| &b.fixtures)
            .flat_map(|f| {
                f.answers
                    .iter()
                    .map(|a| (f.name.clone(), a.array.clone(), a.tolerance))
            })
            .collect();
        answers.sort_by(|x, y| x.2.total_cmp(&y.2));
        let empty = Vec::new();
        let inputs = |r: &Value| r["inputs"].as_array().unwrap_or(&empty).clone();
        let (ours_in, theirs_in) = (inputs(&ours), inputs(&theirs));
        let mut keys: Vec<&Value> = ours_in.iter().map(|i| &i["input"]).collect();
        keys.extend(
            theirs_in
                .iter()
                .map(|i| &i["input"])
                .filter(|k| !ours_in.iter().any(|i| i["input"] == **k)),
        );
        let find = |list: &[Value], key: &Value| {
            list.iter()
                .find(|i| i["input"] == *key)
                .map(|i| i["frames"].clone())
                .unwrap_or(Value::Null)
        };
        let results: Vec<Value> = keys
            .iter()
            .map(|k| {
                let result = compare(&find(&ours_in, k), &find(&theirs_in, k), &answers);
                json!({"input": k, "result": result})
            })
            .collect();
        let drawn: Map<String, Value> = theirs_in
            .iter()
            .filter_map(|i| {
                Some((
                    i["input"]["corpus"].as_str()?.to_string(),
                    i["drawn"].clone(),
                ))
            })
            .collect();
        let replicas = json!([
            {"implementation": ours["implementation"], "set_digest": ours["set_digest"], "build": "in_use"},
            {"implementation": theirs["implementation"], "set_digest": theirs["set_digest"], "build": build},
        ]);
        let hash = sha256_hex(&canonical(&json!({"replicas": replicas, "corpus": corpus,
                                                  "tracks": tracks, "results": results})));
        let id = format!("trial-{}", &hash[..12]);
        let path = trial_path(&evidence, &id).expect("a trial ID");
        // The same trial again keeps its record, and with it any decision already made on it.
        if !path.exists() {
            let record = json!({"trial": id, "interface": interface, "in_use": ours["implementation"],
                                "candidate": candidate, "set_digest": theirs["set_digest"],
                                "corpus": corpus, "results": results, "drawn": drawn});
            if let Err(e) = write_json(&path, &record) {
                return json!({"outcome": "refused", "code": "store_unwritable", "what": e.to_string()});
            }
        }
        json!({"ok": true, "trial": id, "interface": interface, "replicas": replicas,
               "results": results, "switched": false})
    }

    /// Your decision to switch `interface` to the trial's candidate: each input the trial found
    /// changed moves once, naming the decision `id` as its cause, a corpus document's snapshot
    /// accepted under the candidate's set; the same decision again moves nothing.
    pub(crate) fn switch(&mut self, d: &Value, id: &str) -> Value {
        let (Some(interface), Some(to), Some(trial)) = (
            d["interface"].as_str(),
            d["to"].as_str(),
            d["trial"].as_str(),
        ) else {
            return refused("out_of_range");
        };
        let Some(path) = trial_path(&self.scenario.evidence, trial) else {
            return refused("ref_unresolved");
        };
        let Some(mut record) = read_json(&path) else {
            return refused("ref_unresolved");
        };
        if record["interface"] != interface || record["candidate"] != to {
            return refused("out_of_range");
        }
        if let Some(earlier) = record["decision"].as_str() {
            return json!({"outcome": "decided", "decision": earlier, "moved": []});
        }
        let corpus = PathBuf::from(record["corpus"].as_str().unwrap_or(""));
        let mut moved = Vec::new();
        for r in record["results"].as_array().into_iter().flatten() {
            if r["result"] == "equal" {
                continue;
            }
            if let Some(name) = r["input"]["corpus"].as_str() {
                let drawn = &record["drawn"][name];
                let entry = json!({"cause": id, "decision": id, "set_digest": record["set_digest"],
                                   "values": drawn["values"], "snapshots": drawn["snapshots"]});
                let file = corpus.join(format!("{name}.json"));
                if let Err(what) = migration::accept_into(&file, |_| entry) {
                    return json!({"outcome": "refused", "code": "ref_unresolved", "what": what});
                }
            }
            moved.push(
                json!({"input": r["input"], "cause": id, "from": record["in_use"], "to": to,
                              "result": r["result"]}),
            );
        }
        record["decision"] = json!(id);
        record["moved"] = json!(moved);
        if write_json(&path, &record).is_err() {
            return refused("store_unwritable");
        }
        json!({"outcome": "decided", "decision": id, "moved": moved})
    }
}

/// `{"call": "track_record"}`: the track kept in `store` by its hash, once each entry is a
/// `set` of a field its document's item holds, at a step of the track.
fn track_record(store: &Path, document: &Value, steps: u64, entries: &[Value]) -> Value {
    let bad = entries.iter().position(|e| {
        e["kind"] != "set"
            || e["step"].as_u64().is_none_or(|s| s > steps)
            || pointer(e).is_none_or(|p| document.pointer(&p).is_none())
    });
    if steps == 0 || bad.is_some() {
        return json!({"outcome": "refused", "code": "out_of_range", "entry": bad});
    }
    let track = json!({"document": document, "steps": steps, "entries": entries});
    let hash = sha256_hex(&canonical(&track));
    match write_json(&store.join(format!("{hash}.json")), &track) {
        Ok(()) => json!({"ok": true, "track": hash, "steps": steps}),
        Err(e) => json!({"outcome": "refused", "code": "store_unwritable", "what": e.to_string()}),
    }
}
