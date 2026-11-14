# deep-motion

## What it is for

The motion module's proof binary, `deep-motion` (`eval`, `insert`, `run`): JSON lines in, one answer per line, as the #391 and #489 acceptance READMEs define them. It compiles a document with `deep-canvas-motion` and prints what the evaluation gives.

## Where new code goes

- Line handling for each subcommand goes in `src/main.rs`. Anything a check reads, the evaluation itself, goes in `deep-canvas-motion`.

## What it may import

`deep-canvas` and `deep-canvas-motion` through their public entries, `deep-canvas-marks` for a shipped look's time feel (`look::shipped`, #417), `deep-text` for the shaper the auto layout measures text with (#491), and `serde_json`. It reads the clock only for `eval`'s `timing`, which is why it is not a `deep-canvas*` crate: the canvas lint keeps clocks out of checked code.

## Deviations

None.
