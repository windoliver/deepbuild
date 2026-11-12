# Acceptance tests for #1183: Drawn larger than real

Issue #1183: "Drawn larger than real: the scale a part is drawn at, exaggeration declared on a driver with a disclosure
bound to it, and a check that refuses an undeclared one". Written first, blind, from the issue (its scope, its Fields
block, its six acceptance criteria and its proof line), the design sections it links and those they lean on, and the
base commit `145315636` ("Merge pull request #2297 …"), by a job that never saw an implementation; none exists at the
base, and no other branch, worktree, pull request or stash was read. The implementing agent doesn't edit these files
(AGENTS.md, Proof); a dispute goes to a blind redraft of this job (design: Dogfooding). Lean: one test per criterion,
plus the planted program criterion 6 names; criteria 1, 3 and 4's planted documents sit inside their tests.

## What was read

- Issue #1183 as the job's brief quoted it (body only). Test names start `AC<n> #1183.<id>`, the first 8 hex digits of
  SHA-256 of the checkbox text after `- [ ] `, trimmed, white space collapsed (`scripts/proof-change.mjs`,
  `criterionId`).
- `docs/canvas-primitives.md` at the base: Honest numbers (the check, 9081: "Lengths follow the same rule. An assembly
  records the scale it is drawn at, `shown_at` (drawn ÷ real), and a driver or channel that maps a measured length at
  any other ratio declares `exaggerate` with its factor and the overlay that discloses it; that overlay shows whenever
  the item it covers is on screen, and its factor is bound, never typed. A length mapped at a ratio the document
  doesn't declare fails, naming the item and the ratio.") and the Honest numbers convention (77); Units and axes (29:
  3D in metres); The path grammar (39) and Path and handle (414); Overlay (4582: `template: string over bound values
  and drivers`, `show: expression`, `anchor`, "It can never: … show a number that isn't bound or computed"); The
  closed function list (6052); Driver (5430: `target`, `expr`, `vars`); Channel and key (5344: `type: … bool …`, hold
  keys); Assembly (2891); Bound value (2173: `format.unit`); Logic `logic@1` (6534: `writes`, read as `<logic
  ID>.<name>`).
- `docs/technical-design.md` at the base: Dogfooding and the lines around it (2634-2658: criteria to tests, criteria in
  a checked shape, wrong programs, the edit guard); the five verdicts.
- At the base, only to learn what a fixture can hold and how a surface is driven: `crates/deep-show/src/main.rs` (the
  scenario, `claims`, the `planted` match, `eval`'s `paths`), `verdict.rs` (the `verdict` call; the
  honest-numbers row with its `issues` and `numbers`), `shared.rs` (documents stored at revision 0), `frames.rs` and
  `query.rs` (`eval`'s values), `logic.rs`, `film_audit.rs` (readable text); `crates/deep-canvas/src/document/rules.rs`
  (the base's number rules); `crates/deep-canvas-marks/src/check.rs` (`numbers`); `crates/deep-canvas-motion/src/doc.rs`
  (a driver's vars, a logic array as `<id>.<name>`) and `assembly.rs`; `crates/deep-logic/src/piece.rs` (a logic item's
  `writes`); `crates/deep-canvas-scene3d/src/scene.rs` (overlay.text@1 drawn as a readout). Suites read for their
  harness and form: `tests/acceptance/407/`, `1401/`, `504/`, `535/`, `1918/` and `499/clock/`. Every expected value
  comes from the issue and the design.

## What the base has

`deep-show run` with #403's claims, requirements and `verdict`; honest numbers as a requirement (`{kind:
honest_numbers}`), whose row lists `issues` and `numbers` (every number a deliverable shows, with what it traces to)
and raises `number_unsourced` for a text@1 that types a number; assemblies (#504); logic items run from a program in
the evidence store, which accept these fixtures' programs and ignore a write's `unit`; `eval` with `paths`. Observed
there with these fixtures (scratch runs, since removed): an assembly's `shown_at` is `unknown_field`, an error on every
figure's row; `overlay.text@1` isn't a kind `deep-show` registers, so each figure holding the disclosure is BLOCKED
`unknown_kind`; `eval`'s `arrays` reads the scheduler's arrays, so a logic write reads null there; and a driver's var on a logic array parses (`<logic ID>.<name>`) and the document check passes it, but
`deep_show` refuses the figure with `ref_unresolved` ("motion's drivers read no canvas module's array"). With
`shown_at`, the overlay and the drivers taken out, the electron figure is presented and evaluated with no issue, so the
programs, the logic items and the rest of each figure hold at the base. So the issue's own fixtures need three things the
base lacks besides the check: `shown_at`, a disclosure overlay kind, and a driver that reads a logic output (Logic: "Drivers
and readouts read them by path"). There is no `exaggerate`, no length check, no `lengths` record, no disclosure rule
and no planted `length_ratio_one_value`. See `BASE-FAILURE.txt` for what each test meets there.

## Run them

They build `deep-show` with cargo, so they run one file at a time. The implementer adds this to `scripts/lanes.mjs` (this
README is the instruction; this job edits nothing outside its folder):

```js
// #1183's files each build deep-show and judge 3D figures whose logic runs in the sandbox.
alone.push('tests/acceptance/1183/');
```

```sh
npm ci                                   # once, if node_modules is missing
export PATH=/opt/homebrew/opt/rustup/bin:$PATH
CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 scripts/lease node node_modules/vitest/vitest.mjs run --root tests/acceptance/1183 --no-file-parallelism --testTimeout=600000
node node_modules/typescript/bin/tsc -p tests/acceptance/1183/tsconfig.json          # type-check (exits 0)
rm -rf tests/acceptance/1183/node_modules/.vite
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full`, copies the binary out
of `target/` (honouring `CARGO_TARGET_DIR`) and fails each test whose build failed. Every test writes into temporary
folders (its evidence store) and deletes them. Node built-ins and vitest only. Nothing needs a GPU, a window or a macOS
API: the check reads the document and evaluated data, as the issue says.

## Criteria to tests

| ID | File (tests) | What it asserts |
|---|---|---|
| AC1 `#1183.53c5a71a` | `ac1-exaggerated.test.ts` (1) | The electron figure's row PASSes, its record holding drivers/swing on `dot` as `pass` at ratio 200,000; its program writes 8.8146e-9 m at steps 59 to 61 (run on Node's WebAssembly), alpha's `deep_show` of it is presented and `eval` at frame 60 reads the dot's x 1.76292e-3 m, 1e-6 relative; the same driver without `exaggerate` FAILs with length.ratio_undeclared naming `dot`, ratio 200,000, expected 1, recorded `refused` |
| AC2 `#1183.c8624e05` | `ac2-shown-at.test.ts` (1) | At `shown_at: 0.25`, `0.25 * d` (0.4 m drawn as 0.1 m) PASSes, recorded `pass` at 0.25; `d` (drawn as 0.4 m) FAILs with length.ratio_undeclared naming `plug`, ratio 1, expected 0.25, recorded `refused` at 1 |
| AC3 `#1183.2a50d207` | `ac3-disclosure-run.test.ts` (1) | Over a 360-frame run where the dot is off the frame on frames 180 to 239 and its disclosure hides on 195 to 224, the row PASSes; the planted disclosure also hidden on frames 90 to 99, with the dot on screen, FAILs with length.disclosure_hidden naming `disclosure` at frame 90 (`t` 1.5 s ± half a frame, or `frame: 90`) |
| AC4 `#1183.162053d0` | `ac4-bound-factor.test.ts` (1) | The disclosure whose template is "drawn {factor}× larger than real" PASSes and the row's `numbers` hold 200,000 shown by `disclosure`, traced to the driver `swing`; the planted template typed "drawn 200,000× larger than real" FAILs with an error naming `disclosure` |
| AC5 `#1183.b941c395` | `ac5-unchecked.test.ts` (1) | A driver over a logic output whose write declares no unit: the row is INCONCLUSIVE, its record holds drivers/sweep on `needle` as `unchecked`, and the claim isn't PASS |
| AC6 `#1183.285af30a` | `ac6-two-values.test.ts` (2) | At `shown_at: 0.25`, `0.25 * d + 0.05` PASSes, recorded `pass` at 0.25; two `deep-show run` processes judging all six figures write the same bytes, every row holding a non-empty record; planted `length_ratio_one_value` fails the pass check, naming `plug` |

## The surface under test

**No new binary and no new call.** #393's `deep-show run` (one scenario line in, one answer line out) with #403's
scenario `claims`, `requirements` and `verdict`, and #1918's `eval` with `paths`. Each figure is a
scenario document stored on the panel (`docs[<id>].document`, revision 0, one layer of yours) and the one deliverable
of a claim of alpha's whose one requirement is `{kind: "honest_numbers"}`, every field at its default. AC1 also shows
the figure through alpha's `deep_show` (stripped of its layers) and evaluates it. What the issue names and the base
lacks is added as below. Every name marked *(chosen)* is this job's: the issue and design leave it open, and an
implementation builds exactly it or disputes it through a blind redraft.

### Document fields

- **Assembly `shown_at: f64 = 1`** (the issue's): drawn ÷ real. Each fixture sets it explicitly (1 or 0.25).
- **Driver `exaggerate: {factor: f64, disclose: overlay ID}`** (the issue's). The electron figure's driver `swing`
  carries `{factor: 200000, disclose: "disclosure"}`.
- **A logic write's unit, `writes: {<name>: {type: "f64", unit: "m"}}`** *(chosen: the key `unit` on the write, a
  length unit's symbol as Units and axes writes literals)*. The issue's "a logic output in metres" needs the output to
  carry its unit, and the design's `writes` entry has no field for it. A write with no `unit` is a value with no unit.
- **The disclosure** is an `overlay.text@1` item `{anchor: "corner", role: "caption", template, show: true}`. Its
  template's slot `{factor}` reads the factor of the mapping whose `disclose` names the overlay *(chosen: what the
  slot `factor` resolves to; the issue gives the template's words)*.
- **`show` false for some frames** is a bool channel on `items/<overlay>/params/show` with hold keys at frame times
  (`"90f"`, `"100f"`) *(chosen: `show` keyed by a channel; the design types `show` as an expression and names no
  variables it reads)*.

### The check record *(chosen: the key and the entries' shape)*

The honest-numbers row gains `lengths`: one entry per mapping, a driver or channel that writes an item's position,
length or scale from a value read from elsewhere (here, a logic output). The tests read four fields of an entry and
nothing else:

- `mapping`: the mapping's path in the document, `drivers/<id>` (the bare ID is also accepted);
- `item`: the item it writes;
- `result`: `pass` (its ratio is declared), `refused` (its ratio matches neither `shown_at` nor `shown_at` × the
  factor) or `unchecked` (its value has no unit);
- `ratio`: drawn ÷ real, as the check read it from the closed form at two values (read for `pass` and `refused`).

The row is FAIL when a mapping is refused, INCONCLUSIVE when a mapping is unchecked and nothing fails, and PASS
otherwise (#403's ranking).

### Codes *(chosen, except where noted)*

| Code | Raised on | Fields read |
|---|---|---|
| `length.ratio_undeclared` | a refused mapping | the item (in `ids` or a field); `ratio`: the ratio read; `expected`: the declared ratio, a number or a list holding it (`shown_at`, and with a factor `shown_at` × factor) |
| `length.disclosure_hidden` | a disclosure not readable on a frame where its item is on screen | the overlay (in `ids` or a field); `t`: the first such frame, flicks or `"<n>s"` (or `frame`, its index) |
| any error (AC4) | a disclosure that types its factor | the overlay; the code isn't read (the base's own code for a typed number is `number_unsourced`) |

Each is an error on the honest-numbers row; a field sits on the issue itself or in its `actual` (the tests read the
issue first). Whether a refusal is also raised when the revision is shown (the document check) isn't read: a figure
stored at revision 0 keeps its issues, and the honest-numbers row counts every issue of the revision.

### The planted program (the scenario's `planted`, reachable only there) *(chosen name)*

| Name | The wrong program | Criterion |
|---|---|---|
| `length_ratio_one_value` | the length check reads each mapping's ratio at one value v of its output, as drawn(v) ÷ v | AC6 |

Added to `Planted` in `crates/deep-show/src/hub.rs` and named in `src/main.rs`'s planted match (or a canvas module's
`PLANTED` list); at the base it makes the scenario `bad_input`.

## Fixtures

All built at test time by `helpers.ts`, truth by construction; nothing is committed but code. Figures are 3D, in metres,
+Y up, 960 × 540 px at 60 frames a second, with a perspective `camera@1` (orbit, 40°, near 1 mm, far 10 m), every
item in one layer of yours; `requires` names scene3d, motion and logic. No title, name or description holds a digit.

- **Programs.** Each logic program is WebAssembly bytes written in `helpers.ts` (no assembler): it exports `memory`
  (one page, maximum equal to minimum), `init(seed: i64)`, `step(k: i64)` and the immutable globals `reads_at` (0)
  and `writes_at` (1024), imports nothing, and stores its one f64 write at `writes_at` on every step. Each is put into
  the evidence store by its SHA-256, which the logic item's `program` and the document's `assets` name.
- **The electron figure** (AC1, AC3, AC4; 6 s). Assembly `flex` (`shown_at: 1`): `wire`, a box 6 mm long on the x
  axis, and `dot`, a 0.3 mm box at the origin. Logic `electron` writes `drift` (f64, `unit: m`): 8.8146e-9 at every
  step except 180 to 239, where it is 1e-3. Driver `swing`: `items/dot/at/pos/0` = `200000 * d`, `d: electron.drift`,
  with `exaggerate {factor: 200000, disclose: disclosure}`. The camera orbits (1 mm, 0, 0) at 12 mm, so the dot, drawn
  1.76 mm along the wire, is near the frame's centre, and drawn 200 m along it (frames 180 to 239) it is far off the
  frame. Overlay `disclosure` with the template "drawn {factor}× larger than real", its `show` keyed by channel
  `blink`: false over frames 195 to 224 only. Twins: `undeclared` (no `exaggerate`, no overlay, no `blink`);
  `hidden` (`blink` false over frames 90 to 99 too); `typed` (template "drawn 200,000× larger than real").
- **The socket pop-up** (AC2, AC6; 2 s). Assembly `popup` (`shown_at: 0.25`): `socket` and `plug`. Logic `reach`
  writes `depth` (f64, `unit: m`) = 0.4. Driver `push`: `items/plug/at/pos/2` = `0.25 * d`, `d`, or `0.25 * d + 0.05`.
- **The gauge** (AC5; 2 s). Assembly `gauge` (`shown_at: 1`): `dial` and `needle`. Logic `meter` writes `reading` (f64,
  no unit) = 0.5. Driver `sweep`: `items/needle/at/pos/0` = `0.01 * r`.

Each mapping's ratio, worked out: `200000 * d` 200,000 (declared: 1 × 200,000; undeclared without the factor: 1);
`0.25 * d` 0.25 (declared: `shown_at`); `d` 1 (undeclared at 0.25); `0.25 * d + 0.05` 0.25 at two values (declared),
0.375 at d = 0.4 alone; `0.01 * r` none (no unit).

## Readings where the issue leaves a choice

- **"Its drawn offset is 1.7629 mm … within 1e-6 relative".** 1.7629 mm is 200,000 × 8.8146e-9 m = 1.76292e-3 m rounded
  to five figures, and is itself 1.1e-5 relative from the product, so no value meets 1e-6 of the rounded number; the
  test asserts the exact product, 1.76292e-3 m, within 1e-6 relative. The drawn offset is the dot's evaluated x in
  its assembly (`items/dot/at/pos`, its rest at the assembly's origin, which sits at the world's), read by `eval` at
  frame 60. "When the output reads 8.8146e-9 m" is the fixture's truth: the test runs the program's bytes on Node's own
  WebAssembly and checks it writes 8.8146e-9 at steps 59, 60 and 61, so a frame either way in when a frame reads a step
  can't change it. `eval`'s `arrays` reads the scheduler's arrays, not a logic item's, so the binary's own reading of
  the output isn't asked for.
- **"Refused"** is an error on the honest-numbers row naming the item; **"both ratios"** are the issue's `ratio` and
  `expected` fields. AC1's twin names 200,000 and 1, AC2's 1 and 0.25.
- **"The check record"** is the honest-numbers row's `lengths`; the Proof's "refused and passing mappings" are its
  `refused` and `pass` entries.
- **"A recorded run"** is the figure played over its transport span, frame by frame at its own rate, its logic stepped
  on its input track (empty here), so every run replays the same frames. **"The dot leaves the frame and comes back"**
  by its own exaggerated motion: no other driver or channel moves anything, so the only mapping in the record is
  `swing`. **"On screen"** is the dot's evaluated pose projected through the camera inside the frame; the fixture's dot
  is either well inside the safe area or hundreds of metres out, so no reading of the frame's edge decides a frame.
- **"The first frame"** is frame 90 at 1.5 s, the first frame with the dot on screen and the disclosure not shown.
  The parity run hides it only inside the dot's time off the frame, 15 frames clear of each end, so a frame either way
  in when the logic's array changes can't decide it.
- **"Shows 200,000 from the document"**: the honest-numbers row's `numbers` (the base's list of every number shown with
  what it traces to) holds the number the overlay shows, 200,000, traced to the driver `swing` (a string in its
  `source` is `swing` or starts `drivers/swing`, such as the path `drivers/swing/exaggerate/factor`). "200,000" is read
  as the value: its text may carry group marks (`,`, a space, U+00A0 or U+202F) or none.
- **"Typed as 200,000×"** is the template with the factor typed in its words, no slot; "fails honest numbers, naming
  the item" is an error naming `disclosure` on the honest-numbers row, any code.
- **"The check's verdict for it is INCONCLUSIVE"** is the row's result, the gauge holding no other mapping; "never PASS"
  is also read on the claim's verdict.
- **"These fixtures"** is every figure the record covers in this suite (the electron figure and its undeclared twin,
  the socket at a quarter, at real size and with the offset, and the gauge), so the bytes compared hold passing,
  refused and unchecked entries. **"The same bytes"** is the two processes' whole stdout, which holds only the six
  verdicts, from the same scenario and the same evidence folder.
- **A planted check that "refuses that driver and fails, naming the item"** fails AC6's pass check with a failure
  that names `plug`; the check's own words (`WHAT`) don't hold the ID, so only the binary's output can name it.

## Not tested

Because no criterion asks: a channel as a mapping; a mapping that writes a length or a scale rather than a position;
an `exaggerate` whose factor is ≤ 0 or 1; a disclosure that shows `shown_at` as a number; a figure whose `shown_at`
is unset (the default 1); a ratio within 1e-6 relative but not equal; nested assemblies; bound values from readings,
probes or runs (only logic outputs); exaggerated time, angles and masses (out of scope); whether an exaggeration is a
good teaching choice (a taste call).
