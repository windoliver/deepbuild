//! #2456: a glyph a write reveal is drawing, in the frames this crate draws, as `raster` draws it
//! (#1969; Text `text@1`: write mode).

use deep_canvas_marks::animated::Unit;
use deep_canvas_marks::scene::Rgb;
use vello_cpu::kurbo::{Affine, Cap};
use vello_cpu::{RenderContext, Resources};

use super::{color, scale_of};

/// `g`, its pen at `pen` in the frame `at` draws, while a write draws it by its unit: its fill as
/// far as it has come in, under its outline drawn from its start in a hairline of its fill's paint
/// that fades as the fill comes in, the outline's ends square, as a pen set down on it; all at the
/// glyph's opacity.
pub(crate) fn glyph(
    ctx: &mut RenderContext,
    resources: &mut Resources,
    g: &deep_text::Glyph,
    (c, opacity): (Rgb, f64),
    (at, pen): (Affine, [f64; 2]),
    [_, _, drawn, filled]: Unit,
) {
    let faded = opacity < 1.0;
    if faded {
        ctx.push_opacity_layer(opacity.max(0.0) as f32);
    }
    let pen = at * Affine::translate((pen[0], pen[1]));
    ctx.set_transform(pen);
    if filled > 0.0 {
        ctx.push_opacity_layer(filled as f32);
        ctx.set_paint(color(c));
        let one = std::iter::once(vello_cpu::Glyph {
            id: g.id,
            x: 0.0,
            y: 0.0,
        });
        let _ = ctx
            .glyph_run(resources, &g.font)
            .font_size(g.size)
            .hint(false)
            .glyph_transform(deep_text::atlas::slant(g.skew))
            .normalized_coords(&g.coords)
            .fill_glyphs(one);
        ctx.pop_layer();
    }
    let outline = deep_canvas_marks::animator::drawn_outline(g, drawn);
    if !outline.is_empty() {
        ctx.push_opacity_layer((1.0 - filled) as f32);
        ctx.set_paint(color(c));
        ctx.set_stroke(deep_marks_vello::stroke(1.0).with_caps(Cap::Square));
        ctx.stroke_path(&deep_marks_vello::bez(&outline, [0.0, 0.0], scale_of(pen)));
        ctx.pop_layer();
    }
    if faded {
        ctx.pop_layer();
    }
}
