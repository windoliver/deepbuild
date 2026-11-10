//! `deep-app [--panel DIR [--view NAME]] [MODE]`: the app's shell (#1172) over the hub's record, with the one count in
//! the menu bar. The hub's reader folds the record, and a tick moves the count, the window and a shown card with it.
//!
//! Issue #262: with `--view`, the panel draws that plug-in view, and the app reports it shown to the hub every 5 s
//! while the window shows it (`deep_app::shown`).
//!
//! `deep-app --set-up` runs the first launch's Set up click with no window and prints its one line (#326).
//!
//! Issue #41, each with no window: `--hub-needs` prints the hub contract the app speaks and every method it calls as
//! one JSON line; `--hub-check` connects to the running hub as the window does and says `hub ok`, or, when the hub's
//! hello doesn't cover the app, prints the one screen naming the older side and its fix, having called nothing;
//! `--check-for-updates` prints Check for updates' line.
//!
//! Issue #883: the window's app posts each ask to Notification Center and withdraws it once the
//! record says it closed (`notifications`, below); macOS shows them only from the app bundle `scripts/app-bundle`
//! builds. Issue #994: a second launch brings the first window forward and exits, and the notifier keeps trying a hub
//! that isn't answering. `--notification-center`, run from that bundle, prints what Notification Center holds from the app, one
//! JSON line per notification (`{"tag","title","body"}`), and quits.
//!
//! With `DEEP_APP_EXIT_AFTER_FIRST_FRAME` set it prints `first-frame-ms N` once the window
//! has drawn and quits, which is how cold start is measured.
//!
//! Issue #339's cursor window and its probes are gone (#1457): nothing called them.
//!
//! Issue #105 adds `--capture-bug STORE`: opens the system picker; once a person has picked a
//! display or a window, records it while they hold ⌥Space (at most 120 s), keeps the MP4 in the
//! evidence store at STORE by its hash and prints one line: `{"capture":105,"permission",
//! "picker":true,"source","display":{"id","main"},"frames","first_frame_ms","held_ms",
//! "asset":{"sha256","redaction":"unknown"}}`.
//!
//! Issue #498 adds `--capture-devices STORE`: reads DeepBuild's camera and microphone permissions
//! (never asks for them; without both it prints them and quits), then twice arms a capture of the
//! default camera and microphone and records each while a person holds ⌥Space, keeps each
//! recording in the evidence store at STORE by its hash and prints one line: `{"capture":498,
//! "permission":{"camera","microphone"},"via","hold","holds":[{"down_ms","up_ms"}],"captures":
//! [{"request","source","requested_ms","period_ms","kept_before_hold","kept","first_ms","last_ms",
//! "asset":{"sha256","redaction":"unknown"}}]}`.
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
//! Issue #140 adds `--capture-seam`: the capture seam's macOS backend asked for the main display
//! with no picker (refused), then the system picker; once a person has picked, 3 s of it
//! recorded and kept nowhere, with the system's recording indicator read from the window server
//! while frames arrive. One line: `{"capture":140,"backend","permission","direct":{"outcome",
//! "frames","indicator":{"system"}},"picker","picked","recorded","frames","indicator":{"system"}}`.
//!

use std::{path::PathBuf, time::Instant};

use deep_app::{commands::Palette, init, menu_bar_line, mount_panel, show::CanvasPanel, views};
use gpui_kit::*;

// The probes that stay (#1457): each a flag the suites run as `target/debug/deep-app --flag`, in a file of its own.
#[cfg(all(feature = "canvas-fixture", target_os = "macos"))]
#[path = "probes/canvas.rs"]
mod canvas;
#[cfg(target_os = "macos")]
#[path = "probes/capture_bug.rs"]
mod capture_bug;
#[cfg(target_os = "macos")]
#[path = "probes/capture_devices.rs"]
mod capture_devices;
#[cfg(target_os = "macos")]
#[path = "probes/capture_seam.rs"]
mod capture_seam;
#[cfg(all(feature = "chrome-fixture", target_os = "macos"))]
#[path = "probes/chrome.rs"]
mod chrome;
#[cfg(target_os = "macos")]
#[path = "probes/color_check.rs"]
mod color_check;
#[cfg(target_os = "macos")]
#[path = "probes/notification_center.rs"]
mod notification_center;
#[cfg(not(target_os = "macos"))]
#[path = "probes/unsupported.rs"]
mod unsupported;
#[cfg(not(target_os = "macos"))]
use unsupported::{capture_bug, notification_center};

#[derive(Clone, Debug, PartialEq, Eq)]
enum Mode {
    Window,
    SetUp,
    HubNeeds,
    HubCheck,
    CheckForUpdates,
    NotificationCenter,
    CaptureBug { store: PathBuf },
    CaptureDevices { store: PathBuf },
    ColorCheck { planted: Option<String> },
    CaptureSeam,
}

fn main() {
    // The signed app has no allow-jit entitlement (#358), so no panel in it may ask for native code.
    rquickjs_jit::deny_native_code();
    // Issue #1434: `--chrome <fixture> (--snapshot <png> | --idle <s> | --frames <n>)`, in a chrome-fixture build.
    #[cfg(all(feature = "chrome-fixture", target_os = "macos"))]
    if std::env::args().nth(1).as_deref() == Some("--chrome") {
        chrome::run(std::env::args().skip(2).collect());
        return;
    }
    // Issue #1485: `--canvas <scenario.json>`, in a canvas-fixture build.
    #[cfg(all(feature = "canvas-fixture", target_os = "macos"))]
    if std::env::args().nth(1).as_deref() == Some("--canvas") {
        canvas::run(std::env::args().nth(2));
        return;
    }
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
    let (panel_dir, view, mode) = args();
    if mode == Mode::NotificationCenter {
        notification_center::print();
        return;
    }
    if mode == Mode::HubNeeds {
        let needs = serde_json::json!({ "contract": deep_app::hub::CONTRACT, "features": deep_app::hub::NEEDS });
        println!("{needs}");
        return;
    }
    if mode == Mode::HubCheck {
        let mut reader = deep_app::record::RecordReader::unopened_folded(
            &deep_app::hub::address(),
            &deep_app::hub::root().join("control.token"),
        );
        match reader.check() {
            Err(deep_app::hub::HubError::Older(screen)) => println!("{screen}"),
            Err(
                error @ (deep_app::hub::HubError::Io(_) | deep_app::hub::HubError::Protocol(_)),
            ) => {
                eprintln!(
                    "deep-app: the hub at {} didn't answer: {error:?}",
                    deep_app::hub::address().display()
                );
                std::process::exit(1);
            }
            // A hello that covers the app: the window's calls are made, whatever each returns.
            reached => {
                println!("hub ok: contract {}", deep_app::hub::CONTRACT);
                if let Err(error) = reached {
                    eprintln!("deep-app: the hub refused a call: {error:?}");
                }
            }
        }
        return;
    }
    if mode == Mode::CheckForUpdates {
        println!("{}", deep_app::setup::check_for_updates());
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
    // Issue #1172: macOS has no outside switch for one process's appearance, so a check forces it here.
    match std::env::var("DEEP_APP_APPEARANCE").as_deref() {
        Ok("dark") => deep_app::chrome::force_dark(Some(true)),
        Ok("light") => deep_app::chrome::force_dark(Some(false)),
        _ => {}
    }
    // One app per user (#994). A window for a panel or a view is a tool beside it, and runs no notifier.
    let mut held = None;
    if mode == Mode::Window && panel_dir.is_none() && view.is_none() {
        match deep_app::single::claim(&deep_app::hub::root()) {
            Ok(deep_app::single::Claim::Second) => return,
            Ok(deep_app::single::Claim::First(claim)) => held = Some(claim),
            Err(error) => {
                eprintln!("deep-app: couldn't claim the app, so no notifications: {error}")
            }
        }
    }
    // A `deepbuild://` link the OS hands the app waits for the tick, which can open it (#1460).
    let (links, linked) = std::sync::mpsc::channel::<String>();
    let app = application();
    app.on_open_urls(move |urls| {
        for url in urls {
            let _ = links.send(url);
        }
    });
    app.run(move |cx| {
        gpui_kit::init(cx);
        init(cx);
        menu_bar::set_dock_icon();
        cx.on_system_notification_response(|response, cx| {
            if response.action_id.is_none() {
                let _ = deep_app::open::notification(&response.tag, cx);
            }
        });
        #[cfg(feature = "test-bound")]
        if let Some(path) = std::env::var_os("DEEP_APP_TEST_BOUND") {
            if let Err(why) = deep_app::bound::load(std::path::Path::new(&path)) {
                eprintln!("deep-app: DEEP_APP_TEST_BOUND: {why}");
            }
        }
        // Every window reads the record; only the one app of a user notifies (#994). The planted build shows the spike's
        // made-up count and no record.
        #[cfg(not(feature = "plant-spike-window"))]
        if mode == Mode::Window {
            notifications::start(held, linked, cx);
        }
        #[cfg(not(feature = "plant-spike-window"))]
        menu_bar::show_title(&menu_bar_line());
        #[cfg(feature = "plant-spike-window")]
        menu_bar::show_title(&deep_app::menu_bar_title(&deep_app::sessions()));

        let runtime = deep_app::new_runtime().expect("panel runtime");
        // The window draws its own title bar, with the mark, so it owns the bar's drag.
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::centered(
                size(
                    deep_app::chrome::sizes().window.0,
                    deep_app::chrome::sizes().window.1,
                ),
                cx,
            )),
            ..gpui_kit::component::TitleBar::window_options()
        };
        let opens = mode == Mode::Window && panel_dir.is_none();
        let opener = deep_app::installed::opener(runtime.clone());
        let mounts = runtime.clone();
        let palette: std::rc::Rc<std::cell::RefCell<Option<Entity<Palette>>>> = Default::default();
        let made = palette.clone();
        let (window, _) = open_window(options, cx, move |window, cx| {
            let panel = panel_dir.as_ref().map(|dir| {
                // A script panel reads its colors from the theme, so it holds the look's roles before one mounts.
                deep_app::chrome::follow(window, cx);
                let script: AnyView = mount_panel(&runtime, dir, window, cx)
                    .unwrap_or_else(|error| panic!("panel {}: {error:#}", dir.display()))
                    .into();
                let elements = deep_app::panel_values::elements(dir);
                if elements.is_empty() {
                    script
                } else {
                    cx.new(|cx| deep_app::panel_values::BoundPanel::new(script, elements, cx))
                        .into()
                }
            });
            if let Some(view) = view {
                let handle = window.window_handle();
                deep_app::shown::start(
                    vec![view],
                    handle,
                    &deep_app::hub::address(),
                    &deep_app::hub::root().join("control.token"),
                    cx,
                );
            }
            window.on_next_frame(move |_, cx| {
                let ms = started.elapsed().as_secs_f64() * 1000.0;
                eprintln!("first-frame-ms {ms:.1}");
                if std::env::var_os("DEEP_APP_EXIT_AFTER_FIRST_FRAME").is_some() {
                    cx.quit();
                }
                match mode {
                    Mode::Window => {}
                    Mode::CaptureBug { store } => capture_bug::start(store, cx),
                    #[cfg(target_os = "macos")]
                    Mode::CaptureDevices { store } => capture_devices::start(store, cx),
                    #[cfg(target_os = "macos")]
                    Mode::CaptureSeam => capture_seam::start(cx),
                    // The other modes ran before the window opened.
                    _ => {}
                }
            });
            #[cfg(feature = "plant-spike-window")]
            return cx.new(|_| deep_app::Spike::new(None));
            #[cfg(not(feature = "plant-spike-window"))]
            {
                let layout = views::Layout::app(panel.is_some());
                if let Some(view) = panel {
                    deep_app::open::place_extension(view, cx);
                }
                let canvas = cx.new(|_| CanvasPanel::new(deep_app::hub::root().join("evidence")));
                views::set_canvas(canvas.clone());
                deep_app::show::follow(canvas, cx);
                cx.new(|cx| {
                    let mut shell = views::Shell::new(&layout, window, cx).with_title_bar();
                    let palette = cx.new(|cx| {
                        let mut palette = Palette::new(&[], Vec::new(), opener, window, cx);
                        palette.set_entries(deep_app::installed::shipped_pages(), cx);
                        palette
                    });
                    *made.borrow_mut() = Some(palette.clone());
                    shell.set_commands(palette, window, cx);
                    let words = cx.new(|cx| {
                        deep_app::words::WordsBox::new(deep_app::words::hub_say(), window, cx)
                    });
                    shell.set_box(words, cx);
                    shell
                })
            }
        })
        .expect("open window");
        #[cfg(not(feature = "plant-spike-window"))]
        if opens {
            load_installed(window, palette, mounts, cx);
        }
        cx.activate(true);
    });
}

/// Once the hub answers, the views you installed mount and ⌘K learns them, once (#1454).
#[cfg(not(feature = "plant-spike-window"))]
fn load_installed(
    window: AnyWindowHandle,
    palette: std::rc::Rc<std::cell::RefCell<Option<Entity<Palette>>>>,
    runtime: std::rc::Rc<gpui_shell::ShellRuntime>,
    cx: &mut App,
) {
    cx.spawn(async move |cx| {
        while !deep_app::record::connected() {
            cx.background_executor()
                .timer(std::time::Duration::from_millis(250))
                .await;
        }
        let Some(palette) = palette.borrow().clone() else {
            return;
        };
        let _ = window.update(cx, |_, window, cx| {
            deep_app::installed::load(&palette, &runtime, window, cx)
        });
    })
    .detach();
}

fn args() -> (Option<PathBuf>, Option<String>, Mode) {
    let mut panel = None;
    let mut view = None;
    let mut mode = Mode::Window;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--panel" => {
                panel = Some(PathBuf::from(
                    args.next().expect("--panel takes a directory"),
                ))
            }
            "--view" => {
                view = Some(
                    args.next()
                        .expect("--view takes the name of the view the panel draws"),
                )
            }
            "--set-up" => mode = Mode::SetUp,
            "--hub-needs" => mode = Mode::HubNeeds,
            "--hub-check" => mode = Mode::HubCheck,
            "--check-for-updates" => mode = Mode::CheckForUpdates,
            "--notification-center" => mode = Mode::NotificationCenter,
            "--capture-bug" => {
                mode = Mode::CaptureBug {
                    store: PathBuf::from(args.next().expect("--capture-bug takes a folder")),
                }
            }
            "--capture-devices" => {
                mode = Mode::CaptureDevices {
                    store: PathBuf::from(args.next().expect("--capture-devices takes a folder")),
                }
            }
            "--color-check" => mode = Mode::ColorCheck { planted: None },
            "--capture-seam" => mode = Mode::CaptureSeam,
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
            other => panic!("unknown argument {other}"),
        }
    }
    assert!(
        view.is_none() || panel.is_some(),
        "--view names the view a --panel draws"
    );
    (panel, view, mode)
}

/// Issue #883: the hub's record through the app's one reader. The notifier posts each ask it finds due to
/// Notification Center, tagged with its session so a newer one replaces it in place, and withdraws one whose ask the
/// record says closed. The reader starts from the inbox and the stream after it, so what was in the record before
/// the app or the hub started never reaches the notifier as new.
///
/// Issue #994: the loop outlives a late or lost hub, trying it on [`HubWatch`]'s schedule, and is the one notifier: a
/// later launch calls this app forward through `held`. It reads the notification setting at start and each time the
/// app becomes active, and an ask macOS wouldn't show is logged as not notified, never as notified.
///
/// Issue #1172: the same tick moves the menu bar's count, the window and a shown card with the record, in a window for
/// a panel or a view too, which only leaves the notifying out.
mod notifications {
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use deep_app::{
        hub,
        notify::{self, NotificationSetting, Notifier, NOTIFY_AFTER},
        record::{self, HubWatch, RecordReader},
        single::Held,
    };
    use gpui_kit::{App, AsyncApp, SystemNotification};

    const TICK: Duration = record::TICK;

    fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |since| since.as_millis() as u64)
    }

    /// What the OS says now: the test's stand-in if set, else the bundle's setting; `None` when neither answers.
    fn setting() -> Option<NotificationSetting> {
        // The stand-in is a test door: a release build has none (#1457).
        #[cfg(debug_assertions)]
        if let Ok(name) = std::env::var("DEEP_APP_NOTIFICATION_SETTING") {
            return NotificationSetting::parse(&name);
        }
        super::notification_center::setting()
    }

    fn read_setting(notifier: &mut Notifier) {
        if let Some(setting) = setting() {
            record::report_setting(setting.name());
            if !cfg!(feature = "plant-posts-unchecked") {
                notifier.set_setting(setting, now());
            }
        }
    }

    /// The notifier starts on the record it first reads and what Notification Center still holds.
    fn begin(notifier: &mut Notifier, cx: &mut AsyncApp) {
        let held = super::notification_center::delivered().unwrap_or_default();
        let stale = record::with_view(|view| {
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
                                    notify::carries(&notification.text, question)
                                })
                        })
                        .and_then(|row| row["ask"].as_str().map(str::to_owned));
                    notification
                })
                .partition(|notification| notification.ask.is_some());
            notifier.start(view, kept);
            stale
        })
        .unwrap_or_default();
        // What the reads hold, the notifier has started on.
        record::take_unseen();
        cx.update(|cx| {
            for notification in stale {
                eprintln!("deep-app: withdrew {}", notification.session);
                cx.dismiss_system_notification(&notification.session);
            }
        });
    }

    pub fn start(held: Option<Held>, linked: std::sync::mpsc::Receiver<String>, cx: &mut App) {
        record::install(RecordReader::unopened_folded(
            &hub::address(),
            &hub::root().join("control.token"),
        ));
        cx.spawn(async move |cx| {
            let mut notifier = Notifier::new(NOTIFY_AFTER);
            let mut watch = HubWatch::default();
            let (mut begun, mut active) = (false, false);
            let notifies = held.is_some();
            let mut shown = deep_app::menu_bar_line();
            if notifies {
                read_setting(&mut notifier);
            }
            loop {
                cx.background_executor().timer(TICK).await;
                // A later launch brings the app forward; `deep open` and a link open their address (#1460).
                for call in held.as_ref().map(Held::calls).unwrap_or_default() {
                    eprintln!("deep-app: brought forward");
                    cx.update(|cx| {
                        cx.activate(true);
                        if let Some(window) = cx.windows().first() {
                            let _ = window.update(cx, |_, window, _| window.activate_window());
                        }
                        if let Some(address) = call.address.clone() {
                            call.reply(&reply(deep_app::open::arrive(&address, cx)));
                        }
                    });
                }
                while let Ok(link) = linked.try_recv() {
                    cx.update(|cx| {
                        cx.activate(true);
                        let _ = deep_app::open::link(&link, cx);
                    });
                }
                let was_active = std::mem::replace(&mut active, super::menu_bar::app_active());
                if notifies && active && !was_active {
                    read_setting(&mut notifier);
                }
                let now = now();
                if deep_app::setup::refresh() {
                    cx.update(|cx| cx.refresh_windows());
                }
                watch.tick(now, || record::read(Duration::from_millis(5)));
                if !notifies {
                    // Only the notifier reads these; a window that doesn't notify lets them go.
                    record::take_unseen();
                } else if begun {
                    post(&mut notifier, now, cx);
                } else if record::connected() {
                    begin(&mut notifier, cx);
                    begun = true;
                    post(&mut notifier, now, cx);
                }
                let reach = notifier.reach(watch.down());
                let reached = reach != notify::reach();
                if reached {
                    notify::publish(reach);
                }
                cx.update(|cx| {
                    // What the reader applied reaches the views that observe it, and marks their windows dirty (#1546).
                    record::sync(cx);
                    // What the app can reach, the hub's age and setup draw beside the record, and move the count's line.
                    let line = deep_app::menu_bar_line();
                    if reached || line != shown {
                        record::notify_views(cx);
                        super::menu_bar::show_title(&line);
                        shown = line;
                    }
                    deep_app::card::tick(now, cx);
                });
            }
        })
        .detach();
    }

    /// What `deep open` prints: the address it opened, or what became of it.
    fn reply(said: Result<String, String>) -> String {
        match said {
            Ok(address) => format!("opened {address}"),
            Err(words) => words,
        }
    }

    /// One tick's work: what the record brought, what came due, what left.
    fn post(notifier: &mut Notifier, now: u64, cx: &mut AsyncApp) {
        let before: Vec<String> = notifier
            .delivered()
            .iter()
            .map(|notification| notification.session.clone())
            .collect();
        for event in record::take_unseen() {
            notifier.saw(&event, now);
        }
        let posted = record::with_view(|view| {
            // Sounds off in the box's words (#1998) leaves the question unsounded.
            notifier.due(view, now, None, deep_app::hub::sounds_on())
        })
        .unwrap_or_default();
        for (ask, session) in notifier.newly_missed() {
            eprintln!(
                "deep-app: not notified {session} {ask}: {}",
                notifier.reach(false).setting.name()
            );
        }
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
                if notification.sound.is_some() {
                    super::menu_bar::play_question();
                }
                cx.show_system_notification(SystemNotification {
                    tag: notification.session.into(),
                    title: notification.title.into(),
                    body: body.to_owned().into(),
                    actions: Vec::new(),
                });
            }
        });
    }
}

#[cfg(target_os = "macos")]
mod menu_bar {

    use deep_app::brand;
    use objc2::{rc::Retained, AllocAnyThread as _, MainThreadMarker};
    use objc2_app_kit::{
        NSApplication, NSBitmapImageRep, NSCellImagePosition, NSImage, NSSound, NSStatusBar,
        NSStatusItem, NSVariableStatusItemLength,
    };
    use objc2_foundation::{NSData, NSSize, NSString};

    thread_local! {
        /// The count's one status item, kept for the life of the process.
        static ITEM: Retained<NSStatusItem> =
            NSStatusBar::systemStatusBar().statusItemWithLength(NSVariableStatusItemLength);
    }

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

    /// gpui-kit has no menu-bar item, so the count is one `NSStatusItem`, with the template mark before the count.
    pub fn show_title(title: &str) {
        let mtm = MainThreadMarker::new().expect("the menu bar is set from the main thread");
        ITEM.with(|item| {
            if let Some(button) = item.button(mtm) {
                if button.image().is_none() {
                    if let Some(image) = template() {
                        button.setImage(Some(&image));
                        button.setImagePosition(NSCellImagePosition::ImageLeading);
                    }
                }
                button.setTitle(&NSString::from_str(title));
            }
        });
    }

    /// Whether the app is the active one.
    pub fn app_active() -> bool {
        let mtm = MainThreadMarker::new().expect("read from the main thread");
        NSApplication::sharedApplication(mtm).isActive()
    }

    /// A question sounds like a question: gpui's post carries no sound, so the app plays it.
    pub fn play_question() {
        if let Some(sound) = NSSound::soundNamed(&NSString::from_str("Ping")) {
            sound.play();
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod menu_bar {
    pub fn set_dock_icon() {}
    pub fn show_title(_: &str) {}
    pub fn app_active() -> bool {
        false
    }
    pub fn play_question() {}
}
