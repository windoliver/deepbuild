# #185.da9aab76 kit redraft: "with a behavior part of three fixtures with analytic answers and tolerances, B passes and seals"

Blind redraft of one condition of the criterion, in `kit-behavior-redraft.test.ts` with its own `helpers.ts`.

## What I read

- Issue #185 (scope, fields, the five criteria).
- docs/canvas-primitives.md: Canvas module; Canvas module: interface and implementation; Registry and seal; Registry and seal: runtime digest; Seam and backend.
- docs/technical-design.md: The canvas core; Composition.
- The base (c9225aa3): `crates/deep-show/build.rs`, `kit-ledger.json`, `src/kit/ledger.rs` (release seal: refuses every sealed module whose ledger record isn't PASS at its digest; debug admits all), `src/kit/mod.rs` (the `kit` call, its options and the ledger it writes), the `schedule` reply in `deep-canvas/src/registry/mod.rs`, and tests/acceptance/138 (helpers, release, shipped) and 305 (helpers).

## Surfaces and names

- Build: `{ set: 'full', with: ['test-sim-b', 'test-sim-behavior'] }`. That is B alone, with test.sim@1's behavior part, in the shipped build set. `full` is the release build the app ships, and the build set #138's release test uses for the same ledger path (`full` plus a test module, default kit, ledger, release build, start). On the base, the default kit over `full` passes every shipped module (138/shipped.test.ts, not in `scripts/known-failures.json`), and the committed `kit-ledger.json` records PASS for each of them.
- Ledger: the one the default `{"call":"kit","ledger":…}` writes over every module of the debug build of that same feature set. It is embedded through `DEEP_KIT_LEDGER` in a release build of the same features. The test does not use the committed ledger: its digests are for builds without test.sim, and the seal must judge the record the kit wrote for B. The test asserts that every module in the ledger is PASS, so that the release seal judges only B.
- Plan: `{"call":"schedule"}` → `interfaces["test.sim@1"]`, checked in both builds: `module` is `test.sim`, `reference` is `test.sim.a`, `implementation.name` is `test.sim.b`, `equivalence` is `measured`, `state` is `backend_bytes`, and `behavior` is a part name other than `"none"`.
- Kit: the module `test.sim` is tested at the interface's digest, and the part named by `behavior` declares and runs exactly 3 cases with 3 distinct `fixture`s. Each case has at least one `answers[]` entry `{answer, expected, got, tolerance}` with tolerance > 0. The test recomputes `|got − expected| ≤ tolerance × |expected|` (relative tolerance) rather than trusting the verdict. Each case, the part and the module are PASS, and the ledger records test.sim PASS at that digest with the behavior part PASS.
- Seal: the release build starts (`run` exits 0), `registry.modules` holds `test.sim`, and its plan names `test.sim.b` under test.sim@1 at the digest the kit tested.

## Wrong program

The test fails on a program that does any of the following:
- leaves the behavior part out, or runs fewer or more than three fixtures, or a fixture with no analytic answer or a zero tolerance;
- reports a case PASS while an answer lands outside its tolerance;
- judges a measured B by the bit rule (A's hashes), so B fails the kit;
- has a release seal that refuses B even though the ledger shows it PASS at its digest (for example, one that still treats test.sim@1 as having no behavior part);
- seals A, or some implementation other than B, under test.sim@1.

On the base it fails at the first step: there is no `test-sim-b` or `test-sim-behavior` feature (see KIT-REDRAFT-BASE.txt).

## Not verified

I could not run the kit on the base's own modules in this build set. The volume had 207 MB free, and my `cargo build --features core` failed with ENOSPC. I removed my partial `target/` and did not retry. The claim that the base's `full` modules pass the default kit rests on the base's 138 suite (shipped and release tests, no known failures) and on the committed ledger. I did not reproduce it.
