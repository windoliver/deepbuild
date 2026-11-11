# Twins for the 220 tests

The planted wrong programs the suite's README (Plants) asks for, written by the implementer, never by the blind job.
Each folder is laid over the repo: it replaces files of `packages/jobs/typeset/` alone, with that plug-in's manifest
`digest` rewritten for the changed files, so `deep install packages/jobs/typeset` installs the twin. The suite also
installs one in place of the plug-in with `ACCEPTANCE_220_PLUGIN=<the plug-in with the twin laid over it>`.

A twin that changes the SVG can't match the kind's qualification fixtures byte for byte, so its `index.ts` asks the
fixtures only that the tool answers; everything else is the plug-in's own.

| Criterion | Twin | The wrong program | Fails |
|---|---|---|---|
| `#220.a1078979` (AC1) | `typeset-apart` | each part typeset on its own and set side by side, 4 units apart | the union equals the one part |
| `#220.a1078979` (AC1) | `typeset-use` | each path once in `<defs>`, drawn with `<use>`; no `typeset.outlines` check | zero `<use>` elements |
| `#220.a1078979` (AC1) | `typeset-stamped` | the run's time in the `<metadata>` | two runs, the same SHA-256 |
| `#220.ec8a4363` (AC2) | `typeset-index-ids` | each part's id by its position, `t-0`, `t-1`, … | the shared ids, and the morph's pieces |
| `#220.472f9775` (AC3) | `typeset-no-checks` | no output checks, so a probe's issues pass | `\ce` and `parts_apart` answer `failed` |
| `#220.e4f3b85e` (AC4) | `typeset-slow` | 60 ms before each answer | the warm time (FAIL on a reference Mac) |
