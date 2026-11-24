# #1576 budget report: this branch beside the merge base, each plant failing

`node benchmarks/phone-reads.mjs` (task `phone-reads` in `benchmarks/budgets.json`), on this Mac (Mac17,10) on
November 21, 2026, at load 60 to 200 on 18 cores. Every number is a count, never a time.

- **Merge base** is `3f02bf52b`, built in a checkout of its own, with the same script copied in.
- **Branch** is the merge with main `88aba2329`, with `DEEP_HUB_PLANT` unset or naming a plant.

| Run | Cold open, 1,000 sessions (bytes) | Growth from 200 sessions | Queries per reconnect | Turn frames | Turn bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ceiling | 25,000 | 10% | 12 | 9 | 4,700 |
| Merge base | 367,480 | 304.31% | none counted | 8 | 4,019 |
| Branch | 24,840 | 0.33% | 12 | 8 | 4,019 |
| Branch, every core busy | 24,840 | 0.33% | 12 | 9 | 4,440 |
| `reads-every-row` | **359,449** | **333.81%** | 10 | 9 | 4,440 |
| `query-per-row` | 24,841 | 0.33% | **42** | 9 | 4,440 |
| `page-hook-frame-per-event` | 24,840 | 0.33% | 12 | **18** | **4,978** |

Bold marks a reading over its ceiling. Each plant goes over the ceiling that names it.

The branch's turn reads 9 frames when every core is busy. The state pass runs 200 ms after the stop. Under load the
stop's claim isn't made by then, so the pass appends a second `session.state`. The turn's ceilings hold both readings.

## The blind suite, `tests/acceptance/1576`

| Where | Result |
| --- | --- |
| Merge base | All 9 tests fail (`BASE-FAILURE.txt`) |
| Branch at `302bb830d`, before the merge | AC1, AC2, AC4 and their plants pass. AC5 was BLOCKED: a hub on the copied 100,000-session record printed no ready line within 15 minutes in the second loaded run. That code was changed afterwards, and this run was superseded by the one below. |
| Merge `88aba2329`, ceilings 8 frames and 4,200 bytes | 9 of 9 pass, AC5's two loaded runs included |
| Turn ceilings raised to 9 frames and 4,700 bytes | `turn.test.ts` reruns AC3 and its plant: 2 of 2 pass |

## `packages/hub/test/phone-reads.test.ts`

This test covers the Scope items the blind suite leaves out: `events.read`'s byte cap, a session's page window, and
`sessions.read`'s later pages.

- **Branch:** it passes.
- **Merge base:** it fails at its first assertion, `the first page past its last event: expected 1421817 to be less
  than 1048576`.
