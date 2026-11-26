# Acceptance tests for #3356: scene3d's ledger digest matches its sources, a release `deep-show live` starts, and a refused seal says why on stderr

Written first, blind, from issue #3356 (its two acceptance criteria as the brief quoted them), the design and base
commit `8c984adb9`, by a job that never saw an implementation; no other branch, worktree or PR was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#3356.8d8c3ce5` | `digest.test.ts` (1): the kit call `scripts/canvas-kit.mjs` makes, in the build it makes, over scene3d, writing a copy of the ledger; the committed `kit-ledger.json`'s scene3d record against it. `live.test.ts` (1): the release `deep-show live` reads its first line |
| AC2 | `#3356.c602cb3f` | `refusal.test.ts` (2): (a) a release build embedding a ledger that records scene3d at a digest no source tree has (`kit_failed`); (b) the release build of the committed ledger with `--planted constraint_iterates_to_convergence` (`entry_refused`, motion) |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text as the brief quoted the issue (no
`AC<n>:` prefix). Each test's name starts with its ID.

## What was read

- The issue's criteria as the brief quoted them.
- `docs/technical-design.md`: Dogfooding. AGENTS.md.
- At the base: `tests/acceptance/2362/` (README, `BASE-FAILURE.txt`) as the style reference, and the base sources
  the suite's comments cite: `scripts/canvas-kit.mjs` (its build and kit call), `scripts/proof-change.mjs` (`criterionId`),
  `crates/deep-show/build.rs` (`DEEP_KIT_LEDGER`), `crates/deep-show/kit-ledger.json`, and `deep-show`'s `main.rs`
  (`live`: the seal runs before the first line is read).

## What the base does

Probed at the base with the release build the tests make (`cargo build --locked --release --bin deep-show`, the
committed ledger embedded); `BASE-FAILURE.txt` holds the suite's run:

- **The kit over scene3d's current sources** answers PASS, at digest `919d7004…`; the committed `kit-ledger.json`
  records scene3d at `68337736…`, a digest its sources don't have.
- **`deep-show live`** refuses to seal and exits 2: stdout `{"ok":false,"code":"seal_refused","reason":"kit_failed",
  "modules":["scene3d"],…}`, stderr empty. It never reads its first line.
- **`deep-show live --planted constraint_iterates_to_convergence`** refuses the same way with reason `entry_refused`,
  modules `["motion"]`: stdout only, stderr empty.

## Readings where the issue leaves a choice

- **"scene3d's ledger digest matches its sources"** (AC1): the committed ledger's scene3d record equals, field for
  field (version, digest, verdict, parts), the record the kit writes for scene3d's sources as they are; so a record
  edited by hand to a digest the kit didn't run at fails, and so does one left at an old tree's.
- **"A release `deep-show live` starts"** (AC1): given one line it can't read, `deep-show live` answers it with
  `bad_input` and exits 0, which it can only do after the seal admits the set (the seal runs before the first line is
  read, and a refused set answers no line). No window opens: a line `live` can't read never reaches one.
- **"Its stderr names the code and the module"** (AC2): on a refused seal (exit 2, no line answered), stderr contains
  `seal_refused` and each refused module (`scene3d`; `motion`) as words. The reason (`kit_failed`, `entry_refused`)
  isn't required on stderr. Stdout isn't asserted: where the refusal's JSON line goes isn't this criterion's.
- Two refusals of different kinds go through the same exit, so a fix that writes stderr for `kit_failed` alone fails
  (b). Refusal (a) builds its own ledger so it refuses whatever scene3d's sources are once AC1 holds.

## Proof

`BASE-FAILURE.txt` is the one run at the base, sources unmodified: 4 tests, 4 fail, each at its assertion and for
the expected reason (the ledger's digest isn't the kit's; the seal refuses scene3d; stderr is empty in both
refusals). Nothing is BLOCKED or skipped.

## Run them

```sh
npm ci && npm run build --workspaces                  # once
NO_COLOR=1 sh scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/3356 --no-file-parallelism --testTimeout=600000 --reporter=verbose
rm -rf tests/acceptance/3356/node_modules              # the cache vitest leaves under --root
node node_modules/typescript/bin/tsc -p tests/acceptance/3356/tsconfig.json
```

- The suite builds `deep-show` debug (`cargo build --locked --bin deep-show`, the kit's build) and release (`cargo
  build --locked --release --bin deep-show`). Refusal (a) builds the release binary twice: once with
  `DEEP_KIT_LEDGER` naming its stale ledger, then again without it, so `target/` ends holding the committed ledger's
  build. `CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` are set unless given; `CARGO_TARGET_DIR` is honored.
  Each binary is copied out to a temporary folder; a test whose binary didn't build fails with cargo's error.
- Nothing touches the checkout but cargo's `target/`: the kit writes into a copy of
  `crates/deep-show/kit-ledger.json` in a temporary folder, and the committed file is only read. Temporary folders
  are deleted after their tests. Node built-ins and vitest only.
- At the base the run took 994 s on a shared, loaded machine, most of it refusal (a)'s two release builds.

Because the suite builds cargo binaries and rebuilds `target/release`, it must run alone in the lanes: the
implementer adds `'tests/acceptance/3356/'` to the `alone` list in `scripts/lanes-lists.mjs`, with `lanes.mjs`'s
`binary` reason. This README is the instruction for that edit.

## Not tested, because no criterion reaches it here

Other modules' ledger records and kit verdicts; what `deep-show live` does past its first line (windows, scenes);
the wording of stderr beyond the code and the modules; the refusal's stdout line.
