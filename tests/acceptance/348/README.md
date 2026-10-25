# Acceptance tests for #348: the extension host

Written first, blind, by a job that never saw an implementation of #348. It read:

- issue #348 as of October 24, 2026: its Scope, its 11 checkbox criteria, the 12th moved here from #16 (the
  owner's comment), and "Added Oct 9"
- the issues it depends on (#13, #16, #236) and those that build on it (#349, #44), for scope only
- `docs/technical-design.md`: Extension API, the component table, Threats (Malicious extensions, Untrusted repos),
  the Decided row "Grants and the sandbox", the record's core-only kinds, the budget rule and the reference Macs
- `AGENTS.md`
- the acceptance tests of #236, #314 and #30, for their conventions
- the existing packages the host builds on: `supervisor` (host@1, grants, Seatbelt), `record`, `asks`,
  `conformance`, `contracts` (extension.manifest@1, access@1, `checkManifest`)
- the base commit `8b98570`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

The issue has 12 checkbox criteria, AC1 to AC12: the body's 11 in order, then the one moved from #16.

## How to run

On macOS, with the repo's Node (24.22.0) and a python3 on PATH:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the bench may run built code
node node_modules/vitest/vitest.mjs run --root tests/acceptance/348 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/348/tsconfig.json   # needs packages/extension-host
```

- **`--no-file-parallelism`:** the files start sandboxed processes through the supervisor, read listeners with
  `lsof`, and AC8's number only means something with nothing else running.
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment
  and points `HOME` at a temp folder, so nothing touches the real `~/.deepbuild`.
- **Temp folders:** every package, repo, record and home is under `/tmp/dh348-*`, a real path, removed after its
  file. Every host a test opens is closed after its file, which stops what it started; nothing is stopped by name
  or port.
- **No network:** the only listener is the one AC12 turns on, on 127.0.0.1.
- **Missing tools fail, never skip.** AC4 fails `BLOCKED` when no python3 is on PATH. This Mac has one.

## The surface under test

The issue names no module. This job defines the smallest surface, in a new package
`packages/extension-host` with its public entry `src/index.ts`, using names the issue and the design already use:
the extension host, the extension API, the signed release, project trust, the platform sandbox, conformance, a
grant, the host's kit, a plug-in you turned on, routes. The tests reach the host only through this entry.

### `packages/extension-host/src/index.ts`

```ts
import type { CheckResult, CheckSpec } from '@deepbuild/conformance';
import type { Connection, RecordStore } from '@deepbuild/record';
import type { Supervisor } from '@deepbuild/supervisor';

/** One method of the extension API, as its schema lists it: `deep.`-prefixed, and the grant (an access word) a call needs, or null. */
export interface ApiMethod { method: string; needs: string | null }
/** The extension API schema: every method an extension can call. */
export const EXTENSION_API: readonly ApiMethod[];

/** A package inside DeepBuild's signed release, as the release's signed manifest lists it. */
export interface ReleaseEntry { id: string; version: string; digest: string }

/** A package folder's digest, computed by the parent over every file with its mode; writing it into deepbuild.json's `digest` doesn't change it. */
export function packageDigest(folder: string): string;

/** Project trust: one decision kind the core holds in the record. */
export interface ProjectTrust {
  trusted(project: string): Promise<boolean>;                                    // false with no decision
  answer(connection: Connection, project: string, trusted: boolean): Promise<void>; // your one answer, on the trusted path
}
export function openTrust(options: { record: RecordStore; now: () => number }): Promise<ProjectTrust>;

/** The planted wrong programs the criteria name, selected per host; tests only. */
export type Plant = 'hub-unless-agent-built' | 'grants-only-in-record-query' | 'first-party-appends-every-kind';

export interface ExtensionHostOptions {
  record: RecordStore;
  supervisor: Supervisor;     // every out-of-process extension starts through it, in the platform sandbox (#236)
  trust: ProjectTrust;
  home: string;               // your ~/.deepbuild; extensions install at user level under it, pinned to a version
  release: ReleaseEntry[];    // DeepBuild's signed release
  now: () => number;
  plant?: Plant;
}
export interface InstallFrom {
  from: string;               // the package folder
  builtBy: string | null;     // the agent session (`session:<ULID>`) that built or changed it, or null when no agent wrote it
  project?: string;           // a project's extension: the repo folder it comes with
  grant?: { record?: string[] };  // what you approved: the event kinds of the record it may read
}
export interface Installed { id: string; version: string; folder: string; digest: string; builtBy: string | null; project: string | null }
export interface Conformance { id: string; version: string; digest: string; passed: boolean; reasons: string[] }
export interface Loaded { status: 'loaded'; id: string; version: string; place: 'hub' | 'sandbox'; run: string | null }
export interface Refused { status: 'refused'; id: string; version: string; reason: string }
export type Load = Loaded | Refused;

export interface ExtensionHost {
  install(from: InstallFrom): Promise<Installed>;
  installed(): Promise<Installed[]>;           // kept across a restart (a new host on the same home and record)
  check(pkg: Installed): Promise<Conformance>; // runs its conformance tests on its files now, kept for that digest
  load(pkg: Installed): Promise<Load>;
  loaded(): Promise<Loaded[]>;
  checks(): Promise<{ kind: string; extension: string }[]>;   // check kinds registered by loaded extensions
  runCheck(kind: string, spec: CheckSpec, ctx: { checkout: string; deadline: number }): Promise<CheckResult>;
  ready(): Promise<void>;                      // the hub is ready: its socket listens and its replay is done
  turnOn(id: string, routes: string[]): Promise<{ address: string }>;  // "<METHOD> <path>" routes you chose
  turnOff(id: string): Promise<void>;
  close(): Promise<void>;                      // stops every process it started
}
export function openExtensionHost(options: ExtensionHostOptions): Promise<ExtensionHost>;

/** The extension host's kit: planted extensions, each a case the host must handle. */
export interface HostKitCase { id: string; rule: string; firstParty: boolean; extension: string /* the package folder */ }
export interface HostKit { cases: HostKitCase[] }
export interface HostKitReport { verdict: 'PASS' | 'FAIL'; cases: { id: string; outcome: 'PASS' | 'FAIL'; message: string }[] }
export function hostKit(): HostKit;
/** `open` gives a fresh host whose release lists `release` (the kit's first-party packages), and its record. */
export function runHostKit(kit: HostKit, open: (release: ReleaseEntry[]) => Promise<{ host: ExtensionHost; record: RecordStore }>): Promise<HostKitReport>;
```

The kit must hold a case with the ID `first-party-decision-kinds`: AC11's planted first-party extension.

### A package

- `deepbuild.json`: its extension.manifest@1 (#314's contract; `checkManifest` holds it).
- TypeScript: `index.ts`, whose default export takes `deep`. It may import Node's built-in modules and read its
  own folder.
- Any other language: `main`, an executable file run with no arguments, speaking JSON-RPC on stdio. How the host
  lets its interpreter run in the sandbox is the host's own choice, so long as the package gets nothing beyond it.

### The `deep` object

Each schema method `deep.a.b` is `deep.a.b(...)`. The tests rely on these shapes:

- `deep.registerCheck(type, runner)`: `runner(spec, ctx)` returns a `CheckResult`; `host.runCheck` calls it.
- `deep.record.append(event)`: an `EventInput` (`{v, id, kind, ts, data}`); the writer is the extension, never `core`.
- `deep.record.query(filter)`: `filter` is `{ kinds?: string[] }`; it returns events, each with its `kind`.
- `deep.registerRoute(route, handler)`: `route` is `"<METHOD> <path>"`; `handler({ method, path, headers, body })`
  returns `{ status, body }`. Registering opens nothing.
- Every call that needs a grant the package lacks is refused before any other check of its arguments, with an
  error that names the method and the grant.

### The JSON-RPC wire

JSON-RPC 2.0, one JSON object per line, both ways. Each side numbers its own requests: a line with `method` is a
request to the reader, and a line with `result` or `error` answers the reader's own request with that `id`.

1. The host sends `{"method": "load", "params": {}}`.
2. The extension makes its calls as requests named for the API method, its arguments positional, a function left
   out: `{"method": "deep.registerCheck", "params": ["ext.pycheck.lint"]}`. The host answers each.
3. The extension answers `load` with `null` once it has registered.
4. The host calls what was registered as requests: `{"method": "run", "params": {"type", "spec", "ctx"}}` for a
   check runner, answered with the `CheckResult`.

## Readings

- **Conformance (AC1, AC7).** The issue says only "conformance tests must pass before an extension loads". Read as
  the host's `check`, run before any load:
  - the manifest contract (`checkManifest`)
  - the package's code registering in the platform sandbox without throwing
  - each check kind it registers being one its manifest declares
  Its result is kept for the digest the files had when it ran. `load` refuses a package with no passing result for
  its files' digest now. A slot's own kit at install (`check.kind@1` for a check runner) is #349's criterion and
  isn't tested here.
- **"The reason is shown" (AC1).** Read as the refusal's `reason`, and `check`'s `reasons`, naming what failed.
  Recording refusals is #350's ("refusals on record").
- **"Changed since checked" (AC7).** The changed package is a consistent one, its manifest digest rewritten, as an
  update would leave it. So its checks can pass again. A restart (a new host on the same home and record) loads it.
- **Signed release (AC5, AC6, AC9, AC11).** A package is inside DeepBuild's signed release only when its id,
  version and digest match an entry of `release`. Checking the release manifest's signature is the updater's. A
  release package an agent changed has another digest, so it is no longer the release's.
- **Where a package runs.** It is read three ways, beside `place`:
  - the probe's own PID, which must not be this process (where the host runs: the hub's process)
  - that PID among the supervisor's `process.tracked` events for the load's `run`, so it was started through host@1
  - a canary file outside the package, which a sandboxed probe can't read and a hub probe can
- **"Reads only the record its grant names" (AC6).** The manifest's access word `record` plus the grant you
  approved at install, `grant.record`: the event kinds it may read. extension.manifest@1 has no field for this
  yet, so it comes with the install. The record holds `session.start`, `task.created` and the supervisor's own
  events. Only `session.start` may cross, and `task.created` asked for by name doesn't either.
- **Project trust (AC2, AC3).** One decision the core holds in the record. `openTrust` opens a reader of it, and
  every reader on the same record sees one answer. "With one answer" is one `answer(YOU, repo, false)` through the
  trusted path (writer `app`). After the revoke, the next load is refused. Whether an already-loaded copy is
  stopped too isn't tested. Reusing Claude Code's workspace trust and Codex's trusted projects is in the issue's
  Scope, but no criterion names it, so nothing here tests it.
- **The two stand-ins and the planted piece (AC3).** These are test pieces (`wrong.ts`), as the criterion says.
  The stand-ins for the done gate and spec drafting each read the decision through their own reader, every time
  before running the repo's command. The planted piece keeps its own list. So no half of AC3 waits on the real done
  gate or spec-draft.
- **An untrusted project's code (AC2).** Its load is refused naming trust. Whether `check` may run its code in the
  sandbox is left to the host. The test calls it and ignores a refusal.
- **"Before the hub is ready" (AC9).** The host is opened and the package loaded before `ready()`. A start may
  be refused or held until ready; either one passes. Both places are tested: a release package in the hub, where
  only the host can hold a start back, and a package in the sandbox.
- **The extension API schema (AC10).** It is `EXTENSION_API`. It must list the issue's methods (`on`, the six
  `register*`, record, evidence, asks, config) and `deep.notices.send`, and `deep.record.query` and
  `deep.notices.send` must each need a grant. Which other methods need one is the schema's to say. The walk
  checks each refusal against the schema's own `needs`.
- **The walk failing on an uncalled method (AC10).** The walk is the test's (`judgeWalk`). It is run on the same
  calls against the schema plus one method the package never saw, and must name it.
- **The host's kit (AC11).** The design puts it with the host ("the extension host's kit holds a planted
  first-party extension that tries"), so it is exported from the host's entry. AC11 is also tested directly with
  this suite's own planted first-party package (`fixtures/decider`), whose report gives each refusal's text.
- **"Refused at the record, naming the kind" (AC11).** Each append's error names its kind, and the record holds
  neither kind afterwards.
- **Inbound (AC12).** The design says inbound traffic reaches the hub "only through a plug-in you turned on, such
  as the OTLP receiver or a tunnel". The API has no method for this, so the surface adds the smallest one:
  `deep.registerRoute`, plus your choice in `host.turnOn(id, routes)`. Read as:
  - before turnOn, nothing new listens in the hub's process or the plug-in's, and the plug-in's own listen is
    refused
  - after turnOn, exactly one listener, on 127.0.0.1, serves the chosen route
  - a registered route you didn't choose, and the chosen path with another method, get 4xx and never reach the
    handler
  - after turnOff, nothing listens there
- **The probe.** Each test package reports through a check kind it registers, `ext.<plugin>.report`: its runner's
  one failure message is the JSON of what it saw. This is a test convention only; the `CheckResult` shape is
  `check.kind@1`'s.
- **AC8's comparison.** The merge-base comparison is the perf lane's, as in #236 and #30:
  - `benchmarks/budgets.json` gets a task `extension-host` with the command `["node", "benchmarks/extension-host.mjs"]`
    and an `initialReason` naming #348
  - the task must be valid under `validateBudgets` against the merge base's file
  - the bench prints one JSON line, `{"loadMs": {"hub", "sandbox"}, "eventMs": {"hub", "sandbox"}}`: the median ms
    to load one TypeScript extension, and the ms the host adds per event per subscribed extension
  - `eventMs` is a difference over a large batch, never a ratio: the batch with N subscribed, minus the same batch
    with none, divided by events times N. So one reading's noise stays well under 0.5 ms, and nothing is divided
    by a value near zero.
  - each of the four is judged on five bench runs, after a warm-up run, by the design's timing rule, on a
    reference Mac in a fit state only
- **"Added Oct 9".** The timeout on every extension run and safe mode loading nothing have no checkbox criterion.
  Nothing here tests them, and a PR should say how it proves them.

## Criteria to tests

Each test's name starts with its criterion's number. Each `describe` carries the criterion's ID,
`#348.<first 8 hex of the SHA-256 of its text>`, computed on the text trimmed, whitespace collapsed and `- [ ] `
dropped. A test headed `(wrong program)` runs the same scenario against the planted twin the criterion names, and
expects that twin to fail the criterion's assertion. The twin's scenario must itself run.

| ID | Criterion (short) | Tests | BLOCKED half | At this base |
|---|---|---|---|---|
| AC1 `#348.ef505d0a` | failing conformance doesn't load; reason shown | `conformance.test.ts` AC1 (4): bad access word `network`; an undeclared check kind; a throw at load; a sound package refused until checked, then loads | none | fails (no package) |
| AC2 `#348.fee14bf1` | an untrusted project's extension never loads | `trust.test.ts` AC2 (2): no decision; answered no, then trusted (control) | none | fails |
| AC3 `#348.96fd10c8` | one answer revokes: no load, stand-ins stop; own-list piece fails, named | `trust.test.ts` AC3 (3): revoke stops the load and both stand-ins; one decision per repo seen by a new reader; wrong program `own-trust-list` | none | fails |
| AC4 `#348.1f4cd69b` | a JSON-RPC extension in another language registers a check | `jsonrpc.test.ts` AC4 (2): Python package loads in the sandbox with its kind listed; running it reaches Python | BLOCKED only without python3 | fails |
| AC5 `#348.7391eba7` | agent-built loads only in the sandbox | `places.test.ts` AC5 (2): agent-built; a release package an agent changed, beside the unchanged copy in the hub | none | fails |
| AC6 `#348.4c1dd1d8` | outside-release TS from a folder, no agent: sandbox, reads only its grant; hub twin fails, named | `places.test.ts` AC6 (3): sandbox; the record filtered to `session.start`; wrong program | none | fails |
| AC7 `#348.583abb3f` | changed since checked doesn't load until checks pass again | `conformance.test.ts` AC7 (2): change, refused "changed since checked", check, load; a breaking change stays refused | none | fails |
| AC8 `#348.b0d5cd73` | load under 100 ms; under 0.5 ms per event per subscribed extension | `budgets.test.ts` AC8 (3): budgets task valid against the merge base; bench runs; the numbers | off a reference Mac in a fit state: BLOCKED (INCONCLUSIVE when unfit by the rule) | fails (no task, no bench) |
| AC9 `#348.f3e43b54` | no sockets, watchers or timers before the hub is ready | `ready.test.ts` AC9 (2): in the hub; in the sandbox | none | fails |
| AC10 `#348.75881ef9` | the walk: grant refusals named; uncalled method fails; record.query-only twin fails, naming notices.send | `grants.test.ts` AC10 (4): the schema's names; the walk; an uncalled method; wrong program | none | fails |
| AC11 `#348.379b1e4d` | the kit's planted first-party extension: decision kinds refused at the record; twin passes without it, fails with it | `kit.test.ts` AC11 (4): the kit passes the real host; this suite's planted package refused naming each kind; wrong program with and without the case; wrong program on the package | none | fails |
| AC12 `#348.fad7f4f9` | inbound only through a plug-in you turned on, only the routes you chose | `inbound.test.ts` AC12 (2): nothing before turnOn; one 127.0.0.1 listener serving only the chosen route, gone after turnOff | none | fails |

## Wrong programs

| Twin | Criterion | What it does | How the test fails on it |
|---|---|---|---|
| `ownTrustList` (`wrong.ts`) | AC3 | a piece that keeps its own trust list, filled the first time it sees a repo trusted | it runs the repo's command after the revoke; the failure names `own-trust-list` |
| host `plant: 'hub-unless-agent-built'` | AC6 | loads in the hub any package no agent built | the package loads in the hub; the failure names `test/probe` |
| `withUncalledMethod` (`wrong.ts`) | AC10 | a schema listing a method the walk never called | the walk fails naming `deep.planted.uncalled` |
| host `plant: 'grants-only-in-record-query'` | AC10 | checks grants only in `deep.record.query` | `deep.notices.send` goes through; the walk fails naming it |
| host `plant: 'first-party-appends-every-kind'` | AC11 | lets a first-party extension append any kind (as `core`) | the kit without `first-party-decision-kinds` passes it and the kit with it fails it; the planted package's appends go through and the test names the kind |

The criteria that name no twin (AC1, AC2, AC4, AC5, AC7, AC8, AC9, AC12) fail on the base, which has no
`extension-host` package. Past that, the mutation lane is their wrong program. Each refused load has its own
fixture: `bad-manifest`, `undeclared-check` and `throws-at-load` (AC1), the probe changed or broken after its
checks (AC7), and the probe as an untrusted project's (AC2, AC3).

## What depends on other issues

- **The reference Mac.** AC8's numbers count only there, in a fit state: mains power, Low Power Mode off, thermal
  state nominal. Elsewhere the test fails BLOCKED, or INCONCLUSIVE when the five readings don't decide.
- **python3.** AC4 fails BLOCKED when there is none on PATH.
- **#349, extension slots.** A slot's own kit at install (a check runner refused on `check.kind@1`'s fixtures) is
  #349's criterion, not part of this host's conformance here.
- **#350, extension calls at run time.** Refusals on record and hook replies joined in one order are #350's. No
  criterion here needs them.
- **#351, extension packages.** The package envelope's digest and signature are #351's. Here the host only needs
  `packageDigest` to agree with itself.

No half of a criterion here waits on an unbuilt issue: AC3's done gate and spec drafting are stood in for by test
pieces, as the criterion says. So a PR for #348 that passes every test here (AC8's number on a reference Mac) may
say `Closes #348`, after a review of "Added Oct 9" as noted above.

## Files

- `helpers.ts`: the environment cleanup, temp folders, the world (record, asks, supervisor, trust), hosts, the
  fixture copier (`*.fixture` renamed, manifest fields and probe settings written, the Python path set, the digest
  stamped with `packageDigest`), the probe reader, `lsof` listeners, the python3 gate and the reference-Mac timing
  judge.
- `wrong.ts`: the stand-ins, the planted own-list piece and the uncalled-method schema.
- The test files:
  - `conformance.test.ts`: AC1, AC7
  - `trust.test.ts`: AC2, AC3
  - `jsonrpc.test.ts`: AC4
  - `places.test.ts`: AC5, AC6
  - `budgets.test.ts`: AC8
  - `ready.test.ts`: AC9
  - `grants.test.ts`: AC10
  - `kit.test.ts`: AC11
  - `inbound.test.ts`: AC12
- `fixtures/`: the test packages:
  - TypeScript: `probe`, `decider` (first-party), `ready`, `walk`, `inbound`
  - JSON-RPC in Python: `pycheck`
  - refused loads: `bad-manifest`, `undeclared-check`, `throws-at-load`
  - the trust tests' project: `repo`
  Their `.ts` and `.mjs` files, and the Python `main`, carry a `.fixture` suffix, so this suite and `tsc` skip them.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
