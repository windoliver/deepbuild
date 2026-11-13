# deep-canvas-export

## What it is for

The export canvas module, `export@1` (#162; design: Export: Lottie): the Lottie target of the core's `export.target@1` and the `export` check kind. Its writer turns a document's 2D items, groups, paths, paints, masks, mattes, keys and markers into Lottie 1.0.1's own types, reading the document as the motion evaluator gives it at each export frame, and lists each item Lottie can't hold and each value it sampled. deep-show writes the file, reads it back through the reference renderer and keeps the receipt.

## Where new code goes

- `src/module.rs`: the module's manifest, its `export.target@1` entry and the `export` check kind.
- `src/lottie/mod.rs`: the writer's entry, its warnings and refusals, the markers; `keys.rs`: Lottie properties and keys, native or sampled; `layers.rs`: items as layers, groups and masks as precomps, mattes as track mattes; `shapes.rs`: geometry, path ops, repeater copies, baked output paths, drops, halos and ends; `paint.rs`: fills, strokes and gradients; `text.rs`: text as glyph groups per animated unit; `holds.rs`: what Lottie can't hold.
- The acceptance tests are in `tests/acceptance/162` and `tests/acceptance/162-oracle`.

## What it may import

A canvas module crate. It reaches the core through `deep-canvas`, the 2D marks through `deep-canvas-marks`, the evaluator through `deep-canvas-motion` and the shaper's types through `deep-text`, by crate name only, plus `serde_json`. Its name puts it under `scripts/canvas-lint.mjs`: every transcendental goes through deep-canvas's `ops` module on pinned libm. No GPU crate, no codec, no file system: deep-show writes the file.

## Deviations

- The writer places each channel-written field at the program's own field path, since the evaluator's item JSON writes a channel on a list entry one level off (`ops[0].trim.trim.end`); a follow-up fixes the evaluator.
- The file draws what the 2D frames draw, where those differ from the document: strokes with butt ends and miter joins (the 2D stroke has no other cap or join), and a halo only on text.
- The 2D frames draw no text's turn about z yet, while the file turns it as the document says; the fidelity check leaves out, at each sampled frame, the box a turned text covers turned and unturned, and the receipt lists each such text under `fidelity.excluded`. Every other drawn item turns in both.
- The fidelity check passes a sampled frame at the floor's PSNR-Y, or at SSIM 0.98 on the standard floor, as export.fidelity's floor reads (Check input: export kinds): two renderers draw sub-pixel edges apart, which PSNR alone reads as a difference across a frame of many moving edges.
- A masked item's transform goes on a group around its shapes, so its layer's own transform stays the identity and its mask stays where the document draws it.
