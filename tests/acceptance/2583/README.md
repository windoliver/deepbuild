# Acceptance tests for #2583: the catalogue holds `brief.uncited`

Written first, blind, from issue #2583 ("Catalogue brief.uncited, the event kind #1193 records for an uncited brief
sentence": its account, Scope, two acceptance criteria, Proof and Depends on, as the brief quoted its body; it has no
comments), the design and base commit `a6e742ed0` ("Merge pull request #2708 …"), by a job that never saw an
implementation; none existed. No other issue (#1193 and #2063 included), branch, worktree or pull request was read, nor
GitHub, except the open issues the catalogue drift lane reads itself through `gh`. The implementing agent doesn't edit
these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

| AC | ID | Test |
|---|---|---|
| AC1 | `#2583.8f145f1b` | `catalogue.test.ts`: the catalogue holds `brief.uncited`, from the schema `brief.uncited@1`. `lane.test.mjs`: the catalogue drift lane, on main's docs and the open issues, names `brief.uncited` nowhere |
| AC2 | `#2583.bfaf46c7` | `record.test.ts`, twice: an event without `job`, and one without `sentence`, is refused by the record, naming the missing field, where the same event with both is recorded |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's line after `- [ ] `, as its `readIssue` reads
them from the issue's body as the brief quoted it; the live issue wasn't read, so they aren't checked against it. Each
test's name starts with its ID and its AC number.

## What was read

- `AGENTS.md`, `CONTRIBUTING.md`; `docs/technical-design.md`: Blocks for plug-ins that do real work (Source and
  reading, the line that names `brief.uncited`, 539 at this base where the issue says 537), Dogfooding, and Built to be
  hard to get wrong; `docs/canvas-primitives.md`: The event catalogue.
- `packages/contracts`: its README, `src/index.ts`, `src/catalogue.ts` (`buildCatalogue`, `catalogue`,
  `catalogueDrift`), `src/schemas.ts`, `src/errors.ts`, `src/json.ts` and the `required` check in `src/validate.ts`;
  the schemas `brief.drafted@1` and `brief.made@1`, the `job` field of `job.ended@1`, `job.event@1`, `job.recorded@1`
  and `runner.answered@1`, and which writers and subjects the event schemas allow.
- `packages/record`: its README and `package.json`, `src/index.ts` (`Connection`, `EventInput`, `openRecord`, `append`
  and the check it runs before writing, `read`, `close`), `src/meta.ts` (`RecordError`) and `src/ids.js` (`ulid`).
- `scripts/catalogue-drift.mjs`, `scripts/open-issues.mjs`, `scripts/lanes.mjs` (the `catalogue drift` entry,
  `runLanes`, the throttle class of a lane command, how a skip's note is read, `exactTree`, `writeRecord`),
  `scripts/throttle.mjs`, `scripts/lease`, `scripts/proof-change.mjs` (`criterionId`), `scripts/config-eval.mjs` (its
  imports), `scripts/public-text.mjs` (its word check, which finds nothing in these files), `scripts/repo-rules.json`,
  `vitest.config.ts`, `tsconfig.json`, `tests/vitest-setup.ts`, and better-sqlite3's binding loader. There is no
  `scripts/not-event-kinds.txt` at this base, and nothing reads one.
- Suites `605/` (README, helpers, live test, `BASE-FAILURE.txt`), `1329/` (the live drift-lane test, its README and
  its lane runner), `606/` and `14/` (README, the record's connections), `2566/` (README, `BASE-FAILURE.txt`) and the
  file list of `311/`, for the house format.

## The surfaces

- **The catalogue** (AC1): `catalogue()` from the contracts package's public entry, `packages/contracts/src/index.ts`.
  It builds one entry per event kind schema in `packages/contracts/schemas/`, so an entry `{kind: 'brief.uncited',
  version: 1, schema: 'brief.uncited@1'}` is the Scope's schema, in that folder, in the catalogue. Exactly that one
  entry: the Scope asks for `@1`. What it feeds isn't pinned; the issue doesn't say.
- **The catalogue drift lane** (AC1): the entry of `checks` in `scripts/lanes.mjs` named `catalogue drift`, run alone
  through `runLanes`, the call `scripts/checks.mjs` makes over every lane, in a child `node` with this checkout as its
  folder: through the machine's throttle (a build grant, waited for up to 30 minutes) and `scripts/lease`, as every
  lane runs. It reads this checkout's two design docs, which are main's (the issue changes neither), and the open
  issues of `windoliver/deepbuild`, live, through the caller's own `gh` and `HOME` (`GH_REPO` set to it unless set; any
  `DEEP_OPEN_ISSUES` cache dropped, so the lane fetches). Its output and verdict are what `runLanes` prints.
- **The record** (AC2): `openRecord` and `RecordStore.append` from the record's public entry,
  `packages/record/src/index.ts`, on a record of its own in a temporary folder, appending as the core
  (`{writer: 'core', actor: 'you', scope: 'you'}`). The record checks each event against its kind's schema before it
  writes it; that check is the refusal the criterion names.

## Readings where the issue leaves a choice

- **"Names it nowhere".** The lane fails on main for other names too, so its verdict alone can't say. The test reads
  its output, and passes only when the lane ran its check, ending PASS, or FAIL with its line `FAIL <n> event kinds
  named in backticks are not in the catalogue: …`, and no line of the output holds `brief.uncited`. Any other end
  fails, with the output: a lane that broke before it checked anything names nothing, and must not pass. The lane's
  drift line, or its PASS line, is printed as a test diagnostic: the Proof's lane on the live tracker.
- **INCONCLUSIVE, never PASS.** When `gh auth status` fails (only its exit status is reported, since its words can name
  the account), when the lane reads INCONCLUSIVE (it couldn't read the open issues, or the throttle gave no build
  grant in 30 minutes), or when the run doesn't finish in 40 minutes and is stopped, the test skips with a message
  starting `INCONCLUSIVE:` and the reason. A skip is unrun, so a lane reading this file never counts it as a pass. The
  messages avoid the words a lane reads as a platform skip.
- **Main's docs.** The checkout's docs, as the lane reads them: on the implementing branch they are main's, since the
  Scope changes no doc. A fix that rewrote the design's sentence instead would still fail the catalogue half.
- **The payload `{job, sentence}`, "as #1193 writes it".** #1193 wasn't read. `job` is read as the runner job by its
  `run:` handle, the shape every catalogued kind with a `job` field gives it (`job.ended@1`, `job.event@1`,
  `job.recorded@1`, `runner.answered@1`), since the design's briefs come from runner jobs; `sentence` as the sentence's
  text. The event carries those two fields and the envelope every kind requires, and no `subject`: neither
  `brief.drafted@1` nor `brief.made@1` requires one. A schema that types either field otherwise, or requires a subject,
  fails AC2 at its first append.
- **The core writes it.** Every brief, job and runner kind in the catalogue is appended only by the core, and the
  design has the brief refused after the runner job, so the test appends as the core.
- **"Refused by the record, naming the missing field".** The append rejects with an error whose message names the field
  as a word (the base's record names a missing field by its pointer, `required at /data/job: …`), and the refused
  event is not in the log afterwards. First, the same event with both fields must be recorded. Without that twin, a
  schema that also requires a field the issue doesn't name would pass, since its refusal of the event without `job`
  still names `job` first. Neither value spells `job` or `sentence`, so a message names a field only by naming it. The
  test prints each refusal's message (shown with `--silent=false`): the Proof's refused event's message.

## Run them

```sh
npm ci                                     # once
npm run build -w packages/contracts        # the lane imports packages/contracts/dist
npx vitest run --root tests/acceptance/2583 --silent=false catalogue.test.ts record.test.ts   # offline, seconds
node --test --test-reporter=spec tests/acceptance/2583/lane.test.mjs   # live: gh signed in, network, a build grant
```

`--root` keeps Vitest off the repo's `vitest.config.ts`, which imports `scripts/lanes.mjs`, whose `config-eval.mjs`
imports `@deepbuild/config-eval`: Vite can't load that config until the workspaces are built (`npm run build
--workspaces`). Naming the two files keeps Vitest's own defaults off `lane.test.mjs`, a `node:test` file. Once the
workspaces are built, the unit lane's run of the repo config takes the two `.test.ts` files too; it doesn't take
`lane.test.mjs`, which runs by hand. Under `--root` Vitest keeps its cache in `tests/acceptance/2583/node_modules/`,
which git ignores. The record needs no native build: better-sqlite3 13.0.3 loads the binary it ships for this machine,
although `npm ci` reports its install script as held back.

`lane.test.mjs` waits on the machine's throttle like any lane run, up to 30 minutes for a build grant, and writes what a
run of that lane writes: `target/open-issues.json` in the checkout and the lane's evidence record under
`~/.deepbuild/lanes/`. Run under a holder of a build grant, as this job ran it (below), its lane passes through that
grant at once.

## Base results

`BASE-FAILURE.txt` is the one run of each file at the base.

- **AC1, the catalogue** (`catalogue.test.ts`) fails for the issue's reason: the catalogue has no `brief.uncited`
  entry (`expected [] to deeply equal [{kind: 'brief.uncited', version: 1, schema: 'brief.uncited@1'}]`).
- **AC1, the lane** (`lane.test.mjs`) fails for the issue's reason: on the live tracker the lane names `brief.uncited`
  three times, at `docs/technical-design.md:539` and in the open issues #2583 and #1193, among the 21 uncatalogued
  kinds it lists.
- **AC2** (`record.test.ts`) fails twice for the issue's reason: the record refuses even the whole event,
  `RecordError: no event kind brief.uncited is catalogued`, so neither refusal names a field.

The lane runs (the base's and the three plants' below) were made at 07:17 to 07:18 UTC under one build grant of the
machine's throttle, held by one chain for `npm run build -w packages/contracts` (8 s; the lane imports its `dist`) and
these four runs, so each lane's own request passed through it; the chain held the build slot for 70 s. The grant came
after 113 minutes in the queue, behind other sessions' builds; two earlier 30-minute requests, for the contracts build
and for a better-sqlite3 build that proved unneeded, got none. `scripts/lease` ran its command unleased, as it says it
does with no `deep` on PATH and no built CLI.

Flagged, not changed: the lane fails on main for 14 other kinds besides (18 entries), and goes on failing after this
issue. On the base and with the right schema alike it lists `runner.login_path` (`docs/technical-design.md:2567,2568`)
and kinds named in the open issues #2538, #2142, #2136, #2133, #2056, #2036, #1261, #1260, #983, #980, #335 and #274.
That is why the test reads the lane's output, not its verdict.

## Wrong programs

Each was run once by hand with these files as committed, and nothing in the checkout changed; no plant is in the repo.

### Planted schemas

Each plant is a scratch copy of the checkout outside the repo (its tracked and untracked files, `node_modules` linked so
`@deepbuild/*` resolves into the copy, and `packages/contracts/dist` where the lane runs) with one schema
`brief.uncited@1` planted in its `packages/contracts/schemas/`. The right program, `right`, is `brief.made@1`'s envelope
(core only, feeding nothing) with `data: {job: a run: handle, sentence: text of 1 to 8,192}`, both required and nothing
else allowed; it passes the contracts lint (`lintSchemas` over every published schema with it finds no problem).

| Plant | What it plants | `catalogue.test.ts` | `record.test.ts`, without `job` | without `sentence` | `lane.test.mjs` |
|---|---|---|---|---|---|
| `right` | the right program | pass | pass | pass | pass: the live lane still fails, on the 18 other entries, and names `brief.uncited` nowhere |
| `job-optional` | `data` requires only `sentence` | pass | FAIL: the event without `job` is recorded | pass | not run |
| `sentence-optional` | `data` requires only `job` | pass | pass | FAIL: the event without `sentence` is recorded | not run |
| `extra-required` | `data` also requires `story`, a field the issue doesn't name | pass | FAIL: the whole event is refused, `required at /data/story` | FAIL, the same | not run |
| `refuses-all` | `data` allows no field | pass | FAIL: the whole event is refused, `unlisted_field at /data/job` | FAIL, the same | not run |
| `sentence-index` | `sentence` an integer, its place in the brief | pass | FAIL: the whole event is refused, `type at /data/sentence` | FAIL, the same | not run |
| `not-catalogued` | the right schema without `x-feeds`: the record knows the kind, the catalogue leaves it out | FAIL: `[]` | pass | pass | FAIL: the live lane names `brief.uncited`, as at the base |
| `lane-crash` | the right schema, and no `packages/contracts/dist`, so the lane breaks before it checks | pass | pass | pass | FAIL: `the catalogue drift lane ended FAIL without checking the docs and the open issues` (`ERR_MODULE_NOT_FOUND` for the dist) |

With the right schema the record's refusals read `required at /data/job: Add the field the schema requires.
(brief.uncited <id>)` and `required at /data/sentence: …` (`lane-crash`'s run, with `--reporter=verbose
--silent=false`; `right` ran first, with Vitest's default reporter, which prints neither). `job-optional` and
`sentence-optional` are the criterion's own wrong programs. `extra-required` is the one the twin is there for: its
refusal of the event without `job` names `job`, and only the whole event's refusal fails it. `sentence-index` is a
reading as much as a wrong program: it is how the tests read `sentence` (above). `not-catalogued` is why the catalogue
half is its own test: the record takes the kind from any schema that names it, the catalogue only from one that says
what it feeds.

### The lane's ends

`lane.test.mjs` reads the lane's output, so its reading was also run against twins of `scripts/lanes.mjs`: a scratch
folder holding the test file and a `scripts/lanes.mjs` whose `runLanes` prints what `runLanes` prints for one end of the
catalogue drift lane, and returns its status. These need no lane run, throttle or network but `gh auth status`; the
issue numbers in them are made up.

| Twin | What its `runLanes` prints | `lane.test.mjs` |
|---|---|---|
| `pass` | the lane's PASS line, then `PASS catalogue drift (2.10 s)` | pass |
| `fail-other-names` | `FAIL 2 event kinds named in backticks are not in the catalogue: tool.gone (#9601), ask.lost (docs/canvas-primitives.md:12)` and its verdict | pass, with that line as its diagnostic |
| `fail-names-it` | the same with `brief.uncited (docs/technical-design.md:539)` and `brief.uncited (#9602)` | FAIL: `the catalogue drift lane names brief.uncited`, listing both lines |
| `fail-crash` | node's `Error [ERR_MODULE_NOT_FOUND]` for `packages/contracts/dist/index.js`, and `FAIL catalogue drift: Error …` | FAIL: `the catalogue drift lane ended FAIL without checking the docs and the open issues` |
| `no-grant` | `INCONCLUSIVE catalogue drift: no grant: no build grant came within 30 min` | skipped, `INCONCLUSIVE: …`; no pass |
| `no-issues` | `INCONCLUSIVE catalogue drift: could not fetch the open issues: …` | skipped, `INCONCLUSIVE: …`; no pass |
| `blocked` | `BLOCKED catalogue drift: no evidence record: …` | FAIL: `… ended BLOCKED without checking …` |

And with `GH_CONFIG_DIR` an empty folder, in the checkout, the test skips before any lane run: `INCONCLUSIVE: gh isn't
signed in or can't reach GitHub (gh auth status: exit 1), so the lane can't read the open issues`; no pass.

## Not verified

- #1193 wasn't read, so `job` as a `run:` handle and `sentence` as text are readings of the design and the catalogue,
  not checked against what #1193 writes.
- The two `.test.ts` files weren't type-checked: the typecheck lane's `tsconfig.json` takes `packages/**` only.
- The lane runs read the open issues as they stood at 07:17 to 07:18 UTC on 2026-11-16, and ran nested in this job's
  build grant rather than as a top-level request of their own; a top-level run waits for its own grant, up to 30
  minutes, and reads INCONCLUSIVE without one.
