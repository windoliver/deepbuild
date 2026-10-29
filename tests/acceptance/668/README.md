# Acceptance tests for #668: deep setup, a watched Claude Code session in deep status, and undo

Written first, blind, by a job that never saw an implementation of #668 (none existed). It read:

- issue #668 as of October 28, 2026: its Scope, six checkbox criteria, Proof and Depends on (#19, #18, #666, all
  merged at the base); it has no comments;
- `docs/technical-design.md`: How it installs; Hooks are evidence, not a state machine; Hook protocol (deep-hook and
  the hub); States people see; Dogfooding; and the exit-code table (`exit.code@1`);
- AGENTS.md and CONTRIBUTING.md;
- the READMEs of the suites whose surfaces it drives: `666/`, `19/{setup,status,doctor,authority}/`, `19/twins.json`,
  `18/{session,mapping,install}/`, `18/twins.json`, `48/`;
- base commit `f83ea0a7` (origin/main): `packages/cli/src/main.ts`, `packages/hub/src/{setup,claude-settings,agent-files,
  status,doctor,authority,service,paths,plant,hookmap,keychain}.ts`, `packages/hub/src/core.ts` (commits, sessions),
  `packages/otlp/src/doctor.ts`, `crates/deep-hook` (late and spooled replies), `scripts/agent-harness.mjs`,
  `scripts/lanes.mjs`, `scripts/proof-runs.mjs` (how twins are laid over a checkout), `adapters/claude-code.facts.json`
  and its 2.1.308 `tools` corpus session.

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH` (`.node-version`), on macOS, and the Rust toolchain:

```sh
npm ci && npm run build --workspaces    # the tests run the built CLI, packages/cli/dist/main.js
cargo build --locked -q -p deep-hook    # setup's entries run it; the tests build it too
npx vitest run --root tests/acceptance/668 --no-file-parallelism fast.test.ts
DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> npx vitest run --root tests/acceptance/668 session.live.test.ts   # by hand only: spends plan usage
node node_modules/typescript/bin/tsc -p tests/acceptance/668/tsconfig.json
```

- **Fast tests** (`fast.test.ts`) start no agent and spend nothing: the whole checkpoint with a made-up session whose
  hooks run through your user settings into the real deep-hook and hub while its commands run for real. About 20 s.
- **Live tests** (`session.live.test.ts`) run one real Claude Code session through the agent test harness, on your own
  sign-in. Without `DEEP_HARNESS_LIVE=1` (#48's opt-in), without `CLAUDE_CODE_OAUTH_TOKEN`, or without a `claude` on
  `PATH`, each fails with `BLOCKED` in its message; nothing skips. They also spend one `deep doctor --prompt` test
  prompt.
- Every test makes its folders under `/tmp/dh668-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts, and never touches the real `~/.deepbuild`, `~/.claude`, `~/.claude.json`, the Keychain
  or `~/Library/LaunchAgents`. It stops only processes it started, by PID, including the hubs the launchd stand-in
  started. No child inherits a billing key or a `CLAUDE*`, `CODEX*`, `GIT_*`, `OTEL_*` or `DEEP_*` variable of the
  runner's; the live run passes `CLAUDE_CODE_OAUTH_TOKEN` to the harness and the doctor explicitly, and nothing else.
- With `--root` here, Vitest writes its cache to `tests/acceptance/668/node_modules/.vite/`; delete it before
  committing.
- Machine load: deep-hook acts alone on a hub that hasn't acknowledged within its deadline (#315). The AC5 probes read
  the hub's acknowledgement off a forwarded socket and try again when there is none (eight tries), and fail
  `INCONCLUSIVE` saying so; a hook lost under load elsewhere fails the criterion that reads it, naming what is missing.

## The surface under test

### Merged surfaces, used as their suites define them

- **`deep setup`** and **`deep setup --undo`** (#18, #19): setup merges DeepBuild's hook entries into
  `~/.claude/settings.json` beside yours and starts the hub through its login service; undo restores your bytes, once
  the OS confirms you (`DEEP_HUB_TEST_CONFIRM=<file>` holding `confirmed`, #24's seam). DeepBuild's entries are those
  whose command runs deep-hook or the deep CLI.
- **`deep status`** (#19): exit 0 when it read the hub; a session is shown by a line holding the first 8 characters of
  its ID (#19 status README, reading 1).
- **`deep doctor [--json] [--prompt]`** (#19): `doctor.item@1` lines with `item`, `level`, `code`, `evidence`, `fix`;
  `not_checked` is "not checked". Seams `DEEP_HUB_TEST_KEYCHAIN` (the Keychain stood in for) and, in the fast tests,
  `DEEP_HUB_TEST_MANAGED_SETTINGS` (#19).
- **`deep off`** and **`deep on`** (#19), the OS confirming you.
- **The hub's socket** (#16): `events.read` and `sessions.read` on a `cli` connection with the control token; the
  address setting `hub.address` in `~/.deepbuild/config.json`, pointed at a forwarded socket for the AC5 probes only.
- **The record as the hub serves it** (#14, #18): `tool.before`/`tool.after` with `call` (the `tool_use_id`),
  `outcome`, `signature`; `commit.made` (any `commit.*` kind) with `sha` under the session; `user.ask`, `agent.stop`.
- **Guard entries** in `~/.deepbuild/rules.json` (#304, #316): the tests add one gate of yours beside setup's.
- **`DEEP_HUB_PLANT=<name>`**: a planted wrong program (#16); the twins (below) replace `packages/hub/src/plant.ts`.

### Stand-ins (boundaries this repo doesn't own), first on `PATH` as `<tmp>/bin`

- `launchctl`: `fixtures/launchd.mjs`, #19's launchd stand-in, with one fix (a `gui/<uid>/<label>` target is read as
  its label, so `kickstart` after a stopped hub starts it again). So `deep setup` really starts the hub through its
  login service, and undo really unloads it; the real launchd is never reached.
- `systemctl` logs and exits 0; `sh-login` is your login shell (`SHELL` for setup), whose PATH is this one; `deep`
  runs the built CLI.
- `claude`: in the fast tests `fixtures/claude.sh` (a covered `--version`, a signed-in `auth status`, one successful
  `-p` turn, no model call); live, a link to the `claude` on the runner's `PATH`.
- Claude Code running its settings' hooks: `fixtures/claude-code.mjs`, #18's and #19's stand-in, copied as-is. It reads
  the user settings file at each hook and runs every matching command entry as Claude Code does.

### The temporary home and the session's sign-in

Claude Code's sign-in lives in your Keychain, which it doesn't read under a temporary `HOME` (#666's finding). #666
kept the real `HOME` and passed its hooks with `--settings`, so its sessions never read a user settings file `deep
setup` wrote. That can't observe AC1. So, as #18's and #25's live suites do, the live session runs with `HOME` the
temporary home and signs in with `CLAUDE_CODE_OAUTH_TOKEN` (the harness's `--pass-env`); with `--setting-sources
user` its user settings are `<tmp>/h/.claude/settings.json`, the file `deep setup` wrote beside your hook, and your
hook running in the session is seen in its own log. The home is written at run time:

- `<tmp>/h/.claude/settings.json`: your settings by hand (tabs, a space before a colon, a `\u` escape, no final
  newline), holding one hook of your own: `PostToolUse`, matcher `*`, running `<tmp>/h/.local/bin/my-hook`, which
  appends each payload it gets to `<tmp>/h/my-hook.log`. No hook is kept in any committed settings file (repo-rules
  `agent-hooks`).
- `<tmp>/h/.claude.json`: Claude Code's own state, first-run screens done.
- `<tmp>/keychain.json`: the Keychain stand-in, a sign-in whose lifetime outlives any run, with no secret in it.

### The fixture repo

`fixtures/checkout-web/` (#666's page, plus `package.json`, `src/cart.js` that ignores each line's quantity and
`test/checkout.js`, which `node --test` runs and which fails until `src/cart.js` multiplies by the quantity). Each run
copies it to `<tmp>/checkout-web`, makes it a git repo with two commits ("Start the checkout page", "Add the checkout
test") and git's user in the repo's own config. Its own `.claude/settings.json` and `.claude/settings.local.json`
each hold a hook that writes a tripwire file outside the repo (git ignores `.claude/` through `.git/info/exclude`).

### The checkpoint (`helpers.ts`, `checkpoint`), in the issue's order

1. Your settings' bytes and the checkout are kept; `deep setup` runs in the checkout; the hub answers.
2. The session. Fast: the made-up session runs `node --test` (fails), Reads and Edits `src/cart.js`, runs `node
   --test` (passes) and `git commit -am "Fix the cart total"`, then Stop and SessionEnd, each hook through your user
   settings; `deep status` runs once right after the failing run reached the record. Live: the harness's
   `fix-checkout-test` scenario; `deep status` runs back to back while the harness runs.
3. You commit by hand in the checkout after the session ended ("Note the pay button"): a commit it didn't make.
4. The record settles (the session's stop and its commits in it, or 60 s); `deep status`, and `deep status` with
   `DEEP_HUB_PLANT=status-omits-commit`.
5. `deep doctor --prompt --json`. Then the hub stopped by PID, DeepBuild's PreToolUse entry taken out of your
   settings by hand, `deep doctor --json`; the fix it names, `deep setup`; `deep doctor --json` again.
6. `deep off` and `deep on`, read through your gate (AC5).
7. The checkout's `.claude/` folder again; `deep setup --undo`; your settings' bytes.

## Readings where the issue and design leave a choice

1. **AC1, "the person's own hook still runs"**: your hook got a PostToolUse payload, with the session's ID, for every
   tool call of the session that ran. **"Beside it in the user settings"**: after setup your hook's group is in
   `PostToolUse` exactly as written, every other setting of yours is unchanged, and DeepBuild has an entry for
   SessionStart, PreToolUse, PostToolUse, PostToolUseFailure and Stop there. **"Never in the repo's"**: `deep setup`
   (run in the checkout) changes no file of the checkout, and by the end (after the session, the fix's second setup,
   off and on) the checkout's `.claude/` is byte for byte as before.
2. **AC2, "under checkout-web as working"**: the session's line says `working` (States people see), and it or the
   nearest line above it naming a repo names `checkout-web` (a line naming `no repo` in between fails). The repo's
   name is its folder's, `checkout-web`. **"While the session runs"**: every status that started after the session's
   `user.ask` and ended before its `agent.stop`, as the record stamps them; live, none such is `INCONCLUSIVE`.
3. **AC2, "after its stop it lists its tool calls"**: the session's lines (from its line to the next line naming
   another session of the record) name each tool call, by its `tool_use_id`, or by its command's first 24 characters
   (a Bash call) or its file's name, as many times as calls share that name (two `node --test` runs need two
   mentions). **"Its commit by SHA"**: a hex prefix of at least 7 characters of each commit the session made.
   **"Read from the record"**: the record holds exactly those commits under the session, and the status lists none
   other: your hand commit, or either fixture commit, under the session fails, naming it.
4. **AC3, "recorded as a failed tool call with its error signature"**: the `tool.after` of the first test run
   (`call` = its `tool_use_id`) has `outcome: failed` and a non-empty `signature`. **"Shows on the session"**: in
   `deep status` after the stop, a line of the session's that names that call says it failed (`fail…`, `exit 1`,
   `✗`/`✖` or its signature).
5. **AC4, `deep doctor` exits 0 with every item OK or "not checked"**: run as `deep doctor --prompt --json` in the shell
   you start sessions from, with Claude Code's telemetry pointed at the receiver (`CLAUDE_CODE_ENABLE_TELEMETRY=1`,
   `OTEL_LOGS_EXPORTER=otlp`, `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`, `OTEL_EXPORTER_OTLP_ENDPOINT=
   http://127.0.0.1:4318`) and the Keychain stand-in, so every item the doctor has can run. Each item must be `ok` or
   `not_checked`, and the exit 0. See Disputes, 1.
6. **AC4, "with DeepBuild's hook entry removed by hand"**: the PreToolUse entry, taken out with the hub stopped (the
   hub puts back an entry removed while it runs, #18); `deep doctor --json` must exit non-zero with a failed item
   naming `PreToolUse` and your settings file, whose fix is the command `deep setup` (never `--undo`). "Its exact
   fix" is then run: `deep setup` puts the entry back and the doctor no longer names it.
7. **AC5, the gates**: your own guard entry `yours-no-make-release` (`run:make release`, `block`, not `fail_closed`),
   added to `rules.json` beside setup's. **Gated**: DeepBuild's PreToolUse entry denies `make release` (exit 2 or a
   deny). **Watch-only**: the hub acknowledged the hook (seen on a forwarded socket at the address setting) and
   nothing denied it. Before `deep off` the gate must hold (else `BLOCKED`); after `deep off` exits 0, the first
   watch-only reply must come from a hook started within 1000 ms of its exit; after `deep on` exits 0, a hook started
   within 5 s must be denied. The probes are made-up PreToolUse hooks of another session in the checkout, after the
   real one, through your user settings.
8. **AC6**: after everything above, `deep setup --undo` (the OS confirming you) exits 0 and your settings file holds
   the bytes it held before the first setup. The fix's second `deep setup` is in between: DeepBuild's last write is
   the file's content, so the design's "restore … where you haven't edited since" still restores your bytes.
9. **"One scripted headless Claude Code session"** is the harness's scripted session: interactive in a
   pseudo-terminal, never `-p`, no person answering (#666 and #48: `-p` ends async hooks at teardown).

## Disputes

1. **AC4 against #19 AC16 (`#19.26a372c6`).** #19's merged tests require `deep doctor` to exit **3** when any item is
   not checked (its plant `not-checked-exits-0` must fail them); this issue says it "exits 0 with every item OK or
   'not checked'". Under a temporary HOME, plain `deep doctor` always has items not checked (the test prompt, the
   token's lifetime, telemetry), so the two can't both hold there. These tests read AC4 in a world where every item
   can run (`--prompt`, telemetry, the Keychain stand-in), where both issues agree: every item OK, exit 0. They assert
   the issue's text (OK or "not checked", exit 0), so an item left not checked in that world fails them, but they
   don't build a world whose only not-checked item would separate the two readings. The owner decides; a redraft
   adds that case if the owner sides with #668.
2. **The harness scenario** (Additions, 1) loads your user settings with a temporary `HOME`, unlike #666's
   `add-readme-line`, which loads none: AC1 can't be seen otherwise.

## Additions the implementation must make

This job edits nothing outside this folder.

1. **A harness scenario**, `fix-checkout-test`, in `scripts/agent-harness.mjs`:

   ```
   node scripts/agent-harness.mjs run --scenario fix-checkout-test --workdir <dir>
        [--pass-env <NAME>]... [--claude <path>] [--timeout-ms <n>] [--out <dir>]
   ```

   - One interactive Claude Code session in a pseudo-terminal in `--workdir`, an existing folder the harness neither
     makes nor removes, from the facts' session launch (Haiku, never `-p`), with the version gate and sign-in check as
     today (a version the facts don't cover is `BLOCKED`).
   - It loads your user settings and nothing of the workdir's: `--setting-sources user`, so its user settings file is
     `$HOME/.claude/settings.json` from the harness's own environment (the tests run it with `HOME` the temporary
     home). The harness's own hooks go only in its `--settings` file, never into the user settings file.
   - Tools `Bash`, `Read` and `Edit`, allowed with no prompt (`--allowedTools Bash,Read,Edit`), so no person answers
     one; the harness answers the folder's trust prompt as today.
   - Once the session is ready it types, word for word: ``Run the checkout tests once with `node --test`; they fail.
     Fix the bug in src/cart.js, run `node --test` again to see them pass, then commit the fix with `git commit -am
     "Fix the cart total"`.`` (helpers.ts, `PROMPT`), with #666's scripted-session system prompt; it ends the session
     with `/exit` once that turn has stopped.
   - `--pass-env NAME` as `add-readme-line` has it; `--pass-env CLAUDE_CODE_OAUTH_TOKEN` signs the session in.
   - It prints #48's run line: `verdict` `PASS` when the turn ended with Stop; `sessionId`; `transcript` (its copy);
     `workdir`.
2. **Three planted wrong programs**, each named in `packages/hub/src/plant.ts`'s `Plant` and `PLANTS` (so a hub started
   with one runs), selected with `DEEP_HUB_PLANT`:

   | Name | Read by | What it does |
   |---|---|---|
   | `status-omits-commit` | the `deep status` process (`activePlant()`), whichever side builds the rows | lists every session as the merged status does, with its tool calls, and no commit |
   | `doctor-misses-hooks` | `deep doctor` | reads DeepBuild's hook entries as installed whenever setup's record of them exists, without reading your settings file |
   | `on-stays-off` | the hub | answers `deep on` as done (exit 0) and keeps every gate watch-only |

   `setup-writes-project-settings` and `undo-reserializes` already exist at the base and are kept.
3. **`packages/hub/src/plant.ts` keeps its exports as the base has them** (`Plant`, `plantOf`, `activePlant`): each
   twin replaces that file whole.
4. **Claude Code's facts cover the version on the machine** (2.1.312 here; the facts cover 2.1.299 to 2.1.308), or the
   live run is `BLOCKED` at the harness's version gate.
5. **`scripts/lanes.mjs`**: `tests/acceptance/668/fast.test.ts` in `alone` (it starts hubs and builds deep-hook, as
   #666's and #19's do), and `tests/acceptance/668/session.live.test.ts` in `byHand` (or a lane of its own that runs
   it with the opt-in in the local preflight on the reference Mac, as the issue's Scope asks). Without the second the
   unit lane runs the live file and it fails `BLOCKED` there.

## Criteria to tests

IDs are `#668.<first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed, the leading "- [ ] "
dropped>` (the rule of `scripts/proof-change.mjs`). Every test name and every check message starts with its ID.
Each criterion has one fast test and one live test with the same check; AC2 has a planted-status test in each.

| ID | Criterion (short) | Tests (`fast.test.ts`; `session.live.test.ts` the same, "(live)") | Wrong program each fails on |
|---|---|---|---|
| AC1 `#668.f5be25d4` | your hook still runs; DeepBuild's entries beside it in user settings, never in the repo's | `AC1 … your own PostToolUse hook runs for every tool call …` | twin `setup-writes-project-settings` (setup writes into the checkout's `.claude/settings.json`: "AC1 DeepBuild's hook entries must never go into the repo's settings: … .claude/settings.json changed"); a setup that drops or rewrites your hook or a setting of yours |
| AC2 `#668.c478c854` | status: working under checkout-web while it runs; after its stop its tool calls and its commit by SHA, from the record; a wrong commit fails naming it | `AC2 … deep status lists the session under checkout-web as working …`; `AC2 … (planted status) …` | the base (no repo, no calls, no commit, the stopped session folded as quiet); twin `status-omits-commit` ("AC2 after its stop, deep status must list session …'s commit <sha> …"); a status listing your hand commit ("AC2 deep status lists commit <sha> ("Note the pay button") under session …, which the session didn't make") |
| AC3 `#668.96a6fd85` | the failing first test run: a failed tool call with its error signature, shown on the session | `AC3 … the failing \`node --test\` is a failed tool call …` | the base (status doesn't show the call); a record without `outcome: failed` or `signature`; a status that doesn't mark the call failed |
| AC4 `#668.3ee80c65` | doctor exit 0, items OK or "not checked"; entry removed by hand: named with its exact fix, non-zero | `AC4 … deep doctor --prompt shows every item OK … removed by hand …` | twin `doctor-misses-hooks` ("AC4 … deep doctor must name the missing installation …"); a doctor with a warn or fail item, or a non-zero exit, after setup |
| AC5 `#668.e1e1081d` | `deep off`: next reply watch-only within a second; `deep on`: gates back | `AC5 … your gate denies \`make release\` …` | twin `on-stays-off` ("AC5 deep on must bring the gates back: …"); a `deep off` that takes effect past the second |
| AC6 `#668.882ded0d` | undo leaves user settings byte for byte | `AC6 … deep setup --undo leaves your user settings byte for byte …` | twin `undo-reserializes` ("AC6 … first difference at byte …") |

`twins.json` maps AC1, AC2, AC4, AC5 and AC6 to their twin folders under `twins/`; each holds only
`packages/hub/src/plant.ts`, returning its plant whatever `DEEP_HUB_PLANT` says. AC2 and AC3 fail on the base at their
assertions. Checked while writing (a scratch run, not kept): the AC1 check fails with `DEEP_HUB_PLANT=
setup-writes-project-settings` and the AC6 check with `undo-reserializes` at the base, and the AC2/AC3 checks pass a
right listing and fail one missing the commit, one listing the hand commit, one naming a test run once and one not
marking the failed run. The three new plants can't run before the implementation adds them.

A live test whose session is `BLOCKED` (no opt-in, no token, no scenario, an uncovered version) fails as `BLOCKED`;
one whose session ran a hook from the checkout's own settings fails as `INVALID`; one whose session didn't fail its
first test run, never passed one after, made no commit, or had no `deep status` taken while it worked, fails as
`INCONCLUSIVE`.

## The proof

Written to `$TMPDIR/deep-668-proof/` (`os.tmpdir()`), `fast/` and `live/`, rewritten on each run and never read back:

- `terminal.txt`: each command's terminal output in order (setup, each status, the planted status, the doctor runs,
  the fix, off and on with each probe's reply, undo; live, the harness's run line);
- `transcript.jsonl`: the session's transcript (live, the harness's copy);
- `record.json`: the record's rows of the session: its `sessions` row, its tool call events and its commit events (and
  all its events);
- `settings-before.json`, `settings-after-setup.json`, `settings-after-undo.json`: your user settings file's bytes;
- `my-hook.log`: what your own hook got; `machine.txt`: model, chip, memory, load.

## Files

- `helpers.ts`: the home and stand-ins, the fixture repo, the CLI, the hub's socket, the Claude Code stand-in, the
  made-up session, the harness, every criterion's check, the checkpoint and the proof.
- `fast.test.ts`, `session.live.test.ts`: the tests. `tsconfig.json`: the root options with `noEmit`.
- `fixtures/`: `checkout-web/`, `claude.sh`, `claude-code.mjs` (#19's copy as-is), `launchd.mjs` (#19's, one fix).
- `twins.json`, `twins/<plant>/packages/hub/src/plant.ts`: the planted wrong programs for the proof lane.
- `BASE-FAILURE.txt`: the run at the base.
