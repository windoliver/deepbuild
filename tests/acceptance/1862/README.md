# Acceptance tests for #1862: review rounds converge on a real hub

Issue #1862, "Review rounds converge on a real hub: a re-review reads only what changed since the commit it last
reviewed". Written first, blind, by a job that never saw an implementation. Sources:

- **The issue**: its Scope, the two acceptance criteria, Proof, Not in scope and Depends on.
- **The design**, `docs/technical-design.md`: In version 0 (the review check, "a second model reviews the diff and its
  valid findings come back as one send-back of structured items (file, line, rule and the quoted text)"); How runs
  become one of five verdicts (Pinned to a commit: "on a clean worktree the snapshot is HEAD"; Open items as records);
  the Check primitive ("a review's second model reads the diff, never the session's transcript"); Lifecycles; and
  the record's tables ("the first PASS settles the task").
- **`AGENTS.md`**, and the base commit's code, read for its surfaces only: `packages/hub` (`kinds.ts`: `reviewSpec`
  with `since: null`, and the review job's prompt; `core.ts`: the review on every claim of a session that opened a
  PR, its diff read to the claim's snapshot, and `judged`, which writes a claim's verdict; `runs.ts`: what a kind's
  run leaves in `run.finished`), `packages/checks-review` (its public entry and `types.ts`: `ReviewSpec.since`,
  `SendBackItem`, `SentBack`, `ItemOutcome`, `ReviewResult.open`, `itemOutcomes`), `packages/runner` (`job.list`, a
  job's `result`), `packages/contracts/schemas/claim.machine@1.json`, and the suites of #87 (review), #322, #323,
  #325 and #1537.
- **The base commit**: `35df4523` (main).

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

## How to run

With Node 24.22 first on `PATH`, `/usr/bin/perl` (the fake reviewer) and the Rust toolchain:

```sh
npm ci                                   # once
npm run build --workspaces               # the hub and the deep CLI the tests start
cargo build --locked -q -p deep-hook     # target/debug/deep-hook, which every hook runs
npx vitest run tests/acceptance/1862 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1862/tsconfig.json
```

The suite starts a hub of its own, so the folder belongs on `scripts/lanes.mjs`'s one-at-a-time list (`alone`),
beside #1537's; the implementer adds it. No network, no real model, no paid call, no `gh` login. It reuses, by
import, #1537's review world and readers (`tests/acceptance/1537/helpers.ts`), which stand on #322's world and
helpers (`tests/acceptance/322/helpers.ts`: the temp world under `/tmp/dh322-*` with `HOME` set to it, the hub as a
process, Claude Code sessions through the real deep-hook, `events.read`, processes stopped by PID only) and #323's
recorded GitHub answers for PR 21. Those suites keep their files and nobody edits them.

Both tests read one story, told once through one hub (`helpers.ts`, `theStory`), so the suite costs one hub and two
review rounds. Either test run alone (`-t 'AC2 #1862.d19b4826'`) tells the story itself.

## The surface under test

- **The real hub**, `deep hub run`, with #322's test settings (`DEEP_HUB_TEST_CONFIRM`, `DEEP_HUB_TEST_DRAFTS`,
  `DEEP_HUB_TEST_WORK`, `DEEP_HUB_TEST_GITHUB`).
- **A Claude Code session through deep-hook**, as #322 and #1537 drive it: SessionStart, the prompt, Read, Edit, the
  `git commit` Bash call, the `gh pr create` Bash call whose result is PR 21's link, and Stop with the agent's last
  words. A Stop's reply, and the next prompt's, are read from deep-hook's stdout and stderr.
- **Real commits in the fixture repo.** When deep-hook allows the session's `git commit`, the test makes that commit
  with git, so commit A and commit B are real, each claim is made on a clean worktree, and the claim's snapshot is
  the commit itself (design: Pinned to a commit).
- **The socket** (cli role, control token): `events.read` (`claim.made`, `run.started`/`run.finished`,
  `verdict.made`, and the two surfaces below), `windows.report` (5% of the five-hour window used), `job.list` (the
  runner's jobs of kind `review`, each with its `result`).
- **`config.json`** in the hub's root (`runner.login_path`, `plan.reserve_pct`) and the wiki's rubric page
  (`~/.deepbuild/wiki/review-rubric.md`), as #1537's world writes them; the rubric here is `fixtures/rubric.md`.
- **The fake reviewer** (below), the one boundary we don't own: the second model.

### Two new surfaces in the record

The base records nothing of a review round beyond its runs, so two surfaces are new, and these tests define them.
Both are read through `events.read`, by shape: the event's kind, and where in its `data` the value sits, are the
implementer's. The shapes and names are #87's (`packages/checks-review/src/types.ts`).

1. **`open`: an earlier send-back's items still open after a round (AC1).** Some event recorded after the round's
   `claim.made` holds in its `data`, at any depth, a field named `open` whose value is a list of `SendBackItem`:
   ```ts
   open: { rule: string; sites: { file: string; line: number; quote: string }[] }[]
   ```
   It is `ReviewResult.open`: "Items sent back on this claim earlier and still open after this round, not sent
   again". After the second round the test finds `{ rule: 'swallowed-error', sites: [{ file: 'src/cart.ts', line: 40,
   … }] }` in such a list (matched by rule, file and line).
2. **`ItemOutcome`: how each sent-back item ended (AC2).** Once the claim settles, some event's `data` holds, at
   any depth, one `ItemOutcome` per sent-back item, as `itemOutcomes` returns them:
   ```ts
   { rule: string; sites: { file: string; line: number; quote: string }[]; ended: 'fixed' | 'left'; commit: string }
   ```
   `commit` is the full 40-hex SHA. An object counts when it has all four fields; an item is matched by rule and by
   one site's file and line; when the record holds more than one outcome for an item, the newest is read.

### The fake reviewer

`fixtures/fake-reviewer.pl` is installed as `claude` in `<tmp>/bin`, first on the runner's login PATH, in place of
#1537's. It answers what the runner asks of Claude Code as #1537's does (`--version`, `auth status`, a headless run
with one stream-json run naming `claude-sonnet-5-5`, another model than the session's `claude-haiku-5-5`). It reads
the diff in its prompt by rule and nothing else: every line on the new side of that unified diff, added or context,
that matches one of its two rules is a finding at that file and line, quoting the line: `off-by-one` for a loop
bound `<= ….length`, `swallowed-error` for an empty `catch {}`, both rules of the rubric. A line the diff doesn't
show is never a finding, so what a round is given decides what it reports: the whole diff from the merge base to
commit B holds line 40 and gets it reported; commit B's change alone holds neither.

Its answer is the review check's `ReviewerAnswer` as JSON, `{"findings": [{file, line, rule, quote}], "summary": "…",
"given": "…"}`: `given` is the prompt it was handed, byte for byte. The tests read what each round was given from
`job.list`: each review job is one call of the fake, and its `result` is that answer. It writes nothing and calls
nothing.

## Criteria to tests

Each test name and failure message starts with its criterion's number and ID, `#1862.<first 8 hex of SHA-256 of the
criterion's text>`, trimmed and white space collapsed (`scripts/proof-change.mjs`), over the issue's text as this
job was given it.

| ID | Criterion (short) | Test | What the test does |
|---|---|---|---|
| AC1 `#1862.bb91163c` | a PR claim sent back at lines 10 and 40, whose next commit changes only line 10, gets a second review of that commit's change alone; line 40 isn't sent again and stays the first send-back's open item | `rounds.test.ts`, first test | after the story's second stop, in this order: no review run of the second claim failed naming `src/cart.ts:40` and the stop wasn't sent back naming it; every call of the fake in the second round was given a diff whose one added line is `src/cart.ts:10` as commit B left it; an event after the second claim lists the line-40 item under `open` |
| AC2 `#1862.d19b4826` | when the claim settles, line 10's item is recorded fixed with the commit that changed it, line 40's left | `rounds.test.ts`, second test | after the second round's verdict, reads the record for up to 30 s: each of the two items has an `ItemOutcome`; line 10's is `fixed` with commit B's SHA; line 40's is `left` |

The story (`helpers.ts`, `tell`): `src/cart.ts` is #87's re-review fixture, 45 lines, in the base commit. The
session reads `src/auth.js` and `src/cart.ts`, makes the two edits that turn the spec's unit check and R1's drafted
check green, breaks line 10 (`i <= items.length`) and line 40 (`} catch {}`), commits (A), opens PR 21 and stops. It
then changes line 10 back, commits (B) and stops. Held as preconditions, each BLOCKED when it doesn't hold: the
definition locked; both commits allowed and the worktree clean after each; each stop made a claim on its commit; the
first claim's commands green; the first round sent both findings back; commit B changed one line.

## Readings where the issue leaves a choice

- **The claim and its rounds.** The hub makes a claim at every judged stop (`claim.made`, `attempt` n) for the same
  task. The issue's "PR claim" with its rounds is that task's claims on PR 21: the first stop's on commit A (round 1)
  and the second stop's on commit B (round 2).
- **A claim on the PR.** As at the base and in #1537: a claim of the session that opened PR 21 with `gh pr create`.
  The session doesn't push; the fixture repo has no remote.
- **"Sent back with review findings at lines 10 and 40"** is a precondition, read from the record: the first
  claim's verdict isn't PASS, and an event recorded after its `claim.made` names each finding by file and line (at
  the base, the review run's `run.finished`). The verdict's outcome isn't held: at the base a review with findings
  also fails its run on the merge base, since both runs read the same diff, so the claim is BLOCKED as inherited
  where the design's send-back is a FAIL.
- **Where a send-back reaches the session** is the hub's, and so is its wording. At the base the first stop's reply
  blocks the stop, saying the review is still unmet, and names neither line. A first stop the reply blocks keeps the
  turn going, and the session goes on to commit B in it. One the reply lets through ended the turn: the test then
  types one prompt that opens no task ("What is left on this change?") and the session goes on in that turn.
- **"Isn't sent again."** Read from the record and the session: no review run of the second claim ends `failed`
  with its `run.finished` naming `src/cart.ts:40`, and the second stop isn't sent back (deep-hook's reply blocks
  it) with a reason naming `src/cart.ts:40`. A reply or a record that mentions the item as still open, without a
  failed review run or a blocked stop naming it, isn't a send-back.
- **"Reads only that commit's change"** is read from what the second model was given: the diff in the fake's `given`
  for every review job of the second round, the jobs started after the second claim was made (a job is `run:<ULID>`,
  a claim `claim:<ULID>`). The one line that diff adds is `src/cart.ts:10`, as commit B left it; context lines are
  free. A second round that calls no second model fails here too: the claim "gets a second review".
- **"Stays the first send-back's open item"** is the record's `open` (above). Whether that item also holds the
  second claim from PASS, and what the session is told of it, are the implementer's; the tests hold neither.
- **"When that claim settles."** The claim settles when a round of it is judged and sends nothing back: here, when
  the second claim's verdict is made. That is the claim's final state in `claim.machine@1` (`judged`, with no
  `claim.sent_back` after it); it is where the base's hub writes a claim's verdict and closes what the claim waited
  for (`judged` in `core.ts`); and with the commands green and nothing new from the review, it is the task's first
  PASS wherever the build passes it, which the design says settles a task. #87 names the same point: an item is
  left, "decided by the commit the claim settled on" (`outcomes.ts`), in its suite the claim's last. The test
  doesn't hold the second verdict's outcome. It waits for that verdict, then reads the record for the outcomes for
  up to 30 s; it ends no session, merges no PR and answers no ask.
- **"Recorded fixed, with the commit that changed it."** `ended: 'fixed'` and `commit` equal to commit B's SHA. For
  the item left, only `ended: 'left'` is held; #87 gives it the commit the claim settled on, and the criterion names
  none.
- **The second model is Claude Code's**, through the runner, as in #1537. A Codex session's claims aren't driven.
- **The rubric** is the wiki's page, as the design has it; both rules are also in the rubric the base ships.

## Wrong programs

| Criterion | Wrong program | How |
|---|---|---|
| AC1 | the base: every round reads the whole diff from the merge base to the head, so the second round sends line 40 again | `BASE-FAILURE.txt`: fails at the sent-again assertion, naming `swallowed-error at src/cart.ts:40` |
| AC2 | the base: a hub that records no outcome | `BASE-FAILURE.txt`: fails at the no-outcome assertion, naming both items |
| AC1, AC2 | a hub whose second review reads since the first's commit and keeps nothing else: no open item, no outcome | run once while the suite was written, on a throwaway change to the hub's build output, restored after and never committed (`BASE-FAILURE.txt`, last paragraph): AC1 passes its first two assertions and fails at the `open` one; AC2 fails at the no-outcome assertion |

## What this suite could not encode

- **A first stop the hub lets through**: the base blocks it, so the story's one typed prompt was never run.
- **A hub restart between the rounds**: whether what the hub keeps of a round survives it.
- **Rounds kept per pull request**: a second PR, or a second session on the same PR.
- **An item whose line moves**, one fixed in a third round, and a new finding on the line a round changed.
- **That the outcomes come from `itemOutcomes`**: the tests hold their shape and values, not which function made them.
- **The commit recorded for an item left**, and what #1512 shows of these records.
- **Codex sessions**, and a Codex job as the second model.

## Files

- `helpers.ts`: criterion IDs, the world, the fake reviewer's install, the story, and the readers (the fake's calls,
  a claim's review runs, `open` and `ItemOutcome` in the record).
- `rounds.test.ts`: AC1 and AC2.
- `fixtures/fake-reviewer.pl`, `fixtures/rubric.md`.
- `tsconfig.json`: the root's strict options with `noEmit` and `allowImportingTsExtensions`.
- `BASE-FAILURE.txt`: the run on the base commit.
