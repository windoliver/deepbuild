# Acceptance tests for #19: the authority criteria (`deep off`, `deep on`, the hub, undo, answers)

Written first, blind, from issue #19 (its body as of October 27, 2026), the design sections it links and those around
them (How it installs, One hub per user, Hooks are evidence, Sessions that know about each other, Numbers version 0 has
to hold, Socket roles and contract versions, and Threats: "Agents switching off what watches them", "A broken hub",
"Answers from the terminal"), and base commit `0350cf0`, by a job that never saw an implementation of #19. The
implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has 25 checkbox criteria, AC1 to AC25 in the body's order (IDs in the table below). **This folder covers AC1,
AC2, AC19, AC21, AC22 and AC24.** Three other blind jobs cover the rest in sibling folders of `tests/acceptance/19/`.

## How to run

With Node 24.22 first on `PATH` and the workspaces built (`npm run build --workspaces`):

```sh
cargo build --locked -q -p deep-hook          # warm the binary; helpers build it too, and the release build if setup's entries name it
npx vitest run --root tests/acceptance/19/authority --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/19/authority/tsconfig.json
```

- `--no-file-parallelism`: each file starts hubs and builds deep-hook with cargo. The suite takes several minutes.
- Every test makes its folders under `/tmp/dh19a-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude`, `~/.codex` or
  `~/Library/LaunchAgents`. It stops only processes it started, by PID. No child inherits a billing key or a
  `CLAUDE*`, `CODEX*` or `DEEP_*` variable of the runner's.
- `<tmp>/bin` is first on `PATH`: stand-ins for `launchctl`, `systemctl` and `claude` (each logs its call to
  `<tmp>/bin/calls.log` and exits 0) and a `deep` that runs the built CLI. No test registers a login service on this
  Mac, starts a second installed hub, or shows a real LocalAuthentication prompt (below, the seam).
- No network, no agent prompt, no GitHub; `git init` makes the worktree, nothing else of git runs.
- With `--root` here, Vitest writes its cache to `tests/acceptance/19/authority/node_modules/.vite/`; delete it.
- Machine load: deep-hook counts a hub that hasn't acknowledged within 20 ms as away (#315), and then decides alone.
  The probes read the hub's acknowledgement off a forwarded socket and try again when there is none (eight tries);
  a run where no try reaches the hub fails `INCONCLUSIVE`, saying so, never as a pass.
- AC19, AC21 and AC22 are macOS's (launchd adopting a double-forked process). Elsewhere they are skipped with an
  `INCONCLUSIVE` note, never passed.

## The surface under test

### Merged surfaces, used as their suites define them

- **The hub** as `deep hub run [--root <folder>]` with `HOME` the temporary home, its ready line, its socket's line
  protocol, a `cli` connection with the control token, `events.read` (#16). `DEEP_HUB_PLANT=<name>` selects a planted
  program, and a name the hub doesn't know makes it exit at start (#16).
- **The OS confirmation's seam** `DEEP_HUB_TEST_CONFIRM=<file>` (#24, `packages/hub/src/confirm.ts`): `confirmed` in
  the file stands for the OS confirming you, anything else for the LocalAuthentication prompt cancelled; read at each
  ask, so a test turns it without restarting anything.
- **`deep setup`** (#18): run once by you with a hub answering, it writes DeepBuild's hook entries into
  `~/.claude/settings.json`; DeepBuild's entries are the ones whose command runs deep-hook or the deep CLI (#18
  install README, item 2). The Claude Code stand-in runs them.
- **deep-hook** as setup's entries run it, the hook's JSON on stdin, and **the hook protocol's acknowledgement**
  `{"ack": <id>, "hold_until_ms": <ms or null>}` then the reply `{"exit", "stdout", "stderr"}` (#315, #16). A
  PreToolUse deny is exit 2 or `permissionDecision: "deny"` (#315).
- **The address setting** `{"hub": {"address": "unix:<path>"}}` in `~/.deepbuild/config.json` (#16), pointed at a
  forwarded socket that keeps every byte, to read the hub's acknowledgements (as #18's suite does).
- **Guard entries** in `~/.deepbuild/rules.json`, `guard@1`, and the shipped defaults
  `crates/deep-hook/default-rules.json` (#316, #317): `fail_closed` entries for killing by name, writes under
  `.deepbuild/` and writes to an agent's config, among others. The hub denies a matched `block` entry with its reason
  and `(guard <name>)`.
- **`deep mcp`** and `deep_ask` filing an ask under the session (#26); the stop of a session whose own `deep_ask` is
  open is one the hub holds while the stop-hold relation holds (#18 install README, item 7).
- **`deep inbox answer <ask> <option>`** (#24): exit 0 counted, 3 not decided; `ask.answered@2` (`via: "inbox"`,
  `verified: true`) and one `decision.created` when it counts. The record and asks core seed an authority ask before
  the hub starts (`@deepbuild/record`, `@deepbuild/asks`), as #24's suite does.
- **The Claude Code stand-in** `fixtures/claude.mjs` (copied from #18's install suite): one process per session; it
  runs the settings file's command entries for each hook, runs Bash commands as its children and starts its own
  `deep mcp`, so the hub's peer check finds it above anything its Bash tool runs.

### Defined here, where the issue and the design leave a surface open

1. **The commands.** `deep off`, `deep on`, `deep hub stop` (the installed hub's: no `--root`), `deep setup --undo` and
   `deep hub use --root <folder>`, each run with `HOME` the temporary home. Each exits 0 once it took effect with the
   OS confirming you. With the OS not confirming you it changes nothing, exits **3** (the exit table's "anything not
   decided", as #24's `deep inbox answer` does for an unconfirmed answer) and **says why**: its output (stdout or
   stderr) says the OS didn't confirm you, matching `/confirm/i`.
2. **Who asks the OS.** The design has the hub ask, as #24 built it. The tests set `DEEP_HUB_TEST_CONFIRM` on every
   process they start (the hubs, `deep setup`, the stand-in and so on every `deep` and deep-hook it runs) so that no
   real prompt can pop whichever side asks; they don't check which side asked. See Disputes, 4.
3. **Gated and watch-only** are read off the replies setup's entries get (the issue's "next hook reply"):
   - **Your gate**: the tests add one entry of your own to `rules.json`, `yours-no-make-release`
     (`match: "run:make release"`, `mode: "block"`, `fail_closed: false`), beside whatever setup wrote there, or the
     shipped defaults where setup wrote none. The session's next Bash call `make release` is **gated** when the hub
     denies it and **watch-only** when the hub acknowledges it and doesn't deny it. A reply deep-hook gave without the
     hub's acknowledgement is no reading (tried again). With the hub away a `fail_closed: false` entry doesn't hold,
     so `deep off`, which leaves only what holds with the hub away, lets it through.
   - **The stop hold**: the next Stop of a session with an open `deep_ask` (after a prompt) is **gated** when the hub's
     acknowledgement carries a number and **watch-only** when it carries `null`.
4. **Within a second**: from the moment `deep off` exits (for a double-forked one, the time its shell wrote right
   after it) to the start of the first hook whose reply reads watch-only; probes run back to back from then.
5. **A process an agent double-forked**: the stand-in's Bash tool runs `( sleep 1; /bin/sh run.sh ) &`; its shell
   exits at once and launchd (PID 1) adopts the subshell, which runs `deep …` in the session's worktree. `run.sh`
   records its ancestors first; a chain that still reaches the stand-in or doesn't end at PID 1 is BLOCKED.
6. **"Changes nothing"** per command, with the prompt cancelled, read after 1.5 s:
   - `deep off`: the next PreToolUse is still gated.
   - `deep hub stop`: the hub's process is alive, its socket answers, and no `launchctl`/`systemctl` call that would
     stop, unload or remove the login service (`bootout|unload|remove|stop|kill|disable|kickstart -k`) was made.
   - `deep setup --undo`: every file under `HOME` is byte for byte as before (a digest of each), except the hub's
     running state under `~/.deepbuild/` and the sessions' transcripts under `~/.claude/projects/`; `rules.json`,
     `config.json` and `claude-hooks.json` under `~/.deepbuild/` are compared too. No service call as above, and the
     next PreToolUse is still gated.
   - `deep on` after a confirmed `deep off`: the next PreToolUse is still watch-only.
7. **`deep hub use --root <folder>`** acts on the worktree it runs in (its working folder, a `git init` repository
   here); `<folder>` is the dev hub's root, as `deep hub run --root <folder>` takes it (its socket
   `<folder>/hub.sock`). The dev hub runs as the test's own `deep hub run --root`. **"The worktree's next session
   reaches a hub"** is that hub's log holding the session's `session.start` after its SessionStart ran through setup's
   entries, and the other hub's not holding it.
8. **AC24's three calls**, each sent to the hub (its acknowledgement read; eight tries for one that reaches it):
   - `pkill -f vite`: the session's Bash PreToolUse through setup's entries;
   - an Edit of `<worktree>/.deepbuild/done.yaml`: the session's Edit PreToolUse through setup's entries;
   - a write of `hooks = false` into the agent's own config: a Codex session's `apply_patch` updating
     `~/.codex/config.toml`, deep-hook run as `<setup's deep-hook> codex PreToolUse` (Codex's hooks.json entry runs it
     that way; Codex's entries themselves are #39's). Disputes, 2.
   "Still denied, naming the guard": every DeepBuild entry that ran denied it, and the denial names one of the
   `fail_closed` entries in the installed `rules.json`.

### Additions the implementation must make

1. The five commands, as above, and `deep off`'s state as the hub's replies show it.
2. Two planted wrong programs, selected with `DEEP_HUB_PLANT` and listed in `packages/hub/src/wire.ts`'s plants, so the
   hub starts with them. The tests set the variable on every process, so a plant may live in the hub or the CLI.

   | Name | What the plant does | Criterion | How the test fails on it |
   |---|---|---|---|
   | `acts-on-peer-check` | `deep off`, `deep on`, `deep hub stop`, `deep hub use` and `deep setup --undo` take effect without asking the OS when the peer check finds no agent above the command | AC21, AC22 | AC21: "AC21 \`deep off\`, run by a process agent session … double-forked so launchd adopted it, turned the next hook reply watch-only with the OS confirmation cancelled …". AC22: "AC22 \`deep hub use --root …\` … sent the worktree's next session … to the dev hub with the OS confirmation cancelled" |
   | `off-guards-watch-only` | with `deep off` in effect, the hub answers every hook watch-only, the calls a `fail_closed` entry matched included | AC24 | "AC24 after a confirmed deep off, the fail-closed guards must still deny each call, naming the guard: the agent's Bash call \`pkill -f vite\` (tool_use_id …) was let through …; its Edit of …/.deepbuild/done.yaml … was let through …; its write of \`hooks = false\` into its own config … was let through …" |

   Two plants this folder uses already exist (#24): `answer-inside-session` (AC2) and `answer-on-peer-check` (AC19).
3. `scripts/lanes.mjs` should run `tests/acceptance/19/authority/` in `alone` (its own Vitest run, files one at a
   time); this job edits nothing outside its folder.
4. `tests/acceptance/19/twins.json` (or wherever the issue's twins are listed) should map `#19.0694d419` and
   `#19.a4f7c68a` to `acts-on-peer-check`, `#19.44419f7e` to `off-guards-watch-only`, `#19.1a7ba6d9` to
   `answer-on-peer-check` and `#19.2c46147f` to `answer-inside-session`.

## Criteria to tests

Each test's name starts with its criterion's number and ID, `#19.<first 8 hex of SHA-256 of the criterion's text,
trimmed, whitespace collapsed, the leading "- [ ] " dropped>`.

| ID | Criterion (short) | Test | Wrong program it fails on |
|---|---|---|---|
| AC1 `#19.a897085d` | `deep off` makes the next hook reply watch-only within a second | `off.test.ts`: before, your gate denies `make release` and the hub holds the stop of a session with an open ask (else BLOCKED); you run `deep off`, confirmed, exit 0; a PreToolUse started within 1 s of its exit is let through, acknowledged by the hub; the next Stop's acknowledgement is `hold_until_ms: null` | the base (no `deep off`: exit 2); a `deep off` that takes effect later than a second; one that only stops holding stops, or only stops blocking |
| AC2 `#19.2c46147f` | an answer typed into `deep` from inside an agent's process tree is refused, saying why | `answer.test.ts`: the stand-in's Bash runs `deep inbox answer <authority ask> decline` with the OS confirming you: the ask stays open, exit 3, the output names the agent session's ID, the word agent and the ask; the same command by you then counts once | `answer-inside-session` (`plants.test.ts`): the ask counts, and the check fails naming the ask; a refusal that doesn't say why |
| AC19 `#19.1a7ba6d9` | macOS: an authority answer typed by a double-forked process counts only once the OS confirms you | `answer.test.ts`: double-forked `deep inbox answer <ask> decline`, prompt cancelled: the ask stays open, exit 3, names the ask; confirmed: exit 0, counted once (one `ask.answered` via inbox, verified, one decision) | `answer-on-peer-check` (`plants.test.ts`): fails naming the ask |
| AC21 `#19.0694d419` | double-forked `deep off`, `deep on`, `deep hub stop`, `deep setup --undo` change nothing until the OS confirms you, each saying why; confirmed `deep off` is watch-only within a second | `authority.test.ts`: in turn, each cancelled: `deep off` leaves the next reply gated; `deep hub stop` leaves the hub running with no service stop; `deep setup --undo` leaves every file under HOME as it was and the reply gated; each exits 3 saying why. Confirmed `deep off`: exit 0 and watch-only within 1 s of its end. Then cancelled `deep on`: still watch-only, exit 3, saying why | `acts-on-peer-check` (`plants.test.ts`): fails naming `deep off`; the base (exit 2, no word about the confirmation) |
| AC22 `#19.a4f7c68a` | double-forked `deep hub use --root <dev hub>` changes nothing until the OS confirms you | `authority.test.ts`: installed and dev hubs running; cancelled: the worktree's next session's `session.start` is in the installed hub's log, not the dev hub's, exit 3 saying why; confirmed: exit 0, the next session's start is in the dev hub's log only | `acts-on-peer-check` (`plants.test.ts`): fails naming `deep hub use --root …` |
| AC24 `#19.44419f7e` | after a confirmed `deep off` the next stop isn't held, while the three calls are still denied, naming the guard | `guards.test.ts`: before, the stop is held (else BLOCKED); after `deep off` (you, confirmed, exit 0) the next Stop's acknowledgement is `null`; the three calls each reach the hub and are denied, the denial naming a `fail_closed` entry | `off-guards-watch-only` (`plants.test.ts`): fails naming each call as let through |

## Disputes

1. **What "gated" is right after install.** The design starts the adapter watch-only ("no verdict blocks and no stop
   is held until you approve something", AC6), so a test needs a gate that holds right after install to show `deep
   off` turning it off. Two do: the stop of a session with an open `deep_ask` (the answer route's hold, which #18's
   merged stop-hold test requires right after setup), and a block entry of your own in `rules.json` that isn't
   `fail_closed` (a guard you wrote, not a verdict; the hub enforces it, deep-hook alone doesn't). If the implementer
   reads AC6 as also making your own block entries watch-only until you approve a repo's checks, the BLOCKED line at
   the start of AC1 and AC21 says so, and that is this job's redraft, not a reason to edit these tests.
2. **"Its write of `hooks = false` into its own config."** `hooks = false` is TOML, Codex's `config.toml`; a Claude
   Code session's own config would spell it `"disableAllHooks": true` in JSON. The tests take the criterion's words:
   a Codex session writes it into `~/.codex/config.toml` with `apply_patch`, deep-hook run as Codex's entry would run
   it. Codex's hook entries are #39's (the issue's last Scope line), so the test runs setup's deep-hook binary with
   `codex PreToolUse` directly.
3. **AC2 and AC19 pass at the base.** #24 already refuses an agent's `deep inbox answer` naming the session, and
   counts a double-forked answer only once the OS confirms you. These tests are #19's statement of the same contract
   through its words (a double fork rather than tmux, "says why"); their wrong programs are #24's plants, which fail
   them at the base too (BASE-FAILURE.txt).
4. **The seam on the CLI.** #24's README has only the hub read `DEEP_HUB_TEST_CONFIRM`, so no `deep` can choose what the
   confirmation answers. `deep setup --undo` may need to run with the hub down, where only the CLI could ask. The tests
   set the variable on every process so that no real prompt pops whichever side asks; an implementation in which the
   CLI asks must still never let an agent's process choose the answer (a test seam the CLI honours outside tests would
   be that hole). Not tested here.
5. **A confirmed `deep hub stop`, `deep on` and `deep setup --undo`** are not exercised: the criterion asks only that
   the cancelled ones change nothing and that a confirmed `deep off` works. A confirmed undo is AC23's (another
   folder); a confirmed installed-hub stop would go through `launchctl`, which is stubbed here.
6. **Which worktree `deep hub use` acts on**: the one it runs in. "Sends that worktree's sessions to it" doesn't say
   how the worktree is named; the command's working folder is the least a test can choose.
7. **Exit 3 for a cancelled prompt**, as "not decided" (#24 chose the same for `deep inbox answer`); "saying why" is
   read as the output mentioning the confirmation.

## Files

- `helpers.ts`: temp homes and stand-in tools, `deep setup`, rules.json with your gate, hubs as processes and their
  sockets, the forwarder and acknowledgements, the stand-in's client, the probes, the double fork, the setup snapshot,
  the record seeded with an authority ask, `expectOpen` and `expectCountedOnce`.
- `scenarios.ts`: each criterion's scenario, taking an optional plant, shared with `plants.test.ts`.
- `fixtures/claude.mjs` (the Claude Code stand-in) and `fixtures/stub-bin.sh` (launchctl, systemctl, claude), both
  copied from `tests/acceptance/18/install/fixtures/`.
- `off.test.ts` (AC1), `answer.test.ts` (AC2, AC19), `authority.test.ts` (AC21, AC22), `guards.test.ts` (AC24),
  `plants.test.ts` (the wrong programs of AC2, AC19, AC21, AC22, AC24).
- `tsconfig.json`: type-checks the suite under the root's strict options.
- `BASE-FAILURE.txt`: the run on the base commit and why each test fails there.
