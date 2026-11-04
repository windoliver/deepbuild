# Twins for the 570 tests

The base has no lifecycle table, no `scripts/lifecycle.mjs` and no table-driven moves, so every test already fails
there at an assertion (`../BASE-FAILURE.txt`). Six of the issue's seven wrong programs are planted by the tests
themselves, as data (`../README.md`, Wrong programs). The seventh is a whole program, "a checker that reads only
final states", and `../twins.json` names it.

| Criterion | Twin | What it leaves out |
|---|---|---|
| `#570.2f9f6ed9` (AC6, recorded logs replay through the tables) | `final-states-only` | The moves: `scripts/lifecycle.mjs replay` reads each object's last event alone and passes a log when the state that event leads to is one of its table's states. A defaulted ask answered later passes. It has no `world` command and runs no seeded harness |

The twin replaces `scripts/lifecycle.mjs` only. On it, `replay.test.ts`'s planted-log test fails (the log passes,
exit 0), and so does its corpus-and-harness test (no seeded run is reported). The legal-log test passes on it.
