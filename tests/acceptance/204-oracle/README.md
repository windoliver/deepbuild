# Acceptance tests for #204, Oracle lane: the upstream tests the Oracle page pins, run against our output

Written first, blind, from issue #204, its Oracle page, the design rows, and the base commit `4a0910cf4` ("design(#204):
the osc's waves, the shaper's curves and the crush's step, written out as laws") by a job that never saw an
implementation; none exists at the base, and no other worktree, branch, PR or suite for #204 was read. The page
(`doneright/oracles/issues/204.md` on branch `doneright` of `DeepBuildAI/deepbuild`) links one upstream test for
criterion 1 and one for criterion 6, vendored under `doneright/oracles/vendor/` on that branch and read from there.
#136's rule applies: a linked test counts only when run against our output, so each port builds our synth preset and
document, renders it through `deep-show`'s `media_mix` and asserts on our master's samples. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criterion 1's oscillator (the page: "That holds our sine node at a fixed frequency; the sweep from the speed
channel and its block rule are ours") and criterion 6's onsets (the page: "our rule that a spawned voice starts on its
occurrence's sample, which a voice started at the next block's start fails"). Every other criterion, and the rest of
criteria 1 and 6, is ours and stays with `tests/acceptance/204/`.

## Sources

| Criterion | Upstream, pinned | File | Use | License |
|---|---|---|---|---|
| 1 | the upstream tests the Oracle page pins, commit `2f57f45d21482f94b36123dfcec77ae7ab859bc1` | `the-oscillatornode-interface/osc-basic-waveform.html` | port | 3-Clause BSD |
| 6 | the same, commit `2f57f45d21482f94b36123dfcec77ae7ab859bc1` | `the-audiobuffersourcenode-interface/sample-accurate-scheduling.html` | port | 3-Clause BSD |

No upstream code is copied: each test's setup and assertions are re-expressed in its port, which names the upstream
file, its commit and its license notice, and keeps upstream's numbers.

## Run them

```sh
npm ci                                            # once
npm run build --workspaces
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 240 -- scripts/lease cargo build --locked --bin deep-show
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/204-oracle --testTimeout=3600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/204-oracle/tsconfig.json
rm -rf tests/acceptance/204-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #204 suite's helpers (`../204/helpers.ts`), so both lanes build `deep-show`, write fixture
packs, install them and mix the same way. Each file builds `deep-show` once; **`scripts/lanes.mjs` needs
`'tests/acceptance/204-oracle/'` in its `alone` list**; the implementer makes that edit. `BASE-FAILURE.txt` is the run
at the base: every test fails because the base has no synth (a manifest with `presets` is refused at its pack check).

## The surface under test

Exactly the #204 suite's (its README: The surface under test): a fixture pack with `presets` installed by
`install_pack`, a media document at 44.1 kHz pinning it, a synth strip (`src: {synth: {preset, params}}`) or a Spawn
whose template plays a synth, and `media_mix`'s written master. Nothing new is named here.

## Upstream's tests as ours

**Criterion 1, `osc-basic-waveform.html`.** Upstream renders, at 44.1 kHz, 256 frames (two render quanta) of a sine
oscillator started at 0, at 100, −100, 2 and 1 Hz, and holds each to b1 · sin(2π f k ÷ rate): absolute threshold 2e-5
at ±100 Hz and 2e-7 at 2 and 1 Hz, SNR at least 110 dB (118 dB at 2 Hz).

- **The oscillator** is our `osc` node, `wave: sine`, in `tones.tone@1` (the sine at the param `hz`, times 0.5), one
  strip from 0 with `hz` given as each frequency, in its own 44.1 kHz document; the master's first 256 samples are
  written.
- **The scale**: the master carries the sine at 0.5 times the mix's pan law for the voice (1, or √½ for a mono voice on
  the stereo master). Each channel's least-squares gain must be one of those within 1e-4, which holds the oscillator's
  own amplitude at 1; the samples divided by it are held to upstream's thresholds and SNR.
- **−100 Hz** is upstream's case: our phase advances by the mean of a sample's frequency and the next one's, as a u64
  fraction of a cycle, so a negative frequency runs it backwards, sin(2π(−100)k ÷ rate).
- **Not ported**: upstream's tests 4 and 5 (a custom PeriodicWave): no node in our closed list makes one.

**Criterion 6, `sample-accurate-scheduling.html`.** Upstream renders 4 s at 44.1 kHz and schedules a 512-sample impulse
(1 at its first sample) on both channels at each of the sample offsets 0, 3, 512, 517, 1000, 1005, 20000, 21234 and
37590, inside and across its 128-sample render quanta, then checks that left and right match, that every non-zero
sample sits at one of the offsets, that it finds nine, and that none is misplaced.

- **The impulse** is a spawned voice's first sample: a Spawn on a baked list of nine hits whose template plays
  `clicks.click@1` (a 1 kHz square from phase 0, so its first sample is its full level, times 0.25) for 50 ms.
- **Placement**: the nine voices would overlap at upstream's offsets, so hit k sits at k × 49,152 + offset k, in a
  window of its own; 49,152 is 3 × 2^14, so each hit keeps upstream's place inside any block of up to 16,384 samples.
  A row's `t` is the sample × 16,000 flicks.
- **The checks**: left and right equal sample for sample; in each window the first non-zero sample is the hit's own;
  nine found; none misplaced.
- **A wrong program**: the #204 suite's planted `spawn_synth_starts_next_block` (each voice at the first block boundary
  at or after its occurrence) must fail this port, naming hit 1 at offset 3, the first misplaced (hit 0, at offset 0,
  is on a block's first sample).

## Legs that read BLOCKED or INCONCLUSIVE

None.

## Not tested

Upstream's own offline context, its 4 s length and its impulse buffer: they are the browser's, not ours. Criterion 1's
oscillator port has no planted program of its own: a fixed-frequency sine has no param to hold per frame; the base, with
no synth, is its wrong program, and the #204 suite's criterion 1 test carries the plant.
