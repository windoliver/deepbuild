//! #995, the blind redraft: the canvas panel drops pictures no shown revision uses.
//!
//! The issue's one criterion: presenting 1,000 revisions, each with a new 1 MB picture, into one panel leaves the
//! app's memory within 20 MB of its level after the first 10, and only the shown pictures held. Its Scope: after each
//! presented revision the panel keeps only the pictures a shown revision uses, and frees the rest from memory and the
//! GPU.
//!
//! One run gives every verdict. The app's `CanvasPanel` sits in a window opened as the app opens one, on GPUI's
//! headless renderer. A second document is presented once, in a rect of its own; then 1,000 revisions of one
//! document, each with a new picture, each handed to `present`, decoded, drawn and its frame presented, as the app
//! does at a display's frame. The process's memory is read after revision 10 and after revision 1,000, and what the
//! panel holds is read off the window's pixels. A test binary of its own, so the process's memory is the one panel's.
//!
//! Wired into deep-app by the `[[test]] acceptance_995` entry (`harness = false`: AppKit needs the main thread); run
//! with `cargo test -p deep-app --test acceptance_995`. README.md beside this file says what each verdict means.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use deep_app::show::{CanvasPanel, Presented};
use gpui_kit::{
    assets::Assets, px, size, AnyWindowHandle, AppContext as _, Bounds, Entity, HeadlessAppContext,
    Point, WindowBounds, WindowOptions,
};
use serde_json::json;
use sha2::{Digest, Sha256};

/// The issue's numbers.
const REVISIONS: u32 = 1_000;
const FIRST: u32 = 10;
const BUDGET_BYTES: u64 = 20_000_000;
/// A picture: 512 × 512 RGBA, 1,048,576 bytes decoded, and a PNG of no less than 1 MB.
const SIDE: u32 = 512;
const PICTURE_BYTES: u64 = 1_000_000;
/// The picture's middle is one color, this many pixels a side; the rest is noise, so the PNG is 1 MB too.
const BLOCK: u32 = 128;
/// The redrawn document's panel and the other document's, in points, and the window that holds both.
const REDRAWN: [f32; 4] = [0., 0., 512., 512.];
const OTHER: [f32; 4] = [512., 0., 512., 512.];
const WINDOW: (f32, f32) = (1024., 640.);
/// The other document's picture: a number no revision of the redrawn document uses, of a color that is no ground's.
const OTHER_PICTURE: u32 = 1_010;
/// How far a drawn color may be from its picture's, per channel.
const TOLERANCE: i32 = 6;

/// The color of picture `n`'s middle: no two of pictures 0 to 1,023 share one, and neighbors are far apart.
fn color(n: u32) -> [u8; 3] {
    [
        (n * 97 % 256) as u8,
        (n / 4 % 256) as u8,
        (n * 31 % 256) as u8,
    ]
}

fn near(a: [u8; 3], b: [u8; 3]) -> bool {
    (0..3).all(|i| (i32::from(a[i]) - i32::from(b[i])).abs() <= TOLERANCE)
}

/// Picture `n` as a PNG: noise seeded by `n`, opaque, with its color in the middle.
fn png(n: u32) -> Result<Vec<u8>, String> {
    let mut state = 0x9E37_79B9_7F4A_7C15u64 ^ (u64::from(n) + 1).wrapping_mul(0xD1B5_4A32_D192_ED03);
    let mut pixels = Vec::with_capacity((SIDE * SIDE * 4) as usize);
    let middle = (SIDE - BLOCK) / 2..(SIDE + BLOCK) / 2;
    let [r, g, b] = color(n);
    for y in 0..SIDE {
        for x in 0..SIDE {
            if middle.contains(&x) && middle.contains(&y) {
                pixels.extend_from_slice(&[r, g, b, 255]);
            } else {
                state ^= state << 13;
                state ^= state >> 7;
                state ^= state << 17;
                let noise = state.to_le_bytes();
                pixels.extend_from_slice(&[noise[0], noise[1], noise[2], 255]);
            }
        }
    }
    let picture = image::RgbaImage::from_raw(SIDE, SIDE, pixels).expect("512 × 512 RGBA");
    let mut bytes = Vec::new();
    picture
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .map_err(|e| format!("BLOCKED: picture {n} couldn't be encoded as a PNG ({e})"))?;
    if (bytes.len() as u64) < PICTURE_BYTES {
        return Err(format!(
            "BLOCKED: picture {n}'s PNG is {} bytes, under the issue's 1 MB",
            bytes.len()
        ));
    }
    Ok(bytes)
}

/// The evidence store the panel reads its pictures from, by hash: `<dir>/<sha[..2]>/<sha[2..]>`. Removed on drop.
struct Evidence {
    dir: PathBuf,
}

impl Drop for Evidence {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

impl Evidence {
    fn new() -> Result<Evidence, String> {
        let dir = std::env::temp_dir().join(format!("da995-redraft-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)
            .map_err(|e| format!("BLOCKED: no evidence store under the temp directory ({e})"))?;
        Ok(Evidence { dir })
    }

    fn file(&self, sha: &str) -> PathBuf {
        self.dir.join(&sha[..2]).join(&sha[2..])
    }

    /// Stores picture `n` and answers its hash.
    fn store(&self, n: u32) -> Result<String, String> {
        let bytes = png(n)?;
        let sha: String = Sha256::digest(&bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect();
        let file = self.file(&sha);
        let stored = std::fs::create_dir_all(file.parent().expect("a hash's directory"))
            .and_then(|()| std::fs::write(&file, &bytes));
        stored.map_err(|e| format!("BLOCKED: picture {n} couldn't be stored ({e})"))?;
        Ok(sha)
    }

    fn remove(&self, sha: &str) {
        let _ = std::fs::remove_file(self.file(sha));
    }
}

/// One revision as the hub's `canvas.drawn` gives it: one agent's layer with one picture.
fn revision(doc: &str, rev: u32, rect: [f32; 4], sha: &str) -> Presented {
    Presented::from_json(&json!({
        "doc": doc,
        "rev": rev,
        "rect": rect,
        "layers": [{
            "layer": "figure",
            "owner": { "session": "session:01K9ACCEPTANCE0000000000995" },
            "band": "agent",
            "outline": false,
            "items": ["item:figure"],
            "picture": sha,
        }],
    }))
    .expect("a presented revision in the hub's shape")
}

/// The process's memory now, in bytes. Linux: resident plus swapped, so paging on a busy machine can't hide growth.
#[cfg(target_os = "linux")]
fn memory() -> Result<u64, String> {
    let status = std::fs::read_to_string("/proc/self/status")
        .map_err(|e| format!("INCONCLUSIVE: /proc/self/status can't be read ({e})"))?;
    let kb = |key: &str| {
        (status.lines().find_map(|line| line.strip_prefix(key)))
            .and_then(|v| v.trim().trim_end_matches("kB").trim().parse::<u64>().ok())
    };
    match (kb("VmRSS:"), kb("VmSwap:")) {
        (Some(resident), Some(swapped)) => Ok((resident + swapped) * 1024),
        _ => Err("INCONCLUSIVE: /proc/self/status gives no VmRSS and VmSwap".to_owned()),
    }
}

/// The process's memory now, in bytes. macOS: its physical footprint, what Activity Monitor calls its memory, which
/// counts the textures the GPU holds for it.
#[cfg(target_os = "macos")]
fn memory() -> Result<u64, String> {
    /// `struct rusage_info_v0` of `<sys/resource.h>`.
    #[repr(C)]
    #[derive(Default)]
    struct RusageInfoV0 {
        uuid: [u8; 16],
        user_time: u64,
        system_time: u64,
        pkg_idle_wkups: u64,
        interrupt_wkups: u64,
        pageins: u64,
        wired_size: u64,
        resident_size: u64,
        phys_footprint: u64,
        proc_start_abstime: u64,
        proc_exit_abstime: u64,
    }
    extern "C" {
        fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut RusageInfoV0) -> i32;
    }
    let mut info = RusageInfoV0::default();
    // SAFETY: flavor 0 is RUSAGE_INFO_V0, which fills a `struct rusage_info_v0`, laid out as above.
    let failed = unsafe { proc_pid_rusage(std::process::id() as i32, 0, &mut info) };
    if failed != 0 || info.phys_footprint == 0 {
        return Err("BLOCKED: proc_pid_rusage gave no physical footprint for this process".to_owned());
    }
    Ok(info.phys_footprint)
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn memory() -> Result<u64, String> {
    Err("INCONCLUSIVE: this platform's process memory isn't read; the reference machines are Macs".to_owned())
}

/// A step the window must do to be judged at all: `BLOCKED` on macOS, where the reference machines draw it, and
/// `INCONCLUSIVE` elsewhere, where a machine may have no GPU the headless renderer can use.
fn unavailable(what: &str) -> String {
    let word = if cfg!(target_os = "macos") {
        "BLOCKED"
    } else {
        "INCONCLUSIVE"
    };
    format!("{word}: {what}")
}

fn mb(bytes: u64) -> String {
    format!("{:.1} MB", bytes as f64 / 1e6)
}

/// The panel in its window.
struct Shown {
    cx: HeadlessAppContext,
    window: AnyWindowHandle,
    panel: Entity<CanvasPanel>,
}

impl Shown {
    fn open(evidence: &Path) -> Result<Shown, String> {
        let mut cx = HeadlessAppContext::with_platform(
            gpui_kit::platform::current_platform(true).text_system(),
            Arc::new(Assets),
            gpui_kit::platform::current_headless_renderer,
        );
        cx.update(|cx| {
            gpui_kit::init(cx);
            deep_app::init(cx);
        });
        let options = WindowOptions {
            window_bounds: Some(WindowBounds::Windowed(Bounds {
                origin: Point::default(),
                size: size(px(WINDOW.0), px(WINDOW.1)),
            })),
            titlebar: None,
            focus: false,
            show: false,
            ..Default::default()
        };
        let evidence = evidence.to_owned();
        let (window, panel) = cx
            .update(|cx| {
                gpui_kit::open_window(options, cx, |_, cx| cx.new(|_| CanvasPanel::new(evidence)))
            })
            .map_err(|e| unavailable(&format!("no headless window opened ({e})")))?;
        Ok(Shown { cx, window, panel })
    }

    /// Hands the panel one revision as the app does (`show::follow`), lets its picture decode, and draws and presents
    /// one frame, as a display's frame does in the app.
    fn present(&mut self, revision: Presented) {
        let panel = self.panel.clone();
        self.cx.update(|cx| {
            panel.update(cx, |panel, cx| panel.present(revision, cx));
            cx.refresh_windows();
        });
        self.cx.run_until_parked();
        self.cx.present_frame(self.window);
        self.cx.run_until_parked();
    }

    /// The window's pixels at the middles of the two panels and at a point in neither: the redrawn document's, the
    /// other document's and the ground.
    fn pixels(&mut self) -> Result<[[u8; 3]; 3], String> {
        let shot = (self.cx.capture_screenshot(self.window))
            .map_err(|e| unavailable(&format!("the window's pixels can't be read back ({e})")))?;
        let scale = shot.width() as f32 / WINDOW.0;
        let at = |x: f32, y: f32| {
            let (x, y) = ((x * scale) as u32, (y * scale) as u32);
            let p = shot.get_pixel(x.min(shot.width() - 1), y.min(shot.height() - 1)).0;
            [p[0], p[1], p[2]]
        };
        let middle = |r: [f32; 4]| at(r[0] + r[2] / 2., r[1] + r[3] / 2.);
        Ok([
            middle(REDRAWN),
            middle(OTHER),
            at(WINDOW.0 / 2., (REDRAWN[3] + WINDOW.1) / 2.),
        ])
    }
}

/// What one run read.
struct Reading {
    /// The process's memory after revision 10 and after revision 1,000, in bytes.
    first: u64,
    last: u64,
    /// Where the panel didn't draw the newest revision's picture, at revision 10 and at revision 1,000.
    undrawn: Vec<String>,
    /// Where what the panel drew shows it holding other pictures than the shown revisions'.
    held: Vec<String>,
    /// Why holding a picture no revision shows couldn't be judged, if it couldn't.
    unjudged: Option<String>,
}

fn run() -> Result<Reading, String> {
    let evidence = Evidence::new()?;
    let mut shown = Shown::open(&evidence.dir)?;
    let (mut undrawn, mut held) = (Vec::new(), Vec::new());

    // The other document: one revision, one picture, shown for the whole run.
    let other = evidence.store(OTHER_PICTURE)?;
    shown.present(revision("doc:other", 1, OTHER, &other));

    let (mut first, mut newest, mut replaced) = (0, String::new(), String::new());
    for n in 1..=REVISIONS {
        let sha = evidence.store(n)?;
        shown.present(revision("doc:redrawn", n, REDRAWN, &sha));
        // A replaced revision's picture leaves the store too: this run keeps two pictures on disk, not 1 GB, and a
        // picture the panel draws from here on is one it holds.
        if n > 1 {
            evidence.remove(&newest);
        }
        replaced = std::mem::replace(&mut newest, sha);
        if n == FIRST {
            // Read back before the level is taken, so whatever a first read-back keeps is in the level.
            let [redrawn, _, _] = shown.pixels()?;
            if !near(redrawn, color(n)) {
                undrawn.push(format!(
                    "after revision {n}, the canvas panel drew {redrawn:?} at the middle of its panel, not revision \
                     {n}'s picture ({:?})",
                    color(n)
                ));
            }
            first = memory()?;
        }
    }
    let last = memory()?;

    let [redrawn, others, ground] = shown.pixels()?;
    if !near(redrawn, color(REVISIONS)) {
        let said = format!(
            "after revision {REVISIONS}, the canvas panel drew {redrawn:?} at the middle of its panel, not revision \
             {REVISIONS}'s picture ({:?})",
            color(REVISIONS)
        );
        undrawn.push(said.clone());
        held.push(said);
    }
    if !near(others, color(OTHER_PICTURE)) {
        held.push(format!(
            "after revision {REVISIONS} of one document, the canvas panel drew {others:?} at the middle of the other \
             document's panel, not its shown revision's picture ({:?}): it freed a picture a shown revision uses",
            color(OTHER_PICTURE)
        ));
    }

    // A new revision with the picture the shown one already uses: the picture stays.
    shown.present(revision("doc:redrawn", REVISIONS + 1, REDRAWN, &newest));
    let [redrawn, others, _] = shown.pixels()?;
    if !near(redrawn, color(REVISIONS)) || !near(others, color(OTHER_PICTURE)) {
        held.push(format!(
            "after revision {} with revision {REVISIONS}'s picture again, the canvas panel drew {redrawn:?} and \
             {others:?} at the middles of its panels, not the shown pictures ({:?} and {:?}): it freed a picture a \
             shown revision uses",
            REVISIONS + 1,
            color(REVISIONS),
            color(OTHER_PICTURE)
        ));
    }

    // A new revision with the picture revision 1,000 replaced, which the store no longer has: only a panel that
    // still holds it can draw it.
    let before = color(REVISIONS - 1);
    let grounds = [before, color(REVISIONS), color(OTHER_PICTURE)];
    let kept = evidence.file(&replaced).exists();
    let unjudged = (kept || grounds.iter().any(|c| near(ground, *c))).then(|| {
        format!(
            "BLOCKED: a held picture can't be told from none: the window's ground is {ground:?}, the pictures are \
             {grounds:?}, and revision {}'s file is {} the store",
            REVISIONS - 1,
            if kept { "still in" } else { "out of" }
        )
    });
    shown.present(revision(
        "doc:redrawn",
        REVISIONS + 2,
        REDRAWN,
        &replaced,
    ));
    let [redrawn, _, _] = shown.pixels()?;
    if unjudged.is_none() && near(redrawn, before) {
        held.push(format!(
            "the canvas panel still held revision {}'s picture after revision {REVISIONS} replaced it: with the \
             picture gone from the evidence store, a later revision naming it drew {redrawn:?}, its color \
             ({before:?}); only the shown pictures may be held",
            REVISIONS - 1
        ));
    }
    Ok(Reading {
        first,
        last,
        undrawn,
        held,
        unjudged,
    })
}

impl Reading {
    fn grew(&self) -> u64 {
        self.last.saturating_sub(self.first)
    }

    fn levels(&self) -> String {
        format!(
            "{} after revision {FIRST}, {} after revision {REVISIONS}",
            mb(self.first),
            mb(self.last)
        )
    }

    fn memory(&self) -> Result<(), String> {
        if self.grew() > BUDGET_BYTES {
            return Err(format!(
                "FAIL: the canvas panel held {} more after {REVISIONS} revisions than after the first {FIRST} ({}): \
                 past the issue's 20 MB, about {:.2} MB a revision, each with a new 1 MB picture",
                mb(self.grew()),
                self.levels(),
                self.grew() as f64 / 1e6 / f64::from(REVISIONS - FIRST)
            ));
        }
        // Flat memory is no proof from a panel that drew none of the pictures.
        match self.undrawn.as_slice() {
            [] => Ok(()),
            undrawn => Err(format!("FAIL: {}", undrawn.join("; "))),
        }
    }

    fn only_shown_held(&self) -> Result<(), String> {
        match (self.held.as_slice(), &self.unjudged) {
            ([], None) => Ok(()),
            ([], Some(unjudged)) => Err(unjudged.clone()),
            (held, _) => Err(format!("FAIL: {}", held.join("; "))),
        }
    }

    fn gpu(&self) -> Result<(), String> {
        if !cfg!(target_os = "macos") {
            return Err(format!(
                "INCONCLUSIVE: off macOS the GPU's textures needn't count in the process's memory, so the reading \
                 ({}) can't show them freed; the reference Macs judge this",
                self.levels()
            ));
        }
        if self.grew() > BUDGET_BYTES {
            return Err(format!(
                "FAIL: counting the GPU's textures, the canvas panel held {} more after {REVISIONS} revisions than \
                 after the first {FIRST} ({}): past the issue's 20 MB",
                mb(self.grew()),
                self.levels()
            ));
        }
        match self.undrawn.as_slice() {
            [] => Ok(()),
            undrawn => Err(format!("FAIL: {}", undrawn.join("; "))),
        }
    }
}

type Verdict = fn(&Reading) -> Result<(), String>;

const VERDICTS: [(&str, Verdict); 3] = [
    (
        "presenting_1000_revisions_each_with_a_new_1_mb_picture_leaves_memory_within_20_mb_of_its_level_after_the_first_10",
        Reading::memory,
    ),
    (
        "after_1000_revisions_the_panel_holds_only_the_pictures_a_shown_revision_uses",
        Reading::only_shown_held,
    ),
    (
        "the_pictures_no_shown_revision_uses_are_freed_from_the_gpu",
        Reading::gpu,
    ),
];

fn main() {
    let filters: Vec<String> = std::env::args()
        .skip(1)
        .filter(|arg| !arg.starts_with('-'))
        .collect();
    let chosen: Vec<&(&str, Verdict)> = VERDICTS
        .iter()
        .filter(|(name, _)| filters.is_empty() || filters.iter().any(|f| name.contains(f.as_str())))
        .collect();
    println!("\nrunning {} tests", chosen.len());
    // A panic anywhere in the run is the panel's or GPUI's: no verdict passes on it.
    let reading = std::panic::catch_unwind(run).unwrap_or_else(|panic| {
        let said = (panic.downcast_ref::<String>().cloned())
            .or_else(|| panic.downcast_ref::<&str>().map(|s| (*s).to_owned()))
            .unwrap_or_default();
        Err(format!(
            "FAIL: presenting the revisions panicked: {said}"
        ))
    });
    if let Ok(reading) = &reading {
        println!(
            "the canvas panel's process held {}: {} more",
            reading.levels(),
            mb(reading.grew())
        );
    }
    let (mut passed, mut failed) = (0, 0);
    for (name, verdict) in chosen {
        let said = match &reading {
            Ok(reading) => verdict(reading),
            Err(why) => Err(why.clone()),
        };
        match said {
            Ok(()) => {
                println!("test {name} ... ok");
                passed += 1;
            }
            Err(why) => {
                println!("test {name} ... FAILED\n\n---- {name} ----\n{why}\n");
                failed += 1;
            }
        }
    }
    let word = if failed == 0 { "ok" } else { "FAILED" };
    println!("\ntest result: {word}. {passed} passed; {failed} failed\n");
    std::process::exit(i32::from(failed > 0));
}
