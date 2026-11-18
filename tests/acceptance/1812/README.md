# Acceptance tests for #1812: one sentence, one next step, one exit table

Written blind, by a job that read only the issue, the design and the base commit; it never saw the implementing work.
The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

Base: `16dc5eab0e5c2687b4ae7a973b350c32bbfb9342` (main, 2026-11-17). The issue has eight checkbox criteria, AC1 to AC8 in
the body's order. Each test's name carries its criterion's ID (`#1812.` and the first 8 hex digits of SHA-256 of the
criterion's text, white space collapsed, as `scripts/proof-change.mjs` reads it; checked against the issue's body):

| AC | ID | File | Tests |
|---|---|---|---|
| AC1 | `#1812.e264e123` | `hub-down.test.ts` | the table in a home whose hub is stopped |
| AC2 | `#1812.5a83f2e0` | `not-set-up.test.ts` | the table in homes nobody set up |
| AC3 | `#1812.5d580fb2` | `usage.test.ts` | `deep update`, `deep debug`, `deep off now` |
| AC4 | `#1812.f6999471` | `find-help.test.ts` | `deep find help` searches; the planted parser fails |
| AC5 | `#1812.58b07a01` | `exit-table.test.ts` | the lint's table over this checkout; the planted exit of 4 |
| AC6 | `#1812.b70b92a8` | `undecided.test.ts` | `deep update --check` unreachable; a cancelled confirmation |
| AC7 | `#1812.eabaa642` | `fix.test.ts` | the sentence; `--json` byte for byte |
| AC8 | `#1812.a9d7101d` | `hub-start.test.ts` | `deep hub start` on a stopped hub |

## What was read

- Issue #1812 as handed to this job: its body (Scope, the eight criteria, Proof, Depends on) and the owner's two
  comments of Nov 10. The IDs were checked against the issue's live body; nothing else of the issue or of any branch
  or pull request was read.
- `docs/technical-design.md`: One hub per user, a tiny hook client, and extensions in-process; States people see;
  Dogfooding. `AGENTS.md` (Proof). `reports/uiux-agentic-audit-2026-11-10.md`, which the owner's second comment cites.
- At the base, for surfaces and conventions only: `packages/cli/src/main.ts`; in `packages/hub/src/`: `client`,
  `inbox`, `list`, `fix-command`, `start-command`, `starts`, `trusted-actions`, `human-answers`, `confirm`, `service`,
  `hub-command`, `setup`, `setup-steps`, `hosts`, `remote`, `gate-command`, `install`, `mcp-exec`, `heavy`,
  `workspace-actions`, `ask-tasks`; `packages/reading/src/{index,slices}.ts`; `packages/record/src/learned.ts`;
  `packages/conformance/src/families.ts`; `packages/contracts/schemas/exit.code@1.json`; `contracts/setup-steps.json`;
  `adapters/install.json`; `scripts/lanes.mjs`, `scripts/loads-lint.mjs`, `scripts/plant-lint.mjs`,
  `scripts/proof-change.mjs`. Suites, for their conventions: `1359` (its world, stand-ins and `listedCommands`, adapted
  in `helpers.ts`), `1002`, `1463`, `66` (the test work source and `deep hub run`), `1330` (`deep start approve` and its
  approval), `1830` (a lint pinned with `--root`), `19/doctor` (`exit.code@1`).

## Run them

macOS, with the repo's Node (`.node-version`, 24.22.0):

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                    # once
npm run build --workspaces                # every test runs packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # setup's entries and the hub need it
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1812 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1812/tsconfig.json
```

About 30 s on this Mac at a one-minute load of 50 to 60. The files start hubs, so the folder is on `scripts/lanes.mjs`'s
`alone` list. A missing build, deep-hook, or a setup or hub that doesn't start reads BLOCKED, never a pass.

## The world

Every test runs in throwaway worlds under `/tmp/dh1812-*`, removed at the end: `<tmp>/h` is HOME, `<tmp>/w` the working
folder, `<tmp>/bin` first on PATH. It is #1359's world with three more stand-ins:

- `DEEP_HUB_LAUNCHER` is always set: `launcher` (#1002's `fixtures/launcher.mjs`) where `deep setup` or `deep hub start`
  must start a hub, `refusing-launcher` (loads nothing, exits 1) everywhere else. `launchctl` and `systemctl` on PATH load
  nothing and exit 1.
- `curl` and `wget` on PATH refuse and exit 1. `DEEP_HUB_TEST_INSTALLER` (#1349's seam) names `<tmp>/bin/installer.sh`,
  which installs nothing and exits 1. Before `deep setup`, a stand-in `claude` sits at `~/.local/bin/claude`, where
  Claude Code's own installer puts it, off every PATH here: setup then finds an agent and plans no install. A setup that
  called the installer, `curl`, `wget` or that `claude` is BLOCKED. Each stand-in logs its call to `<tmp>/bin/calls.log`.
- `DEEP_HUB_TEST_CONFIRM` names a stub answering `cancelled` (#24): nothing a command asks you to confirm goes through.
- No `cargo`, `claude` or `codex` is on PATH; no `DEEP_*`, `CLAUDE*`, `CODEX*`, `MCP_*`, `XDG_*`, `GIT_*`, `NODE_OPTIONS` or
  billing variable reaches a child. Every process is stopped by its PID. No model is called and nothing leaves
  127.0.0.1.

## Surfaces pinned here

What the implementation must provide, where the issue names a behaviour and no surface:

1. **The one sentence** (AC1, AC2): one line of the command's output (stdout or stderr) that names the hub and says it
   `isn't answering` or `is not answering` (an apostrophe `’` reads the same), and on that same line the one fix:
   `deep hub start` in a home that is set up, `deep setup` in a home that isn't. That line names neither the other fix
   nor `BLOCKED`. The command exits 3. Nothing it prints, on either stream, holds an errno name (any of Node's
   `os.constants.errno`, such as `ENOENT`) or the same absolute path twice. In a home that isn't set up, nothing it
   prints names `deep hub start`. "Since when" is the implementation's: it isn't read.
2. **Usage** (AC3): exit 2 and a line that starts `Usage:` and names `deep update`, `deep debug` or `deep off`; no
   `Unsupported command` anywhere.
3. **`deep find help`** (AC4): exit 0, stdout holds the hit `wiki:dh1812#dh1812-help`, and no line starts `Usage:`. The
   home holds a record (a `deep hub run` ran there and was stopped by PID) and `~/.deepbuild/wiki/dh1812.md` with one
   claim line, `- Ask for help before you change the schema <!-- deep:claim {"id":"dh1812-help"} -->`, which the base's
   `deep find schema` and `deep find -- help` both find.
4. **The exit lint** (AC5): `node scripts/exit-lint.mjs [--root <checkout>]`, run by the lint lane (`checks` in
   `scripts/lanes.mjs`, name `lint`, a command whose part ends in `scripts/exit-lint.mjs`). It reads the TypeScript
   sources of the `deep` commands under `<root>` (default: the checkout holding the script) and prints the table, one
   line per exit a command can reach: `exit <n> <path>:<line>`, `<path>` relative to the root with `/`, `<line>` from 1
   (more may follow on the line). Each exit outside 0 to 3 is a line that starts `FAIL` and names its `<path>:<line>`,
   and the lint exits 1; with none it exits 0. `deep lease` and `deep mcp-exec`, which exit with their child's own
   status, are left out by name. The test reads both streams.
5. **`deep update --check`** (AC6) reads its registry from `DEEP_UPDATE_URL`, as at the base; the test names
   `http://127.0.0.1:<port>/deepbuild/latest` on a port nothing listens on.
6. **The cancelled confirmation** (AC6): a hub from `deep hub run` with the stub answering `cancelled`; `deep start
   approve --repo <checkout> --issues 1 --agents claude-code --at-once 1 --plan-share 10 --json` raises the approval
   (`ask:<id>` on stdout, as #1330 pinned); then `deep inbox answer <ask> allow`, `deep race 1` and `deep start --repo
   <checkout> --issue 1 --agent claude-code --prompt go` each exit 3. `deep inbox --json` must still list the ask after the
   cancelled answer, else BLOCKED.
7. **`deep fix`** (AC7): a hub from `deep hub run` with `DEEP_HUB_TEST_WORK` (#66's test work source) naming
   `fixtures/work.json`: two issues, `ACME-42` and `ACME-43`. `deep fix ACME-42` exits 0 and its stdout is one non-empty
   line, not JSON (it doesn't start with `{` or `[`), naming `ACME-42`, `task:ACME42` or the title `Totals round to
   cents`. `deep fix ACME-43 --json` (the flag after the ID) exits 0 and its stdout is exactly
   `{"task":"task:ACME43","link":"https://tracker.example/acme/issues/43"}` and a newline: what the base's `deep fix
   ACME-43` printed against this fixture.
8. **`deep hub start`** (AC8), with the launcher stand-in: exit 0; a hub answers on `~/.deepbuild/hub.sock` (it sends its
   first line); stdout and stderr together hold exactly one non-empty line, which names the hub, says `up`, `running`,
   `started`, `answers` or `answering`, and holds no `not`, `isn't`, `wasn't`, `didn't`, `can't`, `couldn't` or `won't`.

## How each criterion is read

- **AC1** (`hub-down.test.ts`): one home set up by `deep setup` (its hub started by the launcher), the hub stopped by PID
  and its socket checked silent; then each row of the table below, in that home, with the refusing login service. The
  test fails naming every command that misses the one sentence (Surfaces 1) with `deep hub start`.
- **AC2** (`not-set-up.test.ts`): the same rows, but for the commands whose first word is in the first-run list, each in
  a fresh empty home, held to the one sentence with `deep setup`.
- **AC3** (`usage.test.ts`): the three in one home holding #1002's `setup-finished.json`, as setup writes it, so the
  first-run `deep off now` reads its arguments instead of setting the home up (#2200's ground, not this issue's).
- **AC4** (`find-help.test.ts`): `deep find help` held to Surfaces 3; then the planted parser's `deep find help` must
  print find's usage (else BLOCKED: it isn't the wrong program) and fail the same check.
- **AC5** (`exit-table.test.ts`): over this checkout the lint must exit 0 with no FAIL line, print the table, hold only
  0 to 3, hold each of 0, 1, 2 and 3, read `packages/cli/src/main.ts` and something under `packages/hub/src/`, and run in
  the lint lane. Then the planted exit of 4 (below) must fail it, exit 1, on a FAIL line naming its file and line.
- **AC6** (`undecided.test.ts`): Surfaces 5 and 6. The test fails naming each command that doesn't exit 3.
- **AC7** (`fix.test.ts`): Surfaces 7, the two forms on two issues, so each is the first fix of its issue as the base's
  was.
- **AC8** (`hub-start.test.ts`): a home set up by `deep setup`, its hub stopped by PID and silent; then Surfaces 8.

## The table (AC1, AC2)

`helpers.ts: listedCommands` reads every command `deep --help` lists (#1359's reading; a line whose leading words run past
two is prose, not a usage line). At the base it lists 75. Each is either a row of the table, with arguments that reach its
hub call (every row was run at the base with the hub stopped and reached the hub's socket), or left out by name. A listed
command that is neither is BLOCKED: the table couldn't say it ran every command.

**Rows (56)**: `status`, `off`, `on`, `run follow run:<id>`, `host run ask:<id>`, `host changes h1`, `host remove h1`,
`host list`, `host facts h1`, `hub status`, `hub stop`, `hub use --root <folder>`, `fix ACME-1`, `land --repo <checkout>`,
`work --repo <checkout> --issues 1 --once`, `workspace new topic`, `workspace task ws1 title --criterion text`,
`workspace move ws1 <folder>`, `workspace revert ws1`, `workspace diff ws1`, `workspace drift ws1`, `env up`, `env down`,
`numbers`, `numbers refresh`, `numbers baseline <file>`, `numbers sample 2026-11-01`, `show --doc doc1 --document <file>`,
`inbox`, `inbox answer ask:<id> allow`, `inbox undo ask:<id>`, `inbox save offer:<id>`, `race 1`, `start approve ...`,
`start ...` (Surfaces 6's forms), `install <folder with a readable deepbuild.json>`, `guard add <file>`, `memory`,
`memory keep lesson:<id>`, `memory remove lesson:<id>`, `memory overrule decision:<id>`, `rules sync`, `rules reach --repo
<checkout> --scope **`, `rules credit rule:<id>`, `session rules session:<id>`, `undo staged:<id>`, `mcp-exec server1`,
`secret list`, `person invite login1 --address 127.0.0.1:9`, `person revoke login1`, `library on|off <library>`,
`library rule <library> MIT`, `pack rule acme/pack MIT`, `job rule tool@1.0.0 5`, `backup <folder>`. `<id>` is one ULID.

**Left out by name (19)**, each needing no hub: `setup`, `hub start`, `kinds`, `export`, `explain`, `lease` (the owner's
comment); `hub run` (it is the hub); `doctor` (it reports the hub as one of its items; its exit is #19's and #1713's);
`debug bundle` (logs and the doctor's items); `update` (the registry; AC6); `run` (`deep run --result <file>`); `mcp` (the
MCP server on stdio, which answers each call that the hub is unreachable); `read` and `find` (read-only over the hub's
root with or without the hub, #63); `open` (the app's own socket, #1460); `gate rules` (prints rulesets from your
settings); `join` (a project's hub on another machine); `restore` (with the hub stopped); `secret add` (it reads the
value at your terminal before it calls the hub, and a run with no terminal stops there).

**The first-run list** (AC2 leaves these out, the owner's comment): `status`, `inbox`, `secret`, `off`, `on`, `env`,
`install`, `guard`, `memory`. AC2's table is the other 40 rows.

## The plants

| Plant | The wrong program | Laid by | Read by |
|---|---|---|---|
| `fixtures/help-anywhere.mjs` | a parser that reads `help` anywhere before `--` as asking for help, as the base's does | the suite: a front end that hands each such `help` to the built CLI as `--help` (which asks for help in every command, kept by the scope) and imports the CLI with those arguments | AC4: the search check fails on it |
| a planted exit of 4 | a command that exits 4 | the suite: a scratch copy of this checkout (every top-level entry but `.git`, `node_modules`, `target`, `tests`, `docs`, `crates` and `vendor`, cloned; `node_modules` a folder of links, #1359's way) whose `packages/cli/src/main.ts` gains two lines at its end, a comment and `if (process.argv[2] === 'dh1812-exits-4') process.exit(4);` | AC5: `node <this checkout>/scripts/exit-lint.mjs --root <copy>` must exit 1 with a FAIL line naming `packages/cli/src/main.ts:<that line>` |

The product provides no plant for this suite: no `DEEP_HUB_PLANT` or `DEEP_CLI_PLANT` value is read.

## Choices where the issue leaves one open

1. **"The commands that call the hub"** (the owner's narrowing of AC1) is the table above: the rows reach the hub's
   socket at the base; the 19 left out don't, or are the owner's six. `deep hub stop` and `deep hub use` ask the hub to
   confirm you, so they call it, and the one sentence holds for them too.
2. **"A home with no hub"** is a home `deep setup` set up, its hub stopped by PID: the audit's "a home that was set up,
   hub not running". **"A home that isn't set up"** is an empty one.
3. **"On the merge base `deep inbox` prints a raw socket error"**: at this base `deep inbox`, with a database to read
   since #2026, prints `The hub isn't answering, since <HH:MM>; this is the list its database holds.` and no fix; the
   raw socket error (the path twice and `ENOENT`) is what `deep inbox answer`, `undo` and `save` print. The test fails
   naming `deep inbox` for its missing fix, and the others for theirs.
4. **"The one sentence"** is read through the scope's first item: the fix on the sentence's own line, not BLOCKED, one
   fix only. Other lines may be printed (`deep status` and `deep inbox` print the list their database holds).
5. **"A cancelled confirmation exits 3 from `deep start`"**: at the base `deep start` asks the OS nothing itself; its one
   confirmation is the run's approval, answered with `deep inbox answer <ask> allow` (#1330). With that confirmation
   cancelled, the approval stays open, and `deep start` under it finds no run you approved: the base exits 1 (`Refused
   (approval): ...`). Read here as not decided, so 3. A `deep start` with no approval asked at all isn't run.
6. **"The registry unreachable"** is a closed port on 127.0.0.1 named by `DEEP_UPDATE_URL`.
7. **"One sentence naming what started"** is one stdout line, not JSON, naming the issue, its task or its title.
   **"The object the merge base printed"** is the base's own output for the same fixture, recorded in BASE-FAILURE.txt.
8. **"One line that says the hub is up"** counts stdout and stderr together.
9. **"A table of every exit a command can reach"** is held by its parts: the lint passes over this checkout, its table
   holds 0, 1, 2 and 3 and nothing else, it reads the CLI's entry and the hub's commands, and the plant fails it. Exits a
   command takes from a variable (a child's status, as in `deep host run`) are the lint's to judge; none is read here.
10. **`help` "only as the first argument after the command"**: only `deep find help` is held (AC4); the scope's wider
    rule isn't, so `deep <command> help` elsewhere is the implementation's.

## Checked against a sample and mutants

Outside this checkout (a clone in a scratch folder, never committed) the built JS was patched to one sample of each
behaviour: a pre-check before each table command that prints `The hub isn't answering; start it with deep hub start.`
(or `set DeepBuild up with deep setup.` with no `setup-finished.json`) and exits 3, the list's sentence with its fix,
usage for a listed command's bad arguments, `help` only as `deep help`, `update --check` 3, `race` 3 on `unconfirmed`,
`start` 3 on the `approval` bound, `deep fix` a sentence and `--json`, `deep hub start` printing `The hub is up.`, and a
sample `scripts/exit-lint.mjs` on the TypeScript parser (130 exits at the base, all 0 to 3, `heavy.ts` and
`mcp-exec.ts` left out) in the lint lane. All 12 tests passed. Each mutant failed the test named:

| Mutant | Failed |
|---|---|
| the sentence always names `deep hub start` | AC2 |
| the sentence led by `BLOCKED: ` | AC1 |
| "Unsupported command" kept for listed commands | AC3 |
| `help` anywhere asks for help | AC4's search test |
| `update --check` unreachable exits 1 | AC6's first test |
| `race` exits 1 on a cancelled confirmation | AC6's second test, naming `deep race` |
| `deep fix --json` adds a key | AC7's `--json` test |
| `deep hub start` silent when it starts the hub | AC8 |
| a lint that reads only `return` (not `process.exit` or `process.exitCode`) | both AC5 tests: no row for the CLI's entry, and the plant not named |
| the lint left out of the lint lane | AC5's first test |

## Not covered

- The exit table at the foot of `deep --help` (four lines, and the owner's line for a command that runs another
  program), `deep hub status`'s usage line saying it is a developer's command, every usage line starting `Usage:`
  (`deep secret` included), `deep doctor` printing each state once in words, JSON only with `--json` for `deep
  workspace`, `deep rules` and `deep numbers refresh`, a setup whose wiki wasn't read exiting 3, and the silent `deep
  secret list` and `deep find` with no hit from the owner's comment: scope items no criterion names, so no test here.
- `deep doctor`'s exit with only "not checked" items (#1713's open question).
- `secret add` against a hub that isn't answering: it needs a terminal.
- Linux: the login service stand-ins and the plist are macOS's; a systemd unit is never written here.

## Found on the way

- Since #1349, `deep setup` in a home with no agent found fetches Claude Code's installer over HTTPS and runs it unless
  `DEEP_HUB_TEST_INSTALLER` names a local one. #1359's world sets neither that nor an agent, so a `deep setup` in it
  downloads Claude Code into the throwaway home: this job's first survey, on #1359's world, ran the fetched installer,
  which was downloading Claude Code when it was stopped by PID; the download never ran. This suite's world closes that
  off; #1359's suite, and any that copied its world, are a follow-up (not checked here).
