//! Issue #177 (canvas primitives: GPU surface: HDR output; reports/177.md, the layer stack): a
//! live 3D view's HDR surface on macOS. GPUI owns the window's layer, so the HDR surface is a
//! `CAMetalLayer` of its own beneath GPUI's, in the content view's layer, configured through wgpu's
//! surface color space as RGBA16Float in extended linear sRGB with EDR on. GPUI leaves the view's
//! region clear (`gpu_view::paint_clear`), so the shell, the card, overlays, text and status
//! colors draw above it at their exact SDR colors. The UI thread places the layer at the view's
//! rect in the same frame GPUI draws the clear region, with implicit animation off, so a resize
//! moves both in one Core Animation transaction. The display's EDR headroom is read here, on the
//! UI thread, when the surface first shows and when the app hears the display changed.

use std::ffi::c_void;

use objc2::rc::Retained;
use objc2::ClassType;
use objc2_app_kit::NSView;
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_quartz_core::{CALayer, CAMetalLayer, CATransaction};

/// The HDR surface's layer and its wgpu surface.
pub struct HdrLayer {
    layer: Retained<CAMetalLayer>,
    pub surface: wgpu::Surface<'static>,
}

// SAFETY: the layer is only touched on the UI thread (placing and removing it); the render thread
// uses only the wgpu surface, which wgpu makes safe to configure and acquire from another thread.
unsafe impl Send for HdrLayer {}
unsafe impl Sync for HdrLayer {}

/// The HDR surface's format and color space (Fields: `surface`).
pub const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

impl HdrLayer {
    /// A layer beneath `gpui_view`'s layer, in its superview's, with a surface on `instance`.
    pub fn beneath(gpui_view: &NSView, instance: &wgpu::Instance) -> Result<HdrLayer, String> {
        // SAFETY: AppKit calls on the UI thread, where the window's views live.
        let (host, gpui) = unsafe {
            let content = gpui_view
                .superview()
                .ok_or("the GPUI view has no superview")?;
            content.setWantsLayer(true);
            let host = content.layer().ok_or("the content view has no layer")?;
            let gpui = gpui_view.layer().ok_or("the GPUI view has no layer")?;
            (host, gpui)
        };
        HdrLayer::in_layer(&host, Some(&gpui), gpui.contentsScale(), instance)
    }

    /// A layer in `host`, beneath `below` or on top of its sublayers, with a surface.
    fn in_layer(
        host: &CALayer,
        below: Option<&CALayer>,
        scale: f64,
        instance: &wgpu::Instance,
    ) -> Result<HdrLayer, String> {
        let layer = CAMetalLayer::new();
        layer.setOpaque(true);
        layer.setContentsScale(scale);
        layer.setContentsGravity(unsafe { objc2_quartz_core::kCAGravityResize });
        match below {
            Some(b) => host.insertSublayer_below(&layer, Some(b)),
            None => host.addSublayer(&layer),
        }
        // SAFETY: the layer outlives the surface: both live in this struct, the surface dropped
        // first, and the layer is a CAMetalLayer.
        let surface = unsafe {
            instance.create_surface_unsafe(wgpu::SurfaceTargetUnsafe::CoreAnimationLayer(
                Retained::as_ptr(&layer) as *mut c_void,
            ))
        }
        .map_err(|e| format!("the HDR surface: {e}"))?;
        Ok(HdrLayer { layer, surface })
    }

    /// Configures the surface at `size` device px; `read` lets a frame be copied out.
    pub fn configure(&self, device: &wgpu::Device, size: [u32; 2], read: bool) {
        let mut usage = wgpu::TextureUsages::RENDER_ATTACHMENT;
        if read {
            usage |= wgpu::TextureUsages::COPY_SRC;
        }
        self.surface.configure(
            device,
            &wgpu::SurfaceConfiguration {
                usage,
                format: FORMAT,
                color_space: wgpu::SurfaceColorSpace::ExtendedSrgbLinear,
                width: size[0].max(1),
                height: size[1].max(1),
                present_mode: wgpu::PresentMode::Fifo,
                desired_maximum_frame_latency: 2,
                alpha_mode: wgpu::CompositeAlphaMode::Opaque,
                view_formats: Vec::new(),
            },
        );
    }

    /// Places the layer at `rect` (points, from the GPUI view's top left) with no animation.
    pub fn place(&self, gpui_view: &NSView, rect: [f64; 4]) {
        let Some(gpui) = gpui_view.layer() else {
            return;
        };
        let g = gpui.frame();
        let y = if self.host_flipped() {
            g.origin.y + rect[1]
        } else {
            g.origin.y + g.size.height - rect[1] - rect[3]
        };
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        self.layer.setFrame(CGRect::new(
            CGPoint::new(g.origin.x + rect[0], y),
            CGSize::new(rect[2], rect[3]),
        ));
        CATransaction::commit();
    }

    fn host_flipped(&self) -> bool {
        self.layer
            .superlayer()
            .is_some_and(|s| s.isGeometryFlipped())
    }

    /// Takes the layer out of the window: the view closed, or HDR went off.
    pub fn remove(&self) {
        self.layer.removeFromSuperlayer();
    }

    pub fn is(&self, layer: &CALayer) -> bool {
        std::ptr::eq(
            Retained::as_ptr(&self.layer).cast::<c_void>(),
            std::ptr::from_ref(layer).cast::<c_void>(),
        )
    }
}

/// The display's EDR headroom under `view`: its potential and its current, which reads 1 until
/// something on screen asks for EDR. 1 with no screen.
pub fn headroom(view: &NSView) -> (f32, f32) {
    let Some(screen) = view.window().and_then(|w| w.screen()) else {
        return (1.0, 1.0);
    };
    (
        screen.maximumPotentialExtendedDynamicRangeColorComponentValue() as f32,
        screen.maximumExtendedDynamicRangeColorComponentValue() as f32,
    )
}

/// Calls `changed` on the UI thread whenever the app hears the displays changed, which AppKit
/// posts when a display's EDR headroom changes (brightness, another display, battery).
pub fn on_display_change(
    changed: impl Fn() + 'static,
) -> Retained<objc2::runtime::ProtocolObject<dyn objc2_foundation::NSObjectProtocol>> {
    use block2::RcBlock;
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSOperationQueue};
    let block = RcBlock::new(move |_: std::ptr::NonNull<NSNotification>| changed());
    // SAFETY: the name is AppKit's static, and the block runs on the main queue.
    unsafe {
        let name = objc2_app_kit::NSApplicationDidChangeScreenParametersNotification;
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(name),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        )
    }
}

/// One Metal layer of a window, as it reports itself.
#[derive(Clone, Debug)]
pub struct LayerRow {
    pub owner: &'static str,
    pub format: String,
    pub colorspace: Option<String>,
    pub edr: bool,
    pub opaque: bool,
}

/// The window's Metal layers bottom to top: GPUI's, the HDR layer, and any other.
pub fn layers(gpui_view: &NSView, hdr: Option<&HdrLayer>) -> Vec<LayerRow> {
    let gpui = gpui_view.layer();
    let root = unsafe { gpui_view.superview().and_then(|s| s.layer()) }.or(gpui.clone());
    let mut out = Vec::new();
    let Some(root) = root else { return out };
    walk(&root, &mut |l| {
        if !objc2_foundation::NSObjectProtocol::isKindOfClass(l, CAMetalLayer::class()) {
            return;
        }
        // SAFETY: checked to be a CAMetalLayer above.
        let metal: &CAMetalLayer = unsafe { &*std::ptr::from_ref(l).cast::<CAMetalLayer>() };
        let owner = if gpui.as_deref().is_some_and(|g| std::ptr::eq(g, l)) {
            "gpui"
        } else if hdr.is_some_and(|h| h.is(l)) {
            "hdr"
        } else {
            "other"
        };
        let format = match metal.pixelFormat().0 {
            80 => "BGRA8Unorm".to_string(),
            81 => "BGRA8Unorm_sRGB".to_string(),
            115 => "RGBA16Float".to_string(),
            n => format!("MTLPixelFormat({n})"),
        };
        let colorspace = metal
            .colorspace()
            .and_then(|c| objc2_core_graphics::CGColorSpace::name(Some(&c)).map(|n| n.to_string()));
        out.push(LayerRow {
            owner,
            format,
            colorspace,
            edr: metal.wantsExtendedDynamicRangeContent(),
            opaque: metal.isOpaque(),
        });
    });
    out
}

/// Each layer before its sublayers, sublayers in order: bottom to top.
fn walk(layer: &CALayer, f: &mut impl FnMut(&CALayer)) {
    f(layer);
    // SAFETY: the layer tree is read on the UI thread, which owns it.
    if let Some(subs) = unsafe { layer.sublayers() } {
        for s in subs.iter() {
            walk(&s, f);
        }
    }
}

/// A borderless window over the main display whose content is an HDR layer: the combined
/// envelope's screen, so its scene presents through the display's real EDR (#177, criterion 5).
pub struct ScreenLayer {
    _window: Retained<objc2_app_kit::NSWindow>,
    pub layer: HdrLayer,
    /// The layer's size in device px.
    pub size: [u32; 2],
    screen: Retained<objc2_app_kit::NSScreen>,
}

impl ScreenLayer {
    /// On the main thread: the window over the main display, shown above everything.
    pub fn main(instance: &wgpu::Instance) -> Result<ScreenLayer, String> {
        use objc2_app_kit::{
            NSApplication, NSBackingStoreType, NSScreen, NSWindow, NSWindowStyleMask,
        };
        let mtm =
            objc2::MainThreadMarker::new().ok_or("the screen's window needs the main thread")?;
        let _app = NSApplication::sharedApplication(mtm);
        let screen = NSScreen::mainScreen(mtm).ok_or("no main display")?;
        let frame = screen.frame();
        let scale = screen.backingScaleFactor();
        // SAFETY: AppKit calls on the main thread.
        let window = unsafe {
            NSWindow::initWithContentRect_styleMask_backing_defer(
                mtm.alloc(),
                frame,
                NSWindowStyleMask::Borderless,
                NSBackingStoreType::Buffered,
                false,
            )
        };
        unsafe { window.setReleasedWhenClosed(false) };
        window.setLevel(objc2_app_kit::NSScreenSaverWindowLevel);
        let content = window
            .contentView()
            .ok_or("the window has no content view")?;
        content.setWantsLayer(true);
        let host = content.layer().ok_or("the content view has no layer")?;
        let layer = HdrLayer::in_layer(&host, None, scale, instance)?;
        CATransaction::begin();
        CATransaction::setDisableActions(true);
        layer.layer.setFrame(host.bounds());
        CATransaction::commit();
        window.orderFrontRegardless();
        CATransaction::flush();
        let size = [
            (frame.size.width * scale).round() as u32,
            (frame.size.height * scale).round() as u32,
        ];
        Ok(ScreenLayer {
            _window: window,
            layer,
            size,
            screen,
        })
    }

    /// The main display's potential and current EDR headroom.
    pub fn headroom(&self) -> (f32, f32) {
        (
            self.screen
                .maximumPotentialExtendedDynamicRangeColorComponentValue() as f32,
            self.screen.maximumExtendedDynamicRangeColorComponentValue() as f32,
        )
    }
}
