# Acceptance tests for #139: contract history, `since`, `deprecated_since`, `replaced_by` and a diff against every earlier release

Written first, blind, by a job that never saw an implementation of #139. On October 29, 2026 it read:

- issue #139 (`updatedAt` 2026-10-30T06:18:07Z): its Scope, its 14 checkbox criteria, its Proof and what it depends on
  (#13, #44); the epic #241 for scope only
- `docs/technical-design.md`: Socket roles and contract versions (Contracts that can't drift, One canonical form
  before any hash, What a minor may change, Version skew, Documents that age well); Extension API (TypeScript,
  in-process) with "A first plug-in"; Composition (declared edges, `uses` matching a provider, removing a provider asks
  once, naming its users); How we know version 0 works (Conformance tests, Generated edges, Frozen contracts, The
  ecosystem corpus, API diffs, the parity paragraph); How it installs; Criteria to tests, both ways; Criteria in a
  checked shape; Wrong programs; Built to be hard to get wrong
- `docs/canvas-primitives.md`: kinds with `deprecated_since` and `replaced_by`, Registry and seal, Migration
- `AGENTS.md`
- at the base commit `f2867254` (origin/main): `packages/contracts` (`extension-api.json`, `hub-slots.json`,
  `digests.json`, `schemas/`, `slots/`, `src/` with `d1Digest`, `extensionApi`, `hubSlots`, `checkManifest`, the lint's
  annotation list), `packages/extension-host` (`host.ts`, the runtime's API list, `kit.ts`), `packages/hub` (`install.ts`,
  `doctor.ts`, `server.ts`'s method table, `confirm.ts`), `crates/deep-canvas/src/registry` and `document/check.rs` (the
  deprecated notice for a kind), `crates/deep-hook` (a binary crate, no lib), `scripts/lanes.mjs`, `slots-check.mjs`,
  `guide.mjs`, `proof-change.mjs`
- the sibling suites `349` (slots; this suite's layout), `44`, `348`, `350` (provide/use fixtures), `351`, `16` (the hub
  as a process; its helpers are imported), `120` (the reference-Mac gate and the five-run judge; imported), `138`, `246`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

On macOS, with the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the hub and the CLI run from dist
node node_modules/vitest/vitest.mjs run --root tests/acceptance/139 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/139/tsconfig.json
```

- `--no-file-parallelism`: the files start hubs, hosts and cargo runs. `scripts/lanes.mjs` must add
  `tests/acceptance/139/` to the unit lane's one-at-a-time list, as 349's line does (the implementer makes that edit).
- Every folder is under `/tmp/dh139-*` (real paths, hub sockets fit 104 bytes), removed after the file. `HOME` is a
  temp folder for the process and every child; `CLAUDE*`, `DEEP_*` and `AI_AGENT` are taken out of the environment.
  Hubs and hosts are stopped by PID (`stopHub`, `close()`). No network. Nothing is skipped at the base: every test fails.
- AC9 needs `cargo-semver-checks` and API Extractor, and takes minutes (a scratch repo, rustdoc JSON). **Where either is
  missing the test fails with `BLOCKED:` and the reason**, never passes; one test asserts the step itself is BLOCKED (exit
  3, no PASS) with `cargo-semver-checks` off the `PATH`. AC7's timings count only on a reference Mac (as 120's
  `environmentProblem` reads it); elsewhere they report `INCONCLUSIVE:` and skip, after the surfaces were checked.

## The surface under test

The issue names `contracts/breaks/<from>_<to>/<issue>.txt`, `since`, `deprecated_since`, `replaced_by`,
`stability: stable | preview`, `requires.preview`, `preview_unrequested`, the `deprecated` notice, `deep doctor`,
cargo-semver-checks, the committed TypeScript API report, `parity/framework/contract-diff.board` and
`parity/framework/old-contract-load.scene`; it names no command, file layout or option. **Every name below that the issue
doesn't give is this job's invention**, the smallest surface consistent with the design and the code at the base. The
implementer builds exactly these, or a dispute goes to a blind redraft.

### The contract step: `scripts/contract-diff.mjs <command> [--release <R>] [--root <tree>]`

`--root` is the tree the step reads (default: the repo); a test points it at a scratch copy of the contract data. A
tree has `packages/contracts/` (the published data below) and `contracts/`. Each line is printed as `PASS contracts: …`,
`FAIL contracts: <entry>: <what> (arrived in <release>)` or `BLOCKED contracts: …`; exit 0 on PASS, 1 on any FAIL, 3 on
BLOCKED (the one exit table). `DEEP_CONTRACTS_PLANT=<name>` selects a wrong program (below).

| Command | What it does |
|---|---|
| `dump` | prints the tree's published contracts as one JSON document `{ release, entries }`, each entry keyed `<kind>:<name>` with `since`, `stability`, `deprecated_since`, `replaced_by`, `tracking`, `digest` and its shape. Kinds: `api` (extension-api.json), `rpc` (rpc-methods.json), `schema` (schemas/: event kinds, document kinds, sidecar formats), `interface` (slots/), `slot` (hub-slots.json rows, `method[/variant]`), `registry` (canvas-registries.json) |
| `record --release R` | writes `contracts/releases/R.json` (the dump, plus the fixture's pinned envelope digest when `contracts/fixtures/R/` exists), `contracts/fixtures/R/recorded.json` (below) and `contracts/releases/R.corpus.json` (which corpus members failed in R). This is how a release is cut, and how these tests make "the previous release" |
| `check --release R` | the contract step the local preflight runs: the candidate R against **every** `contracts/releases/*.json` of another name, plus the rules below; with no `--release`, the lane's default (the implementer's choice) |
| `notes --release R` | prints the release notes: each accepted break (entry, quoted diff line, workaround, issue) |
| `old-load --release R` | the fixture of every earlier release, loaded and called in the candidate (AC4) |
| `corpus --release R` | the ecosystem corpus against the candidate (AC8, AC14) |
| `document <file> --release R` | the preview rule for a document: `{ items: [{ kind }], requires: { preview: [] } }` |

**Published data and its history fields** (the part AC5, AC6 and AC13 read):

- an API method (`extension-api.json` entry), a hub-slot row (`hub-slots.json`), a canvas registry
  (`canvas-registries.json`: `[{ registry, since, stability, … }]`, this job's file) and a JSON-RPC method
  (`rpc-methods.json`: `[{ method, since, stability, deprecated_since?, replaced_by?, stops_serving? }]`, this job's file)
  carry `since`, `stability`, and when replaced `deprecated_since` and `replaced_by`; a `preview` entry carries `tracking`
  (an issue, `#139`); an entry may carry `stops_serving`, the release that stops serving a deprecated one;
- a schema under `schemas/` carries the same as annotations at its root: `x-since`, `x-stability`, `x-tracking`,
  `x-deprecated_since`, `x-replaced_by` (the d1 digest leaves them out, as it leaves out `x-closure`), and a property
  that can deny, block, answer or lower a verdict says so with `x-acts` (AC11).

**The diff.** A change is classified against the same key in each earlier release: a removed key, or a shape that
differs, is a break unless it is additive in a minor (AC11) or the entry is a preview entry (AC3). Each break prints one
`FAIL contracts: <entry>: …` line naming the entry, the field (the property's name) and `(arrived in <since>)`, and under
the FAIL lines **diff lines**, each at the start of its line: `diff: <from>_<to> <entry> <pointer> <what>`. A reviewed
break file is `contracts/breaks/<from>_<to>/<issue>.txt`: the diff line **verbatim**, one or more, and a line
`workaround: <text>` with text. The break passes only when its own `<from>_<to>` pair's file quotes each of its lines; a
quote of another line, or no workaround, fails. `check` also fails: an entry with no `since`; one with `deprecated_since`
and no `replaced_by`; a preview entry with no `tracking`; a **stable** API entry that no piece of `contracts/shipped.json`
(`{ pieces: [{ piece, calls: [method…] }] }`, the shipped pieces of the candidate and what each calls) calls.

**The previous release (AC4).** No release is cut at the base. `record --release R1` pins the fixture folder
`contracts/fixtures/R1/` (a package: `deepbuild.json` and `index.ts`, its default export taking `deep` and returning
`{ [method]: result }` for each stable method of R1, as the package calls it) by its envelope digest in
`contracts/releases/R1.json`, and writes each result to `contracts/fixtures/R1/recorded.json` (`{ results: {…} }`).
`old-load --release R2` rebuilds nothing: it installs and loads that folder in the candidate's host, compares its digest
with the pin and each result with the recorded one, and prints each method it called. A digest that isn't the pin fails
(the calls still run, so a result that differs is named); `DEEP_CONTRACTS_PLANT=unsupported-shim:<method>` makes the
candidate answer that method `unsupported`.

**The corpus (AC8, AC14).** `contracts/corpus.json` is `{ members: [{ name, group, samples: [{ schema, value }] }] }`,
groups `api-sentence`, `gallery`, `art-motion`, `earlier-release`, `extension`, `pack`; a member **fails** when a sample
doesn't validate against the candidate's published schema of that name. `corpus` prints one line per member (its name),
`FAIL contracts: corpus <name>: <first difference>` and a diff line `diff: <from>_<to> corpus:<name> …` for a failure
the previous release (the latest `contracts/releases/*.corpus.json`) didn't have, and `KNOWN contracts: corpus <name> …`
for one it had (never FAIL, never "new"). The owner's marks are `contracts/corpus-decisions.json`:
`[{ member, release, decision: 'fixed' | 'accepted', break? }]`. A new failure holds the release (exit 1) until it is
`accepted` **with** a break file (`break`: its path) quoting its diff line and a workaround, or `fixed` **and the member
passes again**: the owner's word alone is not evidence.

### `scripts/api-surface.mjs [--root <repo>] [--write-report]`

Runs `cargo semver-checks` on the canvas module crates (`deep-canvas*`) and `deep-hook` against the commit at HEAD of
`--root`, and compares the TypeScript extension API with `contracts/api-report/extension-api.api.md`; `--write-report`
rewrites that report. `PASS api: …` naming the crates; `FAIL api: <crate or method>: <what>` (a removed function names it
and `deep-hook`; a changed signature names the method); `BLOCKED api: <tool> …` and exit 3 when a tool is missing or a run
can't complete. The local preflight's lint lane runs it. `deep-hook` is a binary crate at the base; the implementer gives
it the library semver-checks needs.

### `scripts/lanes.mjs`

A lane of `checks` runs `contract-diff.mjs check` (its time is AC7's) and another runs `api-surface.mjs` (it may be one
lane); `releaseLanes` has a lane that runs `contract-diff.mjs corpus` (and `old-load`).

### `packages/extension-host` (AC3, AC10, AC13)

- `ExtensionHostOptions.api?: readonly ApiEntry[]`: the published API installs are held to (default `extensionApi()`);
- the manifest root takes `stability?: 'stable' | 'preview'` (default preview: a package that never says is not stable) and
  `requires?: { preview?: string[] }`, and a `provides` row takes `adapter?: { from: string }` (this row's reading is
  served by the package's adapter over the interface `from`); `checkManifest` accepts them;
- the install (install, check and load in sequence) refuses a **stable** package that calls a preview method, naming the
  method; refuses a package that calls a preview method it doesn't list in `requires.preview` with `preview_unrequested`
  and the method; accepts one that lists it; refuses one that lists a preview method and declares itself stable, naming it;
- an update (same package id, a new version) that would leave a use of a required interface with no provider **asks once**,
  naming the users (`acme/stocks`), through the asks core the host was given, and `install` waits for the answer: your yes
  installs it, your no refuses it and leaves the installed version and the wiring as they were;
- `host.edges(): Promise<{ user: string; uses: string; interface: string; provider: string }[]>`: each use of a loaded
  package, the interface its manifest names, the interface it is wired to and the provider. A use wired to a provider
  whose row for that interface has an `adapter` stays wired to the same interface;
- `Plant` gains `'stable-may-call-preview'` and `'rewires-to-newest'`.

### `packages/hub` (AC7, AC12)

- the hub reads its JSON-RPC methods from `packages/contracts/rpc-methods.json` of the tree `DEEP_HUB_CONTRACTS` names
  (default its own contracts). A call of a method with `deprecated_since` is served through the adapter, which at its
  simplest calls `replaced_by` with the same params, and the reply line carries, beside `result`,
  `deprecated: { code: 'deprecated', entry, replaced_by, stops_serving }`. `DEEP_HUB_PLANT=silent-deprecated` serves it
  with no notice.
- `deep install <folder>` for a package whose manifest has `calls: ['hub.ping']` (a list of methods it calls) installs it
  and names the package, the method and `replaced_by` in its output; `deep doctor --json` has an item naming the package
  and the method. Both read the same tree through `DEEP_HUB_CONTRACTS`.
- the public entry exports `contractAdapter(table: RpcEntry[]): { serve(method, params, call): { result, deprecated? } }`,
  synchronous in its own work, where `call(method, params)` is what the hub does for the method that replaced it. AC7's
  50 µs is measured on it, in process.

## Wrong programs

| Wrong program | Criterion | Selected by | What it does | How the test fails on it |
|---|---|---|---|---|
| a step that accepts any break file | AC2 | `DEEP_CONTRACTS_PLANT=any-break-file` | takes a break file for the pair whatever it quotes | the break file quoting `deep.other` passes: `a break file quoting a different line passed` |
| a step that diffs preview entries | AC3 | `diff-preview` | asks for a break file for a reshaped preview entry | `a contract step that diffs preview entries failed the reshaped preview method deep.preview` |
| a host that lets a stable package call a preview method | AC3 | host `plant: 'stable-may-call-preview'` | installs the stable package | `a host that lets a stable package call a preview method installed` |
| a step that covers only the six kinds | AC6 | `six-kinds-only` | skips `slot` and `registry` entries | the slot and the registry without `since` pass: `…passed the hub slot` / `…the hub registry` |
| a step that passes every additive change | AC11 | `pass-every-additive` | passes any optional field, `x-acts` or not | the planted `deny` field passes: `a step that passes every additive change let the planted deny field through` |
| a hub that serves the old method silently | AC12 | `DEEP_HUB_PLANT=silent-deprecated` | no `deprecated` notice | `the hub served the deprecated method hub.ping silently` |
| an installer that rewires the view to `prices@2` | AC10 | host `plant: 'rewires-to-newest'` | wires a use to the newest interface its provider has | `the edge acme/stocks uses ext.acme.prices@1 is wired to ext.acme.prices@2` |
| a release preflight that only reports | AC14 | `report-only` | prints the new failure and exits 0 | `a release preflight that only reports the new corpus failure passed it` |
| a shim answering `unsupported` | AC4 | `unsupported-shim:<method>` | the candidate answers the old method `unsupported` | the step is the one under test: it must FAIL naming the method |

The criteria whose planted thing is data (a removed or reshaped method, a hub slot with no `since`, a missing tracking
issue, a planted `deprecated_since`, a removed function in deep-hook, a rebuilt fixture) plant it in a scratch tree or a
scratch repo and assert both sides: the failing run, and the passing run once it is as the criterion says it passes.

## Readings

- **"The release it arrived in"** is the entry's `since` (`arrived in R2`), not the pair the diff line names. The scene is
  R1 (the scratch tree as it is), R2 (R1 plus the stable method `deep.arrived`, `since: 'R2'`), candidate R3.
- **"A different line"** is the exact line with its entry replaced by another entry's name (`deep.other`).
- **"A minor"** is any change to a key that keeps its `name@major` or numbered name: a new numbered name is a new key and
  never a diff. A field that "can deny, block, answer or lower a verdict" is marked `x-acts` in its schema (the planted
  `deny` field carries `x-acts: 'deny'` and the name `deny`). Exhaustive and extensible are the schema's `x-closure.mark`.
- **Preview methods at install** are by the published API the host is given: the tests set `deep.provide` preview in a copy
  of `extensionApi()`, so what the real contract marks doesn't matter. A first-party package runs in the hub (it is in the
  `release` list), as 349's fixtures do.
- **"Refused at install"** is the first refusal of install, check or load (`admit`), and nothing loaded afterward.
- **"Asks you once … installs nothing until you answer"** (AC10): `install` is a promise that stays pending while the ask
  is open; one card names `acme/stocks`; a second wait finds no second card; `installed()` still lists 1.0.0.
- **`prices@1` and `prices@2`** are `ext.acme.prices@1` and `@2`, the provider is `acme/acme` and the view `acme/stocks`
  (a name a plug-in adds is `ext.<plugin>.<name>`, the plug-in being the name part of the package id).
- **The stocks view's "contract tests"** are what its report reads through its use: exactly a prices@1 reading
  (`{ symbol, cents }`, 12345 cents for the adapter's 123.45), never a prices@2 one.
- **AC7's "compared with the merge base"**: the merge base has no contract step, so its cost is nothing and the lane's whole
  time is the addition; the test checks that the base's `lanes.mjs` has no such lane and reports the base's side. The adapter's
  addition is the p95 over 28,000 samples of (a call through `serve` minus the replaced method called directly), five runs,
  judged by 120's rule (PASS, FAIL, or INCONCLUSIVE when the runs straddle the limit).
- **AC9's baseline** for the crates is the commit at HEAD of the scratch repo, a copy of this checkout's files (tracked and
  new) committed once; the planted removal makes each `pub fn` of deep-hook crate-private, and the failure must name one
  of the functions removed and `deep-hook`. The signature change adds a required `extra` parameter to `deep.registerCheck` in
  `extension-api.json` and, where one exists, in the typed declaration, so the report changes whichever the implementer
  generates it from; with `--write-report` run, the repo passes again.
- **AC13's document** is `{ items: [{ id, kind: 'sparkle@1' }], requires: { preview: [] } }` against a scratch tree whose
  `sparkle@1` schema is preview; `deep-canvas`'s own document check is not run here.

## Criteria to tests

Each test's name starts with its criterion's number. Each `describe` carries the criterion's ID, `#139.<first 8 hex of the
SHA-256 of its text>`, computed on the text trimmed, whitespace collapsed and `- [ ] ` dropped (as `scripts/proof-change.mjs`
does). A test headed `(wrong program)` runs the same scenario against the planted twin the criterion names and expects the
twin to fail the criterion's assertion, naming what it names.

| AC | ID | Tests (file) | At this base |
|---|---|---|---|
| AC1 | `#139.0a8054ec` | `history.test.ts` (4): unchanged passes; removed method names it and its release; removed R1 method; retyped field | no `scripts/contract-diff.mjs` |
| AC2 | `#139.5c4d4a53` | `history.test.ts` (5): a different line fails; no workaround fails; exact line passes and the notes list it; wrong program `any-break-file`; every earlier release | no step |
| AC3 | `#139.607ef4f7` | `preview.test.ts` (6): preview reshaped passes; wrong program `diff-preview`; the stable twin fails; a stable method no piece calls fails (called or preview passes); stable package calling preview refused; wrong program `stable-may-call-preview` | no step; the manifest has no `stability` |
| AC4 | `#139.09f0df5f` | `oldload.test.ts` (6): the pin and the recorded results; the fixture passes; shim `unsupported`; a differing result; a rebuilt fixture; a fixture skipping a method | no step |
| AC5 | `#139.075d6d53` | `since.test.ts` (4): all 163 schemas carry `x-since`; the repo passes its own step; a missing `since` (schema, API); a replaced entry without `replaced_by` | 163 of 163 schemas lack `x-since`; no step |
| AC6 | `#139.3d203a4b` | `since.test.ts` (4): a hub slot, a canvas registry; wrong program `six-kinds-only` on each | no step |
| AC7 | `#139.88ade6c5` | `budgets.test.ts` (2): the contract lane under 30 s; the adapter under 50 µs at p95 | no lane, no `contractAdapter` |
| AC8 | `#139.9dd2cc13` | `corpus.test.ts` (2): every member runs, the known failure apart; a planted break in a gallery kind names the document | no step |
| AC9 | `#139.f5cfafe3` | `apisurface.test.ts` (5): the lane; the clean repo passes; the planted removal; the planted signature change (and the report written); BLOCKED, never PASS | no script, no lane |
| AC10 | `#139.06ef013d` | `prices.test.ts` (4): the update with its adapter; wrong program `rewires-to-newest`; without it: one ask, nothing installed, your yes; your no | the manifest has no `adapter`; no ask |
| AC11 | `#139.f86cd0ad` | `classify.test.ts` (11): unchanged; two additive pass; five breaks fail naming entry and field; a new numbered name passes; wrong program `pass-every-additive`; the real step on `deny` | no step |
| AC12 | `#139.9bbdfea5` | `deprecated.test.ts` (3): the notice; wrong program `silent-deprecated`; `deep install` and `deep doctor` name the package | the hub serves no `hub.ping`; no plant |
| AC13 | `#139.b9c5c209` | `preview.test.ts` (5): no tracking issue; `preview_unrequested`; a listed method installs; listed and stable is refused; a document | no step; no `requires` field |
| AC14 | `#139.493afaff` | `corpus.test.ts` (5): the held release; wrong program `report-only`; accepted with and without its break file; fixed only when it passes; the release lane | no step, no release lane |

## What is not tested

- **A real release.** None is cut at the base; AC4 uses a record made the way a release makes it. A PR for #139 should cut
  R1's record and fixture from the real contracts.
- **The parity boards.** `parity/framework/contract-diff.board` and `old-contract-load.scene` are the issue's Scope; this suite
  tests the steps they would drive, not the files.
- **Scope with no checkbox:** each minor's own frozen digest, MCP tools and event kinds as separate dump kinds beyond
  `schema`/`rpc`, the hub serving each reader at the minor it names, the pack format and `logic@1` exports as entries. A PR
  says how it proves what it claims of them.
- **`deep-canvas`'s document check** for a preview kind or a deprecated kind (AC12 names JSON-RPC, doctor and the install
  check; the canvas side is #371's).
- **Mutation and cargo-semver-checks over every canvas module crate** in the planted run; only deep-hook is planted.
- Nothing here is `Closes #139`-shaped until the criteria's every clause passes; the PR says `Part of #139` for any clause
  it leaves out.

## Files

- `helpers.ts`: temp folders and the clean environment, the step runner and its assertions (`expectFailNaming`, `expectPass`,
  the diff lines), scratch trees (copy, fork, edit, API entries with their digests, schemas, break files, the record of a
  release), the host world, packages, `admit`, the ask approval.
- `history.test.ts` (AC1, AC2), `preview.test.ts` (AC3, AC13), `oldload.test.ts` (AC4), `since.test.ts` (AC5, AC6),
  `budgets.test.ts` (AC7), `corpus.test.ts` (AC8, AC14), `apisurface.test.ts` (AC9), `prices.test.ts` (AC10),
  `classify.test.ts` (AC11), `deprecated.test.ts` (AC12).
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
