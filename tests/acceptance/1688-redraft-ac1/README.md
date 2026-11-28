# Acceptance tests for #1688, blind redraft of AC1's clean run: every package source in the change

Written blind at commit `923842f72` (base `e87cefc44` plus the blind suite `tests/acceptance/1688/`, nothing that
implements #1688), from issue #1688, the design, that suite and that base. The drafting job saw no work that implements
#1688: no other commit, branch, worktree or pull request. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft by this job (design: Dogfooding). Nothing here edits `tests/acceptance/1688/`;
it stays as it is. Node's test runner and built-ins only; the `.mjs` files hold no comments (the comment ratchet's
ceiling for a new file is 0), so what they would say is here.

| AC | ID | Tests |
|---|---|---|
| AC1 | `#1688.e0a10d9d` | `ac1-clean.test.mjs`: "the lint passes on the change's files" (carried unchanged) and "the lint passes with every packages/*/src file in the change (redraft)" (redrafted harness, same meaning) |

AC1's plant test (`tests/acceptance/1688/ac1-plant.test.mjs`), AC2 and AC3 are not redrafted and stay in the 1688
folder as they are.

Run, from the repo's root, under Node 24:

```
node --test --test-concurrency=1 tests/acceptance/1688-redraft-ac1/ac1-clean.test.mjs
```

## Why a redraft

`tests/acceptance/1688/ac1-clean.test.mjs`'s second test, "#1688.e0a10d9d AC1: the lint passes with every
packages/*/src file in the change", widens the copy's merge base with `widenBase` in `tests/acceptance/1688/helpers.mjs`:
it reads `origin/main`'s tree into a temporary index (`GIT_INDEX_FILE`) and runs `git rm -q --cached -- <sources>`
against it. `git rm` compares each path's staged content with the work tree and with `HEAD`, and the copy's work tree
and `HEAD` are the change. So whenever the change edits a `packages/*/src` file, which any change meeting the Scope's
first bullet must, the temporary index holds the merge base's content, different from both, and git refuses:

```
git rm failed in a scratch copy: error: the following file has staged content different from both the
file and the HEAD:
    packages/asks/src/model.ts
(use -f to force removal)
```

`widenBase` throws before the lint runs, so the test fails in its own harness on every right change, whatever the lint
does. At the base no source file differed, so `BASE-FAILURE.txt` couldn't show it (and the test stops earlier there, at
"the lint exists").

**Reproduced here, with no implementation.** A copy made by the 1688 helpers' own `makeCopy` (checkout at
`923842f72`), then, as the change, `export const HOLD_MS` in `packages/asks/src/model.ts` becomes `const HOLD_MS`,
committed with the helpers' `commit`. The change then holds 12 files (the 1688 suite, this folder, that source). The
1688 `widenBase(repo, sandbox)` threw exactly the error above.

The test is redrafted, not edited: same criterion, same name up to the `(redraft)` suffix, same lint contract and same
pass rule; only how the widened history is built changes.

## The one change

`helpers.mjs`' `widenBase` builds the bare tree with index operations that never read the work tree: the merge base's
`packages/*/src` paths are listed from its tree with `git ls-tree -r -z --name-only <tree> -- packages/`, the tree is
read into a temporary index in the sandbox's `tmp`, and those paths leave it through
`git update-index -z --force-remove --stdin`, which removes an entry whatever the work tree or `HEAD` hold. Then, as
the 1688 helper does, `write-tree` gives the bare tree; three commits are made with `commit-tree` (the bare merge base;
the merge base on it; the change's tree on that) and `refs/heads/change` and `refs/remotes/origin/main` are moved to the
change and the bare merge base. The work tree and the copy's own index are never touched (the change's tree is
unchanged, so `git status` stays clean). The temporary index is removed even when a step fails.

One assertion is added before the lint runs, so a harness that widened nothing can't pass a lint that reads nothing:
every merge-base `packages/*/src` file must be in `git diff --name-only $(git merge-base HEAD origin/main)` of the copy,
and there must be at least one. Then the lint runs as in the 1688 test and must pass the same way.

**The harness, proved in a scratch run** (scratch script and a throwaway stand-in lint kept outside the repo, never in
it; on the copy above, with the dropped `export`):

- the 1688 `widenBase` throws the `git rm` error;
- this folder's `widenBase` then returns 494 merge-base `packages/*/src` files, 0 of them outside the change;
  `git status --porcelain` is empty; `HEAD:packages/asks/src/model.ts` still lacks `export const HOLD_MS`;
  `git merge-base HEAD origin/main` is the bare commit, whose tree holds 0 `packages/*/src` files;
- a stand-in lint run through the 1688 `run` (it reads the change as `scripts/lanes.mjs`' `changedPaths` does) printed
  `PASS unread-exports: 494 package source files in the change`, exit 0, which this test's pass rule accepts; the same
  stand-in told to print `FAIL unread-exports packages/asks/src/model.ts HOLD_MS` and exit 1 is rejected by it.

## The first test: carried, not redrafted

"#1688.e0a10d9d AC1: the lint passes on the change's files" doesn't widen anything and works on a change that touches
package sources (`makeCopy` puts each changed file back as the merge base has it, commits, then lays the change on top).
It is carried here unchanged, name and assertions, because the lanes swap by file: once
`tests/acceptance/1688/ac1-clean.test.mjs` is named in `redrafted`, it runs by hand only (`byHand`), and a test left only
there would drop out of the lanes. This is how `1352-redraft-3413` carries its Decided rows test.

## How this replaces the disputed file

By the mechanism in `scripts/lanes-lists.mjs` (read by `scripts/lanes.mjs`, `scripts/loads-lint.mjs` and
`scripts/proof-runs.mjs`' `prepareRuns`): a first draft that a blind redraft replaced is named in `redrafted` and pushed
onto `byHand`; `prepareRuns` runs no `byHand` file in any lane, so its tags prove nothing and this folder's tests carry
`#1688.e0a10d9d` in trace. The lines to add (an edit to `scripts/lanes-lists.mjs`, the implementer's or coordinator's,
under whatever approval that file needs; this job writes only this folder):

```js
redrafted['tests/acceptance/1688/ac1-clean.test.mjs'] = 'tests/acceptance/1688-redraft-ac1/';
byHand.push('tests/acceptance/1688/ac1-clean.test.mjs');
```

`tests/acceptance/1688/ac1-plant.test.mjs` also tags `#1688.e0a10d9d` and stays in the lanes.

## What was read

`AGENTS.md` (Proof); issue #1688; `docs/technical-design.md` (Dogfooding); all of `tests/acceptance/1688/` (README,
helpers, the four tests, `twins.json`, `BASE-FAILURE.txt`); `tests/acceptance/1352-redraft-3413/` (README, BASE-RUN.txt)
and the list of redraft folders for the house shape; `scripts/proof-change.mjs` (`criterionId`); `scripts/proof-runs.mjs`
(`prepareRuns`, the `byHand` rule); `scripts/lanes-lists.mjs` (`redrafted`, `byHand`, lane folders and `lane.json`);
`scripts/loads-lint.mjs` (how `redrafted` is read); `scripts/comment-ratchet.mjs` and `scripts/comment-source.mjs`.

## The surfaces

As the 1688 README states them, unchanged: the lint is `node scripts/unread-exports.mjs`, run from the copy's root with
no arguments, reading the change as `changedPaths` does (files differing from `git merge-base HEAD origin/main`,
committed or not, plus untracked unignored files) and checking its `packages/<package>/src/**` files; it passes with a
line starting `PASS unread-exports` and exit 0, and no line starting `FAIL`, `BLOCKED`, `INVALID` or `INCONCLUSIVE`. The
scratch copy is the 1688 helpers' `makeCopy` (imported, not copied), and the lint runs through their `run` with the
sandbox's HOME, TMPDIR and XDG folders. "The cleaned packages" keeps the 1688 reading: with the merge base minus every
`packages/*/src` file as `origin/main`, every package source file is in the change, and the lint must pass.

Imported from `../1688/helpers.mjs`: `CHECKOUT`, `LINT`, `LINT_NAME`, `makeCopy`, `run`, `shown`, `cleanEnv`. Their
`widenBase` is not used. No twin: both tests fail at the base at their first assertion, that the lint exists, as the
1688 tests do, and a wrong lint can't be kept as lines of a file that doesn't exist yet.

## At the base

`BASE-RUN.txt` holds the run at `923842f72`: 0 pass, 2 fail, both at `scripts/unread-exports.mjs ... does not exist`,
before any copy is made.
