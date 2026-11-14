# Acceptance tests for #1938, blind redraft: text under 4.5:1 (render.contrast) and its clean twin, with the oracle port

These tests were written before any implementation existed, by a job that saw only issue #1938, the design it links,
its Oracle page and base commit `23baa43b4` ("Merge pull request #2453 …"). They cover one of the nine planted faults of
criterion 1, `#1938.f19b61dd`: **text under 4.5:1**, which `render.contrast` holds, with its clean twin; and the oracle
port the issue's Oracle line links to that criterion. The other eight faults, and criterion 2, are not here.

The implementing agent doesn't edit these files (AGENTS.md, Proof). A dispute goes to a blind redraft of this job
(design: Dogfooding).

**Not run against a binary.** The machine's one-minute load was 78 to 136 on 18 cores, so `deep-show` was not built
and the suite wasn't run at the base. `BASE-FAILURE.txt` says why each test fails there, read from the base's code,
and what running the files without cargo showed. The type-check passes.

## What was read

- Issue #1938: its scope, its Fields block (`render.contrast {text: wcag | apca = wcag, min: 4.5, subject_ratio: f32 =
  1.5}`, "It can never: Pass on a model's judgment or a picture; compare GPU pixels across machines; …; fix the
  document itself"), its two criteria, its proof line ("with the issues as data") and its Oracle line.
- Its Oracle page, `doneright/oracles/issues/1938.md` on branch `doneright` of `DeepBuildAI/deepbuild`, and the three
  upstream test files it pins for criterion 1, read from the page's vendor copy.
- `docs/canvas-primitives.md`: What holds a document to its rules (8386: issues as data, `{check, code, severity, ids,
  path, actual, t, what, fix}`; "`actual` is the value refused at `path`"; "A `fix` is patch ops only where the
  module's conformance kit applied it on a fixture that raises the code and the second check returned that fixture's
  other codes and nothing else"), Check input (8390), Check input: loop kinds (8539: "Each code kind returns numbers,
  the pixels or item IDs that fail, and a fix as patch ops"; "exposure, contrast, noise and effect timing read pixels
  on one machine and are INCONCLUSIVE elsewhere"), Render-back (957: "2D snapshots render with" the CPU renderer),
  Patch (455), Text `text@1` (1410) and its halo (1444: "bring text under render.contrast's minimum (checked)"), Paint
  (1685: fills name look roles, never a literal color), Look `look@1` (2454) and its captions (2794), Document
  envelope (294: `look: {asset, theme: auto | light | dark = auto}`), and the determinism section (9513: render.contrast
  among the `machines: same` pixel checks).
- `docs/technical-design.md`: Document check (1566: "the loop's checks: … exposure, contrast, noise …, each naming its
  fix").
- At the base: `AGENTS.md`; `crates/deep-show/src/verdict.rs` (`verdict_call`, `judge`, `run_check`, `raised_json`),
  `shared.rs` (`open_shared`), `hub.rs` (`look_def_of`), `main.rs` (the scenario's `planted` and `module_planted`),
  `terminal.rs` ("the theme the hub draws (light)"); `crates/deep-canvas/src/registry/mod.rs` (`Raised`, `Report`,
  `Check`, `KNOWN_MODULES` with `loop` in `full`, `module_of_check`); `crates/deep-canvas/src/document/` (`check.rs`,
  `mod.rs`: `Issue::to_json` writes `fix` and a separate `fix_ops`); `crates/deep-canvas-loop/src/lib.rs` (the loop
  module: `geometry.shading` only, its `PLANTED`); `crates/deep-canvas-marks/src/check.rs` (`halo_contrast`,
  `CONTRAST_MIN`) and `looks/clean.json` (the shipped clean look); `scripts/proof-change.mjs` (`criterionId`, `spans`)
  and `scripts/lanes.mjs`.
- Suites, for their conventions only: `tests/acceptance/1936/` (stored documents, claims, `verdict`, a fix sent back as
  a patch, a planted program; `helpers.ts` is adapted from it), `453/` (the loop module through `deep-show run`),
  `464/` and `427/` (requirements naming `render.contrast`), `1653/` (`text@1` with a `paint.fill.role`) and
  `2014-oracle/` (an oracle port's shape).

Code was read only to learn the surface. Every expected value comes from the issue, the design, the upstream tests'
formula and the shipped clean look's colors.

## What the base already does

- No canvas module registers `render.contrast`, so a requirement naming it is BLOCKED with `module_missing` (with no
  `module`: `render` is no module's family), before anything is drawn or validated. The loop module registers only
  `geometry.shading`.
- The marks module refuses, at check, a text whose halos leave its fill under 4.5:1 (`halo_contrast`, #1653). That
  reads the look's roles, not pixels, and isn't `render.contrast`.
- A requirement naming `render.contrast` with a `snapshot` that is display-only is refused with `display_only` (#464).
  These tests name no snapshot.
- A stored document opens as revision 0 from the scenario's `docs[…].document`, a verdict judges it, and alpha's
  `deep_show` with `patch` applies ops to it (#96, #403, #1936). A module check's issue carries a text `fix` and, where
  its ops exist, a separate `fix_ops` list.
- The hub draws the light theme, and a document that names no look is drawn in the shipped clean look.

## Run them

Every file builds `deep-show` with cargo, so they run one file at a time. The implementer adds this line to
`scripts/lanes.mjs`; this job edits nothing outside the folder.

```js
// #1938's blind redraft of the text-under-4.5:1 test builds deep-show.
alone.push('tests/acceptance/1938-redraft-contrast/');
```

```sh
npm ci                          # once, if node_modules is missing
NO_COLOR=1 CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 npx vitest run --root tests/acceptance/1938-redraft-contrast --no-file-parallelism
npx tsc -p tests/acceptance/1938-redraft-contrast/tsconfig.json   # type-check
rm -rf tests/acceptance/1938-redraft-contrast/node_modules/.vite
```

Each file first runs `cargo build --locked --bin deep-show --no-default-features --features full` once (honoring
`CARGO_TARGET_DIR`; `CARGO_INCREMENTAL` and `CARGO_PROFILE_DEV_DEBUG` default to `0`), copies the binary out of
`target/`, and fails each test whose build failed. Every test passes a 60-minute timeout and writes only into
temporary folders, which it deletes. A test that can't decide fails with a message starting `INCONCLUSIVE:`: cargo
can't run, or a row comes back INCONCLUSIVE on the machine that drew it. It never passes.

## The surface under test

**No new call and no new reply field beyond the design's issue.** The tests drive `deep-show run` (one scenario line
in, one answer line out) with stored documents, #403's `claims` and `verdict`, and #96's patch through `deep_show`.
Names the issue and design give are kept exactly; every other name is this job's, listed under Readings.

### Calls

- `{"call": "verdict", "claim"}` on a claim `{session: "sess-alpha", deliverables: [doc], requirements: [{id, check:
  {"kind": "render.contrast"}}]}`. The check input carries `kind` alone, every field at its default (`text: wcag`,
  `min: 4.5`), as the canvas kit's fixtures carry it.
- `{"call": "deep_show", "session": "sess-alpha", "doc", "patch": {"patch": ULID, "doc", "base": 0, "reason", "ops"}}`,
  with `ops` exactly the failure's fix.
- The scenario's `planted`, for the one planted program below.

### What the tests read

- **The answer:** `ok` true, and one reply per call.
- **The verdict's row** of the requirement (`requirements[]` by `id`): `result`, and `issues`. The row counts every
  issue of the revision, its validation's included, so a clean twin raises nothing at all.
- **Each issue** on the row: `code` (any non-empty string: the design names no code for the loop kinds), `check`
  (`render.contrast`), `severity`, `ids` (a sub-address `<id>#<part>` reads as `<id>`), and:
  - **the ratio** (oracle file): `actual` when it is a number, else `actual.ratio`, else the issue's own `ratio`;
  - **the fix's ops:** `fix_ops` when it is a list, else `fix` when it is a list, else `fix.ops`. Patch ops are a
    non-empty list of objects, each with a string `op` (Patch: `create`, `set`, `unset`, `delete`, …). A sentence
    alone is not patch ops.
- **The patch's reply:** `outcome` is `applied`.

## Fixtures

Every board is built by `helpers.ts`, stored as the hub stores a document: `profile: board`, 640 × 360 u, one layer
`alpha-main` whose writer is the working agent alpha (`agent:thread-alpha`), every item in that layer, no `look`, no
`requires`. Each line of text is a `text@1` in the look's body face at 20 u, regular weight, in a 400 × 28 u box,
its fill a look role (`paint.fill.role`). Each board is the one deliverable of its own claim.

The colors are the shipped clean look's light theme at the base, and each ratio is WCAG 2's, worked out by the oracle
file's formula:

| Role | sRGB | On the ground (#ffffff) |
|---|---|---|
| `ink` | #1b1d22 | 16.86:1 |
| `session_readout` | #b0207f | 6.25:1 |
| `term_bright_magenta` | #d610d8 | 4.26:1 |
| `muted` | #8b8f97 | 3.24:1 |
| `accent` | #1aa3c8 | 2.95:1 |
| `ground` | #ffffff | 1:1 |

**The planted fault and its twin** (`captionBoard`): `title`, "Weekly checks" in `ink` at (40, 40), and `caption`,
"Updated every hour" at (40, 120).

| Board | `caption`'s role | Its ratio | Expected |
|---|---|---|---|
| The fault | `muted` | 3.24:1, under 4.5 and over 3 | FAIL, naming `caption` only |
| Its clean twin | `ink` | 16.86:1 | PASS, nothing raised |

**The oracle's boards** (`lineBoard`): one line `words`, "Contrast, measured" at (40, 120), on the ground or on a
`rect@1` `plate` 432 × 60 u from (24, 104), past every side of the line's box and drawn before it.

| Board | Ratio | Expected |
|---|---|---|
| `ink` on the ground | 16.86:1 | PASS |
| `session_readout` on the ground | 6.25:1 | PASS |
| `term_bright_magenta` on the ground | 4.26:1 | FAIL, ratio 4.26 |
| `muted` on the ground | 3.24:1 | FAIL, ratio 3.24 |
| `accent` on the ground | 2.95:1 | FAIL, ratio 2.95 |
| `ground` on an `accent` plate | 2.95:1 | FAIL, ratio 2.95, naming `words`, not `plate` |
| `ground` on the ground | 1:1 | FAIL, ratio 1 |

In the clean look's dark theme every one of these but `ground` on the ground clears 4.5:1 (the ground turns #040405
and `muted` stays #8b8f97, 6.32:1). The hub draws light, so the tests hold a check that reads the light theme, or
every theme and fails on any. A check that read only the dark theme would miss the faults; nothing in the design
makes dark the default.

## Planted program

The implementer adds it to the loop module's `PLANTED` list (`crates/deep-canvas-loop/src/lib.rs`), which the hub
puts in the check's input as `planted`. It is reached only through the scenario's `planted`, never an environment
variable.

| Name | The wrong program | Used by |
|---|---|---|
| `contrast_min_3` | `render.contrast` holds text to 3:1, WCAG's minimum for large text, in place of `min` (4.5); everything else as shipped | `contrast.test.ts`: the fault board's row PASSes under it, so the fault assertion fails on that program |

## Criteria to tests

The ID is `#1938.` and the first 8 hex digits of the SHA-256 of the criterion's text, `- [ ] ` dropped, trimmed and
whitespace collapsed, as `scripts/proof-change.mjs` computes it. Each file holds it as `const ID`, and every test's
name starts with `${ID}` (`spans` reads both).

| ID | File (tests) | What it asserts |
|---|---|---|
| `#1938.f19b61dd` | `contrast.test.ts` (1) | **The fault:** FAIL; every error and warning is an error of `render.contrast` with a non-empty `code`, naming exactly `caption`, never `title`; its fix is patch ops. **The twin:** PASS, nothing raised. **The fix**, sent unchanged as alpha's patch of the stored fault board in a second run: applied, and the verdict after it PASS, nothing raised. **Planted:** under `contrast_min_3` the fault board PASSes. |
| `#1938.f19b61dd` | `oracle-contrast.test.ts` (1) | The formula first keeps upstream's own assertions. Then seven boards in one run: each at or over 4.5:1 by the formula PASSes with nothing raised; each under it FAILs, every error and warning an error of `render.contrast` with a code, naming exactly `words`, each reporting the formula's ratio within 0.05; the swapped pair reports one ratio. |

## Readings where the issue and design leave a choice

- **Which document.** render.contrast reads text wherever it's drawn: the loop kinds name "every 3D case and film",
  `text@1` says it can't "bring text under render.contrast's minimum (checked)", and captions are "held by
  render.contrast". A 2D board is the smallest document that draws text on a known ground. Its render-back draws on
  the CPU, so the pixels the check reads are this machine's; criterion 2 (INCONCLUSIVE on another machine) isn't here.
- **No look named.** A document that names none is drawn in the shipped clean look, whose colors are known. The tests
  paint only with roles the look gives (Paint: no literal colors). `session_readout` and `term_bright_magenta` are the
  look's own roles nearest the threshold on either side.
- **"Text under 4.5:1"** is the text's color as drawn against what is drawn under its glyphs, by WCAG 2's ratio
  (`text: wcag`, `min: 4.5`). All text is held to 4.5: the design gives render.contrast one `min`. Every line here is
  20 u (15 pt) at regular weight: under WCAG's 18 pt and not bold, so normal text by WCAG's own measure too, and the
  large-text minimum of 3:1 wouldn't apply on either reading. The fault sits at 3.24:1, between the two minimums, so a
  check held to 3:1 misses it (`contrast_min_3`).
- **"Fires with its code":** an error of `render.contrast` (its issue's `check`) with a non-empty `code`. The design
  names no code for the loop kinds, so no code string is asserted. "Naming the text": `ids` exactly the line's item;
  the title in ink and the plate under a line are never named.
- **"A fix as patch ops":** `fix_ops` (the base keeps a module check's ops apart from its text `fix`), else `fix` as a
  list. The design calls a fix patch ops only where applying it clears its code and raises nothing else, so the test
  sends the ops unchanged through the product's own patch path and asks the verdict again: it must PASS with nothing
  raised. Which ops (a new role for the text, a plate under it, a halo) is the implementer's. This isn't the issue's
  scope item of fixtures that apply each fix, stale and conflicting fixes among them, which no test here covers.
- **"Its clean twin passes":** PASS with no error or warning on the row: the twin differs from the fault only in the
  caption's role.
- **The ratio reported** is read from `actual` ("the value refused at `path`"), as a number or as `actual.ratio`, or
  from the issue's own `ratio`. Within 0.05 of the formula's: closer than any plausible mistake in the formula
  (luminance in sRGB-encoded values reads muted at 1.72:1; leaving out the 0.05 flare, 3.65:1), and loose enough for
  a ratio rounded to two places.
- **A 1:1 line** (the ground's role on the ground) is drawn but can't be seen. Upstream counts a 1:1 pair as invalid
  rather than hidden; here it FAILs at 1:1, and never passes as text the check didn't find.
- **INCONCLUSIVE.** A row that comes back INCONCLUSIVE on the machine that drew it fails the test with a message
  starting `INCONCLUSIVE:`.

## Upstream tests (the Oracle lane)

The Oracle page maps criterion 1 to the upstream accessibility library's tests at commit
`e797173108eadfa4355fe06af331791734e1757f`, with the use "port"; criterion 2 has no upstream test.

| Upstream file | Its assertions | Here |
|---|---|---|
| `test/commons/color/has-valid-contrast-ratio.js` | black on white valid, ratio over 4.5, minimum 4.5 for 8 pt text; white and gray 128 in 8 pt text invalid, ratio under 4.5; the same pair passing at 3:1 as large text; black on black ratio 1, invalid, not hidden | `ink` passes; `muted` (3.24) and `term_bright_magenta` (4.26) fail and `session_readout` (6.25) passes, so the minimum is 4.5; `ground` on the ground fails at 1. The large-text cases aren't ported: README, Readings |
| `test/commons/color/get-contrast.js` | one color on itself gives 1; the ratio is reversible; more contrast gives a higher ratio | each reported ratio is the formula's within 0.05; `accent` on the ground and `ground` on an `accent` plate report one ratio |
| `test/checks/color/color-contrast.js` | the ratio measured is reported (21.00 for black on white); yellow on white fails; the background is what is under the text | each failure reports its ratio; `accent` on the ground fails; the line on the plate is measured against the plate, not the page |

**The formula, re-expressed** in `oracle-contrast.test.ts`; no upstream code is copied or run. Each sRGB channel v
decodes to linear light as c = v ÷ 255, then c ÷ 12.92 when c ≤ 0.04045, else ((c + 0.055) ÷ 1.055)^2.4; relative
luminance is L = 0.2126 R + 0.7152 G + 0.0722 B; the ratio is (L1 + 0.05) ÷ (L2 + 0.05), L1 the lighter. (WCAG 2.0
wrote 0.03928 for the cut; no 8-bit value lies between the two.) The file first holds the formula to upstream's own
assertions with upstream's colors (`formulaKeepsUpstreamAssertions`): black on white over 4.5 and 21.00; white and gray
128 under 4.5 and over 3; each color on itself 1; reversible; yellow on white under yellow on black under white on
black. A port that broke the formula fails there, before the binary is asked.

Not ported: the large-text cases (the design's one `min`); the check-level cases that read a web page's styles
(hidden elements, text shadows, color functions with `none`, inline elements across lines, images and pseudo
elements), which have no counterpart in a board.

## Not tested

No criterion asks for these here, so none is tested:

- the other eight planted faults of criterion 1, and criterion 2 (the same results on every machine;
  INCONCLUSIVE for the pixel checks on another);
- `text: apca`, `subject_ratio`, a `min` a brief tightens, `at_times`, and the check input's `render` fields;
- text over an image, a gradient or a 3D scene; a caption plate drawn by a look; text that moves or fades;
- the dark theme, and a document that names a look;
- which code render.contrast raises, the issue's `path` and `what`, and which ops its fix holds;
- the kit's fixtures that apply each fix, and stale and conflicting fixes.

## What the implementer adds outside this folder

The `alone` line in `scripts/lanes.mjs`, and `contrast_min_3` in the loop module's planted list. Nothing else.
