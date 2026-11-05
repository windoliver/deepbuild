//! #995's criterion: presenting 1,000 revisions, each with a new 1 MB picture, into one panel leaves the app's memory
//! within 20 MB of its level after the first 10, and only the shown pictures held; the merge base grows by about 1 GB
//! and fails, naming the panel. Scope: the panel frees the rest "from memory and the GPU".
//!
//! A test binary of its own, so the process's memory is the panel's. The panel is the app's `CanvasPanel` on an
//! evidence store of the test's own, in a GPUI window on the headless renderer (the app's context, as `deep-replica`
//! builds it), at scale 1. A second document is presented once, at the start, in a rect of its own; then 1,000
//! revisions of the first, each with a picture no revision before it had. As in the app, each presented revision is
//! drawn and the frame presented (`present_frame`), so the renderer takes its uploads. Read back from the window
//! after revision 1 and revision 1,000: the first rect shows the newest revision's picture and the second still shows
//! its one picture. The process's memory is read after revision 10 and after revision 1,000, when none of the test's
//! own buffers is alive: on Linux what it holds resident plus what was swapped out of it (`VmRSS` + `VmSwap`), on
//! macOS its footprint (`phys_footprint`), which counts the GPU's textures for the process.
//!
//! Each picture is a 512 × 512 RGBA PNG, 1 MB decoded (1,048,576 bytes, the panel's BGRA frame), one color of its own
//! with its number in its first row, so no two are alike. It is kept as `picture()` in `crates/deep-app/src/show.rs`
//! reads it, `<evidence>/<sha[..2]>/<sha[2..]>`, the SHA-256 of the PNG's bytes in hex; one flat color compresses
//! well, so the files stay small on disk.
//!
//! Two verdicts from the one run: the criterion's memory and shown pictures (judged wherever the window draws), and
//! the GPU's copies (judged on macOS only, where the GPU's memory is the process's; INCONCLUSIVE elsewhere, never a
//! pass). Wired into deep-app by a `[[test]]` entry (`acceptance_995`, no harness: AppKit wants the main thread);
//! run with `cargo test --locked -p deep-app --test acceptance_995`, and `-- <name>` judges only the verdicts whose
//! names contain it.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use deep_app::show::{CanvasPanel, Presented};
use gpui_kit::{
    assets::Assets, px, size, AnyWindowHandle, AppContext as _, Bounds, HeadlessAppContext, Point,
    WindowBounds, WindowOptions,
};
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{ExtendedColorType, ImageEncoder};
use serde_json::json;
use sha2::{Digest, Sha256};

const MEMORY: &str =
    "presenting_1000_revisions_with_new_1_mb_pictures_keeps_memory_within_20_mb_and_only_the_shown_pictures_held";
const GPU: &str =
    "presenting_1000_revisions_frees_the_gpus_copies_of_pictures_no_shown_revision_uses";

/// The issue's count, the level it measures from and its allowance (20 MB as 20,000,000 bytes).
const REVISIONS: u64 = 1_000;
const FIRST: u64 = 10;
const ALLOWANCE_BYTES: u64 = 20_000_000;
/// A picture's side in px: 512 × 512 × 4 bytes is 1 MB decoded.
const SIDE: u32 = 512;
/// The two rects, side by side, and the window around them.
const SHOWN: [f32; 4] = [0., 0., 512., 512.];
const PINNED: [f32; 4] = [560., 0., 512., 512.];
const WINDOW: (f32, f32) = (1100., 560.);
/// How far a read-back channel may be from the picture's.
const TOLERANCE: i32 = 6;

fn main() {
    let filters: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .collect();
    let chosen: Vec<&str> = [MEMORY, GPU]
        .into_iter()
        .filter(|name| filters.is_empty() || filters.iter().any(|f| name.contains(f.as_str())))
        .collect();
    println!("\nrunning {} tests", chosen.len());
    let run = if chosen.is_empty() {
        Err(String::new())
    } else {
        run()
    };
    let mut failed = 0;
    for name in &chosen {
        let verdict = run
            .as_ref()
            .map_err(String::clone)
            .and_then(|r| judge(name, r));
        match verdict {
            Ok(()) => println!("test {name} ... ok"),
            Err(message) => {
                failed += 1;
                println!("test {name} ... FAILED\n\n---- {name} ----\n{message}\n");
            }
        }
    }
    let word = if failed == 0 { "ok" } else { "FAILED" };
    println!(
        "test result: {word}. {} passed; {failed} failed\n",
        chosen.len() - failed
    );
    std::process::exit(failed.min(1) as i32);
}

/// What one run found: the memory at revision 10 and 1,000, and what the window drew wrong.
struct Run {
    first: u64,
    last: u64,
    wrong: Vec<String>,
}

fn judge(name: &str, r: &Run) -> Result<(), String> {
    let growth = r.last.saturating_sub(r.first);
    let held = format!(
        "the canvas panel held {} MB more after 1,000 revisions than after the first 10 ({} MB at revision 10, {} MB \
         at revision 1,000), past the 20 MB allowed: it keeps pictures no shown revision uses",
        mb(growth),
        mb(r.first),
        mb(r.last),
    );
    if name == MEMORY {
        let mut wrong = r.wrong.clone();
        if growth > ALLOWANCE_BYTES {
            wrong.push(format!("FAIL: {held}"));
        }
        return if wrong.is_empty() {
            Ok(())
        } else {
            Err(wrong.join("\n"))
        };
    }
    if !cfg!(target_os = "macos") {
        return Err(format!(
            "INCONCLUSIVE: off macOS the GPU's memory needn't be the process's (it grew {} MB here), so whether the \
             panel frees the GPU's copies is judged on macOS, where the footprint counts them",
            mb(growth)
        ));
    }
    if growth > ALLOWANCE_BYTES {
        Err(format!("FAIL: counting the GPU's textures, {held}"))
    } else {
        Ok(())
    }
}

/// Where a setup step that should work doesn't: BLOCKED on macOS, where it must; INCONCLUSIVE elsewhere.
fn unavailable(what: &str) -> String {
    if cfg!(target_os = "macos") {
        format!("BLOCKED: {what}")
    } else {
        format!("INCONCLUSIVE: {what}; the reference Macs draw the panel, so nothing was judged")
    }
}

fn run() -> Result<Run, String> {
    let evidence = Evidence::new("da995");
    let mut cx = HeadlessAppContext::with_platform(
        gpui_kit::platform::current_platform(true).text_system(),
        Arc::new(Assets),
        gpui_kit::platform::current_headless_renderer,
    );
    cx.update(|cx| {
        gpui_kit::init(cx);
        deep_app::init(cx);
    });
    let panel = CanvasPanel::new(evidence.dir.clone());
    let (handle, entity) = cx
        .update(|cx| {
            gpui_kit::open_window(
                WindowOptions {
                    window_bounds: Some(WindowBounds::Windowed(Bounds {
                        origin: Point::default(),
                        size: size(px(WINDOW.0), px(WINDOW.1)),
                    })),
                    focus: false,
                    show: false,
                    ..Default::default()
                },
                cx,
                |_, cx| cx.new(|_| panel),
            )
        })
        .map_err(|e| unavailable(&format!("no window ({e})")))?;
    cx.simulate_scale_factor_change(handle, 1.);

    // One revision presented, drawn and the frame presented, as the app does with each the hub gives it.
    let present = |cx: &mut HeadlessAppContext, doc: &str, rev: u64, rect: [f32; 4], n: u64| {
        let p = revision(doc, rev, rect, &write(&evidence.dir, n));
        cx.update(|cx| {
            entity.update(cx, |panel, cx| {
                panel.present(p);
                cx.notify();
            })
        });
        cx.present_frame(handle);
    };
    let memory = || {
        memory()
            .ok_or_else(|| "INCONCLUSIVE: this platform's process memory can't be read".to_string())
    };

    let mut wrong = Vec::new();
    present(&mut cx, "pinned", 1, PINNED, 0);
    let mut first = 0;
    for rev in 1..=REVISIONS {
        present(&mut cx, "fig", rev, SHOWN, rev);
        if rev == 1 {
            shows(&mut cx, handle, rev, &mut wrong)?;
            if !wrong.is_empty() {
                return Err(wrong.join("\n"));
            }
        }
        if rev == FIRST || rev % 100 == 0 {
            let now = memory()?;
            println!("revision {rev}: {} MB", mb(now));
            if rev == FIRST {
                first = now;
            }
        }
    }
    let last = memory()?;
    shows(&mut cx, handle, REVISIONS, &mut wrong)?;
    Ok(Run { first, last, wrong })
}

/// After revision `rev` of the first document: each rect shows its newest picture.
fn shows(
    cx: &mut HeadlessAppContext,
    handle: AnyWindowHandle,
    rev: u64,
    wrong: &mut Vec<String>,
) -> Result<(), String> {
    let shot = cx
        .capture_screenshot(handle)
        .map_err(|e| unavailable(&format!("the window can't be read back ({e})")))?;
    let scale = shot.width() as f32 / WINDOW.0;
    let center = |rect: [f32; 4]| {
        let x = ((rect[0] + rect[2] / 2.) * scale) as u32;
        let y = ((rect[1] + rect[3] / 2.) * scale) as u32;
        let p = shot.get_pixel(x, y).0;
        [p[0], p[1], p[2]]
    };
    let near = |a: [u8; 3], b: [u8; 3]| {
        a.iter()
            .zip(b)
            .all(|(a, b)| (*a as i32 - b as i32).abs() <= TOLERANCE)
    };
    let shown = center(SHOWN);
    if !near(shown, color(rev)) {
        wrong.push(format!(
            "FAIL: after revision {rev}, the canvas panel drew {shown:?} where it shows revision {rev}'s picture, {:?}",
            color(rev)
        ));
    }
    let pinned = center(PINNED);
    if !near(pinned, color(0)) {
        wrong.push(format!(
            "FAIL: after revision {rev}, the canvas panel drew {pinned:?} where the other document's shown picture is, \
             {:?}: it dropped a picture a shown revision uses",
            color(0)
        ));
    }
    Ok(())
}

// ---- The pictures, in an evidence store of the test's own.

/// A folder under the temp dir, removed when dropped.
struct Evidence {
    dir: PathBuf,
}

impl Evidence {
    fn new(name: &str) -> Evidence {
        let dir = std::env::temp_dir().join(format!("{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("BLOCKED: the evidence folder can't be made");
        Evidence { dir }
    }
}

impl Drop for Evidence {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// Picture `n`'s fill color, RGB; consecutive numbers differ in every channel.
fn color(n: u64) -> [u8; 3] {
    [
        (40 + n * 53 % 176) as u8,
        (40 + n * 97 % 176) as u8,
        (40 + n * 29 % 176) as u8,
    ]
}

/// Writes picture `n` into the evidence store and returns its hash.
fn write(evidence: &Path, n: u64) -> String {
    let [r, g, b] = color(n);
    let mut raw = vec![0u8; (SIDE * SIDE * 4) as usize];
    for px in raw.chunks_exact_mut(4) {
        px.copy_from_slice(&[r, g, b, 255]);
    }
    // Its number in the first row's first pixels, so pictures whose colors repeat still differ.
    for (i, byte) in n.to_le_bytes().iter().enumerate() {
        raw[i * 4] = *byte;
    }
    let mut png = Vec::new();
    PngEncoder::new_with_quality(&mut png, CompressionType::Fast, FilterType::NoFilter)
        .write_image(&raw, SIDE, SIDE, ExtendedColorType::Rgba8)
        .expect("BLOCKED: a picture can't be encoded");
    let sha: String = Sha256::digest(&png)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let dir = evidence.join(&sha[..2]);
    std::fs::create_dir_all(&dir).expect("BLOCKED: the evidence store can't be written");
    std::fs::write(dir.join(&sha[2..]), &png)
        .expect("BLOCKED: the evidence store can't be written");
    sha
}

/// One revision as the hub presents it (`canvas.drawn`): one layer, an agent's, with its picture.
fn revision(doc: &str, rev: u64, rect: [f32; 4], picture: &str) -> Presented {
    let v = json!({
        "doc": doc,
        "rev": rev,
        "rect": rect,
        "layers": [{
            "layer": "plot",
            "owner": {"session": "s-995"},
            "band": "agent",
            "outline": false,
            "items": ["figure"],
            "picture": picture,
        }],
    });
    Presented::from_json(&v).expect("BLOCKED: the hub's presented revision doesn't parse")
}

// ---- The process's memory.

/// In bytes: on Linux what it holds resident plus what the kernel swapped out of it (`VmRSS` + `VmSwap`, so a busy
/// machine paging it out doesn't hide growth); on macOS its footprint (`phys_footprint`, which counts what the GPU
/// holds for the process, since the GPU's memory is the Mac's). `None` where neither can be read.
fn memory() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        let status = std::fs::read_to_string("/proc/self/status").ok()?;
        let kb = |key: &str| -> Option<u64> {
            let line = status.lines().find(|l| l.starts_with(key))?;
            line.split_whitespace().nth(1)?.parse().ok()
        };
        Some((kb("VmRSS:")? + kb("VmSwap:").unwrap_or(0)) * 1024)
    }
    #[cfg(target_os = "macos")]
    {
        mac::phys_footprint()
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        None
    }
}

#[cfg(target_os = "macos")]
mod mac {
    /// `task_vm_info` (mach/task_info.h) up to `phys_footprint`, which revision 1 added.
    #[repr(C)]
    #[derive(Default)]
    struct TaskVmInfo {
        virtual_size: u64,
        region_count: i32,
        page_size: i32,
        resident_size: u64,
        resident_size_peak: u64,
        device: u64,
        device_peak: u64,
        internal: u64,
        internal_peak: u64,
        external: u64,
        external_peak: u64,
        reusable: u64,
        reusable_peak: u64,
        purgeable_volatile_pmap: u64,
        purgeable_volatile_resident: u64,
        purgeable_volatile_virtual: u64,
        compressed: u64,
        compressed_peak: u64,
        compressed_lifetime: u64,
        phys_footprint: u64,
    }

    const TASK_VM_INFO: i32 = 22;

    extern "C" {
        static mach_task_self_: u32;
        fn task_info(task: u32, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
    }

    pub fn phys_footprint() -> Option<u64> {
        let mut info = TaskVmInfo::default();
        let mut count = (std::mem::size_of::<TaskVmInfo>() / 4) as u32;
        // SAFETY: a buffer laid out as the kernel's task_vm_info, its length in natural_t units.
        let kr = unsafe {
            task_info(
                mach_task_self_,
                TASK_VM_INFO,
                &mut info as *mut TaskVmInfo as *mut i32,
                &mut count,
            )
        };
        (kr == 0).then_some(info.phys_footprint)
    }
}

fn mb(bytes: u64) -> String {
    format!("{:.1}", bytes as f64 / 1e6)
}
