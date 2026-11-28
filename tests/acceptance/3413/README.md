# Acceptance tests for #3413: the docs say extension, not plug-in

Written first, blind, from issue #3413 (its report, Scope, five acceptance criteria and Proof), the design sections it
links and base commit `c13122f6a`, by a job that never saw an implementation. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Node's test runner and
built-ins only; the `.mjs` files hold no comments (the comment ratchet's ceiling for a new file is 0), so what they
would say is here.

| AC | ID | Tests |
|---|---|---|
| AC1 | `#3413.e9cc44fd` | `ac1-plants.test.mjs` (three: a plant in each of `docs/technical-design.md`, `docs/canvas-primitives.md`, `docs/extension-guide.md`), `ac1-merge-base.test.mjs` (the merge base's docs fail, with the count) |
| AC2 | `#3413.493e049c` | `ac2-guide.test.mjs` |
| AC3 | `#3413.e975ffde` | `ac3-links.test.mjs` (two: the lane passes with the open issues read; a planted rename with no `<a id>` fails it) |
| AC4 | `#3413.6523d84f` | `ac4-ceilings.test.mjs` (two: the check passes; no ceiling above the merge base's) |
| AC5 | `#3413.8f20cdc2` | none: each changed line beside the line it replaced is a person's diff review, recorded by them. No test can pass it; without that record it stays INCONCLUSIVE |

IDs are the first 8 hex of the SHA-256 of each criterion's text after `- [ ] `, trimmed, whitespace collapsed (as
`scripts/proof-change.mjs`'s `criterionId`). Each test's name starts with its ID and its AC number.

Run, from the repo's root, under Node 24:

```
node --test --test-concurrency=1 'tests/acceptance/3413/*.test.mjs'
```

## What was read

`AGENTS.md`; the issue; `docs/technical-design.md` (Dogfooding, Repo guards, One hub per user…, Extension API, Blocks
for plug-ins that do real work); `docs/canvas-primitives.md` (One word per idea); `scripts/lanes.mjs` (the `lint` and
`design links and names` entries); `scripts/glossary-lint.mjs`; `scripts/guide.mjs` (`--check`);
`scripts/doc-ceilings.mjs` and `scripts/doc-ceilings.json`; `scripts/design-links.mjs`, `scripts/open-issues.mjs`,
`scripts/doc-links.mjs`; `scripts/proof-change.mjs` (`criterionId`); and suite `tests/acceptance/3412/` for the house
shape.

## The surfaces (my choice where the issue leaves it open)

- **A scratch copy with the merge base under it.** The merge base is `git merge-base HEAD origin/main` in the checkout.
  The checkout's working tree (tracked files and untracked ones git doesn't ignore, never `.git`) is copied to a temp
  folder; each file that differs from the merge base is first put back as the merge base has it and committed, that
  commit is the copy's `origin/main`, and the working tree's files are committed on top. So the doc ceilings check's
  own merge base in the copy is the real one. A plant is one more commit. Git runs with no `GIT_*` variable, global or
  system config; HOME, TMPDIR and the XDG folders are the sandbox's, GitHub tokens are dropped. The checkout is never
  written.
- **The text check (AC1).** The issue's "the lint lane's text check, which #3412 adds" is `scripts/glossary-lint.mjs`.
  The test reads the copy's `scripts/lanes.mjs` `lint` entry, fails if it no longer runs that script, and runs that one
  command with the lane's own arguments. Only it runs, not the whole lane: the other lint commands can't be what the
  issue names, and in a copy (no `node_modules`, no build) several fail for unrelated reasons; one lane run took 1.5 to
  10 minutes per #3412's suite.
- **AC1's plants.** In each doc, before its second `##` heading (outside fenced code), a block holding the invented
  marker `Zorvanthic marker 3413`: a prose line holding "a plug-in may"; a line with "a plug-in may" and
  `ext.<plugin>.<name>` only inside code spans; and a fenced `text` block holding both. The check must exit non-zero
  with an output line naming the doc and the prose line's number (the number after the file name, as a whole number);
  no output line may name the doc and either code line. The guide is planted directly, though it is generated: only the
  text check runs on that copy.
- **"On the merge base it fails, and that run is shown with its count".** The copy's three docs are replaced by the
  merge base's and the change's text check runs on them. It must exit non-zero and, for each doc, name at least one
  line that says plug-in (`plug-in` or `plug-ins`, any case) at the merge base outside code spans and link targets.
  The count is the number of output lines naming such a line, printed per doc as a test diagnostic.
- **The guide (AC2).** `node scripts/guide.mjs --check` in the copy: exit 0 and no `FAIL`/`INVALID`/`BLOCKED`/
  `INCONCLUSIVE` line.
- **The design links lane (AC3).** The copy's `scripts/design-links.mjs`, the lane's one command. The open issues are
  read once per test file with `gh issue list --repo windoliver/deepbuild --state open --limit 5000 --json number,body`
  (read-only, the checkout's own gh sign-in) and handed to the lane through `DEEP_OPEN_ISSUES`, as `checks.mjs` does.
  If gh can't list them the test fails as BLOCKED, never passes; a lane line saying `INCONCLUSIVE` fails it too.
- **"A heading this renames"** is a heading of the three docs at the merge base whose text says plug-in; its old
  anchor is its GitHub slug there. The planted rename takes, for each doc, the first such heading an open issue links
  (by `<doc>#<anchor>` or `<name>.md#<anchor>` outside code spans), removes every `<a id>`/`<a name>` with that anchor
  from the copy's doc, and renames the heading whose slug is still that anchor, if any, to `Zorvanthic heading 3413 n`.
  The lane must exit non-zero and print a line naming one of the open issues that link the old anchor (`#<number>`)
  together with `#<anchor>`.
- **The doc ceilings (AC4).** `node scripts/doc-ceilings.mjs` in the copy: exit 0, a `PASS doc-ceilings` line, and no
  line saying it had no merge base. "No ceiling is above the merge base's" compares the checkout's
  `scripts/doc-ceilings.json` with the merge base's: a key both hold may not rise; a key only the change holds is
  compared with the merge base's ceiling of the old key whose anchor the change's doc keeps as an `<a id>` on that
  heading (the largest, if several), read with the checkout's `scripts/doc-links.mjs` `anchors`; with no such old key,
  its merge base ceiling is the check's limit, 16,384 bytes.

## At the base

`BASE-FAILURE.txt` holds the base run (24 minutes under load 62; the longest file, `ac1-plants.test.mjs`, 11 minutes;
most of each test is copying the tree). 4 pass, 5 fail:

- The four AC1 tests fail for the expected reason: `scripts/glossary-lint.mjs` exits 0 (`PASS glossary`) on every plant
  and on the merge base's docs. The count at the merge base: 0 lines named, of 106 prose lines saying plug-in in
  `docs/technical-design.md`, 145 in `docs/canvas-primitives.md` and 14 in `docs/extension-guide.md`.
- AC2 passes at the base, plainly: the guide is as `scripts/guide.mjs` writes it.
- AC3's first test fails at the base for a reason that isn't plug-in: four open issues (#3496 to #3499) link
  `docs/technical-design.md#what-a-person-reads-on-a-plain-surface`, which no heading or `<a id>` of main holds, so
  the lane prints `FAIL 4 links …` and exits 1. The criterion asks that the lane pass with the open issues read, so the
  test stands as written; the change, or those issues, must make the links land, or it is reported BLOCKED. It is
  not a dispute this job can settle by weakening the test.
- AC3's planted rename passes at the base: the lane already fails an issue link with no heading (#910), naming
  an open issue that links each planted anchor (`docs/technical-design.md#blocks-for-plug-ins-that-do-real-work`, 45
  issues; `docs/canvas-primitives.md#check-input-plug-in-reads`, 3; the guide's one such heading no open issue links). It guards that the change keeps that.
- Both AC4 tests pass at the base, plainly: merge base = HEAD, so every ceiling equals the merge base's.
