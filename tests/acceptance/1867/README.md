# Acceptance tests for #1867: Codex's hook entries and the Claude Code MCP registration go back when an agent call removes them

Written first, blind, at base commit `ebf1e7f44` (origin/main), from the issue, the design and the base alone, by a
job that never saw an implementation of #1867. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

Status: the suite type-checks, and each file ran once on the base commit on November 25, 2026 (`BASE-FAILURE.txt`).
Three of the four tests fail there at their own assertion, each naming the file and the entry that wasn't put back.
The fourth, criterion 2's second sentence, passes there, since the base puts nothing back; its wrong program is the
twin, which was not run. No test has run against a hub that puts an entry back: none existed. The passing side was
only probed with no hub, a probe's own write standing in for the put-back, which this suite's readers found within
the second and byte for byte. The base wasn't built in place: its build outputs were clones of another clean
checkout's build of the same commit. The test files are as they were written before that run; it changed none.

## What was read

- Issue #1867 as saved on November 24, 2026: its opening paragraph, Scope, three criteria, Proof and Depends on. It
  has no comments. #39's and #5's own bodies were not read: #39 through its suite here, #5 has none.
- `docs/technical-design.md`: Threats, and what stops each one (the rows Agents switching off what watches them and
  What a command's children do); How it installs; What each agent gives us, with Hooks are evidence, not a state
  machine; How we know version 0 works (Criteria to tests, both ways; Criteria in a checked shape; Wrong programs;
  Dogfooding); the primitives' Event. `docs/parallel-proof.md`, section 7 (a suite's own lane file, the timed list).
  `AGENTS.md`, `CONTRIBUTING.md`.
- The base, for call shapes only: `packages/hub/src/{claude-settings,codex-settings,agent-files,setup,setup-steps,
  core,hub-readings,hub-shared,session-state,session-flags,mcp-servers,doctor,paths,service,waits,server,log-reads}.ts`,
  `crates/deep-hook/src/matcher.rs` (what a `write:` guard entry reads) and `default-rules.json`,
  `adapters/{codex,claude-code}.facts.json`, `scripts/{lanes,lanes-lists,proof-runs,proof-change,proof-guard,
  wait-ratchet,repo-rules}.mjs`.
- The suites `18/install`, `39` with its redrafts, `2019`, `2648`, `1604`, `3229`, `3296` and `3350`, for their
  conventions and helpers.

## What the base already does, and these tests don't credit

- For Claude Code's `settings.json` the hub watches the file and rechecks it at each session start (`ClaudeSettings`),
  and tells what it put back as a reading. Nothing here tests that.
- For Codex it only reports: `hub.health`'s `codex.readings` and `deep doctor` name an entry of ours that was removed
  or changed, and an `agent.reach` event says Codex is unreachable. A report isn't a put-back, and none of these
  names a call. The first two tests quote `codex.readings` in their failure, so the base's failure shows what it did.
- Nothing at the base watches or rewrites `~/.claude.json` outside `deep setup` and its undo.
- The shipped guard entry `no-agent-config-write` denies an agent's own write to these files. Each call here runs a
  script, which a hook can't see into (design: What a command's children do), so the guard lets it run; a call it
  denies is BLOCKED, never a pass.
- The hub already names a call in one reading: a call that ran past its expected time. That is why a reading here
  must say the file too (Readings, 5).

## How to run

With Node 24.22 first on `PATH`, from the repo root, the workspaces and deep-hook built:

```sh
npm run build --workspaces
cargo build --locked -p deep-hook
node scripts/throttle.mjs test --wait 240 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/1867 --no-file-parallelism --testTimeout=600000 codex-watch.test.ts
node scripts/throttle.mjs test --wait 240 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/1867 --no-file-parallelism --testTimeout=600000 codex-start.test.ts
node scripts/throttle.mjs test --wait 240 -- node node_modules/vitest/vitest.mjs run --root tests/acceptance/1867 --no-file-parallelism --testTimeout=600000 claude-json.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/1867/tsconfig.json
```

- The suite needs `packages/cli/dist/main.js` and `target/debug/deep-hook` and builds neither: without one, every test
  is BLOCKED, naming it. `deep setup` itself builds deep-hook when `target/` holds none, so the tests check first.
- `codex-watch.test.ts` needs the machine's own `codex` on `PATH` (or in `/opt/homebrew/bin` or `/usr/local/bin`),
  for Codex's own hook list. It runs only `codex app-server` against the test's own `CODEX_HOME`, never the real
  `~/.codex`, never with `--dangerously-bypass-hook-trust`, and calls no model. Without one the test is BLOCKED.
- Every test makes its folders under `/tmp/dh1867-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude`, `~/.claude.json` or `~/.codex`.
  `<tmp>/bin` is first on `PATH` with stand-ins for `launchctl`, `systemctl`, `claude` and `codex`, so `deep setup`
  registers no login service on this machine. It stops only processes it started, by PID.
- The folder runs alone (`lane.json`): each file starts hubs of its own, and two files read a time.
- With `--root` here Vitest leaves its cache in this folder (`.vite/` or `node_modules/.vite/`): delete it before
  committing.
- No wait here is a fixed one (`scripts/wait-ratchet.mjs` finds none in these files): each timer bounds a wait for an
  event and says so, or is the step between two reads of a file or of the record.

## The surface under test

### Merged surfaces, used as their suites define them

- **`deep setup`** with `HOME` the test's home (#18, #19, #39): Codex's entries in `~/.codex/hooks.json`, through its
  link if it is one, its MCP server in `~/.codex/config.toml`, and DeepBuild's MCP servers in `~/.claude.json`.
- **The hub**: `deep hub run`, its ready line, its socket's line protocol in the `cli` role with the control token,
  `events.read` and `hub.health` (#16).
- **deep-hook**, `deep-hook codex <event>` and `deep-hook claude-code <event>`, the hook's JSON on stdin (#315, #39).
  A hook's event is `tool.before` or `tool.after` with the call's ID as `data.call`, and `session.start`.
- **The files the issue names**: Codex's `hooks.json` and `~/.claude.json`, read and written as files.
- **Codex's hook list**: `codex app-server`'s `hooks/list`, each entry with its `eventName`, `command` and
  `trustStatus`; an approval is `[hooks.state."<key>"] trusted_hash = "<currentHash>"` in the home's `config.toml`,
  as #39's suite writes it.

### Yours to provide

No new command, socket method, variable or file is named. Two things are this suite's own, and an implementation has
to meet them as written here:

1. **A reading that names the call and the file** (Readings, 5). It is read in two places, and one text of either
   counts: any one string in `hub.health`'s answer (`codex.readings`, `claude.readings` or anywhere else), or any one
   event in the log that isn't a hook's own event (`session.reading` is today's kind), as JSON text. Its words are
   free. It must hold the call's ID (the hook's `tool_use_id`), or its whole command, or the record's ID of its
   `tool.before` or `tool.after` event; and the file's name, `hooks.json` or `.claude.json`, somewhere outside the
   call's command. An example that passes, as a `session.reading` on the call's session:

   ```
   DeepBuild's Stop entry in ~/.codex/hooks.json was removed while the shell call call_3fa9c2d41b07 was running; it was put back at once.
   ```

2. **The planted twin `puts-back-yours`**, for the second test of criterion 2, which passes on the merge base
   (`twins.json`, `twins/README.md`). An example of its place: `tests/acceptance/1867/twins/puts-back-yours/lines.json`,
   or the product file whole at its repo path under that folder.

## Criteria to tests

Each `describe` and test name starts with its criterion's number and ID, `#1867.<first 8 hex of SHA-256 of the
criterion's text, trimmed, white space collapsed>`, as `scripts/proof-change.mjs` computes it.

| ID | Criterion (short) | Test | What fails it |
|---|---|---|---|
| AC1 `#1867.e9a5b9d7` | with a Codex shell call running, removing our Stop entry from `hooks.json` puts it back within a second, byte-identical, with a reading naming the call, and Codex's hook list still reports it trusted | `codex-watch.test.ts`: `hooks.json` is a link into a dotfiles folder that holds a Stop entry of yours; you approve the entries in Codex's own list; a thread's shell call runs the script, which removes our Stop entry and stays running; the file is read every 10 ms until the entry is back. Then: back within a second of the script's write; the entry's own bytes as setup wrote them; the link still the link; a reading names the call and the file; Codex's `hooks/list` reports the entry trusted | the merge base, which only reports (the failure names the file and the entry, and quotes `codex.readings`); a hub that puts it back late, in another form, over the link, without the reading, or where Codex asks for trust again |
| AC2 `#1867.74eeacdf` | a recorded Codex call that changes our PreToolUse entry's command, then a new Codex session, finds the entry back at that session's start with a reading naming the call | `codex-start.test.ts`, first test: a thread's shell call names `hooks.json`; its PreToolUse is in the record, the hub stops, its script changes the command, the hub starts, its PostToolUse is in the record; a new thread starts; within 30 s the entry is ours as setup wrote it, the changed command gone, and a reading names the call and the file | the merge base (the failure names the file and the entry); a hub with a watch and no recheck from the record; a recheck that adds our entry beside the changed one; one that names no call |
| AC2, second sentence | the same change made with no session running stays | `codex-start.test.ts`, second test: you run the same script with the hub up and no session ever started; a new thread's start is recorded; the file is read for 10 s more; the changed command is still there, and the hub still answers | the twin `puts-back-yours`. It passes on the merge base, which puts nothing back |
| AC3 `#1867.5a700f0c` | with a Claude Code call running, removing the `deep` MCP server from `~/.claude.json` puts it back within a second, with a reading naming the call | `claude-json.test.ts`: `~/.claude.json` holds a value of yours before setup; a session's Bash call runs the script, which removes the server and stays running; the file is read every 10 ms. Then: back within a second, as setup wrote it; your value as it was; a reading names the call and the file | the merge base (the failure names the file and the entry); a hub that puts it back late, changed, or by writing the file over; one that names no call |

## Readings, where the issue and the design leave a choice

1. **"The `deep` MCP server" in `~/.claude.json`.** `deep setup` writes two entries under `mcpServers` there:
   `deepbuild`, which runs `deep mcp` and serves the `deep_*` tools, and `deep-actions`. No entry there is named
   `deep`: that is the name the same server has in Codex's `config.toml`, and in the hub's own code. So the criterion
   is read as DeepBuild's MCP server, the one entry whose `args` end in `mcp`; `deep doctor` reads the same entry as
   "DeepBuild's MCP server". The test takes its name from the file, so it holds under either name, and removes only
   that entry. `deep-actions` is left alone and not judged.
2. **A linked `hooks.json`.** The Scope says the hub watches `hooks.json` "through its link if it is one", and #39
   writes it through one. Criterion 1's home has `~/.codex/hooks.json` as a link into a dotfiles folder, with a Stop
   entry of yours first in the file and ours after it, as #39's own test lays it out; criterion 2's homes have a
   plain file. The script writes in place, so it leaves the link a link. After the put-back the link must still be
   that link (design, How it installs: written to the file a link points to).
3. **"Byte-identical."** The Scope says "an entry goes back byte for byte, so Codex still reports it trusted". So it
   is the entry's own bytes: the text of its object in the file, from `{` to `}`, must be the text setup wrote. The
   whole file isn't compared: a script that deletes the `Stop` key and a hub that adds it again at the end would
   differ there, and Codex wouldn't care. Whether its place is right is Codex's to say, through its own list.
4. **"A recorded Codex call that changes our PreToolUse entry's command."** A Codex call is recorded by its
   `tool.before` and `tool.after`. For the recheck at a session start to be what puts the entry back, no watch may see
   the change as it is made, so the hub is stopped while the call's script runs, as #18's test of the same recheck
   stops it. Both of the call's hooks reach a running hub: PreToolUse before the stop, PostToolUse after the start.
   The record then shows the call both ways a recheck could read it: its command names `hooks.json`, as the base's
   recheck for `settings.json` looks for, and the file changed between its two events. "Back" is our entry as setup
   wrote it and the changed command gone from the file; an entry added beside the changed one is not back. A hub
   that puts it back sooner, at its own start, passes too: the criterion says where the entry is at the session's
   start, not when it went back.
5. **"A reading naming the call."** Read where #18's install suite reads one: `hub.health`, and the log's events
   that aren't a hook's own. A call is named by its ID, its command, or the record's ID of its PreToolUse or
   PostToolUse event, as there. Two things are narrower than #18's. One reading is one text: one string of the health
   answer or one event, not the answer as a whole. And that text must say the file too, by its name, as the base's
   readings for `settings.json` do ("as it does for settings.json"). The reason: at the base the hub already writes a
   reading that names a call, when the call runs past its expected time, and that says nothing of an entry.
6. **"Within a second."** From the script's own clock just after its write to the first read here that finds the
   entry back, with a read every 10 ms. An entry that isn't back in 30 s fails. One that is back within a second
   passes. Past the second it fails only when a read past the second still found it gone and the machine's
   one-minute load is at or under its cores. Otherwise the run can't say whose time it was (the load is over the
   cores, or this suite's own reads straddled the second), and the test fails with `INCONCLUSIVE:`, never passes.
7. **"A call running."** From its PreToolUse to its PostToolUse. The PreToolUse is fired until the record holds its
   `tool.before`, since past its 50 ms deep-hook lets a call go and the hub may never hear of it; six tries without
   one are BLOCKED. The script then stays running until the test has read the entry back or given up, and only then
   does the PostToolUse fire, so the test never leans on the two seconds the hub counts a call as running after its
   end.
8. **"Stays."** Through both chances the hub has: its watch, from your change on, and its recheck at the next Codex
   session's start. The file is read for 10 s after that start is in the record, and the hub must still answer then.
9. **Stand-ins.** `fixtures/agent.mjs` is one agent's process: the parent of its sessions' deep-hook runs and of its
   calls' shells, as #39's and #3229's are. It runs `target/debug/deep-hook` directly with each hook's payload, as
   #39's suite does, not the entries' own command lines. A Codex thread's rollout and a Claude Code session's
   transcript name the newest version their facts cover. `claude` and `codex` on `PATH` answer `--version` with that
   version and exit 0; only criterion 1 runs the real codex.
10. **The script.** `fixtures/tamper.mjs` rewrites the file in place, in the two-space layout setup writes, so
    nothing but the entry it is asked about changes. It removes our Stop entry with its group, and leaves yours.
11. **"What is yours stays."** `~/.claude.json` is Claude Code's own state file. The test checks one value of yours
    in it after the put-back (design, How it installs: entries owned by their exact command).

## What isn't asserted, because no criterion says so

- The whole bytes of `hooks.json` or of `~/.claude.json` after a put-back, and our entry's place among its event's
  groups other than through Codex's own list.
- A reading's words, its kind, or which session it is on; `deep doctor`'s output; `codex.trust` in health.
- How soon the session-start recheck acts: 30 s only ends the wait.
- That Codex's stops are held again once the Stop entry is back: the issue's reason, not a criterion.
- A change no call made, for `~/.claude.json`, for a removed entry or for a linked file; a change a recorded call
  made that its command doesn't name; a linked `~/.claude.json`; Codex's `config.toml`, which the Scope doesn't name.
- An entry weakened another way (a timeout, a matcher), other events' entries, `deep-actions`.
- A budget: the issue has none.

## What the implementer adds outside these files

- `scripts/lanes-lists.mjs`, `timed`: `tests/acceptance/1867/codex-watch.test.ts` and
  `tests/acceptance/1867/claude-json.test.ts`. Their verdict reads the machine's load (Readings, 6), so they run under
  a timed grant, where the second is read on a quiet machine. That list needs a signed approval. `lane.json` already
  puts the folder on `alone`, and needs none.
- `tests/acceptance/1867/twins/puts-back-yours/`, as `twins/README.md` describes it.
- Nothing in `scripts/wait-ceilings.json`: these files hold no finding.

## Files

- `helpers.ts`: the home and its stand-in programs, `deep setup`, the hub and its socket, the agent stand-in's
  client, sessions and their hooks, a hook fired until recorded, the readers of `hooks.json` and `~/.claude.json`, the
  second, Codex's hook list and approval.
- `fixtures/agent.mjs` (one agent's process), `fixtures/tamper.mjs` (the script a call runs, or you).
- `codex-watch.test.ts` (AC1), `codex-start.test.ts` (AC2, two tests), `claude-json.test.ts` (AC3).
- `twins.json`, `twins/README.md`: the one planted wrong program.
- `lane.json`: the folder runs alone. `tsconfig.json`.
- `BASE-FAILURE.txt`: the run on the base commit, each test's failure there, and the one test that passes there and why.
