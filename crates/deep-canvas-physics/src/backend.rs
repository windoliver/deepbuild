//! The backend interface (World and backend): what the physics module asks of a backend, in this
//! crate's own types only, so no engine type crosses it. `occurrences`, `query`, `move_character`,
//! `drive_vehicle` and `hash` join it with the issues that run them (#1918, #1919, #182, #251,
//! #2010).

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
    fn checkpoint(&self) -> Checkpoint;
    /// Loads `checkpoint`, or refuses one another backend or version wrote, naming both, and
    /// loads nothing.
    fn restore(&mut self, checkpoint: &Checkpoint) -> Result<(), Box<Refusal>>;
}
