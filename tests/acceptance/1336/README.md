# Acceptance tests for #1336: one hub for a project shared by several people

These tests were drafted blind from issue #1336 (its body as of November 7), `docs/technical-design.md`,
`docs/parallel-proof.md`, AGENTS.md, CONTRIBUTING.md and the base commit `2c89d582` (`origin/main`, no
implementation). At the base I also read `scripts/lanes.mjs`, `scripts/checks.mjs`, `scripts/proof-change.mjs` (for
`criterionId`), `scripts/catalogue-drift.mjs`, `scripts/design-links.mjs`, `scripts/open-issues.mjs`, and
`tests/acceptance/1329/` for conventions. What `helpers.mjs` needs from those (GitHub's slug and heading-text rules,
the way a lane is picked and run through `runLanes`) is copied, never imported. Per AGENTS.md, the implementing agent
doesn't edit these tests; a dispute goes to a blind redraft by this job.

The issue is design-only: its deliverable is a change to `docs/technical-design.md`, and its Proof is "the design
change and its doc lanes".

## How to run them

```sh
node --test 'tests/acceptance/1336/*.test.mjs'                                  # all, the live ones included
node --test tests/acceptance/1336/ac1-section.test.mjs tests/acceptance/1336/ac2-old-wording.test.mjs   # offline only
```

They're plain `node --test` files and need no build, except the doc lanes test: the catalogue drift lane imports
`packages/contracts/dist`, so build that first (`npm ci && npm run build -w @deepbuild/contracts`); without it the test
skips as `INCONCLUSIVE:`. The two `*.live.test.mjs` files read GitHub through `gh`, so they need network and `gh`
signed in with read access to `windoliver/deepbuild` (in a sandboxed agent shell, gh needs the sandbox off). Offline or
signed out they skip with a message starting `INCONCLUSIVE:`; a skip is never a pass. The checkout must hold the base
commit `2c89d582`, which criterion 1's Decided-table test reads with `git show`.

## The surface (my choice where the issue leaves it open)

- **The new section** is the one heading in `docs/technical-design.md` (outside fenced code, any level) whose text
  holds the whole words `hub` and `project` (or `projects`), ignoring case, as in the issue's subject "one hub for a
  project". The base has none. More than one such heading fails. Its body runs to the next heading of its level or
  higher, so its own subheadings belong to it.
- **Its anchors** are its GitHub slug (as `scripts/design-links.mjs` computes it) and each `<a id>` on the lines just
  above the heading, with only blank lines and other anchor lines between, as the design writes `<a id="scale"></a>`.
  An issue links into the section with `docs/technical-design.md#<one of those anchors>`.
- **What "answers" a decision means.** The section holds the words any answer to that Scope decision has to use:

  | Decision | Words the section must hold |
  |---|---|
  | Who writes the record | `writer`, `record`, `connection` |
  | What's shared and what isn't | `shared`, `personal`, `transcript` |
  | Where it runs | `always-on` (or `always on`), `host@1` |
  | Whose plan | `plan`, `account` |
  | Who approves what | `approv…`, `ask`, `named` |
  | No model decides to start work | `model`, `dispatch…` |

  That is a floor for a text a person also judges (criterion 4), not a reading of the text.
- **"With what was not taken"** is the phrase the design already uses for it: the section says `Not taken` (any case)
  at least six times, once per decision.
- **The Decided table** is the table under the heading slugged `decided` (`### Decided`, anchor `decisions-made`). Its
  rows are its `|` lines without the header and the rule line. It must have more rows than at `2c89d582` (107), and at
  least one row not at the base must link to one of the section's anchors (`](#anchor)`) or hold the words `hub` and
  `project`.
- **The old wording** is the base's not-proposed phrase "different people's agents writing one record", searched in
  every text file under `docs/` (`.md`, `.txt`, `.html`, `.json`, `.yaml`) and in `README.md`, ignoring case, curly
  apostrophes and line breaks.
- **The doc lanes** are the three CONTRIBUTING.md names: catalogue drift, design links and names, and public text. The
  test picks each as the one entry of `checks` in `scripts/lanes.mjs` matching `/catalogue|drift/i`, `/\blinks?\b/i`
  (and not the first), and `/\bpublic\b/i`, and runs that entry's own `commands` with cwd at this checkout, against one
  fetch of the open issues (`gh issue list --state open --limit 5000`, handed over in `DEEP_OPEN_ISSUES` as
  `scripts/open-issues.mjs` reads it). Public text so reads this checkout's own change against `origin/main`.
- **Why not `runLanes`, and why a baseline.** Two things found while drafting, on November 7. First, `runLanes` queues
  each lane behind the machine-wide throttle (`scripts/throttle.mjs`, one `build` slot on a Mac), and with other
  worktrees' builds holding it, a run of the three lanes didn't start within 15 minutes; the lanes' commands take about
  10 s alone. Second, catalogue drift fails on main today on 15 event kinds named in open issues the design doesn't
  touch (such as `question.rs` in #1457), so no design change can make it print PASS. The test therefore holds the
  change to this: a lane passes, or every finding it prints (line numbers dropped) is also printed when the same
  commands read the base commit's `docs/**/*.md` and `scripts/planned-names.txt` against the same issues. A finding
  the change brings, in the docs or in an open issue's link (a heading the change renamed), fails. Public text scans
  the change, so it has no baseline and must pass. A lane that prints `INCONCLUSIVE` makes the test skip as
  `INCONCLUSIVE:`. The test first requires the new section, since "no line contradicts the new section" means nothing
  without it.

## Criteria and tests

Each tag is `criterionId` from `scripts/proof-change.mjs`: `#1336.` and the first 8 hex of the SHA-256 of the `- [ ]`
text, trimmed, whitespace collapsed. Every test name starts with its tag.

| Criterion | Tag | Tests |
|---|---|---|
| 1. The design holds a section answering each decision above, with what was not taken, and the Decided table gains its rows | `#1336.4c4e63a7` | `ac1-section.test.mjs`: the section and its six decisions with six `Not taken`; the Decided table's new rows |
| 2. Scale later's not-proposed line is replaced, and no line of the design contradicts the new section: the doc lanes pass, and a search for the old wording finds nothing | `#1336.94a30ea1` | `ac2-old-wording.test.mjs` (offline); `ac2-doc-lanes.live.test.mjs` (live) |
| 3. #1337, #1338, #1339 and #1340 each link into the new section | `#1336.0ffe6c3b` | `ac3-issue-links.live.test.mjs`: reads each body with `gh issue view <n> --repo windoliver/deepbuild --json body` |
| 4. One taste call on the text, by any one person on the project. The others are told, and can overrule it | `#1336.28fd1eed` | None: a person's taste call isn't testable by code. It's recorded by that person on the PR. |

Not tested: whether a line elsewhere in the design contradicts the new section in meaning. Code can't read that; the
doc lanes catch broken links, unknown names and studied names only, and criterion 4's reader covers the rest.

## On the base

All five tests fail on `2c89d582` for the expected reasons: no heading names the hub and the project, the Decided table
has the base's 107 rows, and the old wording is in `docs/technical-design.md`. See `BASE-FAILURE.txt`, which also
describes the planted fix and its mutants, run in a scratch clone and never in this checkout.
