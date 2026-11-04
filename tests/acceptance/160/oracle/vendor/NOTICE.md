# Upstream files in this folder

Copied unchanged, at the commits the oracle map pins (`pins.json`), under the paths they have upstream. Only the
files the tests beside this folder read at run time or port cases from are here. Each keeps whatever license header
it carries upstream; the licenses below are the projects' own, as `pins.json` records them. No GPL file is copied:
Blender's union test, which the map links to criterion AC14, is GPL-2.0-or-later and is not here.

| Folder | Project | Commit | License | Upstream |
|---|---|---|---|---|
| `lottie-spec-4b55957472/` | lottie/lottie-spec | `4b55957472f8718e34e9c1298f0e8f021b6c597f` | CSL-1.0 (the specification), MIT (code) | https://github.com/lottie/lottie-spec/tree/4b55957472f8718e34e9c1298f0e8f021b6c597f |
| `lottie-web-bede03d25d/` | airbnb/lottie-web | `bede03d25d232826e0c9dca1733d542d8a7754fb` | MIT | https://github.com/airbnb/lottie-web/tree/bede03d25d232826e0c9dca1733d542d8a7754fb |
| `kurbo-9366cda80e/` | linebender/kurbo | `9366cda80ebb56f41e5d09509a89dbfe81bc4f5b` | Apache-2.0 OR MIT | https://github.com/linebender/kurbo/tree/9366cda80ebb56f41e5d09509a89dbfe81bc4f5b |
| `godot-ed1daf0bf0/` | godotengine/godot | `ed1daf0bf001b61586d9930840f2f1394092c079` | MIT | https://github.com/godotengine/godot/tree/ed1daf0bf001b61586d9930840f2f1394092c079 |
| `wpt-2f57f45d21/` | web-platform-tests/wpt | `2f57f45d21482f94b36123dfcec77ae7ab859bc1` | BSD-3-Clause | https://github.com/web-platform-tests/wpt/tree/2f57f45d21482f94b36123dfcec77ae7ab859bc1 |

The files, and how the tests use them:

- lottie-spec `docs/specs/shapes.md` (formula: the PolyStar, Ellipse and Rectangle constructions, Trim Path's
  window and offset, Rounded Corners, Pucker / Bloat), and `docs/static/examples/trim_path.json`,
  `rounded_corners.json` and `pucker_bloat.json` (read at run time by `lottie.test.ts`).
- lottie-web `player/js/utils/shapes/ZigZagModifier.js`, `RoundCornersModifier.js`, `PuckerAndBloatModifier.js` and
  `TrimModifier.js` (ported: their processPath constructions, and Trim's sequential order).
- kurbo `kurbo/src/cubicbez.rs`, `quadbez.rs`, `line.rs` (the arc-length tests' curves and values) and
  `bezpath.rs` (test_intersect_qad).
- Godot `tests/scene/test_path_follow_2d.cpp` and `tests/scene/test_curve_2d.cpp` (ported cases and values).
- WPT `css/compositing/isolation/isolation-establishes-stacking-context.html` and `css/CSS2/zindex/`
  `z-index-001.xht`, `z-index-005.xht`, `z-index-007.xht`, `z-index-010.xht`, `z-index-013.xht`,
  `z-index-stack-001.xht`, `z-index-stack-002.xht`, `z-index-abspos-001.xht`, `z-index-dynamic-001.xht` (ported
  documents).
