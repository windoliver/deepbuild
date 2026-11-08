//! DeepBuild patch (windoliver/deepbuild#390): a tinted mask sprite drawn from a glyph atlas GPUI doesn't own.

use crate::{
    AtlasTile, Bounds, DevicePixels, Hsla, MonochromeSprite, Pixels, RenderMaskParams, Result,
    Size, TransformationMatrix, Window,
};
use std::borrow::Cow;

impl Window {
    /// DeepBuild patch (windoliver/deepbuild#390): paints `region` of an alpha page that a glyph
    /// atlas outside GPUI owns, tinted with one `color`, as a monochrome sprite into the scene for
    /// the next frame. The page is uploaded once per `params` (its generation) through `build`,
    /// which returns the page's size and its `R8` bytes; every later call with the same key draws
    /// from the uploaded texture, so one page serves any number of colors. `bounds` is in logical
    /// pixels and is drawn as given, with no snapping, since the caller already placed its glyph on
    /// device pixels. Drawing never reaches GPUI's text system.
    ///
    /// This method should only be called as part of the paint phase of element drawing.
    pub fn paint_mask_sprite(
        &mut self,
        bounds: Bounds<Pixels>,
        params: RenderMaskParams,
        region: Bounds<DevicePixels>,
        color: Hsla,
        build: &mut dyn FnMut() -> (Size<DevicePixels>, Vec<u8>),
    ) -> Result<()> {
        self.invalidator.debug_assert_paint();

        let element_opacity = self.element_opacity();
        let scale_factor = self.scale_factor();
        let Some(page) = self
            .sprite_atlas
            .get_or_insert_with(params.into(), &mut || {
                let (size, bytes) = build();
                Ok(Some((size, Cow::Owned(bytes))))
            })?
        else {
            return Ok(());
        };
        let tile = AtlasTile {
            bounds: Bounds {
                origin: page.bounds.origin + region.origin,
                size: region.size,
            },
            ..page
        };
        self.next_frame.scene.insert_primitive(MonochromeSprite {
            order: 0,
            pad: 0,
            bounds: bounds.scale(scale_factor),
            content_mask: self.snapped_content_mask(),
            color: color.opacity(element_opacity),
            tile,
            transformation: TransformationMatrix::unit(),
        });
        Ok(())
    }

    /// DeepBuild patch (windoliver/deepbuild#390): forgets an uploaded mask page, so its owner can
    /// upload the next generation.
    pub fn remove_mask_page(&mut self, params: RenderMaskParams) {
        self.sprite_atlas.remove(&params.into());
    }
}
