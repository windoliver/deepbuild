# Acceptance tests for #315: the deep-hook client

Written first, from issue #315 (its text as of October 22, 2026: Scope, the 13 checkbox criteria, Proof, Depends
on, "Added Oct 9" and Done when; it has no comments), the design sections it links (Hook protocol (deep-hook and
the hub); One hub per user, a tiny hook client, and extensions in-process; Numbers version 0 has to hold; Hooks are
evidence, not a state machine) and those around them (Before each command; One event log, with tables built from
it; Privacy; How we know version 0 works), the text of #1, #16, #17, #311, #316 and #317, the acceptance tests of
#16 and #14, and base commit `33eaad3` (origin/main), by a job that never saw an implementation. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 13 checkbox criteria: AC1 to AC13 in the body's order.

## How to run

With the repo's Node (`.node-version`, 24.22.0) and Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the tests run the built CLI, packages/cli/dist/main.js
npx vitest run --root tests/acceptance/315 --no-file-parallelism
```

- `--no-file-parallelism` keeps the files from running side by side: they time real processes against a 50 ms
  deadline, and every file builds deep-hook with cargo, which replaces the binary in place.
- Nothing needs the network. The files build `cargo build --locked -q -p deep-hook` (target/debug), the release
  build (`--release`, for the budgets) and each planted twin into a target folder of its own,
  `target/<features joined by +>/debug/deep-hook` (`target/plant-f-test` is #16's AC23 build's folder too).
- The budgets need hyperfine on PATH (AC9). Without it the overhead numbers are skipped as INCONCLUSIVE, naming
  hyperfine; nothing installs it.
- Long runs: AC13 waits 30 s for its held push, and its connect-timeout wrong program waits the 10 s stand-in hook
  timeout on six calls; AC10 runs 1,000 hooks twice; AC11 runs the hub three times per pass.
- Every test makes its own folders under `/tmp/dh315-*` (a Unix socket path must fit in 104 bytes on macOS), sets
  `HOME` to one of them for every process it starts, and never touches the real `~/.deepbuild`. It stops only
  processes it started, by PID (`helpers.ts`, `cleanup`), never by name or port. A child never inherits this
  process's billing keys (`ANTHROPIC_API_KEY` and the like) or `DEEP_*` settings.
- With `--root` here, Vitest writes its cache to `tests/acceptance/315/node_modules/.vite/`; delete that folder
  before committing.

Type-check with `node node_modules/typescript/bin/tsc -p tests/acceptance/315/tsconfig.json`. The tests import only
`packages/record/src/index.ts` (AC5 reads a session's readings from the hub's ledger once the hub has stopped);
everything else goes through the binary, `deep hub run`, the socket and the files under the root.

## The surface under test

The issue names deep-hook's behavior but not every place a test can see it, so these tests use the surfaces #16
already fixed (the address setting, the socket's line protocol, `deep hub run`, `events.read`, the test VFS and
`DEEP_HUB_PLANT`) and define the smallest additions below. Each is listed again, with why, under Readings.

### deep-hook

- **Invocation.** `deep-hook <agent> <event>` with the agent's hook JSON on stdin and `HOME` the agent's, as an
  agent's hook entry runs it. It reaches the hub at #16's address setting (`hub.address` in
  `$HOME/.deepbuild/config.json`, `unix:<path>`; absent, `$HOME/.deepbuild/hub.sock`).
- **What it prints.** A hub reply that parses is printed as the hub mapped it. Otherwise deep-hook prints only its
  own decision, never a byte the hub sent: for Claude Code's PreToolUse a deny is exit code 2 (the reason on
  stderr) or a stdout `hookSpecificOutput.permissionDecision` of `deny`, and an allow is exit 0 with no deny.
- **The hub away.** deep-hook acts "as with the hub down" when the hub isn't there (no socket, or a connect
  refused), refuses the request (an error line instead of the acknowledgement), replies with a line that doesn't
  parse, hasn't acknowledged within 50 ms of the hook's start, or hasn't replied by the `hold_until_ms` it
  acknowledged. Then it applies the `fail_closed` entries of `rules.json` (a call one of them matches is denied)
  and allows every other call, and it spools the request. Every such decision is made within 50 ms of the hook's
  start, timed here from the process's spawn to its exit, so the client's own deadline must leave room for the
  process to start and end.
- **Late.** A call let through because the hub was late (a connection was made, but no acknowledgement came in
  time, or no reply by the acknowledged hold) is spooled with `"late": true` added to its request line. A hub that
  isn't there at all isn't late.
- **A held reply waits.** When the acknowledgement carries `hold_until_ms`, deep-hook waits for the reply until
  then, however far ahead it is, and prints the reply when it comes.
- **Billing keys.** A SessionStart request carries `"billing": {"ANTHROPIC_API_KEY": <bool>, …}`: for each billing
  key deep-hook knows (at least `ANTHROPIC_API_KEY`, the one Claude Code's facts list), whether it is set in the
  environment deep-hook inherited, true or false, never a value.
- **The matched entries.** With the hub up, the request's `matched` names every `rules.json` entry the call matched,
  whatever its mode, and the same list goes with the request when it is spooled.

### rules.json

`$HOME/.deepbuild/rules.json`, read by deep-hook on every call:

```json
{ "v": 1, "entries": { "<name>": { "match": "shell:pkill *", "scope": "all_repos", "mode": "block", "reason": "…", "next_step": "…", "fail_closed": true } } }
```

Each entry is a `guard@1` (#311) under the name `matched` lists. Before #316's matcher lands, a `match` of the form
`shell:<glob>` matches a shell call (Claude Code's `Bash` tool, its `tool_input.command`) whose whole command matches
the glob, where `*` matches any run of characters, spaces included; #316's matcher must still match these. The tests
install two entries (`helpers.ts`, `RULES`): `no-kill-by-name` (`shell:pkill *`, fail_closed) and `listing-noted`
(`shell:ls*`, mode block but not fail_closed), so with the hub away `pkill -f node` is denied and `ls` is still
allowed though it matches an entry. The hub doesn't rewrite `rules.json` when it starts (the design has it rewrite
the file at each install).

### The spool

- `$HOME/.deepbuild/spool/*.jsonl`. Each spooled request is the request line as deep-hook sent it (or would have
  sent it), byte for byte, with `"late": true` added for a late call, written as one append of one line. Every
  deep-hook process appends to the same spool file, so with the hub stopped the hooks of a run land in one file
  (AC10, AC11).
- The hub replays the spool when it starts. A line that doesn't parse (a cut line) is skipped and recorded naming its
  offset: an event the core appends (writer `core`) whose `data.offset` is the byte offset in the spool file at which
  that line starts, lines split on `\n`. The tests find it by writer and `data.offset`, not by kind;
  `spool.refused@1` with `data: {offset, file}` is the suggested kind (the catalogue is closed, so the implementer
  adds it to `packages/contracts/schemas/`). Every request after a cut line is kept, including one written right
  after the cut bytes before any newline.

### Events the hub records from deep-hook's requests

- The request gains two optional fields, which hook.request@1 doesn't list at the base and the hub refuses until it
  does: `late` (boolean) and `billing` (an object of booleans).
- An event from a late request carries `data.late: true` and `data.matched`, the request's `matched` list.
- A recorded `session.start` carries `data.billing`, the request's `billing` map.
- `seq` is read back through `events.read` as the exact decimal string deep-hook stamped (#16).

### The "hooks not reaching DeepBuild" reading

A session's readings are the record's: `session(<the agent's session ID>).readings` from `@deepbuild/record`, where
#14's "clock went back" already is. A turn the transcript shows with tool calls, none of whose hooks reached the hub,
puts the reading `hooks not reaching DeepBuild` on that session by the time a later turn's hooks have reached the
hub and five seconds have passed. A session whose every turn reached the hub has no such reading.

### Test-only settings

Read from the environment of the process named; set by nothing but a test.

| Variable | Read by | What it does |
|---|---|---|
| `DEEP_HOOK_TEST_CLOCK_NS=<decimal>` | deep-hook | deep-hook's one read of the wall clock at the hook's start returns this many nanoseconds since the epoch: `seq` is this string and the ULID's time is its milliseconds. Its 50 ms and hold deadlines still run on the monotonic clock. It must work in the debug build the tests make; a release build may ignore it. |
| `DEEP_HOOK_TEST_SPOOL_STALL=<n>` | deep-hook | when deep-hook spools, it writes only the first `n` bytes of its line and then waits, never exiting on its own, so a test can kill it mid-write. |
| `DEEP_HOOK_FORCE_F_TEST=1` | deep-hook's `plant-f-test` build | #16's: sends `"f_test": true` whatever the hub lists, which the hub refuses naming `/f_test`. |
| `DEEP_HUB_PLANT=<name>` | `deep hub run` | #16's: runs the planted hub `<name>` (Wrong programs). |
| `DEEP_HUB_TEST_VFS=<JSON>` | `deep hub run` | #16's test VFS (`points`, `cutAfter`): the `spool_removal` point is the spool file's removal. |

### Test hubs (`fixtures/test-hub.mjs`)

Stand-ins at the address setting, each a process of its own, each late in one way: `accepts-never-reads` (accepts,
then neither writes a hello nor reads), `reads-never-replies` (hello, reads the request, never acknowledges),
`garbled-reply` (hello, acknowledgement, then a reply line with an unterminated string carrying a nonce) and
`held-push` (hello, an acknowledgement at once with `hold_until_ms` 40 s ahead, and after 30 s a deny reply whose
reason carries a nonce). AC13's third hub is a real `deep hub run` stopped with SIGSTOP.

## Readings where the issue and design leave a choice

- **"The hub stopped" (AC1)** is every way a hub can be stopped: never started, stopped by SIGTERM, killed with its
  socket left behind, and stopped with SIGSTOP (AC13 names that one "stopped" too). A normal command is a Bash `ls`;
  `rules.json` holds the two entries above, so the matcher runs. Each of ten calls per form must be allowed in under
  50 ms from spawn to exit; this is a deadline the client keeps, not a budget, so it isn't held to the reference
  Mac.
- **"Late" and "matched" in the record (AC13)** are `data.late` and `data.matched` on the event (above): the issue
  says the event "names the guard entries it matched" and is "marked late" but not where.
- **The test hubs (AC13).** "Accepts and never reads" writes no hello either; "reads and never replies" writes its
  hello and reads the request. The SIGSTOPped hub is killed (SIGKILL, still stopped) before the working hub starts,
  so what waited on its socket can reach the record only through the spool. The working hub is the installed one at
  the default address. "The agent's hook timeout" is stood in for by 10 s, after which the test kills the hook.
- **The held push (AC13)** is a PreToolUse for `git push origin main` acknowledged with a hold 40 s ahead and
  answered after 30 s; "gets its answer through" is deep-hook printing that reply's stdout as it came, after at
  least 30 s.
- **The hub's bytes (AC12)** are every line the hub wrote on that connection (read through a forward, or from the
  test hub's own copy), its hello's start ID, a refusal's remediation text and the garbled reply's nonce; none may
  appear in deep-hook's stdout or stderr. "Spools the request" is a spool line with the request's ID.
- **The billing key (AC3)** is a value made at run time in the shape of an Anthropic key. "No log, spool or record
  row holds its value" is checked on the wire both ways, in the spool before replay, in deep-hook's and the hub's
  output and in every file left under the test's home, in raw and every form #15 names. A session without the key
  must read false, so a constant true fails.
- **A turn with tool calls but no hook event at the hub (AC5)** is a turn in the transcript (prompt, a Bash call, its
  result, the answer) none of whose hooks reached the hub, between two turns whose hooks did. The hub learns of it
  however it chooses (the next prompt, the next stop, a tail of the transcript), within five seconds of the next
  turn's last hook.
- **In order (AC4)** is the order the hooks ran, which is the order of their stamps: `log_pos` rises with it, and the
  spooled events come after what the hub recorded before it stopped.
- **The spool is one file (AC10, AC11).** The design has deep-hook write each spooled request "as one append of one
  line", the hub skip a cut line "naming its offset" and keep "every line after it", and remove "a spool file only
  once every event it held" is durable; the issue speaks of "a replayed 200-event spool". A spool of one-line files,
  one per hook (the base's), has no line after a cut and a cut always at offset 0, so these tests read the spool as
  one file every deep-hook appends to, and check that the scenario's hooks landed in one.
- **Killed mid-write (AC10)** is DEEP_HOOK_TEST_SPOOL_STALL: hook 400 of 1,000 writes 48 bytes and waits; after 650
  more hooks have ended it is killed with SIGKILL (the test checks it was still running). "Eight processes at once"
  is eight hooks in flight at a time, the stalled one holding its place until it is killed. Each hook's stamp is
  fixed (DEEP_HOOK_TEST_CLOCK_NS) so every event is known by its seq. "The first ID lost" is the first request, in
  the spool's own order, whose event isn't in the record exactly once.
- **The power cut (AC11)** is #16's test VFS: a reference pass numbers the durable write points, and a pass on a
  fresh copy cuts right after the first `spool_removal` point (three tries, as #16's crash suite does, since
  batching can move point numbers). The restart runs with no cut; "in the record or still in the spool" is read
  once the restarted hub has settled.
- **Budgets (AC2, AC8, AC9).** They count only on a reference Mac (Mac15,7 or Mac15,12) on mains power, Low Power
  Mode off, no thermal warning; elsewhere each number is skipped as INCONCLUSIVE, never passed. Before any number is
  read, the call it times is shown to be the issue's: with the hub up, the request names the entries it matched; a
  late hub's `ls` is allowed and spooled marked late and its `pkill -f node` denied. Overhead (AC2 and AC8's "under
  10 ms at p95") is `budgets-overhead-redraft.test.ts`, a blind redraft (AC2-AC8-REDRAFT.md, #745): one `ls` through
  the forwarder must be allowed with `matched` naming exactly the watch-mode entry it matches, then overhead is p95 of
  1,000 `ls` calls straight to the hub minus p95 of 1,000 runs of the floor, in one hyperfine run (`-N`, `--input`),
  five runs judged, every exit code 0 and nothing spooled; the floor is `fn main() {}` built by rustc at opt-level 3.
  The first draft's bench matched `ls` with a block-mode entry, which the hub denies since #316. Fail open is p95 of 50 calls against a hub
  stopped with SIGSTOP, from spawn to exit. Peak memory is the largest `maximum resident set size` from
  `/usr/bin/time -l` over a forwarded call, a failed-open call and a failed-closed call. The binary is
  `target/release/deep-hook`, under 3,000,000 bytes. "Compared with the merge base" is the perf lane's: two tasks in
  `benchmarks/budgets.json`, `deep-hook-overhead` and `deep-hook-fail-open`, each `["node",
  "benchmarks/deep-hook.mjs", "<overhead|fail-open>"]` with an `initialReason` naming #315, valid by
  `validateBudgets` against the merge base's file, and each bench exiting 0.
- **Measured with hyperfine (AC9)** is read from the bench itself: `node benchmarks/deep-hook.mjs overhead`, run with
  a `hyperfine` first on PATH that writes down its arguments and runs the real one, must run hyperfine with a command
  timing deep-hook and a command whose program is a native binary (Mach-O or ELF) that exits 0 printing nothing.
- **IDs.** Each `describe` names its criterion's ID, `#315.<first 8 hex of SHA-256 of the criterion's text>` (the
  text trimmed, whitespace collapsed, the `- [ ] ` dropped), as the trace lane reads tags.

## Criteria to tests

Each test's name starts with its criterion's number. Where a criterion names a wrong program, a test headed
`(wrong program)` runs the same scenario on the planted twin and expects the same check to fail, naming what the
criterion says; the scenario itself must run (a plant that doesn't build or start fails that test, not passes it).

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#315.f0560928` | hub stopped: a normal command allowed in under 50 ms | `failopen.test.ts` AC1 (1): ten `ls` calls with no hub, after SIGTERM, after SIGKILL with the socket left, and with the hub SIGSTOPped |
| AC2 `#315.9543886e` | overhead under 10 ms at p95 over process start, 1,000 calls | `budgets-overhead-redraft.test.ts` AC2 (1): the forwarded `ls` allowed and matched by the watch-mode entry, then hyperfine against the floor (blind redraft, AC2-AC8-REDRAFT.md) |
| AC3 `#315.c8a3b16d` | ANTHROPIC_API_KEY set: SessionStart carries true; its value nowhere | `billing.test.ts` AC3 (1): hub up and hub stopped, true and false, every place searched |
| AC4 `#315.bf6d3707` | hooks run while the hub was stopped are recorded after it starts, in order, none lost | `spool.test.ts` AC4 (1) |
| AC5 `#315.f8b9a600` | a turn with tool calls and no hook event shows "hooks not reaching DeepBuild" | `reading.test.ts` AC5 (1): the quiet session and the control |
| AC6 `#315.8366a61c` | fixed stamps …789 and …790 spooled exactly, recorded in order; a second replay appends nothing | `spool.test.ts` AC6 (1) |
| AC7 `#315.2a5a4d2b` | the same nanosecond twice: two IDs, both recorded | `spool-ac7-redraft.test.ts` AC7 (2): hub up; through the spool (blind redraft, AC7-REDRAFT.md) |
| AC8 `#315.515d4e08` | budgets on the reference Mac, against the merge base | `budgets.test.ts` AC8 (5): the perf lane's tasks; each bench runs (2); fail open; peak memory and binary size; `budgets-overhead-redraft.test.ts` AC8 (1): overhead (blind redraft) |
| AC9 `#315.23cd76ed` | overhead measured with hyperfine against a native no-op floor | `budgets.test.ts` AC9 (1) |
| AC10 `#315.787a7ca4` | 1,000 spooled by eight processes, one killed mid-write: each exited event once, the cut recorded with its offset, lines after it kept | `cut.test.ts` AC10 (2): the run; the wrong program |
| AC11 `#315.2d265264` | power cut after a replayed 200-event spool is removed: all 200 in the record or the spool | `cut.test.ts` AC11 (2): the run; the wrong program |
| AC12 `#315.9abdf3f5` | a refusal or an unparsable reply: pkill denied, ls allowed, no hub bytes printed, spooled | `refusal.test.ts` AC12 (2): the run; the wrong program |
| AC13 `#315.d4f95b29` | three late test hubs within 50 ms, spooled and recorded late with matched entries; a held push gets its answer | `failopen.test.ts` AC13 (3): the run; two wrong programs |

## Wrong programs

Exactly these, one per "a … that … fails this test" in the criteria:

| Name | How it is selected | Criterion | What the plant does | How the test fails on it |
|---|---|---|---|---|
| `stops-at-first-bad-line` | `DEEP_HUB_PLANT` on `deep hub run` | AC10 | stops replaying the spool at the first line that doesn't parse | the requests after the cut aren't recorded: "first ID lost: <ID>" |
| `remove-spool-after-normal` | `DEEP_HUB_PLANT` on `deep hub run` | AC11 | commits the replayed events with `synchronous=NORMAL` and removes the spool after that batch, with no FULL commit between | the cut loses the unsynced events and the spool is gone: "first ID lost: <ID>" |
| `plant-print-reply` | cargo feature, built with `plant-f-test` into `target/plant-f-test+plant-print-reply` | AC12 | prints the hub's last line to stdout as it came, otherwise as the real client | "deep-hook printed the hub's bytes" |
| `plant-connect-timeout-only` | cargo feature, `target/plant-connect-timeout-only` | AC13 | times out only the connect; reads the hello, the acknowledgement and the reply with no deadline | it waits on the test hub that accepts and never reads until the 10 s stand-in hook timeout: "waited … on the test hub that accepts and never reads (accepts-never-reads)" |
| `plant-fixed-deadline` | cargo feature, `target/plant-fixed-deadline` | AC13 | waits for the acknowledgement and the reply together until one fixed deadline (its 50 ms acknowledgement deadline), ignoring `hold_until_ms` | the held push is allowed before its 30 s answer: "let the held push through before its answer" |

The base itself is the wrong program for the rest (BASE-FAILURE.txt).

## What depends on other issues

- **#316's matcher** replaces the `shell:<glob>` reading above; the tests need only that it matches `pkill -f node`
  by `shell:pkill *` and `ls` by `shell:ls*`, and not `git push origin main`.
- **#16's hub** is the one these tests start; the hub's half of #315 (accepting `late` and `billing`, recording
  `data.late`, `data.matched` and `data.billing`, the cut line's event, the one-file spool's replay, the reading and
  the two hub plants) lands with this issue.

## Files

- `helpers.ts`: temp homes, deep-hook builds and runs (timed from spawn to exit), the hub as a process, the line
  protocol client, the forwarder, the test hubs, `rules.json`, the spool read as bytes, the reference-Mac gate and the
  timing judge.
- `fixtures/test-hub.mjs`: the four test hubs.
- `failopen.test.ts` (AC1, AC13), `budgets.test.ts` (AC8, AC9), `budgets-overhead-redraft.test.ts` (AC2, AC8 overhead),
  `billing.test.ts` (AC3), `spool.test.ts` (AC4, AC6), `spool-ac7-redraft.test.ts` (AC7), `reading.test.ts` (AC5), `cut.test.ts` (AC10, AC11), `refusal.test.ts` (AC12).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit: 22 of the 23 tests fail, each for the reason its header gives. AC4
  passes there: #16 already built deep-hook's spooling and the hub's replay at start, which for hooks run one after
  another keeps their order; the test stays as AC4's proof and guards it through this issue's change to one spool
  file.
