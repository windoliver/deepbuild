//! `deep-canvas-render`: the library's binary (issue #391; the surface is the library's, `lib.rs`).
//! Issue #140 made the crate a library too, so `deep-gpu` draws a 2D writer layer through the same
//! GPUI and Vello CPU paths (tests/acceptance/140/view/README.md, "deep-gpu: the live-headless
//! calls").

/// #499: every heap allocation the process makes is counted, so `idle` reports each frame's.
#[global_allocator]
static ALLOCATOR: deep_marks_render::Counting = deep_marks_render::Counting;

fn main() {
    deep_marks_render::main();
}
