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

    /// Issue #79: with no panel, the right pane is the welcome screen, Paper with the lockup in
    /// Ink, and the title bar holds the mark in Ink. Read from the pixels, within 8 per channel.
    fn welcome_screen() {
        let mut cx = context();
        let handle = open(&mut cx, None);
        let raw = shot(&mut cx, handle, "welcome");
        let (width, height) = cx.capture_screenshot(handle).unwrap().dimensions();
        let scale = width as f32 / 960.;
        let near = |pixel: &[u8], rgb: u32| {
            let [r, g, b] = [rgb >> 16 & 255, rgb >> 8 & 255, rgb & 255];
            pixel[0].abs_diff(r as u8) <= 8
                && pixel[1].abs_diff(g as u8) <= 8
                && pixel[2].abs_diff(b as u8) <= 8
        };
        let pixel = |x: u32, y: u32| &raw[((y * width + x) * 4) as usize..][..4];
        let right_pane =
            (0..height).flat_map(|y| (((260. * scale) as u32)..width).map(move |x| (x, y)));
        let (mut paper, mut ink) = (0usize, 0usize);
        for (x, y) in right_pane {
            if y < (34. * scale) as u32 {
                continue;
            }
            let pixel = pixel(x, y);
            paper += usize::from(near(pixel, deep_app::brand::PAPER));
            ink += usize::from(near(pixel, deep_app::brand::INK));
        }
        assert!(
            paper > 1_000,
            "the welcome screen is not on Paper: {paper} Paper pixels"
        );
        // The lockup alone is about 351 by 199 px at 1x and mostly Ink; the tagline is under 2,000.
        let lockup_ink = (6_000. * scale * scale) as usize;
        assert!(
            ink > lockup_ink,
            "the welcome screen shows no Ink lockup: {ink} Ink pixels, under {lockup_ink}"
        );
        let bar_ink = (0..(34. * scale) as u32)
            .flat_map(|y| (0..((260. * scale) as u32)).map(move |x| (x, y)))
            .filter(|&(x, y)| near(pixel(x, y), deep_app::brand::INK))
            .count();
        assert!(
            bar_ink > 10,
            "the title bar shows no Ink mark: {bar_ink} Ink pixels"
        );
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
        let cases: [(&str, fn()); 4] = [
            ("window_screen", window_screen),
            ("welcome_screen", welcome_screen),
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
