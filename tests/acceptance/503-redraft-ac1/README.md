# Acceptance test for #503, criterion 1: the bar chart (blind redraft)

`AC1 #503.385199c8`, one clause: "a bar chart whose 16 rows' heights read the bands draws the same heights seeked or
played at every frame". The criterion's other clauses (the bake's readings, the Linux rerun, the new key, the
`spectrum_band_empty` refusal and the two planted bakes) are tested elsewhere.

This is a blind redraft of one test by a job that never saw an implementation, the first draft or the dispute. It was
written from the issue's criterion and scope line as given in the job's brief, the design and base commit `014344430`
(main plus the design commit for #503; no #503 code exists there). No other branch, worktree, pull request, or
`tests/acceptance/503/` or `tests/acceptance/503-oracle/` was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to the owner with both drafts (design: Dogfooding).

## What was read

- `AGENTS.md`; `docs/technical-design.md`: The media module, Dogfooding.
- `docs/canvas-primitives.md`: Analysis bake (with the paragraph the base commit added on `bakes`, the key, empty bands
  and the array `spectrum.<bake ID>`), Mark set and columns `marks@1`, Mark set: logic columns, Time and the flick,
  Camera `camera@1`, Asset.
- At the base, only to find the surfaces: `crates/deep-show/src/` (`main.rs` call parsing and the scenario's `planted`,
  `frames.rs` `eval` and `frames`, `time.rs` `determinism`, `bake.rs` and `mixdown.rs` `media_bake`, `snapshot.rs`
  `raster`, `film.rs`), `crates/deep-canvas-marks/src/data.rs` (how a bar set is scaled and drawn),
  `crates/deep-canvas/src/document/mod.rs` (the envelope's keys), and the suites `501/` (helpers), `1819/`
  (`fixtures/synth.ts`), `397/` (bar and rect mark sets with scales), `535/` (README form, a film with mark sets and the
  scenario's `planted`) and `1575-redraft-ac1/` (a redraft's README); `scripts/lanes.mjs` (`alone`).

## Criterion to test

| Criterion clause | Test (`chart.test.ts`) | Passes when |
|---|---|---|
| AC1 #503.385199c8: a bar chart whose 16 rows' heights read the bands draws the same heights seeked or played at every frame | `AC1 #503.385199c8 (bar chart) …` | at each of the film's 600 frames, played in order and seeked to, every one of the 16 bars is within 1 px of the height its band's level reads, and each bar's played height equals its seeked height |
| the same, against its wrong program | `AC1 #503.385199c8 (bar chart, wrong program) …` | the same check, on the run with the scenario's `planted: "spectrum_plays_a_row_late"`, fails, and a failure names frame 121 |

## Run it

```sh
npm ci                          # once, if node_modules is missing
PATH=/opt/homebrew/opt/rustup/bin:$PATH CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 NO_COLOR=1 \
  scripts/lease npx vitest run --root tests/acceptance/503-redraft-ac1 --no-file-parallelism --testTimeout=3600000
node node_modules/typescript/bin/tsc -p tests/acceptance/503-redraft-ac1/tsconfig.json
```

The file builds `deep-show` once in `beforeAll` (#501's `useShow`: `cargo build --locked --bin deep-show
--no-default-features --features full`, honoring `CARGO_TARGET_DIR`) and copies it to a temporary folder. Each test is
one `deep-show run` with its own temporary evidence store, deleted after it. Every `it` carries a 3,600,000 ms timeout.
Node built-ins and vitest only; nothing is started but `cargo` and `deep-show`, each waited for. **`scripts/lanes.mjs`
needs `'tests/acceptance/503-redraft-ac1/'` in its `alone` list**, as #535's suite asks for its own: the file builds a
cargo binary and draws 1,200 frames. This README is the instruction; the implementer makes that edit.

## The fixture

`sound()` writes the criterion's file at test time: 10 s, one channel, 48 kHz, x[n] = 0.5 sin(2π · 937.5 · (n − 96,000)
÷ 48,000) for n from 96,000 (2 s) to 191,999, and 0 elsewhere, as 32-bit IEEE floats (#1819's `wavF32`), so the decoded
PCM is the samples exactly and no quantization reaches the bands. The tone starts at phase 0 and lies exactly on bin 40
of a 2048-sample window (937.5 = 40 × 48,000 ÷ 2048). It is put in the evidence store by its SHA-256 before the run.
Nothing binary is committed.

The levels the bars are held to are computed in `helpers.ts` (`spectrumRows`) from the same f32 samples by the design's
rule (Analysis bake): row r is the 2048 samples ending at r ÷ 60 s, samples [800 r − 2048, 800 r), under a periodic
Hann window; each band is 10 log10(Σ|X_k|² ÷ (3N²/32)) over the bins whose centres fall in it, the 17 edges 40 ×
400^(i/16) Hz, floored at −120 dB. Before anything runs, each test checks that this gives the criterion's own values:
at 3 s band 8 at −6.02 dB within 0.01 dB and every other band at −120 dB; at 1 s every band at −120 dB. It gives
−6.0206 dB, and 16 bands of 1 to 213 bins. Rows 0 to 120 and 243 to 599 read −120 dB in every band; rows 123 to 240
read the tone alone; rows 121, 122, 241 and 242 are the tone's edges, every band between about −72 and −6 dB.

## The surface under test

Everything goes through `deep-show run` (one JSON scenario on stdin, one answer `{"ok": true, "replies": […]}` out,
one reply per call), with #501's scenario and `deep show` (`present`: the document from your shell, `include:
["issues"]`). The issue and the design name the bake's fields, the array and the column form, but no call or planted
name. Names marked *(chosen)* are this job's, the smallest the clause needs; the implementer builds exactly these, or a
dispute goes to the owner.

### The document (`chart(sha)`)

A film envelope as #501's and #535's suites write one, 640 × 360 u, with no `layers` (the hub stamps the writer's):

```json
{
  "format": 1, "id": "spectrum-bars", "profile": "film", "title": "Spectrum bars", "description": "…",
  "size": [640, 360], "camera": "cam", "transport": {"span": "10s", "frame_rate": [60, 1]},
  "assets": {"tone": {"sha256": "<the WAV's SHA-256>", "license": {"id": "CC0-1.0", "terms": "…", "shareable": true, "credit": "…"}}},
  "bakes": {"music": {"asset": "<the WAV's SHA-256>", "analyzer": "spectrum@1", "kind": "spectrum",
                      "bands": 16, "scale": "log", "range": [40, 16000], "rate": 60, "window": 2048}},
  "items": {
    "cam": {"kind": "camera@1", "params": {"projection": "orthographic", "target": [320, 180, 0], "view_width": 640}},
    "db": {"kind": "scale@1", "params": {"type": "linear", "domain": [-128, 0], "range": [340, 84], "nice": false}},
    "bars": {"kind": "marks@1", "params": {
      "mark": "bar",
      "columns": {"level": {"array": "spectrum.music", "as": "f64"},
                  "x": {"dtype": "f32", "len": 16, "data": "<40 i + 8>"}, "x2": {"dtype": "f32", "len": 16, "data": "<40 i + 32>"},
                  "base": {"const": 340}},
      "encode": {"x": {"column": "x"}, "x2": {"column": "x2"}, "y": {"column": "level", "scale": "db"}, "y2": {"column": "base"}},
      "paint": {"fill": {"role": "accent"}}}}
  }
}
```

(Each item also carries `id`, `name` and `order`.) No `n` is written: the set's 16 rows are the array's 16 bands. Bar
i spans x 40 i + 8 to 40 i + 32 and runs from its base at y 340 up to y = 340 − 2 (level + 128), so a band's bar is 2 (level
+ 128) px tall: 16 px at −120 dB, 243.96 px at −6.02 dB. The camera shows the page at 1 px a u.

| Name | Where it comes from |
|---|---|
| `bakes: {music: {asset, analyzer, kind, …}}` | the design's paragraph on `bakes` (Analysis bake); the fields are the criterion's; `music` is a bake ID |
| `analyzer: "spectrum@1"` *(chosen)* | the base's `media_bake` names each signal kind's analyzer `<kind>@1` (`bake.rs`); the design names no spectrum analyzer |
| `{array: "spectrum.music", as: "f64"}` | the design's column form; `as` is a logic column's (Readings, below) |
| `frame_rate: [60, 1]`, `span: "10s"` | the film's frames, one per bake row, over the whole sound |

### Calls and fields

| Call | What the test sends | What it reads |
|---|---|---|
| `deep show` | the document (existing, #501's `present`) | `outcome: "presented"` |
| `frames` | `{doc, count: 600, step: "1f", pixels: true}`: the film played in order from 0 on the live session (existing, #387, #856) | `frames[k].t` = k × 11,760,000 flicks; `frames[k].pixel_hash`, the SHA-256 of the frame's canonical PNG in the evidence store |
| `eval` | `{doc, t: k × 11,760,000, pixels: true}` for each frame k, in the order k = 241 j mod 600 (j = 0 … 599), so each is a jump of 241 frames forward or 359 back on the live session, never to the next frame (existing, #387) | `outcome: "evaluated"`, `t`, `snapshots[0].sha256`, the canonical PNG in the evidence store |
| scenario `planted` | `"spectrum_plays_a_row_late"` *(chosen)* in the second test | |

A bar's height is read from the PNG: down the pixel column at the bar's centre (x 40 i + 20), each pixel's share of the
way from the ground (read at (2, 2)) to the bars' fill (read 2 px above bar 0's base), in the channel where those two
differ most, summed. A fill no different from the ground (under 32 levels) fails, naming the pixel. A frame that isn't
640 × 360 px fails, naming it. A missing reply field fails, naming it (#501's `obj`, `arr`, `int`, `str`, `hex64`).

## Wrong programs

- **`spectrum_plays_a_row_late`** *(chosen)*, the planted twin, reachable only through the scenario's `planted`:
  `spectrum.<bake ID>`, on a frame the session evaluates right after the frame one frame before it, reads the row that
  earlier frame read instead of row ⌊t × rate⌋; any other frame, a seek among them, reads its own row. Played, every
  bar shows the bands a frame late; seeked, it shows them on time. The check fails it on both counts, first at frame
  121 (2.017 s), where played bars still read row 120 (every band 16 px) while the seeked frame reads row 121 (about 126
  to 231 px), and again at frames 122, 123 and 241 to 243.
- Heights that don't follow the bands fail the first test at the frames where the bands move: bars held at one row,
  bars read a row early or late, a scale or base that draws a level at another height, fewer than 16 bars (a missing
  bar is 0 px against 16 px from frame 0), or a column that reads nothing.
- At the base (expected, not run here; BASE-FAILURE.txt), the first test fails at `deep show`: the envelope has no
  `bakes` key (`unknown_field`), and no module fills a `{array: "spectrum.…"}` column. The second fails sooner: the
  base doesn't know the planted name, so the scenario is `bad_input`.

## BLOCKED and INCONCLUSIVE

No leg reads BLOCKED or INCONCLUSIVE. Both sides draw through the canonical CPU raster (`snapshot.rs`'s `raster`),
the one `eval` and `frames` share, so no GPU, device, timing or load enters the readings; what's missing fails.

## Readings where the issue and design leave a choice

- **A bake's fields sit beside `kind`.** "`bakes: {ID → {asset, analyzer, kind and the kind's fields}}`": `bands`,
  `scale`, `range`, `rate` and `window` are written next to `kind: "spectrum"`, as the base's `media_bake` takes a
  signal kind's fields, not under `params` or a nested `kind`.
- **`asset` is the sound's SHA-256**, the name every document read of the store goes through (Asset: Semantics), as
  an image's `asset` and a strip's `src` are; the sound is also listed in `assets` with its license.
- **The column carries `as: "f64"`.** The design writes it `{array: "spectrum.<bake ID>"}`, read "as it reads a logic
  array", and a logic column takes `as`; the array's elements are f64.
- **"Seeked or played at every frame".** Played is `frames`: one session drawing frames 0 to 599 in order. Seeked is
  `eval` at each frame on the same session, each a jump. Every frame of the 10 s span at 60 fps is compared; at 60 fps
  frame k is bake row k exactly (⌊k × 11,760,000 × 60 ÷ 705,600,000⌋ = k).
- **"Heights read the bands"** is held to the design's levels computed from the fixture, not to a level the program
  reports, within 1 px (0.5 dB): an anti-aliased top edge covers one pixel in part, and the base at y 340 is on a pixel
  edge. A one-sample shift of the window's end moves no level by more than 0.05 dB. "The same heights" is exact: a
  frame's played and seeked heights, read from 8-bit pixels the same way, must be equal.
- **A film, not a chart profile**, since the bars play over the sound's 10 s and a film has a transport to seek in.

## Files

- `chart.test.ts`: the two tests.
- `helpers.ts`: the fixture, the design's spectrum, the document, the calls, the height reading and the judge.
- `tsconfig.json`: the root options with `noEmit` and `allowImportingTsExtensions`, as other suites'.
- `BASE-FAILURE.txt`: the expected first failure at the base.
