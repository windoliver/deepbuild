# Acceptance tests for #2405: the studied-names list holds the products studied since it was written

Written first, blind, from issue #2405 ("The studied-names list holds the products studied since it was written, so the
public text lane catches a name that only a study round's own tool catches today": its report, Scope, four acceptance
criteria and Proof, as the brief quoted its body; it has no comments), the design and base commit `031292bf1` ("Merge
pull request #2639 …"), by a job that never saw an implementation; none existed, and no other branch, worktree or pull
request was read, nor GitHub. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding). Node's test runner and built-ins only.

No file here holds a studied name, a hash's readable name or the salt. Every name in a fixture is invented (`Zarnovex`,
`Glimmerquay` and the others in `ac1-names-script.test.mjs`); the only real names are the base's own dependencies and
adapters, which are public, and the one the AC3 plant uses, `objc2`, is read from `scripts/repo-rules.json` at run time.

| AC | ID | Tests |
|---|---|---|
| AC1 | `#2405.94f76478` | `ac1-names-script.test.mjs` (two, offline) and `ac1-private-list.live.test.mjs` (the real list) |
| AC2 | `#2405.67f3c930` | `ac2-open-issues.live.test.mjs` (live) |
| AC3 | `#2405.2014d5d9` | `ac3-dependencies.test.mjs` (two, offline) |
| AC4 | `#2405.bb6d2053` | `ac4-contributing.live.test.mjs` (the sentence offline, the doc lanes live) |

IDs are `scripts/proof-change.mjs`'s `criterionId` over each criterion's line after `- [ ] `, as the brief gave the
issue's body; the live issue wasn't read, so they aren't checked against it. Each test's name starts with its ID and its
AC number.

## What was read

- `AGENTS.md`, `CONTRIBUTING.md` (its public text line, and the doc lanes: design links and names, catalogue drift and
  public text), and `docs/technical-design.md`: Dogfooding and "Tests written first" in How we know version 0 works, the
  drafting rules under What done means (a check enters only through a surface the issue names), and Decided, which the
  issue links (its rows keep private runners outside the public repo, as the private list is kept here).
  `docs/canvas-primitives.md` says nothing on studied names.
- At the base: `scripts/public-text.mjs` (the lane: its word rule, what it scans, its output), `scripts/studied-names.json`
  (`{ salt, hashes }`, 106 sorted hashes, two-space JSON), `scripts/lanes.mjs` (the doc lanes' entries, `runLanes`,
  `changedPaths`, `writeRecord`), `scripts/open-issues.mjs`, `scripts/throttle.mjs` and `scripts/lease` (how a lane run
  waits on a loaded machine), the imports of `scripts/catalogue-drift.mjs` and `scripts/design-links.mjs`,
  `scripts/repo-rules.json` (`deps`), `adapters/*.facts.json` (`agent`), `packages/adapters/README.md`,
  `scripts/proof-change.mjs` (`criterionId`), and suites `1329/` (helpers, tests, README, BASE-FAILURE), `2566/`
  (README) and `2178/lint-lanes.test.mjs` (which reads the lane's PASS line) for the house format.

## The surfaces (my choice where the issue leaves it open)

### AC1's script

- **Where and how.** `scripts/studied-names.mjs`, beside the list it checks, run from the repo's root as
  `node scripts/studied-names.mjs <private list>`. The private list's path is its one argument, a file outside the repo;
  it reads `scripts/studied-names.json` from the repo it runs in.
- **The private list's format.** One name a line, spelled as public text spells it; case doesn't matter, and white
  space around a line is trimmed. Blank lines and lines starting with `#` are skipped. A name that is also a plain word
  is written after `plain:`, as in `plain: Kettle`: it is left out of the file and of the count, and its hash is never
  asked for. Line numbers count from 1 over every line of the file, comments and blank lines included.
- **"Hashes to an entry".** The SHA-256 of the salt followed by the name's form is in `hashes`. The form is the lane's
  reading of the whole name: its words, by the lane's own pattern (letters and numbers, joined inside by `.` `_` `-` or
  `'`), joined by one space and lowercased. `VexMorrow Quillet` is `vexmorrow quillet`; `Quellith-Drabe` is
  `quellith-drabe`. Only the whole name is asked for, never a joined name's parts or a phrase's single words, since a
  part or a word can be a plain word.
- **What it prints.** On success it exits 0 and prints the count of names it checked (the names not marked plain) as a
  whole number. On a missing name it exits non-zero without crashing (no stack trace) and names each missing name's line
  as `line <n>` or `<list file>:<n>`. It never prints a name from the list, plain words included, on success or failure.
- **Untested:** a name of more than four words (the lane never matches one whole; the test still asks for its hash), a
  line with no letter or digit, `plain:` in another case, the script with no argument, a list inside the repo, and
  whether the script also fails when a plain word's hash is listed.

### The live AC1 test

- It reads the maintainers' list's path from `DEEP_STUDIED_NAMES_LIST`. Without it, or when the file can't be read, it
  skips with a message starting `INCONCLUSIVE:` and never passes. The list has to be outside the checkout.
- It checks the criterion itself: each name not marked plain has its form's salted hash in the checkout's file. Then it
  runs the script on the list, in a scratch copy: exit 0, the count as a whole number, and no name not marked plain
  printed whole. (A plain word is a common word, so its appearance proves nothing and isn't sought.)
- Nothing it prints holds a line of the list. Assertion messages hold line numbers and counts only, and no assertion is
  made on the script's output itself, so a failure report never carries it. The output is shown as a diagnostic (the
  Proof's count) with every line that shares a word, or a part of a joined word, with any name on the list withheld.

### AC2: "the public text lane over `main`"

- **Read as the lane's own run on main.** A scratch copy of the checkout is committed whole as `origin/main`, so the
  lane's change and commit messages are empty and it reads every open issue: the Proof's "the lane's run over the open
  issues". It runs as the `public text` entry of `scripts/lanes.mjs` through `runLanes`, with the caller's gh and HOME
  (so the machine's throttle), and `GH_REPO=windoliver/deepbuild` unless one is set. It must PASS with return 0, and its
  PASS line must count more than 0 open issues (`… and <n> open issues name no studied product`, as 2178 reads it).
- **Why not the whole tree.** Read over the whole tree as one change (an empty base commit with the tree on top), the
  base's own 106 hashes already find 2,009 words in 169 files: 1,777 in 127 files under `tests/acceptance/`, 97 in
  `reports/`, 37 in `packs/`, 33 in `docs/`, 31 in `vendor/`, 9 in `Cargo.lock`, 3 in `package-lock.json` and 22 in
  sources under `packages/`, `crates/` and `scripts/`. (Counted by the lane's word rule over the tree's `git diff -U0`
  from the empty tree, 160 MB, without printing a word; it took 415 s at a load average near 200.) Vendored code,
  lockfiles and recorded fixtures can't be restated, so that reading would fail before and after any list. The Scope's
  step "the lane runs with them over the tree" is the implementer's to run; no test here runs it.
- **INCONCLUSIVE.** Offline or signed out (`gh auth status` fails), the lane INCONCLUSIVE (the issues unread, or no
  throttle grant within its 30 minutes), or the run stopped at the helper's 45 minutes: it skips with a message starting
  `INCONCLUSIVE:`.

### AC3

- **"Reads as not listed".** The lane, reading the name as written as one line of public text, finds nothing: none of
  its words, parts of a joined word, or runs of up to four words is listed. `@microsoft/api-extractor` is read as
  `microsoft`, `api-extractor`, `api`, `extractor` and `microsoft api-extractor`; `cursor-agent` as `cursor-agent`,
  `cursor` and `agent`. So public text naming a dependency or an adapter as it is written always passes the lane.
- **The names.** Every key under `deps` in `scripts/repo-rules.json` (152 distinct at the base, the repo's own packages
  and crates among them), and each adapter's names: for each `adapters/*.facts.json` that names an `agent`, the file's
  name before `.facts.json` and the agent (`claude-code`, `claude`, `codex`, `cursor`, `cursor-agent`, `opencode`,
  `paseo`, `pi` at the base). The two facts files with no agent, `loops` and `mcp-servers`, aren't adapters.
- **The program that fails on the planted hash: the public text lane**, the `public text` entry of `scripts/lanes.mjs`
  run through `runLanes`, by `scripts/public-text.mjs` or any other command the entry runs. It reads the list on every
  change, and its Fix line already says "a name DeepBuild runs, links, calls, reads or writes leaves the list". It must
  read FAIL with a non-zero return and an output line naming the dependency as a whole word.
- **The plant.** The salted hash of a one-word dependency, added to the list by a commit on top of `origin/main`, so a
  lane that checks the whole list and one that checks only the hashes a change adds both meet it. The dependency is the
  first one-word name the deps list only under a Cargo manifest's target-specific section (`objc2` at the base), so a
  lane that reads only some manifests or sections misses it. The twin: the same copy before the plant passes the lane.
  The open issues come from a fake `gh` with three clean bodies, in a sandbox.
- The first AC3 test reads the checkout's list itself; the second runs the lane.

### AC4

- **The sentence.** One sentence of CONTRIBUTING.md (split at line breaks and after `.` `!` `?`) holds `study` or
  `studies`, `add` in any form, `name` or `names`, and `before` followed later by `file`, `files`, `filed` or `filing`.
  Anywhere in the file: the criterion says "CONTRIBUTING.md says"; the Scope's place for it, the public text line, isn't
  required.
- **The doc lanes** are CONTRIBUTING.md's three, run in one `runLanes` call in a scratch copy whose base lacks
  CONTRIBUTING.md and whose change adds it whole, so the public text lane reads the new sentence; the other two read the
  docs and every open issue. Each must PASS, with return 0. The caller's gh and HOME, as in AC2. The sentence is checked
  first, offline. Without gh, without `packages/contracts/dist` (the catalogue drift lane imports it), or with a lane
  INCONCLUSIVE or the run stopped, the lanes' half skips as INCONCLUSIVE.

### The scratch copies

Each test that runs a program gets a sandbox under the OS temp folder, removed afterwards. Its `repo/` holds this
checkout's working tree (tracked files and untracked files git doesn't ignore; AC4 adds each package's built `dist/`),
`node_modules` linked to the checkout's and kept out of the copy's commits, and a fresh `git init` with the checkout's
origin URL as its remote. AC1's offline tests make no commit; the lane tests commit the copy as `origin/main` (and AC3 and
AC4 commit their change on top). Git runs with a fixture identity, no signing and no hooks. Offline runs get a sandboxed
HOME, TMPDIR and XDG folders (so the machine's throttle table and lane records stay out of them), no GitHub token,
cached issues or private list, and the fake `gh` first on PATH; live runs use the caller's environment without
`DEEP_OPEN_ISSUES`.

## How to run

```sh
npm ci && npm run build -w packages/contracts      # once, for AC4's catalogue drift lane
node --test --test-concurrency=1 'tests/acceptance/2405/*.test.mjs'
DEEP_STUDIED_NAMES_LIST=/path/outside/the/repo/studied-names.txt \
  node --test tests/acceptance/2405/ac1-private-list.live.test.mjs   # the real list: the Proof's count
```

They're `*.test.mjs` under `tests/acceptance/`, so the unit lane doesn't pick them up; run them by hand. Each test that
copies the checkout takes a minute or more on a loaded machine; `--test-concurrency=1` keeps them from copying at once.
AC2 and AC4 need network and `gh` signed in with read access to `windoliver/deepbuild`, and wait on the machine's
throttle like any lane.

## The base

One run of the suite in this worktree at `031292bf1`, with `npm ci` and the contracts package built, gh signed in and
`DEEP_STUDIED_NAMES_LIST` unset, at a load average of 200 to 400 from other sessions: one test passes, four fail and two
skip as INCONCLUSIVE (`BASE-FAILURE.txt`).

| AC | At the base |
|---|---|
| AC1 | Both offline tests fail: the base has no `scripts/studied-names.mjs` (`Cannot find module`). The live test skips as INCONCLUSIVE: no list is named, and this job never sees the private list. |
| AC2 | Skips as INCONCLUSIVE, with no verdict: the lane never ran, because the machine's throttle gave it no build grant within its 30 minutes while other sessions held the one build slot. The brief reports the base's lane reading PASS over 1,195 open issues; this run didn't confirm that. |
| AC3 | The property test passes: no dependency or adapter name reads as listed in the base's 106 hashes. The lane test fails as it should: with `objc2`'s hash planted, the base's lane still passes (1 changed file, 1 commit message, 3 open issues); its twin before the plant passed. |
| AC4 | Fails: no sentence of CONTRIBUTING.md says a study adds its names before it files. The doc lanes didn't run, since the sentence is checked first. |

AC2 and AC3's first test pass on any list that keeps today's property: they guard the new list's content, so they fail
only on a wrong list, as the plants below show.

## Wrong programs, planted by hand

Each ran once (C's wrong sentence twice, with gh and without), in one of three scratch copies of this worktree outside
the repo, never committed: A holds right programs, B and C wrong ones. The programs were written for this check only: an AC1 script (a right one, and three wrong
twins picked by an environment variable), a dependency check spliced into the copy's `scripts/public-text.mjs` (right,
and a twin that reads only `package.json` manifests), and edits to the copy's list and CONTRIBUTING.md. The live AC1
plant's private list held five invented names and a plain word, in a file outside the copy.

| AC | Planted program | Test | Result |
|---|---|---|---|
| AC1 | A: a right script (counts the names not marked plain; names a missing one as `line <n>`) | both offline tests | pass, pass |
| AC1 | A: the script prints a missing name beside its line (`line 11 (Glimmerquay)`) | the missing-name test | FAIL: "the script printed a word of a name on the private list" |
| AC1 | A: the script counts lines from 0 (`line 10`) | the missing-name test | FAIL: "the script's output doesn't name line 11 of the private list" |
| AC1 | A: the script hashes a name as written, not lowercased | the count test | FAIL: "the script didn't exit 0 with every name hashed" (all six reported missing) |
| AC1 | A: the right script; line 10's name left out of the copy's file | the live test | FAIL naming `[10]` only; the diagnostic shows the script's `… line 10` |
| AC1 | A: the same, every name hashed | the live test | pass; the diagnostic shows `studied names: all 5 names on the private list hash to an entry …; 1 plain words left out` |
| AC1 | A: a script that prints the missing name; line 10's left out | the live test | FAIL: "the script printed the names on these lines of the private list" `[10]`; the leaking line shown as withheld |
| AC2 | C: the list also holds `acceptance`, a plain word the open issues write | the live test | INCONCLUSIVE, no verdict: the lane got no build grant within 30 minutes (`INCONCLUSIVE no grant`) |
| AC2 | A: the right programs | the live test | INCONCLUSIVE, no verdict: no build grant within 30 minutes |
| AC3 | C: the list holds `objc2` | the property test | FAIL naming `objc2` and every dependency with it as a part (`objc2-app-kit`, `objc2-foundation`, …) |
| AC3 | B: a lane check that reads only `package.json` manifests | the lane test | FAIL: "the public text lane doesn't fail on a list holding the dependency objc2" (the lane passed: 1 changed file, 1 commit message, 3 open issues) |
| AC3 | A: the right lane check | both tests | pass, pass |
| AC4 | C: "A study adds its names to the list after it files anything." | the live test | FAIL: "no sentence of CONTRIBUTING.md says a study adds its names before it files" (with gh on PATH, and again without) |
| AC4 | A: "… before it files anything.", with `gh` off PATH | the live test | the sentence passes; then INCONCLUSIVE: "gh isn't signed in or can't reach GitHub" |
| AC4 | A: "… before it files anything.", with the right programs and gh | the live test | no verdict: stopped by hand while its three lanes queued for the build slot, after AC2's run in the same copy had waited out its 30 minutes |

In none of the AC1 runs did the test's output hold an invented name from the live plant's private list.

**Not verified.** No live lane run reached a verdict during this job, at the base or on a plant: the machine's one build
slot stayed held by other sessions' builds (the process table showed cargo builds holding build grants for 40 to 60
minutes and 17 build requests queued). Three live lane runs got `INCONCLUSIVE no grant`, and the fourth was stopped
while it queued. So AC2's PASS and
FAIL on the real open issues, and AC4's doc lanes passing on them, are unproven here; this job didn't bypass the
throttle, and it read GitHub only through these tests. What those runs share with the offline AC3 lane test, which
passed and failed as it should, is proven: the copy and its commits, the lane runner and the verdict reading. The PASS
line AC2 reads its count from (`… and 3 open issues name no studied product`) is the one those offline runs printed.
The doc lanes' live state today is unknown: if an open issue unrelated to #2405 fails `design links and names` or
`catalogue drift`, AC4 can't pass until it is fixed.

## Files

- `helpers.mjs`: the scratch copies, the lane's word rule and planted hashes, the private list's reader, the dependency
  and adapter names, the fake `gh`, the environments and the lane runner.
- `ac1-names-script.test.mjs`, `ac1-private-list.live.test.mjs`, `ac2-open-issues.live.test.mjs`,
  `ac3-dependencies.test.mjs`, `ac4-contributing.live.test.mjs`: the tests, one file per criterion's surface.
- `BASE-FAILURE.txt`: the one run of the suite at the base.
