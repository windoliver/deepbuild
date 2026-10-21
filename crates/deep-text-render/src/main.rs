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

/// One render request, read from its JSON line.
struct Request {
    out: String,
    width: f32,
    height: f32,
    card: [u8; 3],
    labels: Vec<LabelRequest>,
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
        let out = input.get("out")?.as_str()?.to_owned();
        let card = input.get("card")?.as_object()?;
        let labels = input
            .get("labels")?
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
            .collect::<Option<Vec<_>>>()?;
        Some(Request {
            out,
            width: positive(card, "w")?,
            height: positive(card, "h")?,
            card: rgb(card.get("color"))?,
            labels,
        })
    }
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

    use crate::{refused, LabelRequest, Request};

    /// One headless app for every line; each render opens its own window, at scale 1.
    pub struct Renderer {
        cx: HeadlessAppContext,
    }

    /// The card: a filled quad, then each label painted from the atlas at its corner.
    struct Card {
        color: Rgba,
        labels: Vec<(Label, Point<Pixels>, Rgba)>,
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
                    move |_, window, _| {
                        for (label, _, _) in &prepared {
                            deep_text_gpui::prepare(label, window.scale_factor());
                        }
                    },
                    move |bounds, _, window, _| {
                        let mut drawn = Vec::with_capacity(labels.len());
                        deep_text_gpui::begin_frame();
                        for (label, origin, color) in &labels {
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

    impl Renderer {
        pub fn new() -> Self {
            Renderer {
                cx: deep_replica::headless_context(),
            }
        }

        pub fn render(&mut self, request: &Request) -> Value {
            let mut labels = Vec::with_capacity(request.labels.len());
            for LabelRequest {
                text,
                x,
                y,
                size,
                weight,
                font,
                color: tint,
            } in &request.labels
            {
                let Some(role) = Role::parse(font) else {
                    return refused("bad_font");
                };
                let label = Label {
                    role,
                    size: *size,
                    weight: *weight,
                    ..Label::new(text.clone())
                };
                labels.push((label, point(px(*x), px(*y)), color(*tint)));
            }
            let painted = Rc::new(RefCell::new(Vec::new()));
            let uploads = Rc::new(Cell::new(0));
            let card = Card {
                color: color(request.card),
                labels: labels.clone(),
                painted: painted.clone(),
                uploads: uploads.clone(),
            };
            let window_size = size(px(request.width), px(request.height));
            let Ok((handle, _)) = self.cx.update(|cx| {
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
            }) else {
                return refused("no_window");
            };
            self.cx.simulate_scale_factor_change(handle, 1.);
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
