# Acceptance tests for #3139: the lint lane and blind suites

Issue #3139: "The lint lane fails on blind suites no agent may edit". The wait ratchet, the size ratchet and the repo rules each get the owner's decision on `tests/acceptance/`, the design states it, and run records hold no home path.

Written first, blind, on November 23, 2026, at the base `c52dc3e73` (origin/main), by a job that never saw the work. It read no other branch, pull request, worktree or commit after the base, and no history of the lint scripts. The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft by this job (design: Dogfooding).

## Sources

- **Issue #3139**: its account and table of findings, Scope, three criteria and Depends on.
- **The owner's comment that begins "Decision taken"**. The criteria's "as the owner decided" and "that the decision excuses" refer to it. In short:
  - **Wait and size ratchets.** A planted twin is out of both. A twin is any file under a `twins/` folder in `tests/acceptance/`. A blind suite's own file is judged only in the change that adds it, so once the merge base holds it, a file with no ceiling is out. A new suite still starts at zero (#1604's AC5). The twins' ceilings are dropped; the other acceptance ceilings stay.
  - **Repo rules, `deps`.** Twins' manifests are out. Suites' own tooling crates are new dependencies and get rows in `scripts/repo-rules.json`.
  - **Repo rules, `secrets`.** It keeps judging all of `tests/acceptance/`. Home paths in run records are redacted in place to `~`, including a test's own temp HOME, and so are four records whose scratchpad paths spell a user name. #2651's two made-up tokens get `allowedFindings` rows.
  - **Design.** The Repo guards bullet in How we know version 0 works states all three rules.
- **The design**, `docs/technical-design.md`: How we know version 0 works (the Repo guards bullet) and Dogfooding. `node scripts/design-section.mjs --issue 3139` prints the first. **AGENTS.md.**
- **The base, for surfaces only**:
  - the lints: `scripts/wait-ratchet.mjs` with `scripts/wait-ceilings.json`, `scripts/size-ratchet.mjs` with `scripts/size-ceilings.json`, and `scripts/repo-rules.mjs` with `scripts/repo-rules.json`;
  - `scripts/lanes.mjs`, for the lint lane's commands and `testPaths`;
  - `scripts/proof-change.mjs`, for `criterionId`;
  - the records under `tests/acceptance/`;
  - for the house format, `tests/acceptance/1604/`, `1432/`, `1143/` and `2149/`.

## Run

```sh
sh scripts/lease nice -n 10 node --test --test-concurrency=1 'tests/acceptance/3139/*.test.mjs'
```

The tests use plain `node:test` and Node built-ins, with Node 24. They also need:

- git;
- a checkout with git history and `origin/main`, for the checkout test's merge base;
- cargo, which the deps rule needs for `cargo metadata`. A test puts the first of `/opt/homebrew/opt/rustup/bin`, `/usr/local/opt/rustup/bin` and `~/.cargo/bin` that holds cargo first on the child's PATH. Without cargo, a deps rule that prints `BLOCKED deps` makes its test throw `BLOCKED:`, never pass.

Nothing is written in the checkout. Scratch repositories live under the system's temporary folder (`deep-3139-*`), and each test removes its own in `t.after`. At a load of about 380 on this Mac, the scratch files take 2 to 6 s each. The checkout file takes about 50 s, most of it the repo rules run (about 30 s).

## Surfaces

- **The three lint commands**, as the lint lane runs them: `[process.execPath, 'scripts/wait-ratchet.mjs']`, `[process.execPath, 'scripts/size-ratchet.mjs']` and `[process.execPath, 'scripts/repo-rules.mjs']`. Each is taken from `scripts/lanes.mjs`'s exported `checks` and run as a process with cwd at the checkout it checks. That checkout is this one, read-only, or a scratch repository.
- **What the lints print**: each `FAIL`, `INVALID` or `BLOCKED` line of a check (`waits`, `size`, `deps`, `secrets`), the path it names, and the PASS line. Exit codes are judged only for the two ratchets in scratch repositories, where nothing else can fail them.
- **The checked-in files the lints read**: the two ceilings files and `scripts/repo-rules.json`.
- **The design text** and **the records on disk**.

A scratch repository is built as #1604's and #1432's suites build theirs:

- a copy of this checkout's `scripts/`, which `.git/info/exclude` hides from git's listing;
- the scratch repository's own ceilings files or `scripts/repo-rules.json`, force-added. Its `repo-rules.json` is this checkout's with the scratch repository's own `deps` rows and no `allowedFindings`; every other key is kept;
- the planted files, committed, with `origin/main` pointing at that commit.

So the merge base is that commit. "The change that adds it" is one or more commits on top of it, as a branch adds a suite. An uncommitted edit stands for a change to a file the merge base holds.

Git runs with `-c user.name=Fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null`. Git's `GIT_*` variables are removed from the environment of every git and lint process in a scratch repository. A scratch repository holds no `SECURITY.md`, cards or physics build, so the repo rules always exit 1 there; those tests judge only the `deps` and `secrets` lines.

Every planted suite lives in `tests/acceptance/3139-plant/` (the merge base's) or `tests/acceptance/3139-added/` (the change's). No real suite has those names. A planted home path is a made-up user's macOS home folder, built at run time from its parts, so no file here holds one. A message gives a finding's file, line and kind, never its value.

## Criteria and tests

Each ID is `#3139.` and the first 8 hex digits of the SHA-256 of the criterion's text from the issue, trimmed, with white space collapsed (`criterionId` in `scripts/proof-change.mjs`). Each test's name starts with its ID.

| ID | Criterion | Tests | On the base |
|---|---|---|---|
| `#3139.b841908f` | AC1: the design states, for each of the three lints, how it treats `tests/acceptance/`, as the owner decided | `ac1-design.test.mjs` | fails: the bullet states none of the 9 facts |
| `#3139.9aeafe77` | AC2: none of the three prints a finding under `tests/acceptance/` that the decision excuses, and each still fails a planted fixed wait, an over-long file, an unlisted dependency and a home path outside `tests/acceptance/` | `ac2-checkout.test.mjs` (3), `ac2-waits.test.mjs` (2), `ac2-size.test.mjs` (2), `ac2-repo-rules.test.mjs` (3) | 6 fail; 4 pass as Unchanged holds |
| `#3139.0cf32f1a` | AC3: no base-failure or run record under `tests/acceptance/` holds a home path | `ac3-records.test.mjs` | fails: 96 home paths in 17 records |

### AC1: the design (`ac1-design.test.mjs`)

The test reads the Repo guards bullet under "How we know version 0 works" in `docs/technical-design.md`, as the decision places it: the line `- **Repo guards.** …` and any continuation lines. The bullet must name `tests/acceptance/` and state 9 facts. A fact holds when one sentence, or two sentences side by side, match all its patterns, so the wording is free. The patterns are loose on purpose: each fact needs only its key words, such as "twin" with a word for "out", and a word for one of the ratchets.

| Fact | What the decision says |
|---|---|
| 1-3 | the wait ratchet, the size ratchet and the repo rules each have a sentence about `tests/acceptance/`, twins, blind suites or records. "The ratchets" counts for both ratchets |
| 4 | a planted twin is out of the ratchets |
| 5 | a suite's own file is judged only in the change that adds it, or once the merge base holds it, it is out |
| 6 | twins' manifests are out of the deps rule |
| 7 | a suite's own tooling crate gets its row |
| 8 | the secrets rule keeps judging `tests/acceptance/` for home paths |
| 9 | run records are written with home paths redacted, as `~` |

On the base the bullet states none of them. Two phrasings of the decision passed a probe of the same patterns.

### AC2, on this checkout (`ac2-checkout.test.mjs`)

Each lint runs on this checkout as the lane runs it. A finding the decision excuses fails the test, which lists up to 30 of them. Any other finding is left alone, and so is the exit code: those belong to other open issues, or to a suite a change adds.

- **Wait ratchet.** It flags a `FAIL waits` line whose path is a twin, or a file under `tests/acceptance/` with no ceiling in `scripts/wait-ceilings.json` that the merge base of HEAD with origin/main holds (`git ls-tree`). It also flags any twin left in the ceilings file, since the decision drops them. On the base: 794 lines, 330 in 113 suite files and 464 in 80 twin files.
- **Size ratchet.** The same rule with `scripts/size-ceilings.json`. On the base: 40 lines, all twins.
- **Repo rules.** It flags each `deps` line that names a path inside a `twins/` folder in `tests/acceptance/`. It flags each `deps` line that names one of the nine suites' own tooling crates whose dependencies had no row at the base. The decision gives them rows. It flags each `secrets` line that names `tests/acceptance/2651/lib.mjs`, whose two made-up tokens the decision allows. On the base: 41, 18 and 2 lines.

### AC2, planted (`ac2-waits.test.mjs`, `ac2-size.test.mjs`, `ac2-repo-rules.test.mjs`)

Each line the decision draws is planted on both sides. Every plant runs after its clean twin passed in the same repository, so a lint that fails everything fails the twin, and one that passes everything fails the plant.

**Wait ratchet.**

- *Left out, and the suite file the change adds* (new behavior; fails on the base at its first assertion):
  - The merge base holds `3139-plant/held.test.mjs` with a fixed wait (`setTimeout`, line 8) and no ceiling, and `3139-plant/listed.test.ts` with one `sleep` at its ceiling of 1. The ratchet must pass, naming neither.
  - A commit then adds a twin, `3139-added/twins/retries-on-a-timer/packages/fixture/src/retry.ts`, whose retry waits on `setTimeout`, and `3139-added/reports.test.mjs`, which waits for its event. The ratchet must still pass, naming neither.
  - A second commit makes `reports.test.mjs` wait on a timer. It must fail, naming `reports.test.mjs:8`: a new suite starts at zero. No line may name the twin or the held file.
- *Outside, and the ceiling kept* (Unchanged hold; passes on the base):
  - With `tests/held.test.mjs` clean and `listed.test.ts` at its ceiling, the ratchet passes.
  - A fixed wait planted in `tests/held.test.mjs`, a file the merge base holds under `tests/` but outside `tests/acceptance/`, fails, naming line 8.
  - A new `packages/fixture/test/twins/sleeps.test.ts` with a `sleep` fails, naming line 5: a `twins/` folder outside `tests/acceptance/` holds no planted twin.
  - `listed.test.ts` with a second `sleep` fails, naming it: an acceptance file the merge base holds with a ceiling keeps it.

**Size ratchet.**

- *Left out, and the suite file the change adds* (new behavior; fails on the base at its first assertion):
  - The merge base holds `3139-plant/catalog.test.mjs` at 1,600 lines with no ceiling. The ratchet must pass, naming it nowhere.
  - A commit adds a 1,600-line twin, `3139-added/twins/grown/packages/fixture/src/big.ts`, and a 20-line suite file. The ratchet must still pass.
  - A second commit adds `3139-added/long.test.mjs` at 1,600 lines. It must fail, naming the file and its 1,600 lines, and naming neither the twin nor the held file.
- *Outside* (Unchanged hold; passes on the base):
  - `tests/fixture/held.mjs` at 1,400 lines passes.
  - Grown to 1,600 lines, it fails, naming it and its size.
  - A new `packages/fixture/src/twins/big.ts` at 1,600 lines fails, naming it and its size.

**Repo rules.**

- *Deps, twins out and a tooling crate judged* (new behavior; fails on the base at the twins assertion):
  - A commit adds a twin's `package.json` and a twin's `Cargo.toml` under `3139-plant/twins/`, each with an unlisted dependency. It also adds the suite's own tooling crate, `3139-plant/tool/Cargo.toml`, with the same unlisted dependency.
  - The deps rule must fail the tooling crate's dependency, as it would any new one, and print no line naming a twin's manifest.
  - With a row for the tooling crate, the deps check must read PASS.
- *Deps outside* (Unchanged hold; passes on the base):
  - `packages/fixture/package.json` and `tools/twins/copy/crates/fixture/Cargo.toml` declare only listed dependencies, and the deps check reads PASS.
  - An unlisted dependency planted in each fails, naming the manifest and the dependency. The second sits under a `twins/` folder outside `tests/acceptance/`, which holds no planted twin.
- *Secrets, still judging `tests/acceptance/`* (Unchanged hold; passes on the base):
  - Four files write their home folder as `~`, and the secrets check reads PASS: a run record the merge base holds (`3139-plant/BASE-FAILURE.txt`), one the change adds (`3139-added/BASE-FAILURE.txt`), a twin's file and `docs/notes.md` outside.
  - With a home path on line 2 of each, each gets its `FAIL secrets: <path>:2:…: home path` line.

The new-behavior tests fail on the base at an assertion in their own file. The Unchanged holds guard the other side of each line: a fix that leaves all of `tests/acceptance/`, any `twins/` folder, or every held file out fails them. `BASE-FAILURE.txt` also records a stand-in fix that passes all seven, and six wrong ones, each failing the test that names its fault.

### AC3: the records (`ac3-records.test.mjs`)

**What counts as a record.** A record is a `.txt` or `.log` file under `tests/acceptance/` that git lists (tracked, or new and not ignored), read from disk, outside a `twins/` or `fixtures/` folder. That covers `BASE-FAILURE.txt`, `BASE-RUN.txt`, `TWINS-RUN.txt`, `BASE-RESULTS.txt` and the like: 1,162 files at the base.

**What counts as a home path.** Two forms:

- what the secrets rule's own pattern finds: `/Users/<name>/` (not `Shared`), `/home/<name>/`, and `C:\Users\<name>\` (not `Public`). That includes a test's own temp HOME written as `<tmp>/home/<name>/`;
- the same macOS home folder spelled with dashes, `-Users-<name>-`, as an agent's scratchpad and project folder names spell it. The decision redacts these too.

**Allowed rows.** No `allowedFindings` row excuses a home path in a record, since the decision redacts each record in place. So the three lines of `tests/acceptance/1946/BASE-FAILURE.txt` count too. They name `/home/<account>/`, the throwaway account its base run made on the test host, and the base allows them by a row. They are a test's own HOME, which the decision redacts.

**Self-check.** The scan first proves itself on planted lines, built from parts: it finds each of the four forms, and finds nothing in their `~` and `<tmp>` versions or in `/Users/Shared/`.

**On the base**, 96 home paths in 17 records:

- 85 that the secrets rule reports, in 11 records;
- the 3 allowed lines of #1946;
- 8 dashed spellings, in 5 records (238, 376, 403, 45-redraft, 761). The decision counted four such records; the base has five.

## Readings where the issue or the decision leaves a choice

- **"On main after the change".** The checkout the tests run in: the fixing branch before merge, or main after it. "The merge base holds it" is read from the merge base of HEAD with origin/main, as the ratchets read their ceilings. So on main every tracked file is held, and on a branch a suite the branch adds is judged.
- **"That the decision excuses", for deps.** The decision leaves twins' manifests out and gives the suites' tooling crates rows. Both kinds of line count as excused. The tooling crates are the nine named in `ac2-checkout.test.mjs`, so a later suite that lands a crate without its row isn't held here: its finding is a real one.
- **"That the decision excuses", for secrets.** The decision leaves nothing under `tests/acceptance/` out of the secrets rule. It allows #2651's two tokens, so a `secrets` line naming that file is excused. Home paths are fixed by redaction, which AC3 holds from the records themselves.
- **"A planted twin".** Any file under a folder named `twins` at any depth below `tests/acceptance/<suite>/`, as `loads-lint` and `alone-lint` read it. A `twins/` folder outside `tests/acceptance/` is no twin.
- **"The other acceptance ceilings stay".** The wait ratchet still judges an acceptance file the merge base holds against its ceiling (the wait test's outside plant). The checkout test doesn't pin which ceilings remain: #1604's checkout test pins three.
- **"Each still fails a planted …".** In a scratch repository, the planted line must be a `FAIL` naming the planted file. The ratchets must also exit 1, and the repo rules there always exit 1 (Surfaces).

## Not covered here

- How the twins' ceilings are dropped, beyond the checkout test reading none in either ceilings file.
- The wording of the `allowedFindings` rows for #2651, and the reasons written for the tooling crates' rows.
- A blind job checking its records with the secrets rule before committing. That is the decision's process, not a lint's output. This suite's own records were checked that way.
- Which other records the four "scratchpad paths that spell a user name" are. AC3 holds the result: none is left.

## Files

- `helpers.mjs`: the criterion IDs, the lint commands from the lane, the runner, the scratch repository and its plants.
- `ac1-design.test.mjs`, `ac2-checkout.test.mjs`, `ac2-waits.test.mjs`, `ac2-size.test.mjs`, `ac2-repo-rules.test.mjs`, `ac3-records.test.mjs`: the tests above.
- `BASE-FAILURE.txt`: each file's run on the base, redacted, and the stand-in checks.
