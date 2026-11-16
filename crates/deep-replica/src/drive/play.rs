//! Issue #184: the replica's play mode. `{"call": "play", ...}` plays a piece headless on its own virtual clock, a step
//! at a time, with a bot's entries on its input track as the writer `bot`, and answers the recorded track by hash, the
//! values at the paths asked for at each step, any trap, each step's time and fuel, the step ceilings, the piece's
//! full-state hash at every checkpoint and at the end, and the frames asked for (`deep_logic::play`). Each call is a
//! fresh copy of the piece; nothing carries from one call to the next, and it needs no launched window. While it
//! plays, the process runs at background priority, as the checks process does.
//!
//! The piece is the logic module's piece (`piece`: seed, class, controls, items) or a canvas document (`document`),
//! each program from `assets` (`{sha256: base64}`) or the evidence store at `evidence`. A frame is the replica's
//! render of the piece's state at that step: each logic item's arrays as bands of grey squares, one byte a square,
//! kept at `<out>/frames/<sha256>.png` and named by its hash. A frame shows what happened; it never decides anything.

use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use deep_logic::play::{piece_of, play, Plants};
use deep_logic::world::World;
use image::{GrayImage, ImageFormat, Luma};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::{fail, Fail, Plant};

/// A frame's size in pixels.
const SIZE: (u32, u32) = (640, 360);
/// Each byte of the state is a square this many pixels wide, `ROW` to a band.
const CELL: u32 = 10;
const ROW: usize = (SIZE.0 / CELL) as usize;

pub fn run(call: &Value, plant: Option<Plant>, out: &Path) -> Result<Value, Fail> {
    background();
    let piece = match (call.get("piece"), call.get("document")) {
        (Some(p), None) => p.clone(),
        (None, Some(d)) => {
            piece_of(d).ok_or_else(|| fail("refused", "the document has no logic item to play"))?
        }
        _ => return Err(fail("bad_input", "play takes a document or a piece")),
    };
    let inline = call.get("assets").cloned().unwrap_or(json!({}));
    let own = piece.get("assets").cloned().unwrap_or(json!({}));
    let evidence = call
        .get("evidence")
        .and_then(Value::as_str)
        .map(PathBuf::from);
    let stored = |sha: &str| -> Option<Vec<u8>> {
        if let Some(b) = inline
            .get(sha)
            .or_else(|| own.get(sha))
            .and_then(Value::as_str)
        {
            return B64.decode(b).ok();
        }
        let root = evidence
            .as_ref()
            .filter(|_| sha.len() == 64 && sha.is_ascii())?;
        std::fs::read(root.join(&sha[..2]).join(&sha[2..])).ok()
    };
    let plants = Plants {
        drops_first_bot_entry: plant == Some(Plant::DropsFirstBotEntry),
        entry_on_change: plant == Some(Plant::EntryOnChange),
    };
    let asked: Vec<i64> = call
        .get("frames")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_i64)
        .collect();
    let dir = out.join("frames");
    let mut error = None;
    let mut frame = |k: i64, world: &World| -> Option<Value> {
        let keep = asked.contains(&k);
        if !keep && !cfg!(feature = "test-renders-unkept-frames") {
            return None;
        }
        let png = render(world);
        if !keep {
            return None;
        }
        let sha = format!("{:x}", Sha256::digest(&png));
        if let Err(e) = std::fs::create_dir_all(&dir)
            .and_then(|_| std::fs::write(dir.join(format!("{sha}.png")), &png))
        {
            error.get_or_insert(e.to_string());
        }
        Some(json!({"step": k, "sha256": sha}))
    };
    let reply = play(&piece, &stored, call, plants, &mut frame).map_err(|e| {
        let code = e
            .get("code")
            .and_then(Value::as_str)
            .unwrap_or("refused")
            .to_string();
        let what = e.get("what").map_or_else(
            || e.to_string(),
            |w| w.as_str().map_or_else(|| w.to_string(), str::to_string),
        );
        // What the refusal names: an undeclared control, a play interface's missing name (#555)
        // or an action it doesn't declare.
        ["control", "name", "action"]
            .iter()
            .fold(fail(&code, what), |f, k| match e.get(*k) {
                Some(v) => f.with(k, v.clone()),
                None => f,
            })
    })?;
    if let Some(e) = error {
        return Err(fail("blocked", format!("{}: {e}", dir.display())));
    }
    Ok(reply)
}

/// The piece's state at a step as a PNG of the frame's size: each logic item's arrays, a band of `ROW` bytes a row,
/// one grey square a byte, from the top; what doesn't fit is left out.
fn render(world: &World) -> Vec<u8> {
    let mut img = GrayImage::from_pixel(SIZE.0, SIZE.1, Luma([0]));
    let mut row = 0;
    for (_, band) in world.arrays() {
        for (i, v) in band.iter().enumerate() {
            let (x, y) = ((i % ROW) as u32 * CELL, (row + i / ROW) as u32 * CELL);
            if y + CELL > SIZE.1 {
                break;
            }
            for dy in 0..CELL {
                for dx in 0..CELL {
                    img.put_pixel(x + dx, y + dy, Luma([*v]));
                }
            }
        }
        row += band.len().div_ceil(ROW).max(1);
    }
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), ImageFormat::Png)
        .expect("a PNG encodes in memory");
    png
}

/// The process at background priority, as the checks process runs (#184 criterion 14).
fn background() {
    extern "C" {
        fn setpriority(which: i32, who: u32, prio: i32) -> i32;
    }
    // PRIO_PROCESS, this process, nice 10.
    unsafe { setpriority(0, 0, 10) };
}
