# #3278 acceptance tests: readers.board's content keys hold still across runs

Written blind, from the issue, AGENTS.md, docs/technical-design.md and the base commit only. The subject is the shipped
fixture `parity/logic/readers.board`, reached through `deep-show run` (`manifest`, `fixtures`, `deep show`, `eval`) as
the issue's repro does. No fixture is added.

## Criteria to tests

| Criterion | Test | What it checks |
|---|---|---|
| `#3278.99c4953a` Running `parity/logic/readers.board` twice in one `deep-show` binary gives the same content key for every node at 0s, 0.5s and 1.5s | `stable-keys.test.ts` | One run reads the fixture's document and record from the build's `manifest` and `fixtures`. Then two `deep-show run` processes of the same binary each get the same scenario (the same evidence folder included): `manifest`, then `deep show` of the document at 0s, 0.5s and 1.5s, each followed by `eval` at that time. Both runs must list the same nodes, `logic.step\|-` among them, and every node's `key` at every time must be the same in both. The failure lists each node whose key moved. |
| `#3278.f8a0472b` `tests/acceptance/490-redraft-2/opening.test.ts` passes on main | `opening.test.ts` | Runs that suite unchanged in a child Vitest from the checkout's root with a JSON report, and requires every test in it to pass (none failed, skipped or todo). The failure lists each test that did not pass with the head of its failure message. |

## Running

`npx vitest run tests/acceptance/3278` from the checkout's root. `stable-keys.test.ts` uses `DEEP_BIN_DIR/deep-show`
when the proof run supplies it, else builds `cargo build --locked --bin deep-show` (default features: `full`, the
shipped build). `opening.test.ts` needs nothing built: #490's suite builds its own binaries, including the merge base in
its own target folder, so a cold first run is long (several builds); later runs reuse those caches. The folder runs
alone (lane.json), since that suite's builds replace `target/debug/deep-show`.

The base run's failures are in BASE-FAILURE.txt.
