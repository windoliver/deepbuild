//! Issue #1434: the `chrome@1` fixture its acceptance tests draw (tests/acceptance/1434/README.md), in no shipped
//! build: nodes with fills, text, layers, backdrops and effect slots, drawn through the app's own chrome primitives
//! (`chrome_fx`), and the shell's question card in its slot. `DEEP_CHROME_PLANT` selects a wrong program, read only
//! here.

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

/// A `chrome@1` fixture.
#[derive(Clone, Debug)]
pub struct Fixture {
    /// The window, in points.
    pub window: [f32; 2],
    pub scale: f32,
    pub background: [u8; 3],
    pub nodes: Vec<Value>,
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
        let background = floats::<3>(&v["background"], "background")?.map(|c| c as u8);
        Ok(Fixture {
            window: floats(&v["window"], "window")?,
            scale: v["scale"].as_f64().unwrap_or(1.0) as f32,
            background,
            nodes: v["nodes"].as_array().cloned().unwrap_or_default(),
            card,
        })
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

/// The fixture drawn as the window's content.
pub struct ChromeView {
    pub fixture: Fixture,
}

fn color(c: &Value) -> Option<Rgba> {
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

fn effect(n: &Value) -> Option<Effect> {
    let e = &n["effect"];
    let operator = e["operator"].as_str()?;
    let params = match deep_effects_render::chrome::params(operator, &e["params"]) {
        Ok(params) => params,
        Err(why) => {
            eprintln!("deep-app: chrome fixture: {why}");
            Vec::new()
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
    })
}

/// A node at its rect, relative to its parent's origin: its under slot, fill, text, children and over slot.
fn node(n: &Value, parent: [f32; 2]) -> AnyElement {
    let [x, y, w, h] = rect(n);
    let radius = px(n["radius"].as_f64().unwrap_or(0.0) as f32);
    let (first, last) = match effect(n) {
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
    let text = n["text"]["content"].as_str().map(|content| {
        let t = &n["text"];
        div()
            .absolute()
            .left_0()
            .top_0()
            .text_size(px(t["size"].as_f64().unwrap_or(14.0) as f32))
            .text_color(color(&t["color"]).unwrap_or(Rgba {
                r: 0.,
                g: 0.,
                b: 0.,
                a: 1.,
            }))
            .whitespace_nowrap()
            .child(content.to_string())
            .into_any_element()
    });
    let children = n["children"]
        .as_array()
        .map(|c| c.iter().map(|c| node(c, [x, y])).collect::<Vec<_>>())
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
        .children(last);
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
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let [r, g, b] = self.fixture.background;
        div()
            .size_full()
            .relative()
            .bg(Rgba {
                r: f32::from(r) / 255.,
                g: f32::from(g) / 255.,
                b: f32::from(b) / 255.,
                a: 1.,
            })
            .child(chrome_fx::guards())
            .children(self.fixture.nodes.iter().map(|n| node(n, [0., 0.])))
    }
}

/// The report's refusals, as `chrome.json` lists them.
pub fn refusals_json() -> Value {
    Value::Array(
        chrome_fx::take_refusals()
            .into_iter()
            .map(|r| serde_json::json!({"effect": r.effect, "operator": r.operator, "over": r.over, "code": r.code}))
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
}

#[cfg(target_os = "macos")]
pub use live::run;

#[cfg(target_os = "macos")]
mod live {
    use std::time::{Duration, Instant};

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
                origin: point(px(120.), px(120.)),
                size: size(px(w), px(h)),
            })),
            kind: WindowKind::PopUp,
            ..Default::default()
        };
        let view = fixture.clone();
        open_window(options, cx, move |window, cx| {
            fixture.present_card(window, cx);
            visible(window, 0, move |window, cx| {
                settle(window, cx, 0, fixture, live)
            });
            cx.new(|_| ChromeView { fixture: view })
        })
        .expect("open the window");
        cx.activate(true);
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
