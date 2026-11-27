# Acceptance tests for #1042: the web player's live public sources, today's light as the fallback, and font subsets

Written first, blind, from issue #1042 (as saved on November 24, 2026: its opening paragraph, its Scope, its `Runs on:`
line and its four acceptance criteria), its oracle page, the design and the base commit `ebf1e7f44` (the merge of
#3411), by a job that never saw an implementation. No other worktree, branch, PR, stash or plan was read, and every
repo file was read at the base commit. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding). The oracle page says no upstream test checks any of the four
criteria, so there is no `1042-oracle/` folder. Three sittings of the job, each under the same inputs and limits: the
first drafted the test files; the second read every line against the issue, the design and the base, corrected them
and wrote this page; the third repaired what runs at the base showed wrong in the suite itself, and ran it there.

**Checked.** Every file has run at the base, `ebf1e7f44`, on November 26, 2026, in headless Google Chrome
158.0.8127.38 with WebGPU: `BASE-FAILURE.txt` has each test's result there. The four tests of new behaviour fail at
their own assertions, for what their criterion names; the taste test is INCONCLUSIVE; the render test of criterion 3
passes, as it should, after failing its wrong program; none is BLOCKED. Three faults of the suite itself were found
by runs at the base and repaired, each said in `BASE-FAILURE.txt`: the browser's flags (no page on this machine's
loopback loaded), a second page in one browser that never heard its own events, and a worker the browser starts for
itself that was taken into a page's record of requests. Two more were repaired on reading: deadlines that didn't
name their wait, and two BLOCKED legs that named the wrong thing.

What the base can't show is the session of criterion 1 past its first wait, since the base's player never asks a
source. That part was tried twice on stand-ins, which prove the test's own logic and never the base. In the browser:
a hand-written page whose stand-in player asks its declared source with no cookie, keeps each value as an entry at
the step not yet run and shows it with its source and age passed the whole session (planted cookies that travel,
the stand-in source over https with its throwaway certificate, the held source, a value given while paused, the
outage, the three records) with no failure; the same page sending cookies, asking another host and keeping only its
last value failed, naming each. In the test's own process, on a made-up clock: a stand-in that does what the
criterion asks passed, and 22 wrong ones each failed or were BLOCKED by the words they should. Also checked without
a browser: the type check passes (`tsc -p tests/acceptance/1042/tsconfig.json`, exit 0); `vitest list` collects the
6 tests below; each judge in `judges.ts` against planted inputs, a good one and each wrong one its criterion names,
106 checks; the wrong font of criterion 3 made from the repo's CJK face and read back, 13 checks; every script the
suite asks a page to run parsed, with the name its wait carries, 33 checks; which contexts join a page's record, 12
checks. `node scripts/repo-rules.mjs` and `node scripts/wait-ratchet.mjs` print no line that names this folder.
**Not seen anywhere**: a real player through the ten minutes of criterion 1 (the stand-in's session in the browser
was 40 s long, and the base's stops being judged after its first 180 s).

## What was read

- The issue (`gh issue view 1042 --repo windoliver/deepbuild`, as saved for this job) and its oracle page.
- `docs/canvas-primitives.md`: Export: web player, Seam and backend, Tour, Net: relay and Join, Logic: saves, Check
  input: logic kinds (the six the issue links), and those they lean on: Paths: rays, finals and the web player, Light
  and the light policy, Light: ray traced, Bound value, Held reading, Input track, Input track entries, Logic:
  readings, Text `text@1`, Scope and input classes, Honest numbers. `docs/technical-design.md`: Films and figures on
  the canvas, How it installs, Building blocks (a shared piece's reads in the web player), Ray-traced light, How we
  know version 0 works (Criteria to tests, Wrong programs, the edit guard, Dogfooding, Tests written first, Repo
  guards). `docs/parallel-proof.md` sections 5 to 7. AGENTS.md, CONTRIBUTING.md.
- At the base, for surfaces only: `crates/deep-show/src/export/web.rs` and `export/paths.rs`;
  `crates/deep-canvas/src/registry/paths.rs`; `crates/deep-canvas-scene3d/src/sets.rs` (the light policy);
  `crates/deep-player` (`web/element.js`, `src/page.rs`, `src/play.rs`, `src/gpu.rs`'s `show`);
  `crates/deep-text/src/fonts.rs`; `crates/deep-logic/src/track.rs` (a reading's entry); `crates/deep-play/src/form.rs`;
  `crates/deep-canvas-marks/src/scene.rs` (a bound value's text and age); `crates/deep-show/src/export/page.rs` and
  `crates/deep-canvas-export/web/page-player.js` (a bound value on the playable page); `scripts/proof-change.mjs`
  (`criterionId`, test names), `scripts/wait-ratchet.mjs`, `scripts/lanes.mjs`, `scripts/lanes-lists.mjs`,
  `scripts/alone-lint.mjs`, `scripts/repo-rules.mjs`; the suites `1041/` (the model for this one), `172/`, `169/`
  (a bound value in a page), `533/` (a reading's entries), `549/` and `309/` (a throwaway certificate, `relay_ca`),
  `1040/`, `1217/`, `2776/` and `446/` (fixture shapes).

Code was read only to learn the surfaces. Every expected value comes from the issue and the design.

## What the base does

Observed, each line, in the runs of November 26 at the base (`BASE-FAILURE.txt` has the assertions whole).

- **Criterion 1.** `export_web` reads no `web` setting of the export's `video`, the element fetches the bundle's
  files and nothing else, each with `credentials: 'omit'`, `probe()` has no `readings`, and the player's page marks no
  bound value. The scenario reads no `source_ca` and no `secrets`; a key it doesn't know is passed over. **The
  session**: the 600 s gauge is presented and exported, the planted cookies travel, the player is ready on WebGPU,
  600 s long, and plays; the test fails at "the player asked the piece's declared public source … for no value in
  the first 180 s of play" and "probe().readings is undefined, not the list of the reading entries on the player's
  input track", and at nothing else: every request of those 180 s was for one of the bundle's own files, with no
  cookie on any the player made. **The refusal**: both gauges are presented, the one with its public source alone
  is exported, and the test fails at "the export of a piece whose source 01JB1042R00000000000000002 answers only
  with a key is "exported", not refused".
- **Criterion 2.** Ray-traced light isn't built (#174 and its parts). A light policy that names `rays` and `effects`
  is presented and exported as one that doesn't; the yard's player is ready on WebGPU, 4 s long, and plays from its
  start to `ended` at step 240, drawing frames, with nothing stopped. The receipt's `stand_in` is `[]`: the test
  fails at "the receipt lists 0 fallbacks for sun on the web path, not one: its stand_in is []".
- **Criterion 3.** The export bundles every face of `deep_text::FACES` whole. **The subset** fails at "the bundle's
  CJK font is 8,331,336 bytes, not under 200,000 (the whole face)" and "the bundle still holds the whole CJK face".
  **The render** passes, as it should: there the bundle's CJK font is the app's whole face, and the scroll's first
  frame on the player's canvas is within one code value of the app's still on every pixel. Its wrong program, the
  copy whose CJK font names other glyphs, is loaded by the base's player, is ready, draws its frame and fails the
  same comparison by "more than one code value" (Planted programs).
- **Criterion 4.** No picture and no call: "INCONCLUSIVE: the check run's pictures are not in docs/evidence/1042/:
  player-ray-shadow-fallback.png, player-cjk-subset.png; this is not a pass".

## Run them

Put Node 24 and the pinned Rust toolchain first on PATH; in a fresh worktree run `npm ci` once; then one file at a
time, each under the machine's throttle as the lanes run a folder that is alone:

```sh
export PATH="$HOME/.rustup/toolchains/1.99.1-aarch64-apple-darwin/bin:$PATH"
npm ci
for f in ac01-public-sources ac02-ray-shadow-fallback ac03-font-subset ac04-taste; do
  NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs test --wait 60 -- \
    node node_modules/vitest/vitest.mjs run --no-file-parallelism --root tests/acceptance/1042 $f.test.ts --testTimeout=3600000
done
node node_modules/typescript/bin/tsc -p tests/acceptance/1042/tsconfig.json   # type check
rm -rf tests/acceptance/1042/node_modules                                      # vitest's cache after a --root run
```

Every `it` and every hook passes its own 3,600,000 ms timeout. Each of the three browser files builds `deep-show` once
in `beforeAll` (`cargo build --locked --bin deep-show --no-default-features --features full`, as #1041's suite builds
it) and copies it out of `target/`; `ac04-taste` builds nothing. Nothing else is built: the suite imports Node
built-ins and vitest only, no workspace package and nothing from another suite. The certificate is made by the
`openssl` command. Temp folders are removed after each test; each server runs as a child process and each Chrome in a
process group of its own, each stopped by its PID; nothing is stopped by name or port. `ac01` plays one piece for its
10 minutes, so it takes about 12 minutes beside the build; the others play 4 s pieces.

The folder runs alone by its own `lane.json` (`shared: the GPU`), so `scripts/lanes.mjs` needs no line for it.

## Criteria to tests

IDs are `#1042.` and the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white space collapsed
(`criterionId` in `scripts/proof-change.mjs`, computed from the issue's body as saved). Each test's name starts
`AC<n> #1042.<h8>`.

| AC | ID | File (tests) | What it asserts, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#1042.c144d9ce` | `ac01-public-sources.test.ts` (2) | **The session.** The gauge, 600 s long, exported with one declared public source, played in headless Chrome on WebGPU from its start to `ended` with no seek. The source is held, so the test gives each value at a moment it chose: the first while the piece plays; the second, the same number again, while the player is held paused; none for 150 s of play; then a new one for each further request. Each value given is one more entry in `probe().readings` and none is lost; it names the declared reading and holds the value; it is stamped at a step's start, between the steps read before and after it (exactly the paused step, for the second); its as-of time lies between the ask and the page showing it; and the page shows it with the source's host and a `<time>` at that as-of time whose words have changed after the 150 s. At least three values are given, the entries gained equal the values given, and the play ends at step 36,000. Then every request of the session: only the bundle's own files and the declared URL, GET only, no cookie and no credential on any request the player made, though a cookie was planted for each host and shown to travel. **The refusal.** The same piece with its public source alone is exported; with a second source that answers 401 without the made-up key it is refused, a `refused` entry naming that source's reading with `web.source_key` and none naming the public one, and nothing is written. Fails on: the base; a player that keeps only the last value or drops a repeat; one that stamps a value at step 0, a step late or between steps; one that shows a time of day and no age, or no source; one that sends the browser's cookies or a key; one that asks any other host, opens a socket, or asks its own host for a file the bundle doesn't hold; an export that admits a source it can read only with the app's key |
| 2 | `#1042.8f1f57d3` | `ac02-ray-shadow-fallback.test.ts` (1) | The yard, whose light policy names ray-traced shadows (`rays: auto`, `effects: [shadows]`) and whose one shadowed light is `sun`: its web export is `exported`; the index page's player, not the fallback page, is ready on WebGPU, 4 s long, and played from its start draws frames and reaches `ended` at step 240 with nothing stopped; and the receipt's `stand_in` holds one entry for `sun` on the web path with `light: "without_history"` and the answer's words, and refuses nothing for it. Fails on: the base (its receipt lists nothing for the light); an export that refuses a piece for naming rays; a player that stops on one; a receipt that names the fallback for no item, for another item, or names `rays` |
| 3 | `#1042.5bc230da` | `ac03-font-subset.test.ts` (2) | The scroll shows 40 graphemes, counted in the test: all distinct, each one Han character. **The subset.** The bundle's manifest names one font of `NotoSansSC-Regular.otf`; its bytes are an OpenType file under 200,000 bytes whose family name, copyright line, licence and licence address are the face's; the face's licence text is in the bundle; the whole face is not. **The render.** The app's still of the scroll's first frame shows the text (at least 1,200 ink pixels in its box) and the same frame read back from the player's canvas is the same size with every pixel's every channel within one code value. A copy of the bundle whose CJK font names, for each of the forty graphemes, the glyph after its own (the face's character map moved by one glyph, made in the test and checked there) is ready, draws its frame and fails that comparison by its pixels. Fails on: the base (the whole face, 8,331,336 bytes); a subset that drops the name or the licence records; a subset whose glyphs aren't the ones the text shows (its glyphs renumbered and its character map left as it was, or a glyph missing), a player that sets the text in another face, a blank frame |
| 4 | `#1042.ed73d00d` | `ac04-taste.test.ts` (1) | reads the record only (The taste call) |

Test count: 2 + 1 + 2 + 1 = 6.

## The surface under test

The base's, as #172's and #1041's READMEs define it and unchanged: `deep-show run` (one JSON line in, one answer line
out), `deep show` of a document, `export` with `video.codec: web` and `track`, the folder it writes, its receipt, the
bundle's `index.html` with its one `<deep-player>` and its manifest, the player's members (`ready` and its event,
`play()`, `pause()`, `paused`, `currentTime`, `duration`, `timeupdate`, `ended`), `probe()` (`step`, `backend`,
`frames`, `stopped`) and notices marked `data-deep-notice`. No new binary and no new call. What this issue adds is
below. **Every name marked *(chosen)* is this job's**, the least its criterion needs, shaped like its neighbours; the
implementer builds exactly these, or a dispute goes to a blind redraft.

### The scenario

| Key | What | Whose |
|---|---|---|
| `source_ca` *(chosen)* | the path of a PEM certificate authority the app trusts, beside the platform's own, when it asks a declared source at export | this job's, shaped as #549's `relay_ca`, which is the relay's |
| `secrets` | `{keyed_source: "<the made-up key>"}`: the app's store as the scenario holds it, so the keyed stand-in is a source the app itself could read. Nothing is asserted of it but that the export doesn't admit the source | #172's key; nothing in the base reads it |
| `record` | `{"reading:<ID>": {session, value, as_of}}`: the readings the app recorded before the export, shown from the agent's tree | the base's, as #169's |

### `export` with `video.web.sources`

The design's Fields, inside `video` as #172's README has them:

```json
{"call": "export", "doc": "01JB1042D00000000000000001", "out": "<tmp>/gauge",
 "video": {"codec": "web", "web": {"sources": [
   {"reading": "01JB1042R00000000000000001", "url": "https://127.0.0.1:<port>/outside.json", "every": 60, "path": "value"}]}},
 "track": []}
```

- `reading` is the reading's ID: what follows `reading:` in the handle a bound value of the piece names
  (`source: "reading:01JB1042R00000000000000001"`).
- `url` is the https URL the player asks, exactly as written: no query, header or cookie added.
- `every` is 60, the least the Fields allow: the seconds between two asks.
- `path` is `"value"`: the member of the JSON object the source answers that holds the value *(the form of a path is
  chosen: one member's name; no test uses a deeper one)*. The stand-in answers `{"value": 20.5}`.

The two stand-ins differ only in what they answer a request with no key: `/outside.json` 200 with a value,
`/keyed.json` 401 with `WWW-Authenticate: Bearer` (and 200 only to `Authorization: Bearer <the made-up key>`). So an
export can tell them apart only by asking, with no key, as the player would; `source_ca` is how the app trusts the
stand-in's certificate when it does. While a piece is exported the public stand-in answers 19.5 at once.

### The refusal

A piece with a declared source that answers only with a key is refused, as the base refuses what a bundle can't carry:
`outcome: "refused"`, nothing written in `out`'s folder, and a `refused` entry for the source whose `item` is its
`reading` and whose `code` is `web.source_key` *(code chosen)*. No `refused` entry of any code has the public source's
reading as its `item`.

```json
{"outcome": "refused", "code": "web.refused",
 "refused": [{"item": "01JB1042R00000000000000002", "code": "web.source_key", "why": "…"}]}
```

### probe()

Beside what #172 and #1041 define, `probe()` returns `readings` *(chosen)*: every reading entry on the player's input
track, in the track's order, each in the base's own form of a reading's entry (`crates/deep-logic/src/track.rs`; #533's
suite reads the same four members of the app's):

```json
{"t": 43276800000, "reading": "reading:01JB1042R00000000000000001", "value": 20.5, "as_of": 1795550461234000}
```

- `t`: flicks, a whole number: the start of the first step not yet run when the value arrived. The pieces here step
  60 times a second (the base's step for a piece with no world and no logic item), so `t` is `probe().step` at that
  moment times 11,760,000.
- `reading`: the handle, `reading:` and the declared `reading`.
- `value`: the number the source gave at `path`.
- `as_of`: microseconds since the epoch, a whole number: when the value was taken. The tests accept from one second
  before the second the source was asked in up to the moment the page showed the value, so the time the player sent
  its request, the time the answer arrived and the answer's `Date` all pass.

Other members an entry has (`seq`, `writer`, `player`) aren't read. The list may hold the readings the export recorded
too: the tests count what a session gains over the list as read once the player is ready. An entry is never removed
or rewritten. `[]` when there is none; `probe()` still writes nothing.

### What the page shows

A bound value whose reading has a declared source shows in the page as #169's playable page shows a bound value
*(chosen for the player's page)*: one element marked `data-deep-bound="<bound value ID>"` in the page's document (not
in a shadow root), with a box and neither `display: none` nor `visibility: hidden`. Its text holds:

- the value as decimal text (`20.5`);
- its source: the declared URL's host as `new URL(url).host` gives it, here `127.0.0.1:<port>` *(chosen; the whole
  URL passes too)*;
- its age: the element is, or holds, a `<time datetime="<the entry's as-of time, ISO 8601>">` whose text is the age
  in words (the base's formatter says `0 s old`, then `2 min old`). The words must be there, and must have changed
  150 s of play after the value arrived when no newer value came, so a time of day is not an age.

```html
<p data-deep-bound="outside_now">20.5 from 127.0.0.1:53211, <time datetime="2026-11-24T20:01:01.234Z">0 s old</time></p>
```

When a newer value arrives the element shows it, and holds no `<time>` of the older one; the tests wait for that
change of the page's own document. A value given while the player is paused shows while it is paused.

### The receipt's fallback

The receipt's `stand_in` (the base's list of what the web path draws in an item's place, #2776) holds exactly one entry
whose `item` is the shadowed light and whose `path` is `web`. It carries `light: "without_history"` *(member chosen;
the word is the design's for today's light in a key and a receipt, Light: ray traced)* and the base's `entry`, `draws`
and `receipt`, each a string with words in it, which are the implementer's. `receipt.refused` holds nothing for it.

```json
{"item": "sun", "entry": "light.sun@1.shadow", "path": "web", "light": "without_history",
 "draws": "today's light: the light's shadow map", "receipt": "the light whose shadows fell back"}
```

### The bundle's fonts

Read from the index page's manifest, the JSON of `<script type="application/json" id="deep-bundle">`, as the base
writes it and the player reads it. The receipt's files don't say which file is which face; the manifest is how the
player itself finds each face's bytes, and the copy with a wrong font has to change it, so the tests read it there.

- `fonts: [{file, sha256}]`, the base's: `file` is the face's file name among the bundled faces, `sha256` the SHA-256
  of the bytes the player gives the core for it. Exactly one entry has `file: "NotoSansSC-Regular.otf"`: a subset
  keeps its face's file name here *(chosen)*.
- `files: [{path, sha256, inflated?: {bytes, sha256}}]`, the base's: the subset is the file whose `inflated.sha256`
  (or `sha256`, for a file stored as it is) is the font entry's `sha256`.
- The subset's bytes are an OpenType file (`OTTO` or `0x00010000`), under 200,000 bytes, whose `name` table keeps the
  face's records 1 (family), 0 (copyright), 13 (licence) and 14 (licence address), read from the English Unicode
  record where there is one.
- No file of the manifest has the whole face's SHA-256, and one has the SHA-256 of
  `crates/deep-text/fonts/LICENSE-NotoSansSC.txt`, as at the base.

### The app's side

The app's render is the base's own: `export` with `video: {codec: "png_seq"}`, `size: [640, 360]`,
`frame_rate: [30, 1]`, `track: []` and `range: {still: {t: "0s"}}` (#501's still, as #169's suite asks for it), which
writes one PNG. The player's is its canvas (`deep-player canvas`, 640 × 360, the piece's size as at the base), read
with the canvas's own `toDataURL('image/png')` in the task that drew it: the test sets `currentTime` to 1 and back to
0, which draws at once at the base, and reads. A screenshot, as #1217's suite takes, is the page as the browser scales
it into its window; the comparison needs the frame's own pixels, one for one, so the tests read the canvas.

## Planted programs

None is reached by the scenario's `planted` key, and none needs building. Criterion 1's and criterion 2's clauses that
only forbid (no other host, no cookie, no credential, no refusal) are asserted in the same test and on the same run as
the clause that needs the thing done, so a program that does nothing fails them; their wrong program is the merge base.

| Made in test code | What it does wrong | Criterion | A failure must name |
|---|---|---|---|
| the scroll's bundle copied with, as its `NotoSansSC-Regular.otf`, the face's own bytes with its character map moved by one glyph for the text's code points (`shiftedFace` in `judges.ts`: in each Unicode `cmap` subtable, of format 4 or 12, every segment or group that holds one of them names the next glyph). The manifest's font entry and file list are changed to match, so the copy is whole by its own hashes | its CJK font sets each of the forty graphemes in another glyph of the face: what a subset draws whose glyphs were renumbered and whose character map was not. It keeps the face's size, tables, names and glyphs, so the player loads it as it loads the face | 3 | pixels `more than one code value` from the app's |

The test first checks the wrong font is what this table says (`shiftFailures`: in every Unicode subtable each of the forty
code points has a glyph in the face and the glyph after it in the copy). A face with no Han glyph at all, which an
earlier draft of this suite put there, is not used: the wrong program has to be one the player loads and draws, and
whether a player draws, refuses or stops on a text none of its faces maps is not what the clause is about.

## Fixtures

All made at test time in `helpers.ts`; no personal data; CC0.

- **The gauge** (AC1): a 2D film of 320 × 180 at 30 frames a second, 600 s long (4 s in the refusal's test). A dot a
  driver walks with time and a `data` text `readout` whose words the bound value `outside_now` fills from the reading
  `01JB1042R00000000000000001`. In the refusal's test it is another document that also binds `keyed_now` to the
  reading `01JB1042R00000000000000002`. The app's record holds both readings (18.5 and 6.5, as of
  2026-11-24T09:30:00Z), in the agent's session, as #169's bound document has its reading.
- **The yard** (AC2): a 3D scene of 640 × 360, 4 s at 60 frames a second: a floor, a crate a driver slides across it,
  a camera and the key sun `sun` (`shadow: true`), with `light_policy: {rays: "auto", effects: ["shadows"]}`.
- **The scroll** (AC3): a 2D film of 640 × 360, 4 s at 30 frames a second: the text `verse`, role `body`, 26 px in a
  600 × 168 box at (20, 24), holding the first forty characters of the Thousand Character Classic in simplified
  forms, and a dot a driver walks under it. The look's fallback list sets the Han graphemes in the bundled CJK face.
- **The made-up key and cookies**: `deep1042-made-up-key-that-opens-nothing`, and the cookies `deep1042_site` and
  `deep1042_source`, made up in test code; they open nothing.

## The servers, the browser and the logs

- **The bundle's server**: a `node:http` listener in a child process of its own, serving a folder at
  `http://127.0.0.1:<port>/`, each bundle from a folder of its own under it, every `index.html` with `no-cache`, every
  other file with a max-age of a year, WebAssembly as `application/wasm`, no isolation header. It writes one line for
  each request that reaches it: when, its method, its target, its headers, the status answered.
- **The stand-in sources**: one `node:https` listener in a child process of its own at `https://127.0.0.1:<port>/`.
  `GET /outside.json` is the public source: `{"value": <number>}` to anyone. The test sets it `open` (answered at once
  with a set value), `held` (each request waits until the test gives it a value) or `down` (503). `GET /keyed.json`
  answers 401 unless the request carries the made-up key. `GET /control` answers 204 to the test's own request. Every
  answer lets any origin read it, with credentials and any header, and says `cache-control: no-store`, so a player
  that sent a cookie or a key would get through and be seen. One line for each request that arrives and each answer.
- **The certificate**: an authority and a certificate for 127.0.0.1 it signed, made by the `openssl` command in a temp
  folder, as #309's suite makes its relay's. Nothing is installed: the app is handed the authority (`source_ca`), and
  Chrome trusts the certificate by its public key's pin (`--ignore-certificate-errors-spki-list`), in that browser
  alone.
- **The browser**: Google Chrome at `/Applications/Google Chrome.app` (or `CHROME_BIN`), `--headless=new` with
  `--enable-unsafe-webgpu --ignore-gpu-blocklist`, a fresh profile, driven over its DevTools protocol by `web.ts` alone
  in flat sessions (no browser-automation library). Pages are 1280 × 720 at device scale 1. Play is started as a user
  gesture. **No request leaves the machine**: every host but this machine's loopback address resolves nowhere
  (`--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1`) and every request to a host that isn't loopback goes
  to a closed port (`--proxy-server=http://127.0.0.1:9`), where the browser's record still names it. Loopback is left
  out of the resolver's rule because the rule takes an address as it takes a name: with 127.0.0.1 in it, no page
  served there loads at all. A page the browser doesn't load is BLOCKED, naming the navigation's own error. One
  browser may open several pages, one after another: each hears its own session's events and those of the contexts
  under it, and no other page's. A context the browser starts for itself, from a script it serves from itself (at
  the base: the worker of an extension it ships, `chrome-extension://…/service_worker.js`, some time into a
  session), is no context of a page and no page can start one: it runs on, is left out of the page's record, and
  the session's message names it. A request a page itself makes to such an address is still in its record, and
  fails.
- **Where the log is taken, and why nothing misses it.** Three records, all judged:
  1. the browser's own (the DevTools protocol's network events of the page, turned on before it navigates, and of
     every context that starts under it or under the browser but the browser's own, each held at its start until its
     record is on): every
     request with its URL and method, the headers each went out with, cookies among them, and every socket opened;
  2. a page-side log installed before the page's scripts: each `fetch`, `XMLHttpRequest`, beacon, `WebSocket`,
     `WebTransport`, `EventSource`, worker of any kind and peer connection a script starts, with its URL or servers;
  3. the two servers' own records of what reached them.
  A request to either stand-in is in the browser's record and that server's; a request to any other host can reach
  nothing, and is in the browser's record, and in the page-side log when a script made it.
- **No cookie.** Before the page opens the test plants one cookie for the bundle's host and one (`Secure`,
  `SameSite=None`) for the source's, and proves each can travel: a request of its own from a blank page that asks for
  cookies must arrive at the source with the source's cookie, and the browser's own load of the index page must carry
  the bundle's, else the test is BLOCKED. Then no request the player made may carry a `cookie` header, in the
  browser's record or a server's. The browser's own loads of the page, of its scripts and of the site's icon
  (`sec-fetch-dest` `document` or `script`, and `/favicon.ico` not asked by a script) carry the origin's cookies by
  the browser's rule, which no page can turn off, and are let through; a file the page's markup loads any other way
  would carry it too and fail, so the player takes its files by `fetch` with credentials left out, as the base's does.
- **No credential.** No request to either host carries `authorization`, `proxy-authorization` or any header whose name
  says key, token, secret, credential, password or session; the source is asked for its declared URL and nothing more,
  so a key in a query fails too. The app's store holds the made-up key in the refusal's test only.

## The scripted session

The gauge is 600 s long and is played once, live, from its start to its `ended` event with no seek, so the session
lasts the piece's ten minutes of play and every wait in it is for an event: a request arriving at the held source, a
change of the page's document, the player's `timeupdate` or `ended`. No test measures the session by a clock: the
wait ratchet counts an assertion on a clock difference as a fixed wait, and the player's clock is the browser's frame
clock, so 600 s of play is 600 s. The script:

1. the cookies are planted and shown to travel; the source is held; the page opens and its player is ready, 600 s
   long, on WebGPU; `probe().readings` is read once;
2. `play()`; the first request to the source (within 180 s) is given 20.5 while the piece plays;
3. the second request (within 240 s more) is given 20.5 again while the player is held paused: the entry must be at
   exactly the paused step, and the page must show it before the player plays on;
4. the source is down for 150 s of play: the value still shows, with the same as-of time and other words for its age;
5. the source is held again, and each further request is given a new number (31.5, 32.5, …) until the play ends;
6. the session's gains are read, and its three records judged.

A request the player has left before the test answers it gives no value and is no failure while the piece plays. A
player that drops its request when paused fails step 3, saying so, and is played on.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- Every browser test is BLOCKED without Google Chrome at the path above, when Chrome opens no DevTools port within
  180 s, when a server of the suite doesn't listen within 120 s, when Chrome doesn't load the bundle's page from the
  suite's own server (the navigation's error is named), or when the page's player isn't ready and Chrome offers no
  WebGPU adapter there.
- AC1 is BLOCKED without the `openssl` command or when it makes no P-256 certificate, when the browser keeps no planted
  cookie, when the test's own request from a blank page isn't answered by the stand-in source (the fetch's error is
  named), and when that request arrives without the planted cookie though it asked for cookies to be sent.

Every wait is for an event and has one deadline. A wait that meets it says which wait it was: what was awaited, with
the script the page was asked to run where there is one, and its bound in milliseconds. The session puts that sentence
in the failure it leads to, so a failure ten minutes in names its place.
- AC4 is INCONCLUSIVE without the pictures in `docs/evidence/1042/` or without a recorded call on exactly them.

## The taste call

The check run takes, from the pages in a browser, `player-ray-shadow-fallback.png` (the yard playing in the player,
with today's light) and `player-cjk-subset.png` (the scroll's forty graphemes in the player, set in the bundle's
subset), puts them in `docs/evidence/1042/` *(names chosen)*, attaches them to the PR and shows them in the session.
The call is recorded in `tests/acceptance/1042/TASTE.json`: `{issue: 1042, criterion: "#1042.ed73d00d", verdict:
"looks_right" | "looks_wrong", who, when (ISO 8601), screenshots: {<name>: sha256}, note?}`. This job writes no
TASTE.json and makes no picture; no other criterion reads a picture to judge how one looks.

## Readings where the issue and design leave a choice

- **"A 10-minute scripted session"**: one live play of a piece 600 s long, from its start to `ended` (The scripted
  session). **"That logs every request"**: the three records above.
- **"Its own files"**: the files the export wrote into the bundle's folder, each by its exact path with no query, and
  the browser's own request for the site's icon, as #172's suite counts it. GET only.
- **"The piece's declared public sources"**: each by its whole URL as declared; GET, and a preflight if the browser
  sends one. **"With no cookie or credential"**: on every request the player made, to either host (above).
- **"Each value a source gives"**: each 200 answer the player was there to take, a repeated number included (#533's
  reading of the same words for the app); a 503 gives none. **"One input entry"**: `probe().readings` gains exactly
  one entry for it and loses none, and over the session gains as many as values were given.
- **"At the first step not yet run"**: `probe().step` steps have run, so it is the step that starts at `step` ×
  11,760,000 flicks (#533 stamps the app's the same way). While the piece plays the test can only bound it by the
  steps read before the value was given and after it showed, so one value is given while the player is held paused,
  where it must be exactly the step held. The design's frame "reads only entries at or before its flick", so a paused
  frame reads that entry, and the page shows the value while paused.
- **"Shows its source and age"**: in the page's document, not in a picture (What the page shows). The source is the
  declared URL's host; the age is words beside the as-of time that change as the value ages.
- **"A source that answers only with a key"**: the stand-in that answers 401 to a request with no key and 200 to one
  with it. **"Refused at export, naming it"**: `refused` with nothing written, and a `refused` entry whose `item` is
  that source's `reading` and whose code says why; a refusal for another reason, or one that names the public source,
  fails. The same piece with the public source alone is exported first, so the refusal is for the key.
- **"A piece whose scene names ray-traced shadows"** (AC2): a scene whose light policy says `rays: auto` and
  `effects: [shadows]`, as Light: ray traced spells it, with one light that casts a shadow.
- **"Plays in the web player with today's light"**: the index page's player is ready on WebGPU, which has no ray
  queries, and plays the piece live from its start to its end, drawing frames, with nothing stopped. Which light a
  frame was drawn with is read from the receipt's word alone; how it looks is the taste call's.
- **"Its receipt lists the fallback for that item"**: the item is the light whose shadows rays would have traced, the
  one thing in the scene the fallback changes; the receipt's own list of what the web path draws in an item's place is
  `stand_in`; and the fallback is named by the design's word for it, `without_history`.
- **"40 distinct Han graphemes"** (AC3): 40 extended grapheme clusters, each one code point of the Han script, no two
  alike, counted in the test.
- **"A subset of the CJK face under 200 KB"**: the bundle's one font of that face, its own bytes (not as stored)
  under 200,000, and the whole face not in the bundle. **"Keeps the font's licence and name"** (Scope): the four name
  records, and the face's licence text in the bundle.
- **"The bundle's fonts render that text identically to the app's within one code value"**: the app's still of the
  frame at 0 s against that frame on the player's canvas, the whole frame, every pixel, each of the four channels,
  none more than 1 apart. The player's core holds no face of its own and reaches no system font, so the bundle's fonts
  are what draws the text there; the copy whose CJK font names other glyphs shows it, since nothing but that font
  differs between the two bundles. A blank or transparent frame, a missing glyph
  and another face each differ by far more than 1 where the app's render has ink, and the app's render must have ink.
- **The taste call** (AC4): two pictures, one a piece, as #1041's.

## Not asserted, and why

No criterion asks: that the bundle carries the readings recorded at export by hash, or that the page shows them before
a live value; how often the player asks beyond its asking again, an `every` under 60 or a URL that isn't https being
refused; a `path` deeper than one member, a value that isn't a number, more than one source, a source that is down at
export; what `receipt.sources` lists; a stale value's graying; the `referer` or `origin` a request carries; a logic
item reading the value; a replay of the session's track. The Scope's fourth line (the relay and Join) is held only as
far as criterion 1 reaches: a piece that declares no relay opens no socket and reaches no other host; a piece with the
net module is #549's and the net module's task's. For criterion 2: reflections, ambient occlusion and bounce light,
`rays: off`, a scene with several shadowed lights, the pixels of a shadow. For criterion 3: the other faces' subsets,
a text in several scripts, a glyph a control or a logic item could show later, the subset's tables beyond `name`, the
bundle's size, a frame other than the first. And: the fallback page, `<deep-player>` on a host page, run files.

## What the implementer adds outside this folder

Nothing the suite needs to run: it builds only `deep-show` with the full set, and its lane is its own `lane.json`.
The check run adds the two pictures in `docs/evidence/1042/`, and the call on them is recorded in `TASTE.json` here.
