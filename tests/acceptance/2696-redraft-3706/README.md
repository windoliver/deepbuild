# Blind redraft of #2696's `base.test.mjs` (#3706)

Written by a job that saw only #3706, #2696, the design, `AGENTS.md`, `GLOSSARY.md` and the base commit
`03b71e900700d1c6347731cb43cecd094a00097c`. It read no branch, pull request or other redraft folder's content.
`DISPUTE.md` says what the first draft compares and why it fails or BLOCKs every PR since the fix landed.

## The decision: compare with this checkout built without its escape step

Every merge base now builds with the escape step, so a merge base is no longer a build without the fix. A test that
compares this build with the merge base's either cannot fail (both escape) or fails on the PR's own source edits
(a line added to `core.ts` moves every later line of both builds apart).

So each property is judged either directly, or against the one build that differs from this one by the escape step
alone: a copy of this checkout (`copyCheckout` of the first draft's helpers: the root entries `git ls-tree HEAD`
names but `tests`, `docs` and `reports`, linked `node_modules`, this checkout's `deep-hook`), with every
`packages/*/dist` and `packages/*/*.tsbuildinfo` removed, `scripts/built-escapes.mjs` replaced by
`process.exit(0);`, and `npm run build --workspaces` run there. Called **the build without the step** below.

Why this and not a fixed number or the merge base:

- A PR that adds or removes a source line has that line in both builds, so line counts, thrown lines and messages
  still match. The dispute's fault (`core.js: 2916 lines in this build, 2915 on the merge base`) cannot happen.
- A wrong escape step shows on every tree, fixed merge base or not: only the step differs between the two builds.
- The issue's "on the merge base" stands for "without the escape step". The issue's own premise (53 or more files
  with such a character) is no longer true of any tree's merge base, so the premise checked here is that the build
  without the step holds at least one such file (else BLOCKED: there is nothing for the step to change).

## Files

| File | Test (tags) | Checks |
|---|---|---|
| `none-above.test.mjs` | `#2696.5a61170b #3706.61c191d3` | No built text file under `packages/*/dist` of this checkout holds a character above U+00FF; names the count and each file and line. BLOCKED when no source of a built package holds one. |
| `same-text.test.mjs` | `#2696.534150b4 #3706.414a9c5f` (lines) | Each built text file of the build without the step exists in this build with the same number of lines. |
| `same-text.test.mjs` | `#2696.534150b4 #3706.414a9c5f` (thrown line) | `Core.prototype.testClock.call({}, params)` from `packages/hub/dist/core.js`, with no parameter (a TypeError) and with `{ advance_ms: -1 }` (`throw refuse(...)`), names the same two lines in both builds. BLOCKED unless both lines lie after the first line of the unescaped core with a character above U+00FF. |
| `same-text.test.mjs` | `#2696.6fbf771a #3706.c1a4b78e` | Every message with such a character (string, template piece, tagged template's raw piece, name; `messagesOf` of the first draft) of each built `.js` file, and each `.json` file's value, reads the same in both builds; both builds' package entries export and print the same (`../2696/load.mjs`); `deep --help` prints the same. |
| `heap.test.mjs` | `#2696.be4d3304 #3706.c1a4b78e` | On #16's 30-day record (`seedHistory`, 90,600 events), `deep hub run` from a copy of this checkout as built and from the build without the step, five times each in turn; the core thread's `heapUsed` after two full collections (`coreHeap`, `../2696/heap-preload.mjs`) has a median at least 1.2 x 2^20 bytes under the other's. |
| `lanes.test.mjs` | `#3706.75c61bdf` | Through `scripts/lanes.mjs`: `redrafted['tests/acceptance/2696/base.test.mjs']` is this folder, that file runs by hand, and `newfile.test.mjs`, `lint.test.mjs` and this folder's test files run in the alone block, none by hand. |
| `helpers.mjs` | | Re-exports the first draft's helpers, and builds the build without the step. |

The first draft's `newfile.test.mjs` (`#2696.ced33c08`, and `#2696.6fbf771a`'s raw-template plant) and
`lint.test.mjs` (`#2696.ced33c08`) are not redrafted: #3706 does not dispute them, and they keep running.

## How it runs

- `npm ci`, `npm run build --workspaces`; `heap.test.mjs` also needs `target/debug/deep-hook` or
  `target/release/deep-hook` (`cargo build --locked -p deep-hook`), else it is BLOCKED.
- `node --test tests/acceptance/2696-redraft-3706/<file>`, one file at a time. `lane.json` runs the folder alone
  (`shared`): `tests/acceptance/2696/lint.test.mjs` plants an unescaped file in this checkout's `packages/verdicts/dist`
  while it runs, which `none-above.test.mjs` would read; the other two files build a copy of the checkout and start
  hubs. `same-text.test.mjs` and `heap.test.mjs` each take over two minutes, so `lane.json` lists them as `slow`.
- Every scratch folder is removed and every child stopped by its PID in the file's `after`.

## Twins (line form, `twins/<name>/lines.json`)

| Twin | Wrong program | Fails |
|---|---|---|
| `skips-core-js` | `scripts/built-escapes.mjs` leaves every file named `core.js` unescaped | `none-above` (names `packages/hub/dist/core.js` and its line) |
| `escapes-json-only` | the step escapes JSON files only, no script | `none-above`; `heap` (no saving in the core thread; not yet run, see `BASE-RESULTS.txt`) |
| `adds-a-line` | the step writes a line feed before each file it rewrites | `same-text` lines (names each file) and thrown line |
| `doubles-escapes` | the step writes each character of a string or template twice | `same-text` messages (names the file, line and both readings) |
| `hands-the-whole-folder` | `scripts/lanes-lists.mjs` puts `tests/acceptance/2696/` by hand, not just `base.test.mjs` | `lanes` |

`twins.json` names each under every criterion of the tests it fails. `BASE-RESULTS.txt` holds every run.

## Assumptions where the issues are silent

- "Its source's line count" (#3706.414a9c5f) is the line count of the same file built without the escape step: a
  TypeScript source and its `tsc` output differ in lines by design (types and interfaces drop out), and the escape
  step is what #2696 says must not move a line.
- A built file is any regular file under `packages/<name>/dist`; one whose bytes are not UTF-8 text is a binary and
  left out. A line count is one more than the line feeds.
- The thrown errors are those the first draft chose; if `testClock` moves or goes, the test is BLOCKED, not passed.
- 1.2 MB is 1.2 x 2^20 bytes, as `startup-memory.test.ts` counts MB. Five readings a side and medians, as the first
  draft argued.
- The `#2696.6fbf771a` raw-template plant stays with `tests/acceptance/2696/newfile.test.mjs`: no built file of this
  tree holds a tagged template with such a character, so no wrong program for it can show here.
