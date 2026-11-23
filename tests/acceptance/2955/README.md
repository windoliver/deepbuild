# Acceptance tests for #2955: the gate@1 kit can't copy a case's installs on Linux (cp -c is macOS-only)

Written first, blind, from issue #2955 (`gh issue view 2955`), the design and base commit `58b4a8cb2` ("Merge pull
request #3070 …", origin/main), by a job that never saw an implementation; none was read, nor any other branch,
worktree, pull request or stash. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding).

| Criterion | Tag | File (tests) |
|---|---|---|
| "On Linux, `makeWorld` copies a case's installs into its world's repo byte for byte. On macOS the call stays `/bin/cp -cR`, unchanged. The test is `packages/conformance/src/gate-play.test.ts` …" | `#2955.a3f66150` | `installs.test.ts` (2): on Linux, `makeWorld` with four installs returns without an error and each install in the world's repo has the same entries, bytes and link targets as in the checkout (Linux only); the same on macOS (macOS only) |

The tag was given by the coordinator; it isn't recomputed here. Every test's name starts with it.

## What was read

- `AGENTS.md`; `docs/technical-design.md` (Dogfooding, via the brief's rules).
- At the base: `packages/conformance/src/gate-play.ts` (`makeWorld`, `Owned`, `REPO`; the installs loop calls
  `execFileSync('/bin/cp', ['-cR', join(REPO, path), join(repo, path)])` after making the parent folder),
  `packages/conformance/src/gate.ts` (`makeWorld` called with `c.setup?.installs`),
  `packages/conformance/fixtures/gate/manifest.json` (the corpus's installs: `node_modules` and
  `node_modules/@jridgewell/{resolve-uri,sourcemap-codec,trace-mapping}`), `packages/conformance/package.json` (its
  entry doesn't export `makeWorld`), `packages/gate/src/checkouts.ts` (the darwin/elsewhere branch the issue cites),
  `tests/acceptance/33/helpers.ts` (the same call, out of scope), suites `3005/`, `3067/`, `298/` for house style.

## The surface under test

`makeWorld` from `packages/conformance/src/gate-play.ts`, the function and module the issue names. The issue says the
test is the package test `packages/conformance/src/gate-play.test.ts`; that file doesn't exist at the base, and a tag
on a package test can't be proven by the proof lanes (twins are read only for `tests/acceptance/<n>/`), so the tagged
tests live here and import the module the package test would. The package's entry (`src/index.ts`) doesn't export
`makeWorld`, so the import is of the module itself. Nothing is mocked: the real `/bin/cp` (BSD on macOS, GNU coreutils
on Linux), the real `git` the function commits with, real files.

Each test makes a case base folder (two files) under the OS temp dir, calls
`makeWorld(owned, base, { installs })` with:

- `node_modules/@jridgewell/resolve-uri`, `node_modules/@jridgewell/sourcemap-codec`,
  `node_modules/@jridgewell/trace-mapping`: installs the corpus's own cases name (paths whose parent folder the world
  doesn't have yet), present after `npm ci`;
- `tests/acceptance/2955/fixtures/install-tree`: a small tree with nested folders, a 512-byte binary file using every
  byte value, an empty file and a name with spaces (committed; a folder named `node_modules` would be gitignored).

What `makeWorld` throws is caught and asserted to be nothing, so the base fails at an assertion that shows the
error (`invalid option -- 'c'` on Linux), not by throwing. Then, for each install, the world's `repo/<path>` must list
exactly the source's entries (recursive, sorted) and each entry must match: a file's bytes, a link's target, a folder.
A copy nested one level too deep (`repo/<path>/<name>`), a missing or extra file, or changed bytes all fail it. Worlds
are removed through `Owned.stop()` after each test.

## Readings where the issue leaves a choice

- **"byte for byte"**: every regular file's bytes equal, the same set of entries, symlinks with the same target. File
  modes and timestamps aren't asserted (the issue doesn't state them).
- **"a case's installs"**: the corpus's `@jridgewell` installs plus a fixture tree, not the whole `node_modules` (a
  corpus case names that too; copying it per test would cost minutes and gigabytes under load and adds nothing the
  criterion states).
- **"On macOS the call stays `/bin/cp -cR`, unchanged"**: tested by behavior only, the copy on macOS still being byte
  for byte. That `/bin/cp -cR` (a clone) is the call, rather than some other copy giving the same bytes, isn't
  observable through `makeWorld`'s results, and reading the source for the argv would test the implementation, so it
  isn't asserted. A planted program that copies on macOS with plain `cp -R` or `cpSync` would pass the macOS test;
  that half of the criterion is left to review of the diff. Since "unchanged" can't fail on the base, the macOS test
  passes there (recorded in `BASE-FAILURE.txt`).
- **The fix's shape** (the `checkouts.ts` branch, `--reflink=auto`, a fallback) isn't assumed: any copy on Linux that
  yields the same tree passes.

## Which test catches which plant

- A program that keeps `/bin/cp -cR` on Linux (the base): the Linux test, at "makeWorld copies the installs without
  an error", showing `/bin/cp: invalid option -- 'c'`.
- A Linux copy that nests the install (`cp -R src dst` into an existing `dst`), drops files, or follows links into
  copies: the Linux test, at "has the same entries".
- A program that breaks the macOS copy (for example `--reflink=auto` on macOS too, which BSD cp refuses): the macOS
  test, at "without an error".

## Base results

`BASE-FAILURE.txt` holds two runs at the base, both after `npm ci` and `npm run build --workspaces`, Node 24.22.0:

- Linux (aarch64 Ubuntu 24.04, GNU coreutils cp): the Linux test fails at its first assertion with makeWorld's error,
  `Command failed: /bin/cp -cR …` / `/bin/cp: invalid option -- 'c'`; the macOS test skips naming the platform.
- macOS (arm64): the Linux test skips naming the platform; the macOS test passes, as "unchanged" requires.

As a check that the Linux test can pass, the Linux clone's `gate-play.ts` was edited by hand once (the darwin
`-cR` / elsewhere `-R --reflink=auto` branch) and the suite passed there (1 passed, 1 skipped); the edit was reverted
and isn't part of this suite. That isn't a twin or a proof-lane run. Loads: Linux 68, macOS 174.

No `target/` build is needed: `makeWorld` doesn't start the hub, deep-hook or the agent.

## Run them

With the repo's Node (24), from the repo root, after `npm ci` and `npm run build --workspaces` (the vitest config
resolves the workspace packages' builds):

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/2955
node node_modules/typescript/bin/tsc -p tests/acceptance/2955/tsconfig.json
```

Temp folders are `$TMPDIR/b2955-*` (case bases) and `$TMPDIR/gk-*` (worlds, `makeWorld`'s own), removed after each
test. No network, no process started but `cp` and `git` through `makeWorld`.

## Not tested

- That the macOS call is literally `/bin/cp -cR` (see above).
- The package test `packages/conformance/src/gate-play.test.ts` the issue names: it doesn't exist at the base, so it
  can't be run here; the implementer adds it, untagged.
- `tests/acceptance/33/helpers.ts`'s same call (out of scope in the issue).
