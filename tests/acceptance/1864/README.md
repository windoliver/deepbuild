# Acceptance tests for #1864: the gate runs spec checks from the approved revision of done.yaml

Written first and blind, at base commit `0fffd8fcfd8eb56f7224a950cafef81cd909ff67` ("Merge pull request #3167 from
windoliver/claude/issue-1111-redraft-2047-b"), from issue #1864 as handed to this job (`updatedAt`
2026-11-09T22:20:15Z: its account of the bug, Scope, three acceptance criteria and Proof), the design and the base,
before any implementation. The job saw no fix, diff, other branch, other worktree or pull request.

The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding).

## What was read

- The issue, and nothing it links but the design.
- `AGENTS.md` and `docs/technical-design.md`: How runs become one of five verdicts (the table, Pinned to a commit,
  Whose checks count, Protection); the `.deepbuild/done.yaml` example and the done-gate, spec-draft and
  checks-command rows under First-party extensions; Threats, What a command's children do; and, in How we know
  version 0 works, the seeded false "done" cases, Dogfooding, Criteria to tests, Criteria in a checked shape, Wrong
  programs and The edit guard.
- The base's code, to learn how to drive it and what it does today: `packages/hub/src/core.ts` (`doneSpec`, which
  reads `<cwd>/.deepbuild/done.yaml`), `stop-judging.ts` (`runClaim`, `specChecks`, `runApproved`, `outsideOf`,
  `builtOutside`), `spec-checks.ts`, `mcp-operations.ts` (`checksOf`), `ask-tasks.ts` (the `learn.proposed` a drafted
  check changed after its lock becomes), `runs.ts` (what `run.started` records), `packages/checks-command/src/index.ts`
  (the grant a check's run gets) and `packages/supervisor/src/seatbelt.ts` and `supervisor.ts` (`sandbox.denied`); the
  schemas `run.started@4` and `sandbox.denied@2`; and this repo's own `.deepbuild/done.yaml`, for the form of an
  `outside` block.
- Sibling suites: `tests/acceptance/322/helpers.ts` (the world, the hub and the session, imported here),
  `322/approved-redraft.test.ts` and `322/guard.test.ts` (how a drafted check's proposal is read), and `2205/` (the
  form of a small suite, a README and a `BASE-FAILURE.txt`).

## The surface

The tests reach DeepBuild only through these, all by #322's helpers (`../322/helpers.ts`), nothing copied or mocked:

- `.deepbuild/done.yaml` in a fixture repo, the file the issue is about: committed on the repo's base commit, then
  changed in the session's worktree.
- `deep hub run` (`packages/cli/dist/main.js`) on a temporary home, with the handed definition
  (`DEEP_HUB_TEST_DRAFTS`) and the project trusted by #348's decision (`trustRepo`).
- deep-hook (`target/debug/deep-hook`), run as Claude Code runs our hook entries: SessionStart, UserPromptSubmit,
  PreToolUse and PostToolUse of a Read and of each Edit, and Stop.
- The record, through the hub's socket method `events.read`: `user.ask`, `definition.locked`, `claim.made`,
  `run.started` (its `check`, `command` and `withheld`), `run.finished` (its `outcome`), `verdict.made`, every
  `*.proposed` event and `sandbox.denied`.
- Two files in a temp folder outside every world, which only a process outside the gate's sandbox can write
  (criterion 3).

This folder's two TypeScript files import nothing of DeepBuild but `../322/helpers.ts`.

## The scenario

Each test is one world: #322's repo (`src/auth.js`, `tests/unit.test.js`, one commit on `main`), with the test's spec
as `.deepbuild/done.yaml` on that commit. No revision has been approved through #333's draft or a proposal, so by the
issue's Scope "the revision its claim's base commit holds stands in, never the worktree's": the committed file is the
kept revision. The repo is trusted. The handed definition has one requirement, R1 "The middleware says it rejects
expired tokens", judged by the drafted check `.deepbuild/checks/says-rejects.sh` (`node --test`, `on_base: fails`,
asserting line 5 of its test file).

The session types #322's prompt, Reads `src/auth.js`, and the definition locks. It then edits `src/auth.js` through
its hooks: #322's `FLAG` (`rejectsExpired: true`), which makes R1's check pass, and in criteria 2 and 3 also #322's
`FIX` (`checkToken` rejects a token whose exp has passed), which makes `unit` pass. So R1's check passes on every
claim, and what the spec checks do is the spec's alone.

Then the write: the test changes `.deepbuild/done.yaml` in the worktree with `node:fs`, and fires no PreToolUse and no
PostToolUse for it. That is "a write the guard didn't recognize" as a command's child makes one (design: What a
command's children do): no hook saw it. A write that didn't land is BLOCKED. The session stops saying "Done.", and the
claim that stop makes, the first `claim.made` after the write, is "the next claim". It is read from the record once
judged: a PASS at once; a FAIL once each check the test waits for has a finished run; any other verdict once every
started run has ended, each awaited check has a finished run and the claim's record has stood still for 30 s (180 s
when an awaited check has no run at all; at most 900 s).

| Criterion | `.deepbuild/done.yaml` on the base commit | Session's edits | The write |
|---|---|---|---|
| 1 | `claims: {done: {checks: [unit]}}`; `unit: { type: command, run: "node --test tests/unit.test.js" }` | `FLAG` | `unit`'s line becomes `run: "true"` |
| 2 | the same with `typecheck: { type: command, run: "node --test tests/types.test.js" }`, both on the done claim | `FLAG`, `FIX` | the file is deleted |
| 3 | as criterion 1; `tests/unit.test.js` has one more test, which asserts that writing `<temp>/reached` throws | `FLAG`, `FIX` | `outside:` with `checks: [unit]` and `build: "echo built > <temp>/built"` is appended |

## Criteria to tests

All in `approved-revision.test.ts`, one test per criterion, each carrying its ID literally in its name and its
`describe`'s. "On the base" is the one run in `BASE-FAILURE.txt`.

| Criterion | What the test asserts, in order | On the base |
|---|---|---|
| `#1864.c1fc5bdd` (run rewritten to `true`) | 1. no `*.proposed` event names `.deepbuild/done.yaml` before the write; 2. `unit` has a finished run on the next claim; 3. every finished run of `unit` on it ended `failed`; 4. no verdict on the claim is PASS; 5. a `*.proposed` event after the write names `.deepbuild/done.yaml` | fails at 3 (line 32): `unit ("true") uncounted`, expected `[ 'uncounted' ]` to equal `[]`; the message names `unit` and the command it ran |
| `#1864.0771441b` (file deleted) | 1. no proposal names the file before the write; 2. `unit`, then `typecheck`, each has a run on the next claim; 3. each has a finished run, and every finished run ended `passed`; 4. a `*.proposed` event after the write names `.deepbuild/done.yaml` | fails at 2 (line 45), on `unit`: verdict PASS on R1's check alone, no run of a spec check, `expected 0 to be greater than 0` |
| `#1864.5912e17b` (`outside` entry added) | 1. `<temp>/built` doesn't exist: no build ran; 2. `unit` has a finished run on the next claim; 3. `<temp>/reached` doesn't exist: no run of `unit` could write outside its checkout; 4. no `run.started` of `unit` on the claim has `outside` in `withheld`; 5. every finished run of `unit` ended `passed` (its test's write outside the checkout was refused); 6. a `sandbox.denied` of one of `unit`'s runs has `<temp>/reached` as its `target` | fails at 1 (line 63): the entry's build ran and wrote `<temp>/built`; the message shows `unit` then FAIL on "a write outside the checkout is refused", so `unit` ran outside the sandbox too |

No test passed on the base, and none was skipped.

## The wrong program

For a fix, the merge base is the wrong program (design: Wrong programs), and the issue's Proof says so: "Each of the
three writes failing on the merge base, naming the check or the file". On `0fffd8fcf` the hub reads
`<worktree>/.deepbuild/done.yaml` for a claim's spec checks and its `outside` block, so it runs `true` as `unit`, runs
no spec check once the file is gone, and runs the added entry's build and then `unit` outside the sandbox. Each test
fails there on an `expect` of its own (`AssertionError`, innermost frame in `approved-revision.test.ts`), for the
reason its criterion names. No criterion names a planted twin and no test passes on the base, so there is no
`twins.json`, and this job planted no program.

Criterion 1 says the wrong gate "passes the rewritten check". On this base the run of `true` ends `uncounted` (the
runner counts no test), and the claim is INVALID, not PASS. The test asserts what the criterion requires, that the run
ended `failed`, so it fails on the base either way.

## What ran only on the base

No implementation existed, so the base is the only program the tests ran on. Each fails at its first assertion that
tells the two programs apart, so the assertions after it ran on no program: both proposal assertions, criterion 2's
outcomes, and criterion 3's steps 2 to 6.

While drafting, this job ran two scenarios once on the base with no write at all, in a file since deleted, to see what
a hub that keeps to the committed revision would record. They are not kept as tests, since they would pass on the
base and prove nothing. With `FLAG` alone, `unit` (`node --test tests/unit.test.js`) ended `failed` on the claim and on
its merge-base run, and the verdict was BLOCKED ("unit: inherited: also fails on the merge base"): criterion 1's steps
2 to 4 hold there. With `FLAG`, `FIX` and criterion 3's unit test, `unit` ended `passed` with 2 tests, `<temp>/reached`
was not written, `withheld` was `[]`, and the record held `sandbox.denied {operation: "file-write-create", target:
"<temp>/reached"}` for `unit`'s run: criterion 3's steps 2 to 6 hold there.

## Readings where the issue leaves a choice

- **The approved revision** is the file on the fixture's base commit (Scope, quoted above). No test approves a
  revision through #333's draft or applies a proposal: the criteria name neither.
- **"A write the guard didn't recognize"** is a change made on disk with no hook fired for it. #322's AC12 makes its
  write through a Bash call the guard lets by; here no hook sees the write at all, which is what a command's child
  does.
- **"Changes that check's `run` to `true`"** is `run: "true"`, the command, since the criterion's wrong gate "passes
  the rewritten check". The YAML boolean `run: true` is not driven: on the base an entry whose `run` isn't text never
  runs.
- **"The next claim's run of the check failed"** is every finished `run.started`/`run.finished` pair for `unit` on the
  claim ending `failed`. A run of `unit` on the merge base that the claim starts counts among them; it fails too.
- **"A proposal names the file"** is any event whose kind ends in `.proposed`, recorded after the write, whose data
  holds `.deepbuild/done.yaml`: #322's reader (`proposalsNaming`), and what the base records for a changed drafted
  check (`learn.proposed`, with the file as its `target`). The kind, the fields and the wording are left open. It is
  read for up to 60 s after the claim is judged.
- **"Spec checks running from the kept revision"** (criterion 2) is `unit` and `typecheck` each run on the claim and
  pass after the session's fix. A pass needs counted tests, so the kept revision's lines ran.
- **"Moves no check out of the sandbox"** is read three ways: by what the check could do (its write outside its
  checkout didn't land, and its test, which asserts that the write throws, passed), by `run.started`'s `withheld`, where
  the base records `outside` for a run it moves out, and by the refusal itself.
- **"The run records the sandbox it ran in"** is a `sandbox.denied` event of the run, which the supervisor records
  only for a run in its sandbox, naming the write the sandbox refused. It is read for up to 60 s after the claim is
  judged. An implementation that records the sandbox another way and no longer records refusals should dispute step 6.
- **"Runs no build"** is the added entry's build command leaving no file. The build is a shell builtin's redirect, so
  it needs no program on `PATH`.

## What this suite does not cover

Said plainly, so nothing here reads as proven:

- **`claims.done` and the release checks.** The Scope says every claim's `claims.done` list and its release checks
  come from the kept revision. The criteria name the `run` line, the deleted file and the `outside` block; no test
  rewrites the `claims` list or a `release` block, and no session here opens a PR.
- **A revision approved through #333's draft, or after an applied proposal.** Only the base-commit stand-in is driven.
- **A write made before the session starts, or between two claims.** Each test has one claim, after the write.
- **No difference, no proposal.** Step 1 of criteria 1 and 2 holds only that no proposal names the file before the
  write. A whole scenario with no write would pass on the base, so it would need a planted twin or a mutant to prove
  anything, and none is written.
- **What the proposal says**, whether an ask reaches you, and what approving it does.
- **The stop's reply and the claim's verdict**, beyond "no PASS" in criterion 1.
- **Linux.** The run was on macOS. Criterion 3 relies on the platform sandbox refusing a write outside the run's
  checkout and on the supervisor recording the refusal; bubblewrap's side was not run by this job.

## How to run

With Node 24.22.0 (`.node-version`) and the pinned toolchain's `cargo` on `PATH`:

```sh
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1864 --reporter=verbose
node node_modules/typescript/bin/tsc --noEmit -p tests/acceptance/1864/tsconfig.json
```

- The tests build nothing: a missing build is BLOCKED (thrown), naming the command.
- Every test starts a hub of its own, and the file's tests run one at a time. Each makes its folders under
  `/tmp/dh322-*`, sets `HOME` there for every process it starts, and never touches the real `~/.deepbuild` or
  `~/.claude`. It stops only processes it started, by PID (#322's `cleanup`). No network, no model. Fixtures use
  synthetic identities only.
- The hub runs each check in the platform sandbox, so the shell that runs the suite must not be sandboxed itself
  (macOS can't nest Seatbelt).
- **Time.** 39 s for the file on the base, at a 1-minute load of 64 on 12 cores. On a hub that keeps the revision,
  criterion 1 waits 30 s more for a verdict that is neither PASS nor FAIL, and each test may wait up to 60 s for its
  proposal or its `sandbox.denied`.
- **Load.** A definition that didn't lock within 180 s, a stop that made no claim and a claim with no verdict 900 s
  after its stop are INCONCLUSIVE (a skip, never a pass) when the 1-minute load is past the core count, and BLOCKED
  otherwise. In the run above nothing was skipped.
- **Lanes.** This job changed no lane. At this base `scripts/lanes.mjs` puts `tests/acceptance/2205/` on its `alone`
  list and names this folder on none, so the unit lane runs this file beside others unless a signed change adds it.

## Files

- `helpers.ts`: the specs, the handed definition, the three writes, the scenario (`claimAfter`) and the readers of a
  claim's runs, proposals and sandbox refusals. It imports #322's world, hub and session; nothing in it stands in for
  DeepBuild.
- `approved-revision.test.ts`: the three tests, one per criterion.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit, the repo's path replaced by `<repo>`.
