# Acceptance tests for #236: the supervisor and the platform sandbox behind one seam, Seatbelt first

Written first, blind, from issue #236 (its text as of October 22, 2026: Scope, Fields, the 13 checkbox criteria,
Proof and Depends on #14, #16), the issues it names (#1, #29, #30, #36, #44, #59, #70, #104, #159, read for
scope only), `docs/technical-design.md` (One hub per user, a tiny hook client, and extensions in-process; How it
installs, its Platforms list; Threats, and what stops each one; Decided, the rows Grants and the sandbox and Ask
deadlines and defaults; the Event, Ask, Lease and Access primitives; the env-local row of First-party extensions;
Scale later, One host contract; How we know version 0 works, with Fault injection, Unknowns survive, Wrong
programs, Criteria to tests both ways and Dogfooding), `AGENTS.md`, the acceptance tests of #14, #16, #86 and
#318 for their conventions, and the base commit `33eaad3` (`origin/main`), by a job that never saw an
implementation of #236. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job.

The issue has 13 checkbox criteria, AC1 to AC13 in the body's order.

## How to run

On macOS (Seatbelt is the backend under test), with the repo's Node (`.node-version`, 24.22.0) and `cc` (the
Xcode command line tools):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub tests run the built CLI, packages/cli/dist/main.js
npx vitest run --root tests/acceptance/236 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/236/tsconfig.json   # needs packages/supervisor
```

- `--no-file-parallelism`: the files start real hubs and process trees, and the budget only means something
  with nothing else running.
- Nothing needs the network: every "host" is a listener the test runs on 127.0.0.1, every "hub's socket" and
  "inbox socket" a Unix socket listener the test runs, or a dev hub (`deep hub run --root`) the test starts.
- The probes are compiled once per test process from `fixtures/` with `cc` into `/tmp/dh236-bin-*`. A machine
  without `cc` fails every test that needs them as BLOCKED, naming the compile.
- Every test makes its folders under `/tmp/dh236-*` (real paths, short enough for a socket path; Seatbelt
  matches real paths), sets `HOME` to a temp folder for itself and every child, removes the agent's own
  `CLAUDE_*` and `DEEP_*` variables from its environment first (so no sandbox failure can ever reach a real
  inbox socket or hub), and never touches the real `~/.deepbuild`, launchd or a login service. It stops only
  processes it started or that its fixtures wrote a PID file for, by PID, after checking the PID still runs one
  of its programs (`helpers.ts`, `cleanup`); never by name or port.
- With `--root` here, Vitest writes its cache to `tests/acceptance/236/node_modules/.vite/`; delete that folder
  before committing.

## The surface under test

The issue names `host@1`, a supervisor in the hub, run tokens, a sandbox seam with backends, the seam's suite,
planted backends, cleanup outcomes and an unblock ask, but no code API. These tests define the smallest surface
that reaches every criterion, with the names the issue and the design already use:

1. **`@deepbuild/supervisor`, a new workspace package, through its public entry
   `packages/supervisor/src/index.ts`.** The design puts the supervisor in the hub's trusted ring and the sandbox
   behind "one interface each, with a version per platform", whose backends each pass the seam's own suite. A
   package of its own lets the hub (`run.start`), the checks (#30), environments (#36), the runner (#159) and,
   later, the Linux backend (#70) and R3's SSH host all reach the same seam, suite and `host@1` contract through
   one public entry, without importing the hub daemon. The hub imports it; it runs in the hub's process.
2. **The hub (#16)**, through `deep hub run --root`, its socket and the files under its root, as #16's tests
   reach it: `run.start` runs through the supervisor.
3. **The record (#14) and the asks core (#318)** as they are at the base: `openRecord`, `read`, `close`;
   `openAsks`, `tick`, `answer`, `needsYou`.

### `packages/supervisor/src/index.ts`

```ts
import type { RecordStore } from '@deepbuild/record';
import type { Asks } from '@deepbuild/asks';

// ---- The sandbox seam: one interface, a backend per platform (Seatbelt now; bubblewrap #70 and AppContainer later).
/** What a process may touch beyond the system's own runtime, each word enforced by the sandbox (Access). */
export interface Grant {
  read?: string[];     // absolute paths it may read, and run the programs in
  write?: string[];    // absolute paths it may read and write
  hosts?: string[];    // "<host>:<port>" the egress filter lets it connect to, e.g. "127.0.0.1:4100"
  sockets?: string[];  // absolute paths of the local sockets it may connect to
}
/** A process to start: what the supervisor would spawn. */
export interface Launch { argv: string[]; cwd: string; env: Record<string, string> }
export interface SandboxBackend {
  readonly name: string;                   // 'seatbelt'
  readonly platform: NodeJS.Platform;      // 'darwin'
  /** The launch that runs `launch` confined to `grant`: the folder `cwd` readable, nothing else beyond the grant. */
  confine(launch: Launch, grant: Grant): Promise<Launch>;
}
export const seatbelt: SandboxBackend;

/** The seam's own suite. Its fixtures are two listening Unix sockets the caller runs. */
export interface SuiteFixtures { hubSocket: string; inboxSocket: string }
export interface SuiteResult { backend: string; passed: boolean; cases: { name: string; ok: boolean; detail: string }[] }
export function sandboxSuite(backend: SandboxBackend, fixtures: SuiteFixtures): Promise<SuiteResult>;
/** The suite's broken fakes, each built for the fixtures it will be run with. */
export function plantedBackends(fixtures: SuiteFixtures): Record<'egress' | 'write-outside' | 'hub-socket' | 'camera', SandboxBackend>;

// ---- host@1: what every place that runs work does. The supervisor is its local implementation.
export interface StartSpec {
  run: string;                              // `run:<ULID>`, the caller's
  argv: string[];
  cwd: string;                              // the run's folder (absolute)
  env?: Record<string, string>;             // added to its environment; the supervisor adds the run token
  grant?: Grant;
  leases?: { kind: string; key?: string }[];   // no key: any free key of that kind's pool
}
export type Started =
  | { run: string; status: 'started'; pid: number; pgid: number; start: string; leases: { kind: string; key: string }[] }
  | { run: string; status: 'BLOCKED'; cause: 'resource'; kind: string };   // no key of the kind left
/** evidence: SHA-256 (hex) of the bytes the parent read from the process's stdout and stderr. */
export interface Exit { run: string; code: number | null; signal: NodeJS.Signals | null; evidence: { stdout: string; stderr: string } }
export interface HostFacts { host: string; platform: NodeJS.Platform; arch: string; cores: number; memory: number }
export interface Host {
  readonly name: string;                    // 'local'
  start(spec: StartSpec): Promise<Started>; // resolves once the process exists and is recorded, or BLOCKED; while held, it waits
  signal(run: string, signal: NodeJS.Signals): Promise<void>;   // its process group
  wait(run: string): Promise<Exit>;         // the started process's end
  facts(): Promise<HostFacts>;
}

// ---- The supervisor.
export interface ResourceStep { argv: string[]; cwd: string }   // run through the supervisor with DEEP_RESOURCE_KEY set
export interface ResourceKind {
  kind: string;                             // e.g. 'port', 'phone'
  keys: string[];                           // its pool
  release?: ResourceStep;                   // the cleanup step that gives a key back
  check?: ResourceStep;                     // the cleanup check: exit 0 when the key is clean
}
export interface Cleanup {
  run: string;
  outcome: 'clean' | 'unfinished';          // unfinished: something is left
  left: string[];                           // what's left, each naming it: "phone:+15550100", "pid:123"
  stopped: number[];                        // the PIDs it stopped
}
export interface RunStatus { run: string; state: 'held' | 'running' | 'exited' | 'cleaned' | 'BLOCKED'; on?: string[] }
export type Plant = 'sandbox-left-to-caller' | 'stops-token-bearing-group-members' | 'requires-token-in-group' | 'records-only-started' | 'hold-without-ask';
export interface SupervisorOptions {
  record: RecordStore;                      // ownership records, leases and denials go here, written as `core`
  asks: Asks;                               // the asks core it raises its unblock asks through
  now: () => number;                        // the clock of records and deadlines (waits and grace periods are real time)
  settings: { asks: { unblock: { deadline_ms: number } } };   // what your settings give an unblock ask
  resources?: ResourceKind[];
  plant?: Plant;                            // a planted wrong program (Wrong programs, below); tests only
}
export interface Supervisor extends Host {
  /** Stops every process the run owns that it can prove, releases its leases, runs their cleanup steps and checks. */
  cleanup(run: string): Promise<Cleanup>;
  status(run: string): Promise<RunStatus>;
  /** Reads what the record gained (an answer, a default) and acts on it. */
  tick(): Promise<void>;
  close(): Promise<void>;
}
/** Opens the supervisor on the record; before it resolves it reaps what the record says a crashed hub left behind. */
export function openSupervisor(options: SupervisorOptions): Promise<Supervisor>;
```

Nothing else is needed: no option, flag or export beyond these.

What the tests hold the surface to:

- **Every start is sandboxed.** There is no option on `StartSpec` or `SupervisorOptions` to choose or skip a
  sandbox: the supervisor picks the platform's backend itself (Seatbelt on macOS). The run's folder is readable,
  `grant.read` paths are readable and their programs runnable, `grant.write` paths writable, and the system's
  own runtime (`/usr`, `/bin`, `/System`, …) readable and runnable; everything else is denied by the sandbox with
  `EPERM` or `EACCES`, and so is every device, every local socket the grant doesn't name and every host it
  doesn't name. Children inherit it.
- **Run tokens.** Each started process gets `DEEP_RUN_TOKEN` in its environment and its own process group
  (`Started.pgid` is the started process's PID). The tests read the token's presence with `ps -E`, never its
  value.
- **Start times** are `ps -o lstart=` with `LC_ALL=C`, as the hub (#16) already reads them.
- **The suite's cases.** `sandboxSuite` returns at least these cases, by name: `egress` (a host the grant doesn't
  name), `write-outside`, `read-outside`, `hub-socket` and `inbox-socket` (the two fixtures), and `camera`,
  `microphone`, `audio-output` and `screen-capture` (a helper the sandboxed process spawns). It may hold more. Each
  planted backend fails its own case and no other of these; each is a real wrong program, not a name the suite
  knows (the tests probe each through its `confine`).

### Events the supervisor appends (writer `core`)

| Kind | Data the tests read | When |
|---|---|---|
| `process.tracked@1` | `run`, `pid`, `start` | a process the run owns, by ID and start time: the started one, and each one the fork watch sees appear |
| `process.ended@1` | `run`, `pid` | a tracked process proven gone |
| `sandbox.denied@1` | `run`, `operation` (names the operation, e.g. `file-write-create`), `target` (the path) | the sandbox refused something a run's process tried |
| `lease.acquired@1`, `lease.released@1` (the base's) | `resource.kind`, `resource.key` (`resource.host` is `local`) | a run's lease; released only after every process recorded for the run is proven gone |
| `ask.created@1` (the asks core's) | `kind: 'unblock'`, `deadline`, `default`, `options` | one per unfinished cleanup's hold |

Each is a published schema in `packages/contracts/schemas/` (the record refuses a kind it doesn't know). The
design's "each start is recorded before the process exists" may use the same kind without `pid`, or another
kind; the tests read only the records with `pid`. The cleanup outcome is recorded too (Unknowns survive); its
kind is the implementer's. The unblock ask needs its own row in `ask.sources@1` (`packages/asks/sources.json`),
kind `unblock`.

### The hub

- **`run.start`** (#16's method) takes two more optional params, `cwd` (the run's folder, absolute) and `grant`
  (a `Grant`), and starts the run through the supervisor, which sandboxes it. Its `run` is the `StartSpec.run`.
- **At start** the hub opens the supervisor on its ledger, which reaps what a crash left behind using only the
  ownership records in the event log: the test deletes every file under the root but `ledger.db*` and
  `evidence/` before the restart.
- **At stop** (SIGTERM) the hub signals each run still in flight through `host@1`.
- **`DEEP_HUB_TEST_HOST=<absolute path of an ES module>`** (test only): the module's default export takes the
  `local` host and returns a `Host`; the hub makes every start, signal and wait of its check runs through what it
  returns. The test's module logs each call and hands it on.
- **`DEEP_HUB_PLANT=run-spawns-itself`** (test only): a hub whose check runs spawn their process themselves.

## Criteria to tests

Each test's name starts with its criterion's number, and each `describe` carries the criterion's ID,
`#236.<first 8 hex of the SHA-256 of its text>` (trimmed, whitespace collapsed, `- [ ] ` dropped). A test headed
`(wrong program)` runs the same scenario against the planted twin the criterion names and expects it to fail as
the criterion says; the scenario itself must run, so a plant that doesn't start fails that test.

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#236.5dec450f` | a sandboxed piece's children get no devices | `devices.test.ts` (2): the piece and a helper it spawns, each device denied by the sandbox and not opened; the same with the app holding the permissions | the first fails (no package); the second is skipped INCONCLUSIVE where the app can't open every device outside the sandbox |
| AC2 `#236.0c11913d` | no hub socket, no inbox socket, no turn | `hub.test.ts` AC2 (1), through the hub's `run.start` | fails: the probe connects to the hub's socket |
| AC3 `#236.c43ad465` | undeclared read, write, network denied; digests by the parent | `contain.test.ts` AC3 (1) | fails (no package) |
| AC4 `#236.cc0de139` | a read-only job's undeclared write refused by the sandbox, recorded | `contain.test.ts` AC4 (1): a job's child writing outside what the job declared; `dependents.test.ts` AC4 (1): the runner's job (#159), now tested through `openRunner` | both fail (no package; no runner at this base) |
| AC5 `#236.6f5af6b7` | the suite fails the egress plant, naming egress; passes on Seatbelt | `suite.test.ts` AC5 (2) | fails (no package) |
| AC6 `#236.347ac606` | a caller with no sandbox of its own still gets one | `contain.test.ts` AC6 (2): the run; the wrong program | fails (no package) |
| AC7 `#236.61bc1ccd` | a decoy survives cleanup; a crash's leftovers are reaped on restart | `cleanup.test.ts` AC7 (1): the decoy; `hub.test.ts` AC7 (1): kill -9, restart from the record alone, decoy alive | both fail |
| AC8 `#236.d19f1cac` | sandbox setup adds under 300 ms per check, vs the merge base | `budgets.test.ts` AC8 (3): the perf lane's `sandbox-setup` task valid against the merge base; the bench runs; the number on the reference Mac | fails (no package); the number is skipped INCONCLUSIVE off the reference Mac |
| AC9 `#236.4e304926` | three more plants fail the suite, each naming its case | `suite.test.ts` AC9 (3) | fails (no package) |
| AC10 `#236.e12544e6` | setsid helper and bare helper both stopped; lease after both | `cleanup.test.ts` AC10 (3): the run; two wrong programs | fails (no package) |
| AC11 `#236.7688dfa8` | a late grandchild recorded when it appears and stopped | `cleanup.test.ts` AC11 (2): the run; the wrong program | fails (no package) |
| AC12 `#236.114db9d6` | unfinished cleanup holds the next run, one unblock ask, "I did it", deadline | `pool.test.ts` AC12 (3): "I did it"; past the deadline; the wrong program | fails (no package) |
| AC13 `#236.6e7cc737` | checks and environments only through `host@1`; a recording host | `host.test.ts` AC13 (1): `local` is `host@1`; `hub.test.ts` AC13 (2): the hub's check runs through a recording host, and its wrong program; `dependents.test.ts` AC13 (3): a command check (#30), an environment's stack (#36), a planted check kind, now tested through `runCommandCheck`, `deep env up`/`down` and `commandCheckKind` | all fail (no package; no command check kind or environments at this base) |

### How each criterion is read

- **AC1, devices.** "Denied by the sandbox" is read from the policy itself: `fixtures/devices.m` calls
  `sandbox_check()` (libSystem's `libsystem_sandbox`) on its own PID, without reporting, for `device-camera`,
  `device-microphone`, and the `mach-lookup` of the audio server (`com.apple.audio.audiohald`) and of the window
  server (`com.apple.windowserver.active`, which every screen capture goes through). That reads "deny" inside the
  sandbox and "allow" outside it on any Mac, whatever the OS's permissions say, so a TCC refusal can't pass for a
  sandbox denial. It also tries each device for real: the camera and the microphone through AVFoundation only
  when the OS already records permission (never a prompt), the audio output through an AudioQueue (no permission
  needed: outside the sandbox it opens, inside it fails), and a screen capture through CoreGraphics only when the
  OS already allows it. The first test runs on any Mac; the second, "with DeepBuild holding the permissions",
  runs only where the helper opens all four outside the sandbox, and is skipped INCONCLUSIVE elsewhere, naming
  what the app couldn't open. The piece is the started process; the helper is its child, spawned by the probe.
- **AC2.** The process is run by the hub's own supervisor (`run.start`), with the session's inbox socket (a
  listener of the test's) in `CLAUDE_CODE_MESSAGING_SOCKET`. "Never starts a turn": the inbox listener gets no
  connection and no byte, and the hub appends no `hook`-written event from it.
- **AC3.** Each kind of call outside the grant is paired with one inside it that must work, so a sandbox that
  refuses everything fails too. "Digests computed by the parent": `Exit.evidence` holds the SHA-256 of exactly the
  bytes the process wrote. That alone can't prove where the hash was computed; the parent is the only place the
  surface can compute it from (the process can't write the supervisor's result), and the mutation lane covers the
  rest.
- **AC4.** The supervisor's half: a job's child (its MCP server, say) writes into the job's own folder, which the
  job didn't declare writable; the sandbox refuses it with `EPERM` and the record gets `sandbox.denied` naming the
  run and the path within 15 s. The runner's half, a read-only job started by #159's runner whose MCP server
  writes outside what the job declared, is now tested in `dependents.test.ts` (What depends on other issues).
- **AC5, AC9, the suite and its plants.** The suite is the implementation's kit, and so are its broken fakes. So a
  suite that knows its plants by name can't pass: each plant must fail exactly its own case of the nine and pass
  the other eight, and the test then runs a probe of its own through the plant's `confine` and through
  Seatbelt's, showing the plant really lets that one thing through (a host no grant names; a write outside the
  declared paths; the hub socket fixture; a child's camera) while Seatbelt denies it.
- **AC6.** "A test caller that sets up no sandbox of its own": `StartSpec` has nothing to set one up with. The hub
  socket is a real dev hub's.
- **AC7.** The decoy is the same program in the run's folder, started by the test with no run token, in its own
  group. The crash test kills the hub with `kill -9`, deletes everything under its root but the ledger and the
  evidence, restarts it, and waits up to 15 s for each of the run's processes (the server, a `setsid` helper with
  the token, a bare helper in the group, a late grandchild in its own session) to be gone, while the decoy's four
  stay. The hub may run the check again after the restart (#16 AC3); the test watches only the old PIDs.
- **AC8.** "Sandbox setup per check" is the median time to start and wait for `/usr/bin/true` through the
  supervisor, minus the median for the same process spawned bare, over 20 rounds; five such runs after a warm-up,
  judged by the timing rule (PASS when all are under 300 ms, FAIL when all are over by more than the margin,
  otherwise INCONCLUSIVE). It counts only on a reference Mac (Mac15,7 or Mac15,12) on mains power, Low Power
  Mode off, no thermal warning; elsewhere it is skipped as INCONCLUSIVE, never passed. "Compared with the merge
  base" is the perf lane's: a task `sandbox-setup` in `benchmarks/budgets.json`, command
  `["node","benchmarks/sandbox.mjs"]`, with an `initialReason` naming #236 (the merge base has no sandbox), valid
  by `validateBudgets` against the merge base's file.
- **AC10.** The fixture's server forks helper `a` (calls `setsid`, keeps its environment) and helper `b` (execs
  `/bin/sleep` with an empty environment, staying in the group), waits until both wrote their PID files, and
  exits. The test checks the scenario formed as the criterion says (PPID 1 for both; `a` its own group with the
  token; `b` in the run's group without one) and fails BLOCKED if not. The run holds a port lease; "the lease ends
  only once both are gone" is read from the record: `lease.released` for it comes after `process.ended` for each.
- **AC11.** The grandchild writes its PID file, calls `setsid` and execs `/bin/sleep` with an empty environment.
  "Recorded when it appears": a `process.tracked` naming it and its start time within 3 s of its appearing,
  before any cleanup.
- **AC12.** The number is fictional (`+15550100`). The release step always fails (planted); the cleanup check
  passes once the number's marker file is gone. The deadline is the settings' (`asks.unblock.deadline_ms`, two
  days as Decided drafts it), checked as the ask's `deadline` against its `ts`; the default is the issue's, an
  option that takes the number out of its pool (its label says "pool"). "I did it" is an option labelled so,
  answered on the card (`app`); the supervisor's `tick` then runs the cleanup check again. The deadline passes on
  the test's clock, then `asks.tick()` and `sup.tick()`. The wrong program's failure names the number.
- **AC13.** Split in three: the supervisor is `host@1`'s `local` (`host.test.ts`); the hub's check runs go only
  through the host the harness puts in place (`hub.test.ts`, with `DEEP_HUB_TEST_HOST` and its wrong program);
  and the command check kind, the environment's stack and a planted check kind that spawns a child itself, now
  tested in `dependents.test.ts` (What depends on other issues).

## Wrong programs

Each criterion that names a wrong program has a planted twin, selected through the surface above:

| Plant | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| `plantedBackends(f).egress` | AC5 | lets a sandboxed process connect to a host its grant doesn't name | the suite fails `egress` |
| `plantedBackends(f)['write-outside']` | AC9 | allows a write outside the declared paths | the suite fails `write-outside` |
| `plantedBackends(f)['hub-socket']` | AC9 | allows a connect to `f.hubSocket` | the suite fails `hub-socket` |
| `plantedBackends(f).camera` | AC9 | lets a child open the camera (`device-camera` allowed) | the suite fails `camera` |
| `plant: 'sandbox-left-to-caller'` | AC6 | starts the process with no sandbox unless its caller sets one up | the hub's socket accepts the connection; the failure names it |
| `plant: 'stops-token-bearing-group-members'` | AC10 | stops only the members of the recorded group that carry the token | helper `a` keeps running; the failure names its PID |
| `plant: 'requires-token-in-group'` | AC10 | requires a token of every group member it stops | helper `b` keeps running; the failure names its PID |
| `plant: 'records-only-started'` | AC11 | records only the processes it started (no fork watch) | the grandchild keeps running; the failure names its PID |
| `plant: 'hold-without-ask'` | AC12 | holds the next run but raises no ask | the run still waits past the deadline; the failure names the number |
| `DEEP_HUB_PLANT=run-spawns-itself` | AC13 | the hub's check runs spawn their process themselves | the host's log has no start; the failure names the check |

The criteria that name no twin (AC1, AC2, AC3, AC4, AC7, AC8) fail on the base, which has no supervisor package
and a hub whose `run.start` spawns unsandboxed and reaps only through `runs.json` (BASE-FAILURE.txt); past that,
the mutation lane is their wrong program.

## What depends on other issues

These halves were BLOCKED in this job's first draft and are written, in its one redraft, against the surfaces the
dependency issues published (`dependents.test.ts`):

- **#159, the runner**: AC4's read-only job, started through `@deepbuild/runner`'s `openRunner` on the real
  record, asks core, budget ledger and supervisor. Claude Code is the boundary DeepBuild doesn't own, so its
  stand-in is #159's fake CLI (`tests/acceptance/159/fixtures/fake-claude.pl`), which starts the job's stdio MCP
  servers in its folder; the sign-in under the temp `HOME` is made up. The job's MCP server writes into the job's
  folder and into a folder nobody declared; each write must leave no file and be recorded as `sandbox.denied` with
  `run` the job's run (`JobRecord.job`), the path as `target` and a write as `operation`. The sandbox half through
  the supervisor alone stays in `contain.test.ts`.
- **#30, command checks**: AC13's command check, run with `runCommandCheck` once on `local` (the supervisor) and
  once through a recording `host@1` wrapping it. The recording must show the run's start and wait and nothing for
  another run, and outcome, tests run, failures, attempts, exit, output digests and evidence must be equal. The
  suite is one `node:test` file whose console report goes to `/dev/null` (it prints durations), so the digests can
  be compared. "Every start" is read from outside the host: while the check runs, the test lists every process whose
  command line holds the scenario's marker (the test file's name) and requires each one's process group to be the
  group of a start the recording shows.
- **The planted check kind** (AC13's wrong program): a `check.kind@1` fill built from `commandCheckKind(host)`
  whose `run` first runs the check's command itself, with `child_process`, then hands on to the honest kind. The
  same harness passes on `commandCheckKind` and must fail on the plant with "the check kind command-spawns-itself
  started a process the host's log doesn't show". Installing it in the hub through #349's extension slots isn't
  needed for this: the harness runs the fill directly, as the slot would.
- **#36 (#331), environments**: AC13's environment's stack, through a dev hub started with `DEEP_HUB_TEST_HOST`
  (a recording module like `hub.test.ts`'s, which also logs each start's group) and `deep env up` / `deep env down
  --root --json` in a folder whose `.deepbuild/done.yaml` runs a small Perl HTTP server on a leased `PORT`. The log
  must show the stack's run started, signalled and waited for, every marked process of the stack must be in a group
  a start names, and the stack must be gone after `down`.
- The hub's own check runs (`run.start`, #16's stand-in for them) are tested through the recording host in
  `hub.test.ts`.
- **#70, the Linux backend**, and Windows: not tested here; each runs the same `sandboxSuite` when it lands.
- **The reference Mac**: AC1's second test and AC8's number count only there (above).

With those halves tested, no criterion of #236 waits on another issue's surface. A PR still says `Closes #236`
only when every test passes, the reference-Mac readings (AC1's second test, AC8's number) included.

## Files

- `helpers.ts`: temp folders, the probes' build, PID files and `ps`, listeners, the hub as a process and its line
  protocol, the reference-Mac gate and the timing judge.
- `world.ts`: a record, the asks core and the supervisor opened on them, with a clock the test moves.
- `devices.test.ts` (AC1), `contain.test.ts` (AC3, AC4, AC6), `suite.test.ts` (AC5, AC9), `cleanup.test.ts`
  (AC7, AC10, AC11), `pool.test.ts` (AC12), `hub.test.ts` (AC2, AC7, AC13), `host.test.ts` (AC13),
  `budgets.test.ts` (AC8), `dependents.test.ts` (AC4's runner half; AC13's command check, environment and planted
  check kind; it replaced the first draft's `blocked.test.ts`, and builds Claude Code's stand-in from #159's
  `fixtures/fake-claude.pl`, its recording hosts and its process-table watch itself).
- `fixtures/probe.c` (tries reads, writes, connects and spawns, and writes what happened), `fixtures/tree.c` (the
  process trees of AC7, AC10 and AC11), `fixtures/devices.m` (AC1, AC9's camera).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
