//! The logic module (canvas primitives: Logic `logic@1`; technical design: The logic module; #531):
//! a logic item's program, by hash, checked and rewritten by sandbox@1 (#238) in the role
//! `logic`, stepped at its own rate with its read and write regions, its step seed and traps that
//! freeze only its item, with checkpoints, restores, continuation probes, traps by source line and
//! logic.budget. #532 adds the checkpoint ring's byte budget, bake keys, seeks, goldens,
//! logic.determinism, logic.budget's fixed cost, data assets and a live view whose seeks run
//! across frames; #534 adds saves, written whole, opened by the viewer, refused or migrated.
//! `deep-logic` serves it as JSON lines (the #531, #532 and #534 acceptance READMEs: deep-logic),
//! and `web/logic.mjs` is the web player's runtime for the same rewritten bytes.

pub mod budget;
pub mod checks;
pub mod lines;
pub mod live;
pub mod piece;
pub mod saves;
pub mod world;

use std::collections::BTreeMap;
use std::rc::Rc;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use deep_canvas_sandbox::rewrite;
use serde_json::{json, Map, Value};

use piece::{History, Piece};
use world::{track_of, Entry, Record, World};

/// The web player's logic runtime, served after sandbox@1's web runner as one ES module with no
/// imports, on the browser's own WebAssembly.
pub const WEB_RUNNER: &str = include_str!("../web/logic.mjs");

/// The planted twins `deep-logic --planted <name>` runs, each one criterion's wrong program.
#[derive(Clone, Copy, Debug, Default)]
pub struct Planted {
    pub rewrite: rewrite::Faults,
    pub runs_unchecked: bool,
    pub digest_total_sizes: bool,
    pub mapper_ignores_shift: bool,
    pub budget_first_line: bool,
    pub check_step_hashes_only: bool,
    pub budget_sums_only_fuel: bool,
    pub checkpoint_drops_globals: bool,
    pub restore_keeps_regions_only: bool,
    pub restore_copies_assets: bool,
    pub simulate_runs_all_steps: bool,
    pub save_drops_globals: bool,
    pub save_drops_input_position: bool,
    pub open_reapplies_segments: bool,
}

impl Planted {
    /// Each named twin applied to `self`; None for an unknown name.
    pub fn and(mut self, name: &str) -> Option<Planted> {
        let p = &mut self;
        match name {
            "check_compares_step_hashes" => p.check_step_hashes_only = true,
            "budget_sums_fuel_only" => p.budget_sums_only_fuel = true,
            "checkpoint_drops_globals" => p.checkpoint_drops_globals = true,
            "restore_keeps_regions_only" => p.restore_keeps_regions_only = true,
            "restore_copies_assets" => p.restore_copies_assets = true,
            "simulate_runs_all_steps" => p.simulate_runs_all_steps = true,
            "save_drops_globals" => p.save_drops_globals = true,
            "save_drops_input_position" => p.save_drops_input_position = true,
            "open_reapplies_segments" => p.open_reapplies_segments = true,
            "tracker_skips_memory_copy" => p.rewrite.skip_copy_pages = true,
            "runs_unchecked" => p.runs_unchecked = true,
            "digest_compares_total_sizes" => p.digest_total_sizes = true,
            "mapper_ignores_fuel_shift" => p.mapper_ignores_shift = true,
            "budget_charges_function_first_line" => p.budget_first_line = true,
            _ => return None,
        }
        Some(self)
    }
}

/// The logic module's version, as a bake key and a golden name it.
pub const VERSION: &str = concat!("logic@1 ", env!("CARGO_PKG_VERSION"));

/// An item's bake key: sha256 over its rewritten program, its fields and its data assets' hashes
/// (its content), the content of each item it reads, the input track, the recorded readings
/// (none yet: no reading source is built), the document's seed, and the logic module's and the
/// engine's versions.
pub fn bake_key(piece: &Piece, i: usize, entries: &[Entry]) -> String {
    use sha2::Digest;
    let item = &piece.items[i];
    let mut h = sha2::Sha256::new();
    let mut part = |b: &[u8]| {
        h.update((b.len() as u64).to_le_bytes());
        h.update(b);
    };
    part(item.content.as_bytes());
    for e in &item.layout.entries {
        if let piece::Read::Array { item: from, .. } = e.read {
            part(piece.items[from].content.as_bytes());
        }
    }
    part(
        Value::Array(entries.iter().map(Entry::to_json).collect())
            .to_string()
            .as_bytes(),
    );
    part(b"readings []");
    part(&piece.seed.to_le_bytes());
    part(VERSION.as_bytes());
    part(deep_sandbox_wasmtime::WASMTIME.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// This machine's CPU, as its OS names it.
fn cpu() -> String {
    let named = if cfg!(target_os = "macos") {
        std::process::Command::new("sysctl")
            .args(["-n", "machdep.cpu.brand_string"])
            .output()
            .ok()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    } else {
        std::fs::read_to_string("/proc/cpuinfo").ok().and_then(|c| {
            c.lines()
                .find(|l| l.starts_with("model name"))
                .and_then(|l| l.split(':').nth(1))
                .map(|s| s.trim().to_string())
        })
    };
    named
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| std::env::consts::ARCH.to_string())
}

const F: i64 = 705_600_000;

/// Whole flicks for the decimal seconds a document writes, as the input module rounds them.
fn flicks(seconds: f64) -> i64 {
    let x = seconds * F as f64;
    let r = x as i64;
    if x - r as f64 >= 0.5 {
        r + 1
    } else {
        r
    }
}

/// The piece's input track: your entries, or, with none of yours, its tour's keys as entries of
/// writer `tour`, each at idle_after past the start plus its own time, over the bake's span.
fn track(piece: &Piece, line: &Value, steps: i64) -> Option<Vec<Entry>> {
    let mut entries: Vec<Entry> = match line.get("track") {
        None => Vec::new(),
        Some(t) => t
            .as_array()?
            .iter()
            .map(Entry::parse)
            .collect::<Option<_>>()?,
    };
    let tour = piece
        .tour
        .as_ref()
        .filter(|_| !entries.iter().any(|e| e.writer == "you"));
    if let Some(tour) = tour {
        let start = flicks(
            tour.get("idle_after")
                .and_then(Value::as_f64)
                .unwrap_or(1.4),
        );
        let looping = tour.get("loop").and_then(Value::as_bool).unwrap_or(true);
        let end = piece
            .items
            .iter()
            .map(|i| i.step * steps)
            .max()
            .unwrap_or(0);
        let keys: Vec<(String, Vec<(i64, f64)>)> = tour
            .get("keys")?
            .as_object()?
            .iter()
            .map(|(c, list)| {
                Some((
                    c.clone(),
                    list.as_array()?
                        .iter()
                        .map(|k| Some((flicks(k.get(0)?.as_f64()?), k.get(1)?.as_f64()?)))
                        .collect::<Option<Vec<_>>>()?,
                ))
            })
            .collect::<Option<_>>()?;
        let period = if looping {
            keys.iter()
                .flat_map(|(_, k)| k.iter().map(|(t, _)| *t))
                .max()
                .unwrap_or(0)
        } else {
            0
        };
        for (control, ks) in keys {
            let mut seq = 0;
            for lap in 0.. {
                let at = start + lap * period;
                if at > end || (lap > 0 && period == 0) {
                    break;
                }
                for (t, value) in &ks {
                    if at + t <= end {
                        entries.push(Entry {
                            t: at + t,
                            seq,
                            control: control.clone(),
                            value: *value,
                            writer: "tour".into(),
                            player: 1,
                        });
                        seq += 1;
                    }
                }
            }
        }
    }
    entries.sort_by_key(|e| (e.t, e.player, e.seq));
    Some(entries)
}

/// The logic module in this process: its planted twin, the layouts each item ID has had, and
/// the open sessions.
#[derive(Default)]
pub struct Logic {
    pub planted: Planted,
    history: History,
    sessions: BTreeMap<String, World>,
    views: BTreeMap<String, live::View>,
}

fn bad(what: &str) -> Value {
    json!({"ok": false, "code": "bad_input", "what": what})
}

fn items(p: &Piece) -> Value {
    Value::Object(
        p.items
            .iter()
            .map(|i| (i.id.clone(), i.checked()))
            .collect(),
    )
}

/// A bake's restores and probes: `{from, steps, probe?}` and `{at, entries, steps}`.
struct Fork {
    at: i64,
    steps: i64,
    entries: Vec<Entry>,
    probe: Option<Box<Fork>>,
}

fn forks(v: Option<&Value>, at: &str) -> Option<Vec<Fork>> {
    let Some(v) = v else { return Some(Vec::new()) };
    v.as_array()?
        .iter()
        .map(|f| {
            let entries = match f.get("entries") {
                None => Vec::new(),
                Some(e) => e
                    .as_array()?
                    .iter()
                    .map(Entry::parse)
                    .collect::<Option<_>>()?,
            };
            let probe = match f.get("probe") {
                None | Some(Value::Null) => None,
                Some(p) => Some(Box::new(Fork {
                    at: 0,
                    steps: p.get("steps")?.as_i64()?,
                    entries: p
                        .get("entries")?
                        .as_array()?
                        .iter()
                        .map(Entry::parse)
                        .collect::<Option<_>>()?,
                    probe: None,
                })),
            };
            Some(Fork {
                at: f.get(at)?.as_i64()?,
                steps: f.get("steps")?.as_i64()?,
                entries,
                probe,
            })
        })
        .collect()
}

/// Each item's step hashes in a record, in step order.
fn hashes(piece: &Piece, rec: &Record) -> Map<String, Value> {
    piece
        .items
        .iter()
        .map(|i| {
            let list: Vec<Value> = rec
                .rows()
                .values()
                .map(|(items, _)| {
                    items
                        .get(&i.id)
                        .and_then(|x| x.get("hash"))
                        .cloned()
                        .unwrap_or(Value::Null)
                })
                .collect();
            (i.id.clone(), Value::Array(list))
        })
        .collect()
}

/// A seek to step `to`, against the straight world's ring: the nearest checkpoint at or before it,
/// restored and stepped to `to`, an optional probe there, then on through the first checkpoint
/// after `to`, whose full-state hashes it reports.
fn seek(straight: &World, to: i64, probe_of: Option<&Fork>) -> Result<Value, Value> {
    let from = straight
        .nearest(to)
        .ok_or_else(|| bad("seek: no checkpoint at or before it"))?;
    let next = straight
        .checkpoint_steps()
        .into_iter()
        .find(|c| *c > to)
        .ok_or_else(|| bad("seek: no checkpoint after it"))?;
    let mut w = straight.restore(from, None)?;
    w.run(to, &mut Record::default(), &mut |_, _| {});
    let p = match probe_of {
        None => Value::Null,
        Some(f) => {
            let mut fork = w.fork(&f.entries)?;
            let mut rec = Record::default();
            fork.run(to + f.steps, &mut rec, &mut |_, _| {});
            json!({"hashes": hashes(&w.piece, &rec), "deep_hash": fork.deep_hashes()})
        }
    };
    let mut rec = Record::default();
    w.run(next, &mut rec, &mut |_, _| {});
    let deep: Map<String, Value> = w
        .piece
        .items
        .iter()
        .map(|i| {
            let h = rec
                .deep(&i.id)
                .into_iter()
                .find(|(k, _)| *k == next)
                .map(|(_, h)| h);
            (i.id.clone(), json!(h))
        })
        .collect();
    Ok(
        json!({"to": to, "from": from, "hashes": hashes(&w.piece, &rec), "checkpoint": {"step": next, "deep_hash": deep}, "probe": p}),
    )
}

/// A bake's seeks: `{to, probe?: {entries, steps}}`.
fn seeks_of(v: Option<&Value>) -> Option<Vec<Fork>> {
    let Some(v) = v else { return Some(Vec::new()) };
    v.as_array()?
        .iter()
        .map(|s| {
            let probe = match s.get("probe") {
                None | Some(Value::Null) => None,
                Some(p) => Some(Box::new(Fork {
                    at: 0,
                    steps: p.get("steps")?.as_i64()?,
                    entries: p
                        .get("entries")?
                        .as_array()?
                        .iter()
                        .map(Entry::parse)
                        .collect::<Option<_>>()?,
                    probe: None,
                })),
            };
            Some(Fork {
                at: s.get("to")?.as_i64()?,
                steps: 0,
                entries: Vec::new(),
                probe,
            })
        })
        .collect()
}

/// A probe: the same next inputs fed to a state, run on for its steps.
fn probe(w: &mut World, f: &Fork) -> Result<Value, Value> {
    let at = w.at().unwrap_or(0);
    let mut fork = w.fork(&f.entries)?;
    let mut rec = Record::default();
    fork.run(at + f.steps, &mut rec, &mut |_, _| {});
    Ok(json!({"at": at, "steps": rec.steps_json(&w.piece), "deep_hash": fork.deep_hashes()}))
}

impl Logic {
    pub fn new(planted: Planted) -> Logic {
        Logic {
            planted,
            ..Logic::default()
        }
    }

    pub fn handle(&mut self, line: &Value) -> Value {
        match line.get("call").and_then(Value::as_str) {
            Some("about") => json!({
                "interface": "logic@1", "sandbox": deep_canvas_sandbox::module::INTERFACE,
                "engine": {"name": "wasmtime", "version": deep_sandbox_wasmtime::WASMTIME},
                "arch": std::env::consts::ARCH, "os": std::env::consts::OS,
            }),
            Some("check") => match self.check(line) {
                Ok(p) => json!({"ok": true, "items": items(&p)}),
                Err(r) => r,
            },
            Some("bake") => self.bake(line).unwrap_or_else(|e| e),
            Some("web_plan") => self.web_plan(line).unwrap_or_else(|e| e),
            // sandbox@1's web runner first: its offset map, trap kinds and frames are the ones used.
            Some("web_runner") => {
                json!({"source": format!("{}\n{WEB_RUNNER}", deep_sandbox_wasmtime::service::WEB_RUNNER)})
            }
            Some("determinism") => self.determinism(line).unwrap_or_else(|e| e),
            Some("budget") => self.budget(line).unwrap_or_else(|e| e),
            Some("golden") => self
                .golden(line)
                .map(|g| json!({"ok": true, "golden": g}))
                .unwrap_or_else(|e| e),
            Some("golden_verify") => self.golden_verify(line).unwrap_or_else(|e| e),
            Some("view") => self.view(line).unwrap_or_else(|e| e),
            Some("frame") => self.frame(line).unwrap_or_else(|e| e),
            Some("open") => self.open(line).unwrap_or_else(|e| e),
            Some("step") => self.step(line).unwrap_or_else(|e| e),
            Some("open_save") => self.open_save(line).unwrap_or_else(|e| e),
            _ => json!({"ok": false, "code": "bad_input"}),
        }
    }

    fn check(&mut self, line: &Value) -> Result<Piece, Value> {
        let piece = line
            .get("piece")
            .ok_or_else(|| json!({"ok": false, "code": "bad_input"}))?;
        piece::check(piece, &self.planted, &mut self.history).map_err(|r| r.0)
    }

    fn bake(&mut self, line: &Value) -> Result<Value, Value> {
        let piece = Rc::new(self.check(line)?);
        let steps = line
            .get("steps")
            .and_then(Value::as_i64)
            .filter(|n| *n >= 0)
            .ok_or_else(|| bad("steps"))?;
        let entries = track(&piece, line, steps).ok_or_else(|| bad("track"))?;
        let restores = forks(line.get("restores"), "from").ok_or_else(|| bad("restores"))?;
        let probes = forks(line.get("probes"), "at").ok_or_else(|| bad("probes"))?;
        let seeks = seeks_of(line.get("seeks")).ok_or_else(|| bad("seeks"))?;
        let one_rate = piece.items.windows(2).all(|w| w[0].step == w[1].step);
        if !(restores.is_empty() && probes.is_empty() && seeks.is_empty()) && !one_rate {
            return Err(bad("restores and probes need every item at one step rate"));
        }
        let mut rec = Record::default();
        let mut world = World::new(
            piece.clone(),
            track_of(&entries),
            true,
            self.planted,
            &mut rec,
            None,
        )?;
        world.saves_dir = saves_dir(line);
        world.adapter = adapter(line);
        let mut probed: Vec<(usize, Result<Value, Value>)> = Vec::new();
        world.run(steps, &mut rec, &mut |w, k| {
            for (i, p) in probes.iter().enumerate().filter(|(_, p)| p.at == k) {
                probed.push((i, probe(w, p)));
            }
        });
        probed.sort_by_key(|(i, _)| *i);
        let probes_out = probed
            .into_iter()
            .map(|(_, r)| r)
            .collect::<Result<Vec<_>, _>>()?;
        let mut restores_out = Vec::new();
        for r in &restores {
            let mut w = world.restore(r.at, None)?;
            let mut rr = Record::default();
            let mut p = None;
            if let Some(f) = &r.probe {
                p = Some(probe(&mut w, f)?);
            }
            w.run(r.at + r.steps, &mut rr, &mut |_, _| {});
            restores_out.push(json!({"from": r.at, "checkpoints": rr.checkpoints, "steps": rr.steps_json(&piece), "probe": p}));
        }
        let seeks_out = seeks
            .iter()
            .map(|f| seek(&world, f.at, f.probe.as_deref()))
            .collect::<Result<Vec<_>, _>>()?;
        let mut peeks = Vec::new();
        for p in line
            .get("peek")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let (Some(item), Some(at), Some(len)) = (
                p.get("item").and_then(Value::as_str),
                p.get("at").and_then(Value::as_u64),
                p.get("len").and_then(Value::as_u64),
            ) else {
                return Err(bad("peek"));
            };
            let hex = world
                .peek(item, at as usize, len as usize)
                .ok_or_else(|| bad("peek"))?;
            peeks.push(json!({"item": item, "at": at, "len": len, "hex": hex}));
        }
        let saves = saves::written(&mut world)?;
        let frames = frames(&piece, line.get("frames"), &rec, None)?;
        let budgets = self.budgets(&piece, &entries, &rec)?;
        let keys: Map<String, Value> = (0..piece.items.len())
            .map(|i| {
                (
                    piece.items[i].id.clone(),
                    json!(bake_key(&piece, i, &entries)),
                )
            })
            .collect();
        Ok(json!({
            "ok": true, "items": items(&piece), "keys": keys, "steps": rec.steps_json(&piece), "checkpoints": rec.checkpoints,
            "traps": rec.traps, "budgets": budgets, "saves": saves, "frames": frames, "restores": restores_out, "probes": probes_out, "seeks": seeks_out, "peeks": peeks,
            "track": entries.iter().map(Entry::to_json).collect::<Vec<_>>(),
        }))
    }

    /// The piece, its input track and the bake's step count, as `bake` reads them.
    fn baked(&mut self, line: &Value) -> Result<(Rc<Piece>, Vec<Entry>, i64), Value> {
        let piece = Rc::new(self.check(line)?);
        let steps = line
            .get("steps")
            .and_then(Value::as_i64)
            .filter(|n| *n >= 0)
            .ok_or_else(|| bad("steps"))?;
        let entries = track(&piece, line, steps).ok_or_else(|| bad("track"))?;
        if !piece.items.windows(2).all(|w| w[0].step == w[1].step) {
            return Err(bad("checks need every item at one step rate"));
        }
        Ok((piece, entries, steps))
    }

    /// logic.determinism: sampled times in seconds, each at step ⌊t × step_rate⌋.
    fn determinism(&mut self, line: &Value) -> Result<Value, Value> {
        let (piece, entries, steps) = self.baked(line)?;
        let compare = line
            .get("compare")
            .and_then(Value::as_str)
            .unwrap_or("same_machine");
        if compare != "same_machine" {
            return Ok(
                json!({"ok": true, "kind": "logic.determinism", "verdict": "BLOCKED", "failures": [],
                "ask": format!("logic.determinism with compare {compare} replays the golden on another host; it hasn't run")}),
            );
        }
        let len = piece.items.first().map_or(1, |i| i.step);
        let at: Vec<i64> = line
            .get("at_times")
            .and_then(Value::as_array)
            .ok_or_else(|| bad("at_times"))?
            .iter()
            .map(|t| t.as_f64().map(|t| flicks(t) / len))
            .collect::<Option<_>>()
            .ok_or_else(|| bad("at_times"))?;
        checks::determinism(&piece, &entries, steps, &at, self.planted)
    }

    /// A golden of the piece's bake recorded on this host (Golden): the bake keys, the runtime
    /// digest, this machine, every step's hash and every checkpoint's full-state hash.
    fn golden(&mut self, line: &Value) -> Result<Value, Value> {
        let (piece, entries, steps) = self.baked(line)?;
        let mut rec = Record::default();
        World::new(
            piece.clone(),
            track_of(&entries),
            false,
            self.planted,
            &mut rec,
            None,
        )?
        .run(steps, &mut rec, &mut |_, _| {});
        let keys: Map<String, Value> = (0..piece.items.len())
            .map(|i| {
                (
                    piece.items[i].id.clone(),
                    json!(bake_key(&piece, i, &entries)),
                )
            })
            .collect();
        let mut digest = format!("{VERSION}\nwasmtime {}\n", deep_sandbox_wasmtime::WASMTIME);
        for i in &piece.items {
            digest += &format!("{} {}\n", i.id, i.hash);
        }
        let host = format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH);
        let other = if std::env::consts::ARCH == "x86_64" {
            "macos-aarch64"
        } else {
            "linux-x86_64"
        };
        Ok(json!({
            "bake_key": keys, "runtime_digest": format!("{:016x}", piece::h64(digest.as_bytes())),
            "machine": {"os": std::env::consts::OS, "arch": std::env::consts::ARCH, "cpu": cpu()},
            "step_hashes": hashes(&piece, &rec), "checkpoint_hashes": rec.checkpoints, "occurrences_hash": null,
            "record_on": host, "verify_on": [other, "web"],
        }))
    }

    /// Replays the golden's bake on this host: PASS only when the bake keys match and every step
    /// hash and checkpoint hash equals the golden's; `first_step` names the first step whose hash
    /// differs.
    fn golden_verify(&mut self, line: &Value) -> Result<Value, Value> {
        let golden = line.get("golden").cloned().ok_or_else(|| bad("golden"))?;
        let mine = self.golden(line)?;
        let first_step = mine["step_hashes"]
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(id, list)| {
                let theirs = golden["step_hashes"].get(id).and_then(Value::as_array);
                let list = list.as_array()?;
                (0..list.len().max(theirs.map_or(0, Vec::len)))
                    .find(|&k| list.get(k) != theirs.and_then(|t| t.get(k)))
            })
            .min();
        let same = mine["bake_key"] == golden["bake_key"]
            && mine["checkpoint_hashes"] == golden["checkpoint_hashes"]
            && first_step.is_none();
        let machines = if golden["machine"]["arch"] == mine["machine"]["arch"] {
            "same"
        } else {
            "different"
        };
        Ok(
            json!({"ok": true, "verdict": if same { "PASS" } else { "FAIL" }, "machines": machines, "first_step": first_step,
            "keys_match": mine["bake_key"] == golden["bake_key"]}),
        )
    }

    /// logic.budget over the piece's bake: `fuel_share` (0.5) and `on` (["app"]).
    fn budget(&mut self, line: &Value) -> Result<Value, Value> {
        let (piece, entries, steps) = self.baked(line)?;
        let share = line
            .get("fuel_share")
            .map_or(Some(0.5), Value::as_f64)
            .ok_or_else(|| bad("fuel_share"))?;
        let on: Vec<String> = match line.get("on") {
            None => vec!["app".into()],
            Some(v) => v
                .as_array()
                .and_then(|a| {
                    a.iter()
                        .map(|h| {
                            h.as_str()
                                .filter(|h| ["app", "web"].contains(h))
                                .map(str::to_string)
                        })
                        .collect()
                })
                .ok_or_else(|| bad("on"))?,
        };
        let mut rec = Record::default();
        World::new(
            piece.clone(),
            track_of(&entries),
            false,
            self.planted,
            &mut rec,
            None,
        )?
        .run(steps, &mut rec, &mut |_, _| {});
        Ok(budget::budget(&piece, &rec, share, &on, self.planted))
    }

    /// logic.budget per item: its worst step and that step's fuel, and with a sidecar the three
    /// source lines that spent the most of it, from the rewrite's per-block counts: the worst
    /// step run again on the counted rewrite, whose counts change no fuel and no state.
    fn budgets(
        &self,
        piece: &Rc<Piece>,
        entries: &[Entry],
        rec: &Record,
    ) -> Result<Vec<Value>, Value> {
        let mut out = Vec::new();
        for (i, item) in piece.items.iter().enumerate() {
            let Some(&(worst, fuel)) = rec.fuel.get(&i).and_then(|f| {
                f.iter()
                    .fold(None, |best: Option<&(i64, i64)>, x| match best {
                        Some(b) if b.1 >= x.1 => Some(b),
                        _ => Some(x),
                    })
            }) else {
                continue;
            };
            let mut lines = Vec::new();
            if let Some(src) = &item.lines {
                let counted = item.counted(&self.planted).map_err(
                    |e| json!({"ok": false, "code": "rewrite_failed", "item": item.id, "what": e}),
                )?;
                let mut scratch = Record::default();
                let mut w = World::new(
                    piece.clone(),
                    track_of(entries),
                    false,
                    self.planted,
                    &mut scratch,
                    Some((i, &counted.bytes)),
                )?;
                w.run(worst, &mut scratch, &mut |_, _| {});
                w.zero_blocks(i);
                w.run(worst + 1, &mut scratch, &mut |_, _| {});
                let mut by: BTreeMap<String, i64> = BTreeMap::new();
                for (b, n) in counted.blocks.iter().zip(w.blocks(i)) {
                    for op in &b.ops {
                        let at = if self.planted.budget_first_line {
                            src.function_at(*op)
                        } else {
                            src.at(*op)
                        };
                        if let Some(s) = at {
                            *by.entry(s).or_default() += n;
                        }
                    }
                }
                let mut ranked: Vec<(String, i64)> =
                    by.into_iter().filter(|(_, f)| *f > 0).collect();
                ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
                lines = ranked
                    .into_iter()
                    .take(3)
                    .map(|(s, f)| json!({"source": s, "fuel": f}))
                    .collect();
            }
            out.push(json!({"item": item.id, "step": worst, "fuel": fuel, "lines": lines}));
        }
        Ok(out)
    }

    /// The web runner's request for a bake: the bytes the app rewrote, each item's region map,
    /// rate and budgets, and the input track; the browser checks and rewrites nothing.
    fn web_plan(&mut self, line: &Value) -> Result<Value, Value> {
        let piece = self.check(line)?;
        let steps = line
            .get("steps")
            .and_then(Value::as_i64)
            .filter(|n| *n >= 0)
            .ok_or_else(|| bad("steps"))?;
        let entries = track(&piece, line, steps).ok_or_else(|| bad("track"))?;
        let items: Vec<Value> = piece
            .items
            .iter()
            .map(|i| {
                let n = world::names(&i.bytes);
                let regions: Vec<Value> = i
                    .layout
                    .entries
                    .iter()
                    .map(|e| {
                        let (kind, from, offset) = match &e.read {
                            piece::Read::Control => ("control", Value::Null, 0),
                            piece::Read::Array { item, offset } => ("array", json!(item), *offset),
                            piece::Read::Seed => ("seed", Value::Null, 0),
                            piece::Read::None => ("write", Value::Null, 0),
                        };
                        json!({"region": e.region, "name": e.name, "offset": e.offset, "size": e.size, "read": kind, "from": from, "from_offset": offset})
                    })
                    .collect();
                let writes: Vec<Value> = i.writes.iter().map(|w| json!({"name": w.name, "type": w.ty.name(), "count": w.count, "offset": i.write(&w.name).map(|e| e.offset)})).collect();
                json!({
                    "id": i.id, "rewritten": B64.encode(&i.bytes), "step": i.step, "fuel": i.fuel, "stack": i.stack, "every": i.every, "ring": i.ring,
                    "reads_at": i.reads_at, "writes_at": i.writes_at, "reads_size": i.layout.size("reads"), "writes_size": i.layout.size("writes"),
                    "regions": regions, "writes": writes, "globals": n.globals, "pages": n.pages,
                    "assets": (!i.assets.is_empty()).then(|| B64.encode(i.asset_bytes())), "assets_at": i.assets_at,
                })
            })
            .collect();
        let mut request = Map::new();
        request.insert("seed".into(), json!(piece.seed));
        request.insert("steps".into(), json!(steps));
        request.insert("items".into(), Value::Array(items));
        request.insert(
            "track".into(),
            Value::Array(entries.iter().map(Entry::to_json).collect()),
        );
        for k in ["restores", "probes", "peek"] {
            request.insert(k.into(), line.get(k).cloned().unwrap_or_else(|| json!([])));
        }
        Ok(json!({"ok": true, "request": request}))
    }

    /// A live view of the piece at time 0 with no bake, for `span` seconds.
    fn view(&mut self, line: &Value) -> Result<Value, Value> {
        let span = line
            .get("span")
            .and_then(Value::as_f64)
            .filter(|s| *s >= 0.0)
            .ok_or_else(|| bad("span"))?;
        let (view, first) = live::View::open(line.clone(), flicks(span), self.planted)?;
        let session = format!("v{}", self.views.len() + 1);
        self.views.insert(session.clone(), view);
        Ok(json!({"ok": true, "session": session, "items": first["items"]}))
    }

    /// One live frame: the UI thread latches `seek` (the paused playhead, in seconds, within the
    /// span) and `set` (a change of a control there), and the render worker simulates.
    fn frame(&mut self, line: &Value) -> Result<Value, Value> {
        let ui = budget::cpu_ns();
        let session = line
            .get("session")
            .and_then(Value::as_str)
            .ok_or_else(|| bad("session"))?;
        let v = self.views.get_mut(session).ok_or_else(|| bad("session"))?;
        if let Some(t) = line.get("seek") {
            let t = t
                .as_f64()
                .filter(|t| *t >= 0.0)
                .ok_or_else(|| bad("seek"))?;
            v.t = flicks(t).min(v.span);
        }
        let set = match line.get("set") {
            None => None,
            Some(s) => Some((
                s.get("control")
                    .and_then(Value::as_str)
                    .ok_or_else(|| bad("set"))?
                    .to_string(),
                s.get("value")
                    .and_then(Value::as_f64)
                    .ok_or_else(|| bad("set"))?,
            )),
        };
        let mut ui_ns = budget::cpu_ns() - ui;
        let mut out = v.frame(live::Latched { t: v.t, set }).ok_or_else(
            || json!({"ok": false, "code": "run_failed", "what": "the render worker stopped"}),
        )?;
        let ui = budget::cpu_ns();
        if out.get("ok") == Some(&json!(false)) {
            return Err(out);
        }
        v.frame += 1;
        out["ok"] = json!(true);
        out["frame"] = json!(v.frame);
        out["t"] = json!(v.t);
        ui_ns += budget::cpu_ns() - ui;
        out["ui_ns"] = json!(ui_ns);
        Ok(out)
    }

    fn open(&mut self, line: &Value) -> Result<Value, Value> {
        let piece = Rc::new(self.check(line)?);
        let entries = track(&piece, line, 0).ok_or_else(|| bad("track"))?;
        let mut rec = Record::default();
        let mut world = World::new(
            piece.clone(),
            track_of(&entries),
            false,
            self.planted,
            &mut rec,
            None,
        )?;
        world.saves_dir = saves_dir(line);
        world.adapter = adapter(line);
        let session = format!("s{}", self.sessions.len() + 1);
        self.sessions.insert(session.clone(), world);
        Ok(json!({"ok": true, "session": session, "items": items(&piece)}))
    }

    fn step(&mut self, line: &Value) -> Result<Value, Value> {
        let to = line
            .get("to")
            .and_then(Value::as_i64)
            .ok_or_else(|| bad("to"))?;
        let s = line
            .get("session")
            .and_then(Value::as_str)
            .ok_or_else(|| bad("session"))?;
        let w = self.sessions.get_mut(s).ok_or_else(|| bad("session"))?;
        let mut rec = Record::default();
        w.run(to + 1, &mut rec, &mut |_, _| {});
        let saves = saves::written(w)?;
        Ok(json!({"ok": true, "step": to, "failed": w.failed(), "saves": saves}))
    }

    /// The viewer opens a slot's save from the app (Logic: saves), never the piece's logic.
    fn open_save(&mut self, line: &Value) -> Result<Value, Value> {
        let (piece, entries, steps) = self.baked(line)?;
        let dir = saves_dir(line).ok_or_else(|| bad("saves_dir"))?;
        let slot = line
            .get("slot")
            .and_then(Value::as_i64)
            .ok_or_else(|| bad("slot"))?;
        saves::open(
            piece,
            &dir,
            slot,
            &entries,
            steps,
            self.planted,
            &adapter(line),
            line.get("frames"),
        )
    }
}

/// The adapter fingerprint a call names for its run, or this host's own: what a save of
/// same-machine state binds.
fn adapter(line: &Value) -> String {
    line.get("adapter")
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| {
            static HOST: std::sync::OnceLock<String> = std::sync::OnceLock::new();
            HOST.get_or_init(|| {
                let host = format!(
                    "{}\n{}\n{}\n",
                    std::env::consts::OS,
                    std::env::consts::ARCH,
                    cpu()
                );
                rewrite::hash(host.as_bytes())
            })
            .clone()
        })
}

/// Frames (Logic: interpolated writes): per span, `count` frames at 60 Hz from flick `from`, each
/// reading the named hold arrays as the last step at or before its time left them. `opened` is a
/// save's step s and its arrays, as step s − 1 left them.
pub(crate) fn frames(
    piece: &Piece,
    spans: Option<&Value>,
    rec: &Record,
    opened: Option<(i64, &Map<String, Value>)>,
) -> Result<Value, Value> {
    let Some(spans) = spans else {
        return Ok(json!([]));
    };
    let len = piece.items.first().map_or(0, |i| i.step);
    if len == 0 || !piece.items.windows(2).all(|w| w[0].step == w[1].step) {
        return Err(bad("frames need every item at one step rate"));
    }
    let what = |w: String| json!({"ok": false, "code": "bad_input", "what": w});
    let mut out = Vec::new();
    for span in spans.as_array().ok_or_else(|| bad("frames"))? {
        let (Some(from), Some(count), Some(names)) = (
            span.get("from").and_then(Value::as_i64),
            span.get("count")
                .and_then(Value::as_i64)
                .filter(|n| *n >= 0),
            span.get("arrays").and_then(Value::as_array),
        ) else {
            return Err(bad("frames"));
        };
        let names: Vec<&str> = names
            .iter()
            .map(Value::as_str)
            .collect::<Option<_>>()
            .ok_or_else(|| bad("frames"))?;
        let linear = piece.items.iter().flat_map(|i| {
            i.writes
                .iter()
                .filter(|w| w.linear)
                .map(move |w| format!("{}.{}", i.id, w.name))
        });
        if let Some(n) = linear.into_iter().find(|n| names.contains(&n.as_str())) {
            return Err(what(format!(
                "{n} is a linear write, whose frames aren't built yet (#545)"
            )));
        }
        let mut list = Vec::new();
        for j in 0..count {
            let t = j
                .checked_mul(F / 60)
                .and_then(|d| d.checked_add(from))
                .ok_or_else(|| bad("frames"))?;
            let k = t.div_euclid(len);
            let row = match opened {
                Some((s, arrays)) if k == s - 1 => Some(arrays),
                _ => rec.rows().get(&k).map(|(_, a)| a),
            };
            let arrays: Map<String, Value> = names
                .iter()
                .map(|n| Some((n.to_string(), row?.get(*n)?.clone())))
                .collect::<Option<_>>()
                .ok_or_else(|| {
                    what(format!(
                        "no step this run reports wrote {names:?} at or before flick {t}"
                    ))
                })?;
            list.push(json!({"t": t, "arrays": arrays}));
        }
        out.push(Value::Array(list));
    }
    Ok(Value::Array(out))
}

/// The folder a call names for the piece's saves.
fn saves_dir(line: &Value) -> Option<std::path::PathBuf> {
    line.get("saves_dir")
        .and_then(Value::as_str)
        .map(Into::into)
}
