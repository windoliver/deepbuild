# Acceptance tests for #3291: whole-file twins fail in the lint lane

I drafted these tests blind from these sources:

- issue #3291, as saved verbatim for this job
- `docs/technical-design.md`: "How we know version 0 works" (its Wrong programs entry, Dogfooding), and AGENTS.md
- the base commit `254bdc87c` (origin/main), which has no implementation of this issue

At the base I also read `scripts/twins-lint.mjs`, `scripts/size-ratchet.mjs` (how a ceiling is compared with the merge
base's on origin/main), `scripts/lanes.mjs` (the `checks` export and its `lint` check), `scripts/lanes-lists.mjs` (what
a suite's `lane.json` may say), `scripts/proof-runs.mjs` (`atAssertion`), and `tests/acceptance/1832/` (README "The line
form" and "The lint", `lint.test.mjs`, `helpers.mjs`). This suite imports `tests/acceptance/1832/helpers.mjs` for its
sandbox, git and process helpers; it imports nothing from the code under test. Per AGENTS.md, the implementing agent
doesn't edit these tests. A dispute goes to a blind redraft by this job.

Run them with Node 24, with `node_modules` installed (`scripts/twins-lint.mjs` reaches `typescript` through
`scripts/proof-change.mjs`):

```sh
npm ci                                   # once, if node_modules is missing
node --test tests/acceptance/3291/*.test.mjs
```

At a one-minute load of about 57 on this Mac the whole suite takes about 6 s on a working implementation. No test
builds the workspace, starts a hub or runs cargo, so the suite runs in the parallel block and has no `lane.json` (a
lane file can only say a folder runs alone).

## Scope

Only the issue's first three acceptance criteria. Criteria 4 (`#3291.8cfb65bf`, every converted twin applies on main
and fails its test at its assertion in the before lane) and 5 (`#3291.49a9dcef`, `node scripts/twins-lint.mjs` prints
`PASS twins` on main and the list is empty) belong to the later conversions, one blind redraft per suite; this suite
writes no test for them.

## Surfaces

The issue names the lint lane, a list of today's whole-file twins that "may only shrink, as `scripts/size-ratchet.mjs`
treats its ceilings", and the design's section on planted wrong programs. The whole lint lane also runs cargo fmt,
clippy and some thirty other lints, which can't run on a scratch tree, so these tests reach it as follows. The
implementation builds to this.

1. **The lint lane's twins commands.** The tests read `checks` from `scripts/lanes.mjs` in a child process
   (`node --input-type=module -e` importing it from this checkout) and take, from the check named `lint`, every command
   whose argv holds the string `scripts/twins-lint.mjs` (relative, as the lane's other commands name their scripts).
   There must be at least one; any arguments after it are the implementation's choice. Each is run exactly as given
   (its first element, the lane's `process.execPath`, replaced by the test's node) with its cwd at the checkout under
   test, as the lane runs its commands at the root. The lint lane fails when any of them exits non-zero.
2. **The list of today's whole-file twins: `scripts/whole-file-twins.json`.** A JSON array of strings, each the repo
   path of one twin folder, `tests/acceptance/<suite>/twins/<twin>`, exactly as a `FAIL twins: <folder>: ...` line names
   it. The tests write their own list into each scratch checkout at that path, on `main` (the merge base) and on the
   change. The rules the tests read:
   - A whole-file twin (as `scripts/twins-lint.mjs` already defines it: a twin a `twins.json` names whose folder holds
     any file besides its top-level `lines.json`) passes only when its folder is on the list in the work tree **and**
     on the list at the merge base of `HEAD` and `origin/main`, read from git as `scripts/size-ratchet.mjs` reads
     `scripts/size-ceilings.json` there. So a change can take entries off, never add one.
   - An entry on the list whose folder holds no whole file (converted to `lines.json`) fails, naming the entry.
3. **What the tests read from those commands.** On a finding: exit status `1` from a twins command, and a line starting
   `FAIL twins: ` that holds the twin's folder path, and, for a new whole-file twin, also the path of the file it holds
   relative to its folder (the base form already is `FAIL twins: <folder>: holds a whole file, <path>`). A stale entry's
   line is any `FAIL twins: ` line holding the entry's folder path. No line may start `PASS twins` then. With nothing
   to find: every twins command exits `0`, a line starts `PASS twins` (words may follow it), and no line starts
   `FAIL `, `BLOCKED `, `INVALID ` or `INCONCLUSIVE `. A twin the merge base lists and that is still whole is never
   named in a `FAIL twins: ` line.
4. **The design.** In `docs/technical-design.md`, the section headed exactly `## How we know version 0 works`, its entry
   starting `- **Wrong programs` (up to the next line starting `- **` or `#`). That entry must name `lines.json`, speak of
   a twin, and hold an example: a fenced code block or inline code span whose text parses as JSON of the line form
   (`tests/acceptance/1832/README.md`, The line form): an object from a repo path to one or more edits, each with
   exactly the keys `find` (one or more lines) and `wrong` (zero or more lines), single-line strings, `wrong` differing
   from `find`.

## The scratch checkouts

Each scratch test makes a git repository in a temporary folder: on `main`, a copy of every file git tracks under this
checkout's `scripts/`, a `.gitignore` of `node_modules`, `src/a.mjs`, the planted suites and the list; `origin/main`
points at that commit; branch `change` commits the change on top. A symlink `node_modules` to this checkout's (ignored by
git) lets the copied scripts load. Planted suites 9100 and 9201 each hold a `twins.json` naming their twins under a
criterion tag computed at run time, a test file, and the twin folders: a whole-file twin holds `src/a.mjs`; a line twin
holds only `lines.json`.

- **New twin** (`new-twin.test.mjs`). `main` has suite 9100 with whole-file twin `old-x`, listed.
  - The change adds suite 9201 with whole-file twin `whole-a`, not listed: FAIL naming
    `tests/acceptance/9201/twins/whole-a` and `src/a.mjs`, exit 1; `old-x` not named.
  - The change adds 9201 with `whole-a` as `lines.json`: PASS, exit 0 (the listed `old-x` is tolerated).
  - The change adds 9201 with `whole-a` whole and also adds its folder to the list: still FAIL naming the folder and
    `src/a.mjs` (the list may only shrink against the merge base).
  - On this checkout itself (cwd at its root, its own list and `origin/main`): PASS, every twins command exits 0.
- **The list** (`list.test.mjs`). `main` has suite 9100 with whole-file twins `old-x` and `old-y`, both listed.
  - The change takes `old-x` off the list, its file left: FAIL naming `old-x`; `old-y` not named.
  - The change converts `old-x` (its `src/a.mjs` removed, `lines.json` added) and leaves the list: FAIL naming the stale
    entry `old-x`; `old-y` not named.
  - The change converts `old-x` and takes it off the list: PASS (control: a lane that fails on any list edit fails it).

## Criteria and their tests

IDs as `scripts/proof-change.mjs` computes them: the text after `- [ ] `, trimmed, white space collapsed, SHA-256,
first 8 hex digits.

| ID | Criterion (short) | Tests | Wrong program |
|---|---|---|---|
| `#3291.dd8c54d0` | a scratch suite adding a whole-file twin fails the lint lane, naming folder and file; as `lines.json` it passes | `new-twin.test.mjs` (four) | the merge base: its lint check runs no `scripts/twins-lint.mjs`, so the lint lane never judges a twin |
| `#3291.fefc1230` | taking a twin off the list while it's still whole fails; converting a listed twin and leaving it listed fails, naming the stale entry | `list.test.mjs` (three) | the merge base: no twins command in the lint lane, and no list |
| `#3291.84843b66` | the design names `lines.json` as a twin's form, with an example of one find and its wrong lines | `design.test.mjs` (one) | the merge base: its Wrong programs entry names no `lines.json` and holds no example |

Every tagged test is a top-level `node:test` test with no subtests, and fails on the base at an `assert` call in this
folder's files (`helpers.mjs` or `design.test.mjs`), never at a thrown error: `BASE-FAILURE.txt` holds the run. This
suite plants no twin and has no `twins.json`: the merge base is the wrong program for all three criteria.

Before saving this I also ran the suite in a throwaway clone of the base against a small stand-in implementation (a
`--listed` mode of `scripts/twins-lint.mjs` in the lint check, the list at `scripts/whole-file-twins.json`, an example
in the design): all eight pass. Against three wrong variants of it they fail where expected: with no merge-base
comparison, the test that adds its own twin to the list fails; with no stale-entry check, the stale-entry test fails;
with the plain lint (list ignored) in the lane, six fail. That stand-in is not part of this suite.

## What this suite does not prove

- **Criteria 4 and 5** (above): the conversions of today's whole-file twins and the list running empty.
- **The rest of the lint lane.** Only the lint check's commands that name `scripts/twins-lint.mjs` run; cargo fmt,
  clippy and the other lints are not run on a scratch tree. That those commands are in the `lint` check is read from
  `scripts/lanes.mjs`, not by running `node scripts/lanes.mjs`.
- **A list or `twins.json` that can't be read**, a merge base with no list, or no `origin/main`: no test here.
- **That the list holds exactly today's 578 (or however many) twins.** The on-this-checkout test proves only that every
  whole-file twin left is listed and every entry is still whole.
