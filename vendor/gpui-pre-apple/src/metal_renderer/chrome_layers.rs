//! DeepBuild patch (windoliver/deepbuild#1434): chrome layers on Metal. A layer's scene renders
//! into an offscreen target with alpha composited correctly, then draws once at its order with
//! its opacity, rounded clip and soft edge. An effect copies the target under its bounds (the
//! backdrop, at full, half or quarter scale), runs its registered operator's stages on it, and
//! draws the result at its order, premultiplied, with its clip and edge.
//!
//! Operators are registered by the app as Metal source written from shipped operators, under a
//! fixed binding contract: fragment buffer 0 is the frame (the output's size), buffer 1 the
//! operator's inputs, sampler 0 a linear clamp-to-edge sampler and textures 0.. its texture
//! inputs in order. An effect names an operator; a name nobody registered draws nothing.

use std::collections::HashMap;
use std::mem;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{Context as _, Result};
use gpui::{
    BackdropScale, Bounds, ChromeEffect, ChromeKind, ChromeLayer, ChromePrimitive, Corners,
    DevicePixels, PrimitiveBatch, ScaledPixels, Scene, Size, point, size,
};
use metal::MTLPixelFormat;

use super::{InstanceBufferWriter, MetalRenderer, new_command_encoder_for_texture, write_instances};

/// What a run's texture binding reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChromeInput {
    /// The effect's backdrop copy.
    Backdrop,
    /// An earlier run's output, by its index.
    Run(usize),
}

/// One graph of a registered operator: a full-screen pass in Metal source.
#[derive(Clone, Debug)]
pub struct ChromeGraph {
    /// Shown in GPU captures.
    pub label: String,
    /// The graph's Metal source.
    pub msl: String,
    /// Its vertex entry point.
    pub vertex: String,
    /// Its fragment entry point.
    pub fragment: String,
}

/// One pass an effect takes: the graph it runs, its inputs buffer and its textures, in order.
#[derive(Clone, Debug)]
pub struct ChromeRun {
    /// The graph's index in its operator.
    pub graph: usize,
    /// The inputs buffer.
    pub inputs: Vec<u8>,
    /// Each texture binding, in order.
    pub textures: Vec<ChromeInput>,
}

/// A registered operator: its graphs, and the runs an effect's params lay out from them.
#[derive(Clone)]
pub struct ChromeOperator {
    /// Its graphs.
    pub graphs: Vec<ChromeGraph>,
    /// The runs for an effect's params; the last one's output is the effect's.
    pub plan: Arc<dyn Fn(&[f32]) -> Vec<ChromeRun> + Send + Sync>,
}

static OPERATORS: Mutex<Option<HashMap<String, Arc<ChromeOperator>>>> = Mutex::new(None);

/// Registers an operator under `name`, for effects that name it.
pub fn register_operator(name: &str, operator: ChromeOperator) {
    if let Ok(mut operators) = OPERATORS.lock() {
        operators
            .get_or_insert_with(HashMap::new)
            .insert(name.to_string(), Arc::new(operator));
    }
}

fn operator(name: &str) -> Option<Arc<ChromeOperator>> {
    OPERATORS.lock().ok()?.as_ref()?.get(name).cloned()
}

/// The wrong programs the acceptance tests must catch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Planted {
    /// The renderer as it ships.
    None = 0,
    /// Composites as straight alpha, so a translucent pixel's color is multiplied twice.
    StraightAlpha = 1,
}

static PLANTED: AtomicU8 = AtomicU8::new(0);

/// Plants a wrong program for every renderer in the process.
pub fn plant(planted: Planted) {
    PLANTED.store(planted as u8, Ordering::SeqCst);
}

fn planted() -> Planted {
    match PLANTED.load(Ordering::SeqCst) {
        1 => Planted::StraightAlpha,
        _ => Planted::None,
    }
}

/// The composite's uniform, as `ChromeComposite` in `shaders_carried.metal`.
#[repr(C)]
struct Composite {
    bounds: Bounds<ScaledPixels>,
    drawn: Bounds<ScaledPixels>,
    radii: Corners<ScaledPixels>,
    opacity: f32,
    edge: f32,
    texel_for_texel: u32,
    pad: u32,
    source_origin: [f32; 2],
    pad2: [f32; 2],
}

/// The downsample's uniform, as `ChromeDownsample`.
#[repr(C)]
struct Downsample {
    origin: [u32; 2],
    step: u32,
    pad: u32,
}

/// The shipped operators' frame: clip and inverse clip (identity here), eye, size, time, seed.
#[repr(C)]
struct Frame {
    clip: [f32; 16],
    inverse_clip: [f32; 16],
    eye: [f32; 4],
    size: [f32; 4],
    time: [f32; 4],
    seed: [u32; 4],
}

const IDENTITY: [f32; 16] = [
    1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1., 0., 0., 0., 0., 1.,
];

/// The pipelines a layer's scene renders with: GPUI's own, but with the destination's alpha
/// scaled by one minus the source's, so the offscreen target holds the group's true coverage.
struct LayerPipelines {
    shadows: metal::RenderPipelineState,
    quads: metal::RenderPipelineState,
    underlines: metal::RenderPipelineState,
    monochrome_sprites: metal::RenderPipelineState,
    polychrome_sprites: metal::RenderPipelineState,
    path_sprites: metal::RenderPipelineState,
    surfaces: metal::RenderPipelineState,
}

pub(super) struct Chrome {
    library_device: metal::Device,
    layer: LayerPipelines,
    composite: metal::RenderPipelineState,
    composite_straight: metal::RenderPipelineState,
    downsample: metal::RenderPipelineState,
    sampler: metal::SamplerState,
    /// Offscreen targets by (use, depth), reused frame to frame; Metal orders their reuse.
    targets: HashMap<(u32, usize), metal::Texture>,
    /// Backdrop copies taken earlier in paint order, by key, until an effect reads them.
    captures: HashMap<u64, metal::Texture>,
    /// Each registered operator's compiled graphs.
    compiled: HashMap<String, Vec<metal::RenderPipelineState>>,
    depth: usize,
}

fn layer_pipeline(
    device: &metal::DeviceRef,
    library: &metal::LibraryRef,
    label: &str,
    vertex: &str,
    fragment: &str,
    premultiplied_source: bool,
) -> metal::RenderPipelineState {
    let state = |descriptor: &metal::RenderPipelineDescriptorRef| {
        let attachment = descriptor.color_attachments().object_at(0).unwrap();
        attachment.set_destination_alpha_blend_factor(metal::MTLBlendFactor::OneMinusSourceAlpha);
    };
    pipeline(device, library, label, vertex, fragment, premultiplied_source, state)
}

fn pipeline(
    device: &metal::DeviceRef,
    library: &metal::LibraryRef,
    label: &str,
    vertex: &str,
    fragment: &str,
    premultiplied_source: bool,
    adjust: impl Fn(&metal::RenderPipelineDescriptorRef),
) -> metal::RenderPipelineState {
    let descriptor = metal::RenderPipelineDescriptor::new();
    descriptor.set_label(label);
    let vertex_fn = library.get_function(vertex, None).expect("a chrome vertex function");
    let fragment_fn = library.get_function(fragment, None).expect("a chrome fragment function");
    descriptor.set_vertex_function(Some(vertex_fn.as_ref()));
    descriptor.set_fragment_function(Some(fragment_fn.as_ref()));
    let attachment = descriptor.color_attachments().object_at(0).unwrap();
    attachment.set_pixel_format(MTLPixelFormat::BGRA8Unorm);
    attachment.set_blending_enabled(true);
    attachment.set_rgb_blend_operation(metal::MTLBlendOperation::Add);
    attachment.set_alpha_blend_operation(metal::MTLBlendOperation::Add);
    attachment.set_source_rgb_blend_factor(if premultiplied_source {
        metal::MTLBlendFactor::One
    } else {
        metal::MTLBlendFactor::SourceAlpha
    });
    attachment.set_source_alpha_blend_factor(metal::MTLBlendFactor::One);
    attachment.set_destination_rgb_blend_factor(metal::MTLBlendFactor::OneMinusSourceAlpha);
    attachment.set_destination_alpha_blend_factor(metal::MTLBlendFactor::OneMinusSourceAlpha);
    adjust(&descriptor);
    device
        .new_render_pipeline_state(&descriptor)
        .expect("a chrome pipeline")
}

impl Chrome {
    pub(super) fn new(device: &metal::DeviceRef, library: &metal::LibraryRef) -> Self {
        let layer = |label, vertex, fragment, premultiplied| {
            layer_pipeline(device, library, label, vertex, fragment, premultiplied)
        };
        let sampler = {
            let descriptor = metal::SamplerDescriptor::new();
            descriptor.set_min_filter(metal::MTLSamplerMinMagFilter::Linear);
            descriptor.set_mag_filter(metal::MTLSamplerMinMagFilter::Linear);
            descriptor.set_address_mode_s(metal::MTLSamplerAddressMode::ClampToEdge);
            descriptor.set_address_mode_t(metal::MTLSamplerAddressMode::ClampToEdge);
            device.new_sampler(&descriptor)
        };
        let downsample = pipeline(
            device,
            library,
            "chrome_downsample",
            "chrome_fullscreen_vertex",
            "chrome_downsample_fragment",
            true,
            |descriptor| {
                let attachment = descriptor.color_attachments().object_at(0).unwrap();
                attachment.set_blending_enabled(false);
            },
        );
        Self {
            library_device: device.to_owned(),
            layer: LayerPipelines {
                shadows: layer("chrome_shadows", "shadow_vertex", "shadow_fragment", false),
                quads: layer("chrome_quads", "quad_vertex", "quad_fragment", false),
                underlines: layer("chrome_underlines", "underline_vertex", "underline_fragment", false),
                monochrome_sprites: layer(
                    "chrome_monochrome_sprites",
                    "monochrome_sprite_vertex",
                    "monochrome_sprite_fragment",
                    false,
                ),
                polychrome_sprites: layer(
                    "chrome_polychrome_sprites",
                    "polychrome_sprite_vertex",
                    "polychrome_sprite_fragment",
                    false,
                ),
                path_sprites: layer("chrome_path_sprites", "path_sprite_vertex", "path_sprite_fragment", true),
                surfaces: layer("chrome_surfaces", "surface_vertex", "surface_fragment", false),
            },
            composite: pipeline(device, library, "chrome", "chrome_vertex", "chrome_fragment", true, |_| {}),
            composite_straight: pipeline(
                device,
                library,
                "chrome_straight",
                "chrome_vertex",
                "chrome_fragment",
                false,
                |_| {},
            ),
            downsample,
            sampler,
            targets: HashMap::new(),
            captures: HashMap::new(),
            compiled: HashMap::new(),
            depth: 0,
        }
    }

    fn target(&mut self, kind: u32, size: Size<DevicePixels>, format: MTLPixelFormat) -> metal::Texture {
        let key = (kind, self.depth);
        let fits = self.targets.get(&key).is_some_and(|t| {
            t.width() == size.width.0 as u64
                && t.height() == size.height.0 as u64
                && t.pixel_format() == format
        });
        if !fits {
            let descriptor = metal::TextureDescriptor::new();
            descriptor.set_width(size.width.0.max(1) as u64);
            descriptor.set_height(size.height.0.max(1) as u64);
            descriptor.set_pixel_format(format);
            descriptor.set_storage_mode(metal::MTLStorageMode::Private);
            descriptor.set_usage(metal::MTLTextureUsage::RenderTarget | metal::MTLTextureUsage::ShaderRead);
            self.targets.insert(key, self.library_device.new_texture(&descriptor));
        }
        self.targets[&key].clone()
    }

    fn compiled(&mut self, name: &str) -> Option<(Arc<ChromeOperator>, Vec<metal::RenderPipelineState>)> {
        let operator = operator(name)?;
        if !self.compiled.contains_key(name) {
            let mut compiled = Vec::new();
            for graph in &operator.graphs {
                let library = match self
                    .library_device
                    .new_library_with_source(&graph.msl, &metal::CompileOptions::new())
                {
                    Ok(library) => library,
                    Err(error) => {
                        log::error!("chrome operator {name}'s graph {} didn't compile: {error}", graph.label);
                        return None;
                    }
                };
                let descriptor = metal::RenderPipelineDescriptor::new();
                descriptor.set_label(&graph.label);
                let vertex = library.get_function(&graph.vertex, None).ok()?;
                let fragment = library.get_function(&graph.fragment, None).ok()?;
                descriptor.set_vertex_function(Some(vertex.as_ref()));
                descriptor.set_fragment_function(Some(fragment.as_ref()));
                let attachment = descriptor.color_attachments().object_at(0).unwrap();
                attachment.set_pixel_format(RUN_FORMAT);
                attachment.set_blending_enabled(false);
                compiled.push(self.library_device.new_render_pipeline_state(&descriptor).ok()?);
            }
            self.compiled.insert(name.to_string(), compiled);
        }
        Some((operator, self.compiled[name].clone()))
    }
}

/// A run's output: f32, so a kernel's parts add without rounding between them.
const RUN_FORMAT: MTLPixelFormat = MTLPixelFormat::RGBA32Float;

/// The rect a chrome primitive draws in: its bounds, inside its mask and the target, in whole
/// device pixels; `None` if that's empty.
fn drawn(primitive: &ChromePrimitive, viewport: Size<DevicePixels>) -> Option<Bounds<ScaledPixels>> {
    let target = Bounds {
        origin: point(ScaledPixels(0.), ScaledPixels(0.)),
        size: size(ScaledPixels(viewport.width.0 as f32), ScaledPixels(viewport.height.0 as f32)),
    };
    let clipped = primitive
        .bounds
        .intersect(&primitive.content_mask.bounds)
        .intersect(&target);
    let left = clipped.origin.x.0.floor();
    let top = clipped.origin.y.0.floor();
    let right = (clipped.origin.x.0 + clipped.size.width.0).ceil();
    let bottom = (clipped.origin.y.0 + clipped.size.height.0).ceil();
    (right > left && bottom > top).then(|| Bounds {
        origin: point(ScaledPixels(left), ScaledPixels(top)),
        size: size(ScaledPixels(right - left), ScaledPixels(bottom - top)),
    })
}

impl MetalRenderer {
    /// Draws one chrome primitive at its order into `target`, ending `encoder` and returning the
    /// encoder the frame goes on with.
    pub(super) fn draw_chrome<'a>(
        &mut self,
        primitive: &ChromePrimitive,
        writer: &mut InstanceBufferWriter,
        target: &'a metal::TextureRef,
        viewport: Size<DevicePixels>,
        command_buffer: &'a metal::CommandBufferRef,
        encoder: &'a metal::RenderCommandEncoderRef,
    ) -> Result<&'a metal::RenderCommandEncoderRef> {
        let Some(drawn) = drawn(primitive, viewport) else {
            return Ok(encoder);
        };
        // A drawable vended before the window first read a backdrop can't be copied from; the
        // next one can.
        let reads = matches!(&primitive.kind, ChromeKind::Backdrop(..))
            || matches!(&primitive.kind, ChromeKind::Effect(e) if e.backdrop.is_some());
        if reads && target.framebuffer_only() {
            log::warn!("a chrome backdrop skipped: this frame's drawable isn't readable");
            return Ok(encoder);
        }
        let source = match &primitive.kind {
            ChromeKind::Layer(layer, scene) => {
                encoder.end_encoding();
                let offscreen = self.render_layer(scene, writer, viewport, command_buffer)?;
                Some((offscreen, *layer, true))
            }
            ChromeKind::Backdrop(scale, key) => {
                encoder.end_encoding();
                let copy = self.copy_backdrop(*scale, drawn, target, command_buffer, Some(*key), None);
                if self.bgra_surfaces.chrome.captures.len() > 64 {
                    self.bgra_surfaces.chrome.captures.clear();
                }
                self.bgra_surfaces.chrome.captures.insert(*key, copy);
                None
            }
            ChromeKind::Effect(effect) => {
                if self.bgra_surfaces.chrome.compiled(&effect.operator).is_none() {
                    log::warn!("chrome effect {}: no operator {} is registered", effect.name, effect.operator);
                    return Ok(encoder);
                }
                encoder.end_encoding();
                self.run_effect(effect, drawn, target, command_buffer)?
                    .map(|output| {
                        let layer = ChromeLayer { opacity: 1., radii: effect.radii, edge: effect.edge };
                        (output, layer, false)
                    })
            }
        };
        let encoder = new_command_encoder_for_texture(command_buffer, target, viewport, None);
        if let Some((texture, layer, texel_for_texel)) = source {
            let origin = if texel_for_texel { [0., 0.] } else { [drawn.origin.x.0, drawn.origin.y.0] };
            let texel_for_texel = texel_for_texel || effect_at_full_scale(primitive);
            self.composite(encoder, &texture, primitive.bounds, drawn, layer, texel_for_texel, origin, viewport);
        }
        Ok(encoder)
    }

    #[allow(clippy::too_many_arguments)]
    fn composite(
        &self,
        encoder: &metal::RenderCommandEncoderRef,
        texture: &metal::TextureRef,
        bounds: Bounds<ScaledPixels>,
        drawn: Bounds<ScaledPixels>,
        layer: ChromeLayer,
        texel_for_texel: bool,
        source_origin: [f32; 2],
        viewport: Size<DevicePixels>,
    ) {
        let uniform = Composite {
            bounds,
            drawn,
            radii: layer.radii,
            opacity: layer.opacity,
            edge: layer.edge.0,
            texel_for_texel: texel_for_texel as u32,
            pad: 0,
            source_origin,
            pad2: [0.; 2],
        };
        let pipeline = match planted() {
            Planted::StraightAlpha => &self.bgra_surfaces.chrome.composite_straight,
            Planted::None => &self.bgra_surfaces.chrome.composite,
        };
        encoder.set_render_pipeline_state(pipeline);
        encoder.set_vertex_buffer(0, Some(&self.unit_vertices), 0);
        let bytes = |value: &Composite| (mem::size_of::<Composite>() as u64, value as *const Composite as *const _);
        let (length, data) = bytes(&uniform);
        encoder.set_vertex_bytes(1, length, data);
        encoder.set_fragment_bytes(1, length, data);
        encoder.set_vertex_bytes(
            2,
            mem::size_of_val(&viewport) as u64,
            &viewport as *const Size<DevicePixels> as *const _,
        );
        encoder.set_fragment_texture(0, Some(texture));
        encoder.draw_primitives(metal::MTLPrimitiveType::Triangle, 0, 6);
    }

    /// Renders a layer's scene into an offscreen target the size of the frame.
    fn render_layer(
        &mut self,
        scene: &Scene,
        writer: &mut InstanceBufferWriter,
        viewport: Size<DevicePixels>,
        command_buffer: &metal::CommandBufferRef,
    ) -> Result<metal::Texture> {
        let offscreen = self.bgra_surfaces.chrome.target(0, viewport, MTLPixelFormat::BGRA8Unorm);
        let bindings = write_instances(scene, writer)?;
        self.swap_layer_pipelines();
        self.bgra_surfaces.chrome.depth += 1;
        let result = (|| -> Result<()> {
            let clear = Some(metal::MTLClearColor::new(0., 0., 0., 0.));
            let mut encoder = new_command_encoder_for_texture(command_buffer, &offscreen, viewport, clear);
            for batch in scene.batches() {
                match batch {
                    PrimitiveBatch::Shadows(range) => self.draw_shadows(range, &bindings, viewport, encoder),
                    PrimitiveBatch::Quads(range) => self.draw_quads(range, &bindings, viewport, encoder),
                    PrimitiveBatch::Paths(range) => {
                        let paths = &scene.paths[range];
                        encoder.end_encoding();
                        let did_draw = self.draw_paths_to_intermediate(paths, writer, viewport, command_buffer)?;
                        encoder = new_command_encoder_for_texture(command_buffer, &offscreen, viewport, None);
                        if did_draw {
                            self.draw_paths_from_intermediate(paths, writer, viewport, encoder)?;
                        }
                    }
                    PrimitiveBatch::Underlines(range) => {
                        self.draw_underlines(range, &bindings, viewport, encoder)
                    }
                    PrimitiveBatch::MonochromeSprites { texture_id, range } => {
                        self.draw_monochrome_sprites(texture_id, range, &bindings, viewport, encoder)
                    }
                    PrimitiveBatch::PolychromeSprites { texture_id, range } => {
                        self.draw_polychrome_sprites(texture_id, range, &bindings, viewport, encoder)
                    }
                    PrimitiveBatch::Surfaces(range) => self.draw_surfaces(
                        &scene.surfaces[range.clone()],
                        range.start,
                        &bindings,
                        viewport,
                        encoder,
                    ),
                    PrimitiveBatch::Chrome(index) => {
                        encoder = self.draw_chrome(&scene.chrome[index], writer, &offscreen, viewport, command_buffer, encoder)?;
                    }
                    PrimitiveBatch::SubpixelSprites { .. } => unreachable!(),
                }
            }
            encoder.end_encoding();
            Ok(())
        })();
        self.bgra_surfaces.chrome.depth -= 1;
        self.swap_layer_pipelines();
        result.map(|()| offscreen)
    }

    fn swap_layer_pipelines(&mut self) {
        let layer = &mut self.bgra_surfaces.chrome.layer;
        mem::swap(&mut self.shadows_pipeline_state, &mut layer.shadows);
        mem::swap(&mut self.quads_pipeline_state, &mut layer.quads);
        mem::swap(&mut self.underlines_pipeline_state, &mut layer.underlines);
        mem::swap(&mut self.monochrome_sprites_pipeline_state, &mut layer.monochrome_sprites);
        mem::swap(&mut self.polychrome_sprites_pipeline_state, &mut layer.polychrome_sprites);
        mem::swap(&mut self.path_sprites_pipeline_state, &mut layer.path_sprites);
        mem::swap(&mut self.surfaces_pipeline_state, &mut layer.surfaces);
    }

    /// Copies the backdrop under `drawn` and runs the effect's operator on it; the last run's
    /// output covers `drawn`.
    fn run_effect(
        &mut self,
        effect: &ChromeEffect,
        drawn: Bounds<ScaledPixels>,
        target: &metal::TextureRef,
        command_buffer: &metal::CommandBufferRef,
    ) -> Result<Option<metal::Texture>> {
        let Some((operator, pipelines)) = self.bgra_surfaces.chrome.compiled(&effect.operator) else {
            return Ok(None);
        };
        let scale = effect.backdrop.map_or(1.0, BackdropScale::factor);
        let width = (drawn.size.width.0 * scale).ceil().max(1.0) as i32;
        let height = (drawn.size.height.0 * scale).ceil().max(1.0) as i32;
        let out_size = size(DevicePixels(width), DevicePixels(height));
        let captured = effect.captured.and_then(|key| self.bgra_surfaces.chrome.captures.remove(&key));
        let backdrop = effect
            .backdrop
            .map(|scale| self.copy_backdrop(scale, drawn, target, command_buffer, None, captured));
        let frame = Frame {
            clip: IDENTITY,
            inverse_clip: IDENTITY,
            eye: [0.; 4],
            size: [width as f32, height as f32, 1. / width as f32, 1. / height as f32],
            time: [0.; 4],
            seed: [0; 4],
        };
        let mut outputs: Vec<metal::Texture> = Vec::new();
        for (index, run) in (operator.plan)(&effect.params).into_iter().enumerate() {
            let pipeline = pipelines
                .get(run.graph)
                .with_context(|| format!("chrome operator {} has no graph {}", effect.operator, run.graph))?;
            let output = self.bgra_surfaces.chrome.target(2 + index as u32, out_size, RUN_FORMAT);
            let encoder = new_command_encoder_for_texture(command_buffer, &output, out_size, None);
            encoder.set_render_pipeline_state(pipeline);
            encoder.set_fragment_bytes(0, mem::size_of::<Frame>() as u64, &frame as *const Frame as *const _);
            let mut inputs = run.inputs;
            inputs.resize(inputs.len().max(16), 0);
            encoder.set_fragment_bytes(1, inputs.len() as u64, inputs.as_ptr() as *const _);
            encoder.set_fragment_sampler_state(0, Some(&self.bgra_surfaces.chrome.sampler));
            for (slot, input) in run.textures.iter().enumerate() {
                let texture = match input {
                    ChromeInput::Backdrop => backdrop.as_ref(),
                    ChromeInput::Run(run) => outputs.get(*run),
                }
                .with_context(|| format!("chrome operator {}: run {index} reads no texture", effect.operator))?;
                encoder.set_fragment_texture(slot as u64, Some(texture));
            }
            encoder.draw_primitives(metal::MTLPrimitiveType::Triangle, 0, 3);
            encoder.end_encoding();
            outputs.push(output);
        }
        Ok(outputs.pop().or(backdrop))
    }
}

impl MetalRenderer {
    /// The backdrop under `drawn` at `scale`: `captured` if it was taken earlier at that size,
    /// else a copy of `target` now.
    fn copy_backdrop(
        &mut self,
        scale: BackdropScale,
        drawn: Bounds<ScaledPixels>,
        target: &metal::TextureRef,
        command_buffer: &metal::CommandBufferRef,
        key: Option<u64>,
        captured: Option<metal::Texture>,
    ) -> metal::Texture {
        let width = (drawn.size.width.0 * scale.factor()).ceil().max(1.0) as i32;
        let height = (drawn.size.height.0 * scale.factor()).ceil().max(1.0) as i32;
        if let Some(captured) = captured.filter(|c| c.width() == width as u64 && c.height() == height as u64) {
            return captured;
        }
        let origin = [drawn.origin.x.0 as u32, drawn.origin.y.0 as u32];
        // A capture keeps its copy until its effect reads it; a copy taken at the effect is its own.
        let kind = key.map_or(1, |key| 1000 + key.min(1 << 20) as u32);
        let copy = self.bgra_surfaces.chrome.target(kind, size(DevicePixels(width), DevicePixels(height)), MTLPixelFormat::BGRA8Unorm);
        if scale == BackdropScale::Full {
            let blit = command_buffer.new_blit_command_encoder();
            blit.copy_from_texture(
                target,
                0,
                0,
                metal::MTLOrigin { x: origin[0] as u64, y: origin[1] as u64, z: 0 },
                metal::MTLSize { width: width as u64, height: height as u64, depth: 1 },
                &copy,
                0,
                0,
                metal::MTLOrigin { x: 0, y: 0, z: 0 },
            );
            blit.end_encoding();
        } else {
            let out_size = size(DevicePixels(width), DevicePixels(height));
            let encoder = new_command_encoder_for_texture(command_buffer, &copy, out_size, None);
            encoder.set_render_pipeline_state(&self.bgra_surfaces.chrome.downsample);
            let uniform = Downsample { origin, step: (1.0 / scale.factor()) as u32, pad: 0 };
            encoder.set_fragment_bytes(
                0,
                mem::size_of::<Downsample>() as u64,
                &uniform as *const Downsample as *const _,
            );
            encoder.set_fragment_texture(0, Some(target));
            encoder.draw_primitives(metal::MTLPrimitiveType::Triangle, 0, 3);
            encoder.end_encoding();
        }
        copy
    }
}

/// Whether an effect's output is the size of what it draws, so the composite reads it texel for
/// texel.
fn effect_at_full_scale(primitive: &ChromePrimitive) -> bool {
    matches!(&primitive.kind, ChromeKind::Effect(effect) if effect.backdrop.is_none_or(|b| b == BackdropScale::Full))
}
