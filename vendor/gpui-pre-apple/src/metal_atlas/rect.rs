//! DeepBuild patch (windoliver/deepbuild#1480): a rectangle written into an uploaded tile.

use super::MetalAtlasTextures;
use gpui::{AtlasRectBackend, AtlasTextureKind, AtlasTile, Bounds, DevicePixels};
use objc2_metal::{MTLOrigin, MTLRegion, MTLSize, MTLTexture as _};
use std::ptr::NonNull;

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
        let target = MTLRegion {
            origin: MTLOrigin {
                x: (tile.bounds.origin.x.0 + region.origin.x.0) as usize,
                y: (tile.bounds.origin.y.0 + region.origin.y.0) as usize,
                z: 0,
            },
            size: MTLSize { width: w, height: h, depth: 1 },
        };
        // SAFETY: `start` holds `h` rows of `stride` bytes but for the last, which holds `w`, as checked above, and
        // the bytes stay borrowed for the copy into this CPU-accessible texture.
        unsafe {
            texture.metal_texture.replaceRegion_mipmapLevel_withBytes_bytesPerRow(
                target,
                0,
                NonNull::from(start).cast(),
                stride,
            );
        }
    }
}
