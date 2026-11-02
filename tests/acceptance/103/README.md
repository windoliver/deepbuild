# Acceptance tests for #103: composition, typed provides and uses edges with no access through them

Written first, blind, by a job that never saw an implementation of #103 (none exists at the base). It read:

- issue #103 as of November 1, 2026: its Scope, its 15 criteria, its Proof and its Depends on (#139, #44, #102)
- `docs/technical-design.md`: Composition (Declared edges, No access through composition, Changes travel along
  edges, Compose before writing, Visible, Agents use the same edges, the hub-slot table), Extension API (TypeScript,
  in-process) (`deep.provide`, `deep.use`, `deep.record.query`, `deep.runner.run`, `deep.send`, `deep.schedule`),
  Socket roles and contract versions (Contracts that can't drift: the `d1` digest; What a minor may change), Claim,
  Access, and Dogfooding (the Composition fixtures)
- `AGENTS.md`
- for conventions: the READMEs, helpers and BASE-FAILURE.txt of #139 (`prices.test.ts`, its AC10 provides/uses/adapter
  scene), #363, #364, #365 (`budgets.test.ts`, the brief and market fixtures) and #366 (the runner world, AC4's grant
  test, `fixtures/fake-claude.pl`); `tests/acceptance/plans.ts`; `scripts/proof-change.mjs` for the criterion IDs;
  `scripts/benchmark.mjs`
- the base, read only, at `c9225aa3`: `packages/extension-host` (host.ts: `install`, `admit`, `updateHeld`, `edges`,
  `deep.provide`/`deep.use`/`deep.read`, `readUse`, `query`, `reach`, `runJob`, `callAction`, `disable`, `testPackage`,
  the plants; runtime/deep.mjs; jobs.ts; sends.ts; schedules.ts), `packages/contracts` (extension.manifest@1,
  `checkManifest`, `d1Digest`, extension-api.json), `packages/record`, `packages/asks`, `packages/env-local`,
  `packages/runner`, `packages/hub` (only how it opens the extension host)

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.
The issue has 15 criteria, AC1 to AC15, in the body's order.

## How to run

macOS, Node 24.22.0 first on `PATH`, and a shell whose own sandbox is off (in Claude Code, the Bash tool with its
sandbox off): every test plug-in is outside the release, so it runs in the platform sandbox through the supervisor,
and AC4's job runs under the runner's Seatbelt profile, and Seatbelt can't nest.

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:$PATH"
npm ci --no-audit --no-fund              # once, if node_modules is missing
npm run build --workspaces               # if any package's dist is missing
node node_modules/vitest/vitest.mjs run --root tests/acceptance/103 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/103/tsconfig.json
```

- **`--no-file-parallelism`:** the files start sandboxed plug-ins and time installs and reads. The implementer adds
  `tests/acceptance/103/` to the one-at-a-time list (`alone`) in `scripts/lanes.mjs`, as #364's, #365's and #366's
  are (not done here: this job writes tests only).
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*`, `ANTHROPIC_*` and `AI_AGENT` out of the process's
  environment, points `HOME` at a temp folder holding a fake Claude Code sign-in (made-up tokens, for AC4's runner) and
  sets `TZ=UTC`; nothing touches the real `~/.deepbuild`, `~/.claude` or Keychain (secrets go to an in-memory store).
- **Temp folders:** every package, record, evidence store and home is under `/tmp/dh103-*`, removed after its file.
  Every host a test opens is closed after its file (or by the test), which stops what it started; the runner stops its
  jobs at its close. Nothing is stopped by name or port.
- **No network:** `api.market.example`, `api.mail.example` and `chat.example` are HTTP servers this process runs on
  127.0.0.1. The hub reaches them only through the HTTP client the test gives it, which refuses any other name before
  opening a socket. The model is the fake `claude` (`fixtures/fake-claude.pl`, copied unchanged from #366's suite): the
  agent CLI is the one boundary DeepBuild doesn't own. No model, paid or live call is made.
- **Time:** everything runs on the real clock; schedules never come due on their own (their cron is once a year) and
  run by Run now.
- Vitest may leave `tests/acceptance/103/node_modules/.vite/`; delete it before committing.

## The surface under test

The issue and the design name: `provides` and `uses` in a manifest, each with a JSON Schema and a version; a use names
`name@major` and its digest with an optional preferred provider and may be optional; `deep.provide`, `deep.use`,
`deep.record.query`; the composition graph; contract tests that replay the user's own tests; claims reopened; asks;
standing rules; the `d1` digest; What a minor may change (an optional field, a member of a set marked extensible, read
as `unknown`); a manifest that replaces a provider; cycles. The tests reach them only through
`packages/extension-host/src/index.ts` (`openExtensionHost` and the package-side `deep`), `packages/record`,
`packages/asks` and `packages/runner`'s entries. Every name below not in that list is **picked here**.

### The manifest (extension.manifest@1, checked by `checkManifest` and the installer)

```jsonc
{
  "provides": [{
    "interface": "ext.stocks.prices@1",   // name@major, as at the base
    "kind": "reading",                    // or "action": the action of the interface's name without @major serves it
    "minor": 2,                           // as at the base
    "schema": { /* the output's JSON Schema at this minor */ },
    "digests": { "0": "d1:…", "1": "d1:…", "2": "d1:…" }
                                          // the frozen digest it keeps for each minor from 0 to `minor`;
                                          // digests[minor] is d1 of `schema`
  }],
  "uses": [{
    "interface": "ext.stocks.prices@1",   // as at the base: an interface, never a piece
    "minor": 1,                           // as at the base: the minor it was built against
    "digest": "d1:…",                     // as at the base: d1 of `schema`
    "schema": { /* the interface's schema at that minor, as the user was built against it */ },
    "from": "acme/stocks",                // optional: the preferred provider when several provide it
    "optional": true                      // optional: absent means required
  }],
  "replaces": ["acme/stocks", "ext.stocks.prices@1"]
                                          // a package id in `replaces` (owner/name; the frozen pattern gains `/`):
                                          // installing this removes that package and rewires its users. The
                                          // interface entry is the base's rule for keeping a replaced piece's name.
}
```

- **Matching** (design: Declared edges): a use matches a provider only when the provider's interface is the use's
  `name@major`, its `minor` is the use's or later, and `digests[use.minor]` is the use's `digest`. A use that matches
  no installed provider while one provides the same name at another major or minor, or keeps another digest, refuses
  the user's **install** (`install` rejects), naming the edge as `<user> uses <interface>`, the provider's id, and the
  first schema path that differs, as a JSON Pointer into the schema (`/properties/volume/type`), comparing the use's
  `schema` with the provider's `schema`. Nothing of the refused piece is wired.
- **Serving at the use's minor** (What a minor may change): a reading reaches a user as its `schema` has it: a property
  its schema doesn't list is left out, and a string not in an `enum` its schema marks extensible
  (`"x-closure": { …, "mark": "extensible" }`, as the contracts mark sets) arrives as `unknown`.
- **Cycles:** an install whose uses (required or optional) would close a cycle among installed pieces' edges is refused
  at install, the reason holding the word `cycle` and naming each piece in it. Nothing is wired.

### `@deepbuild/extension-host` gains

```ts
interface ExtensionHostOptions {
  // ...the base's, and:
  /**
   * The first-party pieces the hub runs itself, env-local among them, each a provider in the composition graph:
   * the hub passes { id: 'env-local', version: <its version>, provides: ['environment@1'] }. A version differing from
   * the one the record last saw for that id is a new version (the hub's next start after an update).
   */
  firstParty?: { id: string; version: string; provides: string[] }[];
  plant?: Plant;  // Plant gains the six names in Plants below
}
interface ExtensionHost {
  // Changed: also lists first-party edges, and keeps them in the record across a restart.
  edges(): Promise<{ user: string; uses: string; interface: string; provider: string }[]>;
  // Changed: ctx may say the run happened in a first-party environment, by its interface:
  //   runCheck(kind, spec, { checkout, deadline, environment: 'environment@1' })
  // makes the piece that registered `kind` a user of the first-party piece that provides 'environment@1' (a journey
  // that used it), recorded in the composition graph.
  runCheck(kind: string, spec: CheckSpec, ctx: { checkout: string; deadline: number; environment?: string }): Promise<CheckResult>;
  // Changed: removing the provider of a required use asks you once, naming every such user and the interface, and
  // detaches nothing until you answer: your yes goes on, your no rejects and leaves everything as it was. An optional
  // use's provider is removed with no ask.
  disable(id: string): Promise<void>;
  // Changed: a user's own tests' `t.read(interface)` reads through its use (below).
  testPackage(pkg: Installed): Promise<PackageTests>;
}
```

`install`, `check`, `load`, `installed`, `loaded`, `callAction`, `runNow`, `idle`, `setSendRule`, `sends`,
`enterSecret`, `readSource` keep their shapes.

- **A new version** (an install of an installed id at another version, a rollback included) of a piece, and a
  replacement (`replaces`): before the version in use stops, the hub records the new version's outputs that installed
  pieces use, checks each against its schema, and runs each user's **contract test**: the user's own tests
  (`tests/**/*.test.{ts,mjs,js}`, as `testPackage` runs them), whose `t.read(interface)` answers from those recorded
  outputs, served at the user's minor. A failure refuses the install (at `install` or `check`; the tests accept
  either), naming the edge `<user> uses <interface>` and the provider, and the version in use stays loaded, wired and
  read. A version whose code fails to start leaves the version in use the same way.
- **Once the new version is active**, each piece that uses it, directly or through other pieces, has its claims
  reopened once (one `composition.reopened` event per piece), and each contract test that ran is recorded
  (`composition.tested`).
- **A call in flight:** a read the old version began before its removal that finishes after the new version is active
  is refused at its edge: `deep.read` rejects, naming `<user> uses <interface>`. The replacement doesn't wait for the
  old version's calls under way (design: Removing … stops new calls first).
- **Calls through an edge** (`deep.call`, below) of a change or send action run the provider's action for the calling
  piece: a send always raises an ask (an authority ask through the asks core) whose card names the calling piece's id;
  a change raises one too unless a standing rule covers it (no test sets one). Nothing runs before your yes; your no
  rejects the call. One ask per call: after your yes, the provider's handler runs under its own grant (its own `deep.send`
  under your standing rule for it raises nothing more).
- **Record reads:** `deep.record.query` of another plug-in's store or event kind is refused, naming the kind and the
  interface that piece provides to declare a use of (`ext.alerts.alerts@1`).
- **A job on a used reading:** `deep.runner.run` takes, as an input, a reading handle the plug-in got from `deep.read`,
  under the plug-in's own grant; the cites it gets back are filtered by its own grant, never its provider's.

### The package's side (runtime `deep`, `EXTENSION_API`)

```ts
deep.provide(iface: string, kind: 'reading' | 'action', schema: object, fn?: () => unknown): Promise<null>   // as at the base
deep.use(iface: string): Promise<null>                                                                      // as at the base
deep.read(iface: string): Promise<{ value: unknown; handle: string } | { missing: true }>
  // `value` served at the use's minor; `handle` (new): reading:<id>, the reading as the hub recorded it crossing the
  // edge, which this plug-in's runner jobs may take as an input and cite. An optional (or detached) use with no
  // provider reads { missing: true }, never an empty value.
deep.call(iface: string, input: unknown): Promise<unknown>
  // New (preview, tracking #103): calls the action output `iface` the piece uses, through its edge; resolves to the
  // action's output; rejects when refused.
// A package's own test (tests/*.test.mjs, `export default { name: async (t) => … }`):
t.read(iface: string)  // also an interface the package uses: what deep.read answers (in a contract test, from the
                       // provider's outputs recorded at its new version)
```

### The record (each kind with its `@1` schema)

```ts
// written by the core, one per piece whose claims a new version (or rollback, or replacement) reopens:
'composition.reopened': { piece: string; provider: string; version: string }   // provider: the id; version: now active
// written by the core, one per contract test run between a user and a provider's version:
'composition.tested': { user: string; interface: string; provider: string; version: string; passed: boolean }
```

The tests compare these data exactly (`toEqual`), so neither carries another field.

### Plants (`plant` on the host options; tests only)

| Plant | The wrong program | Criterion |
|---|---|---|
| `compares-names-alone` | a use wires to a provider of its `name@major` whatever its minor and digest | AC1 |
| `serves-newest-minor` | a read hands the user the provider's current shape (fields and members added since its minor) | AC15 |
| `wires-by-name` | a use stays wired to the piece its `from` names, so after a replacement removes it the use reads missing | AC9 |
| `detaches-silently` | removing a required use's provider detaches it with no ask | AC10 |
| `optional-reads-empty` | an optional use with no provider reads an empty value (`{ value: [] }`) | AC10 |
| `call-under-provider-grant` | a call through an edge runs as the provider, so its own standing rule covers the send and nothing asks | AC11 |
| `record-by-grant-words` (#363's, at the base) | a record query of another plug-in's kind is answered from its store | AC12 |

Each twin runs the criterion's scenario on its plant and expects it to fail with the message the criterion names.

## Criteria to tests

IDs as `scripts/proof-change.mjs` computes them from the criteria's text as the job was given it.

| ID | Criterion (short) | Tests | Wrong programs it must fail on |
|---|---|---|---|
| AC1 `#103.119d48b4` | typed match by minor and digest; mismatches named by edge and path | `wiring.test.ts`: three refusals, one wiring, one twin (5) | `compares-names-alone` |
| AC2 `#103.0c4256a2` | the weekly brief with no new data code | `brief.test.ts` (1) | a hub that can't wire or send it; a brief needing its own source, store or fetch |
| AC3 `#103.3419af40` | a composite reads no secret its grant doesn't name | `access.test.ts` (1) | a hub that lends the provider's key to a same-named secret, or puts it in a reading |
| AC4 `#103.41052f7f` | a sandboxed user's job on a used reading runs, finds nothing past its grant | `access.test.ts` (1) | a hub that refuses the used reading (the base), or filters the job's cites by the provider's grant (text) |
| AC5 `#103.c7b27417` | reopen direct and indirect users once, new version and rollback | `versions.test.ts`: chain with rollback, diamond (2) | reopening only direct users, or A twice in the diamond, or nothing on rollback |
| AC6 `#103.fce0bc6c` | env-local's environment in the graph, its users reopened on its new version | `versions.test.ts` (1) | users from declared checks rather than journeys that ran in it; reopening at every start |
| AC7 `#103.680f00cb` | halved readings fail the user's contract test; the version in use stays | `versions.test.ts` (1) | a hub that installs without replaying the user's tests, or swaps versions before they pass |
| AC8 `#103.a7f0eb05` | a cycle is refused at install, nothing wired | `wiring.test.ts`: refusal, control (2) | a hub that installs the cycle; one that refuses any use of an action |
| AC9 `#103.04e2ba94` | a replacement rewires the brief; its claims reopen once | `replace.test.ts`: scenario, twin (2) | `wires-by-name` |
| AC10 `#103.770ba796` | removing a required use's provider asks once; optional reads missing | `replace.test.ts`: yes, no, optional, two twins (5) | `detaches-silently`, `optional-reads-empty` |
| AC11 `#103.592e1775` | calls through an edge ask as the calling piece | `access.test.ts`: yes path, no path, twin (3) | `call-under-provider-grant` |
| AC12 `#103.cacc49e2` | another's store only through a use; its new version reopens once and reruns the contract test | `access.test.ts`: scenario, twin (2) | `record-by-grant-words` |
| AC13 `#103.de8a47db` | a failed replacement leaves the version in use; a late old call refused at its edge | `replace.test.ts` (2) | a hub that stops the old version before the new one starts (the base); one that delivers a late answer |
| AC14 `#103.84a93fb7` | wiring under 100 ms; a read across an edge under 1 ms | `budgets.test.ts`: perf-lane tasks, wiring, read (3) | a lane with no task to compare with the merge base; the timings over their limits |
| AC15 `#103.334e66dd` | served at its minor: no `currency`, `halted` as `unknown`; contract tests pass | `wiring.test.ts`: read, contract test, twin (3) | `serves-newest-minor` |

34 tests.

## Readings (how each criterion was interpreted)

- **AC1**: `prices@1` is `ext.stocks.prices@1`. Minor 0 is `{ symbol, cents }`; minor 1 adds the optional `volume`.
  The three providers: minor 1 whose shape types `volume` as a number (`/properties/volume/type`); minor 0
  (`/properties/volume`); `ext.stocks.prices@2` only, `cents` retyped (`/properties/cents/type`). Each scene has one
  difference, so "the first path" is unambiguous. "Fails at install": `install` rejects. A minor-2 provider whose
  `digests["1"]` is d1 of the use's schema wires, and the brief reads its reading.
- **AC2**: "builds with no new data code" is read on the package and on what it does: its manifest declares no source,
  store, secret, event kind, check or output; its only access word is `hosts` and its grant names only the mail host
  its send goes to; its code calls none of `deep.registerSource`, `deep.store*`, `deep.fetch`, `deep.secret`,
  `deep.record.*`; its two uses wire to the stocks and CI plug-ins; one Run now sends you one email whose lines are the
  watchlist's prices and the CI checks it read through the uses, under your standing rule. The design's "the runner"
  (a model job writing the brief's prose) isn't data code and is left out here: it needs a live agent; and "builds"
  (your agent composing it from your sentence, R2's Add anything) isn't modelled, since it needs a model.
- **AC3**: the stocks plug-in has your market key; the composite uses its prices and has a polled source of its own on
  the same host under a secret of the same name, which you never entered for it. It reads the prices through its use;
  its own source doesn't read (it names `market_key`), and no call made for it carries the key.
- **AC4**: "granted only content-free fields" is `{ record: ['*'] }` without `text` (#366's reading); the provider is
  granted `{ record: ['*'], text: true }`. The user reads the price through its use, passes the reading's handle to
  `deep.runner.run`; the fake agent tries your transcript and a notes file and cites `session:…`, `file:…` and the
  reading. The job must run, and the plug-in must get neither text and no cite but the reading's handle.
- **AC5**, **AC9**, **AC12** and **AC6**: "reopens the claims … once" is counted on `composition.reopened` for the
  provider's id and the version now active: exactly one per reopened piece, and none for a piece that doesn't use it.
  A rollback is installing the earlier version's folder again.
- **AC6**: env-local is first-party, wired by the hub, not installed through the host, so the host learns of it from
  `firstParty`, and of "the pieces whose journeys used it" from `runCheck`'s `ctx.environment`: the piece whose check
  kind ran in it. "A new version of it" is the hub's next start with env-local at a newer version (a new host on the
  same record and home). The hub's own calls (passing env-local at start, saying a run used its stack) aren't tested
  here: that needs a running hub, and they are one line each.
- **AC7**: the brief's own test totals the watchlist from `t.read`; the halving version must be refused naming
  `acme/brief uses ext.stocks.prices@1` and `acme/stocks`; 1.0.0 stays loaded, wired and read. 1.0.1 changes only an
  output the brief doesn't use, installs, and its contract test is recorded passed.
- **AC8**: B installs first with its use of X's action optional (no provider yet); X then uses B's reading and provides
  that action. A control shows X installs without its closing use.
- **AC10**: removing is `disable`. "Nothing is detached before your answer": the edge is listed, the brief's run reads
  the CI value, and `disable` hasn't resolved; your yes then removes it, and the brief reads `{ missing: true }`.
- **AC11**: the watchlist has no access words and no grant; the chat plug-in may post to `#general` under your
  standing rule (a control shows its own post goes out with no ask). The watchlist's scheduled job calls `post`, then
  `mute`, with `deep.call`. "Posted" is a request reaching the chat host.
- **AC13**: "fails to start": its code throws once it has registered (at conformance and load alike). "A call the old
  version began": a read through the edge the old version answers after 6 s; the replacement is admitted 0.3 s in. A
  hub that delays the replacement until the old read is answered fails, the message saying so.
- **AC14**: see the comment at the top of `budgets.test.ts`. The surfaces are exercised before the machine is judged,
  so a base without them fails; off a reference Mac, on battery, thermal state not nominal, or with a 1-minute load
  above the core count, the timing is skipped as INCONCLUSIVE, never passed.
- **AC15**: minor 1 adds an optional `status` (`open`, `closed`, `unknown`, marked extensible); minor 2 adds the
  optional `currency` and the member `halted`. "Makes nothing pass": `halted` reaches the brief as `unknown`, never as
  a member it knows (`open`). "Its contract tests pass": a provider update from minor 1 to minor 2 installs with the
  brief's test (fields exactly `cents,status,symbol`, a status it knows) recorded passed.

## Ambiguities, and how they were read

- The issue names no module, field or method for most of this; every new name is in The surface under test.
- "Naming the edge": `<user> uses <interface>` (the base's `readUse` words), plus the provider's id where one exists.
- Schemas live in the manifest so install can check types before any code runs (design: "fails at install, the way a
  type error fails a build"); the provider keeps a digest per minor, and the use carries its own schema so the hub can
  name a path and serve at its minor.
- "Removing the provider" is `disable`; "a manifest that replaces a provider" lists the package id in `replaces`.
- AC6's composition graph is `edges()`, extended to first-party providers, kept in the record across a restart.
- AC2 leaves out the runner and the agent's building (above).

## What the base already does

All 34 fail at the base (BASE-FAILURE.txt), 31 of them where a manifest carries the composition rows the base refuses.
To see past that, a scratch run (not kept) wrote the rows in the base's frozen shape (no `schema`, `digests`, `from`,
`optional`): the scenarios then ran to their #103 steps and failed there (no type check, no reopen events, no
`firstParty` edges, no asks on `disable` or on a call through an edge, no reading handle, no `alerts@1` in the query's
refusal, the old version unloaded before the new one started, a late read delivered, `t.read` refusing an interface),
except these, whose behavior the base already has once the rows are accepted:

- AC1's wiring at minor 2, AC8's control, AC10's optional read (`{ missing: true }`): the base wires by name and reads
  missing, which is correct for these scenes; the new rows are what they add.
- AC2 and AC3: the base already runs a uses-only brief end to end, and keeps a secret to the piece you entered it for.
  They prove the composition holds on the new surface; neither has a wrong program the base matches.
- The twins of AC1, AC10 (`detaches-silently`), AC12 and AC15 passed in that run: the base behaves as those wrong
  programs do, which shows each twin's scenario fails with the message its criterion names.

## Files

`helpers.ts` (environment, worlds, hosts, servers, the generic piece, manifest rows, the record and asks),
`wiring.test.ts` (AC1, AC8, AC15), `brief.test.ts` (AC2), `access.test.ts` (AC3, AC4, AC11, AC12),
`versions.test.ts` (AC5, AC6, AC7), `replace.test.ts` (AC9, AC10, AC13), `budgets.test.ts` (AC14),
`fixtures/fake-claude.pl` (#366's), `tsconfig.json`, `BASE-FAILURE.txt`.
