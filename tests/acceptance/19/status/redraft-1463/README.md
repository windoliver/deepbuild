# Blind redraft of #19 AC8: `deep status` with 30 sessions

Written blind at base `32628dba` (Merge pull request #2095) from issue #19, the design and the base, by a fresh run of
the blind acceptance-test job (AGENTS.md, Proof; design, Dogfooding) for one criterion. It never saw an
implementation of a change, a plan or a session transcript. It edits no file outside this folder; `../helpers.ts` is
imported as it is.

The criterion, AC8 of the issue's 25 in body order, ID `#19.21db8bc2` (`criterionId` in `scripts/proof-change.mjs`:
`#19.` plus the first 8 hex of the SHA-256 of the text, trimmed, white space collapsed; recomputed here from the
issue's `- [x]` line and it matches):

> `deep status` with 30 sessions shows every session that needs you, is stuck or is flagged within its first 20 lines

## What was read

- AGENTS.md; issue #19 (`gh issue view 19`: Scope, its 25 criteria, Proof, Depends on).
- `docs/technical-design.md`: the deep CLI row of the components table; Hook protocol (deep-hook and the hub); Socket
  roles and contract versions; Hooks are evidence, not a state machine; States people see (the words, the one row
  shape `deep status` reads); Sessions that know about each other (what the session map flags, and Agents side by
  side: honest liveness, one reason a row); An ask, and your answer getting back.
- At the base, to know which hooks a hub takes and what it does with them, not to choose expected values:
  `adapters/claude-code.facts.json` (`versions`, `stop.cause`), `adapters/corpus/README.md` and the 2.1.308
  recordings `tools`, `permission-answered`, `stop-failure` and `crash` (payload shapes); `packages/hub/src/status.ts`;
  in `packages/hub/src/core.ts` the session watch (which process a session is bound to, `goneSessions`) and the quiet
  timers; the permission hold in `packages/hub/src/server.ts`; `packages/hub/src/hook-programs.ts`; the session
  status lines of `packages/record/src/projections.ts`.
- The #19 status folder: `../helpers.ts` (imported), `../canary.test.ts` (how it drives deep-hook against a real hub),
  the head of `../README.md`. The earlier AC8 seeding in `../helpers.ts` (`Seeder`, `THIRTY`, `judgeStatus`) was read
  and is not used: this redraft drives live sessions through deep-hook instead of writing the record.
- `tests/acceptance/1459/README.md` and `tests/acceptance/34/redraft-1579/` for the layout.

## How to run

With Node 24.22 first on `PATH` (`.node-version`), cargo, git, macOS or Linux:

```sh
npm ci                                       # once, if node_modules is missing
npm run build --workspaces                   # the test runs packages/cli/dist/main.js and the hub it starts
cargo build --locked -q -p deep-hook         # the test builds it too, before its first session
npx vitest run tests/acceptance/19/status/redraft-1463 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/19/status/redraft-1463/tsconfig.json
```

Two tests, no model and no network. The first starts a real `deep hub run` and 30 `sh` stand-in agents and takes
one to two minutes; the second is the judge on its own and needs nothing built. Every folder is under `/tmp/dh19t-*`
(`../helpers.ts`' `makeHome`: HOME is `<tmp>/h` for every process, nothing touches the real `~/.deepbuild`,
`~/.claude` or `~/.codex`). Every process it starts is stopped by PID; nothing is stopped by name or port.

**Not run.** This job built and ran nothing (the Mac is shared and the worktree had no `node_modules`), so neither
test nor the typecheck has been run, at the base or anywhere, and there is no `BASE-FAILURE.txt`.

## The surface, and what the implementation must provide

The issue names `deep status` and the design names deep-hook, the hook protocol and `events.read`; the rest is pinned
here.

1. `deep status`, with no arguments, run by you (a child of the test, under no agent) with the hub up, prints its
   listing on stdout. "Its first 20 lines" are the first 20 `\n`-separated lines of stdout, whatever they hold: a
   header, counts, repo names and rows all count.
2. A session is named on a line by the first 8 characters of its session ID as its agent minted it (lower-case hex),
   which its full ID, its letters-only handle and a `deepbuild://session/<id>` link all hold; a line holding the
   session's own prompt text counts too. A session is shown at the first line that names it.
3. Sessions reach the hub through the built `deep-hook claude-code <Event>`, run as a child of the agent's process
   with the hook's JSON on stdin (Claude Code 2.1.308's payload shapes, `adapters/corpus/claude-code`), the hub at
   `~/.deepbuild/hub.sock` under the test's HOME, `rules.json` present and no `deep setup` run, as `../canary.test.ts`
   drives it. Every hook exits 0.
4. These read as needing you, stuck or flagged (any of the three; the test doesn't judge which word): a Claude Code
   session whose last hook was a `PermissionRequest` with nothing after it, its prompt still open, read within two
   minutes of it; one whose turn ended with a `StopFailure` whose `error` is `authentication_failed`, `rate_limit` or
   `billing_error`; and one whose agent process was killed after its `PreToolUse`, with no `PostToolUse`, `Stop` or
   `SessionEnd`, read within 60 s of the kill.
5. A session whose agent sends a Bash `PreToolUse` and its `PostToolUse` every few seconds is not read as needing you,
   stuck or flagged, and 24 of them never push one of the sessions in item 4 past line 20.
6. `events.read` on the control socket (#16, `../helpers.ts`' `events`) returns events that name each session's ID
   once its hooks reached the hub; the test waits up to 30 s for all 30 and is BLOCKED otherwise.

### Merged surfaces, used as they are

`deep hub run` and its ready line in `<root>/logs/hub.log` (`startHub`), the control token and `events.read`
(`events`), `deep <args>` as a child process (`deep`), `cargo build -p deep-hook` (`buildDeepHook`), temp homes with
stand-ins for `claude`, `codex`, `launchctl` and `systemctl` (`makeHome`), PID cleanup (`own`, `cleanup`), all from
`../helpers.ts`.

## The fixture

Four git repos (`git init`, no commits) under `<tmp>/src`, each session in its own `pkg-<n>` folder, its transcript
under `~/.claude/projects/` holding its prompt's entry (version: the newest the facts cover), each session its own
stand-in agent process, `agent.sh`, which runs its hooks as Claude Code runs a hook entry and then stays alive:

| Repo | Sessions | What they are | IDs start |
|---|---|---|---|
| `alder` | 12 | working: SessionStart, UserPromptSubmit, a Bash `PreToolUse`, then a `PostToolUse` and the next `PreToolUse` every 3 s until stopped | `0`–`e` |
| `birch` | 10 | working, the same | `0`–`e` |
| `cedar` | 2 working, 3 attention | an open permission prompt for a Write; a `StopFailure` with `authentication_failed`; one with `rate_limit` | `f` |
| `delta` | 3 attention | an open permission prompt for a Bash call; a `StopFailure` with `billing_error`; an agent killed by SIGKILL after its `PreToolUse` (`npm run e2e`) | `f` |

The 24 working sessions start first, six at a time; the six start after all of them, and the working ones keep calling
tools after the six have sent their last hook. So in start order, ID order, repo-name order and newest-activity-first
order, every one of the six comes after at least 22 other rows. The test then reads `deep status` once a second for up
to 60 s (the hub notices a killed process on its own clock) and passes on the first read in which all six are named
within the first 20 lines.

## Criterion to tests

| Criterion | ID | Test | What counts as failure |
|---|---|---|---|
| AC8 | `#19.21db8bc2` | `thirty.test.ts`: with 30 live sessions over four repos, `deep status` names every session that needs you, is stuck or is flagged within its first 20 lines | for 60 s, every read leaves one of the six unnamed, or first named on line 21 or later; the message names each such session, what it is, its repo and its line, with the output |
| AC8 | `#19.21db8bc2` | `thirty.test.ts`: (wrong programs) the judge on this fixture | the judge passes a listing in start order, by ID, by repo then ID, by repo with attention first only inside each repo, or newest activity first; or fails one with the six first |

### Wrong programs it fails

- A listing in the order sessions started, by ID, by repo name (attention first only inside a repo, too), or newest
  activity first: each puts the six after 22 or more rows (the second test checks each on the judge).
- A status that reads a failed stop as finished, or the killed agent's session or an open permission prompt as working,
  and lists it after the working sessions in any of those orders: it lands past line 20 behind `alder` and `birch`.
- A status that folds a failed stop or a gone session into a quiet count, or leaves it out: the session isn't named.
- A status that reads the working sessions as stuck or flagged too, listing 30 attention rows: the `delta` ones fall
  past line 20.

## Scope not covered

- Codex sessions (#19 tests Codex's hook entries with its adapter, #39, in week 5).
- Asks raised by `deep_ask` (a `deep mcp` bound to the session) or by the core; the session map's flags for two
  sessions on one issue and for an idle session whose commits are on no remote branch.
- The rest of the `deep status` scope line (grouping by repo, quiet sessions folded into one line, which hub it reads,
  the hub down) and the state words; other tests of the #19 status folder cover them.
- A status that misreads one of the six as working and lists working sessions oldest activity first would show it in
  time and pass for that session.

## Assumptions a redraft may revisit

1. **The three states are judged as one set.** The criterion asks only that each is within 20 lines, so the word each
   of the six reads isn't judged. The design flags a usage limit hit ("Sessions that know about each other") where a
   reader of the issue might call it stuck; either passes.
2. **An open permission prompt needs you.** The design: a permission request "still becomes an ask you see", and
   needs you is an open ask. A sign-in failure and a spend limit are blocked on you; a usage limit and an app quit
   are what the session map flags.
3. **An app quit is the agent's process gone with no SessionEnd**, as the corpus's `crash` recording shows it; 60 s
   to notice is this job's bound, since the design gives none.
4. **"30 sessions" are 30 live ones.** A quiet session needs a record a day old, which live hooks can't make, so the
   24 others are working sessions, which the listing must show: the harder case for 20 lines.
5. **A session is named by its ID's first 8 characters** (the row shape's `id`), or by its prompt.

## Files

- `thirty.test.ts`: the plan, the fixture on disk, the stand-in agents, the judge and both tests; imports `../helpers.ts`.
- `agent.sh`: the stand-in agent process.
- `tsconfig.json`: as the suite's, one folder deeper.
