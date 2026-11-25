# #3336: a unit lane run of #1941's taste test leaves the tree as it found it (blind)

Written blind from issue #3336, docs/technical-design.md ("Dogfooding"), docs/parallel-proof.md and the base commit
`3c564bbdd`, for two of the issue's three criteria. The third (a planted writer under `docs/evidence/` makes the unit
lane FAIL naming the path) is covered elsewhere and is not tested here.

Run it from the checkout's root:

    npx vitest run tests/acceptance/3336-redraft-taste --reporter=verbose

## Criteria → tests

| Criterion | Test (`tree.test.ts`) |
|---|---|
| `#3336.f7adc8c8` A unit lane run leaves `git status` clean: the tree after the lane's commands is the tree it started on. | `#3336.f7adc8c8 after the unit lane runs #1941's taste test in a clean copy, git status there is clean: …` |
| `#3336.7d4ab4ab` Whatever the run writes goes to a temp or run folder: #1941's screenshots are written outside the checkout, and the run names where. | `#3336.7d4ab4ab #1941's screenshots are written outside the checkout, to a temp or run folder the run names, …` |

## How the run is made

As the issue's Proof says, the suite runs #1941's taste test from a clean copy and reads `git status` after. One run,
in `beforeAll`, serves both tests:

1. **Which files.** The #1941 taste files the unit lane runs in the tree under test: `tests/acceptance/1941/taste.test.ts`
   while it exists, and each `*.test.ts` under `tests/acceptance/1941-redraft-3336/` once that folder exists, less any
   file `scripts/lanes.mjs` lists in `byHand` or `ownLane` (the unit lane never runs those). On the base that is the
   first draft alone. With none, both tests read INCONCLUSIVE.
2. **The copy**, in the OS temp folder, never in the checkout: each top-level entry of the tree under test except
   `.git`, `target/`, `node_modules/` and `.claude/`, cloned copy-on-write with its times (macOS `cp -c -R -p`);
   `target/debug/` (less `incremental/`) cloned the same way from `CARGO_TARGET_DIR` or `target/`, so the copy's cargo
   build of `deep-show` starts warm; `node_modules` a link to the tree under test's. A fresh git repository there
   commits the whole tree (hooks, signing and fsmonitor off), so `git status` is clean before the run; the test checks it.
3. **The run**, as the unit lane runs its Vitest files: `vitest run --no-file-parallelism <files>` from the copy's root
   with the repo's config, a `TMPDIR` of this run's own, and no `CARGO_TARGET_DIR` (the copy builds into its own
   `target/`, never the checkout's). A deadline 14 minutes after the file starts ends it with SIGKILL, by PID, on the
   child and every process below it.
4. **Readings.** `git status --porcelain --untracked-files=all` in the copy; the files written in the copy after the run
   started (`find -newer`, outside `.git`, `target/` and `node_modules`); the absolute paths the run's output and JSON
   report name that are folders (or files' folders) outside the copy and the tree under test holding PNGs; and the PNGs
   under the run's `TMPDIR`. The copy is removed after the file, asynchronously.

Only where files land and whether the tree changed are judged, never whether #1941's own test passes.

## Verdicts

- **f7adc8c8** fails when `git status` in the copy lists any path, naming each. Otherwise INCONCLUSIVE when the run was
  cut short, ran no taste test, or drew no screenshot anywhere (inside the copy, under its `TMPDIR`, or in a folder it
  names); PASS only after a full run that drew and left the tree clean.
- **7d4ab4ab** fails when the run wrote any file inside the copy, naming each. Otherwise INCONCLUSIVE when cut short,
  when no taste test ran, or when it drew nothing; then it fails when the output names no folder outside the checkout
  holding the screenshots, or when a PNG under the run's `TMPDIR` lies in no folder the output names; else PASS.
- Off macOS both read INCONCLUSIVE before any copy is made (the taste test draws on Metal). A copy that can't be made is
  INCONCLUSIVE too.

A changed tree or a write into the checkout fails whether or not the run finished: it is evidence on its own.

## How each fails on the wrong program

The wrong program is the merge base itself (no twin): its `tests/acceptance/1941/taste.test.ts` writes every screenshot
to `join(REPO, 'docs', 'evidence', '1941')` before it reads `TASTE.json`.

- **f7adc8c8**: on this Mac render-back's text drawing differs from the committed bytes, so
  `docs/evidence/1941/contrast-muted-before.png` and `-after.png` come back modified (` M`), and `git status` is not
  empty. Caveat: on a machine whose renderer draws every committed byte exactly, the base writes the same bytes, the
  tree is unchanged, and this test passes the base (the criterion is the tree, not the writes); the before lane there
  would need a twin, a taste test writing other bytes into the checkout. 7d4ab4ab fails the base on any machine.
- **7d4ab4ab**: the base writes its screenshots inside the checkout (`docs/evidence/1941/*.png`, rewritten whatever
  their bytes; 27 files in the base run here), so the list of files written inside the copy is not empty. Its output
  names the pictures by relative paths only, so it would also fail the "names where" assertion: a folder that holds
  the copy or the checkout (the run's own work folder, say) never counts as a named folder outside it.

BASE-FAILURE.txt holds the base run.

## Not tested here

- The planted `docs/evidence` writer and the lane's own tree check (criterion 3; covered elsewhere).
- A whole unit lane run ending with `git status` clean: the issue's Proof makes that a reading by hand. This suite runs
  only the lane's #1941 taste files, as the lane's Vitest block runs them, in a copy.
- Whether the redraft's folder is "a temporary folder it prints and keeps" in those words: any folder outside the
  checkout that the run's output names and that holds its screenshots meets the criterion; the redraft's file names are
  not known here.
- Writes into the tree under test's `node_modules` (the copy links to it; it is ignored, so not part of the tree) and
  into `target/` (ignored; the copy's own).

## Lane notes

- The file runs in the unit lane's parallel block. The folder's name is not numeric, so a `lane.json` here would not be
  read (`LANE_FILE` in scripts/lanes-lists.mjs); none is needed: the copy builds and runs its own `deep-show` in its own
  `target/`, so no sibling's binary is replaced.
- Under load, the copy's cargo build recompiles the workspace crates at the copy's path. If that plus the drawing
  doesn't fit in 14 minutes, the run is cut short and both tests read INCONCLUSIVE, unless the tree already changed.
  In a lane copy with no `target/`, the build starts cold and is likely to be cut short the same way.
- Hook and test timeouts: setup 15 min, each test 30 s, cleanup 3 min, under the 20-minute file cap.
