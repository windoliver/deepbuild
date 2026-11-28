//! Issue #1485: `deep-app --canvas <scenario.json>` (tests/acceptance/1485/README.md), in no shipped build: the app's
//! canvas panel alone in the app's real window on this Mac's screen, not focused, with no hub and no record. From its
//! first frame it asks for a frame every vsync for the scenario's `run_ms`, and hands each revision to the panel as
//! `follow` hands the hub's (`present`, then a refresh) right after the first frame that starts at or after the
//! revision's `at_ms`. Every picture decode first keeps its thread busy for the scenario's `decode_ms`, the planted
//! decode, and `DEEP_CANVAS_PLANT=decodes_in_place` selects the merge base's decode on the UI thread, read only here.
//! It prints one line: each frame's start, the UI thread's CPU from it to the next frame's start and the pictures it
//! painted, and the frame each revision was handed over after.
//!
//! Issue #2494 (tests/acceptance/2494/README.md): each frame also gives the GPU-layer slots the panel painted in it
//! and the read-back buffers the app's device had made when it started. The first frame to start at or after each of
//! the scenario's `capture_ms` is captured under `out`: the window as the compositor received it, and each slot's own
//! bytes. `DEEP_CANVAS_PLANT=reads_every_frame_back` selects a view that reads every frame it draws back.

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

/// #2494: whether `DEEP_CANVAS_PLANT` selects the view that reads every frame it draws back.
#[cfg(target_os = "macos")]
pub(crate) fn reads_back() -> bool {
    std::env::var("DEEP_CANVAS_PLANT").is_ok_and(|p| p == "reads_every_frame_back")
}

#[cfg(target_os = "macos")]
fn planted(name: &str) -> bool {
    std::env::var("DEEP_CANVAS_PLANT").is_ok_and(|p| p == name)
}

#[cfg(target_os = "macos")]
pub(crate) fn keeps_own_clock() -> bool {
    planted("keeps_own_clock")
}

pub(crate) fn records_nothing() -> bool {
    std::env::var("DEEP_CANVAS_PLANT").is_ok_and(|p| p == "paints_reason_records_nothing")
}

#[cfg(target_os = "macos")]
pub(crate) fn draws_default_look() -> bool {
    planted("draws_in_default_look")
}

#[cfg(target_os = "macos")]
pub(crate) fn draws_first_camera() -> bool {
    planted("draws_at_first_camera")
}

#[cfg(target_os = "macos")]
fn documents(folder: &Path, into: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(folder).into_iter().flatten().flatten() {
        let path = entry.path();
        if path.is_dir() && entry.file_name() != "node_modules" {
            documents(&path, into);
        } else if path.extension().is_some_and(|e| e == "json") {
            into.push(path);
        }
    }
}

#[cfg(target_os = "macos")]
fn by_hash(folder: &Path) -> std::collections::BTreeMap<String, PathBuf> {
    use sha2::{Digest, Sha256};
    let mut held = Vec::new();
    documents(folder, &mut held);
    let hashed = |file: PathBuf| {
        let bytes = std::fs::read(&file).ok()?;
        Some((format!("{:x}", Sha256::digest(&bytes)), file))
    };
    held.into_iter().filter_map(hashed).collect()
}

#[cfg(target_os = "macos")]
pub fn count(tree: &Path) -> Value {
    let mut files = Vec::new();
    for folder in ["packs/examples", "tests/acceptance"] {
        documents(&tree.join(folder), &mut files);
    }
    files.sort();
    let mut counted = 0_u64;
    let mut refused = std::collections::BTreeMap::<String, Vec<String>>::new();
    let stores = std::cell::RefCell::new(std::collections::BTreeMap::new());
    for file in files {
        let read = std::fs::read(&file).ok();
        let Some(doc) = read.and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
            continue;
        };
        if !doc.is_object() || !deep_canvas_scene3d::scene::has_3d(&doc) {
            continue;
        }
        counted += 1;
        let path = file.strip_prefix(tree).unwrap_or(&file);
        let depth = if path.starts_with("tests") { 3 } else { 2 };
        let beside = tree.join(path.components().take(depth).collect::<PathBuf>());
        let asset = |sha: &str| {
            let mut stores = stores.borrow_mut();
            let store = (stores.entry(beside.clone())).or_insert_with(|| by_hash(&beside));
            std::fs::read(store.get(sha)?).ok()
        };
        if let Some(why) = crate::scene_view::undrawn(doc, &asset) {
            let listed = refused.entry(why.recorded).or_default();
            listed.push(path.to_string_lossy().into_owned());
        }
    }
    serde_json::json!({"counted": counted, "refused": refused})
}

/// The planted decode: the thread decoding a picture stays busy for `decode_ms` first, spinning, never sleeping.
pub(crate) fn planted_decode() {
    let until = Instant::now() + Duration::from_millis(DECODE_MS.load(Ordering::Relaxed));
    while Instant::now() < until {
        std::hint::spin_loop();
    }
}

/// What a run draws: the evidence store, the window in points, the planted decode, how long it runs, how often it reads
/// the app's footprint (#1431) and each revision with the time it's handed over from.
pub struct Scenario {
    evidence: PathBuf,
    window: [f32; 2],
    decode_ms: u64,
    run_ms: f64,
    read_every_ms: Option<f64>,
    revisions: Vec<(f64, Presented)>,
    /// #2494: the times frames are captured from, and the folder their files go under.
    capture_ms: Vec<f64>,
    out: PathBuf,
    replies: Vec<(f64, Value)>,
    follow: bool,
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
            read_every_ms: match &v["read_every_ms"] {
                Value::Null => None,
                every => Some(
                    every
                        .as_f64()
                        .filter(|ms| *ms > 0.0)
                        .ok_or("read_every_ms is ms")?,
                ),
            },
            revisions,
            capture_ms: (v["capture_ms"].as_array().into_iter().flatten())
                .filter_map(Value::as_f64)
                .collect(),
            out: PathBuf::from(v["out"].as_str().unwrap_or_default()),
            replies: (v["replies"].as_array().into_iter().flatten())
                .map(|r| Some((r["at_ms"].as_f64()?, r["reply"].clone())))
                .collect::<Option<Vec<_>>>()
                .ok_or("each reply is {at_ms, reply}")?,
            follow: v["follow"].as_bool().unwrap_or(false),
        })
    }
}

#[cfg(target_os = "macos")]
pub use live::run;

#[cfg(target_os = "macos")]
mod live {
    use std::collections::VecDeque;
    use std::path::PathBuf;
    use std::sync::atomic::Ordering;
    use std::time::Instant;

    use gpui_apple::metal_renderer::layer_colorspace;
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
    /// with the UI thread's CPU and the device's read-back buffers then, and what it reports. #2494: the capture
    /// times not reached yet, the folder captures go under, and whether the last frame is being captured.
    struct Run {
        panel: Entity<CanvasPanel>,
        revisions: VecDeque<(f64, Presented)>,
        run_ms: f64,
        start: Instant,
        last: (f64, f64, u64),
        frames: Vec<Value>,
        handed: Vec<Value>,
        /// #1431: how often the app's footprint is read, when the next reading is due, and the readings.
        read_every: Option<f64>,
        read_next: f64,
        readings: Vec<Value>,
        captures: VecDeque<f64>,
        out: PathBuf,
        capturing: bool,
        replies: VecDeque<(f64, Value)>,
    }

    impl Run {
        /// #2494: the frame starting at `at` is captured when it is the first to start at or after a capture time:
        /// its drawable is read back as the window draws it.
        fn arm(&mut self, at: f64) {
            while self.captures.front().is_some_and(|due| *due <= at) {
                self.captures.pop_front();
                self.capturing = true;
            }
            if self.capturing {
                layer_colorspace::read_next_frame();
            }
        }
    }

    /// RGBA pixels written as a PNG: its path.
    fn png(file: PathBuf, rgba: Vec<u8>, [w, h]: [u32; 2]) -> Option<String> {
        image::RgbaImage::from_raw(w, h, rgba)?.save(&file).ok()?;
        Some(file.display().to_string())
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
            capture_ms,
            out,
            read_every_ms,
            replies,
            follow,
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
            if follow {
                crate::show::follow(panel.clone(), cx);
            }
            let run = Run {
                panel: panel.clone(),
                revisions: revisions.into(),
                run_ms,
                start: Instant::now(),
                last: (0.0, 0.0, 0),
                frames: Vec::new(),
                handed: Vec::new(),
                captures: capture_ms.into(),
                out,
                capturing: false,
                replies: replies.into(),
                read_every: read_every_ms,
                read_next: 0.0,
                readings: Vec::new(),
            };
            visible(window, 0, move |window, cx| {
                let mut run = Run {
                    start: Instant::now(),
                    last: (0.0, thread_cpu_ms(), crate::scene_view::readback_buffers()),
                    ..run
                };
                run.arm(0.0);
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
            let (at, cpu, readbacks) = run.last;
            while run.revisions.front().is_some_and(|(due, _)| *due <= at) {
                let (_, p) = run.revisions.pop_front().expect("one is due");
                run.handed.push(json!({"rev": p.rev, "frame": k - 1}));
                run.panel.update(cx, |panel, cx| panel.present(p, cx));
                cx.refresh_windows();
            }
            while run.replies.front().is_some_and(|(due, _)| *due <= at) {
                let (_, reply) = run.replies.pop_front().expect("one is due");
                run.panel.update(cx, |panel, _| panel.took(&reply));
                cx.refresh_windows();
            }
            let now = (
                run.start.elapsed().as_secs_f64() * 1e3,
                thread_cpu_ms(),
                crate::scene_view::readback_buffers(),
            );
            let captured = std::mem::take(&mut run.capturing);
            let panel = run.panel.read(cx);
            let (painted, held) = (panel.painted.clone(), panel.held());
            let reasons: Vec<Value> = (panel.reasons.iter())
                .map(|(layer, reason)| json!({"layer": layer, "reason": reason}))
                .collect();
            // #2494: the slots frame `k - 1` painted; captured, each with its own bytes, and the window's drawable.
            let slots: Vec<Value> = (panel.slots().into_iter())
                .map(|(layer, frame, view)| {
                    let t = view.borrow().time_of(frame);
                    let mut slot = json!({"layer": layer, "frame_seq": frame, "path": crate::scene_view::PATH.name(), "t": t});
                    let pixels = captured.then(|| view.borrow().read(frame)).flatten();
                    let file = pixels.and_then(|(mut bgra, size)| {
                        for p in bgra.as_chunks_mut::<4>().0 {
                            p.swap(0, 2);
                        }
                        png(run.out.join(format!("slot-{}-{layer}.png", k - 1)), bgra, size)
                    });
                    if let Some(file) = file {
                        slot["pixels"] = json!(file);
                    }
                    slot
                })
                .collect();
            let mut frame = json!({"frame": k - 1, "at_ms": at, "cpu_ms": now.1 - cpu, "pictures": painted,
                                   "held": held, "slots": slots, "readback_buffers": readbacks, "reasons": reasons});
            let window_file = run.out.join(format!("window-{}.png", k - 1));
            let drawable = captured.then(layer_colorspace::take_frame).flatten();
            if drawable.is_some_and(|image| image.save(&window_file).is_ok()) {
                frame["capture"] = json!(window_file.display().to_string());
            }
            run.frames.push(frame);
            run.last = now;
            // #1431: the app's footprint after the first frame starting at or after each whole `read_every_ms`.
            if let Some(every) = run.read_every.filter(|_| at >= run.read_next) {
                let reading = crate::footprint::read(window);
                run.readings.push(json!({"at_ms": at, "frame": k - 1, "reading": reading}));
                run.read_next = ((at / every).floor() + 1.0) * every;
            }
            if now.0 >= run.run_ms {
                let scale = window.scale_factor();
                let mut report = json!({"canvas": 1485, "scale": scale, "frames": run.frames, "handed": run.handed});
                if run.read_every.is_some() {
                    report["readings"] = Value::Array(run.readings);
                }
                println!("{report}");
                cx.quit();
            } else {
                run.arm(now.0);
                next(window, run, k + 1);
            }
        });
    }
}
