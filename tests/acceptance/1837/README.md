# Acceptance tests for #1837: design lines owed by merged PRs, and the catalogue drift lane over their event kinds

These tests were drafted blind from issue #1837 (its text as of November 22, comments not read), AGENTS.md,
`docs/technical-design.md` (the sections the issue links, Dogfooding, Wrong programs), `docs/canvas-primitives.md`
(The event catalogue) and the base commit `2eaaeb0e6`, which is `origin/main`. At the base I also read
`scripts/catalogue-drift.mjs`, `scripts/lanes.mjs` (the lane's entry), `packages/contracts/src/catalogue.ts` and
`schemas.ts`, `packages/contracts/schemas/`, `scripts/not-event-kinds.txt`, `scripts/proof-runs.mjs` (how a twin is
laid) and `scripts/closed-sweep.mjs` (the criterion ID), and the suites `tests/acceptance/605/`, `1329/` and `2063/`.
The scratch copy, fake `gh` and lane runner are copied from 2063's `helpers.mjs` into `helpers.mjs` here, never
imported. Per AGENTS.md the implementing agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

The issue has one criterion, `#1837.78b8f3bb` (first 8 hex digits of the SHA-256 of its `- [ ]` text, trimmed, white
space collapsed, as `scripts/closed-sweep.mjs` works it out). Every test names it at the start of its title.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing
npm run build -w packages/contracts      # the lane and the catalogue read packages/contracts/dist
node --test 'tests/acceptance/1837/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. All are offline: no test reaches
GitHub. A lane run takes under a second in a scratch copy; each has a 900 s limit for a loaded machine's throttle.

## Which names are event kinds

The Scope names 21 things across eight items. An event kind is a name the published catalogue holds as a kind: a schema
in `packages/contracts/schemas/` whose root has `kind`, `v` and `x-feeds` (`buildCatalogue`), which is how the
catalogue is "generated from the kinds' schemas" (canvas-primitives.md, The event catalogue).

| Item | Event kinds (`KINDS`) | Not event kinds, and what each is at the base |
|---|---|---|
| #112 | none | the configuration eval, its gate lane, `RecordReader.sessions()` (a method) |
| #724 | none | the perf lane's instructions-retired comparison |
| #723 | none | the learned layer's loosening rule and the reload check |
| #907 | none | the kept `cpu.slot` slot, the 30-minute cap |
| #606 | `ask.superseded`, `ask.moot`, `task.completed` | `access@1`: a schema of manifest access words, no `kind`, no `x-feeds` |
| #342 | `session.archived` (`@1`), `resource.created` (`@1`) | `resources`: a `done.yaml` key; `transcripts.archived`: an adapter facts field (`archived` under `transcripts`) |
| #20 | `transcript.archived` (its `@2`'s `source` field), `archive.quiet`, `ci.archived` | CI log retention |
| #1731 | none | `asset.library@1`: a hub slot's interface, with no schema file at the base |

So `KINDS` is those eight. A version suffix in the Scope (`session.archived@1`) names the kind's schema version; the
kind is the name before `@`.

## How "has its line" is checked

`ITEMS` in `helpers.mjs` gives each item one or more facts. A fact holds when **one line** of
`docs/technical-design.md` holds every one of its markers, case-insensitive phrases or backticked names taken from the
item's own Scope wording. A design paragraph and a table row are each one line there. An item with several names in
its Scope (#606, #342, #20) has a fact per name, since one line needn't hold them all. #1731's fact must be a row of a
table whose header starts `| Slot |`, the hub-slot table. Paraphrase is allowed where the Scope's wording is a
description rather than a name: "perf judges" is met by "perf" on the line, "a held stop's quick checks" by
"held stop" with "fast-lane checks" or "quick checks", and `transcripts.archived` by `` `transcripts.archived` `` or by
`` `archived` `` and `` `transcripts` `` on a line that also says "facts". The section is not checked: the base's lines sit
where their subjects are (Composition, the asks, the archive row), not only in the two sections the issue links.

## The surface

- **The lane is the one entry of `checks` in `scripts/lanes.mjs` whose name matches `/catalogue|drift/i`,** run alone
  through the copy's own `runLanes([lane])`, as `scripts/checks.mjs` runs lanes. Its verdict is the `PASS <name> (…)` or
  `<STATE> <name>: …` line `runLanes` prints, and its return.
- **The scratch copy** holds the root's files, `scripts/`, `packages/contracts/` (with its built `dist/`) and the
  checkout's two design docs, with a fresh `git init` and `HOME`, `TMPDIR` and XDG folders in the sandbox, no GitHub
  token, `DEEP_OPEN_ISSUES` unset.
- **The fixed open-issue list** is served by a fake `gh` first on `PATH` (2063's). It is 40 planted bodies (#9640 down
  to #9601) naming only `verdict.made`, `claim.made`, `user.ask` and `rules.json`, plus one open issue per entry of the
  checkout's `scripts/not-event-kinds.txt`, numbered as the entry and naming its name in backticks, so the list's
  entries stay valid and the lane's verdict turns on the design docs and the catalogue alone. No body names any of
  `KINDS`: #1837 itself will be closed, so the docs must carry the names.
- **The catalogue** is read through the contracts package's public entry, `catalogue()` from its built `dist/`.
- **A planted catalogue missing a kind** is the scratch copy with every `packages/contracts/schemas/<kind>@<n>.json`
  removed. `dist/` reads the schemas folder at run time, so no rebuild is needed; the test also checks the copy's
  `catalogue()` no longer holds the kind.
- **"Naming the kind"** is an output line holding the kind as a whole name, not part of a longer dotted name.

## Criterion to tests

| Part of `#1837.78b8f3bb` | Test | What it requires |
|---|---|---|
| each item has its line | `ac1-design-lines.test.mjs`, eight tests, one per item | every fact of the item holds in the checkout's `docs/technical-design.md` |
| a planted design missing an item's line fails | `ac1-design-lines.test.mjs`, eight tests | the design with every line holding one of that item's facts removed (at least one line removed) fails the same check, naming that item |
| each event kind is in the catalogue | `ac2-drift-lane.test.mjs`, first | `catalogue()` holds all eight `KINDS` |
| so the lane names none of them | `ac2-drift-lane.test.mjs`, second | over the checkout's docs and the fixed list: `PASS`, return 0, and no output line names any of `KINDS` |
| a planted catalogue missing one fails the lane, naming the kind | `ac3-planted-catalogue.test.mjs`, eight tests, one per kind | with that kind's schemas removed: `FAIL`, non-zero, and an output line names the kind |

## Readings where the issue leaves a choice

- **"The lane names none of them" is asked as a PASS.** With an open-issue list that names nothing uncatalogued and a
  valid not-event-kinds list, any FAIL comes from the docs, which is the Proof's "drift lane before and after".
- **Every kind gets its own planted catalogue, not a subset.** "One of them" is any of them. This bites: at the base
  `catalogueDrift` reads a backticked `a.b` as an event kind only when its family is a catalogued kind's family or
  the text calls it an event kind, and `resource.created`, `transcript.archived`, `archive.quiet` and `ci.archived` are
  each the only kind of their family. With one removed, its family goes, the docs' backticked name is no longer read
  as a kind, and the lane passes (or, for `archive.quiet`, fails only on the then-stale `archive.scene` entry). Making
  the lane name them is the change's choice: the design can call them event kinds where it names them, or the lane
  can read the catalogue's own names. No test asks for either.
- **The proof of the lines is the base's design.** PR #2052 already wrote all eight items' lines before this suite
  was drafted, so the `ac1` and `ac2` tests pass on the base. They are shown to bite by twins (below) and, for `ac1`,
  by the planted designs in the same file.
- **canvas-primitives.md's catalogue table is not checked.** The criterion's "in the event catalogue, so the lane names
  none" is the generated catalogue the lane compares with; the table is the design's account of it.

## Wrong programs checked

`twins.json` names four twins under `twins/` for the criterion, each laid over the change by `scripts/proof-runs.mjs`
(`twins/README.md`). Every test fails on the base or on at least one twin at an assertion (`BASE-RESULT.txt`).

## Files

- `helpers.mjs`: the items' facts, the kinds, the scratch copy, the fake `gh` and its fixed list, the lane runner and
  the catalogue reader.
- `ac1-design-lines.test.mjs`, `ac2-drift-lane.test.mjs`, `ac3-planted-catalogue.test.mjs`: 26 tests.
- `twins.json`, `twins/`: the planted wrong programs.
- `BASE-RESULT.txt`: the run on the base and on each twin.

No fixture holds a secret or personal data. Issue numbers 9601 to 9640 are made up.
