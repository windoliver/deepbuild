//! Goldens and decisions (issue #138; technical design: the parity suite, Independent first
//! oracles and golden triage). A fixture's snapshot on a backend is judged against the golden
//! store: each digest is positive, negative (known wrong, kept with its bug) or untriaged, with at
//! most one positive per backend fingerprint; only a match to a positive passes, a negative fails
//! naming its bug, and an untriaged digest, as an agent's re-record arrives, decides nothing. A
//! GPU golden compares only under an equal environment digest. Only your decision blesses a
//! golden, loosens a tolerance, waives a fixture, re-blesses after an OS or driver update (one
//! decision for every golden the cause changed, at the commit each was recorded at) or accepts a
//! corpus document's new result; an agent's is refused, naming it.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use deep_canvas::schedule::{sha256_hex, Scheduler};
use deep_canvas::show::WriterKind;
use deep_canvas_marks::scene::{Fill, Mark};
use serde_json::{json, Map, Value};

use super::catalog::stamped;
use super::gpu;
use super::instance::{self, How, Painter};
use super::manifest::{Entry, Manifest};
use crate::hub::{Hub, Planted, Via};

/// What a backend made of a fixture's frame.
pub enum Render {
    Pixels {
        rgba: Vec<u8>,
    },
    /// The probe the backend can't make.
    Blocked(&'static str),
    /// The frame can't be drawn: its code.
    Unfit(String),
}

/// The machine's GPU lease: one kit at a time draws on the GPU. Held until dropped.
pub struct GpuLease(Option<PathBuf>);

impl GpuLease {
    pub fn take() -> GpuLease {
        let dir = std::env::var_os("HOME")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join(".cache")
            .join("deepbuild-gpu");
        let _ = std::fs::create_dir_all(&dir);
        let file = dir.join("lease");
        for _ in 0..600 {
            match std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&file)
            {
                Ok(mut f) => {
                    use std::io::Write as _;
                    let _ = write!(f, "{}", std::process::id());
                    return GpuLease(Some(file));
                }
                Err(_) => {
                    // A lease whose holder is gone was left by a killed run.
                    let holder: Option<i32> = std::fs::read_to_string(&file)
                        .ok()
                        .and_then(|s| s.trim().parse().ok());
                    let alive = holder.is_some_and(|pid| {
                        std::process::Command::new("kill")
                            .args(["-0", &pid.to_string()])
                            .status()
                            .is_ok_and(|s| s.success())
                    });
                    if !alive {
                        let _ = std::fs::remove_file(&file);
                        continue;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(500));
                }
            }
        }
        GpuLease(None)
    }
}

impl Drop for GpuLease {
    fn drop(&mut self) {
        if let Some(f) = &self.0 {
            let _ = std::fs::remove_file(f);
        }
    }
}

/// The kinds whose items only a GPU pass fills, with the pass's shader.
fn passes(hub: &Hub<'_>) -> BTreeMap<String, &'static str> {
    hub.startup
        .sealed
        .modules
        .iter()
        .flat_map(|m| m.shapes.passes.iter())
        .filter(|p| !p.kind.is_empty())
        .map(|p| (p.kind.clone(), p.shader))
        .collect()
}

/// Whether a document holds an item only a GPU pass fills.
pub fn needs_gpu(hub: &Hub<'_>, doc: &Value) -> bool {
    let passes = passes(hub);
    doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .any(|(_, i)| {
            i["kind"]
                .as_str()
                .and_then(deep_canvas::kinds::parse_kind)
                .is_some_and(|(full, _)| passes.contains_key(&full))
        })
}

/// A fixture's frame at `t` on `backend`.
pub fn render(hub: &Hub<'_>, doc: &Value, backend: &str, t: i64) -> Render {
    let gpu_only = needs_gpu(hub, doc);
    match backend {
        "noop" => {
            // The noop device runs the frame's device work and returns no pixels.
            gpu::noop_device();
            return Render::Blocked(if gpu_only { "gpu pixels" } else { "pixels" });
        }
        "vello_cpu" if gpu_only => return Render::Blocked("gpu pixels"),
        _ => {}
    }
    let sealed = &hub.startup.sealed;
    let look = deep_canvas_marks::modules::tokens(&hub.look.light);
    let ground = hub.look.light.get("ground").copied().unwrap_or([255; 3]);
    let evidence = hub.scenario.evidence.clone();
    let size = instance::fit(doc, 4096.0);
    let kinds: BTreeMap<String, String> = doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, v)| (k.clone(), v["kind"].as_str().unwrap_or("").to_string()))
        .collect();
    let passes = passes(hub);
    let boxes: BTreeMap<String, [f64; 4]> = doc["items"]
        .as_object()
        .into_iter()
        .flatten()
        .filter_map(|(k, v)| {
            let b: Vec<f64> = v["params"]["box"]
                .as_array()?
                .iter()
                .filter_map(Value::as_f64)
                .collect();
            Some((k.clone(), <[f64; 4]>::try_from(b.as_slice()).ok()?))
        })
        .collect();
    let gpu_backend = backend == "gpu";
    instance::fresh(move || {
        let mut s = Scheduler::new(sealed, How::default().options());
        let mut session = instance::session(&mut s, doc, &look, &BTreeMap::new());
        session.frame(&mut s, t, &instance::view(doc));
        if !gpu_backend {
            let mut painter = Painter::new(evidence, ground);
            return match painter.pixels(&s, &session, size) {
                Ok(rgba) => Render::Pixels { rgba },
                Err(code) => Render::Unfit(code),
            };
        }
        let Some(drawing) = crate::frames::drawing_of(&s, &session).and_then(|p| p.drawing) else {
            return Render::Unfit("no_drawing".into());
        };
        let mut quads = Vec::new();
        for d in drawing.frame.layers.iter().flat_map(|l| &l.marks) {
            if let Mark::Rect {
                item,
                bounds,
                fill: Fill::Solid(c),
                ..
            } = &d.mark
            {
                let pass = kinds
                    .get(item)
                    .and_then(|k| deep_canvas::kinds::parse_kind(k))
                    .and_then(|(full, _)| passes.get(&full).copied());
                // A pass fills its item's own box; the core fills what marks2d drew.
                let bounds = match (pass, boxes.get(item)) {
                    (Some(_), Some(b)) => *b,
                    _ => *bounds,
                };
                quads.push(gpu::Quad {
                    bounds,
                    color: [c[0], c[1], c[2], 255],
                    shader: pass.unwrap_or(""),
                });
            }
        }
        match gpu::draw(size, ground, drawing.frame.size, &quads) {
            Ok(rgba) => Render::Pixels { rgba },
            Err(_) => Render::Blocked("gpu pixels"),
        }
    })
}

/// The environment a backend renders in, as this run reports it: the scenario's OS and driver
/// over the machine's.
pub fn environment(hub: &Hub<'_>, backend: &str) -> (String, String) {
    let env = &hub.scenario.environment;
    let os = env
        .get("os")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| std::env::consts::OS.to_string());
    let (adapter, machine_driver) = match backend {
        "gpu" => gpu::adapter_info().unwrap_or_else(|| ("none".into(), "none".into())),
        "vello_cpu" => ("vello_cpu 0.3".into(), "cpu".into()),
        _ => ("wgpu noop".into(), "none".into()),
    };
    let driver = env
        .get("driver")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or(machine_driver);
    let fingerprint = format!("{backend}/{adapter}/{os}/{driver}");
    let digest = sha256_hex(&deep_canvas::schedule::canonical(&json!({
        "backend": backend, "adapter": adapter, "os": os, "driver": driver,
    })));
    (digest, fingerprint)
}

/// The commit this run renders at: the scenario's, else the checkout's HEAD.
pub fn commit(hub: &Hub<'_>) -> String {
    if let Some(c) = &hub.scenario.commit {
        return c.clone();
    }
    std::process::Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".into())
}

/// The golden store's file.
fn store_path(hub: &Hub<'_>) -> PathBuf {
    let dir = hub.scenario.goldens.clone().unwrap_or_else(|| {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("parity")
            .join("goldens")
    });
    dir.join("store.json")
}

fn load(path: &Path) -> Value {
    std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(|| json!({"fixtures": {}, "decisions": []}))
}

fn save(path: &Path, store: &Value) {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let _ = std::fs::write(path, serde_json::to_vec_pretty(store).unwrap_or_default());
}

/// A fixture's frame on a backend, its digest, and the store's verdict on it.
pub struct Judged {
    pub verdict: &'static str,
    pub reply: Value,
}

impl<'a> Hub<'a> {
    fn fixture_entry(&self, name: &str) -> Option<Entry> {
        Manifest::of(self).find(name).cloned()
    }

    /// The sidecar criteria a GPU golden's first blessing waits for: each check of the fixture
    /// whose oracle is analytic or the CPU reference, run on this commit; the first that fails.
    pub fn first_blessing_blocked(&self, f: &Entry) -> Option<String> {
        for (i, check) in f.checks().into_iter().enumerate() {
            let oracle = match check.get("render").and_then(Value::as_str) {
                Some("cpu_reference") => "cpu_reference",
                _ if check.get("probe").and_then(Value::as_str) == Some("bounds") => "analytic",
                _ => continue,
            };
            if !super::fixtures::criterion_holds(self, f, check) {
                return Some(format!("{}#check{i}:{oracle}", f.name));
            }
        }
        None
    }

    /// Judges a fixture's frame on `backend` against the store.
    pub fn judge_golden(&self, f: &Entry, backend: &str) -> Judged {
        let (environment, fingerprint) = environment(self, backend);
        let commit = commit(self);
        let mut reply = json!({"verdict": "BLOCKED", "digest": null, "environment": environment,
                               "fingerprint": fingerprint, "commit": commit, "match": null, "ask": null});
        let doc = stamped(&f.document);
        let pixels = match render(self, &doc, backend, 0) {
            Render::Pixels { rgba, .. } => rgba,
            Render::Blocked(probe) => {
                reply["probe"] = json!(probe);
                reply["reason"] = json!("probe");
                return Judged {
                    verdict: "BLOCKED",
                    reply,
                };
            }
            Render::Unfit(code) => {
                reply["verdict"] = json!("FAIL");
                reply["reason"] = json!(code);
                return Judged {
                    verdict: "FAIL",
                    reply,
                };
            }
        };
        let digest = sha256_hex(&pixels);
        reply["digest"] = json!(digest);
        let store = load(&store_path(self));
        let entries: Vec<Value> = store["fixtures"][&f.name]["digests"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|d| d["backend"] == backend)
            .cloned()
            .collect();
        let every_positive = self.planted(Planted::EveryDigestPositive);
        let state_of = |d: &Value| -> String {
            if every_positive {
                "positive".into()
            } else {
                d["state"].as_str().unwrap_or("untriaged").to_string()
            }
        };
        let same_env: Vec<&Value> = entries
            .iter()
            .filter(|d| d["environment"] == environment.as_str())
            .collect();
        let (verdict, reason) = if entries.is_empty() {
            match self.first_blessing_blocked(f) {
                Some(criterion) => {
                    reply["criterion"] = json!(criterion);
                    ("BLOCKED", "criterion_failed")
                }
                None => {
                    reply["ask"] = json!({"kind": "bless", "fixture": f.name, "digest": digest});
                    ("BLOCKED", "no_golden")
                }
            }
        } else if let Some(m) = same_env.iter().find(|d| d["digest"] == digest.as_str()) {
            let state = state_of(m);
            let mut matched = json!({"digest": digest, "state": state});
            if let Some(bug) = m.get("bug") {
                matched["bug"] = bug.clone();
            }
            reply["match"] = matched;
            match state.as_str() {
                "positive" => ("PASS", "positive"),
                "negative" => ("FAIL", "negative"),
                _ => ("BLOCKED", "untriaged"),
            }
        } else if same_env.iter().any(|d| state_of(d) == "positive") {
            ("FAIL", "pixels_changed")
        } else if entries.iter().any(|d| state_of(d) == "positive") {
            ("BLOCKED", "environment_changed")
        } else {
            ("BLOCKED", "untriaged")
        };
        reply["verdict"] = json!(verdict);
        reply["reason"] = json!(reason);
        Judged { verdict, reply }
    }

    /// `{"call": "golden"}`.
    pub fn golden_reply(&mut self, fixture: &str, backend: &str) -> Value {
        let Some(f) = self.fixture_entry(fixture) else {
            return json!({"outcome": "refused", "code": "ref_unresolved", "fixture": fixture});
        };
        let lease = (backend == "gpu").then(GpuLease::take);
        let out = self.judge_golden(&f, backend).reply;
        drop(lease);
        out
    }

    /// Who a decision or a record comes from: the writer, and whether it is you.
    fn decider(&self, via: Option<&Via>) -> (Value, bool) {
        let Some(via) = via else {
            return (json!({"kind": "you", "id": "you"}), true);
        };
        match self.writer(via) {
            Some((w, _)) => {
                let you = w.kind == WriterKind::You;
                (w.to_json(), you)
            }
            None => (json!({"kind": "unknown", "id": ""}), false),
        }
    }

    /// `{"call": "record"}`: the fixture's frame recorded untriaged, by whoever calls.
    pub fn record_reply(&mut self, via: Option<&Via>, fixture: &str, backend: &str) -> Value {
        let Some(f) = self.fixture_entry(fixture) else {
            return json!({"outcome": "refused", "code": "ref_unresolved", "fixture": fixture});
        };
        let lease = (backend == "gpu").then(GpuLease::take);
        let doc = stamped(&f.document);
        let rendered = render(self, &doc, backend, 0);
        drop(lease);
        let Render::Pixels { rgba, .. } = rendered else {
            return json!({"outcome": "refused", "code": "probe_unavailable", "backend": backend});
        };
        let digest = sha256_hex(&rgba);
        let (environment, fingerprint) = environment(self, backend);
        let (writer, _) = self.decider(via);
        let path = store_path(self);
        let mut store = load(&path);
        let list = digests_mut(&mut store, &f.name);
        if !list.iter().any(|d| {
            d["digest"] == digest.as_str()
                && d["backend"] == backend
                && d["environment"] == environment.as_str()
        }) {
            list.push(
                json!({"digest": digest, "state": "untriaged", "backend": backend,
                             "fingerprint": fingerprint, "environment": environment,
                             "commit": commit(self), "recorded_by": writer}),
            );
        }
        save(&path, &store);
        json!({"outcome": "recorded", "digest": digest, "state": "untriaged"})
    }

    /// `{"call": "goldens"}`.
    pub fn goldens_reply(&self, fixture: &str) -> Value {
        let store = load(&store_path(self));
        let digests = store["fixtures"][fixture]["digests"].clone();
        let first = store["fixtures"][fixture]["first_oracle"].clone();
        let standing = if first.is_string() {
            "truth"
        } else {
            "regression_only"
        };
        json!({"digests": if digests.is_array() { digests } else { json!([]) },
               "first_oracle": first, "standing": standing})
    }

    /// The fixture whose expected value was set outside the implementation and whose check
    /// passes, for a golden of `f`'s kinds: its first oracle.
    fn first_oracle(&self, f: &Entry) -> Option<String> {
        let kinds: Vec<String> = f.document["items"]
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(_, i)| i["kind"].as_str().map(str::to_string))
            .collect();
        let manifest = Manifest::of(self);
        manifest
            .of_module(&f.module)
            .into_iter()
            .filter(|o| o.sidecar.get("expected_from").is_some() && o.name != f.name)
            .filter(|o| {
                o.document["items"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .any(|(_, i)| {
                        i["kind"]
                            .as_str()
                            .is_some_and(|k| kinds.iter().any(|x| x == k))
                    })
            })
            .find(|o| {
                o.checks()
                    .into_iter()
                    .all(|c| super::fixtures::criterion_holds(self, o, c))
            })
            .map(|o| o.name.clone())
    }

    /// `{"call": "decide"}`: one decision, only from you.
    pub fn decide(&mut self, via: Option<&Via>, decision: &Value) -> Value {
        let (writer, you) = self.decider(via);
        if !you && !self.planted(Planted::AcceptsAgentDecisions) {
            return json!({"outcome": "refused", "code": "not_your_decision", "writer": writer});
        }
        let path = store_path(self);
        let mut store = load(&path);
        let n = store["decisions"].as_array().map_or(0, Vec::len);
        let id = format!(
            "dec-{n:04}-{}",
            &sha256_hex(&deep_canvas::schedule::canonical(decision))[..12]
        );
        let refused = |code: &str| json!({"outcome": "refused", "code": code});
        let mut reply = json!({"outcome": "decided", "decision": id, "fixtures": []});
        if let Some(d) = decision.get("bless") {
            let (Some(fixture), Some(digest), Some(backend)) = (
                d["fixture"].as_str(),
                d["digest"].as_str(),
                d["backend"].as_str(),
            ) else {
                return refused("out_of_range");
            };
            let Some(f) = self.fixture_entry(fixture) else {
                return refused("ref_unresolved");
            };
            let first = digests_mut(&mut store, fixture)
                .iter()
                .all(|x| x["state"] != "positive");
            if first && backend == "gpu" {
                if let Some(criterion) = self.first_blessing_blocked(&f) {
                    return json!({"outcome": "refused", "code": "criterion_failed", "criterion": criterion});
                }
            }
            let oracle = self.first_oracle(&f);
            let list = digests_mut(&mut store, fixture);
            let Some(k) = list
                .iter()
                .position(|x| x["digest"] == digest && x["backend"] == backend)
            else {
                return refused("ref_unresolved");
            };
            let print = list[k]["fingerprint"].clone();
            for (j, x) in list.iter_mut().enumerate() {
                if j != k
                    && x["state"] == "positive"
                    && x["backend"] == backend
                    && x["fingerprint"] == print
                {
                    x["state"] = json!("untriaged");
                }
            }
            list[k]["state"] = json!("positive");
            list[k]["decision"] = json!(id);
            let slot = &mut store["fixtures"][fixture];
            if !slot["first_oracle"].is_string() {
                slot["first_oracle"] = json!(oracle);
            }
            let standing = if slot["first_oracle"].is_string() {
                "truth"
            } else {
                "regression_only"
            };
            reply["fixtures"] = json!([fixture]);
            reply["first_oracle"] = slot["first_oracle"].clone();
            reply["standing"] = json!(standing);
        } else if let Some(d) = decision.get("negative") {
            let (Some(fixture), Some(digest), Some(backend), Some(bug)) = (
                d["fixture"].as_str(),
                d["digest"].as_str(),
                d["backend"].as_str(),
                d["bug"].as_str(),
            ) else {
                return refused("out_of_range");
            };
            let list = digests_mut(&mut store, fixture);
            let Some(x) = list
                .iter_mut()
                .find(|x| x["digest"] == digest && x["backend"] == backend)
            else {
                return refused("ref_unresolved");
            };
            x["state"] = json!("negative");
            x["bug"] = json!(bug);
            x["decision"] = json!(id);
            reply["fixtures"] = json!([fixture]);
        } else if let Some(d) = decision.get("loosen") {
            let Some(fixture) = d["fixture"].as_str() else {
                return refused("out_of_range");
            };
            store["fixtures"][fixture]["tolerance"] =
                json!({"tolerance": d["tolerance"], "reason": d["reason"], "decision": id});
            reply["fixtures"] = json!([fixture]);
        } else if let Some(d) = decision.get("waive") {
            let Some(fixture) = d["fixture"].as_str() else {
                return refused("out_of_range");
            };
            store["fixtures"][fixture]["waived"] = json!({"reason": d["reason"], "decision": id});
            reply["fixtures"] = json!([fixture]);
        } else if let Some(d) = decision.get("rebless") {
            let Some(backend) = d["backend"].as_str() else {
                return refused("out_of_range");
            };
            let (environment, _) = environment(self, backend);
            let now = commit(self);
            // Every golden of the backend whose positive was blessed under another environment.
            let mut changed: Vec<(String, String)> = Vec::new();
            for (fixture, slot) in store["fixtures"].as_object().into_iter().flatten() {
                let list = slot["digests"].as_array().cloned().unwrap_or_default();
                let positives: Vec<&Value> = list
                    .iter()
                    .filter(|x| x["backend"] == backend && x["state"] == "positive")
                    .collect();
                if !positives.is_empty()
                    && positives
                        .iter()
                        .all(|x| x["environment"] != environment.as_str())
                {
                    let recorded = positives[0]["commit"].as_str().unwrap_or("").to_string();
                    changed.push((fixture.clone(), recorded));
                }
            }
            let wrong: Vec<&String> = changed
                .iter()
                .map(|(_, c)| c)
                .filter(|c| **c != now)
                .collect();
            if !wrong.is_empty() {
                let mut recorded: Vec<String> = changed.iter().map(|(_, c)| c.clone()).collect();
                recorded.sort();
                recorded.dedup();
                return json!({"outcome": "refused", "code": "wrong_commit", "commit": now, "recorded": recorded});
            }
            let lease = (backend == "gpu").then(GpuLease::take);
            let mut fixtures = Vec::new();
            for (fixture, _) in &changed {
                let Some(f) = self.fixture_entry(fixture) else {
                    continue;
                };
                let Render::Pixels { rgba, .. } = render(self, &stamped(&f.document), backend, 0)
                else {
                    continue;
                };
                let digest = sha256_hex(&rgba);
                let (environment, fingerprint) = super::goldens::environment(self, backend);
                let list = digests_mut(&mut store, fixture);
                list.push(json!({"digest": digest, "state": "positive", "backend": backend,
                                 "fingerprint": fingerprint, "environment": environment, "commit": now,
                                 "recorded_by": {"kind": "you", "id": "you"}, "decision": id}));
                fixtures.push(fixture.clone());
            }
            drop(lease);
            reply["fixtures"] = json!(fixtures);
        } else if let Some(d) = decision.get("accept_corpus") {
            let (Some(corpus), Some(name), Some(cause)) = (
                d["corpus"].as_str(),
                d["name"].as_str(),
                d["cause"].as_str(),
            ) else {
                return refused("out_of_range");
            };
            if let Err(what) = self.accept_corpus(Path::new(corpus), name, cause, &id) {
                return json!({"outcome": "refused", "code": "ref_unresolved", "what": what});
            }
            // The corpus file keeps the decision beside the result it accepted.
            reply["fixtures"] = json!([format!("corpus/{name}")]);
            return reply;
        } else {
            return refused("out_of_range");
        }
        if !store["decisions"].is_array() {
            store["decisions"] = json!([]);
        }
        store["decisions"]
            .as_array_mut()
            .expect("a list")
            .push(json!({"decision": id, "by": writer, "what": decision}));
        save(&path, &store);
        reply
    }
}

/// A fixture's digest list in the store, made when absent.
fn digests_mut<'s>(store: &'s mut Value, fixture: &str) -> &'s mut Vec<Value> {
    if !store["fixtures"].is_object() {
        store["fixtures"] = json!({});
    }
    let slot = &mut store["fixtures"][fixture];
    if !slot.is_object() {
        *slot = Value::Object(Map::new());
    }
    if !slot["digests"].is_array() {
        slot["digests"] = json!([]);
    }
    slot["digests"].as_array_mut().expect("a list")
}
