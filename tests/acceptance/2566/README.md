# Acceptance tests for #2566: `deep-hook match` answers a path that repeats a looping link in its caller's time

Written first, blind, from issue #2566 ("deep-hook match: a path that repeats a looping link holds the matcher for
seconds": its report, table, Scope, two acceptance criteria and Depends on, as the brief quoted its body; it has no
comments), the design and base commit `9f93f1e7b` ("Merge pull request #2586 …"), by a job that never saw an
implementation; none existed, and no other branch, worktree or pull request was read, nor GitHub. The implementing agent
doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean:
one test per criterion in one file, Node built-ins only.

| AC | ID | Test in `looping-link.test.mjs` |
|---|---|---|
| AC1 | `#2566.3f94de8b` | `deep-hook match` prints the line of pi's edit of `back/../` × 1,000 within 1 s, in five runs each timed beside the same edit of `plain/../` × 1,000; the same edit where a shipped fail_closed entry guards the folder comes back denied |
| AC2 | `#2566.83c23c3c` | pi's edit of `plain/../` × 5,000 reads as the base's own deep-hook reads it, and in five rounds beside it costs at most 50% over the base's instructions retired |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's line after `- [ ] `, as the brief gave the
issue's body; the live issue wasn't read, so they aren't checked against it. Each test's name starts with its ID and
its AC number.

## What was read

- `AGENTS.md`; `docs/technical-design.md`: Hook protocol (deep-hook and the hub), Before each command, Numbers version
  0 has to hold (the fail-open row; "Every task carries its own budgets": compared with the merge base, a p50 more than
  50% above it is a regression; the five-run timing rule and its margin; the perf lane's instructions retired, "so a
  change is judged against its base off the reference Macs and under load"), and How we know version 0 works
  (Dogfooding; Built to be hard to get wrong).
- At the base: `crates/deep-hook/src/shell.rs` (`real`, `walk`, `step`, `lexical`, `LINKS`, `ELOOP`),
  `src/matcher/paths.rs` (`names_path`, `path_spellings`: each `write:` or `read:` entry reads the call's paths again),
  `src/matcher.rs` (`Call::new`: a relative path joins the call's folder), `src/main.rs` (`matching`, `call`: pi's
  `edit` and its `path`), `src/tool_paths.rs` (`pi_path`), `default-rules.json` (38 entries, five of them `write:`,
  among them `no-deepbuild-spec-write`) and `Cargo.toml`; the workspace's `Cargo.toml`, `rust-toolchain.toml` and
  `.cargo/config.toml`; `packages/pi/src/index.ts` (`Matcher`, `MATCH_MS`, `read`, and the calls it blocks as
  `unread` or `unparsed`); `adapters/corpus/pi/1.4.0/edit/events.jsonl` (pi's edit input); `scripts/proof-change.mjs`
  (`criterionId`); `scripts/perf.mjs` and `scripts/benchmark.mjs` (how the perf lane builds the merge base and counts
  instructions); `scripts/throttle.mjs` and `scripts/lease`. Suites `2174/` (README, test, `BASE-FAILURE.txt`), `315/`
  (`helpers.ts`: `judge`, `environmentProblem`, `buildDeepHook`) and `2497/` (README) for the house format.

## The surfaces

The real binary, `target/debug/deep-hook`, which the file builds with `cargo build --locked -q -p deep-hook`, as 2174
does. The issue timed a release build; the debug one reads these paths at the same cost, which is the system's: at the
base on this Mac, an edit of `plain/../` × 5,000 took 0.04 s of user and 0.23 s of system time in the release build and
0.05 s and 0.23 s in the debug one, with 3.79 and 3.85 billion instructions retired, and `back/../` × 20 retired 1.23
and 1.26 billion (`/usr/bin/time -l`, one process per call). The release build took 31 minutes to build here at a load
average near 250 (deep-contracts' 91,000 generated lines, optimized); the debug one 2 to 9.

- **The world**: a home under `/tmp/dh2566-*` whose `.deepbuild/rules.json` is `crates/deep-hook/default-rules.json`
  verbatim (the shipped entries), with no hub at its address; each child gets only `HOME`, `PATH`, `LC_ALL` and the
  two XDG folders. Two folders a session works in: `work`, an ordinary one, and `repo/.deepbuild/specs`, which the
  shipped fail_closed entry `no-deepbuild-spec-write` guards. Each holds `plain`, a folder, and `back -> none/../back`,
  with no `none`.
- **`deep-hook match`** (AC1): one long-lived process, a call a line on stdin, its `{"matched":[…],"denials":[…]}` line
  read back, as the pi package drives it: pi's edit, `{"tool_name":"edit","tool_input":{"path":…,"edits":[…]},"cwd":…}`
  (pi 1.4.0's input, from the corpus), its path relative to the folder, written as the issue writes it.
- **Counted runs** (AC2): one `deep-hook match` process per sample under `/usr/bin/time -l`, reading a first edit of
  `plain/x` and then the call, as a session's matcher starts: its line for the call, and the instructions it retired,
  the kernel's among them, where this reading spends its time.
- **Today's deep-hook** (AC2): the base's `crates/deep-hook` and `crates/deep-contracts`, with its `Cargo.lock`,
  `rust-toolchain.toml` and `adapters/mcp-servers.facts.json`, taken from git with `git archive 9f93f1e7b…` into
  `target/acceptance-2566/base-9f93f1e7b/src`, a two-member workspace manifest written beside them, and built with
  `cargo build --offline -q -p deep-hook` into a target folder of its own there. It is kept: a later run only checks
  that it is built.

## Readings where the issue leaves a choice

- **"The time its caller gives it", "within 1 s"**: pi's `MATCH_MS`, 1,000 ms, from the write of the call to its line,
  as pi's timer runs. Timed on a matcher already up: each run starts one, which answers an untimed first edit (of
  `plain/x`) before the timed calls, as pi's matcher is up between a session's calls.
- **"An Edit of `back/../` × 1,000"**: pi's edit whose path is `back/../` written 1,000 times, relative, in the folder
  that holds the link. pi's edit is the one `deep-hook match` reads; Claude Code's Edit goes through the forwarded hook,
  which the issue already counts as bounded.
- **"Prints that call's line"**: a line that parses with `matched` and `denials` arrays and without `"unread":true`
  (2174's reading): a call that parses but reads slowly is no unparseable line. Its denials aren't read in the ordinary
  folder: the Scope allows a bound, and a bound may deny the call as unreadable, as the forwarded hook's watchdog does.
- **"Nothing here shows a guard opening"**: read as a bar the fix keeps, since "the path as written is still matched".
  After the timing, the same edit in the guarded folder must come back denied, by that entry or as unreadable, where
  the same edit of `plain/../` × 1,000 is denied in that entry's words. The base denies both; a bound that gives a
  looping path up and reads it as no path would let it through. It isn't timed: the timed runs stay in the ordinary
  folder, the issue's, since a matched entry's note reads the path once more (there the twin took about three times as
  long: 1,034 against 341 ms at a load average near 235).
- **The timing rule (AC1)**: five runs, each on a matcher of its own, each pairing the link call with its plain twin,
  the same edit of `plain/../` × 1,000 just before it on the same matcher:
  - PASS when every link call's line comes within 1,000 ms.
  - FAIL when, in every run, the link call takes more than its twin plus 1,000 ms and at least 20 times its twin. A
    link call with no line in 30 s counts as 30 s, and the test stops that matcher through its handle.
  - Otherwise INCONCLUSIVE: the test is skipped with every number, and never passes.

  The 1,000 ms over the twin is the caller's whole budget. The ratio is what keeps load from failing a program: load
  slows the link call and its twin alike, both being the system's path lookups, so their ratio is the reader's own,
  and waiting for a CPU, which adds the same to both, only shrinks it. Twenty, because the twin takes 0.06 to 0.07 s
  of CPU time here, so twenty twins are over a second of it, while a fix the Scope names costs about one twin (the
  memo below: 1.1 to 2.9 twins under load) or at most its bound, which is under the budget. The one misreading the
  rule allows is a program twenty or more twins slow that still answers within 1 s on an idle machine, which needs a
  twin under 50 ms: faster than this Mac's, measured under load, and as fast as the issue's Linux build (17 ms). The
  base's link call retires 78 times its twin's instructions (60 billion against 0.77) and takes 6.3 s of CPU time
  against 0.07.
- **"A path that repeats no link"**: the issue's first row, `plain/../` repeated, at the table's longest, 5,000, where a
  reading that grows faster than the path shows most; in the ordinary folder.
- **"As fast as today"**: as fast as the base's own deep-hook, run beside the checkout's on the same call. "Today" is a
  program: what it costs here is known only by running it; nothing in the changed binary stands for it without a model
  of what the base's reader costs; and a fixed number won't do, since the issue's are a Linux release build's and this
  Mac reads the same paths several times slower. So the test builds the base once and keeps it. It compares the two on
  instructions retired, the count the design judges a change against its merge base by off the reference Macs and
  under load, with the design's line for a slower change: more than 50% over the base. Wall time can't make that call
  under load: most of it is waiting for a CPU, which both sides share, so a program twice as slow reads near the base.
  In a wall-time version of this test (three calls a side a round, the round's medians), the two-pass plant below read
  1.32 to 2.40 of the base's time at a load average near 380, two rounds under the line; it retires 1.97 to 1.98 the
  base's instructions in every round. Five rounds, a process of each side in each, the side that goes first swapping
  round by round, after one uncounted process of each, as macOS checks a binary at its first start:
  - PASS when every round's ratio, the checkout's count over the base's, is at most 1.5.
  - FAIL when every ratio is over 1.5 by more than the margin, the larger of 5% and the ratios' spread, as 315's
    `judge`.
  - Otherwise INCONCLUSIVE, skipped with every number. A system whose `/usr/bin/time` gives no count, as Linux's GNU
    time doesn't, reads INCONCLUSIVE at once, as the design reads a comparison with no count.

  The count holds from run to run: the base's reads 3.84 to 3.87 billion in every run here, at load averages from 270
  to 330, while the same processes' wall times run from 1.1 to 4.4 s.
- **"Is read"**: the checkout's line for the call is the base's line (`matched`, sorted, and `denials`), on the
  uncounted run and on every counted one.

## Run them

```sh
PATH=/opt/homebrew/opt/rustup/bin:$PATH    # when cargo isn't on PATH
node --test --test-reporter=spec tests/acceptance/2566/looping-link.test.mjs
```

With the repo's Node (24.22) and cargo; no `node_modules` needed. Today's deep-hook builds `--offline`, from the crates
cargo already holds for the base's lock (a machine that built this repo near the base does); without them the test
fails with a `BLOCKED:` message, never a pass. It stops only children it started, through their handles, and removes
its `/tmp/dh2566-*` folders; it keeps `target/acceptance-2566/`. On the memo below, with both builds in place, the two
tests took 6 and 37 s at a load average near 280 to 330. At the base they took 16 minutes: 8.5 to build
`target/debug/deep-hook` from nothing, about 5 to build today's deep-hook, and AC1's link calls, each held to 30 s.

## Base results and wrong programs

`BASE-FAILURE.txt` is the one run of this file at the base: AC1 fails, AC2 passes.

- **AC1 fails** for the issue's reason: over the edit of `back/../` × 1,000 the matcher took 29,449 and 24,481 ms in
  two runs and printed no line in 30 s in the other three, against 146 to 501 ms over its plain twin: at least 60 times
  the twin and 24 s over it, in all five runs, at a load average near 270 to 310. The issue's 1.8 s is Linux's release
  build with 40 links; this is macOS's debug build with 32, under load. An earlier run of the suite, before AC2
  counted instructions, read 5,668 to 7,710 ms against twins of 79 to 137 ms at a load average near 280.
- **AC2 passes**, as it must at the base, where the checkout is today's program: 0.996 to 1.003 the base's
  instructions in every round. The earlier run's wall-time AC2 passed too, at 0.99 to 1.05.

Wrong programs, and one right one, each run once by hand with this file as committed: a scratch copy of the base's two
crates (the archive above, with the two-member manifest, built), one program planted in it, this file copied in
unchanged and today's deep-hook beside it, as above. Nothing in the checkout changed, and no plant is in the repo.

- **memo**, a fix the Scope names, not a wrong program: a link that one reading of a path finds to come back to itself
  is kept as written at once each time that reading meets it again, so a name already found to loop costs one read.
  Both tests pass: the edit of `back/../` × 1,000 in 261 to 697 ms beside twins of 184 to 278 ms, and denied in the
  guarded folder; 0.999 to 1.003 the base's instructions. The tests can be met, here and under load.
- **written-key**, the memo keyed on the path as written so far, which every repeat lengthens, so it never hits and
  every repeat still follows the link 32 times: AC1 fails, no line in 30 s in any run, beside twins of 162 to 968 ms.
- **gives-up-open**, the memo, and a path whose reading gave a looping link up read as no path, so no entry matches it:
  quick (125 to 1,107 ms, which alone read INCONCLUSIVE under that load), and AC1 fails at the guarded folder: "an edit
  of back/../ × 1,000 in a guarded folder is denied, as the same edit of plain/../ × 1,000 is:
  {"matched":[],"denials":[]}".
- **two-pass**, every path read twice, a first pass to find the links that loop and a second to read it: AC2 fails at
  1.969 to 1.983 the base's instructions. The wall-time version above read it INCONCLUSIVE.
- **three-pass**, every path read three times: AC2 fails at 2.939 to 2.956.

## Finding, outside these criteria

On a Mac, a link the system itself reports as looping costs the matcher most of its caller's second too: at the base,
pi's edit of `self/../` × 1,000 (`self -> self`) retired 9.0 billion instructions, 12 times its plain twin's, and took
0.84 s of CPU time (5.8 to 7.8 s of wall time at a load average near 330), where the issue's Linux build reads it in
210 ms. The memo plant, which keeps only the links it follows by hand, reads it the same (9.0 billion). The criteria
name only `back`; a fix that also keeps a name the system reports looping as written once it has found it would cover
`self` too.

## Not tested, because no criterion reaches it here

The release build's times (the issue's table); the table's other rows (`back/../` × 100 and × 5,000, `plain/../` × 100
and × 1,000 against the base, `self/../`); the forwarded hook, bounded already by the issue's account; and the Scope's
second line, what the design says the matcher's caller does with a call it stopped waiting for, a design change no
criterion names.
