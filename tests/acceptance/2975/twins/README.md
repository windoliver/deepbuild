# Twins for the 2975 tests

On the base a SIGTERM or SIGINT to the installed hub exits 0, so AC1's and AC2's tests fail there
(`../BASE-FAILURE.txt`), as does the systemd unit's test on Linux. The rest already hold on the base: a signal ends the
hub at once (AC3), a dev hub exits 0 on a signal (AC4), a confirmed `deep hub stop` exits 0 however many SIGTERMs land
while it stops (AC5), and the plist has `SuccessfulExit` false (AC6). Only a planted wrong program proves those tests.
These are such programs, each a plausible wrong fix for one criterion. `../twins.json` names them.

The blind job built them on its own throwaway implementation, which isn't kept. It lived in this worktree's
`packages/hub/src/` only while the suite ran, and was reverted:

- `server.ts`: a getter `installed` on the hub (its root is `installedRoot()`'s, as `hub.stop` already checks), and the
  SIGTERM and SIGINT handlers call `hub.stop(\`signal:${signal}\`, undefined, hub.installed ? RESTART_EXIT : 0)`: on the
  installed root the stop is recorded with its signal and exits 75 at once; a dev hub exits 0 as before. `stop()`
  already returns early once a stop is underway, so a signal during a confirmed stop changes nothing.
- `service.ts`: the systemd unit adds `RestartSec=3`, `SuccessExitStatus=75` and `RestartForceExitStatus=75` after
  `Restart=on-failure`. The plist is unchanged.

That implementation passes all 6 tests that run on macOS (`../BASE-FAILURE.txt`; the unit test runs on Linux only).
Each twin is a copy of one of its files with one fault planted, marked `/* TWIN <name>: … */`, and replaces only that
file, never a test or a helper. A copy goes stale as the real file changes, and still holds its fault. The implementing
job can plant the same faults in its real code under the same names.

To run one: put the implementation in place, copy `twins/<name>/packages/` over its `packages/`, build `packages/hub`
(`npm run build -w packages/hub`), and run the test file the table names. The blind job ran each that way, one at a
time, and put the throwaway's own file back after each.

| Criterion | Twin | Replaces | The planted fault | Test file |
|---|---|---|---|---|
| `#2975.20c7734e` (AC3) | `signal-waits-restart-after` | `server.ts` | on the installed root a signal waits out `RESTART_AFTER_MS` from listening, as `hub.restart` does, before its exit 75 | `signal.test.mjs` (the 5 s test) |
| `#2975.c596419b` (AC4) | `dev-signal-exits-75` | `server.ts` | a signal exits 75 on every root, a dev hub's too | `dev.test.mjs` |
| `#2975.03961608` (AC5) | `signal-75-during-confirmed-stop` | `server.ts` | a stop asked while one is underway still raises the exit code, so a SIGTERM during a confirmed stop makes it exit 75 | `confirmed.test.mjs` |
| `#2975.03961608` (AC5) | `confirmed-stop-exits-75` | `server.ts` | the installed hub's confirmed `hub.stop` exits 75, so the login service starts it again | `confirmed.test.mjs` |
| `#2975.4668c24b` (AC6) | `keepalive-always` | `service.ts` | the plist's `KeepAlive` is `<true/>`, in place of `SuccessfulExit` false | `definition.test.mjs` (the plist test, macOS) |

AC1's and AC2's tests fail on the base itself. The systemd unit's test fails on the base on Linux; on macOS it is
skipped, so it has no twin here.
