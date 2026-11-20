# Acceptance tests for #2856: the web player says why it stopped, and a page whose script the browser refused isn't blank

Written first, blind, from issue #2856 (live, November 19, 2026: its Scope, its five acceptance criteria and its Proof
line), the design and the base commit `a0d3713a7` ("Merge pull request #2847"), by a job that never saw an
implementation; none existed. No other worktree, branch, PR, stash or plan was read, and every repo file was read at the
base commit. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of
this job (design: Dogfooding).

Every test file was run once at the base; `BASE-FAILURE.txt` holds each test's result there, with the load and the
time. Before that, a throwaway test (not committed) ran the checks in `helpers.ts` on bundles patched by hand from a
base export: a stand-in right program (the line in the index page, removed by the element; a throw from `#draw`
caught into a `stopped` notice and `probe().stopped`), a player that catches the throw and plays on, and an element
that leaves the line; and on the base bundle itself. What it showed is in `BASE-FAILURE.txt` too.

## What was read

- The issue, live (`gh issue view 2856 --repo windoliver/deepbuild`, the body only), identical to the copy the job was
  given; the bodies of #172 (its dependency), #1040 (the fallback page), #1044 and #2369 (named out of scope) and the
  epic #310.
- `docs/technical-design.md`: Films and figures on the canvas, How it installs, How we know version 0 works (Criteria to
  tests, Wrong programs, Dogfooding, Tests written first); `docs/canvas-primitives.md`: Export: playable page, Export:
  web player (and its two subsections), Seam and backend, Seam and backend: device classes, Tour; AGENTS.md.
- At the base, for surfaces only: `crates/deep-player/web/element.js`; `crates/deep-show/src/export/web.rs`
  (`index_html`, `element`, `export_web`, `web_fallback`), `crates/deep-show/src/export.rs` (`Guard` and the planted
  names); the page glue `crates/deep-player/web/dist/full/player.js` (`__wbg_load`, `Player.frame`, `Player.draw`);
  `scripts/proof-change.mjs` (`criterionId`), `scripts/lanes.mjs`, `scripts/lease`; the suites `172/` (the model for
  this one), `1040/`, `169/`, `533/`, and the merge-base builds of `120/`, `1417/` and `182/`.

Code was read only to learn the surfaces. Every expected value comes from the issue.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH; in a fresh worktree run `npm ci` and `npm run build
--workspaces` once; then one file at a time:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces
for f in stopped refused untouched unchanged taste; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
    node node_modules/vitest/vitest.mjs run --root tests/acceptance/2856 $f.test.ts --testTimeout=3600000 --hookTimeout=180000 --silent=false
done
node node_modules/typescript/bin/tsc -p tests/acceptance/2856/tsconfig.json   # type check
rm -rf tests/acceptance/2856/node_modules                                       # vitest's cache after a --root run
```

Every `it` passes its own timeout (3,600,000 ms; `unchanged.test.ts` three times that, since it exports the lab twice
and may build the merge base);
the hook timeout covers closing browsers after a file; `--silent=false` prints each check's readings (what the page
showed, the policies compared), which this vitest otherwise hides for a test that passes. Each file builds
`deep-show` (`full`) once in `beforeAll`, as #172's helpers build it, and `deep-logic` once (#533's layout probe, which
gives the lab's program its offsets). `unchanged.test.ts` also builds the merge base's `deep-show` when this checkout's
code differs from it (The merge base, below). One export of the lab took 10 to 47 minutes at the loads this job saw
(one-minute load 50 to 265 on 18 cores), most of each file's time (`BASE-FAILURE.txt`). Temp folders are removed after each test; each server runs as a child
process and Chrome in a process group of its own, each stopped by its PID; nothing is stopped by name or port.

## Criteria to tests

IDs are `#2856.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the live issue). Each test's name starts `AC<n> #2856.<h8>`.

| AC | ID | File (tests) | What it asserts, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#2856.4a55999e` | `stopped.test.ts` (2) | The lab with its 600-step track, played from 0 under the shim, whose frame call throws at step 300. At the next display frame `paused` is true and the page shows exactly one `stopped` notice, shown, naming 300 and the shim's message; in the ≥ 5 s after the throw the page asks for no animation callback and `ended` doesn't fire; `probe()` then answers with `stopped.step` 300. Fails on: the base (`paused` false, no notice, no `stopped`); the planted `web_plays_on_failure`, a failure naming step 300 |
| 2 | `#2856.7e832739` | `refused.test.ts` (1) | The lab's element script served as `text/plain`, then with its last byte changed: in each, the browser refuses it, and `<deep-player>` shows one line of text with a shown link to the receipt's fallback page; the link, clicked at its centre, opens that page, which the server sent with the receipt's SHA-256. Fails on: the base (both pages show nothing inside `<deep-player>`) |
| 3 | `#2856.168ff773` | `untouched.test.ts` (2) | Served untouched, the line the index page carries inside `<deep-player>` (read by the browser's parser from the served page) is not in the page's text at the first view (right after the core's first drawn frame) or at `ready`. Fails on: the base (the index page carries no line, so there is none to look for); the planted `web_element_leaves_line`, a failure naming the line's text |
| 4 | `#2856.f84ce6b9` | `unchanged.test.ts` (1) | The index page's content-security policies are the merge base's byte for byte (and a copy one byte off is told apart, naming the policy); the lab played live to `ended` and seeked to every step 0 … 600 gives the merge base's bundle's step and step hashes at each step and its checkpoint hashes at the end. No wrong program is named: the base meets it (its merge base is itself); a change to the policy or to any step hash fails it, naming the policy or the step |
| 5 | `#2856.a9fe9384` | `taste.test.ts` (1) | reads the record only (The taste call) |

Test count: 2 + 1 + 2 + 1 + 1 = 7.

## The surface under test

`deep-show run` (#393's scenario: one JSON line in, one answer line out), built and driven by #172's and #169's
helpers, with the scenario's `planted` key for the wrong programs (never an environment variable); its `export` with
`video.codec: web` (#172's), the bundle folder it writes and its receipt; a test server and a browser. No new binary,
call or option. **Every name marked *(chosen)* is this job's**, taken from the issue's words and shaped like the
neighbouring surfaces; the implementer builds exactly these, or a dispute goes to a blind redraft.

- **The bundle** (#172's, #1040's): `index.html` holds one `<deep-player>`, the manifest and one module script with a
  `src` and an `integrity`, the element's script; the receipt marks the fallback page's index page `fallback: "index"`.
- **The line** (the issue's): static text inside `<deep-player>` in `index.html`, in the bundle as exported. The tests
  read it from the served page and never fix its words: one line of rendered text (`innerText`) that holds an `<a
  href>` whose URL is the bundle's fallback page (the receipt's `fallback: "index"` file, as the index page names it).
- **The `stopped` notice** (the issue's kind, #172's notice form): an element marked `data-deep-notice="stopped"`
  whose text names the step the player held as a number and the failure's first line.
- **`probe().stopped`** *(shape chosen)*: `{step, message}`, the step the player held and the failure's first line;
  null or absent while it hasn't stopped. The tests read `step` only.
- **The planted programs** *(names chosen)*, below; at the base each name answers `bad_input`.
- **The pictures** *(names chosen)*: `docs/evidence/2856/player-stopped.png` and
  `docs/evidence/2856/player-script-refused.png` (The taste call).

### The test server

The issue's: a `node:http` listener in a child process of its own (as #172's, since `deep-show run` under `spawnSync`
blocks the test's event loop), serving the bundle folder as written at `http://127.0.0.1:<port>/` with #172's content
types and cache headers and no cross-origin isolation headers. Given one file's path, it serves that file under
another content type and/or with one byte changed (`Odd` in `helpers.ts`). It logs each response's status, path,
content type and the SHA-256 of the body it sent.

### The shim

Test code installed before the page's own scripts (`Page.addScriptToEvaluateOnNewDocument`, as #172's shim adapter),
read back as `window.__deep2856`:

- it wraps `window.requestAnimationFrame` and counts every animation callback the page asks for, with its time, and
  counts `ended` events (a capture listener on the window);
- it keeps the page's text at the player's first view (right after the core's `draw` first reports a frame drawn) and
  at `ready` (a capture listener on the window for the element's `ready`);
- it reaches the core where the page glue instantiates the player's WebAssembly (`WebAssembly.instantiate` with the
  player's bytes, which `glue.default({module_or_path})` calls) and wraps the instance's exports `player_frame` and
  `player_draw`, which `Player.frame` and `Player.draw` call; logic programs and everything else pass untouched;
- for criterion 1, once the test arms it as the play starts, the first frame call asked for a time at or past step 300
  (5 s) steps the core to exactly step 300 and then throws `WebAssembly.RuntimeError("deep test shim: the frame call
  failed on purpose")`, as a trap in the core would. The message holds no digit, so a notice names 300 only by naming
  the step. In that callback it asks for an animation callback of its own (uncounted) and reads `paused` and the
  notices there: the next display frame.

### The browser

#172's: Google Chrome at `/Applications/Google Chrome.app` (or `CHROME_BIN`), `--headless=new` with WebGPU on, a fresh
profile, driven over its DevTools protocol by #172's `Chrome` and `Tab` (no browser-automation library). This suite
adds four protocol calls over their connection: the shim before the page's scripts, the navigation, a pointer's click
(`Input.dispatchMouseEvent`) and the list of open pages. Pages are 1280 × 720 at device scale 1.

### The merge base

`git merge-base HEAD origin/main` (else `main`), with git run without any `GIT_*` variable. Its `deep-show` is this
checkout's own build when everything `deep-show` is built from (the tree outside `tests/` and `docs/`, plus the one
docs file a crate embeds, `docs/evidence/1903`) is the merge base's with nothing untracked there, as at the base itself;
otherwise the merge base is taken whole with `git archive` into the git-ignored `target/acceptance-2856-base/<sha12>`
(no `.git`, no worktree, nothing in the checkout moves) and built there into its own target folder, as #1417's suite
builds its merge base.

## Planted programs

Chosen by the scenario's `planted` key on `deep-show run`; at the base each name answers `bad_input`.

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `web_plays_on_failure` *(chosen)* | the element's script catches a throw from the core's frame or draw while a piece plays, and plays on: it asks for the next frame and doesn't stop | 1 | the step, `step 300` |
| `web_element_leaves_line` *(chosen)* | the element's script never removes the index page's line | 3 | the line's text, as the index page carries it |

As #172's are, each is a `Guard` the export applies to the element's script it writes. Criterion 2's wrong program is
the merge base; criterion 4 names none (its check is shown not to be blind on a copy of the policy one byte off).

## Readings where the issue leaves a choice

- **"A test shim makes the core's frame call throw at step 300"**: the shim above. It steps the core to step 300
  before it throws, so the step the player holds, what `probe().step` reads, is 300 however far the clock jumped in
  that frame. The throw is a `WebAssembly.RuntimeError`, as a trap's is.
- **"By the next display frame"**: read in an animation callback the shim asks for inside the callback that threw, so
  it runs in the next display frame; `paused` and the notices are both read there.
- **"The page shows one `stopped` notice naming step 300 and the shim's message"**: exactly one element marked
  `data-deep-notice="stopped"`, shown (visible by `checkVisibility` with visibility and opacity, with a box of some
  size; not necessarily inside the viewport), its text holding 300 as a whole number and the shim's whole message,
  which is one line, so also the failure's first line.
- **"In the 5 s after, the page asks for 0 animation callbacks"**: counted from the throw until 5 s after the next
  display frame; "`ended` hasn't fired" is read at the end of that span.
- **"`probe()` answers with `stopped` naming step 300"**: `probe()` resolves, and its `stopped` is an object whose
  `step` is 300.
- **"The element's script"**: the index page's one `<script type="module" src>`.
- **"Changes one byte of it"**: its last byte; a final newline becomes a space, so the script is still the same
  JavaScript and only its integrity hash refuses it (otherwise that byte's lowest bit flips).
- **"The page shows the line and its link"**: `<deep-player>` holds text, some of it shown, one line of rendered text,
  and a shown `<a href>` to the bundle's fallback page. The browser's refusal is checked first (`<deep-player>` stays
  undefined, and the server sent the script so), or the test fails without judging.
- **"The link opens the bundle's fallback page"**: a pointer's left click at the link's centre, where nothing covers
  it, brings the tab (or a page the click opens) to `/<the fallback page's path>` within 30 s, and the server sent that
  file with the receipt's SHA-256.
- **"The page's text"**: the text of the body's text nodes outside script, style, template and noscript, shown or not,
  so a line kept in the page but hidden still counts: the Scope says the element removes it.
- **"Such line"**: the text inside `<deep-player>` as the browser's own parser reads the served index page, collapsed.
  A page that carries none (the base) leaves nothing to look for, and the test fails there.
- **"At the first view"**: right after the core's draw first reports a frame drawn: the first view the player draws,
  as the design's web player and #1044 use the words, not the browser's first paint, which can come before any
  module script has run.
- **"At `ready`"**: in a capture listener for the element's `ready` event.
- **"Byte for byte the merge base's"**: every `<meta http-equiv="Content-Security-Policy">` tag's `content` as
  written, in number and order, against the merge base's export of the same lab.
- **"#172's live-play fixtures give the step hashes they gave there"**: the lab with its 600-step track, exported by
  this checkout and by the merge base, each played live to `ended` and then seeked to every step 0 … 600 in turn, in
  the same browser on the same machine; `probe()`'s step and step hashes after each seek, and its step, step hashes and
  checkpoint hashes at the end of the play, are the merge base's. The merge base's reading must hold step 600 with the
  world's and the logic item's step hashes, or the comparison isn't made.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- Every browser test is BLOCKED without Google Chrome at the path above, when Chrome opens no DevTools port within
  60 s, or when the page's player isn't ready and Chrome offers no WebGPU adapter there (#172's `mustBeReady`).
- `unchanged.test.ts` is BLOCKED when the checkout has no merge base with `origin/main` or `main`.
- `taste.test.ts` is INCONCLUSIVE without the pictures in `docs/evidence/2856/` or without a recorded call on exactly
  them.

## The taste call

The check run takes, from the pages in a browser, `player-stopped.png` (the lab stopped by the shim's throw at step
300: the `stopped` notice over the held frame) and `player-script-refused.png` (the lab's page with its element script
served as `text/plain`: the line and its link), puts them in `docs/evidence/2856/` *(names chosen)*, attaches them to
the PR and shows them in the session. The call is recorded in `tests/acceptance/2856/TASTE.json`: `{issue: 2856,
criterion: "#2856.a9fe9384", verdict: "looks_right" | "looks_wrong", who, when (ISO 8601), screenshots: {<name>:
sha256}, note?}`. This job writes no TASTE.json and makes no picture; no other criterion reads a picture.

## What the implementer adds outside this folder

- `scripts/lanes.mjs` (this job writes only its folder):

  ```js
  // #2856's files each build deep-show (full) and drive headless Chrome with WebGPU on; unchanged.test.ts also builds
  // the merge base's deep-show when this checkout's code differs from it.
  alone.push('tests/acceptance/2856/');
  ```

- The two planted programs (`crates/deep-show/src/export.rs` `Guard` and its planted names, applied in
  `crates/deep-show/src/export/web.rs`'s `element`), the pictures and, after the call, `TASTE.json`.

## Not tested, and why

No criterion asks: a throw from the core's `draw` (the criterion's shim throws from `frame`; the Scope names both),
recovery from a lost GPU device (#1044), asking for a file again (#2369), a failure inside a host page's own call such
as setting `currentTime` (the Scope says it still throws to the caller), the canvas keeping its last frame (the taste
call's picture shows it; no criterion reads pixels), and the words of the line.

## The issue's Proof line

With `--silent=false` each check prints what the Proof line asks for: `stopped.test.ts` the page's state after the
shim's throw (the time the frame call asked for, `paused` and the notices at the next display frame, the animation
callbacks asked for after, `ended`, `probe()`), on the merge base (`BASE-FAILURE.txt`) and on the change, and the
planted player's failures; `refused.test.ts` each refused-script page's text and links and where the clicked link led;
`untouched.test.ts` the index page's line and the page's text at the first view and at `ready`, and the planted
element's failures; `unchanged.test.ts` the two pages' policies.

## Files

- `helpers.ts`: the IDs and planted names, the test server, pages with the shim, the index page's readers, the merge
  base, and each criterion's check (shared by its test and its planted twin).
- `stopped.test.ts` (AC1), `refused.test.ts` (AC2), `untouched.test.ts` (AC3), `unchanged.test.ts` (AC4),
  `taste.test.ts` (AC5).
- `BASE-FAILURE.txt`: each test's run at the base.
- `tsconfig.json`: the type check.
