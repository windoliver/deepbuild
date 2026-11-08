//! DeepBuild patch (windoliver/deepbuild#390): the key of one alpha page from a glyph atlas GPUI
//! doesn't own, uploaded once per `generation` and drawn through `Window::paint_mask_sprite`.

use super::AtlasKey;

/// One alpha page of a glyph atlas outside GPUI.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct RenderMaskParams {
    /// Which atlas the page belongs to, chosen by its owner.
    pub atlas: u32,
    /// The page within that atlas.
    pub page: u32,
    /// Bumped by the owner each time the page's bytes change, so the stale upload is replaced.
    pub generation: u32,
}

impl From<RenderMaskParams> for AtlasKey {
    fn from(params: RenderMaskParams) -> Self {
        Self::Mask(params)
    }
}
