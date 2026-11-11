# Evidence for #1432: the file-size ratchet and the canvas lint's bans

The issue's Proof is the lane's output on each planted case. The output below comes from the commands the lint lane runs (`node scripts/size-ratchet.mjs` and `node scripts/canvas-lint.mjs`), captured on 2026-11-10 on the reference Mac (Apple M5 Max, 18 cores). Local paths are redacted. The blind suite in `tests/acceptance/1432/` asserts the same cases.

## AC1 and AC2: the ratchet

This is a scratch git repository with `crates/fixture/src/big.rs` at 1,600 lines and a ceiling of 1,600 in `scripts/size-ceilings.json`, committed as `origin/main`.

```
$ node scripts/size-ratchet.mjs   # at its ceiling
PASS size: 1 hand-written source file over 1500 lines, each at its ceiling
exit 0

$ node scripts/size-ratchet.mjs   # AC1: one line planted
FAIL size: crates/fixture/src/big.rs: 1601 lines, over its ceiling of 1600
  Fix: Split or shrink the file to 1600 lines or fewer: a ceiling never rises.
exit 1

$ node scripts/size-ratchet.mjs   # AC2: shrunk to 1,599, ceiling unchanged
FAIL size: crates/fixture/src/big.rs: 1599 lines, under its ceiling of 1600; lower it to 1599
  Fix: Set its ceiling in scripts/size-ceilings.json to 1599.
exit 1

$ node scripts/size-ratchet.mjs   # AC2: ceiling lowered to 1,599
PASS size: 1 hand-written source file over 1500 lines, each at its ceiling
exit 0
```

## AC3: the canvas lint

This is a scratch Cargo workspace with one dependency-free crate, `deep-canvas-plant`. Before this change, the allowed case printed `BLOCKED canvas-lint: … incompatible with previous forbid (E0453)` twice. It exited 2, under the Fix line for a missing Rust toolchain.

```
$ node scripts/canvas-lint.mjs --root <workspace>   # AC3: planted Instant::now at line 2
FAIL canvas-lint: crates/deep-canvas-plant/src/lib.rs:2:16 use of a disallowed method `std::time::Instant::now` (clippy::disallowed_methods)
FAIL canvas-lint: crates/deep-canvas-plant/src/lib.rs:2:16 use of a disallowed type `std::time::Instant` (clippy::disallowed_types)
  Fix: Route the math through the ops module on pinned libm in f64, take time from the input track, draw from the document seed through hash@1, iterate a BTreeMap or a sorted Vec, and keep state out of statics.
exit 1

$ node scripts/canvas-lint.mjs --root <workspace>   # AC3: the same call under an #[allow] with no reason
FAIL canvas-lint: crates/deep-canvas-plant/src/lib.rs:1:37 allow(clippy::disallowed_types) incompatible with previous forbid (E0453)
FAIL canvas-lint: crates/deep-canvas-plant/src/lib.rs:1:9 allow(clippy::disallowed_methods) incompatible with previous forbid (E0453)
  Fix: Remove the attribute: the canvas lint's lints are forbidden, so no allow, expect or warn in the code lifts one.
exit 1
```

## AC4: the time the ratchet adds to the lint lane

`tests/acceptance/1432/budgets.test.mjs` reads the median of three runs on this checkout. It skips as INCONCLUSIVE, never a pass, when that median is over 2 s and the load is at or above the core count:

```
﹣ AC4: the size ratchet adds under 2 s to the lint lane on this checkout # INCONCLUSIVE: over the 2 s budget under load, median 2.72 s of 3 runs (1.54, 2.72, 3.55 s) at load 424.3 on 18 cores; this is not a pass
```

At load 410 to 420, `/usr/bin/time` put a run's CPU time at about 0.65 s (0.22 s user and 0.43 s system), against 3.5 to 3.9 s of wall time. Most of that wall time is waiting for a core. The load never fell below the core count during this session, so the 2 s budget is unproven: INCONCLUSIVE by load.

## The blind suite, and the gap test

- `node --test 'tests/acceptance/1432/*.test.mjs'` gives 6 passed and 1 skipped. The skip is AC4, INCONCLUSIVE by load as above. On the base, 6 of the 7 failed (`tests/acceptance/1432/BASE-FAILURE.txt`).
- `node --test tests/size-ratchet.test.mjs` passes 2 of 2. It covers the scope lines the blind suite leaves out: a file new over 1,500 lines fails, a ceiling never rises above the merge base's, and a generated file is out of scope. Run against a ratchet with its merge-base check removed, both tests fail.
