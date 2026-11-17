//! A frame as the player draws it, as the app's renders draw it: a 2D document's writer layers by
//! Vello CPU over the look's ground (sRGB-encoded RGBA, rows top-down); a 3D document's scene for
//! scene3d's renderer on the GPU, with its 2D writer layers to lay over it.

use std::sync::Arc;

use deep_canvas_scene3d::contributed::Fills;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{has_3d, Labels, Scene};
use deep_marks_raster::Renderer;

use crate::play::Played;

/// What a frame draws.
pub enum Frame {
    /// A 2D frame's pixels.
    Pixels(Vec<u8>),
    /// A 3D frame's scene and look, and its 2D writer layers' straight RGBA with no ground.
    Scene(Box<Scene>, Box<Look3>, Vec<u8>),
}

/// The player's painter and the store its pictures come from: the bundle, held in memory.
pub struct Draw {
    renderer: Renderer,
    store: Arc<deep_images::Store>,
    labels: Labels,
}

impl Draw {
    pub fn new(store: Arc<deep_images::Store>) -> Draw {
        Draw {
            renderer: Renderer::new(),
            store,
            labels: Labels::new(),
        }
    }

    /// The frame the session last evaluated, at `size` pixels.
    pub fn frame(&mut self, p: &Played, size: [u32; 2]) -> Frame {
        let px = size.map(|v| v.clamp(1, 8192) as u16);
        let fill = |rgba: [u8; 4]| rgba.repeat((size[0] * size[1]) as usize);
        let [r, g, b] = p.ground;
        let layers = |this: &mut Draw, ground: Option<[u8; 3]>| {
            let painted = p.painted()?;
            let drawn = this.renderer.prepare_drawing(&painted, &this.store).ok()?;
            Some(this.renderer.raster(&drawn, px, ground))
        };
        if !has_3d(p.document()) {
            return Frame::Pixels(
                layers(self, Some(p.ground)).unwrap_or_else(|| fill([r, g, b, 255])),
            );
        }
        let store = self.store.clone();
        let read = move |sha: &str| store.read(&deep_images::hash_of(sha)?).ok();
        let fills = Fills {
            outlines: &p.sealed.outlines,
            module: &p.sealed.fills,
            planted: None,
            memo: None,
        };
        let evaluated = deep_play::scene::evaluate(
            p.document(),
            p.t(),
            &p.look.light,
            px,
            &mut self.labels,
            &read,
            fills,
        );
        match evaluated {
            Ok((scene, look)) => {
                let over = layers(self, None).unwrap_or_else(|| fill([0, 0, 0, 0]));
                Frame::Scene(Box::new(scene), Box::new(look), over)
            }
            Err(_) => Frame::Pixels(fill([r, g, b, 255])),
        }
    }
}
