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
    /// The device it draws on, for the export's frame hashes (#501).
    pub fn device(&self) -> &Arc<Device> {
        &self.device
    }

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

    /// #427: `doc` at `t` on a frame of `size`, its `mesh.asset@1` items read from `assets`: the
    /// evaluated scene a diagnostic mode reads and draws, and the look it draws in.
    pub fn evaluate(
        &mut self,
        doc: &Value,
        t: i64,
        palette: &Palette,
        size: [u16; 2],
        assets: deep_canvas_scene3d::scene::Assets<'_>,
    ) -> Result<(Scene, Look3), Unfit> {
        let mut doc = doc.clone();
        if let Some(d) = doc.as_object_mut() {
            d.insert("size".into(), json!(size));
        }
        let look = Look3::from_roles(palette.clone());
        let scene =
            deep_canvas_scene3d::scene::evaluate_with(&doc, t, &look, &mut self.labels, assets)
                .map_err(|r| Unfit {
                    code: r.code,
                    path: r.path,
                })?;
        Ok((scene, look))
    }

    /// #427: an evaluated scene drawn offscreen in a diagnostic view: straight RGBA, rows
    /// top-down, never on a live surface.
    pub fn render(
        &mut self,
        scene: &Scene,
        look: &Look3,
        diag: &deep_scene3d_render::Diag,
    ) -> Option<(Vec<u8>, deep_scene3d_render::DiagCounts)> {
        let (mut bytes, counts) = deep_scene3d_render::draw_offscreen_diag(
            &self.device,
            &mut self.renderer,
            scene,
            look,
            diag,
        )?;
        for p in bytes.as_chunks_mut::<4>().0 {
            p.swap(0, 2);
        }
        Some((bytes, counts))
    }

    /// #464: a 2D frame through the look's print finish on this machine's GPU: `base` (RGBA over
    /// the ground) and each separation's coverage (RGBA, its alpha) in, the printed RGBA out.
    pub fn print(
        &mut self,
        params: &deep_scene3d_render::print::Params,
        base: &[u8],
        covs: &[Vec<u8>],
        size: [u32; 2],
    ) -> Option<Vec<u8>> {
        use deep_scene3d_render::print::{Coverage, Printer};
        let d = &self.device.device;
        let format = wgpu::TextureFormat::Rgba8Unorm;
        let upload = |bytes: &[u8]| {
            let t = d.create_texture(&wgpu::TextureDescriptor {
                label: Some("print snapshot"),
                size: wgpu::Extent3d {
                    width: size[0],
                    height: size[1],
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format,
                usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            });
            self.device.queue.write_texture(
                t.as_image_copy(),
                bytes,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(size[0] * 4),
                    rows_per_image: None,
                },
                t.size(),
            );
            t.create_view(&Default::default())
        };
        let source = upload(base);
        let inks: Vec<wgpu::TextureView> = covs.iter().map(|c| upload(c)).collect();
        let out = d.create_texture(&wgpu::TextureDescriptor {
            label: Some("print snapshot out"),
            size: wgpu::Extent3d {
                width: size[0],
                height: size[1],
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = out.create_view(&Default::default());
        let mut encoder = d.create_command_encoder(&Default::default());
        Printer::new(d).record(
            d,
            &mut encoder,
            params,
            &source,
            &Coverage::Textures(inks.iter().collect()),
            &view,
            format,
            None,
        );
        let row = (size[0] * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
        let buffer = d.create_buffer(&wgpu::BufferDescriptor {
            label: Some("print snapshot read back"),
            size: u64::from(row) * u64::from(size[1]),
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        encoder.copy_texture_to_buffer(
            out.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row),
                    rows_per_image: None,
                },
            },
            out.size(),
        );
        self.device.queue.submit([encoder.finish()]);
        let (tx, rx) = std::sync::mpsc::channel();
        buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        let _ = d.poll(wgpu::PollType::wait_indefinitely());
        rx.recv().ok()?.ok()?;
        let data = buffer.slice(..).get_mapped_range().ok()?;
        let w = (size[0] * 4) as usize;
        Some(
            (0..size[1] as usize)
                .flat_map(|y| data[y * row as usize..y * row as usize + w].to_vec())
                .collect(),
        )
    }
}
