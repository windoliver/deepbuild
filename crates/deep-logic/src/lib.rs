//! The logic module (canvas primitives: Logic `logic@1`; technical design: The logic module; #531):
//! a logic item's program, by hash, checked and rewritten by sandbox@1 (#238) in the role
//! `logic`, stepped at its own rate with its read and write regions, its step seed and traps that
//! freeze only its item, with checkpoints, restores, continuation probes, traps by source line and
//! logic.budget. `deep-logic` serves it as JSON lines (the #531 acceptance README: deep-logic),
//! and `web/logic.mjs` is the web player's runtime for the same rewritten bytes.

pub mod lines;
pub mod piece;
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
}

impl Planted {
    pub fn named(name: &str) -> Option<Planted> {
        let mut p = Planted::default();
        match name {
            "tracker_skips_memory_copy" => p.rewrite.skip_copy_pages = true,
            "runs_unchecked" => p.runs_unchecked = true,
            "digest_compares_total_sizes" => p.digest_total_sizes = true,
            "mapper_ignores_fuel_shift" => p.mapper_ignores_shift = true,
            "budget_charges_function_first_line" => p.budget_first_line = true,
            _ => return None,
        }
        Some(p)
    }
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
            Some("open") => self.open(line).unwrap_or_else(|e| e),
            Some("step") => self.step(line).unwrap_or_else(|e| e),
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
        let one_rate = piece.items.windows(2).all(|w| w[0].step == w[1].step);
        if !(restores.is_empty() && probes.is_empty()) && !one_rate {
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
        let budgets = self.budgets(&piece, &entries, &rec)?;
        Ok(json!({
            "ok": true, "items": items(&piece), "steps": rec.steps_json(&piece), "checkpoints": rec.checkpoints,
            "traps": rec.traps, "budgets": budgets, "restores": restores_out, "probes": probes_out, "peeks": peeks,
            "track": entries.iter().map(Entry::to_json).collect::<Vec<_>>(),
        }))
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
                    "id": i.id, "rewritten": B64.encode(&i.bytes), "step": i.step, "fuel": i.fuel, "stack": i.stack, "every": i.every,
                    "reads_at": i.reads_at, "writes_at": i.writes_at, "reads_size": i.layout.size("reads"), "writes_size": i.layout.size("writes"),
                    "regions": regions, "writes": writes, "globals": n.globals, "pages": n.pages,
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

    fn open(&mut self, line: &Value) -> Result<Value, Value> {
        let piece = Rc::new(self.check(line)?);
        let entries = track(&piece, line, 0).ok_or_else(|| bad("track"))?;
        let mut rec = Record::default();
        let world = World::new(
            piece.clone(),
            track_of(&entries),
            false,
            self.planted,
            &mut rec,
            None,
        )?;
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
        Ok(json!({"ok": true, "step": to, "failed": w.failed()}))
    }
}
