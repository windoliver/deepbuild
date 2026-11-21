//! #3016's criteria on the noop lane read through surfaces the merge base has (README): criterion 1 (the bytes the
//! three heavy scenes upload, from the counted device), criterion 6 (a view inset that keeps two of ten items, from the
//! counted device and the caches' gauges), criterion 9 (the design's Cost lines), and the device-side reading
//! criterion 8's `query.test.ts` compares `deep_query` with. Written blind from the issue, the design and the base.
//! The caches' gauges sum every holder in the process, so the tests that read them take turns.

#[path = "fixture.rs"]
mod fixture;

use std::sync::Mutex;

use deep_gpu::device::{Backend, Gpu};
use deep_scene3d_render::{Planted, Renderer};
use fixture::*;
use serde_json::json;

const AC1: &str = "AC1 #3016.f4add153";
const AC6: &str = "AC6 #3016.bac3f522";
const AC8: &str = "AC8 #3016.102eb480";
const AC9: &str = "AC9 #3016.b66dee2c";

static TURN: Mutex<()> = Mutex::new(());

/// The bytes the counted device uploads while a fresh renderer on a fresh noop device opens `scene` and draws its
/// first frame, with the renderer left for the caller to read.
fn opened(scene: &deep_canvas_scene3d::scene::Scene) -> (u64, Renderer, std::sync::Arc<Gpu>) {
    let gpu = Gpu::open(Backend::Noop).expect("the noop backend opens");
    let device = gpu.device();
    let before = device.device.counts().read();
    let mut renderer = Renderer::new(&device, Planted::default());
    draw(&device, &mut renderer, scene);
    let up = device.device.counts().read().since(before).uploaded;
    (up, renderer, gpu)
}

/// Criterion 1: plain, with a mirror, and with a mirror and two view insets that keep every item, the second and
/// third upload at most 1.05 times what the plain one uploads.
#[test]
fn ac1_a_mirror_and_two_view_insets_upload_the_scene_once() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let mesh_bytes = |s: &deep_canvas_scene3d::scene::Scene| -> u64 {
        // What the meshes' vertices hold at the least: three f32 positions a vertex, and u32 indices.
        let v = u64::from((GRID[0] + 1) * (GRID[1] + 1));
        let _ = s;
        4 * (v * 12 + TRIANGLES * 12)
    };
    let mut ups = Vec::new();
    for views in [Views::Plain, Views::Mirror, Views::MirrorInsets] {
        let scene = heavy(views);
        // The scene is what the criterion names.
        let heavy_solids = scene.layers.iter().flat_map(|l| &l.solids).filter(|s| s.id.starts_with("mesh")).count();
        assert_eq!(heavy_solids, 4, "{AC1}: {views:?}: the four meshes are drawn");
        assert!(scene.cascaded() && scene.sky.as_ref().is_some_and(|s| s.environment.is_some()), "{AC1}: {views:?}: under a cascaded sun and an environment");
        assert_eq!(scene.mirror.is_some(), views != Views::Plain, "{AC1}: {views:?}: the mirror");
        let n = if views == Views::MirrorInsets { 2 } else { 0 };
        assert_eq!(scene.views.len(), n, "{AC1}: {views:?}: view insets");
        assert!(scene.views.iter().all(|v| v.keep.is_none() && v.eye.is_none()), "{AC1}: each view inset keeps every item");
        let (up, renderer, _gpu) = opened(&scene);
        if views == Views::Plain {
            // Guard: the plain scene uploads its meshes and binds its maps.
            let floor = 4 * map_bytes(MAP_PX, MAP_MIPS) + mesh_bytes(&scene);
            assert!(up >= floor, "{AC1}: the plain scene uploads {up} B, under its four maps and meshes' {floor} B: a map or a mesh isn't uploaded");
        } else {
            assert!(renderer.mirror_px().is_some(), "{AC1}: {views:?}: the mirror's picture is drawn");
        }
        if views == Views::MirrorInsets {
            let drawn: Vec<&str> = renderer.counts().draws.iter().map(|d| d.0.as_str()).collect();
            for id in INSETS {
                assert!(drawn.contains(&id), "{AC1}: the view draws view inset `{id}`'s window; it drew {drawn:?}");
            }
        }
        ups.push((views, up));
    }
    let plain = ups[0].1;
    let over: Vec<String> = ups[1..]
        .iter()
        .filter(|(_, up)| *up as f64 > 1.05 * plain as f64)
        .map(|(v, up)| format!("{v:?} uploads {up} B ({:.1} MiB), {:.2} × the plain scene's {plain} B ({:.1} MiB); the limit is 1.05 ×", mib(*up), *up as f64 / plain as f64, mib(plain)))
        .collect();
    assert!(over.is_empty(), "{AC1}:\n  {}", over.join("\n  "));
}

/// Ten items, each a small mesh of its own with a 256 px map of its own, under the heavy scene's sun and sky; with
/// `inset`, a view inset that keeps two of them.
fn ten(inset: bool) -> deep_canvas_scene3d::scene::Scene {
    let mut items = base_items(Views::Plain);
    for k in 0..10 {
        items.push((format!("mat{k}"), json!({"kind": "material@1", "params": {"base_color": [1, 1, 1, 1], "roughness": 0.5, "maps": {"base_color": map_sha(k)}}})));
        let x = -4.5 + k as f64;
        items.push((format!("item{k}"), json!({"kind": "mesh.asset@1", "params": {"sha256": small_sha(k), "node": 0}, "at": {"pos": [x, 0.4, 0]}, "material": format!("mat{k}")})));
    }
    let mut extra = json!({});
    if inset {
        items.push(("pip_cam".into(), camera([6.0, 3.0, 4.0], [0.0, 0.4, 0.0])));
        items.push(("pip_display".into(), json!({"kind": "display@1", "params": {"size": [0.8, 0.5], "bezel": 0.02}, "at": {"pos": [0, 1.6, -3]}, "material": "screen_mat"})));
        items.push(("pip".into(), json!({"kind": "inset@1", "params": {"face": "pip_display#screen", "size": [0.76, 0.46], "px_per_unit": 400, "view": {"camera": "pip_cam", "include": ["kept"]}}})));
        extra = json!({"collections": {"kept": {"members": ["item3", "item7"]}}});
    } else {
        // The display stays, so the view draws the same items with and without the inset but its window.
        items.push(("pip_display".into(), json!({"kind": "display@1", "params": {"size": [0.8, 0.5], "bezel": 0.02}, "at": {"pos": [0, 1.6, -3]}, "material": "screen_mat"})));
    }
    let mut s = fixture::scene(&doc(items, extra));
    let t = texels(256, 9);
    for k in 0..10 {
        s.texels.insert(map_sha(k), t.clone());
    }
    s
}

/// Criterion 6: a view inset that keeps two of ten items uploads no mesh and no map the view doesn't draw, and frees
/// none the view still draws when it is removed.
#[test]
fn ac6_a_view_inset_keeping_two_of_ten_items_holds_no_mesh_or_map_of_its_own() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let (with, without) = (ten(true), ten(false));
    assert_eq!(with.views.len(), 1, "{AC6}: one view inset");
    let kept = with.views[0].keep.clone().unwrap_or_default();
    assert!(kept.contains("item3") && kept.contains("item7") && kept.len() == 2, "{AC6}: the inset keeps item3 and item7: {kept:?}");
    let gpu = Gpu::open(Backend::Noop).expect("the noop backend opens");
    let device = gpu.device();
    let (meshes0, maps0) = (gauge("Renderer::meshes"), gauge("Store::textures"));
    let mut renderer = Renderer::new(&device, Planted::default());
    draw(&device, &mut renderer, &with);
    let held = |at: (u64, u64)| {
        let (m, t) = (gauge("Renderer::meshes"), gauge("Store::textures"));
        ((m.0 - at.0, m.1 - at.1), (t.0 - maps0.0, t.1 - maps0.1))
    };
    // What the view draws: each solid's mesh once, and each item's map once.
    let view_meshes = shapes(&with).len() as u64;
    let ((m_n, m_b), (t_n, t_b)) = held(meshes0);
    let mut failures = Vec::new();
    // Guard: the view's own meshes and maps are there.
    assert!(t_n >= 10 && m_n >= 10, "{AC6}: the view holds its ten meshes and maps: {m_n} meshes, {t_n} maps");
    if m_n != view_meshes {
        failures.push(format!("with the inset the device holds {m_n} meshes ({m_b} B), the view draws {view_meshes}: {} more", m_n as i64 - view_meshes as i64));
    }
    if t_n != 10 {
        failures.push(format!("with the inset the device holds {t_n} maps ({t_b} B, {:.2} MiB), the view draws 10: {} more", mib(t_b), t_n as i64 - 10));
    }
    // The inset is removed: nothing the view still draws is freed, so nothing is built or uploaded again.
    for frame in 1..=2 {
        let before = device.device.counts().read();
        draw(&device, &mut renderer, &without);
        let up = device.device.counts().read().since(before).uploaded;
        let built = renderer.counts().meshes_built;
        let ((n, _), (tn, _)) = held(meshes0);
        let small_map = map_bytes(256, 9);
        if built > 0 || up >= small_map {
            failures.push(format!("frame {frame} after the inset was removed builds {built} meshes and uploads {up} B (a map is {small_map} B): something the view still draws was freed"));
        }
        if n < shapes(&without).len() as u64 || tn < 10 {
            failures.push(format!("frame {frame} after the inset was removed holds {n} meshes and {tn} maps; the view draws {} and 10", shapes(&without).len()));
        }
    }
    assert!(failures.is_empty(), "{AC6}:\n  {}", failures.join("\n  "));
}

/// Criterion 8's device side: what the device holds for each of the third scene's meshes and maps, read from the
/// caches' gauges (Renderer::meshes, Store::textures: the bytes their holders keep on the device) once its first
/// frame is drawn, divided among the four of each kind, which are one size. `query.test.ts` runs this and compares
/// `deep_query`'s rows with the line it prints.
#[test]
#[ignore = "criterion 8's reading: run by tests/acceptance/3016/query.test.ts"]
fn ac8_device_bytes_reading() {
    let _turn = TURN.lock().unwrap_or_else(|e| e.into_inner());
    let scene = heavy(Views::MirrorInsets);
    let (meshes0, maps0) = (gauge("Renderer::meshes"), gauge("Store::textures"));
    let (_, renderer, _gpu) = opened(&scene);
    let (m, t) = (gauge("Renderer::meshes"), gauge("Store::textures"));
    let (mesh_n, mesh_b, map_n, map_b) = (m.0 - meshes0.0, m.1 - meshes0.1, t.0 - maps0.0, t.1 - maps0.1);
    // The floor plate and the displays' meshes are the view's too; they are a few KiB beside 4 MiB meshes.
    let line = json!({"criterion": AC8, "meshes": {"entries": mesh_n, "bytes": mesh_b}, "maps": {"entries": map_n, "bytes": map_b},
                      "per_mesh": mesh_b as f64 / 4.0, "per_map": map_b as f64 / 4.0, "mirror": renderer.mirror_px().is_some()});
    println!("ACCEPTANCE_3016_AC8 {line}");
}

/// Criterion 9: the Cost lines of Material: mirror, Inset and Look: regions and edges say what a second view holds,
/// and the design names the lane's passes.
#[test]
fn ac9_the_cost_lines_say_what_a_second_view_holds() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../docs/canvas-primitives.md");
    let text = std::fs::read_to_string(path).expect("the design reads");
    let section = |heading: &str| -> String {
        let start = text.find(heading).unwrap_or_else(|| panic!("{AC9}: the design has `{heading}`"));
        let rest = &text[start + heading.len()..];
        let end = rest.find("\n#### ").or_else(|| rest.find("\n### ")).unwrap_or(rest.len());
        rest[..end].to_string()
    };
    let mut failures = Vec::new();
    for heading in ["#### Material: mirror", "#### Inset", "#### Look `look@1`: regions and edges"] {
        let s = section(heading);
        let Some(cost) = s.lines().find(|l| l.starts_with("**Cost:**")) else {
            failures.push(format!("{heading}: no Cost line"));
            continue;
        };
        let lower = cost.to_lowercase();
        // What a second view holds: its own targets (and stored samples), and the scene's resources held once, not
        // again for the view.
        let own = lower.contains("target");
        let once = ["once", "shares", "shared", "not again", "no second copy", "never again"].iter().any(|w| lower.contains(w));
        let holds = lower.contains("hold");
        if !(own && once && holds) {
            failures.push(format!("{heading}: its Cost line doesn't say what a second view holds (its own targets, the scene's resources once): {cost}"));
        }
    }
    // The `design links and names` lane (scripts/lanes.mjs) passes: every link the design holds points at a heading or
    // anchor, and every name the open issues give is in the design. It reads the open issues with gh, so offline it
    // can't decide, which is BLOCKED, never PASS.
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../..");
    let lane = std::process::Command::new("node").arg("scripts/design-links.mjs").current_dir(root).output();
    match lane {
        Err(e) => panic!("{AC9}: BLOCKED: node could not run scripts/design-links.mjs: {e}"),
        Ok(out) if !out.status.success() => {
            let text = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
            if text.contains("BLOCKED") || text.to_lowercase().contains("offline") {
                failures.push(format!("BLOCKED: the design links and names lane couldn't read the issues:\n{text}"));
            } else {
                failures.push(format!("the design links and names lane fails:\n{text}"));
            }
        }
        Ok(_) => {}
    }
    assert!(failures.is_empty(), "{AC9}:\n  {}", failures.join("\n  "));
}
