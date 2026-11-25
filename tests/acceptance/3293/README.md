# Acceptance tests for #3293: a child Vitest's files pick the hub's binaries

I drafted these tests blind from these sources:

- issue #3293, as saved verbatim for this job
- `docs/technical-design.md` (Dogfooding, on blind jobs) and `docs/parallel-proof.md` (section "Binaries for tests")
- AGENTS.md
- the base commit `c1a98fec9`, which has no implementation of this issue

At the base I also read `scripts/proof-binaries.mjs` (`selectBinaries`), `tests/proof-binaries-hub-selection.test.mjs`
(how a fixture repository is built), `tests/acceptance/3178/suites.test.ts` and `lane.json`, one #27 redraft row file,
and `tests/acceptance/1832/` for this format. Nothing is imported from another suite. Per AGENTS.md, the implementing
agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

## Run

With Node 24 and `cargo` on `PATH` (the fixtures run `cargo metadata --offline` on a three-crate scratch workspace):

```sh
npm ci                                       # once, if node_modules is missing
node --test 'tests/acceptance/3293/*.test.mjs'
```

The whole file takes about a second. It builds nothing.

## Surface

`selectBinaries(cwd, [test])` from `scripts/proof-binaries.mjs`, imported by its path, and its result's `target` and
`hub`. Each fixture is a scratch checkout in a temp directory, removed after its test, holding a Cargo workspace with
the binaries `deep-hook`, `deep-show` and `deep-other`, so an empty `target` is never just a missing workspace binary.
The AC3 test runs `selectBinaries` on this checkout itself.

The meta-test in the fixtures is shaped as `tests/acceptance/3178/suites.test.ts` is: it names each row's file as a
string, from the checkout's root, in a `ROWS` array, imports nothing from them, and runs them with
`spawn(process.execPath, [VITEST, 'run', ...files, ...])` where `VITEST` is `join(REPO, 'node_modules/vitest/vitest.mjs')`.
It names neither the hub's nor the CLI's package itself. A hub-reaching row file reaches the CLI through a helper it
imports (`join(process.cwd(), 'packages', 'cli', 'dist', 'main.js')`), as #27's redrafts reach it through `world.ts`.

## Criteria and their tests

The IDs are computed as `scripts/proof-change.mjs` computes them (text after `- [ ] `, trimmed, white space collapsed,
SHA-256, first 8 hex digits). All tests are top-level `node:test` tests in `select.test.mjs`, with no subtests.

| ID | Criterion (short) | Test | What it asserts | Wrong program |
|---|---|---|---|---|
| `#3293.0c0bfd7c` | a test that runs hub-reaching files in a child Vitest gets the hub's binaries | "a 3178-shaped meta-test whose ROWS name a hub-reaching test file …" | ROWS name `111/revive.test.ts` (reaches neither) and `27/repeat.test.ts` (reaches the CLI through `world.ts`). After a fixture check that the row file alone gets `['deep-hook', 'deep-show']`, the meta-test's `target` deep-equals `['deep-hook', 'deep-show']` and its `hub` holds the meta-test | the merge base: `target` is `[]` |
| `#3293.0c0bfd7c` | same | "a node:test file that names a hub-reaching test file in its own vitest.mjs run arguments …" | a `.mjs` test whose `spawnSync(process.execPath, [VITEST, 'run', 'tests/acceptance/27/repeat.test.ts'])` names the row file directly: same `target` and `hub` | the merge base: `target` is `[]` |
| `#3293.da71fe1c` | a test that names no such file still gets none | "a 3178-shaped meta-test whose ROWS name only test files reaching neither package …" | ROWS name `111/revive.test.ts` (imports a plain helper) and `112/other.test.ts`, both real test files, still spawned through `vitest.mjs run`. Beside them sit two hub-reaching tests the meta-test doesn't name: `111/hub.test.ts`, in a named row's own folder, and `27/repeat.test.ts`. After fixture checks (the neighbour gets the hub's binaries, the named rows get none), the meta-test's `target` deep-equals `[]` and its `hub` deep-equals `[]` | passes on the base; proven by a planted wrong program the implementer adds, for example one that gives the hub's binaries to every test that spawns `vitest.mjs run`, follows a named file's whole folder, or follows every test file in the checkout |
| `#3293.5e7eda0a` | #3178 AC1 runs in the before lane | "this checkout's tests/acceptance/3178/suites.test.ts gets deep-hook and deep-show and is in hub …" | `selectBinaries(<this checkout>, ['tests/acceptance/3178/suites.test.ts'])`: `target` deep-equals `['deep-hook', 'deep-show']` and `hub` holds that path | the merge base: `target` is `[]`, the cause the issue names |

### AC3: what is checked by hand

AC3's criterion is a before-lane run (`node scripts/proof.mjs before` over PR #3249's change, or main after it) in
which none of `tests/acceptance/3178/suites.test.ts`'s rows is INCONCLUSIVE because `deep-hook` isn't built. That run
needs bays and takes longer than a test file's 20-minute cap, so it cannot run inside this suite. The test tagged
`#3293.5e7eda0a` checks the cause the issue gives for those INCONCLUSIVE rows, the selection the lane makes for that
file on this checkout. The lane run itself is checked by hand, as the issue's Proof section says: a before-lane run of
#3178 AC1 (`#3178.1821b407`) on the Mac, whose lines for that test show no row skipped for an unbuilt `deep-hook`.

## Base run

`BASE-FAILURE.txt` holds the output of `node --test 'tests/acceptance/3293/*.test.mjs'` on `c1a98fec9`: the two
`#3293.0c0bfd7c` tests and the `#3293.5e7eda0a` test fail at their `target` assertion (`[]` instead of
`['deep-hook', 'deep-show']`), after the fixture checks before it passed; the `#3293.da71fe1c` test passes.

## Readings of the issue

- The issue offers two fixes. These tests follow the criterion's words, "a tagged test that names a test file", and
  the scope, which leaves `tests/acceptance/3178/` unchanged: the fixtures declare nothing extra (no `spawns` export),
  so the fix that follows named test files (the issue's option 1) is the one they expect.
- "its `hub` holds that test" is read as: the selected test's path is among `hub`'s entries, not that `hub` is exactly
  that one path.
- A row file is named as a path from the checkout's root, as in `ROWS`. Paths written relative to the meta-test, or
  folders found at run time (the redraft folders `readdirSync` finds in 3178), are not covered here.
