# Acceptance tests for #1898: deep lease and the hub's entry load only what they use

Written first, blind, from issue #1898 (body and its one tracker comment, as the brief quoted them), the design and base
commit `ee05e7257` ("Merge pull request #2963 …"), by a job that saw no implementation diff, plan, other branch,
worktree, pull request or stash, nor the live issue. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Three test files, one shared walker, no
fixture beyond temp folders the tests make and remove, no mock.

| AC | ID | File (tests) |
|---|---|---|
| AC1 The static import closure of the `deep lease` path holds no `yaml` and no SQLite addon: a test that walks it fails on the merge base, naming the chain | `#1898.ff1558c5` | `lease-closure.test.ts` (1), with `walk.ts` |
| AC2 The hub's start time and loaded-module count are recorded with and without the kits, as a reading, on the same machine | `#1898.83fded9a` | `hub-start.test.ts` (1) |
| AC3 No visible change: the suites that cover the touched files pass unchanged against the merge base, and each package's type-check passes | `#1898.6f3b1f79` | `no-visible-change.test.ts` (2): the covering suites, the type-checks |

The IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text as the brief gave it; the live issue
wasn't read, so they aren't checked against it. Each test's name starts with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md`, Numbers version 0 has to hold, and Dogfooding; `reports/package-deep-audit.md`,
  Modularity findings 4 and 5.
- At the base: `packages/cli/src/main.ts` (the lease branch, `import('@deepbuild/hub/lease')`), `packages/hub/package.json`
  (`./lease` → `dist/heavy.js`), `packages/hub/src/heavy.ts`, `disk.ts`, `products.ts`, `vfs.ts`, `yaml.ts`, `kinds.ts`,
  `hub-runtime.ts`, `hub-command.ts`, `core-worker.ts`, `server.ts` (`runHub`, its ready line), `packages/conformance/package.json`;
  `packages/cli/test/loads.test.ts`, `packages/hub/test/startup-memory.test.ts` and `hub.ts` (`withHub`); commit
  `3c5b4754`'s message and its parent's `heavy.ts` and `products.ts`; `scripts/proof-change.mjs` (`criterionId`) and
  `scripts/proof-runs.mjs` (`atAssertion`, `runVitest`); suites `2492/` and `2218/README.md` for shape.

## What each test does

- **AC1, `lease-closure.test.ts`.** `walk.ts` walks the static import closure over the built JavaScript as Node would
  resolve it: an edge is an `import … from`, `export … from` or bare `import '…'` declaration, or a `require('…')` naming
  its module by a string literal (CommonJS's static form, and an ES module's `createRequire`, which is how the hub's
  `yaml.ts` takes `yaml`). Bare specifiers resolve through `exports` with the `node`, `import`/`require`, `default`
  conditions, as Node runs the build (not vite's `development`), workspace links followed to real files. A dynamic
  `import(…)` is not an edge. The roots are `packages/cli/dist/main.js` (its own static imports load for every command)
  and the module its `args[0] === 'lease'` branch imports, as the CLI resolves that specifier (read from the build, so a
  renamed entry is followed). The test asserts: the walk reached more than its roots, every static import on it resolves,
  and the list of modules in the closure that are `node_modules/yaml/…`, `node_modules/better-sqlite3/…` or any `.node`
  addon is empty, each listed with its chain from the entry, e.g. `packages/cli/dist/main.js's lease branch,
  import('@deepbuild/hub/lease') → packages/hub/dist/heavy.js → packages/hub/dist/products.js (as './products.js') →
  packages/hub/dist/vfs.js (as './vfs.js') → node_modules/better-sqlite3/lib/index.js (as 'better-sqlite3')`. Before
  that, a control: walked from the hub's `vfs.js` and `yaml.js`, the walk must see better-sqlite3 and yaml, else the
  test throws `BLOCKED:` (a walk blind to them proves nothing).
- **AC2, `hub-start.test.ts`.** Starts the real hub, `node packages/cli/dist/main.js hub run`, on a fresh temp home
  under `/tmp` (the socket's path stays under macOS's 104 bytes), six times, interleaved without / with the kits. A
  preload given through `NODE_OPTIONS` (so every thread of the hub runs it) logs each module each thread loads through
  `module.registerHooks`. Start time is spawn → the `"ready":true` line on stdout; the module count is the log's lines,
  all threads, from spawn until 5 s after ready. Then SIGTERM to that child (by its PID) and the home is removed. The
  reading (each run's ms and module count, medians, per-thread counts, Node version, machine model, load) is written to
  `target/acceptance-1898/hub-start.json` and attached to the test with `annotate`. It asserts, at `expect`: the hub as
  built loads no kit module (any file of a `packages/checks-*/dist/`, or `packages/conformance/dist/index.js`) in any
  thread by then, and every start with the kits loads more modules than any without. A start that never loaded the
  hub's `core.js` and `kinds.js`, or a with-kits start that loaded no kit, throws `BLOCKED:`.
- **AC3, `no-visible-change.test.ts`.** Merge base = `git merge-base HEAD origin/main`; touched = `git diff --name-only`
  from it plus untracked files, outside this folder. Test 1: the covering suites (`packages/cli/test/loads.test.ts`,
  `packages/cli/test/kinds.test.ts`, `packages/hub/test/products-restart-reclaim-2122.test.ts`) exist and are not among the touched files; they, and every
  `packages/<p>/test/*.test.ts` that names a touched `packages/<p>/src/<m>.ts` as `<m>.js`/`<m>.ts`, run in one child
  run of the repo's vitest; from its JSON report each ran a test and every test passed. Test 2: `tsc -p
  packages/<p>/tsconfig.json --noEmit` exits 0 for `cli`, `hub`, `conformance`, `checks-command`, `checks-numbers`,
  `checks-review`, `checks-work`, and every other package with a touched file.

## Readings where the issue leaves a choice

- **"The `deep lease` path"**: the CLI's entry plus the module the lease branch imports, not the rest of `main.js`'s
  dynamic branches. **"SQLite addon"**: better-sqlite3 (the hub's `vfs.ts` and `client.ts` use it), or any `.node`
  addon; `node:sqlite` is a built-in, not an addon, and isn't counted.
- **"Static"**: dynamic `import()` isn't followed. So a lease path that reaches `yaml` only through a dynamic import
  passes AC1; `packages/cli/test/loads.test.ts` (run under AC3) reads what `deep lease -- true` actually loads.
- **"Fails on the merge base, naming the chain"**: on this base the fix is already in (`3c5b4754`, #1951, put
  `DISK_FLOOR`/`freeBytes` in `packages/hub/src/disk.ts`), so the test passes here. At `3c5b4754^` `heavy.ts` imported
  them from `./products.js`, which imported `yaml` and `./vfs.js` statically; that shape, planted by hand here (one line
  `import { DISK_FLOOR as _F } from './products.js';` appended to the built `heavy.js`, then restored), failed the test
  at its last `expect`, naming both chains (yaml via `products.js → yaml.js → node_modules/yaml/dist/index.js`, SQLite
  via `products.js → vfs.js → node_modules/better-sqlite3/lib/index.js`).
- **"With and without the kits"**: without = the hub as built. With = the same start plus a preload that imports, in
  every thread, the package entry of each `@deepbuild/checks-*` the hub depends on (checks-command, -numbers, -review,
  -work) and `@deepbuild/conformance`'s index: what a hub that loaded every kit at start would hold. It stands in for
  an eager start; it isn't one (it loads them in every thread, not only the core's).
- **"Recorded … as a reading"**: a reading can't fail, so the test asserts what the title and Scope support: "no kit
  loaded before a check needs it" (none loaded by ready + 5 s, with no check run), and the two sides differ in count.
  Start time is recorded, never asserted: under this Mac's load the two sides' times overlap. The issue doesn't say
  which reading turns on the `./check` subpath (the tracker comment's note 1); nothing here judges that choice.
- **Left out: `packages/hub/test/startup-memory.test.ts`**, though it covers the hub's start loads. Its first test
  ("the hub's threads load no HTTP server or inspector at a start, and its event loop no record store") fails at this
  base, run alone on this Mac: the main thread loads `packages/record/dist/index.js`, `learned.js` and
  `projections.js`, nothing #1898 names. Kept in, it made AC3 fail on the base for that reason (the first run, quoted at
  the end of `BASE-FAILURE.txt`). `hub-start.test.ts` reads the start's kit loads in its place. It still joins test 1
  when a change touches a module it names (`readonly-core`, `hub`).
- **"No visible change"**: the suites named above are this job's choice of what covers the issue's sites; which other
  files a change touches is known only from its diff, so test 1 adds the suites naming touched modules. "Unchanged
  against the merge base" is asserted only for the named suites. "Each package's type-check" is read as each named or
  touched package's own `tsconfig.json` under `--noEmit` (the root `tsc -b` writes into sources). That a CLI's or hub's
  output, help or exit codes didn't change beyond what these suites cover is for diff review.

## Wrong programs (for the implementer's planted twins)

- AC1: `heavy.ts` (or whatever `./lease` resolves to) importing anything from `./products.js` or `./vfs.js` again, or
  any static import of `yaml` or `better-sqlite3` reachable from it (e.g. `disk.ts` importing `./yaml.js`). Fails at the
  last `expect`, naming the chain.
- AC2: a hub that loads a kit at start: `kinds.ts` with a static `import '@deepbuild/checks-review'`, or `hub-runtime.ts`
  calling `openKinds(o)` at core start. Planted here by hand (that one line prepended to the built `kinds.js`, then
  restored): the test failed at the kit-modules `expect`, listing the eight `packages/checks-review/dist/` modules.
- AC3 test 1: a change that edits a named suite (fails the unchanged `expect`) or breaks lease/hub-start loading or
  `deep kinds` (e.g. the lease entry importing the hub's index: `loads.test.ts` fails, so the `notPassed` `expect` does).
  AC3 test 2: a type error in any named package's source, e.g. `heavy.ts` using `DISK_FLOOR` with its import removed.
  None of these assertions is `toThrow`-shaped.

## Run them

With the repo's Node (`.node-version`, 24.22.0), on macOS or Linux:

```sh
npm ci
npm run build --workspaces                     # every test reads the build (dist)
cargo build --locked --offline -p deep-hook    # the hub won't start without target/debug/deep-hook
node node_modules/vitest/vitest.mjs run tests/acceptance/1898
node node_modules/typescript/bin/tsc -p tests/acceptance/1898/tsconfig.json
```

AC1 takes under a second; AC2 about 45 s (six hub starts); AC3 several minutes (one vitest of four or more suites, and
seven or more `tsc` runs). No network, sign-in or model call. Don't run `cargo build` while this suite runs.

## Base results

`BASE-FAILURE.txt` is the run at the base, whole, with the checkout's path replaced by `<repo>`, on macOS (arm64,
Apple M6, 12 cores) under heavy shared load (1-minute load 113 to 189):

| Test | Base |
|---|---|
| `#1898.ff1558c5` lease closure | pass |
| `#1898.83fded9a` hub start reading | pass (reading: without the kits 665 modules a start, with them 858; start times overlap) |
| `#1898.6f3b1f79` covering suites | fail in the recorded run, on one test of `products-restart-reclaim-2122.test.ts` (a low-disk reclaim's timing); that file passed in this job's first full run and alone right after, so it is read as load. Under less load it passes at the base |
| `#1898.6f3b1f79` type-checks | pass |
| `tsc -p tests/acceptance/1898/tsconfig.json` | clean |

AC1 and AC2 pass at the base, as the tracker comment expected: the base already holds `3c5b4754`. So the merge base is
not the wrong program for any criterion here; each needs its planted twin for the before lane. AC3 holds on the base
except for that load-sensitive test.

## Not run, and limits

- AC1 wasn't run at the issue's commit `6a6d6b4f` or at `3c5b4754^`; that it fails there is argued from those
  commits' `heavy.ts` and `products.ts` and from the hand-planted shape above.
- The walker's regexes read declarations at a line's start in tsc's output; an import written mid-line, or a module
  named by a computed string, isn't seen. Third-party CommonJS is followed only through literal `require`s.
- AC2's start time is a reading on a loaded, non-reference Mac (the MacBook Pro here is no reference Mac): it counts
  for no budget. The 5 s settle is this job's choice of "at its start".
- The planted programs above were hand edits to `dist/`, undone at once; no `twins.json` or twin was written.
