# Acceptance tests for #1853: `deep.asks.create` and `deep.evidence.put` in the extension host

Written first, blind, by a job that saw only issue #1853, `docs/technical-design.md` (Extension API, Building
blocks, Access, Dogfooding), `AGENTS.md` and the base commit `118ec119f`. The implementer doesn't edit these files; a
dispute goes to a blind redraft of this job.

## How to run

```sh
npm ci && npm run build --workspaces      # once
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1853 --no-file-parallelism
```

Every package runs sandboxed through the supervisor; folders are under `/tmp/dh348-*` and removed after each file;
#348's helpers scrub `CLAUDE*`/`DEEP_*` and point `HOME` at a temp folder. Nothing is stopped by name or port.

## Criteria and tests

| Criterion | Test (file) |
|---|---|
| AC1 `#1853.01b6e40d` | the choice ask is in Needs you, written as `ext:test/caller` (asks.test.ts) |
| AC2 `#1853.0137571d` | an ask carrying `answer` / carrying `outcome` is refused naming the field, no ask opens (asks.test.ts, two tests) |
| AC3 `#1853.873fd8fa` | a file in the package's folder: sha256 back, store holds it with the extension as origin; a file outside is refused naming its path (evidence.test.ts, two tests) |
| AC4 `#1853.de6b19fd` | the walk of every published method ends with 0 not-wired calls (walk.test.ts) |
| AC5 `#1853.f5e2722b` | (wrong program) a planted unwired method fails the walk, naming it (walk.test.ts) |

On the base all 7 fail at an assertion (BASE-FAILURE.txt): AC1, AC3 and AC2 on `deep.<method> isn't wired into this
host yet`; AC4 naming exactly `deep.evidence.put` and `deep.asks.create`; AC5 because the base publishes no planted
method (the walk package's `deep` lacks it: `outcome: 'missing'`).

## The surface under test

- **The host**: `openExtensionHost` from `packages/extension-host/src/index.ts`, opened with the options the hub
  passes in `packages/hub/src/core.ts` (record, supervisor, trust, home, release, `evidence`) plus `asks`, the
  asks core (`openAsks`) the issue wires in. Packages go through `install`, `check`, `load` (must load in the
  sandbox), and report through a check kind they register, read with `runCheck` (#348's `report`).
- **Needs you** is the asks core's `needsYou()`; the ask's writer is the record's `ask.created` event whose handle
  (`ask:<event id>` or its subject) is the value `deep.asks.create` returned.
- **The evidence store** is `openEvidenceStore`, read through `get(sha256)` and `read(sha256)`.

### Shapes the implementer must meet (assumptions)

- `deep.asks.create(ask)` takes ask.created data (kind, question, options, recommended, deadline, fallback,
  default, provisional, owner, key, pinned_to; the test gives every field) and returns the ask's handle `ask:<id>`.
  The host's `asks` option is the asks core it raises through. A refusal's message names the field (`answer`,
  `outcome`).
- `deep.evidence.put(file)` takes a path **relative to the package's own folder** (its install, which is its
  sandbox's working folder and HOME): that folder is what the `files` access word grants. It returns the lower-case
  hex sha256. A path outside it (the test passes an absolute path in another temp folder) is refused with a message
  containing that path. The `files` grant is the manifest's `access: { words: ['files'] }`; `HostGrant` has no
  folder field, so none is given.
- **"the extension as origin"**: evidence's `origin` is the closed enum deepbuild/you/agent, which can't name an
  extension. The test asks that the stored `origin` or `source` names `test/caller` (for example source
  `ext:test/caller`, the connection's writer), and that the origin is neither `you` nor `deepbuild`.

## The walk (AC4, AC5)

#348's walk package (`../348/fixtures/walk`, via its `pkg`) calls each method in `methods.json` once (3 s each),
here holding every grant a method needs: access words record, files, hosts, agent, run_as_you, canvas; a notices
block; `requires.preview` listing every preview method of the published contract; install grant `record: ['*']`
and one host; run-as-you approved on the trusted path. A call may answer or refuse its arguments; `walkProblems`
fails a method that wasn't called, timed out, ended in the not-wired error, or was refused a grant the walk holds.
AC4 first checks the host's `EXTENSION_API` equals the published `extensionApi()` (a guard; it passes on the base).

### Wrong program (AC5)

`plant: 'unwired-method'`, an option of `openExtensionHost` the implementer adds to `Plant`: the planted host
publishes one more method, `deep.planted.unwired` with `needs: null` (in the API its packages' `deep` offers and
dispatch accepts) and has no case for it, so a call throws `deep.planted.unwired isn't wired into this host yet`.
A test-side plant can't do this: a method outside the host's schema is refused as "isn't in the extension API",
never reaching the not-wired default.

## Deviation: "through a running hub"

The proof asks for tests through a running hub. These compose the hub's extension host in-process, as #348's suite
does, rather than starting `deep hub run`: the hub at the base passes no asks core to its host
(core.ts's `openExtensionHost` call), and nothing on the hub's socket would carry a sandboxed package's call
results back except through the methods under test. An end-to-end run through the real hub stays for the
implementer's own e2e.
