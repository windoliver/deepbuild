//! `deep-replica (--view <needs-you|sidebar|session|terminal-colors|rules> | --first-screen) --out <dir> [--appearance <light|dark>]
//! [--bound <file>] [--selected-row <n>] [--focused-row <n>] [--click <button>] [--window <w>x<h>]`: the
//! replica. Opens the app's shell headless at the reference window on gpui's virtual clock, draws
//! the view over the fixture record as macOS would in that appearance (light when none is given),
//! and writes `snapshots/<view>.json` and `screens/<view>.png` under `out`. `--first-screen` draws Home for the HOME it
//! runs with, over that home's own record, and writes `menu-bar.txt` too (#1002). `--bound` draws the runs' bound values
//! on the session's return card and in a panel, and writes `bound.json`, each with its bounds (#629). `--window <w>x<h>`
//! opens that size in points in place of the reference window, as `960x640` for the app's opening size (#1454).
//! `--panel-kit <dir>` runs `panel@1` on one panel and prints its verdict, for `deep install`.
//! A launch is timed from this process's spawn to the first-frame line it prints. `terminal-colors` draws the look's 16
//! terminal colors as the app's cell grid does, in the center beside the sidebar; the row flags open the sidebar with
//! those rows selected and focused (#1003). `--first-screen --click <button>` clicks it and writes `frames.jsonl`, the
//! frames drawn after the click (#1556).

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(replica::run());
    #[cfg(not(target_os = "macos"))]
    {
        eprintln!("deep-replica: the replica renders pixels on macOS only");
        std::process::exit(2);
    }
}

#[cfg(target_os = "macos")]
mod replica {

    use std::{
        io::Write as _,
        path::Path,
        time::{Duration, Instant},
    };

    use deep_app::views::Layout;
    use deep_replica::{
        shell::{open_shell_with, window_options},
        snapshot::{from_observed, Snapshot},
    };
    use gpui_kit::{test::TestWindowExt, AppContext as _, *};

    /// The reference window, or the size `--window` gave.
    fn window_at(given: Option<(f32, f32)>) -> WindowOptions {
        let reference = window_options();
        let Some((width, height)) = given else {
            return reference;
        };
        WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds {
                origin: Point::default(),
                size: size(px(width), px(height)),
            })),
            ..reference
        }
    }

    pub fn run() -> i32 {
        // Issue #1434: `--chrome <fixture>`, the chrome@1 fixture drawn headless, in a chrome-fixture build only.
        #[cfg(feature = "chrome-fixture")]
        if std::env::args().nth(1).as_deref() == Some("--chrome") {
            return deep_replica::chrome::run();
        }
        // Issue #1436: the chrome-fx@1 pack check and its gallery panel, in a chrome-fixture build only.
        #[cfg(feature = "chrome-fixture")]
        match std::env::args().nth(1).as_deref() {
            Some("--chrome-fx-check") => return deep_replica::chrome::check(),
            Some("--chrome-fx-gallery") => return deep_replica::chrome::gallery(),
            _ => {}
        }
        // Issue #1454: `--panel-kit <dir>`, panel@1 on one panel, for `deep install`: one JSON line, its verdict.
        let mut given = std::env::args().skip(1);
        if given.next().as_deref() == Some("--panel-kit") {
            let Some(dir) = given.next() else {
                eprintln!("usage: deep-replica --panel-kit <dir>");
                return 2;
            };
            let verdict = deep_replica::kit::panel(std::path::Path::new(&dir));
            println!("{}", verdict.to_json());
            return i32::from(!verdict.pass);
        }
        let (view, out, dark, bound, click, size) =
            match deep_replica::view_args("deep-replica", "dir", true) {
                Ok(args) => args,
                Err(code) => return code,
            };
        // gpui's headless window always reports light, so the chrome is told the appearance instead.
        deep_app::chrome::force_dark(dark);

        let started = std::time::Instant::now();
        let mut phases = Vec::new();
        let mut phase =
            |name: &str| phases.push(format!("{name} {}ms", started.elapsed().as_millis()));
        let mut cx = deep_replica::headless_context();
        phase("context and init");
        let first = view == deep_replica::FIRST_SCREEN;
        // The first screen and the rules page (#344) draw this HOME's own record and pages, never the fixture.
        if first || view == deep_replica::RULES_PAGE {
            // A launch reads this home's hub, when one answers; a setup that stopped left none.
            let root = deep_app::hub::root();
            match deep_app::record::RecordReader::open_folded(
                &deep_app::hub::address(),
                &root.join("control.token"),
            ) {
                Ok(reader) => deep_app::record::install(reader),
                Err(_) => deep_app::notify::publish(deep_app::notify::Reach {
                    hub_down: true,
                    ..Default::default()
                }),
            }
        } else {
            deep_app::views::set_state(deep_replica::load_state());
        }
        if let Some(path) = &bound {
            if let Err(why) = deep_app::bound::load(path) {
                eprintln!("deep-replica: {why}");
                return 2;
            }
        }
        let colors = view == deep_replica::TERMINAL_COLORS;
        // The first screen is the pane a person gets (#1454): the app's own layout for this HOME.
        let layout = if colors {
            Layout {
                center: vec![deep_app::views::EXTENSION.into()],
                ..Layout::shipped("home")
            }
        } else if first {
            Layout::app(false)
        } else {
            Layout::shipped(&view)
        };
        let options = window_at(size);
        let (handle, _) = cx.update(|cx| {
            open_shell_with(options, &layout, cx, |_, cx| {
                if colors {
                    deep_app::views::place_extension(
                        cx.new(|_| deep_replica::kit::TerminalColors {
                            dark: dark == Some(true),
                        })
                        .into(),
                    );
                }
            })
        });
        phase("window");
        // The first frame is the launch; the line goes out as soon as it is drawn. The second
        // frame, over cleared canvas items, is the one the snapshot reads.
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .expect("the window draws");
        println!("{}", deep_replica::FIRST_FRAME);
        std::io::Write::flush(&mut std::io::stdout()).expect("stdout flushes");
        phase("first frame");
        let snapshot = cx
            .update_window(handle, |_, window, cx| {
                deep_app::canvas::clear_items();
                window.render_frame(cx);
                from_observed(window)
            })
            .expect("the window draws");
        cx.run_until_parked();
        phase("frames");
        let image = cx
            .capture_screenshot(handle)
            .expect("offscreen rendering is available");
        phase("screenshot");

        std::fs::create_dir_all(out.join("snapshots")).expect("the output directory");
        std::fs::create_dir_all(out.join("screens")).expect("the output directory");
        std::fs::write(
            out.join("snapshots").join(format!("{view}.json")),
            serde_json::to_string_pretty(&snapshot.to_json()).expect("JSON"),
        )
        .expect("the snapshot is written");
        image
            .save(out.join("screens").join(format!("{view}.png")))
            .expect("the screenshot is written");
        if bound.is_some() {
            std::fs::write(
                out.join("bound.json"),
                serde_json::to_string_pretty(&deep_replica::bound_listing(&snapshot))
                    .expect("JSON"),
            )
            .expect("the bound values' listing is written");
        }
        if first {
            // The menu bar's count is an AppKit status item the offscreen window can't capture, so its title is written.
            let title = deep_app::menu_bar_line();
            std::fs::write(out.join("menu-bar.txt"), format!("{title}\n"))
                .expect("the menu bar's title is written");
        }
        phase("written");
        eprintln!("deep-replica phases: {}", phases.join(", "));
        println!(
            "replica {view}: {} nodes, {} canvas items, {}x{} screenshot",
            snapshot.flatten().len(),
            snapshot.items.len(),
            image.width(),
            image.height()
        );
        match click {
            Some(name) => click_and_watch(&mut cx, handle, &snapshot, &name, &out),
            None => 0,
        }
    }

    /// How long the click's frames are watched for what it said.
    const WATCH: Duration = Duration::from_secs(20);
    /// The wall time between two frames while the UI thread is free.
    const FRAME: Duration = Duration::from_millis(16);

    /// #1556: clicks the button named `name` through the window, a mouse down and up on the thread that draws, then
    /// draws a frame each `FRAME` of wall time, the clock advanced by it, writing each to `frames.jsonl` as
    /// `{"ms", "tree"}` until one shows what the click said: neither the button nor the line saying it's working.
    /// 0 once a frame does, 1 after `WATCH` without, 2 when the screen has no such button.
    fn click_and_watch(
        cx: &mut HeadlessAppContext,
        handle: AnyWindowHandle,
        screen: &Snapshot,
        name: &str,
        out: &Path,
    ) -> i32 {
        let button = |snapshot: &Snapshot| {
            snapshot
                .flatten()
                .into_iter()
                .find(|node| node.role == "button" && node.name.as_deref() == Some(name))
                .map(|node| node.bounds)
        };
        let Some([x, y, width, height]) = button(screen) else {
            eprintln!("deep-replica: the first screen has no {name:?} button to click");
            return 2;
        };
        let scale = screen.scale as f32;
        let position = point(
            px((x + width / 2) as f32 / scale),
            px((y + height / 2) as f32 / scale),
        );
        let mut frames = std::fs::File::create(out.join("frames.jsonl")).expect("frames.jsonl");
        let modifiers = Modifiers::default();
        let (left, click_count) = (MouseButton::Left, 1);
        let clicked = Instant::now();
        for event in [
            MouseMoveEvent {
                position,
                pressed_button: None,
                modifiers,
            }
            .to_platform_input(),
            MouseDownEvent {
                button: left,
                position,
                modifiers,
                click_count,
                first_mouse: false,
            }
            .to_platform_input(),
            MouseUpEvent {
                button: left,
                position,
                modifiers,
                click_count,
            }
            .to_platform_input(),
        ] {
            cx.update_window(handle, |_, window, cx| {
                window.dispatch_event(event, cx);
            })
            .expect("the window takes the click");
        }
        let mut drawn = clicked;
        loop {
            let snapshot = cx
                .update_window(handle, |_, window, cx| {
                    window.render_frame(cx);
                    from_observed(window)
                })
                .expect("the window draws");
            let ms = clicked.elapsed().as_millis();
            let line = serde_json::json!({ "ms": ms, "tree": snapshot.tree.to_json() });
            writeln!(frames, "{line}").expect("frames.jsonl is written");
            let working = snapshot
                .flatten()
                .iter()
                .any(|node| node.name.as_deref() == Some(deep_app::views::SETTING_UP));
            if !working && button(&snapshot).is_none() {
                return 0;
            }
            if clicked.elapsed() > WATCH {
                eprintln!("deep-replica: no frame showed what {name} said within {WATCH:?}");
                return 1;
            }
            std::thread::sleep(FRAME.saturating_sub(drawn.elapsed()));
            cx.advance_clock(drawn.elapsed());
            drawn = Instant::now();
            cx.run_until_parked();
        }
    }
}
