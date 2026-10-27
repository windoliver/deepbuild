# Acceptance tests for #19: setup, undo and the first moments after install

A blind job wrote these tests before any implementation of #19 existed. It worked from:
- issue #19 (its body as of October 27, 2026);
- the design sections the issue links: How it installs, One hub per user, Hooks are evidence, Sessions that know about
  each other, Numbers version 0 has to hold, and Socket roles and contract versions;
- the design's Before each command, Plan usage (the status line forwarder) and Threats;
- base commit `0350cf0`, with the merged code of #15 #16 #17 #18 #315 #24 #26 #34 and their suites.

The implementing agent does not edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

The issue has 25 checkbox criteria, AC1 to AC25 in the body's order. **This folder covers AC5, AC6, AC13, AC14, AC20
and AC23.** Three other blind jobs cover the rest in sibling folders under `tests/acceptance/19/`. Codex's hook entries
and doctor items are tested with its adapter (#39), not here: these tests cover Claude Code's side only.

## How to run

With Node 24.22 first on `PATH`, the workspaces built (`npm run build --workspaces`), on macOS:

```sh
cargo build --locked -q -p deep-hook          # setup's entries run the newest of target/{release,debug}/deep-hook
npx vitest run --root tests/acceptance/19/setup --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/19/setup/tsconfig.json
```

- `--no-file-parallelism`: each test runs setup, which starts a hub.
- **Folders.** Every test makes its folders under `/tmp/dh19s-*`, because a socket path must fit in 104 bytes. HOME is
  `<tmp>/h` for every process it starts. It never touches the real `~/.deepbuild`, `~/.claude`, `~/.claude.json` or
  `~/Library/LaunchAgents`.
- **Processes.** It stops only processes it started, by PID, including the hubs the launchd stand-in started. Children
  get no billing key and none of the runner's `DEEP_*`, `CLAUDE*`, `CODEX*` or `GIT_*` variables. Every `deep` runs in
  a temp folder, never in this checkout.
- **Cache.** With `--root` here, Vitest writes its cache to `tests/acceptance/19/setup/node_modules/.vite/`. Delete it
  before committing.
- **Not macOS.** On any other platform every test fails BLOCKED. The launchd stand-in is the only login service stood
  in for, and on Linux setup would reach the real systemd.

### Stand-ins, first on PATH as `<tmp>/bin`

These are the boundaries we don't own:

- **`launchctl`** runs `fixtures/launchd.mjs`, a stand-in for launchd. It keeps the loaded jobs in `<tmp>/bin/launchd/`.
  - `bootstrap`/`load` loads a plist and, with `RunAtLoad`, starts its `ProgramArguments`. The program runs detached,
    with the caller's environment plus the plist's `EnvironmentVariables`. So `deep setup` really starts the hub
    through its login service, and a test seam set on setup (`DEEP_HUB_PLANT`, `DEEP_HUB_TEST_CONFIRM`) reaches the
    hub.
  - `bootout`, `unload` and `remove` stop the job and unload it. `kickstart`, `print` and `list` answer as launchctl
    does.
  - A test-only `__relogin` stands for a logout and a new login: every job is stopped, then every plist in
    `~/Library/LaunchAgents` is loaded.
  - Each call is logged to `<tmp>/bin/calls.log`.
- **`claude`** and **`systemctl`** (`fixtures/stub-bin.sh`) log their call and exit 0. `claude --version` answers the
  newest version the facts cover.
- **`sh-login`** is `SHELL`, your login shell. Its PATH is `<tmp>/bin`, Node's folder and the system folders. It
  drops `-l`/`-i`, so no profile of the test machine is read.
- **`deep`** runs the built CLI.
- **Claude Code** is `fixtures/claude.mjs`, #18's stand-in copied as-is. It runs a settings file's command hooks as
  Claude Code does and starts its own `deep mcp`.

## The surface under test

### Merged surfaces, used as their suites define them

- **`deep setup`**, which writes DeepBuild's hook entries into `~/.claude/settings.json` (#18). DeepBuild's entries
  are those whose command runs deep-hook or the deep CLI (#18's rule).
- **The hub's login service** as `deep hub start` writes it (#16, `service.ts`):
  - the plist is `~/Library/LaunchAgents/<label>.plist` (today `com.deepbuild.hub`);
  - its `ProgramArguments` run `deep hub run`;
  - it is loaded with `launchctl bootstrap gui/<uid> <plist>`.
- **The tests find the service by its program, not by its label**: any plist there whose `ProgramArguments` run `hub run`
  through the deep CLI.
- **The hub's socket** at `~/.deepbuild/hub.sock` and its line protocol (#16):
  - `events.read` on a `cli` connection;
  - `evidence.paste` on an `app` connection with the control token. The base allows it for `app` only.
- **The address setting** `hub.address` in `~/.deepbuild/config.json` (#16). AC6 points it at a forwarded socket that
  keeps the hub's acknowledgements.
- **The hook protocol's acknowledgement** `{ack, hold_until_ms}`. A number is a held hook, `null` is not held (design:
  Hook protocol).
- **deep-hook** as a settings entry runs it (#315).
- **The guard entries in `~/.deepbuild/rules.json`** and `crates/deep-hook/default-rules.json`, whose
  `no-kill-by-name` is fail_closed (#316, #317).
- **`deep mcp`** and its `deep_claim` and `deep_run`, which runs a check `.deepbuild/done.yaml` names (#26).
- **The status line forwarder** is `deep-hook statusline` as Claude Code's `statusLine` command. It runs your own
  command, recorded as `statusline.yours` in `~/.deepbuild/config.json` (#159's surface; deep-hook has it).
- **The skill** is `skills/deepbuild/SKILL.md` (#26).
- **The record** is read after the hub stops through `@deepbuild/record`'s `openRecord`.

### The OS confirmation

`deep setup --undo` takes effect only once the OS confirms you (Scope; AC21 and AC23). These tests run every process
with `DEEP_HUB_TEST_CONFIRM=<tmp>/confirm`, and that file holds `confirmed`. This is #24's seam
(`packages/hub/src/confirm.ts`): the hub asks the OS, and the seam stubs the answer. No real LocalAuthentication
prompt can appear.

The variable reaches the hub, which the login service started from setup's environment, and also reaches the undo
command itself. If the implementation has the CLI ask without a hub, it must read the same variable the same way:
`confirmed` counts, anything else is a cancelled prompt. These tests only ever confirm. A cancelled undo is AC21's, in
another folder.

### Defined here, where the issue and the design leave a surface open

1. **`deep setup` starts the hub through its login service** (design: "Setup … starts the hub"; "the hub runs as a
   per-user service that starts at login").
   - No hub runs before setup in these tests. Setup must load the login service, and the hub that service starts must
     answer at `~/.deepbuild/hub.sock` within 30 s of setup's exit.
   - Setup and undo must reach `launchctl` through `PATH`, as `service.ts` does. A `launchctl` called by absolute path
     would reach the real launchd.
2. **`deep setup --undo`**: 0 when it undid everything, as the issue's exit table says for ok. It runs in a temp folder.
3. **Your settings** (AC5) are the files of yours that setup writes to or beside:
   - `~/.claude/settings.json`;
   - `~/.claude.json`, where Claude Code keeps user-scope MCP servers;
   - your own skill folder `~/.claude/skills/mine/`;
   - your own launch agent `~/Library/LaunchAgents/com.example.mine.plist`.

   "Byte-for-byte" means the same bytes, still a plain file. A file that didn't exist before setup must not exist
   after the undo.
4. **The MCP registration** is DeepBuild's server at Claude Code's user scope, in either of two ways:
   - an entry in `~/.claude.json`'s `mcpServers` whose command line runs `deep mcp` (the CLI's `main.js` or `deep`,
     then `mcp`); or
   - a `claude mcp add`/`add-json` call that names such a command, seen in the claude stand-in's log.

   Removed means no such entry is left, and each name added through `claude mcp add` was later given to
   `claude mcp remove`.
5. **The skill** is a folder under `~/.claude/skills/` (Claude Code's user skills folder) whose `SKILL.md` has
   `name: deepbuild` or the checkout's skill bytes. A symlink to the checkout's folder counts.
6. **The status line forwarder** is installed when `statusLine.command` in `~/.claude/settings.json` is DeepBuild's
   and names `statusline`. Restored means `statusLine` equals yours again.
7. **Keeping `~/.deepbuild/`** (AC23) means three things:
   - every event read before the undo is still in `ledger.db`;
   - every file under `evidence/` and `wiki/` is still there with the same bytes;
   - the undo's output names `<home>/.deepbuild` or `~/.deepbuild`.
8. **"No stop is held"** (AC6) means the hub's acknowledgement of the Stop has `hold_until_ms: null`, and DeepBuild's
   foreground Stop entry exits 0 with no `decision` in its reply.
   - "No verdict blocks" also means the session's next Edit and `ls` are not denied.
   - "The fast safety rules apply" means the agent's `pkill -f vite` is denied, saying why ("name or port"). With the
     hub up, DeepBuild's PreToolUse entry denies it; with the hub stopped by PID, deep-hook denies it on its own. A
     denial is exit 2 or `permissionDecision: deny`. So setup must install the default guard entries as
     `~/.deepbuild/rules.json`, or an equivalent that deep-hook reads.
   - "A repo whose checks you haven't approved" is a repo with a `.deepbuild/done.yaml` that nothing approved.
9. **A strict refusal** (AC14) has four parts:
   - the file keeps its bytes;
   - "a copy is kept" is any other file under HOME with exactly those bytes;
   - setup's output names the duplicate key;
   - setup exits non-zero, because a setup that installed nothing into the file can't report ok (invariant 2).
10. **Through a temporary file beside the linked file** (AC20) has four parts:
    - the linked file's inode changes, so it was replaced whole, not written in place;
    - `fs.watch` on `~/.claude` sees no file named like the settings appear and go;
    - nothing new is left in the dotfiles folder;
    - `~/.claude/settings.json` is still a symlink with the same relative target.

### Additions the implementation must make

1. Setup loads the login service, so the hub it starts answers (above). It also installs:
   - the guard entries as `~/.deepbuild/rules.json`;
   - the MCP registration;
   - the skill;
   - the status line forwarder.
2. `deep setup --undo`, confirmed through the hub as #24 does. It restores your files' bytes and removes everything
   setup added.
3. Six planted wrong programs, selected with `DEEP_HUB_PLANT=<name>`. The tests set it on `deep setup`, on
   `deep setup --undo` and on the Claude Code stand-in, and the hub inherits it from setup through the login service.
   So a plant may live in the CLI's setup or in the hub. Each name must also be on the hub's plant list
   (`packages/hub/src/wire.ts`), since the hub exits at start on a name it doesn't know.

   | Name | What the plant does | Criterion | How the test fails on it |
   |---|---|---|---|
   | `undo-reserializes` | undo takes DeepBuild's entries out of `~/.claude/settings.json` by parsing it and writing the JSON back (2-space `JSON.stringify`), instead of restoring the kept bytes | AC5 | `undo.test.ts`: "AC5 deep setup --undo must leave …/.claude/settings.json byte-for-byte as it was before setup: …" |
   | `gates-before-approval` | the hub gates a repo's drafted, unapproved checks: it holds a session's Stop, or answers it with `decision: block`, when the session's latest claim has a failed run | AC6 | `watchonly.test.ts`: "AC6 right after install the hub held / a verdict blocked the Stop of session <id> …" |
   | `setup-writes-project-settings` | setup also merges its hook entries into `.claude/settings.json` of the folder it runs in | AC13 | `userlevel.test.ts`: "AC13 deep setup must change no file inside a repo; in …/shop: .claude/settings.json changed …" |
   | `setup-last-duplicate-wins` | setup reads `~/.claude/settings.json` with a parser that keeps the last duplicate and writes it back. Everything else, the undo's restore included, stays as it should | AC14 | `strict.test.ts`: it passes AC5's setup-then-undo, then fails "AC14 deep setup must leave …/.claude/settings.json, which repeats the key "cleanupPeriodDays", byte-for-byte as it was" |
   | `setup-renames-over-link` | setup writes its temporary file and renames it over `~/.claude/settings.json` itself, as the base does | AC20 | `symlink.test.ts`: "AC20 …/.claude/settings.json must still be the symlink to ../../dotfiles/claude/settings.json after deep setup: setup replaced the link with a plain file" |
   | `undo-keeps-login-service` | undo does everything else but leaves the login service's plist in place and loaded | AC23 | `uninstall.test.ts`: "AC23 deep setup --undo must unload and remove the hub's login service com.deepbuild.hub (…)…; it starts the hub again at the next login" |

   The shared `tests/acceptance/19/twins.json` sits outside this folder; the implementer adds it, or adds these lines
   if it exists. It should map each criterion ID to its plant:
   - `#19.ff6a4c13` to `undo-reserializes`;
   - `#19.3cfcabc5` to `gates-before-approval`;
   - `#19.fddcc673` to `setup-writes-project-settings`;
   - `#19.87dafab9` to `setup-last-duplicate-wins`;
   - `#19.b955aed6` to `setup-renames-over-link`;
   - `#19.abfcb227` to `undo-keeps-login-service`.
4. The suite is macOS-only for now. If `scripts/lanes.mjs` must know that, it is the implementer's addition; this job
   edits nothing outside its folder.

## Criteria to tests

Each ID is `#19.<first 8 hex of SHA-256 of the criterion's text>`, as `scripts/proof-change.mjs` computes it and as
`criteria.txt` lists it.

| ID | Criterion (short) | Tests | Wrong program each fails on |
|---|---|---|---|
| AC5 `#19.ff6a4c13` | setup then undo leaves your settings byte-for-byte | `undo.test.ts`: (1) your hand-written settings.json (tabs, a `\u` escape, no final newline, your status line and hooks), ~/.claude.json, skill and launch agent are byte-identical after setup and a confirmed undo; (2) with none of those files before, none after; (3) plant | `undo-reserializes`; an undo that leaves entries, the forwarder or a created file; the base (no undo) |
| AC6 `#19.3cfcabc5` | right after install no stop held, no verdict blocks; fast safety rules from the start | `watchonly.test.ts`: (1) setup in a repo with a drafted failing check; the session claims done, the run fails, the Stop is acknowledged `hold_until_ms: null` with no decision, the next Edit and `ls` go through, `pkill -f vite` is denied with the hub up and stopped; (2) plant | `gates-before-approval`; the base hub, which holds every stop; a setup with no rules.json (the base) or rules in watch mode |
| AC13 `#19.fddcc673` | hook entries only at user level; no repo file changes | `userlevel.test.ts`: (1) setup in repo `shop`, with `blog` in your history; every path in both (bytes, mode, ns mtime, the root folder's, `.git/config` and `.git/hooks/`) unchanged; DeepBuild's entries in ~/.claude/settings.json; (2) plant | `setup-writes-project-settings`; any setup writing a project settings file, `.mcp.json`, a repo skill or a git hook |
| AC14 `#19.87dafab9` | duplicate key: file left byte-for-byte, copy kept, key named; last-dup-wins passes undo, fails this | `strict.test.ts`: (1) top-level `cleanupPeriodDays`; (2) nested `env.MY_TOOL_HOME`; (3) plant passes AC5's scenario and fails (1) | `setup-last-duplicate-wins`; the base setup (JSON.parse + write) |
| AC20 `#19.b955aed6` | settings.json a symlink: written through a temp beside the linked file, link stays | `symlink.test.ts`: (1) relative link into `<tmp>/dotfiles/claude/`; after setup the link is the same, the linked file holds DeepBuild's entries and yours, its inode changed, no settings temp came and went in ~/.claude, nothing left in dotfiles; (2) plant | `setup-renames-over-link` (the base); an in-place write (same inode); a temp in ~/.claude |
| AC23 `#19.abfcb227` | undo removes login service, MCP, skill, forwarder; restores your status line; keeps ~/.deepbuild, saying where | `uninstall.test.ts`: (1) setup with controls that each of the four is installed; a session's events, a pasted image and a wiki page in ~/.deepbuild; after a confirmed undo: no hub plist, nothing loaded, a new login starts no hub; no MCP entry; no skill; your status line back; every event, evidence and wiki file kept; output names the folder; (2) plant | `undo-keeps-login-service`; an undo that only stops the hub; one that removes ~/.deepbuild or a part |

## Disputes

1. **AC6 and the answer route.** A session's own open `deep_ask` gets its stop held so the answer can come back in the
   same turn, and #18's AC14 tests that hold right after setup. The design's "no stop is held until you approve
   something" would forbid it. AC6 here probes only a stop with nothing to deliver: no open ask, a claim, a failed run.
   If the implementer reads AC6 as forbidding the answer route's hold too, that conflicts with #18 and goes to a
   redraft.
2. **AC6 after approval.** "Until the user approves a repo's checks" has no approval surface in #19 or at this base,
   so the gates-turn-on half isn't tested. The test holds only the "before approval" half.
3. **A file that didn't exist** (AC5, second test). These tests read "as they were" as absent stays absent. Design:
   "keeps that file's original bytes once … undo … restore[s] from them"; "Removing DeepBuild … restores that agent's
   settings exactly". An undo that leaves `{}` or an empty settings.json fails.
4. **~/.claude.json as your settings** (AC5). Setup's MCP registration may write it, so it is held to the same bytes.
   If the implementer registers through `claude mcp add` (logged by the stand-in, which writes nothing), that file
   isn't touched and the check holds.
5. **Setup's exit after a strict refusal** (AC14). The criterion doesn't name a code. These tests require non-zero
   (invariant 2). They don't choose between 1 and 3.
6. **"Beside it"** (AC20) is read from outside, as in item 10 above. A setup that keeps a permanent backup in your
   dotfiles folder fails the "nothing left" check: a temporary file is removed. A copy kept elsewhere, such as under
   ~/.deepbuild, is fine.
7. **The login service is a launchd stand-in**, not the real one. The real service manager is never reached. A setup
   that calls `/bin/launchctl` by path would escape it; that is listed as an addition, not tested.
8. **AC13's `.git`.** Git's own bookkeeping (index, logs) is excluded. Setup may read a repo with git, which can
   refresh the index. A git hook, or a change to `.git/config`, counts.

## Files

- `helpers.ts`: covers
  - temp homes with the stand-ins;
  - `deep setup` and `deep setup --undo`;
  - your files (`seedYours`);
  - DeepBuild's entries, MCP registration, skill, forwarder and login service as the tests find them;
  - the launchd stand-in's state and `relogin`;
  - the hub's socket and a forwarder;
  - snapshots and byte comparisons;
  - sessions and the Claude Code stand-in.
- `scenarios.ts`: AC5's setup-then-undo, shared with AC14's plant test.
- `undo.test.ts` (AC5), `watchonly.test.ts` (AC6), `userlevel.test.ts` (AC13), `strict.test.ts` (AC14),
  `symlink.test.ts` (AC20), `uninstall.test.ts` (AC23).
- `fixtures/launchd.mjs` (the launchd stand-in), `fixtures/stub-bin.sh` (claude, systemctl), `fixtures/claude.mjs`
  (#18's Claude Code stand-in, copied as-is).
- `tsconfig.json`: type-checks the suite under the root's strict options.
- `BASE-FAILURE.txt`: the run on the base commit and why each test fails there.
