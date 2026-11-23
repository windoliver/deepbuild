# Acceptance tests for #3088: the gate@1 kit adds each install's platform packages, so its cases play on Linux

Written first, blind, from issue #3088 (`gh issue view 3088`), `AGENTS.md`, the design (`docs/technical-design.md`,
the sections `node scripts/design-section.mjs --issue 3088` prints) and base commit `b4e6a09c0` ("Merge pull request
#3216 …", origin/main), by a job that never saw an implementation; none was read, nor any other branch, worktree,
pull request or stash. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

| Criterion | Tag | File (tests) |
|---|---|---|
| "On Linux (the Spark, aarch64), `reporting-vitest-setup` and `reporting-rewrite-on-import` play their claim and their twin, and each verdict is one the case expects. `deep-conformance gate run …` proves it. …" | `#3088.bb512932` | `play.test.ts` (1, Linux only) |
| "On macOS arm64, both cases still play to their expected verdicts, and the world's `node_modules` gets `@rolldown/binding-darwin-arm64`, `fsevents` and `lightningcss-darwin-arm64` even though the manifest no longer lists them." | `#3088.301242f7` | `play.test.ts` (1, the plays) and `world.test.ts` (1, the world's node_modules), both macOS arm64 only |
| "A world built from a case whose installs list `node_modules/rolldown` holds every `@rolldown/binding-*` folder this checkout's `node_modules` holds, byte for byte, and none it doesn't." | `#3088.fa98a351` | `world.test.ts` (1, every platform) |
| "`deep-conformance gate check` refuses a case whose `setup.installs` names a package the lockfile marks with `os` or `cpu`, such as `node_modules/fsevents`. It names the case and the install. With no such entry, the shipped manifest passes the check." | `#3088.be450fed` | `check.test.ts` (3, every platform) |

The tags were given by the coordinator (first 8 hex of the SHA-256 of each criterion's text); they aren't recomputed
here. Every test's name holds exactly its criterion's tag.

## What was read

- `AGENTS.md`; the design sections the issue cites (How we know version 0 works; the done-gate row).
- At the base: `packages/conformance/src/gate-play.ts` (`makeWorld`: each install copied with `/bin/cp -cR` on macOS,
  `-R --reflink=auto` elsewhere, from `REPO`, the checkout), `packages/conformance/src/gate.ts` (`gateCheck`: one
  `FAIL gate@1 corpus: <case>: <why>` line per malformed case, exit 1; `gateRun`: one `<judgement> <case> <claim|twin>:
  <outcome> — <reasons>` line per play, then `<verdict> gate@1: <n> cases`, exit 0 only when every play is PASS),
  `packages/conformance/src/bin.ts` (`gate check [--corpus <dir>]`, `gate run [--corpus <dir>] [--case <id>]...`),
  `packages/conformance/fixtures/gate/manifest.json`, `package-lock.json` (rolldown's, lightningcss's and vite's
  `optionalDependencies`, and which packages carry `os`/`cpu`), `packages/gate/src/checkouts.ts` (how the gate copies
  ignored installs into its checkouts), `tests/acceptance/2955/` (style, the `makeWorld` import) and
  `tests/acceptance/33/helpers.ts` (how a suite runs the kit as a process; not imported, not changed).

## The surfaces under test

- `deep-conformance` as a process: `node packages/conformance/dist/bin.js gate …` (the package's `bin`), cwd the
  checkout, TMPDIR a fresh `/tmp/b3088-k-*` folder (the worlds go there; a short path keeps the hubs' sockets in
  macOS's limit), removed after.
- `makeWorld` from `packages/conformance/src/gate-play.ts`, the module the issue names. The package's entry doesn't
  export it, so the import is of the module, as #2955's suite does. That import is also how the lanes find the package.

Nothing is mocked: the real kit, hub, `deep-hook` (`target/debug`), `cp`, `git` and Vitest in each world.

### play.test.ts (`#3088.bb512932` Linux, `#3088.301242f7` macOS arm64)

`gate run --case reporting-vitest-setup --case reporting-rewrite-on-import`. For each case, the line for its claim
and its twin must be there and judged `PASS` (the kit's word for "the outcome is one the case expects, naming what it
must"), the run must exit 0 and end `PASS gate@1: 2 cases`. The test for the other platform skips, its name saying
which platform it's for.

### world.test.ts (`#3088.fa98a351`, `#3088.301242f7`)

- AC3: a case base folder (two files) and `makeWorld(owned, base, { installs: ['node_modules/rolldown'] })`. What
  makeWorld throws is caught and asserted to be nothing. Then `node_modules/rolldown` in the world matches the
  checkout's, and the world's `node_modules/@rolldown/binding-*` folders are exactly the checkout's (the same sorted
  names: none missing, none extra), each the same entries, file bytes (SHA-256) and link targets. The checkout must
  hold at least one binding (npm ci installs the platform's), or the test fails saying so.
- AC2's node_modules half: for each of the two cases in the shipped manifest, its `setup.installs` must list none of
  the three darwin folders (the lockfile marks each with `os`/`cpu`, asserted too), and a world made with
  `makeWorld` from the case's real `base/` folder and those installs must hold the three, byte for byte with the
  checkout.

### check.test.ts (`#3088.be450fed`)

- Twice: the shipped corpus copied to `/tmp/b3088-c-*`, one install added to one case's `setup.installs`, then
  `gate check --corpus <copy>`. It must exit 1 with a `FAIL` line holding both the case's id and the install:
  `seeded-bug` (no installs at the base) with `node_modules/fsevents` (`os: darwin`, the issue's example), and
  `reporting-vitest-setup` with `node_modules/@rolldown/binding-win32-x64-msvc` (`os` and `cpu`, which neither test
  machine installs, so a check that looks at what the disk holds rather than at the lockfile fails it).
- The shipped manifest: none of its cases' installs is a package the lockfile marks with `os` or `cpu`, and
  `gate check` on it exits 0, ending `PASS gate@1 corpus: <n> cases`.

## Readings where the issue leaves a choice

- **The command**: the issue writes `deep-conformance gate run reporting-vitest-setup reporting-rewrite-on-import`;
  the CLI at the base names cases with `--case <id>` (a bare id is a usage error), so the test passes
  `--case reporting-vitest-setup --case reporting-rewrite-on-import`. An implementation that also takes bare ids
  passes too.
- **"each verdict is one the case expects"**: the kit's own judgement of the play (`PASS <case> <play>:`) and the
  run's exit 0, rather than the suite re-reading `expected` from the manifest, so the verdict the case expects is the
  manifest's, as the kit reads it.
- **"the world's `node_modules` gets …"**: observed through `makeWorld` with each case's installs, not inside a
  `gate run` (its worlds are removed when each play ends). The test also requires the manifest no longer lists the
  three, as the criterion states ("even though the manifest no longer lists them"), so that half of AC2 fails on the
  base.
- **"refuses … names the case and the install"**: one `FAIL` line holding both strings, and exit 1 (the check's FAIL
  exit at the base). The wording of the line isn't asserted.
- **The corpus to refuse**: `gate check --corpus <dir>`, the CLI's own flag, on a copy of the shipped corpus in the
  temp folder. "The lockfile" is read as this checkout's `package-lock.json` (where the kit copies installs from);
  the copied corpus has none of its own. An implementation that looks for a lockfile beside the corpus instead would
  fail the refusal tests; that reading is this suite's.
- **"byte for byte"**: the same entries, every file's bytes equal and links with the same target; modes and times
  aren't asserted. **"none it doesn't"**: no `binding-*` folder under the world's `node_modules/@rolldown` that the
  checkout's lacks. Other `@rolldown/*` folders (`pluginutils`) aren't counted either way.
- **Linux's libc**: npm on the Spark installs both `@rolldown/binding-linux-arm64-gnu` and `-musl` (and both
  lightningcss variants). AC3 asks for every binding the checkout holds, so both must be copied; the kit doesn't redo
  npm's matching (issue, Scope).

## Which test catches which wrong program

- The base (installs copied as listed, no platform packages added, no check): play.test.ts on Linux at "plays to a
  verdict the case expects" with `cp: cannot stat '…/@rolldown/binding-darwin-arm64'`; world.test.ts AC3 at "holds
  exactly this checkout's binding folders" (`[]`); world.test.ts AC2 and check.test.ts's shipped-manifest test at
  "no longer lists" / "name no install"; the two refusal tests at "prints a FAIL line naming the case … and the
  install".
- Darwin entries removed but nothing added: both world.test.ts tests, and (expected, not run) play.test.ts on both
  platforms, since rolldown can't load a binding the world lacks and Vitest can't start there.
- Darwin entries merely skipped when missing: play.test.ts on Linux (no Linux binding) and AC3.
- Adding every optional dependency the lockfile lists, or creating folders for ones the disk lacks: AC3's "none it
  doesn't" (or makeWorld's error when it copies a folder that isn't there).
- Adding only the gnu binding by a platform match of its own: AC3 on the Spark (the musl binding missing).
- A check that tests what's on disk instead of the lockfile: the win32 refusal test. A check that refuses every
  install, or every optional dependency: the shipped-manifest test (it lists rolldown, lightningcss and vite).

## Base results

`BASE-FAILURE.txt` holds both runs at the base, each in a fresh GitHub clone after `npm ci`,
`npm run build --workspaces` and `cargo build -p deep-hook`, Node 24.22.0:

- Linux (Spark, aarch64 Ubuntu 24.04): check.test.ts 3 failed at their assertions; world.test.ts AC3 failed at "holds
  exactly this checkout's binding folders (binding-linux-arm64-gnu, binding-linux-arm64-musl)", AC2 skipped;
  play.test.ts AC1 failed at "reporting-vitest-setup's claim plays to a verdict the case expects", the line reading
  `INCONCLUSIVE … Command failed: /bin/cp -R --reflink=auto …/@rolldown/binding-darwin-arm64 …: cannot stat`, AC2
  skipped. Load about 35.
- macOS arm64: check.test.ts 3 failed; world.test.ts AC3 failed (`[]` against `['binding-darwin-arm64']`) and AC2
  failed at "reporting-vitest-setup's setup.installs no longer lists the darwin folders"; play.test.ts AC2 passed
  (the plays work on the base here, as "still" expects), AC1 skipped. Load about 55.
- `tsc -p tests/acceptance/3088/tsconfig.json` exits 0 on both.

Run times at the base: check.test.ts about 1 s, world.test.ts under 1 s, play.test.ts 10 s on macOS (the four plays)
and under 1 s on Linux (each play stops in makeWorld).

As a check that the suite can pass, the Spark clone was hand-edited once (makeWorld adds the lockfile's `os`/`cpu`
optional dependencies of each install that the checkout holds; gateCheck refuses an `os`/`cpu` install; the darwin
entries removed). check.test.ts and world.test.ts AC3 then passed. play.test.ts on Linux still failed, every play
`INVALID — .deepbuild/checks/<check>.sh: has no run on the merge base`; `gate run --case seeded-bug --case
passes-on-retry` (cases with no platform installs) reads the same on that Spark, so the gate's merge-base run on
Linux is a second blocker AC1 meets, outside what this suite can tell apart. Vitest itself ran in the hand-edited
world (its check failed on the base as it should). The edit isn't part of this suite, and that isn't a twin or a
proof-lane run.

## Run them

With the repo's Node (24), from the repo root, after `npm ci`, `npm run build --workspaces` and
`cargo build -p deep-hook` (the plays' hooks run `target/debug/deep-hook`):

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/3088
node node_modules/typescript/bin/tsc -p tests/acceptance/3088/tsconfig.json
```

`lane.json` runs the folder alone: play.test.ts starts hubs that run `deep-hook` from `target/debug`. Temp folders
are `/tmp/b3088-*` and the kit's `gk-*` worlds inside them, removed after each test. No network.

## Not tested

- What `gate run` puts in the worlds of its own plays (they are removed when a play ends); the world half of AC2 is
  read through `makeWorld` with the same installs.
- An x64 Mac or an x64 Linux (the issue names it; no such machine here).
- That a world from installs which don't list `rolldown` gets no `@rolldown` binding (the criterion is about a case
  that lists it).
- `tests/acceptance/33/helpers.ts`'s own copy (out of scope in the issue).
