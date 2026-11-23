# Blind redraft for #210, criterion 6: no port in the web bundle, after #2892

A fresh draft of the first test in `../210/ac6-web-export.test.ts`, written blind as the design's Dogfooding rule
says: from issue #2892 (live, November 21, 2026, with its decision comment: gzip), issue #210 (live), the design and
the base commit `5f5791e2d` ("Merge pull request #3068") with the first draft of #210's suite in
`tests/acceptance/210/`. No implementation of #2892 existed; no other branch, worktree, PR, stash or session was
read. The implementing agent doesn't edit these files (AGENTS.md, Proof).

Only one assertion is redrafted: that no bundle file holds the port's plug-in ID. Everything else that test asserts
is kept, through the first draft's helpers. The file's second test, the planted `web_export_keeps_port` failing the
read-back naming `synth`, reads no bundle byte and holds under #2892 as written.

## Why

#2892 stores the bundle's document, and every other file with no compression of its own, gzip, and the page inflates
it after checking its stored bytes. The first draft searches each file's stored bytes for `test.gear`, so a bundle
that kept the port in its gzip-stored document would pass it: the ID reads as other bytes there.

## What was read

- The issues, live: #2892 (`gh issue view 2892 --repo windoliver/deepbuild --comments`) and #210 (criterion 6; its
  Scope's "The web player's export (#172) drops each port, naming it in the receipt's refused").
- AGENTS.md; `docs/canvas-primitives.md`: Export: web player (printed by `node scripts/design-section.mjs --issue
  2892`; the script serves open issues only) and Port ("The web player's bundle carries no port").
- The first draft: `../210/ac6-web-export.test.ts`, `../210/helpers.ts`; `../172/helpers.ts`. #210's suite has no
  README; `../172-redraft-ac2/README.md` is this README's model.
- At the base, for surfaces only: `crates/deep-show/src/export/web.rs` (ports removed from the bundle's document and
  named in the receipt's `refused`; the read-back of a kept port; file names), `crates/deep-show/src/main.rs`
  (`web_export_keeps_port`).

## What changed, and what didn't

The search reads each file as the page reads it, through `../172-redraft-2892/helpers.ts` (a file whose stored bytes
start `1f 8b` is inflated with Node's zlib; any other is read as stored; no receipt or index field for the stored form
is read) and looks for `test.gear` in both the stored and the inflated bytes, naming the file. New in the test, made
in test code from the real bundle, the leak twin: `test.gear` planted in the middle of the smallest file stored gzip
(at the base, which has none, the smallest file but the index page), that file then stored gzip under its name; the
search must fail on it, naming the file.

Unchanged, from the first draft: the drum pad with its port `synth` to `test.gear` and its track of three notes;
`exported`; one `{item: "synth", why}` in the receipt's `refused`; #172's `bundleFailures`; ready in headless Chrome
on WebGPU and played to its end.

## Run it

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci && npm run build --workspaces            # once, in a fresh worktree
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/210-redraft-2892 ac6-web-export.test.ts --testTimeout=7200000
node node_modules/typescript/bin/tsc -p tests/acceptance/210-redraft-2892/tsconfig.json   # type check
rm -rf tests/acceptance/210-redraft-2892/node_modules                                       # vitest's cache after a --root run
```

The file builds `deep-show` (`full`) once through #533's `prebuild`, as the first draft does, serves the bundle from
a child process and plays it in headless Chrome with WebGPU on, each stopped by its PID. Temp folders are removed
after the test.

`scripts/lanes.mjs` needs these lines (the implementer adds them):

```js
// #210's first-draft web export test searches the bundle's stored bytes for the port's plug-in, so under #2892, which
// stores the document gzip, it can't see a kept port; its blind redraft reads each file as the page does and runs in
// its place. The first draft's file, with its planted read-back test, runs by hand.
alone.push('tests/acceptance/210-redraft-2892/');
byHand.push('tests/acceptance/210/ac6-web-export.test.ts');
```

## Criterion to test

The ID is `#210.` and the first 8 hex digits of the SHA-256 of the criterion's text, checked against the live issue:
the first draft's `AC[6]`, named as it names it (`AC6 #210.e496d38b`).

| AC | ID | File (tests) | What it asserts, and the wrong programs it fails on |
|---|---|---|---|
| 6 | `#210.e496d38b` | `ac6-web-export.test.ts` (1): `AC6 #210.e496d38b the export lists synth in refused, writes no port into the bundle, stored or inflated, and the bundle plays to its end in the browser` | The drum pad exports; its receipt's `refused` holds one `{item: "synth", why}` with a non-empty `why`; the bundle matches its receipt; no file holds `test.gear` in its stored bytes or, stored gzip, its inflated bytes (names the file); the leak twin fails that search, naming the planted file; the bundle is ready in headless Chrome and plays to its end. Fails on: an export that names no port in `refused`; one that writes the port or its plug-in's ID into any file, stored as it is or gzip, and still answers `exported` (the twin); a search of stored bytes alone (#2892's wrong reading: the twin); a bundle that doesn't play without the port |

Test count: 1. At the base it is read to pass (`BASE-FAILURE.txt`).

## Planted programs

None new. The leak twin is made in test code from the real bundle. The first draft's `web_export_keeps_port` stays
with its own test, which this file doesn't redraft.

## Readings where the issue and design leave a choice

- **"Plays without it"** and **"lists its port in refused"**: the first draft's, kept.
- **No port in the bundle**, under #2892: the plug-in's ID in no file's stored bytes and in no bytes the page inflates
  from one; a stored file is gzip when its stored bytes start `1f 8b`.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass. The browser leg is BLOCKED without Google Chrome at its path (or `CHROME_BIN`), when
Chrome opens no DevTools port within 60 s, or when headless Chrome offers no WebGPU adapter (#172's harness). The file
fails, naming the build, while `deep-show` doesn't build.

## Not tested, and why

The first draft's second test (it stands); the stored form itself (#2892's own suite).
