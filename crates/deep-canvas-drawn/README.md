# deep-canvas-drawn

## What it is for

A drawn look's data (issue #149; canvas primitives: Look `look@1`: light, paper, line profiles and drawn fills; strokes on surfaces; Paint: noise fill): the fields as read and checked, each refusal naming its field, and what they compute before anything draws. It draws nothing: `deep-canvas-marks` dresses a frame's marks with it, `deep-canvas-scene3d` lights a drawing look's marks from it, and `deep-gpu-layer`'s drawn passes read what it resolves.

## Where new code goes

- `src/spec.rs`: a look's fields as read, one reader per row of the design.
- `src/geometry.rs`: what a path gains from a look: weight by light, a profile's widths, rims and cast shadows, in u on flattened outlines.
- `src/tooth.rs`: a tooth as a repeating tile, and the grain fills read.
- `src/medium.rs`: what one fill or line asks of the drawn pass, and its words in the shader's order.

## What it may import

The core through `deep-canvas`, by crate name only, and `serde_json`. It imports no renderer and no other canvas module, so `deep-canvas-marks` and `deep-canvas-scene3d` can both depend on it.

## Deviations

- `tooth.rs` keeps its own `cells`: the design names public `fbm` and `cells` steps, and the closed step list holds no `cells`. The noise fill's 4D lattice is the drawn pass's own WGSL for the same reason: `fbm@1` is 2D.
