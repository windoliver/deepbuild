# Acceptance tests for #154, Oracle lane: upstream's sample-accurate scheduling run on score.render@1's output

Written first, blind, from issue #154 (`gh issue view 154 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/154.md` on branch `doneright` of `DeepBuildAI/deepbuild`), the one upstream file that page
pins, the design rows, and the base commit `b726c8be8`, by a job that never saw an implementation of #154; none
exists, and no other worktree, branch or PR was read. #136's rule applies: a linked test counts only when run against
our output, so the upstream case here is asserted against the plan's note_on, the render's meta and the stem that
deepbuild/score writes. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

Scope: criterion 2 (`#154.8b0e5b99`), the one criterion the Oracle page links an upstream test to, and only the part
of it upstream checks: each note starts on its own sample and nowhere else. score.pitch's check of the stem and its
planted twin are ours and stay with `tests/acceptance/154/onsets.test.ts`, as do the note_on lists through a tempo map
with a ramp.

## Source

| Criterion | Upstream, pinned | File | Use | License |
|---|---|---|---|---|
| 2 | web-platform-tests, commit `2f57f45d21482f94b36123dfcec77ae7ab859bc1` | `webaudio/the-audio-api/the-audiobuffersourcenode-interface/sample-accurate-scheduling.html`, vendored at `doneright/oracles/vendor/wpt-2f57f45d21/webaudio/the-audio-api/the-audiobuffersourcenode-interface/sample-accurate-scheduling.html` | port | 3-Clause BSD, its notice kept in `sample-accurate.test.ts` |

Upstream schedules one 512-sample impulse (1 at its first sample, 0 after) at the sample offsets 0, 3, 512, 517, 1000,
1005, 20000, 21234 and 37590, inside and across 128-sample render quanta, renders 4 s offline, and asserts
(`checkSampleAccuracy`): the left and right channels match; every non-zero sample is at one of the offsets; the count
of non-zero samples equals the offsets'. That function is re-expressed in `sample-accurate.test.ts` beside its
upstream name, with the offsets copied as upstream writes them; no other upstream code is copied.

## How it runs on our output

- **The impulse** is a sample library's one take: test/clicks (CC0), preset `click`, root MIDI 60, its take
  upstream's impulse as a 48 kHz mono 16-bit WAV, fetched by the hub under your standing rule.
- **The schedule** is a score (`clicks`): event `c<k>` at the k-th offset, written as bar 1, beat 1 + s ÷ 32,000 at 90
  BPM (a beat is 32,000 samples at 48 kHz, so each `at` is a finite decimal that resolves to exactly s × 14,700 flicks),
  at pitch 60 (the root, so nothing resamples the take), `vel` 1, `gain` 0, `pan` 0, `attack` and `release` `"0s"`.
  Upstream renders at 44.1 kHz; the offsets are kept as sample indices, so their place in 128-sample quanta is
  upstream's.
- **The render** is score.render@1 on score-render@1.0.0 through deep_job, as `tests/acceptance/154/README.md`
  describes the surface; the stem is read by that suite's FLAC reader.
- **Asserted:** the plan's note_on for `c<k>` is `{t: s × 14,700, sample: s}`; the render's meta puts `c<k>` on sample
  s; and upstream's check passes on the stem's two channels as 24-bit integers.
- **The planted fault**, built here from our own stem: each impulse moved to the first sample of its 128-sample
  quantum, as a renderer that starts notes per block would place them. Upstream's check must reject it, naming sample
  896, where 1000 and 1005 land.

## Run it

As `tests/acceptance/154/README.md` (it imports that suite's helpers, and needs the same builds):

```sh
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/154-oracle --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/154-oracle/tsconfig.json
```

The implementer adds `tests/acceptance/154-oracle/` to `alone` in `scripts/lanes.mjs` with `tests/acceptance/154/`.

## Readings

- **The clicks carry a bend** (`[[0.03, 0], [0.06, 1]]`), starting 30 ms in, after the 512-sample take has ended, so
  it changes no sample. The design lists a note whose bend starts inside score.pitch's window as unmeasured; without it
  the check would try to measure a tone the click doesn't have.
- **"Non-zero"** is a 24-bit sample other than 0: the stem has no dither (As built).
- Not settled: a `detune` draw on a sampled note would pitch the take off its root, and a band-limited resampler would
  then spread the impulse past its sample. The design names the purpose but not where it applies.
