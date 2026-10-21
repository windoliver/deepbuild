//! Issue #390: the canvas's text where GPUI draws a 2D writer layer. A label is shaped once by
//! the canvas's own shaper (deep-text), its glyphs rasterized into the canvas's atlas by Vello
//! CPU, and drawn through the GPUI patch's tinted mask sprite: one alpha page, a color per
//! instance. Nothing here calls GPUI's text system, so a label's pixels don't depend on the
//! user's font-smoothing setting (canvas primitives: Text `text@1`, Semantics).

use std::{
    cell::RefCell,
    collections::{HashMap, HashSet},
};

use deep_text::{Align, Atlas, Role, Shaped, Shaper, Spec, PAGE};
use gpui_kit::*;

/// The atlas number GPUI knows this atlas's pages under.
const ATLAS: u32 = 0;

/// A Text item's fields a label needs (canvas primitives: Text `text@1`).
#[derive(Clone, Debug, PartialEq)]
pub struct Label {
    pub text: String,
    pub role: Role,
    pub size: f32,
    pub weight: u16,
    pub width: Option<f32>,
    pub max_lines: Option<u16>,
    pub align: Align,
    /// A bound value or counter: tabular figures, never cut short.
    pub bound: bool,
}

impl Label {
    pub fn new(text: impl Into<String>) -> Self {
        Label {
            text: text.into(),
            role: Role::Body,
            size: 13.,
            weight: 400,
            width: None,
            max_lines: None,
            align: Align::Start,
            bound: false,
        }
    }

    fn spec(&self) -> Spec<'_> {
        Spec {
            text: &self.text,
            role: self.role,
            size: self.size,
            weight: self.weight,
            line_height: None,
            width: self.width,
            max_lines: self.max_lines,
            align: self.align,
            bound: self.bound,
            tabular: self.bound,
            mask: false,
        }
    }
}

/// What a label is shaped by: `text@1`'s (text, font, size, features, width) and the line limit.
#[derive(Clone, PartialEq, Eq, Hash)]
struct ShapeKey {
    text: String,
    role: Role,
    size: u32,
    weight: u16,
    width: Option<u32>,
    max_lines: Option<u16>,
    align: u8,
    bound: bool,
}

impl ShapeKey {
    fn of(label: &Label) -> Self {
        ShapeKey {
            text: label.text.clone(),
            role: label.role,
            size: label.size.to_bits(),
            weight: label.weight,
            width: label.width.map(f32::to_bits),
            max_lines: label.max_lines,
            align: label.align as u8,
            bound: label.bound,
        }
    }
}

/// What one paint of a label did, for the tests that read the draw path.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Painted {
    /// Sprites drawn: one per visible glyph.
    pub sprites: usize,
    /// The atlas pages the sprites drew from, in first-use order, each with its sprite count.
    pub pages: Vec<(u32, usize)>,
    /// Glyphs the atlas rasterized during this paint (none once the label is warm).
    pub rasterized: u64,
    /// Pages this paint handed GPUI at a generation the window didn't hold (none when every
    /// label was prepared before the frame's first paint, or once the pages are warm).
    pub uploaded: usize,
}

struct Text {
    shaper: Shaper,
    atlas: Atlas,
    shaped: HashMap<ShapeKey, Shaped>,
    /// The runs the frame since [`begin_frame`] drew from, each once.
    frame: HashSet<ShapeKey>,
    /// Per window (each has its own sprite atlas), the generation of each page it holds, so a
    /// changed page is uploaded again, once, and the page it replaces is let go.
    uploaded: HashMap<WindowId, HashMap<u32, u32>>,
}

impl Text {
    fn new() -> Self {
        Text {
            shaper: Shaper::new(),
            atlas: Atlas::new(),
            shaped: HashMap::new(),
            frame: HashSet::new(),
            uploaded: HashMap::new(),
        }
    }

    /// The label's shape, from the cache: a label is shaped once, never per frame. The cache is
    /// emptied whole at 4,096 runs, so a frame of more than that shapes some of them again.
    fn shape(&mut self, label: &Label) -> Shaped {
        let key = ShapeKey::of(label);
        self.frame.insert(key.clone());
        if let Some(shaped) = self.shaped.get(&key) {
            return shaped.clone();
        }
        if self.shaped.len() >= 4_096 {
            self.shaped.clear();
        }
        let shaped = self.shaper.shape(&label.spec());
        self.shaped.insert(key, shaped.clone());
        shaped
    }

    /// The label's glyphs placed in the atlas at `scale`, rasterized on first sight, each with its
    /// logical position in the run. A label that fills the atlas starts it over and is placed
    /// whole on the fresh pages (the labels before it keep the pages GPUI holds until the next
    /// frame; the labels after it place again); only a blank glyph, one too large, or one of a
    /// label too large for an empty atlas is left out.
    fn place(&mut self, label: &Label, scale: f32) -> Vec<(deep_text::Placed, f32, f32)> {
        self.atlas.make_room();
        let shaped = self.shape(label);
        let mut restarted = false;
        'whole: loop {
            let mut placed = Vec::with_capacity(shaped.glyphs.len());
            for glyph in &shaped.glyphs {
                match self.atlas.glyph(&glyph.font, glyph.id, glyph.size * scale) {
                    Some(place) => placed.push((place, glyph.x, glyph.y)),
                    None if !restarted && self.atlas.make_room() => {
                        restarted = true;
                        continue 'whole;
                    }
                    None => {}
                }
            }
            return placed;
        }
    }
}

thread_local! {
    static TEXT: RefCell<Text> = RefCell::new(Text::new());
}

/// The label's shaped run, shaped on first sight and reused after.
pub fn shape(label: &Label) -> Shaped {
    TEXT.with(|text| text.borrow_mut().shape(label))
}

/// The size a label takes, for a layout that sizes to its text.
pub fn measure(label: &Label) -> Size<Pixels> {
    let shaped = shape(label);
    size(px(shaped.width.ceil()), px(shaped.height))
}

/// The fit check for a label against its widest string (the label's own text when `None`).
pub fn fit(label: &Label, widest: Option<&str>) -> deep_text::Fit {
    TEXT.with(|text| text.borrow_mut().shaper.fit(&label.spec(), widest))
}

/// Starts counting the distinct runs a frame draws from; see [`frame_runs`].
pub fn begin_frame() {
    TEXT.with(|text| text.borrow_mut().frame.clear());
}

/// How many distinct runs the labels since [`begin_frame`] were shaped as: two labels with one
/// text, font, size and weight are one run.
pub fn frame_runs() -> usize {
    TEXT.with(|text| text.borrow().frame.len())
}

/// Lets GPUI drop a page it holds at the next frame, never in this one: sprites already queued
/// this frame, from an earlier label, may still draw from it.
fn retire(window: &mut Window, stale: RenderMaskParams) {
    window.on_next_frame(move |window, _| window.remove_mask_page(stale));
}

/// Places `label`'s glyphs in the atlas for a window at `scale`, before any label is painted:
/// call it from prepaint, so the frame's pages are final when its first paint uploads them, and
/// each page goes to GPUI once a frame however many labels added glyphs to it.
pub fn prepare(label: &Label, scale: f32) {
    TEXT.with(|text| {
        text.borrow_mut().place(label, scale);
    });
}

/// Paints `label` with its top-left corner at `origin`, in `color`, through the atlas.
pub fn paint_label(
    origin: Point<Pixels>,
    label: &Label,
    color: Hsla,
    window: &mut Window,
) -> Painted {
    TEXT.with(|text| {
        let mut text = text.borrow_mut();
        let scale = window.scale_factor();
        let before = text.atlas.rasterized();
        // Every glyph placed first, so the label's pages are final before any is uploaded.
        let placed: Vec<_> = text
            .place(label, scale)
            .into_iter()
            .map(|(place, glyph_x, glyph_y)| {
                let x = (f32::from(origin.x) * scale + glyph_x * scale).round() as i32 + place.left;
                let y = (f32::from(origin.y) * scale + glyph_y * scale).round() as i32 + place.top;
                (place, x, y)
            })
            .collect();
        let Text {
            atlas, uploaded, ..
        } = &mut *text;
        let mut painted = Painted {
            rasterized: atlas.rasterized() - before,
            ..Painted::default()
        };
        // Pages this window holds that the atlas no longer has, at that generation or at all, go
        // once this frame is drawn.
        let held = uploaded
            .entry(window.window_handle().window_id())
            .or_default();
        held.retain(|&page, &mut generation| {
            let current = atlas
                .pages()
                .get(page as usize)
                .is_some_and(|current| current.generation() == generation);
            if !current {
                retire(
                    window,
                    RenderMaskParams {
                        atlas: ATLAS,
                        page,
                        generation,
                    },
                );
            }
            current
        });
        for (place, x, y) in placed {
            let page = &atlas.pages()[place.page as usize];
            let params = RenderMaskParams {
                atlas: ATLAS,
                page: place.page,
                generation: page.generation(),
            };
            if held.insert(place.page, page.generation()) != Some(page.generation()) {
                painted.uploaded += 1;
            }
            let bounds = Bounds {
                origin: point(px(x as f32 / scale), px(y as f32 / scale)),
                size: size(px(place.w as f32 / scale), px(place.h as f32 / scale)),
            };
            let region = Bounds {
                origin: point(DevicePixels(place.x as i32), DevicePixels(place.y as i32)),
                size: size(DevicePixels(place.w as i32), DevicePixels(place.h as i32)),
            };
            let drawn = window.paint_mask_sprite(bounds, params, region, color, &mut || {
                (
                    size(DevicePixels(PAGE as i32), DevicePixels(PAGE as i32)),
                    page.bytes().to_vec(),
                )
            });
            if drawn.is_ok() {
                painted.sprites += 1;
                match painted
                    .pages
                    .iter_mut()
                    .find(|(page, _)| *page == place.page)
                {
                    Some((_, count)) => *count += 1,
                    None => painted.pages.push((place.page, 1)),
                }
            }
        }
        painted
    })
}
