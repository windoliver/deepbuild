# Acceptance tests for #3088: the gate@1 kit adds each install's platform packages; a case lists none

Written first, blind, from issue #3088 (`gh issue view 3088`), `AGENTS.md`, the design (`node scripts/design-section.mjs
--issue 3088`: How we know version 0 works, the seeded false "done" cases) and base commit `b4e6a09c0` ("Merge pull
request #3216 …", origin/main), by a job that never saw an implementation; none was read, nor any other branch,
worktree, pull request or stash. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding).

| Criterion | Tag | File (tests) |
|---|---|---|
| "On Linux (the Spark, aarch64), `reporting-vitest-setup` and `reporting-rewrite-on-import` play their claim and their twin, and each verdict is one the case expects. `deep-conformance gate run …` proves it." | `#3088.bb512932` | `plays.test.ts` (1, Linux only) |
| "On macOS arm64, both cases still play to their expected verdicts, and the world's `node_modules` gets `@rolldown/binding-darwin-arm64`, `fsevents` and `lightningcss-darwin-arm64` even though the manifest no longer lists them." | `#3088.301242f7` | `plays.test.ts` (1, macOS arm64 only: the plays); `worlds.test.ts` (1, macOS arm64 only: the worlds and the manifest) |
| "A world built from a case whose installs list `node_modules/rolldown` holds every `@rolldown/binding-*` folder this checkout's `node_modules` holds, byte for byte, and none it doesn't." | `#3088.fa98a351` | `worlds.test.ts` (1, every platform) |
| "`deep-conformance gate check` refuses a case whose `setup.installs` names a package the lockfile marks with `os` or `cpu`, such as `node_modules/fsevents`. It names the case and the install. With no such entry, the shipped manifest passes the check." | `#3088.be450fed` | `check.test.ts` (3: an `os`-only install refused, a `cpu`-only install refused, the shipped manifest clean and passing) |

The tags were given by the coordinator (`#3088.` + the first 8 hex digits of the criterion text's SHA-256); they
aren't recomputed here. Every test's name holds its tag.

## What was read

- `AGENTS.md`; the design sections above.
- At the base: `packages/conformance/src/gate-play.ts` (`makeWorld`: each install copied with `/bin/cp -cR` on macOS,
  `-R --reflink=auto` elsewhere, after #2955; `startHub` runs `packages/cli/dist/main.js hub run`, hooks go through
  `target/debug/deep-hook`), `packages/conformance/src/gate.ts` (`gateCheck`, `gateRun`, `play`: a `makeWorld` throw
  becomes an INCONCLUSIVE play line), `packages/conformance/src/bin.ts` (`gate check [--corpus <dir>]`,
  `gate run [--corpus <dir>] [--case <id>]...`), `packages/conformance/fixtures/gate/manifest.json`,
  `package-lock.json` (which packages carry `os`/`cpu`), `packages/conformance/package.json` (the entry doesn't export
  `makeWorld`); `tests/acceptance/2955/` for house style; `tests/acceptance/33/helpers.ts` only to see how it runs the
  kit (nothing here imports it); `scripts/proof-binaries.mjs`, `scripts/wait-ratchet.mjs`, `scripts/alone-lint.mjs`,
  `scripts/lanes.mjs` / `lanes-lists.mjs` for the lane rules.

## The surfaces under test

- The `deep-conformance` CLI (`packages/conformance/dist/bin.js`, the package's bin), run as a child from the checkout
  with HOME and TMPDIR a fresh `/tmp/b3088-*` folder (the kit's worlds land there and are removed with it), and
  NODE_OPTIONS and VITEST* left out of its environment. `gate run --case <id> --case <id>` for the plays, `gate check`
  and `gate check --corpus <dir>` for the check.
- `makeWorld` from `packages/conformance/src/gate-play.ts`, imported as a module (the issue names it; the package entry
  doesn't export it), with a two-file base folder. What it throws is caught and asserted to be nothing, so a failure
  shows the error.

Nothing is mocked: real `cp`, real `git`, the real hub, deep-hook and agent stand-in the kit starts, the real lockfile.

## Readings where the issue leaves a choice

- **"`deep-conformance gate run reporting-vitest-setup reporting-rewrite-on-import`"**: the CLI at the base takes cases
  as `--case <id>` (positional ids are a usage error, exit 2), so the tests run `gate run --case reporting-vitest-setup
  --case reporting-rewrite-on-import`. The issue's line is read as naming the cases, not as asking for positional ids.
- **"each verdict is one the case expects"**: the kit's own judgement, its `PASS <case> <claim|twin>: …` line (the play's
  outcome is among the case's `expected` and names what the case names), for all four plays, the run's last line
  `PASS gate@1: 2 cases` and exit 0; and no output line says `cannot stat`.
- **"the world's `node_modules` gets …" (macOS)**: a play's world is deleted when it ends, so it can't be read after
  `gate run`. The test builds each case's world as a play does, `makeWorld` with that case's shipped `setup.installs`,
  and checks the three folders are in `repo/node_modules` byte for byte. "even though the manifest no longer lists
  them": neither case's shipped `setup.installs` lists any of the three.
- **"byte for byte"**: the same entries (recursive, sorted), each file's bytes, each link's target, folders as folders.
  Modes and timestamps aren't asserted. **"none it doesn't"**: the world's `node_modules/@rolldown/` holds exactly the
  `binding-*` names the checkout's does. The case in that test lists only `node_modules/rolldown`, so the binding must
  come from the kit. Other `@rolldown/*` folders (such as `pluginutils`, not a binding) aren't judged.
- **"the lockfile"**: this checkout's `package-lock.json`. The refusal tests run `gate check --corpus` on a copy of the
  shipped corpus under `/tmp` (its cases' folders as shipped), so a check that found the lockfile by walking up from the
  corpus folder wouldn't find it; the issue's "this checkout" is read as the kit's own checkout.
- **"refuses … names the case and the install"**: exit 1 (the exit table's FAIL), the last line starting `FAIL`, and an
  output line holding both the case's id and the install's path. Before each refusal, the same corpus copy with every
  lockfile-marked install taken out (and nothing added) must pass, so a check that refuses for another reason fails.
- **"marks with `os` or `cpu`"**: one refusal per half: `node_modules/fsevents` (`os` only) and
  `node_modules/@unrs/resolver-binding-wasm32-wasi` (`cpu` only). Both are asserted to carry those marks first.
- **"With no such entry, the shipped manifest passes"**: no case of the shipped manifest installs a lockfile-marked
  package, and `gate check` on it exits 0 with `PASS gate@1 corpus: <n> cases`.
- **Platforms**: the Linux play runs on any Linux (the Spark is aarch64); the macOS tests need darwin and arm64, as the
  criterion says. Each skips elsewhere with a reason naming the platform.

## Which test catches which wrong program

- The base (three darwin installs listed, nothing added): on Linux the Linux play test (each play INCONCLUSIVE with
  makeWorld's `cp: cannot stat '…/node_modules/@rolldown/binding-darwin-arm64'`); the rolldown world test on every
  platform (no `binding-*` in the world); the three check tests (no refusal; the shipped manifest lists six marked
  installs); the macOS world test at "no longer lists".
- Removing the darwin entries without the kit adding platform packages: the Linux and macOS plays (rolldown and
  lightningcss load no binding, so the checks can't run), the rolldown world test, the macOS world test.
- Skipping a missing install instead of adding the platform ones: the same as above on Linux.
- Adding bindings by npm's own matching (or from the lockfile list) instead of what this checkout holds, so a folder the
  checkout lacks is made or one it holds (`linux-arm64-musl` beside `-gnu` on the Spark) is missed: the rolldown world
  test's name list.
- Adding the bindings in the wrong place (under `node_modules/rolldown/node_modules/`) or as links to the checkout:
  the rolldown world test and the macOS world test (entries and link targets compared).
- A check that reads only `os` or only `cpu`: the refusal test for the other half. A check that refuses any
  `node_modules/…` install or the whole corpus: the control pass before each refusal and the shipped-manifest test.
  A refusal that names only the install or only the case: the "names both" assertion.

## Base results

`BASE-FAILURE.txt` holds a run at the base on each platform, both after `npm ci`, `npm run build --workspaces` and
`cargo build --locked -p deep-hook`, Node 24.22.0:

- Linux (Spark, aarch64): the Linux play test fails at its first assertion, the kit's four play lines all
  `INCONCLUSIVE … none — Command failed: /bin/cp -R --reflink=auto <checkout>/node_modules/@rolldown/binding-darwin-arm64
  … /bin/cp: cannot stat …` and exit 3; the rolldown world test fails at "the world's node_modules/@rolldown holds
  exactly the checkout's binding-* folders: expected [] to deeply equal [ 'binding-linux-arm64-gnu', … ]" (the checkout
  holds `binding-linux-arm64-gnu` and `binding-linux-arm64-musl`); the three check tests fail as on macOS; both macOS
  tests skip naming the platform.
- macOS (arm64): the macOS play test passes (both cases already play on an arm64 Mac at the base, which the criterion's
  "still" expects); the macOS world test fails at "reporting-vitest-setup's setup.installs no longer lists the
  macOS-only folders" (its world half passes at the base, since the base lists them); the rolldown world test fails at
  "the world's node_modules/@rolldown holds exactly the checkout's binding-* folders: expected [] to deeply equal
  [ 'binding-darwin-arm64' ]"; the three check tests fail (no refusal, exit 0, `PASS gate@1 corpus: 52 cases`; six
  marked installs in the shipped manifest); the Linux play test skips naming the platform.

The macOS play test can't fail on the base; it needs a twin from the implementer.

As a check that the tests can pass, each clone's `gate-play.ts` was edited by hand once (copy each install's
lockfile-marked optional dependencies the checkout holds) and the marked installs taken out of the manifest: the Linux
play and rolldown world tests passed on the Spark, and both macOS tests and the rolldown world test passed on the Mac.
The edit was reverted and isn't part of this suite; it isn't a twin or a proof-lane run, and no check refusal was tried.
Runtimes at the base: a few seconds per file (the macOS kit run of four plays, 9.6 s; the Linux one stops at once).

## Lane binaries

The plays start `deep hub run` from `packages/cli/dist/main.js` and fire hooks through `target/debug/deep-hook`, so
`plays.test.ts` checks both are built before it plays, naming them in string literals. `selectBinaries` from
`scripts/proof-binaries.mjs`, run at the base on each file:

```
plays.test.ts  {"target":["deep-hook","deep-show"],"hub":["tests/acceptance/3088/plays.test.ts"],"bin":[]}
worlds.test.ts {"target":[],"hub":[],"bin":[]}
check.test.ts  {"target":[],"hub":[],"bin":[]}
```

`worlds.test.ts` and `check.test.ts` start no hub. `lane.json` runs the folder alone (`timing:`): each kit run plays
four sessions, three at once, each on its own hub whose checks run vitest, and a play waits up to 180 s for its verdict.

## Run them

With Node 24, from the repo root, after `npm ci`, `npm run build --workspaces` and `cargo build --locked -p deep-hook`:

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/3088
node node_modules/typescript/bin/tsc -p tests/acceptance/3088/tsconfig.json
```

The kit run is killed at 15 minutes (a deadline, so a hung run fails rather than hangs); each play test's limit is 16
minutes. Temp folders: `/tmp/b3088-*` (removed after each test) and makeWorld's own `$TMPDIR/gk-*` (removed through
`Owned.stop()`).

## Not tested

- An x64 Mac or x64 Linux (the issue names arm64 machines; the rolldown world test runs on any of them and would hold).
- `libc` marks: the issue's check refuses `os` or `cpu` marks only, and every lockfile entry with `libc` also has `os`,
  so a `libc`-only package can't be tried.
- `tests/acceptance/33/helpers.ts`'s own copy (out of scope in the issue).
