# Acceptance tests for #2742: film2d's gpu_ms times the GPU-layer compositor's own submissions

Written first, blind, from issue #2742 (its Scope, its two acceptance criteria and its Proof line), the design sections
it links, and the base: this worktree's HEAD `80561d40c` (the merge of #2726), by a job that never saw an
implementation; none existed, and no other worktree, branch, PR or stash was read. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 2742 --repo windoliver/deepbuild`). Two criteria. Each test's name starts
  `AC<n> #2742.<id>`, the first 8 hex digits of SHA-256 of the checkbox's text, trimmed, white space collapsed
  (`scripts/proof-change.mjs`, `criterionId`): AC1 `#2742.f2fad73c`, AC2 `#2742.fbe6114c`.
- `docs/canvas-primitives.md`: The cost model (the class table) and Meter and degrade ladder ("A frame's GPU time is the
  time covered by at least one of its passes, read from their timestamps, never the sum of their intervals").
- `docs/technical-design.md`: Every task carries its own budgets, the reference Macs, Dogfooding and Tests written
  first.
- At the base, for call shapes only: AGENTS.md; `crates/deep-gpu-layer/src/{main,film,marks2d,groups}.rs` and
  `groups/compose.rs` (`film2d`'s fields and rows; where the compositor submits and where the frame's timer starts);
  `crates/deep-marks-render/src/gpu.rs`; `crates/deep-canvas-marks/src/scene.rs` (a group's `passes`, `rect@1`,
  `circle@1`); `crates/deep-canvas-effects/src/module.rs` (`pass_graph`: the shipped `blur@1`); the sibling suites
  `tests/acceptance/417/` (its README, helpers and the files AC2 runs), `430/` (groups with `passes` in 2D documents,
  `film2d` with the clean look), `464/`, `467/` and `468/` (the build, `runGpu`, `requireMetal`, the row readers).
  Nothing is imported from another suite.

## What the base does

`film2d` (#417) answers a row per frame, `{frame, gpu_ms, cpu_ms, fills}`. Its `gpu_ms` is the GPU layer's part from
the end of the frame's own encode to the device's report that the slot's work is done, plus what GPUI's frame spent on
the GPU past the window's own (film.rs, `render` and the row). A writer layer holding a group with `passes` is drawn by
the GPU-layer compositor (marks2d.rs, `Painter::draw`; groups.rs): it draws each run of marks with Vello GPU, the
group's children into a target of their own, runs the passes and composites, each on a command buffer it submits
itself, all before the frame's job ends its encode, so none of that work is timed unless it is still running when the
timer starts. That is the bug: the issue's #2031 reading (16 lights at 1.078 ms against 1.286 ms with none) is one case.

## Run

```sh
npm ci                                   # once, if node_modules is missing
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH" NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2742 --no-file-parallelism ac1-composited-gpu-time.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/2742 --no-file-parallelism ac2-417-unchanged.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/2742/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/2742/node_modules/.vite
```

Run the files one at a time. `ac1-composited-gpu-time.test.ts` builds `deep-gpu` once, in `beforeAll` (up to 7,200,000
ms), with `cargo build --locked --bin deep-gpu`, the pinned toolchain first on PATH and `CARGO_INCREMENTAL=0
CARGO_PROFILE_DEV_DEBUG=0` (helpers.ts, `buildEnv`), and copies it out of `target/` (`CARGO_TARGET_DIR` honoured). So
`scripts/lanes.mjs` needs `'tests/acceptance/2742/'` in its `alone` list; this job writes only this folder, and the
implementer makes that edit. Everything draws on macOS's Metal device: off macOS a test fails with a message starting
`INCONCLUSIVE:`, never passing, as does an `unsupported_platform` answer. Each test writes into a temporary folder it
deletes. `BASE-FAILURE.txt` is AC1's run on the base.

AC2 is #417's own suite, run as it stands. `ac2-417-unchanged.test.ts` runs exactly this in a child process, with the
environment above, and reads its JSON report:

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/417 --no-file-parallelism \
  derived.test.ts distance.test.ts fallback.test.ts fonts.test.ts looks.test.ts state.test.ts switch.test.ts
rm -rf tests/acceptance/417/node_modules/.vite
```

That is every `*.test.ts` in `tests/acceptance/417/` but `budgets.test.ts`, listed again at run time, so a file added
there later is run too. Those files build `deep-canvas-render`, `deep-text` and `deep-motion` themselves (417's README).
The child run leaves Vitest's cache in `tests/acceptance/417/node_modules`; the test removes that folder when it wasn't
there before the run.

## The surface under test

No new call, field, binary or planted program: #377's `deep-gpu run` and #417's `film2d` as they are at the base,
`{"call": "film2d", "doc", "look": "clean", "frames": 60, "fps": 60}`, each row's `frame`, `gpu_ms` and `cpu_ms`. A
right program changes only what `gpu_ms` reads on a composited frame.

## The fixture

helpers.ts, `filmDoc`. One writer layer `main`, 1920 × 1080, profile `figure`, `requires.modules.effects`, in the
shipped `clean` look (as #430's `film2d` plays use it). In draw order:

1. The group `heavy` (`group@1`). On the composited side it has `passes: [{"op": "blur@1", "params": {"radius": 2}}]`,
   the shipped blur, so the GPU-layer compositor draws the layer; in the twin its `params` are empty: the same document
   with the group's `passes` removed, the group item kept.
2. Inside it, 64 washes: `rect@1` over the whole frame, `raised` and `accent` in turn, fill opacity 0.5. Heavy for the
   GPU (64 translucent layers over 2,073,600 px, none hiding another) and light for the CPU (64 rects).
3. After it, 4,000 specks: `circle@1` of radius 1.5 px in `ink`, 100 a row, 4 px apart, in a 400 × 160 px patch at
   (20, 20). Heavy for the CPU to encode (4,000 marks) and light for the GPU (about 28,000 px).

Both sides encode the same 4,064 fills a frame (each row's `fills`), so they draw the same marks. Each side plays once,
`film2d` with 60 frames at 60 fps, in a `deep-gpu run` process of its own, the twin first; the test judges the median
of each side's 60 `gpu_ms` (the mean of the 30th and 31st readings in sorted order), and the assertion's message lists every reading.

### What was tried at the base, and why these numbers

All on this worktree's base binary (debug, as the test builds it), on a Mac17,10 (M5 Max, 40 GPU cores, the fastest
reference Mac) on mains, with the one-minute load between 815 and 912 on its 18 cores (other sessions' builds; nothing
here waited for a quiet machine; the last row ran under more). Each line is one 60-frame play per side; the median
`gpu_ms` in ms:

| Washes | Specks | How played | Twin | Composited | Composited ÷ twin |
|---|---|---|---|---|---|
| 64 | 0 | one process, twin, composited, twin, composited | 6.874, 8.081 | 3.607, 3.410 | about 0.45 |
| 0 | 4,000 | the same | 2.494, 3.133 | 4.563, 2.552 | (no group drawn: both sides are one document) |
| 64 | 4,000 | the same | 9.079, 8.918 | 2.731, 2.083 | about 0.25 |
| 64 | 4,000 | a process per side, twice | 9.429, 10.336 | 1.740, 2.271 | about 0.2 |
| 64 | 1,000 | a process per side | 8.654 | 2.205 | 0.25 |
| 16 | 4,000 | a process per side | 3.911 | 1.521 | 0.39 |
| 128 | 4,000 | a process per side | 12.751 | 1.722 | 0.14 |
| 64 | 4,000 | the test itself (BASE-FAILURE.txt), load about 900 to 950 | 13.855 | 4.748 | 0.343 |

- With no washes the frame's own work, the window's and this machine's load read 2.5 to 4.5 ms a frame: that is the
  floor both sides share. The 64 washes add about 6 to 7 ms of GPU work to the twin over it.
- The composited side reads at or under that floor at the base: the washes, drawn and submitted by the compositor
  before the frame's own encode ends, are done before the timer starts. With no specks it already reads under the
  bound (the compositor's own CPU between its submissions hides part of the washes), and the 4,000 specks, encoded
  after the group, hide the rest: the reason the issue gives.
- A right program adds the union of the compositor's submissions to what the composited side reads today. Those hold
  the washes drawn by Vello GPU as the twin draws them, plus the blur, the clears, copies and composites of the
  compositor's float targets and the final resolve, so it should read above the twin's median, not near 0.9 of it; the
  twin, which nothing composites, reads as today. No right program exists to show this on; it is the reading of the
  issue's Scope against the base's code.
- 64 washes and 4,000 specks put the base at a fifth to a third of the twin, far from 0.9, while one play takes about 10 s
  (most of it evaluating 4,000 items in a debug build), so the test runs in well under a minute once the binary is
  built. 128 washes bite harder but double the GPU work for nothing the criterion needs; 1,000 specks still bite here,
  but leave less CPU time to hide the washes on a Mac with a slower GPU.

## Criteria → tests

| Criterion | Test (file: name) | What fails it |
|---|---|---|
| AC1 the composited side's median `gpu_ms` at least 0.9 × its twin's | `ac1-composited-gpu-time.test.ts`: "film2d at 1920 × 1080, 60 frames at 60 fps: the composited side's median gpu_ms is at least 0.9 times its twin's…" | the composited side's median under 0.9 × the twin's (the base: the compositor's submissions finish before the timer starts); a play refused or exiting non-zero; a play without one row per frame, frames 0 to 59 in order, each with a finite `gpu_ms` and `cpu_ms` at or above 0 |
| AC2 #417's tests other than its budgets pass unchanged | `ac2-417-unchanged.test.ts`: "tests/acceptance/417's tests other than its budgets are unchanged from the merge base and all pass" | a file of `tests/acceptance/417/` other than `budgets.test.ts`, its README and its BASE-FAILURE.txt differing from the merge base with origin/main; a test there failing or skipped; a file there not run, or running no test |

## Deviations and open points

- AC2's first half says "`film2d`'s rows keep their shape and every frame still draws", but `tests/acceptance/417/`'s
  tests other than its budgets don't play `film2d`: they drive `deep-canvas-render`, `deep-text` and `deep-motion`.
  Only `budgets.test.ts` reaches `film2d` (through `benchmarks/canvas.mjs look-frames` and `look-switch`), and the
  criterion leaves it out. AC2's test holds the text after the colon, as written. The rows' shape and every frame drawing
  are held for AC1's two plays instead: 60 rows, frames 0 to 59 in order, a finite `gpu_ms` and `cpu_ms` at or above 0
  each (helpers.ts, `gpuReadings`).
- "Unchanged" is read as: no file of `tests/acceptance/417/` but `budgets.test.ts`, `README.md` and
  `BASE-FAILURE.txt` differs from the merge base with origin/main (`git diff --name-only`, working tree included). A
  checkout with no origin/main reads INCONCLUSIVE.
- "On any Mac" sets no reference-Mac, power, thermal or load condition, so AC1 runs on any macOS machine and reads
  whatever the machine gives; it is a ratio of two medians taken back to back, not a budget. The readings above came
  under very heavy load; a quiet machine reads lower floors on both sides.
- The median of an even count is taken as the mean of the two middle readings.
- The twin keeps the group item with no `passes` ("the same document with the group's `passes` removed"); removing
  the group as well would change the document by more than the criterion says.
- The criterion doesn't name the passes or the marks: the shipped `blur@1` at radius 2, 64 washes and 4,000 specks are
  this job's choice, sized above.
- The issue's Proof line also asks for each budget suite that reads `film2d`'s `gpu_ms` on a composited frame, named
  with whether its reading moves. That is the implementer's report, not a criterion, and no test here checks it.
- No planted program: the base is AC1's wrong program (BASE-FAILURE.txt). AC2 passes at the base, as a criterion that
  keeps what works must; its wrong programs are those #417's own tests fail. AC2's test wasn't run by this job (the
  rule against running neighbouring suites); its JSON-report reading was checked against Vitest 5.0.5's report on a
  throwaway two-file suite outside the repo.
