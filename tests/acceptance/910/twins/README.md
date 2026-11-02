# Twins for the 910 tests

The tests stop with an `Error` on the base, before any assertion, because the base has no lane, so the proof
lane's `before` can't count the base as their wrong program. `../twins.json` names one planted wrong program
per criterion instead. Each one replaces `scripts/design-links.mjs` with the change's own file, minus one rule:

| Criterion | Twin | What it leaves out |
|---|---|---|
| AC1, an issue's broken link | `skips-issues` | checking the open issues' links |
| AC2, a renamed heading | `file-only` | the anchor: it checks only that the linked file exists |
| AC3, offline | `offline-passes` | INCONCLUSIVE: a failed fetch reads as no issues, so the lane passes |
