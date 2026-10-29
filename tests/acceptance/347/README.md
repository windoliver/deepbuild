# Acceptance tests for #347: staging for destructive commands

A destructive command whose reach can't be worked out runs only after what it names is staged as a copy-on-write
copy, within ceilings below the hook's timeout. Otherwise it becomes an authority ask.

A blind job wrote these tests first. It never saw an implementation of #347. Sources:

- **The issue**, as the job was given it: Scope, the 3 checkbox criteria, Proof and Depends on (#304, #316, both
  done). The criterion IDs come from that text.
- **The design**, `docs/technical-design.md`:
  - "Before each command", all of it, and especially the bullet "Destructive commands you approved".
  - The Threats row "A broken hub": deep-hook denies a delete whose reach can't be worked out while the hub is down,
    and the hub acknowledges within 50 ms.
  - "An ask, and your answer getting back": Every ask ends, so an authority ask defaults to no. "A destructive command
    that can't be staged" is one of the authority asks. It also covers how a hold denies, naming its ask.
  - The platforms list (copy-on-write staging: APFS, btrfs or XFS, ReFS) and its note that a file system with no
    copy-on-write turns such a command into an ask.
  - The "Changes on a host" paragraph: a remote machine has no copy-on-write staging.
  - The Claude Code row of the adapters table: hook timeouts.
- **The base commit**: `8ae15875` (origin/main). The base code read:
  - `crates/deep-hook`:
    - `main.rs`: forwarding, the 20 ms acknowledgement budget, the fail-closed fallback, check mode, `setting()`
      reading `~/.deepbuild/config.json`.
    - `matcher.rs`: `effect:unknown-reach-delete`, `deletes`.
    - `shell.rs`: `Run.scripted`, and `file`, which reads a script the line runs.
    - `default-rules.json`: `no-unknown-reach-delete`, block mode and `fail_closed`, planted `rm -rf build/*`.
  - `packages/hub/src`:
    - `server.ts`: `hook`, `reply`, `gated`, `gateReply`, `GATE_HOLD_MS`, the `DEEP_HUB_TEST_*` settings.
    - `holds.ts`: authority holds and the ask a hold raises.
    - `guards.ts`, `plant.ts`, `hookmap.ts` (`tool.before`, `call`, `late`), `claude-settings.ts` and `authority.ts`.
  - `packages/asks/sources.json`.
  - `adapters/claude-code.facts.json`, for `hookTimeouts`.
  - `scripts/proof-change.mjs` (criterion IDs) and `scripts/lanes.mjs`.
- **Sibling suites, for their conventions**: tests/acceptance/321 (helpers, the session's Claude Code process,
  INCONCLUSIVE, plants run inside the suite), 304, 316, 303 and 23.

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

You need Node 24.22 (`.node-version`) first on `PATH`, the Rust toolchain, and `cc` (the Xcode command line tools).
The suite runs on macOS with an APFS `/tmp`.

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run --root tests/acceptance/347 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/347/tsconfig.json
```

- Each test starts its own hubs, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
  beside #321's. The implementer adds it.
- Every test makes its folders under `/tmp/dh347-*`, because a Unix socket path must fit in 104 bytes on macOS.
- Every process the suite starts gets `HOME=<tmp>/h` and `TMPDIR=<tmp>/t`. The suite never touches the real
  `~/.deepbuild`, `~/.claude` or `~/.codex`.
- `cargo build` runs offline, from the toolchain folder `rustup which cargo` names, with `CARGO_HOME=<tmp>/cargo`.
  It reads the installed toolchain and writes nothing outside the world. npm runs with `npm_config_offline=true` and
  no update check.
- The suite stops only processes it started, by PID (`helpers.ts`: `cleanup`, `stopHub`), never by name or port.
- No network, no model, no `claude` binary. A child never inherits this process's billing keys or its `DEEP_*`,
  `GIT_*`, `XDG_*`, `CLAUDE*`, `CARGO*`, `RUSTUP*` or `npm_*` settings.
- Time: on a correct hub, a test takes 20 s to 2 min. The timeouts are 10 to 15 minutes, for a loaded machine.

## The surface under test

These already exist at the base:

- **deep-hook** (`target/debug/deep-hook`), run as Claude Code runs our hook entry: `deep-hook claude-code <event>`
  with the hook's JSON on stdin. Payloads and transcripts are shaped like #321's, from the corpus. Every transcript
  entry carries the newest version the facts cover, so no session is watch-only.
- **`deep hub run`**, with `DEEP_HUB_TEST_CONFIRM` (#24's OS-confirmation stub), `DEEP_HUB_TEST_CLOCK` and
  `DEEP_HUB_PLANT`.
- **The socket**, as the cli role with the control token: `events.read`.
- **`~/.deepbuild/rules.json`**, seeded with `crates/deep-hook/default-rules.json` as #304's suite seeds it, so
  `no-unknown-reach-delete` is what matches the destructive commands.
- **`~/.deepbuild/config.json`'s `asks`**: setup's drafts with no `batch`, so every ask shows at once. Authority asks
  default to no.

### Surfaces this suite chose

The design names no surface for the five things below. Each choice is the smallest one consistent with the design
and with the base's conventions.

1. **The staging settings** live in `~/.deepbuild/config.json`, beside `asks`, which deep-hook and the hub both
   already read:

   ```json
   "staging": { "files": 1000, "seconds": 20, "keep": "3d" }
   ```

   - `files`: the files ceiling, as a count.
   - `seconds`: the seconds ceiling. The design says it is set below the agent's hook timeout.
   - `keep`: how long a staged copy is kept, as a duration written like the ask deadlines (`1d`, `4h`).

   Every test sets all three. AC2's seconds test sets `files` to 100,000, so only the seconds ceiling can bind.

2. **What records a staging.** One event per staged call, of kind `command.staged`, with:
   - `data.call`: the call's `tool_use_id`, the same value `tool.before` carries as `call`.
   - `data.folders`: the absolute paths of the folders it staged, as written or resolved.
   - `data.until`: when the copy is let go, in ms, on the hub's clock. That is the event's `ts` plus
     `staging.keep`.

   The handle of a staging is `staged:<event id>`, like `ask:<id>`. Other fields are free. The implementer adds the
   kind and its schema to the event catalogue (`scripts/catalogue-drift.mjs`).

3. **How a run is undone.** You run `deep undo <handle>` in your terminal, outside every session.
   - Exit 0 means the staged folders hold again what they held when they were staged.
   - Past `until`, it is refused with a non-zero exit, and it changes nothing.
   - The hub gets the OS-confirmation stub (`DEEP_HUB_TEST_CONFIRM`), so an undo that asks the OS to confirm you
     works. Whether it asks is the implementer's call.

   A CLI command was chosen because `deep inbox undo <ask>` already undoes a default from your terminal.

4. **How "this session changed the script" is learned.** Only through the real hooks. The agent writes `clean.sh`
   (AC3) and `wipe.sh` (AC2) with its Write tool. Its PreToolUse is allowed, the test writes the file, and its
   PostToolUse follows, as Claude Code sends them. The `tool.before` of the Write carries the path. `package.json`,
   `test.js`, `build.js` and the Cargo project are in the base commit, and no session touches them.

5. **The test file system that slows each clone**: `DEEP_HUB_TEST_SLOW_CLONE_MS=<ms>`.
   - Each clone the stager makes waits this long first. That covers a clone of a file and a clone of a folder: one
     `clonefile(2)` call, or whatever unit the stager clones by.
   - The variable is set on the hub and on every deep-hook run, through each session's Claude Code process, so it
     works wherever the stager runs.
   - This is the suite's only stand-in. A test can't make a real APFS volume slow without root.

   With `seconds: 2` and 3,000 ms per clone, any stager that makes even one clone passes the seconds ceiling.

The issue's planted stagers are selected the same way, with `DEEP_HUB_PLANT=<name>` on the hub and on every
deep-hook run (deep-hook already reads `DEEP_HUB_PLANT`). See Wrong programs.

### Playing Claude Code

The test is Claude Code. Each session has its own long-lived process (`fixtures/agent.mjs`, copied from #321's). That
process is the parent of every deep-hook run of that session. So `deep undo`, which the test process runs, is your
terminal.

A call runs only when deep-hook's PreToolUse allows it: exit 0 with no `deny` or `block`. Then the test runs it as
Claude Code's Bash tool would: `/bin/bash -c <command>` in the repository. After that comes its PostToolUse.

Claude Code ends a PreToolUse hook at its timeout and then runs the call. That timeout is `HOOK_TIMEOUT_MS`, read
from `adapters/claude-code.facts.json` (`hookTimeouts`: `perHook.PreToolUse`, or else `defaultMs`, 60 s at the base).
The fixture stops deep-hook 30 s after that, so a late reply reads as late.

### The world

Each test gets one `<tmp>` folder:

- `h/` is HOME: `h/.deepbuild` (rules.json, config.json) and `h/.claude/projects/...` (transcripts).
- `t/` is TMPDIR.
- `repo/` is a git repository with one commit:
  - `.gitignore` ignores `build/`, `dist/`, `cache/` and `target/`.
  - `package.json` has the scripts `test` (`node test.js`) and `build` (`node build.js`, which rewrites `dist/`).
  - `src/cart.js`, plus a Cargo project (`Cargo.toml`, `src/main.rs`) with no dependencies.

The folders under test are filled with files named `<prefix>-<world tag>-<n>.dat`, each with its own bytes. The
first few hold 64 KiB of random bytes:

- `cache/` (AC1): 40 files, ignored.
- `build/` (AC3): 30 files, ignored, an earlier build's output.
- `tmpdata/` (AC2): 5,000 files in 50 folders of 100, untracked and not ignored.

All three hold files git can't restore.

## What each judgement reads

**Staged before it runs, copy-on-write** (`expectStaged`; AC1, AC3's clean.sh):

1. Before the call, each 64 KiB file in the folder has all 64 KiB private (the control). If not, the test is BLOCKED:
   this file system can't show a clone.
2. deep-hook's PreToolUse allows the call. A deny or an ask fails.
3. At that moment, before the command runs, APFS reads 0 private bytes for each 64 KiB file, so a clone shares every
   block of it. `fixtures/private-size.c` reads `ATTR_CMNEXT_PRIVATESIZE` through getattrlist; the suite compiles it
   with `cc`.
   - This needs no knowledge of where the copy is.
   - It fails a stager that copies bytes, one that stages after it allows, and one that stages nothing.
4. Within 10 s, the record holds `command.staged` for the call. Its `folders` names the folder, and its `until` is
   its `ts` plus `staging.keep` (3 days, ±2 min).
5. The command runs and empties the folder. No ask raised since the call names the command, read 2 s after the run.

**Undone from the copy** (`expectUndone`): `deep undo staged:<id>` exits 0. Then the folder holds every file it held,
by relative path, each with the same SHA-256, and nothing else.

**Kept for a set time** (AC1's second test):

1. The hub stops and starts again with `DEEP_HUB_TEST_CLOCK` one minute past `until`.
2. Within 60 s, no file named as one of the folder's files is left anywhere under `<tmp>`. That covers home, the
   hub's root, TMPDIR and the repository with its `.git`.
3. `deep undo` of the staging exits non-zero.
4. The folder stays as the run left it, empty.

**An authority ask that its reach is unknown** (`expectAsked`; AC2):

- **Not let through.** deep-hook's PreToolUse doesn't allow `bash wipe.sh`. If it does, the test runs the script as
  Claude Code would and fails with "`bash wipe.sh` ran with no ask", counting what is left of `tmpdata/`.
- **Before the hook timeout.** deep-hook's reply ends within `HOOK_TIMEOUT_MS` of the call.
- **The ask.** An `ask.created` raised since the call has a `question` that holds `bash wipe.sh`. It must be:
  - of `kind` `authority`;
  - worded so it says the reach is unknown, matching `REACH_UNKNOWN`: "reach … unknown", "reach … not known",
    "reach … can't be known / worked out", or "unknown reach";
  - in the record with its `ts` no later than 1 s after deep-hook's reply ended.
- **The folder keeps its files.** `tmpdata/` holds all 5,000 files with their bytes.
- **Not staged.** No `command.staged` is recorded for the call.
- **The partial copy is dropped.** Within 20 s of the reply, no file named as one of `tmpdata/`'s is left anywhere
  under `<tmp>` outside `tmpdata/`. The search goes by file name, so it doesn't depend on where the stager put its
  copy. TMPDIR is inside `<tmp>` for that reason.

The ask isn't answered. Whether the hold denies the call, naming its ask as #321's holds do, or waits within the
timeout isn't fixed. Either way the call must not run.

**Neither staged nor asked about** (`neither`; AC3's builds):

1. The PreToolUse allows the call.
2. At the allow, no file named as one of `build/`'s files is anywhere under `<tmp>` outside `build/`, so the working
   folder wasn't staged.
3. The command runs and succeeds in the tiny project. If it doesn't, the test is BLOCKED.
4. 2 s later, no `command.staged` is recorded for the call, and no ask raised since names the command.

The three build commands are judged in turn: `npm run build`, `npm test`, `cargo build`. Every failure is gathered
into one message that names each command that went wrong.

AC3's first test ends with `bash clean.sh` staged (the "while" of the criterion). So it can't pass on a hub that
never stages anything.

### INCONCLUSIVE

On a loaded machine, deep-hook can miss the hub's acknowledgement, which must come within 50 ms of the hook's start.
deep-hook then decides alone:

- `no-unknown-reach-delete` is `fail_closed`, so a destructive command is denied.
- A build command is allowed.

A `late` mark on the call's `tool.before` isn't enough to tell. The hub can read the request off the socket and record
it live before it sees deep-hook gone, and the spooled copy marked late is then dropped as a duplicate ID. So
`decidedAlone` in `helpers.ts` reads every trace deep-hook leaves when it decides alone (`crates/deep-hook` main.rs
`forward`, `spool_by`, `watchdog`; core.ts `lateAnswered`). A call counts as decided alone when any of these holds:

1. **deep-hook's own words on stderr.** These are a fail_closed entry's denial ending "(guard …, which holds while
   the hub doesn't answer)", the watchdog's "deep-hook couldn't read …", or "deep-hook: spooled …" / "deep-hook:
   could not spool …". The hub's own denial of the same entry ends "(guard …)" and has none of them. Every denial
   deep-hook makes alone prints them.
2. **No `tool.before` for the call within 10 s.** The hub never had it.
3. **A `tool.before` marked `late`.** The spooled copy is the one recorded.
4. **The hub's `session.reading` "deep-hook let PreToolUse <id> through as late".** The hub appends this when it
   replays a spooled copy, marked late, of a call it had recorded live. The replay starts at the next hook that reaches
   the hub, so `neither` reads it after the command's PostToolUse and waits up to 5 s for it.

Where each judgement checks:

- `expectStaged` and `neither` check when the call isn't allowed.
- `expectAsked` checks whenever deep-hook didn't allow, before it reads the timing or the ask. A reply deep-hook made
  alone came before the hub could ask.
- `neither` also checks after an allow, but only once it has found nothing staged and no ask. A staging or an ask the
  hub recorded is a failure whoever decided the call.

A call decided alone is skipped as INCONCLUSIVE, with the load reading, and never passed (`helpers.ts`:
`Inconclusive`, `verdict`, `decidedAlone`). `failureOf` rethrows INCONCLUSIVE and BLOCKED, so neither counts as a
planted program's failure.

One case leaves no trace: deep-hook's watchdog allows a call at 48 ms because its main thread was starved before it
sent the request or read anything it could spool. On a correct hub, that is an allow it would have given anyway. Under
`stages-unpredicted-writes`, it can make the planted stager's `npm run build` read as neither staged nor asked about.
The wrong-program test then fails ("it passed") rather than passing.

## Wrong programs

Each wrong program is code the implementer writes. A test selects it with `DEEP_HUB_PLANT=<name>`, set on
`deep hub run` and on every deep-hook run.

- If the stager is in the hub, the plant goes in `packages/hub/src/plant.ts`'s list.
- If it is in deep-hook, deep-hook reads the same variable, as it already does for `waiter-outlives-session`.

A plant the base doesn't list stops the hub from starting (`plantOf` throws). Its test then fails BLOCKED, never
passes.

| Name | Criterion | What the plant does | The assertion that catches it |
|---|---|---|---|
| `stages-without-ceiling` | AC2 | The stager ignores both ceilings. It copies all 5,000 files of `tmpdata/` and lets `bash wipe.sh` through with no ask. | `expectAsked`'s first check: "AC2 #347.f308d7e8 [1,000 files] `bash wipe.sh` ran with no ask: deep-hook's PreToolUse allowed it…, it left tmpdata/ with 0 of its 5,000 files". The wrong-program test requires the message to hold "`bash wipe.sh` ran with no ask". |
| `stages-unpredicted-writes` | AC3 | The stager stages every command whose writes it can't predict, the build commands included, staging the working folder. | `neither`, for `npm run build`: "`npm run build` was staged: the record holds staged:… for it" or "…copies of build/'s files were in the world". The wrong-program test requires the message to hold "`npm run build` was staged". |

In the slow-clone variant, a stager with no ceiling also fails AC2. A per-file stager runs past the hook timeout, or
its hold ends with no ask. A stager that clones the folder in one call takes 3 s and lets the script run. The issue
names the wrong program for "this test", so the wrong-program test runs the 1,000-file scenario only.

AC1 names no wrong program. The base, which blocks every such command, is its wrong program (BASE-FAILURE.txt). Its
assertions also fail:

- a stager that copies bytes, not copy-on-write (step 3 of `expectStaged`);
- one that allows first and stages after (step 3);
- one whose undo restores nothing or the wrong bytes (`expectUndone`);
- one that keeps copies forever (the second test).

## Criteria to tests

Each `describe` names its criterion's ID: `#347.` and the first 8 hex of the SHA-256 of the criterion's text,
trimmed, whitespace collapsed, `- [ ] ` dropped, as `scripts/proof-change.mjs` computes it. Each test's name starts
with the criterion's number. Every failure message starts with `AC<n> <ID>`.

| ID | Criterion (short) | Test file | Tests |
|---|---|---|---|
| AC1 `#347.3abdadd8` | an unknown-reach delete runs only after its folders are staged copy-on-write, kept for a set time, and the run can be undone | `staged.test.ts` (2) | 1. `rm -rf cache/*`: allowed, with no ask, only once cache/'s blocks are shared with a clone; `command.staged` with `until` = ts + 3d; `deep undo` restores every file's bytes. 2. Same staging; hub restarted with its clock past `until`: copy let go, undo refused. |
| AC2 `#347.f308d7e8` | at 1,000 files, the agent-written script deleting a 5,000-file untracked folder isn't staged: partial copy dropped, an authority ask that its reach is unknown before the hook timeout, folder kept whole; a slow-clone file system past the seconds ceiling, the same; a stager with no ceiling fails | `ceiling.test.ts` (3) | 1. `staging.files` 1,000, `bash wipe.sh`. 2. `staging.seconds` 2, `DEEP_HUB_TEST_SLOW_CLONE_MS=3000`, files ceiling 100,000. 3. The wrong program `stages-without-ceiling`. |
| AC3 `#347.8c6cfb34` | `npm test`, `npm run build`, `cargo build` from scripts this session didn't change: neither staged nor asked about, while the agent-written `clean.sh` running `rm -rf "$OUT"/*` is staged and can be undone; a stager staging every unpredicted write fails, naming `npm run build` | `commands.test.ts` (3) | 1. The session writes clean.sh; the three builds run free and unstaged (run for real); then `bash clean.sh` is staged. 2. `bash clean.sh` staged, then `deep undo` restores build/. 3. The wrong program `stages-unpredicted-writes`, which must fail naming `npm run build`. |

The Proof section ("a staged delete undone from its copy, and a 5,000-file folder kept whole when the ceiling is
1,000, each shown failing first") is AC1's first test, AC3's second and AC2's first. BASE-FAILURE.txt shows each one
failing on the base.

## What this suite could not encode

- **A file system that can't clone** ("as on a file system that can't stage"). Showing this for real takes a
  non-APFS volume, such as an HFS+ or FAT disk image mounted with `hdiutil`. That is possible without root, but the
  criteria don't ask for it. AC2's two ceilings are what is encoded.
- **The seconds ceiling being below the hook timeout as a setting rule.** Is a `staging.seconds` of 60 or more
  refused, or clamped? The issue doesn't say. The tests only set values below it (2 and 20) and check that the ask
  arrives before the timeout.
- **The ask's default and deadline.** It is an authority ask, so it defaults to no. #318's and #321's suites cover
  that path, and this suite doesn't let the deadline pass.
- **With the hub down.** A destructive command whose reach can't be worked out is denied. That is the base's
  behavior (#304/#316's `fail_closed` entry), and it is not this issue's.
- **What `npm run build` writes is not predicted by anyone.** The test only judges what the hub and deep-hook do with
  the call. It doesn't judge how a correct stager tells the build commands apart from `clean.sh`, whether by
  deep-hook's matcher alone (`effect:unknown-reach-delete` matches neither build command at the base) or by the
  session's writes.
