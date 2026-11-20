//! #549: what a copy of a match steps, as the app and the web player both step it: a document's
//! logic items, one match step at a time on the one clock, each entry joining the input track at
//! its step before that step runs, and the full-state hash over every item's whole carried
//! state. Each stepping item's step length divides the match step's or is a whole multiple of
//! it, so a match step runs every item step whose time falls inside it.

use std::rc::Rc;

use deep_canvas::registry::{Raised, Report};
use deep_logic::budget::cpu_ns;
use deep_logic::piece::Piece;
use deep_logic::piece::Ty;
use deep_logic::world::{track_of, Entry, Record, World};
use deep_net::{Change, Defect, Stepper};
use serde_json::{json, Map, Value};

pub struct Logic {
    piece: Rc<Piece>,
    /// The input track recorded before the match, which a run again starts from.
    start: Vec<Value>,
    world: World,
    rec: Record,
    /// With `rows`, each match step's row as the `logic` call gives one: its hash and arrays
    /// per item.
    keep: bool,
    pub rows: Vec<Value>,
    /// The match step that took the most CPU time, and that time in ms.
    pub busiest: Option<(i64, f64)>,
    /// #550's planted full-state hash, which rounds every float to 1e-6 first.
    pub rounds: bool,
}

impl Logic {
    /// `piece` at its start on `track`, the input track recorded before the match.
    pub fn new(piece: Rc<Piece>, track: &[Value], rows: bool) -> Result<Logic, Value> {
        let entries: Vec<Entry> = track.iter().filter_map(Entry::parse).collect();
        let mut rec = Record::default();
        let world = World::new(
            piece.clone(),
            track_of(&entries),
            false,
            Default::default(),
            &mut rec,
            None,
        )?;
        Ok(Logic {
            piece,
            start: track.to_vec(),
            world,
            rec,
            keep: rows,
            rows: Vec::new(),
            busiest: None,
            rounds: false,
        })
    }

    fn row(&self, step: i64, t: i64) -> Value {
        let row = self.rec.rows().get(&step).map(|r| &r.0);
        let mut hash = Map::new();
        let mut arrays = Map::new();
        for (n, item) in self.piece.items.iter().enumerate() {
            if let Some(h) = row
                .and_then(|r| r.get(&item.id))
                .and_then(|r| r.get("hash"))
            {
                hash.insert(item.id.clone(), h.clone());
            }
            for w in &item.writes {
                if let Some(values) = self.world.array(n, &w.name) {
                    arrays.insert(format!("{}.{}", item.id, w.name), Value::Array(values));
                }
            }
        }
        json!({"step": step, "t": t, "hash": hash, "arrays": arrays})
    }
}

impl Stepper for Logic {
    fn enter(&mut self, entry: &Value) -> Result<(), Value> {
        let entry = Entry::parse(entry).ok_or_else(
            || json!({"code": "bad_input", "what": "an entry is {t, control, value}"}),
        )?;
        self.world.append(entry).map(|_| ())
    }

    fn run(&mut self, step: i64, until: i64) -> Result<(), Value> {
        let before = cpu_ns();
        self.world.run_through(until - 1, &mut self.rec);
        let ms = (cpu_ns() - before) as f64 / 1e6;
        if self.busiest.is_none_or(|(_, worst)| ms > worst) {
            self.busiest = Some((step, ms));
        }
        if let Some(trap) = self.rec.traps.first() {
            return Err(trap.clone());
        }
        if self.keep {
            let len = self.piece.items.first().map_or(1, |i| i.step);
            self.rows.push(self.row(step, step * len));
        }
        Ok(())
    }

    fn hash(&mut self) -> u64 {
        if self.rounds {
            return self.rounded();
        }
        // FNV-1a over each item's ID and deep hash, in the piece's order.
        let hashes = self.world.deep_hashes();
        fold(
            hashes
                .iter()
                .map(|(id, h)| (id.as_str(), h.as_str().unwrap_or(""))),
        )
    }

    fn step_hash(&mut self) -> u64 {
        let hashes: Vec<(String, String)> = self
            .world
            .step_hashes()
            .into_iter()
            .map(|(id, h)| (id, format!("{h:016x}")))
            .collect();
        fold(hashes.iter().map(|(id, h)| (id.as_str(), h.as_str())))
    }

    fn fields(&mut self) -> Vec<(String, String, u64)> {
        let fields = self.world.field_hashes();
        fields
            .into_iter()
            .map(|(f, h)| ("logic".to_string(), f, h))
            .collect()
    }

    fn again(&self) -> Result<Self, Value> {
        let mut again = Logic::new(self.piece.clone(), &self.start, false)?;
        again.rounds = self.rounds;
        Ok(again)
    }

    /// A field is `<item>.<write>`, whose first value changes in the program's write region,
    /// which the program reads back the next step, or `<item>.memory`, whose byte at `at` does.
    fn plant(&mut self, d: &Defect) -> Result<(), Value> {
        let bad = || json!({"code": "bad_input", "what": format!("no logic field {}", d.field)});
        let (id, name) = d.field.rsplit_once('.').ok_or_else(bad)?;
        let item = self
            .piece
            .items
            .iter()
            .find(|i| i.id == id)
            .ok_or_else(bad)?;
        let (at, ty) = if name == "memory" {
            (d.at.ok_or_else(bad)? as usize, None)
        } else {
            let w = item
                .writes
                .iter()
                .find(|w| w.name == name)
                .ok_or_else(bad)?;
            let e = item.write(name).ok_or_else(bad)?;
            ((item.writes_at + e.offset) as usize, Some(w.ty))
        };
        let size = match ty {
            None | Some(Ty::Bool) => 1,
            Some(Ty::I32) => 4,
            Some(_) => 8,
        };
        let mut b = self.world.bytes(id, at, size).ok_or_else(bad)?;
        match (ty, d.change) {
            (None | Some(Ty::Bool), Change::Add(n)) => b[0] = b[0].wrapping_add(n as i64 as u8),
            (Some(Ty::I32), Change::Add(n)) => {
                let v = i32::from_le_bytes(b[..4].try_into().expect("4 bytes"));
                b.copy_from_slice(&v.wrapping_add(n as i32).to_le_bytes());
            }
            (Some(_), Change::Add(n)) => {
                let v = f64::from_le_bytes(b[..8].try_into().expect("8 bytes"));
                b.copy_from_slice(&(v + n).to_le_bytes());
            }
            // Bit b of the value's little-endian bits: bit 0, a float's lowest mantissa bit.
            (_, Change::Flip(bit)) => {
                let byte = (bit / 8) as usize;
                let at = b.get_mut(byte).ok_or_else(bad)?;
                *at ^= 1 << (bit % 8);
            }
        }
        self.world.poke(id, at, &b).ok_or_else(bad)
    }
}

impl Logic {
    /// The planted full-state hash: each item's globals, arrays and memory with every f64 its
    /// writes hold, in the arrays and in the write region under them, rounded to 1e-6.
    fn rounded(&mut self) -> u64 {
        let round = |bytes: &mut [u8]| {
            let v = f64::from_le_bytes(bytes[..8].try_into().expect("8 bytes"));
            bytes.copy_from_slice(&((v * 1e6).round() / 1e6).to_le_bytes());
        };
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        let states = self.world.states();
        for ((id, globals, mut arrays, mut memory), item) in
            states.into_iter().zip(&self.piece.items)
        {
            for w in item
                .writes
                .iter()
                .filter(|w| !matches!(w.ty, Ty::Bool | Ty::I32))
            {
                let e = item.write(&w.name).expect("a write entry");
                for k in (0..e.size as usize).step_by(8) {
                    let at = e.offset as usize + k;
                    round(&mut arrays[at..at + 8]);
                    let m = item.writes_at as usize + at;
                    if let Some(word) = memory.get_mut(m..m + 8) {
                        round(word);
                    }
                }
            }
            for b in id.bytes().chain(globals).chain(arrays).chain(memory) {
                h = (h ^ b as u64).wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        h
    }
}

/// FNV-1a over each (ID, hash) pair, in order.
fn fold<'a>(pairs: impl Iterator<Item = (&'a str, &'a str)>) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for (id, hash) in pairs {
        for b in id.bytes().chain([0]).chain(hash.bytes()).chain([0]) {
            h = (h ^ b as u64).wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    h
}

/// #550: the net check kinds' runs over a lowered document's match and its logic items, which a
/// build binds with `deep_net::kind::bind`.
pub const RUNS: deep_net::kind::Runs = deep_net::kind::Runs {
    rollback: rollback_report,
    desync: desync_report,
    budget: budget_report,
};

/// What a net check runs: the document's match, a stepper over its logic items at their start,
/// the steps it plays (`steps`, else its span's match steps, at most 3,600) and the planted twin.
struct Setup {
    cfg: deep_net::Config,
    piece: Rc<Piece>,
    track: Vec<Value>,
    steps: i64,
    planted: deep_net::Planted,
}

fn setup(doc: &Value, input: &Value) -> Result<Setup, Value> {
    let cfg = deep_net::Config::of(doc)
        .ok_or_else(|| json!({"what": "the document has no net@1 item to play a match of"}))?;
    let (piece, entries, _) = deep_logic::module::baked(doc, input)?;
    let span = doc
        .pointer("/transport/span")
        .map_or(Ok(0), |v| deep_canvas::document::duration(doc, v))
        .map_err(|e| json!({"what": format!("the transport's span: {e}")}))?;
    let steps = input
        .get("steps")
        .and_then(Value::as_i64)
        .unwrap_or((span / cfg.step()).min(3600))
        .max(1);
    let planted = input
        .get("planted")
        .and_then(Value::as_str)
        .and_then(deep_net::Planted::named)
        .unwrap_or_default();
    Ok(Setup {
        cfg,
        piece,
        track: entries.iter().map(Entry::to_json).collect(),
        steps,
        planted,
    })
}

/// A check's report as a requirement's row carries it: each failure raised on the net item, its
/// row as `actual`; a BLOCKED or INCONCLUSIVE reading blocked; the report itself a result.
fn row(cfg: &deep_net::Config, kind: &'static str, report: Value, result: Value) -> Report {
    let mut out = Report::default();
    for f in report["failures"].as_array().into_iter().flatten() {
        let what = f["what"]
            .as_str()
            .map_or_else(|| f.to_string(), str::to_string);
        let r = Raised {
            code: kind,
            severity: "error",
            path: format!("items/{}", cfg.item),
            what: format!("{kind}: {what}"),
            fix_ops: None,
        };
        out.raised.push((cfg.item.clone(), r, f.clone()));
    }
    if matches!(report["verdict"].as_str(), Some("BLOCKED" | "INCONCLUSIVE")) {
        for b in report["blocked"].as_array().into_iter().flatten() {
            out.blocked.push(json!({"kind": kind, "what": b["what"]}));
        }
    }
    out.results.push(result);
    out
}

fn blocked(kind: &str, why: Value) -> Report {
    Report {
        blocked: vec![json!({"kind": kind, "why": why})],
        ..Report::default()
    }
}

fn run_check(
    doc: &Value,
    input: &Value,
    kind: &'static str,
    check: impl FnOnce(
        &Setup,
        &deep_net::play::Ask,
        &mut dyn FnMut(u8) -> Result<Logic, Value>,
    ) -> Result<Value, Value>,
) -> Report {
    let s = match setup(doc, input) {
        Ok(s) => s,
        Err(why) => return blocked(kind, why),
    };
    let ask = deep_net::play::Ask {
        steps: s.steps,
        planted: s.planted,
        ..deep_net::play::Ask::default()
    };
    let (piece, track) = (s.piece.clone(), s.track.clone());
    let rounds = s.planted == deep_net::Planted::HashRoundsFloats;
    let make = &mut |_: u8| {
        Logic::new(piece.clone(), &track, false).map(|mut l| {
            l.rounds = rounds;
            l
        })
    };
    match check(&s, &ask, make) {
        Ok(report) => {
            let result = match kind {
                // The planted change and the net.desync report that located it.
                "net.desync" => {
                    json!({"kind": kind, "planted": report["planted"], "desync": report["desync"],
                                       "copies": report["copies"], "verdict": report["verdict"]})
                }
                _ => {
                    let mut r = report.clone();
                    r["kind"] = json!(kind);
                    r
                }
            };
            row(&s.cfg, kind, report, result)
        }
        Err(why) => blocked(kind, why),
    }
}

/// net.rollback `{steps}` over the document's match.
fn rollback_report(doc: &Value, input: &Value) -> Report {
    run_check(doc, input, "net.rollback", |s, ask, make| {
        deep_net::checks::rollback(&s.cfg, &Default::default(), ask, make).map(|(_, r)| r)
    })
}

/// net.desync `{seed}` over the document's match.
fn desync_report(doc: &Value, input: &Value) -> Report {
    let seed = input.get("seed").and_then(Value::as_u64).unwrap_or(0);
    run_check(doc, input, "net.desync", |s, ask, make| {
        deep_net::checks::desync(&s.cfg, &Default::default(), ask, make, seed).map(|(_, r)| r)
    })
}

/// net.budget over the document's match, against its class's frame time.
fn budget_report(doc: &Value, input: &Value) -> Report {
    let frame_ms = deep_canvas::budget::of(doc)
        .and_then(|(_, limits)| limits.cpu_ms)
        .unwrap_or(deep_logic::budget::FRAME_NS / 1e6);
    run_check(doc, input, "net.budget", |s, ask, make| {
        let busiest = |l: &Logic| l.busiest;
        deep_net::checks::budget(&s.cfg, &Default::default(), ask, make, frame_ms, &busiest)
            .map(|(_, r)| r)
    })
}
