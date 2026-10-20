//! Issue #337: every screen rendered to real pixels with GPUI's offscreen Metal renderer, and
//! clicked, with no display. AppKit needs the main thread, so this target runs without the
//! libtest harness (as gpui-kit's own `rendering` suite does) and prints libtest's result lines.
//!
//! `DEEP_APP_WRITE_SCREENS=1` also saves each screen to `docs/spikes/337/screens/<name>.png`.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(screens::run());
    #[cfg(not(target_os = "macos"))]
    println!("screens: skipped; the spike renders pixels on macOS only");
}

#[cfg(target_os = "macos")]
mod screens {
    use std::{path::Path, sync::Arc};

    use deep_app::Spike;
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        assets::Assets, px, size, AnyWindowHandle, AppContext as _, Bounds, ElementId,
        HeadlessAppContext, Point, WindowBounds, WindowOptions,
    };

    fn context() -> HeadlessAppContext {
        let mut cx = HeadlessAppContext::with_platform(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(Assets),
            gpui_kit::platform::current_headless_renderer,
        );
        cx.update(|cx| {
            gpui_kit::init(cx);
            deep_app::init(cx);
        });
        cx
    }

    fn open(cx: &mut HeadlessAppContext, agent: Option<&str>) -> AnyWindowHandle {
        let runtime = gpui_shell::components::new_isolated_runtime().expect("panel runtime");
        let dir = agent.map(|agent| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("panels")
                .join(agent)
        });
        let (handle, _) = cx
            .update(|cx| {
                gpui_kit::open_window(
                    WindowOptions {
                        window_bounds: Some(WindowBounds::Windowed(Bounds {
                            origin: Point::default(),
                            size: size(px(960.), px(640.)),
                        })),
                        focus: false,
                        show: false,
                        ..Default::default()
                    },
                    cx,
                    |window, cx| {
                        let panel = dir.as_ref().map(|dir| {
                            let view = deep_app::mount_panel(&runtime, dir, window, cx)
                                .unwrap_or_else(|error| panic!("panel failed to load: {error:#}"));
                            (dir.display().to_string(), view)
                        });
                        cx.new(|_| Spike::new(panel))
                    },
                )
            })
            .expect("open window");
        cx.update_window(handle, |_, window, cx| window.render_frame(cx))
            .unwrap();
        handle
    }

    fn click(cx: &mut HeadlessAppContext, handle: AnyWindowHandle, id: impl Into<ElementId>) {
        let id = id.into();
        cx.update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            window.click(id, cx);
            window.render_frame(cx);
        })
        .unwrap();
        cx.run_until_parked();
    }

    fn shot(cx: &mut HeadlessAppContext, handle: AnyWindowHandle, name: &str) -> Vec<u8> {
        let image = cx
            .capture_screenshot(handle)
            .expect("offscreen rendering must be available");
        let (width, height) = image.dimensions();
        assert!(
            width >= 960 && height >= 640,
            "{name}: a {width}x{height} capture"
        );
        let raw = image.clone().into_raw();
        let first = &raw[..4];
        assert!(
            raw.chunks(4).any(|pixel| pixel != first),
            "{name}: the capture is one flat color"
        );
        if std::env::var_os("DEEP_APP_WRITE_SCREENS").is_some() {
            let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs/spikes/337/screens");
            std::fs::create_dir_all(&dir).unwrap();
            image.save(dir.join(format!("{name}.png"))).unwrap();
        }
        raw
    }

    fn window_screen() {
        let mut cx = context();
        let handle = open(&mut cx, None);
        let before = shot(&mut cx, handle, "window");
        click(&mut cx, handle, ("session", 3usize));
        let after = cx.capture_screenshot(handle).unwrap().into_raw();
        assert!(before != after, "selecting a session changed no pixels");
    }

    fn panel_screen(agent: &str) {
        let mut cx = context();
        let handle = open(&mut cx, Some(agent));
        let before = shot(&mut cx, handle, agent);
        click(&mut cx, handle, "next");
        click(&mut cx, handle, "row-NVDA");
        let after = cx.capture_screenshot(handle).unwrap().into_raw();
        assert!(
            before != after,
            "{agent}: clicking the panel changed no pixels"
        );
    }

    pub fn run() -> i32 {
        let cases: [(&str, fn()); 3] = [
            ("window_screen", window_screen),
            ("claude_code_panel_screen", || panel_screen("claude-code")),
            ("codex_panel_screen", || panel_screen("codex")),
        ];
        println!("\nrunning {} tests", cases.len());
        let mut failed = 0;
        for (name, case) in cases {
            let ok = std::panic::catch_unwind(case).is_ok();
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
}
