//! Wrong-program switches used only by the proof binary. Public entry remains the crate root.

use crate::{ao, cull, dof, flare, local, surface, water};

/// The wrong programs, each reachable only through the binary's `--planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// Depth cleared to 1, compared less, with a finite far plane at 10 km.
    pub forward_z: bool,
    /// #506: keep the preceding view's backdrop or mirror (see [`crate::Renderer::keep_first`]).
    pub keeps_backdrop: bool,
    pub keeps_mirror: bool,
    /// #2516: the main loop, uniform directions, or endpoints alone instead of visibility.
    pub ao: ao::Planted,
    /// #431: the emission target is the color target's excess over 1, never the emitted radiance.
    pub emission_thresholds_color: bool,
    /// #431: a material operator's `sample_grad` takes implicit derivatives.
    pub sample_grad_implicit: bool,
    /// #431: the opaque scene's copy is taken after the see-through parts draw.
    pub backdrop_after_see_through: bool,
    /// The output pass encodes its result twice.
    pub encodes_twice: bool,
    /// The output pass writes the tone-mapped linear value unencoded.
    pub skips_encode: bool,
    /// Every batch encodes again every frame; nothing replays.
    pub encodes_every_frame: bool,
    /// A batch keeps replaying its old encoding after its draw key changed.
    pub replays_after_add: bool,
    /// #383: every frame adds a pass that keeps the GPU busy for at least 10 ms.
    pub slow_gpu_frame: bool,
    /// #854: the renderer and its pipelines are compiled in the first frame, not when the view
    /// opens.
    pub builds_on_first_frame: bool,
    /// #386: the upscale's wrong programs.
    pub upscale: surface::Planted,
    /// #386: outlines draw at the internal size, before the upscale.
    pub outlines_before_upscale: bool,
    /// #173: outlines draw into each window frame, before frame history's resolve.
    pub outlines_in_history: bool,
    /// #386: status outlines draw at the internal size, before the upscale.
    pub status_before_upscale: bool,
    /// #386: status outlines draw with no depth test.
    pub status_without_depth: bool,
    /// #421: a solid's front faces chosen without its world determinant's sign.
    pub winding_ignores_determinant: bool,
    /// #465: the flare's wrong programs.
    pub flare: flare::Planted,
    /// #468: the depth of field's wrong programs.
    pub dof: dof::Planted,
    /// #166: the water's wrong program.
    pub water: water::Planted,
    /// #421: opaque solids submitted in an order that turns over each frame, ties left to the
    /// depth test.
    pub ties_by_submission: bool,
    /// #421: a spot's lumens spread over its cone, cd = lm ÷ 2π(1 − cos outer).
    pub spot_counts_cone: bool,
    /// #421: status outlines drawn through the tone map.
    pub status_before_tone_map: bool,
    /// #423: every mipmapped map sampled at anisotropy 1, so the mip follows the footprint's
    /// long axis.
    pub anisotropy_one: bool,
    /// #422: the shading core mixes metallic into one F0 before shading.
    pub premixed_metallic: bool,
    /// #422: the specular lobes lose single scattering's missing energy.
    pub uncompensated_lobe: bool,
    /// #422: only environment light is compensated.
    pub compensates_environment_only: bool,
    /// #422: every final target black.
    pub draws_black: bool,
    /// #422: the puffs aren't drawn.
    pub drops_clouds: bool,
    /// #422: a cascade's map reused while the scene's solid count holds.
    pub cascade_cache_keeps_stale: bool,
    /// #422: the environment prefiltered one roughness mip per frame from the session's first.
    pub prefilter_over_frames: bool,
    /// #503: a video background's frame prefiltered into the environment, keyed per frame.
    pub video_background_prefiltered: bool,
    /// #1174: screen-size labels draw in the geometry pass at the internal size, before the
    /// upscale, as the base drew them.
    pub labels_before_upscale: bool,
    /// #425: each band of an item inside its margin keeps pixels by its own hash.
    pub band_masks_independent: bool,
    /// #424: an additive part writes depth; one draws without the depth test.
    pub add_writes_depth: bool,
    pub add_without_depth_test: bool,
    /// #424: the object-ID pass writes an element's place in its draw, not its stable ID; it
    /// writes a mask part's ID through the holes its cutoff leaves.
    pub ids_by_draw_position: bool,
    pub ids_ignore_mask: bool,
    /// #424: a cutaway clips the color pass alone, never the shadow passes.
    pub cuts_color_only: bool,
    /// #1173: the geometry pass draws one sample a pixel, as the base drew it.
    pub single_sample: bool,
    /// #1173: each frame's resolve blends in half of the previous frame's.
    pub resolve_accumulates: bool,
    /// #486: a material operator that writes a lobe its material lacks turns the lobe on, compiled
    /// the first time a frame draws its part, never in the warm-up.
    pub missing_lobe_turned_on: bool,
    /// #428's and #481's shading plants as the shader's bits (scene3d.wgsl: `P_*`), 0 for none.
    pub lobes: u32,
    /// #446: the local maps' wrong programs.
    pub local: local::Planted,
    /// #484: the cull's wrong programs.
    pub cull: cull::Plants,
    /// #484: the object-ID pass writes a row's place in the compacted list.
    pub ids_by_compacted_place: bool,
    /// #484: a batch draws the count its last frame's cull read back to the CPU.
    pub count_read_back: bool,
    /// #1637: the occlusion test reads the pyramid the previous frame's prepass built.
    pub pyramid_from_previous_frame: bool,
    /// #1637: the camera's occlusion test also culls the cascades' lists.
    pub occlusion_in_cascades: bool,
    /// #1637: the camera's occlusion test also culls the probes' captures.
    pub occlusion_in_probe_captures: bool,
    /// #1903: one bind group made for each item every frame.
    pub bind_group_per_item: bool,
    /// #1903: every item's transform, 64 bytes, uploaded every frame.
    pub uploads_every_transform: bool,
    /// #1903: the warm-up at check makes a pipeline for each item, keyed by item, not by feature set.
    pub warms_per_item: bool,
    /// #537: a terrain overlay keeps the grid it holds when a frame seeks to another step.
    pub overlay_keeps_grid_on_seek: bool,
}
