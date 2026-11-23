# Acceptance tests for #3165: an additive merge of `scripts/lanes.mjs` passes the guard unapproved

Written first, blind, from issue #3165 (its text as of November 22, 2026: Scope, the 4 acceptance criteria, Proof, and Depends on #569), `AGENTS.md` (Proof), `docs/technical-design.md` (The edit guard, Dogfooding), the house style of `tests/acceptance/569/` and the planted merge in `tests/acceptance/1115/guard.test.mjs`, and the base commit `3c500c0c8` (`origin/main`, where the guard refuses every conflict in a check file). The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft by this job.

## Run

```sh
node --test 'tests/acceptance/3165/*.test.mjs'
```

Node 24.22 or newer, git 2.38 or newer (the guard remerges with `git merge-tree --write-tree`), `ssh-keygen`, and this checkout's `node_modules` (the guard's own imports). No network, no `gh` login. Every test builds its own scratch git repository under the system temporary folder (realpathed) and removes it afterwards; nothing is written into this checkout. The 14 tests take about 8 seconds each on a loaded machine, each one guard run.

## Surfaces

- **`node scripts/proof.mjs guard`**, run as a process from this checkout with its cwd at a scratch repository. Its stdout lines `PASS guard: …` and `FAIL guard: …` (each FAIL followed by its `  Fix: ` line) and its exit status are all the tests read.
- **Git objects in the scratch repository**: commits, a real conflicting merge commit of two parents, and approval tags under `deep/approved/`, signed by the stand-in security key of `tests/fixtures/approver.mjs`, whose public line the merge base's `.deepbuild/approvers` lists.
- **Environment**: `DEEP_PROOF_ISSUES`, a folder holding the planted issue `#9001` the scratch commits name, so no run asks GitHub. No test here carries that issue's tag.

Nothing is imported from the code under test. `helpers.mjs` takes scratch repositories, approvals, the proof runner and the line assertions from `../569/helpers.mjs`.

### The planted merge

The first commit on `main` holds `.deepbuild/approvers`, `scripts/proof-guard.mjs` (a stand-in: the guard holds check files guarded once the merge base has that file), a small `scripts/lanes.mjs` with a list of test paths one a line, and `vitest.config.ts` with an `include` list. Then:

1. `main` adds one line after the list's last, and `refs/remotes/origin/main` moves to it;
2. `change` adds a different line at the same place, in one commit that touches only that file, approved by a signed tag naming the file (Reading 1);
3. `change` merges `main`. The test asserts that git stopped with that one file unmerged and left conflict markers in it, then commits the resolution it is testing as the merge commit, of two parents, touching nothing else.

The merge base of the change is then `main`'s tip, which holds the approvers list and `scripts/proof-guard.mjs`.

## Readings where the issue leaves a choice

1. **"With no approval" is about the merge commit.** Both parents must add a line to `scripts/lanes.mjs`, and one parent is the change's own side. The change's own added line is an ordinary edit of a check file, which "is judged as today": it needs its own approved proposal. So every scene approves that one commit by a signed tag naming the file, and "no approval" means the merge commit has none. Criterion 1's tests also ask for the `PASS guard:` line that names `scripts/lanes.mjs` and that commit, which shows the rules for check files were in force in the scene.
2. **"Keeping both lines" in either order.** Scope: every line either parent holds is in the result, each parent's lines keep their own order, and no line is new. With one added line a side, main's line first and the change's line first both meet that, so criterion 1 has a test for each.
3. **"Dropping one parent's added line" is two resolutions.** Dropping main's line leaves the file exactly as the change's parent has it, and dropping the change's line leaves it as main has it. Both are tested. Each is "any other resolution", though it equals one parent whole.
4. **"Naming `scripts/lanes.mjs` and the merge commit".** One `FAIL guard:` line holds the path and the merge commit's short hash as `git rev-parse --short` prints it (the base prints the first 12 hex digits, which begins with it). Criterion 3 says only "naming the file", so its tests ask for the path alone on a `FAIL guard:` line.
5. **An order check, under criterion 2.** The criterion lists three failing resolutions; the Scope's rule has a fourth way to fail, "each parent's lines keep their own order". One test keeps every line, adds none, and swaps two lines both parents hold; it must fail by name as the others do, since "any other resolution of that file is judged as today". It carries criterion 2's tag because that criterion is the one about resolutions that aren't additive. If the maintainer reads the order rule as outside the criteria, this test and its criterion 4 twin are the ones to drop in a redraft.
6. **"A test runner's config"** is `vitest.config.ts` at the repository's root, with both parents adding a glob to its `include` list. "The same additive resolution" there and in `scripts/proof-guard.mjs` is main's line then the change's.
7. **"Each failing resolution above" in criterion 4** is each resolution of `scripts/lanes.mjs` that criterion 2 fails (the five tested there), since the approval the criterion describes names that file. The approval is a signed tag on the merge commit with `Approves: scripts/lanes.mjs`. The run must exit 0 with no problem line and hold a `PASS guard:` line naming the file and the merge commit, "as before". The two other-file merges of criterion 3 aren't sent with an approval here: an approval naming `scripts/lanes.mjs` doesn't name them, and the issue says nothing new about one that does.
8. **Lines are compared as whole lines.** The planted lists hold one path a line with a trailing comma, so no test depends on whether a line's white space or its place in a longer line counts.

## Criteria, tests and wrong programs

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with white space collapsed and the leading `- [ ] ` dropped. Each test name starts with its ID.

| # | ID | Criterion (short) | Tests | The wrong program it fails on |
|---|---|---|---|---|
| 1 | `#3165.8f9dd502` | both parents add a path at the same place in `scripts/lanes.mjs`; keeping both passes with no approval | main's line first; the change's line first | a guard that refuses every conflict in a check file: the base |
| 2 | `#3165.63b30585` | dropping one parent's line, adding a third line, and removing a line both hold each fail, naming the file and the merge commit | drop main's; drop the change's; a third line; a common line removed; two common lines swapped (Reading 5) | a guard that checks only that no line was removed passes the third-line merge; one that lets a resolution equal to either parent through passes the two drops; one that checks only that no line is new passes the drops and the removal; one that compares the lines as sets passes the swap |
| 3 | `#3165.497038aa` | the same additive resolution in `scripts/proof-guard.mjs` and in a runner's config fails unapproved, naming the file | one merge in each file | a guard that applies the additive rule to every check file |
| 4 | `#3165.0b4ec1da` | each failing resolution passes with an approval naming `scripts/lanes.mjs` on the merge commit | the five resolutions of criterion 2, approved | a guard that refuses a resolution of `scripts/lanes.mjs` that isn't additive even as an approved proposal, or that no longer reads an approval on a merge commit |

## On the base

`BASE-FAILURE.txt` holds one run on `3c500c0c8`, local paths redacted: 14 tests, 2 fail, 12 pass.

- Criterion 1's two tests fail at their assertion: the guard exits 1 with `FAIL guard: scripts/lanes.mjs: the proof lanes' own code changed in resolving a merge conflict (commit …)`.
- Criteria 2 to 4 describe refusals and approvals the base already gives, so their 12 tests pass there. They hold the fix to the one resolution it lets through: each fails on a wrong program the table names, and none passes on a guard that prints nothing (a failing run needs a `FAIL guard:` line with the names, a passing one a `PASS guard:` line).

## Not covered

- Conflicts in a file a config names, tagged tests, fixtures and your decisions, which the Scope says "are judged as today": `tests/acceptance/569/`, `1115/` and the guard's own suites hold those rules, and no criterion here names a case.
- A parent that adds several lines, the same line added by both parents, a line a file holds twice, and a conflict of both an added and a changed line: the criteria name one added line a side.
- An unsigned approval or a stranger's on the merge commit: "who approves, and how an approval is signed and read, don't change", and #569's tests hold that.
- The Proof's pasted output from the guard lane on real merges.

## Files

- `helpers.mjs`: the planted merge and the three files' texts.
- `guard.test.mjs`: the 14 tests.
- `BASE-FAILURE.txt`: the run on the base.
