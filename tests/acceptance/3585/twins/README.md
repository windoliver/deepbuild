# Twins for the 3585 tests

| Criterion | Twin | Replaces | The one rule it breaks | Test it fails | Planted here? |
|---|---|---|---|---|---|
| `#3585.f42fa3e6` | `ts-over-existing-js` | the `tagsWithImports` line of `scripts/proof-change.mjs` | imports resolve to the `.ts`/`.tsx`/`.mts`/`.cts` file before the `.js`/`.mjs`/`.cjs`/`.jsx` file the specifier names, even when that file exists | each `… naming an existing helpers.<ext> reads helpers.<ext>, not …` test: "the existing helpers.js's tag is missing" | Yes, in a scratch copy of the base (`../README.md`, Twin) |
