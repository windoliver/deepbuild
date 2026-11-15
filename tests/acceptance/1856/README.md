# Acceptance tests for #1856: a rules.json removed after setup doesn't turn the guards off

Written first, blind, from issue #1856 (body as of November 14, 2026; no comments), the design and base commit
`72fe11a11` ("Merge pull request #2523 …"), by a job that never saw an implementation; none existed, and no other
branch, worktree, pull request or other issue's work was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | File (tests) | On the base |
|---|---|---|---|
| AC1 After setup, `rules.json` deleted, the hub stopped: `pkill -f node` is denied naming `rules.json` | `#1856.6023a4b7` | `hub-away.test.ts` (1) | fails: the call is let run (exit 0) |
| AC2 Before setup, no `~/.deepbuild/rules.json`: `ls` runs | `#1856.e52ea188` | `hub-away.test.ts` (2) | passes |
| AC3 The hub running, `rules.json` deleted: the next `pkill -f node` is denied naming no-kill-by-name, the file again holds every installed entry, the record holds one event naming the removal | `#1856.074bdc1e` | `hub-running.test.ts` (3: the denial, the file, the record) | fails, all three: allowed (exit 0), no file, no event |

IDs are `scripts/proof-change.mjs`'s `criterionId` (`#1856.` and the first 8 hex of SHA-256 of the criterion's text,
trimmed, whitespace collapsed), hashed from the live issue body. Each test's name starts with its ID. The base run is
in `BASE-FAILURE.txt`.

## What was read

- Issue #1856; `AGENTS.md`; `docs/technical-design.md`: One hub per user, a tiny hook client, and extensions
  in-process; Before each command; Dogfooding.
- At the base: `crates/deep-hook/src/main.rs` (`rules`, `forward`, `matching`, the watchdog's and the hub-away
  denials' words, `ACK_BUDGET`), `crates/deep-hook/default-rules.json` (no-kill-by-name: fail_closed, planted call
  `pkill -f node`), `packages/hub/src/server.ts` (`rules()`), `packages/hub/src/setup.ts` (`finishedFile`,
  `installRules`, what setup writes into `setup-finished.json`), `packages/cli/src/main.ts` (`unfinished`),
  `scripts/proof-change.mjs` (`criterionId`), and the suites `tests/acceptance/304` (helpers, `hubside.test.ts`),
  `1407/redraft` and `2497` for the house format and for starting a real hub and deep-hook in a temp HOME.

## The surfaces

Every decision comes from the real programs: `target/debug/deep-hook` run as Claude Code's hook entry runs it
(`deep-hook claude-code PreToolUse`, a Bash `PreToolUse` payload on stdin), `deep hub run` and `deep guard add` from
`packages/cli/dist/main.js`, `~/.deepbuild/rules.json` and `~/.deepbuild/setup-finished.json` in a temp HOME under
`/tmp/dh1856-*` (short, for the hub's socket path), and the record read through the hub's socket (`events.read`, the
cli role). A denial is exit 2 or a `deny`/`block` decision on stdout; "runs" is exit 0 with no such decision. Children
get no `DEEP_*`, `XDG_*`, `GIT_*`, `RUST_*`, `CLAUDE*`, `CURSOR*`, `CODEX*` or billing variables. Processes are
stopped only by their own PID; temp homes are removed after each test (AC3: after its file).

## Readings where the issue leaves a choice

- **"After setup"** is `~/.deepbuild/setup-finished.json` being there (Scope: "Once setup has finished
  (`setup-finished.json` is there)"). The tests write it as setup's last step does, `{version, at}` at mode 0600, and
  write `rules.json` as setup does in a home that has none: the shipped `default-rules.json`, verbatim. `deep setup`
  itself isn't run: it would also write agent settings and a login service, which no criterion reads.
- **"The hub stopped" (AC1)** is a home where no hub runs and nothing listens at the hub's address. No hub is started
  and stopped first; the criterion reads only deep-hook's decision with the hub away.
- **AC1's order**: `rules.json` is written, a control call shows the floor holds (`pkill -f node` denied naming
  no-kill-by-name with the hub away; BLOCKED if not), the file is deleted, and the same call is judged: denied, and
  its stdout or stderr holds `rules.json`. The denial's other words are the implementer's.
- **"Before setup" (AC2)** is no `setup-finished.json`. Two homes: no `~/.deepbuild` at all, and an empty
  `~/.deepbuild`; no hub in either. `ls` is allowed. Nothing is asserted about `ls` after setup with the file gone:
  the issue states only that the call is "denied naming the file" for `pkill -f node`.
- **"Every installed entry" (AC3)** is every entry `rules.json` held just before the removal: the shipped defaults and
  one test entry, `t-1856` (`run:gh pr merge`, block, not fail_closed), installed through `deep guard add` on the
  running hub, so the file can't be put back from the shipped defaults alone. After the hook returns, the file's
  `entries` must equal the earlier `entries` (same names, each entry field for field). Its other members (`proofs`,
  `classes`, `standing`) aren't compared: the criterion names entries only.
- **AC3's home is one setup finished in** (`setup-finished.json` there), the state the issue describes; see the open
  question below.
- **"Before it answers the next hook"**: the file is read as soon as that one hook's process has exited, with no wait.
- **"Denied naming no-kill-by-name"**: the hook is denied and its stdout or stderr holds `no-kill-by-name`.
- **"One event naming the removal"**: among the events the record gained since the removal, leaving out the judged
  call's own `tool.before` (the base records that one too), exactly one names `rules.json` anywhere in it (its kind
  or its data). The event's kind and shape are the implementer's. The record is read once the call's `tool.before` is
  in and no event has arrived for a second.
- **The removal** is the test's own `rmSync`: it stands for "a command's child, which no guard sees".

## Not decided, never passed

Thrown as plain errors, so they never read as a failure at an assertion:

- `INCONCLUSIVE`: a hook killed at 60 s; a hook decided by deep-hook's 500 ms watchdog ("within 500 ms"); in AC3, a
  hook the running hub didn't acknowledge in its 20 ms, which deep-hook then decides alone (its words "while the hub
  doesn't answer"): the control is retried up to 10 times, as a session's first hook often misses, and the judged
  call isn't retried; a record still growing after it had settled. Run the suite again alone.
- `BLOCKED`: `target/debug/deep-hook` or the built CLI missing, the hub not starting, `deep guard add` not installing
  the test entry, or a control call not denied by no-kill-by-name while `rules.json` is there.

## How to run

With the repo's Node and Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook; the tests don't build it
npx vitest run --root tests/acceptance/1856 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1856/tsconfig.json   # type-check
```

The tests run whatever `target/debug/deep-hook` and `packages/*/dist` hold, so rebuild both after a change.

## Wrong programs

The base is the wrong program for AC1 and AC3 (the issue: "deep-hook on the merge base lets it run", "the hub on the
merge base allows the call"); `BASE-FAILURE.txt` shows each of their four tests failing at its `expect` for that
reason. AC2 passes on the base: it is regression protection, and proves its criterion only on a twin, such as a
deep-hook that reads a missing `rules.json` as unreadable whether or not `setup-finished.json` is there (both AC2
tests then fail at their `expect`). No `twins.json` is written here.

## Open questions

- **Does the hub put the file back in a home with no `setup-finished.json`?** Scope's hub bullet doesn't say "once
  setup has finished"; the report does say a missing file is right before setup. AC3 runs only in a set-up home and
  asserts nothing for the other.
- **A hub that was stopped when the file went.** The issue says the guards stay off "until the next install writes it
  again"; whether a hub that starts and finds the file missing puts it back, and from what, isn't a criterion, and
  isn't tested.
- **"One event"** is read as one event naming `rules.json`. If the fix also records the rewrite as an install event
  that names the file, this reading counts two and fails; the issue says only that the hub "records that it was gone".
- **Which entry holds the call if the hub answers late after the fix.** With the file gone and the hub missing its
  20 ms, a fixed deep-hook would deny naming `rules.json` (AC1), not no-kill-by-name; AC3 sets such a run aside as
  INCONCLUSIVE instead of judging it.
- **Proof names `crates/deep-hook/tests/cli.rs` and a hub test.** Those are the implementer's unit tests; this suite
  is the acceptance tests only.
