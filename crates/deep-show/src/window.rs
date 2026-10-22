//! The window a scenario leaves, on macOS (canvas primitives: Band; Question card): drawn
//! headless with GPUI's offscreen Metal renderer at scale 1. Each document on screen is its writer
//! layer's picture, rasterized as render-back rasterizes it with no ground, masked to its panel,
//! and an agent's layer is outlined with its name; layers compose by band and the shell's question
//! card composes last, opaque, in its slot. The planted compositor (#393 criterion 8) sorts every
//! layer and the card by order key alone, ignoring bands.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use deep_canvas::show::Band;
use deep_canvas_marks::scene::Rgb;
use deep_text_gpui::Label;
use gpui_kit::test::TestWindowExt;
use gpui_kit::*;
use serde_json::{json, Value};

use crate::hub::{Hub, Planted};

/// The card's own order key in the shell's band: what an order-key-only sort compares it by.
const CARD_ORDER: &str = "a0";
/// The outline around an agent's layer and the height of its name tab, in px.
const OUTLINE_PX: f32 = 1.;
const NAME_TAB: f32 = 18.;

fn hsla(c: Rgb) -> Hsla {
    Rgba {
        r: f32::from(c[0]) / 255.,
        g: f32::from(c[1]) / 255.,
        b: f32::from(c[2]) / 255.,
        a: 1.,
    }
    .into()
}

fn bounds(b: [f64; 4]) -> Bounds<Pixels> {
    Bounds {
        origin: point(px(b[0] as f32), px(b[1] as f32)),
        size: size(px(b[2] as f32), px(b[3] as f32)),
    }
}

/// One thing the window composes.
#[derive(Clone)]
enum Entry {
    /// A writer layer's picture in its panel, outlined with `name` when it's an agent's.
    Layer {
        picture: Arc<RenderImage>,
        panel: [f64; 4],
        name: Option<String>,
    },
    Card,
}

struct Scene {
    ground: Rgb,
    ink: Rgb,
    muted: Rgb,
    entries: Vec<Entry>,
    card: Option<(String, Vec<String>, [f64; 4])>,
}

impl Scene {
    fn labels(&self) -> Vec<Label> {
        let mut out: Vec<Label> = self
            .entries
            .iter()
            .filter_map(|e| match e {
                Entry::Layer { name: Some(n), .. } => Some(Label::new(n.clone())),
                _ => None,
            })
            .collect();
        if let Some((question, options, _)) = &self.card {
            out.push(Label {
                weight: 600,
                ..Label::new(question.clone())
            });
            out.extend(options.iter().map(|o| Label::new(o.clone())));
        }
        out
    }
}

struct View {
    scene: Rc<RefCell<Scene>>,
}

fn paint_entry(scene: &Scene, entry: &Entry, window: &mut Window) {
    match entry {
        Entry::Layer {
            picture,
            panel,
            name,
        } => {
            let panel = bounds(*panel);
            window.with_content_mask(Some(ContentMask { bounds: panel }), |w| {
                let _ = w.paint_image(panel, panel, Corners::default(), picture.clone(), 0, false);
                if let Some(name) = name {
                    w.paint_quad(quad(
                        panel,
                        px(0.),
                        transparent_black(),
                        px(OUTLINE_PX),
                        hsla(scene.muted),
                        BorderStyle::Solid,
                    ));
                    let label = Label::new(name.clone());
                    let width = deep_text_gpui::measure(&label).width + px(12.);
                    let tab = Bounds {
                        origin: panel.origin,
                        size: size(width, px(NAME_TAB)),
                    };
                    w.paint_quad(gpui_kit::fill(tab, hsla(scene.muted)));
                    deep_text_gpui::paint_label(
                        panel.origin + point(px(6.), px(1.)),
                        &label,
                        hsla(scene.ground),
                        w,
                    );
                }
            });
        }
        Entry::Card => {
            let Some((question, options, rect)) = &scene.card else {
                return;
            };
            let card = bounds(*rect);
            // Opaque and on top: the shell draws it, and nothing covers it.
            window.paint_quad(quad(
                card,
                px(8.),
                hsla(scene.ground),
                px(1.),
                hsla(scene.ink),
                BorderStyle::Solid,
            ));
            let q = Label {
                weight: 600,
                width: Some(rect[2] as f32 - 32.),
                ..Label::new(question.clone())
            };
            deep_text_gpui::paint_label(
                card.origin + point(px(16.), px(16.)),
                &q,
                hsla(scene.ink),
                window,
            );
            let mut x = 16.;
            for option in options {
                let label = Label::new(option.clone());
                let w = f32::from(deep_text_gpui::measure(&label).width) + 24.;
                let button = Bounds {
                    origin: card.origin + point(px(x), px(rect[3] as f32 - 48.)),
                    size: size(px(w), px(32.)),
                };
                window.paint_quad(quad(
                    button,
                    px(6.),
                    hsla(scene.ground),
                    px(1.),
                    hsla(scene.muted),
                    BorderStyle::Solid,
                ));
                deep_text_gpui::paint_label(
                    button.origin + point(px(12.), px(8.)),
                    &label,
                    hsla(scene.ink),
                    window,
                );
                x += w + 8.;
            }
        }
    }
}

impl Render for View {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let prepared = self.scene.clone();
        let scene = self.scene.clone();
        let ground = hsla(scene.borrow().ground);
        div().size_full().bg(ground).child(
            canvas(
                move |_, window, _| {
                    for label in prepared.borrow().labels() {
                        deep_text_gpui::prepare(&label, window.scale_factor());
                    }
                },
                move |_, _, window, _| {
                    let scene = scene.borrow();
                    for entry in &scene.entries {
                        paint_entry(&scene, entry, window);
                    }
                },
            )
            .size_full(),
        )
    }
}

/// A straight RGBA raster as the BGRA picture GPUI paints.
fn picture(mut rgba: Vec<u8>, size: [u16; 2]) -> Option<Arc<RenderImage>> {
    for p in rgba.as_chunks_mut::<4>().0 {
        p.swap(0, 2);
    }
    let frame = image::RgbaImage::from_raw(u32::from(size[0]), u32::from(size[1]), rgba)?;
    Some(Arc::new(RenderImage::new([image::Frame::new(frame)])))
}

fn refused(code: &str) -> Value {
    json!({"ok": false, "code": code})
}

/// Draws the window the scenario's calls left and writes it to `out` as a PNG.
pub fn draw(hub: &mut Hub<'_>, replies: Vec<Value>, out: &str) -> Value {
    let [w, h] = hub.scenario.window.expect("screen has a window");
    let palette = hub.look.light.clone();
    let role = |name: &str| palette.get(name).copied().unwrap_or([0; 3]);
    let record = hub.record();
    let mut keyed: Vec<(String, Entry)> = Vec::new();
    let mut items = Vec::new();
    for row in hub.bands() {
        let Some(doc) = row.doc.as_ref() else {
            keyed.push((CARD_ORDER.into(), Entry::Card));
            continue;
        };
        let current = hub
            .current(doc)
            .expect("a layer on screen has a current revision");
        let stamped = current
            .doc
            .as_object()
            .expect("a revision is an object")
            .clone();
        let panel_id = &hub.scenario.docs[doc];
        let panel = hub.scenario.panels[panel_id].rect;
        let size = [
            panel[2].round().clamp(1., 8192.) as u16,
            panel[3].round().clamp(1., 8192.) as u16,
        ];
        let Ok(drawn) = hub.renderer.prepare(
            &stamped,
            0,
            &palette,
            hub.look.status.as_ref(),
            &record,
            &hub.scenario.evidence,
        ) else {
            continue;
        };
        let [dw, dh] = drawn.frame.size;
        let scale = (f64::from(size[0]) / dw).min(f64::from(size[1]) / dh);
        for (id, b) in drawn.boxes() {
            let at = [
                panel[0] + b[0] * scale,
                panel[1] + b[1] * scale,
                b[2] * scale,
                b[3] * scale,
            ];
            items.push(json!({"id": id, "layer": row.layer, "box": at}));
        }
        let rgba = hub.renderer.raster(&drawn, size, None);
        let Some(picture) = picture(rgba, size) else {
            return refused("no_picture");
        };
        // The order key the planted compositor sorts a layer by: its highest item order.
        let key = stamped
            .get("items")
            .and_then(Value::as_object)
            .map(|items| {
                items
                    .values()
                    .filter_map(|i| i.get("order").and_then(Value::as_str))
                    .max()
                    .unwrap_or("")
                    .to_string()
            })
            .unwrap_or_default();
        let name = (row.band == Band::Agent && row.outline)
            .then(|| row.name.clone())
            .flatten();
        keyed.push((
            key,
            Entry::Layer {
                picture,
                panel,
                name,
            },
        ));
    }
    if hub.scenario.planted == Some(Planted::SortsByOrderKeyAlone) {
        keyed.sort_by(|a, b| a.0.cmp(&b.0));
    }
    let scene = Rc::new(RefCell::new(Scene {
        ground: role("ground"),
        ink: role("ink"),
        muted: role("muted"),
        entries: keyed.into_iter().map(|(_, e)| e).collect(),
        card: hub
            .scenario
            .card
            .as_ref()
            .map(|c| (c.question.clone(), c.options.clone(), c.rect)),
    }));
    let mut cx = deep_replica::headless_context();
    let view = View {
        scene: scene.clone(),
    };
    let Ok((handle, _)) = cx.update(|cx| {
        open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Point::default(),
                    size: size(px(w as f32), px(h as f32)),
                })),
                focus: false,
                show: false,
                ..Default::default()
            },
            cx,
            |_, cx| cx.new(|_| view),
        )
    }) else {
        return refused("no_window");
    };
    cx.simulate_scale_factor_change(handle, 1.);
    // Two frames: the first uploads the pictures and glyph pages, the second draws from them warm.
    for _ in 0..2 {
        if cx
            .update_window(handle, |_, window, cx| window.render_frame(cx))
            .is_err()
        {
            return refused("no_frame");
        }
    }
    let Ok(image) = cx.capture_screenshot(handle) else {
        return refused("no_capture");
    };
    let _ = cx.update_window(handle, |_, window, _| window.remove_window());
    if image.save(out).is_err() {
        return refused("not_written");
    }
    json!({
        "ok": true,
        "width": image.width(),
        "height": image.height(),
        "replies": replies,
        "items": items,
    })
}
