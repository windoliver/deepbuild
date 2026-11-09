//! `--color-check` (#140): every layer the app presents through, read back and asked its colorspace.

use std::{cell::RefCell, rc::Rc};

use deep_app::color;
use deep_gpu::device::{Backend, Gpu};
use deep_gpu::surface::{allocate, Handoff, Path, Shown};
use gpui_apple::metal_renderer::layer_colorspace;
use gpui_kit::*;
use objc2::rc::Retained;
use objc2_app_kit::{NSView, NSWindowOcclusionState};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_quartz_core::CAMetalLayer;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use serde_json::{json, Value};

/// A swatch's side in points, and the step between swatches.
const SIDE: f32 = 48.;
const STEP: f32 = 56.;
/// The wgpu surface's swatches, in pixels.
const CELL: u32 = 16;

/// The look's status colors as sRGB-encoded bytes, in the look's order.
fn statuses() -> Vec<(String, [u8; 3])> {
    let look = deep_canvas_marks::look::shipped("clean").expect("the shipped look");
    let byte = |hex: &str, i: usize| u8::from_str_radix(&hex[i..i + 2], 16).expect("hex");
    look["status"]
        .as_object()
        .expect("the look's status map")
        .iter()
        .filter_map(|(status, hex)| {
            let hex = hex.as_str()?.strip_prefix('#')?;
            Some((status.clone(), [byte(hex, 0), byte(hex, 2), byte(hex, 4)]))
        })
        .collect()
}

/// One GPU-layer slot per status, rendered by wgpu and handed to GPUI on the copy path.
fn slots(statuses: &[(String, [u8; 3])]) -> Vec<(Box<dyn Handoff>, Shown)> {
    let gpu = Gpu::open(Backend::Gpu).expect("the GPU");
    let device = gpu.device();
    statuses
        .iter()
        .map(|(_, [r, g, b])| {
            let slot = allocate(&device, Path::Copy, [96, 96]).expect("a slot");
            let mut encoder = device.device.create_command_encoder(&Default::default());
            encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: slot.target(),
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color {
                            r: f64::from(*r) / 255.,
                            g: f64::from(*g) / 255.,
                            b: f64::from(*b) / 255.,
                            a: 1.,
                        }),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                ..Default::default()
            });
            slot.after_render(&mut encoder);
            device.queue.submit([encoder.finish()]);
            slot.finish(&device).expect("the slot's read back");
            let shown = slot.shown();
            (slot, shown)
        })
        .collect()
}

struct Swatches {
    shown: Vec<Shown>,
    placed: Rc<RefCell<Vec<Bounds<Pixels>>>>,
}

impl Render for Swatches {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let (shown, placed) = (self.shown.clone(), self.placed.clone());
        canvas(
            |_, _, _| (),
            move |bounds, _, window, _| {
                let mut placed = placed.borrow_mut();
                placed.clear();
                for (i, slot) in shown.iter().enumerate() {
                    let at = point(
                        bounds.origin.x + px(16. + STEP * i as f32),
                        bounds.origin.y + px(16.),
                    );
                    let swatch = Bounds::new(at, size(px(SIDE), px(SIDE)));
                    window.paint_surface(swatch, slot.clone());
                    placed.push(swatch);
                }
            },
        )
        .size_full()
    }
}

pub fn run(wgpu_untagged: bool, cx: &mut App) {
    let statuses = statuses();
    let slots = slots(&statuses);
    let shown = slots.iter().map(|(_, s)| s.clone()).collect();
    let placed = Rc::new(RefCell::new(Vec::new()));
    // Above every other window, so the platform reports it visible and hands out drawables.
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::centered(size(px(560.), px(160.)), cx)),
        kind: WindowKind::PopUp,
        ..Default::default()
    };
    open_window(options, cx, move |window, cx| {
        let painted = placed.clone();
        visible(window, 0, move |window, cx| {
            let _slots = slots;
            check(window, cx, statuses, painted, wgpu_untagged)
        });
        cx.new(|_| Swatches { shown, placed })
    })
    .expect("open the window");
    cx.activate(true);
}

/// Runs `then` on the first frame after AppKit reports the window visible, or after 2 s of
/// frames when it never does.
fn visible(window: &mut Window, frames: u32, then: impl FnOnce(&mut Window, &mut App) + 'static) {
    window.on_next_frame(move |window, cx| {
        let shown = window_view(window)
            .window()
            .is_some_and(|w| w.occlusionState().contains(NSWindowOcclusionState::Visible));
        if shown || frames > 240 {
            then(window, cx);
        } else {
            window.refresh();
            visible(window, frames + 1, then);
        }
    });
}

fn window_view(window: &Window) -> &NSView {
    let handle = HasWindowHandle::window_handle(window).expect("the window's handle");
    let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
        panic!("an AppKit window");
    };
    // SAFETY: gpui's AppKit handle wraps its NSView, alive while the gpui window is.
    unsafe { handle.ns_view.cast::<NSView>().as_ref() }
}

/// The window's own CAMetalLayer: the layer GPUI's view hosts.
fn window_layer(window: &Window) -> Retained<CAMetalLayer> {
    let layer = window_view(window).layer().expect("the view's layer");
    layer.downcast::<CAMetalLayer>().expect("a CAMetalLayer")
}

/// A surface wgpu configures on a layer of its own inside the window's, each status drawn
/// into its drawable and read back from it before it is presented.
fn wgpu_swatches(
    window_layer: &CAMetalLayer,
    statuses: &[(String, [u8; 3])],
    untagged: bool,
) -> (Retained<CAMetalLayer>, Vec<[u8; 3]>) {
    let (width, height) = (CELL * statuses.len() as u32, CELL);
    let layer = CAMetalLayer::new();
    layer.setFrame(CGRect::new(
        CGPoint::new(16., 80.),
        CGSize::new(f64::from(width), f64::from(height)),
    ));
    window_layer.addSublayer(&layer);
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::METAL,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    // SAFETY: the layer outlives the surface: both are dropped before this returns, the
    // layer kept retained by the window's layer.
    let surface = unsafe {
        instance.create_surface_unsafe(wgpu::SurfaceTargetUnsafe::CoreAnimationLayer(
            Retained::as_ptr(&layer).cast_mut().cast(),
        ))
    }
    .expect("a surface on the layer");
    let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
        compatible_surface: Some(&surface),
        ..Default::default()
    }))
    .expect("an adapter");
    let (device, queue) =
        pollster::block_on(adapter.request_device(&Default::default())).expect("a device");
    let config = wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT
            | wgpu::TextureUsages::COPY_SRC
            | wgpu::TextureUsages::COPY_DST,
        format: wgpu::TextureFormat::Bgra8Unorm,
        color_space: wgpu::SurfaceColorSpace::Srgb,
        width,
        height,
        present_mode: wgpu::PresentMode::Fifo,
        desired_maximum_frame_latency: 2,
        alpha_mode: wgpu::CompositeAlphaMode::Opaque,
        view_formats: vec![],
    };
    if untagged {
        surface.configure(&device, &config);
    } else {
        color::configure(&surface, &device, &config, &layer);
    }
    let row = (width * 4).next_multiple_of(wgpu::COPY_BYTES_PER_ROW_ALIGNMENT);
    let mut pixels = vec![0u8; (row * height) as usize];
    for y in 0..height {
        for x in 0..width {
            let [r, g, b] = statuses[(x / CELL) as usize].1;
            let at = (y * row + x * 4) as usize;
            pixels[at..at + 4].copy_from_slice(&[b, g, r, 255]);
        }
    }
    let layout = wgpu::TexelCopyBufferLayout {
        offset: 0,
        bytes_per_row: Some(row),
        rows_per_image: Some(height),
    };
    let buffer = |usage, contents: Option<&[u8]>| {
        let b = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("color check"),
            size: u64::from(row * height),
            usage,
            mapped_at_creation: contents.is_some(),
        });
        if let Some(contents) = contents {
            b.slice(..)
                .get_mapped_range_mut()
                .expect("the upload's mapping")
                .copy_from_slice(contents);
            b.unmap();
        }
        b
    };
    let upload = buffer(wgpu::BufferUsages::COPY_SRC, Some(&pixels));
    let readback = buffer(
        wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        None,
    );
    // A window that stays occluded (a closed lid, another Space) gets no drawable, so
    // nothing can be read back and the check says why and fails.
    let frame = match surface.get_current_texture() {
        wgpu::CurrentSurfaceTexture::Success(frame)
        | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => frame,
        other => {
            println!(
                "{}",
                json!({"color": 140, "error": format!("no drawable: {other:?}")})
            );
            std::process::exit(1);
        }
    };
    let extent = wgpu::Extent3d {
        width,
        height,
        depth_or_array_layers: 1,
    };
    let mut encoder = device.create_command_encoder(&Default::default());
    encoder.copy_buffer_to_texture(
        wgpu::TexelCopyBufferInfo {
            buffer: &upload,
            layout,
        },
        frame.texture.as_image_copy(),
        extent,
    );
    encoder.copy_texture_to_buffer(
        frame.texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &readback,
            layout,
        },
        extent,
    );
    queue.submit([encoder.finish()]);
    queue.present(frame);
    readback.slice(..).map_async(wgpu::MapMode::Read, |_| {});
    device
        .poll(wgpu::PollType::wait_indefinitely())
        .expect("the read back");
    let data = readback
        .slice(..)
        .get_mapped_range()
        .expect("the read back's mapping");
    let read = (0..statuses.len() as u32)
        .map(|i| {
            let at = ((CELL / 2) * row + (i * CELL + CELL / 2) * 4) as usize;
            [data[at + 2], data[at + 1], data[at]]
        })
        .collect();
    (layer, read)
}

fn check(
    window: &mut Window,
    cx: &mut App,
    statuses: Vec<(String, [u8; 3])>,
    placed: Rc<RefCell<Vec<Bounds<Pixels>>>>,
    wgpu_untagged: bool,
) {
    let gpui_layer = window_layer(window);
    let (wgpu_layer, wgpu_read) = wgpu_swatches(&gpui_layer, &statuses, wgpu_untagged);
    layer_colorspace::read_next_frame();
    window.refresh();
    let scale = window.scale_factor();
    read_back(window, cx, 0, move |frame, cx| {
        let mut swatches: Vec<Value> = Vec::new();
        let placed = placed.borrow();
        for (i, (status, _)) in statuses.iter().enumerate() {
            let read = placed.get(i).and_then(|b| {
                let center = b.center();
                let x = (f32::from(center.x) * scale) as u32;
                let y = (f32::from(center.y) * scale) as u32;
                frame
                    .as_ref()?
                    .get_pixel_checked(x, y)
                    .map(|p| [p[0], p[1], p[2]])
            });
            swatches.push(json!({"layer": "window", "status": status, "read": read}));
            swatches.push(json!({"layer": "wgpu-surface", "status": status, "read": wgpu_read[i]}));
        }
        let report = json!({
            "color": 140,
            "backend": {"name": color::BACKEND.0, "version": color::BACKEND.1},
            "layers": [
                {"layer": "window", "owner": "gpui", "colorspace": color::colorspace(&gpui_layer)},
                {"layer": "wgpu-surface", "owner": "wgpu", "colorspace": color::colorspace(&wgpu_layer)},
            ],
            "swatches": swatches,
        });
        println!("{report}");
        cx.quit();
    });
}

/// Waits for the frame the window draws next to be read back from its layer's drawable.
fn read_back(
    window: &mut Window,
    _: &mut App,
    tries: u32,
    done: impl FnOnce(Option<image::RgbaImage>, &mut App) + 'static,
) {
    window.on_next_frame(move |window, cx| match layer_colorspace::take_frame() {
        Some(frame) => done(Some(frame), cx),
        None if tries < 120 => {
            window.refresh();
            read_back(window, cx, tries + 1, done);
        }
        None => done(None, cx),
    });
}
