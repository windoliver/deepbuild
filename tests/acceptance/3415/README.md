# Acceptance tests for #3415: the design reads as GLOSSARY.md has it, and the glossary check fails the old phrases

Written first, blind, from issue #3415 (its report, Scope, six acceptance criteria and Proof), the design sections it
links and base commit `c13122f6a`, by a job that never saw an implementation. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Node's test runner and
built-ins only. The `.mjs` files hold no comments (#3455's ratchet starts a new file at 0); what they would say is here.

| AC | ID | Tests |
|---|---|---|
| AC1 | `#3415.2e31d57b` | `ac1-phrases.test.mjs` (four: five planted lines of prose in each design doc; the phrases inside code; the merge base's docs and the count) |
| AC2 | `#3415.e847772a` | `ac2-definition.test.mjs` (one: two planted sentences fail, the three named lines pass) |
| AC3 | `#3415.7fecea8f` | `ac3-validity-gate.test.mjs` (two: the Check and Claim entries as the checkout has them; a planted kind) |
| AC4 | `#3415.9322769a` | `ac4-links.test.mjs` (two: the renamed heading and the lane with the open issues read; a planted rename) |
| AC5 | `#3415.5803b056` | `ac5-decided-row.test.mjs` (two: the row alone under a signed tag; the row and another file) |
| AC6 | `#3415.8f20cdc2` | none: each changed line beside the line it replaced, and whether every sentence still says what it said, is a person's call, recorded. No test can make it PASS; without that record the run stays INCONCLUSIVE |

IDs are the first 8 hex of the SHA-256 of each criterion's text after `- [ ] `, trimmed, whitespace collapsed. Each
test's name starts with its ID and its AC number.

Run, from the repo's root, under Node 24, with network and `gh` signed in (AC4 reads the open issues):

```
node --test --test-concurrency=1 'tests/acceptance/3415/*.test.mjs'
```

## What was read

`AGENTS.md`; `GLOSSARY.md`; the issue; `docs/technical-design.md` (The contract and its Ask-task, Claim and Check
entries, The done loop, States people see, the Done gate line of Scope, the done-gate row, the edit guard under Six
weeks, Decided, Dogfooding); `scripts/glossary-lint.mjs`, `scripts/design-links.mjs`, `scripts/open-issues.mjs`,
`scripts/doc-links.mjs` and the `lint` and `design links and names` entries of `scripts/lanes.mjs` `checks`, for how
to run them and what they print; `scripts/proof-guard.mjs` and `scripts/proof.mjs` for the guard's output; suites
`tests/acceptance/3412/` (house shape), `3403/` and `3166/` (the guard in a scratch repository, the security-key
stand-in).

## The surfaces (my choice where the issue leaves it open)

- **"The check" is `scripts/glossary-lint.mjs`**, the lint lane's text check #3412 added, which the issue says this
  task extends. Only it runs, not the whole lint lane: 3412's lane runs took 1.5 to 10 minutes each, and this script
  alone takes about a second, so every file stays far under 20 minutes. A change that moves the phrases into another
  script of the lint lane fails these tests; that is a dispute for the redraft, not an edit here.
- **A scratch copy.** The checkout's working tree (tracked files and untracked ones git doesn't ignore, never `.git`)
  in a temp folder, with a fresh `git init` and origin set but nothing committed (neither script reads history). Git
  runs with no `GIT_*` or `DEEP_*` variable, global or system config. The checkout is never written; the merge base's
  docs are read from it with `git show c13122f6a:<path>`. Copying is most of each test's time: about 3 s on a quiet
  machine, 2 to 5 minutes at load 80.
- **Plants.** Invented lines, each starting `Zorvanthic fixture line:`, inserted as their own paragraphs before the
  second `## ` heading outside a fence, so no unrelated line can satisfy a test. A failing line names a plant when the
  check exits non-zero and one output line holds `<doc>:<line>` (or `<doc> … line <n>`) and, for AC1, the phrase.
- **AC1.** One run per design doc, five planted lines, one per phrase. "Inside code" is a prose line holding the five
  phrases only as code spans, plus a fenced block holding them: alone it must exit 0; beside one planted line of prose
  the prose line must be named and no code line named, which proves the check read that place. "The merge base" is
  base commit `c13122f6a`'s two design docs put into the copy: the check must fail, a failing line must name a doc's
  line for each of the five phrases (the base holds all five in prose), and the output must show a whole number, other
  than a line number, equal to the count of those finding lines, of the places they name, or of all output lines
  naming a doc's line (a check may count its definition-of-done and validity-gate findings in the same total).
- **AC2.** Two planted sentences: the Done gate line's old words ("the definition of done of each open ask") and the
  done-gate row's ("that ask's definition of done"). In the same run, the Done gate line (`- **Done gate:**`), the
  done-gate row (`| done-gate |`) and the queued row of States people see (`| queued |`) must each be found once and
  none named by the check: unchanged, a correct check fails them, so the test also needs the docs change.
- **AC3.** The kinds list is the run of `- ` items in the `#### Check` entry. The Claim entry must hold a sentence with
  "validity gate" and "before any check". The plant is one more first item naming the validity gate, at that line.
- **AC4.** "The Ask-task heading" is found by the one `<a id="ask-task">` beside a heading, as Scope asks ("keeps its
  old anchor as an `<a id>`"); the first test needs that heading to read Task and no Ask-task heading left. "A heading
  this renames" is any heading of `docs/technical-design.md` whose GitHub slug the base has and the checkout's headings
  don't; each must still be an anchor of the file (an `<a id>`). The lane is `node scripts/design-links.mjs` in the
  copy (a `git init` with origin set, so `gh` knows the repo), with the environment's `gh` sign-in and network; it
  fetches the open issues into the copy's `target/open-issues.json`, which the tests read to count them and to find
  the issues that link `technical-design.md#ask-task` (#303 at the base). The first test needs the issues read (no
  `INCONCLUSIVE`, no "the open issues were not read") and no lane line saying a link into a renamed heading's anchor
  lands nowhere. It does not need the lane's exit 0: at the base the lane already fails on links #3496 to #3499 make to
  `#what-a-person-reads-on-a-plain-surface`, a heading no doc has, which this issue doesn't touch; when the lane exits 0
  it must also say it read that many open issues. The plant renames the Task heading to `Zorvanthic fixture heading`
  and removes the `<a id>`; a failing lane line must name one of those issues and `#ask-task`. At the base no
  `<a id="ask-task">` exists, so both tests fail there for the heading not yet renamed.
- **AC5.** The guard is this checkout's `node scripts/proof.mjs guard`, run in a scratch repository through #3403's
  helpers (which use #3166's clean environment and security-key stand-in): main holds the approvers list with the
  stand-in's key, the proof lanes' marker and the checkout's design doc with the one row put back as the merge base
  has it; the change is the checkout's design doc. Both tests first need the row under Decided to begin "One open PR
  per thread." without "thread of work". Alone, under a tag signed by the stand-in naming `docs/technical-design.md`,
  the guard must pass; with `note.txt` in the same commit and the same tag, a `FAIL guard:` line must name
  `docs/technical-design.md:<the row's line>`.

## Left to a person

- AC5's real approval: the tag on the implementing commit is signed by your security key, which no test can do. That
  the real commit touches only `docs/technical-design.md` and passes the guard under your tag is shown by the guard
  lane on the change itself (Proof: "the guard's output on the row's commit").
- AC6 entirely (above).

## At the base, and that each test can pass

`BASE-FAILURE.txt` is one run of the suite at `c13122f6a`, home paths written as `~`: every test fails, each for its
criterion's reason (the check passes every plant and the merge base's docs; the Check list still holds the validity
gate; no `<a id="ask-task">`; the Decided row still reads "thread of work").

Before that run, every test passed once on a throwaway twin (scratch folder, not kept): the base's tree with the
docs edited as Scope drafts them (a `<a id="ask-task">` above `#### Task`, the five phrases and the three
definition-of-done lines restated, the validity gate off the kinds list, the Decided row as asked) and a prose-only
phrase check added to `scripts/glossary-lint.mjs`. Two things that twin met that the real change must meet too: the
Lifecycles list at line 987 must still name `ask_task` for `scripts/design-drift.mjs`, and a fourth sentence giving an
ask a definition of done sits near line 2836 ("each ask's definition of done").
