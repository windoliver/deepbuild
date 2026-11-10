# Acceptance tests for #500, Oracle lane: libebur128's EBU loudness tests run against our loudness bake

Written first, blind, from issue #500 (`gh issue view 500 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/500.md` on branch `doneright` of `DeepBuildAI/deepbuild`), the upstream file that page pins
(read from GitHub at the pinned commit), the #500 suite's surface (`tests/acceptance/500/bake/README.md` and
`helpers.ts`, written by the same job) and base commit `96b462a6` (the same tree as `0c4a4ec7`), by a job that never
saw an implementation of #500; none existed, and no other worktree, branch or PR was read. #136's rule applies: a
linked test counts only when run against our output, so every upstream case here is asserted against what `deep-show
run`'s `media_bake` answers. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

Scope: criterion 3, the one criterion the Oracle page links an upstream test to. Criteria 1, 2 and 4 to 8 have no
upstream test (the page's "No upstream test" table) and stay with `tests/acceptance/500/`, as do criterion 3's parts
the page calls ours (8× oversampling, the planted sample-peak meter, the fetch by hash and "never committed").

## Sources

| Criterion | Upstream, pinned | Files | Use | License |
|---|---|---|---|---|
| 3 | libebur128 `67b33abe1558160ed76ada1322329b0e9e058b02` | `test/tests.c` lines 246-406 (its `main`: `gr[]`, `lra[]`, the macros `TEST_GLOBAL_LOUDNESS`, `TEST_LRA`, `TEST_MAX_TRUE_PEAK`, `TEST_MAX_MOMENTARY`, `TEST_MAX_SHORTTERM` and the files each names), with lines 143-244 for how the momentary and short-term maxima are read (every 10 ms from 400 ms; every 100 ms from 3 s) and lines 95-141 for the true peak (the largest over channels) | port | MIT (`COPYING`, Jan Kokemüller 2011), its notice kept in `ebur128.test.ts` |
| 3 | EBU loudness test set v05 (30 March 2016) | the signal files the macros name, fetched by hash on first use (`tests/acceptance/500/bake/README.md`: The EBU signals) | test data | the set's readme: provided as is, "may only be used for technical testing purposes"; never copied into the repository |

No upstream code is copied: each macro's reading is re-expressed against the bake's readings, and its files, expected
values and tolerances are written in `ebur128.test.ts` with the line each comes from. No upstream file is GPL or LGPL.

| Upstream | Cases | Expected (tests.c) | Our reading |
|---|---|---|---|
| `TEST_GLOBAL_LOUDNESS` (lines 266-284) | 9 files: 3341-1 to -5, -6 in 5 and 6 channels, -7, -8 | `gr[]`: −23, −33, then −23; ±0.1 | `integrated` |
| `TEST_LRA` (lines 312-327) | 6 files: 3342-1 to -4, 3341-7 (3342-5), 3341-8 (3342-6) | `lra[]`: 10, 5, 20, 15, 5, 15; ±1 | `range` |
| `TEST_MAX_TRUE_PEAK` (lines 329-346) | 9 files: 3341-15 to -23 | −6, −6, −6, −6, 3, 0, 0, 0, 0; +0.2/−0.4 | `true_peak` at `tp_oversample` 4 (libebur128's factor at 48 kHz) |
| `TEST_MAX_MOMENTARY` (lines 348-376) | 20 files: 3341-13-1 to -20 | −23; ±0.1 | the largest `momentary` entry ending at or after 400 ms |
| `TEST_MAX_SHORTTERM` (lines 378-406) | 20 files: 3341-10-1 to -20 | −23; ±0.1 | the largest `short_term` entry ending at a whole 100 ms at or after 3 s, or at the file's end |

Not ported: `ebur128_loudness_global_multiple` (lines 286-310), which reads several files' states together (our bake
reads one asset, and no criterion reads several); the `EXACT_PASSED` column (`gre[]`, `lrae[]`), libebur128's own
outputs, which its file says need not match. The 6-channel file gets libebur128's default map for six channels (L, R,
C, unused, Ls, Rs), its fourth as `"lfe"`; the 5-channel file gets tests.c's map.

## Run

```sh
npm ci                      # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/500-oracle --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/500-oracle/tsconfig.json   # type-check (exits 0)
```

The file builds `deep-show` once (`cargo build --locked --bin deep-show`, honoring `CARGO_TARGET_DIR`) through
`tests/acceptance/500/bake/helpers.ts` and fails each test when the build fails. **`scripts/lanes.mjs` needs
`'tests/acceptance/500-oracle/'` in its `alone` list** (this job writes only its folders; the implementer makes that
edit). Every `it` passes a 3,600,000 ms timeout. The EBU set is read from the same cache as the #500 suite's
(`~/Library/Caches/deepbuild/ebu-loudness/`, or `DEEP_EBU_LOUDNESS`), fetched there on first use; a test that can't
read it fails with a line starting `BLOCKED:`, never passes. Node built-ins and vitest only. Delete
`tests/acceptance/500-oracle/node_modules/.vite` after a `--root` run.

## The surface under test

Exactly the #500 suite's `media_bake` call with `kind: loudness` (`tests/acceptance/500/bake/README.md`: The surface
under test); nothing new is named here.

`BASE-FAILURE.txt` states the expected failure at the base: the call doesn't exist there.
