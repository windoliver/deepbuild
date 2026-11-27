# 0016: The scene renderer's shared depth and resolved image

Status: accepted (#3715). The decisions below were held in comments that main's comment ratchet counted past their files' ceilings; they are written nowhere else.

## One depth for the occluders and the geometry pass

- **The cull's occluders draw into the geometry pass's multisampled depth.** `crates/deep-scene3d-render/src/cull.rs`, `Pyramid::depth` and `Pyramid::new`; `crates/deep-scene3d-render/src/lib.rs`, where a frame makes the pyramid from `depth_ms`. The pyramid reads that depth before the geometry pass clears it, so the prepass needs no depth target of its own (#3506). `Pyramid::new` takes the geometry pass's depth at `size` and `samples`; under the planted `own` it makes the pyramid over a depth of the occluders' own instead.
- **The estimate counts no depth for the occluders.** `crates/deep-scene3d-render/src/held.rs`, `of`. While a list is culled on the GPU it counts the cull's pyramid alone, since the occluders draw into the geometry pass's depth (#3506).

## One resolved image

- **Motion blur, the depth of field and the local tone map resolve into one image.** `crates/deep-scene3d-render/src/lib.rs`, `ensure_resolved` and `RESOLVED`; `renderer.rs`, `resolved`. It is made at the targets' size while wanted and let go otherwise. Motion blur and the depth of field each copy it into the linear target before the next pass starts, and the local tone map, which the output then reads, runs after both, so one image serves all three (#3506). On Metal a texture with all three's usages holds what one with either's does.
- **The depth of field copies the shared image back into the linear one.** `crates/deep-scene3d-render/src/dof.rs`, `job`. It resolves into `resolved`, the image motion blur shares, and copies that back into `linear` (#3506).
- **The local tone map resolves into the shared image, which the output then reads.** `crates/deep-scene3d-render/src/local_tone.rs`, `job`, its `into` (#3506).

## What the names mean

- **`DofReadsSharedBeforeWrite`, `reads_shared_before_write`.** `crates/deep-gpu-layer/src/main.rs`; `crates/deep-scene3d-render/src/dof.rs`, `Planted`. The wrong program of #3506: the depth of field copies the image it shares with motion blur into the linear one before its gather writes it, so the frame shows motion blur's resolved image in this pass's place.
- **`occluders_own_depth`.** `crates/deep-scene3d-render/src/planted.rs`. The wrong program of #3506: the cull's occluders draw into a multisampled depth of their own, not the geometry pass's.
- **`estimate_counts_occluders_depth`.** `crates/deep-scene3d-render/src/planted.rs`. The wrong program of #3506: the estimate still counts a multisampled depth of the occluders' own.
- **`hidden`.** `crates/deep-scene3d-render/src/renderer.rs`. The hidden views' pipelines and targets, made when a frame first draws one (#290).
- **`seen`.** `crates/deep-scene3d-render/src/renderer.rs`. The scene it draws as a mirror's or a view inset's view, kept from frame to frame (#3016).
