# Acceptance tests for #537, Oracle lane: the generational-key property, run against our frames

Written first, blind, from four sources:

- issue #537;
- its Oracle page, `doneright/oracles/issues/537.md` on branch `doneright` of `DeepBuildAI/deepbuild`;
- the one upstream file that page pins, read from the vendor copy on that branch;
- the #537 suite's surface (`tests/acceptance/537/README.md`, written by the same job) and the base commit.

The job never saw an implementation of #537; none existed, and no other worktree, branch or pull request was read.
#136's rule applies: a linked test counts only when run against our output, so the case here builds our documents and
asserts on what `deep-gpu`'s `view3d` draws. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding).

The page links an upstream test to criterion 1 of 5. Criteria 2 to 5 have none (the page's "No upstream test" table) and
stay with `tests/acceptance/537/`.

## Sources

| Criterion | Upstream, pinned | File | Use | Here |
|---|---|---|---|---|
| 1 `#537.fdb98a26` | the upstream generational-key library, `2d56154b9b628f7d7a506f24ebc4f55a13ec8fed` | `src/basic.rs`, lines 1497 to 1575: the property test that runs random inserts, removes and lookups on the slot map and on a hash map of counter keys | formula (the page's use) | `slot-keys.test.ts` (1 test) |

**The property, re-expressed.** No upstream code is copied or run. Upstream draws a random list of `(op, val)` pairs; op
mod 3 picks an insert (a value under a new key), a remove (one of every key ever made, a tenth of the time a clear of
everything first) or a lookup (one of every key ever made); at every step the slot map and a hash map keyed by a counter
that never repeats must agree on what each key finds, and at the end on the values. So a key acts as a unique key: one
whose slot was freed finds nothing, never the slot's next occupant. Here:

- the slot map is our instancer fed by logic: 8 slots, its `live` and `gen` columns written by a logic program from a
  table this file draws, one row a step, for 180 steps;
- an insert spawns into a free slot (val picks which) under that slot's next generation; a remove despawns the slot of a
  live key and does nothing for a removed one (a stale key removes nothing, as upstream's removal through an old key
  returns nothing); a tenth of removes (val mod 10 = 0) despawn every slot; a lookup is checked against the frame;
- the counter keys are the model's: each spawn is a new key, and its element must be `pool#<slot>.<gen>`.

At every step, against the frame's `items/pool/elements` and `selection`:

- the live elements are exactly the live keys' elements (upstream's lookups and final values agree);
- an element ID names one key, never reused for a later key in its slot;
- a lookup of a live key finds its element in its slot; a lookup of a removed key never finds its ID there, though the
  slot may hold a new occupant;
- a selection (a viewer entry selecting every live element every 30 steps) holds exactly those of its elements still
  live: it drops an old generation and never lands on the slot's next occupant.

Three random runs (seeds 5370, 5371 and 5372) stand in for upstream's generated operation lists, drawn by a fixed mulberry32
so a failure repeats. The page calls seeding by hash(seed, slot, gen) and the frame checks ours; the #537 suite tests
them. The vendor copy holds no license file; this job knows the upstream library as MIT-licensed by its own statement.
Nothing is copied, so no notice is carried.

## Run

```sh
npm ci && npm run build --workspaces   # once, in a fresh worktree
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  npx vitest run --root tests/acceptance/537-oracle --testTimeout=600000 --no-file-parallelism
npx tsc --noEmit -p tests/acceptance/537-oracle
```

`helpers.ts` re-exports the #537 suite's helpers (`../537/helpers.ts`) and its program writer, so both lanes build and
ask the same binary the same way: `cargo build --locked --bin deep-gpu` once, and #544's assembler. **`scripts/lanes.mjs`
needs `'tests/acceptance/537-oracle/'` in its `alone` list**; the #537 README gives the line, and the implementer makes
that edit. Off macOS the drawn half is `INCONCLUSIVE:`, never a pass.

## The surface under test

The #537 suite's (its README: The surface under test), with nothing added: `view3d` running a scene's logic item,
`evaluate`'s `items/<instancer>/elements` (`{id, slot, gen, seed}` per live slot) and each frame's `selection`, the
viewer's selection given by `viewer` entries.

## Criterion to test

| ID | Test | Upstream | Ours |
|---|---|---|---|
| `#537.fdb98a26` | `slot-keys.test.ts` | random inserts, removes and lookups agree with counter keys at every step | the list above, at each of 180 steps of three random runs |

## The judge, and the sets it must fail

The test first runs its judge on frames the model itself makes, so a judge that passes everything can't pass the file:

- the model's own frames pass, for each seed;
- frames that name elements by slot alone (`pool#<slot>`) fail;
- a selection that follows its slot onto the next occupant fails;
- each seed's operations reuse a slot under a new generation, and look up a removed key whose slot holds a new occupant.

All of them pass here before the binary is asked for (`BASE-FAILURE.txt`). The #537 suite's planted
`instancer_addresses_by_slot` is run there (criterion 1's third test), not here.

## Readings where the port leaves a choice

- **Which free slot an insert takes** is val's pick among the free ones, as upstream's own free list is an implementation
  detail; the property doesn't depend on it.
- **A remove through a removed key** removes nothing: a logic program owns its pool and refuses an old generation as its
  rules say (Instance `instance@1`: logic columns), as upstream's slot map refuses a stale key.
- **A slot never used** reads live false, gen 0.
- **The selection's rule** is the design's: an element leaves it at the first frame its slot's gen or live changes.

## What the implementer adds outside this folder

The `alone` line in `scripts/lanes.mjs`. Nothing else.
