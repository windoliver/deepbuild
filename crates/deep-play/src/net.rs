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
use deep_logic::world::rollback::{Plant, Ring};
use deep_logic::world::{track_of, Entry, Record, World};
use deep_net::play::Play;
use deep_net::{Change, Defect, Stepper};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;

/// #297 (Text `text@1`: entries): what each entry to a text control an entry text shows may
/// hold, checked alike on every copy: a value out of its range is refused before it joins the
/// track, naming the player, and the copy lists it in its `refused`.
pub struct Range {
    form: Map<String, Value>,
    ty: deep_canvas_marks::scene::Type,
    lax: deep_canvas_marks::entries::Lax,
    shaper: Option<deep_text::Shaper>,
}

impl Range {
    /// The range of `form`'s text controls entry texts show, in the type `ty` draws them in, with
    /// a planted laxness; `None` where no entry text shows one.
    pub fn of(
        form: &Value,
        ty: deep_canvas_marks::scene::Type,
        lax: deep_canvas_marks::entries::Lax,
    ) -> Option<Range> {
        let form = form.as_object()?;
        let items = form.get("items").and_then(Value::as_object)?;
        let shows = items.values().any(|i| {
            deep_canvas_marks::entries::is_entry_text(i)
                || deep_canvas_marks::entries::has_entry_column(i)
        });
        shows.then(|| Range {
            form: form.clone(),
            ty,
            lax,
            shaper: None,
        })
    }

    /// The refusal of `entry`, a value out of its control's range, naming the control, the
    /// player, the step and why; `None` where it is in range.
    pub fn check(&mut self, entry: &Value) -> Option<Value> {
        use deep_canvas_marks::entries;
        let control = entry["control"].as_str()?;
        let value = entry["value"].as_str()?;
        if !entries::shown_control(&self.form, control) {
            return None;
        }
        let shaper = self.shaper.get_or_insert_with(deep_text::Shaper::new);
        let r = entries::refused(&self.form, control, value, &self.ty, shaper, self.lax)?;
        let t = entry["t"].as_i64().unwrap_or(0);
        let mut out = json!({"code": "out_of_range", "control": control, "reason": r.reason(),
                             "player": entry.get("player").cloned().unwrap_or(json!(1)),
                             "t": t, "step": t.div_euclid(entries::step_len(&self.form))});
        for (k, v) in r.named().as_object().into_iter().flatten() {
            out[k] = v.clone();
        }
        Some(out)
    }
}

pub struct Logic {
    /// #297: the range entry texts give their controls, checked before an entry joins the track.
    pub range: Option<Range>,
    piece: Rc<Piece>,
    /// The input track recorded before the match, which a run again starts from.
    start: Vec<Value>,
    world: World,
    rec: Record,
    /// With `rows`, each match step's row as the `logic` call gives one: its hash and arrays
    /// per item.
    keep: bool,
    pub rows: Vec<Value>,
    /// #550's planted full-state hash, which rounds every float to 1e-6 first.
    pub rounds: bool,
    /// #551: logic's rollback ring and its size (`window + 1`), once a match keeps one, and its
    /// plant.
    ring: Option<(usize, Ring)>,
    plant: deep_logic::world::rollback::Plant,
    /// The CPU time logic took since the timing was last read, in ns.
    ns: u64,
    /// #551: the document's worlds, stepped beside the logic items, and the match step's length.
    worlds: Option<crate::net_worlds::Worlds>,
    len: i64,
}

impl Logic {
    /// `piece` at its start on `track`, the input track recorded before the match.
    pub fn new(piece: Rc<Piece>, track: &[Value], rows: bool) -> Result<Logic, Value> {
        let entries: Vec<Entry> = track.iter().filter_map(Entry::parse).collect();
        // A copy's frames are timed: its checkpoints' deep hashes are read by restoring them.
        let mut rec = Record::default();
        rec.deferred = true;
        // A match keeps logic's own ring, which a seek after it restores from (#551).
        let world = World::new(
            piece.clone(),
            track_of(&entries),
            true,
            Default::default(),
            &mut rec,
            None,
        )?;
        Ok(Logic {
            range: None,
            piece,
            start: track.to_vec(),
            world,
            rec,
            keep: rows,
            rows: Vec::new(),
            rounds: false,
            ring: None,
            plant: Default::default(),
            ns: 0,
            worlds: None,
            len: 1,
        })
    }

    /// #551: steps `doc`'s worlds beside the logic items, each its own canvas module.
    pub fn worlds(&mut self, doc: &Value) -> Result<(), Value> {
        self.worlds = crate::net_worlds::Worlds::of(doc, &self.start)?;
        Ok(())
    }

    /// #551: the planted ring this stepper's rollback ring is, once it keeps one.
    pub fn plant_ring(&mut self, plant: deep_logic::world::rollback::Plant) {
        self.plant = plant;
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
        if let Some(refused) = self.range.as_mut().and_then(|r| r.check(entry)) {
            return Err(refused);
        }
        let entry_json = entry;
        let entry = Entry::parse(entry).ok_or_else(
            || json!({"code": "bad_input", "what": "an entry is {t, control, value}"}),
        )?;
        self.world.append(entry)?;
        if let Some(w) = self.worlds.as_mut() {
            w.enter(entry_json);
        }
        Ok(())
    }

    fn run(&mut self, step: i64, until: i64) -> Result<(), Value> {
        let before = cpu_ns();
        self.world.run_through(until - 1, &mut self.rec);
        self.ns += cpu_ns() - before;
        if let Some(trap) = self.rec.traps.first() {
            return Err(trap.clone());
        }
        self.len = until / (step + 1).max(1);
        if let Some(w) = self.worlds.as_mut() {
            w.run(until)?;
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
        // FNV-1a over each item's ID and deep hash, in the piece's order, then each world's.
        let hashes = self.world.deep_hashes();
        let worlds = self.worlds.as_ref().map(|w| w.hashes()).unwrap_or_default();
        fold(
            hashes
                .iter()
                .map(|(id, h)| (id.as_str(), h.as_str().unwrap_or("")))
                .chain(worlds.iter().map(|(id, h)| (id.as_str(), h.as_str()))),
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
        let worlds = self.worlds.as_ref().map(|w| w.hashes()).unwrap_or_default();
        fields
            .into_iter()
            .map(|(f, h)| ("logic".to_string(), f, h))
            .chain(worlds.into_iter().map(|(id, h)| {
                let h = u64::from_str_radix(h.get(..16).unwrap_or("0"), 16).unwrap_or(0);
                ("physics".to_string(), format!("{id}.state"), h)
            }))
            .collect()
    }

    fn again(&self) -> Result<Self, Value> {
        let mut again = Logic::new(self.piece.clone(), &self.start, false)?;
        again.rounds = self.rounds;
        again.range = self.range.as_ref().map(|r| Range {
            form: r.form.clone(),
            ty: r.ty.clone(),
            lax: r.lax,
            shaper: None,
        });
        again.plant = self.plant;
        if let Some(w) = self.worlds.as_ref() {
            again.worlds = w.again(&self.start)?;
        }
        if let Some((size, _)) = self.ring.as_ref() {
            again.hold(*size);
        }
        Ok(again)
    }

    fn hold(&mut self, size: usize) {
        self.ring = Some((size, Ring::new(&mut self.world, size, self.plant)));
        if let Some(w) = self.worlds.as_mut() {
            w.hold(size);
        }
    }

    fn keep(&mut self, step: i64) {
        let before = cpu_ns();
        if let Some((_, ring)) = self.ring.as_mut() {
            ring.snap(&mut self.world, step);
        }
        self.ns += cpu_ns() - before;
        if let Some(w) = self.worlds.as_mut() {
            w.keep(step);
        }
    }

    fn back(&mut self, step: i64, t: i64) -> Result<(), Value> {
        let before = cpu_ns();
        let (_, ring) = self
            .ring
            .as_mut()
            .ok_or_else(|| json!({"code": "no_ring", "step": step}))?;
        ring.roll_back(&mut self.world, step, t, &mut self.rec)?;
        self.ns += cpu_ns() - before;
        self.rows
            .retain(|r| r["step"].as_i64().is_some_and(|k| k < step));
        if let Some(w) = self.worlds.as_mut() {
            w.back(step, t)?;
        }
        Ok(())
    }

    fn drawn(&self) -> Option<Value> {
        Some(Value::Object(self.rec.arrays(&self.piece)))
    }

    fn occurrences(&self) -> Vec<Value> {
        let len = self.len.max(1);
        let mut out = Vec::new();
        for (id, rows) in self.rec.occurrences(&self.piece) {
            for r in rows.as_array().into_iter().flatten() {
                let mut r = r.clone();
                let t = r["t"].as_i64().unwrap_or(0);
                r["item"] = json!(id);
                r["step"] = json!(t / len);
                out.push(r);
            }
        }
        if let Some(w) = self.worlds.as_ref() {
            out.extend(w.occurrences(len));
        }
        out
    }

    fn seek(&mut self, step: i64, len: i64) -> Result<(i64, u64), Value> {
        let from = self
            .world
            .nearest(step)
            .ok_or_else(|| json!({"code": "no_checkpoint", "step": step}))?;
        self.world.seek(from)?;
        let mut rec = Record::default();
        self.world.run_through((step + 1) * len - 1, &mut rec);
        if let Some(w) = self.worlds.as_ref() {
            self.worlds = w.replayed((step + 1) * len)?;
        }
        Ok((from, self.hash()))
    }

    fn timed(&mut self) -> Vec<(String, u64)> {
        let mut out = vec![("logic".to_string(), std::mem::take(&mut self.ns))];
        if let Some(w) = self.worlds.as_mut() {
            out.push(("physics".to_string(), std::mem::take(&mut w.ns)));
        }
        out
    }

    fn written(&self) -> Vec<(String, u64)> {
        let logic = self.ring.as_ref().map_or(0, |(_, r)| r.written());
        let mut out = vec![("logic".to_string(), logic)];
        if let Some(w) = self.worlds.as_ref() {
            out.push(("physics".to_string(), w.written));
        }
        out
    }

    fn made(&mut self) -> std::collections::BTreeMap<i64, Value> {
        let mut out = std::collections::BTreeMap::<i64, Value>::new();
        // Each item's step hash and each emitting item's occurrences, as the step left them.
        for (k, (items, arrays)) in self.rec.rows() {
            let hashes: Map<String, Value> = items
                .iter()
                .map(|(id, r)| (id.clone(), r["hash"].clone()))
                .collect();
            let occurrences: Map<String, Value> = arrays
                .iter()
                .filter(|(name, _)| name.ends_with(".occurrences"))
                .map(|(n, v)| (n.clone(), v.clone()))
                .collect();
            out.insert(
                *k,
                json!({"step_hashes": hashes, "occurrences": occurrences}),
            );
        }
        if let Some(w) = self.worlds.as_ref() {
            for (k, v) in w.made(self.len) {
                out.entry(k).or_insert_with(|| json!({}))["physics"] = v["physics"].clone();
            }
        }
        // Each checkpoint its items' own rings hold, by the deep hash of its state, read by
        // restoring it (the copy's record defers them).
        let labels: std::collections::BTreeSet<i64> = self
            .rec
            .checkpoints
            .values()
            .flat_map(|list| list.as_array().into_iter().flatten())
            .filter_map(|c| c["step"].as_i64())
            .collect();
        for k in labels {
            let at = out.entry(k).or_insert_with(|| json!({}));
            at["checkpoints"] = match self.world.restore(k, None) {
                Ok(mut w) => Value::Object(w.deep_hashes()),
                Err(why) => json!({"restored": false, "why": why}),
            };
        }
        out
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
    /// #551: the planted rollback ring, and what each player does (`plays`, else seeded).
    ring: Plant,
    plays: BTreeMap<u8, Vec<Play>>,
}

/// #551: a check input's planted name as each part takes it: the copy's, the rollback ring's,
/// and the logic module's (the ring that misses a page `memory.fill` alone wrote is a page
/// tracker that leaves those pages unmarked).
pub fn planted(name: Option<&str>) -> (deep_net::Planted, Plant, deep_logic::Planted) {
    let name = name.unwrap_or_default();
    let logic = match name {
        "net_ring_misses_fill" => "tracker_skips_memory_fill",
        n => n,
    };
    (
        deep_net::Planted::named(name).unwrap_or_default(),
        Plant::named(name).unwrap_or_default(),
        deep_logic::Planted::default()
            .and(logic)
            .unwrap_or_default(),
    )
}

/// #551: what each player does when the check names no plays: from step `delay` on, every few
/// steps, an entry on one of the piece's controls with a value it can take, by the seed.
pub fn seeded(doc: &Value, players: u8, steps: i64, seed: u64) -> BTreeMap<u8, Vec<Play>> {
    let controls: Vec<(&String, &Value)> = doc
        .get("controls")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .filter(|(_, c)| c.get("range").is_some())
        .collect();
    let mut z = seed ^ 0x6e65_7435_3531;
    let mut next = || {
        z = z.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut x = z;
        x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        x ^ (x >> 31)
    };
    let mut out = BTreeMap::new();
    for p in 1..=players {
        let mut list = Vec::new();
        let mut step = (next() % 4) as i64;
        while step < steps && !controls.is_empty() {
            let (name, c) = controls[(next() % controls.len() as u64) as usize];
            let lo = c["range"][0].as_f64().unwrap_or(0.0);
            let hi = c["range"][1].as_f64().unwrap_or(1.0);
            let by = c["increment"].as_f64().filter(|i| *i > 0.0).unwrap_or(1.0);
            let n = ((hi - lo) / by).floor().max(0.0) as u64 + 1;
            let value = lo + (next() % n) as f64 * by;
            list.push(Play {
                step,
                control: name.clone(),
                value: json!(value),
                to: None,
            });
            step += 1 + (next() % 6) as i64;
        }
        out.insert(p, list);
    }
    out
}

fn setup(doc: &Value, input: &Value) -> Result<Setup, Value> {
    let cfg = deep_net::Config::of(doc)
        .ok_or_else(|| json!({"what": "the document has no net@1 item to play a match of"}))?;
    let (planted, ring, logic) = planted(input.get("planted").and_then(Value::as_str));
    let (piece, entries, _) = deep_logic::module::baked_with(doc, input, &logic)?;
    let span = doc
        .pointer("/transport/span")
        .map_or(Ok(0), |v| deep_canvas::document::duration(doc, v))
        .map_err(|e| json!({"what": format!("the transport's span: {e}")}))?;
    let steps = input
        .get("steps")
        .and_then(Value::as_i64)
        .unwrap_or((span / cfg.step()).min(3600))
        .max(1);
    let seed = input.get("seed").and_then(Value::as_u64).unwrap_or(0);
    let plays = match input.get("plays") {
        Some(p) => plays_of(p).ok_or_else(
            || json!({"what": "a check's plays are {player: [{step, control, value}]}"}),
        )?,
        None => seeded(doc, cfg.players, steps - cfg.delay, seed),
    };
    Ok(Setup {
        cfg,
        piece,
        track: entries.iter().map(Entry::to_json).collect(),
        steps,
        planted,
        ring,
        plays,
    })
}

/// A check input's `plays`: `{player: [{step, control, value}]}`.
fn plays_of(v: &Value) -> Option<BTreeMap<u8, Vec<Play>>> {
    v.as_object()?
        .iter()
        .map(|(who, list)| {
            let list = list
                .as_array()?
                .iter()
                .map(|p| {
                    Some(Play {
                        step: p.get("step")?.as_i64()?,
                        control: p.get("control")?.as_str()?.to_string(),
                        value: p.get("value")?.clone(),
                        to: None,
                    })
                })
                .collect::<Option<Vec<_>>>()?;
            Some((who.parse().ok()?, list))
        })
        .collect()
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
        let why =
            ["blocked", "inconclusive"].map(|k| report[k].as_array().cloned().unwrap_or_default());
        for b in why.iter().flatten() {
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
        plays: s.plays.clone(),
        faults: deep_net::play::Faults {
            seed: input.get("seed").and_then(Value::as_u64).unwrap_or(0),
            ..Default::default()
        },
        ..deep_net::play::Ask::default()
    };
    let (piece, track, ring) = (s.piece.clone(), s.track.clone(), s.ring);
    let rounds = s.planted == deep_net::Planted::HashRoundsFloats;
    let make = &mut |_: u8| {
        let mut l = Logic::new(piece.clone(), &track, false)?;
        l.rounds = rounds;
        l.plant_ring(ring);
        l.worlds(doc)?;
        Ok(l)
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
        let on = hosts(input);
        deep_net::checks::budget(&s.cfg, &Default::default(), ask, make, frame_ms, &on)
            .map(|(_, r)| r)
    })
}

/// #551: the hosts net.budget measures for, its input's `on` (`app` by default).
pub fn hosts(input: &Value) -> Vec<String> {
    let on: Vec<String> = input
        .get("on")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|h| h.as_str().map(str::to_string))
        .collect();
    if on.is_empty() {
        vec!["app".to_string()]
    } else {
        on
    }
}
