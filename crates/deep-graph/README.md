# deep-graph

## What it is for

The graph module's proof binary, `deep-graph layout`: JSON lines in, one JSON line out per input line, as the #394 and #399 acceptance READMEs define them. It reads each line's graph, layout and memory with `deep-canvas-graph`, lays them out there, and prints the answer, with the layout's own wall time `ms` on a line that lays new nodes into the kept picture (#399).

## Where new code goes

- Line handling for `layout` goes in `src/main.rs`. Anything a check reads, the layout and its memory, goes in `deep-canvas-graph`.

## What it may import

`deep-canvas-graph` through its public entry, and `serde_json`. It reads the clock only for `ms`, which is why it is not a `deep-canvas*` crate: the canvas lint keeps clocks out of checked code.

## Deviations

None.
