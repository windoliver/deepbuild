# Acceptance tests for #2539: hook replies that wait on an append can wait on its evidence sync

Written first, blind, from issue #2539 (its text and its one comment as of November 22, 2026: Problem, Where, Possible
direction, the 3 acceptance criteria), the technical design (One event log; Evidence; Hook protocol; Fault injection;
Dogfooding), the agents' rules, the acceptance tests of #1410 (whose shim and helpers these use), #2066, #906 and
#2019 for their conventions and the public surfaces they play, and the hub as it is at the base commit `0fffd8fcf`, by
a job that never saw an implementation of #2539. The implementing agent doesn't edit these files; a dispute goes to a
blind redraft of this job.

The issue has 3 criteria. The proof lanes know each by the ID its tests carry in their names:

| ID | Criterion |
|---|---|
| `#2539.948b73c4` | With each evidence sync slowed to 4 s, a resuming prompt over 8,192 characters that contains a typed rule line, `rejected:` or a status question replies within 1 s, and the rule or rejection is still saved with the right origin. |
| `#2539.10f656f1` | While one session's FULL commit is in its evidence sync, another session's prompt, tool-call and Stop replies come within 1 s. |
| `#2539.fc330be5` | A reply still sees every answer and ask recorded before its hook. |

## How to run

On macOS or Linux, with the repo's Node (24.22.0) first on `PATH` and a C compiler as `cc`:

```sh
npm ci                                   # once, if node_modules is missing
npm run generate -w @deepbuild/contracts
npm run build --workspaces               # the hub, the CLI and deep mcp run from the built packages
cargo build -p deep-hook --locked        # the hub won't start without it
npx vitest run tests/acceptance/2539/ --reporter=verbose
node node_modules/typescript/bin/tsc -p tests/acceptance/2539/tsconfig.json
```

Keep the trailing slash on the folder. The three files run side by side in about 4 minutes; one file alone takes 80 s
(`own-prompt`), 140 s (`other-session`) or 250 s (`sees`). Each test starts its own `deep hub run` on a temp home under
`/tmp/dh1410-*` (the name #1410's helpers give it), so your own `~/.deepbuild` is never touched; it stops only the
processes it started, by PID, and removes its folders. Nothing needs the network. Every test prints the machine's load
with what it measured; the base run was at a 1-minute load of 15 to 60 on 12 cores, earlier runs at up to 150.

## What the tests use

- `tests/acceptance/1410/helpers.ts` and `tests/acceptance/1410/shim/syncshim.c`, as they are: the sync shim preloaded
  into the hub (`DYLD_INSERT_LIBRARIES` on macOS, `LD_PRELOAD` on Linux), which logs every sync with its start and end
  and, with `SYNC_SHIM_SLOW_UNDER` set to the hub's evidence folder, makes each sync of a file or folder there take
  4 s (`SLOW_MS`); the hub as a process; the socket's line protocol; `events.read`.
- Hooks sent as deep-hook sends them (`hook.request@1`), one connection each. A reply is timed from the request to the
  hub's reply line (`exit`), the line after its acknowledgement. A prompt's transcript entry comes first and says who
  sent it (typed by a person, or scheduled), as #2066's tests write it.
- An asking session has its own `deep mcp`, the child of a shell that stands for its Claude Code, and asks through
  `deep_ask`; you answer with `deep inbox answer` (the OS confirmation stubbed, as #24's tests stub it).
- The record is read back through `events.read`; a rejection's guard entry from the hub's `rules.json`, as #2066's
  tests read it.

`helpers.ts` adds only test-side tools over those; no function of the hub is called.

### The slowed commit

A session's turn ends (its `agent.stop` is in the record); its next prompt, of over 8,192 characters, resumes it. The
record keeps 8,192 characters of a field and stores the whole text as evidence, and a prompt that resumes an ended
session commits FULL, so this is a FULL commit that names evidence and, since #1410, waits for that evidence's sync:
on this Mac two slowed syncs, the file and its folder, 8 s together. Every test checks, before it says anything, that
the prompt's event names evidence, that the shim saw that evidence synced, and that a sync took the 4 s it was told to
(`slowedCommit` in `helpers.ts`). A test whose shim saw no sync of the hub's WAL, or whose slowed commit names no
evidence, fails `BLOCKED`; one whose hook was not sent while a slowed sync ran fails `INCONCLUSIVE`. None passes.

The bound is the issue's 1 s (`BOUND_MS`). A reply that waited on one slowed sync takes 4 s or more, or is cut short at
the hub's own 2 s hold on a prompt's context reply (the acknowledgement's `hold_until_ms`), where it comes back empty
after 1.9 s; one that never waited took 2 to 260 ms here at a load of 15 to 100.

## Criteria, tests and what they expect

| Criterion | Test | Expected | On the base |
|---|---|---|---|
| `#2539.948b73c4` | `own-prompt.test.ts` › a typed rule line | The resuming prompt (`rule: <line>.`, then filler) replies within 1 s; its event is recorded `from: person` and names its whole text; the rule is saved once (`learn.applied` adding the line). | FAIL: reply after 1.9 s. The rule is saved once, from `person`. |
| `#2539.948b73c4` | `own-prompt.test.ts` › rejected: | The resuming prompt (``No. rejected: `leftpad`.``, then filler) replies within 1 s; recorded `from: person`; the rejection is saved as your decision (`decision.created`) with its guard entry `word:leftpad`. | FAIL: reply after 1.9 s. Decision and guard entry are saved. |
| `#2539.948b73c4` | `own-prompt.test.ts` › a status question | The resuming status question replies within 1 s with the status answer from the record (`needs you: <n>`); recorded `from: person`. | FAIL: reply after 1.9 s, and empty (cut at the hold), so no status answer. |
| `#2539.948b73c4` | `own-prompt.test.ts` › the right origin | The same rule line and `rejected:` in a long resuming prompt recorded as `scheduled` reply within 1 s and save nothing, while a person's short prompt after it saves both (the control). | FAIL: reply after 1.9 s. Nothing of the scheduled prompt is saved; the control is. |
| `#2539.10f656f1` | `other-session.test.ts` › another session's prompt (A plain; A with a typed rule line) | Every `UserPromptSubmit` of session B replies within 1 s, one at least sent while A's evidence synced. | FAIL: 1.9 s. |
| `#2539.10f656f1` | `other-session.test.ts` › another session's tool-call replies (same two) | Every `PreToolUse`, `PostToolUse` and `PostToolUseFailure` of session B replies within 1 s, one at least sent while A's evidence synced and held by the hub for a reply. | FAIL: the held `PostToolUseFailure` after 1.9 s; the calls the hub answers at once take 2 to 12 ms. |
| `#2539.10f656f1` | `other-session.test.ts` › another session's Stop (same two) | Every `Stop` of session B replies within 1 s, one at least sent while A's evidence synced. | FAIL: 7.9 s, the rest of A's two syncs. |
| `#2539.fc330be5` | `sees.test.ts` › your answer, recorded before the slowed commit starts, prompt | The asking session's prompt, sent while the other session's evidence syncs, carries your answer (the option's label). | FAIL: the reply waits, is cut at its hold after 1.9 s and comes back empty, without the answer. |
| `#2539.fc330be5` | `sees.test.ts` › your answer, given during the slowed commit: prompt; Stop; SessionStart (resume) | The asking session's hook, sent the moment the record holds your answer, carries it. | PASS (3 tests): the record held the answer only after the slowed commit, so the hook came after its syncs. |
| `#2539.fc330be5` | `sees.test.ts` › an ask, recorded before the slowed commit starts | The asking session's status question, sent while the other session's evidence syncs, says `needs you: 1`. | FAIL: the reply is cut at its hold after 1.9 s and comes back empty. |
| `#2539.fc330be5` | `sees.test.ts` › an ask, filed during the slowed commit | The asking session's status question, sent the moment the record holds the ask, says `needs you: 1`. | PASS. |

`BASE-FAILURE.txt` holds the run on the base: 12 failed, 4 passed.

### What each file plays

- **`own-prompt.test.ts`**: one session, one hub per test. The session's turn ends; the long prompt resumes it and is
  timed. Then the record is read: the prompt's own `user.ask` (the event with the hook's ID), its origin, the evidence
  it names; then what it saved, polled for up to 60 s since the fix may save it after the reply.
- **`other-session.test.ts`**: session A's long resuming prompt is sent and not waited for; 400 ms later session B
  starts turn after turn for 15 s: a prompt, a call that passes, the same failing command twice, a Stop. One kind is
  judged per test. Most tool-call replies are written by the hub before its core hears of the call; the one it holds
  for its core's reply is a call that failed as the session's last one did (#2019), which is why B's turns have two
  alike failures: without them no tool-call reply could wait on anything. A's prompt comes plain and with a typed rule
  line, the case the issue's Where names for "other sessions' hooks queue behind it".
- **`sees.test.ts`**: a session asks through `deep_ask` (a choice of two roads); another session's long resuming prompt
  is the slowed commit. In the order "recorded, then the slowed commit" the answer (or the ask) is in the record
  first, and the asking session's hook is sent 1.5 s into the other session's syncs. In the order "recorded during the
  slowed commit" the answer is given (or the ask filed) 1 s into the syncs, and the hook is sent as soon as
  `events.read` shows it. The answer must be in the reply of the asking session's prompt, Stop or SessionStart
  (resume); the ask must be counted by its status question (`needs you: 1`, no other ask being open).

## Left open by the issue

- **A status question over 8,192 characters.** A status question is one of #83's four, exactly, with at most a one-word
  tag in parentheses after it. The only one that long is a question whose tag is that long, so the test sends
  `still going? (<8,400 letters>)`. On the base the record keeps it as any long prompt (it names its whole text and
  syncs it).
- **"Saved with the right origin."** Read here as: the prompt's event is recorded with the origin it was sent with, a
  person's rule and rejection are saved, and the same lines in a prompt recorded as scheduled are not (#2066's rule).
  The last is a test of its own, tagged with the same criterion.
- **"Recorded before its hook."** Read here as: readable through `events.read` before the hook is sent.
- **Which FULL commit.** The issue names a verdict and an answer with an image beside the resuming prompt. All three are
  FULL commits that name evidence; the tests use the resuming prompt for all of them.

## Not covered here

- A verdict's and an image answer's evidence sync as the slowed commit: no test raises either. The path they would take
  through the hub is the one the resuming prompt takes.
- An ask seen by a Stop's or a SessionStart's reply: only the status count is read. A Stop with an ask open holds for
  your answer up to 60 s, which says nothing within these tests' reach.
- A resuming prompt whose reply appends an unread answer's outcome or a hold (the issue's fourth Where line): the
  `rejected:` test covers a rejected capture; the other two are reached only where the answer tests' prompt reply
  records its delivery.
- The comment's path (`promptRules` through the record's `settle()`) has no test of its own: it is on the way of every
  prompt reply above, plain ones included (session B's, and the plain session A's own).
- These tests were not run against planted wrong programs: the job may not edit outside this folder. For criteria 1 and
  2 the base is the wrong program, and fails as each criterion names. The 4 tests of criterion 3 that pass on the base
  guard the fix: a reply that no longer waited for an answer's or an ask's own append, or one written before the hub
  read it, would come back without the answer or the count. On the base their hook is sent after the slowed commit's
  syncs, because the record shows the answer only then; whether a fixed hub shows it earlier is the fix's business.
- Linux was not run by this job; the shim and the helpers are #1410's, which ran there.
