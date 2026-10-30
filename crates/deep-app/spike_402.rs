//! Issue #402, the spike: feed a cell grid from a busy terminal's changes, in the gpui-kit app.
//! A recorded busy terminal (600 full-screen repaints of 120 × 36 cells, as a program redrawing
//! at 60 a second writes them) goes through the cells module's emulator, and after each change
//! the app's window draws one frame of the grid, through the canvas's own shaper and atlas, on
//! GPUI's headless test platform. Each frame must show that change's screen; the time each
//! change takes, to the emulator and through the frame, is written to `$DEEP_402_OUT/record.json`
//! (a temp folder when unset) with this machine's fingerprint. Off macOS it is INCONCLUSIVE.

fn main() {
    #[cfg(target_os = "macos")]
    std::process::exit(spike::run());
    #[cfg(not(target_os = "macos"))]
    {
        println!("spike_402: INCONCLUSIVE; the app's headless renderer runs on macOS only");
        std::process::exit(1);
    }
}

#[cfg(target_os = "macos")]
mod spike {
    use std::path::PathBuf;
    use std::time::Instant;

    use deep_app::cells::{cells, Screen};
    use deep_canvas_cells::emulator::Terminal;
    use gpui_kit::test::TestWindowExt;
    use gpui_kit::{
        div, px, size, AppContext as _, Bounds, Context, IntoElement, ParentElement as _, Point,
        Render, TestAppContext, TestDispatcher, Window, WindowBounds, WindowOptions,
    };
    use serde_json::json;

    const COLS: u16 = 120;
    const ROWS: u16 = 36;
    const UPDATES: usize = 600;
    const FG: [u8; 3] = [0xe8, 0xe8, 0xe8];
    const BG: [u8; 3] = [0x10, 0x10, 0x10];

    struct Grid {
        screen: Option<Screen>,
    }

    impl Render for Grid {
        fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
            let mut root = div();
            if let Some(s) = self.screen.take() {
                root = root.child(cells("spike-grid", s));
            }
            root
        }
    }

    /// Row `r` of repaint `k`: a different line on every row of every frame, with a colored run.
    fn busy(k: usize) -> Vec<u8> {
        let mut s = String::from("\x1b[H");
        for r in 0..ROWS {
            if r > 0 {
                s.push_str("\r\n");
            }
            s.push_str(&format!(
                "F{k:05} R{r:02} \x1b[3{}m{:08x}\x1b[0m {}\x1b[K",
                (k + usize::from(r)) % 7 + 1,
                (k as u32).wrapping_mul(2_654_435_761) ^ u32::from(r),
                "busy terminal output ".repeat(4)
            ));
        }
        s.into_bytes()
    }

    fn sh(cmd: &str, args: &[&str]) -> String {
        std::process::Command::new(cmd)
            .args(args)
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap_or_default()
    }

    fn percentile(sorted: &[f64], p: f64) -> f64 {
        sorted[((sorted.len() as f64 - 1.) * p).round() as usize]
    }

    pub fn run() -> i32 {
        let out = std::env::var_os("DEEP_402_OUT")
            .map(PathBuf::from)
            .unwrap_or_else(|| {
                std::env::temp_dir().join(format!("deep-402-{}", std::process::id()))
            });
        std::fs::create_dir_all(&out).expect("the output folder");
        let mut cx = TestAppContext::build(TestDispatcher::new(0), None);
        cx.update(|cx| {
            gpui_kit::init(cx);
            deep_app::init(cx);
        });
        let (window, grid) = cx.update(|cx| {
            let mut view = None;
            let (w, _) = gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: size(px(1000.), px(600.)),
                    })),
                    ..Default::default()
                },
                cx,
                |_, cx| {
                    let v = cx.new(|_| Grid { screen: None });
                    view = Some(v.clone());
                    v
                },
            )
            .expect("a window");
            (w, view.expect("the grid view"))
        });
        let mut term = Terminal::new(COLS, ROWS, 0);
        let mut feed_ms = Vec::new();
        let mut frame_ms = Vec::new();
        let mut failures = Vec::new();
        for k in 0..UPDATES + 30 {
            let bytes = busy(k);
            let t0 = Instant::now();
            term.feed(&bytes);
            let rows = term.take_dirty();
            let screen = Screen::of(&term, k as u64 + 1, FG, BG);
            let t1 = Instant::now();
            let want: Vec<String> = screen.rows.iter().map(|r| r.text.clone()).collect();
            cx.update(|cx| grid.update(cx, |g, _| g.screen = Some(screen)));
            let drawn = cx
                .update_window(window, |_, window, cx| {
                    deep_app::canvas::clear_items();
                    window.render_frame(cx);
                    deep_app::canvas::items()
                })
                .expect("the window draws");
            let t2 = Instant::now();
            // The first 30 changes warm the atlas and are not counted.
            if k < 30 {
                continue;
            }
            feed_ms.push((t1 - t0).as_secs_f64() * 1000.);
            frame_ms.push((t2 - t1).as_secs_f64() * 1000.);
            let item = drawn
                .iter()
                .find(|(id, _)| id == "spike-grid")
                .map(|(_, v)| v.clone());
            let shown: Option<Vec<String>> = item
                .as_ref()
                .and_then(|v| serde_json::from_value(v["text"].clone()).ok());
            if rows != usize::from(ROWS) {
                failures.push(format!("change {k} patched {rows} rows, not {ROWS}"));
            }
            if shown.as_ref() != Some(&want) {
                failures.push(format!("frame {k} doesn't show change {k}'s screen"));
            }
            if item
                .as_ref()
                .and_then(|v| v["sprites"].as_u64())
                .unwrap_or(0)
                == 0
            {
                failures.push(format!("frame {k} painted no glyph"));
            }
        }
        let total: Vec<f64> = feed_ms.iter().zip(&frame_ms).map(|(a, b)| a + b).collect();
        let mut sorted = total.clone();
        sorted.sort_by(f64::total_cmp);
        let budget = 1000. / 60.;
        let mut feed_sorted = feed_ms.clone();
        feed_sorted.sort_by(f64::total_cmp);
        let emulator_p50 = percentile(&feed_sorted, 0.5);
        let fingerprint = json!({
            "model": sh("sysctl", &["-n", "hw.model"]),
            "chip": sh("sysctl", &["-n", "machdep.cpu.brand_string"]),
            "power": sh("pmset", &["-g", "batt"]).lines().next().unwrap_or("").to_string(),
            "load": sh("sysctl", &["-n", "vm.loadavg"]),
        });
        let record = json!({
            "spike": 402,
            "what": "a busy terminal's changes fed to the cell grid in the gpui-kit app: 600 full-screen repaints of 120 × 36 cells through the cells module's emulator, each drawn as one frame of the app's window on GPUI's headless test platform, after 30 not counted",
            "fingerprint": fingerprint,
            "updates": total.len(),
            "ms_per_update": {
                "p50": percentile(&sorted, 0.5),
                "p95": percentile(&sorted, 0.95),
                "max": sorted.last().copied().unwrap_or(0.),
                "emulator_p50": emulator_p50,
            },
            "budget_ms": budget,
            "keeps_up": failures.is_empty() && percentile(&sorted, 0.95) <= budget,
            "failures": failures.iter().take(5).collect::<Vec<_>>(),
        });
        let path = out.join("record.json");
        std::fs::write(
            &path,
            serde_json::to_string_pretty(&record).expect("JSON") + "\n",
        )
        .expect("the record");
        println!(
            "{}",
            serde_json::to_string(&record["ms_per_update"]).unwrap_or_default()
        );
        println!("record: {}", path.display());
        if !failures.is_empty() {
            for f in failures.iter().take(5) {
                println!("FAIL {f}");
            }
            println!("test spike_402 ... FAILED");
            return 1;
        }
        println!("test spike_402 ... ok");
        0
    }
}
