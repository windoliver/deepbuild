//! `deep-text-render render`: JSON lines in, one JSON line out per input line, in order, exit 0.
//! Each line names a PNG to write, a card `{w, h, color}` and labels `[{text, x, y, size, weight,
//! font, color}]`; the card is drawn headless with GPUI's offscreen Metal renderer at scale 1,
//! each label from the canvas's atlas through the GPUI patch's tinted mask sprite, and the answer
//! reports each label's box, how many runs were shaped, what the sprites drew from and the most
//! pages one frame uploaded. A number that isn't finite, a size or side that isn't above zero, or
//! a weight outside 1..=1000 is `bad_input`. Off macOS every line answers
//! `{"ok":false,"code":"unsupported_platform"}`.

use std::io::{self, BufRead, Write};

use serde_json::{json, Map, Value};

fn bad_input() -> Value {
    json!({"ok": false, "code": "bad_input"})
}

fn refused(code: &str) -> Value {
    json!({"ok": false, "code": code})
}

fn main() {
    let command = std::env::args().nth(1).unwrap_or_default();
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    #[cfg(target_os = "macos")]
    let mut renderer = macos::Renderer::new();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let answer = match serde_json::from_str::<Value>(&line) {
            Ok(Value::Object(input)) if command == "render" => match Request::parse(&input) {
                Some(request) => {
                    #[cfg(target_os = "macos")]
                    {
                        renderer.render(&request)
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        let _ = request;
                        refused("unsupported_platform")
                    }
                }
                None => bad_input(),
            },
            Ok(Value::Object(_)) => refused("bad_command"),
            _ => bad_input(),
        };
        writeln!(out, "{answer}").expect("stdout");
    }
}

/// A global allocator that counts the allocations of a page or more (#1480, criterion 3): a frame
/// that adds a glyph must clone no page.
struct CountingAlloc;

static PAGE_ALLOCS: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

unsafe impl std::alloc::GlobalAlloc for CountingAlloc {
    unsafe fn alloc(&self, layout: std::alloc::Layout) -> *mut u8 {
        if layout.size() >= 1 << 20 {
            PAGE_ALLOCS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        std::alloc::System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: std::alloc::Layout) {
        std::alloc::System.dealloc(ptr, layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: std::alloc::Layout, new: usize) -> *mut u8 {
        if new >= 1 << 20 && layout.size() < new {
            PAGE_ALLOCS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        }
        std::alloc::System.realloc(ptr, layout, new)
    }
}

#[global_allocator]
static ALLOC: CountingAlloc = CountingAlloc;

/// One render request, read from its JSON line.
struct Request {
    out: String,
    width: f32,
    height: f32,
    card: [u8; 3],
    labels: Vec<LabelRequest>,
    /// #1480: `frames`, each drawn once by each of `windows` windows, instead of `labels`.
    frames: Option<Vec<(Vec<LabelRequest>, Option<Vec<String>>)>>,
    windows: usize,
    whole_page: bool,
}

struct LabelRequest {
    text: String,
    x: f32,
    y: f32,
    size: f32,
    weight: u16,
    font: String,
    color: [u8; 3],
}

fn rgb(value: Option<&Value>) -> Option<[u8; 3]> {
    let parts = value?.as_array()?;
    if parts.len() != 3 {
        return None;
    }
    let mut color = [0u8; 3];
    for (slot, part) in color.iter_mut().zip(parts) {
        *slot = u8::try_from(part.as_u64()?).ok()?;
    }
    Some(color)
}

/// A finite number field as f32.
fn number(object: &Map<String, Value>, key: &str) -> Option<f32> {
    object
        .get(key)?
        .as_f64()
        .map(|n| n as f32)
        .filter(|n| n.is_finite())
}

/// A finite number above zero: a size or a side.
fn positive(object: &Map<String, Value>, key: &str) -> Option<f32> {
    number(object, key).filter(|n| *n > 0.)
}

impl Request {
    fn parse(input: &Map<String, Value>) -> Option<Request> {
        let card = input.get("card")?.as_object()?;
        let (out, labels, frames) = match input.get("frames") {
            None => (
                input.get("out")?.as_str()?.to_owned(),
                labels_of(input.get("labels")?)?,
                None,
            ),
            Some(frames) => {
                let frames = frames
                    .as_array()?
                    .iter()
                    .map(|frame| {
                        let frame = frame.as_object()?;
                        let out = match frame.get("out") {
                            None => None,
                            Some(paths) => Some(
                                paths
                                    .as_array()?
                                    .iter()
                                    .map(|p| Some(p.as_str()?.to_owned()))
                                    .collect::<Option<Vec<_>>>()?,
                            ),
                        };
                        Some((labels_of(frame.get("labels")?)?, out))
                    })
                    .collect::<Option<Vec<_>>>()?;
                (String::new(), Vec::new(), Some(frames))
            }
        };
        let windows = match input.get("windows") {
            None => 1,
            Some(n) => usize::try_from(n.as_u64()?).ok().filter(|n| *n >= 1)?,
        };
        let whole_page = match input.get("upload").and_then(Value::as_str) {
            None | Some("rect") => false,
            Some("whole_page") => true,
            Some(_) => return None,
        };
        if let Some(frames) = &frames {
            if frames
                .iter()
                .any(|(_, out)| out.as_ref().is_some_and(|o| o.len() != windows))
            {
                return None;
            }
        }
        Some(Request {
            out,
            width: positive(card, "w")?,
            height: positive(card, "h")?,
            card: rgb(card.get("color"))?,
            labels,
            frames,
            windows,
            whole_page,
        })
    }
}

fn labels_of(value: &Value) -> Option<Vec<LabelRequest>> {
    value
        .as_array()?
        .iter()
        .map(|label| {
            let label = label.as_object()?;
            Some(LabelRequest {
                text: label.get("text")?.as_str()?.to_owned(),
                x: number(label, "x")?,
                y: number(label, "y")?,
                size: positive(label, "size")?,
                weight: u16::try_from(number(label, "weight")?.round() as i64)
                    .ok()
                    .filter(|weight| (1..=1000).contains(weight))?,
                font: label.get("font")?.as_str()?.to_owned(),
                color: rgb(label.get("color"))?,
            })
        })
        .collect()
}

#[cfg(target_os = "macos")]
mod macos {
    use std::cell::{Cell, RefCell};
    use std::rc::Rc;

    use deep_text::Role;
    use deep_text_gpui::{paint_label, Label, Painted};
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::*;
    use serde_json::{json, Value};

    use crate::{refused, LabelRequest, Request, PAGE_ALLOCS};

    /// One headless app for every line; each render opens its own window, at scale 1.
    pub struct Renderer {
        cx: HeadlessAppContext,
    }

    /// The card: a filled quad, then each label painted from the atlas at its corner.
    struct Card {
        color: Rgba,
        labels: Rc<RefCell<Vec<(Label, Point<Pixels>, Rgba)>>>,
        /// The last frame's paints, one per label.
        painted: Rc<RefCell<Vec<Painted>>>,
        /// The most pages any one frame handed GPUI (the window opens at scale 2 and is drawn
        /// again at 1, so a sum would count each scale's pages).
        uploads: Rc<Cell<usize>>,
    }

    impl Render for Card {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            let prepared = self.labels.clone();
            let labels = self.labels.clone();
            let painted = self.painted.clone();
            let uploads = self.uploads.clone();
            div().size_full().bg(self.color).child(
                canvas(
                    // Every label's glyphs placed before the first paint: a page goes up once.
                    move |bounds, window, _| {
                        for (label, origin, _) in prepared.borrow().iter() {
                            let at = bounds.origin + *origin;
                            deep_text_gpui::prepare_at(at, label, window.scale_factor());
                        }
                    },
                    move |bounds, _, window, _| {
                        let mut drawn = Vec::with_capacity(labels.borrow().len());
                        deep_text_gpui::begin_frame();
                        for (label, origin, color) in labels.borrow().iter() {
                            let at = bounds.origin + *origin;
                            drawn.push(paint_label(at, label, (*color).into(), window));
                        }
                        let frame: usize = drawn.iter().map(|p| p.uploaded).sum();
                        uploads.set(uploads.get().max(frame));
                        *painted.borrow_mut() = drawn;
                    },
                )
                .size_full(),
            )
        }
    }

    fn color(rgb: [u8; 3]) -> Rgba {
        Rgba {
            r: f32::from(rgb[0]) / 255.,
            g: f32::from(rgb[1]) / 255.,
            b: f32::from(rgb[2]) / 255.,
            a: 1.,
        }
    }

    type Labels = Vec<(Label, Point<Pixels>, Rgba)>;

    fn labels_of(requests: &[LabelRequest]) -> Result<Labels, Value> {
        let mut labels = Vec::with_capacity(requests.len());
        for LabelRequest {
            text,
            x,
            y,
            size,
            weight,
            font,
            color: tint,
        } in requests
        {
            let Some(role) = Role::parse(font) else {
                return Err(refused("bad_font"));
            };
            let label = Label {
                family: role.family(),
                size: *size,
                weight: *weight,
                ..Label::new(text.clone())
            };
            labels.push((label, point(px(*x), px(*y)), color(*tint)));
        }
        Ok(labels)
    }

    impl Renderer {
        /// Opens a window for `card` at scale 1.
        fn open(&mut self, card: Card, request: &Request) -> Option<AnyWindowHandle> {
            let window_size = size(px(request.width), px(request.height));
            let (handle, _) = self
                .cx
                .update(|cx| {
                    open_window(
                        WindowOptions {
                            window_bounds: Some(WindowBounds::Windowed(Bounds {
                                origin: Point::default(),
                                size: window_size,
                            })),
                            focus: false,
                            show: false,
                            ..Default::default()
                        },
                        cx,
                        |_, cx| cx.new(|_| card),
                    )
                })
                .ok()?;
            self.cx.simulate_scale_factor_change(handle, 1.);
            Some(handle)
        }

        /// #1480: each frame drawn once by each window, from empty labels at open, so nothing is
        /// uploaded before the first frame; reports what each window uploaded and allocated.
        fn render_frames(&mut self, request: &Request) -> Value {
            use std::sync::atomic::Ordering::Relaxed;
            let frames = request.frames.as_ref().expect("frames");
            let mut parsed = Vec::new();
            for (labels, _) in frames {
                match labels_of(labels) {
                    Ok(labels) => parsed.push(labels),
                    Err(refusal) => return refusal,
                }
            }
            deep_text_gpui::plant_whole_page_upload(request.whole_page);
            deep_text_gpui::watch_new_glyphs(true);
            let mut windows = Vec::new();
            for _ in 0..request.windows {
                let labels = Rc::new(RefCell::new(Labels::new()));
                let painted = Rc::new(RefCell::new(Vec::new()));
                let card = Card {
                    color: color(request.card),
                    labels: labels.clone(),
                    painted: painted.clone(),
                    uploads: Rc::new(Cell::new(0)),
                };
                let Some(handle) = self.open(card, request) else {
                    return refused("no_window");
                };
                windows.push((handle, labels, painted));
            }
            let mut reports = Vec::new();
            for (i, (_, out)) in frames.iter().enumerate() {
                let mut per_window = Vec::new();
                let mut new_glyphs = Vec::new();
                for (k, (handle, labels, painted)) in windows.iter().enumerate() {
                    *labels.borrow_mut() = parsed[i].clone();
                    let before = PAGE_ALLOCS.load(Relaxed);
                    let drawn = self
                        .cx
                        .update_window(*handle, |_, window, cx| window.render_frame(cx));
                    let page_allocs = PAGE_ALLOCS.load(Relaxed) - before;
                    if drawn.is_err() {
                        return refused("no_frame");
                    }
                    // Windows after the first find the glyphs already rasterized.
                    new_glyphs.extend(deep_text_gpui::take_new_glyphs());
                    let painted = painted.borrow();
                    let mut pages: Vec<u32> = Vec::new();
                    let mut rects = Vec::new();
                    let (mut bytes, mut whole) = (0, 0);
                    for p in painted.iter() {
                        bytes += p.upload_bytes;
                        whole += p.upload_whole_pages;
                        for (page, _) in &p.pages {
                            if !pages.contains(page) {
                                pages.push(*page);
                            }
                        }
                        for (page, [x, y, w, h]) in &p.upload_rects {
                            rects.push(json!({"page": page, "x": x, "y": y, "w": w, "h": h}));
                        }
                    }
                    per_window.push(json!({
                        "upload_bytes": bytes,
                        "upload_rects": rects,
                        "upload_whole_pages": whole,
                        "page_allocs": page_allocs,
                        "pages": pages,
                    }));
                    if let Some(paths) = out {
                        let image = match self.cx.capture_screenshot(*handle) {
                            Ok(image) => image,
                            Err(_) => return refused("no_capture"),
                        };
                        if image.save(&paths[k]).is_err() {
                            return refused("not_written");
                        }
                    }
                }
                let glyphs: Vec<Value> = new_glyphs
                    .iter()
                    .map(|(w, h)| json!({"w": w, "h": h}))
                    .collect();
                reports.push(json!({"new_glyphs": glyphs, "windows": per_window}));
            }
            for (handle, ..) in &windows {
                let _ = self
                    .cx
                    .update_window(*handle, |_, window, _| window.remove_window());
            }
            deep_text_gpui::watch_new_glyphs(false);
            deep_text_gpui::plant_whole_page_upload(false);
            json!({"ok": true, "frames": reports})
        }

        pub fn new() -> Self {
            Renderer {
                cx: deep_replica::headless_context(),
            }
        }

        pub fn render(&mut self, request: &Request) -> Value {
            if request.frames.is_some() {
                return self.render_frames(request);
            }
            let labels = match labels_of(&request.labels) {
                Ok(labels) => labels,
                Err(refusal) => return refusal,
            };
            let painted = Rc::new(RefCell::new(Vec::new()));
            let uploads = Rc::new(Cell::new(0));
            let card = Card {
                color: color(request.card),
                labels: Rc::new(RefCell::new(labels.clone())),
                painted: painted.clone(),
                uploads: uploads.clone(),
            };
            let Some(handle) = self.open(card, request) else {
                return refused("no_window");
            };
            // Two frames: the first uploads the pages, the second draws from them warm.
            for _ in 0..2 {
                if self
                    .cx
                    .update_window(handle, |_, window, cx| window.render_frame(cx))
                    .is_err()
                {
                    return refused("no_frame");
                }
            }
            let runs = deep_text_gpui::frame_runs();
            let image = match self.cx.capture_screenshot(handle) {
                Ok(image) => image,
                Err(_) => return refused("no_capture"),
            };
            let _ = self
                .cx
                .update_window(handle, |_, window, _| window.remove_window());
            if image.save(&request.out).is_err() {
                return refused("not_written");
            }
            let painted = painted.borrow();
            let mut draws = Vec::new();
            let mut pages: Vec<u32> = Vec::new();
            let boxes: Vec<Value> = labels
                .iter()
                .zip(painted.iter())
                .zip(&request.labels)
                .map(|(((label, origin, _), painted), request)| {
                    for (page, glyphs) in &painted.pages {
                        draws.push(json!({
                            "kind": "tinted_mask_sprite",
                            "page": page,
                            "color": request.color,
                            "glyphs": glyphs,
                        }));
                        if !pages.contains(page) {
                            pages.push(*page);
                        }
                    }
                    let shaped = deep_text_gpui::shape(label);
                    json!({
                        "x": f32::from(origin.x),
                        "y": f32::from(origin.y),
                        "w": shaped.width,
                        "h": shaped.height,
                    })
                })
                .collect();
            json!({
                "ok": true,
                "width": image.width(),
                "height": image.height(),
                "labels": boxes,
                "shaped": runs,
                "draws": draws,
                "pages": pages,
                "uploads": uploads.get(),
            })
        }
    }
}
