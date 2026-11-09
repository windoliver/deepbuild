//! The effects canvas module (issue #380; canvas primitives: GPU operators, as data): see the
//! crate manifest.
//!
//! An operator is read from its JSON ([`graph`]), checked against the core's op table
//! ([`table`], [`check`]) and, once it passes, written as WGSL by the core ([`emit`]); the same
//! graph runs on the CPU in f64 ([`interp`]). The shipped library ([`shipped`]) is built from the
//! same steps, fx@1's named operators ([`fx`]) are a pack's, and [`module`] registers it through
//! the registry and seal.

pub mod check;
pub mod dirt;
pub mod emit;
pub mod fusion;
pub mod fx;
pub mod graph;
pub mod interp;
pub mod module;
pub mod shipped;
pub mod table;
