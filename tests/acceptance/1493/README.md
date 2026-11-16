# Acceptance tests for #1493: a census per pack, counted against its reference

I drafted these tests blind from these sources:

- issue #1493: its Scope, its nine acceptance criteria and its Proof
- `docs/technical-design.md`: How we know version 0 works, its "Familiar names, counted" paragraph
- `docs/canvas-primitives.md`: Pack (aliases, recipes)
- AGENTS.md
- the base commit `0e557273`, which has no implementation

At the base I also read the suites whose patterns these copy (`tests/acceptance/412`, `1399`, `1970`, `393`, `1824`),
the pin in `tests/acceptance/433/reference.ts`, `scripts/fetch-lock.mjs`, `scripts/proof-change.mjs` (`criterionId`),
and the base's pack check, close names and kit (`crates/deep-canvas/src/document/packs.rs`, `close.rs`, `check.rs`,
`pack_kinds.rs`). The helpers are written here, never imported from another suite. Per AGENTS.md the implementing
agent doesn't edit these tests; a dispute goes to a blind redraft by this job.

## The surface under test

The issue names no surface, so these tests use the ones the job's brief fixes:

1. **Census file.** `packs/<folder>/census.json`, named from `pack.json` by the key `"census": "census.json"`:
   `reference {commit, version, files}`, `scope`, `names` (one row per public name: `{name, state, target?, reason?}`),
   `params` (one row per constructor parameter of each mapped name: `{name, param, state, target?, reason?}`), and
   `totals {names, params}`, each `{mapped, refused, open}`. A `refused` row's reason is one of `imperative`,
   `renderer`, `superseded`, `no_counterpart`. The censuses these tests write list rows in an order of their own;
   `--check` judges what a census holds, not the order of its rows.
2. **Census script.** `node scripts/census.mjs [--check | --counts] [--root <dir>]`, on a tree laid out like the repo
   (`scripts/fetch-lock.json`, `packs/<folder>/`, `crates/deep-show/gallery/*.md`). It reads `reference.files` through
   the fetcher and the root's lock (cache `$HOME/.deepbuild/fetched/<path>`). `--check` prints `PASS census: …` and exits
   0 only when every census matches; each difference is a `FAIL census: …` line naming the word; a missing cache is
   `BLOCKED census: …`, exit non-zero. The before-state of a move is the census at HEAD in a root with no `origin/main`;
   a break file is `packs/<folder>/breaks/<issue>.txt` holding `census: <word> mapped -> refused` and `workaround: …`.
   `--counts` lints each gallery line quoting `<name>@<major>` as `<n> of <m>`, failing as `FAIL census: <file>:<line>: …`.
3. **`deep_kinds` op `word`** in `deep-show run`: `{word, state, reason?, target?, pack}` for a word in an installed
   pack's census.
4. **Pack check** (`install_pack`): a `refused` row with no reason is refused, with an issue at a path starting
   `census/` naming the word; each recipe an alias targets runs #1399's kit part `field.effect`.
5. **Document check** (`deep_show` in `deep-show run`): an `unknown_field` on an item looks the word up in the census of
   each installed pack the document doesn't name. The item stays refused; its `close` gains
   `{name: "<owner/pack@version>", maps: <word>, target, conversion}` (mapped) or `{name, refuses: <word>, reason}`
   (refused), after any rename and any kind that defines the field, before spelling matches; its `fix` names the pack,
   the target and the conversion (or the reason). The revision doesn't change.
6. **Planted programs**, `deep-show run --planted <name>`: `census_accepts`, `census_skipped`, `census_pack_first`.

How a reference file's public names are listed (here, apart from the script, for AC1): the `as` name (else the name)
of each entry of an `export { … } from '…'` list, and X of each `export class X`, `export function X` and
`export const X`, with comments left out. A plain `export { X };` with no `from` is not a listing line.

## Fixtures (written at test time)

- **The stub tree** (`stubTree`, census script tests): `acme/stub@1.0.0` in `packs/stub-1.0.0` with recipe `stub.box@1`
  (inputs width, height), alias BoxShape and a census of the stub library's two files, `acme-stub/src/index.js` (six
  public names: BoxShape, RoundShape, Light, Ticker, makeGizmo, REVISION) and `acme-stub/src/BoxShape.js` (BoxShape's
  constructor: width, height). The files sit in a temporary HOME's cache, pinned in the tree's own lock at their
  hashes; the tree is a git repository with one commit (the before-state). The network is never allowed.
- **The names pack** (`writeNames`, deep-show tests): `acme/names@<version>`, a familiar-names pack whose alias Shelf
  targets recipe `names.shelf@1` (inputs w, levels, bevelDepth, each changing what it draws, 2D rects as #1399's
  bookcase), with its conversion stated. Its census: Shelf mapped, Ticker refused (`imperative`), Gizmo open; Shelf's
  params w, levels and bevelDepth mapped, autoUpdate refused (`imperative`).
- **The board**: one `test.dot@1` (radius, fill), `d`, with `visible: false`, in a document that names no pack. No
  module draws test.dot@1, so a visible one is refused `module_missing`; hidden, as the kit's catalog documents hold
  test kinds, the clean board presents and its revision becomes current, and a later refusal can be seen to leave it
  so. (A `rect@1` item takes unknown params without `unknown_field` at the base, so it can't serve.)

## The tests

Each test is named by its criterion tag `#1493.<h8>`. Each fails on a wrong program as said.

| Tag | File | Asserts | Fails on a wrong program because |
|---|---|---|---|
| `#1493.943e1d6c` (AC1) | `census.test.ts` | familiar@1's `pack.json` names its census; the census names the pin `65c4864b…` and lists its reference files, each a lock row at the pin, which the fetcher must confirm cached (else the test fails, reading BLOCKED). From those cached files the test lists the names itself: each has exactly one row, no row names anything else, each state's total counts its rows and the totals sum to the listing's length, and the mapped rows are exactly the aliases. `--check` passes on the checkout and on a copy; in the copy a planted alias `PlantedGeometry` with no row, then a planted mapped row (the first open row) with no alias, each fail naming the word. | a census written by hand, short of the listing or long of it, or a script that misses either difference, fails an equality or the plant's FAIL line; a cold cache fails the fetch assertion, never passes |
| `#1493.d1b3af60` (AC2) | `census.test.ts` | the stub as counted passes `--check`; with `export { Extra } from './extra.js';` added to its index (cache and lock updated) `--check` exits non-zero with a FAIL line naming Extra and no PASS line; with the cache removed its first state line is BLOCKED, exit non-zero, no PASS | a script that counts from its own list or the census itself misses Extra; one that passes or fails on a missing cache isn't BLOCKED |
| `#1493.cd0a4e1c` (AC3) | `word.test.ts` | with acme/names@1.0.0 installed, `deep_kinds` word Ticker answers `state: refused, reason: imperative` and Gizmo `state: open`; acme/names@1.0.1, whose Ticker row has no reason, is refused by `install_pack` with an issue at `census/…` naming Ticker; the same plant in the stub tree fails `--check` naming Ticker | an answer with no state or reason (the base's `no_match`), or a check that admits a reasonless refusal |
| `#1493.4299b7da` (AC4) | `census.test.ts` | BoxShape mapped at HEAD and refused (`superseded`) in the working tree, its alias and param rows gone and totals right, fails `--check` naming BoxShape; with `breaks/1493.txt` it passes | a check that never compares with the before-state passes the move; one that ignores the break file fails the control |
| `#1493.e36cbcda` (AC5) | `census.test.ts` | `--counts` passes on the checkout's gallery; in the stub tree a line `stub@1 maps 1 of 6 …` passes and `2 of 6` fails with a FAIL line naming `stub-names.md:3` | a lint that never reads the census, or names no file and line |
| `#1493.d175c804` (AC6) | `recipe.test.ts` | acme/names@1.0.0 installs; acme/names@1.0.1, whose recipe gains input gloss (mapped in its census) that no step reads, is refused with an error naming kit part `field.effect` and gloss as data | a pack check that runs no kit on an alias's recipe installs the plant |
| `#1493.fcddaf21` (AC7) | `document.test.ts` | bevelDepth (mapped by acme/names) set on the dot: `unknown_field` at `items/d/params/bevelDepth`, its close holds `{name: "acme/names@1.0.0", maps: "bevelDepth", target ∋ bevelDepth, conversion: <the pack's>}`, its fix names acme/names, the target and the conversion, and DOC's current revision hash is unchanged. `census_accepts` fails naming bevelDepth (the revision changes or no refusal); `census_skipped` fails naming it (no pack entry) | as the plants show: accepting the word, or offering only spelling matches |
| `#1493.1d536b9e` (AC8) | `document.test.ts` | autoUpdate (refused, `imperative`) set on the dot: `unknown_field` whose close holds `{name: "acme/names@1.0.0", refuses: "autoUpdate", reason: "imperative"}` and whose fix holds `imperative` | a check that skips refused rows, or drops the reason |
| `#1493.4db739b5` (AC9) | `document.test.ts` | w (defined by test.rect@1, mapped by acme/names) set on the dot: in the close, test.rect@1 comes before the acme/names entry, and the fix names test.rect@1 before acme/names. `census_pack_first` fails naming w | a check that puts the pack first |

The setup of each document scenario (the pack installed, the clean dot a current revision) must hold on the right
program and under each plant, so a plant fails the criterion's own judge, not its setup.

## How to run

From the checkout root, after `npm ci` and `npm run build --workspaces`, with cargo on PATH:

```sh
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1493 --no-file-parallelism --testTimeout=600000
```

AC1 needs the reference files cached at the pin first: `DEEP_FETCH_NETWORK=1 node scripts/fetch-lock.mjs fetch`. The
other census tests are offline, in temporary folders and a temporary HOME. The deep-show tests build `deep-show` with
`--no-default-features --features full` once per file.

## Base failure

`BASE-FAILURE.txt` holds the base run: every test fails at an assertion (no census key in familiar@1's `pack.json`;
no `scripts/census.mjs`; the base pack check refuses the unknown manifest key `census`).
