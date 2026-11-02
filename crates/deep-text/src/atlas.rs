//! The glyph atlas: alpha pages of glyphs rasterized by Vello CPU from their outlines, with its
//! f32 pipeline at the scalar SIMD level, so the same bytes come out on every platform. A GPUI
//! writer layer draws from these pages through the GPUI patch's tinted mask sprite; it never
//! asks GPUI's text system for a glyph (canvas primitives: Text `text@1`, Semantics).

use std::collections::BTreeMap;

use parley::FontData;
use vello_cpu::color::palette::css::WHITE;
use vello_cpu::kurbo::Affine;
use vello_cpu::{
    Glyph as VelloGlyph, Level, Pixmap, RasterizerSettings, RenderContext, RenderMode,
    RenderSettings, Resources,
};

/// A page's side in pixels: 1,024² alpha bytes, 1 MB (canvas primitives: Text, Cost).
pub const PAGE: u32 = 1024;
/// Clear pixels around each glyph, so a sprite's edge never samples its neighbor.
const GUTTER: u32 = 1;
/// The most pages the atlas holds: a glyph with no room on them waits for [`Atlas::make_room`],
/// so varied sizes and texts over a long run cost 8 MB at most (canvas primitives: Text, Cost).
pub const PAGES: usize = 8;
/// The largest device size the atlas rasterizes; text above it is the path renderer's (R6).
const MAX_DEVICE_SIZE: f32 = 256.;
/// The smallest raster size text in depth takes.
const MIN_RASTER: f64 = 4.;
/// Sub-pixel steps a device pixel splits into, on each axis: a glyph rasterizes at its pen
/// position's phase within its pixel, rounded to 1/8 px, so a run drawn from the atlas lands within
/// 1/16 px of where Vello CPU draws it (issue #140, criterion 6: coverage centroids within 0.1 px).
pub const PHASES: u8 = 8;
/// One raster step: 2^(1/6), about 12% (canvas primitives: Marks in 3D).
const RASTER_STEP: f64 = 1.122_462_048_309_373;

/// The raster size text in depth takes for `px` device pixels a em: the nearest of the sizes 2^(k/6),
/// so a label that grows or shrinks on screen rasterizes again only at each step, and draws its
/// glyphs scaled by at most half a step between them. Multiplied out, never through a logarithm.
pub fn raster_size(px: f64) -> f32 {
    let px = px.clamp(MIN_RASTER, f64::from(MAX_DEVICE_SIZE));
    let mut s = 1.0;
    while s * RASTER_STEP <= px {
        s *= RASTER_STEP;
    }
    let up = s * RASTER_STEP;
    (if up / px < px / s { up } else { s }).min(f64::from(MAX_DEVICE_SIZE)) as f32
}

/// Where a rasterized glyph sits on a page, and how it hangs off its origin on the baseline.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Placed {
    pub page: u32,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
    /// The glyph's top-left corner from its origin, in device pixels.
    pub left: i32,
    pub top: i32,
}

/// One alpha page, packed in shelves.
pub struct Page {
    bytes: Vec<u8>,
    /// The tick the page was last drawn from ([`Atlas::tick`]).
    used: u64,
    /// Changed each time the bytes change, to a number no page of this atlas had before; the GPUI
    /// side uploads a generation once.
    generation: u32,
    shelf_y: u32,
    shelf_h: u32,
    cursor_x: u32,
}

impl Page {
    fn new(generation: u32) -> Self {
        Page {
            bytes: vec![0; (PAGE * PAGE) as usize],
            used: 0,
            generation,
            shelf_y: 0,
            shelf_h: 0,
            cursor_x: 0,
        }
    }

    /// The page's alpha bytes, row-major, `PAGE` wide.
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    pub fn generation(&self) -> u32 {
        self.generation
    }

    fn reserve(&mut self, w: u32, h: u32) -> Option<(u32, u32)> {
        let (w, h) = (w + 2 * GUTTER, h + 2 * GUTTER);
        if w > PAGE || h > PAGE {
            return None;
        }
        if self.cursor_x + w > PAGE {
            self.shelf_y += self.shelf_h;
            self.shelf_h = 0;
            self.cursor_x = 0;
        }
        if self.shelf_y + h > PAGE {
            return None;
        }
        let slot = (self.cursor_x + GUTTER, self.shelf_y + GUTTER);
        self.cursor_x += w;
        self.shelf_h = self.shelf_h.max(h);
        Some(slot)
    }
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Key {
    blob: u64,
    index: u32,
    glyph: u32,
    /// The device-pixel size in 1/64 px, so a size is one raster.
    size64: u32,
    /// The pen position's phase within its pixel, in 1/[`PHASES`] px on x and y.
    phase: [u8; 2],
}

/// The atlas: its pages, the glyphs placed on them, and the rasterizer they come from.
pub struct Atlas {
    pages: Vec<Page>,
    /// The page new glyphs go on.
    current: usize,
    /// Counts frames for least-recently-used eviction; 0 until [`Atlas::tick`] is first called.
    tick: u64,
    placed: BTreeMap<Key, Option<Placed>>,
    resources: Resources,
    settings: RenderSettings,
    rasterized: u64,
    /// The next generation any page takes, so a page started over never repeats an old one.
    next_generation: u32,
    /// Set when a glyph found no room on [`PAGES`] full pages, until [`Atlas::make_room`].
    full: bool,
}

impl Default for Atlas {
    fn default() -> Self {
        Self::new()
    }
}

impl Atlas {
    pub fn new() -> Self {
        Atlas {
            pages: Vec::new(),
            current: 0,
            tick: 0,
            placed: BTreeMap::new(),
            resources: Resources::new(),
            settings: RenderSettings {
                level: Level::fallback(),
                num_threads: 0,
            },
            rasterized: 0,
            next_generation: 0,
            full: false,
        }
    }

    pub fn pages(&self) -> &[Page] {
        &self.pages
    }

    /// How many glyphs were rasterized so far; a frame that draws from the atlas adds none.
    pub fn rasterized(&self) -> u64 {
        self.rasterized
    }

    /// Starts a frame. Once every page is full, a glyph with no room takes the page least recently
    /// drawn from, if no glyph of this frame is on it: that page starts over at a new generation and
    /// its glyphs are placed again when next drawn. A caller that never ticks never evicts, and
    /// starts over whole with [`Atlas::make_room`].
    pub fn tick(&mut self) {
        self.tick += 1;
    }

    /// Starts over once a glyph found no room on [`PAGES`] full pages: every page and placement
    /// goes, and the next glyph opens page 0 at a generation no page had. True when it did. Call
    /// it between labels, never between placing a label's glyphs and drawing them.
    pub fn make_room(&mut self) -> bool {
        if !self.full {
            return false;
        }
        self.pages.clear();
        self.placed.clear();
        self.current = 0;
        self.full = false;
        true
    }

    /// The glyph's place on a page, rasterizing it on first sight. `None` for a blank glyph (a
    /// space), one above [`MAX_DEVICE_SIZE`], or, until [`Atlas::make_room`], one with no room
    /// left on [`PAGES`] pages; only the first two are remembered.
    pub fn glyph(&mut self, font: &FontData, glyph: u32, device_size: f32) -> Option<Placed> {
        self.glyph_at(font, glyph, device_size, [0, 0])
    }

    /// [`Atlas::glyph`] with its pen position `phase` of a pixel along, in 1/[`PHASES`] px on x
    /// and y (#140); `left` and `top` still hang off the pen position's whole pixel.
    pub fn glyph_at(
        &mut self,
        font: &FontData,
        glyph: u32,
        device_size: f32,
        phase: [u8; 2],
    ) -> Option<Placed> {
        let phase = phase.map(|p| p.min(PHASES - 1));
        let key = Key {
            blob: font.data.id(),
            index: font.index,
            glyph,
            size64: (device_size * 64.).round() as u32,
            phase,
        };
        if let Some(placed) = self.placed.get(&key) {
            if let Some(p) = placed {
                self.pages[p.page as usize].used = self.tick;
            }
            return *placed;
        }
        if device_size > MAX_DEVICE_SIZE {
            self.placed.insert(key, None);
            return None;
        }
        let placed = self.rasterize(font, glyph, device_size, phase);
        if self.full {
            return None;
        }
        self.placed.insert(key, placed);
        placed
    }

    fn rasterize(
        &mut self,
        font: &FontData,
        glyph: u32,
        device_size: f32,
        phase: [u8; 2],
    ) -> Option<Placed> {
        // Room for an em of ascent and bearings on every side; the glyph's box is found after.
        let margin = (0.5 * device_size).ceil() + 2.;
        let width = (device_size * 2.5 + 2. * margin).ceil() as u16;
        let height = (device_size * 2. + 2. * margin).ceil() as u16;
        // Whole device pixels, so the raster and its placement agree on the baseline; the glyph's
        // pen sits `phase` along from there.
        let origin = (margin, margin + (device_size * 1.25).ceil());
        let mut ctx = RenderContext::new_with(width, height, self.settings);
        ctx.set_paint(WHITE);
        ctx.set_transform(Affine::IDENTITY);
        ctx.glyph_run(&mut self.resources, font)
            .font_size(device_size)
            .hint(false)
            .fill_glyphs(std::iter::once(VelloGlyph {
                id: glyph,
                x: origin.0 + f32::from(phase[0]) / f32::from(PHASES),
                y: origin.1 + f32::from(phase[1]) / f32::from(PHASES),
            }))
            .ok()?;
        ctx.flush();
        let mut pixmap = Pixmap::new(width, height);
        ctx.render_with(
            &mut pixmap,
            &mut self.resources,
            RasterizerSettings {
                render_mode: RenderMode::OptimizeQuality,
                ..RasterizerSettings::default()
            },
        );
        self.rasterized += 1;
        let alpha = |x: u32, y: u32| pixmap.data()[(y * u32::from(width) + x) as usize].a;
        let (mut x0, mut y0, mut x1, mut y1) = (u32::from(width), u32::from(height), 0, 0);
        for y in 0..u32::from(height) {
            for x in 0..u32::from(width) {
                if alpha(x, y) != 0 {
                    x0 = x0.min(x);
                    y0 = y0.min(y);
                    x1 = x1.max(x + 1);
                    y1 = y1.max(y + 1);
                }
            }
        }
        if x1 <= x0 || y1 <= y0 {
            return None;
        }
        let (w, h) = (x1 - x0, y1 - y0);
        let (page, slot) = self.reserve(w, h)?;
        let target = &mut self.pages[page as usize];
        for y in 0..h {
            for x in 0..w {
                let value = alpha(x0 + x, y0 + y);
                target.bytes[((slot.1 + y) * PAGE + slot.0 + x) as usize] = value;
            }
        }
        target.generation = self.next_generation;
        self.next_generation += 1;
        Some(Placed {
            page,
            x: slot.0,
            y: slot.1,
            w,
            h,
            left: x0 as i32 - origin.0 as i32,
            top: y0 as i32 - origin.1 as i32,
        })
    }

    fn reserve(&mut self, w: u32, h: u32) -> Option<(u32, (u32, u32))> {
        if let Some(page) = self.pages.get_mut(self.current) {
            if let Some(slot) = page.reserve(w, h) {
                page.used = self.tick;
                return Some((self.current as u32, slot));
            }
        }
        if self.pages.len() < PAGES {
            self.pages.push(Page::new(self.next_generation));
            self.current = self.pages.len() - 1;
        } else {
            // Every page is full: the one least recently drawn from starts over, unless this
            // frame drew from it.
            let Some(lru) = self
                .pages
                .iter()
                .enumerate()
                .filter(|(_, p)| p.used < self.tick)
                .min_by_key(|(i, p)| (p.used, *i))
                .map(|(i, _)| i)
            else {
                self.full = true;
                return None;
            };
            self.placed
                .retain(|_, placed| placed.is_none_or(|p| p.page as usize != lru));
            self.pages[lru] = Page::new(self.next_generation);
            self.next_generation += 1;
            self.current = lru;
        }
        let page = &mut self.pages[self.current];
        let slot = page.reserve(w, h)?;
        page.used = self.tick;
        Some((self.current as u32, slot))
    }
}
