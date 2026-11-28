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
//!
//! A frame that holds a chrome primitive is drawn here, in paint order, instead of by gpui-fast's
//! frame: each chrome primitive ends the frame's render pass, and the depth target gpui-fast's
//! opaque quads are drawn into first doesn't outlive a pass, so this frame draws every quad in
//! order with no depth test. GPUI's pipelines already scale the destination's alpha by one minus
//! the source's, so a layer's scene renders through them as they are and its target holds the
//! group's true coverage.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::{mem, ptr};

use anyhow::{Context as _, Result};
use gpui::{
    BackdropScale, Bounds, ChromeEffect, ChromeKind, ChromeLayer, ChromePrimitive, Corners,
    DevicePixels, PaintedPath, PrimitiveBatch, ScaledPixels, Scene, Size, point, size,
};
use objc2_core_foundation::CFRetained;
use objc2_core_video::CVMetalTexture;
use objc2_foundation::NSString;
use objc2_metal::{
    MTLBlendFactor, MTLBlitCommandEncoder, MTLClearColor, MTLCommandBuffer, MTLCommandEncoder,
    MTLCompileOptions, MTLDevice, MTLLibrary, MTLLoadAction, MTLOrigin, MTLPixelFormat,
    MTLPrimitiveType, MTLRenderCommandEncoder, MTLRenderPassDescriptor, MTLRenderPipelineDescriptor,
    MTLSamplerAddressMode, MTLSamplerDescriptor, MTLSamplerMinMagFilter, MTLSamplerState, MTLSize,
    MTLStorageMode, MTLStoreAction, MTLTexture, MTLTextureDescriptor, MTLTextureUsage, MTLViewport,
};

use super::bgra_surface::{Pipeline, carried_pipeline};
use super::{
    GlobalInputIndex, InstanceBindings, InstanceBufferWriter, MetalRenderer, ProtocolObject, Retained,
    gpu_surfaces, write_instances,
};

type Texture = Retained<ProtocolObject<dyn MTLTexture>>;
type Encoder = Retained<ProtocolObject<dyn objc2_metal::MTLRenderCommandEncoder>>;

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

/// The composite's buffer index, past GPUI's own, for its vertex and fragment functions.
const COMPOSITE_INDEX: usize = 20;

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

/// A run's output: f32, so a kernel's parts add without rounding between them.
const RUN_FORMAT: MTLPixelFormat = MTLPixelFormat::RGBA32Float;

pub(super) struct Chrome {
    device: Retained<ProtocolObject<dyn MTLDevice>>,
    composite: Pipeline,
    composite_straight: Pipeline,
    downsample: Pipeline,
    sampler: Retained<ProtocolObject<dyn MTLSamplerState>>,
    /// Offscreen targets by (use, depth), reused frame to frame; Metal orders their reuse.
    targets: HashMap<(u32, usize), Texture>,
    /// Backdrop copies taken earlier in paint order, by key, until an effect reads them.
    captures: HashMap<u64, Texture>,
    /// Each registered operator's compiled graphs.
    compiled: HashMap<String, Vec<Pipeline>>,
    depth: usize,
}

/// A pipeline of an operator's graph, which writes its run's output with blending off and no depth.
fn run_pipeline(
    device: &ProtocolObject<dyn MTLDevice>,
    library: &ProtocolObject<dyn MTLLibrary>,
    graph: &ChromeGraph,
    format: MTLPixelFormat,
) -> Result<Pipeline> {
    let function = |name: &str| {
        library
            .newFunctionWithName(&NSString::from_str(name))
            .with_context(|| format!("locating {name} in {}", graph.label))
    };
    let descriptor = MTLRenderPipelineDescriptor::new();
    descriptor.setLabel(Some(&NSString::from_str(&graph.label)));
    descriptor.setVertexFunction(Some(&*function(&graph.vertex)?));
    descriptor.setFragmentFunction(Some(&*function(&graph.fragment)?));
    // SAFETY: Index zero is within the pipeline's color attachment array.
    let attachment = unsafe { descriptor.colorAttachments().objectAtIndexedSubscript(0) };
    attachment.setPixelFormat(format);
    attachment.setBlendingEnabled(false);
    device
        .newRenderPipelineStateWithDescriptor_error(&descriptor)
        .with_context(|| format!("creating the {} pipeline", graph.label))
}

impl Chrome {
    pub(super) fn new(device: &ProtocolObject<dyn MTLDevice>, library: &ProtocolObject<dyn MTLLibrary>) -> Result<Self> {
        let descriptor = MTLSamplerDescriptor::new();
        descriptor.setMinFilter(MTLSamplerMinMagFilter::Linear);
        descriptor.setMagFilter(MTLSamplerMinMagFilter::Linear);
        descriptor.setSAddressMode(MTLSamplerAddressMode::ClampToEdge);
        descriptor.setTAddressMode(MTLSamplerAddressMode::ClampToEdge);
        let sampler = device.newSamplerStateWithDescriptor(&descriptor).context("creating the chrome sampler")?;
        let downsample = ChromeGraph {
            label: "chrome_downsample".into(),
            msl: String::new(),
            vertex: "chrome_fullscreen_vertex".into(),
            fragment: "chrome_downsample_fragment".into(),
        };
        let composite = |label, source| carried_pipeline(device, library, label, "chrome_vertex", "chrome_fragment", Some(source), true);
        Ok(Self {
            device: device.retain(),
            composite: composite("chrome", MTLBlendFactor::One)?,
            composite_straight: composite("chrome_straight", MTLBlendFactor::SourceAlpha)?,
            downsample: run_pipeline(device, library, &downsample, MTLPixelFormat::BGRA8Unorm)?,
            sampler,
            targets: HashMap::new(),
            captures: HashMap::new(),
            compiled: HashMap::new(),
            depth: 0,
        })
    }

    fn target(&mut self, kind: u32, size: Size<DevicePixels>, format: MTLPixelFormat) -> Result<Texture> {
        let key = (kind, self.depth);
        let (width, height) = (size.width.0.max(1) as usize, size.height.0.max(1) as usize);
        let fits = self
            .targets
            .get(&key)
            .is_some_and(|t| t.width() == width && t.height() == height && t.pixelFormat() == format);
        if !fits {
            let descriptor = MTLTextureDescriptor::new();
            // SAFETY: the size is at least 1 by 1, and no larger than the frame's own target or a copy of part of it.
            unsafe {
                descriptor.setWidth(width);
                descriptor.setHeight(height);
            }
            descriptor.setPixelFormat(format);
            descriptor.setStorageMode(MTLStorageMode::Private);
            descriptor.setUsage(MTLTextureUsage::RenderTarget | MTLTextureUsage::ShaderRead);
            let texture = self.device.newTextureWithDescriptor(&descriptor).context("allocating a chrome target")?;
            self.targets.insert(key, texture);
        }
        Ok(self.targets[&key].clone())
    }

    fn compiled(&mut self, name: &str) -> Option<(Arc<ChromeOperator>, Vec<Pipeline>)> {
        let operator = operator(name)?;
        if !self.compiled.contains_key(name) {
            let mut compiled = Vec::new();
            for graph in &operator.graphs {
                let library = self
                    .device
                    .newLibraryWithSource_options_error(&NSString::from_str(&graph.msl), Some(&MTLCompileOptions::new()));
                let pipeline = library
                    .map_err(|error| anyhow::anyhow!("{}", error.localizedDescription()))
                    .and_then(|library| run_pipeline(&self.device, &library, graph, RUN_FORMAT));
                match pipeline {
                    Ok(pipeline) => compiled.push(pipeline),
                    Err(error) => {
                        log::error!("chrome operator {name}'s graph {} didn't compile: {error:#}", graph.label);
                        return None;
                    }
                }
            }
            self.compiled.insert(name.to_string(), compiled);
        }
        Some((operator, self.compiled[name].clone()))
    }
}

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

/// A render pass on `target` that clears it to `clear` or, with none, keeps what it holds; with `depth`, the frame's
/// depth attachment, which every GPUI pipeline is built for.
fn pass(
    command_buffer: &ProtocolObject<dyn MTLCommandBuffer>,
    target: &ProtocolObject<dyn MTLTexture>,
    depth: Option<&ProtocolObject<dyn MTLTexture>>,
    clear: Option<MTLClearColor>,
) -> Result<Encoder> {
    let descriptor = MTLRenderPassDescriptor::new();
    // SAFETY: Index zero is within the render pass's color attachment array.
    let color = unsafe { descriptor.colorAttachments().objectAtIndexedSubscript(0) };
    color.setTexture(Some(target));
    color.setStoreAction(MTLStoreAction::Store);
    color.setLoadAction(if clear.is_some() { MTLLoadAction::Clear } else { MTLLoadAction::Load });
    if let Some(clear) = clear {
        color.setClearColor(clear);
    }
    if let Some(depth) = depth {
        let attachment = descriptor.depthAttachment();
        attachment.setTexture(Some(depth));
        attachment.setLoadAction(MTLLoadAction::Clear);
        attachment.setClearDepth(0.0);
        attachment.setStoreAction(MTLStoreAction::DontCare);
    }
    command_buffer
        .renderCommandEncoderWithDescriptor(&descriptor)
        .context("creating a chrome render command encoder")
}

/// The viewport over `size`, at the one depth every primitive of a chrome frame draws at.
fn viewport(encoder: &ProtocolObject<dyn MTLRenderCommandEncoder>, size: Size<DevicePixels>) {
    encoder.setViewport(MTLViewport {
        originX: 0.0,
        originY: 0.0,
        width: size.width.0 as f64,
        height: size.height.0 as f64,
        znear: 0.0,
        zfar: 0.0,
    });
}

/// GPUI's shared vertex inputs: the viewport, and a depth scale of 0, so no quad is left to an opaque pass.
fn globals(encoder: &ProtocolObject<dyn MTLRenderCommandEncoder>, size: Size<DevicePixels>) {
    let depth_scale = 0f32;
    // SAFETY: Metal copies both values, which match every vertex shader's
    // `GlobalInputIndex_ViewportSize` and `GlobalInputIndex_DepthScale` arguments.
    unsafe {
        encoder.setVertexBytes_length_atIndex(
            ptr::NonNull::from(&size).cast(),
            mem::size_of_val(&size),
            GlobalInputIndex::ViewportSize as usize,
        );
        encoder.setVertexBytes_length_atIndex(
            ptr::NonNull::from(&depth_scale).cast(),
            mem::size_of_val(&depth_scale),
            GlobalInputIndex::DepthScale as usize,
        );
    }
    viewport(encoder, size);
    crate::fast::rounded_clip::default_mask(encoder);
}

impl MetalRenderer {
    /// Draws a frame that holds a chrome primitive, in place of gpui-fast's frame.
    pub(crate) fn draw_chrome_frame(
        &mut self,
        scene: &Scene,
        bindings: &InstanceBindings,
        writer: &mut InstanceBufferWriter,
        target: &ProtocolObject<dyn MTLTexture>,
        viewport_size: Size<DevicePixels>,
        surface_textures: &mut Vec<CFRetained<CVMetalTexture>>,
    ) -> Result<Retained<ProtocolObject<dyn MTLCommandBuffer>>> {
        let command_buffer = self.command_queue.commandBuffer().context("creating command buffer")?;
        crate::fast::dynamic_textures::encode_uploads(&command_buffer);
        let alpha = if self.opaque { 1. } else { 0. };
        let clear = MTLClearColor { red: 0., green: 0., blue: 0., alpha };
        let scene = ChromeScene { scene, bindings };
        self.encode_chrome_scene(scene, writer, target, viewport_size, &command_buffer, clear, surface_textures)?;
        Ok(command_buffer)
    }

    /// Encodes `scene` into `target` in paint order, each chrome primitive at its place.
    #[allow(clippy::too_many_arguments)]
    fn encode_chrome_scene(
        &mut self,
        scene: ChromeScene,
        writer: &mut InstanceBufferWriter,
        target: &ProtocolObject<dyn MTLTexture>,
        viewport_size: Size<DevicePixels>,
        command_buffer: &ProtocolObject<dyn MTLCommandBuffer>,
        clear: MTLClearColor,
        surface_textures: &mut Vec<CFRetained<CVMetalTexture>>,
    ) -> Result<()> {
        let ChromeScene { scene, bindings } = scene;
        let depth = self.depth_texture_matching(target)?;
        let mut encoder = pass(command_buffer, target, Some(&depth), Some(clear))?;
        globals(&encoder, viewport_size);
        let surfaces_last = gpu_surfaces::planted() == gpu_surfaces::Planted::AfterScene; // DeepBuild patch (windoliver/deepbuild#377)
        let mut path_tile_cursor = 0;
        let result = (|| -> Result<()> {
            for batch in scene.batches() {
                match batch {
                    PrimitiveBatch::Shadows(range) => self.draw_shadows(range, bindings, &encoder),
                    PrimitiveBatch::Quads(range) => self.draw_quads(range, bindings, &encoder),
                    PrimitiveBatch::Paths(range) => {
                        let start = path_tile_cursor;
                        path_tile_cursor += scene.paths[range].iter().map(PaintedPath::tile_count).sum::<usize>();
                        self.draw_path_tiles(start..path_tile_cursor, bindings, &encoder)
                    }
                    PrimitiveBatch::Underlines(range) => self.draw_underlines(range, bindings, &encoder),
                    PrimitiveBatch::MonochromeSprites { texture_id, range } => {
                        self.draw_monochrome_sprites(texture_id, range, bindings, &encoder)
                    }
                    PrimitiveBatch::PolychromeSprites { texture_id, range } => {
                        self.draw_polychrome_sprites(texture_id, range, bindings, &encoder)
                    }
                    PrimitiveBatch::Surfaces(_) if surfaces_last => {}
                    PrimitiveBatch::Surfaces(range) => {
                        self.draw_surfaces(&scene.surfaces[range.clone()], range.start, bindings, &encoder, surface_textures)?
                    }
                    PrimitiveBatch::NativeViews(range) => self.draw_native_views(range, bindings, &encoder),
                    PrimitiveBatch::Chrome(index) => {
                        encoder.endEncoding();
                        let source = self.draw_chrome(&scene.chrome[index], writer, target, viewport_size, command_buffer, surface_textures)?;
                        encoder = pass(command_buffer, target, Some(&depth), None)?;
                        globals(&encoder, viewport_size);
                        if let Some(source) = source {
                            self.composite(&encoder, &scene.chrome[index], source);
                        }
                    }
                    PrimitiveBatch::SubpixelSprites { .. } => unreachable!(),
                }
            }
            if surfaces_last {
                self.draw_surfaces(&scene.surfaces, 0, bindings, &encoder, surface_textures)?;
            }
            Ok(())
        })();
        encoder.endEncoding();
        result
    }

    /// Draws one chrome primitive's work at its order into `target`, with the frame's pass ended: what it composites
    /// once the pass resumes, if anything.
    fn draw_chrome(
        &mut self,
        primitive: &ChromePrimitive,
        writer: &mut InstanceBufferWriter,
        target: &ProtocolObject<dyn MTLTexture>,
        viewport: Size<DevicePixels>,
        command_buffer: &ProtocolObject<dyn MTLCommandBuffer>,
        surface_textures: &mut Vec<CFRetained<CVMetalTexture>>,
    ) -> Result<Option<Source>> {
        let Some(drawn) = drawn(primitive, viewport) else {
            return Ok(None);
        };
        // A drawable vended before the window first read a backdrop can't be copied from; the
        // next one can.
        let reads = matches!(&primitive.kind, ChromeKind::Backdrop(..))
            || matches!(&primitive.kind, ChromeKind::Effect(e) if e.backdrop.is_some());
        if reads && target.isFramebufferOnly() {
            log::warn!("a chrome backdrop skipped: this frame's drawable isn't readable");
            return Ok(None);
        }
        Ok(match &primitive.kind {
            ChromeKind::Layer(layer, scene) => {
                let texture = self.render_layer(scene, writer, viewport, command_buffer, surface_textures)?;
                Some(Source { texture, drawn, layer: *layer, texel_for_texel: true, origin: [0., 0.] })
            }
            ChromeKind::Backdrop(scale, key) => {
                let copy = self.copy_backdrop(*scale, drawn, target, command_buffer, Some(*key), None)?;
                if self.bgra_surfaces.chrome.captures.len() > 64 {
                    self.bgra_surfaces.chrome.captures.clear();
                }
                self.bgra_surfaces.chrome.captures.insert(*key, copy);
                None
            }
            ChromeKind::Effect(effect) => {
                if self.bgra_surfaces.chrome.compiled(&effect.operator).is_none() {
                    log::warn!("chrome effect {}: no operator {} is registered", effect.name, effect.operator);
                    return Ok(None);
                }
                self.run_effect(effect, drawn, target, command_buffer)?.map(|texture| Source {
                    texture,
                    drawn,
                    layer: ChromeLayer { opacity: 1., radii: effect.radii, edge: effect.edge },
                    texel_for_texel: effect_at_full_scale(primitive),
                    origin: [drawn.origin.x.0, drawn.origin.y.0],
                })
            }
        })
    }

    fn composite(&self, encoder: &ProtocolObject<dyn MTLRenderCommandEncoder>, primitive: &ChromePrimitive, source: Source) {
        let uniform = Composite {
            bounds: primitive.bounds,
            drawn: source.drawn,
            radii: source.layer.radii,
            opacity: source.layer.opacity,
            edge: source.layer.edge.0,
            texel_for_texel: source.texel_for_texel as u32,
            pad: 0,
            source_origin: source.origin,
            pad2: [0.; 2],
        };
        let pipeline = match planted() {
            Planted::StraightAlpha => &self.bgra_surfaces.chrome.composite_straight,
            Planted::None => &self.bgra_surfaces.chrome.composite,
        };
        encoder.setRenderPipelineState(pipeline);
        let (data, length) = (ptr::NonNull::from(&uniform).cast(), mem::size_of::<Composite>());
        // SAFETY: Metal copies the uniform, which matches `ChromeComposite`, and the source texture is the shader's.
        unsafe {
            encoder.setVertexBytes_length_atIndex(data, length, COMPOSITE_INDEX);
            encoder.setFragmentBytes_length_atIndex(data, length, COMPOSITE_INDEX);
            encoder.setFragmentTexture_atIndex(Some(&source.texture), 0);
            encoder.drawPrimitives_vertexStart_vertexCount(MTLPrimitiveType::TriangleStrip, 0, 4);
        }
    }

    /// Renders a layer's scene into an offscreen target the size of the frame.
    fn render_layer(
        &mut self,
        scene: &Scene,
        writer: &mut InstanceBufferWriter,
        viewport: Size<DevicePixels>,
        command_buffer: &ProtocolObject<dyn MTLCommandBuffer>,
        surface_textures: &mut Vec<CFRetained<CVMetalTexture>>,
    ) -> Result<Texture> {
        let offscreen = self.bgra_surfaces.chrome.target(0, viewport, MTLPixelFormat::BGRA8Unorm)?;
        let bindings = write_instances(scene, writer)?;
        self.bgra_surfaces.chrome.depth += 1;
        let clear = MTLClearColor { red: 0., green: 0., blue: 0., alpha: 0. };
        let scene = ChromeScene { scene, bindings: &bindings };
        let result = self.encode_chrome_scene(scene, writer, &offscreen, viewport, command_buffer, clear, surface_textures);
        self.bgra_surfaces.chrome.depth -= 1;
        result.map(|()| offscreen)
    }

    /// Copies the backdrop under `drawn` and runs the effect's operator on it; the last run's
    /// output covers `drawn`.
    fn run_effect(
        &mut self,
        effect: &ChromeEffect,
        drawn: Bounds<ScaledPixels>,
        target: &ProtocolObject<dyn MTLTexture>,
        command_buffer: &ProtocolObject<dyn MTLCommandBuffer>,
    ) -> Result<Option<Texture>> {
        let Some((operator, pipelines)) = self.bgra_surfaces.chrome.compiled(&effect.operator) else {
            return Ok(None);
        };
        let scale = effect.backdrop.map_or(1.0, BackdropScale::factor);
        let width = (drawn.size.width.0 * scale).ceil().max(1.0) as i32;
        let height = (drawn.size.height.0 * scale).ceil().max(1.0) as i32;
        let out_size = size(DevicePixels(width), DevicePixels(height));
        let captured = effect.captured.and_then(|key| self.bgra_surfaces.chrome.captures.remove(&key));
        let backdrop = match effect.backdrop {
            Some(scale) => Some(self.copy_backdrop(scale, drawn, target, command_buffer, None, captured)?),
            None => None,
        };
        let frame = Frame {
            clip: IDENTITY,
            inverse_clip: IDENTITY,
            eye: [0.; 4],
            size: [width as f32, height as f32, 1. / width as f32, 1. / height as f32],
            time: [0.; 4],
            seed: [0; 4],
        };
        let mut outputs: Vec<Texture> = Vec::new();
        for (index, run) in (operator.plan)(&effect.params).into_iter().enumerate() {
            let pipeline = pipelines
                .get(run.graph)
                .with_context(|| format!("chrome operator {} has no graph {}", effect.operator, run.graph))?;
            let output = self.bgra_surfaces.chrome.target(2 + index as u32, out_size, RUN_FORMAT)?;
            let textures = run
                .textures
                .iter()
                .map(|input| {
                    match input {
                        ChromeInput::Backdrop => backdrop.as_ref(),
                        ChromeInput::Run(run) => outputs.get(*run),
                    }
                    .with_context(|| format!("chrome operator {}: run {index} reads no texture", effect.operator))
                })
                .collect::<Result<Vec<_>>>()?;
            let encoder = pass(command_buffer, &output, None, None)?;
            viewport(&encoder, out_size);
            encoder.setRenderPipelineState(pipeline);
            let mut inputs = run.inputs;
            inputs.resize(inputs.len().max(16), 0);
            // SAFETY: Metal copies the frame and the inputs, which the operator's graphs read under the binding
            // contract above, and every texture and the sampler are live.
            unsafe {
                encoder.setFragmentBytes_length_atIndex(ptr::NonNull::from(&frame).cast(), mem::size_of::<Frame>(), 0);
                encoder.setFragmentBytes_length_atIndex(ptr::NonNull::from(inputs.as_slice()).cast(), inputs.len(), 1);
                encoder.setFragmentSamplerState_atIndex(Some(&self.bgra_surfaces.chrome.sampler), 0);
                for (slot, texture) in textures.iter().enumerate() {
                    encoder.setFragmentTexture_atIndex(Some(texture), slot);
                }
                encoder.drawPrimitives_vertexStart_vertexCount(MTLPrimitiveType::Triangle, 0, 3);
            }
            encoder.endEncoding();
            outputs.push(output);
        }
        Ok(outputs.pop().or(backdrop))
    }

    /// The backdrop under `drawn` at `scale`: `captured` if it was taken earlier at that size,
    /// else a copy of `target` now.
    fn copy_backdrop(
        &mut self,
        scale: BackdropScale,
        drawn: Bounds<ScaledPixels>,
        target: &ProtocolObject<dyn MTLTexture>,
        command_buffer: &ProtocolObject<dyn MTLCommandBuffer>,
        key: Option<u64>,
        captured: Option<Texture>,
    ) -> Result<Texture> {
        let width = (drawn.size.width.0 * scale.factor()).ceil().max(1.0) as usize;
        let height = (drawn.size.height.0 * scale.factor()).ceil().max(1.0) as usize;
        if let Some(captured) = captured.filter(|c| c.width() == width && c.height() == height) {
            return Ok(captured);
        }
        let origin = [drawn.origin.x.0 as u32, drawn.origin.y.0 as u32];
        // A capture keeps its copy until its effect reads it; a copy taken at the effect is its own.
        let kind = key.map_or(1, |key| 1000 + key.min(1 << 20) as u32);
        let copy_size = size(DevicePixels(width as i32), DevicePixels(height as i32));
        let copy = self.bgra_surfaces.chrome.target(kind, copy_size, MTLPixelFormat::BGRA8Unorm)?;
        if scale == BackdropScale::Full {
            let blit = command_buffer.blitCommandEncoder().context("creating a chrome blit encoder")?;
            // SAFETY: the region lies inside `target` (the drawn rect is clipped to it) and fits `copy`, made its size.
            unsafe {
                blit.copyFromTexture_sourceSlice_sourceLevel_sourceOrigin_sourceSize_toTexture_destinationSlice_destinationLevel_destinationOrigin(
                    target,
                    0,
                    0,
                    MTLOrigin { x: origin[0] as usize, y: origin[1] as usize, z: 0 },
                    MTLSize { width, height, depth: 1 },
                    &copy,
                    0,
                    0,
                    MTLOrigin { x: 0, y: 0, z: 0 },
                );
            }
            blit.endEncoding();
        } else {
            let encoder = pass(command_buffer, &copy, None, None)?;
            viewport(&encoder, copy_size);
            encoder.setRenderPipelineState(&self.bgra_surfaces.chrome.downsample);
            let uniform = Downsample { origin, step: (1.0 / scale.factor()) as u32, pad: 0 };
            // SAFETY: Metal copies the uniform, which matches `ChromeDownsample`, and `target` is live.
            unsafe {
                encoder.setFragmentBytes_length_atIndex(ptr::NonNull::from(&uniform).cast(), mem::size_of::<Downsample>(), 0);
                encoder.setFragmentTexture_atIndex(Some(target), 0);
                encoder.drawPrimitives_vertexStart_vertexCount(MTLPrimitiveType::Triangle, 0, 3);
            }
            encoder.endEncoding();
        }
        Ok(copy)
    }
}

/// A scene with the instances written for it.
#[derive(Clone, Copy)]
struct ChromeScene<'a> {
    scene: &'a Scene,
    bindings: &'a InstanceBindings,
}

/// What a chrome primitive composites: its texture over `drawn`, as `layer` says.
struct Source {
    texture: Texture,
    drawn: Bounds<ScaledPixels>,
    layer: ChromeLayer,
    texel_for_texel: bool,
    origin: [f32; 2],
}

/// Whether an effect's output is the size of what it draws, so the composite reads it texel for
/// texel.
fn effect_at_full_scale(primitive: &ChromePrimitive) -> bool {
    matches!(&primitive.kind, ChromeKind::Effect(effect) if effect.backdrop.is_none_or(|b| b == BackdropScale::Full))
}
