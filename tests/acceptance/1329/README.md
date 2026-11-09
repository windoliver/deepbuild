# Acceptance tests for #1329: the design is edited in the repo, and a drift lane and a public-text lane guard it

These tests were drafted blind from issue #1329 (its text as of November 7), `docs/technical-design.md`,
`docs/canvas-primitives.md`, AGENTS.md, CONTRIBUTING.md and the base commit `9bdebdfb`, which is `origin/main` and has
no implementation. At the base I also read `scripts/lanes.mjs`, `scripts/checks.mjs`, `scripts/design-links.mjs`,
`scripts/catalogue-drift.mjs`, `scripts/open-issues.mjs`, `scripts/proof-change.mjs` (for `criterionId`) and
`tests/acceptance/605/` and `tests/acceptance/910/`. The scratch copy, fake `gh` and lane runner follow those suites'
helpers. They're copied into `helpers.mjs` here, never imported. Per AGENTS.md, the implementing agent doesn't edit
these tests. A dispute goes to a blind redraft by this job.

Run them with:

```sh
node --test 'tests/acceptance/1329/*.test.mjs'                 # all, the live one included
node --test tests/acceptance/1329/ac{1,2,3}-*.test.mjs          # offline only
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. Run them by hand. Seven tests
are offline and copy the checkout into a sandbox each. `ac4-live-issues.live.test.mjs` reads the real open issues
through `gh`, so it needs network and `gh` signed in with read access to `windoliver/deepbuild`. Offline or signed
out, it skips with a message starting `INCONCLUSIVE:`. It never passes then. None of the tests needs `npm ci` or a
build: they run no lane that reads a package's `dist/`.

## The surface (my choice where the issue leaves it open)

The tests reach the code only through these.

### The lanes

Each lane is an entry of `checks` in `scripts/lanes.mjs`, so `scripts/checks.mjs` runs it. Exactly one entry may
match each pattern:

| Lane | Its name matches | Example |
|---|---|---|
| The drift lane | `/\bnames?\b/i` | `design names` |
| The design links lane (#910, at the base) | `/\blinks?\b/i` and not `/catalogue\|drift/i` | `design links` |
| The public-text lane | `/\bpublic\b/i` | `public text` |

The drift lane's name can't contain "drift" or "catalogue": #605's suite needs exactly one lane matching
`/catalogue|drift/i`, and that is the catalogue drift lane. The public-text lane's name can't match `/\bnames?\b/i`.
The drift lane may be the design links lane itself, extended and renamed so it matches both patterns (`design links
and names`); it's then the same lane twice.

- **The tests run lanes as `checks.mjs` does.** A child `node` process, with cwd at a scratch copy, imports the copy's
  own `scripts/lanes.mjs` and calls `runLanes` once on the lanes a test names, in their order in `checks`. The drift
  lane and the public-text lane each run alone, except in criterion 1's second run, which runs drift, design links
  and public text together. A lane run alone has to read the open issues itself, as `scripts/open-issues.mjs` does.
- **The verdict is what `runLanes` prints and returns.** `PASS <name> (…)` or `<STATE> <name>: <reason>`. A `SKIP`
  isn't a PASS. The return value becomes `checks.mjs`'s exit status.
- **Naming the issue and the command.** One output line holds the issue's number as a whole number (`#9605` or `issue
  9605`) and the command as written in the issue's backticks, `deep zorptangle`. For a link, one line holds the
  number and the link from the file name on, `technical-design.md#no-such-heading-1329`.

### The drift lane's inputs

- **What it checks.** Each open issue's links into `docs/*.md` land on a heading or `<a id>` (GitHub's slugs, as
  #910's lane does). Each `deep` command and agent tool the issue names in backticks is in the design docs or in the
  planned-names list. The tests plant only names absent from both docs, and name only real ones written in backticks
  in the docs. Whether `deep env down` counts as held when the design holds `deep env up` is the lane's call; no test
  plants such a case.
- **The planned-names list is `scripts/planned-names.txt`.** One entry per line: the name as an issue writes it, a
  space, and `#<issue>` for the open issue that plans it, such as `deep quuxify #9601` or `deep_quuxify #9601`. Blank
  lines and lines starting with `#` are ignored. Criterion 2's clean twin appends two entries to the copy's list (making
  the file when it's missing). That `#<issue>` is how criterion 4's exceptions are "listed with their issue".

### The public-text lane's inputs

- **The studied-names list is `scripts/studied-names.json`:** `{ "salt": "<string>", "hashes": ["<hex>", …] }`. Each
  hash is the lowercase hex SHA-256 of the UTF-8 bytes of the salt followed by the name lowercased, with no separator.
  One salt for the file. Matching is by whole word, ignoring case. The tests plant one-word names only; how the lane
  finds names of several words (words joined by one space before hashing is the obvious reading) is untested.
- **The tests plant their own hashes.** They read the copy's salt (or make one when the file is missing), add salted
  hashes for two invented names, `Zorblax` and `Quindleplex`, and commit that as the base. No real name appears in
  these tests, their fixtures or their output.
- **The change it scans** is what `changedPaths` in `scripts/lanes.mjs` calls a change: every file that differs
  between `git merge-base HEAD origin/main` and the working tree, plus untracked files git doesn't ignore. The tests
  plant the change as one commit past `origin/main`, adding `panel-notes-1329.md`. Scanning only the lines the change
  adds, or the whole changed files, both meet the tests. The commit messages hold no listed name.
- **Issue bodies.** The issue says the lane also scans each new issue body. No test plants an issue for it; the fake
  `gh` serves 40 clean issues, so a lane that reads them can.
- **"Without printing the list."** On the failing change, the output holds no listed name other than the one the
  change holds (`Quindleplex` appears nowhere, in any case), none of the hashes the file holds, and no salt-free
  SHA-256 of either name. Printing the found word, its file and its line is allowed.

### The scratch copy

Each offline test gets a sandbox under the OS temp folder, removed afterwards. Its `repo/` holds this checkout's
working tree: tracked files, untracked files git doesn't ignore, and each `packages/*/dist/` that exists.
`node_modules` links to the checkout's when it has one. It has a fresh `git init` (branch `change`) with the
checkout's `origin` URL as its remote. The test commits the copy as the base and points `refs/remotes/origin/main` at
it, and a test that needs a change commits it on top. Git runs with a fixture identity, no signing and no hooks.

### `gh` and the sandbox

- **The open issues come from a fake `gh` first on `PATH`.** It answers `gh issue list … --json <fields>` from a
  fixture list, with the requested fields among `number`, `title` and `body`. It honours `--limit`/`-L` and returns 30
  without one, as `gh` does. It answers `gh auth status` and `gh --version`, and fails anything else.
- **The fixture is 40 open issues, #9640 down to #9601, newest first.** Each clean body has a design link to a real
  heading by its full blob URL (`technical-design.md#how-runs-become-one-of-five-verdicts`,
  `technical-design.md#decided` or `canvas-primitives.md#the-event-catalogue`), names `deep doctor`, `deep env up`,
  `deep_show` and `deep_search`, and links `scripts/checks.mjs` and `AGENTS.md#proof`. The planted issue is #9605, the
  36th, so a lane that fetches with gh's default limit misses it.
- **Every process runs sandboxed.** `HOME`, `TMPDIR` and the XDG folders are in the sandbox, the GitHub token and host
  variables are unset, and `DEEP_OPEN_ISSUES` and `DEEP_PREFLIGHT` aren't inherited.

### The live test

`ac4-live-issues.live.test.mjs` copies the checkout as the offline tests do and runs the drift lane alone with the
caller's own environment and `gh`, plus `GH_REPO=windoliver/deepbuild` unless one is set. It prints the lane's output
as a test diagnostic: that's the Proof's "after" (run it on the base branch's checkout for the "before", once the lane
exists there). The lane must PASS. Then each `scripts/planned-names.txt` entry must be `<name> #<issue>`, with that
issue open and its body holding the name. If `gh auth status` fails, the lane reads INCONCLUSIVE, or the run is
stopped at the helper's 900 s limit, the test skips with a message starting `INCONCLUSIVE:` and the reason.

Every run of the lanes has that 900 s limit, because `runLanes` waits for the machine's throttle; a stopped run's
output ends with a `STOPPED:` line. One incidental observation, not a test: #1329's own body links
`technical-design.md#scope`, and the base's technical-design.md has no heading with that slug.

## Criteria to tests

Each criterion's ID is `#1329.<first 8 hex digits of the SHA-256 of its "- [ ]" text, trimmed, white space
collapsed>`, as `criterionId` in `scripts/proof-change.mjs` works it out. Every test carries its criterion's tag at the
start of its name, the twins too.

| Criterion | Test | What it requires |
|---|---|---|
| 1. `#1329.6069ef82`: CONTRIBUTING.md names the docs as the source, and a design change lands with no step outside the repo | `ac1-design-source.test.mjs`, first | In CONTRIBUTING.md, split into paragraphs and list items: none about the docs says they are generated (`is/are generated`, `generated from`) or says not to edit them (`don't/do not/never edit`); one holds the word `source` and either both `technical-design.md` and `canvas-primitives.md`, or `docs/`. |
| 1. `#1329.6069ef82` | `ac1-design-source.test.mjs`, second | Issue #9605 names `deep zorptangle` and links `technical-design.md#zorptangle-fixture-command`. Before: the drift lane is `FAIL` and a line names 9605 and `deep zorptangle`. Then a commit appends `## Zorptangle fixture command` and a line naming `` `deep zorptangle` `` to the copy's `docs/technical-design.md`, and nothing else. After: drift, design links and public text each `PASS`, and `runLanes` returns 0. |
| 2. `#1329.bbfb846d`: a planted open issue naming a `deep` command the design doesn't hold fails the drift lane, naming the issue and the command, and a planted link to a missing heading fails too | `ac2-drift-lane.test.mjs`, first | #9605 also names `` `deep zorptangle` ``. Verdict `FAIL`, non-zero, and a line holds 9605 and `deep zorptangle`. |
| 2. `#1329.bbfb846d` | `ac2-drift-lane.test.mjs`, second | #9605's design link is `…/docs/technical-design.md#no-such-heading-1329`. Verdict `FAIL`, non-zero, and a line holds 9605 and `technical-design.md#no-such-heading-1329`. |
| 2. `#1329.bbfb846d`, the clean twin | `ac2-drift-lane.test.mjs`, third | 40 clean issues, #9601 also naming `deep quuxify` and `deep_quuxify`, both planted in `scripts/planned-names.txt` with `#9601`. Verdict `PASS`, return 0. |
| 3. `#1329.c6aca305`: a planted change whose text holds a studied name fails the public-text lane without printing the list. A twin with a common word passes | `ac3-public-text.test.mjs`, first | `Zorblax` and `Quindleplex` are listed. The change adds a note holding `Zorblax`. Verdict `FAIL`, non-zero, and the output holds no `Quindleplex` (any case), no listed hash and no salt-free hash of either name. |
| 3. `#1329.c6aca305`, the twin | `ac3-public-text.test.mjs`, second | The same change with `window` in place of `Zorblax`. Verdict `PASS`, return 0. |
| 4. `#1329.077043aa`: after the owed lines land, the drift lane passes on every open issue, or lists each exception with its issue | `ac4-live-issues.live.test.mjs` (live) | The drift lane on the real docs and the real open issues is `PASS` with return 0, and each planned-names entry is `<name> #<issue>` for an open issue that names it. Offline: skipped as INCONCLUSIVE. |

## Readings where the issue leaves a choice

- **"Lists each exception with its issue"** is read as the planned-names list, each entry carrying the issue that
  plans the name. A lane that FAILs, however well it names each issue, doesn't meet criterion 4: the owed lines are
  supposed to have landed. A design link to a missing heading has no exception list; the issue or the doc gets fixed.
- **"A design change lands with no step outside the repo"** is read as: a commit to the docs is what the doc lanes
  read, and they pass on it. The tests don't run the lint lane's repo rules or the proof lane on that change. They
  can't see a generation step outside the repo either; CONTRIBUTING.md's wording is the check for its retirement.
- **"A person is asked only when it changes an invariant or a row under Decided"** isn't an acceptance criterion and
  isn't tested.
- **Agent tools.** The Scope says the drift lane checks them too, but criterion 2 names a `deep` command only. The
  clean twin covers tools (real ones pass, planned ones pass); no test plants an unknown tool.
- **Offline.** No criterion asks for the drift lane offline; #605's and #910's rules (INCONCLUSIVE, never PASS) are
  the obvious ones to follow, untested here.

## Files

- `helpers.mjs`: the scratch copy with its git history, the fake `gh`, the sandboxed environment, the lane runner, the
  clean issues, and the planted planned-names and studied-names entries.
- `ac1-design-source.test.mjs`: criterion 1, two tests.
- `ac2-drift-lane.test.mjs`: criterion 2, two planted failures and the clean twin.
- `ac3-public-text.test.mjs`: criterion 3, the studied name and the common-word twin.
- `ac4-live-issues.live.test.mjs`: criterion 4, live.
- `BASE-FAILURE.txt`: the run on the base (all eight fail), and the planted fix the harness was checked against (the
  seven offline tests passed on it).

No fixture holds a secret, personal data or a real studied name. Issue numbers 9601 to 9640 and the names `zorptangle`,
`quuxify`, `Zorblax` and `Quindleplex` are made up.
