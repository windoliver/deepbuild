# Acceptance tests for #3401: the generated field lists sit under headings of their own

Written first, blind, from issue #3401 (its report, Scope, six acceptance criteria and Proof, as the brief gave its
body; it has no comments), the design and the base commit `35956a44a7c4b20023055f50229821330e09b69f` ("Merge pull
request #3492 …"), by a job that never saw an implementation; none existed. No other branch, worktree or pull request
was read, nor GitHub. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding). Node's test runner and built-ins only.

| AC | ID | File (tests) |
|---|---|---|
| AC1 | `#3401.a5f27d7f` | `ac1-ceilings.test.mjs` (2: the PASS line and the merge base failing; the ceiling at the section's own text) |
| AC2 | `#3401.e49d42a4` | `ac2-planted-list.test.mjs` (1) |
| AC3 | `#3401.b6c9c9bc` | `ac3-rows.test.mjs` (2: the rows equal the merge base's; a dropped and a reworded row fail) |
| AC4 | `#3401.56148288` | `ac4-drift.test.mjs` (1) |
| AC5 | `#3401.51a09d90` | `ac5-heading-sizes.test.mjs` (1) |
| AC6 | `#3401.4caee707` | `ac6-suite-2338.test.mjs` (1) |

IDs are the repo's rule (`criterionId` in `scripts/proof-change.mjs`): `#3401.` and the first 8 hex digits of the
SHA-256 of each criterion's text after `- [ ] `, trimmed, white space collapsed, computed over the body the brief
gave; the live issue wasn't read. Each test's name starts with its ID and its AC number.

## What was read

- The issue body, `AGENTS.md`, and in `docs/technical-design.md` (by headings and small ranges): How we know
  version 0 works (Criteria to tests, both ways; Closed issues stay proven; Criteria in a checked shape; Wrong
  programs) and Dogfooding.
- At the base: `scripts/canvas-closures.mjs` (`table`, `drift`, the block markers, `rowOf`), `scripts/doc-ceilings.mjs`,
  `scripts/doc-ceilings.json`, `scripts/doc-links.mjs`, `scripts/proof-runs.mjs` (`atAssertion`, `TIMEOUT`),
  `scripts/proof-change.mjs` (`criterionId`), the `lint` and `field lists` lanes' commands in `scripts/lanes.mjs`,
  `docs/canvas-primitives.md` (Registries and closed lists), `crates/deep-canvas/src/registry/fields.json`, and
  `tests/acceptance/2338/` for the house format.

## Run

```sh
node --test 'tests/acceptance/3401/*.test.mjs'
```

Eight tests, offline: no network, no build, no `node_modules`, no `--built`. They need Node 24, `git` and `tar`.
About five seconds. Every scratch copy is under the OS temp folder and removed after its test; nothing writes into the
checkout. Four runs have their working folder at the checkout itself and only read it: `scripts/doc-ceilings.mjs`
(AC1), `scripts/canvas-closures.mjs drift` (AC4), the suite `tests/acceptance/2338/` (AC6) and read-only git
(`merge-base`, `show`, `rev-list`, `diff --name-only`, `ls-files`, `archive`).

## The surface (my choice where the issue leaves it open)

### A generated heading

The issue fixes that the generated tables sit "inside the section, each under a heading of its own", and names no
marker. The tests read them structurally and ask for no marker, no heading wording and no level beyond "inside":

- **The section** is the heading whose anchor is `registries-and-closed-lists` (the design links lane's slug), to the
  next heading of its level or higher.
- **A generated row** is a table line of the section whose first cell is one code span, the list's name:
  `` | `<list>` | … `` (regex ``^\| `([^`]+)` \|``), the shape `table` writes at the base. The hand-written table has
  no such line at the base (its 64 rows start with prose), and must not gain one.
- **A generated heading** is a heading inside the section (deeper than the section's `###`, before the next heading
  of level 1 to 3) whose own text holds at least one generated row. A heading inside the section with no generated row
  is not a generated heading and is left alone.
- **Own text** is #2338's: the bytes from a heading's line to the next heading's line of any level, a line in fenced
  code never a heading; a heading's key is `docs/canvas-primitives.md#<slug>` with the `-1`, `-2` rule.

The base's `<!-- field lists: … -->` and `<!-- /field lists -->` lines may stay, go or repeat; the tests don't read
them. Whatever stays between the tables counts in the own text of the heading above it.

### The listing `table` reads

`table` takes a sealed listing, and the scratch copies have no built `deep-show`. So the tests run, with the copy's
root as working folder, the copy's own script:

```sh
node scripts/canvas-closures.mjs table --listing <file>
```

`<file>` is written by the test, outside the copy's repo: `{"registries": [], "field_lists": [{list, words, closure}]}`,
one entry for each list of the copy's fill (`crates/deep-canvas/src/registry/fields.json`), its `closure` the fill's
object without `list`, its `words` those of its generated row in the copy's reference. That is all of a listing the
base's `table` reads; the entries carry no `entry` or `field`.

### The planted field list (AC2)

`sky.planted3401@1.mode`, words `alpha`, `beta`, `closed: determinism`, a `reopens_if` padded so that its row, as the
base's `table` writes a closed list's row, is exactly 300 bytes without its newline, `instead: nothing`. It is
appended to the copy's fill (`{list, closed, reopens_if, instead}`) and added to the listing with its words. The name
lands in the drafted rule's existing group `sky`; any rule that reads only a list's name puts it under one heading.

### The scratch copies

A sandbox under the OS temp folder with `repo/`: the checkout's own root files (never `.git` or a `.env*`), `scripts/`
(without `node_modules`, `target` or `.git`), `docs/technical-design.md`, `docs/canvas-primitives.md`, the fill and
`packages/contracts/canvas-closures.json`. It is a git repository of its own: `docs` and `scripts/doc-ceilings.json`
are committed and `refs/remotes/origin/main` is that commit, so `doc-ceilings.mjs` reads the copy's own ceilings as the
merge base's. Scripts run there with the sandbox's `HOME` and `TMPDIR` and no git variable pointing elsewhere.

### The merge base

`git merge-base HEAD origin/main` in the checkout, and its files through `git show`. AC3 compares with exactly that
commit. Where a criterion says the merge base **fails** (AC1, AC6), the tests take the commit before the change: the
merge base while its reference still holds the generated rows in one table under the section's own heading, and, once
the change is in the merge base's own history (the suite run on main after the merge), the newest commit of that
history whose reference still holds them so (`git rev-list <merge base> -- docs/canvas-primitives.md`). On the change
the two are the same commit. A git failure is a thrown `BLOCKED`, never a pass.

## Criteria to tests, and the planted programs

No planted program lives in this folder and the implementation provides none. The lanes' rule keeps twins out of
`tests/`, so each wrong program the criteria name is made by its test at run time: three are planted **on the
output** (the reference a wrong `table` would have written, held to the real ceilings script or to the test's
comparison), because a wrong `table` can only be written against a script that didn't exist; one, the wrong `drift`,
is a stand-in program written into the sandbox, beside the copy.

| Criterion | The change must | The planted wrong program | It must fail, naming |
|---|---|---|---|
| AC1 `#3401.a5f27d7f`, first | on the checkout, `node scripts/doc-ceilings.mjs`: exit 0 and exactly one stdout line, starting `PASS doc-ceilings:` | the merge base: its two docs and its ceilings in a scratch repo, **under the checkout's `scripts/`**, so a rule that exempts generated text would pass them and fail here | a `FAIL` line with `docs/canvas-primitives.md#registries-and-closed-lists`, its size and its ceiling (54,992 and 54,106 at this base, read from the commit) |
| AC1, second | `scripts/doc-ceilings.json` holds the section at exactly its own text's size, under 20,000 (and over 16,384, or it could hold no entry) | the merge base | 54106 against 54992 |
| AC2 `#3401.e49d42a4` | in a scratch copy: ceilings pass; `table` writes the copy's lists under several generated headings; with the planted list in the fill and the listing, `table` exits 0, ceilings still pass with the one PASS line, exactly one generated heading's own text is one the copy didn't hold before (at most one it held is gone), that heading holds the 300-byte row, and the section's own text is unchanged | on the output: every generated heading's line after the first removed (one table under one generated heading); then every generated heading's line removed (one table under the section's heading, as the base writes it) | a `FAIL` line with that heading's key and its size; a `FAIL` line with the section's key, its size and its ceiling |
| AC3 `#3401.b6c9c9bc`, first | every generated row of the merge base's section is under a generated heading, once, byte for byte, and no other row is; compared sorted by list name | the merge base (no generated heading) | — |
| AC3, second | the same comparison, clean | on the output: the last row of the middle generated heading deleted; the first row of the first generated heading reworded (` (reworded)` added to its last cell) | one finding each, starting with the list's name |
| AC4 `#3401.56148288` | on the checkout, `node scripts/canvas-closures.mjs drift`: exit 0, a `PASS drift:` line, no `FAIL` line; the same in a scratch copy; with the last row of the first generated heading deleted, and then of the last, a non-zero exit and a `FAIL drift:` line naming the list | `planted-drift-first-table.mjs`, written into the sandbox: holds each row of the first generated heading to the fill and reads no other heading | it exits 0 on the deletion from the last heading, and the test's judgement fails it: no `FAIL drift:` line names the list |
| AC5 `#3401.51a09d90` | several generated headings, no generated row under the section's own heading, none over 8,192 bytes of own text; the largest and its size printed as a diagnostic | the merge base | — |
| AC6 `#3401.4caee707` | `node --test` on every `tests/acceptance/2338/*.test.mjs` exits 0; no file under `tests/acceptance/2338/` differs from the merge base's, and none is new | the commit before the change: its `scripts/`, two docs and `tests/acceptance/2338/` in a scratch repo, where `ac4-ceilings.test.mjs` is run | a non-zero exit, the failing test `#2338.1a6db6b6 AC4 on the commit under test …`, and the section's key in its output |

### On the base

All eight fail at a `node:assert` assertion under this folder, before any planted program runs (`BASE-FAILURE.txt`):
AC1's first and AC2 on the ceilings script's `FAIL` for the section; AC1's second on `54106 !== 54992`; AC3, AC4 and
AC5 on "0 generated headings"; AC6 on the 2338 suite's exit 1.

### How I checked the tests can pass and fail

In a scratch repository outside the checkout (the base's root files, `scripts/`, two docs, fill, closure data and both
suites committed as its origin/main), a twin of the change was left uncommitted: `table` writing 40 tables, each under
`#### Field lists: <name before its first . or @>`, `drift` reading the rows under all of them, the ceiling lowered to
19,027. All eight tests passed there (`BASE-FAILURE.txt`, second part). A twin `table` writing one table under one
heading failed AC2; a twin `drift` reading only the first table passed the lane on the clean copy and failed AC4; and
with the twin committed and origin/main moved to it, all eight still passed. No twin was left in the checkout.

## Readings where the issue leaves a choice

- **"A row of 300 bytes"** is the row's line without its newline.
- **"The text under exactly one generated heading differs"** compares the generated headings' own texts before and
  after as a multiset, so a rule that gives the planted list a heading of its own also counts as one. "Before" is the
  copy after `table` ran once on its own lists, so the test asks nothing about `table` reproducing the committed
  reference byte for byte.
- **"One table under one heading … naming the heading"**: both the first generated heading (new over the limit, no
  ceiling) and the section's own heading (over its ceiling) are tried.
- **"Read in name order"**: rows are sorted by list name in code-unit order, as the base sorts them, and compared one
  list at a time; the order of rows inside the reference is not judged.
- **"215 on main today"** is not hard-coded: the count is the merge base's (215 at this base), printed as a diagnostic.
- **"A planted `table` that drops or rewords a row fails"** is failing AC3's comparison. `drift` also fails such a
  reference against the fill, which AC4 holds for a deletion.
- **"`drift` passes on the change"** is the lint lane's form, `drift` with no listing, which holds the rows to the
  fill; the `field lists` lane's `drift --built` needs a cargo build and isn't run here.
- **"On the merge base the script fails"** runs the checkout's script on the merge base's docs and ceilings, which is
  also what holds "the ceilings' rule doesn't change, and generated text gets no exemption".
- **The issue's 54,962 bytes** is 54,992 at this base; sizes are read from the commits, never written in a test.
- **"Passes unchanged"** is the suite's files against the merge base's, by git.

## What the implementation must provide

1. In `docs/canvas-primitives.md`, every generated row (`` | `<list>` | … ``, each byte for byte the merge base's)
   under a heading inside `### Registries and closed lists`, deeper than `###`; several such headings; none holding
   more than 8,192 bytes of own text; no generated row left under the section's own heading; no line starting
   `` | ` `` in the hand-written part.
2. `scripts/doc-ceilings.json` holding `docs/canvas-primitives.md#registries-and-closed-lists` at exactly the
   section's own text, which is over 16,384 and under 20,000 bytes; `node scripts/doc-ceilings.mjs` printing only its
   `PASS doc-ceilings: …` line, exit 0; its rule unchanged, so the merge base's docs and ceilings still fail under it
   with a `FAIL` line naming the section's key, size and ceiling.
3. `node scripts/canvas-closures.mjs table --listing <file>`, run from the root of a tree holding only the root files,
   `scripts/`, the two docs, the fill and `packages/contracts/canvas-closures.json`: exit 0, writing the listing's
   `field_lists` (`{list, words, closure}` only) under the generated headings, grouped by a rule that reads only each
   list's name, each row as the base writes it. A list added to the listing changes one heading's own text and not the
   section's own text.
4. `node scripts/canvas-closures.mjs drift` (no listing: the fill), in the checkout and in such a tree: exit 0 with a
   `PASS drift:` line and no `FAIL` line; with a row deleted under any generated heading, a non-zero exit and a line
   starting `FAIL drift:` that holds the list's name.
5. `tests/acceptance/2338/` byte for byte the merge base's, and passing.

No planted program, twin or lane entry for this folder is needed from the implementation.

## Not tested, because no surface reaches it here

- **AC5's "the PR names the largest with its size"**: a PR's text is not a surface a test reads. The AC5 test prints
  the largest generated heading and its size as a diagnostic for the PR to quote.
- The `field lists` lane (`cargo build`, `fields`, `drift --built`) "passes as before": it needs the built
  `deep-show`; the Proof's lane line is the PR's to show.
- The grouping rule itself (the drafted "name before its first `.` or `@`", 40 groups): the issue drafts it and fixes
  only that it reads a list's name; the tests hold that through the planted list changing one heading.
- Once a later change adds a field list, AC3 compares that change with its own merge base, so the rows it adds read
  as rows the merge base doesn't hold: the criterion is this change's, and the lanes run this suite for it.

## Files

- `helpers.mjs`: headings, own text and the generated headings; the scratch copies and runs; the merge base through
  git; the listing and the planted list; the output plants; each criterion's judgement; the planted first-table drift.
- `ac1-ceilings.test.mjs`, `ac2-planted-list.test.mjs`, `ac3-rows.test.mjs`, `ac4-drift.test.mjs`,
  `ac5-heading-sizes.test.mjs`, `ac6-suite-2338.test.mjs`: one file per criterion, eight tests.
- `BASE-FAILURE.txt`: the run on the base, and the self-check on the twin.
