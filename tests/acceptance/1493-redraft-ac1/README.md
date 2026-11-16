# Acceptance test for #1493's AC1, redrafted

This folder replaces one test of `tests/acceptance/1493/`: `#1493.943e1d6c` (AC1, familiar@1's census at the pin). The
other eight criteria stay in `tests/acceptance/1493/`, unchanged; that folder's AC1 is the one this redraft supersedes.

I drafted it blind from the same sources as the first suite (issue #1493, `docs/technical-design.md` and its "Familiar
names, counted" paragraph, `docs/canvas-primitives.md`, AGENTS.md, the base commit `0e557273`), plus the coordinator's
redraft request. The helpers are copied from `tests/acceptance/1493/helpers.ts`, never imported. Per AGENTS.md the
implementing agent doesn't edit this test.

## Redraft

Why: the first suite's independent listing counted only `export { … } from '…'` lists and `export class|function|const
X`, as the first brief said. At the pin, the reference's entry reaches most public names through `export * from` lines,
and the files those lead to export by a local list with no `from`: each geometry file ends `export { BoxGeometry };`,
the materials index is one multi-line local `export { … };`, and the rounded-box addon ends the same way. So that
listing held none of familiar@1's 17 geometry words, its material word or its addon word, while the criterion needs
the mapped rows to equal the 22 aliases and every row to name a listed name. No census could pass it.

What changed: only the listing rule (`publicNames` in `helpers.ts`). A reference file's public names are now:

- the `as` name, else the name, of each entry of any `export { … }` list, with or without `from`, on one line or many;
- X of `export class X`, `export function X`, `export function* X`, `export const X`, `export let X`, `export var X`;
- X of `export * as X from '…'`;
- nothing for a bare `export * from '…'`: the file it leads to counts when it is among the census's `reference.files`,
  and is listed on its own;
- never `default`; comments are left out first.

The census script is held to the same rule: `census.mjs --check` lists names from every file in `reference.files` by it.

Unchanged: everything else AC1 asserts, with the same tag, judges and expected values.

## The surface under test

- `packs/familiar-1.0.0/pack.json` names its census by `"census": "census.json"`; the census holds `reference {commit,
  version, files}`, `scope`, `names` rows `{name, state, target?, reason?}` and `totals.names {mapped, refused, open}`.
- `scripts/fetch-lock.json` holds a row for each of `reference.files`, its URL at the pin; `node scripts/fetch-lock.mjs
  fetch <urls>` (network not allowed) exits 0 only when each file is in `$HOME/.deepbuild/fetched/<path>` at its hash.
- `node scripts/census.mjs --check [--root <dir>]`: exit 0 and a `PASS census: …` line only when every census matches;
  each difference a `FAIL census: …` line naming the word.

## The test

`census.test.ts`, `#1493.943e1d6c`. It asserts, in order:

1. familiar@1's `pack.json` names its census; the census names the pin `65c4864b…` and states its scope.
2. Each reference file is a lock row whose URL holds the pin, and the fetcher confirms each is cached at its hash. A
   cold cache fails here, reading BLOCKED in the message: the test never passes on a cold cache.
3. From those cached files the test lists the public names itself (the rule above). Each listed name has exactly one
   row, no row names an unlisted word, each row is mapped, refused or open, each state's total counts its rows and the
   totals sum to the listing's length, and the mapped rows are exactly `pack.json`'s aliases.
4. `census.mjs --check` passes on the checkout and on a copy of familiar@1 (lock, fetcher and pack in a temporary tree
   committed to git as the before-state). In the copy, a planted alias `PlantedGeometry` with no row fails naming it;
   then, with the alias gone, a planted mapped row (the first open row made mapped, totals kept right) with no alias
   fails naming that word.

It fails on a wrong program: a census written by hand or short of the listing (or long of it) fails an equality in 3;
a script that misses either planted difference fails 4; a census whose mapped rows aren't the aliases fails 3.

## How to run

From the checkout root, after `npm ci` and `npm run build --workspaces`, with the reference cached
(`DEEP_FETCH_NETWORK=1 node scripts/fetch-lock.mjs fetch`):

```sh
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1493-redraft-ac1 --no-file-parallelism --testTimeout=600000
```

No build is needed. `BASE-FAILURE.txt` holds the base run.
