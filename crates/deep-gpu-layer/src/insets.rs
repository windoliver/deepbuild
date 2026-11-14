//! #506: what `view3d` draws an inset's content and an overlay's 2D frame with. Each picture is
//! the content's 2D draw list rastered by Vello CPU, its images read from a store of the call's
//! assets, premultiplied as drawn and converted once to the straight alpha every map holds
//! ([`straight`]); a picture is made again only when its key changes.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use deep_canvas_marks::scene::{self, Palette, Record};
use deep_canvas_scene3d::light::Texels;
use deep_canvas_scene3d::scene::Scene;
use serde_json::{Map, Value};

use crate::refused;

/// The one conversion from the raster's premultiplied render to straight alpha (#506): each
/// pixel's color over its alpha, a transparent one black.
pub fn straight(rgba: &mut [u8]) {
    for p in rgba.chunks_exact_mut(4) {
        let a = u32::from(p[3]);
        if a == 0 {
            p[..3].fill(0);
        } else if a < 255 {
            for c in &mut p[..3] {
                *c = ((u32::from(*c) * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
}

/// The images a call's assets hold, as the flat store a painter reads (`<64 hex>`): a folder of
/// links, gone with the run.
struct Store(PathBuf);

impl Store {
    fn of(assets: &BTreeMap<String, PathBuf>) -> Option<Store> {
        if assets.is_empty() {
            return None;
        }
        static RUNS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = RUNS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("deep-gpu-insets-{}-{n}", std::process::id()));
        std::fs::create_dir_all(&root).ok()?;
        let store = Store(root);
        for (sha, path) in assets.iter().filter(|(s, _)| s.len() == 64) {
            if let Ok(path) = std::path::absolute(path) {
                let _ = std::os::unix::fs::symlink(path, store.0.join(sha));
            }
        }
        Some(store)
    }
}

impl Drop for Store {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// A run's inset pictures.
pub struct Pictures {
    kept: BTreeMap<String, Arc<Texels>>,
    /// Each overlay frame's picture by what it draws, kept between frames.
    frames: std::cell::RefCell<BTreeMap<String, Arc<image::RgbaImage>>>,
    store: Option<Store>,
    palette: Palette,
    /// #506 criterion 8's planted wrong program: the premultiplied render sampled as straight.
    as_drawn: bool,
}

impl Pictures {
    pub fn new(assets: &BTreeMap<String, PathBuf>, palette: Palette, as_drawn: bool) -> Pictures {
        Pictures {
            kept: BTreeMap::new(),
            frames: Default::default(),
            store: Store::of(assets),
            palette,
            as_drawn,
        }
    }

    fn store(&self) -> Option<&Path> {
        self.store.as_ref().map(|s| s.0.as_path())
    }

    /// A 2D document's items at `size` px, premultiplied as the raster draws them.
    pub fn draw(&self, doc: &Map<String, Value>, size: [u32; 2]) -> Result<image::RgbaImage, Value> {
        self.draw_at(doc, size, [0.0; 2])
    }

    /// [`Pictures::draw`], every mark moved by `shift` px (a sub-pixel place).
    fn draw_at(
        &self,
        doc: &Map<String, Value>,
        size: [u32; 2],
        shift: [f64; 2],
    ) -> Result<image::RgbaImage, Value> {
        let empty = Map::new();
        let items = doc.get("items").and_then(Value::as_object).unwrap_or(&empty);
        let frame = scene::frame(doc, items, &self.palette, &Record::default(), 1.0)
            .map_err(|r| refused(r.code, r.path))?;
        let marks: Vec<_> = frame.layers.iter().flat_map(|l| l.marks.iter().cloned()).collect();
        deep_marks_render::layer::premultiplied(&marks, size, shift, self.store())
    }

    /// #506: each overlay frame `doc` shows at t, drawn: its overlay, the whole px its picture's
    /// top left sits at (the frame's corner at its anchor's place), and the picture,
    /// premultiplied.
    pub fn frames(
        &self,
        doc: &Value,
        overlays: &[deep_canvas_scene3d::scene::Overlay],
    ) -> Result<Vec<(String, [i64; 2], Arc<image::RgbaImage>)>, Value> {
        let mut out = Vec::new();
        let mut kept = self.frames.borrow_mut();
        let mut drawn = BTreeMap::new();
        for f in deep_canvas_scene3d::views::framed(doc) {
            let Some(origin) = overlays.iter().find(|o| o.id == f.overlay).and_then(|o| o.origin) else {
                continue;
            };
            let Some(frame) = doc.pointer(&format!("/items/{}/params/frame", f.overlay)).and_then(Value::as_str) else {
                continue;
            };
            let b = doc.pointer(&format!("/items/{frame}/params/box")).and_then(Value::as_array);
            let wh = [2, 3].map(|k| b.and_then(|b| b.get(k)).and_then(Value::as_f64).unwrap_or(0.0));
            // The picture on a whole pixel, the place's fraction moving the marks inside it, so
            // the frame sits on its anchor's projection to the sub-pixel.
            let place = [0, 1].map(|k| origin[k] - f.corner[k]);
            let at = place.map(|v| v.floor() as i64);
            let phase = [0, 1].map(|k| place[k] - at[k] as f64);
            let canvas = [0, 1].map(|k| (f.corner[k] + wh[k] + 1.0).ceil().max(1.0) as u32);
            let mut part = doc.as_object().cloned().unwrap_or_default();
            part.insert("size".into(), serde_json::json!(canvas));
            if let Some(items) = part.get_mut("items").and_then(Value::as_object_mut) {
                items.retain(|id, _| f.items.contains(id));
            }
            let key = format!("{}|{phase:?}", Value::Object(part.clone()));
            let picture = match kept.remove(&key) {
                Some(p) => p,
                None => Arc::new(self.draw_at(&part, canvas, phase)?),
            };
            drawn.insert(key, picture.clone());
            out.push((f.overlay, at, picture));
        }
        *kept = drawn;
        Ok(out)
    }

    /// #506: [`Pictures::frames`] laid over `bgra` (the frame, `size` px, premultiplied BGRA) on
    /// top of the scene.
    pub fn frames_over(
        &self,
        doc: &Value,
        overlays: &[deep_canvas_scene3d::scene::Overlay],
        bgra: &mut [u8],
        size: [u32; 2],
    ) -> Result<(), Value> {
        for (_, at, picture) in self.frames(doc, overlays)? {
            for (x, y, s) in picture.enumerate_pixels() {
                let (dx, dy) = (at[0] + i64::from(x), at[1] + i64::from(y));
                let a = u32::from(s[3]);
                if a == 0 || dx < 0 || dy < 0 || dx >= i64::from(size[0]) || dy >= i64::from(size[1]) {
                    continue;
                }
                let o = ((dy * i64::from(size[0]) + dx) * 4) as usize;
                let d = &mut bgra[o..o + 4];
                let over = |src: u8, dst: u8| (u32::from(src) + u32::from(dst) * (255 - a) / 255).min(255) as u8;
                d[0] = over(s[2], d[0]);
                d[1] = over(s[1], d[1]);
                d[2] = over(s[0], d[2]);
                d[3] = over(s[3], d[3]);
            }
        }
        Ok(())
    }

    /// Each picture the scene's insets draw, under its key in the scene's texels.
    pub fn paint(&mut self, scene: &mut Scene) -> Result<(), Value> {
        let keys: Vec<String> = scene.pictures.iter().map(|p| p.key.clone()).collect();
        self.kept.retain(|k, _| keys.contains(k));
        for p in &scene.pictures {
            if !self.kept.contains_key(&p.key) {
                let doc = p.document.as_object().cloned().unwrap_or_default();
                let mut rgba = self.draw(&doc, p.size)?.into_raw();
                if !self.as_drawn {
                    straight(&mut rgba);
                    deep_canvas_scene3d::inset::bleed(&mut rgba, p.size);
                }
                let texels = Texels {
                    format: deep_scene3d_render::inset::FORMAT.into(),
                    size: p.size,
                    mips: 1,
                    data: Arc::new(rgba),
                };
                self.kept.insert(p.key.clone(), Arc::new(texels));
            }
            scene.texels.insert(p.key.clone(), self.kept[&p.key].clone());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A premultiplied half-white pixel turns white at half alpha; opaque and clear ones keep.
    #[test]
    fn the_conversion_divides_by_alpha_once() {
        let mut px = vec![128, 128, 128, 128, 10, 20, 30, 255, 7, 7, 7, 0];
        straight(&mut px);
        assert_eq!(px, vec![255, 255, 255, 128, 10, 20, 30, 255, 0, 0, 0, 0]);
    }
}
