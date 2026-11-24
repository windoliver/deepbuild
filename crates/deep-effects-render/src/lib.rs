//! The effects module's render side (issue #380): see the crate manifest.

pub mod chrome;
pub mod closed;
pub mod cloud;
pub mod compile;
pub mod docops;
pub mod frame;
pub mod glow;
pub mod look_ops;
pub mod mips;
pub mod particles;
pub mod planted;
pub mod reference;
pub mod runner;
pub mod scene;
pub mod strokes;
mod uniformity;
pub mod velocity;
pub use deep_gpu::structural;
