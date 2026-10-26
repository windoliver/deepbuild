//! Issue #381: the one shaper's line breaks (UAX #14), grapheme boundaries (UAX #29) and bidi
//! order (UAX #9), read from the analysis parley's layout runs and from the layout itself, so the
//! conformance files hold the shaper to what it draws (canvas primitives: Text `text@1`,
//! Semantics). Offsets are code point offsets, as the conformance files count.

use std::sync::atomic::{AtomicUsize, Ordering};

use icu_properties::props::BidiClass;
use icu_segmenter::LineSegmenter;
use parley::{
    BaseDirection, FontFamily, LineBreakContext, LineBreakOverrideFn, PositionedLayoutItem,
    StyleProperty,
};
use parley_data::Properties;
use parley_engine::{Analysis, AnalysisOptions, Analyzer};

use crate::fonts::Role;
use crate::shape::Shaper;

/// A paragraph's base direction (`dir: auto | ltr | rtl`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dir {
    Auto,
    Ltr,
    Rtl,
}

/// A paragraph's bidi resolution as the layout draws it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Bidi {
    /// The paragraph embedding level.
    pub paragraph: u8,
    /// Each code point's resolved level; `None` for one rule X9 removes.
    pub levels: Vec<Option<u8>>,
    /// The code point indices left to right as the layout draws them, the removed ones left out.
    pub order: Vec<usize>,
}

/// Rule X9's removed classes: embeddings, overrides, their terminator and boundary neutrals.
fn removed(c: char) -> bool {
    matches!(
        Properties::get(c).bidi_class(),
        BidiClass::LeftToRightEmbedding
            | BidiClass::RightToLeftEmbedding
            | BidiClass::LeftToRightOverride
            | BidiClass::RightToLeftOverride
            | BidiClass::PopDirectionalFormat
            | BidiClass::BoundaryNeutral
    )
}

/// A text's UAX #14 opportunities at Unicode 17.0.0, which parley's analysis takes through its
/// line-break override. parley asks for each adjacent pair of code points in order, except a pair
/// holding a mandatory break, which never is one; the cursor follows its questions through the text.
pub(crate) struct LineBreaks {
    chars: Vec<char>,
    /// `before[k]`: a line may start at code point `k`.
    before: Vec<bool>,
    cursor: AtomicUsize,
}

impl LineBreaks {
    pub(crate) fn new(text: &str) -> Self {
        let chars: Vec<char> = text.chars().collect();
        let mut before = vec![false; chars.len() + 1];
        let mut at = text.char_indices().map(|(b, _)| b).enumerate().peekable();
        for b in
            LineSegmenter::new_neo_for_non_complex_scripts(Default::default()).segment_str(text)
        {
            while at.next_if(|&(_, byte)| byte < b).is_some() {}
            if let Some(&(k, _)) = at.peek().filter(|&&(_, byte)| byte == b) {
                before[k] = true;
            }
        }
        LineBreaks {
            chars,
            before,
            cursor: AtomicUsize::new(1),
        }
    }

    /// As parley's override: it asks with no position, so the opportunities go with it.
    pub(crate) fn into_override(self) -> Box<LineBreakOverrideFn> {
        Box::new(move |cx| self.decide(cx))
    }

    /// The opportunity between the next pair parley asks about.
    fn decide(&self, cx: LineBreakContext) -> Option<bool> {
        let start = self.cursor.load(Ordering::Relaxed);
        let k = (start..self.chars.len())
            .find(|&k| self.chars[k - 1] == cx.before && self.chars[k] == cx.after)?;
        self.cursor.store(k + 1, Ordering::Relaxed);
        Some(self.before[k])
    }
}

fn analyze(text: &str, dir: BaseDirection) -> Analysis {
    let mut analysis = Analysis::new();
    let decide = LineBreaks::new(text).into_override();
    // The options parley's layout passes for one default style: no line-break tailoring, no
    // break-spaces, and the 17.0 opportunities as its override.
    Analyzer::new().analyze(
        text,
        &AnalysisOptions {
            base_direction: dir,
            line_break_override: Some(&*decide),
            ..AnalysisOptions::default()
        },
        &mut analysis,
    );
    analysis
}

/// The code point offsets in `1..=n` where a line may start: after a soft wrap opportunity the
/// layout breaks at, after a mandatory break (CR before LF is one break), and at the end.
pub fn breaks(text: &str) -> Vec<usize> {
    let chars: Vec<char> = text.chars().collect();
    let analysis = analyze(text, BaseDirection::Auto);
    let info = analysis.char_info();
    let mut out = Vec::new();
    for k in 1..chars.len() {
        let prev = chars[k - 1];
        let mandatory =
            Properties::get(prev).is_mandatory_linebreak() && !(prev == '\r' && chars[k] == '\n');
        if mandatory || info[k].is_soft_wrap_opportunity() {
            out.push(k);
        }
    }
    out.push(chars.len());
    out
}

/// Each grapheme cluster's first byte, in order, as the layout's own segmenter finds them.
pub fn grapheme_starts(text: &str) -> Vec<usize> {
    parley_engine::AnalysisDataSources::new()
        .grapheme_segmenter()
        .segment_str(text)
        .filter(|&b| b < text.len())
        .collect()
}

/// The code point offsets in `1..=n` where a grapheme cluster ends.
pub fn graphemes(text: &str) -> Vec<usize> {
    let analysis = analyze(text, BaseDirection::Auto);
    let info = analysis.char_info();
    let n = info.len();
    let mut out: Vec<usize> = (1..n).filter(|&k| info[k].is_grapheme_start()).collect();
    out.push(n);
    out
}

impl Shaper {
    /// `text` as one paragraph on one line with no width: its levels from the analysis the
    /// layout runs, and its visual order from the layout's runs and clusters.
    pub fn bidi(&mut self, text: &str, dir: Dir) -> Bidi {
        let base = match dir {
            Dir::Auto => BaseDirection::Auto,
            Dir::Ltr => BaseDirection::Ltr,
            Dir::Rtl => BaseDirection::Rtl,
        };
        let chars: Vec<char> = text.chars().collect();
        let analysis = analyze(text, base);
        let paragraph = analysis.paragraph_level().to_u8();
        let resolved = analysis.bidi_levels();
        let levels = chars
            .iter()
            .enumerate()
            .map(|(i, &c)| (!removed(c)).then(|| resolved.get(i).map_or(paragraph, |l| l.to_u8())))
            .collect::<Vec<_>>();

        // Byte offset → code point index.
        let mut index = vec![0usize; text.len() + 1];
        for (i, (b, _)) in text.char_indices().enumerate() {
            index[b] = i;
        }
        index[text.len()] = chars.len();
        let decide = LineBreaks::new(text).into_override();
        let mut builder = self
            .layout
            .ranged_builder(&mut self.fonts, text, 1.0, false);
        builder.set_base_direction(base);
        builder.set_line_break_override(Some(&*decide));
        builder.push_default(StyleProperty::FontFamily(FontFamily::named(
            Role::Body.family(),
        )));
        let mut layout = builder.build(text);
        layout.break_all_lines(None);
        let mut order = Vec::with_capacity(chars.len());
        for line in layout.lines() {
            for item in line.items() {
                let PositionedLayoutItem::GlyphRun(run) = item else {
                    continue;
                };
                for cluster in run.run().visual_clusters() {
                    let range = cluster.text_range();
                    let span = index[range.start]..index[range.end];
                    if cluster.is_rtl() {
                        order.extend(span.rev());
                    } else {
                        order.extend(span);
                    }
                }
            }
        }
        order.retain(|&i| levels[i].is_some());
        Bidi {
            paragraph,
            levels,
            order,
        }
    }
}
