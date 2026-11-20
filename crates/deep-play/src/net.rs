//! #549: what a copy of a match steps, as the app and the web player both step it: a document's
//! logic items, one match step at a time on the one clock, each entry joining the input track at
//! its step before that step runs, and the full-state hash over every item's whole carried
//! state. Each stepping item's step length divides the match step's or is a whole multiple of
//! it, so a match step runs every item step whose time falls inside it.

use std::rc::Rc;

use deep_logic::budget::cpu_ns;
use deep_logic::piece::Piece;
use deep_logic::world::{track_of, Entry, Record, World};
use deep_net::Stepper;
use serde_json::{json, Map, Value};

/// #297 (Text `text@1`: entries): what each entry to a text control an entry text shows may
/// hold, checked alike on every copy: a value out of its range is refused before it joins the
/// track, naming the player, and kept in `refused`.
pub struct Range {
    form: Map<String, Value>,
    ty: deep_canvas_marks::scene::Type,
    lax: deep_canvas_marks::entries::Lax,
    shaper: Option<deep_text::Shaper>,
    pub refused: Vec<Value>,
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
            refused: Vec::new(),
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
        self.refused.push(out.clone());
        Some(out)
    }
}

pub struct Logic {
    /// #297: the range entry texts give their controls, checked before an entry joins the track.
    pub range: Option<Range>,
    piece: Rc<Piece>,
    world: World,
    rec: Record,
    /// With `rows`, each match step's row as the `logic` call gives one: its hash and arrays
    /// per item.
    keep: bool,
    pub rows: Vec<Value>,
    /// The match step that took the most CPU time, and that time in ms.
    pub busiest: Option<(i64, f64)>,
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
            range: None,
            piece,
            world,
            rec,
            keep: rows,
            rows: Vec::new(),
            busiest: None,
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
        if let Some(refused) = self.range.as_mut().and_then(|r| r.check(entry)) {
            return Err(refused);
        }
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
        // FNV-1a over each item's ID and deep hash, in the piece's order.
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for (id, hash) in self.world.deep_hashes() {
            for b in id
                .bytes()
                .chain([0])
                .chain(hash.as_str().unwrap_or("").bytes())
                .chain([0])
            {
                h = (h ^ b as u64).wrapping_mul(0x0000_0100_0000_01b3);
            }
        }
        h
    }
}
