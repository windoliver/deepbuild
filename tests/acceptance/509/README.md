# Acceptance tests for #509: narration heard back, the normalizer, the speech job, narration that sets the pace and the mix checks

Written first, blind, from issue #509 (as of Nov 12, 2026: its Scope, Fields, 13 acceptance criteria, Proof, Oracle and
Depends on), its Oracle page, the design sections it links and those they lean on, and the base commit `0e377fbd7`
("design(#509): list zh.polyphonic@1 and pin zh.readings@1 to pypinyin 0.55.0", on top of `3b68c0f87`, "design(#509):
name the speech plug-in, the transcript check, normalizer@1, the exception ask, pace and the power bakes"), by a job
that never saw an implementation; none exists at the base, and no other worktree, branch or PR was read. The
implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design:
Dogfooding). The Oracle lane for criteria 1, 2, 5 and 6 is in `tests/acceptance/509-oracle/`.

## What was read

- The issue, live (`gh issue view 509 --repo windoliver/deepbuild`). Each test's name starts with its criterion's ID,
  `#509.` and the first 8 hex digits of SHA-256 of the checkbox's text after `- [ ] `, trimmed, white space collapsed
  (`scripts/proof-change.mjs`).
- `docs/canvas-primitives.md` at the base: Narration and captions (with its paragraph "Synthesized lines, `say` and
  pace (#509)", the list of `zh.polyphonic@1` and the source of `zh.readings@1`), Narration: speech engines (its "As
  built (#509)": `deepbuild/speech` in `packages/jobs/speech`, the host's run line and port 8720, the kinds `speech` and
  `narration.transcript`, the three tools, the qualification fixture and the fixture line, `cost: {usd}`, budgets, the
  planted hub `job-speech-tools-enum`), Check input: `narration.transcript@1` (its "As built (#509)", the row, the
  unrun entry, the mismatch, `media_heard`, the exception ask, normalizer@1), Check input: mix kinds (its "As built
  (#509)": the per-bus power bakes, the row `mix.speech_ratio`, `mix.speech_low`), Film audit: craft@1 (silences), Time
  and the flick (`@line`, `@line.end`, `@line.word:text#k`), Placement, Clip, Marker, Processor (reverb), Analysis bake
  (the words and activity records), Asset: licences through jobs, Loudness and caption profiles.
- `docs/technical-design.md`: Narration, captions and profiles; the extension API (`deep.registerJob`,
  `deep.registerJobTool`); the Job row of Blocks for plug-ins that do real work; the slot table; Budget; Dogfooding.
  `AGENTS.md`.
- At the base, for surfaces and harness only: `crates/deep-show/src/main.rs` (the scenario's `state`, `claims`,
  `verdict` and `answer`), `verdict.rs` (rows, `from`, `asks`), `narration.rs`, `film_audit/craft/sound.rs` (silences),
  `query.rs` (`eval`'s `paths`); `packages/hub/src/jobs.ts` (deep_job's list and run replies, a paid tool's ask),
  `packages/budget/src/index.ts` (the ledger's `spend.*` events), `packages/jobs/bakes` (a plug-in whose tools run on a
  model host); `scripts/public-text.mjs`, `scripts/lanes.mjs`, `scripts/benchmark.mjs`. The suites `502/` (deep-show run
  films, words records written into the store, `say` voices placed at fixed samples), `1819/` (a real hub, `deep
  install`, `deep mcp`, deep_job, the model host, `BLOCKED:` lines), `1922/` (a test plug-in's job tool), `157/`
  (budgets with `judgeLimit`; an unknown licence's BLOCKED export), `409/` (briefs naming craft checks; imported for
  criterion 7), `499/mix/` (`media_mix` readers, imported), `488/` (placements), `1163/` (a reverb processor), `501/`
  (imported: the build, scenarios, the store).

What the base already does and these tests don't credit: #502's recorded lines, captions, sidecars and export; #1819's
words and activity bakes; #1922's job API and #1923/#1924's jobs; #409's craft checks, silences among them; #157's
licence walk. There is no `packages/jobs/speech`, no transcript row, no `media_heard`, no `say`, `names`, `after` or
`gap` on a line, no `narration.overlap` or `narration.fit`, no `mix.speech_ratio` row and no power bake on a receipt.

## Run them

macOS with the repo's Node and the pinned Rust toolchain first on `PATH`:

```sh
export PATH="$HOME/.local/share/fnm/node-versions/v24.22.0/installation/bin:/opt/homebrew/opt/rustup/bin:$PATH"
npm ci                                                                              # once, if node_modules is missing
npm run build --workspaces                                                          # the hub tests run packages/cli/dist/main.js
export CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
cargo build --locked -p deep-hook                                                   # the hub won't start without it
node node_modules/vitest/vitest.mjs run --root tests/acceptance/509 <file> --testTimeout=3600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/509/tsconfig.json         # type-check (exits 0)
rm -rf tests/acceptance/509/node_modules/.vite
```

One file at a time: each builds `deep-show` (`--features full`, 501's `useShow`) once. Every `it` passes a
3,600,000 ms timeout: the speech host's first start builds the transcriber and fetches its weights.

- **Lanes.** The implementer adds these lines to `scripts/lanes.mjs` (this job writes only its two folders):

  ```js
  // #509's files each build deep-show and speak their fixtures with macOS say; most start a hub and deepbuild/speech's
  // model host on its fixed port 8720 (recording.test.ts also deepbuild/bakes' on 8719); budgets.test.ts times them.
  alone.push('tests/acceptance/509/', 'tests/acceptance/509-oracle/');
  timed.push('tests/acceptance/509/budgets.test.ts');
  ```

- **Needs:** macOS `say` with the Samantha voice (every file but `normalizer.test.ts`); `uv` and network for a model
  host's first start (the hub files: `cut`, `names`, `asks`, `blocked`, `recording`, `tools`, `cost`, `budgets`); the
  supervisor's sandbox for the test speech tool (`tools`, `cost`: in Claude Code, the Bash tool with its sandbox off);
  `ps`.
- **Safety:** hub worlds are under `/tmp/dh509-*`, other folders under `$TMPDIR`, all removed after their file. The hub,
  `deep` and `deep mcp` run with `HOME` in the world's folder and without the caller's `DEEP_*`, `CLAUDE*`, `CODEX*`,
  `NODE_OPTIONS`; a model host runs with your `HOME` (its builds and weights cache there) and without `DEEP_*`. Every
  process is stopped by its PID (a host by the process group it leads); nothing is stopped by name or port. A host port
  already answering is BLOCKED and stops nothing. Nothing paid or remote is called: azure-speech@1.0.0 is only listed,
  and the paid tool is a local program that declares a price.
- **The proof** (the issue's Proof line: the planted-fault lines and their clean twins, the transcripts as recorded
  artifacts, the ask log, the mix checks' numbers) is written to `$TMPDIR/deep-509-proof/`, rewritten each run.

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a run that isn't
answered ok fails the test that drove it; a missing prerequisite fails with a line starting `BLOCKED:`, an unfit machine
with `INCONCLUSIVE:`.

## Criteria to tests

| AC | ID | File | Test, and the wrong program or plant it fails on |
|---|---|---|---|
| 1 | `#509.d30b5b10` | `cut.test.ts` | Two lines heard back by the real transcriber. The clean twin's transcript row PASSes; the **planted twin**, intro with the 300 ms slot holding "red" cut, FAILs with `narration.mismatch` naming intro with "red" missing, and no error names outro. Fails a check that passes on character similarity, one that never fails, and one that names the wrong line |
| 2 | `#509.9f77940a` | `names.test.ts` | The marked name Quercus, its recording saying "quick bus", FAILs with `narration.mismatch` naming l1 and the name, its fix a respelling in `say`. Through `media_heard` (zh-CN), 我们明天去公园散步吧 heard with 去 as 来 doesn't match and names that pair; with 园 as 元 (both yuan) it matches |
| 3 | `#509.18ee17cc` | `say.test.ts` | `say` differing on the marked name, an expansion (10:30, "ten thirty") and a homograph (live, lyve) compiles; the same `say` with Siobhan unmarked, and one saying bonds for bands, are refused with `say_not_text` naming l1 and both words |
| 4 | `#509.ea6d2be6` | `asks.test.ts` | Five verdicts on one `state`: the failing pair asks once with the design's ID; asked again, it doesn't; edited to the spoken text it PASSes with no ask; edited to another failing text it asks once for the new pair; edited back, no ask |
| 5 | `#509.b4d021e2` | `blocked.test.ts` | With no transcript the row is BLOCKED with an unrun entry per scope (the line scope the take's PCM, 48 kHz mono, en), PCMs kept; with the speech host stopped the job is BLOCKED naming whisper-cpp@1.9.5 on one unblock ask, no transcript, and the row stays BLOCKED. A zh-CN line with 行 and no reading is refused with `narration.polyphonic` naming zh, 行 and hang and xing; with 行[hang] it compiles |
| 6 | `#509.637f3d04` | `normalizer.test.ts` | `media_heard`: digits, ordinals, times, years, percentages and thousands separators written in digits and heard as words each match with the same tokens on both sides (1200, 1030, 31st, 1999 where the design gives them); each near miss doesn't |
| 7 | `#509.8b57734f` | `mix.test.ts` | Music 4 LU under the voice: the default row `mix.speech_ratio` FAILs with `mix.speech_low` naming l1, ratio 4 ± 0.1, min 10; at 12 LU it PASSes. A brief naming silences: the **reverb-tail twin** (the gap's mix above −60 dBFS in every 10 ms) FAILs `craft.silences`; the dry film PASSes |
| 8 | `#509.b2cb3b6a` | `recording.test.ts` | Your recording, its words by the real aligner: PASS with no `narration.speech_job`; each `@l1.word:<w>#1` is 0.5 s plus the aligner's start; the first caption starts on the aligner's first word's frame. The copy with "silver" cut FAILs naming l1 and silver. An asset licence `{id: LicenseRef-unknown}`: the export is BLOCKED with one ask naming voice_l1, nothing written |
| 9 | `#509.72d0ae67` | `tools.test.ts` | `speech` lists kokoro@0.9.4, platform-say@1.0.0 and azure-speech@1.0.0 by deepbuild/speech; test-voice@1.0.0 installs (qualifies), is listed beside them and speaks the fixture line (its audio, its record). The **planted hub `job-speech-tools-enum`** fails the same judge, every failure naming test-voice@1.0.0 |
| 10 | `#509.39975b5a` | `budgets.test.ts` | The perf lane's task names the ID and the budgets validate against the merge base's; five timed runs of 24 transcriptions of the 60 s film judged by `judgeLimit` against 60 s; the export's bakes for narration and music each 6,000 sub-blocks, 800 B/s per channel, kept by hash at that size |
| 11 | `#509.659d2ba6` | `after.test.ts` | `@l` (after: intro) within one sample of intro's last word + 0.3 s; with intro grown by four words, of the new end + 0.3 s; the anchors `@l.word:x#1` and `@l.word:squared#1.end` at l's start plus the bake's times, to the flick; `eval` reads the placement's 40 from one to the flick before the other, 0 outside |
| 12 | `#509.75b040de` | `overlap.test.ts` | b 0.2 s into a: `narration.overlap {lines: [a, b], overlap: 0.2, fix: {line: b, after: a}}`; b with `after: a` compiles, `@b` 0.3 s after a. c ending at 4.4 s in a [0, 3 s) section: the export FAILs with `narration.fit {line: c, section: s1, overrun: 1.4}`, nothing written; in a [0, 5 s) section it is delivered |
| 13 | `#509.a5c9def9` | `cost.test.ts` | deep_job's list names paid-voice@1.0.0 at {usd: 0.015}, kokoro and platform-say at 0, azure-speech above 0; the paid run is held on one ask naming 0.015 with no process and no charge; after your yes it is done, `spend.reserved` of 0.015 before the tool's process starts and `spend.charged` of 0.015 for that run |

## The surface under test

Names the issue and the design give are used as they give them; **every name marked *(chosen)* is this job's**, taken
from the design's words and shaped like the neighbouring surfaces. The implementer builds exactly these, or a dispute
goes to a blind redraft.

### deep-show run

- **The scenario** is #501's with #403's claims: you present the film with `deep show` (your shell's peer), and the
  agent's claim (session `sess-alpha`) has the film as its one deliverable and no requirement. `state` (a folder) keeps
  the record across runs (criterion 4). *(chosen: the claim's shape, #407's)*
- **The film** is #502's document (64 × 64, 24 fps, 48 kHz, `script.narrator`, `script.lines`, `script.captions:
  {profile: netflix-en-adult}`), each line a `recording: {asset}` with `t` as a seconds literal, and the issue's fields
  `say`, `names`, `locale`, `after`; the asset's `attached` lists records by hash (502's chosen form), the transcripts
  appended after the words record.
- **Rows** are found by the design's `from: {default: "narration.transcript@1"}` and `{default: "mix.speech_ratio"}`.
  An unrun entry is any object in the row with `code: narration.transcript_unrun`, its fields (`line`, `scope` of `line`
  or `mix`, `job`, `analyzer`, `pcm_sha256`, `sample_rate`, `channels`, `locale`) on it or its `actual` *(chosen: where
  the entry sits)*. Issues are #407's (`code`, `severity: error`, fields on the issue or its `actual`); a mismatch's
  `missing` is compared lower-cased, its `fix` must mention `say` and the word.
- **The exception ask** is read from the verdict's `asks` and its rows' `asks` (design), by `kind: exception` and its
  `id` `<claim>/narration.transcript:<line>/<SHA-256 of text>.<take PCM SHA-256>`; `answer` isn't called.
- **Refusals** (`say_not_text`, `narration.polyphonic`, `narration.overlap`) are read from any reply of the run, the
  presentation's or `time`'s, as an object with that `code` *(chosen: refused at presentation or at compile, either
  counts)*; the refused script's `time` resolves nothing. `narration.polyphonic` names its readings in `readings`, or
  anywhere in the object *(chosen)*. `narration.fit` is an issue of an export that FAILs, #502's `outcome: failed`.
- **Calls:** `time {doc, text}` (resolved, `t` in flicks); `eval {doc, t, paths}` (`values`, #1918); `export` (#502's,
  `receipt.captions.cues`, and the design's `receipt.bakes: [{bus, channels, subblocks, bytes, sha256}]`; 157's
  `outcome: blocked` with `asks` for a licence); `media_mix {doc: <document>, segments}` (#499); `media_heard {expected,
  heard, locale, names}` answering `{expected, heard, match, missing, extra, wrong}` (design). Chinese is `locale:
  "zh-CN"` *(chosen tag)*; a wrong pair may be characters or toneless syllables.
- **The placement** (criterion 11): `{clip, slots, start: "@l.word:x#1", end: "@l.word:squared#1.end"}` with a clip
  holding `slot:target/at/pos/0` at 40 (#488's clip form; a 60 s clip span so the placement's own span decides).

### The hub, deep_job and the plug-ins

- **One evidence store** (#1819's chosen reading): the scenario's `evidence` is the hub's store, so a PCM a verdict
  keeps is what deep_job takes by hash. Your files (takes' PCM, texts) are put there before the hub starts, as yours.
- **deepbuild/speech** is installed with `deep install packages/jobs/speech` after its host starts with `uv run --script
  packages/jobs/speech/host/host.py --port 8720` (design); deepbuild/bakes likewise on 8719 (criterion 8).
- **deep_job** (#1922's strict arguments, `params` as JSON text): transcripts `{op: run, kind: narration.transcript,
  tool: whisper-cpp@1.9.5, params: {sample_rate, channels, locale, names}, inputs: [{name: pcm, sha256}]}`, output
  `transcript`; speech `{op: run, kind: speech, tool, params: {say, voice, rate}}`, outputs `audio` and `record`; the
  list `{kinds: [{kind, plugin, tools: [{tool, plugin, build, cost: {usd}}]}]}`. A reply held on a send ask gets your yes
  and is made again (#1819's reading); a paid run's ask is answered once (criterion 13).
- **The test speech tool** (`fixtures/voice`, test/speech-voice's test-voice@1.0.0 and test/speech-paid's
  paid-voice@1.0.0 at {usd: 0.015}): a local program run as #1922's tools run (`run: {dir: tool, entry: speak.mjs}`,
  one JSON object in and out) *(chosen: a plug-in's speech tool needn't run on a model host)*. It answers the empty line
  with an empty 16-bit WAV and the fixture line with the recording the test made with `say`, and any other line exits 2.
- **Budget** (criterion 13): the ledger's `spend.reserved` (`data.budgets[].usd`, `data.run`) and `spend.charged`
  (`data.run`, `data.usd`), and `process.starting`, from `events.read` on the cli role (base shapes, design names).

### Planted programs

| Name | Selected by | The wrong program | Criterion | Read as failed when |
|---|---|---|---|---|
| the 300 ms cut twin | the fixture | intro's recording with the slot holding "red" (14,400 samples) removed | 1 | its row PASSes, or no mismatch names intro with red missing |
| the unmarked name, the changed word | the fixture | `say` respelling Siobhan with no `names`; `say` saying bonds for bands | 3 | it compiles, or the refusal doesn't name l1 and both words |
| the near misses | the fixture | each normalizer form heard one word off | 6 | it matches |
| 4 LU and 12 LU | the fixture | music 4 dB (12 dB) under the voice's tone | 7 | 4 LU passes, or 12 LU fails |
| the reverb tail | the fixture | the bed before the second gap on a bus with `reverb {ir: {decay: 4, size: 0.8, damping: 0.2}, mix: 0.6}` | 7 | silences PASSes |
| the cut copy | the fixture | the take with "silver" and its gap cut, its words by the real aligner | 8 | its row PASSes |
| `job-speech-tools-enum` | `DEEP_HUB_PLANT` (design) | the speech kind's tools kept in code as the three first-party names | 9 | the judge finds nothing, or a failure doesn't name test-voice@1.0.0 |
| 0.2 s overlap; 1.4 s overrun | the fixture | b at a's end less 0.2 s; c ending 1.4 s past a 3 s section | 12 | it compiles; it is delivered |

## Fixtures

Nothing but code, the voice plug-in's three files and this README is committed. Every sound and record is made at run
time; no model output, recording or personal data is in the repository.

- **Takes:** each word spoken alone by `say -v Samantha -r 220` at 48 kHz, cut at −50 dBFS, laid from sample 0 with
  50 ms between words (gain 0.5); a slot or leading silence where a test says. A word's start and end are where it was
  put. A words record is the Analysis bake row's (`bake.words`, charsiu-aligner@1.0.0, weights [], the PCM's hash, a
  10 ms frame, words in flicks); an activity record's (`bake.activity`, silero-vad@6.2.3) frames are 10 ms, probability
  1 inside the spans and 0 outside, read both ways. Criterion 8's words records are the real aligner's.
- **The cut twin's record** keeps the text's seven words in place; "red" gets 10 ms of the silence where the cut was.
- **Tones:** a 1 kHz tone at peak 0.1 stands for the voice in criterion 7 (stereo float, both channels alike, as the
  music), so the LU ratio is the level ratio by construction; a 440 Hz tone is the sound of compile-only lines (the
  Chinese refusal) and the ambience bed.
- **The fixture line's recording** for the test tool: `say -v Samantha` of "The quick brown fox jumps over the lazy
  dog." at 24 kHz, 16-bit mono.
- Feasibility, checked once by hand: at 220 words a minute "red" takes about 244 ms after the −50 dBFS cut, inside its
  300 ms slot; a slower voice on another macOS fails criterion 1 as BLOCKED, never wrongly.

## Readings where the issue and the design leave a choice

- **"300 ms cut from one line"**: a 300 ms slot of the take holding one word and silence, removed; "the missing words"
  are those whose samples lay inside it, "red".
- **"Heard as other words"** (criterion 2): the recording says other words where the name stands; the transcriber's
  output there can't be the name. **"A respelling fix"**: the mismatch's `fix` names `say` and the name.
- **"10-character Chinese line … homophone"** is read through `media_heard`, the comparison the row makes.
- **"Never asks twice"**: no verdict lists an exception ask ID that an earlier verdict listed as new; an ask still
  listed while it waits isn't a second ask.
- **"Can't run"** (criterion 5): the job's host doesn't answer (stopped after the install).
- **"Alone"** (criterion 6): no names, no ask, no record: `media_heard`.
- **"Within one sample"**: 14,700 flicks at 48 kHz. **"Covers exactly"**: the anchors to the flick, and the placement
  active from one to the flick before the other.
- **"A shared export"**: any delivery export (#157's reading).
- **"Counts against your budget"**: the ledger reserves the run's price before its process starts and charges it.
- **Timing** (criterion 10): one run is a verdict on a fresh 60 s film and its 24 transcriptions one after another,
  summed over the calls that ran a job; five after a warm-up, by `judgeLimit`.

## Legs that read BLOCKED or INCONCLUSIVE

- `budgets.test.ts`'s timed leg is **INCONCLUSIVE** anywhere but a reference Mac on mains power, Low Power Mode off,
  thermal state nominal and unloaded (`referenceMacProblem`, `judgeLimit`).
- Any hub file is **BLOCKED** when `uv` is missing, a host's port (8720, or 8719) already answers, or a host exits or
  takes over 60 minutes to answer; any file is BLOCKED when `say -v Samantha` can't speak.
- `cut.test.ts` is BLOCKED if `say` speaks "red" in over 280 ms; `mix.test.ts`'s silences leg if the twin's gap isn't
  above −60 dBFS throughout, or the dry gap isn't silent; `overlap.test.ts` if c's take runs past 3.4 s.
- None reads BLOCKED by design on a set-up Mac.

## What isn't settled

- The *(chosen)* names above: the claim, where the unrun entry and the refusals sit, `readings`, `zh-CN`, the test
  tool as a local program, the `spend.*` fields read.
- Whether a refused script is refused at presentation or only at compile: both are read.
- Whether a mismatch's `missing` holds the text's words as written or normalized: compared lower-case.
- The transcriber's reading of words spoken one by one: the clean twins must PASS, so a take the pinned model mishears
  on this macOS would fail a clean twin; none was run here.
- Criterion 8's licence leg and criterion 7's silences leg may pass at the base (#502 and #157 BLOCK an unknown
  licence; #409's silences renders the mix); the other legs of those criteria fail there.
- `budgets.test.ts`'s first leg needs `origin/main` and a task the implementer adds to `benchmarks/budgets.json`.
