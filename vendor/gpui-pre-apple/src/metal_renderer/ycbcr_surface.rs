//! DeepBuild patch (windoliver/deepbuild#499): a video frame's NV12 surface converted by its own
//! colour tags. The stock surface fragment is full-range BT.601 only; a video's frame says its
//! range by its pixel format (`420v` limited, `420f` full) and its matrix by the buffer's
//! `kCVImageBufferYCbCrMatrixKey` attachment (BT.709 when it has none), and this fragment takes
//! both. The planted stock fragment (`gpu_surfaces::Planted::StockFragment`) draws as GPUI ships.

use std::{mem, ptr};

use foreign_types::ForeignTypeRef;
use gpui::{DevicePixels, Size};
use objc2_core_foundation::CFRetained;
use objc2_core_video::{
    kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_2020,
    kCVImageBufferYCbCrMatrix_ITU_R_601_4, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, kCVReturnSuccess, CVMetalTexture,
    CVMetalTextureCache, CVMetalTextureGetTexture, CVPixelBuffer, CVPixelBufferGetHeightOfPlane,
    CVPixelBufferGetPixelFormatType, CVPixelBufferGetWidthOfPlane,
};

use super::{MTLPixelFormat, MetalRenderer, SurfaceInputIndex, build_pipeline_state, gpu_surfaces};

/// The tagged pipeline.
pub(super) fn pipeline(device: &metal::DeviceRef, library: &metal::LibraryRef) -> metal::RenderPipelineState {
    build_pipeline_state(
        device,
        library,
        "surfaces_ycbcr",
        "surface_vertex",
        "surface_ycbcr_fragment",
        MTLPixelFormat::BGRA8Unorm,
    )
}

/// The column-major transform from (Y, Cb, Cr, 1), each read as 0..1, to R'G'B'.
fn transform(limited: bool, kr: f32, kb: f32) -> [[f32; 4]; 4] {
    let kg = 1.0 - kr - kb;
    let (yo, ys, cs) = if limited {
        (16.0 / 255.0, 255.0 / 219.0, 255.0 / 224.0)
    } else {
        (0.0, 1.0, 1.0)
    };
    let r_cr = 2.0 * (1.0 - kr) * cs;
    let b_cb = 2.0 * (1.0 - kb) * cs;
    let g_cb = -2.0 * kb * (1.0 - kb) / kg * cs;
    let g_cr = -2.0 * kr * (1.0 - kr) / kg * cs;
    let c0 = 128.0 / 255.0;
    [
        [ys, ys, ys, 0.0],
        [0.0, g_cb, b_cb, 0.0],
        [r_cr, g_cr, 0.0, 0.0],
        [
            -yo * ys - c0 * r_cr,
            -yo * ys - c0 * (g_cb + g_cr),
            -yo * ys - c0 * b_cb,
            1.0,
        ],
    ]
}

impl MetalRenderer {
    /// Draws an NV12 surface by its tags, leaving the encoder as it found it; false when the
    /// stock fragment is planted or the buffer isn't NV12.
    pub(super) fn draw_ycbcr_surface(
        &mut self,
        image_buffer: &CVPixelBuffer,
        texture_size: Size<DevicePixels>,
        instance: usize,
        command_encoder: &metal::RenderCommandEncoderRef,
    ) -> bool {
        let format = CVPixelBufferGetPixelFormatType(image_buffer);
        let limited = match format {
            f if f == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange => true,
            f if f == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange => false,
            _ => return false,
        };
        if gpu_surfaces::planted() == gpu_surfaces::Planted::StockFragment {
            return false;
        }
        // SAFETY: the key is CoreVideo's own; the mode pointer may be null.
        let matrix = unsafe { image_buffer.attachment(kCVImageBufferYCbCrMatrixKey, ptr::null_mut()) };
        let is = |key: &objc2_core_foundation::CFString| {
            matrix.as_ref().is_some_and(|m| {
                ptr::eq(
                    CFRetained::as_ptr(m).as_ptr() as *const u8,
                    key as *const _ as *const u8,
                )
            })
        };
        // SAFETY: CoreVideo's constants live for the process.
        let (kr, kb) = unsafe {
            if is(kCVImageBufferYCbCrMatrix_ITU_R_601_4) {
                (0.299, 0.114)
            } else if is(kCVImageBufferYCbCrMatrix_ITU_R_2020) {
                (0.2627, 0.0593)
            } else {
                (0.2126, 0.0722)
            }
        };
        let m = transform(limited, kr, kb);
        let plane_texture = |plane, format| unsafe {
            let mut texture = ptr::null_mut();
            let status = CVMetalTextureCache::create_texture_from_image(
                None,
                &self.core_video_texture_cache,
                image_buffer,
                None,
                format,
                CVPixelBufferGetWidthOfPlane(image_buffer, plane),
                CVPixelBufferGetHeightOfPlane(image_buffer, plane),
                plane,
                ptr::NonNull::from(&mut texture),
            );
            assert_eq!(status, kCVReturnSuccess, "failed to create CoreVideo Metal texture");
            CFRetained::<CVMetalTexture>::from_raw(
                ptr::NonNull::new(texture).expect("CoreVideo returned a null texture"),
            )
        };
        let y_texture = plane_texture(0, objc2_metal::MTLPixelFormat::R8Unorm);
        let cb_cr_texture = plane_texture(1, objc2_metal::MTLPixelFormat::RG8Unorm);
        command_encoder.set_render_pipeline_state(&self.ycbcr_pipeline_state);
        command_encoder.set_vertex_bytes(
            SurfaceInputIndex::TextureSize as u64,
            mem::size_of_val(&texture_size) as u64,
            &texture_size as *const Size<DevicePixels> as *const _,
        );
        command_encoder.set_fragment_bytes(0, mem::size_of_val(&m) as u64, m.as_ptr() as *const _);
        for (index, texture) in [
            (SurfaceInputIndex::YTexture, &y_texture),
            (SurfaceInputIndex::CbCrTexture, &cb_cr_texture),
        ] {
            command_encoder.set_fragment_texture(index as u64, unsafe {
                let texture = CVMetalTextureGetTexture(texture).expect("CoreVideo returned no Metal texture");
                Some(metal::TextureRef::from_ptr(
                    objc2::rc::Retained::as_ptr(&texture) as *mut _,
                ))
            });
        }
        command_encoder.draw_primitives_instanced_base_instance(
            metal::MTLPrimitiveType::Triangle,
            0,
            6,
            1,
            instance as u64,
        );
        command_encoder.set_render_pipeline_state(&self.surfaces_pipeline_state);
        true
    }
}
