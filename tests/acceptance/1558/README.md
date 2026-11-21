# Acceptance tests for #1558: `deep lease` waits forever for a process group whose leader has exited

Written first, blind, by a job that never saw an implementation of #1558. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read:

- Issue #1558 as the dispatching job gave it: the report (the Mac, 2026-11-06, #1119's R3), the three acceptance
  criteria and the expected values (exit code 3; return under 5000 ms; `lease.acquired` once; `lease.released` absent
  while the child lives and present within 5 s of its SIGKILL).
- `docs/technical-design.md` at the base: Lease and Dogfooding; AGENTS.md.
- At the base (`9d025613`): `packages/hub/src/heavy.ts` (`leaseCommand`, `runGroup`, `unleased`, the `DEEP_LEASED`
  path, `HeavyQueue.started`, `exited` and `tick`), `packages/cli/src/main.ts`'s `lease` entry, the hub's 500 ms
  heavy tick in `core.ts`, `scripts/proof-change.mjs` (criterion IDs), and the harnesses reused here:
  `tests/acceptance/1015/helpers.ts` (the world: temp home, hub as a process, memory pressure pinned normal, the
  record's leases folded from `lease.acquired` / `lease.released`) and `tests/acceptance/18/mapping/helpers.ts`
  (`cleanEnv`, `alive`, the built CLI's path), both imported, never edited; `tests/acceptance/2328/` for layout.

## Run it

```sh
npm ci                            # once
npm run build --workspaces        # `deep lease` and the hub run from packages/cli/dist
cargo build --locked -q -p deep-hook --features env-plants   # #1015's world builds it before the hub; a no-op after this
node node_modules/vitest/vitest.mjs run tests/acceptance/1558/ --testTimeout=600000 --silent=false
node node_modules/typescript/bin/tsc -p tests/acceptance/1558/tsconfig.json
```

`--silent=false` shows each run's readings (how long `deep lease` took after its command exited, when the slot was
released). Nothing needs the network, a model or a real agent.

## The scene

The command is the issue's: `deep lease -- /bin/sh -c 'sleep 300 & echo $!; exit 3'`, run with the built CLI from the
test process. Its leader starts a `sleep 300` in the same process group (a non-interactive shell has no job control),
prints the sleep's PID, and exits 3. The PID line marks when the command exited; the test then waits up to 15 s for
`deep lease` itself to exit, reading its exit code, how long after the PID line it exited, and whether the sleep still
ran then. Every leftover sleep is SIGKILLed by its printed PID after its test (and after the file in any case), and
every `deep lease` this suite started is stopped by its own PID; nothing is killed by name or port.

- **With a hub** (`hub.test.ts`): #1015's world, `deep hub run` in a temp home with memory pressure pinned `normal`
  (so a loaded machine's real pressure can't hold the lease back) and 12 cores. `deep lease` runs from the test, so its
  lease's holder is `cli`.
- **No hub** (`no-hub.test.ts`): an empty temp HOME, so `deep lease` finds no hub and runs the command unleased.
- **`DEEP_LEASED`** (`no-hub.test.ts`): the same empty HOME with `DEEP_LEASED=1`, as inside a leased command.

## Criteria to tests

Each test's name starts with its criterion's ID (`#1558.<first 8 hex of the SHA-256 of the criterion's text>`, as
`scripts/proof-change.mjs` computes it; computed from the criteria's text as the dispatching job gave it).

| ID | Criterion | Test | What it asserts |
|---|---|---|---|
| `#1558.cd6049ae` | `deep lease -- <cmd>` returns within a second of `<cmd>` exiting, with its exit code, even when `<cmd>` left a child running | `hub.test.ts`, first test | the command ran (printed the sleep's PID); `deep lease` exited within 15 s of that, with code 3, under 5000 ms after it, and the sleep was still running then |
| `#1558.0c58bda4` | With a hub up, the cpu slot is not released while the leftover child lives, and is released within 5 s of that child ending: the hub's tick, not the client, returns it | `hub.test.ts`, second test | precondition: the first test's `deep lease` had returned while the sleep lived (else the client could be what releases); 3 s after it returned, the sleep still runs, the record holds `lease.acquired` once for a `cpu.slot` and no `lease.released` for it; after the sleep's SIGKILL, `lease.released` for that lease appears within 5000 ms; still one `lease.acquired` |
| `#1558.da394100` | The same holds with no hub (an empty HOME) and on the `DEEP_LEASED` path | `no-hub.test.ts`, two tests | as AC1's assertions, once in an empty HOME and once with `DEEP_LEASED=1` |

At the base, all four tests fail for the reason the issue names: `runGroup` waits for the whole process group, so
`deep lease` is still running 15 s after its command exited, with the leftover sleep still running. AC2 fails at its
precondition for the same reason (the base's client, not the hub's tick, would release once the sleep ends).

## Open points (choices the issue leaves open; the tests assert the least they can)

1. **"Within a second" vs "under 5000 ms".** The tests assert the expected value, under 5000 ms from the command's exit
   (its PID line) to `deep lease`'s exit, so a loaded machine's slow `deep lease` start-up doesn't flake. Each run's
   reading is printed.
2. **When the command exited** is read as when its PID line reached the test: the leader exits right after it.
3. **"Not released while the leftover child lives"** is read 3 s after `deep lease` returned (six hub ticks), with the
   sleep still running; the slot is the run's `cpu.slot` (the only one acquired in the fresh home).
4. **"Released within 5 s"** is measured from the test's SIGKILL to when the test first reads `lease.released` (polled
   every 100 ms), an upper bound on the hub's time.
5. **"The hub's tick, not the client"** is read as: the release comes while no `deep lease` process remains, so only
   the hub can make it. The test doesn't tell the tick from another hub-side path.
6. **Not covered**: a command killed by a signal, kinds beyond `cpu.slot`, a hub restart while the group runs on, and
   the job pool's token.
7. The suite isn't in `scripts/lanes.mjs`'s `alone` list (this job edits nothing outside this folder); its time limits
   are generous (5 s against a 100 ms poll and a 500 ms tick), but a run at very high load can be late.
