# Acceptance tests for #1604: tests wait for events, never for time to pass

These tests were drafted blind from issue #1604 ("Tests we write wait for events, never for time to pass"), `docs/technical-design.md` (How we know version 0 works, the Dogfooding and Repo guards bullets) and the base commit `b4a2049e8`, which has no wait guard. They follow #1432's suite, whose ratchet this issue copies. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft by this job.

Run them with Node 24:

```
node --test 'tests/acceptance/1604/*.test.mjs'
```

The suite needs no cargo: the Rust fixture is only read, never built. On the base all 10 tests fail, each because the lint lane has no wait-guard command, as `BASE-FAILURE.txt` shows. No test judges a wall-clock budget, since the issue states none, and nothing here waits on a timer.

## Surfaces

- The lint lane's wait-guard command, from `scripts/lanes.mjs`'s exported `checks`. It's the `lint` lane's command `[process.execPath or 'node', 'scripts/wait-ratchet.mjs', …]`. The tests run that command as the lane lists it, as a process with cwd at the checkout it checks. That checkout is either a scratch git repository or this checkout, read-only.
- `scripts/wait-ceilings.json`, the checked-in counts. Each scratch repository gets its own copy, and the checkout test reads this checkout's copy.
- `testPaths` from `scripts/lanes.mjs`, the repo's declared test paths, which say which files are test files.

Scratch repositories live under the system temporary folder, realpathed. Their git commands run with `-c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null`. Everything is removed in `t.after`. Nothing is written into this checkout.

## Readings where the issue leaves a choice

1. **Script and counts file.** The issue names neither. The tests use `scripts/wait-ratchet.mjs` beside `scripts/wait-ceilings.json`, the same pairing as `scripts/size-ratchet.mjs` with `scripts/size-ceilings.json`. It's a command of its own in the lint lane, not part of the size ratchet, which stays in the lane. Extra arguments are allowed. Inline code (`-e`, `--eval`, `-p`, `--print`) is not.
2. **"Fails the lint lane".** As in #1432's suite, the tests run the lane's command directly, not through `runLanes`, whose throttle wrapper can wait up to 30 minutes for a build grant. `runLanes` takes its `FAIL lint: …` summary from the first FAIL line, so the guard's FAIL line is what the lint lane names.
3. **Which files are test files.** A test file is a file git lists in the work tree, tracked or untracked and not ignored, read from disk, whose repo-relative path matches one of `testPaths` (`tests/**`, `packages/**/test/**`, `packages/**/*.test.ts`, `crates/*/tests/**`). Helpers and fixtures under those paths count, and so do acceptance files. The plants are JavaScript or TypeScript (`.ts`, `.mjs`) and Rust (`.rs`). Other languages, and Rust `#[cfg(test)]` modules under `src/`, are left to the implementation.
4. **What counts.** Each of these counts as one finding, at the line that holds it:
   - A fixed wait: a call to `sleep(…)`, `thread::sleep(…)` (or `std::thread::sleep(…)`), `Atomics.wait(…)`, or a timer such as `setTimeout(…)` that isn't marked as a deadline (reading 5). Importing a function named `sleep` is no wait, so `import { sleep } from './helpers'` doesn't count. Only the call does.
   - An assertion on the difference of two wall-clock reads, such as `assert.ok(Date.now() - start < 50)` or `expect(Date.now() - start).toBeLessThan(50)`.
   - A file's count is its number of findings, both kinds together. The issue calls these "counts of fixed waits", but today's files hold wall-clock assertions too, and acceptance files can't be edited, so the ratchet has to hold both.
   - Whether text inside a string literal or a comment counts is left to the implementation. This suite writes its planted waits as strings. If the guard counts those, this suite's files sit in the counts like any other suite drafted before the guard lands.
5. **How a deadline is marked.** A deadline that only bounds a wait carries a `// deadline: <reason>` comment. It goes on the timer's line, or in the `//` comment lines just above it. That's the same placement as the blocking-call guard's `// blocking call: <why>`, and it's the same in Rust. The reason is required and has to be non-blank: `// deadline:` alone doesn't mark. A marked timer isn't a finding. The same timer with no marker, or with a blank reason, is a finding at the timer's line. An allowed exception carries its reason (Scope), so an unmarked deadline counts even when its timer rejects. For example:

   ```ts
   const deadline = new Promise((_, reject) => {
     // deadline: turns a hang into a failure when the ready event never comes
     setTimeout(() => reject(new Error('no ready event within 30 s')), 30_000);
   });
   await Promise.race([ready, deadline]);
   ```

6. **The counts layout.** One JSON object maps each test file's repo-relative POSIX path to its ceiling, a whole number of at least 1. Only files with at least one finding are listed, and a file that isn't listed has a ceiling of 0, so a new file or suite starts at zero. Lowering a count to zero means removing the file's entry. The guard reads the work tree's copy, so a ceiling lowered but not committed counts.
7. **"May drop, never rise".**
   - A file's bound is its ceiling in the work tree's counts file. When `origin/main` exists and the counts file is at the merge base of `HEAD` with it, the bound is the lower of the work tree's ceiling and the merge base's (0 where the merge base doesn't list the file).
   - So a change that raises a ceiling, or gives a new file or suite a ceiling of its own, still fails. Before the guard lands there's no counts file at the merge base, so the work tree's counts are the only bound.
   - A count over its bound fails. A count under its work-tree ceiling fails until the ceiling is lowered to the count in the same change. A one-finding drop is enough, so there's no slack, as in #1432's shrink rule.
8. **What the guard prints.**
   - Every failure is a line that starts with `FAIL `.
   - A finding in a file with a bound of 0 (a new file or suite) gets a FAIL line holding `<path>:<line>`, the repo-relative path and the finding's 1-based line. A `:<column>` may follow. For example: `FAIL waits: packages/fixture/test/sleep.test.ts:7: await sleep(200) is a fixed wait; wait for the event the test needs`.
   - A listed file over or under its bound gets a FAIL line holding its path. Its counts and line numbers are welcome, but not required.
   - A FAIL exits 1. A pass prints a line that starts with `PASS ` and exits 0, with no FAIL, INVALID, BLOCKED or INCONCLUSIVE line. A silent exit 0 doesn't count as a pass (invariant 2).
   - A FAIL elsewhere never names a file that's at its ceiling.
9. **"Naming the suite".** The FAIL line holds the suite's folder, `tests/acceptance/<n>/`. The path of the finding's file inside it does that.
10. **The scratch repositories.**
    - Each one holds a copy of every flat file in this checkout's `scripts/`, so the guard can import its siblings, such as `testPaths` from `lanes.mjs`. `.git/info/exclude` hides that folder from git's listing.
    - Each one holds `packages/fixture/test/listed.test.ts` with two `await sleep(…)` calls, and `scripts/wait-ceilings.json` giving that file a ceiling of 2. The ceilings file is force-added. Both are committed, and `origin/main` points at that commit, so the merge base is that commit and lists the file at 2.
    - Each plant is an uncommitted file or edit.
11. **Twins.** Every plant runs after its clean twin passed in the same repository. The twin is the same file waiting for its event (`await server.started`, `await once(server, 'ready')`, `await job.done`) or asserting its result instead of the elapsed time. So a guard that fails everything fails the twin, and one that passes everything fails the plant.
12. **"Passes on this checkout".**
    - The lane's command runs in this checkout and has to pass, and `git status --porcelain=v1 --untracked-files=all` must be the same before and after. `scripts/wait-ceilings.json` must be tracked.
    - The test also checks the counts with an oracle of its own, without the script. Every entry is a test path (reading 3) that's a file in the work tree, with a whole-number count of at least 1.
    - Three acceptance files that hold a fixed wait in code at the base must be listed with a count of at least 1. They were read by hand, and acceptance files are never edited, so they keep their waits: `tests/acceptance/1015/focused.test.ts` (`await sleep(1000)`, line 26), `tests/acceptance/1808/shown.test.ts` (`setTimeout(resolve, 800)`, line 55) and `tests/acceptance/172/reproducible.test.ts` (`Atomics.wait`, line 65).

## Criteria and tests

Each test that proves a criterion starts its name with the criterion's tag, `#1604.<id>`, where `<id>` is the first 8 hex digits of the SHA-256 of the criterion's text from the issue, trimmed with white space collapsed (`criterionId` in `scripts/proof-change.mjs`). The scope-only tests carry no tag.

| Tag | Acceptance criterion | Tests (file: name) |
|---|---|---|
| `#1604.e0bddde0` | AC1: a planted test that sleeps 200 ms before it asserts fails, naming file and line; a `setTimeout(`-only lane fails this test | waits: *#1604.e0bddde0 AC1: a planted test that sleeps 200 ms before it asserts fails the lint lane, naming the file and line; the twin that waits for its event passes* (`await sleep(200)`); waits: *#1604.e0bddde0 AC1: a planted test that awaits setTimeout(resolve, 200) …* |
| `#1604.8009d080` | AC2: a planted wait bounded by a deadline that rejects passes | waits: *#1604.8009d080 AC2: a planted wait bounded by a deadline that rejects when it expires passes when marked with its reason; unmarked, or marked with no reason, it fails naming the line* |
| `#1604.4b29272e` | AC3: a listed file whose count rises by one fails, naming it; one whose count drops lowers its ceiling in the same change | ratchet: *#1604.4b29272e AC3: a listed file whose count rises by one fails the lint lane, naming it, and raising its ceiling in the same change doesn't help; at its ceiling it passes*; ratchet: *#1604.4b29272e AC3: a listed file whose count drops fails, naming it, until its ceiling is lowered to its count in the same change* |
| `#1604.713def46` | AC4: a planted assertion that `Date.now() - start` is under 50 fails, naming the line | waits: *#1604.713def46 AC4: a planted assertion that Date.now() - start is under 50 fails the lint lane, naming the line, in assert and expect form; the twins that assert the result pass* |
| `#1604.e6067c7d` | AC5: a planted new acceptance suite with one fixed wait fails, naming the suite | waits: *#1604.e6067c7d AC5: a planted new acceptance suite with one fixed wait fails the lint lane, naming the suite, even with a ceiling of its own; its twin with no wait passes* |
| none | (Scope) the rule covers `thread::sleep` in our own test files | waits: *a planted Rust test that calls thread::sleep fails the lint lane, naming the file and line; the twin passes* |
| none | (Scope) a lint-lane rule; today's files listed with their counts | ratchet: *the lint lane runs scripts/wait-ratchet.mjs as a command of its own, beside the size ratchet*; ratchet: *on this checkout the guard passes without changing git status, and the checked-in ceilings are the checkout's own* |

## On the base

Every test fails because the lint lane has no `scripts/wait-ratchet.mjs` command. None is a regression check.

## Not covered here

- "Code that reads time gets the clock injected." That's a direction for how tests get rewritten, and no criterion plants it.
- A suite that fails the rule going to its blind redraft. That's the Dogfooding flow, not the guard.
- Other forms of the same waits: `setInterval`, `timers/promises`, `tokio::time::sleep`, `performance.now()` differences, and shell `sleep`. The guard may count them, but no fixture depends on it.
- A count dropping to zero, which means removing the entry (reading 6).
- Vendored or generated files under the test paths.
