# Acceptance tests for #1033: a Claude Code mod can approve a call deep-hook denied

These tests were written blind from issue #1033 (its Scope, its five acceptance criteria and its Proof line),
`AGENTS.md` and `docs/technical-design.md`: What each agent gives us, and the limits we design around (Facts as data);
Hooks are evidence, not a state machine; Threats, and what stops each one; How runs become one of five verdicts; the
Ask primitive; How we know version 0 works (Conformance tests, Wrong programs, Dogfooding). The base is commit
`7b18ed17` (origin/main), with no implementation of #1033. At the base I also read `adapters/claude-code.facts.json`,
`adapters/corpus/README.md`, `scripts/corpus.mjs` (`check --facts`), `scripts/proof-change.mjs` (`readIssue`),
`packages/hub/src/server.ts` (`reply`, the deny at PreToolUse), `packages/hub/src/core.ts` (claims, `judged`, `resent`),
`packages/hub/src/doctor.ts`, `packages/gate/src/checkouts.ts` (`baseProof`), `crates/deep-hook/src/matcher.rs`, and the
suites `tests/acceptance/29` (`h-d.ts`), `31` (`hub-env.test.ts`), `875` and `997`. The implementing agent doesn't edit
these files (AGENTS.md, Proof). A dispute goes to a blind redraft by this job.

## Environment and running

Node 24.22.0 (`.node-version`). No network, no model, no paid call, no real `claude`. Every folder is under
`/tmp/dh29-*` and is removed after each file. Each process a test starts is stopped by its PID.

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the deep CLI the hub and the doctor run from
cargo build -p deep-hook --locked        # the hook binary; a missing one is BLOCKED
node node_modules/vitest/vitest.mjs run tests/acceptance/1033/
node node_modules/typescript/bin/tsc -p tests/acceptance/1033/tsconfig.json
```

The suite takes about 10 s on the Spark. `replay.test.ts` runs two hubs one after the other, `doctor.test.ts` runs
four doctors, and `facts.test.ts` runs the corpus lane twice. On the base, 9 of the 10 tests fail at their assertions,
as `BASE-FAILURE.txt` shows. The tenth is AC4's control, and it passes there by design.

## The world, the session and the mods

- **The world** is #29's (`tests/acceptance/29/h-d.ts`: `makeWorld`, `Session`, the record read through the hub's
  socket). It's imported, never copied. It has a home with the shipped guards and your ask settings, the confirmation
  stub, and a repo whose `.deepbuild/checks/expired-token.sh` runs a `node:test` file. That file's assertion (line 5)
  fails until `src/auth.ts` compares with `Date.now()`. The definition handed for #29's prompt "make the auth middleware
  reject expired tokens" names that check, with `asserts` at the test file's line 5. So on the base the claim is PASS on
  the session's own checks: the check fails on the merge base at its assertion and passes on the snapshot. Two lines
  are added to `rules.json`: the guard entry **`no-force-push`** (`run:git push --force`, block, not fail-closed), and
  the class `send` for the MCP tool **`mcp__chat__post_message`**.
- **The session** (`fixtures/session/events.jsonl`, corpus-shaped, `session.json` beside it) is a Claude Code 2.1.308
  terminal session. It's made up in Claude Code's payload shapes, since the corpus has no recording with a mod. Its
  calls, in order: SessionStart; the prompt; a Read and an Edit (the fix); a `post_message` to `#releases` that
  completes (PreToolUse, PostToolUse); SessionEnd (the app quit); SessionStart from `resume`; the desktop app's resume
  prompt; the same `post_message` again (`toolu_01PostMessageAgain1033`), then its PostToolUse; `git push --force origin
  main` (`toolu_01ForcePushMain1033`), then its PostToolUse; and Stop. The replay (`helpers.ts`, `replay`) sends each
  call through `deep-hook claude-code <event>` as a child of the session's own process, and writes the transcript as
  Claude Code writes it. A PostToolUse after a denied PreToolUse is what the mod makes happen. **With managed settings**
  (AC5), the deny holds, as the permissions reference says. So the replay sends no PostToolUse for a call deep-hook
  denied, and writes the denial as the call's `tool_result`, as Claude Code does.
- **The mods** (`fixtures/mods/`) are installed the way Claude Code installs a plugin. Each mod's folder goes under
  `~/.claude/plugins/cache/fixtures/<name>/1.0.0/`, with an entry in `~/.claude/plugins/installed_plugins.json`
  (`{"version": 2, "plugins": {"<name>@fixtures": [{"installPath", …}]}}`) and `enabledPlugins` in
  `~/.claude/settings.json`. `approve-all` handles `tool.check` and approves every call. `status-band` draws a band and
  handles `session.start` only. Each mod's `mod.mjs` writes a sentinel file the moment it is loaded, and the tests
  assert that the sentinel never appears.
- **The `claude` stand-in** (`fixtures/bin/claude`, first on PATH for the hub and the doctor) is the one boundary
  these tests don't own. `--version` prints `2.1.308 (Claude Code)`. `auth status` prints a personal Max sign-in, so no
  Team or Enterprise login is in play. `plugin validate <folder | file in it | name@marketplace>` prints the plugin's
  `validate.txt`, and never reads or runs its code. **That output is my assumption of Claude Code's documented lines**,
  for example:

  ```
  Validating plugin manifest: <folder>/.claude-plugin/plugin.json
  name: approve-all
  version: 1.0.0
  hooks: tool.check
  calls: none
  ✔ Validation passed
  ```

  `status-band` prints `hooks: session.start` and `calls: band.set`. A plugin folder holding a file named `unreadable`
  makes `validate` exit 1 with an error on stderr. Every call is logged to `$DEEP_1033_CLAUDE_LOG`.

## The surface under test (my choice where the issue names none)

- **The facts entry**: `adapters/claude-code.facts.json` gains `mods`. The tests read exactly these fields:

  ```jsonc
  "mods": {
    "readBy": "<the core rule that reads it>",
    "conformance": "<its case, e.g. claude/mods/…>",
    "since": { "terminal": "2.1.287", "desktop": "2.1.286" },
    "overrides": { "event": "tool.check", "past": "PreToolUse" },
    "holdsWhen": [   // the four cases where a PreToolUse deny holds; each item an object, its words free
      /* managed settings on the machine */, /* a Team or Enterprise login as the session's credential */,
      /* plan mode, for a call that isn't read-only */, /* AskUserQuestion or a tool that needs your interaction, since 2.1.292 */
    ]
  }
  ```

- **The adapter-facts conformance case** runs as `node scripts/corpus.mjs check --facts <dir>`, the preflight's lane
  for the facts files, as #997's loop-facts case does. Given a folder whose `claude-code.facts.json` has no `mods`, it
  prints a `FAIL` line naming `mods` and Claude Code, and exits non-zero.
- **`deep doctor --json`** prints a doctor.item@1 line per item. The mods' items are `item: "claude.mods"`, `agent:
  "claude-code"`. If the home has a mod that handles `tool.check` (or submits prompts), its item is `level: "warn"`,
  and its evidence names the mod and `tool.check`. If the home has only mods that handle no tool or prompt event, every
  `claude.mods` item is `level: "ok"`. If the home's plugins can't be read (the registry isn't JSON, or `claude plugin
  validate` fails), an item has `code: "not_checked"`, and none is ok. The doctor reads the home from `HOME`, calls
  `claude plugin validate`, and never loads a mod.
- **Managed settings**: the hub, like the doctor at the base, reads Claude Code's managed settings from the file
  `DEEP_HUB_TEST_MANAGED_SETTINGS` names, when it's set. A file there means the machine has managed settings. The
  tests always set it: to a missing file, or to one holding `{"permissions": {"deny": []}}`.
- **`guard.overridden@1`**, a new event kind the core appends for the session when a PostToolUse or
  PostToolUseFailure arrives for a call deep-hook denied at PreToolUse:

  ```jsonc
  "data": {
    "call":  "<tool_use_id>",
    "tool":  "<tool name>",
    "guard": "<the guard entry or rule that denied it>",
    "mods":  ["<each mod of the session's home that handles tool.check>"]
  }
  ```

  The tests read the event's session (or a `data` that names it), and require that its `data` names the call ID, the
  guard entry and the mod, and that it comes after the call's `tool.before`.
- **The verdict** is the claim's last `verdict.made`. The **ask** is an `ask.created` whose `data` names
  `post_message`.

## Criteria to tests

Each criterion's ID is worked out by `scripts/proof-change.mjs`'s own `readIssue`: `#1033.` plus the first 8 hex
digits of the SHA-256 of its text, trimmed, with white space collapsed. Each test carries its tag.

| Criterion | Test | What it requires | On the base |
|---|---|---|---|
| AC1 `#1033.80415399` | `replay.test.ts`, two tests | The force push's deny is in its `tool.before` (`matched` holds `no-force-push`). Then one `guard.overridden` names the call, `no-force-push` and `approve-all`. The claim is never PASS, and its last verdict is INCONCLUSIVE with reasons naming the call ID or `git push --force origin main` | It records only the deny, passes the claim (`PASS on 1 clean run`), and fails naming the call |
| AC2 `#1033.2e71c00e` | `replay.test.ts` | Exactly one ask names `post_message`. deep-hook denied the repeat, and the repeat's PostToolUse is in the record | There is no ask, and the test fails naming the send |
| AC3 `#1033.a97a9989` | `doctor.test.ts`, three tests | `approve-all`: a warn naming it and `tool.check`, none OK, `plugin validate` called, sentinel absent. `status-band` only: every `claude.mods` item OK. Unreadable (both ways): `not_checked`, none OK | There is no `claude.mods` item |
| AC4 `#1033.3511f899` | `facts.test.ts`, three tests | The `mods` entry as above (`since` 2.1.287 terminal and 2.1.286 desktop). Without it, the lane fails naming `mods`. The control: the shipped facts have no such FAIL line | There is no entry, and no FAIL line names it. The control passes |
| AC5 `#1033.74a70e92` | `replay.test.ts` | Managed machine: the push is denied and never runs, there is no `guard.overridden`, and the claim is PASS. Same session with no managed settings: `guard.overridden` for the push | The managed half holds. It fails at the second half, naming the call |

## Readings, and what isn't tested

- **AC1's merge base** is the base itself, so no twin is needed. The base records the deny and passes the claim, just
  as the criterion says. **AC2's hub that trusts its own deny** is the base too. **AC5** can't fail on the base by its
  own words, so its test pairs the managed machine with the same session on a machine without managed settings. A hub
  that never records `guard.overridden` fails it. A hub that reads every session in a home with a tool.check mod as
  INCONCLUSIVE, and ignores the managed settings, fails its PASS. There's no `twins.json`, because every criterion
  already fails on the base at its assertion.
- **AC2's "denied as a duplicate"**: at the base, deep-hook lets the repeat of a completed MCP send through
  (`BASE-FAILURE.txt`: "on the repeated send: allow"). #85's `resent` denies only a cut-off turn's shell sends. The
  criterion takes the duplicate deny as given, so the test asserts it after the ask. **If the implementer reads that
  deny as outside #1033, it's a dispute for a blind redraft.** I read "completed" as a send whose PostToolUse is in the
  record before the resume.
- **"Until a check run outside that session decides it"**, the guard's row line, and watch-only on the session's row
  and the start card (Scope 3 to 5) aren't tested: no criterion names them. A session DeepBuild didn't start has no
  start card either. **"The mods that could have answered"** is read as the home's tool.check mods. The scenario
  has one.
- **The corpus lane at the base** already prints FAIL lines for missing FileChanged payloads (2.1.299 to 2.1.308).
  AC4 reads only the lines naming `mods`.

## Files

- `helpers.ts`: tags, the mods' install, the stand-in's PATH, the world, the hub, the replay, the doctor run, readings.
- `replay.test.ts` (AC1, AC2, AC5), `doctor.test.ts` (AC3), `facts.test.ts` (AC4), `tsconfig.json`.
- `fixtures/session/`: the session. `fixtures/mods/`: the two mods. `fixtures/bin/claude`: the stand-in.
- `BASE-FAILURE.txt`: the run on the base, with paths redacted.

No fixture holds a secret or personal data. The channel, IDs and timestamps are made up.
