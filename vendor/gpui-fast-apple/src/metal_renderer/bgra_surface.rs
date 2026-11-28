//! DeepBuild patch (windoliver/deepbuild#377): a BGRA surface with alpha (a slot another renderer
//! drew into an IOSurface), sampled from its one plane and composited premultiplied, and the
//! reports on the frame that samples it. Zed declined this (zed-industries/zed#66114), so it stays
//! ours: `vendor/gpui-pre-apple/upstream/README.md`.

use std::{mem, ptr};

use anyhow::{Context as _, Result};
use gpui::{DevicePixels, Size};
use objc2_core_foundation::CFRetained;
use objc2_core_video::{
    CVMetalTexture, CVMetalTextureCache, CVMetalTextureGetTexture, CVPixelBuffer,
    CVPixelBufferGetHeight, CVPixelBufferGetPixelFormatType, CVPixelBufferGetWidth,
    kCVPixelFormatType_32BGRA, kCVReturnSuccess,
};
use objc2_foundation::NSString;
use objc2_metal::{
    MTLBlendFactor, MTLBlendOperation, MTLCommandBuffer, MTLDevice, MTLLibrary, MTLPixelFormat,
    MTLPrimitiveType, MTLRenderCommandEncoder, MTLRenderPipelineDescriptor, MTLRenderPipelineState,
};

use super::{MetalRenderer, ProtocolObject, Retained, SurfaceInputIndex, gpu_ledger, gpu_surfaces};

pub(super) type Pipeline = Retained<ProtocolObject<dyn MTLRenderPipelineState>>;

/// A carried pipeline drawing BGRA8: blended over what's beneath with `source` as the source color's factor (the
/// destination's is one minus the source's alpha), or with blending off for `None`; with the frame's depth
/// attachment when `depth`, as every pipeline drawn in GPUI's own passes needs.
pub(super) fn carried_pipeline(
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
            .with_context(|| format!("locating the carried function {name}"))
    };
    let descriptor = MTLRenderPipelineDescriptor::new();
    descriptor.setLabel(Some(&NSString::from_str(label)));
    descriptor.setVertexFunction(Some(&*function(vertex)?));
    descriptor.setFragmentFunction(Some(&*function(fragment)?));
    // SAFETY: Index zero is within the pipeline's color attachment array.
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
        .with_context(|| format!("creating the carried {label} pipeline"))
}

/// The BGRA pipelines.
pub(super) struct BgraSurfaces {
    premultiplied: Pipeline,
    /// The planted twin that divides alpha out.
    divided: Pipeline,
    /// DeepBuild patch (windoliver/deepbuild#177): a clear region's, blending off.
    clear: Pipeline,
    /// DeepBuild patch (windoliver/deepbuild#1434): the chrome layers' pipelines and targets, built with these.
    pub(super) chrome: super::chrome_layers::Chrome,
    /// DeepBuild patch (windoliver/deepbuild#499): the tagged NV12 pipeline, built with these.
    pub(super) ycbcr: Pipeline,
    /// The pixel buffers the frame being encoded samples, for its surfaces report.
    pub(super) sampled: Vec<u64>,
}

impl BgraSurfaces {
    /// The slot stays premultiplied into the window, so the pipeline's source factor is one.
    pub(super) fn new(device: &ProtocolObject<dyn MTLDevice>, library: &ProtocolObject<dyn MTLLibrary>) -> Result<Self> {
        let surface = |label, fragment, source| carried_pipeline(device, library, label, "surface_vertex", fragment, source, true);
        Ok(Self {
            premultiplied: surface("surfaces_bgra", "surface_bgra_fragment", Some(MTLBlendFactor::One))?,
            divided: surface("surfaces_bgra_divided", "surface_bgra_divided_fragment", Some(MTLBlendFactor::SourceAlpha))?,
            clear: super::clear_surface::pipeline(device, library)?, // DeepBuild patch (windoliver/deepbuild#177)
            chrome: super::chrome_layers::Chrome::new(device, library)?, // DeepBuild patch (windoliver/deepbuild#1434)
            ycbcr: super::ycbcr_surface::pipeline(device, library)?, // DeepBuild patch (windoliver/deepbuild#499)
            sampled: Vec::new(),
        })
    }
}

/// The frame's completion, from Metal's completed handler.
pub(super) fn completed(buffer: &ProtocolObject<dyn MTLCommandBuffer>, frame: Option<u64>) {
    let gpu_ns = gpu_ledger::completed(buffer);
    if let Some(frame) = frame {
        gpu_surfaces::report(gpu_surfaces::Event::Completed { frame, gpu_ns });
    }
}

/// A Metal texture over a plane of `image_buffer`, which the frame's completion keeps until the GPU has read it.
pub(super) fn plane_texture(
    cache: &CVMetalTextureCache,
    image_buffer: &CVPixelBuffer,
    plane: usize,
    format: MTLPixelFormat,
    (width, height): (usize, usize),
) -> Result<CFRetained<CVMetalTexture>> {
    let mut texture = ptr::null_mut();
    // SAFETY: the buffer has this plane in this format and size, and the output pointer is writable.
    let status = unsafe {
        CVMetalTextureCache::create_texture_from_image(
            None,
            cache,
            image_buffer,
            None,
            format,
            width,
            height,
            plane,
            ptr::NonNull::from(&mut texture),
        )
    };
    anyhow::ensure!(status == kCVReturnSuccess, "creating a CoreVideo Metal texture: status {status}");
    let texture = ptr::NonNull::new(texture).context("CoreVideo returned a null texture")?;
    // SAFETY: the successful create call transfers ownership of this non-null texture.
    Ok(unsafe { CFRetained::from_raw(texture) })
}

impl MetalRenderer {
    /// Counts the frame and reports what it samples. Every caller commits the buffer it gets back,
    /// so this comes before the completed handler can run. The frame's number, when it was reported.
    pub(super) fn surfaces_encoded(&mut self) -> Option<u64> {
        gpu_ledger::committed();
        (!self.bgra_surfaces.sampled.is_empty() && gpu_surfaces::has_hook()).then(|| {
            let frame = gpu_surfaces::next_frame();
            gpu_surfaces::report(gpu_surfaces::Event::Encoded {
                frame,
                surfaces: mem::take(&mut self.bgra_surfaces.sampled),
            });
            frame
        })
    }

    /// Draws a surface that is BGRA, leaving the encoder as it found it; false for any other format.
    pub(super) fn draw_bgra_surface(
        &mut self,
        image_buffer: &CVPixelBuffer,
        texture_size: Size<DevicePixels>,
        instance: usize,
        command_encoder: &ProtocolObject<dyn MTLRenderCommandEncoder>,
        surface_textures: &mut Vec<CFRetained<CVMetalTexture>>,
    ) -> Result<bool> {
        if CVPixelBufferGetPixelFormatType(image_buffer) != kCVPixelFormatType_32BGRA {
            return Ok(false);
        }
        self.draw_bgra(image_buffer, texture_size, instance, command_encoder, surface_textures)?;
        command_encoder.setRenderPipelineState(&self.surfaces_pipeline_state);
        Ok(true)
    }

    /// Draws one BGRA surface and notes its pixel buffer as sampled by the frame being encoded.
    fn draw_bgra(
        &mut self,
        image_buffer: &CVPixelBuffer,
        texture_size: Size<DevicePixels>,
        instance: usize,
        command_encoder: &ProtocolObject<dyn MTLRenderCommandEncoder>,
        surface_textures: &mut Vec<CFRetained<CVMetalTexture>>,
    ) -> Result<()> {
        let size = (CVPixelBufferGetWidth(image_buffer), CVPixelBufferGetHeight(image_buffer));
        let texture = plane_texture(&self.core_video_texture_cache, image_buffer, 0, MTLPixelFormat::BGRA8Unorm, size)?;
        let metal_texture = CVMetalTextureGetTexture(&texture).context("CoreVideo returned no Metal texture")?;
        let id = ptr::from_ref(image_buffer) as usize as u64;
        let pipeline = match gpu_surfaces::planted() {
            // DeepBuild patch (windoliver/deepbuild#177): a clear region replaces what's beneath.
            _ if super::clear_surface::clears(id) => &self.bgra_surfaces.clear,
            gpu_surfaces::Planted::DividesAlpha => &self.bgra_surfaces.divided,
            _ => &self.bgra_surfaces.premultiplied,
        };
        command_encoder.setRenderPipelineState(pipeline);
        // SAFETY: the size is copied from a live value, and the texture matches the fragment's slot; the frame's
        // completion keeps the CoreVideo texture until the GPU has read it. One instance of the surfaces uploaded.
        unsafe {
            command_encoder.setVertexBytes_length_atIndex(
                ptr::NonNull::from(&texture_size).cast(),
                mem::size_of_val(&texture_size),
                SurfaceInputIndex::TextureSize as usize,
            );
            command_encoder.setFragmentTexture_atIndex(Some(&metal_texture), SurfaceInputIndex::YTexture as usize);
            command_encoder.drawPrimitives_vertexStart_vertexCount_instanceCount_baseInstance(
                MTLPrimitiveType::TriangleStrip,
                0,
                4,
                1,
                instance,
            );
        }
        surface_textures.push(texture);
        self.bgra_surfaces.sampled.push(id);
        Ok(())
    }
}
