# Acceptance tests for #2568: a rules.json pi can't have read, with the hub answering

Written first, blind, from issue #2568 (body last edited 2026-11-22T10:06:27Z: report, Scope, the 4 checkbox criteria,
Proof; no comments), the design sections it links ([Hook protocol (deep-hook and the hub)], [Before each command],
[Threats, and what stops each one]) and Dogfooding, `AGENTS.md`, and base commit `2eaaeb0e6` (origin/main), by a job
that never saw an implementation; none existed, and no other branch, worktree, pull request or session's notes were
read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

| AC | ID | File (tests) | On the base |
|---|---|---|---|
| AC1 hub running, file cut to its first 40 bytes: a pi `tool_call` for `pkill -f node` blocked, naming `rules.json` and that it isn't JSON | `#2568.3ae12f6f` | `pi-rules-unreadable.test.ts` (1) | fails: the package lets the call run |
| AC2 hub running, setup finished, file removed, a hub that never read it: the same call blocked naming `rules.json` | `#2568.8523ddc0` | `pi-rules-unreadable.test.ts` (1) | fails: the package lets the call run |
| AC3 hub stopped: each of those two states blocks the call, as today | `#2568.2ab07f36` | `pi-rules-unreadable.test.ts` (2, one per state) | passes |
| AC4 readable file, hub running: a call a fail_closed entry matches is decided by the hub's reply, as today, and `ls` runs | `#2568.4918d42c` | `pi-rules-unreadable.test.ts` (1); wrong program in `twins.json` | passes; fails on its twin |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text in the live issue body. Each test's name
starts with its ID. Every criterion is decided by a vitest `expect` in the test file; setup and controls throw plain
`BLOCKED` or `INCONCLUSIVE` errors, so a broken setup or a loaded machine is never read as proof.

## What was read

- The issue; #2204 and #1856, which it cites, for context only.
- `docs/technical-design.md`: the three linked sections and Dogfooding ("Who drafts it").
- At the base: `packages/pi/src/index.ts` (`Matcher`, `read`, `sendHook`, the `tool_call` handler),
  `crates/deep-hook/src/main.rs` (`rules`, `denials`, `matching`), `crates/deep-hook/default-rules.json`,
  `packages/hub/src/server.ts` (`rules()`, where it is called, the staged matches), `packages/hub/src/staging.ts`
  (header), `packages/hub/src/products.ts` (`secure`), `packages/hub/src/guards.ts` (`addGuards`),
  `packages/hub/src/setup.ts` and `service.ts` (that setup with a hub answering installs no login service),
  `packages/hub/src/paths.ts` (`deepHook`), pi 1.4.0's `core/extensions/runner.js` (`emitToolCall`) and
  `core/tools/bash.js`.
- Suites `2204/`, `1856/` (format, twins), `40/` (helpers, fixtures), `1294/` (README) and
  `packages/pi/test/guards.test.ts` (driving real pi with the package).

## The surface

Real pi 1.4.0 (`DEEP_PI_CLI`, its `dist/cli.js`) in RPC mode with `-e packages/pi` (the package as built by
`npm run build --workspaces`) and #40's scripted model (`../40/fixtures/scripted-provider.ts`), so each model turn is
one `bash` tool call; the real hub, `node packages/cli/dist/main.js hub run`; `deep setup` run for real on a temp
`HOME` under `/tmp/dh2568-*` while a hub answers (so it installs no login service), which writes `rules.json`,
`setup-finished.json` and the deep-hook it records in `config.json`, checked to be `target/debug/deep-hook`; and the
record, read through the hub's socket as the cli role (`events.read`). The socket client, `childEnv` and pi's version
check are imported from `../40/helpers.ts`, as `packages/pi/test/guards.test.ts` does.

**No kill ever runs.** A pi call the package lets through would run `pkill -f node` on this machine. So
`fixtures/net.ts`, a pi extension loaded after the package, blocks any `pkill` call that reaches it, in words of its own;
pi stops at the first `tool_call` handler that blocks (`emitToolCall`), so it sees a call only when the package let it
through. The tests read its words as "the package let the call run". As a second guard every child's `PATH` starts
with a `pkill` that only leaves a file. Processes are stopped only by their own PID; temp homes are removed after each
test.

## Readings where the issue leaves a choice

- **"Blocked"** is pi's `tool_execution_end` with `isError` and not the net's words. **"Runs"** is that event without
  `isError`. **"Naming"** is a substring of the end's result: `rules.json`. "That it isn't JSON" is matched loosely
  (`isn't JSON`, `is not JSON`, `not valid JSON`); no other wording is held.
- **"Cut to its first 40 bytes"**: the file's own first 40 bytes written over it.
- **"With the hub running" (AC1) means a hub that never read the whole file.** The base's hub writes a spoiled
  `rules.json` back as it last read it at every hook's connection (`server.ts`, `rules()`, #2204), and pi's package
  sends hooks (the prompt, the run's start) before deep-hook reads the call. The first run here cut the file between
  two prompts and the hub had written it back before the call was read: the call was blocked by no-kill-by-name, and
  the state the criterion names never reached `deep-hook match`. So each hub-running test makes the state under a
  second hub: a pi session after setup passes a control on the first hub, that hub is stopped by its PID, the file is
  spoiled, and a second hub starts on the same home, which never read it. The file is checked unchanged (AC1) or gone
  (AC2) a second after a probe connection and again just before the call; otherwise `BLOCKED`.
- **AC2, "removed".** The base's hub installs its product-store entry at start (`products.ts`, `secure`), and with no
  `rules.json` that writes a file holding only `no-product-store-write`. That file, if it appears within 10 s of the
  second hub's start, is removed too: the criterion has the file gone, and the hub's own reader never read it.
- **"The hub answered" (AC1, AC2, AC4).** pi's package waits up to 15 s for the hub's reply and then decides as with
  the hub away, in the same denial words, so a hub that missed would block AC1 and AC2's call on the base too. A
  blocked call counts only when the record holds its `tool.before` (found by its tool call ID; the Scope says the call
  still reaches the hub) and it ended within 12 s; otherwise `INCONCLUSIVE`. A call that ran is judged as it stands.
  The control (whole file, first hub) must be blocked by no-kill-by-name in the hub's words, not the hub-away ones
  ("which holds while the hub doesn't answer"), within 12 s and on the record.
- **"With the hub stopped" (AC3).** A hub that ran in that home and was stopped by its PID before the file was spoiled;
  pi starts after. Only "blocks the call" is held, as the criterion says; the words are today's.
- **AC4's call.** "A call a fail_closed entry matches ... decided by the hub's reply": the call must be one the hub
  lets run, or a package that blocks on every denial (the criterion's wrong program) can't be told from the base. All
  shipped fail_closed entries are block mode; of them, the hub decides a discard of edits by staging it, and on a clean
  tree it runs free (`staging.ts`). So the call is `git checkout -- a.txt` in a git repository whose one committed
  file is unchanged. Its premise is checked with the real `deep-hook match` first: a fail_closed entry
  (`no-discarding-edits`) matches it and it carries a hub-away denial; otherwise `BLOCKED`. "`ls` runs" is a second call
  in the same run (a run that did work ends in the hub's stop hold, which a second prompt would wait behind), and its
  output lists `a.txt`.

## Open questions (not guessed, not tested)

- **A hub that read the whole file, with the file cut just before the call** (no hook between the cut and deep-hook's
  read). That needs the cut placed inside a model turn; it isn't tested, since a hook sent after the cut makes the hub
  write the file back first. Whether the issue means that case too is the owner's.
- **On the base, a hub started after `rules.json` was removed writes a `rules.json` holding only its product-store
  entry**, so `pkill -f node` matches nothing and runs, through every agent's hook, with no denial naming the file.
  That is not this issue's path (`match` answers no denial then), and AC2 removes that file as above. It looks like a
  bug of its own, noted here for the owner, not tested.
- **Scope lines with no criterion**: that the blocked call's end is said (a `tool.after`, failed) and what `deep-hook
  match` prints to tell a rules denial from a fail_closed entry's are not asserted. The Proof names
  `crates/deep-hook/tests/cli.rs` and `packages/pi/test/guards.test.ts` for those; they are the implementer's tests.
- **AC1's denial words under the fix** may name the file as deep-hook does (`~/.deepbuild/rules.json isn't JSON`) or
  otherwise; only `rules.json` and the loose "isn't JSON" are held.

## Run them

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH   # when node, npm and cargo aren't on PATH
npm ci && npm run build --workspaces                  # the hub, the deep CLI and the pi package the tests start
cargo build --locked -q -p deep-hook                  # target/debug/deep-hook, which setup records; not built by the suite
DEEP_PI_CLI=<dir>/node_modules/@earendil-works/pi-coding-agent/dist/cli.js \
  npx vitest run --root tests/acceptance/2568           # pi 1.4.0; another version or none is BLOCKED
node node_modules/typescript/bin/tsc -p tests/acceptance/2568/tsconfig.json   # type-check
```

One file, so its tests run in order. Each makes its own home and hubs and stops them by PID. A loaded machine can make
a test `INCONCLUSIVE` (above); rerun it alone. Setup picks the newer of `target/release/deep-hook` and
`target/debug/deep-hook`; a newer release build reads `BLOCKED` here, as the tests run the debug one.

## Base results

`BASE-FAILURE.txt` is the one whole run at the base (5 tests: 2 fail, 3 pass, none blocked or inconclusive; about
13 s, at load average about 9), then the run on AC4's twin.

- **AC1 fails**, as it must, for the issue's reason: with the hub answering and the file cut, the package lets
  `pkill -f node` through (the net's words); the failure names the call.
- **AC2 fails**, as it must: with the file gone under a hub that never read it, the package lets the same call through.
- **AC3 passes** (2), as "as today" says: the package blocks on deep-hook's denial with the hub away.
- **AC4 passes**, as "as today" says. On `twins/blocks-on-every-denial` laid over the base it fails at its assertion,
  naming `git checkout -- a.txt` (blocked by no-discarding-edits' hub-away denial though the hub answered), while AC1,
  AC2 and AC3 pass there. See `twins/README.md`.
