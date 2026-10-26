# Acceptance tests for #351: what a package conflicts with or replaces, its envelope digest, and the generated guide

Written first, blind, by a job that never saw an implementation of #351. On October 26, 2026 it read:

- issue #351: its Scope, its 7 checkbox criteria, its Proof and what it depends on
- #44 (the parts), #349, #33 and #13, for scope boundaries only
- `docs/technical-design.md`: Extension API (TypeScript, in-process), with "A first plug-in" (the first-plug-in
  tier and the guide generated from the contract and the hub-slot table, with a drift test as for the skill);
  Composition (declared edges: "a manifest also says what it conflicts with or replaces", "Two pieces can't fill one
  slot", "no manifest replaces the done gate until a second gate exists") and its Hub slots table; Socket roles and
  contract versions (the one canonical form, RFC 8785, covering a package envelope; the trusted path); the layers
  table (the trusted ring: the app shell, the canvas core, the supervisor and the installer; "Plug-ins can't replace
  or extend the ring"); the first-party extensions table's `done-gate` row (`gate@1` opens with the seeded false
  dones once a second gate exists); Threats, "Malicious extensions" (the one package envelope, the digest of its
  files, the publisher's key trusted on first use, a signature that doesn't verify, an update signed by another
  key); and Dogfooding
- `AGENTS.md`
- the acceptance tests of #349, #350, #348 and #26, for their conventions (the drift test "as for the skill" is
  #26's: `scripts/skill.mjs` generates, and a test fails when the output drifts from its source, naming what)
- the packages the surface builds on, through their public entries: `extension-host` (#348/#349's host,
  `EXTENSION_API`, `packageDigest`, `openTrust`, the install and its kits, the `plant` convention, the JSON-RPC
  wire), `contracts` (`extensionApi()`, `hubSlots()`, `canonicalize`, `checkManifest`, extension.manifest@1 and
  package.envelope@1), `conformance` (the check.kind@1 kit and its reference fill), `supervisor`, `cli` (no
  `deep install` yet), `scripts/lanes.mjs`, `scripts/slots-check.mjs`, `scripts/skill.mjs`,
  `scripts/proof-change.mjs` (criterion IDs)
- the base commit `14561af` (origin/main)

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

On macOS, with the repo's Node (24.22.0):

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the journey package imports packages/conformance/dist; scripts read dist
node node_modules/vitest/vitest.mjs run --root tests/acceptance/351 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/351/tsconfig.json   # needs the surface below
```

- **`--no-file-parallelism`:** the files open hosts that start sandboxed packages through the supervisor and run
  check.kind@1's kit, which spawns `node --test`.
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment
  and points `HOME` at a temp folder, so nothing touches the real `~/.deepbuild`.
- **Temp folders:** every package, world, record, checkout, contract copy and home is under `/tmp/dh351-*`, a real
  path, removed after its file. Every host a test opens is closed after its file, which stops what it started;
  nothing is stopped by name or port. No network. Nothing is skipped: at this base every test fails.

## The surface under test

The issue names no module. This job defines the smallest surface, extending the entries that already exist and
using names the issue and the design already use: the installer (`host.install`), the manifest's `replaces` and
`provides`, the one package envelope (`id`, `version`, `digest`, `publisher_key`), the trusted path, the done gate
and `gate@1`, the check kind `journey`, the published contract and the hub-slot table, the extension guide and its
drift test. The tests reach it only through these entries.

### `packages/extension-host/src/index.ts`: the installer

```ts
import type { Connection } from '@deepbuild/record';

export type Plant = /* as today, plus */ 'refuses-only-the-ring' | 'trusts-envelope-digest';

export interface ExtensionHost {
  /* as today, plus */
  /**
   * Trusts a publisher key for a package id: an update of that id signed by it installs from then on. It counts
   * only on the trusted path (connection writer `app`); any other connection is refused or ignored and trusts nothing.
   */
  trustKey(connection: Connection, id: string, key: string): Promise<void>;
}

/** As today, except that deepbuild.json counts without `signature` as well as without `digest`. */
export function packageDigest(folder: string): string;
```

`host.install(from)` reads the manifest as data and refuses a package, rejecting with an `Error` and installing
nothing (what was installed stays), when:

| What | The manifest or files | The refusal's message names |
|---|---|---|
| a conflict (AC2) | `conflicts` lists the id of an installed package | that installed package's id |
| the ring (AC3) | `replaces` lists `app-shell`, `canvas-core`, `supervisor` or `installer` | (no naming asserted) |
| the done gate (AC4) | `replaces` lists `done-gate`, or `provides` an entry whose `interface` is `gate@1`, while `gate@1` has no row in `hubSlots()` | the done gate (`done gate` or `done-gate`) |
| the envelope digest (AC5) | `digest` isn't `packageDigest` of the package's files | the package's id |
| a signature (AC6) | it names `publisher_key` and carries a `signature` that doesn't verify against that key | the key (its hex) |
| a key (AC6) | it is signed by another key than the one trusted for its id: the key of the first signed install of that id, or one you trusted since with `trustKey` | (no naming asserted) |
| a slot (AC7) | its `checks` list a kind an installed package holds, and its `replaces` doesn't list that kind | the installed package's id |

A package whose `replaces` lists the kind installs (after #349's kit), and once it is checked and loaded it alone
holds the kind: `checks()` lists it alone for that kind and `runCheck` reaches only its runner.

The two planted twins, tests only:

- `'refuses-only-the-ring'`: refuses the ring's four pieces as the host does, and installs a package that replaces
  the done gate or provides `gate@1`.
- `'trusts-envelope-digest'`: takes the manifest's `digest` as the package's digest without hashing its files: it
  installs a package whose files don't match, and the `Installed` it returns and lists carries that `digest`.

### `packages/contracts`: the manifest and the envelope

extension.manifest@1 gains `conflicts` (an array of `owner/name` ids) and `signature`; package.envelope@1 gains
`signature`. The refused packages here are never checked, so the tests don't depend on the schema's details beyond
the two examples passing conformance.

### The signed envelope

- `publisher_key`: `ed25519:` followed by the 64 lower-case hex digits of the raw 32-byte Ed25519 public key.
- `signature`: the 128 lower-case hex digits of the Ed25519 signature of `canonicalize({ id, version, digest,
  publisher_key })` (`@deepbuild/contracts`' RFC 8785 bytes of the package.envelope@1 fields), with `digest` the
  envelope digest. `packageDigest` leaves `signature` out of deepbuild.json, so writing it after the digest
  changes nothing (`helpers.ts` checks this when it signs a package).

### The guide: `docs/extension-guide.md`, `docs/extension-guide/` and `scripts/guide.mjs`

- `node scripts/guide.mjs` writes `docs/extension-guide.md` from `extensionApi()` and `hubSlots()`.
- `node scripts/guide.mjs --check [--api <extension-api.json>] [--table <hub-slots.json>]` is the drift test: it
  compares `docs/extension-guide.md` with the published contract, or with the copies the flags name, and prints
  one `PASS guide: …` line, or one `FAIL guide: <name>: <reason>` line per finding, `<name>` being the method
  (`deep.frobnicate`) or the slot (its method and variant, or its interface); it exits 0 on PASS, 1 on any FAIL,
  and 3 (BLOCKED) when the built packages it reads are missing, as `slots-check.mjs` does. A lane of
  `scripts/lanes.mjs` runs it (the test checks the lanes' text names `scripts/guide.mjs`).
- The guide names its two worked examples by their folders, `extension-guide/typescript` and
  `extension-guide/json-rpc`.
- Each example is a package folder: `deepbuild.json`, its code, and `example.json`:

  ```ts
  interface ExampleRun {
    check: string;     // the check kind the example registers, one its manifest's `checks` lists
    runs: { spec: CheckSpec; expect: { outcome: CheckResult['outcome']; testsRun: number } }[];
  }
  ```

  `typescript/` has an `index.ts` and no `main`; `json-rpc/` has a `main` whose first line is
  `#!/usr/bin/env <interpreter>` (or an absolute `#!` path) and no `index.ts`, and speaks #348's JSON-RPC wire.
  The runs include at least one expecting `passed` and one expecting `failed`.

## Readings

Where the issue is silent, this job read:

- **Build (AC1).** Building an example is what the guide's reader does before installing it: copy the folder, point
  a `main`'s `#!/usr/bin/env <interpreter>` line at that interpreter's real path on this machine (as #348's
  JSON-RPC test does for python3) and make it executable, and write the envelope digest. Neither example is in
  DeepBuild's signed release, so both run sandboxed, out of process, as a reader's own package would.
- **An example's run (AC1).** The examples are the implementer's, so what each does is theirs; "run against the
  host" is read as: loaded, its check kind in use, and each run example.json declares answered by the host's
  `runCheck` as declared. A check kind is used because it is the one call #348's wire carries out of the sandbox
  both in TypeScript and over JSON-RPC today; an example may show more. Requiring one passing and one failing run
  means the example's code has to read the spec it is given (the sandbox can't reach the checkout).
- **The drift test (AC1).** "A method the contract publishes" is an `extensionApi()` entry; "a slot" is a
  `hubSlots()` row. The tests plant on copies: a method `deep.frobnicate` with no guide entry; a
  `deep.registerSource` variant `webhook` with its row (`webhook.source@1`); and the contract without
  `deep.notices.send`, so the guide's entry for it is an entry for a method the contract doesn't publish. "Naming
  it" is a `FAIL guide` line containing the method, or `webhook` for the slot. That the drift test runs in the
  preflight is read from "a drift test": one no lane runs proves nothing.
- **Conflicts (AC2).** `conflicts` lists package ids. The tests take the smallest reading, the new package declaring
  the conflict; whether an installed package's declaration also blocks the other is the implementer's, and no test
  depends on it. "The conflict" is the installed package it conflicts with.
- **The ring (AC3).** `app-shell`, `canvas-core`, `supervisor`, `installer`: the design's names for the four pieces,
  written as the first-party extensions table writes `done-gate`. Each is tried by a package inside the release
  and one outside it.
- **The done gate (AC4).** "The done gate already installed, a test gate here" is `deepbuild/done-gate`
  (fixtures/gate), a first-party package in the hub; it "keeps judging" when its check kind still fails a false done
  and passes the real fix after each refusal. A package replaces it with `replaces: ["done-gate"]`; it provides a
  second one beside it by providing `gate@1`, the done gate's interface the design names. How the host knows which
  package is the done gate isn't tested. The "until" clause can't run today: no second gate exists and `gate@1`
  has no slot row or kit, which the test checks first, failing with a message asking for a redraft if it opens.
- **The digest (AC5).** "Doesn't match its files" is a package whose files changed after its digest was written.
- **Keys (AC6).** Ed25519, which Node has built in; a signature that doesn't verify is one made with another key
  than the one the envelope names. Trust on first use is per package id. "The trusted path" is the app (writer
  `app`), as project trust has it; a `deep mcp` connection's call (an agent's) trusts nothing, whether it throws or
  not.
- **What replaces the first (AC7).** Under the manifest contract a bare check kind passes only when the package
  lists it in `replaces` (#349's reading), so `replaces: ["journey"]` is the declaration that a piece replaces the
  journey in use, whichever package holds it; the first package lists it too, replacing the shipped kind. "Only it
  runs journeys" is: the host lists the replacement alone for `journey`, and a journey run reaches its runner and
  not the first's (each journey package counts its runs in a file).
- **Naming.** Each refusal's message must contain the name the criterion gives (an id, the key's hex, `done gate`);
  no test matches whole sentences.

### Scope the tests leave alone

These are in the issue's Scope with no checkbox criterion, so nothing here tests them, and a PR should say how it
proves what it claims of them: `deep install` showing the package's source and permissions first; the kernel
contract versions a manifest runs on; the guide starting with the first-plug-in tier and marking each method with
the release it arrives in; how the two examples are written. Also untested: an unsigned update of a signed package,
a trusted key surviving a restart, and the day `gate@1` opens.

## Criteria to tests

Each test's name starts with its criterion's number. Each `describe` carries the criterion's ID,
`#351.<first 8 hex of the SHA-256 of its text>`, computed on the text trimmed, whitespace collapsed and `- [ ] `
dropped (as `scripts/proof-change.mjs` does). A test headed `(wrong program)` runs the criterion's assertion on the
planted twin it names, first checking the twin is that twin, and expects the assertion to fail.

| ID | Criterion (short) | Tests | At this base |
|---|---|---|---|
| AC1 `#351.1d3d1e53` | the examples build, pass conformance and run; drift fails naming the method or slot | `guide.test.ts` (6): TypeScript example; JSON-RPC example; the guide, its drift test passing and in a lane; a published method with no entry; a published slot with no entry; an entry for an unpublished method | fails (no guide, examples or script) |
| AC2 `#351.83b84661` | a conflicting install is refused, naming the conflict | `conflicts.test.ts` (1) | fails (installs it) |
| AC3 `#351.542cefd7` | replacing the app shell, canvas core, supervisor or installer is refused at install | `ring.test.ts` (4), one per piece | fails (installs it) |
| AC4 `#351.f151ca10` | replacing the done gate, or a second gate beside it, refused naming the done gate; it keeps judging; a ring-only host fails | `done-gate.test.ts` (2): both refusals and the gate judging; wrong program `refuses-only-the-ring` | fails (installs it; no plant) |
| AC5 `#351.86308453` | a digest that doesn't match the files is refused naming the package; a trusting installer fails | `digest.test.ts` (2): the refusal and a matching package; wrong program `trusts-envelope-digest` | fails (installs it; no plant) |
| AC6 `#351.838460c6` | a bad signature refused naming the key; an update by another key refused until you trust it on the trusted path | `signature.test.ts` (2): the bad signature and a good one; the update, an agent's trust, yours | fails (`packageDigest` counts the signature) |
| AC7 `#351.c5e40eeb` | a second journey without `replaces` refused naming the first; with it, installs and only it runs journeys | `journey.test.ts` (2) | fails (installs it; both hold journey) |

## Wrong programs

| Twin | Criterion | Where | What it does | How the test fails on it |
|---|---|---|---|---|
| host `plant: 'refuses-only-the-ring'` | AC4 | the host | refuses the ring's pieces and nothing else | the package replacing the done gate installs; the assertion says the done gate is not replaceable |
| host `plant: 'trusts-envelope-digest'` | AC5 | the host | takes the envelope's digest without hashing the files | the altered package installs, carrying the envelope's digest; the assertion names the package |
| a planted contract copy | AC1 | `guide.test.ts` | a method, a slot, or a missing method the guide doesn't follow | the drift test's `FAIL guide` line names it |

The criteria that name no twin (AC2, AC3, AC6, AC7) fail on the base, which has none of the refusals; each also
checks the same package installs without the declaration (AC2, AC3, AC4) or properly signed (AC6), so a host
refusing everything fails them too. Past that, the mutation lane is their wrong program.

## Files

- `helpers.ts`: the environment cleanup, temp folders, the world, hosts, test packages (stamped, or signed), the
  guide's examples built, and the drift test run on contract copies.
- The test files: `guide.test.ts` (AC1), `conflicts.test.ts` (AC2), `ring.test.ts` (AC3), `done-gate.test.ts`
  (AC4), `digest.test.ts` (AC5), `signature.test.ts` (AC6), `journey.test.ts` (AC7).
- `fixtures/`: the test packages: `plain` (registers nothing; the tests write its declarations), `gate` (the test
  done gate), `journey` (the reference check.kind@1 fill, counting its runs). Their `index.ts` files carry a
  `.fixture` suffix, so this suite and `tsc` skip them. The issue's Proof fixtures (one per refused install) and
  the guide's examples are the implementer's.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
