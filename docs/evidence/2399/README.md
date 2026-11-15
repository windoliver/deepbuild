# Evidence for #2399: a run's egress filter records a refusal once per operation and target

All on linux/arm64 (bubblewrap sandbox), branch commit `be9adeb8b`, merge base `72fe11a11`.

| File | What it is |
|---|---|
| `../../../tests/acceptance/2399/BASE-FAILURE.txt` | the blind suite's run on the merge base: AC1 `expected 100 to be 1`, AC2 100 events not one, AC3 `expected 6 to be 3`, the three plant tests BLOCKED (no such plant) |
| `suite-branch.txt` | one whole run of `tests/acceptance/2399` on the branch, nothing else of this session running: 8 of 8, the three wrong-program tests among them |
| `plants.txt` | each criterion test run on its planted supervisor, to show the failure itself: AC2's on `egress-refusal-once-per-operation` (it stops where a refusal of a new target never reaches the record; the reading that names the second host is the suite's own wrong-program test, passing in `suite-branch.txt`), #1106's AC3 on `egress-refusals-unrecorded` (naming the three placements), AC4's on `egress-refusals-seen-without-run` (naming the second run) |
| `unit-append-failure-reverted.txt` | `supervisor.test.ts`'s "a filter refusal the record did not take is recorded at the next try" with the `.catch` that drops the key reverted: it fails |
| `hand.md` | the hand run the issue's "Runs on" line describes, on the merge base and on the branch |

An earlier whole run on the branch (7 of 8) is INCONCLUSIVE and not kept as proof: its AC4 wrong-program test stopped in
setup, `GET /env` on the first stack's leased port answering 200 with no `HTTPS_PROXY`. The cause is not proven. What
the code allows: every test hub has a lease table of its own and leases ports from 3000 up after a check that the port
is free (`packages/env-local/src/stack.ts`, `portFree`), so two hubs of two sessions can lease one port; the app
that binds second exits (`fixtures/app.mjs`), and #1106's helpers take whatever answers on 127.0.0.1 at that port.
About twelve other sessions' suites were running then. Four copies of `plain-http.test.ts` run at once did not
reproduce it (4 of 4 passed).
