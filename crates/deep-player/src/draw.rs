//! A frame as the player draws it, as the app's renders draw it: a 2D document's writer layers by
//! Vello CPU over the look's ground (sRGB-encoded RGBA, rows top-down); a 3D document's scene for
//! scene3d's renderer on the GPU, with its 2D writer layers to lay over it. A set without the 3D
//! module (#1490) draws every frame as a 2D one: the export gives it no 3D document.

use std::sync::Arc;

#[cfg(feature = "full")]
use deep_canvas_scene3d::contributed::Fills;
#[cfg(feature = "full")]
use deep_canvas_scene3d::look::Look3;
#[cfg(feature = "full")]
use deep_canvas_scene3d::scene::{has_3d, Labels, Scene};
use deep_marks_raster::Renderer;

use crate::play::Played;

/// What a frame draws.
pub enum Frame {
    /// A 2D frame's pixels.
    Pixels(Vec<u8>),
    /// A 3D frame's scene and look, and its 2D writer layers' straight RGBA with no ground.
    #[cfg(feature = "full")]
    Scene(Box<Scene>, Box<Look3>, Vec<u8>),
}

/// The player's painter and the store its pictures come from: the bundle, held in memory.
pub struct Draw {
    renderer: Renderer,
    store: Arc<deep_images::Store>,
    #[cfg(feature = "full")]
    labels: Labels,
}

impl Draw {
    pub fn new(store: Arc<deep_images::Store>) -> Draw {
        Draw {
            renderer: Renderer::new(),
            store,
            #[cfg(feature = "full")]
            labels: Labels::new(),
        }
    }

    /// The frame the session last evaluated, at `size` pixels.
    pub fn frame(&mut self, p: &Played, size: [u32; 2]) -> Frame {
        let px = size.map(|v| v.clamp(1, 8192) as u16);
        let fill = |rgba: [u8; 4]| rgba.repeat((size[0] * size[1]) as usize);
        let [r, g, b] = p.ground;
        #[cfg(feature = "full")]
        if has_3d(p.document()) {
            return self
                .scene(p, px, &|| fill([0, 0, 0, 0]))
                .unwrap_or_else(|| Frame::Pixels(fill([r, g, b, 255])));
        }
        Frame::Pixels(
            self.layers(p, px, Some(p.ground))
                .unwrap_or_else(|| fill([r, g, b, 255])),
        )
    }

    /// The session's 2D writer layers at `px`, over `ground` when given.
    fn layers(&mut self, p: &Played, px: [u16; 2], ground: Option<[u8; 3]>) -> Option<Vec<u8>> {
        let painted = p.painted()?;
        let drawn = self.renderer.prepare_drawing(&painted, &self.store).ok()?;
        Some(self.renderer.raster(&drawn, px, ground))
    }

    /// A 3D frame: the scene evaluated at the session's time, with its 2D writer layers to lay
    /// over it (`clear`'s where it has none); none when the scene is refused.
    #[cfg(feature = "full")]
    fn scene(&mut self, p: &Played, px: [u16; 2], clear: &dyn Fn() -> Vec<u8>) -> Option<Frame> {
        let store = self.store.clone();
        let read = move |sha: &str| store.read(&deep_images::hash_of(sha)?).ok();
        let fills = Fills {
            outlines: &p.sealed.outlines,
            module: &p.sealed.fills,
            planted: None,
            memo: None,
        };
        let (scene, look) = deep_play::scene::evaluate(
            p.document(),
            p.t(),
            &p.look.light,
            px,
            &mut self.labels,
            &read,
            fills,
        )
        .ok()?;
        let over = self.layers(p, px, None).unwrap_or_else(clear);
        Some(Frame::Scene(Box::new(scene), Box::new(look), over))
    }
}
