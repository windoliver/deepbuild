# Acceptance tests for #500, part "bake": the loudness bake on the EBU test signals, and an envelope bake

Written first, from issue #500 (as of Nov 9, 2026: its Scope, its Analysis bake fields, acceptance criteria 3 and 5,
and its Proof line: "The EBU loudness signals, … and the envelope bake against its planted peak meter"), its Oracle
page, the design sections it links and those they lean on, EBU Tech 3341-2016 and Tech 3342-2016 (their Table 1s), and
the base commit of this worktree (`96b462a6`, the same tree as `0c4a4ec7`), by a job that never saw an implementation;
none existed, and no other worktree, branch or PR was read. The implementing agent doesn't edit these files (AGENTS.md,
Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Criterion 3's upstream port (libebur128's
tests) is the Oracle lane, `tests/acceptance/500-oracle/`, which reuses this part's helpers.

What was read:

- The issue (`gh issue view 500`), and its dependencies #499 and #491 as issues.
- The Oracle page: criterion 3's upstream is libebur128 `67b33abe15`, `test/tests.c` lines 246-406 ("port"); criterion
  5 has none ("a closed form from the issue").
- `docs/canvas-primitives.md`: Analysis bake (`asset` plus the decoded PCM's hash, `analyzer: id@version`, `kind:
  loudness {subblock: 10 ms, k_variant, tp_oversample: 4 | 8, channel weights by azimuth and elevation} | … | envelope
  {rate: Hz = 24, outputs: [rms, centroid]}`; "Loudness is a power bake: f64 K-weighted energy per channel per 10 ms
  sub-block, plus sample and true peaks, from which momentary, short-term, integrated, LRA and maxima derive exactly";
  "RMS and spectral centroid every 1 ÷ rate s"; a spectrum's rows, for the row convention), Sound and video on the
  picture's clock.
- `docs/technical-design.md`: Spawn and analysis bake, Dogfooding.
- EBU Tech 3341 v3.0 (2016) Table 1 and Tech 3342 v3.0 (2016) Table 1, read from the Internet Archive's copies of
  `tech.ebu.ch/docs/tech/tech3341.pdf` and `tech3342.pdf`, and the test set's `readme.txt` (channel order, versions).
- At the base: AGENTS.md; `tests/acceptance/499/mix/` (form, `deep-show run` scenario), `tests/acceptance/423/helpers.ts`
  (`pinned()`, tracked blobs) and `tests/acceptance/498/decode/helpers.ts` (`fetchFate`), whose fetch-by-hash these
  follow; `crates/deep-show/src/main.rs` (an unknown call answers `bad_input`).

What the base already does and these tests don't credit: #498's decode worker decodes WAVs for #499's mix. There is no
`media_bake` call and no analysis bake of any kind.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/500/bake --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/500/bake/tsconfig.json   # type-check
```

Each file builds `deep-show` once (`cargo build --locked --bin deep-show`, honoring `CARGO_TARGET_DIR`), copies it into
a temporary folder and fails its test when the build fails. Evidence folders are deleted after each test (AC3 writes
the set's 66 signal files, about 310 MB, into one). Node built-ins and vitest only; no process but `cargo`, `git`
(`ls-tree` and `ls-files`, read-only) and `deep-show`, none stopped by name or port. Delete
`tests/acceptance/500/bake/node_modules/.vite` after a `--root` run. **This folder must run alone**:
`scripts/lanes.mjs` needs `'tests/acceptance/500/bake/'` in its `alone` list (each file builds a cargo binary, and AC3
bakes about 26 minutes of audio); the implementer makes that edit. Runtimes: AC3 one scenario of 74 bakes, then 2;
AC5 two bakes of 3 s. The one network call is AC3's first fetch of the set.

What is deterministic: AC5 (an asset the test writes) and AC3 once the set is cached. AC3 is **BLOCKED**, never
passed, when the set can't be read: not cached and not fetchable, or its hash isn't the pin; the test fails with a
line starting `BLOCKED:` that names the cache path and the unblock step.

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a run that answers
`bad_input`, exits non-zero or writes other than one line fails every test that drove it.

## The EBU signals

The EBU loudness test set v05 (30 March 2016), `ebu-loudness-test-setv05.zip`, 91,631,421 bytes, SHA-256
`9cc500b4df83f7c21855c74dce795ef5209a752bf884253ae57d0ce512efb062`, holds Tech 3341's signals 1 to 23 and Tech 3342's
1 to 6 (68 signal files, 66 of them distinct; 3342's 5 and 6 are 3341's 7 and 8).

- **Fetched by hash on first use**, by `helpers.ts` `ebuSet()`, into `~/Library/Caches/deepbuild/ebu-loudness/` on
  macOS (`~/.cache/deepbuild/ebu-loudness/` elsewhere), or the folder `DEEP_EBU_LOUDNESS` names; never into the
  checkout. The zip is written to the cache only when it hashes to the pin.
- **From where**: the EBU publishes it on <https://tech.ebu.ch/publications/ebu_loudness_test_set>, but tech.ebu.ch
  answers automated downloads with HTTP 403. The fetch reads the Internet Archive's raw copy of the EBU's own URL,
  `https://web.archive.org/web/20170331172519id_/https://tech.ebu.ch/docs/testmaterial/ebu-loudness-test-setv05.zip`.
  It is the EBU's file: its SHA-512 (`60d022fd…dd73771`) and size equal those Gentoo's `media-libs/libebur128`
  Manifest pins for the file it fetches from tech.ebu.ch. A copy downloaded from the EBU's page in a browser and put in
  the cache folder is the same file and is used as is.
- **Checked**: the zip's SHA-256 and size; each signal file read from it against its own pinned SHA-256
  (`helpers.ts` `SIGNALS`, read once from the pinned zip); and **never committed**: no signal's git blob ID is in
  HEAD's tree or the index (AC3 asserts it).
- **License**: the set's readme says it is provided as is and "may only be used for technical testing purposes";
  nothing of it is copied into the repository.

## The surface under test

`deep-show run` (#393's convention, as the `spawn/` part's README states it) with one new call. Names the design gives
are used as it gives them; names it doesn't are marked *(chosen)*.

- **`{"call": "media_bake", "bake": Bake}`** *(chosen: the call's name)* → `{"bake": {"asset", "kind", "analyzer":
  "id@version", …readings}}`: one analysis bake of one asset in the scenario's evidence store, by its SHA-256 (as
  #499's assets). `Bake` is Analysis bake's fields with `kind` and its fields as siblings, as #499's processors write
  theirs:
  - `{"asset", "kind": "loudness", "tp_oversample": 4 | 8, "channels"?: [{"azimuth": deg, "elevation": deg} | "lfe"]}`.
    `channels` *(chosen)* carries "channel weights by azimuth and elevation": each channel's place in BS.2051's sense
    (azimuth positive to the left), `"lfe"` for one loudness leaves out; omitted, a 2-channel asset is L and R. The
    5.0 signal is given L +30°, R −30°, C 0°, Ls +110°, Rs −110°, all at elevation 0, per the set's readme.
  - `{"asset", "kind": "envelope", "rate": 24, "outputs": ["rms", "centroid"]}`.
- **Loudness readings** *(chosen: the field names)*: `"integrated": LUFS | null`, `"range": LU`, `"true_peak": dBTP`
  (the largest over channels, at `tp_oversample`), `"momentary": [LUFS | null]` and `"short_term": [LUFS | null]`:
  entry k is the reading of the 400 ms (momentary) or 3 s (short-term) window that ends at the end of 10 ms sub-block
  k, (k + 1) × 10 ms, null being −∞ (a silent window). The maxima the tables state are read from these series.
- **Envelope readings** *(chosen)*: `"rows": [{"t": flicks, "rms", "centroid"}]`, row r at t = r ÷ rate; one value
  each over the asset's channels (the tests' asset is mono). `centroid` must be a number (it is asked); only `rms` is
  judged.

### Planted programs

| Name | The wrong program | Test |
|---|---|---|
| `sample_peak_meter` | the loudness bake's `true_peak` is the sample peak (no oversampling) | AC3 |
| `envelope_reads_peak` | the envelope bake's `rms` is each row's peak magnitude | AC5 |

## Criteria to tests

| ID | Criterion | Test, and the wrong program it fails on |
|---|---|---|
| AC3 #500.5b74b67b | "The loudness bake reads EBU Tech 3341's test signals 1 to 23 and Tech 3342's signals 1 to 6 within each table's tolerance (±0.1 LU momentary, short-term and integrated, ±1 LU loudness range, +0.2/−0.4 dB true peak at 4× and 8× oversampling), the signals fetched by hash on first use and never committed; a planted meter that reads sample peaks fails signal 16, a tone at a quarter of the sample rate and 45° of phase, by about 3 dB" | `loudness.test.ts`: the set fetched and checked as above; each signal judged by its table row (below), signals 15 to 23 at 4× and at 8×. Fails on: `sample_peak_meter`, signal 16 at 4× and at 8× reading 2.5 to 3.5 dB under −6.0 dBTP (its samples sit at ±0.354, −9.0 dBFS) |
| AC5 #500.add6fff5 | "An envelope bake at 24 Hz of a 960 Hz sine of amplitude 0.5 at 48 kHz, 40 whole cycles a row, reads rms 0.3536 within 1e-4 in every row that lies inside the tone; a planted bake that reads the peak instead reads 0.5 and fails, naming the row" | `envelope.test.ts`: 0.5 s silence, 2 s of the sine (rows 12 to 60), 0.5 s silence, mono 16-bit; rows 13 to 59 each read 0.5/√2 within 1e-4. Fails on: `envelope_reads_peak`, whose first failure names row 13, reading 0.5 (within 5e-3: the sine's largest sample is 0.4990) |

AC3's judgements, each row's expected response and tolerance from its table:

| Signal | File(s) | Judged |
|---|---|---|
| 3341 #1, #2 | `seq-3341-1-16bit.wav`, `-2-16bit.wav` | every momentary reading from 0.4 s, every short-term reading from 3 s, and integrated: −23.0 (#2: −33.0) ±0.1 |
| 3341 #3, #4, #5 | `-3-16bit-v02.wav`, `-4-…`, `-5-…` | integrated −23.0 ±0.1 |
| 3341 #6 | `seq-3341-6-5channels-16bit.wav` (L, R, C, Ls, Rs) | integrated −23.0 ±0.1 |
| 3341 #7, #8 (3342 #5, #6) | `seq-3341-7_seq-3342-5-24bit.wav`, `seq-3341-2011-8_seq-3342-6-24bit-v02.wav` | integrated −23.0 ±0.1; range 5 (#8: 15) ±1 LU |
| 3341 #9 | `seq-3341-9-24bit.wav` | every short-term reading from 3 s: −23.0 ±0.1 ("constant after 3 s") |
| 3341 #10 | `seq-3341-10-{1…20}-24bit.wav` | each file's largest short-term reading −23.0 ±0.1 |
| 3341 #11 | `seq-3341-11-24bit.wav` | the largest short-term reading in each 6 s segment i (windows ending in (6i, 6i + 6] s): −38.0 + i ±0.1, i = 0…19 |
| 3341 #12 | `seq-3341-12-24bit.wav` | every momentary reading from 1 s: −23.0 ±0.1 ("constant after 1 s") |
| 3341 #13 | `seq-3341-13-{1…20}-24bit.wav[.wav]` | each file's largest momentary reading −23.0 ±0.1 |
| 3341 #14 | `seq-3341-14-24bit.wav.wav` | the largest momentary reading in each 0.8 s segment i: −38.0 + i ±0.1 |
| 3341 #15 to #23 | `seq-3341-{15…23}-24bit.wav.wav` | true peak at 4× and at 8×: −6.0, −6.0, −6.0, −6.0, +3.0, 0.0, 0.0, 0.0, 0.0, each +0.2/−0.4 dB |
| 3342 #1 to #4 | `seq-3342-{1…4}-16bit.wav` | range 10, 5, 20, 15, each ±1 LU |

## Readings where the issue and design leave a choice

- **Momentary and short-term "within ±0.1"** are read as the tables state them per signal: "M, S, I" for #1 and #2,
  "constant after 3 s" for #9 and "after 1 s" for #12 (every reading of the series once its window is full), "Max M" or
  "Max S" for #10, #11, #13 and #14 (the largest reading, per file or per segment). The series is read at every 10 ms
  sub-block end, the finest the bake's sub-blocks give; the tables' readings hold at that grid (this job checked the
  judgements against a throwaway BS.1770 meter of its own, not kept).
- **Readings before a window is full** (momentary before 0.4 s, short-term before 3 s) are not judged one by one;
  they take part in a maximum, where a partial window of a steady tone never reads above the full one.
- **The 6-channel WAVE_FORMAT_EXTENSIBLE copy of #6** is the same signal with a silent LFE; Table 1's #6 is the 5.0
  original, judged here. The Oracle lane bakes both, as libebur128 does.
- **"Fails signal 16 by about 3 dB"**: 2.5 to 3.5 dB under −6.0 dBTP, at both oversampling factors (the plant ignores
  the factor).
- **AC5's rows "inside the tone"**: row r is read at t = r/24 s; the design doesn't say whether its 1/24 s ends or
  starts at t, so a row is inside when both [r − 1, r] and [r, r + 1] (in rows) lie in the tone: rows 13 to 59. Each
  holds 2,000 samples, 40 whole cycles, so its rms is 0.5/√2 whatever its phase; the 16-bit asset changes that by about
  1e-5.

## Not tested, and why

- Onsets, beats, words, visemes, activity and spectrum kinds; `k_variant`, `params`, `runtime`; the decoded PCM's hash
  and `analyzer`'s value beyond its id@version form: in the fields, but no criterion of this part reads them (onsets
  are read through where a strip lands, in `cue/`).
- `centroid`'s value: asked (the design's default outputs) and required to be a number, not judged.
- Integrated loudness across several assets (libebur128's `ebur128_loudness_global_multiple`): no criterion reads it.

## The Oracle lane

`tests/acceptance/500-oracle/` ports libebur128's `test/tests.c` lines 246-406 onto `media_bake` (its README).
