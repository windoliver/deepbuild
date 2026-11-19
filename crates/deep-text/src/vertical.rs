//! Issue #1215: vertical flow (canvas primitives: Text `text@1`, `flow`). A vertical text is set
//! in columns top to bottom, running right to left (`vertical_rl`) or left to right
//! (`vertical_lr`) by the line height. Each grapheme stands by the Vertical_Orientation property
//! (UAX #50) of its first code point at the pinned Unicode version: `U` and `Tu` stand upright,
//! `R` and `Tr` turn 90° clockwise. Upright and `Tr` characters take the font's `vert`
//! substitution, so full-width punctuation and brackets take their vertical forms; a `Tr`
//! character the font has a vertical form for is drawn in that form, which is already turned, and
//! one it has none for is drawn turned. `upright: all` stands every glyph upright, with `vert`
//! applied. An upright glyph advances by its font's vertical advance (`vmtx`, or the em where the
//! font has none) and centers on the column's axis; a turned one advances by its own advance, its
//! em box centered on the axis. A run of at most `combine_upright` ASCII digits between non-digits
//! is set across one em of the column, centered on its axis and scaled to fit its width. Columns
//! break at UAX #14's opportunities, the ones horizontal text breaks at, when the next stretch
//! would pass the column's length, the box's height. The run stays the only source for layout,
//! hit tests, fit and drawing, as a horizontal run is.

use std::collections::BTreeSet;
use std::ops::Range;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

use icu_properties::props::VerticalOrientation;
use icu_properties::CodePointMapData;
use parley::{FontData, PositionedLayoutItem};
use parley_data::Properties;
use skrifa::raw::TableProvider;
use skrifa::{GlyphId, MetadataProvider};

use crate::shape::{Align, Glyph, Shaped, Shaper, Spec};
use crate::unicode::grapheme_starts;

/// `flow: horizontal | vertical_rl | vertical_lr = horizontal`, with a vertical flow's settings.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub enum Flow {
    #[default]
    Horizontal,
    Vertical(Columns),
}

/// A vertical flow's settings.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Columns {
    /// `vertical_rl`: the first column is the rightmost; `vertical_lr`: the leftmost.
    pub rl: bool,
    /// `upright: all`: every glyph stands upright, with `vert` applied.
    pub upright: bool,
    /// `combine_upright: u8 ≤ 4 = 2`: a run of at most this many ASCII digits is set across.
    pub combine: u8,
    /// `box.h`: the column's length, which columns break at and the fit check reads; `None` is
    /// auto, so only a hard break starts a column.
    pub height: Option<f32>,
}

impl Columns {
    /// `vertical_rl` (or `vertical_lr`) at the defaults: `upright: auto`, `combine_upright: 2`.
    pub fn new(rl: bool) -> Self {
        Columns {
            rl,
            upright: false,
            combine: 2,
            height: None,
        }
    }
}

/// How a glyph of a vertical run stands in its column.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stand {
    /// Upright, as the code charts draw it (`U`, `Tu`, and every glyph under `upright: all`).
    Upright,
    /// Turned 90° clockwise (`R`, `Tr`): drawn turned, or in the font's vertical form of a `Tr`
    /// character, which is the turned form.
    Turned,
    /// One of a run of digits set across the column (`combine_upright`).
    Across,
}

/// The wrong programs #1215's suite proves its tests fail on, each set only by the binaries'
/// `planted` inputs (canvas primitives: Text `text@1`, vertical flow).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// A vertical run laid out as horizontal text: one line across, glyph after glyph.
    pub horizontal: bool,
    /// No glyph ever turns: every grapheme stands upright.
    pub never_turns: bool,
    /// The font's `vert` substitution is never applied.
    pub skips_vert: bool,
}

static PLANTED: AtomicU8 = AtomicU8::new(0);

/// Sets the process's planted vertical shaper; its runs are cached apart from honest ones.
pub fn plant(p: Planted) {
    PLANTED.store(p.bits(), Ordering::Relaxed);
}

/// The planted vertical shaper this process runs, none unless a binary's input set one.
pub fn planted() -> Planted {
    let bits = PLANTED.load(Ordering::Relaxed);
    Planted {
        horizontal: bits & 1 != 0,
        never_turns: bits & 2 != 0,
        skips_vert: bits & 4 != 0,
    }
}

impl Planted {
    /// The plant as bits, for a cache that keys a run by it.
    pub fn bits(self) -> u8 {
        u8::from(self.horizontal) | u8::from(self.never_turns) << 1 | u8::from(self.skips_vert) << 2
    }
}

/// The Vertical_Orientation of `c` at the pinned Unicode version, as `U`, `R`, `Tu` or `Tr`.
fn orientation(c: char) -> &'static str {
    match CodePointMapData::<VerticalOrientation>::new().get(c) {
        VerticalOrientation::Upright => "U",
        VerticalOrientation::TransformedUpright => "Tu",
        VerticalOrientation::TransformedRotated => "Tr",
        _ => "R",
    }
}

/// How a grapheme is set, before shaping tells whether a `Tr` one has a vertical form.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    /// Upright, with `vert`.
    Upright,
    /// Turned, without `vert`.
    Turned,
    /// `Tr`: shaped with `vert`; upright in its vertical form if the font has one, else turned.
    Transformed,
    /// In a digit run set across: the run's index.
    Across(usize),
    /// A hard break or a control character: no glyph and no advance.
    Break,
}

/// One glyph as the horizontal shaping placed it, with its face and its grapheme.
struct Piece {
    grapheme: usize,
    font: FontData,
    size: f32,
    coords: Arc<[i16]>,
    skew: f32,
    id: u32,
    advance: f32,
    /// Its pen position in the paragraph's horizontal layout, and its offset off the baseline.
    x: f32,
    dy: f32,
}

/// A face's metrics a vertical run reads: units per em and its OS/2 typographic ascender and
/// descender (or hhea's), with its tables for its vertical metrics.
struct Face<'a> {
    font: skrifa::FontRef<'a>,
    upem: f32,
    ascent: f32,
    descent: f32,
}

impl<'a> Face<'a> {
    fn of(font: &'a FontData) -> Option<Face<'a>> {
        let font = skrifa::FontRef::from_index(font.data.data(), font.index).ok()?;
        let upem = f32::from(font.head().ok()?.units_per_em().max(1));
        let (ascent, descent) = match font.os2() {
            Ok(os2) if os2.s_typo_ascender() > 0 => (
                f32::from(os2.s_typo_ascender()),
                -f32::from(os2.s_typo_descender()),
            ),
            _ => {
                let hhea = font.hhea().ok()?;
                (
                    f32::from(hhea.ascender().to_i16()),
                    -f32::from(hhea.descender().to_i16()),
                )
            }
        };
        Some(Face {
            font,
            upem,
            ascent,
            descent,
        })
    }

    /// The distance from a turned glyph's baseline to its em box's middle, in em: where the
    /// baseline sits off the column's axis so the box centers on it.
    fn middle(&self) -> f32 {
        (self.ascent - self.descent) / 2. / self.upem
    }

    /// A glyph's vertical advance and the distance from the top of its cell down to its baseline,
    /// in em: from `vmtx` and `VORG` (its ascender where it has no `VORG`), or, where the font has
    /// no vertical metrics, the em with the em box centered in it.
    fn vertical(&self, id: u32) -> (f32, f32) {
        let gid = GlyphId::new(id);
        let Some(advance) = self.font.vmtx().ok().and_then(|v| v.advance(gid)) else {
            return (1., 0.5 + self.middle());
        };
        let top = self
            .font
            .vorg()
            .map_or(self.ascent, |v| f32::from(v.vertical_origin_y(gid)));
        (f32::from(advance) / self.upem, top / self.upem)
    }

    /// Whether `id` is `c`'s own glyph in the face, not a substitute.
    fn nominal(&self, c: char, id: u32) -> bool {
        self.font.charmap().map(c).map(GlyphId::to_u32) == Some(id)
    }
}

/// The byte ranges `text`'s graphemes span, by grapheme.
fn ranges(text: &str) -> Vec<Range<usize>> {
    let starts = grapheme_starts(text);
    starts
        .iter()
        .enumerate()
        .map(|(k, &a)| a..starts.get(k + 1).copied().unwrap_or(text.len()))
        .collect()
}

/// Each grapheme's mode: digit runs set across first, then by the orientation of its first code
/// point, or upright under `upright: all`.
fn modes(text: &str, graphemes: &[Range<usize>], cols: Columns, planted: Planted) -> Vec<Mode> {
    let digit = |r: &Range<usize>| {
        let g = &text[r.clone()];
        g.len() == 1 && g.as_bytes()[0].is_ascii_digit()
    };
    let by_orientation = |g: &Range<usize>| {
        let first = text[g.clone()].chars().next().unwrap_or(' ');
        if first.is_control() || Properties::get(first).is_mandatory_linebreak() {
            Mode::Break
        } else if cols.upright || planted.never_turns {
            Mode::Upright
        } else {
            match orientation(first) {
                "U" | "Tu" => Mode::Upright,
                "Tr" => Mode::Transformed,
                _ => Mode::Turned,
            }
        }
    };
    let mut modes = Vec::with_capacity(graphemes.len());
    let mut runs = 0;
    let mut k = 0;
    while k < graphemes.len() {
        // A whole run of digits: set across when it is short enough, else each by its own.
        let end = (k..graphemes.len())
            .find(|&j| !digit(&graphemes[j]))
            .unwrap_or(graphemes.len());
        if end > k {
            if end - k <= usize::from(cols.combine) {
                modes.extend((k..end).map(|_| Mode::Across(runs)));
                runs += 1;
            } else {
                modes.extend(graphemes[k..end].iter().map(by_orientation));
            }
            k = end;
            continue;
        }
        modes.push(by_orientation(&graphemes[k]));
        k += 1;
    }
    modes
}

/// Where a line may start, by grapheme: UAX #14's opportunities, as the horizontal layout breaks
/// at, and whether the break there is a hard one.
fn opportunities(text: &str, graphemes: &[Range<usize>]) -> Vec<Option<bool>> {
    let bytes: Vec<usize> = text.char_indices().map(|(b, _)| b).collect();
    let chars: Vec<char> = text.chars().collect();
    let soft: BTreeSet<usize> = crate::unicode::breaks(text)
        .into_iter()
        .filter_map(|k| bytes.get(k).copied())
        .collect();
    graphemes
        .iter()
        .map(|r| {
            if r.start == 0 || !soft.contains(&r.start) {
                return None;
            }
            let k = bytes.partition_point(|&b| b < r.start);
            let prev = chars[k - 1];
            let hard = Properties::get(prev).is_mandatory_linebreak()
                && !(prev == '\r' && chars.get(k) == Some(&'\n'));
            Some(hard)
        })
        .collect()
}

impl Shaper {
    /// `text` set in columns as `cols` says: shaped once by the one shaper (with `vert` on the
    /// graphemes that stand upright), its columns broken at UAX #14's opportunities, every glyph
    /// placed in its column.
    pub(crate) fn columns(&mut self, spec: &Spec<'_>, text: &str, cols: Columns) -> Shaped {
        let planted = planted();
        let graphemes = ranges(text);
        let modes = modes(text, &graphemes, cols, planted);
        // The stretches shaped with `vert`: the graphemes that stand upright or may take a
        // vertical form, adjacent ones joined.
        let mut upright: Vec<Range<usize>> = Vec::new();
        for (r, _) in graphemes
            .iter()
            .zip(&modes)
            .filter(|(_, m)| matches!(m, Mode::Upright | Mode::Transformed))
        {
            match upright.last_mut() {
                Some(last) if last.end == r.start => last.end = r.end,
                _ => upright.push(r.clone()),
            }
        }
        let vert = if planted.skips_vert {
            &[][..]
        } else {
            &upright[..]
        };
        let layout = self.layout_with(spec, text, vert, false);
        // Every glyph, in the order of its grapheme, as the paragraph's one horizontal line
        // placed it.
        let starts: Vec<usize> = graphemes.iter().map(|r| r.start).collect();
        let grapheme = |byte: usize| starts.partition_point(|&s| s <= byte).saturating_sub(1);
        let mut pieces: Vec<Piece> = Vec::new();
        for line in layout.lines() {
            for item in line.items() {
                let PositionedLayoutItem::GlyphRun(run) = item else {
                    continue;
                };
                let font = run.run().font().clone();
                let size = run.run().font_size();
                let coords: Arc<[i16]> = run
                    .run()
                    .normalized_coords()
                    .iter()
                    .map(|c| c.to_bits())
                    .collect();
                let skew = run.run().synthesis().skew().unwrap_or(0.);
                let baseline = run.baseline();
                let clusters = run.run().visual_clusters().flat_map(|c| {
                    let first = c.text_range().start;
                    c.glyphs().map(move |_| first)
                });
                for (glyph, byte) in run.positioned_glyphs().zip(clusters) {
                    pieces.push(Piece {
                        grapheme: grapheme(byte),
                        font: font.clone(),
                        size,
                        coords: coords.clone(),
                        skew,
                        id: glyph.id,
                        advance: glyph.advance,
                        x: glyph.x,
                        dy: glyph.y - baseline,
                    });
                }
            }
        }
        pieces.sort_by_key(|p| p.grapheme);
        if planted.horizontal {
            return horizontal(spec, text, pieces);
        }
        // Each grapheme's glyphs, and how far it advances down its column.
        let mut of: Vec<Range<usize>> = vec![0..0; graphemes.len()];
        let mut at = 0;
        for (g, range) in of.iter_mut().enumerate() {
            let end = at + pieces[at..].iter().take_while(|p| p.grapheme == g).count();
            *range = at..end;
            at = end;
        }
        let first_char = |g: usize| text[graphemes[g].clone()].chars().next().unwrap_or(' ');
        let mut stands: Vec<Stand> = Vec::with_capacity(graphemes.len());
        let mut turn: Vec<bool> = Vec::with_capacity(graphemes.len());
        let mut along: Vec<f32> = vec![0.; graphemes.len()];
        for g in 0..graphemes.len() {
            let glyphs = &pieces[of[g].clone()];
            let (stand, turned) = match modes[g] {
                Mode::Upright => (Stand::Upright, false),
                // A break or a control character draws nothing; it stands as its property says.
                Mode::Break => match orientation(first_char(g)) {
                    "U" | "Tu" => (Stand::Upright, false),
                    _ if cols.upright => (Stand::Upright, false),
                    _ => (Stand::Turned, false),
                },
                Mode::Turned => (Stand::Turned, true),
                Mode::Across(_) => (Stand::Across, false),
                // A vertical form is the turned form already; without one the glyph turns.
                Mode::Transformed => {
                    let formed = glyphs.first().is_some_and(|p| {
                        p.id != 0
                            && Face::of(&p.font).is_some_and(|f| !f.nominal(first_char(g), p.id))
                    });
                    (Stand::Turned, !formed)
                }
            };
            stands.push(stand);
            turn.push(turned);
            along[g] = match (modes[g], glyphs.first()) {
                (Mode::Break, _) | (_, None) => 0.,
                // A digit run takes one em, shared out below.
                (Mode::Across(_), Some(p)) => p.size,
                (_, Some(_)) if turned => glyphs.iter().map(|q| q.advance).sum::<f32>().max(0.),
                (_, Some(p)) => Face::of(&p.font).map_or(p.size, |f| f.vertical(p.id).0 * p.size),
            };
        }
        // A digit run's em is shared by its graphemes, so each caret within it has its place; its
        // glyphs all take the run's origin, the top of its cell.
        let mut g = 0;
        while g < graphemes.len() {
            if let Mode::Across(_) = modes[g] {
                let n = (g..graphemes.len())
                    .take_while(|&j| modes[j] == modes[g])
                    .count();
                let em = along[g];
                for share in &mut along[g..g + n] {
                    *share = em / n as f32;
                }
                g += n;
            } else {
                g += 1;
            }
        }
        // Columns: each stretch between two opportunities goes in the column it fits, or starts
        // the next; a hard break ends its column. White space at a column's end hangs.
        let limit = cols.height.filter(|_| !spec.bound);
        let breaks = opportunities(text, &graphemes);
        let blank = |g: usize| text[graphemes[g].clone()].chars().all(char::is_whitespace);
        // Each column: its graphemes and its length without the white space hanging at its end.
        let mut columns: Vec<(Range<usize>, f32)> = Vec::new();
        let (mut start, mut length, mut kept) = (0usize, 0f32, 0f32);
        let mut stretch = 0usize;
        for g in 1..=graphemes.len() {
            if g < graphemes.len() && breaks[g].is_none() {
                continue;
            }
            // The stretch [stretch, g), whole and without its trailing white space.
            let total: f32 = along[stretch..g].iter().sum();
            let inked = (stretch..g)
                .rev()
                .find(|&k| !blank(k))
                .map_or(stretch, |k| k + 1);
            let shown: f32 = along[stretch..inked].iter().sum();
            if stretch > start && limit.is_some_and(|h| length + shown > h + 0.01) {
                columns.push((start..stretch, kept));
                (start, length, kept) = (stretch, 0., 0.);
            }
            if inked > stretch {
                kept = length + shown;
            }
            length += total;
            stretch = g;
            if g < graphemes.len() && breaks[g] == Some(true) {
                columns.push((start..g, kept));
                (start, length, kept) = (g, 0., 0.);
            }
        }
        if start < graphemes.len() || columns.is_empty() {
            columns.push((start..graphemes.len(), kept));
        }
        let lh = spec.line_height();
        let extent = columns.len() as f32 * lh;
        let wide = spec.width.unwrap_or(extent);
        let tall = cols
            .height
            .unwrap_or_else(|| columns.iter().map(|(_, l)| *l).fold(0., f32::max));
        let mut glyphs: Vec<Glyph> = Vec::with_capacity(pieces.len());
        for (k, (range, length)) in columns.iter().enumerate() {
            let axis = if cols.rl {
                wide - lh * (k as f32 + 0.5)
            } else {
                lh * (k as f32 + 0.5)
            };
            let mut pen = match spec.align {
                Align::Start => 0.,
                Align::Center => (tall - length) / 2.,
                Align::End => tall - length,
            };
            let mut g = range.start;
            while g < range.end {
                let set = &pieces[of[g].clone()];
                let Some(base) = set.first() else {
                    pen += along[g];
                    g += 1;
                    continue;
                };
                let face = Face::of(&base.font);
                match stands[g] {
                    Stand::Across => {
                        // The whole digit run, one em of the column, scaled to fit its width.
                        let n = (g..range.end).take_while(|&j| modes[j] == modes[g]).count();
                        let run: Vec<&Piece> =
                            (g..g + n).flat_map(|j| &pieces[of[j].clone()]).collect();
                        let em = base.size;
                        let width: f32 = run.iter().map(|p| p.advance).sum();
                        let scale = if width > em { em / width } else { 1. };
                        let middle = face.as_ref().map_or(0.3, Face::middle);
                        let left = axis - width * scale / 2.;
                        let baseline = pen + em / 2. + middle * em * scale;
                        for p in &run {
                            glyphs.push(glyph_of(
                                p,
                                [left + (p.x - base.x) * scale, baseline + p.dy * scale],
                                p.size * scale,
                                (Stand::Across, false),
                                ([axis, pen], along[p.grapheme]),
                            ));
                        }
                        pen += along[g..g + n].iter().sum::<f32>();
                        g += n;
                        continue;
                    }
                    _ if turn[g] => {
                        let middle = face.as_ref().map_or(0.3, Face::middle) * base.size;
                        for (j, p) in set.iter().enumerate() {
                            let down = p.x - base.x;
                            glyphs.push(glyph_of(
                                p,
                                [axis - middle - p.dy, pen + down],
                                p.size,
                                (stands[g], true),
                                ([axis, pen], if j == 0 { along[g] } else { 0. }),
                            ));
                        }
                    }
                    _ => {
                        let top = face.as_ref().map_or(0.88, |f| f.vertical(base.id).1) * base.size;
                        for (j, p) in set.iter().enumerate() {
                            glyphs.push(glyph_of(
                                p,
                                [axis - base.advance / 2. + (p.x - base.x), pen + top + p.dy],
                                p.size,
                                (stands[g], false),
                                ([axis, pen], if j == 0 { along[g] } else { 0. }),
                            ));
                        }
                    }
                }
                pen += along[g];
                g += 1;
            }
        }
        Shaped {
            glyphs,
            decorations: Vec::new(),
            width: extent,
            height: columns.iter().map(|(_, l)| *l).fold(0., f32::max),
            lines: columns.len(),
            line_height: lh,
            gap: 0.,
            ellipsized: false,
            shown: text.to_owned(),
            flow: Flow::Vertical(cols),
        }
    }
}

/// A placed glyph of a vertical run: drawn from `at` (its baseline origin, turned about it when
/// `turned`), its advance starting at `origin` on its column's axis and running `along` down it.
fn glyph_of(
    p: &Piece,
    at: [f32; 2],
    size: f32,
    (stand, turned): (Stand, bool),
    (origin, along): ([f32; 2], f32),
) -> Glyph {
    Glyph {
        font: p.font.clone(),
        size,
        id: p.id,
        x: at[0],
        y: at[1],
        advance: p.advance * size / p.size.max(f32::MIN_POSITIVE),
        grapheme: p.grapheme,
        coords: p.coords.clone(),
        skew: p.skew,
        stand: Some(stand),
        turn: turned,
        origin,
        along,
    }
}

/// The planted wrong program's run: the vertical text laid out as one horizontal line, glyph
/// after glyph across, each upright.
fn horizontal(spec: &Spec<'_>, text: &str, pieces: Vec<Piece>) -> Shaped {
    let ascent = pieces.first().map_or(0., |p| p.size * 0.88);
    let mut width: f32 = 0.;
    let glyphs = pieces
        .iter()
        .map(|p| {
            width = width.max(p.x + p.advance);
            glyph_of(
                p,
                [p.x, ascent + p.dy],
                p.size,
                (Stand::Upright, false),
                ([p.x, 0.], p.advance),
            )
        })
        .collect();
    Shaped {
        glyphs,
        decorations: Vec::new(),
        width,
        height: spec.line_height(),
        lines: 1,
        line_height: spec.line_height(),
        gap: 0.,
        ellipsized: false,
        shown: text.to_owned(),
        flow: Flow::Horizontal,
    }
}
