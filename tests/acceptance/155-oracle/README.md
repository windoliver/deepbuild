# Acceptance tests for #155, Oracle lane: upstream's sample-accurate scheduling run on spawned voices on stroke occurrences

Written first, blind, from issue #155 (`gh issue view 155 --repo windoliver/deepbuild`, body only, as of Nov 15, 2026),
its Oracle page (`doneright/oracles/issues/155.md` on branch `doneright` of `DeepBuildAI/deepbuild`), the one upstream
file that page pins, the design rows, and the base commit `0e5572731` (origin/main), by a job that never saw an
implementation of #155; none exists, and no other worktree, branch or PR was read. #136's rule applies: a linked test
counts only when run against our output, so the upstream case here is asserted against the mix `deep-show run` makes
of a film whose spawn plays a generator source on a path's stroke occurrences. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criterion 8 (`#155.ec088f1d`), the one criterion the Oracle page links an upstream test to, and only the part of
it upstream checks: each voice starts on its stroke occurrence's sample and nowhere else. The material each collection
binds, seek against play and the first-collection twin are ours and stay with `tests/acceptance/155/materials.test.ts`.

## Source

| Criterion | Upstream, pinned | File | Use | License |
|---|---|---|---|---|
| 8 | the upstream test suite, commit `2f57f45d21482f94b36123dfcec77ae7ab859bc1` | `webaudio/the-audio-api/the-audiobuffersourcenode-interface/sample-accurate-scheduling.html`, vendored at `doneright/oracles/vendor/wpt-2f57f45d21/webaudio/the-audio-api/the-audiobuffersourcenode-interface/sample-accurate-scheduling.html` | port | 3-Clause BSD, its notice kept in `sample-accurate.test.ts` |

Upstream schedules one 512-sample impulse (1 at its first sample, 0 after) at the sample offsets 0, 3, 512, 517, 1000,
1005, 20000, 21234 and 37590, inside and across 128-sample render quanta, renders 4 s offline, and asserts
(`checkSampleAccuracy`): the left and right channels match; every non-zero sample is at one of the offsets; the count
of non-zero samples equals the offsets'. That function is re-expressed in `sample-accurate.test.ts` beside its
upstream name, with the offsets copied as upstream writes them; no other upstream code is copied.

## How it runs on our output

- **The impulse** is a generator source (Strip and track: generator sources, `src: {generator: {job, output}}`): the
  stem `click` of the score item `clicks`, whose one note at 1:1 plays the library test/clicks's one take, upstream's
  impulse as a 48 kHz mono 16-bit WAV (CC0, fetched by the hub under your standing rule), at its root, `vel` 0.25, no
  attack or release. score.render@1 (deepbuild/score, #154) renders it through deep_job on a real hub, and the run's
  reply is handed to deep-show among the scenario's `jobs` (`tests/acceptance/155/README.md`, The surface under test).
  The job's ID for a score stem is the score item's ID, its output the stem's name *(chosen)*.
- **The schedule** is a path `pen` of nine strokes (`path@1` with `build: {progress, emits: true}`, as #466 left it),
  its build progress held in steps: (k + ½) ÷ 9 from the flick of sample 48,000 + offset k. Stroke k is the k-th row of
  `pen.build`, first past k ÷ 9 at exactly that flick. Upstream renders at 44.1 kHz from 0; the offsets are kept as
  sample indices, shifted by 48,000 (a multiple of 128), so their place in 128-sample quanta is upstream's.
- **The render** is `media_mix` of the film (the score item, the path and a spawn `ticks` on `pen.build` playing
  `{generator: {job: "clicks", output: "click"}}`, no cooldown) over [0, 2 s), its WAV read from the evidence store.
- **Asserted:** nine voices, at the nine strokes' flicks; upstream's check passes on the mix's two channels.
- **The planted fault**, built here from our own mix: each impulse moved to the first sample of its 128-sample
  quantum, as a mixer that starts voices per block would place them. Upstream's check must reject it, naming sample
  48,896, where 49,000 and 49,005 land.

## Run it

As `tests/acceptance/155/README.md` (it imports that suite's helpers and #154's library helpers, and needs the same
builds; `deepbuild/score` comes from the base's `packages/jobs/score`):

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/155-oracle --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/155-oracle/tsconfig.json
```

Needs `openssl` (the test CA). The implementer adds `tests/acceptance/155-oracle/` to `alone` in `scripts/lanes.mjs`
with `tests/acceptance/155/`.

## Readings

- **Why a score stem and not a foley variant.** Upstream's check needs an impulse; a foley preset is the pack's own
  sound. The criterion's upstream part is where a voice on a stroke occurrence starts, which is the same rule for any
  generator source a spawn plays, so the impulse comes from the other generator the design names, score.render@1.
- **"Non-zero"** is a sample of the float mix other than 0: the stem has no dither (Score As built) and the master's
  limiter only scales samples, so a silent sample stays 0.
- **The click carries a bend** (`[[0.03, 0], [0.06, 1]]`) from 30 ms, after the 512-sample take has ended, so it changes
  no sample and score.pitch lists the click as unmeasured, as #154's Oracle lane does.
