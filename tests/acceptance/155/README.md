# Acceptance tests for #155: foley@1, sounds rendered from (material, action) presets, and authored moments that drive Spawn

Written first, blind, from issue #155 (as of Nov 15, 2026: its Scope, Fields, nine acceptance criteria, Proof and
Oracle lines), its Oracle page, the design rows, and the base commit `0e5572731` (`0e55727311da14cb0c4644f9afd5e33c9505fefa`,
"Merge pull request #2529 from windoliver/fix/2362-kit-seal", origin/main) by a job that never saw an implementation;
none exists at the base, and no other worktree, branch or PR was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). The Oracle lane for criterion 8
is in `tests/acceptance/155-oracle/`.

## What was read

- The issue, live (`gh issue view 155 --repo windoliver/deepbuild`, body only). Each test's name starts
  `AC<n> #155.<id>`, the first 8 hex digits of SHA-256 of the checkbox's text after `- [ ] `, trimmed, white space
  collapsed (`scripts/proof-change.mjs`, `criterionId`).
- The Oracle page (`doneright/oracles/issues/155.md`, branch `doneright` of `DeepBuildAI/deepbuild`) and the one file it
  pins, upstream's `sample-accurate-scheduling.html` at `2f57f45d21`, read from `doneright/oracles/vendor/`.
- `docs/canvas-primitives.md` at the base: Document envelope (collections); Marker (and its semantics: `markers.<kind>`
  filtered by tags); Occurrence list; Strip and track; Strip and track: generator sources and rate ramps; Processor;
  Processor: shaper, crush and modulate; Synth `synth@1` with its As built (#204); Emitter; Spawn; Spawn: variants;
  Spawn: variant and span; Score `score.music@1` and `score.render@1` with its As built (#154); Foley `foley.render@1`.
- `docs/technical-design.md`: Score and foley; Spawn and analysis bake; Synth; Dogfooding; Criteria to tests, both ways;
  Criteria in a checked shape; Wrong programs; the edit guard. `AGENTS.md`.
- At the base, for surfaces and conventions only: `crates/deep-show/src/{main.rs,mixdown.rs,spawn.rs,synth.rs,films.rs,
  registries.rs,sandbox.rs,device.rs}` (the scenario, `planted` routing, `media_mix` and its `voices`, processors,
  presets, `<item>.build` lists, `registries`, `soak`), `crates/deep-canvas-motion/src/emits.rs` (a path's
  `<item>.build` rows), `crates/deep-canvas-marks/src/build.rs` (a stroke's share of the build),
  `crates/deep-canvas/src/expr.rs` (the expression language's functions), `crates/deep-canvas-media/src/{lib.rs,mix.rs}`,
  `packages/hub/src/jobs.ts` and `packages/extension-host/src/job-kinds.ts` (deep_job, the job key, a kind's
  descriptor), `packages/jobs/score` (a first-party job plug-in), `packs/fx-1.0.0` and `packs/familiar-1.0.0`
  (first-party packs); the suites `154`, `154-oracle`, `204`, `500/spawn`, `1922`, `491`, `499/mix`, `466`, `501`, `1720`
  as patterns. This suite imports `../499/mix/helpers.ts` (JSON readers, the evidence store, the WAV reader),
  `../501/helpers.ts` (`referenceMacProblem`) and the extension host's public entry for `packageDigest`; the Oracle lane
  imports `../154/helpers.ts` for its score and library shapes.

## What the base has

#500's spawns over baked lists given as data (`occurrences`), with `pick: weighted | no_repeat` and a voice per
occurrence in `media_mix`'s `voices`; #466's `<item>.build` and `<item>.reveal` lists compiled from a document's paths
and texts; #204's synth presets in a pack's `presets`, checked at `install_pack`, listed by `registries`; #499's
processors eq, compressor, limiter, delay, reverb and pitch; #154's `score_plan` and deepbuild/score; #1922's deep_job;
#501's `soak`. It has no `markers` compiled into lists (a spawn on `markers.press` answers `unbaked_list`), no
generator source (`bad_media` at `src.asset`), no rate ramp (`bad_media` at `rate`), no shaper, crush or modulate
processor (`bad_media`: "isn't built"), no `pick: by_variant` (`bad_media`, "lands with foley@1"), no `foley_plan`, no
`packs/foley-1.0.0`, no `packages/jobs/foley`, no `foley.render` kind, and neither planted name below.

## Run them

macOS; Node 24 and rustup's cargo first on `PATH`:

```sh
npm ci
npm run build --workspaces                                # the hub tests run packages/cli/dist/main.js
export PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
node scripts/throttle.mjs build --wait 30 -- scripts/lease cargo build --locked -p deep-hook       # the hub needs it
node scripts/throttle.mjs build --wait 30 -- scripts/lease cargo build --locked --bin deep-show    # as beforeAll builds it
NO_COLOR=1 node node_modules/vitest/vitest.mjs run --root tests/acceptance/155 --testTimeout=600000 --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/155/tsconfig.json
```

- **One at a time:** each file builds `deep-show` once in `beforeAll`, and the hub files start their own hubs and
  render through the supervisor, so the implementer adds `tests/acceptance/155/` and `tests/acceptance/155-oracle/` to
  `alone` in `scripts/lanes.mjs` (not done here). Every `it` passes at least a 3,600,000 ms timeout. The hub tests
  need the sandbox off (a hub listens on a Unix socket; `tests/acceptance/1922/README.md`).
- **Needs:** `ps`, and `openssl` for the Oracle lane's test CA.
- **Safety:** every folder is under `/tmp/dh155-*` and removed after its file; every hub, `deep` command and `deep mcp`
  runs with `HOME` in its world's temp folder and without the caller's `DEEP_*`, `CLAUDE*`, `CODEX*`, `NODE_OPTIONS`;
  nothing leaves 127.0.0.1; no model is called; every process is stopped by its PID. Delete
  `tests/acceptance/155/node_modules/.vite` after a `--root` run.
- **The proof** (the issue's Proof line: "A fixture film with paper and metal bound, its spawn plan, the tape stop
  against its integral, and the processor references") is written to `$TMPDIR/deep-155-proof/`, rewritten each run.

Nothing missing passes (invariant 2): a reply without a field a test reads fails naming the field; a BLOCKED or
INCONCLUSIVE leg fails with a line starting `BLOCKED:` or `INCONCLUSIVE:`.

## Criteria to tests

| AC | ID | File | Test, and the wrong program it fails on |
|---|---|---|---|
| 1 | `#155.2ad28764` | `markers.test.ts` (1) | markers `tap` (press, tag ui), `other` (cue) and `later` (press, tag late); a spawn on `markers.press` filtered by `ui` playing a one-sample click: one voice at tap's flick and one non-zero sample, 60,000, with tap at 1.25 s; tap moved to 2.6 s + 7,000 flicks, the voice and the click move to that flick and sample 124,801, and 60,000 is silent. Fails on the merge base (`unbaked_list`) |
| 2 | `#155.c0ec4150` | `moments.test.ts` (1) | 1,050 moments (1,000 tagged hit with `speed` in the payload, 50 whoosh); `variant: "clamp(1 + floor(speed / 2), 1, 3)"` over foley.wood.hit's variants: 1,000 voices, level 3 at 4 m/s, 1 at 0.5 m/s, 2 at 2 m/s; at each level no take repeats the level's previous take, all four sound, level 3's aren't a fixed cycle. Planted `round_robin_by_hash_alone`: the same judge fails, naming `occurrence <n> … repeats the take` |
| 3 | `#155.5d489fd3` | `generator.test.ts` (1) | a strip on `{generator: {job: "foley.paper.tap", output: "l2r3"}}`: `media_mix` BLOCKED naming `foley.paper.tap` with no mix while no run is among `jobs`; deep_job's first run a miss in a process the hub starts, the rerun a hit with the same key and variants starting no process, the job planned again with the same params; with the run among `jobs` the strip sounds and hashes as a strip of the variant's asset. Fails on the merge base |
| 4 | `#155.fd738754` | `tapestop.test.ts` (1) | a stereo 10 Hz cosine/sine source read by angle: the strip with `rate: {ramp: {to: [0, 1], over: 0.8 s, shape: "linear"}}` from sample 6,000, at the first sample of each of its 300 blocks, within one source sample of 48,000 · (1 + τ − τ² ÷ 1.6); [0.4 s, 1 s) sought after playing and cold equal playing bit for bit. Fails on the merge base (`bad_media` at `rate`), and on a rate held for each block (about 64 samples ahead by the stop's end) |
| 5 | `#155.dfb89544` | `processors.test.ts` (1) | shaper tanh / soft_clip / fold on a 16-step staircase (steady parts), crush 8 bits and 6 bits with hold 4 kHz and mix 0.5 on two sines (every sample), modulate on a ramp (every sample of 2 s, D(n) fitted to two sinusoids): each within 10⁻⁶ (−120 dBFS) of its f64 law; seeks into each kind's window equal playing. Fails on the merge base (kind "shaper" isn't built) |
| 6 | `#155.5ffbe66e` | `registry.test.ts` (1) | packages/jobs/foley's manifest is deepbuild/foley-render declaring `foley.render` and `foley-render@1.0.0`; deep_job lists the kind held by deepbuild/foley-render with that tool, its plug-in and build; test/foley-rival is refused at install naming `foley.render` and `deepbuild/foley-render`, and the list is unchanged. Fails on the merge base |
| 7 | `#155.3c3c0a49` | `budgets.test.ts` (3) | `benchmarks/budgets.json` has a task naming `#155.3c3c0a49`, valid against the merge base's (`validateBudgets`); every preset's variants (90 jobs at once, fresh hub) judged by `judgeLimit` against 30 s over five runs after a warm-up, INCONCLUSIVE off the reference Mac; 32 spawned voices of foley.metal.hit (32 hits every 0.25 s, `max_voices: 32`) shown starting together by `media_mix`, then `soak` for 600 s with no underrun on a reference Mac in a fit state, INCONCLUSIVE elsewhere, BLOCKED with no output. Fails on the merge base before any timing |
| 8 | `#155.ec088f1d` | `materials.test.ts` (1); Oracle: `155-oracle/sample-accurate.test.ts` (1) | two paths of four strokes, `pencil` in `a_sketch` (paper) and `wire` in `b_frame` (metal), strokes between samples; spawns on `pencil.build` and `wire.build` playing `foley.scrape`: eight voices at the strokes' flicks, paper on the pencil and metal on the wire, level 2; each stroke's 2,400 samples from ⌈t ÷ 14,700⌉ fit its variant rendered alone (residual < 10⁻⁴) and fit the other material's worse; four seeded seeks and the same cold equal playing, the cold voices the played ones. Planted `foley_first_collection_material`: fails naming `wire.build[k] … plays foley.paper.scrape`, and only wire's strokes. Oracle: upstream's check on nine stroke-started impulses, and a per-quantum mixer rejected at sample 48,896 |
| 9 | `#155.eaff7d6a` | `pack.test.ts` (2) | packs/foley-1.0.0 (`name: "foley"`) holds exactly the 90 presets `<material>.<action>@1`, every node in synth's closed list; `install_pack` as deepbuild/foley: installed, no issue; `registries` lists all 90 `foley.<material>.<action>@1` as synth.preset@1 entries of that pack. The planted `paper.tear@1` with a node `grains` of kind `granular` is refused with an issue at `presets/paper.tear@1` naming `grains`; without it, it installs. Fails on the merge base (no pack) |

## The surface under test

Names the issue and the design give are used as they give them; **every name marked *(chosen)* is this job's**,
taken from the design's words and shaped like the neighbouring surfaces. The implementer builds exactly these, or a
dispute goes to a blind redraft.

### The first-party pack foley@1

- Folder `packs/foley-1.0.0`, `pack.json` with `name: "foley"`, `version: "1.0.0"` *(chosen, as `packs/fx-1.0.0`)*,
  installed with #306's `{call: "install_pack", id: "deepbuild/foley", dir}` (a first-party pack's ID
  `deepbuild/<name>`, as #1720's suite reads it), pinned by a document as `packs: ["deepbuild/foley@1.0.0"]`.
- `presets: {"<material>.<action>@1" → preset}`, #204's preset form, one for each of the 90 (material, action) pairs of
  the issue, so a document names each `foley.<material>.<action>@1` (Synth As built: `<pack>.<name>@<major>`).

### The renderer: deep_job (#1922's), on a real hub

- The plug-in `deepbuild/foley-render` *(chosen; not `deepbuild/foley`, the pack's ID)* at `packages/jobs/foley`
  *(chosen, as `packages/jobs/score`)*, installed with `deep install`; its manifest declares `jobs: ["foley.render"]`,
  `job_tools: [{kind: "foley.render", tool: "foley-render@1.0.0"}]` *(chosen: the kind as #154's `score.render`, the
  tool as `score-render@1.0.0`)* and asks for `deep.registerJob` and `deep.registerJobTool`.
- Run: `{op: "run", kind: "foley.render", tool: "foley-render@1.0.0", params: <the plan's params as JSON text>, inputs:
  <the plan's inputs>}`. Done: `{status: "done", outputs: {l1r1: {sha256}, …, l3r4: {sha256}}, receipt: {cache, key,
  …}}`: twelve outputs, one per variant, named `l<level>r<round robin>`, levels 1 (softest) to 3, round robins 1 to 4
  *(chosen)*; the variants' format is the renderer's, read only by deep-show.
- List: `{kinds: [{kind: "foley.render", plugin: "deepbuild/foley-render", tools: [{tool: "foley-render@1.0.0", plugin,
  build}]}]}`.

### `deep-show run` (#393's convention)

- **The scenario** `{evidence, planted?, packs?, jobs?, calls}`: `evidence` the hub's store (`<home>/.deepbuild/evidence`),
  where the jobs kept their outputs; **`jobs`** *(chosen)*: the done deep_job replies the hub holds, each exactly as
  deep_job answered it (`{status, outputs, receipt}`). A generator source resolves at check to the reply whose
  `receipt.key` is its job's key (the hub's key, #1922); with none, it is BLOCKED.
- **`{call: "foley_plan", doc}`** *(chosen, after #154's `score_plan`, with the document inline as `media_mix` takes
  it)* → `{jobs: {<job ID> → {kind: "foley.render", tool: "foley-render@1.0.0", params, inputs: []}}}`: every foley job
  the document's generator sources reach, a job named by its action alone resolved for each bound material.
- **A generator source** (Strip and track: generator sources) on a strip or a Spawn template: `src: {generator: {job,
  output}}` *(chosen: the tag as the key holding the variant, as `src: {asset}` and `src: {synth}`)*. A foley job's ID
  is its preset's name without the major, `foley.<material>.<action>` *(chosen)*; `foley.<action>` *(chosen)* names the
  action alone and takes the material the film binds to the collection holding the occurrence's item. `output` is a
  variant's name (`l2r3`) on a strip, or `variant` *(chosen)* on a Spawn template, which picks by `variant` and the
  round robin. A score stem's job is its score item's ID and its output the stem's name *(chosen; the Oracle lane)*.
- **A rate ramp**: `rate: {ramp: {to: [num, den], over: flicks, shape: "linear" | "exp"}}` *(chosen form of the design's
  `ramp {to, over, shape}`)*, from the strip's rate of 1 at its start *(chosen)*.
- **Processors** in #499's form, `processors: {ID → {kind, …fields}}` on a bus's `processors`: `{kind: "shaper", curve,
  drive, mix, oversample}`, `{kind: "crush", bits, hold_hz, mix}`, `{kind: "modulate", wow_hz, flutter_hz, depth, seed}`.
- **Markers** in a media document: `markers: {ID → {kind, t: flicks, tags, payload}}` (Marker); a spawn's `on: {list:
  "markers.<kind>", tags}` reads the kind's list, each row at its marker's `t`, carrying its `tags` and its payload's
  fields by name, so an expression reads `speed` *(chosen: as a logic row carries its declared fields)*.
- **Spawn** (#500's form) with the new fields: `pick: "by_variant"`, `variant: <expression>`, `round_robin: "hash" |
  "none"`, `span: <expression in flicks>`; expressions are text in the closed function list's language (#204's reading).
- **`media_mix`** (#499) → `{mix: {sample_rate, segments, voices, …}}` or, for a generator whose job hasn't run, a reply
  with a top-level field equal to `"BLOCKED"` naming the job, and no `mix` *(chosen form, as `media_bake` and #154's
  plan answer BLOCKED)*. Each voice (#500's `{spawn, occurrence, start, end, …}`) that plays a generator also carries
  `job` and `output` *(chosen)*: the job and the output (a variant's name) it plays.
- **A film for foley**: the Document envelope's `collections: {ID → {members}}` and, beside it, `foley_materials:
  {collection → material}` (Foley Fields); paths are `path@1` with `build: {progress, emits: true}` and a progress
  channel, as #466 left them.
- **`soak`** (#501, #525): `{call: "soak", media, seconds}` → `{outcome: "played", seconds, stats: {underruns, …}}` or
  `{outcome: "refused", code: "no_output"}`.

## Planted programs

| Name | Where | Criterion | The wrong program | Read as failed when |
|---|---|---|---|---|
| `round_robin_by_hash_alone` | deep-show scenario `planted` | 2 | the round robin picks take hash(seed, spawn ID, occurrence index) mod 4 within the level, with no check against the level's previous take | `moments.test.ts`'s judge names an occurrence that repeats the take of the level's voice before it |
| `foley_first_collection_material` | deep-show scenario `planted` | 8 | a foley job named by its action alone takes the material of the first bound collection (by ID: `a_sketch`, paper) for every occurrence | `materials.test.ts`'s judge names `wire.build[k] … plays foley.paper.scrape, not foley.metal.scrape`, and no pencil stroke |
| the paper.tear@1 with a node outside the list (`pack.test.ts`, test code) | `install_pack` | 9 | a copy of the pack's own `paper.tear@1` with one more node, `grains` of kind `granular` | refused at `presets/paper.tear@1` naming `grains` |
| test/foley-rival (`registry.test.ts`, test code) | `deep install` | 6 | a plug-in registering `foley.render` again | refused at install naming the kind and its holder |
| impulses moved to their quantum's start (`155-oracle`) | test code | 8 | a mixer that starts voices per 128-sample block | upstream's ported check names sample 48,896 |

The other criteria's wrong program is the merge base (and the trace lane's mutants of the new lines).

## Fixtures

All made at test time, truth by construction; nothing but these test files is committed. No recording, model output
or personal data.

- **The click** (AC1): a float WAV of 2,400 samples, 0.5 at its first and 0 after.
- **The tape source** (AC4): 3 s stereo float, left 0.5·cos 2πn/4,800, right 0.5·sin 2πn/4,800.
- **The processors' fixtures** (AC5): a 16-level staircase from −0.45 to 0.45 (2,048 samples a level, the right channel
  its negative); 0.5 s of a 440 Hz sine at 0.6 and a 1 kHz sine at 0.35; a 3 s ramp (left −0.6 to 0.6, right 0.3 to
  −0.3). Each strip on a bus at −6 dB holding the one processor, apart in time.
- **The moments** (AC2): 1,050 markers of kind moment 40 ms apart from 0.1 s; every 21st tagged whoosh, the rest hit
  with speeds 4, 0.5 and 2 m/s in a run of ten (7, 2, 1).
- **The strokes film** (AC8): 200 × 100, 9 s; `pencil` and `wire`, four strokes each; strokes at 0.5 + 2k s and
  1.5 + 2k s plus 7,000 + 1,000k and 3,000 + 1,000k flicks; the master at −20 dB so its limiter never acts.
- **The soak** (AC7): 2,400 bursts of 32 hits of 32 pairs, every 0.25 s for 600 s, in `burst.occurrences`.
- **Every preset** (AC7): 90 generator strips, one per (material, action), each on `l1r1`.

## Legs that read BLOCKED or INCONCLUSIVE

- AC7's render timing: INCONCLUSIVE wherever the perf lane's `judgeLimit` says the machine can't judge a timing (not a
  reference Mac, not on mains power, Low Power Mode on, thermal state not nominal, load over the core count), after the
  warm-up render has run; and INCONCLUSIVE when the five runs are neither all within 30 s nor all over it by the margin.
- AC7's soak: INCONCLUSIVE off a reference Mac in a fit state (after `media_mix` has shown the 32 voices); BLOCKED when
  the Mac has no sound output.
- None other: the hub and deep-show run here.

## Readings where the issue leaves a choice

- **"A marker of kind press"** (AC1): the Marker row's kind list (cue, shot, section, stage, hold, beat, word, moment,
  record) has no `press`; the criterion names it, so the test writes `kind: "press"` and reads `markers.press`. See Not
  settled.
- **"Moving the marker moves the sound"** (AC1): the same document with the marker's `t` changed, run again; the voice
  and the one non-zero sample move to the new flick and its sample, ⌈t ÷ 14,700⌉ (#466's reading of "on its
  occurrence's sample"), and the old sample is silent.
- **"Never repeats the previous take"** (AC2): per level, as the design's "never repeating the level's previous take";
  a pick by hash is also read as using all four takes and not one fixed cycle (#154's reading of its round robin).
- **"Variant picks level 3 for a hit at 4 m/s and level 1 at 0.5 m/s"** (AC2): the variant expression is the test's
  own, `clamp(1 + floor(speed / 2), 1, 3)`; what is tested is that the spawn evaluates it on each moment's payload.
- **"BLOCKED naming the job"** (AC3) is the `media_mix` reply; "a rerun with the same key" is deep_job run again with
  the plan's params (a hit with the same `receipt.key`), and the job planned again keeps its params.
- **"Within one sample at every block"** (AC4): the source position at the first sample of every 128-sample block of
  the mix inside the stop, read from the source's angle, against the exact integral of the rate. The ramp starts at the
  strip's start, from rate 1.
- **The processors' references** (AC5): the processor shaper's curves and the crush's quantizer are read as the synth's
  laws (As built: tanh u; 1.5u − 0.5u³ to |u| ≤ 1 then the sign; u folded into [−1, 1]; mid-tread q = 2^(1 − bits),
  halves away from 0, the held sample the first of its period). The shaper is judged on each level's steady part,
  where oversampling filters with a DC gain of 1 change nothing; "within −120 dBFS" is every judged sample within 10⁻⁶
  of full scale at the master. modulate's "two periodic curves of t and the seed" are read as two sinusoids at wow_hz
  and flutter_hz whose amplitudes and phases (the seed's) are fitted; depth's split between them isn't read.
- **"Seeking equals playing on the same build and architecture"** (AC4, AC5, AC8): segments of one transport played and
  then sought into, and (AC4, AC8) the same windows asked cold in a run of their own, compared bit for bit.
- **"From their registrations"** (AC6): the plug-in's manifest declares the kind and the tool and asks for
  `deep.registerJob` and `deep.registerJobTool`, and deep_job lists them, as #154's suite reads it.
- **"Rendering every preset's variants"** (AC7): the 90 deep_job calls at once in a fresh hub, from the first call to the
  last reply. **"32 spawned voices"**: 32 voices started at once every 0.25 s by `max_voices: 32`.
- **"Plays a scrape for each stroke from its collection's material"** (AC8): the voice's `job` and the sound itself,
  each stroke's first 2,400 samples fitted against its variant rendered alone (one gain per channel); a voice one sample
  late or early fits the noise of a scrape far worse than 10⁻⁴. "Seeking to any time plays the same voices": four
  seeded windows, sought after playing and cold, and the cold run's voices.
- **"Every foley@1 preset"** (AC9): all 90 pairs of the issue's ten materials and nine actions.

## Not tested

In Scope or Fields but in no criterion: a reveal's or a plant's sound from its collection; a contact finding its sound
by its material's tag; `span` as an expression of the occurrence's fields (AC8 sets a constant); `round_robin: none`;
`<item>.reveal` on a foley spawn; `shape: exp` ramps; a ramp refused on a video strip; a job output that failed its check
refused as a strip; output identical per build and architecture across machines; Spawn's `at`, `distance` and
`follow_remap` with generator voices (#500 owns them); a score stem as a generator strip with BLOCKED (only foley's is
tested; the Oracle lane plays a score stem); the variants' format.

## Not settled

- **`press` is no marker kind** in the Marker row; the criterion names it. If the kind list is closed, AC1 needs the row
  amended or the criterion redrafted.
- **How the hub hands deep-show its job results.** This suite hands deep-show the done replies as a scenario field
  (`jobs`); a live hub may hand its canvas core the same records another way.
- **What seeds a foley job.** The design keys it by hash(tool@version, preset, seed) without saying whose seed; this
  suite never varies it (AC7 renders each run in a fresh hub instead).
- **The modulate law.** The design names its curves only as "two periodic curves of t and the seed"; this suite reads
  sinusoids. A different periodic shape would fail AC5's fit.
- **The shaper's oversampling filters** are "the limiter's filters", which the design doesn't write out for a
  reconstruction; AC5 judges only where a filter with a DC gain of 1 changes nothing.
