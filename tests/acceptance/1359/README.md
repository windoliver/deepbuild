# Acceptance tests for #1359: a newcomer's first run

Written blind, by a job that read only the issue, the design and the base commit; it never saw the implementing
work. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

The issue has eleven checkbox criteria, AC1 to AC11 in the body's order. Items 1 to 8 (AC1 to AC8) were implemented by
PR #1403 (merge 80ba48fe, its base 3d30b4ef) before this suite was written; items 9 to 11 (AC9 to AC11) were added to
the issue later and aren't implemented at this suite's base. Each test's name carries its criterion's ID (`#1359.` and
the first 8 hex digits of SHA-256 of the criterion's text, white space collapsed, as `scripts/proof-change.mjs` reads
it):

| AC | ID | File |
|---|---|---|
| AC1 | `#1359.2b00ab6a` | `doctor-fix.test.ts` |
| AC2 | `#1359.bb7ffee5` | `lasting-node.test.ts` |
| AC3 | `#1359.087f7acb` | `setup-lines.test.ts` |
| AC4 | `#1359.16cd308c` | `help-words.test.ts` |
| AC5 | `#1359.79fe1f46` | `status-empty.test.ts` |
| AC6 | `#1359.5f083178` | `old-node.test.ts` |
| AC7 | `#1359.af4449b9` | `no-cargo.test.ts` |
| AC8 | `#1359.25f84fb7` | `readme.test.ts` |
| AC9 | `#1359.f0bb482f` | `help-acts-nothing.test.ts` |
| AC10 | `#1359.2d0aa21a` | `help-table.test.ts` |
| AC11 | `#1359.d65a1a38` | `unknown-command.test.ts` |

## What was read

- Issue #1359 as of 2026-11-08: the eleven items, the criteria, Proof, and the owner's comment reproducing items 9 and
  10 on main c12a65bb.
- `docs/technical-design.md`: Dogfooding, and "Who drafts it". `AGENTS.md` (Proof).
- At the base `dd83ac2fc7c6563b2d395d154bc877032ba16ec1` (main, 2026-11-08), for surfaces and conventions only:
  `packages/cli/src/main.ts` (the usage text, the `yours` list that sets a home up first, the unknown-command line,
  the engines check), `packages/hub/src/{backup,setup,doctor,paths,status,plant,service}.ts`,
  `claude-settings.ts` (the timing relations) and `codex-settings.ts` (Codex's home and MCP table),
  `crates/deep-canvas/src/document/close.rs` (the close names' distance and reach), README.md, the tests
  `packages/cli/test/cli.test.ts` and `packages/hub/test/onboarding.test.ts`, and the suites `tests/acceptance/1325`,
  `1002` (its login-service stand-in, copied here as `fixtures/launcher.mjs`) and `572` (its process helpers).

## Run them

macOS (the login service read is launchd's plist; a systemd unit is read too, untried), with the repo's Node
(`.node-version`, 24.22.0):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                    # once
npm run build --workspaces                # every test runs packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # setup's entries name it
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1359 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1359/tsconfig.json
```

| Variable | What |
|---|---|
| `DEEP1359_OLD_NODE` | a Node older than the CLI's engines field, for AC6; without it the test looks in `/opt/homebrew/bin`, `/usr/local/bin`, `/opt/homebrew/opt/node*`, fnm's and nvm's versions, and reads BLOCKED when none is older |
| `DEEP1359_CHECKOUT` | another built checkout to run instead of this one (its CLI, its README, its deep-hook); BASE-FAILURE.txt ran 3d30b4ef this way |

Each test runs in a world of its own under `/tmp/dh1359-*`, removed at the end: `<tmp>/h` is HOME, `<tmp>/w` the
working folder, `<tmp>/bin` first on PATH. Nothing reaches the real home, the real launchd or any agent's real
settings:

- `DEEP_HUB_LAUNCHER` is always set: `launcher` (fixtures/launcher.mjs, #1002's) starts the program the hub's service
  definition names and logs its PID, where a test needs a hub; `refusing-launcher` loads nothing and exits 1
  everywhere else. `launchctl` and `systemctl` on PATH load nothing and exit 1. Each logs its call to
  `<tmp>/bin/calls.log`.
- `DEEP_HUB_TEST_CONFIRM` names a stub answering `cancelled`, so setup sets up no Secure Enclave key and nothing a
  command asks you to confirm goes through. `SHELL` is a login shell whose PATH is `<tmp>/bin`, Node's and the
  system's. No `DEEP_*`, `CLAUDE*`, `CODEX*`, `MCP_*`, `XDG_*`, `GIT_*` or billing variable reaches a child.
- There is no `cargo` on PATH. Every process is stopped by its PID (a run's own process group at its timeout); no
  model is called and nothing leaves the machine.

## How each criterion is read

- **AC1** (`doctor-fix.test.ts`): `deep doctor --json` in an empty home: the `hub.socket` item fails and its `fix`
  contains `deep setup` and not `deep hub start`. Then a home set up by `deep setup` (its hub started by the launcher),
  the hub stopped by PID: the item fails and its `fix` contains `deep hub start`.
- **AC2** (`lasting-node.test.ts`): this Node cloned (APFS clone) to `<prefix>/Cellar/node/24.22.0/bin/node`, with
  `<prefix>/opt/node` linking `../Cellar/node/24.22.0`, runs `deep setup` in a home with a `~/.codex` folder. The login
  service's first program argument, `~/.claude.json`'s DeepBuild MCP entry (the one whose args hold `mcp` and whose
  command is a `node`) and Codex's `config.toml` DeepBuild entry (`command = "…/node"`) must each be
  `<prefix>/opt/node/bin/node`. "Elsewhere": setup under this Node (fnm's, outside any Cellar) names this Node's path,
  and under the Cellar Node whose `opt/node` links another version (a different program, `25.0.0`) names the Cellar
  path, in all three.
- **AC3** (`setup-lines.test.ts`): `deep setup` in an empty home prints exactly one non-empty stdout line, the
  `Wiki: <page>` lines aside (Values, 5). With your
  own `~/.claude/settings.json` holding `env.MCP_TOOL_TIMEOUT` `5000` (shorter than deep_ask's wait, so that relation
  doesn't hold), it prints exactly two: the summary and one line naming `deep_ask`.
- **AC4** (`help-words.test.ts`): `deep help` and `deep -h` print exactly `deep --help`'s stdout and exit 0.
- **AC5** (`status-empty.test.ts`): `deep status` in a home set up with its hub running and no session prints a line
  with "start", "Claude Code", "Codex", "session" and "repo".
- **AC6** (`old-node.test.ts`): under the older Node, `deep` with nothing, `--help`, `--version`, `help`, and every
  command `deep --help` lists (read under this Node), each with no further arguments, in one empty home: each must exit
  2 with stderr naming the engines field's version and the older Node's version, write nothing in the home or the
  working folder, and nothing calls the login service or a service manager.
- **AC7** (`no-cargo.test.ts`): a copy of the checkout with no `target/` (so no deep-hook is built; `docs/`, `tests/`
  and `.git` left out too; `node_modules` a folder of links, the workspace packages linked to the copy's own) runs
  `deep setup` with no `cargo` on PATH. It must not exit 0, and both its stderr and the stop record
  `~/.deepbuild/setup-stopped.json` (#1002's) must name `rustup` and `cargo build --locked -p deep-hook` and hold no
  `ENOENT`. "No cargo" is read as none on PATH.
- **AC8** (`readme.test.ts`): README.md no longer says "installs no hooks and starts no service"; one paragraph says
  that `deep setup` and `deep status` set DeepBuild up (`set(s) … up`); one says to start a Claude Code or Codex
  session; one says to run `npm run build` again after a pull; and it names `deep setup --undo`.
- **AC9** (`help-acts-nothing.test.ts`): each run in a fresh empty home, which is snapshotted before and after (every
  path under it with its type, permission bits and SHA-256 of its bytes, or a link's target; and the working folder the
  same way). `deep status --help` and `deep inbox -h` must leave both byte-identical, call no login service or service
  manager, exit 0 and print to stdout a usage naming `deep` and the command. A change fails naming the first file
  written (by its birth time) and every path changed. "Anywhere in a command's arguments" is read through the commands
  item 10 names, the three words in first, middle and last place: `status help`, `inbox -h answer`, `inbox answer a1
  help`, `off --help`, `on -h`, `env up --help`, `install help`, `guard add -h`, `memory --help --json`, `memory keep
  help`; and through a table of every command `deep --help` lists (below) with `--help` after its words, each in a
  fresh home, each held to the same.
- **AC10** (`help-table.test.ts`): one home set up by `deep setup`, its hub started by the launcher. First, with that
  hub running, `deep backup --help` and `deep backup -h` must leave the working folder byte-identical (no `./--help`)
  and open no socket (the socket spy, below). Then the hub is stopped by PID and the table runs: for each command `deep
  --help` lists, `deep <words> --help` with the socket spy in every Node process it starts and a fixture hub at the
  hub's socket (a socket that counts each connection and closes it at once, made fresh for each command); it fails
  naming each command that wrote in the home or the working folder, opened a socket, reached the fixture hub, or still
  ran after 20 s. Then the same table with `DEEP_HUB_PLANT=dispatches-before-help` must name `deep backup --help`.
- **AC11** (`unknown-command.test.ts`): `deep stauts` (one swap from `status`) exits 2 and prints exactly one
  non-empty stderr line, which matches `deep status`. `deep xyzzy` (no command within one edit, its reach) exits 2,
  its stderr holds `deep --help`, and neither its stderr nor its stdout holds `deep <command>` for any command `deep
  --help` lists.

### The commands `deep --help` lists

`helpers.ts: listedCommands` reads each line `deep <synopsis>  <what it does>` (the synopsis ends at the first run of
two spaces), splits the synopsis into alternatives at each `|` outside `[]` and `<>`, and takes a command's words as
the alternative's leading plain lowercase words. A later alternative replaces the last word of a two-word command
(`hub run | start | status`), or the only word of one with nothing after it (`off | on`), and follows a one-word command
that takes arguments (`numbers [--json] | refresh`); one that starts with a flag or a placeholder names no new
command. At the base it lists 55: `doctor`, `status`, `off`, `on`, `explain`, `run`, `hub run|start|status|stop|use`,
`fix`, `workspace new|move|revert|diff|drift`, `setup`, `mcp`, `env up|down`, `lease`, `numbers`, `numbers
refresh|baseline|sample`, `show`, `export`, `kinds`, `inbox`, `inbox answer|undo|save`, `race`, `start approve`,
`start`, `gate rules`, `install`, `guard add`, `memory`, `memory keep|remove|overrule`, `rules sync|reach|credit`,
`session rules`, `undo`, `mcp-exec`, `backup`, `restore`, `update`, `debug bundle`, `read`, `find`.

### The socket spy

`fixtures/spy.mjs`, loaded with `NODE_OPTIONS=--import=<spy>` into the CLI and every Node process it starts, changes
nothing and notes in a file outside the home and the working folder each `net.Socket#connect` (which `net.connect`,
`tls.connect`, http, https and fetch go through), each `net.Server#listen`, and each datagram bind or send. A command
that opens a socket through a program that isn't Node isn't seen by it; one that reaches the hub is seen by the fixture
hub as well.

## The plant

| Plant | The wrong program | Read by |
|---|---|---|
| `dispatches-before-help` | `deep backup` dispatches before it checks for help, as the merge base does | AC10: the table fails, naming `deep backup --help` |

What the implementation must add: with `DEEP_HUB_PLANT=dispatches-before-help` in the CLI's environment (read through
`activePlant()`, as the CLI reads `bundle-raw-logs`), `deep backup <args>` hands its arguments to `backupCommand` before
any help check, so `deep backup --help` asks the running hub for `record.backup` into `./--help` (with the fixture hub,
it connects to the hub's socket). Every other command is unchanged by it. List it in `packages/hub/src/plant.ts` beside
the others. At the base, `deep backup --help` already does this, so the plant's test passes there; once the fix lands
it passes only if the plant is in.

## Values the issue leaves open, and what these tests chose

1. **"Prints that command's usage"** (AC9): stdout names `deep` and each of the command's words; the wording and the
   rest of the text are the implementation's.
2. **"Anywhere"** (AC9) is read through the cases above; a help word inside a value a command passes on (`deep lease --
   <command>`, `--prompt <words>`) isn't tried.
3. **"Writes a file"** (AC10) is any path added, changed or removed under the home or the working folder; **"opens a
   socket"** is any the spy notes, or a connection to the fixture hub.
4. **"Sets nothing up"** (AC6) is read as the home and the working folder byte-identical, and no call to the login
   service or a service manager.
5. **The summary line** (AC3) is stdout's only non-empty line but for the wiki's page lines (`Wiki: <page>`, one per
   page the hub's wiki build changed, #356), which setup prints even in an empty home (`rules.md`, `setup.md`,
   `you.md` at the base) and which say what the hub wrote, not a timing relation.
6. **"Names no command"** (AC11) is no `deep <command>` for a listed command, in stderr or stdout.
7. **"Once set up"** (AC1) is a home `deep setup` finished in, with its hub stopped.
8. **"Elsewhere"** (AC2) is a Node outside a Cellar, and a Cellar Node whose `opt` link names another version.
9. **The fixture hub** (AC10) for `deep backup --help` is a real hub in the throwaway home, so the base's copy into
   `./--help` shows; for the table it is the socket stand-in above, so a command that reaches it doesn't change the
   home through the hub.

## Known limits

- AC6 runs with a Node 20.11.0 on this machine (BASE-FAILURE.txt); no Node 22 or 23, where `node:sqlite` loads as
  experimental, was found, and none was downloaded.
- AC2 reads a launchd plist; on Linux the unit's `ExecStart` is read instead, never run here.
- The spy sees only Node processes; a socket opened by `deep-hook` or another program isn't seen unless it reaches the
  fixture hub.
- AC7's copy leaves out `docs/` and `tests/`; a fix that reads them at setup would fail there for that reason.
