# Blind redraft: #420 AC2 (the play part) and AC9

Redrafted under AGENTS.md (Proof) and the design's Dogfooding and Tests written first lines: a fresh run of the
acceptance job, from the criteria, issue #420, the design sections it links, #387's acceptance README (what `eval`'s
`nodes` and their `run` mean) and the surface `../README.md` defines, at the base commit plus the first suite
(`0f1e6631`). This job didn't read the tests it redrafts (`../modifiers.test.ts`'s third test and
`../disabled.test.ts`), and no implementation of #420 existed. It edits no file of the first suite; the files
here only import `../helpers.ts`.

| File | Criterion | Redrafts |
|---|---|---|
| `play-redraft.test.ts` (1 test) | AC2 `#420.0fd522a3`, the part "one that doesn't read time never rebuilds while playing" | the third test in `../modifiers.test.ts` |
| `disabled-redraft.test.ts` (2 tests) | AC9 `#420.9d6960ba` | both tests in `../disabled.test.ts` |

## Surfaces read

Everything goes through `deep-show run` (built `--no-default-features --features full`, by `useBins`), one scenario
per test, one document session (`DOC.a`) driven by whole revisions (`deep_show`), as `../README.md` says:

- `eval` (#387): `nodes[]` with `operator`, `phase`, `item`, `key`, `result` and `run` (`ran | hit | kept`). Nodes
  are read per item. The phase is sorted into #387's closed lists (Phase: Check `load … check`, Frame `latch …
  feedback`), because #387's README says a revision's check-phase nodes are listed "as the revision's check had
  them" in every frame of that revision: a check-phase node is held to being the same check (equal `key`,
  `result` and `run` in every frame of the revision), and a frame-phase node to not running (`run` ≠ `ran`).
- `geometry` (this suite): the item's `key` (content key of its final geometry), `positions`, `built`, and `stack`
  rows (`kind`, `class`, `reads_time`, `enabled`).
- `deep_show`'s reply: `admitted` (presented, no error, nothing skipped as `unknown_kind`), and #393's `changed`
  and `unchanged` lists.
- Channels are the document's top-level `channels`, targeting a modifier param by path
  (`items/moving/modifiers/0/params/offset/0`), as `../README.md` and #380's suite write them.

## What each test asserts

### `play-redraft.test.ts`

`AC2 #420.0fd522a3 over 31 frames in 1.5 s no node of a stack that reads no time runs after the first frame, while
its time-bound twin's run every frame`: two 1 m slab boxes (`still`, `moving`) with the same stack,
`mod.array@1 {count: 2, offset: [1.5, 0, 0]}` then `mod.mirror@1 {axes: ["x"]}`; a channel drives `moving`'s
array offset x from 1.5 m at 0 s to 3 m at 1.5 s. Calls: the revision, `geometry` at 0 s, 31 `eval`s at 0, 0.05,
…, 1.5 s, `geometry` at 1.5 s.

- `geometry`'s stack rows: `still`'s two modifiers don't read time; `moving`'s array does (computed from the bound
  param, never declared).
- Every node of either item is in one of the closed phase lists.
- `still`, in every frame after the first: the same node set; no frame-phase node `ran` or changed its key; every
  check-phase node equals the first frame's (same key, result and run).
- The twin: the same check on `moving` fails, naming `moving`, and in each of the 30 frames after the first a
  frame-phase node of `moving` `ran`. This is the planted twin the criterion lacks: the check sees a rebuild
  when one happens.
- `still`'s geometry key and positions at 1.5 s equal those at 0 s; `moving`'s key and positions differ.

Wrong programs it fails: a static stack rebuilt each frame; a stack keyed by a clock or a frame counter; a check
rerun per frame; a time-bound stack that never reruns; `reads_time` that isn't computed from the bound params.

### `disabled-redraft.test.ts`

A `curve@1` rail (three linear points in the xy plane) and a bar, `slab@1 {size: [2, 0.1, 0.1]}`, with one
modifier, `mod.curve_deform@1 {path: "rail", axis: "x"}`, `enabled: false`. Each step is a whole revision that
differs from the last at one path, then an `eval` frame and `geometry` for the bar, at rising times.

1. `AC9 #420.9d6960ba moving the rail a disabled mod.curve_deform@1 names leaves the bar's keys and work alone;
   enabling it reruns the bar in the next frame and in none of the three after; once enabled, moving the rail
   reruns it`:
   - rev 1 → rev 2 (the rail's middle point moved up, modifier disabled): rev 2's reply lists `rail` as `changed`
     and `bar` as `unchanged`; the bar's stack is one `deform` row, `enabled: false`; the bar has nodes, the same
     set in both frames, none `ran` after rev 2, each with the key and result it had after rev 1; the bar's
     geometry key and positions are unchanged.
   - rev 3 (`items/bar/modifiers/0/enabled` true) and four frames: in the first a bar node `ran`, the bar's node
     keys and geometry key differ from rev 2's, its stack row is enabled, and a vertex moved more than 5 cm (it
     bends); in the three after, the same node set, no frame-phase bar node `ran`, and check-phase ones equal the
     first frame's (one check, so one rebuild).
   - rev 4 (the rail's middle point moved down, modifier enabled): a bar node `ran`, the geometry key changes and a
     vertex moves more than 5 cm. This is the control: with the reference live, the same move does rerun the bar.
2. `AC9 #420.9d6960ba planted keeps_disabled_refs reruns the bar when the rail moves, and the check fails naming
   mod.curve_deform@1 and items/bar/modifiers/0`: rev 1 → rev 2 under scenario `planted: "keeps_disabled_refs"`;
   the same check as in test 1 must find a failure naming `mod.curve_deform@1` and `items/bar/modifiers/0` (the
   check names the disabled modifier by the kind and index the bar's stack reports), and among the failures a bar
   node that reran, a node key that moved, or a geometry key that moved.

Wrong programs it fails: a disabled modifier's references in the key or the read set; an enable that never rebuilds;
an enable that rebuilds every frame; an enabled modifier that ignores the rail it names.

## Readings where the criteria leave a choice

- **"Rebuilds" and "work counters"** are nodes whose operator ran (`run: "ran"`); a `hit` or `kept` node did no
  work. The `frames` call's `ran` counts the whole document, the rail's nodes included, so it can't be read per item.
- **"Once"** is one rebuild across the frames of the enabling revision: a node runs in its first frame and no
  frame-phase node runs in the three after, while its check-phase nodes stay the one check that revision had.
- **"Bends it"** is read as vertices moving by more than 5 cm, not as exact positions: the criterion doesn't fix
  where along the rail the bar's origin maps, and an 8-vertex slab only shows its ends.
- **Playing** is `eval` at rising times in one session; the still camera means nothing else moves.

## Run them

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/420 --no-file-parallelism redraft/
node node_modules/typescript/bin/tsc -p tests/acceptance/420/tsconfig.json   # ../tsconfig.json includes ./**/*.ts, so redraft/ too
```

`BASE-FAILURE.txt` is that run at `0f1e6631` on this Mac.

## Swapped in (owner approved, Nov 2: "close the gaps")

These redrafts replace the tests they redraft: the third test of `../modifiers.test.ts` is removed from that file
and `../disabled.test.ts` is deleted. Both originals counted a check-phase node (`core.lower`), which #387's `eval`
lists as the revision's check had them in every frame of a revision, as a rebuild in each frame; every frame-phase
node met both criteria there, and these redrafts pass on the change.
