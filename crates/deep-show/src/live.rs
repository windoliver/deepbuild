//! `deep-show live` (#376's proof line, on macOS): the screen-reader smoke run. It plays a
//! scenario's calls, then opens a real, shown window that draws the panel's document as `screen`
//! draws it and exposes the same accessibility tree `see` reads as data, one AccessKit node per
//! part, label, readout and control, at the box the item draws in. A readout is a polite live
//! region whose value is its text, so AccessKit asks VoiceOver to announce it exactly when its
//! value changes. Each frame the panel presented, unchanged ones merged, shows for [`HOLD`] in
//! order, the last for [`LAST`], then the app quits. A screen-reader run is a smoke test, never
//! the check (Rules every primitive follows: Accessible); `see` is the check. One gap from `see`:
//! a readout the view hides leaves the window's tree, so showing it again is announced even when
//! unchanged; the run's scenario must not hide its readout. Controls carry name and role only.
//! It answers one input line, then holds the window and exits.

use std::io::Write;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use gpui_kit::*;
use serde_json::{json, Value};

use crate::hub::Hub;

/// How long each presented frame shows before the next.
const HOLD: Duration = Duration::from_secs(6);
/// How long the last frame stays, for a person to walk the tree with VoiceOver.
const LAST: Duration = Duration::from_secs(180);
/// The strip under the panel where the controls sit, in px.
const STRIP: f32 = 40.;

/// One accessibility node and where it sits in the window.
#[derive(Clone)]
struct Node {
    id: String,
    role: accesskit::Role,
    name: String,
    value: Option<String>,
    live: bool,
    bounds: Bounds<Pixels>,
}

/// What one presented frame draws and exposes.
struct Frame {
    picture: Arc<RenderImage>,
    panel: Bounds<Pixels>,
    nodes: Vec<Node>,
}

/// An element that draws nothing and is one node of the accessibility tree.
struct AxNode {
    node: Node,
    style: StyleRefinement,
}

impl IntoElement for AxNode {
    type Element = Self;

    fn into_element(self) -> Self {
        self
    }
}

impl Styled for AxNode {
    fn style(&mut self) -> &mut StyleRefinement {
        &mut self.style
    }
}

impl Element for AxNode {
    type RequestLayoutState = ();
    type PrepaintState = ();

    fn id(&self) -> Option<ElementId> {
        Some(ElementId::Name(self.node.id.clone().into()))
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let mut style = Style::default();
        style.refine(&self.style);
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        _: &mut Window,
        _: &mut App,
    ) {
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        _: &mut Window,
        _: &mut App,
    ) {
    }

    fn a11y_role(&self) -> Option<accesskit::Role> {
        Some(self.node.role)
    }

    fn write_a11y_info(&self, node: &mut accesskit::Node) {
        node.set_label(self.node.name.clone());
        if let Some(value) = &self.node.value {
            node.set_value(value.clone());
        }
        if self.node.live {
            node.set_live(accesskit::Live::Polite);
        }
    }
}

/// An item's role as an assistive client's: a part is a graphic, a label and a readout are text.
fn item_role(role: &str) -> accesskit::Role {
    match role {
        "part" => accesskit::Role::Image,
        "control" => accesskit::Role::Button,
        _ => accesskit::Role::Label,
    }
}

/// A control's ARIA role as AccessKit's; one this build doesn't map stays unknown, named still.
fn control_role(role: &str) -> accesskit::Role {
    match role {
        "slider" => accesskit::Role::Slider,
        "switch" => accesskit::Role::Switch,
        "checkbox" => accesskit::Role::CheckBox,
        "button" => accesskit::Role::Button,
        "listbox" => accesskit::Role::ListBox,
        "combobox" => accesskit::Role::ComboBox,
        "radiogroup" => accesskit::Role::RadioGroup,
        "spinbutton" => accesskit::Role::SpinButton,
        _ => accesskit::Role::Unknown,
    }
}

fn bounds(b: [f64; 4]) -> Bounds<Pixels> {
    Bounds {
        origin: point(px(b[0] as f32), px(b[1] as f32)),
        size: size(px(b[2] as f32), px(b[3] as f32)),
    }
}

struct View {
    frames: Rc<Vec<Frame>>,
    k: usize,
    ground: Hsla,
    ink: Hsla,
}

impl Render for View {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let frames = self.frames.clone();
        let k = self.k;
        let ink = self.ink;
        let labels: Vec<(Point<Pixels>, deep_text_gpui::Label)> = frames[k]
            .nodes
            .iter()
            .filter(|n| n.bounds.origin.y >= frames[k].panel.bottom())
            .map(|n| {
                let at = n.bounds.origin + point(px(4.), px(10.));
                (at, deep_text_gpui::Label::new(n.name.clone()))
            })
            .collect();
        let prepared = labels.clone();
        let painted = canvas(
            move |_, window, _| {
                for (_, label) in &prepared {
                    deep_text_gpui::prepare(label, window.scale_factor());
                }
            },
            move |_, _, window, _| {
                let f = &frames[k];
                let _ = window.paint_image(
                    f.panel,
                    f.panel,
                    Corners::default(),
                    f.picture.clone(),
                    0,
                    false,
                );
                for (at, label) in &labels {
                    deep_text_gpui::paint_label(*at, label, ink, window);
                }
            },
        )
        .size_full();
        let nodes = self.frames[k].nodes.iter().map(|n| {
            AxNode {
                node: n.clone(),
                style: StyleRefinement::default(),
            }
            .absolute()
            .left(n.bounds.origin.x)
            .top(n.bounds.origin.y)
            .w(n.bounds.size.width)
            .h(n.bounds.size.height)
        });
        div()
            .size_full()
            .relative()
            .bg(self.ground)
            .child(painted)
            .children(nodes)
    }
}

/// The nodes of one frame: the tree `see` reads, each item at its drawn box in the panel and
/// the controls side by side in the strip under it, and the items heard but drawn in no box.
fn nodes(
    doc: &Value,
    hidden: &[String],
    boxes: &[(String, [f64; 4])],
    panel: [f64; 4],
) -> (Vec<Node>, Vec<String>) {
    let readouts = crate::access::readouts(doc, hidden);
    let mut out = Vec::new();
    let mut unboxed = Vec::new();
    let mut strip_x = panel[0];
    for n in crate::access::tree(doc, hidden).into_iter().skip(1) {
        let id = n["id"].as_str().unwrap_or("").to_string();
        let name = n["name"].as_str().unwrap_or("").to_string();
        let role = n["role"].as_str().unwrap_or("");
        if doc.pointer(&format!("/controls/{id}")).is_some() {
            let width = 16. + 8. * name.chars().count() as f64;
            out.push(Node {
                role: control_role(role),
                value: None,
                live: false,
                bounds: bounds([strip_x, panel[1] + panel[3], width, f64::from(STRIP)]),
                id,
                name,
            });
            strip_x += width + 8.;
            continue;
        }
        let Some((_, b)) = boxes.iter().find(|(b, _)| *b == id) else {
            unboxed.push(id);
            continue;
        };
        out.push(Node {
            role: item_role(role),
            value: readouts.get(&id).cloned(),
            live: readouts.contains_key(&id),
            bounds: bounds(*b),
            id,
            name,
        });
    }
    (out, unboxed)
}

fn refused(code: &str) -> Value {
    json!({"ok": false, "code": code})
}

/// Plays the scenario's calls, then shows the panel the first document on screen sits in.
pub fn show(hub: &mut Hub<'_>) -> Value {
    let Some((doc, panel_id)) = hub
        .scenario
        .docs
        .iter()
        .next()
        .map(|(d, p)| (d.clone(), p.clone()))
    else {
        return refused("no_document");
    };
    let presented = hub.presented(&panel_id);
    let Some(list) = presented.get("frames").and_then(Value::as_array).cloned() else {
        return presented;
    };
    let panel = hub
        .slot(&panel_id)
        .expect("a document's panel is in the scenario");
    let px_size = [
        panel[2].round().clamp(1., 8192.) as u16,
        panel[3].round().clamp(1., 8192.) as u16,
    ];
    let palette = hub.look.light.clone();
    let ground = palette.get("ground").copied().unwrap_or([255; 3]);
    let ink = palette.get("ink").copied().unwrap_or([0; 3]);
    let record = hub.record();
    let mut frames = Vec::new();
    let mut shown = Vec::new();
    let mut last: Option<(u64, Vec<String>)> = None;
    let mut title = String::from("deep-show live");
    for frame in list {
        let (Some(rev), Some(vsync)) = (frame["rev"].as_u64(), frame["vsync"].as_i64()) else {
            continue;
        };
        let hidden: Vec<String> = frame
            .get("hidden")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        if last.as_ref() == Some(&(rev, hidden.clone())) {
            continue;
        }
        last = Some((rev, hidden.clone()));
        let Some(revision) = hub.revision(&doc, rev) else {
            return refused("no_revision");
        };
        if let Some(t) = revision["title"].as_str() {
            title = t.to_string();
        }
        let drawable = crate::shared::drawable(&revision);
        let Ok(drawn) = hub.renderer.prepare(
            drawable.as_object().expect("a document is an object"),
            0,
            &palette,
            hub.look.status.as_ref(),
            &record,
            &hub.scenario.evidence,
        ) else {
            return refused("not_drawn");
        };
        let [dw, dh] = drawn.frame.size;
        let scale = (f64::from(px_size[0]) / dw).min(f64::from(px_size[1]) / dh);
        let boxes: Vec<(String, [f64; 4])> = drawn
            .boxes()
            .into_iter()
            .map(|(id, b)| {
                let at = [
                    panel[0] + b[0] * scale,
                    panel[1] + b[1] * scale,
                    b[2] * scale,
                    b[3] * scale,
                ];
                (id, at)
            })
            .collect();
        let mut rgba = hub.renderer.raster(&drawn, px_size, Some(ground));
        for p in rgba.as_chunks_mut::<4>().0 {
            p.swap(0, 2);
        }
        let Some(image) =
            image::RgbaImage::from_raw(u32::from(px_size[0]), u32::from(px_size[1]), rgba)
        else {
            return refused("no_picture");
        };
        let (nodes, unboxed) = nodes(&revision, &hidden, &boxes, panel);
        shown.push(json!({
            "rev": rev,
            "vsync": vsync,
            "nodes": nodes.iter().map(|n| json!({"id": n.id, "name": n.name, "value": n.value})).collect::<Vec<_>>(),
            "unboxed": unboxed,
        }));
        frames.push(Frame {
            picture: Arc::new(RenderImage::new([image::Frame::new(image)])),
            panel: bounds(panel),
            nodes,
        });
    }
    if frames.is_empty() {
        return refused("not_presented");
    }
    let window_size = size(
        px((panel[0] + panel[2]) as f32),
        px((panel[1] + panel[3]) as f32 + STRIP),
    );
    let hsla = |c: [u8; 3]| -> Hsla {
        Rgba {
            r: f32::from(c[0]) / 255.,
            g: f32::from(c[1]) / 255.,
            b: f32::from(c[2]) / 255.,
            a: 1.,
        }
        .into()
    };
    let frames = Rc::new(frames);
    let (ground, ink) = (hsla(ground), hsla(ink));
    gpui_kit::application().run(move |cx| {
        gpui_kit::init(cx);
        let count = frames.len();
        let opened = cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    window_size,
                    cx,
                ))),
                titlebar: Some(TitlebarOptions {
                    title: Some(title.into()),
                    ..Default::default()
                }),
                show: true,
                focus: true,
                ..Default::default()
            },
            |_, cx| {
                cx.new(|_| View {
                    frames,
                    k: 0,
                    ground,
                    ink,
                })
            },
        );
        // AppKit's run loop ends the process when the app quits, so the reply goes out here,
        // once the window is open or has failed to.
        let reply = match opened {
            Ok(_) => json!({"ok": true, "shown": shown}),
            Err(_) => refused("no_window"),
        };
        let mut out = std::io::stdout().lock();
        let _ = writeln!(out, "{reply}");
        let _ = out.flush();
        drop(out);
        let Ok(handle) = opened else {
            cx.quit();
            return;
        };
        // Closing the window early ends the run.
        cx.on_window_closed(|cx, _| cx.quit()).detach();
        cx.activate(true);
        cx.spawn(async move |cx| {
            for k in 1..count {
                cx.background_executor().timer(HOLD).await;
                let _ = handle.update(cx, |view, _, cx| {
                    view.k = k;
                    cx.notify();
                });
            }
            cx.background_executor().timer(LAST).await;
            cx.update(|cx| cx.quit());
        })
        .detach();
    });
    std::process::exit(0)
}
