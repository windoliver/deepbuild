# Acceptance tests for #1436: chrome-fx@1, 24 effects on the app's surfaces, bound to the record, with a still pose and a measured cost each

Written first, blind, from issue #1436 (Scope, Fields, its ten acceptance criteria, Proof, Depends on), the design and
the base commit `a3efe5c8` (on `f1e8736e`), by a job that never saw an implementation; none existed. The implementing
agent doesn't edit these files (AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding).

What was read: `AGENTS.md`; `docs/canvas-primitives.md` (Effect, whose semantics already describe `chrome-fx@1`; Every
public step; Operator budgets by class); `docs/technical-design.md` (Bound value and status binding, Look, Effect, GPU
operator, Bound value in panels, States people see, the record's readings and `reading:<source>#<series>` handles);
issue #1035 (looks set chrome-fx@1 effects for roles; status, the card and the access and key prompts stay fixed); at
the base `crates/deep-app/src/{chrome_fx,chrome_fixture,chrome,panel_values,states}.rs`,
`crates/deep-replica/src/{main,lib,chrome}.rs`, `crates/deep-effects-render/src/chrome.rs`,
`crates/deep-canvas-effects/src/{shipped,fx}.rs`, `crates/deep-canvas-marks/src/look.rs` (INK_TIERS, the contrast
guard) and `looks/clean.json`, `packs/fx-1.0.0/pack.json`, `scripts/benchmark.mjs` (`judgeLimit`), `scripts/lanes.mjs`,
`scripts/proof-change.mjs` (criterion IDs), and the suites `tests/acceptance/1434` (the surface this extends, and whose
`at`, `judge`, `load` and `p95` are reused by import), `380`, `391` (its PNG reader), `431` and `1479` (the taste call).

## Run them

```sh
npm ci                                        # once
npx tsc -p tests/acceptance/1436/tsconfig.json
npx vitest run --root tests/acceptance/1436 --no-file-parallelism            # everything headless
# by hand on the reference Mac, the live window on this Mac's screen (never in CI):
DEEP_1436_LIVE=1 npx vitest run --root tests/acceptance/1436 --no-file-parallelism ac2-still.live ac9
```

macOS with Metal and cargo on `PATH`; anywhere else each test fails `INCONCLUSIVE:` and never passes. Every test first
needs the shipped pack at `packs/chrome-fx-1.0.0/pack.json`; nothing builds without it. Files build once before their
tests and copy the binary out of `target/`:

- `cargo build --locked -p deep-replica --bin deep-replica --features chrome-fixture` (every headless file);
- `cargo build --locked --release -p deep-app --bin deep-app --features chrome-fixture` (the two `*.live.test.ts`
  files, only with `DEEP_1436_LIVE=1`; without it their tests fail `INCONCLUSIVE`).

Lanes (the implementer edits `scripts/lanes.mjs`, as #1434's lines 220-224 do): `tests/acceptance/1436/` in `alone`
(its files build cargo binaries and drive the GPU); `ac2-still.live.test.ts` and `ac9-budgets.live.test.ts` in
`byHand`; `ac9-budgets.live.test.ts` in `timed`, the local preflight's perf step that sets `DEEP_1436_LIVE=1` on the
reference Mac. A run with `--root` leaves Vitest's cache in `tests/acceptance/1436/node_modules/.vite`; delete it.
`BASE-FAILURE.txt` is the run at the base.

## The surface under test

The issue names a pack (`chrome-fx@1`), its 24 operators, the effect's fields (`{operator, params, class, still,
bind?}`), a gallery panel and a pack check, but no binary. So the tests extend #1434's surface: its `chrome@1` fixture,
`deep-replica --chrome` and `deep-app --chrome`, behind the same `chrome-fixture` Cargo feature, plus two replica modes,
the pack check and the gallery. How the operators are built (graphs from the public steps, passes, particles) is the
implementer's.

### The pack, `packs/chrome-fx-1.0.0/`

A pack folder like `packs/fx-1.0.0/`: `pack.json` holds `operators`, an object keyed by each operator's name exactly
as the issue writes it (`halo.soft`, …, `text.glow`, no `@1`). Each operator's entry carries its `still` (the authored
still pose; any shape) and whatever else it needs (class, params, cost, fixture, its planted twin, graphs); its fixture
and twin may be other files of the folder. The only shape a test relies on: `operators["halo.soft"].still` exists, and
a copy of the folder without it is a pack with one stillless operator (criterion 2).

### `deep-replica --chrome-fx-check <pack dir> --out <dir>`

The pack check: runs every operator's checks and fixture and writes `<dir>/check.json`; exits 0 when the pack passes,
1 when it's refused.

```jsonc
{
  "pack": "chrome-fx@1",
  "pass": bool,                                         // true exactly when the exit status is 0
  "operators": [{
    "operator": "halo.soft",
    "class": "quiet" | "expressive",
    "params": [{"name", "range": [lo, hi], "default"}], // in the operator's order
    "cost_ms": number,                                  // its measured cost at 960,000 covered px
    "still": bool,                                      // it has an authored still pose
    "fixture": "pass" | "fail"
  }],
  "refusals": [{"operator", "code", …}]                 // codes below
}
```

### `deep-replica --chrome-fx-gallery --appearance <light|dark> --out <dir>`

Draws the gallery panel headless, as the app shows it, in that appearance, and writes `<dir>/screens/gallery.png`
(8-bit RGB or RGBA, device px) and `<dir>/gallery.json`: `{"appearance", "operators": [{"operator", "class", "cost_ms",
"still": true, "rect": [x, y, w, h]}]}`, where `still: true` says the tile shows the operator's still pose and `rect` is
the operator's tile in the PNG's device px. Its pixels must be the same in every run on one machine (criterion 10's
taste call is recorded on their SHA-256).

### The fixture, `chrome@1`, with what #1436 adds

Everything in `../1434/README.md` holds; these tests add:

```jsonc
{
  "background": [r, g, b] | "<role>",   // also a chrome role's name (#882), resolved in the run's appearance
  "view"?: "needs-you" | "sidebar" | "session",        // the working view the nodes are drawn as; none: not a working view
  "record"?: [Event],                   // events the app's one record reader folds before drawing, such as
                                        //   {"id", "kind": "reading.recorded", "data": {"reading": "reading:<source>#<series>", "value", "as_of": ms}}
  "now"?: ms,                           // the record's time the frame is drawn at (a bound value's freshness is judged at it)
  "nodes": [Node]
}
Node += {
  "fill"?: … | "<role>",                // also a chrome role's name
  "text"?: {"content", "size", "color": [r, g, b] | "<role>"},  // e.g. "ink_secondary"
  "effect"?: {
    "operator": "<a chrome-fx@1 operator>" | "frost@1",
    "params"?: {name → value},          // missing params take the operator's defaults; {} is every default
    "place": "under" | "over",
    "seed"?: u32,                       // the effect's seed: particles and noise are a function of it and the time
    "bind"?: {param → "reading:<source>#<series>"},   // the param reads that reading from the record
    "asked"?: {"by": "look" | "panel", "name"},       // the look or panel you picked that asks for this effect
    "on"?: "<role>"                     // the role a look or panel sets the effect for (#1035), e.g. "raised",
                                        //   or a fixed one: "status_mark" | "card" | "prompt"
  }
}
```

The class is the operator's, from the pack; a fixture never gives it. A particle collides with the rect of every node
that draws a fill, other than its own effect's node and that node's ancestors, and with the question card's slot.

### `deep-replica --chrome <fixture> --out <dir> [--appearance <light|dark>] [--reduce-motion] [--at <s>]… [--omit-effect <id>]… [--omit-text <id>]…`

#1434's replica, with:

- `--appearance`: the chrome's appearance, as the replica's `--view` takes it (light when none is given).
- `--reduce-motion`: the app's reduced motion on, as macOS's Reduce Motion setting turns it on.
- `--at <s>`: draws the frame at `s` seconds of the effect clock (0 at the window's first frame). With one or more,
  the replica writes `screens/chrome-<i>.png` for the i-th `--at` (from 0) instead of `screens/chrome.png`, which is
  the frame at 0 as in #1434.
- `--omit-text <id>`: draws the window with that node's text glyphs taken out and nothing else changed: layout, every
  effect and anything the app does to keep text over an effect at its floor stay as they are with the glyphs drawn.

`chrome.json`, for the last frame drawn, holds:

- `refusals: [Refusal]`, #1434's record of refused effects, with the codes below. A refused effect draws nowhere.
- `bound: [{"effect": node id, "param", "source": reading handle, "value", "as_of": ms}]`: each bound param as the
  frame shows it, its source and as-of time like any bound value. Other fields (staleness, text) are allowed.
- `particles: [{"effect": node id, "index", "seed", "path": [[t, x, y], …], "stopped": null | {"on": node id, "at":
  [x, y], "t"}}]`: every particle alive or stopped at the frame's time, in window points: its path sampled from its
  emission to the frame's time (at most 1/60 s apart, its last point where it is), and where and when it stopped on a
  rect it collided with.

### `deep-app --chrome <fixture> [--reduce-motion] (--after-first <s> | --frames <n> | …)`

#1434's live window, with `--reduce-motion` (as above) and one more mode, `--after-first <s>`: counts the frames the
window presents in the `s` seconds of the real clock after the first frame it presents once AppKit reports it visible,
that frame not counted. Report line `{"chrome": <n>, "mode": "after_first", "scale", "seconds", "frames", "effects":
[{"id", "state": "settled" | "unpainted" | …}]}`, `effects` being every node with an effect and whether the first frame
painted it. `--frames <n>` is #1434's, unchanged.

### Refusals

| Where | Code | Fields | When |
|---|---|---|---|
| `check.json` | `chrome_fx_fixture_failed` | `operator` | the operator fails its fixture |
| `check.json` | `chrome_fx_no_still` | `operator` | the operator has no authored still pose |
| `check.json` | `chrome_fx_flash_rate` | `operator`, `rate` (flashes a second, measured), `limit: 3` | it flashes more than 3 times a second |
| `chrome.json` | `chrome_fx_bind_literal` | `effect`, `operator`, `param` | a `bind` entry is a literal value, not a reading handle |
| `chrome.json` | `chrome_fx_expressive_unasked` | `effect`, `operator`, `view` | an expressive effect in a working view that no look or panel asked for |
| `chrome.json` | `chrome_fx_fixed_role` | `effect`, `role` | an effect on `status_mark`, `card` or `prompt` |

### Planted programs (`DEEP_CHROME_PLANT=<name>`, read only in a `chrome-fixture` build)

| Name | The wrong program | Criterion |
|---|---|---|
| `twin:<operator>` (24 of them) | The pack check runs with that operator swapped for its planted twin, the pack's own, which fails its fixture | 1 (issue-named) |
| `flashes_4hz` | The pack check runs with one operator added, `planted.flash`, which flashes 4 times a second at its defaults | 7 (issue-named) |
| `drops_secondary_ink` | A planted effect: every effect slot, from t = 3 s, also composites the secondary ink's own color, opaque, over the rect of each text node inside its node. Nothing else changes; whatever holds text to its floor at run time doesn't correct it | 5 (issue-named) |

Planted inputs, not programs: criterion 2's operator with no still pose (a copy of the pack folder without
`operators["halo.soft"].still`), criterion 3's literal (`bind: {param: <number>}`), criterion 6's expressive effect
nobody asked for and its effects on a status mark, the card and a prompt.

### The fixtures (`helpers.ts`)

- `grid()`: 970 × 610 pt at scale 1 on `ground`: a 6 × 4 grid of 150 × 140 pt tiles, one per operator in the issue's
  order, each `{backdrop: {scale: 1}, effect: {operator, params: {}, place: "under", seed: 1436}}` with no fill, and a
  child text line, "Sixty sampled frames", 13 pt in `ink_secondary`, in an 18 pt rect 34 pt above the tile's foot.
- `budget(op)`: 640 × 440 pt at scale 2: one 600 × 400 pt node (960,000 px) covered by `op` at its defaults.
- `embers(cards)`: `edge.flame` (seed 1436, over) on a raised node at [380, 280, 200, 80] in a 960 × 640 window, and
  raised cards `card-above` [280, 200, 400, 40] and `card-below` [280, 400, 400, 40], or those moved 24 pt out and 16 pt
  right, or none.
- `halo(bind, value)`: `halo.soft` (under) on a node at [100, 80, 280, 160] around a raised card, `now` 1 s after the
  reading's `as_of`, the record one `reading.recorded` of `reading:tokens#s-1436`.
- `inView(expressive, quiet)`: `view: "session"`, four nodes: `unasked`, `by-look` (`asked: {by: "look"}`), `by-panel`
  (`asked: {by: "panel"}`) with the pack's first expressive operator, and `quiet`.
- `onRoles(quiet)`: the pack's first quiet operator `on` `status_mark`, `card`, `prompt` and `raised`.

## Criteria to tests

| Criterion (`scripts/proof-change.mjs` ID) | Test | How it is judged |
|---|---|---|
| 1 `#1436.5c03c03a` All 24 operators pass the pack check and render in the gallery in light and dark. Each has a fixture and a planted twin that fails it, naming the operator | `ac1-pack.test.ts` | The shipped pack's check exits 0, listing exactly the 24 names, each with a class, `cost_ms` > 0, `still` and its fixture passing, nothing refused. The gallery in light and in dark lists the 24 with the pack's class, a cost and `still`, each tile inside the PNG, not one flat color, and not the same pixels in both appearances. Then 24 checks, one per `twin:<operator>`: exit 1, a `chrome_fx_fixture_failed` naming that operator, no other operator refused |
| 2 `#1436.31e7ab56` Under reduced motion every operator holds its still pose, with 0 frames after the first. A planted operator with no still pose is refused at pack check | `ac2-still.test.ts`, `ac2-still.live.test.ts` | The grid under `--reduce-motion` at 0, 1.3, 2.9 and 4.7 s: four byte-equal frames; without it the four aren't all equal. Live: `--after-first 5` with reduced motion, every effect painted and 0 frames; without it, more than 0. The pack copy without `halo.soft`'s `still`: exit 1, `chrome_fx_no_still` naming `halo.soft`, nothing else refused |
| 3 `#1436.3fbd4701` A halo bound to a recorded token rate changes with the record and shows its source. A planted literal value fails, naming the param | `ac3-bound.test.ts` | `halo.soft`'s first ranged param bound to `reading:tokens#s-1436`, over records of a quarter and three quarters into its range, at 1 s: each frame's `bound` shows the param, its source, the recorded value and as-of time, and the halo node's pixels differ between the two. A number in place of the handle: `chrome_fx_bind_literal` naming the param |
| 4 `#1436.e115c07f` An ember's path stops at a card's edge, and moving the card moves where embers land, with the same seed | `ac4-embers.test.ts` | `embers` at 4 s: an ember stops on a card, at a point within 0.5 pt of its edge and not inside, its path ending there; no path point is inside a card by more than 0.5 pt. With no cards, a path goes more than 1 pt inside where a card was. With the cards moved, each ember in both runs leaves from the same first point, the stops are on the moved edges, and the set of landings differs |
| 5 `#1436.9efc2e16` Text over each operator keeps its contrast floor at 60 sampled frames. A planted effect that drops secondary ink below its floor fails, naming the frame and the ratio | `ac5-contrast.test.ts` | The grid at t = k × 0.1 s, k = 0 … 59, in light and dark, every text omitted: for each frame and operator, the clean look's `ink_secondary` composited over each pixel of the text's rect keeps 4.5:1 against that pixel (WCAG 2.x, as look.rs computes). `drops_secondary_ink` fails the same check, its first finding `frame k (t s), <operator>: ratio r.rr under …` |
| 6 `#1436.c015619d` An `expressive` effect in a working view with no look or panel that asked is refused, naming the effect and the view. One on a status mark, the card or a prompt is refused, naming the role | `ac6-refusals.test.ts` | `inView` at 1 s: one refusal, `{effect: "unasked", operator, view: "session", code: "chrome_fx_expressive_unasked"}`; `by-look`, `by-panel` and `quiet` not refused; `unasked`'s rect byte-equal to the window drawn without it, `by-look`'s not. `onRoles`: one `chrome_fx_fixed_role` per fixed role naming it, each drawing nowhere; `on-raised` not refused |
| 7 `#1436.46fdbc09` A planted effect flashing 4 times a second is refused, naming the rate | `ac7-flash.test.ts` | The pack check under `flashes_4hz`: exit 1, one `chrome_fx_flash_rate` for `planted.flash` with `rate` within 0.25 of 4 and `limit` 3; no shipped operator refused |
| 8 `#1436.d68d7e2e` Two renders at one time on the same machine are byte-equal | `ac8-repeat.test.ts` | The grid at 2.5 s, two replica processes, light and dark: every RGBA byte equal |
| 9 `#1436.0791f1fa` Budgets, on the reference Mac in the local preflight, per operator at 960,000 covered px: under 1 ms, or under 2 ms for `edge.flame`, `fill.liquid_metal` and `warp.haze`; everything visible at once under 3 ms a frame | `ac9-budgets.live.test.ts` | Per operator, `budget(op)` against itself with no effect; and the grid against the grid with none. `--frames 360`, a run's cost the p95 of `cpu_ms + gpu_ms` over its last 300; the added time the difference; a warm-up pair, then five runs alternating sides, judged by `judgeLimit` (1, 2 or 3 ms). The table goes to the console and `docs/evidence/1436/budgets.json` |
| 10 `#1436.2ff55cf0` Shown to you: the gallery in light and dark, taken by the check run, is attached to the PR. Whether each looks right is one taste call, recorded; without it the run stays INCONCLUSIVE | `ac10-taste.test.ts` | See The taste call |

Proof line: "the gallery" is criterion 10's two PNGs; "the budget table per operator" is criterion 9's
`budgets.json`; "the refusal text for each planted case" is the refusals criteria 1, 2, 3, 5, 6 and 7 assert, which
their failure messages print.

Budgets go through `scripts/benchmark.mjs`'s `judgeLimit` with the load at each run's start and end: PASS only on a
reference Mac (Mac15,7, Mac15,12 or Mac17,10) on mains power, Low Power Mode off, the thermal state nominal and the load
under the core count, all five runs within the limit; FAIL when all five are over by more than the margin; otherwise
INCONCLUSIVE, which fails the test and never passes it. A live window off scale 2 is INCONCLUSIVE for criterion 9.

## The taste call

`ac10-taste.test.ts` draws the gallery in light and dark (`--chrome-fx-gallery`), writes the replica's PNGs byte for
byte to `docs/evidence/1436/gallery-light.png` and `gallery-dark.png` (attach both to the PR) and prints each SHA-256.
The call is `tests/acceptance/1436/TASTE.json`, #1479's shape:

```json
{"issue": 1436, "criterion": "#1436.2ff55cf0", "verdict": "looks_right" | "looks_wrong", "who": "<who>",
 "when": "<ISO time>", "screenshots": {"gallery-light.png": "<sha256>", "gallery-dark.png": "<sha256>"}, "note": "…"}
```

No file, or one on other pictures, is INCONCLUSIVE; `looks_wrong` fails; `looks_right` on exactly these two passes.
One call covers every tile in both pictures. No other test reads a picture to judge how it looks.

## Readings where the issue and design leave a choice

- **The pack check's place.** No binary is named; it is a replica mode on the pack folder, so a planted pack is a
  folder. Operator names are the issue's, bare, inside a pack named `chrome-fx@1`.
- **"A fixture and a planted twin"** are the pack's own, per operator; the test can't judge 24 effects' looks itself,
  so it proves each fixture can fail by swapping in that twin (`twin:<operator>`), and that the failure names it alone.
- **"Render in the gallery"** is read as a drawn, non-flat tile per operator that differs between light and dark. That
  an operator looks right is the taste call's, not this test's.
- **"Holds its still pose, with 0 frames after the first"**: "holds" is the replica's frames at four times being
  byte-equal under reduced motion; "0 frames" is the live window's presented frames after its first once shown (the
  frames before AppKit reports it visible aren't the window's first). The headless replica can't count presented frames.
- **The bound halo** binds its first ranged param straight to the reading (Fields: `{param → reading}`), the value
  taken in the param's units; the two records sit a quarter and three quarters into its range. "Shows its source" is
  read on `chrome.json`'s `bound`, as `--bound`'s `bound.json` is for #629. A "planted literal value" is input: a number
  where a reading handle goes, refused as a bound value that nothing measured.
- **Embers and cards.** The direction embers travel isn't given, so a card sits on each side of the flame. "Stops at a
  card's edge" is within 0.5 pt of the card's rect, outside or on it, with no path point inside. "Moving the card moves
  where embers land, with the same seed": same first points (the seed's), different landings, on the moved edges.
- **"60 sampled frames"** are t = 0, 0.1, …, 5.9 s. "Its contrast floor" for secondary ink is 4.5:1 (#882's INK_TIERS),
  measured as the ink composited over each pixel the text's rect covers with the glyphs omitted, against that pixel, at
  its lowest over the rect. That's stricter than a glyph-by-glyph reading, and holds the effect, not the text's
  antialiasing, to the floor. Both appearances are checked; the planted case in light only.
- **"A planted effect that drops secondary ink below its floor fails"**: the test's own check fails on it, naming the
  frame and the ratio; nothing requires the app to refuse it.
- **Working views** are the shipped views (`needs-you`, `sidebar`, `session`); a fixture with no `view` isn't one.
  "A look or panel that asked" is the effect's `asked`. The class is the pack's per operator; the tests use the pack's
  first expressive and first quiet operator in the issue's order, so the pack must have one of each.
- **"On a status mark, the card or a prompt"** is read through roles, as #1035 lets a look set chrome-fx@1 effects for
  roles: an effect whose `on` names a fixed role is refused naming it, and draws nowhere. The access and key prompts are
  the OS's windows (#1434's chrome_fx.rs), so a role is the only way an effect can name one. #1434's geometric guard of
  the card's slot stays covered by its own suite.
- **The flash plant** is a planted operator the pack check measures, refused there with its measured rate (within
  0.25 of 4). A flash rate an effect reaches at run time through bound params isn't tested.
- **"Two renders at one time"**: the same `--at` in two processes, every pixel byte, light and dark.
- **Budgets per operator**: at its defaults, its node read as a backdrop (glass and warp need one), against the same
  window with the effect and backdrop taken out (what the merge base draws). "Everything visible at once" is the grid
  of all 24 against the grid with none.
- **The taste call** follows #1479's file (`TASTE.json` in this folder) and evidence folder (`docs/evidence/1436/`).

Not tested, because no criterion leans on it: composing a new operator from a sentence; a state an effect shows also
having its word and glyph; the shipped clean look carrying no `chrome-fx@1` effect at rest (#1453); an operator
running shader text; a bound param going stale; flashes reached through bound params; an expressive effect in a view
that isn't working; per-frame contrast for text styles other than secondary ink.
