//! The canvas document contract (issue #389): grammars, the document model with kinds and
//! versions, the check, the canonical form and the f64 math checks read.
//!
//! The CPU math here feeds checks, so every transcendental goes through [`ops`] on pinned libm,
//! and the lint lane (`scripts/canvas-lint.mjs`) refuses anything else.

pub mod base64;
pub mod blend;
pub mod budget;
pub mod camera;
pub mod canon;
pub mod color;
pub mod columns;
pub mod cost;
pub mod document;
pub mod draw;
pub mod ease;
pub mod expr;
pub mod film_layout;
pub mod geometry_audit;
pub mod grammar;
pub mod interval;
pub mod kinds;
pub mod ops;
pub mod outline;
pub mod registry;
pub mod render;
pub mod schedule;
pub mod scope;
pub mod session;
pub mod show;
pub mod steps;
pub mod table;
pub mod template;
pub mod time;
pub mod timecode;
