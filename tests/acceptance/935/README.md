# Acceptance tests for #935: audio.gen, a generated sound checked on its decoded samples before an item names it

Seam, bars, tempo, loudness, stems, variants and onset, each read from the PCM by pinned analysis, never from a
model's report. Written first, blind, from issue #935 (as of Nov 11, 2026: its Scope, its five acceptance criteria and
its Proof line), its Oracle page, the design sections it links and those they lean on, and the base commit `74d867d2`
(`74d867d25a5ebae674b6ceede6059f849d51a091`, "design(#935): audio.gen's declaration, call, rules and check-time
refusal"), by a job that never saw an implementation; none exists at the base, and no other worktree, branch or PR was
read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job
(design: Dogfooding). Criterion 4's upstream loudness test is ported in `tests/acceptance/935-oracle/`.

## What was read

- The issue (`gh issue view 935`). Each test's name starts with its criterion's ID, `#935.` and the first 8 hex digits
  of SHA-256 of the checkbox's text after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`'s
  `criterionId`), recomputed here: AC1 `#935.dd5d077f`, AC2 `#935.1099168d`, AC3 `#935.4f2d6eac`, AC4 `#935.003bdbdb`,
  AC5 `#935.94f4cb46`.
- The Oracle page (`doneright/oracles/issues/935.md`, DeepBuildAI/deepbuild, branch `doneright`): criterion 4 has an
  upstream loudness test to port (its own folder); criteria 1, 2, 3 and 5 have none, "proven by our own fixture and its
  planted wrong twin".
- `docs/canvas-primitives.md` at the base: Check input: asset kinds: generated sound (all of it: the `sounds` map,
  `music` and `sound` entries, `media_gen` and its reply, the codes, each rule's measure, the 10 ms onset limit, the
  state, the issue shape, `audio.gen.unpassed` at check); Check input: asset kinds; Asset; Strip and track (and its
  generator sources); Bus; Spawn, Spawn: variants, Spawn: variant and span; Analysis bake; Generation job; Foley
  `foley.render@1`; Loudness and caption profiles; Document envelope, Patch, Revision; What holds a document to its
  rules.
- `docs/technical-design.md`: Blocks for plug-ins that do real work; Spawn and analysis bake; Score and foley;
  Dogfooding. `AGENTS.md`.
- At the base, for surfaces and conventions only: `crates/deep-show/src/main.rs` (the scenario's `planted`; an unknown
  call or plant answers `bad_input`), `mixdown.rs` (`media_mix` takes its document inline as `doc`; `media_bake`),
  `bake.rs` (the beats kind reads a record), `evidence.rs`; `crates/deep-canvas-media/src/module.rs` (`media.strip@1`,
  the rules on items, `strips_of`), `doc.rs`, `lib.rs` (`PLANTED`), `analysis/model.rs` (the tempo rule);
  `crates/deep-canvas/src/document/apply.rs` (`create {item}`); `packages/jobs/bakes` (the manifest and `host/host.py`).
  The suites `tests/acceptance/1819/` (whose world this suite's AC1 uses: the hub, `deepbuild/bakes`, the model host,
  `bake.beats` records by hash), `1818/`, `500/bake/`, `500-oracle/`, `499/module/` and its AC10 redraft (a film stored
  at revision 0, patches through `deep_show`, `revisions`).

What the base already does and these tests don't credit: #1819's `media_bake` beats kind on a `beat-this@1.1.0`
record, deep_job's `bake.beats` and the model host; #500's loudness bake; #499's `media.strip@1` and the `strips` map.
There is no `media_gen`, no `sounds` map, no `audio.gen.*` code and no `audio.gen.unpassed` refusal.

## Run them

```sh
npm ci                                           # once
npm run build --workspaces                       # AC1 runs packages/cli/dist/main.js
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked -p deep-hook   # AC1's hub won't start without it
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run tests/acceptance/935 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/935/tsconfig.json       # type-check
```

The vitest path `tests/acceptance/935` also matches `tests/acceptance/935-oracle/`, so that line runs the Oracle lane
too. `BASE-FAILURE.txt` holds the run at the base: every test fails there, each at the assertion it names.

- **One at a time:** each file builds `deep-show` (`cargo build --locked --bin deep-show`, honoring
  `CARGO_TARGET_DIR`), and `tempo.test.ts` starts a hub and the model host on the fixed port 8719 through #1819's
  helpers, so the implementer adds `tests/acceptance/935/` to `alone` in `scripts/lanes.mjs` (not done here: this job
  writes tests only). A model host this suite didn't start already answering on 8719 fails AC1 with a line starting
  `BLOCKED:` (#1819's helper) and stops nothing.
- **Time:** every test has a one-hour timeout. AC2 to AC5 need only deep-show; AC1 also runs the tracker twice on
  38.4 s of audio (the host's first start installs its packages through `uv` and fetches its weights).
- **Needs:** for AC1, `uv`, `ps`, and network for the model host's first start only; nothing else beyond Node and cargo.
- **Safety:** every folder is a temp folder removed after its test or file; AC1's processes are #1819's helpers' (the
  hub and `deep` with `HOME` in a temp folder, the model host by the process group it leads), each stopped by its PID.
  No paid or remote model is called.
- **The proof** (the issue's Proof line: each fixture's audio.gen readings, the tracker's tempo, the seam's measures as
  audio.gen reports them, the refused item, each planted result's failure) is written to `$TMPDIR/deep-935-proof/`,
  rewritten each run.

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a scenario that
isn't answered ok fails the test that drove it; the clean bed with no beats record must read BLOCKED, naming the
tracker and its PCM's hash.

## The fixtures: truth by construction

All are made by the tests at run time (`fixtures/synth.ts`), put in the evidence store by hash, and never committed.
Each is one channel of 32-bit float samples at 48 kHz, so its decoded PCM is its samples (deep-codecs keeps IEEE floats
as they are) and the test knows the PCM's hash before any bake does. Levels are set by a BS.1770 meter in
`fixtures/synth.ts` (K-weighting at 48 kHz; 400 ms blocks every 100 ms gated at −70 LUFS and −10 LU; a take shorter than
400 ms read as the mean of its whole 10 ms sub-blocks, as the design's row reads it).

- **The bed** (AC1, AC2, AC3; 4 bars of it in AC5): 4/4 at 100 BPM, 16 bars, exactly 1,843,200 samples (38.400 s): a
  kick on beats 1 and 3, a snare (two tones and a noise burst) on 2 and 4 and a closed hat on every off-beat eighth (the
  `drums` stem), a 50 Hz drone that starts at its peak (`bass`) and an A major chord (`pad`). Every tone has a whole
  number of cycles over the bed and every drum's tail is wrapped from the end to the start, so the bed played twice is
  the bed played on. The mix is the three stems added sample by sample. Set to −23 LUFS, the `music` bus's target;
  true peak −3.5 dBTP; first sample at −60 dBFS or above: sample 0.
- **Planted results:** the bed rendered at 96 BPM for the same 38.4 s (AC1); the clean bed's file with its region
  declared 38.2 s, 1,833,600 samples, 15.9167 bars of 2.4 s (AC1); the clean bed with its last 480 samples cut, its
  region its whole new length, so its seam `end` is 1,842,720 (AC2); the clean stems with `drums` moved 48 samples
  later, its length kept (AC3).
- **The takes** (AC4, AC5): a coin pickup (B5 for 60 ms, then E6, with two quieter harmonics) in 3 levels at −28, −22
  and −16 LUFS, 4 round robins each. Take (i, j) is detuned 30 × (4i + j) − 165 cents and lasts
  0.3 × (1 + 0.05 × (j − 1.5)) s, 0.2775 to 0.3225 s. **Planted results:** every take replaced by take 1/0 (AC4); take
  2/1 with a 4 ms raised-cosine bump of peak +0.4 dBFS in front, the take after it set back so the whole stays at
  −16 LUFS (AC4, AC5).

**Checked once by hand** (throwaway scripts, not kept and not part of the suite), with the design's measures as this
job reads them. These numbers are this job's, not expected values; the tests hold audio.gen only to the issue's.

- Clean bed: loudness −23.000 LUFS; seam step 0.0039 against a 99th percentile of 0.094 (ratio 0.04); seam flux, the
  largest over the 3 frames that straddle the join, 162 against a 99th percentile of 237 (ratio 0.68; summing all 1024
  bins instead of 513, 290 against 462). The join lands on a downbeat, where only the kick starts; the snares and hats
  are the sharpest frames.
- Cut bed: seam step 0.251 against 0.094 (2.7 times the 99th percentile); flux 214 against 237, so the step is what
  fails it.
- Stems: the clean residual −171.8 dBFS; with drums 1 ms late −27.50 dBFS (RMS 0.0422), whose correlation with the
  drums stem is −0.545 against 0.0007 (bass) and 0.014 (pad).
- The 96 BPM bed (38.4 s): −23.0 LUFS, true peak −4.0 dBTP, its seam within its own percentiles (step 0.27, flux 0.70
  of them); its 16 bars at the declared 100 BPM are whole, so tempo is the rule it breaks.
- The takes: each within 0.001 LU of its target; true peaks −22 to −10 dBTP; durations within 7.5% of the median; the
  closest pair 4.1 dB apart in log-spectral distance; the hot take at +0.400 dBTP, −15.999 LUFS, at least 7.9 dB from
  every other take.
- `beat-this` 1.1.0 (checkpoint `final0`), run through the base's own `packages/jobs/bakes/host/host.py` on a private
  port, read the clean bed's beats on its grid to the frame: 100.000 BPM by the design's tempo rule; the 96 BPM bed
  95.996 BPM. A 40 s render of it read 96.395: beats numbered by the median interval of 20 ms frames (0.62 s) drift a
  number after beat 62, so the planted bed is cut to the 38.4 s the request asked for.

## The surface under test

Names the design gives are used as it gives them; names it doesn't are marked *(chosen)*.

1. **The document `media_gen` reads:** `{transport: {sample_rate: 48000}, strips: {}, buses, sounds}`, inline as
   `media_mix`'s `doc` *(chosen: the design names `media_gen {doc, sound: ID}` and the media module's calls take their
   document inline)*. `buses`: `{music: {out: "master", loudness_target: -23}, master: {}}` *(the bus name and target
   chosen)*.
2. **A `sounds` entry** holds its kind as `kind`, its fields beside it *(chosen: as Processor's and the analysis
   bake's kinds are written)*, every file by its 64-hex SHA-256 *(chosen: the issue reads an asset "by hash", as a
   strip's `src.asset` is at the base)*:
   - `{kind: "music", asset, tempo: 100, meter: "4/4", loop: {start: 0, end}, bus: "music", beats?, stems?}`, `beats`
     the record's SHA-256, `stems` `{drums, bass, pad}` by hash;
   - `{kind: "sound", variants: [{target, takes: [hash]}]}`, one entry per level.
3. **`media_gen`** (`{"call": "media_gen", "doc", "sound"}` in `deep-show run`'s scenario, one reply per call), as the
   design fixes it: `{gen: {sound, state: PASS | FAIL | BLOCKED, readings, issues, blocked}}`, each issue `{code, path,
   actual, what}` with `path` `sounds/<ID>` or under it. `readings` and `blocked` have no shape in the design: the
   tests write them to the proof and read nothing from `readings`; of `blocked` they read only that its JSON holds the
   analyzer and the PCM's hash.
4. **AC1's records** are made as #1819's suite makes them (its helpers): media_bake BLOCKED keeps the PCM, deep_job runs
   `bake.beats` on `beat-this@1.1.0` through `deep mcp`, and media_bake with the record reads `tempo`.
5. **AC5's film:** a `film` stored at revision 0 in the scenario's `docs` (#96), its `sounds` and `buses` beside its
   `items` and `assets` (every file licensed `CC0-1.0`, as the AC10 redraft licenses its recording), one layer written
   by the agent. Each patch is on revision 0 and holds one op, `create` of a `media.strip@1` item (`{track, src:
   {asset}, start: "0s", bus: "music"}`); then `revisions`.

### Planted programs and results

| Name | Selected by | The wrong program or result | Criterion | Read as failed when |
|---|---|---|---|---|
| the 96 BPM bed | the fixture | a bed generated at 96 BPM, declared 100 | AC1 | it passes, or no `audio.gen.tempo` names the tracker's tempo of it within 0.06 BPM |
| the 38.2 s region | the fixture | the clean bed declared with a 38.2 s region | AC1 | it passes, or no `audio.gen.bars` names 15.9167 within 0.01 |
| the cut bed | the fixture | the bed less its last 10 ms | AC2 | it passes, or no `audio.gen.seam` names 1842720 |
| the late drums | the fixture | the stems with `drums` 1 ms late | AC3 | it passes, or no `audio.gen.stems` names `drums` and the residual |
| one file 12 times | the fixture | every take the same file | AC4 | it passes, or a pair of the 66 is named by no `audio.gen.same`, or one names other than two takes |
| the hot take | the fixture | take 2/1 at +0.4 dBTP | AC4, AC5 | it passes, or no `audio.gen.peak` names it |
| `unpassed_on_fail_only` | `deep-show run`'s `planted` *(chosen)* | the check at show refuses a strip only when its sound's audio.gen is FAIL, so a BLOCKED one goes through | AC5 | the strip naming the BLOCKED bed applies, and the judgment fails naming its asset; the hot take's strip is still refused |

## Criteria to tests

| AC | ID | File | Test |
|---|---|---|---|
| AC1 | `#935.dd5d077f` | `tempo.test.ts` | the clean bed with no record is BLOCKED naming `beat-this@1.1.0` and its PCM's hash, with no issue; the tracker reads it 100 ± 0.5 and the 96 BPM bed 96 ± 0.5; with its record the clean bed (stems declared) is PASS with no issue; the 96 BPM bed FAILs with `audio.gen.tempo` naming its measured tempo; the 38.2 s region FAILs with `audio.gen.bars` naming 15.9167 |
| AC2 | `#935.1099168d` | `seam.test.ts` | the clean bed has no `audio.gen.seam`; the cut bed FAILs with `audio.gen.seam` naming 1842720 |
| AC3 | `#935.4f2d6eac` | `stems.test.ts` | the clean stems raise no `audio.gen.stems`; the late drums FAIL with `audio.gen.stems` naming `drums` and the residual, −27.50 dBFS within 0.1 dB (or its linear RMS within 1%) |
| AC4 | `#935.003bdbdb` | `variants.test.ts` | the 12 clean takes PASS with no issue; one file 12 times FAILs, every one of the 66 pairs named by an `audio.gen.same` naming exactly its two takes; the hot take FAILs with `audio.gen.peak` naming it |
| AC5 | `#935.94f4cb46` | `unpassed.test.ts` | strips naming the BLOCKED bed and the hot take are refused at revision 0 with `audio.gen.unpassed` naming each asset; a strip naming a clean take applies as revision 1, current; under `unpassed_on_fail_only` the bed's strip gets through and the judgment fails naming the bed's asset |

## What the implementer must add

- `alone.push('tests/acceptance/935/', 'tests/acceptance/935-oracle/')` in `scripts/lanes.mjs`.
- `media_gen` in `deep-show run`, the document's `sounds` map with its `music` and `sound` entries as above (the base's
  document check reads `sounds` as `unknown_field`), the rules and codes of the design's row, and its reply.
- At check, `audio.gen.unpassed` refusing a `media.strip@1` item (and, per the design, a `strips` entry or a spawn
  template) that names an asset of a `sounds` entry whose audio.gen isn't PASS.
- The plant `unpassed_on_fail_only`, named in the scenario's `planted` (as `deep_canvas_media::PLANTED`'s are).

## Readings where the issue and the design leave a choice

- **"Naming" a number:** the number appears in the issue's `actual` or `what` (a Unicode minus read as "-", thousands
  separators in `what` dropped); `path` and `code` aren't read for numbers, so no sound ID can name one. The tempo
  within 0.06 BPM of media_bake's reading of the record; the bar count within 0.01 of 15.9167 (unrounded, as the
  design asks); the seam's offset exactly; the residual within 0.1 dB.
- **"Naming" a take or a stem:** a take by its place in its entry, `variants/<i>/takes/<j>`, anywhere in the issue (the
  repeated file's takes share one hash, so only a place tells them apart), or by its hash when its file is its own; a
  stem by its name anywhere in the issue. "The stem that correlates most" is read as the largest correlation in size: a
  shifted stem leaves a residual of its own difference, which correlates with it negatively.
- **"Generated at 96 BPM":** the bed made at 96 BPM for the 38.4 s a 16-bar, 100 BPM request asks for, declared as
  asked. **"A region of 38.2 s":** the clean file with that region. **"Last 10 ms cut":** the file 480 samples shorter,
  its region its whole length. **"Shifted by 1 ms":** 48 samples later.
- **The 12 variants:** 3 levels of 4 round robins, as foley's 12 variants are, all 66 pairs held to distinctness.
- **AC2's and AC3's clean results** are judged by their own rule's code alone, with no beats record, so a tracker that
  can't run never fails them; AC1 holds the same bed, stems declared, to PASS on every rule.
- **"Refused at check, naming the asset":** the patch's `outcome` is `refused`, its `rev` 0, and an
  `audio.gen.unpassed` issue's JSON holds the asset's hash. The issue's path, the sound and the state it also names
  (the design's) aren't read. "Before audio.gen passes" covers both a BLOCKED result (no beats record yet) and a FAILed
  one.

## Not tested, and why

- The onset rule's failure, a bus with no target (BLOCKED, naming the bus), a stem of another rate or channel count,
  the duration and level rules' failures, a take under 400 ms read by its sub-blocks against a meter of the design's,
  `made_by` never being read, the PCM kept by `media_gen` for the job, and the refusal of a `strips` entry or a spawn
  template: in the design, but no criterion reads them. The clean fixtures meet each, so a wrong one fails AC1 or AC4's
  PASS.
- A region within 1 ms of 38.400 s but not exact: the criterion's tolerance; the clean region is exact.
- Generation kinds, candidates, Spawn playing a result (#1064), voices, live synthesis: out of the issue's scope.

## Not settled

- **The entry's shape and `doc` inline** (surface 1 and 2) are this job's reading; another named surface is a dispute
  for the redraft, not an edit here.
- **The seam's measures** have margins this job checked by hand (above) under its reading of "frames inside the
  region" (whole frames in the first copy) and of the flux's bins; another reading moves the numbers, not the verdicts,
  by the margins shown.
- **Port 8719** is shared by every worktree on this Mac, so two runs of AC1, or of #1819's suite, can't overlap.
