# Acceptance tests for #3511: a claim on a host is judged on what it changed there

Written first, blind, by a job that never saw an implementation of #3511; none exists at the base (`9678af240`). The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding).

**Not run.** The job that wrote this suite was barred from building or running anything (an overloaded machine with no
Lima VM), so no test here has been executed or type-checked: see Unvalidated. There is no `BASE-FAILURE.txt` yet;
whoever first runs the suite on the base saves one. The failures at the base below are predicted from reading.

## What was read

- Issue #3511: Scope, the three criteria, Proof, Depends on. For context only: #999 (the host gate), #1869 (the same
  rule for a local claim's read; its PR was not read) and #1942 (remote runs).
- `AGENTS.md`, and `docs/technical-design.md`: How runs become one of five verdicts (the verdict table, Whose checks
  count, Fail before, pass after); Blocks for work on your other machines (Sessions on a host); Dogfooding.
- The base, for surfaces and conventions only: `tests/acceptance/999/` (its README, `helpers.ts`, `session.test.ts`,
  `fixtures/agent.sh`, `lane.json`, `tsconfig.json`, `BASE-FAILURE.txt`), the READMEs of `875` and `1942`, and how
  `3262`, `994` and `1720` import another suite's helpers; `packages/hub/src/host-gate.ts`, `host-sessions.ts` (what
  the hub reads on a host at a stop: the HEAD, the spec at the base, files by path), `gate-runner.ts` and
  `claim-changes.ts` (how a local claim's changes are read, and the verdict's line for an approved check that counts as
  the agent's own), `approved-spec.ts`, `spec-checks.ts`, `packages/gate/src/own.ts` (the own folders),
  `packages/hub/src/hosts.ts` (a remote run is a `systemd-run --user` unit); the schemas `run.finished@4` (its
  outcomes) and `verdict.made@2`; `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs` and
  `lanes-lists.mjs` (`lane.json`), `scripts/wait-ratchet.mjs`.
- Not read: any branch but the base, any PR, any other worktree.

## Criteria and files

Each `describe` title is the criterion's ID and its text: `#3511.` and the first 8 hex of SHA-256 of the checkbox text
after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`'s `criterionId`).

| AC | ID | File | Tests |
|---|---|---|---|
| AC1, the test file | `#3511.18fa26af` | `own-files.test.ts` (1) | the claim changes price.txt to 18.00 and empties `tests/price_test.sh` of its comparison; the check exits 0 on the host; no verdict of the claim is PASS, and its newest verdict names the check as the agent's own and names `tests/price_test.sh` |
| AC1, the package script | `#3511.18fa26af` | `own-files.test.ts` (2) | the same with `package.json`'s `test` script replaced, for a check that runs `npm test`; the verdict names `package.json` |
| AC2 | `#3511.7e0ccc3e` | `code-only.test.ts` | the claim changes only price.txt, to 17.00; the same check as AC1 (1) exits 0 on the host; the claim reads PASS |
| AC3 | `#3511.6e0d7d73` | `failed-read.test.ts` | AC2's claim with git failing in the session's folder on the host for every read of what changed; a verdict other than PASS is in the record when the session's Stop hook has returned; none is ever PASS; the newest names the failed read |

## Run them

macOS, the repo's Node (24.22.0) first on `PATH`, with this Mac's Lima VM `deep-ubuntu` running (or another, named by
`DEEP_TEST_VM`), exactly as #999's suite runs:

```sh
npm ci                                           # once
npm run build --workspaces                       # every test runs packages/cli/dist/main.js
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook    # the hub's own
NO_COLOR=1 node node_modules/vitest/vitest.mjs run tests/acceptance/3511 --testTimeout=1800000 --hookTimeout=900000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/3511/tsconfig.json
```

- **One at a time.** `lane.json` puts the folder in the alone block (`shared: the Lima VMs`), as #999's is.
- **Needs.** Everything #999's suite needs (its README, Run them): `ssh`, the VM with `git`, `base64`, a user manager
  and lingering on, and the deep-hook `deep host add` installs. **One thing more, for AC1 (2) only: `npm` on the VM,
  where a user unit finds it** (`/usr/bin` or `/usr/local/bin`; #999's README notes the VM has no Node, so it may need
  installing). A VM that can't be reached, a binary that isn't built, a host with no npm, an edit the session's hooks
  don't let through, a stop that makes no claim, or a check that never ended `passed` on the host fails the test as
  `BLOCKED`, a plain `Error`, never a `PASS`; nothing skips.
- **Time.** Four worlds, each a hub start, a `deep host add`, a session and one held stop: minutes each on a loaded
  Mac. No test waits a fixed time: every wait is for an event of the record, bounded.
- **Safety.** #999's (its README, Safety), since its helpers make the world: local folders under `/tmp/dh999-*`, and
  `~/dh999-<id>/` on the VM, removed after each test; each hub and `deep` run with a temp `HOME` and none of the
  caller's settings; no network but 127.0.0.1 and the VM; no model. `npm test` on the VM keeps its cache in
  `~/dh999-<id>/npm-cache`, removed with the folder. The VM's user name, the key's path and both homes are redacted in
  what the suite writes down.
- **The proof** is written to `$TMPDIR/deep-3511-proof/`, rewritten each run: for each scene the host, the base
  commit, the files the claim edited, the claim's runs with their hosts and outcomes, and every verdict's data.

## Helpers

`helpers.ts` imports #999's world from `../999/helpers.ts` and edits nothing there (suites that share a harness import
it: `3262` from `393` and `806`, `994` from `27`). It adds the sample repo's second commit, the session up to its first
change, the claim read after a stop, and the text a verdict holds. Every judgement is a vitest `expect` in this folder;
every precondition is a plain `Error` starting `BLOCKED` (the proof lane counts only a failure at an assertion).

## The scenes

The sample repo on the host is #999's (`price.txt` at `20.00`, the drafted check `.deepbuild/checks/price.sh`, one
commit on `main`) with a second commit, **the claim's base**:

- `tests/price_test.sh`, the cart's test: it passes once `price.txt` holds `17.00`.
- `.deepbuild/checks/price.sh`, the approved check, rewritten: it notes its run as #999's does, then runs
  `sh tests/price_test.sh`; in AC1 (2) it runs `npm test` instead, and `package.json`'s `test` script is
  `sh tests/price_test.sh`.

The prompt and its handed definition are #999's (one requirement, judged by that check, its bytes approved). The
session takes the prompt, reads `price.txt`, makes its edits as Edit calls through its hooks, and stops saying done,
without committing: the gate judges the folder as it is.

| Scene | The claim's edits | The check on the host | Expected |
|---|---|---|---|
| AC1 (1) | `price.txt` to `18.00`; `tests/price_test.sh` to a file that compares nothing | exits 0 | not PASS; names the check as the agent's own, and `tests/price_test.sh` |
| AC1 (2) | `price.txt` to `18.00`; `package.json`'s `test` script to `echo …` | exits 0 | not PASS; names the check as the agent's own, and `package.json` |
| AC2 | `price.txt` to `17.00` | exits 0 | PASS |
| AC3 | `price.txt` to `17.00`; then the folder's git index is broken | exits 0 | not PASS when the stop returns; names the failed read |

## Readings where the issue leaves a choice

1. **"Its approved spec check"** is read as the approved check the claim is judged by: here the check of the task's
   definition, drafted and approved by its bytes, as #999's suite has it. The design's rule (Whose checks count) is
   written for "an approved check", and the issue's Scope says "an approved check"; a check from the repo's
   `.deepbuild/done.yaml` on a host also needs the folder trusted in the host's own `~/.claude.json`, which this suite
   doesn't write. A redraft that wants a `done.yaml` check starts here.
2. **The claim edits two files in AC1**: the check's own file and `price.txt` (to a wrong total). Its deliverable is
   `price.txt`, so a claim that left it untouched could be sent back for another reason, and the test would not hold a
   gate that never reads the change set apart from one that does.
3. **"So that the check exits 0 there"**: a `run.started` of the check for the claim whose `data.host` is the host's
   name, ended by a `run.finished` with outcome `passed`. A claim with none is `BLOCKED`.
4. **"Does not read PASS"**: no `verdict.made` of the claim has outcome `PASS`, and its newest is one of the other
   four. The claim is read once it has a verdict, its runs have ended and a run of the check has ended; a verdict that
   follows that run gets 30 s more to land.
5. **"The verdict names the check as the agent's own and the edited file"**: among every string the newest
   `verdict.made`'s `data` holds, one holds both the check's name (`.deepbuild/checks/price.sh`) and the design's
   words `agent's own` (either apostrophe, any case), and one holds the edited file's path. Where in `data` isn't
   read, and no other wording is.
6. **The package script** is `package.json`'s `test`, run by the check with `npm test`. The check is a drafted file,
   so `npm test` stands inside it, not as the check's whole command.
7. **The failed read (AC3)** is "git fails", of the issue's three: the harness, not the session, writes text that is
   no index over `.git/index` in the session's folder on the host, after the session's last edit and before its stop.
   From then `git diff --name-only <base>`, `git status` and `git ls-files --others` there each end with an error
   (the test proves that from the harness first, or is `BLOCKED`), while `git rev-parse HEAD`, the spec at the base
   and the files by path read as before, so nothing the base's gate reads at a host's stop fails. The link down and
   the deadline aren't tried: with the link down the stop itself never reaches the hub, and nothing named lets a test
   make git slow on the host.
8. **"Before its stop hold ends"**: the session's Stop hook is held on the host and returns when its hold is over.
   Once it has returned, the session makes its next call, and the claim's newest verdict among those recorded before
   that call's `tool.before` must be one of the four that aren't PASS. No time is measured.
9. **"The verdict names the failed read"**: one string of the newest verdict's `data` says both that something
   failed (`fail…`, `couldn't`, `could not`, `can't`, `cannot`, `unread…`, `not read`, `timed out`, `deadline`) and
   what (`chang…`, `diff` or `git`). The issue gives no wording; this is the loosest reading that still names a read.

## At the base (predicted, not run)

At `9678af240` a host's gate (`packages/hub/src/host-gate.ts`) runs each check once on the host and takes its exit as
its result; it never reads what the claim changed there.

| Test | Predicted at the base |
|---|---|
| AC1 (1) | the check exits 0, the claim reads PASS: fails at "no verdict of the claim reads PASS" (1 PASS), at the outcome, and at both names (the verdict holds neither `agent's own` nor the file), each message naming `.deepbuild/checks/price.sh` |
| AC1 (2) | the same, for `package.json` |
| AC2 | **passes**: it is the criterion's control, the same path as the second claim of #999's `session.test.ts`. It holds a fix that counts every approved check on a host as the agent's own |
| AC3 | the check exits 0, the claim reads PASS: fails at "no verdict of it reads PASS", at the verdict in the record when the stop returned (PASS), and at the failed read's name |

## Unvalidated

No test was run, and `tsc` wasn't. Checked without running anything of the product's: each `.ts` file parses (Node's
`stripTypeScriptTypes`, then `node --check`), `lane.json` parses, and the files hold no timer. None of these was
tried:

- that `tsc -p tests/acceptance/3511/tsconfig.json`, `node scripts/wait-ratchet.mjs`, `node scripts/repo-rules.mjs`
  and the lane's guard on `lane.json` pass;
- that #999's helpers, imported, make this world as they make #999's, and that the second commit on #999's sample
  repo, made before the session opens, is the base the claim is judged against;
- that the session's hooks let an Edit of `tests/price_test.sh` and of `package.json` through (if a guard stops one,
  the test is `BLOCKED`, and the edit needs another way in);
- that at the base a claim that changes `price.txt` to `18.00` and passes its check has nothing else against it, so
  it reads PASS as predicted;
- the VM's `npm` under a user unit, and `systemd-run --user --wait --pipe` as the harness asks for it;
- that a broken `.git/index` leaves the base's stop on a host undisturbed, and that deep-hook's own hooks on the
  host don't need the index;
- the call the session makes after its stop returns (AC3): that it doesn't change a claim still being judged.

## Known limits

- One kind of failed read is tried. A gate that reads the change set without the folder's index (a snapshot through
  an index of its own) reads it in AC3, finds only `price.txt` changed, and rightly passes the claim: the test would
  fail on it, and the fault would need another shape.
- A verdict made after the hold ended but before the session's next call was recorded counts as made in the hold.
- Makefile and justfile targets, declared fixtures and runner configs, and untracked files of the claim are in Scope
  but in no criterion; they aren't read.
- The words matched in readings 5 and 9 are the design's and the issue's; a verdict that says the same in others fails.
