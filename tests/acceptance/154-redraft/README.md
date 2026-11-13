# Acceptance tests for #154: score@1, original music written as data, rendered by a pinned job into stems (blind redraft)

Written first, blind, from issue #154 (its Scope, Fields, nine acceptance criteria and Proof line), its Oracle page, the
design rows, and the base commit `b726c8be8` by a job that never saw an implementation; none exists at the base, and no
other worktree, branch, PR or suite for #154 was read. This suite covers criteria 1, 2, 3, 5, 6, 7 and 9; the Oracle
lane for criterion 2 is `tests/acceptance/154-oracle-redraft/`. Criteria 4 and 8 aren't drafted here. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

## What was read

- The issue body (`gh issue view 154 --repo windoliver/deepbuild`), not its comments or linked PRs. Each test's name
  starts with `AC<n> #154.<8 hex>`, the first 8 hex digits of SHA-256 of the criterion's checkbox text after `- [ ] `,
  trimmed, white space collapsed (`scripts/proof-change.mjs` `criterionId`).
- The Oracle page (`doneright/oracles/issues/154.md`, branch `doneright` of `DeepBuildAI/deepbuild`) and the one
  upstream file it pins for criterion 2 (the sample-accurate scheduling test, ported in the Oracle lane's suite). The
  page has no upstream test for criteria 1, 3, 5, 6, 7 or 9.
- `docs/canvas-primitives.md` at the base: Score `score.music@1` and `score.render@1` with its **As built (#154)**
  paragraph (which fixes the surfaces below); Pack: assets fetched on first use; Tempo map and cue alignment; Time and
  the flick; Occurrence list; Check input: mix kinds; Film audit: craft@1; Strip and track (loop); Asset (license,
  made_by, loop); Document envelope; Canvas module.
- `docs/technical-design.md`: Score and foley; the extension API (`deep.registerJob`, `deep.registerJobTool`) and the
  Job row (`deep_job`); Dogfooding; Criteria to tests; Wrong programs. `AGENTS.md`, `CONTRIBUTING.md`.
- At the base, for surfaces and conventions only: `crates/deep-show/src/main.rs` (the scenario line and its calls; an
  unknown call makes the line `{"ok": false, "code": "bad_input"}`), `mixdown.rs` (`media_mix`, its segments and float
  WAVs), `packs.rs` (the scenario's `packs`, url-listed assets never read at the pack check), `crates/deep-canvas/src/
  document/check.rs` and `mod.rs` (the envelope's keys, the item's keys), `document/packs.rs` (the pack's keys),
  `crates/deep-canvas-media/src/module.rs` (`media.strip@1`: a media kind's fields as params),
  `crates/deep-canvas-motion/src/tempo.rs` (the `tempo_map` field), `packages/hub/src/jobs.ts` (deep_job's run, its
  receipt, `failed` on an output check, its cache), `libraries.ts` and `packs.ts` (#1820's pack fetch, `pack.rule`,
  BLOCKED offline with one unblock ask), `core.ts`, `tools.ts`; `scripts/benchmark.mjs` (`judgeLimit`,
  `validateBudgets`, `fingerprint`). The suites `tests/acceptance/1922/`, `1820/`, `1731/`, `1819/`, `501/`, `502/`,
  `1732/`, `491/` and `2009-oracle/`, for their harness conventions.

## What the base has

The pack fetch (#1820: `deep install` of a data pack with url-listed `assets`, `deep_kinds {op: "fetch", pack, asset}`,
one authority ask or `pack.rule`, BLOCKED offline with one unblock ask), deep_job (#1922), `media_mix` (#499), the
tempo map read by the motion module (#491, through `deep-motion`), and `deep-show run`'s pack store (#306). It has no
`packages/jobs/score`, no `score.render` kind or tool, no FLAC writer or reader, and no loop points read from an asset.
Probed with the base's `deep-show` while drafting:

- a film with a `score.music@1` item is presented with the item skipped (`unknown_kind`, a notice);
- `{call: "score_plan", ...}` makes the whole scenario `{"ok": false, "code": "bad_input"}`;
- a library pack with `samples` is refused at the pack check (`unknown_field` at `samples`), so a document naming it
  is refused `pack_missing`; the same pack without `samples` is installed;
- a film with `tempo_map` is refused `unknown_field` at `tempo_map` (see Not settled); without it, the suite's films
  are presented.

## Run them

```sh
npm ci                                            # once
npm run build --workspaces                        # the tests run packages/cli/dist/main.js
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 240 -- scripts/lease cargo build --locked -p deep-hook
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 240 -- scripts/lease cargo build --locked --bin deep-show
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/154-redraft --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/154-redraft/tsconfig.json
rm -rf tests/acceptance/154-redraft/node_modules/.vite          # the cache vitest leaves under --root
```

- **One file at a time.** Each file starts its own hub (and its own take server on a free port) in a temp home, and
  builds `deep-show` once (`cargo build --locked --bin deep-show`, honoring `CARGO_TARGET_DIR`; a no-op when built), so
  the implementer adds `alone.push('tests/acceptance/154-redraft/')` to `scripts/lanes.mjs` (not done here: this job
  writes tests only). `limits.test.ts` needs no hub.
- **Needs:** `openssl` (a test CA per world, which the hub trusts through `NODE_EXTRA_CA_CERTS`). Nothing leaves
  127.0.0.1, no model is called, nothing is paid.
- **Safety:** every folder is under `/tmp/dh154r-*` and removed after its file; the hub, `deep` commands and `deep mcp`
  run with `HOME` in the world's temp folder and without the caller's `DEEP_*`, `CLAUDE*`, `CODEX*`, `NODE_OPTIONS`.
  Every process this suite starts is stopped by its PID; nothing is stopped by name or port.
- **Time:** every test passes a one-hour timeout. Budgets run a warm-up and five renders of a 60 s, six-stem score.

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a scenario that isn't
answered ok, a job that isn't done, or an install that is refused fails the test that drove it.

## Criteria to tests

| AC | ID | File | Tests, and the wrong program each fails on |
|---|---|---|---|
| AC1 | `#154.c8c95dbc` | `determinism.test.ts` | (1) the same score rendered in two fresh hubs gives the same stem hashes, and the `mix` stem is the same in the second hub when its score also has one more note on the `pad` stem; (2) on a `mix` stem of two sampled instruments (four takes each) and a plucked string, adding a keys note, then a plucked note, leaves every other note's samples as they were (so its noise), no take before it moves, and no take on another instrument moves, read from the stem and from `meta`; (3) 1,024 notes on one instrument with four takes: no note sounds the previous note's take, read from the stem, all four used, `meta` agreeing one to one; the planted round robin without the fold repeats a take. Wrong programs: the base; a renderer whose draws come from one stream would fail (2) (not planted here: the judge compares samples); the planted round robin without the fold (3) |
| AC2 | `#154.8b0e5b99` | `onsets.test.ts` | (1) eleven notes placed every way `at` takes (bar:beat with and without `b`, a fractional beat, inside a tempo ramp and after it, `@marker+0.25s`, seconds, frames, integer flicks): the plan's `note_on` t and sample, the job's `meta` sample and the stem's first sounding sample each within one sample (14,700 flicks) of the flick worked out here from the tempo map; `note_on` in (t, event) order; (2) `score.pitch` fails the job for event `tuning_probe` (pitch A4) on a library take 50 cents sharp whose manifest states root 69, naming the event, the check and about 50 cents, keeping no stem, and passes it on the in-tune take. Wrong programs: the base; the planted check that reads the event's pitch passes the sharp sample and the judge fails it |
| AC3 | `#154.6e31be7c` | `cache.test.ts` | three parts on three stems (sampled keys, a plucked string, a synth pad), all rendered; a plucked note's pitch edited: the guitar stem misses under a new key with new bytes, the keys and pad stems hit with their keys and outputs and unchanged jobs; then a keys note added: only the keys stem misses. Wrong program: the base |
| AC5 | `#154.87a31a62` | `offline.test.ts` | (1) online: a score on an unfetched library plans BLOCKED naming it, with no request; the take's fetch holds on one authority ask and makes no request until your yes; after it, the take is stored and the score plans; (2) the take server closed: a score on another unfetched library plans BLOCKED naming it; its fetch, twice, is BLOCKED with exactly one unblock ask and no authority ask, nothing stored, the score still BLOCKED. Wrong program: the base |
| AC6 | `#154.74061b19` | `limits.test.ts` | (1) a pad note at MIDI 40 not marked bass is refused `score.pad_too_low` naming the event, as a synth `pad` and as a library preset with `sustained: true`; MIDI 47 refused, 48 presented (the boundary pair); marked bass, presented; a plucked note at 40 presented; (2) a note held 61 s refused `score.note_too_long` naming the event; 60 s presented. Wrong programs: the base; an off-by-one boundary fails the pairs |
| AC7 | `#154.54798db1` | `loop.test.ts` | loop `{from: "5:1", to: "9:1"}` at 120 BPM: `meta.loop` is `{start: 384000, end: 768000}` and the FLAC's `LOOPSTART=384000`, `LOOPLENGTH=384000`; a looping strip (`media_mix`, `loop: true`) over three passes matches the straight render of bars 5 to 8 played three times within −96 dBFS per sample from the second pass on; the planted stem looped without the fold differs there by more than −40 dBFS. Wrong programs: the base; the planted loop without the fold |
| AC9 | `#154.d6804da4` | `budgets.test.ts` | (1) `benchmarks/budgets.json` has a task whose reason names #154, valid against the merge base's; (2) planning the 60 s six-stem score writes no audio on the canvas side, and its six stems come from deep_job; (3) on a reference Mac, five renders of the score after a warm-up, judged by `judgeLimit` against 60 s, and five runs of a cached stem, each a cache hit with its key and outputs, judged against 100 ms. Wrong program: the base (no task names #154; no score) |

## The surface under test

Names the issue and the design give are used as given; names they don't are marked *(chosen)*. Each is one place in
`helpers.ts` to change if the implementation's spelling differs, by a redraft.

1. **The plug-in.** `deep install packages/jobs/score` installs the first-party plug-in `deepbuild/score` as you
   (the OS confirmation stubbed by `DEEP_HUB_TEST_CONFIRM`), exiting 0 *(chosen: #1819's suite installs
   `deepbuild/bakes` the same way)*. Its job kind is `score.render` on the tool `score-render@1.0.0` (As built).
2. **A sample library** is a pack folder installed with `deep install <folder>` (#1820): `pack.json` with `id`
   (`testlib/<name>`), `name`, `version` `1.0.0`, `license`, `description`, `requires: {core: "^1", modules: {media:
   "^1"}}` *(chosen)*, `assets` (each take by `path`, `url`, `sha256`, `size`, `license`, `upstream`) and `samples:
   {<preset>: {sustained, zones: [{lo, hi, root, takes: [<asset path>]}]}}` (Score: Fields). Takes are 16-bit mono WAV
   at 48 kHz *(chosen: the design names no take format)*, served by the world's take server.
3. **Fetching a library**: your standing rule (`pack.rule {pack: "testlib/<name>", licenses: [<SPDX>]}` on the hub's
   cli socket) and `deep_kinds {op: "fetch", pack: "testlib/<name>@1.0.0", asset: <path>}` per take, answering
   `{status: "fetched"}` with the take in the evidence store by its sha256 (#1820's, unchanged). AC5 reads the ask
   path: `{status: "held", ask}`, an `ask.created` of kind `authority`, your yes by `deep inbox answer`; offline,
   `BLOCKED` with an `ask.created` of kind `unblock`.
4. **The document**: a film (`profile: "film"`, `transport: {frame_rate: [24, 1], span, sample_rate: 48000}`),
   `packs: ["testlib/<name>@1.0.0"]` for its libraries, and one item
   `{id, kind: "score.music@1", layer, name, order, params: {instruments, events, loop?}}`, the kind's fields as
   `params` *(chosen: as `media.strip@1` holds a strip's)*. Within them:
   - `instruments: {id → {source, stem, bass?}}`, `source` written by its variant's name as a key *(chosen)*:
     `{sampled: {library: "owner/name@1.0.0", preset}}`, `{pluck: {preset: "nylon" | "harp", overrides: {damping,
     brightness}}}`, `{synth: {preset: "sine" | "saw" | "pad"}}`.
   - `events: {id → {at, inst, pitch, dur, vel, pan?, attack, release}}`: `at` as `"bar:beat"` (`"5:1"`, `"2:1b"`,
     `"1:3.5"`), `"@drop+0.25s"`, `"10.5s"`, `"180f"` or integer flicks *(chosen: a time field takes flicks as a
     number, as strips do)*; `pitch` a MIDI number or `"A4"`; `dur` a number of beats or a seconds literal (`"0.25s"`,
     `"61s"`) *(chosen: a bare number is beats)*; `attack` and `release` in seconds *(chosen)*; `vel` 0..1.
   - `loop: {from: "5:1", to: "9:1"}`.
   - Only AC2's onsets film and AC7's bed, which need bar:beat, give the film a tempo map, as #491's field
     `tempo_map: {segments: [{at, bpm, meter: [4, 4], span, ramp: "none" | {to_bpm, shape: "linear_in_beats"}}]}`,
     and the onsets film a marker (`markers: {drop: {kind: "cue", t: "3:1b"}}`). Every other fixture writes its times
     in seconds and has no tempo map.
   - The score's item ID is its seed's source (`seed = hash(id)`): AC9 gives each run another ID to get other keys.
5. **`deep-show run`** (one scenario line on stdin, one answer `{"ok": true, "replies": [...]}`), its `evidence` the
   hub's evidence store (`<home>/.deepbuild/evidence`) *(chosen: #1819's reading, so the takes the hub fetched are what
   the plan names)*, with the library folders offered to its pack store as `packs: [{id, dir}]` (#306):
   - `{call: "deep show", peer, doc, document, include: ["issues"]}` from your shell, as #501's suite sends it:
     `outcome: "presented"` with no error issue and no `unknown_kind` notice, or `outcome: "refused"` with `issues:
     [{code, severity, ...}]`.
   - `{call: "score_plan", doc, item}` (As built): `stems: {name → {kind, tool, params, inputs: [{name: "samples",
     sha256}]}}` and `note_on: [{t, sample, event, stem}]`, read from the reply or its `plan` field *(chosen)*; BLOCKED is
     the word BLOCKED in the reply, naming the library.
   - `{call: "media_mix", doc, segments: [{from, to, write: true}]}` (#499): each segment's `wav`, a float WAV by hash.
     A strip plays a stem as `{track: 1, src: {asset: <stem sha256>}, start: 0, in: 0, loop?: true}`.
6. **deep_job** through `deep mcp`: `{op: "run", kind, tool, params: <the plan's params as JSON text>, inputs: <the
   plan's inputs>}` per stem (As built: "ready for deep_job"). Done is `{status: "done", outputs: {stem: {sha256}, meta:
   {sha256}}, receipt: {key, cache: "miss" | "hit"}}`; score.pitch's failure is `{status: "failed", ...}` naming
   `score.render.pitch` (or `score.pitch`), the event and the cents, with no `stem` output (#1922's output-check failure).
   A reply held on an ask gets your yes and the call is made again, at most five times *(chosen: no criterion reads such
   an ask)*.
7. **The outputs**, read from the evidence store by hash: `stem`, a FLAC this suite reads itself (`helpers.ts`
   `readFlac`: STREAMINFO, the Vorbis comment, every subframe kind; checked against two encoders while drafting), 48 kHz,
   stereo, 24-bit, sample k at k × 14,700 flicks from the score's start; `meta`, JSON with `loop: {start, end} | null`
   and `note_on: [{event, sample, pitch, take}]` (As built). The FLAC's `LOOPSTART` and `LOOPLENGTH` in samples.
8. **Budgets**: `benchmarks/budgets.json` and `scripts/benchmark.mjs`'s `validateBudgets`, `fingerprint` and
   `judgeLimit`, as #501's and #365's suites use them.

## Planted programs

All live in the test files; none is selected by an environment variable or reaches a shipped program.

| Criterion | The wrong program | Where | Read as failed when |
|---|---|---|---|
| AC1 | a round robin with no fold: each note's take from its own hash mod 4 | `determinism.test.ts`, test 3 | it repeats a take on consecutive notes, which the same judge counts |
| AC2 | a pitch check that reads each event's declared pitch instead of the stem | `onsets.test.ts`, `eventPitchCheck` | it passes the note on the sample 50 cents sharp, and the judge (`judgePitch`) fails it |
| AC7 | the looped stem without the fold: the straight stem's region repeated with nothing carried over | `loop.test.ts` | it differs from the straight render played three times by more than −40 dBFS where the tails ring past 9:1 |

For AC3, AC5, AC6 and AC9 the merge base is the wrong program, with the boundary pairs (MIDI 48/47, 60 s/61 s) for the
mutants an off-by-one would make.

## Fixtures

All made at run time; nothing binary is committed. Every take is a tone in cosine phase (its first sample is its
loudest), with a 2 ms fade at its end:

- `testlib/keys` (root 69) and `testlib/bells` (root 76): four takes each, 0.3 s, the fundamental with one overtone
  each (the 2nd, 3rd, 4th or 5th at 0.7), so 512 of the stem's samples from 256 after a note's onset (past any attack)
  say which take sounds (normalized correlation ≥ 0.98, at least 0.1 above the next; about 0.67 between two takes). The
  overtones lie outside score.pitch's ±100 cents.
- `testlib/tuned` and `testlib/onset` (root 69, one 440 Hz take, 0.25 to 0.3 s); `testlib/sharp` (manifest root 69,
  its take 452.89 Hz, 50 cents sharp); `testlib/near` and `testlib/far` (AC5); `testlib/bed` (root 57, one 4 s take of
  220 Hz with two overtones, decaying over 1.5 s); `testlib/strings` (root 48, `sustained: true`, offered to
  `deep-show run` only, its url never read).
- Every note that a judge reads ends (`dur` plus `release`) before the next onset: AC1's mix notes sound 0.21 s, 0.5 s
  apart, the added notes in the gaps; AC1's 1,024 notes sound 0.11 s, 0.125 s apart; AC2's sound 0.26 s with at least
  0.49 s of silence between them.

## Legs that read BLOCKED or INCONCLUSIVE

None of these is ever a pass.

- AC9's timings off a reference Mac, or on one that isn't on mains power with Low Power Mode off and the thermal state
  nominal, or under load above the core count: `judgeLimit` answers INCONCLUSIVE and the test fails with
  `INCONCLUSIVE: ...` (the renders still run, so the surface is checked first).
- A hub that doesn't start, or `deep mcp` that doesn't initialize, fails the test that needed it.

## Readings where the issue leaves a choice

- **"Two runs"** (AC1): two hubs with separate homes, so the second render can't be the first's cache hit. **"After an
  unrelated note is added to another stem"**: the second hub renders the score with one more `pad` note first, so its
  `mix` stem is rendered afresh there and must hash as the first hub's.
- **"Changes no other note's noise"** (AC1): every other note's samples over its own window (0.24 s from its onset,
  never past the next onset) are equal, integer for integer. **"No take before it"**: a sampled note of the added note's
  instrument earlier than it sounds the same take; a later one may move, and if it keeps its take its samples are
  unchanged too. **"No take on another instrument"**: every note of another instrument, before or after.
- **"Over 1,000 notes"**: 1,024, every 0.125 s; "the previous note's take" is the take of the note just before it in
  time on that instrument.
- **"Lands on its resolved flick within one sample"** (AC2): |got − resolved| ≤ 14,700 flicks for the plan's `t`, the
  plan's and the job's `sample` × 14,700, and the stem's first sounding sample × 14,700. The resolved flick is the tempo
  map's closed form (exact for constant segments, f64 for the ramp).
- **"Fails a note ... naming the event"** (AC2): the job's status is `failed`, its text names the event's ID and the
  check; the design adds the cents, read as a number from 40 to 60. **"Passes it on the in-tune sample"**: the same
  event, done.
- **"Re-renders one stem, and the other stems are cache hits"** (AC3): the receipt's `cache`, with the key and outputs.
- **"A score whose library isn't fetched is BLOCKED with one unblock ask"** (AC5): the plan is BLOCKED naming the library
  (As built), and the hub's fetch of its take, which the plan points to, is BLOCKED with one unblock ask in the record
  however often it is called. **"No fetch starts"**: the take server logs no request.
- **"Sustained pad"** (AC6): a `synth` `pad` or a library preset with `sustained: true` (As built). **"Held note of 61
  s"**: its `dur`, written `"61s"`, on a `sine` synth.
- **"Loop points sit on those bar lines exactly"** (AC7): `meta.loop` and the FLAC's `LOOPSTART`/`LOOPLENGTH` equal the
  bar lines' samples (whole samples at 120 BPM). **"A straight render of those bars' events played three times in a
  row"**: the same score with no loop, rendered (its stem keeps the tails past 9:1) and played once by `media_mix`, its
  sound from 5:1 on added at 5:1, 5:1 + one region and 5:1 + two regions. **"From the second pass on"**: samples from
  9:1 to 5:1 + three regions. **−96 dBFS per sample**: |difference| ≤ 10^(−96/20) on both channels.
- **"Renders in under 60 s on the reference Mac's CPU"** (AC9): the wall time from the first of the six deep_job
  requests, sent at once, to the last answer. **"A cached stem costs nothing"**: a cache hit with its key and outputs,
  its round trip under 100 ms *(chosen)*. **"The job never runs on the UI thread"**: the canvas side (`deep-show run`,
  whose main thread is the app's UI thread) writes no audio while planning, and the stems come from deep_job.

## Not tested

- Criteria 4 and 8, and the Oracle lane (its own suite).
- "Identical per build and architecture" (Scope): AC1's text reads two runs; no other architecture is run.
- The 4-semitone warning `score.far_from_sample`, `score.key`, `score.chord`, `score.range`, `score.procedural`, bends,
  vibrato, strums, credits and `made_by` (no criterion of this job reads them); the default loop region; craft@1's
  `mix.balance` and `sound_lock`; the occurrence list kept in the document.

## Not settled

- **`tempo_map` in a `deep show` document.** The base's canvas core doesn't list `tempo_map` among the envelope's
  fields (only `deep-motion` reads it, #491) and refuses it `unknown_field`, while the design resolves a score's times
  "through the film's tempo map at check". So the two fixtures that need bar:beat (AC2's onsets film, AC7's bed) are
  the only documents here the base's check refuses for more than #154's own kind and fields. They write the tempo map
  as #491's suite does; an implementation that keeps it elsewhere is a dispute for a redraft, not an edit here.
- **Where the plan's fields sit** (`stems` and `note_on` at the reply's top or under `plan`) and the take format (WAV) are
  this job's readings.
- **Budgets' 100 ms** for a cached stem is this job's number for "costs nothing"; the issue gives none.
