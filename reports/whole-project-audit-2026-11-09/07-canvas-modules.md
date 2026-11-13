# rust-canvas-modules — findings

Checkout: `the checkout`. Read-only; nothing built or run.
Paths are relative to that checkout. **Line numbers are at 06fd33cd.** The working tree was edited while I read
(the five `-D warnings` fixes below are already applied there, which shifts `animator.rs` by −1 after line 717 and
`function.rs` by +2 after line 757; `git show 06fd33cd:<path>` gives the lines I quote).

How this area was read: it is about 68k lines, more than one context holds. I split it into parts, but only one
part reader could start (the session's subagent limit was reached). That reader took `scene.rs`, `data.rs` and
`modules.rs` in full; its 12 findings are in the appendix as `P1-n` and are ranked below with mine. I re-read the
quoted lines of P1-1 and P1-3 and agree; the other P1 items I did not re-check. The rest I read myself: some
files in full, the others by targeted search for the failure classes the task named. The coverage table at the
end says which is which. **Large files were not read end to end; say so to the owner.**

Ranking, worst first: RCM-1, RCM-2, P1-1, P1-2, P1-3, RCM-3, RCM-4, RCM-5, RCM-6, RCM-7, RCM-8, RCM-9, RCM-10,
P1-4, P1-5, P1-6, P1-8, P1-10, P1-7, P1-9, RCM-11, RCM-12, RCM-13, RCM-14, RCM-15, RCM-16, RCM-17, P1-11, P1-12.

A pattern worth one sweep by the lead: `f64::clamp(min, max)` and `Ord::clamp` **panic** when `min > max` (or a
bound is NaN). RCM-3, 4, 5, 8 and a nit are all that one mistake: a bound that comes from a document.
`rg -n '\.clamp\(' crates/deep-canvas-*` lists about 60 sites; I checked each one in this area.

---

## Asked for: the `-D warnings` failures on main

Source: the compiler's own cached diagnostics, read (not run) from
`~/dev/claude-worktrees/doneright/code-audit-optimization-12828f/target/debug/.fingerprint/deep-canvas-{marks,effects}-*/output-lib-*`
(a clippy run at 6a6d6b4f) and `github-issue-1646-bd6b00/target/...` (a build after #1646), re-mapped to 06fd33cd by
reading each site. It is four marks files, not three: one is a rustc warning, three are clippy lints. All five
fixes below are already in the working tree, in these exact forms.

| ID | where (06fd33cd) | lint | fix |
|---|---|---|---|
| RCM-C1 | `crates/deep-canvas-effects/src/fusion.rs:323` | rustc `unused_mut` | `let mut blur_stage = \|axis: &str\| {` → `let blur_stage = …` (the closure only mutates its own local) |
| RCM-C2 | `crates/deep-canvas-marks/src/animator.rs:717`, callers `:1245`, `:1577` | rustc `unused_variables`: `selectors_of` never reads `plant` (body `:719-774` read in full; the plants act in `Selector::amount` `:650` and `lay_out` `:1460`, `:1500`) | delete the parameter and the argument at both call sites |
| RCM-C3 | `crates/deep-canvas-marks/src/drawn.rs:914` | `clippy::needless_range_loop` (indexes `by_light`) | `for (i, &b) in run.points.iter().enumerate() { if i > 0 { let a = run.points[i - 1]; …` (keeps every index; clippy's own `.take()` form would truncate silently) |
| RCM-C4 | `crates/deep-canvas-marks/src/function.rs:757` | `clippy::neg_cmp_op_on_partial_ord` | `let gap = (…).abs(); gap.is_nan() \|\| gap > TOLERANCE` (same truth table: `TOLERANCE` is the constant 0.5) |
| RCM-C5 | `crates/deep-canvas-marks/src/implicit.rs:217` | `clippy::needless_range_loop` (indexes `edges`) | `for (e, &edge) in edges.iter().enumerate()` and `points.entry(edge)` |

All SURE; no behavior changes. Verify: `cargo clippy -p deep-canvas-marks -p deep-canvas-effects -- -D warnings`.
The canvas lint is a separate lane and is likely failing too: see RCM-9.

---

## Findings

### RCM-1  A terminal's saved cursor is not clamped by a resize: restoring it indexes off the grid and panics
- kind: broken · confidence: SURE
- where: `crates/deep-canvas-cells/src/emulator.rs:615-628` (`save`, `restore`), `:413-430` (`resize`), `:677-701` (`put`), `:756-764` (`erase`), `:948-963` (mode 1049); host call `crates/deep-show/src/host.rs:139`
- evidence:
  ```rust
  617          self.saved = Some((x, y, self.pen));
  423              s.x = s.x.min(cols - 1);      // resize clamps each screen's cursor …
  424              s.y = s.y.min(rows - 1);      // … and never touches self.saved
  621          if let Some((x, y, pen)) = self.saved {
  624              s.x = x;
  625              s.y = y;
  688          s.rows[usize::from(y)][usize::from(x)] = Cell { … };
  ```
  Entering the alternate screen with 1049 saves the main cursor (`:951`); leaving it restores it (`:960`).
- failure: a 40-row panel with the shell prompt on row 39; run `vim` or `less` (1049 on, cursor saved at y = 39);
  shrink the panel to 20 rows (`resize`); quit (1049 off → `restore` sets y = 39); the next printed byte runs
  `put` → `rows[39]` on a 20-row grid → index out of bounds, panic. Same with `ESC 7`, resize, `ESC 8`, and for
  x with a narrower panel. Minimal: `Terminal::new(80, 24, 0)`, `feed(b"\x1b[24;80H\x1b7")`, `resize(40, 10)`,
  `feed(b"\x1b8x")`.
- fix: `emulator.rs:620-628`
  ```rust
  // old
          self.pen = pen;
          let s = self.screen_mut();
          s.x = x;
          s.y = y;
  // new
          self.pen = pen;
          let (cols, rows) = (self.cols, self.rows);
          let s = self.screen_mut();
          s.x = x.min(cols - 1);
          s.y = y.min(rows - 1);
  ```
- verify: a unit test beside the five in `emulator.rs:1109-1172` with the minimal input above: panics before,
  cursor at (39, 9) after. No existing test resizes.
- risk: none; a saved cursor inside the grid is unchanged. `tests/acceptance/402` resizes only once, with no save.

### RCM-2  Cursor-down, cursor-forward and erase-characters add a wire number to a `u16` without saturating
- kind: broken · confidence: SURE
- where: `crates/deep-canvas-cells/src/emulator.rs:871`, `:876`, `:927`; `p` at `:783-788`
- evidence:
  ```rust
  786              .map(|p| p.parse::<u16>().unwrap_or(0))        // a parameter is any u16
  871                  s.y = (s.y + p(0, 1)).min(rows - 1);
  876                  s.x = (s.x + p(0, 1)).min(cols - 1);
  927                  self.erase(y, x, (x + p(0, 1)).min(cols));
  ```
  The sibling moves the other way use `saturating_sub` (`:866`, `:881`).
- failure: `ESC [ 65535 B` with the cursor on row 1 or lower (programs send a huge count to mean "to the edge").
  A dev build panics (`attempt to add with overflow`; the workspace's dev profile keeps overflow checks, and the
  acceptance suites run dev binaries). A release build wraps: y + 65535 = y − 1, so the cursor moves **up** one
  row instead of to the bottom. Same for `C`/`a` and `X`.
- fix: `s.y + p(0, 1)` → `s.y.saturating_add(p(0, 1))` (`:871`); `s.x + p(0, 1)` → `s.x.saturating_add(p(0, 1))`
  (`:876`); `x + p(0, 1)` → `x.saturating_add(p(0, 1))` (`:927`).
- verify: unit test: `Terminal::new(10, 5, 0)`, `feed(b"\n\x1b[65535B")` → `cursor().1 == 4`.
- risk: none.

### RCM-3  A `limits` modifier with `min > max` panics in `f64::clamp`
- kind: broken · confidence: SURE
- where: `crates/deep-canvas-motion/src/doc.rs:1635-1638` (parse, no order check), `crates/deep-canvas-motion/src/modifier.rs:143-146` (`apply`), `:192-195` (`bound`); reached per frame through `Channel::read` (`doc.rs:119-124`)
- evidence:
  ```rust
  doc.rs:1635        "limits" => ModKind::Limits {
  doc.rs:1636            min: num("min", f64::MIN)?,
  doc.rs:1637            max: num("max", f64::MAX)?,
  modifier.rs:144                let held = value.clamp(*min, *max);
  ```
  `rg -n 'Limits' crates/deep-canvas-motion/src` finds no other check. The sibling `limit` constraint does check
  (`doc.rs:1325 (Some(lo), Some(hi)) if mm.len() == 2 && lo <= hi`). `"limits"` is validated nowhere else
  (`rg '"limits"' crates` hits only this line).
- failure: a channel with `"modifiers": [{"limits": {"min": 1, "max": 0}}]` passes the read and panics
  (`min > max, or either was NaN`) at check in `bound` or at the first evaluation in `apply`.
- fix: `doc.rs:1635-1638`
  ```rust
  "limits" => {
      let (min, max) = (num("min", f64::MIN)?, num("max", f64::MAX)?);
      if min > max {
          return refuse("out_of_range", format!("{at}/min"));
      }
      ModKind::Limits { min, max }
  }
  ```
  (`format!`, not `at` itself: the `num` closure still borrows `at`.)
- verify: a unit test in `doc.rs` (or `tests/bounds.rs`): the document above is refused `out_of_range`.
- risk: none for ordered limits. No test under `tests/acceptance/489` writes inverted limits (grep `limits`).

### RCM-4  A control whose `range` is `[hi, lo]` panics every driver that reads it
- kind: broken · confidence: SURE
- where: `crates/deep-canvas-motion/src/program.rs:2290-2309` (compile), `:2424-2431` and `:2452-2460` (`evaluate_core`)
- evidence:
  ```rust
  2299    let (lo, hi) = (lo.as_f64().unwrap_or(0.0), hi.as_f64().unwrap_or(0.0));
  2308        range: (lo, hi),
  2459    v.clamp(range.0, range.1)
  ```
  Nothing orders the pair first: the core's `check_controls` reads only `kind` and `role`
  (`crates/deep-canvas/src/document/check.rs:1986-2018`), `deep-canvas-input` takes `min`/`max` as written
  (`crates/deep-canvas-input/src/session.rs:1203-1206`), and `Iv::new(lo, hi)` (`interval.rs:102`) accepts an
  inverted pair, so compile succeeds.
- failure: `"controls": {"k": {…, "range": [10, 0]}}` and a driver with a var on control `k`: the first
  `evaluate` panics in `clamp`.
- fix: after `program.rs:2299` add
  ```rust
  if lo > hi {
      return Err(Refused { code: "out_of_range", path: format!("controls/{id}/range"), detail: None });
  }
  ```
- verify: `Program::compile` of that document is `Err(out_of_range)`; `tests/acceptance/417` and `493` (controls
  with ordered ranges) unchanged.
- risk: none for ordered ranges.

### RCM-5  A mark set with a computed column and a negative `n` panics in `clamp`
- kind: broken · confidence: SURE
- where: `crates/deep-canvas-marks/src/functions.rs:703-732`; reached from `functions::lower` ← `crates/deep-marks-render/src/formulas.rs:113` ← `lib.rs:414` and raster
- evidence:
  ```rust
  711            Some(v) => (v.as_f64(), v.as_f64()),          // a number is its own max
  723        if max > MAX_COMPUTED_ROWS {                       // only the upper side is checked
  732        let n = n.unwrap_or(0.0).round().clamp(0.0, max) as usize;
  ```
  For `n: "controls/<id>/value"` the max is the control's `range[1]` (`:705-708`), which may be negative too.
- failure: `{"kind":"marks@1","params":{"n":-1,"columns":{"y":{"expr":"i"}}}}` → `clamp(0.0, -1.0)` panics.
- fix: `:732` `.clamp(0.0, max)` → `.clamp(0.0, max.max(0.0))` (a negative count draws no rows).
- verify: a unit test beside `functions.rs` tests with the item above: `lower` returns, the set has 0 rows.
- risk: none for `max >= 0`.

### RCM-6  The sheet's placement adds document sizes in `u32`: a dev build panics, a release build says an impossible sheet fits
- kind: broken · confidence: SURE (the bug), LIKELY (the fix as written)
- where: `crates/deep-canvas-sheet/src/lib.rs:258-324` (`place`): `:266`, `:277`, `:287`, `:302-303`, `:308-309`, `:314`; fed by `crates/deep-canvas-sheet/src/module.rs:85-157` (every `sheet@1` item in deep-show and deep-gpu-layer) and `src/main.rs:145-185`
- evidence:
  ```rust
  module.rs:86    v.as_u64().and_then(|n| u32::try_from(n).ok())     // any u32 is a size
  lib.rs:266      let left = MARGIN + card[0] + MARGIN;
  lib.rs:277          .any(|r| r[0] + r[2] > w || r[1] + r[3] > h)
  lib.rs:314      let fits = |r: &Rect| r[0] + r[2] + MARGIN <= view[0] && r[1] + r[3] + MARGIN <= view[1];
  ```
- failure: `"params": {"view": [800, 400], "card": [4294967295, 160], "cells": […]}`: dev build panics at `:266`.
  Release: `left` wraps to 31, `fits(&slot)` wraps to `31 <= 800`, and `place` returns `Ok` with a card slot four
  billion px wide. A highlight `[4294967295, 0, 2, 1]` in a 160 px cell wraps to `1 > 160` = false and is taken
  as inside the cell.
- fix: make each sum checked. At the top of `place`:
  `let add = |a: u32, b: u32| a.checked_add(b).ok_or("sheet.does_not_fit");`
  then `:266` `let left = add(add(MARGIN, card[0])?, MARGIN)?;`, `:268` `.checked_sub(add(left, MARGIN)?)`, and
  the same for `x + gap + w + beside`, `y += row_h + gap`, `cx`/`cy`, the mark rects, `x += w + beside`,
  `h + beside`, `y + row_h` and both sums in `fits`; `:277` in `u64`:
  `u64::from(r[0]) + u64::from(r[2]) > u64::from(w) || u64::from(r[1]) + u64::from(r[3]) > u64::from(h)`.
- verify: `crates/deep-canvas-sheet/tests/cells.rs` stays green; a new case with the card above is
  `Err("sheet.does_not_fit")`.
- risk: low. Sizes that fit a real view are far from 2³²; no test uses a size above 800.

### RCM-7  The SVG importer recurses once per nested element with no depth limit
- kind: broken · confidence: LIKELY (I did not confirm roxmltree 0.21 has no depth limit of its own; its `ParsingOptions` here sets only `allow_dtd` and `nodes_limit`)
- where: `crates/deep-canvas-vector/src/svg.rs:664-722` (`walk`, the `"svg" | "g" | "a"` arm at `:712-721`), limits at `:18-54`, `:188-196`
- evidence: the file has limits for bytes (512 KiB), nodes (1,000,000), drawn paths (65,536), `<use>` depth (16),
  clip depth (4) and tiles, but `walk` calls itself for every child of a group (`:720`) with nothing counting
  plain nesting. Each frame holds a `Style`, an `Affine` and several `String`s.
- failure: an SVG of 70,000 nested `<g>` (7 bytes a level, 490 KB, under `MAX_BYTES`) overflows the stack in
  `walk`: the process dies with SIGSEGV, not a refusal. The import runs at check per vector item
  (`lib.rs:98`, `outline_source.rs:46`).
- fix: add `const MAX_NESTING: usize = 256;` beside `USE_DEPTH`, a `nesting: usize` field on the walker, and in
  `walk` after the early `return Ok(())` at `:681`:
  ```rust
  if self.nesting >= MAX_NESTING {
      return Err(Refusal::Malformed(format!("elements nest over {MAX_NESTING} deep")));
  }
  self.nesting += 1;
  ```
  with `self.nesting -= 1;` before the function's final `Ok(())` (an early `?` aborts the import, so it needs no
  decrement).
- verify: `svg::import` of `"<svg xmlns=…>" + "<g>".repeat(70_000) + … ` returns `Malformed`; `tests/acceptance/398`
  and `1175` unchanged.
- risk: an honest SVG nested over 256 deep would be refused; the lead may prefer a higher limit.

### RCM-8  A rect whose box has a negative width or height panics in `outline::rect`
- kind: broken · confidence: LIKELY
- where: `crates/deep-canvas-marks/src/outline.rs:177-178`; callers `crates/deep-canvas-marks/src/scene.rs:4452`, `:4737`, `:4814`
- evidence:
  ```rust
  177  pub fn rect([x, y, w, h]: [f64; 4], radius: f64) -> Vec<Verb> {
  178      let r = radius.clamp(0.0, w.min(h) / 2.0);
  ```
  `scene.rs:4812-4814` hands it `four(params.get("box"))`, four numbers with no sign check
  (`scene.rs:1395-1398`). I found no rule that keeps `box[2]`, `box[3]` at 0 or above for `rect@1` (the test kind
  `test.rect` has `w`, `h` with a minimum; `rect@1`'s `box` is not declared that way).
- failure: `rect@1` with a stroke and `"box": [0, 0, -10, 20]`, or a box whose width a channel drives below 0
  (an overshooting ease from 20 to 0): `clamp(0.0, -5.0)` panics, with any radius, in the frame build.
- fix: `:178` `radius.clamp(0.0, w.min(h) / 2.0)` → `radius.clamp(0.0, (w.min(h) / 2.0).max(0.0))`.
- verify: unit test: `outline::rect([0.0, 0.0, -10.0, 20.0], 4.0)` returns five verbs.
- risk: none for boxes with sizes at or above 0. Not checked: whether `item_placed` (the R1 path) refuses the
  box earlier for a plain filled rect.

### RCM-9  Checked canvas code calls std's platform float functions (the canvas lint forbids them)
- kind: broken (lint lane, and bit-for-bit output across machines) · confidence: LIKELY (the lint was not run)
- where (all outside `#[cfg(test)]`):
  `crates/deep-canvas-marks/src/animator.rs:187` `.sqrt()`, `:195` `.cos()`, `:455` `.sin_cos()`, `:1013` and
  `:1050` `.hypot()`, `:1021` `.atan2()`, `:1401-1403` `.sin_cos()` ×3, `:1416` `.tan()`;
  `crates/deep-canvas-marks/src/data.rs:1337` `.powi(2)` ×2 and `.sqrt()`;
  `crates/deep-canvas-motion/src/held.rs:231` `.powi()`;
  `crates/deep-canvas-effects/src/chrome_fx.rs:383` `.powf(2.4)`;
  `crates/deep-canvas-effects/src/interp.rs:123` `.powi(2)` ×2, `:125` `.log2()`
- evidence: `lint/canvas/clippy.toml:15-42` disallows `f64::sqrt`, `sin`, `cos`, `tan`, `sin_cos`, `atan2`,
  `log2`, `powf`, `powi`, `hypot` ("platform libm; use the ops module on pinned libm"); `scripts/canvas-lint.mjs:6`
  puts every `deep-canvas*` crate in scope and forbids the lints (`-F`). `scripts/known-failures.json` lists no
  canvas-lint entry for these files. I searched every non-test line of the eight `deep-canvas-*` crates here for
  `.sqrt()`, `.hypot(`, `.atan2(`, `.sin()`, `.cos()`, `.tan()`, `.sin_cos()`, `.powf(`, `.powi(`, `.exp()`,
  `.ln()`, `.log2()`, `.log10()`, `.acos()`, `.asin()`, `.atan()`, `.cbrt()`; these 16 calls are all of them.
  `animator.rs` came with #496 (63803147, Nov 7); everything else in these crates goes through `deep_canvas::ops`.
- failure: `node scripts/canvas-lint.mjs` fails on main, naming these lines (not verified by a run). And a text
  animator's glyph places (range shape, on-path layout, 3D turn, shear), an echo's opacity and the chrome-fx
  check's sRGB decode come from the system libm, so a hash recorded on one machine can differ on another by an ulp.
- fix (each call to its `deep_canvas::ops` twin; `ops` has `sqrt, pow, powi, log2, sin, cos, tan, atan2, hypot`):
  `animator.rs:187` → `deep_canvas::ops::sqrt(1.0 - (x * x) / (a * a))`; `:195` → `deep_canvas::ops::cos(…)`;
  `:455` → `let (s, c) = (deep_canvas::ops::sin(rad), deep_canvas::ops::cos(rad));` and the same for `rx`, `ry`,
  `rz` at `:1401-1403`; `:1013`, `:1050` → `deep_canvas::ops::hypot(d[0], d[1])`; `:1021` →
  `deep_canvas::ops::atan2(d[1], d[0])`; `:1416` → `deep_canvas::ops::tan(a.shear.to_radians())`;
  `data.rs:1337` → `deep_canvas::ops::hypot(b[0] - a[0], b[1] - a[1])`; `held.rs:231` →
  `deep_canvas::ops::powi(decay, k as i32)`; `chrome_fx.rs:383` → `deep_canvas::ops::pow((c + 0.055) / 1.055, 2.4)`;
  `interp.rs:123` → `(d[0] * w) * (d[0] * w) + (d[1] * h) * (d[1] * h)`; `:125` → `deep_canvas::ops::log2(rho2)`.
- verify: `node scripts/canvas-lint.mjs` (lint lane); `tests/acceptance/496`, `495`, `1436`, `431`.
- risk: results may move by one ulp on macOS where the pinned libm and the system's differ; a golden that pins
  exact bytes from #496 (`tests/acceptance/496`) would then need the blind job, so run it before deciding.

### RCM-10  An emitter with `ref: 0` gives a NaN gain, against the W3C rule the module cites
- kind: broken · confidence: LIKELY
- where: `crates/deep-canvas-media/src/emitter.rs:61-68`; values read unchecked at `crates/deep-show/src/mixdown.rs:488-493`; module doc `emitter.rs:1-3` ("by the W3C Web Audio formulas")
- evidence:
  ```rust
  61          Model::Inverse => {
  62              let d = d.max(r);
  63              r / (r + m.rolloff.max(0.0) * (d - r))
  66              let d = d.max(r);
  67              ops::pow(d / r, -m.rolloff.max(0.0))
  ```
  Web Audio (PannerNode, distance models): for inverse and exponential, "if d_ref = 0, the value of the equation
  is taken to be 0". Here `ref: 0` with `rolloff: 0`, or with the source at the listener, is `0 / 0`.
- failure: `"distance": {"ref": 0, "rolloff": 0}`: the gain is NaN at every distance; each sample of the strip is
  NaN, and a reverb on its bus keeps NaN in its delay lines for the rest of the render.
- fix: after `let r = m.reference;` (`:52`) add `if r <= 0.0 && model != Model::Linear { return 0.0; }`.
- verify: unit test: `distance_gain(&Distance { reference: 0.0, rolloff: 0.0, ..Default::default() }, 3.0, Model::Inverse) == 0.0`;
  `tests/acceptance/499/mix/emitter.test.ts` (ref 1 only) unchanged.
- risk: a negative `ref` now reads as silence instead of a negative or infinite gain; no test writes one.

### RCM-11  A mix with no processors renders every block from 0 on each seek
- kind: inefficient · confidence: LIKELY
- where: `crates/deep-canvas-media/src/mix.rs:503-548` (`seek`), `:520-536`
- evidence: `best` collects one checkpoint per ring; with no rings it is `Some(vec![])`, `min()` is `None`, so
  `from_block = 0` and `while self.block < target { self.render_block(); }` renders the whole timeline up to the
  seek. `render_block` (`:584-664`) reads only `self.block`, the units and the rings; with no units a block's
  samples are a pure function of its index. Prior reports do not cover this crate.
- failure (cost): a plain sound document (strips, a master bus, no eq or reverb) scrubbed to 10 minutes at 48 kHz
  renders 225,000 blocks, each over every strip and bus, to play one.
- fix: `:529` `None => {` → `None if self.units.is_empty() => target.max(0),` followed by the existing `None => { … }` arm.
- verify: `tests/acceptance/499/mix` (seek equals play bit for bit); count `render_block` calls for one seek.
- risk: low; needs one compile.

### RCM-12  The reference interpreter rebuilds a texture's whole mip chain for every sample
- kind: inefficient · confidence: LIKELY
- where: `crates/deep-canvas-effects/src/interp.rs:108-118` (`sample_level`), `:95-105` (`mips`), called per pixel from `:1122-1129` (`sample_grad`) and `:1131-1140` (`backdrop`)
- evidence: `let mips = self.mips();` clones the image and halves it down to 1 × 1 inside the per-sample call.
  The root `Cargo.toml` already builds this crate at `opt-level = 3` in dev because the interpreter is slow.
- failure (cost): a `backdrop@1` or `sample_grad@1` step over a W × H target costs about 1.33 × (W × H)² texel
  reads: 2.2 × 10⁷ for 64 × 64, 5.7 × 10⁹ for 256 × 256, per frame.
- fix (exact, small): first line of `sample_level`: `if lod <= 0.0 { return self.sample(uv); }` (for `lod <= 0`
  the clamp gives level 0 with `f == 0.0`, and `mips[0]` is `self.clone()`; a NaN `lod` still takes the old
  path). The full fix is a per-texture chain built once per run, which is a larger change.
- verify: `tests/acceptance/431` (backdrop and `sample_grad` against the GPU).
- risk: none for the small edit.

### RCM-13  Ping-pong direction uses `k % 2 == 1`, which is false for a negative odd pass
- kind: inconsistent · confidence: LIKELY (the wrong value), QUESTION (whether negative child time is meant to mirror)
- where: `crates/deep-canvas-motion/src/eval.rs:137`, `:196`; the sibling that gets it right, `crates/deep-canvas-motion/src/curve.rs:248` (`k.rem_euclid(2) == 1`)
- evidence: `:126-129` lets child time go below 0 when the remap has `clamp: false`; `:136` then gives
  `k = child.div_euclid(clip_span) = -1`, and `-1 % 2` is `-1` in Rust.
- failure: a `ping_pong` placement under an unclamped remap that runs before its start (a `replay`'s `before`,
  a `reverse`): at child time −1 the local time is `span − 1` (a wrap) where a mirror gives 1, so the value jumps
  at 0. `rate_after` (`:196`) reports the forward rate there too.
- fix: `:137` `k % 2 == 1` → `k.rem_euclid(2) == 1`; `:196` `child.div_euclid(clip_span) % 2 == 1` →
  `child.div_euclid(clip_span).rem_euclid(2) == 1`.
- verify: `crates/deep-canvas-motion/tests/placements_492.rs`, `tests/acceptance/492`.
- risk: only negative child time changes.

### RCM-14  The sheet module and the `deep-sheet` binary read two different shapes of the same sheet
- kind: inconsistent · confidence: QUESTION
- where: `crates/deep-canvas-sheet/src/module.rs:104-118`, `:144-151` against `src/main.rs:105-112`, `:167-171` and `src/lib.rs:212`
- evidence: `taste` writes `"columns": "auto"` (`lib.rs:212`) and `view_line` reads `"auto"` or a count above 0
  (`main.rs:167-171`); the module's operator takes only a number and answers `bad_doc` for `"auto"`
  (`module.rs:146-149`), and takes `0`, which puts every cell in one row pushed down by one gap (`lib.rs:286`
  is true for the first cell). A highlight is `{"region": [x, y, w, h]}` to the binary (`main.rs:110`) and a
  bare `[x, y, w, h]` to the module (`module.rs:109-116`).
- failure: the sheet `taste` returns, placed in a `sheet@1` item's params, is refused `bad_doc`.
- fix: `module.rs:144-151`: accept `Some(c) if c.as_str() == Some("auto") => None` and require a count above 0;
  read a highlight as `r.get("region").unwrap_or(r)`. The lead should check which shape the private design gives.
- verify: `tests/acceptance/394`.
- risk: QUESTION until the design's shape is confirmed.

### RCM-15  A document's `spring_chain` constraint is read and then does nothing
- kind: inconsistent · confidence: QUESTION
- where: `crates/deep-canvas-motion/src/doc.rs:1432-1441` (parsed, `hz`, `damping_ratio`, `max_swing` unchecked), `crates/deep-canvas-motion/src/program.rs:2709` (`Kind::SpringChain { .. } => own,`), `crates/deep-canvas-motion/src/constraint.rs:328-374` (`SpringBake`, called only from `kit.rs:48`)
- evidence: `rg 'SpringBake|SpringChain' crates` finds the bake used by the kit fixture alone.
  `tests/acceptance/489/README.md:199-202` says the document form of this kind belongs to another issue.
- failure: a document with `{"kind": "spring_chain", …}` passes check and plays with no swing, silently.
  `held.rs:39-57` takes the other stance for a form that is not built: it refuses it by name (`module_missing`).
- fix (lead's call): refuse it at `doc.rs:1432` as `module_missing` until the bake is wired, or leave as is.
- risk: a fixture that carries the kind today would start to be refused.

### RCM-16  `Terminal::history_dropped` is written and never read
- kind: unneeded · confidence: LIKELY
- where: `crates/deep-canvas-cells/src/emulator.rs:227-228` (field), `:354-357` (getter), `:727` (increment), `:274`
- evidence: `grep -rn history_dropped crates packages scripts tests benchmarks docs adapters packs` (`.rs`, `.ts`,
  `.mjs`, `.md`) finds only `emulator.rs`.
- fix: delete the field, its initializer, the getter and the `self.history_dropped += 1;` line.
- risk: none found; a design line may want the count shown later.

### RCM-17  deep-motion's README lists fewer imports than the binary has
- kind: inconsistent · confidence: SURE
- where: `crates/deep-motion/README.md` ("What it may import") against `crates/deep-motion/Cargo.toml` (`deep-text`, #491) and `crates/deep-motion/src/main.rs:29-32`
- evidence: the README names `deep-canvas`, `deep-canvas-motion`, `deep-canvas-marks` "for a shipped look's time
  feel (`look::shipped`, #417)" and `serde_json`. `main.rs:29` builds a `deep_text::Shaper` and `:32` calls
  `deep_canvas_marks::layout::solve`.
- fix: in that paragraph, after "(`look::shipped`, #417)" add " and the auto layout a frame's layout glide reads
  (`layout::solve`, #491), `deep-text` for the shaper that layout measures text with,".
- risk: none.

## Nits

- `crates/deep-canvas-media/src/eq.rs:44` `b.freq.clamp(1.0, rate / 2.0 - 1.0)` panics for a sample rate of 1, 2
  or 3 Hz, which `mixdown.rs:188-190` accepts (they divide a second into whole flicks). `.clamp(1.0, (rate / 2.0 - 1.0).max(1.0))`.
- `crates/deep-canvas-media/src/reverb.rs:63-77` `State::from_json` checks each line's `at` but not that there are
  16 combs and 8 allpasses; `process` (`:142`, `:149`) slices `[ch * 8..ch * 8 + 8]` and panics on fewer.
- `crates/deep-canvas-media/src/doc.rs:51` reads `""`, `"s"`, `"f"`, `"."` and `"0"` as time 0; every other time
  field refuses them.
- `crates/deep-canvas-media/src/clock.rs:65` divides by the fitted slope `b`; callbacks that all report one host
  time give `b = 0` and an infinite position.
- `crates/deep-canvas-cells/src/emulator.rs:445` a CSI's parameter bytes grow without a cap (an OSC is capped at
  1 MiB at `:492`).
- `crates/deep-canvas-motion/src/doc.rs:110-112` a `quantize` modifier whose span gives one step with
  `jump: none` computes `0 / 0`; the NaN casts to 0, so the channel holds its first key. The keyed form refuses
  that pair (`doc.rs:778`).
- `crates/deep-canvas-motion/src/curve.rs:242` linear extrapolation reads `slope[c.min(3)]`, so a channel wider
  than four components extends components 4 and up with component 3's slope; `:287-288` `rate_into` holds four
  lanes, and a path key with `travel` writes past a 4-wide `out` (`travel.rs:116`) if a driver reads its rate
  (`program.rs:1965-1967`). Not traced to a document that passes check.
- `crates/deep-canvas-motion/src/held.rs:16-20`, `:160-167` a flip key's `t` written in beats or as an anchor
  cannot resolve (no tempo in the context) and the key is dropped without a refusal.
- `crates/deep-canvas-motion/src/tempo.rs:262` puts a sentence in a refusal's `path` field; its siblings put a path there.
- `crates/deep-canvas-motion/src/clock.rs:102` `while k * period <= to` never ends for `period <= 0`; the one
  caller (`deep-motion/src/main.rs:632-635`) refuses that first.
- `crates/deep-canvas-media/src/doc.rs:61` `link_value` is `pub` and used only inside the crate.
- `crates/deep-canvas-effects/src/interp.rs:46-48` `Image::at` on a zero-width image is `clamp(0, -1)`, a panic;
  not traced to a graph that passes check.

## Checked, no finding

- Cargo dependencies: every dependency of the nine crates is named in at least one source file of its crate
  (`taffy` in `layout.rs`, `unicode-normalization` in `code.rs`, `sha2` in `key.rs`/`terrain.rs`/`mix.rs`,
  `roxmltree` in `svg.rs`, `deep-canvas-scene3d` in media `module.rs`, `deep-text` in `deep-motion/src/main.rs`).
- `#[allow(...)]`: only `clippy::too_many_arguments` (5 sites) and `clippy::result_large_err` (effects
  `check.rs:7`, explained in its README). No `dead_code`, no `unused`.
- `HashMap`: only `implicit.rs:193`, `:251`, read by key and never iterated into output.
- `partial_cmp`: `pathops.rs:1363` sorts values a `retain` just proved finite.
- Spring math (`spring.rs`): the three regimes, `integral` and `extremes` agree with the closed forms; `spring_of`
  (`doc.rs:818-848`) refuses the zero and negative cases each form divides by.
- Easing ends: `segment_into` returns the key's own value at `t == a.t`; `Bezier::solve` clamps `u` and bisects
  where the slope is under 1e-6; `Jump::progress` is guarded for keys by `doc.rs:778`.
- Timeline ends: spans carry no sign (`grammar/time.rs`, "a span has no sign"), a looping transport needs
  `span > 0` (`doc.rs:2049`), a placement's rate must be above 0 (`doc.rs:2658`), `repeat.count >= 1`, a
  quantize rate must divide a second; `div_euclid`/`rem_euclid` divisors I traced are all above 0.
- `tempo.rs`, `remap.rs`, `follow.rs`, `lag.rs`, `travel.rs`, `quat.rs`, `input.rs`: read in full, no finding
  beyond the nits.
- `Profile::width` with one point (`paint.rs:679`): the painter skips a sub-path under two points (P1 checked).
- `shots.rs:1213`, `:1465`, `arrange.rs:808-809`, `:839`, `pathops.rs:389`, `animator.rs:997-1018`: each clamp's
  bounds are ordered by construction.

## Coverage

| Files | How read |
|---|---|
| `deep-canvas-marks/src/scene.rs`, `data.rs`, `modules.rs` | in full by the part reader (appendix); tests skimmed |
| `deep-canvas-motion/src/curve.rs`, `spring.rs`, `clock.rs`, `lib.rs`, `eval.rs`, `tempo.rs`, `remap.rs`, `constraint.rs`, `follow.rs`, `lag.rs`, `modifier.rs`, `travel.rs`, `input.rs`, `quat.rs`, `held.rs` | in full |
| `deep-canvas-cells`: `emulator.rs`, `keys.rs`, `palette.rs`, `lib.rs`, `Cargo.toml`; `module.rs` from line 60 | in full |
| `deep-canvas-media`: every file | in full |
| `deep-canvas-sheet`: `lib.rs`, `main.rs`, `module.rs`, `Cargo.toml`, `README.md` | in full; `tests/cells.rs` test names only |
| `deep-motion`: `Cargo.toml`, `README.md`; `main.rs` | manifest and README in full; `main.rs` by search plus lines 486-504, 603-640 |
| `deep-canvas-motion/src/doc.rs`, `program.rs` | by search and the parse and evaluate sections the findings cite (doc.rs 95-140, 692-730, 812-850, 1290-1335, 1425-1445, 1560-1700, 2030-2060, 2190-2236, 2640-2700; program.rs 1500-1520, 1954-1970, 2284-2312, 2366-2465, 2562-2620, 2695-2725). **Not read end to end.** |
| `deep-canvas-motion/src/shots.rs`, `arrange.rs` | clamp, divide and cast sites only. **Not read end to end.** |
| `deep-canvas-motion/src/module.rs`, `morph.rs`, `canonical.rs`, `cue.rs`, `occurrence.rs`, `rows.rs`, `kit.rs`, `schedule.rs`, `insert.rs`, `blend.rs` | **not read**, beyond the area-wide searches (unwrap/expect/panic, clamp, float calls, `allow`, `HashMap`) |
| `deep-canvas-motion/tests/*` | not read (cut first, as the task allowed) |
| `deep-canvas-effects`: `fusion.rs` 300-345, `interp.rs` 20-150 and 1095-1145, `Cargo.toml`, README lint line | those lines; the rest (`check.rs`, `graph.rs`, `emit.rs`, `shipped.rs`, `module.rs`, `chrome_fx.rs`, `table.rs`, `fx.rs`, `dirt.rs`) **not read** beyond the area-wide searches. The interpreter-against-emitter comparison the task asked for was not done. |
| `deep-canvas-marks/src`: `animator.rs`, `drawn.rs`, `function.rs`, `functions.rs`, `implicit.rs`, `outline.rs`, `paint.rs`, `pathops.rs` | the lint sites, clamp sites and the functions the findings cite; **not read end to end** |
| `deep-canvas-marks/src`: `relations.rs`, `look.rs`, `print.rs`, `fx.rs`, `layout.rs`, `story.rs`, `check.rs`, `path.rs`, `finish.rs`, `outline_sources.rs`, `fields.rs`, `runs.rs`, `ends.rs`, `dirty.rs`, `terrain.rs`, `code.rs`, `key.rs`, `main.rs`, `lib.rs`, `looks/*.json`, README | **not read** beyond the area-wide searches. P1 notes `story.rs` `Periods::at` (about `:375`) panics on the same empty-rows input as P1-3. |
| `deep-canvas-vector`: `svg.rs` 186-200, 660-722 and its limits; `Cargo.toml` | those lines; `lower.rs`, `lib.rs`, `module.rs`, `outline_source.rs` and the rest of `svg.rs` **not read** |
| `deep-canvas-drawn` | **not read** beyond the area-wide searches and the dependency check |

Not done at all: a `pub`-item sweep for unused exports (I sampled 19 names; one hit, RCM-16), README checks for
marks, motion, effects, vector, drawn and cells, and the duplicate-helper comparison across crates.

---

# Appendix: part P1 (scene.rs, data.rs, modules.rs), as its reader wrote it

Ranked worst first.

---

### P1-1  A `series@1` with no rows and `window: {last: n}` panics (index out of bounds)
- kind: broken
- confidence: SURE
- where: `data.rs:1513-1527` (`series_window`); callers `data.rs:1437` (`decimated`, the line path, also
  `modules.rs:1143` and `crates/deep-marks-render/src/raster.rs:1644`, `:1663`) and `data.rs:1619` (candles)
- evidence:
  ```rust
  1514    let n = t.len();
  1520        Some(Value::Object(w)) => {
  1521            let last = w.get("last").and_then(Value::as_u64).unwrap_or(n as u64) as usize;
  1522            (t[n.saturating_sub(last.max(1))], t[n - 1])
  1523        }
  1524        None if n > 0 => (t[0], t[n - 1]),
  1525        _ => (0.0, 0.0),
  ```
  The `None` arm guards `n > 0`; the object arm does not. `series_len` (`:1477-1486`) accepts `len: 0`, and
  `column_of` decodes an empty column. The candle path shows an empty series is expected
  (`:1616 if n == 0 && p.get("window").is_none() { return Ok(Vec::new()); }`) but lets `n == 0` with a window
  through to `series_window`. The design names the form: `docs/canvas-primitives.md:2255`
  "View: `window: [t0, t1] | last n`". `series@1`'s params are untyped JSON in the core
  (`crates/deep-canvas/src/kinds.rs:331-368`), so nothing refuses it earlier.
- failure: `{"kind":"series@1","params":{"t":{"dtype":"i64","len":0,"data":""},"v":{"dtype":"f32","len":0,"data":""},
  "window":{"last":100},"box":[0,0,300,60]}}` (an append-only series before its first row): `t[0]` on an empty
  slice panics in the `decimate` operator, in `scene::build` and in raster. With candles the same.
- fix: `data.rs:1520`
  old: `        Some(Value::Object(w)) => {`
  new: `        Some(Value::Object(w)) if n > 0 => {`
  (an empty series then takes the last arm, `(0.0, 0.0)`, as an empty series with no window already does).
- verify: a unit test beside `data.rs` tests: `decimated("s", &json!({"params": {"t": {"dtype":"i64","len":0,"data":""},
  "v": {"dtype":"f32","len":0,"data":""}, "window": {"last": 5}, "box": [0,0,3,60]}}), Decimate::M4)` panics
  before, returns `Ok` with empty columns after. No existing test covers it.
- risk: none for `n > 0`. No test under `tests/acceptance/397` or `399` uses `last` (grep `last` over both).

### P1-2  A log scale whose domain reaches 0 or below loops 2,147,483,651 times, or maps every row to NaN
- kind: broken
- confidence: SURE (the bug); LIKELY (which code the refusal should carry)
- where: `data.rs:451-468` (`Scale::read`), `:281-286` (`nice_of`), `:579-591` (`decades`), `:496-504` (`unit`);
  reached from `modules.rs:1203-1215` (`scale` operator calls `s.ticks()`) and `data.rs:1894` (`axis`)
- evidence:
  ```rust
  451        let (mut domain, from) = match get("domain") {
  452            Some(_) => (pair("domain")?, None),
  455                    if zero || get("zero") == Some(&Value::Bool(true)) {
  456                        d = [d[0].min(0.0), d[1].max(0.0)];
  466        if domain[1] <= domain[0] {
  467            return refuse("out_of_range", format!("{path}/domain"));
  283        ScaleKind::Log => [
  284            ops::powi(10.0, ops::log10(domain[0]).floor() as i32),
  587        let first = match self.kind {
  588            ScaleKind::Log => ops::log10(lo).floor() as i32,
  591        for e in first..=reach {
  ```
  Only rows are held to `> 0` on a log scale (`:386-390`, `log_rows`). A written domain, or a column domain
  widened to zero (`zero: true`, or a bar or area through the scale), is not. `libm::log10(0.0)` is −∞;
  `(-inf).floor() as i32` saturates to `i32::MIN`; `powi(10, i32::MIN)` is 0, so the nice domain stays `[0, hi]`
  and `decades` runs `for e in -2147483648..=reach`. Checked with node: `Math.log10(0)` → `-Infinity`,
  `2-(-2147483648)+1` → `2147483651`. The design: "It can never: … put values ≤ 0 on a log scale"
  (`docs/canvas-primitives.md`, Scale and encode).
- failure:
  (a) `{"kind":"scale@1","params":{"type":"log","domain":[0,100],"range":[0,300]}}`: the `scale` operator's
  `s.ticks()` runs ~2.1 billion `powi` calls (tens of seconds), then returns ~326 ticks from 1e-323 up; every
  `unit(v)` is `(x − (−∞)) / (2 − (−∞))` = NaN.
  (b) a log scale with no written domain that an `axis@1` reads and a `bar` set encodes through: `column_domain`
  sets `zero`, the domain is `[0, hi]`, and an axis whose ID sorts before the set's hits the same loop before the
  set's own `bad_encode` (`:1060-1066`) is reached.
  (c) `"domain":[-5,100]`: with `nice` the lower end silently becomes 1 (`NaN as i32` is 0); with `"nice": false`
  every mapped value is NaN and the marks are drawn at NaN.
- fix: `data.rs:466`
  old: `        if domain[1] <= domain[0] {`
  new: `        if domain[1] <= domain[0] || (kind == ScaleKind::Log && domain[0] <= 0.0) {`
  and in the periods branch, after `:425` (`let domains: Vec<[f64; 2]> = …collect();`), add
  `if kind == ScaleKind::Log && domains.iter().any(|d| d[0] <= 0.0) { return refuse("out_of_range", format!("{path}/domain")); }`
  (lead's call: a bar through a column-domain log scale would then be refused at the scale as `out_of_range`
  instead of at the set as `bad_encode`, whichever is read first; to keep `bad_encode`, skip the zero widening
  when `kind == ScaleKind::Log` at `:455` and `:410-416` instead).
- verify: unit test: `scale_of("s", &json!({"params": {"type":"log","domain":[0,100],"range":[0,300]}}))` is
  `Err(out_of_range)` after; before, `.unwrap().ticks()` does not return in test time.
- risk: every log scale under `tests/` and the kit catalog writes a domain from 1 up
  (`tests/acceptance/167/refusals.test.ts:20` `[1, 100]`, `crates/deep-show/src/kit/catalog.json:41` `[1, 10]`,
  `data.rs:2185` `[2, 300]`). No test pins a refusal code for a bar on a log scale (grep `bad_encode` over
  `tests/acceptance`: none).

### P1-3  A mark set with periods and no rows panics where a scale follows it (`domain: "periods"`)
- kind: broken
- confidence: SURE for this site; the same input panics first in `story.rs` when the set is read before the scale (P3's file)
- where: `data.rs:424-430`; also `story.rs` `Periods::at` (`value: self.by[j]`, about `:375`) for the P3 reader
- evidence:
  ```rust
  425            let domains: Vec<[f64; 2]> = periods.domains(values).into_iter().map(shape).collect();
  426            let (period, fraction) = periods.span_at(at);
  427            let (a, b) = (
  428                domains[period],
  429                domains[(period + 1).min(domains.len() - 1)],
  ```
  `Periods::compile` (`story.rs:197-249`) accepts zero rows (`by`, `keys`, `table` all empty), `domains`
  (`story.rs:383-395`) then returns an empty list, `span_at` returns `(0, 0.0)` (`story.rs:183-187`), and
  `domains[0]` is out of bounds. `at_of` (`story.rs:586-590`) only refuses when `at` is not written.
- failure: a `marks@1` with `n: 0` (or whose rows are all hidden: every row in a column's `hide`, or every bound
  cell missing its reading, `data.rs:971-995` then `without_hidden`), `transforms: [{periods: {by, at: 2000}}]`,
  encoded through a scale with `"domain": "periods"`, and an axis or a set whose ID sorts before it reading that
  scale: `Scale::read` panics. `deep check` reaches the story-side panic too (`check.rs:415` → `data::rows` →
  `story::played` → `Periods::at`).
- fix: after `data.rs:425` add
  `if domains.is_empty() { return refuse("bad_scale", format!("{path}/domain")); }`
- verify: unit test with the `race_board` fixture's `bars` at `n: 0` and empty columns through `Scale::read`.
- risk: none for a set with rows. `story.rs` needs its own guard for the same input; this edit does not cover it.

### P1-4  `check` loops `n` times over a text mark set with a constant text, with no row limit
- kind: broken
- confidence: LIKELY
- where: `data.rs:1745`, `:1764-1771` (`numbers`); called per item from `check.rs:89`, before and apart from the
  row limit in `base_rows` (`data.rs:957-960`)
- evidence:
  ```rust
  1745            let n = rows.get("n").and_then(Value::as_u64).unwrap_or(0) as usize;
  1757                Some(v) => (String::new(), Some((Column::Const(v.clone()), None))),
  1764            let hidden: Vec<usize> = columns
  1771            for i in (0..n).filter(|i| !hidden.contains(i)) {
  ```
  `column_of` returns a `const` column before it looks at `n` (`:67-69`), so nothing ties `n` to data here.
  `base_rows` refuses `n > MAX_ROWS` (1,000,000) as `out_of_range`; `numbers` never asks it.
- failure: `{"kind":"marks@1","params":{"mark":"text","n":4000000000,"columns":{"text":{"const":"7"}}}}`: the
  check pushes four billion JSON objects (memory runs out) where the row limit should refuse the set. Also
  `hidden.contains` is a linear scan per row: a 1,000,000-row text set whose column view hides half its rows
  costs 5 × 10¹¹ compares in every check.
- fix: `data.rs:1745`
  old: `let n = rows.get("n").and_then(Value::as_u64).unwrap_or(0) as usize;`
  new: `let n = match rows.get("n").and_then(Value::as_u64) { Some(n) if n <= MAX_ROWS => n as usize, _ => return out };`
  and `:1764` `let hidden: Vec<usize>` → `let hidden: std::collections::BTreeSet<usize>` (the `.collect()` and
  `.contains(i)` stay as written).
- verify: `data::numbers` on the document above returns at once with an empty list; `story_issues` still names
  the set `out_of_range`.
- risk: a set with no `n` returned an empty list before (`0..0`) and still does. `tests/acceptance/397/honest.test.ts`
  reads the listed numbers of sets within the limit; unchanged.

### P1-5  Per-point `width` and `opacity` columns land at the wrong arc length on a path with more than one sub-path
- kind: broken
- confidence: LIKELY
- where: `scene.rs:2021-2040` (`anchor_lengths`), used by `columns` (`:2068-2087`); the reader of the lengths is
  `crates/deep-canvas-marks/src/paint.rs:672-688` (`Profile::width`) from `crates/deep-marks-vello/src/lib.rs:428-442`
- evidence:
  ```rust
  2025    at.push(0.0);
  2026    for sub in pathops::subs_of(verbs) {
  2027        for (i, seg) in sub.segs.iter().enumerate() {
  2029            s += seg.length();
  2030            if !closing {
  2031                at.push(s);
  2035    at.truncate(count);
  2036    while at.len() < count {
  2037        at.push(s);
  ```
  One entry is pushed for the first Move and one per segment. A later sub-path's Move is an anchor
  (`anchors_of`, `:1974-1982`) but gets no entry, so every anchor after it shifts one place and the tail is
  padded with the total. `subs_of` also drops a zero-length line (`pathops.rs:424 filter(|_| open && p != cur)`),
  which shifts the anchors after a repeated point the same way. The painter measures arc length across
  sub-paths without a reset (`deep-marks-vello/src/lib.rs:428 let mut at = 0.0;` outside the sub-path loop), so
  the second sub-path's first anchor belongs at the first sub-path's length.
- failure: `d: "M 0 0 L 10 0 M 0 5 L 10 5"`, `width: [1, 1, 8, 8]`: lengths come out `[0, 10, 20, 20]`, not
  `[0, 10, 10, 20]`. `Profile::width` then draws the second line growing from 1 to 8 along its length instead of 8
  throughout; with `[2, 4, 6, 8]` it runs 4 → 6 and never reaches 8.
- fix: walk the verbs, one entry per anchor (a sketch; needs one compile):
  ```rust
  fn anchor_lengths(verbs: &[Verb], count: usize) -> Vec<f64> {
      let mut at = Vec::with_capacity(count);
      let (mut s, mut cur) = (0.0, [0.0, 0.0]);
      for v in verbs {
          let seg = match *v {
              Verb::Move(p) => { cur = p; at.push(s); continue; }
              Verb::Line(p) => pathops::Seg::Line(cur, p),
              Verb::Quad(a, p) => pathops::Seg::Quad(cur, a, p),
              Verb::Cubic(a, b, p) => pathops::Seg::Cubic(cur, a, b, p),
              Verb::Close => continue,
          };
          s += seg.length();
          cur = seg.end();
          at.push(s);
      }
      at
  }
  ```
  For one open or closed sub-path with no repeated point this gives the list the current code gives (I traced
  `M L L`, `M L L Z` and `M a L b L c L a Z`). Whether a Close's closing length should advance `s` for the next
  sub-path depends on how the painter's points list a closed sub-path; not traced.
- verify: `tests/acceptance/160/columns.test.ts` and `taper.test.ts` (single sub-path) must stay green; a new unit
  test on the two-line path above.
- risk: no test pins a column on a multi-sub-path path (grep over `tests/acceptance/160`). The `path` surface's
  digest feeds the lengths (`scene.rs:1952-1954`), so keys of such paths move.

### P1-6  A series' `box` width sets an allocation with no bound
- kind: broken
- confidence: LIKELY
- where: `data.rs:1436-1439` (`decimated`), `:1620`, `:1630` (candles); `series_box` `:1503-1511`
- evidence:
  ```rust
  1438    let cols = bw.floor().max(1.0) as usize;
  1439    let mut columns: Vec<Vec<usize>> = vec![Vec::new(); cols];
  1630    let mut buckets: Vec<Option<[f64; 4]>> = vec![None; cols];
  ```
  `box` is untyped in the core (`crates/deep-canvas/src/kinds.rs:331-368`: every series param is
  `json_param(p, Value::Null)`), and `series_box` only asks for four numbers. Rect, circle and the test kinds
  bound their sizes at 100,000 u (`kinds.rs:314-315`, `:380-381`).
- failure: `"box": [0, 0, 1e13, 60]` asks for 2.4 × 10¹⁴ bytes of `Vec` headers; the allocation fails and the
  process aborts instead of refusing the item.
- fix: in `series_box`, `Some(b) => Ok(b),` → `Some(b) if (0.0..=100_000.0).contains(&b[2]) => Ok(b),` and the
  `None` arm → `_`. (The bound's value is the lead's call; 100,000 is what the other kinds use.)
- verify: `series(…)` with that box returns `bad_doc` at `…/params/box`.
- risk: a negative width was read as one column before and would now be refused; no fixture under
  `tests/acceptance/397` or `399` has one (their boxes are `[0, 0, w, h]` from positive sizes, `399/helpers.ts:717`).

### P1-7  A mark set's dashed line has no dash limit, where a path's has 10,000
- kind: inconsistent (unbounded work on a document's numbers)
- confidence: LIKELY
- where: `data.rs:1145-1150`, `:1308-1310`, `:1332-1356` (`dashed`), `:2097-2103` (legend swatch); the rule at
  `scene.rs:1481-1482` and `:1776-1789`
- evidence:
  ```rust
  scene.rs:1481  /// The most dashes one path draws (Paint: "at most 10,000 dashes per path").
  data.rs:1150   .filter(|d| d.iter().sum::<f64>() > 0.0 && d.iter().all(|v| *v >= 0.0));
  data.rs:1340   while done < len {
  data.rs:1344       d.push_str(&format!("M {} {} L {} {} ", p[0], p[1], q[0], q[1]));
  ```
  A path's `dash: {count}` is refused past 10,000; a mark set's `dash: [on, off]` is only required to sum above 0.
- failure: `"paint": {"stroke": {"dash": [1e-6, 1e-6]}}` on a line set 500 u long: 2.5 × 10⁸ dashes, each a
  formatted sub-path of about 40 bytes, then `path::parse` over the 10 GB string. The legend's 16 u swatch
  (`:2103`) does 8 × 10⁶ of them for the same set.
- fix (lead's call on the code): in `mark_set` before `dashed` is called, refuse
  `out_of_range` at `{path}/paint/stroke/dash` when the line's length over the dash list's sum, times the list's
  on-entries, passes 10,000; count with the same loop shape as `dashed`. No one-line edit.
- verify: `data.rs` test `a_scale_from_categories_to_roles_draws_its_legend_with_each_series_line` (dash `[6, 4]`
  over 480 u, 48 dashes) stays green.
- risk: low; sets with ordinary dashes are far under the limit.

### P1-8  Stepped fill `by: key` sorts rows with a comparator that is not a total order
- kind: broken
- confidence: LIKELY
- where: `data.rs:1098-1104`
- evidence:
  ```rust
  1099                let num = |k: &str| k.parse::<f64>().ok();
  1100                rank.sort_by(|a, b| match (num(&keys[*a]), num(&keys[*b])) {
  1101                    (Some(x), Some(y)) => x.total_cmp(&y),
  1102                    _ => keys[*a].cmp(&keys[*b]),
  1103                });
  ```
- failure: keys `"10"`, `"9"`, `"5a"`: `"9" < "10"` (numbers), `"10" < "5a"` and `"5a" < "9"` (strings): a cycle.
  The rows' colors then depend on the sort's internals, and `slice::sort_by` may panic on a comparator that is
  not a total order (documented since Rust 1.81; the workspace is on 1.99).
- fix:
  ```rust
  rank.sort_by(|a, b| match (num(&keys[*a]), num(&keys[*b])) {
      (Some(x), Some(y)) => x.total_cmp(&y).then_with(|| keys[*a].cmp(&keys[*b])),
      (Some(_), None) => std::cmp::Ordering::Less,
      (None, Some(_)) => std::cmp::Ordering::Greater,
      (None, None) => keys[*a].cmp(&keys[*b]),
  });
  ```
- verify: unit test: keys `["10", "9", "5a"]` rank as 9, 10, 5a.
- risk: all-numeric and all-text key sets order as before (keys are unique, so the added tie-break only
  separates `"1"` from `"1.0"`). Mixed sets change order; none is pinned: the one `by: key` under `tests/` and
  `crates/` is `tests/acceptance/1162/fixtures/piece.json:214`, a set with no key column, so its keys are the
  row numbers (grep `by: 'key'|"by": "key"`).

### P1-9  The `frame` operator formats anchor-reading texts in the document's locale, not the view's
- kind: inconsistent
- confidence: LIKELY
- where: `modules.rs:1987-1995` against `modules.rs:411-427` (`counter`), `:1446-1462` (the `frame` operator's
  reads), `crates/deep-canvas/src/schedule/mod.rs:1261-1270` (`default_view`) and
  `crates/deep-show/src/frames.rs:753-757` (a call's `locale` over it)
- evidence:
  ```rust
  1987    // A text on a mark set's anchor reads rows its own operator doesn't see.
  1988    let locale = doc.get("locale").and_then(Value::as_str).unwrap_or("en");
  1989    for (id, item) in items.iter().filter(|(_, i)| scene::reads_anchor(i)) {
  1991            scene::text_at(doc, &items, id, item, &record, locale).map_err(refused)?
  1993            bound.insert(id.clone(), shown);
  ```
  `counter` formats with `v.locale()?` (the view's). `frame` declares no `view(locale)` read and overwrites the
  counter's text for every item that reads an anchor. #387.f71bf834 asks that every operator that formats
  numbers change with the view's locale (`tests/acceptance/387/view.test.ts:1-3`).
- failure: a document with no `locale`, shown with `view: {locale: "de"}`, holding a counter on a bound value and a
  counter on `items/<set>#head/<column>` at 1234.5: the first shows `1.234,5`, the second `1,234.5`.
- fix: add `"view(locale)"` to the `frame` operator's reads (`modules.rs:1449-1460`) and replace `:1988` with
  `let locale = v.locale()?;` (take it before `doc` is re-bound at `:1986`).
- verify: `tests/acceptance/387/view.test.ts` (the operators whose keys move with the locale) and
  `tests/acceptance/167/counter.test.ts`; a `de` view of the `race` fixture with a decimal anchor.
- risk: QUESTION-grade: a new read changes the `frame` node's key under a locale flip and may change the
  registry's interface digest; 387's node lists may pin either. Needs the 387 suite.

### P1-10  `laid_out` walks parents with no bound; every other parent walk in the file is bounded against a cycle
- kind: broken (hang only on a document the core check refuses)
- confidence: LIKELY
- where: `scene.rs:3975-3987`; the bounded siblings: `:2615` (`boxes_of`), `:3603` (`is_under`), `:3721`
  (`scopes_of`: "bounded so a cycle the check refuses can't spin"), `:4351` (`ancestors`), `modules.rs:1609`
- evidence:
  ```rust
  3980        let mut up = parent_of(id);
  3981        let by = loop {
  3982            match up {
  3983                None => break None,
  3984                Some(p) if moved.contains_key(p) => break moved.get(p).copied(),
  3985                Some(p) => up = parent_of(p),
  ```
- failure: items `a` (parent `b`) and `b` (parent `a`) beside a frame with `layout`, reaching `scene::frame`,
  `item_boxes` or `laid_out_boxes` without the core check (the proof surfaces take a document as given): the loop
  never ends. `layout::solve` does not refuse it first: it builds only from frames that lay out and their
  children (`layout.rs:641-650`, `:166-168`), so a cycle of items outside those frames is never visited.
- fix: `:3981`
  old: `        let by = loop {` … `        };`
  new:
  ```rust
          let mut by = None;
          for _ in 0..=items.len() {
              match up {
                  None => break,
                  Some(p) if moved.contains_key(p) => {
                      by = moved.get(p).copied();
                      break;
                  }
                  Some(p) => up = parent_of(p),
              }
          }
  ```
- verify: `tests/acceptance/375`, `1162` unchanged (acyclic); a unit test with the two-item cycle returns.
- risk: none for an acyclic tree (a chain is never longer than the item count).

### P1-11  Two refusal help texts list fewer values than the code and the design accept
- kind: inconsistent
- confidence: SURE
- where: `modules.rs:354-359` against `scene.rs:2740`; `modules.rs:1579-1584` against `data.rs:1858-1867`;
  `scene.rs:2627` (doc comment)
- evidence:
  ```rust
  modules.rs:357   "Use the notation fixed, compact, percent or duration.",
  scene.rs:2740    Some("clock") => Notation::Clock,
  modules.rs:1582  "Name the axis's scale, and a side of bottom, top, left or right.",
  data.rs:1859     "zero" => Some(cross_zero(scale_id, items, &format!("{path}/side"))?),
  scene.rs:2627    /// A format's notation (Bound value: `fixed | compact | percent | duration`).
  ```
  Design: `docs/canvas-primitives.md:2166` "notation: fixed | compact | percent | duration | clock" and the Scale
  section "Axis `side` may be `zero`".
- failure: a person who writes `notation: "engineering"` or `side: "middle"` is told a list that leaves out a value
  that works.
- fix: `modules.rs:357` → `"Use the notation fixed, compact, percent, duration or clock.",`;
  `modules.rs:1582` → `"Name the axis's scale, and a side of bottom, top, left, right or zero.",`;
  `scene.rs:2627` → ``/// A format's notation (Bound value: `fixed | compact | percent | duration | clock`).``
- verify: `rg -n 'Use the notation fixed|side of bottom' .` finds only `modules.rs` (checked: one hit each), so
  no test or catalog pins the old strings.
- risk: if a generated code catalog copies these texts, it regenerates (none found by the grep above).

### P1-12  `base_of`'s doc comment sits on `set_role`
- kind: inconsistent
- confidence: SURE
- where: `data.rs:786-798` (moved by e1a73286, #505, which inserted `set_role` under the comment)
- evidence:
  ```rust
  786  /// A bar's or an area's base: its y scale's zero, else 0.
  787  /// #505: row `i`'s role where the set names its `roles` and has a `role` column: the column's
  790  fn set_role<'a>(p: &'a Map<String, Value>, rows: &Rows, i: usize) -> Option<&'a str> {
  798  fn base_of(props: &Props) -> f64 {
  ```
- failure: `set_role`'s doc opens with another function's sentence; `base_of` has none.
- fix: delete line 786 and put `/// A bar's or an area's base: its y scale's zero, else 0.` directly above
  `fn base_of` (`:798`).
- verify: `git diff` shows a comment-only move.
- risk: none.

---

## Nits (one line each)

- `scene.rs:1783` `n * subpaths.max(1)`: `dash: {count: 18446744073709551615}` on a path with two sub-paths
  overflows; a dev build panics (overflow checks on), a release build wraps and is still refused by the `u16`
  conversion. `n.checked_mul(subpaths.max(1)).is_some_and(|d| (1..=MAX_DASHES).contains(&d))`.
- `scene.rs:5488` `rows += n` before the check at `:5493`: a second set with `n` near `u64::MAX` overflows in a
  dev build; `rows = rows.saturating_add(…)`.
- `data.rs:117` `n * width` with `n` unbounded from `column_domain` (`:213`), `legend` (`:2054`) and
  `scene.rs:2004`: same dev-build overflow at `n ≥ 2^61`; `n.checked_mul(width) != Some(bytes.len())`.
- `data.rs:1378-1388` `pixel_column`: `window: [-1e300, 1e300]` saturates both ends to `i128` limits and `t1 - t0`
  overflows (dev build panics; release wraps to a negative span and returns column 0).
- `data.rs:1517` a window entry that is not a number reads as 0 (`as_f64().unwrap_or(0.0)`) instead of `bad_doc`.
- `scene.rs:2862-2874` `duration`: 59.97 s shows `60 s` and 0.9996 s shows `1,000 ms` (`toFixed` check: `60.0`,
  `1000`); `compact` moves up a step on rounding (`:2845`), `duration` does not. `compact` itself leaves
  999.96 at precision 1 as `1,000.0`, since the step-up loop needs `pick > 0`.
- `scene.rs:4665-4667` `names("fill", ["dither", "dither"])` and `names("stroke", ["line", "line"])` repeat a key
  to fill a `[&str; 2]`; `names` could take `&[&str]`.
- `scene.rs:4269-4283` `Rank` derives `PartialEq` (`-0.0 == 0.0`) but orders by `total_cmp` (`-0.0 < 0.0`).
- `pub` wider than any user (grep of each name over `crates packages scripts tests benchmarks docs adapters
  packs` finds it only in its own file): `scene::base_verbs`, `scene::DATA_KINDS`, `data::pixel_column`,
  `data::Scale::faded_ticks`, `modules::LABEL_H`. Not dead: each is called in its file. No `#[allow(dead_code)]`,
  `#[allow(unused)]`, `HashMap` or `HashSet` in the three files (grep).
- `modules.rs:9-13` the module doc's list leaves out `look.finish@1` and the data module's `decimate` operator.

## Checked, no finding

- `View::changed("look.palette").is_none()` at `modules.rs:1816`: a document writer's change returns `None`
  (`crates/deep-canvas/src/schedule/view.rs:383-384`), so the fast path does bail on a palette change.
- `status.colors[state]` / `status.glyphs[state]` (`scene.rs:3408`, `:3434`, `modules.rs:696`, `:708`): both
  `Status` constructors fill every state of `look::STATES` (`look.rs:150-158`, `:731`).
- `Scale::lab` and `Scale::role` `roles.len() - 1`: `strings("range")` refuses an empty list (`data.rs:352-363`).
- `Profile::width`'s `clamp(1, pts.len() - 1)` with one point (`paint.rs:677-679`): the painter skips a
  sub-path of fewer than two points (`deep-marks-vello/src/lib.rs:430-432`), so a one-anchor path never calls it.
- Linear and time `ticks()` are capped at 1,001 (`data.rs:566`).
- Every other `sort_by` in the three files compares by `total_cmp`, strings or `Rank`.

## Coverage

| File | Read |
|---|---|
| `src/data.rs` (2431) | in full, lines 1–2156; tests 2157–2431 skimmed for what they pin |
| `src/modules.rs` (2053) | in full |
| `src/scene.rs` (6121) | in full, lines 1–5686; tests 5687–6121: names and the format test read, the rest skimmed |
| Read to check a claim, not owned | `story.rs` 48–64, 135–165, 180–400, 486–620; `pathops.rs` 407–455; `paint.rs` 661–704, 771–801; `check.rs` 77–111, 395–445; `look.rs` 118–172, 712–732; `crates/deep-canvas/src/kinds.rs` 250–420, `schedule/view.rs` 307–486, `schedule/mod.rs` 1255–1275, `ops.rs` 37–97; `crates/deep-marks-vello/src/lib.rs` 405–446; `crates/deep-show/src/frames.rs` 745–765 |
| Not read | `layout.rs` beyond its root and child lookup (lines 161–176, 641–650, for P1-10); the 387 suite's node lists (for P1-9); how a closed sub-path's points reach the painter (for P1-5's Close) |
