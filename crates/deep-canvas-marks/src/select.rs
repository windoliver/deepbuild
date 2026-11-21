//! Issue #1498: where a text item's graphemes are drawn, for a text selection (canvas primitives: Selection, "Text
//! selects too"; Text `text@1`). A text selects by its source text in logical order, never by the order it is drawn
//! in: each grapheme of the source has its place on a line of the shaped run the item is drawn from, so a press finds
//! the caret between two graphemes, a drag's two carets name a range of the source, and a copy is that range's bytes
//! as the document holds them. An ellipsis stands for the rest of its source, so a cut text copies whole; a bound
//! value's source is what it shows, with its unit. A selection across items copies each item's part on a line of its
//! own, in reading order: by center y, then x.

use std::ops::Range;

use deep_text::{unicode::grapheme_starts, Shaped, Shaper};

use crate::scene::{Frame, Mark};

/// One grapheme of a text's source as drawn: its bytes in the source, the line it is on, its left and right edges in
/// page units (#1215: in a vertical text, its top and bottom on its column), and whether its run goes right to left.
#[derive(Clone, Debug, PartialEq)]
pub struct Place {
    pub bytes: Range<usize>,
    pub line: usize,
    pub x: [f64; 2],
    pub rtl: bool,
}

/// A text item as drawn: its source text, its box and each line's top and height in page units, and the place of
/// each grapheme of its source. #1215: a vertical text's lines are its columns, each its left edge and width, in
/// reading order, and its places run down them.
#[derive(Clone, Debug, PartialEq)]
pub struct TextBox {
    pub item: String,
    pub source: String,
    pub rect: [f64; 4],
    pub lines: Vec<[f64; 2]>,
    pub places: Vec<Place>,
    pub vertical: bool,
}

/// The wrong programs #1498's suite proves its tests fail on.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// A copy holds a text's selected graphemes in the order they are drawn, left to right on each line.
    pub drawn_order: bool,
    /// A copy joins the selected items in their draw order.
    pub draw_order: bool,
}

/// Every text item `frame` draws, in draw order, each shaped as it is drawn (the shaped-run cache gives the run the
/// renderer drew).
pub fn texts(frame: &Frame, shaper: &mut Shaper) -> Vec<TextBox> {
    let mut out: Vec<TextBox> = Vec::new();
    for drawn in frame.layers.iter().flat_map(|l| &l.marks) {
        let Mark::Text {
            item, spec, origin, ..
        } = &drawn.mark
        else {
            continue;
        };
        // A list's markers and a gutter's numbers are marks of their own, named `<item>#<part>`.
        if item.contains('#') || out.iter().any(|t| &t.item == item) {
            continue;
        }
        let Some(s) = spec.shaper_spec() else {
            continue;
        };
        let shaped = shaper.shape(&s);
        out.push(TextBox::new(item, &spec.text, *origin, &shaped, spec.width));
    }
    out
}

impl TextBox {
    /// `source` drawn as `shaped` from `origin`, its top left, in a box `width` wide.
    pub fn new(
        item: &str,
        source: &str,
        origin: [f64; 2],
        shaped: &Shaped,
        width: Option<f64>,
    ) -> TextBox {
        let vertical = matches!(shaped.flow, deep_text::Flow::Vertical(_));
        // Where a line's positions start: the text's left edge, or (#1215) a vertical text's top.
        let start = if vertical { origin[1] } else { origin[0] };
        let shown = grapheme_starts(&shaped.shown).len();
        // Each shown grapheme's left and right edges and baseline, from its glyphs; in a vertical text its top and
        // bottom on its column, and its column's axis.
        let mut drawn: Vec<Option<([f64; 2], f64)>> = vec![None; shown];
        // The origin and end of the last grapheme placed: a digit run set across shares one origin, and its graphemes
        // take its cell in turn.
        let mut stacked: Option<([f32; 2], f64)> = None;
        for g in &shaped.glyphs {
            let Some(d) = drawn.get_mut(g.grapheme) else {
                continue;
            };
            let (a, b, line) = if vertical {
                let first = d.is_none();
                let y = match stacked {
                    Some((o, end)) if first && o == g.origin => end,
                    _ => f64::from(g.origin[1]),
                };
                let end = y + f64::from(g.along);
                if first {
                    stacked = Some((g.origin, end));
                }
                (y, end, f64::from(g.origin[0]))
            } else {
                (f64::from(g.x), f64::from(g.x + g.advance), f64::from(g.y))
            };
            let (a, b) = (a.min(b), a.max(b));
            *d = Some(match *d {
                Some(([x0, x1], y)) => ([x0.min(a), x1.max(b)], y),
                None => ([a, b], line),
            });
        }
        let height = f64::from(shaped.line_height);
        let mut baselines: Vec<f64> = drawn.iter().flatten().map(|(_, y)| *y).collect();
        let mut lines: Vec<[f64; 2]> = if vertical {
            // Columns in reading order, the order their graphemes come in, each a line height wide about its axis.
            let mut axes: Vec<f64> = Vec::new();
            for x in baselines {
                if !axes.iter().any(|a| (a - x).abs() < 0.5) {
                    axes.push(x);
                }
            }
            baselines = axes;
            baselines
                .iter()
                .map(|x| [origin[0] + x - height / 2.0, height])
                .collect()
        } else {
            baselines.sort_by(f64::total_cmp);
            baselines.dedup_by(|a, b| (*a - *b).abs() < 0.5);
            // The first line's top is the run's: every line sits as far above its baseline.
            let first = baselines.first().copied().unwrap_or(0.0);
            baselines
                .iter()
                .map(|y| [origin[1] + y - first, height])
                .collect()
        };
        if lines.is_empty() {
            lines.push(if vertical {
                [origin[0], height]
            } else {
                [origin[1], height]
            });
        }
        let line_of = |y: f64| {
            baselines
                .iter()
                .position(|b| (b - y).abs() < 0.5)
                .unwrap_or(0)
        };
        let starts = grapheme_starts(source);
        let count = starts.len();
        // A cut text's last shown grapheme is its ellipsis, which stands for the source from where the cut fell.
        let cut = shaped
            .ellipsized
            .then(|| shown.saturating_sub(1))
            .filter(|c| *c < count);
        let mut places: Vec<Place> = Vec::with_capacity(count);
        for k in 0..count {
            let bytes = starts[k]..starts.get(k + 1).copied().unwrap_or(source.len());
            let (s, share) = match cut {
                Some(c) if k >= c => (c, Some((k - c, count - c))),
                _ => (k.min(shown.saturating_sub(1)), None),
            };
            let place = match drawn.get(s).copied().flatten() {
                Some(([x0, x1], y)) => {
                    let [x0, x1] = match share {
                        Some((i, n)) => {
                            let w = (x1 - x0) / n as f64;
                            [x0 + w * i as f64, x0 + w * (i + 1) as f64]
                        }
                        None => [x0, x1],
                    };
                    Place {
                        bytes,
                        line: line_of(y),
                        x: [start + x0, start + x1],
                        rtl: false,
                    }
                }
                // A grapheme with no glyph of its own, a line's break or a ligature's second part: where the one
                // before it ends.
                None => {
                    let (line, at) = places.last().map_or((0, start), |p: &Place| {
                        (p.line, if p.rtl { p.x[0] } else { p.x[1] })
                    });
                    Place {
                        bytes,
                        line,
                        x: [at, at],
                        rtl: false,
                    }
                }
            };
            places.push(place);
        }
        // A grapheme goes right to left when the next one on its line is drawn to its left, or the one before to its
        // right.
        let rtl: Vec<bool> = (0..count)
            .map(|k| {
                let p = &places[k];
                let drawn = |q: &Place| q.line == p.line && q.x[1] > q.x[0];
                let next = places
                    .get(k + 1)
                    .is_some_and(|q| drawn(q) && q.x[1] <= p.x[0] + 0.5);
                let before = k
                    .checked_sub(1)
                    .and_then(|j| places.get(j))
                    .is_some_and(|q| drawn(q) && q.x[0] >= p.x[1] - 0.5);
                p.x[1] > p.x[0] && (next || before)
            })
            .collect();
        for (p, rtl) in places.iter_mut().zip(rtl) {
            p.rtl = rtl;
        }
        let rect = if vertical {
            // Its columns across, and down to the longest column's end.
            let left = lines.iter().map(|l| l[0]).fold(f64::MAX, f64::min);
            let right = lines.iter().map(|l| l[0] + l[1]).fold(f64::MIN, f64::max);
            let end = places.iter().map(|p| p.x[1]).fold(origin[1], f64::max);
            [left, origin[1], right - left, end - origin[1]]
        } else {
            let w = width.unwrap_or(f64::from(shaped.width));
            let top = lines[0][0];
            let bottom = lines.last().map_or(top, |l| l[0] + l[1]);
            [origin[0], top, w, bottom - top]
        };
        TextBox {
            item: item.to_owned(),
            source: source.to_owned(),
            rect,
            lines,
            places,
            vertical,
        }
    }

    /// Its source's graphemes, the last caret's offset.
    pub fn len(&self) -> usize {
        self.places.len()
    }

    pub fn is_empty(&self) -> bool {
        self.places.is_empty()
    }

    /// The caret before grapheme `offset` of the source, `len()` the one after its last: `[x, top, height]` in page
    /// units. Before a grapheme drawn right to left it is at its right edge. #1215: a vertical text's caret lies
    /// across its column, `[y, left, width]`.
    pub fn caret(&self, offset: usize) -> [f64; 3] {
        let line = |l: usize| self.lines.get(l).copied().unwrap_or(self.lines[0]);
        match (self.places.get(offset), self.places.last()) {
            (Some(p), _) => {
                let [top, h] = line(p.line);
                [if p.rtl { p.x[1] } else { p.x[0] }, top, h]
            }
            (None, Some(p)) => {
                let [top, h] = line(p.line);
                [if p.rtl { p.x[0] } else { p.x[1] }, top, h]
            }
            (None, None) if self.vertical => [self.rect[1], self.lines[0][0], self.lines[0][1]],
            (None, None) => [self.rect[0], self.rect[1], self.lines[0][1]],
        }
    }

    /// #1215: the caret before grapheme `offset` as a segment `[x0, y0, x1, y1]` in page units: down its line's
    /// height, or across a vertical text's column.
    pub fn caret_segment(&self, offset: usize) -> [f64; 4] {
        let [along, from, size] = self.caret(offset);
        if self.vertical {
            [from, along, from + size, along]
        } else {
            [along, from, along, from + size]
        }
    }

    /// #1215: the grapheme whose box holds the page point `c`: on the line (a vertical text's column) that holds it,
    /// the one whose extent along the line does; `None` when none does.
    pub fn index_at(&self, c: [f64; 2]) -> Option<usize> {
        let (along, across) = if self.vertical {
            (c[1], c[0])
        } else {
            (c[0], c[1])
        };
        let line = self
            .lines
            .iter()
            .position(|[from, size]| across >= *from && across < from + size)?;
        self.places
            .iter()
            .position(|p| p.line == line && p.x[0] <= along && along < p.x[1])
    }

    /// The caret nearest the page point `c`: on the line `c` is on, or the nearest line, before or after the
    /// grapheme under it by which half `c` is in, in the grapheme's own direction (#1215: in a vertical text, the
    /// column `c` is in, and above or below the grapheme's middle).
    pub fn offset_at(&self, c: [f64; 2]) -> usize {
        let c = if self.vertical { [c[1], c[0]] } else { c };
        let away = |[top, h]: [f64; 2]| (top - c[1]).max(c[1] - (top + h)).max(0.0);
        let line = (0..self.lines.len())
            .min_by(|a, b| away(self.lines[*a]).total_cmp(&away(self.lines[*b])))
            .unwrap_or(0);
        let on: Vec<usize> = (0..self.places.len())
            .filter(|k| self.places[*k].line == line && self.places[*k].x[1] > self.places[*k].x[0])
            .collect();
        let off = |k: &usize| {
            let x = self.places[*k].x;
            (x[0] - c[0]).max(c[0] - x[1]).max(0.0)
        };
        let Some(k) = on.iter().copied().min_by(|a, b| off(a).total_cmp(&off(b))) else {
            // A line with no glyph: the caret of its first grapheme.
            return (0..self.places.len())
                .find(|k| self.places[*k].line == line)
                .unwrap_or(self.places.len());
        };
        let p = &self.places[k];
        let left = c[0] < (p.x[0] + p.x[1]) / 2.0;
        if left != p.rtl {
            k
        } else {
            k + 1
        }
    }

    /// The source's bytes from caret `from` to caret `to`, in logical order; with `drawn_order`, the planted wrong
    /// program's: the graphemes between them in the order they are drawn, left to right on each line.
    pub fn copy(&self, range: Range<usize>, drawn_order: bool) -> String {
        let (from, to) = (range.start.min(self.len()), range.end.min(self.len()));
        if from >= to {
            return String::new();
        }
        if drawn_order {
            let mut at: Vec<&Place> = self.places[from..to].iter().collect();
            at.sort_by(|a, b| a.line.cmp(&b.line).then(a.x[0].total_cmp(&b.x[0])));
            return at.iter().map(|p| &self.source[p.bytes.clone()]).collect();
        }
        self.source[self.places[from].bytes.start..self.places[to - 1].bytes.end].to_owned()
    }

    /// Where the range from caret `from` to caret `to` is drawn: a box on each line it takes, in page units.
    pub fn outline(&self, range: Range<usize>) -> Vec<[f64; 4]> {
        let (from, to) = (range.start.min(self.len()), range.end.min(self.len()));
        let mut out = Vec::new();
        for (l, [top, h]) in self.lines.iter().enumerate() {
            let xs = self.places[from..to.max(from)]
                .iter()
                .filter(|p| p.line == l)
                .flat_map(|p| p.x);
            let (lo, hi) = xs.fold((f64::MAX, f64::MIN), |(lo, hi), x| (lo.min(x), hi.max(x)));
            if hi > lo {
                out.push(if self.vertical {
                    [*top, lo, *h, hi - lo]
                } else {
                    [lo, *top, hi - lo, *h]
                });
            }
        }
        out
    }
}

/// The text item nearest page point `c`, the topmost of those under it, and the caret there: with `within`, only
/// an item that far from `c` or nearer, in page units.
pub fn at(texts: &[TextBox], c: [f64; 2], within: Option<f64>) -> Option<(String, usize)> {
    let away = |t: &TextBox| {
        let [x, y, w, h] = t.rect;
        let dx = (x - c[0]).max(c[0] - (x + w)).max(0.0);
        let dy = (y - c[1]).max(c[1] - (y + h)).max(0.0);
        dx.hypot(dy)
    };
    let t = texts
        .iter()
        .rev()
        .min_by(|a, b| away(a).total_cmp(&away(b)))
        .filter(|t| within.is_none_or(|m| away(t) <= m))?;
    Some((t.item.clone(), t.offset_at(c)))
}

/// #1215: the text item and the grapheme whose box holds page point `c`, the topmost text first.
pub fn index_at(texts: &[TextBox], c: [f64; 2]) -> Option<(String, usize)> {
    texts
        .iter()
        .rev()
        .find_map(|t| Some((t.item.clone(), t.index_at(c)?)))
}

/// The items' indices in reading order: by center y, then x.
fn reading(texts: &[TextBox]) -> Vec<usize> {
    let center = |t: &TextBox| [t.rect[0] + t.rect[2] / 2.0, t.rect[1] + t.rect[3] / 2.0];
    let mut order: Vec<usize> = (0..texts.len()).collect();
    order.sort_by(|a, b| {
        let (a, b) = (center(&texts[*a]), center(&texts[*b]));
        a[1].total_cmp(&b[1]).then(a[0].total_cmp(&b[0]))
    });
    order
}

/// What a selection from caret `a` to caret `b` (each an item and an offset) takes: each item's index and its range,
/// in reading order. Every item between the two in reading order is taken whole.
fn parts(texts: &[TextBox], a: (&str, usize), b: (&str, usize)) -> Vec<(usize, Range<usize>)> {
    let order = reading(texts);
    let rank = |item: &str| order.iter().position(|i| texts[*i].item == item);
    let (Some(ra), Some(rb)) = (rank(a.0), rank(b.0)) else {
        return Vec::new();
    };
    let ((r0, o0), (r1, o1)) = if (ra, a.1) <= (rb, b.1) {
        ((ra, a.1), (rb, b.1))
    } else {
        ((rb, b.1), (ra, a.1))
    };
    (r0..=r1)
        .map(|r| {
            let i = order[r];
            let n = texts[i].len();
            let from = if r == r0 { o0 } else { 0 };
            let to = if r == r1 { o1 } else { n };
            (i, from..to)
        })
        .collect()
}

/// The text a selection from caret `a` to caret `b` copies: each item's part in logical order, items in reading
/// order, each on a line of its own.
pub fn copy(texts: &[TextBox], a: (&str, usize), b: (&str, usize), planted: Planted) -> String {
    let mut taken = parts(texts, a, b);
    // The planted wrong program joins them in draw order, which `texts` is in.
    if planted.draw_order {
        taken.sort_by_key(|(i, _)| *i);
    }
    taken
        .into_iter()
        .map(|(i, range)| texts[i].copy(range, planted.drawn_order))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Where a selection from caret `a` to caret `b` is drawn: its boxes on each line of each item, in page units.
pub fn outline(texts: &[TextBox], a: (&str, usize), b: (&str, usize)) -> Vec<[f64; 4]> {
    parts(texts, a, b)
        .into_iter()
        .flat_map(|(i, range)| texts[i].outline(range))
        .collect()
}
