# Acceptance test for #2848: a later build in a long `affected.mjs` run gets the run's full compile share

A blind job wrote this test before any fix for #2848 existed, from issue #2848 (its Expected line and its "To confirm"
step), AGENTS.md, the design's Dogfooding section and its compile job pool text, and `docs/parallel-proof.md`'s
"Compiles at once (#2741)", at base commit `8005f72fb`. It read `scripts/affected.mjs`, `scripts/shards.mjs`,
`scripts/throttle.mjs` and `scripts/lanes.mjs` there only to learn the surfaces it drives (the `CARGO_MAKEFLAGS` a job
gets, `DEEP_SHARDS`, the blocks and lists), and reuses #1115's sandbox and scratch tree and #2574's `start` (imported,
not edited). The implementing agent does not edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job.

## What `refill.test.mjs` checks

One test, for the criterion: "A build in a long `affected.mjs` run gets the run's full compile share (a token per core
less one, less one per live shard), or the run says it cannot, even after a jobserver client holding tokens was
SIGKILLed earlier in the run; and the run's jobserver never holds more than that share."

- **An `affected.mjs` run.** This checkout's real `scripts/` run in a scratch git repository made by #1115's `tree()`
  (the lint lane's own scripts stubbed, cargo stubbed, links to `node_modules`), with a HOME and TMPDIR of the
  sandbox's, as `node scripts/affected.mjs <three planted files>` in its own process group. No `CARGO_*`, `MAKEFLAGS`
  or `MFLAGS` reaches it from the test's process, so its jobserver is the code under test's. It runs with
  `DEEP_SHARDS=1` and one alone file, so it has no shards and its share is `cores - 1` (19 on the Spark's 20).
- **A jobserver client holding tokens, SIGKILLed earlier in the run.** Two planted files run in the parallel block, as
  two jobs at once. The *holder* (vitest, `tests/fixture-2848/holder.test.ts`) opens the fifo that `CARGO_MAKEFLAGS`
  names (`--jobserver-auth=fifo:<path>`, GNU make's named-pipe form, which cargo reads) and takes 2 tokens. Once it
  holds them, the *killer* (`node --test`, `tests/fixture-2848/killer.test.mjs`) starts a client that opens the same
  fifo, reads 3 tokens and keeps them, as a compiling cargo does, and SIGKILLs it, as a timed-out test's
  `spawnSync(..., { killSignal: 'SIGKILL' })` or a stopped job's tree kill does. The client never writes its tokens back.
  A real cargo isn't needed for this: what drains the pipe is a reader that dies holding bytes, whoever it is, and a
  planted reader is fast and exact on a loaded machine.
- **A build later in the run.** A third planted file (`node --test`) sits in the first folder of `lanes.mjs`'s `alone`
  list where it is neither exclusive, timed, slow, left to a person nor in a lane of its own, so it runs in the
  worktree after the whole parallel block has ended, with no other job of the run live. It drains the pipe without
  blocking (reading until nothing more comes for 3 s), notes how many tokens it got, and writes them back. That count
  is the issue's "count the tokens after a run in which a cargo holding tokens was SIGKILLed": a build at that point
  can run that many compiles past its first.
- **Gets the full share, or the run says it cannot.** The test passes when the later job counted exactly the share,
  or when the run's summary line is `BLOCKED` or `INCONCLUSIVE` and its output names the jobserver. A run that reads
  `PASS` with a short pipe fails. The test doesn't pin how a fix says it; a redraft can if that proves too loose.
- **Preconditions.** The test asserts every planted part did its job before it reads a count: the holder took 2
  tokens, the client took 3 and was SIGKILLed, both jobs got the same fifo, the killer's job (its `node --test` runner)
  ended while the holder still held, and the later job ran after that in the worktree (so the run had no shard).

## Over-provisioning

A wrong program that "fixes" the drain by topping the pipe up to its count whenever a job ends, while another build
still holds tokens, would make the later job's count right and the run compile more than its cores. The test rules
that out twice:

- The holder keeps its 2 tokens across the killed client's death and its job's end, waits 10 s more, then drains the
  pipe without blocking. Held plus free must be at most the share. A refill at the killer's job end with the holder
  live gives `share + 2` and fails; the right program (refill only while no build of the run is live, as the design's
  host pool says, "the pipe is filled to its count only while no leased command runs") gives `share - 3` there.
- The later job's count must be at most the share, so a program that writes extra tokens back (for example, a fixed
  `give` at each job's end) fails too.

Before delivery the blind job checked both directions on scratch copies of the base's `scripts/` (never committed):
one that drains the pipe and writes it back to `cores - 1` just before the worktree's alone block, with no job live,
passed (the later job found 19 of 19); one that does the same each time any job ends failed at the first check
(held 2 plus 19 free, 21 in all, on a share of 19).

The two parallel jobs must also share one fifo, so a program that hands each concurrent job a full pipe of its own
fails. It does not rule out a program that over-provisions only with shards live (this run has none), or one that
refills while a build outside the run's jobs holds tokens.

## Run

```sh
npm ci   # once, if node_modules is missing
node --test --test-reporter=spec tests/acceptance/2848/refill.test.mjs
```

It needs no cargo or Rust toolchain, works offline, and needs at least 7 cores. It allows the run 40 minutes.
`BASE-FAILURE.txt` is its output at the base, where every precondition holds and it fails at its last assertion: the
later job found 16 of the run's 19 tokens (19 less the 3 the SIGKILLed client took) while the run read `PASS`. It took
31 s at a one-minute load of about 220 on 20 cores.
