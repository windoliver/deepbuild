//! Glyph runs (moved from raster.rs, #2360): the [`Glyphs`] trait and Vello CPU's impl of it.

use super::*;

/// What a painter draws glyphs on: Vello CPU's context with the drawing's resources, or Vello
/// GPU's scene with its own.
pub(crate) trait Glyphs: Canvas {
    /// `glyphs` of one face at `size`, slanted `skew` degrees (#1964: a faux italic) and (#1215)
    /// turned a quarter clockwise when a vertical run turns them, filled in the current paint as
    /// one glyph run.
    fn fill_run(
        &mut self,
        resources: &mut Resources,
        font: &FontData,
        size_skew: (f32, f32, bool),
        coords: &[i16],
        glyphs: &[vello_cpu::Glyph],
    );

    /// #496: a glyph's outline stroked `width` px wide in the current paint.
    fn glyph_stroke(
        &mut self,
        resources: &mut Resources,
        font: &FontData,
        size_skew: (f32, f32, bool),
        coords: &[i16],
        glyph: vello_cpu::Glyph,
        width: f64,
    );

    /// #496: opens a layer blurred by `radius` px, closed by `pop_layer`; false where this canvas
    /// can't blur, and nothing was opened.
    fn push_blur(&mut self, _radius: f32) -> bool {
        false
    }
}

impl Glyphs for RenderContext {
    fn fill_run(
        &mut self,
        resources: &mut Resources,
        font: &FontData,
        (size, skew, turn): (f32, f32, bool),
        coords: &[i16],
        glyphs: &[vello_cpu::Glyph],
    ) {
        let run = self.glyph_run(resources, font);
        let _ = run
            .font_size(size)
            .hint(false)
            .glyph_transform(deep_text::atlas::glyph_transform(skew, turn))
            .normalized_coords(coords)
            .fill_glyphs(glyphs.iter().copied());
    }

    fn glyph_stroke(
        &mut self,
        resources: &mut Resources,
        font: &FontData,
        (size, skew, turn): (f32, f32, bool),
        coords: &[i16],
        glyph: vello_cpu::Glyph,
        width: f64,
    ) {
        self.set_stroke(stroke(width));
        let run = self.glyph_run(resources, font);
        let _ = run
            .font_size(size)
            .hint(false)
            .glyph_transform(deep_text::atlas::glyph_transform(skew, turn))
            .normalized_coords(coords)
            .stroke_glyphs(std::iter::once(glyph));
    }

    fn push_blur(&mut self, radius: f32) -> bool {
        use vello_cpu::filter_effects::{Filter, FilterFunction};
        self.push_filter_layer(Filter::from_function(FilterFunction::Blur { radius }));
        true
    }
}
