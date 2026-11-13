# Acceptance tests for #409, Oracle lane: the outside film gate run against our export

Written first, blind, from issue #409, its Oracle page (`doneright/oracles/issues/409.md` on branch `doneright` of
`DeepBuildAI/deepbuild`), the upstream files that page pins (read from that branch's `doneright/oracles/vendor/`), the
#409 suite's surface (`tests/acceptance/409/README.md`, written by the same job) and base commit `cbd5e4f98`, by a job
that never saw an implementation of #409; none existed, and no other worktree, branch or PR was read. #136's rule
applies: a linked test counts only when run against our output, so the gate reads only MP4s `deep-show run`'s `export`
writes. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

Scope: criterion 2, `#409.c9b3929c` ("Motion share measured in the app matches the outside film gate on the same export
within 0.005"), the one criterion the Oracle page links an upstream test to. The other five stay in
`tests/acceptance/409/`.

## Sources

| Criterion | Upstream, pinned | Files | Use | License |
|---|---|---|---|---|
| 2 | the outside film gate, the commit the Oracle page pins | its `scripts/film_gate.py` (SHA-256 `2d375cc2bea291e7a1b837d5755b49fbda72f5f75515758c09bf7d83cd269e52`) and `tests/test_film_gate.py` | run on our output (the script); port (the tests' slow-push and punch expectations) | MIT; nothing of it is copied: the lane runs the script, a separate program, from outside the repository |

The gate reads an MP4 only: frames at 12 fps, 320 px wide, grey (ffmpeg's `fps=12,scale=320:-:flags=area`, `gray`), the
bottom 15% masked on a landscape film, each pair's mean absolute difference; pairs it finds to be cuts (a jump no
camera motion explains) or inside a cross-fade (a window whose middle frames are blends of its ends) are left out, and
`fast_ratio` is the share of the rest at 9 levels or more. That is craft@1's motion share as the design writes it (12
fps, 320 px wide, grey, the caption band masked, cuts and cross-fades left out, a pair counted at 9 levels). Its tests
render three films of three 3 s shots joined by cuts and require a uniform slow push to read red (`fast_ratio` under
0.035) and a hold, a 0.3 s 30% punch, a hold to read green (0.06 or more). Ported: those two expectations, held to our
slow and lively exports. Not ported: the smooth-push case, the short-clip downgrade, an unreadable file, the text
report, and the delivery and QA tests (they read another program's files).

## Run

```sh
npm ci                      # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
DEEP_FILM_GATE=/path/to/film_gate.py node node_modules/vitest/vitest.mjs run --root tests/acceptance/409-oracle --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/409-oracle/tsconfig.json   # type-check (exits 0)
rm -rf tests/acceptance/409-oracle/node_modules/.vite
```

`scripts/lanes.mjs` needs `'tests/acceptance/409-oracle/'` in its `alone` list (the line is in the #409 README; this job
writes only its folders). The file builds `deep-show` once through `../409/helpers.ts` (#407's `useBuilds`, `--features
full`) and fails its test when the build fails. It exports two films through the GPU and the encode tool, then runs the
gate twice with `uv run --quiet --script <gate> <mp4> --json --no-template`, in a temporary folder, with
`/opt/homebrew/bin` and `/usr/local/bin` ahead of PATH for ffmpeg. The first run lets uv fetch the gate's Python
packages (numpy, opencv-python-headless), the only network the lane uses. Temp folders are removed after the test; no
process is stopped by name or port.

**Where the gate is:** `DEEP_FILM_GATE` names the script's path; else `~/Library/Caches/deepbuild/film-gate/film_gate.py`
*(chosen)*. The file must hash to the pinned SHA-256. A lane whose runner is missing fails with a line starting
`BLOCKED:`, never passes, with one unblock line:

- no gate at that path, or another version of it: save the gate the #409 Oracle page pins (its `scripts/film_gate.py`)
  there, or name it in `DEEP_FILM_GATE`;
- no `uv`: `brew install uv`; no `ffmpeg` or `ffprobe`: `brew install ffmpeg`.

## The surface under test

Exactly the #409 suite's (`tests/acceptance/409/README.md`): the agent presents each film with `deep_show`; a claim of
its whose brief is `{goal, craft: [{check: "motion_share"}]}` gets a `verdict`, and the motion_share row's
`measure.share` is the app's motion share *(chosen there)*; `export` writes the film to `<folder>/<name>.mp4` with
`video: {codec: h264}` and no audio (the films have no sound). The app measures the film the export draws, so "the same
export" is the film exported and judged at the same revision.

## The motion films

Both are 640 × 360 u at 12 frames a second under the look `lk-a`, on a 1920 × 360 page of three regions: A (white, two
ink bars at the top), B (a muted panel, two white bars) and C (a raised panel, six ink blocks). At 12 fps the gate's
frames are the film's own, so no frame is dropped or doubled between the two measures.

- **Slow** (9 s): three 3 s shots of regions A, B and C, each a `push` of 7.5% (the gate's slow-push case), joined by
  cuts at 3 s and 6 s. Every pair within a shot moves well under 9 levels; the cuts jump far more than 8 levels over
  still neighbours, which the gate reads as cuts. Both measures: no fast pair, 0.
- **Lively** (12 s): `shot-a` (region A, 0–4 s), a cut at 4 s, `shot-b` (region B, 4–8 s), a 2 s cross-fade centred on
  8 s (7–9 s), `shot-c` (region C, 8–12 s). A 60 × 240 u bar sweeps across A from 1 s to 2 s and across B from 5 s to
  6 s, 48 u a frame: 12 pairs each, each far over 9 levels (about 27 and 15 at 320 px), while every other pair barely
  moves. The sweeps last a second, so the gate's cut test (a pair over three times its twelve neighbours' median) never
  takes them for cuts, and they sit over six pairs from the cut and the cross-fade. The cross-fade is 24 pairs between two
  still frames, the gate's widest window, blended per 8-bit channel, so its window is the transition's. 143 pairs, less
  the cut and the 24 cross-fade pairs, leave 118; 24 are fast: 0.203 by both, clearly green. A pair counted on one side
  of a window's edge and not the other moves the share by under 0.002; only a fast pair missed or added would move it
  past 0.005.

## Criteria to tests

| ID | File (tests) | What it asserts | Wrong program |
|---|---|---|---|
| AC2 `#409.c9b3929c` | `motion.test.ts` (1) | The gate reads the slow export red (`fast_ratio` < 0.035) and the lively export green (≥ 0.06), as its own tests ask of a slow push and a punch; for each film, \|`measure.share` − `fast_ratio`\| ≤ 0.005 | The base (no motion_share row, no measure); a measure at other settings (24 fps, the band unmasked, cuts or cross-fades counted, another threshold), which moves the lively share by far more than 0.005 |

## Readings

- The gate's `fast_ratio` is rounded to 4 decimals; the tolerance is the issue's 0.005, never widened.
- The films are short (9 s and 12 s); the gate's short-clip rule only softens its light, never its ratio, so it is left on.
- The gate's own red and green on our exports are asserted too, so two measures that agree on a broken export (all
  frames still) can't pass.

## Not tested

The gate's other readings (blank runs, blue-purple share, events, pushes per minute); its smooth push; vertical films;
films longer than a minute.
