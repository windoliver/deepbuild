# Acceptance tests for #352: the session map and notices

What each session is doing, told to the others through their own hooks, built from facts only and never from another
agent's text.

Written first, blind, by a job that never saw an implementation of #352 (none existed). Sources:

- **The issue**: its text as of 2026-11-04T19:38:42Z (`updatedAt`): Scope, the eight checkbox criteria (AC1 to AC8 in
  body order), Proof ("Scripted Claude Code and Codex sessions in two worktrees and the notices each received") and
  Depends on (#18, #39, #48, #237). The issues it names were read for scope only.
- **The design**, `docs/technical-design.md`: [Sessions that know about each other] (the session map, Telling the
  agent, Dry merges with Codex's patch path lines, Hard stops, Load, Safety, Agents side by side), [One event log, with
  tables built from it], Hook protocol (deep-hook and the hub), What each agent gives us (Claude Code's prompt origins
  `person`, `scheduled`, `subagent`, `session`, `continuation`; the asyncRewake waiter; words for a running turn as
  PostToolUse context), Hooks are evidence, not a state machine, [An ask, and your answer getting back] (Tasks only you
  can do: "I did it" re-runs the check), the Ask and Lease primitives, and How we know version 0 works. And `AGENTS.md`.
- **Redrafted blind** on 2026-11-04 for two disputes. First, AC2's failure message threw when nothing leaked
  (fixed). Second, main moved to `0c153d7c`. Its shipped heavy-command guard (#1015/#1016: `crates/deep-hook/src/heavy.rs`
  and `heavy.json`, `heavy.command@1`, `deep lease`) denies a bare whole-suite run such as `npm test` at PreToolUse. So
  the scripted sessions' test runs are now a focused `node --test tests/unit.test.js`, which matches no shipped entry
  (`deep-hook heavy` prints `null` for it, and the `npm test` entry for `npm test`). Each is still one tool call of
  the session, in the same place. No criterion, expected value or assertion changed. The branch now sits on
  `0c153d7c`.
- **Redrafted blind** on 2026-11-08 for one dispute, `load.test.ts` (AC4) only. Main (`e10229c1`) now carries the
  design's rule **Whose checks count** (#33): an approved check whose recorded read files are changed by the claim's
  diff counts for that claim as the agent's own check, which can send the claim back but never pass it, and "a check's
  own files are ... any other file its runs read under the repo's test, fixture and script folders"
  (`packages/gate/src/own.ts`, `OWN_FOLDERS`, `ownRead`). AC4's deliverable was `tests/ready-at.json`, which the
  timing check's test `tests/speed.test.js` reads: the claim's one change turned the approved check into the agent's
  own, so R1 was covered by the agent's checks alone and the verdict INCONCLUSIVE, never the PASS the criterion
  expects, whatever the timing rule did. The deliverable is now `src/ready-at.json`, read by the same test as
  `../src/ready-at.json`: the code under test, "an input for staleness, never an own file", so `speed.sh` stays an
  approved check. The check, its test, its assert line (`tests/speed.test.js:5`), the loads (9, then 1; the twin at 2),
  the 4 cores and every assertion are unchanged. No helper changed.
- **The base commit**: `e2e6e1cc` (origin/main, 2026-11-04), now `0c153d7c`. The base code read for its surfaces only:
  `packages/hub/src/core.ts` (`childOf` and `session.child_started`, `askFor` for `deep_ask` unblock tasks, `didIt`,
  `DEEP_HUB_TEST_CORES`, prompt origins), `server.ts` (the `DEEP_HUB_TEST_*` settings, the hook replies'
  `additionalContext`), `claude-settings.ts` and `crates/deep-hook/src/main.rs` (the waiter, the 50 ms
  acknowledgement), `packages/gate/src/exec.ts` (`runTiming`: a failure at a load above the cores is `uncounted` and
  rerun alone), `packages/checks-command/src/index.ts`, the schemas `run.finished@1`, `verdict.made@1`,
  `notice.sent@1`, `session.child_started@1`, and `adapters/claude-code.facts.json` (the UserPromptSubmit origin
  rules: `turnOrigin: peer` is origin `session`).
- **Sibling suites, for their conventions**: tests/acceptance/322 and 324 (the hub as a process, sessions through
  deep-hook, the record through `events.read`, `deep inbox answer`; 324's README is this one's model), 323 (this
  suite's helpers and agent stand-in are adapted from its: Claude Code and Codex sessions, `deep mcp`, unblock tasks),
  965 (peer prompts as Claude Code 2.1.304 writes them), 39 (Codex hooks), 29 (`runTiming`'s load rule), 237 and 567.

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 (`.node-version`) first on `PATH` and the Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook and the waiter run
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/352
node node_modules/typescript/bin/tsc -p tests/acceptance/352/tsconfig.json
```

- On Linux the check runner's sandbox (bwrap) sees only system folders, so the Node that runs vitest, whose folder
  every child's `PATH` starts with, must be one it can read (on the reference Linux box, `/var/tmp/deep40/node/bin`).
  AC4 and AC7 run checks; with a Node under the home folder their runs are refused and they stop `BLOCKED`.
- Each file starts hubs of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`). The
  implementer adds it; this job edits nothing outside this folder.
- Every test makes its folders under `/tmp/dl352-*` (a Unix socket path must fit in 104 bytes on macOS), sets `HOME`
  to `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`.
- It stops only processes it started, by PID (`helpers.ts`, `cleanup`), never by name or port.
- No network, no model, no `claude` or `codex` binary, no `gh` call. A child never inherits this process's billing
  keys, forge tokens or its `DEEP_*`, `GIT_*`, `XDG_*`, `CLAUDE*`, `CODEX*` or `OTEL_*` settings.
- **Load.** deep-hook waits 50 ms for the hub's acknowledgement; past it, it spools the event and lets the agent go on
  with an empty reply, and says so on stderr (`deep-hook: spooled …`). On a machine loaded far past its cores (this
  suite was written at a 1-minute load of 150 to 250 on 20 cores) most hooks come back that way, and nothing the hub
  meant to tell the agent reaches it. So every test reads the notices from the record first (`notice.delivered`, a
  failure when missing), and only then whether a hook's reply carried them; a reply that should have, but came back
  without the hub's answer, makes the test `INCONCLUSIVE`, never a pass (helpers.ts `toldMust`). Run it on a quieter
  machine to judge delivery. A spooled event reaches the hub with the session's next hook, so AC4's agent reads a
  file every 10 s while its definition drafts, as an agent does, for up to 10 minutes. No other assertion reads time except AC4's, where the test sets the load itself, and
  AC8's 10 minutes (a run whose 41 turns take longer is `INCONCLUSIVE`).

## The surface under test

The tests reach DeepBuild only through these:

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entry (`deep-hook claude-code <event>`)
  and as Codex runs it (`deep-hook codex <event>`), the hook's JSON on stdin, each a child of its session's own agent
  process (`fixtures/agent.mjs`). Payloads and transcripts are shaped like the corpus's and carry the newest version
  each agent's facts cover. **What the agent was told** by a hook is its reply's `hookSpecificOutput.additionalContext`
  (or plain stdout text), and a block's reason (stdout JSON, or stderr at exit 2).
- **The waiter**, `deep-hook claude-code waiter`, started after a Claude Code stop with the Stop's payload on stdin, as
  Claude Code starts setup's asyncRewake Stop entry. It exits 2 to wake the session, its stderr what the session is
  told (AC7).
- **`deep mcp`**, the session's own MCP server, a child of its agent process: `deep_ask` for an unblock task (AC7).
- **`deep hub run`** with the base's test settings `DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS`,
  `DEEP_HUB_TEST_STOP_HOLD_MS` (20 s) and `DEEP_HUB_TEST_CORES` (4), and one new one, `DEEP_HUB_TEST_LOAD` (below).
- **The record** through `events.read` on the socket (the cli role, the control token): `session.start`,
  `session.child_started`, `user.ask` (its `from`, the prompt's origin), `claim.made`, `definition.locked`,
  `run.started`/`run.finished`, `verdict.made`, `ask.created`, and the new `notice.delivered` (below).
- **Your terminal**, the test process, outside every session's process tree: `deep inbox answer <ask> <option>` (#24)
  and the new `deep race <issue>` (below).
- **Git**: the test makes each session's worktree (`git worktree add`), each session's commit when its shell call runs
  `git commit` (as the call's effect), and each pull request's merge into main in the repo's own checkout.
- **The projects' trust decision** as #348 records it (`openTrust` over the record before the hub starts), for the
  repo and each worktree, and Claude Code's workspace trust for each in `~/.claude.json`.

### SURFACE

Where neither the issue nor the design names a surface, the smallest one that fits how the hub already names things.
The tests read nothing else.

```
SURFACE (#352, written blind against e2e6e1cc; unchanged at 0c153d7c)

1. notice.delivered@1 — the core appends one when it hands a notice to a session, once per notice:
     session: the receiving session's ID (as its own events carry it)
     data: {
       notice:  "notice:<id>",
       type:    "interface" | "dependency" | "behavior" | "test" | "configuration",
       source:  the sibling session's ID or handle (session:<letters>), or null,
       target:  the receiving session's ID or handle (optional when `session` names it),
       files:   repo-relative paths the notice is about ([] when none),
       pr:      the merged pull request's number, or null,
       via:     the hook event whose reply carried it, or "waiter",
       text:    the notice exactly as the agent was handed it
     }
   `text` appears verbatim in what that hook told the agent: its reply's hookSpecificOutput.additionalContext
   (or, for a woken Claude Code session, the waiter's stderr at exit 2). It names its type in its own words (the
   word itself, not only inside a file name), the sibling by its session ID (its first 8 characters do), and only
   facts: paths, issue and PR numbers, line ranges, session names. A merge's notice also says to rebase.

2. A session's issue is the number in its worktree's branch: `issue-<n>` anywhere in the branch name
   (claude/issue-77-cart, codex/issue-77-total).

3. A merge is read from the repository itself: main, in the repo all worktrees share, gains GitHub's merge commit
   of a branch a session worked on, first line `Merge pull request #<n> from <owner>/<branch>` (the PR's number is
   read from that line only; the PR's title in the body is the agent's text). The hub may read it when it lands or
   at the session's next hook; the tests leave 10 s after the merge before that hook.

4. A lead's own child session is a session whose agent process the lead's agent process started (what the base
   records as session.child_started).

5. `deep race <issue>`: you start a race on an issue from your terminal (exit 0). Sessions on that issue then race:
   they settle on the first PASS and raise no "keep which?" ask.

6. A timing check: a handed requirement with `timing: true` (DEEP_HUB_TEST_DRAFTS) makes its check a timing check.

7. DEEP_HUB_TEST_LOAD=<file>: the machine's 1-minute load average the hub reads, as a number in the file, read
   afresh at every reading; only tests set it. With DEEP_HUB_TEST_CORES (the base's), the hub's "load past its core
   count" is the file's number against that count. The run under load is recorded with the reading, as gate's
   runTiming keeps it: an event naming the run (its run.finished, a new major of it, or one of its own) with
   `under_load: true` and `load: <the reading>`, and the verdict's data names that run.
```

### Playing the agents

Each session has its own long-lived agent process, `fixtures/agent.mjs` (323's, with one addition), the parent of
every deep-hook run of that session, its waiter and its one `deep mcp`, so the hub binds each to the session. A child
session a lead starts is a second copy of it started by the lead's copy (`child`), so the child's process descends from
the lead's. A call runs only when PreToolUse allows it; then its effect is made on disk and PostToolUse fires. A Claude
Code Edit reports its `structuredPatch` (the line range it changed). A Codex edit is `apply_patch` with the raw patch as
`tool_input.command`, and its effect is made by the test. A message from another Claude Code session is a peer prompt:
its transcript entry has `turnOrigin: peer` and `origin: { kind: peer, from: local_<sender's session ID>,
hostInjected: true }` (965's shape), which the facts map to origin `session`.

### The world

`<tmp>/repo`, a git repository with one commit on main: `src/cart.js` (a `total` and a `// end of cart` marker line),
`tests/unit.test.js`, `.deepbuild/done.yaml` (the `unit` check, which passes), `package.json` and the files a test
adds. No session works in it; it is where pull requests merge. Each session works in a worktree `<tmp>/<name>` on its
own branch.

### Readings where the issue leaves a choice

1. **"Told at its next tool call"** (AC1): the replies of that call's PreToolUse and PostToolUse carry the notice.
   The notice names the sibling, the PR, every file the session changed that the merge touched, never a file it
   didn't change, and says to rebase.
2. **Codex's paths** (AC1): the session works through a symbolic link to its worktree, and its patch names
   `lib/../src/cart.js` (Update File), `src/old-price.js` moved to `lib/../src/price.js` (Move to) and `src/legacy.js`
   (Delete File), left uncommitted, so the hub knows them from the patch's path lines alone. A merge touching
   `src/cart.js`, `src/price.js`, `src/legacy.js` and `src/other.js` must name the first three, not the fourth.
3. **"Text written by another agent"** (AC2): a Codex sibling's prompt, its messages in the rollout, the lines its
   patch adds, its shell command and output, its commit message, its last words and its PR's title, each carrying a
   marker (`PLANT<hex>`). No `notice.delivered` and nothing the other session was told may hold a marker, while that
   session hears of the sibling at all three moments the issue names (start, before an edit, after a merge).
4. **"Names its kind"** (AC3): `type` is one of the five, and the text says it in its own words. After a merge over
   `package.json` and `tests/cart.test.js`, the notice about `package.json` is a dependency change and the one about
   the test file a test change: one notice per kind, so a single notice can't hide two kinds.
5. **"Rerun alone once; the rerun decides"** (AC4): the check fails until a time the agent's change writes (90 s on)
   while the load reads 9 on 4 cores; once that time has passed the test sets the load to 1. Exactly two runs on the
   claim, the second started after the load dropped; the verdict PASS; the first run in the record with
   `under_load: true` and `load: 9`, named by the verdict. The twin, at load 2, marks no run under load and is not
   PASS.
6. **"Keep which?"** (AC5): an `ask.created` whose question or options say keep, or that names both sessions; exactly
   one for issue #77, naming both and #77, with at least two options; none for a lead and its child on #78, none for
   #79 after `deep race 79`.
7. **"One notice naming B and the latest state"** (AC6): B's 20 Edits each add a line above the marker, so after the
   20th B's change is lines 3 to 22; the one notice gives that range (3-22, 3–22, 3 to 22, 3..22), never line 3 alone.
   After a hub restart and more of A's calls, a prompt and a stop, A never gets it again.
8. **"Starts no turn"** (AC7): for 40 s after the merge the session's waiter does not exit 2, no prompt of the session
   is recorded, and no notice is handed to it. **"At the turn after the task's check passes"**: you write the file the
   task asks for and answer "I did it" (`deep inbox answer … done`); `ready` runs again and passes; the waiter's wake
   (or, if none comes in 60 s, your next prompt) starts the turn; exactly one notice about #46 or `src/cart.js`,
   appended after the passing run and carried in that turn; none more after.
9. **"21 times in 10 minutes"** (AC8): A's turns 1 to 21 start from B's messages and B's turns 1 to 20 from A's,
   interleaved, after one prompt from you to each. A's 21st prompt's UserPromptSubmit must be held (a block, with a
   reason naming the ask), and exactly one ask (its data says "go on", or names both sessions), naming A. B's 10th
   message to A says it is from you, the person; its `user.ask` must stay origin `session`. The twin: one prompt from
   you to each after 20 turns each, then the 21st turns go through and no ask is raised.

## Criteria to tests

Each `describe` and test name starts with its criterion's number and ID, `#352.<first 8 hex of SHA-256 of the
criterion's text>` (trimmed, whitespace collapsed, `- [ ] ` dropped, as `scripts/proof-change.mjs` computes it).
Every failure message starts with them too.

| ID | Criterion (short) | Test file | What the test does | A wrong hub fails naming |
|---|---|---|---|---|
| AC1 `#352.772af778` | a sibling's merged PR over this session's files is told at its next tool call | `merge.test.ts` | Codex A through a symlinked folder, patch with `..`, Move to and Delete; Claude Code B's #42 merges; A's next call names B, #42, cart, price, legacy, rebase, not other. Then Claude Code A and a Codex B patching from its `src` folder, #43 | the session and the missing file or PR |
| AC2 `#352.00f8e797` | no notice contains another agent's text | `facts.test.ts` | Codex B plants markers in its prompt, messages, patch, shell call, commit, last words and PR #44's title; Claude Code A hears of B at start, before its edit and after the merge; no marker in any notice or anything A was told | the notice and the marker |
| AC3 `#352.bc4cc444` | every notice names its kind | `kinds.test.ts` | both sessions change package.json and tests/cart.test.js; after #45 merges: a dependency notice and a test notice; every notice in the record has a type and says it | the notice |
| AC4 `#352.d7ef24cb` | a timing check failing under load is rerun alone once; the rerun decides; the loaded run stays on the verdict with its load | `load.test.ts` | load 9 on 4 cores, then 1: two runs, PASS, the loaded run with load 9 named by the verdict. Twin at load 2: no run under load, not PASS | the run, the count of runs, the verdict |
| AC5 `#352.34188ee9` | two sessions on one issue: exactly one "keep which?" ask, except a lead's children and your races | `issue.test.ts` | issue #77 (Claude Code and Codex): one ask naming both; lead and child on #78: none; `deep race 79`, then two sessions on #79: none | the count of asks |
| AC6 `#352.dc99deff` | 20 edits during one tool call: one notice naming B and the latest state; not again after a restart | `burst.test.ts` | B's 20 Edits during A's `node --test tests/unit.test.js`; A's next call; one notice naming B and lines 3-22; hub restart; never again | the count of notices |
| AC7 `#352.774fd160` | BLOCKED on an unblock task: no turn on a merge; told once, at the turn after the check passes | `blocked.test.ts` | A raises its task and stops, its waiter waiting; B's #46 merges; 40 s: no wake, no turn, no notice; you do the task, "I did it", `ready` passes; the next turn carries the notice once | the session |
| AC8 `#352.560c6d85` | 21 turns from each other's messages in 10 minutes: one ask, the 21st prompt held; your prompt resets | `loop.test.ts` | A's 21st peer turn held with one ask, B's 10th message planted as yours; twin: your prompts at 20 reset the count | the session (21st let through) and the planted message |

The issue's Proof is these scripted Claude Code and Codex sessions in two worktrees, and the notices each received
(the record's `notice.delivered` and the replies), each test failing first on the base (`BASE-FAILURE.txt`). The issue
names no planted wrong program; each criterion's wrong hub is the in-test twin or the planted case the table names.

## What this suite could not encode

- **Dry merges and hard stops** (the design's `git merge-tree` between branch tips, "whether their branches conflict",
  migration numbers, leases) are in the issue's Scope with no criterion of their own; no test asserts whether branches
  conflict, a deny, or a lease.
- **The session map's other columns** (running commands, leases, state) and the map as a query: no criterion reads
  them, so no query surface is defined; the map shows only through the notices it drives.
- **Waking an idle Claude Code session** for a notice it should get (Scope): no criterion asks for it; AC7 checks
  only that a BLOCKED session is not woken.
- **Codex's next message** as the delivery point: AC1's Codex session hears at its next tool call; a notice at
  UserPromptSubmit is read the same way but not set up on its own.
- **AC8's hold for an adapter with no route to hold a prompt** (watch-only for the rule, saying so), the pair named in
  one ask when the facts name the sender, and the count surviving a hub restart: in Scope, not in the criterion.
- **A notice that replaces an older one on the same merged PR** (Scope): AC6 covers the same file and sibling only.

## Files

- `helpers.ts`: the world, worktrees, symbolic links, commits and merges, trust, the hub as a process, `events.read`,
  the agent processes, Claude Code and Codex sessions (hooks, peer prompts, tool calls, patches, the waiter, `deep
  mcp`), what a reply told the agent, the notice readers, `deep inbox answer` and `deep race`, planted text.
- `fixtures/agent.mjs`: each session's agent stand-in, the parent of its deep-hook runs, its waiter, its `deep mcp`
  and, for a lead, its child sessions' agent processes.
- `merge.test.ts` (AC1), `facts.test.ts` (AC2), `kinds.test.ts` (AC3), `load.test.ts` (AC4), `issue.test.ts` (AC5),
  `burst.test.ts` (AC6), `blocked.test.ts` (AC7), `loop.test.ts` (AC8).
- `tsconfig.json`: #323's (the root's strict options with `noEmit` and `allowImportingTsExtensions`).
- `BASE-FAILURE.txt`: the run on the base commit, trimmed to each test's failing assertion.

[Sessions that know about each other]: ../../../docs/technical-design.md
[One event log, with tables built from it]: ../../../docs/technical-design.md
[An ask, and your answer getting back]: ../../../docs/technical-design.md
