//! #1486: chrome thumbnails through the one image service (Image `image@1`). GPUI's `img` asks an
//! [`ImageCache`] for a resource; this one takes a path in a content store, `<store>/<sha256>`,
//! and gives the service's level for the size the thumbnail draws at, so a thumbnail never holds a
//! picture at full size and shares its levels, queue and budget with the canvas.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use deep_images::{Key, Queue, Shown, Store};
use gpui_kit::*;

/// Thumbnails of `side` px, each picture fitted inside a square of that side.
pub struct Thumbnails {
    side: f64,
    /// Each picture's sprite, by its path, with the level's hash it was made from.
    made: HashMap<Arc<Path>, ([u8; 32], Arc<RenderImage>)>,
}

impl Thumbnails {
    pub fn new(side: f64) -> Thumbnails {
        Thumbnails {
            side,
            made: HashMap::new(),
        }
    }

    /// The thumbnail of the picture at `path` as far as the service has it: its level, or the
    /// nearest held, or `None` while nothing is; with the sprite it replaced, for the window to
    /// let go of.
    fn thumbnail(
        &mut self,
        path: &Arc<Path>,
    ) -> Option<Result<(Arc<RenderImage>, Option<Arc<RenderImage>>), ImageCacheError>> {
        let fail = |why: &str| Some(Err(ImageCacheError::Asset(why.to_string().into())));
        let (Some(root), Some(hash)) = (
            path.parent(),
            path.file_name()
                .and_then(|n| deep_images::hash_of(&n.to_string_lossy())),
        ) else {
            return fail("a thumbnail is a picture in a content store, by its sha256");
        };
        let store = Arc::new(Store::flat(root));
        let images = deep_images::shared();
        let size = match images.size(&store, &hash) {
            Ok(size) => size,
            Err(r) => return fail(r.code),
        };
        let fitted = (self.side / f64::from(size[0])).min(self.side / f64::from(size[1]));
        let drawn = [f64::from(size[0]) * fitted, f64::from(size[1]) * fitted];
        let key = Key {
            hash,
            crop: [0, 0, size[0], size[1]],
            flip: 0,
            level: deep_images::level_for(size, drawn),
        };
        let level = match images.show(&store, key, Queue::Visible, [0.0; 4]) {
            Shown::Exact(l) | Shown::Nearest(l, _) => l,
            Shown::Nothing => return images.failed(&key).and_then(|r| fail(r.code)),
        };
        if let Some((sha, image)) = self.made.get(path) {
            if *sha == level.sha256 {
                return Some(Ok((image.clone(), None)));
            }
        }
        let mut bgra = level.rgba.clone();
        for px in bgra.chunks_exact_mut(4) {
            px.swap(0, 2);
        }
        let frame = image::RgbaImage::from_raw(level.size[0], level.size[1], bgra)?;
        let image = Arc::new(RenderImage::new([image::Frame::new(frame)]));
        let replaced = self
            .made
            .insert(path.clone(), (level.sha256, image.clone()));
        Some(Ok((image, replaced.map(|(_, old)| old))))
    }
}

impl ImageCache for Thumbnails {
    fn load(
        &mut self,
        resource: &Resource,
        window: &mut Window,
        _: &mut App,
    ) -> Option<Result<Arc<RenderImage>, ImageCacheError>> {
        let Resource::Path(path) = resource else {
            return Some(Err(ImageCacheError::Asset(
                "a thumbnail is a path in a content store".into(),
            )));
        };
        match self.thumbnail(path) {
            // Until its level arrives, the next frame asks again.
            None => {
                window.request_animation_frame();
                None
            }
            Some(Ok((image, replaced))) => {
                if let Some(old) = replaced {
                    let _ = window.drop_image(old);
                    window.request_animation_frame();
                }
                Some(Ok(image))
            }
            Some(Err(e)) => Some(Err(e)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[std::prelude::v1::test]
    fn a_thumbnail_is_the_level_it_draws_at_from_the_shared_service() {
        let dir = std::env::temp_dir().join(format!("deep-app-thumbnails-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let picture = image::RgbaImage::from_fn(1024, 640, |x, y| {
            image::Rgba([(x % 256) as u8, (y % 256) as u8, 90, 255])
        });
        let mut png = std::io::Cursor::new(Vec::new());
        picture.write_to(&mut png, image::ImageFormat::Png).unwrap();
        let bytes = png.into_inner();
        let hex: String = Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        std::fs::write(dir.join(&hex), &bytes).unwrap();
        let path: Arc<Path> = dir.join(&hex).into();

        // A 120 px thumbnail of a 1024 × 640 picture draws at 120 × 75: level 3, 128 × 80.
        let mut thumbnails = Thumbnails::new(120.0);
        let start = std::time::Instant::now();
        let image = loop {
            if let Some(found) = thumbnails.thumbnail(&path) {
                break found.unwrap().0;
            }
            assert!(start.elapsed().as_secs() < 30, "the level arrives");
            std::thread::sleep(std::time::Duration::from_millis(5));
        };
        assert_eq!(image.size(0), size(DevicePixels(128), DevicePixels(80)));
        // A second cache asks the same service: the level is held, nothing decodes again.
        let decoded = deep_images::shared().stats().decoded;
        let again = Thumbnails::new(120.0).thumbnail(&path).unwrap().unwrap().0;
        assert_eq!(again.size(0), image.size(0));
        assert_eq!(deep_images::shared().stats().decoded, decoded);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
