//! The one shaper. A text is shaped once per run by parley (HarfRust shaping, UAX #14 line
//! breaks, UAX #9 bidi), from the bundled fonts alone; the shaped run is the only source for
//! layout, the fit check and drawing (canvas primitives: Text `text@1`, Semantics).

use std::sync::Arc;

use parley::fontique::{Collection, CollectionOptions, SourceCache};
use parley::{
    Alignment, AlignmentOptions, FontContext, FontData, FontFamily, FontFamilyName, FontStyle,
    FontWeight, Language, Layout, LayoutContext, LineHeight, PositionedLayoutItem, StyleProperty,
    VerticalAlign,
};
use skrifa::raw::TableProvider;

use crate::cache::{Key, Planted, RunCache};
use crate::fonts::{Face, Role, FACES};
use crate::unicode::is_default_ignorable;
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
    /// The bundled family the run is set in: a font role's face, as the look names it.
    pub family: &'a str,
    /// #417: bundled families in order; a grapheme the family lacks is set in the first that has it.
    pub fallback: &'a [&'a str],
    /// #417: the language the run is shaped in (BCP 47), such as `zh-Hans` for Simplified forms.
    pub lang: Option<&'a str>,
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
    /// #1964: styled spans of the one run, shaped with it.
    pub spans: &'a [Span],
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

/// The `[size, rise]` ratios of an em a face sets its subscripts or superscripts at, from its
/// OS/2 table; `None` for a face without one.
fn script_metrics(family: &str, shift: Shift) -> Option<[f32; 2]> {
    let face = FACES.iter().find(|f| f.family == family)?;
    let font = skrifa::FontRef::new(face.bytes).ok()?;
    let em = f32::from(font.head().ok()?.units_per_em().max(1));
    let os2 = font.os2().ok()?;
    let [size, offset] = match shift {
        Shift::Sub => [os2.y_subscript_y_size(), -os2.y_subscript_y_offset()],
        Shift::Super => [os2.y_superscript_y_size(), os2.y_superscript_y_offset()],
        Shift::By(_) => return None,
    };
    (size > 0).then(|| [f32::from(size) / em, f32::from(offset) / em])
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
    /// empty for a static face; outlines and rasters read the glyph at them.
    pub coords: Arc<[i16]>,
    /// #1964: the slant in degrees an italic span is drawn at where its face has no italic (0:
    /// upright), leaning forward as y rises.
    pub skew: f32,
    /// The bundled face the glyph is set in, by its index in [`FACES`]: known from the blob the
    /// shaper registered for that face, never by comparing bytes.
    pub face: Option<usize>,
}

impl Glyph {
    /// The bundled face the glyph is set in.
    pub fn face(&self) -> Option<&'static Face> {
        FACES.get(self.face?)
    }
}

/// #1964: an underline or a strike of a styled span: `[x, y, w, h]` in logical pixels from the
/// run's origin (y down), at its face's own offset and thickness, painted as its first grapheme.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Decoration {
    pub rect: [f32; 4],
    pub grapheme: usize,
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

/// The shaper: a font collection of the bundled faces, parley's layout context and the
/// shaped-run cache it keeps its runs in.
pub struct Shaper {
    pub(crate) fonts: FontContext,
    pub(crate) layout: LayoutContext<()>,
    cache: Arc<RunCache>,
}

impl Default for Shaper {
    fn default() -> Self {
        Self::new()
    }
}

impl Shaper {
    /// A shaper over the bundled fonts and nothing else (no system fonts are loaded), with a
    /// shaped-run cache of its own.
    pub fn new() -> Self {
        Self::sharing(Arc::default())
    }

    /// A shaper over the bundled fonts that keeps its runs in `cache`, its host's: every shaper
    /// the host lends the cache to shares its runs.
    pub fn sharing(cache: Arc<RunCache>) -> Self {
        let mut collection = Collection::new(CollectionOptions {
            shared: false,
            system_fonts: false,
        });
        for blob in cache.blobs() {
            collection.register_fonts(blob.clone(), None);
        }
        Shaper {
            fonts: FontContext {
                collection,
                source_cache: SourceCache::default(),
            },
            layout: LayoutContext::new(),
            cache,
        }
    }

    /// The shaped-run cache the shaper keeps its runs in.
    pub fn cache(&self) -> &Arc<RunCache> {
        &self.cache
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
        // The family first, then the fallback families in order: parley sets each cluster in the
        // first family of the list whose face maps it.
        let families: Vec<FontFamilyName<'_>> = std::iter::once(spec.family)
            .chain(spec.fallback.iter().copied())
            .map(FontFamilyName::named)
            .collect();
        builder.push_default(StyleProperty::FontFamily(FontFamily::List(families.into())));
        if let Some(lang) = spec.lang {
            builder.push_default(StyleProperty::Locale(Language::parse(lang).ok()));
        }
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
        // #1964: each span restyles its graphemes' byte range of the one run, so the layout shapes
        // and breaks it with the rest. A span's box adds no height: the item's line height alone
        // spaces the lines, so a shift or a size never moves a baseline.
        let starts = grapheme_starts(text);
        let byte = |g: usize| starts.get(g).copied().unwrap_or(text.len());
        for span in spec.spans {
            let range = byte(span.from)..byte(span.to);
            if range.is_empty() {
                continue;
            }
            let family = span.family.unwrap_or(spec.family);
            if span.family.is_some() {
                let families: Vec<FontFamilyName<'_>> = std::iter::once(family)
                    .chain(spec.fallback.iter().copied())
                    .map(FontFamilyName::named)
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

    fn collect(&self, layout: &Layout<()>, max_lines: Option<u16>, shown: &str) -> Shaped {
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
                let face = self
                    .cache
                    .blobs()
                    .iter()
                    .position(|b| b.id() == font.data.id());
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
                    shaped.decorations.push(Decoration {
                        rect: [
                            run.offset(),
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
                    shaped.glyphs.push(Glyph {
                        font: font.clone(),
                        size,
                        id: glyph.id,
                        x: glyph.x,
                        y: glyph.y,
                        advance: glyph.advance,
                        grapheme: grapheme(byte),
                        coords: coords.clone(),
                        skew,
                        face,
                    });
                }
            }
        }
        shaped
    }

    /// `text` shaped in the spec's style, whole (no line limit applied): from the shaped-run
    /// cache, or shaped now and kept there.
    fn run(&mut self, spec: &Spec<'_>, text: &str) -> Arc<Shaped> {
        let key = Key::of(&self.cache, spec, text, false);
        if let Some(run) = self.cache.get(&key) {
            return run;
        }
        let run = self.shape_now(spec, text, &key);
        self.cache.put(key, run)
    }

    /// `text` shaped in the spec's style, past the cache, the shaping recorded.
    fn shape_now(&mut self, spec: &Spec<'_>, text: &str, key: &Key) -> Shaped {
        let layout = self.layout(spec, text);
        let run = self.collect(&layout, None, text);
        self.cache.shaped(key, run.glyphs.len());
        run
    }

    /// Shapes `spec.text`, once per run: a run the shaped-run cache holds is shared, not shaped
    /// again. Text that overflows its box or line limit is cut to fit with an ellipsis; a bound
    /// value or masked text never is, and is drawn whole.
    pub fn shape(&mut self, spec: &Spec<'_>) -> Arc<Shaped> {
        let fitted = Key::of(&self.cache, spec, spec.text, true);
        if let Some(run) = self.cache.get(&fitted) {
            return run;
        }
        let whole = self.run(spec, spec.text);
        let overflows = spec.width.is_some_and(|w| whole.width > w + 0.01)
            || spec
                .max_lines
                .is_some_and(|max| whole.lines > usize::from(max));
        if !overflows || spec.bound || spec.mask {
            return whole;
        }
        let reshaping = self.cache.planted() == Some(Planted::ReshapingFit);
        // The longest prefix, by character, whose run with an ellipsis fits. Each candidate's
        // run comes through the cache, so no prefix is shaped twice; a candidate that fits its
        // line limit has no line past it, so its whole run is the one drawn.
        let chars: Vec<(usize, char)> = spec.text.char_indices().collect();
        let (mut low, mut high) = (0usize, chars.len());
        let mut best: Option<Arc<Shaped>> = None;
        while low < high {
            if reshaping {
                let key = Key::of(&self.cache, spec, spec.text, false);
                self.shape_now(spec, spec.text, &key);
            }
            let mid = (low + high).div_ceil(2);
            let end = chars.get(mid).map_or(spec.text.len(), |(i, _)| *i);
            let candidate = format!("{}…", spec.text[..end].trim_end());
            let shaped = self.run(spec, &candidate);
            let fits = spec.width.is_none_or(|w| shaped.width <= w + 0.01)
                && spec
                    .max_lines
                    .is_none_or(|max| shaped.lines <= usize::from(max));
            if fits {
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
        self.cache.put(fitted, best)
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

    /// The fit check: shapes `widest` (the spec's own text when `None`) as the spec would and
    /// reads whether it fits the box and the line limit. A bound value's numerals are tabular.
    pub fn fit(&mut self, spec: &Spec<'_>, widest: Option<&str>) -> Fit {
        let shaped = self.run(spec, widest.unwrap_or(spec.text));
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
