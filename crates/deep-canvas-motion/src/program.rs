//! A document compiled once per revision into flat, typed arrays (canvas primitives: Array and
//! table; Operator and read set): every item's transform and every field a channel writes is a
//! run of `f64` slots, each channel and placement write resolves at compile time to a slot, and a
//! frame evaluates into a [`State`] the program sized up front. After the first frame, evaluating
//! allocates nothing: no map, string or vector is made per frame.

use serde_json::{Map, Value};

use deep_canvas::schedule::core_ops::Datum;

use crate::doc::{self, Feel, Motion, Refused, Target};
use crate::eval::{Local, Validity};
use crate::input::{Entry, Inputs};

/// Slots each item's transform takes: pos, rot and scale, three each.
pub const TRANSFORM: usize = 9;

/// One item's evaluated transform (pos, rot and scale) and the fields a channel writes on it,
/// each with its path in the item.
pub type ItemValues = ([f64; TRANSFORM], Vec<(Vec<String>, Datum)>);

/// A field outside the transform that a channel writes, with its run of slots.
#[derive(Clone, Debug, PartialEq)]
pub struct Field {
    /// The item, or `None` for a target naming no item, whose slots nothing reads.
    pub item: Option<usize>,
    pub path: Vec<String>,
    pub slot: usize,
    pub width: usize,
    /// A bool channel's field, written as `true` or `false`.
    pub boolean: bool,
    /// An enum channel's field, written as its label in the motion's labels.
    pub enumerated: bool,
    /// Something writes it; a field only a driver reads is never written back.
    pub written: bool,
}

/// One step of a driver's compiled expression, over the program's slots.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Op {
    Num(f64),
    Var(usize),
    /// Item `.0`'s world pose component `.1` (pos, rot, scale, three each), after every write
    /// to that item and its parents.
    World(usize, usize),
    Neg,
    /// `+ - * / %` as its byte.
    Bin(u8),
    /// A function of the closed list (`min max floor ceil round abs` as 0 to 5), with its
    /// argument count.
    Call(u8, usize),
}

/// A driver's ops at most (Driver: "≤ 64 ops"), and so its stack's depth.
pub const DRIVER_OPS: usize = 64;

/// What a traced evaluation saw write one slot: the document entry, its value after the write,
/// and each document path it read on the way, nearest first, with its value.
#[derive(Clone, Debug, PartialEq)]
pub struct Traced {
    pub entry: String,
    /// Motion's operator that ran it.
    pub operator: &'static str,
    pub value: f64,
    pub limit: bool,
    pub reads: Vec<(String, f64)>,
}

/// One write the evaluation made, as [`Program::run`] reports it to a tracer.
enum Event {
    Channel(usize),
    Follow(usize),
    /// A placement's write, with the slots it wrote.
    Placement(usize, std::ops::Range<usize>),
    Driver(usize),
    Limit(usize, usize),
}

/// One node of the compiled order (crate::schedule): what runs, in the order it runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Step {
    Channel(usize),
    /// Placement `p`'s write `w`.
    Write(usize, usize),
    Driver(usize),
    Limit(usize),
    Constraint(usize),
}

/// A constraint compiled to its items' transform slots: each item's first slot.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Compiled {
    pub(crate) owner: usize,
    /// The item it reads (a target, a parent, a tip's item), when it reads one: its world
    /// pose, or one transform group as its channels and drivers write it.
    pub(crate) other: Option<(usize, Option<usize>)>,
    /// reach2's lower bone and end, after the owner (its upper bone).
    pub(crate) chain: [usize; 2],
    pub(crate) table: Option<crate::constraint::ArcTable>,
}

/// A placement's write: one clip channel into one bound item's slots, after its target's delay.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Write {
    pub(crate) channel: usize,
    pub(crate) delay: i64,
    pub(crate) slot: usize,
    pub(crate) width: usize,
}

/// The planted wrong programs the #489 acceptance tests must fail, reachable only through
/// `deep-motion eval`'s `planted` field.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Planted {
    #[default]
    None,
    /// A follow channel that steps from the previous frame's value, not its closed form.
    FollowStepsFromPreviousFrame,
    /// A scheduler that orders whole items, not components.
    SchedulesWholeItems,
    /// A spring key that ignores its velocity.
    SpringDropsVelocity,
    /// A `per_loop` whose period is rounded to a whole flick first.
    PerLoopRoundsPeriod,
    /// A transition that restarts from its old target, not from where the value is.
    TransitionRestarts,
}

/// What an evaluation takes besides the document: the input track's entries, the viewer's
/// reduced-motion preference, and a planted program.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Options {
    pub input: Vec<Entry>,
    pub reduced_motion: bool,
    pub planted: Planted,
    /// Times are timeline positions as given: the loop isn't applied.
    pub unwrap: bool,
}

/// The input track's hash: SHA-256 over each entry's time, seq, control and value.
pub fn track_hash(entries: &[Entry]) -> String {
    let mut bytes = Vec::new();
    for e in entries {
        let value = e.value.to_string();
        bytes.extend(e.t.to_le_bytes());
        bytes.extend(e.seq.to_le_bytes());
        for text in [&e.control, &value] {
            bytes.extend((text.len() as u64).to_le_bytes());
            bytes.extend(text.as_bytes());
        }
    }
    deep_canvas::canon::sha256_hex(&bytes)
}

/// The compiled document.
#[derive(Clone, Debug, PartialEq)]
pub struct Program {
    pub motion: Motion,
    /// Item IDs in document order; item `i`'s transform is slots `9i..9i + 9`.
    pub items: Vec<String>,
    pub fields: Vec<Field>,
    pub(crate) base: Vec<f64>,
    /// Each document channel's slot and width, in channel order.
    pub(crate) channels: Vec<(usize, usize)>,
    /// Each channel's run in [`State::values`], and the runs' total length.
    pub(crate) values: Vec<usize>,
    pub(crate) values_len: usize,
    /// Each follow channel's slot, in follow order; its value sits after the channels' runs in
    /// [`State::values`].
    pub(crate) follows: Vec<usize>,
    /// What the input track moves (#417): with no track, each control's default.
    pub(crate) inputs: Inputs,
    pub(crate) placements: Vec<Vec<Write>>,
    pub(crate) parents: Vec<(usize, usize)>,
    /// Each driver's target slot and compiled expression, in driver order.
    pub(crate) drivers: Vec<(usize, Vec<Op>)>,
    /// Each limit's first slot (its transform group's) and per-axis bounds, in constraint order.
    pub(crate) limits: Vec<(usize, doc::Bounds)>,
    /// Each constraint but `limit`, in constraint order.
    pub(crate) constraints: Vec<Compiled>,
    /// Every write in the order one evaluation runs them, per component.
    pub(crate) order: Vec<Step>,
    /// The order as `<item>.<stage>` steps, each once, as the evaluation first reaches it.
    pub order_names: Vec<String>,
    /// Each channel's #489 follow segments, built once per document and input track.
    pub channel_follows: Vec<Option<crate::follow::Follow>>,
    pub options: Options,
}

/// What one evaluation fills, sized by [`Program::state`] and reused frame after frame.
#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub t: i64,
    pub doc_t: i64,
    pub pass: i64,
    pub slots: Vec<f64>,
    /// Each document channel's value, before it is stored in its target.
    pub values: Vec<f64>,
    pub iterations: Vec<u32>,
    pub locals: Vec<Option<Local>>,
    /// Each camera's target, in [`Motion::cameras`] order.
    pub cameras: Vec<[f64; 3]>,
    pub valid_until: Option<i64>,
    /// Each follow channel's value, rate and integral.
    pub follow: Vec<crate::follow::Out>,
    /// Each limit's, then each other constraint's, op count and stretch (NaN but for reach2).
    pub reports: Vec<(u64, f64)>,
    /// The planted follow stepper's last frame: its time and state, per channel.
    pub(crate) last: Vec<Option<(i64, crate::follow::Out)>>,
}

fn number(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|n| n.is_finite())
}

/// The authored value at `path` inside `item`, `width` components wide.
fn authored(item: &Value, path: &[impl AsRef<str>], width: usize, out: &mut [f64]) {
    let mut at = Some(item);
    for name in path {
        let name = name.as_ref();
        at = at.and_then(|v| match v {
            Value::Array(list) => name.parse::<usize>().ok().and_then(|i| list.get(i)),
            other => other.get(name),
        });
    }
    match at {
        Some(Value::Array(list)) => {
            for (o, v) in out.iter_mut().zip(list).take(width) {
                *o = number(Some(v)).unwrap_or(0.0);
            }
        }
        Some(Value::Bool(b)) => out[0] = if *b { 1.0 } else { 0.0 },
        v => {
            if let Some(n) = number(v) {
                out[0] = n;
            }
        }
    }
}

impl Program {
    /// Compiles `doc`: reads its motion, then gives every target its slots.
    pub fn compile(doc: &Map<String, Value>) -> Result<Program, Refused> {
        Program::compile_with(doc, Options::default())
    }

    /// [`Program::compile`] with the input track, the view and a planted program.
    pub fn compile_with(doc: &Map<String, Value>, options: Options) -> Result<Program, Refused> {
        let mut motion = doc::read(doc)?;
        if options.planted == Planted::SpringDropsVelocity {
            for c in &mut motion.channels {
                c.curve.keys.iter_mut().for_each(|k| k.velocity.clear());
            }
        }
        if options.planted == Planted::PerLoopRoundsPeriod {
            for c in &mut motion.channels {
                for m in &mut c.modifiers {
                    m.round_period();
                }
            }
        }
        for c in &motion.channels {
            range_check(c)?;
        }
        let empty = Map::new();
        let items_json = doc
            .get("items")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        let items: Vec<String> = items_json.keys().cloned().collect();
        let mut base = vec![0.0; items.len() * TRANSFORM];
        for (i, item) in items_json.values().enumerate() {
            let at = item.get("at");
            for (k, (name, fill)) in [("pos", 0.0), ("rot", 0.0), ("scale", 1.0)]
                .iter()
                .enumerate()
            {
                let run = &mut base[i * TRANSFORM + 3 * k..i * TRANSFORM + 3 * k + 3];
                run.fill(*fill);
                if let Some(at) = at {
                    authored(at, &[name], 3, run);
                }
            }
        }
        let mut program = Program {
            items,
            fields: Vec::new(),
            base,
            channels: Vec::new(),
            values: Vec::new(),
            values_len: 0,
            follows: Vec::new(),
            inputs: Inputs::new(&motion, Feel::default(), &[]).unwrap_or_default(),
            placements: Vec::new(),
            parents: Vec::new(),
            drivers: Vec::new(),
            limits: Vec::new(),
            constraints: Vec::new(),
            order: Vec::new(),
            order_names: Vec::new(),
            channel_follows: Vec::new(),
            options,
            motion: motion.clone(),
        };
        let mut values = 0;
        for channel in &motion.channels {
            let width = channel.curve.keys.first().map_or(1, |k| k.value.len());
            let slot = program.slot(items_json, &channel.target.owner, &channel.target, width);
            program.mark_type(slot, channel.ty);
            program.mark_written(slot);
            program.channels.push((slot, width));
            program.values.push(values);
            values += width;
        }
        program.values_len = values;
        for follow in &motion.follows {
            let slot = program.slot(items_json, &follow.target.owner, &follow.target, 1);
            program.mark_written(slot);
            program.follows.push(slot);
        }
        for placement in &motion.placements {
            let mut writes = Vec::new();
            if let Some(clip) = motion.clip(&placement.clip) {
                for binding in &placement.bindings {
                    for (c, channel) in clip.channels.iter().enumerate() {
                        if channel.target.owner != binding.slot {
                            continue;
                        }
                        let width = channel.curve.keys.first().map_or(1, |k| k.value.len());
                        let slot = program.slot(items_json, &binding.item, &channel.target, width);
                        program.mark_type(slot, channel.ty);
                        program.mark_written(slot);
                        writes.push(Write {
                            channel: c,
                            delay: binding.delay,
                            slot,
                            width,
                        });
                    }
                }
            }
            program.placements.push(writes);
        }
        for driver in &motion.drivers {
            let path = format!("drivers/{}", driver.id);
            let mut vars = Vec::new();
            for (name, target) in &driver.vars {
                let var = match program.world_read(&target.owner, &target.field) {
                    Some(world) => Var::World(world.0, world.1),
                    None => Var::Slot(program.slot(items_json, &target.owner, target, 1)),
                };
                vars.push((name.as_str(), var));
            }
            let slot = program.slot(items_json, &driver.target.owner, &driver.target, 1);
            program.mark_written(slot);
            let ops = compile_ops(&driver.expr, &vars).ok_or_else(|| Refused {
                code: "bad_doc",
                path: format!("{path}/expr"),
            })?;
            program.drivers.push((slot, ops));
        }
        for limit in &motion.limits {
            let Some(i) = program.items.iter().position(|x| *x == limit.owner) else {
                return Err(Refused {
                    code: "ref_unresolved",
                    path: format!("constraints/{}/owner", limit.id),
                });
            };
            let group = ["pos", "rot", "scale"]
                .iter()
                .position(|g| *g == limit.group)
                .unwrap_or(0);
            program
                .limits
                .push((i * TRANSFORM + 3 * group, limit.bounds));
        }
        let index_of = |items: &[String], id: &str, path: String| {
            items.iter().position(|x| x == id).ok_or(Refused {
                code: "ref_unresolved",
                path,
            })
        };
        for c in &motion.constraints {
            use doc::Kind;
            let path = format!("constraints/{}", c.id);
            let owner = index_of(&program.items, &c.owner, format!("{path}/owner"))?;
            // An item ID reads its evaluated world pose; `items/<id>/at/<group>` reads that
            // group as its channels and drivers write it.
            let read = |x: &str, at: String| -> Result<(usize, Option<usize>), Refused> {
                let parts: Vec<&str> = x.split('/').collect();
                match parts.as_slice() {
                    ["items", id, "at", g] => {
                        let g = ["pos", "rot", "scale"].iter().position(|n| n == g).ok_or(Refused { code: "bad_path", path: at.clone() })?;
                        Ok((index_of(&program.items, id, at)?, Some(g)))
                    }
                    [id] => Ok((index_of(&program.items, id, at)?, None)),
                    _ => Err(Refused { code: "bad_path", path: at }),
                }
            };
            let other = match &c.kind {
                Kind::ChildOf { parent: x }
                | Kind::LookAt { target: x }
                | Kind::Copy { target: x, .. }
                | Kind::Distance { target: x, .. }
                | Kind::Reach2 { target: x, .. } => Some(read(x, format!("{path}/target"))?),
                Kind::FollowTip { item, .. } => Some(read(item, format!("{path}/item"))?),
                _ => None,
            };
            let chain = match &c.kind {
                Kind::Reach2 { chain, .. } => {
                    if chain[0] != c.owner {
                        return Err(Refused { code: "bad_doc", path: format!("{path}/chain") });
                    }
                    [
                        index_of(&program.items, &chain[1], format!("{path}/chain/1"))?,
                        index_of(&program.items, &chain[2], format!("{path}/chain/2"))?,
                    ]
                }
                _ => [owner; 2],
            };
            let table = match &c.kind {
                Kind::FollowPath { points, .. } => Some(crate::constraint::ArcTable::new(points.clone())),
                _ => None,
            };
            program.constraints.push(Compiled { owner, other, chain, table });
        }
        let mut at = std::collections::BTreeMap::new();
        for (i, id) in program.items.iter().enumerate() {
            at.entry(id.as_str()).or_insert(i);
        }
        let index = |id: &str| at.get(id).copied();
        program.parents = motion
            .parents
            .iter()
            .filter_map(|(child, parent)| Some((index(child)?, index(parent)?)))
            .collect();
        program.schedule(program.options.planted == Planted::SchedulesWholeItems)?;
        program.channel_follows = program.build_follows();
        Ok(program)
    }

    /// `items/<id>/world/<group>/<k>`: the item and the component of its world pose.
    fn world_read(&self, owner: &str, field: &[String]) -> Option<(usize, usize)> {
        let [w, g, k] = field else { return None };
        if w != "world" {
            return None;
        }
        let g = ["pos", "rot", "scale"].iter().position(|n| n == g)?;
        let k = k.parse::<usize>().ok().filter(|k| *k < 3)?;
        Some((self.items.iter().position(|x| x == owner)?, 3 * g + k))
    }

    /// Each follow channel's segments, over its source's changes: a keyed source's keys, or
    /// a control's default and then its entries on the input track, in time and seq order.
    fn build_follows(&self) -> Vec<Option<crate::follow::Follow>> {
        use crate::follow::{Follow, Model, Source};
        let reduced = self.options.reduced_motion && self.motion.transport.reduce_holds;
        self.motion
            .channels
            .iter()
            .map(|c| {
                let spec = c.follow.as_ref()?;
                let (initial, changes): (f64, Vec<(i64, f64)>) = match &spec.source {
                    Source::Keys(keys) => (keys[0].1, keys[1..].to_vec()),
                    Source::Control(id) => {
                        let default = self.motion.control_defaults.iter().find(|(c, _)| c == id).map_or(0.0, |c| c.1);
                        let mut entries: Vec<&Entry> = self.options.input.iter().filter(|e| e.control == *id).collect();
                        entries.sort_by_key(|e| (e.t, e.seq));
                        let value = |e: &Entry| e.value.as_f64().or_else(|| e.value.as_bool().map(|b| f64::from(u8::from(b))));
                        (default, entries.iter().filter_map(|e| Some((e.t, value(e)?))).collect())
                    }
                };
                let mut model = spec.model;
                // Under reduced motion's hold, a transition on a position, scale or rotation
                // lands on its target at the change's flick; opacity and color play as written.
                let moves = matches!(c.target.field.first().map(String::as_str), Some("at"));
                if let (true, true, Model::Transition { along, .. }) = (reduced, moves, model) {
                    model = Model::Transition { span: 0, along };
                }
                let restart = self.options.planted == Planted::TransitionRestarts;
                Some(Follow::with(model, initial, &changes, restart))
            })
            .collect()
    }

    /// The program under a look's time feel and an input track (#417), or `None` for a track
    /// entry naming a control it doesn't read or a value outside the control's options.
    pub fn with_inputs(mut self, feel: Feel, track: &[Entry]) -> Option<Program> {
        self.inputs = Inputs::new(&self.motion, feel, track)?;
        Some(self)
    }

    /// Marks the field at `slot` as a bool or an enum channel's, so it is written as one.
    fn mark_type(&mut self, slot: usize, ty: doc::ValueType) {
        if let Some(f) = self.fields.iter_mut().find(|f| f.slot == slot) {
            f.boolean |= ty == doc::ValueType::Bool;
            f.enumerated |= ty == doc::ValueType::Enum;
        }
    }

    /// An enum field's label for the index a slot holds.
    pub fn label(&self, slot: f64) -> &str {
        self.motion
            .labels
            .get(slot.max(0.0) as usize)
            .map_or("", String::as_str)
    }

    /// Marks the field at `slot` as one something writes.
    fn mark_written(&mut self, slot: usize) {
        if let Some(f) = self.fields.iter_mut().find(|f| f.slot == slot) {
            f.written = true;
        }
    }

    /// The slots a target names in `owner`: its transform's, or a field's of its own, made once.
    /// A target in an item the document lacks writes to a slot no item reads.
    fn slot(
        &mut self,
        items: &Map<String, Value>,
        owner: &str,
        target: &Target,
        width: usize,
    ) -> usize {
        let item = self.items.iter().position(|i| i == owner);
        if let (Some(i), [at, name, k]) = (item, target.field.as_slice()) {
            let group = ["pos", "rot", "scale"].iter().position(|n| n == name);
            if let (true, Some(g), Ok(k)) = (at == "at", group, k.parse::<usize>()) {
                if k < 3 && width == 1 {
                    return i * TRANSFORM + 3 * g + k;
                }
            }
        }
        if let Some(f) = self
            .fields
            .iter()
            .find(|f| f.item == item && f.path == target.field)
        {
            return f.slot;
        }
        let slot = self.base.len();
        self.base.resize(slot + width, 0.0);
        if let Some(id) = item.map(|i| &self.items[i]) {
            authored(
                &items[id],
                &target.field,
                width,
                &mut self.base[slot..slot + width],
            );
        }
        self.fields.push(Field {
            item,
            path: target.field.clone(),
            slot,
            width,
            boolean: false,
            enumerated: false,
            written: false,
        });
        slot
    }

    /// A state sized for this program, the one allocation a session makes for its frames.
    pub fn state(&self) -> State {
        State {
            t: 0,
            doc_t: 0,
            pass: 0,
            slots: self.base.clone(),
            values: vec![0.0; self.values_len + self.follows.len()],
            iterations: vec![0; self.channels.len()],
            locals: vec![None; self.motion.placements.len()],
            cameras: vec![[0.0; 3]; self.motion.cameras.len()],
            valid_until: None,
            follow: vec![Default::default(); self.motion.channels.len()],
            reports: vec![(0, f64::NAN); self.limits.len() + self.constraints.len()],
            last: vec![None; self.motion.channels.len()],
        }
    }

    /// Evaluates the document at `t` into `state`, allocating nothing.
    pub fn evaluate(&self, t: i64, validity: Validity, state: &mut State) {
        self.evaluate_local(t, validity, state);
        for &(child, parent) in &self.parents {
            parent_to(&mut state.slots, child, parent);
        }
    }

    /// [`Program::evaluate`] without child-of parenting: each item's own transform, as the
    /// scheduler's motion operator writes it and the core composes it with its parent's.
    pub fn evaluate_local(&self, t: i64, validity: Validity, state: &mut State) {
        self.run(t, validity, state, |_, _, _| {});
    }

    /// [`Program::evaluate_local`], telling `note` of each write with the slots after it.
    fn run(
        &self,
        t: i64,
        validity: Validity,
        state: &mut State,
        mut note: impl FnMut(&Event, &[f64], &[f64]),
    ) {
        let motion = &self.motion;
        let (doc_t, pass) = if self.options.unwrap {
            (t, 0)
        } else {
            crate::eval::position(motion, t)
        };
        state.t = t;
        state.doc_t = doc_t;
        state.pass = pass;
        state.slots.copy_from_slice(&self.base);
        // #417's follows on the clock's t: the input track is the session's, not the timeline's.
        // They read nothing, so they write before every scheduled step.
        for (f, &slot) in self.follows.iter().enumerate() {
            let value = self.inputs.follows[f].at(t)[0];
            state.values[self.values_len + f] = value;
            state.slots[slot] = value;
            note(&Event::Follow(f), &[], &state.slots);
        }
        for (c, moves) in self.inputs.cameras.iter().enumerate() {
            state.cameras[c] = moves.at(t);
        }
        for (p, placement) in motion.placements.iter().enumerate() {
            state.locals[p] = placement.local(motion, doc_t);
        }
        let mut scratch = [0.0; 3];
        for step in &self.order {
            match *step {
                Step::Channel(c) => {
                    let channel = &motion.channels[c];
                    let (slot, width) = self.channels[c];
                    let run = &mut state.values[self.values[c]..self.values[c] + width];
                    if let Some(follow) = &self.channel_follows[c] {
                        let out = if self.options.planted == Planted::FollowStepsFromPreviousFrame {
                            follow.step_from(state.last[c], doc_t)
                        } else {
                            follow.at(doc_t)
                        };
                        state.last[c] = Some((doc_t, out));
                        state.follow[c] = out;
                        run[0] = out.value;
                    } else {
                        state.iterations[c] = channel.curve.sample_into(doc_t, run);
                    }
                    for m in &channel.modifiers {
                        run[0] = m.apply(run[0], doc_t - motion.transport.start);
                    }
                    state.slots[slot..slot + width].copy_from_slice(run);
                    note(&Event::Channel(c), &[], &state.slots);
                }
                Step::Write(p, w) => {
                    let placement = &motion.placements[p];
                    let Some(clip) = motion.clip(&placement.clip) else {
                        continue;
                    };
                    let w = &self.placements[p][w];
                    let Some(l) = placement.local_after(motion, doc_t, w.delay) else {
                        continue;
                    };
                    let run = &mut scratch[..w.width.min(3)];
                    clip.channels[w.channel].curve.sample_into(l.local, run);
                    state.slots[w.slot..w.slot + run.len()].copy_from_slice(run);
                    note(
                        &Event::Placement(p, w.slot..w.slot + run.len()),
                        &[],
                        &state.slots,
                    );
                }
                Step::Driver(d) => {
                    let (slot, ops) = &self.drivers[d];
                    let slots = &state.slots;
                    let value = evaluate_ops(ops, slots, |i, k| self.world(slots, i)[k]);
                    if value.is_finite() {
                        let before = [state.slots[*slot]];
                        state.slots[*slot] = value;
                        note(&Event::Driver(d), &before, &state.slots);
                    }
                }
                Step::Limit(l) => {
                    let (first, bounds) = &self.limits[l];
                    state.reports[l] = (6, f64::NAN);
                    for (k, b) in bounds.iter().enumerate() {
                        let Some((lo, hi)) = b else { continue };
                        let v = state.slots[first + k];
                        let held = v.clamp(*lo, *hi);
                        if held != v {
                            state.slots[first + k] = held;
                            note(&Event::Limit(l, k), &[v], &state.slots);
                        }
                    }
                }
                Step::Constraint(k) => {
                    state.reports[self.limits.len() + k] = self.constrain(k, &mut state.slots);
                }
            }
        }
        let timeline = crate::eval::valid_until(motion, t, doc_t, validity);
        state.valid_until = match (timeline, self.inputs.next_change(t)) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        };
    }

    /// The item `id`'s own transform (pos, rot and scale, three each) and every field a channel
    /// writes on it (its path in the item and its value), from an evaluated state.
    pub fn item_values(&self, state: &State, id: &str) -> Option<ItemValues> {
        let i = self.items.iter().position(|x| x == id)?;
        let mut transform = [0.0; TRANSFORM];
        transform.copy_from_slice(&state.slots[i * TRANSFORM..(i + 1) * TRANSFORM]);
        let fields = self
            .fields
            .iter()
            .filter(|f| f.item == Some(i) && f.written)
            .map(|f| {
                let run = &state.slots[f.slot..f.slot + f.width];
                let value = match run {
                    [one] if f.boolean => Datum::Bool(*one >= 0.5),
                    [one] if f.enumerated => Datum::Text(self.label(*one).to_string()),
                    [one] => Datum::Num(*one),
                    many => Datum::Nums(many.to_vec()),
                };
                (f.path.clone(), value)
            })
            .collect();
        Some((transform, fields))
    }
}

/// Refuses a channel whose keys, Bézier extremes or spring peaks leave its hard range, naming
/// the key and the value (Channel and key: "Bézier extremes and spring peaks are checked in
/// closed form").
fn range_check(c: &doc::Channel) -> Result<(), Refused> {
    use crate::curve::{Bezier, Interp};
    let Some((lo, hi)) = c.range else { return Ok(()) };
    let keys = &c.curve.keys;
    let out = |v: f64| v < lo || v > hi;
    let refuse = |key: &str, what: String| Refused {
        code: "out_of_range",
        path: format!("channels/{}/keys/{key}: {what}, outside the range [{lo}, {hi}]", c.id),
    };
    for (i, a) in keys.iter().enumerate() {
        if let Some(v) = a.value.iter().find(|v| out(**v)) {
            return Err(refuse(&a.id, format!("its value {v}")));
        }
        let Some(b) = keys.get(i + 1) else { continue };
        let span = (b.t - a.t) as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64;
        for comp in 0..a.value.len() {
            let (va, vb) = (a.value[comp], b.value[comp]);
            match a.interp {
                Interp::Spring(spring) => {
                    let v0 = a.velocity.get(comp).copied().unwrap_or(0.0);
                    let at_end = spring.at(va - vb, v0, span).e;
                    for t in spring.extremes(va - vb, v0, span).into_iter().flatten() {
                        let v = vb + spring.at(va - vb, v0, t).e;
                        if out(v) {
                            return Err(refuse(&a.id, format!("its spring peaks at {v} {t} s after the key")));
                        }
                    }
                    if out(vb + at_end) {
                        return Err(refuse(&a.id, format!("its spring reaches {} by the next key", vb + at_end)));
                    }
                }
                Interp::Bezier { x1, y1, x2, y2 } => {
                    let bz = Bezier::new(x1, y1, x2, y2);
                    // y'(s) = 0: the quadratic 3a·s² + 2b·s + c of the cubic's y.
                    let (cc, bb) = (3.0 * y1, 3.0 * (y2 - y1) - 3.0 * y1);
                    let aa = 1.0 - cc - bb;
                    let (qa, qb, qc) = (3.0 * aa, 2.0 * bb, cc);
                    let mut roots = Vec::new();
                    if qa.abs() < 1e-15 {
                        if qb != 0.0 {
                            roots.push(-qc / qb);
                        }
                    } else {
                        let d = qb * qb - 4.0 * qa * qc;
                        if d >= 0.0 {
                            let r = deep_canvas::ops::sqrt(d);
                            roots.extend([(-qb - r) / (2.0 * qa), (-qb + r) / (2.0 * qa)]);
                        }
                    }
                    for s in roots.into_iter().filter(|s| *s > 0.0 && *s < 1.0) {
                        let v = va + (vb - va) * bz.y(s);
                        if out(v) {
                            return Err(refuse(&a.id, format!("its Bézier reaches {v}")));
                        }
                    }
                }
                _ => {}
            }
        }
    }
    Ok(())
}

/// An item's pose from its nine transform slots starting at `first`.
fn pose(slots: &[f64], first: usize) -> crate::constraint::Pose {
    let g = |k: usize| [slots[first + 3 * k], slots[first + 3 * k + 1], slots[first + 3 * k + 2]];
    crate::constraint::Pose {
        pos: g(0),
        rot: g(1),
        scale: g(2),
    }
}

/// Slots `first + 3·group ..+3` of each group in `groups`.
fn groups(first: usize, groups: &[usize]) -> Vec<usize> {
    groups
        .iter()
        .flat_map(|g| first + 3 * g..first + 3 * g + 3)
        .collect()
}

impl Program {
    /// The item a slot belongs to: its transform's, or the field's item.
    fn item_of(&self, slot: usize) -> String {
        if slot < self.items.len() * TRANSFORM {
            return self.items[slot / TRANSFORM].clone();
        }
        self.fields
            .iter()
            .find(|f| (f.slot..f.slot + f.width).contains(&slot))
            .and_then(|f| f.item)
            .map_or_else(String::new, |i| self.items[i].clone())
    }

    /// Constraint `k`'s reads and writes, as slots.
    fn constraint_slots(&self, k: usize) -> (Vec<usize>, Vec<usize>) {
        use doc::Kind;
        let c = &self.constraints[k];
        let own = c.owner * TRANSFORM;
        let other = match c.other {
            Some((i, None)) => self.world_slots(i),
            Some((i, Some(g))) => groups(i * TRANSFORM, &[g]),
            None => Vec::new(),
        };
        let (reads, writes) = match &self.motion.constraints[k].kind {
            Kind::ChildOf { .. } => (groups(own, &[0, 1, 2]), groups(own, &[0, 1, 2])),
            Kind::LookAt { .. } => (groups(own, &[0, 1]), groups(own, &[1])),
            Kind::Copy { what, .. } => (vec![], groups(own, &[what.group()])),
            Kind::Distance { .. } => (groups(own, &[0]), groups(own, &[0])),
            Kind::Reach2 { .. } => {
                let [lower, end] = c.chain.map(|i| i * TRANSFORM);
                (
                    [groups(own, &[0, 1, 2]), groups(lower, &[0, 1]), groups(end, &[0])].concat(),
                    [groups(own, &[1, 2]), groups(lower, &[1])].concat(),
                )
            }
            Kind::FollowPath { .. } | Kind::RestOn { .. } | Kind::SpringChain { .. } | Kind::FollowTip { .. } => {
                (groups(own, &[0, 1]), groups(own, &[0, 1]))
            }
        };
        ([other, reads].concat(), writes)
    }

    /// The slots an item's world pose reads: its own nine and each ancestor's.
    fn world_slots(&self, i: usize) -> Vec<usize> {
        let mut out = groups(i * TRANSFORM, &[0, 1, 2]);
        let mut at = i;
        while let Some(&(_, p)) = self.parents.iter().find(|(c, _)| *c == at) {
            out.extend(groups(p * TRANSFORM, &[0, 1, 2]));
            at = p;
        }
        out
    }

    /// Item `i`'s world pose from the slots: its own, under each ancestor's (child-of parenting).
    fn world(&self, slots: &[f64], i: usize) -> [f64; TRANSFORM] {
        let mut out = [0.0; TRANSFORM];
        out.copy_from_slice(&slots[i * TRANSFORM..(i + 1) * TRANSFORM]);
        if let Some(&(_, p)) = self.parents.iter().find(|(c, _)| *c == i) {
            let parent = self.world(slots, p);
            let mut both = [0.0; 2 * TRANSFORM];
            both[..TRANSFORM].copy_from_slice(&parent);
            both[TRANSFORM..].copy_from_slice(&out);
            parent_to(&mut both, 1, 0);
            out.copy_from_slice(&both[TRANSFORM..]);
        }
        out
    }

    /// Orders every write per component (crate::schedule), refusing a loop with `cycle`
    /// naming its entries; `whole_items` is the planted scheduler that orders whole items.
    pub(crate) fn schedule(&mut self, whole_items: bool) -> Result<(), Refused> {
        use crate::schedule::{Node, Stage};
        let mut steps = Vec::new();
        let mut nodes = Vec::new();
        let mut push = |step: Step, node: Node| {
            steps.push(step);
            nodes.push(node);
        };
        for (c, &(slot, width)) in self.channels.iter().enumerate() {
            let entry = format!("channels/{}", self.motion.channels[c].id);
            push(Step::Channel(c), Node { entry, item: self.item_of(slot), stage: Stage::Channels, reads: vec![], writes: (slot..slot + width).collect() });
        }
        for (p, writes) in self.placements.iter().enumerate() {
            for (w, write) in writes.iter().enumerate() {
                let entry = format!("placements/{}", self.motion.placements[p].id);
                let slots = (write.slot..write.slot + write.width.min(3)).collect();
                push(Step::Write(p, w), Node { entry, item: self.item_of(write.slot), stage: Stage::Channels, reads: vec![], writes: slots });
            }
        }
        for (d, (slot, ops)) in self.drivers.iter().enumerate() {
            let reads = ops
                .iter()
                .flat_map(|op| match op {
                    Op::Var(s) => vec![*s],
                    Op::World(i, _) => self.world_slots(*i),
                    _ => vec![],
                })
                .collect();
            let entry = format!("drivers/{}", self.motion.drivers[d].id);
            push(Step::Driver(d), Node { entry, item: self.item_of(*slot), stage: Stage::Driver, reads, writes: vec![*slot] });
        }
        for (l, (first, _)) in self.limits.iter().enumerate() {
            let slots: Vec<usize> = (*first..first + 3).collect();
            let entry = format!("constraints/{}", self.motion.limits[l].id);
            push(Step::Limit(l), Node { entry, item: self.item_of(*first), stage: Stage::Constraints, reads: slots.clone(), writes: slots });
        }
        for k in 0..self.constraints.len() {
            let (reads, writes) = self.constraint_slots(k);
            let entry = format!("constraints/{}", self.motion.constraints[k].id);
            let item = self.items[self.constraints[k].owner].clone();
            push(Step::Constraint(k), Node { entry, item, stage: Stage::Constraints, reads, writes });
        }
        let order = crate::schedule::order(&nodes, whole_items).map_err(|cycle| Refused {
            code: "cycle",
            path: cycle
                .iter()
                .map(|&i| format!("{} ({})", nodes[i].entry, nodes[i].item))
                .collect::<Vec<_>>()
                .join(" → "),
        })?;
        self.order = order.iter().map(|&i| steps[i]).collect();
        // The order by item and stage: an item's transform composes before its first
        // constraint, or after its last write when it has none.
        let mut names: Vec<String> = Vec::new();
        let last_of = |item: &str| order.iter().rposition(|&i| nodes[i].item == item);
        let mut composed = std::collections::BTreeSet::new();
        for (at, &i) in order.iter().enumerate() {
            let node = &nodes[i];
            if node.stage == Stage::Constraints && composed.insert(node.item.clone()) {
                names.push(format!("{}.transform", node.item));
            }
            names.push(format!("{}.{}", node.item, node.stage.name()));
            if last_of(&node.item) == Some(at) && composed.insert(node.item.clone()) {
                names.push(format!("{}.transform", node.item));
            }
        }
        names.dedup();
        self.order_names = names;
        Ok(())
    }

    /// Runs constraint `k` on the slots, mixing what it writes by its influence.
    fn constrain(&self, k: usize, slots: &mut [f64]) -> (u64, f64) {
        use crate::constraint as cs;
        use doc::Kind;
        let c = &self.constraints[k];
        let spec = &self.motion.constraints[k];
        let own_at = c.owner * TRANSFORM;
        let own = pose(slots, own_at);
        let other = match c.other {
            Some((i, None)) => pose(&self.world(slots, i), 0),
            Some((i, Some(_))) => pose(slots, i * TRANSFORM),
            None => own,
        };
        let mut ops = cs::Ops::default();
        let mut extra: Option<(usize, f64)> = None;
        let mut stretch = f64::NAN;
        let solved = match &spec.kind {
            Kind::ChildOf { .. } => cs::child_of(&other, &own, &mut ops),
            Kind::LookAt { .. } => cs::look_at(&own, other.pos, &mut ops),
            Kind::Copy { what, .. } => cs::copy(&own, *what, &other, &mut ops),
            Kind::Distance { min, max, .. } => cs::distance(&own, other.pos, *min, *max, &mut ops),
            Kind::FollowPath { fraction, orient, offset, .. } => match &c.table {
                Some(table) => cs::follow_path(&own, table, *fraction, *orient, *offset, &mut ops),
                None => own,
            },
            Kind::FollowTip { offset, rotate, .. } => {
                cs::follow_tip(&own, [other.pos[0], other.pos[1]], other.rot[2], *offset, *rotate, &mut ops)
            }
            Kind::RestOn { ground, bottom, offset, max_drop } => {
                cs::rest_on(&own, *bottom, *ground, *offset, *max_drop, &mut ops).unwrap_or(own)
            }
            Kind::SpringChain { .. } => own,
            Kind::Reach2 { bend, cartoon, .. } => {
                let [lower, end] = c.chain.map(|i| pose(slots, i * TRANSFORM));
                let length = |p: &cs::Pose| deep_canvas::ops::hypot(p.pos[0], p.pos[1]);
                let r = cs::reach2(
                    [own.pos[0], own.pos[1]],
                    [length(&lower), length(&end)],
                    [other.pos[0], other.pos[1]],
                    *bend,
                    *cartoon,
                    &mut ops,
                );
                // The lower bone's turn is its own, after the upper bone's.
                extra = Some((c.chain[0] * TRANSFORM + 5, r.lower - r.upper));
                stretch = r.stretch;
                let mut out = own;
                out.rot[2] = r.upper;
                out.scale = [r.stretch, r.stretch, own.scale[2] * r.stretch];
                out
            }
        };
        let w = spec.influence;
        let (_, writes) = self.constraint_slots(k);
        let after = [solved.pos, solved.rot, solved.scale].concat();
        for s in writes.iter().filter(|s| (own_at..own_at + TRANSFORM).contains(s)) {
            let v = after[s - own_at];
            slots[*s] += w * (v - slots[*s]);
        }
        if let Some((slot, v)) = extra {
            slots[slot] += w * (v - slots[slot]);
        }
        (ops.0, stretch)
    }
}

impl Program {
    /// Whether an evaluation may write any slot in `slots` beyond its base: a channel, a
    /// placement, a driver or a limit targets one.
    pub fn writes(&self, slots: std::ops::Range<usize>) -> bool {
        let hits = |at: usize, width: usize| at < slots.end && slots.start < at + width;
        self.channels.iter().any(|&(at, width)| hits(at, width))
            || self.follows.iter().any(|&at| hits(at, 1))
            || self
                .placements
                .iter()
                .flatten()
                .any(|w| hits(w.slot, w.width.min(3)))
            || self.drivers.iter().any(|(at, _)| hits(*at, 1))
            || self.limits.iter().any(|(first, _)| hits(*first, 3))
    }

    /// Document channel `id`'s value at `state`'s time, its first component, before it is
    /// stored in its target: what a light's `flicker` scales its power by (#421).
    pub fn channel_value(&self, state: &State, id: &str) -> Option<f64> {
        let c = self.motion.channels.iter().position(|c| c.id == id)?;
        state.values.get(*self.values.get(c)?).copied()
    }

    /// The slot the field `field` of item `owner` takes, if anything in the program reads or
    /// writes it: its transform's for `at/pos|rot|scale/k`, or a field's of its own.
    pub fn slot_of(&self, owner: &str, field: &[String]) -> Option<usize> {
        let i = self.items.iter().position(|x| x == owner)?;
        if let [at, name, k] = field {
            let group = ["pos", "rot", "scale"].iter().position(|n| n == name);
            if let (true, Some(g), Ok(k)) = (at == "at", group, k.parse::<usize>()) {
                return (k < 3).then_some(i * TRANSFORM + 3 * g + k);
            }
        }
        self.fields
            .iter()
            .find(|f| f.item == Some(i) && f.path == field)
            .map(|f| f.slot)
    }

    /// Every write motion makes to `slot` at `t`, in evaluation order: the document entry that
    /// made it, its value after it, and what it read (the why's writes, #411).
    pub fn trace(&self, t: i64, slot: usize) -> Vec<Traced> {
        let mut state = self.state();
        let mut out = Vec::new();
        let (doc_t, _) = crate::eval::position(&self.motion, t);
        self.run(t, Validity::Full, &mut state, |event, before, slots| {
            let traced = match event {
                Event::Channel(c)
                    if (self.channels[*c].0..self.channels[*c].0 + self.channels[*c].1)
                        .contains(&slot) =>
                {
                    let channel = &self.motion.channels[*c];
                    let path = format!("channels/{}", channel.id);
                    let owner = channel.curve.owner(doc_t).unwrap_or(0);
                    // The component of the key's value this slot takes; a number's is the value.
                    let (start, width) = self.channels[*c];
                    let i = slot - start;
                    let at = if width > 1 {
                        format!("/{i}")
                    } else {
                        String::new()
                    };
                    let mut reads = Vec::new();
                    for k in [Some(owner), channel.curve.next(doc_t)]
                        .into_iter()
                        .flatten()
                    {
                        let key = &channel.curve.keys[k];
                        let v = key.value.get(i).copied().unwrap_or(0.0);
                        reads.push((format!("{path}/keys/{}/value{at}", key.id), v));
                    }
                    let key = &channel.curve.keys[owner];
                    Traced {
                        entry: format!("{path}/keys/{}", key.id),
                        operator: "channels",
                        value: slots[slot],
                        limit: false,
                        reads,
                    }
                }
                Event::Follow(f) if self.follows[*f] == slot => Traced {
                    entry: format!("channels/{}", self.motion.follows[*f].id),
                    operator: "channels",
                    value: slots[slot],
                    limit: false,
                    reads: Vec::new(),
                },
                Event::Placement(p, written) if written.contains(&slot) => Traced {
                    entry: format!("placements/{}", self.motion.placements[*p].id),
                    operator: "channels",
                    value: slots[slot],
                    limit: false,
                    reads: Vec::new(),
                },
                Event::Driver(d) if self.drivers[*d].0 == slot => {
                    let driver = &self.motion.drivers[*d];
                    let reads = driver
                        .vars
                        .iter()
                        .filter_map(|(_, target)| {
                            let s = self.slot_of(&target.owner, &target.field)?;
                            let path = format!("items/{}/{}", target.owner, target.field.join("/"));
                            Some((path, slots[s]))
                        })
                        .collect();
                    Traced {
                        entry: format!("drivers/{}", driver.id),
                        operator: "channels",
                        value: slots[slot],
                        limit: false,
                        reads,
                    }
                }
                Event::Limit(l, k) if self.limits[*l].0 + k == slot => {
                    let limit = &self.motion.limits[*l];
                    let (lo, hi) = limit.bounds[*k].unwrap_or_default();
                    let end = if before.first().is_some_and(|v| *v < lo) {
                        0
                    } else {
                        1
                    };
                    let path = format!("constraints/{}", limit.id);
                    Traced {
                        entry: path.clone(),
                        operator: "channels",
                        value: slots[slot],
                        limit: true,
                        reads: vec![(
                            format!("{path}/bounds/{k}/{end}"),
                            if end == 0 { lo } else { hi },
                        )],
                    }
                }
                _ => return,
            };
            out.push(traced);
        });
        out
    }
}

/// A driver's postfix steps as ops over slots: each name its var's slot. `None` past
/// [`DRIVER_OPS`] steps, for a function outside the closed list, or for a stack that doesn't
/// end with one value.
/// What a driver's var reads: a slot, or a component of an item's world pose.
#[derive(Clone, Copy)]
enum Var {
    Slot(usize),
    World(usize, usize),
}

fn compile_ops(
    steps: &[deep_canvas::document::packs::ExprStep],
    vars: &[(&str, Var)],
) -> Option<Vec<Op>> {
    use deep_canvas::document::packs::ExprStep;
    if steps.len() > DRIVER_OPS {
        return None;
    }
    let mut depth: isize = 0;
    let mut ops = Vec::with_capacity(steps.len());
    for step in steps {
        let (op, delta) = match step {
            ExprStep::Num(n) => (Op::Num(*n), 1),
            ExprStep::Name(n) => (
                match vars.iter().find(|(v, _)| v == n)?.1 {
                    Var::Slot(s) => Op::Var(s),
                    Var::World(i, k) => Op::World(i, k),
                },
                1,
            ),
            ExprStep::Neg => (Op::Neg, 0),
            ExprStep::Bin(c) => (Op::Bin(*c as u8), -1),
            ExprStep::Call(name, n) => {
                let f = ["min", "max", "floor", "ceil", "round", "abs"]
                    .iter()
                    .position(|x| x == name)?;
                let arity = if f < 2 { 2 } else { 1 };
                if *n != arity {
                    return None;
                }
                (Op::Call(f as u8, *n), 1 - *n as isize)
            }
        };
        depth += delta;
        if depth < 1 {
            return None;
        }
        ops.push(op);
    }
    (depth == 1).then_some(ops)
}

/// A driver's value over the slots, with a fixed stack and no allocation; NaN on `/` or `%` by 0.
fn evaluate_ops(ops: &[Op], slots: &[f64], world: impl Fn(usize, usize) -> f64) -> f64 {
    let mut stack = [0.0f64; DRIVER_OPS];
    let mut n = 0;
    for op in ops {
        match *op {
            Op::Num(v) => {
                stack[n] = v;
                n += 1;
            }
            Op::Var(s) => {
                stack[n] = slots[s];
                n += 1;
            }
            Op::World(i, k) => {
                stack[n] = world(i, k);
                n += 1;
            }
            Op::Neg => stack[n - 1] = -stack[n - 1],
            Op::Bin(c) => {
                let (a, b) = (stack[n - 2], stack[n - 1]);
                n -= 1;
                stack[n - 1] = match c {
                    b'+' => a + b,
                    b'-' => a - b,
                    b'*' => a * b,
                    _ if b == 0.0 => f64::NAN,
                    b'/' => a / b,
                    _ => a % b,
                };
            }
            Op::Call(f, args) => {
                let a = stack[n - args];
                let v = match f {
                    0 => a.min(stack[n - 1]),
                    1 => a.max(stack[n - 1]),
                    2 => a.floor(),
                    3 => a.ceil(),
                    4 => a.round(),
                    _ => a.abs(),
                };
                n -= args;
                stack[n] = v;
                n += 1;
            }
        }
    }
    stack[0]
}

/// Child-of parenting (canvas primitives: Constraint, R1 `child_of`): the child's transform,
/// scaled, then turned about z by the parent's and moved by its position, so the child rides its
/// parent. Rotation and scale compose, as the transform order says.
fn parent_to(slots: &mut [f64], child: usize, parent: usize) {
    let (p, c) = (parent * TRANSFORM, child * TRANSFORM);
    let mut pt = [0.0; TRANSFORM];
    pt.copy_from_slice(&slots[p..p + TRANSFORM]);
    let (p_pos, p_rot, p_scale) = (&pt[0..3], &pt[3..6], &pt[6..9]);
    let ch = &mut slots[c..c + TRANSFORM];
    let (x, y) = (ch[0] * p_scale[0], ch[1] * p_scale[1]);
    let (cos, sin) = if p_rot[2] == 0.0 {
        (1.0, 0.0)
    } else {
        let a = deep_canvas::ops::rad(p_rot[2]);
        (deep_canvas::ops::cos(a), deep_canvas::ops::sin(a))
    };
    ch[2] = p_pos[2] + ch[2] * p_scale[2];
    ch[0] = p_pos[0] + x * cos - y * sin;
    ch[1] = p_pos[1] + x * sin + y * cos;
    for k in 0..3 {
        ch[3 + k] += p_rot[k];
        ch[6 + k] *= p_scale[k];
    }
}
