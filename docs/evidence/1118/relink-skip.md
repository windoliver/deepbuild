# #1118: Stryker's node_modules relink walk is skipped in a bay

The scope line "Stryker's `node_modules` relink walk (`:166-176`) is skipped in a bay (`runs.bay`)" was checked by
reading only in PR #1244. It is a scope line, not an acceptance criterion.

## What is proven

`undoBuild` is the walk. In a bay it leaves `target/` and `node_modules/` alone (`scripts/proof-runs.mjs`,
`if (path === '.git' || (bay && (path === 'target' || path === 'node_modules'))) continue;`).
`tests/bays.test.mjs` › "undoBuild in a bay keeps its target and node_modules …" checks this.

Run on the Spark (first on 2026-11-08, again for the committed output on 2026-11-09 at load 2.5, in
[relink-mutant.txt](relink-mutant.txt)) against a copy of `ede4b367`'s `scripts/` and tests (`git archive`), with
`node_modules` linked to another worktree's so that `typescript` resolves:

```
node --test --test-name-pattern="undoBuild in a bay" tests/bays.test.mjs
```

| Program | Result |
|---|---|
| As merged | ✔ pass 1, fail 0 |
| Mutant: the bay skips `target` only (`(bay && path === 'target')`) | ✖ `AssertionError: undoBuild removed the bay's packages` |

## What is still by reading

These are covered by reading the code, not by a run:
- The mutation lane takes the change bay when `runs.bay` is set (`changeCopy(root, change, 'mutation')`).
- The rebuild-and-undo command it gives StrykerJS runs `undoBuild` with the bay as its working directory, so the
  skip above applies there.

No proof run with a mutation lane in a bay was made. A real one needs StrykerJS installed and a TypeScript change
with a tagged test, on top of a bay pair (about 46 GB on the Mac).

Also untested, as PR #1244 says: the 20-minute `npm ci` timeout.
