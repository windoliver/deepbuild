# Acceptance tests for #3466: the hub keeps the spec revision you approved

An approved change to a repo's `.deepbuild/done.yaml` counts before it is committed, reaches every worktree of the
repo, outlasts the hub's process and is never proposed again; a later write or commit changes no check.

Written first and blind, at base commit `8feb93630b60d18c55d551e8b07554d51049e497` ("Merge pull request #3577 from
windoliver/feat/1047-playtests-from-save"), from issue #3466 as saved for this job (title, labels, milestone and body:
its opening paragraph, Scope, five acceptance criteria and Proof; it has no comments), the design and the base, before
any implementation. The job saw no fix, diff, other branch, other worktree or pull request.

The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

**Redrafted once, on one point**, by the same blind job with one more input: the repository owner's ruling on a
question the first draft had reported and left open. After the approval, the claim in the second worktree leaves no
proposal naming `.deepbuild/done.yaml` either: that worktree's own file is the change you approved waiting for its
commit to arrive, never a difference to propose again (criterion 2 and the issue's title cover it; the Scope's fourth
line stays for what criterion 4 names). The redraft added one test, `second-worktree.test.ts`, tagged
`#3466.8e1d6afc`, and its twin's name. No other test file's bytes changed, nor `helpers.ts`'s.

**What has run.** Each test file once on the base, and one scratch file there, since deleted (`BASE-FAILURE.txt`). On
the base the first draft's tests of criteria 1 to 4 fail, each at an `expect` of its own for the reason its criterion
names, and criterion 5's passes. The redraft's test is BLOCKED on the base, as it should be: the base keeps no
revision, so what it doesn't propose there proves nothing (The wrong programs). Every test file ran as written: none
was changed after its run. No implementation existed, so no test has run on one, and no twin is planted: what that
leaves untried is under "What ran only on the base".

## What was read

- The issue, and the issues it names only for the words it cites: #1864 (Scope and criteria), #1998, #322, #333, #33,
  #1360, its epic #3 and #3462.
- `AGENTS.md`, `CONTRIBUTING.md` and `docs/technical-design.md`: How runs become one of five verdicts (the table,
  Pinned to a commit, Carried across sessions, Whose checks count, Protection); First-party extensions that ship on
  by default (the done-gate, spec-draft and checks-command rows, and the `.deepbuild/done.yaml` example); Threats,
  What a command's children do; and, in How we know version 0 works, Criteria to tests, Criteria in a checked shape,
  Wrong programs, Dogfooding and Built to be hard to get wrong. `docs/parallel-proof.md`, A suite's own lane file.
- The base's code, only to learn what a call takes and returns and what the base does today: in `packages/hub/src/`,
  `approved-spec.ts`, `spec-checks.ts`, `stop-judging.ts` (`runClaim`, `claimScope`, `proposeSpecDrift`,
  `projectTrusted`, `judged`), `box.ts`, `hub-control.ts` (`box.say`), `core.ts` (the box's wiring, the gate's
  slots), `ask-tasks.ts` (a prompt's task, the handed definition's lock and its base commit, a stop's claim),
  `gate-runner.ts` (lanes, results carried within and across sessions, the slow lane), `runs.ts` (`run.started`),
  `inbox.ts`; `packages/asks/src/index.ts` (an ask's handle, `plan.proposed`); `packages/record/src/trust.ts`;
  `packages/gate/src/floor.ts` (the validity gate); `packages/verdicts/src/record.ts` (`verdict.made`);
  `packages/checks-command/src/controls.ts`; and `scripts/proof-runs.mjs` (twins, a failure at its assertion),
  `scripts/wait-ratchet.mjs`, `scripts/lanes.mjs` (lane files).
- Sibling suites: `tests/acceptance/322/helpers.ts` (the world, the hub, the session and the record's readers,
  imported here), `1864/` (its helpers' readers of a claim, imported here; its README, test and `BASE-FAILURE.txt`),
  `1998/` (`helpers.ts`, `spec.test.ts`, README: the box's method and the approval), `352/` (worktrees of one repo,
  each trusted, and a hub stopped and started on one home), `33/bootstrap.test.ts`, `3461/` (twins),
  `2513-redraft-2047/` (a criterion that other suites pass unchanged).

## The surface

The tests reach DeepBuild only through these. Nothing is copied or mocked, and no file of the code under test is
imported:

- `.deepbuild/done.yaml` in a fixture repository and git: its commits, a second worktree (`git worktree add`), the
  file on disk.
- `deep hub run` (`packages/cli/dist/main.js`) on a temporary home, started, stopped and started again
  (#322's `startHub` and `stopHub`), with the handed definition (`DEEP_HUB_TEST_DRAFTS`), the OS confirmation stood in
  (`DEEP_HUB_TEST_CONFIRM`) and each folder trusted by #348's decision (`trustRepo`). No `DEEP_HUB_PLANT`.
- The box, as #1998's suite reaches it: the hub's socket method `box.say` with `{ words, repo }`, which returns the
  proposed change's ask as `ask:<id>`.
- Your answer on the trusted path: `deep inbox answer <ask> apply` (#322's `answer`).
- deep-hook (`target/debug/deep-hook`), run as Claude Code runs our hook entries: SessionStart, UserPromptSubmit,
  PreToolUse and PostToolUse of a Read and of each Edit, and Stop (#322's `Session`, in the folder it works in).
- The record, through the hub's socket method `events.read`: `ask.created`, `user.ask`, `definition.locked` (its
  `base_commit`), `claim.made`, `run.started` (its `claim`, `check` and `command`), `run.finished` (its `outcome`),
  `verdict.made` (its `outcome`) and every `*.proposed` event.

The suite needs no name the base lacks: no new method, event kind, file or table. Where the hub keeps the revision
is the implementation's.

## The scenario

Every test is one world: #322's (`makeWorld`), with its repository's folder renamed `shop` before anything reads it,
since the box finds the repo your words name by its checkout's top folder. The repo has one commit on `main`:

- `.deepbuild/done.yaml`, **the committed spec**:

  ```yaml
  claims:
    done:
      checks: [lint, typecheck, unit]
  checks:
    lint: { type: command, run: "node --test tests/lint.test.js" }
    typecheck: { type: command, run: "node --test tests/types.test.js" }
    unit: { type: command, run: "node --test tests/unit.test.js" }
  ```

- `tests/lint.test.js`, `tests/types.test.js`, `tests/unit.test.js`: one node:test each, which passes on the base
  commit and on every session's work, and loads `src/auth.js`.
- `src/auth.js` (#322's) and the drafted check `.deepbuild/checks/says-rejects.sh` with its test, as #1864's suite
  has them.

The repo's folder is trusted by the core's decision (#348), made before the hub starts. Then the hub starts.

**The approval** (`approve`): `box.say` is called with the words "stop checking lint in shop" and the checkout's path,
and the ask it returns is answered `apply` with `deep inbox answer`. The step ends once the checkout's file no longer
lists `lint` in the `done` claim and still lists `typecheck` and `unit`. It is BLOCKED when the box drafts no change,
writes before the answer, the answer is refused, or the written file isn't left uncommitted with HEAD still holding
the committed spec. `approved.at` is the log's last position at that point: "after that approval" is every event
past it. The box's own `plan.proposed`, which names the file it will write, comes before it.

**The next claim** (`nextClaim`) is always a new Claude Code session's first stop, in the folder named: it starts,
types #322's prompt, Reads `src/auth.js`, the handed definition locks (one requirement, R1, judged by the drafted
check), it edits `src/auth.js` through its hooks and stops saying "Done.". Its task is new, so its definition's base
commit is the folder's HEAD when it locked; the helper reads that from `definition.locked` and is BLOCKED when the two
differ. The session's edits are #322's `FLAG` where the file doesn't hold it yet, which makes R1's check pass, and
`checkToken`'s bound set to the claim's own number. So `src/auth.js` is as no earlier claim had it, and since every
check loads that file, no result carries from an earlier claim (design: Carried across sessions): each claim starts
runs of its own, which is what the tests read. Commits in a test hold the spec file alone, so `src/auth.js` stays
uncommitted and R1's check fails on every claim's base commit.

The claim is read from the record once judged: at its PASS, which is made only when nothing is pending; or, for any
other verdict, once every run started for it has ended. Both are events; no test waits for time to pass. Each wait has
a bound (180 s for a lock, 900 s for a claim, 120 s for the approval, 60 s for a proposal) passed to #322's `settle`.

**Reading a claim's checks.** A run of `lint` on the claim fails the test whatever the verdict. That a check has no
run means the claim was not judged on it only when the claim passed: nothing passes while a check is pending, and a
check that never started leaves no run. So `whole` stops a test whose claim didn't pass (BLOCKED, or INCONCLUSIVE
under load) before it reads an absence as proof, or a missing run of `typecheck` or `unit` as a failure.

| Criterion | File | After the approval | The next claims |
|---|---|---|---|
| 1 | `uncommitted.test.ts` | the written file stays uncommitted | one in the checkout, one in a second worktree made from the same commit before the hub started (`git worktree add`, branch `second`, trusted as its own folder) |
| 2 | `no-proposal.test.ts` | — | one while the file is uncommitted; then the file is committed as written, and one from that commit |
| 2 | `second-worktree.test.ts` | the written file stays uncommitted | one in a second worktree, made and trusted as criterion 1's; none in the checkout |
| 3 | `restart.test.ts` | the hub is stopped and another started on the same home; no claim was made before | one in the checkout |
| 4 | `put-back.test.ts` | the file is committed as written | the committed spec's bytes are written back on disk with no hook fired, and one claim from the commit that holds the approved file; then that file is committed, and one claim from that commit |
| 5 | `no-kept-revision.test.ts` | no approval at all | `lint` is taken out of the `done` claim on disk with no hook fired, and one claim in the checkout |

## Criteria to tests

One test per criterion, and a second for criterion 2 from the redraft, each in a file of its own, each carrying its
ID at the start of its name and its `describe`'s. IDs are `criterionId` of `scripts/proof-change.mjs` on the issue's
body.

| Criterion | What the test asserts, in order | What fails it |
|---|---|---|
| `#3466.45462705` `uncommitted.test.ts` | For the claim in the checkout, then for the claim in the second worktree: 1. no `run.started` of the claim has `check` `lint`; 2. (the claim passed, else BLOCKED) `typecheck`, then `unit`, has a run on the claim. Guards before each: the approved file is on disk in the checkout, uncommitted and without `lint`; the second worktree's own file lists `lint`; the claim's base commit is the repo's one commit, whose spec lists `lint` | The merge base, at 1 for the checkout's claim: it reads the claim's spec from its base commit and runs `lint`. The message names `lint`, its run and the command it ran. A gate that reads the worktree's file fails at 1 for the second worktree. A hub that runs no spec check once a revision is kept fails at 2 |
| `#3466.8e1d6afc` `no-proposal.test.ts` | 1. once the claim made while the file is uncommitted is judged, no `*.proposed` event recorded after the approval names `.deepbuild/done.yaml`; 2. the same once the claim made from the commit that holds the file as written is judged | The merge base, at 1: the written file differs from the claim's base commit's, and it records `learn.proposed` with `target` `.deepbuild/done.yaml`. The message lists each such proposal: its kind, log position and data |
| `#3466.8e1d6afc` `second-worktree.test.ts` (the redraft) | On the next claim in the second worktree, once judged: 1. no `*.proposed` event recorded after the approval names `.deepbuild/done.yaml`. Then, as guards, that the claim was judged on the revision you approved, as criterion 1 reads it: no run of `lint`, the claim passed, and `typecheck` and `unit` each have a run; else BLOCKED. Guards before 1: the approved file is on disk in the checkout as written, uncommitted; the second worktree's own file is the committed spec, which lists `lint`; the claim's base commit is the repo's one commit | The twin `stale-worktree-proposed`, at 1. The message lists the proposal: its kind, log position and data. Not the merge base: it keeps no revision, judges the claim on its base commit's spec, which the worktree's file equals, and so has nothing to propose there; the test is BLOCKED on it at the `lint` guard, never a pass |
| `#3466.13da4cdd` `restart.test.ts` | On the claim made after the stop and the start: 1. no run of `lint`; 2. (the claim passed, else BLOCKED) a run of `typecheck`, then of `unit`. Guards: the claim was read from a hub with another process ID than the stopped one, which is no longer alive; the approved file is on disk as written, uncommitted; the claim's base commit lists `lint` | The merge base, at 1. A hub that keeps the revision only in memory, at 1: after the start it has none, and the base commit's spec runs `lint` again. The message names `lint` and both process IDs |
| `#3466.e6689637` `put-back.test.ts` | After the write: 1. no run of `lint` on the claim from the commit that holds the approved file; 2. (passed) runs of `typecheck` and `unit`; 3. exactly one `*.proposed` event recorded after the approval names the file, read for up to 60 s. After the commit: 4. no run of `lint` on the claim from that commit; 5. (passed) runs of `typecheck` and `unit`; 6. still exactly one such proposal | A gate that takes the worktree's file once a revision is kept, at 1. A gate that takes the base commit's file, at 4: the merge base fails there, since at 1 its claim's base commit holds the approved file. Each message names `lint`. A hub that proposes nothing fails at 3; one that proposes the commit again, at 6 |
| `#3466.dc3e4e56` `no-kept-revision.test.ts`, and the suites below run unchanged | 1. `lint`, `typecheck` and `unit` each have a run on the claim (a check with no run on a claim that didn't pass is BLOCKED); 2. a `*.proposed` event after the write names the file, read for up to 60 s | Passes on the merge base. Fails at 1 on the twin `worktree-file-while-none-kept`, naming `lint` |

**Criterion 5** is about tests that exist: "#1864's three tests pass unchanged, and so does #33's criterion that this
repo is gated on its bootstrap spec alone". Its proof is those tests, run by the implementer on the change with no
file of theirs changed against the merge base:

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1864 --no-file-parallelism approved-revision.test.ts
node node_modules/vitest/vitest.mjs run --root tests/acceptance/33 --no-file-parallelism bootstrap.test.ts
git diff --stat <merge base> -- tests/acceptance/1864 tests/acceptance/33 tests/acceptance/322   # prints nothing
```

(`33/bootstrap.test.ts` holds the three tests of `#33.6932417b`; #1864's file and #33's helpers import #322's.) This
suite neither copies nor runs them. `no-kept-revision.test.ts` carries the criterion's ID so the trace lane has a
tagged test that fails on a wrong program: it holds the rule both suites rest on, that a repo with no kept revision is
judged on its claim's base commit's spec, in this suite's own fixture, with the file state criterion 1 reaches by
approval reached here by nobody's.

## The wrong programs

**The merge base** is the wrong program of a fix (design: Wrong programs; the issue's Proof). It reads a claim's spec
from the claim's base commit and records a proposal when the folder's file differs from it. On its one run of each
file (`BASE-FAILURE.txt`), every failure an `AssertionError` whose innermost frame is in the test's own file:

- criterion 1 fails at its first assertion (`uncommitted.test.ts:40`): the checkout's claim, which passed, has a run
  of `lint`, named with its run and `node --test tests/lint.test.js`;
- criterion 2 fails at its first assertion (`no-proposal.test.ts:31`): `learn.proposed` with `target`
  `.deepbuild/done.yaml`, recorded after the approval, shown with its log position and data;
- criterion 2's second test, the redraft's, is BLOCKED (`second-worktree.test.ts:48`), as it should be. The base
  judged the second worktree's claim on its base commit's spec: `lint` ran, and the claim passed. The worktree's own
  file equals that spec, so the base had no difference to propose, and its `expect` of no proposal held for a reason
  that isn't the criterion's. The guard after it reads that as proving nothing. The base can't be this test's wrong
  program; its twin is (below);
- criterion 3 fails at its first assertion (`restart.test.ts:35`): `lint` ran again on the claim a new hub process
  judged, both process IDs in the message;
- criterion 4 passes its steps for the write (the claim's base commit holds the approved file, so no `lint`; the claim
  passed with `typecheck` and `unit`; the base proposes the difference on disk once) and fails at step 4
  (`put-back.test.ts:28`, called at line 58): the claim from the commit that puts `lint` back has a run of `lint`;
- criterion 5 passes, as it should: the base keeps no revision, so the base commit's spec is all it has.

The base is at once "a gate that reads the spec from the claim's base commit" (criterion 1), "a hub that proposes the
change you approved" (criterion 2) and "a gate that takes the base commit's file once a revision is kept"
(criterion 4).

**Planted twins**, for the wrong programs the base is not. They are laid over the implementation's files, so the
implementer adds them once the work exists: `twins/<name>/lines.json` for each, and `twins.json` beside this README.
Each twin is the merged implementation with the one rule below broken and nothing else changed.

| Twin | What it does | Test that must fail on it | The failure names |
|---|---|---|---|
| `kept-in-memory` | The hub keeps the revision an approval sets in its running process only: a hub that starts reads none back, so a repo whose revision was set before the start has no kept revision, and its claim's base commit's spec stands in | `restart.test.ts`, at "no run of lint" on the claim after the stop and start | `lint`, its run and command, and the two hubs' process IDs |
| `worktree-file-once-kept` | For a repo with a kept revision, a claim's spec is the file in the claim's folder (`<folder>/.deepbuild/done.yaml`), not the kept revision | `put-back.test.ts`, at "no run of lint" on the claim after the write (step 1). `uncommitted.test.ts` fails on it too, at the second worktree's claim | `lint`, its run and command |
| `worktree-file-while-none-kept` | For a repo with no kept revision, a claim's spec is the file in the claim's folder, not the one its base commit holds | `no-kept-revision.test.ts`, at step 1 | `lint`: "No run of lint" |
| `stale-worktree-proposed` (the redraft's) | For a repo with a kept revision, the hub judges each claim on that revision and records a proposal naming `.deepbuild/done.yaml` whenever the file in the claim's folder differs from it, the file the approved change was made on included: a worktree the approval's commit hasn't reached is proposed | `second-worktree.test.ts`, at its `expect` of no proposal (step 1). `no-proposal.test.ts` passes on it: there the folder's file is the kept revision | The proposal: its kind, its log position and its data, which holds the file's path |

```json
{
  "#3466.8e1d6afc": ["stale-worktree-proposed"],
  "#3466.13da4cdd": ["kept-in-memory"],
  "#3466.e6689637": ["worktree-file-once-kept"],
  "#3466.dc3e4e56": ["worktree-file-while-none-kept"]
}
```

`worktree-file-while-none-kept` is #1864's own wrong program, so #1864's three tests fail on it as well.
`stale-worktree-proposed` is listed under criterion 2's ID, which `no-proposal.test.ts` carries too; that test is
proven by the merge base and needs no twin. No twin is chosen by an environment variable, and no test here sets
`DEEP_HUB_PLANT`. This job planted nothing: there was no implementation to plant in.

## What ran only on the base

No implementation existed, so the base is the only program the tests ran on. Each test of criteria 1 to 4 stops at
the first assertion that tells the two programs apart, so these ran on no program as assertions: criterion 1's
`typecheck` and `unit` reads and its whole second-worktree half; criterion 2's read after the commit; criterion 3's
`typecheck` and `unit` reads; criterion 4's steps 5 and 6. Criterion 5's test passed whole. No twin was run.

The redraft's test ran once on the base, to its `lint` guard. Its `expect` of no proposal ran there and held, for the
base's own reason (The wrong programs), so on no program has that `expect` failed, and on none has the test passed:
its proof waits for the work and for `stale-worktree-proposed`. Every step before the guard ran cleanly on the base:
the second worktree's session alone, with no claim in the checkout before it, made a claim that passed.

So that each of those steps is known to run cleanly where it needs no new code, this job ran them once on the base in
a scratch file, deleted since, that drove `helpers.ts` and asserted only what the base does (`BASE-FAILURE.txt`, its
last part):

- With the approved file uncommitted in the checkout, the claim in the checkout and then the claim in the second
  worktree both passed, each with runs of its own of `lint`, `typecheck` and `unit`. No spec check's result was
  carried from the first claim to the second, which is what the scenario's "inputs no earlier claim had" is for. The
  second worktree's own file still listed `lint`, and the checkout's file was still uncommitted.
- With the approved file committed as written and `lint` put back on disk, the claim from that commit passed with no
  run of `lint` and one proposal; with that file committed, the claim from that commit passed with a run of `lint`,
  and the record still held that one proposal. So criterion 4's last count is 1 on the base too, and only its runs
  tell the base from the work.

The stop and start needed no scratch run: criterion 3's own test reached it on the base, where the second hub, a new
process, judged the claim to a PASS.

Criterion 2's step after the commit did not run as such on any program: a claim made from the commit that holds the
file as written, with the file on disk as committed. Its parts ran on the base: that commit and its guard (criterion
4's test), a commit of the spec alone after a session's work, and a second session's claim in the same checkout from
such a commit (the scratch run). This job judged a third scratch scenario not worth another turn of the machine's
test slot.

In those runs eight worlds made eleven claims on the base. The nine whose verdict the output shows passed; criterion
4's first passed too, or its test would have stopped BLOCKED at `whole`; criterion 5's had a run of each check, and
its verdict isn't in the output.

## Readings where the issue and the design leave a choice

Each is taken as small as its criterion needs.

- **"The next claim"** is the first claim a new session makes in the folder after the step before it. A new session
  opens a new task, whose base commit is the folder's HEAD then. So after a commit, the next claim's base commit is
  that commit, which is what makes criterion 4's "base commit's file" bite. No test makes a second claim in one
  session.
- **"Have a run of"** is a `run.started` event of the claim whose `check` is the name the spec gives, as #1864's
  helpers read it. A result carried from another claim has no such event, so the scenario gives each claim inputs no
  earlier claim had. A run counts whether or not it has ended.
- **"None of `lint`"** is no such event, read on a claim that passed (The scenario, Reading a claim's checks). The
  tests do not assert that a claim passes: a claim that doesn't is BLOCKED or INCONCLUSIVE here, never a failure of
  the criterion and never a pass.
- **"A second worktree of the repo"** is a `git worktree add` folder from the same commit, on a branch of its own,
  made before the approval and trusted by its own decision: #348's trust is one decision for each folder, and the
  issue doesn't say an approval or a trust spreads to a worktree. Its own file still lists `lint` (a guard), so only
  the kept revision can take `lint` out of its claim.
- **"After that approval"** is every event recorded after the written file reached the disk. The box's `plan.proposed`
  for the change itself names the file and comes before it.
- **"No proposal names `.deepbuild/done.yaml`"** is no event whose kind ends in `.proposed` and whose data holds that
  path (#322's `proposalsNaming`), read once the claim is judged. On the base the proposal is recorded when the claim
  starts, long before its verdict. A hub that proposed after the verdict would be missed.
- **"Before the file is committed and after it is committed as written"** is one claim in each state. The second is
  made by a session whose task starts from the commit, so the worktree, HEAD and the claim's base commit all hold the
  revision you approved. The commit holds the spec file alone.
- **The second worktree, by the owner's ruling** (the redraft's one input beyond the issue): after the approval, the
  claim in the second worktree leaves no proposal naming the file either. Criterion 2's "after that approval no
  proposal names `.deepbuild/done.yaml`" and the title's "reaches every worktree and is never proposed again" cover
  it: that worktree's own file is the change you approved waiting for its commit to arrive, never a difference to
  propose again. The Scope's fourth line stays for what criterion 4 names, a write or a later commit that takes the
  kept revision out. `second-worktree.test.ts` reads it in the state criterion 1 names, the written file uncommitted,
  on the second worktree's claim alone: no claim is made in the checkout first, so the proposals read are that
  claim's. Its own file is the committed spec, byte for byte (a guard).
- **"No proposal" where nothing could be proposed** proves nothing. A hub that keeps no revision judges the second
  worktree's claim on its base commit's spec, which the worktree's file equals, and has no difference there. So
  `second-worktree.test.ts` counts the absence only on a claim judged on the revision you approved, read as
  criterion 1 reads it (no run of `lint`, the claim passed, runs of `typecheck` and `unit`), and is BLOCKED
  otherwise. That is a guard, not a second assertion of criterion 1, which `uncommitted.test.ts` holds: a gate that
  runs `lint` there fails that test, and stops this one without a verdict on its criterion.
- **"With a revision kept"** (criterion 4) is after the approval, with the written file committed first. That commit
  isn't in the criterion; it is what lets the write restore the first commit's bytes and still be a change to commit,
  and it makes the two steps tell the two wrong programs apart: after the write only the worktree's file lists `lint`,
  after the commit the claim's base commit lists it too.
- **"A write the guard didn't recognize"** is a change made on disk with no hook fired for it, as in #1864's suite. It
  is made before the session that makes the next claim starts.
- **"Puts `lint` back"** is the first commit's bytes. **"A later commit that does the same"** commits that file as the
  disk holds it.
- **"One proposal names the file"** is exactly one such event since the approval, after the write's claim (read for
  up to 60 s) and still exactly one once the commit's claim is judged. The commit holds the bytes the write made, so
  it is one difference, proposed once (Scope: "once per difference"). An implementation that proposes the worktree's
  difference and the base commit's separately fails step 6; if "one" was meant as "at least one", that step is the one
  to dispute.
- **"Judged on the same kept revision"** (criterion 3) is criterion 1's reading on the claim after the stop and start:
  runs of `typecheck` and `unit`, none of `lint`. No claim is made before the stop.
- **Criterion 5** is read as the two suites run unchanged, plus one tagged test of the rule they rest on (above).

## What isn't asserted, because no criterion says so

- **The second worktree once the approved file is committed.** The first draft left the second worktree's proposals
  unasserted, as a place where the Scope's fourth line and criterion 2 seemed to pull apart, and reported it. The
  owner settled it, and `second-worktree.test.ts` now asserts it while the written file is uncommitted. Not driven:
  the second worktree's claim after the file is committed as written in the checkout, with the worktree still on the
  commit before it; and the same claim after a claim in the checkout. The ruling's words cover both ("waiting for its
  commit to arrive"); the redraft was asked to be as small as it could be, and the twin's rule fails all three alike.
- **A base commit that holds the pre-approval spec.** Criterion 2 has such a claim raise nothing. Whether a base
  commit that differs in another way is proposed on its own is read only through criterion 4's count.
- **Release checks and the `outside` block** from the kept revision (Scope, second line): no criterion names them, and
  no session here opens a pull request.
- **That a claim passes, the verdict's words, the stop's reply, and what a proposal says.**
- **Where and how the revision is kept**, and its digest.
- **#333's approval of a draft**, `deep spec`, what approving a difference's proposal does, and a hub shared by
  several people: the Scope's last line puts them out of this task.
- **A second approval** on top of a kept revision, and a kept revision in one repo beside another repo with none.
- **Linux.** The suite ran on macOS only.

## How to run

With Node 24.22.0 (`.node-version`) and the pinned toolchain's `cargo` on `PATH`:

```sh
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
node node_modules/vitest/vitest.mjs run --root tests/acceptance/3466 --no-file-parallelism --reporter=verbose
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/3466/tsconfig.json
```

- The tests build nothing: a missing build is BLOCKED, naming the command.
- Every test starts hubs of its own. Each makes its folders under `/tmp/dh322-*`, sets `HOME` there for every process
  it starts, and never touches the real `~/.deepbuild` or `~/.claude`. It stops only processes it started, by PID
  (#322's `cleanup`). No network, no model. Fixtures use synthetic identities only.
- The hub runs each check in the platform sandbox, so the shell that runs the suite must not be sandboxed itself
  (macOS can't nest Seatbelt).
- **Alone.** `lane.json` puts the folder on the unit lane's `alone` list: its hubs' supervisor reads the system's one
  sandbox log stream.
- **Load.** A definition that didn't lock within 180 s, a stop that made no claim, a claim with no verdict 900 s after
  its stop and a claim that didn't pass are INCONCLUSIVE when the 1-minute load is past the core count, and BLOCKED
  otherwise: a failure whose message starts with that word, never a pass. One cause to expect: each run of a check
  appends a control test to every test file of the claim's checkout and takes it out when it ends, and a claim's
  checks run side by side there. A run whose test file is loaded after another run took its control out finds its
  own control at another line, and its check is INVALID ("the report can't record a failure"), as in the first test
  of #1864's recorded run on its base. Such a claim doesn't pass, so its test here ends INCONCLUSIVE or BLOCKED; run
  the file again. It wasn't seen in this suite's runs on the base: every claim whose verdict the output shows
  passed, and the one test that ended BLOCKED there, the redraft's, did so at its own guard, by design.
- **Time.** On the base each of the first five files took under 6 s, most of them stopping at their first claim, and
  the redraft's, one claim, under 8 s at a 1-minute load of 53; the scratch file's two scenarios, two claims each,
  took 5 to 6 s each, on 18 cores at a 1-minute load of 16 when they ended.

## What the implementer adds

- In this folder: the four twins and `twins.json` (The wrong programs). Nothing else here changes.
- Outside this folder: nothing. `lane.json` is read by `scripts/lanes.mjs` as it stands; the suite has no fixed wait
  for `scripts/wait-ceilings.json`, no timed file and no listed failure.

## Not this issue's, noticed while reading

- The control race under Load is the base's, in `packages/checks-command/src/controls.ts`: `removeControls` shifts
  the lines of the controls other runs planted later in the same file.
- `node scripts/wait-ratchet.mjs` fails on the base on files that aren't this suite's; it names no file of this folder.

## Files

- `helpers.ts`: the fixture and its spec, the world (`openShop`), the approval (`approve`), the stop and start
  (`restart`), the write no hook sees (`writeBehindHooks`), the commit (`commitSpec`), the next claim (`nextClaim`),
  the reading of a claim (`whole`) and of proposals. It imports #322's world, hub, session and readers, and #1864's
  shape of a claim; nothing in it stands in for DeepBuild.
- `uncommitted.test.ts`, `no-proposal.test.ts`, `restart.test.ts`, `put-back.test.ts`, `no-kept-revision.test.ts`: one
  criterion each, in the issue's order.
- `second-worktree.test.ts`: the redraft's test, criterion 2 in the second worktree.
- `lane.json`: the folder runs alone.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run of each file on the base commit and the scratch run there, each trimmed to its failing
  assertion or its lines, the repo's path written `<repo>`.
