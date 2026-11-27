//! DeepBuild patch (windoliver/deepbuild#499): a video frame's NV12 surface converted by its own
//! colour tags. The stock surface fragment is full-range BT.601 only; a video's frame says its
//! range by its pixel format (`420v` limited, `420f` full) and its matrix by the buffer's
//! `kCVImageBufferYCbCrMatrixKey` attachment (BT.709 when it has none), and this fragment takes
//! both. The planted stock fragment (`gpu_surfaces::Planted::StockFragment`) draws as GPUI ships.

use std::{mem, ptr};

use anyhow::{Context as _, Result};
use gpui::{DevicePixels, Size};
use objc2_core_foundation::CFRetained;
use objc2_core_video::{
    kCVImageBufferYCbCrMatrixKey, kCVImageBufferYCbCrMatrix_ITU_R_2020,
    kCVImageBufferYCbCrMatrix_ITU_R_601_4, kCVPixelFormatType_420YpCbCr8BiPlanarFullRange,
    kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, CVMetalTexture, CVMetalTextureGetTexture, CVPixelBuffer,
    CVPixelBufferGetHeightOfPlane, CVPixelBufferGetPixelFormatType, CVPixelBufferGetWidthOfPlane,
};
use objc2_metal::{MTLDevice, MTLLibrary, MTLPixelFormat, MTLPrimitiveType, MTLRenderCommandEncoder};

use super::bgra_surface::{Pipeline, carried_pipeline, plane_texture};
use super::{MetalRenderer, ProtocolObject, SurfaceInputIndex, gpu_surfaces};

/// The tagged pipeline, blended as GPUI's stock surface pipeline is.
pub(super) fn pipeline(device: &ProtocolObject<dyn MTLDevice>, library: &ProtocolObject<dyn MTLLibrary>) -> Result<Pipeline> {
    let source = Some(objc2_metal::MTLBlendFactor::SourceAlpha);
    carried_pipeline(device, library, "surfaces_ycbcr", "surface_vertex", "surface_ycbcr_fragment", source, true)
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
    /// Draws an NV12 surface by its tags, leaving the encoder as it found it; false when the
    /// stock fragment is planted or the buffer isn't NV12.
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
        let plane = |plane, format| {
            let size = (CVPixelBufferGetWidthOfPlane(image_buffer, plane), CVPixelBufferGetHeightOfPlane(image_buffer, plane));
            plane_texture(&self.core_video_texture_cache, image_buffer, plane, format, size)
        };
        let y_texture = plane(0, MTLPixelFormat::R8Unorm)?;
        let cb_cr_texture = plane(1, MTLPixelFormat::RG8Unorm)?;
        command_encoder.setRenderPipelineState(&self.bgra_surfaces.ycbcr);
        // SAFETY: the size and transform are copied from live values, and both planes match their fragment slots;
        // the frame's completion keeps the CoreVideo textures until the GPU has read them.
        unsafe {
            command_encoder.setVertexBytes_length_atIndex(
                ptr::NonNull::from(&texture_size).cast(),
                mem::size_of_val(&texture_size),
                SurfaceInputIndex::TextureSize as usize,
            );
            command_encoder.setFragmentBytes_length_atIndex(ptr::NonNull::from(&m).cast(), mem::size_of_val(&m), 0);
            for (index, texture) in [
                (SurfaceInputIndex::YTexture, &y_texture),
                (SurfaceInputIndex::CbCrTexture, &cb_cr_texture),
            ] {
                let texture = CVMetalTextureGetTexture(texture).context("CoreVideo returned no Metal texture")?;
                command_encoder.setFragmentTexture_atIndex(Some(&texture), index as usize);
            }
            command_encoder.drawPrimitives_vertexStart_vertexCount_instanceCount_baseInstance(
                MTLPrimitiveType::TriangleStrip,
                0,
                4,
                1,
                instance,
            );
        }
        surface_textures.extend([y_texture, cb_cr_texture]);
        command_encoder.setRenderPipelineState(&self.surfaces_pipeline_state);
        Ok(true)
    }
}
