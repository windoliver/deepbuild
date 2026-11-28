//! DeepBuild patch (windoliver/deepbuild#1434): chrome layers on Metal. A layer's scene renders
//! into an offscreen target with alpha composited correctly, then draws once at its order with
//! its opacity, rounded clip and soft edge. An effect copies the target under its bounds (the
//! backdrop, at full, half or quarter scale), runs its registered operator's stages on it, and
//! draws the result at its order, premultiplied, with its clip and edge.
//!
//! From gpui-pre 0.3.11 a frame is one pass with a depth buffer: its opaque rectangles are drawn
//! first, nearest first, and everything else is tested against them. A chrome primitive ends the
//! pass, so it cuts the frame there: the rectangles drawn first are only those painted before it,
//! and the pass that goes on after it draws the next ones first, up to the next chrome primitive.
//! A backdrop copy therefore holds what was painted before it and nothing painted after.
//!
//! Operators are registered by the app as Metal source written from shipped operators, under a
//! fixed binding contract: fragment buffer 0 is the frame (the output's size), buffer 1 the
//! operator's inputs, sampler 0 a linear clamp-to-edge sampler and textures 0.. its texture
//! inputs in order. An effect names an operator; a name nobody registered draws nothing.

use std::collections::HashMap;
use std::ops::Range;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::mem;

use anyhow::{Context as _, Result};
use gpui::{
    BackdropScale, Bounds, ChromeEffect, ChromeKind, ChromeLayer, ChromePrimitive, Corners,
    DevicePixels, PrimitiveBatch, ScaledPixels, Scene, Size, point, quad_depth, quad_depth_scale,
    size,
};
use objc2::{Message, rc::Retained, runtime::ProtocolObject};
use objc2_core_foundation::CFRetained;
use objc2_core_video::CVMetalTexture;
use objc2_foundation::NSString;
use objc2_metal::{
    MTLBlendFactor, MTLBlendOperation, MTLBlitCommandEncoder, MTLCommandBuffer, MTLCommandEncoder,
    MTLCompileOptions, MTLDevice, MTLLibrary, MTLLoadAction, MTLOrigin, MTLPixelFormat,
    MTLPrimitiveType, MTLRenderCommandEncoder, MTLRenderPassDescriptor,
    MTLRenderPipelineDescriptor, MTLRenderPipelineState, MTLSamplerAddressMode,
    MTLSamplerDescriptor, MTLSamplerMinMagFilter, MTLSamplerState, MTLSize, MTLStorageMode,
    MTLStoreAction, MTLTexture, MTLTextureDescriptor, MTLTextureUsage, MTLViewport,
};

use super::{
    GlobalInputIndex, InstanceBindings, InstanceBufferWriter, MetalRenderer, QuadInputIndex,
    write_instances,
};

type Pipeline = Retained<ProtocolObject<dyn MTLRenderPipelineState>>;
type Texture = Retained<ProtocolObject<dyn MTLTexture>>;
type Encoder = Retained<ProtocolObject<dyn MTLRenderCommandEncoder>>;

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

/// The slot the composite's two functions read its uniform at, after the two every pipeline reads.
const COMPOSITE: usize = 2;

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
    /// The instances of each layer's scene in the frame being drawn, by the scene's address.
    layers: HashMap<usize, InstanceBindings>,
    /// While a layer's scene is drawn, the command buffer of the frame it belongs to.
    frame: Option<Retained<ProtocolObject<dyn MTLCommandBuffer>>>,
}

/// A pipeline from the library's functions. `source` is the source color's blend factor, one for
/// a premultiplied source, or none for no blending; `depth` says it draws in a pass with the
/// frame's depth buffer.
pub(super) fn pipeline(
    device: &ProtocolObject<dyn MTLDevice>,
    library: &ProtocolObject<dyn MTLLibrary>,
    label: &str,
    vertex: &str,
    fragment: &str,
    source: Option<MTLBlendFactor>,
    depth: bool,
) -> Result<Pipeline> {
    let function = |name: &str| {
        library
            .newFunctionWithName(&NSString::from_str(name))
            .with_context(|| format!("locating the function {name}"))
    };
    let (vertex, fragment) = (function(vertex)?, function(fragment)?);
    let descriptor = MTLRenderPipelineDescriptor::new();
    descriptor.setLabel(Some(&NSString::from_str(label)));
    descriptor.setVertexFunction(Some(vertex.as_ref()));
    descriptor.setFragmentFunction(Some(fragment.as_ref()));
    // SAFETY: index zero is within the pipeline's color attachment array.
    let attachment = unsafe { descriptor.colorAttachments().objectAtIndexedSubscript(0) };
    attachment.setPixelFormat(MTLPixelFormat::BGRA8Unorm);
    attachment.setBlendingEnabled(source.is_some());
    if let Some(source) = source {
        attachment.setRgbBlendOperation(MTLBlendOperation::Add);
        attachment.setAlphaBlendOperation(MTLBlendOperation::Add);
        attachment.setSourceRGBBlendFactor(source);
        attachment.setSourceAlphaBlendFactor(MTLBlendFactor::One);
        attachment.setDestinationRGBBlendFactor(MTLBlendFactor::OneMinusSourceAlpha);
        attachment.setDestinationAlphaBlendFactor(MTLBlendFactor::OneMinusSourceAlpha);
    }
    if depth {
        descriptor.setDepthAttachmentPixelFormat(MTLPixelFormat::Depth32Float);
    }
    device
        .newRenderPipelineStateWithDescriptor_error(&descriptor)
        .with_context(|| format!("creating the {label} pipeline"))
}

impl Chrome {
    pub(super) fn new(
        device: &ProtocolObject<dyn MTLDevice>,
        library: &ProtocolObject<dyn MTLLibrary>,
    ) -> Result<Self> {
        let sampler = {
            let descriptor = MTLSamplerDescriptor::new();
            descriptor.setMinFilter(MTLSamplerMinMagFilter::Linear);
            descriptor.setMagFilter(MTLSamplerMinMagFilter::Linear);
            descriptor.setSAddressMode(MTLSamplerAddressMode::ClampToEdge);
            descriptor.setTAddressMode(MTLSamplerAddressMode::ClampToEdge);
            device
                .newSamplerStateWithDescriptor(&descriptor)
                .context("creating the chrome sampler")?
        };
        let composite = |label, source| {
            pipeline(device, library, label, "chrome_vertex", "chrome_fragment", Some(source), true)
        };
        Ok(Self {
            device: device.retain(),
            composite: composite("chrome", MTLBlendFactor::One)?,
            composite_straight: composite("chrome_straight", MTLBlendFactor::SourceAlpha)?,
            downsample: pipeline(
                device,
                library,
                "chrome_downsample",
                "chrome_fullscreen_vertex",
                "chrome_downsample_fragment",
                None,
                false,
            )?,
            sampler,
            targets: HashMap::new(),
            captures: HashMap::new(),
            compiled: HashMap::new(),
            depth: 0,
            layers: HashMap::new(),
            frame: None,
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
            // SAFETY: both dimensions are at least one and at most the frame's own.
            unsafe {
                descriptor.setWidth(width);
                descriptor.setHeight(height);
            }
            descriptor.setPixelFormat(format);
            descriptor.setStorageMode(MTLStorageMode::Private);
            descriptor.setUsage(MTLTextureUsage::RenderTarget | MTLTextureUsage::ShaderRead);
            let texture = self
                .device
                .newTextureWithDescriptor(&descriptor)
                .context("allocating a chrome target")?;
            self.targets.insert(key, texture);
        }
        Ok(self.targets[&key].clone())
    }

    fn compiled(&mut self, name: &str) -> Option<(Arc<ChromeOperator>, Vec<Pipeline>)> {
        let operator = operator(name)?;
        if !self.compiled.contains_key(name) {
            let mut compiled = Vec::new();
            for graph in &operator.graphs {
                let library = match self.device.newLibraryWithSource_options_error(
                    &NSString::from_str(&graph.msl),
                    Some(&MTLCompileOptions::new()),
                ) {
                    Ok(library) => library,
                    Err(error) => {
                        log::error!("chrome operator {name}'s graph {} didn't compile: {error}", graph.label);
                        return None;
                    }
                };
                let descriptor = MTLRenderPipelineDescriptor::new();
                descriptor.setLabel(Some(&NSString::from_str(&graph.label)));
                let vertex = library.newFunctionWithName(&NSString::from_str(&graph.vertex))?;
                let fragment = library.newFunctionWithName(&NSString::from_str(&graph.fragment))?;
                descriptor.setVertexFunction(Some(vertex.as_ref()));
                descriptor.setFragmentFunction(Some(fragment.as_ref()));
                // SAFETY: index zero is within the pipeline's color attachment array.
                let attachment = unsafe { descriptor.colorAttachments().objectAtIndexedSubscript(0) };
                attachment.setPixelFormat(RUN_FORMAT);
                attachment.setBlendingEnabled(false);
                compiled.push(self.device.newRenderPipelineStateWithDescriptor_error(&descriptor).ok()?);
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

/// How many of the scene's quads are ordered before its `nth` chrome primitive, or all of them when it has
/// no such primitive: where the frame is cut.
fn cut(scene: &Scene, nth: usize) -> usize {
    if nth >= scene.chrome.len() {
        return scene.quads.len();
    }
    let mut quads = 0;
    for batch in scene.batches() {
        match batch {
            PrimitiveBatch::Quads(range) => quads += range.len(),
            PrimitiveBatch::Chrome(index) if index == nth => return quads,
            _ => {}
        }
    }
    scene.quads.len()
}

/// The quads whose opaque rectangles the frame's pass draws before anything else: those ordered before the
/// scene's first chrome primitive.
pub(super) fn first_cut(scene: &Scene) -> usize {
    cut(scene, 0)
}

fn viewport(size: Size<DevicePixels>, znear: f64, zfar: f64) -> MTLViewport {
    MTLViewport {
        originX: 0.0,
        originY: 0.0,
        width: i32::from(size.width) as f64,
        height: i32::from(size.height) as f64,
        znear,
        zfar,
    }
}

/// A pass into `texture` alone, with no depth buffer, every pixel of which the caller writes.
fn pass_into(
    command_buffer: &ProtocolObject<dyn MTLCommandBuffer>,
    texture: &ProtocolObject<dyn MTLTexture>,
    size: Size<DevicePixels>,
) -> Result<Encoder> {
    let descriptor = MTLRenderPassDescriptor::new();
    // SAFETY: index zero is within the render pass's color attachment array.
    let color = unsafe { descriptor.colorAttachments().objectAtIndexedSubscript(0) };
    color.setTexture(Some(texture));
    color.setLoadAction(MTLLoadAction::DontCare);
    color.setStoreAction(MTLStoreAction::Store);
    let encoder = command_buffer
        .renderCommandEncoderWithDescriptor(&descriptor)
        .context("creating a chrome pass")?;
    encoder.setViewport(viewport(size, 0.0, 1.0));
    Ok(encoder)
}

impl MetalRenderer {
    /// Writes the instances of every layer's scene in `scene`, and of the layers in those, with the frame's own.
    pub(super) fn write_chrome_instances(&mut self, scene: &Scene, writer: &mut InstanceBufferWriter) -> Result<()> {
        self.bgra_surfaces.chrome.layers.clear();
        self.write_layers(scene, writer)
    }

    fn write_layers(&mut self, scene: &Scene, writer: &mut InstanceBufferWriter) -> Result<()> {
        for primitive in &scene.chrome {
            if let ChromeKind::Layer(_, layer) = &primitive.kind {
                let bindings = write_instances(layer, writer)?;
                self.bgra_surfaces.chrome.layers.insert(Arc::as_ptr(layer) as usize, bindings);
                self.write_layers(layer, writer)?;
            }
        }
        Ok(())
    }

    /// The command buffer a scene draws in: `fresh`, or its frame's while it is a layer's scene.
    pub(super) fn chrome_command_buffer(
        &self,
        fresh: Retained<ProtocolObject<dyn MTLCommandBuffer>>,
    ) -> Retained<ProtocolObject<dyn MTLCommandBuffer>> {
        self.bgra_surfaces.chrome.frame.clone().unwrap_or(fresh)
    }

    /// Draws the scene's chrome primitive `index` at its order into `target`, ending `encoder` and
    /// returning the encoder the frame goes on with, the opaque rectangles painted between this
    /// primitive and the next already drawn in it.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn draw_chrome(
        &mut self,
        scene: &Scene,
        index: usize,
        instance_bindings: &InstanceBindings,
        target: &ProtocolObject<dyn MTLTexture>,
        viewport_size: Size<DevicePixels>,
        command_buffer: &ProtocolObject<dyn MTLCommandBuffer>,
        encoder: Encoder,
        surface_textures: &mut Vec<CFRetained<CVMetalTexture>>,
    ) -> Result<Encoder> {
        let primitive = &scene.chrome[index];
        let quads = cut(scene, index)..cut(scene, index + 1);
        let skipped = |renderer: &Self, encoder: Encoder| {
            renderer.draw_opaque_quads_between(quads.clone(), instance_bindings, viewport_size, &encoder);
            Ok(encoder)
        };
        let Some(drawn) = drawn(primitive, viewport_size) else {
            return skipped(self, encoder);
        };
        // A drawable vended before the window first read a backdrop can't be copied from; the
        // next one can.
        let reads = matches!(&primitive.kind, ChromeKind::Backdrop(..))
            || matches!(&primitive.kind, ChromeKind::Effect(e) if e.backdrop.is_some());
        if reads && target.isFramebufferOnly() {
            log::warn!("a chrome backdrop skipped: this frame's drawable isn't readable");
            return skipped(self, encoder);
        }
        if let ChromeKind::Effect(effect) = &primitive.kind
            && self.bgra_surfaces.chrome.compiled(&effect.operator).is_none()
        {
            log::warn!("chrome effect {}: no operator {} is registered", effect.name, effect.operator);
            return skipped(self, encoder);
        }
        encoder.endEncoding();
        let source = match &primitive.kind {
            ChromeKind::Layer(layer, scene) => {
                let offscreen = self.render_layer(scene, viewport_size, command_buffer, surface_textures)?;
                Some((offscreen, *layer, true))
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
                self.run_effect(effect, drawn, target, command_buffer)?.map(|output| {
                    let layer = ChromeLayer { opacity: 1., radii: effect.radii, edge: effect.edge };
                    (output, layer, false)
                })
            }
        };
        let depth_scale = quad_depth_scale(scene.quads.len());
        let encoder = self.resume_pass(target, viewport_size, depth_scale, command_buffer)?;
        self.draw_opaque_quads_between(quads.clone(), instance_bindings, viewport_size, &encoder);
        if let Some((texture, layer, texel_for_texel)) = source {
            let origin = if texel_for_texel { [0., 0.] } else { [drawn.origin.x.0, drawn.origin.y.0] };
            let texel_for_texel = texel_for_texel || effect_at_full_scale(primitive);
            // As every batch but the quads': at the depth of the quad the frame has reached.
            let depth = quad_depth(quads.start as u32, depth_scale) as f64;
            encoder.setViewport(viewport(viewport_size, depth, depth));
            self.composite(&encoder, &texture, primitive.bounds, drawn, layer, texel_for_texel, origin);
        }
        Ok(encoder)
    }

    /// The frame's pass into `target` again, over what it holds, with a new depth buffer and the two
    /// values every pipeline reads bound as the frame's first pass bound them.
    fn resume_pass(
        &mut self,
        target: &ProtocolObject<dyn MTLTexture>,
        viewport_size: Size<DevicePixels>,
        depth_scale: f32,
        command_buffer: &ProtocolObject<dyn MTLCommandBuffer>,
    ) -> Result<Encoder> {
        let depth_texture = self.depth_texture_matching(target)?;
        let descriptor = MTLRenderPassDescriptor::new();
        // SAFETY: index zero is within the render pass's color attachment array.
        let color = unsafe { descriptor.colorAttachments().objectAtIndexedSubscript(0) };
        color.setTexture(Some(target));
        color.setLoadAction(MTLLoadAction::Load);
        color.setStoreAction(MTLStoreAction::Store);
        let depth = descriptor.depthAttachment();
        depth.setTexture(Some(&depth_texture));
        depth.setLoadAction(MTLLoadAction::Clear);
        depth.setClearDepth(0.0);
        depth.setStoreAction(MTLStoreAction::DontCare);
        let encoder = command_buffer
            .renderCommandEncoderWithDescriptor(&descriptor)
            .context("creating the render command encoder a chrome primitive goes on with")?;
        encoder.setViewport(viewport(viewport_size, 0.0, 1.0));
        // SAFETY: Metal copies both values, which match every vertex shader's
        // `GlobalInputIndex_ViewportSize` and `GlobalInputIndex_DepthScale` arguments.
        unsafe {
            encoder.setVertexBytes_length_atIndex(
                NonNull::from(&viewport_size).cast(),
                mem::size_of_val(&viewport_size),
                GlobalInputIndex::ViewportSize as usize,
            );
            encoder.setVertexBytes_length_atIndex(
                NonNull::from(&depth_scale).cast(),
                mem::size_of_val(&depth_scale),
                GlobalInputIndex::DepthScale as usize,
            );
        }
        Ok(encoder)
    }

    /// Draws the opaque rectangles among `quads`, nearest first, as the frame's pass draws those before its
    /// first chrome primitive, and leaves the pass testing depth.
    fn draw_opaque_quads_between(
        &self,
        quads: Range<usize>,
        instance_bindings: &InstanceBindings,
        viewport_size: Size<DevicePixels>,
        encoder: &ProtocolObject<dyn MTLRenderCommandEncoder>,
    ) {
        if !quads.is_empty() {
            // The opaque quad shader walks back from the count it is given.
            let quad_count = quads.end as u32;
            encoder.setViewport(viewport(viewport_size, 0.0, 1.0));
            encoder.setRenderPipelineState(&self.opaque_quads_pipeline_state);
            encoder.setDepthStencilState(Some(&self.depth_write_state));
            // SAFETY: the scene's quads and the copied count match the shader layouts and slots. Metal
            // retains the buffer, whose writes the frame's writer publishes.
            unsafe {
                encoder.setVertexBuffer_offset_atIndex(
                    Some(&instance_bindings.quads.buffer),
                    instance_bindings.quads.offset,
                    QuadInputIndex::Quads as usize,
                );
                encoder.setVertexBytes_length_atIndex(
                    NonNull::from(&quad_count).cast(),
                    mem::size_of_val(&quad_count),
                    QuadInputIndex::QuadCount as usize,
                );
                encoder.drawPrimitives_vertexStart_vertexCount_instanceCount_baseInstance(
                    MTLPrimitiveType::TriangleStrip,
                    0,
                    4,
                    quads.len(),
                    0,
                );
            }
        }
        encoder.setDepthStencilState(Some(&self.depth_test_state));
    }

    #[allow(clippy::too_many_arguments)]
    fn composite(
        &self,
        encoder: &ProtocolObject<dyn MTLRenderCommandEncoder>,
        texture: &ProtocolObject<dyn MTLTexture>,
        bounds: Bounds<ScaledPixels>,
        drawn: Bounds<ScaledPixels>,
        layer: ChromeLayer,
        texel_for_texel: bool,
        source_origin: [f32; 2],
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
        encoder.setRenderPipelineState(pipeline);
        // SAFETY: Metal copies the uniform, which is `ChromeComposite` as both functions read it at
        // this slot; the texture is the fragment's one texture.
        unsafe {
            encoder.setVertexBytes_length_atIndex(NonNull::from(&uniform).cast(), mem::size_of::<Composite>(), COMPOSITE);
            encoder.setFragmentBytes_length_atIndex(NonNull::from(&uniform).cast(), mem::size_of::<Composite>(), COMPOSITE);
            encoder.setFragmentTexture_atIndex(Some(texture), 0);
            encoder.drawPrimitives_vertexStart_vertexCount(MTLPrimitiveType::TriangleStrip, 0, 4);
        }
    }

    /// Renders a layer's scene into an offscreen target the size of the frame, as the frame's own
    /// scene is drawn, in the frame's command buffer and over clear.
    fn render_layer(
        &mut self,
        scene: &Arc<Scene>,
        viewport_size: Size<DevicePixels>,
        command_buffer: &ProtocolObject<dyn MTLCommandBuffer>,
        surface_textures: &mut Vec<CFRetained<CVMetalTexture>>,
    ) -> Result<Texture> {
        let chrome = &mut self.bgra_surfaces.chrome;
        let offscreen = chrome.target(0, viewport_size, MTLPixelFormat::BGRA8Unorm)?;
        let bindings = chrome
            .layers
            .remove(&(Arc::as_ptr(scene) as usize))
            .context("a chrome layer's instances weren't written")?;
        chrome.depth += 1;
        let frame = chrome.frame.replace(command_buffer.retain());
        let opaque = mem::replace(&mut self.opaque, false);
        let drew = self.draw_primitives_to_texture(scene, &bindings, &offscreen, viewport_size, surface_textures);
        self.opaque = opaque;
        self.bgra_surfaces.chrome.frame = frame;
        self.bgra_surfaces.chrome.depth -= 1;
        drew.map(|_| offscreen)
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
            let mut textures = Vec::with_capacity(run.textures.len());
            for input in &run.textures {
                let texture = match input {
                    ChromeInput::Backdrop => backdrop.as_ref(),
                    ChromeInput::Run(run) => outputs.get(*run),
                }
                .with_context(|| format!("chrome operator {}: run {index} reads no texture", effect.operator))?;
                textures.push(texture.clone());
            }
            let output = self.bgra_surfaces.chrome.target(2 + index as u32, out_size, RUN_FORMAT)?;
            let encoder = pass_into(command_buffer, &output, out_size)?;
            encoder.setRenderPipelineState(pipeline);
            let mut inputs = run.inputs;
            inputs.resize(inputs.len().max(16), 0);
            // SAFETY: Metal copies the frame and the inputs, which the operator's binding contract puts
            // at buffers 0 and 1, with the sampler at 0 and its textures from 0 in order.
            unsafe {
                encoder.setFragmentBytes_length_atIndex(NonNull::from(&frame).cast(), mem::size_of::<Frame>(), 0);
                encoder.setFragmentBytes_length_atIndex(NonNull::from(inputs.as_slice()).cast(), inputs.len(), 1);
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
        let width = (drawn.size.width.0 * scale.factor()).ceil().max(1.0) as i32;
        let height = (drawn.size.height.0 * scale.factor()).ceil().max(1.0) as i32;
        if let Some(captured) =
            captured.filter(|c| c.width() == width as usize && c.height() == height as usize)
        {
            return Ok(captured);
        }
        let origin = [drawn.origin.x.0 as u32, drawn.origin.y.0 as u32];
        // A capture keeps its copy until its effect reads it; a copy taken at the effect is its own.
        let kind = key.map_or(1, |key| 1000 + key.min(1 << 20) as u32);
        let out_size = size(DevicePixels(width), DevicePixels(height));
        let copy = self.bgra_surfaces.chrome.target(kind, out_size, MTLPixelFormat::BGRA8Unorm)?;
        if scale == BackdropScale::Full {
            let blit = command_buffer
                .blitCommandEncoder()
                .context("creating the blit encoder a backdrop is copied with")?;
            // SAFETY: `drawn` lies inside the target, which is as wide and as high as the frame, and
            // the copy is `drawn`'s size; both are BGRA8.
            unsafe {
                blit.copyFromTexture_sourceSlice_sourceLevel_sourceOrigin_sourceSize_toTexture_destinationSlice_destinationLevel_destinationOrigin(
                    target,
                    0,
                    0,
                    MTLOrigin { x: origin[0] as usize, y: origin[1] as usize, z: 0 },
                    MTLSize { width: width as usize, height: height as usize, depth: 1 },
                    &copy,
                    0,
                    0,
                    MTLOrigin { x: 0, y: 0, z: 0 },
                );
            }
            blit.endEncoding();
        } else {
            let encoder = pass_into(command_buffer, &copy, out_size)?;
            encoder.setRenderPipelineState(&self.bgra_surfaces.chrome.downsample);
            let uniform = Downsample { origin, step: (1.0 / scale.factor()) as u32, pad: 0 };
            // SAFETY: Metal copies the uniform, which is `ChromeDownsample` at the fragment's buffer 0;
            // the target is its one texture.
            unsafe {
                encoder.setFragmentBytes_length_atIndex(NonNull::from(&uniform).cast(), mem::size_of::<Downsample>(), 0);
                encoder.setFragmentTexture_atIndex(Some(target), 0);
                encoder.drawPrimitives_vertexStart_vertexCount(MTLPrimitiveType::Triangle, 0, 3);
            }
            encoder.endEncoding();
        }
        Ok(copy)
    }
}

/// Whether an effect's output is the size of what it draws, so the composite reads it texel for
/// texel.
fn effect_at_full_scale(primitive: &ChromePrimitive) -> bool {
    matches!(&primitive.kind, ChromeKind::Effect(effect) if effect.backdrop.is_none_or(|b| b == BackdropScale::Full))
}
