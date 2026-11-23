# Blind redraft of #192's criterion 6 test (`#192.562b7ffc`), after #2892

A redraft of `tests/acceptance/192/packs/outside.test.ts`, written blind as the design's Dogfooding rule says: from
issue #2892 (live, November 21, 2026, with its decision comment: gzip), issue #192 (live), the design and the base
commit `5f5791e2d` ("Merge pull request #3068") with the first draft of #192's pack suite in
`tests/acceptance/192/packs/`. No implementation of #2892 existed; no other branch, worktree, PR, stash or session
was read. The implementing agent doesn't edit these files (AGENTS.md, Proof). The suite's other files stand.

## Why

The first draft's web-bundle half reads the receipt and the files as stored. #2892 stores the mesh, a file with no
compression of its own, gzip, "named from the sha256 of its stored bytes", and the page inflates it after checking
those bytes. On a right #2892 program the receipt lists no file whose `sha256` is the mesh's, no file's name starts
with the mesh's hash, and the player's `isWasm` test meets `1f 8b`, so the first draft fails at "the bundle lists the
provider's mesh … among its files". And its search for the provider program's bytes, raw, in hex or in base64, sees
nothing inside a file stored gzip, so it would pass a bundle that ships the program in one.

## What changed, and what didn't

The install half is the first draft's, unchanged. The web-bundle half (`bundleFailures` in the test file) reads each
file as the page reads it, through `../../172-redraft-2892/helpers.ts` (a file whose stored bytes start `1f 8b` is
inflated with Node's zlib; any other is read as stored; no receipt or index field for the stored form is read):

- **The mesh by hash**: a file whose bytes as read hash to the mesh's SHA-256; that file named from the SHA-256 of
  its stored bytes and listed so by the receipt (#172's helpers hold each receipt file's `sha256` to be the file on
  disk's); and the mesh's SHA-256 on the index page, where the page finds what the document names by hash.
- **No provider program**: the only WebAssembly as read is the receipt's player (the file its `player.hash` names), and
  no file holds the program's bytes raw, in hex or in base64, in its stored bytes or inflated.

New in the test, made in test code from the voxel piece's real bundle: the program twin (the provider's program added
as a file of its own, stored gzip and named from the SHA-256 of those stored bytes, as #2892 names files), which must
fail naming that file twice, as WebAssembly that isn't the player and as the program's bytes; and the meshless twin
(every file that reads as the mesh removed), which must fail naming the mesh.

The test file copies four fixture definitions from the first draft's test file, which exports nothing: the grid, the
`mesher` providers entry, the three planted entries and the voxel piece. Everything else is imported from
`../packs/helpers.ts`.

## What was read

- The issues, live: #2892 (`gh issue view 2892 --repo windoliver/deepbuild --comments`) and #192 (criterion 6; its
  Scope's "the web player's bundle carries outputs by hash and runs no provider").
- AGENTS.md; `docs/canvas-primitives.md`: Export: web player (printed by `node scripts/design-section.mjs --issue
  2892`; the script serves open issues only) and Provider `gen@1` ("The web player's bundle carries outputs by hash
  and runs no provider").
- The first draft: `../packs/README.md`, `../packs/outside.test.ts`, `../packs/helpers.ts`;
  `../packs-redraft-ac12/README.md` (this README's model).
- At the base, for surfaces only: `crates/deep-show/src/export/web.rs` (file names, the index page's manifest, which
  lists every file but the element's script with its `sha256`, the fallback page's files among them; the receipt).

## Run it

As the packs suite (Homebrew's rustup on PATH, `npm ci` and `npm run build --workspaces` once in a fresh worktree):

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:/opt/homebrew/opt/rustup/bin:$PATH"
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 120 -- sh scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/192/packs-redraft-2892 outside.test.ts --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/192/packs-redraft-2892/tsconfig.json   # type check
rm -rf tests/acceptance/192/packs-redraft-2892/node_modules                                       # vitest's cache after a --root run
```

It builds what the first draft builds: #544's fixture assembler and `deep-show` (`full,test-mesh-item`) through
#238's helpers. No browser. Temp folders are removed after the test.

`scripts/lanes.mjs` needs these lines (the implementer adds them):

```js
// #192's first-draft outside test reads the voxel bundle's receipt and files as stored, so under #2892, which stores
// the mesh gzip, it fails a right program and can't see a program inside a stored file; its blind redraft reads each
// file as the page does and runs in its place.
alone.push('tests/acceptance/192/packs-redraft-2892/');
byHand.push('tests/acceptance/192/packs/outside.test.ts');
```

## Criterion to test

| Criterion | ID | File | What it asserts, and the wrong programs it fails on |
|---|---|---|---|
| 6 | `#192.562b7ffc` | `outside.test.ts` (1 test): `#192.562b7ffc an outside pack whose providers entry also names a check kind, a builder or an operator is refused at install, naming the entry; the voxel piece's web player bundle, read as the page reads it, holds the mesh by hash and no provider program` | The three planted packs are refused at install with an issue at `providers/mesher/<key>`, the clean one installs (the first draft's). The voxel piece exports; read as the page reads it, its bundle holds the mesh by hash and no provider program, as above; the program twin and the meshless twin fail, naming the file and the mesh. Fails on: a pack check that takes a providers entry's `check_kind`, `builder` or `operator`; an export that leaves the mesh out, or names or lists it by anything but its hash; an export that ships the provider's program, as it is, in hex, in base64 or in a file stored gzip (the program twin); #2892's wrong reading, stored bytes alone, which fails every bundle #2892 writes and misses the program twin |

The ID is `#192.` and the first 8 hex digits of the SHA-256 of the criterion's text, checked against the live issue;
the test's name starts with it, as the first draft's does. At the base the test is read to pass (`BASE-FAILURE.txt`).

## Planted programs

The first draft's three planted packs (`check_kind`, `builder`, `operator`). Nothing new is asked of the implementer.

## Readings where the issue and design leave a choice

- **"Holds the mesh by hash"** under #2892: the mesh's bytes are in the bundle, in a file the page can find by the
  mesh's own hash (the index page names it) and check by its stored bytes' hash (its name and the receipt's entry).
- **"No provider program"**: no WebAssembly but the player as the page reads it, and the program's bytes in no form
  in any file, stored or inflated; a stored file is gzip when its stored bytes start `1f 8b`.

## Legs that read BLOCKED or INCONCLUSIVE

As the first draft's: off macOS it fails `INCONCLUSIVE:` first; cargo that can't run, or a fixture assembler that
doesn't build, is `BLOCKED:`. None is ever a pass.

## Not tested, and why

The suite's other criteria (their files stand; none reads a bundle); the stored form's sizes, index and receipt
fields (#2892's own suite).
