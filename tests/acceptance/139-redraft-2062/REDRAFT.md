# #139 AC10 blind redraft: `#139.06ef013d`, the prices update

Redrafts `tests/acceptance/139/prices.test.ts`, all four of its tests, from the issue, the design and base `7cb1e5c4a`
(origin/main), by a job that never saw any work in progress, its diff or the dispute.

The criterion, word for word from issue #139 (open; read live, `updatedAt` 2026-11-19T07:33:11Z), whose first 8 hex digits
of SHA-256 are `06ef013d`:

> A plug-in update that provides `prices@2` and keeps `prices@1` through its adapter installs, and the stocks view, which
> uses `prices@1`, passes its contract tests against the adapter's outputs; the same update without the adapter asks you
> once, naming the stocks view, and installs nothing until you answer; an installer that rewires the view to `prices@2`
> fails this test, naming the edge

## What it read

- issue #139's body
- `docs/technical-design.md`: Composition whole, Socket roles and contract versions, Dogfooding, How we know version 0
  works, Repo guards (Built to be hard to get wrong), Principles, and Extension API's `deep.provide`, `deep.use` and
  `deep.read`. The job was also told to read a rule named "The graph is declared data"; the base's design holds none by
  that name, so nothing here rests on one
- `AGENTS.md`, `docs/parallel-proof.md`
- at the base: `tests/acceptance/139/` (`prices.test.ts`, `helpers.ts`, README, REDRAFT), `tests/acceptance/103/` (its
  README's manifest section, `helpers.ts`, `wiring`, `versions` and `replace`: how that suite writes manifest rows),
  `tests/acceptance/plans.ts`, `packages/contracts` (extension.manifest@1, extension.compose@1, extension.edges@1, their
  fixtures, `checkManifest`), `packages/extension-host/src` (`compose.ts`, and `host.ts`'s install, contract tests, edges and
  reads), `packages/asks/src` (how an ask is raised, listed and answered), `scripts/proof-change.mjs` (`criterionId`),
  `scripts/wait-ratchet.mjs`, and the REDRAFT files of `112-redraft-3245` and `139-redraft-1802` for form

## What differs from the landed draft, and the sentence each difference rests on

| Where | Landed | Here | Design |
|---|---|---|---|
| acme/acme's `provides` rows (`provides`) | interface, kind, minor, and the adapter on one | and `schema`, the output's JSON Schema, and `digests`, the d1 digest kept for minor 0 | Declared edges: "Each piece's manifest lists what it provides (…) and what it uses, each with a JSON Schema and a version"; a use matches only when "the use's digest is the one the provider keeps for the use's minor"; "A use that states a digest never matches a provider's row that keeps no digests, and the refusal names the edge". The view states a digest, so beside the landed rows its use matches nothing, and the starting world of all four tests is refused |
| acme/stocks's `uses` row (`scene`) | interface, minor, digest | and `schema`, prices@1's JSON Schema as the view was built against it, whose d1 digest is the row's `digest` | the same first sentence, "each with a JSON Schema and a version" |
| the ask test's 1 s wait | `sleep(1_000)`, then no second card | `updateWithAdapter()`, the update that needs no answer, begun once this one had asked and run to its end in a world of its own, then no second card | Repo guards: "Tests wait for the event they need, never for time to pass", where "a file new since the merge base starts at zero" fixed waits and "a suite's own file is judged in the change that adds it" |
| the ask test's "the install waits" | a race of the install with a 200 ms timer reads `waiting` | the install's own state, read after that other update installed, is checked and loaded, is `waiting` | the same |

The event outlasts what it stands in for: a world opened, three packages made, two admitted and an update installed,
checked and loaded, all begun after the ask, against the one install still pending. An install that didn't wait for your
answer is in by then, and `versions` and the state read it. The fourth test still refuses one by its answer: after your
no, 1.0.0 is installed and the install is refused.

The opening comment says what the rows state. `sleep` is no longer imported. Nothing else differs.

## The manifests, row by row

| Manifest | Row | States |
|---|---|---|
| acme/stocks 1.0.0 | uses `ext.acme.prices@1` | its `name@major`, minor 0, its schema and that schema's d1 digest; no piece named, not marked optional, so required. Its check kind is listed, its name `ext.<plugin>.<name>`; `deep.use` and `deep.read` are in `requires.preview` |
| acme/acme 1.0.0 | provides `ext.acme.prices@1` | a reading, minor 0, its schema, minor 0's digest. The view's use matches it: same name and major, minor 0, same digest |
| acme/acme 2.0.0 with the adapter | provides `ext.acme.prices@2` | a reading, minor 0, its schema, minor 0's digest: a breaking change, so a new major |
| | provides `ext.acme.prices@1` | the same row as 1.0.0's, with `adapter: { from: 'ext.acme.prices@2' }`. The view's use still matches it, and the adapter's output holds its schema |
| acme/acme 2.0.0 without it | provides `ext.acme.prices@2` | as above, and no row of `ext.acme.prices@1`, so the view's required use would have no provider |

Each was held to `checkManifest` at the base, and each code `deep.provide` passes the schema its row states.

## What is kept

The packages, their code, the two interfaces and shapes, the order they are admitted in, the published API the host is
given, the adapter row, `edges()`, the view's contract test (exactly a prices@1 reading, 12345 cents for the adapter's
123.45), one card naming `acme/stocks` and `ext.acme.prices@1`, 1.0.0 installed until your answer, your yes and your no, the
planted installer `rewires-to-newest` and the failure it must give (`the edge acme/stocks uses ext.acme.prices@1 is wired
to ext.acme.prices@2`), the `describe` and `it` titles, and `tests/acceptance/139/helpers.ts`, imported unchanged.

## How to run

```sh
node node_modules/vitest/vitest.mjs run --no-file-parallelism tests/acceptance/139-redraft-2062
node node_modules/typescript/bin/tsc -p tests/acceptance/139-redraft-2062/tsconfig.json --noEmit
```

Run it with the shell's own sandbox off: conformance runs each package in the platform sandbox, which doesn't nest.
`BASE-RUN.txt` is the run on the base.
