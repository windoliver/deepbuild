# Acceptance tests for #910: the design links lane

These tests were drafted blind from issue #910 (its text as of October 31), `docs/technical-design.md`,
`docs/canvas-primitives.md`, AGENTS.md and the base commit `2f43a669`, which is `origin/main` and has no
implementation. At the base I also read `scripts/checks.mjs`, `scripts/lanes.mjs`,
`scripts/catalogue-drift.mjs`, `packages/contracts/src/catalogue.ts` and `tests/acceptance/605/`. The
scratch copy, fake `gh` and lane runner follow #605's helpers. They're copied into `helpers.mjs` here, never
imported. Per AGENTS.md, the implementing agent doesn't edit these tests. A dispute goes to a blind redraft by
this job.

Run them with:

```sh
npm ci                                   # once, if node_modules is missing
npm run build --workspaces               # the catalogue drift lane reads packages/contracts/dist
node --test 'tests/acceptance/910/*.test.mjs'
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up. Run them by hand. All
eight are offline. Each test copies the checkout into a sandbox, which takes most of the run: about 80 s for
the eight on the reference Mac. On the base, all eight fail because there is no lane, as `BASE-FAILURE.txt`
shows. That file also lists the planted wrong programs each test was run against.

## The surface (my choice where the issue leaves it open)

The issue names a local lane in `scripts/checks.mjs`, beside #605's catalogue drift lane, that reuses its
cached open-issue fetch. The tests reach the code only through these:

- **The lane is the one entry of `checks` in `scripts/lanes.mjs` whose name matches `/\blinks?\b/i` and
  not `/catalogue|drift/i`.** "design links" fits. `scripts/checks.mjs` runs `runLanes(checks)`, so the
  lane must be in that list. The name must not match `/catalogue|drift/i`, because #605's tests require
  exactly one lane that does. The tests read that lane's verdict only.
- **The tests run the lanes the way `checks.mjs` does.** A child `node` process, with cwd at a scratch copy,
  imports the copy's own `scripts/lanes.mjs`. It calls `runLanes` on the links lane and the catalogue drift
  lane, in their order in `checks`. That's how the preflight runs them, so a links lane that reads the drift
  lane's cache finds it written. Criterion 3's test runs the links lane alone, since it asks what happens
  with no cache. Any sharing of the fetch must happen inside the lanes as `runLanes` runs them. A prefetch
  in `checks.mjs` before `runLanes` isn't seen by these tests.
- **The verdict is what `runLanes` prints and returns.** It prints `PASS <name> (…)` or
  `<STATE> <name>: <reason>`. Its return value becomes `checks.mjs`'s exit status.
- **Naming an issue.** For an issue, one output line holds both the issue's number, as a whole number
  (`#9605` or `issue 9605`), and the link's text from `<file>.md#` on, such as
  `technical-design.md#no-such-heading`.
- **Naming a doc line.** For a doc line, one output line holds the doc's file name with the line number and
  the anchor `#<slug>` it links. These forms are accepted: `docs/technical-design.md:2538`,
  `technical-design.md:2538,2556`, `technical-design.md:2538, 2556` and `technical-design.md line 2538`.
- **The count.** It's a number on a line of the lane's own output that says `link` or `links`, such as
  `design links: 412 links …`. The largest number on such lines is taken as the count. It must be at least
  the number of distinct `docs/*.md` targets that the docs and issues link. That holds however the lane
  counts, by link or by distinct target.

### The scratch copy

Each test gets a sandbox under the OS temp folder, removed afterwards. Its `repo/` holds this checkout's
working tree: tracked files, untracked files git doesn't ignore, and each `packages/*/dist/` that exists. It
has a fresh `git init` with the checkout's `origin` URL as its remote, and `node_modules` links to the
checkout's. Ignored files aren't copied, so `target/open-issues.json` never reaches a test unless the test's
own drift lane writes it. If `node_modules` or `packages/contracts/dist` is missing, a run with the drift
lane stops with `BLOCKED: … run npm ci and npm run build --workspaces`.

### `gh`, the cache and offline

- **The open issues come from a fake `gh` first on `PATH`, as in #605.** It answers
  `gh issue list … --json <fields>` from a fixture list. It honours `--limit`/`-L` and returns 30 without
  one. It also answers `gh auth status` and `gh --version`, and fails anything else. Every call is logged.
- **The fixture is 40 open issues, #9640 down to #9601, newest first.** Each clean body links one real
  heading by its full blob URL, as issues do:
  `https://github.com/windoliver/deepbuild/blob/main/docs/<file>.md#<slug>`. Every fourth also links
  `docs/extension-guide.md` with no anchor. Each also links outside `docs/`: `scripts/checks.mjs`,
  `AGENTS.md#proof` and issue #605. The planted issue is #9605, the 36th, so a lane that fetches with gh's
  default limit misses it.
- **"No cache"** means no `target/open-issues.json` (the drift lane's file) and no `DEEP_OPEN_ISSUES` (perf's
  hand-off). The sandbox never inherits `DEEP_OPEN_ISSUES` or `DEEP_PREFLIGHT`.
- **"No network"** is a fake `gh` that fails every call but `--version`. It prints what `gh` prints when it
  can't reach GitHub and exits 1.
- **Every process runs sandboxed.** `HOME`, `TMPDIR` and the XDG folders are in the sandbox, and the GitHub
  token and host variables are unset.

## Slugs

GitHub's slug rules, which the hand-worked slugs in these tests follow:

1. Markdown in the heading reduces to its text: `` `code` `` becomes `code`, `[text](url)` becomes `text`,
   `**bold**` becomes `bold`, and HTML tags drop.
2. The heading is lowercased.
3. Every character that isn't a letter, number, space, hyphen or underscore is removed. Unicode letters stay,
   so `é`, `ü` and `ï` are kept, and `_` is kept.
4. Each space becomes one hyphen, with no collapsing, so `anchors & github` becomes `anchors--github`.
5. A repeated slug gets `-1`, `-2` and so on, counted through the whole doc.
6. A line inside fenced code is not a heading.
7. An explicit `<a id="x">` or `<a name="x">` is an anchor too.

These are the real headings the clean issues link, each with its slug:

| Heading | Slug |
|---|---|
| How we know version 0 works | `how-we-know-version-0-works` |
| Hooks are evidence, not a state machine | `hooks-are-evidence-not-a-state-machine` |
| Extension API (TypeScript, in-process) | `extension-api-typescript-in-process` |
| The second `#### Evidence` | `evidence-1` |
| `<a id="verdicts">` | `verdicts` |
| Text `text@1`: halo | `text-text1-halo` |
| Frame and group `frame@1`, `group@1` | `frame-and-group-frame1-group1` |
| Vector field `vector_field@1` | `vector-field-vector_field1` |
| The second `#### Honest numbers` | `honest-numbers-1` |
| Canvas module: interface and implementation | `canvas-module-interface-and-implementation` |

`anchors.test.mjs` appends a section to the fixture's `technical-design.md` with headings for each rule. Its
slugs are `slug-fixture-links-anchors--github-910`, `the-deep_show-call--modes`, `café-über-naïve`,
`twice-named-section` and `twice-named-section-1`, `see-the-hub-and-bold-words` and `32-numbers-v10v2`. It
also has two anchors, `slug-fixture-explicit` (`<a id>`) and `slug-fixture-named` (`<a name>`), and a fenced
`## Fenced not a heading`.

## Criteria to tests

Each criterion's ID is `#910.<first 8 hex digits of the SHA-256 of its `- [ ]` text, trimmed, white space collapsed>`, as
`scripts/proof-change.mjs` (`criterionId`) works it out. The tests for a criterion carry its tag at the start of their
name, so the proof lane's trace finds them. The scope and clean tests carry no tag.

| Criterion | Test | What it requires |
|---|---|---|
| 1. `#910.ed201fe7`: A planted issue body linking `technical-design.md#no-such-heading` fails the lane, naming the issue and the link | `ac1-issue-link.test.mjs` (tagged `#910.ed201fe7`) | #9605's body links `…/blob/main/docs/technical-design.md#no-such-heading`. The docs are the real ones and the other 39 issues are clean. The lane's verdict is `FAIL`, `runLanes` returns non-zero, and one line holds `9605` and `technical-design.md#no-such-heading`. |
| 2. `#910.4dcc6995`: A heading renamed in a fixture design doc fails every doc line that links its old slug, naming each | `ac2-renamed-heading.test.mjs`, first (tagged `#910.4dcc6995`) | In the fixture, `canvas-primitives.md`'s `#### Canvas module: interface and implementation` is renamed in place. The test finds every doc line that links `canvas-primitives.md#canvas-module-interface-and-implementation` (at least 2; today `technical-design.md:2538` and `:2556`). The verdict is `FAIL`, non-zero, and each of those lines is named with the old anchor. |
| 2. `#910.4dcc6995` (same-doc links) | `ac2-renamed-heading.test.mjs`, second (tagged `#910.4dcc6995`) | `technical-design.md`'s `## How we know version 0 works` is renamed. Every line linking `(#how-we-know-version-0-works)` (today `technical-design.md:2626`) is named the same way. |
| 3. `#910.fa84e550`: With no network and no cache, the lane is INCONCLUSIVE, never PASS | `ac3-offline.test.mjs` (tagged `#910.fa84e550`) | The links lane runs alone with the failing `gh`, no `target/open-issues.json` and no `DEEP_OPEN_ISSUES`. Its only verdict line is `INCONCLUSIVE <name>: …`, and `runLanes` returns non-zero. |
| Clean case and the Proof's count | `clean.test.mjs`, first | The real docs and 40 clean issues give `PASS` with return 0. The lane's output has a links line whose count is at least the distinct `docs/*.md` targets linked. That's 47 today: 40 from the docs and 7 more from the issues. |
| Scope: reuses the drift lane's cached fetch | `clean.test.mjs`, second | With both lanes run in `checks` order on clean data, the links lane passes and `gh issue list` runs exactly once. |
| Scope: GitHub slugs and explicit anchors | `anchors.test.mjs`, first | With the slug section appended, six issues link its slugs and `<a id>`, and the section's own same-doc links cover all nine anchors. The verdict is `PASS`. |
| Scope: the anchor is a heading, and the file exists | `anchors.test.mjs`, second | Eight issues each link a near miss, and each must be named with its link. The near misses are: hyphens collapsed (two cases), `_` dropped, a `-2` that doesn't exist, link markup kept, a heading in fenced code, non-ASCII letters dropped, and `docs/no-such-design.md#overview`. |

## Readings where the issue leaves a choice

- **Which links count.** From the docs: markdown links whose target resolves to `docs/*.md`, outside fenced
  code. That means `(#anchor)` into the same doc and `(./other.md#anchor)` into another. From issues: links
  into `docs/*.md` on `github.com/windoliver/deepbuild/blob/<ref>/`. A link with no anchor needs only the
  file to exist. The tests never plant a link outside `docs/`.
- **"Naming each" doc line** means file and line number, each line accounted for. A lane may group several
  lines under one file, as the drift lane does with `file:1,2`.
- **Reuse of the cache.** The issue says the lane reuses the drift lane's cached open-issue fetch. The tests
  read that as: run beside the drift lane, it doesn't fetch again (one `gh issue list` in all). It could
  read `target/open-issues.json` the drift lane just wrote, or share its fetch some other way within
  `runLanes`. Alone and with nothing cached, it must still not pass (criterion 3). The tests don't say
  whether it may fetch when run alone online. They don't say what a stale cache means offline either.
- **INCONCLUSIVE makes the checks fail.** `runLanes` at the base already keeps the state of a diagnostic
  that starts `INCONCLUSIVE ` and returns non-zero for it. The test requires both.
- **Offline doc checks.** The issue doesn't say whether broken doc links should still read FAIL offline.
  Nothing tests it.
- **Counting.** The Proof asks for "its count of links checked". The tests require a count and a floor, not
  an exact number, because counting by occurrence and counting by target are both fair readings.

## What the real docs hit today

Nothing. At the base, the two docs hold 127 links into `docs/*.md` (40 distinct targets). Under the slug rules
above, every one lands on a heading or an `<a id>`. The only file links without anchors are
`./canvas-primitives.md`. So the clean case's PASS is reachable on the real docs as they are.

One incidental observation, not a test. While setting up the scratch clone I ran the planted fix once with
the signed-in `gh`. It read 561 open issues and found no broken links in 2,776 checked. That run is not part
of the proof.

## Wrong programs checked

All runs were in a scratch extract of the base (`git archive HEAD`), with `npm ci` and the contracts package
built. A planted fix (a `design links` lane after `catalogue drift`) passed all eight tests. Then one change
at a time was applied to it, and each was caught by at least one test. `BASE-FAILURE.txt` lists which tests
caught each program:

- A lane that ignores issue bodies.
- A lane that checks only that the file exists.
- A slugger that keeps punctuation.
- A slugger that keeps case.
- A slugger that collapses spaces.
- A slugger that keeps only ASCII letters.
- A slugger with no duplicate suffixes.
- A slugger that doesn't reduce markdown.
- A lane that ignores `<a id>`/`<a name>`.
- A lane that reads headings inside fenced code.
- A lane that names only the first bad doc line.
- A lane that names a doc link without its line.
- A lane that skips same-doc links.
- A lane that reads a failed `gh` as zero issues.
- A lane that reports offline as FAIL.
- A lane that fetches again, ignoring the cache.
- A lane that fetches again with gh's default limit.
- A `runLanes` that returns 0 for INCONCLUSIVE.
- A lane that prints no count.

## Files

- `helpers.mjs`: the scratch copy, the fake `gh`, the sandboxed environment, the lane runner, the clean
  issues and the naming checks.
- `ac1-issue-link.test.mjs`: criterion 1.
- `ac2-renamed-heading.test.mjs`: criterion 2, with two tests.
- `ac3-offline.test.mjs`: criterion 3.
- `clean.test.mjs`: the clean case with its count, and reuse of the drift lane's fetch.
- `anchors.test.mjs`: the Scope's slug, anchor and file rules.
- `BASE-FAILURE.txt`: the run on the base and the planted programs.

No fixture holds a secret or personal data. Issue numbers 9601 to 9640 are made up.
