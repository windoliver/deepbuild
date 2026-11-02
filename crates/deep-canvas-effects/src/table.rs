//! The core's op table (canvas primitives: Step and the closed step list; Every public step): the
//! base entries of the registry `gpu.step@1`, which the core's GPU layer declares and fills
//! (issue #200), so a build without this module still compiles every base step. The effects
//! module reads it from the core.

pub use deep_canvas::steps::{def, Def, ALL, COMPUTE, MATERIAL, PASS, TABLE, VERSION};
