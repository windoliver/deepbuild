# Twins for the 2973 tests

The base keeps no restart budget, so AC1's test, AC5's (no budget file under the root), AC7's (the promotion goes
through) and AC2's and AC3's (the budget never gets spent) fail there (`../BASE-FAILURE.txt`). The crash test and both
AC6 promotion tests pass on the base, where crashes, promotions and rollbacks already work with no budget. A planted
wrong program proves each test that the base doesn't already prove, and AC2's, AC3's and AC5's beyond their
precondition. `../twins.json` maps each criterion tag to its twins.

The blind job built them on its own throwaway implementation, which isn't kept (its diff was handed over for
reference only, never as the fix):

- `restart-budget.ts` (new): the budget file `<root>/restarts.json`, `{"v":1,"restarts":[<ms on the hub's clock>…]}`.
  A missing file is nothing spent; one that can't be read or doesn't parse reads as spent, and its refusal names the
  file. At most 6 restarts whose time is within 60 minutes of now; the next frees up 60 minutes after the oldest.
- `server.ts`: `hub.restart` reads the budget by the hub's clock (`this.now()`, which `DEEP_HUB_TEST_CLOCK` sets), and
  with no room refuses with code `budget`, not retryable, naming 6 restarts in 60 minutes, the time the next frees up
  (ISO 8601) and `deep hub stop` and `deep hub start`; with room it writes the restart's time to the file, then answers
  and exits 75 as on the base. A new `hub.restarts {need}` (cli) refuses the same way unless the budget has room for
  `need`.
- `promote.ts`: before the drain, with a hub answering, asks `hub.restarts {need: 2}`, and on a refusal exits 1 naming
  it, before `current` or the hub changes.

Each twin holds all three files of that implementation, one of them with a fault planted, marked
`/* TWIN <name>: … */` (`start-refused-when-spent` holds a fourth, the base's `service.ts` with its fault); laid over
a tree, it is the throwaway with that one fault. It replaces only those files, never
a test or a helper. A copy goes stale as the real files change, and still holds its fault. The implementing job can
plant the same faults in its real code under the same names.

| Twin | File | Fault | Caught by |
|---|---|---|---|
| `window-by-wall-clock` | server.ts | the window is read by the wall clock, never the hub's | `spent.test.mjs` AC2: the restart past the moved clock is refused |
| `window-never-slides` | restart-budget.ts | nothing drops out until 60 minutes after the newest restart | `spent.test.mjs` AC2 |
| `stop-refused-when-spent` | server.ts | the installed hub's `hub.stop` is refused while the budget is spent | `spent.test.mjs` AC3: `deep hub stop` fails |
| `start-refused-when-spent` | service.ts | `deep hub start` of the installed hub is refused while the budget is spent | `spent.test.mjs` AC3: `deep hub start` exits 1 |
| `crash-spends` | server.ts | a start after a crash (`hub.state` left `running`) is counted as a restart | `crash.test.mjs` |
| `bad-file-reads-empty` | restart-budget.ts | a file that can't be read or doesn't parse reads as nothing spent | `badfile.test.mjs` |
| `promote-needs-three` | promote.ts | the promotion asks room for 3 restarts | `promote-good.test.mjs`, `promote-rollback.test.mjs` |
| `rollback-without-restart` | promote.ts | the rollback switches `current` and restarts nothing, so the bad build's hub stays | `promote-rollback.test.mjs` |
| `promote-room-for-one` | promote.ts | the promotion asks room for its first restart only | `promote-refused.test.mjs` |
| `promote-checks-after-drain` | promote.ts | the budget is read once the hub is drained, and the drain is left on | `promote-refused.test.mjs` |

To run one: put the implementation in a scratch tree beside this suite, copy `twins/<name>/packages/` over its
`packages/`, build `packages/hub`, and run the test file the table names. The blind job ran each that way, each in an
APFS copy of its throwaway tree.
