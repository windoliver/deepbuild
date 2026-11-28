//! DeepBuild patch (windoliver/deepbuild#499): a video frame's NV12 surface converted by its own
//! colour tags. The stock surface fragment is full-range BT.601 only; a video's frame says its
//! range by its pixel format (`420v` limited, `420f` full) and its matrix by the buffer's
//! `kCVImageBufferYCbCrMatrixKey` attachment (BT.709 when it has none), and this fragment takes
//! both. The planted stock fragment (`gpu_surfaces::Planted::StockFragment`) draws as GPUI ships.

use std::{mem, ptr};

use anyhow::{Context as _, Result};
use gpui::{DevicePixels, Size};
use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_core_foundation::CFRetained;
use objc2_core_video::{
    kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_2020,
    kCVImageBufferYCbCrMatrix_ITU_R_601_4, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, kCVReturnSuccess, CVMetalTexture,
    CVMetalTextureCache, CVMetalTextureGetTexture, CVPixelBuffer, CVPixelBufferGetHeightOfPlane,
    CVPixelBufferGetPixelFormatType, CVPixelBufferGetWidthOfPlane,
};
use objc2_metal::{
    MTLDevice, MTLLibrary, MTLPixelFormat, MTLPrimitiveType, MTLRenderCommandEncoder,
    MTLRenderPipelineState,
};

use super::{MetalRenderer, SurfaceInputIndex, build_pipeline_state, gpu_surfaces};

/// The tagged pipeline.
pub(super) fn pipeline(
    device: &ProtocolObject<dyn MTLDevice>,
    library: &ProtocolObject<dyn MTLLibrary>,
) -> Result<Retained<ProtocolObject<dyn MTLRenderPipelineState>>> {
    build_pipeline_state(
        device,
        library,
        "surfaces_ycbcr",
        "surface_vertex",
        "surface_ycbcr_fragment",
        MTLPixelFormat::BGRA8Unorm,
        true,
    )
}

/// The format GPUI's stock surface path asserts a buffer has, `full_range`; with the stock fragment planted, the
/// buffer's own, so that path draws any NV12 as GPUI ships.
pub(super) fn stock_takes(image_buffer: &CVPixelBuffer, full_range: u32) -> u32 {
    if gpu_surfaces::planted() == gpu_surfaces::Planted::StockFragment {
        CVPixelBufferGetPixelFormatType(image_buffer)
    } else {
        full_range
    }
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
    /// Draws an NV12 surface by its tags; false when the stock fragment is planted or the buffer
    /// isn't NV12. The planes' textures join `surface_textures`, which the frame keeps until the GPU
    /// has read them.
    pub(super) fn draw_ycbcr_surface(
        &mut self,
        image_buffer: &CVPixelBuffer,
        texture_size: Size<DevicePixels>,
        instance: usize,
        command_encoder: &ProtocolObject<dyn MTLRenderCommandEncoder>,
        surface_textures: &mut Vec<CFRetained<CVMetalTexture>>,
    ) -> Result<bool> {
        let format = CVPixelBufferGetPixelFormatType(image_buffer);
        let limited = match format {
            f if f == kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange => true,
            f if f == kCVPixelFormatType_420YpCbCr8BiPlanarFullRange => false,
            _ => return Ok(false),
        };
        if gpu_surfaces::planted() == gpu_surfaces::Planted::StockFragment {
            return Ok(false);
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
        let plane_texture = |plane, format| -> Result<CFRetained<CVMetalTexture>> {
            let mut texture = ptr::null_mut();
            // SAFETY: the buffer has two planes of these formats and sizes, and the output pointer is writable.
            let status = unsafe {
                CVMetalTextureCache::create_texture_from_image(
                    None,
                    &self.core_video_texture_cache,
                    image_buffer,
                    None,
                    format,
                    CVPixelBufferGetWidthOfPlane(image_buffer, plane),
                    CVPixelBufferGetHeightOfPlane(image_buffer, plane),
                    plane,
                    ptr::NonNull::from(&mut texture),
                )
            };
            anyhow::ensure!(
                status == kCVReturnSuccess,
                "creating CoreVideo Metal texture for plane {plane}: status {status}"
            );
            let texture = ptr::NonNull::new(texture).context("retrieving CoreVideo Metal texture")?;
            // SAFETY: the successful create call transfers ownership of this non-null texture.
            Ok(unsafe { CFRetained::from_raw(texture) })
        };
        let y_texture = plane_texture(0, MTLPixelFormat::R8Unorm)?;
        let cb_cr_texture = plane_texture(1, MTLPixelFormat::RG8Unorm)?;
        let y_metal = CVMetalTextureGetTexture(&y_texture).context("retrieving luma Metal texture")?;
        let cb_cr_metal =
            CVMetalTextureGetTexture(&cb_cr_texture).context("retrieving chroma Metal texture")?;
        command_encoder.setRenderPipelineState(&self.bgra_surfaces.ycbcr);
        // SAFETY: Metal copies the size and the transform, which match the shaders' arguments at these
        // slots; both planes match their texture slots, and `surface_textures` keeps their CoreVideo
        // wrappers until the GPU has read them. The draw is one instance of the uploaded surfaces.
        unsafe {
            command_encoder.setVertexBytes_length_atIndex(
                ptr::NonNull::from(&texture_size).cast(),
                mem::size_of_val(&texture_size),
                SurfaceInputIndex::TextureSize as usize,
            );
            command_encoder.setFragmentBytes_length_atIndex(
                ptr::NonNull::from(&m).cast(),
                mem::size_of_val(&m),
                0,
            );
            command_encoder
                .setFragmentTexture_atIndex(Some(&y_metal), SurfaceInputIndex::YTexture as usize);
            command_encoder.setFragmentTexture_atIndex(
                Some(&cb_cr_metal),
                SurfaceInputIndex::CbCrTexture as usize,
            );
            command_encoder.drawPrimitives_vertexStart_vertexCount_instanceCount_baseInstance(
                MTLPrimitiveType::TriangleStrip,
                0,
                4,
                1,
                instance,
            );
        }
        surface_textures.extend([y_texture, cb_cr_texture]);
        Ok(true)
    }
}
