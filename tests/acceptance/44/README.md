# Acceptance tests for #44: `deep.lease` and a manifest's lease kinds

Written first, blind, by a job that never saw an implementation of what #44 has left. On October 28, 2026 it read:

- issue #44: its body (the parts #348 to #351, all closed and merged; its Proof line) and its one comment, the
  hand-off from #237 (PR #728), which is what remains
- `docs/technical-design.md`: Extension API (TypeScript, in-process), the `deep.lease` line; the Lease building
  block; the Building blocks row "Environment and lease"; Composition; Threats, and what stops each one; Dogfooding
- `AGENTS.md`
- the acceptance tests of #348 (host, sandbox, the JSON-RPC sample, helpers, `plant`, BASE-FAILURE.txt), #237 (the
  lease table) and #351 (this README's surface format), for their conventions
- the public entries the surface builds on: `packages/extension-host/src/index.ts` and `runtime/deep.mjs` (the
  `API` list, `extensionSide`, `peer`), `packages/leases/src/index.ts` (`openLeases`, `LeaseTable`, `LeaseKind`,
  `Caller`, `LeaseResult`), `packages/contracts` (extension.manifest@1, lease.kind@1, `checkManifest`), and
  `packages/hub/src/core.ts` where it opens the lease table and the extension host
- the base commit `7b39aa0` (main)

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## What is required

#44 has no checkbox criteria. What it has left is the comment's two sentences and the body's Proof line. Each is
named here as a requirement, with an ID computed as `scripts/proof-change.mjs` computes a criterion's (the first
8 hex of the SHA-256 of the text, trimmed, white space collapsed), so the tags match if the owner adds them to the
issue as criteria word for word:

| ID | Text |
|---|---|
| R1 `#44.2d670703` | `deep.lease(resource, mode)` in the extension API is this issue's to wire: in the host's dispatch it is `table.lease({ holder: 'ext:<id>' }, { host: 'local', ...resource }, mode)`, returning the grant or the refusal naming the holder. |
| R2 `#44.780b900a` | A manifest's lease kinds go through `table.declare('<id>', kind)` (`lease.kind@1` data), which refuses a match form outside exact, glob, prefix and pool(n), and a name another package declared. |
| R3 `#44.544d1a4a` | Tests for each refusal, failing first, plus a sample extension in TypeScript and one over JSON-RPC. |

## How to run

On macOS, with the repo's Node (24.22.0) and a python3 on PATH:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the host reaches its workspace dependencies through their builds
node node_modules/vitest/vitest.mjs run --root tests/acceptance/44 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/44/tsconfig.json   # needs the surface below
```

- **`--no-file-parallelism`:** the files open hosts that start sandboxed packages through the supervisor.
- **The environment:** `helpers.ts` takes `CLAUDE*`, `DEEP_*` and `AI_AGENT` out of the test process's environment
  and points `HOME` at a temp folder, so nothing touches the real `~/.deepbuild`.
- **Temp folders:** every package, world, record, checkout and home is under `/tmp/dh44-*`, a real path, removed
  after its file. Every host a test opens is closed after its file, which stops what it started; nothing is stopped
  by name or port. No network.
- **Missing tools fail, never skip.** The JSON-RPC tests fail `BLOCKED` when no python3 is on PATH.

## The surface under test

Neither the issue nor the comment names a new module. This job defines the smallest surface, extending the entries
that already exist, with the names the comment and the design already use: `deep.lease(resource, mode)`, the lease
table `@deepbuild/leases` the hub opens on its record, the holder `ext:<id>`, host `local`, `table.declare('<id>',
kind)`, lease.kind@1 data, and a manifest's lease kinds. The tests reach the host only through
`packages/extension-host/src/index.ts` and the table only through `packages/leases/src/index.ts`, unchanged.

### `packages/extension-host/src/index.ts`

```ts
import type { LeaseTable } from '@deepbuild/leases';

/** As today, plus `deep.lease`; which grant (access word) it needs, if any, is the schema's to say. */
export const EXTENSION_API: readonly ApiMethod[];

export type Plant = /* as today, plus */
  | 'skips-kind-declare' | 'drops-mode' | 'holder-from-arguments' | 'declares-kind-on-first-lease';

export interface ExtensionHostOptions {
  /* as today, plus */
  /** The kernel's one lease table (#237), as the hub opens it on its record. */
  leases?: LeaseTable;
}
```

### A manifest's lease kinds

`deepbuild.json` gains `leases`: an array of lease.kind@1 data, `{ name, match, cap, cooldown, cost }`. Admitting the
package (install, check, load) declares each through `table.declare('<id>', kind)`, `<id>` the package's
`owner/name` id, so `table.kinds()` lists each with `plugin: '<id>'`. A kind the table refuses refuses the package,
at install (`install` rejects), at its check (`passed: false`) or at its load (`status: 'refused'`), whichever the
host chooses, with the refusal naming the kind. Kind names are lease.kind@1's (`device.rig`, as the design writes
them), not `ext.<plugin>.` names: a name belongs to the first package that declares it.

### `deep.lease(resource, mode)`

- `resource` is `{ kind, key }`; `mode` is `'exclusive' | 'shared'`.
- The host calls `table.lease({ holder: 'ext:<id>' }, { host: 'local', ...resource }, mode)`, `<id>` the calling
  package's id, never a holder from the call's arguments.
- It resolves with the table's `LeaseResult`: `{ status: 'granted', lease }`, or the refusal
  (`{ status: 'refused', reason, holders, message }`) naming the holder in the way.
- Over JSON-RPC (#348's wire) it is the request `{"method": "deep.lease", "params": [resource, mode]}`, answered
  with that same result.

## Readings

- **Where the lease shows.** A grant is checked three ways: what `deep.lease` returned, `table.leases()` holding
  the same lease, and one `lease.acquired` on record for its ID naming the holder and `{host: 'local', kind, key}`.
- **The refusal naming the holder.** A returned result with `status: 'refused'` whose JSON names `ext:<holder id>`;
  the asker holds nothing on that key afterwards. A rejection doesn't count: the comment says the host returns it.
- **A kind no package declared.** The design says `deep.lease` is for "a resource of a declared lease.kind@1". The
  table throws for one, so the call may reject, or return a result that isn't a grant; either way naming the kind,
  with nothing leased, nothing on record and nothing declared. A "not a function" or "no method" error doesn't count.
- **Any package may lease a declared kind.** The design: "its kind a lease.kind@1 a plug-in declares". So test/beta,
  which declares nothing, leases test/alpha's `device.rig`; that is also how a second package's lease can overlap a
  first's, since it can't declare the same name.
- **The holder from the arguments.** The comment's spread puts the resource's fields after `host`; the tests pass a
  `holder` field in the resource, which a correct host ignores (or refuses the call over). Whether a resource's own
  `host` field overrides `local` isn't stated, so nothing tests it.
- **The grant `deep.lease` needs.** Not stated anywhere. The test packages ask for whatever access word the
  schema's `needs` gives `deep.lease`, so no test depends on it.
- **The control for a refused match form.** At the base, extension.manifest@1 refuses the `leases` field as
  unlisted, echoing the kinds, so a refusal naming the kind proves nothing alone. Each match-form test first admits
  a package whose kind matches by `exact`, which must load.
- **Not tested, as nothing states it:** a lease ending when its package is unloaded or disabled, a host opened
  without `leases`, the exact wording of any message, the hub's own wiring of the table into the host
  (`packages/hub/src/core.ts` opens both; the tests open the host directly, as #348's do).
- **The probe.** Each test package registers the check kind `ext.<plugin>.report`. Running it through
  `host.runCheck` with the request `{resource, mode}` as JSON in the spec's `runner` makes the package call
  `deep.lease` then and report `{result}` or `{error}` as its one failure message (a test convention only, #348's).

## Requirements to tests

Each test's name starts with its requirement; each `describe` carries the requirement's ID. A test headed
`(wrong program)` runs the same scenario on a host opened with the plant it names, and expects that twin to fail
the scenario's assertion (the twin's scenario itself runs).

| Req | Tests | At this base |
|---|---|---|
| R1 | `lease.test.ts`: the schema lists `deep.lease`; a sandboxed TypeScript package's exclusive lease granted to `ext:test/alpha` on `local` (returned, in the table, on record); the same in the hub (a release package, `ext:test/hub`); a second package's overlapping exclusive lease refused naming `ext:test/alpha`, its free key its own; the same on a glob kind (`src/**` against `src/lib/a.ts`); two shared leases both granted; the holder never taken from the arguments; 3 wrong programs | fails |
| R2 | `kinds.test.ts`: manifest kinds listed by `table.kinds()` with the package id; all four match forms declared; `regex`, `pool(0)` and `range` each refused naming the kind (after an `exact` control loads) and never declared; a name another package declared refused naming it, staying the first's; 3 wrong programs | fails |
| R3 | `refusals.test.ts`: `deep.lease` on a kind nobody declared refused naming it, nothing leased or declared; 1 wrong program. `jsonrpc.test.ts`: the Python package (`main`, JSON-RPC) loads sandboxed, its manifest kind declared by `test/pylease`, its `deep.lease` granted to `ext:test/pylease`; refusals both ways between it and a TypeScript package, each naming the other's holder. The TypeScript sample is `fixtures/leaser`, used by every file. R1 and R2's refusals are R3's "each refusal" too. | fails |

## Wrong programs

| Plant (host) | What it does | Test that catches it, and how |
|---|---|---|
| `skips-kind-declare` | admits a package without declaring its manifest's lease kinds | R1 grant: alpha's `deep.lease` on `device.rig` isn't granted. R2 listing: `table.kinds()` lacks `device.rig`. R2 match form: `test/odd` (`regex`) is admitted. R2 taken name: `test/beta` is admitted |
| `drops-mode` | leases every call exclusive | R1 shared pair: beta's shared lease beside alpha's is refused |
| `holder-from-arguments` | takes the holder from the resource's `holder` field when there is one | R1 holder: beta naming `ext:test/alpha` is granted alpha's `rig-1` |
| `declares-kind-on-first-lease` | declares an undeclared kind for its caller on its first lease, and grants it | R3 undeclared kind: `device.none` is granted |

The tests that name no twin fail at the base, where `deep.lease` and the manifest's `leases` don't exist; past it,
the mutation lane is their wrong program.

## Files

- `helpers.ts`: the environment cleanup, temp folders, the world (record, asks, supervisor, trust, the lease
  table), hosts given the table, the package copier (manifest id, `checks`, `leases`, `deep.lease`'s access word,
  the Python path, the digest), admission, the probe call, and the shared assertions `grantedTo` and `refusedNaming`.
- `lease.test.ts` (R1), `kinds.test.ts` (R2), `refusals.test.ts` and `jsonrpc.test.ts` (R3).
- `fixtures/leaser`: the TypeScript sample (`index.ts.fixture`), copied under each test id.
- `fixtures/pylease`: the JSON-RPC sample in Python (`main.fixture`), id `test/pylease`.
  The `.fixture` suffix keeps this suite and `tsc` off the packages' code.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the type check and the run on the base commit.
