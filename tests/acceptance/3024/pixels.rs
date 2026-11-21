//! #3024.324d6742 (AC2): on Metal, one renderer draws a lake scene at t = 0, again at t = 0, at a
//! t or camera where the reflection visibly changes, again there, and again there at another
//! internal scale. Every frame hashes the same as on the merge base, and the third differs from
//! the first by pixel. A mutant that keeps the mirrored view whatever holds fails, naming the
//! frame.
//!
//! The lake: a flat 40 × 40 m plate whose material is calm water (no waves, no ripples, no
//! distortion), so its water draws a mirror of its own in the plate's plane (scene3d's
//! `mirror::own`) and nothing on the water moves with t. A camera stands 1.5 m over it looking
//! across, and a magenta beacon (an emissive 8 × 3 × 1 m box) hangs 4 to 7 m over the far water,
//! above the top of the frame: the camera can't see it, only its reflection in the lake. A channel
//! slides the beacon from x = −6 m at t = 0 to x = +6 m at t = 2 s, so the reflection moves across
//! the water and nothing else in the frame changes.
//!
//! The frames, one renderer, 160 × 120 px, each drawn offscreen (`draw_offscreen`, BGRA8) from the
//! scene evaluated at its t: (1) t = 0, (2) t = 0, (3) t = 2 s, (4) t = 2 s, (5) t = 2 s with the
//! renderer's GPU surface at scale 0.5 and the upscale's pipelines compiled (its internal size
//! 80 × 60, as the view's `surface` call sets it). Each frame's FNV-1a 64 hash equals the merge
//! base's (fixtures/lake-hashes.json, recorded from the base on this Mac's GPU, which it names;
//! on another GPU or with none the test fails INCONCLUSIVE, never passes). Frames 3 and 1 differ in
//! at least 100 pixels; every frame shows at least 100 beacon-colored pixels, which only the
//! mirror can show (the guard checks by projection that the beacon is above the frame and its
//! mirror image inside it); and each frame's mirror drew at half its internal size.
//!
//! The planted test keeps the mirror's first picture with #506's planted core
//! (`Renderer::keep_first(false, true)` after frame 1, the base's surface): it fails, naming frame
//! 3. The issue's own mutant, a mirror that reuses the first mirrored view it made forever, was
//! run as a probe at the base (BASE-FAILURE.txt).

mod common;

use std::sync::Arc;

use common::*;
use deep_canvas_scene3d::scene::{Scene, Solid};
use deep_gpu::device::{Backend, Gpu};
use deep_scene3d_render::mirror::half;
use deep_scene3d_render::surface::{Surface, Upscale};
use deep_scene3d_render::Planted;
use serde_json::{json, Value};

const ID: &str = "#3024.324d6742";
/// The pixel size of every frame.
const PIXELS: [u32; 2] = [160, 120];
/// 2 s: the beacon has slid 12 m.
const MOVED: i64 = 2 * SECOND;
/// The other internal scale, frame 5's: the showpiece class's render scale while moving.
const SCALE: f64 = 0.5;
/// The frames: what each is called, its t, and whether it draws at [`SCALE`].
const FRAMES: [(&str, i64, bool); 5] = [
    ("t = 0", 0, false),
    ("t = 0 again", 0, false),
    ("t = 2 s", MOVED, false),
    ("t = 2 s again", MOVED, false),
    ("t = 2 s at internal scale 0.5", MOVED, true),
];
/// The fewest pixels frames 3 and 1 differ in, and the fewest beacon-colored pixels a frame
/// shows (README: Readings).
const CHANGED: usize = 100;
const REFLECTED: usize = 100;

fn lake(size: [u32; 2]) -> Value {
    doc(
        vec![
            ("cam".into(), camera([0.0, 0.0, 0.0], [0.0, 16.0, 5.5])),
            ("sky".into(), json!({"kind": "sky@1", "params": {"top": [0.15, 0.3, 0.75, 1], "low": [0.45, 0.6, 0.85, 1], "ambient_top": [0.25, 0.25, 0.25], "ambient_low": [0.1, 0.1, 0.1]}})),
            ("sun".into(), json!({"kind": "light.sun@1", "params": {"illuminance": 3, "color": [1, 1, 1], "shadow": false}, "at": {"rot": [-45, 30, 0]}})),
            ("lake_mat".into(), lake_material(Some(json!({"waves": [], "ripples": {"strength": 0}, "distort": 0})))),
            ("lake".into(), plate([40.0, 40.0], [0.0, 0.0, 0.0])),
            ("beacon_mat".into(), json!({"kind": "material@1", "params": {"base_color": [1, 0, 1, 1], "emission": [1, 0, 1], "emission_strength": 8, "roughness": 0.5}})),
            ("beacon".into(), json!({"kind": "mark.box@1", "params": {"size": [8, 3, 1]}, "at": {"pos": [-6, 5.5, -25]}, "material": "beacon_mat"})),
        ],
        json!({"slide": {"target": "items/beacon/at/pos/0", "type": "f32", "keys": {"k0": {"t": "0s", "value": -6, "interp": "linear"}, "k1": {"t": "2s", "value": 6, "interp": "linear"}}}}),
        size,
    )
}

/// A box's eight corners in the world: its model over the unit cube.
fn corners(s: &Solid) -> Vec<[f64; 3]> {
    let m = &s.model;
    let mut out = Vec::new();
    for k in 0..8 {
        let c = [0, 1, 2].map(|i| if k >> i & 1 == 1 { 0.5 } else { -0.5 });
        out.push(std::array::from_fn(|r| m[r][0] * c[0] + m[r][1] * c[1] + m[r][2] * c[2] + m[r][3]));
    }
    out
}

/// What keeps the frames from proving anything about the mirror in `scene` at `when`: the lake
/// isn't water with a mirror of its own, the camera sees the beacon itself, or the beacon's
/// mirror image falls outside the frame.
fn unmirrored(scene: &Scene, when: &str) -> Vec<String> {
    let mut problems = Vec::new();
    if !water_is(scene, "lake") || !mirrored_in(scene, "lake") {
        problems.push(format!("at {when} the lake isn't water drawing a mirror of its own: water {:?}, mirror {:?}", scene.water.as_ref().map(|w| &w.parts), scene.mirror));
        return problems;
    }
    let m = scene.mirror.as_ref().expect("checked above");
    let n = m.normal;
    let image = |p: [f64; 3]| {
        let d = 2.0 * (n[0] * p[0] + n[1] * p[1] + n[2] * p[2] - m.offset);
        [p[0] - d * n[0], p[1] - d * n[1], p[2] - d * n[2]]
    };
    let [w, h] = scene.size.map(f64::from);
    for c in corners(solid(scene, "beacon")) {
        if let Some([x, y, _]) = scene.camera.project(c) {
            if y >= 0.0 {
                problems.push(format!("at {when} the beacon's corner {c:?} shows in the frame at ({x:.1}, {y:.1}) px: the camera sees the beacon itself"));
            }
        }
        match scene.camera.project(image(c)) {
            Some([x, y, _]) if (0.0..w).contains(&x) && (0.0..h).contains(&y) => {}
            seen => problems.push(format!("at {when} the beacon's corner {c:?} has its mirror image outside the frame: {seen:?}")),
        }
    }
    problems
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

/// A frame's beacon-colored pixels: red and blue each at least 64 levels over green (BGRA8).
fn beacon_pixels(frame: &[u8]) -> usize {
    frame
        .chunks(4)
        .filter(|p| p[2] >= p[1].saturating_add(64) && p[0] >= p[1].saturating_add(64))
        .count()
}

/// The five frames' problems against the base's hashes, drawn by one renderer that keeps the
/// mirror's first picture from frame 2 on when `keeps_first_picture` (#506's planted core).
fn drawn(keeps_first_picture: bool) -> Result<Vec<String>, String> {
    let gpu = Gpu::open(Backend::Gpu).map_err(|e| format!("INCONCLUSIVE: {ID}: no GPU to draw on: {e}"))?;
    let device = gpu.device();
    let adapter = device.adapter.as_ref().map_or_else(|| device.name.clone(), |a| a.name.clone());
    let fixture = fixture("lake-hashes.json");
    if fixture["adapter"].as_str() != Some(adapter.as_str()) {
        return Err(format!(
            "INCONCLUSIVE: {ID}: the base's hashes were drawn on {}, this GPU is {adapter}",
            fixture["adapter"]
        ));
    }
    let doc = lake(PIXELS);
    let mut r = renderer(&device, Planted::default());
    let (mut frames, mut sizes) = (Vec::new(), Vec::new());
    for (k, (name, t, scaled)) in FRAMES.iter().enumerate() {
        if *scaled {
            r.surface = Surface { scale: SCALE, ..Surface::default() };
            r.upscale = Some(Arc::new(Upscale::new(&device)));
        }
        let internal = r.internal_size(PIXELS);
        let pixels = deep_scene3d_render::draw_offscreen(&device, &mut r, &scene(&doc, *t), &look(), None)
            .ok_or_else(|| format!("INCONCLUSIVE: {ID}: {adapter} gave no pixels for frame {} ({name})", k + 1))?;
        frames.push(pixels);
        sizes.push((internal, r.mirror_px()));
        if k == 0 && keeps_first_picture {
            r.keep_first(false, true);
        }
    }
    no_errors(&device);
    let mut problems = Vec::new();
    let hashes: Vec<String> = frames.iter().map(|f| fnv(f)).collect();
    for (k, h) in hashes.iter().enumerate() {
        let base = fixture["hashes"][k].as_str().unwrap_or("missing");
        if h != base {
            problems.push(format!("frame {} ({}) hashes {h}, the merge base's {base}", k + 1, FRAMES[k].0));
        }
    }
    for (k, (internal, mirror)) in sizes.iter().enumerate() {
        let other = FRAMES[k].2;
        if (*internal != PIXELS) != other {
            problems.push(format!("frame {} ({}) draws at internal size {internal:?} of {PIXELS:?}", k + 1, FRAMES[k].0));
        }
        if *mirror != Some(half(*internal)) {
            problems.push(format!("frame {} ({}) drew its mirror at {mirror:?}, not at {:?}, half its internal size {internal:?}", k + 1, FRAMES[k].0, half(*internal)));
        }
    }
    let differ = frames[0].chunks(4).zip(frames[2].chunks(4)).filter(|(a, b)| a != b).count();
    if differ < CHANGED {
        problems.push(format!("frame 3 ({}) differs from frame 1 ({}) in {differ} pixels, under {CHANGED}: the reflection doesn't visibly move", FRAMES[2].0, FRAMES[0].0));
    }
    for (k, f) in frames.iter().enumerate() {
        let shown = beacon_pixels(f);
        if shown < REFLECTED {
            problems.push(format!("frame {} ({}) shows {shown} beacon-colored pixels, under {REFLECTED}: the beacon's reflection isn't drawn", k + 1, FRAMES[k].0));
        }
    }
    if !problems.is_empty() {
        let shown: Vec<usize> = frames.iter().map(|f| beacon_pixels(f)).collect();
        problems.push(format!("this run's hashes: {}; frames 3 and 1 differ in {differ} pixels; beacon-colored pixels {shown:?}", json!({"adapter": adapter, "hashes": hashes})));
    }
    Ok(problems)
}

#[test]
fn ac2_on_metal_a_lakes_frames_equal_the_base_by_hash_and_its_reflection_moves() {
    let doc = lake(PIXELS);
    let mut guard = unmirrored(&scene(&doc, 0), "t = 0");
    guard.extend(unmirrored(&scene(&doc, MOVED), "t = 2 s"));
    assert!(guard.is_empty(), "{ID}: the lake scene shows the beacon only in its mirror:\n{}", guard.join("\n"));
    let problems = drawn(false).unwrap_or_else(|e| panic!("{e}"));
    assert!(problems.is_empty(), "{ID}: the lake on Metal:\n{}", problems.join("\n"));
}

#[test]
fn ac2_on_metal_a_renderer_that_keeps_its_first_mirrored_picture_fails_naming_the_frame() {
    let problems = drawn(true).unwrap_or_else(|e| panic!("{e}"));
    eprintln!("{ID}: the renderer that keeps the mirror's first picture fails with: {problems:?}");
    assert!(
        problems.iter().any(|p| p.starts_with("frame 3 (t = 2 s) hashes")),
        "{ID}: a renderer that keeps the mirror's first picture fails, naming frame 3; its problems: {problems:?}"
    );
}
