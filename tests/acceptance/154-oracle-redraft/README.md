# Acceptance tests for #154, Oracle lane: the upstream test the Oracle page pins, run against our output (blind redraft)

Written first, blind, from issue #154, its Oracle page, the design rows, and the base commit `b726c8be8` by a job that
never saw an implementation; none exists at the base, and no other worktree, branch, PR or suite for #154 was read. The
page (`doneright/oracles/issues/154.md` on branch `doneright` of `DeepBuildAI/deepbuild`) links one upstream test, for
criterion 2, vendored at `doneright/oracles/vendor/wpt-2f57f45d21/...` on that branch and read from there. #136's rule
applies: a linked test counts only when run against our output, so the port builds our `score.music@1` document,
renders it through our job and asserts on our stem. The implementing agent doesn't edit these files (AGENTS.md, Proof);
a dispute goes to a blind redraft of this job (design: Dogfooding).

Scope: criterion 2's first clause ("Each event's note_on lands on its resolved flick"), the only one the page links.
Every other criterion, and criterion 2's score.pitch clause, is ours and stays with `tests/acceptance/154-redraft/`.

## Sources

| Criterion | Upstream, pinned | File | Use | License |
|---|---|---|---|---|
| 2 | web-platform-tests `2f57f45d21482f94b36123dfcec77ae7ab859bc1` | `webaudio/the-audio-api/the-audiobuffersourcenode-interface/sample-accurate-scheduling.html` | port | 3-Clause BSD |

No upstream code is copied: its setup and assertions are re-expressed in `sample-accurate.test.ts`, which names the
upstream file, commit and license, and keeps upstream's numbers.

## Run them

```sh
npm ci                                            # once
npm run build --workspaces
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 240 -- scripts/lease cargo build --locked -p deep-hook
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 240 -- scripts/lease cargo build --locked --bin deep-show
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/154-oracle-redraft --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/154-oracle-redraft/tsconfig.json
rm -rf tests/acceptance/154-oracle-redraft/node_modules/.vite          # the cache vitest leaves under --root
```

`helpers.ts` re-exports the #154 redraft suite's helpers (`../154-redraft/helpers.ts`), so both lanes start a hub,
install `deepbuild/score` and a sample library, plan with `deep-show run` and render with deep_job the same way. The
test starts its own hub, so **`scripts/lanes.mjs` needs `'tests/acceptance/154-oracle-redraft/'` in its `alone`
list**; the implementer makes that edit. `BASE-FAILURE.txt` is the run at the base.

## The surface under test

Exactly the redraft suite's (its README: The surface under test): `deep install` of `packages/jobs/score` and of a
sample library, the library fetched under `pack.rule`, `deep show` and `score_plan` in `deep-show run`, deep_job's
`score.render` on `score-render@1.0.0`, and the `stem` and `meta` outputs read from the evidence store. Nothing new is
named here.

## Upstream's test as ours

Upstream renders offline at 44.1 kHz for 4 s and schedules a 512-sample impulse (1 at its first sample, 0 after) on
both channels at each of the sample offsets 0, 3, 512, 517, 1000, 1005, 20000, 21234 and 37590, inside and across its
128-sample render quanta. It then checks that the left and right channels match, that every non-zero sample sits at one
of those offsets, that it finds nine, and that none is misplaced.

- **The rate**: ours is the stem's 48 kHz; the offsets are upstream's, in samples.
- **The impulse** is a note's first sample: one sampled instrument whose one take is a 440 Hz tone in cosine phase
  (its first sample its loudest), at its root (MIDI 69, no resampling), `attack: 0`, `vel: 1`, `pan: 0`. A tone, not an
  impulse, because score.pitch measures every rendered note and an impulse has no pitch. So "non-zero only at the
  offsets" reads as "silence before each note in its window, and sound from exactly its sample".
- **Placement**: the nine notes would overlap at upstream's offsets, so note k sits at k × 49,152 + offset k, in a window
  of its own. 49,152 is 3 × 2^14, so each note keeps upstream's place inside any block of up to 16,384 samples; each
  note sounds 0.26 s and ends long before the next window. `at` is the onset in integer flicks (sample × 14,700).
- **The checks**: the plan's `note_on` and the job's `meta` put note k at exactly its sample; the stem's left and right
  channels are equal, integer for integer; in each window the first sample that isn't zero is note k's; nine are found
  and none is misplaced.

## Legs that read BLOCKED or INCONCLUSIVE

None.

## Not tested

Upstream's own `OfflineAudioContext`, its 44.1 kHz rate and its 4 s length: they are the browser's, not ours.
