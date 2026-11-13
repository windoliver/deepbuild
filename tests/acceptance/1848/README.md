# Acceptance tests for #1848: path guards read the paths an MCP tool call names

Written first, blind, from issue #1848 (Scope, the 3 checkbox criteria, Proof and Depends on, as handed to this job),
the design (`docs/technical-design.md`: [Before each command], [Threats, and what stops each one]; `AGENTS.md`) and
base commit `2ded12b8a`, by a job that never saw an implementation of #1848. The implementing agent does not edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

**Validated on the base:** both AC1 tests and the AC2 test fail at their named assertion (deep-hook allows the call);
AC3's test passes there; AC3's wrong program fails to build, since its cargo feature is the implementer's to add.
Typechecking passes. `BASE-FAILURE.txt` is the run's Vitest output, the checkout's absolute path replaced by
`<base-checkout>`.

## Sources read

- The issue as given: its Scope (four bullets), the three criteria, Proof (`crates/deep-hook/tests/cli.rs`, through the
  hook path and the check mode) and its dependency #316.
- The design: [Before each command] (the fast rules whose denial points to `deep_propose`, the guard engine, "an MCP
  call is guarded like any other tool call", "rules match what a call does", new or changed MCP tools waiting for your
  approval) and [Threats, and what stops each one].
- Base code, for its public surfaces only: `crates/deep-hook` (`main.rs`: `call`, the hook path, `check`, `match`;
  `matcher.rs`: how a `write:` or `read:` entry reads a path; `default-rules.json`; `Cargo.toml`'s plant features),
  `packages/hub/src` (`server.ts`'s reply and gate order, `holds.ts`'s MCP tool holds, `mcp-servers.ts`,
  `hookmap.ts`), `packages/cli/src/main.ts` (`deep inbox answer`), `adapters/mcp-servers.facts.json` and
  `adapters/claude-code.facts.json`, and `scripts/proof-change.mjs` for criterion IDs.
- The suites of #316, #304 and #1507 (deep-hook) and #321 (MCP tool approval) for their conventions. `helpers.ts` and
  both fixtures are copies adapted from #304's and #321's, never imports.

## How to run

With the repo's Node (`.node-version`, 24.22) and the Rust toolchain (`rust-toolchain.toml`) on `PATH`:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # warm the binary so a beforeAll doesn't time out under load
npx vitest run --root tests/acceptance/1848 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1848/tsconfig.json
```

- `--no-file-parallelism`: each file builds deep-hook with cargo, which replaces the binary in place. The files start
  hubs, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list beside #304's and #321's; the implementer
  adds it.
- Builds: `target/debug/deep-hook`, and the wrong program into `target/plant-every-string-a-path/debug/deep-hook`.
- Every world is a `/tmp/dh1848-*` folder (a socket path must fit in 104 bytes on macOS): HOME is `<tmp>/h`, the
  repository `<tmp>/repo`, outside HOME. No process touches the real `~/.deepbuild`, `~/.claude` or `~/.codex`. A child
  never inherits this process's billing keys or its `DEEP_*`, `GIT_*`, `XDG_*` or `CLAUDE*` settings.
- Only processes the suite started are stopped, by PID (`cleanup`, `stopHub`), never by name or port.
- No network, no model, no agent binary. No call is ever run: each is a PreToolUse payload deep-hook decides on, or a
  line of its check or match mode. The files server is only asked for its tool list, by the hub.

## The surface under test

- **The hook path**: `deep-hook claude-code PreToolUse`, the call's PreToolUse payload on stdin, `cwd` the repository,
  HOME the world's. A deny is exit 2 or a `permissionDecision` of `deny`; an allow is exit 0 with no deny (#316's
  reading). The denial's words are its stdout and stderr.
- **The check mode** (the Proof's): `deep-hook check`, `{"entry": <the shipped entry from default-rules.json>, "call":
  {tool_name, tool_input, cwd}}`, answering `{"matched": true}`.
- **The match mode** (Scope's fourth bullet): `deep-hook match`, one hook JSON line per call, its reply's `matched` and
  its hub-away `denials`.
- **The calls**: Claude Code names an MCP tool `mcp__<server>__<tool>`; the server here is `files`, its tools
  `write_file` and `read_file`, each taking `path` (and `content` for a write). No facts entry names `files`, so the
  general rule of Scope's first bullet applies, not a facts entry's argument list.
- **The entries**: the shipped defaults, `crates/deep-hook/default-rules.json` copied verbatim in as the first
  `rules.json` (as #304's suite seeds it). No test writes an entry of its own, so a pass shows that the real
  `no-deepbuild-spec-write` (`write:.deepbuild/* !~/.deepbuild/*`) and `no-control-token-read`
  (`read:~/.deepbuild/control.token`) catch the MCP call.

### What a denial must name (Scope's third bullet)

Each MCP denial asserted (hook path, match mode, hub up) must contain:

- the entry's name;
- the argument's name, `path` (or `content` for the wrong program), as a whole word; neither shipped entry's reason
  or next step holds either word;
- the path, as the call wrote it or resolved (worlds are made under resolved folders, so `<repo>/...` reads the same
  both ways; for the token, `~/.deepbuild/control.token` or `<home>/.deepbuild/control.token`);
- `deep_propose`, for `no-deepbuild-spec-write` only: its own denial points there (its `next_step`). The control
  token's own denial points elsewhere, so nothing is asserted of `deep_propose` there.

No wording beyond these is fixed.

### The hub stopped (AC1) and away (AC3)

AC1 starts a real `deep hub run` on the world's home, so `~/.deepbuild/control.token` exists, then stops it by its PID
(SIGTERM) before any call: nothing answers at the address. AC3 names no hub state; it starts none, so deep-hook's reader
alone decides. With the hub up, `write_file` would also wait on its MCP tool hold, which AC2 covers.

### The hub up and the tool approved (AC2)

"Approved once" uses the base's own surface for an MCP tool (#321, `holds.ts`): a change-class tool that isn't on a
server's first recorded list waits for your yes.

1. `files` is a stdio MCP server (`fixtures/mcp-server.mjs`, a stand-in for a third-party server, the only one) in your
   user-scope Claude Code config, `~/.claude.json`'s `mcpServers`.
2. A first session start records its tool list, `read_file` only.
3. An update adds `write_file`. The next session start holds it by one authority ask naming `files` and `write_file`.
4. Your yes: that ask's option whose decision is `allow`, through `deep inbox answer`, with the OS confirmation stubbed
   by `DEEP_HUB_TEST_CONFIRM`. Each session's hooks run as children of its own Claude Code stand-in
   (`fixtures/agent.mjs`), so the answer comes from outside every session's process tree, as your terminal does.
5. A `write_file` of `<repo>/src/a.ts` must then run (else BLOCKED): the approval took, and the hub decides.
6. The criterion's call, `write_file` of `<repo>/.deepbuild/done.yaml`, must be denied, the denial naming the above. The
   call's `tool.before` must be in the record and not marked late; a call deep-hook decided alone because the hub's
   acknowledgement came late is INCONCLUSIVE (a skip with the load reading), never a pass.

Transcripts carry the newest Claude Code version the facts cover, so no session is watch-only.

## The wrong program (AC3)

| Cargo feature (crates/deep-hook) | What it does | How AC3's test fails on it |
|---|---|---|
| `plant-every-string-a-path` | For an `mcp__<server>__<tool>` call, every string argument counts as a path the call reads and writes, whole, whatever it holds (spaces included), relative to the payload's `cwd` unless absolute or starting with `~/`, and a facts entry's argument list is ignored. All else is the real reader, its denials included. | The write whose `content` is `.deepbuild/done.yaml holds the definition of done; this note only mentions it.` is denied by `no-deepbuild-spec-write`: read whole against the cwd, or word by word, that string lies under `<repo>/.deepbuild/`. The test fails naming the argument `content`; the plant test also requires the plant's own denial to name `no-deepbuild-spec-write` and `content`. |

The test builds it with `cargo build --locked -q -p deep-hook --features plant-every-string-a-path --target-dir
target/plant-every-string-a-path`. Until the implementer adds the feature to `crates/deep-hook/Cargo.toml` (beside the
other `plant-*` features; no default build has it), that build fails and the plant test fails BLOCKED, never passes.
The base is the wrong program for AC1 and AC2: it allows each call.

## Criteria to tests

Each `describe` names its criterion's ID, `#1848.` and the first 8 hex of SHA-256 of the criterion's text, trimmed and
whitespace collapsed (`scripts/proof-change.mjs`). Each test's name starts with it.

| ID | Criterion (short) | Test | Base result |
|---|---|---|---|
| AC1 `#1848.9bf497c4` | hub stopped: `write_file` of `<repo>/.deepbuild/done.yaml` denied naming no-deepbuild-spec-write | `stopped.test.ts`: write_file test (hook path, check mode, match mode) | FAIL: deep-hook allowed it, exit 0, naming the call |
| AC1 `#1848.9bf497c4` | hub stopped: `read_file` of `~/.deepbuild/control.token` denied naming no-control-token-read | `stopped.test.ts`: read_file test (hook path, check mode, match mode) | FAIL: deep-hook allowed it, exit 0, naming the call |
| AC2 `#1848.9ca3511a` | hub up, tool approved once: the same write still denied naming no-deepbuild-spec-write | `approved.test.ts` | FAIL: after the real approval, deep-hook allowed it, exit 0 |
| AC3 `#1848.477a77d7` | `write_file` of `<repo>/src/a.ts` runs; a `content` sentence mentioning `.deepbuild/done.yaml` isn't denied for it | `sentence.test.ts`: first test (hook path, match mode) | PASS (the base reads no MCP argument) |
| AC3 `#1848.477a77d7` | a reader that counts every string as a path denies it and fails this test, naming the argument | `sentence.test.ts`: wrong program | FAIL BLOCKED: the feature doesn't exist yet |

## What the implementation must provide

- deep-hook reads an MCP call's path arguments in the hook path, the check mode and the match mode alike, and a denial
  of one names the argument, the path and the entry, with the hub up and with it away.
- The cargo feature `plant-every-string-a-path` in `crates/deep-hook/Cargo.toml`, as described above.
- No new environment variable or file. `adapters/mcp-servers.facts.json` is where Scope's second bullet lets a server
  name its path arguments; no criterion exercises that, so no test does.

## Not covered

- Scope's second bullet (a facts entry naming which arguments hold paths) has no criterion; not tested.
- Codex's and pi's own hook payloads aren't driven; the pi package's route is covered only through `deep-hook match`.
- `content` that is itself a path-like word with no whitespace is out of AC3's reach: the criterion names a sentence.

[Before each command]: ../../../docs/technical-design.md
[Threats, and what stops each one]: ../../../docs/technical-design.md
