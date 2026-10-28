//! #326, criterion group "panels": what both suites here share. `panels.rs` runs the criteria
//! against the app; `planted.rs` runs the same judges against wrong hosts built from gpui-kit and
//! gpui-shell alone, to show they fail them. Everything here observes: a TCP listener counts the
//! connections a panel makes, a marker file says a program ran, the window's focus is read
//! before and after, and window captures are compared pixel for pixel. Nothing takes a host's
//! word for what a panel did.
#![allow(dead_code)]

use std::{
    net::TcpListener,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU32, AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

use gpui_kit::test::TestWindowExt as _;
use gpui_kit::{
    point, px, size, AnyWindowHandle, Bounds, HeadlessAppContext, Modifiers, MouseButton,
    MouseDownEvent, MouseMoveEvent, MouseUpEvent, Pixels, PlatformInput, Point,
};

/// The reference window, in points, at 2x: what the replica opens.
pub const WINDOW: (f32, f32) = (1512., 982.);
pub const SCALE: f32 = 2.;
/// The question card's rect in window points: right of the sidebar slot (260 points wide), over
/// most of the center, so the top-right corner where notifications land and the middle where a
/// dialog lands are both inside it.
pub const CARD: (f32, f32, f32, f32) = (264., 4., 1244., 854.);
/// The fixtures' block colour; nothing else in a fixture or in the shell is drawn in it.
pub const MAGENTA: [u8; 3] = [0xff, 0x00, 0xff];

pub fn card_bounds() -> Bounds<Pixels> {
    Bounds {
        origin: point(px(CARD.0), px(CARD.1)),
        size: size(px(CARD.2), px(CARD.3)),
    }
}

/// The card's rect in device pixels, `[x, y, w, h]`.
pub fn card_device() -> [u32; 4] {
    [CARD.0, CARD.1, CARD.2, CARD.3].map(|side| (side * SCALE).round() as u32)
}

// ---- Scratch folders: /tmp/da326p-<pid>-<n>, removed on drop.

static NEXT: AtomicU32 = AtomicU32::new(0);

pub struct Scratch(pub PathBuf);

impl Scratch {
    pub fn new() -> Self {
        let dir = PathBuf::from(format!(
            "/tmp/da326p-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("a scratch folder under /tmp");
        Scratch(dir)
    }
}

impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// This folder's fixtures, from the crate that builds the suite (crates/deep-replica).
pub fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/acceptance/326/panels/fixtures")
}

/// Copies the fixture package at `fixtures()/<name>` into `scratch`, writing each `(from, to)`
/// over its placeholder in every file, and answers the copy's folder.
pub fn copy_fixture(name: &str, scratch: &Scratch, substitutions: &[(&str, &str)]) -> PathBuf {
    let from = fixtures().join(name);
    let to = scratch.0.join(name.replace('/', "-"));
    std::fs::create_dir_all(&to).unwrap();
    for entry in
        std::fs::read_dir(&from).unwrap_or_else(|error| panic!("{}: {error}", from.display()))
    {
        let entry = entry.unwrap();
        let mut text = std::fs::read_to_string(entry.path()).unwrap();
        for (placeholder, value) in substitutions {
            text = text.replace(placeholder, value);
        }
        std::fs::write(to.join(entry.file_name()), text).unwrap();
    }
    to
}

// ---- The network: a listener on 127.0.0.1 that counts every connection made to it.

pub struct Listener {
    pub port: u16,
    count: Arc<AtomicUsize>,
}

impl Listener {
    pub fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port on 127.0.0.1");
        let port = listener.local_addr().unwrap().port();
        let count = Arc::new(AtomicUsize::new(0));
        let counted = count.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                counted.fetch_add(1, Ordering::SeqCst);
                // Answer nothing and close: a request that got this far already reached the host.
                drop(stream);
            }
        });
        Listener { port, count }
    }

    /// Connections so far, after a short wait for any still in flight.
    pub fn connections(&self) -> usize {
        std::thread::sleep(Duration::from_millis(300));
        self.count.load(Ordering::SeqCst)
    }
}

// ---- Captures.

#[derive(Clone)]
pub struct Capture {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl Capture {
    pub fn pixel(&self, x: u32, y: u32) -> [u8; 4] {
        let at = ((y * self.width + x) * 4) as usize;
        [
            self.rgba[at],
            self.rgba[at + 1],
            self.rgba[at + 2],
            self.rgba[at + 3],
        ]
    }

    /// Whether any pixel within `region` (device px, `[x, y, w, h]`), or anywhere, is magenta.
    pub fn has_magenta(&self, region: Option<[u32; 4]>) -> bool {
        let [x0, y0, w, h] = region.unwrap_or([0, 0, self.width, self.height]);
        (y0..(y0 + h).min(self.height)).any(|y| {
            (x0..(x0 + w).min(self.width)).any(|x| {
                let [r, g, b, _] = self.pixel(x, y);
                r.abs_diff(MAGENTA[0]) < 24
                    && g.abs_diff(MAGENTA[1]) < 24
                    && b.abs_diff(MAGENTA[2]) < 24
            })
        })
    }
}

pub fn capture(cx: &mut HeadlessAppContext, handle: AnyWindowHandle) -> Capture {
    let image = cx
        .capture_screenshot(handle)
        .expect("offscreen rendering is available");
    Capture {
        width: image.width(),
        height: image.height(),
        rgba: image.into_raw(),
    }
}

/// The first pixel of the card's interior, farther than 1 device px from its edge, where two
/// captures differ, row by row; `None` when they are equal there bit for bit.
pub fn first_interior_difference(a: &Capture, b: &Capture, card: [u32; 4]) -> Option<(u32, u32)> {
    assert_eq!(
        (a.width, a.height),
        (b.width, b.height),
        "the two captures are of different windows"
    );
    let [x, y, w, h] = card;
    assert!(
        x + w <= a.width && y + h <= a.height,
        "the card {card:?} lies outside the {}x{} capture",
        a.width,
        a.height
    );
    (y + 2..y + h - 2)
        .flat_map(|py| (x + 2..x + w - 2).map(move |px| (px, py)))
        .find(|&(px, py)| a.pixel(px, py) != b.pixel(px, py))
}

/// A rect in window points as device pixels, `[x, y, w, h]`.
pub fn device(bounds: Bounds<Pixels>) -> [u32; 4] {
    [
        f32::from(bounds.origin.x),
        f32::from(bounds.origin.y),
        f32::from(bounds.size.width),
        f32::from(bounds.size.height),
    ]
    .map(|side| (side * SCALE).round().max(0.) as u32)
}

/// The first pixel, row by row, where two captures differ outside `slot` (device px) and a
/// 2-pixel margin around it; `None` when they are equal everywhere else.
pub fn first_difference_outside(a: &Capture, b: &Capture, slot: [u32; 4]) -> Option<(u32, u32)> {
    assert_eq!(
        (a.width, a.height),
        (b.width, b.height),
        "the two captures are of different windows"
    );
    let [x, y, w, h] = slot;
    let inside = |px: u32, py: u32| px + 2 >= x && px < x + w + 2 && py + 2 >= y && py < y + h + 2;
    (0..a.height)
        .flat_map(|py| (0..a.width).map(move |px| (px, py)))
        .find(|&(px, py)| !inside(px, py) && a.pixel(px, py) != b.pixel(px, py))
}

// ---- Driving a window headless.

/// Lets every task and timer due within `ms` of virtual time run, drawing a frame between steps.
pub fn settle(cx: &mut HeadlessAppContext, handle: AnyWindowHandle, ms: u64) {
    for _ in 0..(ms / 16).max(1) {
        cx.run_until_parked();
        cx.advance_clock(Duration::from_millis(16));
        cx.run_until_parked();
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .expect("the window draws");
    }
}

fn dispatch(cx: &mut HeadlessAppContext, handle: AnyWindowHandle, event: PlatformInput) {
    cx.update_window(handle, |_, window, cx| {
        window.dispatch_event(event, cx);
    })
    .expect("the window takes the event");
    cx.run_until_parked();
}

pub fn press(
    cx: &mut HeadlessAppContext,
    handle: AnyWindowHandle,
    at: Point<Pixels>,
    button: MouseButton,
) {
    dispatch(
        cx,
        handle,
        PlatformInput::MouseMove(MouseMoveEvent {
            position: at,
            pressed_button: None,
            modifiers: Modifiers::default(),
        }),
    );
    dispatch(
        cx,
        handle,
        PlatformInput::MouseDown(MouseDownEvent {
            button,
            position: at,
            modifiers: Modifiers::default(),
            click_count: 1,
            first_mouse: false,
        }),
    );
    dispatch(
        cx,
        handle,
        PlatformInput::MouseUp(MouseUpEvent {
            button,
            position: at,
            modifiers: Modifiers::default(),
            click_count: 1,
        }),
    );
}

pub fn hover(cx: &mut HeadlessAppContext, handle: AnyWindowHandle, at: Point<Pixels>) {
    for offset in [0., 1., 2.] {
        dispatch(
            cx,
            handle,
            PlatformInput::MouseMove(MouseMoveEvent {
                position: point(at.x + px(offset), at.y),
                pressed_button: None,
                modifiers: Modifiers::default(),
            }),
        );
    }
}

/// How the test opens a component once its panel is mounted: the same input a person would give.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Open {
    /// A left click at the center of the panel's slot, where the fixture's trigger sits.
    Click,
    /// A right press there.
    RightPress,
    /// The pointer resting there.
    Hover,
    /// Nothing: it opens itself, or it is the panel's own layout.
    Itself,
}

pub fn open(cx: &mut HeadlessAppContext, handle: AnyWindowHandle, how: Open, slot: Bounds<Pixels>) {
    let at = slot.center();
    match how {
        Open::Click => press(cx, handle, at, MouseButton::Left),
        Open::RightPress => press(cx, handle, at, MouseButton::Right),
        Open::Hover => hover(cx, handle, at),
        Open::Itself => {}
    }
    // Tooltips and hover cards wait out their delays; the growing panel takes its frames.
    settle(cx, handle, 1_500);
}

// ---- AC6: the four faults.

/// The four fixtures, one per fault, by folder under `fixtures/faults/`, each with the word its
/// refusal must say.
pub const FAULTS: [&str; 4] = ["network", "program", "focus", "draw"];

#[derive(Clone, Debug)]
pub struct FaultRun {
    pub fault: &'static str,
    /// The host's refusal message, or `None` when it let the panel in.
    pub refusal: Option<String>,
    /// What the test saw the fault do, when it did anything.
    pub happened: Option<String>,
}

/// Every fault refused with a message of its own that names it, and none of them happened. A
/// failure names each fault that failed, in the issue's order.
pub fn judge_faults(runs: &[FaultRun]) -> Result<(), String> {
    let mut failures = Vec::new();
    for fault in FAULTS {
        let Some(run) = runs.iter().find(|run| run.fault == fault) else {
            failures.push(format!("{fault}: no run"));
            continue;
        };
        let mut why = Vec::new();
        match &run.refusal {
            None => why.push("not refused".to_owned()),
            Some(message) if !message.to_lowercase().contains(fault) => why.push(format!(
                "refused with a message that doesn't say \"{fault}\": {message:?}"
            )),
            Some(message) => {
                if let Some(other) = runs
                    .iter()
                    .find(|other| other.fault != fault && other.refusal.as_deref() == Some(message))
                {
                    why.push(format!(
                        "refused with the same message as {}: {message:?}",
                        other.fault
                    ));
                }
            }
        }
        if let Some(happened) = &run.happened {
            why.push(format!("it happened: {happened}"));
        }
        if !why.is_empty() {
            failures.push(format!("{fault}: {}", why.join("; ")));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("\n"))
    }
}

/// What the test saw a fault fixture do, if anything.
pub fn observed(
    fault: &str,
    listener: &Listener,
    marker: &Path,
    focus_moved: bool,
    shot: &Capture,
    reference: &Capture,
    slot: Bounds<Pixels>,
) -> Option<String> {
    match fault {
        "network" => {
            let connections = listener.connections();
            (connections > 0).then(|| {
                format!(
                    "{connections} connection(s) reached 127.0.0.1:{}",
                    listener.port
                )
            })
        }
        "program" => marker
            .exists()
            .then(|| format!("{} was created", marker.display())),
        "focus" => focus_moved.then(|| "the window's focus moved with no input".to_owned()),
        "draw" => first_difference_outside(shot, reference, device(slot))
            .map(|(x, y)| format!("it painted outside its panel, at device pixel ({x}, {y})")),
        other => panic!("no fault {other}"),
    }
}

// ---- AC7: over the card's slot.

#[derive(Clone, Copy, Debug)]
pub struct Component {
    /// Its fixture's folder under `fixtures/components/`.
    pub dir: &'static str,
    /// The issue's word for it, which a failure names.
    pub name: &'static str,
    /// What its refusal may call it: the issue's word or gpui-shell's registered name, any case.
    pub words: &'static [&'static str],
    pub open: Open,
}

/// In the issue's order: the seven components, then the two layouts.
pub const COMPONENTS: [Component; 9] = [
    Component {
        dir: "dialog",
        name: "dialog",
        words: &["dialog"],
        open: Open::Click,
    },
    Component {
        dir: "popover",
        name: "popover",
        words: &["popover"],
        open: Open::Itself,
    },
    Component {
        dir: "tooltip",
        name: "tooltip",
        words: &["tooltip"],
        open: Open::Hover,
    },
    Component {
        dir: "context-menu",
        name: "context menu",
        words: &["context menu", "popup"],
        open: Open::RightPress,
    },
    Component {
        dir: "dropdown",
        name: "dropdown",
        words: &["dropdown"],
        open: Open::Click,
    },
    Component {
        dir: "notification",
        name: "notification",
        words: &["notification"],
        open: Open::Click,
    },
    Component {
        dir: "command-palette",
        name: "command palette",
        words: &["command palette", "command"],
        open: Open::Itself,
    },
    Component {
        dir: "twice-slot",
        name: "a layout twice its slot",
        words: &["outside its panel"],
        open: Open::Itself,
    },
    Component {
        dir: "grows",
        name: "a panel that grows toward the card",
        words: &["outside its panel"],
        open: Open::Itself,
    },
];

#[derive(Clone, Debug)]
pub struct CardRun {
    pub component: Component,
    pub refusal: Option<String>,
    /// The first interior pixel where the capture with the component open differs from the
    /// card alone, device px.
    pub difference: Option<(u32, u32)>,
}

/// For each component in order: refused naming it, and the card's interior bit for bit the card
/// alone. A failure lists each failing component, the first one first.
pub fn judge_cards(runs: &[CardRun]) -> Result<(), String> {
    let mut failures = Vec::new();
    for component in COMPONENTS {
        let Some(run) = runs.iter().find(|run| run.component.dir == component.dir) else {
            failures.push(format!("{}: no run", component.name));
            continue;
        };
        let mut why = Vec::new();
        if let Some((x, y)) = run.difference {
            why.push(format!(
                "the card's interior differs from the card alone at device pixel ({x}, {y})"
            ));
        }
        match &run.refusal {
            None => why.push("not refused".to_owned()),
            Some(message) => {
                let lower = message.to_lowercase();
                if !component.words.iter().any(|word| lower.contains(word)) {
                    why.push(format!(
                        "refused without naming it ({}): {message:?}",
                        component.words.join(" or ")
                    ));
                }
            }
        }
        if !why.is_empty() {
            failures.push(format!("{}: {}", component.name, why.join("; ")));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("\n"))
    }
}

// ---- A harness-free runner: AppKit needs the main thread, so the suites print libtest's lines.

pub fn run(cases: &[(&str, fn())]) -> i32 {
    let filter = std::env::args().nth(1).filter(|arg| !arg.starts_with('-'));
    let cases: Vec<&(&str, fn())> = cases
        .iter()
        .filter(|(name, _)| filter.as_deref().is_none_or(|filter| name.contains(filter)))
        .collect();
    if cases.is_empty() {
        println!("\ntest result: INCONCLUSIVE. the filter names no test; nothing ran");
        return 1;
    }
    println!("\nrunning {} tests", cases.len());
    let mut failed = 0;
    for (name, case) in &cases {
        let ok = std::panic::catch_unwind(*case).is_ok();
        println!("test {name} ... {}", if ok { "ok" } else { "FAILED" });
        failed += usize::from(!ok);
    }
    println!(
        "\ntest result: {}. {} passed; {failed} failed",
        if failed == 0 { "ok" } else { "FAILED" },
        cases.len() - failed
    );
    i32::from(failed > 0)
}
