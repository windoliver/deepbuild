//! The window a scenario draws (README: The window and window capture): headless, at scale 1,
//! through GPUI's offscreen Metal renderer. GPUI paints the 2D page over the whole window, the
//! GPU-layer view over it through the handoff, and the shell's question card last when there is
//! one. A capture is that renderer's image of the whole window.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use deep_gpu::ring::SlotState;
use deep_gpu::view::Ui;
use gpui_kit::*;

/// The shell's question card in its slot.
#[derive(Clone, Debug)]
pub struct Card {
    pub question: String,
    pub options: Vec<String>,
    pub rect: [f32; 4],
}

/// A page picture's cell, colors and size.
type PageKey = (u32, Vec<[u8; 3]>, [u32; 2]);

/// What the next frame draws.
pub struct Paint {
    pub page: (u32, Vec<[u8; 3]>),
    pub view: [u32; 2],
    pub size: [u32; 2],
    /// The GPU-layer view, unless the call draws the page alone.
    pub ui: Option<Ui>,
    pub card: Option<Card>,
    /// The planted UI thread that waits on the frame's `gpu_done` fence.
    pub waits_on_gpu: bool,
    /// What the last present's paints spent on the GPU layer on the UI thread, and the frame it
    /// showed.
    pub ui_time: Duration,
    pub shown: Option<u64>,
    /// A 3D view's 2D writer layers anchored to its items (#378), by the frame whose evaluated
    /// data placed them: each present draws those of the `frame_seq` its shown slot carries.
    pub overlays: BTreeMap<u64, Vec<OverlayPicture>>,
    /// The frame latched last.
    pub current: u64,
    /// The planted composer that draws the current frame's 2D layers over whatever slot shows.
    pub pairs_newest: bool,
    /// A plug-in's panel script view in its header strip, `[x, y, w, h]` (#380).
    pub panel: Option<(AnyView, [f32; 4])>,
    /// Pictures over the whole window under the view and over it: GPUI's 2D writer layers and
    /// the status marks, around a 2D layer on the GPU layer (#385).
    pub pictures: [Vec<Arc<RenderImage>>; 2],
    /// The page as one picture, made once per page and window size.
    picture: Option<(PageKey, Arc<RenderImage>)>,
}

struct Root {
    paint: Rc<RefCell<Paint>>,
}

fn rgb(c: [u8; 3]) -> Hsla {
    Rgba {
        r: f32::from(c[0]) / 255.,
        g: f32::from(c[1]) / 255.,
        b: f32::from(c[2]) / 255.,
        a: 1.,
    }
    .into()
}

fn rect(x: f32, y: f32, w: f32, h: f32) -> Bounds<Pixels> {
    Bounds {
        origin: point(px(x), px(y)),
        size: size(px(w), px(h)),
    }
}

/// The checker page: cell (0, 0) the first color, alternating in x and y. GPUI paints it as one
/// picture rather than a quad per cell.
fn page_picture(cell: u32, colors: &[[u8; 3]], size: [u32; 2]) -> Option<Arc<RenderImage>> {
    let mut bgra = Vec::with_capacity((size[0] * size[1] * 4) as usize);
    for y in 0..size[1] {
        for x in 0..size[0] {
            let [r, g, b] = colors[((x / cell + y / cell) as usize) % colors.len()];
            bgra.extend_from_slice(&[b, g, r, 255]);
        }
    }
    let frame = image::RgbaImage::from_raw(size[0], size[1], bgra)?;
    Some(Arc::new(RenderImage::new([image::Frame::new(frame)])))
}

fn paint_page(p: &mut Paint, bounds: Bounds<Pixels>, window: &mut Window) {
    let (cell, colors) = p.page.clone();
    if colors.is_empty() {
        return;
    }
    let size = [
        f32::from(bounds.size.width) as u32,
        f32::from(bounds.size.height) as u32,
    ];
    let key = (cell, colors, size);
    if p.picture.as_ref().is_none_or(|(k, _)| *k != key) {
        p.picture = page_picture(key.0.max(1), &key.1, size).map(|pic| (key, pic));
    }
    if let Some((_, pic)) = &p.picture {
        let _ = window.paint_image(bounds, bounds, Corners::default(), pic.clone(), 0, false);
    }
}

/// The view's part of the frame, timed: the latch and the paint call (and, planted, the wait).
#[cfg(target_os = "macos")]
fn paint_view(p: &mut Paint, ui: &Ui, window: &mut Window) {
    let started = Instant::now();
    if p.waits_on_gpu {
        // The wrong program: while a frame is in flight, the UI thread holds until its `gpu_done`
        // fence signals, checking between short sleeps so the render thread can mark it.
        while ui.states().contains(&SlotState::Rendering)
            && started.elapsed() < Duration::from_secs(5)
        {
            std::thread::sleep(Duration::from_micros(50));
        }
    }
    let bounds = rect(
        p.view[0] as f32,
        p.view[1] as f32,
        p.size[0] as f32,
        p.size[1] as f32,
    );
    p.shown = deep_app::gpu_view::paint(ui, bounds, window);
    p.ui_time += started.elapsed();
}

/// A 2D overlay's picture on a whole pixel of the view, its sub-pixel phase in its raster.
pub struct OverlayPicture {
    pub at: [i64; 2],
    pub size: [u16; 2],
    pub image: Arc<RenderImage>,
}

/// The 2D layers anchored to the view's items, from the evaluated data of `frame`.
fn paint_overlays(p: &Paint, frame: u64, window: &mut Window) {
    let Some(list) = p.overlays.get(&frame) else {
        return;
    };
    for o in list {
        let b = rect(
            (i64::from(p.view[0]) + o.at[0]) as f32,
            (i64::from(p.view[1]) + o.at[1]) as f32,
            f32::from(o.size[0]),
            f32::from(o.size[1]),
        );
        let _ = window.paint_image(b, b, Corners::default(), o.image.clone(), 0, false);
    }
}

impl Render for Root {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let state = self.paint.clone();
        let card = self.paint.borrow().card.clone();
        let panel = self.paint.borrow().panel.clone();
        div()
            .size_full()
            .relative()
            .child(
                canvas(
                    |_, _, _| {},
                    move |bounds, _, window, _| {
                        let mut p = state.borrow_mut();
                        paint_page(&mut p, bounds, window);
                        for pic in &p.pictures[0] {
                            let _ = window.paint_image(
                                bounds,
                                bounds,
                                Corners::default(),
                                pic.clone(),
                                0,
                                false,
                            );
                        }
                        if let Some(ui) = p.ui.clone() {
                            #[cfg(target_os = "macos")]
                            paint_view(&mut p, &ui, window);
                            #[cfg(not(target_os = "macos"))]
                            let _ = ui;
                        }
                        let paired = if p.pairs_newest {
                            Some(p.current)
                        } else {
                            p.shown
                        };
                        if let Some(frame) = paired {
                            paint_overlays(&p, frame, window);
                        }
                        for pic in &p.pictures[1] {
                            let _ = window.paint_image(
                                bounds,
                                bounds,
                                Corners::default(),
                                pic.clone(),
                                0,
                                false,
                            );
                        }
                    },
                )
                .size_full(),
            )
            .children(panel.map(|(view, [x, y, w, h])| {
                div()
                    .absolute()
                    .left(px(x))
                    .top(px(y))
                    .w(px(w))
                    .h(px(h))
                    .overflow_hidden()
                    .child(view)
            }))
            .children(card.map(|c| {
                let [x, y, w, h] = c.rect;
                div()
                    .absolute()
                    .left(px(x))
                    .top(px(y))
                    .w(px(w))
                    .h(px(h))
                    .bg(rgb([250, 250, 247]))
                    .border_1()
                    .border_color(rgb([60, 60, 60]))
                    .p(px(20.))
                    .flex()
                    .flex_col()
                    .gap(px(16.))
                    .text_color(rgb([20, 20, 20]))
                    .child(div().text_size(px(18.)).child(c.question.clone()))
                    .child(
                        div()
                            .flex()
                            .gap(px(12.))
                            .children(c.options.iter().map(|o| {
                                div()
                                    .px(px(14.))
                                    .py(px(8.))
                                    .border_1()
                                    .border_color(rgb([60, 60, 60]))
                                    .bg(rgb([232, 236, 240]))
                                    .child(o.clone())
                            })),
                    )
            }))
    }
}

pub struct Win {
    pub size: [u32; 2],
    handle: AnyWindowHandle,
    pub paint: Rc<RefCell<Paint>>,
}

impl Win {
    pub fn open(cx: &mut HeadlessAppContext, size: [u32; 2]) -> Result<Win, String> {
        let paint = Rc::new(RefCell::new(Paint {
            page: (32, Vec::new()),
            view: [0, 0],
            size: [0, 0],
            ui: None,
            card: None,
            waits_on_gpu: false,
            ui_time: Duration::ZERO,
            shown: None,
            overlays: BTreeMap::new(),
            current: 0,
            pairs_newest: false,
            panel: None,
            pictures: Default::default(),
            picture: None,
        }));
        let root = Root {
            paint: paint.clone(),
        };
        let (handle, _) = cx
            .update(|cx| {
                open_window(
                    WindowOptions {
                        window_bounds: Some(WindowBounds::Windowed(rect(
                            0.,
                            0.,
                            size[0] as f32,
                            size[1] as f32,
                        ))),
                        focus: false,
                        show: false,
                        ..Default::default()
                    },
                    cx,
                    |_, cx| cx.new(|_| root),
                )
            })
            .map_err(|e| format!("no window: {e}"))?;
        cx.simulate_scale_factor_change(handle, 1.);
        Ok(Win {
            size,
            handle,
            paint,
        })
    }

    /// Draws and presents one frame, as a display link's frame request does.
    pub fn present(&self, cx: &mut HeadlessAppContext) {
        self.paint.borrow_mut().ui_time = Duration::ZERO;
        // A forced frame request draws once, as the app's display link does.
        cx.present_frame(self.handle);
    }

    /// Runs `f` in the window, as a panel mounts in it.
    pub fn update<T>(
        &self,
        cx: &mut HeadlessAppContext,
        f: impl FnOnce(&mut Window, &mut gpui_kit::App) -> T,
    ) -> Result<T, String> {
        cx.update_window(self.handle, |_, window, cx| f(window, cx))
            .map_err(|e| format!("no window: {e}"))
    }

    /// The renderer's image of the whole window, RGBA.
    pub fn capture(&self, cx: &mut HeadlessAppContext) -> Result<image::RgbaImage, String> {
        cx.capture_screenshot(self.handle)
            .map_err(|e| format!("no capture: {e}"))
    }

    pub fn close(self, cx: &mut HeadlessAppContext) {
        let _ = cx.update_window(self.handle, |_, window, _| window.remove_window());
    }
}
