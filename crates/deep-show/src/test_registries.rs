//! Issue #200: the test canvas modules each `test-*` feature of the #200 acceptance README puts
//! in a build, and the registries the core declares in such a build (`test.shape@1`, filled by
//! `test.fill.a` and `test.fill.b`).

use deep_canvas::registry::lists::RegistryDef;
use deep_canvas::registry::Module;

/// The registries the core declares in this build beside its own.
// Each push is under its own feature, so a build holds any subset.
#[allow(clippy::vec_init_then_push)]
pub fn core() -> Vec<RegistryDef> {
    #[allow(unused_mut)]
    let mut out = Vec::new();
    #[cfg(any(
        feature = "test-fill-a",
        feature = "test-fill-b",
        feature = "test-fill-b-part",
        feature = "test-fill-c"
    ))]
    out.push(deep_canvas_test_modules::registries::shape_def());
    out
}

/// The test canvas modules this build holds.
#[allow(clippy::vec_init_then_push)]
pub fn modules() -> Vec<Module> {
    #[allow(unused_mut)]
    let mut out: Vec<Module> = Vec::new();
    #[cfg(feature = "test-mark")]
    out.push(deep_canvas_test_modules::registries::mark());
    // Issue #202's test canvas module: an item kind of 0.20 ms of CPU.
    #[cfg(feature = "test-weight")]
    out.push(deep_canvas_test_modules::weight::module());
    #[cfg(feature = "test-column-source")]
    out.push(deep_canvas_test_modules::registries::columns());
    // Issue #412's test canvas modules.
    #[cfg(feature = "test-preview")]
    out.push(deep_canvas_test_modules::kinds::preview());
    #[cfg(feature = "test-cue")]
    out.push(deep_canvas_test_modules::kinds::cue());
    #[cfg(feature = "test-cue-span")]
    out.push(deep_canvas_test_modules::kinds::cue_span());
    #[cfg(feature = "test-ring-a")]
    out.push(deep_canvas_test_modules::kinds::ring_a());
    #[cfg(feature = "test-ring-b")]
    out.push(deep_canvas_test_modules::kinds::ring_b());
    #[cfg(feature = "test-sheet-wordy")]
    out.push(deep_canvas_test_modules::kinds::wordy());
    #[cfg(feature = "test-mark-dot-9")]
    out.push(deep_canvas_test_modules::registries::mark_dot_9());
    #[cfg(feature = "test-mark-no-planted")]
    out.push(deep_canvas_test_modules::registries::mark_no_planted());
    #[cfg(feature = "test-mark-no-since")]
    out.push(deep_canvas_test_modules::registries::mark_no_since());
    #[cfg(feature = "test-mark-dot-twice")]
    out.extend([
        deep_canvas_test_modules::registries::mark(),
        deep_canvas_test_modules::registries::mark_other(),
    ]);
    #[cfg(feature = "test-mark-binds-author")]
    out.push(deep_canvas_test_modules::registries::mark_binds_author());
    #[cfg(feature = "test-mark-schema-changed")]
    out.push(deep_canvas_test_modules::registries::mark_schema_changed());
    #[cfg(feature = "test-mark-v2")]
    out.push(deep_canvas_test_modules::registries::mark_v2());
    #[cfg(feature = "test-mode-closed")]
    out.push(deep_canvas_test_modules::registries::mode_closed());
    #[cfg(feature = "test-mode-registry")]
    out.push(deep_canvas_test_modules::registries::mode_registry());
    #[cfg(feature = "test-mode-renumbered")]
    out.push(deep_canvas_test_modules::registries::mode_renumbered());
    #[cfg(feature = "test-fill-a")]
    out.push(deep_canvas_test_modules::registries::fill_a());
    #[cfg(all(feature = "test-fill-b", not(feature = "test-fill-b-part")))]
    out.push(deep_canvas_test_modules::registries::fill_b());
    #[cfg(feature = "test-fill-b-part")]
    out.push(deep_canvas_test_modules::registries::fill_b_part());
    #[cfg(feature = "test-fill-c")]
    out.push(deep_canvas_test_modules::registries::fill_c());
    #[cfg(feature = "test-gpustep")]
    out.push(deep_canvas_test_modules::registries::gpustep());
    #[cfg(feature = "test-gpustep-no-fixture")]
    out.push(deep_canvas_test_modules::registries::gpustep_no_fixture());
    #[cfg(feature = "test-gpustep-no-twin")]
    out.push(deep_canvas_test_modules::registries::gpustep_no_twin());
    #[cfg(feature = "test-rules-shared")]
    out.push(deep_canvas_test_modules::registries::rules_shared());
    #[cfg(feature = "test-rules-isolated")]
    out.push(deep_canvas_test_modules::registries::rules_isolated());
    #[cfg(feature = "test-registries-load")]
    out.push(deep_canvas_test_modules::registries::load());
    #[cfg(feature = "test-export-target")]
    out.push(deep_canvas_test_modules::registries::export_raw());
    #[cfg(feature = "test-export-target-self-read")]
    out.push(deep_canvas_test_modules::registries::export_self_read());
    out
}

/// The effects module of the planted layout `test-steps-in-effects`: it fills the op table's
/// base steps into `gpu.step@1`, which the core then leaves to it.
pub fn effects_with_base_steps() -> Module {
    let mut m = deep_canvas_effects::module::module();
    m.register = |r| {
        (deep_canvas_effects::module::module().register)(r);
        r.entries
            .extend(deep_canvas::registry::core_lists::base_steps());
    };
    m
}

/// The effects module of the planted layout `test-gpu-output-in-effects` (#485): it declares
/// `gpu.output@1` with today's outputs, which the core then leaves to it.
#[cfg_attr(not(feature = "test-gpu-output-in-effects"), allow(dead_code))]
pub fn effects_declaring_outputs() -> Module {
    let mut m = deep_canvas_effects::module::module();
    m.register = |r| {
        (deep_canvas_effects::module::module().register)(r);
        let (def, entries) = deep_canvas::registry::core_lists::gpu_output_registry();
        r.registry(def);
        r.entries.extend(entries);
    };
    m
}

/// #501: the writer of a test module's `export.target@1` entry, whose delivery is the frames'
/// BGRA8 rows, one after another, in one file (#157: the export appends each as it is drawn);
/// `None` for a target no test module writes.
pub(crate) fn write_export(target: &str, entry: &serde_json::Value) -> Option<serde_json::Value> {
    if !entry["writer"].as_str()?.starts_with("test.") {
        return None;
    }
    Some(serde_json::json!({"name": target, "writer": entry["writer"]}))
}
