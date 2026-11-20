# Acceptance tests for #2175: what deep-hook's start costs, symbol by symbol

Written blind from issue #2175 (spike), AGENTS.md and the design sections "Numbers version 0 has to hold" and
Dogfooding, at base `b4a2049e8`. The issue leaves the formats open, so the tests check only the substance each
criterion states, in `docs/spikes/2175/` (any `.md` for the table and recommendation, a `record*.json`, a
`.mjs`/`.sh` measuring script). They never rerun the timed measurement and run no model.

Run: `node --test tests/acceptance/2175/spike.test.mjs` (Node 24, Rust toolchain; builds release `deep-hook` once).

| Criterion | Tag | Tests |
|---|---|---|
| AC1 table lists every imported symbol with code and paths | `#2175.4aade462` | every `nm -u` symbol of the release hook is a table row with non-empty code and paths cells |
| AC2 per cut: instructions retired for `--version` and forwarded Read, 15 interleaved runs a side vs the merge base, with the command | `#2175.720f6375` | readings (>= 8 series of >= 15: 2 cuts x 2 workloads x 2 sides); merge-base side + interleaved; script present and named in the record's command |
| AC3 recommendation names cuts or says none is | `#2175.247c2609` | a Recommendation section naming cuts/issues or saying none |
