# #3403 — a new table of decisions under Decisions needs its approval

Blind acceptance job, against base `8feb93630b60d18c55d551e8b07554d51049e497`. It saw the issue, the design and the
base commit only: no implementing work, other branch, worktree, pull request, session note or network. Everything it
wrote is in this folder; nothing is committed and no shipped file is changed. No line is needed anywhere else, and
the suite has no `lane.json`: it need not run alone. A dispute goes to this job's blind redraft (AGENTS.md, Proof).

## Read

- The saved issue #3403 in full: its opening paragraphs, Scope, the six criteria, Proof, Depends on. And #569, #3166
  and #3114, for the words #3403 cites.
- `AGENTS.md`, `CONTRIBUTING.md`; `docs/technical-design.md`: Criteria to tests, both ways; Criteria in a checked
  shape; Wrong programs; The edit guard, from the first commit; Dogfooding; Built to be hard to get wrong; the
  opening paragraph and tables of Decisions.
- Base `scripts/proof.mjs`, `proof-guard.mjs` (`guard`, `decisionEdits`, `conflictEdits`), `proof-change.mjs`
  (`readChange`, the hunks, how a merge commit is read, `criterionId`), `proof-approvals.mjs` (`readApprovals`), and
  in `proof-runs.mjs` how the before lane reads `twins.json` and `lines.json` and judges "failed at its assertion".
- `tests/acceptance/569/` (helpers, the Decisions tests, README), `tests/acceptance/3166/` (fixtures, the
  security-key stand-in, the tests, README) and `tests/acceptance/1326/`'s README, for conventions.

## Setup

Each test builds a scratch git repository and runs this checkout's `node scripts/proof.mjs guard` with that
repository as its working folder. The guard is found from the suite's own place (`../../../`), so the suite runs the
guard of whatever checkout holds it. Nothing of the guard is imported. `helpers.mjs` holds the fixtures; the clean
environment, the fixture git and the security-key stand-in are #3166's (`../3166/fixtures.mjs`,
`../3166/authenticator.mjs`), imported as they landed and not edited.

- Main, which `origin/main` points at, holds `.deepbuild/approvers` with one person's security key (made as the test
  runs), a marker `scripts/proof-guard.mjs` (the proof lanes are on main) and `docs/technical-design.md`.
- The document is shaped as the real one: sections ahead of Decisions, then `## Decisions` as the last section, with
  its opening paragraph, two anchors and three tables (`### Yours`, `### Decided`, `### Decided for a hosted hub`).
  Its last line is a row. `## Decisions` is line 162. No line holds a digit.
- The change is on `session/3403`. No commit message names an issue, so none is fetched.
- Every process a test starts gets a temporary HOME and an allowlisted environment: no SSH agent, key, git config or
  `DEEP_*` variable of the person running it. Scratch folders are `d3403-*` under the system temp folder, removed
  after each test. A fixture that can't be built asserts `BLOCKED`.

The planted commits, with what `git diff -U0` gives each as (git 2.56.0), which each test also prints:

| Plant | Lines added or changed | Hunk |
|---|---|---|
| New table, #3365's shape | `### Decided for what a project learns`, a blank line, header, delimiter, two rows, a blank line, between the Decided table's closing blank line and `### Decided for a hosted hub` | `@@ -183,0 +184,7 @@`; line 183 is blank |
| Table under a heading | header, delimiter, two rows on the lines right after `### Decided for a hosted hub` | `@@ -184,0 +185,4 @@` |
| Row at a table's end | one row after the last row of `### Decided`'s table | `@@ -182,0 +183 @@` |
| Row's text changed | the Reopens if cell of "Work-in-progress commits" | `@@ -181 +181 @@` |
| `####` heading | a blank line, `#### Before the first hosted hub`, a blank line, a paragraph, under `### Decided for a hosted hub` | `@@ -185,0 +186,4 @@` |
| `#####` heading | a blank line and `##### Hosted hubs by region`, in the same place | `@@ -185,0 +186,2 @@` |
| Blank line | one, after the blank line under the `decisions-made` anchor | `@@ -175,0 +176 @@` |
| Table ahead of Decisions | the new table's seven lines, right above `## Decisions` | `@@ -161,0 +162,7 @@` |
| Table after Decisions | the same lines under `## Glossary`, a section the document gets after Decisions for this test | `@@ -192,0 +193,7 @@` |

## Criteria → tests → wrong programs

IDs recomputed from the saved issue body with `criterionId`'s rule. Each test's name starts with its criterion's ID.

| Criterion | Test (file) | What it holds | Wrong program it fails on |
|---|---|---|---|
| 1 `#3403.69cb5bd7` | the new table, no approval (`refused.test.mjs`) | exit not 0, a `FAIL guard:` line naming `docs/technical-design.md`, and line 186 or 188 named | **The merge base**, the criterion's "guard that judges added lines by the line they follow": exit 0 |
| 1 `#3403.69cb5bd7` | a table right after an existing `###` heading (`refused.test.mjs`) | Scope, "whatever line it follows": exit not 0, a FAIL line naming the file | **The merge base**: exit 0 |
| 2 `#3403.15e88fe0` | the new table under a signed tag (`approved.test.mjs`) | exit 0, a `PASS guard:` line, no line of another state | Passes on the base. *A guard that refuses a row or a heading added under Decisions even as its own approved proposal, as it refuses a raised tolerance.* Fails at "the guard must pass" |
| 2 `#3403.15e88fe0` | the same tag unsigned (`approved.test.mjs`) | exit not 0, a FAIL line naming the file | **The merge base**: exit 0 |
| 2 `#3403.15e88fe0` | the approved commit also adds `note.txt` (`approved.test.mjs`) | Scope, "only as its own approved proposal": exit not 0, a FAIL line naming the file | **The merge base**: exit 0 |
| 3 `#3403.0dd07b16` | one row at the end of a table (`refused.test.mjs`) | exit not 0, a FAIL line naming the file, and line 182 or 183 named | Passes on the base. *A guard that guards an added row only where the line it follows is no row, so a row added on the line after a table's last row passes.* Fails at "the guard must fail" |
| 3 `#3403.0dd07b16` | a row's text changed (`refused.test.mjs`) | exit not 0, a FAIL line naming the file, and line 181 named | Passes on the base. *A guard that judges only the lines a commit adds where it removes none, so a row whose text changes passes.* Fails at "the guard must fail" |
| 4 `#3403.62dbb38a` | a `####` heading with a paragraph, no row (`refused.test.mjs`) | exit not 0, a FAIL line naming the file, and line 186, the heading's, named | **The merge base**, the criterion's "guard that reads only rows": exit 0 |
| 4 `#3403.62dbb38a` | a `#####` heading alone (`refused.test.mjs`) | Scope, "a heading of any level": exit not 0, a FAIL line naming the file | **The merge base**: exit 0 |
| 5 `#3403.88a04a1b` | a blank line inside Decisions (`passes.test.mjs`) | exit 0, a PASS line, no line of another state | Passes on the base. The criterion's own: *a guard that refuses every edit to the file.* Fails at "the guard must pass" |
| 5 `#3403.88a04a1b` | the new table's lines right above `## Decisions` (`passes.test.mjs`) | the same | Passes on the base. The criterion's own, as above |
| 5 `#3403.88a04a1b` | the new table's lines in the section after Decisions (`passes.test.mjs`) | the same | Passes on the base. The criterion's own, as above |
| 6 `#3403.8fe962c0` | the change merges main, which landed the new table, a row at a table's end and a row's changed text (`passes.test.mjs`) | exit 0, a PASS line, no line of another state | Passes on the base. *A guard that reads a merge commit against its first parent, the change's side, so the rows the merge takes from main count as the change's own.* Fails at "the guard must pass" |

On the base: 13 tests, 6 fail and 7 pass, none crashes. `BASE-FAILURE.txt` holds that run. The six that fail are
every test of criteria 1 and 4 and criterion 2's unsigned and one-more-file tests, each at `refuses`' first
assertion, "the guard must fail": the base passes each commit. The seven that pass are the ones the issue says hold
on the merge base: criterion 2's first sentence (the base passes that commit with or without a tag), criterion 3
("as on the merge base"), criterion 5 (what "passes today") and criterion 6 ("as on the merge base").

### Twins the implementer plants

Each test that passes on the base needs a twin: the finished work with one fault, as
`tests/acceptance/3403/twins/<name>/lines.json`, with `twins.json` mapping the criterion's ID to its twins. The
sentences in italics above are those faults. Criterion 3 needs two twins, one for each of its faults, since each of
its tests fails on one of them. Criterion 5's own wrong program fails all three of its tests. Two sharper ones are
there if wanted: a guard that refuses every line added inside Decisions, a blank one too (fails the blank-line
test), and a guard that refuses a table row added anywhere in the file (fails both tests of a table outside the
section).

A throwaway guess at the change, kept outside the repository and deleted before this job ended, passed all 13. Each
fault in italics, planted in it alone, failed its own test and no other. Criterion 5's own, which named each
refusal by the line the hunk follows, failed criterion 5's three tests, criterion 6's (the change's own commit
edits the file) and the two tests that ask for an added line's number. Its two sharper ones failed only the tests
named above. Three more faults were tried on it. One that names only the hunk's first added row or heading (here
the heading's line, 184) fails criterion 1's first test. One that still judges by the line followed, with blank
lines guarded too, fails both tests of criterion 1, criterion 4's first and criterion 5's blank line. One that reads
headings of levels 3 and 4 only fails criterion 4's second test.

## Surfaces assumed where the issue is silent

1. **The surface.** `node scripts/proof.mjs guard`, read through its exit status and its stdout. Nothing else.
2. **"Fails" and "passes".** Fails: an exit status other than 0 and at least one `FAIL guard:` line that names
   `docs/technical-design.md`, so a crash is no refusal. Passes: exit 0, at least one `PASS guard:` line, and no line
   starting FAIL, BLOCKED, INVALID or INCONCLUSIVE. No wording is asserted beyond those prefixes and the path: not
   "a row under Decisions added", not "by approved proposal", not the number of commits checked.
3. **"Naming a line".** The line's number stands somewhere in the guard's stdout as a whole number: not inside a
   longer number, a word or a commit ID, and not after a decimal point. `docs/technical-design.md:186:` does it, and
   so do "line 186" and "lines 186-189". It need not sit on the line that names the file. How many lines the guard
   prints for one commit is left open.
4. **Which copy a number counts in.** An added row or heading has a line only in the commit's own copy of the file,
   which with one commit is also HEAD's and the worktree's: that number is asked for in criteria 1 and 4. The line
   the added block follows, which is what the base's "line in the file before the commit" would give, is not the
   row's line or the heading's.
5. **"The first added row" (criterion 1).** Either reading passes: the first added line that is a row as the guard
   reads rows today (a line starting with `|`), which is the table's header, line 186; or the first of the "two
   rows" the criterion counts, line 188. The heading's line alone (184) or the delimiter's alone (187) does not.
6. **"Its line" (criterion 3).** For the row added at a table's end: the line of the row it is added to, 182, which
   is what the merge base names and is the same in both copies, or the added row's own line, 183. For the changed
   row: 181, the same in both copies, since the commit changes nothing above it.
7. **Criterion 1's plant** is #3365's: the block sits between a table's closing blank line and the next `###`
   heading, and git reads it as following that blank line, as the issue quotes. A git that read it as following
   the table's last row would make the base refuse it; the finished guard's answer does not depend on that.
8. **"Whatever line it follows" and "a heading of any level" (Scope).** One more plant each, under criteria 1's and
   4's tags: a table on the lines right after an existing `###` heading's own line, which is neither blank nor a
   row; and a `#####` heading with nothing under it. Each must fail naming the file; no line number is asked.
9. **Criterion 2.** The tag is an annotated tag `deep/approved/approval` on the commit holding the one line
   `Approves: docs/technical-design.md`, signed with presence by a security-key stand-in that the merge base's
   approvers list names, and checked by the real `ssh-keygen`. "The same tag unsigned" is that tag object with no
   signature. The third test reads Scope's "only as its own approved proposal, as a changed row does": the same
   edit and the same signed tag, in a commit that also adds `note.txt`, must fail.
10. **Criterion 4's plant** goes under an existing `###` heading and its blank line, ahead of its table. Whichever
    way git reads the hunk, it follows a line that is no row.
11. **Criterion 5.** The blank line doubles the one under the `decisions-made` anchor. Whichever way git reads the
    hunk, it follows a line that is no row, heading or paragraph. A blank line among rows or after the file's last
    row is refused on the base, so it is not what "passes today". "A table under a heading outside it" is criterion
    1's heading and table, moved: once right above `## Decisions`, as the real file has nothing after the section,
    and once under a `## ` heading that follows Decisions.
12. **Criterion 6.** The change has a commit of its own that rewords a line of the same file outside Decisions.
    Main then lands one commit with the new table, a row at a table's end and a row's changed text, `origin/main`
    moves to it, and the change merges it with `--no-ff`. The merge is clean.

## Not covered

- Scope's third line, the AGENTS.md invariants read as today: no criterion names it, and #569's
  `decisions.test.mjs` holds it.
- Scope's fourth and fifth lines, the signed tag on the implementing change naming `scripts/proof-guard.mjs` and
  #3365's tag: facts about real changes, not about the guard in a scratch repository.
- The section's opening paragraph: not in this task, so no test rewords it and none says how the guard reads it.
- Not named by a criterion, so not planted: a paragraph alone inside Decisions; a heading of level 1, 2 or 6, or one
  underlined; an existing heading reworded; a row added at the file's last line; a blank line among rows; an
  uncommitted edit; a merge whose conflict under Decisions is resolved; an approval naming
  `docs/technical-design.md:<line>`; a tag signed by a key the list doesn't hold.

## Run

Needs Node 24, git with `merge-tree --write-tree`, OpenSSH's `ssh-keygen`, and the repo's installed dependencies
(`scripts/proof-change.mjs` imports `typescript`). No build.

```sh
node --test tests/acceptance/3403/*.test.mjs
```

About 3 s on the machine it was drafted on: 13 guard runs, one per test, in three files. Each test has a limit of
120 s, and each process it starts 60 s.

## Limits

- The security key is a software stand-in at the authenticator boundary; a person's real tag is the Proof's hand run.
- The base run shows which tests refuse the merge base. The twins are the implementer's to plant, and until they
  are, the seven tests that pass on the base have failed only on this job's throwaway guess.
- The hunks above are git 2.56.0's. Where a hunk could be read two ways the plants are placed so both readings
  follow a line the base doesn't guard, except criterion 1's, which is the issue's own case.
