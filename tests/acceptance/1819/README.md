# Acceptance tests for #1819: model analysis bakes, each recorded once by hash

Words by a pinned aligner, beats by a pinned tracker, speech activity and visemes. Written first, blind, from issue
#1819 (as of Nov 10, 2026: its Scope, its five acceptance criteria and its Proof line), its Oracle page, the design
sections it links and those they lean on, and the base commit `990d4af8` (`990d4af871a73cd47bdc4508117cae570abc535f`,
"design(#1819): the model kinds of the analysis bake: job kinds on pinned tools, the record, how a bake reads it,
tempo, spans and visemes"), by a job that never saw an implementation; none exists at the base, and no other worktree,
branch or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind
redraft of this job (design: Dogfooding).

## What was read

- The issue (`gh issue view 1819`). Each test's name starts with its criterion's ID, `#1819.` and the first 8 hex
  digits of SHA-256 of the checkbox's text after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`'s
  `criterionId`).
- The Oracle page (`doneright/oracles/issues/1819.md`, DeepBuildAI/deepbuild, branch `doneright`): no upstream test
  checks any criterion; all five are ours, "proven by our own fixture and its planted wrong twin".
- `docs/canvas-primitives.md` at the base: Analysis bake (all of it: the fields; the model kinds as job kinds of
  `deepbuild/bakes` in `packages/jobs/bakes`, `bake.words` on `charsiu-aligner@1.0.0`, `bake.beats` on
  `beat-this@1.1.0`, `bake.activity` on `silero-vad@6.2.3`; the host's run line and port 8719; the job's input `pcm`,
  interleaved f32 little-endian, with `sample_rate` and `channels` in its params, and `text` for `bake.words`; the key;
  the record and its fields; `media_bake` with a model kind naming its `analyzer` and the `record` by hash, its
  refusal, its BLOCKED; a job that can't start BLOCKED with one unblock ask naming the analyzer; the tempo, span and
  viseme rules and `arpabet.visemes@1`), Narration and captions, the occurrence kinds (`viseme {shape: A to H | X,
  line}`), Time and the flick, and the Analysis kinds row of Registries and closed lists.
- `docs/technical-design.md`: Spawn and analysis bake; the Job row (`deep_job`); Runner; Dogfooding. `AGENTS.md`.
- At the base, for surfaces and conventions only: `crates/deep-show/src/bake.rs` (`media_bake`'s signal kinds and its
  reply; an analyzer other than `<kind>@1` answers `unknown_analyzer`), `mixdown.rs` (the decoded PCM, its hash over
  f32 LE), `evidence.rs` (`<2 hex>/<62 hex>`), `main.rs` (the scenario's `planted`); `crates/deep-codecs/src/wav.rs`
  (IEEE float samples kept as they are); `packages/hub/src/jobs.ts` (deep_job: inputs by `sha256`, tools that run on a
  host under the store's origin rule, weights by hash, BLOCKED with a `job.unblock` ask, receipts, the cache by key),
  `core.ts` (deep_job's store: read, has and send are the hub's evidence store's), `canvas.ts` (the canvas core keeps
  its files in the hub's evidence store), `paths.ts`, `plant.ts`; `packages/evidence/src/index.ts` (the journal, the
  peers, `send`); `packages/extension-host/src/job-kinds.ts`; `scripts/lanes.mjs` (`alone`). The suites
  `tests/acceptance/500/bake/` (`deep-show run`, `media_bake`, plants named in the scenario), `1922/` and `1924/` (a
  real hub, `deep install`, `deep mcp` and deep_job, asks and your yes, `DEEP_HUB_PLANT`, a store seeded through its
  public entry), `532/` (rustup's cargo on PATH) and `1818/`.

What the base already does and these tests don't credit: #500's `media_bake` (loudness, onsets, envelope, with the
PCM's hash); #1922's deep_job; #1924's tools on a host, their weight files by hash, and BLOCKED for a host's weight file
that differs. There is no `packages/jobs/bakes`, no model kind in `media_bake`, and no visemes bake.

## Run them

```sh
npm ci                                           # once
npm run build --workspaces                       # the tests run packages/cli/dist/main.js
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook    # the hub won't start without it
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run tests/acceptance/1819/<file> --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1819/tsconfig.json   # type-check
```

- **One at a time:** each test starts its own hub and the model host on the fixed port 8719, and each file builds
  `deep-show` (`cargo build --locked --bin deep-show`, honoring `CARGO_TARGET_DIR`), so the implementer adds
  `alone.push('tests/acceptance/1819/')` to `scripts/lanes.mjs` (not done here: this job writes tests only). Another
  worktree's model host on 8719 can't be told apart from this suite's, so a test that finds something already answering
  there fails with a line starting `BLOCKED:` and stops nothing.
- **Time:** every test passes its own one-hour timeout: the model host's first start installs its packages through
  `uv` and fetches its pinned weights; after that a file should take minutes (an estimate; no implementation exists).
- **Needs:** macOS `say` with the Samantha voice, `uv`, `ps`, and network for the model host's first start only.
- **Safety:** every folder is under `/tmp/dh1819-*` and removed after its file; the hub, `deep` commands and `deep
  mcp` run with `HOME` in the world's temp folder and without the caller's `DEEP_*`, `CLAUDE*`, `CODEX*`,
  `NODE_OPTIONS`; the model host runs with your `HOME` (its weights are cached there) and without `DEEP_*`. Every
  process this suite starts is stopped by its PID, the model host by the process group it leads; nothing is stopped by
  name or port. No paid or remote model is called.
- **The proof** (the issue's Proof line: the line's word times, the two tempos, the spans, the viseme list, the cache
  hit and each planted program's failure) is written to `$TMPDIR/deep-1819-proof/`, rewritten each run.

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field, and a scenario
that isn't answered ok, a job that isn't done, or an install that is refused fails the test that drove it.

## The fixtures: truth by construction

All are made by the tests at run time (`fixtures/synth.ts`), so nothing is fetched or committed (the largest, each
30 s click track, is 5.8 MB). Each is one channel of 32-bit float samples, so its decoded PCM is its samples
(`deep-codecs` keeps IEEE floats as they are): the test knows the PCM's bytes and hash before any bake does, and holds
`media_bake`'s to them. No analyzer sets any truth: every time is where the test put the samples.

- **The line** (AC1, AC4): "seven shiny silver salmon swim slowly so many sunny mornings mellow summer seas mostly
  shimmer near sunset", 10 s at 16 kHz. Each word is spoken alone by `say -v Samantha`, cut to the samples between its
  first and last above −50 dBFS, and the cuts are laid end to end, centred in the 10 s (about 1 s of silence on each
  side). A word's known start is the sample its cut begins at, which is where the word before it ends. Every word
  starts with s, sh, m or n after a word that ends on another sound, so each junction is a change of sound.
- **Three phrases under music** (AC3): "many lions sang near our mill", "summer evenings rolled on slowly" and "morning
  rain fell on the lawn", each spoken by `say -v Samantha` and cut where it rises above and falls below −40 dBFS (5 ms
  fades inside the cut), laid from 1 s with 1 s between them, over a chord pad (Am F C G, 2.5 s each, sines with two
  harmonics and a bass) at −35 dBFS RMS for the whole length, 16 kHz. A span's known edges are its cut's first sample
  and one past its last. The length is a whole number of 512-sample frames, so a model's frames read forward and
  backward fall on the same samples; the silence after the last phrase is 1 s to 1.032 s.
- **Click tracks** (AC2): 30 s at 48 kHz, a click every 0.6 s (100 BPM) and every 0.625 s (96 BPM) from 0.5 s, each on a
  whole sample (28,800 and 30,000 samples apart): 20 ms of a decaying sine (2 kHz and louder on every fourth click,
  1.2 kHz otherwise) over 1 ms of seeded noise.
- `say`'s voice may sound different on another macOS release; the truth comes from the audio made, so it holds there.

**Feasibility, checked once by hand** (throwaway scripts, not kept and not part of the suite) against the open models
the design pins, run outside DeepBuild as their own packages run them. These numbers are this job's, not expected
values; the tests hold the bakes to the issue's 50 ms and 0.5 BPM.

- silero-vad 6.2.3 (PyPI), with the design's rule (the mean of the forward and backward probability at least 0.5 on
  512-sample frames, runs under 0.3 s apart joined, under 0.1 s dropped): three spans, edges 2 to 31 ms from the
  fixture's. The music's speech probability stayed under 0.12.
- beat-this 1.1.0 (PyPI, checkpoint `final0`, no DBN) with the design's tempo rule: 99.99 and 95.94 BPM.
- Charsiu's `charsiu/en_w2v2_fc_10ms` forced aligner (`lingjzhu/charsiu` at `13a69f2`), its words matched in order:
  every start 4 to 38 ms early, the first word (after the silence) the most. A first draft of the line with about
  0.22 s of silence between words had it 30 to 55 ms early at every word that follows a silence, so the words abut, as
  in a spoken line.

## The surface under test

Names the design gives are used as it gives them; names it doesn't are marked *(chosen)*.

1. **One evidence store.** `deep-show run`'s scenario `evidence` folder is the hub's evidence store,
   `<home>/.deepbuild/evidence` *(chosen: the design has `media_bake` keep "the PCM by that hash for the job" and the
   job keep its record by hash for the bake to read; the hub's canvas core already keeps its files there)*. So the
   PCM a `deep-show run` keeps there while the hub runs must be one deep_job takes by hash and its tool's host gets
   (the store's `send` knows only files in its journal at the base).
2. **The fixture's files** (the audio and the line's text) are put in that store before the hub starts, through
   `@deepbuild/evidence`'s public entry, as a writer connected as you dropping files (`{role: "you", via: "drop"}`,
   kind `file`, redaction `complete`) *(chosen: the base has no other way for your file to be in the store by hash
   with its origin; #1924's suite seeds a render the same way)*.
3. **`media_bake`** (#500's call in `deep-show run`: `{"evidence", "planted"?, "calls": [{"call": "media_bake",
   "bake": Bake}]}`, one answer line `{"ok": true, "replies": [...]}`), Bake's fields siblings of `kind` as #500's:
   - words: `{asset, kind: "words", analyzer: "charsiu-aligner@1.0.0", source: "aligner", record?}`
   - beats: `{asset, kind: "beats", analyzer: "beat-this@1.1.0", record?}`
   - activity: `{asset, kind: "activity", analyzer: "silero-vad@6.2.3", threshold: 0.5, record?}`
   - visemes: `{asset, kind: "visemes", analyzer: "charsiu-aligner@1.0.0", source: "aligner", map:
     "arpabet.visemes@1", lead: "1f", rate: 24, lines: [{line, at, words: <record>}]}` *(chosen: a visemes bake's
     analyzer is the aligner of its words, and its `asset` the lines' audio)*
   - `model` is left out of every kind *(chosen: the design gives it as an id with a weights hash, the plug-in's to
     know)*, and `tempo_range` takes its default.

   Replies *(chosen where the design gives no shape)*:
   - **No record:** BLOCKED. The reply's JSON holds the word BLOCKED (any case), the analyzer and the PCM's 64-hex
     hash, and no readings; and the store holds the PCM's bytes under that hash.
   - **A record:** `{"bake": {asset, kind, analyzer, ...readings}}`, as #500's: the asset, kind and analyzer asked,
     and the readings the design names, in flicks: `words [{text, start, end, phonemes [{p, start, end}]}]`; `beats`
     and `tempo` (BPM); `spans [{start, end}]`; `visemes [{t, shape, line}]` in time order, in document time (a line's
     `at` plus the record's time).
   - **A record of another analyzer:** a reply with no `bake.words` whose JSON names the analyzer asked for and the
     record's.
4. **deep_job** (#1922's tool through `deep mcp`, which binds no session): `{op: "run", kind, tool: <the analyzer>,
   params: "{\"sample_rate\":<Hz>,\"channels\":1}", inputs: [{name: "pcm", sha256}]}`, plus `{name: "text", sha256}`
   for `bake.words`. Done is `{status: "done", outputs: {bake: {sha256}}, receipt: {key, cache: "miss" | "hit"}}`, the
   record a JSON object in the store under that hash. BLOCKED is `status` BLOCKED (any case) naming the analyzer, with
   `ask`, which the record shows as an `ask.created` of kind `unblock`. A reply held on an ask (#1924's origin rule)
   gets your yes (`deep inbox answer <ask> <its allow option>`) and the call is made again, at most five times
   *(chosen: no criterion reads such an ask, and the files are yours or DeepBuild's, so none is expected)*.
5. **The plug-in and its host.** The model host is started by the test from the checkout with the design's run line,
   `uv run --script packages/jobs/bakes/host/host.py --port 8719`, and is ready when 127.0.0.1:8719 accepts a
   connection; then `deep install packages/jobs/bakes`, as you (the OS confirmation stubbed by
   `DEEP_HUB_TEST_CONFIRM`), must exit 0, its tools qualifying on the host. Each test needs its PCM first, so its
   first `media_bake` runs before the host starts.

### Planted programs

| Name | Selected by | The wrong program | Criterion | Read as failed when |
|---|---|---|---|---|
| the planted cache | the test itself | hands `media_bake`, asked for the words under `charsiu-aligner@1.0.1`, the record `charsiu-aligner@1.0.0` made | AC1 | it is answered with words: it must be refused, naming both analyzers |
| `beats_fixed_120` | `deep-show run`'s `planted` | the beats bake answers beats 0.5 s apart and tempo 120 whatever its record holds: a tracker that returns a fixed 120 BPM | AC2 | it reads 120 ± 0.5 on both tracks and the judge fails each, naming its asset |
| `activity_level_threshold` | `deep-show run`'s `planted` | a frame is speech when its RMS over the asset's channels is at least −50 dBFS, read from the PCM instead of the record's probabilities, with the design's frames, joins and drops | AC3 | at least 1 s of its spans lies where the fixture has only music, and the judge's first failure names a span |
| `visemes_no_lead` | `deep-show run`'s `planted` | each shape starts at its phoneme's start, with no lead | AC4 | the judge's first failure names the first shape |
| `job-host-down-done` | `DEEP_HUB_PLANT` | a job whose tool's host doesn't answer is done, each output it declares an empty record (`{}`) kept by hash, with no ask | AC5 | the judge fails, first with "must be BLOCKED naming silero-vad@6.2.3", every failure naming the analyzer |

- **AC1's planted cache is played by the test** *(chosen)*: the design pins one aligner version, and a second one
  would take a product surface it doesn't name (an upgraded plug-in, or a test tool that could only pass the kind's
  qualification by running the real model). The test hands `media_bake` the old record under a new version, which is
  what such a cache returns; the clean program refuses it. A bake that reads a record whatever its analyzer answers
  words and fails the test.
- **AC2's plant sits in the bake, not on the host** *(chosen)*: a tracker planted on the host would fail the
  plug-in's qualification at install, and the hub's cache would serve the clean record for the same key. The judge
  reads only the tempo answered, so a bake answering 120 is the same wrong program to it.

## Criteria to tests

| AC | ID | File | Test, and the wrong program it fails on |
|---|---|---|---|
| AC1 | `#1819.d6311ec9` | `words.test.ts` | the line's 17 words in order, each start within 50 ms of its known start; the job's rerun is `cache: hit` with the same record hash and key; the planted cache's record under `charsiu-aligner@1.0.1` is refused, naming both analyzers, with no words |
| AC2 | `#1819.1e90e26a` | `beats.test.ts` | the 100 and 96 BPM tracks read 100 ± 0.5 and 96 ± 0.5; `beats_fixed_120` reads 120 and fails each, naming its asset |
| AC3 | `#1819.78820a4a` | `activity.test.ts` | three spans, each edge within 50 ms of its phrase's; `activity_level_threshold` marks the music as speech and fails, naming a span |
| AC4 | `#1819.9d92b582` | `visemes.test.ts` | two lines, `l1` at 0 and `l2` at 12 s, from the line's words record: each shape one frame (1/24 s) before its phoneme within 1 ms, mapped by `arpabet.visemes@1`; X at each line's last phoneme's end and no shape before the next line's first; `visemes_no_lead` fails, naming the first shape |
| AC5 | `#1819.faf43058` | `blocked.test.ts` | the activity bake's job with the host stopped after install: BLOCKED twice on one ask, naming `silero-vad@6.2.3`, no record, one unblock ask naming it, and the bake still BLOCKED naming it with no readings; `job-host-down-done` fails, naming the analyzer |

## What the implementer must add

- `alone.push('tests/acceptance/1819/')` in `scripts/lanes.mjs`.
- The plants: `beats_fixed_120`, `activity_level_threshold` and `visemes_no_lead`, named in `deep-show run`'s
  `planted` (as `deep_canvas_media::PLANTED`'s are); `job-host-down-done` in `packages/hub/src/plant.ts`.
- The surfaces as above: `packages/jobs/bakes` (its `deepbuild.json`, the three kinds and their tools, and
  `host/host.py` runnable by `uv run --script`), `media_bake`'s model kinds and visemes bake with the fields and replies
  above, and deep_job taking, by hash, a PCM a `deep-show run` kept in the hub's evidence store.

## Readings where the issue and the design leave a choice

- **"Within 50 ms"** (AC1, AC3): |the bake's time − the known time| ≤ 50 ms, in flicks. AC1 matches the bake's words
  to the line's in order, by their letters lower-cased; AC3 matches spans to phrases in order.
- **"A rerun is a cache hit with the same hash"** (AC1): the same deep_job run again answers `cache: hit` with the same
  record hash and key.
- **"Reads 100 ± 0.5 BPM"** (AC2): the bake's `tempo`; its `beats` aren't judged.
- **"One frame before its phoneme"** (AC4): one frame at the bake's `rate`, 24 Hz (the design's default, and the lead
  "1f"), so t = the line's `at` + the phoneme's start − 1/24 s, within 1 ms. A run of phonemes that map to one shape may
  show it once, from the run's first phoneme, or once per phoneme. "Holds X between lines": an X within a frame of
  each line's last phoneme's end, and no other shape before the next line's first; an X anywhere else isn't read.
- **"Can't start"** (AC5): its host doesn't answer: the host is stopped after the install. **"Never PASS"**: the job is
  never done and makes no record, and the bake stays BLOCKED with no readings.
- **"Naming"**: the failure's words hold the asset's hash (AC2), the span's number and times (AC3), the shape's
  number, letter and time (AC4), or the analyzer's `id@version` (AC1's refusal, AC5).

## Not tested, and why

- A record of another kind or PCM refused; other weights running again; the model kinds' re-check "to within one model
  frame"; the visemes bake from `tts_marks`: in the Scope or the design, but no criterion reads them.
- A host lacking a weight file (the other way a job can't start): this suite can't take a file from the implementer's
  host; #1924's suite reads the hub's side of it.
- The words' ends and phoneme times (AC4 reads the phonemes as the record holds them), and where the beats fall.
- Narration, captions, ducking and the rig's lipsync, which read these bakes in later issues.

## Not settled

- **The shared store** (surface 1) is this job's reading; if the implementation keeps the PCM somewhere the hub can
  reach by another named surface, that is a dispute for the redraft, not an edit here.
- **Charsiu's early starts**: the check above had it 38 ms early on the first word, inside the 50 ms; a wrapper that
  shifts its times later, or another checkpoint, changes that margin.
- **Port 8719** is shared by every worktree on this Mac (the manifest names it), so two runs of this suite, or of the
  implementation's own tests, can't overlap.
