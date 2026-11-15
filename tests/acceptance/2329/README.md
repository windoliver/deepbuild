# Acceptance tests for #2329: a compaction in the process its session holds starts no ps

Written blind from `issue-2329.json`, `AGENTS.md`, `docs/technical-design.md` and the base `1c4d1f0e`. Not to be edited; a dispute goes to a blind redraft.

## Criteria to tests

| AC | Test (`compaction-ps.test.ts`) |
| --- | --- |
| 1. SessionStart `source: compact` from the held process starts no `ps`, counted by a stand-in on PATH | `#2329.ac1`: ten compactions, every `ps` the hub runs logged by a stand-in; expects `[]`. Also expects all ten recorded and each checked as the session's own (processed, not just acknowledged) |
| 2a. Resumed in a new process is still bound to it | `#2329.ac2 ... resumed in a new process`: first process exits with no SessionEnd, a resume arrives from a new `claude` process; expects both starts and a later compaction verified, and the resume still to read that process's command line (`-o args= -p <pid>`) |
| 2b. A PID another process took is still refused | `#2329.ac2 ... PID another process took`: the `ps` stand-in reports another start time for the session's PID; once the hub records the session gone, a compaction from that PID must be unverified |
| 3. `start-ps.test.ts`, `mods-start.test.ts` pass unchanged | Preserved, not duplicated: `packages/hub/test/start-ps.test.ts`, `packages/hub/test/mods-start.test.ts`. Also kept for binding: `packages/hub/test/overridden.test.ts` (resume after SessionEnd) |

## Failing on base

AC1 fails at its last `expect`, `ps invocations over ten compactions`, listing the `ps` calls: each compaction reads the agent's command line (`argsOf` via `parentArgs`). The `setup:` and `all ten compactions` expects pass on base, so it is not a setup error. AC2 tests describe behavior that holds on base and must still hold after the fix.

## How to run

macOS or Linux, Node 24, `/bin/ps`. The tests run the built CLI.

```sh
npm ci                                  # if node_modules is missing
npm run build --workspaces
node_modules/.bin/vitest run tests/acceptance/2329
node_modules/.bin/vitest run packages/hub/test/start-ps.test.ts packages/hub/test/mods-start.test.ts packages/hub/test/overridden.test.ts
```

## Stand-ins

- `ps` first on the hub's PATH: logs `"$*"` per call, then runs `/bin/ps`. While `<home>/reuse` holds a PID, `ps -o lstart= -p <PID>` prints a different start time (a PID another process took).
- `claude` on PATH lists no mods. The agent is a real node process with argv0 `.../versions/claude`, so `ps` shows Claude Code's binary.

Everything else is real: the hub (`deep hub run`), its socket and record (`ledger.db`), and its once-a-second watch.

## Notes

- Each test starts its own hub, so the folder likely belongs in the `alone` list of `scripts/lanes.mjs`. That is outside this job's folder, so the implementing change adds it.
- AC1 first lets the hub's own half-minute process check run (about 3.5 s after the session is watched), so only what compactions run is counted. The window is well under 30 s.
- AC2b relies on that watch to see the PID change (`session.gone`); if the hub stops recording it, the test fails at its `setup:` expect.
- Not covered: the benchmark's children counts (`benchmarks/hub.mjs compact`), and naming the second `ps` in the issue's Scope (prose, no criterion).
