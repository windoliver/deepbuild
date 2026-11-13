# Acceptance tests for #522, Oracle lane: upstream checkpoint and rewind tests, pinned by commit, run against our output

Written first, blind, from issue #522 (`gh issue view 522 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/522.md` on branch `doneright` of DeepBuildAI/deepbuild), the two upstream files that page
pins (read from its vendor copies under `doneright/oracles/vendor/`), the #522 suite's surface
(`tests/acceptance/522/README.md`, written by the same job), the #2010 Oracle lane's scenes and base commit
`53c0e72a3`, by a job that never saw an implementation of #522; none existed, and no other worktree, branch, pull request
or plan was read. #136's rule applies: a linked test counts only when run against our output, so every case here builds
our `physics.world@1` document and asserts on what `deep-physics` answers, never on an engine called directly. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

Scope: criteria 1, 5 and 8, the three the page links upstream tests to. The other six have none (the page's "No
upstream test" table) and stay with `tests/acceptance/522/`, as do the parts the page calls ours: the 20-box stack and
its 600 steps, the ball-and-goal lab, its eight grabs and the probe times, and dropping a replaced step's occurrences.

## Sources

| Criteria | Upstream, pinned | File (cases) | Use | License |
|---|---|---|---|---|
| 1, 8 | the upstream engine, commit `3406750a38286a0d3c7d0f4be2f9d53153e81d90` | its 3D crate's `tests/snapshot_roundtrip.rs` (awake_pile, sleeping_pile) | port | Apache-2.0 |
| 5 | the second upstream engine, commit `396c9f059903aed5fec78ecd3d437a40c6415368` | its rewind suite, `…TestRewind.cpp` in its headless test program (RewindTest_Resim, DeterministicSim_DifferentCreationOrder) | the rules only, not ported | the engine's own EULA |

No upstream code is copied: each case's scene and assertion are re-expressed in the receiving file, which names its
upstream file, commit and license, and keeps upstream's numbers where our document can hold them. The second engine's
source is under its EULA ("All Rights Reserved"), which doesn't allow its code to be redistributed outside licensees,
so `rewind-resim.test.ts` asserts the cases' rules on scenes of our own written from their published parameters, with
no text of the file.

Left out of snapshot_roundtrip: ccd_bodies and joints_and_sensor (the #2010 Oracle lane ports them against `restore`;
the two piles carry the rule #522's criteria 1 and 8 name), and, as the #2010 Oracle lane leaves them out,
multibody_articulation (our document has no multibody joint), restoring_into_a_live_pipeline and
replacing_the_pipeline_changes_nothing (no world field reaches the engine's pipeline), structural_changes (a body is
never created or removed mid-run: Body `body@1`) and the ignored pyramid. Of the rewind suite, only the two cases the
page names.

## Run

```sh
npm ci                      # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/522-oracle --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/522-oracle/tsconfig.json
rm -rf tests/acceptance/522-oracle/node_modules/.vite
```

`helpers.ts` re-exports the #522 suite's helpers (`../522/helpers.ts`, which re-exports #1918's, #2010's and #2009's)
and the #2010 Oracle lane's `pile`, `upstreamScene` and `CAPACITY`, so both lanes build and ask the same binary the same
way: each file builds `cargo build --locked --bin deep-physics` once and copies it out; every test passes a 60-minute
timeout. Live views are `deep-physics` processes driven line by line and stopped by their own PID. **`scripts/lanes.mjs`
needs `'tests/acceptance/522-oracle/'` in its `alone` list**; the implementer makes that edit (the #522 README says so
too). No cargo is `BLOCKED:`, never a pass; nothing here is timed. `BASE-FAILURE.txt` is the run at the base.

## The surface under test

The #522 suite's (its README: The surface under test): `bake` with `track` and its ring, `seek`, `view`, `frame` with
`seek` and `late`, `record`, and the planted twins `checkpoint_poses_only` and `restore_without_warm_start`; #2010's
`restore` with `checkpoints: true`. Nothing new is named here.

## Upstream's cases as ours

- **snapshot_roundtrip** saves the world at step 100, restores it into a fresh world, runs both in lockstep 100 steps and
  compares their serialized bytes after each, naming the step and the differing structures. Ours: the #2010 Oracle
  lane's `pile(sleepy)` (8 × 3 × 8 unit boxes on a 1.05 m pitch; when sleepy, four rollers that never sleep) at
  upstream's defaults, baked 200 steps with a checkpoint every 20 and a ring of 1 GiB, so it never thins. The lockstep
  is `seek` to step 100 played 100 steps (its step hashes against the bake's at every step: the bake is the run the
  snapshot resumes) and `restore` of the bake's step-100 checkpoint with `checkpoints: true` (each later checkpoint's
  state bytes against the bake's, every 20 steps: the bytes upstream compares). "Naming the culprit structure" is the
  first body and field whose state differs at the first step that differs. Criterion 1's twin is the poses-only
  checkpoint, on the sleeping pile; criterion 8's is the restore without warm-start impulses, on the awake pile, where
  every contact is solved each step, so it must differ at the restore's next step, 101.
- **RewindTest_Resim** rewinds 12 steps to step 7 and resimulates with corrections there, staying in sync. Ours: a
  0.5 m ball of 1 kg falling from 10 m at 60 Hz, a checkpoint every 5 steps; a live view runs to step 12, then a poke
  of +3 m/s along z stamped at step 7 arrives late; the world restores step 5, steps to 12 again, and its record's step
  hashes 0 … 12 equal a straight bake with the poke on time.
- **DeterministicSim_DifferentCreationOrder**: fifty boxes created in reverse order end 20 steps of 1/30 s later with
  zero position and rotation error. Ours: the #2010 Oracle lane's tower (fifty 1 m boxes of 1 kg stacked 1 m apart,
  each 5 cm further along z, on a static box whose top is y 0, 30 Hz, g 9.8 m/s²), written forward and in reverse, a
  checkpoint every 5 steps; each runs to step 20 in a live view and takes a late poke of `box00` (+1 m/s along z)
  stamped at step 10; both records' step hashes 0 … 20 equal a straight bake of the forward document with the poke on
  its track, which holds each body's position and rotation to the bit.

## Tests

| Criterion | File (tests) | What it asserts |
|---|---|---|
| 1 `#522.e8dd3a56` | `snapshot-roundtrip.test.ts` (3) | awake_pile and sleeping_pile: the seek restores step 100 and every step hash 100 … 200 is the bake's; the restore's checkpoints 120 … 200 are byte-identical to the bake's. Under `checkpoint_poses_only` (sleeping pile) the comparison fails, naming the step, body and field |
| 8 `#522.dfeb8487` | `snapshot-roundtrip.test.ts` (1) | Under `restore_without_warm_start` (awake pile) the seek first differs at step 101, a failure naming that step and the field, and the restored run's checkpoint at step 120 isn't byte-identical |
| 5 `#522.cc560b9c` | `rewind-resim.test.ts` (2) | The late poke at step 7 restores step 5 and resimulates in sync with the on-time run; the tower written in reverse, with a late poke at step 10, ends in sync with the forward run and the on-time run |

Test count: 3 + 1 + 2 = 6.
