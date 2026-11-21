//! #551: the worlds a match's copy steps beside its logic items (canvas primitives: Net:
//! rollback), as the app and the web player both step them: each world of the document, live on
//! the pinned backend, its inputs derived from the input track, stepping every world step whose
//! time falls inside a match step. Its rollback checkpoint at a match step is the whole world, as
//! physics checkpoints; a rollback restores it with the steps it had run, drops the rows of the
//! steps it replaced and the entries from the step's start on, which join again as they run.

use std::collections::{BTreeMap, VecDeque};

use deep_canvas_physics::backend::Checkpoint;
use deep_physics_rapier::runner::{Live, Run};
use serde_json::{json, Value};

struct One {
    id: String,
    live: Live,
    /// Its step, in flicks.
    h: i64,
    /// The rollback ring: at each match step, the world and the steps it had run.
    ring: VecDeque<(i64, Checkpoint, u64)>,
    /// Each world step's occurrence rows.
    rows: BTreeMap<u64, Vec<Value>>,
}

/// A document's worlds as a copy steps them.
pub struct Worlds {
    doc: Value,
    worlds: Vec<One>,
    /// The input track the worlds' inputs derive from: what came before the match, then each entry.
    entries: Vec<Value>,
    size: usize,
    /// The snapshot bytes the ring wrote, and the CPU time since last read, in ns.
    pub written: u64,
    pub ns: u64,
}

impl Worlds {
    /// The worlds `doc` lists, at their start on `track`; none when it lists none.
    pub fn of(doc: &Value, track: &[Value]) -> Result<Option<Worlds>, Value> {
        let Some(listed) = doc
            .get("worlds")
            .and_then(Value::as_object)
            .filter(|w| !w.is_empty())
        else {
            return Ok(None);
        };
        let run = Run::new(None).ok_or_else(|| json!({"code": "physics_refused"}))?;
        let mut worlds = Vec::new();
        for id in listed.keys() {
            let mut live = run
                .live(&json!({"scene": doc, "world": id}))
                .map_err(|e| json!({"code": "physics_refused", "world": id, "what": e}))?;
            live.track(track);
            worlds.push(One {
                id: id.clone(),
                h: live.step_flicks(),
                live,
                ring: VecDeque::new(),
                rows: BTreeMap::new(),
            });
        }
        Ok(Some(Worlds {
            doc: doc.clone(),
            worlds,
            entries: track.to_vec(),
            size: 0,
            written: 0,
            ns: 0,
        }))
    }

    /// The same worlds at their start, on the track they started on.
    pub fn again(&self, track: &[Value]) -> Result<Option<Worlds>, Value> {
        let mut w = Worlds::of(&self.doc, track)?;
        if let Some(w) = w.as_mut() {
            w.size = self.size;
        }
        Ok(w)
    }

    pub fn hold(&mut self, size: usize) {
        self.size = size;
    }

    pub fn enter(&mut self, entry: &Value) {
        self.entries.push(entry.clone());
        for w in &mut self.worlds {
            w.live.track(&self.entries);
        }
    }

    /// Every world step that starts before `until`.
    pub fn run(&mut self, until: i64) -> Result<(), Value> {
        let before = deep_logic::budget::cpu_ns();
        for w in &mut self.worlds {
            while (w.live.steps as i64) * w.h < until {
                let rows = w.live.step()?;
                w.rows.insert(w.live.steps, rows);
            }
        }
        self.ns += deep_logic::budget::cpu_ns() - before;
        Ok(())
    }

    pub fn keep(&mut self, step: i64) {
        let before = deep_logic::budget::cpu_ns();
        for w in &mut self.worlds {
            let c = w.live.checkpoint();
            self.written += c.state.len() as u64;
            w.ring.retain(|(k, _, _)| *k < step);
            w.ring.push_back((step, c, w.live.steps));
            while w.ring.len() > self.size.max(1) {
                w.ring.pop_front();
            }
        }
        self.ns += deep_logic::budget::cpu_ns() - before;
    }

    pub fn back(&mut self, step: i64, t: i64) -> Result<(), Value> {
        let before = deep_logic::budget::cpu_ns();
        self.entries
            .retain(|e| e["t"].as_i64().is_some_and(|x| x < t));
        for w in &mut self.worlds {
            let Some(at) = w.ring.iter().position(|(k, _, _)| *k == step) else {
                return Err(json!({"code": "past_window", "world": w.id, "step": step}));
            };
            let (_, c, steps) = w.ring.drain(at..).next().expect("the checkpoint");
            w.live.restore(&c, steps)?;
            w.live.track(&self.entries);
            w.rows.retain(|k, _| *k <= steps);
        }
        self.ns += deep_logic::budget::cpu_ns() - before;
        Ok(())
    }

    /// The same worlds at their start on every entry they've taken, stepped through `until`: what
    /// a seek has them at, since physics keeps no ring in a match beyond its rollback ring.
    pub fn replayed(&self, until: i64) -> Result<Option<Worlds>, Value> {
        let mut w = Worlds::of(&self.doc, &self.entries)?;
        if let Some(w) = w.as_mut() {
            w.size = self.size;
            w.run(until)?;
        }
        Ok(w)
    }

    /// Each world's ID and the deep hash of its whole state.
    pub fn hashes(&self) -> Vec<(String, String)> {
        self.worlds
            .iter()
            .map(|w| (w.id.clone(), w.live.deep_hash()))
            .collect()
    }

    /// Every world's occurrence rows, each with its world as `item` and the match step (of `len`
    /// flicks) its time falls in.
    pub fn occurrences(&self, len: i64) -> Vec<Value> {
        let mut out = Vec::new();
        for w in &self.worlds {
            for (k, rows) in &w.rows {
                for r in rows {
                    let mut r = r.clone();
                    let t = r["t"].as_i64().unwrap_or((*k as i64 - 1) * w.h);
                    r["item"] = json!(w.id);
                    r["step"] = json!(t / len.max(1));
                    out.push(r);
                }
            }
        }
        out
    }

    /// Each world's occurrence rows, by the match step (of `len` flicks) their world step falls in.
    pub fn made(&self, len: i64) -> BTreeMap<i64, Value> {
        let mut out = BTreeMap::<i64, Value>::new();
        for w in &self.worlds {
            for (k, rows) in w.rows.iter().filter(|(_, r)| !r.is_empty()) {
                let at = out
                    .entry((*k as i64 - 1) * w.h / len.max(1))
                    .or_insert_with(|| json!({}));
                at["physics"][&w.id][k.to_string()] = json!(rows);
            }
        }
        out
    }
}
