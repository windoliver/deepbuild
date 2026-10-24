//! The handoff's conformance run (README: Calls, `conformance`): the platform's handoff against the
//! copy path on this machine, part by part, every image comparison through the blank guard. It
//! decides the surface's path for the rest of the run: zero copy on a pass, else the copy path at
//! 30 fps and a render scale of 0.5, with one health reading per part that didn't pass.

use std::collections::BTreeSet;

use deep_gpu::ring::{self, Mark};
use deep_gpu::surface::Path;
use serde_json::{json, Value};

use crate::frames::{self, Args, Capture, Frame};
use crate::reference::{self, Image};
use crate::scene::Scene;
use crate::worker::SLOTS;
use crate::{refused, App};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Part {
    Pass,
    Fail,
    Blocked,
}

impl Part {
    fn name(self) -> &'static str {
        match self {
            Part::Pass => "pass",
            Part::Fail => "fail",
            Part::Blocked => "blocked",
        }
    }
}

/// The handoff's budget at the fixture's size (issue #377): 1 ms at p95, 0.1 ms of it on the UI thread.
const HANDOFF_P95_MS: f64 = 1.;
const UI_P95_MS: f64 = 0.1;

fn blank(image: &image::RgbaImage) -> bool {
    crate::compare::blank_rgba(image.as_raw())
}

fn image(f: &Frame) -> Option<Image<'_>> {
    f.image.as_ref().map(|i| Image {
        size: [i.width(), i.height()],
        rgba: i.as_raw(),
    })
}

fn p95(mut xs: Vec<f64>) -> f64 {
    xs.sort_by(f64::total_cmp);
    let i = ((0.95 * xs.len() as f64).ceil() as usize).saturating_sub(1);
    xs.get(i).copied().unwrap_or(f64::INFINITY)
}

/// The page alone, captured: what the window holds under the view.
fn page(app: &mut App, scene_path: &str) -> Result<image::RgbaImage, Value> {
    let mut a = Args::new(scene_path, 1);
    a.layer = false;
    let mut run = frames::drive(app, "", &a, &|_| true)?;
    run.frames
        .pop()
        .and_then(|f| f.image)
        .ok_or_else(|| refused("no_capture", "the page"))
}

fn identical(app: &mut App, path: &str, scene: &Scene) -> Result<Part, Value> {
    let mut zero = Args::new(path, scene.frames);
    zero.path = Some(Path::ZeroCopy);
    zero.window_hash = true;
    let mut copy = zero.clone();
    copy.path = Some(Path::Copy);
    let z = frames::drive(app, "", &zero, &|_| false)?;
    let c = frames::drive(app, "", &copy, &|_| false)?;
    if z.frames.len() != c.frames.len() || z.frames.is_empty() {
        return Ok(Part::Fail);
    }
    for (a, b) in z.frames.iter().zip(&c.frames) {
        // The blank guard first: a blank window on either side can't be compared.
        if a.blank != Some(false) || b.blank != Some(false) {
            return Ok(Part::Blocked);
        }
        if a.pixel_hash != b.pixel_hash || a.window_hash != b.window_hash {
            return Ok(Part::Fail);
        }
    }
    Ok(Part::Pass)
}

fn premultiplied(app: &mut App, path: &str, scene: &Scene) -> Result<Part, Value> {
    let under = page(app, path)?;
    let mut a = Args::new(path, 1);
    a.path = Some(Path::ZeroCopy);
    let run = frames::drive(app, "", &a, &|_| true)?;
    let Some(f) = run.frames.first() else {
        return Ok(Part::Fail);
    };
    let Some(window) = f.image.as_ref() else {
        return Ok(Part::Fail);
    };
    if blank(&under) || blank(window) {
        return Ok(Part::Blocked);
    }
    let page = Image {
        size: [under.width(), under.height()],
        rgba: under.as_raw(),
    };
    let problems = reference::over_problems(scene, 0, scene.size, &image(f).expect("kept"), &page);
    Ok(if problems.is_empty() {
        Part::Pass
    } else {
        Part::Fail
    })
}

fn fences(app: &mut App, path: &str, count: u64) -> Result<Part, Value> {
    let mut a = Args::new(path, count);
    a.path = Some(Path::ZeroCopy);
    a.fences = true;
    a.hash = false;
    let run = frames::drive(app, "", &a, &|_| false)?;
    if ring::audit(&run.marks, SLOTS).is_err() {
        return Ok(Part::Fail);
    }
    // Every frame drawn once, in order, and shown.
    let drawn: Vec<u64> = run
        .marks
        .iter()
        .filter_map(|m| match m {
            Mark::Drawn { frame, .. } => Some(*frame),
            _ => None,
        })
        .collect();
    let shown: BTreeSet<u64> = run
        .marks
        .iter()
        .filter_map(|m| match m {
            Mark::Sampled { frame, .. } => Some(*frame),
            _ => None,
        })
        .collect();
    let every = drawn == (0..count).collect::<Vec<_>>() && (0..count).all(|n| shown.contains(&n));
    Ok(if every { Part::Pass } else { Part::Fail })
}

fn stale_or_torn(
    app: &mut App,
    path: &str,
    scene: &Scene,
    count: u64,
    loss: Option<u64>,
) -> Result<Part, Value> {
    let under = page(app, path)?;
    if blank(&under) {
        return Ok(Part::Blocked);
    }
    let every = scene.resize.as_ref().map_or(0, |(e, _)| *e);
    let mut around: BTreeSet<u64> = BTreeSet::new();
    if every > 0 {
        let mut r = every;
        while r < count {
            around.extend([r - 1, r, r + 1]);
            r += every;
        }
    }
    if let Some(l) = loss {
        around.extend([l.saturating_sub(1), l + 1, l + 2]);
    }
    let mut zero = Args::new(path, count);
    zero.path = Some(Path::ZeroCopy);
    zero.resize = scene.resize.is_some();
    zero.lose_at = loss;
    zero.window_hash = true;
    zero.capture = Capture::None;
    let mut copy = zero.clone();
    copy.path = Some(Path::Copy);
    let keep = |n: u64| around.contains(&n);
    let z = frames::drive(app, "", &zero, &keep)?;
    let c = frames::drive(app, "", &copy, &|_| false)?;
    let page = Image {
        size: [under.width(), under.height()],
        rgba: under.as_raw(),
    };
    let mut seen = Vec::new();
    for f in &z.frames {
        seen.push(f.frame);
        let size = scene.size_at(f.frame, zero.resize);
        if f.size != size
            || f.pixel_hash.as_deref()
                != Some(&frames::hex(&reference::frame(scene, f.frame, size)))
        {
            return Ok(Part::Fail);
        }
        if let Some(other) = c.frames.iter().find(|x| x.frame == f.frame) {
            if other.window_hash != f.window_hash {
                return Ok(Part::Fail);
            }
        }
        if let Some(img) = image(f) {
            if blank(f.image.as_ref().expect("kept")) {
                return Ok(Part::Blocked);
            }
            if !reference::stale_problems(scene, f.frame, size, &img, &page).is_empty() {
                return Ok(Part::Fail);
            }
        }
    }
    // Every frame presented, in order, but the one the device was lost in.
    let want: Vec<u64> = (0..count).filter(|n| Some(*n) != loss).collect();
    let presented: Vec<u64> = seen.iter().copied().filter(|n| Some(*n) != loss).collect();
    Ok(if presented == want {
        Part::Pass
    } else {
        Part::Fail
    })
}

fn budget(app: &mut App, path: &str, scene: &Scene) -> Result<Part, Value> {
    let mut a = Args::new(path, scene.frames);
    a.path = Some(Path::ZeroCopy);
    a.timings = true;
    a.hash = false;
    let run = frames::drive(app, "", &a, &|_| false)?;
    let handoff: Vec<f64> = run.frames.iter().filter_map(|f| f.handoff_ms).collect();
    let ui: Vec<f64> = run.frames.iter().filter_map(|f| f.ui_ms).collect();
    if handoff.is_empty() {
        return Ok(Part::Fail);
    }
    Ok(if p95(handoff) <= HANDOFF_P95_MS && p95(ui) <= UI_P95_MS {
        Part::Pass
    } else {
        Part::Fail
    })
}

pub fn call(app: &mut App, _out: &str, call: &Value) -> Value {
    let Some(path) = call["scene"].as_str() else {
        return refused("bad_input", "conformance takes a scene");
    };
    let scene = match app.scene(path) {
        Ok(s) => s,
        Err(e) => return e,
    };
    let run = |app: &mut App| -> Result<Vec<(&'static str, Part)>, Value> {
        let fence_frames = scene.fence_frames.unwrap_or(scene.frames);
        let stale_frames = scene.stale_frames.unwrap_or(scene.frames);
        Ok(vec![
            ("identical", identical(app, path, &scene)?),
            ("premultiplied", premultiplied(app, path, &scene)?),
            ("fences", fences(app, path, fence_frames)?),
            (
                "stale_or_torn",
                stale_or_torn(app, path, &scene, stale_frames, scene.device_loss_at)?,
            ),
            ("budget", budget(app, path, &scene)?),
        ])
    };
    let parts = match run(app) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let result = if parts.iter().any(|(_, p)| *p == Part::Fail) {
        Part::Fail
    } else if parts.iter().any(|(_, p)| *p == Part::Blocked) {
        Part::Blocked
    } else {
        Part::Pass
    };
    let d = &mut app.decision;
    d.readings = parts
        .iter()
        .filter(|(_, p)| *p != Part::Pass)
        .map(|(name, p)| json!({"code": if *p == Part::Fail { "handoff_part_failed" } else { "handoff_part_blocked" }, "part": name}))
        .collect();
    if result == Part::Pass {
        d.path = Path::ZeroCopy;
        d.fps_cap = None;
        d.internal_scale = 1.;
    } else {
        d.path = Path::Copy;
        d.fps_cap = Some(30);
        d.internal_scale = 0.5;
    }
    json!({
        "platform": if cfg!(target_os = "macos") { "macos" } else { std::env::consts::OS },
        "result": result.name(),
        "parts": parts.iter().map(|(name, p)| json!({"part": name, "result": p.name()})).collect::<Vec<_>>(),
        "path": d.path.name(),
    })
}
