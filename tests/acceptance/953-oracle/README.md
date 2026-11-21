# Acceptance tests for #953, Oracle lane: the upstream engine's bonus-system cases run against mods.lib@1

Written first, blind, from issue #953 (`gh issue view 953 --repo windoliver/deepbuild`), its Oracle page
(`doneright/oracles/issues/953.md` on branch `doneright` of DeepBuildAI/deepbuild), the upstream test file that page
pins (read from `doneright/oracles/vendor/…/test/bonus/BonusSystemTest.cpp` at that ref), the #953 suite's surface
(`../953/README.md`, written by the same job) and base commit `86b99ac36`, by a job that never saw an implementation;
none existed, and no other worktree, branch, stash or pull request was read. #136's rule applies: a linked test counts
only when run against our output, so every upstream value here is asserted against what `deep-logic` bakes with
modslib@1's reference library. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a
blind redraft of this job (design: Dogfooding).

Scope: criteria 1 and 4, the two the page links upstream tests to. The rest of each criterion (the seeded edit
sequences against the brute-force recompute, durations, order and the planted libraries) stays with
`tests/acceptance/953/`.

## Source

| Criteria | Upstream, pinned | Lines | Use |
|---|---|---|---|
| 1 | the upstream engine's bonus-system tests at commit `c53e0e85d4d280107661d65b42d88ea6ab6eb6ee`, `test/bonus/BonusSystemTest.cpp` | 116-140 | port |
| 4 | the same file and commit | 171-206, 208-220, 222-267 | port |

Ported as data: each case's tree, its edits in upstream's order and the values it asserts, re-expressed as mods.lib@1
rows and reads in `bonus-system.test.ts`. No upstream code is copied, and no other line of the file is used.

## Run

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci && npm run build --workspaces          # once, in a fresh worktree
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 \
  npx vitest run --root tests/acceptance/953-oracle --testTimeout=600000 --no-file-parallelism
npx tsc -p tests/acceptance/953-oracle/tsconfig.json
rm -rf tests/acceptance/953-oracle/node_modules
```

It builds what `../953/` builds (`deep-logic`, #416's assembler) and bakes one piece of four driver items, under a
minute after the builds. `scripts/lanes.mjs` pushes this folder to `alone` beside `../953/`. Nothing here depends on
time, load, Docker or Chrome.

## The port

Every case runs on `../953/`'s driver linking modslib@1's reference library through `lib:mods.lib@1`, on `../953/`'s
catalog. Upstream's nodes have several parents (a hero under its player and under the battle) and its bonuses carry
propagators, limiters and stacking keys; mods.lib@1 has one parent per node, three reaches, filters on the receiving
node's catalog row, and four ops. The mapping, chosen to keep every value upstream asserts:

- **Players are sides** (nodes attached at the top), heroes are under their player, stacks under their hero. Upstream's
  battle node has no counterpart: a battle-wide propagator is reach `all`, and "start the battle" attaches nothing.
- **Lines 116-140** (criterion 1): a parent with morale +1 (an add, reach down) and its first child, which reads 1; a
  second child attached under the parent reads 1. Upstream also checks that the parent's and the first child's tree
  versions don't change; mods.lib@1 has no version, so the port reads their totals before and after the attach (0 and
  1) and asserts them unchanged.
- **Lines 171-206** (criterion 4, reach side): each angel's morale +1 reaches its army, the red hero and his stacks,
  never the blue ones: reach `side` from the angel. Upstream counts the same bonus from two angels once (a stacking
  key); mods.lib@1 has no key, so each angel's row is `set 1`, which two angels give once. The rows are added before
  the angels are attached, as upstream gives each angel its creature's bonus before it joins, so attaching an angel is
  what brings its row into the tree.
- **Lines 208-220** (criterion 4, reach all): the orb's magic block reaches both heroes: reach `all` from the orb,
  attached under the red hero; "has the bonus" reads as a total of 1 where none is 0.
- **Lines 222-267** (criterion 4): each devil lowers the luck of the side opposite its owner's: reach `all` with the
  filter `player = 1` on the receiving node's row (the devils are player 0's), `set -1` for the same reason as the
  angels. Lines 263-266 read the same values again with no edit.

Before baking, the test checks that `../953/model.ts`'s rule gives upstream's values on each port, so a port that
couldn't match upstream fails before anything runs.

## Criteria to tests

| IDs | File (tests) | What it asserts |
|---|---|---|
| 1 `#953.ab5c01d3`, 4 `#953.e5d20c0f` | `bonus-system.test.ts` (1) | Every value lines 116-140, 171-206, 208-220 and 222-267 assert, each read from the bake of its case on mods.lib@1's reference library. Fails: a cache that changes an unchanged branch's totals or misses a new child, a side reach that crosses sides or misses a stack, an `all` that misses a side, a filter read on the source |
