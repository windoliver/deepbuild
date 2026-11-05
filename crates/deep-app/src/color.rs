//! Issue #140: the color output seam's macOS backend (canvas primitives: Seam and backend). Every
//! Metal layer the app presents through holds sRGB-encoded BGRA8 and is tagged sRGB, so the
//! compositor never reinterprets it: the window's layer by the GPUI patch, and a surface wgpu
//! configures here, since wgpu leaves a layer configured with its `Srgb` color space untagged.

use objc2_core_graphics::CGColorSpace;
use objc2_quartz_core::CAMetalLayer;

pub const BACKEND: (&str, &str) = ("color.srgb-macos", "1.0.0");

/// Configures `surface` on `layer` with wgpu's `Srgb` color space, then tags the layer sRGB.
pub fn configure(
    surface: &wgpu::Surface<'_>,
    device: &wgpu::Device,
    config: &wgpu::SurfaceConfiguration,
    layer: &CAMetalLayer,
) {
    surface.configure(
        device,
        &wgpu::SurfaceConfiguration {
            color_space: wgpu::SurfaceColorSpace::Srgb,
            ..config.clone()
        },
    );
    tag(layer);
}

/// Tags `layer`'s contents sRGB.
pub fn tag(layer: &CAMetalLayer) {
    // SAFETY: a constant CoreGraphics exports.
    let srgb = CGColorSpace::with_name(Some(unsafe { objc2_core_graphics::kCGColorSpaceSRGB }));
    layer.setColorspace(srgb.as_deref());
}

/// The name of the colorspace `layer` reports, as the layer itself gives it, or `None` for nil.
pub fn colorspace(layer: &CAMetalLayer) -> Option<String> {
    let space = layer.colorspace()?;
    CGColorSpace::name(Some(&space)).map(|name| name.to_string())
}
