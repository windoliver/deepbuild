# Acceptance test for #1518, criterion 1: a recording cut by its words and heard back (blind redraft)

`AC1 #1518.1dbfdc9b`: "A 60 s recording with 12 marked cuts expands to strips whose heard-back words equal the kept
words in order. The same list on a fixture whose times are shifted by 150 ms still gives every kept word. A planted
recipe that cuts on the raw times there loses a syllable, and `cut.heard` fails naming the word". The issue's other
criteria are tested in `tests/acceptance/1518/`.

This is a blind redraft of one criterion's test, by a job that never saw an implementation, a diff or a session. It was
written from the issue (read live, Nov 19, 2026), the design and the base commit `9c916d5a1` ("test(#1518): acceptance
tests for cut.words@1, written first and blind"), on top of the design commit `d19559622`; no #1518 code exists there.
No other worktree, branch, stash or pull request was read. The brief gave one fact of the base, used below: the pinned
transcriber heard the first draft's 60 s take as all its 81 words in order and then "you" at the end. The implementing
agent doesn't edit these files (AGENTS.md, Proof). If this draft also fails on the work, the test stands; otherwise the
dispute goes to the owner once, with both drafts and the failing output (design: Dogfooding).

## What was read

- The issue, live (`gh issue view 1518 --repo windoliver/deepbuild`); the criterion's ID is `#1518.` and the first 8 hex
  digits of SHA-256 of the checkbox text after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`).
- `AGENTS.md`; `docs/technical-design.md`: How we know version 0 works (Dogfooding).
- `docs/canvas-primitives.md` at the base: Strip and track (its `cut.words@1` field line, its Semantics and "As built
  (#1518)": the item, the placement rule, the strips, the row in `deep show`'s `expansions`, the default row
  `<claim>#cut.heard` with `cut.heard_unrun`, `cut.word_lost`, `cut.word_left`, the planted `cut_on_raw_times`);
  Narration: speech engines (As built #509); Check input: `narration.transcript@1` (As built #509: the job, its record,
  `media_heard`, normalizer@1).
- At the base, for surfaces and harness only: the first draft `tests/acceptance/1518/` (README, `helpers.ts`,
  `heard.test.ts`, `BASE-FAILURE.txt`, `tsconfig.json`); `tests/acceptance/509/helpers.ts`,
  `tests/acceptance/501/helpers.ts`, `tests/acceptance/1819/fixtures/synth.ts`; `packages/jobs/speech/host/host.py`
  (the transcription step pads every take with 0.6 s of silence at each end); `packages/hub/src/jobs.ts` (deep_job
  reads an input by its hash from the store's folder); `packages/evidence/src/` (its built patterns, and retention that
  reads only indexed entries); `crates/deep-show/src/main.rs` (the scenario's `planted`);
  `crates/deep-show/src/packs.rs`, `crates/deep-canvas/src/document/packs.rs` and `expands.rs` (an expansion row's
  `instance` and its sections); `scripts/lanes.mjs`, `scripts/lease`, `scripts/public-text.mjs`,
  `scripts/studied-names.mjs`; `tests/acceptance/503-redraft-ac1/README.md` (a redraft's README).

## Run it

macOS with the repo's Node and the pinned Rust toolchain first on `PATH`:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                       # once, if node_modules is missing
npm run build --workspaces                   # the hub runs packages/cli/dist/main.js; #509's helpers load packages/evidence's built patterns
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
cargo build --locked -p deep-hook            # the hub won't start without it
node node_modules/vitest/vitest.mjs run --root tests/acceptance/1518-redraft-ac1 heard.test.ts --testTimeout=3600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/1518-redraft-ac1/tsconfig.json   # type-check (exits 0)
```

At the base `npm run build --workspaces` exits 2 on a TypeScript error in packages/hub that isn't this issue's, and still
writes the JavaScript the run needs. The file builds `deep-show` (`--features full`, #501's `useShow`) once; its one
`it` passes a 3,600,000 ms timeout, since the speech host's first start builds the transcriber and fetches its weights.

- **Lanes.** The implementer adds these lines to `scripts/lanes.mjs` (this job writes only its folder):

  ```js
  // #1518's AC1 blind redraft builds deep-show, speaks its take with macOS say, and starts a hub and deepbuild/speech's
  // model host on its fixed port 8720: one file at a time.
  alone.push('tests/acceptance/1518-redraft-ac1/');
  ```

- **Needs:** macOS `say` with the Samantha voice; `uv`, and the network for the speech host's first start; the built
  CLI and deep-hook; port 8720 free.
- **Safety:** the hub world is under `/tmp/dh1518r-*`, the build and the `say` files under `$TMPDIR`, all removed after
  the file. The hub and `deep mcp` run with `HOME` in the world's folder and without the caller's `DEEP_*`, `CLAUDE*`,
  `CODEX*`, `GIT_*`, `NODE_OPTIONS`; the model host runs with your `HOME` (its builds and weights cache there) and
  without `DEEP_*`. Every process is stopped by its PID (the host by the process group it leads, through #509's
  helpers); nothing is stopped by name or port. A host port already answering is BLOCKED and stops nothing. Nothing
  paid or remote is called.
- **The proof** (the issue's Proof line, for this criterion) is written to `$TMPDIR/deep-1518-redraft-ac1-proof/`,
  rewritten each run: `source.json`, the uncut recording as heard and read, written before the fixture's check; and
  `heard.json`, each cut's strips, mixed PCM's hash, unrun entry, transcript, this job's reading of it and its
  cut.heard row, and the kept words the planted strips cut into.

Nothing missing passes (invariant 2): a reply without a field the test reads fails naming the field; a run that isn't
answered ok fails the test; a precondition that isn't the criterion fails with a line starting `BLOCKED:`.

## Criterion to test

One test in `heard.test.ts`, `#1518.1dbfdc9b the strips are heard back as the kept words in order; …`:

| Clause | Passes when | The wrong program it fails |
|---|---|---|
| "A 60 s recording with 12 marked cuts expands to strips whose heard-back words equal the kept words in order" | On the true record: the row's `removed` is the 12 marked words and its 13 strips play the recording by its SHA-256; the first verdict's `cut.heard` row is BLOCKED with one `cut.heard_unrun` naming `narration.transcript` on whisper-cpp@1.9.5 for the strips mixed alone (`media_mix`), 48 kHz, two channels, `en`. Heard back by the real transcriber, the row PASSes with no `cut.word_lost` or `cut.word_left`, and this job's reading of the transcript finds the 69 kept words in order and no word of the recording over | A recipe that loses or damages a kept word or plays a removed one; a `cut.heard` that hears anything but the strips |
| "The same list on a fixture whose times are shifted by 150 ms still gives every kept word" | The same keep list on the record stating every word 150 ms late: heard back, the row is judged (PASS or FAIL), names no `cut.word_lost`, and this job's reading finds every kept word in order | A recipe that cuts where the record says, such as `cut_on_raw_times` |
| "A planted recipe that cuts on the raw times there loses a syllable, and `cut.heard` fails naming the word" | With the scenario's `planted: "cut_on_raw_times"` on the shifted record: its strips leave part of some kept word's true samples unplayed; heard back, the row FAILs, this job's reading finds a kept word missing, and a `cut.word_lost` names one of the words its strips cut into, by its index and text | A `cut.heard` that passes the planted recipe, or fails it without naming a word it cut into |

First of all, the test checks this job's reading on four made-up lines whose outcome the reading states: a word that was
never in the recording is set aside; a kept word heard as another, a removed word heard and words out of order are not.

## The surface under test

Names the issue and the design give are used as they give them; the rest are the first draft's, reused by import so
the two drafts present the same documents.

- **The film** is the first draft's `soundFilm` (#502's shape): `profile: film`, 64 × 64 at 24 fps, `sample_rate:
  48000`, `requires: {modules: {media: "^1"}}`, one asset `rec` `{sha256, license (CC0, shareable), attached: [the
  words record]}` and one item `cut` `{kind: "cut.words@1", params: {recording: "rec", keep}}`, `search` and `crossfade`
  left at the design's defaults (200 ms; 5 and 40 ms), `keep` written as inclusive `[first, last]` ranges.
- **Calls:** #509's scenario, in which you present the film with `deep show` (`include: ["issues"]`) and the claim
  `claim:01JB509C…01`, whose one deliverable is the film, gets a `verdict`; `media_mix` (`{doc: {transport, strips},
  segments: [{from: 0, to}]}`, its segment `sha256` the PCM's); `media_heard` (#509), for normalizer@1's tokens of the
  take's text and of each transcript.
- **The expansion's row** is the entry of the presentation's `expansions` whose `instance` is `cut` (design). Only its
  `strips` (`{track, src: {asset}, start, in, out, fade_in, fade_out}` in flicks, a fade `{length, curve}`; a map by ID
  or a list of entries with `id`, read either way *(chosen, the first draft's)*) and `removed` are read.
- **cut.heard:** the verdict's row with `from: {default: "cut.heard"}` (design), read with #509's `rowFrom`; its unrun
  entry is any object in the row with `code: cut.heard_unrun`, its fields on it or its `actual`; `cut.word_lost` and
  `cut.word_left` are #407's error issues with `word` and `text` on them or their `actual` *(the first draft's
  readings, by its `heardEntries` and `issuesOf`)*.
- **The transcriber:** deepbuild/speech installed with its model host started by #509's `withPlugin` (`uv run --script
  packages/jobs/speech/host/host.py --port 8720`); deep_job `{op: run, kind: narration.transcript, tool:
  whisper-cpp@1.9.5, params: {sample_rate, channels, locale, names: []}, inputs: [{name: pcm, sha256}]}` by #509's
  `transcribe`, on the PCM the unrun entry names; the record added to `assets.rec.attached`, and the verdict taken again.
  The scenarios' `evidence` is the hub's store, so the PCM a verdict keeps is what deep_job takes by its hash.
- **The planted program** `cut_on_raw_times` ("a recipe that skips the move and cuts at each raw point", design) is
  chosen by the scenario's `planted`, in both of its film's runs.

## Fixture

Nothing but code and this README is committed; every sound and record is made at run time.

- **The take** is the first draft's (`speechTake`): twelve sentences, 81 words ("We heard the [loud] train arrive", …,
  "The store raised the [weekly] price again"), each word spoken alone by `say -v Samantha` at 48 kHz, cut to its
  samples above −50 dBFS and laid at gain 0.5 from 0.5 s, with 120 ms of digital silence between the words of a
  sentence and an even pause between sentences, so the take is 60 s exactly; a sample `say` wrote as 0 inside a word is
  lifted to 1e-6. The bracketed word of each sentence is left out: 12 marked cuts, each between two kept words, 69 words
  kept. Its words record (`bake.words`, charsiu-aligner@1.0.0) is written from where each word was put; the shifted
  record states every start and end 150 ms (7,200 samples) later. It is the take the brief's fact is about, the one take
  whose transcription on this base is known; no word of it is "you".
- **What the design's rule makes of it** (read from the design, not run): on the shifted record a cut's raw point lies
  150 ms after the true edge, so the cut in before the word after each splice falls 150 ms into that word, and the cut
  out after the word before falls 30 ms into the removed word. The recipe moves each cut to the quietest spot within
  `search` between the words' middles, which is the 120 ms of digital silence beside it, so every kept word plays whole.
  The planted recipe keeps the raw points: with its 40 ms crossfades, each of the twelve words after a splice ("train",
  "bread", "stone", "glass", "plant", "smile", "park", "clock", "flight", "bring", "swing", "price") loses its first
  130 ms and fades in over the next 40 ms. The test asserts none of these numbers; it reads which words were cut into
  from the planted strips.

## Readings where the issue and the design leave a choice

- **"12 marked cuts"**: a marked cut is a word the keep list leaves out between two kept ones, one splice *(chosen)*;
  so `removed` is those 12 words and there are 13 strips, one per run of kept words (design).
- **"Expands to strips whose heard-back words"**: the words heard back are the transcript of what the row's strips play:
  the unrun entry's PCM must be the strips mixed alone (design), and that PCM is what the test has transcribed.
- **This job's reading of a transcript** *(chosen)*: both sides as normalizer@1's tokens (`media_heard`), aligned by
  longest common subsequence. A word it should hold and doesn't match in order is lost: missing, or heard as another. A
  heard word left over is either a word of the recording (some word of the take reads as it) or not.
- **Words the transcriber adds** *(chosen; the reason for this redraft)*: whisper-cpp@1.9.5 can add a word nobody said
  when a take ends in silence, and the speech job pads every take, cut or not, with 0.6 s of silence at each end. A
  heard word that no word of the recording reads as was never in the recording, so no strip played it: it is the
  transcriber's addition, set aside and listed in the proof, wherever it falls in the transcript. A heard word of the
  recording is never set aside: a removed word heard, or a kept word heard again, makes the words unequal. Setting a
  word aside never hides a lost one, since a kept word heard as another ("train" heard as "rain") is still missing from
  its place. This is how the design's `cut.heard` judges too: it fails only a kept word missing or heard as another and
  a removed word heard.
- **"Equal the kept words in order"**: the `cut.heard` row PASSes with no `cut.word_lost` or `cut.word_left`, and this
  job's reading of the transcript loses no kept word and leaves no word of the recording over *(chosen)*.
- **The fixture's own truth** *(chosen)*: before any cut result is heard, the transcriber hears the uncut take, and by
  the same reading it must hear all 81 words in order and no word of the recording over, else BLOCKED, never FAIL. So
  the "you" it adds at the take's silent end is set aside: by the brief's fact the check passes on this base, where the
  first draft's, which allowed nothing extra, read BLOCKED. normalizer@1 must read each of the 81 words as one token,
  else BLOCKED (it does at the base: `BASE-FAILURE.txt`).
- **"Shifted by 150 ms"**: the same recording and keep list with a words record stating every start and end 150 ms
  later than the true times *(chosen direction)*: later puts each raw cut into the onset of the word after a splice,
  where a lost syllable changes the word most.
- **"Still gives every kept word"**: the row is judged once its transcript is attached (PASS or FAIL, not BLOCKED),
  names no `cut.word_lost`, and this job's reading loses no kept word *(chosen)*; a removed word heard there isn't this
  sentence's.
- **"Loses a syllable"**: the planted strips leave part of a kept word's true samples unplayed (the first draft's
  `playedAs`: not inside one strip clear of its fades), and its transcript, by this job's reading, is missing a kept word
  *(chosen)*.
- **"`cut.heard` fails naming the word"**: the row FAILs and a `cut.word_lost` names a word the planted strips cut into,
  by `word` (its index) and `text` (its text in the words record) *(chosen)*; its `t` isn't judged.

## Legs that read BLOCKED or INCONCLUSIVE

- **BLOCKED** when `say -v Samantha` can't speak a word or the 81 words don't fit 60 s with 0.3 s between sentences; the
  CLI isn't built, the hub doesn't start or `deep mcp` refuses; `uv` is missing, port 8720 already answers, or the host
  exits or takes over 60 minutes to answer; normalizer@1 doesn't read each word of the take as one token; or the
  transcriber doesn't hear the uncut take as its 81 words in order with no word of the recording over.
- **INCONCLUSIVE**: none; no reading here depends on the machine's state.
- None reads BLOCKED by design on a set-up Mac.

## What isn't settled

- The transcriber leg was not run (the base has no recipe, and this job was told not to run it there). So it isn't known
  whether the transcriber hears each cut result's kept words (the fixture's check covers only the uncut take), nor,
  above all, whether it mishears at least one of the twelve words whose onset the planted strips leave out. If it fills
  in every one, the planted row PASSes and this test FAILs at "the planted recipe's cut.heard row FAILs", which a dispute
  would then settle.
- Added words are set aside anywhere in a transcript, not only after the last word *(chosen)*: the transcriber reads 30 s
  windows, so a window that ends in a pause may end with an added word. A cut whose splice clicked and was heard as a
  word nobody said would pass this reading; no criterion names one.
- The names and readings reused from the first draft (asset `rec`, item `cut`, where the unrun entry's and the issues'
  fields sit, strips as a map or a list) are that draft's choices.
- No other suite was run; the base was run only as `BASE-FAILURE.txt` says.
