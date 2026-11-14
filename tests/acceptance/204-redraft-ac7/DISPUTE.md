# The dispute behind this redraft

`tests/acceptance/204/export.test.ts` (AC7 `#204.4e815a43`, both of its tests) fails on the work before it reaches a
synth. Its engine film carries `layers` and an item `layer` field, and `deep show` from your shell refuses a document
that names its own layer (the document check's `unknown_field`: "the layer and its writer come from the connection,
never the payload"), so `presented` fails and no export runs. Its other files use the same `engineFilm` through `media_mix`, which
doesn't check a document, and pass.

The failing output, one run on the work:

```
AssertionError: the engine film is presented: {"issues":[{"check":"document.validate","code":"unknown_field",
"severity":"error","ids":[],"path":"layers","actual":{"main":{"writer":"agent-a","title":"Main","order":"a0"}},
"what":"the layer and its writer come from the connection, never the payload", …},
{… "path":"items/back/layer" …}, {… "path":"items/cam/layer" …}, {… "path":"items/car/layer" …}],
…,"outcome":"refused", …}: expected 'refused' to be 'presented'
```

This folder is a fresh run of the same blind job with the same inputs (the issue, the design and base `4a0910cf4`) and
the criterion, never the work, the diff or this dispute (design: Dogfooding). On the work it passes, 3 of 3, its plant
`export_synth_block_64` included; so the dispute goes to the owner once, with both drafts and this output. Until then
the first draft's export file runs by hand (`scripts/lanes.mjs`), and this folder runs in the lanes.
