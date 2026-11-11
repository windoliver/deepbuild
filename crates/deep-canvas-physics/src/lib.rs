//! Issue #2009: the physics canvas module `physics.world@1` (canvas primitives: Physics; technical
//! design: The physics module). The world document's reader, the caps a backend declares and the
//! check that holds a world to them, and the backend interface, all in this crate's own types: it
//! depends on no engine, so no backend type crosses it.

pub mod backend;
pub mod bake;
pub mod caps;
pub mod check;
pub mod doc;
pub mod golden;
pub mod module;
pub mod occurrence;
pub mod pairs;
pub mod query;
pub mod roles;
