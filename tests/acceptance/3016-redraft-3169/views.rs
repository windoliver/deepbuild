//! #3016's tests that read surfaces the merge base lacks (README: Surfaces): criterion 2 (each pipeline made once for
//! the scene and the environment filtered once, read from each view's pipeline log and `env_builds`) and the five
//! planted wrong programs criteria 2, 5, 6 and 7 name, each set as a `Planted` field, as the proof binary's
//! `--planted` sets it. At the merge base this file doesn't compile, naming the missing surfaces (BASE-FAILURE.txt).
//! Written blind from the issue, the design and the base.
//!
//! #3169's blind redraft (README): every test here is the first draft's, unchanged on macOS. Built for any other
//! target, the two that read Metal's allocated size or the reference Mac's hash are ignored with a reason naming what
//! they need, which the unit lane reads INCONCLUSIVE (platform); the rest run there as before.

#[path = "../3016/fixture.rs"]
mod fixture;

use std::collections::BTreeMap;
use std::sync::Mutex;

use deep_canvas_scene3d::scene::Scene;
use deep_gpu::device::{Backend, Gpu};
use deep_scene3d_render::{Planted, Renderer};
use fixture::*;
use serde_json::json;

const AC2: &str = "AC2 #3016.af11fa84";
const AC5: &str = "AC5 #3016.548510a3";
const AC6: &str = "AC6 #3016.bac3f522";
const AC7: &str = "AC7 #3016.a8b1d957";

static TURN: Mutex<()> = Mutex::new(());

/// Criterion 2's reading of one scene, opened as the live view opens one: a fresh renderer on a fresh noop device
/// prepares it in the warm-up at check, then draws its first frame. Each failure names the pipeline or the builds.
fn pipelines_once(scene: &Scene, planted: Planted, plain_env: Option<u32>) -> (Vec<String>, u32) {
    let gpu = Gpu::open(Backend::Noop).expect("the noop backend opens");
    let device = gpu.device();
    let mut r = Renderer::new(&device, planted);
    r.log.warming = true;
    r.prepare(&device, scene, &look());
    r.log.warming = false;
    let warmed: BTreeMap<String, usize> = std::iter::once(("view".to_string(), r.log.made().count()))
        .chain(r.second_views().into_iter().map(|(n, _, log)| (n, log.made().count())))
        .collect();
    r.log.begin_frame();
    draw(&device, &mut r, scene);
    let mut failures = Vec::new();
    // Every view's log: the view's own, then each view it draws beside it.
    let mut logs = vec![("view".to_string(), &r.log, r.counts())];
    logs.extend(r.second_views().into_iter().map(|(n, c, log)| (n, log, c)));
    let mut seen: BTreeMap<u128, Vec<String>> = BTreeMap::new();
    let mut about: BTreeMap<u128, String> = BTreeMap::new();
    for (name, log, _) in &logs {
        for (k, c) in log.made().enumerate() {
            seen.entry(c.key).or_default().push(name.clone());
            about.entry(c.key).or_insert_with(|| format!("feature set `{}`, target `{}`, made for {:?}", c.feature_set, c.target, c.items));
            if k >= warmed.get(name).copied().unwrap_or(0) {
                failures.push(format!("pipeline {:032x} ({}, target `{}`) made at the first frame by {name}, not at check", c.key, c.feature_set, c.target));
            }
        }
    }
    for (key, by) in &seen {
        if by.len() > 1 {
            failures.push(format!("pipeline {key:032x} ({}) made {} times: by {}", about[key], by.len(), by.join(", ")));
        }
    }
    // Guard: the view made its pipelines, and each view drew its items.
    assert!(!seen.is_empty(), "{AC2}: no pipeline was made: the log reads nothing");
    for (name, _, counts) in &logs {
        let meshes = counts.draws.iter().filter(|d| d.0.starts_with("mesh")).count();
        assert!(meshes >= 4, "{AC2}: {name} draws the four meshes: it drew {:?}", counts.draws.iter().map(|d| &d.0).collect::<Vec<_>>());
    }
    let builds: u32 = logs.iter().map(|(_, _, c)| c.env_builds).sum();
    let per_view: Vec<String> = logs.iter().map(|(n, _, c)| format!("{n} {}", c.env_builds)).collect();
    if let Some(plain) = plain_env {
        if builds != plain {
            failures.push(format!("the environment is filtered {builds} times ({}); the plain scene filters it {plain}", per_view.join(", ")));
        }
    }
    (failures, builds)
}

/// The second views each heavy scene draws beside the view.
fn second_names(views: Views) -> Vec<String> {
    match views {
        Views::Plain | Views::EyeInset => Vec::new(),
        Views::Mirror => vec!["mirror".into()],
        Views::MirrorInsets => {
            let mut v = vec!["mirror".to_string()];
            for id in INSETS {
                v.push(format!("inset {id}"));
                v.push(format!("inset {id} mirror"));
            }
            v
        }
    }
}

/// Criterion 2: in the three heavy scenes each pipeline is made once for its feature set, target and sample count,
/// and the environment is filtered once.
#[test]
fn ac2_each_pipeline_is_made_once_and_the_environment_filtered_once() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let (plain_failures, plain_env) = pipelines_once(&heavy(Views::Plain), Planted::default(), None);
    assert!(plain_failures.is_empty(), "{AC2}: the plain scene:\n  {}", plain_failures.join("\n  "));
    assert!(plain_env >= 1, "{AC2}: the plain scene filters its environment: env_builds is {plain_env}");
    let mut failures = Vec::new();
    for views in [Views::Mirror, Views::MirrorInsets] {
        let scene = heavy(views);
        let gpu = Gpu::open(Backend::Noop).expect("the noop backend opens");
        let device = gpu.device();
        let mut r = Renderer::new(&device, Planted::default());
        draw(&device, &mut r, &scene);
        let mut names: Vec<String> = r.second_views().into_iter().map(|(n, _, _)| n).collect();
        names.sort();
        let mut want = second_names(views);
        want.sort();
        assert_eq!(names, want, "{AC2}: {views:?}: the views drawn beside the view");
        let (f, _) = pipelines_once(&scene, Planted::default(), Some(plain_env));
        failures.extend(f.into_iter().map(|f| format!("{views:?}: {f}")));
    }
    assert!(failures.is_empty(), "{AC2}:\n  {}", failures.join("\n  "));
}

/// Criterion 2's planted renderer: the mirror's view compiles its own pipelines at its first frame.
#[test]
fn ac2_planted_mirror_compiles_its_own_pipelines_fails_naming_the_pipeline() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let (_, plain_env) = pipelines_once(&heavy(Views::Plain), Planted::default(), None);
    let planted = Planted { mirror_compiles_own: true, ..Default::default() };
    let (failures, _) = pipelines_once(&heavy(Views::Mirror), planted, Some(plain_env));
    assert!(failures.iter().any(|f| f.starts_with("pipeline ")), "{AC2}: the planted mirror_compiles_own passes the check: {failures:?}");
}

/// Criterion 5's first planted renderer: whether the mirror draws `odd`, which only the mirror sees.
fn mirror_draws_odd(planted: Planted) -> Vec<String> {
    let gpu = Gpu::open(Backend::Gpu).unwrap_or_else(|e| panic!("{AC5}: BLOCKED: no Metal device: {e}"));
    let device = gpu.device();
    let (with, without) = (mirror_cull(true), mirror_cull(false));
    assert!(with.layers.iter().any(|l| l.solids.len() > 256), "{AC5}: the layer is culled on the GPU");
    let frame = |s: &Scene| {
        let mut r = Renderer::new(&device, planted);
        let f = deep_scene3d_render::draw_offscreen(&device, &mut r, s, &look(), None).expect("Metal draws pixels");
        assert!(r.mirror_px().is_some(), "{AC5}: the mirror draws");
        f
    };
    if frame(&with) == frame(&without) {
        vec!["the mirror doesn't draw `odd`, an item only the mirror sees: the frame is the same without it".into()]
    } else {
        Vec::new()
    }
}

#[test]
fn ac5_a_mirror_draws_what_only_it_sees() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let failures = mirror_draws_odd(Planted::default());
    assert!(failures.is_empty(), "{AC5}:\n  {}", failures.join("\n  "));
}

#[test]
fn ac5_planted_mirror_takes_the_views_culled_lists_fails_naming_the_item() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let failures = mirror_draws_odd(Planted { mirror_takes_view_cull: true, ..Default::default() });
    assert!(failures.iter().any(|f| f.contains("`odd`")), "{AC5}: the planted mirror_takes_view_cull passes: {failures:?}");
}

#[test]
#[cfg_attr(not(target_os = "macos"), ignore = "INCONCLUSIVE (platform): needs Metal on the reference Mac (Mac17,10) that drew the merge base's hash: a same-machine hash can't be compared off it")]
fn ac5_planted_inset_takes_the_views_cascades_fails_naming_the_frame() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let gpu = Gpu::open(Backend::Gpu).unwrap_or_else(|e| panic!("{AC5}: BLOCKED: no Metal device: {e}"));
    let device = gpu.device();
    let failures = inset_frame_failures(&device, Planted { inset_takes_view_cascades: true, ..Default::default() });
    assert!(failures.iter().any(|f| f.starts_with("frame 0")), "{AC5}: the planted inset_takes_view_cascades passes: {failures:?}");
}

/// Criterion 6's planted cache: 70 items of their own small meshes (past the mesh cache's 64 entries), a mirror floor
/// and a view inset that keeps every item but `item69`. A still scene's second and third frames build no mesh in any
/// view and upload none.
fn nothing_rebuilt(planted: Planted) -> Vec<String> {
    let mut items = base_items(Views::Mirror);
    items.push(("box_mat".into(), json!({"kind": "material@1", "params": {"base_color": [0.7, 0.45, 0.3, 1], "roughness": 0.6}})));
    for k in 0..70 {
        let (x, z) = ((k % 10) as f64 - 4.5, (k / 10) as f64 - 3.0);
        items.push((format!("item{k:02}"), json!({"kind": "mesh.asset@1", "params": {"sha256": small_sha(k), "node": 0}, "at": {"pos": [x, 0.3, z]}, "material": "box_mat"})));
    }
    items.push(("pip_cam".into(), camera([6.0, 3.0, 4.0], [0.0, 0.4, 0.0])));
    items.push(("pip_display".into(), json!({"kind": "display@1", "params": {"size": [0.8, 0.5], "bezel": 0.02}, "at": {"pos": [0, 1.6, -5]}, "material": "screen_mat"})));
    items.push(("pip".into(), json!({"kind": "inset@1", "params": {"face": "pip_display#screen", "size": [0.76, 0.46], "px_per_unit": 400, "view": {"camera": "pip_cam", "exclude": ["odd"]}}})));
    let scene = fixture::scene(&doc(items, json!({"collections": {"odd": {"members": ["item69"]}}})));
    assert!(shapes(&scene).len() > 64, "{AC6}: the scene's meshes are past the cache's 64 entries");
    assert!(scene.views.len() == 1 && scene.mirror.is_some(), "{AC6}: a mirror and a view inset");
    let gpu = Gpu::open(Backend::Noop).expect("the noop backend opens");
    let device = gpu.device();
    let mut r = Renderer::new(&device, planted);
    draw(&device, &mut r, &scene);
    let mut failures = Vec::new();
    for frame in 2..=3 {
        let before = device.device.counts().read();
        draw(&device, &mut r, &scene);
        let up = device.device.counts().read().since(before).uploaded;
        let mut built = vec![format!("view {}", r.counts().meshes_built)];
        let mut total = r.counts().meshes_built;
        // What each view drew this frame, by item, against the view's.
        let main: Vec<String> = r.counts().draws.iter().map(|d| d.0.clone()).collect();
        let mut partial = Vec::new();
        for (name, counts, _) in r.second_views() {
            built.push(format!("{name} {}", counts.meshes_built));
            total += counts.meshes_built;
            let drew: Vec<&String> = counts.draws.iter().map(|d| &d.0).collect();
            for item in &main {
                if !drew.contains(&item) && (item.starts_with("item") || item == "floor") {
                    partial.push(format!("`{item}` (drawn by the view, not by {name})"));
                }
            }
        }
        if total > 0 {
            failures.push(format!(
                "frame {frame} of a still scene builds {total} meshes again ({}), uploading {up} B: a mesh a view drew last frame was freed; the meshes some view draws and another doesn't: {}",
                built.join(", "),
                partial.join(", ")
            ));
        }
    }
    failures
}

#[test]
fn ac6_a_mesh_any_view_drew_this_turn_is_kept() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let failures = nothing_rebuilt(Planted::default());
    assert!(failures.is_empty(), "{AC6}:\n  {}", failures.join("\n  "));
}

#[test]
fn ac6_planted_cache_freeing_by_the_last_views_turn_fails_naming_the_mesh() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let failures = nothing_rebuilt(Planted { frees_by_last_turn: true, ..Default::default() });
    assert!(failures.iter().any(|f| f.contains("`item69`") || f.contains("`floor`")), "{AC6}: the planted frees_by_last_turn passes: {failures:?}");
}

/// Criterion 7's planted estimate, which counts the maps once per view: against the device's peak for the third
/// scene it fails, naming the bytes.
#[test]
#[cfg_attr(not(target_os = "macos"), ignore = "INCONCLUSIVE (platform): needs Metal: the device's peak is Metal's currentAllocatedSize, which deep_gpu::memory::allocated reads only on macOS")]
fn ac7_planted_estimate_counting_the_maps_per_view_fails_naming_the_bytes() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let gpu = Gpu::open(Backend::Gpu).unwrap_or_else(|e| panic!("{AC7}: BLOCKED: no Metal device: {e}"));
    let device = gpu.device();
    let scene = heavy(Views::MirrorInsets);
    let (dev, r) = held_on(&device, &scene, 2, Planted::default());
    drop(r);
    let planted = Planted { estimate_maps_per_view: true, ..Default::default() };
    let est = estimate_bytes(deep_scene3d_render::held::of_planted(&scene, &planted), &scene);
    let shipped = estimate_bytes(deep_scene3d_render::held::of(&scene), &scene);
    assert!(est > shipped, "{AC7}: the planted estimate counts more than the shipped one ({est} B against {shipped} B)");
    assert!(
        est.abs_diff(dev) as f64 > 0.1 * dev as f64,
        "{AC7}: the planted estimate, {est} B ({:.1} MiB), is within 10% of the device's peak, {dev} B ({:.1} MiB)",
        mib(est),
        mib(dev)
    );
}
