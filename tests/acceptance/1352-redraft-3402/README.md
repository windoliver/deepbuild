# Acceptance tests for #1352, blind redraft for #3402: the section finder and the Decided reading

Written blind at base commit `c60215952` (main, with nothing that implements #3402), from issue #3402's body, the
design and that base. #3402's Scope asks for "a blind redraft of the suite's section finder and of its Decided reading:
the section is found by its anchor, `cloud-hub`, and the rows #1352 added are read in every table with the Decided
columns under Decisions. No criterion's text changes", running in the originals' place, with the original files left as
they are. The drafting job saw no work that implements the issue: no other commit, branch, worktree or pull request, and
nothing on GitHub. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft
by this job (design: Dogfooding). #3402's own six criteria are held in `tests/acceptance/3402/`.

## Why a redraft

`tests/acceptance/1352/` finds its section as the one heading holding the words `hub` and `cloud` or `hosted`, and
reads Decided rows only under the heading slugged `decided`. Since #3138 the design holds a second such heading,
`### Decided for a hosted hub`, and the seven rows #1352 added sit under it. So on main four of its tests fail (three
at the finder, one at the row count) though the section, its rows and its recorded taste call are all there. No
program passes them without undoing #3138's approved change, so they are redrafted, not edited.

## What was read

- **The issue**, #3402, its body as the brief gave it. **AGENTS.md.**
- **The design**, `docs/technical-design.md` at the base: A hub of your own in the cloud (`#cloud-hub`), Decisions with
  its four tables that have the Decided columns, Threats, Privacy; in How we know version 0 works: Criteria to tests,
  both ways, Wrong programs, The edit guard, Failing on an assertion.
- **The first draft**, `tests/acceptance/1352/` whole (README, helpers, the four offline tests, the two live ones,
  BASE-FAILURE.txt), and `docs/evidence/1352/taste-call.json`.
- **The base, for surfaces and house format**: `scripts/lanes.mjs`, `scripts/lanes-lists.mjs` (`byHand`, `redrafted`),
  `scripts/known-failures.json`, `scripts/proof-change.mjs`, `scripts/proof-runs.mjs`, `scripts/proof-reporter.mjs`,
  `scripts/bays.mjs` (how a proof copy gets its git folder), and the redraft folders `1111-redraft-2047/`,
  `3461-redraft-once/`, `3245/` with `112-redraft-3245/`.
- Read with `git show 6aa228ce:docs/technical-design.md`, the first draft's own base: none of the seven questions
  below is a row there, so each is a row the table gained.

## Run

```sh
node --test tests/acceptance/1352-redraft-3402/ac1-section.test.mjs \
  tests/acceptance/1352-redraft-3402/ac3-agent-routes.test.mjs tests/acceptance/1352-redraft-3402/ac5-taste-call.test.mjs
```

Node 24 and the checkout, Node built-ins only: no `npm ci`, no build, no network, no `gh`, and no git (the first draft
needs the commit `6aa228ce`; this redraft reads only the checkout's files). Four tests, under a second. Nothing is
written anywhere.

## Criteria and tests

Each test keeps its criterion's tag exactly as `tests/acceptance/1352/README.md` lists it, and no criterion's text
changes.

| #1352's criterion | Tag | First draft, now by hand | Redraft, in its place |
|---|---|---|---|
| 1. The design holds a section answering each decision above, with what was not taken, and the Decided table gains its rows | `#1352.4c4e63a7` | `1352/ac1-section.test.mjs`, two tests | `ac1-section.test.mjs`: the section, anchored `cloud-hub`, with its eight decisions and eight `Not taken`; the seven rows in the Decided tables under Decisions |
| 3. Each agent's route on a hosted machine is written down from its provider's own terms, as allowed, API key only, or not allowed | `#1352.fbaaa304` | `1352/ac3-agent-routes.test.mjs` | `ac3-agent-routes.test.mjs` |
| 5. One taste call on the text, by any one person on the project. The others are told, and can overrule it | `#1352.28fd1eed` | `1352/ac5-taste-call.test.mjs` | `ac5-taste-call.test.mjs` |

Criterion 2's offline file, `1352/ac2-privacy-threats.test.mjs`, uses neither the finder nor the Decided reading. It is
not redrafted and stays in the lanes as it is; its threats test fails on main for the design's own reason, which #3402
settles in the design. The two live files are below, under Not redrafted.

## What changed from the first draft, and what did not

- **The section** is the section of the one heading that carries the anchor `cloud-hub`: as its GitHub slug, or as an
  `<a id="cloud-hub">` on the lines just above it, with only blank lines and other anchor lines between. No heading, or
  several, carrying it fails. What any heading says is not read, so other headings with the words `hub`, `cloud` or
  `hosted` change nothing.
- **Its text and its anchors are the first draft's**: from the heading to the next heading of its level or higher,
  without the blank and `<a id>` lines that close it; its slug and each `<a id>` above it. So the SHA-256 the taste
  call names is of the same bytes, and the test passes with `docs/evidence/1352/taste-call.json` exactly as the base
  holds it: under this finder the section's SHA-256 at the base is
  `7f96048ad84d0df53304ad3835aaf6dd2240a65b186983579a3d338b29822743`, the record's.
- **The eight decisions' words, the eight `Not taken`, the six agents with a route word and a terms link on one line,
  and every field of the taste call's record** are the first draft's, copied (`tests/acceptance/1352/README.md`, The
  surface).
- **The Decided tables** are every table under the heading slugged `decisions` (`## Decisions`, to the next heading of
  its level) whose header row holds exactly the cells `Question | Decision | Reopens if`, whatever heading inside
  Decisions it sits under. A table's rows run from under its rule line to the first line that isn't a `|` line. The
  base has four such tables (under `### Decided`, `### Decided for sessions, asks and turns`, `### Decided for what a
  project learns and audits` and `### Decided for a hosted hub`); the table under `### Yours` has other columns and is
  not read.
- **"Gains its rows"** means these seven rows, each found by its question, the row's first cell, exact:
  `A hub for someone with no computer`, `Who runs a hub in the cloud`, `Whose agents a hosted hub runs`,
  `What a hosted hub keeps in the cloud`, `A browser reaching a hub`, `Who pays for a hosted hub`,
  `Moving between a hosted hub and your own computer`. They are the rows the base design holds under
  `### Decided for a hosted hub`; none was a row at `6aa228ce`. A missing one fails the test, named by its question.
  The first draft's second rule stands: at least one of them links to the section (`](#cloud-hub)` or its slug) or
  holds the words `hub` and `cloud` or `hosted`. The first draft's count against `6aa228ce` is gone: the count of one
  table says nothing once rows may sit in any of them, and it needed git.
- **Each check returns its problems** as a list of sentences, and its test asserts the list is empty with no message of
  its own, so a failure prints each problem. A check takes the finder or the reading it uses as a parameter, with the
  ones above as defaults; `tests/acceptance/3402/` passes a planted one, and the design as the base commit holds it,
  to show that it fails.

## Not redrafted, and not tested

- `1352/ac2-doc-lanes.live.test.mjs` and `1352/ac4-issue-links.live.test.mjs` call the first draft's finder too, so by
  hand they stop at it today. They need `gh` and the network, which this job may not use, so it could not run a redraft
  of them and wrote none. #1352's criterion 4 has only that live test; until it is redrafted, no test of criterion 4
  can pass.
- A reworded question fails the Decided test as a dropped row does; that is the cost of naming the row.
- As in the first draft: a keyword can sit in what was not taken, dropping the bullet **The same hub.** is caught only
  by the `Not taken` count since its words recur in other bullets, any https link counts as a provider's terms, and
  whether the text reads right is the taste call's.

## On the base

All four tests pass on `c60215952`, where the first draft's four fail; `tests/acceptance/3402/BASE-FAILURE.txt` holds
the runs, the planted fix and the planted wrong designs.
