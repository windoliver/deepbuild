//! Issue #443: the glyph outlines of a shaped run, read by skrifa from the bundled face the shaper
//! set each glyph in, unscaled (integer font units), so a 3D title sets the same glyphs at the same
//! places as the same text in a 2D writer layer. Curves come back as they are, for the caller to
//! flatten.

use skrifa::instance::{LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::MetadataProvider;

use crate::shape::Shaped;

/// One path command of a glyph outline, in the run's logical pixels with y down.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Cmd {
    Move([f64; 2]),
    Line([f64; 2]),
    Quad([f64; 2], [f64; 2]),
    Cubic([f64; 2], [f64; 2], [f64; 2]),
    Close,
}

/// One glyph's outline: the grapheme it draws, its pen position and its commands.
#[derive(Clone, Debug, PartialEq)]
pub struct GlyphOutline {
    pub grapheme: String,
    pub origin: [f64; 2],
    pub cmds: Vec<Cmd>,
}

struct Pen {
    at: [f64; 2],
    k: f64,
    cmds: Vec<Cmd>,
}

impl Pen {
    fn p(&self, x: f32, y: f32) -> [f64; 2] {
        [
            self.at[0] + f64::from(x) * self.k,
            self.at[1] - f64::from(y) * self.k,
        ]
    }
}

impl OutlinePen for Pen {
    fn move_to(&mut self, x: f32, y: f32) {
        let p = self.p(x, y);
        self.cmds.push(Cmd::Move(p));
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let p = self.p(x, y);
        self.cmds.push(Cmd::Line(p));
    }
    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        let (c, p) = (self.p(cx0, cy0), self.p(x, y));
        self.cmds.push(Cmd::Quad(c, p));
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        let (a, b, p) = (self.p(cx0, cy0), self.p(cx1, cy1), self.p(x, y));
        self.cmds.push(Cmd::Cubic(a, b, p));
    }
    fn close(&mut self) {
        self.cmds.push(Cmd::Close);
    }
}

/// Every glyph of `run` with its outline, in logical pixels with y down from the first baseline;
/// a glyph with no outline (a space) is left out.
pub fn glyph_outlines(run: &Shaped) -> Vec<GlyphOutline> {
    let starts = crate::unicode::grapheme_starts(&run.shown);
    let grapheme = |k: usize| -> String {
        let a = starts.get(k).copied().unwrap_or(run.shown.len());
        let b = starts.get(k + 1).copied().unwrap_or(run.shown.len());
        run.shown.get(a..b).unwrap_or_default().to_string()
    };
    let mut out = Vec::new();
    for g in &run.glyphs {
        let Ok(face) = skrifa::FontRef::from_index(g.font.data.data(), g.font.index) else {
            continue;
        };
        let upm = f64::from(
            face.metrics(Size::unscaled(), LocationRef::default())
                .units_per_em
                .max(1),
        );
        let Some(glyph) = face.outline_glyphs().get(skrifa::GlyphId::new(g.id)) else {
            continue;
        };
        let origin = [f64::from(g.x), f64::from(g.y)];
        let mut pen = Pen {
            at: origin,
            k: f64::from(g.size) / upm,
            cmds: Vec::new(),
        };
        let settings = DrawSettings::unhinted(Size::unscaled(), LocationRef::default());
        if glyph.draw(settings, &mut pen).is_ok() && !pen.cmds.is_empty() {
            out.push(GlyphOutline {
                grapheme: grapheme(g.grapheme),
                origin,
                cmds: pen.cmds,
            });
        }
    }
    out
}
