# Acceptance tests for #104: hosting shells: the run-as-you permission

Written first, blind, from issue #104 ("Hosting shells: the run-as-you permission, and handoff later": its Scope, its
four acceptance criteria and its Proof line), the design sections it links and those they lean on, and base commit
`7d7eea3a` ("Merge pull request #838 from windoliver/feat/402-terminals"), by a job that never saw an implementation;
none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding).

The issue has four checkbox criteria, AC1 to AC4 in the body's order. Its "Later" scope item (handoff on update) and
its reading of how often agents build the sentence's package on the first try (#59's) are not criteria, and nothing
here tests them.

What was read:

- `docs/technical-design.md`:
  - Blocks for plug-ins that host something live (540, Run-as-you permission: "a piece that hosts shells asks for one
    plainly named permission: run any command you could. It's approved once on the trusted path, shown in Show what
    changed, and revocable at once. The supervisor still tracks every process the piece starts by run token, and stops
    them all when the permission goes. A narrower grant never implies it"; 541, Handoff on update (later); 542, Still
    off-limits: "Input to a terminal comes only from your focused panel, so no piece can let an agent type into another
    session"; 535, Raw input: "It comes only from you. An agent can't send it, and a panel without focus doesn't get
    it"; Stream and Canvas, "a terminal's extension parses output in its own process").
  - The extension-block table (475 Stream: never "losing output without saying so"; 479 Raw input: never "Sent by an
    agent"; 482 Run-as-you permission: "Capabilities, trusted path | None | Declared in the manifest | Granted by an
    agent, implied by a narrower grant, or left with a process the supervisor can't track").
  - Access (1025): run-as-you is enforced by the supervisor; "Every grant check for any other package sits in one small
    module, the capability membrane, and a test walks every method in the published extension API schema … calls each
    without its grant and requires a refusal that names the grant"; it can never "be granted by an agent".
  - Threats, the "Extensions that host shells" row (2366): "It gets that only through the plainly named run-as-you
    permission, approved on the trusted path and revocable at once, and the supervisor tracks and can stop every
    process it starts. Terminal input comes only from your focused panel, so no agent can type into a session through
    it."
  - How we know version 0 works, Live and interactive blocks (2501): "fixtures assert … that raw input never comes from
    an agent …, that a narrower grant never implies the run-as-you permission, and that revoking it stops every process
    the piece started".
  - Starting a session from the app (409): "A hosted terminal is held by a small host process the supervisor starts for
    it, so the session keeps running when the app quits or the hub restarts, and the hub reattaches when it starts";
    Platforms (2453): the terminal the hub hosts is "a pseudo-terminal from the platform … held by the supervisor's
    host process".
  - Add anything (403: the agent writes a package with "tests and a README"; "Before you see it, DeepBuild runs the
    conformance suite, the package's own tests …"), the API's acceptance sentences (423: "Host my agents' terminals in
    tabs and keep them running when I quit the app" uses "the stream, canvas, raw input and run-as-you blocks"; "What
    passes or fails is one recorded package …: it passes conformance and its sentence's own checks, and the same
    package with a planted fault is refused"), The app extends itself (419, Show what changed).
  - The budget rules (2418: "measured on a reference Mac by a benchmark in the local preflight, and compared with the
    merge base"; five runs after warm-up, the margin, INCONCLUSIVE otherwise) and the reference Macs (2420).
  - Dogfooding (2518) and Tests written first (2549); AGENTS.md's four invariants.
- `docs/canvas-primitives.md`: Input router, focus and gesture serial ("keys go only to the focused panel", "agents
  never hold one"), for AC3's reading only.
- At the base: AGENTS.md; `tests/acceptance/236/`, `348/`, `350/`, `401/` and `402/` (README, helpers, budgets, fixtures,
  planted values, BASE-FAILURE); `packages/supervisor` (host@1, `Grant.run_as_you`, Seatbelt's run-as-you profile,
  `cleanup`, the reap at open), `packages/extension-host` (`src/host.ts`: install, check, load, the membrane in
  `dispatchNow`, `capability.refused`, `trustKey`'s trusted-path rule, `callAction`, `runCheck`, `close`;
  `runtime/deep.mjs`: `API` and the `deep` object built from it; `runtime/runner.mjs`), `packages/contracts`
  (`extension.manifest@1`, `access@1`, `checkManifest`), `packages/record`, `packages/hub/src/core.ts` (how the hub
  loads extensions and its `RUN_AS_YOU` grant for runs), `crates/deep-show/src/serve.rs` (#402's PTYs and raw input),
  `scripts/lanes.mjs`, `scripts/benchmark.mjs`, `benchmarks/budgets.json`.

What the base already does and these tests don't credit: `access@1` and `extension.manifest@1` already list the word
`run_as_you`; the supervisor's `Grant` has `run_as_you` and Seatbelt's profile for it (your files and programs, a
pseudo-terminal), and the hub gives it to `run.start` runs that name no grant; the membrane refuses a call whose
method needs a grant the manifest lacks, recording `capability.refused`; the supervisor tracks a sandboxed run's every
process by its marker and stops them at `cleanup`; `deep-show serve` (#402) runs programs on PTYs and refuses raw input
from an agent's session. None of it reaches a piece: the extension API has no way to run a command, so no piece can
host a terminal, nothing asks for or records your approval of run-as-you, nothing revokes it, `close` stops every
process a package started, and `extension.manifest@1` refuses a `host` field (`unlisted_field`).

## Run them

On macOS (Seatbelt is the sandbox under test), with the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the supervisor's native helper (packages/supervisor/dist/helper)
npx vitest run --root tests/acceptance/104 --no-file-parallelism
npx tsc -p tests/acceptance/104/tsconfig.json   # type-checks once the surface below exists
```

- `--no-file-parallelism`: the files start sandboxed packages and real process trees, quit and relaunch the hub side,
  and time CPU and memory. `scripts/lanes.mjs` needs `tests/acceptance/104/` in its one-at-a-time list (`alone`) beside
  `348/` and `402/`; this README is the instruction, and the implementer makes that edit.
- The environment: `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment and
  points `HOME` at a temp folder, so nothing touches the real `~/.deepbuild`. No network, no model, no real `claude` or
  `codex` binary: every terminal runs `/bin/sh` or a Node script the tests write.
- Temp folders: every package, record, home and program folder is under `/tmp/dh104-*`, removed after its file.
- Processes are stopped only by PID: ones a test's own programs noted (each writes its PID to a file) or ones the
  supervisor recorded as `process.tracked@1` in a record the test made, each only while it still has the start time
  first seen or recorded for it. Never by name or port. Terminals that live past the app outlive a host's `close` by
  design, so after each file the helpers stop what a failed test left running.
- With `--root` here, Vitest may write its cache under `tests/acceptance/104/node_modules/.vite/`; delete it.
- `budgets.test.ts`'s CPU and memory tests take about ten minutes and count only on a reference Mac (Mac15,7 or
  Mac15,12) on mains power, Low Power Mode off, thermal state nominal and a 1-minute load no higher than its core
  count; anywhere else they fail with a message starting `INCONCLUSIVE:`. They never pass, and never skip, on a
  reading they can't trust.

`BASE-FAILURE.txt` is the run at the base: every test fails, each for the reason it lists.

Nothing missing passes (invariant 2): a step a scenario needs that doesn't run (an install, a load, an approved
command) throws and fails the test, naming it; a wrong-program test whose scenario can't reach its plant fails too.

## The surface under test

The issue names a permission, a manifest declaration of the host process, the supervisor's tracking and a revoke, but
no code API. These tests extend the existing public entries in their own style: the extension manifest
(`extension.manifest@1` through `checkManifest`), the extension API schema (`EXTENSION_API`, the `deep` object), and
`ExtensionHost` from `packages/extension-host/src/index.ts` (#348), on a real record, a real supervisor (#236) with
Seatbelt, and real processes. Nothing else is needed: no new package, option, flag or export beyond what is below.

### The manifest

```jsonc
{
  "access": { "words": ["run_as_you"] },                                  // the word access@1 already lists
  "host": { "runs": "terminals", "lives": "past_app", "owns": ["terminals"] }
}
```

- `host` declares the piece's host process: what it runs (`terminals`: programs, each on a pseudo-terminal the host
  process holds), how long it lives (`past_app`: past the app quitting and the hub restarting, until run-as-you is
  revoked), and what it owns (`terminals`: they are the piece's, listed and stopped with it). `checkManifest` (and so
  install and `check`) accepts this object; these are the only values the tests use. A manifest with `host` and
  without `run_as_you` still passes `checkManifest`: such a package installs and loads, and its first command is
  refused (AC1).

### The extension API: three methods, each needing `run_as_you`

`EXTENSION_API` lists each with `needs: 'run_as_you'`, so the `deep` object has them and the membrane refuses each,
before anything else of the call, with its existing message `<method> needs the grant "run_as_you", which <id> wasn't
given`, and records `capability.refused` (written as `ext:<id>`, `data.call` the method, `data.clause` naming
`run_as_you`, as for every grant):

- **`deep.terminal.open({argv, cwd, env?, cols, rows, title})`** → `{terminal: string, run: string, pid: number}`.
  The hub runs `argv` as you (the supervisor's grant `{run_as_you: true}`, in the platform sandbox all the same) on a
  pseudo-terminal of `cols` × `rows`, held by a small host process the supervisor starts, under a run token. `run` is
  the supervisor run that owns the terminal: its host process and the program, each recorded as `process.tracked@1`
  for `run`, and everything they start; `pid` is the program's own PID.
- **`deep.terminal.list()`** → `[{terminal, run, pid, title}]`: the piece's open terminals, those opened before the
  app quit or the hub restarted among them.
- **`deep.terminal.read(terminal, from)`** → `{text: string, next: number}`: what the terminal's program wrote, as
  UTF-8, from byte offset `from` (0 is the first byte it wrote) to `next`. Nothing is lost while the hub is down: a
  reattached terminal's output still reads from 0 with no gap (the stream never loses output without saying so). The
  tests read at most a few hundred KiB per terminal.

There is no method that writes a terminal's input. A command counts as the piece's when the piece's call made it,
including one made while serving an action call or a check run.

### `ExtensionHost`: three methods, and `close`

```ts
/** Your yes on the trusted path (writer `app`, or `cli` once the OS confirms you): the package may use run-as-you,
 *  which its manifest asks for. Kept across a restart; any other writer is refused. Approved once: no later launch asks. */
approve(connection: Connection, id: string, word: 'run_as_you'): Promise<void>;
/** Takes run-as-you back at once (writer `app` or `cli`): resolves once every process the package started through it
 *  (each terminal's host process, program and everything they started, whenever it was started) is stopped; from then
 *  on the package's terminal methods are refused naming run_as_you, and it stays loaded. */
revoke(connection: Connection, id: string, word: 'run_as_you'): Promise<void>;
/** Raw input for a hosted terminal: its text, as UTF-8, written to the program's terminal. Taken only from the app
 *  (writer `app`, which delivers only the raw input of the panel you focused, #401/#402); from any other connection
 *  it is refused, throwing an error that names the connection's writer and, when it has one, its session; nothing
 *  reaches the program. */
rawInput(connection: Connection, terminal: string, text: string): Promise<void>;
```

- **`close()`** still stops every process the host started, except the terminals of a package whose manifest's `host`
  lives `past_app` and whose run-as-you stands: their host processes and programs keep running.
- **A later launch** (a new record handle, a new `openSupervisor` and a new `openExtensionHost` on the same ledger file
  and home) doesn't reap those runs; once the package loads again, `deep.terminal.list()` lists them with the same
  `terminal`, `run` and `pid`, `deep.terminal.read` continues their output, `revoke` stops them, and run-as-you needs
  no new approval.
- `Plant` gains the six values in the table below.

### The fixture package and its own tests

`fixtures/agent-terminals/` is the package built from the sentence: its manifest (`run_as_you`, `host`, one panel in
a tab, three actions, two check kinds), `index.ts` (as `index.ts.fixture`, renamed when the tests copy it) and a
README. Its actions: `ext.agent-terminals.open` ({argv, cwd, title} → `{opened: {terminal, run, pid}}` or
`{refused: the host's message}`), `ext.agent-terminals.tabs` (→ `{tabs: [{terminal, title, pid, run}]}`, from
`deep.terminal.list()`) and `ext.agent-terminals.read` ({terminal, from} → `{text, next}`). Its own tests are its check
kinds, run by `host.runCheck` like any check (each reports `passed` with the tests it counted, or `failed` naming why):
`ext.agent-terminals.hosts` opens a `heartbeat` terminal (a shell printing `beat N` every 0.1 s) and passes once its
tab shows three beats in order; `ext.agent-terminals.shows_again`, run at a later launch, passes when its tabs show the
heartbeat exactly once, its output holds every beat from 1 with no gap or repeat, and at least 5 more come within
1.5 s. `fixtures/relay/` is AC3's piece: run-as-you, an `open` action like the above, and `ext.relay.type`
({terminal, text}), declared a read so an agent's call runs it, which calls every `deep.terminal.write`, `.input`,
`.send`, `.type`, `.rawInput`, `deep.rawInput` and `deep.input` its `deep` has with that terminal and text.

### Programs the terminals run

Written by `helpers.ts` into the test's folder and run with `process.execPath`: a **counter** (`tick N` every 50 ms,
its count in a file; it ends with its terminal), a **tree** (the program, a child in its group, a grandchild that calls
setsid, an orphan reparented to launchd, and a child that ignores SIGTERM, SIGHUP and SIGINT, each noting its PID), a
**reader** (#402's: raw mode, logs every byte it reads), a **paced** writer (line k at start + (k − 1)/60 s, or the
same schedule writing nothing) and a **filler** (10,000 numbered lines, then idle). AC2 also runs `/bin/sh` ignoring
SIGHUP and SIGTERM with a background `sleep`, which inherits that.

### Connections

`YOU` is `{writer: 'app', actor: 'you', scope: 'you'}` (the app, your trusted path). The agent's connections are an MCP
server's `{writer: 'mcp', session, agent}` (as #351's tests write it), a hook's `{writer: 'hook', session, agent}`, a
`deep` command in an agent's process tree `{writer: 'cli', session, agent}`, and a piece's own `{writer:
'ext:test/relay'}`.

## Planted programs

Each is a `Plant` value of `openExtensionHost`, reachable only from tests, there to prove a test fails on a wrong
program; every test headed `(wrong program)` runs the same scenario on it and asserts the failure names what its
criterion says.

| Value | The wrong program | Test |
|---|---|---|
| `close-stops-every-host` | `close` stops a `past_app` piece's terminals too (the base's behavior) | AC1: fails naming the counter terminal's program, stopped when the app quit |
| `narrower-grant-implies-run-as-you` | a manifest whose words hold `files` or `programs` gets run-as-you | AC1: fails naming the narrower copy whose first command ran |
| `revoke-keeps-running` | `revoke` only refuses later commands; what runs keeps running | AC2: fails naming the tree's program still running |
| `revoke-stops-programs-only` | `revoke` stops each terminal's program, and nothing it started | AC2: fails naming the setsid grandchild and the orphan, and not the program |
| `input-from-any-writer` | `rawInput` takes text from any connection | AC3: fails naming the agent's MCP session whose text the program read |
| `piece-writes-input` | the API also offers `deep.terminal.write(terminal, text)`, which writes the program's input | AC3: fails naming the agent session the piece typed for |

## Criteria to tests

Each test's name starts with its criterion's ID.

| ID | Criterion | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | The sentence's package installs with run-as-you and passes its own tests: its terminals keep running after the app quits, and its tabs show them again at the next launch; its copy without run-as-you is refused at its first command, naming the permission | `install.test.ts`: the package, built by an agent session, installs, passes conformance (`check`), is approved once on the trusted path and loads; its own test `hosts` passes; a counter terminal opens (the hub's `pid` is the program's own, and the supervisor recorded it under the terminal's `run`); the app quits (host, supervisor and record close); for 2 s both terminals' programs run on, the same processes, and the counter keeps counting; at the next launch on the same files, with no new approval, its tabs show the same two terminals with the same PIDs, its own test `shows_again` passes, and the counter's tab holds every tick from 1, once, in order, through ticks written after the launch. Fails on `close-stops-every-host`. Then two copies, one with no access words and one with only `files`, `programs` and `record` (and a record grant, and your yes to `run_as_you` tried anyway): each installs and loads, its first command is refused with the host's message naming `run_as_you`, `capability.refused` names it, and its program never starts; `EXTENSION_API` lists the three terminal methods needing `run_as_you`. Fails on `narrower-grant-implies-run-as-you` |
| AC2 | Revoking run-as-you stops every process the piece started | `revoke.test.ts`: two terminals (the tree; a shell ignoring HUP and TERM with a background sleep) and a decoy tree the suite starts itself; when your revoke resolves, all seven of the piece's processes are gone, the decoy's five all run, and the piece's next command is refused naming `run_as_you`; the same with the app quit and launched again between opening and revoking. Fails on `revoke-keeps-running` and `revoke-stops-programs-only` |
| AC3 | No agent can type into a hosted terminal | `input.test.ts`: a reader in a hosted terminal reads your text from the app (the control); raw input from an agent's MCP server, its hooks, a `deep` command in its tree and a piece is refused, each refusal naming the writer (and the session), and the program reads none of it. An agent's call of the relay piece's `type` action, which tries every input method its `deep` has, gets nothing to the program. Fails on `input-from-any-writer` and `piece-writes-input` |
| AC4 | Budgets on the reference Mac, compared with the merge base: a hosted terminal keeps up at 60 updates a second under 5% of a core, and 10 terminals stay under 300 MB | `budgets.test.ts`: 600 lines at 60 a second through a hosted terminal: all 600 in its output, in order, 250 ms after the last is written; the hosting's CPU (the terminal run's processes but the program, plus this process) less the same schedule writing nothing, over 10 s, five runs after a warm-up, each within 0.05 of a core. 10 hosted terminals, each holding 10,000 lines of scrollback: the resident memory of their runs' processes but the programs, plus what this process grew by, five runs, each within 300 MiB. Both INCONCLUSIVE off a fit reference Mac. The perf lane has `hosted-terminal-60hz` and `hosted-terminals-10`, each naming #104 in its `initialReason`, valid against the merge base's `benchmarks/budgets.json` (`validateBudgets`) |

The proof line ("the plug-in that hosts your agents' terminals, built from one sentence, and the revoke test") is
`install.test.ts` with `fixtures/agent-terminals/`, and `revoke.test.ts`.

## Readings where the issue and design leave a choice

- **"The app quits."** The hub, not the app, holds the extension host, so the app quitting alone can't stop a piece's
  terminals unless they belong to the app or to the hub's own process. The tests take the strongest case the hub side
  can show: the extension host, the supervisor and the record all close, as when the hub restarts with the app ("keeps
  running when the app quits or the hub restarts, and the hub reattaches when it starts"). "The next launch" is a new
  record handle, supervisor and extension host on the same files, each installed package checked if it has no kept
  result, then loaded.
- **"Its tabs show them again"** is read from the piece's own tabs action (`deep.terminal.list()`) and its output
  (`deep.terminal.read`), checked against the programs' own notes: the same terminal IDs and PIDs, the same processes
  (by start time), and their output whole from the first byte.
- **"Passes its own tests."** A package's own tests are check kinds of its own, run by `runCheck`, as a sentence's own
  checks (design 423). Their passing is not taken on its word alone: the suite checks the same things itself.
- **"Installs with run-as-you"**: the manifest asks for the word and you approve it once with `approve` on the trusted
  path. Approval is a call of its own, like `trustKey`, rather than `InstallFrom.grant`, since an install's grant is
  what any caller passes and run-as-you can never be granted by an agent.
- **"Refused at its first command, naming the permission"**: the first `deep.terminal.open`, refused by the membrane
  with the message that names `run_as_you` and recorded in `capability.refused`; the program never starts. "A narrower
  grant never implies it" is read by the second copy: `files`, `programs` and `record` asked for, a record grant given
  and your yes to `run_as_you` tried, none of which grants it.
- **"Stops every process the piece started"**: everything the piece's terminals ran, read from the PIDs the programs
  noted themselves (never from the piece's or the hub's word), including a setsid grandchild, an orphan reparented to
  launchd and processes that ignore SIGTERM; a zombie counts as stopped. Processes the piece didn't start (the decoy)
  keep running. A revoke resolves only once they are stopped ("at once"), and the permission is gone: the next command
  is refused.
- **"No agent can type into a hosted terminal"**: raw input reaches a hosted terminal only through the hub from the
  app, which takes your focused panel's raw input (#401, #402 test the router); every other writer is refused, and the
  extension API holds no method that writes a terminal's input, so no piece can relay an agent's text.
- **"Keeps up at 60 updates a second under 5% of a core"**: one line every 1/60 s for 10 s; the hosting is everything
  the supervisor runs for the terminal but the program, plus the hub side (this process); the baseline is the same
  schedule with no output, so the share is what the updates cost. "Keeps up" is all 600 lines in the output 250 ms
  after the last one's write. **"10 terminals stay under 300 MB"**: ten idle terminals each holding 10,000 lines of
  scrollback; the programs' own memory is not the terminal's.
- **"Compared with the merge base"**: as #402's AC1 and AC4, the perf lane's tasks validated against the merge base's
  `benchmarks/budgets.json`; the base has no hosted terminal to time.

## Not tested, and why

- Handoff on update (the issue's "Later"), and the first-try build reading (#59's): neither is a criterion.
- "Shown in Show what changed": in the Scope, but no criterion names it; the app's title-bar switch isn't in these
  surfaces.
- An agent's own `approve` refused: the design forbids it, and `approve`'s contract above says so, but no criterion
  names it.
- The panel drawing a hosted terminal's cell grid and its focus routing: #402's and #401's tests.
- `host.lives` values other than `past_app`.

## The Oracle lane

The issue names no upstream test; run-as-you, its revoke and the input rule are this design's own, so nothing upstream
is ported and these tests are the local proof for every criterion.
