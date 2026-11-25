# Blind redraft for #172, criteria 2 (the secrets) and 3 (no shared memory), after #2892

A fresh draft of two first-draft tests, written blind as the design's Dogfooding rule says: from issue #2892 (live,
November 21, 2026, with its decision comment: gzip), issue #172 (live), the design and the base commit `5f5791e2d`
("Merge pull request #3068") with the first draft of #172's suite in `tests/acceptance/172/`. No implementation of
#2892 existed; no other branch, worktree, PR, stash or session was read. The implementing agent doesn't edit these
files (AGENTS.md, Proof).

Only these two tests are redrafted; every other test of the first draft stands:

- `../172/hashes.test.ts`, its second test, "the player's WebAssembly declares no shared memory, and the page runs
  without cross-origin isolation" (criterion 3's second half). Its first test, the logic program one byte off its
  recorded hash, holds under #2892 as written.
- `../172/refusals.test.ts`, its first test, "a secret in the app's store and the hub's socket path appear in no file
  of the lab's bundle" (criterion 2's secrets half). Its refusal half is already `../172-redraft-ac2/`'s.

## Why these two

#2892 stores every bundle file but the index page, the element's script, the page glue and the files whose format
already compresses its data gzip, "named from the sha256 of its stored bytes", and the page inflates each one after
checking those stored bytes. Both first-draft tests read stored bytes:

- The no-shared-memory test finds WebAssembly by its first bytes (`isWasm`). A player stored gzip starts `1f 8b`, so
  on a right program it counts no module and fails at "the bundle holds WebAssembly: the player".
- The secrets test searches each file's stored bytes. Inside a file stored gzip the secret reads as other bytes, so it
  passes a bundle that leaks the secret into its document, its input track or any other stored file.

## What was read

- The issues, live: #2892 (`gh issue view 2892 --repo windoliver/deepbuild --comments`: Scope, criteria 2 and 3, the
  decision) and #172 (criteria 2 and 3, Scope's "No app shell, question card, hub, secrets or record writes").
- AGENTS.md; `docs/canvas-primitives.md`: Export: web player (printed by `node scripts/design-section.mjs --issue
  2892`; the script serves open issues only, so #172's sections were read in the file), and Export: web player:
  compressed sound.
- The first draft: `../172/README.md` (The surface under test, Planted programs, Readings), `../172/hashes.test.ts`,
  `../172/refusals.test.ts`, `../172/helpers.ts`, `../172-redraft-ac2/README.md` (this README's model).
- At the base, for surfaces only: `crates/deep-show/src/export/web.rs` (file names from each file's SHA-256, the index
  page's manifest, the receipt's `files` and `player.hash`, the planted names), `crates/deep-player/web/element.js`
  (`#fetch`), `crates/deep-player/web/dist/full/player_bg.wasm`'s sections (one memory, defined, flags 0).

## Reading a bundle as its page reads it (`helpers.ts`)

One reader, shared with `../1490-redraft-2892/`, `../192/packs-redraft-2892/` and `../210-redraft-2892/`:

- A file whose stored bytes start with gzip's magic, `1f 8b`, is inflated with Node's zlib (`gunzipSync`, at most
  256 MiB); any other file is read as stored. No receipt or index field for the stored form is read, since #2892's
  implementer names them.
- A leak search looks in both the stored bytes and the inflated bytes, and names the file and which.
- A file that starts with the magic and doesn't inflate is a failure of a leak search: a leak there can't be ruled
  out.
- The player is the receipt's file whose `sha256` is `player.hash`, read so. #172's helpers, which stay, hold
  `player.hash` to be one of the receipt's files' `sha256`, the SHA-256 of the file on disk, so under #2892 it names
  stored bytes; the player's WebAssembly is found by inflating that file, never by comparing `player.hash` with it.

## Run it

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci && npm run build --workspaces            # once, in a fresh worktree
for f in secrets shared-memory; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/172-redraft-2892 $f.test.ts --testTimeout=3600000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/172-redraft-2892/tsconfig.json   # type check
rm -rf tests/acceptance/172-redraft-2892/node_modules                                       # vitest's cache after a --root run
```

Each file builds `deep-show` (`full`) once in `beforeAll` through #169's `useShow`, and `deep-logic` once through
#533's layout probe, since both export #172's lab. `shared-memory.test.ts` also serves the bundle from a child process
and plays it in headless Chrome with WebGPU on, each stopped by its PID. Temp folders are removed after each test.

`scripts/lanes.mjs` needs these lines (this job writes only its folders; the implementer adds them):

```js
// #172's first-draft no-shared-memory test finds the player by WebAssembly's first bytes and its secrets test searches
// stored bytes, so under #2892, which stores most bundle files gzip, the first counts no module and the second can't
// see a leak; their blind redraft reads each file as the page does and runs in their place. The first draft's
// hashes.test.ts, with its logic-program test, runs by hand (its refusals.test.ts already does).
alone.push('tests/acceptance/172-redraft-2892/');
byHand.push('tests/acceptance/172/hashes.test.ts');
```

## Criteria to tests

IDs are `#172.` and the first 8 hex digits of the SHA-256 of each criterion's text (`criterionId`, as
`scripts/closed-sweep.mjs` computes it), checked against the live issue: the first draft's `AC[2]` and `AC[3]`.

| AC | ID | File (tests) | What it asserts, and the wrong programs it fails on |
|---|---|---|---|
| 2 (secrets) | `#172.33b3fb42` | `secrets.test.ts` (1): `AC2 #172.33b3fb42 a secret in the app's store and the hub's socket path appear in no file of the lab's bundle, stored or inflated` | The lab exported with a secret in the store (`secrets.weather_key`) and the hub's socket path (`hub.socket`): no file holds the secret, its base64 or the path, in its stored bytes or, stored gzip, its inflated bytes (names the file and which). The leak twin, a copy of that bundle with the three planted inside one file stored gzip, fails the same search for each, naming the file. Fails on: an export that leaks the store or the hub's address into any file, stored as it is or gzip (the twin); a search of stored bytes alone (#2892's wrong reading: the twin) |
| 3 (no shared memory) | `#172.94f85be4` | `shared-memory.test.ts` (1): `AC3 #172.94f85be4 the player's WebAssembly, read as the page reads it, declares no shared memory, and the page runs without cross-origin isolation` | The receipt's player, read as the page reads it, is WebAssembly and declares or imports a memory; every WebAssembly file read so (the player, the lab's logic program) declares and imports no shared memory, at least one; the shared twin, the bundle with its player's memory marked shared and stored gzip, fails, naming the player's file; served with no COOP or COEP the page is ready, `crossOriginIsolated` false, `SharedArrayBuffer` undefined. Fails on: a player built with threads or shared memory, stored as it is or gzip (the twin; or it never starts without isolation); a bundle with no WebAssembly as read; a reading of stored bytes alone (on a #2892 bundle it counts no module; on the twin it sees no shared memory) |

Test count: 2. At the base both are read to pass (`BASE-FAILURE.txt`): the base stores every file as it is, and the
reader reads such a file as stored.

## The surface under test

The first draft's, unchanged (`../172/README.md`: The surface under test): `deep-show run` scenarios with `deep show`
and `{call: "export", video: {codec: "web"}}`, the scenario's `secrets` and `hub: {socket}`, the receipt, the server
with no isolation headers and headless Chrome. This redraft asks the implementer for nothing new: no field, no
planted name.

## Planted programs

None new. The wrong programs are twins made in test code from the real bundle, as the first draft made its logic
program one byte off (`../172/README.md`: Planted programs):

| Twin | Made from | Criterion | A failure must name |
|---|---|---|---|
| The leak twin | the lab's bundle, with the secret, its base64 and the socket path in the middle of the smallest file stored gzip (at the base, which has none, the smallest file but the index page), then that file stored gzip at level 9 under its name; a file whose gzip would still show a needle as it is is passed over | 2 | the planted file, for each of the three |
| The shared twin | the lab's bundle, with its player inflated, its first defined memory's limits flag bit 1 set (what #172's `wasmMemories` reads as shared) and the player stored gzip under its name | 3 | the player's file |

## Readings where the issue and design leave a choice

- **"Never appear in the bundle's bytes"**, under #2892: in no file's stored bytes and in no bytes the page inflates
  from one. A file whose format already compresses its data (PNG, JPEG, a font, FLAC, Opus) is searched as stored,
  as the page takes it; its own compressed payload isn't decoded.
- **"The player's WebAssembly"**: the player as the page reads it, and, as the first draft scanned, every other
  WebAssembly file read so. The player must hold a memory, so the check reads one and not nothing.
- **A gzip-stored file**: one whose stored bytes start `1f 8b`, whatever its name or the index says of it. Holding a
  stored file to its hash is the page's part, which #2892's own suite and the first draft's logic-program test check.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- `shared-memory.test.ts` is BLOCKED without Google Chrome at its path (or `CHROME_BIN`), when Chrome opens no
  DevTools port within 60 s, or when headless Chrome offers no WebGPU adapter (#172's harness, unchanged).
- Both files fail, naming the build, while `deep-show` or `deep-logic` doesn't build.

## Not tested, and why

The first draft's other tests (they stand); a leak inside a format's own compression, such as a PNG's or a font's
(the page reads those as stored, and #2892 leaves them as stored); the stored form itself, its sizes, its index and
its receipt fields, and the page's check-then-inflate order (#2892's own suite).
