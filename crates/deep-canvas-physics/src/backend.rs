//! The backend interface (World and backend): what the physics module asks of a backend, in this
//! crate's own types only, so no engine type crosses it. `occurrences` writes a sensor's entries and
//! exits (#2011), and its other kinds join with #1918; `query`, `move_character` and
//! `drive_vehicle` join it with the issues that run them (#1919, #182, #251); the hash reads
//! `canonical` (golden.rs).

use serde_json::Value;

use crate::caps::Caps;
use crate::doc::{Refusal, World};

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

/// One entry of the world's occurrence list (Occurrence list): `a` is the lower shape use in
/// canonical order.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Occurrence {
    pub step: u64,
    pub kind: &'static str,
    pub a: ShapeRef,
    pub b: ShapeRef,
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
    /// One step with the inputs stamped for it, or the refusal of an input it can't apply.
    fn step(&mut self, inputs: &[Input]) -> Result<(), Box<Refusal>>;
    fn read(&self) -> State;
    /// The occurrences the last step wrote, sorted by (step, kind, a, b).
    fn occurrences(&self) -> Vec<Occurrence>;
    /// Every body's canonical state, in canonical (ID) order.
    fn canonical(&self) -> Vec<Canonical>;
    fn checkpoint(&self) -> Checkpoint;
    /// Loads `checkpoint`, or refuses one another backend or version wrote, naming both, and
    /// loads nothing.
    fn restore(&mut self, checkpoint: &Checkpoint) -> Result<(), Box<Refusal>>;
}
