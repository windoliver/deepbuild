# #1875 evidence: affected.mjs reads PASS only when it ran what the change reaches

These runs were on the Spark (Linux arm64) on 2026-11-15, at load 90 to 220, with the base c740dede7 and the
branch at 74fbac4a. Home paths read `~`.

## The proof the issue names: the acceptance suite

`tests/acceptance/1875/` was drafted blind from the issue, the design and the base. It drives `scripts/affected.mjs`
as a process in a scratch tree, with cargo and the lint scripts stubbed, as `tests/acceptance/1114/` does.

- **Before:** `tests/acceptance/1875/BASE-FAILURE.txt`. AC1, AC2 and AC3 fail at their assertions on the base, and
  AC4 passes there, as it must. Each planted twin is caught (`twins.json`).
- **After:** `acceptance-after.txt`. All 4 pass.

| Criterion | Before (base) | After (branch) |
|---|---|---|
| `#1875.801bc708`: a by-hand file (`tests/acceptance/685/`) | PASS, 0 passed, with only a `SKIP` line | INCONCLUSIVE, naming the file |
| `#1875.f6c302f9`: an own-lane file (`tests/acceptance/684/lean.test.ts`) | PASS | INCONCLUSIVE, naming it |
| `#1875.e267e730`: `tests/vitest-setup.ts` | selects one file and reads PASS | `INCONCLUSIVE tests/vitest-setup.ts feeds every suite; run npm run preflight` |
| `#1875.aeda0f53`: a plain change | PASS | PASS, 1 passed |

## The unit test: setup files come from the config, not from a fixed path

The acceptance suite can't tell a reading of the config from a hard-coded `tests/vitest-setup.ts` (its README says
so). That gap is covered by the test `a setup file a runner config names feeds every suite…` in
`tests/affected.test.mjs`:

- `unit-before.txt`: it fails on the base's scripts, because `every` is empty for a setup file the config names.
- `unit-after.txt`: the whole file passes, 10 of 10.
- A mutant that counts the config's imported modules as setup files (`setup: named`) also fails it, on
  `scripts/globs.mjs`. That run was by hand and its output isn't kept.

## The real repository, by hand

`real-*.txt` hold `node scripts/affected.mjs <path>` on the real tree. The base runs used a scratch worktree at
c740dede7; the after runs used the branch. Each used an isolated HOME and ran under `systemd-run` with memory
capped. The `NEW FAIL`, `KNOWN` and `TIMED` lines are left out. They are the lint lanes' findings that main has
here but `known-failures.json` doesn't list (165 to 167 of them), and they are the same on both sides. Because of
them, every summary reads FAIL, so on this machine a real-tree summary can't show PASS. The lines that matter:

- **By-hand file** `tests/acceptance/685/kani.test.ts`. Before, the run prints only `SKIP … (by hand)`. After, it
  also prints `INCONCLUSIVE 1 selected file was not run, left to a person or to a lane of its own: …kani.test.ts
  (by hand)`. After, it also selects `tests/acceptance/1875/affected.test.mjs`, which names that folder.
- **Own-lane file** `tests/acceptance/684/lean.test.ts`. The same change, with `(a lane of its own)`.
- **Plain change** `tests/acceptance/1875/helpers.mjs`. No unrun-file line is printed, and 4 passed.
- **Setup file** `tests/vitest-setup.ts`: these runs were left out. At c740dede7 no test names the file by path, so
  the base falls back to "a file under the test paths is read by its folder's tests" and selects all 3,413 files
  under `tests/`. A real run of those takes hours. AC3 proves this case in the scratch tree instead. On the branch,
  `--list` selects only `tests/acceptance/1875/affected.test.mjs`, which names the file.

## Not covered here

- AC3's "on main a9d2e682" was read at the base c740dede7, not at a9d2e682 itself.
- The setup files `namedByConfig` reads come from every runner config in the tree, fixtures' own configs included.
  So `packages/conformance/fixtures/gate/cases/reporting-vitest-setup/head/support/report.js` now also reads as
  feeding every suite. That errs toward INCONCLUSIVE, never toward PASS.
- The config modules a config imports, such as `scripts/lanes.mjs` (which `vitest.config.ts` imports), are not
  counted as setup files, so their behavior is unchanged from the base.
