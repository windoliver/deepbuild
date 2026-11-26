# #350 AC9 blind redraft: `#350.bff15b51`, removing a provider

Redrafts `tests/acceptance/350/ac9-redraft/ac9.test.ts`, both of its tests, from the issue, the design and base
`7cb1e5c4a` (origin/main), by a job that never saw any work in progress, its diff or the dispute.

The criterion, word for word from issue #350 (read live, `updatedAt` 2026-10-26T04:58:34Z), whose first 8 hex digits of
SHA-256 are `bff15b51`:

> With A using B's output, removing B detaches A's use before B's handlers stop; a host that stops B first fails, naming
> the edge

## What it read

- issue #350's body
- `docs/technical-design.md`: Composition whole, Socket roles and contract versions, Dogfooding, How we know version 0
  works, Repo guards (Built to be hard to get wrong), Principles, and Extension API's `deep.provide`, `deep.use` and
  `deep.read`. The job was also told to read a rule named "The graph is declared data"; the base's design holds none by
  that name, so nothing here rests on one
- `AGENTS.md`, `docs/parallel-proof.md`
- at the base: `tests/acceptance/350/` (README, `helpers.ts`, `judges.ts`, `ac9-redraft/`, `fixtures/provider`,
  `fixtures/user`), `tests/acceptance/103/` (its README's manifest section, `helpers.ts`, `wiring`, `versions` and `replace`:
  how that suite writes manifest rows and answers a removal's ask), `tests/acceptance/plans.ts`, `packages/contracts`
  (extension.manifest@1, extension.compose@1, extension.edges@1, their fixtures, `checkManifest`),
  `packages/extension-host/src` (`compose.ts`, and `host.ts`'s removal, reads and edges), `packages/asks/src` (how an ask is
  raised, listed and answered), `scripts/proof-change.mjs` (`criterionId`), `scripts/wait-ratchet.mjs`, and the REDRAFT files
  of `112-redraft-3245` and `139-redraft-1802` for form

## What differs from the landed draft, and the sentence each difference rests on

| Where | Landed | Here | Design |
|---|---|---|---|
| B's `provides` row | interface, kind, minor (the fixture's own) | and `schema`, the feed's JSON Schema, and `digests`, the d1 digest kept for minor 0, written over the fixture's row by helpers.ts's `pkg` | Declared edges: "Each piece's manifest lists what it provides (…) and what it uses, each with a JSON Schema and a version"; a use matches only when "the use's digest is the one the provider keeps for the use's minor"; "A use that states a digest never matches a provider's row that keeps no digests, and the refusal names the edge". A states a digest, so beside the landed row A's use matches nothing: A is refused and nothing is left to detach |
| A's `uses` row | interface, minor, digest | and `schema`, the feed's JSON Schema, whose d1 digest is the row's `digest` | the same first sentence, "each with a JSON Schema and a version" |
| A's code | `deep.use('ext.b.feed@1', { optional: true })`, beside a row that marks nothing | `deep.use('ext.b.feed@1')` | Declared edges: the manifest lists what a piece uses, and "A use is required unless it's marked optional: removing the provider of a required use asks you once, naming its users". The landed draft says A's use stays required and its row says so, while its code marked it optional, so whether the removal asks rested on which of the two a hub reads. Row and code now say the same |
| when B is removed, and how long A reads | 0.8 s after A's report starts; A reads for 3 s | once A has made 100 reads (A writes a file, the test waits for it); A reads on until 50 reads after the test said B is removed, bounded by 50 s inside the report's own 60 s | Repo guards: "Tests wait for the event they need, never for time to pass", where "a file new since the merge base starts at zero" fixed waits and "a suite's own file is judged in the change that adds it"; Principles: "Every wait ends by its deadline, and a test waits for its event, never for time" |
| the wait for the removal's ask | the inbox read every 50 ms | the inbox read when the host raises an ask (its asks core's `raise` says so) | the same |
| `gone` | every 50 ms, 100 times | `vi.waitFor` on the processes' end, 5 s | the same |

A's fixture is this folder's own (`fixtures/user`), made into a package by `packageA` as helpers.ts's `pkg` makes one; B's is
the landed `fixtures/provider`, unchanged but for its row. The 20 s bound on the removal stays, as a deadline.

## The manifests, row by row

| Manifest | Row | States |
|---|---|---|
| test/b 1.0.0 | provides `ext.b.feed@1` | a reading, minor 0, its schema (the one its code passes `deep.provide`), minor 0's digest; its name `ext.<plugin>.<name>`; `deep.provide` is in `requires.preview` |
| deepbuild/a 1.0.0 | uses `ext.b.feed@1` | its `name@major`, minor 0, its schema and that schema's d1 digest; no piece named, not marked optional, so required. It matches test/b's row: same name and major, minor 0, same digest. Its check kind is listed, its name `ext.<plugin>.<name>`; `deep.use` and `deep.read` are in `requires.preview` |

Both were held to `checkManifest` at the base.

## What is kept

A first-party in the hub, B sandboxed, the edge `deepbuild/a uses ext.b.feed@1 from test/b`, A reading back to back across the
removal, the host given the world's asks core, removing B as `disable` together with your yes to each ask raised while it
waits (a hub that asks nothing removes B as before; whether it asks, and how often, is #103's criterion, and the count is
only in the failure message), the judge (`judgeDetach`), B's processes ended within 5 s, the planted host
`stop-provider-first` and the failure it must give (`the edge …`, `after B's handlers stopped`), the `describe` and `it`
titles, and `tests/acceptance/350/helpers.ts` and `judges.ts`, imported unchanged.

## How to run

```sh
node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/350-redraft-2062
node node_modules/typescript/bin/tsc -p tests/acceptance/350-redraft-2062/tsconfig.json --noEmit
```

Run it with the shell's own sandbox off: B runs in the platform sandbox, which doesn't nest. `BASE-RUN.txt` is the run on
the base.
