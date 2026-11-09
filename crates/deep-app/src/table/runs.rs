//! Issue #1477: the table's run cache. A shaped line is kept by its text, its role and its size, so a row scrolled
//! back into view draws without shaping again. It holds at most `max(2 × visible cells, 8,192)` lines, each tagged
//! with the last frame that drew it; past the bound the lines no recent frame drew go first. A scale change clears
//! it, since every line was shaped for the old scale. Its bytes are counted, for #1431's gauges.

use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use gpui_kit::{Pixels, ShapedLine, SharedString, TextRun, Window};

/// The cache's floor: 1,000 rows of 8 columns is 8,000 lines, so a scroll down 1,000 rows and back shapes none.
pub const FLOOR: usize = 8_192;

struct Line {
    text: SharedString,
    role: u8,
    size: u32,
    line: ShapedLine,
    frame: u64,
}

#[derive(Default)]
pub struct RunCache {
    lines: HashMap<u64, Line>,
    frame: u64,
    scale: f32,
    bound: usize,
    shaped: u64,
    bytes: usize,
}

fn hash(text: &str, role: u8, size: u32) -> u64 {
    let mut h = std::collections::hash_map::DefaultHasher::new();
    text.hash(&mut h);
    role.hash(&mut h);
    size.hash(&mut h);
    h.finish()
}

impl RunCache {
    /// Starts a frame that shows `visible` cells at `scale`.
    pub fn frame(&mut self, visible: usize, scale: f32) {
        if scale != self.scale {
            self.lines.clear();
            self.bytes = 0;
            self.scale = scale;
        }
        self.frame += 1;
        self.bound = visible.saturating_mul(2).max(FLOOR);
    }

    /// The line for `text` in `role` at `size`, shaped only when the cache doesn't hold it.
    pub fn line(
        &mut self,
        text: &str,
        role: u8,
        size: Pixels,
        run: &TextRun,
        window: &mut Window,
    ) -> &ShapedLine {
        let size_bits = f32::from(size).to_bits();
        let key = hash(text, role, size_bits);
        let hit = self
            .lines
            .get(&key)
            .is_some_and(|l| l.role == role && l.size == size_bits && l.text.as_ref() == text);
        if !hit {
            if self.lines.len() >= self.bound {
                self.evict();
            }
            let text = SharedString::from(text.to_owned());
            let mut run = run.clone();
            run.len = text.len();
            let line = window
                .text_system()
                .shape_line(text.clone(), size, &[run], None);
            self.shaped += 1;
            let bytes = Self::size_of(&text, &line);
            if let Some(old) = self.lines.insert(
                key,
                Line {
                    text,
                    role,
                    size: size_bits,
                    line,
                    frame: self.frame,
                },
            ) {
                self.bytes -= Self::size_of(&old.text, &old.line);
            }
            self.bytes += bytes;
        }
        let entry = self.lines.get_mut(&key).expect("just held");
        entry.frame = self.frame;
        &entry.line
    }

    fn size_of(text: &SharedString, line: &ShapedLine) -> usize {
        let glyphs: usize = line.runs.iter().map(|r| r.glyphs.len()).sum();
        std::mem::size_of::<Line>() + text.len() + glyphs * 32
    }

    /// Drops the lines no frame drew longest, down to 7/8 of the bound; this frame's lines stay.
    fn evict(&mut self) {
        let target = self.bound - self.bound / 8;
        let mut ages: Vec<(u64, u64)> = self
            .lines
            .iter()
            .filter(|(_, l)| l.frame < self.frame)
            .map(|(k, l)| (l.frame, *k))
            .collect();
        ages.sort_unstable();
        for (_, key) in ages
            .into_iter()
            .take(self.lines.len().saturating_sub(target))
        {
            if let Some(old) = self.lines.remove(&key) {
                self.bytes -= Self::size_of(&old.text, &old.line);
            }
        }
    }

    /// Lines shaped since the cache was made.
    pub fn shaped(&self) -> u64 {
        self.shaped
    }

    /// Lines held, and their bytes.
    pub fn held(&self) -> (usize, usize) {
        (self.lines.len(), self.bytes)
    }

    /// The bound in lines this frame.
    pub fn bound(&self) -> usize {
        self.bound
    }
}
