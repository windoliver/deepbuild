# The brief the blind job for #1835 got

Given whole to a separate job with no view of the working session, at base `9ae04c6cd980f3c37fc64bcf5938b5169e1e7c52`. Paths on the machine are replaced by `<…>` names; nothing else is changed.

---

You are the blind acceptance-test job for issue windoliver/deepbuild#1835 ("The budget window can close only budget-only issues: nothing ticks the criteria a Part of merge proved"). The repository's AGENTS.md (read it first, it binds you) says acceptance tests come first, in `tests/acceptance/<issue>/`, written by a job that sees only the issue, the design and the base commit, with the issue's expected values, through surfaces those name. That job is you. Nobody has implemented the issue. Do not look for an implementation, and do not keep one you write.

## Where you work
- Your worktree: `<blind worktree>`, detached at the base commit `9ae04c6cd980f3c37fc64bcf5938b5169e1e7c52` (origin/main). Check `git rev-parse HEAD` first.
- Work only inside that worktree and temp folders of your own. Never read, write or run git against `<work worktree>` (the implementer's worktree), `<main checkout>`, or any other checkout or worktree of this repository.
- Do not commit, push, tag, stash, or open anything on GitHub. Leave your suite as untracked files. At the end `git status --short` must show only `tests/acceptance/1835/`.
- `npm ci` once in your worktree if `node_modules` is missing (`scripts/proof-change.mjs` and `scripts/affected.mjs` import `typescript`). cargo, if you need it, is at `/opt/homebrew/opt/rustup/bin`.
- The Mac is shared and heavily loaded (1-minute load about 300 on 18 cores). Never kill a process by name or port, only by the PID of one you started. No `git stash`.

## Your sources (and only these)
- The issue body, saved verbatim at `<scratch>/issue-1835.md`. Its dependency #1116 is closed; you may read #1116, #1874, #1981 and #1331 (closed issues whose code the base holds) and the epic #1324 with `gh issue view <n> --repo windoliver/deepbuild`. Read issue bodies only: no pull requests, no branches other than your base.
- `docs/parallel-proof.md`: sections 10, 10a (its last paragraph defines a lane's evidence record), 11, 12, 12a and 12b. `docs/technical-design.md`: "How we know version 0 works" (Criteria to tests, both ways; Criteria in a checked shape; Wrong programs; The edit guard; Dogfooding) and the "Landing in turn" bullet.
- AGENTS.md.
- The base commit's code and tests.

## What to write
`tests/acceptance/1835/`, in the shape of `tests/acceptance/1116/`, `1874/` and `1981/` (read all three with their READMEs; 1874's README is the closest model):
- `README.md`: your sources, the run command, "The surface" (each choice you make where the issue leaves something open), a criteria-to-tests table with each criterion's ID, the scene, the wrong programs, "Readings where the issue leaves a choice", known limits, "What the implementer adds outside this folder", files.
- Test file(s) run with `node --test`, one test per criterion unless a criterion truly needs two. Each test's name starts with its criterion's ID, `#1835.<h8>`, as `criterionId` in `scripts/proof-change.mjs` computes it from the `- [ ]` line's text.
- `helpers.mjs` for what is new. Import other suites' helpers unchanged (never edit a file outside your folder).
- `twins.json` and `twins/`: the planted wrong programs. AC1 names one: "a planted landing that ticks every line", which must fail AC1's test naming the third criterion. Every test must fail at an assertion (an AssertionError) on a wrong program: the base where the base is wrong, a twin otherwise. Read `tests/acceptance/1116/twins/README.md`, `twins.json` in 1116/1874/1981 and `scripts/proof-runs.mjs` for how a twin overlays the tree and how the before lane counts a failure.
- `BASE-FAILURE.txt`: the run on the base and each twin's run, with loads and times, as 1874's and 1981's have.

Method, as the earlier suites did: write a throwaway implementation only to show a right program can pass your tests and to derive the twins from it, then delete it and restore every file outside your folder. Run each test file once when it is done; don't rerun files that passed, and don't run neighbouring suites. Use generous timeouts such as 1874's `SLOW` and `WINDOW_MS`. Keep the suite lean and at the level of the scripts where the criteria allow, as 1116, 1874 and 1981 are: one shared scene if you can.

## Facts of the base (not of any implementation; verify each as you read)
1. Nothing at the base edits an issue's ticks. `scripts/budget-window.mjs` closes an issue only when its body has a `### Acceptance criteria` section, at least one line under it is unticked, and a task that ran names each unticked line (`unticked`, `close`); the unticked criteria no task names go in the commit's record as `unmeasured`. Its close comment names the commit. It reads issues with `gh issue view <n> --json state,body` and closes with `gh issue close <n> --comment …`.
2. Criterion IDs. `criterionId` (in `scripts/proof-change.mjs` and again in `scripts/budget-window.mjs`) is `#<issue>.<first 8 hex of the SHA-256 of the checkbox line's text, trimmed, white space collapsed>`. The trace lane's `readIssue` reads `- [ ]`, `- [x]` and `- [X]` lines alike under `### Acceptance criteria`, and the trace lane FAILs a test tag that names no criterion of the issue. The window's `unticked` reads only `- [ ]` lines. So any text added to a criterion's own line changes that criterion's ID for both readers. Weigh that when you decide what "each naming the lane's record" has to look like in the body.
3. The trace lane is `node scripts/proof.mjs trace`, run from the checkout with its cwd at the repository it proves (`scripts/proof.mjs`, `proof-change.mjs`, `proof-runs.mjs`). On a `Part of #n` change it prints `PASS trace: Part of #n; open: <ids>`. At the base it writes no evidence record of its own. It reads the issue's body from `$DEEP_PROOF_ISSUES/<n>.md` when that variable is set, else from `gh issue view <n> --json body -q .body`. A criterion counts as proven only when a tagged test ran on the change, passed, wasn't skipped, and failed at an assertion on the merge base or on a twin.
4. Evidence records. `writeRecord(lane, state, tree, tests, more)` in `scripts/lanes.mjs` writes `~/.deepbuild/lanes/<tree>-<lane>.json` in the shape section 10a gives: `{ lane, state, host, platform, tree, tests: [{ id, state, note? }], ...more }`; `exactTree(cwd)` is the tree hash of what is on disk. `runLanes` writes one for the preflight's `proof` lane as a whole, and as far as I read it that record's `tests` list is empty, since `proof.mjs` is not a reported test runner. The window writes one per commit with `commit`, `base`, `unmeasured` and `notReached` added.
5. What sees a landing at the base. The issue doesn't say which program ticks, or what runs "when a change lands"; that is a surface for you to choose and state, the smallest that makes both criteria observable, preferring one the issue, section 12a or the base already names.
   - The window (`node scripts/throttle.mjs window`, section 12a) walks every commit on the first-parent line of `origin/main` since its mark; `sides()` gives a merge's branch tip and merge base, and `issuesOf` reads `Part of #n` from the merge commit's and the branch commits' messages. It runs on a reference Mac, in a checkout of main no session works in. Agents never run it.
   - `node scripts/main-watch.mjs tick` (section 12b) fetches main on the run's host and counts landings (commits on main's first-parent line); `issueOf(sha)` reads a landing's issue. Its suite is `tests/acceptance/1333/`.
   - The hub's `deep land` (`packages/hub/src/landing.ts`, #1331) lands a pull request through the forge's REST API; when only a budget window's requirement is open it turns the PR's `Closes` into `Part of`, leaves the issue open and comments. Its suite, `tests/acceptance/1331/`, needs the built workspace, a cargo build of deep-hook and a played forge over HTTP, and takes minutes per file on an idle machine.
   - Evidence records live under the home folder of the machine whose lanes ran.
6. Fixtures you can build on, unchanged: `tests/acceptance/1116/helpers.mjs` (sandboxed HOME, stand-in `gh` that knows `issue view/close/comment/create/edit` with `--body`, `-b` or `--body-file` and exits 1 on anything else, the Mac15,7 stand-ins and pinned load, the fixture repository with `origin`, `work` and `mac`, `fullWindow`, `marked`, `recordOf`, `issue`, `dump`), `tests/acceptance/1874/helpers.mjs` (`fileBody`, `criterionId`, `unticked`, `nameCriteria`, `SLOW`, `WINDOW_MS`), `tests/acceptance/1981/helpers.mjs`, and `tests/acceptance/569/helpers.mjs` with `569/trace.test.mjs` (a scratch repository on which the real proof lanes run, with `DEEP_PROOF_ISSUES`; its first test is a three-criterion issue whose tests prove two). If you need a `gh` call the stand-in lacks, write your own stand-in in your helpers.
7. A fixture checkout with no `node_modules` can't load the window's task selection, so the window prints a NOTE and runs every task there; with one fixture task that changes nothing.
8. The guard (`scripts/proof-guard.mjs`, `LANES_CODE`) lists the scripts whose edits need a signed approval; section 10 says each new tooling script that decides a verdict joins that list. No criterion of #1835 asks for a guard test.

## Rules for the files you write
- Never name a third-party product the project only studied, in any file (a public-text lane fails on it). Say "an upstream tool" if you must.
- No secrets or personal data. Made-up issue numbers from 9601 up.
- Assert only what the issue states, through the surface you state. Where you had to choose, say so in "The surface", so a dispute can start there.

## Report back (under 400 words)
The surface you chose: the exact command or program a test runs as "the landing", where the trace lane's record is and its shape, and how a ticked line names the record. The two criterion IDs. The base run's result per test. Each twin and the test it fails. The exact command to run the suite, and its wall time at the load you saw. What the implementer must add outside your folder. Anything you could not settle.
