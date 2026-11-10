//! #2117, a bound value in a panel redraws when what it shows changes, not once a second: written blind from the
//! issue, docs/technical-design.md (Bound value in panels), docs/canvas-primitives.md (Bound value; Frame clock and
//! scheduler; Invalidation and damage) and the merge base 4ab2750c, before any implementation. ../README.md says what
//! was read, the surface these reach and what each plant must do.
//!
//!   AC1 `#2117.789c5dd8`  ac1_*  a still panel held 60 s: after the first frame, 0 renders and 0 frames
//!   AC2 `#2117.ebc91643`  ac2_*  the frame at as-of + stale_after draws the value muted with its age; no frame before
//!   AC3 `#2117.426efcc0`  ac3_*  while stale, one render for each change of the age it shows, none between
//!   AC4 `#2117.0504b71f`  ac4_*  a new reading shows within 2 frames of the reader holding it, no other view notified
//!   AC5 `#2117.2a24617a`  ac5_*  a reading equal to the one shown renders 0 views and draws 0 frames
//!   plant_panel_ticks_*             AC1's wrong program, a timer that notifies every second: fails naming the view
//!   plant_panel_grays_on_reading_*  AC2's wrong program, a panel that grays on the next reading: fails naming the element
//!   plant_panel_waits_for_redraw_*  AC4's wrong program, a panel that waits for another view's redraw: fails naming the
//!                                   source
//!
//! The window holds the app's `BoundPanel` alone, made as `deep-app --panel <dir>` makes it (`panel_values::elements`
//! of fixtures/panel, then `BoundPanel::new`), over a view standing in for the panel's script, inside a content view,
//! in a window opened as the app opens one (`gpui_kit::open_window`), on the headless renderer and GPUI's virtual
//! clock. The record is the app's one reader holding a record in memory (`record::install_local`); a new reading
//! reaches it as the hub's stream delivers one (`record::deliver`). The views' clock (`views::set_clock`) and GPUI's
//! move together, a millisecond at a time, and at each 60 Hz vsync the window gets one frame request with no forced
//! render (`HeadlessAppContext::request_frame`, after `draw_on_request` turns off the test mode's drawing at the end
//! of every update), so it draws only when GPUI holds it dirty. What a frame drew of the
//! bound line is what the canvas text recorded painting in it (`canvas::items`, `canvas::placed`); the role it is drawn
//! in is read off the frame's pixels (`capture_screenshot`). Each test runs in a process of its own (this binary, run
//! again with `DA2117_ONE` naming it), so no thread-local of one test's app reaches another's.
//!
//! Wired into deep-app by a `[[test]]` entry (`acceptance_2117`, no harness: AppKit wants the main thread). Run with
//! `cargo test --locked -p deep-app --test acceptance_2117`; a plant with its feature and its name, as
//! `cargo test --locked -p deep-app --features plant-panel-ticks --test acceptance_2117 -- plant_panel_ticks`.

use std::cell::{Cell, RefCell};
use std::path::Path;
use std::process::Command;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use deep_app::chrome::Chrome;
use deep_app::panel_values::{elements, BoundPanel};
use deep_canvas_marks::scene::{bound_text, Record, Shown};
use gpui_kit::assets::Assets;
use gpui_kit::*;
use serde_json::{json, Map, Value};

/// The views' clock at the first frame, in ms since the epoch (the replica's NOW).
const T0: u64 = 1_800_000_000_000;
/// The plug-in panel: one bound line, `price`, of `reading:quotes` in USD, stale after 120 s.
const PANEL: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../tests/acceptance/2117/fixtures/panel"
);
const LINE: &str = "price";
const SOURCE: &str = "reading:quotes";
const STALE_AFTER: u64 = 120_000;
const VALUE: f64 = 182.4;
const NEW_VALUE: f64 = 190.1;
const WINDOW: (f32, f32) = (640., 400.);
/// Flicks in a ms, the bound value's clock.
const FLICKS_PER_MS: i64 = 705_600;
/// The variable that makes this binary run the one test it names, and the line that test answers with.
const ONE: &str = "DA2117_ONE";
const RESULT: &str = "da2117-result ";

/// Vsync `k`'s time in ms after the first frame: 60 Hz, each on a whole ms, every third on exactly 50 ms more.
fn at(k: u64) -> u64 {
    k * 1000 / 60
}

/// A time after the first frame, as the messages say it.
fn secs(ms: u64) -> String {
    format!("{}.{:03} s", ms / 1000, ms % 1000)
}

/// A reading of `reading:quotes` as the record holds it.
fn reading(log_pos: u64, value: f64, as_of: u64) -> Value {
    json!({"v": 1, "id": format!("r{log_pos}"), "kind": "reading.recorded", "writer": "core", "log_pos": log_pos,
           "ts": as_of, "data": {"reading": SOURCE, "value": value, "as_of": as_of}})
}

fn bump(n: &Cell<u64>) {
    n.set(n.get() + 1);
}

/// The window's content: the bound panel on the look's ground. It counts its renders.
struct Content {
    panel: Entity<BoundPanel>,
    renders: Rc<Cell<u64>>,
}

impl Render for Content {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        bump(&self.renders);
        div()
            .size_full()
            .bg(deep_app::chrome::of(window).ground)
            .child(self.panel.clone())
    }
}

/// What stands in for the panel's script: it draws nothing and counts its renders.
struct Script {
    renders: Rc<Cell<u64>>,
}

impl Render for Script {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        bump(&self.renders);
        div().size_full()
    }
}

/// Where a setup step that should work doesn't: BLOCKED on macOS, where it must; INCONCLUSIVE elsewhere.
fn unavailable(what: &str) -> String {
    if cfg!(target_os = "macos") {
        format!("BLOCKED: {what}")
    } else {
        format!("INCONCLUSIVE: {what}; the reference Macs draw the panel, so nothing was judged")
    }
}

/// The bound line the frame just drawn painted: its text and where, in window points.
fn painted() -> Option<(String, Bounds<Pixels>)> {
    let items = deep_app::canvas::items();
    let text = items.iter().find(|(id, _)| id == LINE)?.1["text"]
        .as_str()?
        .to_owned();
    let bounds = deep_app::canvas::placed()
        .into_iter()
        .find(|(id, _)| id == LINE)?
        .1;
    Some((text, bounds))
}

/// The window, its two clocks and what its views did since the count began.
struct Harness {
    cx: HeadlessAppContext,
    window: AnyWindowHandle,
    /// The line's `bind`, as `panel_values::elements` read it.
    bind: Value,
    /// Both clocks, in ms after the first frame.
    now: u64,
    /// The vsyncs since the first frame.
    k: u64,
    content: Rc<Cell<u64>>,
    script: Rc<Cell<u64>>,
    /// How many times each view was notified: BoundPanel, the window's content, the panel's script.
    notified: [(&'static str, Rc<Cell<u64>>); 3],
    /// Each frame the window drew since the count began: its vsync, and the line's text where the panel painted it.
    drawn: Vec<(u64, Option<String>)>,
    /// The line as the window shows it: the text and place of the last frame that painted it.
    shows: String,
    bounds: Option<Bounds<Pixels>>,
    _observing: Vec<Subscription>,
}

/// The window over a record of `events`, its first frame drawn at T0, and the count begun after it.
fn open(events: Vec<Value>) -> Result<Harness, String> {
    let binds = elements(Path::new(PANEL));
    let bind = match binds.as_slice() {
        [(id, bind)] if id == LINE && bind["stale_after"].as_u64() == Some(STALE_AFTER) => bind.clone(),
        _ => {
            return Err(format!(
                "BLOCKED: {PANEL}/panel.json holds one bound element, `{LINE}`, stale after {STALE_AFTER} ms; \
                 panel_values::elements read {binds:?}"
            ))
        }
    };
    deep_app::views::set_clock(T0);
    deep_app::record::install_local(events);
    let mut cx = HeadlessAppContext::with_platform(
        gpui_kit::platform::current_platform(true).text_system(),
        Arc::new(Assets),
        gpui_kit::platform::current_headless_renderer,
    );
    cx.update(|cx| {
        gpui_kit::init(cx);
        deep_app::init(cx);
    });
    let (content, script) = (Rc::new(Cell::new(0)), Rc::new(Cell::new(0)));
    let made = RefCell::new(None);
    let options = WindowOptions {
        window_bounds: Some(WindowBounds::Windowed(Bounds {
            origin: Point::default(),
            size: size(px(WINDOW.0), px(WINDOW.1)),
        })),
        titlebar: None,
        focus: false,
        show: false,
        // Frames are paced by the virtual clock's vsyncs alone, never by the wall clock's throttle (as #1546's replica).
        inactive_frame_interval: None,
        ..Default::default()
    };
    let (window, root) = cx
        .update(|cx| {
            gpui_kit::open_window(options, cx, |_, cx| {
                let stand_in = cx.new(|_| Script {
                    renders: script.clone(),
                });
                let view: AnyView = stand_in.clone().into();
                let panel = cx.new(|cx| BoundPanel::new(view, binds.clone(), cx));
                *made.borrow_mut() = Some((panel.clone(), stand_in));
                cx.new(|_| Content {
                    panel,
                    renders: content.clone(),
                })
            })
        })
        .map_err(|e| unavailable(&format!("no window ({e})")))?;
    let (panel, stand_in) = made.into_inner().expect("the window was built");
    let counter = || Rc::new(Cell::new(0));
    let notified = [
        ("BoundPanel", counter()),
        ("the window's content", counter()),
        ("the panel's script", counter()),
    ];
    let observing = cx.update(|cx| {
        let n = notified[0].1.clone();
        let a = cx.observe(&panel, move |_, _| bump(&n));
        let n = notified[1].1.clone();
        let b = cx.observe(&root, move |_, _| bump(&n));
        let n = notified[2].1.clone();
        let c = cx.observe(&stand_in, move |_, _| bump(&n));
        vec![a, b, c]
    });
    // GPUI's test mode draws a dirty window at the end of every update; from here on it draws only when a frame
    // request asks, as a real window does (#1546's `draw_on_request`). The first frame is the one drawn at T0.
    cx.run_until_parked();
    cx.draw_on_request();
    let drew = cx.request_frame(window);
    let Some((shows, bounds)) = painted() else {
        return Err(format!(
            "BLOCKED: the window's first frame (drawn: {drew}) painted no bound line `{LINE}`"
        ));
    };
    let mut h = Harness {
        cx,
        window,
        bind,
        now: 0,
        k: 0,
        content,
        script,
        notified,
        drawn: Vec::new(),
        shows,
        bounds: Some(bounds),
        _observing: observing,
    };
    h.reset();
    Ok(h)
}

impl Harness {
    /// The count begins again: no frame drawn, no view rendered or notified.
    fn reset(&mut self) {
        self.drawn.clear();
        self.content.set(0);
        self.script.set(0);
        for (_, n) in &self.notified {
            n.set(0);
        }
    }

    /// The next vsync: both clocks moved to its time a millisecond at a time, each timer due run at its own
    /// millisecond, then one frame request with no forced render. Whether the window drew.
    fn vsync(&mut self) -> bool {
        self.k += 1;
        while self.now < at(self.k) {
            self.now += 1;
            deep_app::views::set_clock(T0 + self.now);
            self.cx.advance_clock(Duration::from_millis(1));
            self.cx.run_until_parked();
        }
        deep_app::canvas::clear_items();
        let drew = self.cx.request_frame(self.window);
        if drew {
            let line = painted();
            if let Some((text, bounds)) = &line {
                self.shows = text.clone();
                self.bounds = Some(*bounds);
            }
            self.drawn.push((self.k, line.map(|(text, _)| text)));
        }
        drew
    }

    fn hold_to(&mut self, k: u64) {
        while self.k < k {
            self.vsync();
        }
    }

    /// The frames the panel painted its line in since the count began: its renders.
    fn renders(&self) -> usize {
        self.drawn.iter().filter(|(_, line)| line.is_some()).count()
    }

    fn views_rendered(&self) -> u64 {
        self.renders() as u64 + self.content.get() + self.script.get()
    }

    fn notifies(&self, view: usize) -> u64 {
        self.notified[view].1.get()
    }

    /// What the window and each view did since the count began, in words.
    fn tally(&self) -> String {
        format!(
            "the window drew {} frames; BoundPanel rendered its bound line `{LINE}` {} times and was notified {} \
             times; the panel's script rendered {} times and was notified {}; the window's content rendered {} times \
             and was notified {}",
            self.drawn.len(),
            self.renders(),
            self.notifies(0),
            self.script.get(),
            self.notifies(2),
            self.content.get(),
            self.notifies(1),
        )
    }

    /// The line as a frame `ms` after the first shows it from a reading `(value, as_of)`: the canvas's own
    /// bound-value text, as the panel's `bind` asks for it (#1172).
    fn expected(&self, value: f64, as_of: u64, ms: u64) -> Shown {
        let mut bound = Map::new();
        bound.insert("target".into(), json!("items/v/params/text"));
        bound.insert("source".into(), json!(SOURCE));
        for key in ["format", "missing"] {
            if let Some(v) = self.bind.get(key) {
                bound.insert(key.into(), v.clone());
            }
        }
        let after = self.bind["stale_after"].as_u64().unwrap_or(STALE_AFTER);
        bound.insert(
            "stale_after".into(),
            json!(format!("{}.{:03}s", after / 1000, after % 1000)),
        );
        let mut doc = Map::new();
        doc.insert("bound_values".into(), json!({ "v": bound }));
        let mut record = Record {
            pinned: (T0 + ms) as i64 * FLICKS_PER_MS,
            ..Record::default()
        };
        record.readings.insert(SOURCE.into(), value);
        record
            .as_of
            .insert(SOURCE.into(), as_of as i64 * FLICKS_PER_MS);
        bound_text(&doc, "v", &json!({}), &record, "en")
            .ok()
            .flatten()
            .expect("the canvas shows the fixture's bound value")
    }

    /// The role the window's last drawn frame draws the line in, read off its pixels: of the look's muted,
    /// ink_primary and ink_secondary, the one nearest the line's ink (its pixel farthest from the ground), and the ink.
    fn role(&mut self) -> Result<(&'static str, [u8; 3]), String> {
        let bounds = self
            .bounds
            .ok_or_else(|| format!("BLOCKED: no frame painted `{LINE}`"))?;
        let chrome: Chrome = self
            .cx
            .update_window(self.window, |_, window, _| *deep_app::chrome::of(window))
            .map_err(|e| unavailable(&format!("the window can't be read ({e})")))?;
        let shot = self
            .cx
            .capture_screenshot(self.window)
            .map_err(|e| unavailable(&format!("the window can't be read back ({e})")))?;
        let scale = shot.width() as f32 / WINDOW.0;
        let edge = |at: Pixels, limit: u32, up: bool| {
            let v = f32::from(at) * scale;
            (if up { v.ceil() } else { v.floor() }).clamp(0., limit as f32) as u32
        };
        let (x0, x1) = (
            edge(bounds.origin.x, shot.width(), false),
            edge(bounds.origin.x + bounds.size.width, shot.width(), true),
        );
        let (y0, y1) = (
            edge(bounds.origin.y, shot.height(), false),
            edge(bounds.origin.y + bounds.size.height, shot.height(), true),
        );
        let ground = srgb(chrome.ground, chrome.ground);
        let mut ink = (0, ground);
        for y in y0..y1 {
            for x in x0..x1 {
                let p = shot.get_pixel(x, y).0;
                let rgb = [p[0], p[1], p[2]];
                let far = distance(rgb, ground);
                if far > ink.0 {
                    ink = (far, rgb);
                }
            }
        }
        // Less than 24 levels a channel from the ground is no ink at all.
        if ink.0 < 3 * 24 * 24 {
            return Err(format!(
                "FAIL: the frame's pixels hold no ink where `{LINE}` is drawn ({x0}..{x1} × {y0}..{y1} px)"
            ));
        }
        let roles = [
            ("muted", chrome.muted),
            ("ink_primary", chrome.ink_primary),
            ("ink_secondary", chrome.ink_secondary),
        ];
        let nearest = roles
            .iter()
            .min_by_key(|(_, role)| distance(ink.1, srgb(*role, chrome.ground)))
            .map_or("none", |(name, _)| *name);
        Ok((nearest, ink.1))
    }
}

/// A color as sRGB bytes, its alpha over `base`.
fn srgb(color: Hsla, base: Hsla) -> [u8; 3] {
    let (c, b) = (Rgba::from(color), Rgba::from(base));
    let mix = |v: f32, under: f32| ((v * c.a + under * (1. - c.a)) * 255.).round() as u8;
    [mix(c.r, b.r), mix(c.g, b.g), mix(c.b, b.b)]
}

fn distance(a: [u8; 3], b: [u8; 3]) -> u32 {
    a.iter()
        .zip(b)
        .map(|(a, b)| (i32::from(*a) - i32::from(b)).pow(2) as u32)
        .sum()
}

fn hex([r, g, b]: [u8; 3]) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

fn verdict(wrong: Vec<String>) -> Result<(), String> {
    if wrong.is_empty() {
        Ok(())
    } else {
        Err(wrong.join("\n"))
    }
}

// ---- The criteria.

/// AC1: a fresh reading that doesn't change, stale after 120 s, held 60 s.
fn ac1() -> Result<(), String> {
    let mut h = open(vec![reading(1, VALUE, T0)])?;
    h.hold_to(3_600);
    println!("AC1 over the 60 s after the first frame: {}", h.tally());
    if h.drawn.is_empty() && h.views_rendered() == 0 {
        return Ok(());
    }
    Err(format!(
        "FAIL: a panel whose reading didn't change, fresh for 120 s, held 60 s: after the first frame {}. A still panel \
         renders 0 times and draws 0 frames",
        h.tally()
    ))
}

/// AC2: a reading that goes stale 2.5 s after the first frame (as of 117.5 s before it, stale after 120 s).
fn ac2() -> Result<(), String> {
    const STALE_AT: u64 = 2_500;
    const VSYNC: u64 = 150;
    assert_eq!(at(VSYNC), STALE_AT);
    let as_of = T0 + STALE_AT - STALE_AFTER;
    let mut h = open(vec![reading(1, VALUE, as_of)])?;
    let mut wrong = Vec::new();
    // Its twin: before it goes stale the same line is drawn in ink, with no age, so a panel that grays everything fails.
    let fresh = h.expected(VALUE, as_of, 0);
    if h.shows != fresh.text {
        wrong.push(format!(
            "FAIL: the first frame drew `{LINE}` as \"{}\"; fresh, it reads \"{}\"",
            h.shows, fresh.text
        ));
    }
    let (role, ink) = h.role()?;
    if role == "muted" {
        wrong.push(format!(
            "FAIL: the first frame drew `{LINE}`, still fresh, in the look's muted role ({}): a fresh value is drawn in ink",
            hex(ink)
        ));
    }
    h.hold_to(VSYNC - 1);
    let early: Vec<String> = h.drawn.iter().map(|(k, _)| secs(at(*k))).collect();
    if !early.is_empty() {
        wrong.push(format!(
            "FAIL: the window drew {} frames before `{LINE}` went stale at {}, at {}: no frame is drawn before it",
            early.len(),
            secs(STALE_AT),
            early.join(", ")
        ));
    }
    let drew = h.vsync();
    let stale = h.expected(VALUE, as_of, STALE_AT);
    let (role, ink) = h.role()?;
    println!(
        "AC2: frames drawn before {}: {}; the frame at {} drawn: {drew}, showing `{LINE}` as \"{}\" in {role} ({})",
        secs(STALE_AT),
        early.len(),
        secs(STALE_AT),
        h.shows,
        hex(ink)
    );
    if !drew
        || h.drawn
            .last()
            .is_none_or(|(k, line)| *k != VSYNC || line.is_none())
    {
        wrong.push(format!(
            "FAIL: `{LINE}` went stale at {} and no frame drew it then: the window shows a stale number as live, \
             \"{}\" in {role} ({}), where it reads \"{}\" in the look's muted role",
            secs(STALE_AT),
            h.shows,
            hex(ink),
            stale.text
        ));
    } else {
        if h.shows != stale.text {
            wrong.push(format!(
                "FAIL: the frame at {} drew `{LINE}` as \"{}\"; stale, it reads \"{}\", with its age",
                secs(STALE_AT),
                h.shows,
                stale.text
            ));
        }
        if role != "muted" {
            wrong.push(format!(
                "FAIL: the frame at {} drew `{LINE}`, stale, in {role} ({}), not the look's muted role: a stale number \
                 shown as live",
                secs(STALE_AT),
                hex(ink)
            ));
        }
    }
    verdict(wrong)
}

/// AC3: a reading 150.3 s old at the first frame, stale after 120 s, held 180 s, its age shown in minutes.
fn ac3() -> Result<(), String> {
    const LAST: u64 = 10_800;
    let as_of = T0 - 150_300;
    let mut h = open(vec![reading(1, VALUE, as_of)])?;
    let first = h.expected(VALUE, as_of, 0);
    if !first.stale {
        return Err(format!(
            "BLOCKED: the reading should be stale at the first frame; the canvas reads \"{}\"",
            first.text
        ));
    }
    let mut wrong = Vec::new();
    if h.shows != first.text {
        wrong.push(format!(
            "FAIL: the first frame drew `{LINE}` as \"{}\"; it reads \"{}\"",
            h.shows, first.text
        ));
    }
    h.hold_to(LAST);
    // Where the age it shows changes: each vsync whose text differs from the one before it.
    let mut changes: Vec<(u64, String)> = Vec::new();
    let mut last = first.text;
    for k in 1..=LAST {
        let now = h.expected(VALUE, as_of, at(k)).text;
        if now != last {
            changes.push((k, now.clone()));
            last = now;
        }
    }
    let renders: Vec<(u64, String)> = h
        .drawn
        .iter()
        .filter_map(|(k, line)| Some((*k, line.clone()?)))
        .collect();
    println!(
        "AC3 over 180 s while stale: the age shown changed {} times, at {}; {}",
        changes.len(),
        changes
            .iter()
            .map(|(k, _)| secs(at(*k)))
            .collect::<Vec<_>>()
            .join(", "),
        h.tally()
    );
    if changes.len() < 2 {
        return Err(format!(
            "BLOCKED: the age shown should change in 180 s; it changed {} times",
            changes.len()
        ));
    }
    for (k, text) in &changes {
        match renders.iter().find(|(r, _)| r == k) {
            None => wrong.push(format!(
                "FAIL: the age `{LINE}` shows changed at {} to \"{text}\", and the panel didn't render then",
                secs(at(*k))
            )),
            Some((_, drawn)) if drawn != text => wrong.push(format!(
                "FAIL: at {} the panel drew `{LINE}` as \"{drawn}\"; it reads \"{text}\"",
                secs(at(*k))
            )),
            Some(_) => {}
        }
    }
    let between: Vec<String> = renders
        .iter()
        .filter(|(k, _)| !changes.iter().any(|(c, _)| c == k))
        .map(|(k, text)| format!("{} (\"{text}\")", secs(at(*k))))
        .collect();
    if !between.is_empty() {
        wrong.push(format!(
            "FAIL: the panel rendered {} times for {} changes of the age `{LINE}` shows, {} of them with no change, at {}",
            renders.len(),
            changes.len(),
            between.len(),
            between.iter().take(5).cloned().collect::<Vec<_>>().join(", ")
                + if between.len() > 5 { ", …" } else { "" }
        ));
    }
    verdict(wrong)
}

/// AC4: a fresh reading, then 10.3 s after the first frame the reader holds a new one, 190.10 USD.
fn ac4() -> Result<(), String> {
    const HELD: u64 = 618;
    const WAIT: u64 = 120;
    let mut h = open(vec![reading(1, VALUE, T0)])?;
    h.hold_to(HELD);
    h.reset();
    let as_of = T0 + at(HELD);
    h.cx.update(|cx| deep_app::record::deliver(reading(2, NEW_VALUE, as_of), cx));
    let held = deep_app::record::with_view(|view| view.table().value(SOURCE)).flatten();
    if held != Some((NEW_VALUE, as_of)) {
        return Err(format!(
            "BLOCKED: the record's reader should hold the new reading ({NEW_VALUE}, as of {as_of}); it holds {held:?}"
        ));
    }
    let want = h.expected(NEW_VALUE, as_of, at(HELD)).text;
    let mut shown = None;
    while shown.is_none() && h.k < HELD + WAIT {
        h.vsync();
        if h.shows == want {
            shown = Some(h.k - HELD);
        }
    }
    let others = [1, 2]
        .into_iter()
        .filter(|&view| h.notifies(view) > 0)
        .map(|view| format!("{} {} times", h.notified[view].0, h.notifies(view)))
        .collect::<Vec<_>>();
    println!(
        "AC4: the new reading showed {} after the reader held it; {}",
        shown.map_or(format!("never within {WAIT} frames"), |n| {
            format!("{n} frames ({} ms)", at(HELD + n) - at(HELD))
        }),
        h.tally()
    );
    let mut wrong = Vec::new();
    match shown {
        None => wrong.push(format!(
            "FAIL: a new reading of {SOURCE}, \"{want}\", never showed in `{LINE}` within {WAIT} frames (2 s) of the \
             record's reader holding it: the window still shows \"{}\"",
            h.shows
        )),
        Some(n) if n > 2 => wrong.push(format!(
            "FAIL: a new reading of {SOURCE}, \"{want}\", showed in `{LINE}` {n} frames ({} ms) after the record's \
             reader held it, not within 2 frames",
            at(HELD + n) - at(HELD)
        )),
        Some(_) => {}
    }
    if !others.is_empty() {
        wrong.push(format!(
            "FAIL: until a new reading of {SOURCE} showed, other views were notified: {}; it reaches the panel alone",
            others.join(", ")
        ));
    }
    verdict(wrong)
}

/// AC5: a fresh reading, then 1 s after the first frame the reader holds a reading of the same value, as of then.
fn ac5() -> Result<(), String> {
    const HELD: u64 = 60;
    const LAST: u64 = 180;
    let mut h = open(vec![reading(1, VALUE, T0)])?;
    h.hold_to(HELD);
    h.reset();
    let as_of = T0 + at(HELD);
    h.cx.update(|cx| deep_app::record::deliver(reading(2, VALUE, as_of), cx));
    let held = deep_app::record::with_view(|view| view.table().value(SOURCE)).flatten();
    let same = h.expected(VALUE, as_of, at(HELD)).text;
    if held != Some((VALUE, as_of)) || same != h.shows {
        return Err(format!(
            "BLOCKED: the reader should hold ({VALUE}, as of {as_of}), it holds {held:?}, and the line should read as \
             shown, \"{}\": it reads \"{same}\"",
            h.shows
        ));
    }
    h.hold_to(LAST);
    println!(
        "AC5 over the 2 s after a reading equal to the one shown: {}",
        h.tally()
    );
    if h.drawn.is_empty() && h.views_rendered() == 0 {
        return Ok(());
    }
    Err(format!(
        "FAIL: after a reading of {SOURCE} equal to the one shown (\"{same}\"), over 2 s {}. A reading equal to the \
         one shown renders 0 views and draws 0 frames",
        h.tally()
    ))
}

// ---- The wrong programs the criteria name, each in a build with its plant.

/// The planted program fails its criterion, and the failure names each of `names`.
fn planted(judged: Result<(), String>, what: &str, names: &[&str]) -> Result<(), String> {
    match judged {
        Ok(()) => Err(format!(
            "FAIL: the planted panel, {what}, passed its criterion"
        )),
        Err(why) if why.starts_with("FAIL") && names.iter().all(|name| why.contains(name)) => {
            println!("the planted panel, {what}, fails: {why}");
            Ok(())
        }
        Err(why) => Err(format!(
            "FAIL: the planted panel, {what}, didn't fail its criterion naming {}: {why}",
            names.join(" and ")
        )),
    }
}

fn plant_ticks() -> Result<(), String> {
    planted(ac1(), "a timer that notifies every second", &["BoundPanel"])
}

fn plant_grays_on_reading() -> Result<(), String> {
    planted(
        ac2(),
        "one that waits for the next reading before graying",
        &["`price`", "as live"],
    )
}

fn plant_waits_for_redraw() -> Result<(), String> {
    planted(
        ac4(),
        "one that waits for another view's redraw",
        &["reading:quotes"],
    )
}

// ---- The runner: each test in a process of its own.

struct Test {
    name: &'static str,
    run: fn() -> Result<(), String>,
    /// A plant's test: its feature, and whether this build has it.
    plant: Option<(&'static str, bool)>,
}

const TESTS: [Test; 8] = [
    Test {
        name: "ac1_789c5dd8_a_still_bound_panel_held_60_s_renders_0_times_and_draws_0_frames_after_the_first",
        run: ac1,
        plant: None,
    },
    Test {
        name: "ac2_ebc91643_the_frame_at_as_of_plus_stale_after_draws_it_muted_with_its_age_and_none_before_it",
        run: ac2,
        plant: None,
    },
    Test {
        name: "ac3_426efcc0_while_stale_the_panel_renders_once_for_each_change_of_the_age_it_shows_never_between",
        run: ac3,
        plant: None,
    },
    Test {
        name: "ac4_0504b71f_a_new_reading_shows_within_2_frames_of_the_reader_holding_it_no_other_view_notified",
        run: ac4,
        plant: None,
    },
    Test {
        name: "ac5_2a24617a_a_reading_equal_to_the_one_shown_renders_0_views_and_draws_0_frames",
        run: ac5,
        plant: None,
    },
    Test {
        name: "plant_panel_ticks_ac1_789c5dd8_a_timer_that_notifies_every_second_fails_naming_the_view",
        run: plant_ticks,
        plant: Some(("plant-panel-ticks", cfg!(feature = "plant-panel-ticks"))),
    },
    Test {
        name: "plant_panel_grays_on_reading_ac2_ebc91643_a_panel_that_waits_for_the_next_reading_fails_naming_the_element",
        run: plant_grays_on_reading,
        plant: Some((
            "plant-panel-grays-on-reading",
            cfg!(feature = "plant-panel-grays-on-reading"),
        )),
    },
    Test {
        name: "plant_panel_waits_for_redraw_ac4_0504b71f_a_panel_that_waits_for_another_views_redraw_fails_naming_the_source",
        run: plant_waits_for_redraw,
        plant: Some((
            "plant-panel-waits-for-redraw",
            cfg!(feature = "plant-panel-waits-for-redraw"),
        )),
    },
];

/// Runs one test in a process of its own: what it printed, then its verdict.
fn in_own_process(name: &str) -> Result<(), String> {
    let exe = std::env::current_exe()
        .map_err(|e| format!("BLOCKED: the test binary can't find itself ({e})"))?;
    let out = Command::new(exe)
        .env(ONE, name)
        .output()
        .map_err(|e| format!("BLOCKED: {name} didn't start ({e})"))?;
    let mut said = None;
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        match line.strip_prefix(RESULT) {
            Some(json) => said = serde_json::from_str::<String>(json).ok(),
            None => println!("{line}"),
        }
    }
    match said {
        Some(ok) if ok == "ok" => Ok(()),
        Some(why) => Err(why),
        None => {
            let stderr = String::from_utf8_lossy(&out.stderr);
            let tail: Vec<&str> = stderr.lines().rev().take(20).collect();
            Err(format!(
                "FAIL: {name} ended ({}) with no verdict:\n{}",
                out.status,
                tail.into_iter().rev().collect::<Vec<_>>().join("\n")
            ))
        }
    }
}

fn main() {
    if let Ok(name) = std::env::var(ONE) {
        let test = TESTS
            .iter()
            .find(|test| test.name == name)
            .unwrap_or_else(|| panic!("{name} is no test of this binary"));
        let said = match (test.run)() {
            Ok(()) => "ok".to_owned(),
            Err(why) => why,
        };
        println!(
            "{RESULT}{}",
            serde_json::to_string(&said).expect("a verdict")
        );
        return;
    }
    let filters: Vec<String> = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .collect();
    let chosen: Vec<&Test> = TESTS
        .iter()
        .filter(|test| filters.is_empty() || filters.iter().any(|f| test.name.contains(f.as_str())))
        .collect();
    println!("\nrunning {} tests", chosen.len());
    let (mut passed, mut failed, mut ignored) = (0, 0, 0);
    for test in chosen {
        if let Some((feature, false)) = test.plant {
            println!(
                "test {} ... ignored, the plant runs only in a build with --features {feature}",
                test.name
            );
            ignored += 1;
            continue;
        }
        match in_own_process(test.name) {
            Ok(()) => {
                println!("test {} ... ok", test.name);
                passed += 1;
            }
            Err(why) => {
                println!(
                    "test {} ... FAILED\n\n---- {} ----\n{why}\n",
                    test.name, test.name
                );
                failed += 1;
            }
        }
    }
    let word = if failed == 0 { "ok" } else { "FAILED" };
    println!("test result: {word}. {passed} passed; {failed} failed; {ignored} ignored\n");
    std::process::exit(i32::from(failed > 0));
}
