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
                if mode != Mode::Window {
                    trusted::start(mode, cx);
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
