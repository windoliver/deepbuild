# #33 AC8, blind redraft (offline part): the spine list names each spine task at its merged commit

Criterion `#33.9c912eb7`, verbatim:

> Once this repo is gated, each of the 25 spine tasks is judged again at its merged commit against its issue's
> criteria and the tests it landed; a spine task that doesn't reach PASS reopens before week 4 starts, naming the
> criterion

Written blind, by a job that saw only the issue's body, the design, `AGENTS.md` and the base commit, never the test
under dispute (`../spine.test.ts`). It covers only what can be read without GitHub or hours of runs: the list of
tasks and commits that the re-judge starts from. The live re-judge and reopening stay in `../spine.live.test.ts`,
untouched. The implementing agent does not edit these files (AGENTS.md, Proof).

## Sources

- **The issue, #33**: AC8 (above).
- **The design**, `docs/technical-design.md`, Dogfooding, "The verdict spine is the first exit": the spine is 25
  tasks, each carries the `spine` label; once the gate runs on this repo it judges each spine task again at its merged
  commit against its issue's criteria and the tests that task landed; one that doesn't reach PASS reopens before
  week 4 starts. `AGENTS.md`, Proof (planted twins; a test must fail on a wrong program).
- **The base commit** `f6ddd396f404cd5538ab7c8026b35838c7bd6cdb`: `scripts/spine.mjs` (header and `list`: one
  `#<issue> <merged commit>` line per task), `tests/acceptance/33/helpers.ts` (the `AC8` label),
  `../redraft-ac5/` for layout and `tsconfig.json`.
- **The owner's answer** to the question this test left open: "Keep GitHub's hash". A spine task's merged commit is
  the merge commit GitHub records for its PR. For a PR merged before the history rewrite of 2026-11-09, that commit is
  not in main's current history (main carries a rewritten copy with the same tree and a new hash); such a row is
  correct as it is and must not fail this test.

## How a row is decided (`rows.ts`)

Main's history is every commit reachable from `HEAD` (and `origin/main` when the clone has it). The output must have
exactly 25 non-empty lines, each `#<issue> <40 lowercase hex>`, no issue twice and no commit twice. Then each row's
commit:

1. must be a commit object in this repository (`git cat-file -t` says `commit`; a made-up hash or a tree fails);
2. passes if it is in main's history;
3. otherwise it is GitHub's pre-rewrite hash only if main holds a commit with the same tree, author name, author
   email, author date and subject (what the rewrite kept; it changed only hashes and committers), and the row's commit
   was committed on or before 2026-11-09. A commit with a main tree but other metadata, or a copy made after the
   rewrite, fails.

At the base, 10 rows are in main's history and 15 (#13, #17, #18, #22, #25, #29, #30, #31, #32, #44, #83, #236,
#237, #303, #304) are pre-rewrite GitHub merges whose copies main holds. All pass.

## Planted twins

Each twin is the list's real output with one row altered; each must be rejected, by the message named in the test:
`missing-task` (24 rows), `extra-task` (26 rows), `repeated-task`, `repeated-commit`, `malformed-line` (a 12-hex
hash), `made-up-hash`, `tree-not-commit` (HEAD's tree hash), `unmerged-commit` (a real commit with HEAD's tree that
main never merged), `copy-made-after-rewrite` (same tree, author, date and message as a pre-rewrite row, committed
2026-11-15). A control, a copy of the same row committed 2026-11-08, is accepted, so rule 3 is exercised both ways.
Planted commits go to a temporary object directory (the repo's objects as alternate), never into the repo.

## What this offline test cannot decide

- Which 25 issues carry the `spine` label, and so whether one real spine task was swapped for another: that needs
  GitHub (the live test).
- Whether a merged commit is its PR's merge rather than another commit main merged. #12's row, for example, is a
  non-merge commit in main's history (the header says it is the commit that landed #12's tests and fixes); offline
  it passes as merged.

## How to run

```sh
node node_modules/vitest/vitest.mjs run tests/acceptance/33/redraft-ac8/
node node_modules/typescript/bin/tsc -p tests/acceptance/33/redraft-ac8/tsconfig.json
```

Offline: no `gh`, no network, read-only git, about 10 s. The base run is in `BASE-RUN.txt`.
