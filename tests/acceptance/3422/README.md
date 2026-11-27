# Acceptance tests for #3422: the size ratchet's Fix line says how to split a file

Issue #3422: "The size ratchet's Fix line says how to split a file". The Fix lines for a file over its limit or its ceiling say how: move one named concept to a file of its own, which imports what it needs by name. Nothing else changes.

Written first, blind, on November 26, 2026, at the base `35956a44a` (origin/main), by a job that saw only the issue, `docs/technical-design.md` (the Repo guards and Dogfooding bullets, and Built to be hard to get wrong) and the base commit. Per AGENTS.md, the implementing agent doesn't edit these files. A dispute goes to a blind redraft by this job.

## Run

```sh
node --test 'tests/acceptance/3422/*.test.mjs'
```

The tests use plain `node:test` and Node built-ins, with Node 24. They also need git, and a checkout with git history and `origin/main`, for the merge base. The suite takes about 7 s. Nothing is written in the checkout. Scratch repositories and the mirror live under the system's temporary folder (`deep-3422-*`), realpathed, and each test removes its own in `t.after`.

On the base 3 of the 6 tests fail, each at its assertion on the Fix line, as `BASE-FAILURE.txt` shows. The other 3 pass there, as they must: see On the base.

## Surfaces

- **The lint lane's ratchet command**, `[process.execPath, 'scripts/size-ratchet.mjs']`, taken from `scripts/lanes.mjs`'s exported `checks` and run as a process with cwd at the tree it checks. That tree is this checkout, read-only, or a scratch git repository.
- **What the ratchet prints**: each line in a state (`FAIL size: <path>: …`, `INVALID size: …`, the `PASS size: …` line), the path it names, the lines under it up to the next line in a state (its Fix line), and the exit code.
- **`scripts/size-ceilings.json`**, in each scratch repository's own copy.
- **The merge base's ratchet**, `git show <merge base of HEAD with origin/main>:scripts/size-ratchet.mjs` in this checkout, run the same way.

A scratch repository is built as #1432's and #3139's suites build theirs: a copy of this checkout's `scripts/`, which `.git/info/exclude` hides from git's listing; its own `scripts/size-ceilings.json`, force-added; and the planted files, committed, with `origin/main` at that commit. So the merge base is that commit, and a plant is an uncommitted edit or an untracked file. Git runs with `-c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null`, and git's `GIT_*` variables are removed from the environment of every git and ratchet process in a scratch repository.

## Criteria and tests

Each ID is `#3422.` and the first 8 hex digits of the SHA-256 of the criterion's text from the issue, trimmed, with white space collapsed (`criterionId` in `scripts/proof-change.mjs`). Each test's name starts with its ID.

| ID | Criterion | Tests (file: name after the ID) | On the base |
|---|---|---|---|
| `#3422.df5e60b4` | In a scratch repository, a file over its ceiling fails the ratchet, and its Fix line says to move one named concept out and to import by name. On the merge base the line says only to split or shrink, which fails this | fix-line: *a file a line over its ceiling fails the ratchet, and its Fix line says to move one named concept to a file of its own that imports by name; the Fix lines to lower a ceiling and to remove an entry say none of it* | fails |
| | (Scope: "over its limit") | fix-line: *a new file over 1,500 lines with no ceiling fails the ratchet, and its Fix line says …* | fails |
| | (the issue's account: `:90`) | fix-line: *a file grown with its ceiling raised to match fails the ratchet, and its Fix line says …* | fails |
| `#3422.2c41ea06` | On main the ratchet's findings before and after are the same paths with the same reasons. A finding that appears or goes fails this, naming its path | same-findings: *on this checkout the ratchet's findings are the same paths with the same reasons as the merge base's ratchet's, and git status is unchanged* | passes |
| | | same-findings: *in a scratch repository planted with each kind of finding, …; with none planted both pass alike* | passes |
| | | same-findings: *in a scratch repository whose ceilings file can't be read, …* | passes |

## Readings where the issue leaves a choice

1. **The wording rule.** The tests don't pin a sentence. The Fix text is every line under the finding's line up to the next line in a state, trimmed and joined with single spaces, so the advice may run over more than one line. It must start with `Fix: `, and hold each of these, in any order, letter case ignored (`ADVICE` in `helpers.mjs`):

   | Part | Pattern | From |
   |---|---|---|
   | to move | `\bmove\b` | the criterion: "to move one named concept out" |
   | one named concept | `\bone named concept\b` | the criterion's own phrase: one concept, not lines, and one with a name |
   | to a file of its own | `\bfile of its own\b`, `\bits own file\b` or `\bnew file\b` | Scope: "to a file of its own"; the criterion's "out". It is what rules out "a shared file that only one file reads" |
   | to import | `\bimport(s\|ed\|ing)?\b` | the criterion: "to import by name" |
   | by name | `\bby name\b` | the same; it is what rules out `use super::*` |

   The message of a failure lists the parts the line lacks and prints the finding with its Fix text. Nothing else is asked of the line: it may still give the number of lines to reach, and say "a ceiling never rises".
2. **Scope's second sentence.** "No `use super::*` in the new file, and no name moved to a shared file that only one file reads." The criterion asks for two things, the move and the import by name, and these are their two negatives. So the tests don't ask the line to spell out `use super::*` or "shared file"; a line that does passes. Whether it should is left to review.
3. **Which Fix lines.** Scope says "the Fix lines for a file over its limit or its ceiling", and the issue's account cites `scripts/size-ratchet.mjs:86-87` and `:90` as the lines that say only to split or shrink. So three findings get the advice, and each has a test under the first criterion's ID:
   - a file over its ceiling (the criterion's own case);
   - a file over 1,500 lines with no ceiling;
   - a file whose ceiling stands above the merge base's (`:90`): a file grown, with its ceiling raised to match. Its remedy is the same split.
4. **The other Fix lines.** "Nothing else". The Fix lines to lower a ceiling and to remove an entry ask for no split, so they hold none of `concept`, `by name` or `file of its own`. The first test checks both in the same run as its over-ceiling file. They are checked for the advice's words, not held to the merge base's text.
5. **"Fails the ratchet".** Exit 1, and one finding naming the file: a line that starts with `FAIL ` and holds the path, then the file's size and its ceiling (or the limit, or the merge base's ceiling), with or without a thousands comma. Before each plant the scratch repository passes: exit 0, a `PASS size` line, no finding.
6. **"On main".** The criterion's Proof is "its output on main before and after". A test can't stand on main before the change merges, so "main" is the tree the suite runs in: this checkout. At the base that tree has 16 findings (9 files over their ceilings, 7 over 1,500 lines with no ceiling), so the comparison is over something; once main passes the ratchet it is over nothing but the PASS line. So the same comparison also runs in scratch repositories that plant every kind of finding the merge base's ratchet has: over its ceiling, under its ceiling, at most 1,500 lines with an entry, a raised ceiling, new over 1,500 lines, generated with a ceiling, an entry for no file, and a ceilings file that can't be read. Each fixture test first asserts that the merge base's ratchet names each planted path once and no other, so a fixture that stops covering a kind fails rather than compares nothing.
7. **Before and after.** After is the lint lane's command with cwd at the tree. Before is the ratchet as the merge base of HEAD with `origin/main` holds it, read with `git show`, run with the same command over the same tree:
   - **In a scratch repository** it is written over the copy's `scripts/size-ratchet.mjs` for its run and the checkout's put back after. `scripts/` is hidden from git's listing there, so the swap changes nothing either ratchet judges.
   - **On this checkout** nothing may be written. The ratchet takes its root from its own place, the folder above `scripts/`. So it runs from a mirror: a temporary folder whose entries are links to this checkout's, but for a `scripts/` of its own, whose entries are links to this checkout's but for `size-ratchet.mjs`, which is the merge base's. Its git commands read this checkout through `GIT_DIR` and `GIT_WORK_TREE`, so they list this work tree's files, tracked and untracked, and each file is read through the mirror's links. `git status` in this checkout is the same before and after.
   - **In the proof lanes** each side's copy has a `.git` holding the repository's refs with HEAD at the change's head (`prepare` in `scripts/proof-runs.mjs`), so the merge base is the change's own there too.
   - **With no merge base** (no `origin/main`, or no ratchet at the merge base) there is no before. Each test throws `BLOCKED: …` and fails; none passes.
   - **A run that gave no verdict** (a crash, a silent exit, a PASS line beside a finding) is compared with nothing: the test fails, saying whose run it was. A run that is stopped or can't start throws `INCONCLUSIVE: …`.
8. **"The same paths with the same reasons".** A finding is a line that starts with `FAIL `, `INVALID `, `BLOCKED ` or `INCONCLUSIVE `. Its path is what follows `<STATE> size: ` up to the next colon or space. Its reason is the line whole, sizes and ceilings included. The Fix text under it is no part of the reason: it is what #3422 rewords. Order doesn't count. The test fails with one line per path whose finding appears, goes or changes its reason, each starting with the path. The exit code and the PASS line must be the same too: a ratchet that prints the same findings and exits 0 has lost them all.

## On the base

- The three `#3422.df5e60b4` tests fail at `assertSaysHow`: each finding is there with exit 1, and its Fix line says only to split or shrink, so all five parts are missing.
- The three `#3422.2c41ea06` tests pass: on the base the checkout's ratchet is the merge base's, so before and after can't differ. They are regression checks, and the before lane needs a planted twin of `scripts/size-ratchet.mjs` to fail them. This job writes no twin and no `twins.json`: both need the change. Checked in a throwaway copy of the base outside this checkout, deleted after (never committed): a ratchet that drops a finding, one that adds a finding and one that rewords a reason each fail the checkout test at its assertion, naming the path; the reworded reason fails the planted fixture test too; and a ratchet with only its three Fix lines reworded passes all six. `BASE-FAILURE.txt` holds those runs.

## Not covered here

- The exact sentence, and whether it names `use super::*` or a shared file (reading 2).
- The Fix lines of a generated file with a ceiling, of an entry for no file, and of a ceilings file that can't be read are not read for the advice's words; their findings are compared in `same-findings`.
- "No new lint, no count, no ceiling": for diff review. The lint lane's command list and `scripts/size-ceilings.json` are not compared with the merge base's.
