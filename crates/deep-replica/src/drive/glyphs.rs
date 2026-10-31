//! Text as the replica sees it: every run of glyphs the last frame drew, with the string it spells and its bounds.
//!
//! A script panel's text has no element of its own, so nothing observes it and GPUI's accessibility tree, which a
//! headless window never activates, doesn't hold it either. What the replica does see is everything the frame asks
//! the platform for: the lines the text system shapes, the glyph tiles the atlas hands out, and the scene the
//! renderer is given. The scene lists glyph sprites by tile, not in the order they were painted, so each sprite's pen
//! position is worked back from its tile's raster offset; glyphs on one baseline under one clip, left to right, are
//! the candidates, and a drawn string is the longest shaped line whose painted glyphs they spell. The renderer
//! presents nothing (a headless frame has nowhere to go) and draws pixels only when a screenshot asks for them.

use std::{
    borrow::Cow,
    collections::{BTreeMap, HashMap, HashSet},
    sync::{Arc, Mutex},
};

use gpui_kit::*;
use image::RgbaImage;

type GlyphKey = (FontId, GlyphId);
/// A row of glyphs: the clip they're drawn under and their baseline, in whole device pixels.
type Row = ([i32; 4], i32);

#[derive(Default)]
struct Seen {
    /// The platform's text system, which says where in its tile each glyph's raster starts.
    text: Option<Arc<dyn PlatformTextSystem>>,
    /// Each glyph tile the atlas handed out, by texture and tile: the glyph, and its raster's offset from the pen.
    tiles: HashMap<(AtlasTextureId, u32), (GlyphKey, [f32; 2])>,
    /// Every line shaped so far, by its glyphs but its whitespace's, with the text it spells.
    lines: HashMap<Vec<GlyphKey>, String>,
    /// The glyphs shaped for whitespace, which some fonts paint as a speck and others not at all.
    blank: HashSet<GlyphKey>,
    /// The last frame's glyph sprites: the tile, the bounds and the clip, in device pixels.
    sprites: Vec<Sprite>,
    /// The next frame the renderer is handed is for its glyphs only: no pixels are drawn.
    scene_only: bool,
    /// The scale the window draws at, when it isn't the 2x GPUI's test window sizes its images for.
    scale: Option<f32>,
}

#[derive(Clone, Copy)]
struct Sprite {
    tile: (AtlasTextureId, u32),
    bounds: Bounds<ScaledPixels>,
    clip: Bounds<ScaledPixels>,
}

/// One string the frame drew: its text, its bounds in device pixels, and whether any of it shows inside its clip.
#[derive(Clone, Debug, PartialEq)]
pub struct Run {
    pub text: String,
    pub bounds: [i64; 4],
    pub visible: bool,
}

/// What the replica's platform saw, shared by the text system, the atlas and the renderer it wraps.
#[derive(Clone, Default)]
pub struct Glyphs(Arc<Mutex<Seen>>);

impl Glyphs {
    /// The strings the last frame drew, top to bottom and left to right.
    pub fn runs(&self) -> Vec<Run> {
        let seen = self.0.lock().expect("glyphs");
        let mut rows: BTreeMap<Row, Vec<(f32, GlyphKey, Sprite)>> = BTreeMap::new();
        for sprite in &seen.sprites {
            let Some((key, offset)) = seen
                .tiles
                .get(&sprite.tile)
                .filter(|(key, _)| !seen.blank.contains(key))
            else {
                continue;
            };
            let pen = [
                sprite.bounds.origin.x.0 - offset[0],
                sprite.bounds.origin.y.0 - offset[1],
            ];
            let c = sprite.clip;
            let clip = [c.origin.x.0, c.origin.y.0, c.size.width.0, c.size.height.0]
                .map(|v| v.round() as i32);
            rows.entry((clip, pen[1].round() as i32))
                .or_default()
                .push((pen[0], *key, *sprite));
        }
        let mut runs = Vec::new();
        for row in rows.values_mut() {
            row.sort_by(|a, b| a.0.total_cmp(&b.0));
            let glyphs: Vec<(GlyphKey, Sprite)> =
                row.iter().map(|(_, key, sprite)| (*key, *sprite)).collect();
            let mut at = 0;
            while at < glyphs.len() {
                // The longest shaped line that spells the glyphs from here on.
                let found = (at + 1..=glyphs.len()).rev().find_map(|end| {
                    let key: Vec<GlyphKey> = glyphs[at..end].iter().map(|(k, _)| *k).collect();
                    seen.lines.get(&key).map(|text| (end, text.clone()))
                });
                let (end, text) = found.unwrap_or((at + 1, String::new()));
                if !text.is_empty() {
                    runs.push(run(text, &glyphs[at..end]));
                }
                at = end;
            }
        }
        runs.sort_by_key(|r| (r.bounds[1], r.bounds[0]));
        runs
    }

    /// Keeps the glyphs of the frame `window` last drew. A headless window never presents, so the frame is asked for
    /// as an image the renderer doesn't draw.
    pub fn keep_scene(&self, window: &Window) {
        self.0.lock().expect("glyphs").scene_only = true;
        let _ = window.render_to_image();
        self.0.lock().expect("glyphs").scene_only = false;
    }

    /// Sizes the images the renderer draws for a window drawing at `scale`.
    pub fn draw_at(&self, scale: f32) {
        self.0.lock().expect("glyphs").scale = Some(scale);
    }

    pub fn text_system(&self, inner: Arc<dyn PlatformTextSystem>) -> Arc<dyn PlatformTextSystem> {
        self.0.lock().expect("glyphs").text = Some(inner.clone());
        Arc::new(TextSystem {
            inner,
            seen: self.clone(),
        })
    }

    pub fn renderer(
        &self,
        inner: Box<dyn PlatformHeadlessRenderer>,
    ) -> Box<dyn PlatformHeadlessRenderer> {
        // GPUI hands a window its atlas as an `Arc`, and the renderer's own isn't `Send` either.
        #[allow(clippy::arc_with_non_send_sync)]
        let atlas: Arc<dyn PlatformAtlas> = Arc::new(Atlas {
            inner: inner.sprite_atlas(),
            seen: self.clone(),
        });
        Box::new(Renderer {
            inner,
            atlas,
            seen: self.clone(),
        })
    }
}

fn run(text: String, glyphs: &[(GlyphKey, Sprite)]) -> Run {
    let (mut x0, mut y0, mut x1, mut y1) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    let mut visible = false;
    for (_, sprite) in glyphs {
        let b = sprite.bounds;
        x0 = x0.min(b.origin.x.0);
        y0 = y0.min(b.origin.y.0);
        x1 = x1.max(b.origin.x.0 + b.size.width.0);
        y1 = y1.max(b.origin.y.0 + b.size.height.0);
        visible |= b.intersects(&sprite.clip);
    }
    let (x0, y0) = (x0.floor() as i64, y0.floor() as i64);
    Run {
        text,
        bounds: [x0, y0, x1.ceil() as i64 - x0, y1.ceil() as i64 - y0],
        visible,
    }
}

struct TextSystem {
    inner: Arc<dyn PlatformTextSystem>,
    seen: Glyphs,
}

impl PlatformTextSystem for TextSystem {
    fn add_fonts(&self, fonts: Vec<Cow<'static, [u8]>>) -> Result<()> {
        self.inner.add_fonts(fonts)
    }
    fn set_missing_glyph_sink(&self, sink: Option<Arc<dyn MissingGlyphSink>>) {
        self.inner.set_missing_glyph_sink(sink)
    }
    fn all_font_names(&self) -> Vec<String> {
        self.inner.all_font_names()
    }
    fn font_id(&self, descriptor: &Font) -> Result<FontId> {
        self.inner.font_id(descriptor)
    }
    fn prewarm_fonts(&self, font_ids: &[FontId]) {
        self.inner.prewarm_fonts(font_ids)
    }
    fn font_metrics(&self, font_id: FontId) -> FontMetrics {
        self.inner.font_metrics(font_id)
    }
    fn typographic_bounds(&self, font_id: FontId, glyph_id: GlyphId) -> Result<Bounds<f32>> {
        self.inner.typographic_bounds(font_id, glyph_id)
    }
    fn advance(&self, font_id: FontId, glyph_id: GlyphId) -> Result<Size<f32>> {
        self.inner.advance(font_id, glyph_id)
    }
    fn glyph_for_char(&self, font_id: FontId, ch: char) -> Option<GlyphId> {
        self.inner.glyph_for_char(font_id, ch)
    }
    fn glyph_raster_bounds(&self, params: &RenderGlyphParams) -> Result<Bounds<DevicePixels>> {
        self.inner.glyph_raster_bounds(params)
    }
    fn rasterize_glyph(
        &self,
        params: &RenderGlyphParams,
        raster_bounds: Bounds<DevicePixels>,
    ) -> Result<(Size<DevicePixels>, Vec<u8>)> {
        self.inner.rasterize_glyph(params, raster_bounds)
    }
    fn layout_line(&self, text: &str, font_size: Pixels, runs: &[FontRun]) -> LineLayout {
        let layout = self.inner.layout_line(text, font_size, runs);
        let mut seen = self.seen.0.lock().expect("glyphs");
        let mut painted = Vec::new();
        for run in &layout.runs {
            for glyph in &run.glyphs {
                if text[glyph.index..].starts_with(char::is_whitespace) {
                    seen.blank.insert((run.font_id, glyph.id));
                } else {
                    painted.push((run.font_id, glyph.id));
                }
            }
        }
        if !painted.is_empty() {
            seen.lines.insert(painted, text.to_owned());
        }
        drop(seen);
        layout
    }
    fn recommended_rendering_mode(&self, font_id: FontId, font_size: Pixels) -> TextRenderingMode {
        self.inner.recommended_rendering_mode(font_id, font_size)
    }
    fn glyph_dilation_for_color(&self, color: Hsla) -> u8 {
        self.inner.glyph_dilation_for_color(color)
    }
}

struct Atlas {
    inner: Arc<dyn PlatformAtlas>,
    seen: Glyphs,
}

impl PlatformAtlas for Atlas {
    fn get_or_insert_with<'a>(
        &self,
        key: AtlasKey,
        build: &mut dyn FnMut() -> Result<Option<(Size<DevicePixels>, Cow<'a, [u8]>)>>,
    ) -> Result<Option<AtlasTile>> {
        let params = match &key {
            AtlasKey::Glyph(params) => Some(params.clone()),
            _ => None,
        };
        let tile = self.inner.get_or_insert_with(key, build)?;
        if let (Some(params), Some(tile)) = (params, &tile) {
            let mut seen = self.seen.0.lock().expect("glyphs");
            let at = (tile.texture_id, tile.tile_id.0);
            if !seen.tiles.contains_key(&at) {
                let raster = seen
                    .text
                    .as_ref()
                    .and_then(|text| text.glyph_raster_bounds(&params).ok());
                let offset =
                    raster.map_or([0., 0.], |b| [b.origin.x.0 as f32, b.origin.y.0 as f32]);
                seen.tiles
                    .insert(at, ((params.font_id, params.glyph_id), offset));
            }
        }
        Ok(tile)
    }
    fn remove(&self, key: &AtlasKey) {
        self.inner.remove(key)
    }
}

struct Renderer {
    inner: Box<dyn PlatformHeadlessRenderer>,
    atlas: Arc<dyn PlatformAtlas>,
    seen: Glyphs,
}

impl Renderer {
    fn keep(&self, scene: &Scene) {
        let mut sprites: Vec<(DrawOrder, Sprite)> = scene
            .monochrome_sprites
            .iter()
            .map(|s| (s.order, s.tile, s.bounds, s.content_mask.bounds))
            .chain(
                scene
                    .subpixel_sprites
                    .iter()
                    .map(|s| (s.order, s.tile, s.bounds, s.content_mask.bounds)),
            )
            .map(|(order, tile, bounds, clip)| {
                (
                    order,
                    Sprite {
                        tile: (tile.texture_id, tile.tile_id.0),
                        bounds,
                        clip,
                    },
                )
            })
            .collect();
        sprites.sort_by_key(|(order, _)| *order);
        self.seen.0.lock().expect("glyphs").sprites = sprites.into_iter().map(|(_, s)| s).collect();
    }
}

impl PlatformHeadlessRenderer for Renderer {
    fn render_scene_to_image(
        &mut self,
        scene: &Scene,
        size: Size<DevicePixels>,
    ) -> Result<RgbaImage> {
        self.keep(scene);
        let seen = self.seen.0.lock().expect("glyphs");
        if seen.scene_only {
            return Ok(RgbaImage::new(1, 1));
        }
        let size = match seen.scale {
            Some(scale) => size.map(|v| DevicePixels((v.0 as f32 * scale / 2.).round() as i32)),
            None => size,
        };
        drop(seen);
        self.inner.render_scene_to_image(scene, size)
    }
    fn render_scene(&mut self, scene: &Scene, _size: Size<DevicePixels>) -> Result<()> {
        self.keep(scene);
        Ok(())
    }
    fn sprite_atlas(&self) -> Arc<dyn PlatformAtlas> {
        self.atlas.clone()
    }
}
