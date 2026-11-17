# Acceptance tests for #2790: the guide's entry for `deep.registerPort`

Written first, blind, by a job that never saw a fix for #2790; none existed. On November 17, 2026 it read:

- issue #2790, live (`gh issue view 2790 --repo windoliver/deepbuild`): what is wrong, where it bites and its three
  acceptance criteria
- `docs/technical-design.md`: Extension API (the `deep.registerPort(name, port)` line, the layers table's Port row and
  the Hub slots row), "A first plug-in" (the extension guide and the first-plug-in tier) and Dogfooding;
  `docs/canvas-primitives.md`, "Port"; `AGENTS.md`
- the base commit `3cf41958f` (origin/main), for the surfaces the issue names: `scripts/guide.mjs`,
  `docs/extension-guide.md`, `packages/contracts/extension-api.json` (the `deep.registerPort` entry),
  `packages/extension-host/src/host.ts` (`case 'deep.registerPort'`), `tests/acceptance/351/` (README, `guide.test.ts`,
  `helpers.ts`), `scripts/proof-change.mjs` (`criterionId`) and `scripts/lanes.mjs`
- for conventions and shape only, #2745's blind tests (`tests/acceptance/2745/`, in open PR #2766, not on this base):
  the same drift for another method

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding).

## How to run

```sh
node --test --test-reporter=spec tests/acceptance/2790/guide.test.mjs
```

A few seconds on a quiet machine. It needs `node_modules` and the built packages (`npm run build --workspaces`):
generating the guide imports `packages/extension-host/dist`, and #351's `guide.test.ts` loads
`packages/evidence/dist/patterns.json`. No network. Nothing is written in the repo: `node scripts/guide.mjs` without
`--check` writes `docs/extension-guide.md` and the two examples' `deepbuild.json` (their `digest`, which can differ by
umask), so the tests run a copy of the script in a scratch tree under the system's temp folder (`helpers.mjs`,
`generate`), removed when the process ends. `--check` only reads, and runs in the repo. Nothing is stopped by name or
port.

`BASE-FAILURE.txt` is this command's output at the base: the four criterion tests fail, each on the missing
`deep.registerPort` description or entry.

## Criterion → test

The issue's criteria are `- [ ]` boxes under `### Acceptance criteria`, so `scripts/proof-change.mjs` reads them. Each
ID is `criterionId`'s hash of the box's text (first 8 hex digits of its SHA-256, trimmed, white space collapsed).

| Criterion | Test in `guide.test.mjs` | At the base |
|---|---|---|
| `#2790.56435eb8` `scripts/guide.mjs` says what `deep.registerPort` is for, as the design's Extension API and the host give it | `AC1 #2790.56435eb8 …`: the repo's `scripts/guide.mjs`, run in a scratch tree, has no complaint of `deep.registerPort` and writes a guide with an entry for it whose prose says every clause of the criterion (below) | `node scripts/guide.mjs` exits 1: `FAIL guide: deep.registerPort, deep.source.ask: scripts/guide.mjs says nothing of what each is for` |
| `#2790.92d7996b` `docs/extension-guide.md` is regenerated … and `node scripts/guide.mjs --check` prints no line that names `deep.registerPort` | `AC2 #2790.92d7996b node scripts/guide.mjs --check prints no line …`: the drift test runs to its verdict (`PASS guide` and exit 0, or `FAIL guide` lines and exit 1) and no line of its output names `deep.registerPort` | the issue's two `FAIL guide: deep.registerPort: …` lines |
| the same | `AC2 #2790.92d7996b docs/extension-guide.md is regenerated …`: the guide has an entry for `deep.registerPort` carrying the digest the contract publishes it under, and the file is byte for byte what the repo's `scripts/guide.mjs` writes | the guide has no entry for `deep.registerPort` |
| `#2790.d87e08da` the drift case of `tests/acceptance/351/guide.test.ts` fails on no line that names `deep.registerPort` | `AC3 #2790.d87e08da …`: runs that file's four drift cases with vitest, as #351's README runs it (`--root tests/acceptance/351 --no-file-parallelism guide.test.ts -t …`); all four run, and each passes or fails only on `FAIL guide: deep.source.ask: …` lines | `AC1 the guide is generated from the published contract … its drift test passes on the contract …` fails on four lines, two of them `deep.registerPort`'s; the other three pass |

A fifth test, `the judges …`, is no criterion: it proves the judge of AC1 and the rule of AC3 fail wrong inputs, and
passes at any commit.

**AC3 runs four of the file's six cases.** The issue's "drift case" is `AC1 the guide is generated …`, the one that
runs `--check` on the contract; the three beside it run `--check` on planted copies of the contract through the same
script, so a fix that broke them would show here. The other two (`the TypeScript example builds …`, `the JSON-RPC
example builds …`) build, install and run the examples sandboxed; they don't read the guide's text and stay #351's own,
in its lane.

## Beside #2745

At the base the same run fails for a second method, `deep.source.ask`: that is #2745 (PR #2766), not this issue, and
it may land before or after. Every test here holds in both orders, and no test needs `--check` to pass or exit 0.

- **`--check`** (AC2): only lines naming `deep.registerPort` count. Lines for another method, and the exit 1 they
  bring, don't.
- **What the script writes** (AC1, AC2): `scripts/guide.mjs` writes nothing while any published method lacks a
  description. So `generate` runs the script as it is first. If that writes the guide, that is the guide. If it
  complains of `deep.registerPort`, the test fails there. If its only complaint is `FAIL guide: deep.source.ask: …`, it
  is run once more with `--api` on a copy of the contract less `deep.source.ask` (the script's own flag for "other
  copies of the contract"; the copy is in the scratch tree), which writes the guide of every other method. The script's
  text is never changed and no description is supplied for any method.
- **Byte for byte** (AC2): where the guide was written less `deep.source.ask`, the committed guide is compared less its
  `deep.source.ask` entry too, if it has one (heading to next heading). Otherwise the whole files are compared. Either
  way every byte outside that one entry, `deep.registerPort`'s entry among them, must be what the script writes.
- **#351's cases** (AC3): a case may fail only on `FAIL guide` lines that are each `deep.source.ask`'s. A line naming
  `deep.registerPort`, a line of a third name, or a failure with no such line fails AC3.

Once #2745 has landed the second run never happens: the script writes the whole guide, the whole files are compared,
and #351's four cases must pass with vitest exiting 0.

## How a description is judged

The issue fixes what the description says, not its sentence, so no test pins wording. AC1 takes the entry
`scripts/guide.mjs` writes for `deep.registerPort`, drops what the contract gives (the heading, the line with the
release, stability and digest, and the parameter table, so the method's name and its parameters' can't stand in), and
requires of the prose left each clause of criterion 1, as the least any sentence saying it holds, in any order
(`helpers.mjs`, `MUST_SAY`; lower case):

| The criterion's clause | The prose has |
|---|---|
| a plug-in's side of a piece's port | `plug-in`, `piece` and `port` in one clause (no `.`, `;` or `:` between) |
| it lists the entries it takes | `entries` |
| and the occurrence rows it takes | `occurrence(s)` or `row(s)` (the design says "occurrences", the primitives reference "rows") |
| and the sources it gives for readings in | `source(s)` and `reading(s)` |
| it says whether its gear makes sound | `sound` |
| which makes the plug-in a device gate owner | `device gate` and `owner` |
| whatever the document says | `document` |
| registering opens nothing | `opens nothing` or `opens none`, or `never`, `not`, `no`, `nor`, `without` or `n't` before `open…` in the same clause, at most 30 characters back |
| a port opens only after a person clicks Connect | `connect`, `open(s/ed)`, and `person`, `people`, `you` or `your` (the guide's voice says "you") |
| and sends only while the piece plays live | `live` and `play(s/ed/ing)` |

These are the issue's own terms; a description that says the issue's meaning in other words for one of them (say
"the file" for the document) fails, and that goes to a redraft, not an edit here. Terms prove the clauses are present,
not that the sentence is true: a sentence that names every term and says something false of them passes the judge, and
is the final review's to read against the design's Extension API line and `host.ts`.

## Twins

- **The base**: no description and no entry; all four criterion tests fail (`BASE-FAILURE.txt`).
- **Wrong descriptions**, in the fifth test: the issue's own sentence passes the judge; that sentence less any one
  clause is named for exactly that clause; an empty description and `deep.registerRoute`'s description each say none
  of the ten; one saying registering opens the port and that it sends on a replay leaves the last three unsaid.
- **Wrong #351 failures**, in the fifth test: the base's failure (four lines, two naming `deep.registerPort`), a stale
  `deep.registerPort` entry, a line of a third method and a failure with no `FAIL guide` line are each a finding; a
  failure on `deep.source.ask`'s two lines alone is not.
- **Wrong trees**, run by hand at the base through the same functions the tests call (`scriptSays`, `checkIsQuiet`,
  `regenerated`, each taking a tree's root), on scratch trees holding a copy of `scripts/guide.mjs` with lines added
  to its descriptions; results at the end of `BASE-FAILURE.txt`. With the issue's sentence and the guide regenerated,
  all three pass, both with no `deep.source.ask` description (#2745 not landed) and with PR #2766's (landed), so the
  tests can pass in either order. An empty description fails all three. `deep.registerRoute`'s description with the
  guide regenerated passes both AC2 tests and fails AC1. The right description with the base's guide (not regenerated)
  passes AC1 and fails both AC2 tests. A regenerated guide whose `deep.registerPort` entry was then edited by hand
  fails both AC2 tests; one whose `deep.lease` entry was edited fails the byte comparison.
- **AC3 has no tree twin**: #351's file reads the repo's own guide and script, and nothing is written in the repo. Its
  twins are the base and the rule's cases in the fifth test.
