# Acceptance tests for #3412: GLOSSARY.md, a lint lane check on its form, and AGENTS.md's line to it

Written first, blind, from issue #3412 (its report, Scope, four acceptance criteria, Proof and the drafted GLOSSARY.md),
the design sections it links and base commit `b134dd38f`, by a job that never saw an implementation. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).
Node's test runner and built-ins only.

| AC | ID | Tests |
|---|---|---|
| AC1 | `#3412.5946d19d` | `ac1-form.test.mjs` (the real file passes; three sentences, one plant run shared by both), `ac1-plants.test.mjs` (the term twice; no sentence) |
| AC2 | `#3412.032a43e1` | `ac2-seen-words.test.mjs` (three: the real file's Avoid words, a planted "result", a planted "queued") |
| AC3 | `#3412.f32b0eaa` | `ac3-links.test.mjs` (three: the real file's links, a planted link into each design doc) |
| AC4 | `#3412.4a7a02a4` | `ac4-agents.test.mjs` (two: the real AGENTS.md, a planted one without the line) |

IDs are the first 8 hex of the SHA-256 of each criterion's text after `- [ ] `, trimmed, whitespace collapsed (as
`scripts/proof-change.mjs`'s `criterionId`). Each test's name starts with its ID and its AC number.

Run, from the repo's root, under Node 24:

```
node --test --test-concurrency=1 'tests/acceptance/3412/*.test.mjs'
```

Every lane test copies the checkout's working tree and runs the lint lane's node commands (six at a time) once, or
twice in AC1's first test and AC4's plant, so no file runs the lane more than twice. One lane run took 1.5 to 10
minutes under load 20 to 61 here (a whole base run took 55 minutes); `BASE-FAILURE.txt` has the times at the base.

## What was read

`AGENTS.md`; the issue; `docs/technical-design.md` (The contract, States people see, Dogfooding);
`docs/canvas-primitives.md` (One word per idea); `contracts/plain-words.json`; `scripts/lanes.mjs` (the `lint` entry
of `checks`); `scripts/doc-links.mjs` (how design-doc anchors are read); `scripts/proof-change.mjs` (`criterionId`);
and suite `tests/acceptance/3533/` for the house shape.

## The surfaces (my choice where the issue leaves it open)

- **The lint lane.** The `lint` entry of the copy's own `scripts/lanes.mjs` `checks`, read at run time, so no check
  script's name is assumed. Only its node commands run (each one, whatever the others did, six at a time, each stopped after 300 s); its cargo commands (fmt,
  clippy) are left out: they can't read Markdown and take many minutes per run.
- **A scratch copy.** The checkout's working tree (tracked files and untracked ones git doesn't ignore, never `.git`)
  in a temp folder, with a fresh `git init`, the checkout's origin URL, everything committed as the base and
  `origin/main` pointed at it; a plant is one more commit. Git runs with no `GIT_*` variable, global or system config;
  HOME, TMPDIR and the XDG folders are the sandbox's, and GitHub tokens are dropped. The checkout is never written.
- **Judging around unrelated failures.** Some lint commands may fail in a copy (no `node_modules`, no built files) on
  the base and the branch alike. So no test reads the lane's overall exit:
  - A plant passes only when a command that exits non-zero prints a line naming what the criterion says it names. Every
    plant uses an invented term, `Zorvanthic ledger`, and an invented anchor, `zorvanthic-heading-3412`, that nothing
    else holds, so no unrelated failure can name them. AC4's file, `AGENTS.md`, is not invented, so that test runs the
    lane twice, with and without the line, and counts only a line naming `AGENTS.md` that the run without it alone prints.
  - "The lint lane's check passes on it": no command prints a line starting with `FAIL`, `INVALID`, `BLOCKED` or
    `INCONCLUSIVE` that names `GLOSSARY.md`, and some command reads it, decided as the command(s) that fail naming the
    term once a three-sentence entry is planted in the same tree; each of those must exit 0 on the file as it is.
- **Plants.** Each starts from the checkout's `GLOSSARY.md`, or, where it has none, the issue's draft
  (`draft-glossary.txt`, copied verbatim; `.txt` so no Markdown reader takes it for a doc), with the planted entries
  inserted before its second group heading, in the middle of the file. Entries use the draft's form (`**Term**:`, its
  sentences, then `_Avoid_:`). Three sentences; the term twice, each with one sentence; the term with only an Avoid line
  (`tallybook`), no sentence.
- **"The list that holds the word".** Worked out at run time from the copy: the plain words are the values of
  `contracts/plain-words.json` (named as `plain-words.json`), the words of States people see the first column of its
  table (named as `States people see` or `states-people-see`). "result" is a plain word; a second plant, "queued", is a
  word only States people see holds, for the criterion's "reads the words of States people see".
- **The real file, without the lane.** AC2's Avoid words (each `_Avoid_:` line split at `,` and `;`, parentheses
  dropped) hold no plain word or state word; AC3's links each land on a file of the checkout and, into a doc, on an
  anchor `scripts/doc-links.mjs` reads; AC4's `AGENTS.md` has exactly one line holding `GLOSSARY.md`.
- **The planted link.** One per design doc, `docs/technical-design.md#zorvanthic-heading-3412` and
  `docs/canvas-primitives.md#zorvanthic-heading-3412`; the failing line must hold the anchor.
- **The planted AGENTS.md.** The checkout's, with every line holding `GLOSSARY.md` removed.

At the base every test fails for the expected reason: no `GLOSSARY.md`, no command fails naming a plant, and no line
in `AGENTS.md` (`BASE-FAILURE.txt`).
