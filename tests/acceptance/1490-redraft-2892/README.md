# Blind redraft for #1490, criterion 2: the set a piece bundles, after #2892

A fresh draft of `../1490/picks.test.ts` and the `setFailures` it uses from `../1490/helpers.ts`, written blind as the
design's Dogfooding rule says: from issue #2892 (live, November 21, 2026, with its decision comment: gzip), issue
#1490 (live), its parent #172, the design and the base commit `5f5791e2d` ("Merge pull request #3068") with the first
draft of #1490's suite in `tests/acceptance/1490/`. No implementation of #2892 existed; no other branch, worktree,
PR, stash or session was read. The implementing agent doesn't edit these files (AGENTS.md, Proof). The first draft's
other four files stand.

## Why

#2892 stores the player's WebAssembly gzip, "named from the sha256 of its stored bytes", and the page inflates it
after checking those bytes; the page glue stays as it is. The first draft's `setFailures` reads every bundle file's
raw SHA-256 and holds the receipt's `player.hash` to be the set's WebAssembly (`sets.json`'s `wasm.sha256`). On a
right #2892 program the bundle holds no file whose stored bytes hash to the set's player, and `player.hash` names the
stored bytes (#172's helpers, which stay, hold it to be one of the receipt's files' `sha256`, the SHA-256 of the file
on disk), so the first draft fails at "the receipt's player … is not the set figure's …" and "the bundle doesn't hold
the set figure's player".

## What was read

- The issues, live: #2892 (`gh issue view 2892 --repo windoliver/deepbuild --comments`), #1490 (criterion 2; its
  closing comment), #172.
- AGENTS.md; `docs/canvas-primitives.md`: Export: web player (printed by `node scripts/design-section.mjs --issue
  2892`; the script serves open issues only).
- The first draft: `../1490/README.md`, `../1490/picks.test.ts`, `../1490/helpers.ts`; `../172/helpers.ts`.
- At the base, for surfaces only: `crates/deep-show/src/export/web.rs` (the sets, the receipt's `player`, file
  names), `crates/deep-show/src/export.rs` (`web_picks_full_set`), `crates/deep-player/web/dist/sets.json`.

## What changed, and what didn't

`helpers.ts` holds the one redrafted function, `setFailures`. It reads each bundle file as the page reads it, through
`../172-redraft-2892/helpers.ts` (a file whose stored bytes start `1f 8b` is inflated with Node's zlib; any other is
read as stored; no receipt or index field for the stored form is read):

- the receipt's player is the receipt's file whose `sha256` is `player.hash`; read so, it must hash to the set's
  `wasm.sha256`;
- the bundle holds the set's player and page glue when some file, read so, hashes to the record's `wasm.sha256` and
  `glue.sha256`, and no file read so hashes to another set's player.

Unchanged, imported from the first draft: the receipt naming `player.module_set`, its `module_set_digest`, the size
record (`readRecord`), the export (`exportPiece`, which also holds the bundle to its receipt by #172's
`bundleFailures`), the 2D slider fixture, the physics lab and the planted picker `web_picks_full_set`.

New in the test, made in test code from the slider fixture's real bundle: the gzip twin (`figure`'s player stored gzip
under its own name, which must still bundle `figure`) and the twin without it (every file that reads as `figure`'s
player removed, which must fail, naming that player's SHA-256).

## Run it

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci && npm run build --workspaces            # once, in a fresh worktree
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/1490-redraft-2892 picks.test.ts --testTimeout=3600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/1490-redraft-2892/tsconfig.json   # type check
rm -rf tests/acceptance/1490-redraft-2892/node_modules                                       # vitest's cache after a --root run
```

The file builds `deep-show` (`full`) once in `beforeAll`, as the first draft does, and `deep-logic` once for the lab's
program (#533's layout probe). No browser. Temp folders are removed after the test.

`scripts/lanes.mjs` needs these lines (the implementer adds them):

```js
// #1490's first-draft picks test reads each bundle file's raw SHA-256, so under #2892, which stores the player gzip,
// it fails a right program; its blind redraft reads each file as the page does and runs in its place.
alone.push('tests/acceptance/1490-redraft-2892/');
byHand.push('tests/acceptance/1490/picks.test.ts');
```

## Criterion to test

The ID is `#1490.` and the first 8 hex digits of the SHA-256 of the criterion's text, checked against the live issue:
the first draft's `AC[2]`.

| AC | ID | File (tests) | What it asserts, and the wrong programs it fails on |
|---|---|---|---|
| 2 | `#1490.db64c0a5` | `picks.test.ts` (1): `AC2 #1490.db64c0a5 the 2D slider fixture bundles figure and its receipt names it, its files read as the page reads them; the physics lab bundles full; the planted web_picks_full_set fails, naming figure` | The slider fixture's receipt names `figure` with its digest; its player, read as the page reads it, is `figure`'s; the bundle holds `figure`'s player and glue as read and no other set's player. The gzip twin still bundles `figure`; the twin without `figure`'s player fails, naming it. The physics lab: the same for `full`. The planted `web_picks_full_set` bundles `full` for the slider fixture and fails, naming `figure`. Fails on: the merge base before #1490 (no set named; one player); a picker that takes `full` for every piece (the plant); a receipt that names a set its player isn't; a bundle without the set's player in any form (the twin); a reading of raw hashes alone, which fails every bundle #2892 writes and the gzip twin |

Test count: 1. At the base it is read to pass (`BASE-FAILURE.txt`).

## Planted programs

`web_picks_full_set` (#1490's, at the base). Nothing new is asked of the implementer.

## Readings where the issue and design leave a choice

- **"Bundles `figure`"** under #2892: the bundle holds `figure`'s player as the page reads it, inflated where stored
  gzip, by the size record's SHA-256 of the WebAssembly; and the page glue, which #2892 leaves as it is, by its own.
- **The receipt's player**: the file `player.hash` names, as #172's helpers hold it, read as the page reads it. Its
  hash is never compared with the set's WebAssembly directly.

## Legs that read BLOCKED or INCONCLUSIVE

None. The file fails, naming the build, while `deep-show` or `deep-logic` doesn't build.

## Not tested, and why

The first draft's criteria 1, 3, 4 and 5 (their files stand: none reads a bundle file's bytes but the reproducible
bundles' byte-for-byte comparison, which holds under #2892); the stored form's sizes (#2892's own suite and #172
criterion 4's redraft).
