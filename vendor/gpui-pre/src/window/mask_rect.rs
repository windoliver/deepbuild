//! DeepBuild patch (windoliver/deepbuild#1480): writes a rectangle into an uploaded mask page.

use crate::{AtlasKey, Bounds, DevicePixels, RenderMaskParams, Window};

impl Window {
    /// DeepBuild patch (windoliver/deepbuild#1480): overwrites `region` of the mask page uploaded
    /// under `params` with the same rectangle of `page`, the page's whole `R8` bytes, `stride`
    /// bytes a row; nothing is copied. The page's key stays, so sprites queued this frame and
    /// later ones draw the new pixels. False when the window holds no such page or its atlas
    /// can't write a rectangle; the caller uploads the page whole.
    pub fn write_mask_rect(&mut self, params: RenderMaskParams, region: Bounds<DevicePixels>, page: &[u8], stride: usize) -> bool {
        self.sprite_atlas.write_rect(&AtlasKey::Mask(params), region, page, stride)
    }
}
