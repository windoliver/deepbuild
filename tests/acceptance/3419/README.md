# Acceptance tests for #3419: redraft folders, timed and slow lists in a suite's own lane file

Drafted blind from issue #3419, AGENTS.md, `docs/technical-design.md` ("How we know version 0 works", Dogfooding),
`docs/parallel-proof.md` (section 7, "A suite's own lane file (#1327)", and 7a) and the base commit `345c9ae26`
(origin/main). At the base I read `scripts/lanes.mjs`, `scripts/lanes-lists.mjs` (`LANE_FILE`, `alone`, `timed`,
`slow`), `scripts/affected.mjs` (`--list`, `--timed`, `--slow`, its INCONCLUSIVE lines and `--results`),
`scripts/proof.mjs`, `scripts/proof-guard.mjs` (`laneFileProblem`, `laneEdits`), `scripts/proof-change.mjs`,
`scripts/proof-approvals.mjs` and `scripts/alone-lint.mjs`, and `tests/acceptance/1327/` (and `1326/`'s approval
fixture, for the wire format) for the conventions. The helpers are written here, never imported from another suite.
Per AGENTS.md the implementing agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

```sh
npm ci                                       # once, if node_modules is missing
node --test 'tests/acceptance/3419/*.test.mjs'
```

Offline, about 20 s on the base and 45 s with a fix on the Mac; no file takes over a minute. It needs `git`,
`ssh-keygen` and `cargo` on PATH (`cargo metadata` only, on an empty workspace: nothing is built). No `lane.json`:
every scene is a temp repository with its own HOME, TMPDIR and throttle table, so the files can run beside others.

## The `lane.json` shape these tests expect

The issue's own example, with names of files of the lane file's own folder:

```json
{ "alone": true, "why": "shared: the planted port; each file holds it.", "timed": ["budgets.test.mjs"], "slow": ["build.test.mjs"] }
```

`timed` and `slow` are optional. A name is the file's name relative to the folder that holds `lane.json`.

## How the tests reach the code

- **Scenes** (`helpers.mjs`). A scene is a scratch git repository in a temp folder: `origin/main` holds a copy of this
  checkout's `scripts/`, `node_modules` linked to this checkout's (ignored by git), an empty cargo workspace
  (`Cargo.toml`, so `affected.mjs`'s `cargo metadata` answers), `.deepbuild/approvers` and the scene's base files;
  branch `change` holds the scene's commits, each saying `Part of #9419` (or `#9420`). Planted issues #9419 and #9420
  are given through `DEEP_PROOF_ISSUES`. HOME, TMPDIR and the throttle table are the scene's own.
- **Approvals** (`authenticator.mjs`). Criterion 3 needs "even with an approval": a commit marked approved gets a real
  signed tag under `refs/tags/deep/approved/` naming every path the commit touches, signed by a fresh in-memory
  `sk-ssh-ed25519` key that the merge base's `.deepbuild/approvers` lists, with the touch flag set. The authenticator
  is the one boundary stood in for; `ssh-keygen` verifies the tag, and the guard verifies it again itself. No other
  scene carries a tag.
- **The guard** is the scene's own `node scripts/proof.mjs guard`: refused = non-zero exit and a `FAIL guard:` line.
- **The lanes** are the scene's own `node scripts/affected.mjs --list` (its `<block> <runner>: <files>` lines) and, for
  criterion 2, a real `node scripts/affected.mjs --results=<file>` run on the scene's own throttle table.
- **The lint lane** (criterion 5): each command of the scene's own `scripts/lanes.mjs` `checks` lint lane whose script is
  under `scripts/`, run in the scene side by side: the same commands `affected.mjs` runs as the lint lane. This doesn't
  depend on which script carries the new finding, which the issue leaves open.
- **The exported lists** (criterion 6): each side's own `scripts/lanes.mjs`, imported in a process of its own.

Nothing under test is mocked. Test fixtures are `node:test` files that pass.

The suite's `.mjs` files carry no comments (docs/adr/0001-code-carries-no-comments.md); what they said is here. In
`helpers.mjs`: `scene` builds the scratch repository above (`commits` entries are `{ files, remove, approved }`);
`guard`, `affected` and `lintLane` run the scene's own guard, `affected.mjs` and lint-lane commands; `listBlocks`
reads `--list`'s `<block> <runner>: <files>` lines (and `SKIP` lines) into `{ '<block> <runner>': [files] }`, and
`blocksOf` names the blocks listing a file; `failLines` keeps the guard's `FAIL guard:` lines; `testFile` and
`importingTestFile` are passing `node:test` fixtures, the latter importing the folder's `fixture.mjs`. The scene's
`RUSTUP_HOME` and `CARGO_HOME` stay the machine's, so `cargo metadata` finds its toolchain under the scene's own HOME.
In `authenticator.mjs`: `hardwareKey` makes the in-memory security key and its allowed-signers line, and `approve` signs
the tag in OpenSSH's SSHSIG format (FIDO flags with the touch set), checks it with `ssh-keygen` and writes it with
`git mktag`.

## Criteria and tests

| Criterion | Tag | Test |
|---|---|---|
| 1. A new redraft folder with a lane file runs alone, the guard passes with no tag; in a redraft folder that held a file at the merge base it's refused, naming the folder | `#3419.b70aa6a5` | `redraft.test.mjs` |
| 2. Lane file names one timed, one slow: `--list` lists each in its block; a run without `--timed`/`--slow` reads INCONCLUSIVE naming both, never PASS | `#3419.e45cd630` | `timed-slow.test.mjs` |
| 3. The guard refuses, even approved: a named file an earlier commit added, one outside its folder, one the tree doesn't hold, a `byHand` or `skip` key | `#3419.79d243d9` | `guard-plants.test.mjs` (5 tests) |
| 4. An out-of-shape `timed` list still runs the folder alone; no file leaves a plain run | `#3419.965359ca` | `out-of-shape.test.mjs` (2 tests) |
| 5. A new suite listed `alone` in `lanes-lists.mjs` fails the lint lane, naming the entry and the suite's `lane.json`; the same entry for a folder held at the merge base passes | `#3419.9ce8f264` | `lint.test.mjs` |
| 6. With no lane file changed, `alone`, `timed`, `slow` are equal before and after, entry for entry | `#3419.10f9c195` | `same-lists.test.mjs` |
| 7. The failures on main before and after are the same IDs | `#3419.0945b61f` | none (below) |

### 1. `redraft.test.mjs`

Main holds `tests/acceptance/9419/suite.test.mjs`. The change, with no tag, adds `9419-redraft-ac1/` (a test file and
`lane.json`) and `9419-redraft-ac3/` (a test file, no lane file). Asserted: no `FAIL guard:` line, exit 0, a
`PASS guard:` line; `--list` lists `9419-redraft-ac1/redraft.test.mjs` in `alone node` only and the folder with no lane
file in `parallel node` only. A second scene has `9419-redraft-ac2/redraft.test.mjs` on main and the change adds the same
lane file there: the guard exits non-zero with a FAIL line naming `tests/acceptance/9419-redraft-ac2/`. Both halves are
in one test, so it fails on the base.

### 2. `timed-slow.test.mjs`

The change adds `9419/` with `plain`, `budgets` and `build` test files, all importing `fixture.mjs`, and a lane file
naming `budgets.test.mjs` timed and `build.test.mjs` slow. Both runs name `tests/acceptance/9419/fixture.mjs` as the
change (`affected.mjs [path ...]`). Asserted: `--list` lists budgets in `timed node` only, build in `slow node` only,
plain in `alone node` only. The run (no `--timed`, no `--slow`): an `INCONCLUSIVE` line names each of the two, the
summary line reads neither PASS nor NO NEW FAILURES, the exit is non-zero, and its `--results` file reads the two not
PASS while plain reads PASS, so the run did run.

### 3. `guard-plants.test.mjs`

Each test first runs the well-made counterpart: one approved commit adds `plain` and `budgets` test files and a lane
file with `"timed": ["budgets.test.mjs"]`. The guard must pass it. Then it runs the plant, its commit approved, and the
guard must exit non-zero with a FAIL line naming `tests/acceptance/9419/lane.json`. The plants:

- `budgets.test.mjs` added by an earlier commit of the change, the lane file by the next one (approved);
- `"timed": ["../9420/budgets.test.mjs"]`, a file the same commit adds in another folder;
- `"timed": ["missing.test.mjs"]`, which no commit adds;
- the counterpart plus `"byHand": ["plain.test.mjs"]`, and plus `"skip": ["plain.test.mjs"]`.

The base refuses any `timed` key, so on the base each test fails at the counterpart, never at the plant. With the
counterpart passing first, a plant's refusal is the plant's own.

### 4. `out-of-shape.test.mjs`

`9419/` holds `budgets` and `plain` test files and a lane file whose `timed` is `"budgets.test.mjs"` (a string, not a
list) in one test and `["budgets.test.mjs", 7]` in the other. Asserted: `--list` lists each file of the folder in
`alone node` and nowhere else, and the message names every file that left with the blocks it went to. **This passes on
the base by nature**: the base reads no `timed` key. Its wrong program is the issue's own, a reader that takes such a list
as it stands. I planted one (below) and both tests failed with
`files of the folder left its plain alone run: tests/acceptance/9419/budgets.test.mjs (listed in: timed node)`.

### 5. `lint.test.mjs`

Scene A: the change adds `9419/suite.test.mjs` with no lane file, puts `'tests/acceptance/9419/'` first in
`lanes-lists.mjs`'s `export const alone = [` literal, and names its reason in `lanes.mjs` (a line appended to the file
setting `aloneReasons[...]`), so the reason check of `alone-lint.mjs` has nothing to say of it. Asserted: some
lint-lane command exits non-zero with a line starting `FAIL` that names `tests/acceptance/9419/`, and its output names
`tests/acceptance/9419/lane.json` (the Fix line). Scene B: `9420/suite.test.mjs` is on main, and the change adds the
same entry and reason for `tests/acceptance/9420/`. Many lint scripts fail in a scratch repository whatever the change
(no crates, docs or package builds), so "passes" is read against scene C, B without the entry: every command exits as
it does in C, and no FAIL, BLOCKED, INVALID or INCONCLUSIVE line names the entry that C doesn't print.

### 6. `same-lists.test.mjs`

The merge base is `git merge-base HEAD origin/main` of this checkout. The one tree both sides read is the merge base's
suite folders that hold a `lane.json`, whole, from `git archive`. Before: the merge base's `scripts/`. After: this
checkout's `scripts/`. Each side's `alone`, `timed` and `slow` must hold the same entries, each as many times. Order isn't
compared. The failure names every entry one side has and the other lacks. A floor (over 500 alone, 100 timed and
50 slow entries, at least one lane file) keeps an empty comparison from passing. **This passes on the base by nature**:
before and after are the same scripts there. Its wrong program is the issue's own, a reader that drops an entry of
`lanes-lists.mjs`. With `tests/acceptance/1523/` taken out of `alone` it failed naming that entry.

**This criterion conflicts with main's tree, for the owner.** The merge base holds
`tests/acceptance/231-oracle/lane.json`. The base reads none there, and `231-oracle/` is in no list. A reader that does
what the scope says ("A lane file may sit in a new redraft or oracle folder ... and runs that folder alone") adds
`tests/acceptance/231-oracle/` to `alone`, so this test fails with
`alone: tests/acceptance/231-oracle/ is in this checkout's list, not in the merge base's`. The disk can't say that
folder's lane file is old, and the scope says nothing about a redraft or oracle lane file already on main. I kept the
test as the criterion words it. The implementer or the owner has to settle it: for instance, by an approved
`lanes-lists.mjs` entry for `231-oracle/`, or by a ruling that an old lane file on main counts as unchanged. With a
plant that skipped `231-oracle` (a demonstration only), the test passed.

### 7. No test

"The failures on main before and after are the same IDs" compares the whole tree's lanes, a preflight-sized run on
main and on the change. That's the release preflight's or `affected.mjs`'s known-failures comparison
(`scripts/known-failures.json`), not a fast scratch-repository test, so I wrote no test for it. It needs a run on the
change against main.

## What I chose where the issue leaves things open

- **Open, the owner's call** (must a redraft folder's lane file come in a change that names that folder's issue?). The
  tests don't depend on the answer. Criterion 1's change names #9419, the folder `9419-redraft-ac1/`'s issue, so it
  passes either way. No test plants a redraft lane file under another issue's change.
- **Redraft folder names**: `tests/acceptance/<issue>-redraft-<x>/`. A redraft subfolder of a landed suite, also in
  scope, has no criterion and no test here.
- **The slow file and the change.** `affected.mjs` runs a slow file that the change adds or edits. The criterion's
  "new suite" is added whole by the change, so with no paths the slow file would run in its folder's block whatever
  the list says. So criterion 2's runs name the suite's `fixture.mjs`, which its three test files import, as the change.
- **Never PASS in a scratch repository.** There the lint jobs that `affected.mjs` runs beside the tests print
  `NEW FAIL`s that have nothing to do with the suite, so the run reads FAIL on the base and with a fix alike. The
  criterion is read from what names the two files: the INCONCLUSIVE lines and the per-file states of `--results`,
  plus the summary not being PASS.
- **Out of shape** (criterion 4): a string where a list belongs, and a list holding a non-string. I didn't use a list
  naming a file outside the folder, where it's open whether the whole list or that one name stops counting.
- **Refusal wording**: none asserted. A refusal is a non-zero exit and a FAIL line naming the lane file (criterion 3)
  or the folder (criterion 1). In criterion 5, the lint's finding is a `FAIL` line naming the entry, with the
  `lane.json` path anywhere in that command's output.
- **"Even with an approval"** is a real signed approval of the plant's whole commit, so a refusal an approval could
  lift fails these tests.

## On the base

`BASE-FAILURE.txt` (paths redacted to `<checkout>`, `<tmp>`): 8 of 11 fail, each at an assertion, because the base reads
no redraft lane file, no `timed` or `slow` key and has no lint finding:

- criterion 1: the guard refuses the redraft folder's lane file ("a lane file lanes.mjs never reads");
- criterion 2: `--list` puts the timed file in `alone node`;
- criterion 3, five tests: the guard refuses the well-made counterpart (`it says "timed"`, refused even approved);
- criterion 5: no lint-lane command names the entry.

Three pass by nature: criterion 4's two (the base reads no `timed` key) and criterion 6's (the same scripts on both
sides).

Before saving it, I checked the tests can pass. I planted a minimal fix in this checkout's `scripts/`:

- `lanes-lists.mjs` reads `tests/acceptance/<n>(-<suffix>)?/lane.json` into `alone`, and into `timed` and `slow` a list
  of file names of the folder, only when the whole list is in shape;
- `proof-guard.mjs` accepts the `timed` and `slow` keys and refuses, hard, a name with a `/`, a file the commit's tree
  doesn't hold or one its parent already held. It checks "landed before" against the lane file's own folder;
- `alone-lint.mjs` fails a new `alone`, `timed` or `slow` entry for a folder or file the merge base doesn't hold, with
  `Fix: say it in <folder>lane.json instead`.

With that, 10 of 11 passed. The 11th is criterion 6, which failed only on `231-oracle/` (above), and passed with that
folder skipped. With the plant in place, I also checked the twins:

- a reader that takes `timed` as it stands failed criterion 4, naming `budgets.test.mjs`;
- `tests/acceptance/1523/` dropped from `alone` failed criterion 6, naming it;
- a lint that flags every new entry, held at the merge base or not, failed criterion 5's second half.

I then reverted every planted change (`git checkout -- scripts/`). `git status` shows only `tests/acceptance/3419/`
untracked.
