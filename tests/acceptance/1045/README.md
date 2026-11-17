# Acceptance tests for #1045: the web player keeps the document's accessibility tree as DOM beside its canvas

Written first, blind, from issue #1045 (live, November 17, 2026: its Scope, its Runs-on line and its two acceptance
criteria), the design sections it names and those they lean on, and the base commit `7d5000134` ("Merge pull request
#2739"), by a job that never saw an implementation; none existed. No other worktree, branch, pull request, stash or plan
was read, and every repo file was read at the base commit. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The issue's oracle page says no upstream
test checks either criterion, so these tests are their local proof. The harness was tried once, before the base run, on
stand-in players made from the base's own bundle with only the element's script changed in a copy (none is kept): a
right one passed AC1's judgement, and the base's player and an every-frame stand-in failed it naming the nodes
(`BASE-FAILURE.txt`).

## What was read

- The issue's body (`gh issue view 1045`, equal to the brief's saved copy), and the bodies of #172 (the web player core),
  #376 (accessible documents) and the epic #310.
- `docs/technical-design.md`: Films and figures on the canvas (Export: the web player); How it installs (each seam's
  suite: "the same accessibility tree as data plus a screen-reader smoke test"; the web as a platform); Rules every
  primitive follows (Accessible: "the accessibility tree and its announcements are compared as data in a replica; a
  screen-reader run is a smoke test, never the check"); How we know version 0 works (Criteria to tests, Wrong programs:
  a planted program "is never chosen by an environment variable", Dogfooding, Tests written first).
- `docs/canvas-primitives.md`: Export: web player (with its compressed sound and ladder sections), Export: playable page
  ("each node of a state's accessibility tree is one element marked `data-deep-id`, in the tree's order"), Seam and
  backend, Tour, Net: relay and Join, Logic: saves, Check input: logic kinds, Control (`label`; `role`, an ARIA role;
  `announce`; "Readouts are announced when they change, after a quiet interval"), Control: picks on rows and grid focus,
  Item and kind (`name`, `role`), Text `text@1` (`template`), Overlay, and the path grammar with Channel and key ("A
  channel may key `data/<name>`").
- AGENTS.md.
- At the base, for surfaces only: `crates/deep-show/src/access.rs` (`see`: the tree, and a readout announced only in a
  frame where its text differs; #504's played revision), `played.rs`, `input.rs` (`presented`: a frame whenever the
  motion program's `valid_until` passes), `export.rs` and `export/web.rs` (the web bundle; its planted players chosen by
  the scenario's `planted`), `hub.rs` (`Planted`), `main.rs` (an unknown `planted` answers `bad_input`);
  `crates/deep-player/web/element.js` and `crates/deep-player/src/{page,play}.rs` (the element's members, `probe()`,
  the clock's span from `transport.span`); `crates/deep-canvas-motion` (a channel on `data/<name>`; `valid_until`);
  `scripts/proof-change.mjs` (`criterionId`), `scripts/benchmark.mjs` (the reference Macs), `scripts/lanes.mjs`; the
  suites `172/`, `169/` and `376/`, whose helpers this suite imports unchanged, `1162/` (a readout a channel keys), and
  `327/`, `990/`, `1459/` and `172/taste.test.ts` (checks that need a person).

Code was read only to learn the surfaces. Every expected value comes from the issue, the design and #376's fixture.

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH; in a fresh worktree run `npm ci` and `npm run build
--workspaces` once; then:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci && npm run build --workspaces
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease \
  node node_modules/vitest/vitest.mjs run --root tests/acceptance/1045 --no-file-parallelism \
  --testTimeout=3600000 --hookTimeout=180000
node node_modules/typescript/bin/tsc -p tests/acceptance/1045/tsconfig.json   # type check
rm -rf tests/acceptance/1045/node_modules                                       # vitest's cache after a --root run
```

Each file builds `deep-show` (`cargo build --locked --bin deep-show --no-default-features --features full`) once in
`beforeAll` with #169's `useShow`. Temp folders are removed after each test or file. The server and Chrome are #172's:
each a child process (Chrome in a process group of its own) stopped by its PID; nothing is stopped by name or port.
Browser cleanup in `afterAll` outlasts vitest's 10 s hook default, hence `--hookTimeout`. `voiceover.test.ts` leaves
the bundle for the person's run in `target/acceptance/1045/voiceover/` (ignored build output).

Timing at the base, at a one-minute load near 300 on 18 cores: `tree.test.ts` 22 min, nearly all a cold `deep-show`
build (its tests 32 s); `voiceover.test.ts` 8 s with the build cached. The stand-in check above played three players
in 62 s.

## Criteria to tests

IDs are `#1045.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the live issue). Each test's name starts `AC<n> #1045.<h8>`.

| AC | ID | File (tests) | What it asserts, and the wrong programs it fails on |
|---|---|---|---|
| 1 | `#1045.ccb3fe36` | `tree.test.ts` (3) | The figure (Fixture) on the app's panel on the virtual clock: #376's `see` at 3.5 s gives the app's tree and its one announcement, readout `count` at 2 s. The figure's web bundle, ready in headless Chrome with WebGPU: over seeks to 1 s and 1.5 s (readout unchanged), 2.5 s (changed) and 3 s (unchanged) its polite live region updates exactly once, from the changing seek on, holding the app's announcement; at 3 s its accessibility tree equals the app's node for node (id, role, name, in order) and the document's node carries the document's description; real Tab presses give focus to every control in the app's order. Fails on: the base (no tree, no live region, no control to focus); the planted `web_no_tree`, naming each part and control (`beam`, `lens`, `screen`, `c-rays`, `c-labels`); the planted `web_announces_every_frame`, naming the readout `count` |
| 2 | `#1045.acc208bf` | `voiceover.test.ts` (1) | Exports the same figure's bundle and reads the person's recorded VoiceOver run on Safari (`VOICEOVER.json`): none, or one on another bundle or off the reference Macs, is BLOCKED with one unblock ask; a recorded `fail` fails; a `pass` on exactly this bundle passes when what the person heard names every part and control and holds the changed readout's announcement. Never turns VoiceOver on or drives Safari |

Test count: 3 + 1 = 4.

## The surface under test

`deep-show run` (#393's scenario: one JSON line in, one answer line out), built and driven by #169's helpers; #172's web
export (`{call: "export", doc, out, video: {codec: "web"}}`), its bundle served over HTTP and opened in headless Chrome
with WebGPU by #172's helpers, its player's members and `probe()` as #172's README defines them; #376's `see`. **Every
name marked *(chosen)* is this job's**, taken from the design's words and shaped like the neighbouring surfaces; the
implementer builds exactly these, or a dispute goes to a blind redraft.

### The player's tree in the page

- Once ready, the index page holds the document's accessibility tree, the one the app gives its accessibility seam
  (#376's `see` `tree` for the document at the shown time), as elements of the page's own DOM, not inside a shadow root:
  one element per node, marked `data-deep-id="<the node's id>"` *(chosen, as the playable page's design marks a
  state's tree)*, in the tree's order. No other element carries `data-deep-id`.
- Each marked element is in the browser's accessibility tree, not ignored. Its name is the browser's computed accessible
  name and must be the node's name. Its role is read as #169's suite reads a page's: its `aria-roledescription`, else
  its `role` attribute, else the browser's computed role; so a part may be `role="img" aria-roledescription="part"`, and
  a slider an `<input type="range">`.
- "The description on the player": the document's node (its `id` the document's ID, role `document`, named by the
  title) has the document's `description` as its computed description *(chosen: `aria-description` or
  `aria-describedby`; the node may be the `<deep-player>` element itself)*.
- A control's marked element takes keyboard focus, or holds the element that does; the node with focus is the focused
  element's nearest marked ancestor (itself included).

### The live region *(chosen)*

The page holds an element with `aria-live="polite"` through which the player announces readouts. An update is a DOM
change inside it (or its insertion) after which it holds text; a change that empties it isn't one. The base's notices
(`[data-deep-notice]`, `role="status"`) are not it.

### Planted players (the scenario's `planted`)

Chosen by the scenario's `planted` key on `deep-show run`, as #172's are: the export writes the planted player into the
bundle (the element's script or the player), never an environment variable. At the base each name answers `bad_input`.

| Name | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| `web_no_tree` *(chosen)* | the player keeps no accessibility tree in the page: no element for any node and no live region; otherwise the shipped player | 1 | each part and control: `beam`, `lens`, `screen`, `c-rays`, `c-labels` |
| `web_announces_every_frame` *(chosen)* | the player writes each readout's text into its live region on every frame it draws, changed or not; otherwise the shipped player | 1 | the readout, `count` |

### The VoiceOver run *(chosen)*

AC2's evidence is a person's run, by ear, recorded in `tests/acceptance/1045/VOICEOVER.json`: `{issue: 1045, criterion:
"#1045.acc208bf", result: "pass" | "fail", who (the person who listened), when (ISO 8601), machine (the model
identifier, as `sysctl -n hw.model` prints it), macos, safari (their versions), bundle (the SHA-256 of the bundle's
`index.html` that the test prints), heard: {<node id> → what VoiceOver said for it}, announced (what VoiceOver said when
the readout changed), note?}`, the texts as VoiceOver's caption panel shows them. `heard` covers each part and control.
Only a person's run is recorded there; no agent writes one on its own judgement.

The step, which the test prints as its one unblock ask: at a reference Mac (Mac15,7, Mac15,12 or Mac17,10, as
`scripts/benchmark.mjs` names them), serve `target/acceptance/1045/voiceover/` (for example `python3 -m http.server 8045
--bind 127.0.0.1 --directory target/acceptance/1045/voiceover`), open `http://127.0.0.1:8045/` in Safari, turn VoiceOver
on (Command-F5) with its caption panel, move VoiceOver through the player and note what it says for each part and
control; then set the player past 2 s (Safari's console: `document.querySelector('deep-player').currentTime = 2.5`)
and note what it announces; write the record.

## The app's side

The app's tree and announcement come from #376's `see`, as #169's suite reads the app's tree: one `deep-show run` with
#383's virtual clock (60 Hz, no lead), the figure shown from your shell at 0.05 s on a 480 × 270 panel, and `see` at
3.5 s. The base's `see` plays the revision (#504's note in `access.rs`) and evaluates each presented frame's readouts at
that frame's time, and the panel presents a frame when the channel's key at 2 s comes due, so the app hears the change
the player plays. Before any page is read, the fixture is held to the app: its tree has each part and control once with
its name and role (#376's `treeFailures`), and its announcements are exactly one, readout `count`, at or after 2 s,
holding "4". "The app's order" of the controls is the order of their nodes in that tree. Observed at the base: the
tree `01jb1045000000000000000001` (document, "Light through a lens", with the description), `beam`, `lens`, `screen`
(part), `caption` (label), `count` (data, "Rays counted"), `c-rays` (slider, "Number of rays"), `c-labels` (switch,
"Show labels"); frames at 0.05 s and 2 s; one announcement, `count` "Rays: 4" at 2 s.

## How the page is read

Over #172's DevTools session of the page (#172's `Tab` keeps its protocol and session private; `helpers.ts` reaches
those two fields to send commands, and runs no code in the page but its reads, the observer below and a mark of which
seek came last):

- **The tree**: `DOM.querySelectorAll('[data-deep-id]')` and `Accessibility.getFullAXTree`, as #169's suite reads a
  page's tree (the browser's computed tree, not the DOM's attributes, for names, descriptions and what is ignored).
- **Tab**: `Input.dispatchKeyEvent` key presses of Tab (rawKeyDown, keyUp), with the page's focus emulated
  (`Emulation.setFocusEmulationEnabled`), from the page as it is (a control already focused counts first), until a
  control comes round again or 40 presses; after each, the focused node.
- **The live region**: a `MutationObserver` on the whole page, installed once the player is ready, that logs each update
  of an element with `aria-live="polite"` with the mark of the latest seek.
- **Time**: seeks only, by #172's `seekStep` (a host's `currentTime`, then `probe().step` read until it lands), since a
  headless page gets no animation frames to play by.

## Fixture

`playedFigure` in `helpers.ts`: #376's `fixtures/figure.json`, read from #376's folder, with three additions made in
test code and nothing else changed:

- `id`: `01JB1045000000000000000001`, the document's ID (as #169's and #172's documents carry theirs), which names the
  document's node; the app keeps it in lower case, `01jb1045000000000000000001`, in its tree and in the bundled
  document alike, and the page's node must carry the app's;
- `transport: {span: "4s"}`: without a span the player's clock can't leave 0 (its span is `transport.span`);
- `channels.count_up`: `{target: "data/count", type: "f32", keys: {k0: {t: "0s", value: 3, interp: "hold"}, k1: {t:
  "2s", value: 4, interp: "hold"}}}`.

So the readout `count` (`Rays: {data/count}`) shows 3 until 2 s and 4 from 2 s. This is the smallest change the design
gives for a readout to change once during play: a channel keying a data value (the path grammar: "A channel may key
`data/<name>`"; #1162's suite keys this same readout so), with no input, no new item and no new control, so both trees
are the fixture's own: the document, the parts `beam`, `lens`, `screen`, the caption, the readout `count`, and the
controls `c-rays` (slider, "Number of rays") and `c-labels` (switch, "Show labels"). An entry on the recorded track
would need a document-class control the fixture lacks (both are class `view`). No fixture file of this suite's own.

## Readings where the issue leaves a choice

- **"Equals the app's as data"** is every node of the app's tree (#376's `see`: the document's node, each item heard,
  each control), by id, role and name, in the app's order, with no node the app's lacks, plus the document node's
  description ("the description on the player"); "one node per part and control with the same names and roles" is
  within that.
- **"Gives an accessibility tree" in headless Chrome** is the browser's computed accessibility tree over the marked
  elements, not the DOM's attributes alone: a node the browser ignores is not in the page's tree.
- **"Tab reaches every control in the app's order"**: real Tab presses give focus to each control of the app's tree,
  first in the app's order; other stops (the canvas, the player's own controls) may sit between them.
- **"A changed readout updates the live region once"**: over the four seeks, no update while the readout is unchanged
  (1 s, 1.5 s), and exactly one from the seek that shows the change (2.5 s) to the next unchanged one (3 s), holding the
  app's announcement text. "After a quiet interval" leaves the interval open: the test waits up to 10 s after the
  changing seek, and 1.5 s after each other. Updates before the first seek (the readout first shown at load) aren't
  read, as #376's suite doesn't read announcements before its first change.
- **"Naming the node"**: for the player with no tree, each part and control by ID; for the one that announces every
  frame, the readout `count`.
- **"The same figure"** (AC2) is the figure above, exported the same way. **"Names every part and control"**: what the
  person heard for each holds its name; **"announces the changed readout"**: what they heard announced holds the app's
  announcement, both compared by letters and digits alone, ignoring case, spacing and punctuation.
- **"On the reference Mac"** (AC2): the record's model identifier is one of the reference Macs.

## Legs that read BLOCKED

None of these is ever a pass.

- Every browser test is BLOCKED (#172's helpers) without Google Chrome at `/Applications/Google Chrome.app` (or
  `CHROME_BIN`), when Chrome opens no DevTools port within 60 s, or when the player isn't ready and Chrome offers no
  WebGPU adapter.
- AC2 is BLOCKED without a person's recorded run on exactly the bundle the test exports, at a reference Mac, with the
  one unblock ask above.

## Known limits

- The page's tree is read in the light DOM only: the protocol's `DOM.querySelectorAll` doesn't enter shadow roots.
- The tree and Tab are read in one state, at 3 s; the readout's node name doesn't change with its value.
- Updates are counted per batch of DOM changes the observer sees: writes in one task count once.
- AC2's record is a person's word; the test holds its shape, its bundle, its machine and its transcripts, not their
  truth.

## Not tested, and why

No criterion asks: that the tree is "read through the core, never written by the piece or the host page" beyond its
equality with the app's; a control's value or `value_text` in the tree; a readout changed by input; a `<deep-player>`
on a host page, and the fallback or tour page's own tree; any figure but #376's.

## What the implementer adds outside this folder

`scripts/lanes.mjs`, beside #172's lines (this job writes only its folder):

```js
// #1045's files each build deep-show (full) and drive headless Chrome with WebGPU on.
alone.push('tests/acceptance/1045/');
```

And, in deep-show, the two planted names above. `VOICEOVER.json` is added in this folder only from a person's run.

## Files

- `helpers.ts`: the figure as the player plays it, the app's side, and the page's tree, Tab and live region.
- `tree.test.ts` (AC1, 3 tests), `voiceover.test.ts` (AC2, 1 test).
- `BASE-FAILURE.txt`: the run at the base, each test's first failing assertion, the load and the time.
- `tsconfig.json`.
