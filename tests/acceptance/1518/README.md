# Acceptance tests for #1518: cut a recording by its words, each cut placed on quiet, the result heard back

Written first, blind, from issue #1518 (as of Nov 19, 2026: its Scope, Fields, 8 acceptance criteria, Proof and Depends
on), the design sections it links and those they lean on, and the base commit `d19559622` ("design(#1518): name
cut.words@1's surface, the cut placement, its strips and pictures, and cut.heard"), by a job that never saw an
implementation; none exists at the base, and no other worktree, branch or PR was read. The implementing agent doesn't
edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 1518 --repo windoliver/deepbuild`). Each test's name starts with its criterion's ID,
  `#1518.` and the first 8 hex digits of SHA-256 of the checkbox's text after `- [ ] `, trimmed, white space collapsed
  (`scripts/proof-change.mjs`).
- `docs/canvas-primitives.md` at the base: Strip and track (its fields, its `cut.words@1` line and "As built (#1518)":
  the item kind and params, `cut.words_unbaked`, `cut.keep_range`, the placement rule, the strips `<item>.s<k>`, the
  pictures `<item>.p<k>` and channels `<item>.p<k>.shown`, the expansion row's `strips`, `derived`, `channels`,
  `removed`, `fragments`, `cuts`, `timing.cut_ms`, the default row `<claim>#cut.heard` with `cut.heard_unrun`,
  `cut.word_lost` and `cut.word_left`, and the three planted programs); Narration and captions; Narration: speech
  engines (As built #509); Check input: `narration.transcript@1` (As built #509: the record, the unrun entry,
  normalizer@1, `media_heard`); Analysis bake (the `bake.words` record); Image `image@1`: video frames; Time and the
  flick. `docs/technical-design.md`: Films and figures on the canvas, Dogfooding, Built to be hard to get wrong.
  `AGENTS.md`.
- At the base, for surfaces and harness only: `crates/deep-show/src/main.rs` (the scenario's `planted`, `deep show`'s
  `include`), `hub.rs` and `packs.rs` (a reply's `expansions` and `timing`), `shared/calls.rs` (a patch's reply carries
  the expansions of the revision it makes; `read`), `heard.rs` (#509's default rows, their `blocked` entries),
  `narration.rs` (`narration.words_unbaked`), `mixdown.rs` (`media_mix`'s segment hash is of the interleaved f32 PCM),
  `media.rs`, `export.rs` and `export/run.rs` (an export's default PCM sound; it reads a `deep show` revision),
  `crates/deep-canvas/src/document/expands.rs` (a module kind's expansion row), `crates/deep-canvas-media` (strips,
  `media.strip@1`, `av_unlinked`, the planted list), `crates/deep-codecs` (`media_decode`'s streams, FLAC and `fpcm`);
  `packages/jobs/speech`, `packages/evidence`; `scripts/benchmark.mjs`, `scripts/lanes.mjs`, `scripts/throttle.mjs`.
  The suites `509/` (imported: the claim, verdict rows, `media_heard`, deep_job, the model host, `transcribe`), `501/`
  (imported: the build, scenarios, the store, `present`), `1819/` (imported: `say`, the float WAV), `502/`, `499/module/
  redraft-ac10/` (a video with its sound by ffmpeg), `306/` (shared documents and your patches).

What the base already does and these tests don't credit: #509's transcript job and rows, #1819's words record,
#501's export, #498's decode worker, #306's patch replies. There is no `cut.words@1` kind, no `cut.heard` row and no
`cut_*` planted program at the base.

## Run them

macOS with the repo's Node and the pinned Rust toolchain first on `PATH`:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                                                              # once, if node_modules is missing
npm run build --workspaces                                                          # every file: the helpers load packages/evidence's built patterns; heard and blocked run packages/cli/dist/main.js
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
cargo build --locked -p deep-hook                                                   # the hub won't start without it
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1518 <file> --testTimeout=3600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1518/tsconfig.json        # type-check (exits 0)
```

One file at a time: each builds `deep-show` (`--features full`, #501's `useShow`) once. Every `it` passes a
3,600,000 ms timeout: the speech host's first start builds the transcriber and fetches its weights.

- **Lanes.** The implementer adds these lines to `scripts/lanes.mjs` (this job writes only its folder):

  ```js
  // #1518's files each build deep-show; heard.test.ts and blocked.test.ts start a hub and deepbuild/speech's model host
  // on its fixed port 8720; heard and placement speak their take with macOS say; restore, sync and same make a video
  // with ffmpeg and export it; budget.test.ts times the cut expansion.
  alone.push('tests/acceptance/1518/');
  timed.push('tests/acceptance/1518/budget.test.ts');
  ```

- **Needs:** macOS `say` with the Samantha voice (`heard`, `placement`); `uv` and network for the speech host's first
  start (`heard`, `blocked`); ffmpeg with libx264 and its flac encoder (`restore`, `sync`, `same`); the built CLI and
  deep-hook for the hub files; `ps`.
- **Safety:** hub worlds are under `/tmp/dh1518-*`, other folders under `$TMPDIR`, all removed after their file. The hub
  and `deep mcp` run with `HOME` in the world's folder and without the caller's `DEEP_*`, `CLAUDE*`, `CODEX*`,
  `NODE_OPTIONS`; the model host runs with your `HOME` (its builds and weights cache there) and without `DEEP_*`. Every
  process is stopped by its PID (the host by the process group it leads, through #509's helpers); nothing is stopped by
  name or port. A host port already answering is BLOCKED and stops nothing. Nothing paid or remote is called.
- **The proof** (the issue's Proof line: the real recording with known words, the shifted case, `cut.heard` on the
  result, the planted recipes, the export's readings) is written to `$TMPDIR/deep-1518-proof/`, rewritten each run.

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a run that isn't
answered ok fails the test that drove it; a missing prerequisite fails with a line starting `BLOCKED:`, an unfit machine
with `INCONCLUSIVE:`.

## Criteria to tests

| AC | ID | File | Test, and the wrong program or plant it fails on |
|---|---|---|---|
| 1 | `#1518.1dbfdc9b` | `heard.test.ts` | The 60 s take with 12 marked cuts: `removed` the 12 words, 13 strips, 24 cuts; cut.heard's unrun PCM is the strips mixed alone (`media_mix`), 48 kHz, two channels, en; heard back by the real transcriber the row PASSes with no `cut.word_lost`/`cut.word_left` and the transcript equals the 69 kept words in order (`media_heard`). On the record shifted 150 ms the row PASSes with no `cut.word_lost`. **Planted `cut_on_raw_times`** on the shifted record: its cuts fall inside the kept words after each splice; the row FAILs and a `cut.word_lost` names one of them by index and text. Fails a recipe that cuts on stated times, a cut.heard that doesn't hear the strips or doesn't name the word |
| 2 | `#1518.d365703e` | `placement.test.ts` | On the true record and the shifted one, each of the 24 cuts: `raw` the record's edge, `at` its sample in flicks, within `search` of the raw point and between the words' middles, its 40 ms window's energy the least there, on a zero crossing, inside no kept word by the true times. **Planted `cut_on_raw_times`** fails the same judgment on the shifted record, its first failure naming cut 1 |
| 3 | `#1518.c2ae9106` | `restore.test.ts` | Your one patch setting the shared document's `keep` to add word 6: applies; `removed` loses only 6; word 6 played whole, every other word as before; the row byte for byte that of the restored list presented fresh; in that list's export, word 6's tone at its full 300 ms with its own frames in step; the recording's hash on every strip, in the patched revision and in the store before and after. Fails on the base (no kind) and on a patch that restores a part, another word, or a changed asset |
| 4 | `#1518.57df01e0` | `fragment.test.ts` | The 30 ms kept word between two removed words: listed in `fragments` with its text and a `why`, never played, `removed` [1, 3], the cuts either side joined as one splice. **Planted `cut_drops_fragments`** fails it, naming `fragments` |
| 5 | `#1518.3499b3ff` | `sync.test.ts` | The video cut at four words, exported and decoded (`media_decode`): five strips and five pictures; the twelve kept tones in order; at every tone's onset (the first after each splice among them) the frame shown is within one frame of the tone's source start. The **planted twin**, the recording with its picture three frames late, fails at every tone |
| 6 | `#1518.b19abf07` | `same.test.ts` | The video cut, in two fresh runs and again after another list's document in the same run: the row's strips, pictures, channels, removed, fragments and cuts byte for byte the same; five strips, five pictures, eight cuts; another list gives another row. Fails on the base and on any expansion that varies by run or order |
| 7 | `#1518.ef499157` | `blocked.test.ts` | With no transcript the cut.heard row is BLOCKED, the verdict not PASS, one `cut.heard_unrun` naming the document, `cut`, `narration.transcript`, whisper-cpp@1.9.5, 48 kHz, two channels, en, its PCM kept; with deepbuild/speech installed and its host stopped, the job is BLOCKED naming whisper-cpp@1.9.5 with no transcript, and the row stays BLOCKED. **Planted `cut_heard_passes_empty`** fails the same judgment |
| 8 | `#1518.bf377712` | `budget.test.ts` | 401 tone words, 200 left out: each fresh run's `timing.cut_ms` read (a 200-cut, 201-strip row); five after a warm-up judged against 100 ms by `judgeLimit`: PASS only on a reference Mac in a fit state, INCONCLUSIVE anywhere else. Fails on any machine when `timing.cut_ms` is missing |

## The surface under test

Names the issue and the design give are used as they give them; **every name marked *(chosen)* is this job's**, taken
from the design's words and shaped like the neighbouring surfaces. The implementer builds exactly these, or a dispute
goes to a blind redraft.

### Documents and calls (deep-show run)

- **The film** is #502's shape: `profile: film`, `transport {span, frame_rate, sample_rate: 48000}`,
  `requires: {modules: {media: "^1"}}`, one asset `rec` *(chosen name)* `{sha256, license (CC0, shareable), attached}`
  and one item `cut` *(chosen ID)* `{kind: "cut.words@1", params: {recording: "rec", keep}}`, `search` and `crossfade`
  left at the design's defaults (200 ms; 5 and 40 ms). A sound film is 64 × 64 at 24 fps with a camera and a block
  sliding (#509's film); a video film is the video's 160 × 90 at 30 fps and holds only the cut item. `keep` is written
  as inclusive `[first, last]` ranges and single indexes (design).
- **Calls:** #501's `deep show` from your shell (`include: ["issues"]`, or `["issues", "timing"]` for criterion 8);
  #509's scenario with the claim `claim:01JB509C…01` whose one deliverable is document a, and `verdict`; `media_mix`
  (#499: `{doc: {transport, strips}, segments: [{from: 0, to}]}`, its segment `sha256` the PCM's); `media_heard` (#509);
  `export {doc, out, video: {codec: h264}}` (#501, the sound the default PCM); `media_decode {path, out, format: bgra}`
  (#498: `decoded.streams`, the frames' `pts` and files, the sound's `first`, `channels` and file); your patch
  `{call: "deep show", peer, doc, patch: {patch, doc, base, reason, ops: [{op: set, id: "cut", path:
  "items/cut/params/keep", value}]}}` on a shared document stored at revision 0 in your layer (#306's form), whose reply
  carries the expansions of the revision it makes (#306); `read`.
- **The expansion's row** is the entry of `deep show`'s (or the patch reply's) `expansions` whose `instance` is `cut`
  (design: "the expansion's row in `deep show`'s `expansions`"). Read from it: `strips` (each `{track, src: {asset},
  start, in, out, fade_in, fade_out}` in flicks, a fade `{length, curve}` and none where the strip starts or ends at its
  source's own start or end; IDs `cut.s1`, `cut.s2`, … in order), `derived` (the pictures `cut.p<k>`), `channels`,
  `removed`, `fragments` (`{word, text, why}`) and `cuts` (`{word, side, raw, at, sample}`). A section given as a map by
  ID or as a list of entries each with `id` is read either way *(chosen)*.
- **`cut.words_unbaked`** is read as any object with that `code` in any reply of a run that presents a video recording
  with no words record and asks for a verdict, its `pcm_sha256`, `sample_rate` and `channels` on it or its `actual`
  *(chosen: where it sits, #509's reading)*; its PCM hash is the one the video's words record is written for.
- **`timing.cut_ms`**: a number in `deep show`'s reply's `timing` with `include: [timing]`.

### cut.heard (verdict)

- **The row** is the one with `from: {default: "cut.heard"}` (design), read with #509's `rowFrom`; `result` BLOCKED,
  PASS or FAIL. **The unrun entry** is any object in the row with `code: cut.heard_unrun`, its fields (`doc`, `item`,
  `job`, `analyzer`, `pcm_sha256`, `sample_rate`, `channels`, `locale`) on it or its `actual` *(chosen, #509's)*.
  **Issues** are #407's (`code`, `severity: error`), `cut.word_lost` and `cut.word_left` with `word` (index) and `text`
  on them or their `actual`.
- **The transcriber:** deepbuild/speech installed with its host started by #509's `withPlugin` (`uv run --script
  packages/jobs/speech/host/host.py --port 8720`); deep_job `{op: run, kind: narration.transcript, tool:
  whisper-cpp@1.9.5, params: {sample_rate, channels, locale, names: []}, inputs: [{name: pcm, sha256}]}` by #509's
  `transcribe`; the record listed after the words record in `assets.rec.attached`. The scenario's `evidence` is the
  hub's store (#509's one-store reading).

### Planted programs

| Name | Selected by | The wrong program | Criterion | Read as failed when |
|---|---|---|---|---|
| `cut_on_raw_times` | scenario `planted` (design) | a recipe that skips the move and cuts at each raw point | 1, 2 | 1: its row PASSes, or no `cut.word_lost` names a word its cuts fell inside; 2: the judgment finds nothing, or its first failure isn't cut 1 |
| `cut_drops_fragments` | scenario `planted` (design) | drops the fragment and lists nothing | 4 | `fragments` lists the 30 ms word |
| `cut_heard_passes_empty` | scenario `planted` (design) | reads a missing transcript as an empty one and fails no lost word | 7 | the row is BLOCKED with its unrun entry |
| the late twin | the fixture | the video recording with each frame showing the number three frames before its own | 5 | the in-step judgment passes any tone |
| another list | the fixture | the video cut by `[[0, 7], [9, 15]]` | 6 | its row equals the other's |

## Fixtures

Nothing but code and this README is committed. Every sound, picture and record is made at run time; no model output,
recording or personal data is in the repository.

- **The 60 s take** (criteria 1, 2): twelve sentences, 81 words ("We heard the [loud] train arrive", … "The store raised
  the [weekly] price again"), each word spoken alone by #1819's `say -v Samantha` at 48 kHz, cut at −50 dBFS, laid at
  gain 0.5 with 120 ms of digital silence between the words of a sentence and an even pause between sentences (about
  1.5 s on macOS 27), so the take is 60 s exactly; a sample `say` wrote as exactly 0 inside a word is lifted to 1e-6, so
  the gaps are its only digital silence. The bracketed word of each sentence is left out: twelve marked cuts. Its words
  record (`bake.words`, charsiu-aligner@1.0.0, weights [], the PCM's hash, a 10 ms frame, words in flicks) is written
  from where each word was put; the shifted record states every start and end 150 ms later *(chosen direction)*.
- **Feasibility, checked once by hand** on this Mac, none of it committed and no expected value taken from it: `say`
  speaks the 81 words in 33.5 s (300 to 620 ms each), no word holds a run of exact zeros and every 40 ms window inside a
  word holds energy, so the sentence pause is about 1.5 s; a scratch placement written to the design's rule passes
  `placementFailures` on both records, and cuts at the raw points fail it on the shifted record from cut 1 (59 failures;
  15 on the true record); ffmpeg reads the video fixture back as written (every frame's number, the sound within one
  16-bit step), and so does #498's decode worker at the base (`media_decode`: 300 BGRA frames numbered 0 to 299, 480,000
  samples from 0); the fragment take's windows inside the bounds of cedar's cuts all hold 480.
- **Tone words** (criteria 7, 8): 200 ms sine bursts at amplitude 0.5 with 2 ms raised-cosine ends, 100 ms apart, from
  0.5 s; six for criterion 7 (word 2 left out), 401 for criterion 8 (every odd word left out).
- **The fragment take** (criterion 4): a 500 Hz square wave at ±0.5: ash (300 ms, kept), 120 ms silence, birch (300 ms,
  removed), cedar (30 ms, kept), dogwood (300 ms, removed), 120 ms silence, elm (300 ms, kept). Birch, cedar and dogwood
  are one wave with sign changes on cedar's edges; every 40 ms window inside the bounds of cedar's cuts holds only ±0.5,
  so by the design's rule both cuts stay on cedar's edges, 30 ms apart, under half its two 40 ms crossfades.
- **The video recording** (criteria 3, 5, 6): ffmpeg makes 10 s at 160 × 90, 30 fps, libx264 (QP 10, no B-frames), its
  sound 16-bit FLAC, one MP4. Frame k shows k in binary in ten 16 px columns (top half white for a set bit, bottom half
  black, and the other way for a clear one). The sound is sixteen 300 ms tones in silence, word w at 300 + 70w Hz from
  1 s + 0.5w s + half a frame. Its words record is written, from those starts, for the PCM `cut.words_unbaked` names.
  The twin shows k − 3 on frame k. The export is read back from its own sound (onsets above 0.05 after 50 ms below
  0.01, the tone by its frequency) and picture (a column's bit where its halves differ by more than 80 of 255).

## Readings where the issue and the design leave a choice

- **"12 marked cuts"** and **"200 cuts"**: a marked cut is a word left out between two kept ones, one splice, so 12 (or
  200) splices, each an `out` cut after the word before it and an `in` cut before the word after it *(chosen)*.
- **"Heard-back words equal the kept words in order"**: the cut.heard row PASSes, and the transcript and the kept words
  are equal after normalizer@1 (`media_heard` matches). **The fixture's own truth** is read before any cut result is
  heard: the transcriber must hear the uncut take as its 81 words, else the test is BLOCKED, never FAIL *(chosen)*. The
  checks that need no transcriber (the rows, the first verdicts, the mixed PCM) run before the speech host starts.
- **"Loses a syllable … fails naming the word"**: the planted row's own `cuts` fall strictly inside kept words by the
  true times; some `cut.word_lost` names one of those words by index and text *(chosen)*.
- **"In a local energy minimum within `search`"**: within 200 ms of the raw point and between the middles of the words
  either side by the record (design), its window's energy within 0.1% of that range's span above its least *(chosen
  tolerance, for a window centred one sample either way)*. **"On a zero crossing"**: the mean is 0 there or its sign
  (0 counted as a sign of its own) differs from the sample before. **"Inside no kept word"**: no kept word's true
  `start < sample < end`. **"Naming the first cut"**: the judgment's first failure names cut 1, the cuts numbered in the
  source's order *(chosen)*.
- **"By one patch"**: one patch of one `set` op on `items/cut/params/keep`, yours, on a shared document *(chosen)*.
  **"Restores exactly that word's audio and picture"**: word 6 is played whole and no other word's play changes; the
  patched row equals the restored list presented fresh; and in that list's export word 6's tone plays its full 300 ms
  while the picture shows its own source frames, in step *(chosen)*. **"The source asset's hash never changes"**: the
  strips play it by its SHA-256, the patched revision names it, and the store's file hashes to it before and after.
- **"A kept fragment of 30 ms between two cuts"**: a 30 ms kept word whose two cuts, placed by the design's rule, lie on
  its edges *(chosen fixture)*; `why` is any non-empty text.
- **"Within one frame, read from the export's own audio and video"**: at each tone's onset in the delivered sound, the
  frame the delivered picture shows holds a source frame whose span lies within one frame of the tone's source start,
  a tenth of a frame given for reading the onset *(chosen)*.
- **"Byte-identical strips"**: the row's `strips`, `derived` (a derived item's `layer` left out), `channels`, `removed`,
  `fragments` and `cuts`, as the reply's JSON text *(chosen)*.
- **"With the transcriber missing"**: no transcript record of the cut result, and deepbuild/speech installed with its
  model host stopped so its job can't run *(chosen)*.
- **The budget**: five fresh `deep-show` runs after a warm-up, each one `deep show` of the 200-cut film with
  `include: [timing]`, judged by `judgeLimit` against 100 ms with the load at each run's start and end *(chosen)*; no
  merge-base comparison, which the criterion doesn't ask for.

## Legs that read BLOCKED or INCONCLUSIVE

- `budget.test.ts` is **INCONCLUSIVE** anywhere but a reference Mac on mains power, Low Power Mode off, thermal state
  nominal and unloaded (`judgeLimit`); it still fails anywhere when `timing.cut_ms` is missing.
- `heard.test.ts` is **BLOCKED** when the transcriber doesn't hear the uncut take as its words, or `say` can't fit the
  81 words in 60 s with 0.3 s between sentences; `heard` and `blocked` are BLOCKED when `uv` is missing, port 8720
  already answers, the host exits or takes over 60 minutes, or the CLI isn't built; any `say` file is BLOCKED when
  `say -v Samantha` can't speak; `restore`, `sync` and `same` are BLOCKED without ffmpeg's libx264 and flac.
- None reads BLOCKED by design on a set-up Mac.

## What isn't settled

- The *(chosen)* names and readings above: the asset and item IDs, where `cut.words_unbaked` and `cut.heard_unrun` sit,
  the map-or-list sections, the shift's direction, the judgments' tolerances.
- The transcriber's reading of this take was not run here: the clean legs need it to hear the uncut and the cut take
  word for word (else BLOCKED), and the planted leg needs it to mishear at least one of the twelve words cut 150 ms into.
- Whether `read` and a patch's reply carry a module kind's expansion: #306's patch reply does for recipes, and this
  suite reads the patch reply's; the design names the patch as the way a word comes back.
- `cut.words_unbaked` may refuse the presentation or only block the claim; any reply of the run is read.
- `crossfade.min` (5 ms) and `cut.keep_range` are not exercised: no criterion names them.
- No other suite was run; the base was run only as BASE-FAILURE.txt says.
