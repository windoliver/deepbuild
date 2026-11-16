# Acceptance tests for #2174: deep-hook reads a path through a link that names itself

Written first, blind, from issue #2174 ("deep-hook: a path through a link that names itself is read, where the reader
now recurses until its stack runs out": its report, Scope, four acceptance criteria, table and Proof, as the brief gave
its body; it has no comments), the design and base commit `72fe11a11` ("Merge pull request #2523 …"), by a job that
never saw an implementation; none existed, and no other branch, worktree or pull request was read. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
Lean: one test per criterion in one file, Node built-ins only.

| AC | ID | Test in `self-link.test.mjs` |
|---|---|---|
| AC1 | `#2174.efc37644` | `deep-hook match` prints the line of an Edit that names a link to itself, and of a path through it, then reads the next call and is still up |
| AC2 | `#2174.1713a70d` | the forwarded hook allows `ls` and Read of the link, denies the same `ls` beside `pkill -f node` in that entry's words, and is timed against 50 ms |
| AC3 | `#2174.9080b65a` | both of the above on `a -> b`, `b -> a` |
| AC4 | `#2174.acad9277` | a Write or Edit through a link, and through links to that link, to an agent config that isn't there yet is denied naming `deep_propose` |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's line after `- [ ] `. Each test's name starts
with its ID and its AC number.

## What was read

- `AGENTS.md`; `docs/technical-design.md`: Hook protocol (deep-hook and the hub), Before each command, the fail-open
  row of the budgets table, and How we know version 0 works (Dogfooding; Tests written first).
- At the base: `crates/deep-hook/src/shell.rs` (`real`, `walk`, `lexical`), `src/main.rs` (`matching`, the watchdog,
  `RULING_LIMIT` and its two denials), `default-rules.json`, `Cargo.toml`, `README.md`; `packages/pi/src/index.ts`
  (its `Matcher`, the one caller of `deep-hook match`); `scripts/proof-change.mjs` (`criterionId`);
  `scripts/repo-rules.mjs` (the home-path rule). Suites `316/` (README, `helpers.ts`, `symlink.test.ts`), `315/`
  (`failopen.test.ts`, `budgets.test.ts`, the `judge` rule in its helpers), `2203/` and `2497/` for the house format.

## The surfaces

The real binary, `target/debug/deep-hook`, which the file builds with `cargo build --locked -q -p deep-hook`. Every
test makes a home under `/tmp/dh2174-*` whose `.deepbuild/rules.json` is `crates/deep-hook/default-rules.json`
verbatim (the shipped entries), with no hub at its address, and gives each child only `HOME`, `PATH`, `LC_ALL` and the
two XDG folders.

- **`deep-hook match`**: one process, a Claude Code PreToolUse payload a line on stdin, its
  `{"matched":[…],"denials":[…]}` line read back, as the pi package drives it.
- **A forwarded hook**: `deep-hook claude-code PreToolUse` with the payload on stdin, as 315 and 316 run it. Exit 2 or a
  `deny` decision denies; exit 0 without one allows.

## Readings where the issue leaves a choice

- **"Prints that call's line"**: a line that parses with `matched` and `denials` arrays and without `"unread":true`.
  Since the fix keeps a looping path as written (Scope), an Edit of the link in an ordinary work folder matches what an
  Edit of a plain file beside it matches (compared by entry name, so the test stays blind to the entries) and is denied
  by none. The same is asked of `<link>/x`, the title's "path through a link".
- **"Reads the next"**: the next line in, `pkill -f node`, gets its line, with a denial carrying one shipped entry's
  `reason` and `next_step` whole, and the process is still running after it.
- **A matcher that ends or hangs** fails with the signal, the time and its stderr. The test waits 30 s for a line,
  then stops the child itself; the pi package waits 1 s, which the criterion doesn't name.
- **"Decides by what matches"** (AC2): `ls <link>` and a Read of the link match no fail-closed entry and are allowed;
  `ls <link>; pkill -f node` is denied in the words of the entry that denies `ls <plain file>; pkill -f node`. No
  reply may be the watchdog's "couldn't read this call" denial, and a hook that ends on a signal has not decided.
- **"Inside its 50 ms"**: the design's fail-open time, read as 315 reads it, from the hook's spawn to its exit, on the
  debug build. Five runs of each call on the link, each beside the same call on a plain file:
  - PASS when every link run is under 50 ms.
  - FAIL when the link costs the budget by itself: every link run is over the slowest plain run by more than 50 ms; or
    every plain run is under 50 ms and every link run is over it by more than the margin (5%, or the runs' spread if
    larger, as 315's `judge`).
  - Otherwise INCONCLUSIVE: the test is skipped with the numbers and never passes. A loaded machine that can't run the
    plain call in 50 ms can't judge the link's.

  The decision checks run first and are hard, so the base fails before any time is read. The watchdog denial is told
  from an in-time decision by its words and its exit 2, not by the clock.
- **"Read the same way"** (AC3): AC1's and AC2's readings, whole, on `a -> b` and `b -> a`, naming `a`.
- **"Still reads as that file, as `316/symlink.test.ts` holds it"** (AC4): 316's layout (the session in `HOME`, the
  links beside the home folder) and its checks (denied, a shipped entry's `reason` and `next_step`, `deep_propose`),
  with `~/.claude/settings.json` not there yet. Three links: `s` to the missing config, `s2` to `s` by a relative
  target, `s3` to `s2`; a Write through `s` and through `s3` and an Edit through `s2` are each denied. A Write through
  a link to an ordinary missing file is allowed, so the denials come from the target. Three links is far inside what
  the system follows (40 on Linux, 32 on macOS), where the Scope's bound must not bite.
- **Not imported:** 316's helpers. Its README offers them to its own corpus job only, and a redraft there shouldn't
  move these tests; the few lines needed are in the file.

## Run them

```sh
node --test --test-reporter=spec tests/acceptance/2174/self-link.test.mjs
```

With the repo's Node (24.22.0) and cargo on `PATH`; no `node_modules` needed. It stops only children it started,
through their handles, and removes its `/tmp/dh2174-*` folders. A 4-test run takes about 2 s once the binary is built.

## Base results and wrong programs

`BASE-FAILURE.txt` is the one run at the base: AC1, AC2 and AC3 fail, AC4 passes.

- **AC1 and AC3 fail** for the issue's reason: the matcher ends on SIGABRT, "has overflowed its stack", with no line.
- **AC2 fails** for the issue's cause, either way the base ends: in the recorded run the stack ran out after 312 ms,
  before the watchdog's 500 ms, and the hook ended on SIGABRT with **no denial**; in 9 of 12 more calls by hand it
  exited 2 after 508 to 540 ms with the watchdog's denial, as the issue reports. A signal is no decision, and the
  watchdog's denial is not a reading, so the test fails on both. See the finding below.
- **AC4 passes**: it guards what the base does. Its wrong programs were run once by hand, on a copy of the base tree
  (`git archive HEAD`) in a scratch folder with this file copied in, nothing in the checkout changed:
  - `walk` without its `read_link` branch (a link to a missing file kept as written): AC4 fails, "a Write through
    …/s, a link to the missing …/h/.claude/settings.json must be denied: exit 0". AC1 to AC3 pass on it, with every
    timed run between 12 and 28 ms at a load average of 55, so those tests can be met and the 50 ms was judged here.
  - `walk` following one such link and no further: AC4 fails at "an Edit through …/s2, a relative link to that link".

  Neither plant is in the repo; no code was added outside this folder. 316's `plant-paths-as-written` fails its own
  AC8 and isn't run here.

## Finding, outside these criteria

The issue says a stack running out before the watchdog's 500 ms "was not shown". It shows here: with the base's debug
build on Linux (20 cores, load average near 75), 3 of 12 forwarded PreToolUse calls naming the link ended on SIGABRT
(exit 134 from a shell) after 368 to 521 ms with no denial, 2 of them `ls <link>; pkill -f node`; the other 9 exited 2.
Claude Code blocks a call on exit 2, so those calls were not denied, and the issue's "Nothing here shows a guard
opening" doesn't hold for this build. AC2's deny case covers it once the reader no longer recurses.

## Not tested, because no criterion reaches it here

The release build's times (the issue's 506 ms and 2,556 ms); the table's last row (no fail_closed entry installed);
a chain longer than the system's bound that ends in a missing file; the issue's own Proof (the unit test in
`shell.rs` and the cases in `crates/deep-hook/tests/cli.rs`), which are the implementer's.
