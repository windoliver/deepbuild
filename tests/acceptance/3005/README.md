# Acceptance tests for #3005: job tools that guard on import.meta.url fail qualification when the hub home path runs through a symlink

Written first, blind, from issue #3005 (its report, cause, reproduction and three acceptance criteria) as the brief
quoted it, the design and base commit `512d194bb` ("Merge pull request #2972 …", origin/main), by a job that never
saw an implementation; none existed, and no other branch, worktree, pull request or stash was read, nor the live
issue. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this
job (design: Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#3005.a1f4670f` | `symlinked.test.ts` (1): a hub whose home runs through a symlink; `deep install packages/jobs/import` prints `Installed deepbuild/import@1.0.0` and exits 0 |
| AC2 | `#3005.ae03f3f2` | `symlinked.test.ts` (1): the same hub; `deep install packages/jobs/typeset` prints `Installed deepbuild/typeset@1.0.0` and exits 0 |
| AC3 | `#3005.c0a2e167` | `real.test.ts` (2): a hub whose home is its real path; each of the two installs prints it is installed and exits 0 |

The ID is `scripts/proof-change.mjs`'s `criterionId` (sha256 of the text, whitespace collapsed, first 8 hex) over
each criterion's text after `- [ ] `, bold markers included, in the wording the coordinator relayed as user-approved
(it replaced the brief's first wording, which also named `packages/jobs/score`; score is not tested). The live issue
body wasn't read, so the IDs aren't checked against it. Every test's name starts with its ID.

## What was read

- `AGENTS.md`; `docs/technical-design.md` (Dogfooding).
- At the base: `packages/extension-host/src/jobs.ts` (`runTool`: argv `[process.execPath, join(folder, dir, entry)]`,
  stderr dropped without a counter watcher), `packages/jobs/import/tool/lottie.mjs` and
  `packages/jobs/typeset/tool/typeset.mjs` (the `import.meta.url === pathToFileURL(process.argv[1]).href` guard),
  the two packages' `index.ts` (`run: { dir: 'tool', entry }`) and `deepbuild.json`, `packages/extension-host/src/digest.ts`
  (for the twin's stamp), `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (twins, the
  at-assertion rule), `docs/evidence/2629/e2e.sh` and its outputs (the "Installed <id>@<version>" line), suite
  `154/helpers.ts` (hub start, `deep install`, child env, cleanup) and suite `2629/` (layout, twins).

## The surface under test

`deep install <folder>` (this checkout's `packages/cli/dist/main.js`) as you, against a real `deep hub run` from the
same build, HOME and TMPDIR in a temp folder, the OS confirm stubbed with `DEEP_HUB_TEST_CONFIRM` as e2e.sh does. Each
file starts one hub in `beforeAll`; its tests install into it in order. Assertions are on the command's exit code and
its printed output only.

## Readings where the issue leaves a choice

- **"a hub whose home path runs through a symlink"**: the tests make the link themselves, so they hold on Linux too,
  where `/tmp` is a real folder: a real folder `R = realpath(mkdtemp('/tmp/dh3005-'))`, a symlink `R-link → R`,
  HOME `R-link/h` and TMPDIR `R-link`. "Spelled by its real path": HOME `R/h`, TMPDIR `R`. Each world checks its own
  spelling first (the link is a link; the home is or isn't its own realpath), so a setup that couldn't make the case
  fails there, not as a pass.
- **"the package is installed"**: the output holds `Installed deepbuild/import@1.0.0` (resp. `deepbuild/typeset@1.0.0`),
  the line `deep install` prints in docs/evidence/2629's runs, and the exit code is 0. The typeset package's id and
  version are from its `deepbuild.json`.
- **"Given the same hub"** (AC2): the AC1 hub, its home through the link; typeset is installed after import in it.
- **"each of the two installs"** (AC3): one real-path hub, import then typeset, one test each, both tagged AC3.
- **The issue's possible fixes** (realpath in the host, or in the tools' guard, or stderr in the refusal) aren't
  assumed: the tests read only what `deep install` prints and its exit code.

## Twin

AC3 passes at the base (the bug needs a link), so it gets a planted wrong program, `twins/guard-link-only`
(`twins.json`): both tools' guard replaced by one that runs the tool only when `process.argv[1]` is a different
spelling of the module's real path, i.e. a "fix" that handles the link and breaks the real-path case, with the two
packages' `deepbuild.json` digests restamped over the twin's files (`packageDigest`, a fixed point: the digest field
isn't hashed). Laid over a host-side fix (the host spawning by realpath), it never runs either tool, so it still fails
AC3. It assumes the change leaves the two packages' other files as at the base; if the change edits them, the twin's
stamp won't match and its install is refused for the digest, which still fails AC3 at its exit-code assertion but for
another reason — restamp the twin then (a blind redraft).

## Base results

`BASE-FAILURE.txt` is the whole run at the base on macOS (arm64), Node 24.22.0, after `npm run build --workspaces`
and `cargo build -p deep-hook`, load ~48–76. 4 tests: 2 fail, 2 pass, nothing BLOCKED.

- AC1 and AC2 fail at their exit-code assertion, for the issue's reason: `exit 1`, stderr `REFUSED: deepbuild/import's
  tool lottie-import@1.0.0 fails import's qualification at the fixture loader: lottie-import@1.0.0 wrote no {outputs}
  …` and the same for `typst-mitex@1.0.0` at the fixture `pythagoras`.
- AC3's two tests pass at the base, as the criterion says ("as today").

The twin was run once by hand: an APFS clone of the base checkout (no `target/` but `deep-hook`), the twin's files
laid over it, the suite run there. AC3's two tests fail at the exit-code assertion with the same "wrote no {outputs}"
refusal for both tools; AC1 and AC2 pass on it (a tool guard that resolves the link does install through the link),
so the symlinked tests can pass on a fix of that kind. The run wasn't through `scripts/proof-runs.mjs`, which needs a
change commit.

## Run them

With the repo's Node (24), from the repo root, after `npm ci`, `npm run build --workspaces` and
`cargo build -p deep-hook`:

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/3005
node node_modules/typescript/bin/tsc -p tests/acceptance/3005/tsconfig.json
```

Temp folders are `/tmp/dh3005-*` (real) and `/tmp/dh3005-*-link`, removed after each file. No network beyond the
local hub, no process started or stopped but its own, by PID.
