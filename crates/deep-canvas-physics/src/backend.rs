//! The backend interface (World and backend): what the physics module asks of a backend, in this
//! crate's own types only, so no engine type crosses it. `query`, `move_character` and
//! `drive_vehicle` join it with the issues that run them (#1919, #182, #251); the hash reads
//! `canonical` (golden.rs).

use std::collections::BTreeMap;

use serde_json::Value;

use crate::caps::Caps;
use crate::doc::{Refusal, World};
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
}
