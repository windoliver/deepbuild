//! The one shaper. A text is shaped once per spec by parley (HarfRust shaping, UAX #14 line
//! breaks, UAX #9 bidi), from the bundled fonts alone; the shaped run is the only source for
//! layout, the fit check and drawing (canvas primitives: Text `text@1`, Semantics).

use parley::fontique::{Collection, CollectionOptions, SourceCache};
use parley::{
    Alignment, AlignmentOptions, FontContext, FontData, FontFamily, FontWeight, Layout,
    LayoutContext, LineHeight, PositionedLayoutItem, StyleProperty,
};

use crate::fonts::{self, Role, FACES};
use crate::unicode::{grapheme_starts, LineBreaks};

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
    pub role: Role,
    /// Font size in logical pixels (`size: f32, u = 13`).
    pub size: f32,
    /// `weight: u16 = 400`; the shaper picks the nearest bundled face.
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
}

impl<'a> Spec<'a> {
    /// A label in the body role at the defaults.
    pub fn label(text: &'a str) -> Self {
        Spec {
            text,
            role: Role::Body,
            size: 13.,
            weight: 400,
            line_height: None,
            width: None,
            max_lines: None,
            align: Align::Start,
            bound: false,
            tabular: false,
            mask: false,
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
    /// The grapheme cluster (UAX #29) of the shown text the glyph belongs to.
    pub grapheme: usize,
}

/// A shaped text: its glyphs and the box they take.
#[derive(Clone, Debug, Default)]
pub struct Shaped {
    pub glyphs: Vec<Glyph>,
    /// The widest line's advance, in logical pixels.
    pub width: f32,
    /// The lines' heights summed.
    pub height: f32,
    pub lines: usize,
    /// True when the text was cut to fit its box with an ellipsis (never for a bound value).
    pub ellipsized: bool,
    /// The text as drawn: the spec's text, or its cut with an ellipsis.
    pub shown: String,
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

    fn layout(&mut self, spec: &Spec<'_>, text: &str) -> Layout<()> {
        let decide = LineBreaks::new(text).into_override();
        let mut builder = self
            .layout
            .ranged_builder(&mut self.fonts, text, 1.0, false);
        // Lines break at UAX #14's opportunities at the pinned Unicode version (17.0.0).
        builder.set_line_break_override(Some(&*decide));
        builder.push_default(StyleProperty::FontFamily(FontFamily::named(
            spec.role.family(),
        )));
        builder.push_default(StyleProperty::FontSize(spec.size));
        builder.push_default(StyleProperty::FontWeight(FontWeight::new(f32::from(
            spec.weight,
        ))));
        builder.push_default(StyleProperty::LineHeight(LineHeight::Absolute(
            spec.line_height(),
        )));
        if spec.tabular {
            builder.push_default(StyleProperty::FontFeatures("\"tnum\" 1".into()));
        }
        let mut layout = builder.build(text);
        // A bound value is never wrapped: it stays on one line, past its box if it must.
        layout.break_all_lines(if spec.bound { None } else { spec.width });
        let alignment = match spec.align {
            Align::Start => Alignment::Start,
            Align::Center => Alignment::Center,
            Align::End => Alignment::End,
        };
        layout.align(alignment, AlignmentOptions::default());
        layout
    }

    fn collect(layout: &Layout<()>, max_lines: Option<u16>, shown: &str) -> Shaped {
        let mut shaped = Shaped {
            shown: shown.to_owned(),
            ..Shaped::default()
        };
        let starts = grapheme_starts(shown);
        let grapheme = |byte: usize| starts.partition_point(|&s| s <= byte).saturating_sub(1);
        for (index, line) in layout.lines().enumerate() {
            if max_lines.is_some_and(|max| index >= usize::from(max)) {
                break;
            }
            let metrics = line.metrics();
            shaped.lines += 1;
            shaped.width = shaped.width.max(metrics.advance);
            shaped.height += metrics.line_height;
            for item in line.items() {
                let PositionedLayoutItem::GlyphRun(run) = item else {
                    continue;
                };
                let font = run.run().font().clone();
                let size = run.run().font_size();
                // The run's clusters in the order its glyphs are drawn, each with its glyphs.
                let clusters = run.run().visual_clusters().flat_map(|c| {
                    let first = c.text_range().start;
                    c.glyphs().map(move |_| first)
                });
                for (glyph, byte) in run.positioned_glyphs().zip(clusters) {
                    shaped.glyphs.push(Glyph {
                        font: font.clone(),
                        size,
                        id: glyph.id,
                        x: glyph.x,
                        y: glyph.y,
                        grapheme: grapheme(byte),
                    });
                }
            }
        }
        shaped
    }

    /// Shapes `spec.text`. Text that overflows its box or line limit is cut to fit with an
    /// ellipsis; a bound value or masked text never is, and is drawn whole.
    pub fn shape(&mut self, spec: &Spec<'_>) -> Shaped {
        let layout = self.layout(spec, spec.text);
        let whole = Self::collect(&layout, None, spec.text);
        let overflows = spec.width.is_some_and(|w| whole.width > w + 0.01)
            || spec
                .max_lines
                .is_some_and(|max| whole.lines > usize::from(max));
        if !overflows || spec.bound || spec.mask {
            return whole;
        }
        // The longest prefix, by character, whose shape with an ellipsis fits.
        let chars: Vec<(usize, char)> = spec.text.char_indices().collect();
        let (mut low, mut high) = (0usize, chars.len());
        let mut best = Shaped::default();
        while low < high {
            let mid = (low + high).div_ceil(2);
            let end = chars.get(mid).map_or(spec.text.len(), |(i, _)| *i);
            let candidate = format!("{}…", spec.text[..end].trim_end());
            let layout = self.layout(spec, &candidate);
            let shaped = Self::collect(&layout, spec.max_lines, &candidate);
            let fits = spec.width.is_none_or(|w| shaped.width <= w + 0.01)
                && spec
                    .max_lines
                    .is_none_or(|max| layout.lines().count() <= usize::from(max));
            if fits {
                best = shaped;
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        if best.glyphs.is_empty() {
            let layout = self.layout(spec, "…");
            best = Self::collect(&layout, spec.max_lines, "…");
        }
        best.ellipsized = true;
        best
    }

    /// The fit check: shapes `widest` (the spec's own text when `None`) as the spec would and
    /// reads whether it fits the box and the line limit. A bound value's numerals are tabular.
    pub fn fit(&mut self, spec: &Spec<'_>, widest: Option<&str>) -> Fit {
        let text = widest.unwrap_or(spec.text);
        let layout = self.layout(spec, text);
        let shaped = Self::collect(&layout, None, text);
        let fits = spec.width.is_none_or(|w| shaped.width <= w + 0.01)
            && spec
                .max_lines
                .is_none_or(|max| shaped.lines <= usize::from(max));
        Fit {
            fits,
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
