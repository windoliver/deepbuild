# Acceptance test for #2848, redrafted for #3221: a later build in a long `affected.mjs` run gets its full compile share

A blind redraft of `tests/acceptance/2848/` (design: Dogfooding), needed because issue #3221 changes the design that
test was written against. It was written from issue #2848 (its Expected line and its "To confirm" step), the text #3221
gives `docs/parallel-proof.md` sections 6, 7a and 13, issue #3221 for the pool's context, AGENTS.md, and the repository
at the base `f8c6cff82`, where it read the original suite and `scripts/` and #1115's and #2574's helpers only to learn
the surfaces it drives. No implementation of #3221 existed or was read. It reuses #1115's sandbox, scratch tree and
`dump` and #2574's `start` (imported, not edited), as the original does. The implementing agent does not edit these
files (AGENTS.md, Proof).

## Why a redraft, and what changed

The original tests the criterion against the design of its time: every `affected.mjs` run made a jobserver of its own,
`cores - 1` tokens less one per shard, shared by all the run's jobs and filled again between jobs. Under #3221 there is
no run's own jobserver. Each job of an admitted run takes a turn on the machine's pool of job tokens (a core less one,
the cores being a test's own table's readings' when it has them), and its `throttle.mjs` gives its command a jobserver
of the job's own, a named pipe through `CARGO_MAKEFLAGS` that starts empty: cargo runs its first compile on the turn,
and the rest on tokens the pipe is lent from the pool each second, up to an even share (the pool over the turns held,
less the turn's own) while no job waits for a turn. A token a killed build held is lost to its job alone, and the pool
has it back once the job ends. So two of the original's preconditions, that two jobs of a run hand out one fifo and that
the share is `cores - 1`, no longer describe the design, though #2848's criterion still applies to it. This redraft
reads "the run's share" and "the run's jobserver" as a build's share and its job's pipe, and keeps the original's
scenario (a long run, a client holding tokens SIGKILLed in an earlier job, a later build that counts what its pipe
holds, held plus free never above the share). It changes six things:

- **A pipe each.** The original asserted the holder's and the killer's jobs, running at once, got the same fifo. This
  one asserts they got different ones, as each job's own pipe.
- **The share is the pool's.** The run's table is the test's own (`DEEP_THROTTLE_TABLE` in the sandbox, with the
  sandbox's HOME) and reads `DEEP_THROTTLE_READINGS`, a file of `{"memory": 2^40, "load": 0, "cores": 13}`. So the pool
  is 12 tokens and a job alone on it, as the later job is, has a share of 11: the pool less its own turn. With two turns
  held each job's share is 5, room for the 2 and 3 tokens the planted clients take. The original's share was
  `os.availableParallelism() - 1`; this one doesn't depend on the machine, which no longer needs 7 cores.
- **Waiting for the pipe to fill.** A job's pipe starts empty and is lent each second, so the later job reads until it
  has the share or has read nothing for 120 s, then takes whatever more it is lent until its pipe stays empty for 5 s
  (the original read once until 3 s passed with nothing). The holder still lets the pool settle 10 s after the killed
  client's job has ended, then counts until 5 s pass with nothing. Each reader stops at four times the pool, so a pipe
  topped up without end still ends its count.
- **The client opens the pipe read and write**, as cargo does. Opened read-only, as in the original, the open waits for
  a writer and a read past the last writer's close returns nothing, which the client would take for a token; a job's
  own pipe needn't have a writer between lends.
- **"Or the run says it cannot"** is a `BLOCKED` or `INCONCLUSIVE` summary with a `BLOCKED` or `INCONCLUSIVE` line that
  names the jobserver, the pool or its tokens. The original searched the whole output for "jobserver", where a file name
  on the run's `TIMED` line could match. Under #3221 the run has no loss to report, so a passing run counts the share.
- **No throttle setting from outside.** Every `DEEP_THROTTLE*` variable of the test's own process is taken out of the
  run's environment, as `CARGO_*`, `MAKEFLAGS` and `MFLAGS` already were.

## What `share.test.mjs` checks

One test, tagged with the criterion as the original is (`#2848 AC`): "A build in a long `affected.mjs` run gets the
run's full compile share, or the run says it cannot, even after a jobserver client holding tokens was SIGKILLed earlier
in the run; and the run's jobserver never holds more than that share."

- **An `affected.mjs` run.** This checkout's real `scripts/` run in a scratch git repository made by #1115's `tree()`
  (the lint lane's own scripts stubbed, cargo stubbed, links to `node_modules`), with the sandbox's HOME and TMPDIR, the
  table and readings above, as `node scripts/affected.mjs <three planted files>` in its own process group, from inside
  this `node --test` run. It runs with `DEEP_SHARDS=1` and one alone file, so it has no shards.
- **A jobserver client holding tokens, SIGKILLed earlier in the run.** Two planted files run in the parallel block, as
  two jobs at once. The *holder* (vitest, `tests/fixture-2848/holder.test.ts`) opens the fifo its `CARGO_MAKEFLAGS`
  names (`--jobserver-auth=fifo:<path>`) and takes 2 tokens. Once it holds them, the *killer* (`node --test`,
  `tests/fixture-2848/killer.test.mjs`) starts a client that opens its own job's fifo, reads 3 tokens and keeps them,
  as a compiling cargo does, and SIGKILLs it, as a timed-out test's `spawnSync(..., { killSignal: 'SIGKILL' })` or a
  stopped job's tree kill does. The client never writes its tokens back. A planted reader stands for cargo: what loses
  tokens is a reader that dies holding them, whoever it is, and it is fast and exact on a loaded machine.
- **A build later in the run.** A third planted file (`node --test`) sits in the first folder of `lanes.mjs`'s `alone`
  list where it is neither exclusive, timed, slow, left to a person nor in a lane of its own, so it runs in the worktree
  after the whole parallel block has ended, alone on the pool. It waits for its pipe to fill as above, notes how many
  tokens it was lent, and writes them back. That count is the issue's "count the tokens after a run in which a cargo
  holding tokens was SIGKILLed": a build at that point can run that many compiles past its first.
- **Gets the full share, or the run says it cannot.** The test passes when the later job was lent exactly 11, or when
  the run says it cannot as above. A run that reads `PASS` with a short pipe fails.
- **Preconditions.** Before it judges a count the test asserts every planted part did its job: the holder took 2
  tokens, the client took 3 and was SIGKILLed, the two jobs had different pipes, the killer's job (its `node --test`
  runner) ended while the holder still held, and the later job ran after that, in the worktree (so the run had no
  shard).

## Never more than the share

- The holder keeps its 2 tokens across the killed client's death and its job's end, waits 10 s more, then drains its
  pipe. With the killer's job ended it is alone on the pool, so held plus free must be at most a lone job's share, 11. A
  program that tops a job's pipe up to the share whatever its builds already hold gives 2 + 11 = 13 there and fails.
  If the killer's turn were still held at that count, the right share would be 5, still under 11, so a late turn never
  fails a right program.
- The later job's count must be at most 11, so a program that lends a lone job the whole pool (12, forgetting its own
  turn) or the machine's cores in place of the readings' fails too.

These wrong programs are read off the design, not run: no implementation of #3221 existed to plant them in. A program
whose pool never gets the killed client's 3 tokens back would lend the later job 8 and fail at the last assertion.

It does not rule out a program that over-lends only while two or more turns are held (the holder counts alone), one
that lends across runs unevenly, or one whose timed blocks compile on the pool.

## Base (`BASE-FAILURE.txt`)

The saved run is at `6bed8c627`, main's tip when this was written, whose `scripts/` are `f8c6cff82`'s but for one
`byHand` line of `lanes-lists.mjs` (#1841's redraft); on the Mac, 18 cores, at a one-minute load of 30. It exits 1
after 24 s, failing at the precondition that the two jobs running at once had a pipe each: the base has no pool, and
every job of a run is handed the run's one jobserver. The diagnostics above the failure show the counts. That jobserver
held 17 tokens (the machine's 18 cores less one; the base doesn't read the test's readings for it), so the holder held 2
and found 12 more, 14 in all, and the later job found 14, the 17 less the 3 the SIGKILLed client took. Past the
preconditions it would fail at both "never more than the share" assertions too, 14 being over a lone job's share of 11. On this Mac the base's `fuser` can't see the fifo, so the base never filled its pipe again: it printed its
`JOBSERVER` line at the start and read `INCONCLUSIVE jobserver: 3 of the run's compile tokens were missing …`, the
criterion's "says it cannot", so the last assertion alone would pass there.

## Run

```sh
npm ci   # once, if node_modules is missing
node --test --test-reporter=spec tests/acceptance/2848-redraft-3221/share.test.mjs
```

It needs no cargo or Rust toolchain, works offline, and runs on any number of cores. It allows the run 40 minutes.
