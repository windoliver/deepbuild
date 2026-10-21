# Acceptance tests for #605: run the catalogue drift check over the design docs and open issues

These tests were drafted blind from issue #605 (its text as of October 20), `docs/technical-design.md`,
`docs/canvas-primitives.md`, AGENTS.md and the base commit `f346706`, which is `origin/main` and has no
implementation. Per AGENTS.md, the implementing agent doesn't edit them. A dispute goes to a blind redraft
by this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # if the lane reads a package's built dist/
node --test 'tests/acceptance/605/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so neither the unit lane's vitest run (`tests/**/*.test.ts`)
nor its `node --test` (`tests/*.test.mjs` and package tests) picks them up: run them by hand. Five of the six
are offline and take a few seconds. `real-issues.live.test.mjs` needs network and `gh` signed in with read
access to `windoliver/deepbuild` (below). On the base, the five #605 tests fail because there is no lane, and
criterion 3's passes, as `BASE-FAILURE.txt` shows. That file also lists the planted wrong programs each test
was run against.

## The surface (my choice where the issue leaves it open)

The issue names a check lane in `scripts/checks.mjs`, `catalogueDrift`, the two docs and
`gh issue list --state open --json number,body`. The tests reach the code only through these:

- **The lane is the one entry of `checks` in `scripts/lanes.mjs` whose name matches `/catalogue|drift/i`.**
  `scripts/checks.mjs` runs `runLanes(checks)` with that list, so the lane must be in it, not added in
  `checks.mjs` alone. Exactly one lane may match. The issue doesn't name it; "catalogue drift" is what it
  checks.
- **The tests run that lane alone, as `checks.mjs` runs every lane.** A child `node` process with cwd at a
  scratch copy imports the copy's own `scripts/lanes.mjs` and calls `runLanes([lane])`. Running the whole of
  `checks.mjs` would also run typecheck, clippy, cargo test and the parity build, which these criteria don't
  need. The lane's commands run with the copy as cwd and read the copy's docs.
- **The verdict is what `runLanes` prints and returns.** `PASS <name> (…)` or `<STATE> <name>: <reason>`,
  and the return value that becomes `checks.mjs`'s exit status.

### The scratch copy

Each test gets a sandbox under the OS temp folder, removed afterwards. Its `repo/` holds this checkout's
working tree: tracked files, untracked files git doesn't ignore, and each `packages/*/dist/` that exists. It
has a fresh `git init` with the checkout's `origin` URL as its remote, and `node_modules` links to the
checkout's. Other ignored files aren't copied, so a cache the lane left in the checkout never reaches a
test.

### `gh` and offline

- **The open issues come from a fake `gh` first on `PATH`.** It answers `gh issue list … --json <fields>`
  from a fixture list. It honours `--limit`/`-L`, and returns 30 without one, as `gh` does. It returns only
  the requested fields among `number` and `body`. It also answers `gh auth status` (signed in) and
  `gh --version`. Any other command exits 1, and other flags (`--jq` and `--template` among them) are
  ignored, so the lane must parse the JSON itself. Every call is logged.
- **The fixture is 40 open issues, newest first, #9640 down to #9601.** Their bodies name only catalogued
  kinds (`verdict.made`, `claim.made`, `user.ask`, `tool.before`, `ask.created`) and backticked names that
  aren't kinds (`rules.json`, `hold_until_ms`). The planted body is #9605, the 36th, so a lane that keeps
  gh's default limit misses it. The real repo has more than 500 open issues, so the lane needs `--limit`
  (or paging) anyway.
- **Offline is a fake `gh` that fails every call but `--version`.** It prints what `gh` prints when it can't
  reach GitHub (`error connecting to api.github.com`) and exits 1. Nothing is cached, because the sandbox
  is fresh.
- **Every process runs sandboxed.** `HOME`, `TMPDIR`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME` and
  `GH_CONFIG_DIR` are in the sandbox, and `GH_TOKEN`, `GITHUB_TOKEN`, `GH_HOST` and `GH_REPO` are unset.
- **Where the cache lives is open.** "Cached under the kept copy" isn't defined in the design. Any place
  keyed under the lane's cwd, `HOME`, `TMPDIR` or the XDG folders works. A hard-coded absolute path
  elsewhere would leak between tests and isn't supported.

## Criteria to tests

| Criterion | Test | What it requires |
|---|---|---|
| 1. fails on a planted doc line naming `verdict.imagined` | `drift.test.mjs`, first | The fixture's `docs/canvas-primitives.md` gets the line ``When a check is made up, the hub appends `verdict.imagined` beside the verdict it replaces.`` The issues are clean. The lane's verdict is `FAIL`, `runLanes` returns non-zero, and one output line holds both `verdict.imagined` and `canvas-primitives.md`. |
| 1. fails on a planted issue body that calls one an event kind | `drift.test.mjs`, second | #9605's body says ``the hub appends the event kind `claim.imagined` ``. That's an uncatalogued kind in the catalogued `claim` family, called an event kind. The docs are the real ones. The verdict is `FAIL`, non-zero, and one line holds both `claim.imagined` and `9605` as a whole number (`#9605` or `issue 9605` both work). |
| 1. passes on the real docs after the five names are rewritten | `drift.test.mjs`, third | Real docs with 40 clean issues give `PASS` and return 0. No output line names `verdict.created`, `claim.point`, `user.pivot`, `reading.overflow` or `layer.unsupported`. `gh issue list` ran with `number` and `body` among its `--json` fields, and with `--state open` or no `--state`. |
| 1. passes on the real open issues | `real-issues.live.test.mjs` (live) | The lane runs in a scratch copy with the caller's own environment, `gh` and auth, plus `GH_REPO=windoliver/deepbuild` unless one is set. The verdict must be `PASS`, with return 0. Offline or signed out, the lane is INCONCLUSIVE: the test fails with a `BLOCKED:` message saying it needs network and `gh` auth. It never skips. |
| 2. offline the lane is INCONCLUSIVE, not PASS | `offline.test.mjs` | With the failing `gh`, the lane's only verdict line is `INCONCLUSIVE <name>: …`, and `runLanes` returns non-zero. |
| 3. #311's `catalogue.test.ts` passes unchanged | `catalogue-311.test.mjs` | `tests/acceptance/311/catalogue.test.ts`, `helpers.ts`, `fixtures/issue-learn-paused.md` and `fixtures/issue-clean.md` are byte-equal to `f346706`'s (via `git show`). `npx vitest run --root tests/acceptance/311 catalogue.test.ts` exits 0 with 1 file passed. |

## Readings where the issue leaves a choice

- **INCONCLUSIVE is a new `runLanes` state.** `runLanes` at the base knows only `FAIL`, `INVALID` and
  `BLOCKED`. The issue asks for INCONCLUSIVE. The tests require the verdict line to start
  `INCONCLUSIVE <name>`.
- **An INCONCLUSIVE lane makes `runLanes` return non-zero.** The tests require it. If `checks.mjs` exited 0,
  the checks would pass with the issues unread, which is a PASS by another route. Invariant 2 forbids it.
- **"Naming each kind and where".** The tests require the kind and its source on the same output line,
  which is how two drifts in two places stay apart. For a doc, the source is the file name. For an issue,
  it's its number. A line number may be added.
- **The planted doc line's kind is in a catalogued family and isn't called an event kind.** The issue
  names `verdict.imagined`. The planted issue body's kind is in a catalogued family and is called an event
  kind, so either reading of "calls one an event kind" catches it. Each planted test plants one thing, with
  everything else clean.
- **Offline is `gh` failing.** The issue fetches through `gh`, so a `gh` that can't reach GitHub is how
  offline looks to the lane. The tests don't cut the network itself.
- **When offline, what about doc drift?** The issue doesn't say whether a planted doc drift should still
  read FAIL offline. Nothing tests it.
- **Change 3 (`learn.paused`).** The issue leaves it to the implementer. Criterion 3 decides it in effect:
  cataloguing `learn.paused` fails #311's AC16 planted-body test and its AC7 refusal (checked, see
  `BASE-FAILURE.txt`). So the passing route is amending #311's body, or #311 being closed. It was closed on
  October 20, so it isn't among the open issues.

## What the live test hits today (flagged, not changed)

A planted fix of the lane, with the five doc names rewritten, still fails the live test as of October 20.
The 573 open issues give 18 drift entries in 10 issues (listed in `BASE-FAILURE.txt`):

- #605's own body names the five names, `learn.paused` and `verdict.imagined` in backticks.
- #372 names `user.pivot`.
- #361, #261, #259 and #72 name `layer.unsupported`.
- #266 names `user.turn`.
- #55 names `agent.turn_ended`, `agent.permission_requested` and `agent.create`.
- #14 names `evidence.stored` and `evidence.removed`.

The criterion says the lane "passes on the real docs and open issues", so the test holds it to that.
Getting there means amending those bodies or cataloguing those kinds. That is the owner's call, not an edit
to this test. #605's own body trips the lane while #605 is open.

## Wrong programs checked

All runs were in a scratch clone of the base, with a planted fix and one change at a time; see
`BASE-FAILURE.txt`:

- A lane that ignores issue bodies.
- A lane that keeps gh's default limit of 30.
- A lane that names kinds without their source.
- A lane that reads a failed `gh` as no issues.
- A `runLanes` that prints INCONCLUSIVE but returns 0.
- The five doc names left in place.
- A `learn.paused@1` schema added to the catalogue.
- An edit to #311's test.

Each made the test written for it fail, and the planted fix passed all five offline tests.

## Files

- `helpers.mjs`: the scratch copy, the fake `gh`, the sandboxed environment and the lane runner.
- `drift.test.mjs`: criterion 1, offline, with three tests.
- `offline.test.mjs`: criterion 2.
- `catalogue-311.test.mjs`: criterion 3.
- `real-issues.live.test.mjs`: criterion 1, live.
- `BASE-FAILURE.txt`: the run on the base and the planted programs.

No fixture holds a secret or personal data. Issue numbers 9601 to 9640 are made up.
