# Acceptance tests for #2219: an entry deep-hook can't read stops only what its mode would

Written first, blind, from issue #2219 (body as created 2026-11-11T00:21:59Z and never edited: report, Scope, the 4
checkbox criteria, Proof, Depends on; no comments), the design sections it links ([Hook protocol (deep-hook and the
hub)], [Before each command]) with "Dogfooding" and "Built to be hard to get wrong", `AGENTS.md`, and base commit
`74e6e2634` (origin/main), by a job that never saw an implementation; none existed, and no other branch, worktree,
pull request or session's notes were read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 a watch entry, not fail_closed, `match` `effect:not-a-class`: `pkill -f node` denied naming no-kill-by-name, `ls` runs, hub up and down | `#2219.2d7325d2` | `entry-by-mode.test.ts` (2, hub up and hub down) |
| AC2 the same entry in block mode and fail_closed: `ls` denied, hub up and down, naming the entry and that deep-hook is older than it | `#2219.091a3d84` | `entry-by-mode.test.ts` (2, hub up and hub down); wrong program in `twins.json` |
| AC3 an entry with a seventh field `until` and a known `match`, read the same two ways, by its mode | `#2219.1b85eb34` | `entry-by-mode.test.ts` (2, one per mode, each hub up then down) |
| AC4 an entry whose `mode` is `stop`: every `PreToolUse` denied, naming the file, as today | `#2219.9b9e651b` | `entry-by-mode.test.ts` (1, hub up then down); wrong program in `twins.json` |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text in the live issue body. Each test's name
starts with its ID. Every criterion is decided by a vitest `expect` in the test file; setup and controls throw plain
`BLOCKED` or `INCONCLUSIVE` errors, so a broken setup or a loaded machine is never read as proof.

## What was read

- The issue; the text of #2204, #1097 and #2177, which it cites, for context only.
- `docs/technical-design.md`: the two linked sections, "Dogfooding", "Criteria to tests, both ways", "Criteria in a
  checked shape", "Wrong programs" and "Built to be hard to get wrong".
- At the base: `crates/deep-hook/src/main.rs` (`rules`, `guard`, `forward`, `exchange`, `spool_by`, `watchdog`,
  `unanswered`, `denials`), `crates/deep-hook/src/matcher.rs` (`known`), `crates/deep-hook/tests/cli.rs` (the two
  unreadable-rules tests), `crates/deep-hook/default-rules.json`, `packages/hub/src/server.ts` (`hook`, `reply`,
  `rules`), `packages/hub/src/core.ts` (`replayLate`, the replay's late check, `lateAnswered`, `appendReading`),
  `packages/hub/src/spool.ts`, `packages/hub/src/memory.ts` (`reaches`), `packages/contracts/schemas/tool.before@4.json`,
  `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (`twinsOf`, `atAssertion`).
- Suite `2204/` (helpers, README, twins) for the house format; its helpers are copied here with a note saying so.

## The surface

The real `deep-hook` (`target/debug/deep-hook`, built by the suite with `cargo build --locked -q -p deep-hook`) run as
Claude Code's hook entry runs it, `deep-hook claude-code PreToolUse` with a Bash payload on stdin; the real hub,
`node packages/cli/dist/main.js hub run`; `~/.deepbuild/rules.json` in a temp `HOME` under `/tmp/dh2219-*`; and the
record, read through the hub's socket as the cli role (`events.read`), with the hub's spool folder. Nothing is
imported from the packages, nothing stands in for the hook or the hub, and no call is ever executed: each is a hook
payload.

## Readings where the issue leaves a choice

- **A readable `rules.json`.** As in 2204: every home starts with `crates/deep-hook/default-rules.json` copied
  verbatim to `rules.json`, the file setup's `installRules` writes first, plus a `setup-finished.json` shaped as setup
  writes it. `deep setup` itself is not run. The shipped file holds no-kill-by-name (block, fail_closed).
- **"Gains an entry".** One entry added to the file's `entries`, as a newer hub's install would: the file written
  beside it and renamed over it. In the hub-up tests it is added while the hub runs, after the control; in AC1's and
  AC2's hub-down tests, after the hub is stopped. Each entry has the six guard@1 fields with `scope` `all_repos`, a
  reason and next step that hold no "older", "newer" or "rules.json", and a name that holds none of them either.
- **AC1's and AC2's entry.** `class-probe-2219`, `match` `effect:not-a-class`; watch and not fail_closed for AC1;
  "the same entry" for AC2 is the same name and `match`, in block mode and fail_closed.
- **AC3's entry, and "the same two ways, by its mode".** `until-probe-2219`, `match` `run:terraform apply` (one
  `matcher::known` accepts and neither call meets), the six fields plus `"until": "2099-01-01T00:00:00Z"`, a time far
  ahead so a reader that took it for an end date would still hold the entry. The two ways are AC1's and AC2's: in
  watch mode, not fail_closed, `ls` runs and `pkill -f node` is denied naming no-kill-by-name; in block mode and
  fail_closed, `ls` is denied naming the entry and that deep-hook is older than it; each with the hub up and then
  down, in one home. The `match` meets neither call, so only the Scope's "such an entry counts as matched on every
  `PreToolUse`" can deny `ls`: a hook that drops `until` and reads the entry by its `match` lets `ls` run in block
  mode and fails.
- **AC4's entry, and "every `PreToolUse`".** `stop-probe-2219`, `match` `run:terraform apply`, mode `stop`, not
  fail_closed, so a hook that reads the entry anyway lets `ls` run with the hub down as well as up. "Every" is read as
  the issue's two calls: `ls`, which no entry meets, and `pkill -f node`, which a fail_closed entry meets, each with
  the hub up and then down. "Naming the file" is `rules.json` in the output.
- **"Denied", "runs", "naming".** As in 2204: denied is what Claude Code reads as a denial of a `PreToolUse`, exit 2
  or a `deny`/`block` decision on stdout; runs is exit 0 with neither. Naming is a substring of everything the hook
  printed, stdout and stderr.
- **"That deep-hook is older than it".** Matched loosely, as 2204 matched "isn't JSON": the output holds "older" as a
  word, "newer than (this) deep-hook" or "newer deep-hook" (`OLDER` in `helpers.ts`), in the same output that names the
  entry. With the hub up, either side may say it: the hub's reply (for one, with a note deep-hook sends for the entry)
  or deep-hook's own denial.
- **"With the hub up".** The hub must have answered the hook: deep-hook decided on the hub's reply, not as with the
  hub away after the hub missed its 20 ms to acknowledge. `answered` in `helpers.ts` reads that from what deep-hook
  and the hub leave: deep-hook spools a request only when it decides without the hub, so a try counts as the hub's
  when deep-hook printed nothing about spooling it, no spool file holds it, the record holds its `tool.before`
  unmarked `late` (tool.before@4), and no `session.reading` names that event as let through late (the hub writes one
  when its own copy is in the record but deep-hook gave up and spooled a late copy). A try the hub was late for
  decides nothing, allowed or denied, and the call is made again: 20 tries or 5 minutes, then `INCONCLUSIVE`. This is
  stricter than 2204, which judged an allowed call as it stood; here a wrong hook could allow `ls` only when it acts
  as with the hub away, so an allow needs the hub's answer too. Each hub-up home passes 2204's control first: with the
  file readable, `pkill -f node` is denied naming no-kill-by-name on a try the hub answered (60 tries).
- **"With the hub down".** As 2204's "stopped": a hub that ran in that home, passed the control and was stopped by
  its PID. One try per call.
- **Assertions.** AC1 holds `ls` first, the criterion's named base failure, then `pkill -f node`. AC3 and AC4 run both
  hub states in one home and use `expect.soft`, so a failure with the hub up still shows the hub-down result.

## Open questions (not guessed, not tested)

- **Scope lines with no criterion.** That such an entry reaches the hub as matched (its `tool.before`'s `matched`
  naming it); a warn-mode entry deep-hook can't read; a block entry it can't read that isn't fail_closed, with the hub
  down (the Scope allows the call); an entry that isn't an object, or whose `fail_closed` can't be read (AC4 covers
  only `mode`); and calls of tools other than Bash. None is asserted.
- **The wording of "older".** A fix that says it otherwise, such as "predates" or "out of date", fails `OLDER`; that
  is a dispute for a redraft.
- **A fixed deep-hook that denies such an entry before the hub acknowledges.** If it exits at once and the call is
  then recorded `late`, every hub-up try here reads `INCONCLUSIVE`, never pass or fail. The Scope says "the hub rules
  it by its mode as it rules any matched entry", which is why this isn't expected; if the fix chooses otherwise, the
  reading of "with the hub up" above needs the owner.

## Run them

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$HOME/.local/bin:$HOME/.cargo/bin:$PATH   # when node, npm or cargo aren't on PATH
npm ci && npm run build --workspaces                  # once: the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook                  # warm; the suite runs it again, a no-op when fresh
npx vitest run --root tests/acceptance/2219 --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2219/tsconfig.json   # type-check
```

At the base, `npm run build --workspaces` exits 2: `tsc` reports TS2322 in `packages/hub/src/footprint-doctor.ts`
(`'footprint_unknown'` isn't one of the doctor's codes) for `packages/hub` and `packages/cli`. `tsc` still writes
`dist`, so the hub and the CLI run; the hub's next step, the macOS `deep-confirm` helper, isn't built, and these tests
don't use it.

One file, so its tests run in order. Each makes its own home, starts its own hub and stops it by PID; temp folders
are removed after each test. A loaded machine can make a test `INCONCLUSIVE` (above); rerun it alone.

## Base results

`BASE-FAILURE.txt` is the run of the whole suite at the base (7 tests: 6 fail, 1 passes, none blocked or
inconclusive; 4 s, at load average 38 / 110 / 143 on an 18-core Mac), then each twin's run. The suite ran once before
that, at load average 74 / 147 / 159, with the same results; `answered` was then made to count only a
`session.reading` as a late reading, rather than any event naming the call with the word "late", and the suite was
run again. No hub-up call came out `INCONCLUSIVE` in either run.

- **AC1 fails** (2), as it must: `ls` is denied, naming the file. With the hub up the hub had answered, and deep-hook
  printed "rules.json has an entry class-probe-2219 that isn't a guard@1 entry, so deep-hook matched this call
  against no guard"; with the hub down, "… so deep-hook can't check its guards while the hub doesn't answer".
- **AC2 fails** (2): `ls` is denied and the denial names the entry, in the base's words "has an entry
  class-probe-2219 that isn't a guard@1 entry", but nothing says deep-hook is older than it. On
  `twins/skips-unreadable-entry`, the criterion's planted hook, both tests fail at the denial: `ls` runs.
- **AC3 fails** (2): in watch mode `ls` is denied and `pkill -f node`'s denial names the file, not no-kill-by-name,
  with the hub up and down; in block mode the denial of `ls` names the entry but not that deep-hook is older, with
  the hub up and down.
- **AC4 passes**, as "as today" says. On `twins/mode-read-as-any` it fails at its first assertion: with the hub up,
  `ls` runs. See `twins/README.md`.
