//! Labels in depth (issue #381; canvas primitives: Marks in 3D, "mark.text draws from the core's
//! glyph atlas over the one shaper"). A label's text is shaped by the one shaper from the spec a 2D
//! text of that text, font and size is shaped from, so its glyph run is the 2D run. Its glyphs come
//! from the core's glyph atlas, rasterized by Vello CPU at the label's size on screen quantized in
//! steps of about 12%, on pages evicted least recently used; the GPU layer draws one textured quad
//! per glyph from the atlas pages, in any size space and facing.

use std::collections::BTreeMap;
use std::sync::Arc;

use deep_text::{face_of, raster_size, Atlas, Page, Placed, Role, Shaped, Shaper, Spec};
pub use deep_text::{PAGE, PAGES};

/// The em a world-size label's run is shaped at: its size is in meters, so its glyphs scale.
pub const WORLD_EM_PX: f32 = 64.0;
/// The em the planted `fixed_em` labels are shaped at, as the base's masks were.
const MASK_EM_PX: f32 = 64.0;

/// One glyph of a label: the shaped run's glyph and where its raster sits in the atlas.
#[derive(Clone, Debug, PartialEq)]
pub struct Glyph {
    /// The bundled font file the glyph's face comes from.
    pub file: &'static str,
    /// The size in px the run was shaped at.
    pub size: f32,
    pub id: u32,
    /// The glyph's origin in the run, in px from the top left of its layout box, on its baseline.
    pub x: f32,
    pub y: f32,
    pub grapheme: usize,
    /// Its raster in the atlas, and the device size it was rasterized at; `None` with no ink.
    pub atlas: Option<Placed>,
    pub raster: f32,
    /// The glyph's quad from the label's centre, in ems of the run, x right and y down:
    /// `[x, y, w, h]`.
    pub rect: [f32; 4],
}

/// One atlas page as a frame samples it: its alpha bytes (`PAGE` wide) at a generation.
#[derive(Clone, Debug)]
pub struct AtlasPage {
    pub generation: u32,
    pub bytes: Arc<[u8]>,
}

/// Pages are told apart by generation: a page's bytes change only with it.
impl PartialEq for AtlasPage {
    fn eq(&self, other: &Self) -> bool {
        self.generation == other.generation
    }
}

/// The labels' shaper, their runs (shaped once per text, role and size) and the core's atlas.
pub struct Labels {
    shaper: Shaper,
    atlas: Atlas,
    /// The pages as frames last took them, copied again only at a new generation.
    pages: Vec<AtlasPage>,
    runs: BTreeMap<(String, Role, u32), Shaped>,
    /// #381 AC1's wrong program (`deep-gpu run --planted label_mask`): the base's path, each label
    /// shaped at a fixed em for a mask of its own, with nothing placed in the atlas.
    pub fixed_em: bool,
}

impl Default for Labels {
    fn default() -> Self {
        Self::new()
    }
}

impl Labels {
    pub fn new() -> Self {
        Labels {
            shaper: Shaper::new(),
            atlas: Atlas::new(),
            pages: Vec::new(),
            runs: BTreeMap::new(),
            fixed_em: false,
        }
    }

    /// The atlas pages, as the frame's glyphs sample them.
    pub(crate) fn pages(&mut self) -> Vec<AtlasPage> {
        let pages: &[Page] = self.atlas.pages();
        self.pages.truncate(pages.len());
        for (i, page) in pages.iter().enumerate() {
            if self
                .pages
                .get(i)
                .is_none_or(|p| p.generation != page.generation())
            {
                let fresh = AtlasPage {
                    generation: page.generation(),
                    bytes: Arc::from(page.bytes()),
                };
                match self.pages.get_mut(i) {
                    Some(p) => *p = fresh,
                    None => self.pages.push(fresh),
                }
            }
        }
        self.pages.clone()
    }

    /// Starts a frame: pages none of its labels draw from age for eviction.
    pub(crate) fn begin(&mut self) {
        self.atlas.tick();
    }

    /// Starts the atlas over when a frame's glyphs found no room on any page; true when it did,
    /// and the frame must place its glyphs again.
    pub(crate) fn make_room(&mut self) -> bool {
        self.atlas.make_room()
    }

    /// `text`'s run in `role` at `size` px, shaped on first sight: its box in px, and its glyphs.
    pub(crate) fn run(&mut self, text: &str, role: Role, size: f32) -> ([f64; 2], Vec<Glyph>) {
        let size = if self.fixed_em { MASK_EM_PX } else { size };
        let spec = Spec {
            role,
            size,
            ..Spec::label(text)
        };
        let shaper = &mut self.shaper;
        let shaped = self
            .runs
            .entry((text.to_string(), role, size.to_bits()))
            .or_insert_with(|| shaper.shape(&spec));
        let glyphs = shaped
            .glyphs
            .iter()
            .map(|g| Glyph {
                file: face_of(&g.font).map_or("", |f| f.file),
                size: g.size,
                id: g.id,
                x: g.x,
                y: g.y,
                grapheme: g.grapheme,
                atlas: None,
                raster: 0.0,
                rect: [0.0; 4],
            })
            .collect();
        (
            [f64::from(shaped.width), f64::from(spec.line_height())],
            glyphs,
        )
    }

    /// Places a label's glyphs in the atlas at `em_px`, the device px one em of its run takes
    /// on screen, quantized; `bounds` is its box in run px.
    pub(crate) fn place(
        &mut self,
        text: &str,
        role: Role,
        glyphs: &mut [Glyph],
        bounds: [f64; 2],
        em_px: f64,
    ) {
        if self.fixed_em {
            return;
        }
        let raster = raster_size(em_px);
        let shaper = &mut self.shaper;
        let Some(size) = glyphs.first().map(|g| g.size) else {
            return;
        };
        let shaped = self
            .runs
            .entry((text.to_string(), role, size.to_bits()))
            .or_insert_with(|| {
                shaper.shape(&Spec {
                    role,
                    size,
                    ..Spec::label(text)
                })
            });
        let k = size / raster;
        let [w, h] = [bounds[0] as f32, bounds[1] as f32];
        for (glyph, g) in glyphs.iter_mut().zip(&shaped.glyphs) {
            glyph.raster = raster;
            glyph.atlas = self.atlas.glyph(&g.font, g.id, raster);
            if let Some(p) = glyph.atlas {
                glyph.rect = [
                    (g.x + p.left as f32 * k - w / 2.0) / size,
                    (g.y + p.top as f32 * k - h / 2.0) / size,
                    p.w as f32 * k / size,
                    p.h as f32 * k / size,
                ];
            }
        }
    }
}
