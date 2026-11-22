# Twins for the 2974 tests

The base holds a drain until the hub restarts, shows it nowhere, and `deep hub promote` never lifts its own, so AC1's,
AC3's, AC4's and AC6's tests fail there (`../BASE-FAILURE.txt`). A renewed drain already holds on the base (it holds
for good), so AC2's test passes there; and AC5's test passes there too (a good promotion with no start served by the
hub that was in during its drain). Only a planted wrong program proves those two. These are such programs, each a
plausible way to get one of them wrong. `../twins.json` names them.

The blind job built them on its own throwaway implementation, which isn't kept. It lived in a scratch tree, an APFS
clone of this worktree at the base, never in shipped paths:

- `hub-control.ts`: the drain is a lease `{ pid, command, since, renewed }`. `hub.drain` takes the holder from the
  connection's peer (its command line by `ps -o command=`); the same holder's next call renews it; `{ on: false }`
  lifts it. A drain not renewed for 30 s reads as none. `start.session` under it is refused naming the holder's PID and
  command line, since when and when it lapses, as a promotion's only when the command line is `deep hub promote`'s.
  `hub.health` and `rows.read` carry `drain: { paused, holder: { pid, command }, since, lapses, promotion }` or null.
- `list.ts`: `deep status` prints "Session starts are paused: a drain held by PID … (…) since …; it lapses at …".
- `service.ts`: `control` can name a peer. `promote.ts`: every drain call names promote's own process; SIGINT and
  SIGTERM during the drain lift it and exit 130; a drain call that fails lifts it before promote exits 3.
- `docs/technical-design.md`: a threat-table row, "A held drain".

That implementation passes all 7 tests (`../BASE-FAILURE.txt`). Each twin is a copy of one of its files with one fault
planted, marked `/* TWIN <name>: … */`, and replaces only that file, never a test or a helper. A copy goes stale as the
real file changes, and still holds its fault. The implementing job can plant the same faults in its real code under the
same names.

To run one: put the implementation in a scratch tree beside this suite, copy `twins/<name>/packages/` over its
`packages/`, build `packages/hub` (`npx tsc -b` there), and run the test file the table names. The blind job ran each
that way, one at a time, and put the throwaway's own file back after each.

| Criterion | Twin | Replaces | The planted fault | Test file, and how it fails |
|---|---|---|---|---|
| `#2974.be96e768` (AC2) | `lease-from-first-drain` | `hub-control.ts` | a renewal is served but doesn't extend the lease, so it lapses 30 s after the first drain (and the next renewal takes it again) | `lease.test.mjs` (the renewed test): starts sent back to back from 28 s are served in the gap |
| `#2974.b18056cd` (AC5) | `promote-renews-late` | `promote.ts` | once it says it waits for a turn, promote renews its drain every 45 s, past the 30 s lapse | `promote.test.mjs`: the hub that was in serves starts during the promotion's wait |
| `#2974.b18056cd` (AC5) | `drain-asks-confirm` | `server.ts` | the installed hub asks the OS to confirm you (as `deep off`) before a drain, as if a drain switched DeepBuild off | `promote.test.mjs`: the OS is asked, the stub cancels, and promote exits 3 |
