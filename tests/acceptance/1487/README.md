# Acceptance tests for #1487: an item out of view stops the clock

Written first, from issue #1487 (its scope, its three acceptance criteria, its proof line and its "not in scope"),
the design sections it names and the base commit `dd83ac2f` ("Merge pull request #1692 …"), by a job that never
saw an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute
goes to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/canvas-primitives.md`: Frame clock and scheduler (line 736: "Arms a frame only on a commit, a changed
  reading, input, … a `valid_until` …"; the kit case "on a virtual display clock twice over its span plus 5 s:
  once evaluating only on armed frames, once on every vsync … byte-identical in both runs"; "A document's
  `valid_until` takes only items whose bounds meet the view, so an item out of view stops the clock, and a pan that
  brings it back arms a frame; canonical renders ignore the view"; Cost "Idle: 0 frames and 0 wakeups as the
  target"); Invalidation and damage (752); Spatial index (826: "Every 2D view keeps an R-tree"); One clock, pure
  evaluation (5126: `frame(t) = eval(doc, t, inputs ≤ t, view)`; step 7 "The frame's `valid_until`, the earliest
  time anything visible changes next"); Transport (5142).
- `docs/technical-design.md`: Dogfooding, Tests written first.
- At the base: AGENTS.md; `tests/acceptance/391/` (the kit case, `deep-motion run`, its planted
  `valid_until_ignores_placements`, the JSON-lines convention), `383/` (pans as input, presented frames), `854/`
  (`deep-canvas-render idle` on the real clock, the reference-Mac gate); `crates/deep-motion/src/main.rs` (`run`,
  `eval`), `crates/deep-canvas-motion/src/clock.rs`, `crates/deep-marks-render/src/lib.rs` and `macos.rs` (`idle`,
  `view`), `scripts/lanes.mjs`.

What the base does: `deep-motion run` arms a frame at vsync 0 and whenever the shown frame's `valid_until` passes,
and `valid_until` is the earliest change of any item in the document; neither `run` nor `deep-canvas-render idle`
reads a view rect (both ignore an unknown field), and `run` has no pans. So a turning item anywhere keeps the clock
at one frame per vsync (on the real clock `idle` drew 1,113 frames in 2 s here).

## Run them

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1487 --no-file-parallelism
npx tsc -p tests/acceptance/1487/tsconfig.json   # type-check: the root's strict options, allowImportingTsExtensions, noEmit
```

Each file first runs `cargo build --locked --bin <name>` in the checkout (`deep-motion`, or `deep-canvas-render`
for `wakeups.test.ts`), so `cargo` must be on PATH, and fails each of its tests when the build fails. The tests use
node built-ins and vitest only. `wakeups.test.ts` holds a window on the real clock for 5 s a run, a warm-up and
five runs per program (about a minute in all). A run with `--root tests/acceptance/1487` leaves Vitest's cache in
`tests/acceptance/1487/node_modules/.vite`; delete it.

`scripts/lanes.mjs` needs `'tests/acceptance/1487/'` in its `alone` list (beside `391/`: the files build cargo
binaries), and `'tests/acceptance/1487/wakeups.test.ts'` in its `timed` list (beside `854/idle.test.ts`: it reads
the real clock). This README is the instruction; the implementer makes that edit.

Where each is judged: frame counts on the virtual clock and hashes (`frames`, `return`, `kit`) on any machine.
`wakeups.test.ts` draws with GPUI's offscreen Metal renderer: off macOS, or when the binary answers
`unsupported_platform`, each of its tests skips with a message starting `INCONCLUSIVE`. Its frame counts are judged
on any Mac; its wakeups only on a reference Mac (Mac15,7 / Apple M3 Pro / 36 GiB or Mac15,12 / Apple M3 / 16 GiB):
elsewhere it records them, prints them and skips as `INCONCLUSIVE (reading only)`. It never passes by skipping.

## The surface under test

The issue names a view, pans, frames, wakeups, a hash and the kit case, but no API. These tests add the smallest
fields they need to the two binaries that already carry the frame clock: `deep-motion run` (#391's kit case on the
virtual display) and `deep-canvas-render idle` (#854's window on the real clock). `deep-motion eval` is used
unchanged as the straight evaluation. No new binary, subcommand or output field.

Rects are `[x, y, w, h]` in document u (logical px, y down), `w` and `h` above 0.

### `deep-motion run`, with the view

#391's request `{doc, to, mode: "armed" | "every_vsync", refresh_hz?, planted?}`, unchanged, with two fields added:

- `view?: {rect: Rect}`: the region the view shows from vsync 0. Without `view`, the whole document is in view,
  as at the base (so #391's kit case is unchanged).
- `pans?: [{at: flick, rect: Rect}]`, in increasing `at`, each `at` a vsync time (`k × 705,600,000 ÷ refresh_hz`):
  a pan, your input, arriving at that vsync; from it on the view shows `rect`. A pan is input, so the vsync it
  arrives at presents a frame in `armed` mode.

In `armed` mode the shown frame's `valid_until` is the earliest time anything changes next among the items whose
bounds meet the view in effect (the item's bounds as the view's spatial index holds them); an item out of view
doesn't count, so with no visible item changing it is `null` and nothing is presented until the next pan. The
evaluation itself doesn't change (`t` stays pure): every presented frame is `eval(doc, t)`, every item evaluated at
`t`, wherever the view is. `every_vsync` evaluates every vsync, as at the base. The answer is #391's, unchanged:
`{"ok": true, "vsyncs": [{"t", "presented", "valid_until", "items"}]}`, one per vsync, `items` being the shown
frame's (the last presented one's) evaluated items, all of them.

A `view` whose `rect` isn't four numbers with `w, h > 0`, a pan off a vsync, pans out of order, or an unknown
`planted` value answers `{"ok": false, "code": "bad_input"}`.

`deep-motion eval` with no `view` is the canonical, straight evaluation: its frames' `valid_until` stays the
earliest change of any item ("canonical renders ignore the rule").

### `deep-canvas-render idle`, with the view's rect

#854's request `{doc, look, view, seconds, planted?}`, unchanged, with `view.rect: Rect` added beside `zoom` and
`theme`: the window shows that region of the document (`w × h` at the zoom), and the frame clock's `valid_until`
counts only items whose bounds meet it. The answer is #854's: `opened_frames`, `seconds`, `frames`, `drawn`,
`wakeups` (package-idle wakeups of the process), `cpu_ms`, `cpu_fraction`.

### Planted programs

Each reachable only through `planted`, only to prove a test fails on a wrong program.

| Binary | `planted` | The wrong program | Test |
|---|---|---|---|
| `deep-motion run`, `deep-canvas-render idle` | `valid_until_ignores_view` | the merge base's rule: `valid_until` over every item of the document, wherever the view is | AC1 frames, AC1 wakeups |
| `deep-motion run` | `return_draws_stale_value` | the frame a pan arms draws each item that pan brings into view with its evaluated data from the last frame presented before the pan, instead of at `t` | AC2, AC3 |
| `deep-motion run` | `view_meets_by_center` | an item counts toward `valid_until` only when its center lies in the view, not when its bounds meet it | AC3 |

## Fixtures

Written by this job before any implementation ran, on a 2400 × 1400 board.

- `fixtures/spinner.json`: still rects `card` (box [40, 40, 400, 240]) and `note` ([100, 1000, 300, 100]), and
  `spinner`, a 100 × 100 rect centred on its origin at [1600, 800], whose channel `spin` turns `at.rot[2]` 0 → 360
  over 2 s, `extrapolate: cycle`: one looping rotation. Transport span 4 s.
- `fixtures/board.json`: the same plus `edge`, a 120 × 120 rect centred on its origin at [1000, 270], turning 0 →
  −360 over 3 s, cycling: its center lies 40 u right of the card view, its box reaches 20 u into it.

The views (`helpers.ts`): `V_CARD` [0, 0, 960, 540] (card and edge), `V_SPIN` [1200, 500, 960, 540] (the spinner
alone), `V_NOTE` [0, 860, 960, 540] (the note alone).

How the tests judge "the visible region": an item is inside a view when its box's inscribed circle meets it, and
outside when it is more than twice its circumscribed radius away, so any bounds an implementation keeps for a
turning box (the box, its rotated hull, the circle it sweeps) agree; the tests check at every vsync that no item
lies between, so no result depends on a choice the design leaves to the implementation.

## Criteria to tests

Each test's name starts with its criterion. Where the suite has a wrong program, a test runs it and asserts the
same check fails on it, naming what it should.

| ID | Criterion (the issue's text) | Tests, and the wrong program each fails on |
|---|---|---|
| AC1 | A document with one looping rotation panned out of view: 0 frames and 0 wakeups over 5 s. The merge base arms one per frame and fails | `frames.test.ts` (virtual clock): in `V_SPIN` all 60 vsyncs of the first second present; the pan to `V_CARD` at 1 s presents a frame valid for ever (`null`), and nothing is presented in (1 s, 6 s]. Opened on `V_CARD`, only vsync 0 presents in 5 s, valid for ever, while `eval` of the same document at 2.5 s still reports a `valid_until` within one vsync (canonical ignores the rule). `valid_until_ignores_view` presents all 300 vsyncs and the check fails, naming 300 frames. `wakeups.test.ts` (real clock): five 5 s runs on `V_CARD` each draw 0 frames (any Mac); on a reference Mac each makes 0 wakeups (PASS all five 0, FAIL all five above, else INCONCLUSIVE); `valid_until_ignores_view` draws ≥ 60 frames a run and the frames check fails naming run 1's count and first frame. Wrong programs: the base, the planted rule |
| AC2 | On return, the first frame equals a straight evaluation at t by hash | `return.test.ts`: `V_SPIN`, pan out at 1 s, back at 3.25 s: no frame in between; `eval` gives the spinner turned 225 at 3.25 s and 180 at 1 s (so a stale return differs); the pan back presents, and the SHA-256 of the frame's visible data (canonical JSON of the items inside `V_SPIN`) equals that of `eval` at 3.25 s. After the return every vsync presents and hashes to `eval` at its own t. `return_draws_stale_value` fails the hash check naming `item spinner`. Wrong programs: the base (it never stops, so nothing returns), the stale return |
| AC3 | The frame clock's kit case, armed evaluation against every vsync, stays byte-identical over the visible region | `kit.test.ts`: the board over its span plus 5 s (9 s, 541 vsyncs at 60 Hz), view `V_CARD`, pans to `V_SPIN` at 2 s, `V_CARD` at 4 s, `V_NOTE` at 6 s: the armed run presents nothing after the pan at 6 s; at every vsync the items inside the view are byte-identical (canonical JSON) to the every-vsync run's; it presents every vsync before 6 s (edge's box meets the card view, the spinner its own); edge and the spinner really turn. `view_meets_by_center` sleeps on the card view and fails at vsync 1 naming only `item edge`; `return_draws_stale_value` fails at the pan at 2 s naming `item spinner`. The run's new fields are read: malformed rects, a pan off a vsync, pans out of order and an unknown plant answer `bad_input`. Wrong programs: the base (it never sleeps, so its comparison proves nothing), both plants |

## Readings where the issue and design leave a choice

- **"Panned out of view"** is a view rect and pans, both session state carried by the request, the smallest form
  of the camera on a 2D view; a pan is input and so arms a frame (Frame clock: "input"). The first frame after the
  pan is presented; "0 frames over 5 s" counts the 5 s after it, as #854 counts frames after the window opened.
- **"0 wakeups over 5 s"** is `idle`'s `wakeups` (package-idle wakeups, #854's reading); interrupt wakeups from
  the Metal driver are not counted, as #854 found they come whatever the clock does.
- **"By hash"**: SHA-256 of the canonical JSON (sorted keys) of the frame's evaluated items inside the view, the
  same bytes the kit case compares, computed by the tests from `run`'s and `eval`'s answers, so no binary reports
  its own hash.
- **"Canonical renders ignore the rule"** is read on `eval` with no view, the straight evaluation; the issue gives
  it no criterion, so it is one assertion inside AC1's second test.
- **Not in scope**, as the issue says: pausing simulation. The fixtures hold no logic or physics item.
