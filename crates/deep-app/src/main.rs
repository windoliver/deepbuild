//! `deep-app [--panel DIR] [MODE]`: the spike's window, with the count in the menu bar.
//!
//! `deep-app --set-up` runs the first launch's Set up click with no window and prints its one line (#326).
//!
//! With `DEEP_APP_EXIT_AFTER_FIRST_FRAME` set it prints `first-frame-ms N` once the window
//! has drawn and quits, which is how the spike measures cold start.
//!
//! Issue #339 adds the cursor window: a small window that follows the cursor and shows one
//! screen frame, captured only while ⌥Space is held on the keyboard. The modes:
//! - `--cursor-demo SECONDS`: the window while the cursor is moved on a circle, for a
//!   recording; quits after SECONDS.
//! - `--probe-synthetic N`: presses the shortcut N times without a keyboard, in every
//!   synthetic form the app knows, then has a second process post 50 forged chords at the
//!   HID event tap (which macOS delivers only from a process with the Accessibility
//!   permission) while the ticks keep reading the HID table, and quits.
//! - `--probe-held SECONDS [--frame PATH]`: waits up to SECONDS for a person to hold the
//!   shortcut, keeps the first frame captured (written to PATH as PNG), and quits.
//! - `--post-forged N`: the second process of the synthetic probe: posts N forged chords
//!   and prints what it did; no window.
//!
//! Issue #105 adds `--capture-bug STORE`: opens the system picker; once a person has picked a
//! display or a window, records it while they hold ⌥Space (at most 120 s), keeps the MP4 in the
//! evidence store at STORE by its hash and prints one line: `{"capture":105,"permission",
//! "picker":true,"source","display":{"id","main"},"frames","first_frame_ms","held_ms",
//! "asset":{"sha256","redaction":"unknown"}}`.
//!
//! Issue #140 adds `--color-check [--planted gpui_layer_untagged | wgpu_default_colorspace]`: the
//! color seam on the real window. Each status color of the shipped look is drawn as a swatch
//! through every Metal layer the app presents through (the window's, which GPUI composites the GPU
//! layer's slots into, and a surface wgpu configures with its `Srgb` color space), read back from
//! that layer's drawable, and printed as one line with each layer's colorspace as the layer
//! reports it: `{"color":140,"layers":[{"layer","owner","colorspace"}],"swatches":[{"layer",
//! "status","read":[r,g,b]}]}`. The planted twins leave the window's layer, or the wgpu surface's,
//! untagged.
//!
//! Each probe prints what the gate saw as JSON on stdout, then its report as the last line:
//! `{"spike":339,"mode":"synthetic"|"held","presses":n,"frames":n,"held":bool,"permission":
//! "granted"|"denied"|"undetermined"}`.

use std::{path::PathBuf, time::Instant};

use deep_app::{init, menu_bar_title, mount_panel, sessions, Spike};
use gpui_kit::*;

#[derive(Clone, Debug, PartialEq, Eq)]
enum Mode {
    Window,
    CursorDemo {
        seconds: u64,
    },
    ProbeSynthetic {
        presses: u64,
    },
    ProbeHeld {
        seconds: u64,
        frame: Option<PathBuf>,
    },
    PostForged {
        chords: u64,
    },
    SetUp,
    CaptureBug {
        store: PathBuf,
    },
    ColorCheck {
        planted: Option<String>,
    },
}

fn main() {
    let started = Instant::now();
    let (panel_dir, mode) = args();
    if let Mode::PostForged { chords } = mode {
        trusted::post_forged(chords);
        return;
    }
    if mode == Mode::SetUp {
        match deep_app::setup::set_up() {
            Ok(line) => println!("{line}"),
            Err(error) => {
                eprintln!("deep-app: {error}");
                std::process::exit(1);
            }
        }
        return;
    }
    #[cfg(target_os = "macos")]
    if let Mode::ColorCheck { planted } = &mode {
        if planted.as_deref() == Some("gpui_layer_untagged") {
            gpui_apple::metal_renderer::layer_colorspace::plant_untagged();
        }
        let wgpu_untagged = planted.as_deref() == Some("wgpu_default_colorspace");
        application().run(move |cx| {
            gpui_kit::init(cx);
            color_check::run(wgpu_untagged, cx);
        });
        return;
    }
    application().run(move |cx| {
        gpui_kit::init(cx);
        init(cx);
        menu_bar::set_dock_icon();
        menu_bar::show_title(&menu_bar_title(&sessions()));

        let runtime = deep_app::new_runtime().expect("panel runtime");
        // The window draws its own title bar, with the mark, so it owns the bar's drag.
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::centered(size(px(960.), px(640.)), cx)),
            ..gpui_kit::component::TitleBar::window_options()
        };
        open_window(options, cx, move |window, cx| {
            let panel = panel_dir.as_ref().map(|dir| {
                let view = mount_panel(&runtime, dir, window, cx)
                    .unwrap_or_else(|error| panic!("panel {}: {error:#}", dir.display()));
                (dir.display().to_string(), view)
            });
            window.on_next_frame(move |_, cx| {
                let ms = started.elapsed().as_secs_f64() * 1000.0;
                eprintln!("first-frame-ms {ms:.1}");
                if std::env::var_os("DEEP_APP_EXIT_AFTER_FIRST_FRAME").is_some() {
                    cx.quit();
                }
                match mode {
                    Mode::Window => {}
                    Mode::CaptureBug { store } => capture_bug::start(store, cx),
                    mode => trusted::start(mode, cx),
                }
            });
            cx.new(|_| Spike::new(panel))
        })
        .expect("open window");
        cx.activate(true);
    });
}

fn args() -> (Option<PathBuf>, Mode) {
    let mut panel = None;
    let mut mode = Mode::Window;
    let mut frame = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--panel" => {
                panel = Some(PathBuf::from(
                    args.next().expect("--panel takes a directory"),
                ))
            }
            "--cursor-demo" => {
                mode = Mode::CursorDemo {
                    seconds: number(args.next(), "--cursor-demo takes seconds"),
                }
            }
            "--probe-synthetic" => {
                mode = Mode::ProbeSynthetic {
                    presses: number(args.next(), "--probe-synthetic takes a count"),
                }
            }
            "--probe-held" => {
                mode = Mode::ProbeHeld {
                    seconds: number(args.next(), "--probe-held takes seconds"),
                    frame: None,
                }
            }
            "--set-up" => mode = Mode::SetUp,
            "--capture-bug" => {
                mode = Mode::CaptureBug {
                    store: PathBuf::from(args.next().expect("--capture-bug takes a folder")),
                }
            }
            "--color-check" => mode = Mode::ColorCheck { planted: None },
            "--planted" => {
                let twin = args.next().expect("--planted takes a name");
                assert!(
                    matches!(
                        twin.as_str(),
                        "gpui_layer_untagged" | "wgpu_default_colorspace"
                    ),
                    "unknown planted {twin}"
                );
                match &mut mode {
                    Mode::ColorCheck { planted } => *planted = Some(twin),
                    _ => panic!("--planted follows --color-check"),
                }
            }
            "--frame" => frame = Some(PathBuf::from(args.next().expect("--frame takes a path"))),
            "--post-forged" => {
                mode = Mode::PostForged {
                    chords: number(args.next(), "--post-forged takes a count"),
                }
            }
            other => panic!("unknown argument {other}"),
        }
    }
    if let Mode::ProbeHeld { frame: slot, .. } = &mut mode {
        *slot = frame;
    }
    (panel, mode)
}

fn number(arg: Option<String>, what: &str) -> u64 {
    arg.and_then(|arg| arg.parse().ok()).expect(what)
}

#[cfg(target_os = "macos")]
mod trusted {
    use std::{cell::RefCell, rc::Rc, time::Duration};

    use deep_app::trusted_input::{
        app_is_active, capture_access, cursor_position, install_monitor, main_display_bounds,
        main_thread, post_forged_chords, press_synthetically, warp_cursor, Counts, CursorWindow,
        Gate, Posted, Seen, SYNTHETIC_FORMS,
    };
    use gpui_kit::*;
    use objc2_core_foundation::CGPoint;

    use super::Mode;

    const TICK: Duration = Duration::from_millis(16);
    const SIZE: Size<Pixels> = Size {
        width: px(240.),
        height: px(160.),
    };
    /// Chords the second process posts at the HID event tap in the synthetic probe.
    const POSTED_CHORDS: u64 = 50;

    /// `--post-forged N`: posts the chords and prints one JSON line of what it did.
    pub fn post_forged(chords: u64) {
        let posted = post_forged_chords(chords);
        println!("{}", serde_json::to_string(&posted).expect("a report"));
    }

    /// Starts this binary again as the poster, beside the tick loop; None when it couldn't
    /// start. Its report is read once it has exited.
    fn spawn_poster() -> Option<std::process::Child> {
        let exe = std::env::current_exe().ok()?;
        std::process::Command::new(exe)
            .arg("--post-forged")
            .arg(POSTED_CHORDS.to_string())
            .stdout(std::process::Stdio::piped())
            .spawn()
            .ok()
    }

    /// What the poster's window showed: the poster's own report, whether this app was the
    /// active one (a local monitor sees only the active app's keys), and what the gate and
    /// the HID table read while the chords were posted.
    fn posting_window(
        child: std::process::Child,
        before: &Counts,
        after: &Counts,
        active_at_post: bool,
    ) -> serde_json::Value {
        let posted: Option<Posted> = child
            .wait_with_output()
            .ok()
            .and_then(|output| serde_json::from_slice(&output.stdout).ok());
        serde_json::json!({
            "pid": posted.as_ref().map(|posted| posted.pid),
            "chords_posted": posted.as_ref().map(|posted| posted.posted),
            "accessibility_trusted": posted.as_ref().map(|posted| posted.accessibility_trusted),
            "app_active_at_post": active_at_post,
            "while_posting": {
                "presses_arrived": after.presses - before.presses,
                "holds": after.holds - before.holds,
                "frames": after.frames - before.frames,
                "ticks_with_hid_key": after.ticks_with_hid_key - before.ticks_with_hid_key,
                "ticks_with_hid_option": after.ticks_with_hid_option - before.ticks_with_hid_option,
            },
        })
    }

    /// Opens the cursor window, installs the monitor, and runs the mode on a 16 ms tick.
    pub fn start(mode: Mode, cx: &mut App) {
        let gate = Rc::new(RefCell::new(Gate::default()));
        let seen = Rc::new(RefCell::new(Vec::<Seen>::new()));
        let monitor = install_monitor(gate.clone(), seen.clone());
        let cursor = cursor_position();
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds {
                origin: point(px(cursor.x as f32 + 24.), px(cursor.y as f32 + 24.)),
                size: SIZE,
            })),
            titlebar: None,
            focus: false,
            show: true,
            kind: WindowKind::PopUp,
            is_movable: false,
            ..Default::default()
        };
        let hint = match mode {
            Mode::ProbeSynthetic { .. } => "Synthetic run: hands off the keyboard",
            _ => "Hold ⌥Space on the keyboard",
        };
        let (handle, view) = open_window(options, cx, {
            let gate = gate.clone();
            move |_, cx| cx.new(|_| CursorWindow::new(gate, SIZE, hint))
        })
        .expect("open the cursor window");
        if matches!(mode, Mode::ProbeSynthetic { .. } | Mode::ProbeHeld { .. }) {
            // A probe's report names the permission's state, so ask for it at the start.
            view.update(cx, |view, _| view.request());
        }
        if matches!(mode, Mode::ProbeHeld { .. }) {
            // A local monitor sees only keys delivered to this app, so the held run needs it
            // frontmost once the windows are up.
            cx.activate(true);
        }

        let started = std::time::Instant::now();
        cx.spawn(async move |cx| {
            let _monitor = monitor;
            let mut tick = 0u64;
            let mut sent = 0u64;
            let mut ever_held = false;
            let mut poster: Option<std::process::Child> = None;
            let mut poster_started = false;
            let mut poster_exited_at: Option<u64> = None;
            let mut before_posting = Counts::default();
            let mut active_at_post = false;
            loop {
                cx.background_executor().timer(TICK).await;
                tick += 1;
                let updated = cx.update_window(handle, |_, window, cx| {
                    view.update(cx, |view, cx| view.tick(window, cx));
                });
                if updated.is_err() {
                    // The window closed before the run ended: nothing to report as a run,
                    // so the last line says so, and no poster is left running.
                    if let Some(mut child) = poster.take() {
                        let _ = child.kill();
                        let _ = child.wait();
                    }
                    println!(
                        "{}",
                        serde_json::json!({
                            "spike": 339,
                            "blocked": "the cursor window closed before the run ended",
                        })
                    );
                    cx.update(|cx| cx.quit());
                    break;
                }
                ever_held |= gate.borrow().held();
                let elapsed = started.elapsed().as_secs_f64();
                let done = match &mode {
                    Mode::Window => false,
                    Mode::CursorDemo { seconds } => {
                        let bounds = main_display_bounds();
                        let (x0, y0) = (bounds.size.width / 2.0, bounds.size.height / 2.0);
                        let radius = bounds.size.height.min(bounds.size.width) / 4.0;
                        warp_cursor(CGPoint::new(
                            x0 + radius * (elapsed * 1.2).cos(),
                            y0 + radius * (elapsed * 1.2).sin(),
                        ));
                        elapsed >= *seconds as f64
                    }
                    Mode::ProbeSynthetic { presses } => {
                        // One press per tick, rotating the forms, once the window has shown;
                        // then a second of ticks so every queued event is delivered and
                        // judged; then the poster process, with the ticks reading the HID
                        // table while it posts, and another second after it exits.
                        if tick > 10 && sent < *presses {
                            press_synthetically(
                                main_thread(),
                                SYNTHETIC_FORMS[(sent % 4) as usize],
                            );
                            sent += 1;
                            false
                        } else if sent == *presses && tick == 10 + presses + 60 {
                            before_posting = gate.borrow().counts.clone();
                            active_at_post = app_is_active(main_thread());
                            poster = spawn_poster();
                            poster_started = true;
                            false
                        } else if let Some(child) = poster.as_mut() {
                            match poster_exited_at {
                                None => {
                                    if child.try_wait().ok().flatten().is_some() {
                                        poster_exited_at = Some(tick);
                                    }
                                    false
                                }
                                Some(exited) => tick > exited + 60,
                            }
                        } else {
                            poster_started && tick > 10 + presses + 120
                        }
                    }
                    Mode::PostForged { .. } | Mode::SetUp => {
                        unreachable!("these modes have no window")
                    }
                    Mode::CaptureBug { .. } => unreachable!("the bug capture runs on its own"),
                    Mode::ColorCheck { .. } => unreachable!("the color check runs on its own"),
                    Mode::ProbeHeld { seconds, frame } => {
                        let captured = gate.borrow().counts.frames > 0;
                        if captured {
                            if let Some(path) = frame {
                                if let Err(error) = cx.update(|cx| view.read(cx).write_frame(path))
                                {
                                    eprintln!("deep-app: frame: {error}");
                                }
                            }
                        }
                        captured || elapsed >= *seconds as f64
                    }
                };
                if done {
                    let probe = match &mode {
                        Mode::ProbeSynthetic { .. } => "synthetic",
                        Mode::ProbeHeld { .. } => "held",
                        _ => "cursor-demo",
                    };
                    let posted_from_process = poster.take().map(|child| {
                        let after = gate.borrow().counts.clone();
                        posting_window(child, &before_posting, &after, active_at_post)
                    });
                    let outcome = Outcome {
                        probe,
                        presses_sent: sent,
                        ever_held,
                        posted_from_process,
                    };
                    report(&gate, &seen, &view, cx, outcome);
                    cx.update(|cx| cx.quit());
                    break;
                }
            }
        })
        .detach();
    }

    /// What a probe run came to, beyond the gate's own counts.
    struct Outcome {
        probe: &'static str,
        presses_sent: u64,
        ever_held: bool,
        posted_from_process: Option<serde_json::Value>,
    }

    /// Prints what the gate saw and counted as JSON, then the report line the acceptance
    /// tests read. Events are grouped by shape (kind, fields, verdict) with a count each; the
    /// posting pid reads `self` when it is this process.
    fn report(
        gate: &Rc<RefCell<Gate>>,
        seen: &Rc<RefCell<Vec<Seen>>>,
        view: &Entity<CursorWindow>,
        cx: &mut AsyncApp,
        outcome: Outcome,
    ) {
        let Outcome {
            probe,
            presses_sent,
            ever_held,
            posted_from_process,
        } = outcome;
        let own_pid = i64::from(std::process::id());
        let seen = seen.borrow();
        let mut by_shape: Vec<serde_json::Value> = Vec::new();
        for event in seen.iter() {
            let shape = serde_json::json!({
                "kind": event.kind,
                "key_code": event.key_code,
                "repeat": event.repeat,
                "option": event.option,
                "has_cg_event": event.has_cg_event,
                "source_state": event.source_state,
                "source_pid": event.source_pid.map(|pid| if pid == own_pid { "self".to_owned() } else { pid.to_string() }),
                "hid_chord_down": event.hid_chord_down,
                "verdict": event.verdict,
            });
            match by_shape.iter_mut().find(|row| row["shape"] == shape) {
                Some(row) => row["count"] = (row["count"].as_u64().unwrap_or(0) + 1).into(),
                None => by_shape.push(serde_json::json!({ "shape": shape, "count": 1 })),
            }
        }
        let (has_frame, requested) = cx.update(|cx| {
            let view = view.read(cx);
            (view.has_frame(), view.requested())
        });
        let access = capture_access();
        let permission = if access {
            "granted"
        } else if requested {
            "denied"
        } else {
            "undetermined"
        };
        let counts = gate.borrow().counts.clone();
        let detail = serde_json::json!({
            "spike": 339,
            "detail": probe,
            "pid": own_pid,
            "shortcut": "option+space",
            "forms": SYNTHETIC_FORMS,
            "presses_sent": presses_sent,
            "counts": {
                "presses": counts.presses,
                "hardware_presses": counts.hardware_presses,
                "refused_presses": counts.refused_presses,
                "holds": counts.holds,
                "releases": counts.releases,
                "capture_attempts": counts.capture_attempts,
                "frames": counts.frames,
                "ticks_without_access": counts.ticks_without_access,
                "ticks_with_hid_key": counts.ticks_with_hid_key,
                "ticks_with_hid_option": counts.ticks_with_hid_option,
            },
            "frame_shown": has_frame,
            "posted_from_process": posted_from_process,
            "events": by_shape,
        });
        println!("{detail}");
        // A synthetic probe reports the presses the gate judged, so a press that never
        // reached the monitor isn't counted as refused; a held probe reports the holds the
        // HID table read, since the person's keys go to whichever app is key.
        let presses = match probe {
            "synthetic" => counts.presses,
            _ => counts.holds,
        };
        let line = serde_json::json!({
            "spike": 339,
            "mode": probe,
            "presses": presses,
            "frames": counts.frames,
            "held": ever_held || counts.holds > 0,
            "permission": permission,
        });
        println!("{line}");
    }
}

#[cfg(not(target_os = "macos"))]
mod trusted {
    pub fn start(_: super::Mode, _: &mut gpui_kit::App) {
        eprintln!("deep-app: the cursor window and the probes run on macOS only");
    }
}

/// `--color-check` (#140): every layer the app presents through, read back and asked its colorspace.
#[cfg(target_os = "macos")]
mod color_check {
    use std::{cell::RefCell, rc::Rc};

    use deep_app::color;
    use deep_gpu::device::{Backend, Gpu};
    use deep_gpu::surface::{allocate, Handoff, Path, Shown};
    use gpui_apple::metal_renderer::layer_colorspace;
    use gpui_kit::*;
    use objc2::rc::Retained;
    use objc2_app_kit::NSView;
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
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::centered(size(px(560.), px(160.)), cx)),
            ..Default::default()
        };
        open_window(options, cx, move |window, cx| {
            let painted = placed.clone();
            window.on_next_frame(move |window, cx| {
                let _slots = slots;
                check(window, cx, statuses, painted, wgpu_untagged)
            });
            cx.new(|_| Swatches { shown, placed })
        })
        .expect("open the window");
        cx.activate(true);
    }

    /// The window's own CAMetalLayer: the layer GPUI's view hosts.
    fn window_layer(window: &Window) -> Retained<CAMetalLayer> {
        let handle = HasWindowHandle::window_handle(window).expect("the window's handle");
        let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
            panic!("an AppKit window");
        };
        // SAFETY: gpui's AppKit handle wraps its NSView, alive while the gpui window is.
        let view: &NSView = unsafe { handle.ns_view.cast::<NSView>().as_ref() };
        let layer = view.layer().expect("the view's layer");
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
        let frame = match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(frame)
            | wgpu::CurrentSurfaceTexture::Suboptimal(frame) => frame,
            other => {
                // A window the platform reports occluded (a closed lid, another Space) gets no
                // drawable: nothing can be read back, so the check says why and fails.
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
                swatches
                    .push(json!({"layer": "wgpu-surface", "status": status, "read": wgpu_read[i]}));
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
}

/// `--capture-bug STORE` (#105): the picker, the hold, the recording and its asset.
#[cfg(target_os = "macos")]
mod capture_bug {
    use std::{
        path::PathBuf,
        sync::{Arc, Mutex},
        time::{Duration, Instant},
    };

    use deep_app::capture::{
        close_picker, keep, picked, prepare, present_picker, spool, start as record, stop,
        Indicator, Observer, Reported, Shared, MAX_SECONDS,
    };
    use deep_app::trusted_input::{
        capture_access, hid_shortcut_down, main_thread, request_capture_access,
    };
    use gpui_kit::*;
    use serde_json::{json, Value};

    /// The HID table is read this often while a hold is awaited or runs.
    const TICK: Duration = Duration::from_millis(4);
    /// How long a person has to pick and to hold, and the recording to finish.
    const WAIT: Duration = Duration::from_secs(540);
    const FINISH: Duration = Duration::from_secs(10);

    pub fn start(store: PathBuf, cx: &mut App) {
        // The first request shows the Screen Recording prompt and reads false until granted.
        if !(capture_access() || request_capture_access()) {
            println!("{}", json!({"capture": 105, "permission": "denied"}));
            cx.quit();
            return;
        }
        let shared: Shared = Arc::new(Mutex::new(Reported::default()));
        let observer = Observer::new(shared.clone());
        present_picker(&observer);
        cx.activate(true);
        cx.spawn(async move |cx| {
            let (line, ok) = match run(&store, &shared, &observer, cx).await {
                Ok(line) => (line, true),
                Err(blocked) => (json!({"capture": 105, "blocked": blocked}), false),
            };
            println!("{line}");
            if !ok {
                std::process::exit(1);
            }
            cx.update(|cx| cx.quit());
        })
        .detach();
    }

    /// Waits a tick, then reads what was reported; an error anything reported ends the run.
    async fn tick<T>(
        cx: &mut AsyncApp,
        shared: &Shared,
        read: impl Fn(&Reported) -> Option<T>,
    ) -> Result<Option<T>, String> {
        cx.background_executor().timer(TICK).await;
        let reported = shared
            .lock()
            .map_err(|_| "a callback panicked".to_string())?;
        match &reported.failed {
            Some(failed) => Err(failed.clone()),
            None => Ok(read(&reported)),
        }
    }

    async fn run(
        store: &std::path::Path,
        shared: &Shared,
        observer: &Observer,
        cx: &mut AsyncApp,
    ) -> Result<Value, String> {
        let begun = Instant::now();
        let filter = loop {
            let answer = tick(cx, shared, |r| match r.cancelled {
                true => Some(None),
                false => r.picked.clone().map(Some),
            })
            .await?;
            match answer {
                Some(Some(picked)) => break picked.0,
                Some(None) => return Err("the picker was cancelled: nothing recorded".into()),
                None if begun.elapsed() > WAIT => return Err("no pick".into()),
                None => {}
            }
        };
        close_picker(observer);
        let (source, display) = picked(&filter);
        let spool = spool();
        let _ = std::fs::remove_file(&spool);
        let (stream, _recording) = prepare(&filter, observer, &spool)?;

        // Nothing records until the HID table reads the chord down.
        while !hid_shortcut_down() {
            tick(cx, shared, |_| Some(())).await?;
            if begun.elapsed() > WAIT {
                return Err("the shortcut was never held".into());
            }
        }
        let down = Instant::now();
        let indicator = Indicator::show(main_thread());
        record(&stream, shared);
        while hid_shortcut_down() && down.elapsed().as_secs_f64() < MAX_SECONDS {
            tick(cx, shared, |_| Some(())).await?;
        }
        let held = down.elapsed();
        stop(&stream, shared);
        drop(indicator);

        let stopped = Instant::now();
        while tick(cx, shared, |r| r.finished.then_some(()))
            .await?
            .is_none()
        {
            if stopped.elapsed() > FINISH {
                return Err("the recording never finished".into());
            }
        }
        let bytes = std::fs::read(&spool).map_err(|e| format!("the recording: {e}"))?;
        let _ = std::fs::remove_file(&spool);
        let sha = keep(store, &bytes).map_err(|e| format!("the evidence store: {e}"))?;
        let (frames, first) = {
            let r = shared
                .lock()
                .map_err(|_| "a callback panicked".to_string())?;
            (r.frames, r.first_frame)
        };
        let ms = |d: Duration| (d.as_secs_f64() * 1000.0 * 10.0).round() / 10.0;
        Ok(json!({
            "capture": 105,
            "permission": "granted",
            "picker": true,
            "source": source,
            "display": display.map(|(id, main)| json!({"id": id, "main": main})),
            "frames": frames,
            "first_frame_ms": first.map(|f| ms(f.duration_since(down))),
            "held_ms": ms(held),
            "asset": {"sha256": sha, "redaction": "unknown"},
        }))
    }
}

#[cfg(not(target_os = "macos"))]
mod capture_bug {
    pub fn start(_: std::path::PathBuf, _: &mut gpui_kit::App) {
        eprintln!("deep-app: the bug capture runs on macOS only");
    }
}

#[cfg(target_os = "macos")]
mod menu_bar {
    use deep_app::brand;
    use objc2::{rc::Retained, AllocAnyThread as _, MainThreadMarker};
    use objc2_app_kit::{
        NSApplication, NSBitmapImageRep, NSCellImagePosition, NSImage, NSStatusBar,
        NSVariableStatusItemLength,
    };
    use objc2_foundation::{NSData, NSSize, NSString};

    /// The kit's menu-bar template as one image with both scales, 16 pt, marked as a template
    /// so macOS tints it for the light and the dark menu bar.
    fn template() -> Option<Retained<NSImage>> {
        let size = NSSize::new(brand::MENU_BAR_PT, brand::MENU_BAR_PT);
        let image = NSImage::initWithData(
            NSImage::alloc(),
            &NSData::with_bytes(brand::MENU_BAR_TEMPLATE),
        )?;
        if let Some(rep) =
            NSBitmapImageRep::imageRepWithData(&NSData::with_bytes(brand::MENU_BAR_TEMPLATE_2X))
        {
            rep.setSize(size);
            image.addRepresentation(&rep);
        }
        image.setSize(size);
        image.setTemplate(true);
        Some(image)
    }

    /// There is no `.app` bundle yet, so the dock shows the kit's `.icns` set on the running app.
    pub fn set_dock_icon() {
        let mtm = MainThreadMarker::new().expect("the dock icon is set from the main thread");
        let image = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(brand::APP_ICON));
        // SAFETY: called on the main thread with an image this process owns.
        unsafe { NSApplication::sharedApplication(mtm).setApplicationIconImage(image.as_deref()) };
    }

    /// gpui-kit has no menu-bar item, so the count is one `NSStatusItem`, kept for the life
    /// of the process, with the template mark before the count.
    pub fn show_title(title: &str) {
        let mtm = MainThreadMarker::new().expect("the menu bar is set from the main thread");
        let item = NSStatusBar::systemStatusBar().statusItemWithLength(NSVariableStatusItemLength);
        if let Some(button) = item.button(mtm) {
            if let Some(image) = template() {
                button.setImage(Some(&image));
                button.setImagePosition(NSCellImagePosition::ImageLeading);
            }
            button.setTitle(&NSString::from_str(title));
        }
        std::mem::forget(item);
    }
}

#[cfg(not(target_os = "macos"))]
mod menu_bar {
    pub fn set_dock_icon() {}
    pub fn show_title(_: &str) {}
}
