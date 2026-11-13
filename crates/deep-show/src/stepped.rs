//! Issue #525: each world of a media document played live under the test audio backend, stepped
//! ahead of the audio blocks (Phase: "while sound plays, every canvas module with steps runs until
//! its time is at least one audio block past the timeline position of the first sample not yet
//! written, before that block renders; a step not ready in time counts an underrun … and never
//! moves a voice"). Its occurrence list grows as it steps, and each spawn's voices are planned
//! from it by the planner `media_mix` uses, so each starts on its own sample. A press is an entry
//! on the play's input track, which derives the world's inputs and starts each `start_on` strip,
//! as a replay of that track does. A media document's recipe instances write their strips here.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::Arc;

use deep_canvas_media::mix::{Source, Strip};
use deep_physics_rapier::runner::{Live, Run};
use serde_json::{json, Map, Value};

/// #525's wrong programs of a live play, by the names its acceptance suite gives them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Planted {
    /// A voice starts at the t of the first display frame at or after its occurrence's flick.
    VoiceAtFrame,
    /// A live world steps at each display frame up to the frame's t, not ahead of the blocks.
    WorldStepsOnFrames,
    /// A block whose step isn't ready renders without it, and the step's voices start at the
    /// first block rendered once it is ready.
    LateStepMovesVoice,
    /// An entry takes the t of the first display frame at or after its arrival.
    EntryStampedAtFrame,
}

pub(crate) fn planted(name: &str) -> Option<crate::hub::Planted> {
    Some(crate::hub::Planted::Ahead(match name {
        "voice_at_frame" => Planted::VoiceAtFrame,
        "world_steps_on_frames" => Planted::WorldStepsOnFrames,
        "late_step_moves_voice" => Planted::LateStepMovesVoice,
        "entry_stamped_at_frame" => Planted::EntryStampedAtFrame,
        _ => return None,
    }))
}

/// A step of a live world that takes `by` flicks of host time, on purpose (the scenario's
/// `delays`); every other step takes none on the virtual clock.
#[derive(Clone, Debug)]
pub struct Delay {
    world: String,
    step: u64,
    by: i64,
}

pub fn delays(v: Option<&Value>) -> Option<Vec<Delay>> {
    let Some(v) = v else { return Some(Vec::new()) };
    let one = |d: &Value| {
        Some(Delay {
            world: d.get("world")?.as_str()?.into(),
            step: d.get("step")?.as_u64()?,
            by: d.get("by")?.as_i64().filter(|b| *b >= 0)?,
        })
    };
    v.as_array()?.iter().map(one).collect()
}

/// One live world: its stepper, the step its span ends at and its rows so far.
struct World {
    id: String,
    live: Live,
    last: u64,
    rows: Vec<Value>,
}

/// A live play's worlds, the media document their lists feed and the strips it adds to the mix.
pub struct Worlds {
    worlds: Vec<World>,
    /// The document as opened, each world's list empty: what the spawns and runs are planned on.
    doc: Value,
    master: usize,
    planted: Option<String>,
    sources: BTreeMap<String, Arc<Source>>,
    delays: Vec<Delay>,
    /// The delayed step in progress (world, step, the host time it is ready), and those done.
    pending: Option<(usize, u64, i64)>,
    done: Vec<(usize, u64)>,
    /// Each row's flick as planned, once seen: a planted program may move it.
    planned: BTreeMap<(usize, usize), i64>,
    /// The play's recorded input track.
    pub track: Vec<Value>,
    runs: Vec<Strip>,
    dirty: bool,
}

impl Worlds {
    /// The live worlds of `doc` (opened: lists empty), or none when it lists no world.
    pub fn new(
        doc: &Value,
        sources: BTreeMap<String, Arc<Source>>,
        master: usize,
        planted: Option<String>,
        delays: Vec<Delay>,
    ) -> Result<Option<Worlds>, Value> {
        let Some(listed) = doc
            .get("worlds")
            .and_then(Value::as_object)
            .filter(|w| !w.is_empty())
        else {
            return Ok(None);
        };
        let run = Run::new(None).expect("the unplanted runner");
        let span = deep_canvas_media::doc::time(doc, doc.pointer("/transport/span"))
            .unwrap_or(0)
            .max(0);
        let mut worlds = Vec::new();
        for (id, w) in listed {
            let live = run
                .live(&json!({"scene": doc, "world": id}))
                .map_err(|e| json!({"code": "physics_refused", "world": id, "what": e}))?;
            let h = live.step_flicks();
            let own = span_of(doc, w, span);
            worlds.push(World {
                id: id.clone(),
                live,
                last: ((own + h - 1) / h) as u64,
                rows: Vec::new(),
            });
        }
        let doc = doc.clone();
        Ok(Some(Worlds {
            worlds,
            doc,
            master,
            planted,
            sources,
            delays,
            pending: None,
            done: Vec::new(),
            planned: BTreeMap::new(),
            track: Vec::new(),
            runs: Vec::new(),
            dirty: false,
        }))
    }

    /// Each world's time: its steps run times its step.
    pub fn times(&self) -> Vec<i64> {
        self.worlds
            .iter()
            .map(|w| w.live.steps as i64 * w.live.step_flicks())
            .collect()
    }

    pub fn ids(&self) -> impl Iterator<Item = &str> {
        self.worlds.iter().map(|w| w.id.as_str())
    }

    /// The first step not yet run, as a time: the latest of the worlds'.
    pub fn next_step(&self) -> i64 {
        self.times().into_iter().max().unwrap_or(0)
    }

    /// Steps every world until its time is at least `t` or its span ends, at host time `host`;
    /// false while a delayed step isn't ready, which leaves the steps after it to run.
    pub fn step_to(&mut self, t: i64, host: i64) -> bool {
        for i in 0..self.worlds.len() {
            let h = self.worlds[i].live.step_flicks();
            while self.worlds[i].live.steps < self.worlds[i].last
                && self.worlds[i].live.steps as i64 * h < t
            {
                let k = self.worlds[i].live.steps + 1;
                let delay = self
                    .delays
                    .iter()
                    .find(|d| d.world == self.worlds[i].id && d.step == k)
                    .map(|d| d.by);
                if let Some(by) = delay.filter(|_| !self.done.contains(&(i, k))) {
                    let ready = self.pending.map_or(host + by, |p| p.2);
                    if host < ready {
                        self.pending = Some((i, k, ready));
                        return false;
                    }
                    self.pending = None;
                    self.done.push((i, k));
                }
                // A step the backend refuses (an input it can't run) stops the world there.
                let Ok(rows) = self.worlds[i].live.step() else {
                    break;
                };
                self.dirty |= !rows.is_empty();
                self.worlds[i].rows.extend(rows);
            }
        }
        true
    }

    /// Each world's list as stepped: `<world ID>.occurrences`.
    pub fn lists(&self) -> Map<String, Value> {
        self.worlds
            .iter()
            .map(|w| (format!("{}.occurrences", w.id), json!(w.rows)))
            .collect()
    }

    /// The document with the play's input track, as a replay renders it.
    pub fn played(&self) -> Value {
        let mut d = self.doc.clone();
        d["track"] = json!(self.track);
        d
    }

    /// The runs the track starts, and the world inputs it derives for the steps not yet run.
    pub fn set_runs(&mut self, runs: Vec<Strip>) {
        for w in &mut self.worlds {
            w.live.track(&self.track);
        }
        self.runs = runs;
        self.dirty = true;
    }

    /// When a list grew or a run was added: the strips the play adds to its mix, the runs then
    /// the spawns' voices planned from the lists as stepped, `moved` placing a row a planted
    /// program moves when it is first planned.
    pub fn added(&mut self, moved: impl Fn(i64) -> Option<i64>) -> Option<Vec<Strip>> {
        if !std::mem::take(&mut self.dirty) {
            return None;
        }
        let mut d = self.doc.clone();
        for (i, w) in self.worlds.iter().enumerate() {
            let rows: Vec<Value> = w
                .rows
                .iter()
                .enumerate()
                .map(|(r, row)| {
                    let t = row["t"].as_i64().unwrap_or(0);
                    let mut row = row.clone();
                    row["t"] = json!(*self
                        .planned
                        .entry((i, r))
                        .or_insert_with(|| moved(t).unwrap_or(t)));
                    row
                })
                .collect();
            d["occurrences"][format!("{}.occurrences", w.id)] = json!(rows);
        }
        let sources = &self.sources;
        let mut source = |sha: &str| {
            sources
                .get(sha)
                .cloned()
                .ok_or_else(|| json!({"code": "unknown_asset", "asset": sha}))
        };
        let voices = crate::hub::Hub::voices(&d, self.master, self.planted.as_deref(), &mut source)
            .map_or_else(|_| Vec::new(), |v| v.0);
        Some(self.runs.iter().chain(&voices).cloned().collect())
    }
}

/// A world's span: its own, within the transport's (World: `span`).
fn span_of(doc: &Value, world: &Value, transport: i64) -> i64 {
    world
        .get("span")
        .and_then(|s| deep_canvas_media::doc::time(doc, Some(s)))
        .map_or(transport, |s| s.min(transport))
}

/// The steps a world of `form` bakes over: its span's, within the transport's.
pub(crate) fn steps_of(form: &Value, world: &Value, transport: i64, step: i64) -> i64 {
    (span_of(form, world, transport) + step - 1) / step
}

/// The runs of a `start_on: {control, each}` strip (Placement's input rule, on a strip): each
/// matching entry of the document's input track starts one at its flick, the strip's `start` an
/// offset from it.
pub(crate) fn runs(d: &Value, strip: &Strip, on: &Value) -> Vec<Strip> {
    let control = on.get("control");
    let change = on.get("each").and_then(Value::as_str) == Some("change");
    let mut last: Option<&Value> = None;
    let mut out = Vec::new();
    for e in d
        .get("track")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter(|e| e.get("control") == control)
    {
        let changed = last.is_none_or(|l| l.get("value") != e.get("value"));
        last = Some(e);
        let Some(t) = e
            .get("t")
            .and_then(Value::as_i64)
            .filter(|_| changed || !change)
        else {
            continue;
        };
        let mut run = strip.clone();
        run.id = format!("{}#{}", strip.id, out.len());
        run.start = strip.start + t;
        out.push(run);
    }
    out
}

/// A recipe step's value with each bare name of an input read as that input's value (Recipe:
/// `params: {k → literal | expression}`).
fn bound(v: &Value, inputs: &Map<String, Value>) -> Value {
    match v {
        Value::String(s) => inputs.get(s).cloned().unwrap_or_else(|| v.clone()),
        Value::Array(a) => Value::Array(a.iter().map(|x| bound(x, inputs)).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, x)| (k.clone(), bound(x, inputs)))
                .collect(),
        ),
        _ => v.clone(),
    }
}

/// Each recipe instance of a media document's `items` expanded at open, as a film recipe's
/// steps write strips (Recipe): its `strip` steps become the strips `<instance>.<step>`, read
/// from the pack the document lists and the scenario offers.
pub(crate) fn expand(d: &mut Value, offered: &[(String, PathBuf)]) -> Result<(), Value> {
    let listed: Vec<String> = d
        .get("packs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|p| p.as_str().map(str::to_string))
        .collect();
    let items = d
        .get("items")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    for (iid, item) in items {
        let kind = item.get("kind").and_then(Value::as_str).unwrap_or_default();
        let recipe = listed.iter().find_map(|p| {
            let (id, version) = p.split_once('@')?;
            let (_, dir) = offered.iter().find(|(o, _)| o == id)?;
            let manifest = crate::packs::load(id, dir).ok()?;
            (manifest.get("version")?.as_str()? == version)
                .then(|| manifest.get("recipes")?.get(kind).cloned())?
        });
        let Some(recipe) = recipe else {
            return Err(
                json!({"code": "recipe_unresolved", "item": iid, "kind": kind, "packs": listed}),
            );
        };
        let mut inputs = Map::new();
        for (name, decl) in recipe
            .get("inputs")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if let Some(v) = item
                .pointer(&format!("/params/{name}"))
                .or_else(|| decl.get("default"))
            {
                inputs.insert(name.clone(), v.clone());
            }
        }
        for (sid, step) in recipe
            .get("steps")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            if step.get("op").and_then(Value::as_str) != Some("strip") {
                return Err(
                    json!({"code": "bad_media", "what": format!("item {iid}: step {sid} of {kind} isn't a strip, the step a media document expands")}),
                );
            }
            d["strips"][format!("{iid}.{sid}")] = bound(&step["params"], &inputs);
        }
    }
    Ok(())
}

/// A media document as a panel opens it to play live: its recipes expanded, and each world's list
/// empty, since the play's own steps fill it.
pub(crate) fn opened(m: &Value, offered: &[(String, PathBuf)]) -> Result<Value, Value> {
    let mut d = m.clone();
    expand(&mut d, offered)?;
    let ids: Vec<String> = d
        .get("worlds")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(id, _)| id.clone())
        .collect();
    for id in ids {
        d["occurrences"][format!("{id}.occurrences")] = json!([]);
    }
    Ok(d)
}
