# Acceptance tests for #2204: a rules.json deep-hook can't read, with the hub answering

Written first, blind, from issue #2204 (body last edited 2026-11-14T23:10:48Z: report, Scope, the 5 checkbox criteria,
Proof; its one comment of 2026-11-11, the owner's table of a run against a stand-in hub), the design sections it links
([Hook protocol (deep-hook and the hub)], [Before each command], [Threats, and what stops each one]) and Dogfooding,
`AGENTS.md`, and base commit `72fe11a11` (origin/main), by a job that never saw an implementation; none existed, and no
other branch, worktree, pull request or session's notes were read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | File (tests) |
|---|---|---|
| AC1 hub running, file cut to 40 bytes: `pkill -f node` denied, naming `rules.json` and that it isn't JSON | `#2204.64b12833` | `rules-unreadable.test.ts` (1) |
| AC2 hub running, one more entry with `match` `effect:not-a-class`: denied, naming the file and the entry | `#2204.722aff94` | `rules-unreadable.test.ts` (1) |
| AC3 hub stopped: each of the two files denies the call, as today | `#2204.7c1b9c13` | `rules-unreadable.test.ts` (2, one per file) |
| AC4 a `PostToolUse` with the cut file exits 0, hub up and down, and with a readable file `ls` runs | `#2204.7f8edc15` | `rules-unreadable.test.ts` (2, hub up and hub down); wrong program in `twins.json` |
| AC5 hub running: first call after the cut denied naming `rules.json`, file whole again, one event, then `pkill -f node` denied by no-kill-by-name and `ls` runs | `#2204.17dfce30` | `rules-unreadable.test.ts` (1) |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's text in the live issue body. Each test's name
starts with its ID. Every criterion is decided by a vitest `expect` in the test file; setup and controls throw plain
`BLOCKED` or `INCONCLUSIVE` errors, so a broken setup or a loaded machine is never read as proof.

## What was read

- The issue and its comment; the text of #1856 and #2042, which it cites, for context only.
- `docs/technical-design.md`: the three linked sections, "Wrong programs" and "How we know version 0 works".
- At the base: `crates/deep-hook/src/main.rs` (`rules`, `guard`, `forward`, `watchdog`, `unanswered`),
  `crates/deep-hook/tests/cli.rs` (`a_call_whose_guard_rules_cannot_be_read_is_denied`, `RULES`),
  `crates/deep-hook/default-rules.json`, `crates/deep-hook/Cargo.toml` (the `plant-*` features),
  `packages/hub/src/server.ts` (`reply`, `rules`), `guards.ts` (`addGuards`, `rewriteRules`), `setup.ts`
  (`installRules`, `finishedFile`), `packages/contracts/schemas/tool.before@4.json` (`late`),
  `scripts/proof-change.mjs` (`criterionId`), `scripts/proof-runs.mjs` (`asserted`, `atAssertion`, `twinsOf`).
- Suites `304/`, `1407/` (`redraft/`, `twins/`, `twins.json`) and `2497/` for the house format and helpers.

## The surface

The real `deep-hook` (`target/debug/deep-hook`, built by the suite with `cargo build --locked -q -p deep-hook`) run as
Claude Code's hook entry runs it, `deep-hook claude-code PreToolUse|PostToolUse` with a Bash payload on stdin; the
real hub, `node packages/cli/dist/main.js hub run`; `~/.deepbuild/rules.json` in a temp `HOME` under `/tmp/dh2204-*`;
and the record, read through the hub's socket as the cli role (`events.read`). Nothing is imported from the packages,
nothing stands in for the hook or the hub, and no call is ever executed: each is a hook payload.

## Readings where the issue leaves a choice

- **A readable `rules.json`, and "the first-party entries installed".** Every home starts with
  `crates/deep-hook/default-rules.json` copied verbatim to `rules.json`, the file setup's `installRules` writes first
  and suites 304 and 316 seed, plus a `setup-finished.json` shaped as setup writes it (`{version, at}`), since #1856,
  which AC5 leans on ("as #1856 has it put back"), speaks of a home after setup. `deep setup` itself is not run: it
  writes agent config and a login service. The owner's comment used `cli.rs`'s one-entry file; the shipped file also
  holds no-kill-by-name, and AC5 needs it.
- **"Denied".** What Claude Code reads as a denial of a `PreToolUse`: exit 2, or a `deny`/`block` decision on stdout.
  "Runs" is exit 0 with neither. "Naming" is a substring of everything the hook printed, stdout and stderr:
  `rules.json`, `no-kill-by-name`, the entry's name. "That it isn't JSON" is matched loosely
  (`isn't JSON`, `is not JSON`, `not valid JSON`); no other wording is held.
- **"Cut to its first 40 bytes".** The file's own first 40 bytes written over it.
- **AC2's entry.** A whole guard@1 entry named `newer-than-this-hook`, `match` `effect:not-a-class`, block mode, not
  fail_closed, added to the shipped file's entries.
- **"The same call" / "the first call" (AC5).** A `PreToolUse` for `pkill -f node`: "the next `pkill -f node`" reads
  as a second one.
- **"With the hub running".** The hub must have answered the hook, not merely be up: base deep-hook, when the hub
  misses the hook's 50 ms, already denies as with the hub away, in the same words, so a loaded machine would pass AC1,
  AC2 and AC5's first call on the base. So (a) each hub home passes a control first: with the file readable,
  `pkill -f node` is denied naming no-kill-by-name on a try the hub answered in time; (b) a denial counts only when the
  record's `tool.before` for that call (found by its `tool_use_id`) is not marked `late` (tool.before@4). A denial the
  hub was late for decides nothing: the file is spoiled and the call made again (10 tries; for AC5, whose first call
  can't be made twice, a fresh home, 5 tries), then `INCONCLUSIVE`. A call that is allowed is judged as it stands.
- **"With the hub stopped" (AC3, AC4).** A hub that ran in that home, passed the control and was stopped by its PID.
- **AC4's `PostToolUse`.** For a Bash `ls`, with Claude Code's `tool_response`. Only its exit status is held, as the
  criterion says; the readable-file `ls` is a `PreToolUse`, which must be allowed, in each of the two hub states.
- **AC5, "the file again holds every installed entry".** Within 10 s of the first call's hook exiting (the hub
  writes before it answers, but a hook that denies on its own may exit first), `rules.json` is JSON whose `entries`
  holds every entry of the shipped file, each equal to it. Other members (`proofs`, `classes`, more entries) are free.
  Before the cut the hub has answered a call from the readable file (the control), so a hub that learns the installed
  entries when it first reads them, and one that reads the shipped file, both pass.
- **AC5, "the record holds one event naming it".** Of the events appended after the cut, exactly one whose kind
  doesn't start with `tool.` holds the text `rules.json` anywhere in it. The calls' own `tool.before` events are set
  aside: a call's own event may carry the hook's words about the file, and the Scope keeps the call's path to the
  hub "as it does today". Counted after all three calls and a settle, so an event per call would show as three.
  The event's kind and fields are the implementer's.

## Open questions (not guessed, not tested)

- **Which event kind records it, and whether it may name the triggering call.** If the fix records the unreadable
  file only inside the call's own `tool.before`, AC5's count reads 0 and that is a dispute for a redraft.
- **A fixed deep-hook that denies before the hub acknowledges.** If it exits at once and the call is then recorded
  `late`, every hub-running try here reads `INCONCLUSIVE`, never pass or fail. The Scope says the call reaches the hub
  "as it does today", which is why this isn't expected; if the fix chooses otherwise, the reading of "with the hub
  running" above needs the owner.
- **A hub started on a home whose file is already unreadable**, which never read the installed entries: the criterion
  doesn't say what "installed" is then, and no test here starts a hub on a spoiled file.
- **AC1 under the fix also triggers the hub's rewrite**; nothing in AC1 or AC2 holds what the file is afterwards.
- **Scope lines with no criterion**: that the denied call still reaches the hub or the spool, and that `PostToolUse`
  leaves the file alone or not, are not asserted.

## Run them

```sh
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:$PATH   # when node, npm and cargo aren't on PATH
npm ci && npm run build --workspaces                  # once: the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook                  # warm; the suite runs it again, a no-op when fresh
npx vitest run --root tests/acceptance/2204
node node_modules/typescript/bin/tsc -p tests/acceptance/2204/tsconfig.json   # type-check
```

One file, so its tests run in order. Each makes its own home, starts its own hub and stops it by PID; temp folders
are removed after each test. A loaded machine can make a test `INCONCLUSIVE` (above); rerun it alone.

## Base results

`BASE-FAILURE.txt` is the one whole run at the base (7 tests: 3 fail, 4 pass, none blocked or inconclusive; 44 s, at
load average 52), then AC4's run on its twin.

- **AC1 fails**, as it must, for the issue's reason: with the hub answering and the file cut, `pkill -f node` exits 0
  with nothing printed; the failure names the call.
- **AC2 fails**, as it must: with the entry added, the same call exits 0 with nothing printed.
- **AC3 passes** (2), as "as today" says.
- **AC4 passes** (2), as "as today" says. On `twins/rules-read-on-every-event` laid over the base, its hub-down test
  fails at its assertion, naming the `PostToolUse` event (exit 2, the file's denial). See `twins/README.md`.
- **AC5 fails**, as it must: the first call exits 0, the file is left as it is (still 40 bytes), the next
  `pkill -f node` and `ls` both exit 0 unguarded, and no event names `rules.json`. Its `expect.soft`s report each.

An earlier run at load average 63, before the `late` reading was added, passed AC1 and AC2 on the base: the hub
missed every hook's 50 ms and deep-hook denied as with the hub away. That is why "with the hub running" is read as
above.
