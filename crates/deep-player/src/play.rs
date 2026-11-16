//! A bundle's piece played (#172): its document on its recorded input track as the app plays it,
//! the form made by the app's own calls ([`deep_play::form::played`]), evaluated by the core's
//! scheduler with the player's sealed modules. Each world's bake and each logic item's replay are
//! the app's (`physics_bake`, the `logic` call), so `probe()` reads the step hashes and full-state
//! hashes the app reads; evaluated data is read as the app's `eval` reads it.

use std::collections::BTreeMap;
use std::rc::Rc;

use deep_canvas::registry::Sealed;
use deep_canvas::schedule::{Options, Scheduler, Session};
use deep_canvas_physics::caps::RAPIER3D;
use deep_canvas_physics::check::check;
use deep_canvas_physics::occurrence::step_flicks;
use deep_logic::world::{track_of, Entry, Record, World};
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
type Runs = BTreeMap<String, Run1>;

/// A played piece.
pub struct Played {
    sched: Scheduler<'static>,
    session: Session,
    doc: Value,
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
        let mut steps: Vec<i64> = Vec::new();
        let worlds = worlds(&form, track, span, &mut steps)?;
        let (logic, rewritten) = logic(sealed, &form, track, read, span, &mut steps)?;
        let step = steps.into_iter().min().unwrap_or(FLICKS / 60).max(1);
        let mut sched = Scheduler::new(sealed, Options::default());
        let mut session = Session::new(0, tokens);
        session.load(&mut sched, &form);
        Ok(Played {
            sched,
            session,
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
        let t = self.t();
        let seq = self
            .track
            .iter()
            .filter(|e| e["t"].as_i64() == Some(t))
            .count();
        let mut track = self.track.clone();
        track.push(json!({"t": t, "seq": seq, "control": control, "value": value, "writer": "you", "player": 1}));
        track.sort_by_key(|e| (e["t"].as_i64().unwrap_or(0), e["seq"].as_i64().unwrap_or(0)));
        let mut again = Played::new(sealed, &self.source, &track, read, self.look.clone())?;
        again.frame(t);
        *self = again;
        Ok(())
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

    /// The logic items' arrays, `<logic ID>.<name>`.
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
        let kept = deep_play::derive::kept(&w, track, &[], false)
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
/// it, with its checkpoints; each item's step added to `steps`.
fn logic(
    sealed: &Sealed,
    form: &Value,
    track: &[Value],
    read: &dyn Fn(&str) -> Option<Vec<u8>>,
    span: i64,
    steps: &mut Vec<i64>,
) -> Result<(Runs, BTreeMap<String, String>), String> {
    let piece = match deep_play::logic::logic_piece(sealed, form, track, read, false) {
        Ok(Some(p)) => Rc::new(p),
        Ok(None) => return Ok(Default::default()),
        Err(i) => return Err(refusal(format!("{}: {}", i.code, i.to_json()))),
    };
    let entries: Vec<Entry> = track.iter().filter_map(Entry::parse).collect();
    let len = piece.items.first().map_or(FLICKS / 60, |i| i.step).max(1);
    steps.extend(piece.items.iter().map(|i| i.step));
    let count = (span + len - 1) / len;
    let mut rec = Record::default();
    let mut world = World::new(
        piece.clone(),
        track_of(&entries),
        false,
        Default::default(),
        &mut rec,
        None,
    )
    .map_err(|e| refusal(format!("the logic items don't start: {e}")))?;
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
    Ok((out, rewritten))
}

/// Lower-case hex SHA-256.
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
