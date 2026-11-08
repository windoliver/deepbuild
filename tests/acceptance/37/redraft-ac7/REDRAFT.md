# Blind redraft of #37's AC7: a receipt opens the journey's video within one frame of the checked step

Written on November 4, 2026, at base commit `69803b94`, by a drafting job that never saw an implementation of #37.
The file goes at `tests/acceptance/37/redraft-ac7/receipt.test.ts`. It does not replace or edit the first draft
(`evidence.test.ts`, which this job did not read).

**Criterion:** `#37.8b056f27`. That is the first 8 hex digits of the SHA-256 of "A receipt opens the journey's video
within one frame of the checked step" (trimmed, whitespace collapsed, `- [ ] ` dropped, as `scripts/proof-change.mjs`
computes it). Checked with `sha256sum`. It matches the first job's ID.

## What this job read

- Issue #37 in full, through `gh api` (read-only). Read closely:
  - AC7.
  - The Scope bullet: "Each step's start and end time in the video is kept with the evidence, so a receipt opens the video at that step".
  - AC16's "video at 720p and 15 fps".
  - The Added Oct 9 bullets: every step has an ID and a deadline, plus the fixed defaults.
- `AGENTS.md`.
- `docs/technical-design.md`:
  - the record's `evidence(hash, kind, redaction, license, step_times)` row: "step_times let the player open a video at a check's step";
  - Evidence (files by hash; "A receipt that cites a hash can't point at a swapped file");
  - How runs become one of five verdicts (Evidence states: only captured, complete evidence supports PASS);
  - the Evidence primitive;
  - the `journeys` row ("It saves video, screenshots and the trace as evidence");
  - Dogfooding and Tests written first.
- From the first job's suite in the redraft worktree: `README.md` (The surface under test, the journey file, the sample app, Readings, Wrong programs), `helpers.ts`, `fixtures/app` (`server.mjs`, the journeys, `done.yaml`), `endings.test.ts`, `errors.test.ts`, `stack.test.ts`, `motion.test.ts` (head), `steps.test.ts` (head) and `tsconfig.json`. `evidence.test.ts` was not opened.
- `packages/evidence/src/index.ts`: `PutRequest.steps` ("For a video: where each step starts and ends, so a receipt can open it at that step"), `Step { step, startMs, endMs }` and `Evidence.steps`.

## Readings

- **"The journey's video" and "the checked step".**
  - The receipt is the surface's `receiptFor(run, step)`. Its `video` must be the run's `video` hash. That video must be stored whole (`intake: captured`) and be a WebM (`isWebm`).
  - A "checked step" is any step that was run and checked. The test takes receipts for every step: a `goto`, two toPass holds and the `expect` on the cart total (`see-total`, the step the test names as checked).
- **Where the receipt opens.** The receipt's `atMs` is within one frame of where the step starts in the video. Two readings support this:
  - The Scope says the times are kept "so a receipt opens the video at that step".
  - The design says `step_times` "let the player open a video at a check's step". Opening at a step means opening where it begins.
  - This matches the first job's README reading (Within one frame). A receipt anywhere else in the step's span would fail here.
- **Where the step is "in the video".**
  - The step times kept with the video's evidence are the store's `Evidence.steps` for `run.video`. The Scope says they are "kept with the evidence".
  - The run's own `steps[].startMs/endMs` must agree with them to within 1 ms.
  - The receipt is measured against the kept times.
- **"One frame".**
  - This is one frame of that video: its median frame interval, read from the WebM's block timestamps.
  - It is capped at 1000/15 ms, because the issue fixes the video at 15 fps (AC16).
  - At 15 fps this is 66.7 ms. At Playwright's default of 25 fps it is 40 ms.
- **Proving the times are the video's, not only the record's.** The test reads the video's own frame timestamps. It parses the Matroska structure only: cluster `Timecode`, the `TimecodeScale`, and each `SimpleBlock`'s or `Block`'s offset. It then requires four things:
  - every step lies inside the video's frames, from no earlier than one frame before its first frame to no later than two frames after its last;
  - the steps are in order and don't overlap by more than a frame;
  - the record holds every step;
  - each hold lasts at least 2000 ms less a frame.
- **Machine speed.** The journey's two holds are toPass blocks that pass once 2000 ms have passed, in the page, since their first attempt. Such a step can't be shorter on any machine. That guarantees three things however fast or slow the run is:
  - the checked step starts at least 2000 ms into the video;
  - it starts at least 2000 ms after the step before it;
  - each hold's end is at least 2000 ms after its start.

  No assertion has an upper time bound tied to machine speed.
- **What the test doesn't do: decode the video's pixels.** The test may import only `helpers.ts` and the surface, so no decoder is available.
  - This job checked whether frame sizes alone could anchor a visible page change in time. It screencast the fixture app's `clock-footer` build with the cached Chromium headless shell into Playwright's own ffmpeg (libvpx-vp9, realtime) and read the result with this test's parser.
  - They could not. The encoder's periodic refresh frames (2–6 KB every 10 frames on a still page) are as large as a full page change, and a quiet page's refinement frames are as large as the ticking clock.
  - The run did confirm the parser: 118 frames at 15 fps and 198 at 25 fps, timestamps from 0, and median intervals of 67 and 40 ms.
  - So the anchor to the video is its frame timeline, not its content. A step record shifted by a constant smaller than the video's tail after the last step is not caught here. The surface's run record has no independent clock to catch it with.

## The wrong programs it catches

The second test runs the criterion's own assertions on wrong receipts and wrong step times built from the same run. Each must fail (`assertionFails`). The right receipts pass first, so each failure comes from the wrong program alone. Each failure is guaranteed by the hold lower bounds, not by machine speed.

| Wrong program | Why it fails, on any machine |
|---|---|
| every receipt at 0 | `see-total` starts ≥ 2000 ms − 1 frame into the video |
| each receipt at the step before's start | `see-total`'s previous step (`hold-a`) started ≥ 2000 ms − 2 frames earlier |
| each receipt at the step after's start | after `hold-a` comes `see-total`, ≥ 2000 ms − 2 frames later |
| each receipt at its step's end | each hold lasts ≥ 2000 ms − 1 frame |
| receipts in wall-clock time, or in seconds | the time is nowhere near the kept start |
| a receipt citing another video | `video` must equal the run's video hash |
| step times in wall-clock (epoch) ms | they end past the video's last frame |
| step times in seconds | a hold then lasts about 2 "ms" |
| no step times kept with the video | the kept steps must list every step |
| every step at 0 | a hold has zero length |

The first test also catches these:

- a runner whose run record disagrees with the times kept with the video by more than 1 ms;
- a video that isn't stored whole, or isn't WebM;
- a journey that doesn't pass on the working build.

## How to run

At the base, `packages/checks-journey` doesn't exist. Every test fails at `journey()`'s assertion that the public entry exists, and nothing is skipped. With the implementation in place, use the first job's README setup (Node 24.22.0, `npm ci`, Playwright's Chromium, `npm run build --workspaces`):

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/37 --no-file-parallelism redraft-ac7/receipt.test.ts
node node_modules/typescript/bin/tsc -p tests/acceptance/37/tsconfig.json   # the suite's tsconfig includes ./**/*.ts
```

On Linux, run Vitest with a Node the supervisor's sandbox can read, as that README says. The run takes one stack and
one browser journey of about 5 s plus stack start-up. The two tests share that one run.

## Unrun, and risks

- Nothing in this file has been run against an implementation, since none exists at this base. Neither file has been
  type-checked: the redraft worktree has no `node_modules`.
- The WebM parser was run on two real VP9 WebM files made as described above.
- The test assumes three things about the implementation:
  - **The hold syntax.** A toPass hold is written as the README's `expect: { until: true, evaluate, equals }` with a step-level `timeout`. `evaluate` must be a JavaScript expression evaluated in the page, as Playwright's `page.evaluate(string)` does.
  - **WebM output.** The video is WebM, as Playwright records it and as `helpers.ts`'s `isWebm` expects.
  - **Constant frame rate.** The video keeps frames at a constant rate until recording stops. Playwright's recorder and an ffmpeg `-r` pass both do. An encoder that drops still frames from the end would put the last steps past the last frame.
