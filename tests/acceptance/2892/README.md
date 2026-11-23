# Acceptance tests for #2892: a bundle weighs the same on any host, its files stored compressed, inflated in the page after their hash check, and ship counting what is stored

Written first, blind, from issue #2892 (live, November 21–22, 2026: its body, Scope, eight acceptance criteria with
criterion 2 as re-drafted on the owner's ruling of 2026-11-21, Proof and Depends on, its decision comment of 2026-11-19,
"gzip", and the re-draft's comment), the design and the base commit `5f5791e2d` ("Merge pull
request #3068"), by a job that never saw an implementation; none existed. No other worktree, branch, PR, stash or plan
was read, and every repo file was read at the base commit. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Criterion 3 is #172's blind redraft, in
`../172-redraft-ac4/`, with a README of its own.

**Redrafted once, on a dispute** (AC6's memory reading only): the first draft read where the page stood as its highest
sample before the page asked for the changed file. At the base the page asks for its files about 10 ms after
index.html arrives, while its renderer is still booting (about 50 MB of resident memory), and the samples come about
200 ms apart under load, so that sample often predated the boot and the boot counted as the file's rise, by sampling
luck. The server now holds the changed file's response 8 s and where the page stood is read over the hold's last 4 s
(The page's memory, below). The criterion's 64,000,000 B, the 1 GiB file and the planted `web_inflates_before_check`
are unchanged.

**Run only where cheap.** The surface plainly doesn't exist at the base: the export writes every file as it is, the
receipt gives no inflated bytes, deep-show has no `ship` call and none of the planted names below. `BASE-FAILURE.txt`
says, per test, the assertion it meets first at the base: `decision.test.ts` was run; the others are read from the
base's code. The type check passes (`tsc -p tests/acceptance/2892/tsconfig.json`, exit 0) and `vitest list` collects the
15 tests below. The two page-memory readings were tried once on a hand-made page in headless Chrome 157 (a scratch
probe, not committed): a 200 MiB buffer moved V8's `backingStorageSize` by 209,715,200 B and the renderer processes'
resident memory by about 220 MB.

## What was read

- The issue, live (`gh issue view 2892 --repo windoliver/deepbuild --comments`), its decision comment and criterion
  2's re-draft comment (the full set's sizes on `5f5791e2d`; the new ceilings), its dependency
  #1300 (Ship budgets, open and unbuilt), and #172 (its criterion 4 and the first draft of its suite).
- AGENTS.md; `docs/canvas-primitives.md`: Export: web player (`node scripts/design-section.mjs --issue 2892`);
  `docs/technical-design.md`: the `ship` paragraph (`ship.bytes`, `ship.playable`, `ship.update`) and Every task carries
  its own budgets.
- At the base, for surfaces only: `crates/deep-show/src/export/web.rs` (the bundle, its names, the receipt's `files`
  with `bytes`, the index page's import map and element script, the planted players), `crates/deep-show/src/export.rs`
  and `main.rs` (planted names; an unknown name or call answers `bad_input`), `crates/deep-show/src/net_web.rs` (the
  app serving a page to headless Chrome), `crates/deep-player/web/element.js` (`#fetch`, `#load`, `probe()`),
  `crates/deep-player/web/dist/sets.json`, `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`; the suites
  `172/` (helpers, README, budgets, hashes, reproducible), `172-redraft-ac2/` (the model of a redraft), `169/` and `501/`
  (helpers only), `1490/` (its reading of `player.hash`).

Code was read only to learn the surfaces. Every expected value comes from the issue and the design.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH (cargo also needs `/opt/homebrew/opt/rustup/bin`); in a fresh
worktree run `npm ci` and `npm run build --workspaces` once; then one file at a time:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci && npm run build --workspaces
for f in decision wire stops same first-frame; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/2892 $f.test.ts --testTimeout=3600000 --hookTimeout=180000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/2892/tsconfig.json   # type check
rm -rf tests/acceptance/2892/node_modules                                      # vitest's cache after a --root run
```

Each file but `decision.test.ts` builds `deep-show` (`full`) once in `beforeAll`, as #169's helpers build it;
`same.test.ts` also builds the merge base's `deep-show` from `git archive` of `git merge-base HEAD origin/main` in a
temp folder with its own target folder (no `.git`, every `GIT_*` variable left out of git's and cargo's environment).
Servers run as child processes and Chrome in a process group of its own, each stopped by its PID; temp folders are
removed after each test or file.

`scripts/lanes.mjs` needs these lines (this job writes only its folders; the implementer adds them):

```js
// #2892's files each build deep-show (full; same.test.ts also the merge base's, from git archive), serve the lab's
// bundle from test servers that log the bytes they send and drive headless Chrome with WebGPU on; decision.test.ts
// reads the issue through gh.
alone.push('tests/acceptance/2892/', 'tests/acceptance/172-redraft-ac4/');
timed.push('tests/acceptance/2892/first-frame.test.ts');
```

## Criteria to tests

IDs are `#2892.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the live issue). Each test's name starts `AC<n> #2892.<h8>`.

| AC | ID | File (tests) | What it asserts, and the wrong programs it fails on |
|---|---|---|---|
| 1 | `#2892.8cdf43e0` | `decision.test.ts` (1) | The issue's comments (live, `gh`) hold a decision in the form "**Decision (<date>): gzip" or "…: Brotli", its answer is `DECIDED`; with Brotli it gives the inflater's bytes and time; no commit since the merge base that touches code (outside `tests/acceptance/`, not Markdown) is dated before it. Fails on twins made in the test: no decision; a code commit a day before (names it); Brotli without the inflater's numbers |
| 2 | `#2892.bce8437b` | `wire.test.ts` (1) | The lab's bundle on a first visit from the `stored` server, `ready`: every response with no content encoding and the file's bytes as stored; the body bytes sent for the player (the receipt's player file and each import-map module, the page glue; each file counted once) are at most `PLAYER_ON_WIRE` (11,976,000 B for gzip). Fails on: the merge base (it sends the player as stored: 37,274,227 B of WebAssembly and 128,501 B of glue, the issue's 37,402,728 B) |
| 3 | `#2892.62d3dff4` | `../172-redraft-ac4/size.test.ts` (2) | #172's criterion 4, size half, redrafted blind: the player found by the receipt and counted as the bundle stores it, under 12 MB; the planted `web_player_over_12mb` fails it, naming the player file (that folder's README) |
| 4 | `#2892.667e03e0` | `wire.test.ts` (2) | The same bundle on two first visits, from the `stored` and the `compressing` server (which did compress), both `ready`: the sums of body bytes are under 2% apart. The planted `web_stores_player_as_is` fails, the failure naming both sums. Also fails on the merge base |
| 5 | `#2892.79918bc3` | `wire.test.ts` (2) | The bundle stores the player compressed; each file marked stored compressed inflates to the receipt's inflated bytes; the `ship` call's `bytes` equals, to the byte, the body bytes the `stored` server sent on a first visit; the ship checks' test server's record says every response went with no content encoding and the file's bytes as stored. The planted `ship_bytes_sums_inflated` fails, naming both sums. Fails on the merge base (no stored form, no `ship` call) |
| 6 | `#2892.f22eb452` | `stops.test.ts` (3) | The bundle stores the player compressed and, as written, is `ready`. One byte of the stored player changed: no `ready`, a notice names the file. The stored player replaced by a gzip stream that inflates to 1 GiB: the same, and the page's memory rises under 64,000,000 B above where it stood. The planted page `web_inflates_before_check` on its own bundle's 1 GiB copy fails, naming the memory. Fails on: the merge base; a page that skips the check |
| 7 | `#2892.95bb7e98` | `same.test.ts` (3) | The bundle stores the player compressed; seeked to each step 1 … 600, probe()'s step and step hashes equal those of the merge base's bundle (exported by the merge base's own `deep-show`), else the first step that differs is named. Two clean-home exports on this Mac are byte-identical, and the planted `web_gzip_header_time` differs, naming a file stored compressed. This Mac's export and a Linux aarch64 host's are byte-identical; BLOCKED with no host |
| 8 | `#2892.d7212061` | `first-frame.test.ts` (3) | On any machine: the bundle stores the player compressed, and probe()'s `load.inflate_ms` is above 0 and under `first_frame_ms`. The perf lane's task naming the criterion, valid against the merge base's budgets. On a reference Mac in a fit state, five runs after a warm-up: `first_frame_ms` within 3,000 ms by `judgeLimit`, each run's record giving `load.inflate_ms`; elsewhere INCONCLUSIVE. Fails on: the merge base; a record with no or zero inflating time |

Test count: 1 + 1 + 2 + 2 + 3 + 3 + 3 = 15 here, and 2 in `../172-redraft-ac4/`.

## The surface under test

`deep-show run` (#393's scenario, one JSON line in, one answer line out), built and driven by #169's and #172's
helpers; `export` with `video.codec: "web"` (#172's call, unchanged); the bundle folder it writes; a browser; and one
new call. Planted programs are reached by the scenario's `planted` key, never an environment variable. **Every name
marked *(chosen)* is this job's**, taken from the issue's words and shaped like the neighbouring surfaces; the
implementer builds exactly these, or a dispute goes to a blind redraft.

### The receipt

Each entry of the receipt's `files` keeps #172's `path` and `sha256` and the base's `bytes`, now the file's *stored*
bytes: `sha256` is the SHA-256 of the bytes on disk (the name's hash) and `bytes` their count. A file the bundle stores
compressed also carries `inflated: {bytes, sha256}` *(chosen)*: the bytes it inflates to and their SHA-256 (the one the
document, the index or the player names it by). A file stored as it is carries no `inflated` (its inflated bytes are
its stored bytes). So the receipt gives each file's stored and inflated bytes, and their sums.

The receipt's player is the file whose `sha256` or whose `inflated.sha256` is `player.hash`; the tests take either, so
that #1490's reading (`player.hash` is the set's WebAssembly SHA-256 in `sets.json`) and #172's (`player.hash` is one of
the files' stored SHA-256) don't both have to hold. Once the player is stored compressed they can't both hold; that is
for the implementer to raise against whichever first draft it breaks, not for this suite to settle.

The stored form is the decided one, gzip: a file stored compressed is a gzip stream (its first bytes `1f 8b 08`) that
inflates to its `inflated` bytes. Which files are stored compressed is the implementer's within the issue's Scope; the
tests require it of the player's WebAssembly only (the precondition `storedPlayerFailures`), and hold every file
marked `inflated` to its marks.

### The index page

#172's and the base's: `index.html` with one `<deep-player>`, an import map naming the page glue, and the element's
script by `src`. The tests read the page glue as the modules the import map names, and the element's script as each
script element's `src`.

### The `ship` call *(chosen)*

`{call: "ship", bundle: <the folder a web export wrote>, chrome: <path to Chrome>}` answers
`{outcome: "measured", bytes, served: {responses: [{path, status, bytes, content_encoding}]}}`:

- `bytes` is `ship.bytes` for the bundle (#1300's measure, in bytes), what the issue's Scope says it sums: stored bytes.
- `served` is the record of the ship checks' test server: it serves the bundle as a static host does (the index page
  with `no-cache`, every other file with a max-age of a year, the design's words) to a fresh headless Chrome profile
  until `ready`, sending every file as stored with no content encoding, and records each response it sent: its path,
  status, bytes of body and `content_encoding` (null for none). That is ship.playable's run without its link rate or its
  time, the smallest run in which "the test server of the `ship` checks … its record says so" can be read; #1300 adds
  the rest to the same server.

This is the one new call. No brief, verdict or link rate is read here: those are #1300's.

### The time spent inflating *(chosen)*

`probe()` gains `load: {inflate_ms}`: the time in ms the page spent inflating stored files during its load, a number.
The design keeps `load.retries` in "the run's record"; this suite reads that record through `probe()`, beside #172's
`first_frame_ms`.

### The test servers (this suite's own)

A `node:http` listener in a child process of its own (as #172's), serving a bundle folder at `http://127.0.0.1:<port>/`
as a static host does: `index.html` with `no-cache`, every other file with `max-age=31536000`, WebAssembly by its magic
bytes as `application/wasm`, no COOP or COEP. It logs one JSON line per response: when the request arrived, status,
path, the bytes of body sent, the content encoding sent, the SHA-256 of the file as stored and when the response was
sent. For AC6's memory runs it holds its response to the page's first request for the changed file 8 s (`HOLD_MS`),
then sends it as any other. Two modes:

- `stored`: every file as stored, with no content encoding.
- `compressing`: every body compressed as it is sent, Brotli at quality 5 to a request that accepts `br` (the issue's
  "Brotli 5" column for a host that compresses as it sends), else gzip at level 6 to one that accepts `gzip`, with
  `content-encoding` and `vary: accept-encoding`. Over plain HTTP Chrome may not offer `br`; the log says which was used.

### A first visit

A fresh Chrome profile (#172's `Chrome`, headless, WebGPU on), its HTTP cache turned back on (#172's tab turns it off;
a first visit has an empty cache, not a disabled one), opened on the server's blank page, then sent to `index.html`.
It waits for `ready` and 2 s more for later loads; or, once a notice shows without `ready`, 5 s more; at most 180 s.
The server's log is the visit.

### The page's memory

Sampled every 100 ms from the blank page on: V8's count for the page (`Runtime.getHeapUsage`: `usedSize`,
`embedderHeapUsedSize` and `backingStorageSize`, the backing stores of its ArrayBuffers and WebAssembly memories) and
the resident memory of each Chrome renderer process (the processes of Chrome's process group named Renderer, by `ps`).
The page asks for its files while it is still booting (its WebGPU gate, then each file in the manifest's order, the
first about 10 ms after index.html arrives), and its boot alone moves its renderer by tens of MB, so where it stood is
never read before the page has booted: the server holds its response to the page's first request for the changed file
8 s, and for each reading where the page stood is its highest sample in the hold's last 4 s, the page booted and
waiting on that file. Its rise is its highest sample from the response on less that; the page's rise is the largest
of V8's and each renderer's that was sampled both in that window and after (a spare renderer Chrome starts later
isn't the page's). A page that inflates nothing it hasn't checked moves only by the file's stored bytes (a few MB)
and what checking them takes; one that inflates first moves by the 1 GiB it inflates.

## Planted programs

Chosen by the scenario's `planted` key on `deep-show run`; at the base each name answers `bad_input`.

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `web_stores_player_as_is` *(chosen)* | the export stores the player's WebAssembly as it is, every other file as the change stores it | 4 | both sums |
| `ship_bytes_sums_inflated` *(chosen)* | the `ship` call's `bytes` sums each file's inflated bytes, not its stored bytes | 5 | both sums |
| `web_inflates_before_check` *(chosen)* | the page inflates each stored file whole as it arrives, then checks it (against the SHA-256 it inflates to), with no stop at the index's inflated size | 6 | the memory |
| `web_gzip_header_time` *(chosen)* | the export writes the export's time into each stored file's gzip header | 7 | a file stored compressed |
| `web_player_over_12mb` *(chosen)* | the export pads the player's WebAssembly with a custom section of 13,000,000 seeded pseudo-random bytes before storing it | 3 (`../172-redraft-ac4/`) | the player file |

Made in test code: one byte of the stored player changed, and the stored player replaced by a gzip stream that
inflates to 1 GiB (a 4 KiB block of bytes from a generator seeded 2892, repeated, compressed by Node's zlib at level 9,
a few MB, estimated), each in a copy of a real bundle; criterion 1's wrong records.

## Readings where the issue and design leave a choice

- **The decision** (AC1, and every test): gzip, from the comment of 2026-11-19. `DECIDED` in `helpers.ts` holds it;
  the Brotli ceiling stays a named constant, used only if the decision changes. Criterion 1 is read from the issue's
  record (it is met by that comment), not left out, since a test can read it cheaply.
- **"Player on the wire"** (AC2): the body bytes the server sent for the receipt's player file and the page glue (the
  modules the import map names), each file counted once (its first response), as the issue's sums count them: the
  merge base's 37,402,728 B is its WebAssembly and its glue as stored, once each, though at this base the page fetches
  the glue twice (as bytes, and again through the import map). A second fetch is counted by AC5's whole-visit sum.
  With Brotli the other scripts the page loads count too, where the inflater would be.
- **The ceilings** are the live issue's numbers (criterion 2 as re-drafted on 2026-11-21: 11,976,000 B with gzip,
  8,121,000 B with Brotli), each in one constant with its text (`PLAYER_ON_WIRE_GZIP`, `PLAYER_ON_WIRE_BROTLI`,
  `COMPRESSING_APART`, `BOMB_INFLATED`, `MEMORY_RISE`, `FIRST_FRAME_MS`), so a re-drafted number changes one line. The
  merge base's 37,402,728 B is the base's reading (`BASE-FAILURE.txt`), not asserted at the tested commit.
- **"Differs by under 2% in bytes on the wire"** (AC4): the two first visits' sums of body bytes over every response,
  their difference under 2% of the `stored` visit's sum.
- **"That server"** (AC5): criterion 2's server, the one that sends every file as stored (this suite's `stored` server,
  independent of the app); the ship checks' own server is held to its record separately. "The bytes of body … sent on a
  first visit": every response's body bytes from the index page until `ready` and 2 s after.
- **"A stored file"** (AC6): the player's WebAssembly as stored. It is stored compressed and is the lab's one large
  file, so a page that checks before it inflates handles nothing else large while it loads; "where it stood" is the
  page's memory once it has booted and waits on that file, read while the server holds the file's response (above).
  **"64 MB"**: 64,000,000 B, as the issue's other MB.
- **"Stops the player before `ready`, naming the file"**: a notice shows, `ready` stays false 5 s more, and a notice
  holds the file's path, its stored SHA-256 or the SHA-256 it inflates to.
- **"The merge base's"** (AC7): the step hashes the merge base's own bundle gives through its own player, its
  `deep-show` built from its tree; compared seek by seek over steps 1 … 600 (the world's and the logic item's).
- **"Two machines"** (AC7): this Mac and the Linux aarch64 host of #172's criterion 6. The Mac pair in clean homes is a
  first leg any Mac can run.
- **"In a budget window on a reference Mac"** (AC8): as #172's budgets: the window is the perf lane's task; here the
  limit is judged on five runs by `judgeLimit`. **"The record"**: `probe().load.inflate_ms` (above).

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- Every browser test is BLOCKED without Google Chrome (at `/Applications/Google Chrome.app` or `CHROME_BIN`), when it
  opens no DevTools port within 60 s, or when a page that must be ready isn't and Chrome offers no WebGPU adapter.
- AC6's memory legs are BLOCKED where neither reading can be taken (no `backingStorageSize` and no renderer by `ps`).
- AC1 is BLOCKED when `gh` can't read the issue.
- AC7's Mac pair is BLOCKED off macOS arm64; its two-machine test is BLOCKED without `DEEP_LINUX_AARCH64` and
  `DEEP_LINUX_AARCH64_DIR` (one ask: set them to the host's ssh destination and a checkout of the tested commit with
  cargo), when ssh can't reach it without a prompt, or when the checkout there is at another commit.
- AC8's timed test is INCONCLUSIVE off a reference Mac (by `scripts/benchmark.mjs` `fingerprint`), off mains power,
  with Low Power Mode on, the thermal state not nominal, or whenever `judgeLimit` reads five runs as neither all within
  nor all over, or a run's load was above the cores.

## Not tested, and why

- The Brotli clauses (the 8,121,000 B ceiling with the inflater, the inflater's 300 ms): the decision is gzip.
- Which other files are stored compressed and which the receipt says compress themselves, the index's inflated sizes,
  the export's read-back that inflates each stored file, and "a pinned compressor at fixed settings": the Scope's, not a
  criterion's; criteria 5 to 7 reach them through the receipt's marks, the stops and the byte-identical bundles.
- The single-page wrapper's embedded form (#1218), the fallback page's files, the order the page loads files in and
  making the player's code smaller: out of the issue's scope.
- `ship.playable`, `ship.update`, briefs and verdicts: #1300's.
