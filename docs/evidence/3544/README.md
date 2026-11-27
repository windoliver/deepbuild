# #3544: what was run

On the branch at `e7e8cd794` (main `73cbec37f` merged in), 2026-11-26 and 27 UTC, on a Mac17,10 with macOS 27.2 and
Node 24.22.0. Every build and test ran under a grant of the machine's throttle. Loads are the one-minute load on 18
cores, from other sessions' work.

## The blind suite

- **On the base `2edb19ff4`**, by the blind job: 6 of 6 fail, each at an assertion of its own, in 9.8 s
  (`tests/acceptance/3544/BASE-FAILURE.txt`).
- **On the change's own build** (`npm run build --workspaces`, `cargo build --locked -p deep-hook`), load 9 to 12:

  ```
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/3544 --no-file-parallelism
   Test Files  2 passed (2)
        Tests  6 passed (6)
     Duration  51.18s (tests 100%)
  ```

  The machine's cleanup had emptied `target/` since the build, so the run put back a copy of that build's own deep-hook
  first.

## The proof lanes

`node scripts/proof.mjs guard before trace`, 1,330 s, each side built in a bay:

```
PASS before: tests/acceptance/3544/budget.test.ts › #3544.37bd1895 …: failed on the merge base at its assertion
PASS before: tests/acceptance/3544/rebuild.test.ts › #3544.93bc058e …: failed on the merge base at its assertion
PASS before: tests/acceptance/3544/rebuild.test.ts › #3544.efcb2f1f …: failed on the merge base at its assertion
PASS before: tests/acceptance/3544/rebuild.test.ts › #3544.916857a5 …: failed on the merge base at its assertion
PASS before: tests/acceptance/3544/rebuild.test.ts › #3544.7b62fddb …: failed on the merge base at its assertion
PASS before: tests/acceptance/3544/rebuild.test.ts › #3544.99834caf …: failed on the merge base at its assertion
PASS trace: Part of #3544: each of its 6 criteria has a tagged test that ran, passed and failed on a wrong program
FAIL guard: tests/acceptance/3544/README.md: 32 lines removed or changed (commit e7e8cd794584)
FAIL guard: tests/acceptance/3544/twins/README.md: 2 lines removed or changed (commit e7e8cd794584)
```

The guard's two lines are the blind job's own edit: after its base run it wrote what the run showed into its README
and the twins' README, in a commit of its own that touches only the suite's files. It waits for the maintainer's
signed tag.

## The planted wrong programs

Every test failed on the merge base, so the lane laid no twin. Each was run by hand under the suite's test grant: its
wrong lines laid over the work tree, the one file it changes emitted into the built package with
`ts.transpileModule`, its criterion's test run, and the work's lines and built file put back. All six fail where
`tests/acceptance/3544/twins/README.md` says:

| Twin | Test | It failed with |
|---|---|---|
| `start-waits-once` | `#3544.93bc058e` | `deep hub start --root exited 3 2642 ms after it started … having printed 2 rebuild sentences (events replayed: 0, 5000)` |
| `start-waits-while-socket-answers` | `#3544.efcb2f1f` | `it had not exited at this test's deadline, 30 s after it started, 27430 ms after it printed that 10000 events were replayed` |
| `status-waits-for-core` | `#3544.916857a5` | `deep hub status exited 3 25066 ms after it started, and reported no rebuilding` |
| `deep-prints-zero-asks` | `#3544.916857a5` | `deep prints no count of asks while the hub rebuilds, since none can be read: it printed "0 asks"` |
| `drops-acknowledged-hooks` | `#3544.7b62fddb` | `the hub acknowledged hook 01M8D8NVQPJVBBFTPFR9QZWGEM while it rebuilt, number 1 of the nineteen sent then … the record holds 0 events with that ID, not one` |
| `rebuilds-on-every-open` | `#3544.99834caf` | `after the replay the hub's health holds one reading of it, in rebuilds … expected 2 to be 1` |

## The rebuild's time, as a reading

#2687's month fixture is not built yet, so this stands in for it: 1,000,000 events of one session (a start, a prompt
and `tool.after` events, as `benchmarks/record.mjs` writes them) appended through `openRecord`, then one projection's
column renamed in the closed file and the record opened again. Under a test grant, load 9:

```
{"events":1000000,"bytes":521613312,"write_ms":31403,"open_ms":8117,"told":203,"load_before":9.4,"load_after":9,"rebuilds":[{"table":"commits","events":1000000,"ms":7620}]}
```

The rebuild took 7.6 s of an 8.1 s open, and the record's own reading says so. A reading, not a budget: the criterion
`#3544.37bd1895` is the budget window's to measure, 20 samples a side, through `record-replay-100k`.
