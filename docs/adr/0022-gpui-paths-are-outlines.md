# 0022: GPUI paths are outlines

Status: accepted (#3502). From gpui-pre 0.3.11 a GPUI path is an outline that GPUI fills by its winding at each pixel; before, it was a list of triangles drawn under multisampling. The carried-patch table, `vendor/gpui-pre-apple/upstream/README.md`, lists what the vendored trees carry. The decisions below are how the app's own crates hand their geometry to an outline.

## Marks

- **A mesh goes as its triangles, each a closed contour wound one way, filled by the nonzero rule.** `crates/deep-marks-gpui/src/lib.rs`, `path` and `contour`. Contours wound one way fill their union, so the edges two triangles share cancel and the outer edges take GPUI's own coverage. A triangle that encloses no area adds nothing, and a mesh with no other triangle gives no path.
- **A stroke's strip is painted only inside the stroke's edge.** `crates/deep-marks-gpui/src/lib.rs`, `paint_strip` and `inside_edge`. Each corner of a strip holds its distance inside the nearer edge (#140, criterion 6): above 0 inside the stroke, 0 on its edge, below 0 past it. The distance runs evenly over a triangle, so the cut where it is 0 is a straight line, taken from the corner inside to the one past the edge so that two triangles sharing a side cut it at one point. GPUI takes the edge's coverage from the winding.
- **A strip still reaches past the edge.** `crates/deep-marks-gpui/src/lib.rs`, `FRINGE_PX`. Nothing paints the reach now. It is kept so that a strip's corners, and the cache entries in `deep-marks-render` that hold them, are what they were.

## Text

- **A large glyph is its outline's rings, filled.** `crates/deep-text-gpui/src/lib.rs`, `rings` and `outline`. A glyph past the atlas's size was triangles with an edge band for coverage; it is now the rings of its outline, and the band is gone, since GPUI covers an outline's edge by itself.
