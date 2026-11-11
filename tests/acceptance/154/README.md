# Acceptance tests for #154: score@1, original music written as data, rendered by a pinned job into stems

Written first, blind, from issue #154 (as of Nov 10, 2026: its Scope, Fields, nine acceptance criteria, Proof and
Oracle lines), its Oracle page, the design rows, and the base commit `b726c8be8` (`b726c8be8c7879e3c14d8a2c4963c69063d06255`,
"design(#154): score.music@1 as built: the plan call, per-stem render job, list inputs, loop points in the stem,
score.pitch as an output check") by a job that never saw an implementation; none exists at the base, and no other
worktree, branch or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding). The Oracle lane for criterion 2 is in `tests/acceptance/154-oracle/`.

## What was read

- The issue, live (`gh issue view 154 --repo windoliver/deepbuild`, body only). Each test's name starts
  `AC<n> #154.<id>`, the first 8 hex digits of SHA-256 of the checkbox's text after `- [ ] `, trimmed, white space
  collapsed (`scripts/proof-change.mjs`, `criterionId`).
- The Oracle page (`doneright/oracles/issues/154.md`, branch `doneright` of `DeepBuildAI/deepbuild`) and the one file it
  pins, upstream's `sample-accurate-scheduling.html` at `2f57f45d21`, read from `doneright/oracles/vendor/`.
- `docs/canvas-primitives.md` at the base: Score `score.music@1` and `score.render@1` with its **As built (#154)**
  paragraph; Pack: assets fetched on first use; Tempo map and cue alignment; Time and the flick; Occurrence list; Check
  input: mix kinds; Film audit: craft@1; Strip and track (loop) and its generator sources; Asset (loop, license,
  made_by); Asset: licences through jobs.
- `docs/technical-design.md`: Score and foley; the extension API (`deep.registerJob`, `deep.registerJobTool`) and the
  Job row; Dogfooding; Criteria to tests, Wrong programs, the boundary pairs. `AGENTS.md`, `CONTRIBUTING.md`.
- At the base, for surfaces and conventions only: `packages/hub/src/jobs.ts` (deep_job's list, run, receipt, cache and
  failed shapes), `packages/hub/src/libraries.ts` and `packs.ts` (the pack fetch, `pack.rule`, the offline unblock ask),
  `packages/extension-host/src/host.ts` (`deep.registerJob`), `packages/jobs/bakes` (a first-party job plug-in),
  `crates/deep-show/src/{main.rs,packs.rs,mixdown.rs,bake.rs}` (the scenario's `packs`, `media_mix`, a BLOCKED reply),
  `crates/deep-canvas/src/document/{mod.rs,packs.rs}` (the envelope and pack keys, an issue's JSON),
  `crates/deep-canvas-motion/src/tempo.rs` (the tempo map's fields); the suites `1922`, `1820`, `1731`, `1819`, `501`,
  `502`, `499/mix`, `491`, `408` as patterns. This suite imports `../501/helpers.ts` (the deep-show scenario plumbing and
  its WAV reader) and the extension host's public entry for `packageDigest` only, as #1922's suite does.

## What the base has

#1922's deep_job (one kind per plug-in, outputs by hash, the cache by key, output checks, `process.starting` per run);
#1820's pack fetch (`deep install` of a pack folder, `deep_kinds {op: "fetch", pack, asset}`, `pack.rule`, the offline
unblock ask); #491's tempo map, read by `deep-motion` only; #499's `media_mix` over WAV assets. It has no
`score.music@1`, no `score_plan`, no `packages/jobs/score`, no `samples` on a pack, no FLAC writer or reader, no `many`
input (deep_job refuses an input named twice), no `tempo_map` in a `deep show` document, and no licence refusal at
install.

## Run them

macOS; Node 24.22 and rustup's cargo first on `PATH`:

```sh
npm ci
npm run build --workspaces                                # the tests run packages/cli/dist/main.js
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node scripts/throttle.mjs build --wait 30 -- scripts/lease cargo build --locked -p deep-hook   # the hub needs it
node scripts/throttle.mjs build --wait 30 -- scripts/lease cargo build --locked --bin deep-show  # as beforeAll builds it
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/154 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/154/tsconfig.json
```

- **One at a time:** each hub test starts its own hub, installs deepbuild/score (its tool qualifies at install) and
  renders stems through the supervisor, and each file builds `deep-show` once in `beforeAll`, so the implementer adds
  `tests/acceptance/154/` and `tests/acceptance/154-oracle/` to `alone` in `scripts/lanes.mjs` (not done here). Every
  `it` passes a 3,600,000 ms timeout (AC9's timing leg four times that).
- **Needs:** `openssl` (the test CA), `ps`.
- **Safety:** every folder is under `/tmp/dh154-*` and removed after its file; every hub, `deep` command and `deep mcp`
  runs with `HOME` in its world's temp folder and without the caller's `DEEP_*`, `CLAUDE*`, `CODEX*`, `NODE_OPTIONS`;
  the shelf listens on 127.0.0.1 only; no model is called; every process is stopped by its PID. Delete
  `tests/acceptance/154/node_modules/.vite` after a `--root` run.
- **The proof** (the issue's Proof line) is written to `$TMPDIR/deep-154-proof/`, rewritten each run: the stems of two
  runs by hash, the note_on lists against the tempo map, the sharp note's failure, the fetch plan with its licences.

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a BLOCKED or
INCONCLUSIVE leg fails with a line starting `BLOCKED:` or `INCONCLUSIVE:`.

## Criteria to tests

| AC | ID | File | Test, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#154.c8c95dbc` | `stems.test.ts` (4) | two fresh hubs: the song's three stems are misses in each and equal by hash, the second hub rendering the song with `g_new` added to `strings` first (`keys`, `pads` equal) and the song after; `h_new` added to `keys` in a harp gap: new = old + `h_new` alone, every sample within 2 steps of 24 bits, and each piano and bell note keeps the take heard in it; `a0_extra` (its ID first in sort order) on 3:3: the five piano notes before it and every bell note keep their takes and `keys` is the same up to its onset; the etude's 1,000 notes: no heard take equals the previous one, all four heard, and the steps aren't one cycle. Fails on the base (no score), a draw from one stream, a round robin shared across instruments or folded in ID order, a key over the whole score |
| 2 | `#154.8b0e5b99` | `onsets.test.ts` (2) | a plucked score over 90 BPM, a 90 to 150 BPM ramp and 150 BPM: each event's note_on `t` within 1 flick of the closed form, `sample` the one it rounds to, in (t, event) order, and the render's meta on the same sample; `a4_held` on test/intune renders and reads within ±35 cents by this suite's measure, on test/sharp fails `score.render.pitch` naming `a4_held` and the cents (40 to 60), with no output. Planted `readsEventPitch` (Planted programs) passes the sharp note and this test's judge fails it |
| 3 | `#154.6e31be7c` | `cache.test.ts` (1) | g3 made louder: `keys` and `pads` keep params and inputs exactly and are cache hits with their old stems and no process; `strings` is the one miss, starting its tool, giving another stem. Fails on a key over the whole score or over the document |
| 4 | `#154.ee9b85a0` | `licences.test.ts` (1) | `deep install` of libraries under CC-BY-SA-4.0, CC-BY-NC-4.0, GPL-3.0-only, and a CC0 library with one CC-BY-NC-4.0 take: each exits non-zero naming the licence; afterwards no take of it is fetched, requested or stored. CC0 and CC-BY-4.0 libraries install. Fails on the base, which installs them |
| 5 | `#154.87a31a62` | `fetch.test.ts` (2) | offline: the plan BLOCKED naming `test/organ@1.0.0`, four fetches BLOCKED, the plan still BLOCKED, exactly one unblock ask naming `test/organ`, no authority ask, nothing stored; online: a fetch held twice on one authority ask with no request until your yes, then one request; the other take held on its own ask; `pack.rule` for test/brass fetches its takes with no ask and doesn't reach test/choir; the plan then answers its stems with the takes by hash |
| 6 | `#154.74061b19` | `rules.test.ts` (2) | `pad` at MIDI 40 and 47.52 refused with `score.pad_too_low` naming the event; 48 and 40 with `bass: true` presented with none; a sustained library preset at 40 refused, a plain one at 40 presented; 61 s and 60.6 s refused with `score.note_too_long` naming the event, 60 s presented. The twins one quantum past each threshold (1% of it) are the boundary pairs |
| 7 | `#154.54798db1` | `loop.test.ts` (1) | the bed with loop {5:1, 9:1}: each stem's `LOOPSTART` 512000 and `LOOPLENGTH` 512000, `meta.loop` {512000, 1024000}; the straight bed has none; looping strips through `media_mix` match three straight passes, one region apart, within −96 dBFS on every sample of samples 1,024,000 to 2,048,000; the planted stem looped without the fold differs by more than −40 dBFS at the second pass's start, and the same judge fails it |
| 8 | `#154.a25e77d2` | `registry.test.ts` (1) | packages/jobs/score's manifest is deepbuild/score declaring `score.render` and `score-render@1.0.0`; deep_job lists the kind held by deepbuild/score with that tool, its plug-in and build; test/score-rival is refused at install naming `score.render` and `deepbuild/score`, and the list is unchanged |
| 9 | `#154.d6804da4` | `budgets.test.ts` (3) | `benchmarks/budgets.json` has a task naming #154, valid against the merge base's (`validateBudgets`); the 60 s six-stem concert's render judged by `judgeLimit` against 60 s over five fresh runs, INCONCLUSIVE off the reference Mac; asked again, six hits and no process; the first render's six misses started at least six processes |

## The surface under test

Names the issue and the design give are used as they give them; **every name marked *(chosen)* is this job's**,
taken from the design's words and shaped like the neighbouring surfaces. The implementer builds exactly these, or a
dispute goes to a blind redraft.

### The document (`deep show` in `deep-show run`, #393's scenario; #501's `scenario` and `present`)

A film (`profile: "film"`, 64 × 64, 24 fps, `transport.sample_rate: 48000`) with:

| Field | As the tests write it | From |
|---|---|---|
| `tempo_map` | `{segments: [{at: "0s", bpm, meter: [4, 4], span: beats, ramp: "none" \| {to_bpm, shape: "linear_in_beats"}}]}`, a top-level key | #491's suite; "the film's tempo map" |
| `packs` | `["test/keys@1.0.0"]` | #1820's suite; Asset |
| a score item | `{id, kind: "score.music@1", name, order, params: {instruments, events, loop?}}`: the kind's fields in `params` | kind from the design; `params` *(chosen)*, as every kind's |
| `instruments.<id>` | `{source, stem, bass?}`; `source` one of `{sampled: {library: "owner/name@version", preset}}`, `{pluck: {preset}}`, `{synth: {preset}}` | fields from the design; the tag as the key holding the variant *(chosen)*, as a strip's `src: {asset}` |
| `events.<id>` | `{at, inst, pitch, dur, vel, pan?, gain?, attack?, release?, bend?}`: `at` a bar:beat string (`"5:2.5"`, `"2:3b"`, `"1:1.00009375"`), `pitch` a MIDI number (`47.52` too), `dur`, `attack`, `release` seconds literals (`"0.25s"`, `"61s"`), `bend` `[[seconds, semitones]]` | design; durations as seconds literals *(chosen)*, as Time and the flick writes them |
| `loop` | `{from: "5:1", to: "9:1"}` | criterion 7 |

Presets used: pluck `nylon`, `steel`, `harp`; synth `sine`, `saw`, `pad` (the As built closed list). `deep show`'s
reply: `outcome: "presented"` or `"refused"`, `issues: [{code, severity, path, ...}]`; "naming the event" is the
event's ID in the issue's JSON. Codes `score.pad_too_low` and `score.note_too_long` are the design's.

### `{call: "score_plan", doc, item}` (Score: As built)

- Ready: `stems: {name → {kind: "score.render", tool: "score-render@1.0.0", params, inputs: [{name: "samples", sha256}]}}`
  and `note_on: [{t, sample, event, stem}]`, every field read strictly; a pluck or synth stem's `inputs` may be `[]`.
- BLOCKED *(chosen form)*: any top-level field of the reply equals `"BLOCKED"` (as `media_bake` answers `state:
  "BLOCKED"`), its text names the waiting library as `owner/name@version`, and it carries no `stems`.
- The scenario's `packs: [{id: "owner/name", dir}]` (#306's) gives deep-show the library packs; its `evidence` is the
  hub's evidence store (`<home>/.deepbuild/evidence`), where the hub's fetch put the takes.

### deep_job over `deep mcp` (#1922's), on a real hub

- Run: `{op: "run", kind: "score.render", tool: "score-render@1.0.0", params: <the plan's params as JSON text>,
  inputs: <the plan's inputs as given>}`; a `many` input is passed as **one entry per file, each named `samples`, in
  the plan's order** *(chosen: the form of a list input over deep_job)*.
- Done: `{status: "done", outputs: {stem: {sha256}, meta: {sha256}}, receipt: {cache: "hit" | "miss", ...}}`. The
  outputs are read from the evidence store by hash (`<2 hex>/<62 hex>`). Process counts are the record's
  `process.starting` events from just before a call to 500 ms after its reply (#1922's).
- Failed output check: any reply not `status: "done"`, with no `outputs`, whose text names `score.render.pitch`, the
  event's ID and the cents as a number (#1922's failed shape: `{status: "failed", check, reason}`).
- List: `{kinds: [{kind: "score.render", plugin: "deepbuild/score", tools: [{tool: "score-render@1.0.0", plugin:
  "deepbuild/score", build}]}]}`.
- `meta` read: `note_on: [{event, sample, ...}]` and `loop: {start, end} | null` (the As built shape). The stem: a
  FLAC stream, 48 kHz, 2 channels, 24 bits, read by this suite's own reader (`flac.ts`: every frame's CRC-8 and CRC-16
  and the stream's MD5 checked); its Vorbis comments `LOOPSTART` and `LOOPLENGTH`.

### Libraries, the fetch and the rule (#1820's surfaces)

- A library is a pack folder: `pack.json` `{id: "test/<name>", name, version: "1.0.0", license: <SPDX>, description,
  requires: {core: "^1", modules: {}}, assets: [{path, url, sha256, size, license: {id, terms, shareable, credit},
  upstream: {url, version, modified}}], samples: {<preset> → {sustained?, zones: [{lo, hi, root, takes: [path]}]}}}`.
  Each take is a **48 kHz mono 16-bit PCM WAV** *(chosen)*, served over HTTPS on 127.0.0.1 (the shelf) under a test CA
  the hub trusts (`NODE_EXTRA_CA_CERTS`). A pack's `name` is never a module's or kind family's.
- Install: `deep install <folder>`, as you (the OS confirmation stubbed by `DEEP_HUB_TEST_CONFIRM`); a refusal is a
  non-zero exit, its stdout and stderr read together.
- Fetch: `deep_kinds {op: "fetch", pack: "owner/name@version", asset: <path>}`: `held` with `ask`, `fetched`,
  `refused`, `BLOCKED` with `ask`. Your yes: `deep inbox answer <ask> <the option whose decision is allow>`. Your
  standing rule: the cli socket's `pack.rule {pack: "owner/name", licenses: [SPDX]}`.
- `deep install packages/jobs/score` installs deepbuild/score.

### The test plug-in (criterion 8), written at test time

`test/score-rival@1.0.0`: `deepbuild.json` `{id, version, digest (packageDigest of the folder), checks:
["test.score_rival"], jobs: ["score.render"], requires: {preview: ["deep.registerCheck", "deep.registerJob"]}}` and
`index.ts`, which registers the check and `deep.registerJob("score.render", {schema: {params: {type: "object"},
inputs: {samples: {media: "audio/wav", many: true}}}, outputs: {stem, meta}, key, output_checks: ["test.score_rival"],
qualification: {fixtures: []}})` *(chosen: `many: true` declares a list input)*. It registers no tool.

### `media_mix` (#499's), criterion 7

`{call: "media_mix", doc: {transport: {sample_rate: 48000, span}, strips: {<id>: {track, src: {asset: <stem sha256>},
start: 0, in: 0, out: <the stem's length in flicks>, loop?: true, span?}}}, segments: [{from: 0, to: span, write: true}]}`
in a store holding the stems' bytes; the segment's `wav` read back. A strip with `loop: true` repeats the region its
asset's loop points give, read from the FLAC's `LOOPSTART` and `LOOPLENGTH` (As built).

## Planted programs

All in test code; none is reachable from a shipped program.

| Name | Criterion | The wrong program | Read as failed when |
|---|---|---|---|
| `readsEventPitch` (`onsets.test.ts`) | 2 | score.pitch reading each event's declared pitch where it should measure the stem: every note 0 cents off itself | it passes `a4_held` on test/sharp, so `judgePitch` returns "the check passes a4_held on the sample tuned 50 cents sharp" |
| the stem looped without the fold (`loop.test.ts`) | 7 | the straight render's region [5:1, 9:1) repeated, its last notes' tails not folded onto its start | it differs from three straight passes by more than −40 dBFS in the first second of the second pass, and `judgeMatch` at −96 dBFS fails it |
| the boundary twins (`rules.test.ts`) | 6 | a pad at MIDI 47.52 and a note of 60.6 s, one quantum (1% of the threshold) past each | each must be refused with its rule's code, while 48 and 60 s pass |
| impulses moved to their quantum's start (`154-oracle`) | 2 | a renderer that starts notes per 128-sample block | upstream's ported check names sample 896 |

The other criteria's wrong program is the merge base (and the trace lane's mutants of the new lines).

## Fixtures

All made at test time, truth by construction; nothing but these test files is committed. No recording, model output
or personal data.

- **test/keys** (CC0): `piano` (root MIDI 60) and `bell` (root 72), four takes of 0.25 s each, and `staccato` (root 60),
  four of 0.05 s. Take k of a preset is 0.3 sin(f0) + 0.2 sin((k + 2) f0), so every take is in tune at its root and
  carries a harmonic of its own: the take that sounds at a note is read from the stem (`heardTake`).
- **test/intune** and **test/sharp** (CC0): preset `a4`, root 69 in the manifest; one take of 1 s at 440 Hz, or at
  440 × 2^(50/1200) Hz. This suite's measure reads them at 0.0 and +50.0 cents before any render.
- **test/clicks** (oracle): one take, upstream's 512-sample impulse.
- **test/drones** (AC6, never fetched): `drone` (sustained) and `low`, root 40.
- **AC4's libraries**, **test/organ**, **test/choir** (CC0) and **test/brass** (CC-BY-4.0): one preset of two or three
  takes like test/keys'.
- **The song** (90 BPM, 4/4, a beat 32,000 samples): stem `keys` (piano on beats 1 and 3, 3:3 left free; bell on 2 and
  4; harp `h1` to `h4` between), `strings` (guitar, plucked nylon, `g1` to `g6`), `pads` (`warm`, synth `pad`, MIDI 55
  to 60). No two of piano, bell and harp sound at once. Edits: `g_new` on 3:3 (strings), `h_new` on 3:2.5 (harp, in a
  gap of 1.3 s on each side), `a0_extra` on 3:3 (piano), g3 at vel 0.9.
- **The etude**: 1,000 sixteenths at 240 BPM on `staccato`, note k on sample 3,000 k.
- **The plucked cues** (AC2): eleven notes over 90 BPM, a 4-bar ramp to 150 BPM and 150 BPM.
- **The bed** (AC7): `tone` (synth sine) on stem `bed` and `chime` (plucked harp) on stem `ring`, every note in bars 5
  to 8; `s_last` held from 8:3 for 2 s and `r_last` ringing from 8:4 for 1 s, both past 9:1.
- **The concert** (AC9): 60 s at 120 BPM, six stems (piano, bell, harp, guitar, pad, lead), about 700 notes.

## Legs that read BLOCKED or INCONCLUSIVE

- AC9's timing: INCONCLUSIVE wherever the perf lane's `judgeLimit` says the machine can't judge a timing (not a
  reference Mac, not on mains power, Low Power Mode on, thermal state not nominal, load over the core count), after the
  warm-up render has run; and INCONCLUSIVE when the five runs are neither all within 60 s nor all over it by the margin.
- None other: the shelf, the hub and deep-show all run here.

## Readings where the issue leaves a choice

- **"Two runs"** (AC1) are two hubs with empty caches, so each stem is rendered again rather than served from a cache;
  "after an unrelated note is added to another stem" is read on stems rendered fresh from the edited score.
- **"Changes no other note's noise"** (AC1) is read as superposition: the stem with the note equals the stem without it
  plus the note alone, within 2 steps of 24 bits. A renderer that draws noise from one stream, or limits or normalizes
  a stem, breaks it. The added note sits in a gap with no other harp note sounding, so a plucked string that rings one
  note at a time reads the same.
- **A note's take** (AC1) is heard from the stem, not read from `meta.note_on[].take`, whose index space (the zone's
  takes or the job's inputs) the design leaves open. "No take before it" holds for notes before the new note in time;
  its ID sorts first so a fold in ID order would move them. "Not one fixed cycle" reads the design's hashed start.
- **"Lands on its resolved flick within one sample"** (AC2): the plan's `t` within 1 flick of the closed form, its
  `sample` the 48 kHz sample `t` rounds to, the render's meta on that sample. The stem's own samples are judged in the
  Oracle lane.
- **score.pitch** (AC2) is the job's output check `score.render.pitch`: "fails" is a render that isn't done and keeps
  no output; "naming the event" is `a4_held` in the reply; the cents as a number between 40 and 60. This suite's own
  reading of the in-tune stem (the design's measure, `measureCents`) is held to ±35 cents too.
- **"Refused at install naming its licence"** (AC4): the SPDX ID or the design's words (CC BY-SA, NC, GPL) in the
  install's output. "A library under" a licence covers its takes' licence and, for the mixed library, one take's.
- **"BLOCKED with one unblock ask"** (AC5): the plan BLOCKED naming the library, the hub's fetches of its takes
  BLOCKED, one unblock ask in the record across all of them; "no fetch starts" is no request for the take reaching the
  shelf, read from its log.
- **Boundary pairs** (AC6): one quantum past a threshold is 1% of it (the design's rule): MIDI 47.52 and 60.6 s.
- **The straight render** (AC7) is the same score item with no loop (so the same seed and event IDs, and the same draws);
  "played three times in a row" is three copies one region (512,000 samples) apart, summed; "from the second pass on" is
  samples 1,024,000 to 2,048,000; "differs there" is the first second of the second pass. A straight stem is read as
  running until its last note's release ends.
- **"From their registrations"** (AC8): the plug-in's manifest declares the kind and tool and asks for
  `deep.registerJob` and `deep.registerJobTool`, and deep_job lists them.
- **"Renders in under 60 s"** (AC9): the six stems' deep_job calls made at once, timed from the first call to the last
  reply, each run on a fresh score item so every stem is a miss. **"Never runs on the UI thread"**: each miss runs in a
  process the hub starts (a `process.starting` event), not in the hub's or deep-show's process. **"A cached stem costs
  nothing"**: a hit that starts no process.

## Not tested

In Scope or Fields but in no criterion: credits as the union of the libraries' licences and `made_by`; the default
loop region when a strip loops a stem of a score with no `loop`; `score.far_from_sample`; an unknown preset, instrument
or library refused; vibrato, strums, the `noise`, `strum` and `detune` purposes by name; licences stated elsewhere
staying unverified until read; quota, resume and the 2.2× free-disk rule (#1820's); mix.balance and sound_lock; output
identical on another architecture; `score.procedural`, `score.key`, `score.chord`, `score.range`; the
`occurrences.<score item>.note_on` copy in the document; `stems: {name → sha256}` written back.

## Not settled

- **#1820's own suite and the licence refusal at install.** The design commit at this base refuses at install a pack
  any of whose assets is CC BY-SA, NC or GPL; #1820's `license.test.ts` installs a pack listing such assets and expects
  the refusal at fetch. The two can't both hold without #1820's fixture pack changing.
- **`meta.note_on[].take`**: whether it indexes the zone's takes or the job's `samples` inputs. Not read here.
- **A straight stem's length**: this suite needs the straight bed's stems to hold their last notes' tails past 9:1.
- **Sampled notes and detune**: if a `detune` draw pitches sampled notes off their root, the Oracle lane's impulses
  could spread past one sample under a band-limited resampler; the design names the purpose but not where it applies.
- **The clicks' bend** (Oracle lane): a bend from 30 ms past a 512-sample take changes no sample, and makes
  score.pitch list the click as unmeasured rather than measure a tone it doesn't have.
