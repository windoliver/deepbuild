# #491 blind suite: the #2047-sweep redraft with criterion IDs

## Why

The proof lanes (`scripts/proof.mjs` before/trace, `scripts/proof-change.mjs` `criterionId`) know a criterion only
by its ID, `#491.` + the first 8 hex characters of the SHA-256 of the `- [ ]` criterion text (trimmed, whitespace
collapsed to single spaces), and a test carries a criterion only when its name holds that ID literally. The original
tests here are named `criterion <n>: …`, so no lane saw them and the #2047 sweep reopened the issue. This redraft
adds, beside each original `<name>.test.ts`, a `<name>-ids.test.ts` whose names carry the IDs. The IDs below were
recomputed with node's `crypto` over the issue's current criterion text.

## Criterion IDs

| # | Criterion starts | ID |
|---|---|---|
| 1 | A 120 BPM beat grid places beat k at exactly k × 352,800,000 flicks … | `#491.f573affb` |
| 2 | With a tempo map, a boundary written on a downbeat lands within one frame … | `#491.225d1288` |
| 3 | A 16-beat ramp from 90 to 150 BPM, linear in beats, ends 8.1732 s … | `#491.87664ed5` |
| 4 | A cue written as a literal 12.5 s in a film with a tempo map … | `#491.1fdc38d2` |
| 5 | Over `markers.beat` filtered by the tag kick … | `#491.f247d95a` |
| 6 | With x = −4 + 3t, a marker at `first {expr: x − 3}` … and a linear key on a frame's layout … | `#491.9977dd4e` |

## Original → redraft

| Original `path › test name` | Redraft `path › test name` |
|---|---|
| `beat-grid.test.ts › criterion 1: every beat k = 0 … 100,000 of a 120 BPM grid lands at exactly k × 352,800,000 flicks` | `beat-grid-ids.test.ts › #491.f573affb every beat k = 0 … 100,000 of a 120 BPM grid lands at exactly k × 352,800,000 flicks` |
| `beat-grid.test.ts › criterion 1: a planted grid kept in f32 seconds fails the check, its first failure naming the first beat that differs` | `beat-grid-ids.test.ts › #491.f573affb a planted grid kept in f32 seconds fails the check, its first failure naming the first beat that differs` |
| `tempo-map.test.ts › criterion 2: the section boundary written on the downbeat 9:1b lands within one frame of 32 × 60 ÷ 107 s` | `tempo-map-ids.test.ts › #491.225d1288 the section boundary written on the downbeat 9:1b lands within one frame of 32 × 60 ÷ 107 s` |
| `tempo-map.test.ts › criterion 2: every beat of both sections resolves to its exact time rounded to the nearest flick` | `tempo-map-ids.test.ts › #491.225d1288 every beat of both sections resolves to its exact time rounded to the nearest flick` |
| `tempo-ramp.test.ts › criterion 3: a 16-beat ramp from 90 to 150 BPM ends 8.1732 s after it starts, within one flick of its closed form` | `tempo-ramp-ids.test.ts › #491.87664ed5 a 16-beat ramp from 90 to 150 BPM ends 8.1732 s after it starts, within one flick of its closed form` |
| `tempo-ramp.test.ts › criterion 3: a segment whose explicit time is 2 flicks off its chained start is refused, naming both times` | `tempo-ramp-ids.test.ts › #491.87664ed5 a segment whose explicit time is 2 flicks off its chained start is refused, naming both times` |
| `literal-time.test.ts › criterion 4: the cue at the literal 12.5 s raises literal_time_with_tempo_map, and the bar:beat form it offers lands on the same flick` | `literal-time-ids.test.ts › #491.1fdc38d2 the cue at the literal 12.5 s raises literal_time_with_tempo_map, and the bar:beat form it offers lands on the same flick` |
| `occurrence-lists.test.ts › criterion 5: at t = 3 s the driver reads count 2, last 2.5 s, since 0.5 s, next 4.0 s, rank 1 and last(kicks).gain 0.8` | `occurrence-lists-ids.test.ts › #491.f247d95a at t = 3 s the driver reads count 2, last 2.5 s, since 0.5 s, next 4.0 s, rank 1 and last(kicks).gain 0.8` |
| `occurrence-lists.test.ts › criterion 5: at t = 0.5 s count reads 0 and last(kicks).gain takes the driver's fallback` | `occurrence-lists-ids.test.ts › #491.f247d95a at t = 0.5 s count reads 0 and last(kicks).gain takes the driver's fallback` |
| `occurrence-lists.test.ts › criterion 5: next over a list that inputs feed is refused at check, naming the driver` | `occurrence-lists-ids.test.ts › #491.f247d95a next over a list that inputs feed is refused at check, naming the driver` |
| `first-marker.test.ts › criterion 6: with x = −4 + 3t, the marker at first {expr: x − 3} resolves to 7/3 s within one flick` | `first-marker-ids.test.ts › #491.9977dd4e with x = −4 + 3t, the marker at first {expr: x − 3} resolves to 7/3 s within one flick` |
| `first-marker.test.ts › criterion 6: a condition never true before \`before\` is refused, naming the marker` | `first-marker-ids.test.ts › #491.9977dd4e a condition never true before \`before\` is refused, naming the marker` |
| `layout-glide.test.ts › criterion 6: a linear key from row to grid over 1 s puts each child at the midpoint of its two layout positions at 0.5 s within 0.5 px, seeking equal to playing` | `layout-glide-ids.test.ts › #491.9977dd4e a linear key from row to grid over 1 s puts each child at the midpoint of its two layout positions at 0.5 s within 0.5 px, seeking equal to playing` |

The `describe` names change the same way (`criterion <n>: ` → the ID and a space).

## What differs from the originals

Exactly two things, nothing else:

1. Each redraft file opens with a three-line header comment saying it is the #2047-sweep redraft and naming its IDs.
2. Each `it` and `describe` name starts with its criterion's ID and a space in place of `criterion <n>: `.

Scenes, documents, imports (`./helpers.ts`, unchanged), assertions, messages, expected values and timeouts are line
for line the originals'. With the header dropped and each ID mapped back to `criterion <n>: `, every redraft file is
byte-identical to its original. No test was added: the issue's current criterion text is the text the originals
quote, and every clause of it has an assertion in the originals.

## Kept as they are

`README.md`, `helpers.ts`, `BASE-FAILURE.txt`, `tsconfig.json` and the seven original `*.test.ts` files are not
touched. `README.md` still says the names start with `criterion <n>`; that holds for the originals, and this file
covers the redraft. No twins or `twins.json` are written here; the implementing side adds those.

## Two copies of one file's binary

`useMotion()` in `helpers.ts` builds `deep-motion` with cargo and copies it into a fresh `mkdtemp` directory
(`deep-491-motion-*`) per test file, under the fixed name `deep-motion`, removing that directory after the file. The
copy's path doesn't come from the test file's name, so an original and its redraft run one after the other each get their own copy and never
overwrite each other's. (Run in parallel they would still share the one `target/debug` build that both copy from.)
