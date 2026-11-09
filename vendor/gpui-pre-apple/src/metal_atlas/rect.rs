//! DeepBuild patch (windoliver/deepbuild#1480): a rectangle written into an uploaded tile.

use super::MetalAtlasTextures;
use gpui::{AtlasRectBackend, AtlasTextureKind, AtlasTile, Bounds, DevicePixels};

impl AtlasRectBackend for MetalAtlasTextures {
    fn write_rect(&mut self, tile: AtlasTile, region: Bounds<DevicePixels>, bytes: &[u8], stride: usize) {
        let Some(texture) = self.texture(tile.texture_id) else {
            return;
        };
        if tile.texture_id.kind != AtlasTextureKind::Monochrome {
            return;
        }
        let (x, y) = (region.origin.x.0 as usize, region.origin.y.0 as usize);
        let (w, h) = (region.size.width.0 as usize, region.size.height.0 as usize);
        let Some(start) = bytes.get(y * stride + x..) else {
            return;
        };
        if w == 0 || h == 0 || start.len() < (h - 1) * stride + w {
            return;
        }
        let target = metal::MTLRegion::new_2d(
            (tile.bounds.origin.x.0 + region.origin.x.0) as u64,
            (tile.bounds.origin.y.0 + region.origin.y.0) as u64,
            region.size.width.0 as u64,
            region.size.height.0 as u64,
        );
        texture
            .metal_texture
            .replace_region(target, 0, start.as_ptr() as *const _, stride as u64);
    }
}
