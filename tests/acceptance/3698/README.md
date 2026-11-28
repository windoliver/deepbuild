# Acceptance tests for #3698: the pool lends what the even shares leave free, so it is dealt whole

Drafted blind, before any implementation, from these inputs only:

- issue #3698 (What happened, the decision, "Decided: option A" and its three acceptance criteria);
- `docs/parallel-proof.md` section 6, "A turn's compiles", as commit `9dbf643e0` words it for #3698 (`git show
  9dbf643e0`);
- `AGENTS.md`, `CONTRIBUTING.md` and `GLOSSARY.md`;
- the base commit `254bdc87c`, for surfaces only: `scripts/throttle.mjs` (its CLI, a test's own table through
  `DEEP_THROTTLE_TABLE` and `DEEP_THROTTLE_READINGS` under `node --test`, the table file's `grants` and `requests`, a
  turn's class `turn` and its `lent`, a turn's command's `CARGO_MAKEFLAGS`), how `scripts/proof-change.mjs` derives a
  criterion's ID, and for shape the suites `3694`, `3549` and `3221`.

No test imports the code under test: `scripts/throttle.mjs` runs as a process, found from the test files' own place in
the tree, so the suite runs in any copy of the tree. Per AGENTS.md the implementing agent doesn't edit these files; a
dispute goes to a blind redraft. The suite needs no `lane.json`: every test has a table and a sandbox of its own.

## Run

```sh
node scripts/throttle.mjs test --stall 60 -- node --test --test-concurrency=1 --test-reporter=spec tests/acceptance/3698/*.test.mjs
```

The files must run under `node --test`: only inside a test run does a table of a test's own exist (section 6). The
suite needs no `node_modules` and no cargo. It takes about a minute.

**The machine's table at `~/.deepbuild/throttle/` is never read or written.** Every process a test starts gets
`DEEP_THROTTLE_TABLE` pointed at a fresh folder in the test's sandbox under the system's temporary folder,
`DEEP_THROTTLE_READINGS` pointed at a readings file there, a `HOME` and `TMPDIR` there, and no `DEEP_` variable of the
test run's, nor its `NODE_TEST_CONTEXT`, `CARGO_MAKEFLAGS`, `MAKEFLAGS` or `MFLAGS`, unless the test sets one. The run
starts in a process group of its own, its jobs in it. At a test's end every stub is told to stop by a file, and 5 s
later what is left is stopped by the run's process group ID. Nothing is stopped by name or port. Failure messages
write the checkout `<checkout>`, the sandbox `<sandbox>`, the temporary folder `<tmp>` and every home folder `~`.

## The surface

- **The readings** are `{"load": 57, "cores": 18, "memory": 50e9}`: the issue's 18 cores, so the pool is 17 tokens (a
  core less one of the readings' cores, section 6). The load and memory only let the run in.
- **AC1's world** is one admitted run, `DEEP_THROTTLE_RUN=0 node scripts/throttle.mjs test --wait 1 -- node stub.mjs
  run drive <steps>`, that starts 13 jobs at once, each `node scripts/throttle.mjs test --wait 10 -- node stub.mjs
  job-<k> hold` under the run's `DEEP_THROTTLE`, so each passes through on the run's grant and waits for a turn
  (section 6, Turns on one pool). A job's stub never opens the pipe its `CARGO_MAKEFLAGS` names, so it takes no token
  and every token lent to its turn stays in its pipe unread. With 13 jobs on 17 tokens no turn request waits once all
  13 hold.
- **The thirteenth turn's grant** is the 13th `turn` entry of the table's `log`, by its `at`.
- **`lent` and the waiting requests** are read from the test's own `table.json`, every 20 ms: each `grants` entry of
  class `turn` with its `lent`, and each `requests` entry of class `turn`. `Σ(1 + lent)` is summed over the turns of
  one reading.

## How I read each criterion

| Criterion | File | How it is read |
|---|---|---|
| AC1 `#3698.0e17c600` | `dealt.test.mjs` | Readings from the thirteenth turn's grant to 15 s after it all show 13 turns and no turn request (the criterion's world). "Reaches 17 within 10 s and stays at 17": the readings from some point no later than 10 s after the grant to the end of the 15 s all read `Σ(1 + lent)` = 17, so it holds at least 5 s. A dip before that point is read as the pool still settling, not a failure. |
| AC2 `#3698.105149b0` | `least-lent.test.mjs` | The same world and readings. "Once the pool is dealt": from the reading where `Σ(1 + lent)` reached 17 for good (no later than 10 s after the grant, else the test fails as never dealt) to the end, every reading's highest `lent` is at most one above its lowest. |
| AC3 `#3698.63fa498a` | `waiting.test.mjs` | The same world with a fourteenth job the run starts only on a go file. Once the pool has read 17 for 2 s, or 15 s after the thirteenth turn's grant, whichever comes first, the fourteenth job is let go; it asks through the run's grant (its `passed` entry). "No turn's lent rises while it waits": between any two consecutive readings that both hold its turn request, no turn's `lent` is higher in the later one. "It gets its turn once the lent tokens come back": its command starts within 30 s of its `passed` entry, and the first reading that holds its turn has `Σ(1 + lent)` over the 14 turns at most 17. |

## On the base

`BASE-FAILURE.txt` holds the base run. AC1 and AC2 fail at their own assertions for the issue's reason: every turn
read `lent: 0` and `Σ(1 + lent)` stayed at 13, so 4 tokens went to nobody. **AC3 passes on the base**: with nothing
lent beyond the even share of 0, the fourteenth job got its turn at once (its request was never read waiting) and no
`lent` rose. Its planted lender is the twin that shows the test can fail.

## Planted twins (`twins.json`)

Each twin under `twins/<name>/scripts/throttle.mjs` replaces `scripts/throttle.mjs` with a program this blind job
wrote: the base's `throttle.mjs` with option A in `lender()` (while no turn request waits, after the even share, one
more token at a look to the looking turn when its `lent` is the least of the turns' and the pool has one free), and
then one rule changed, marked `Planted:`.

| Twin | Criterion | What it gets wrong |
|---|---|---|
| `keeps-even-share` | AC1 | No remainder is dealt: a turn is lent up to `floor(pool / turns) − 1`, the base's rule. |
| `whole-remainder-first` | AC2 | The whole remainder goes to the first turn that looks. |
| `deals-while-waiting` | AC3 | The remainder is still dealt while a turn request waits. |

`TWINS-RUN.txt` holds each twin's run of the whole suite. The same program with no planted change (kept outside the
checkout, never committed) passed all three tests.

`deals-while-waiting` fails AC3's test before the fourteenth job asks. The run's own jobs ask one after another, and
on this twin, once `Σ(1 + lent)` reaches 17 while one of them waits, each look takes its lent tokens back and deals
them out again, so the waiting job never gets a turn: the run is stuck at fewer than 13 turns. That is the fault the
criterion names, seen on an earlier waiting job, and the test fails at the assertion that the world's 13 turns were
granted. It fails AC1's and AC2's tests the same way.

## What I ran

On the Mac (18 cores), 2026-11-28 UTC, each program once, one after another, each as the Run command above under a
grant of the machine's (each came within seconds), at 1-minute loads of 56 to 148:

| Program | dealt (AC1) | least-lent (AC2) | waiting (AC3) |
|---|---|---|---|
| base `254bdc87c` | fail | fail | pass |
| unplanted option A (outside the checkout) | pass | pass | pass |
| `keeps-even-share` | fail | fail | pass |
| `whole-remainder-first` | pass | fail | pass |
| `deals-while-waiting` | fail | fail | fail |

After the runs, two `// deadline:` comments went into `helpers.mjs` for `scripts/wait-ratchet.mjs`, on its two
timers; nothing that decides a test changed. **Not run:** the suite on the Linux machine; `scripts/affected.mjs`, a
lane or a preflight; `scripts/comment-ratchet.mjs`, which needs `node_modules` this worktree doesn't have.

## Gaps and assumptions

- **One run's 13 jobs, not 9 jobs and 4 builds.** The criteria name 13 turns held by jobs that take no token; whose
  turns they are doesn't change the lender's arithmetic, and one run keeps the world to one admission.
- **"Stays at 17 while none waits"** is read for at least 5 s after it is reached, not indefinitely.
- **"Least-lent first"** is read as its outcome (lent spread at most 1 once dealt), not the order tokens went out.
- **AC3's "once the lent tokens come back"** is read as its turn fitting in the pool when it is first read granted.
  The 30 s bound is the test's: the issue gives none, and a lender looks once a second.
- **Readings 20 ms apart** can miss a rise and fall between two of them, and a look that takes a turn's tokens back
  and lends them again in one write shows no rise at all. So AC3's test leans on the waiting job's turn: a lender
  that keeps the pool dealt while a turn waits never frees one.
