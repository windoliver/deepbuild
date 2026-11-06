# Twins for the 1115 tests

Most of the tests fail on the base at their assertion (`../BASE-FAILURE.txt`). Seven can't, since on the base what they
compare reads the same: the three of "failures on main", and one each of AC2, AC5 and AC6. These are the planted wrong
programs the design's Issue shaping asks them to show failing. The blind job's own programs were built on a throwaway
implementation it didn't keep, so the implementing job planted these in the real change's code, by the same names and
the same faults. Each replaces the one file it names, and no test or helper. A copy goes stale as that file changes, and
still holds its fault.

| Criterion | Twin | Replaces | The planted fault |
|---|---|---|---|
| `#1115.07ca71fc` | `unanchored-state` | `scripts/lanes.mjs` | The state is matched anywhere in a failure message, so a test that compares the word INCONCLUSIVE drops out of the FAIL ids |
| `#1115.07ca71fc` | `quiet-reporter` | `scripts/lanes.mjs` | The proof reporter replaces vitest's own output, so the lane stops naming what failed |
| `#1115.3a2181d7` | `first-state-wins` | `scripts/lanes.mjs` | The first state a lane finds stands, so an INCONCLUSIVE test hides a later real failure |
| `#1115.82b1c824` | `whole-file-rule` | `scripts/proof-guard.mjs` | The guard compares the whole file, so `affected.mjs --record` needs a tag |
| `#1115.82b1c824` | `line-rule` | `scripts/proof-guard.mjs` | The guard compares the key's lines, not its value, so a reformatting rewrite needs a tag |
| `#1115.1f2f1fa0` | `empty-report-fails` | `scripts/lanes.mjs` | A job the throttle never started reads FAIL |
| `#1115.07ca71fc` | `moved-a-failure` | `scripts/known-failures.json` | An entry leaves `failures`, so a failure main has stops reading as known |
