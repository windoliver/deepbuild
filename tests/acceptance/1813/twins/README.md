# Twins for the 1813 tests

Criterion 4 (`#1813.343b9fbb`, every changed line's token count at or under its count on the merge base) holds a bound the
change must keep, so its test passes on the merge base, which changes nothing against itself; the before lane counts a
tagged test only once it failed on a wrong program (`scripts/proof-runs.mjs`). `../twins.json` names that program.

| Criterion | Twin | What it plants | Why it is the criterion's wrong program |
|---|---|---|---|
| `#1813.343b9fbb` | `longer-rule-line` | `crates/deep-hook/default-rules.json` of the base (`9bbe0f24c`) with one text made longer: `push-needs-ask`'s `next_step` gains a sentence, from 31 tokens to 62 | A change that rewords a line the guard sends into a chat and makes it longer. `tokens.test.ts` reads the file and fails at its first assertion, naming `push-needs-ask.next_step` and both counts |

The twin is the base's whole file, so laid over a change it also puts back whatever the change did to the default rules;
those texts then equal the merge base's and count as unchanged. It is JSON, so it builds with anything.
