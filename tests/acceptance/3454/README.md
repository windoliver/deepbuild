# Acceptance tests for #3454: the comment ratchet and the comment-only check

These tests were drafted blind from issue #3454, `docs/technical-design.md` (Repo guards, Dogfooding, the reference Macs), `AGENTS.md` and the base commit `338f6dfe7`, which has no comment ratchet and no `scripts/comment-only.mjs`. They follow #1432's and #1604's suites, whose rules this ratchet copies. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

Run them with Node 24, after `npm ci` (the oracle and the scratch repositories read the `typescript` package):

```
node --test 'tests/acceptance/3454/*.test.mjs'
```

The suite needs no cargo: the Rust and WGSL fixtures are only read. On the base all 20 tests fail, each at an assertion, because the lint lane has no comment-ratchet command or the checkout has no `scripts/comment-only.mjs`, as `BASE-FAILURE.txt` shows. Nothing here waits on a timer; the timers and comments in the fixtures are text written into scratch files.

`budgets.test.mjs` judges a wall-clock budget, so it belongs on the `timed` list in `scripts/lanes.mjs`. This job doesn't edit scripts, so the implementing agent adds it there.

## Surfaces

- The lint lane's comment-ratchet command, from `scripts/lanes.mjs`'s exported `checks`. It's the `lint` lane's command `[process.execPath or 'node', 'scripts/comment-ratchet.mjs', …]`. The tests run that command as the lane lists it, as a process with cwd at the checkout it checks. That checkout is either a scratch git repository or this checkout, read-only.
- `--write`, given as one more argument after the lane's own.
- `scripts/comment-ceilings.json`, the checked-in counts. Each scratch repository gets its own copy, and the checkout test reads this checkout's copy.
- `node scripts/comment-only.mjs <path>`, run as a process with cwd at the checkout it checks, `<path>` relative to it.

Scratch repositories live under the system temporary folder, realpathed. Their git commands run with `-c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null`. Everything is removed in `t.after`. Nothing is written into this checkout.

## Readings where the issue leaves a choice

1. **"Fails the lint lane".** As in #1432's and #1604's suites, the tests run the lane's command directly, not through `runLanes`, whose throttle wrapper can wait for a build grant. The command is one of its own in the lane, beside the size and wait ratchets; extra arguments are allowed, inline code and a standing `--write` are not.
2. **What the guard prints.** As its siblings do. A failure is a line that starts with `FAIL ` and exits 1. A pass prints a line that starts with `PASS ` and exits 0, with no FAIL, INVALID, BLOCKED or INCONCLUSIVE line; a silent exit 0 is no pass (invariant 2). A FAIL elsewhere never names a file that holds its ceiling or is out of scope.
3. **"Naming the file, its count and its ceiling".** For a listed file over its ceiling, one FAIL line holds the file's repo-relative path, its count and its ceiling, each a whole number with or without a thousands comma; the words around them are free. This is asked of the TypeScript, the Rust and the WGSL plant, each in a listed file at its ceiling. For every other failure (a file the list doesn't hold, a dropped count, a raised ceiling, a marker with no reason) the tests ask only for a FAIL line holding the path. Line numbers and counts there are welcome, not required.
4. **The counts layout.** One JSON object maps each file's repo-relative POSIX path to its count of comment lines, a whole number of at least 1. A file with no comment has no entry, so "drops the entry" means the key is gone, not set to 0. The guard reads the work tree's copy, so a ceiling lowered but not committed counts.
5. **Which files.** The files git lists in the work tree, tracked or untracked and not ignored, read from disk, so a planted comment is an uncommitted edit or an untracked file. The fixtures use `.ts`, `.js`, `.mjs`, `.rs` and `.wgsl`; the other extensions the issue lists get no fixture.
6. **What a comment line is.** A line counts when any part of a comment is on it: a line comment, a comment after code, each line of a block comment, a block inside a line of code. No fixture holds a blank line inside a block comment, a Rust doc comment (`///`, `//!`) or a nested block comment, so those are left to the implementation. The Rust fixture's `//` inside a string sits on a line with no comment (Scope: comments are found by token). The token fixture holds a `//` in the issue's string, in two regular expressions (one ends in `\//`, one holds `[//*]`) and in a template, which also holds a `/*`.
7. **"May drop, never rise".** A count under its work-tree ceiling fails until the ceiling is lowered to the count; a one-line drop is enough. A file's bound is the lower of its work-tree ceiling and the merge base's with `origin/main` (0 where the merge base doesn't list it). So a comment planted together with a ceiling raised to match still fails, and so does a new file given a ceiling of its own.
8. **`--write`.** After it, the ceilings file holds each dropped file at its count, has no key for a file with no comment left, and leaves an unchanged file's entry as it was; a plain run then passes. Its own exit code and output are left to the implementation. "A ceiling raised … by `--write`" is read through the lane: after `--write` on a change whose count rose, the plain run still fails, naming the file. Whether `--write` refuses, or writes a number the merge base then overrules, is left open.
9. **The marker.** `// deadline: bounds the wait` is planted in a file under a test path (`packages/fixture/test/`, where the wait ratchet reads the marker), in a file the list doesn't hold, so one counted line would fail it. "Beside a timer" is tested both ways the wait ratchet takes the marker: on the `//` line just above the timer and on the timer's line. "With no reason" is `// deadline` as the issue writes it, in both places, and `// deadline:` with nothing after the colon. The other five markers, and "the commented lines next to it", get no fixture.
10. **The license notice.** Two `//` lines at the top of a file, in the form the repo's ported files use: `// Copyright (c) 2026 the Fixture contributors (…).` then `// Licensed under the Apache License, Version 2.0: …`. How a notice is told from another comment is left to the implementation; the test's counter-plant is two lines with no word of license, copyright or author in them.
11. **Out of scope.** Each exempt file holds five ordinary comment lines and has no ceiling.
    - Generated: a `.ts` file named `shapes.generated.ts` whose first line says `@generated … Do not edit.`, the markers the size ratchet reads. Its counter-plant is a hand-written file beside it, `shapes.ts`, so a rule by name or by marker fits both.
    - `vendor/`: a file under the top-level `vendor/` folder.
    - `tests/acceptance/`: a suite's file that is part of the base commit, so it has landed. Whether a suite's new file is judged in the change that adds it, as the size and wait ratchets do, or is out from the start, is left open; the issue says only that the folder is out of scope.
12. **`scripts/comment-only.mjs`.** A pass is exit 0 with a `PASS ` line and no line in another state; a failure is exit 1 with a `FAIL ` line holding the changed file's path. Each change is committed on top of the base with `origin/main` left at the base, so the files changed since the merge base are the same whether the script reads `HEAD` or the work tree. A code edit outside `<path>` doesn't fail the run for `<path>`, and does fail the run for its own folder. Removing `/* of */` from `typeof/* of */b` passes when a space takes its place (`typeof b`, the same tokens) and fails when nothing does (`typeofb`). New, deleted, Rust and WGSL files get no fixture.
13. **The scratch repositories.**
    - Each one holds a copy of every flat file in this checkout's `scripts/`, so the guard can import its siblings, and a symbolic link `node_modules` to this checkout's `node_modules`, so it can load `typescript`. `.git/info/exclude` hides both from git's listing, so neither is counted.
    - The ratchet's repositories hold three listed files, each at its ceiling: `packages/fixture/src/totals.ts` (23 comment lines), `crates/fixture/src/lib.rs` (14) and `crates/fixture/src/fill.wgsl` (17), and `scripts/comment-ceilings.json` listing them, force-added. All are committed, and `origin/main` points at that commit, so the merge base lists them.
    - Every plant runs after its clean twin passed in the same repository, so a guard that fails everything fails the twin and one that passes everything fails the plant.
14. **AC7, on this checkout.**
    - The comment lines are counted by `oracle.mjs`, not by the ratchet: every `.ts`, `.mts`, `.cts`, `.tsx`, `.js`, `.mjs`, `.cjs` and `.jsx` file git lists under `packages/gate`, without a generated marker in its first five lines, parsed with the `typescript` package, a line counted when any part of a comment is on it. Markers and license notices are not taken out; `packages/gate` holds none at the base. The oracle reads 468 at `8f64ca337`, the issue's number, and 472 at the base `338f6dfe7`.
    - "Its merge base" is the merge base of `HEAD` with `origin/main`, read from git; now is the work tree. The test fails unless the merge base's count less the work tree's is at least 269.
    - On main itself the merge base is `HEAD`, so there the work tree is read against `338f6dfe7`, the base this suite was drafted on. The change's own merge base may be a later commit with another count; the suite can't name it.
    - With no `origin/main`, or in a repository that doesn't hold the commit to read, the test skips with `INCONCLUSIVE: …`, never a pass.
    - `node scripts/comment-only.mjs packages/gate` runs in this checkout and has to pass (reading 12).
15. **AC8, the time added.**
    - The time the ratchet adds is the wall time of the lane's command on this checkout, from spawn to exit, node's start included; the median of three runs, each of which must pass. The lane's throttle wrapper isn't counted: it costs the same for every command.
    - The budget counts only on a reference Mac (Mac15,7 / M3 Pro / 36 GiB, Mac15,12 / M3 / 16 GiB, Mac17,10 / M5 Max / 64 GiB), on mains power, with Low Power Mode off and the thermal state nominal, read as `tests/acceptance/159/helpers.ts` reads them. There a median of 10 s or more fails. Anywhere else the test skips with `INCONCLUSIVE: …` and the reading, never a pass. The one-minute load is printed with the reading and doesn't gate.
    - The Mac this was drafted on (Mac18,1) is not on the list, so the test reads INCONCLUSIVE there once the guard exists.

## Criteria and tests

Each test that proves a criterion starts its name with the criterion's tag, `#3454.<id>`. The two scope-only tests carry no tag.

| Tag | Acceptance criterion | Tests (file: name starts) |
|---|---|---|
| `#3454.7c3ae88a` | AC1: a planted comment fails in a listed file at its ceiling, in an unlisted file, in Rust and in WGSL; a `//` in a string, a regular expression and a template is none | ratchet: *… a comment planted in a listed file at its ceiling …*; *… in a file the list doesn't hold …*; *… in a Rust file at its ceiling …*; *… in a WGSL file at its ceiling …*; *… the // in 'https://example.invalid//x' …* |
| `#3454.7b17acdf` | AC2: a dropped count fails until its ceiling is lowered; `--write` lowers it and drops an emptied file's entry | ratchet: *… a file whose comments dropped fails, naming it, until …*; *… --write lowers the ceiling …* |
| `#3454.ba67856c` | AC3: a ceiling raised above the merge base's fails, by hand or by `--write` | ratchet: *… a ceiling raised by hand …*; *… --write can't raise a ceiling …* |
| `#3454.8e62c50b` | AC4: `// deadline: bounds the wait` beside a timer passes, a two-line license notice passes, `// deadline` with no reason fails | markers: *… a planted // deadline: bounds the wait …*; *… a two-line license notice passes …* |
| `#3454.c7f7a59e` | AC5: a generated file, a `vendor/` file and a `tests/acceptance/` file, each with comments, pass | markers: *… a generated file …*; *… a file under vendor/ …*; *… a file under tests/acceptance/ …* |
| `#3454.74c0b5ea` | AC6: `comment-only` passes a comment-only removal, fails a code edit and `typeofb` | comment-only: *… passes a change that removes only comments …*; *… passes typeof/\* of \*/b turned into typeof b …* |
| `#3454.b2b03e5f` | AC7: `packages/gate` holds at least 269 fewer comment lines than on its merge base, and `comment-only packages/gate` passes | gate: *… packages/gate holds at least 269 fewer …* |
| `#3454.355ba129` | AC8: the lint lane's time grows by under 10 s on the reference Mac | budgets: *… the comment ratchet adds under 10 s …* |
| none | (Scope) a lint-lane command; today's files listed with their counts | ratchet: *the lint lane runs scripts/comment-ratchet.mjs as a command of its own …*; *on this checkout the guard passes without changing git status …* |

## On the base

Every ratchet, marker and budget test fails because the lint lane has no `scripts/comment-ratchet.mjs` command. The comment-only and gate tests fail because the checkout has no `scripts/comment-only.mjs`. None is a regression check.

## Not covered here

- `docs/adr/`, the design's sentence, the AGENTS.md line and the skill: for diff review; no criterion plants them.
- Which of `packages/gate`'s comments went and which stayed (tautologies, stale ones, the three excuses, the decisions moved to `docs/adr/0002` to `0005`). AC7 counts lines and checks that only comments went.
- The count of 199 itself. AC7 is judged against the merge base, where the count has moved since `8f64ca337` (472 at this suite's base).
- The five markers other than `// deadline:`, and a marker's or a notice's neighbouring comment lines.
- A blind suite's file new in the change (reading 11), Rust doc comments, nested block comments, and `.mts`, `.cts`, `.tsx`, `.cjs` and `.jsx` files.
- `comment-only` over Rust, WGSL, new or deleted files.
