# Acceptance tests for #2487: the guard sees an edit of another issue's tagged tests

I drafted these tests blind from these sources:

- issue #2487, as saved verbatim for this job
- `docs/parallel-proof.md`, sections 10, 10a and 11
- the Dogfooding part of `docs/technical-design.md`
- AGENTS.md
- the base commit `9905e7428` (origin/main), which has no implementation

At the base I also read `scripts/proof-guard.mjs`, `proof-change.mjs`, `proof-approvals.mjs`, `proof.mjs` and
`proof-runs.mjs`, to learn their surfaces, and `tests/acceptance/1872/` (README, helpers, tests, `twins.json` and its
twin) for its conventions. The helpers are written here, adapted from 1872's, never imported from it; they import only
`tests/fixtures/approver.mjs`, for throwaway keys and signed tags. Per AGENTS.md, the implementing agent doesn't edit
these tests. A dispute goes to a blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing
node --test 'tests/acceptance/2487/*.test.mjs'
```

Node 24. They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. All are offline and run
on real processes: the real `node scripts/proof.mjs guard`, real `ssh-keygen` signature checks and real `git`. Nothing
is stubbed.

Every test has its own temporary folder, points `HOME` into it and unsets the `DEEP_*` variables 1872 unsets, and
`DEEP_GATES`. Each process a test starts gets its own process group, stopped by its PID when the test ends. Nothing is
killed by name or port. Each test has 300 s: a guard run takes seconds on an idle machine and far longer on a loaded
one.

## Criteria and tags

Each tag is the criterion's ID as `scripts/proof-change.mjs` computes it: `#2487.` and the first eight hex digits of
the SHA-256 of the criterion's line after `- [ ] `, trimmed, white space collapsed. Each test's name starts with its
tag, and each is a top-level `test(...)` with a literal name and no subtests.

| Tag | Criterion | File | Tests |
|---|---|---|---|
| `#2487.1131a9b0` | 1. A commit that deletes or changes a test tagged for an issue other than the one the change names fails the guard without its own approved proposal | `refused.test.mjs` | 5: a whole file of four tagged tests and its three fixtures deleted; a tagged test's assertion weakened; one of two tagged tests deleted; the file deletion under an unsigned tag; the file deletion under a signed tag in a commit that carries other code too |
| `#2487.1131a9b0` | 1, wherever the tagged test lives | `elsewhere.test.mjs` | 3, added 2026-11-21, each with no approval tag: a file of two tagged tests deleted from a package's test folder; a tagged test weakened in a file colocated with a package's source; one of two tagged tests deleted from a file at the top of `tests/` |
| `#2487.1131a9b0` | 1, "without its own approved proposal" | `approved.test.mjs` | 2: the file deletion, and the weakened test, each as its own commit under a signed tag naming it, pass |
| `#2487.8f2af318` | 2. A change that edits only its own issue's untagged or added tests still passes | `own-tests.test.mjs` | 5: an untagged test's line changed; an untagged test deleted; a file of tagged tests added; a tagged test added beside the untagged ones; an untagged test file added, then edited in the next commit |

## The guard

As 1872's tests run it: a scratch repository whose `main` holds a stand-in `scripts/proof-guard.mjs` (so the proof
lanes are on main) and `.deepbuild/approvers` listing a throwaway maintainer key; `origin/main` points there, and the
change is on branch `change`. This checkout's real `node scripts/proof.mjs guard` runs in that repository. Approval
tags are annotated tags under `deep/approved/`, signed with the SSHSIG bytes `tests/fixtures/approver.mjs` makes, or
unsigned.

Two issues are planted, each a file in a folder `DEEP_PROOF_ISSUES` names, each with one criterion:

- **#9044**, the issue every scratch change names: each commit's message ends `Part of #9044` (one test says
  `Closes #9044`). Main holds its test file `tests/acceptance/9044/mine.test.mjs`, two tests with no tag.
- **#9350**, the other issue. Main holds its suite, every test carrying #9350's criterion tag (computed from the
  planted criterion by the same rule): `tests/acceptance/9350/staged.test.ts`, four tests reading three fixtures under
  `tests/acceptance/9350/fixtures/`, the shape of the file commit 1a0338eb06d7 deleted; and
  `tests/acceptance/9350/kept.test.mjs`, two tests.

- **Refused** means: a line starting `FAIL guard:`, a non-zero exit, and a `FAIL guard:` line holding the test file's
  path.
- **Passed** means: no `FAIL guard:` line, exit 0, and a `PASS guard:` line. For a commit passed by its signed tag
  (`approved.test.mjs`), a `PASS guard:` line must also hold the test file's path, the way the guard already reports an
  edit it judged by an approved proposal, so a guard that never looked at the file doesn't count as passing it.

## Readings of the issue

- **"Names the test/file."** The issue's criterion says only "fails the guard". A refusal is read as one that says
  what it refuses: a FAIL line holding the edited test file's repo path. The tests don't ask for the test's name, the
  criterion's tag, the commit or any wording, and nothing about the fixtures' own lines.
- **"A test tagged for an issue other than the one the change names."** The change names #9044 in every commit; the
  edited tests carry `#9350.<id>` in their names. The three edits: the file with its fixtures deleted (the second of
  three commits, as the issue saw `3 commits checked`); one test's assertion weakened in place, its name and tag
  kept; one of a file's two tagged tests deleted.
- **Wherever the test lives** (added 2026-11-21, after a review). Every test of #9350 above sits in
  `tests/acceptance/9350/`, where folder and tag agree, so a guard that kept other issues' tags only under
  `tests/acceptance/<n>/` passed all 12 tests. The criterion names a tagged test, not a folder: in
  `elsewhere.test.mjs` main also holds `packages/planted/test/held.test.ts`, `packages/planted/src/held.test.ts` and
  `tests/held.test.mjs`, each of two tests carrying #9350's tag, in places `scripts/lanes.mjs`'s `testPaths` cover at
  the base, and the change naming #9044 deletes the first, weakens a test of the second and deletes one test of the
  third. The file adds them to the helpers' scene with one more commit on main; `helpers.mjs` is unchanged.
- **"Without its own approved proposal."** As the guard's own Fix line states it: the edit as its own commit that
  touches only the files its approval names, approved by an SSH-signed tag under `deep/approved/` with `Approves:
  <path>` or `Approves: <path> › <test>`. So three things are refused: no tag; an unsigned tag naming every file; a
  signed tag naming the deleted files on a commit that also changes `src/planted.mjs`. And two pass: the deletion as
  its own commit under a signed tag with `Approves: <path>` for the test file and each fixture, and the weakened test
  under a signed tag with `Approves: <path> › <test>`.
- **"Edits only its own issue's untagged or added tests" (criterion 2)** is read as two kinds of edit, each by a
  change that names #9044 and carries no tag: an edit of an untagged test in #9044's folder (a line changed, a test
  deleted), and a test the change adds (a new file of tests carrying #9044's tag, a tagged test added beside the
  untagged ones, and an untagged test file the change adds and then edits in a later commit). Main holds #9350's
  tagged tests throughout, untouched. Not tested, since the criterion says "still passes" and the base refuses it: an
  edit, in a later commit, of a test the change added that carries its own issue's tag.
- **Out of scope here.** The issue's "Not checked" (a stacked change that legitimately touches a parent issue's
  tests) names no expected value, so no test. A merge conflict's resolution, a skipped test, a fixture edited alone
  and uncommitted changes are edits the guard judges elsewhere; the criteria name a commit that deletes or changes a
  test.

## On the base

15 top-level tests, no subtests. The 10 of criterion 1 fail at a `node:assert` assertion thrown under
`tests/acceptance/2487/` (helpers.mjs's `expectRefused` or `expectPassed`): the base guard keeps only `#9044.` tags, so
it prints `PASS guard: N commits checked` for each edit of #9350's tests, and names no file for the approved ones.
The 3 of `elsewhere.test.mjs` also fail, at the same assertion, on a planted guard that keeps other issues' tags only
under `tests/acceptance/<n>/`, which the 12 earlier tests pass (`BASE-FAILURE.txt`, the section added 2026-11-21).

The 5 of criterion 2 pass on the base, as they must after the fix too. They prove their criterion only through a
planted wrong program: `twins.json` names `every-test-edit-refused` for `#2487.8f2af318`, and
`twins/every-test-edit-refused/scripts/proof-guard.mjs` is the base's guard with one statement added, which refuses
every commit that adds, changes or deletes a test file, whatever its tags, without an approved proposal. On a copy of
the tree with that file laid over `scripts/proof-guard.mjs`, each of the 5 fails at `expectPassed`'s assertion. See
`BASE-FAILURE.txt`.
