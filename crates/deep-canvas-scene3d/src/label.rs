//! A label's coverage mask (canvas primitives: Marks in 3D: "text is shaped once per string"):
//! the string shaped by the one shaper and rasterized once at a fixed em, white on nothing, so
//! the GPU layer draws it as a textured quad in any size space and facing.

use deep_text::{Role, Shaper, Spec};
use vello_cpu::color::{AlphaColor, Srgb};
use vello_cpu::kurbo::Affine;
use vello_cpu::{Level, Pixmap, RenderContext, RenderSettings, Resources};

/// Pixels per em the mask is drawn at.
pub const EM_PX: f32 = 64.0;
/// Clear pixels around the ink, so sampling at the quad's edge reads nothing.
const PAD: u32 = 4;

/// One label's coverage, row-major from the top left, and its size in ems.
#[derive(Clone, Debug, PartialEq)]
pub struct Mask {
    pub width: u32,
    pub height: u32,
    pub alpha: Vec<u8>,
}

impl Mask {
    /// The quad's width and height in ems.
    pub fn ems(&self) -> [f64; 2] {
        [
            f64::from(self.width) / f64::from(EM_PX),
            f64::from(self.height) / f64::from(EM_PX),
        ]
    }
}

/// Shapes `text` in `role` and rasterizes its coverage.
pub fn mask(shaper: &mut Shaper, resources: &mut Resources, text: &str, role: Role) -> Mask {
    let spec = Spec {
        role,
        size: EM_PX,
        ..Spec::label(text)
    };
    let shaped = shaper.shape(&spec);
    let width = (shaped.width.ceil() as u32).max(1) + 2 * PAD;
    let height = (spec.line_height().ceil() as u32).max(1) + 2 * PAD;
    let settings = RenderSettings {
        level: Level::fallback(),
        num_threads: 0,
    };
    let (w16, h16) = (width.min(8192) as u16, height.min(8192) as u16);
    let mut ctx = RenderContext::new_with(w16, h16, settings);
    ctx.set_paint(AlphaColor::<Srgb>::from_rgba8(255, 255, 255, 255));
    ctx.set_transform(Affine::translate((f64::from(PAD), f64::from(PAD))));
    let mut start = 0;
    while start < shaped.glyphs.len() {
        let first = &shaped.glyphs[start];
        let run = shaped.glyphs[start..]
            .iter()
            .take_while(|g| {
                g.font.data.id() == first.font.data.id()
                    && g.font.index == first.font.index
                    && g.size == first.size
            })
            .count();
        let glyphs = shaped.glyphs[start..start + run]
            .iter()
            .map(|g| vello_cpu::Glyph {
                id: g.id,
                x: g.x,
                y: g.y,
            });
        let _ = ctx
            .glyph_run(resources, &first.font)
            .font_size(first.size)
            .hint(false)
            .fill_glyphs(glyphs);
        start += run;
    }
    ctx.flush();
    let mut pixmap = Pixmap::new(w16, h16);
    ctx.render(&mut pixmap, resources);
    let rgba = pixmap.take_rgba8(vello_cpu::peniko::ImageAlphaType::AlphaPremultiplied);
    Mask {
        width: u32::from(w16),
        height: u32::from(h16),
        alpha: rgba.as_chunks::<4>().0.iter().map(|p| p[3]).collect(),
    }
}
