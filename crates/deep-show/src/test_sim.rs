//! The test builds of `test.sim@1` (issues #185 and #1920): each `test-sim-*` feature puts one
//! implementation of it in a build, A or B or a variant of one, or test module c, which reads
//! B's private array. None is in a shipped build.

use deep_canvas::registry::Module;

/// The test.sim modules this build holds.
// Each push is under its own feature, so a build holds any subset.
#[allow(clippy::vec_init_then_push)]
pub fn modules() -> Vec<Module> {
    #[allow(unused_mut)]
    let mut out: Vec<Module> = Vec::new();
    #[cfg(feature = "test-sim-a")]
    out.push(deep_canvas_test_modules::sim::a());
    #[cfg(feature = "test-sim-b")]
    out.push(deep_canvas_test_modules::sim::b());
    #[cfg(feature = "test-sim-b-f64")]
    out.push(deep_canvas_test_modules::sim::b_f64());
    #[cfg(feature = "test-sim-b-private-renamed")]
    out.push(deep_canvas_test_modules::sim::b_private_renamed());
    #[cfg(feature = "test-sim-b-public-renamed")]
    out.push(deep_canvas_test_modules::sim::b_public_renamed());
    #[cfg(feature = "test-sim-b-false-bit")]
    out.push(deep_canvas_test_modules::sim::b_false_bit());
    #[cfg(feature = "test-sim-b-off")]
    out.push(deep_canvas_test_modules::sim::b_off());
    #[cfg(feature = "test-sim-c")]
    out.push(deep_canvas_test_modules::sim::c());
    // Issue #1920: A and B at version 1.0.1, and B with its pin's feature changed.
    #[cfg(feature = "test-sim-a-1-0-1")]
    out.push(deep_canvas_test_modules::sim::a_1_0_1());
    #[cfg(feature = "test-sim-b-1-0-1")]
    out.push(deep_canvas_test_modules::sim::b_1_0_1());
    #[cfg(feature = "test-sim-b-pin-feature")]
    out.push(deep_canvas_test_modules::sim::b_pin_feature());
    out
}
