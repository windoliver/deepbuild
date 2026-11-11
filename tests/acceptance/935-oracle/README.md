# Acceptance tests for #935, Oracle lane: the upstream loudness test run against audio.gen's readings

Written first, blind, from issue #935, its Oracle page (`doneright/oracles/issues/935.md` on branch `doneright` of
`DeepBuildAI/deepbuild`), the upstream file that page pins (its vendored copy, read with `gh api` at that branch), the
#935 suite's surface (`tests/acceptance/935/README.md` and `helpers.ts`, written by the same job) and base commit
`74d867d2` (`74d867d25a5ebae674b6ceede6059f849d51a091`), by a job that never saw an implementation of #935; none
exists, and no other worktree, branch or PR was read. #136's rule applies: a linked test counts only when run against
our output, so every upstream case here is asserted against what `media_gen` answers for a `sound` entry, audio.gen's
own reading, never against `media_bake`, whose loudness bake `tests/acceptance/500-oracle/` already holds to the same
file. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

Scope: criterion 4 (`#935.003bdbdb`), the one criterion the Oracle page links an upstream test to: the meter behind the
variants' ±1 LU and −1 dBTP limits. Its parts the page calls ours (durations within 20% of the median, distinctness by
hash and log-spectral distance) stay with `tests/acceptance/935/variants.test.ts`.

## Source

| Criterion | Upstream, pinned | File | Use | License |
|---|---|---|---|---|
| 4 | the upstream loudness meter at `67b33abe1558160ed76ada1322329b0e9e058b02` ([test/tests.c#L257-L347](https://github.com/jiixyj/libebur128/blob/67b33abe1558160ed76ada1322329b0e9e058b02/test/tests.c#L257-L347); vendored as `doneright/oracles/vendor/libebur128-67b33abe15/test/tests.c`) | `test/tests.c` lines 246 (`gr[]`), 266-284 (`TEST_GLOBAL_LOUDNESS`), 329-346 (`TEST_MAX_TRUE_PEAK`) | port | MIT (its `COPYING`, Jan Kokemüller 2011), the notice kept in `loudness.test.ts` |
| 4 | EBU loudness test set v05 (30 March 2016) | the signal files the macros name, read from the same cache as #500's suite, fetched by hash on first use (`tests/acceptance/500/bake/README.md`: The EBU signals) | test data | the set's readme: for technical testing only; never copied into the repository |

No upstream code is copied: each macro's check is re-expressed against audio.gen's issues, with its files, expected
values and tolerances written in `loudness.test.ts` beside the line each comes from.

## How each upstream case is read

Each signal file is the one take of its own `sound` entry (one level, one take), and one `media_gen` call reads it.
audio.gen's level and peak rules name "the reading and its limit" in their issues (the design's row); the reading is
taken from the issue's `actual`, the value it refused *(chosen: `what` can hold a take's place, whose digits would read
as numbers)*.

| Upstream | Files | Expected (tests.c) | Our case | Passes when |
|---|---|---|---|---|
| `TEST_GLOBAL_LOUDNESS` | seq-3341-1, -2, -3, -4, -5, -7, -8 | `gr[]`: −23, −33, −23, −23, −23, −23, −23; ±0.1 | the take's level target is `gr[i]` + 2 LUFS, so a meter that reads within 1 LU of `gr[i]` + 2 raises no issue | an `audio.gen.level` issue names a reading within `gr[i]` ± 0.1 |
| `TEST_MAX_TRUE_PEAK` | seq-3341-19 to -23 | +3, 0, 0, 0, 0 dBTP; +0.2/−0.4 | the file as it is: every one is over the −1 dBTP ceiling | an `audio.gen.peak` issue names a reading within the expected +0.2/−0.4 |
| `TEST_MAX_TRUE_PEAK` | seq-3341-15 to -18 | −6 dBTP; +0.2/−0.4 | the file decoded and written as 32-bit float with every sample times +5.8 dB, so its true peak, linear in the gain, is expected at −0.2 dBTP, over the ceiling | an `audio.gen.peak` issue names a reading within −0.6 to 0.0 dBTP (−6.4 to −5.8 before the gain) |

A missing issue fails the case too: the meter read the take inside the limit, so outside the upstream tolerance.

Not ported: `seq-3341-6` in 5 and 6 channels (lines 281-282): a `sound` take declares no channel layout, and how
audio.gen weights a 5.0 or 5.1 file is open in the design; `ebur128_loudness_global_multiple` (lines 286-310) and
`TEST_LRA` (lines 312-327): audio.gen reads neither several files' loudness together nor a loudness range; the
`EXACT_PASSED` column, the upstream meter's own outputs, which its file says need not match. The upstream reads true
peak at 4× below 96 kHz; audio.gen reads it at 8×, held to the same tolerance.

## Run

```sh
npm ci                      # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run tests/acceptance/935-oracle --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/935-oracle/tsconfig.json   # type-check
```

The file builds `deep-show` once (`cargo build --locked --bin deep-show`, honoring `CARGO_TARGET_DIR`) through
`tests/acceptance/935/helpers.ts` and fails each test when the build fails; `scripts/lanes.mjs` needs this folder in
its `alone` list (the implementer makes that edit). The EBU set is read from `~/Library/Caches/deepbuild/ebu-loudness/`
(or `DEEP_EBU_LOUDNESS`), fetched there on first use; a test that can't read it fails with a line starting `BLOCKED:`
and its one unblock line, never passes. Each test's issues are written to `$TMPDIR/deep-935-proof/oracle-*.json`.

## The surface under test

Exactly the #935 suite's `media_gen` on a document's `sound` entries (`tests/acceptance/935/README.md`: The surface
under test); nothing new is named here.
