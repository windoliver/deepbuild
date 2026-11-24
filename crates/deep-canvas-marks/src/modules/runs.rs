//! The text module's canonical forms: a text spec and its shaped run as the scheduler hashes them.

use super::*;

impl Canonical for TextSpec {
    fn encode(&self, out: &mut Vec<u8>) {
        self.text.encode(out);
        self.font.encode(out);
        self.family.unwrap_or("").encode(out);
        self.fallback.len().encode(out);
        for family in &self.fallback {
            family.encode(out);
        }
        self.lang.as_deref().unwrap_or("").encode(out);
        self.size.encode(out);
        self.weight.encode(out);
        self.width.encode(out);
        self.max_lines.encode(out);
        self.mask.encode(out);
        (self.align as u8).encode(out);
        self.bound.encode(out);
        // #1964: a run with styled spans; one without encodes as it did before them.
        if !self.spans.is_empty() {
            format!("{:?}", self.spans).encode(out);
        }
        // #1215: a vertical text's columns; a horizontal one encodes as it did before them.
        if let deep_text::Flow::Vertical(c) = self.flow {
            (c.rl, c.upright, c.combine).encode(out);
            c.height.map(f64::from).encode(out);
            self.line_height.encode(out);
        }
    }
}

impl Canonical for Run {
    fn encode(&self, out: &mut Vec<u8>) {
        self.spec.encode(out);
        let s = &self.shaped;
        s.glyphs.len().encode(out);
        for g in &s.glyphs {
            (g.font.index, g.size, g.id, g.x, g.y, g.grapheme).encode(out);
            // #1215: a glyph a vertical run turns; an upright one encodes as before.
            if g.turn {
                true.encode(out);
            }
        }
        (s.width, s.height, s.lines, s.ellipsized).encode(out);
        s.shown.encode(out);
    }
}
