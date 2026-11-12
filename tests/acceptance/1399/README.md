# Acceptance tests for #1399: checks that can't pass on nothing

Written first, from issue #1399 ("Checks that can't pass on nothing: a fixture declares how much a check must exercise,
each new field must reach a pixel, and removing a feature must change the frame by the right amount": its Scope, its
Fields, its six acceptance criteria and its Proof line, "Each planted case against the kit, with the counters from the
run"), the design sections it links, and base commit `3134672ec` ("Merge pull request #2265 …", whose first parent is
`568adc8f5`, "Merge pull request #2266 …"), by a job that never saw an implementation; none existed, and no other
worktree, branch or pull request was read. The implementing agent doesn't edit these files (AGENTS.md, Proof); a
dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per condition a criterion states, a
planted program's case inside the test of the criterion that names it, and a control beside a planted case where the
planted case alone would pass a program that refuses everything.

## What was read

- The issue, live with `gh issue view 1399`; its parent #99 and epic #310 for context; its dependencies #202 (pack
  kinds and the kind kit) and #404 (determinism and the frame budget), both closed, for what they left on the base.
- `AGENTS.md` (the four invariants, Proof) and `docs/technical-design.md`: Dogfooding ("Who drafts it", "Proven on the
  base"); Document check; the golden paragraph ("A golden comparison counts only when both images hold at least 32
  distinct colors and at least 5% of their pixels off the modal color, so two blank frames never match as a pass").
- `docs/canvas-primitives.md`: What holds a document to its rules; Check input; Pack: kind rules and the kind kit (the
  paragraph on `exercise`, `field.effect` and `feature.response {ablate, measure, band}`, and "It can never: Read a
  picture"); Determinism.
- At the base, only for how the surfaces are driven: `crates/deep-show` (`main.rs`: the calls and the scenario's
  `planted`; `seams.rs`: `seam_suite` for the network seam and `relay_client`; `packs.rs`: `install_pack`;
  `verdict.rs` and `film_audit.rs`: the flicker check's row; `hub.rs`: `Planted`); `crates/deep-canvas-seams`
  (`network.rs`: the suite and its relay counts); `crates/deep-canvas/src/document/pack_kinds.rs` (the kind kit, its
  parts and its refusal `{kind, part}`) and `packs.rs` (`admit`); `crates/deep-gpu-layer/src/golden.rs` (the dark-frame
  guard, `golden`, `decide`) and `main.rs` (`deep-gpu run --backend noop`); `crates/deep-relay` (the reader); the
  suites `202/`, `1961/`, `380/`, `407/`, `1897/` and `1899/` (README, helpers, conventions). Every expected value
  comes from the issue.

## What the base already does, and these tests don't credit

The network seam's suite plays a match through its test relay and reads PASS when it saw no fault; its relay reports
what it carried (`relay.messages`, `delayed`, `dropped`, `duplicated`, `reordered`). The kind kit (#202) runs its parts
`defaults`, `determinism`, `cost`, `rules` and `migration` at the pack check and refuses a pack whose kit fails, naming
the kind and the part (`actual: {kind, part, …}`). The flicker check (#407) reads every frame's relative luminance
from its own raster. The golden comparison (#380) is BLOCKED, reason `blank`, when 98% of either frame's pixels have
luma at most 0.06, and BLOCKED when the golden or snapshot is missing. A verdict already never passes a deliverable the
hub doesn't hold (INVALID), a claim with none (INCONCLUSIVE) or a core kind that doesn't run yet (BLOCKED `not_run`);
the conformance kit's `short_run` and the ledger's INCONCLUSIVE for a module with no kit run are fail-closed too.
None of that is credited. The base has no `exercise` on any fixture, no `field.effect` or `feature.response` part
(a kind's `feature.response` is refused as `unknown_field`), no counter of real evaluations on the flicker row and no
planted cache, no guard on distinct colors or the modal color, and the relay client's reader reads PASS on zero
failures when it never ran.

## Run them

They build `deep-show` and `deep-gpu`, so the folder runs alone: `scripts/lanes.mjs` needs `'tests/acceptance/1399/'`
in its `alone` list. This README is the instruction; the implementer makes that edit.

```sh
export PATH=/opt/homebrew/opt/rustup/bin:$PATH   # when cargo isn't on PATH
npm ci                                           # once, if node_modules is missing
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 node node_modules/vitest/vitest.mjs run --root tests/acceptance/1399 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1399/tsconfig.json
```

Each file first builds the binary it drives once, in the checkout (honoring `CARGO_TARGET_DIR`, with
`CARGO_INCREMENTAL=0` and `CARGO_PROFILE_DEV_DEBUG=0` unless set): `cargo build --locked --bin deep-show
--no-default-features --features full` or `cargo build --locked --bin deep-gpu`, copies it to a temporary folder and
fails each test if the build failed. Each test writes its packs, film, frames, golden store and evidence into its own
temporary folder and deletes it. Everything runs headless on the CPU: `deep-gpu` runs with `--backend noop`, and the
relay client's relay is a closed port on 127.0.0.1. Node built-ins and vitest only. A run with `--root
tests/acceptance/1399` leaves Vitest's cache in `tests/acceptance/1399/node_modules/.vite`; delete it. `BASE-FAILURE.txt` holds the one
run on the base and the line each test fails at.

## The surface under test

`deep-show run` and `deep-gpu run`, one scenario JSON line on stdin, one reply per call, as #140, #306, #202, #403,
#407, #309 and #380 left them. **Every name below that the issue doesn't give is this job's invention**, the smallest
surface consistent with the design and the base; the implementer builds exactly these, or a dispute goes to a blind
redraft.

### `exercise` on a seam fixture (#1399.6564d3ed)

- **The seam fixture** is the network seam's suite as `deep-show`'s `seam_suite` call plays it: `{"call":
  "seam_suite", "seam": "network", "messages": n, "seed": 1399}` on the correct test backend. Its samples are its
  messages.
- **New: `exercise: [{counter, min}]` on that call**, the issue's field. A counter names a count the suite's run
  reports in its reply's `relay` block; this suite declares `{"counter": "messages", "min": 64}`, the distinct messages
  the relay carried (`relay.messages`).
- **New: `exercise: [{counter, min, count}]` on the reply**, one row per declared counter, `count` read from the run.
  When any count is under its `min`, the reply's `status` is `INCONCLUSIVE`, never PASS, and that row names the counter;
  otherwise `status` is the suite's own result (PASS with no fault, FAIL with one), as at the base.

### The kind kit's `field.effect` and `feature.response` (#1399.cfce1159, #1399.6334af37)

- Both are parts of the kind kit (#202) that runs at the pack check (`install_pack`); a kind whose kit fails one is
  refused, as the base refuses any failing part. **"Fails `field.effect`" / "fails `feature.response`"** is read as:
  `install_pack`'s `outcome` is `refused`, with an issue of severity `error`, not `unknown_field` (the base's refusal of
  a field it doesn't know), that holds the part's name as data: a value of the issue, outside its prose (`what`,
  `fix`), equal to `"field.effect"` or `"feature.response"` (the base's refusal puts it at `actual.part`). **"Naming the
  field"**: such an error holds the field's name as data (`"gloss"`); **"naming the band"**: it holds the band as
  declared, `[2, 4]`.
- **`field.effect`** runs on every kind: a kind's fields are its recipe's inputs. Changing a field from its default
  (to any value of its range) must change the kind's evaluated frame, read as evaluated data (the kit "can never read a
  picture"); a field that leaves it unchanged is inert and fails the part.
- **New: `"feature.response": {ablate, measure, band}` on a pack kind**, beside its `rules` and `cost`, an object as
  the issue spells it. `ablate` names a step of the kind's recipe (the feature); **`measure: "items"`** is the count of
  items an instance expands into in the evaluated frame; `band: [min, max]` bounds the change, in the measure's own
  units and inclusive: `measure` with the step less `measure` without it, at the kind's defaults and at each example,
  must lie in the band, or the part fails.

### The per-frame check's counter (#1399.09928950)

- The per-frame check is the core's flicker check, `{"kind": "film.flicker"}`, as a requirement of a claim judged by
  `verdict` (#407).
- **New: `counters: [{doc, rendition, frames, analyzed}]` on its verdict row**, one per deliverable and rendition the
  check played (as made, and under reduced motion): `frames`, the frames it judged; `analyzed`, the frames whose
  luminance it computed from their own raster, its counter of real evaluations. When `analyzed` is under `frames` the
  row is FAIL, with an error that holds `"analyzed"` as data.
- **New planted value `flicker_analyzes_once`** (scenario field `planted`, reachable only there): the planted cache.
  For each rendition the flicker check rasters and analyzes the first frame once and serves that analysis to every
  frame of the span; its counter reads 1.

### The golden guard (#1399.34aa835f)

No new name. `deep-gpu run --backend noop`, your `decide {store, via: "you", decision: {bless: {fixture, png}}}`, then
`golden {store, fixture, png}`, and the reply's `verdict` and `reason` as at the base. "Luma 0.94" is the dark-frame
guard's own luma, (0.2126 R + 0.7152 G + 0.0722 B) ÷ 255 on 8-bit sRGB: a flat grey of 240 in each channel, 0.941, the
8-bit grey nearest 0.94.

### A check that never ran (#1399.33228c2f)

No new name. The check is the relay suite's reader as `deep-show`'s `relay_client` call (#309) runs it on what a test
client received, `reader: {status, failures}`. A client given a relay that isn't there never takes a seat, so its
reader never runs; "reads failing, not zero" is read as `reader.status` `FAIL`, where the base reads PASS on an empty
list of failures.

## Fixtures (written at test time)

| What | Where | What it holds |
|---|---|---|
| acme/shelf@1.0.0 | `field-effect.test.ts` | the kind `shelf.bookcase@1` backed by the bookcase recipe (#202's shape): inputs width (0.4–3 m, default 1.2), levels (1–8, default 4) and dividers (0–3, default 1); steps `sides` (2), `boards` (levels) and `dividers` (dividers), each a `rect@1` at 100 u a metre; one example, the kind at its defaults (7 items); no rule; cost figure {0.5, 0.2, 7} |
| acme/shelf@1.0.1 | `field-effect.test.ts` | planted: the same, its recipe also declaring the input `gloss` (number 0–1, default 0.5) that no step reads |
| acme/shelf@1.0.2 | `feature-response.test.ts` | planted: the same as 1.0.0 with `"feature.response": {"ablate": "dividers", "measure": "items", "band": [2, 4]}`; removing the divider moves 7 items to 6 |
| acme/shelf@1.0.3 | `feature-response.test.ts` | the control: `"feature.response": {"ablate": "boards", "measure": "items", "band": [1, 8]}`; removing the boards moves 7 items to 3 at its defaults, and by `levels` (1 to 8) at any level |
| the still film | `per-frame.test.ts` | a 640 × 360 u film at 25/1 frames a second, 1 s long, one grey `rect@1` (role `muted`), stored as your revision 0 and named by one claim of the working agent's with one requirement `{"kind": "film.flicker"}` |
| frames | `golden.test.ts` | 64 × 64 RGBA PNGs: flat grey 240; black; and 64 colors in 8 × 8 tiles (red and green 96–208 by tile, blue 200) |
| relay and authority | `fail-closed.test.ts` | `https://127.0.0.1:<port>` on a port a server held and closed; an empty authority file |

Pack IDs carry an outside owner (`acme/…`) as `PackId::parse` needs.

## Criteria to tests

Each criterion's ID is `#1399.<first 8 hex digits>` of the SHA-256 of its text, trimmed and white space collapsed
(`scripts/proof-change.mjs`, `criterionId`, on the live issue body). Each test's name starts with it; each file's head
quotes its criterion and says what each test asserts.

| ID | File | Tests | What they assert | Wrong programs it fails on |
|---|---|---|---|---|
| `#1399.6564d3ed` | `exercise.test.ts` | 2 | (1) 12 messages against `exercise` `messages` ≥ 64: `status` INCONCLUSIVE, the row `{counter: messages, min: 64, count: 12}`; (2) 64 messages: no fault, `status` PASS, the row `{…, count: 64}` | the base (PASS on 12; no counters) |
| `#1399.cfce1159` | `field-effect.test.ts` | 1 | acme/shelf@1.0.0 installs; the planted acme/shelf@1.0.1 is refused with an error naming `field.effect` and `gloss` | the planted kind; the base (it installs) |
| `#1399.09928950` | `per-frame.test.ts` | 1 | the still film's flicker row PASS with every counters row frames 25, analyzed 25; under the planted cache the row FAIL, an error naming `analyzed`, every counters row frames 25, analyzed 1 | `flicker_analyzes_once`; the base (no counters) |
| `#1399.34aa835f` | `golden.test.ts` | 1 | grey pair BLOCKED, reason blank; black pair BLOCKED, reason blank; the 64-color pair PASS | the base's guard alone (grey PASS); a guard that blocks every frame (tiles) |
| `#1399.6334af37` | `feature-response.test.ts` | 1 | the planted acme/shelf@1.0.2 is refused with an error (not `unknown_field`) naming `feature.response` and `[2, 4]`; the control acme/shelf@1.0.3 installs | the planted feature; the base (`unknown_field`); a band read as a share (the control) |
| `#1399.33228c2f` | `fail-closed.test.ts` | 1 | the client didn't exchange, and `reader.status` is FAIL | the base (PASS on zero failures) |

## Readings where the issue leaves a choice

- **"A seam fixture"** is the network seam's conformance suite, the one seam suite `deep-show` plays headless with a
  sample count of its own; its samples are messages. "Naming the counter" is the reply's `exercise` row for it, with
  its floor and the count the run read. "Reads its result" is the suite's own status, PASS on the correct backend.
- **"Never reaches a shader"**: a pack kind is backed by a recipe, so a field reaches what is drawn only through the
  recipe's steps; a recipe input no step reads is the field that validates and never reaches the frame.
- **"A fixture feature"** is a step of the kind's recipe, removed from the kind's example; the band is absolute, in the
  measure's units (the control fails a band read as a share of the measure).
- **"Its per-frame check"** is the flicker check, the core's check that reads every frame of a film; "25 frames" is each
  rendition of a 1 s film at 25 frames a second. "Naming the counter" is an error on the row holding `"analyzed"`.
- **"Two matching frames"**: the golden and the snapshot are the same PNG, blessed by your decision first, so the
  dark-frame guard and the oracle are all that decide; the 64-color pair is the control that the new guard lets a real
  frame be compared. The issue's "where the dark-frame guard on main alone passes them" is shown by the base run.
- **"Reads failing"**: the relay reader's status vocabulary is PASS or FAIL, so failing is FAIL; "not zero" is the
  base's PASS on an empty failure list.
- Not tested, as no criterion states it: the 32-color and 5% thresholds at their edges, a pair only one frame of which
  the guard catches, and "a stochastic check states its sample count, and its limit in standard errors".
