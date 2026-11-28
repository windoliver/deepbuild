//! DeepBuild patch (windoliver/deepbuild#377): a BGRA surface with alpha (a slot another renderer
//! drew into an IOSurface), sampled from its one plane and composited premultiplied, and the
//! reports on the frame that samples it. Zed declined this (zed-industries/zed#66114), so it stays
//! ours: `vendor/gpui-pre-apple/upstream/README.md`.

use std::{mem, ptr};

use anyhow::{Context as _, Result};
use gpui::{DevicePixels, Scene, Size};
use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_core_foundation::CFRetained;
use objc2_core_video::{
    CVMetalTexture, CVMetalTextureCache, CVMetalTextureGetTexture, CVPixelBuffer,
    CVPixelBufferGetHeight, CVPixelBufferGetPixelFormatType, CVPixelBufferGetWidth,
    kCVPixelFormatType_32BGRA, kCVReturnSuccess,
};
use objc2_metal::{
    MTLBlendFactor, MTLCommandBuffer, MTLCommandEncoder, MTLDevice, MTLLibrary, MTLPixelFormat,
    MTLPrimitiveType, MTLRenderCommandEncoder, MTLRenderPipelineState, MTLViewport,
};

use super::{
    InstanceBindings, MetalRenderer, SurfaceInputIndex, build_pipeline_state, chrome_layers,
    gpu_ledger, gpu_surfaces,
};

type Pipeline = Retained<ProtocolObject<dyn MTLRenderPipelineState>>;

/// The BGRA pipelines.
pub(super) struct BgraSurfaces {
    premultiplied: Pipeline,
    /// The planted twin that divides alpha out.
    divided: Pipeline,
    /// DeepBuild patch (windoliver/deepbuild#177): a clear region's, blending off.
    clear: Pipeline,
    /// DeepBuild patch (windoliver/deepbuild#1434): the chrome layers' pipelines and targets, built with these.
    pub(super) chrome: chrome_layers::Chrome,
    /// DeepBuild patch (windoliver/deepbuild#499): the tagged NV12 pipeline, built with these.
    pub(super) ycbcr: Pipeline,
    /// The pixel buffers the frame being encoded samples, for its surfaces report.
    pub(super) sampled: Vec<u64>,
}

impl BgraSurfaces {
    /// The slot stays premultiplied into the window, so its pipeline's source factor is one.
    pub(super) fn new(
        device: &ProtocolObject<dyn MTLDevice>,
        library: &ProtocolObject<dyn MTLLibrary>,
    ) -> Result<Self> {
        Ok(Self {
            premultiplied: chrome_layers::pipeline(
                device,
                library,
                "surfaces_bgra",
                "surface_vertex",
                "surface_bgra_fragment",
                Some(MTLBlendFactor::One),
                true,
            )?,
            divided: build_pipeline_state(
                device,
                library,
                "surfaces_bgra_divided",
                "surface_vertex",
                "surface_bgra_divided_fragment",
                MTLPixelFormat::BGRA8Unorm,
                true,
            )?,
            clear: super::clear_surface::pipeline(device, library)?, // DeepBuild patch (windoliver/deepbuild#177)
            chrome: chrome_layers::Chrome::new(device, library)?, // DeepBuild patch (windoliver/deepbuild#1434)
            ycbcr: super::ycbcr_surface::pipeline(device, library)?, // DeepBuild patch (windoliver/deepbuild#499)
            sampled: Vec::new(),
        })
    }
}

/// The frame's completion, from Metal's completed handler.
pub(super) fn completed(buffer: ptr::NonNull<ProtocolObject<dyn MTLCommandBuffer>>, frame: Option<u64>) {
    // SAFETY: Metal hands a completed handler the command buffer it completed.
    let gpu_ns = gpu_ledger::completed(unsafe { buffer.as_ref() });
    if let Some(frame) = frame {
        gpu_surfaces::report(gpu_surfaces::Event::Completed { frame, gpu_ns });
    }
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

    /// Draws a surface that is BGRA, or NV12 by its own tags (DeepBuild patch
    /// (windoliver/deepbuild#499)), leaving the encoder as it found it; false for a surface GPUI's
    /// stock path draws. The textures it samples join `surface_textures`.
    pub(super) fn draw_carried_surface(
        &mut self,
        image_buffer: &CVPixelBuffer,
        texture_size: Size<DevicePixels>,
        instance: usize,
        command_encoder: &ProtocolObject<dyn MTLRenderCommandEncoder>,
        surface_textures: &mut Vec<CFRetained<CVMetalTexture>>,
    ) -> Result<bool> {
        let drew = if CVPixelBufferGetPixelFormatType(image_buffer) == kCVPixelFormatType_32BGRA {
            self.draw_bgra(image_buffer, texture_size, instance, command_encoder, surface_textures)?;
            true
        } else {
            self.draw_ycbcr_surface(image_buffer, texture_size, instance, command_encoder, surface_textures)?
        };
        if drew {
            command_encoder.setRenderPipelineState(&self.surfaces_pipeline_state);
        }
        Ok(drew)
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
        let mut texture = ptr::null_mut();
        // SAFETY: the buffer is BGRA, one plane of these dimensions, and the output pointer is writable.
        let status = unsafe {
            CVMetalTextureCache::create_texture_from_image(
                None,
                &self.core_video_texture_cache,
                image_buffer,
                None,
                MTLPixelFormat::BGRA8Unorm,
                CVPixelBufferGetWidth(image_buffer),
                CVPixelBufferGetHeight(image_buffer),
                0,
                ptr::NonNull::from(&mut texture),
            )
        };
        anyhow::ensure!(
            status == kCVReturnSuccess,
            "creating CoreVideo Metal texture for a BGRA surface: status {status}"
        );
        let texture = ptr::NonNull::new(texture).context("retrieving CoreVideo Metal texture")?;
        // SAFETY: the successful create call transfers ownership of this non-null texture.
        let texture: CFRetained<CVMetalTexture> = unsafe { CFRetained::from_raw(texture) };
        let metal_texture =
            CVMetalTextureGetTexture(&texture).context("retrieving a BGRA surface's Metal texture")?;
        let identity = ptr::from_ref(image_buffer) as usize as u64;
        let pipeline = match gpu_surfaces::planted() {
            // DeepBuild patch (windoliver/deepbuild#177): a clear region replaces what's beneath.
            _ if super::clear_surface::clears(identity) => &self.bgra_surfaces.clear,
            gpu_surfaces::Planted::DividesAlpha => &self.bgra_surfaces.divided,
            _ => &self.bgra_surfaces.premultiplied,
        };
        command_encoder.setRenderPipelineState(pipeline);
        // SAFETY: Metal copies the size, which matches the vertex shader's argument at its slot; the
        // texture matches the fragment's slot, and `surface_textures` keeps its CoreVideo wrapper until
        // the GPU has read it. The draw is one instance of the uploaded surfaces.
        unsafe {
            command_encoder.setVertexBytes_length_atIndex(
                ptr::NonNull::from(&texture_size).cast(),
                mem::size_of_val(&texture_size),
                SurfaceInputIndex::TextureSize as usize,
            );
            command_encoder
                .setFragmentTexture_atIndex(Some(&metal_texture), SurfaceInputIndex::YTexture as usize);
            command_encoder.drawPrimitives_vertexStart_vertexCount_instanceCount_baseInstance(
                MTLPrimitiveType::TriangleStrip,
                0,
                4,
                1,
                instance,
            );
        }
        surface_textures.push(texture);
        self.bgra_surfaces.sampled.push(identity);
        Ok(())
    }

    /// The planted twin that draws surfaces after the rest of the scene: every surface, past every
    /// quad's depth, so nothing painted above one keeps it under.
    pub(super) fn draw_surfaces_last(
        &mut self,
        scene: &Scene,
        instance_bindings: &InstanceBindings,
        viewport_size: Size<DevicePixels>,
        command_encoder: &ProtocolObject<dyn MTLRenderCommandEncoder>,
        surface_textures: &mut Vec<CFRetained<CVMetalTexture>>,
    ) -> Result<()> {
        if !gpu_surfaces::surfaces_last() || scene.surfaces.is_empty() {
            return Ok(());
        }
        command_encoder.setViewport(MTLViewport {
            originX: 0.0,
            originY: 0.0,
            width: i32::from(viewport_size.width) as f64,
            height: i32::from(viewport_size.height) as f64,
            znear: 1.0,
            zfar: 1.0,
        });
        let drew = self.draw_surfaces(&scene.surfaces, 0, instance_bindings, command_encoder, surface_textures);
        if drew.is_err() {
            command_encoder.endEncoding();
        }
        drew
    }
}
