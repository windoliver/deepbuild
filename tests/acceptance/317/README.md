# Acceptance tests for #317: deep-hook floor entries

Written first, blind, from issue #317 (its text as of October 25, 2026: Scope, the 9 checkbox criteria, Proof and
Depends on; it has no comments), the design sections it links ([Before each command], [Hooks are evidence, not a
state machine]) and those around them ([One hub per user, a tiny hook client, and extensions in-process], [Hook
protocol (deep-hook and the hub)], [Threats, and what stops each one], and the lines on `control.token`, `deep hub
use`, `deep restore`, safe mode and the login service), the text of its parent #17 and of #316, #572, #67, #246, #23
and #304, and base commit `0954514` (origin/main, which holds #316's matcher), by a job that never saw an
implementation of #317. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job.

The issue has 9 checkbox criteria, AC1 to AC9 in the body's order. All 9 are covered here.

## How to run

With the repo's Node (`.node-version`, 24.22.0) and Rust toolchain:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # twice: the first build after install fails on declaration order
cargo build --locked -q -p deep-hook     # warm the binary so a beforeAll doesn't time out under load
npx vitest run --root tests/acceptance/317 --no-file-parallelism
```

- `--no-file-parallelism` keeps the files from running side by side: several start real hubs.
- Nothing needs the network. No planted call is ever run against this machine: deep-hook only decides, and the
  test reads its decision. The one exception is AC3's script, which a test runs only inside its own temp repo and
  only after deep-hook allowed it, to show what a fail-open deep-hook does.
- Every test makes its own folders under `/tmp/dh317-*` (a Unix socket path must fit in 104 bytes on macOS), sets
  `HOME` to one of them for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude`,
  `~/.codex` or launchd. It stops only processes it started, by PID (`helpers.ts`, `cleanup`). A child never
  inherits this process's billing keys or `DEEP_*`/`GIT_*`/`AWS_*` settings; every git call in a temp repo runs
  with `core.hooksPath=/dev/null` and signing off.
- Type-check with `node node_modules/typescript/bin/tsc -p tests/acceptance/317/tsconfig.json`. The tests reach the
  code only through the `deep-hook` binary, `deep hub run`, and the files under `HOME`.

## The surface under test

As #316's suite: deep-hook run as a hook entry (`deep-hook claude-code PreToolUse`, the payload on stdin, `HOME`
the temp folder), its decision read as exit 2 or a `deny` for Claude Code's PreToolUse (`helpers.ts`, `decision`),
an allow as exit 0 with no deny. Every denial must **carry one shipped entry's `reason` and that same entry's
`next_step` verbatim** (`carriesReasonNextStep`), so it says why in a real entry's words. The tests are **blind to
the `match` language**: they install whatever the implementer ships and assert only which call is denied, which
allowed, and what the denial names. The smallest additions below are defined here, each with why.

### Where the entries live, and how a test installs them

- **The core's defaults** stay where #316 put them, `crates/deep-hook/default-rules.json` (`{v, entries}`), and
  are installed as `$HOME/.deepbuild/rules.json`. The new floor entries (switching off, `~/.deepbuild/`, the token,
  `deep restore`, cloud resources, unknown reach) ship there too: they hold for every user, with the hub down and
  no extension loaded.
- **This repo's own entries** (AC4) are a repo file, **`.deepbuild/rules.json`** at the repo root, the same `{v,
  entries}` shape. The design keeps a repo's specs under `.deepbuild/`, "reviewed like code", with a guard that
  stops agents editing them, and lists "a repo's rules" among the entries the hub writes into `rules.json`
  ([Before each command]). So the file that protects the repo-rules check is itself under the `.deepbuild/` guard,
  and an agent can't loosen it either. A test installs **the defaults and this repo's entries merged by name** into
  `$HOME/.deepbuild/rules.json`, as the hub's install writes it (#304); a name in both is an error, never an
  override. The repo's entries are not part of the defaults, since every other repo has its own `scripts/`.

### Hub stopped, hub up, and safe mode

- **Stopped**: no hub at the address, `$HOME/.deepbuild/hub.sock` (#315's plainest stopped form).
- **Up**: the installed hub, a real `deep hub run` with `HOME` the temp folder, so its root is `$HOME/.deepbuild`
  and it reads the same `rules.json`. Its ready line gives the test **the hub's PID**; how deep-hook learns it
  (the socket's peer, per Scope) is the implementer's.
- **Up in safe mode** (AC1): **`deep hub run --safe`**, which starts the hub with no extension loaded. The design
  says "safe mode starts the hub with none loaded" but names no switch; a flag on `deep hub run`, the command that
  is the hub, is the smallest that a test and the login service can both pass. The test needs the hub to start and
  answer; it doesn't read how the hub reports the mode.

### What a denial must name

- **"Naming the command for you to run"** is pinned to: the denial contains the **command as written, unwrapped**
  (for `nohup deep off`, `sh -c '…'` or a heredoc, the inner `deep off`), compared after `~/` and `$HOME/` are read
  as the home folder, quotes are dropped and whitespace is collapsed (`helpers.ts`, `plain`). So a denial that says
  `sqlite3 /…/h/.deepbuild/ledger.db "insert …"` names `sqlite3 ~/.deepbuild/ledger.db 'insert …'`. For an Edit
  tool call (no command), it names the file's path.
- **"Naming the file"** (AC8) is: the denial contains the token file's path, `~/.deepbuild/control.token` or the
  same path written out.
- **"Names `deep_propose`"** (AC1, AC4) is the literal word in the denial.
- **"With the reason" / "naming why"** (AC2, AC3) is the shipped entry's `reason` and `next_step`, as for every
  denial. This means the cloud-resource rule and the unknown-reach rule ship as default entries, as the design's
  "one guard engine evaluates every entry" says.

### Readings where the issue leaves a choice

- **"The plan doesn't name"**: with the hub stopped deep-hook can read no plan, only `rules.json`. A KMS key in an
  AWS account no standing rule names is `aws kms create-key --profile shop-new-account …` with only the defaults
  installed, so no standing rule covers it. Its twin, `aws kms list-keys` for the same profile, creates nothing.
- **"Allowed and recorded"** (AC2, `npm install left-pad@1.3.0`): allowed with the hub stopped, and once the hub
  starts and replays the spool, its record holds an event carrying that session's ID and the command (read with
  `events.read` over the hub's socket, as the CLI reads it). Recorded means in the record, not only in the spool.
- **"An agent-written script"** (AC3): in a temp repo whose `build-cache/` is untracked, the session first sends a
  Write of `scripts/clean.sh` (decided, allowed, then written as the tool would), then runs it as
  `./scripts/clean.sh` and as `sh scripts/clean.sh`. The script `cd`s to its repo and runs `rm -rf build-cache`.
  The twins only read: `cat scripts/clean.sh` (the text mentions `rm -rf`) and `ls build-cache`.
- **"In this repo"** (AC4): the session's cwd is this checkout and the payloads name its real files. Nothing is
  written: deep-hook only decides.
- **The login service**: the base names it `com.deepbuild.hub`, with its plist at
  `~/Library/LaunchAgents/com.deepbuild.hub.plist` (`packages/hub/src/service.ts`), so the planted calls are
  `launchctl bootout gui/<uid>/com.deepbuild.hub` and `rm ~/Library/LaunchAgents/com.deepbuild.hub.plist`.
- **"An Edit of `~/.deepbuild/rules.json` from an agent's Bash or Edit tool"**: the Edit tool, and from Bash
  `sed -i s/block/watch/ ~/.deepbuild/rules.json` in all four forms.
- **The four forms**: `X`, `sh -c 'X'` (double quotes when X holds single quotes), `nohup X`, and
  `sh <<'EOF'\nX\nEOF` (`helpers.ts`, `forms`).
- **"A dev hub's folder"**: a folder beside the temp home, not `$HOME/.deepbuild`. For AC6 the test starts a real
  dev hub there (`deep hub run --root <folder>`), standing for the one the agent started. **The installed hub's
  own folder** is denied both as `~/.deepbuild` (the criterion) and written out in full (Scope: "never with the
  installed hub's own folder").
- **"A PID the session started"**: a `sleep` the test started and owns. With the hub up, `kill -9 <hub pid>`
  (direct and through `sh -c`) and `kill -TERM <hub pid>` (Scope: "signals the hub's process") are denied, and
  `kill <sleep pid>` and `kill -9 <sleep pid>` are allowed.
- **"The worktree's next session still reaches the installed hub"** (AC6): after the denial, a new session's
  SessionStart from that worktree, through deep-hook, lands in the installed hub's record and not in the dev hub's.
- **With the token's file present and the hub stopped** (AC8), the file is left from the hub's last launch (the
  test writes a fake one). Twins from the design ("the wiki" lives at `~/.deepbuild/wiki/`, and only the token's
  read is named): a Read and a `cat` of `~/.deepbuild/wiki/index.md` are allowed.
- **Twins beyond the criteria's own** are listed above with their source in Scope or the design; each is a
  precision guard that a floor denying too much fails.

## Criteria to tests

Each `describe` names its criterion's ID, `#317.<first 8 hex of SHA-256 of the criterion's text>` (trimmed,
whitespace collapsed, `- [ ] ` dropped), as the trace lane reads tags. Each test's name starts with its
criterion's number.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#317.24a63675` | Edit/Write/`sed -i` of `.deepbuild/done.yaml` denied, hub stopped and safe mode, naming `deep_propose` | `floor.test.ts` AC1: stopped; safe mode; the wrong program |
| AC2 `#317.5ca7ac42` | hub stopped: KMS key denied with the reason; `npm install` allowed and recorded; write to `rules.json` denied | `plan.test.ts` AC2: KMS (+ list-keys twin); npm recorded; Write of rules.json |
| AC3 `#317.451c838d` | hub stopped: `scripts/clean.sh` deleting untracked `build-cache/` denied, naming why; folder keeps files | `plan.test.ts` AC3: the run (+ cat/ls twins); the wrong program |
| AC4 `#317.6536a48a` | in this repo, writes of `scripts/repo-rules.{json,mjs}` denied naming `deep_propose`; Edit of `scripts/lanes.mjs` allowed | `floor.test.ts` AC4: the six writes and the twin; the wrong program |
| AC5 `#317.fdb52438` | can't switch DeepBuild off from the shell, hub stopped and up, four forms, naming the command; twins allowed | `switch-off.test.ts` AC5: stopped; up; the hub's PID; two wrong programs |
| AC6 `#317.b03220bf` | `deep hub use --root` denied, hub stopped and up, direct and `sh -c`; next session reaches the installed hub | `switch-off.test.ts` AC6: stopped; up; the next session; the wrong program |
| AC7 `#317.ef09b629` | hub stopped: `rm`, `: >`, `mv` over, `ln -sf /dev/null` onto `rules.json` denied, naming the command | `home.test.ts` AC7: the four; the wrong program |
| AC8 `#317.632c7ebb` | hub stopped and up: Read/`cat`/`cp`/`base64` of `control.token`, direct and `sh -c`, denied, naming the file | `home.test.ts` AC8: stopped; up (+ wiki twins); the wrong program |
| AC9 `#317.80848a53` | hub stopped and up: `deep restore ~/backup` in four forms denied, naming the command; twins allowed | `switch-off.test.ts` AC9: stopped; up; the wrong program |

## Wrong programs

Every wrong program the issue names is about **which entries the defaults hold**, so each is built as **data**,
test-side, and blind to `match` spellings (`helpers.ts`, `without`): each shipped entry is installed **alone**
with the hub stopped, every entry that alone denies the named call is removed, and the rest is installed as
`rules.json`. If no entry holds the call, there is nothing to remove, and the wrong-program test **fails** ("no
shipped entry … denies …; the wrong program can't be made"), so it never passes on a build that lacks the entry
(the base). No cargo plant is needed, and the implementer writes none, so no plant can be made convenient.

The named call is checked **first** in the wrong program's run, so the run fails naming that call. Where the named
program is narrower than the one built (AC5's "protects only rules.json", AC7's "guards only Edit and Write"), the
outcome is the same: the first call checked is one both let through, and the run fails at it, naming it.

| Criterion | Wrong program the issue names | Built as | How the test fails on it |
|---|---|---|---|
| AC1 | a build that leaves the guard to the done gate extension | the defaults without every entry that denies an Edit of `.deepbuild/done.yaml` (with no extension loaded, nothing else holds it), run with the hub stopped and in safe mode | "`Edit .deepbuild/done.yaml` … must be denied", in both |
| AC3 | a deep-hook that fails open on the script | the defaults without every entry that denies `./scripts/clean.sh` | the call is allowed, the test runs it in its temp repo, and fails: "build-cache/ went from 4 to 0 files" |
| AC4 | a guard that protects only `.deepbuild/` | the defaults and this repo's entries without every entry that denies an Edit of `scripts/repo-rules.json`; the test first shows it still denies an Edit of `.deepbuild/done.yaml` | "`Edit scripts/repo-rules.json` … must be denied" |
| AC5 | defaults that protect only `rules.json` | the defaults without every entry that denies the `sqlite3 ~/.deepbuild/ledger.db` write | "`sqlite3 ~/.deepbuild/ledger.db 'insert …'` … must be denied" |
| AC5 | one without the `deep off` entry | the defaults without every entry that denies `deep off` | "`deep off` … must be denied" |
| AC6 | one without the `deep hub use` entry | the defaults without every entry that denies `deep hub use --root <dev>` | "`deep hub use --root <dev>` … must be denied" |
| AC7 | a floor that guards only Edit and Write of the file | the defaults without every entry that denies `rm ~/.deepbuild/rules.json` | "`rm ~/.deepbuild/rules.json` … must be denied" |
| AC8 | a floor that guards only writes under `~/.deepbuild/` | the defaults without every entry that denies `cat ~/.deepbuild/control.token` | "`cat ~/.deepbuild/control.token` … must be denied" |
| AC9 | one without the `deep restore` entry | the defaults without every entry that denies `deep restore ~/backup` | "`deep restore ~/backup` … must be denied" |

A floor rule compiled into deep-hook instead of shipped as an entry survives the removal, so its wrong-program
test fails: these rules are data in `rules.json`, as #316 made them.

## What depends on other issues

- **A standing rule that covers a cloud resource** (the "unless a standing rule the hub copied into `rules.json`
  covers it" half of Scope) is #23's last criterion; this suite only shows the deny when none covers it.
- **The install-time check** that each entry's planted call is denied and its twin allowed, and refusing one that
  isn't, is #304's. These tests run the calls the criteria name; they don't read entries' shipped planted calls.
- **`deep restore` itself** is #572 (R2) and **workspaces** are #67 (R2). Writes under `~/.deepbuild/workspaces/`
  staying allowed is in Scope but in no criterion, so it isn't tested. `deep off`, `deep on`, `deep setup --undo`
  and `deep hub use` needing the OS to confirm you is #19's and the CLI's, not deep-hook's.
- **Safe mode** is a flag this suite defines on `deep hub run`; with no extension host wired into the hub at the
  base, the hub up in safe mode and the hub up otherwise load the same nothing.
- Not tested, though in Scope: writing the service file (beyond `rm` of it), `launchctl unload`, a service or a
  top-level folder the plan doesn't name, and a destructive command of unknown reach other than AC3's script.

## Files

- `helpers.ts`: temp homes, the default and repo entries installed as `rules.json`, deep-hook run as a hook entry,
  the four command forms, the naming check, worlds with the hub stopped, up or in safe mode, the hub's record read
  over its socket, real git checkouts, and `without`, which builds each wrong program as data.
- `floor.test.ts` (AC1, AC4), `plan.test.ts` (AC2, AC3), `switch-off.test.ts` (AC5, AC6, AC9), `home.test.ts`
  (AC7, AC8).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, with the reason each test fails there.

[Before each command]: ../../../docs/technical-design.md
[Hooks are evidence, not a state machine]: ../../../docs/technical-design.md
[One hub per user, a tiny hook client, and extensions in-process]: ../../../docs/technical-design.md
[Hook protocol (deep-hook and the hub)]: ../../../docs/technical-design.md
[Threats, and what stops each one]: ../../../docs/technical-design.md
