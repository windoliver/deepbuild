//! The backend interface (World and backend): what the physics module asks of a backend, in this
//! crate's own types only, so no engine type crosses it. `occurrences` reports what a step wrote
//! (#2011's sensor entries and exits, #1918's other kinds), which the module sorts; `query` and
//! `move_character` (#1919) keep every spatial query and character move behind it, and
//! `drive_vehicle` joins it with #251; the hash reads `canonical` (golden.rs).

use std::collections::BTreeMap;

use serde_json::Value;

use crate::caps::Caps;
use crate::doc::{Pose, Refusal, Shape, World};
use crate::occurrence::Raw;

/// What a step reads of its scene at its own time, evaluated before the solve: each kinematic
/// body's position from its `follow` path, each motor target a path sets, and each coordinate a
/// kinematic solve drives (deg for a hinge, m for a slider, as written).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Targets {
    /// body → position, m; its rotation stays its pose's.
    pub poses: BTreeMap<String, [f64; 3]>,
    pub motors: BTreeMap<String, f64>,
    /// joint → coordinate, in the solve's order.
    pub coords: Vec<(String, f64)>,
}

/// One entry of the world's input track (Input track entries).
#[derive(Clone, Debug, PartialEq)]
pub struct Input {
    pub kind: String,
    pub target: String,
    pub data: Value,
}

/// One body as a step left it.
#[derive(Clone, Debug, PartialEq)]
pub struct BodyState {
    pub id: String,
    pub pos: [f64; 3],
    /// `[x, y, z, w]`.
    pub rot: [f64; 4],
    pub linear: [f64; 3],
    /// deg/s.
    pub angular: [f64; 3],
    /// N·s: the size of the sum of the contact impulses the body took over the step that ended
    /// here, every substep's.
    pub contact_impulse: f64,
    pub sleeping: bool,
}

/// The world as the last step left it, bodies in canonical (ID) order.
#[derive(Clone, Debug, PartialEq)]
pub struct State {
    pub step: u64,
    pub bodies: Vec<BodyState>,
}

/// One shape use: its body's ID and its index among the body's shapes.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct ShapeRef {
    pub body: String,
    pub index: usize,
}

/// The fields of a body's canonical state, in canonical order: pose, then velocity (Checkpoint
/// ring: `hash`). `rot` is the quaternion, `angular` rad/s.
pub const FIELDS: [&str; 13] = [
    "pos.x",
    "pos.y",
    "pos.z",
    "rot.x",
    "rot.y",
    "rot.z",
    "rot.w",
    "linear.x",
    "linear.y",
    "linear.z",
    "angular.x",
    "angular.y",
    "angular.z",
];

/// One body's canonical state: the backend's own f32 value of each of `FIELDS`, never converted,
/// so a hash of it reads exactly what the backend steps.
#[derive(Clone, Debug, PartialEq)]
pub struct Canonical {
    pub id: String,
    pub values: [f32; 13],
}

/// A deep checkpoint: the backend's whole-world state as its own bytes, stamped with the backend
/// and the version that wrote them, which no other version loads (Checkpoint ring).
#[derive(Clone, Debug, PartialEq)]
pub struct Checkpoint {
    pub backend: String,
    pub version: String,
    pub features: Vec<String>,
    pub step: u64,
    pub state: Vec<u8>,
}

/// A spatial query against the state the last step left (World and backend: `query()`): a ray
/// from a point along a direction (normalized here) up to `max` m; a shape swept from one pose
/// to another; or a shape at a pose. `groups` is a mask over the world's `collision_groups`: a
/// shape use answers only when it is a member of one of them.
#[derive(Clone, Debug, PartialEq)]
pub enum Query {
    Ray {
        from: [f64; 3],
        dir: [f64; 3],
        max: f64,
    },
    Sweep {
        shape: Shape,
        from: Pose,
        to: Pose,
    },
    Overlap {
        shape: Shape,
        at: Pose,
    },
}

/// One shape use a query met, `distance` m along the ray or the sweep (0 for an overlap).
#[derive(Clone, Debug, PartialEq)]
pub struct Hit {
    pub shape: ShapeRef,
    pub distance: f64,
}

pub trait Backend {
    /// Its name and version, as `name@version`.
    fn id(&self) -> String;
    fn caps(&self) -> &'static Caps;
    /// Creates everything in canonical order, or the refusals that stop it.
    fn build(&mut self, world: &World) -> Result<(), Vec<Refusal>>;
    /// One step with the inputs stamped for it and the targets its channels set at its time, or
    /// the refusal of an input it can't apply.
    fn step(&mut self, inputs: &[Input], targets: &Targets) -> Result<(), Box<Refusal>>;
    /// What the last step wrote, in the engine's own order; the module sorts it (Occurrence list).
    fn occurrences(&self) -> Vec<Raw>;
    fn read(&self) -> State;
    /// Every body's canonical state, in canonical (ID) order.
    fn canonical(&self) -> Vec<Canonical>;
    fn checkpoint(&self) -> Checkpoint;
    /// Loads `checkpoint`, or refuses one another backend or version wrote, naming both, and
    /// loads nothing.
    fn restore(&mut self, checkpoint: &Checkpoint) -> Result<(), Box<Refusal>>;
    /// Every shape use `q` meets among those in `groups`, sorted by distance, then shape use: the
    /// one way physics.query, physics.cast@1 and nav.reach reach the engine's spatial queries.
    fn query(&self, q: &Query, groups: u32) -> Vec<Hit>;
    /// Moves character body `body` by `translation` m through the backend's character
    /// controller, which sets its kinematic target for the next step, sliding along what it
    /// meets; the translation it took, or the refusal naming a body that can't move so.
    fn move_character(
        &mut self,
        body: &str,
        translation: [f64; 3],
    ) -> Result<[f64; 3], Box<Refusal>>;
}
