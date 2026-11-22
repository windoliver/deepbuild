# Acceptance tests for #1872: the proof guard covers main-watch.mjs, known-failures-check.mjs and every key of known-failures.json

I drafted these tests blind from these sources:

- issue #1872, as saved verbatim for this job
- `docs/parallel-proof.md`, sections 10, 10a, 11 and 12b
- the Dogfooding part of `docs/technical-design.md`
- AGENTS.md
- the base commit `8bfb6a633` (origin/main), which has no implementation

At the base I also read `scripts/proof-guard.mjs`, `proof-change.mjs`, `proof-approvals.mjs`, `proof.mjs`,
`affected.mjs`, `main-watch.mjs`, `known-failures-check.mjs` and `known-failures.json`, to learn their surfaces, and
`tests/acceptance/1115/` (README, helpers, `guard.test.mjs`) for its conventions. The helpers are written here, adapted
from 1115's, never imported from it; they import only `tests/fixtures/approver.mjs`, for throwaway keys and signed tags.
Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing
node --test 'tests/acceptance/1872/*.test.mjs'
```

Node 24. They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. All are offline and run
on real processes: the real `node scripts/proof.mjs guard`, real `ssh-keygen` signature checks, real `git`, and the
real `scripts/affected.mjs`. Stubbed, at boundaries #1872 doesn't own: `cargo` (first on `PATH` in the affected.mjs
tree) and the lint lane's own scripts in that tree, as 1115 stubs them.

Every test points `HOME` at a temporary folder and unsets the `DEEP_*` variables 1115 unsets. Each process a test
starts gets its own process group, stopped by its PID when the test ends. Nothing is killed by name or port.

## Criteria and tags

Each tag is the criterion's ID as `scripts/proof-change.mjs` computes it: `#1872.` and the first eight hex digits of
the SHA-256 of the criterion's line after `- [ ] `, trimmed, white space collapsed.

| Tag | Criterion | File | Tests |
|---|---|---|---|
| `#1872.d76cf8af` | 1. an edit of `scripts/main-watch.mjs`, and one of `scripts/known-failures-check.mjs`, each fail the guard with no signed tag, naming the file | `lanes-code.test.mjs` | 4: each file, with no tag and under an unsigned tag |
| `#1872.b7513f90` | 2. the same edit, as its own commit under a signed tag naming the file, passes | `lanes-code.test.mjs` | 2: each file |
| `#1872.28dfb26c` | 3. a commit adding its own failing test's ID to `failures` fails with no signed tag, naming the entry; passes under a signed tag naming the entry | `known-failures.test.mjs` | 3: no tag, unsigned tag, signed tag |
| `#1872.2f12ab89` | 4. raising a `lint` count, adding a `timing` ID, moving a `failures` date later each fail with no tag, naming the key; removing an entry or lowering a count passes with no tag | `known-failures.test.mjs` | 8: four loosenings, four tightenings |
| `#1872.845c651a` | 5. `node scripts/affected.mjs --record` on a fixture with a failing test leaves `scripts/known-failures.json` byte for byte as it was | `record.test.mjs` | 1 |

## The guard

As 1115's `guard.test.mjs` runs it: a scratch repository whose `main` holds a stand-in `scripts/proof-guard.mjs` (so
the proof lanes are on main), `.deepbuild/approvers` listing a throwaway maintainer key, and the files under test;
`origin/main` points there, and the change is on branch `change`, each commit saying `Part of #9872`. The planted
issue #9872 is a file named by `DEEP_PROOF_ISSUES`, and stands in for the open issue. This checkout's real
`node scripts/proof.mjs guard` runs in that repository. Tags are annotated tags under `deep/approved/`, signed with
the SSHSIG bytes `tests/fixtures/approver.mjs` makes, or unsigned.

- **Refused** means: a line starting `FAIL guard:`, a non-zero exit, and a `FAIL guard:` line holding every name the
  criterion asks for.
- **Passed** means: no `FAIL guard:` line, exit 0, and a `PASS guard:` line. For a commit passed by its signed tag
  (criteria 2 and 3), a `PASS guard:` line must also name the file, the way the guard already reports an edit it
  judged by an approved proposal, so a guard that never looked at the file doesn't count as passing it.

The planted edits of criterion 1 are loosenings of the files as this checkout holds them: `main-watch.mjs`'s
`paused` made to return no reds (landings never pause), and `known-failures-check.mjs`'s `DAYS` raised from 14 to
3650. Should either line move, a trailing `process.exitCode = 0;` stands in, which is still an edit of the file.

Criteria 1 and 3 also have a test for an **unsigned** tag naming the file or entry, which must fail as no tag does:
the criteria say "no signed approval tag".

## Readings of the issue

- **How an approval names an entry (criterion 3).** The guard's approval items are `Approves: <path>` and
  `Approves: <path> › <test>`. A `failures` entry is keyed by a test's ID, so the tag names it as
  `Approves: scripts/known-failures.json › <test ID>`, the second form with `known-failures.json` as the path. The
  commit under that tag touches only `scripts/known-failures.json`, so it is "its own commit" by the guard's rule.
- **"Its own failing test" (criterion 3).** The change's first commit adds a failing node test,
  `tests/fixture-1872/own.test.mjs › the change's own test`; its second commit lists that ID under `failures` with the
  note `fails on main (#9872, added <today>)`, today in UTC as `known-failures-check.mjs` reads it. Only the second
  commit is tagged, so the tag names exactly what that commit carries.
- **"Naming the entry" (criterion 3)** is read as: a FAIL line holding `scripts/known-failures.json` and the entry's
  test ID verbatim.
- **"Naming the key" (criterion 4)** is read as: a FAIL line holding `scripts/known-failures.json` and the top-level key
  (`lint`, `timing` or `failures`) as a word, found after the file's path is taken out of the line (the path itself
  holds `failures`). The fixtures' IDs and lint findings contain none of the three words, so only a line that names the
  key passes. A line that names the entry but not the key doesn't.
- **Criterion 4's cases.** On main the file lists one `failures` entry dated three days ago, one `lint` finding at 2
  and one `timing` ID. Refused with no tag: the count raised to 3; a new lint finding (a count raised from none, which
  the scope's "an entry added" covers too); a second `timing` ID; the `failures` entry's date moved to today. Passed
  with no tag: the `failures` entry removed, the `timing` ID removed, the `lint` finding removed, the count lowered
  to 1.
- **Criterion 5.** `--record` "goes", so the test doesn't say how affected.mjs answers the flag: it may refuse it or
  ignore it. It asserts only that the file's bytes are unchanged, after first running `affected.mjs <file>` with no
  flag to show the fixture's test does fail as affected.mjs reads it, so the scene isn't empty. The fixture's file has
  an entry under each key and a blank line of its own, so a rewrite of any part shows.
- **Out of scope here.** The issue's Scope also removes 1115's `--record` test as its own signed commit, and the PR
  carries a signed tag for `proof-guard.mjs`. Neither is an acceptance criterion of #1872, so neither is tested here;
  they're the PR's to show. The `skips` key's own rule is 1115's to test.

## On the base

18 top-level tests, no subtests. 14 fail at a `node:assert` assertion thrown under `tests/acceptance/1872/`. The 4
that pass are criterion 4's removal and lowering cases (`#1872.2f12ab89 a planted commit with a failures entry
removed / a timing ID removed / a lint entry removed / a lint count lowered passes the guard with no tag`): the base
guard asks no tag of those keys at all, so they pass on the base as they must after the fix too. They prove their
half of criterion 4 only through a planted wrong program that refuses them. See `BASE-FAILURE.txt`.

## Redraft

The first draft was disputed by the proof lanes (`node scripts/proof.mjs guard before trace`) on the change:

1. **trace:** every tag named no criterion of #1872. The draft's IDs (`8d212921`, `aa1738ec`, `51c82c1d`, `938914d1`,
   `0de0dcd9`) were not the hashes `proof-change.mjs` computes from the issue's criterion lines. The tags are now
   `d76cf8af`, `b7513f90`, `28dfb26c`, `2f12ab89` and `845c651a`, computed from the live issue with
   `readIssue`'s rule and checked by hand.
2. **before:** a tagged test must fail on the base at its own assertion. The draft's criterion 1, 2 and 4 tests ran
   their cases as `t.test` subtests, so on the base each top-level test failed as `ERR_TEST_FAILURE: 2 subtests
   failed`, which the lane reads as failing before its assertion. Each case is now its own top-level `test(...)`,
   made in a loop, carrying its criterion's tag, with no subtests.

Nothing else changed: the fixtures, planted edits, expected values, assertions and helpers are as drafted, and the
surfaces are still `node scripts/proof.mjs guard` in fixture repositories and `node scripts/affected.mjs --record`.
Test names now carry the case (the file, or the edit) so each top-level name is unique.
