//! The parts of a document motion reads: the transport, channels, clips and placements, read
//! from the document's JSON (canvas primitives: Transport, Channel and key, Clip, Placement).
//! Issue #417 adds the toggle and stages controls, the shots stages name, `camera@1` items, the
//! transition follow (#489) and the look's time feel they take.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_canvas::grammar::{Seeded, Time, TimeContext, FLICKS_PER_SECOND};
use serde_json::{Map, Value};

use crate::constraint::What;
use crate::curve::{steps_done, Bezier, Curve, Ease, Extrapolate, Interp, Jump, Key};
use crate::follow;
use crate::modifier::{Kind as ModKind, Modifier, Rate, Shape};
use crate::quat;
use crate::remap::{self, Pending, Ratio, Remap};
use crate::spring::Spring;
use crate::tempo::Tempo;
use deep_canvas::ease::{self, Named};

/// Why a document can't be evaluated, as a refusal code and the path it names.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refused {
    pub code: &'static str,
    pub path: String,
    /// What the refusal names past its path, such as a table's offending index or an ease
    /// table's knot, merged into the answer.
    pub detail: Option<Box<Value>>,
}

fn refuse<T>(code: &'static str, path: impl Into<String>) -> Result<T, Refused> {
    Err(Refused {
        code,
        path: path.into(),
        detail: None,
    })
}

/// What a channel writes: a field path inside an item, after the item's ID.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    /// The item, or a clip's slot name.
    pub owner: String,
    /// The field path inside the item, such as `["at", "pos", "0"]`.
    pub field: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValueType {
    F32,
    Color,
    /// Held only, as 0 or 1 (Channel and key: "enum, bool and string: hold only"); an item's
    /// `adjust.invert` is one (Item and kind: adjust).
    Bool,
    /// Held only, as the index of its value in [`Motion::labels`]; a vector part's role is one
    /// (Vector and formula `vector@1`: `items/<id>/parts/<part>/role`).
    Enum,
    /// `vec2` and `vec3`, per component.
    Vec,
    /// A unit quaternion `[x, y, z, w]`, keys sign-aligned and segments on the shorter arc.
    Quat,
    /// Degrees, with `space: shortest` turning each segment the shorter way.
    Angle,
    /// #494: a path, every key on one structure of sub-paths, matched at check.
    Path,
}

/// A path channel's keys (#494): `morph`, the structure every key's points share once matched,
/// and the keys that take another item's evaluated path (`{of: ID[#part]}`), resolved at check.
#[derive(Clone, Debug, PartialEq)]
pub struct PathKeys {
    pub strict: bool,
    pub structure: crate::morph::Structure,
    /// Each key's own shape, by key index, `None` for an `{of}` key until it resolves.
    pub shapes: Vec<Option<crate::morph::Shape>>,
    /// The `{of}` keys: key index and the item (and part) they name.
    pub of: Vec<(usize, String)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Channel {
    pub id: String,
    pub target: Target,
    pub ty: ValueType,
    pub curve: Curve,
    /// Added after the keys, in list order (Channel and key: `modifiers`).
    pub modifiers: Vec<Modifier>,
    /// `mode: follow`: what it follows and how, in place of keys.
    pub follow: Option<follow::Spec>,
    /// The hard range, checked at compile against keys, Bézier extremes and spring peaks.
    pub range: Option<(f64, f64)>,
    /// On a frame's `layout` (#491): the keys' interpolations over their index, 0, 1, 2…, so a
    /// key mixes each flow child from the layout before to the layout after.
    pub glide: Option<Curve>,
    /// #494: a path channel's keys.
    pub path: Option<PathKeys>,
}

impl Channel {
    /// The time a keyed read takes: `t`, stepped by a quantize modifier on its keys' span.
    pub fn stepped(&self, t: i64) -> i64 {
        self.modifiers.iter().fold(t, |t, m| match m.kind {
            ModKind::Quantize { hz, jump } => {
                let (Some(a), Some(b)) = (self.curve.keys.first(), self.curve.keys.last()) else {
                    return t;
                };
                let span = b.t - a.t;
                if t < a.t || t >= b.t {
                    return t;
                }
                let n = ((span as f64 * hz / FLICKS_PER_SECOND as f64).round() as u32).max(1);
                let u = jump.progress(steps_done(t - a.t, span, n), n);
                a.t + (u * span as f64).floor() as i64
            }
            _ => t,
        })
    }

    /// The value at `t` into `out`: stepped, sampled, then its modifiers, as a clip's channel
    /// reads in local time.
    pub fn read(&self, t: i64, out: &mut [f64]) {
        self.curve.sample_into(self.stepped(t), out);
        for m in &self.modifiers {
            out[0] = m.apply(out[0], t);
        }
    }

    /// Each component's rate at `t`, per second of the channel's own time.
    pub fn rate(&self, t: i64, out: &mut [f64]) {
        out.fill(0.0);
        if !self
            .modifiers
            .iter()
            .any(|m| matches!(m.kind, ModKind::Quantize { .. }))
        {
            self.curve.rate_into(t, out);
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Clip {
    pub id: String,
    /// The clip's span: its own, or its last key's time (`span: auto`).
    pub span: i64,
    pub channels: Vec<Channel>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Extend {
    None,
    Hold,
}

/// One item a placement binds to a slot, with how long after the placement's start its own copy
/// of the clip starts (its stagger delay).
#[derive(Clone, Debug, PartialEq)]
pub struct Binding {
    pub slot: String,
    pub item: String,
    pub delay: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    pub id: String,
    pub clip: String,
    /// Every slot's items, each with its stagger delay, in slot order then target order.
    pub bindings: Vec<Binding>,
    /// Resolved: its own `start`, or the end of the placement it comes `after` plus `offset`.
    pub start: i64,
    pub count: u32,
    pub before: Extend,
    pub after: Extend,
    /// What the clip's time does from `start` on, with every default where the document says
    /// nothing (Placement).
    pub timing: Timing,
    /// How it writes over what earlier writers gave a path.
    pub blending: Blending,
    /// Its writer layer's order key and its own (`The order of one evaluation`).
    pub rank: (String, String),
}

/// Repeat's way back to the clip's start.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Repeat {
    #[default]
    Wrap,
    PingPong,
}

/// `in`, `span`, `rate`, repeat's mode, `hold_at` and `quantize`, in the order they apply.
#[derive(Clone, Debug, PartialEq)]
pub struct Timing {
    pub trim: i64,
    pub span: Option<i64>,
    pub rate: Ratio,
    pub repeat: Repeat,
    pub hold_at: Option<i64>,
    pub quantize: Option<(u32, u32)>,
    /// The time remap that targets the placement, by index in [`Motion::remaps`].
    pub remap: Option<usize>,
    /// `start_on`: the starts of its runs, when an input or an occurrence starts it.
    pub start_on: Option<StartOn>,
    pub runs: Vec<i64>,
    /// `stagger.reverse_on_close`: with it, each run that a close started, in [`Timing::runs`]
    /// order, and the last target's delay, which a close turns the stagger around.
    pub closes: Vec<bool>,
    pub reach: Option<i64>,
}

impl Default for Timing {
    fn default() -> Timing {
        Timing {
            trim: 0,
            span: None,
            rate: (1, 1),
            repeat: Repeat::Wrap,
            hold_at: None,
            quantize: None,
            remap: None,
            start_on: None,
            runs: Vec::new(),
            closes: Vec::new(),
            reach: None,
        }
    }
}

/// `start_on`: what starts a run of the placement and what a start during a run does.
#[derive(Clone, Debug, PartialEq)]
pub struct StartOn {
    pub on: crate::occurrence::Filter,
    /// `each: change`: only an entry that changes the control's value.
    pub change: bool,
    pub policy: Policy,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Policy {
    #[default]
    Restart,
    Overlap,
    Ignore,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Blend {
    #[default]
    Replace,
    Add,
    Multiply,
    Mix,
}

/// An add placement's reference pose.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum AddFrom {
    #[default]
    First,
    Bind,
    At(i64),
}

/// A placement's `influence`: a number, keys of its own over the document's time, or a control.
#[derive(Clone, Debug, PartialEq)]
pub enum Influence {
    Value(f64),
    Keys(Curve),
    Control(String),
}

#[derive(Clone, Debug, PartialEq)]
pub struct Blending {
    pub blend: Blend,
    pub influence: Influence,
    pub add_from: AddFrom,
    pub fade_in: i64,
    pub fade_out: i64,
    pub switch: Option<Switch>,
}

/// `switch`: the placement weighs as case `case` of a choice cross-fading over `span`. Changes
/// stacked in one span weigh newest first: each takes its mix of what the newer ones leave.
#[derive(Clone, Debug, PartialEq)]
pub struct Switch {
    pub control: String,
    pub case: Value,
    pub span: i64,
    pub along: Along,
    /// `sync: next_loop_phase`: each change waits for the placement's next pass.
    pub sync: bool,
    /// The choice before any change, then each change's flick and value, filled from the track.
    pub first: Value,
    pub changes: Vec<(i64, Value)>,
}

/// How a switch's mix runs over its span.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Along {
    Ease(Named),
    Spring(Spring),
}

impl Switch {
    /// The mix of a change `d` flicks old: 1 from its span's end on.
    fn mix(&self, d: i64) -> f64 {
        if d >= self.span {
            return 1.0;
        }
        match self.along {
            Along::Ease(ease) => ease.at(d as f64 / self.span as f64),
            Along::Spring(spring) => {
                let seconds = d as f64 / FLICKS_PER_SECOND as f64;
                (1.0 - spring.at(1.0, 0.0, seconds).e).clamp(0.0, 1.0)
            }
        }
    }

    /// The case's weight at `t`, in closed form: older changes than the span have nothing left.
    pub fn weight(&self, t: i64) -> f64 {
        let mut left = 1.0;
        let mut weight = 0.0;
        let upto = self.changes.partition_point(|c| c.0 <= t);
        for (tc, value) in self.changes[..upto].iter().rev() {
            let mix = self.mix(t - tc);
            if *value == self.case {
                weight += left * mix;
            }
            left *= 1.0 - mix;
            if left == 0.0 {
                return weight;
            }
        }
        if self.first == self.case {
            weight += left;
        }
        weight
    }
}

impl Default for Blending {
    fn default() -> Blending {
        Blending {
            blend: Blend::Replace,
            influence: Influence::Value(1.0),
            add_from: AddFrom::First,
            fade_in: 0,
            fade_out: 0,
            switch: None,
        }
    }
}

/// A cut between two adjacent placements, at the flick the second starts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Cut {
    pub id: String,
    pub from: String,
    pub to: String,
    pub at: i64,
}

/// A marker's resolved start and end (canvas primitives: Marker).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Marker {
    pub id: String,
    pub kind: String,
    pub start: i64,
    pub end: i64,
    pub tags: Vec<String>,
    pub payload: Value,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Transport {
    pub start: i64,
    pub span: Option<i64>,
    pub wrap: bool,
    /// #157: `loop: ping_pong`: each pass plays the span the other way, so it closes by construction.
    pub ping_pong: bool,
    /// Under reduced motion the timeline holds at its start: `reduced_motion: hold`, in any
    /// profile but a film, which still plays its timeline (Transport).
    pub holds: bool,
    /// `reduced_motion: hold` (the default) rather than `slow`.
    pub reduce_holds: bool,
}

/// A driver (canvas primitives: Driver): writes its target from an expression over its vars,
/// after the channels and before the item's transform is composed.
#[derive(Clone, Debug, PartialEq)]
pub struct Driver {
    pub id: String,
    pub target: Target,
    /// The expression as written, and in postfix order.
    pub text: String,
    pub expr: Vec<deep_canvas::document::packs::ExprStep>,
    /// Each var's name and the document path it reads, in name order.
    pub vars: Vec<(String, Target)>,
    /// Each var that reads no document path, in name order: `time` or a control's value.
    pub inputs: Vec<(String, DriverInput)>,
    /// The hard range (Driver: `range`), checked against the driver's bound.
    pub range: Option<(f64, f64)>,
    /// What it writes where a read finds nothing or the value isn't finite (#491).
    pub fallback: Option<f64>,
}

/// A driver var that reads no document path.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DriverInput {
    /// The time in seconds since the transport's start.
    Time,
    /// `controls/<id>/value`: a control's value, swept over its declared range.
    Control(String),
    /// An occurrence list with its filter (#491), read through the occurrence functions.
    List(crate::occurrence::Filter),
    /// `channels/<id>.rate`: a channel's rate per second.
    Rate(String),
    /// `<remap>.active`, or with `true` `<remap>.progress`.
    Remap(String, bool),
    /// `<module>.<name>`: a canvas module's array, such as one a stepping module writes (#497).
    Array(String),
    /// #539: `controls/<id>/hover/<k>`, a pick control.s hover, keyed `<id>/hover/<k>` (crate::hover).
    Hover(String),
}

/// Each axis's `[min, max]`, `None` for an axis a limit leaves free.
pub type Bounds = [Option<(f64, f64)>; 3];

/// A `limit` constraint (canvas primitives: Constraint): holds one of its owner's transform
/// groups within per-axis bounds, after the channels and drivers.
#[derive(Clone, Debug, PartialEq)]
pub struct Limit {
    pub id: String,
    pub owner: String,
    /// The group it holds: `at/pos`, `at/rot` or `at/scale`.
    pub group: &'static str,
    pub bounds: Bounds,
}

/// A constraint kind besides `limit` (canvas primitives: Constraint), with the items it reads.
#[derive(Clone, Debug, PartialEq)]
pub enum Kind {
    ChildOf {
        parent: String,
    },
    FollowPath {
        points: Vec<[f64; 2]>,
        fraction: crate::constraint::Fraction,
        orient: bool,
        offset: [f64; 2],
    },
    LookAt {
        target: String,
    },
    Copy {
        what: What,
        target: String,
    },
    /// Bones `[upper, lower, end]`, each the next one's parent.
    Reach2 {
        chain: [String; 3],
        target: String,
        bend: f64,
        cartoon: bool,
    },
    FollowTip {
        item: String,
        offset: [f64; 2],
        rotate: bool,
    },
    Distance {
        target: String,
        min: f64,
        max: f64,
    },
    SpringChain {
        bones: Vec<String>,
        hz: f64,
        damping_ratio: f64,
        max_swing: f64,
    },
    /// With `on` (#2013: an item, a collection or `ground`) the owner rests on true shapes, which
    /// the module that holds them solves at check; without it, on the plane `ground`, here.
    RestOn {
        ground: f64,
        bottom: f64,
        offset: f64,
        max_drop: f64,
        on: Option<RestOn>,
    },
}

/// What a `rest_on` that names `on` rests its owner on, and how (Constraint: rest_on).
#[derive(Clone, Debug, PartialEq)]
pub struct RestOn {
    pub on: String,
    /// The unit direction the owner moves along.
    pub axis: [f64; 3],
    /// `align: normal`: the owner tilts to the surface it meets.
    pub align: bool,
    /// `contact: bounds`: each side's bounds meet, in place of their true shapes.
    pub bounds: bool,
}

/// One constraint on an owner item, applied by its influence after the owner's channels and
/// drivers, in ID order.
#[derive(Clone, Debug, PartialEq)]
pub struct Constraint {
    pub id: String,
    pub owner: String,
    pub kind: Kind,
    pub influence: f64,
}

impl Kind {
    pub fn name(&self) -> &'static str {
        match self {
            Kind::ChildOf { .. } => "child_of",
            Kind::FollowPath { .. } => "follow_path",
            Kind::LookAt { .. } => "look_at",
            Kind::Copy { .. } => "copy",
            Kind::Reach2 { .. } => "reach2",
            Kind::FollowTip { .. } => "follow_tip",
            Kind::Distance { .. } => "distance",
            Kind::SpringChain { .. } => "spring_chain",
            Kind::RestOn { .. } => "rest_on",
        }
    }

    /// The items it reads besides its owner (#1487: they count toward the clock with it).
    pub fn reads(&self) -> Vec<&str> {
        match self {
            Kind::ChildOf { parent: x }
            | Kind::LookAt { target: x }
            | Kind::Copy { target: x, .. }
            | Kind::FollowTip { item: x, .. }
            | Kind::Distance { target: x, .. } => vec![x.as_str()],
            Kind::Reach2 { chain, target, .. } => {
                chain.iter().chain([target]).map(String::as_str).collect()
            }
            Kind::SpringChain { bones, .. } => bones.iter().map(String::as_str).collect(),
            Kind::RestOn { on: Some(r), .. } if r.on != "ground" => vec![r.on.as_str()],
            Kind::FollowPath { .. } | Kind::RestOn { .. } => Vec::new(),
        }
    }
}

/// The look's time feel for a change of state (#417: `time.state: {span: time = "0.25s", interp =
/// ease in_out_cubic}`): what a transition follow naming no span or interp and a stage's glide
/// naming no ease take, so one piece moves with one ease.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Feel {
    pub span: i64,
    pub ease: Ease,
    /// `time.quantize_hz`: the look's stepped time, which every channel and placement reads.
    pub quantize: Option<(u32, u32)>,
}

impl Default for Feel {
    fn default() -> Feel {
        Feel {
            span: FLICKS_PER_SECOND / 4,
            ease: Ease::InOutCubic,
            quantize: None,
        }
    }
}

/// A control motion reads (canvas primitives: Control): a `toggle`, whose options are `false`
/// and `true`, or `stages`, whose options are its stages, each with its shot.
#[derive(Clone, Debug, PartialEq)]
pub struct Control {
    pub id: String,
    pub kind: &'static str,
    /// Its options as a follow's `values` name them.
    pub options: Vec<String>,
    /// The option it holds before any input.
    pub default: usize,
    /// A stages control's shot per option, as an index in [`Motion::shots`]; #504: a stage may
    /// name none.
    pub shots: Vec<Option<usize>>,
}

/// A channel that follows a control by a transition (#489: `model: transition {span, interp}`):
/// at each change of its source it moves from the value it holds then to the option's value.
#[derive(Clone, Debug, PartialEq)]
pub struct Follow {
    pub id: String,
    pub target: Target,
    /// The control, as an index in [`Motion::controls`].
    pub control: usize,
    /// The value per option of the control.
    pub values: Vec<f64>,
    /// Its own span and interp, or the look's time feel's where it names none.
    pub span: Option<i64>,
    pub ease: Option<Ease>,
}

impl Follow {
    /// The document entry that writes it: its channel, or for a stage's `set` (#504) the
    /// control's stage that first sets the path.
    pub fn entry(&self) -> String {
        if self.id.starts_with("controls/") {
            self.id.clone()
        } else {
            format!("channels/{}", self.id)
        }
    }
}

/// #504: a take-apart, a follow whose stagger's targets are assemblies (Follow: `stagger`): each
/// target's share follows the source, each change reaching target k rank × lag later, or with
/// `reverse_on_close` a closing change (n − 1 − rank) × lag later.
#[derive(Clone, Debug, PartialEq)]
pub struct Stagger {
    pub id: String,
    pub spec: follow::Spec,
    /// Each target assembly, in list order, with its rank: by (the assembly's `order`, its place
    /// in the list), then the stagger's order.
    pub targets: Vec<(String, usize)>,
    /// Flicks between consecutive ranks.
    pub lag: i64,
    pub reverse_on_close: bool,
}

/// A `hold` shot a stage names (canvas primitives: Control/Shot): its camera's target from the
/// stage's entry, reached by a glide from the pose shown.
#[derive(Clone, Debug, PartialEq)]
pub struct Shot {
    pub id: String,
    /// The camera, as an index in [`Motion::cameras`].
    pub camera: usize,
    pub target: [f64; 3],
    /// The glide's span: 0.8 s unless the shot names its own, 0 for `join: cut`.
    pub glide: i64,
    pub ease: Option<Ease>,
}

/// Everything motion reads, with each map in ID order.
#[derive(Clone, Debug, PartialEq)]
pub struct Motion {
    pub transport: Transport,
    pub channels: Vec<Channel>,
    pub follows: Vec<Follow>,
    /// #504: the take-aparts, in channel ID order.
    pub staggers: Vec<Stagger>,
    pub controls: Vec<Control>,
    /// The shots stages name, in the order stages first name them.
    pub shots: Vec<Shot>,
    /// Each `camera@1` item, in document order, with its own target.
    pub cameras: Vec<(String, [f64; 3])>,
    pub drivers: Vec<Driver>,
    pub limits: Vec<Limit>,
    pub constraints: Vec<Constraint>,
    /// Each control a #489 follow channel may read, with its default value.
    pub control_defaults: Vec<(String, f64)>,
    pub clips: Vec<Clip>,
    pub placements: Vec<Placement>,
    pub markers: Vec<Marker>,
    /// The `first` markers, solved by the program once its channels are compiled (#491).
    pub firsts: Vec<First>,
    /// Each parented item with its parent, parents before their children (child-of parenting).
    pub parents: Vec<(String, String)>,
    pub cuts: Vec<Cut>,
    pub frame_rate: (u32, u32),
    /// Every enum channel's values, each once; an enum key holds its value's index here.
    pub labels: Vec<String>,
    /// Each time remap (Time remap), outer targets first.
    pub remaps: Vec<Remap>,
    /// Each world the scene lists, with whether it declares inputs (World `physics.world@1`).
    pub worlds: Vec<(String, bool)>,
    /// The notices the check raised on an accepted document (#491's
    /// `literal_time_with_tempo_map`).
    pub notices: Vec<Value>,
}

impl Motion {
    pub fn clip(&self, id: &str) -> Option<&Clip> {
        self.clips.iter().find(|c| c.id == id)
    }

    /// Whether a time remap targets `item`: the document, the instance itself or an item it
    /// derives (`<instance>.<step>…`).
    pub fn remapped(&self, item: &str) -> bool {
        self.remaps.iter().any(|r| self.applies(r, item))
    }

    /// Whether remap `r` moves `item`'s own time.
    pub fn applies(&self, r: &Remap, item: &str) -> bool {
        r.target == DOCUMENT || derives(&r.target, item)
    }

    /// `item`'s own time at timeline position `doc_t`: each remap that targets it, outer to
    /// inner, maps parent time to child time, read from the transport's start.
    pub fn item_time(&self, item: &str, doc_t: i64) -> i64 {
        let start = self.transport.start;
        self.remaps
            .iter()
            .filter(|r| self.applies(r, item))
            .fold(doc_t, |t, r| start + r.child(t - start))
    }

    /// The timeline position a placement reads at `doc_t`: a `document` remap's child time.
    pub fn document_time(&self, doc_t: i64) -> i64 {
        let start = self.transport.start;
        self.remaps
            .iter()
            .filter(|r| r.target == DOCUMENT)
            .fold(doc_t, |t, r| start + r.child(t - start))
    }
}

/// The target naming the whole document (Time remap: `replay`).
pub const DOCUMENT: &str = "document";

/// Whether `item` is `target` or an item `target` derives.
fn derives(target: &str, item: &str) -> bool {
    item.strip_prefix(target)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('.'))
}

/// A map section's entries: each ID with its object.
type Entries<'a> = Vec<(&'a String, &'a Map<String, Value>)>;

/// A map section, in ID order: a missing one is empty.
fn section<'a>(doc: &'a Map<String, Value>, name: &str) -> Result<Entries<'a>, Refused> {
    let mut entries = Vec::new();
    match doc.get(name) {
        None | Some(Value::Null) => {}
        Some(Value::Object(map)) => {
            for (id, value) in map {
                match value {
                    Value::Object(entry) => entries.push((id, entry)),
                    _ => return refuse("bad_doc", format!("{name}/{id}")),
                }
            }
        }
        Some(_) => return refuse("bad_doc", name),
    }
    entries.sort_by(|a, b| a.0.cmp(b.0));
    Ok(entries)
}

/// What motion's time fields resolve against: the core's context and the document's tempo map
/// (#491), with the notices reading them raises.
#[derive(Default)]
pub struct Ctx {
    pub time: TimeContext,
    pub tempo: Option<Tempo>,
    /// The arc quat keys turn on, the short one but for a planted twin.
    arc: quat::Arc,
    notices: std::cell::RefCell<Vec<Value>>,
}

impl std::ops::Deref for Ctx {
    type Target = TimeContext;
    fn deref(&self) -> &TimeContext {
        &self.time
    }
}

impl std::ops::DerefMut for Ctx {
    fn deref_mut(&mut self) -> &mut TimeContext {
        &mut self.time
    }
}

impl Ctx {
    pub(crate) fn of(frame_rate: (u32, u32)) -> Ctx {
        Ctx {
            time: TimeContext {
                frame_rate,
                ..TimeContext::default()
            },
            ..Ctx::default()
        }
    }

    /// The document's timeline: its tempo map and markers, so a time read after the document's
    /// own (a shot's, #1163) lands where a key's does.
    pub(crate) fn timeline(
        doc: &Map<String, Value>,
        frame_rate: (u32, u32),
    ) -> Result<Ctx, Refused> {
        let mut ctx = Ctx::of(frame_rate);
        ctx.tempo = Tempo::read(doc, &ctx.time, false)?;
        markers_of(doc, &mut ctx)?;
        Ok(ctx)
    }
}

/// A time field's flicks: a bar:beat through the tempo map, anything else through the core.
pub fn time_of(value: Option<&Value>, ctx: &Ctx, path: &str) -> Result<i64, Refused> {
    let text = match value {
        Some(Value::String(text)) => text,
        // #157: a time in its stored form, whole flicks (Time and the flick).
        Some(Value::Number(n)) => return n.as_i64().map_or_else(|| refuse("bad_time", path), Ok),
        _ => return refuse("bad_time", path),
    };
    match (Time::parse(text), &ctx.tempo) {
        (Ok(Time::Beats { bar, beat }), Some(tempo)) => {
            tempo.beat(bar, beat).map_err(|why| Refused {
                code: "time_unresolved",
                path: path.to_string(),
                detail: Some(Box::new(serde_json::json!({"time": text, "why": why}))),
            })
        }
        (parsed, _) => parsed
            .and_then(|t| t.resolve(ctx))
            .or_else(|_| refuse("bad_time", path)),
    }
}

/// A time that places something on the timeline (a marker, a key): with a tempo map, a literal
/// in seconds or frames raises `literal_time_with_tempo_map`, offering the bar:beat it lands on,
/// or the beat before it and the marker forms.
fn placed_time_of(value: Option<&Value>, ctx: &Ctx, path: &str, id: &str) -> Result<i64, Refused> {
    let t = time_of(value, ctx, path)?;
    if let (Some(tempo), Some(Ok(Time::Span(_)))) =
        (&ctx.tempo, value.and_then(Value::as_str).map(Time::parse))
    {
        let text = value.and_then(Value::as_str).unwrap_or_default();
        let mut notice = serde_json::json!({"code": "literal_time_with_tempo_map", "id": id, "path": path, "time": text});
        match tempo.beat_on(t) {
            Some(fix) => notice["fix"] = serde_json::json!([fix]),
            None => notice["nearest"] = serde_json::json!(tempo.beat_before(t)),
        }
        ctx.notices.borrow_mut().push(notice);
    }
    Ok(t)
}

fn number(value: Option<&Value>, path: &str) -> Result<f64, Refused> {
    match value.and_then(Value::as_f64) {
        Some(n) if n.is_finite() => Ok(n),
        _ => refuse("out_of_range", path),
    }
}

/// A quantize's `jump`, `end` when absent.
fn jump_of(value: Option<&Value>, path: &str) -> Result<Jump, Refused> {
    match value {
        None => Ok(Jump::End),
        Some(v) => match v.as_str().and_then(Jump::parse) {
            Some(jump) => Ok(jump),
            None => refuse("bad_doc", path),
        },
    }
}

fn interp_of(value: Option<&Value>, path: &str) -> Result<Interp, Refused> {
    match value {
        None => Ok(Interp::Linear),
        Some(Value::String(s)) => match s.as_str() {
            "linear" => Ok(Interp::Linear),
            "hold" => Ok(Interp::Hold),
            "catmull_rom" => Ok(Interp::CatmullRom),
            "auto" => Ok(Interp::Auto {
                clamp: true,
                smoothness: 0.33,
            }),
            // A bare `ease` or `smooth`, and every interpolation motion doesn't land, is refused.
            _ => refuse("bad_interp", path),
        },
        Some(Value::Object(o)) if o.len() == 1 => {
            if let Some(Value::Object(h)) = o.get("bezier") {
                let at = |k: &str| number(h.get(k), &format!("{path}/bezier/{k}"));
                let (x1, x2) = (at("x1")?, at("x2")?);
                if !(0.0..=1.0).contains(&x1) || !(0.0..=1.0).contains(&x2) {
                    return refuse("out_of_range", format!("{path}/bezier"));
                }
                return Ok(Interp::Bezier {
                    x1,
                    y1: at("y1")?,
                    x2,
                    y2: at("y2")?,
                });
            }
            if let Some(Value::Object(s)) = o.get("spring") {
                return Ok(Interp::Spring(spring_of(s, &format!("{path}/spring"))?));
            }
            if let Some(q) = o.get("quantize") {
                let n = q
                    .get("n")
                    .unwrap_or(q)
                    .as_u64()
                    .and_then(|n| u32::try_from(n).ok());
                let jump = jump_of(q.get("jump"), &format!("{path}/quantize/jump"))?;
                return match n {
                    Some(n) if n >= 1 && (n >= 2 || jump != Jump::None) => {
                        Ok(Interp::Quantize { n, jump })
                    }
                    _ => refuse("out_of_range", format!("{path}/quantize")),
                };
            }
            if let Some(e) = o.get("ease") {
                // `{table: "<pack>.<name>"}` names a pack's ease table, resolved by the program.
                if let Some(t) = e.get("table") {
                    return match t {
                        Value::String(_) if e.as_object().is_some_and(|o| o.len() == 1) => {
                            Ok(Interp::Table)
                        }
                        _ => refuse("bad_interp", format!("{path}/ease/table")),
                    };
                }
                let named = named_of(e, &format!("{path}/ease"))?;
                return Ok(Interp::Ease(ease::Entry::opened(named)));
            }
            if let Some(Value::Object(a)) = o.get("auto") {
                let clamp = match a.get("clamp") {
                    None => true,
                    Some(Value::Bool(b)) => *b,
                    Some(_) => return refuse("bad_doc", format!("{path}/auto/clamp")),
                };
                let smoothness = match a.get("smoothness") {
                    None => 0.33,
                    v => number(v, &format!("{path}/auto/smoothness"))?,
                };
                if !(0.0..=1.0).contains(&smoothness) {
                    return refuse("out_of_range", format!("{path}/auto/smoothness"));
                }
                return Ok(Interp::Auto { clamp, smoothness });
            }
            refuse("bad_interp", path)
        }
        Some(_) => refuse("bad_interp", path),
    }
}

/// A spring by any of its forms: `{freq_hz, damping_ratio}`, `{decay, omega}` (ζ·ω0 = decay,
/// damped frequency omega), `{duration, bounce}` or `{mass, stiffness, damping}`.
pub fn spring_of(s: &Map<String, Value>, path: &str) -> Result<Spring, Refused> {
    let at = |k: &str| number(s.get(k), &format!("{path}/{k}"));
    let has = |k: &str| s.contains_key(k);
    let spring = if has("decay") || has("omega") {
        let (decay, omega) = (at("decay")?, at("omega")?);
        if decay < 0.0 || omega < 0.0 || decay + omega <= 0.0 {
            return refuse("out_of_range", path);
        }
        Spring::from_decay(decay, omega)
    } else if has("duration") {
        let (duration, bounce) = (
            at("duration")?,
            if has("bounce") { at("bounce")? } else { 0.0 },
        );
        if duration <= 0.0 || bounce >= 1.0 {
            return refuse("out_of_range", path);
        }
        Spring::from_duration(duration, bounce)
    } else if has("mass") || has("stiffness") {
        let (m, k, c) = (at("mass")?, at("stiffness")?, at("damping")?);
        if m <= 0.0 || k <= 0.0 || c <= 0.0 {
            return refuse("out_of_range", path);
        }
        Spring::from_mass(m, k, c)
    } else {
        let freq = if has("freq_hz") { at("freq_hz")? } else { 2.0 };
        let ratio = if has("damping_ratio") {
            at("damping_ratio")?
        } else {
            1.0
        };
        if freq <= 0.0 || ratio <= 0.0 {
            return refuse("out_of_range", path);
        }
        Spring::from_freq(freq, ratio)
    };
    Ok(spring)
}

/// An `ease@1` entry: `{name, params}` (params a number for the eases that take one, or an
/// object of named params: back's `overshoot`, elastic's `amplitude` and `period`, bounce's
/// `restitution` and `bounces`), or its bare name.
pub fn named_of(e: &Value, path: &str) -> Result<Named, Refused> {
    let (name, params) = match e {
        Value::String(n) => (n.as_str(), None),
        Value::Object(o) => match o.get("name") {
            Some(Value::String(n)) => (n.as_str(), o.get("params")),
            _ => return refuse("bad_interp", path),
        },
        _ => return refuse("bad_interp", path),
    };
    match ease::parse(name, params) {
        Ok(Some(named)) => Ok(named),
        Ok(None) => refuse("bad_interp", path),
        Err(bad) => refuse("out_of_range", format!("{path}/params/{}", bad.param)),
    }
}

/// A change of state's interp: `{"ease": {"name": …}}` naming an `ease@1` ease motion lands, or
/// a Bézier as a key writes one.
pub(crate) fn ease_of(value: &Value, path: &str) -> Result<Ease, Refused> {
    let single = value.as_object().filter(|o| o.len() == 1);
    if let Some(Value::Object(e)) = single.and_then(|o| o.get("ease")) {
        let name = e.get("name").and_then(Value::as_str);
        return match Ease::NAMES.iter().find(|(n, _)| Some(*n) == name) {
            Some((_, ease)) => Ok(*ease),
            None => refuse("bad_interp", format!("{path}/ease/name")),
        };
    }
    if single.is_some_and(|o| o.contains_key("bezier")) {
        if let Interp::Bezier { x1, y1, x2, y2 } = interp_of(Some(value), path)? {
            return Ok(Ease::Bezier(Bezier::new(x1, y1, x2, y2)));
        }
    }
    refuse("bad_interp", path)
}

/// The look's time feel for a change of state, `time.state`, each field at its default where the
/// look names none; paths name the request's `look`.
pub fn feel_of(look: &Map<String, Value>, frame_rate: (u32, u32)) -> Result<Feel, Refused> {
    let mut feel = Feel::default();
    if let Some(hz) = look.get("time").and_then(|t| t.get("quantize_hz")) {
        let (num, den) = ratio_of(hz, "look/time/quantize_hz")?;
        match (u32::try_from(num), u32::try_from(den)) {
            (Ok(num), Ok(den))
                if num > 0 && FLICKS_PER_SECOND * i64::from(den) % i64::from(num) == 0 =>
            {
                feel.quantize = Some((num, den))
            }
            _ => return refuse("bad_look", "look/time/quantize_hz"),
        }
    }
    let state = match look.get("time") {
        None => None,
        Some(Value::Object(time)) => match time.get("state") {
            None => None,
            Some(Value::Object(state)) => Some(state),
            Some(_) => return refuse("bad_look", "look/time/state"),
        },
        Some(_) => return refuse("bad_look", "look/time"),
    };
    let ctx = Ctx::of(frame_rate);
    if let Some(span) = state.and_then(|s| s.get("span")) {
        feel.span = time_of(Some(span), &ctx, "look/time/state/span")?;
    }
    if let Some(interp) = state.and_then(|s| s.get("interp")) {
        feel.ease = ease_of(interp, "look/time/state/interp")?;
    }
    Ok(feel)
}

/// What [`controls_of`] reads: the controls, the shots their stages name and their follows.
type Controls = (Vec<Control>, Vec<Shot>, Vec<Follow>);

/// The toggle and stages controls, in ID order, and the shots their stages name, each read once,
/// in the order stages first name them; every other kind of control is read where it lands.
/// #504: each path a stages control's stages `set` is a follow of that control with a span of 0,
/// its value per stage the stage's, or the document's own where a stage sets none.
fn controls_of(
    doc: &Map<String, Value>,
    cameras: &[(String, [f64; 3])],
    ctx: &Ctx,
) -> Result<Controls, Refused> {
    let mut controls = Vec::new();
    let mut read: Vec<Shot> = Vec::new();
    let mut sets: Vec<Follow> = Vec::new();
    for (id, c) in section(doc, "controls")? {
        let path = format!("controls/{id}");
        let (kind, options, shots, default) = match c.get("kind").and_then(Value::as_str) {
            Some("toggle") => {
                let on = match c.get("default") {
                    None => false,
                    Some(Value::Bool(b)) => *b,
                    Some(_) => return refuse("bad_doc", format!("{path}/default")),
                };
                let options = vec!["false".to_string(), "true".to_string()];
                ("toggle", options, Vec::new(), usize::from(on))
            }
            Some("stages") => {
                let stages = match c.get("stages") {
                    Some(Value::Object(s)) if !s.is_empty() => s,
                    _ => return refuse("bad_doc", format!("{path}/stages")),
                };
                let mut options = Vec::new();
                let mut shots = Vec::new();
                for (stage, s) in stages {
                    let at = format!("{path}/stages/{stage}/shot");
                    let shot = match s.get("shot") {
                        None | Some(Value::Null) => None,
                        Some(Value::String(name)) => {
                            Some(match read.iter().position(|x| x.id == *name) {
                                Some(i) => i,
                                None => {
                                    let def = doc.get("shots").and_then(|m| m.get(name));
                                    let Some(Value::Object(def)) = def else {
                                        return refuse("ref_unresolved", at);
                                    };
                                    read.push(shot_of(name, def, cameras, ctx)?);
                                    read.len() - 1
                                }
                            })
                        }
                        Some(_) => return refuse("bad_doc", at),
                    };
                    options.push(stage.clone());
                    shots.push(shot);
                }
                // Each path the stages set, with the first stage that sets it.
                let mut paths: Vec<(&String, &String)> = Vec::new();
                for (stage, s) in stages {
                    match s.get("set") {
                        None | Some(Value::Null) => {}
                        Some(Value::Object(set)) => {
                            for name in set.keys() {
                                if !paths.iter().any(|(p, _)| *p == name) {
                                    paths.push((name, stage));
                                }
                            }
                        }
                        Some(_) => return refuse("bad_doc", format!("{path}/stages/{stage}/set")),
                    }
                }
                for (name, stage) in paths {
                    let id = format!("{path}/stages/{stage}/set/{name}");
                    let target = target_of(name, false, &id)?;
                    let mut values = Vec::with_capacity(stages.len());
                    for (other, o) in stages {
                        let at = format!("{path}/stages/{other}/set/{name}");
                        values.push(match o.get("set").and_then(|m| m.get(name)) {
                            None => authored_number(doc, &target),
                            Some(Value::Bool(b)) => f64::from(u8::from(*b)),
                            v => number(v, &at)?,
                        });
                    }
                    sets.push(Follow {
                        id,
                        target,
                        control: controls.len(),
                        values,
                        span: Some(0),
                        ease: None,
                    });
                }
                let default = match c.get("default") {
                    None => 0,
                    Some(Value::String(d)) => match options.iter().position(|o| o == d) {
                        Some(i) => i,
                        None => return refuse("ref_unresolved", format!("{path}/default")),
                    },
                    Some(_) => return refuse("bad_doc", format!("{path}/default")),
                };
                ("stages", options, shots, default)
            }
            _ => continue,
        };
        controls.push(Control {
            id: id.clone(),
            kind,
            options,
            default,
            shots,
        });
    }
    Ok((controls, read, sets))
}

/// The number a target holds in the document as written: an item's field (an `at` component at
/// its identity where it names none), a data value's or an assembly's value; 0 where none.
fn authored_number(doc: &Map<String, Value>, target: &Target) -> f64 {
    let n = |v: Option<&Value>| match v {
        Some(Value::Bool(b)) => Some(f64::from(u8::from(*b))),
        v => v.and_then(Value::as_f64),
    };
    if let Some(name) = target.owner.strip_prefix("data/") {
        let d = doc.get("data").and_then(|d| d.get(name));
        return n(d.and_then(|d| d.get("value")).or(d)).unwrap_or(0.0);
    }
    if let Some(id) = target.owner.strip_prefix("assemblies/") {
        return n(doc
            .get("assemblies")
            .and_then(|a| a.get(id))
            .and_then(|a| a.get("value")))
        .unwrap_or(0.0);
    }
    let mut at = doc.get("items").and_then(|i| i.get(&target.owner));
    for name in &target.field {
        at = at.and_then(|v| match v {
            Value::Array(list) => name.parse::<usize>().ok().and_then(|i| list.get(i)),
            other => other.get(name),
        });
    }
    let identity = if target.field.get(1).map(String::as_str) == Some("scale") {
        1.0
    } else {
        0.0
    };
    n(at).unwrap_or(identity)
}

/// Each `camera@1` item with its target (`params.target`, `[0, 0, 0]` where it names none).
fn cameras_of(doc: &Map<String, Value>) -> Result<Vec<(String, [f64; 3])>, Refused> {
    let mut cameras = Vec::new();
    for (id, item) in doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        if item.get("kind").and_then(Value::as_str) != Some("camera@1") {
            continue;
        }
        let path = format!("items/{id}/params/target");
        let target = match item.get("params").and_then(|p| p.get("target")) {
            None => [0.0; 3],
            Some(v) => point_of(v, &path)?,
        };
        cameras.push((id.clone(), target));
    }
    Ok(cameras)
}

/// Three numbers.
fn point_of(value: &Value, path: &str) -> Result<[f64; 3], Refused> {
    match value.as_array() {
        Some(list) if list.len() == 3 => {
            let mut out = [0.0; 3];
            for (k, v) in list.iter().enumerate() {
                out[k] = number(Some(v), &format!("{path}/{k}"))?;
            }
            Ok(out)
        }
        _ => refuse("out_of_range", path),
    }
}

/// A `hold` shot: its camera, its target, the glide that joins it (0.8 s unless it names its own
/// span, 0 for `join: cut`) and its own ease, if any.
fn shot_of(
    id: &str,
    s: &Map<String, Value>,
    cameras: &[(String, [f64; 3])],
    ctx: &Ctx,
) -> Result<Shot, Refused> {
    let path = format!("shots/{id}");
    let camera = s.get("camera").and_then(Value::as_str);
    let Some(camera) = cameras.iter().position(|(c, _)| Some(c.as_str()) == camera) else {
        return refuse("ref_unresolved", format!("{path}/camera"));
    };
    match s.get("move").and_then(Value::as_str) {
        None | Some("hold") => {}
        Some(_) => return refuse("bad_doc", format!("{path}/move")),
    }
    // #504: a shot that frames its kept items names no target; its camera's own holds here.
    let target = match s.get("target") {
        None => cameras[camera].1,
        Some(target) => point_of(target, &format!("{path}/target"))?,
    };
    let default_glide = FLICKS_PER_SECOND * 4 / 5;
    let glide = match s.get("join") {
        None => default_glide,
        Some(Value::String(j)) if j == "cut" => 0,
        Some(Value::Object(j)) if j.len() == 1 && j.get("glide").is_some_and(Value::is_object) => {
            match j["glide"].get("span") {
                None => default_glide,
                v => time_of(v, ctx, &format!("{path}/join/glide/span"))?,
            }
        }
        Some(_) => return refuse("bad_doc", format!("{path}/join")),
    };
    let ease = match s.get("ease") {
        None => None,
        Some(v) => Some(ease_of(v, &format!("{path}/ease"))?),
    };
    Ok(Shot {
        id: id.to_string(),
        camera,
        target,
        glide,
        ease,
    })
}

/// A channel with `follow` in place of `keys`: a number channel moving by a transition from the
/// value it holds to the value its source control's option names.
fn follow_of(
    id: &str,
    c: &Map<String, Value>,
    doc: &Map<String, Value>,
    controls: &[Control],
    ctx: &Ctx,
) -> Result<Follow, Refused> {
    let path = format!("channels/{id}");
    let Some(Value::String(target)) = c.get("target") else {
        return refuse("bad_path", format!("{path}/target"));
    };
    let target = target_of(target, false, &format!("{path}/target"))?;
    match c.get("type").and_then(Value::as_str) {
        Some("f32") | None => {}
        _ => return refuse("bad_type", format!("{path}/type")),
    }
    if c.contains_key("keys") {
        return refuse("bad_doc", format!("{path}/keys"));
    }
    let path = format!("{path}/follow");
    let Some(Value::Object(source)) = c["follow"].get("source") else {
        return refuse("bad_doc", format!("{path}/source"));
    };
    let name = source.get("control").and_then(Value::as_str);
    let Some(control) = controls.iter().position(|k| Some(k.id.as_str()) == name) else {
        let exists = name.is_some_and(|n| doc.get("controls").and_then(|cs| cs.get(n)).is_some());
        let code = if exists { "bad_doc" } else { "ref_unresolved" };
        return refuse(code, format!("{path}/source/control"));
    };
    let Some(Value::Object(given)) = source.get("values") else {
        return refuse("bad_doc", format!("{path}/source/values"));
    };
    let options = &controls[control].options;
    if let Some(extra) = given.keys().find(|k| !options.contains(k)) {
        return refuse("ref_unresolved", format!("{path}/source/values/{extra}"));
    }
    let mut values = Vec::with_capacity(options.len());
    for option in options {
        let at = format!("{path}/source/values/{option}");
        match given.get(option) {
            None => return refuse("bad_doc", at),
            v => values.push(number(v, &at)?),
        }
    }
    let transition = match c["follow"].get("model") {
        Some(Value::Object(m)) if m.len() == 1 => m.get("transition").and_then(Value::as_object),
        _ => None,
    };
    let Some(transition) = transition else {
        return refuse("bad_doc", format!("{path}/model"));
    };
    let span = match transition.get("span") {
        None => None,
        v => Some(time_of(v, ctx, &format!("{path}/model/transition/span"))?),
    };
    let ease = match transition.get("interp") {
        None => None,
        Some(v) => Some(ease_of(v, &format!("{path}/model/transition/interp"))?),
    };
    Ok(Follow {
        id: id.to_string(),
        target,
        control,
        values,
        span,
        ease,
    })
}

fn target_of(text: &str, in_clip: bool, path: &str) -> Result<Target, Refused> {
    let parts: Vec<&str> = text.split('/').collect();
    let (owner, field) = if in_clip {
        let Some(slot) = parts.first().and_then(|p| p.strip_prefix("slot:")) else {
            return refuse("bad_path", path);
        };
        (slot, &parts[1..])
    } else {
        match parts.as_slice() {
            ["items", id, rest @ ..] => (*id, rest),
            // A keyed data value (Path: "A channel may key `data/<name>`"): its owner is the
            // data entry, never an item, and what it writes is the entry's value.
            ["data", name] if !name.is_empty() => {
                return Ok(Target {
                    owner: format!("data/{name}"),
                    field: vec!["value".into()],
                })
            }
            // #504: an assembly's value, its one write target (Assembly: "move except through
            // value, apart or a constraint").
            ["assemblies", id, "value"] if !id.is_empty() => {
                return Ok(Target {
                    owner: format!("assemblies/{id}"),
                    field: vec!["value".into()],
                })
            }
            _ => return refuse("bad_path", path),
        }
    };
    if owner.is_empty() || field.is_empty() || field.iter().any(|f| f.is_empty()) {
        return refuse("bad_path", path);
    }
    Ok(Target {
        owner: owner.to_string(),
        field: field.iter().map(|f| f.to_string()).collect(),
    })
}

fn driver_of(id: &str, d: &Map<String, Value>) -> Result<Driver, Refused> {
    let path = format!("drivers/{id}");
    let Some(Value::String(target)) = d.get("target") else {
        return refuse("bad_path", format!("{path}/target"));
    };
    let target = target_of(target, false, &format!("{path}/target"))?;
    let Some(Value::String(text)) = d.get("expr") else {
        return refuse("bad_doc", format!("{path}/expr"));
    };
    // The R1 subset compiles to motion's own ops; the rest of the closed function list, through
    // the core's expressions, at compile (an empty postfix).
    let expr = deep_canvas::document::packs::postfix(text).unwrap_or_default();
    let mut vars = Vec::new();
    let mut inputs = Vec::new();
    for (name, v) in d
        .get("vars")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let vpath = format!("{path}/vars/{name}");
        if let Value::Object(f) = v {
            inputs.push((name.clone(), DriverInput::List(filter_of(f, &vpath)?)));
            continue;
        }
        let Value::String(text) = v else {
            return refuse("bad_path", vpath);
        };
        if text == "time" {
            inputs.push((name.clone(), DriverInput::Time));
            continue;
        }
        if let Some(h) = crate::hover::input(text) {
            inputs.push((name.clone(), h));
            continue;
        }
        if let Some(c) = text
            .strip_prefix("controls/")
            .and_then(|r| r.strip_suffix("/value"))
        {
            inputs.push((name.clone(), DriverInput::Control(c.to_string())));
            continue;
        }
        if let Some(c) = text
            .strip_prefix("channels/")
            .and_then(|r| r.strip_suffix(".rate"))
        {
            inputs.push((name.clone(), DriverInput::Rate(c.to_string())));
            continue;
        }
        if let Some(r) = text.strip_suffix(".active") {
            inputs.push((name.clone(), DriverInput::Remap(r.to_string(), false)));
            continue;
        }
        if let Some(r) = text.strip_suffix(".progress") {
            inputs.push((name.clone(), DriverInput::Remap(r.to_string(), true)));
            continue;
        }
        if !text.contains('/') && text.contains('.') {
            inputs.push((name.clone(), DriverInput::Array(text.clone())));
            continue;
        }
        vars.push((name.clone(), target_of(text, false, &vpath)?));
    }
    vars.sort_by(|a, b| a.0.cmp(&b.0));
    inputs.sort_by(|a, b| a.0.cmp(&b.0));
    // Every name the expression reads is a var: a driver reads nothing it doesn't declare.
    for step in &expr {
        if let deep_canvas::document::packs::ExprStep::Name(n) = step {
            if !vars.iter().any(|(v, _)| v == n) && !inputs.iter().any(|(v, _)| v == n) {
                return refuse("ref_unresolved", format!("{path}/expr"));
            }
        }
    }
    let range = match d.get("range") {
        None => None,
        Some(Value::Array(r)) if r.len() == 2 => {
            let (lo, hi) = (
                number(r.first(), &format!("{path}/range/0"))?,
                number(r.get(1), &format!("{path}/range/1"))?,
            );
            if lo > hi {
                return refuse("out_of_range", format!("{path}/range"));
            }
            Some((lo, hi))
        }
        Some(_) => return refuse("bad_doc", format!("{path}/range")),
    };
    let fallback = match d.get("fallback") {
        None => None,
        v => Some(number(v, &format!("{path}/fallback"))?),
    };
    Ok(Driver {
        id: id.to_string(),
        target,
        text: text.clone(),
        expr,
        vars,
        inputs,
        range,
        fallback,
    })
}

/// An occurrence list var: `{list, kinds, a, b, tags, where}` (Driver).
pub(crate) fn filter_of(
    f: &Map<String, Value>,
    path: &str,
) -> Result<crate::occurrence::Filter, Refused> {
    let text = |k: &str| match f.get(k) {
        None => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => refuse("bad_doc", format!("{path}/{k}")),
    };
    let strings = |k: &str| match f.get(k) {
        None => Ok(None),
        Some(Value::Array(l)) if l.iter().all(Value::is_string) => Ok(Some(
            l.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>(),
        )),
        Some(_) => refuse("bad_doc", format!("{path}/{k}")),
    };
    if let Some(k) = f
        .keys()
        .find(|k| !["list", "kinds", "a", "b", "tags", "where"].contains(&k.as_str()))
    {
        return refuse("bad_doc", format!("{path}/{k}"));
    }
    let Some(list) = text("list")? else {
        return refuse("bad_doc", format!("{path}/list"));
    };
    Ok(crate::occurrence::Filter {
        list,
        kinds: strings("kinds")?,
        a: text("a")?,
        b: text("b")?,
        tags: strings("tags")?.unwrap_or_default(),
        where_: text("where")?,
    })
}

/// A constraint motion evaluates: `limit` lands here; every other kind is read elsewhere or later.
fn limit_of(id: &str, c: &Map<String, Value>) -> Result<Option<Limit>, Refused> {
    if c.get("kind").and_then(Value::as_str) != Some("limit") {
        return Ok(None);
    }
    let path = format!("constraints/{id}");
    let Some(owner) = c
        .get("owner")
        .and_then(Value::as_str)
        .filter(|o| !o.is_empty())
    else {
        return refuse("bad_path", format!("{path}/owner"));
    };
    let group = match c.get("what").and_then(Value::as_str) {
        Some("location") => "pos",
        Some("rotation") => "rot",
        Some("scale") => "scale",
        _ => return refuse("bad_doc", format!("{path}/what")),
    };
    let Some(Value::Array(list)) = c.get("bounds") else {
        return refuse("bad_doc", format!("{path}/bounds"));
    };
    if list.len() != 3 {
        return refuse("bad_doc", format!("{path}/bounds"));
    }
    let mut bounds = [None; 3];
    for (k, b) in list.iter().enumerate() {
        bounds[k] = match b {
            Value::Null => None,
            Value::Array(mm) => match (
                mm.first().and_then(Value::as_f64),
                mm.get(1).and_then(Value::as_f64),
            ) {
                (Some(lo), Some(hi)) if mm.len() == 2 && lo <= hi => Some((lo, hi)),
                _ => return refuse("out_of_range", format!("{path}/bounds/{k}")),
            },
            _ => return refuse("bad_doc", format!("{path}/bounds/{k}")),
        };
    }
    Ok(Some(Limit {
        id: id.to_string(),
        owner: owner.to_string(),
        group,
        bounds,
    }))
}

fn id_of(c: &Map<String, Value>, key: &str, path: &str) -> Result<String, Refused> {
    match c.get(key).and_then(Value::as_str).filter(|s| !s.is_empty()) {
        Some(s) => Ok(s.to_string()),
        None => refuse("bad_path", format!("{path}/{key}")),
    }
}

fn pair(v: Option<&Value>, path: &str) -> Result<[f64; 2], Refused> {
    match v {
        None => Ok([0.0; 2]),
        Some(Value::Array(a)) if a.len() == 2 => Ok([
            number(a.first(), &format!("{path}/0"))?,
            number(a.get(1), &format!("{path}/1"))?,
        ]),
        Some(_) => refuse("bad_doc", path),
    }
}

/// A `rest_on`'s `on`, `axis`, `align` and `contact` (#2013): the axis as a unit direction.
fn rest_on_of(c: &Map<String, Value>, path: &str) -> Result<RestOn, Refused> {
    let on = id_of(c, "on", path)?;
    let axis = match c.get("axis") {
        None => [0.0, -1.0, 0.0],
        Some(Value::Array(a)) if a.len() == 3 => {
            let mut v = [0.0; 3];
            for (k, x) in a.iter().enumerate() {
                v[k] = number(Some(x), &format!("{path}/axis/{k}"))?;
            }
            let len = deep_canvas::ops::sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
            if len < 1e-9 {
                return refuse("out_of_range", format!("{path}/axis"));
            }
            v.map(|x| x / len)
        }
        Some(_) => return refuse("bad_doc", format!("{path}/axis")),
    };
    let one_of = |k: &str, off: &str, on: &str| match c.get(k).map(Value::as_str) {
        None => Ok(false),
        Some(Some(v)) if v == off => Ok(false),
        Some(Some(v)) if v == on => Ok(true),
        Some(_) => refuse("bad_doc", format!("{path}/{k}")),
    };
    Ok(RestOn {
        on,
        axis,
        align: one_of("align", "none", "normal")?,
        bounds: one_of("contact", "true_shape", "bounds")?,
    })
}

/// A constraint of any kind but `limit`. `follow_stream` is the data module's, which this build
/// may lack; every other kind motion doesn't fill is refused as unknown.
fn constraint_of(id: &str, c: &Map<String, Value>) -> Result<Constraint, Refused> {
    let path = format!("constraints/{id}");
    let owner = id_of(c, "owner", &path)?;
    let at = |k: &str| format!("{path}/{k}");
    let num_or = |k: &str, d: f64| -> Result<f64, Refused> {
        match c.get(k) {
            None => Ok(d),
            v => number(v, &at(k)),
        }
    };
    let flag = |k: &str| c.get(k).and_then(Value::as_bool).unwrap_or(false);
    let kind = match c.get("kind").and_then(Value::as_str) {
        Some("child_of") => Kind::ChildOf {
            parent: id_of(c, "parent", &path)?,
        },
        Some("follow_path") => {
            let Some(Value::Array(list)) = c.get("path") else {
                return refuse("bad_doc", at("path"));
            };
            let points = list
                .iter()
                .enumerate()
                .map(|(i, p)| pair(Some(p), &format!("{path}/path/{i}")))
                .collect::<Result<Vec<_>, _>>()?;
            if points.len() < 2 {
                return refuse("bad_doc", at("path"));
            }
            Kind::FollowPath {
                points,
                fraction: crate::constraint::Fraction::of(c.get("fraction"))
                    .or_else(|code| refuse(code, at("fraction")))?,
                orient: flag("orient"),
                offset: pair(c.get("offset"), &at("offset"))?,
            }
        }
        Some("look_at") => Kind::LookAt {
            target: id_of(c, "target", &path)?,
        },
        Some("copy") => Kind::Copy {
            what: c
                .get("what")
                .and_then(Value::as_str)
                .and_then(What::parse)
                .map_or_else(|| refuse("bad_doc", at("what")), Ok)?,
            target: id_of(c, "target", &path)?,
        },
        Some("reach2") => {
            let chain: Vec<String> = c
                .get("chain")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .unwrap_or_default();
            let Ok(chain) = <[String; 3]>::try_from(chain) else {
                return refuse("bad_doc", at("chain"));
            };
            let bend = num_or("bend", 1.0)?;
            if bend != 1.0 && bend != -1.0 {
                return refuse("out_of_range", at("bend"));
            }
            let cartoon = match c.get("stretch").and_then(Value::as_str) {
                None | Some("none") => false,
                Some("cartoon") => true,
                Some(_) => return refuse("bad_doc", at("stretch")),
            };
            Kind::Reach2 {
                chain,
                target: id_of(c, "target", &path)?,
                bend,
                cartoon,
            }
        }
        Some("follow_tip") => Kind::FollowTip {
            item: id_of(c, "item", &path)?,
            offset: pair(c.get("offset"), &at("offset"))?,
            rotate: flag("rotate"),
        },
        Some("distance") => {
            let (min, max) = (num_or("min", 0.0)?, num_or("max", f64::MAX)?);
            if min < 0.0 || min > max {
                return refuse("out_of_range", path);
            }
            Kind::Distance {
                target: id_of(c, "target", &path)?,
                min,
                max,
            }
        }
        Some("spring_chain") => Kind::SpringChain {
            bones: c
                .get("bones")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect()
                })
                .filter(|b: &Vec<String>| !b.is_empty() && b.len() <= 8)
                .map_or_else(|| refuse("bad_doc", at("bones")), Ok)?,
            hz: num_or("hz", 2.0)?,
            damping_ratio: num_or("damping_ratio", 0.5)?,
            max_swing: num_or("max_swing", 60.0)?,
        },
        Some("rest_on") => Kind::RestOn {
            ground: num_or("ground", 0.0)?,
            bottom: num_or("bottom", 0.0)?,
            offset: num_or("offset", 0.0)?,
            max_drop: num_or("max_drop", 10.0)?,
            on: match c.get("on") {
                None => None,
                Some(_) => Some(rest_on_of(c, &path)?),
            },
        },
        Some("follow_stream") => return refuse("module_missing", at("kind")),
        _ => return refuse("unknown_kind", at("kind")),
    };
    Ok(Constraint {
        id: id.to_string(),
        owner,
        kind,
        influence: num_or("influence", 1.0)?,
    })
}

/// Seconds as a number, or a time literal, in flicks.
fn seconds_of(v: Option<&Value>, ctx: &Ctx, path: &str) -> Result<i64, Refused> {
    match v {
        Some(Value::Number(n)) => match n.as_f64() {
            Some(s) if s.is_finite() && s >= 0.0 => {
                Ok((s * deep_canvas::grammar::FLICKS_PER_SECOND as f64).round() as i64)
            }
            _ => refuse("out_of_range", path),
        },
        v => time_of(v, ctx, path),
    }
}

/// A `follow` read on its own, its times in seconds or time literals at 60 fps: the input
/// module's smoothing and the channels it feeds read their model here (#308).
pub fn follow_spec(f: &Map<String, Value>, path: &str) -> Result<follow::Spec, Refused> {
    follow_spec_of(f, &Ctx::of((60, 1)), path)
}

/// A follow channel's `follow` on held keys or a control's value (#489): its source, its model
/// and its outputs. A `follow` naming `source.control` and its option `values` is #417's.
fn follow_spec_of(f: &Map<String, Value>, ctx: &Ctx, path: &str) -> Result<follow::Spec, Refused> {
    let source = match f.get("source") {
        Some(Value::String(s)) => match s
            .strip_prefix("controls/")
            .and_then(|r| r.strip_suffix("/value"))
        {
            Some(id) if !id.is_empty() => follow::Source::Control(id.to_string()),
            _ => return refuse("bad_path", format!("{path}/source")),
        },
        Some(Value::Object(o)) => {
            let Some(Value::Object(keys)) = o.get("keys") else {
                return refuse("bad_doc", format!("{path}/source"));
            };
            let mut list = Vec::new();
            for (kid, k) in keys {
                let kpath = format!("{path}/source/keys/{kid}");
                // The source holds between its changes: a key that moves is a varying source.
                match k.get("interp").and_then(Value::as_str) {
                    None | Some("hold") => {}
                    Some(_) => return refuse("varying_source", kpath),
                }
                list.push((
                    time_of(k.get("t"), ctx, &format!("{kpath}/t"))?,
                    number(k.get("value"), &format!("{kpath}/value"))?,
                ));
            }
            list.sort_by_key(|(t, _)| *t);
            if list.is_empty() {
                return refuse("bad_doc", format!("{path}/source/keys"));
            }
            follow::Source::Keys(list)
        }
        _ => return refuse("bad_doc", format!("{path}/source")),
    };
    let Some(Value::Object(m)) = f.get("model") else {
        return refuse("bad_doc", format!("{path}/model"));
    };
    let mpath = format!("{path}/model");
    let positive = |o: &Map<String, Value>, k: &str, d: Option<f64>| -> Result<f64, Refused> {
        let v = match (o.get(k), d) {
            (None, Some(d)) => d,
            (v, _) => number(v, &format!("{mpath}/{k}"))?,
        };
        if v > 0.0 {
            Ok(v)
        } else {
            refuse("out_of_range", format!("{mpath}/{k}"))
        }
    };
    let model = if let Some(Value::Object(s)) = m.get("spring") {
        follow::Model::Spring(spring_of(s, &format!("{mpath}/spring"))?)
    } else if let Some(Value::Object(o)) = m.get("first_order") {
        let tau = o.get("tau").and_then(Value::as_f64);
        follow::Model::FirstOrder {
            tau_up: positive(o, "tau_up", tau)?,
            tau_down: positive(o, "tau_down", tau)?,
        }
    } else if let Some(Value::Object(o)) = m.get("rate_limit") {
        follow::Model::RateLimit {
            max: positive(o, "max", None)?,
        }
    } else if let Some(Value::Object(o)) = m.get("transition") {
        let span = seconds_of(o.get("span"), ctx, &format!("{mpath}/transition/span"))?;
        if span <= 0 {
            return refuse("out_of_range", format!("{mpath}/transition/span"));
        }
        let along = match interp_of(o.get("interp"), &format!("{mpath}/transition/interp"))? {
            Interp::Ease(e) => follow::Along::Ease(e.ease),
            Interp::Bezier { x1, y1, x2, y2 } => {
                follow::Along::Bezier(crate::curve::Bezier::new(x1, y1, x2, y2))
            }
            Interp::Linear => follow::Along::Linear,
            _ => return refuse("bad_interp", format!("{mpath}/transition/interp")),
        };
        follow::Model::Transition { span, along }
    } else {
        return refuse("bad_doc", mpath);
    };
    let outputs: Vec<&str> = match f.get("outputs") {
        None => vec!["value"],
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).collect(),
        Some(_) => return refuse("bad_doc", format!("{path}/outputs")),
    };
    if let Some(bad) = outputs
        .iter()
        .find(|o| !matches!(**o, "value" | "rate" | "integral"))
    {
        return refuse("bad_doc", format!("{path}/outputs/{bad}"));
    }
    let (rate, integral) = (outputs.contains(&"rate"), outputs.contains(&"integral"));
    if matches!(model, follow::Model::Transition { .. }) && (rate || integral) {
        return refuse("bad_doc", format!("{path}/outputs"));
    }
    Ok(follow::Spec {
        source,
        model,
        rate,
        integral,
    })
}

/// The code a `per_loop` on a document that doesn't loop is refused with.
pub const PER_LOOP_NO_LOOP: &str = "per_loop_no_loop";

/// One modifier: `{wave: {...}}`, `{noise: {...}}`, `{pulse: {...}}` or `{limits: {...}}`, or
/// the same with its kind in `kind`; each takes an `influence` (1).
fn modifier_of(
    m: &Value,
    ctx: &Ctx,
    transport: &Transport,
    path: &str,
    channel: &str,
    // The channel's id when its times are on the timeline (not in a clip), for the literal notice.
    placed: Option<&str>,
) -> Result<Modifier, Refused> {
    let Value::Object(m) = m else {
        return refuse("bad_doc", path);
    };
    let (kind, body, at) = match m.get("kind").and_then(Value::as_str) {
        Some(k) => (k.to_string(), m, path.to_string()),
        None => match m.iter().find(|(k, v)| v.is_object() && *k != "influence") {
            Some((k, Value::Object(b))) => (k.clone(), b, format!("{path}/{k}")),
            _ => return refuse("bad_doc", path),
        },
    };
    let num = |k: &str, d: f64| -> Result<f64, Refused> {
        match body.get(k) {
            None => Ok(d),
            v => number(v, &format!("{at}/{k}")),
        }
    };
    let rate = || -> Result<Rate, Refused> {
        match body.get("per_loop") {
            Some(v) => {
                let n = v.as_u64().filter(|n| (1..=u64::from(u16::MAX)).contains(n));
                let Some(n) = n else {
                    return refuse("out_of_range", format!("{at}/per_loop"));
                };
                let span = match (transport.wrap, transport.span) {
                    (true, Some(span)) => span,
                    _ => return refuse(PER_LOOP_NO_LOOP, channel),
                };
                Ok(Rate::PerLoop { n: n as u16, span })
            }
            None if body.contains_key("period") => {
                let p = num("period", 1.0)?;
                if p <= 0.0 {
                    return refuse("out_of_range", format!("{at}/period"));
                }
                Ok(Rate::Hz(1.0 / p))
            }
            None => Ok(Rate::Hz(num("frequency", 1.0)?)),
        }
    };
    let kind = match kind.as_str() {
        "wave" => ModKind::Wave {
            amplitude: num("amplitude", 1.0)?,
            rate: rate()?,
            phase: num("phase", 0.0)?,
            offset: num("offset", 0.0)?,
        },
        "noise" => ModKind::Noise {
            amplitude: num("amplitude", 1.0)?,
            rate: rate()?,
            seed: match body.get("seed") {
                None => 0,
                Some(v) => v
                    .as_u64()
                    .map_or_else(|| refuse("out_of_range", format!("{at}/seed")), Ok)?,
            },
        },
        "quantize" => {
            let hz = num("hz", 0.0)?;
            if hz <= 0.0 {
                return refuse("out_of_range", format!("{at}/hz"));
            }
            ModKind::Quantize {
                hz,
                jump: jump_of(body.get("jump"), &format!("{at}/jump"))?,
            }
        }
        "limits" => {
            let (min, max) = (num("min", f64::MIN)?, num("max", f64::MAX)?);
            // Limits written upside down hold no value.
            if min > max {
                return refuse("out_of_range", format!("{at}/min"));
            }
            ModKind::Limits { min, max }
        }
        "pulse" => {
            let shape = match body.get("shape") {
                None => Shape::ThereAndBack,
                Some(Value::String(s)) if s == "there_and_back" => Shape::ThereAndBack,
                Some(Value::String(s)) if s == "pause" => Shape::Pause(1.0 / 3.0),
                Some(Value::String(s)) if s == "wiggle" => Shape::Wiggle(2.0),
                Some(Value::Object(o)) if o.contains_key("pause") => Shape::Pause(
                    o["pause"]
                        .get("share")
                        .and_then(Value::as_f64)
                        .unwrap_or(1.0 / 3.0),
                ),
                Some(Value::Object(o)) if o.contains_key("wiggle") => Shape::Wiggle(
                    o["wiggle"]
                        .get("count")
                        .and_then(Value::as_f64)
                        .unwrap_or(2.0),
                ),
                Some(_) => return refuse("bad_doc", format!("{at}/shape")),
            };
            let ease = match body.get("ease") {
                None => ease::named("sigmoid", Some(10.0)).unwrap_or(Named::Smoothstep),
                Some(e) => named_of(e, &format!("{at}/ease"))?,
            };
            ModKind::Pulse {
                at: match placed {
                    Some(id) => placed_time_of(body.get("at"), ctx, &format!("{at}/at"), id)?,
                    None => time_of(body.get("at"), ctx, &format!("{at}/at"))?,
                },
                span: time_of(body.get("span"), ctx, &format!("{at}/span"))?,
                amount: num("amount", 1.0)?,
                shape,
                ease,
            }
        }
        _ => return refuse("bad_doc", format!("{path}/kind")),
    };
    let influence = match m.get("influence").or_else(|| body.get("influence")) {
        None => 1.0,
        v => number(v, &format!("{path}/influence"))?,
    };
    Ok(Modifier { kind, influence })
}

fn channel_of(
    id: &str,
    c: &Map<String, Value>,
    in_clip: bool,
    ctx: &Ctx,
    transport: &Transport,
    path: &str,
    labels: &mut Vec<String>,
) -> Result<Channel, Refused> {
    let Some(Value::String(target)) = c.get("target") else {
        return refuse("bad_path", format!("{path}/target"));
    };
    let target = target_of(target, in_clip, &format!("{path}/target"))?;
    let ty = match c.get("type").and_then(Value::as_str) {
        Some("f32") | None => ValueType::F32,
        Some("color") => match c.get("space").and_then(Value::as_str) {
            Some("oklab") | None => ValueType::Color,
            _ => return refuse("bad_space", format!("{path}/space")),
        },
        Some("vec2" | "vec3") => ValueType::Vec,
        Some("quat") => ValueType::Quat,
        Some("angle") => ValueType::Angle,
        Some("bool") => ValueType::Bool,
        Some("enum") => ValueType::Enum,
        Some("path") => ValueType::Path,
        _ => return refuse("bad_type", format!("{path}/type")),
    };
    let width = match c.get("type").and_then(Value::as_str) {
        Some("vec2") => 2,
        Some("quat") => 4,
        Some("color" | "vec3") => 3,
        _ => 1,
    };
    let absolute = match (ty, c.get("space").and_then(Value::as_str)) {
        (ValueType::Angle, Some("absolute")) => true,
        (ValueType::Angle, None | Some("shortest")) => false,
        (ValueType::Angle, Some(_)) => return refuse("bad_space", format!("{path}/space")),
        _ => false,
    };
    let range = match c.get("range") {
        None => None,
        Some(Value::Array(r)) if r.len() == 2 => {
            let (lo, hi) = (
                number(r.first(), &format!("{path}/range/0"))?,
                number(r.get(1), &format!("{path}/range/1"))?,
            );
            if lo > hi {
                return refuse("out_of_range", format!("{path}/range"));
            }
            Some((lo, hi))
        }
        Some(_) => return refuse("bad_doc", format!("{path}/range")),
    };
    if c.get("mode").and_then(Value::as_str) == Some("follow") {
        if in_clip || ty != ValueType::F32 {
            return refuse("bad_doc", format!("{path}/mode"));
        }
        let Some(Value::Object(f)) = c.get("follow") else {
            return refuse("bad_doc", format!("{path}/follow"));
        };
        return Ok(Channel {
            id: id.to_string(),
            target,
            ty,
            curve: Curve::new(Vec::new()),
            modifiers: Vec::new(),
            follow: Some(follow_spec_of(f, ctx, &format!("{path}/follow"))?),
            range,
            glide: None,
            path: None,
        });
    }
    let mut keys = Vec::new();
    let mut path_shapes: Vec<(String, Option<crate::morph::Shape>, Option<String>)> = Vec::new();
    let strict = match (ty, c.get("morph").and_then(Value::as_str), c.get("morph")) {
        (_, _, None) => false,
        (ValueType::Path, Some("match"), _) => false,
        (ValueType::Path, Some("strict"), _) => true,
        _ => return refuse("bad_doc", format!("{path}/morph")),
    };
    // A frame's layout is a channel target: its keys may glide, the value itself held.
    let glides = !in_clip && ty == ValueType::Enum && target.field == ["params", "layout"];
    let mut glide: Vec<Key> = Vec::new();
    let Some(Value::Object(map)) = c.get("keys") else {
        return refuse("bad_doc", format!("{path}/keys"));
    };
    for (kid, key) in map {
        let kpath = format!("{path}/keys/{kid}");
        let Value::Object(key) = key else {
            return refuse("bad_doc", kpath);
        };
        let t = if in_clip {
            time_of(key.get("t"), ctx, &format!("{kpath}/t"))?
        } else {
            placed_time_of(
                key.get("t"),
                ctx,
                &format!("{kpath}/t"),
                &format!("{id}/{kid}"),
            )?
        };
        let value = match (ty, key.get("value")) {
            (ValueType::F32 | ValueType::Angle, v) => vec![number(v, &format!("{kpath}/value"))?],
            (ValueType::Bool, Some(Value::Bool(b))) => vec![if *b { 1.0 } else { 0.0 }],
            (ValueType::Enum, Some(Value::String(s))) => {
                let i = labels.iter().position(|l| l == s).unwrap_or_else(|| {
                    labels.push(s.clone());
                    labels.len() - 1
                });
                vec![i as f64]
            }
            (ValueType::Color | ValueType::Vec | ValueType::Quat, Some(Value::Array(parts)))
                if parts.len() == width =>
            {
                parts
                    .iter()
                    .enumerate()
                    .map(|(i, p)| number(Some(p), &format!("{kpath}/value/{i}")))
                    .collect::<Result<_, _>>()?
            }
            // #494: a path key's value is an SVG path string, or another item's path by `of`.
            (ValueType::Path, Some(v)) => {
                match v.get("of").and_then(Value::as_str) {
                    Some(of) if !in_clip => {
                        path_shapes.push((kid.clone(), None, Some(of.to_string())))
                    }
                    Some(_) => return refuse("out_of_range", format!("{kpath}/value")),
                    None => match crate::morph::of_value(v) {
                        Some(shape) => path_shapes.push((kid.clone(), Some(shape), None)),
                        None => return refuse("bad_path", format!("{kpath}/value")),
                    },
                }
                Vec::new()
            }
            _ => return refuse("out_of_range", format!("{kpath}/value")),
        };
        let mut interp = match (ty, key.get("interp")) {
            (ValueType::Bool | ValueType::Enum, None) => Interp::Hold,
            (_, v) => interp_of(v, &format!("{kpath}/interp"))?,
        };
        if glides {
            if matches!(
                interp,
                Interp::Spring(_) | Interp::Auto { .. } | Interp::CatmullRom | Interp::Table
            ) {
                return refuse("bad_interp", format!("{kpath}/interp"));
            }
            glide.push(Key::new(kid, t, Vec::new(), interp));
            interp = Interp::Hold;
        }
        if matches!(ty, ValueType::Bool | ValueType::Enum) && interp != Interp::Hold {
            return refuse("bad_interp", format!("{kpath}/interp"));
        }
        if matches!(
            interp,
            Interp::Spring(_) | Interp::Auto { .. } | Interp::CatmullRom
        ) && ty != ValueType::F32
        {
            return refuse("bad_interp", format!("{kpath}/interp"));
        }
        let mut k = Key::new(kid, t, value, interp);
        k.turns = (ty == ValueType::Quat).then_some(ctx.arc);
        // #494: a vec key's travel; a path key's takes its sub-paths once they're matched.
        if let Some(v) = key.get("travel") {
            let travel = crate::travel::Travel::of(v).map_err(|f| Refused {
                code: "bad_doc",
                path: if f.is_empty() {
                    format!("{kpath}/travel")
                } else {
                    format!("{kpath}/travel/{f}")
                },
                detail: None,
            })?;
            match (ty, travel) {
                (_, None) => {}
                (ValueType::Vec | ValueType::Path, Some(travel)) => {
                    k.travel = Some(Arc::new(crate::curve::Travels {
                        travel,
                        dim: width,
                        subs: vec![1],
                    }));
                }
                _ => return refuse("bad_doc", format!("{kpath}/travel")),
            }
        }
        if interp == Interp::Table {
            let name = key
                .get("interp")
                .and_then(|i| i.pointer("/ease/table"))
                .and_then(Value::as_str);
            k.table = name.map(|n| (n.to_string(), None));
        }
        // A spring key's starting rate, per component, in value per second.
        k.velocity = match key.get("velocity") {
            None => Vec::new(),
            Some(Value::Array(list)) => list
                .iter()
                .enumerate()
                .map(|(i, v)| number(Some(v), &format!("{kpath}/velocity/{i}")))
                .collect::<Result<_, _>>()?,
            v => vec![number(v, &format!("{kpath}/velocity"))?],
        };
        keys.push(k);
    }
    let (before, after) = extrapolate_of(c.get("extrapolate"), &format!("{path}/extrapolate"))?;
    let modifiers = match c.get("modifiers") {
        None => Vec::new(),
        Some(Value::Array(list)) => list
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let at = format!("{path}/modifiers/{i}");
                modifier_of(m, ctx, transport, &at, path, (!in_clip).then_some(id))
            })
            .collect::<Result<_, _>>()?,
        Some(_) => return refuse("bad_doc", format!("{path}/modifiers")),
    };
    let stepping = modifiers
        .iter()
        .all(|m| matches!(m.kind, ModKind::Quantize { .. }));
    if (!modifiers.is_empty() && !stepping) && ty != ValueType::F32 {
        return refuse("bad_doc", format!("{path}/modifiers"));
    }
    keys.sort_by(|a, b| a.t.cmp(&b.t).then_with(|| a.id.cmp(&b.id)));
    match ty {
        // q and −q are one rotation: each key takes the sign nearest the key before it.
        ValueType::Quat if ctx.arc == quat::Arc::Short => {
            for i in 1..keys.len() {
                let aligned = quat::aligned(quat::of(&keys[i].value), quat::of(&keys[i - 1].value));
                keys[i].value = aligned.to_vec();
            }
        }
        // Each key takes the turn nearest the key before it, so a segment goes the short way.
        ValueType::Angle if !absolute => {
            for i in 1..keys.len() {
                let (a, b) = (keys[i - 1].value[0], keys[i].value[0]);
                keys[i].value[0] = a + (b - a + 180.0).rem_euclid(360.0) - 180.0;
            }
        }
        _ => {}
    }
    let path_keys = if ty == ValueType::Path {
        let mut keyed = PathKeys {
            strict,
            structure: Vec::new(),
            shapes: Vec::new(),
            of: Vec::new(),
        };
        for (i, k) in keys.iter().enumerate() {
            let Some((_, shape, of)) = path_shapes.iter().find(|(kid, ..)| *kid == k.id) else {
                continue;
            };
            keyed.shapes.push(shape.clone());
            if let Some(of) = of {
                keyed.of.push((i, of.clone()));
            }
        }
        if keyed.of.is_empty() {
            match_path(id, &mut keyed, &mut keys, path)?;
        }
        Some(keyed)
    } else {
        None
    };
    Ok(Channel {
        id: id.to_string(),
        target,
        ty,
        path: path_keys,
        curve: Curve::extrapolated(keys, before, after),
        modifiers,
        follow: None,
        range,
        glide: glides.then(|| {
            glide.sort_by_key(|k| k.t);
            let keys = glide
                .into_iter()
                .enumerate()
                .map(|(i, k)| Key::new(&k.id, k.t, vec![i as f64], k.interp))
                .collect();
            Curve::extrapolated(keys, Extrapolate::Hold, Extrapolate::Hold)
        }),
    })
}

/// #494: a path channel's keys put on one structure once every key's shape is known: equal
/// structures as they are, others matched (Channel and key: path), or refused under
/// `morph: strict`, naming the channel. Each key's value becomes its flat points and its travel
/// learns the sub-paths.
pub fn match_path(
    id: &str,
    keyed: &mut PathKeys,
    keys: &mut [Key],
    path: &str,
) -> Result<(), Refused> {
    let shapes: Vec<crate::morph::Shape> = keyed
        .shapes
        .iter()
        .map(|s| s.clone().unwrap_or_default())
        .collect();
    let Some(first) = shapes.first() else {
        return Ok(());
    };
    let same = shapes
        .iter()
        .all(|s| crate::morph::structure(s) == crate::morph::structure(first));
    if !same && keyed.strict {
        return Err(Refused {
            code: "morph_strict",
            path: format!("{path}/keys"),
            detail: Some(Box::new(
                serde_json::json!({"channel": id, "why": "its path keys differ in point or sub-path counts, and morph is strict"}),
            )),
        });
    }
    let matched = if same {
        shapes
    } else {
        crate::morph::matched_all(&shapes)
    };
    keyed.structure = crate::morph::structure(&matched[0]);
    let subs: Vec<usize> = keyed.structure.iter().map(|(n, _)| *n).collect();
    for (k, shape) in keys.iter_mut().zip(&matched) {
        k.value = crate::morph::flat(shape);
        if let Some(t) = &mut k.travel {
            *t = Arc::new(crate::curve::Travels {
                travel: t.travel.clone(),
                dim: 2,
                subs: subs.clone(),
            });
        }
    }
    Ok(())
}

/// A channel's `extrapolate`: one mode for both sides, or `{before, after}`; hold when absent.
fn extrapolate_of(
    value: Option<&Value>,
    path: &str,
) -> Result<(Extrapolate, Extrapolate), Refused> {
    let one = |v: Option<&Value>, path: &str| match v.and_then(Value::as_str) {
        None | Some("hold") => Ok(Extrapolate::Hold),
        Some("linear") => Ok(Extrapolate::Linear),
        Some("cycle") => Ok(Extrapolate::Cycle),
        Some("ping_pong") => Ok(Extrapolate::PingPong),
        Some("cycle_offset") => Ok(Extrapolate::CycleOffset),
        Some(_) => refuse("bad_doc", path),
    };
    match value {
        None => Ok((Extrapolate::Hold, Extrapolate::Hold)),
        Some(Value::Object(o)) => Ok((
            one(o.get("before"), &format!("{path}/before"))?,
            one(o.get("after"), &format!("{path}/after"))?,
        )),
        v => {
            let both = one(v, path)?;
            Ok((both, both))
        }
    }
}

fn extend_of(value: Option<&Value>, path: &str) -> Result<Extend, Refused> {
    match value.and_then(Value::as_str) {
        None => Ok(Extend::None),
        Some("none") => Ok(Extend::None),
        Some("hold") => Ok(Extend::Hold),
        Some(_) => refuse("bad_doc", path),
    }
}

/// The frame rate the time literals resolve against: `transport.frame_rate` as `p/q` text or a
/// `[p, q]` pair, 60/1 when absent.
pub(crate) fn frame_rate_of(transport: Option<&Map<String, Value>>) -> Result<(u32, u32), Refused> {
    let Some(t) = transport.filter(|t| t.contains_key("frame_rate")) else {
        return Ok((60, 1));
    };
    // The core's reading of the field (`[p, q]` or `"p/q"`); the whole-flick rule is the
    // core's check, so here only a non-rate is refused.
    match deep_canvas::document::frame_rate_of(&Value::Object(t.clone())) {
        Some((p, q)) if p > 0 && q > 0 => Ok((p, q)),
        _ => refuse("bad_rate", "transport/frame_rate"),
    }
}

/// Reads a document's motion.
pub fn read(doc: &Map<String, Value>) -> Result<Motion, Refused> {
    read_with(doc, false, quat::Arc::Short)
}

/// Reads a document's motion, its constant tempo sections' beats in f32 seconds when
/// `f32_beats` (the planted twin of #491 AC1).
pub fn read_with(
    doc: &Map<String, Value>,
    f32_beats: bool,
    arc: quat::Arc,
) -> Result<Motion, Refused> {
    let transport_map = match doc.get("transport") {
        None | Some(Value::Null) => None,
        Some(Value::Object(t)) => Some(t),
        Some(_) => return refuse("bad_doc", "transport"),
    };
    let frame_rate = frame_rate_of(transport_map)?;
    let mut ctx = Ctx::of(frame_rate);
    ctx.arc = arc;
    ctx.tempo = Tempo::read(doc, &ctx.time, f32_beats)?;
    let (markers, firsts) = markers_of(doc, &mut ctx)?;
    let reduce_holds = transport_map
        .and_then(|t| t.get("reduced_motion"))
        .and_then(Value::as_str)
        != Some("slow");
    let holds = doc.get("profile").and_then(Value::as_str) != Some("film")
        && transport_map
            .and_then(|t| t.get("reduced_motion"))
            .and_then(Value::as_str)
            != Some("slow");
    let transport = match transport_map {
        None => Transport {
            start: 0,
            span: None,
            wrap: false,
            ping_pong: false,
            holds,
            reduce_holds,
        },
        Some(t) => {
            let start = match t.get("start") {
                None => 0,
                v => time_of(v, &ctx, "transport/start")?,
            };
            let span = match t.get("span") {
                None => None,
                Some(Value::String(s)) if s == "auto" || s == "open" => None,
                v => Some(time_of(v, &ctx, "transport/span")?),
            };
            let (wrap, ping_pong) = match t.get("loop").and_then(Value::as_str) {
                None | Some("none") => (false, false),
                Some("wrap") => (true, false),
                Some("ping_pong") => (false, true),
                Some(_) => return refuse("bad_doc", "transport/loop"),
            };
            // An open span has no end to wrap at: its loop must be none (Transport).
            if (wrap || ping_pong) && t.get("span").and_then(Value::as_str) == Some("open") {
                return refuse("bad_doc", "transport/loop");
            }
            if (wrap || ping_pong) && span.is_none_or(|s| s <= 0) {
                return refuse("bad_time", "transport/span");
            }
            Transport {
                start,
                span,
                wrap,
                ping_pong,
                holds,
                reduce_holds,
            }
        }
    };
    let cameras = cameras_of(doc)?;
    let (controls, shots, mut follows) = controls_of(doc, &cameras, &ctx)?;
    let seed = match doc.get("seed") {
        None => fnv1a(doc.get("id").and_then(Value::as_str).unwrap_or("")),
        Some(v) => match v.as_u64() {
            Some(seed) => seed,
            None => return refuse("out_of_range", "seed"),
        },
    };
    let mut labels = Vec::new();
    let mut channels = Vec::new();
    let mut staggers = Vec::new();
    for (id, c) in section(doc, "channels")? {
        // #417's follow names a toggle or stages control and its options' values; #489's
        // follows held keys or a control's value path.
        let names_control = c
            .get("follow")
            .and_then(|f| f.get("source"))
            .is_some_and(|s| s.get("control").is_some());
        let staggered = c.get("follow").and_then(|f| f.get("stagger")).is_some();
        if names_control && staggered {
            return refuse("bad_doc", format!("channels/{id}/follow/stagger"));
        }
        if names_control {
            follows.push(follow_of(id, c, doc, &controls, &ctx)?);
            continue;
        }
        // #504: a follow whose stagger's targets are assemblies is a take-apart, writing each
        // target's apart share; its target is `assemblies/apart`, those shares, or none. Any
        // other target of its own follows the source unstaggered, as any follow does.
        if let (true, Some(Value::Object(f))) = (staggered, c.get("follow")) {
            staggers.push(take_apart_of(id, f, doc, &ctx, seed)?);
            if c.get("target")
                .is_none_or(|t| t.as_str() == Some("assemblies/apart"))
            {
                continue;
            }
        }
        let path = format!("channels/{id}");
        channels.push(channel_of(
            id,
            c,
            false,
            &ctx,
            &transport,
            &path,
            &mut labels,
        )?);
    }
    let mut clips = Vec::new();
    for (id, c) in section(doc, "clips")? {
        let path = format!("clips/{id}");
        let mut list = Vec::new();
        for (cid, ch) in section(c, "channels")? {
            list.push(channel_of(
                cid,
                ch,
                true,
                &ctx,
                &transport,
                &format!("{path}/channels/{cid}"),
                &mut labels,
            )?);
        }
        let last = list
            .iter()
            .filter_map(|c| c.curve.keys.last().map(|k| k.t))
            .max()
            .unwrap_or(0);
        let span = match c.get("span") {
            None => last,
            Some(Value::String(s)) if s == "auto" => last,
            v => time_of(v, &ctx, &format!("{path}/span"))?,
        };
        if span <= 0 {
            return refuse("bad_time", format!("{path}/span"));
        }
        clips.push(Clip {
            id: id.clone(),
            span,
            channels: list,
        });
    }
    let mut raw = Vec::new();
    for (id, p) in section(doc, "placements")? {
        raw.push(placement_of(
            id,
            p,
            &clips,
            &ctx,
            doc.get("layers").and_then(Value::as_object),
        )?);
    }
    let mut placements = resolve_series(raw, &clips, seed)?;
    let cuts = cuts_of(doc, &mut placements, &clips)?;
    let parents = parents_of(doc)?;
    let mut drivers = Vec::new();
    for (id, d) in section(doc, "drivers")? {
        drivers.push(driver_of(id, d)?);
    }
    let remaps = remaps_of(doc, &transport, &ctx, &mut placements, &clips)?;
    let mut control_defaults = Vec::new();
    for (id, c) in section(doc, "controls")? {
        let default = match c.get("default") {
            Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
            Some(Value::Bool(b)) => f64::from(u8::from(*b)),
            _ => 0.0,
        };
        control_defaults.push((id.clone(), default));
        control_defaults.extend(crate::hover::defaults(id, c));
    }
    let mut limits = Vec::new();
    let mut constraints = Vec::new();
    for (id, c) in section(doc, "constraints")? {
        if let Some(limit) = limit_of(id, c)? {
            limits.push(limit);
        } else {
            constraints.push(constraint_of(id, c)?);
        }
    }
    Ok(Motion {
        transport,
        channels,
        follows,
        staggers,
        controls,
        shots,
        cameras,
        drivers,
        limits,
        constraints,
        control_defaults,
        clips,
        placements,
        markers,
        firsts,
        parents,
        cuts,
        frame_rate,
        labels,
        remaps,
        worlds: section(doc, "worlds")?
            .into_iter()
            .map(|(id, w)| {
                (
                    id.clone(),
                    w.get("inputs")
                        .and_then(Value::as_object)
                        .is_some_and(|i| !i.is_empty()),
                )
            })
            .collect(),
        notices: ctx.notices.take(),
    })
}

/// The document's time remaps (Time remap), outer targets first, so nested remaps compose outer
/// to inner. Each map compiles to closed-form pieces, here or, for what reads occurrences or the
/// input track, in the program. A placement target points the placement at its remap.
fn remaps_of(
    doc: &Map<String, Value>,
    transport: &Transport,
    ctx: &Ctx,
    placements: &mut [Placement],
    clips: &[Clip],
) -> Result<Vec<Remap>, Refused> {
    let mut out = Vec::new();
    for (id, r) in section(doc, "time_remaps")? {
        let path = format!("time_remaps/{id}");
        let Some(target) = r.get("target").and_then(Value::as_str) else {
            return refuse("ref_unresolved", format!("{path}/target"));
        };
        let placed = placements.iter().find(|p| p.id == target);
        let span = match placed {
            Some(p) => Some(
                i64::from(p.count) * clips.iter().find(|c| c.id == p.clip).map_or(1, |c| c.span),
            ),
            None => transport.span.filter(|s| *s > 0),
        };
        let (segs, pending) = map_of(r, span, ctx, transport, &path)?;
        out.push(Remap {
            id: id.clone(),
            target: target.to_string(),
            segs,
            pending,
            clamp: r.get("clamp").and_then(Value::as_bool).unwrap_or(true),
        });
    }
    out.sort_by_key(|r| r.target.matches('.').count());
    for (i, r) in out.iter().enumerate() {
        if let Some(p) = placements.iter_mut().find(|p| p.id == r.target) {
            p.timing.remap = Some(i);
        }
    }
    Ok(out)
}

/// A remap's `map`: a preset by name with `{<preset>: fields}`, `reverse`, or a channel of keys.
fn map_of(
    r: &Map<String, Value>,
    span: Option<i64>,
    ctx: &Ctx,
    transport: &Transport,
    path: &str,
) -> Result<(Vec<remap::Seg>, Option<Pending>), Refused> {
    let mpath = format!("{path}/map");
    let Some(map) = r.get("map") else {
        return refuse("out_of_range", mpath);
    };
    if map.as_str() == Some("reverse") {
        let Some(span) = span else {
            return refuse("bad_time", "transport/span");
        };
        return Ok((remap::reverse(span), None));
    }
    let Value::Object(o) = map else {
        return refuse("out_of_range", mpath);
    };
    if o.contains_key("keys") {
        let mut labels = Vec::new();
        let channel = channel_of(
            "map",
            &with_target(o),
            false,
            ctx,
            transport,
            &mpath,
            &mut labels,
        )?;
        return Ok((
            vec![remap::Seg {
                t: i64::MIN / 2,
                c: 0,
                piece: remap::Piece::Map(channel.curve),
                active: None,
            }],
            None,
        ));
    }
    let Some((name, Value::Object(f))) = o.iter().next() else {
        return refuse("out_of_range", mpath);
    };
    let at = format!("{mpath}/{name}");
    let time = |key: &str| time_of(f.get(key), ctx, &format!("{at}/{key}"));
    let time_or = |key: &str, d: i64| {
        if f.contains_key(key) {
            time(key)
        } else {
            Ok(d)
        }
    };
    let rational = |key: &str, d: Ratio| {
        f.get(key)
            .map_or(Ok(d), |v| ratio_of(v, &format!("{at}/{key}")))
    };
    let times = |key: &str| -> Result<Vec<i64>, Refused> {
        let Some(Value::Array(list)) = f.get(key) else {
            return refuse("bad_doc", format!("{at}/{key}"));
        };
        list.iter()
            .enumerate()
            .map(|(i, v)| time_of(Some(v), ctx, &format!("{at}/{key}/{i}")))
            .collect()
    };
    Ok(match name.as_str() {
        "hold_at" => (remap::hold_at(time("at")?, time("for")?), None),
        "ramp" => {
            let ease = match f.get("ease") {
                None => Named::Penner(ease::Family::Quad, ease::Side::InOut),
                Some(e) => named_of(e, &format!("{at}/ease"))?,
            };
            let to = rational("to", (1, 1))?;
            (
                remap::ramp(
                    rational("from", (1, 1))?,
                    to,
                    time("at")?,
                    time("over")?,
                    ease,
                ),
                None,
            )
        }
        "hitstop" => {
            let hold = time_or("hold", FLICKS_PER_SECOND * 3 / 25)?;
            if hold <= 0 || hold > FLICKS_PER_SECOND / 4 {
                return refuse("out_of_range", format!("{at}/hold"));
            }
            let rejoin = match f.get("then").and_then(Value::as_str) {
                None | Some("lag") => false,
                Some("rejoin") => true,
                Some(_) => return refuse("bad_doc", format!("{at}/then")),
            };
            let on = f
                .get("on")
                .map(|on| list_of(on, &format!("{at}/on")))
                .transpose()?;
            let at_times = if f.contains_key("at") {
                times("at")?
            } else {
                Vec::new()
            };
            if on.is_none() && at_times.is_empty() {
                return refuse("bad_doc", at);
            }
            (
                Vec::new(),
                Some(Pending::Hitstop {
                    at: at_times,
                    on,
                    hold,
                    rejoin,
                }),
            )
        }
        "replay" => {
            let rate = rational("rate", (1, 4))?;
            if rate.0 <= 0 || rate.0 > rate.1 {
                return refuse("out_of_range", format!("{at}/rate"));
            }
            let on = match (f.get("on"), f.get("control").and_then(Value::as_str)) {
                (Some(on), None) => list_of(on, &format!("{at}/on"))?,
                (None, Some(control)) => filter_named(&format!("input.{control}")),
                _ => return refuse("bad_doc", at),
            };
            let (before, after) = (
                time_or("before", 2 * FLICKS_PER_SECOND)?,
                time_or("after", FLICKS_PER_SECOND / 2)?,
            );
            (
                Vec::new(),
                Some(Pending::Replay {
                    on,
                    before,
                    after,
                    rate,
                }),
            )
        }
        "scrub" => match f.get("control").and_then(Value::as_str) {
            Some(control) => (
                Vec::new(),
                Some(Pending::Scrub {
                    control: control.to_string(),
                }),
            ),
            None => return refuse("bad_doc", format!("{at}/control")),
        },
        _ => return refuse("out_of_range", mpath),
    })
}

/// A `map` channel as a channel: its target names nothing it writes.
fn with_target(o: &Map<String, Value>) -> Map<String, Value> {
    let mut c = o.clone();
    c.entry("target")
        .or_insert(Value::String("data/map".into()));
    c
}

/// FNV-1a over a string's bytes: the seed a document without one takes from its ID, and what a
/// placement's ID adds to it, until the design's `hash@1` is defined.
fn fnv1a(text: &str) -> u64 {
    text.bytes().fold(0xcbf2_9ce4_8422_2325, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0000_0100_0000_01b3)
    })
}

/// The cut transitions (canvas primitives: Transition, R1 `cut`): each joins two adjacent
/// placements, the second starting exactly where the first ends, and switches between them with
/// no blend. At a cut the outgoing placement stops writing and the incoming one starts, whatever
/// their `extend` says, so neither hides the cut. Every other kind lands in R6.
fn cuts_of(
    doc: &Map<String, Value>,
    placements: &mut [Placement],
    clips: &[Clip],
) -> Result<Vec<Cut>, Refused> {
    let mut cuts = Vec::new();
    let shots = doc.get("shots").and_then(Value::as_object);
    for (id, tr) in section(doc, "transitions")? {
        let path = format!("transitions/{id}");
        // #493: a transition between shots is the shots' (crate::shots).
        let names_shot = |f: &str| {
            tr.get(f)
                .and_then(Value::as_str)
                .is_some_and(|n| shots.is_some_and(|s| s.contains_key(n)))
        };
        if names_shot("from") || names_shot("to") {
            continue;
        }
        // #494: a match morph between two items is the morph's (crate::morph).
        let items = doc.get("items").and_then(Value::as_object);
        let names_item = |f: &str| {
            tr.get(f)
                .and_then(Value::as_str)
                .is_some_and(|n| items.is_some_and(|i| i.contains_key(n)))
        };
        if tr.get("kind").and_then(Value::as_str) == Some("match_morph")
            && (names_item("from") || names_item("to"))
        {
            continue;
        }
        match tr.get("kind").and_then(Value::as_str) {
            None | Some("cut") => {}
            Some(_) => return refuse("transition_kind", format!("{path}/kind")),
        }
        let find = |field: &str| -> Result<usize, Refused> {
            let name = tr.get(field).and_then(Value::as_str);
            name.and_then(|n| placements.iter().position(|p| p.id == n))
                .ok_or(Refused {
                    code: "ref_unresolved",
                    path: format!("{path}/{field}"),
                    detail: None,
                })
        };
        let (from, to) = (find("from")?, find("to")?);
        let span = |p: &Placement| {
            p.active_for(clips.iter().find(|c| c.id == p.clip).map_or(1, |c| c.span))
        };
        let out = &placements[from];
        let reach = out.bindings.iter().map(|b| b.delay).max().unwrap_or(0);
        let end = out.start + reach + span(out);
        if placements[to].start != end {
            return refuse("transition_gap", path);
        }
        placements[from].after = Extend::None;
        placements[to].before = Extend::None;
        cuts.push(Cut {
            id: id.clone(),
            from: placements[from].id.clone(),
            to: placements[to].id.clone(),
            at: end,
        });
    }
    Ok(cuts)
}

/// The marker kinds (canvas primitives: Marker), with a reading hold (#419), which motion blur
/// never spans. #407: a stage marker plays through outside present mode (Marker: present mode);
/// one that waits for a control holds even there, which motion doesn't land yet, so that one is
/// refused rather than played through.
pub(crate) const MARKER_KINDS: [&str; 9] = [
    "cue", "shot", "section", "stage", "beat", "word", "moment", "record", "hold",
];

/// Resolves every marker at check, in dependency order: a marker whose time names another marker
/// waits for it, so a relative time keeps its offset when its marker moves. One that never
/// resolves, through a cycle or a missing marker, is refused, naming it. A `first` marker (#491)
/// is solved later, from the channels, and comes back unsolved.
pub(crate) fn markers_of(
    doc: &Map<String, Value>,
    ctx: &mut Ctx,
) -> Result<(Vec<Marker>, Vec<First>), Refused> {
    let (mut pending, mut firsts) = (Vec::new(), Vec::new());
    crate::pace::seed(doc, ctx);
    for (id, m) in section(doc, "markers")? {
        let path = format!("markers/{id}");
        let kind = m.get("kind").and_then(Value::as_str).unwrap_or("cue");
        if !MARKER_KINDS.contains(&kind) {
            return refuse("bad_marker_kind", format!("{path}/kind"));
        }
        if kind == "stage" && m.get("waits_for").is_some() {
            return refuse("bad_marker_kind", format!("{path}/waits_for"));
        }
        // Word markers come only from a bake; beat markers from the tempo map or a beats bake.
        let on_beat = matches!(
            m.get("t").and_then(Value::as_str).map(Time::parse),
            Some(Ok(Time::Beats { .. }))
        );
        if kind == "word" || (kind == "beat" && !(on_beat && ctx.tempo.is_some())) {
            return Err(Refused {
                code: "marker_needs_bake",
                path: format!("{path}/t"),
                detail: Some(Box::new(serde_json::json!({"marker": id, "kind": kind}))),
            });
        }
        let tags = match m.get("tags") {
            None => Vec::new(),
            Some(Value::Array(t)) if t.iter().all(Value::is_string) => t
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect(),
            Some(_) => return refuse("bad_doc", format!("{path}/tags")),
        };
        let marker = Marker {
            id: id.clone(),
            kind: kind.to_string(),
            start: 0,
            end: 0,
            tags,
            payload: m.get("payload").cloned().unwrap_or(Value::Null),
        };
        if let Some(Value::Object(f)) = m.get("t").and_then(|t| t.get("first")) {
            firsts.push((first_of(marker, f, &path)?, f, m.get("span")));
            continue;
        }
        pending.push((marker, m, path));
    }
    // Cue alignment (#491) moves markers onto their anchors, so the markers are resolved again
    // with the moved ones pinned, and a time relative to one keeps its offset.
    // The first pass raises each literal's notice, as written; the second only re-times.
    let mut done = resolve_markers(pending.clone(), ctx, &BTreeMap::new())?;
    let (pins, moved) = crate::cue::align(doc, &done, ctx.tempo.as_ref())?;
    if !pins.is_empty() {
        let notices = ctx.notices.borrow().len();
        crate::pace::reseed(doc, ctx);
        done = resolve_markers(pending, ctx, &pins)?;
        crate::cue::landed(doc, &done, ctx.tempo.as_ref(), &pins)?;
        ctx.notices.borrow_mut().truncate(notices);
    }
    ctx.notices.borrow_mut().extend(moved);
    done.sort_by(|a, b| a.id.cmp(&b.id));
    // A first marker's window and span resolve once the markers they may name have.
    let firsts = firsts
        .into_iter()
        .map(
            |(mut first, f, span): (First, &Map<String, Value>, Option<&Value>)| {
                first.after = time_of(f.get("after"), ctx, &format!("{}/after", first.path))?;
                first.before = time_of(f.get("before"), ctx, &format!("{}/before", first.path))?;
                first.span = match span {
                    None => 0,
                    v => time_of(v, ctx, &format!("markers/{}/span", first.marker.id))?,
                };
                if first.before < first.after || first.span < 0 {
                    return refuse("bad_time", first.path.clone());
                }
                Ok(first)
            },
        )
        .collect::<Result<_, _>>()?;
    Ok((done, firsts))
}

/// One pass of marker resolution in dependency order, each pinned marker at its pin.
fn resolve_markers(
    pending: Vec<(Marker, &Map<String, Value>, String)>,
    ctx: &mut Ctx,
    pins: &BTreeMap<String, i64>,
) -> Result<Vec<Marker>, Refused> {
    let mut done: Vec<Marker> = Vec::new();
    let mut pending = pending;
    while !pending.is_empty() {
        let before = pending.len();
        let mut waiting = Vec::new();
        for (mut marker, m, path) in pending {
            let start = match pins.get(&marker.id) {
                Some(&pin) => Ok(pin),
                None => placed_time_of(m.get("t"), ctx, &format!("{path}/t"), &marker.id),
            };
            match start {
                Ok(start) => {
                    let span = match m.get("span") {
                        None => 0,
                        v => time_of(v, ctx, &format!("{path}/span"))?,
                    };
                    if span < 0 {
                        return refuse("bad_time", format!("{path}/span"));
                    }
                    ctx.markers.insert(marker.id.clone(), (start, start + span));
                    (marker.start, marker.end) = (start, start + span);
                    done.push(marker);
                }
                Err(_) => waiting.push((marker, m, path)),
            }
        }
        if waiting.len() == before {
            let (marker, m, path) = &waiting[0];
            // The refusal that kept it: a time off the tempo map says why.
            let mut r = placed_time_of(m.get("t"), ctx, &format!("{path}/t"), &marker.id)
                .err()
                .unwrap_or(Refused {
                    code: "time_unresolved",
                    path: format!("{path}/t"),
                    detail: None,
                });
            if r.code == "bad_time" {
                r.code = "time_unresolved";
            }
            return Err(r);
        }
        pending = waiting;
    }
    Ok(done)
}

/// A marker at the first flick in [after, before] where `expr ≥ 0` (#491), read at check and
/// solved once the channels it reads are compiled.
#[derive(Clone, Debug, PartialEq)]
pub struct First {
    pub marker: Marker,
    pub span: i64,
    pub expr: String,
    /// Each var's name and the item path it reads (`None` for `time`), in name order.
    pub vars: Vec<(String, Option<Target>)>,
    pub after: i64,
    pub before: i64,
    pub path: String,
}

fn first_of(marker: Marker, f: &Map<String, Value>, path: &str) -> Result<First, Refused> {
    let path = format!("{path}/t/first");
    let Some(Value::String(expr)) = f.get("expr") else {
        return refuse("bad_doc", format!("{path}/expr"));
    };
    let mut vars = Vec::new();
    for (name, v) in f
        .get("vars")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let vpath = format!("{path}/vars/{name}");
        let Value::String(text) = v else {
            return refuse("bad_path", vpath);
        };
        if text == "time" {
            vars.push((name.clone(), None));
            continue;
        }
        // The input track has no values after t yet, so a first time can't read it.
        if text.starts_with("controls/") || text.starts_with("input") {
            return Err(Refused {
                code: "first_reads_input",
                path: vpath,
                detail: Some(Box::new(serde_json::json!({"marker": marker.id}))),
            });
        }
        vars.push((name.clone(), Some(target_of(text, false, &vpath)?)));
    }
    vars.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(First {
        marker,
        span: 0,
        expr: expr.clone(),
        vars,
        after: 0,
        before: 0,
        path,
    })
}

/// A placement's start before series are resolved: its own time, or after another placement.
pub(crate) enum Start {
    At(i64),
    After { placement: String, offset: i64 },
}

/// The order a stagger starts its targets in.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Order {
    Index,
    Reverse,
    /// A permutation drawn from the document's seed and the placement's ID, the same on every
    /// machine and at every evaluation.
    Seeded,
}

struct Raw {
    placement: Placement,
    start: Start,
    /// The stagger's lag between consecutive targets, as a ratio of the placement's span or in
    /// flicks, and its order.
    lag: Option<(Lag, Order)>,
}

#[derive(Clone, Copy)]
enum Lag {
    Ratio(f64),
    Flicks(i64),
}

fn placement_of(
    id: &str,
    p: &Map<String, Value>,
    clips: &[Clip],
    ctx: &Ctx,
    doc_layers: Option<&Map<String, Value>>,
) -> Result<Raw, Refused> {
    let path = format!("placements/{id}");
    let Some(Value::String(clip)) = p.get("clip") else {
        return refuse("bad_doc", format!("{path}/clip"));
    };
    if !clips.iter().any(|c| &c.id == clip) {
        return refuse("ref_unresolved", format!("{path}/clip"));
    }
    let mut bindings = Vec::new();
    if let Some(Value::Object(map)) = p.get("slots") {
        for (slot, items) in map {
            let list: Vec<&Value> = match items {
                Value::Array(list) => list.iter().collect(),
                one => vec![one],
            };
            for item in list {
                let Value::String(item) = item else {
                    return refuse("bad_doc", format!("{path}/slots/{slot}"));
                };
                bindings.push(Binding {
                    slot: slot.clone(),
                    item: item.clone(),
                    delay: 0,
                });
            }
        }
    }
    let start = match (p.get("start"), p.get("after")) {
        (Some(t), None) => Start::At(placed_time_of(Some(t), ctx, &format!("{path}/start"), id)?),
        (None, Some(Value::String(after))) => Start::After {
            placement: after.clone(),
            offset: match p.get("offset") {
                None => 0,
                Some(Value::String(o)) => {
                    let (negative, body) = match o.strip_prefix('-') {
                        Some(body) => (true, body),
                        None => (false, o.as_str()),
                    };
                    let flicks = time_of(
                        Some(&Value::String(body.to_string())),
                        ctx,
                        &format!("{path}/offset"),
                    )?;
                    if negative {
                        -flicks
                    } else {
                        flicks
                    }
                }
                Some(_) => return refuse("bad_time", format!("{path}/offset")),
            },
        },
        (None, None) if p.contains_key("start_on") => Start::At(0),
        _ => return refuse("bad_doc", format!("{path}/start")),
    };
    let mut timing = Timing::default();
    let flick = |key: &str| -> Result<Option<i64>, Refused> {
        match p.get(key) {
            None => Ok(None),
            Some(Value::String(s)) if s == "none" || s == "auto" => Ok(None),
            v => time_of(v, ctx, &format!("{path}/{key}")).map(Some),
        }
    };
    timing.trim = flick("in")?.unwrap_or(0);
    timing.span = crate::pace::span(p, &start, flick("span")?, ctx, &path)?;
    timing.hold_at = flick("hold_at")?;
    if let Some(rate) = p.get("rate") {
        timing.rate = ratio_of(rate, &format!("{path}/rate"))?;
        if timing.rate.0 <= 0 {
            return refuse("out_of_range", format!("{path}/rate"));
        }
    }
    timing.quantize = match p.get("quantize") {
        None => None,
        Some(Value::String(s)) if s == "none" => None,
        Some(v) => {
            let (num, den) = ratio_of(v, &format!("{path}/quantize"))?;
            let whole = FLICKS_PER_SECOND
                .checked_mul(den)
                .is_some_and(|f| num > 0 && f % num == 0);
            match (u32::try_from(num), u32::try_from(den)) {
                (Ok(num), Ok(den)) if whole => Some((num, den)),
                _ => return refuse("bad_rate", format!("{path}/quantize")),
            }
        }
    };
    timing.start_on = match p.get("start_on") {
        None => None,
        Some(Value::Object(o)) => Some(start_on_of(o, &format!("{path}/start_on"))?),
        Some(_) => return refuse("bad_doc", format!("{path}/start_on")),
    };
    let blending = blending_of(p, ctx, &path)?;
    let count = match p.get("repeat") {
        None => 1,
        Some(Value::Object(r)) => {
            match r.get("mode").and_then(Value::as_str) {
                None | Some("wrap") => {}
                Some("ping_pong") => timing.repeat = Repeat::PingPong,
                Some(_) => return refuse("bad_doc", format!("{path}/repeat/mode")),
            }
            match r.get("count").and_then(Value::as_u64) {
                Some(n) if n >= 1 => u32::try_from(n)
                    .or_else(|_| refuse("out_of_range", format!("{path}/repeat/count")))?,
                _ => return refuse("out_of_range", format!("{path}/repeat/count")),
            }
        }
        Some(_) => return refuse("bad_doc", format!("{path}/repeat")),
    };
    let (before, after) = match p.get("extend") {
        None => (Extend::None, Extend::None),
        Some(Value::Object(e)) => (
            extend_of(e.get("before"), &format!("{path}/extend/before"))?,
            extend_of(e.get("after"), &format!("{path}/extend/after"))?,
        ),
        Some(_) => return refuse("bad_doc", format!("{path}/extend")),
    };
    let lag = match p.get("stagger") {
        None => None,
        Some(Value::Object(st)) => {
            let (lag, order, reverse_on_close) = stagger_of(st, ctx, &format!("{path}/stagger"))?;
            if reverse_on_close {
                timing.reach = Some(0);
            }
            Some((lag, order))
        }
        Some(_) => return refuse("bad_doc", format!("{path}/stagger")),
    };
    Ok(Raw {
        placement: Placement {
            id: id.to_string(),
            clip: clip.clone(),
            bindings,
            start: 0,
            count,
            before,
            after,
            timing,
            blending,
            rank: (
                layer_key(doc_layers, p.get("layer")),
                p.get("order")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            ),
        },
        start,
        lag,
    })
}

/// A stagger's lag (a ratio, or a time), its order and `reverse_on_close` (Placement and Follow:
/// `stagger`).
fn stagger_of(
    st: &Map<String, Value>,
    ctx: &Ctx,
    path: &str,
) -> Result<(Lag, Order, bool), Refused> {
    let lag = match st.get("lag") {
        Some(Value::String(text)) => Lag::Flicks(time_of(
            Some(&Value::String(text.clone())),
            ctx,
            &format!("{path}/lag"),
        )?),
        Some(v) => match v.as_f64() {
            Some(r) if r.is_finite() && r >= 0.0 => Lag::Ratio(r),
            _ => return refuse("out_of_range", format!("{path}/lag")),
        },
        None => return refuse("bad_doc", format!("{path}/lag")),
    };
    let reverse_on_close = st.get("reverse_on_close").and_then(Value::as_bool) == Some(true);
    let order = match st.get("order").and_then(Value::as_str) {
        None | Some("index") => Order::Index,
        Some("reverse") => Order::Reverse,
        Some("seeded") => Order::Seeded,
        Some(_) => return refuse("bad_doc", format!("{path}/order")),
    };
    Ok((lag, order, reverse_on_close))
}

/// Each of `n` targets' rank in a stagger's `order`: its index, reversed, or a Fisher–Yates
/// permutation drawn from `seed`, the same on every machine and at every evaluation.
fn ranks(n: usize, order: Order, seed: u64) -> Vec<usize> {
    let mut shuffled: Vec<usize> = (0..n).collect();
    if order == Order::Seeded {
        let mut rng = Seeded::new(seed);
        for i in (1..n).rev() {
            let j = rng.below(i as u64 + 1) as usize;
            shuffled.swap(i, j);
        }
    }
    (0..n)
        .map(|i| match order {
            Order::Index => i,
            Order::Reverse => n - 1 - i,
            Order::Seeded => shuffled[i],
        })
        .collect()
}

/// #504: a take-apart, a follow channel whose `follow.stagger.targets` are assemblies. Its
/// targets rank by (the assembly's `order`, their place in the list), then by the stagger's
/// order; a ratio lag is of the transition's span.
fn take_apart_of(
    id: &str,
    f: &Map<String, Value>,
    doc: &Map<String, Value>,
    ctx: &Ctx,
    seed: u64,
) -> Result<Stagger, Refused> {
    let path = format!("channels/{id}/follow");
    let spec = follow_spec_of(f, ctx, &path)?;
    let spath = format!("{path}/stagger");
    let Some(Value::Object(st)) = f.get("stagger") else {
        return refuse("bad_doc", spath);
    };
    let (lag, order, reverse_on_close) = stagger_of(st, ctx, &spath)?;
    let Some(Value::Array(list)) = st.get("targets") else {
        return refuse("bad_doc", format!("{spath}/targets"));
    };
    let assemblies = doc.get("assemblies").and_then(Value::as_object);
    let mut ids = Vec::with_capacity(list.len());
    let mut orders = Vec::with_capacity(list.len());
    for (i, t) in list.iter().enumerate() {
        let at = format!("{spath}/targets/{i}");
        let Some(name) = t.as_str() else {
            return refuse("bad_doc", at);
        };
        let Some(a) = assemblies.and_then(|m| m.get(name)) else {
            return refuse("ref_unresolved", at);
        };
        ids.push(name.to_string());
        orders.push(a.get("order").and_then(Value::as_u64).unwrap_or(0));
    }
    let n = ids.len();
    let mut sequence: Vec<usize> = (0..n).collect();
    sequence.sort_by_key(|&i| (orders[i], i));
    let r = ranks(n, order, seed ^ fnv1a(id));
    let mut targets = vec![(String::new(), 0); n];
    for (place, &i) in sequence.iter().enumerate() {
        targets[i] = (ids[i].clone(), r[place]);
    }
    let lag = match (lag, spec.model) {
        (Lag::Flicks(f), _) => f,
        (Lag::Ratio(x), follow::Model::Transition { span, .. }) => (x * span as f64).floor() as i64,
        (Lag::Ratio(_), _) => return refuse("bad_doc", format!("{spath}/lag")),
    };
    Ok(Stagger {
        id: id.to_string(),
        spec,
        targets,
        lag,
        reverse_on_close,
    })
}

/// #504: the input track a played form carries inline, `track: [{t: flick, control, value,
/// seq, player}]`, as the hub inlines it beside the saved document; `None` without one. An
/// entry's `seq` is its place in the list where it names none, and its player is 1.
pub fn track(doc: &Map<String, Value>) -> Result<Option<Vec<crate::input::Entry>>, Refused> {
    let list = match doc.get("track") {
        None | Some(Value::Null) => return Ok(None),
        Some(Value::Array(list)) => list,
        Some(_) => return refuse("bad_doc", "track"),
    };
    let mut out = Vec::with_capacity(list.len());
    for (i, e) in list.iter().enumerate() {
        let at = |f: &str| format!("track/{i}/{f}");
        let Some(t) = e.get("t").and_then(Value::as_i64) else {
            return refuse("bad_doc", at("t"));
        };
        let Some(control) = e.get("control").and_then(Value::as_str) else {
            return refuse("bad_doc", at("control"));
        };
        let Some(value) = e.get("value") else {
            return refuse("bad_doc", at("value"));
        };
        let seq = match e.get("seq") {
            None => i as i64,
            Some(s) => s
                .as_i64()
                .map_or_else(|| refuse("bad_doc", at("seq")), Ok)?,
        };
        let player = match e.get("player") {
            None => 1,
            Some(p) => p
                .as_i64()
                .filter(|p| (1..=8).contains(p))
                .map_or_else(|| refuse("out_of_range", at("player")), Ok)?,
        };
        out.push(crate::input::Entry {
            t,
            seq,
            control: control.to_string(),
            value: value.clone(),
            player,
        });
    }
    Ok(Some(out))
}

/// A placement's writer layer's order key, empty with none.
fn layer_key(layers: Option<&Map<String, Value>>, layer: Option<&Value>) -> String {
    layer
        .and_then(Value::as_str)
        .and_then(|l| layers?.get(l)?.get("order")?.as_str())
        .unwrap_or_default()
        .to_string()
}

/// A rational: `"p/q"`, `[p, q]` or a number, as whole parts in lowest terms.
fn ratio_of(v: &Value, path: &str) -> Result<Ratio, Refused> {
    let fraction = deep_canvas::document::frame_rate_of(&serde_json::json!({ "frame_rate": v }))
        .map(|(p, q)| (i64::from(p), i64::from(q)));
    let parsed = match v {
        Value::Number(n) => n.as_f64().and_then(decimal_ratio),
        _ => fraction,
    };
    match parsed {
        Some((p, q)) if q > 0 => {
            let d = gcd(p, q).max(1);
            Ok((p / d, q / d))
        }
        _ => refuse("out_of_range", path),
    }
}

/// A number's exact fraction over a power of ten, for the decimals a document writes.
fn decimal_ratio(x: f64) -> Option<Ratio> {
    if !x.is_finite() {
        return None;
    }
    let scale = 1_000_000_i64;
    let num = (x * scale as f64).round();
    ((num / scale as f64 - x).abs() < 1e-12 && num.abs() < 9e15).then_some((num as i64, scale))
}

fn gcd(a: i64, b: i64) -> i64 {
    if b == 0 {
        a.abs()
    } else {
        gcd(b, a % b)
    }
}

/// `start_on`: `{control, each, policy}`, or `{on: <list>, policy}`, as an occurrence filter.
fn start_on_of(o: &Map<String, Value>, path: &str) -> Result<StartOn, Refused> {
    let policy = match o.get("policy").and_then(Value::as_str) {
        None | Some("restart") => Policy::Restart,
        Some("overlap") => Policy::Overlap,
        Some("ignore") => Policy::Ignore,
        Some(_) => return refuse("bad_doc", format!("{path}/policy")),
    };
    let change = match o.get("each").and_then(Value::as_str) {
        None | Some("entry") => false,
        Some("change") => true,
        Some(_) => return refuse("bad_doc", format!("{path}/each")),
    };
    let mut on = match (o.get("control").and_then(Value::as_str), o.get("on")) {
        (Some(control), None) => filter_named(&format!("input.{control}")),
        (None, Some(on)) => list_of(on, &format!("{path}/on"))?,
        _ => return refuse("bad_doc", path),
    };
    // `{on: <logic ID>.occurrences, kinds: [...]}`: the filter's kinds beside the list (#544).
    if let Some(kinds) = o.get("kinds") {
        let kinds = kinds
            .as_array()
            .and_then(|a| a.iter().map(|k| k.as_str().map(str::to_string)).collect());
        on.kinds = Some(kinds.ok_or_else(|| Refused {
            code: "bad_doc",
            path: format!("{path}/kinds"),
            detail: None,
        })?);
    }
    Ok(StartOn { on, change, policy })
}

/// The whole of a named occurrence list.
fn filter_named(list: &str) -> crate::occurrence::Filter {
    crate::occurrence::Filter {
        list: list.to_string(),
        kinds: None,
        a: None,
        b: None,
        tags: Vec::new(),
        where_: None,
    }
}

/// An occurrence list and its filter: its name, or `{list, kinds, a, b, tags, where}`.
fn list_of(v: &Value, path: &str) -> Result<crate::occurrence::Filter, Refused> {
    match v {
        Value::String(list) => Ok(filter_named(list)),
        Value::Object(f) => filter_of(f, path),
        _ => refuse("bad_doc", path),
    }
}

fn blending_of(p: &Map<String, Value>, ctx: &Ctx, path: &str) -> Result<Blending, Refused> {
    let blend = match p.get("blend").and_then(Value::as_str) {
        None | Some("replace") => Blend::Replace,
        Some("add") => Blend::Add,
        Some("multiply") => Blend::Multiply,
        Some("mix") => Blend::Mix,
        Some(_) => return refuse("bad_doc", format!("{path}/blend")),
    };
    let ipath = format!("{path}/influence");
    let influence = match p.get("influence") {
        None => Influence::Value(1.0),
        Some(Value::Number(n)) => Influence::Value(n.as_f64().unwrap_or(1.0)),
        Some(Value::String(s)) => match s
            .strip_prefix("controls/")
            .and_then(|r| r.strip_suffix("/value"))
        {
            Some(control) => Influence::Control(control.to_string()),
            None => return refuse("bad_path", ipath),
        },
        Some(Value::Object(c)) => {
            let Some(Value::Object(keys)) = c.get("keys") else {
                return refuse("bad_doc", ipath);
            };
            let mut list = Vec::new();
            for (id, key) in keys {
                let kpath = format!("{ipath}/keys/{id}");
                let t = time_of(key.get("t"), ctx, &format!("{kpath}/t"))?;
                let value = number(key.get("value"), &format!("{kpath}/value"))?;
                list.push(Key::new(
                    id,
                    t,
                    vec![value],
                    interp_of(key.get("interp"), &format!("{kpath}/interp"))?,
                ));
            }
            Influence::Keys(Curve::new(list))
        }
        Some(_) => return refuse("bad_doc", ipath),
    };
    let add_from = match p.get("add_from") {
        None => AddFrom::First,
        Some(Value::String(s)) if s == "first" => AddFrom::First,
        Some(Value::String(s)) if s == "bind" => AddFrom::Bind,
        Some(Value::Object(o)) if o.contains_key("t") => {
            AddFrom::At(time_of(o.get("t"), ctx, &format!("{path}/add_from/t"))?)
        }
        Some(_) => return refuse("bad_doc", format!("{path}/add_from")),
    };
    let fade = |key: &str| match p.get(key) {
        None => Ok(0),
        v => time_of(v, ctx, &format!("{path}/{key}")),
    };
    let switch = match p.get("switch") {
        None => None,
        Some(Value::Object(s)) => Some(switch_of(s, ctx, &format!("{path}/switch"))?),
        Some(_) => return refuse("bad_doc", format!("{path}/switch")),
    };
    Ok(Blending {
        blend,
        influence,
        add_from,
        fade_in: fade("fade_in")?,
        fade_out: fade("fade_out")?,
        switch,
    })
}

/// `switch: {control, case, span, ease}`, its changes filled from the track by the program.
fn switch_of(s: &Map<String, Value>, ctx: &Ctx, path: &str) -> Result<Switch, Refused> {
    let (Some(Value::String(control)), Some(case)) = (s.get("control"), s.get("case")) else {
        return refuse("bad_doc", path);
    };
    let span = time_of(s.get("span"), ctx, &format!("{path}/span"))?;
    if span <= 0 {
        return refuse("bad_time", format!("{path}/span"));
    }
    let along = match (s.get("ease"), s.get("spring")) {
        (None, None) => Along::Ease(Named::Penner(ease::Family::Quad, ease::Side::InOut)),
        (Some(e), None) => Along::Ease(named_of(e, &format!("{path}/ease"))?),
        (None, Some(Value::Object(spring))) => {
            Along::Spring(spring_of(spring, &format!("{path}/spring"))?)
        }
        _ => return refuse("bad_doc", path),
    };
    let sync = match s.get("sync").and_then(Value::as_str) {
        None | Some("none") => false,
        Some("next_loop_phase") => true,
        Some(_) => return refuse("bad_doc", format!("{path}/sync")),
    };
    Ok(Switch {
        control: control.clone(),
        case: case.clone(),
        span,
        along,
        sync,
        first: Value::Null,
        changes: Vec::new(),
    })
}

/// Resolves each placement's start, in dependency order: one `after` another starts at that one's
/// end plus its offset. A cycle, or an `after` naming no placement, is refused, naming the
/// placement. Then each target's stagger delay: target i of n starts i × lag × d later, with d the
/// placement's active span, so the whole takes d × ((n − 1) × lag + 1).
fn resolve_series(raw: Vec<Raw>, clips: &[Clip], seed: u64) -> Result<Vec<Placement>, Refused> {
    let span_of =
        |p: &Placement| p.active_for(clips.iter().find(|c| c.id == p.clip).map_or(1, |c| c.span));
    let mut placed: Vec<Raw> = raw;
    for r in &mut placed {
        let d = span_of(&r.placement);
        if let Some((lag, order)) = r.lag {
            let step = match lag {
                Lag::Ratio(x) => (x * d as f64).floor() as i64,
                Lag::Flicks(f) => f,
            };
            // The targets' ranks, a seeded order drawn from the seed and the placement's ID.
            let ranks = ranks(
                r.placement.bindings.len(),
                order,
                seed ^ fnv1a(&r.placement.id),
            );
            for (b, rank) in r.placement.bindings.iter_mut().zip(ranks) {
                b.delay = rank as i64 * step;
            }
            if r.placement.timing.reach.is_some() {
                r.placement.timing.reach = r.placement.bindings.iter().map(|b| b.delay).max();
            }
        }
    }
    let mut resolved: Vec<Option<i64>> = placed
        .iter()
        .map(|r| match r.start {
            Start::At(t) => Some(t),
            Start::After { .. } => None,
        })
        .collect();
    loop {
        let mut progress = false;
        for i in 0..placed.len() {
            if resolved[i].is_some() {
                continue;
            }
            let Start::After { placement, offset } = &placed[i].start else {
                continue;
            };
            let Some(j) = placed.iter().position(|r| &r.placement.id == placement) else {
                return refuse(
                    "ref_unresolved",
                    format!("placements/{}/after", placed[i].placement.id),
                );
            };
            if let Some(start) = resolved[j] {
                let p = &placed[j].placement;
                let reach = p.bindings.iter().map(|b| b.delay).max().unwrap_or(0);
                let end = start + reach + span_of(p);
                resolved[i] = Some(end + offset);
                progress = true;
            }
        }
        if !progress {
            break;
        }
    }
    if let Some(i) = resolved.iter().position(Option::is_none) {
        return refuse(
            "placement_cycle",
            format!("placements/{}/after", placed[i].placement.id),
        );
    }
    Ok(placed
        .into_iter()
        .zip(resolved)
        .map(|(r, start)| Placement {
            start: start.unwrap_or(0),
            ..r.placement
        })
        .collect())
}

/// Every parented item with its parent, parents first. A parent that isn't an item, or a cycle,
/// is refused, naming the item. #504: a parent that names an assembly is the assembly's
/// (`Program::member`), never an edge here.
fn parents_of(doc: &Map<String, Value>) -> Result<Vec<(String, String)>, Refused> {
    let mut edges: Vec<(String, String)> = Vec::new();
    let assembly = |id: &str| doc.get("assemblies").and_then(|a| a.get(id)).is_some();
    if let Some(Value::Object(items)) = doc.get("items") {
        for (id, item) in items {
            match item.get("parent") {
                None | Some(Value::Null) => {}
                Some(Value::String(parent)) if !items.contains_key(parent) && assembly(parent) => {}
                Some(Value::String(parent)) => {
                    if !items.contains_key(parent) {
                        return refuse("ref_unresolved", format!("items/{id}/parent"));
                    }
                    edges.push((id.clone(), parent.clone()));
                }
                Some(_) => return refuse("bad_doc", format!("items/{id}/parent")),
            }
        }
    }
    edges.sort();
    // A child is ready once its parent is no remaining edge's child. The edges stay sorted by
    // child (one parent each), so that is a binary search.
    let mut ordered: Vec<(String, String)> = Vec::with_capacity(edges.len());
    while !edges.is_empty() {
        let (ready, waiting): (Vec<_>, Vec<_>) = edges.iter().cloned().partition(|(_, parent)| {
            edges
                .binary_search_by(|(child, _)| child.as_str().cmp(parent))
                .is_err()
        });
        if ready.is_empty() {
            return refuse("parent_cycle", format!("items/{}/parent", edges[0].0));
        }
        ordered.extend(ready);
        edges = waiting;
    }
    Ok(ordered)
}
