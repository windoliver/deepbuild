# #2011 evidence: physics.pairs, roles and the step budget on each host

Taken on the arm64 reference Mac (Mac17,10, M5 Max, 64 GB, macOS 27.2, mains power) on Nov 10, 2026, on the
working tree over blind commit aa9a3c24a. The machine is shared by other sessions: its one-minute load was 17 to 21
against 18 cores during criterion 2's first run, and 11 to 12 during its second.

| Criterion | Suite | Result |
|---|---|---|
| 1 `#2011.3daf6b1d` | `tests/acceptance/2011/ac1-pairs.test.ts` | 2/2 pass: the world meeting player–ground and shot–enemy touch and shot–player never passes with its 10 group pairs; ground omitting player FAILs with one `touch` failure naming player–ground and `player/shapes/0`, `ground/shapes/0`; shot naming player FAILs with one `never` failure naming shot–player; enemy's empty `member` is refused with an error issue at `bodies/enemy/shapes/0/member` |
| 3 `#2011.b8ab4f30` | `tests/acceptance/2011/ac3-roles.test.ts` | 2/2 pass: in the roles-only world the expanded pairs are as the criterion lists, one `sensor_enter` for pickup–player near step 60 and none for the enemies; under `--planted role_table_pickup_solid` the player stops at the pickup and physics.pairs FAILs naming pickup–player |
| 2 `#2011.a8a76103` | `tests/acceptance/2011/ac2-step-budget.test.ts` | 4/4 pass: the plant and the BLOCKED web in the first run, where the two timing tests read INCONCLUSIVE by load (`ac2-step-budget.txt`); both timing tests in a second run once the load was under the core count (`ac2-quiet-run.txt`) |

Criterion 2, in detail:

- **Planted `times_only_app`**: caught. Its web host carries the app's target, engine and runs, so the judge that
  passes the real check finds the web untimed in headless Chrome.
- **No reference Mac for the web**: the web host is BLOCKED with no runs, exactly one `unblock` ask naming web, and
  the report is BLOCKED.
- **Compound level** (100 convex slabs), five runs' step p95: app 0.043–0.062 ms, web (release wasm32 in
  `HeadlessChrome/`) 0.090 ms, both well under 2 ms. Every structural check passed (targets, engines, release profile,
  five runs and loads, a well-formed slowest step and pair). The verdicts read INCONCLUSIVE only because the load at a
  run's start or end (21.4) was above the 18 cores.
- **Mesh level** (one 20,000-triangle mesh): app 1.756–1.936 ms (under 2 ms), web 2.605–2.680 ms (over 2 ms by more than
  the 5% margin in every run). The web's slowest step names a capsule and `level/shapes/0`. INCONCLUSIVE for the same
  reason (load 19.4 to 21.2).

The second run, at load 11 to 12, ran only those two tests (`-t`): the compound level read app PASS, web PASS and
report PASS; the mesh level read app PASS, web FAIL and report FAIL, the web's `what` naming web, the slowest step and
the capsule–level pair. Passing tests print no readings, so the numbers above are the first run's.
