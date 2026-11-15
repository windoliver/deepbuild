# #1875 evidence: affected.mjs reads PASS only when it ran what the change reaches

These runs were on the Spark (Linux arm64) on 2026-11-15, at load 90 to 220, with the base c740dede7 and the
branch at 8cd443e7. Home paths read `~`.

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

## The unit test: files come from the config, not from a fixed path

The acceptance suite can't tell a reading of the config from a hard-coded `tests/vitest-setup.ts` (its README says
so). That gap is covered by `the files a runner config names feed every suite…` in `tests/affected.test.mjs`.

- **`unit-before.txt`**: the test fails on three wrong programs, each at its assertion:
  - the base, where `every` is empty for a setup file the config names;
  - 74fbac4a, which left out the config modules a config imports, so `scripts/globs.mjs` is missing;
  - this branch without the deleted-setup-file clause, so `tests/gone.ts` is missing.
- **`unit-after.txt`**: the whole file passes.

## The real repository, by hand

`real-*.txt` hold `node scripts/affected.mjs <path>` on the real tree:

- The base runs (`real-before-*`) used a scratch worktree at c740dede7.
- The after runs used the branch at 8cd443e7.
- Each ran with an isolated HOME, under `systemd-run` with memory capped.

The `NEW FAIL`, `KNOWN` and `TIMED` lines are left out. They are the lint lanes' findings that main has here but
`known-failures.json` doesn't list (about 165), and they are the same on both sides. Because of them, every summary on
this machine reads FAIL, and a real-tree summary can't show PASS. The lines that matter:

- **By-hand file** `tests/acceptance/685/kani.test.ts`. Before, the run prints only `SKIP … (by hand)`. After, it
  also prints `INCONCLUSIVE 1 selected file was not run, left to a person or to a lane of its own; run each by hand
  or in its lane: …kani.test.ts (by hand)`. After, it also selects `tests/acceptance/1875/affected.test.mjs`, which
  names that folder.
- **Own-lane file** `tests/acceptance/684/lean.test.ts`: the same, with `(a lane of its own)`.
- **Plain change** `tests/acceptance/1875/helpers.mjs`: no unrun-file line, and its tests passed.
- **This change's own paths** (`real-change.txt`): `affected.mjs` on every path the branch changes outside `docs/`.
  Its WIDE and INCONCLUSIVE lines are kept as printed. It ran before the package builds and `deep-hook` were built
  here, so many files reported no test or BLOCKED. `recheck.txt` reruns every file it flagged, once with the branch's
  scripts and once with the base's two scripts in the same built tree. Each file reads the same on both sides, so no
  failure comes from this change. The failures that remain are main's or this machine's: 1114's timed list, 2144's
  canvas lint, macOS-only `cp -c` in 33, 1123's offline cargo fixture, timing at load in `tests/shards.test.mjs`, and
  1113's timed-grant wait at load.
- **Setup file** `tests/vitest-setup.ts`: these runs were left out. `tests/vitest-setup.test.mjs` names the file only
  in a comment, which `affected.mjs` doesn't read. So at c740dede7 the base falls back to "a file under the test
  paths is read by its folder's tests" and selects all 3,413 files under `tests/`, which takes hours to run. On the
  branch, `tests/acceptance/1875/affected.test.mjs` names the file, so a change to it selects that one test, and the
  run reads INCONCLUSIVE whatever that test does. The issue's "selects one file" holds in AC3's scratch tree, where
  the probe names the setup file by path. AC3 proves the case there.

## Not covered here

- AC3's "on main a9d2e682" was read at the base c740dede7, not at a9d2e682 itself.
- Every runner config in the tree counts, fixtures' own included, as `namedByConfig` reads them. So these also read as
  feeding every suite, which errs toward INCONCLUSIVE, never toward PASS:
  - `packages/conformance/fixtures/gate/cases/reporting-vitest-setup/head/support/report.js`
  - the config modules `vitest.config.ts` imports: `scripts/lanes.mjs` and `scripts/proof-binaries.mjs`. A change to
    `lanes.mjs` therefore reads INCONCLUSIVE and needs the release preflight.
- A deleted setup file counts only when the config lists it with its extension, as `vitest.config.ts` does. An
  extensionless entry such as `./tests/boot` resolves against what's on disk.
