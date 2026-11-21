# Acceptance tests for #2645: a claim reads its transcript from the end

Written first and blind by a job that never saw an implementation of #2645, its diff or another checkout. It read:

- the issue (`gh issue view 2645`), and the words it cites: finding 02 F5 of the Nov 9 audit at `ccbdefd1f`, and #2365's
  issue for its 100 MB transcript
- `AGENTS.md`, and `docs/technical-design.md`: An agent says it's done; Numbers version 0 has to hold (the Hot path and
  Memory rows, Every task carries its own budgets, The reference Macs); How we know version 0 works (Wrong programs,
  Tests written first, Dogfooding)
- the base commit `1a4b7d065b1ed115a54d6b506f9bdd516ca4a8c0`: `packages/hub/src/open-items.ts`, `codex-loops.ts`,
  `stop-judging.ts` (the claim lane), `core.ts` (how it builds OpenItems, `recordUsage`), `session-state.ts`,
  `hookmap.ts` (`versionOf`), `plant.ts`, `packages/readings/src/usage.ts` (`UsageTail`), `packages/gate/src/open.ts`
  (`openTasks`), the adapters' facts and corpus, `scripts/benchmark.mjs` (`judgeLimit`), `scripts/lanes.mjs`,
  `scripts/proof-change.mjs` (criterion IDs), `scripts/proof-runs.mjs` (twins), and #20's, #323's and #2365's suites,
  whose tools these tests reuse

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job.

**Redrafted for form, 2026-11-19**, by the same job at the coordinator's request on `142feaf51`, still blind: the proof
lanes couldn't count the suite as written. Every check, value, fixture, placement and message is as it was. What
changed: a failed check is now the framework's assertion failure (`must`); the wrong programs are twins the lanes lay
over the hub (`twins/`, `twins.json`); the planted-reader test checks the suite's own message and carries no tag; and
AC5's lack of a test is explained (below). The run that proves it is in `BASE-FAILURE.txt`.

## How to run

On macOS, with the repo's Node (24.22.0), from the repo root:

```sh
npm ci --ignore-scripts
npm run build --workspaces     # the probe (AC1, AC2) loads the built hub and adapters
npx vitest run --root tests/acceptance/2645 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/2645/tsconfig.json
```

- `scripts/lanes.mjs` runs the folder `alone`: `big.test.ts` measures the resident memory of the process that makes a
  claim, and the files write about 100 MB at a time.
- Without the build, AC1 and AC2 fail BLOCKED, never pass. No hub, deep-hook, network, GitHub, throttle or timed grant.
  The only children are #2365's fixture writer and the probe, each awaited, and stopped only by its own PID, after 10
  minutes.
- Folders are `dh2645-*` under the OS temp folder and #20's `/tmp/dh20-*` (#20's helpers make HOME a temp folder when
  imported and remove the agents' own variables), all removed after each file. The 100 MB transcript is the largest;
  AC3's copies are removed after each transcript. All text is synthetic.

## Surface choices

What the tests call and read, by name, so the implementation keeps them:

- **A failed check**: `must` (`helpers.ts`) throws node:assert's `AssertionError` (`ERR_ASSERTION`), its stack starting
  at the caller in this suite's files, which the proof lanes read as failing at its assertion
  (`scripts/proof-runs.mjs` `atAssertion`; design: Failing on an assertion). BLOCKED and INCONCLUSIVE are plain errors
  that start with their state, and a claim that throws in the probe is the program's own error, neither of them an
  assertion.
- **The wrong programs**: `twins/<name>/packages/hub/src/open-items.ts` or `codex-loops.ts`, each the merge base's file
  with one planted defect, laid over the program being judged, and listed by criterion tag in `twins.json` (Wrong
  programs, below).

- **The claim**: `new OpenItems(options).atClaim(claim)`, the class `packages/hub/src/open-items.ts` exports, as the
  hub's claim lane calls it (`stop-judging.ts`). In this process from the source for AC3 and AC4; from the build,
  `packages/hub/dist/open-items.js`, in the probe for AC1 and AC2. `options` are the base's: `raw` answers `[]`
  (nothing open yet), `append` keeps each event, `connection`, `asks` (raises nothing), `pin` (null), `now`, `github`
  (throws: no pull request) and `taskList`. `claim` is `{ session, agent, task: 'task:dh2645', cwd, base: 'HEAD',
  message: '', transcript, pr: undefined, same: true }`; `same: true` keeps git out, as at a claim after reads only.
  Its answer is the `data.text` of each `open_item.opened` it appends with `data.from === 'task'`.
- **The list** is `newestList`'s, which the module keeps private, so it is read through that claim. The facts are
  `shipped().get(agent === 'codex' ? 'codex' : 'claude').facts.taskList`, as `core.ts` reads them: as shipped for AC1
  and AC2; with `open` set to `pending`, `in_progress` and `completed` for AC3 and AC4, so a claim's items are the
  whole list (`helpers.ts` `everyItem`). Of the facts, the list's reader reads only the tool's name.
- **The readings**: `codexReadings(session, transcript, turn, continuation)` from `packages/hub/src/codex-loops.ts`,
  its whole answer (`version`, `readings`, `loop`, `limits`, `account`), compared as canonical JSON (keys sorted,
  `undefined` dropped).
- **The merge base's answers**: `merge-base.ts`, the base's `newestList` and `codexReadings` copied from `1a4b7d065`
  token for token but for one change: the line that read the file reads through an optional `read`. They read the
  facts the change reads.
- **Bytes read**: #2365's instrument, `tests/acceptance/2365/reads.ts` `watchReads`: the bytes Node's file reads
  (`node:fs`, `node:fs/promises`, `FileHandle`) return from the watched path, in the process that makes the claim: the
  probe for AC1 (`--reads`), the test's own process for AC4.
- **Resident memory**: `probe/claim.mjs`, run as `node --expose-gc probe/claim.mjs <transcript>`: one warm-up claim on
  a small transcript of its own, two `gc()`, then `process.memoryUsage.rss()` every 5 ms and
  `process.resourceUsage().maxRSS` at the claim's start and end. The rise is the larger of the two differences, each
  within one counter, as #2365's probe reads a pass. No read counter runs then. Five such claims, each in a new
  process, are judged by `scripts/benchmark.mjs` `judgeLimit` with `fingerprint()` and the one-minute load at each
  run's start and end.
- **Block size**: not named. In the "across a block's edge" placement, the newest call's line, and a rollout's newest
  goal record's, is 2,300,000 bytes long. That is longer than any block a reader can use and still read at most 2 MB
  (AC1), so an edge cuts it whatever the block size and wherever the blocks start.
- **The planted reader**: for the proof lanes, the twins `list-drops-cut-line` and `readings-drops-cut-line`. For the
  untagged test that holds AC3's check to "naming the line", `planted.ts` `dropsCutLines(block)`, a `read` for
  `merge-base.ts`'s readers with the same defect, run at blocks of 4,096, 65,536, 1,048,576 and 2,000,000 bytes. No
  hub plant and no environment variable.
- **The transcripts**: #20's, made with #20's own helpers (`generate.ts` `session(0x207000, 3_000_000, T0)`, its first
  budget session; `claudeTranscript` grown by `appendClaude` from 10 to 50 messages; `codexTranscript`;
  `tinyTranscript`), and every `adapters/corpus/<agent>/<version>/<session>/transcript.jsonl` (56 at the base). The
  100 MB transcript is #2365's, written by `tests/acceptance/2365/probe/fixture.mjs write|append`, seed 2645.

## Criteria → tests

Each test's name and each failure message start with the criterion's number and ID: `#2645.` and the first eight hex
digits of the SHA-256 of the criterion's text, trimmed and its white space collapsed, as `scripts/proof-change.mjs`
computes it from the issue's text.

| Criterion | Test | What it does |
|---|---|---|
| AC1 `#2645.b383ad27` | `big.test.ts` | One claim in the probe on a 100,026,455-byte transcript whose newest TodoWrite call starts 920,182 bytes from the end, an older one at 50 MB and a line naming the tool last: its open items equal those of the merge base's list, and it reads at most 2,000,000 bytes of the file. A count under the bytes from that call to the end is INCONCLUSIVE |
| AC2 `#2645.027eeba7` | `big.test.ts` | The same claim five times, each in a new probe with no counter: every rise under 16,000,000 bytes, judged by `judgeLimit` |
| AC3 `#2645.b55ba6ee` | `same.test.ts` (1, and 1 untagged) | 60 transcripts, each with the newest call in the first block, the last block and across a block's edge, each read whole and as it is written (`helpers.ts` `compare`): the list and the readings equal the merge base's on the same bytes. It fails at its assertion on the twins `list-drops-cut-line` and `readings-drops-cut-line`. The untagged test holds the check's message to naming the line a reader dropped |
| AC4 `#2645.a875ed8b` | `passes.test.ts` (2) | A 6.3 MB Claude Code transcript whose lines name TodoWrite and none calls it: no item, no byte read twice; it fails at its assertion on the twin `list-reads-twice`. A 2.5 MB Codex rollout read at turn 2's stop, its first megabyte rewritten in place at the same size, then grown by turn 3: the claim's list and codexReadings are the merge base's for the rewritten file; it fails at its assertion on the twin `readings-from-last-end` |
| AC5 `#2645.696122ee` | none | Proven by running `tests/acceptance/82/` and `tests/acceptance/83/` unchanged; no tagged test can hold it (AC5, below) |

## Readings

Where the issue leaves a choice, this job read:

- **Units.** MB is 1,000,000 bytes, as #20's and #2365's suites count. "At most 2 MB" is at most 2,000,000 bytes, "under
  16 MB" under 16,000,000 bytes, "100 MB" at least 100,000,000 bytes, and "in its last megabyte" a call that starts
  within the last 1,000,000 bytes.
- **"A claim" and "the hub's resident memory".** The claim runs in a process that runs the hub's own claim code and
  nothing else, the probe. A live hub isn't used, for two reasons. At a session's first stop the hub's usage tail
  (`UsageTail` in `@deepbuild/readings`, from `core.ts` `recordUsage`) reads the whole transcript from byte 0, outside
  this issue, and its read and memory would count as the claim's. And the hub reads in its core's worker thread, where
  a counter in the test's process sees nothing.
- **"Counted by the test".** The instrument sees reads in its own process through Node's file API. A read in another
  thread or process, or by a native addon, is invisible, so a count under what the claim must read is INCONCLUSIVE.
- **AC2 is a memory budget.** The design counts one only on a reference Mac on mains power, Low Power Mode off, thermal
  state nominal and not loaded past its cores (`judgeLimit`). Anywhere else the test fails as INCONCLUSIVE, showing the
  five rises. AC1's bytes are a count and are judged on any machine.
- **"Returns the list the merge base returns".** The claim's open items under Claude Code's shipped facts equal those
  of the merge base's list, which `merge-base.ts` reads from the same file. That list must be the planted call's, or
  the test is BLOCKED.
- **"The list" and "the readings" (AC3, AC4).** The claim's open items with every status counted open, and
  codexReadings' whole answer.
- **"Every transcript".** #20's four kinds and the corpus's 56 `transcript.jsonl` files. The corpus's `events.jsonl`
  files are hook payloads, not transcripts. Every agent but Codex is read with Claude Code's facts, as the hub's
  `taskList` reads them. Readings are read for Codex rollouts only, the only ones the hub reads them for.
- **"The newest call".** For the list, the newest task-list call (TodoWrite; Codex's update_plan). For the readings,
  Codex's newest goal call, a script's `tools.update_goal(` and its `{"goal":…}` output. The corpus holds no TodoWrite
  call and one session with update_plan calls, so the suite plants its own as the newest. A token count with the
  account's windows goes beside the goal call, since the corpus's token counts carry none.
- **The placements.** First block: first in the file (a rollout's session_meta stays its first line, and the planted
  lines end within its first 3 kB), the source's own task-list calls and goal records left out, and 2.3 MB of lines with
  no call after the source's own (#20's generator for Claude Code, shell output for Codex). Last block: after the
  source's own lines, followed by the call's result and a line that names the tool and assigns nothing (a typed prompt;
  for Codex an update_plan call whose arguments don't parse). Across a block's edge: as the last block, with the call's
  line and the goal record's line each 2.3 MB long.
- **Read as the hub reads it.** Each placement is read whole at a path no reader has read (a rollout for its last turn,
  as a continuation, and for its first turn). Then a second copy is written in steps and read at each by one reader:
  the goal record half written, then the newest call half written, each cut inside a character of two or more bytes
  where the line has one, then the whole file. This is how "reads from where its last read ended" is held: each step's
  answer must be the merge base's for the bytes on disk then. A line is cut inside, never at its end, so the merge base
  can't read it either. Each copy is a file of its own read under the source's one session ID: where a reader's last
  read ended is a fact about that file, so an answer must be the one for the file named.
- **"Returns nothing after one pass" (AC4).** One claim records no item and reads no byte twice: the bytes it reads are
  at most the file's size. It is not read as "a later claim reads only what was added": the scope gives newestList no
  memory between claims. A count under the file's size is INCONCLUSIVE, since a reader must read every byte to find
  no call.
- **"Read again from its start" (AC4).** The first 1,000,000 bytes are written over in place by a rewrite that keeps
  each line's length (version 0.160.0 and 0.144.0, goal active and paused, weekly window 40 and 90 used, plan team and
  plus, the plan's words, the shell output's letters' case), so the file keeps its size until turn 3 is appended. The
  next claim and the next codexReadings must give the merge base's answers for the rewritten file, which come from
  records in that first megabyte. Bytes aren't counted there: those answers can't be right unless it was read again.

## Wrong programs

The merge base fails AC1 and AC2. AC3's and AC4's tests hold on the base, the reference they compare with, so each
fails instead on twins, written by this job from the merge base's files alone (design: Criteria in a checked shape).
Each twin is one file of the merge base, `packages/hub/src/open-items.ts` or `packages/hub/src/codex-loops.ts`, with
one defect, which the proof lanes lay over the program being judged; `twins.json` lists them by criterion tag.

| Twin | Criterion | Its defect | How the test fails on it |
|---|---|---|---|
| `list-drops-cut-line` | AC3, the issue's planted reader | `newestList` reads from the file's end 64 KiB at a time, newest line first, decodes only a line that names the tool and returns at the first that assigns the list, as the issue's reader does; but a line a block's edge cuts is dropped where the issue's reader joins it | `same.test.ts`'s AC3 test fails at its assertion: on the base, 120 of 897 reads differ, the "across" placement of all 60 transcripts read whole and written whole, each message naming the line the merge base's list comes from, such as `the merge base's list is the TodoWrite call on line 1283 (toolu_dh2645_newest, bytes 3,000,773–5,301,787 of 5,303,177, 2,301,014 bytes long)` |
| `readings-drops-cut-line` | AC3, the issue's planted reader | `codexReadings` reads the rollout from its end 64 KiB at a time and keeps only the lines whole in a block, dropping a line a block's edge cuts | the same test fails at its assertion: on the base, 51 of 897 reads differ, the readings of the Codex rollouts' "across" placement, each message naming the goal record the merge base reads, such as `its newest goal record is line 5 (goal output, bytes 904–2,301,274 of 4,602,523, 2,300,370 bytes long)` |
| `list-reads-twice` | AC4, no task-list call | `newestList` reads a transcript that names the tool twice: a first pass over the whole file to see whether it names the tool at all, then the merge base's | `passes.test.ts`'s first test fails at its assertion: `the claim on a 6,302,077-byte transcript with no TodoWrite call read 12,604,154 bytes of it (2 fs/promises.readFile of 12,604,154 bytes): one pass reads no byte twice` |
| `readings-from-last-end` | AC4, first megabyte rewritten | `codexReadings` reads from where its last read of the file ended and puts the bytes added after those it read then, never reading them again, so a rollout rewritten since keeps its old first megabyte | `passes.test.ts`'s second test fails at its assertion: after the rewrite the hub's readings keep the old first megabyte's, version 0.160.0, weekly window 60% left, the team plan and the goal active, where the merge base's say 0.144.0, 10% left, plus and paused |

- A twin compiles and runs: each was laid over this worktree at the base, the hub type-checked with it, and the test
  run (`BASE-FAILURE.txt`). Its file is the merge base's, so it holds only what the base's file exports and takes; if the
  change's other files need more of it, the twin's checkout won't build and the lanes read it unrunnable, which is a
  dispute for a redraft, since the implementer doesn't edit it.
- **The untagged test** in `same.test.ts` holds AC3's check to the issue's "fails, naming the line": `planted.ts`, the
  same defect in test code, at blocks of 4,096 to 2,000,000 bytes, on the "across" placement of
  `corpus claude-code/2.1.308/tools` and `corpus codex/0.160.0/goal`, must fail the check with a message naming the
  newest call's line, `on line <n> (<call id>, bytes …)`, and the rollout's goal record's, `goal record is line <m>`.
  It checks the suite's own message, the same on every program, so it carries no criterion's tag: a tagged test that
  can't fail would fail the before lane.

## AC5

No tagged test holds "`tests/acceptance/82/` and `tests/acceptance/83/` pass unchanged". Its proof is those suites
themselves, which the lanes run as #82's and #83's tagged tests. A test of #2645's would have to run both whole
suites inside itself, real hubs and deep-hook included, which AGENTS.md rules out ("not whole neighbouring suites"),
and it would still need a wrong program to fail on: a twin may replace code under test but never a test's files, so
no program can make "unchanged" fail, and a twin that broke what 82 or 83 checks would plant a fault in their issues'
behavior, not this one's. So the trace lane will name AC5 open until the owner rules on how it counts.

## Expected at the base

Run on the base, see `BASE-FAILURE.txt`:

- `big.test.ts`: AC1 fails at its assertion (`AssertionError [ERR_ASSERTION]`, innermost frame in `big.test.ts`), `the
  claim read 100,026,455 bytes of the 100,026,455-byte transcript (1 fs/promises.readFile of 100,026,455 bytes), whose
  newest TodoWrite call starts 920,182 bytes from its end: at most 2,000,000 may be read`. AC2: each of its five claims
  raised its process's resident memory by about 316 MB, more than three times the file. The judge calls that a FAIL,
  at AC2's assertion, only on a fit, quiet reference Mac; on the shared Mac this ran on, a Mac17,10 hot and loaded far
  past its 18 cores, it called it INCONCLUSIVE, which the lanes don't count as failing at its assertion.
- `same.test.ts`: both tests pass. The base is the reference, and the planted reader fails the check as it must.
- `passes.test.ts`: both tests pass.
- Each twin, laid over the base, fails its criterion's test at its assertion (Wrong programs, above, and
  `BASE-FAILURE.txt`).

## Unrun, and gaps

- **AC5**'s suites, `tests/acceptance/82/` and `83/`, were not run by this job, and no tagged test holds AC5 (AC5,
  above).
- **No live hub** makes these claims (Readings).
- **The instrument** sees Node's file API in the claim's own process only.
- **AC2 off a reference Mac**, or on one under load, reads INCONCLUSIVE, on the change as on the base; the lanes count
  it only from a fit, quiet reference Mac.
- **Imports by path.** The suite reaches `OpenItems` and `codexReadings` by their files, as the issue names them; no
  package's public entry exports them. The design's trace lane would refuse an acceptance test that imports the code
  under test by its path; `scripts/proof.mjs` doesn't check that today.
- **Beside this issue**: the usage tail reads a session's whole transcript at its first stop in each hub process, and
  `core.ts` `recordUsage` reads a Codex rollout whole at every stop. A live hub's memory at a claim includes them.
