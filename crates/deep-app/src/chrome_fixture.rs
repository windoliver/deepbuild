//! Issue #1434: the `chrome@1` fixture its acceptance tests draw (tests/acceptance/1434/README.md), in no shipped
//! build: nodes with fills, text, layers, backdrops and effect slots, drawn through the app's own chrome primitives
//! (`chrome_fx`), and the shell's question card in its slot. `DEEP_CHROME_PLANT` selects a wrong program, read only
//! here.
//!
//! Issue #1436 (tests/acceptance/1436/README.md) adds chrome-fx@1's effects: colors may name a chrome role, a fixture
//! may be drawn as a working view over a record at a time, and an effect may carry a seed, bound params, the look or
//! panel that asked for it and the role it was set for. Its particles stop on the rect of every node with a fill but
//! its own and its ancestors, and on the card's slot.

use std::cell::RefCell;
use std::collections::BTreeSet;

use gpui_kit::*;
use serde_json::Value;

use crate::chrome_fx::{self, Effect, Layer, Place};

/// Whether `DEEP_CHROME_PLANT` names this wrong program.
pub fn planted(name: &str) -> bool {
    std::env::var("DEEP_CHROME_PLANT").is_ok_and(|p| p == name)
}

/// Plants the renderer's wrong programs `DEEP_CHROME_PLANT` names, before anything draws.
pub fn apply_plants() {
    if planted("multiplies_per_element") {
        plant_multiplies_per_element();
    }
    if planted("effect_above_card") {
        plant_effects_after_frame();
    }
    #[cfg(target_os = "macos")]
    if planted("straight_alpha_slot") {
        use gpui_apple::metal_renderer::chrome_layers::{plant, Planted};
        plant(Planted::StraightAlpha);
    }
}

/// The planted operator criterion 7 adds (#1436): the whole rect a flat grey that flips between dark and light four
/// times a second, which the pack check must refuse for its rate.
const PLANTED_FLASH: &str = r#"{
  "class": "quiet", "params": ["rate"], "still": {"time": 0}, "cost": {"ms": 0.01},
  "fixture": {"size": [48, 32], "at": 0, "params": {}, "expect": [[1, 1, [179, 179, 179]], [24, 16, [179, 179, 179]]]},
  "twin": {}, "graph": {
    "id": "planted.flash@1", "kind": "pass", "origin": "pack", "about": "Flips its rect between two greys `rate` times a second.",
    "inputs": {
      "src": {"type": "texture", "from": {"texture": {"target": {"op": "core", "output": "color"}}}},
      "time": {"type": "f32", "unit": "s", "from": {"param": "time"}, "range": [0, 1000000], "default": 0},
      "rate": {"type": "f32", "unit": "1/s", "from": {"param": "rate"}, "range": [0, 60], "default": 4}
    },
    "steps": {
      "uv": {"op": "screen_uv@1"},
      "under": {"op": "sample@1", "args": {"tex": "src", "uv": "uv", "lod": 0.0}},
      "n": {"op": "mul@1", "args": {"a": "time", "b": "rate"}},
      "f": {"op": "fract@1", "args": {"x": "n"}},
      "on": {"op": "lt@1", "args": {"a": "f", "b": 0.5}},
      "v": {"op": "select@1", "args": {"f": 0.1, "t": 0.7, "cond": "on"}},
      "out": {"op": "compose@1", "args": {"x": "v", "y": "v", "z": "v", "w": 1.0}}
    },
    "outputs": {"color": "out", "blend": "replace"}, "cost": {"ns_per_px": 0.01}, "resolution": "full"
  }
}"#;

/// The pack check on `pack` under the plant `DEEP_CHROME_PLANT` names: `twin:<operator>` swaps that operator for its
/// planted twin, and `flashes_4hz` adds `planted.flash`.
pub fn check_pack(mut pack: Value) -> Value {
    use deep_canvas_effects::chrome_fx;
    let plant = std::env::var("DEEP_CHROME_PLANT").unwrap_or_default();
    if let Some(name) = plant.strip_prefix("twin:") {
        chrome_fx::plant_twin(&mut pack, name);
    }
    if plant == "flashes_4hz" {
        let flash: Value =
            serde_json::from_str(PLANTED_FLASH).expect("the planted operator is JSON");
        if let Some(ops) = pack["operators"].as_object_mut() {
            ops.insert("planted.flash".into(), flash);
        }
    }
    chrome_fx::check_pack(&pack)
}

thread_local! {
    static OMITTED: RefCell<BTreeSet<String>> = const { RefCell::new(BTreeSet::new()) };
}

/// Takes the named nodes' effect slots out of every frame.
pub fn omit(ids: impl IntoIterator<Item = String>) {
    OMITTED.with(|o| o.borrow_mut().extend(ids));
}

pub fn omitted(name: &str) -> bool {
    OMITTED.with(|o| o.borrow().contains(name))
}

thread_local! {
    static NO_TEXT: RefCell<BTreeSet<String>> = const { RefCell::new(BTreeSet::new()) };
}

/// Takes the named nodes' glyphs out of every frame, leaving everything else as it is.
pub fn omit_text(ids: impl IntoIterator<Item = String>) {
    NO_TEXT.with(|o| o.borrow_mut().extend(ids));
}

/// A `chrome@1` fixture.
#[derive(Clone, Debug)]
pub struct Fixture {
    /// The window, in points.
    pub window: [f32; 2],
    pub scale: f32,
    /// An 8-bit color, or a chrome role's name.
    pub background: Value,
    pub nodes: Vec<Value>,
    /// The working view the nodes are drawn as, if they are one.
    pub view: Option<String>,
    /// The readings the record's events hold, as the app's one reader folds them.
    pub readings: std::collections::BTreeMap<String, (f64, u64)>,
    /// The question card: its question, options and slot in points.
    pub card: Option<(String, Vec<String>, [f32; 4])>,
}

fn floats<const N: usize>(v: &Value, what: &str) -> Result<[f32; N], String> {
    let a = v
        .as_array()
        .filter(|a| a.len() == N)
        .ok_or(format!("{what} takes {N} numbers"))?;
    let mut out = [0.; N];
    for (o, x) in out.iter_mut().zip(a) {
        *o = x.as_f64().ok_or(format!("{what} takes numbers"))? as f32;
    }
    Ok(out)
}

impl Fixture {
    pub fn read(path: &std::path::Path) -> Result<Fixture, String> {
        let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let v: Value =
            serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        if v["format"] != "chrome@1" {
            return Err(format!("{}: not a chrome@1 fixture", path.display()));
        }
        let card = match &v["card"] {
            Value::Null => None,
            card => {
                let question = card["question"]
                    .as_str()
                    .ok_or("the card has no question")?
                    .to_string();
                let options = card["options"]
                    .as_array()
                    .map(|o| {
                        o.iter()
                            .filter_map(|o| o["label"].as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default();
                Some((question, options, floats(&card["rect"], "the card's rect")?))
            }
        };
        let mut table = crate::states::Table::default();
        for event in v["record"].as_array().into_iter().flatten() {
            table.apply(event);
        }
        let nodes = v["nodes"].as_array().cloned().unwrap_or_default();
        let readings = handles(&nodes)
            .into_iter()
            .filter_map(|h| table.value(&h).map(|r| (h, r)))
            .collect();
        Ok(Fixture {
            window: floats(&v["window"], "window")?,
            scale: v["scale"].as_f64().unwrap_or(1.0) as f32,
            background: v["background"].clone(),
            nodes,
            view: v["view"].as_str().map(String::from),
            readings,
            card,
        })
    }

    /// Every rect a particle stops on: each node that draws a fill, by id, and the card's slot.
    fn fills(&self) -> Vec<Fill> {
        fn walk(nodes: &[Value], up: &[String], out: &mut Vec<Fill>) {
            for n in nodes {
                let id = n["id"].as_str().unwrap_or("").to_string();
                if !n["fill"].is_null() {
                    out.push((id.clone(), up.to_vec(), rect(n)));
                }
                let mut path = up.to_vec();
                path.push(id);
                walk(n["children"].as_array().map_or(&[][..], |c| c), &path, out);
            }
        }
        let mut out = Vec::new();
        walk(&self.nodes, &[], &mut out);
        if let Some((_, _, slot)) = &self.card {
            out.push(("card".into(), Vec::new(), *slot));
        }
        out
    }

    /// Every node with an effect, by id, in paint order.
    pub fn effects(&self) -> Vec<String> {
        fn walk(nodes: &[Value], out: &mut Vec<String>) {
            for n in nodes {
                if !n["effect"].is_null() {
                    out.push(n["id"].as_str().unwrap_or("").to_string());
                }
                walk(n["children"].as_array().map_or(&[][..], |c| c), out);
            }
        }
        let mut out = Vec::new();
        walk(&self.nodes, &mut out);
        out
    }

    /// Presents the card in its slot, as the shell does.
    pub fn present_card(&self, window: &mut Window, cx: &mut App) {
        if let Some((question, options, [x, y, w, h])) = &self.card {
            let options: Vec<&str> = options.iter().map(String::as_str).collect();
            let bounds = Bounds {
                origin: point(px(*x), px(*y)),
                size: size(px(*w), px(*h)),
            };
            crate::card::present(bounds, question, &options, window, cx);
        }
    }
}

/// Every reading handle a node's effect binds.
fn handles(nodes: &[Value]) -> Vec<String> {
    let mut out = Vec::new();
    for n in nodes {
        for (_, src) in n["effect"]["bind"].as_object().into_iter().flatten() {
            out.extend(src.as_str().map(String::from));
        }
        out.extend(handles(n["children"].as_array().map_or(&[][..], |c| c)));
    }
    out
}

/// The fixture drawn as the window's content.
pub struct ChromeView {
    pub fixture: Fixture,
}

fn color(c: &Value) -> Option<Rgba> {
    if let Some(role) = c.as_str() {
        return ROLES.with(|r| r.get()).named(role).map(Rgba::from);
    }
    let a = c.as_array()?;
    let at = |i: usize| a.get(i).and_then(Value::as_f64).unwrap_or(255.0) as f32 / 255.0;
    Some(Rgba {
        r: at(0),
        g: at(1),
        b: at(2),
        a: if a.len() > 3 { at(3) } else { 1.0 },
    })
}

fn rect(n: &Value) -> [f32; 4] {
    floats(&n["rect"], "rect").unwrap_or([0.; 4])
}

/// A filled node a particle stops on: its id, its ancestors' ids and its rect.
type Fill = (String, Vec<String>, [f32; 4]);

thread_local! {
    /// The chrome roles of the frame being built, in its window's appearance.
    static ROLES: std::cell::Cell<&'static crate::chrome::Chrome> = std::cell::Cell::new(crate::chrome::chrome(false));
    /// The fixture being built: its view and the rects its particles stop on.
    static BUILDING: RefCell<(Option<String>, Vec<Fill>)> = const { RefCell::new((None, Vec::new())) };
}

fn effect(n: &Value, up: &[String]) -> Option<Effect> {
    let e = &n["effect"];
    let operator = e["operator"].as_str()?;
    let id = n["id"].as_str().unwrap_or("").to_string();
    let fx = chrome_fx::operator(operator).map(|_| {
        let (view, fills) = BUILDING.with(|b| b.borrow().clone());
        chrome_fx::Fx {
            params: e["params"].as_object().cloned().unwrap_or_default(),
            seed: e["seed"].as_u64().unwrap_or(0) as u32,
            bind: e["bind"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            asked: e["asked"]["by"]
                .as_str()
                .is_some_and(|by| by == "look" || by == "panel"),
            on: e["on"].as_str().map(String::from),
            view,
            hold: false,
            colliders: fills
                .into_iter()
                .filter(|(other, _, _)| *other != id && !up.contains(other))
                .map(|(other, _, [x, y, w, h])| {
                    (
                        other,
                        Bounds {
                            origin: point(px(x), px(y)),
                            size: size(px(w), px(h)),
                        },
                    )
                })
                .collect(),
        }
    });
    let params = if fx.is_some() {
        Vec::new()
    } else {
        match deep_effects_render::chrome::params(operator, &e["params"]) {
            Ok(params) => params,
            Err(why) => {
                eprintln!("deep-app: chrome fixture: {why}");
                Vec::new()
            }
        }
    };
    let backdrop = n["backdrop"]["scale"]
        .as_f64()
        .and_then(|s| BackdropScale::from_factor(s as f32));
    let radius = px(n["radius"].as_f64().unwrap_or(0.0) as f32);
    Some(Effect {
        name: n["id"].as_str().unwrap_or("").to_string().into(),
        operator: operator.to_string().into(),
        params,
        backdrop,
        radii: Corners::all(radius),
        place: if e["place"] == "under" {
            Place::Under
        } else {
            Place::Over
        },
        fx,
    })
}

/// Each text node's rect inside `n` (its own too), in window points.
fn texts(n: &Value, out: &mut Vec<[f32; 4]>) {
    if n["text"].is_object() {
        out.push(rect(n));
    }
    for c in n["children"].as_array().into_iter().flatten() {
        texts(c, out);
    }
}

/// A node at its rect, relative to its parent's origin: its under slot, fill, text, children and over slot.
fn node(n: &Value, parent: [f32; 2], up: &[String]) -> AnyElement {
    let [x, y, w, h] = rect(n);
    let id = n["id"].as_str().unwrap_or("").to_string();
    let radius = px(n["radius"].as_f64().unwrap_or(0.0) as f32);
    // The planted effect that covers its texts with the secondary ink from 3 s on (#1436, criterion 5).
    let dropped: Vec<AnyElement> =
        if planted("drops_secondary_ink") && !n["effect"].is_null() && chrome_fx::clock() >= 3.0 {
            let mut rects = Vec::new();
            texts(n, &mut rects);
            let ink = ROLES.with(|r| r.get()).ink_secondary;
            let ink = Hsla { a: 1.0, ..ink };
            rects
                .into_iter()
                .map(|[tx, ty, tw, th]| {
                    div()
                        .absolute()
                        .left(px(tx - x))
                        .top(px(ty - y))
                        .w(px(tw))
                        .h(px(th))
                        .bg(ink)
                        .into_any_element()
                })
                .collect()
        } else {
            Vec::new()
        };
    let (first, last) = match effect(n, up) {
        Some(effect) => {
            let (first, last) = chrome_fx::slots(effect);
            (Some(first), last)
        }
        None => (None, None),
    };
    let fill = match &n["fill"] {
        Value::Null => None,
        Value::Object(o) => o.get("gradient").and_then(|g| {
            let g = g.as_array()?;
            let (a, b) = (color(g.first()?)?, color(g.get(1)?)?);
            Some(
                div()
                    .absolute()
                    .size_full()
                    .rounded(radius)
                    .bg(linear_gradient(
                        90.,
                        linear_color_stop(a, 0.),
                        linear_color_stop(b, 1.),
                    ))
                    .into_any_element(),
            )
        }),
        c => color(c).map(|c| {
            div()
                .absolute()
                .size_full()
                .rounded(radius)
                .bg(c)
                .into_any_element()
        }),
    };
    let glyphs = !NO_TEXT.with(|o| o.borrow().contains(&id));
    let text = n["text"]["content"].as_str().map(|content| {
        let t = &n["text"];
        div()
            .absolute()
            .left_0()
            .top_0()
            .text_size(px(t["size"].as_f64().unwrap_or(14.0) as f32)) // size-literal-exception: a #1434 check fixture, in no shipped build; review 2027-04-30
            .text_color(match color(&t["color"]) {
                // Its glyphs taken out, its layout kept: the same text, drawn clear.
                Some(c) if !glyphs => Rgba { a: 0., ..c },
                Some(c) => c,
                None => Rgba {
                    r: 0.,
                    g: 0.,
                    b: 0.,
                    a: if glyphs { 1. } else { 0. },
                },
            })
            .whitespace_nowrap()
            .child(content.to_string())
            .into_any_element()
    });
    let mut path = up.to_vec();
    path.push(id);
    let children = n["children"]
        .as_array()
        .map(|c| c.iter().map(|c| node(c, [x, y], &path)).collect::<Vec<_>>())
        .unwrap_or_default();
    let element = div()
        .absolute()
        .left(px(x - parent[0]))
        .top(px(y - parent[1]))
        .w(px(w))
        .h(px(h))
        .children(first)
        .children(fill)
        .children(text)
        .children(children)
        .children(last)
        .children(dropped);
    let element = match n["layer"].as_object() {
        Some(l) => {
            let radii = floats::<4>(&n["layer"]["radii"], "radii")
                .unwrap_or([0.; 4])
                .map(px);
            chrome_fx::layer(
                Layer {
                    opacity: l.get("opacity").and_then(Value::as_f64).unwrap_or(1.0) as f32,
                    radii: Corners {
                        top_left: radii[0],
                        top_right: radii[1],
                        bottom_right: radii[2],
                        bottom_left: radii[3],
                    },
                    edge: px(l.get("edge").and_then(Value::as_f64).unwrap_or(0.0) as f32),
                },
                element,
            )
            .into_any_element()
        }
        None => element.into_any_element(),
    };
    if n["deferred"] == true {
        deferred(element).into_any_element()
    } else {
        element
    }
}

impl Render for ChromeView {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        ROLES.with(|r| r.set(crate::chrome::of(window)));
        BUILDING.with(|b| *b.borrow_mut() = (self.fixture.view.clone(), self.fixture.fills()));
        chrome_fx::set_readings(self.fixture.readings.clone());
        chrome_fx::begin_frame();
        let background = color(&self.fixture.background).unwrap_or(Rgba {
            r: 1.,
            g: 1.,
            b: 1.,
            a: 1.,
        });
        div()
            .size_full()
            .relative()
            .bg(background)
            .child(chrome_fx::guards())
            .children(self.fixture.nodes.iter().map(|n| node(n, [0., 0.], &[])))
            .child(chrome_fx::embers())
    }
}

/// The report's refusals, as `chrome.json` lists them.
pub fn refusals_json() -> Value {
    Value::Array(
        chrome_fx::take_refusals()
            .iter()
            .map(chrome_fx::Refusal::to_json)
            .collect(),
    )
}

/// What `deep-app --chrome <fixture>` does with the app's real window.
#[derive(Clone, Debug, PartialEq)]
pub enum Live {
    /// Reads back the drawable the window presented and writes it as a PNG.
    Snapshot(std::path::PathBuf),
    /// Holds the settled window for that many seconds and counts its frames and wakeups.
    Idle(u64),
    /// Draws that many frames back to back, the whole tree repainted each, timing each.
    Frames(u64),
    /// Counts the frames presented in that many seconds after the first once the window shows (#1436).
    AfterFirst(f64),
}

#[cfg(target_os = "macos")]
pub use live::run;

#[cfg(target_os = "macos")]
mod live {
    use std::cell::Cell;
    use std::time::{Duration, Instant};

    use objc2::msg_send;

    use gpui_apple::metal_renderer::{gpu_ledger, layer_colorspace};
    use gpui_kit::*;
    use objc2_app_kit::{NSView, NSWindowOcclusionState};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use serde_json::{json, Value};

    use super::{apply_plants, ChromeView, Fixture, Live};

    /// The process's package-idle wakeups so far, every thread's, as the kernel counts them.
    fn wakeups() -> u64 {
        // SAFETY: an all-zero rusage_info_v4 is valid for the call to fill, and it's the flavor asked for.
        let mut info: libc::rusage_info_v4 = unsafe { std::mem::zeroed() };
        unsafe {
            libc::proc_pid_rusage(
                libc::getpid(),
                libc::RUSAGE_INFO_V4,
                (&raw mut info).cast::<libc::rusage_info_t>(),
            );
        }
        info.ri_pkg_idle_wkups
    }

    /// This thread's CPU time, in ms.
    fn thread_cpu_ms() -> f64 {
        // SAFETY: a zeroed timespec for clock_gettime to fill.
        let mut t: libc::timespec = unsafe { std::mem::zeroed() };
        unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
        t.tv_sec as f64 * 1e3 + t.tv_nsec as f64 / 1e6
    }

    fn report(mode: &str, scale: f32, rest: Value) {
        let mut line = json!({"chrome": 1434, "mode": mode, "scale": scale});
        if let (Some(line), Value::Object(rest)) = (line.as_object_mut(), rest) {
            line.extend(rest);
        }
        println!("{line}");
    }

    pub fn run(fixture: Fixture, live: Live, cx: &mut App) {
        apply_plants();
        let [w, h] = fixture.window;
        // Above every other window, so the platform reports it visible and hands out drawables.
        let options = WindowOptions {
            // At a whole point, so the drawable is the window's size in device px exactly.
            window_bounds: Some(WindowBounds::Windowed(Bounds {
                origin: point(px(120.), px(120.)), // size-literal-exception: a #1434 check fixture, in no shipped build; review 2027-04-30
                size: size(px(w), px(h)),
            })),
            kind: WindowKind::PopUp,
            // The after-first count is of what the app draws by itself, so its window never takes the keyboard: on a
            // shared desktop, another app taking it back redraws the window (#1436). It's shown below, once it can't.
            focus: !matches!(live, Live::AfterFirst(_)),
            show: !matches!(live, Live::AfterFirst(_)),
            ..Default::default()
        };
        let counting = !options.focus;
        let view = fixture.clone();
        open_window(options, cx, move |window, cx| {
            if counting {
                // Nor does it take the pointer: a click or a drag passing over it would redraw it too.
                if let Some(native) = window_view(window).window() {
                    native.setIgnoresMouseEvents(true);
                    // SAFETY: GPUI makes a pop-up an NSPanel, which has this property.
                    let _: () = unsafe { msg_send![&*native, setBecomesKeyOnlyIfNeeded: true] };
                    native.orderFrontRegardless();
                }
            }
            fixture.present_card(window, cx);
            visible(window, 0, move |window, cx| match live {
                Live::AfterFirst(seconds) => {
                    after_first(window, cx, fixture, seconds, Instant::now())
                }
                live => settle(window, cx, 0, fixture, live),
            });
            cx.new(|cx| {
                if counting {
                    // GPUI redraws the window when AppKit tells it its screen, which can land after the window shows;
                    // the window can't move, resize or take the keyboard, so nothing else changes its bounds.
                    cx.observe_window_bounds(window, |_, _, _| SCREENED.set(true))
                        .detach();
                }
                ChromeView { fixture: view }
            })
        })
        .expect("open the window");
        if !counting {
            cx.activate(true);
        }
    }

    fn window_view(window: &Window) -> &NSView {
        let handle = HasWindowHandle::window_handle(window).expect("the window's handle");
        let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
            panic!("an AppKit window");
        };
        // SAFETY: gpui's AppKit handle wraps its NSView, alive while the gpui window is.
        unsafe { handle.ns_view.cast::<NSView>().as_ref() }
    }

    /// Runs `then` on the first frame after AppKit reports the window visible, or after 240 frames.
    fn visible(
        window: &mut Window,
        frames: u32,
        then: impl FnOnce(&mut Window, &mut App) + 'static,
    ) {
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

    thread_local! {
        /// Whether GPUI has been told the counted window's screen.
        static SCREENED: Cell<bool> = const { Cell::new(false) };
    }

    /// From the window's first frame once shown, counts the frames it presents in `seconds` of the real clock, that
    /// frame not counted, and whether each effect painted in it. Shown means AppKit has told GPUI the window's screen,
    /// which redraws it, or a second has passed since it became visible: on a Mac17,10 the news came within 0.4 s of
    /// the window showing, or not at all.
    fn after_first(
        window: &mut Window,
        cx: &mut App,
        fixture: Fixture,
        seconds: f64,
        visible: Instant,
    ) {
        if !SCREENED.get() && visible.elapsed() < Duration::from_secs(1) {
            // A frame comes only when one is asked for; these come before the first frame, so none is counted.
            window.refresh();
            window.on_next_frame(move |window, cx| {
                after_first(window, cx, fixture, seconds, visible)
            });
            return;
        }
        let scale = window.scale_factor();
        let painted = crate::chrome_fx::states();
        let effects: Vec<Value> = fixture
            .effects()
            .into_iter()
            .map(|id| {
                let state = painted
                    .iter()
                    .find(|(n, _)| *n == id)
                    .map_or("unpainted", |(_, s)| s);
                json!({"id": id, "state": state})
            })
            .collect();
        // The first frame commits its command buffers after this callback returns, so the count starts in the task.
        cx.spawn(async move |cx| {
            let first = gpu_ledger::read().committed;
            let start = Instant::now();
            cx.background_executor()
                .timer(Duration::from_secs_f64(seconds))
                .await;
            let frames = gpu_ledger::read().committed - first;
            let held = start.elapsed().as_secs_f64();
            report(
                "after_first",
                scale,
                json!({"seconds": held, "frames": frames, "effects": effects}),
            );
            cx.update(|cx| cx.quit());
        })
        .detach();
    }

    /// Once every effect has painted and settled, and the GPU has finished what it was given, runs the mode.
    fn settle(window: &mut Window, cx: &mut App, tries: u32, fixture: Fixture, live: Live) {
        let painted: Vec<String> = crate::chrome_fx::states()
            .into_iter()
            .map(|(name, _)| name)
            .collect();
        let all = fixture.effects().iter().all(|id| painted.contains(id));
        let ledger = gpu_ledger::read();
        if (!all || ledger.completed < ledger.committed) && tries < 600 {
            window.refresh();
            window.on_next_frame(move |window, cx| settle(window, cx, tries + 1, fixture, live));
            return;
        }
        let scale = window.scale_factor();
        match live {
            Live::Snapshot(path) => {
                layer_colorspace::read_next_frame();
                window.refresh();
                read_back(window, 0, move |frame, cx| {
                    let written = frame.map(|f| f.save(&path).map_err(|e| e.to_string()));
                    let written = match written {
                        Some(Ok(())) => json!(path.display().to_string()),
                        Some(Err(why)) => json!({"error": why}),
                        None => json!({"error": "no frame was read back"}),
                    };
                    report("snapshot", scale, json!({"png": written}));
                    cx.quit();
                });
            }
            Live::Idle(seconds) => {
                let states: Vec<Value> = fixture
                    .effects()
                    .into_iter()
                    .map(|id| {
                        let state = crate::chrome_fx::states()
                            .into_iter()
                            .find(|(name, _)| *name == id)
                            .map_or("unpainted", |(_, s)| s);
                        json!({"id": id, "state": state})
                    })
                    .collect();
                cx.spawn(async move |cx| {
                    // The hold starts once the window has stopped drawing (no frame committed for 2 s), or after
                    // 10 s of a window that never stops, whose frames the hold then counts.
                    let (mut last, mut quiet, waited) = (gpu_ledger::read().committed, 0, Instant::now());
                    while quiet < 4 && waited.elapsed() < Duration::from_secs(10) {
                        cx.background_executor().timer(Duration::from_millis(500)).await;
                        let now = gpu_ledger::read().committed;
                        quiet = if now == last { quiet + 1 } else { 0 };
                        last = now;
                    }
                    let (frames, woken, start) = (gpu_ledger::read().committed, wakeups(), Instant::now());
                    cx.background_executor().timer(Duration::from_secs(seconds)).await;
                    let (frames, woken) = (gpu_ledger::read().committed - frames, wakeups() - woken);
                    let held = start.elapsed().as_secs_f64();
                    report(
                        "idle",
                        scale,
                        json!({"effects": states, "seconds": held, "frames": frames, "wakeups": woken}),
                    );
                    cx.update(|cx| cx.quit());
                })
                .detach();
            }
            Live::Frames(n) => {
                let start = (thread_cpu_ms(), gpu_ledger::read().gpu_ns);
                frame(window, 1, n, start, Vec::new(), scale);
            }
            Live::AfterFirst(seconds) => after_first(window, cx, fixture, seconds, Instant::now()),
        }
    }

    /// Times frame `at` of `n`: the UI thread's CPU since the last frame, and the GPU time completed since.
    fn frame(
        window: &mut Window,
        at: u64,
        n: u64,
        last: (f64, u64),
        mut frames: Vec<Value>,
        scale: f32,
    ) {
        window.refresh();
        window.on_next_frame(move |window, cx| {
            // The frame before has been committed; its GPU time counts once it completes.
            let deadline = Instant::now() + Duration::from_millis(250);
            while gpu_ledger::read().completed < gpu_ledger::read().committed
                && Instant::now() < deadline
            {
                std::thread::sleep(Duration::from_micros(100));
            }
            let now = (thread_cpu_ms(), gpu_ledger::read().gpu_ns);
            frames.push(json!({
                "frame": at,
                "cpu_ms": now.0 - last.0,
                "gpu_ms": now.1.saturating_sub(last.1) as f64 / 1e6,
            }));
            if at >= n {
                report("frames", scale, json!({"frames": frames}));
                cx.quit();
            } else {
                frame(window, at + 1, n, now, frames, scale);
            }
        });
    }

    fn read_back(
        window: &mut Window,
        tries: u32,
        done: impl FnOnce(Option<image::RgbaImage>, &mut App) + 'static,
    ) {
        window.on_next_frame(move |window, cx| match layer_colorspace::take_frame() {
            Some(frame) => done(Some(frame), cx),
            None if tries < 120 => {
                window.refresh();
                read_back(window, tries + 1, done);
            }
            None => done(None, cx),
        });
    }
}
