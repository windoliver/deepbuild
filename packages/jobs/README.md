# Jobs

## What it is for

First-party job plug-ins (#1922): each registers job kinds through `deep.registerJob` and their tools through `deep.registerJobTool`, and is installed with `deep install packages/jobs/<name>`. `bakes` holds the analysis bake's kinds, whose tools run on its model host (#1819); `speech` holds the speech kind, whose engines Kokoro, the macOS voices and Azure Speech are its registered tools, and narration.transcript, whose pinned whisper.cpp hears each line back, all on its own model host on 127.0.0.1:8720 (#509); `score` holds score.render, one stem of a score rendered to FLAC by its tool `score-render`, run here with Node, with every declared note's pitch measured in the stem (#154); `typeset` holds the typeset job, a formula's LaTeX or Typst in and an SVG with one id per term out, whose tool `typst-mitex` runs here as WebAssembly (#220).

## Where new code goes

- `<name>/index.ts`: the kinds, their output checks and their tools; `<name>/deepbuild.json`: the manifest, whose `digest` is the folder's `packageDigest` and changes with every byte of the folder.
- A tool that runs on this machine lives in its own folder inside the plug-in (`typeset/tool`), whose files are the tool's build; `typeset/tool/typeset.wasm` is built from `crates/deep-typeset` by `node scripts/typeset-wasm.mjs`, and `typeset/fixtures` holds the bytes its qualification expects.

## What it may import

Nothing: each folder is copied alone at install and runs in the platform sandbox, so it imports no other package and no other folder here; a tool reads only its own folder.

## Deviations

- `typeset/tool/typeset.wasm` is a built file in the tree, since the plug-in's digest and the tool's build cover every file the tool runs.
- No `package.json`: these are DeepBuild packages, not npm workspaces.
