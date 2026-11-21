# #33 AC8, blind redraft: the spine list (offline part)

Criterion `#33.9c912eb7`, verbatim:

> Once this repo is gated, each of the 25 spine tasks is judged again at its merged commit against its issue's
> criteria and the tests it landed; a spine task that doesn't reach PASS reopens before week 4 starts, naming the
> criterion

Written blind from the issue, the design (The verdict spine is the first exit; Dogfooding), AGENTS.md, this suite's
README and `helpers.ts`, the owner's answer of 2026-11-19 ("Keep GitHub's hash": the list names the merge commit
GitHub records), and the base `f6ddd396f`. The implementing agent does not edit these files.

## What it checks

`spine-list.test.ts` runs `node scripts/spine.mjs list` and judges its output with one function, `problems`:

1. The list exits 0.
2. Every non-blank line is `#<issue> <40-hex merged commit>` (this suite's README, The spine re-judge).
3. Each of "the 25 spine tasks" (`SPINE` in `../helpers.ts`, the `spine` label's list) is named, exactly once, and
   nothing else is named.
4. Each named hash is a commit object in this checkout. A hash with no object here is reported `BLOCKED`: nothing
   can be judged at a commit that isn't there, and missing never passes.
5. "Its merged commit": the commit landed on main. It is in main's (`origin/main`) history, or, since the
   2026-11-09 rewrite kept trees and changed hashes, main's first-parent line holds its rewritten copy: a commit
   with the same tree, author name and email, author time and full message. That is how GitHub's recorded merge,
   outside main's history, is accepted (the owner's answer), while a commit that main never merged is not.

## How a row is decided

A row passes when its line has the format, its issue is a spine task named once, its hash is a commit here, and
rule 5 holds. The test passes only when no row and no list-level rule (exit, missing or extra tasks) gives a problem.

## Proof the test isn't empty

Nine planted wrong lists, each a copy of the real output with one thing wrong, go through the same `problems` and
must be rejected for the reason planted: #44 left out; #33 added; #13 twice; a 12-hex hash; a hash with no object;
the merged commit's tree; the merge's second parent (the pull request's head, never itself merged); exit 1; no rows.
A control (the real rows reversed) must be accepted.

## What an offline test can't decide

- Whether a commit is the one that closed *that* issue (two tasks' commits swapped pass here). The PR-to-issue link
  is on GitHub; the live re-judge (`../spine.live.test.ts`) judges each task's criteria at the commit.
- Whether the list names GitHub's recorded hash or main's rewritten copy: both are commits main merged by rule 5,
  and GitHub's hashes aren't held in the repo's acceptance files, only in the program under test.
- That the spine is still the 25 the label lists today; `SPINE` is the list as this suite was written.
- The re-judge, its verdicts, the reopening and "before week 4 starts": live only.
