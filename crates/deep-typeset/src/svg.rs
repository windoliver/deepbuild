//! The SVG the job writes: every glyph an outline and every rule a path, each in the group of the
//! part it belongs to, painted only in `currentColor`, with no `<text>`, no `<use>` and no outside
//! reference. Coordinates are absolute and written to hundredths, so the same frame gives the same
//! bytes. A part's glyphs are known by the fill the job's main file tagged them with.

use std::fmt::Write as _;

use typst::layout::{Abs, Frame, FrameItem, Point, Ratio, Size, Transform};
use typst::text::TextItem;
use typst::visualize::{Curve, CurveItem, Geometry, Paint, Shape};

/// The fill that tags part `i`: rgb(1, i ÷ 256, i mod 256).
pub fn tag(i: usize) -> [u8; 3] {
    [1, (i / 256) as u8, (i % 256) as u8]
}

fn part_of(paint: &Paint, parts: usize) -> Option<usize> {
    let Paint::Solid(color) = paint else {
        return None;
    };
    let [r, g, b, _] = color.to_vec4_u8();
    let i = usize::from(g) * 256 + usize::from(b);
    (r == 1 && i < parts).then_some(i)
}

/// What one part drew: its paths, its box and its glyph count.
#[derive(Default)]
pub struct Drawn {
    pub paths: Vec<String>,
    pub glyphs: u32,
    bounds: Option<[f64; 4]>,
}

impl Drawn {
    /// The box `[x, y, w, h]`, rounded as the SVG's coordinates are.
    pub fn bbox(&self) -> [f64; 4] {
        self.bounds.map_or([0.0; 4], |[x0, y0, x1, y1]| {
            [round(x0), round(y0), round(x1 - x0), round(y1 - y0)]
        })
    }

    fn grow(&mut self, x: f64, y: f64) {
        let b = self.bounds.get_or_insert([x, y, x, y]);
        b[0] = b[0].min(x);
        b[1] = b[1].min(y);
        b[2] = b[2].max(x);
        b[3] = b[3].max(y);
    }
}

/// Walks a page frame and gives each part what it drew; an item whose fill tags no part goes to
/// the part drawn before it.
pub fn draw(frame: &Frame, parts: usize) -> Vec<Drawn> {
    let mut out: Vec<Drawn> = (0..parts).map(|_| Drawn::default()).collect();
    let mut last = 0;
    walk(frame, Transform::identity(), &mut out, &mut last);
    out
}

fn walk(frame: &Frame, ts: Transform, out: &mut [Drawn], last: &mut usize) {
    for (pos, item) in frame.items() {
        let ts = ts.pre_concat(Transform::translate(pos.x, pos.y));
        match item {
            FrameItem::Group(group) => {
                walk(&group.frame, ts.pre_concat(group.transform), out, last)
            }
            FrameItem::Text(text) => {
                let i = part_of(&text.fill, out.len()).unwrap_or(*last);
                *last = i;
                text_paths(text, ts, &mut out[i]);
            }
            FrameItem::Shape(shape, _) => {
                let paint = shape
                    .fill
                    .as_ref()
                    .or(shape.stroke.as_ref().map(|s| &s.paint));
                let i = paint.and_then(|p| part_of(p, out.len())).unwrap_or(*last);
                *last = i;
                shape_path(shape, ts, &mut out[i]);
            }
            FrameItem::Image(..) | FrameItem::Link(..) | FrameItem::Tag(_) => {}
        }
    }
}

fn text_paths(text: &TextItem, ts: Transform, drawn: &mut Drawn) {
    // Fonts are y-up: flip, as Typst's own exporter does.
    let ts = ts.pre_concat(Transform::scale(Ratio::one(), -Ratio::one()));
    let scale = text.size.to_pt() / text.font.units_per_em();
    let face = text.font.ttf();
    let (mut x, mut y) = (Abs::zero(), Abs::zero());
    for glyph in &text.glyphs {
        let ox = (x + glyph.x_offset.at(text.size)).to_pt();
        let oy = (y + glyph.y_offset.at(text.size)).to_pt();
        let mut pen = Pen {
            ts,
            ox,
            oy,
            scale,
            d: String::new(),
            drawn,
        };
        if face
            .outline_glyph(ttf_parser::GlyphId(glyph.id), &mut pen)
            .is_some()
            && !pen.d.is_empty()
        {
            let d = std::mem::take(&mut pen.d);
            drawn
                .paths
                .push(format!("<path d=\"{d}\" fill=\"currentColor\"/>"));
        }
        drawn.glyphs += 1;
        x += glyph.x_advance.at(text.size);
        y += glyph.y_advance.at(text.size);
    }
}

/// A glyph's outline in the frame's space.
struct Pen<'a> {
    ts: Transform,
    ox: f64,
    oy: f64,
    scale: f64,
    d: String,
    drawn: &'a mut Drawn,
}

impl Pen<'_> {
    fn at(&mut self, x: f32, y: f32) -> String {
        let p = Point::new(
            Abs::pt(self.ox + f64::from(x) * self.scale),
            Abs::pt(self.oy + f64::from(y) * self.scale),
        )
        .transform(self.ts);
        let (x, y) = (p.x.to_pt(), p.y.to_pt());
        self.drawn.grow(x, y);
        format!("{} {}", num(x), num(y))
    }
}

impl ttf_parser::OutlineBuilder for Pen<'_> {
    fn move_to(&mut self, x: f32, y: f32) {
        let p = self.at(x, y);
        let _ = write!(self.d, "M{p}");
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let p = self.at(x, y);
        let _ = write!(self.d, "L{p}");
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let (a, p) = (self.at(x1, y1), self.at(x, y));
        let _ = write!(self.d, "Q{a} {p}");
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let (a, b, p) = (self.at(x1, y1), self.at(x2, y2), self.at(x, y));
        let _ = write!(self.d, "C{a} {b} {p}");
    }
    fn close(&mut self) {
        self.d.push('Z');
    }
}

fn shape_path(shape: &Shape, ts: Transform, drawn: &mut Drawn) {
    let mut d = String::new();
    let mut put = |c: char, pts: &[Point], d: &mut String| {
        d.push(c);
        for (k, p) in pts.iter().enumerate() {
            let p = p.transform(ts);
            drawn.grow(p.x.to_pt(), p.y.to_pt());
            if k > 0 {
                d.push(' ');
            }
            let _ = write!(d, "{} {}", num(p.x.to_pt()), num(p.y.to_pt()));
        }
    };
    let curve = match &shape.geometry {
        Geometry::Line(to) => Curve(vec![CurveItem::Move(Point::zero()), CurveItem::Line(*to)]),
        Geometry::Rect(Size { x: w, y: h }) => Curve(vec![
            CurveItem::Move(Point::zero()),
            CurveItem::Line(Point::new(*w, Abs::zero())),
            CurveItem::Line(Point::new(*w, *h)),
            CurveItem::Line(Point::new(Abs::zero(), *h)),
            CurveItem::Close,
        ]),
        Geometry::Curve(curve) => curve.clone(),
    };
    for item in &curve.0 {
        match item {
            CurveItem::Move(p) => put('M', &[*p], &mut d),
            CurveItem::Line(p) => put('L', &[*p], &mut d),
            CurveItem::Cubic(a, b, p) => put('C', &[*a, *b, *p], &mut d),
            CurveItem::Close => d.push('Z'),
        }
    }
    if shape.fill.is_some() {
        drawn
            .paths
            .push(format!("<path d=\"{d}\" fill=\"currentColor\"/>"));
    }
    if let Some(stroke) = &shape.stroke {
        // A stroke's width scales as the frame's area does.
        let k = (ts.sx.get() * ts.sy.get() - ts.kx.get() * ts.ky.get())
            .abs()
            .sqrt();
        drawn.paths.push(format!(
            "<path d=\"{d}\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"{}\"/>",
            num(stroke.thickness.to_pt() * k)
        ));
    }
}

/// A number to hundredths, as the SVG writes it, never negative zero.
pub fn round(v: f64) -> f64 {
    let r = (v * 100.0).round() / 100.0;
    if r == 0.0 {
        0.0
    } else {
        r
    }
}

/// A coordinate to hundredths, with no trailing zeros and no negative zero.
pub fn num(v: f64) -> String {
    let n = (v * 100.0).round() as i64;
    if n == 0 {
        return "0".into();
    }
    let (sign, n) = if n < 0 { ("-", -n) } else { ("", n) };
    let (int, frac) = (n / 100, n % 100);
    match frac {
        0 => format!("{sign}{int}"),
        f if f % 10 == 0 => format!("{sign}{int}.{}", f / 10),
        f => format!("{sign}{int}.{f:02}"),
    }
}

/// XML-escapes text for an attribute or an element.
pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\n' => out.push_str("&#10;"),
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_are_written_to_hundredths() {
        assert_eq!(num(0.004), "0");
        assert_eq!(num(-0.004), "0");
        assert_eq!(num(12.3456), "12.35");
        assert_eq!(num(12.3), "12.3");
        assert_eq!(num(-0.05), "-0.05");
        assert_eq!(num(7.0), "7");
    }
}
