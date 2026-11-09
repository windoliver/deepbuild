# Blind redraft of #531's thread-count criterion

`AC12 #531.ff4975c5`: "Ten logic items at 60 Hz run 1,000 steps with the process's thread count unchanged from step 1
to step 1,000"

Written fresh from the criterion by a job that never saw an implementation of #531, a diff, or any other test of this
criterion (not `tests/acceptance/531/ac12-threads.test.ts`, not `programs.ts`; only its one-line row in 531's README
table). The implementing agent doesn't edit these files; a dispute goes to another blind redraft (AGENTS.md, Proof;
design: Dogfooding).

What was read: issue #531 (Scope's last line: "A step at run time starts no thread: fuel bounds it", with `Runner::call`'s
deadline thread at `crates/deep-sandbox-wasmtime/src/lib.rs:165-173` and "600 spawns a second"; Fields: logic@1's exports
and `budget: {fuel: per step = 1,000,000, memory: MiB = 4, stack: KiB = 64}`); its Oracle page (criterion 12 has no
upstream test); `docs/canvas-primitives.md` (Logic `logic@1`; Logic: sandbox, the rewrite: "each block charges its
instruction count to the step's fuel"); `docs/technical-design.md` (The logic module: Logic, Sandbox and budgets);
`AGENTS.md`; and, restored from the #531 suite's commit `9e44bd99`, `tests/acceptance/531/README.md` (The surface under
test: `deep-logic`, `open` and `step`, Sessions, Pieces, Gates), `helpers.ts` (imported here, not copied: `assemble`,
`piece`, `live`, `threadsOf`, `admitted`, `AC`, `TIMEOUT`, `prebuild`, `logicBin`), `tsconfig.json` and `wat/`, at base
`dd83ac2f` (checked out as `86245f1f`, which adds only main's merge of #1727 for #1492).

## Run it

As `tests/acceptance/531/README.md` (Run them): `npm ci` once, rustup's cargo (helpers.ts puts
`/opt/homebrew/opt/rustup/bin` on cargo's PATH when present). Then, from the repo root:

```sh
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/531-redraft-ac12 --no-file-parallelism
npx tsc -p tests/acceptance/531-redraft-ac12/tsconfig.json
```

It builds the 531 suite's assembler (`tests/acceptance/531/wat`, into `target/acceptance-531-wat/`) and `deep-logic`
(`cargo build --locked --bin deep-logic`), and needs nothing else: no Docker, no Chrome. The test counts a process's
threads, so it belongs in `scripts/lanes.mjs`'s `alone` list beside `tests/acceptance/531/`. One test, timeout
`TIMEOUT` (90 minutes, from helpers.ts). The `deep-logic` process is stopped by its PID.

## What the test asserts

`ac12-threads.test.ts`, one piece of ten items `busy0` … `busy9`, each `step_rate: 60`, writing `n: i32`, reading
nothing, all running the program `busy` below with logic@1's default budgets (no `budget` field):

1. One long-lived `deep-logic` process (`live()`). `open` admits exactly the ten items and answers a session.
2. `step` to 1 answers `{ok: true, step: 1, failed: []}`. Then the process's thread count (`threadsOf`: `ps -M -p
   <pid>`) is read once: the baseline, a positive integer.
3. `step` to 100, 200, …, 1,000 (ten calls). While each call is in flight the test reads the thread count again and
   again; after each reply it reads it once more. Each reply is `ok`, names the step asked for, and has `failed: []`
   (no item trapped, so all ten ran every step).
4. Every reading, during and after, equals the baseline; the failure lists each reading that differs and when it was
   taken.
5. If fewer than 20 readings were taken while steps ran, the test skips as `INCONCLUSIVE` (the 531 README's gate); a
   changed count (4) or a failed item (3) still fails first.

Wrong programs it fails on:

- **A deadline watchdog per step call** (a thread spawned for each `step(k)` call, as `Runner::call` does, joined after):
  a step of `busy` spins for about half its fuel, so during the run the watchdog is on the process for much of the time
  and some readings during the calls show baseline + 1.
- **A thread per item at run time** (each step's items run on threads started for that step): readings during the calls
  show up to baseline + 10.
- **Threads that pile up** (a watchdog that is detached and sleeps out its deadline, or a pool grown after step 1): the
  readings after the replies differ too.

A stand-in, not the implementation, checked that the readings see these: a small Rust program in the session's scratch
folder answering `open` and `step` as above, spinning about 0.13 ms per item step, driven by this test's loop. With no
threads: 289 readings during the calls, all equal to the baseline. With a watchdog thread per item step: 104 of 332
readings differed (1 against 2). With ten scoped threads per step: 19 of 54 differed (up to 11). Not committed.

## Fuel

The program (WebAssembly text in the test file, assembled by the 531 suite's assembler; 187 bytes, no imports, no start
function, no table; one memory of one page whose maximum is its minimum, under the 4 MiB default; immutable i32 globals
`reads_at = 0` and `writes_at = 64`; exports `memory`, `init(seed: i64)` with an empty body, `step(k: i64)`). `step`
counts a local down from 100,000 and stores `k` as an i32 at `writes_at`. Its 14 operators as the assembler lists them:

```text
i32.const 100000, local.set, loop,                       charged once:            3
  local.get, i32.const 1, i32.sub, local.tee, br_if        each iteration:  5 x 100,000 = 500,000
end (loop), global.get, local.get, i32.wrap_i64, i32.store, end   once:            6
```

The design's rewrite charges each block its instruction count, so a step costs 500,009 fuel. If the rewrite also
charged the loop's own `loop` and `end` on every iteration, it would be 7 × 100,000 + 7 = 700,007. Either way it is
under logic@1's default 1,000,000, so no item traps and all ten run all 1,000 steps. `init` is one operator (`end`).
The default stack (64 KiB) holds `step`'s single frame of a parameter, a local and two value-stack slots many times over.

The work per step is set by the readings, not by the budget: in Node's own WebAssembly (no fuel counting) on this loaded
Mac, ten instances over steps 0 to 1,000 took 3.6 s and `ps -M` took about 55 ms a reading, so ten calls of 100 steps
give about 60 readings while steps run, three times the 20 the gate needs. A runner that counts fuel runs slower and is
read more often.

## Where this reads the surface differently from 531's README

- **"From step 1 to step 1,000"**: the baseline is read after `step` to 1 returns, and readings run until `step` to
  1,000 returns. A runner that starts its threads at `open` or step 0 and keeps them is within the criterion's text and
  passes; the issue's Scope ("a step at run time starts no thread") is wider than this criterion.
- **Ten calls of 100 steps** instead of one call to 1,000, so readings are also taken between calls, where a thread that
  outlives its call shows.
- **The 20-reading gate** counts only readings taken while a `step` call was in flight, since a thread that lives only
  during a call can't be seen between calls.
- **`failed: []` at every reply** is how "run 1,000 steps" is read: the session's `step` reply carries no arrays.
