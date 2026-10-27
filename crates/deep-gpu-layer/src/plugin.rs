//! The plug-in fixture (README: The plug-in fixture): a plug-in beside a live GPU-layer view. Its
//! panel runs in the app's panel runtime (gpui-shell with the app's registry and the `deepbuild`
//! module), which offers no GPU and no drawing surface; its documents go to the canvas core as the
//! plug-in's revisions, which carry descriptions, never pixels, surfaces or shaders. With a panel
//! (#380), the script's view takes the panel's header strip in the window and the panel's canvas
//! view below it draws the plug-in's first presented 3D document through the GPU layer.

use std::path::{Path, PathBuf};

use deep_canvas::registry::{BuildSet, Module, Registry, Sealed};
use deep_canvas::show::{stamp, Writer, WriterKind};
use deep_gpu::device::Gpu;
use gpui_kit::test::TestWindowExt as _;
use gpui_kit::*;
use serde_json::{json, Value};

use crate::frames::{self, Args};
use crate::{refused, view3d, App, Planted};

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

/// The shipped build's canvas modules, the list `deep_show`'s full build holds: every module of
/// the core, r1 (#137) and r2 sets. The live view's set is this list but effects.
pub(crate) fn shipped_modules() -> Vec<Module> {
    vec![
        deep_canvas_marks::modules::text(),
        deep_canvas_marks::modules::look(),
        deep_canvas_marks::modules::marks2d(),
        deep_canvas_marks::modules::data(),
        deep_canvas_graph::module::module(),
        deep_canvas_record::module::module(),
        deep_canvas_sheet::module::module(),
        deep_canvas_motion::module::module(),
        deep_canvas_scene3d::module::module(),
        deep_canvas_effects::module::module(),
    ]
}

/// The shipped build's canvas modules, sealed, as `deep_show` checks a writer's document in it;
/// a host checks a revision in the same set (#382).
pub(crate) fn shipped() -> Option<Sealed> {
    shipped_modules()
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

/// Where the panel sits in the window and what its canvas view draws under (#380).
struct PanelCall {
    look: Value,
    window: [u32; 2],
    page: [u8; 3],
    rect: [u32; 4],
    header: u32,
    capture: bool,
}

fn numbers<const N: usize>(v: &Value) -> Option<[u32; N]> {
    let a = v.as_array().filter(|a| a.len() == N)?;
    let mut out = [0; N];
    for (o, x) in out.iter_mut().zip(a) {
        *o = u32::try_from(x.as_u64()?).ok()?;
    }
    Some(out)
}

fn panel_call(call: &Value) -> Option<Result<PanelCall, Value>> {
    let p = call.get("panel").filter(|p| !p.is_null())?;
    let bad = || {
        refused(
            "bad_input",
            "a panel takes window {size, page} and panel {rect, header}",
        )
    };
    let (Some(window), Some(page), Some(rect)) = (
        numbers::<2>(&call["window"]["size"]),
        numbers::<3>(&call["window"]["page"]),
        numbers::<4>(&p["rect"]),
    ) else {
        return Some(Err(bad()));
    };
    let header = p["header"]
        .as_u64()
        .and_then(|h| u32::try_from(h).ok())
        .unwrap_or(0);
    if header >= rect[3] || page.iter().any(|c| *c > 255) {
        return Some(Err(bad()));
    }
    Some(Ok(PanelCall {
        look: call["look"].clone(),
        window,
        page: page.map(|c| c as u8),
        rect,
        header,
        capture: call["capture"].as_bool().unwrap_or(false),
    }))
}

/// Each request the plug-in sends on its writer connection, answered: the connection carries
/// documents and patches, so a call to open a GPU device is refused, naming it.
fn requests(fixture: &Value) -> Vec<Value> {
    fixture["requests"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|r| {
            let call = r["request"]["call"].as_str().unwrap_or_default();
            let (code, why) = match call {
                "gpu.request_device" => ("no_device", "a plug-in gets no GPU device; it describes what to draw and the canvas draws it"),
                _ => ("unknown_call", "the writer connection takes no such call"),
            };
            json!({"call": call, "outcome": "refused", "code": code, "reason": format!("{call}: {why}")})
        })
        .collect()
}

/// The panel in the window: its script's view in the header strip and, below it, the canvas view
/// drawing `doc` at the view's size through `view3d` (planted: at the document's own size, past the
/// panel's edge). Answers the panel's reply and the window capture's name.
fn in_panel(
    app: &mut App,
    out: &str,
    entry: &Path,
    id: &str,
    p: &PanelCall,
    doc: Option<&Value>,
) -> Result<(Value, Option<String>), Value> {
    let runtime = deep_app::new_runtime().map_err(|e| refused("no_runtime", e.to_string()))?;
    let [x, y, w, h] = p.rect;
    let canvas = [x, y + p.header, w, h - p.header];
    app.window(p.window)?;
    let win = app.window.as_ref().expect("opened above");
    let mounted = win
        .update(&mut app.cx, |window, cx| {
            deep_app::mount_panel(&runtime, entry, window, cx)
        })
        .map_err(|e| refused("no_window", e))?;
    let (view, error) = match mounted {
        Ok(v) => (Some(v), None),
        Err(e) => (None, Some(format!("{e:#}"))),
    };
    {
        let mut paint = win.paint.borrow_mut();
        paint.page = (32, vec![p.page]);
        paint.panel = view
            .clone()
            .map(|v| (v.into(), [x as f32, y as f32, w as f32, p.header as f32]));
    }
    let drawn = (|| -> Result<Option<String>, Value> {
        let Some(doc) = doc else {
            let win = app.window.as_ref().expect("opened above");
            win.present(&mut app.cx);
            if !p.capture {
                return Ok(None);
            }
            let image = win
                .capture(&mut app.cx)
                .map_err(|e| refused("no_capture", e))?;
            let png = view3d::png(image.as_raw(), [image.width(), image.height()])?;
            return view3d::write_named(out, &png, "png").map(Some);
        };
        let size = match app.planted {
            Some(Planted::HostUnclipped) => {
                numbers::<2>(&doc["size"]).unwrap_or([canvas[2], canvas[3]])
            }
            _ => [canvas[2], canvas[3]],
        };
        let path =
            std::env::temp_dir().join(format!("deep-gpu-plugin-doc-{}.json", std::process::id()));
        std::fs::write(&path, doc.to_string())
            .map_err(|e| refused("not_written", e.to_string()))?;
        let reply = view3d::call(
            app,
            out,
            &json!({
                "call": "view3d", "doc": path, "look": p.look, "size": size, "frames": 1,
                "window": {"size": p.window, "view": [canvas[0], canvas[1]], "page": p.page},
                "capture": if p.capture { json!([0]) } else { json!([]) },
            }),
        );
        let _ = std::fs::remove_file(&path);
        if reply.get("code").is_some() {
            return Err(reply);
        }
        Ok(reply["frames"][0]["window"].as_str().map(str::to_string))
    })();
    let tree = view.and_then(|v| {
        app.cx.update(|cx| {
            let v = v.read(cx);
            if v.build_error().is_some() {
                return None;
            }
            v.snapshot().map(|s| s.debug_tree())
        })
    });
    if let Some(win) = app.window.as_ref() {
        win.paint.borrow_mut().panel = None;
    }
    let window = drawn?;
    let panel = match tree {
        Some(tree) => {
            json!({"id": id, "loaded": true, "text": texts(&tree), "rect": p.rect, "canvas": canvas})
        }
        None => {
            json!({"id": id, "loaded": false, "error": error, "text": [], "rect": p.rect, "canvas": canvas})
        }
    };
    Ok((panel, window))
}

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    match run(app, out, call) {
        Ok(v) | Err(v) => v,
    }
}

fn run(app: &mut App, out: &str, call: &Value) -> Result<Value, Value> {
    let panel_call = panel_call(call).transpose()?;
    let scene = call["scene"].as_str();
    let (Some(dir), true) = (
        call["dir"].as_str(),
        scene.is_some() || panel_call.is_some(),
    ) else {
        return Err(refused(
            "bad_input",
            "plugin takes a dir and a scene or a panel",
        ));
    };
    let dir = Path::new(dir);
    let fixture: Value = match std::fs::read_to_string(dir.join("documents.json")) {
        Ok(t) => serde_json::from_str(&t).unwrap_or(Value::Null),
        Err(e) => return Err(refused("bad_input", e.to_string())),
    };
    // The live view beside the plug-in.
    let live = |app: &mut App| match scene {
        Some(scene) => {
            frames::drive(app, "", &Args::new(scene, 2), &|_| false).map(|r| r.frames.len())
        }
        None => Ok(0),
    };
    let before = live(app)?;
    let planted = (app.planted == Some(Planted::ExposesGpuToPanels))
        .then_some(("metal", app.decision.path.name()));
    let entry = entry(dir, planted).map_err(|e| refused("bad_input", e))?;
    let plugin = fixture["plugin"].as_str().unwrap_or("plugin").to_string();
    let writer = Writer {
        kind: WriterKind::Plugin,
        id: plugin.clone(),
    };
    let Some(sealed) = shipped() else {
        let _ = std::fs::remove_dir_all(&entry);
        return Err(refused(
            "no_build",
            "the shipped canvas modules didn't seal",
        ));
    };
    // The first presented document that draws in 3D, for the panel's canvas view.
    let mut scene3d = None;
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
                                if scene3d.is_none() && stamped["requires"]["modules"].get("scene3d").is_some() {
                                    scene3d = Some(stamped.clone());
                                }
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
    let drawn = match &panel_call {
        Some(p) => in_panel(app, out, &entry, &plugin, p, scene3d.as_ref()),
        None => Ok((panel(app, &entry), None)),
    };
    let _ = std::fs::remove_dir_all(&entry);
    let (panel, window) = drawn?;
    let after = live(app)?;
    let mut reply = json!({
        "panel": panel,
        "documents": documents,
        "requests": requests(&fixture),
        "gpu": {"devices": Gpu::count(), "frames": before + after},
    });
    if let Some(w) = window {
        reply["window"] = json!(w);
    }
    Ok(reply)
}

#[cfg(test)]
mod tests {
    use super::{shipped, stamp, Writer, WriterKind};
    use serde_json::json;

    /// A host checks a revision in the set deep_show's full build seals, and the live view in that
    /// set without effects (#137): in both, a document that requires R1's data, graph, record or
    /// sheet module is checked, not refused as module_missing.
    #[test]
    fn the_shipped_sets_hold_r1s_modules() {
        let shipped = shipped().expect("the shipped canvas modules seal");
        let writer = Writer {
            kind: WriterKind::Plugin,
            id: "plugin".into(),
        };
        let (_, board) = shipped
            .fixtures
            .iter()
            .find(|(m, f)| m == "marks2d" && f.name == "board")
            .expect("marks2d's board");
        for (set, sealed) in [("host", &shipped), ("live", crate::live::sealed())] {
            for module in ["data", "graph", "record", "sheet"] {
                let mut doc = board.document.clone();
                doc["requires"] = json!({"modules": {module: "^1"}});
                let stamped =
                    stamp(&doc, "plugin-board", &writer, "Board").expect("the board stamps");
                let checked = deep_canvas::document::check_in(&stamped, sealed);
                assert!(
                    checked.ok,
                    "the {set} set, a board requiring {module}: {:?}",
                    checked.issues
                );
            }
        }
    }
}
