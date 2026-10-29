# Acceptance tests for #326: Set up, watch-only from the start

A blind job wrote these tests before any implementation of #326 existed. It worked from:
- issue #326 (its body as of October 27, 2026), its first acceptance criterion and the Scope bullet on Set up, and its
  Proof line ("Set up leaving hooks watch-only ... shown failing first");
- the design sections the issue links: One hub per user, a tiny hook client, and extensions in-process (the
  DeepBuild app row and the deep CLI row), First-party extensions that ship on by default (the done-gate row) and
  States people see; and the design's How it installs (Setup), Hook protocol (the fast rules in `rules.json`),
  Threats (a broken hub: fail-closed fast rules), Dogfooding and How we know version 0 works;
- the dependencies' titles and state: #19 CLI basics (closed, merged) and #34 App API (closed), and their acceptance
  tests: `tests/acceptance/19/setup/` (its AC6, "right after install, no stop held, no verdict blocks, fast rules
  from the start", is this criterion's CLI half) and `tests/acceptance/34/README.md`;
- base commit `debda22` (origin/main): `packages/cli/src/main.ts`, `packages/hub/src/setup.ts`, `server.ts`,
  `status.ts`, `crates/deep-hook/default-rules.json`, `crates/deep-app/src/main.rs` and `crates/deep-replica`.

Nothing of #326 is implemented at the base. The implementing agent does not edit these files (AGENTS.md, Proof). A
dispute goes to a blind redraft of this job.

This folder covers the first criterion, `#326.523de34e`, and the Scope sentence on the one Set up click and the first
`deep` command. Two other blind jobs cover the rest of #326 in `tests/acceptance/326/surfaces` and
`tests/acceptance/326/panels`.

## How to run

With Node 24.22 first on `PATH`, the workspaces built (`npm ci; npm run build --workspaces`), cargo with
`RUSTUP_HOME=~/.rustup CARGO_HOME=~/.cargo`, on macOS:

```sh
cargo build --locked -q -p deep-hook                     # setup's entries run target/debug/deep-hook
cargo build --locked -q -p deep-app --bin deep-app       # the click is target/debug/deep-app (gpui-kit: minutes cold)
npx vitest run --root tests/acceptance/326/setup --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/326/setup/tsconfig.json
```

- The helpers run both cargo builds themselves if needed. No `Cargo.toml` was edited: there is no Rust test here.
- `--no-file-parallelism`: each test sets up homes, which starts hubs.
- **Folders.** Every test makes its folders under `/tmp/da326s-*` (a socket path must fit in 104 bytes). HOME is
  `<tmp>/h` for every process it starts. It never touches the real `~/.deepbuild`, `~/.claude`, `~/.claude.json` or
  `~/Library/LaunchAgents`.
- **Processes.** It stops only processes it started, by PID, including the hubs the launchd stand-in started.
  Children get no billing key and none of the runner's `DEEP_*`, `CLAUDE*`, `CODEX*`, `GIT_*` or `XDG_*` variables.
- **Cache.** With `--root` here, Vitest writes its cache to `tests/acceptance/326/setup/node_modules/.vite/`. Delete it
  before committing.
- **Not macOS.** Every test fails BLOCKED: the launchd stand-in is the only login service stood in for.
- **Time.** The whole folder took 184 s at the base, with its builds already done.

### Stand-ins (copied as-is from `tests/acceptance/19/setup/fixtures/`), first on PATH as `<tmp>/bin`

- **`launchctl`** runs `fixtures/launchd.mjs`, a stand-in for launchd: `bootstrap` loads a plist and starts its
  program with the caller's environment. So setup really starts the hub through its login service.
- **`claude`** and **`systemctl`** (`fixtures/stub-bin.sh`) log their call and exit 0.
- **`sh-login`** is `SHELL`, your login shell, with no profile of the test machine.
- **`deep`** runs the built CLI, `packages/cli/dist/main.js`.
- **Claude Code** is `fixtures/claude.mjs`, #18's stand-in. It runs the user settings file's command hooks as Claude
  Code does and starts its own `deep mcp`.

## The surface

### Pinned here: the implementation must provide these

1. **The Set up click, headless: `deep-app --set-up`.**
   - The app binary (`crates/deep-app`, bin `deep-app`, built at `target/debug/deep-app`) takes `--set-up` and runs,
     without opening a window, exactly the action that the first launch's one Set up button runs on its click.
     The button's click handler and `--set-up` call the same code.
   - It runs with the environment it is given: HOME, PATH (the stand-ins, `deep`, Node), SHELL. It reaches the CLI
     and `launchctl` through that PATH or through the checkout it was built from (R1 builds the app from the
     checkout). It never calls `/bin/launchctl` by path.
   - It runs in a folder outside every repo, as an app opened from the Dock does.
   - Done, it prints **exactly one non-empty line on stdout**, the line the app shows after the click, and exits 0.
     Anything on stderr is ignored.
   - At the base, `deep-app --set-up` panics with `unknown argument --set-up` (exit 101).
2. **The first `deep` command: `deep status`** in a home where nothing of DeepBuild is installed.
   - It runs the same steps as the click, without asking anything, then does its own job: `deep status` exits 0
     reading the hub it just started.
   - It says so in **exactly one non-empty line on stderr**, so the command's stdout stays its own.
   - The next `deep` command, and the first one after a click, sets nothing up again. It prints no such line (no
     stderr line naming watch-only or `deep setup --undo`) and rewrites none of `~/.claude/settings.json`,
     `~/.claude.json`, `~/.deepbuild/rules.json` or `~/.deepbuild/config.json`.
3. **The one line** (Scope: "says so in one line"; design, How it installs: "It tells you in one line what it added
   and how to remove it"). It names the hooks (`/hook/i`), watch-only mode (`/watch[- ]only/i`), the hub
   (`/\bhub\b/i`) and how to remove it (`deep setup --undo`, the literal text). `deep setup`'s own summary line at
   the base doesn't name the hub, so a click that forwards it fails.
4. **The same state.** After the click, after the first `deep` command and after `deep setup` (the reference, #19's
   merged surface), these are equal, with each home's temp folder written `<tmp>` (`installedState` in `helpers.ts`):
   - `~/.deepbuild/config.json`;
   - DeepBuild's hook entries in `~/.claude/settings.json` (event, matcher, entry) and its `statusLine`;
   - DeepBuild's MCP servers in `~/.claude.json`;
   - `~/.deepbuild/rules.json`;
   - the hub's login service (label, program);
   - DeepBuild's skill files under `~/.claude/skills/`.
   Each way in also leaves the hub answering at `~/.deepbuild/hub.sock` within 30 s.

### Merged surfaces, used as #19 defines them

- `deep setup`, its hook entries, `rules.json` (with `no-kill-by-name`, fail-closed), the MCP registration, the
  skill, the status line forwarder and the login service (`packages/hub/src/setup.ts`, `service.ts`).
- The hub's socket and its hook acknowledgement `{ack, hold_until_ms}`; a number is a held stop, `null` is not held.
- The address setting `hub.address` in `~/.deepbuild/config.json`: the tests point it at a forwarded socket that
  keeps the hub's acknowledgements.
- `deep mcp`'s `deep_claim` and `deep_run`, which runs a check `.deepbuild/done.yaml` names.
- deep-hook as a settings entry runs it, with the hub up and with the hub stopped by PID.

### What "watch-only from the start" means here (`scenario.ts`, adapted from #19's AC6)

In a repo `shop` whose `.deepbuild/done.yaml` was drafted (its one check, `exit 1`, fails) and that nothing approved:
1. a session claims its task done (`deep_claim`) and runs the check (`deep_run`), which fails;
2. its Stop is **not held**: the hub's acknowledgement has `hold_until_ms: null`;
3. **no verdict blocks** it: DeepBuild's foreground Stop entry answers at once, exit 0, with no `decision`;
4. its next Edit and `ls` are not denied;
5. **the fast safety rules apply from the start**: its `pkill -f vite` is denied (exit 2 or
   `permissionDecision: deny`), saying why (`/name or port/i`), with the hub up and again with the hub stopped by PID.

## Criterion to tests

| ID | Criterion (short) | Tests | Wrong programs each fails on |
|---|---|---|---|
| `#326.523de34e` | after the one Set up click: hooks in place, watch-only; no stop held, no verdict blocks before approval; fast safety rules from the start (+ Scope: one line, starts the hub) | `click.test.ts`: the click exits 0 and says one line; the hooks are in place; the hub answers; the scenario holds | the base (no `--set-up`); twins `chatty-set-up`, `no-hub-set-up`, `gating-set-up`, `watch-rules-set-up` |
| `#326.523de34e` | (Scope) the first `deep` command does the same without a click | `first-command.test.ts`: the first `deep status` sets up, one line on stderr, exit 0; the second sets nothing up again; the scenario holds | the base (no setup on a first command); twin `deep-sets-up-every-time` |
| `#326.523de34e` | (Scope, design) the click and the first command run the same steps as `deep setup` | `same.test.ts`: click, first command and `deep setup` leave equal installed state; a command after the click sets nothing up again | the base; twin `partial-set-up` |

### Wrong programs (`twins/`, runnable now)

Each twin stands in for the built app (`deep-app --set-up`) or for the CLI. A twin test runs the same checks on it and
requires them to fail with that twin's own message. Twins are built from merged code, so they run at the base.

| Twin | What it does wrong | Test, and the message it must fail with |
|---|---|---|
| the base | `deep-app --set-up` panics, unknown argument; a first `deep status` sets nothing up | every tagged test (BASE-FAILURE.txt) |
| `chatty-set-up` | the click shows all of `deep setup`'s output: its summary and the timing relations, one line each | `click.test.ts`: "must say what it did in one line; it said <n> lines" |
| `no-hub-set-up` | adds the hooks, then unloads the login service, so no hub runs | `click.test.ts`: "must start the hub through its login service" |
| `gating-set-up` | installs with the gates on, through the hub's merged plant `gates-before-approval` (#19) | `click.test.ts`: "after the Set up click … the hub held / a verdict blocked the Stop of session …" |
| `watch-rules-set-up` | sets up, then puts every fast rule in `watch` mode, not fail-closed | `click.test.ts`: "the fast safety rules must apply from the start: with the hub up DeepBuild let the agent's pkill -f vite through" |
| `deep-sets-up-every-time` | a `deep` that runs setup's steps before every command and says so each time | `first-command.test.ts`: "only the first deep command sets DeepBuild up: the second deep command (deep status) said so again" |
| `partial-set-up` | the click leaves one step out: the status line forwarder | `same.test.ts`: "must leave the same state as deep setup: statusLine differs" |

Two right programs, also built from merged code, are the positive controls. Each file runs the same checks on them,
and they must pass: `right-set-up` (the click as `deep setup` plus one line) and `deep-sets-up-once` (a `deep` that
runs setup's steps only when `~/.deepbuild/setup.json` is missing, saying one line on stderr). So a failure on the
real click or CLI is the program's, not the test's.

Other wrong programs these tests fail, not planted: a click or first command that writes the hooks but no
`rules.json` (pkill goes through with the hub up and down); one that installs into a project's settings instead of
your user settings (no entries in `~/.claude/settings.json`); one whose second command rewrites `settings.json`; and
one that asks a question (it has no answer on stdin and must exit 0 with one line).

The twin and control tests have no criterion tag (`#326 (wrong program …)`, `#326 (control …)`), so the proof lanes don't count them as tagged tests
that pass at the base. They pass at the base on purpose: they show each check is not vacuous before the
implementation lands. The tagged tests fail at the base for the missing surface.

## Disputes and assumptions a redraft may revisit

1. **The click's surface.** The issue and the design name a button, not an entry point. `deep-app --set-up` is the
   smallest surface that reaches the click's action headless. It does not prove that the first launch shows the
   button, or that no Settings page exists. Those are UI checks for the replica (`crates/deep-replica`), which has no
   click support at the base. A redraft that pins a replica click (`deep-replica` opening the first-launch view and
   clicking the node named "Set up") would test the button itself.
2. **"Until a repo's checks are approved."** Neither #326 nor the base has an approval surface, so only the
   before-approval half is tested, as in #19's AC6. Gates turning on after approval is not tested here.
3. **The answer route.** A session's own open `deep_ask` gets its stop held so the answer comes back in the same turn
   (#18). The probed stop has no open ask, as in #19's Disputes.
4. **Which first command.** The tests use `deep status`. "The first `deep` command" may also cover `deep --version`,
   `deep --help` or `deep mcp`; these tests don't say whether those set up.
5. **Where the first command's line goes.** stderr, so `deep status`'s stdout stays its own. A redraft may move it.
6. **What the one line says.** Hooks, watch-only, the hub and `deep setup --undo`. The last comes from the design's
   "and how to remove it", not from the issue.
7. **The same state includes `config.json`.** Setup drafts the ask settings and the login PATH there. A click whose
   app runs with a different login shell would differ; the tests give every way in the same SHELL.
8. **`gating-set-up` rides on the hub's merged plant `gates-before-approval`.** If #19's plant list drops it, the
   twin stops gating and its test fails, naming the twin. That is a broken twin, not a pass.

## Files

- `helpers.ts`: temp homes with the stand-ins; the click, the first command and `deep setup`; the one-line check;
  DeepBuild's entries, MCP servers, login service and installed state; the hub's socket and a forwarder; sessions and
  the Claude Code stand-in. Adapted from `tests/acceptance/19/setup/helpers.ts`.
- `scenario.ts`: the watch-only scenario every way in must pass.
- `click.test.ts`, `first-command.test.ts`, `same.test.ts`: the tests.
- `twins/`: the planted wrong programs and the two positive controls, shell scripts.
- `fixtures/`: `launchd.mjs`, `stub-bin.sh`, `claude.mjs`, copied from #19's setup folder.
- `tsconfig.json`: type-checks the suite under the root's strict options.
- `BASE-FAILURE.txt`: the run at the base, trimmed to each test's reason.
