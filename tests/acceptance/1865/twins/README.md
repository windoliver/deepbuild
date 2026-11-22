# Twins for the 1865 tests

The base serves `hub.stop` on the control token alone and has no restart, so AC1's test and AC3's restart test fail
there (`../BASE-FAILURE.txt`). A confirmed `deep hub stop` and `deep hub promote` already work on the base, so AC2's
test and AC3's promotion test pass there, and only a planted wrong program proves them. These are such programs, each a
plausible way to fake one criterion. `../twins.json` names them.

The blind job built them on its own throwaway implementation, which isn't kept. It lived in a scratch tree, an APFS
clone of this worktree at the base, never in shipped paths:

- `server.ts`: `hub.stop` on the installed hub (its root is `installedRoot()`) asks the core's `you.confirm` with the
  command `deep hub stop` and the caller's peer, as `gates.off` does, and stops only once that resolves; otherwise the
  refusal goes back and the hub keeps running. A dev hub (`--root` elsewhere) stops on its token, as before. A new
  `hub.restart` (app and cli, on the token alone) answers `{ restarting: true }` and stops with exit 75, so the login
  service (KeepAlive with SuccessfulExit false; Restart=on-failure) starts it again. `stop()` takes the exit code.
- `promote.ts`: after the drain it switches `current` first, then asks `hub.restart` (in place of `hub.stop`) and waits
  for the old process to exit; the login service, and promote's own `startService`, bring up the new build. The
  rollback does the same with the build that was in.
- `authority.ts` and `hub-command.ts`: `deep hub stop` of the installed hub sends `hub.stop` as this process (with
  its peer), so the hub's own confirmation is the one asked, and waits for the socket to go quiet.

That implementation passes all 5 tests (`../BASE-FAILURE.txt` has the runs). Each twin is a copy of one of its files
with one fault planted, marked `/* TWIN <name>: … */`, and replaces only that file, never a test or a helper. A copy
goes stale as the real file changes, and still holds its fault. The implementing job can plant the same faults in its
real code under the same names.

To run one: put the implementation in a scratch tree beside this suite, copy `twins/<name>/packages/` over its
`packages/`, build `packages/hub`, and run the test file the table names. The blind job ran each that way, one at a
time, and put the throwaway's own file back after each.

| Criterion | Twin | Replaces | The planted fault | Test file |
|---|---|---|---|---|
| `#1865.c16bc3be` (AC1) | `confirms-only-with-peer` | `server.ts` | asks the OS only when the caller names its process; naming none, `hub.stop` stops on the token alone | `stop.test.mjs` |
| `#1865.2e5dc4d0` (AC2) | `confirmed-stop-exits-nonzero` | `server.ts` | a confirmed stop exits 1, so the login service starts the hub again | `confirmed.test.mjs` |
| `#1865.2e5dc4d0` (AC2) | `refuses-every-stop` | `server.ts` | the installed hub refuses `hub.stop` even once the OS confirmed you | `confirmed.test.mjs` |
| `#1865.bd65df36` (AC3) | `promote-stops-confirmed` | `promote.ts` | promote stops the hub with the confirmed stop, naming its process, so the OS is asked and the cancelled prompt leaves the old hub in | `promote.test.mjs` (the promotion test) |
| `#1865.bd65df36` (AC3) | `restart-exits-zero` | `server.ts` | a restart exits 0, so the login service leaves the hub down | `promote.test.mjs` (the restart test) |

AC1's test and AC3's restart test also fail on the base itself; AC2's test and AC3's promotion test only on their twins.
