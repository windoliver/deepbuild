# Acceptance tests for #2745: the guide's entry for `deep.source.ask`

Written first, blind, by a job that never saw a fix for #2745; none existed. On November 17, 2026 it read:

- issue #2745, live (`gh issue view 2745 --repo windoliver/deepbuild`): what is wrong, where it bites and its three
  acceptance criteria
- `docs/technical-design.md`: "A first plug-in" (the extension guide and the first-plug-in tier) and Dogfooding;
  `AGENTS.md`
- the base commit `3c124dee5` (origin/main), for the surfaces the issue names: `scripts/guide.mjs`,
  `docs/extension-guide.md`, `packages/contracts/extension-api.json` (the `deep.source.ask` entry),
  `packages/extension-host/src/sources.ts` `ask()` and its comment, `tests/acceptance/351/` (README, `guide.test.ts`,
  `helpers.ts`), and for conventions `tests/acceptance/2741/`, `tests/acceptance/2742/`, `scripts/proof-change.mjs`
  (`criterionId`) and `scripts/lanes.mjs`

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding).

## How to run

```sh
node --test --test-reporter=spec tests/acceptance/2745/guide.test.mjs
```

About 4 s. It needs `node_modules` and the built packages (`npm run build --workspaces`): generating the guide imports
`packages/extension-host/dist`, and #351's `guide.test.ts` loads `packages/evidence/dist/patterns.json`. No network.
Nothing is written in the repo: `node scripts/guide.mjs` without `--check` writes `docs/extension-guide.md` and the two
examples' `deepbuild.json`, so the tests run a copy of the script in a scratch tree under the system's temp folder
(`helpers.mjs`, `generate`), removed when the process ends. Nothing is stopped by name or port.

`BASE-FAILURE.txt` is this command's output at the base: the four criterion tests fail, each on the missing
description or entry.

## Criterion → test

The issue's criteria are plain bullets under `## Acceptance criteria`. Each ID is `criterionId`'s hash of the bullet's
text (first 8 hex digits of its SHA-256, trimmed, white space collapsed).

| Criterion | Test in `guide.test.mjs` | At the base |
|---|---|---|
| `#2745.733b48e4` `scripts/guide.mjs` says what `deep.source.ask` is for, as the host serves it | `AC1 #2745.733b48e4 …`: the repo's `scripts/guide.mjs`, run in a scratch tree, exits 0 and writes a guide with an entry for `deep.source.ask` whose prose says every clause of the issue (below) | `node scripts/guide.mjs` exits 1: `FAIL guide: deep.source.ask: scripts/guide.mjs says nothing of what each is for` |
| `#2745.92c22554` `docs/extension-guide.md` is regenerated and `node scripts/guide.mjs --check` passes | `AC2 #2745.92c22554 node scripts/guide.mjs --check passes`: no `FAIL guide` line, exit 0, a `PASS guide` line | exit 1 with the issue's two `FAIL guide: deep.source.ask: …` lines |
| the same | `AC2 #2745.92c22554 docs/extension-guide.md is regenerated …`: the guide has an entry for `deep.source.ask` carrying the digest the contract publishes it under, and the file is byte for byte what the repo's `scripts/guide.mjs` writes | the guide has no entry for `deep.source.ask` |
| `#2745.0609af76` `tests/acceptance/351/guide.test.ts` passes | `AC3 #2745.0609af76 …`: runs that file's four drift cases with vitest, as #351's README runs it (`--root tests/acceptance/351 guide.test.ts -t …`); all four run and pass | `AC1 the guide is generated from the published contract … its drift test passes on the contract …` fails on the same two lines; the other three pass |

A fifth test, `the judge of AC1 …`, is no criterion: it proves the judge below fails wrong descriptions, and passes at
any commit.

**AC3 runs four of the file's six cases.** The other two (`the TypeScript example builds …`, `the JSON-RPC example
builds …`) build, install and run the examples sandboxed; they don't read the guide's text, pass at the base (the
issue: #351 reads FAIL "on this alone") and stay #351's own, in its lane. The whole criterion is proven by this test
together with #351's file run whole at the fix's head:
`node node_modules/vitest/vitest.mjs run --root tests/acceptance/351 --no-file-parallelism guide.test.ts`.

## How a description is judged

The issue fixes what the description says, not its sentence, so no test pins wording. AC1 takes the entry
`scripts/guide.mjs` writes for `deep.source.ask`, drops what the contract gives (the heading, the line with the release,
stability and digest, and the parameter table, so a parameter's own description can't stand in), and requires of the
prose left each clause of the issue, as the least any sentence saying it holds, in any order (`helpers.mjs`,
`MUST_SAY`):

| The issue's clause | The prose has |
|---|---|
| a plug-in asks a model source | `model` and `source` |
| one its manifest lists | `manifest` |
| the hub makes the call | `hub` |
| from a recording when replaying | `recording` or `recorded`, and `replay…` |
| the plug-in gets the answer's status and body | `status` and `body` |
| or no answer | `no answer`, `no reply`, `without an answer`, `none` or `nothing` |
| never the network | `network`, with `never`, `not`, `no`, `without`, `nor` or `n't` before it in the same clause, at most 30 characters back |

These are the issue's own terms; a description that says the issue's meaning in other words for one of them (say
"the kernel" for the hub) fails, and that goes to a redraft, not an edit here. Terms prove the clauses are present, not
that the sentence is true: a sentence that names every term and says something false of them passes the judge, and is
the final review's to read against `sources.ts` `ask()`.

## Twins

- **The base**: no description and no entry; all four criterion tests fail (`BASE-FAILURE.txt`).
- **Wrong descriptions**, in the fifth test: the issue's own sentence passes the judge; that sentence less any one
  clause is named for exactly that clause; an empty description, `deep.fetch`'s description and one saying the plug-in
  reads the network each fail.
- **Wrong trees**, run by hand at the base through the same functions the tests call (`scriptSays`, `checkPasses`,
  `regenerated`, each taking a tree's root), on scratch trees holding a copy of `scripts/guide.mjs` with one line added
  to its descriptions; results at the end of `BASE-FAILURE.txt`. With the issue's sentence and the guide regenerated,
  AC1 and both AC2 tests pass, so the tests can pass. An empty description fails all three. `deep.fetch`'s description
  with the guide regenerated passes `--check` and fails AC1. The right description with the base's guide (not
  regenerated) passes AC1 and fails both AC2 tests.
