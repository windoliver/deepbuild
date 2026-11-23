# Blind redraft of #1112's worktree criterion, for the closed-issue sweep (#2047)

Written blind at the base `654c560c1` (origin/main), from issue #1112 with its comments, the design and that base. The
sweep reopened #1112 because no test on main names its criteria. Its first criterion now ends `(moved to #2673)` and is
not this folder's. This folder names and holds the other one:

> No worktree on an open branch and no uncommitted edit was removed: the before and after lists of worktrees, with
> `git status --porcelain` per remaining worktree, are saved

Its ID is `#1112.883bbf6d`, the first 8 hex characters of SHA-256 of that text, trimmed and whitespace collapsed
(computed from the issue's line as `scripts/closed-sweep.mjs` and `scripts/proof-change.mjs` do).

The job read nothing on GitHub, no other commit, branch, worktree or pull request, and no history of
`docs/evidence/1112/`. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

## Sources

- **The issue**, #1112: scope, the two criteria, its Proof line ("The saved command outputs before and after, on both
  machines"), and its three comments (the closing note of 2026-11-03, the sweep's, and the move of criterion 1).
- **The design**: `docs/parallel-proof.md` (Measured baseline; section 9, Hygiene; its uses of "uncommitted" and
  "untracked" where it describes a bay's tree and what is shipped to the Spark), `docs/technical-design.md` (Dogfooding; Tests written first; Proven on the
  base), **AGENTS.md**.
- **The base**: all eleven files of `docs/evidence/1112/`; `.gitignore` (`target/`); for the house format and the
  mechanics, `tests/acceptance/1297-redraft-2047/`, `2256-redraft-2047/`, `2513-redraft-2047/`,
  `scripts/proof-runs.mjs` (`twinsOf`, `prepareRuns`, `atAssertion`), `scripts/proof-change.mjs`,
  `scripts/closed-sweep.mjs`, `scripts/lanes.mjs`, `scripts/size-ratchet.mjs`, `vitest.config.ts`.

## What is under test

#1112 is machine hygiene and changes no code. What its Proof line names is the saved command outputs, and the base
holds them in `docs/evidence/1112/`. So the record is the thing under test: the tests read the real files there and
decide from them whether the criterion holds on the Mac and on the Spark. A wrong program is a wrong record (Twins).
The tests can't see the machines as they were on 2026-11-03; they hold what the record shows.

## What counts as evidence

An agent's word is never evidence, only check results are (AGENTS.md, invariant 1). Read that way:

| File | Read as | Used |
|---|---|---|
| `mac-before-worktrees.txt`, `mac-after-worktrees.txt` | command output: `$ git worktree list`, then `$ git -C <path> status --porcelain` per listed worktree | the Mac's two lists and every status |
| `spark-before.txt`, `spark-after.txt` | command output: `$ git worktree list` under `## worktrees`, then one `### <path>` block per worktree under `## git status --porcelain per worktree` | the Spark's two lists and every status |
| `mac-before.txt`, its `$ worktree facts` table | output of a read-only script (its heading names it and `gh pr list --state all`): per worktree its head, branch, PRs and whether the head is in origin/main | whether a removed worktree's branch is open. Each row used must agree with `git worktree list` on head and branch |
| `mac-decisions.txt`, `spark-decisions.txt` | an agent's account, with some outputs quoted and trimmed inside prose | not read |
| `mac-worktree-diff.txt` | a derived summary with no command line | not read; the tests take the difference of the two lists themselves |
| `mac-after.txt`, `mac-idle.txt`, `spark-idle.txt` | readings for criterion 1 and the scope | not read |

## How the criterion is read

- **Worktree**: a line of `git worktree list`, the main checkout included.
- **Before and after lists … are saved**: for each machine, a file whose `git worktree list` output holds at least one
  worktree, before and after. An empty or missing file, or one with no list, is not saved.
- **With `git status --porcelain` per remaining worktree**: a remaining worktree is one in the after list. Each needs
  its own status output in the after file, once. The before file needs one per listed worktree as well, since "no
  uncommitted edit was removed" can only be judged against what was there before. A remaining worktree's output must
  be status lines (two status letters, a space, a path) or nothing; a `fatal:` line is not a status.
- **Removed**: in the before list and not in the after list. One exception, from git's own two outputs: an entry that
  `git worktree list` marks `prunable` and whose `git status` answers `fatal: not a git repository` was no worktree at
  the before reading, only a stale entry in the repository's bookkeeping. Dropping it removes no worktree. Either
  output alone does not make the exception.
- **On an open branch**: the scope prunes "worktrees whose branches are merged … down to those with open PRs", so a
  branch is open when it has an open PR or is not merged. A removed worktree is shown not to be on one when
  `git worktree list` reads it `(detached HEAD)` (it is on no branch), or when the saved facts row for it, agreeing with
  the list on head and branch, reads `HEAD in origin/main` as `yes` and its PRs as `-` or all `MERGED` or `CLOSED`. An
  `OPEN` PR, a head not in origin/main, no row, two rows, a row for another head or branch, or a PR cell in another
  shape each fail, naming the worktree. The Spark saves no such table, so any removed Spark worktree on a branch fails
  as unproven.
- **Uncommitted edit**: any entry of `git status --porcelain`, the criterion's own instrument: modified, staged,
  deleted, unmerged or untracked. One path is left out, `?? target` (or `?? target/`): the cargo build folder's path,
  which the issue's scope itself has deleted as build output and never calls an edit. This is the reading's one
  judgment call (What had to be decided).
- **No uncommitted edit was removed** is held two ways. A removed worktree's status before must be a status with no
  edit. A remaining worktree's edits before must each still be in its status after, line for line: that is what the
  status per remaining worktree is saved for.

## Criteria to tests

`worktrees-kept.test.ts`, four tests: the two below, once for the Mac and once for the Spark. Each name starts with
`#1112.883bbf6d`. Each failure lists every problem found, each naming its worktree and the reason.

| ID | Test | What it asserts |
|---|---|---|
| `#1112.883bbf6d` | `<machine>: the before and after lists of worktrees are saved, each with git status --porcelain per worktree` | both files hold a `git worktree list` output; every listed worktree has exactly one status output in its file; a remaining worktree's status is a status |
| `#1112.883bbf6d` | `<machine>: no worktree on an open branch and no uncommitted edit was removed between the two lists` | every worktree in the before list and not the after list is shown not on an open branch and held no uncommitted edit; every remaining worktree's edits before are in its status after |

## What the record shows at the base

Spark: 16 worktrees before, 17 after; none removed (one new, `issue-1111-implementation-41f269`); every edit kept.

Mac: 42 before, 36 after; every edit of the 36 kept. The six gone, and how each is settled from command output:

| Entry | Branch state | Status before | Reads |
|---|---|---|---|
| `…/scratchpad/base21` | `(detached HEAD) prunable` | `fatal: not a git repository (or any of the parent directories): .git` | a stale entry, no worktree: not a removal |
| `agent-acc593499bc1d6118` | `(detached HEAD)` | empty | passes |
| `agent-a367b84c3ec0c1b93` | `impl/39-runner` at `93e175dc`; facts: PRs `-`, in origin/main `yes` | `?? target` | passes, by the `target` reading |
| `agent-a65e859048883de67` | `impl/39-loops` at `7b532e45`; facts: PRs `-`, in origin/main `yes` | `?? target` | passes, by the `target` reading |
| `agent-ad05b8765cc5b9e8a` | `impl/39-adapter` at `3ce30e02`; facts: PRs `-`, in origin/main `yes` | `?? target` | passes, by the `target` reading |
| `issue-327-implementation` | `claude/issue-327-implementation` at `373fb43d`; facts: PRs `809:MERGED:at-tip`, in origin/main `yes` | empty | passes |

## What had to be decided, and what can't be held

- **`?? target` in three removed worktrees.** Their status before was not empty. Porcelain prints an untracked folder
  with a trailing slash and `.gitignore` ignores `target/`, so this output shows one untracked entry named `target`
  that is not a folder. That it was a symlink into another worktree's `target/` is said only in `mac-decisions.txt`,
  which is not read. The tests pass it because the issue's scope treats `target/` as build output to delete, not as an
  edit. Under the stricter reading, every status entry is an uncommitted edit, the three would fail and the criterion
  would be unproven on the Mac. The design also speaks of "uncommitted changes" and "untracked non-ignored files" as
  two things (`docs/parallel-proof.md`, on a bay's tree and on shipping the exact tree); the tests don't use that looser reading: any other
  untracked path in a removed worktree fails.
- **`base21`.** No status could be read for it, and nothing saved shows its folder after. It passes only as a stale
  entry, by `prunable` and `not a git repository` together (above).
- **The facts table is a script's output, and the script is not in the tree.** The tests can't check how it computed
  `HEAD in origin/main` or the PRs; they check only that a used row agrees with git's list on head and branch.
- **A detached removed worktree** passes the branch clause by being on no branch, whatever its head. At the base the
  one such removal's head is in origin/main by the facts table, which the tests don't require.
- **Files git ignores** (a build folder, `dist/`) never show in `git status --porcelain`, so their removal with a
  worktree is outside what this criterion's instrument sees.
- **An edit committed between the two readings** by a live session would read as gone from a remaining worktree and
  fail. The record has none.
- **Order in time.** That each before file was read before its after file rests on the files' names and header lines,
  which no command printed. Not checked.
- **A worktree removed and made again** at the same path between the readings reads as remaining.

## Twins

`twins.json` maps `#1112.883bbf6d` to wrong records, each whole replacement files under
`twins/<name>/docs/evidence/1112/`, the base's bytes with the lines named here changed:

| Twin | The wrong record | Fails |
|---|---|---|
| `open-branch` | `mac-after-worktrees.txt` without `agent-a0a70551f01d24191` (list line and status). Before, it is on `worktree-agent-a0a70551f01d24191` at `aa042769`, clean, and the facts read its head as not in origin/main | Mac, removed test |
| `tracked-edit` | `mac-after-worktrees.txt` without `issue-63-read-by-reference`. Before, it is on the merged `fix/wiki-unslice` with ` M packages/wiki/src/index.ts` and ` M packages/wiki/test/wiki.test.ts` | Mac, removed test |
| `edit-gone` | `spark-after.txt` where the remaining `issue-31` no longer shows ` M package-lock.json` | Spark, removed test |
| `no-status` | `mac-after-worktrees.txt` without the status of the remaining `issue-30-ac12-counting`, and `spark-after.txt` without that of the remaining `issue-70` | Mac and Spark, saved test (and removed test: nothing shows the edits kept) |
| `unread-status` | `spark-after.txt` without the detached `<session scratchpad>/main-base`, and `spark-before.txt` where its status reads `fatal: not a git repository …` with no `prunable` on its list line | Spark, removed test |

So each of the four tests fails at its assertion on at least one twin. The exact failure text is in `BASE-RUNS.txt`.

## What the implementer provides

Nothing outside this folder is needed for the tests to run. `scripts/size-ratchet.mjs` reads source extensions only,
so the `.txt` twins need no ceiling. The tests parse files and start nothing, so no `alone`, `slow` or `timed` line in
`scripts/lanes.mjs` is needed.

## What was run

All on this Mac on 2026-11-22, Node v24.22.0, at the base with only this folder added. `BASE-RUNS.txt` holds the
output and the load beside each run.

- `npm run build --workspaces`, once, so the repo's vitest config loads (about four minutes at a load near 140).
- **The suite at the base: 4 of 4 pass** (`Test Files 1 passed (1)`, `Tests 4 passed (4)`, 0.4 s, load 75). It is a
  guard over a record the base already holds, so it must pass there (design: Proven on the base), and it passes by the
  readings above, the `target` one and the stale-entry one included.
- **Each twin laid over the base's record**, in place, the base's files put back after each run and checked byte for
  byte at the end; `git status --porcelain` then showed only this folder. Loads 74 to 75.
  - `open-branch`: 1 failed, 3 passed. Mac removed: `agent-a0a70551f01d24191` "an open branch: mac-before.txt reads
    its head as not in origin/main".
  - `tracked-edit`: 1 failed, 3 passed. Mac removed: `issue-63-read-by-reference` "held uncommitted edits".
  - `edit-gone`: 1 failed, 3 passed. Spark removed: `issue-31` "it remains, but uncommitted edits … are not in the
    one after".
  - `no-status`: 4 failed. Both saved tests: "lists it and saves no `git status --porcelain` for it", for
    `issue-30-ac12-counting` and `issue-70`; both removed tests: "nothing shows its uncommitted edits were kept".
  - `unread-status`: 1 failed, 3 passed. Spark removed: `<session scratchpad>/main-base` "is not a status … and
    git's list doesn't mark it prunable".

  Every failure is an `AssertionError` raised in this folder's test file.
- `node node_modules/typescript/bin/tsc -p tests/acceptance/1112-redraft-2047/tsconfig.json`: exit 0 (load 77).
- An earlier draft of the test file, the same checks under `describe.each`, gave the same results on the base and
  on every twin; the names were then written out so the proof tooling can read them, and everything above was run
  again on the file as it is.
- Not run: the proof lanes (`scripts/proof.mjs`: before, trace, guard), the closed-issue sweep, the size ratchet and
  the other lints, the suite on the Spark, and the suite in a fresh temporary checkout of the base (it ran in the job's
  own checkout, which holds nothing of the job's but this folder and the packages' built `dist`). The stricter reading
  of "uncommitted edit" was reasoned, not run.

## Run them

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/1112-redraft-2047/
node node_modules/typescript/bin/tsc -p tests/acceptance/1112-redraft-2047/tsconfig.json
```

The repo's `vitest.config.ts` loads the workspace packages' `dist`, so `npm run build --workspaces` comes first in a
fresh checkout. The tests themselves read files only.
