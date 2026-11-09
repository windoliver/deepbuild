//! DeepBuild patch (windoliver/deepbuild#1550): chrome breaks a line only where the Unicode line
//! breaking rules (UAX #14, at Unicode 17.0.0) allow one, through the ICU segmenter `deep-text`
//! uses, instead of by an allow-list of word characters. So a Greek, Arabic, Hebrew or Devanagari
//! word stays whole and no line starts with a closing mark. gpui-pre 0.3.11 makes the same change
//! upstream on ICU's stable segmenter, which still runs 15.1's rules. Thai stays out (#1496): the
//! segmenter here has no dictionary, so it breaks Thai only where it breaks any other letters.
//!
//! A shaped line wraps in text order: rows take the text's words in the order they are written,
//! and a line whose glyphs run out of text order (right-to-left text, a reordered vowel sign) has
//! each row laid out on its own, so a row reads as its own line would.

use super::{LineFragment, LineWrapper};
use crate::{FontRun, LineLayout, Pixels, PlatformTextSystem, WrapBoundary, point, px};
use icu_segmenter::{GraphemeClusterSegmenter, LineSegmenter};
use smallvec::SmallVec;
use std::{iter::Peekable, sync::Arc, vec::IntoIter};

/// The byte offsets inside `text` at which a line may start, in order.
fn line_starts(text: &str) -> Vec<usize> {
    LineSegmenter::new_neo_for_non_complex_scripts(Default::default())
        .segment_str(text)
        .filter(|&at| at > 0 && at < text.len())
        .collect()
}

/// Where a line may start, asked in increasing byte order.
pub(crate) struct Breaks {
    starts: Peekable<IntoIter<usize>>,
}

impl Breaks {
    pub(crate) fn of(text: &str) -> Self {
        Self {
            starts: line_starts(text).into_iter().peekable(),
        }
    }

    /// The fragments as one text, an inline element standing in as letters so that it keeps to
    /// the word beside it, as upstream's wrapper does.
    pub(crate) fn of_fragments(fragments: &[LineFragment]) -> Self {
        let mut text = String::new();
        for fragment in fragments {
            match fragment {
                LineFragment::Text { text: part } => text.push_str(part),
                LineFragment::Element { len_utf8, .. } => {
                    text.extend(std::iter::repeat_n('a', *len_utf8))
                }
            }
        }
        Self::of(&text)
    }

    /// Whether a line may start at byte `ix`. Each call's `ix` is at least the last one's.
    pub(crate) fn allows(&mut self, ix: usize) -> bool {
        while self.starts.next_if(|&at| at < ix).is_some() {}
        self.starts.peek() == Some(&ix)
    }

    /// As `allows`, and a line that may start at `ix` counts the text as begun there, so leading
    /// white space can end a row of its own where the rules allow it (` ̈❗` starts a row at `̈`).
    pub(crate) fn allows_from(&mut self, ix: usize, first: &mut Option<usize>) -> bool {
        let allowed = self.allows(ix);
        if allowed {
            first.get_or_insert(ix);
        }
        allowed
    }
}

/// A run of text between two places a line may start, as the shaped line draws it.
struct Group {
    start: usize,
    width: Pixels,
    /// The width less its trailing white space, which may hang past a row's end.
    trimmed: Pixels,
    /// Its clusters, each its first byte and width, for a group too wide for any row.
    clusters: Vec<(usize, Pixels, bool)>,
    /// A place the rules allow a break falls inside one of its shaped clusters, where no row can
    /// start: such a group runs past the row rather than break where the rules forbid.
    unbreakable: bool,
}

impl LineWrapper {
    /// The rows a shaped line wraps into at `wrap`'s width, by UAX #14 and in text order, with the
    /// layout they're drawn from: `layout` itself when its glyphs run in text order, otherwise the
    /// rows laid out one by one and set end to end. With no width, `unwrapped` comes back as it is.
    pub(crate) fn rows(
        platform: &dyn PlatformTextSystem,
        text: &str,
        runs: &[FontRun],
        wrap: Option<(Pixels, Option<usize>)>,
        unwrapped: (Arc<LineLayout>, SmallVec<[WrapBoundary; 1]>),
    ) -> (Arc<LineLayout>, SmallVec<[WrapBoundary; 1]>) {
        let (layout, _) = &unwrapped;
        let Some((width, max_lines)) = wrap else {
            return unwrapped;
        };
        let glyphs: Vec<(WrapBoundary, usize, Pixels)> = layout
            .runs
            .iter()
            .enumerate()
            .flat_map(|(run_ix, run)| {
                run.glyphs.iter().enumerate().map(move |(glyph_ix, glyph)| {
                    (
                        WrapBoundary { run_ix, glyph_ix },
                        glyph.index,
                        glyph.position.x,
                    )
                })
            })
            .collect();
        if glyphs.is_empty() {
            return (layout.clone(), SmallVec::new());
        }

        // Each shaped cluster, by its first byte, with the advance of its glyphs.
        let mut clusters: Vec<(usize, Pixels)> = Vec::new();
        for (k, &(_, index, x)) in glyphs.iter().enumerate() {
            let next = glyphs.get(k + 1).map_or(layout.width, |&(_, _, x)| x);
            clusters.push((index, next - x));
        }
        clusters.sort_by_key(|&(index, _)| index);
        clusters.dedup_by(|(index, width), (kept, kept_width)| {
            let same = index == kept;
            if same {
                *kept_width += *width;
            }
            same
        });

        let starts = line_starts(text);
        let graphemes: Vec<usize> = GraphemeClusterSegmenter::new().segment_str(text).collect();
        let mut groups: Vec<Group> = Vec::new();
        for (k, &(index, advance)) in clusters.iter().enumerate() {
            let end = clusters.get(k + 1).map_or(text.len(), |&(next, _)| next);
            // White space, with any zero-width character shaped into it, hangs: it never starts a row.
            let blank = text[index..end].starts_with(char::is_whitespace);
            let opens = k == 0 || starts.binary_search(&index).is_ok();
            if opens {
                groups.push(Group {
                    start: index,
                    width: px(0.),
                    trimmed: px(0.),
                    clusters: Vec::new(),
                    unbreakable: false,
                });
            }
            let group = groups.last_mut().expect("the first cluster opens a group");
            group.width += advance;
            if !blank {
                group.trimmed = group.width;
            }
            group.clusters.push((index, advance, blank));
            let inside = starts.partition_point(|&at| at <= index);
            group.unbreakable |= starts.get(inside).is_some_and(|&at| at < end);
        }

        // Greedy rows: a group joins the row while it fits, its trailing spaces hanging; a group
        // wider than any row is cut between its graphemes, unless that would break where it can't.
        let mut row_starts: Vec<usize> = Vec::new();
        let mut used: Option<Pixels> = None;
        for group in &groups {
            if let Some(so_far) = used
                && so_far + group.trimmed > width
            {
                row_starts.push(group.start);
                used = None;
            }
            if group.trimmed > width && !group.unbreakable {
                for &(index, advance, blank) in &group.clusters {
                    if let Some(so_far) = used
                        && !blank
                        && advance > px(0.)
                        && graphemes.binary_search(&index).is_ok()
                        && so_far + advance > width
                    {
                        row_starts.push(index);
                        used = None;
                    }
                    used = Some(used.unwrap_or(px(0.)) + advance);
                }
            } else {
                used = Some(used.unwrap_or(px(0.)) + group.width);
            }
        }
        if let Some(max_lines) = max_lines {
            row_starts.truncate(max_lines.saturating_sub(1));
        }
        if row_starts.is_empty() {
            return (layout.clone(), SmallVec::new());
        }

        // Glyphs in text order: each row starts at the glyph of its first byte.
        if glyphs.windows(2).all(|pair| pair[0].1 <= pair[1].1) {
            let boundaries = row_starts
                .iter()
                .filter_map(|&at| glyphs.iter().find(|&&(_, index, _)| index == at))
                .map(|&(boundary, _, _)| boundary)
                .collect();
            return (layout.clone(), boundaries);
        }

        // Otherwise each row is laid out on its own, its trailing white space left off, and the
        // rows are set end to end; each row's first glyph is its boundary.
        let mut rows = LineLayout {
            font_size: layout.font_size,
            width: px(0.),
            ascent: layout.ascent,
            descent: layout.descent,
            runs: Vec::new(),
            len: layout.len,
        };
        let mut boundaries = SmallVec::new();
        let ends = row_starts.iter().copied().chain([text.len()]);
        let mut row_start = 0;
        for (row, row_end) in ends.enumerate() {
            let shown = text[row_start..row_end].trim_end();
            let shown_end = if shown.is_empty() {
                row_end
            } else {
                row_start + shown.len()
            };
            let row_runs = runs_within(runs, row_start..shown_end);
            let laid =
                platform.layout_line(&text[row_start..shown_end], layout.font_size, &row_runs);
            if row > 0 && laid.runs.iter().any(|run| !run.glyphs.is_empty()) {
                let first = rows.runs.len()
                    + laid
                        .runs
                        .iter()
                        .position(|run| !run.glyphs.is_empty())
                        .unwrap_or(0);
                boundaries.push(WrapBoundary {
                    run_ix: first,
                    glyph_ix: 0,
                });
            }
            for mut run in laid.runs {
                for glyph in &mut run.glyphs {
                    glyph.index += row_start;
                    glyph.position = point(glyph.position.x + rows.width, glyph.position.y);
                }
                rows.runs.push(run);
            }
            rows.width += laid.width;
            rows.ascent = rows.ascent.max(laid.ascent);
            rows.descent = rows.descent.max(laid.descent);
            row_start = row_end;
        }
        (Arc::new(rows), boundaries)
    }
}

/// The font runs of `runs` that cover `range` of their text, cut to it.
fn runs_within(runs: &[FontRun], range: std::ops::Range<usize>) -> Vec<FontRun> {
    let mut within = Vec::new();
    let mut at = 0;
    for run in runs {
        let (start, end) = (at.max(range.start), (at + run.len).min(range.end));
        if start < end {
            within.push(FontRun {
                len: end - start,
                font_id: run.font_id,
            });
        }
        at += run.len;
    }
    within
}
