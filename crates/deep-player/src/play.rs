//! A bundle's piece played (#172): its document on its recorded input track as the app plays it,
//! the form made by the app's own calls ([`deep_play::form::played`]), evaluated by the core's
//! scheduler with the player's sealed modules. Each world's bake and each logic item's replay are
//! the app's (`physics_bake`, the `logic` call), so `probe()` reads the step hashes and full-state
//! hashes the app reads; evaluated data is read as the app's `eval` reads it. A set without
//! physics and logic (#1490: figure) runs no world or logic item: the export gives it no document
//! that has one.

use std::collections::BTreeMap;
#[cfg(feature = "game2d")]
use std::rc::Rc;

use deep_canvas::registry::Sealed;
use deep_canvas::schedule::{Options, Scheduler, Session};
use deep_canvas_motion::program::Program;
#[cfg(feature = "game2d")]
use deep_canvas_physics::caps::RAPIER3D;
#[cfg(feature = "game2d")]
use deep_canvas_physics::check::check;
#[cfg(feature = "game2d")]
use deep_canvas_physics::occurrence::step_flicks;
#[cfg(feature = "game2d")]
use deep_logic::saves::{self, Held};
#[cfg(feature = "game2d")]
use deep_logic::world::{track_of, Entry, Record, World};
#[cfg(feature = "game2d")]
use deep_physics_rapier::runner::Run;
use serde_json::{json, Map, Value};

/// Flicks in a second.
pub const FLICKS: i64 = deep_canvas::camera::FLICKS_PER_SECOND;

/// One checkpoint: the step it was taken at and its full-state hash.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Checkpoint {
    pub step: i64,
    pub hash: String,
}

/// A world's or a logic item's run over the piece's span, as the app bakes and replays it.
#[derive(Default)]
struct Run1 {
    /// The hash after k steps (a world's index 0 as built); a logic item's index k after step k + 1.
    steps: Vec<Value>,
    checkpoints: Vec<Checkpoint>,
}

/// Each world's or logic item's run, by ID.
#[cfg(feature = "game2d")]
type Runs = BTreeMap<String, Run1>;

/// The logic items' runs, each one's program as this player rewrote it, the saves their steps ask
/// for in step order, and the step a save opened them at (0 from the start).
#[cfg(feature = "game2d")]
struct Logic {
    runs: Runs,
    rewritten: BTreeMap<String, String>,
    saves: Vec<Held>,
    from: i64,
    /// #189: the carry records its steps write, each `{item, step, hash, record}`.
    records: Vec<Value>,
}

/// A played piece.
pub struct Played {
    sched: Scheduler<'static>,
    session: Session,
    doc: Value,
    /// The form's motion program, which a readout's values are evaluated by at the shown time.
    motion: Option<Program>,
    /// Whether the form has anything a readout says (an item's template or a figure's card), so a
    /// frame of a piece with none evaluates nothing for its readouts.
    reads_out: bool,
    track: Vec<Value>,
    /// The piece's step in flicks: its worlds' and logic items' least, else a 60th of a second.
    pub step: i64,
    /// The transport's span in flicks.
    pub span: i64,
    worlds: BTreeMap<String, Run1>,
    logic: BTreeMap<String, Run1>,
    /// The time the session last framed, in flicks.
    t: i64,
    /// Each logic item's program as this player rewrote it, by item: the SHA-256 of its bytes.
    pub rewritten: BTreeMap<String, String>,
    /// The bundle's document as given, and the look's tokens, from which an entry plays again.
    source: Value,
    /// The look the piece draws in, and its ground, which a frame draws over.
    pub look: deep_canvas_marks::look::Look,
    pub ground: [u8; 3],
    /// The sealed set, whose fills a 3D frame evaluates with.
    pub sealed: &'static Sealed,
    /// The saves the piece's steps ask for on its track (Logic: saves), in step order, and the
    /// step through which the page's store has taken them.
    #[cfg(feature = "game2d")]
    saves: Vec<Held>,
    #[cfg(feature = "game2d")]
    taken: i64,
    /// Each step at which the recorded play asks for a save, with every logic item's full-state
    /// hash there: the states a save can open at.
    #[cfg(feature = "game2d")]
    reached: Vec<(i64, Map<String, Value>)>,
    /// #189: the carry records the piece's steps write on its track (Logic: carry records), in
    /// step order, and the step through which the page's store has taken them.
    #[cfg(feature = "game2d")]
    records: Vec<Value>,
    #[cfg(feature = "game2d")]
    records_taken: i64,
}

fn refusal(what: impl Into<String>) -> String {
    what.into()
}

impl Played {
    /// `doc` on `track`, its assets read by `read` (by SHA-256), sealed by `sealed`.
    pub fn new(
        sealed: &'static Sealed,
        doc: &Value,
        track: &[Value],
        read: &dyn Fn(&str) -> Option<Vec<u8>>,
        look: deep_canvas_marks::look::Look,
    ) -> Result<Played, String> {
        let tokens = deep_canvas_marks::modules::look_tokens(&look);
        let form = deep_play::form::played(sealed, doc, track, read)
            .map_err(|i| refusal(format!("{}: {}", i.code, i.to_json())))?;
        let span = deep_canvas_media::doc::time(&form, form.pointer("/transport/span"))
            .unwrap_or(0)
            .max(0);
        #[allow(unused_mut)]
        let mut steps: Vec<i64> = Vec::new();
        #[cfg(feature = "game2d")]
        let worlds = worlds(&form, track, span, &mut steps)?;
        #[cfg(feature = "game2d")]
        let Logic {
            runs: logic,
            rewritten,
            saves,
            records,
            ..
        } = logic(sealed, &form, track, read, span, &mut steps, None)?;
        #[cfg(not(feature = "game2d"))]
        let (worlds, logic, rewritten) = Default::default();
        let step = steps.into_iter().min().unwrap_or(FLICKS / 60).max(1);
        let mut sched = Scheduler::new(sealed, Options::default());
        let mut session = Session::new(0, tokens);
        session.load(&mut sched, &form);
        let motion = form.as_object().and_then(|m| Program::compile(m).ok());
        let reads_out = form.get("card").is_some()
            || form
                .get("items")
                .and_then(Value::as_object)
                .is_some_and(|items| {
                    items
                        .values()
                        .any(|i| i.pointer("/params/template").is_some())
                });
        Ok(Played {
            sched,
            session,
            motion,
            reads_out,
            doc: form,
            track: track.to_vec(),
            step,
            span,
            worlds,
            logic,
            t: -1,
            rewritten,
            source: doc.clone(),
            ground: look.light.get("ground").copied().unwrap_or([255; 3]),
            look,
            sealed,
            #[cfg(feature = "game2d")]
            reached: saves
                .iter()
                .map(|s| (s.step, s.deep_hash.clone()))
                .collect(),
            #[cfg(feature = "game2d")]
            saves,
            #[cfg(feature = "game2d")]
            taken: 0,
            #[cfg(feature = "game2d")]
            records,
            #[cfg(feature = "game2d")]
            records_taken: 0,
        })
    }

    /// The page's own entry on `control` at the shown time: the input track gains it and the piece
    /// is made again on that track, as the app's session replays what it holds, the shown time kept.
    pub fn enter(
        &mut self,
        sealed: &'static Sealed,
        control: &str,
        value: Value,
        read: &dyn Fn(&str) -> Option<Vec<u8>>,
    ) -> Result<(), String> {
        let (t, seq) = self.stamp();
        let entry = json!({"t": t, "seq": seq, "control": control, "value": value, "writer": "you", "player": 1});
        self.again(sealed, entry, read)
    }

    /// #860: the viewer's back on a piece that declares rewind, which is the reader's: a rewind to
    /// the stop before at the shown time, and the piece made again on that track. A piece with no
    /// rewind takes no entry, and false.
    pub fn back(
        &mut self,
        sealed: &'static Sealed,
        read: &dyn Fn(&str) -> Option<Vec<u8>>,
    ) -> Result<bool, String> {
        if self.source.get("rewind").is_none() {
            return Ok(false);
        }
        let (t, seq) = self.stamp();
        let entry = json!({"t": t, "seq": seq, "rewind": {"to": {"stop": 1}}, "writer": "you", "player": 1});
        self.again(sealed, entry, read)?;
        Ok(true)
    }

    /// The shown time and the seq an entry stamped then takes.
    fn stamp(&self) -> (i64, usize) {
        let t = self.t();
        let seq = self
            .track
            .iter()
            .filter(|e| e["t"].as_i64() == Some(t))
            .count();
        (t, seq)
    }

    /// The piece made again on its track with `entry`, the shown time kept.
    fn again(
        &mut self,
        sealed: &'static Sealed,
        entry: Value,
        read: &dyn Fn(&str) -> Option<Vec<u8>>,
    ) -> Result<(), String> {
        let t = self.t();
        let mut track = self.track.clone();
        track.push(entry);
        track.sort_by_key(|e| (e["t"].as_i64().unwrap_or(0), e["seq"].as_i64().unwrap_or(0)));
        let mut again = Played::new(sealed, &self.source, &track, read, self.look.clone())?;
        again.frame(t);
        #[cfg(feature = "game2d")]
        {
            again.taken = again.step_at();
            again.records_taken = again.step_at();
        }
        *self = again;
        Ok(())
    }

    /// The document's stable ID.
    pub fn id(&self) -> &str {
        self.source.get("id").and_then(Value::as_str).unwrap_or("")
    }

    /// The played form the session holds.
    pub fn document(&self) -> &Value {
        &self.doc
    }

    /// The session framed at `t` flicks.
    pub fn frame(&mut self, t: i64) {
        let t = t.clamp(0, self.span);
        if t != self.t {
            let view: [Value; 6] = Default::default();
            self.session.frame(&mut self.sched, t, &view);
            self.t = t;
        }
    }

    /// What the session's last frame draws, as the app reads it.
    pub fn painted(&self) -> Option<deep_play::drawing::Painted> {
        deep_play::drawing::drawing_of(&self.sched, &self.session, &deep_play::drawing::program_of)
    }

    /// The time the session last framed, in flicks.
    pub fn t(&self) -> i64 {
        self.t.max(0)
    }

    /// The steps run at the shown time.
    pub fn step_at(&self) -> i64 {
        self.t() / self.step
    }

    /// What the player holds at the shown time: its step, each world's and logic item's step hash
    /// and checkpoints so far, and its evaluated data by stable ID. Reads only.
    pub fn probe(&self) -> Map<String, Value> {
        let k = self.step_at();
        let mut hashes = Map::new();
        let mut checkpoints = Map::new();
        for (id, run) in &self.worlds {
            hashes.insert(
                id.clone(),
                run.steps.get(k as usize).cloned().unwrap_or(Value::Null),
            );
            checkpoints.insert(id.clone(), held(&run.checkpoints, k));
        }
        for (id, run) in &self.logic {
            let h = (k >= 1)
                .then(|| run.steps.get(k as usize - 1).cloned())
                .flatten()
                .unwrap_or(Value::Null);
            hashes.insert(id.clone(), h);
            checkpoints.insert(id.clone(), held(&run.checkpoints, k));
        }
        let mut out = Map::new();
        out.insert("step".into(), json!(k));
        out.insert("step_hash".into(), Value::Object(hashes));
        out.insert("checkpoint_hashes".into(), Value::Object(checkpoints));
        out.insert("values".into(), Value::Object(self.values()));
        out
    }

    /// The document's accessibility tree (#1045): the one the app gives its accessibility seam,
    /// made by the app's own function from the form this player plays, each control's node
    /// marked `control` so the page makes it a Tab stop. The player hides no item a view would.
    pub fn tree(&self) -> Vec<Value> {
        let controls = self.doc.get("controls").and_then(Value::as_object);
        let mut nodes = deep_play::access::tree(&self.doc, &[]);
        for n in &mut nodes {
            let id = n["id"].as_str().unwrap_or_default();
            if controls.is_some_and(|c| c.contains_key(id)) {
                n["control"] = json!(true);
            }
        }
        nodes
    }

    /// Each readout heard and what it says in the frame shown (#1045), as the app's `see` reads
    /// it: the form's values at the shown time filled into each readout's template. Reads only.
    pub fn readouts(&self) -> BTreeMap<String, String> {
        if !self.reads_out {
            return BTreeMap::new();
        }
        let shown = deep_play::access::data_at(&self.doc, self.motion.as_ref(), self.t());
        deep_play::access::readouts(&shown, &[])
    }

    /// Evaluated data by stable ID: each logic array `<logic ID>.<name>` as `eval`'s `arrays`
    /// reads it, each path a world output or a driver writes as `eval`'s `paths` reads it, and each
    /// control's `controls/<ID>/value`.
    fn values(&self) -> Map<String, Value> {
        let t = self.t();
        let mut out = Map::new();
        for name in self.arrays() {
            let v = deep_play::read::array(&self.sched, &self.session, &name, t);
            out.insert(name, v);
        }
        let paths = self.paths();
        if let Value::Object(read) = deep_play::read::values(&self.sched, &self.session, &paths) {
            out.extend(read);
        }
        for (id, c) in self
            .doc
            .get("controls")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            out.insert(format!("controls/{id}/value"), self.control_at(id, c, t));
        }
        out
    }

    /// The logic items' arrays, `<logic ID>.<name>`: none in a set without logic.
    #[cfg(not(feature = "game2d"))]
    fn arrays(&self) -> Vec<String> {
        Vec::new()
    }

    /// The logic items' arrays, `<logic ID>.<name>`.
    #[cfg(feature = "game2d")]
    fn arrays(&self) -> Vec<String> {
        let items = self.doc.get("items").and_then(Value::as_object);
        let mut out = Vec::new();
        for (id, item) in items.into_iter().flatten() {
            if item.get("kind").and_then(Value::as_str) != Some(deep_logic::module::INTERFACE) {
                continue;
            }
            for name in item
                .pointer("/params/writes")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .map(|(n, _)| n)
            {
                out.push(format!("{id}.{name}"));
            }
        }
        out
    }

    /// The item paths a world's output or a driver writes, each a leaf: a whole `at` as its
    /// position's and rotation's parts.
    fn paths(&self) -> Vec<String> {
        let mut out: Vec<String> = Vec::new();
        for d in self
            .doc
            .get("drivers")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(_, d)| d)
        {
            if let Some(t) = d.get("target").and_then(Value::as_str) {
                out.push(t.to_string());
            }
        }
        for w in self
            .doc
            .get("worlds")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .map(|(_, w)| w)
        {
            for o in w
                .get("outputs")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .map(|(_, o)| o)
            {
                if let Some(to) = o.get("to").and_then(Value::as_str) {
                    out.push(to.to_string());
                }
            }
        }
        out.sort();
        out.dedup();
        out
    }

    /// A control's value at `t`: its last track entry at or before `t`, else its default.
    fn control_at(&self, id: &str, c: &Value, t: i64) -> Value {
        self.track
            .iter()
            .rfind(|e| e["control"] == id && e["t"].as_i64().is_some_and(|et| et <= t))
            .map(|e| e["value"].clone())
            .or_else(|| c.get("default").cloned())
            .unwrap_or(Value::Null)
    }
}

/// The piece's saves (Logic: saves), in the sets that carry logic.
#[cfg(feature = "game2d")]
impl Played {
    /// The most slots a logic item of the piece declares (Logic: saves); 0 for a piece with no saves.
    pub fn slots(&self) -> i64 {
        let items = self.doc.get("items").and_then(Value::as_object);
        items
            .into_iter()
            .flatten()
            .filter_map(|(_, i)| i.pointer("/params/saves"))
            .map(|s| s.get("slots").and_then(Value::as_i64).unwrap_or(1))
            .max()
            .unwrap_or(0)
    }

    /// The saves asked for by the steps the shown time has reached since the last call, in step
    /// order: each `{at, item, slot, step, ended, deep_hash}`, `at` its place for [`Self::save`].
    pub fn due(&mut self) -> Vec<Value> {
        let k = self.step_at();
        let out = self
            .saves
            .iter()
            .enumerate()
            .filter(|(_, s)| s.step > self.taken && s.step <= k)
            .map(|(at, s)| json!({"at": at, "item": s.item, "slot": s.slot, "step": s.step, "ended": s.ended, "deep_hash": s.deep_hash}))
            .collect();
        self.taken = self.taken.max(k);
        out
    }

    /// The save at `at` as its slot's save number `seq`: its bytes, which its SHA-256 names.
    pub fn save(&self, at: usize, seq: u64) -> Option<Vec<u8>> {
        Some(self.saves.get(at)?.bytes(seq))
    }

    /// The viewer opens the save named `name`, its SHA-256 (Logic: saves): every logic item's
    /// state is restored from `bytes` into fresh instances and played on along the track, so from
    /// its step on the hashes are that run's, and the shown time is its step. This player plays
    /// only its recorded input track, so a save opens where that play asks for a save with the
    /// same full-state hashes; any other is refused, naming what differs, as one that fails its
    /// hash or doesn't match the piece is.
    pub fn open(
        &mut self,
        name: &str,
        bytes: &[u8],
        read: &dyn Fn(&str) -> Option<Vec<u8>>,
    ) -> Result<Value, Value> {
        let mut steps = Vec::new();
        let opened = logic(
            self.sealed,
            &self.doc,
            &self.track,
            read,
            self.span,
            &mut steps,
            Some((name, bytes)),
        )
        .map_err(|e| serde_json::from_str::<Value>(&e).unwrap_or(Value::String(e)))?;
        let k = opened.from;
        let deep = opened
            .runs
            .iter()
            .filter_map(|(id, r)| Some((id.clone(), json!(r.checkpoints.first()?.hash))))
            .collect::<Map<String, Value>>();
        let reached = |(step, hashes): &(i64, Map<String, Value>)| {
            *step == k && !deep.is_empty() && deep.iter().all(|(id, h)| hashes.get(id) == Some(h))
        };
        if !self.reached.iter().any(reached) {
            return Err(
                json!({"code": "save_refused", "save": name, "differs": [{"what": "play", "step": k}]}),
            );
        }
        for (id, mut run) in opened.runs {
            if let Some(was) = self.logic.get_mut(&id) {
                let at = (k as usize).min(was.steps.len()).min(run.steps.len());
                was.steps.truncate(at);
                was.steps.extend(run.steps.drain(at..));
                was.checkpoints.retain(|c| c.step < k);
                was.checkpoints.append(&mut run.checkpoints);
            }
        }
        self.saves = opened.saves;
        self.taken = k;
        self.frame(k * self.step);
        Ok(json!({"hash": name, "step": k, "deep_hash": deep}))
    }
}

/// The piece's carry records (Logic: carry records), in the sets that carry logic.
#[cfg(feature = "game2d")]
impl Played {
    /// Whether a logic item of the piece declares `field` (`carry` or `carry_in`).
    pub fn declares(&self, field: &str) -> bool {
        let items = self.doc.get("items").and_then(Value::as_object);
        items.into_iter().flatten().any(|(_, i)| {
            i["kind"] == deep_logic::module::INTERFACE && i.pointer(&format!("/params/{field}")).is_some()
        })
    }

    /// The records the steps the shown time has reached since the last call wrote, in step
    /// order: each `{at, item, step, hash, layout}`, `at` its place for [`Self::record`]. A record
    /// of step k is written once step k ends.
    pub fn records_due(&mut self) -> Vec<Value> {
        let k = self.step_at();
        let taken = self.records_taken;
        let out = self
            .records
            .iter()
            .enumerate()
            .filter(|(_, r)| r["step"].as_i64().is_some_and(|s| s + 1 > taken && s < k))
            .map(|(at, r)| json!({"at": at, "item": r["item"], "step": r["step"], "hash": r["hash"], "layout": r["record"]["from"]["layout"]}))
            .collect();
        self.records_taken = taken.max(k);
        out
    }

    /// The record at `at` of [`Self::records_due`]: its bytes as the app's record file holds them,
    /// which their SHA-256 names.
    pub fn record(&self, at: usize) -> Option<Vec<u8>> {
        Some(self.records.get(at)?["record"].to_string().into_bytes())
    }

    /// The viewer opens a carry record into the piece (Logic: carry records): `bytes`, held to
    /// `name`, their SHA-256, and to the shape and layouts its `carry_in` takes, as the app holds
    /// one; taken, its entry enters the track at step 0 by hash and the piece is made again on
    /// that track, held from its start. A record it refuses is named with what differs.
    pub fn take_record(
        &mut self,
        sealed: &'static Sealed,
        name: &str,
        bytes: &[u8],
        read: &dyn Fn(&str) -> Option<Vec<u8>>,
    ) -> Result<Value, Value> {
        let refused = |differs: Value| json!({"code": "carry_refused", "record": name, "differs": differs});
        if sha256_hex(bytes) != name {
            return Err(refused(json!([{"what": "hash"}])));
        }
        let record: Value = serde_json::from_slice(bytes).map_err(|_| refused(json!([{"what": "record"}])))?;
        let piece = deep_play::logic::logic_piece(sealed, &self.doc, &self.track, read, false)
            .map_err(|i| refused(json!([{"what": "piece", "issue": i.to_json()}])))?
            .ok_or_else(|| refused(json!([{"what": "carry_in"}])))?;
        let differs = deep_logic::carry::differs(&piece, &record);
        if !differs.is_empty() {
            return Err(refused(json!(differs)));
        }
        self.track.retain(|e| e.get("carry").is_none());
        let entry = json!({"t": 0, "seq": 0, "carry": name, "arrays": record["arrays"], "writer": "you", "player": 1});
        self.again(sealed, entry, read).map_err(|e| refused(json!([{"what": "piece", "issue": e}])))?;
        self.frame(0);
        Ok(json!({"record": name}))
    }
}

/// A set without logic keeps no save.
#[cfg(not(feature = "game2d"))]
impl Played {
    pub fn declares(&self, _field: &str) -> bool {
        false
    }
    pub fn records_due(&mut self) -> Vec<Value> {
        Vec::new()
    }
    pub fn record(&self, _at: usize) -> Option<Vec<u8>> {
        None
    }
    pub fn take_record(
        &mut self,
        _sealed: &'static Sealed,
        name: &str,
        _bytes: &[u8],
        _read: &dyn Fn(&str) -> Option<Vec<u8>>,
    ) -> Result<Value, Value> {
        Err(json!({"code": "carry_refused", "record": name}))
    }
    pub fn slots(&self) -> i64 {
        0
    }
    pub fn due(&mut self) -> Vec<Value> {
        Vec::new()
    }
    pub fn save(&self, _at: usize, _seq: u64) -> Option<Vec<u8>> {
        None
    }
    pub fn open(
        &mut self,
        name: &str,
        _bytes: &[u8],
        _read: &dyn Fn(&str) -> Option<Vec<u8>>,
    ) -> Result<Value, Value> {
        Err(json!({"code": "save_refused", "save": name}))
    }
}

/// The checkpoints taken at or before step `k`.
fn held(cps: &[Checkpoint], k: i64) -> Value {
    Value::Array(
        cps.iter()
            .filter(|c| c.step <= k)
            .map(|c| json!({"step": c.step, "hash": c.hash}))
            .collect(),
    )
}

/// Each world of `form` baked on `track` as the app's `physics_bake` bakes it, with its
/// checkpoints; each world's step added to `steps`.
#[cfg(feature = "game2d")]
fn worlds(
    form: &Value,
    track: &[Value],
    span: i64,
    steps: &mut Vec<i64>,
) -> Result<BTreeMap<String, Run1>, String> {
    let mut out = BTreeMap::new();
    let rate = form
        .pointer("/transport/frame_rate")
        .cloned()
        .unwrap_or(json!([60, 1]));
    let run = Run::new(None).ok_or_else(|| refusal("the physics runner doesn't start"))?;
    for (id, world) in form
        .get("worlds")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let w = deep_physics_rapier::bound::expand(Some(form), world)
            .and_then(|d| check(&d, &RAPIER3D, &deep_canvas_physics::roles::TABLE))
            .map_err(|e| {
                refusal(format!(
                    "the world {id} is refused: {}",
                    e.iter()
                        .map(|r| r.what.clone())
                        .collect::<Vec<_>>()
                        .join("; ")
                ))
            })?;
        let kept = deep_play::derive::kept(form, &w, track, &[], false)
            .map_err(|r| refusal(format!("the world {id}'s inputs are refused: {}", r.what)))?;
        let step = step_flicks(&w);
        steps.push(step);
        let count = deep_play::worlds::steps_of(form, world, span, step);
        let call = json!({"call": "bake", "scene": form, "world": id, "steps": count, "frame_rate": rate,
                          "track": deep_play::derive::track_of(&kept), "read": [], "checkpoints": true});
        let reply = run.answer(&call).unwrap_or(Value::Null);
        if reply["ok"] != json!(true) {
            return Err(refusal(format!("the world {id} doesn't bake: {reply}")));
        }
        let checkpoints = reply["checkpoints"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|c| {
                Some(Checkpoint {
                    step: c["step"].as_i64()?,
                    hash: c["deep_hash"].as_str()?.to_string(),
                })
            })
            .collect();
        let hashes = reply["step_hashes"].as_array().cloned().unwrap_or_default();
        out.insert(
            id.clone(),
            Run1 {
                steps: hashes,
                checkpoints,
            },
        );
    }
    Ok(out)
}

/// Each logic item of `form` replayed on `track` over the span as the app's `logic` call replays
/// it, with its checkpoints and the saves its steps ask for; each item's step added to `steps`.
/// With `opened`, a save's name and bytes, the items start from that save's state at its step, as
/// the viewer opens it (a refusal is the logic module's own, as JSON).
#[cfg(feature = "game2d")]
fn logic(
    sealed: &Sealed,
    form: &Value,
    track: &[Value],
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    span: i64,
    steps: &mut Vec<i64>,
    opened: Option<(&str, &[u8])>,
) -> Result<Logic, String> {
    let none = Logic {
        runs: Runs::new(),
        rewritten: BTreeMap::new(),
        saves: Vec::new(),
        from: 0,
        records: Vec::new(),
    };
    let piece = match deep_play::logic::logic_piece(sealed, form, track, read, false) {
        Ok(Some(p)) => Rc::new(p),
        Ok(None) => return Ok(none),
        Err(i) => return Err(refusal(format!("{}: {}", i.code, i.to_json()))),
    };
    let entries: Vec<Entry> = track.iter().filter_map(Entry::parse).collect();
    let len = piece.items.first().map_or(FLICKS / 60, |i| i.step).max(1);
    steps.extend(piece.items.iter().map(|i| i.step));
    let count = (span + len - 1) / len;
    let mut rec = Record::default();
    let (mut world, from) = match opened {
        Some((name, bytes)) => {
            let (world, via) = saves::open_held(&piece, name, bytes, &entries, "", &mut rec)
                .map_err(|e| e.to_string())?;
            (world, via["step"].as_i64().unwrap_or(0))
        }
        None => {
            let mut world = World::new(
                piece.clone(),
                track_of(&entries),
                false,
                Default::default(),
                &mut rec,
                None,
            )
            .map_err(|e| refusal(format!("the logic items don't start: {e}")))?;
            world.held = Some(Vec::new());
            (world, 0)
        }
    };
    world.run(count, &mut rec, &mut |_, _| {});
    let mut out: BTreeMap<String, Run1> = BTreeMap::new();
    for item in &piece.items {
        let hashes = (0..count)
            .map(|k| {
                rec.rows()
                    .get(&k)
                    .and_then(|r| r.0.get(&item.id))
                    .and_then(|r| r.get("hash"))
                    .cloned()
                    .unwrap_or(Value::Null)
            })
            .collect();
        let checkpoints = rec
            .deep(&item.id)
            .into_iter()
            .map(|(step, hash)| Checkpoint { step, hash })
            .collect();
        out.insert(
            item.id.clone(),
            Run1 {
                steps: hashes,
                checkpoints,
            },
        );
    }
    let rewritten = piece
        .items
        .iter()
        .map(|i| (i.id.clone(), sha256_hex(&i.bytes)))
        .collect();
    Ok(Logic {
        runs: out,
        rewritten,
        records: deep_logic::carry::written(&mut world),
        saves: world.held.take().unwrap_or_default(),
        from,
    })
}

/// Lower-case hex SHA-256.
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

// The logic module's sets (#1490: game2d and full) run the logic item this test plays.
#[cfg(all(test, feature = "game2d"))]
mod tests {
    use super::*;

    /// crates/deep-logic/src/fixture.wat, as deep-show's logic_canvas test holds it: writes
    /// `steps` (the steps run) at 0 and `presses` (the sum of each step's entry counts) at 8.
    const COUNTER: &str = "0061736d0100000001050160017e0003030200000504010101010617047f004180080b7f004180100b7f0141000b7f0141000b072f05066d656d6f727902000872656164735f61740300097772697465735f6174030104696e69740000047374657000010a290202000b2400230241016a240223034180082802006a2403418010230236020041881023033602000b0028046e616d65020e020001000473656564010100016b07110202057374657073030770726573736573";
    const MS: i64 = FLICKS / 1000;

    fn press(ms: i64) -> Value {
        json!({"t": ms * MS, "seq": 0, "control": "press", "value": 1, "writer": "you", "player": 1})
    }

    /// #860: back on a piece that declares rewind returns to the stop before, so the piece plays
    /// on from there as a fresh play of the current branch does, by full-state hash.
    #[test]
    fn back_on_a_piece_that_declares_rewind_plays_on_as_the_current_branch() {
        let sealed: &'static Sealed =
            Box::leak(Box::new(crate::seal::sealed().expect("the sealed set")));
        let bytes: Vec<u8> = (0..COUNTER.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&COUNTER[i..i + 2], 16).expect("hex"))
            .collect();
        let sha = sha256_hex(&bytes);
        let read = |s: &str| (s == sha).then(|| bytes.clone());
        let bundled: Vec<&str> = deep_text::FACES.iter().map(|f| f.file).collect();
        let clean = deep_canvas_marks::look::shipped("clean").expect("the clean look");
        let look = deep_canvas_marks::look::resolve(&clean, &bundled).expect("it resolves");
        let doc = json!({"format": 1, "profile": "board", "seed": 860, "title": "Back",
            "description": "A counter whose presses a viewer can rewind.", "size": [64, 36],
            "transport": {"span": "2s", "frame_rate": [60, 1]},
            "controls": {"press": {"kind": "press", "class": "document", "label": "Press", "role": "button"}},
            "items": {"counter": {"id": "counter", "kind": "logic@1", "name": "Counter", "order": "a1", "params": {
                "program": sha, "step_rate": 60, "clock": "on_input", "reads": ["press"],
                "writes": {"steps": {"type": "i32"}, "presses": {"type": "i32"}}}}},
            "rewind": {"stops": "counter.steps", "depth": 8}});
        // Three presses, back at 0.8 s and a press at 1 s: the third press is left on a closed
        // branch, and the current branch is the first two and the one after back.
        let first = [press(200), press(400), press(600)];
        let mut rewound = Played::new(sealed, &doc, &first, &read, look.clone()).expect("plays");
        rewound.frame(800 * MS);
        assert!(
            rewound.back(sealed, &read).expect("back"),
            "the piece declares rewind"
        );
        rewound.frame(1000 * MS);
        rewound
            .enter(sealed, "press", json!(1), &read)
            .expect("the press");
        // A turn clock hashes only the steps it runs: the probe one step on reads the hash of the
        // step at 1 s, the press's.
        let after = 61 * (FLICKS / 60);
        rewound.frame(after);
        let current = [press(200), press(400), press(1000)];
        let mut fresh = Played::new(sealed, &doc, &current, &read, look).expect("plays");
        fresh.frame(after);
        let (a, b) = (rewound.probe(), fresh.probe());
        assert!(
            a["step_hash"]["counter"].is_string(),
            "the hash of the press's step: {a:?}"
        );
        assert_eq!(
            (&a["step"], &a["step_hash"]["counter"]),
            (&b["step"], &b["step_hash"]["counter"]),
            "after back the piece plays on as a fresh play of the current branch"
        );
    }
}
