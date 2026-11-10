//! A 2D writer layer drawn by Vello GPU on a wgpu device (issue #385; Decided, The 2D renderer):
//! the same painter `raster` draws with, on Vello GPU's scene, into a texture the caller hands
//! over or into one read back. An image's pixmap reaches Vello GPU's atlas the first time it's
//! painted and stays there while each frame paints it, so it uploads once (#1485). Vello GPU 0.3.0
//! refuses mask layers as unimplemented, so a layer with an alpha or luminance mask is refused
//! here, naming the mask, before anything draws.

use std::cell::RefCell;
use std::path::PathBuf;
use std::sync::Arc;

use deep_canvas_marks::scene::{Drawn, Scope};
use deep_marks_vello::Canvas;
use serde_json::Value;
use vello_cpu::kurbo::{Affine, BezPath, Rect, Stroke};
use vello_cpu::peniko::{self, BlendMode, Brush, FontData};
use vello_cpu::{ImageSource, Mask, PaintType};
use vello_gpu::{
    ClearSettings, RenderSize, RenderTargetConfig, Renderer, Resources, Scene, TargetInit,
    TextureBindings,
};

use crate::asset::{Kept, Plant};
use crate::raster::{Glyphs, Painter};
use crate::refused;

/// The Vello GPU version Cargo.lock holds (a test holds it to the lock).
pub const VELLO_GPU: &str = "0.3.0";

/// Whether Vello GPU draws mask layers: 0.3.0 refuses them as unimplemented.
pub const MASK_LAYERS: bool = false;

/// The spike record shipped with the GPU layer: five runs of `deep-gpu`'s `spike2d` on a reference
/// Mac, its build and each run's load beside the frames.
pub const SPIKE: &str = include_str!("../spike/vello_gpu_2d.json");

/// Whether Vello GPU draws: the spike record in force and its verdict (Decided, The 2D renderer:
/// "provided its spike shows a second 2D handoff under 1 ms a frame").
pub struct Gate {
    pub record: Value,
    pub enabled: bool,
}

impl Gate {
    /// The gate a record sets; `ignores` plants #385 AC5's wrong program, Vello GPU on whatever the
    /// record says.
    pub fn read(text: &str, ignores: bool) -> Result<Gate, String> {
        let record: Value = serde_json::from_str(text).map_err(|e| e.to_string())?;
        let enabled = ignores || passes(&record);
        Ok(Gate { record, enabled })
    }

    /// The shipped record's gate.
    pub fn shipped() -> Gate {
        Gate::read(SPIKE, false).unwrap_or(Gate {
            record: Value::Null,
            enabled: false,
        })
    }
}

/// The design's budget judge over the record (Every task carries its own budgets): Vello GPU at
/// this build's version, five or more runs of at least 300 frames, each run's p95 handoff within
/// the budget.
fn passes(record: &Value) -> bool {
    if record["renderer"] != serde_json::json!({"name": "vello_gpu", "version": VELLO_GPU}) {
        return false;
    }
    let budget = record["budget_ms"].as_f64().unwrap_or(1.0);
    let Some(runs) = record["runs"].as_array() else {
        return false;
    };
    let p95 = |frames: &[Value]| -> Option<f64> {
        let mut ms: Vec<f64> = frames.iter().map(Value::as_f64).collect::<Option<_>>()?;
        if ms.len() < 300 {
            return None;
        }
        ms.sort_by(f64::total_cmp);
        Some(ms[(ms.len() * 95).div_ceil(100) - 1])
    };
    runs.len() >= 5
        && runs.iter().all(|r| {
            r["handoff_ms"]
                .as_array()
                .and_then(|f| p95(f))
                .is_some_and(|v| v <= budget)
        })
}

/// Vello GPU's scene while a layer is painted, with what it needs to put images in its atlas.
struct Gpu<'a> {
    scene: Scene,
    transform: Affine,
    renderer: &'a mut Renderer,
    resources: &'a mut Resources,
    device: &'a wgpu::Device,
    queue: &'a wgpu::Queue,
    encoder: &'a mut wgpu::CommandEncoder,
    /// The pixmaps in the atlas, and how many the renderer has uploaded.
    uploaded: &'a mut Vec<Uploaded>,
    uploads: &'a mut u64,
    /// #1485 AC5's wrong program: each paint uploads, and the drawing frees them all after.
    per_draw: Option<Vec<vello_cpu::ImageId>>,
    /// #385 AC1's wrong program: every solid fill two codes redder.
    shifts_fill: bool,
}

/// A pixmap in Vello GPU's atlas: the pixmap it was made from, its ID there, and whether the frame
/// painted it.
type Uploaded = (Arc<vello_cpu::Pixmap>, vello_cpu::ImageId, bool);

impl Canvas for Gpu<'_> {
    fn width(&self) -> u16 {
        self.scene.width()
    }
    fn height(&self) -> u16 {
        self.scene.height()
    }
    fn transform(&self) -> Affine {
        self.transform
    }
    fn set_transform(&mut self, transform: Affine) {
        self.transform = transform;
        self.scene.set_transform(transform);
    }
    fn set_paint(&mut self, paint: PaintType) {
        let paint = match paint {
            Brush::Solid(c) if self.shifts_fill => {
                let mut c = c;
                c.components[0] = (c.components[0] + 2.0 / 255.0).min(1.0);
                Brush::Solid(c)
            }
            Brush::Image(mut image) => {
                if let ImageSource::Pixmap(pixmap) = &image.image {
                    let found = (self.per_draw.is_none())
                        .then(|| {
                            self.uploaded
                                .iter_mut()
                                .find(|(p, ..)| Arc::ptr_eq(p, pixmap))
                        })
                        .flatten();
                    let id = match found {
                        Some((_, id, painted)) => {
                            *painted = true;
                            *id
                        }
                        None => {
                            let id = self.renderer.upload_image(
                                self.resources,
                                self.device,
                                self.queue,
                                self.encoder,
                                &Arc::clone(pixmap),
                            );
                            *self.uploads += 1;
                            match &mut self.per_draw {
                                Some(ids) => ids.push(id),
                                None => self.uploaded.push((pixmap.clone(), id, true)),
                            }
                            id
                        }
                    };
                    image.image = ImageSource::OpaqueId {
                        id,
                        may_have_transparency: true,
                    };
                }
                Brush::Image(image)
            }
            p => p,
        };
        self.scene.set_paint(paint);
    }
    fn set_paint_transform(&mut self, transform: Affine) {
        self.scene.set_paint_transform(transform);
    }
    fn reset_paint_transform(&mut self) {
        self.scene.reset_paint_transform();
    }
    fn set_fill_rule(&mut self, rule: peniko::Fill) {
        self.scene.set_fill_rule(rule);
    }
    fn set_stroke(&mut self, stroke: Stroke) {
        self.scene.set_stroke(stroke);
    }
    fn fill_path(&mut self, path: &BezPath) {
        self.scene.fill_path(path);
    }
    fn stroke_path(&mut self, path: &BezPath) {
        self.scene.stroke_path(path);
    }
    fn fill_rect(&mut self, rect: &Rect) {
        self.scene.fill_rect(rect);
    }
    fn push_clip_rect(&mut self, rect: &Rect) {
        self.scene.push_clip_rect(rect);
    }
    fn pop_clip(&mut self) {
        self.scene.pop_clip();
    }
    fn push_layer(
        &mut self,
        clip: Option<&BezPath>,
        blend: Option<BlendMode>,
        opacity: Option<f32>,
        _mask: Option<Mask>,
    ) {
        // A mask never gets here: `refusal` turns its layer away first.
        self.scene.push_layer(clip, blend, opacity, None, None);
    }
    fn pop_layer(&mut self) {
        self.scene.pop_layer();
    }
    fn set_aliasing_threshold(&mut self, threshold: Option<u8>) {
        self.scene.set_aliasing_threshold(threshold);
    }
}

impl Glyphs for Gpu<'_> {
    fn glyph(
        &mut self,
        _: &mut vello_cpu::Resources,
        font: &FontData,
        size: f32,
        coords: &[i16],
        glyph: vello_cpu::Glyph,
    ) {
        let run = self.scene.glyph_run(self.resources, font);
        let _ = run
            .font_size(size)
            .hint(false)
            .normalized_coords(coords)
            .fill_glyphs(std::iter::once(glyph));
    }

    fn glyph_stroke(
        &mut self,
        _: &mut vello_cpu::Resources,
        font: &FontData,
        size: f32,
        coords: &[i16],
        glyph: vello_cpu::Glyph,
        width: f64,
    ) {
        self.set_stroke(deep_marks_vello::stroke(width));
        let run = self.scene.glyph_run(self.resources, font);
        let _ = run
            .font_size(size)
            .hint(false)
            .normalized_coords(coords)
            .stroke_glyphs(std::iter::once(glyph));
    }
}

/// The first mark of `marks` Vello GPU can't draw yet, as the live view's refusal naming its
/// item: one inside an alpha or luminance mask, until Vello GPU's mask layers draw.
pub fn refusal<'a>(marks: impl IntoIterator<Item = &'a Drawn>) -> Option<Value> {
    marks.into_iter().find_map(|d| {
        d.scopes.iter().find_map(|s| match s {
            Scope::Mask { item, .. } if !MASK_LAYERS => {
                Some(refused("module_missing", &format!("items/{item}")))
            }
            _ => None,
        })
    })
}

/// What a drawing asks beyond its marks.
#[derive(Clone, Copy, Debug)]
pub struct Options {
    /// Device px per u.
    pub zoom: f64,
    /// #385 AC1's wrong program: every solid fill two codes redder.
    pub shifts_fill: bool,
    /// #1485's wrong program on the drawing's images.
    pub plant: Plant,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            zoom: 1.0,
            shifts_fill: false,
            plant: Plant::None,
        }
    }
}

/// Vello GPU on one device, drawing into targets of one format: its renderer and resources, kept
/// from drawing to drawing, and the images it decoded and the pixmaps in its atlas, kept while
/// each frame draws them.
pub struct Vello2d {
    renderer: Renderer,
    resources: Resources,
    format: wgpu::TextureFormat,
    depth: Option<([u16; 2], wgpu::TextureView)>,
    /// The content-addressed store images are read from; with one, the owner ends each frame
    /// ([`Vello2d::frame_ended`]), else each drawing is a frame.
    store: Option<PathBuf>,
    kept: RefCell<Kept>,
    uploaded: Vec<Uploaded>,
    /// Pixmaps the last frame didn't paint, freed from the atlas once the next drawing has rendered.
    freeing: Vec<vello_cpu::ImageId>,
    uploads: u64,
}

impl Vello2d {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let (renderer, resources) = Renderer::new(
            device,
            &RenderTargetConfig {
                format,
                width: 1,
                height: 1,
            },
        );
        Vello2d {
            renderer,
            resources,
            format,
            depth: None,
            store: None,
            kept: RefCell::default(),
            uploaded: Vec::new(),
            freeing: Vec::new(),
            uploads: 0,
        }
    }

    /// Reads images from `store`, the folder whose files are named by their sha256.
    pub fn set_store(&mut self, store: Option<PathBuf>) {
        self.store = store;
    }

    /// A frame is drawn: the images and pixmaps none of its drawings painted are let go.
    pub fn frame_ended(&mut self) {
        self.kept.get_mut().frame_ended();
        let freeing = &mut self.freeing;
        self.uploaded.retain_mut(|(_, id, painted)| {
            if !*painted {
                freeing.push(*id);
            }
            std::mem::replace(painted, false)
        });
    }

    /// The pixmaps the renderer has uploaded to Vello GPU's atlas so far.
    pub fn uploads(&self) -> u64 {
        self.uploads
    }

    /// The format it draws into.
    pub fn format(&self) -> wgpu::TextureFormat {
        self.format
    }

    /// `marks` at zoom 1 over transparent black into `view`, `size` px, encoded on `encoder`.
    #[allow(clippy::too_many_arguments)]
    pub fn draw<'d>(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        marks: impl IntoIterator<Item = &'d Drawn> + Clone,
        size: [u32; 2],
        view: &wgpu::TextureView,
        options: Options,
    ) -> Result<(), Value> {
        if let Some(r) = refusal(marks.clone()) {
            return Err(r);
        }
        let (Ok(w), Ok(h)) = (u16::try_from(size[0]), u16::try_from(size[1])) else {
            return Err(refused("out_of_range", "size"));
        };
        let render_size = RenderSize {
            width: w,
            height: h,
        };
        if self.depth.as_ref().is_none_or(|(s, _)| *s != [w, h]) {
            let depth = Renderer::create_depth_texture_view(device, &render_size);
            self.depth = Some(([w, h], depth));
        }
        self.kept.get_mut().plant = options.plant;
        let gpu = Gpu {
            scene: Scene::new(w, h),
            transform: Affine::IDENTITY,
            renderer: &mut self.renderer,
            resources: &mut self.resources,
            device,
            queue,
            encoder,
            uploaded: &mut self.uploaded,
            uploads: &mut self.uploads,
            per_draw: (options.plant == Plant::UploadsPerFrame).then(Vec::new),
            shifts_fill: options.shifts_fill,
        };
        let mut p = Painter::on(gpu);
        p.zoom = options.zoom;
        p.store = self.store.as_deref();
        p.kept = Some(&self.kept);
        p.ctx.set_transform(Affine::scale(options.zoom));
        let painted = p.marks(marks);
        let Gpu {
            scene,
            renderer,
            resources,
            encoder,
            per_draw,
            ..
        } = p.ctx;
        let depth = self.depth.as_ref().map(|(_, d)| d);
        let drawn = painted.and_then(|()| {
            renderer
                .render(
                    &scene,
                    resources,
                    device,
                    queue,
                    encoder,
                    &render_size,
                    view,
                    depth,
                    &TextureBindings::new(),
                    TargetInit::Clear(ClearSettings::default()),
                )
                .map_err(|e| refused("not_drawn", &format!("vello_gpu: {e:?}")))
        });
        // Freed once the drawing has rendered, since a free's clear runs after the uploads land:
        // freed before, a new pixmap given the same place in the atlas would be cleared.
        for id in per_draw.into_iter().flatten().chain(self.freeing.drain(..)) {
            renderer.destroy_image(resources, encoder, id);
        }
        if self.store.is_none() {
            self.frame_ended();
        }
        drawn
    }

    /// `marks` drawn by [`Vello2d::draw`] into a texture of its own, read back as straight RGBA.
    pub fn picture(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        marks: &[&Drawn],
        size: [u32; 2],
        options: Options,
    ) -> Result<image::RgbaImage, Value> {
        let extent = wgpu::Extent3d {
            width: size[0],
            height: size[1],
            depth_or_array_layers: 1,
        };
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("vello_gpu picture"),
            size: extent,
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        let mut encoder = device.create_command_encoder(&Default::default());
        self.draw(
            device,
            queue,
            &mut encoder,
            marks.iter().copied(),
            size,
            &view,
            options,
        )?;
        read_back(device, queue, encoder, &texture, size, self.format)
    }
}

/// `texture` read back as straight RGBA after `encoder`'s work.
pub fn read_back(
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    mut encoder: wgpu::CommandEncoder,
    texture: &wgpu::Texture,
    size: [u32; 2],
    format: wgpu::TextureFormat,
) -> Result<image::RgbaImage, Value> {
    let extent = wgpu::Extent3d {
        width: size[0],
        height: size[1],
        depth_or_array_layers: 1,
    };
    let row = (size[0] * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("vello_gpu picture read back"),
        size: u64::from(row) * u64::from(size[1]),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    encoder.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: None,
            },
        },
        extent,
    );
    queue.submit([encoder.finish()]);
    let (tx, rx) = std::sync::mpsc::channel();
    buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| {
        let _ = tx.send(r);
    });
    let _ = device.poll(wgpu::PollType::wait_indefinitely());
    if !matches!(rx.recv(), Ok(Ok(()))) {
        return Err(refused("no_read_back", "vello_gpu picture"));
    }
    let data = buffer
        .slice(..)
        .get_mapped_range()
        .map_err(|_| refused("no_read_back", "vello_gpu picture"))?;
    let bgra = format == wgpu::TextureFormat::Bgra8Unorm;
    let mut out = Vec::with_capacity((size[0] * size[1] * 4) as usize);
    for y in 0..size[1] as usize {
        let at = y * row as usize;
        for p in data[at..at + size[0] as usize * 4].as_chunks::<4>().0 {
            let (r, b) = if bgra { (p[2], p[0]) } else { (p[0], p[2]) };
            out.extend_from_slice(&straight([r, p[1], b, p[3]]));
        }
    }
    image::RgbaImage::from_raw(size[0], size[1], out)
        .ok_or_else(|| refused("not_written", "vello_gpu picture"))
}

/// A premultiplied pixel as straight alpha, as Vello CPU's pixmap gives it.
fn straight(p: [u8; 4]) -> [u8; 4] {
    let a = p[3];
    if a == 0 || a == 255 {
        return if a == 0 { [0; 4] } else { p };
    }
    let c = |v: u8| ((u16::from(v) * 255 + u16::from(a) / 2) / u16::from(a)).min(255) as u8;
    [c(p[0]), c(p[1]), c(p[2]), a]
}

#[cfg(test)]
mod tests {
    /// Each Vello renderer's version an answer names, as Cargo.lock holds it.
    #[test]
    fn the_named_versions_are_the_locked_ones() {
        let lock = include_str!("../../../Cargo.lock");
        let locked = |name: &str| {
            lock.split("[[package]]")
                .find(|p| p.contains(&format!("name = \"{name}\"\n")))
                .and_then(|p| p.split("version = \"").nth(1))
                .and_then(|v| v.split('"').next())
                .map(str::to_string)
        };
        assert_eq!(locked("vello_gpu").as_deref(), Some(super::VELLO_GPU));
        assert_eq!(
            locked("vello_cpu").as_deref(),
            Some(crate::raster::VELLO_CPU)
        );
    }
}
