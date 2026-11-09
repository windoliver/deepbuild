//! DeepBuild patch (windoliver/deepbuild#377): a BGRA surface with alpha (a slot another renderer
//! drew into an IOSurface), sampled from its one plane and composited premultiplied, and the
//! reports on the frame that samples it. Zed declined this (zed-industries/zed#66114), so it stays
//! ours: `vendor/gpui-pre-apple/upstream/README.md`.

use std::{mem, ptr};

use foreign_types::ForeignTypeRef;
use gpui::{DevicePixels, Size};
use objc2::runtime::AnyObject;
use objc2_core_foundation::CFRetained;
use objc2_core_video::{
    CVMetalTexture, CVMetalTextureCache, CVMetalTextureGetTexture, CVPixelBuffer,
    CVPixelBufferGetHeight, CVPixelBufferGetPixelFormatType, CVPixelBufferGetWidth,
    kCVPixelFormatType_32BGRA, kCVReturnSuccess,
};

use super::{
    MTLPixelFormat, MetalRenderer, SurfaceInputIndex, build_path_sprite_pipeline_state,
    build_pipeline_state, gpu_ledger, gpu_surfaces,
};

/// The BGRA pipelines.
pub(super) struct BgraSurfaces {
    premultiplied: metal::RenderPipelineState,
    /// The planted twin that divides alpha out.
    divided: metal::RenderPipelineState,
    /// DeepBuild patch (windoliver/deepbuild#1434): the chrome layers' pipelines and targets, built with these.
    pub(super) chrome: super::chrome_layers::Chrome,
}

impl BgraSurfaces {
    /// The slot stays premultiplied into the window, so the pipeline blends as path sprites do.
    pub(super) fn new(device: &metal::DeviceRef, library: &metal::LibraryRef) -> Self {
        Self {
            premultiplied: build_path_sprite_pipeline_state(
                device,
                library,
                "surfaces_bgra",
                "surface_vertex",
                "surface_bgra_fragment",
                MTLPixelFormat::BGRA8Unorm,
            ),
            divided: build_pipeline_state(
                device,
                library,
                "surfaces_bgra_divided",
                "surface_vertex",
                "surface_bgra_divided_fragment",
                MTLPixelFormat::BGRA8Unorm,
            ),
            chrome: super::chrome_layers::Chrome::new(device, library), // DeepBuild patch (windoliver/deepbuild#1434)
        }
    }
}

/// The frame's completion, from Metal's completed handler.
pub(super) fn completed(buffer: ptr::NonNull<AnyObject>, frame: Option<u64>) {
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
        (!self.sampled_surfaces.is_empty() && gpu_surfaces::has_hook()).then(|| {
            let frame = gpu_surfaces::next_frame();
            gpu_surfaces::report(gpu_surfaces::Event::Encoded {
                frame,
                surfaces: mem::take(&mut self.sampled_surfaces),
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
        command_encoder: &metal::RenderCommandEncoderRef,
    ) -> bool {
        if CVPixelBufferGetPixelFormatType(image_buffer) == kCVPixelFormatType_32BGRA {
            self.draw_bgra(image_buffer, texture_size, instance, command_encoder);
            command_encoder.set_render_pipeline_state(&self.surfaces_pipeline_state);
            return true;
        }
        false
    }

    /// Draws one BGRA surface and notes its pixel buffer as sampled by the frame being encoded.
    fn draw_bgra(
        &mut self,
        image_buffer: &CVPixelBuffer,
        texture_size: Size<DevicePixels>,
        instance: usize,
        command_encoder: &metal::RenderCommandEncoderRef,
    ) {
        let texture = unsafe {
            let mut texture = ptr::null_mut();
            let status = CVMetalTextureCache::create_texture_from_image(
                None,
                &self.core_video_texture_cache,
                image_buffer,
                None,
                objc2_metal::MTLPixelFormat::BGRA8Unorm,
                CVPixelBufferGetWidth(image_buffer),
                CVPixelBufferGetHeight(image_buffer),
                0,
                ptr::NonNull::from(&mut texture),
            );
            assert_eq!(
                status, kCVReturnSuccess,
                "failed to create CoreVideo Metal texture"
            );
            CFRetained::<CVMetalTexture>::from_raw(
                ptr::NonNull::new(texture).expect("CoreVideo returned a null texture"),
            )
        };
        let pipeline = match gpu_surfaces::planted() {
            gpu_surfaces::Planted::DividesAlpha => &self.bgra_surfaces.divided,
            _ => &self.bgra_surfaces.premultiplied,
        };
        command_encoder.set_render_pipeline_state(pipeline);
        command_encoder.set_vertex_bytes(
            SurfaceInputIndex::TextureSize as u64,
            mem::size_of_val(&texture_size) as u64,
            &texture_size as *const Size<DevicePixels> as *const _,
        );
        command_encoder.set_fragment_texture(SurfaceInputIndex::YTexture as u64, unsafe {
            let texture =
                CVMetalTextureGetTexture(&texture).expect("CoreVideo returned no Metal texture");
            Some(metal::TextureRef::from_ptr(
                objc2::rc::Retained::as_ptr(&texture) as *mut _,
            ))
        });
        command_encoder.draw_primitives_instanced_base_instance(
            metal::MTLPrimitiveType::Triangle,
            0,
            6,
            1,
            instance as u64,
        );
        self.sampled_surfaces
            .push(ptr::from_ref(image_buffer) as usize as u64);
    }
}
