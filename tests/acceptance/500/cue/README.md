# Acceptance tests for #500, part "cue": a click cued to the frame that shows its moment, and a click's onset on the press frame

Written first, from issue #500 (as of Nov 9, 2026: its Scope, its fields, acceptance criteria 2 and 4, and its Proof
line), its Oracle page, the design sections it links and those they lean on, and the base commit of this worktree
(`96b462a6`, the same tree as `0c4a4ec7`), by a job that never saw an implementation; none existed, and no other
worktree, branch or PR was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to
a blind redraft of this job (design: Dogfooding). The issue's other criteria belong to the parts `spawn/` (1, 6, 7, 8)
and `bake/` (3, 5).

What was read:

- The issue (`gh issue view 500`): Scope ("Onsets from the analysis bake place a sound's strongest hit on a moment,
  such as a click on the press"; "Declared onsets … land on their moment within one sample, measured onsets within a
  stated tolerance …; cues with move: sound land on the first frame that shows their moment; a cue whose moment or
  anchor doesn't resolve is BLOCKED and named"), Analysis bake's `onsets {method, threshold}`, criteria 2 and 4; its
  dependencies #499 (Strip and track's `align: {onset: strongest | first, to: time}`, Transport's `frame_rate`) and
  #491 (Tempo map and cue alignment's Cue fields) as issues.
- The Oracle page: criteria 2 and 4 have no upstream test ("Our clock, cue, ducking, onset, checkpoint and spawn rules,
  decided by our own analytic fixtures").
- `docs/canvas-primitives.md`: Tempo map and cue alignment (Cue: `{cue: strip | marker, anchor: word | onset | peak |
  beat | occurrence | moment | marker, offset, move: picture | sound, snap, tolerance, land: frame | sample = frame}`;
  "With `land: frame`, the default for move: sound, the onset lands on ⌈moment ÷ Δ⌉ · Δ at the export rate, the first
  frame that shows the moment. A cue whose moment or anchor doesn't resolve is BLOCKED and named"; "It can never: …
  land a sound before the frame that shows its moment"), Analysis bake (onsets: "the attack start, at sample
  accuracy"), Strip and track (`align`), Transport (`frame_rate`), Sound and video on the picture's clock.
- `docs/technical-design.md`: Spawn and analysis bake ("An onset can place a sound's strongest hit on a moment, such as
  a click on the press"), Dogfooding.
- At the base: AGENTS.md; `tests/acceptance/499/mix/` (README, helpers), whose form and `media_mix` call these tests
  extend; `crates/deep-show/src/mixdown.rs` (what `media_mix` reads at the base).

What the base already does and these tests don't credit: #499's `media_mix` renders strips at their declared `start`.
It reads no `frame_rate`, `align` or `cues`, bakes no onsets and answers no `cues`.

## Run them

```sh
npm ci                          # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/500/cue --no-file-parallelism
node node_modules/typescript/bin/tsc -p tests/acceptance/500/cue/tsconfig.json   # type-check
```

Each file builds `deep-show` once (`cargo build --locked --bin deep-show`, honoring `CARGO_TARGET_DIR`), copies it into
a temporary folder and fails its test when the build fails. Evidence folders are deleted after each test. Node built-ins
and vitest only; no process but `cargo` and `deep-show`, none stopped by name or port; no network. Delete
`tests/acceptance/500/cue/node_modules/.vite` after a `--root` run. **This folder must run alone**: `scripts/lanes.mjs`
needs `'tests/acceptance/500/cue/'` in its `alone` list (each file builds a cargo binary); the implementer makes that
edit. Each test renders at most 4 s of audio. Deterministic: assets from fixed seeds, judged by sample. None is BLOCKED
or INCONCLUSIVE. A reply without a field a test reads fails naming the field; a WAV that doesn't hash to the reply's
`sha256` fails.

## The surface under test

`deep-show run`'s `media_mix`, as the `spawn/` part's README states it (scenario, `bad_input`, flicks, rationals, the
evidence store, segments and WAVs), with these fields. Names the design gives are used as it gives them; names it
doesn't are marked *(chosen)*.

- **`transport.frame_rate`**: Transport's `frame_rate: rational`, `[24, 1]`, the export rate a cue lands on.
- **A strip's `align`**: Strip and track's `align: {onset: strongest | first, to: time}`, `{"onset": "strongest", "to":
  flicks}`: the strip is placed so that its source's onset (from the onset bake of its asset) lands at `to`; its
  declared `start` is overridden.
- **`cues`** *(chosen: the document field)*: `{cue ID: {"cue": strip ID, "anchor": "onset", "moment": flicks, "move":
  "sound"}}`, Tempo map and cue alignment's Cue with `land` left at its default, frame. `anchor` is read as the point of
  the cued strip's sound that lands (its onset, or its peak for a long attack: "an attack longer than 30 ms cues with
  `anchor: peak`"), and **`moment`** *(chosen; the design's own word for what the cue lands on, "A cue whose moment or
  anchor doesn't resolve")* as the time it lands on.
- **The reply's `cues`** *(chosen)*: `"cues": {cue ID: {"state": "resolved", "lands": flicks} | {"state": "BLOCKED",
  "reason": string}}` beside #499's `segments`: where the anchor sounds after the move, or BLOCKED with a reason that
  names the cue.

No planted programs: neither criterion names one.

## Criteria to tests

| ID | Criterion | Test, and the wrong program it fails on |
|---|---|---|
| AC2 #500.96dc67dd | "A click cued 10 ms after a 24 fps frame boundary sounds on the next boundary, 31.67 ms later, never before its picture, and a cue whose anchor doesn't resolve is BLOCKED naming it" | `cue.test.ts`: strip `click` (96 samples of digital silence, then a click: its onset at source sample 96), cue `press` to the moment 1.010 s at 24 fps. `cues.press` resolved with `lands` 735,000,000 (frame 25, 25/24 s, 22,344,000 flicks = 31.67 ms after the moment); every sample before 50,000 silent (≤ 2^−20) and sample 50,000 sounding (≥ 0.1). A second document cues a strip of pure silence by its onset: `cues.hush_cue` BLOCKED, its reason naming `hush_cue`. Fails a cue landed on the moment's own sample (48,480), a cue landed on the boundary before (48,000), and a silent strip reported resolved |
| AC4 #500.102e987c | "A click's onset lands on the press frame within one frame" | `onset.test.ts`: strip `click` declared at `start` 0 with `align: {onset: strongest, to: 2.013 s}`; its asset has a −60 dBFS floor, a weak tick at 20 ms and the strongest hit at 150 ms. The press frame is ⌈2.013 × 24⌉ = 49, at sample 98,000; the hit (first sample louder than 0.45) sounds within 2,000 samples of it. Fails a strip left at its declared start (1.9 s early) and one aligned by its first onset, the tick (6,240 samples late) |

## Readings where the issue and design leave a choice

- **"The next boundary"** is the design's ⌈moment ÷ Δ⌉ · Δ, at the transport's `frame_rate` (the export rate). The
  onset is the click's attack start at sample accuracy, which for a click out of digital silence is its first non-zero
  sample, so the samples show it exactly: nothing before sample 50,000, the click at it. The strip starts at its
  source's start, so no edit fade (#499's 5 ms) applies at either end.
- **"A cue whose anchor doesn't resolve"**: an onset anchor on a strip whose asset is all zeros, where an onset bake
  finds no attack. **"Naming it"** is read as naming the cue (its ID in `reason`); the anchor's name isn't required.
- **"The press frame"** is the first frame that shows the press (the cue rule's ⌈t ÷ Δ⌉ · Δ); "within one frame" is
  one frame at 24 fps, 2,000 samples, either side. A strip landed on the press's own time (sample 96,624) or on its
  frame passes. The hit is found on the rendered samples as the first sample above 0.45, which the floor and the tick
  never reach and the 0.9 hit does within its 0.5 ms attack, whatever pan law #499 gives a mono strip on the master.
- **AC4 through `align`, AC2 through a cue**: the design places "strips placed with align" among declared onsets and a
  cue's `anchor: onset` on the onset bake; both read the asset's onset from the bake, so each criterion is held
  through one of the two surfaces the design names for it.

## Not tested, and why

- Cue `anchor` kinds other than `onset`, `offset`, `snap`, `tolerance`, `move: picture`, `land: sample`, cues on
  markers, the ±2 ms tolerance proposed for percussive presets and the 30 ms attack rule: in the design, but neither
  criterion reads them.
- The onset bake's own rows: read only through where the strip lands.

## The Oracle lane

Criteria 2 and 4 have no upstream test (Oracle page); these tests are their local proof.
