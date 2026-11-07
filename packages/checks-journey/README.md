# @deepbuild/checks-journey

## What it is for

The first-party journey check kind (#37). It drives a browser journey with Playwright against a stack env-local started from the run's own checkout, checks the end state, and keeps the video, screenshots and trace as evidence that outlives the stack's teardown; an API journey drives the stack's service with real requests and reads the end state back from it. It also holds the feature list (`.deepbuild/features/`), the changed features' journeys with their neighbors, saved scripts and replays, the "no visible change" comparison with the merge base, the latency check, screens compared with masks, motion assertions and a model's reading of a screen. `journeyCheckKind(host)` fills the check.kind@1 slot for the kind `journey`.

## Where new code goes

- `src/index.ts`: the public entry and the run itself (the stack, the record, screens, latency, motion, the check.kind@1 fill); `src/journey.ts`: the journey file as data, with lines, and its review; `src/run.ts`: one driver run through host@1; `src/api.ts`: API requests.
- `runtime/driver.mjs`: the Playwright driver, one process per run, started through host@1.
- `src/features.ts`, `src/compare.ts` (steps against the last PASS), `src/replay.ts` (saved scripts and the journey they carry), `src/latency.ts`, `src/screens.ts` and `src/png.ts` (pixels, masks, highlights, side by side), `src/motion.ts`, `src/reading.ts` (the quote rule).
- Tests: `test/` for regressions; the acceptance suite is `tests/acceptance/37/`.

## What it may import

Extension layer. It reaches `@deepbuild/checks-command`, `@deepbuild/conformance`, `@deepbuild/env-local`, `@deepbuild/evidence`, `@deepbuild/gate`, `@deepbuild/supervisor` and `@deepbuild/verdicts` (types) through their package entries, plus `playwright`, `yaml` and `node:` built-ins. Every process (the driver, the stack) starts through the host it is given. It never imports the hub, the CLI or the app.

## Deviations

- `runtime/driver.mjs`: plain `.mjs`, because it runs on its own in the run's process, outside the hub, with Playwright loaded from the repo's dependencies.
- The driver runs as you (`run_as_you`), not under the file grant: Chromium's GPU process lists `/sys/bus/pci` and fontconfig lists the font folders, which the sandbox's read grant never allows (it reads files, never lists folders), so the browser dies there. It is DeepBuild's own runtime, like env-local's seed step, and still reaches only the stack's host; the page it drives is the repo's, served by the stack started from the run's checkout.
- `src/index.ts`: `journeyCheckKind` answers a spec of kind `command` through `@deepbuild/checks-command`, an extension importing a sibling extension: check.kind@1's kit cases are command suites, and a kind that fills the slot must pass them (tests/acceptance/37/README.md, Readings: The kit).
- `runtime/driver.mjs` decodes PNGs itself (a copy of `src/png.ts`'s decoder) to tell two frames apart outside the masks: it runs in the run's own process, where the TypeScript sources aren't loadable.
- The video stays the WebM Playwright writes: its bundled ffmpeg muxes nothing else, so the evidence store checks a WebM whole at intake (its Segment's size finalized) instead of an MP4.
