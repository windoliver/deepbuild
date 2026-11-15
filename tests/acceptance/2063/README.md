# Acceptance tests for #2063: a list of names that are not event kinds, read by the catalogue drift lane

These tests were drafted blind from issue #2063 (its text as of November 14), AGENTS.md, `docs/technical-design.md`
(Dogfooding, Wrong programs), `docs/canvas-primitives.md` (The event catalogue) and the base commit `72fe11a1`, which
is `origin/main` and has no implementation. At the base I also read `scripts/catalogue-drift.mjs`,
`scripts/open-issues.mjs`, `scripts/design-links.mjs` with `scripts/planned-names.txt`, `scripts/lanes.mjs`,
`scripts/proof-change.mjs` (for `criterionId`), `scripts/proof-runs.mjs` (how a twin is laid over a change),
`packages/contracts/src/catalogue.ts`, and the suites `tests/acceptance/605/`, `tests/acceptance/1329/` and
`tests/acceptance/1114/twins/`. The scratch copy, fake `gh` and lane runner follow 605's and 1329's helpers. They're
copied into `helpers.mjs` here, never imported. Per AGENTS.md, the implementing agent doesn't edit these tests. A
dispute goes to a blind redraft by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing
npm run build -w packages/contracts      # the lane reads packages/contracts/dist
node --test 'tests/acceptance/2063/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. All six are offline: no test
reaches GitHub. Each run of the lane takes about a second in a scratch copy; a loaded machine's throttle can hold a
lane longer, so each run has a 900 s limit. On the base all six fail because the lane reads no list
(`BASE-FAILURE.txt`).

## The surface (my choice where the issue leaves it open)

The tests reach the code only through these.

- **The lane is the one entry of `checks` in `scripts/lanes.mjs` whose name matches `/catalogue|drift/i`,** as #605's
  suite picks it (`catalogue drift` at the base, running `scripts/catalogue-drift.mjs`). A child `node` process with
  cwd at a scratch copy imports the copy's own `scripts/lanes.mjs` and calls `runLanes([lane])`, the call
  `scripts/checks.mjs` makes over every lane.
- **The verdict is what `runLanes` prints and returns:** `PASS <name> (…)` or `<STATE> <name>: <reason>`, and the
  return value that becomes the exit status. A failing run must be `FAIL`, not another state.
- **The list is `scripts/not-event-kinds.txt`,** one entry a line as `<name> #<issue>`, such as `plan.overlay #9612`.
  Every test plants its own list in the scratch copy, entries only. No test reads the checkout's living list, which
  follows the live tracker.
- **Naming.** "Naming the kind and the issue" is one output line that holds the kind and the issue's number as a whole
  number (`#9605`, `issue 9605`). "Naming the entry" is an output line that holds the entry's name; its issue or its
  line number may be beside it.

### The scratch copy

Each run of the lane gets its own sandbox under the OS temp folder, removed afterwards. Its `repo/` holds the part of
this checkout's working tree the lane can read: the root's own files, `scripts/`, `packages/contracts/` (tracked files
and untracked files git doesn't ignore) and `packages/contracts/dist/`. No other package's `dist/` is copied:
`runLanes` runs a lane's command through `scripts/lease`, which uses a built `packages/cli/dist` when it finds one,
and the copy has no CLI package to start it from. So the lane runs unleased in the copy, the same in a checkout
where only the contracts package is built and in a fully built one. (With a `deep` on `PATH`, `scripts/lease` uses
that instead; I had none to try, and the sandboxed `HOME` gives it no hub to lease from.) `docs/` as a whole is 256 MB of
evidence, so only the two design docs the lane reads are there, and they are two small planted docs that name only
catalogued kinds, so each test plants one thing and a later line of the real docs can't turn it. `node_modules` links to the checkout's. It has a fresh `git init` with the
checkout's `origin` URL as its remote. A lane that reads a file outside that part isn't supported.

### `gh` and the sandbox

- **The issues come from a fake `gh` first on `PATH`,** over a small tracker of open and closed issues. It answers
  `gh issue list … --json <fields>` for `--state open` (the default), `closed` or `all`, honours `--limit`/`-L` and
  returns 30 without one, as `gh` does. It answers `gh issue view <number> --json <fields>`, `gh auth status` and
  `gh --version`. The fields are `number`, `title`, `state` (`OPEN` or `CLOSED`) and `body`. Anything else fails, and
  `--jq` and `--template` are ignored, so the lane parses the JSON itself.
- **The planted tracker is 40 issues, #9640 down to #9601, newest first.** #9612 to #9608 each define one name the
  issue gives as no event kind, in the issue's own words for it: the check `plan.overlay`, the kind rule
  `process.conserve`, the fixture `archive.scene`, the lease key `stack.slot` and the check `move.feel`. #9607 uses
  `plan.overlay` and `process.conserve` without defining them. The other bodies name only catalogued kinds
  (`verdict.made`, `claim.made`, `user.ask`, `tool.before`, `ask.created`) and backticked names in no catalogued family
  (`rules.json`, `hold_until_ms`). The planted list holds the five names, each beside its defining issue. The planted
  body is #9605, the 36th, so a lane that keeps gh's default limit never reads it.
- **Every process runs sandboxed.** `HOME`, `TMPDIR` and the XDG folders are in the sandbox, the GitHub token and
  host variables are unset, and `DEEP_OPEN_ISSUES` and `DEEP_PREFLIGHT` aren't inherited.

### The recorded tracker copy

`fixtures/open-issues-2026-11-14.json` is criterion 1's "recorded copy of the tracker": `number` and `body`, as
`gh issue list --state open --limit 5000 --json number,body` gave them on 2026-11-14 at 23:19 UTC, newest first. The
whole list was 1,197 open issues and 6,256,464 bytes (SHA-256
`3921ccd3396dd661a365df70334b2d485493070daf559889b5441bd5a2b61737`), too large to keep. The record keeps 77 of them,
whole and unedited, 494 kB:

- the 12 issues the base's lane fails on (#274, #335, #980, #983, #1193, #1260, #1261, #2036, #2056, #2133, #2136,
  #2142);
- the 64 others that name a catalogued event kind in backticks, which are the rest of the issues the base's lane reads
  any event kind from;
- #2063 itself, which writes its names in quotation marks so the lane doesn't read them.

The 1,120 issues left out name nothing in backticks that the base's lane reads as an event kind. The base's lane prints
the same line over the record as over the whole list: 18 entries, 17 of them in the 12 issues and one in
`docs/technical-design.md` (`BASE-FAILURE.txt`). The names in the record today: `plan.overlay` (#1260, #1261),
`plan.sheet` (#1260), `move.feel` (#274), `process.conserve`, `process.busy` and `process.little` (#980, #983),
`archive.scene` (#2036), `stack.slot` (#335), `lease.gpu` (#2133), `layer.puffs` (#2142), `job.status` (#2136),
`user.pan` (#2056) and `brief.uncited` (#1193, and the base's `docs/technical-design.md:537`). The seven file and
method names and the two config keys the issue says are reworded are already gone from the tracker: no open issue
holds any of them in backticks.

`fixtures/not-event-kinds-2026-11-14.txt` is the list as recorded the same day: the 13 names above, each once, beside
a recorded issue that names it. I derived it from the record and the base lane's output, not from any change. Where
two recorded issues name a name, the entry is the one that defines it (`plan.overlay #1260`, the `process.*` rules
`#980`). `plan.sheet` is #1260's asset. `lease.gpu`, `layer.puffs`, `job.status` and `user.pan` are fields their
issues name without defining a check, a rule or a fixture, and `brief.uncited` is a refusal #1193 records; each is
beside the one recorded issue that names it. That is the record's list, not a ruling on the living one.

The bodies are the tracker's issue text. I searched them for mail addresses, home folder paths, tokens and handles and
found none, and `scripts/public-text.mjs` finds no studied name in this folder.

## Criteria to tests

Each criterion's ID is `#2063.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `criterionId` in `scripts/proof-change.mjs` works it out. Every test carries its criterion's tag at the
start of its name.

| Criterion | Test | What it requires |
|---|---|---|
| 1. `#2063.1fc4ef66`: with the list holding today's names, each beside its issue, the lane passes on the recorded tracker copy; on main it fails, naming them | `ac1-recorded-tracker.test.mjs` | Over the record and the planted docs. Before, with an empty list: `FAIL`, non-zero, and a line each for `plan.overlay` and 1260, `move.feel` and 274, `process.conserve` and 980, `archive.scene` and 2036, `stack.slot` and 335. The recorded list's every entry is `<name> #<issue>` beside a recorded issue whose body holds the name in backticks, and it holds those five beside those issues. After, with the recorded list planted as the copy's `scripts/not-event-kinds.txt`: `PASS` and 0. |
| 2. `#2063.d47f7c6f`: a planted body naming "ask.ghosted" still fails the lane, naming the kind and the issue | `ac2-uncatalogued-kind.test.mjs`, first | The clean tracker with the planted list is `PASS` and 0. With #9605 also naming `` `ask.ghosted` ``: `FAIL`, non-zero, and a line holds `ask.ghosted` and 9605. |
| 2. `#2063.d47f7c6f`: listing it under an issue that does not name it fails too | `ac2-uncatalogued-kind.test.mjs`, second | The clean tracker is `PASS`. With #9605 naming `` `ask.ghosted` `` and the list also holding `ask.ghosted #9606` (#9606 is open and doesn't name it): `FAIL`, non-zero, and a line holds `ask.ghosted`. |
| 3. `#2063.0ccaf9ec`: a planted entry whose issue is closed fails the lane, naming the entry | `ac3-stale-entries.test.mjs`, first | The clean tracker is `PASS` with `move.feel #9608`. With #9608 closed, its body unchanged, and no open issue naming `move.feel`: `FAIL`, non-zero, and a line holds `move.feel`. |
| 3. `#2063.0ccaf9ec`: one whose issue no longer names it fails too | `ac3-stale-entries.test.mjs`, second | The clean tracker is `PASS`. With #9608 open and its line reworded so the body no longer holds `move.feel` at all: `FAIL`, non-zero, and a line holds `move.feel`. |
| 4. `#2063.0d14edf8`: a planted lane that passes every name whose family the list holds lets "plan.ghost" through and fails this test, naming it | `ac4-listed-family.test.mjs`, with `twins/passes-listed-families` | The clean tracker is `PASS` with `plan.overlay #9612`. With #9605 also naming `` `plan.ghost` ``: `FAIL`, non-zero, and a line holds `plan.ghost` and 9605. On the twin the lane passes, and the test fails at "the lane let plan.ghost through". |

## Readings where the issue leaves a choice

- **How a closed issue is recognised is the lane's choice.** The base's lane reads only the open issues, so an issue
  missing from them is closed or was never there, which is how `scripts/design-links.mjs` reads a planned name's
  issue. The fake `gh` also answers `gh issue view` and `gh issue list --state closed|all` with each issue's `state`,
  so a lane that asks for the state passes too. The closed issue's body still names the entry, so a lane that reads a
  closed issue's body as an open one's fails the test.
- **A listed name passes wherever it is named.** The entry gives the one open issue that defines the name, and
  `scripts/planned-names.txt` passes a planned name in every issue. So #9607, which uses `plan.overlay` and
  `process.conserve`, must pass with only #9612 and #9611 listed, as #1261 and #983 use #1260's check and #980's
  rules on the tracker. The recorded list holds each name once, so criterion 1 needs the same: `plan.overlay #1260`
  must pass #1261, and #980's three rules must pass #983.
- **"Names it" is the name in backticks in the body,** which is how the lane reads a name. The reworded #9608 doesn't
  hold the string at all, so a lane that looks for the bare string agrees.
- **Each planted failure starts from a clean twin in the same test.** "Still fails" and "each fail the lane" mean the
  planted thing fails a lane that otherwise passes, so each test first requires `PASS` on the clean tracker with the
  planted list. That is also where each fails on the base.
- **The planted `ask.ghosted` and `plan.ghost` are plain backticked names in catalogued families** (`ask.created` and
  `plan.*` kinds are catalogued); the bodies don't call them event kinds.
- **Criterion 1's "before" is an empty list, not the old commit.** "On main a9d2e682 it fails, naming them" can't be
  run from a test, and a9d2e682 predates the November 9 history rewrite. With an empty list a lane has nothing to pass
  the names by, which is main's state. `BASE-FAILURE.txt` holds the base's own output on the record.
- **The list is recorded with the tracker.** "With the list holding today's … names, each beside its issue" is a
  state of the list on the day of the record, so it is a fixture beside the record, planted in the scratch copy. The
  checkout's living list must follow the live tracker (a new issue's name gets an entry, a closed issue's entry
  goes), and any such edit would read as stale or missing against the frozen record.
- **Docs are planted for criterion 1 too.** The criterion is about "the open issues of a recorded copy of the
  tracker". The base's `docs/technical-design.md:537` names `brief.uncited`; whether a listed name passes in a doc,
  or the doc is reworded, is the change's choice and no test asks for either.
- **The planted wrong lanes** are kept as twin folders that `scripts/proof-runs.mjs` lays over the change
  (`twins/README.md`), not started from inside the tests. Criterion 4 names its own. Criteria 2 and 3 have one each
  way their assertion can be missed, because on the base their tests fail at the clean run, before the assertion
  the criterion is about. A twin replaces code under test and is never chosen by the
  test or an environment variable.

## What the issue leaves untestable or open

- **The living list is unproven by this suite.** No test reads the checkout's `scripts/not-event-kinds.txt`: that it
  holds what the live tracker needs is the live lane's verdict, in the Proof's "after".
- **"Defines it as a check, a kind rule, a fixture or another thing that is no event"** is a person's reading. The
  lane can't tell a defining issue from one that only names the name, and no test tries.
- **"The seven such names … are reworded in their issues by this task"** is a tracker edit, not code. The record shows
  none of the nine names in backticks; nothing tests it further.

## Wrong programs checked

All in scratch copies with a throwaway fix, one fault at a time (`BASE-FAILURE.txt`): the twin; a lane that reads no
entry against the tracker; one that checks only that an entry's issue is open; one that reads closed issues as open;
and the base's lane. Each failed the tests written for it, and the throwaway fix passed all six.

## Files

- `helpers.mjs`: the scratch copy, the fake `gh` and its planted tracker, the list, the sandboxed environment and the
  lane runner.
- `ac1-recorded-tracker.test.mjs`, `ac2-uncatalogued-kind.test.mjs`, `ac3-stale-entries.test.mjs`,
  `ac4-listed-family.test.mjs`: one file per criterion, six tests.
- `fixtures/open-issues-2026-11-14.json`, `fixtures/not-event-kinds-2026-11-14.txt`: the recorded tracker copy and
  the list recorded with it.
- `twins/passes-listed-families/`, `twins/passes-any-name-once-listed/`, `twins/never-reads-entry-issue/` (each a
  `scripts/catalogue-drift.mjs`), `twins.json`, `twins/README.md`: the planted lanes for criteria 4, 2, and 2 and 3.
- `BASE-FAILURE.txt`: the run on the base, the base's lane on the record, and the planted programs.

No fixture holds a secret or personal data. Issue numbers 9601 to 9640 are made up.
