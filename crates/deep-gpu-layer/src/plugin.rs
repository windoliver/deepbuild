//! The plug-in fixture (README: The plug-in fixture): a plug-in beside a live GPU-layer view. Its
//! panel runs in the app's panel runtime (gpui-shell with the app's registry and the `deepbuild`
//! module), which offers no GPU and no drawing surface; its documents go to the canvas core as the
//! plug-in's revisions, which carry descriptions, never pixels, surfaces or shaders.

use std::path::{Path, PathBuf};

use deep_canvas::registry::{BuildSet, Registry, Sealed};
use deep_canvas::show::{stamp, Writer, WriterKind};
use deep_gpu::device::Gpu;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use serde_json::{json, Value};

use crate::frames::{self, Args};
use crate::{refused, App, Planted};

/// The plug-in's panel, copied out to a folder of its own (the runtime writes its typings beside
/// an application it loads). The planted runtime runs it with a global `deepGpu` holding the GPU
/// layer's device and surface, set before the panel's own code runs.
fn entry(dir: &Path, planted: Option<(&str, &str)>) -> Result<PathBuf, String> {
    let to = std::env::temp_dir().join(format!("deep-gpu-plugin-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&to);
    std::fs::create_dir_all(&to).map_err(|e| e.to_string())?;
    let Some((device, surface)) = planted else {
        std::fs::copy(dir.join("main.js"), to.join("main.js")).map_err(|e| e.to_string())?;
        return Ok(to);
    };
    std::fs::copy(dir.join("main.js"), to.join("probe.js")).map_err(|e| e.to_string())?;
    let entry = format!(
        "globalThis.deepGpu = {{ device: {device:?}, surface: {surface:?} }};\nexport {{ default }} from \"./probe.js\";\n"
    );
    std::fs::write(to.join("main.js"), entry).map_err(|e| e.to_string())?;
    Ok(to)
}

/// The shipped build's canvas modules, sealed, as `deep_show` checks a writer's document in it.
fn shipped() -> Option<Sealed> {
    [
        deep_canvas_marks::modules::text(),
        deep_canvas_marks::modules::look(),
        deep_canvas_marks::modules::marks2d(),
        deep_canvas_motion::module::module(),
    ]
    .into_iter()
    .fold(Registry::new(BuildSet::Full), Registry::with)
    .seal()
    .ok()
}

/// Every text the panel's script described, in tree order.
fn texts(tree: &str) -> Vec<String> {
    tree.lines()
        .filter_map(|line| line.trim_start().strip_prefix("text \""))
        .filter_map(|rest| rest.strip_suffix('"'))
        .map(|t| t.replace("\\\"", "\"").replace("\\\\", "\\"))
        .collect()
}

struct Host {
    view: Option<Entity<gpui_shell::ScriptView>>,
}

impl Render for Host {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div().size_full().children(self.view.clone())
    }
}

fn panel(app: &mut App, dir: &Path) -> Value {
    let runtime = match deep_app::new_runtime() {
        Ok(r) => r,
        Err(e) => return json!({"loaded": false, "error": e.to_string(), "text": []}),
    };
    let mut error = None;
    let opened = app.cx.update(|cx| {
        open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(Bounds {
                    origin: Point::default(),
                    size: size(px(480.), px(1200.)),
                })),
                focus: false,
                show: false,
                ..Default::default()
            },
            cx,
            |window, cx| {
                let view = match deep_app::mount_panel(&runtime, dir, window, cx) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        error = Some(format!("{e:#}"));
                        None
                    }
                };
                cx.new(|_| Host { view })
            },
        )
    });
    let Ok((handle, host)) = opened else {
        return json!({"loaded": false, "error": "no window", "text": []});
    };
    let tree = app
        .cx
        .update_window(handle, |_, window, cx| {
            window.render_frame(cx);
            let view = host.read(cx).view.clone()?;
            let view = view.read(cx);
            if view.build_error().is_some() {
                return None;
            }
            view.snapshot().map(|s| s.debug_tree())
        })
        .ok()
        .flatten();
    let _ = app
        .cx
        .update_window(handle, |_, window, _| window.remove_window());
    match tree {
        Some(tree) => json!({"loaded": true, "text": texts(&tree)}),
        None => json!({"loaded": false, "error": error, "text": []}),
    }
}

pub fn call(app: &mut App, call: &Value) -> Value {
    let (Some(dir), Some(scene)) = (call["dir"].as_str(), call["scene"].as_str()) else {
        return refused("bad_input", "plugin takes a dir and a scene");
    };
    let dir = Path::new(dir);
    let fixture: Value = match std::fs::read_to_string(dir.join("documents.json")) {
        Ok(t) => serde_json::from_str(&t).unwrap_or(Value::Null),
        Err(e) => return refused("bad_input", e.to_string()),
    };
    // The live view beside the plug-in.
    let before = match frames::drive(app, "", &Args::new(scene, 2), &|_| false) {
        Ok(r) => r.frames.len(),
        Err(e) => return e,
    };
    let planted = (app.planted == Some(Planted::ExposesGpuToPanels))
        .then_some(("metal", app.decision.path.name()));
    let entry = match entry(dir, planted) {
        Ok(p) => p,
        Err(e) => return refused("bad_input", e),
    };
    let panel = panel(app, &entry);
    let _ = std::fs::remove_dir_all(&entry);
    let after = match frames::drive(app, "", &Args::new(scene, 2), &|_| false) {
        Ok(r) => r.frames.len(),
        Err(e) => return e,
    };
    let writer = Writer {
        kind: WriterKind::Plugin,
        id: fixture["plugin"].as_str().unwrap_or("plugin").to_string(),
    };
    let Some(sealed) = shipped() else {
        return refused("no_build", "the shipped canvas modules didn't seal");
    };
    let documents: Vec<Value> = fixture["documents"]
        .as_array()
        .map(|docs| {
            docs.iter()
                .map(|d| {
                    let name = d["name"].as_str().unwrap_or("document");
                    let title = d["document"]["title"].as_str().unwrap_or(name);
                    let issues = match stamp(&d["document"], &format!("plugin-{name}"), &writer, title) {
                        Err(issues) => issues,
                        Ok(stamped) => {
                            let checked = deep_canvas::document::check_in(&stamped, &sealed);
                            if checked.ok {
                                // What the check said of what it presents, its notices (an item
                                // of a kind this build doesn't know is skipped) among them.
                                let said: Vec<Value> = checked.issues.iter().map(|i| i.to_json()).chain(checked.notices.iter().map(|n| n.to_json())).collect();
                                return json!({"outcome": "presented", "issues": said});
                            }
                            checked.issues
                        }
                    };
                    json!({"outcome": "refused", "issues": issues.iter().map(|i| i.to_json()).collect::<Vec<_>>()})
                })
                .collect()
        })
        .unwrap_or_default();
    json!({
        "panel": panel,
        "documents": documents,
        "gpu": {"devices": Gpu::count(), "frames": before + after},
    })
}
