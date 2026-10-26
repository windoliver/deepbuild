//! Issue #378: a revision that holds 3D writer layers, drawn natively by scene3d's render module
//! on the app's GPU (canvas primitives: Render-back: 3D layers render on the GPU), for its
//! render-back snapshots and for its layer's picture in the window. The device opens on the
//! first 3D revision drawn and stays for the run.

use std::sync::Arc;

use deep_canvas_marks::scene::Palette;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::scene::{evaluate, Labels, Scene};
use deep_gpu::device::{Backend, Device, Gpu};
use deep_scene3d_render::{draw_offscreen, Planted, Renderer};
use serde_json::{json, Value};

use crate::snapshot::Unfit;

pub struct Gpu3 {
    _gpu: Arc<Gpu>,
    device: Arc<Device>,
    renderer: Renderer,
    labels: Labels,
}

impl Gpu3 {
    /// The app's GPU, or `None` where there is none to draw 3D on.
    pub fn open() -> Option<Gpu3> {
        let gpu = Gpu::open(Backend::Gpu).ok()?;
        let device = gpu.recover().ok()?;
        let renderer = Renderer::new(&device, Planted::default());
        Some(Gpu3 {
            _gpu: gpu,
            device,
            renderer,
            labels: Labels::new(),
        })
    }

    /// `doc` at `t`, drawn at `size` px over the look's ground: straight RGBA, rows top-down,
    /// with the scene it drew.
    pub fn draw(
        &mut self,
        doc: &Value,
        t: i64,
        palette: &Palette,
        size: [u16; 2],
    ) -> Result<(Vec<u8>, Scene), Unfit> {
        let mut doc = doc.clone();
        if let Some(d) = doc.as_object_mut() {
            d.insert("size".into(), json!(size));
        }
        let look = Look3::from_roles(palette.clone());
        let scene = evaluate(&doc, t, &look, &mut self.labels).map_err(|r| Unfit {
            code: r.code,
            path: r.path,
        })?;
        let mut bytes = draw_offscreen(&self.device, &mut self.renderer, &scene, &look, None)
            .ok_or(Unfit {
                code: "unsupported_platform",
                path: String::new(),
            })?;
        for p in bytes.as_chunks_mut::<4>().0 {
            p.swap(0, 2);
        }
        Ok((bytes, scene))
    }
}
