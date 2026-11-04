# #418.186ac2bb kit redraft: the shipped look module's `look@1`

Swapped in with the owner's approval on Nov 3, 2026 for the first test of `../kit.test.ts`, which is deleted there (`DISPUTE.md`). The planted side stays in `../kit.test.ts`.

This is a blind redraft of the shipped side of the last Scope item of #418. The item says: "The look module's interface `look@1` (#185), apart from the look asset of that name: its manifest names the implementation, and its conformance kit is every part of the canvas kit (#138) on this module's fixtures, with no behavior part, so it seals only bit, canonical implementations".

The test is in `kit-shipped-redraft.test.ts`. It is one test, `#418.186ac2bb …`, and it imports its generic tools from `../../185/redraft/helpers.ts`, which is already at the base: a cargo build per feature set, `deep-show run`, and the strict reply readers. The planted implementation's side of the item is not covered here.

## What I read

- Issues: #418 (scope, fields, criteria, proof), #185 (scope, fields, criteria) and #138 (scope, criteria).
- `docs/canvas-primitives.md`: Canvas module; Canvas module: interface and implementation; Registry and seal; Look `look@1` and its tone mapping row.
- `docs/technical-design.md`: Canvas modules (the canvas core paragraph), the conformance-kit bullet under How we know version 0 works, and Dogfooding.
- The base (8173fbd2):
  - `crates/deep-canvas/src/registry/mod.rs` (`Interface`, `SealedInterface::to_json`, the `schedule` reply).
  - `crates/deep-show/src/main.rs` (`interfaces()`).
  - `crates/deep-show/src/kit/{mod,interface,fixtures,manifest}.rs` (the `kit` and `manifest` calls and their reply shapes).
  - `crates/deep-canvas-marks/src/modules.rs` (the look module's manifest and its one fixture).
  - `tests/acceptance/185/` (README, `redraft/`) and `tests/acceptance/138/shipped.test.ts`.
- `tests/acceptance/418/` is not in this worktree, so I did not read or import the original suite. I did not read any DISPUTE note.

## The reading

**The interface, apart from the look asset.** The interface is read from the published plan, `{"call":"schedule"}` → `interfaces["look@1"]`. Per the design, an interface's name lives in its own namespace, apart from kinds and assets, so nothing in the test treats it as the look asset. The test checks that:

- `module` is `look`;
- the implementation has a name and a semver version, which is what "its manifest names the implementation" means;
- the shipped module is the reference (`reference` equals `implementation.name`). This follows #185: "Every shipped canvas module becomes its interface's reference implementation";
- it is `bit` and `canonical`. #185: "every other shipped module bit and canonical";
- `behavior` is `"none"`, and `kit` contains no `behavior` part.

**"Every part of the canvas kit (#138)".** The interface's `kit` list must hold all 13 parts of #138's kit, under the names its `kit` call reports: fixtures, clean_rebuild, patch_fuzz, read_set, order, schedule, repair_loop, carried_state, late_entry, time_order, contribution, catalog and migration. These are the parts #138's Scope lists. #185 says the same: "each interface owns its kit, every part of the conformance kit (#138) for any implementation, plus its behavior part for a measured one". The look interface has no measured implementation, so it has no behavior part. An interface may also add `bit`, which compares a non-reference bit implementation with the reference. The test allows `bit` but does not require it.

**"On this module's fixtures".** The kit is the look module's own run: `{"call":"kit","sequences":100,"param_sets":50,"modules":["look"]}`. Its fixtures are the `manifest` call's entries whose `module` is `look`. #138 says fixtures are documents with sidecars, listed in a manifest. The test requires each of the following:

- The kit tests the module at the interface's digest.
- Every part the kit runs on look is one that the interface's kit lists, and no `behavior` part runs.
- Each part runs every case it declares, and at least one.
- No case is FAIL or INVALID. A case BLOCKED on noop but proved on Vello CPU is allowed, as #138 allows.
- Each part, and the module, is PASS with no failures.
- The `fixtures` part runs each of the look module's own fixtures (scenes aside).

I read "this module's fixtures" as the fixtures #418 gives the look module. The issue's Proof names them: "Each tone curve against its analytic fixture, the finish at identity defaults, and the AO, deband, grade and bloom fixtures". The same Scope item also needs a fixture that runs the finish pass at identity defaults: its planted bit implementation, "whose finish pass at identity defaults changes one pixel", must fail the kit naming the fixture. A kit over fixtures that never reach the finish could not do that.

So the test also requires that, between them, the look module's fixture documents and sidecars set each `look@1` field the issue's Fields add: `tone_map`, `ao`, `deband`, `grade` and `bloom`. It also requires that some `tone_map` value names each of `filmic`, `agx` and `neutral`. `none` is the default and need not be written out. This is a check for key and value presence anywhere in a fixture, so it does not depend on where a fixture puts its look or what its fixtures are called.

## Wrong programs it fails

- A plan with no `look@1`, or with `look@1` implemented by another module.
- A shipped look declared `measured` or `backend_bytes`, or not its own interface's reference.
- An interface with a behavior part, or a kit list missing any #138 part.
- A kit that skips the look module or tests it at another digest.
- A kit that runs fewer cases than it declares, fails or invalidates a case, or leaves one of the module's fixtures unrun.
- A look module whose fixtures never reach the finish fields, which is what the base has: its one fixture, `roles`, is four role boxes.

## Run

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/418/redraft --no-file-parallelism
npx tsc -p tests/acceptance/418/redraft/tsconfig.json
```

The test builds `deep-show --no-default-features --features full` (debug) itself and copies the binary to a temporary folder. Evidence goes to a temporary folder that is removed afterwards.

## Base result

`KIT-REDRAFT-BASE.txt` holds the one base run. The test fails at step 2. The look module's only fixture, `parity/look/roles.board`, sets none of `tone_map`, `ao`, `deband`, `grade` or `bloom`.

Step 1 holds at the base. The base already declares `look@1` with the shipped look as its bit, canonical reference, with the 13 parts plus `bit` and no behavior part.

As a separate diagnostic, outside the test, I ran the same `kit` call on the base binary to check that step 3 is not stricter than a correct kit. Look passed with no failures. The kit ran 9 parts: fixtures (3/3, PASS on Vello CPU and BLOCKED on noop), clean_rebuild, patch_fuzz, read_set, order, schedule, repair_loop, time_order and catalog. carried_state, late_entry, contribution and migration have nothing to test on look, so they do not run. So the base fails this test only because the look module's fixtures do not cover the finish.
