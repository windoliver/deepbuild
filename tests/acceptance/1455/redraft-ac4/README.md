# Blind redraft of #1455 AC4's `--json` part: byte-equal to the merge base's

AC4 `#1455.3231786f`: "`deep doctor` on a healthy fixture prints no `Fix:` line and one summary line, and `--json` is
byte-equal to the merge base's. A planted healthy item that prints a fix fails, naming the item". This redraft covers
only the `--json` byte equality. The no-`Fix:`/summary test and the planted test stay as they are in `../doctor.test.ts`.
It was written from the issue, the design and base `dd83ac2f`, and never saw an implementation of #1455. None was in
the checkout: the worktree was moved to `dd83ac2f` before anything was read.

## What it read

- Issue #1455 (Scope, the seven criteria, Proof). The Scope says "`deep doctor` prints `Fix:` only when something
  needs fixing, and ends with one summary line. `--json` is unchanged".
- `docs/technical-design.md`: How it installs (`deep doctor`'s items) and Dogfooding (the blind redraft). Also AGENTS.md.
- The original suite, copied unchanged into `..`: README (Pinned here 1 and 6, Disputes 8), `helpers.ts` (`mergeBase`,
  `baseTree`, `mergeBaseCli`, `doctorFailures`, `inconclusive`), `doctor.test.ts` and `BASE-FAILURE.txt`.
- The dispute as the caller stated it: the canvas items name the running CLI's own checkout root, so two folders can
  never be byte-equal.
- At the base, for the surface only: `packages/hub/src/canvas-doctor.ts` (`REPO` from the module's own URL, and
  `built()` reading `<root>/target/{release,debug}`), `packages/hub/src/doctor.ts` (the item order, and `--json` as one
  `JSON.stringify(item)` line per item), `packages/hub/src/paths.ts` (`deepHook`), and `tests/acceptance/19/doctor/helpers.ts`
  (`world`, `run`, `childEnv`, `jsonLines`).

## The premise, checked at the base: confirmed

Two more copies of the base were built in two folders of their own and run against one #19 healthy world, with this
checkout run beside them (`BASE-RUN.txt` §1). Between the two copies (the same program in two folders), exactly two
lines of `--json` differ: `canvas.gpu`'s and `canvas.headless`'s evidence, `no deep-gpu is built under <root>/target`,
each naming its own root. With each root replaced by one token, the two outputs were byte-equal on both pairs. So the
original comparison can never pass from two folders. The dispute's premise holds.

The same check found two more ways two folders differ, which the dispute did not name:

1. **The item order races.** Two runs of one program in one folder printed the codex items in different places.
   `doctor.ts` runs `claudeItems` and `codexItems` under one `Promise.all`, and each pushes its items when its
   subprocess answers. So the merge base itself prints more than one byte string. The original guard stops at the
   first try whose two checkout runs agree, so its one merge-base sample can carry the other order and fail a correct
   program.
2. **What is built under each root.** `canvas-doctor.ts` reads the canvas binaries from its own `<root>/target`.
   `git archive` carries no `target/`, so the merge base's tree always reads `binary_missing`. A checkout with
   `deep-gpu` or `deep-canvas-render` built would read `healthy` with its adapter's evidence, a difference of folder,
   not of program. At this base neither side had them built, so this was reasoned, not observed.

## Choices, and why

1. **Both CLIs' checkout roots read as one token, `<checkout root>`, in both outputs.** Each root (this checkout's and
   the merge base tree's) counts as named and as resolved (`/var/...` and `/private/var/...`). It is replaced only where
   it stands as a whole path name: not preceded or followed by a letter, digit, `.` or `-`. Every other byte is
   compared as it is. The replacement is the same on both sides, so a CLI that prints the other's root is still judged
   correctly. It also covers paths that reach `--json` through the shared home, such as `claude.mcp`'s registered
   `<checkout root>/packages/cli/dist/main.js`, which this checkout's `deep setup` wrote and both CLIs read.
2. **The merge base's tree gets this checkout's `target/`, as a link.** Both CLIs then report on one set of builds, as
   they already report on one home, one hub and one deep-hook. Without it, any checkout with a canvas binary built
   would fail on a correct program (premise, 2). The cost: a #1455 change to the canvas binaries themselves would not
   show here. The issue's Scope changes no binary that `deep doctor` runs, and `--json` is the TypeScript program's output.
3. **The guard keeps two runs of this checkout either side of the merge base's.** Only bytes this checkout printed
   twice running are laid against the merge base's. When no try has two equal runs, the result is `INCONCLUSIVE`,
   never PASS (the original's rule).
4. **A pass is this checkout's twice-printed bytes equal to any merge-base output seen in the run.** The merge base has
   more than one valid byte string (premise, 1), so a sample from one try can't stand for it. Equal bytes are equal
   whichever try they came from. Up to ten tries (the original had five), stopping at the first match. A FAIL needs no
   match in ten tries and at least one try with this checkout stable. It names the first differing line against the
   nearest merge-base output. A program that differs in any byte other than a root never matches, so it fails every
   time. **This is the choice most open to question.** A wrong program that sometimes prints the base's exact bytes
   and sometimes not could pass. No such program is in the issue's scope.
5. **Nothing passes empty.** A merge-base run that prints no item, or doesn't finish, is `BLOCKED`. A run of this
   checkout that prints no item fails.
6. **Its own merge-base tree.** `$TMPDIR/da1455-ac4-base-<sha12>-<hash of this checkout's path>` is built the way
   `mergeBaseCli` builds its tree. `mergeBaseCli`'s tree is named by the commit only, so it reuses a tree another
   checkout built, whose `node_modules` links into that checkout. Here it did: the cached tree linked into another
   agent's worktree. The tree is kept for later runs. This folder adds no
   helper to `../helpers.ts` and edits nothing outside itself.

## How to run

Node 24.22 first on `PATH`, cargo on `PATH`, macOS, at this checkout:

```sh
npm ci && npm run build --workspaces
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1455 --no-file-parallelism redraft-ac4
node node_modules/typescript/bin/tsc -p tests/acceptance/1455/tsconfig.json
```

The first run builds deep-hook and the merge base's tree (about a minute here). Later runs take 3 to 20 s. If you add
`--disable-console-intercept` to see the pass line (`equal on try N: … sha256 …`), put it after the filter: placed just
before the filter, it takes the filter as its value and vitest runs the whole suite. The home is #19's world under
`/tmp/dh19d-*`, removed after; only processes the test started are stopped, by PID. With `--root`, vitest writes
`../node_modules/.vite/`; delete it before committing.

The free disk (`hub.disk`) is read live. On a machine whose disk is filling, two runs of one program can differ on all
ten tries, and the test reads `INCONCLUSIVE` (seen once here). Run it on a quiet machine.

## Proof of the test

All at the base, in `BASE-RUN.txt`:

- **Right program, two folders:** PASS three times out of four (equal on try 2, 10 and 3). The fourth was
  `INCONCLUSIVE`: the disk crossed the doctor's low-disk line between runs of the same program.
- **Wrong programs:** three twins of the merge base, each a copy in its own folder with one edit to its built JS. Each
  failed, naming the line:
  - two fields swapped in every item: line 1, `{"item":…,"agent":…}` against `{"agent":…,"item":…}`;
  - one added item: line 14, `hub.planted`;
  - one word changed beside the root: line 27, `built under <checkout root>/target` against
    `compiled under <checkout root>/target`.
- **Control:** an unedited copy in a third folder passed.

## What wasn't run

- A checkout with canvas binaries built (choice 2): neither side had them here.
- An implementation of #1455: none existed in this checkout.
- A quiet machine: load ran 17 to 52, and the disk was nearly full.
- One mistaken full-suite run: it put `--disable-console-intercept` just before the filter, which made vitest run the
  whole suite. It was stopped by its task ID after `pictures.test.ts` failed (at 108 s) and `shown.test.ts` was
  skipping. It built the replica and app into this worktree's `target/`, which was deleted after. It also rewrote the
  plants builds in `$TMPDIR/da1455-bin-<uid>/`, from this same base commit. `pictures.test.ts` may have used the
  original suite's cached `$TMPDIR/da1455-base-*` folders.

## Files

- `doctor-json.test.ts`: the test. Its world, `deep doctor` runs and builds come from `../helpers.ts` and
  `../../19/doctor/helpers.ts`, unchanged.
- `BASE-RUN.txt`: the premise check, the runs at the base and the wrong-program runs.
