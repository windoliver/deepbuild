# #1123: the checks on the final head

Head `b0fddcd0b`, with main merged in at `23baa43b4`. One Mac, 2026-11-13, at a 1-minute load between 17 and 280 on 18 cores.

## The proof lanes

`node scripts/proof.mjs guard before trace`, 731 s: [proof-b0fddcd0b.txt](proof-b0fddcd0b.txt).

- **before:** 5 of 5 PASS. Four tagged tests failed on the merge base at their assertions, and the per-side `childEnv` test failed on the planted `child-env-delete-after-merge`.
- **trace:** `PASS trace: Closes #1123: each of its 2 criteria has a tagged test that ran, passed and failed on a wrong program`.
- **guard:** FAIL, 12 lines over six commits, until each carries a signed tag ([../closure-attempt/human-approval-items.txt](../closure-attempt/human-approval-items.txt)).

[proof.txt](proof.txt) is the same run on `2968750f2`, before the last merge of main: the same before results, and trace reading "Part of", the word the commits then used.

## affected.mjs

`DEEP_SHARDS=4 node scripts/affected.mjs`, without `--timed` or `--slow`, 5,799 s: [affected-b0fddcd0b.txt](affected-b0fddcd0b.txt).

```
FAIL affected: 253 new, 3 already failing on main, 69 inconclusive or blocked, 0 listed skips, 730 passed, in 5799 s at load 17
```

It printed no WIDE line. "New" means absent from `scripts/known-failures.json`. No run of main was taken to compare with, so apart from what is named below, the new failures are not attributed to this change or to main.

- **161 of the 253 are lint findings:** size 49, deps 46, code mappings 23, vendor 18, slots and slot kits 14, `known-failures.json` 8, secrets 1, drift 1, record reader 1. None names a file this change touches.
- **92 are failing tests, in 42 suites.** Two are this change's own, below.
- **Main does not compile `deep-contracts`.** `crates/deep-contracts/src/generated.rs` defines `RULE_340` and `RULE_341` twice, the file is main's byte for byte, and `cargo check --locked -p deep-contracts` exits 101 here. 32 of the BLOCKED and new lines name a failed or missing build of `deep-hook` or `deep-replica`, which depend on it.
- **INCONCLUSIVE:** 30 timed files and 9 slow files were not run; the canvas-lint, plant-lint and fetch-lock jobs got no grant; the rest are single tests, each with its reason on its line.

### This change's own tests in that run

Passed: `tests/acceptance/1123/binaries.test.mjs` 3 of 3, `environment.test.mjs` 3 of 3, #374's files 11 of 11 and #375's 12 of 12 in the parallel block, and 35 tests of `tests/proof-binaries*.test.mjs`.

Did not pass:

- **`tests/acceptance/1123/capture-redraft/origin.test.mjs`, 3 BLOCKED.** Its fixture runs `cargo build --offline --locked -p deep-hook`, which fails on main's `deep-contracts` above.
- **`tests/proof-binaries-bay-live.test.mjs`, 1 FAIL, and the dead-supervisor case of `tests/proof-binaries-bay-barrier.test.mjs`, 1 BLOCKED:** `the bay pair cannot be used: bay process scan failed`. `processTable` in `scripts/bays.mjs` gives its `ps -A` at most one second, and the load was above 200. It fails closed: the bay reads BLOCKED and is never reused unverified. The other six barrier cases passed.
- **`tests/proof-binaries-timeout.test.mjs`, 1 FAIL:** `real work starts before timeout`. Its three-second case did not have its worker ready in time under load, as on 2026-11-12.
