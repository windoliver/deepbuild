# Acceptance tests for #1816: the spine judges in a checkout with git history

Written first, blind, by a job that never saw an implementation of #1816 (none existed). The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

What was read:

- **The issue**, #1816 "spine.mjs judges in a checkout with no git history, so tests that read the merge base fail", as
  of 2026-11-10: its body only (the problem, Where it bites, Not the test, Done when with its two bullets, Also found,
  smaller).
- **The design and rules**: `AGENTS.md`; `docs/technical-design.md` (the verdict table and its precedence, Dogfooding).
- **The base** `4ab2750c0` (origin/main): `scripts/spine.mjs` (`landed`, `results`, `parts`, `judge`, `reopen`, the
  SPINE table), `scripts/proof-runs.mjs` (`checkout()`, `temporary()`), `scripts/proof-change.mjs` (`readIssue`,
  `criterionId`), and `tests/acceptance/33` (`spine.test.ts`, `spine.live.test.ts`, `helpers.ts`, README, how
  by-hand files are named and skipped), `tests/acceptance/1434` (README layout, `*.live.test.ts`).

## Criteria

The issue has no checkbox list. Its criteria are, in order: the "Done when" sentence (without its "For example …"
sentence, which suggests one way and isn't required), its two bullets, and the two "Also found, smaller" bullets, each
read as "fixed". Each ID is `#1816.` + the first 8 hex of SHA-256 of the quoted text, trimmed, white space collapsed
(`criterionId` of `scripts/proof-change.mjs`).

| AC | ID | Criterion (quoted) | Tests |
| --- | --- | --- | --- |
| AC1 | `#1816.82cb5332` | the spine judges each task in a checkout where `git merge-base HEAD origin/main` and `git show <base>:<path>` answer as they would in the repo at that commit, still never a worktree of the user's. | `merge-base.test.ts`: HEAD is T, merge base and `git show` answer as in the repo; no worktree is added to the user's repo while judging or after, and the checkout's git directory isn't the user's |
| AC2 | `#1816.1b37f8c3` | A test shows a merge-base-reading test passing under `spine.mjs`. | `merge-base.test.ts`: `spine.mjs judge --issue 44` reads that test's criterion PASS, #44 PASS, nothing reopened |
| AC3 | `#1816.7bc2d1b4` | #44 is judged again. | `judged-again.live.test.ts`, by hand (below) |
| AC4 | `#1816.c7e80311` | `spine.mjs` copies node_modules with `cp -cR` (macOS clone). On Linux the checkout gets no node_modules, and every task reads BLOCKED "the workspaces didn't build". | `node-modules.test.ts`: on this machine (Linux included) the checkout has the user's node_modules, the workspace that needs them builds, the task reads PASS |
| AC5 | `#1816.6b352974` | `parts()` drops each part's `why`, so a BLOCKED part doesn't say why. | `parts.test.ts`: a task split into parts reads its BLOCKED part with the why the part's own judgment gives |

## The fixture (fake only GitHub)

Each file builds, under `/tmp/dh1816-*`, a bare `origin.git` and the user's repo `repo/` cloned from it (so it has
`origin/main`), then copies this checkout's `scripts/*.mjs` into `repo/scripts/` so that `spine.mjs`'s root is the
fixture. `repo/node_modules` holds a link to this checkout's `typescript` (the scripts import it) and a marker package
`dh1816-marker`; both folders are ignored (`.git/info/exclude`), as the user's tooling is. The SPINE table names real
merged commits, so the copy's literal for the task (#44; #12 and #13 for AC5), read from `node scripts/spine.mjs list`,
is replaced by the fixture's commit; if the table stops holding it as a literal the test fails `BLOCKED`.

`gh` is a fake first on PATH: `gh issue view <n> …` prints `issues/<n>.md`, `gh issue reopen …` is appended to
`issues/reopened.log`, anything else fails. Every process gets `HOME` and `TMPDIR` inside the fixture and none of the
runner's `GIT_*`, `GH_*`, `GITHUB_*`, `DEEP_*`, `XDG_*`, `CLAUDE*` or `npm_*` settings. No network, no real issue is read
or reopened, this checkout's git is only read (`spine.mjs list`).

- **merge-base.test.ts** (AC1, AC2): main's B has `benchmarks/budgets.json` `{"ms":100}`; main moves on to M
  (`{"ms":80}`, pushed); the task commit T, on a branch from B, sets `{"ms":90}` and lands
  `tests/acceptance/44/merge-base.test.mjs`, a `node:test` file like #348 AC8's that runs `git merge-base HEAD
  origin/main` and `git show <base>:benchmarks/budgets.json` in its cwd, expects B and `{"ms":100}`, and writes what it
  saw (HEAD, merge base, the file, `--git-common-dir`, the user's repo's `git worktree list` during the run) to an
  evidence file.
- **node-modules.test.ts** (AC4): the workspace `packages/w` builds with `require('dh1816-marker')`; the task's test
  requires it from the checkout.
- **parts.test.ts** (AC5): #12's body has `### Parts` with `- #13 …`; #13 has one criterion and a test; the workspace
  build exits 3, so #13 reads BLOCKED with a why. #13 is judged alone, then #12, whose part entry must carry that why.

## AC3, by hand

`judged-again.live.test.ts` runs only with `DEEP_LIVE=1` and the maintainer's own `gh` sign-in, as #33's
`spine.live.test.ts` does; otherwise it skips with a reason starting `INCONCLUSIVE`, so the criterion never reads PASS
unrun. It runs `node scripts/spine.mjs judge --issue 44` in this checkout (hours: it builds and runs #44's parts'
tests at #44's merged commit) and holds: #44 judged once at the commit `list` names, on criteria `#44.*`, PASS exactly
when every criterion is, every BLOCKED criterion says why, and nothing reads "not a git repository" or "the workspaces
didn't build". Like the spine, it reopens #44 on GitHub with a comment if #44 doesn't read PASS; it doesn't require
PASS. The implementer adds it to `scripts/lanes.mjs`'s `byHand`.

## How to run

```sh
npm ci                                               # this checkout's typescript and vitest
npx vitest run --root tests/acceptance/1816 --no-file-parallelism --exclude '**/*.live.test.ts'
DEEP_LIVE=1 npx vitest run --root tests/acceptance/1816 judged-again.live.test.ts   # by hand, AC3
node node_modules/typescript/bin/tsc -p tests/acceptance/1816/tsconfig.json
```

The offline files take seconds (three to four spine runs on tiny fixtures; npm runs the fixture's workspace build).
`--root` leaves Vitest's cache in `tests/acceptance/1816/node_modules/.vite`; delete it.

## Proof the tests can tell

- **Base** (`BASE-FAILURE.txt`): AC1's first test, AC2, AC4 and AC5 fail for the reasons the issue gives; AC1's second
  test passes, since `git archive` makes no worktree.
- **Planted twin, worktree**: `checkout()` as `git worktree add --detach`: AC1's first test and AC2 pass, AC1's second
  fails (a second worktree listed while judging).
- **Planted twin, fixed**: `checkout()` as `git clone --shared --no-checkout` then `checkout --detach`, `cp -R` on
  Linux, and `parts()` keeping each part's `why`: all five offline tests pass. Neither twin is kept here.
