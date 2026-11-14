# Import job

## What it is for

The job kind `import` (#162; canvas primitives: Asset job: Lottie import) with its first tool, `lottie-import@1.0.0`, which runs here as WebAssembly: a Lottie file in, a checked document out. Params `{from: lottie, look: generated | <look>@<major> = generated}`; inputs `file` (the Lottie JSON) and `look` (at most one look@1 file; with none, a named look is the shipped look of that name); outputs `document` (canonical JSON, naming its look through `assets/<id>/sha256` and `look: {asset: <id>@1, theme: light}`), `report` (`{issues: [{code, layer, property?, what}], colors: [{color, role, distance}]}`, each issue's `layer` the Lottie layer's `nm`) and `look` (that look@1, kept in the store beside the document that names it). Its output checks, run before any byte is kept: `import.document`, `import.colors_mapped` and `import.no_expression`.

## Where new code goes

- `index.ts`: the kind, its output checks and its tool; `deepbuild.json`: the manifest, whose `digest` is the folder's `packageDigest`.
- `tool/`: the tool's build: `lottie.wasm`, built from `crates/deep-lottie` by `node scripts/lottie-wasm.mjs`, and its Node entry `lottie.mjs`, which the checks also call.
- `fixtures/`: the qualification's Lottie file and the bytes the tool must write for it, with each look.

## What it may import

Nothing outside this folder: it is copied alone at install, and the tool reads only its own folder.

## Deviations

- `look` is declared `many`, since the job API takes no optional input; the tool refuses more than one.
- `tool/lottie.wasm` is a built file in the tree, as the typeset tool's is, since the plug-in's digest covers every file the tool runs.
