//! #2657.4baeffe3 (AC3): a frame of 2,000 textured materials retires at most 1.1 times the
//! instructions per material of a frame of 200, over 15 alternated rounds. On the merge base the
//! ratio rises with the count.
//!
//! Two documents on the noop lane: n boxes on a grid under an orbiting camera, box i wearing
//! material i, whose base color map is its own 4 × 4 image (texels the test hands the scene as the
//! host's decode worker would), so the frame binds n bind groups of maps. One renderer per
//! document, each warmed up by three frames. A round draws one frame of each, at the round's own
//! t, the order alternating (the 200's first in even rounds, the 2,000's first in odd ones); a
//! frame is a whole prepare, its jobs recorded into a slot and one submit. Each frame's
//! instructions are this process's instructions retired across it, as the kernel counts them
//! (`proc_pid_rusage`'s `ri_instructions`, the counter `/usr/bin/time -l` reads), so the count holds
//! under load. A round's ratio is (instructions ÷ 2,000) ÷ (instructions ÷ 200); the criterion
//! holds when the median of the 15 rounds' ratios is at most 1.1. No timing is read.

mod common;

use std::sync::Arc;

use common::*;
use deep_canvas_scene3d::light::Texels;
use deep_canvas_scene3d::scene::Scene;
use deep_scene3d_render::{Planted, Renderer};
use serde_json::{json, Value};

const ID: &str = "#2657.4baeffe3";
const ROUNDS: usize = 15;
const FEW: usize = 200;
const MANY: usize = 2000;
const LIMIT: f64 = 1.1;

/// Image i's SHA-256 as the scene names it: 64 hex digits, distinct per material.
fn sha(i: usize) -> String {
    format!("{:064x}", 0x2657_0000_0000u64 + i as u64)
}

fn materials(n: usize) -> Value {
    let mut items = vec![("cam".to_string(), camera([0.0, 0.0, 0.0], 160.0))];
    for i in 0..n {
        items.push((
            format!("look-{i:04}"),
            json!({"kind": "material@1", "params": {"base_color": [1, 1, 1, 1], "roughness": 0.5, "maps": {"base_color": {"sha256": sha(i)}}}}),
        ));
    }
    for i in 0..n {
        let (x, z) = ((i % 50) as f64 * 1.5 - 36.75, (i / 50) as f64 * 1.5 - 30.0);
        items.push((
            format!("box-{i:04}"),
            json!({"kind": "mark.box@1", "params": {"size": [1, 1, 1]}, "material": format!("look-{i:04}"), "at": {"pos": [x, 0.5, z]}}),
        ));
    }
    doc(items, orbit(), SIZE)
}

/// The document at `t` with every map's texels made ready, as a host's decode worker would.
fn ready(doc: &Value, n: usize, t: i64) -> Scene {
    let mut s = scene(doc, t);
    for i in 0..n {
        let texel = [(i % 251) as u8, (i / 251) as u8, 128, 255];
        s.texels.insert(
            sha(i),
            Arc::new(Texels { format: "rgba8unorm-srgb".into(), size: [4, 4], mips: 1, data: Arc::new(texel.repeat(16)) }),
        );
    }
    s
}

#[cfg(target_os = "macos")]
fn instructions() -> Option<u64> {
    #[repr(C)]
    #[allow(dead_code)]
    struct RusageInfoV4 {
        uuid: [u8; 16],
        // ri_user_time … ri_runnable_time; ri_instructions is the 30th.
        fields: [u64; 35],
    }
    extern "C" {
        fn proc_pid_rusage(pid: i32, flavor: i32, buffer: *mut RusageInfoV4) -> i32;
    }
    let mut info = RusageInfoV4 { uuid: [0; 16], fields: [0; 35] };
    // SAFETY: RUSAGE_INFO_V4 (4) fills a struct rusage_info_v4, whose layout this one repeats.
    let ok = unsafe { proc_pid_rusage(std::process::id() as i32, 4, &mut info) } == 0;
    (ok && info.fields[29] > 0).then_some(info.fields[29])
}

#[cfg(not(target_os = "macos"))]
fn instructions() -> Option<u64> {
    None
}

struct Side {
    n: usize,
    doc: Value,
    device: Arc<deep_gpu::device::Device>,
    renderer: Renderer,
}

impl Side {
    fn new(n: usize) -> Side {
        let device = noop();
        let renderer = renderer(&device, Planted::default());
        Side { n, doc: materials(n), device, renderer }
    }

    /// One frame at `t`: its instructions retired, and the maps' bind groups the device made in it.
    fn frame(&mut self, t: i64) -> (u64, u64) {
        let scene = ready(&self.doc, self.n, t);
        let slot = slot(&self.device, scene.size);
        let before = instructions().expect("this Mac counts instructions retired");
        let groups = self.device.device.counts().read().bind_groups;
        self.renderer.prepare(&self.device, &scene, &look());
        record(&self.device, &mut self.renderer, &slot);
        let spent = instructions().expect("this Mac counts instructions retired") - before;
        (spent, self.device.device.counts().read().bind_groups - groups)
    }
}

#[test]
fn ac3_a_frame_of_2000_textured_materials_costs_at_most_1_1_times_the_instructions_per_material_of_200() {
    if instructions().is_none() {
        panic!("INCONCLUSIVE: {ID}: this machine doesn't count instructions retired (macOS's proc_pid_rusage), so the ratio can't be read");
    }
    let (mut few, mut many) = (Side::new(FEW), Side::new(MANY));
    // Warm-up: three frames each; the first binds every material's maps.
    let mut made = [0u64; 2];
    for k in 0..3 {
        made[0] += few.frame(k * SECOND / 60).1;
        made[1] += many.frame(k * SECOND / 60).1;
    }
    // Guard: every material's maps are bound, one group a material at least.
    assert!(
        made[0] >= FEW as u64 && made[1] >= MANY as u64,
        "{ID}: the warm-up binds each material's maps: {} bind groups for {FEW} materials, {} for {MANY}",
        made[0],
        made[1]
    );
    let mut ratios = Vec::new();
    let mut rows = Vec::new();
    for round in 0..ROUNDS {
        let t = (10 + round as i64) * SECOND / 60;
        let (a, b) = if round % 2 == 0 {
            let a = few.frame(t).0;
            (a, many.frame(t).0)
        } else {
            let b = many.frame(t).0;
            (few.frame(t).0, b)
        };
        let ratio = (b as f64 / MANY as f64) / (a as f64 / FEW as f64);
        ratios.push(ratio);
        rows.push(format!("round {}: {a} instructions for {FEW}, {b} for {MANY}, ratio {ratio:.3}", round + 1));
    }
    no_errors(&few.device);
    no_errors(&many.device);
    let mut sorted = ratios.clone();
    sorted.sort_by(f64::total_cmp);
    let median = sorted[ROUNDS / 2];
    eprintln!("{ID}: median ratio {median:.3} over {ROUNDS} rounds:\n{}", rows.join("\n"));
    assert!(
        median <= LIMIT,
        "{ID}: a frame of {MANY} textured materials retires {median:.3} times the instructions per material of a frame of {FEW} (the median of {ROUNDS} alternated rounds), over {LIMIT}:\n{}",
        rows.join("\n")
    );
}
