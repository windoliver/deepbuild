# Blind redraft of `#120.a3880a7d`'s idle half

Criterion AC9, `#120.a3880a7d`: "Budgets, on the reference Mac in the local preflight, compared with the merge base:
the line costs under 1 ms in the hook path, and an idle session costs no CPU while it waits". This redraft covers only
its second half, "an idle session costs no CPU while it waits", read with the criterion's "on the reference Mac, in the
local preflight, compared with the merge base". The line-cost half stays with the first draft. The new test is
`budgets-idle-redraft.test.ts`. It reuses `helpers.ts`, `fixtures/` and the README's surfaces unchanged. No other file
of the first draft was edited.

## What this job read

- Issue #120, title and body only (`/tmp/dh120-redraft-issue-120.md`).
- `docs/technical-design.md` at base `5a6d09a4`: Before each command ("Commands end"), the adapter table's Claude Code
  and Codex rows, Numbers (the budget table's Memory, Release gates and Hot path rows, the timing relations, "Every task
  carries its own budgets", the reference Macs), Criteria to tests, Criteria in a checked shape and Dogfooding.
- `AGENTS.md`, mainly Proof.
- This suite's `README.md`, `helpers.ts`, `fixtures/`, `twins.json`, `wakeup.test.ts` and `start.test.ts`.
- `tests/acceptance/16/budgets.test.ts`, `tests/acceptance/20/budgets.test.ts`, `tests/acceptance/56/BUDGETS-REDRAFT.md`.
- `scripts/lanes.mjs`, for the lanes' shape, and `scripts/proof-runs.mjs`, for how twins are found.
- Base code, only to build the hand-built wrong programs: `packages/hub/src/plant.ts`, the `waiter-polls` plant in
  `setup.ts` and `core.ts`, the Stop path of `core.ts`, `wire.ts`'s `HookMeta`, and `packages/contracts/schemas/`.

This job didn't read the removed `budgets.test.ts`, any other checkout, branch, PR, #120's comments, or anything under
`/tmp/dh120-base-*` that it didn't make itself.

## The reading chosen, and why

**The idle session is #120's own.** It is a Claude Code session whose agent said "I'll check the deploy again in 20
minutes." as its last words and stopped. #120 adds exactly this wait. "Commands end" says the promise "becomes a
wake-up at that time", and that a session that can be woken when idle, "as with Claude Code's waiter", has it start a
turn then. So while the session waits, the things waiting are its waiter (#25's asyncRewake entry) and the hub holding
the wake-up. The design's Numbers set the same budget in its Memory row: "each Claude Code waiter under 5 MB and no CPU
while it waits". Before any reading counts, the test checks that the wait is real. The wake-up must be recorded with
its quote, the waiter must be live through every window, nothing may wake the session while the promise is young, and
the wake-up must still be recorded afterwards. Without that, a program with nothing to wait for would pass by costing
nothing. That check is the assertion the base fails.

**What the session costs** is the CPU of everything DeepBuild runs for it while it is idle:

1. The process groups of the session's live DeepBuild background entries, the waiter among them. Each must use **no
   CPU**. `ps` counts hundredths of a second, so "no CPU" means at most one hundredth per 10 s window, which is
   rounding. A process that appears in a group during a window counts whole.
2. The hub's process group. One idle session can't give the hub an absolute "no CPU", because the hub has idle work of
   its own (#16 budgets it at 0.5% of a core). So the hub's share is read **compared with the merge base**. The merge
   base's hub, built from its own code and given the same idle session by the same driver, is sampled in the same
   windows. This checkout's hub may not spend more than 1.5 times the merge base's median per window, plus one
   hundredth for `ps` rounding. That is the design's regression rule ("a p50 more than 50% above the merge base's"),
   applied to the cost the session adds. A wake-up held by polling, such as a timer every 50 ms that reads the record,
   shows up here even when it stays under the hub's 0.5% budget.

The hub is compared **window by window**. The test takes this checkout's hub CPU minus the merge base's in the same
window, and that difference must stay under 50% of the merge base's median plus one hundredth. An earlier run of this
draft compared the raw per-window values against 1.5 times the merge base's median. It came out INCONCLUSIVE on the
control W0, because both hubs jumped to 0.50 s in the same window. Pairing the windows cancels what both hubs do at
once. That earlier run is the only change made after seeing a reading, and it made no wrong program pass.

**Compared with the merge base** therefore means two things. Both sides are measured by one driver on their own
builds, interleaved in the same five windows so that load hits both alike. The merge base's readings are printed
beside this checkout's. The hub's limit is taken from the merge base's median. The waiter's limit stays absolute,
because the criterion says "no CPU", not "no more than before". `mergeBase()` returns this checkout itself when its
code is the base's, and a missing merge base is BLOCKED.

**On the reference Mac.** Every timed judgement follows the design's rule: five runs, PASS when all are within the
limit, FAIL when all are over it by more than the margin, otherwise INCONCLUSIVE (helpers' `judge`). Readings count
only on a reference Mac with Low Power Mode off, a nominal thermal state, and a 1-minute load within its core count at
every window (helpers' `inconclusiveIfLoaded`). Anywhere else, or loaded, the test skips as INCONCLUSIVE with all
readings printed, never PASS. The instrument assertions come before that gate, because they aren't timings.

**In the local preflight.** A second test asserts that some check lane in `scripts/lanes.mjs` runs this file with
`--no-file-parallelism`. That can be the `alone` list naming `tests/acceptance/120/` or this file. Timed files run one
at a time there, as the lane's own comment says. The first draft's lane assertion names `budgets.test.ts`, so it can't
cover this file.

Readings not chosen:

- **"The hub at 0.5% of a core idle" as the bar for the session.** That is #16's budget for the whole hub. It would let
  a wake-up poll at 0.4% of a core. The criterion says the session costs no CPU.
- **A Codex session.** An observed Codex session has no waiter and its hooks never start a turn, so while it waits,
  DeepBuild runs nothing for it except the hub. The hub-side comparison would be the same, so the test uses Claude
  Code's session, which has both parts.
- **Minutes of real idling.** The 20-minute due time is never reached. Five 10 s windows sample the wait. AC2 already
  proves the wake-up then fires.

## Assertion → source sentence → wrong program

| Assertion | Source | Wrong program it fails on |
|---|---|---|
| `mergeBase()` resolves, else `BLOCKED: no merge base` | Criterion: "compared with the merge base"; invariant 2 | A clone with no `origin/main` passing silently |
| The promise is recorded as a wake-up (an event carrying the quote, not an echo kind) once the session stopped | "Commands end": "becomes a wake-up at that time, recorded with the quote it came from"; criterion: "while it waits" | The base (no wake-up). A program that waits for nothing and so costs nothing |
| A DeepBuild background entry of the session is live in every window, and still live after them | Design Memory row: "each Claude Code waiter ... no CPU while it waits"; adapter row: the waiter wakes an idle session | A program whose waiter exits at the stop, so nothing waits |
| No wake of the session while it is idle, and the wake-up still recorded | Criterion: "while it waits" | A program that wakes at once and so is never idle |
| Entries' CPU per 10 s window under 0.015 s (at most one `ps` hundredth), five runs judged | Criterion: "an idle session costs no CPU while it waits"; design: "no CPU while it waits" | `waiter-polls` (the waiter asks the hub every 50 ms); any waiter or helper of the session that spins or polls |
| The hub's CPU per window under 1.5 × the merge base's median + 0.015 s, five runs judged | Criterion: "compared with the merge base"; design: "a regression is a p50 more than 50% above the merge base's" | A hub that holds the wake-up by polling (a 20 ms timer reading the record); `waiter-polls`' hub side |
| INCONCLUSIVE skip off a reference Mac or under load, with all readings | Design: "Anywhere else the result is a reading, and the budget check is INCONCLUSIVE" | A loaded or non-reference machine reporting PASS |
| A check lane runs this file with `--no-file-parallelism` | Criterion: "in the local preflight" | A budget no preflight lane runs, or one run beside the parallel block |

## Wrong-program evidence

### The base (this checkout, `1cbecee8` = `5a6d09a4` + the first draft's suite)

`npx vitest run --root tests/acceptance/120 --no-file-parallelism budgets-idle-redraft.test.ts`, Node 24, workspaces
built and `target/debug/deep-hook` built (`cargo build --locked -p deep-hook`):

```
   × AC9 #120.a3880a7d in the local preflight: a check lane in scripts/lanes.mjs runs tests/acceptance/120/budgets-idle-redraft.test.ts with --no-file-parallelism 6ms
   × AC9 #120.a3880a7d a session idle and waiting for its promised check uses no CPU in its waiter, and its hub spends no more than the merge base's on the same idle session, over five 10 s windows 16235ms
AssertionError: AC9 #120.a3880a7d some check lane of the local preflight runs tests/acceptance/120/budgets-idle-redraft.test.ts one file at a time (--no-file-parallelism); lanes: typecheck, lint, unit, noop, catalogue drift, corpus, canvas kit, parity quick, proof, verdict proofs: expected [] to not deeply equal []
AssertionError: AC9 #120.a3880a7d the idle session waits for its promised check: "I'll check the deploy again in 20 minutes." is recorded as a wake-up once it stopped; the session's events: session.start, mcp.tools_listed, task.created, user.ask, tool.before, tool.after, agent.stop, claim.made, session.attention: expected undefined to be defined
 Test Files  1 failed (1)
      Tests  2 failed (2)
```

Both tests fail at their criterion's assertion, not at setup. The hub started, `deep setup` ran, the session worked,
stopped with the promise, and its waiter was live (otherwise `idleSession` would have thrown its `waitFor` timeout).

### Hand-built wrong programs

The base can't reach the CPU assertions, because it records no wake-up. So the job built the wrong programs by hand in
a throwaway copy, `/tmp/dh120-wrong`. That is an rsync of this checkout without `.git`, `node_modules` or `target`,
with `node_modules` linked and `deep-hook` copied. The copy was made its own git repository with commit A (the copy as
is) as `origin/main`. Each program is a commit on top of A, so `mergeBase()` builds A at `/tmp/dh120-base-<A>` and
compares the program with the unchanged base. Nothing in this checkout was changed for them. The copy and its base build were deleted after the runs. The patches are described here, and their scripts were in the job's scratchpad.

- **W0, the control:** the base's hub plus a hand-built wake-up recorder. A Stop whose last words say "again in N
  minutes" appends a `wakeup.set` event `{quote, due, times_set: 1, end}`. Its schema was added to the copy's
  `packages/contracts/schemas/`. It costs nothing while idle.
- **W1, `waiter-polls`:** W0 with the copy's `plant.ts` defaulting `plantOf` and `activePlant` to the base's existing
  plant `waiter-polls` (#25). Setup then writes the Node waiter, which asks the hub `session.wait` every 50 ms. This is
  an idle session that costs CPU in its waiter, and in the hub, while it waits.
- **W2, a polling hub:** W0 plus a 20 ms `setInterval` in the hub that reads the session's due wake-ups from the
  record. The waiter is unchanged. This is an idle session whose hub-side cost is CPU while it waits.

```
W0 (control; load at start 3.28)
idle readings: this checkout: entries 0.00, 0.00, 0.00, 0.00, 0.01 s, hub 0.39, 0.32, 0.29, 0.35, 0.29 s; the merge base 05c7af97fce3: entries 0.00, 0.00, 0.00, 0.00, 0.01 s, hub 0.39, 0.30, 0.28, 0.33, 0.25 s (CPU per 10 s window; loads 3.3, 3.1, 3.0, 2.8, 2.9, 3.1 on 8 cores)
PASS: the waiting session's DeepBuild entries, the waiter among them (CPU s per window): 0.00, 0.00, 0.00, 0.00, 0.01 s against under 0.015 s (margin 1000%)
PASS: the hub's CPU with the waiting session beyond the merge base's in the same window, against 50% of the merge base's median 0.30 s plus one hundredth (CPU s per window): -0.00, 0.02, 0.01, 0.02, 0.04 s against under 0.165 s
Tests  1 passed | 1 skipped (2)                      [the lane test filtered out with -t]

W1 waiter-polls (load at start 2.95)
idle readings: this checkout: entries 0.22, 0.16, 0.17, 0.19, 0.16 s, hub 0.62, 0.54, 0.58, 0.58, 0.61 s; the merge base 05c7af97fce3: entries 0.00, 0.00, 0.00, 0.00, 0.01 s, hub 0.30, 0.26, 0.29, 0.29, 0.34 s (loads 3.2 .. 3.3 on 8 cores)
FAIL: the waiting session's DeepBuild entries, the waiter among them (CPU s per window): 0.22, 0.16, 0.17, 0.19, 0.16 s against under 0.015 s (margin 38%)
FAIL: the hub's CPU ... beyond the merge base's in the same window: 0.32, 0.28, 0.29, 0.29, 0.27 s against under 0.16 s (margin 19%)
AssertionError: AC9 #120.a3880a7d an idle session costs no CPU while it waits: ... expected 'FAIL' not to be 'FAIL'
Tests  1 failed | 1 skipped (2)

W2 polling hub (load at start 3.27)
idle readings: this checkout: entries 0.00, 0.00, 0.00, 0.01, 0.00 s, hub 0.50, 0.48, 0.48, 0.49, 0.49 s; the merge base 05c7af97fce3: entries 0.00, 0.00, 0.00, 0.01, 0.00 s, hub 0.27, 0.27, 0.28, 0.27, 0.26 s (loads 3.8 .. 4.3 on 8 cores)
PASS: the waiting session's DeepBuild entries ...: 0.00, 0.00, 0.00, 0.01, 0.00 s against under 0.015 s
FAIL: the hub's CPU ... beyond the merge base's in the same window, against 50% of the merge base's median 0.27 s plus one hundredth: 0.23, 0.21, 0.20, 0.22, 0.23 s against under 0.15 s (margin 15%)
AssertionError: AC9 #120.a3880a7d compared with the merge base, the hub spends no CPU on the idle session: ... expected 'FAIL' not to be 'FAIL'
Tests  1 failed | 1 skipped (2)
```

## What was not done

- **No planted twin.** `twins.json` is the first draft's file and this job must not edit it. A twin folder no
  `twins.json` entry names is never run by the proof lane. The base already fails this test at its assertion, which
  satisfies the before lane. If a twin is wanted, `twins/idle-waiter-polls/packages/hub/src/plant.ts` defaulting to
  `waiter-polls` (W1's change) is the natural one. It would need `"#120.a3880a7d": ["idle-waiter-polls"]` added to
  `twins.json` by an approved proposal, and laid over the work it would also need the work's own wake-up.
- **The workspace's other binaries were not built.** Only `deep-hook` was built (`cargo build --locked -p deep-hook`),
  to stay within the disk this Mac has free (18 GB, 96% used). The suite runs no other binary.
- **Exited processes' CPU isn't counted.** `ps` reads only live processes. A program that spends its idle CPU in
  short-lived children that exit inside a window is missed, except through the hub's group when the hub forks them.
- **Memory isn't asserted.** "Each Claude Code waiter under 5 MB" is the design's, not this criterion's.
- **The hub's own idle use hides small regressions.** At the base, each test hub used about 0.25 to 0.40 s of CPU per
  10 s (about 3% of a core) with one idle session, on this Mac at loads 3 to 5. That is a reading, not a judgement:
  it is far above #16's 0.5% and is #16's matter. Against it, the 50% rule lets through extra hub CPU up to about
  0.15 s per 10 s (1.5% of a core). W2's 20 ms poll added about 0.2 s and failed. A lighter poll would pass. The
  waiter's own budget stays absolute.
- **Load and run count.** Every timed run waited for a 1-minute load under 6. Runs: the base twice (both failed at the
  instrument before any timing). W0 three times: once skipped INCONCLUSIVE because the load went past the cores
  while the merge base was built, once INCONCLUSIVE under the earlier unpaired hub rule, and once PASS. W1 once
  (FAIL). W2 once (FAIL). No run was retried to get a result.
- **Not rerun at full length.** The lane test and the idle test were never run together on a program that passes
  both, because no program here has a lane for this file.
