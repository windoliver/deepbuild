//! #2657.92acfd65 (AC6): two frames of a swaying tree whose parameters hold submit no command buffer
//! for sway. Two frames at times where the tree visibly moves differ by pixel and equal the merge
//! base's by hash. A planted renderer that never runs the pass after the first frame fails, naming
//! the frame.
//!
//! The tree is the render crate's own sway fixture (sway.rs's tests; #2016's tree): a lathe trunk
//! and crown with `mod.sway@1` (amount 0.3 m, wind 5 m/s, gusts 20 m, seed 7) under a still camera.
//! Its still twin is the same document with the sway `enabled: false`.
//!
//! Counts, on the noop lane: frame 1 at t = 0, frames 2 and 3 at t = 0 again (the sway's
//! parameters hold), frame 4 at 1.25 s, each a whole prepare, its jobs recorded into a slot and one
//! submit. Frames 2 and 3 hand the queue no more command buffers (the counted device's
//! `command_buffers`, README: Surfaces) and begin no more compute passes
//! (`deep_gpu::counted::compute_passes()`, which the sway pass counts as it begins) than the still
//! twin's. Guard: frames 1 and 4 begin at least one compute pass more than the twin's (the sway
//! pass runs where the tree moves).
//!
//! Pixels, on Metal: one renderer draws t = 0, t = 0 again and t = 1.25 s offscreen
//! (`draw_offscreen`, BGRA8). Frames 1 and 3 differ in at least 10 pixels, and each frame's hash
//! (FNV-1a, 64 bits, over its bytes) equals the merge base's (fixtures/sway-hashes.json, recorded
//! from the base's run on this Mac's GPU). The planted renderer is
//! `Planted { sway_first_frame_only: true, .. }`.

mod common;

use std::sync::Mutex;

use common::*;
use deep_gpu::device::{Backend, Gpu};
use deep_scene3d_render::Planted;
use serde_json::{json, Value};

const ID: &str = "#2657.92acfd65";
/// 1.25 s: half the sway's 0.4 Hz period after t = 0.
const MOVED: i64 = 5 * SECOND / 4;
/// The pixel size of the Metal frames.
const PIXELS: [u32; 2] = [160, 120];
/// compute_passes() counts process-wide: the two tests take turns.
static TURN: Mutex<()> = Mutex::new(());

fn tree(swaying: bool, size: [u32; 2]) -> Value {
    doc(
        vec![
            ("cam".into(), camera([0.0, 1.5, 0.0], 9.0)),
            ("sun".into(), json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": false}, "at": {"rot": [-45, 30, 0]}})),
            ("needles".into(), json!({"kind": "material@1", "params": {"base_color": [0.1, 0.4, 0.2, 1], "roughness": 0.8}})),
            (
                "tree".into(),
                json!({"kind": "lathe@1", "params": {"outline": [[0.15, 0, false], [0.15, 1, false], [1, 1, false], [0, 3, false]], "segments": 8}, "material": "needles", "modifiers": [{"kind": "mod.sway@1", "enabled": swaying, "params": {"amount": 0.3, "wind": {"direction": 0, "speed": 5, "gust": {"scale": 20}}, "seed": 7}}], "at": {"pos": [0, 0, 0]}}),
            ),
        ],
        json!({}),
        size,
    )
}

/// FNV-1a, 64 bits.
fn fnv(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Frames 1 to 4 of the tree on the noop lane (t = 0, 0, 0, 1.25 s): each frame's command buffers
/// and compute passes.
fn counted(swaying: bool) -> Vec<(u64, u64)> {
    let doc = tree(swaying, SIZE);
    let device = noop();
    let mut r = renderer(&device, Planted::default());
    let mut out = Vec::new();
    for t in [0, 0, 0, MOVED] {
        let scene = scene(&doc, t);
        let passes = deep_gpu::counted::compute_passes();
        let made = frame(&device, &mut r, &scene);
        out.push((made.command_buffers, deep_gpu::counted::compute_passes() - passes));
    }
    no_errors(&device);
    out
}

#[test]
fn ac6_frames_whose_sway_parameters_hold_submit_no_command_buffer_for_sway() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let (swaying, still) = (counted(true), counted(false));
    let mut problems = Vec::new();
    for n in [2usize, 3] {
        let ((sc, sp), (tc, tp)) = (swaying[n - 1], still[n - 1]);
        if sc != tc {
            problems.push(format!("frame {n}, the sway's parameters held, submits {sc} command buffers against the still tree's {tc}: {} for sway (expected none)", sc as i64 - tc as i64));
        }
        if sp != tp {
            problems.push(format!("frame {n}, the sway's parameters held, begins {sp} compute passes against the still tree's {tp}: {} for sway (expected none)", sp as i64 - tp as i64));
        }
    }
    for n in [1usize, 4] {
        let ((_, sp), (_, tp)) = (swaying[n - 1], still[n - 1]);
        if sp < tp + 1 {
            problems.push(format!("frame {n}, where the tree moves, begins {sp} compute passes against the still tree's {tp}: no sway pass ran"));
        }
    }
    assert!(problems.is_empty(), "{ID}: a swaying tree on the noop lane:\n{}", problems.join("\n"));
}

/// The three Metal frames' problems against the base's hashes, for `planted`.
fn drawn(planted: Planted) -> Result<Vec<String>, String> {
    let gpu = Gpu::open(Backend::Gpu).map_err(|e| format!("INCONCLUSIVE: {ID}: no GPU to draw on: {e}"))?;
    let device = gpu.device();
    let adapter = device.adapter.as_ref().map_or_else(|| device.name.clone(), |a| a.name.clone());
    let fixture = fixture("sway-hashes.json");
    if fixture["adapter"].as_str() != Some(adapter.as_str()) {
        return Err(format!(
            "INCONCLUSIVE: {ID}: the base's hashes were drawn on {}, this GPU is {adapter}",
            fixture["adapter"]
        ));
    }
    let doc = tree(true, PIXELS);
    let mut r = renderer(&device, planted);
    let mut frames = Vec::new();
    for t in [0, 0, MOVED] {
        let pixels = deep_scene3d_render::draw_offscreen(&device, &mut r, &scene(&doc, t), &look(), None)
            .ok_or_else(|| format!("INCONCLUSIVE: {ID}: {adapter} gave no pixels"))?;
        frames.push(pixels);
    }
    no_errors(&device);
    let mut problems = Vec::new();
    let hashes: Vec<String> = frames.iter().map(|f| fnv(f)).collect();
    for (k, h) in hashes.iter().enumerate() {
        let base = fixture["hashes"][k].as_str().unwrap_or("missing");
        if h != base {
            problems.push(format!("frame {} (t = {} s) hashes {h}, the merge base's {base}", k + 1, [0.0, 0.0, 1.25][k]));
        }
    }
    let differ = frames[0].chunks(4).zip(frames[2].chunks(4)).filter(|(a, b)| a != b).count();
    if differ < 10 {
        problems.push(format!("frame 3 (t = 1.25 s) differs from frame 1 (t = 0) in {differ} pixels: the tree doesn't visibly move"));
    }
    if !problems.is_empty() {
        problems.push(format!("this run's hashes: {}", json!({"adapter": adapter, "hashes": hashes})));
    }
    Ok(problems)
}

#[test]
fn ac6_on_metal_frames_where_the_tree_moves_differ_and_equal_the_base_by_hash() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let problems = drawn(Planted::default()).unwrap_or_else(|e| panic!("{e}"));
    assert!(problems.is_empty(), "{ID}: the swaying tree on Metal:\n{}", problems.join("\n"));
}

#[test]
fn ac6_on_metal_planted_sway_first_frame_only_fails_naming_the_frame() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let problems = drawn(Planted { sway_first_frame_only: true, ..Planted::default() }).unwrap_or_else(|e| panic!("{e}"));
    eprintln!("{ID}: planted sway_first_frame_only fails with: {problems:?}");
    assert!(
        problems.iter().any(|p| p.starts_with("frame 3 (t = 1.25 s) hashes")),
        "{ID}: the planted renderer that never runs the sway pass after the first frame fails, naming frame 3; its problems: {problems:?}"
    );
}
