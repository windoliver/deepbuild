# Acceptance tests for #18: install, settings and timing relations

Written first, blind, from issue #18 (its body as of October 26, 2026), the design sections it links and those
around them (One hub per user, How it installs, Threats, Numbers version 0 has to hold: Timing relations, Hooks
are evidence: What a session loads and Health), sibling issue #19 (CLI basics, which depends on #18) and base
commit `14561af`, by a job that never saw an implementation of #18. The implementing agent does not edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 24 checkbox criteria, AC1 to AC24 in the body's order. **This folder covers AC3, AC8, AC14, AC15,
AC19 and AC22.** Three other blind jobs cover the rest in `../mapping/`, `../session/` and `../kit/`.

## How to run

With Node 24.22 first on `PATH` and the workspaces built (`npm run build --workspaces`):

```sh
cargo build --locked -q -p deep-hook          # warm the binary; a test builds it too, and builds target/release if setup's entries name it
npx vitest run --root tests/acceptance/18/install --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/18/install/tsconfig.json
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=... npx vitest run --root tests/acceptance/18/install tamper.live.test.ts   # by hand only: spends plan usage
```

- `--no-file-parallelism`: each file starts hubs and builds deep-hook with cargo.
- Every test makes its folders under `/tmp/dh18i-*` (a socket path must fit in 104 bytes), sets `HOME` to
  `<tmp>/h` for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`. It
  stops only processes it started, by PID. No child inherits a billing key, a `CLAUDE*` variable or a `DEEP_*`
  setting of the runner's.
- `<tmp>/bin` is first on `PATH`: stand-ins for `launchctl`, `systemctl` and `claude` (each logs its call and exits
  0; `claude --version` answers the newest version the facts cover) and a `deep` that runs the built CLI. So `deep
  setup` can't register a login service on this Mac or start a second hub.
- `scripts/lanes.mjs` needs `tests/acceptance/18/install/tamper.live.test.ts` in `byHand` (this job edits nothing
  outside its folder). Without it, the unit lane runs the live file and it fails as BLOCKED.
- With `--root` here, Vitest writes its cache to `tests/acceptance/18/install/node_modules/.vite/`; delete it before
  committing.
- Machine load: deep-hook gives up on a hub that hasn't acknowledged within 50 ms (#315), so on a badly loaded
  Mac a hook can miss the hub and reach the record only from the spool at the next hub start. The tests that read a
  status or a reading off the record (AC8, AC14, AC15, AC19) can then fail on that one hook; rerun them, and keep
  the run's machine state with the result.

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub**: `deep hub run` with `HOME` the temporary home; its ready line; the socket's line protocol; a `cli`
  connection with the control token; `events.read`, `hub.health`, `sessions.read` and `inbox.read`;
  `DEEP_HUB_PLANT=<name>` selects a planted program, and a name the hub doesn't know makes it exit at start (#16).
  `DEEP_HUB_TEST_CLOCK` starts the hub's clock at a given time (#16); `DEEP_HUB_TEST_CONFIRM` names a file holding
  `confirmed`, the OS confirmation stubbed (#24).
- **The address setting** `{"hub": {"address": "unix:<path>"}}` in `~/.deepbuild/config.json` (#16 AC2): AC14
  points it at a forwarded socket that keeps every byte, to read the hub's acknowledgements.
- **deep-hook** as a settings entry runs it, its hook's JSON on stdin (#315); **the hook protocol's
  acknowledgement** `{ "ack": <id>, "hold_until_ms": <ms or null> }`: a number is a hold (design: Hook protocol).
- **`deep mcp`** started by the session's process, bound to the session whose hooks came from that process, and
  `deep_ask` filing an ask under it (#26); **`deep inbox answer <ask> <option>`** (#24).
- **Your settings**: `~/.deepbuild/config.json`'s `asks` block, where each kind's deadline lives (#318,
  `draftAskSettings`). "An ask deadline of 20 minutes in your settings" is every kind's deadline at most `20m`, and
  `choice` at `20m`.
- **`deep doctor --json`**: one `doctor.item@1` per line (with `item` and `agent`); a broken relation is code
  `timing_relation_broken`, the code family's own member; exit 1 with a failed item (#19's exit table).
- **The recorded Claude Code 2.1.304 "tools" session** (`adapters/corpus/claude-code/2.1.304/tools`, #47): its
  first two turns, a Bash call and a Write whose permission prompt was answered by typing in the terminal (no hook
  answered it, its PostToolUse followed), replayed into a session of the test's own (IDs, folder and transcript
  rewritten; the transcript written up to each hook's place).
- **The harness** `scripts/agent-harness.mjs` (#48), for the live file only.

### Defined here, where the issue and the design leave a surface open

1. **`deep setup`**, run with `HOME` the temporary home, is the install: it writes DeepBuild's hook entries into
   Claude Code's user settings, `~/.claude/settings.json` (Scope: "in R1 into Claude Code's user settings"; How it
   installs: "the first `deep` command does the same … `deep setup` does the same steps"), and exits 0. AC15 says
   "running setup again", so setup is the surface; #19 owns its other steps (login service, wiki, undo) and they
   aren't tested here. It runs with a hub already answering and with `launchctl`/`systemctl` stubbed.
2. **DeepBuild's entries** are the hook entries whose `command` runs deep-hook (has `deep-hook` in it) or the deep
   CLI (`packages/cli/dist/main.js`, or a word `deep`). Every other entry is yours, or another tool's. The design
   says DeepBuild owns its entries by their exact command, and this is the least a test can read without knowing
   that command. The tests run each command exactly as setup wrote it, and build `target/debug` or
   `target/release/deep-hook` when a command names one that is missing.
3. **The stop-hold entry** is DeepBuild's one Stop entry that runs in the foreground (no `async`, no
   `asyncRewake`); its `timeout` is "Claude Code's Stop hook entry's timeout" (600 s unless set).
4. **The waiter** is DeepBuild's entries with `asyncRewake: true` (design: "A background `asyncRewake` waiter exits
   with code 2 to wake an idle session"): since the Oct 29 amendment (#85), one under Stop and one under StopFailure,
   with the same command and timeout, and none elsewhere. "The waiter entry's timeout" is each one's `timeout`. Setup
   gives both a timeout of at least the longest ask deadline in your settings (design, Known limits; Timing
   relations: "Each of Claude Code's waiter entries, under Stop and under StopFailure").
5. **Claude Code's hooks disable** is `"disableAllHooks": true` in `~/.claude/settings.json`, Claude Code's own flag
   that turns every hook off. "Put back" is: the flag is gone (or not `true`) and DeepBuild's entries are as setup
   wrote them.
6. **A reading** is what "health shows": the hub's `hub.health` answer, or an event in its log that isn't one of
   the hook events themselves (`session.reading` is today's kind for one). A test reads both as JSON text. A
   reading names a relation by its name ("stop hold"/"stop-hold", "waiter") and both values in the issue's words:
   `60 s` twice for the 60 s hold against the 60 s timeout, `300 s` and `20 minutes` for the waiter. A reading names
   a call by its `tool_use_id`, the record's ID of its PreToolUse or PostToolUse event, or its command.
7. **The stop the hub holds** (AC14). The issue needs "stops are held again" at 65 s but doesn't say what a
   watch-only adapter holds a stop for. The one hold the design gives this adapter without an approval is the
   answer route: "A Stop hold returns `decision: block` with the answer". So the probe is a stop of a session whose
   own `deep_ask` is open: while the relation holds, the hub acknowledges it with a `hold_until_ms` that ends at
   least 5 s before the entry's timeout (1 s slack for the hook's start); while it's broken, with `null`, and
   DeepBuild's Stop entry answers at once with no `decision`. The tests check only the acknowledgement and the
   watch-only reply, never what a held stop answers.
8. **Status words** (AC19) are the issue's: a session reads `working`, `waiting` or `stuck` in `sessions.read`'s
   `status`. A permission prompt left to the person reads `waiting`; once the call has run, `working`. "Recorded as
   answered" is that change; "no ask" is no `ask.*` event in the log and no inbox row for the session.
9. **"The ask saying why"** (AC15): the ask, as `inbox.read` shows it or in an event about it (its `ask.created`, or
   one whose subject or data names its handle), says that its answer may come at the next prompt (`next prompt`)
   and names the waiter's `300 s`.
10. **The Claude Code stand-in** (`fixtures/claude.mjs`) is Claude Code's side of the hook contract, the boundary
    these tests don't own: one process per session that reads the settings file again at every hook (Claude Code
    picks up a hook edit while it runs, design: Threats), runs each matching command entry with `/bin/sh -c`, the
    payload on stdin, all at once, stops one at its `timeout` (else the facts' `hookTimeouts`), runs `async` and
    `asyncRewake` entries in the background, runs Bash commands as its children, and starts its own `deep mcp`.
    It decides nothing and never edits a file. It does not model `disableAllHooks` (Disputes, 2).
11. **Time** (AC15): Claude Code stops the waiter at its timeout. The stand-in's `expire(300)` stands for those
    300 s passing (it stops each background entry whose timeout is at most 300 s, as Claude Code would), and the hub
    is started again with its test clock 10 minutes on, when you answer.

### Additions the implementation must make

1. `deep setup`, as above.
2. Two planted hubs, selected with `DEEP_HUB_PLANT` and listed in `packages/hub/src/wire.ts`'s plants. The tests set
   the variable on `deep hub run`, on `deep setup` and on the stand-in (so on deep-hook and `deep mcp`), so a plant
   may live on any side.

   | Name | What the plant does | Criterion | How the test fails on it |
   |---|---|---|---|
   | `holds-stop-anyway` | holds Claude Code's stops as it would with the stop-hold relation intact, whatever the relation reads | AC14 | `stophold.test.ts` (wrong program): the Stop's acknowledgement has a `hold_until_ms` at 60 s against 60 s; the check fails with "the hub held Claude Code's Stop (hold_until_ms …) … Claude Code cuts the hook off at 60 s and the stop goes through with no verdict" |
   | `restores-at-session-start-only` | puts back a removed or weakened entry of DeepBuild's only at a SessionStart recheck, never from the watch between session starts | AC22 | `tamper.test.ts` and `tamper.live.test.ts` (wrong program): session B's next call runs without DeepBuild's PreToolUse entry; the check fails naming B's call (`tool_use_id` and command) |

   The shared `tests/acceptance/18/twins.json` (outside this folder) should map `#18.cfd217f8` to
   `holds-stop-anyway` and `#18.254d19bf` to `restores-at-session-start-only`.
3. A harness scenario for the live file, in `scripts/agent-harness.mjs`:

   ```
   node scripts/agent-harness.mjs run --scenario settings-tamper --workdir <dir> --script <file>
        [--pass-env <NAME>]... [--claude <path>] [--timeout-ms <n>] [--out <dir>]
   ```

   - Two interactive Claude Code sessions, A and B, each in a pseudo-terminal in `--workdir` (never `-p`), from the
     facts' session launch, except that each loads your user settings (`--setting-sources user`): their user
     settings file is `$HOME/.claude/settings.json`, the file `deep setup` wrote. The harness's own hooks go in its
     own `--settings` file, never into the user settings file. Only the Bash calls below run, with no person
     answering a prompt.
   - Both sessions start. Then A is asked to run `node <--script> <a tag>` with Bash, then `ls -a` with Bash, and
     reply DONE; once A's turn has stopped, B is asked to run `ls -a` with Bash and reply DONE. Both end with
     `/exit` once their turns stop.
   - It prints #48's run line; `verdict` is PASS when both turns ended with Stop; `evidence.sessions` is
     `[{ "name": "A", "sessionId", "transcript" }, { "name": "B", … }]`, each transcript the run's copy.
   - `--pass-env CLAUDE_CODE_OAUTH_TOKEN` signs the sessions in under the temporary HOME.

## Criteria to tests

Each test's name starts with its criterion's number and ID, `#18.<first 8 hex of SHA-256 of the criterion's text,
trimmed, whitespace collapsed, the leading "- [ ] " dropped>`, as `scripts/proof-change.mjs` computes it.

| ID | Criterion (short) | Test | Wrong program it fails on |
|---|---|---|---|
| AC3 `#18.183038c2` | existing user hooks keep working after install | `install.test.ts`: your hooks on six events and four other settings; after `deep setup` every value of yours is still there and your hooks, with DeepBuild's set aside, are exactly as written; the same session's 12 hooks (the recorded turns, an `rm -rf` your guard denies, a Notification) give your hooks the same input and the same output and exit code as before the install; DeepBuild's entries run beside them and exit 0 | a setup that replaces the `hooks` object or a group, drops or rewrites an entry of yours, loses a setting, or makes your hook fail |
| AC8 `#18.afa67907` | a disable written by a recorded agent Edit is put back at the next SessionStart with a reading naming the call; yours stays | `disable.test.ts` (two): the agent's Edit writes `disableAllHooks` while the hub is stopped (its hooks reach the record from the spool); at the next session's SessionStart the flag is gone, DeepBuild's entries are as installed, and a reading names the Edit. You write the same flag with no session open while the hub runs; after the next SessionStart it is still there | a hub that never puts it back, or puts it back without naming the call (first test); one that reverts every disable, yours too (second test) |
| AC14 `#18.cfd217f8` | Stop entry at 60 s against the 60 s hold: broken at hub start and in `deep doctor`, holds watch-only; at 65 s held again; a hub that holds anyway fails | `stophold.test.ts` (two): at 60 s a reading at hub start and a `timing_relation_broken` item name the stop hold and `60 s` twice, `deep doctor` exits 1, and the Stop of a session with an open ask is acknowledged with `hold_until_ms: null` and answered with no decision; at 65 s no broken item, an ok item names `65 s`, and the next Stop is acknowledged with a hold ending by 60 s after the hook started | `holds-stop-anyway` (above); a doctor or hub that checks only that the entry exists (no broken item or reading at 60 s); a hold at 65 s that runs past 60 s after the hook started |
| AC15 `#18.72bbbbb5` | waiter 300 s against 20 minutes: broken, naming both; an answer 10 minutes after the stop arrives at the next prompt, the ask saying why; setup again restores | `waiter.test.ts`: setup writes the waiter under Stop and under StopFailure with the same command and timeout, at least 1200 s; both edited to 300 s, a reading at hub start and a doctor item name the waiter, `300 s` and `20 minutes`; the session's `deep_ask` (deadline 20 minutes) says why; it stops, the waiter is stopped at 300 s, and the answer given 10 minutes on is in DeepBuild's reply to the next UserPromptSubmit, exit 0 and not blocking it; setup again gives both at least 1200 s and the doctor's waiter item is ok, naming `20 minutes`; then 300 s under StopFailure alone reads broken in doctor, and setup again restores it | a hub that sends the answer through a waiter Claude Code already stopped (lost); a relation read with no reading; a setup that keeps your edited 300 s; a setup that writes the waiter under Stop only (the entries' read fails, naming StopFailure); a setup that restores only the Stop entry; a relation that reads only the Stop entry |
| AC19 `#18.a57c35bb` | another tool's hooks in the same file: both run; a permission prompt answered by typing is recorded as answered with no ask | `coexist.test.ts`: another tool's entries on ten events stay as they were after setup; through the recorded session both entries run on every hook (the other tool gets each payload; DeepBuild's exits 0), the record holds the session, the Write's permission request and the calls; the session reads `waiting` while the prompt is open and `working` once the Write ran; no `ask.*` event, no inbox row | a setup that drops the other tool's entries; a hub that opens an ask for a prompt the person answered; a session left waiting after the answer |
| AC22 `#18.254d19bf` | live: a Bash call's script deletes DeepBuild's PreToolUse entry; the next call in that session and in a second open session still reach deep-hook; the record names the call; a setup that restores only at SessionStart fails | `tamper.test.ts` (fast, two) with the stand-in: the script runs as A's Bash call between its PreToolUse and PostToolUse; 3 s later B's and then A's next PreToolUse each run DeepBuild's entry, and a reading names A's call. `tamper.live.test.ts` (live, two): the same through the harness with real sessions, "reached" read off the record | `restores-at-session-start-only` (above); a watch that misses an in-place write; a watch that puts the entry back without naming the running call |

## Disputes

0. **AC8, redrafted Oct 27, 2026 (#19).** `deep setup` now installs the shipped guard entries, so the floor's
   `no-agent-config-write` denies the agent's Edit the original control let through. A blind redraft, swapped in with
   the owner's approval, has you take that entry out of `rules.json` first; every other check is the original's.

1. **AC14 and watch-only.** The design says the hooks start watch-only, "so no verdict blocks and no stop is held
   until you approve something", yet the criterion needs stops held at 65 s. The tests use the answer route's hold
   (item 7 above), the one hold that needs no approval. A held stop's reply would carry `decision: block` with the
   answer, which AC4 ("no decision fields") may read as forbidden; these tests never look at a held stop's reply,
   only at its acknowledgement. If the implementer reads "held" as something else, that is this job's redraft.
2. **AC8 and `disableAllHooks`.** With `"disableAllHooks": true`, real Claude Code runs no hook at all, so "the next
   SessionStart" reaches DeepBuild only if the flag is already gone (the watch) or through something that isn't a
   hook. The criterion assumes the SessionStart reaches the adapter, so the stand-in runs DeepBuild's SessionStart
   entry whatever the flag says, and the test reads the issue's wording.
3. **AC22's fast half.** The criterion is live. The fast tests run the same scenario with the stand-in so the plant
   can be shown failing without spending; "reaching deep-hook" there is the stand-in running DeepBuild's entry for
   the call, exit 0. The live tests read it off the record. In the live plant run, a Claude Code that never picks up
   the edited file (it reads hooks once at start) would let every next call through to deep-hook and prove nothing;
   that run fails INCONCLUSIVE, saying so.
4. **"At hub start".** The hub's start reading is looked for in its health and log before any session's hook, within
   20 s of its ready line. AC14's 65 s half starts the hub again after the edit rather than relying on the hub's
   watch of the file; the design's recheck "whenever an agent's hook entries change" isn't tested here.

5. **AC15 and the Oct 29 amendment (#85).** Issue #18's Timing relations bullet and the design now have setup write
   the waiter under Stop and under StopFailure. The criterion's wording ("the waiter entry's timeout edited to
   300 s") is unchanged, so the redraft edits both entries for its scenario, and adds one step the amended relation
   ("each of Claude Code's waiter entries") requires: 300 s under StopFailure alone reads broken in `deep doctor`.
   Expected values are the original's. That Claude Code starts the waiter at either event, and that the hub keeps one
   live waiter per session, are #25's and #85's, not tested here. The redraft was written without running it.

## What depends on other issues

- #19 owns `deep setup`'s other steps, `deep setup --undo`, and `deep doctor`'s other items and exit table; these
  tests use only setup's hook install, doctor's relation items and its exit 1 with a failed item.
- The other criteria of #18 (mapping, the session registry beyond AC19's two statuses, the kit) are the sibling
  folders'.

## Files

- `helpers.ts`: temp homes and stand-in tools, `deep setup`/`deep doctor`, the settings file and DeepBuild's entries
  in it, the hub as a process and its socket, the forwarder, readings, the stand-in's client, the corpus replay.
- `fixtures/claude.mjs` (the Claude Code stand-in), `fixtures/user-hook.mjs` (your hook, or another tool's),
  `fixtures/tamper.mjs` (the script AC22's Bash call runs), `fixtures/stub-bin.sh` (launchctl, systemctl, claude).
- `install.test.ts` (AC3), `disable.test.ts` (AC8), `stophold.test.ts` (AC14), `waiter.test.ts` (AC15),
  `coexist.test.ts` (AC19), `tamper.test.ts` and `tamper.live.test.ts` (AC22).
- `BASE-FAILURE.txt`: the run on the base commit and why each test fails there.
