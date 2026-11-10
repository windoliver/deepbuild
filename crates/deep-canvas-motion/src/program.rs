//! A document compiled once per revision into flat, typed arrays (canvas primitives: Array and
//! table; Operator and read set): every item's transform and every field a channel writes is a
//! run of `f64` slots, each channel and placement write resolves at compile time to a slot, and a
//! frame evaluates into a [`State`] the program sized up front. After the first frame, evaluating
//! allocates nothing: no map, string or vector is made per frame.

use std::collections::BTreeSet;
use std::sync::Arc;

use deep_canvas::expr::{Expr, Scope};
use deep_canvas::interval::Iv;
use serde_json::{json, Map, Value};

use deep_canvas::schedule::core_ops::Datum;

use crate::curve::Key;
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
    /// A keyed data value's name (`data/<name>`), which owns the field in place of an item.
    pub data: Option<String>,
    /// #494: a path channel's field, its sub-paths' structure, written as an SVG path string.
    pub shape: Option<crate::morph::Structure>,
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
    /// The whole expression through the core's closed function list: [`Program`]'s core
    /// driver `.0`, for any expression past the six functions above.
    Core(usize),
}

/// Each channel's or driver's bound by ID, `None` where the forms don't settle it.
pub type Bounds = Vec<(String, Option<(f64, f64)>)>;

/// A driver compiled through the core's closed function list, with where each of its vars
/// reads from, in [`Expr::vars`] order.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Core {
    pub(crate) expr: Arc<Expr>,
    pub(crate) inputs: Vec<CoreInput>,
    /// What the driver writes where a read finds nothing or its value isn't finite (#491).
    pub(crate) fallback: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum CoreInput {
    Slot(usize),
    World(usize, usize),
    /// Seconds since the transport's start; over the document's span when bounded.
    Time,
    /// A control's value: its entries on the input track as `(t, seq, value)` in order, its
    /// default before any, and its declared range.
    Control {
        entries: Vec<(i64, i64, f64)>,
        default: f64,
        range: (f64, f64),
    },
    /// An occurrence read over a list filtered at check (#491).
    Occurrence(Arc<crate::occurrence::Read>),
    /// A channel's rate per second.
    Rate(usize),
    /// A remap's `.active`, or with `true` its `.progress`.
    Remap(usize, bool),
    /// #495: `lag(var, dt)`: a slot, the time or a control as it reads at t − dt flicks.
    Lag(Box<CoreInput>, i64),
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
    /// One path's mix placements.
    Mix(usize),
    Driver(usize),
    Limit(usize, usize),
}

/// One node of the compiled order (crate::schedule): what runs, in the order it runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Step {
    Channel(usize),
    /// Placement `p`'s write `w`.
    Write(usize, usize),
    /// One path's mix placements, in canonical order.
    Mix(usize),
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
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Write {
    pub(crate) channel: usize,
    pub(crate) delay: i64,
    pub(crate) slot: usize,
    pub(crate) width: usize,
    /// An add placement's reference pose (`add_from`).
    pub(crate) reference: [f64; 4],
}

/// The mix placements on one path: each placement and write, by placement ID (Placement:
/// order-free mix).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Mix {
    pub(crate) slot: usize,
    pub(crate) width: usize,
    pub(crate) turns: bool,
    pub(crate) members: Vec<(usize, usize)>,
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
    /// #490: a table's interval form from 8 samples between its range's ends.
    TableFormSamples8,
    /// #1646: cells takes its seed with the time, so a still point's outputs move.
    CellsSeededFromT,
    /// #490: a pulse that leaves 1e-6 at its end.
    PulseLeavesResidue,
    /// #490: out_back with its fixed 1.70158, ignoring `overshoot`.
    BackIgnoresParams,
    /// #490: an opening of `ease@1` that renumbers its entries.
    EaseRenumbered,
    /// #491: a beat grid kept in f32 seconds.
    BeatGridF32,
    /// #492: a placement that turns t into f32 seconds before the repeat wraps it.
    PlacementF32Seconds,
    /// #492: a replay that runs at rate 1, whatever its rate says.
    ReplayAtRate1,
    /// #492: rotations blended per component, signs unaligned.
    BlendPerComponent,
    /// #492: rotations slerped the long way round.
    SlerpLongArc,
    /// #492: an active placement that puts every other path on its item back to the base.
    UnkeyedResetsToBase,
    /// #492: a ramp that sums the rate times the frame step.
    RampSumsPerFrame,
    /// #492: a `then: lag` hitstop that matches in parent time.
    HitstopMatchesParentTime,
    /// #493: a log zoom that eases the view width, not its logarithm.
    LogZoomEasesWidth,
    /// #493: framing that bounds the kept items from 30 samples a second.
    FramerSamples30Hz,
    /// #493: framing that fits the frames' samples, never refusing a bound it can't settle.
    FramerFitsSamples,
    /// #493: a lens zoom that eases the field of view in degrees.
    LensZoomEasesFovDegrees,
    /// #493: a lens zoom that dollies at its starting field of view.
    LensZoomDollies,
    /// #493: a whip that eases each half in and out.
    WhipEasesHalves,
    /// #493: a shake drawing a new random offset each frame.
    ShakeFreshPerFrame,
    /// #493: a shot that writes roll 0 whatever its roll.
    ShotWritesRoll0,
    /// #493: a pan that turns right whatever its angle.
    PanIgnoresAngle,
    /// #493: a match cut's incoming shot framed by its keep, ignoring the match.
    MatchFramerIgnoresMatch,
    /// #493: a kick drawing a fresh random offset each frame.
    KickFreshPerFrame,
}

impl Planted {
    fn arc(self) -> crate::quat::Arc {
        match self {
            Planted::BlendPerComponent => crate::quat::Arc::Chord,
            Planted::SlerpLongArc => crate::quat::Arc::Long,
            _ => crate::quat::Arc::Short,
        }
    }
}

/// What an evaluation takes besides the document: the input track's entries, the viewer's
/// reduced-motion preference, and a planted program.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Options {
    pub input: Vec<Entry>,
    pub reduced_motion: bool,
    pub planted: Planted,
    /// The function tables and ease tables the document's packs give (#490).
    pub scope: Scope,
    /// Times are timeline positions as given: the loop isn't applied.
    pub unwrap: bool,
    /// The auto layout solve a frame's layout glide reads (#491), given by the host: each laid-out
    /// item's `[x, y, w, h]`, or the code and item it refuses with.
    pub layout: Option<Layout>,
}

/// A document's auto layout: each laid-out item's box `[x, y, w, h]`.
pub type Boxes = std::collections::BTreeMap<String, [f64; 4]>;

/// Each layout glide's channel, with the boxes of the layout at each of its keys (#491).
pub(crate) type Glides = Vec<(usize, Vec<Boxes>)>;

/// The host's auto layout solve, the canvas core's layout module (canvas primitives: Auto layout).
#[derive(Clone, Copy)]
pub struct Layout(pub fn(&Value) -> Result<Boxes, (String, String)>);

impl std::fmt::Debug for Layout {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Layout")
    }
}

/// One solve gives one answer, so any two are the same program.
impl PartialEq for Layout {
    fn eq(&self, _: &Layout) -> bool {
        true
    }
}

/// The input track's hash: SHA-256 over each entry's time, player, seq, control and value, in
/// the track's (t, player, seq) order, so the order entries arrived in never enters it (#497).
pub fn track_hash(entries: &[Entry]) -> String {
    let mut sorted: Vec<&Entry> = entries.iter().collect();
    sorted.sort_by_key(|e| e.key());
    let mut bytes = Vec::new();
    for e in sorted {
        let value = e.value.to_string();
        bytes.extend(e.t.to_le_bytes());
        bytes.extend(e.player.to_le_bytes());
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
    pub(crate) mixes: Vec<Mix>,
    /// The look's `quantize_hz`, stepping the document's time first.
    pub(crate) quantize: Option<(u32, u32)>,
    pub(crate) parents: Vec<(usize, usize)>,
    /// Each driver's target slot and compiled expression, in driver order.
    pub(crate) drivers: Vec<(usize, Vec<Op>)>,
    /// The drivers past the six functions, through the core's expressions.
    pub(crate) cores: Vec<Core>,
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
    /// With a layout solve: the document's boxes, and each layout glide's channel with the
    /// boxes of the layout at each of its keys, all solved at check (#491).
    pub(crate) layout: Option<(Boxes, Glides)>,
    /// The mark sets whose rows come from occurrence lists.
    pub(crate) rows: Vec<crate::rows::RowList>,
    pub options: Options,
    /// #493: the document's shots and their transitions, compiled at check.
    pub shots: Option<Arc<crate::shots::Plan>>,
    /// #494: the match morphs between two items in one shot.
    pub betweens: Vec<crate::morph::Between>,
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
    /// Each constraint but `limit`: whether its aim had no direction this frame.
    pub degenerate: Vec<bool>,
    /// An earlier chain a lag reads (#495), which leaves the lagging drivers out.
    nested: bool,
}

fn number(v: Option<&Value>) -> Option<f64> {
    v.and_then(Value::as_f64).filter(|n| n.is_finite())
}

/// #494: each path key `{of: ID[#part]}` takes that item's evaluated path at the key's time, in
/// its own item's space, from the document evaluated without the channels that hold such keys;
/// then its channel's keys are matched as any path keys are.
fn resolve_of(doc: &Map<String, Value>, motion: &mut doc::Motion, options: &Options) -> Result<(), Refused> {
    let holds = |c: &doc::Channel| c.path.as_ref().is_some_and(|p| !p.of.is_empty());
    if !motion.channels.iter().any(holds) {
        return Ok(());
    }
    let mut without = doc.clone();
    if let Some(Value::Object(channels)) = without.get_mut("channels") {
        for c in motion.channels.iter().filter(|c| holds(c)) {
            channels.remove(&c.id);
        }
    }
    let base = Program::compile_with(&without, options.clone())?;
    let mut state = base.state();
    for c in motion.channels.iter_mut().filter(|c| holds(c)) {
        let path = format!("channels/{}", c.id);
        let keyed = c.path.as_mut().expect("a path channel");
        for (i, of) in keyed.of.clone() {
            let key = &c.curve.keys[i];
            let at = format!("{path}/keys/{}/value/of", key.id);
            base.evaluate(key.t, Validity::Full, &mut state);
            let items = crate::eval::items(doc, &base, &state);
            let (id, part) = match of.split_once('#') {
                Some((id, part)) => (id, Some(part)),
                None => (of.as_str(), None),
            };
            let unresolved = || Refused { code: "ref_unresolved", path: at.clone(), detail: None };
            let item = items.get(id).ok_or_else(unresolved)?;
            let shape = crate::morph::of_item(item, part).ok_or_else(unresolved)?;
            let world = crate::morph::placed(item, &shape);
            keyed.shapes[i] = Some(match items.get(&c.target.owner) {
                Some(own) => crate::morph::unplaced(own, &world),
                None => world,
            });
        }
        keyed.of.clear();
        doc::match_path(&c.id, keyed, &mut c.curve.keys, &path)?;
    }
    Ok(())
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
        crate::held::check(doc)?;
        let mut motion = doc::read_with(doc, options.planted == Planted::BeatGridF32, options.planted.arc())?;
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
        open_eases(&mut motion, &options)?;
        resolve_of(doc, &mut motion, &options)?;
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
            mixes: Vec::new(),
            quantize: None,
            parents: Vec::new(),
            drivers: Vec::new(),
            cores: Vec::new(),
            limits: Vec::new(),
            constraints: Vec::new(),
            order: Vec::new(),
            order_names: Vec::new(),
            channel_follows: Vec::new(),
            layout: None,
            rows: Vec::new(),
            options,
            motion: motion.clone(),
            shots: None,
            betweens: Vec::new(),
        };
        // Only a document with frames is laid out; it is refused here only when a key glides
        // its layout, since the layout is otherwise not motion's to check. A glide needs a frame
        // to lay out and a host that lays it out, or the layout would hold and the glide be lost.
        let frames = items_json.values().any(|i| i.get("kind").and_then(Value::as_str) == Some("frame@1"));
        let glides = motion.channels.iter().filter(|c| c.glide.is_some());
        for c in glides.clone() {
            let frame = items_json.get(&c.target.owner).and_then(|i| i.get("kind")).and_then(Value::as_str) == Some("frame@1");
            if !frame || program.options.layout.is_none() {
                return Err(Refused {
                    code: "layout_refused",
                    path: format!("channels/{}/target", c.id),
                    detail: Some(Box::new(json!({"why": if frame { "this host has no auto layout solve to glide it" } else { "only a frame@1 is laid out" }, "item": c.target.owner}))),
                });
            }
        }
        if let (Some(solve), true) = (program.options.layout, frames) {
            let glides = glides.count() > 0;
            match layouts(doc, &motion, solve) {
                Ok(l) => program.layout = Some(l),
                Err(r) if glides => return Err(r),
                Err(_) => {}
            }
        }
        let on_euler = |c: &doc::Channel| c.ty == doc::ValueType::Quat && c.target.field == ["at", "rot"];
        let rotations = motion.channels.iter().chain(motion.clips.iter().flat_map(|c| &c.channels));
        if let Some(c) = rotations.into_iter().find(|c| on_euler(c)) {
            // A transform's rot is three Euler degrees; four numbers there would draw as nonsense.
            return Err(Refused { code: "bad_type", path: format!("channels/{}/type", c.id), detail: None });
        }
        let mut values = 0;
        for channel in &motion.channels {
            let width = channel.curve.keys.first().map_or(1, |k| k.value.len());
            let slot = program.slot(items_json, &channel.target.owner, &channel.target, width);
            program.mark_type(slot, channel.ty);
            if let (Some(p), Some(f)) = (&channel.path, program.fields.iter_mut().find(|f| f.slot == slot)) {
                f.shape = Some(p.structure.clone());
            }
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
                        let mut reference = [0.0; 4];
                        let run = &mut reference[..width.min(4)];
                        match placement.blending.add_from {
                            doc::AddFrom::First => channel.curve.sample_into(i64::MIN / 2, run),
                            doc::AddFrom::At(t) => channel.curve.sample_into(t, run),
                            doc::AddFrom::Bind => {
                                run.copy_from_slice(&program.base[slot..slot + width.min(4)]);
                                0
                            }
                        };
                        writes.push(Write {
                            channel: c,
                            delay: binding.delay,
                            slot,
                            width,
                            reference,
                        });
                    }
                }
            }
            program.placements.push(writes);
        }
        // #491: first markers read the channels, and drivers' lists read the markers.
        for first in &motion.firsts {
            let marker = program.solve_first(items_json, first)?;
            program.motion.markers.push(marker);
        }
        program.motion.markers.sort_by(|a, b| a.id.cmp(&b.id));
        program.resolve_times(doc)?;
        program.gather_mixes();
        program.rows = program.occurrence_rows(items_json, doc.get("controls").and_then(Value::as_object))?;
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
            // A driver with inputs, a hard range or a fallback compiles through the core, whose
            // interval form the range check reads and which takes the fallback.
            let r1 = driver.inputs.is_empty() && driver.range.is_none() && driver.fallback.is_none();
            let ops = match compile_ops(&driver.expr, &vars).filter(|_| r1) {
                Some(ops) => ops,
                None => {
                    let core = program.core_driver(doc, driver, &vars, &path)?;
                    program.cores.push(core);
                    vec![Op::Core(program.cores.len() - 1)]
                }
            };
            program.drivers.push((slot, ops));
        }
        // A lag evaluates the chain again at another time, so a lagged slot is never one a lagging
        // driver writes: that chain would evaluate itself without end.
        let lags = |program: &Program, d: usize| match program.drivers[d].1.as_slice() {
            [Op::Core(i)] => program.cores[*i]
                .inputs
                .iter()
                .any(|x| matches!(x, CoreInput::Lag(..))),
            _ => false,
        };
        for (d, (_, ops)) in program.drivers.iter().enumerate() {
            let [Op::Core(i)] = ops.as_slice() else {
                continue;
            };
            for input in &program.cores[*i].inputs {
                let CoreInput::Lag(inner, _) = input else {
                    continue;
                };
                let CoreInput::Slot(s) = **inner else {
                    continue;
                };
                if let Some(other) = (0..program.drivers.len())
                    .find(|&o| program.drivers[o].0 == s && lags(&program, o))
                {
                    return Err(Refused {
                        code: "lag_cycle",
                        path: format!("drivers/{}/expr", motion.drivers[d].id),
                        detail: Some(Box::new(
                            json!({"driver": motion.drivers[d].id, "why": format!("it lags a slot drivers/{} writes with a lag of its own", motion.drivers[other].id)}),
                        )),
                    });
                }
            }
        }
        for limit in &motion.limits {
            let Some(i) = program.items.iter().position(|x| *x == limit.owner) else {
                return Err(Refused {
                    code: "ref_unresolved",
                    path: format!("constraints/{}/owner", limit.id), detail: None });
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
                path, detail: None })
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
                        let g = ["pos", "rot", "scale"].iter().position(|n| n == g).ok_or(Refused { code: "bad_path", path: at.clone(), detail: None })?;
                        Ok((index_of(&program.items, id, at)?, Some(g)))
                    }
                    [id] => Ok((index_of(&program.items, id, at)?, None)),
                    _ => Err(Refused { code: "bad_path", path: at, detail: None }),
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
                        return Err(Refused { code: "bad_doc", path: format!("{path}/chain"), detail: None });
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
        program.refuse_second_writers(doc)?;
        program.refuse_look_ahead()?;
        program.schedule(program.options.planted == Planted::SchedulesWholeItems)?;
        program.channel_follows = program.build_follows();
        // A keyed data value holds its document value until something writes it.
        for field in &program.fields {
            let held = field.data.as_ref().and_then(|n| doc.get("data")?.get(n));
            if let Some(v) = held.map(|d| d.get("value").unwrap_or(d)).and_then(Value::as_f64) {
                program.base[field.slot] = v;
            }
        }
        // #493: the shots read the compiled program: their framing bounds its writers' forms.
        program.shots = crate::shots::Plan::compile(doc, &program)?.map(Arc::new);
        program.betweens = crate::morph::betweens_of(doc, &doc::Ctx::of(program.motion.frame_rate))?;
        Ok(program)
    }

    /// What reads occurrences or the input track, once the markers are in: each remap's pieces
    /// and each `start_on` placement's runs.
    fn resolve_times(&mut self, doc: &Map<String, Value>) -> Result<(), Refused> {
        use crate::remap::{self, Pending};
        let controls = doc.get("controls").and_then(Value::as_object);
        let times = |this: &Program, filter: &crate::occurrence::Filter, path: String| -> Result<Vec<crate::occurrence::Occurrence>, Refused> {
            let list = this.occurrences(filter, controls).ok_or_else(|| Refused { code: "ref_unresolved", path: path.clone(), detail: None })?;
            crate::occurrence::filtered(filter, list).map_err(|r| Refused { code: r.code, path, detail: Some(Box::new(json!({"why": r.why}))) })
        };
        for r in 0..self.motion.remaps.len() {
            let Some(pending) = self.motion.remaps[r].pending.clone() else { continue };
            let path = format!("time_remaps/{}/map", self.motion.remaps[r].id);
            let segs = match &pending {
                Pending::Hitstop { at, on, hold, rejoin } => {
                    let mut matches = at.clone();
                    if let Some(on) = on {
                        matches.extend(times(self, on, path)?.iter().map(|o| o.t));
                    }
                    if *rejoin {
                        remap::hitstop_rejoin(&matches, *hold)
                    } else if self.options.planted == Planted::HitstopMatchesParentTime {
                        remap::hitstop_lag_in_parent_time(&matches, *hold)
                    } else {
                        remap::hitstop_lag(&matches, *hold)
                    }
                }
                Pending::Replay { on, before, after, rate } => {
                    let list: Vec<i64> = times(self, on, path)?.iter().map(|o| o.t).collect();
                    let rate = if self.options.planted == Planted::ReplayAtRate1 { (1, 1) } else { *rate };
                    let class = |e: &&Entry| controls.and_then(|c| c.get(&e.control)?.get("class")?.as_str()) == Some("document");
                    let ends: Vec<i64> = self.options.input.iter().filter(class).map(|e| e.t).collect();
                    remap::replay(&list, &ends, *before, *after, rate)
                }
                Pending::Scrub { control } => {
                    let default = controls.and_then(|c| c.get(control)).and_then(|c| c.get("default")).and_then(Value::as_f64).unwrap_or(0.0);
                    remap::scrub(&self.control_entries(control), default)
                }
            };
            self.motion.remaps[r].segs = segs;
        }
        if self.options.planted == Planted::RampSumsPerFrame {
            let (p, q) = self.motion.frame_rate;
            let step = deep_canvas::grammar::FLICKS_PER_SECOND * i64::from(q) / i64::from(p);
            let end = self.motion.transport.span.unwrap_or(0);
            for r in &mut self.motion.remaps {
                r.segs = remap::summed_per_frame(r, step, end);
            }
        }
        for p in 0..self.motion.placements.len() {
            let Some(start_on) = self.motion.placements[p].timing.start_on.clone() else { continue };
            let path = format!("placements/{}/start_on", self.motion.placements[p].id);
            let mut list = times(self, &start_on.on, path)?;
            list.sort_by_key(|o| o.t);
            let clip_span = self.motion.clip(&self.motion.placements[p].clip).map_or(1, |c| c.span);
            let active = self.motion.placements[p].active_for(clip_span);
            let mut runs: Vec<i64> = Vec::new();
            let mut closes: Vec<bool> = Vec::new();
            let mut last = None;
            for o in &list {
                let changed = last.as_ref() != Some(&o.payload);
                last = Some(o.payload.clone());
                let busy = runs.last().is_some_and(|r| o.t < r + active);
                if (start_on.change && !changed) || (start_on.policy == doc::Policy::Ignore && busy) {
                    continue;
                }
                runs.push(o.t);
                let value = &o.payload["value"];
                closes.push(*value == json!(false) || value.as_f64() == Some(0.0));
            }
            self.motion.placements[p].timing.runs = runs;
            self.motion.placements[p].timing.closes = closes;
        }
        for p in 0..self.motion.placements.len() {
            let Some(switch) = &self.motion.placements[p].blending.switch else { continue };
            let default = controls.and_then(|c| c.get(&switch.control)).and_then(|c| c.get("default")).cloned();
            let Some(first) = default else {
                return Err(Refused { code: "ref_unresolved", path: format!("placements/{}/switch/control", self.motion.placements[p].id), detail: None });
            };
            let mut entries: Vec<&Entry> = self.options.input.iter().filter(|e| e.control == switch.control).collect();
            entries.sort_by_key(|e| e.key());
            // A synced change waits for the placement's next pass, or for the change before it.
            let placement = &self.motion.placements[p];
            let pass = placement.active_for(self.motion.clip(&placement.clip).map_or(1, |c| c.span)) / i64::from(placement.count);
            let (sync, origin) = (switch.sync, placement.start);
            let mut held = first.clone();
            let mut changes: Vec<(i64, Value)> = Vec::new();
            for e in entries {
                if e.value != held {
                    held = e.value.clone();
                    let at = if sync { origin + (e.t - origin + pass - 1).div_euclid(pass) * pass } else { e.t };
                    changes.push((at, held.clone()));
                }
            }
            if let Some(switch) = &mut self.motion.placements[p].blending.switch {
                switch.first = first;
                switch.changes = changes;
            }
        }
        Ok(())
    }

    /// `control`'s input track entries in time order, with values as numbers.
    fn control_entries(&self, control: &str) -> Vec<(i64, f64)> {
        let mut entries: Vec<&Entry> = self.options.input.iter().filter(|e| e.control == control).collect();
        entries.sort_by_key(|e| e.key());
        entries.into_iter().filter_map(|e| Some((e.t, e.value.as_f64()?))).collect()
    }

    /// Groups each path's mix placements, by placement ID, so neither placement nor writer order
    /// changes the result.
    fn gather_mixes(&mut self) {
        let mut groups: std::collections::BTreeMap<(usize, usize), Vec<(usize, usize)>> = Default::default();
        for (p, writes) in self.placements.iter().enumerate() {
            if self.motion.placements[p].blending.blend != doc::Blend::Mix {
                continue;
            }
            for (w, write) in writes.iter().enumerate() {
                groups.entry((write.slot, write.width)).or_default().push((p, w));
            }
        }
        self.mixes = groups
            .into_iter()
            .map(|((slot, width), mut members)| {
                members.sort_by(|a, b| self.motion.placements[a.0].id.cmp(&self.motion.placements[b.0].id));
                let (p, w) = members[0];
                let clip = self.motion.clip(&self.motion.placements[p].clip);
                let channel = clip.map(|c| &c.channels[self.placements[p][w].channel]);
                let turns = channel.is_some_and(|c| c.ty == doc::ValueType::Quat);
                Mix { slot, width, turns, members }
            })
            .collect();
    }

    /// A path takes one writer (The order of one evaluation): the placements on it, or one
    /// channel, follow or bound value; then at most one driver. A second is refused, naming both.
    fn refuse_second_writers(&self, doc: &Map<String, Value>) -> Result<(), Refused> {
        let refused = |a: &str, b: &str, slot: usize| Refused {
            code: "second_writer",
            path: format!("{a} and {b}"),
            detail: Some(Box::new(json!({"writers": [a, b], "item": self.item_of(slot)}))),
        };
        let mut writers: std::collections::BTreeMap<usize, String> = Default::default();
        let mut claim = |slot: usize, entry: String| -> Result<(), Refused> {
            match writers.get(&slot) {
                Some(other) if *other != entry && !(other.starts_with("placements/") && entry.starts_with("placements/")) => Err(refused(other, &entry, slot)),
                _ => {
                    writers.entry(slot).or_insert(entry);
                    Ok(())
                }
            }
        };
        for (c, &(slot, width)) in self.channels.iter().enumerate() {
            for s in slot..slot + width {
                claim(s, format!("channels/{}", self.motion.channels[c].id))?;
            }
        }
        for (f, &slot) in self.follows.iter().enumerate() {
            claim(slot, format!("channels/{}", self.motion.follows[f].id))?;
        }
        for (p, writes) in self.placements.iter().enumerate() {
            for w in writes {
                for s in w.slot..w.slot + w.width {
                    claim(s, format!("placements/{}", self.motion.placements[p].id))?;
                }
            }
        }
        // A status binding owns its paint slot: nothing else writes it.
        for (id, binding) in doc.get("status_bindings").and_then(Value::as_object).into_iter().flatten() {
            let Some(target) = binding.get("target").and_then(Value::as_str) else { continue };
            for c in &self.motion.channels {
                if format!("items/{}/{}", c.target.owner, c.target.field.join("/")) == target {
                    return Err(refused(&format!("channels/{}", c.id), &format!("status_bindings/{id}"), self.channels.first().map_or(0, |c| c.0)));
                }
            }
        }
        let mut drivers: std::collections::BTreeMap<usize, &str> = Default::default();
        for (d, (slot, _)) in self.drivers.iter().enumerate() {
            let id = self.motion.drivers[d].id.as_str();
            if let Some(other) = drivers.insert(*slot, id) {
                return Err(refused(&format!("drivers/{other}"), &format!("drivers/{id}"), *slot));
            }
        }
        Ok(())
    }

    /// The world `<world ID>.occurrences` names, with whether it declares inputs.
    fn world_of(&self, list: &str) -> Option<&(String, bool)> {
        let id = list.strip_suffix(".occurrences")?;
        self.motion.worlds.iter().find(|w| w.0 == id)
    }

    /// The first input a remap's target reads, naming the read: on its drivers, its follow
    /// channels, or the target placement's influence, switch or `start_on`.
    fn input_read(&self, r: &crate::remap::Remap) -> Option<String> {
        let motion = &self.motion;
        let placement = motion.placements.iter().find(|p| p.id == r.target);
        let targets = |item: &str| match placement {
            Some(p) => p.bindings.iter().any(|b| b.item == item),
            None => motion.applies(r, item),
        };
        let drivers = motion.drivers.iter().filter(|d| targets(&d.target.owner)).find_map(|d| {
            d.inputs.iter().find_map(|(name, input)| {
                let source = match input {
                    doc::DriverInput::Control(c) => format!("controls/{c}"),
                    doc::DriverInput::List(f) if f.list.starts_with("input.") => f.list.clone(),
                    doc::DriverInput::List(f) if self.world_of(&f.list).is_some_and(|w| w.1) => format!("worlds/{}", f.list),
                    _ => return None,
                };
                Some(format!("drivers/{}/vars/{name} ({source})", d.id))
            })
        });
        let follows = || {
            let keyed = motion.channels.iter().filter(|c| targets(&c.target.owner)).find_map(|c| match &c.follow.as_ref()?.source {
                crate::follow::Source::Control(control) => Some(format!("channels/{} (controls/{control})", c.id)),
                crate::follow::Source::Keys(_) => None,
            });
            keyed.or_else(|| {
                let f = motion.follows.iter().find(|f| targets(&f.target.owner))?;
                Some(format!("channels/{} (controls/{})", f.id, motion.controls[f.control].id))
            })
        };
        let own = || {
            let p = placement?;
            let at = format!("placements/{}", p.id);
            if let doc::Influence::Control(control) = &p.blending.influence {
                return Some(format!("{at}/influence (controls/{control})"));
            }
            if let Some(s) = &p.blending.switch {
                return Some(format!("{at}/switch (controls/{})", s.control));
            }
            let start = p.timing.start_on.as_ref()?;
            let live = start.on.list.starts_with("input.") || self.world_of(&start.on.list).is_some_and(|w| w.1);
            live.then(|| format!("{at}/start_on ({})", start.on.list))
        };
        drivers.or_else(follows).or_else(own)
    }

    /// A remap whose child time can pass its parent's is refused when its target reads what
    /// doesn't exist yet: the input track, a control, a view input or a world that takes inputs.
    fn refuse_look_ahead(&self) -> Result<(), Refused> {
        for r in self.motion.remaps.iter().filter(|r| r.runs_ahead()) {
            if let Some(read) = self.input_read(r) {
                return Err(Refused {
                    code: "look_ahead_on_input",
                    path: format!("time_remaps/{}: {read}", r.id),
                    detail: Some(Box::new(json!({"remap": r.id, "read": read}))),
                });
            }
        }
        Ok(())
    }

    /// Each laid-out item's box at `doc_t` (#491): the document's layout, where a key on a frame's
    /// layout mixes each box between the layouts of the keys before and after by the key's
    /// interpolation, so a row glides into a grid; `None` without a layout solve.
    pub fn boxes(&self, doc_t: i64) -> Option<Boxes> {
        let (still, glides) = self.layout.as_ref()?;
        let mut out = still.clone();
        for (c, at_keys) in glides {
            let Some(glide) = &self.motion.channels[*c].glide else { continue };
            let mut u = [0.0];
            glide.sample_into(doc_t, &mut u);
            let Some(last) = at_keys.len().checked_sub(1) else { continue };
            let i = (u[0].floor().max(0.0) as usize).min(last);
            let s = u[0] - i as f64;
            let next = &at_keys[(i + 1).min(last)];
            for (id, from) in &at_keys[i] {
                let to = next.get(id).unwrap_or(from);
                out.insert(id.clone(), std::array::from_fn(|k| from[k] + (to[k] - from[k]) * s));
            }
        }
        Some(out)
    }

    /// Solves a `first` marker (#491): the first flick in [after, before] where its expression is
    /// at least 0, by bisection on the expression's interval form down to single flicks. Each
    /// var reads a slot one keyed channel writes, or nothing writes; one the forms can't settle
    /// within the budget, or a condition that never holds in the window, is refused, naming it.
    fn solve_first(&mut self, items: &Map<String, Value>, first: &doc::First) -> Result<doc::Marker, Refused> {
        let id = &first.marker.id;
        let refused = |code: &'static str, why: String| Refused {
            code,
            path: first.path.clone(),
            detail: Some(Box::new(json!({"marker": id, "why": why}))),
        };
        let expr = Expr::compile(&first.expr, &self.options.scope, DRIVER_OPS)
            .map_err(|r| refused("bad_doc", format!("{}: {}", r.call, r.why)))?;
        // What each var reads: the time, a channel, or a slot nothing writes.
        enum Src {
            Time,
            Channel(usize),
            Base(f64),
        }
        let mut reads: Vec<Src> = Vec::new();
        for name in &expr.vars {
            let Some((_, target)) = first.vars.iter().find(|(n, _)| n == name) else {
                return Err(refused("ref_unresolved", format!("`{name}` is not one of its vars")));
            };
            let Some(target) = target else {
                reads.push(Src::Time);
                continue;
            };
            let at = format!("{}/{}", target.owner, target.field.join("/"));
            let local = matches!(target.field.as_slice(), [a, g, k] if a == "at" && ["pos", "rot", "scale"].contains(&g.as_str()) && k.parse::<usize>().is_ok_and(|k| k < 3));
            if !local || !self.items.contains(&target.owner) {
                return Err(refused("first_unsettled", format!("`{name}` reads {at}: a first time reads an item's at/pos, at/rot or at/scale component")));
            }
            let slot = self.slot(items, &target.owner, target, 1);
            let by: Vec<usize> = (0..self.channels.len())
                .filter(|&c| {
                    let (at, width) = self.channels[c];
                    (at..at + width).contains(&slot)
                })
                .collect();
            let written_elsewhere = self.follows.contains(&slot)
                || self.placements.iter().flatten().any(|w| (w.slot..w.slot + w.width).contains(&slot))
                || self.motion.drivers.iter().any(|d| d.target == *target)
                || self.motion.limits.iter().any(|l| l.owner == target.owner)
                || self.motion.constraints.iter().any(|c| c.owner == target.owner);
            match by.as_slice() {
                [] if !written_elsewhere => reads.push(Src::Base(self.base[slot])),
                [c] if !written_elsewhere && self.channels[*c].1 == 1 && channel_bound(&self.motion.channels[*c]).is_some() => reads.push(Src::Channel(*c)),
                _ => return Err(refused("first_unsettled", format!("`{name}` reads {at}, which the forms can't bound over time"))),
            }
        }
        let start = self.motion.transport.start;
        let seconds = |t: i64| (t - start) as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64;
        let value = |c: usize, t: i64| {
            let channel = &self.motion.channels[c];
            let mut v = [0.0];
            channel.curve.sample_into(t, &mut v);
            channel.modifiers.iter().fold(v[0], |v, m| m.apply(v, t - start))
        };
        let point = |t: i64| {
            let vals: Vec<f64> = reads
                .iter()
                .map(|r| match *r {
                    Src::Time => seconds(t),
                    Src::Channel(c) => value(c, t),
                    Src::Base(b) => b,
                })
                .collect();
            expr.eval_num(&vals)
        };
        let over = |a: i64, b: i64| {
            let vals: Vec<Iv> = reads
                .iter()
                .map(|r| match *r {
                    Src::Time => {
                        let e = 4.0 * f64::EPSILON * seconds(a).abs().max(seconds(b).abs());
                        Iv::new(seconds(a) - e, seconds(b) + e)
                    }
                    Src::Channel(c) => channel_window(&self.motion.channels[c], a, b, value(c, a), value(c, b)),
                    Src::Base(base) => Iv::point(base),
                })
                .collect();
            expr.bound_num(&vals)
        };
        let mut stack = vec![(first.after, first.before)];
        let mut budget = 100_000u32;
        let found = loop {
            let Some((a, b)) = stack.pop() else { break None };
            let bound = over(a, b);
            if bound.hi < 0.0 {
                continue;
            }
            if bound.lo >= 0.0 {
                break Some(a);
            }
            if b - a <= 1 {
                if let Some(t) = [a, b].into_iter().find(|&t| point(t) >= 0.0) {
                    break Some(t);
                }
                continue;
            }
            budget = budget.checked_sub(1).ok_or_else(|| refused("first_unsettled", "the interval forms don't settle it within the check's budget".into()))?;
            let mid = a + (b - a) / 2;
            stack.push((mid + 1, b));
            stack.push((a, mid));
        };
        let Some(start) = found else {
            return Err(refused(
                "first_never",
                format!("markers/{id}: `{} >= 0` never holds in [{}, {}] flicks", first.expr, first.after, first.before),
            ));
        };
        Ok(doc::Marker {
            start,
            end: start + first.span,
            ..first.marker.clone()
        })
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
                        entries.sort_by_key(|e| e.key());
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
        self.quantize = feel.quantize;
        Some(self)
    }

    /// Marks the field at `slot` as a bool or an enum channel's, so it is written as one.
    fn mark_type(&mut self, slot: usize, ty: doc::ValueType) {
        if let Some(f) = self.fields.iter_mut().find(|f| f.slot == slot) {
            f.boolean |= ty == doc::ValueType::Bool;
            f.enumerated |= ty == doc::ValueType::Enum;
            // A rotation nothing authored rests at the identity.
            let run = &mut self.base[slot..slot + f.width];
            if ty == doc::ValueType::Quat && run.iter().all(|v| *v == 0.0) {
                run.copy_from_slice(&crate::quat::IDENTITY);
            }
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
        // A vec3 on a whole `at` vector writes the transform's own three slots, so a frame draws
        // it as it draws a component's.
        if let (Some(i), [at, name], 3) = (item, target.field.as_slice(), width) {
            if let (true, Some(g)) = (at == "at", ["pos", "rot", "scale"].iter().position(|n| n == name)) {
                return i * TRANSFORM + 3 * g;
            }
        }
        if let (Some(i), [at, name, k]) = (item, target.field.as_slice()) {
            let group = ["pos", "rot", "scale"].iter().position(|n| n == name);
            if let (true, Some(g), Ok(k)) = (at == "at", group, k.parse::<usize>()) {
                if k < 3 && width == 1 {
                    return i * TRANSFORM + 3 * g + k;
                }
            }
        }
        let data = owner.strip_prefix("data/").map(str::to_string);
        if let Some(f) = self
            .fields
            .iter()
            .find(|f| f.item == item && f.path == target.field && f.data == data)
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
            data,
            shape: None,
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
            degenerate: vec![false; self.constraints.len()],
            nested: false,
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
        // The look's quantize steps the document's time first; a document remap comes next, and
        // the clock's `valid_until` still counts from the timeline's own position.
        let shown = self.quantize.map_or(doc_t, |rate| crate::eval::grid(doc_t, rate));
        let timeline = self.timeline(doc_t);
        for (p, placement) in motion.placements.iter().enumerate() {
            state.locals[p] = placement.local(motion, timeline);
        }
        let mut scratch = [0.0; 4];
        for step in &self.order {
            match *step {
                Step::Channel(c) => {
                    let channel = &motion.channels[c];
                    let (slot, width) = self.channels[c];
                    let run = &mut state.values[self.values[c]..self.values[c] + width];
                    // A channel on an item a time remap targets reads the item's own time.
                    let doc_t = if motion.remaps.is_empty() {
                        shown
                    } else {
                        motion.item_time(&channel.target.owner, shown)
                    };
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
                        state.iterations[c] = channel.curve.sample_into(channel.stepped(doc_t), run);
                    }
                    for m in &channel.modifiers {
                        run[0] = m.apply(run[0], doc_t - motion.transport.start);
                        if self.options.planted == Planted::PulseLeavesResidue {
                            if let crate::modifier::Kind::Pulse { at, span, .. } = m.kind {
                                if doc_t - motion.transport.start >= at + span {
                                    run[0] += 1e-6;
                                }
                            }
                        }
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
                    let at = if self.options.planted == Planted::PlacementF32Seconds {
                        let seconds = (timeline as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64) as f32;
                        (f64::from(seconds) * deep_canvas::grammar::FLICKS_PER_SECOND as f64) as i64
                    } else {
                        timeline
                    };
                    let channel = &clip.channels[w.channel];
                    let run = &mut scratch[..w.width.min(4)];
                    if self.options.planted == Planted::UnkeyedResetsToBase && placement.local_after(motion, at, w.delay).is_some() {
                        for other in self.placements.iter().flatten().filter(|o| o.slot != w.slot) {
                            state.slots[other.slot..other.slot + other.width].copy_from_slice(&self.base[other.slot..other.slot + other.width]);
                        }
                    }
                    let slots = &mut state.slots[w.slot..w.slot + run.len()];
                    let mut land = |local: i64, start: i64| {
                        channel.read(local, run);
                        let weight = self.weight(p, start, timeline);
                        crate::blend::over(placement.blending.blend, channel.ty, self.options.planted.arc(), weight, run, &w.reference[..run.len()], slots);
                    };
                    let mut overlaps = false;
                    for start in placement.overlapping(motion, at, w.delay) {
                        land(placement.local_in_run(motion, at, start).local, start);
                        overlaps = true;
                    }
                    if !overlaps {
                        let Some(l) = placement.local_after(motion, at, w.delay) else {
                            continue;
                        };
                        land(l.local, placement.run_start(at, w.delay).unwrap_or(placement.start + w.delay));
                    }
                    let run = &scratch[..w.width.min(4)];
                    note(
                        &Event::Placement(p, w.slot..w.slot + run.len()),
                        &[],
                        &state.slots,
                    );
                }
                Step::Mix(m) => {
                    let mix = &self.mixes[m];
                    let base = &self.base[mix.slot..mix.slot + mix.width];
                    let sum = &mut state.slots[mix.slot..mix.slot + mix.width];
                    sum.copy_from_slice(base);
                    let mut moved = false;
                    for &(p, w) in &mix.members {
                        let placement = &motion.placements[p];
                        let w = &self.placements[p][w];
                        let Some(clip) = motion.clip(&placement.clip) else {
                            continue;
                        };
                        let mut land = |local: i64, start: i64| {
                            let weight = self.weight(p, start, timeline);
                            if weight != 0.0 {
                                let run = &mut scratch[..mix.width];
                                clip.channels[w.channel].read(local, run);
                                crate::blend::mix_in(mix.turns, weight, run, base, sum);
                                moved = true;
                            }
                        };
                        let mut overlaps = false;
                        for start in placement.overlapping(motion, timeline, w.delay) {
                            land(placement.local_in_run(motion, timeline, start).local, start);
                            overlaps = true;
                        }
                        if !overlaps {
                            if let Some(l) = placement.local_after(motion, timeline, w.delay) {
                                land(l.local, placement.run_start(timeline, w.delay).unwrap_or(placement.start + w.delay));
                            }
                        }
                    }
                    if moved && mix.turns {
                        sum.copy_from_slice(&crate::quat::normalized(crate::quat::of(sum)));
                    }
                    note(&Event::Mix(m), &[], &state.slots);
                }
                Step::Driver(d) => {
                    let (slot, ops) = &self.drivers[d];
                    // A lag's earlier chain skips the drivers that lag themselves: none writes a slot a lag reads.
                    if state.nested
                        && matches!(ops.as_slice(), [Op::Core(i)] if self.cores[*i].inputs.iter().any(|x| matches!(x, CoreInput::Lag(..))))
                    {
                        continue;
                    }
                    let slots = &state.slots;
                    let value = match ops.as_slice() {
                        [Op::Core(i)] => self.evaluate_core(*i, slots, doc_t, t, validity),
                        _ => evaluate_ops(ops, slots, |i, k| self.world(slots, i)[k]),
                    };
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
                    state.degenerate[k] = self.aims_nowhere(k, &state.slots);
                    state.reports[self.limits.len() + k] = self.constrain(k, &mut state.slots);
                }
            }
        }
        state.valid_until = self.next_change(t, doc_t, validity, Default::default());
    }

    /// The earliest `t` after a frame at `t` (timeline position `doc_t`) at which what `counts`
    /// keeps, or the input track, changes next.
    fn next_change(
        &self,
        t: i64,
        doc_t: i64,
        validity: Validity,
        counts: crate::eval::Counts<'_>,
    ) -> Option<i64> {
        let shown = self
            .quantize
            .map_or(doc_t, |rate| crate::eval::grid(doc_t, rate));
        let timeline = crate::eval::valid_until(&self.motion, t, shown, validity, counts);
        // Under the look's steps a change shows only on the next step.
        let timeline = match self.quantize {
            Some(rate) => timeline.map(|n| n.max(crate::eval::next_grid(doc_t, rate) + t - doc_t)),
            None => timeline,
        };
        match (timeline, self.inputs.next_change(t)) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }

    /// #1487: the `valid_until` of the frame `state` holds, counting only items a view shows
    /// (Frame clock and scheduler: "A document's `valid_until` takes only items whose bounds meet
    /// the view"). `meets` says whether an item's bounds meet the view; it answers true for an
    /// item it can't bound. An item out of view still counts when it can move into view (by a
    /// channel, driver or constraint on anything but its own rotation or paint, or a turn that
    /// carries children), and when the driver of an item that counts reads it. The evaluation
    /// is unchanged; only the time the clock next arms is.
    pub fn valid_until_in_view(
        &self,
        state: &State,
        validity: Validity,
        meets: impl Fn(&str) -> bool,
    ) -> Option<i64> {
        let motion = &self.motion;
        // A rotation about the item's own origin or a paint keeps it within the bounds a view
        // reads for it, unless it carries children with it.
        let parents: BTreeSet<&str> = motion.parents.iter().map(|(_, p)| p.as_str()).collect();
        let stays = |owner: &str, field: &[String]| {
            let rotation = field.len() >= 2 && field[0] == "at" && field[1] == "rot";
            let paint = field.len() >= 2 && field[0] == "params" && field[1] == "paint";
            paint || (rotation && !parents.contains(owner))
        };
        let mut kept: BTreeSet<&str> = self
            .items
            .iter()
            .map(String::as_str)
            .filter(|i| meets(i))
            .collect();
        for c in &motion.channels {
            if !stays(&c.target.owner, &c.target.field) {
                kept.insert(&c.target.owner);
            }
        }
        for p in &motion.placements {
            let clip = motion.clip(&p.clip);
            for b in &p.bindings {
                let moves = clip.is_some_and(|c| {
                    c.channels
                        .iter()
                        .filter(|ch| ch.target.owner == b.slot)
                        .any(|ch| !stays(&b.item, &ch.target.field))
                });
                if moves {
                    kept.insert(&b.item);
                }
            }
        }
        for d in &motion.drivers {
            if !stays(&d.target.owner, &d.target.field) {
                kept.insert(&d.target.owner);
            }
        }
        // A constraint moves its owner by what it reads.
        for k in &motion.constraints {
            kept.insert(&k.owner);
            kept.extend(k.kind.reads());
        }
        // What a counted item's drivers read counts, and what those read, until nothing is added.
        loop {
            let before = kept.len();
            for d in &motion.drivers {
                if kept.contains(d.target.owner.as_str()) {
                    kept.extend(d.vars.iter().map(|(_, v)| v.owner.as_str()));
                }
            }
            if kept.len() == before {
                break;
            }
        }
        let counts = |owner: &str| kept.contains(owner) || !self.items.iter().any(|i| i == owner);
        let channels: Vec<bool> = motion
            .channels
            .iter()
            .map(|c| counts(&c.target.owner))
            .collect();
        let placements: Vec<bool> = motion
            .placements
            .iter()
            .map(|p| p.bindings.iter().any(|b| counts(&b.item)))
            .collect();
        let counts = crate::eval::Counts {
            channels: Some(&channels),
            placements: Some(&placements),
        };
        self.next_change(state.t, state.doc_t, validity, counts)
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
                // #494: an item's own path draws as its `d`; a vector import draws as a path too.
                if let (Some(structure), true) = (&f.shape, f.path == ["path"]) {
                    let d = crate::morph::d_of(&crate::morph::unflat(run, structure));
                    return (vec!["params".to_string(), "d".to_string()], Datum::Text(d));
                }
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
/// Each value a segment from key `a` to `b` reaches inside it, component `comp`, beside its
/// keys' own: a spring's peaks and where it stands at the next key, a Bézier's extremes, and an
/// ease's, from its interval form; each with what reaches it.
fn segment_reach(a: &Key, b: &Key, comp: usize) -> Vec<(f64, String)> {
    use crate::curve::{Bezier, Interp};
    let (va, vb) = (a.value[comp], b.value[comp]);
    let span = (b.t - a.t) as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64;
    let mut out = Vec::new();
    match a.interp {
        Interp::Spring(spring) => {
            let v0 = a.velocity.get(comp).copied().unwrap_or(0.0);
            for t in spring.extremes(va - vb, v0, span).into_iter().flatten() {
                out.push((vb + spring.at(va - vb, v0, t).e, format!("its spring peaks at {{}} {t} s after the key")));
            }
            out.push((vb + spring.at(va - vb, v0, span).e, "its spring reaches {} by the next key".into()));
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
                out.push((va + (vb - va) * bz.y(s), "its Bézier reaches {}".into()));
            }
        }
        _ => {
            // An ease's share of the change from its interval form; a share of exactly 0 or 1
            // is a key's own value, and any other is widened by the mix's rounding.
            if let Some((lo, hi)) = a.ease_extremes() {
                for share in [lo, hi] {
                    if share == 0.0 || share == 1.0 {
                        continue;
                    }
                    let v = va + (vb - va) * share;
                    let what = "its ease reaches {}";
                    out.push((deep_canvas::interval::down(v, 2), what.into()));
                    out.push((deep_canvas::interval::up(v, 2), what.into()));
                }
            }
        }
    }
    out
}

fn range_check(c: &doc::Channel) -> Result<(), Refused> {
    let Some((lo, hi)) = c.range else { return Ok(()) };
    let keys = &c.curve.keys;
    let out = |v: f64| v < lo || v > hi;
    let refuse = |key: &str, what: String| Refused {
        code: "out_of_range",
        path: format!("channels/{}/keys/{key}: {what}, outside the range [{lo}, {hi}]", c.id),
        detail: None,
    };
    for (i, a) in keys.iter().enumerate() {
        if let Some(v) = a.value.iter().find(|v| out(**v)) {
            return Err(refuse(&a.id, format!("its value {v}")));
        }
        let Some(b) = keys.get(i + 1) else { continue };
        for comp in 0..a.value.len() {
            for (v, what) in segment_reach(a, b, comp) {
                if out(v) {
                    return Err(refuse(&a.id, what.replacen("{}", &v.to_string(), 1)));
                }
            }
        }
    }
    Ok(())
}

/// The bound a channel's value keeps over its whole timeline: its keys' values and what each
/// segment reaches inside, widened by its modifiers' reach; `None` where the forms don't settle
/// it (a follow channel, or a curve extrapolated past its keys other than by holding).
pub fn channel_bound(c: &doc::Channel) -> Option<(f64, f64)> {
    use crate::curve::Extrapolate;
    let keys = &c.curve.keys;
    if c.follow.is_some() || keys.is_empty() || c.curve.before != Extrapolate::Hold || c.curve.after != Extrapolate::Hold {
        return None;
    }
    // A Catmull-Rom or an unclamped auto segment overshoots its keys by a reach no form
    // bounds yet: the channel's bound is an estimate.
    use crate::curve::Interp;
    if keys.iter().any(|k| matches!(k.interp, Interp::CatmullRom | Interp::Auto { clamp: false, .. })) {
        return None;
    }
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    let mut take = |v: f64| {
        lo = lo.min(v);
        hi = hi.max(v);
    };
    for (i, a) in keys.iter().enumerate() {
        a.value.iter().for_each(|v| take(*v));
        if let Some(b) = keys.get(i + 1) {
            for comp in 0..a.value.len() {
                segment_reach(a, b, comp).into_iter().for_each(|(v, _)| take(v));
            }
        }
    }
    for m in &c.modifiers {
        (lo, hi) = m.bound(lo, hi);
    }
    (lo.is_finite() && hi.is_finite()).then_some((lo, hi))
}

/// The document's auto layout, and for each channel keying a frame's layout, the layout at each
/// key, solved with that key's value in place.
fn layouts(doc: &Map<String, Value>, motion: &Motion, solve: Layout) -> Result<(Boxes, Glides), Refused> {
    let run = |doc: Value| {
        solve.0(&doc).map_err(|(code, item)| Refused {
            code: "layout_refused",
            path: format!("items/{item}"),
            detail: Some(Box::new(json!({"why": code, "item": item}))),
        })
    };
    let still = run(Value::Object(doc.clone()))?;
    let mut glides = Vec::new();
    for (c, channel) in motion.channels.iter().enumerate() {
        let Some(glide) = &channel.glide else { continue };
        let mut at_keys = Vec::new();
        for key in &glide.keys {
            let label = channel
                .curve
                .keys
                .iter()
                .find(|k| k.id == key.id)
                .and_then(|k| motion.labels.get(k.value[0] as usize))
                .cloned()
                .unwrap_or_default();
            let mut with = Value::Object(doc.clone());
            match with.pointer_mut(&format!("/items/{}/params", channel.target.owner)) {
                Some(Value::Object(params)) => {
                    params.insert("layout".into(), Value::String(label));
                }
                _ => {
                    return Err(Refused {
                        code: "ref_unresolved",
                        path: format!("channels/{}/target", channel.id),
                        detail: None,
                    })
                }
            }
            at_keys.push(run(with)?);
        }
        glides.push((c, at_keys));
    }
    Ok((still, glides))
}

/// A keyed channel's bound over the flicks [a, b], given its values there: those and every key
/// inside, every value a segment that overlaps the window reaches, widened by its modifiers.
/// Only for a channel [`channel_bound`] settles.
fn channel_window(c: &doc::Channel, a: i64, b: i64, at_a: f64, at_b: f64) -> Iv {
    let keys = &c.curve.keys;
    let (mut lo, mut hi) = (at_a.min(at_b), at_a.max(at_b));
    for (i, k) in keys.iter().enumerate() {
        if (a..=b).contains(&k.t) {
            (lo, hi) = (lo.min(k.value[0]), hi.max(k.value[0]));
        }
        if let Some(next) = keys.get(i + 1).filter(|n| k.t < b && n.t > a) {
            for (v, _) in segment_reach(k, next, 0) {
                (lo, hi) = (lo.min(v), hi.max(v));
            }
        }
    }
    for m in &c.modifiers {
        (lo, hi) = m.bound(lo, hi);
    }
    // Widened past the f64 rounding of the values it was taken from.
    let e = lo.abs().max(hi.abs()) * 4.0 * f64::EPSILON;
    Iv::new(lo - e, hi + e)
}

/// Opens each key's ease through `ease@1` (#490): a pack's ease table resolved from the
/// document's packs, and the planted programs that read params or numbers wrongly.
fn open_eases(motion: &mut Motion, options: &Options) -> Result<(), Refused> {
    use crate::curve::Interp;
    use deep_canvas::ease::{Family, Named};
    let mut channels: Vec<&mut doc::Channel> = motion.channels.iter_mut().collect();
    for clip in &mut motion.clips {
        channels.extend(clip.channels.iter_mut());
    }
    for c in channels {
        for k in &mut c.curve.keys {
            if let Some((name, table)) = &mut k.table {
                match options.scope.eases.get(name.as_str()) {
                    Some(t) => *table = Some(Arc::new(t.clone())),
                    None => {
                        return Err(Refused {
                            code: "ref_unresolved",
                            path: format!("channels/{}/keys/{}/interp/ease/table", c.id, k.id),
                            detail: Some(Box::new(json!({"table": name, "why": "no pack gives this ease table"}))),
                        })
                    }
                }
            }
            if let Interp::Ease(e) = &mut k.interp {
                if options.planted == Planted::BackIgnoresParams {
                    if let Named::Penner(Family::Back(c), _) = &mut e.ease {
                        *c = deep_canvas::ease::BACK_OVERSHOOT;
                    }
                }
                if options.planted == Planted::EaseRenumbered {
                    e.number = deep_canvas::ease::renumbered(e.number);
                }
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
    /// Whether constraint `k` is a `look_at` whose aim has no heading.
    fn aims_nowhere(&self, k: usize, slots: &[f64]) -> bool {
        let c = &self.constraints[k];
        let (doc::Kind::LookAt { .. }, Some((i, group))) = (&self.motion.constraints[k].kind, c.other) else {
            return false;
        };
        let other = match group {
            None => pose(&self.world(slots, i), 0),
            Some(_) => pose(slots, i * TRANSFORM),
        };
        crate::constraint::aimless(&pose(slots, c.owner * TRANSFORM), other.pos)
    }

    /// The timeline position placements read at `doc_t`: the look's quantize, then a document
    /// remap.
    pub fn timeline(&self, doc_t: i64) -> i64 {
        let shown = self.quantize.map_or(doc_t, |rate| crate::eval::grid(doc_t, rate));
        self.motion.document_time(shown)
    }

    /// The export frame `doc_t` falls in: start + k × Δ, floored, in exact flicks.
    pub fn frame_index(&self, doc_t: i64) -> i64 {
        let (p, q) = self.motion.frame_rate;
        let d = i128::from(doc_t - self.motion.transport.start) * i128::from(p);
        d.div_euclid(i128::from(deep_canvas::grammar::FLICKS_PER_SECOND) * i128::from(q)) as i64
    }

    /// What remap `r` reads as parent time at `doc_t`: its placement's local time before the
    /// remap, or the timeline's from the transport's start.
    pub fn remap_parent(&self, r: usize, doc_t: i64) -> i64 {
        let motion = &self.motion;
        let at = self.timeline(doc_t);
        match motion.placements.iter().find(|p| p.timing.remap == Some(r)) {
            Some(p) => p.parent_time(motion, at),
            None => at - motion.transport.start,
        }
    }

    /// Channel `c`'s first component's rate per second at `doc_t`, a remapped item's by its
    /// remaps' derivatives.
    fn channel_rate(&self, c: usize, doc_t: i64) -> f64 {
        let channel = &self.motion.channels[c];
        let motion = &self.motion;
        let start = motion.transport.start;
        let shown = self.quantize.map_or(doc_t, |rate| crate::eval::grid(doc_t, rate));
        let mut t = shown;
        let mut scale = 1.0;
        for r in motion.remaps.iter().filter(|r| motion.applies(r, &channel.target.owner)) {
            scale *= r.rate(t - start);
            t = start + r.child(t - start);
        }
        let mut out = [0.0; 4];
        let width = self.channels[c].1.min(4);
        channel.rate(t, &mut out[..width]);
        out[0] * scale
    }

    /// Placement `p`'s first target's rate per second, per clip channel: the segment's derivative
    /// times the placement's rate times the remap's derivative.
    pub fn placement_rates(&self, p: usize, doc_t: i64) -> Vec<(String, Vec<f64>)> {
        let placement = &self.motion.placements[p];
        let Some(clip) = self.motion.clip(&placement.clip) else {
            return Vec::new();
        };
        let at = self.timeline(doc_t);
        let delay = placement.bindings.first().map_or(0, |b| b.delay);
        let (local, scale) = match placement.local_after(&self.motion, at, delay) {
            Some(l) => (l.local, placement.rate_after(&self.motion, at, delay)),
            None => (0, 0.0),
        };
        clip.channels
            .iter()
            .map(|c| {
                let mut out = vec![0.0; c.curve.keys.first().map_or(1, |k| k.value.len())];
                c.rate(local, &mut out);
                out.iter_mut().for_each(|v| *v *= scale);
                (c.id.clone(), out)
            })
            .collect()
    }

    /// Placement `p`'s weight at timeline position `at`, in its run from `start`: its influence by
    /// its switch and its fades.
    fn weight(&self, p: usize, start: i64, at: i64) -> f64 {
        let placement = &self.motion.placements[p];
        let b = &placement.blending;
        let influence = match &b.influence {
            doc::Influence::Value(v) => *v,
            doc::Influence::Keys(curve) => {
                let mut v = [0.0];
                curve.sample_into(at, &mut v);
                v[0]
            }
            doc::Influence::Control(control) => {
                let last = self.options.input.iter().filter(|e| e.control == *control && e.t <= at).max_by_key(|e| e.key());
                last.and_then(|e| e.value.as_f64()).unwrap_or_else(|| {
                    self.motion.control_defaults.iter().find(|(id, _)| id == control).map_or(0.0, |c| c.1)
                })
            }
        };
        let influence = b.switch.as_ref().map_or(influence, |s| influence * s.weight(at));
        if b.fade_in == 0 && b.fade_out == 0 {
            return influence;
        }
        let end = start + placement.active_span(&self.motion);
        let ramp = |d: i64, span: i64| if span == 0 { 1.0 } else { (d as f64 / span as f64).clamp(0.0, 1.0) };
        influence * ramp(at - start, b.fade_in) * ramp(end - at, b.fade_out)
    }

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
        // Mixes first on their paths, so replace, add and multiply apply over them.
        for (m, mix) in self.mixes.iter().enumerate() {
            let entry = format!("placements/{}", self.motion.placements[mix.members[0].0].id);
            push(Step::Mix(m), Node { entry, item: self.item_of(mix.slot), stage: Stage::Channels, reads: vec![], writes: (mix.slot..mix.slot + mix.width).collect() });
        }
        for (c, &(slot, width)) in self.channels.iter().enumerate() {
            let entry = format!("channels/{}", self.motion.channels[c].id);
            push(Step::Channel(c), Node { entry, item: self.item_of(slot), stage: Stage::Channels, reads: vec![], writes: (slot..slot + width).collect() });
        }
        // The other blends by writer layer, then order, then time: never by how the document
        // happens to list them.
        let mut ranked: Vec<usize> = (0..self.placements.len()).collect();
        ranked.sort_by_key(|&p| {
            let placement = &self.motion.placements[p];
            (&placement.rank, placement.start, &placement.id)
        });
        for p in ranked {
            let writes = &self.placements[p];
            if self.motion.placements[p].blending.blend == doc::Blend::Mix {
                continue;
            }
            for (w, write) in writes.iter().enumerate() {
                let entry = format!("placements/{}", self.motion.placements[p].id);
                let slots = (write.slot..write.slot + write.width.min(4)).collect();
                push(Step::Write(p, w), Node { entry, item: self.item_of(write.slot), stage: Stage::Channels, reads: vec![], writes: slots });
            }
        }
        for (d, (slot, ops)) in self.drivers.iter().enumerate() {
            let reads = ops
                .iter()
                .flat_map(|op| match op {
                    Op::Var(s) => vec![*s],
                    Op::World(i, _) => self.world_slots(*i),
                    Op::Core(c) => self.cores[*c]
                        .inputs
                        .iter()
                        .flat_map(|input| match input {
                            CoreInput::Slot(s) => vec![*s],
                            CoreInput::World(i, _) => self.world_slots(*i),
                            _ => vec![],
                        })
                        .collect(),
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
                .join(" → "), detail: None })?;
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

    /// A driver past the six functions, compiled through the core's closed function list over
    /// its vars, its hard range checked against its bound.
    fn core_driver(
        &self,
        doc: &Map<String, Value>,
        driver: &doc::Driver,
        vars: &[(&str, Var)],
        path: &str,
    ) -> Result<Core, Refused> {
        let mut scope = self.options.scope.clone();
        let controls = doc.get("controls").and_then(Value::as_object);
        let mut inputs_of: Vec<(&str, CoreInput)> = vars
            .iter()
            .map(|(n, v)| {
                (*n, match *v {
                    Var::Slot(s) => CoreInput::Slot(s),
                    Var::World(i, k) => CoreInput::World(i, k),
                })
            })
            .collect();
        let lists: Vec<&str> = driver
            .inputs
            .iter()
            .filter(|(_, i)| matches!(i, doc::DriverInput::List(_)))
            .map(|(n, _)| n.as_str())
            .collect();
        let refused = |code: &'static str, why: String| Refused {
            code,
            path: format!("{path}/expr"),
            detail: Some(Box::new(json!({"driver": driver.id, "why": why}))),
        };
        let frame_rate = doc
            .get("transport")
            .and_then(|t| t.get("frame_rate"))
            .and_then(Value::as_array)
            .and_then(|r| Some((r.first()?.as_u64()? as u32, r.get(1)?.as_u64()? as u32)))
            .unwrap_or_default();
        let time = deep_canvas::grammar::TimeContext { frame_rate, ..Default::default() };
        let (text, lagged) = crate::lag::rewrite(&driver.text, &time).map_err(|r| refused(r.code, r.why))?;
        let (text, found) = crate::occurrence::rewrite(&text, &lists).map_err(|r| refused(r.code, r.why))?;
        for f in &found {
            let Some((_, doc::DriverInput::List(filter))) = driver.inputs.iter().find(|(n, _)| *n == f.list) else {
                continue;
            };
            let entries = self.occurrences(filter, controls).ok_or_else(|| Refused {
                code: "ref_unresolved",
                path: format!("{path}/vars/{}/list", f.list),
                detail: Some(Box::new(json!({"driver": driver.id, "list": filter.list}))),
            })?;
            // Occurrences read on the driver's clock, from the transport's start as `time` reads.
            let start = self.motion.transport.start;
            let entries = entries
                .into_iter()
                .map(|o| crate::occurrence::Occurrence {
                    t: o.t.saturating_sub(start),
                    end: o.end.saturating_sub(start),
                    ..o
                })
                .collect();
            // Inputs after t don't exist yet, so nothing looks ahead on a list they feed.
            if f.function == "next" && filter.list.starts_with("input.") {
                return Err(refused(
                    "look_ahead_on_input",
                    format!("drivers/{}: next({}) looks ahead on {}, which the input track feeds", driver.id, f.list, filter.list),
                ));
            }
            let list = crate::occurrence::filtered(filter, entries).map_err(|r| refused(r.code, r.why))?;
            let read = crate::occurrence::read_of(f, &list).map_err(|r| refused(r.code, r.why))?;
            if read.needs_fallback() && driver.fallback.is_none() {
                return Err(refused("fallback_missing", format!("drivers/{}: {}({}) has no match before its first, so the driver needs a fallback", driver.id, f.function, f.list)));
            }
            inputs_of.push((f.name.as_str(), CoreInput::Occurrence(Arc::new(read))));
        }
        for (name, input) in &driver.inputs {
            let input = match input {
                doc::DriverInput::List(_) => continue,
                doc::DriverInput::Array(array) => {
                    // #497: a stepping module's array has no steps after t yet, as the input
                    // track has no entries after t, so a lag or smooth that looks ahead through it
                    // is refused; motion's evaluation reads no module's array at any time.
                    if lagged.iter().any(|l| l.var == *name && l.dt < 0) {
                        return Err(refused("look_ahead_on_array", format!("lag({name}) looks ahead through the array `{array}`, which a stepping module writes step by step")));
                    }
                    return Err(Refused {
                        code: "ref_unresolved",
                        path: format!("{path}/vars/{name}"),
                        detail: Some(Box::new(json!({"driver": driver.id, "array": array, "why": "motion's drivers read no canvas module's array"}))),
                    });
                }
                doc::DriverInput::Time => CoreInput::Time,
                doc::DriverInput::Rate(id) => {
                    let Some(c) = self.motion.channels.iter().position(|c| c.id == *id) else {
                        return Err(Refused { code: "ref_unresolved", path: format!("{path}/vars/{name}"), detail: None });
                    };
                    CoreInput::Rate(c)
                }
                doc::DriverInput::Remap(id, progress) => {
                    let Some(r) = self.motion.remaps.iter().position(|r| r.id == *id) else {
                        return Err(Refused { code: "ref_unresolved", path: format!("{path}/vars/{name}"), detail: None });
                    };
                    CoreInput::Remap(r, *progress)
                }
                doc::DriverInput::Control(id) => {
                    let c = controls.and_then(|c| c.get(id));
                    let range = c.and_then(|c| c.get("range")).and_then(Value::as_array);
                    let (Some(c), Some([lo, hi])) = (c, range.map(Vec::as_slice)) else {
                        return Err(Refused {
                            code: "ref_unresolved",
                            path: format!("{path}/vars/{name}"),
                            detail: None,
                        });
                    };
                    let (lo, hi) = (lo.as_f64().unwrap_or(0.0), hi.as_f64().unwrap_or(0.0));
                    // A range written high to low holds no value.
                    if lo > hi {
                        return Err(Refused { code: "out_of_range", path: format!("controls/{id}/range"), detail: None });
                    }
                    scope.maxes.insert(name.clone(), hi);
                    let mut track: Vec<&Entry> = self.options.input.iter().filter(|e| e.control == *id).collect();
                    track.sort_by_key(|e| e.key());
                    let entries: Vec<(i64, i64, f64)> =
                        track.into_iter().filter_map(|e| Some((e.t, e.seq, e.value.as_f64()?))).collect();
                    CoreInput::Control {
                        entries,
                        default: c.get("default").and_then(Value::as_f64).unwrap_or(lo),
                        range: (lo, hi),
                    }
                }
            };
            inputs_of.push((name.as_str(), input));
        }
        for l in &lagged {
            let Some((_, input)) = inputs_of.iter().find(|(n, _)| *n == l.var) else {
                return Err(refused(
                    "ref_unresolved",
                    format!("lag reads `{}`, which is not one of its vars", l.var),
                ));
            };
            let input = match input {
                CoreInput::Control { .. } if l.dt < 0 => {
                    let id = driver.inputs.iter().find_map(|(n, i)| match i {
                        doc::DriverInput::Control(c) if *n == l.var => Some(c.as_str()),
                        _ => None,
                    });
                    return Err(refused("look_ahead_on_control", format!("lag({}) looks ahead through the control `{}`, which the input track feeds", l.var, id.unwrap_or_default())));
                }
                CoreInput::Slot(_) | CoreInput::Time | CoreInput::Control { .. } => input.clone(),
                _ => return Err(refused("lag_unsupported", format!("lag({}) reads a number, bound value, list or live simulation, which draws once", l.var))),
            };
            inputs_of.push((l.name.as_str(), CoreInput::Lag(Box::new(input), l.dt)));
        }
        if self.options.planted == Planted::TableFormSamples8 {
            scope.planted = Some(deep_canvas::expr::Planted::TableFormSamples8);
        }
        if self.options.planted == Planted::CellsSeededFromT {
            scope.planted = Some(deep_canvas::expr::Planted::CellsSeededFromT);
            if !inputs_of.iter().any(|(n, _)| *n == "t") {
                inputs_of.push(("t", CoreInput::Time));
            }
        }
        let expr = Expr::compile(&text, &scope, DRIVER_OPS).map_err(|r| Refused {
            code: "bad_doc",
            path: format!("{path}/expr"),
            detail: Some(Box::new(json!({"call": r.call, "why": r.why}))),
        })?;
        let mut inputs = Vec::new();
        for name in &expr.vars {
            let Some((_, input)) = inputs_of.iter().find(|(n, _)| n == name) else {
                return Err(Refused {
                    code: "ref_unresolved",
                    path: format!("{path}/expr"),
                    detail: Some(Box::new(json!({"name": name}))),
                });
            };
            inputs.push(input.clone());
        }
        let core = Core {
            expr: Arc::new(expr),
            inputs,
            fallback: driver.fallback,
        };
        if let Some((lo, hi)) = driver.range {
            let b = self.core_bound(&core);
            if !(b.lo >= lo && b.hi <= hi) {
                return Err(Refused {
                    code: "out_of_range",
                    path: format!(
                        "{path}: its bound [{}, {}] leaves the range [{lo}, {hi}]",
                        b.lo, b.hi
                    ),
                    detail: Some(Box::new(json!({"driver": driver.id, "bound": [b.lo, b.hi]}))),
                });
            }
        }
        Ok(core)
    }

    /// A core driver's value over the slots at `doc_t`.
    fn evaluate_core(
        &self,
        c: usize,
        slots: &[f64],
        doc_t: i64,
        t_run: i64,
        validity: Validity,
    ) -> f64 {
        let core = &self.cores[c];
        // The document's time from the transport's start, held to its span, the range its
        // bound reads.
        let transport = &self.motion.transport;
        let t = doc_t
            .saturating_sub(transport.start)
            .clamp(0, transport.span.unwrap_or(i64::MAX));
        let mut vals = [0.0f64; DRIVER_OPS];
        // Each time a lag reaches, evaluated once: the program again at t − dt, nothing kept.
        let mut earlier: Vec<(i64, State)> = Vec::new();
        for (v, input) in vals.iter_mut().zip(&core.inputs) {
            *v = match input {
                CoreInput::Lag(inner, dt) => match &**inner {
                    CoreInput::Slot(s) => {
                        let i = match earlier.iter().position(|e| e.0 == *dt) {
                            Some(i) => i,
                            None => {
                                let mut state = self.state();
                                state.nested = true;
                                self.run(t_run - dt, validity, &mut state, |_, _, _| {});
                                earlier.push((*dt, state));
                                earlier.len() - 1
                            }
                        };
                        earlier[i].1.slots[*s]
                    }
                    CoreInput::Time => {
                        let at = (doc_t - dt)
                            .saturating_sub(transport.start)
                            .clamp(0, transport.span.unwrap_or(i64::MAX));
                        at as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64
                    }
                    CoreInput::Control {
                        entries,
                        default,
                        range,
                    } => {
                        let at = doc_t - dt;
                        let i = entries.partition_point(|e| e.0 <= at);
                        i.checked_sub(1)
                            .map_or(*default, |i| entries[i].2)
                            .clamp(range.0, range.1)
                    }
                    _ => f64::NAN,
                },
                CoreInput::Occurrence(read) => match read.at(t) {
                    Some(v) => v,
                    None => return core.fallback.unwrap_or(f64::NAN),
                },
                CoreInput::Slot(s) => slots[*s],
                CoreInput::World(i, k) => self.world(slots, *i)[*k],
                CoreInput::Time => t as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64,
                CoreInput::Rate(c) => self.channel_rate(*c, doc_t),
                CoreInput::Remap(r, progress) => {
                    let parent = self.remap_parent(*r, doc_t);
                    let remap = &self.motion.remaps[*r];
                    if *progress {
                        remap.progress(parent)
                    } else {
                        f64::from(u8::from(remap.active(parent)))
                    }
                }
                // A control's value, held to its declared range.
                CoreInput::Control {
                    entries,
                    default,
                    range,
                } => {
                    let i = entries.partition_point(|e| e.0 <= doc_t);
                    let v = i.checked_sub(1).map_or(*default, |i| entries[i].2);
                    v.clamp(range.0, range.1)
                }
            };
        }
        let v = core.expr.eval_num(&vals[..core.inputs.len()]);
        match core.fallback {
            Some(fallback) if !v.is_finite() => fallback,
            _ => v,
        }
    }

    /// Each mark set whose `rows` read an occurrence list, its filter applied once.
    fn occurrence_rows(
        &self,
        items: &Map<String, Value>,
        controls: Option<&Map<String, Value>>,
    ) -> Result<Vec<crate::rows::RowList>, Refused> {
        let mut out = Vec::new();
        for (id, item) in items {
            if item.get("kind").and_then(Value::as_str) != Some("marks@1") {
                continue;
            }
            let Some(rows) = item.get("params").and_then(|p| p.get("rows")) else {
                continue;
            };
            let path = format!("items/{id}/params/rows");
            let bad = |code, at: &str| Refused {
                code,
                path: format!("{path}{at}"),
                detail: None,
            };
            let Some(rows) = rows.as_object() else {
                return Err(bad("bad_doc", ""));
            };
            let from = rows.get("from").and_then(Value::as_object);
            let filter = doc::filter_of(from.ok_or(bad("bad_doc", "/from"))?, &format!("{path}/from"))?;
            let entries = self
                .occurrences(&filter, controls)
                .ok_or(bad("ref_unresolved", "/from/list"))?;
            let list = crate::occurrence::filtered(&filter, entries).map_err(|r| Refused {
                code: r.code,
                path: format!("{path}/from: {}", r.why),
                detail: None,
            })?;
            let control = |name: &str| {
                let c = controls?.get(name)?;
                let default = c.get("default").and_then(Value::as_f64).unwrap_or(0.0);
                let entries = self.options.input.iter().filter(|e| e.control == name);
                Some((entries.filter_map(|e| Some((e.t, e.value.as_f64()?))).collect(), default))
            };
            out.push(crate::rows::RowList::read(id, rows, list, control)?);
        }
        Ok(out)
    }

    /// The occurrences a list names: `markers.<kind>`, or `input.<control>`, the input track's
    /// entries for a control in the track's order, each a match whose payload is `{value,
    /// player}`, so a `where` can count one player's (#497).
    fn occurrences(&self, filter: &crate::occurrence::Filter, controls: Option<&Map<String, Value>>) -> Option<Vec<crate::occurrence::Occurrence>> {
        use crate::occurrence::Occurrence;
        // A list names a marker kind or a declared control; any other would read empty forever.
        if let Some(kind) = filter.list.strip_prefix("markers.") {
            if !doc::MARKER_KINDS.contains(&kind) {
                return None;
            }
            return Some(
                self.motion
                    .markers
                    .iter()
                    .filter(|m| m.kind == kind)
                    .map(|m| Occurrence {
                        t: m.start,
                        end: m.end,
                        a: Some(m.id.clone()),
                        b: None,
                        kind: m.kind.clone(),
                        tags: m.tags.clone(),
                        payload: m.payload.clone(),
                    })
                    .collect(),
            );
        }
        // A world's occurrences come from its bake, which no evaluation here has run.
        if self.world_of(&filter.list).is_some() {
            return Some(Vec::new());
        }
        let control = filter.list.strip_prefix("input.")?;
        if !controls.is_some_and(|c| c.contains_key(control)) {
            return None;
        }
        let mut entries: Vec<&Entry> = self.options.input.iter().filter(|e| e.control == control).collect();
        entries.sort_by_key(|e| e.key());
        Some(
            entries
                .into_iter()
                .map(|e| Occurrence {
                    t: e.t,
                    end: e.t,
                    a: None,
                    b: None,
                    kind: "input".into(),
                    tags: Vec::new(),
                    payload: json!({"value": e.value, "player": e.player}),
                })
                .collect(),
        )
    }

    /// A core driver's bound from its interval form: time over the span, each control over its
    /// declared range (Control sweep), each slot a channel writes over that channel's bound.
    fn core_bound(&self, core: &Core) -> Iv {
        let span = self.motion.transport.span.map_or(f64::INFINITY, |s| {
            s as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64
        });
        self.core_bound_in(core, Iv::new(0.0, span))
    }

    /// #493: what slot `s` holds over the document times `time` (seconds), from its writer's
    /// interval form: a core driver's over that time, a lone channel's whole bound, or the base
    /// where nothing writes it; `None` where no form bounds it (another writer, or a channel the
    /// forms don't settle). A driver's form may be unbounded there: a pole the caller refuses.
    pub fn slot_bound_over(&self, s: usize, time: Iv) -> Option<Iv> {
        if let Some((_, ops)) = self.drivers.iter().rev().find(|(slot, _)| *slot == s) {
            return match ops.as_slice() {
                [Op::Core(i)] => Some(self.core_bound_in(&self.cores[*i], time)),
                _ => None,
            };
        }
        (!self.writes(s..s + 1)).then(|| Iv::point(self.base[s]))
    }

    /// #493: the key times of the channels that write slot `s`, where a channel's monotone
    /// segments reach their extremes.
    pub fn slot_key_times(&self, s: usize) -> Vec<i64> {
        self.channels
            .iter()
            .zip(&self.motion.channels)
            .filter(|((slot, width), _)| (*slot..slot + width).contains(&s))
            .flat_map(|(_, c)| c.curve.keys.iter().map(|k| k.t))
            .collect()
    }

    /// A core driver's bound with time over `time`.
    fn core_bound_in(&self, core: &Core, time: Iv) -> Iv {
        let span = self.motion.transport.span.map_or(f64::INFINITY, |s| {
            s as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64
        });
        let vars: Vec<Iv> = core
            .inputs
            .iter()
            .map(|input| match input {
                CoreInput::Time => time,
                CoreInput::Control { range, .. } => Iv::new(range.0, range.1),
                CoreInput::Slot(s) => self.slot_bound(*s),
                CoreInput::World(..) | CoreInput::Rate(_) => Iv::ENTIRE,
                CoreInput::Remap(..) => Iv::new(0.0, 1.0),
                CoreInput::Occurrence(read) => read.bound(span),
                CoreInput::Lag(inner, _) => match &**inner {
                    CoreInput::Slot(s) => self.slot_bound(*s),
                    CoreInput::Control { range, .. } => Iv::new(range.0, range.1),
                    _ => Iv::new(0.0, span),
                },
            })
            .collect();
        let b = core.expr.bound_num(&vars);
        match core.fallback {
            Some(f) => Iv::new(b.lo.min(f), b.hi.max(f)),
            None => b,
        }
    }

    /// The bound of what slot `s` holds: its base value when nothing writes it, a channel's
    /// bound when one channel writes it, otherwise unbounded.
    fn slot_bound(&self, s: usize) -> Iv {
        let by: Vec<usize> = (0..self.channels.len())
            .filter(|&c| {
                let (slot, width) = self.channels[c];
                (slot..slot + width).contains(&s)
            })
            .collect();
        // Any write but the channels' (a placement's clip, a follow, a driver, a constraint)
        // leaves the slot unbounded here.
        let others = self.follows.contains(&s)
            || self.placements.iter().flatten().any(|w| (w.slot..w.slot + w.width).contains(&s))
            || self.drivers.iter().any(|(slot, _)| *slot == s)
            || self.limits.iter().any(|(first, _)| (*first..first + 3).contains(&s))
            || (0..self.constraints.len()).any(|k| self.constraint_slots(k).1.contains(&s));
        match by.as_slice() {
            [] if !self.writes(s..s + 1) => Iv::point(self.base[s]),
            [c] if !others => channel_bound(&self.motion.channels[*c]).map_or(Iv::ENTIRE, |(lo, hi)| Iv::new(lo, hi)),
            _ => Iv::ENTIRE,
        }
    }

    /// Each channel's and each driver's bound (`None` where the forms don't settle it), the
    /// bound the hard-range check reads.
    pub fn bounds(&self) -> (Bounds, Bounds) {
        let channels = self
            .motion
            .channels
            .iter()
            .map(|c| (c.id.clone(), channel_bound(c)))
            .collect();
        let drivers = self
            .motion
            .drivers
            .iter()
            .zip(&self.drivers)
            .map(|(d, (_, ops))| {
                let b = match ops.as_slice() {
                    [Op::Core(i)] => Some(self.core_bound(&self.cores[*i])),
                    _ => None,
                };
                (d.id.clone(), b.filter(Iv::is_bounded).map(|b| (b.lo, b.hi)))
            })
            .collect();
        (channels, drivers)
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
                Event::Mix(m) if (self.mixes[*m].slot..self.mixes[*m].slot + self.mixes[*m].width).contains(&slot) => Traced {
                    entry: format!("placements/{}", self.motion.placements[self.mixes[*m].members[0].0].id),
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
            // A core driver evaluates whole, in `run`.
            Op::Core(_) => return f64::NAN,
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
