# Acceptance tests for #19: `deep doctor`, its items and the exit-code table

Written first, blind, from issue #19 (its body as of October 27, 2026), the design sections it links and those
around them (How it installs; One hub per user; Hooks are evidence, not a state machine, with Health reads the
agent's side, DeepBuild's own jobs and What a session loads; Sessions that know about each other; Plan usage, with
Billing mode and Accounts; Numbers version 0 has to hold, with its timing relations table; Socket roles and contract
versions, with the code families and the one exit-code table; Threats) and base commit `0350cf0`, by a job that
never saw an implementation of #19. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job.

The issue has 25 checkbox criteria, AC1 to AC25 in the body's order, with IDs as `scripts/proof-change.mjs` computes
them. **This folder covers AC3, AC4, AC9, AC10, AC11, AC12, AC15, AC16 and AC18.** Three other blind jobs cover the
rest in `../authority/`, `../setup/` and `../status/`.

## How to run

With Node 24.22 first on `PATH` and the workspaces built:

```sh
npm run build --workspaces                       # the tests run packages/cli/dist/main.js
cargo build --locked -q -p deep-hook             # setup's entries run it; a test builds it too when it is missing
npx vitest run --root tests/acceptance/19/doctor --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/19/doctor/tsconfig.json
```

- `--no-file-parallelism`: each file starts hubs, sessions and DeepBuild jobs. The suite takes a few minutes.
- Every test makes its folders under `/tmp/dh19d-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude`, `~/.codex`, the Keychain or
  `~/Library/LaunchAgents`. It stops only processes it started, by PID. No child inherits a billing key or a
  `CLAUDE*`, `CODEX*`, `OTEL_*` or `DEEP_*` variable of the runner's; `PATH` is `<tmp>/bin`, Node's folder and the
  system folders only, so no real `claude` or `codex` is ever found. No network, no model call, no GitHub.
- With `--root` here, Vitest writes its cache to `tests/acceptance/19/doctor/node_modules/.vite/`; delete it before
  committing.
- `scripts/lanes.mjs` should run this folder in `alone` (one file at a time, after the parallel block), as it does
  `tests/acceptance/18/install/`: the files start hubs and build deep-hook. This job edits nothing outside its folder.

## The surface under test

### Merged surfaces, used as their suites define them

- **The CLI** `packages/cli/dist/main.js`, run as a child process; **`deep setup`** (#18: writes DeepBuild's hook
  entries into `~/.claude/settings.json`, beside yours, run with a hub answering); **`deep doctor --json`**, one
  `doctor.item@1` object per line with its `item` and `agent` (#18, #42); the doctor family's codes and levels as
  `doctor.item@1` lists them (`hooks_missing`, `version_uncovered`, `timing_relation_broken`, `not_checked`, …;
  levels `ok`, `warn`, `fail`, `skip`); `exit.code@1`, the one exit-code table (#313), read through
  `@deepbuild/contracts`' `listSchemas`.
- **The stop-hold relation** (#18 AC14): DeepBuild's one foreground Stop entry, its `timeout`, the 60 s hold that
  must end at least 5 s before it; a broken relation is `timing_relation_broken`, a failed item, and the hub shows a
  reading at its start (its `hub.health` answer or a non-hook event in its log) naming the relation and both values.
- **Claude Code's telemetry item** `otlp.telemetry` (#42): healthy with the receiver's protocol and address in the
  user settings' `env` block; `not_checked` (level `skip`) with telemetry off, since there is nothing to read.
- **The hub** `deep hub run` with `HOME` the temp home, its socket's line protocol, a `cli` connection with the
  control token, `events.read`, `hub.health` (#16); `DEEP_HUB_PLANT=<name>` selects a planted program and a name the
  hub doesn't know makes it exit at start (#16); `DEEP_HUB_TEST_CONFIRM` (#24, always `cancelled` here) and
  `DEEP_HUB_LAUNCHER`, the login-service launcher a test stands in for (#16), always a stub that logs and exits 0.
- **The runner** (#159) inside the hub: `job.submit` with a `deadline_ms`, `job.status`, `windows.report`; it
  resolves the jobs' `claude` on the login shell's PATH that setup recorded, `runner.login_path` in
  `~/.deepbuild/config.json`; it hands a job your sign-in's access token from the Keychain item
  `Claude Code-credentials` (`claudeAiOauth.accessToken`, `expiresAt` in ms), never the refresh token; the account
  is `oauthAccount.accountUuid` in `~/.claude.json`.
- **deep-hook** as a settings entry runs it (#315), and **`deep mcp`** started by the session's process (#26).

### Stand-ins (boundaries these tests don't own)

- **`claude`** (`fixtures/claude.sh`): `--version` prints `<version> (Claude Code)` (a version the facts cover, unless
  a test changes `claude.version` beside it); `auth status` prints Claude Code's JSON, signed in (`loggedIn: true`,
  `authMethod: claude.ai`, `apiProvider: firstParty`, `subscriptionType: max`); `mcp add|add-json|remove|get|list`
  keep Claude Code's MCP registry where Claude Code keeps it (`~/.claude.json`'s `mcpServers` for user scope,
  `projects[<cwd>].mcpServers` for local, `.mcp.json` for project; `fixtures/claude-mcp.mjs`), every server
  connected; `-p`/`--print` reads the prompt on stdin and answers one successful turn in the output format asked
  (`stream-json`: system init, one assistant message, a `result` with `subtype: success`, `is_error: false`;
  `json`: that result; text: `OK`). Anything else exits 0.
- **`codex`** (`fixtures/codex.sh`): `--version` prints `codex-cli <a covered version>`; `login status` exits 0
  (signed in); `exec` reads the prompt and prints one successful `--json` turn; `mcp list` lists nothing.
- **`launchctl`, `systemctl` and the launcher**: log and exit 0. **`deep`**: runs the built CLI.
- Each stand-in appends `<name> <args>` to `calls.log` beside it, so a test sees what `deep` called and when.
- **The session stand-in** (`fixtures/session.mjs`, #18's Claude Code stand-in, copied): one session's process; it
  runs every entry of your settings for a hook, as Claude Code does, and starts the session's own `deep mcp`.
- **Another hook-based tool** (`fixtures/herd-hook.sh`): logs its argument and exits 0, printing nothing.

### Defined here, where the issue and the design leave a surface open

1. **Every item ok** (`helpers.ts`, `world`). The world where nothing is wrong: you signed in to Claude Code and
   Codex at versions their facts cover; one `claude`, the same for your sessions and DeepBuild's jobs
   (`runner.login_path` is the PATH `deep` runs with); no billing key and no nesting variable; Claude Code's
   telemetry sent to the receiver (`CLAUDE_CODE_ENABLE_TELEMETRY=1`, `OTEL_LOGS_EXPORTER=otlp`,
   `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` in the user
   settings' `env`); a sign-in token that outlives any run (Keychain stand-in, `expiresAt` in 2099); no managed
   settings; DeepBuild set up by `deep setup` with a hub answering, then the hub started again and running; and one
   session started since in the working folder (a git repo of its own with no `.claude` folder), whose SessionStart
   reached the hub through DeepBuild's entry and whose `deep mcp` is connected. In that world `deep doctor --prompt`
   shows every item at level `ok` and exits 0. Every other world here is this one with one thing changed.
2. **`deep doctor --prompt`** sends each signed-in agent its test prompt (the issue: "A test prompt to an agent runs
   only with `deep doctor --prompt`"). **The test-prompt item**: Claude Code's has `agent: "claude-code"` and an
   `item` containing `prompt`. Without `--prompt` it is listed, `not_checked` at level `skip` (the design: "A test
   prompt spends plan usage, so it runs only when you ask … and an item that didn't run reads 'not checked', never
   OK"); with it, it reads what came back: `ok` for the stand-in's successful turn.
3. **"Not checked" in words**: `deep doctor` without `--json` says `not checked` for each item not checked.
4. **What counts as a test prompt** (AC10): a `claude` call with `-p`/`--print`, or whose first argument isn't one
   of `--version`, `-v`, `--help`, `-h`, `auth`, `mcp`, `plugin`, `config`, `doctor`; a `codex` call whose first
   argument isn't one of `--version`, `-V`, `--help`, `-h`, `login`, `mcp`, `features`.
5. **Which `claude` each runs** (AC11): your sessions run the first `claude` on the PATH `deep doctor` runs with (the
   shell you start sessions from); DeepBuild's jobs run the first `claude` on `runner.login_path`. When they differ
   the doctor flags it (level `warn` or `fail`) in one item whose text names both paths, each after the word that
   says what it is: the last mention of "session(s)" or "job(s)" before a path is what the text calls it.
6. **Billing keys** (AC11): `ANTHROPIC_API_KEY` set in the environment `deep doctor` runs in. The warning is an item
   at level `warn` whose text names `ANTHROPIC_API_KEY`, `API` and billing (`bill…`); no output of the doctor holds
   the key's value or its last 12 characters.
7. **A missing hook installation** (AC3): DeepBuild set up, then its PreToolUse entry and both its Stop entries
   removed from `~/.claude/settings.json` with the hub stopped (its watch would put them back, #18). The doctor runs
   with the hub stopped; its `hooks_missing` items are at level `fail`, name both hooks and the file (its full path
   or `~/.claude/settings.json`), and give as the fix the command `deep setup` (in backticks, or as the words
   `deep setup`, optionally with flags, never `--undo`). The test runs that command, with a hub answering, and the
   item is gone.
8. **The planned run and the token** (AC4): a run with a planned end is a DeepBuild job with its deadline
   (`job.submit`, `deadline_ms`), the one such run the base has. The runner hands a job the Keychain's access token
   and no refresh token, so a token that expires before the job's deadline would end the job in the middle. With the
   token expiring 20 minutes on and a one-hour deadline, the job never starts (no `pid`; state `refused`, or
   `waiting` with its `blocked`), and its record (the `job.status` answer, as JSON text) names the token and its
   expiry (`token`, `expir…`). The twin, a token good for 3 hours, starts the same job. `deep doctor` shows the token's
   lifetime: an item whose text names the token and its expiry.
9. **Hooks that won't run there** (AC12). The repo is `deep`'s working folder, a git repo where a session already
   started through DeepBuild's hooks (so a doctor that reads the cwd and one that reads the repos it has seen both
   find it), with `{"disableAllHooks": true}` in its `.claude/settings.json`; the doctor runs there. The policy is
   Claude Code's managed settings holding `{"allowManagedHooksOnly": true}`. Each is a failed item whose text names
   the setting (and, for the repo, the repo's path), and the doctor, otherwise all ok with `--prompt`, exits 1.
10. **The order hooks run in** (AC18): for each hook where another tool has an entry, the doctor's items that name
    the tool (by its command's path, which holds `herd-hook`) list that hook's entries in the order Claude Code reads
    and starts them, the order of `~/.claude/settings.json`. Read as: each stretch of the items' text from a hook's
    name to the next hook's name that names both `herd-hook` and DeepBuild's entry (`deep-hook`, `DeepBuild`,
    `deep waiter` or the CLI's path) says which comes first. Claude Code starts a hook's entries together; the doctor
    may say so, as long as it lists them in the file's order.
11. **AC16's worlds**: "one failed item" is the stop-hold relation at 60 s against 60 s, with `--prompt`; "only an
    item not checked" is telemetry off and no `--prompt` (the telemetry item, and the prompt item if listed, not
    checked; nothing failed); "both" is the two together; "an unknown flag" is `--dh19-no-such-flag`, with the hub
    stopped: exit 2, no item, no stand-in called, no file under the temp folder written. `deep status` runs in a fresh
    home with no hub and no `~/.deepbuild/ledger.db`.
12. **The contract test** (AC16): every command is each form `deep --help` lists (a line `deep <one or two words>`,
    alternatives `a | b | c` expanded, `[...]` dropped, `<...>` filled with values that name nothing), plus the
    commands the issue names: `status`, `doctor`, `setup`, `off`, `on`, `debug bundle`, `hub start`, `hub stop`,
    `hub use`, `hub status`, `inbox`. Each runs in a fresh home with the hub down and no database. With
    `--dh19-no-such-flag` after it, it must exit 2, call no stand-in and write nothing. In its listed form (all but
    `hub run`, a server), it must end within 60 s, by no signal, with a code `exit.code@1` lists, and with no uncaught
    JavaScript error on stderr. A command that breaks either is named in the failure.

### Seams the implementation must add

| Variable | Read by | What it does |
|---|---|---|
| `DEEP_HUB_TEST_KEYCHAIN=<file>` | the hub (runner) and `deep doctor` | The Keychain stood in for: a JSON object mapping a generic password's service name to its value. When set, every Keychain read comes from this file and never from `/usr/bin/security`, whatever `HOME` is; a service it doesn't list reads as absent. Here it holds `Claude Code-credentials`, the JSON Claude Code keeps there. |
| `DEEP_HUB_TEST_MANAGED_SETTINGS=<file>` | `deep doctor`, the hub | Claude Code's managed settings file read from this path instead of the machine's (`/Library/Application Support/ClaudeCode/managed-settings.json` on macOS); a missing file is no managed settings. Everything `deep` reads from managed settings (hooks policy, the telemetry `env`) reads it here. |

Both are set on every process these tests start, like `DEEP_HUB_TEST_CONFIRM`, and only tests set them.

### Planted wrong programs

Selected with `DEEP_HUB_PLANT=<name>`, set on every process the test starts (the hub, `deep setup`, `deep doctor`,
the session stand-in), so a plant may live in the CLI or the hub. The implementer adds each name to the hub's list
in `packages/hub/src/wire.ts`, so the hub starts with it, and makes the CLI commands read it too.

| Name | What the plant does | Criterion | How the test fails on it |
|---|---|---|---|
| `skipped-reads-ok` | shows the test-prompt item it didn't run (no `--prompt`) as `ok`/`healthy` | AC9 | `notchecked.test.ts`: "AC9 the item <prompt item> didn't run (no --prompt) and must read not checked …" |
| `prompt-without-flag` | sends Claude Code the test prompt on every `deep doctor`, `--prompt` or not | AC10 | `prompt.test.ts`: "AC10 deep doctor --json sent a test prompt without --prompt, spending plan usage: claude -p …" |
| `hooks-disable-user-only` | reads `disableAllHooks` only in `~/.claude/settings.json`, never a repo's settings or managed settings | AC12 | `disabled.test.ts`: "AC12 deep doctor must show that hooks won't run in <repo>, naming disableAllHooks …" and "… under Claude Code's policy, naming allowManagedHooksOnly …" |
| `stop-hold-no-margin` | reads the stop-hold relation as holding when the hold is at most the timeout (no 5 s margin), in the doctor and at hub start | AC15 | `stophold.test.ts`: at 64 s, "AC15 at 64 s against the 60 s hold, deep doctor must show the stop-hold relation broken …" |
| `stop-hold-entry-only` | reads the stop-hold relation as holding whenever DeepBuild's Stop entry exists, whatever its timeout | AC15 | `stophold.test.ts`: the same failure at 60 s and at 64 s |
| `not-checked-exits-0` | `deep doctor` exits 0 when no item failed, whatever was not checked | AC16 | `exits.test.ts`: "AC16 deep doctor exited 0 with an item not checked: <item> (not_checked) …" |
| `status-exit-unmapped` | `deep status` exits 4 when it can't read a hub | AC16 | `contract.test.ts`: "deep status ended with an outcome exit.code@1 doesn't map (0, 1, 2, 3): exit 4 …" |
| `hooks-order-ours-first` | lists DeepBuild's entries before every other tool's on each hook, whatever the file's order | AC18 | `order.test.ts`: "AC18 on UserPromptSubmit the file has herd-hook before DeepBuild, and deep doctor reports the other order …" |

For the criteria with no named wrong program (AC3, AC4, AC11, and the halves of AC9 and AC16 the base already
fails), the merge base is the wrong program: a doctor with no such item, or a runner that starts the job anyway
(`BASE-FAILURE.txt`).

### Additions the implementation must make, in short

`deep doctor --prompt`; `deep status`; the items above with their codes and wording (hooks missing with the `deep
setup` fix, the token's lifetime, the binary's version against its facts, the test prompt, billing keys, the
sessions' and jobs' `claude`, hooks off in a repo or by policy, other tools' hooks in order); the doctor's exit by
the one table (0, 1, 3; 2 for a usage error with nothing run); the runner's token check before a job starts; the two
seams; the eight plants; and `deep inbox undo` taking an unknown flag as a usage error (exit 2, nothing run): at the
base it reads `--dh19-no-such-flag` as an ask and exits 3, which the contract test names.

## Criteria to tests

| ID | Criterion (short) | Test | Wrong program it fails on |
|---|---|---|---|
| AC3 `#19.fd97a642` | doctor names the exact fix for a missing hook installation | `hooks.test.ts`: PreToolUse and Stop entries gone; `hooks_missing` fail naming both hooks and the file, exit 1; the fix's command is `deep setup`, and running it clears the item | a doctor with no hooks item (the base); a fix that names no command, or the undo |
| AC4 `#19.04d6e57d` | a token expiring before a planned run ends is reported before it starts | `token.test.ts`: twin first (3 h token: the job starts); 20 min token, one-hour job: never starts, its record names the token's expiry; doctor shows the token's lifetime | a runner that starts the job anyway (the base); a doctor that doesn't read token lifetimes |
| AC9 `#19.dfcae9ef` | an item that didn't run reads "not checked", never OK; non-zero exit with a failed item | `notchecked.test.ts` (three): the prompt item `not_checked`/`skip`, "not checked" in words; an uncovered `claude` version fails an item naming it, exit 1; the plant | `skipped-reads-ok`; a doctor with no version item (the base) |
| AC10 `#19.3f3246ed` | a test prompt runs only with `deep doctor --prompt` | `prompt.test.ts` (two): no prompt call from `deep doctor` or `--json`; `--prompt` makes a `claude -p` call and its item is ok | `prompt-without-flag`; a doctor without `--prompt` (the base) |
| AC11 `#19.b637c3cc` | `ANTHROPIC_API_KEY` → warn that sessions bill an API account; two `claude` installs named | `billing.test.ts` (two): a `warn` item naming the variable, API billing, never the value, and none without the key; one item naming both paths, sessions' and jobs', flagged | a doctor with no billing or binary items (the base); one that names only one path, or swaps them |
| AC12 `#19.5800e7ab` | repo `disableAllHooks` and a managed-hooks-only policy show as hooks that won't run, naming the setting; non-zero exit | `disabled.test.ts` (three): each a failed item naming the setting, exit 1; the plant | `hooks-disable-user-only`; the base |
| AC15 `#19.fbe84694` | 60 and 64 broken in doctor (exit 1) and at hub start, naming hold, timeout and reason; 65 ok | `stophold.test.ts` (five): 60, 64, 65, and the two plants | `stop-hold-no-margin` (passes 64), `stop-hold-entry-only` (passes all three) |
| AC16 `#19.26a372c6` | doctor's exit table; `deep status` hub down, no database → 3; the contract test | `exits.test.ts` (seven): 0, 1, 3, 1, 2, status 3, the plant; `contract.test.ts` (two): every command through `exit.code@1`, and the plant | the base's doctor, which exits 0 with `otlp.telemetry` not checked; `not-checked-exits-0`; `status-exit-unmapped` |
| AC18 `#19.b903fde1` | doctor detects other hook-based tools and reports the order hooks run in | `order.test.ts` (two): herd-hook named; its order against DeepBuild's on UserPromptSubmit, Stop and PreToolUse as in the file; the plant | `hooks-order-ours-first`; a doctor that doesn't look (the base) |

## Disputes

1. **"Not checked" and exit 3 for every plain `deep doctor`.** The design lists the test prompt as an item that
   reads not checked when it didn't run, and the exit table makes an item not checked exit 3, so a plain `deep
   doctor` in a healthy home exits 3 and only `deep doctor --prompt` can exit 0. These tests read it that way: "every
   item ok" is checked with `--prompt`. "Only an item not checked" uses the telemetry item (#42's merged
   `not_checked` with telemetry off) so it holds whether or not the prompt item is listed without `--prompt`; AC9's
   and AC10's tests do need it listed.
2. **AC4's planned run and token.** The issue doesn't say which run or which token. The one run the base plans an end
   for is a job with `deadline_ms`, and the one token whose lifetime is known is the Keychain access token the runner
   hands a job without its refresh token. Reading `expiresAt` from the Keychain item sits uneasily with "`deep` never
   reads a credential file"; the runner already reads that item (#159), and only its expiry is new. A test can't use
   the Keychain, so `DEEP_HUB_TEST_KEYCHAIN` stands in for it. If the implementer reads "a run" as something else
   (`deep run`, a check's services), that is this job's redraft.
3. **The order hooks run in.** Claude Code starts a hook's matching entries together, not one after another, so "the
   order" here is the order Claude Code reads and starts them, the settings file's; a doctor that also says they run
   at once passes. Codex's order comes with its adapter (#39).
4. **Which `claude` your sessions run.** The doctor could learn it from a session (its process), or from your shell's
   PATH. These tests use the PATH `deep doctor` runs with; a doctor that reads the session's process instead would
   see the same stand-in here only if it resolves the session's binary the same way, so the reading is fixed above.
5. **Which repos AC12 reads.** The fixture serves both readings (the cwd, and repos the hub has seen a session in).
   A real Claude Code with `disableAllHooks` in a repo runs no hook there, so a session that starts after the flag
   never reaches the hub; that's why the session started first.
6. **"Every item ok" depends on the stand-ins.** The all-ok world can only be as right as the stand-ins: Codex is
   installed and signed in, but has no hooks or trust state (its hook items come with #39). An implementation that
   adds Codex hook items in #19 would find them failing here; that is a dispute for a redraft, not a reason to skip.
7. **AC15 at the base.** The base's #18 relation already uses the 5 s margin, so the three fixture tests pass at the
   base; the plant tests fail there (the hub refuses the unknown plant names, BLOCKED), and pass once the plants
   exist and the tests catch them.
8. **How checks fail (redraft, Oct 27).** The proof lane counts only an assertion failure as a test failing on a wrong
   program, so the AC9, AC12, AC15, AC16 and AC18 scenario checks now fail with `expect.fail(msg)` instead of
   `throw Error(msg)`, messages unchanged; BLOCKED throws stay plain errors.

## Files

- `helpers.ts`: temp homes, stand-ins and seams, `deep`/`deep doctor`, settings and DeepBuild's entries, the hub and
  its socket, readings, the session stand-in, the all-ok world.
- `fixtures/claude.sh`, `fixtures/claude-mcp.mjs`, `fixtures/codex.sh`, `fixtures/stub-bin.sh`,
  `fixtures/herd-hook.sh`, `fixtures/session.mjs`.
- `hooks.test.ts` (AC3), `token.test.ts` (AC4), `notchecked.test.ts` (AC9), `prompt.test.ts` (AC10),
  `billing.test.ts` (AC11), `disabled.test.ts` (AC12), `stophold.test.ts` (AC15), `exits.test.ts` and
  `contract.test.ts` (AC16), `order.test.ts` (AC18).
- `BASE-FAILURE.txt`: the run on the base commit and why each test fails there.
