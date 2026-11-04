# Acceptance tests for #993: hooks that can't run say so

Written first, blind, from issue #993 (its body as of November 2, 2026), `docs/technical-design.md` (What each agent
gives us, and the limits we design around; One hub per user, a tiny hook client, and extensions in-process; Hooks are
evidence, not a state machine, with Health reads the agent's side) and base commit `881e2ed4`, by a job that never saw
an implementation of #993. The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job.

The issue has three checkbox criteria, AC1 to AC3 in the body's order, with IDs as `scripts/proof-change.mjs`
computes them. Each test's title starts with its criterion and ID.

| Criterion | ID | File |
|---|---|---|
| AC1: deep-hook removed after setup, `deep doctor` fails `claude.hooks` with `hook_program_missing` | `#993.8355427d` | `doctor.test.ts` |
| AC2: removed under a running hub, within 10 minutes every open session's row and `deep status` read watch-only, hooks can't run | `#993.e11861a0` | `hub-check.test.ts` |
| AC3: a Grok hook run replayed from a shell with Claude Code's variable set is recorded under grok | `#993.b40b1853` | `nested-caller.test.ts` |

## How to run

With Node 24.22 first on `PATH`, `cargo` on `PATH` and the workspaces built:

```sh
npm run build --workspaces                       # the tests copy packages/hub/dist and packages/cli/dist
cargo build --locked -q -p deep-hook             # the tests copy target/debug/deep-hook (each file builds it if missing)
npx vitest run --root tests/acceptance/993 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/993/tsconfig.json
```

- The suite takes under a minute: AC2 steps the hub's clock instead of waiting 10 minutes.
- Every test makes its folders under `/tmp/dh993-*` (a socket path must fit in 104 bytes), sets `HOME` to `<tmp>/h`
  for every process it starts and never touches the real `~/.deepbuild` or `~/.claude`. It stops only processes it
  started, by PID. No child inherits a `CLAUDE*`, `CURSOR*`, `GROK*`, `CODEX*`, `DEEP_*`, `OTEL_*`, `GIT_*` or billing
  variable of the runner's; `PATH` is `<tmp>/bin`, Node's folder and the system folders only. No network, no model.
- With `--root` here, Vitest writes its cache to `tests/acceptance/993/node_modules/.vite/`; delete it before committing.
- `scripts/lanes.mjs` should run this folder in `alone`, as it does the other folders that start hubs. This job edits
  nothing outside its folder.
- Nothing skips. A missing build fails with `BLOCKED` in its message.

## The surface under test

### Merged surfaces, used as their suites define them

- **The CLI**, run as a child process: `deep setup` (#18, run with a hub answering), `deep doctor --json` (one
  `doctor.item@1` object per line with its `item` and `agent`, #19), `deep status` (#19, its rows as text), and
  `deep hub run`.
- **The hub's control socket** (#16) with the control token: `events.read` (each event's `agent`), `sessions.read`
  (the registry row's `agent`) and `status.read` (the rows `deep status` prints).
- **The stepped clock** (#965): a hub started with `DEEP_HUB_TEST_CLOCK_STEPS=1` serves `test.clock`
  (`{ advance_ms }`), and every timer the hub keeps on its clock comes due within a second of the step that passes it.
- **deep-hook** run as DeepBuild's entries in Claude Code's settings run it, `deep-hook claude-code <Event>` with the
  hook's JSON on stdin and the calling tool's environment.
- **The doctor family's codes** from their one source, `doctor.item@1` in `@deepbuild/contracts`.

### The copy of the checkout (my choice, since the issue names no way to remove the program safely)

`deep setup` writes the path of the deep-hook this checkout built (`packages/hub/src/paths.ts`, `deepHook()`:
`<checkout>/target/{release,debug}/deep-hook`). Removing that file would break every other suite running from the
checkout, so each test builds a copy of the checkout at `<tmp>/s` (`helpers.ts`, `copyOfTheCheckout`, after
`tests/acceptance/880`'s `copyOfTheHub`): every top-level entry is a link, except that `packages/hub` and
`packages/cli` are folders of links whose `dist` is a real copy, `node_modules/@deepbuild/*` point into the copy's
`packages`, and `target` is a real folder holding only `target/debug/deep-hook`, a copy of the built binary. The
copy's `deep setup` then names `<tmp>/s/target/debug/deep-hook`, and a test removes (or `chmod 644`s) that one file.

This makes one requirement on the implementation, which is the base's behavior: **setup names the deep-hook it
resolves from the hub module's own location**, and the doctor and the hub read the program from the entries in your
settings, not from a fixed path or this checkout's absolute path.

### Defined here, where the issue leaves a surface open

1. **"Naming the entry and the path"** (AC1): a `claude.hooks` item with code `hook_program_missing`, level `fail`,
   agent `claude-code`, whose `evidence` or `fix` holds the program's full path and at least one entry that runs it,
   by its hook event name (`SessionStart`, `PreToolUse`, …) or its whole command. Its fix names `deep setup` (in
   backticks or as words, never `--undo`), and the doctor exits 1. The code must be listed in `doctor.item@1`.
2. **Gone or not executable** (AC1, from the scope): the second test leaves the file there with mode 0644 and asks for
   the same item.
3. **The twins** (AC1, AC2): before the program is removed, no doctor item reads `hook_program_missing`, and no session
   row says hooks can't run, so a doctor or hub that always fails can't pass.
4. **A row that reads watch-only, hooks can't run** (AC2): the session's `status.read` row, as JSON text, contains
   `watch-only`, `BLOCKED` and `hooks can't run` (`can't`, `can’t` or `cannot`, any case); in `deep status`'s text the
   session's line (its ID's first 8 characters) and the indented lines under it hold the same three. The scope says
   the failure turns the gates "watch-only with BLOCKED, cause hooks can't run, on every open session's row". At the
   base, ten minutes with no hook make each prompt-opened session's row `quiet`, and `deep status` folds quiet rows
   into one count line; a row folded there says nothing, so it fails.
5. **Open Claude Code sessions** (AC2): two sessions started through DeepBuild's entries (the copy's deep-hook, with
   `CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT=cli`, `CLAUDE_PROJECT_DIR`), each with a SessionStart and a prompt, neither
   ended.
6. **"Within 10 minutes", without waiting them** (AC2): the hub runs with `DEEP_HUB_TEST_CLOCK_STEPS=1`. After the
   program is removed the test steps the hub's clock by 10 minutes and 1 second, once, and reads the rows for up to
   30 s of wall time. **The implementation must keep its 10-minute check on the hub's clock** (the clock `test.clock`
   steps), so a step past it brings the check due, as #965 requires of every timer it names.
7. **"A hub that waits for a hook to arrive never shows it"** (AC2): after the removal no hook runs at all (none could:
   every entry runs the removed program), so only a hub that checks the program on its own can pass.
8. **The nested Grok run** (AC3): `fixtures/grok-in-claude-shell.jsonl`, one line per hook call, `{event, env,
   payload}` with `$HOME`, `$CWD` and `$SESSION` filled at run time: SessionStart, UserPromptSubmit, a Bash call's
   PreToolUse and PostToolUse, and Stop. The payloads are Claude-shaped with the transcript under `~/.grok/sessions/`,
   and the environment is Grok's own hook variables (`GROK_HOOK_EVENT`, `GROK_HOOK_NAME`, `GROK_SESSION_ID`,
   `GROK_WORKSPACE_ROOT`, as `tests/acceptance/18/mapping` read xAI's Grok Build hooks docs) plus what a shell inside a
   Claude Code session inherits, `CLAUDECODE=1` and `CLAUDE_CODE_ENTRYPOINT=cli`. Each line runs
   `deep-hook claude-code <Event>`, the command setup writes into Claude Code's settings, which Grok runs.
9. **"Records the events under grok"** (AC3): every event of the Grok session that names an agent (the event's `agent`,
   or `data.agent`) names `grok`, and so does each hook's own event (`session.start`, `user.ask`, `tool.before`,
   `tool.after`, `agent.stop`, …); its `sessions.read` row's `agent` is `grok`. The failure names each event recorded
   under another agent by its kind. The twin: a Claude Code session with Claude Code's variables alone, in the same
   hub, stays `claude-code`'s.

## Not covered by these tests

- The scope's "each agent's own item" for agents other than Claude Code (Codex's settings): AC1 names only
  `claude.hooks`, and no Codex is installed in the test home.
- The hub's check **at start** (the scope), which no criterion names; AC2 covers the periodic check only.
- The hub checking the caller's name against the payload's own fields and recording a mismatch as a reading (scope):
  no criterion names it, and the replayed Grok run's fields agree with its variables.
- The scope's recorded corpus cases (Grok and Cursor started from a shell inside a Claude Code session in
  `adapters/corpus/`): AC3 replays its own recorded run (above), so it doesn't depend on a corpus layout the issue
  doesn't name; a Cursor run has no criterion.
- `deep setup` actually restoring a removed program (it rebuilds deep-hook from source in a source install): the
  criterion asks only that `deep setup` is named as the fix.

## Files

- `helpers.ts`: temp folders and processes by PID, the copy of the checkout, homes, `deep` through the copy's CLI,
  settings, the doctor, the hub and its line protocol, the stepped clock, and hook runs through deep-hook.
- `doctor.test.ts` (AC1), `hub-check.test.ts` (AC2), `nested-caller.test.ts` (AC3).
- `fixtures/grok-in-claude-shell.jsonl`: the nested Grok run AC3 replays.
- `BASE-FAILURE.txt`: the run at the base, each test's first failing assertion.
