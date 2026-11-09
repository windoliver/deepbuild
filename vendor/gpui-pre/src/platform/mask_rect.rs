//! DeepBuild patch (windoliver/deepbuild#1480): a rectangle written into a mask page that is
//! already uploaded, so a glyph added to a glyph atlas outside GPUI costs its own bytes and the
//! page keeps its key.

use super::{AtlasKey, AtlasState, AtlasTile, Bounds, DevicePixels};

/// A backend that can overwrite part of an uploaded tile.
#[doc(hidden)]
pub trait AtlasRectBackend {
    /// Writes `region` (relative to the tile) from `bytes`, whose rows are `stride` bytes apart
    /// and which start at the page's top-left corner; reads the bytes in place and copies none.
    fn write_rect(&mut self, tile: AtlasTile, region: Bounds<DevicePixels>, bytes: &[u8], stride: usize);
}

impl<Backend: AtlasRectBackend> AtlasState<Backend> {
    /// False when no page is uploaded under `key`.
    pub fn write_rect(&mut self, key: &AtlasKey, region: Bounds<DevicePixels>, bytes: &[u8], stride: usize) -> bool {
        let Some(tile) = self.tiles_by_key.get(key).copied() else {
            return false;
        };
        self.backend.write_rect(tile, region, bytes, stride);
        true
    }
}
