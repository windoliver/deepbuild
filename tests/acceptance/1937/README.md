# Acceptance tests for #1937: the over-class fix, the set of patches that changes the picture least, chosen by measurement

Written first, from issue #1937 (its scope, its Fields and "It can never" lines, its two acceptance criteria and its
proof line), its parent #455's amendment of Nov 8 (each knob a patch, its cost from the cost model or a timed
render-back, its change from comparing render-backs, the cheapest set measured together), its Oracle page
(`doneright/oracles/issues/1937.md`: no upstream test checks these criteria, so none is ported), the design sections
it links and those they lean on, and base commit `f38d2b39` ("Merge pull request #2155 …"), by a job that never saw
an implementation; none existed. The implementing agent doesn't edit these files (AGENTS.md, Proof); a dispute goes
to a blind redraft of this job (design: Dogfooding).

What was read:

- `docs/technical-design.md`: Document check (issues as data; the loop's checks each naming its fix), Dogfooding.
- `docs/canvas-primitives.md`: The cost model (coefficients from the reference Mac; the showpiece's 10 ms GPU);
  Patch (ops `set {id, path, value}` and `unset`; `cost_delta.gpu_ms`); Meter and degrade ladder (canonical renders
  never step); Render-back (snapshots at a time, headless, kept by hash); Check input and Check input: loop kinds
  (`camera.framing {keep: [ID] | kept, …}`, the extended kinds, "It can never"); Light and the light policy
  (`shadow`, `priority`, 1 sun + 2 shadowed spots); Light policy: local shadows; Level of detail; Look: samples.
- Issues #455 (the parent and its amendment), #403, #393 and #421 (the dependencies).
- At the base: AGENTS.md; `tests/acceptance/1899/` (README, helpers, `over-budget.test.ts`: the `frame_budget` call,
  its stub meter, stub environment and `--planted` names, which this suite extends), `421/` and `422/` (Metal gating,
  PNG and ID readers, lit 3D documents), `378/README.md` (`view3d`'s targets, `picks` and `patches`), `446/` (spot
  shadows and `light_policy`); `crates/deep-gpu-layer` (`main.rs`: the calls and `Planted::parse`; `budget.rs`:
  `frame_budget`, its stub meter and the reference Macs; `view3d.rs`: `patches` applied by `apply_ops`, the ID
  target), `crates/deep-canvas` (`budget.rs`, `cost.rs`'s `estimate`, `camera.rs`'s `fit.keep`,
  `document/apply.rs`'s `set`), `crates/deep-canvas-scene3d` (`light.rs`: `shadow`, `priority`; `lod.rs`;
  `samples.rs`).

What the base already does and these tests don't credit: #1899's `frame_budget` measures a document's warm-up and
five runs on a stub meter under a stubbed environment and judges them against its class; #378's `view3d` draws a
document with a writer's patches applied, with final and object-ID targets; scene3d draws sun and spot shadows under
the light policy; `deep_canvas::cost::estimate` sums a document's cost from coefficients. There is no over-class fix:
no candidate list, no candidate measured as applied, no subject share from render-backs, no set chosen and measured
together, no `estimate` mark, no choice ask; and the stub meter's reading doesn't depend on the document it measures.
So these tests define the surface below.

## Run them

They build `deep-gpu` with `test-meter`, as #1899's suite does, so they run with `--no-file-parallelism`, and
`scripts/lanes.mjs` needs this folder in its `alone` list beside `tests/acceptance/379/`. This README is the
instruction; the implementer makes that edit.

```sh
npm ci                          # once, if node_modules is missing
npx vitest run --root tests/acceptance/1937 --no-file-parallelism --testTimeout=600000
npx tsc -p tests/acceptance/1937/tsconfig.json   # type-check
```

Every file first builds `CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 cargo build --locked --bin deep-gpu --features
test-meter` once (cargo on `PATH`), copies the binary out of the target folder, and fails each test if the build
failed. The subject share is read from pixels, so every test runs `deep-gpu run` on Metal (`requireMetal`: off macOS
a test fails as INCONCLUSIVE, never passes). Timing comes from the stub meter and the stubbed reference Mac's
environment only, so no test reads this machine's model, power, thermal state, load or device timing. Each test
writes into its own temporary folder and deletes it. A run with `--root` leaves Vitest's cache in
`tests/acceptance/1937/node_modules/.vite`; delete it. `BASE-FAILURE.txt` says what each test gets at the base.

## The surface under test

The issue names a fix chosen by measurement, its reply and a planted chooser, but no code API. So these tests define
the smallest surface they need on a binary that exists: **one new call on `deep-gpu run`, `budget_fix`**, beside
#1899's `frame_budget` and taking its fields; **one new stub field, `stub_meter.terms`**, which both calls read; and
**one more `--planted` name**. No new binary. Every name below that the issue or design doesn't give is this job's
choice; the implementer builds exactly these, or a dispute goes to a blind redraft.

#377's JSON-lines protocol holds unchanged: one scenario `{"out": dir, "calls": [Call]}` per stdin line, answered
with one line `{"ok": true, "replies": [Reply]}`, then exit 0; a call missing a required field, or carrying one its
build doesn't hold, is answered `{"code": "bad_input", …}`; an unknown `--planted` name answers one
`{"ok": false, "code": "bad_input"}` line and exits 2. All tests start `deep-gpu run [--planted <name>]` (Metal).

### The `budget_fix` call

```json
{"call": "budget_fix", "look": look@1, "writer": "<kind>:<id>", "doc": path,
 "render": {"seconds": s, "pixels": [w, h]}, "fps"?: 60, "warmup"?: 60, "keep": [ID],
 "stub_meter"?: StubMeter, "stub_environment"?: Fingerprint}
```

`document.budget`'s fix for a document over its class, on the GPU layer's headless worker as `frame_budget` runs.
`look`, `writer`, `doc`, `render`, `fps`, `warmup`, `stub_meter` and `stub_environment` are `frame_budget`'s (#1899's
README); `stub_timer` and `report` are `frame_budget`'s alone and `bad_input` here. `keep` is `camera.framing`'s
`keep` as an ID list: the kept items, the subject.

1. **The document.** It is checked as the writer's revision (a refused one is answered `{"code": "refused",
   "issues": [Issue]}`) and measured as `frame_budget` measures it: `document`, a frame-budget Result without
   `frames`. `limit_ms` is its class's frame GPU limit. A document is over its class when the median of its five
   runs' GPU p95s exceeds `limit_ms`; one that isn't gets `candidates: []` and null `chosen`, `fix` and `ask`.
2. **The candidates**, from the closed list, one per entry that applies: `shadow_off` for each light whose `shadow`
   is true, its ops `[{"op": "set", "id": L, "path": "items/L/params/shadow", "value": false}]`; `priority_down` for
   each light, its `priority` one lower; `lod_nearer` for each instancer with `lod` bands, a band moved nearer;
   `draw_distance` for each small item; `effect_quality_down` for each effect, its quality one step down; and
   `samples_down`, the look's samples per frame one step down (`item` null). Each candidate's `ops` are the patch ops
   that make it; how the last five are written is the implementer's, since no test reads them.
3. **Each candidate's numbers.** `predicted_ms`: the cost model's frame GPU estimate of the document with the
   candidate's ops applied, less the document's own. `measured_ms`: the document with its ops applied, measured as
   `document` was, the median of its five GPU p95s less the document's. Both are negative when the patch saves time.
   `estimate`: true exactly when |`predicted_ms` − `measured_ms`| > 0.25 × |`measured_ms`|. `share`: in a render-back
   at the checked time (t = 0) at `render.pixels`, of the pixels the `keep` items cover in the document's object-ID
   target, the share whose OKLab (Euclidean, from the final 8-bit sRGB snapshot) differs by more than 0.02 between the
   document's render-back and the patched document's.
4. **The chosen set**: of the sets of candidates whose summed delta reaches the budget (the document's median p95
   plus the sum ≤ `limit_ms`), the one with the least share. Its ops are applied together and the document is
   measured again (`measured`, a frame-budget Result, and `measured_ms`, its median p95 less the document's) and
   rendered again (`share`), never a sum of the candidates' own numbers. A set that, measured together, misses the
   budget is not chosen; the next is tried. `of` lists its candidates by index, `ops` their ops. Null when no set
   reaches the budget.
5. **The fix or the ask.** `fix` is the chosen set's ops when its share is at most 0.05, else null. When its share is
   over 0.05 it is offered instead as a choice ask (technical design: Ask), never applied as the fix.

It answers:

```json
{"limit_ms": ms, "document": Result,
 "candidates": [{"knob": "shadow_off" | "priority_down" | "lod_nearer" | "draw_distance" | "effect_quality_down" | "samples_down",
                 "item": ID | null, "ops": [op], "predicted_ms": ms, "measured_ms": ms, "estimate": bool, "share": fraction}],
 "chosen": null | {"of": [index], "ops": [op], "measured_ms": ms, "share": fraction, "measured": Result},
 "fix": null | [op],
 "ask": null | {"kind": "choice", "question": string, "options": [{"ops": [op], "share": fraction, "measured_ms": ms}]}}
```

`Result` is `frame_budget`'s: `{"verdict", "limits": {"gpu": Limit, "cpu": Limit}, "fallback"}` (#1899's README).

### `stub_meter.terms` (`test-meter` only)

#1899's `stub_meter` gains one field, which `frame_budget` and `budget_fix` both read:

```json
"terms"?: [{"path": "items/<id>/<field>…", "equals": value, "gpu_ms": ms, "predicted_ms"?: ms}]
```

- While the document a run draws (as written, with whatever candidate's or set's ops the run applies) holds `equals`
  at `path`, a patch op's path, each frame's passes cover `gpu_ms` more than its `frames` entry gives. A path that
  resolves to nothing doesn't hold. So a patch is measured only as applied: one not applied saves nothing.
- The test build's cost model: with `terms`, its frame GPU estimate of a document is the stub's, the `gpu_ms` of the
  `frames` entry for frame 0 plus the `predicted_ms` (else `gpu_ms`) of each term that holds on it, standing in for
  the coefficients the reference Mac measured.

Everything the call does from these readings is the real program's (with `--planted`, the planted one's).

### Planted programs (`deep-gpu run --planted <name>`, each reachable only there)

| Name | The wrong program | Criterion |
|---|---|---|
| `picks_largest_gain` | The chooser picks the single candidate with the largest gain (the most negative `measured_ms`), whatever its share; the rest is the real program's | 078417c3 (issue-named) |

## Fixtures

Built by `helpers.ts`, at 320 × 240, as a writer's payload (`payload()`, for `budget_fix` and `frame_budget`) and as
a session document with one layer of `agent:alpha` (`sessionDoc()`, for `view3d`): a showpiece (`budget.class`),
`light_policy: {shadowed: {spots: 2}}`, a camera at (0, 3, 7) looking at (0, 0.9, 0), fov 40; a 20 m grey floor; the
**subject**, a pale 1.6 m box at the origin (`keep: ["subject"]`); a bar above the frame at (0, 3.8, 2.3); the **key**,
a 2 lx sun from 60° up in front with `shadow: true`, whose shadow of the bar falls in a band across the subject's front
face; and two 300 lm spots, **fill-a** and **fill-b**, left and right at (∓4, 3, 2) aimed at the subject, with
`shadow: true`, whose shadows fall on the floor, off the subject. The look is a physical look, tone map none at the
exposure whose scale is 1. Every light's `shadow` is written out, so the stub's terms read it.

The stub meter: every frame 3 ms, plus 6 ms while the key shadows and 2.5 ms while each fill does: **14 ms** against
the showpiece's 10. The key's shadows off is the single largest gain (−6 ms, to 8 ms); the fills' together reach 9 ms.

At the base, `view3d` draws the subject on 12,824 pixels; the key's shadows off move 32.1% of them by more than 0.02
in OKLab, both fills' shadows off 0.08% (their shadows move 5,476 floor pixels). The tests check the first again on
every run (20–40%), so the scene is the criterion's.

## Criteria to tests

IDs are the first 8 hex digits of SHA-256 of each criterion's text, trimmed, with whitespace collapsed and the
leading `- [ ] ` dropped, computed with #607's command with the issue's two criterion lines on stdin:

```sh
gh issue view 1937 --repo windoliver/deepbuild --json body -q .body | grep '^- \[ \]' | \
  node -e 'for (const t of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)) console.log(require("crypto").createHash("sha256").update(t.trim().replace(/\s+/g," ").replace(/^- \[ \] /,"")).digest("hex").slice(0,8))'
# 078417c3
# ef5ff5e8
```

Each test's name starts with its criterion's ID. Where a criterion names a wrong program, the test runs it through
`--planted` and asserts it fails the way the criterion says; where it names none, the test's twin shows the check can
fail.

| ID | Criterion (the issue's text) | Tests, what each asserts, and the wrong programs |
|---|---|---|
| `#1937.078417c3` | The over-class fixture (a showpiece scene at 14 ms against a 10 ms class) gets a fix whose patch, applied, measures under 10 ms, and whose subject share changes by under 2%. A planted chooser that picks the single largest gain, which turns off the key light's shadows and changes the subject by 30%, fails, naming the subject share. | `fix.test.ts`, under the reference Mac's environment. The check: `document` FAIL on its GPU limit with five runs at 14 ms and `limit_ms` 10; the candidates include `shadow_off` for key, fill-a and fill-b, each with exactly its op and `measured_ms` −6, −2.5, −2.5, and the key's `share` within 5 points of the share its patch moves when drawn here; the chosen set's share under 2% and a `fix` equal to its ops; the fix applied here to the payload and measured by `frame_budget` with the same stub: PASS, every run's p95 under 10 ms; drawn here by `view3d` with and without the fix: under 2% of the subject's pixels move more than 0.02 in OKLab; and a set over 5% is never the fix but a choice ask. The real program passes it. `picks_largest_gain` chooses the key's shadows off, is offered as a choice ask with no fix, and fails it with sentences naming the subject share. Wrong programs: the base; a chooser by gain; a share read from anything but the subject's pixels (the key's share is checked against the pixels); a fix reported but not applied (measured again, the scene reads 14 ms) |
| `#1937.ef5ff5e8` | Each candidate's predicted delta is within 25% of its measured delta on the reference Mac, else the reply marks it `estimate` and re-measures the chosen set before naming it as the fix. | `estimate.test.ts`, under the reference Mac's environment, the stub's cost model predicting the shadows at 6 (key, exact), 2 (fill-a, 20% off) and 3.5 ms (fill-b, 40% off): every candidate is marked `estimate` exactly when its prediction is more than 25% off its measured delta, and the marked ones are exactly fill-b's shadows off; the lights' `predicted_ms` are −6, −2, −3.5 and `measured_ms` −6, −2.5, −2.5; the chosen set holds both fills' shadows off and not the key's, its `measured` five runs at 9 ms, PASS, and its `measured_ms` −5, not the −5.5 its predictions sum to; and it is named the fix. Twin: every prediction exact, no candidate is marked, and the rest holds. Wrong programs: the base; a mark on every candidate (the twin) or on none (the first); a fix named from summed predictions with no run of the set together |

## Readings where the issue and design leave a choice

- **One call on an existing binary.** The fix is the frame-budget run's neighbour: it measures the document and
  each patched copy as `frame_budget` does, and renders them on the same GPU layer, so `budget_fix` is one more call
  on `deep-gpu run`, taking `frame_budget`'s fields.
- **Timing from a stub, pixels from Metal.** Timings must be the same on every Mac, so they come from the stub
  meter, whose reading follows the document actually drawn (`terms`): a candidate is measured only as applied, as
  the issue's "chosen by measurement" asks. The share must come from real pixels, so the call runs on Metal.
- **The prediction.** "Predicted cost delta" is the cost model's: the patch's `cost_delta.gpu_ms` (Patch), from
  coefficients the reference Mac measured. In the test build the stub's `predicted_ms` stand in for them, so a
  prediction can be set off its measurement on purpose.
- **Which delta the sum uses.** The issue scores candidates by their predicted delta and marks those whose prediction
  misses their measurement; it doesn't say which the set's sum adds. The fixtures choose the same set either way
  (the fills' together: −5 measured, −5.5 or −5 predicted, both within 10 ms; the key's: −6), and the set is
  measured again together whichever, so either reading passes.
- **"Re-measured together, never a sum of separate guesses."** The guesses are the predictions: AC2's chosen set
  measures 9 ms together where its predictions sum to 8.5. The stub's terms add, so a sum of the candidates'
  separate measurements equals the set's own here; no test tells those two apart.
- **"Before naming it as the fix".** Order isn't observable in one reply. The test reads it as: the reply carries
  the set's own run, and the fix is its ops only when that run is within the budget.
- **The subject** is `camera.framing`'s `keep` as an ID list, given in the call. The `kept` form (the camera's own
  `fit.keep`) moves the camera to frame the subject, and no criterion needs it.
- **The checked time** is t = 0: the scene is still, and no criterion names a time.
- **The share.** "The share of pixels of the subject whose OKLab differs by more than 0.02": subject pixels are those
  the kept items cover in the document's own object-ID target; OKLab is Ottosson's, from the display-referred 8-bit
  sRGB frame; the difference is Euclidean. "Changes by under 2%" is a share under 0.02.
- **Drawn here.** The test reads the share itself from `view3d`'s live frame, which may differ from a canonical
  render-back's at edges, so it holds the reply's key share to its own within 5 points and the fix under 2% in both.
- **"Changes the subject by 30%"** is the fixture's: 32.1% at the base, checked at 20–40% each run.
- **"Measures under 10 ms"** is the fix applied to the payload and run by `frame_budget` with the same stub: PASS,
  and every run's p95 under 10 ms. The fix's ops are value changes (`set`, `unset`), as every candidate in the closed
  list is a value change; the test applies only those, and any other op in a fix fails it, naming the op.
- **"The single largest gain"** is the most negative `measured_ms`: the key's shadows, −6 ms, which alone reaches
  the budget. "Fails, naming the subject share" is the check's failure sentences. The planted set, at about 30%, is
  over 5%, so the real program after the planted chooser offers it as a choice ask with no fix; the test also asserts
  that, the one place a fixture reaches the scope's 5% rule.
- **"Within 25%"**: |predicted − measured| ≤ 0.25 × |measured| is unmarked; a candidate that saves nothing in either
  is unmarked.
- **"On the reference Mac"** is the stubbed reference Mac's environment, as #1899's tests stand it in.
- **Run length.** Each measurement is 5 s, 300 frames, the design's floor for a frame-time p95, after `frame_budget`'s
  default 60 warm-up frames.

Not tested, because no criterion asks or the fixture can't reach it: the five other knobs' ops and numbers (the scene
has no instancer or effect, and under the stub they save nothing); the real cost model's coefficients; a document
within its class; no set reaching the budget; a set over 2% and under 5%; the choice ask's question and wording; the
`kept` form; the render checks' over-class planted fault that uses this fix (theirs to build); the extended kinds in
Fields (`document.validate`'s `assets`, `document.budget`'s `lod`), which no criterion names; the "It can never" lines;
the shipped build's refusal of `terms`; any machine but the stubbed reference Mac.

## Upstream tests (the Oracle lane)

The Oracle page says no upstream test checks these criteria (the over-class fix, its shares and its estimate marks
are this project's rules); these tests are their local proof.
