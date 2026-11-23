# Acceptance tests for #1500, Oracle lane: the upstream snapshot round trip, pinned by commit, run against our output

Written first, blind, from issue #1500, its Oracle page (`doneright/oracles/issues/1500.md` on branch `doneright` of
DeepBuildAI/deepbuild), the one upstream file it pins (read from its vendor copy under `doneright/oracles/vendor/`), the
#1500 suite’s surface (`tests/acceptance/1500/README.md`, written by the same job) and base commit `5f5791e2d`, by a job
that never saw an implementation of #1500; none existed. #136’s rule applies: a linked test counts only when run against
our output, so the case builds our documents and asserts on what `deep-show` answers, never on an engine called
directly. The implementing agent doesn’t edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

Scope: criterion 1 (`#1500.969af07a`), the one the page links an upstream test to, and only the half the page names:
"the physics half of our state hash at step 301 equalling an unpatched run’s after the run’s state is held and opened
again". The material showing at 301, the logic half and the planted restart stay with `tests/acceptance/1500/`.

## Source

| Criterion | Upstream, pinned | File (lines) | Use | License |
|---|---|---|---|---|
| 1 | the upstream physics engine, commit `3406750a38286a0d3c7d0f4be2f9d53153e81d90` | its 3D crate’s `tests/snapshot_roundtrip.rs` (137-169: `check_roundtrip`; 383-389: `restoring_into_a_live_pipeline`) | port | Apache-2.0 |

No upstream code is copied: the rule and the scene are re-expressed in the receiving file, which names its upstream
file, commit and license, and keeps upstream’s numbers: its pile (the #2010 Oracle lane’s `pile` and `upstreamScene`,
upstream’s defaults as our world fields), 100 steps before the snapshot, then 100 steps after for the sleeping pile and
60 for the awake one, as `restoring_into_a_live_pipeline` runs them. Left out: the cases the live-pipeline test doesn’t
call, and the pipeline itself (our join keeps the play going, which is the live pipeline’s point; no world field reaches
the engine’s pipeline).

## Run

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  node scripts/throttle.mjs build --wait 240 -- sh scripts/lease \
  npx vitest run --root tests/acceptance/1500-oracle --testTimeout=600000 --hookTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/1500-oracle/tsconfig.json
rm -rf tests/acceptance/1500-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #1500 suite’s helpers (`../1500/helpers.ts`) and the #2010 Oracle lane’s `pile` and
`upstreamScene`: the file builds `deep-show` once (the default set) and copies it out; every test passes a 60-minute
timeout. **`scripts/lanes.mjs` needs `"tests/acceptance/1500-oracle/"` in its `alone` list** (the #1500 README’s lines
hold it). Nothing here is timed. `BASE-FAILURE.txt` is the run at the base.

## The surface under test

The #1500 suite’s (its README: The surface under test): `play_frames` with `revise` and `rows`, its rows’ `deep_hash`,
`from` and `worlds`, its joins, and the planted twin `join_poses_only` (a join that opens each world built afresh with
each body’s pose and velocities as held). Nothing new is named here.

## Upstream’s case as ours

| Upstream | Ours | Judge |
|---|---|---|
| `check_roundtrip` with `keep_pipeline`: step 100, save, restore with the live pipeline, step both in lockstep, assert the same bytes each step, naming the step and the differing structure | the jumper with the pile as its world played twice on no input, 100 + after + 1 frames; in one, a revision changing only the material arrives in frame 100, so the state after step 100 is held and opened again while the play goes on | at each of the next 100 (sleeping) or 60 (awake) steps, every carried state’s full-state hash equals the never-held run’s; the first failure names the step, the differing carried states and the first body that moved differently, or "none" when only stored state moved |
| (none: our wrong program) | `--planted join_poses_only` on the awake pile | fails, naming step 101 and the world `lab` |
