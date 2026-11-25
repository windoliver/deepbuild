# Acceptance tests for #1866: the hub lets go of a claim's state and of the revisions it presented

Written first, blind, by a job that never saw an implementation of #1866. It read:

- issue #1866's body as of 2026-11-24 (its report, Scope, the six checkbox criteria, Proof, Depends on) and #824's body
- `docs/technical-design.md`: Numbers version 0 has to hold (with Every task carries its own budgets and The reference
  Macs), Criteria in a checked shape, Wrong programs, Dogfooding; `AGENTS.md`
- the suites whose benchmark and worlds these tests drive: `tests/acceptance/824/`, `2650/` (the benchmark), `806/`, `26/`
  (a hub, its socket, the app's connection), `322/`, `2205/` (a claim judged to PASS), `23/`, `363/`, `1721/` (prompts, held
  plug-in actions, revisions), for their conventions
- at the base commit `7cb1e5c4a`: `benchmarks/hub-churn.mjs`; `packages/hub/src` (`plant.ts`; `hub-canvas.ts`:
  `presented`, `drawnBy`; `stop-judging.ts`: the maps keyed by claim, `judged`; `gate-runner.ts`: `claims`, `records`;
  `session-state.ts`: `forgetEnded`, `goneSessions`; `answer-delivery.ts`: `permission`; `mcp-operations.ts`:
  `callPluginAction`; `hub-readings.ts`: `change`; `hub-shared.ts`: `ENDED_KEPT`); `crates/deep-show/src/canvas_side.rs`
  (what the canvas core keeps of a call); `packages/contracts/schemas` (the kinds read back); `scripts/proof-change.mjs`
  (`criterionId`), `scripts/benchmark.mjs` (`fingerprint`), `scripts/lanes.mjs` and `scripts/lanes-lists.mjs`

The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job.

The issue has six checkbox criteria, AC1 to AC6 in the body's order.

## How to run

With the repo's Node (`.node-version`, 24.22.0), the workspaces built, and `deep-hook` and `deep-show` built in `target/`
(the hub's core stops without the first; a revision is presented only by the second, the hub's canvas core):

```sh
npm ci && npm run build --workspaces
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  cargo build --locked -q --bin deep-hook --bin deep-show
npx vitest run --root tests/acceptance/1866 --no-file-parallelism --testTimeout=1800000 --exclude '**/budgets.long.test.ts'
npx vitest run budgets.long.test.ts --root tests/acceptance/1866   # the 5,000-cycle budgets, by hand, on a reference Mac
node node_modules/typescript/bin/tsc -p tests/acceptance/1866/tsconfig.json
```

- **One file at a time:** three files read a hub's memory through the benchmark, the other two start real hubs.
- **Give a file filter before any boolean flag.** Vitest takes the word after `--disable-console-intercept` as its value
  otherwise.
- **Times:** a benchmark run here is 200 cycles (100 of warm-up). #2650's cycle took 2 to 3.5 s on the shared Mac this job
  ran on, and this one adds a claim, a revision, a prompt, a held action and a commit: 10 to 25 minutes a run. Each of the
  three benchmark files runs the benchmark once unplanted and once for each plant, one run a test.
- **Temp folders:** `/tmp/dh2650-*` (the benchmark's homes), `/tmp/dh806-*`, `/tmp/dh322-*`, each removed after its file or
  test. What a test started is stopped by PID only, never by name or port. No network and no model.
- With `--root`, Vitest writes its cache to `tests/acceptance/1866/node_modules/.vite/`; delete that folder before
  committing.
- Vitest hides a passing test's console output without `--disable-console-intercept`; the growth readings printed there are
  the issue's Proof, so keep that output.

## What the lanes need

- `lane.json`: the folder runs alone (it starts real hubs). It names nothing else.
- `scripts/lanes-lists.mjs`, in a commit of this job's own beside the folder's: `byHand` and `timed` list
  `tests/acceptance/1866/budgets.long.test.ts`. 5,000 cycles beside the merge base's can't sit in the unit lane, and the
  file calls `environmentProblem()`.
- The release preflight's `hub churn` lane already runs `node benchmarks/hub-churn.mjs --merge-base`; nothing to add.

## The surface under test

### Merged surfaces, used as their suites define them

- **The churn benchmark (#824, #2650):** `node benchmarks/hub-churn.mjs [--cycles <n>] [--home <dir>] [--merge-base]`, its
  one JSON line (`bench`, `cycles`, `warmup`, `every`, `readings`, `heapGrowthBytes`, `heapGrowthPer1000Bytes`,
  `mergeBase.commit`, `mergeBase.heapGrowthPer1000Bytes`) and its lines starting `PASS`, `FAIL` or `BLOCKED`; it passes
  `DEEP_HUB_PLANT` to its hub and leaves `--home` in place. Driven by #2650's helpers.
- **The hub (#16):** `deep hub run` with a temp `HOME`, `control.token`, hellos `app` and `cli`, `events.read`,
  `canvas.show` (what `deep show` calls, the presentation `deep_show` makes), `canvas.drawn`, `changes.read`. A Claude
  Code session through deep-hook (#322's `Session`) or through the socket, as the benchmark's are.
- **The record's kinds:** `session.start`, `session.end`, `session.gone` (`pid`, `start`), `tool.after` (`kind`,
  `outcome`), `claim.made`, `run.started` (`run`, `claim`), `run.finished` (`run`, `outcome`), `verdict.made` (`claim`,
  `verdict`, `outcome`), `doc.patched` (`doc`, `rev`, `writer`), `turn.usage`, `permission.request`, `ask.created`
  (`subject.effect`), `ask.answered`, `decision.applied` (`ask`), `commit.made`.
- **Planted programs:** `DEEP_HUB_PLANT=<name>` (`packages/hub/src/plant.ts`; an unknown name stops the hub).
- **The bound on ended sessions:** the hub forgets an ended session past the newest 64 (`ENDED_KEPT`).

### Defined here, where the issue leaves a choice: what the implementer has to meet

1. **Every cycle, warm-up's too, holds all of these, in its one session**, and they fit what #824's and #2650's suites
   already hold the cycle to, unchanged: one ended session a cycle, exactly ten `tool.before` and ten `tool.after`, a
   `promise.set` and a `promise.woken`, an ask answered, a run finished, a source answered with 64 KB, a series batch and a
   job that ended. So the edit and the commit are among the ten calls. As the record shows them, on the cycle's session:

   | Part | In the record |
   |---|---|
   | an edit | a `tool.after` of kind `edit` or `write`, outcome `ok` |
   | one claim judged to PASS | exactly one `claim.made`; its newest `verdict.made` is PASS; a `run.started` naming it whose `run.finished` is `passed` (a run of its own, not one carried from another claim's) |
   | one deep_show | exactly one `doc.patched` whose `writer` is `agent` |
   | a stop that carries usage | a `turn.usage` |
   | one permission prompt, answered | exactly one `permission.request`; exactly one `ask.created` whose `subject.effect` is `permission`, with an `ask.answered` or a `decision.applied` on it |
   | one held plug-in action, answered | exactly one `ask.created` whose `subject.effect` is `action.change` or `action.send`, with an `ask.answered` on it: your answer, since a standing rule's answer holds nothing |
   | one commit | exactly one `commit.made` |
   | the session's end | a `session.end`, or with `--killed` the next row's |

2. **`--killed`**, a flag of the benchmark: the same cycles, but each session's agent process is one of its own, the
   session's hooks name it, the benchmark kills it by its PID where the cycle would send `SessionEnd`, and sends none. The
   record then holds a `session.gone` for the session, each session's naming another process, and no `session.end`. It
   goes with `--cycles`, `--home` and `--merge-base`, which drives the merge base's hub through the same killed cycles.
3. **The JSON line's `killed`**: `true` with `--killed`; `false` or absent without it.
4. **The planted hubs**, added to `plant.ts`. Each is a leak of one entry per cycle, never let go, and each entry holds a
   string of 32,768 characters no other value shares (32 KiB in the heap: `randomBytes(16384).toString('hex')`, as #824's
   `kibibyte()` does at 1 KiB). An entry is made only for what its row names, so a cycle that makes no claim, carries no
   usage, raises no prompt or loses no process leaves none:

   | `DEEP_HUB_PLANT` | What it keeps | Cycles |
   |---|---|---|
   | `churn-keeps-claim-lane` | one lane per judged claim: an entry by claim, kept when the claim's state goes | as they are |
   | `churn-keeps-ended-claims` | in the gate runner, every ended session's claims: an entry by claim, kept when the session's claims would go | as they are |
   | `churn-keeps-usage-tail` | one usage tail per ended session | as they are |
   | `churn-keeps-prompt-ask` | the ask every permission prompt raised | as they are |
   | `churn-keeps-gone-routes` | the routes of a session whose process went with no SessionEnd; a session that sent one leaves nothing | `--killed` |
   | `claim-reads-only-memory` | nothing: a hub whose `changes.read` gives a claim's verdicts and runs from memory alone, so it gives none once their state is let go. Its claims are judged and recorded as ever | AC4's world |

5. **A planted benchmark run** exits non-zero and prints a line starting `FAIL` on the retained heap's growth that names
   the cycle count as `100 cycles` and the growth with its unit (the JSON line's number within 15%, over the run or per
   1,000 cycles), as #824's and #2650's suites read it. AC5's and AC6's "naming the growth" is that same line.
6. **`canvas.drawn`** still answers `{ presented: [{ doc, rev, ... }] }`.
7. **The merge base's side** runs the same cycles, the new parts among them, so its copy needs `deep-show` beside
   `deep-hook`. Where either can't be had, the benchmark is BLOCKED, never PASS.

## Readings where the issue and design leave a choice

- **1 MB is 10^6 bytes**, as #16's, #824's and #2650's suites read it: 200 bytes a cycle over 5,000.
- **"Compared with the merge base"** is read as #824's and #2650's suites read it: the limit is absolute, and the merge
  base's growth per 1,000 cycles, read through the same cycles, is carried beside it.
- **The reference Macs** are the design's three, through `scripts/benchmark.mjs`'s `fingerprint()` (#2650's
  `environmentProblem()`); anywhere else the budgets are skipped as INCONCLUSIVE, never passed. Each budget is one run: the
  design's five-run rule names timing results.
- **AC1's and AC5's budgets are one run.** The default cycle holds both criteria's parts, so "the same 5,000 cycles" are the
  same cycles, and each criterion's test reads its own parts back from that run's record.
- **A healthy short run isn't asserted to pass** (#824's and #2650's reading: a short run reads noise as growth; #2650 read
  1 MB in one cycle). Its growth is the planted runs' comparison instead.
- **32 KiB an entry** is this job's: 100 cycles after warm-up add 3.3 MB, three times the noise #2650 read, where the 1 KiB of
  #824's 500-cycle runs would be lost in it. A planted run must add at least half of that over the unplanted run's growth
  and at most three times it. The 200 bytes a cycle itself is the 5,000-cycle runs' to judge.
- **A run of its own for each claim** (Defined here, 1): the gate runner keeps "every run record", which a cycle whose claims
  all carry one earlier run never makes. Whether a key's results stay in memory across sessions is #1018's, untouched here.
- **AC3 goes through `canvas.show`**, the cheapest way the base presents a revision: one connection, no session, one 2D item,
  no snapshot asked for, a panel of 64 x 48 px (#806's world file). The presentation is the same call deep_show's is
  (`HubCanvas.show`). The canvas core plays every call it kept again for each new one, so the test ends it, the hub's own
  child by its PID, every 40 revisions, and the hub starts another, which opens the document from the record (#1721); what
  the hub presented is the hub's own and outlives it. The record's 1,000 `doc.patched` show the world really presented
  them. Another document, shown once after the 1,000, holds the Scope's "the newest revision of each shown document": a hub
  that keeps only the last revision of all fails. What an app that took a revision and connects again is handed isn't
  tested.
- **AC4's surface is `changes.read`**, which gives a claim's `verdicts`, `runs`, `checks` and `line` in one call. The hub lets
  go when the claim's session is forgotten at the latest, so the test ends that session and 70 more. A claim's state may go
  sooner, once its verdict is written; then the read while the session lives is already from the record, and the test
  holds just the same. The other readers of a claim (a later stop's line, a Codex slow verdict with the next prompt, the
  keys of #1018) are held by their own suites.
- **The benchmark's word is never evidence.** The cycle's parts are read back from the record by `events.read`.

## Criteria to tests

Each `describe` names its criterion's ID, `#1866.<first 8 hex of SHA-256 of the criterion's text>`, trimmed and white space
collapsed (`scripts/proof-change.mjs`, `criterionId`), and its text; each test's name starts with its ID.

| ID | Criterion (short) | Tests |
|---|---|---|
| AC1 `#1866.8421f6ab` | 5,000 cycles with a claim judged to PASS and one deep_show: heap under 1 MB against the merge base, on the reference Mac, the growth per 1,000 named | `budgets.long.test.ts`; `claims.test.ts`: the cycle's parts and the reading |
| AC2 `#1866.981a4da3` | one lane per judged claim, and every ended session's claims: each fails the benchmark, naming the cycle count and the growth | `claims.test.ts` (2) |
| AC3 `#1866.41fcb862` | 1,000 revisions and no app: the first `canvas.drawn` gives the newest only | `presented.test.ts` |
| AC4 `#1866.6741c6f2` | a claim's verdict and runs read the same after its state was let go; the memory-only hub fails naming the claim | `released.test.ts` (2) |
| AC5 `#1866.02eae137` | the same cycles with usage, a prompt, a held action, a commit and an end: under 1 MB; the two planted hubs fail | `budgets.long.test.ts`; `sessions.test.ts`: the parts, and the plants (2) |
| AC6 `#1866.96583dcb` | the same cycles with the process killed and no SessionEnd: under 1 MB; the planted hub fails | `budgets.long.test.ts`; `killed.test.ts`: the parts, and the plant |

## Wrong programs

| Wrong program | How it is selected | Criterion | How the test fails on it |
|---|---|---|---|
| a hub that keeps one lane per judged claim | `DEEP_HUB_PLANT=churn-keeps-claim-lane` | AC2 | the benchmark must FAIL on it naming 100 cycles and the growth, and grow by an entry a cycle over the unplanted run; a benchmark that misses it fails the test |
| a gate runner that keeps every ended session's claims | `DEEP_HUB_PLANT=churn-keeps-ended-claims` | AC2 | as above |
| a hub that hands over the history | the merge base | AC3 | it returns 1,000 entries of the document, and the test fails naming how many (BASE-FAILURE.txt) |
| a hub that reads a claim only from memory | `DEEP_HUB_PLANT=claim-reads-only-memory` | AC4 | the judge must report what the read lost, naming the claim |
| one usage tail per ended session; every prompt's ask | `DEEP_HUB_PLANT=churn-keeps-usage-tail`, `churn-keeps-prompt-ask` | AC5 | as AC2's |
| a hub that keeps a gone session's routes | `DEEP_HUB_PLANT=churn-keeps-gone-routes` with `--killed` | AC6 | as AC2's |
| the merge base itself | — | AC1, AC2, AC5, AC6 | its benchmark makes no claim, revision, prompt, held action, commit or killed session, and its hub knows no plant (BASE-FAILURE.txt); its growth is the reading carried beside the change's |

The plants' bodies are the implementer's, to Defined here, 4 (as #824's and #2650's are): the tests hold them to it by the
growth they must add. A twin would replace whole files and drop the change.

## Open questions for the issue's owner

1. **"A permission prompt answered" on the base raises an ask** only when a saved decision covers it, or when paseo shows it.
   A prompt of a terminal session that no decision covers raises none (it is kept as a prompt no decision covered, and
   offered back after the call). The cycle's prompt therefore needs one saved decision, or paseo's answer; the tests take
   either (`ask.answered` or `decision.applied`).
2. **What an app that connects again takes** (an app that took a revision, closed and came back) isn't said beyond the Scope's
   "an app that connects takes the newest revision of each shown document". Not tested.
3. **The deep_show of a 5,000-cycle run** goes through one canvas core, which plays every kept call again for each new one
   (`canvas_side.rs`), so the time of a cycle grows with the run. Nothing here limits a run's time; the long runs allow 16
   hours each.
4. **A carried run.** If the owner reads AC1's "one claim judged to PASS" as met by a claim that only carries another claim's
   result, the test is stricter than the criterion (Readings, A run of its own).
5. **AC2's, AC5's and AC6's "naming the growth"** is read with AC2's cycle count for all five plants, since #824's line
   carries both.

## Files

- `helpers.ts`: the criterion IDs, what each cycle left in the record, the planted run's judgement, the long run's.
- `budgets.long.test.ts` (AC1, AC5, AC6), `claims.test.ts` (AC1, AC2), `sessions.test.ts` (AC5), `killed.test.ts` (AC6),
  `presented.test.ts` (AC3), `released.test.ts` (AC4).
- `lane.json`, `tsconfig.json` (the root options with `noEmit` and `allowImportingTsExtensions`), `BASE-FAILURE.txt`.
