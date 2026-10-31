//! `deep-app [--panel DIR] [MODE]`: the spike's window, with the count in the menu bar.
//!
//! `deep-app --set-up` runs the first launch's Set up click with no window and prints its one line (#326).
//!
//! Issue #883: with a hub to read, the window's app posts each ask to Notification Center and withdraws it once the
//! record says it closed (`notifications`, below); macOS shows them only from the app bundle `scripts/app-bundle`
//! builds. `--notification-center`, run from that bundle, prints what Notification Center holds from the app, one
//! JSON line per notification (`{"tag","title","body"}`), and quits.
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
    NotificationCenter,
    CaptureBug {
        store: PathBuf,
    },
}

fn main() {
    // The signed app has no allow-jit entitlement (#358), so no panel in it may ask for native code.
    rquickjs_jit::deny_native_code();
    #[cfg(feature = "panel-check")]
    {
        let all: Vec<String> = std::env::args().skip(1).collect();
        match all.first().map(String::as_str) {
            Some("panel-check") => std::process::exit(deep_app::panel_check::check(&all[1..])),
            Some("panel-bench") => std::process::exit(deep_app::panel_check::bench(&all[1..])),
            Some("panel-keys") => std::process::exit(deep_app::panel_keys::keys(&all[1..])),
            _ => {}
        }
    }
    let started = Instant::now();
    let (panel_dir, mode) = args();
    if let Mode::PostForged { chords } = mode {
        trusted::post_forged(chords);
        return;
    }
    if mode == Mode::NotificationCenter {
        notification_center::print();
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
        if mode == Mode::Window {
            notifications::start(cx);
        }

        let runtime = deep_app::new_runtime().expect("panel runtime");
        // The window draws its own title bar, with the mark, so it owns the bar's drag.
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::centered(size(px(960.), px(640.)), cx)),
            ..gpui_kit::component::TitleBar::window_options()
        };
        open_window(options, cx, move |window, cx| {
            // A script panel reads its colors from the theme, so it holds the look's roles before one mounts.
            deep_app::chrome::follow(window, cx);
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
            "--notification-center" => mode = Mode::NotificationCenter,
            "--capture-bug" => {
                mode = Mode::CaptureBug {
                    store: PathBuf::from(args.next().expect("--capture-bug takes a folder")),
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
                    Mode::PostForged { .. } | Mode::SetUp | Mode::NotificationCenter => {
                        unreachable!("these modes have no window")
                    }
                    Mode::CaptureBug { .. } => unreachable!("the bug capture runs on its own"),
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

/// Issue #883: the hub's record through the app's one reader. The notifier posts each ask it finds due to
/// Notification Center, tagged with its session so a newer one replaces it in place, and withdraws one whose ask the
/// record says closed. The reader starts from the inbox and the stream after it, so what was in the record before
/// the app or the hub started never reaches the notifier as new.
mod notifications {
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use deep_app::{
        hub,
        notify::{Notifier, NOTIFY_AFTER},
        record::{self, RecordReader},
    };
    use gpui_kit::{App, SystemNotification};

    const TICK: Duration = Duration::from_millis(250);

    pub fn start(cx: &mut App) {
        let reader = RecordReader::open(&hub::address(), &hub::root().join("control.token"));
        let Ok(reader) = reader else {
            eprintln!("deep-app: no hub to read, so no notifications");
            return;
        };
        record::install(reader);
        let mut notifier = Notifier::new(NOTIFY_AFTER);
        let held = super::notification_center::delivered().unwrap_or_default();
        let (mut start, mut fed, stale) = record::with_view(|view| {
            // What Notification Center still holds from before: each is its session's open ask whose question it
            // carries, and one whose ask closed while the app was away leaves now.
            let (kept, stale): (Vec<_>, Vec<_>) = held
                .into_iter()
                .map(|mut notification| {
                    notification.ask = view
                        .inbox
                        .iter()
                        .find(|row| {
                            row["session"] == notification.session.as_str()
                                && row["status"] != "closed"
                                && row["question"].as_str().is_some_and(|question| {
                                    !question.is_empty() && notification.text.contains(question)
                                })
                        })
                        .and_then(|row| row["ask"].as_str().map(str::to_owned));
                    notification
                })
                .partition(|notification| notification.ask.is_some());
            notifier.start(&view.events, kept);
            (view.start.clone(), view.events.len(), stale)
        })
        .unwrap_or_default();
        for notification in stale {
            eprintln!("deep-app: withdrew {}", notification.session);
            cx.dismiss_system_notification(&notification.session);
        }
        cx.spawn(async move |cx| loop {
            cx.background_executor().timer(TICK).await;
            let _ = record::poll(Duration::from_millis(5));
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map_or(0, |since| since.as_millis() as u64);
            let before: Vec<String> = notifier
                .delivered()
                .iter()
                .map(|notification| notification.session.clone())
                .collect();
            let posted = record::with_view(|view| {
                // A new hub start: the reader read again, and its events start over.
                if view.start != start {
                    start = view.start.clone();
                    fed = 0;
                }
                for event in &view.events[fed..] {
                    notifier.saw(event, now);
                }
                fed = view.events.len();
                notifier.due(&view.events, now, None, true)
            })
            .unwrap_or_default();
            cx.update(|cx| {
                for session in before.iter().filter(|session| {
                    !notifier
                        .delivered()
                        .iter()
                        .any(|notification| &notification.session == *session)
                }) {
                    eprintln!("deep-app: withdrew {session}");
                    cx.dismiss_system_notification(session);
                }
                for notification in posted {
                    let body = notification
                        .text
                        .split_once('\n')
                        .map_or("", |(_, body)| body);
                    eprintln!(
                        "deep-app: notified {} {}",
                        notification.session,
                        notification.ask.as_deref().unwrap_or("notice")
                    );
                    cx.show_system_notification(SystemNotification {
                        tag: notification.session.into(),
                        title: notification.title.into(),
                        body: body.to_owned().into(),
                        actions: Vec::new(),
                    });
                }
            });
        })
        .detach();
    }
}

#[cfg(target_os = "macos")]
mod notification_center {
    use std::{ptr::NonNull, sync::mpsc, time::Duration};

    use block2::RcBlock;
    use deep_app::notify::Notification;
    use objc2_foundation::{NSArray, NSBundle};
    use objc2_user_notifications::{UNNotification, UNUserNotificationCenter};

    /// What Notification Center holds from the app's bundle, as the OS lists it: each one's tag as its session and
    /// no ask, which only the record can name. `None` outside the bundle, where the center aborts the process, as
    /// gpui notes, or when the OS doesn't answer.
    pub fn delivered() -> Option<Vec<Notification>> {
        NSBundle::mainBundle().bundleIdentifier()?;
        let (sender, receiver) = mpsc::channel();
        let listed = RcBlock::new(move |list: NonNull<NSArray<UNNotification>>| {
            // SAFETY: the OS passes a valid array for the call's duration.
            let list = unsafe { list.as_ref() };
            let held: Vec<Notification> = list
                .iter()
                .map(|notification| {
                    let request = notification.request();
                    let content = request.content();
                    let title = content.title().to_string();
                    Notification {
                        ask: None,
                        session: request.identifier().to_string(),
                        text: format!("{title}\n{}", content.body()),
                        title,
                        sound: None,
                    }
                })
                .collect();
            let _ = sender.send(held);
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .getDeliveredNotificationsWithCompletionHandler(&listed);
        receiver.recv_timeout(Duration::from_secs(10)).ok()
    }

    /// `--notification-center`: one JSON line per notification it holds.
    pub fn print() {
        let Some(held) = delivered() else {
            eprintln!("deep-app: Notification Center didn't list the app's notifications (run it from the bundle)");
            std::process::exit(1);
        };
        for notification in held {
            let body = notification
                .text
                .split_once('\n')
                .map_or("", |(_, body)| body);
            let line = serde_json::json!({"tag": notification.session, "title": notification.title, "body": body});
            println!("{line}");
        }
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
mod notification_center {
    pub fn delivered() -> Option<Vec<deep_app::notify::Notification>> {
        None
    }

    pub fn print() {
        eprintln!("deep-app: --notification-center runs on macOS only");
        std::process::exit(1);
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
