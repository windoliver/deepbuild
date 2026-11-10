# Acceptance tests for #500, part "spawn": variants, cooldown and voice stealing, the point a voice is heard from, and voices under a time remap

Written first, from issue #500 (as of Nov 9, 2026: its Scope, its Spawn, Spawn: variants and Analysis bake fields,
acceptance criteria 1, 6, 7 and 8, and its Proof line), its Oracle page, the design sections it links and those they
lean on, and the base commit of this worktree (`96b462a6`, the same tree as `0c4a4ec7`), by a job that never saw an
implementation; none existed, and no other worktree, branch or PR was read. The implementing agent doesn't edit these
files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The issue's other
criteria belong to the parts `cue/` (2, 4) and `bake/` (3, 5), and criterion 3's upstream port to
`tests/acceptance/500-oracle/`.

What was read:

- The issue (`gh issue view 500`), and its dependencies #499 and #491 as issues.
- The Oracle page (`doneright/oracles/issues/500.md`, DeepBuildAI/deepbuild, branch `doneright`): criteria 1, 6, 7
  and 8 have no upstream test ("Ours: a Rust fixture plays and seeks each spawn, compares its voices, pans and start
  samples by hash and number, and each planted spawn fails naming the pair or occurrence").
- `docs/canvas-primitives.md`: Sound and video on the picture's clock (blocks, "Output is identical for the same build
  and CPU architecture"), Emitter (`pan: equal_power`, "using the W3C Web Audio formulas", "The listener is the
  camera"), Spawn (its fields; "For each occurrence in flick order, a voice starts at its flick, sample-accurately,
  unless its pair is cooling down. Past `max_voices`, `steal` picks one, with ties broken by start flick, then stable
  ID"; "In 3D each voice is heard from where `at` puts it: it pans by the Emitter row's equal-power law with the camera
  as listener"; "gain falls with distance only when distance is set"; "On a world under a time remap, each voice
  starts at its occurrence's parent flick and plays at its own rate, or, with follow_remap, at that rate times the
  remap's constant rate"), Spawn: variants ("Picks are computed once, in flick order over the baked occurrence list,
  from hash(seed, spawn ID, occurrence index) and the weights"; "a seek reads the same choices"), Spawn: variant and
  span (for `on` forms), Time remap (`target`, `map: channel (parent flick → child flick)`, "Audio is muted unless the
  rate is constant"), Occurrence list (columns, the physics `hit` payload, `<world ID>.occurrences`), Logic:
  occurrences (a row's flick).
- `docs/technical-design.md`: Spawn and analysis bake ("In 3D, by default, a voice is heard from where its occurrence
  happened"), Dogfooding, "Who drafts it".
- At the base: AGENTS.md; `tests/acceptance/499/mix/` (README, helpers, `emitter.test.ts`, `BASE-FAILURE.txt`), whose
  form, `media_mix` call and media document these tests extend; `tests/acceptance/491/README.md`;
  `crates/deep-show/src/mixdown.rs` and `main.rs` (what `media_mix` reads at the base and how an unknown call or
  `planted` value answers).

What the base already does and these tests don't credit: #499's `media_mix` renders a media document's strips, buses,
processors and emitters offline and seeks through segments. It reads no `occurrences`, `spawns` or `remaps`, starts no
voice from an occurrence and answers no `voices`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/500/spawn --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/500/spawn/tsconfig.json   # type-check
```

Each file builds `deep-show` once with `cargo build --locked --bin deep-show` (honoring `CARGO_TARGET_DIR`), copies it
into a temporary folder and fails each of its tests when the build fails. Every world gets its own evidence folder,
deleted after the test. Node built-ins and vitest only; no process is started but `cargo` and `deep-show` (each waited
for, none stopped by name or port), and no network call is made. A run with `--root` may leave Vitest's cache in
`tests/acceptance/500/spawn/node_modules/.vite`; delete it. **This folder must run alone**: `scripts/lanes.mjs` needs
`'tests/acceptance/500/spawn/'` in its `alone` list, since each file builds a cargo binary; this README is the
instruction, and the implementer makes that edit. Runtimes: AC1 renders about 41 s of audio once, plus ten 50 ms
windows seeked to twice; the rest at most 8 s a run.

Deterministic: every test. Assets are written by the tests from fixed seeds (16-bit PCM WAVs at 48 kHz), window
starts are seeded (mulberry32, seeds 500,001 and 500,006), and every judgement is by hash, by sample or by a
least-squares fit against fixed formulas. None is BLOCKED or INCONCLUSIVE: nothing here depends on a platform part,
a device or load.

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a run that answers
`bad_input`, exits non-zero or writes other than one line fails every test that drove it; a WAV that isn't in the
evidence store, doesn't hash to its name, isn't float, or whose samples don't hash to the reply's `sha256` fails.

## The surface under test

The issue names Spawn's and Spawn: variants' fields, occurrence lists and time remaps, but no call. These tests extend
the call #499's suite drives, `deep-show run`'s `media_mix` (one JSON scenario on stdin, `{"evidence", "planted"?,
"calls"}`, one JSON answer out, exit 0; a line that isn't JSON, lacks a required field or names an unknown call, field
value or `planted` value answers `{"ok": false, "code": "bad_input"}`). Times are flicks (705,600,000 a second; a
48 kHz sample is 14,700). Rationals are `[num, den]`. Names the design gives are used as it gives them; **names it
doesn't give are this job's choice**, marked *(chosen)*, and the `cue/` and `bake/` parts use the same ones.

### The media document (#499's, with these fields)

```json
{"transport": {"sample_rate": 48000, "span": flicks},
 "strips": {},
 "occurrences": {list ID: [Row]},
 "spawns": {spawn ID: Spawn},
 "remaps"?: {remap ID: {"target": world ID, "map": Channel}},
 "scene"?: {"camera": {"position", "forward"}, "items": {item ID: {"position": [x, y, z], "body"?: u32}}}}
```

- **`occurrences`** *(chosen)*: baked occurrence lists given as data, as a bake hands them to a reader (Spawn "can
  never: Spawn from anything but a baked occurrence list"; Occurrence list: `kind`, `a`, `b`, a payload by kind). The
  list ID is the design's form `<world ID>.occurrences` (`lab.occurrences`, `board.occurrences`). A **Row** is `{"t":
  flicks, "kind": "hit", "a": u32, "b": u32, "point"?: [x, y, z], "speed"?, "impulse"?, "tags"?: [string]}`: `t` is
  the row's flick in its world's (child) time *(chosen; the design's rows carry `step` and a step's time)*, rows in
  flick order. A list's occurrence index is its row's position in it.
- **Spawn**: `{"on": {"list": list ID, "kinds"?: [kind]}, "play": Template | [{"template": Template, "weight"?: f32}],
  "pick"?: "weighted" | "no_repeat", "cooldown"?: flicks, "max_voices"?, "steal"?, "seed"?, "at"?: "point" | "a" |
  "b" | "none", "distance"?: "none", "follow_remap"?: bool}` (Spawn and Spawn: variants, with their defaults; `on`'s
  filter in Driver's form, `{list, kinds, …}`). **Template** (a strip template): a strip's `src`, `in` and `out`,
  `{"src": {"asset": sha256}, "in": flicks, "out": flicks}`. A spawn in a document with no `scene` is in 2D.
- **`remaps`** *(chosen: the document field)*: Time remap's `target` and `map` (a channel of `{"t", "value",
  "interp"}` keys, parent flick → child flick, #499's Channel). `target` names the world whose list it is (`lab` for
  `lab.occurrences`) *(chosen: the design's targets are a placement or a recipe instance)*.
- **Scene items' `body`** *(chosen)*: the stable body ID the item shows, for "the item that shows body a or b".
  Camera and positions are #499's: metres, the listener is the camera.

### `media_mix`, and its new `voices`

`{"call": "media_mix", "doc": Doc, "segments": [{"from", "to", "write"?: true}]}` → #499's `{"mix": {"sample_rate",
"channels", "segments": [{"from", "to", "first", "frames", "channels", "sha256", "wav"?}], …}}`, with *(chosen)*:

```json
"voices": [{"spawn": ID, "occurrence": index, "pair": [a, b], "template": index, "start": flicks, "end": flicks,
            "rate": [p, q], "stolen_by": voice index | null}]
```

every voice the spawns start over the whole document, planned once, in start order (ties by spawn ID, then
occurrence index): its spawn, the index of its occurrence in the
list, that row's `[a, b]`, the index of its template in `play` (0 for a single template), the flick it starts and the
flick it stops (its template's end, or where a steal stops it), its rate, and the index in `voices` of the voice that
stole it. An occurrence its pair's cooldown swallows starts no voice. Segments, seeks, `sha256` (interleaved f32le)
and `wav` (an IEEE float WAV in the evidence store) are #499's.

### Planted programs

Each reachable only through the scenario's `planted`, only to prove a test fails on a wrong program.

| Name | The wrong program | Test |
|---|---|---|
| `spawn_ignores_cooldown` | every occurrence starts a voice, its pair cooling down or not | AC6 |
| `spawn_pans_from_item_origin` | a voice in 3D pans from the origin of the item that shows its occurrence's body, not from the occurrence's `point` | AC7 |
| `spawn_starts_at_child_flick` | under a time remap, a voice starts at its occurrence's child flick, not its parent flick | AC8 |

## Criteria to tests

| ID | Criterion | Test, and the wrong program it fails on |
|---|---|---|
| AC1 #500.906a6d27 | "A spawn with variants picks the same templates whether the film is played or seeked, and no_repeat never repeats the previous pick over 1,000 occurrences" | `variants.test.ts`: 1,000 hits 40 ms apart; spawns `weighted` (three 20 ms tones, weights 1, 2, 1) and `fresh` (`no_repeat`). Ten seeded 50 ms windows played straight through then seeked to (same run), and seeked to cold (a second run of seeks only): every window hashes as played, and the cold run's voices pick what the first run's did. One voice per occurrence per spawn; `fresh` never repeats the previous pick; `weighted` picks more than one template. No plant: the criterion names none |
| AC6 #500.c97829c4 | "20 hits of one pair within 30 ms play one voice, while a hit of another pair in that window plays its own; with max_voices 8 and steal oldest, a ninth voice stops the earliest-started one, the same whether the film is played or seeked; a planted spawn that ignores cooldown plays 20 voices and fails, naming the pair" | `voices.test.ts`: spawn `knock` (cooldown 30 ms, max_voices 8, steal oldest, a 3 s stereo noise template) over 20 hits of pair (1, 2) 1.5 ms apart from 0.5 s, a hit of pair (3, 4) at 0.51 s, and nine pairs 100 ms apart from 4 s. By `voices`: one voice each for (1, 2) and (3, 4) at their first hits' flicks; pair (10, 30)'s voice `stolen_by` the ninth and ending within 50 ms of its start, the other eight playing out. By the samples: [0.6 s, 1 s) is exactly the two voices, [4.9 s, 5 s) exactly the last eight, each fitted with one gain per channel, relative residual ≤ 1e-4. Four windows (over the burst, after it, across the ninth start, after it) played then seeked hash alike, and the seeking run's voices are the same. Fails on: `spawn_ignores_cooldown`, "pair (1, 2) plays 20 voices, not 1" |
| AC7 #500.02d6db61 | "In a 3D document, a spawn with `at: point` gives a hit at a point 2 m left of and 2 m ahead of the camera the pan the Emitter's equal-power law gives that direction within 1e-6, and with `distance: none` keeps the spawn's gain; a planted spawn that pans from its item's origin instead of the occurrence's point fails, naming the occurrence" | `space.test.ts`: camera at the origin looking down −z; spawn `knock` (`at: point`, `distance: none`, a mono 1 kHz template); occurrence 0 at (2, 0, −2), where its bodies' items stand, and occurrence 1 at (−2, 0, −2) while its bodies' items stand at (2, 0, −2) and (0, 0, −3). Each voice's left and right gains, fitted on 0.3 s of samples, are [cos π/8, sin π/8] for −45° (and the mirror for +45°) within 1e-6, and their power sum 1 within 1e-6. Fails on: `spawn_pans_from_item_origin`, naming occurrence 1 only |
| AC8 #500.f09e41f0 | "Under a time remap at a constant rate of 0.5, each voice starts at its occurrence's parent flick at its own rate, and with `follow_remap` at half rate an octave down; a planted spawn that starts voices at the child flick fails, naming the occurrence" | `remap.test.ts`: remap `slow` on world `lab`, child = parent ÷ 2; hits at child 0, 1 s and 2.2 s. Without `follow_remap`: voices start at 0, 2 s and 4.4 s (by `start` and by each first audible sample, silent for 0.1 s before), rate 1/1, 12,000 samples at 1 kHz; with it: rate 1/2, 24,000 samples at 500 Hz (length ±2 samples, frequency by zero crossings ±10 Hz). Fails on: `spawn_starts_at_child_flick`, naming occurrence 1 first (occurrence 0's child and parent flicks agree) |

## Readings where the issue and design leave a choice

- **"Played or seeked"** is read as #499's suite reads it: the same transport's segments, a seek being a segment that
  doesn't start where the one before ended, compared by PCM hash on the same build; plus, for AC1, a run whose first
  segment is already a seek. The picks are also compared through `voices`, so a seek that changed a pick fails even
  where two templates might hash alike.
- **"Picks the same templates"** needs picks that vary: `weighted` must pick more than one of its three templates over
  1,000 occurrences, or nothing would tell a seek's pick from play's. The weights' proportions aren't read.
- **AC6's voices from the samples**: a stereo template on a 2D spawn with no pan of its own plays through #499's pan
  law, which this criterion doesn't state, so each window is fitted with one gain per channel (0.25 < gain < 4) and
  judged by its residual. "Stops" allows the stolen voice's fade (a voice is never dropped without one): its `end` lies
  within 50 ms of the ninth voice's start, and the window judged starts 100 ms after it.
- **"The pan the Emitter's equal-power law gives"** is the W3C PannerNode's equal-power panning of a mono input (the
  Emitter "using the W3C Web Audio formulas"; `pan: equal_power`): azimuth in the listener's horizontal plane, positive
  to its right, x = (azimuth + 90) ÷ 180, gains [cos(xπ/2), sin(xπ/2)]; helpers.ts `equalPower`, checked in the test
  against cos π/8 and sin π/8. "Keeps the spawn's gain": the spawn sets no gain (0 dB), so the two gains' power sum is
  1; a spawn that attenuated by distance (the inverse model would give 0.354 at 2.83 m) fails.
- **"Its item's origin"**: the item that shows the occurrence's body a or b; both bodies' items stand away from
  occurrence 1's point, and both stand at occurrence 0's, so the plant fails at occurrence 1 whichever body it reads.
- **"Its own rate"** is the template's rate, 1, and "half rate an octave down" is rate 1/2: twice the length and half
  the frequency. The rate is read from `voices[].rate` as a rational and from the samples.

## Not tested, and why

- `steal: furthest | quietest | none`, `priority`, `pick: by_variant`, `gain`/`pitch`/`pan` expressions, `at: a | b`,
  `distance` models, `quantize`, `air` and `ends`: in the issue's fields or the design, but no criterion reads them.
- Logic items' and physics worlds' own lists: the tests hand the spawn a baked list as data; how a world or a logic
  item fills one is #500's dependencies' and other issues'.
- A cross-architecture comparison: the design promises identity only on one build and architecture.

## The Oracle lane

Criteria 1, 6, 7 and 8 have no upstream test (Oracle page); these tests are their local proof, the pan held to the W3C
formula written out in `helpers.ts`.
