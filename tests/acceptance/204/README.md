# Acceptance tests for #204: synth@1 plays presets over a closed node list, with params that follow the picture

Written first, from issue #204 (as of Nov 12, 2026: its Scope, its Fields, its fifteen acceptance criteria and its
Proof line), its Oracle page, the design rows and sections it links and those they lean on, and the base commit of
this worktree, `4a0910cf4` ("design(#204): the osc's waves, the shaper's curves and the crush's step, written out as
laws", on `59f35b217`, "design(#204): synth@1 as built: …"), by a job that never saw an implementation; none existed,
and no other worktree, branch or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). The two criteria the Oracle page pins upstream tests
for (1 and 6) also have their ports in `tests/acceptance/204-oracle/`.

What was read:

- The issue (`gh issue view 204`), and its Oracle page (`doneright/oracles/issues/204.md` in DeepBuildAI/deepbuild,
  branch `doneright`): upstream tests for criteria 1 and 6, the other thirteen ours.
- `docs/canvas-primitives.md` at `4a0910cf4`: Synth `synth@1` and its As built (#204) paragraph (where a synth sits,
  presets in a pack, preset fields, edges, the nodes and their laws, the block rule, expressions, checkpoints, the pack
  check, the cost table and the sweep, the derived tail); Strip and track (and its generator sources); Bus; Processor;
  Processor: shaper, crush and modulate; Spawn (and its variants, variant and span, tempo grid); Device gate; Channel
  and key; Logic `logic@1`; Logic: occurrences; Pack; Score and foley rows.
- `docs/technical-design.md`: Bus, processor and emitter; Spawn and analysis bake; Score and foley; Narration,
  captions and profiles (R 128); Dogfooding.
- At the base: AGENTS.md; `crates/deep-show/src/main.rs` (the `deep-show run` scenario, `planted` routing,
  `install_pack`), `mixdown.rs` (`media_mix` and its reply: segments, `seek`, `taps`, processors' rings), `gate.rs`
  and `audio.rs` (`open` with a media document, `play` with a gesture serial, `handed`, the test backend), `export.rs`
  (the export's sound, `pcm_hashes`, loudness profiles), `spawn.rs` (spawn voices, `voices`), `logic.rs` (a document's
  logic items baked for the mix), `packs.rs` (`install_pack`); `crates/deep-canvas/src/document/packs.rs` (the manifest's
  keys); `crates/deep-canvas-media/src/lib.rs` (`PLANTED`), `mix.rs` (`Planted`, the `Player`, `BLOCK`, seek and
  checkpoints), `ring.rs`, `eq.rs` (the bandpass is the cookbook's 0 dB-peak form), `delivery.rs` (R 128);
  `deep-logic`'s `piece.rs` (a logic item's params); `scripts/benchmark.mjs` (`fingerprint`, `judgeLimit`) and
  `scripts/proof-change.mjs` (criterion IDs); the suites `tests/acceptance/1818/`, `499/mix/`, `499/clock/`,
  `498/gate/`, `500/spawn/`, `544/`, `1163/`, `501/`, `502/`, `154-redraft/` and `200/` (form, helpers, plants).

What the base already does and these tests don't credit: #499's `media_mix` mixes asset strips, buses and processors
with checkpoint rings and per-processor taps; #500's spawns start asset voices from a baked list; #498's gate and
#499's live transport play a media document after your gesture; #501 and #502 export a film with its loudness profile;
`install_pack` admits packs. There is no synth: a strip or a Spawn template whose `src` is `synth` is refused
(`bad_media`), a manifest with `presets` is refused at its pack check, and no planted name below exists.

## Run them

```sh
npm ci                                            # once, if node_modules is missing
npm run build --workspaces                        # once in a fresh worktree: vitest.config.ts loads workspace packages
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node scripts/throttle.mjs build --wait 240 -- scripts/lease cargo build --locked --bin deep-show
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/204 --testTimeout=3600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/204/tsconfig.json   # type-check
rm -rf tests/acceptance/204/node_modules/.vite                               # the cache vitest leaves under --root
```

Each file builds `deep-show` once (`cargo build --locked --bin deep-show`, honoring `CARGO_TARGET_DIR`), copies it into
a temporary folder and fails its tests when the build fails. Fixture packs, evidence stores and export folders are
temporary and deleted after each test. Node built-ins and vitest only; no process is started but `cargo`, `deep-show`
(and the workers it starts) and `git` (the budget test's merge base), each waited for, none stopped by name or port; no
network. **This folder must run alone**: `scripts/lanes.mjs` needs `'tests/acceptance/204/'` in its `alone` list (each
file builds a cargo binary, criterion 7 draws and encodes a film, and `budgets.test.ts` times work); the implementer
makes that edit. Every test but the budgets is deterministic: every signal and list is written by the test or the
synth, from fixed numbers and seeds.

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a run that answers
`bad_input`, exits non-zero or writes other than one line fails every test that drove it; a WAV that isn't in the
evidence store, doesn't hash to its name, isn't float, or whose samples don't hash to the reply's `sha256` fails. The
budget tests are INCONCLUSIVE off a reference Mac in a fit state, which fails them as `INCONCLUSIVE: …; this is not a
pass`.

`BASE-FAILURE.txt` is the run at the base: every test fails, because the base has no synth (README: What the base
already does), not for a mistake in a test.

## The surface under test

`deep-show run` (#393's convention): one scenario line on stdin, `{"evidence", "planted"?, "calls": [...]}` (and, for
the panel world, #498's `sessions`, `processes`, `clock`, `displays`, `window`, `panels`, and #501's `docs`), one
answer line `{"ok": true, "replies": [...]}`. Times are flicks (705,600,000 a second; a sample is 14,700 at 48 kHz and
16,000 at 44.1 kHz) or the design's time literals. Names the design gives are used as it gives them; names it doesn't
are marked *(chosen)*.

### Packs that carry presets

- **A fixture pack** is a folder written at run time, `pack.json` holding `{name, version: "1.0.0", license, description,
  requires: {core: ">=0.0.0", modules: {media: ">=0.0.0"}}, presets: {"<name>@1": Preset}}` (the design's `presets:
  {<name>@<major> → preset}`; requiring the media module, which declares `synth.preset@1`, is *(chosen)*), installed
  with #306's `{"call": "install_pack", "id": "test/<name>", "dir"}` → `{"outcome": "installed" | "refused", "issues":
  [Issue]}`.
- **Preset**: `{nodes: {ID → Node}, edges: [[from, to, input]], out: ID, params: {name → {unit, range: [low, high],
  default}}, cost}`, the design's. A **Node** is `{"kind": "<node>", …its fields}` *(chosen: the Processor's form, `kind`
  beside its fields, as #499's and #1818's documents write a processor)*, with the design's field names (`osc {wave,
  hz}`, `noise {color}`, `env {attack, hold, decay, sustain, release}`, `biquad {type, freq, q, gain}`, `shaper
  {curve, drive, mix}`, `crush {bits, hold_hz, mix}`, `delay {time, feedback, mix}`, `gain {gain}`, `mix`); a numeric
  field is a number or a param's name. A param's `unit` is a word *(chosen: `Hz`, `s`, `dB`, `amplitude`, `fraction`;
  the check reads only that there is one)*. `cost` is the cost table's multiply-adds at defaults, which every fixture
  states exactly, but `heavy@1`'s.
- **A refusal** (criteria 4 and 10): `outcome: "refused"` with an issue whose `path` is `presets/<name>@1` or under it
  (the design's "refusing at `presets/<name>@<major>`"); the tests read what it names from the issue's `path`,
  `actual` and `what` together, as text: an edge as its `[from, to, input]` JSON or as the path
  `presets/<name>@1/edges/<index>` *(chosen: either)*; a node by its ID; a sweep's render by the param's name, its
  value (1.05) and the first sample over 4.0 as a sample index *(chosen: an index, counted from the render's first
  sample)*.
- **A document pins a pack** as a document's `packs` does (`["test/<name>@1.0.0"]`), and names a preset as
  `<pack>.<name>@1`, the pack's name half (the design's `<pack>.<name>@<major>`).

### Synth sources

- **On a strip**: `{"track", "src": {"synth": {"preset", "params": {name → expression}, "voices", "seed",
  "byte_budget"?}}, "start", "span"}` (the design's; no `in` or `out`). A synth strip starts at its voice's start, its
  source's own start, so Strip and track's 5 ms edit fade isn't applied there; it ends at its span's fade.
- **In a Spawn template**: `play: {"src": {"synth": …}, "span": flicks}` (the design's), on #500's Spawn: `{on: {list,
  kinds}, play, max_voices?, steal?, seed}` over a baked list given as data in `occurrences` (#500's form).
- **Expressions** *(chosen: text in the closed function list's expression language, as #544's Spawn gain reads it)*:
  `"60 + 4 * speed"` (a channel by its ID), `"fader.gain"` (a logic item's scalar output), `"100 + 10 * speed"` (an
  occurrence's field), `"-100"` (a number).
- **A channel** in a document: the Channel row's `{target, type: "f32", keys: {ID → {t, value, interp}}}`, read by the
  synth by its ID. In a media document that has no items, its `target` names nothing the mix reads *(chosen: kept,
  as the Channel row gives every channel one)*.
- **A logic item** in a media document: #544's `items.<id>: {id, kind: "logic@1", name, order, params: {program,
  step_rate: 60, writes: {gain: {type: "f64"}}}}`, its program put in the evidence store and listed in `assets`.

### `media_mix` (#499), and what this suite reads of it

`{"call": "media_mix", "doc", "segments": [{"from", "to", "write"?}]}` → #499's `{"mix": {"sample_rate", "segments":
[{"first", "frames", "channels", "sha256", "wav"?, "taps", "seek"}], "processors", "voices"?}}`, the transport's rate
48 kHz or 44.1 kHz. Added *(chosen)*, in #499's forms:

| Field | What it holds | Read by |
|---|---|---|
| `mix.synths.<strip ID>` | each synth strip's report: `{preset, voices, tail: flicks, render_ms, ring: {budget, bytes, peak_bytes, spacing, checkpoints: [{t, bytes}]}}`, the ring in the processors' report form | criteria 8 (`voices`, `render_ms`), 9 (`ring`), 12 (`tail`) |
| `segments[i].taps["<strip ID>/<node ID>"]` | the SHA-256 of that node's output over the segment, as a processor's tap is | criteria 2, 9, 15 |
| `segments[i].taps["<spawn ID>.<k>/<node ID>"]` | the same for the k-th voice of a Spawn, in `voices` order among that spawn's voices | criterion 13 |
| `segments[i].seek.<strip ID>` | `{restored, rendered_from}` for a synth strip, as for a processor: the checkpoint it restored (null for none) and where it rendered from | criteria 2, 8, 9 |
| `segments[i].seek_ms` | the time the segment's seek took, its restore and its render forward, in ms (null for no seek) | criterion 8 |
| `render_ms` (in `mix.synths.<strip ID>`) | the time the strip's voices took to render over the call's segments, in ms | criterion 8 |

### The panel world (criteria 3, 5 and 7)

#498's and #499's, unchanged: `install_pack`, `open` with a `media` document (or a film presented in the panel's
`docs` entry, #1163), your click (`input` down and up; the press's reply holds its `serial`), `play` with that
`serial` (or with a `session`, or neither: refused), `gate` (`{owner, granted_by, state}`), and `handed`
(`{sample_rate, channels, first, frames, sha256, wav}`, what the live transport handed the gate over the document's
time). Every call carries `at`.

### The film world (criterion 7)

#501's and #502's, unchanged: `deep show` of a film from your shell, `export` (`doc`, `out`, `video: {codec: "h264"}`,
`audio: {codec: "pcm"}`, `loudness_profile`?) → `{outcome: "exported", receipt: {pcm_hashes, loudness_profile,
integrated, true_peak, delivery: {integrated, true_peak}, …}}`, and #498's `media_decode` of the delivery. The engine
film is a `film` document (320 × 180, 24 fps, 48 kHz, a camera, a ground and a car) holding the speed channel and the
synth strip.

## Fixtures

All built at run time in the test files and `helpers.ts`; nothing is committed but the code.

- **The engine** (`engines.engine@1`, criteria 1, 7, 9; helpers `ENGINE`, `engineFilm`): a sine at the param `hz`
  (range [60, 180] Hz) times 0.5; the strip `engine` gives `hz: "60 + 4 * speed"`. The speed channel: 0 m/s at 0 s to 30
  at 4 s, linear; to 12 at 6.001 s (sample 288,048, inside block 2,250); held to 10 s. So over [0, 4 s) the engine is
  sin 2π(60t + 15t²) exactly by the laws: a param linear in t, ramped across each block from one block's reading to
  the next, is the line itself, and the phase advanced by the mean of a sample's frequency and the next one's is its
  exact integral.
- **The seek fixture** (`motors.motor@1`, criterion 2): saw 110 Hz and pink noise × 0.2, mixed; a lowpass (Q 2) at
  `cutoff: "1000 + 800 * sweep"`, the channel `sweep` keyed at 0, 1.3, 2.9, 4.1, 5.77, 7.3, 8.61, 9.43 and 10 s; a
  0.3 s delay (feedback 0.4, mix 0.3); × 0.2.
- **The fader** (criterion 3): the logic item `fader`, WebAssembly written by hand (helpers `faderProgram`, its text
  in the comment), writing `gain` = 0 before step 120 and 1 from it; `faders.gated@1`, a 375 Hz square × `level` × 0.25.
- The other presets are in their files: `hots.hot@1` (5), `howl`, `wobble`, `heavy` and their fixed twins (4),
  `regenhot`/`regensafe` `ring@1` (10), `plucks.pluck@1` and `steals.voice@1` (6, 13), `quiet.*` (11),
  `tails.resonant@1` (12), `nodes.shaped@1` and `nodes.crushed@1` (15), `drones.drone@1` and `sweeps.sweep0…49@1` (8,
  14).

## Planted programs

Each is a wrong program named in the scenario's `planted`, as #499's, #500's and #1818's are; the implementation adds
each to the scenario's `planted` names and builds it. Each test runs the real program, then its wrong one, and asserts
that the wrong one fails, naming what the criterion says it names.

| Name (`planted`) | The wrong program | Test | Must fail naming |
|---|---|---|---|
| `synth_holds_params_per_frame` | a synth evaluates each param once per 60 Hz frame (800 samples at 48 kHz) and holds it, instead of once per 128-sample block with a ramp across the block | `engine.test.ts` (AC1) | the first block whose residual passes −80 dB, in the first frame; its whole residual over −60 dB |
| `osc_phase_f32` | an `osc` keeps its phase as an f32 fraction of a cycle instead of a u64 | `seek.test.ts` (AC2) | the node `tone` and the first sample that differs after a seek |
| `synth_grid_from_seek` | after a seek, a synth's block grid starts at the seek's sample instead of at the graph's sample k × 128 | `seek.test.ts` (AC2) | the node `filter` and the first sample that differs; no node before it |
| `synth_reads_logic_per_frame` | a synth reads logic arrays once a 60 Hz frame, so a logic step reaches its params late | `logic.test.ts` (AC3) | block 750, in the bake and live |
| `synth_bypasses_master` | a synth's voices are routed around the master (and its true-peak limiter) to the device gate | `gate.test.ts` (AC5) | the strip `hot` |
| `spawn_synth_starts_next_block` | a Spawn starts each synth voice at the first block boundary at or after its occurrence | `spawn.test.ts` (AC6); also the Oracle port's `sample-accurate.test.ts` | hit 0 (27 samples late); in the port, hit 1 at offset 3 |
| `export_synth_block_64` | the export renders synths with 64-sample blocks; the live render is unchanged | `export.test.ts` (AC7) | the first 128-sample block where the delivery leaves the live render, at the latest block 2,250 |
| `synth_ring_drops_oldest` | past its byte budget a synth's checkpoint ring drops its oldest checkpoint instead of doubling its spacing | `ring.test.ts` (AC9) | the seek to 30.5 s, rendered 30.5 s forward from 0 |
| `shaper_bias` | the `shaper` node adds a bias of 0.001 to its output | `silence.test.ts` (AC11) | the node `shaper`, and no other |
| `synth_tail_halved` | a synth states half the tail the derivation gives | `tail.test.ts` (AC12) | the preset `tails.resonant@1` and its level at the stated tail |
| `steal_keeps_filter_state` | a stolen voice started again keeps its `biquad`'s state | `spawn.test.ts` (AC13) | the node `filter` |
| `crush_7_bits` | the `crush` node quantizes to 7 bits whatever its `bits` | `nodes.test.ts` (AC15) | the node `crush`, and no other |

Criteria 4 and 10 are refusals of wrong presets, each its own fixture; criteria 8 and 14 are budgets. None needs a
planted program.

## Criteria to tests

IDs are `scripts/proof-change.mjs`'s: the first 8 hex digits of the SHA-256 of each criterion's text, trimmed, white
space collapsed. Each test's name starts with its ID.

| ID | File | What it asserts, and the wrong program it fails on |
|---|---|---|
| AC1 `#204.47d50ee6` | `engine.test.ts` | The engine fixture's [0, 4 s) by `media_mix`: each channel fitted to sin 2π(60t + 15t²) (f64) with one gain (over 0.1), residual ≤ −80 dB. `synth_holds_params_per_frame`: residual > −60 dB, the first block over −80 dB named, in the first frame |
| AC2 `#204.a92b7fff` | `seek.test.ts` (3) | At 48 and 44.1 kHz, seeks to 9 s and 9 s + 37 samples after playing to 10 s, in one transport: the [S, 10 s) segments equal by master hash, by sample and at every node's tap; the seek restores a checkpoint at or before S and renders at most 1 s forward. `osc_phase_f32` names `tone` and a sample; `synth_grid_from_seek` names `filter` and a sample, and no earlier node |
| AC3 `#204.0e49d0c7` | `logic.test.ts` (2) | In the bake (`media_mix`) and live (`handed`), |x| ÷ A is 0 before sample 96,000, (n − 96,000) ÷ 128 in block 750, 1 from block 751, within 10⁻⁴. `synth_reads_logic_per_frame` fails both, naming block 750 |
| AC4 `#204.9195397b` | `pack-check.test.ts` | `howl@1` refused naming [sum, loop, in] or [loop, sum, in]; `wobble@1` naming `grains`; `heavy@1` naming the preset and its cost; the three made right install |
| AC5 `#204.5aacbddd` | `gate.test.ts` | Before your gesture: the panel's and the agent's requests refused, the gate `suspended` with no grant, nothing handed. After: `running` on your serial; each strip's window of the handed PCM at most −1.0 dBTP at 4× and over −6. `synth_bypasses_master`: the first window over −1.0 dBTP is `hot`'s |
| AC6 `#204.9d525978` | `spawn.test.ts` (2) | 50 hits: each onset within one sample of its occurrence, each pitch within 1 Hz of 100 + 10 × speed; 50 voices at their flicks; a seek back to 6.3 s and a cold seek replay the same hash and voices. `spawn_synth_starts_next_block` names hit 0 |
| AC7 `#204.4e815a43` | `export.test.ts` (2) | The r128 export delivered within −23 ± 0.2 LUFS and ≤ −1 dBTP (PCM and delivery); the export with no profile: per-frame `pcm_hashes` equal the handed live PCM's, and its decoded delivery is its receipt's PCM. `export_synth_block_64` names the first differing block, at most 2,250 |
| AC8 `#204.0458a4e3` | `budgets.test.ts` (3) | A perf-lane task names `#204.0458a4e3`, valid against the merge base's budgets; on the reference Mac, `render_ms` of 32 drone voices over 10 s < 1,000 ms; `seek_ms` of a seek to 9.99 s < 50 ms (five runs after a warm-up) |
| AC9 `#204.33127906` | `ring.test.ts` | Budget 20 × one checkpoint's bytes: after 60 s the ring within it, 4 s apart, on the grid to 56 or 60 s; seeks to 30.5 and 59.9 s restore a ring checkpoint, render ≤ 4 s forward, equal playing (hash, samples, taps). `synth_ring_drops_oldest` renders the 30.5 s seek from 0 and fails naming it |
| AC10 `#204.f87a60ba` | `pack-check.test.ts` | `ring@1` with regen [0, 1.05] refused naming `regen`, 1.05 and sample 69,600 (or 69,601), not a seeded point; with [0, 0.95] installed |
| AC11 `#204.2ade263b` | `silence.test.ts` | Each of the six nodes alone, fed silence from a fresh voice for 1 s: the master exactly 0; each fed a sine: sounds. `shaper_bias` names `shaper` only |
| AC12 `#204.ba5e9d18` | `tail.test.ts` | The reported tail within 5% of the law (1 ms + the bandpass's decay to −120 dB, 0.2215 s); the master under −120 dBFS over the 10 ms ending at the tail and 0.3 s after, while over −80 dBFS at the span's end. `synth_tail_halved` names the preset and its level |
| AC13 `#204.cb2d85e8` | `spawn.test.ts` (2) | With `max_voices: 1`, hit B steals A's voice (`voices`); B's taps over its first 0.25 s equal a fresh voice's for B alone, at every node. `steal_keeps_filter_state` names `filter` |
| AC14 `#204.fe8c5ca9` | `budgets.test.ts` | On the reference Mac, `install_pack` of 50 presets × 4 params, timed as its whole run, < 10 s (five runs after a warm-up), installed |
| AC15 `#204.a523543e` | `nodes.test.ts` | The shaper (defaults) and the crush (8 bits) against their f64 laws within 10⁻⁶ at the node's scale; a seek into each equals playing (hash and taps). `crush_7_bits` names `crush` only |

## Readings where the issue and the design leave a choice

- **"Within −80 dB" and "by more than −60 dB"** (AC1): the residual's energy against the reference's, each channel
  fitted with one gain, since the master's pan law for a voice is the mix's, not this criterion's. **"Naming the first
  block"**: the first 128-sample block whose own residual passes −80 dB. A frame-held synth's frequency already leaves
  the line in block 0 (simulated: block 0, whole residual about +58 dB against the fitted gain).
- **The seeks** (AC2, AC9, AC15) are #499's: in the same transport, after playing past the seek point, so checkpoints
  exist; criterion 6's also seeks cold. "The PCM after each seek point" is the [S, 10 s) segment. A node's output is
  compared by its tap, so a failure names the first node in signal order that differs. "At most a second" forward is
  the Scope's.
- **"A ramp inside the block that holds that step's time"** (AC3): step 120 of 60 Hz is at 2 s, sample 96,000, the
  first sample of block 750, so the As built rule for a step on a block's first sample applies. "Live" is the panel's
  live transport (`handed`); "the bake" is `media_mix`, which bakes the document's logic over its span (#544). The
  plant's failure names block 750, where the block rule's ramp should be, however late its own ramp starts.
- **"Naming the edge / the node / the preset"** (AC4, AC10): read from the issue's text, since the design pins only the
  path. The preset is named by the path itself.
- **"Stays silent with no gesture"** (AC5): nothing reaches the gate before your press: no live transport exists to
  hand it samples (`handed` answers none), and the panel's own and the agent's requests are refused. "The device gate's
  test" is this test: each strip's share of what the transport handed the gate, held to −1 dBTP; a failure names the
  first strip, in time order, whose window passes it.
- **"A pluck preset pitched by each hit's speed"** (AC6): a sine held 0.1 s with a 3 ms noise click, plucked and gone
  by 0.13 s, so each pitch is read on a steady tone. **"Onsets within one sample"**: the first sample over −120 dBFS.
  **"Replays the same voices by hash"**: the PCM hash after the seek, and the same `voices`.
- **"Holds its loudness profile and its PCM hash equals the live render's"** (AC7): a profile's static gain scales
  every sample and no live render applies it, so the profile is read on the r128 export and the hash on the export with
  no profile, which applies no gain. The first block is found on the delivery's decoded sound, held to its receipt's
  per-frame hashes first.
- **"32 voices of an 8-node preset"** (AC8): one strip with `voices: 32`; "10% of one core at 48 kHz" as the voices'
  render time over 10 s of sound, under 1 s. **"A restore and render forward to a seek's time"**: the segment's
  `seek_ms`, at one voice. **"A document with no synth gains no work per block"** is the merge-base comparison the perf
  lane makes (the task this test requires), not a limit judged here.
- **"20 checkpoints' bytes"** (AC9): 20 times the largest checkpoint the engine's own ring holds on a 5 s play.
- **"The delay feedback gain"** (AC10): a gain in a cycle through a delay, since the delay node's own `feedback` is in
  [0, 1). "The first sample over 4.0": sample 69,600 of the render (simulated by the laws: 1.05^29 × the burst's first
  sample), 69,601 if the envelope's first sample is its rising edge.
- **"Fed 1 s of silence from its reset state"** (AC11): a fresh voice whose node has no edge into it; the
  fed twins show the strips sound. **"Exactly 0"**: every sample of the master equals 0, −0 included.
- **"Under −120 dBFS by the tail the preset derives"** (AC12): over the 10 ms that end there and the 0.3 s after; the
  tail itself is also held to its law within 5%. "The level at the stated tail": the peak over the 10 ms before it.
- **"A fresh voice for the same hit"** (AC13): the same list with hit A's kind outside the filter, so hit B keeps its
  occurrence index (and its hash) and is the spawn's only voice.
- **"Match an f64 reference within −120 dBFS"** (AC15): every sample, at the node's own output scale, after the
  master's gain for the voice is fitted. The triangle's samples sit on half steps of the 8-bit grid, so the rounding
  rule ("halves rounded away from 0") is what makes them match.
- **"The sweep of a pack … finishes in under 10 s"** (AC14): timed from outside as the whole run that installs the
  pack, the process's start included, so a pass can only be the sweep's.

## Not tested, and why

- A score's synth instrument and `score.render@1` with the same node code (Scope), and foley's presets: in the Scope
  but in no criterion.
- `modes`, `string`, brown noise and `crush`'s `hold_hz`: in the node list, read by no criterion; `modes` is left out of
  criterion 12's fixture because its resonators' gain isn't pinned and the sweep could refuse it.
- The chip nodes and `chip@1`: As built says they aren't built.
- A live play through the test audio backend's device: the gate's `handed` is what the live transport hands the gate.
