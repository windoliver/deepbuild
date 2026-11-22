# Blind redraft for #172, criterion 4: the player's size, counted as the bundle stores it

A fresh draft of one half of one criterion, the size half of #172's criterion 4 ("the player is under 12 MB
compressed without fonts and assets"), written blind as the design's Dogfooding rule says, because #2892's criterion 3
asks for it: "#172's size criterion still counts the player's WebAssembly once it is stored compressed. Its test finds
the player by the WebAssembly's first bytes today (`tests/acceptance/172/budgets.test.ts`), so on a stored bundle it
would count the scripts alone and pass on 0.1 MB. Its blind redraft counts the stored file, and a planted bundle whose
player is over the 12 MB fails it." Written from issue #172 (live, November 21, 2026), issue #2892 (live, with its
decision comment of 2026-11-19, gzip, and criterion 2's re-draft comment of 2026-11-21), the design and the base commit `5f5791e2d` ("Merge pull request #3068"), with
the first draft of #172's suite in `tests/acceptance/172/`. No implementation, other branch, other worktree, PR or
dispute was read. The implementing agent doesn't edit these files (AGENTS.md, Proof).

The first draft's other two tests in `../172/budgets.test.ts` (the perf lane's task and the reference Mac's times)
stand; they aren't redrafted. The first draft's size test stays in its file and still runs; on a bundle that stores
the player compressed it no longer proves the criterion (it would count the scripts alone), and this redraft's tests
are the ones that do. Whether this redraft replaces it is the owner's ruling, as for #172's criterion 2.

## What was read

- Issue #172, live (`gh issue view 172 --repo windoliver/deepbuild`): its criterion 4. Issue #2892, live, with its
  decision comment: its Scope (what is stored compressed, the receipt's stored and inflated bytes) and criterion 3.
- AGENTS.md; `docs/canvas-primitives.md`: Export: web player (its Cost line, "the player about 5 to 10 MB compressed
  without fonts and assets"); `docs/technical-design.md`: the `ship` paragraph.
- The first draft: `../172/README.md` (The surface under test, Readings: "Under 12 MB compressed without fonts and
  assets"), `../172/budgets.test.ts`, `../172/helpers.ts`; the model of a redraft folder, `../172-redraft-ac2/`.
- At the base, for surfaces only: `crates/deep-show/src/export/web.rs` (the receipt's `files` with `bytes`, the
  player's hash, the index page's import map and element script), `crates/deep-player/web/dist/sets.json`,
  `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`.

Every expected value comes from the issues and the design.

## Run it

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci && npm run build --workspaces            # once, in a fresh worktree
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/172-redraft-ac4 size.test.ts --testTimeout=3600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/172-redraft-ac4/tsconfig.json   # type check
rm -rf tests/acceptance/172-redraft-ac4/node_modules                                       # vitest's cache after a --root run
```

The file builds `deep-show` (`full`) once in `beforeAll` through #169's `useShow` and exports the lab twice; no
browser, no timing. Temp folders are removed after each test. `scripts/lanes.mjs` needs
`alone.push('tests/acceptance/172-redraft-ac4/')` (the implementer adds it, with #2892's lines; see
`../2892/README.md`).

## Criterion to tests

The ID is `#172.` and the first 8 hex digits of the SHA-256 of the criterion's text (`criterionId` in
`scripts/proof-change.mjs`, from the live issue), the first draft's `AC[4]`. Each test's name also carries #2892's
criterion 3, `#2892.62d3dff4`, which this redraft proves.

| AC | ID | File (tests) | What it asserts, and the wrong programs it fails on |
|---|---|---|---|
| 4 (size) | `#172.1e1f958d` (and `#2892.62d3dff4`) | `size.test.ts` (2): `AC4 #172.1e1f958d (#2892's AC3 #2892.62d3dff4) the lab's player is under 12 MB compressed without fonts and assets, its WebAssembly counted as the bundle stores it (on any machine)`; `AC4 #172.1e1f958d (#2892's AC3 #2892.62d3dff4) a planted bundle whose player is over 12 MB (web_player_over_12mb) fails the measure, naming the player file` | The lab exported to the web; its player found by the receipt (the file whose stored or inflated SHA-256 is `player.hash`) and checked to hold that WebAssembly (inflated first when the receipt marks it stored compressed); the player's bytes compressed, below, under 12,000,000 B. The planted export `web_player_over_12mb` fails the same measure, the failure naming the player file. Fails on: a measure that finds the player by its first bytes (on a stored bundle it counts the scripts alone, and the planted bundle passes it); a player over 12 MB as stored |

Test count: 2.

## The surface under test

The first draft's (`../172/README.md`: The surface under test) and #2892's receipt (`../2892/README.md`: The
receipt), so the implementer builds one surface:

- `deep-show run` with `deep show` then `{call: "export", doc, out, video: {codec: "web"}, track}` (#172's
  `exportLab`).
- The receipt's `player.hash` and `files: [{path, sha256, bytes, inflated?: {bytes, sha256}}]`: `sha256` and `bytes` of
  the stored bytes; `inflated` on a file the bundle stores compressed. The player is the file whose `sha256` or
  `inflated.sha256` is `player.hash`, so either reading of `player.hash` (#172's first draft: a stored file's; #1490's:
  the set's WebAssembly's) finds it.
- The index page (the base's): its import map names the page glue; each script element's `src`, the element's script.

**Planted** *(chosen; the scenario's `planted` key; at the base it answers `bad_input`)*: `web_player_over_12mb`, the
export pads the player's WebAssembly with a custom section of 13,000,000 seeded pseudo-random bytes before it stores
it, so the bundle's player is over 12 MB however it is compressed.

## Readings where the issue leaves a choice

- **"The player"**: the receipt's player file and the scripts that run it, the ones the index page loads (its import
  map's modules and each script element's `src`) and any inline script but the bundle's JSON. Fonts, the document's
  assets, logic programs, reduced image levels and the fallback page's files aren't the player. The first draft
  counted every WebAssembly or JavaScript file the bundle holds but logic programs and levels, by first bytes and file
  extension; on a stored bundle that finds no WebAssembly, so this draft finds the player by the receipt.
- **"Compressed"**: the bytes the bundle stores, what a host that sends every file as stored sends (#2892: "a bundle
  weighs the same on any host", and "ship counts what is stored"): the player file's stored bytes and each of its
  scripts as stored, inline scripts as written. This is the arithmetic of #2892's re-draft comment ("the pinned
  compressor stores this player at 11,796,311 B, so the player and its two scripts come to 11,973,747 B"). The first
  draft read "compressed" as Brotli 11 of each file, what a host that compresses serves; this redraft holds the bundle
  to what it stores, so it fails at the merge base, where the player is stored as it is, and holds once #2892 stores it
  compressed (`BASE-FAILURE.txt`).
- **"12 MB"**: 12,000,000 B, as the first draft.

## Legs that read BLOCKED or INCONCLUSIVE

None. No leg is timed, and nothing needs a browser or another machine.

## Not tested, and why

The first draft's perf-lane task and the reference Mac's times (first frame under 3 s, 60 fps at 1080p) stay in
`../172/budgets.test.ts`, as #2892's criterion 3 asks only for the size half.
