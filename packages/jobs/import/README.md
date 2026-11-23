# Import job

## What it is for

The job kind `import` (#162; canvas primitives: Asset job: Lottie import) with its first tool, `lottie-import@1.0.0`, which runs here as WebAssembly: a Lottie file in, a checked document out. Params `{from: lottie, look: generated | <look>@<major> = generated}`; inputs `file` (the Lottie JSON) and `look` (at most one look@1 file; with none, a named look is the shipped look of that name); outputs `document` (canonical JSON, naming its look through `assets/<id>/sha256` and `look: {asset: <id>@1, theme: light}`), `report` (`{issues: [{code, layer, property?, what}], colors: [{color, role, distance}]}`, each issue's `layer` the Lottie layer's `nm`) and `look` (that look@1, kept in the store beside the document that names it). Its output checks, run before any byte is kept: `import.document`, `import.colors_mapped` and `import.no_expression`.

Its second tool, `urdf-import@1.0.0` (#3035; canvas primitives: Asset job: imports), takes `{from: urdf}` and a robot description as `file`, and no `look` input. Its `document` holds one item for each link and one `physics.world@1` with a body for each link and a joint for each joint that has a place, in our units and axes; its `report` is `{rotation, dropped: [{element, name}]}`, the one rotation applied and every element that had no place; its `look` is the shipped clean look the document names. A file that needs a macro expanded, or names a mesh, is refused naming it, and nothing is written. `import.document` also holds each world of a document to the physics module's check. What each element becomes is in `crates/deep-urdf/README.md`.

## Where new code goes

- `index.ts`: the kind, its output checks and its tools; `deepbuild.json`: the manifest, whose `digest` is the folder's `packageDigest`.
- `tool/`: the Lottie tool's build: `lottie.wasm`, built from `crates/deep-lottie` by `node scripts/lottie-wasm.mjs`, and its Node entry `lottie.mjs`, which the checks also call.
- `urdf/`: the robot description tool's build: `urdf.wasm`, built from `crates/deep-urdf` by `node scripts/urdf-wasm.mjs`, and its Node entry `urdf.mjs`, which `import.document` also calls.
- `fixtures/`: the qualification's files and the bytes each format's tool must write for them, with each look. A fixture runs on the tools whose own params take it.

## What it may import

Nothing outside this folder: it is copied alone at install, and the tool reads only its own folder.

## Deviations

- `look` is declared `many`, since the job API takes no optional input; the tool refuses more than one.
- `tool/lottie.wasm` and `urdf/urdf.wasm` are built files in the tree, as the typeset tool's is, since the plug-in's digest covers every file the tool runs.
- The robot description tool takes no mesh: a file that names one is refused, naming its path, until the mesh convert-in job (#1984) gives the job one.
