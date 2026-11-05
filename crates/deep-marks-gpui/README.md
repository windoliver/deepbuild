# deep-marks-gpui

## What it is for

The canvas's 2D marks where GPUI draws (#380): `stroke` tessellates a polyline through deep-canvas-marks, and `paint` paints a mesh's triangles as one GPUI path in one color. deep-app's session line and deep-canvas-render (crates/deep-marks-render) draw through it, so their paths use the canvas's primitives, never a view's own path.

## Where new code goes

- `src/lib.rs`: painting meshes deep-canvas-marks built, on GPUI.
- Tessellation and paint rules belong in deep-canvas-marks, not here.
- It has no tests of its own; the crates that draw with it read its pixels.

## What it may import

A thin GPUI adapter: deep-canvas-marks and gpui-kit (at its pinned git revision) only, each through its crate root. It never imports deep-app or another render crate.

## Deviations

None.
