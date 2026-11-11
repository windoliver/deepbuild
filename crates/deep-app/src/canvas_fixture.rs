//! Issue #1485: `deep-app --canvas <scenario.json>` (tests/acceptance/1485/README.md), in no shipped build: the app's
//! canvas panel alone in the app's real window on this Mac's screen, not focused, with no hub and no record. From its
//! first frame it asks for a frame every vsync for the scenario's `run_ms`, and hands each revision to the panel as
//! `follow` hands the hub's (`present`, then a refresh) right after the first frame that starts at or after the
//! revision's `at_ms`. Every picture decode first keeps its thread busy for the scenario's `decode_ms`, the planted
//! decode, and `DEEP_CANVAS_PLANT=decodes_in_place` selects the merge base's decode on the UI thread, read only here.
//! It prints one line: each frame's start, the UI thread's CPU from it to the next frame's start and the pictures it
//! painted, and the frame each revision was handed over after.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::show::Presented;

/// The planted decode, ms.
static DECODE_MS: AtomicU64 = AtomicU64::new(0);

/// Whether `DEEP_CANVAS_PLANT` selects the merge base's decode on the UI thread.
pub(crate) fn in_place() -> bool {
    std::env::var("DEEP_CANVAS_PLANT").is_ok_and(|p| p == "decodes_in_place")
}

/// The planted decode: the thread decoding a picture stays busy for `decode_ms` first, spinning, never sleeping.
pub(crate) fn planted_decode() {
    let until = Instant::now() + Duration::from_millis(DECODE_MS.load(Ordering::Relaxed));
    while Instant::now() < until {
        std::hint::spin_loop();
    }
}

/// What a run draws: the evidence store, the window in points, the planted decode, how long it runs and each revision
/// with the time it's handed over from.
pub struct Scenario {
    evidence: PathBuf,
    window: [f32; 2],
    decode_ms: u64,
    run_ms: f64,
    revisions: Vec<(f64, Presented)>,
}

impl Scenario {
    pub fn read(path: &Path) -> Result<Scenario, String> {
        let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        let side = |i: usize| v["window"][i].as_f64().map(|n| n as f32);
        let revisions = (v["revisions"].as_array().into_iter().flatten())
            .map(|r| Some((r["at_ms"].as_f64()?, Presented::from_json(&r["presented"])?)))
            .collect::<Option<Vec<_>>>()
            .ok_or("each revision is {at_ms, presented}")?;
        Ok(Scenario {
            evidence: PathBuf::from(v["evidence"].as_str().ok_or("evidence is a folder")?),
            window: [side(0), side(1)]
                .map(|s| s.ok_or("window is [w, h]"))
                .into_iter()
                .collect::<Result<Vec<_>, _>>()?
                .try_into()
                .map_err(|_| "window is [w, h]")?,
            decode_ms: v["decode_ms"].as_u64().ok_or("decode_ms is ms")?,
            run_ms: v["run_ms"].as_f64().ok_or("run_ms is ms")?,
            revisions,
        })
    }
}

#[cfg(target_os = "macos")]
pub use live::run;

#[cfg(target_os = "macos")]
mod live {
    use std::collections::VecDeque;
    use std::sync::atomic::Ordering;
    use std::time::Instant;

    use gpui_kit::*;
    use objc2::msg_send;
    use objc2_app_kit::{NSView, NSWindowOcclusionState};
    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use serde_json::{json, Value};

    use super::{Scenario, DECODE_MS};
    use crate::show::{CanvasPanel, Presented};

    /// This thread's CPU time, in ms.
    fn thread_cpu_ms() -> f64 {
        // SAFETY: a zeroed timespec for clock_gettime to fill.
        let mut t: libc::timespec = unsafe { std::mem::zeroed() };
        unsafe { libc::clock_gettime(libc::CLOCK_THREAD_CPUTIME_ID, &mut t) };
        t.tv_sec as f64 * 1e3 + t.tv_nsec as f64 / 1e6
    }

    /// A run under way: the panel, the revisions not handed over yet, the first frame's start, the last frame's start
    /// and the UI thread's CPU then, and what it reports.
    struct Run {
        panel: Entity<CanvasPanel>,
        revisions: VecDeque<(f64, Presented)>,
        run_ms: f64,
        start: Instant,
        last: (f64, f64),
        frames: Vec<Value>,
        handed: Vec<Value>,
    }

    pub fn run(scenario: Scenario, cx: &mut App) {
        DECODE_MS.store(scenario.decode_ms, Ordering::Relaxed);
        let [w, h] = scenario.window;
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds {
                origin: point(px(120.), px(120.)), // size-literal-exception: a #1485 check fixture, in no shipped build; review 2027-05-10
                size: size(px(w), px(h)),
            })),
            kind: WindowKind::PopUp,
            // It never takes the keyboard or the pointer, so nothing but its own frames redraws it.
            focus: false,
            show: false,
            ..Default::default()
        };
        let Scenario {
            evidence,
            revisions,
            run_ms,
            ..
        } = scenario;
        open_window(options, cx, move |window, cx| {
            if let Some(native) = window_view(window).window() {
                native.setIgnoresMouseEvents(true);
                // SAFETY: GPUI makes a pop-up an NSPanel, which has this property.
                let _: () = unsafe { msg_send![&*native, setBecomesKeyOnlyIfNeeded: true] };
                native.orderFrontRegardless();
            }
            let panel = cx.new(|_| CanvasPanel::new(evidence));
            let run = Run {
                panel: panel.clone(),
                revisions: revisions.into(),
                run_ms,
                start: Instant::now(),
                last: (0.0, 0.0),
                frames: Vec::new(),
                handed: Vec::new(),
            };
            visible(window, 0, move |window, cx| {
                let run = Run {
                    start: Instant::now(),
                    last: (0.0, thread_cpu_ms()),
                    ..run
                };
                let _ = cx;
                next(window, run, 1);
            });
            panel
        })
        .expect("open the window");
    }

    fn window_view(window: &Window) -> &NSView {
        let handle = HasWindowHandle::window_handle(window).expect("the window's handle");
        let RawWindowHandle::AppKit(handle) = handle.as_raw() else {
            panic!("an AppKit window");
        };
        // SAFETY: gpui's AppKit handle wraps its NSView, alive while the gpui window is.
        unsafe { handle.ns_view.cast::<NSView>().as_ref() }
    }

    /// Runs `then` on the first frame after AppKit reports the window visible, or after 240 frames.
    fn visible(
        window: &mut Window,
        frames: u32,
        then: impl FnOnce(&mut Window, &mut App) + 'static,
    ) {
        window.refresh();
        window.on_next_frame(move |window, cx| {
            let shown = window_view(window)
                .window()
                .is_some_and(|w| w.occlusionState().contains(NSWindowOcclusionState::Visible));
            if shown || frames > 240 {
                then(window, cx);
            } else {
                visible(window, frames + 1, then);
            }
        });
    }

    /// Frame `k` starts: the revisions due are handed over after frame `k - 1`, whose record ends here, then the run
    /// asks for frame `k + 1`, or reports once `run_ms` has passed.
    fn next(window: &mut Window, mut run: Run, k: usize) {
        window.refresh();
        window.on_next_frame(move |window, cx| {
            let (at, cpu) = run.last;
            while run.revisions.front().is_some_and(|(due, _)| *due <= at) {
                let (_, p) = run.revisions.pop_front().expect("one is due");
                run.handed.push(json!({"rev": p.rev, "frame": k - 1}));
                run.panel.update(cx, |panel, cx| panel.present(p, cx));
                cx.refresh_windows();
            }
            let now = (run.start.elapsed().as_secs_f64() * 1e3, thread_cpu_ms());
            let painted = run.panel.read(cx).painted.clone();
            run.frames.push(json!({"frame": k - 1, "at_ms": at, "cpu_ms": now.1 - cpu, "pictures": painted}));
            run.last = now;
            if now.0 >= run.run_ms {
                let scale = window.scale_factor();
                println!(
                    "{}",
                    json!({"canvas": 1485, "scale": scale, "frames": run.frames, "handed": run.handed})
                );
                cx.quit();
            } else {
                next(window, run, k + 1);
            }
        });
    }
}
