# Blind redraft of #399.93b00910 (the taste call)

`taste-redraft.test.ts` was written from the issue, the design's Dogfooding line and base `29d29ba5`, using this
suite's README surfaces and `../helpers.ts`. It runs `deep-canvas-render raster` on `graph40Doc(false)`,
`graph40Doc(true)`, `crowdDoc()` (its status mark pinned `pass`) and `cardsDoc()` with the clean look, copies the
PNGs raster wrote to `target/acceptance/399/` (`graph-before.png`, `graph-after.png`, `labels.png`,
`cards-groups.png`), prints their SHA-256s, and reads `tests/acceptance/399/TASTE.json` as the suite's README says.

```sh
npx vitest run --root tests/acceptance/399 redraft/taste-redraft.test.ts --no-file-parallelism --testTimeout=600000
```
