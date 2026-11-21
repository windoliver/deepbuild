//! The one shaper. A text is shaped once per run by parley (HarfRust shaping, UAX #14 line
//! breaks, UAX #9 bidi), from the bundled fonts alone; the shaped run is the only source for
//! layout, the fit check and drawing (canvas primitives: Text `text@1`, Semantics). Issue #1430:
//! a text is shaped per paragraph and its lines broken from the shaped paragraphs, so a new width
//! shapes nothing and a typed character shapes only its paragraph.

use std::sync::{Arc, Mutex, MutexGuard};

use icu_properties::props::BidiClass;
use parley::fontique::{Collection, CollectionOptions, SourceCache};
use parley::setting::Tag;
use parley::{
    Alignment, AlignmentOptions, BaseDirection, FontContext, FontData, FontFamily, FontFamilyName,
    FontStyle, FontVariation, FontVariations, FontWeight, Language, Layout, LayoutContext,
    LineHeight, PositionedLayoutItem, StyleProperty, VerticalAlign,
};
use parley_data::Properties;
use skrifa::raw::TableProvider;

use crate::cache::{self, Key, Planted, ShapeKey};
use crate::fonts::{self, Role, FACES};
use crate::unicode::is_default_ignorable;
use crate::unicode::{grapheme_starts, LineBreaks};
use crate::vertical::{Flow, Stand};

/// The bytes a shaped paragraph counts as in the shape cache, a character: parley's layout of it
/// (54, measured on a 500-character paragraph once broken into lines) and a glyph of the lines it
/// keeps (80). Fixed, as the entry's own below, so every platform counts alike; measured on the
/// reference Macs.
const BYTES_PER_CHAR: usize = 54 + 80;

/// An entry's own bytes: the paragraph (488), its key (64) and the caches' hold on them.
const BYTES_PER_PARAGRAPH: usize = 640;

/// #1430: a paragraph shaped once and not yet broken into lines: parley's layout of it, which
/// each width breaks again, the lines it was last broken into, and its graphemes' first bytes and
/// its `\n`s.
pub(crate) struct Paragraph {
    layout: Mutex<Held>,
    starts: Vec<usize>,
    ends: Vec<usize>,
    chars: usize,
}

/// A paragraph's layout, with the lines it was last broken into and what they depend on.
type Held = (Layout<()>, Option<(Lines, Arc<Piece>)>);

impl Paragraph {
    fn lock(&self) -> MutexGuard<'_, Held> {
        self.layout.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The bytes it counts as in the shape cache, with its key's text: its layout, its lines'
    /// glyphs at about one a character, and its graphemes' and `\n`s' offsets.
    pub(crate) fn bytes(&self, text: &str) -> usize {
        BYTES_PER_PARAGRAPH
            + text.len()
            + self.chars * BYTES_PER_CHAR
            + (self.starts.len() + self.ends.len()) * 8
    }
}

/// #1430: what a paragraph's lines depend on beyond its shape key: the width they break at, the
/// width they align in, the alignment, the indent, the first line's top in the text, and whether
/// the paragraph ends the text.
#[derive(Clone, Copy, PartialEq)]
struct Lines {
    width: Option<u32>,
    within: Option<u32>,
    align: Align,
    indent: u32,
    y: u64,
    last: bool,
}

/// #1430: a paragraph's lines as one layout of the whole text draws them, except that graphemes
/// count from the paragraph's first and no gap moves them down yet (#1966): its glyphs and
/// decorations, and each line's height, advance with the indent, `\n`s before it in the paragraph,
/// and the glyphs and decorations up to its end.
struct Piece {
    glyphs: Vec<Glyph>,
    decorations: Vec<Decoration>,
    lines: Vec<(f32, f32, usize, usize, usize)>,
}

/// Where the next paragraph of a text goes: its first line's top, the gaps above it, and the
/// graphemes and `\n`s before it.
#[derive(Default)]
struct At {
    y: f64,
    down: f32,
    graphemes: usize,
    newlines: usize,
}

/// #1430: whether a text's base direction is right to left as parley finds it for a whole text
/// (UAX #9 P2 and P3: its first strong character outside isolates). Each of its paragraphs is
/// shaped in it, so splitting a text into paragraphs turns none of them around.
pub(crate) fn rtl(text: &str) -> bool {
    let mut isolates = 0u32;
    for c in text.chars() {
        match Properties::get(c).bidi_class() {
            BidiClass::RightToLeftIsolate
            | BidiClass::LeftToRightIsolate
            | BidiClass::FirstStrongIsolate => isolates += 1,
            BidiClass::PopDirectionalIsolate if isolates > 0 => isolates -= 1,
            BidiClass::LeftToRight if isolates == 0 => return false,
            BidiClass::RightToLeft | BidiClass::ArabicLetter if isolates == 0 => return true,
            _ => {}
        }
    }
    false
}

/// The parley alignment of a text's `align`.
fn alignment(align: Align) -> Alignment {
    match align {
        Align::Start => Alignment::Start,
        Align::Center => Alignment::Center,
        Align::End => Alignment::End,
    }
}

/// #1430: breaks a paragraph's lines at `width` (none: only where they must), its first line's top
/// at `y`, so its lines land where one layout of the whole text puts them; `within` is the width
/// each line aligns in, which with no width is otherwise the paragraph's widest line.
fn break_lines(layout: &mut Layout<()>, width: Option<f32>, y: f64, within: Option<f32>) {
    let max = width.unwrap_or(f32::MAX);
    let mut lines = layout.break_lines();
    let state = lines.state_mut();
    state.set_layout_max_advance(max);
    state.set_line_max_advance(max);
    state.set_line_y(y);
    // The shaper adds no inline boxes, so each step yields a line.
    while lines.break_next().is_some() {
        if let Some(within) = within {
            lines.set_prior_line_width(within);
        }
    }
    lines.finish();
}

/// Text's horizontal alignment within its box (`align: start | center | end = start`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Align {
    #[default]
    Start,
    Center,
    End,
}

/// What a Text item asks the shaper for. `bound` marks a bound value or counter: it is never
/// ellipsized or wrapped, so a bound value that doesn't fit fails the fit check instead (canvas
/// primitives: Honest numbers). `tabular` asks for tabular figures, the default for a bound value.
/// `mask` is `overflow: mask`: text that doesn't fit is drawn whole for its content mask to clip,
/// never cut with an ellipsis.
#[derive(Clone, Debug, PartialEq)]
pub struct Spec<'a> {
    pub text: &'a str,
    /// The bundled family the run is set in: a font role's face, as the look names it (#1484: set
    /// in its variable twin where one is bundled, `fonts::shaped_in`).
    pub family: &'a str,
    /// #417: bundled families in order; a grapheme the family lacks is set in the first that has it.
    pub fallback: &'a [&'a str],
    /// #417: the language the run is shaped in (BCP 47), such as `zh-Hans` for Simplified forms.
    pub lang: Option<&'a str>,
    /// Font size in logical pixels (`size: f32, u = 13`).
    pub size: f32,
    /// `weight: u16 = 400`: a variable face's `wght` (#1484), else the nearest bundled face's.
    pub weight: u16,
    /// `line_height = 1.3 × size`, rounded to whole pixels, when `None`.
    pub line_height: Option<f32>,
    /// `box.w`: the width lines wrap at and the fit check reads; `None` is `auto`.
    pub width: Option<f32>,
    /// `max_lines: u16 = none`.
    pub max_lines: Option<u16>,
    pub align: Align,
    pub bound: bool,
    pub tabular: bool,
    pub mask: bool,
    /// #1964: styled spans of the one run, shaped with it.
    pub spans: &'a [Span],
    /// #1966: the space after each paragraph a `\n` ends, in logical pixels (a list's `gap`).
    pub gap: f32,
    /// #1966: how far in every line starts, in logical pixels (a list's `indent`): lines break
    /// at `width` less it, so a wrapped line starts under the text, not at the run's edge.
    pub indent: f32,
    /// #1215: lines across, or columns top to bottom (`flow`, `upright`, `combine_upright`).
    pub flow: Flow,
}

/// #1964: a styled span's shift off the baseline (`shift: sub | super | u`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Shift {
    /// The face's subscript size and offset (OS/2 `ySubscriptYSize`, `ySubscriptYOffset`).
    Sub,
    /// The face's superscript size and offset (OS/2 `ySuperscriptYSize`, `ySuperscriptYOffset`).
    Super,
    /// Raised by this many logical pixels; lowered when negative.
    By(f32),
}

/// #1964: a styled span of one shaped run (`runs[i]`): graphemes `[from, to)` of the text. A field
/// left `None` (or `false`) stays the item's.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Span {
    pub from: usize,
    pub to: usize,
    /// The bundled family its font role names.
    pub family: Option<&'static str>,
    pub weight: Option<u16>,
    pub italic: Option<bool>,
    pub size: Option<f32>,
    /// Extra advance after each character, in logical pixels.
    pub tracking: Option<f32>,
    pub shift: Option<Shift>,
    pub underline: bool,
    pub strike: bool,
}

// A span's numbers are finite (the document's reader refuses others), so equality is total and
// each hashes by its bits: a run's key holds its spans.
impl Eq for Span {}

impl std::hash::Hash for Span {
    fn hash<H: std::hash::Hasher>(&self, h: &mut H) {
        let bits = |v: Option<f32>| v.map(f32::to_bits);
        (self.from, self.to, self.family, self.weight, self.italic).hash(h);
        (
            bits(self.size),
            bits(self.tracking),
            self.underline,
            self.strike,
        )
            .hash(h);
        match self.shift {
            None => 0u32.hash(h),
            Some(Shift::Sub) => 1u32.hash(h),
            Some(Shift::Super) => 2u32.hash(h),
            Some(Shift::By(u)) => (3u32, u.to_bits()).hash(h),
        }
    }
}

/// #538: the advance of `family`'s `0` in ems: a monospace face's cell at size 1, which a cell
/// grid spaces its rows to so each glyph sits in its own cell.
pub fn advance_em(family: &str) -> Option<f32> {
    use skrifa::MetadataProvider;
    let face = FACES.iter().find(|f| f.family == family)?;
    let font = skrifa::FontRef::new(face.bytes()).ok()?;
    let em = f32::from(font.head().ok()?.units_per_em().max(1));
    let glyph = font.charmap().map('0')?;
    let metrics = font.glyph_metrics(
        skrifa::instance::Size::unscaled(),
        skrifa::instance::LocationRef::default(),
    );
    Some(metrics.advance_width(glyph)? / em)
}

/// The `[size, rise]` ratios of an em a face sets its subscripts or superscripts at, from its
/// OS/2 table; `None` for a face without one.
fn script_metrics(family: &str, shift: Shift) -> Option<[f32; 2]> {
    let face = FACES.iter().find(|f| f.family == family)?;
    let font = skrifa::FontRef::new(face.bytes()).ok()?;
    let em = f32::from(font.head().ok()?.units_per_em().max(1));
    let os2 = font.os2().ok()?;
    let [size, offset] = match shift {
        Shift::Sub => [os2.y_subscript_y_size(), -os2.y_subscript_y_offset()],
        Shift::Super => [os2.y_superscript_y_size(), os2.y_superscript_y_offset()],
        Shift::By(_) => return None,
    };
    (size > 0).then(|| [f32::from(size) / em, f32::from(offset) / em])
}

/// #1484: the axis values a run at `size` u and `weight` is set at: its optical size follows its
/// size, which a face's own `opsz` range clamps (Inter's 14 to 32), and its weight draws as asked.
/// A face without an axis ignores its value. `optical` false is AC1's planted shaper, which leaves
/// the optical size at the face's default.
fn axes(size: f32, weight: u16, optical: bool) -> StyleProperty<'static, ()> {
    let mut axes = vec![FontVariation::new(Tag::new(b"wght"), f32::from(weight))];
    if optical {
        axes.push(FontVariation::new(Tag::new(b"opsz"), size));
    }
    StyleProperty::FontVariations(FontVariations::List(axes.into()))
}

impl<'a> Spec<'a> {
    /// A label in the body role at the defaults.
    pub fn label(text: &'a str) -> Self {
        Spec {
            text,
            family: Role::Body.family(),
            fallback: &[],
            lang: None,
            size: 13.,
            weight: 400,
            line_height: None,
            width: None,
            max_lines: None,
            align: Align::Start,
            bound: false,
            tabular: false,
            mask: false,
            spans: &[],
            gap: 0.,
            indent: 0.,
            flow: Flow::Horizontal,
        }
    }

    /// The line height in logical pixels: the spec's, or 1.3 × size rounded to whole pixels.
    pub fn line_height(&self) -> f32 {
        self.line_height.unwrap_or((1.3 * self.size).round())
    }
}

/// One glyph of a shaped run, placed in logical pixels with `y` on its baseline.
#[derive(Clone, Debug)]
pub struct Glyph {
    pub font: FontData,
    pub size: f32,
    pub id: u32,
    pub x: f32,
    pub y: f32,
    /// #496: the glyph's advance as shaped, in logical pixels.
    pub advance: f32,
    /// The grapheme cluster (UAX #29) of the shown text the glyph belongs to.
    pub grapheme: usize,
    /// #496: the face's normalized variation coordinates (F2Dot14 bits) the glyph was shaped at,
    /// empty for a static face or the default instance; outlines and rasters read the glyph at
    /// them, and (#1484) the atlas keys it by them.
    pub coords: Arc<[i16]>,
    /// #1964: the slant in degrees an italic span is drawn at where its face has no italic (0:
    /// upright), leaning forward as y rises.
    pub skew: f32,
    /// #1215: in a vertical run, how the glyph stands in its column; `None` in a horizontal one.
    pub stand: Option<Stand>,
    /// #1215: drawn turned 90° clockwise about (x, y), its baseline running down its column.
    pub turn: bool,
    /// #1215: where its advance starts on its line: (x, y) in a horizontal run; its column's axis
    /// at the top of its cell in a vertical one.
    pub origin: [f32; 2],
    /// #1215: how far it advances along its line: down its column in a vertical run.
    pub along: f32,
}

/// #1964: an underline or a strike of a styled span: `[x, y, w, h]` in logical pixels from the
/// run's origin (y down), at its face's own offset and thickness, painted as its first grapheme.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Decoration {
    pub rect: [f32; 4],
    pub grapheme: usize,
}

/// #297: one grapheme of a text as its faces draw it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Drawn {
    pub grapheme: String,
    /// A face lacks one of its glyphs, and it isn't white space or default-ignorable alone.
    pub missing: bool,
    /// One of its glyphs draws ink.
    pub ink: bool,
}

/// A shaped text: its glyphs and the box they take.
#[derive(Clone, Debug, Default)]
pub struct Shaped {
    pub glyphs: Vec<Glyph>,
    /// #1964: its spans' underlines and strikes, drawn over its glyphs.
    pub decorations: Vec<Decoration>,
    /// The widest line's advance, in logical pixels.
    pub width: f32,
    /// The lines' heights summed.
    pub height: f32,
    pub lines: usize,
    /// #1966: the height of a line, and the space after each paragraph a `\n` ends, so a row
    /// is found from a glyph's baseline.
    pub line_height: f32,
    pub gap: f32,
    /// True when the text was cut to fit its box with an ellipsis (never for a bound value).
    pub ellipsized: bool,
    /// The text as drawn: the spec's text, or its cut with an ellipsis.
    pub shown: String,
    /// #1215: a vertical run's lines are columns: `width` is their extent across (one line
    /// height each) and `height` the longest column's length.
    pub flow: Flow,
}

impl Shaped {
    /// #1215: where a vertical run draws in its own coordinates, `[x, y, w, h]`: its columns
    /// across, a line height each about its axis, and down from its first cell to its longest
    /// column's end; `None` for a horizontal run.
    pub fn columns_box(&self) -> Option<[f32; 4]> {
        if !matches!(self.flow, Flow::Vertical(_)) {
            return None;
        }
        let half = self.line_height / 2.;
        let mut b = [f32::MAX, f32::MAX, f32::MIN, f32::MIN];
        for g in &self.glyphs {
            b = [
                b[0].min(g.origin[0] - half),
                b[1].min(g.origin[1]),
                b[2].max(g.origin[0] + half),
                b[3].max(g.origin[1] + g.along),
            ];
        }
        if b[0] > b[2] {
            return Some([0., 0., 0., 0.]);
        }
        Some([b[0], b[1], b[2] - b[0], b[3] - b[1]])
    }
}

/// The fit check's reading for a spec against its widest string.
#[derive(Clone, Debug, PartialEq)]
pub struct Fit {
    /// Whether the widest string fits the box and the line limit.
    pub fits: bool,
    /// The widest string's advance, in logical pixels.
    pub width: f32,
    pub lines: usize,
    /// `"tabular"` for a bound value, `"proportional"` otherwise.
    pub numerals: &'static str,
    /// What drawing does when the text doesn't fit: `"ellipsis"` for text, `"mask"` for text its
    /// content mask clips, `"fail"` for a bound value, which is never cut short.
    pub overflow: &'static str,
}

/// The shaper: a font collection of the bundled faces and parley's layout context.
pub struct Shaper {
    pub(crate) fonts: FontContext,
    pub(crate) layout: LayoutContext<()>,
}

impl Default for Shaper {
    fn default() -> Self {
        Self::new()
    }
}

impl Shaper {
    /// A shaper over the bundled fonts and nothing else: no system fonts are loaded.
    pub fn new() -> Self {
        let mut collection = Collection::new(CollectionOptions {
            shared: false,
            system_fonts: false,
        });
        for face in FACES {
            collection.register_fonts(fonts::blob(face), None);
        }
        Shaper {
            fonts: FontContext {
                collection,
                source_cache: SourceCache::default(),
            },
            layout: LayoutContext::new(),
        }
    }

    /// The family names the shaper knows: the bundled ones.
    pub fn families(&mut self) -> Vec<String> {
        self.fonts
            .collection
            .family_names()
            .map(str::to_owned)
            .collect()
    }

    /// The layout of `text` in the spec's style, `vert` applied to the byte ranges `vert` names
    /// (#1215: the graphemes of a vertical run that stand upright), its lines broken at the
    /// spec's width when `wrap`, else only at hard breaks: one layout of the whole text, which a
    /// vertical run reads.
    pub(crate) fn layout_with(
        &mut self,
        spec: &Spec<'_>,
        text: &str,
        optical: bool,
        vert: &[std::ops::Range<usize>],
        wrap: bool,
    ) -> Layout<()> {
        let starts = grapheme_starts(text);
        let mut layout = self.build(spec, text, spec.spans, rtl(text), &starts, (optical, vert));
        // A bound value is never wrapped: it stays on one line, past its box if it must.
        let width = spec
            .width
            .filter(|_| wrap && !spec.bound)
            .map(|w| (w - spec.indent).max(0.));
        layout.break_all_lines(width);
        layout.align(alignment(spec.align), AlignmentOptions::default());
        layout
    }

    /// #1430: `text`, one paragraph, shaped in the spec's style with its own `spans` and the
    /// whole text's base direction, not yet broken into lines. #1484: `optical` false leaves the
    /// optical size at the face's default; #1215: `vert` as `layout_with` takes it.
    fn build(
        &mut self,
        spec: &Spec<'_>,
        text: &str,
        spans: &[Span],
        rtl: bool,
        starts: &[usize],
        (optical, vert): (bool, &[std::ops::Range<usize>]),
    ) -> Layout<()> {
        let decide = LineBreaks::new(text).into_override();
        let mut builder = self
            .layout
            .ranged_builder(&mut self.fonts, text, 1.0, false);
        builder.set_base_direction(if rtl {
            BaseDirection::Rtl
        } else {
            BaseDirection::Ltr
        });
        // Lines break at UAX #14's opportunities at the pinned Unicode version (17.0.0).
        builder.set_line_break_override(Some(&*decide));
        // The family first, then the fallback families in order: parley sets each cluster in the
        // first family of the list whose face maps it. #1484: each in its variable twin.
        let families: Vec<FontFamilyName<'_>> = std::iter::once(spec.family)
            .chain(spec.fallback.iter().copied())
            .map(|f| FontFamilyName::named(fonts::shaped_in(f)))
            .collect();
        builder.push_default(StyleProperty::FontFamily(FontFamily::List(families.into())));
        if let Some(lang) = spec.lang {
            builder.push_default(StyleProperty::Locale(Language::parse(lang).ok()));
        }
        builder.push_default(StyleProperty::FontSize(spec.size));
        builder.push_default(StyleProperty::FontWeight(FontWeight::new(f32::from(
            spec.weight,
        ))));
        builder.push_default(axes(spec.size, spec.weight, optical));
        builder.push_default(StyleProperty::LineHeight(LineHeight::Absolute(
            spec.line_height(),
        )));
        if spec.tabular {
            builder.push_default(StyleProperty::FontFeatures("\"tnum\" 1".into()));
        }
        let features = if spec.tabular {
            "\"tnum\" 1, \"vert\" 1"
        } else {
            "\"vert\" 1"
        };
        for range in vert {
            builder.push(StyleProperty::FontFeatures(features.into()), range.clone());
        }
        // #1964: each span restyles its graphemes' byte range of the one run, so the layout shapes
        // and breaks it with the rest. A span's box adds no height: the item's line height alone
        // spaces the lines, so a shift or a size never moves a baseline.
        let byte = |g: usize| starts.get(g).copied().unwrap_or(text.len());
        for span in spans {
            let range = byte(span.from)..byte(span.to);
            if range.is_empty() {
                continue;
            }
            let family = span.family.unwrap_or(spec.family);
            if span.family.is_some() {
                let families: Vec<FontFamilyName<'_>> = std::iter::once(family)
                    .chain(spec.fallback.iter().copied())
                    .map(|f| FontFamilyName::named(fonts::shaped_in(f)))
                    .collect();
                builder.push(
                    StyleProperty::FontFamily(FontFamily::List(families.into())),
                    range.clone(),
                );
            }
            if let Some(weight) = span.weight {
                builder.push(FontWeight::new(f32::from(weight)), range.clone());
            }
            if let Some(italic) = span.italic {
                let style = if italic {
                    FontStyle::Italic
                } else {
                    FontStyle::Normal
                };
                builder.push(StyleProperty::FontStyle(style), range.clone());
            }
            let size = span.size.unwrap_or(spec.size);
            let (size, rise) = match span.shift {
                None => (size, 0.),
                Some(Shift::By(u)) => (size, u),
                Some(shift) => script_metrics(family, shift)
                    .map_or((size, 0.), |[k, rise]| (size * k, size * rise)),
            };
            if size != spec.size {
                builder.push(StyleProperty::FontSize(size), range.clone());
            }
            let weight = span.weight.unwrap_or(spec.weight);
            if size != spec.size || weight != spec.weight {
                builder.push(axes(size, weight, optical), range.clone());
            }
            if rise != 0. {
                builder.push(VerticalAlign::length(rise), range.clone());
            }
            if span.size.is_some() || span.shift.is_some() {
                builder.push(
                    StyleProperty::LineHeight(LineHeight::Absolute(0.)),
                    range.clone(),
                );
            }
            if let Some(tracking) = span.tracking {
                builder.push(StyleProperty::LetterSpacing(tracking), range.clone());
            }
            if span.underline {
                builder.push(StyleProperty::Underline(true), range.clone());
            }
            if span.strike {
                builder.push(StyleProperty::Strikethrough(true), range);
            }
        }
        builder.build(text)
    }

    /// #1430: `text`, a paragraph of a text with `first` graphemes before it, shaped in the spec's
    /// style: from the shape cache, or shaped now and kept there (`fresh`: shaped now, past it,
    /// `optical` as `build` takes it). Its shape key comes back with it when it was shaped now.
    fn paragraph(
        &mut self,
        spec: &Spec<'_>,
        text: &str,
        first: usize,
        rtl: bool,
        (fresh, optical): (bool, bool),
    ) -> (Arc<Paragraph>, Option<ShapeKey>) {
        let mut starts = None;
        // #1964: the parts of the spans in this paragraph, counted from its first grapheme.
        let spans: Vec<Span> = if spec.spans.is_empty() {
            Vec::new()
        } else {
            let end = first + starts.insert(grapheme_starts(text)).len();
            spec.spans
                .iter()
                .filter_map(|s| {
                    let (from, to) = (s.from.max(first), s.to.min(end));
                    (from < to).then(|| Span {
                        from: from - first,
                        to: to - first,
                        ..s.clone()
                    })
                })
                .collect()
        };
        let key = ShapeKey::of(spec, text, &spans, rtl);
        if !fresh {
            if let Some(paragraph) = cache::paragraph(&key) {
                return (paragraph, None);
            }
        }
        let starts = starts.unwrap_or_else(|| grapheme_starts(text));
        let paragraph = Paragraph {
            layout: Mutex::new((
                self.build(spec, text, &spans, rtl, &starts, (optical, &[])),
                None,
            )),
            starts,
            ends: text.match_indices('\n').map(|(i, _)| i).collect(),
            chars: text.chars().count(),
        };
        let paragraph = if fresh {
            Arc::new(paragraph)
        } else {
            cache::keep(key.clone(), paragraph)
        };
        (paragraph, Some(key))
    }

    /// #1430: `text` laid out in the spec's style as one layout of the whole text lays it out:
    /// each paragraph (a `\n` ends one) from the shape cache or shaped now, its lines broken at the
    /// spec's width under the lines before it, and with no width aligned within the whole text's
    /// widest line. `shaping`: `(fresh, optical)` as `paragraph` takes it, `fresh` shaping every
    /// paragraph again, past the shape cache.
    fn lay_out(&mut self, spec: &Spec<'_>, text: &str, shaping: (bool, bool)) -> Shaped {
        let rtl = rtl(text);
        let parts: Vec<&str> = if text.is_empty() || cache::planted() == Some(Planted::WholeText) {
            vec![text]
        } else {
            text.split_inclusive('\n').collect()
        };
        let mut paragraphs = Vec::with_capacity(parts.len());
        let mut first = 0;
        for part in parts {
            let paragraph = self.paragraph(spec, part, first, rtl, shaping);
            first += paragraph.0.starts.len();
            paragraphs.push(paragraph);
        }
        // A bound value is never wrapped: it stays on one line, past its box if it must.
        let width = spec
            .width
            .filter(|_| !spec.bound)
            .map(|w| (w - spec.indent).max(0.));
        // With no width a line aligns within the widest line, here the whole text's, which only
        // breaking every paragraph finds; start-aligned lines left to right don't move.
        let within = (width.is_none()
            && paragraphs.len() > 1
            && (spec.align != Align::Start || rtl))
            .then(|| {
                paragraphs.iter().fold(0f32, |widest, (paragraph, _)| {
                    let layout = &mut paragraph.lock().0;
                    break_lines(layout, None, 0., None);
                    widest.max(layout.width())
                })
            });
        let alignment = alignment(spec.align);
        let mut out = Shaped {
            shown: text.to_owned(),
            line_height: spec.line_height(),
            gap: spec.gap,
            ..Shaped::default()
        };
        out.glyphs
            .reserve(paragraphs.iter().map(|(p, _)| p.chars).sum());
        let mut at = At::default();
        let last = paragraphs.len() - 1;
        for (i, (paragraph, key)) in paragraphs.iter().enumerate() {
            let lines = Lines {
                width: width.map(f32::to_bits),
                within: within.map(f32::to_bits),
                align: spec.align,
                indent: spec.indent.to_bits(),
                y: at.y.to_bits(),
                last: i == last,
            };
            // A paragraph broken under the same conditions as last time keeps its lines: one
            // typed character breaks only the paragraph it changed.
            let piece = {
                let mut held = paragraph.lock();
                match &held.1 {
                    Some((was, piece)) if *was == lines => piece.clone(),
                    _ => {
                        break_lines(&mut held.0, width, at.y, within);
                        held.0.align(alignment, AlignmentOptions::default());
                        let piece = Arc::new(Self::piece(&held.0, paragraph, spec, i == last));
                        held.1 = Some((lines, piece.clone()));
                        piece
                    }
                }
            };
            if let Some(key) = key {
                cache::shaped(key, piece.glyphs.len());
            }
            Self::place(&piece, spec, &mut at, &mut out);
            at.graphemes += paragraph.starts.len();
            at.newlines += paragraph.ends.len();
        }
        out
    }

    /// Appends a paragraph's lines to `out` below the paragraphs `at` counts: its graphemes after
    /// theirs, its lines moved down by the gap after each paragraph before them (#1966).
    fn place(piece: &Piece, spec: &Spec<'_>, at: &mut At, out: &mut Shaped) {
        let (mut glyphs, mut decorations) = (0, 0);
        for &(height, advance, ends, to_glyph, to_decoration) in &piece.lines {
            if spec.gap > 0. {
                let gap = (at.newlines + ends) as f32 * spec.gap;
                out.height += gap - at.down;
                at.down = gap;
            }
            out.lines += 1;
            out.width = out.width.max(advance);
            out.height += height;
            at.y += f64::from(height);
            let (down, first) = (at.down, at.graphemes);
            out.glyphs
                .extend(piece.glyphs[glyphs..to_glyph].iter().map(|g| Glyph {
                    y: g.y + down,
                    origin: [g.origin[0], g.origin[1] + down],
                    grapheme: g.grapheme + first,
                    ..g.clone()
                }));
            out.decorations.extend(
                piece.decorations[decorations..to_decoration]
                    .iter()
                    .map(|d| Decoration {
                        rect: [d.rect[0], d.rect[1] + down, d.rect[2], d.rect[3]],
                        grapheme: d.grapheme + first,
                    }),
            );
            (glyphs, decorations) = (to_glyph, to_decoration);
        }
    }

    /// A paragraph's lines as `layout` broke them: graphemes from its first, no gap applied. A
    /// paragraph that isn't the text's last ends with the empty line parley adds after its `\n`,
    /// which one layout of the whole text doesn't have: it is left out.
    fn piece(layout: &Layout<()>, paragraph: &Paragraph, spec: &Spec<'_>, last: bool) -> Piece {
        let starts = &paragraph.starts;
        // Each glyph's grapheme, read from where the last one was: a run's clusters come in order.
        let mut at = 0;
        let mut grapheme = |byte: usize| {
            while at + 1 < starts.len() && starts[at + 1] <= byte {
                at += 1;
            }
            while at > 0 && starts[at] > byte {
                at -= 1;
            }
            at
        };
        let mut out = Piece {
            glyphs: Vec::with_capacity(paragraph.chars),
            decorations: Vec::new(),
            lines: Vec::with_capacity(layout.len()),
        };
        let count = layout.len();
        for (index, line) in layout.lines().enumerate() {
            if !last && index > 0 && index + 1 == count && line.text_range().is_empty() {
                break;
            }
            let metrics = line.metrics();
            let start = line.text_range().start;
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
                // #1964: a span's underline and strike, across its glyph run at its baseline.
                let style = run.style();
                let metrics = run.run().font_metrics();
                let first = grapheme(run.run().text_range().start);
                let lines = [
                    style.underline.as_ref().map(|d| {
                        let at = d.offset.unwrap_or(metrics.underline_offset);
                        (at, d.size.unwrap_or(metrics.underline_size))
                    }),
                    style.strikethrough.as_ref().map(|d| {
                        let at = d.offset.unwrap_or(metrics.strikethrough_offset);
                        (at, d.size.unwrap_or(metrics.strikethrough_size))
                    }),
                ];
                for (offset, thickness) in lines.into_iter().flatten() {
                    out.decorations.push(Decoration {
                        rect: [
                            run.offset() + spec.indent,
                            run.baseline() - offset,
                            run.advance(),
                            thickness,
                        ],
                        grapheme: first,
                    });
                }
                // The run's clusters in the order its glyphs are drawn, each with its glyphs.
                let clusters = run.run().visual_clusters().flat_map(|c| {
                    let first = c.text_range().start;
                    c.glyphs().map(move |_| first)
                });
                for (glyph, byte) in run.positioned_glyphs().zip(clusters) {
                    out.glyphs.push(Glyph {
                        font: font.clone(),
                        size,
                        id: glyph.id,
                        x: glyph.x + spec.indent,
                        y: glyph.y,
                        advance: glyph.advance,
                        grapheme: grapheme(byte),
                        coords: coords.clone(),
                        skew,
                        stand: None,
                        turn: false,
                        origin: [glyph.x + spec.indent, glyph.y],
                        along: glyph.advance,
                    });
                }
            }
            let ends = paragraph.ends.partition_point(|&i| i < start);
            out.lines.push((
                metrics.line_height,
                metrics.advance + spec.indent,
                ends,
                out.glyphs.len(),
                out.decorations.len(),
            ));
        }
        out
    }

    /// `text` laid out in the spec's style, whole (no line limit applied): from the run cache, or
    /// laid out now and kept there: from its paragraphs, or (#1215) set in columns.
    fn run(&mut self, spec: &Spec<'_>, text: &str) -> Arc<Shaped> {
        let key = Key::of(spec, text, false);
        if let Some(run) = cache::get(&key) {
            return run;
        }
        let run = match spec.flow {
            Flow::Vertical(_) => self.shape_again(spec, text),
            Flow::Horizontal => self.lay_out(spec, text, (false, true)),
        };
        cache::put(key, run)
    }

    /// `text` shaped in the spec's style past the caches, the shaping recorded: each paragraph,
    /// or (#1215) the whole text set in columns.
    fn shape_again(&mut self, spec: &Spec<'_>, text: &str) -> Shaped {
        match spec.flow {
            Flow::Vertical(cols) => {
                let run = self.columns(spec, text, cols);
                cache::shaped(Key::of(spec, text, false).shape(), run.glyphs.len());
                run
            }
            Flow::Horizontal => self.lay_out(spec, text, (true, true)),
        }
    }

    /// #1484 AC1's wrong program, the proof binary's planted `shaper_ignores_opsz`: `spec`'s text
    /// shaped with its weight set and its optical size left at the face's default, as before
    /// #1484, past the shaped-run cache so no run it shapes is kept or shared.
    pub fn shape_ignoring_opsz(&mut self, spec: &Spec<'_>) -> Shaped {
        self.lay_out(spec, spec.text, (true, false))
    }

    /// Whether `spec`'s run is in the shaped-run cache, so shaping it now costs a lookup.
    pub fn is_cached(spec: &Spec<'_>) -> bool {
        cache::holds(&Key::of(spec, spec.text, true))
            || cache::holds(&Key::of(spec, spec.text, false))
    }

    /// Shapes `spec.text`, once per run: a run the shaped-run cache holds is shared, not shaped
    /// again. Text that overflows its box or line limit is cut to fit with an ellipsis; a bound
    /// value or masked text never is, and is drawn whole.
    pub fn shape(&mut self, spec: &Spec<'_>) -> Arc<Shaped> {
        let fitted = Key::of(spec, spec.text, true);
        if let Some(run) = cache::get(&fitted) {
            return run;
        }
        let whole = self.run(spec, spec.text);
        if fits(spec, &whole) || spec.bound || spec.mask {
            return whole;
        }
        let reshaping = cache::planted() == Some(Planted::ReshapingFit);
        // The longest prefix, by grapheme (#297: a cut never splits one), whose run with an
        // ellipsis fits. Each candidate's run comes through the cache, so no prefix is shaped
        // twice; a candidate that fits its line limit has no line past it, so its whole run is
        // the one drawn.
        let chars: Vec<usize> = grapheme_starts(spec.text);
        let (mut low, mut high) = (0usize, chars.len());
        let mut best: Option<Arc<Shaped>> = None;
        while low < high {
            if reshaping {
                self.shape_again(spec, spec.text);
            }
            let mid = (low + high).div_ceil(2);
            let end = chars.get(mid).copied().unwrap_or(spec.text.len());
            let candidate = format!("{}…", spec.text[..end].trim_end());
            let shaped = self.run(spec, &candidate);
            if fits(spec, &shaped) {
                best = Some(shaped);
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        let mut best = match best {
            Some(run) => Shaped::clone(&run),
            // Not even an ellipsis fits a line limit of none.
            None if spec.max_lines == Some(0) => Shaped {
                shown: "…".into(),
                ..Shaped::default()
            },
            None => Shaped::clone(&self.run(spec, "…")),
        };
        best.ellipsized = true;
        cache::put(fitted, best)
    }

    /// #417: the graphemes of `text` that neither the spec's family nor any of its fallbacks can
    /// draw, in order, each once: those any of whose glyphs is `.notdef`. Whitespace and
    /// default-ignorable code points alone (joiners, variation selectors) need no glyph.
    pub fn missing(&mut self, spec: &Spec<'_>, text: &str) -> Vec<String> {
        let run = self.run(spec, text);
        let starts = grapheme_starts(text);
        // #1965: one pass over the run's glyphs, so a code item's 256 KiB isn't read once a
        // grapheme.
        let mut notdef: Vec<usize> = run
            .glyphs
            .iter()
            .filter(|g| g.id == 0)
            .map(|g| g.grapheme)
            .collect();
        notdef.sort_unstable();
        notdef.dedup();
        let mut seen = std::collections::BTreeSet::new();
        let mut out: Vec<String> = Vec::new();
        for i in notdef {
            let Some(start) = starts.get(i) else { continue };
            let end = starts.get(i + 1).copied().unwrap_or(text.len());
            let grapheme = &text[*start..end];
            let needs_glyph = grapheme
                .chars()
                .any(|c| !c.is_whitespace() && !is_default_ignorable(c));
            if needs_glyph && seen.insert(grapheme) {
                out.push(grapheme.to_string());
            }
        }
        out
    }

    /// #297: each grapheme of `text` as the spec's family and fallbacks draw it, in order:
    /// whether a face lacks one of its glyphs (as [`Shaper::missing`] finds), and whether any of
    /// its glyphs draws ink (an outline with a command, or a glyph its face holds no outline for,
    /// which only the atlas draws).
    pub fn drawn(&mut self, spec: &Spec<'_>, text: &str) -> Vec<Drawn> {
        let run = self.run(spec, text);
        let starts = grapheme_starts(text);
        let mut out: Vec<Drawn> = starts
            .iter()
            .enumerate()
            .map(|(k, &a)| {
                let b = starts.get(k + 1).copied().unwrap_or(text.len());
                Drawn {
                    grapheme: text[a..b].to_string(),
                    missing: false,
                    ink: false,
                }
            })
            .collect();
        for g in &run.glyphs {
            let Some(d) = out.get_mut(g.grapheme) else {
                continue;
            };
            if g.id == 0 {
                d.missing |= d
                    .grapheme
                    .chars()
                    .any(|c| !c.is_whitespace() && !is_default_ignorable(c));
                continue;
            }
            if !d.ink {
                d.ink = crate::outlines::outline_of(g).is_none_or(|cmds| !cmds.is_empty());
            }
        }
        out
    }

    /// The fit check: shapes `widest` (the spec's own text when `None`) as the spec would and
    /// reads whether it fits the box and the line limit. A bound value's numerals are tabular.
    pub fn fit(&mut self, spec: &Spec<'_>, widest: Option<&str>) -> Fit {
        let shaped = self.run(spec, widest.unwrap_or(spec.text));
        Fit {
            fits: fits(spec, &shaped),
            width: shaped.width,
            lines: shaped.lines,
            numerals: if spec.tabular {
                "tabular"
            } else {
                "proportional"
            },
            overflow: if spec.bound {
                "fail"
            } else if spec.mask {
                "mask"
            } else {
                "ellipsis"
            },
        }
    }
}

/// Whether a run fits its spec's line length and line limit: its lines in the box's width, or
/// (#1215) a vertical run's columns in the box's height, which is their length.
fn fits(spec: &Spec<'_>, run: &Shaped) -> bool {
    let long = match spec.flow {
        Flow::Vertical(cols) => cols.height.is_none_or(|h| run.height <= h + 0.01),
        Flow::Horizontal => spec.width.is_none_or(|w| run.width <= w + 0.01),
    };
    long && spec
        .max_lines
        .is_none_or(|max| run.lines <= usize::from(max))
}
