//! One 2D writer layer as the live-headless comparison reads it (issue #140, criterion 6;
//! tests/acceptance/140/view/README.md, "deep-gpu: the live-headless calls"): its marks drawn alone
//! over transparent black, by Vello CPU as headless snapshots draw them ([`vello`]) and by GPUI's
//! offscreen Metal renderer as the app's frame draws them ([`gpui`]); every edge they draw,
//! flattened ([`edges`]); and each glyph run and stroke alone as a coverage mask ([`runs`]). The
//! oracle that compares the two is test code; nothing here judges.

use std::sync::Arc;

use deep_canvas_marks::scene::{Drawn, Fill, Mark, Palette};
use serde_json::Value;
use skrifa::instance::{LocationRef, Size};
use skrifa::outline::{DrawSettings, OutlinePen};
use skrifa::MetadataProvider;
use vello_cpu::kurbo::{self, BezPath, Circle, PathEl, RoundedRect, Shape, StrokeOpts};

use crate::status::label_of;
use crate::{palette_of, refused, Theme};

/// Curves flattened within this many device px into an edge's segments.
const EDGE_TOLERANCE: f64 = 0.05;

/// The palette a look (a shipped look's ID, a look@1 or a role map `{light, dark}`) gives a theme.
pub fn palette(look: &Value, theme: &str) -> Result<Palette, Value> {
    let theme = match theme {
        "light" => Theme::Light,
        "dark" => Theme::Dark,
        _ => return Err(refused("bad_input", "view/theme")),
    };
    match crate::look(Some(look)) {
        Some(Ok((look, _))) => Ok(palette_of(&look, theme).clone()),
        Some(Err(refusal)) => Err(refusal.to_json()),
        None => Err(refused("bad_input", "look")),
    }
}

/// The layer's marks over transparent black at `size` px, drawn by Vello CPU; straight alpha.
pub fn vello(marks: &[Arc<Drawn>], size: [u32; 2]) -> Result<image::RgbaImage, Value> {
    let marks: Vec<&Drawn> = marks.iter().map(|m| &**m).collect();
    crate::raster::picture(&marks, size)
}

/// The layer's marks over transparent black at `size` px, drawn by GPUI in a window of `cx` at
/// scale 1 and read back from GPUI's offscreen Metal renderer; straight alpha.
#[cfg(target_os = "macos")]
pub fn gpui(
    cx: &mut gpui_kit::HeadlessAppContext,
    marks: &[Arc<Drawn>],
    size: [u32; 2],
) -> Result<image::RgbaImage, Value> {
    let marks: Vec<&Drawn> = marks.iter().map(|m| &**m).collect();
    crate::macos::picture(cx, &marks, size)
}

/// A glyph run (a text item's) or a stroke (a path's) the layer draws, alone, in white: drawn
/// over transparent black, its alpha is its coverage.
pub struct Run {
    pub id: String,
    pub kind: &'static str,
    pub marks: Vec<Arc<Drawn>>,
}

const WHITE: [u8; 3] = [255, 255, 255];

/// Each glyph run and each stroke `marks` draw, in draw order, by item.
pub fn runs(marks: &[Arc<Drawn>]) -> Vec<Run> {
    let mut out: Vec<Run> = Vec::new();
    for drawn in marks {
        let alone = match &drawn.mark {
            Mark::Text {
                item,
                spec,
                origin,
                runs,
                ..
            } => Some((
                "glyphs",
                Mark::Text {
                    item: item.clone(),
                    spec: spec.clone(),
                    origin: *origin,
                    role: None,
                    color: WHITE,
                    runs: runs
                        .iter()
                        .map(|r| deep_canvas_marks::scene::TextRun {
                            color: WHITE,
                            ..r.clone()
                        })
                        .collect(),
                },
            )),
            Mark::Path {
                item,
                d,
                geometry,
                offset,
                ..
            } if geometry.stroke.is_some() => {
                let mut geometry = geometry.clone();
                geometry.fill = false;
                Some((
                    "stroke",
                    Mark::Path {
                        item: item.clone(),
                        d: d.clone(),
                        geometry,
                        offset: *offset,
                        color: WHITE,
                    },
                ))
            }
            Mark::Shape {
                item,
                verbs,
                stroke: Some(line),
                ..
            } => Some((
                "stroke",
                Mark::Shape {
                    item: item.clone(),
                    verbs: verbs.clone(),
                    fill: None,
                    stroke: Some(deep_canvas_marks::scene::Line {
                        paint: Fill::Solid(WHITE),
                        opacity: 1.0,
                        ..line.clone()
                    }),
                },
            )),
            _ => None,
        };
        let Some((kind, mark)) = alone else { continue };
        let id = drawn
            .mark
            .item()
            .split('#')
            .next()
            .unwrap_or_default()
            .to_string();
        let drawn = Arc::new(Drawn {
            mark,
            clip: drawn.clip,
            scopes: drawn.scopes.clone(),
        });
        match out.iter_mut().find(|r| r.id == id && r.kind == kind) {
            Some(run) => run.marks.push(drawn),
            None => out.push(Run {
                id,
                kind,
                marks: vec![drawn],
            }),
        }
    }
    out
}

/// Every edge `marks` draw, flattened into segments `[x0, y0, x1, y1]` in device px at zoom 1: a
/// rect's or an image's sides, a circle's rims, a path's outline (its stroke's, for a stroke) and
/// each glyph's outline.
pub fn edges(marks: &[Arc<Drawn>]) -> Result<Vec<[f64; 4]>, Value> {
    let mut out = Vec::new();
    for drawn in marks {
        match &drawn.mark {
            Mark::Rect { bounds, radius, .. } => {
                let b = *bounds;
                let r = radius.max(0.0).min(b[2] / 2.0).min(b[3] / 2.0);
                let shape = RoundedRect::new(b[0], b[1], b[0] + b[2], b[1] + b[3], r);
                segments(&shape.to_path(EDGE_TOLERANCE), &mut out);
            }
            Mark::Image { bounds, .. } => {
                segments(
                    &deep_marks_vello::rect(*bounds).to_path(EDGE_TOLERANCE),
                    &mut out,
                );
            }
            Mark::Circle {
                center, r, inner_r, ..
            } => {
                let c = (center[0], center[1]);
                segments(&Circle::new(c, *r).to_path(EDGE_TOLERANCE), &mut out);
                if *inner_r > 0.0 {
                    segments(&Circle::new(c, *inner_r).to_path(EDGE_TOLERANCE), &mut out);
                }
            }
            Mark::Path {
                geometry, offset, ..
            } => {
                let path = deep_marks_vello::bez(&geometry.verbs, *offset, 1.0);
                if geometry.fill {
                    segments(&path, &mut out);
                }
                if let Some(w) = geometry.stroke {
                    stroke_edges(&path, w, &mut out);
                }
            }
            Mark::Shape {
                verbs,
                fill,
                stroke,
                ..
            } => {
                let path = deep_marks_vello::bez(verbs, [0.0, 0.0], 1.0);
                if fill.is_some() {
                    segments(&path, &mut out);
                }
                if let Some(line) = stroke {
                    stroke_edges(&path, line.width, &mut out);
                }
            }
            Mark::Text {
                item, spec, origin, ..
            } => {
                let label = label_of(spec)
                    .ok_or_else(|| refused("bad_font", &format!("items/{item}/params/font")))?;
                for g in &deep_text_gpui::shape(&label).glyphs {
                    let at = [origin[0] + f64::from(g.x), origin[1] + f64::from(g.y)];
                    glyph_edges(&g.font, g.id, g.size, at, &mut out);
                }
            }
        }
    }
    Ok(out)
}

/// A stroke's outline as Vello CPU strokes it: butt caps, miter joins with a limit of 4.
fn stroke_edges(path: &BezPath, width: f64, out: &mut Vec<[f64; 4]>) {
    let outline = kurbo::stroke(
        path.iter(),
        &deep_marks_vello::stroke(width),
        &StrokeOpts::default(),
        EDGE_TOLERANCE,
    );
    segments(&outline, out);
}

/// A path's subpaths flattened into segments, each closed back to its start.
fn segments(path: &BezPath, out: &mut Vec<[f64; 4]>) {
    let (mut start, mut last) = (None::<kurbo::Point>, kurbo::Point::ZERO);
    let close = |start: &mut Option<kurbo::Point>, last: kurbo::Point, out: &mut Vec<_>| {
        if let Some(s) = start.take() {
            if s != last {
                out.push([last.x, last.y, s.x, s.y]);
            }
        }
    };
    kurbo::flatten(path.iter(), EDGE_TOLERANCE, |el| match el {
        PathEl::MoveTo(p) => {
            close(&mut start, last, out);
            start = Some(p);
            last = p;
        }
        PathEl::LineTo(p) => {
            out.push([last.x, last.y, p.x, p.y]);
            last = p;
        }
        PathEl::ClosePath => {
            close(&mut start, last, out);
            if let Some(s) = start {
                last = s;
            }
        }
        _ => {}
    });
    close(&mut start, last, out);
}

/// Collects a glyph outline, y down, at a pen position in device px.
struct Pen {
    path: BezPath,
    at: [f64; 2],
}

impl Pen {
    fn p(&self, x: f32, y: f32) -> kurbo::Point {
        kurbo::Point::new(self.at[0] + f64::from(x), self.at[1] - f64::from(y))
    }
}

impl OutlinePen for Pen {
    fn move_to(&mut self, x: f32, y: f32) {
        let p = self.p(x, y);
        self.path.move_to(p);
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let p = self.p(x, y);
        self.path.line_to(p);
    }
    fn quad_to(&mut self, cx0: f32, cy0: f32, x: f32, y: f32) {
        let (a, b) = (self.p(cx0, cy0), self.p(x, y));
        self.path.quad_to(a, b);
    }
    fn curve_to(&mut self, cx0: f32, cy0: f32, cx1: f32, cy1: f32, x: f32, y: f32) {
        let (a, b, c) = (self.p(cx0, cy0), self.p(cx1, cy1), self.p(x, y));
        self.path.curve_to(a, b, c);
    }
    fn close(&mut self) {
        self.path.close_path();
    }
}

/// A glyph's outline, unhinted at `size` px a em with its origin at `at`, as the rasterizer reads
/// it from the bundled face (skrifa, the outline reader Vello CPU's glyphs use).
fn glyph_edges(
    font: &deep_text::FontData,
    id: u32,
    size: f32,
    at: [f64; 2],
    out: &mut Vec<[f64; 4]>,
) {
    let Ok(face) = skrifa::FontRef::from_index(font.data.data(), font.index) else {
        return;
    };
    let Some(glyph) = face.outline_glyphs().get(skrifa::GlyphId::new(id)) else {
        return;
    };
    let mut pen = Pen {
        path: BezPath::new(),
        at,
    };
    let settings = DrawSettings::unhinted(Size::new(size), LocationRef::default());
    if glyph.draw(settings, &mut pen).is_ok() {
        segments(&pen.path, out);
    }
}
