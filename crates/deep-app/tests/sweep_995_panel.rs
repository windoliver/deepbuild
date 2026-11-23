//! Issue #995, written blind (tests/acceptance/995-sweep-2047, README there): the canvas panel keeps only the pictures
//! a shown revision uses. One panel on gpui's headless test context (no window, no GPU, no display) is presented one
//! revision of a second document, kept shown, then 1,000 revisions of one document, each with its own new 512 x 512
//! picture (1,048,576 B decoded), every picture decoded before the next revision. The process's memory after revision
//! 1,000 must be within 20,000,000 B of its level after revision 10, and after every revision the panel must hold
//! exactly the two shown revisions' pictures, as its `held()` count and the `CanvasPanel::pictures` gauge read them, and
//! which ones: each picture's file leaves the evidence store once it has decoded, so a panel that let a shown picture go
//! can't get it back, and both shown revisions presented again after each revision must start no decoding (`present`
//! decodes only a picture the panel doesn't hold) and leave it holding both.
//!
//! A binary of its own with one test, so the process's memory and the gauge are this panel's alone.

use std::path::{Path, PathBuf};

use deep_app::show::{CanvasPanel, Item, Layer, Presented, PICTURES};
use gpui_kit::{AppContext as _, Entity, TestAppContext};
use serde_json::json;
use sha2::{Digest, Sha256};

const SIDE: u32 = 512;
const DECODED: u64 = (SIDE * SIDE * 4) as u64;
const REVISIONS: u64 = 1_000;
const BASELINE_AT: u64 = 10;
const LIMIT: i64 = 20_000_000;

/// The process's memory: its physical footprint on macOS, resident plus swapped on Linux.
fn memory() -> u64 {
    #[cfg(target_os = "macos")]
    {
        deep_gpu::footprint::footprint()
            .unwrap_or_else(|e| panic!("BLOCKED: proc_pid_rusage phys_footprint unreadable: {e}"))
    }
    #[cfg(target_os = "linux")]
    {
        let status = std::fs::read_to_string("/proc/self/status")
            .unwrap_or_else(|e| panic!("BLOCKED: /proc/self/status unreadable: {e}"));
        let kb = |key: &str| -> u64 {
            let line = status
                .lines()
                .find(|l| l.starts_with(key))
                .unwrap_or_else(|| panic!("BLOCKED: no {key} in /proc/self/status"));
            line[key.len()..]
                .trim()
                .trim_end_matches("kB")
                .trim()
                .parse::<u64>()
                .unwrap_or_else(|e| panic!("BLOCKED: {key} unparsable: {e}"))
        };
        (kb("VmRSS:") + kb("VmSwap:")) * 1024
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        panic!("BLOCKED: no memory read on {}", std::env::consts::OS)
    }
}

/// A new picture of one color, as a PNG in the evidence store by its SHA-256; its hash.
fn put_picture(evidence: &Path, n: u64, blue: u8) -> String {
    let pixel = image::Rgba([(n & 0xff) as u8, ((n >> 8) & 0xff) as u8, blue, 255]);
    let picture = image::RgbaImage::from_pixel(SIDE, SIDE, pixel);
    let mut png = std::io::Cursor::new(Vec::new());
    picture
        .write_to(&mut png, image::ImageFormat::Png)
        .expect("encode PNG");
    let png = png.into_inner();
    let sha: String = Sha256::digest(&png)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let dir = evidence.join(&sha[..2]);
    std::fs::create_dir_all(&dir).expect("evidence dir");
    std::fs::write(dir.join(&sha[2..]), &png).expect("write PNG");
    sha
}

/// Revision `rev` of `doc`, one rect on a panel at `rect`, its one layer drawn as `picture`.
fn revision(doc: &str, rev: u64, rect: [f32; 4], picture: String) -> Presented {
    Presented {
        doc: doc.to_owned(),
        rev,
        rect,
        layers: vec![Layer {
            layer: "figure".to_owned(),
            owner: json!("you"),
            band: "user".to_owned(),
            outline: false,
            name: None,
            items: vec!["box".to_owned()],
            picture: Some(picture),
            scene: None,
        }],
        session: None,
        items: vec![Item {
            id: "box".to_owned(),
            value: json!({"kind": "rect"}),
            rect: [rect[0] + 8., rect[1] + 8., 64., 64.],
        }],
    }
}

/// Presents `p` and lets its pictures decode; whether the panel started decoding one, which it does only for a picture
/// it doesn't hold.
fn present(cx: &mut TestAppContext, panel: &Entity<CanvasPanel>, p: Presented) -> bool {
    let decoding = cx.update(|cx| {
        panel.update(cx, |panel, cx| {
            panel.present(p, cx);
            panel.decoding()
        })
    });
    cx.run_until_parked();
    decoding
}

/// Takes a picture's file out of the evidence store, so only the panel's decoded copy is left.
fn forget(evidence: &Path, sha: &str) {
    std::fs::remove_file(evidence.join(&sha[..2]).join(&sha[2..])).expect("remove decoded PNG");
}

/// Notes a problem, the first three of each kind.
fn note(problems: &mut Vec<String>, seen: &mut u64, problem: impl FnOnce() -> String) {
    *seen += 1;
    if *seen <= 3 {
        problems.push(problem());
    }
}

#[gpui_kit::test]
fn canvas_panel_holds_only_the_shown_revisions_pictures(cx: &mut TestAppContext) {
    let evidence = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
        .join(format!("sweep-995-evidence-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&evidence);
    std::fs::create_dir_all(&evidence).expect("evidence store");

    let panel = cx.update(|cx| cx.new(|_| CanvasPanel::new(evidence.clone())));
    let (a, b) = ([0., 0., 512., 512.], [600., 0., 512., 512.]);
    // Two shown revisions, so two pictures held: the kept document's and the newest of the redrawn one.
    let shown = 2usize;

    let kept = put_picture(&evidence, 0, 200);
    present(cx, &panel, revision("kept", 1, b, kept.clone()));
    forget(&evidence, &kept);

    let mut problems: Vec<String> = Vec::new();
    let mut baseline = None;
    let mut peak_held = 0usize;
    let (mut unheld, mut miscounted, mut undecoded) = (0u64, 0u64, 0u64);
    let read = |cx: &TestAppContext| {
        cx.read(|cx| {
            let p = panel.read(cx);
            (p.held(), p.decoding())
        })
    };
    for rev in 1..=REVISIONS {
        let sha = put_picture(&evidence, rev, 7);
        present(cx, &panel, revision("redrawn", rev, a, sha.clone()));
        forget(&evidence, &sha);
        let (held, decoding) = read(cx);
        peak_held = peak_held.max(held);
        if decoding {
            note(&mut problems, &mut undecoded, || format!("revision {rev}: still decoding after the context parked"));
        }
        if held != shown {
            note(&mut problems, &mut miscounted, || {
                format!("after revision {rev} the canvas panel holds {held} pictures; its shown revisions use {shown}")
            });
        }
        // Which pictures it holds: the two shown revisions presented again decode nothing when it holds their pictures,
        // and a picture it let go is gone from the store, so it would hold fewer after.
        for (doc, n, rect, picture) in [("redrawn", rev, a, &sha), ("kept", 1, b, &kept)] {
            let decoded = present(cx, &panel, revision(doc, n, rect, picture.clone()));
            let (again, _) = read(cx);
            if decoded || again != held {
                note(&mut problems, &mut unheld, || {
                    format!(
                        "after revision {rev} the canvas panel doesn't hold the picture of shown revision {n} of {doc}: \
                         presented again, it decodes it ({decoded}) and holds {again} pictures, from {held}"
                    )
                });
            }
        }
        if rev == BASELINE_AT {
            baseline = Some(memory());
        }
    }
    let after = memory();
    let baseline = baseline.expect("baseline read");
    let grew = after as i64 - baseline as i64;
    let (entries, bytes) = PICTURES.read();
    let held = cx.read(|cx| panel.read(cx).held());
    eprintln!(
        "#995 memory after revision {BASELINE_AT}: {baseline} B; after revision {REVISIONS}: {after} B; grew {grew} B \
         (limit {LIMIT} B); held {held} (most {peak_held}), shown {shown}; gauge CanvasPanel::pictures {entries} \
         entries, {bytes} B; shown pictures not held when presented again: {unheld}"
    );

    if grew.abs() > LIMIT {
        problems.insert(
            0,
            format!(
                "the canvas panel (CanvasPanel) grew the app's memory by {grew} B from revision {BASELINE_AT} \
                 ({baseline} B) to revision {REVISIONS} ({after} B), over the {LIMIT} B limit"
            ),
        );
    }
    if held != shown {
        problems.push(format!("the canvas panel holds {held} pictures at the end; its {shown} shown revisions use {shown}"));
    }
    if (entries, bytes) != (shown as u64, shown as u64 * DECODED) {
        problems.push(format!(
            "the canvas panel's gauge CanvasPanel::pictures reads {entries} entries, {bytes} B; the shown pictures are \
             {shown} entries, {} B",
            shown as u64 * DECODED
        ));
    }

    drop(panel);
    let _ = std::fs::remove_dir_all(&evidence);
    assert!(problems.is_empty(), "FAIL #995: {}", problems.join("; "));
}
