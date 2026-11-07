//! The `view3d` call (issue #378; tests/acceptance/378/README.md, The view3d call): a document's
//! 3D writer layers drawn by scene3d's render module through a GPU-layer view, frame n at
//! t = n ÷ fps on a virtual clock, with the writers' patches applied before the frames they name.
//! With a window, the view sits over a flat page and its 2D writer layers anchored to 3D items
//! draw over it from the evaluated data of the `frame_seq` the shown slot carries. Items that
//! open deeper documents by reference load them as they come on screen (#383), and with
//! `timings` each frame reports its GPU time and the GPU memory the device holds.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use deep_canvas::document::{apply_ops, check_packed, writer_layer, Issue, Packs, Writing};
use deep_canvas_marks::look::Status;
use deep_canvas_scene3d::label::PAGE;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::module::{GEOMETRY_PASS, OUTPUT_PASS};
use deep_canvas_scene3d::scene::{evaluate_sourced, placed_at, Labels, Scene};
use deep_gpu::device::Backend;
use deep_scene3d_render::status::{Mode, COLORS_PASS, GUARD_PASS};
use deep_scene3d_render::SHADOW_PASS;
use image::ImageEncoder as _;
use serde_json::{json, Map, Value};

use crate::frames::{hex, Capture};
use crate::levels::Levels;
use crate::liveview::surface_of;
use crate::session3::{self, lock};
use crate::status;
use crate::window::OverlayPicture;
use crate::{blur, effects, refused, App, Planted};
use deep_scene3d_render::surface::{self, Surface, OUTLINE_PASS, SHARPEN_PASS, UPSCALE_PASS};

pub const FLICKS_PER_SECOND: u64 = 705_600_000;

struct Window3 {
    size: [u32; 2],
    view: [u32; 2],
    page: [u8; 3],
}

struct Args {
    doc: Value,
    look: Look3,
    /// The look as given: its bloom and ground grid turn effects on (#380).
    look_json: Value,
    /// The session's selection, whose items draw their outlines (#380).
    selection: Vec<String>,
    /// The first frame latched: the session opens there, a seek (#380).
    from: u64,
    /// Each frame's GPU time and each pass's, from wgpu-profiler (#380).
    timings: bool,
    size: [u32; 2],
    frames: u64,
    fps: u64,
    /// `(frame, writer, ops)`, in the call's order.
    patches: Vec<(u64, String, Value)>,
    targets: BTreeSet<String>,
    capture: Capture,
    /// Operator outputs each captured frame reads back (#483).
    read: Vec<String>,
    /// `cull: "cpu"`: the document drawn from the CPU's f64 cull, the reference a GPU frame is
    /// judged against (#484).
    cull_on_cpu: bool,
    /// Each captured frame reports what each culled list kept (#484).
    cull_report: bool,
    /// `(after, to)`: right after frame `after` draws, the session jumps to frame `to` (#484).
    seeks: Vec<(u64, u64)>,
    window: Option<Window3>,
    latency: Vec<u64>,
    counts: bool,
    /// The glTF files `mesh.asset@1` items name, by sha256 (#420), and the images a material's
    /// maps or a glTF name (#423).
    assets: std::collections::BTreeMap<String, std::path::PathBuf>,
    /// A JSON glTF's external buffers and images: `{glTF sha → {uri → sha}}` (#423).
    uris: BTreeMap<String, BTreeMap<String, String>>,
    /// An asset's license, by its hash (#423).
    licenses: BTreeMap<String, Value>,
    /// The evidence store an import keeps each texture in, by hash (#423).
    store: Option<std::path::PathBuf>,
    /// Report each scene import and the maps' receipt (#423).
    imports: bool,
    receipt: bool,
    /// The documents an item may open by reference, by doc handle.
    docs: BTreeMap<String, std::path::PathBuf>,
    /// Report each label's glyphs and the atlas pages they sample (#381).
    labels: bool,
    /// `(frame, at)`: a click at `at` view px while frame n is presented (#671).
    clicks: Vec<(u64, [f64; 2])>,
    /// The selection's hit margin in px (#424; Selection: `hit.margin`), 3 unless the call says.
    hit_margin: i64,
    /// A `cutaway@1`'s params as a view input in session state, applied to every frame (#424).
    cutaway: Option<Value>,
    /// The record's state for each status binding's source (#382).
    states: BTreeMap<String, String>,
    /// Report the first frame as a cold start: when it settled, from this process's spawn, and
    /// which pipelines it compiled (#854).
    cold: bool,
    /// The theme the look's roles and status map resolve in (#382).
    theme: String,
    /// The look's status map, when it has one (#382).
    status: Option<Status>,
    /// The GPU surface the view draws through (#386).
    surface: Surface,
    /// The pack folders installed before the document's check, by `owner/name` (#429), or
    /// `deepbuild/<name>` when the call names only the folder (#422).
    packs: Vec<(Option<String>, std::path::PathBuf)>,
    /// The paths whose evaluated values each frame reports (#429).
    evaluate: Vec<String>,
    /// Writer layers not visible in this session, which draw, light and cast nothing (#422).
    hidden: BTreeSet<String>,
    /// Each frame reports the key sun's cascade splits (#422).
    cascades: bool,
    /// Each frame reports its shadow passes and local maps (#446).
    shadows: bool,
    /// Each frame reports its level-of-detail rows and its light cut, and each captured frame
    /// its band masks (#425).
    lod: bool,
    light_cut: bool,
    masks: bool,
    /// The view's class (#419): an export draws every frame with all of the look's export
    /// samples and never settles; the live view draws its live samples while moving.
    export: bool,
    /// Viewer-only input in session state, from the frame each names (#419): `{pointer, hover,
    /// selection, readout}`, never a document revision.
    viewer: Vec<(u64, Value)>,
}

/// Milliseconds from this process's spawn, as the kernel records its start, to now.
#[cfg(target_os = "macos")]
fn since_spawn_ms() -> Option<f64> {
    // SAFETY: an all-zero proc_bsdinfo is valid for proc_pidinfo to fill, and the size passed is
    // its own.
    let mut info: libc::proc_bsdinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_bsdinfo>() as i32;
    let read = unsafe {
        libc::proc_pidinfo(
            libc::getpid(),
            libc::PROC_PIDTBSDINFO,
            0,
            (&raw mut info).cast(),
            size,
        )
    };
    if read != size {
        return None;
    }
    let started = std::time::UNIX_EPOCH
        + std::time::Duration::new(info.pbi_start_tvsec, info.pbi_start_tvusec as u32 * 1000);
    Some(
        std::time::SystemTime::now()
            .duration_since(started)
            .ok()?
            .as_secs_f64()
            * 1000.0,
    )
}

#[cfg(not(target_os = "macos"))]
fn since_spawn_ms() -> Option<f64> {
    None
}

pub(crate) fn pair(v: &Value) -> Option<[u32; 2]> {
    let a = v.as_array()?;
    if a.len() != 2 {
        return None;
    }
    Some([
        u32::try_from(a[0].as_u64()?).ok()?,
        u32::try_from(a[1].as_u64()?).ok()?,
    ])
}

/// `doc` without the items of the `hidden` writer layers, nor those layers (#422: a layer not
/// visible draws, lights and casts nothing, as if absent).
fn without_layers(doc: &Value, hidden: &BTreeSet<String>) -> Value {
    let mut d = doc.clone();
    if let Some(items) = d.get_mut("items").and_then(Value::as_object_mut) {
        items.retain(|_, item| !item["layer"].as_str().is_some_and(|l| hidden.contains(l)));
    }
    if let Some(layers) = d.get_mut("layers").and_then(Value::as_object_mut) {
        layers.retain(|id, _| !hidden.contains(id));
    }
    d
}

/// The document's visible writer layers back to front (#422): by the band their writer's kind
/// gives (Band; deep-canvas's `Writer::band`), then by their order key and ID.
fn layers_report(doc: &Value, hidden: &BTreeSet<String>) -> Value {
    use deep_canvas::show::{Writer, WriterKind};
    let mut rows: Vec<(deep_canvas::show::Band, String, String, String)> = Vec::new();
    for (id, layer) in doc["layers"].as_object().into_iter().flatten() {
        if hidden.contains(id) {
            continue;
        }
        let text = layer["writer"].as_str().unwrap_or_default();
        let (kind, rest) = text.split_once(':').unwrap_or((text, ""));
        let kind = match kind {
            "you" => WriterKind::You,
            "shell" => WriterKind::Shell,
            "record" => WriterKind::Record,
            "plugin" => WriterKind::Plugin,
            _ => WriterKind::Agent,
        };
        let band = Writer {
            kind,
            id: rest.to_string(),
        }
        .band();
        let order = layer["order"].as_str().unwrap_or_default().to_string();
        rows.push((band, order, id.clone(), text.to_string()));
    }
    rows.sort();
    json!(rows
        .into_iter()
        .map(|(band, _, layer, writer)| json!({"layer": layer, "writer": writer, "band": band.name()}))
        .collect::<Vec<_>>())
}

/// The modules a view3d document and its packs' recipes may name: the shipped ones and the
/// building module (#422).
fn pack_sealed() -> Result<&'static deep_canvas::registry::Sealed, Value> {
    static SEALED: std::sync::OnceLock<Option<deep_canvas::registry::Sealed>> =
        std::sync::OnceLock::new();
    SEALED
        .get_or_init(|| {
            crate::plugin::shipped_modules()
                .into_iter()
                .chain([
                    deep_canvas_scene3d::building::module(),
                    // #443: vector, whose outline source an `extrude` of a vector item reads.
                    deep_canvas_vector::module::module(),
                ])
                .fold(
                    deep_canvas::registry::Registry::new(deep_canvas::registry::BuildSet::Full),
                    deep_canvas::registry::Registry::with,
                )
                .seal()
                .ok()
        })
        .as_ref()
        .ok_or_else(|| refused("render_failed", "the pack build's modules don't seal"))
}

fn parse(call: &Value) -> Result<Args, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let path = call["doc"].as_str().ok_or_else(|| bad("doc is a path"))?;
    let text = std::fs::read_to_string(path).map_err(|e| bad(&format!("doc: {e}")))?;
    let mut doc: Value = serde_json::from_str(&text).map_err(|e| bad(&format!("doc: {e}")))?;
    let theme = status::theme_of(call)?;
    let look_json = status::themed(&call["look"], &theme);
    let look = Look3::read(&look_json).map_err(|e| bad(&format!("look: {e}")))?;
    let status = status::status_of(&look_json)?;
    let states = status::states(call).ok_or_else(|| bad("states maps handles to states"))?;
    let size = pair(&call["size"])
        .filter(|s| s[0] > 0 && s[1] > 0)
        .ok_or_else(|| bad("size is [w, h]"))?;
    if let Some(d) = doc.as_object_mut() {
        d.insert("size".into(), json!(size));
    }
    // #443: each vector item's SVG from the store, inlined as deep_show's hub inlines it
    // (`params.outline.svg`), which vector's outline source reads.
    if let (Some(store), Some(items)) = (
        call["store"].as_str().map(std::path::Path::new),
        doc.get_mut("items").and_then(Value::as_object_mut),
    ) {
        for item in items.values_mut() {
            let src = match (item["kind"].as_str(), item.pointer("/params/src")) {
                (Some("vector@1"), Some(Value::String(src))) if src.len() == 64 => src.clone(),
                _ => continue,
            };
            let Ok(bytes) = std::fs::read(store.join(&src[..2]).join(&src[2..])) else {
                continue;
            };
            if let Some(params) = item.get_mut("params").and_then(Value::as_object_mut) {
                params.insert(
                    "outline".into(),
                    json!({"svg": String::from_utf8_lossy(&bytes)}),
                );
            }
        }
    }
    let frames = call["frames"].as_u64().unwrap_or(1).max(1);
    let fps = call["fps"].as_u64().unwrap_or(60).max(1);
    let mut patches = Vec::new();
    for p in call["patches"].as_array().into_iter().flatten() {
        let (Some(frame), Some(writer)) = (p["frame"].as_u64(), p["writer"].as_str()) else {
            return Err(bad("a patch is {frame, writer, ops}"));
        };
        patches.push((frame, writer.to_string(), p["ops"].clone()));
    }
    let targets = call["targets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    if targets.iter().any(|t| {
        !matches!(
            t.as_str(),
            "final" | "linear" | "ids" | "pre_tone" | "dirt" | "scene"
        )
    }) {
        return Err(bad(
            "targets are final, linear, ids, pre_tone, dirt and scene",
        ));
    }
    let export = match call["class"].as_str() {
        None | Some("live") => false,
        Some("export") => true,
        Some(_) => return Err(bad("class is live or export")),
    };
    let mut viewer = Vec::new();
    for v in call["viewer"].as_array().into_iter().flatten() {
        let Some(frame) = v["frame"].as_u64() else {
            return Err(bad(
                "a viewer entry is {frame, pointer?, hover?, selection?, readout?}",
            ));
        };
        viewer.push((frame, v.clone()));
    }
    let capture = match &call["capture"] {
        Value::String(s) if s == "every" => Capture::Every,
        Value::Array(f) => Capture::Frames(f.iter().filter_map(Value::as_u64).collect()),
        _ => Capture::None,
    };
    let window = match call.get("window") {
        None | Some(Value::Null) => None,
        Some(w) => {
            let page = w["page"].as_array().filter(|p| p.len() == 3).and_then(|p| {
                Some([
                    u8::try_from(p[0].as_u64()?).ok()?,
                    u8::try_from(p[1].as_u64()?).ok()?,
                    u8::try_from(p[2].as_u64()?).ok()?,
                ])
            });
            match (pair(&w["size"]), pair(&w["view"]), page) {
                (Some(size), Some(view), Some(page)) => Some(Window3 { size, view, page }),
                _ => return Err(bad("window is {size, view, page}")),
            }
        }
    };
    let latency = call["latency"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_u64)
        .collect();
    let docs = match call.get("docs") {
        None | Some(Value::Null) => BTreeMap::new(),
        Some(Value::Object(d)) => d
            .iter()
            .map(|(h, p)| Some((h.clone(), std::path::PathBuf::from(p.as_str()?))))
            .collect::<Option<_>>()
            .ok_or_else(|| bad("docs maps a doc handle to a path"))?,
        Some(_) => return Err(bad("docs maps a doc handle to a path")),
    };
    let mut clicks = Vec::new();
    for c in call["clicks"].as_array().into_iter().flatten() {
        let at = c["at"]
            .as_array()
            .filter(|a| a.len() == 2)
            .and_then(|a| Some([a[0].as_f64()?, a[1].as_f64()?]));
        let (Some(frame), Some(at)) = (c["frame"].as_u64(), at) else {
            return Err(bad("a click is {frame, at: [x, y]}"));
        };
        clicks.push((frame, at));
    }
    let mut packs = Vec::new();
    for p in call["packs"].as_array().into_iter().flatten() {
        // A folder (its id `deepbuild/<name>`, #422) or `{id, dir}` (#429).
        let (id, dir) = match (p.as_str(), p["id"].as_str(), p["dir"].as_str()) {
            (Some(dir), ..) => (None, dir),
            (None, Some(id), Some(dir)) => (Some(id.to_string()), dir),
            _ => return Err(bad("a pack is a folder or {id, dir}")),
        };
        packs.push((id, std::path::PathBuf::from(dir)));
    }
    let mut evaluate = Vec::new();
    for p in call["evaluate"].as_array().into_iter().flatten() {
        match p.as_str() {
            Some(path) if path.starts_with("items/") => evaluate.push(path.to_string()),
            _ => return Err(bad("evaluate lists paths items/<id>/…")),
        }
    }
    Ok(Args {
        packs,
        evaluate,
        docs,
        doc,
        look,
        look_json,
        selection: call["selection"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        from: call["from"].as_u64().unwrap_or(0),
        timings: call["timings"].as_bool().unwrap_or(false),
        size,
        frames,
        fps,
        patches,
        targets,
        capture,
        read: call["read"]
            .as_array()
            .map(|r| {
                r.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
        cull_on_cpu: match call["cull"].as_str() {
            None => false,
            Some("cpu") => true,
            Some(_) => return Err(refused("bad_input", "cull is \"cpu\" when it's given")),
        },
        cull_report: call["cull_report"].as_bool().unwrap_or(false),
        seeks: call["seeks"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|s| Some((s["after"].as_u64()?, s["to"].as_u64()?)))
            .collect(),
        window,
        latency,
        counts: call["counts"].as_bool().unwrap_or(false),
        assets: call["assets"]
            .as_object()
            .into_iter()
            .flatten()
            .filter_map(|(sha, p)| Some((sha.clone(), std::path::PathBuf::from(p.as_str()?))))
            .collect(),
        uris: call["uris"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(sha, m)| {
                let m = m
                    .as_object()
                    .into_iter()
                    .flatten()
                    .filter_map(|(u, s)| Some((u.clone(), s.as_str()?.to_string())))
                    .collect();
                (sha.clone(), m)
            })
            .collect(),
        licenses: call["licenses"]
            .as_object()
            .map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect())
            .unwrap_or_default(),
        store: call["store"].as_str().map(std::path::PathBuf::from),
        imports: call["imports"].as_bool().unwrap_or(false),
        receipt: call["receipt"].as_bool().unwrap_or(false),
        labels: call["labels"].as_bool().unwrap_or(false),
        clicks,
        hit_margin: call
            .pointer("/hit/margin")
            .and_then(Value::as_u64)
            .map_or(3, |m| m.min(64) as i64),
        cutaway: call.get("cutaway").filter(|c| !c.is_null()).cloned(),
        states,
        theme,
        status,
        cold: call["cold"].as_bool().unwrap_or(false),
        surface: surface_of(call.get("surface")).map_err(|e| bad(&e))?,
        hidden: call["hidden"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect(),
        cascades: call["cascades"].as_bool().unwrap_or(false),
        shadows: call["shadows"].as_bool().unwrap_or(false),
        lod: call["lod"].as_bool().unwrap_or(false),
        light_cut: call["light_cut"].as_bool().unwrap_or(false),
        masks: call["masks"].as_bool().unwrap_or(false),
        export,
        viewer,
    })
}

/// The packs a call installs (#429): each folder read as deep-show's pack store reads one
/// (`pack.json`, its `id` set to `owner/name`, each recipe file it names inlined) and admitted
/// through the pack check once.
fn install(packs: &[(Option<String>, std::path::PathBuf)]) -> Result<Packs, Value> {
    let read = |p: &std::path::Path| -> Result<Value, Value> {
        let at = |e: String| refused("bad_input", format!("{}: {e}", p.display()));
        let text = std::fs::read_to_string(p).map_err(|e| at(e.to_string()))?;
        serde_json::from_str(&text).map_err(|e| at(e.to_string()))
    };
    let mut out = Packs::default();
    for (id, dir) in packs {
        let mut manifest = read(&dir.join("pack.json"))?;
        let Some(fields) = manifest.as_object_mut() else {
            return Err(refused(
                "bad_input",
                format!("{}: a pack is an object", dir.display()),
            ));
        };
        let id = id.clone().unwrap_or_else(|| {
            format!(
                "deepbuild/{}",
                fields
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            )
        });
        fields.insert("id".into(), json!(id));
        if let Some(Value::Object(recipes)) = fields.get_mut("recipes") {
            for entry in recipes.values_mut() {
                if let Some(file) = entry.as_str() {
                    *entry = read(&dir.join(file))?;
                }
            }
        }
        out.admit(&manifest, pack_sealed()?)
            .map_err(|issues| issues_refused(&issues))?;
    }
    Ok(out)
}

fn issues_refused(issues: &[Issue]) -> Value {
    json!({"code": "refused", "issues": issues.iter().map(Issue::to_json).collect::<Vec<_>>()})
}

/// A document that names packs, as the check lowers it: its recipe instances expanded into their
/// derived items and their channels; refused with the check's issues when nothing expanded
/// (#429). A payload without the stored fields (#422's castle) still draws its expansion.
fn lowered(doc: &Value, packs: &Packs) -> Result<Value, Value> {
    let checked = check_packed(doc, pack_sealed()?, packs);
    if !checked.ok && checked.expansions.is_empty() {
        let errors: Vec<Issue> = checked
            .issues
            .into_iter()
            .filter(|i| i.severity == "error")
            .collect();
        return Err(issues_refused(&errors));
    }
    Ok(checked.lowered)
}

/// Each path of `paths` (`items/<id>/<field>…`) as the canvas core evaluates `doc` at `t`
/// (#429): null where the item or field isn't there.
fn values_at(doc: &Value, t: i64, paths: &[String]) -> Result<Value, Value> {
    let items = placed_at(doc, t).map_err(|r| refused(r.code, r.path))?;
    let mut out = Map::new();
    for path in paths {
        let rest = path.strip_prefix("items/").unwrap_or_default();
        let (id, field) = rest.split_once('/').unwrap_or((rest, ""));
        let value = items
            .iter()
            .find(|(i, _, _)| i == id)
            .and_then(|(_, item, _)| item.pointer(&format!("/{field}")))
            .cloned()
            .unwrap_or(Value::Null);
        out.insert(path.clone(), value);
    }
    Ok(Value::Object(out))
}

/// A patch's ops applied as `writer`, to the layer its connection stands for.
pub(crate) fn apply_patch(
    doc: &mut Value,
    writer: &str,
    ops: &Value,
    seq: usize,
) -> Result<(), Value> {
    let layer = writer_layer(doc, writer).map_err(|i| refused(i.code, i.what.clone()))?;
    let id = doc["id"].as_str().unwrap_or_default().to_string();
    let patch = json!({
        "patch": format!("01JB7F0000000000000000{seq:04}"),
        "doc": id,
        "base": 0,
        "reason": "a view3d patch",
        "ops": ops,
    });
    let knows = |_: &str| true;
    let writing = Writing {
        layer: &layer,
        writer,
        you: false,
        base: None,
        knows: &knows,
        packs: None,
    };
    apply_ops(doc, &patch, "patches/0", &id, &writing)
        .map(|_| ())
        .map_err(|i| refused(i.code, format!("{}: {}", i.path, i.what)))
}

/// An anchored 2D overlay as the picture GPUI paints: BGRA, placed on a whole pixel.
fn overlay_picture(o: &deep_canvas_scene3d::scene::Overlay) -> Option<OverlayPicture> {
    let p = deep_canvas_scene3d::overlay::picture(o)?;
    let mut bgra = p.rgba;
    for px in bgra.as_chunks_mut::<4>().0 {
        px.swap(0, 2);
    }
    let frame = image::RgbaImage::from_raw(u32::from(p.size[0]), u32::from(p.size[1]), bgra)?;
    Some(OverlayPicture {
        at: p.at,
        size: p.size,
        image: Arc::new(gpui_kit::RenderImage::new([image::Frame::new(frame)])),
    })
}

/// What a click at `at` view px picks in a frame (canvas primitives: Selection, Spatial index):
/// the topmost 2D overlay whose shapes cover it, else the item the object-ID target holds there,
/// else nothing.
///
/// In 3D a pick reads the (2 × margin + 1)² window of the object-ID target around the pointer:
/// the drawn ID nearest the pointer, ties by depth, nearest the camera first (#424; Selection:
/// `hit.margin`), so a 1 px line or a point is pickable as in 2D.
fn pick(
    scene: &deep_canvas_scene3d::scene::Scene,
    ids: &[u8],
    depth: Option<&(Vec<u8>, bool)>,
    picks: &[(String, u32)],
    size: [u32; 2],
    at: [f64; 2],
    margin: i64,
) -> Option<String> {
    use deep_canvas_scene3d::scene::Shape2;
    for o in scene.overlays.iter().rev() {
        let Some([ox, oy]) = o.origin else { continue };
        let [x, y] = [at[0] - ox, at[1] - oy];
        let hit = o.shapes.iter().any(|s| match s {
            Shape2::Circle { center, r, .. } => (x - center[0]).hypot(y - center[1]) <= *r,
            Shape2::Rect { rect, .. } => {
                (rect[0]..=rect[0] + rect[2]).contains(&x)
                    && (rect[1]..=rect[1] + rect[3]).contains(&y)
            }
        });
        if hit {
            return Some(o.id.clone());
        }
    }
    let [x, y] = [at[0].floor(), at[1].floor()];
    if x < 0.0 || y < 0.0 || x >= f64::from(size[0]) || y >= f64::from(size[1]) {
        return None;
    }
    let read = |b: &[u8], i: usize| b.get(i * 4..i * 4 + 4).map(|v| [v[0], v[1], v[2], v[3]]);
    // (distance², nearness) of the best pixel so far, and its ID.
    let mut best: Option<((f64, f64), u32)> = None;
    let (cx, cy) = (x as i64, y as i64);
    for py in cy - margin..=cy + margin {
        for px in cx - margin..=cx + margin {
            if px < 0 || py < 0 || px >= i64::from(size[0]) || py >= i64::from(size[1]) {
                continue;
            }
            let i = py as usize * size[0] as usize + px as usize;
            let Some(p) = read(ids, i).map(u32::from_le_bytes).filter(|p| *p != 0) else {
                continue;
            };
            let d2 = (px as f64 + 0.5 - at[0]).powi(2) + (py as f64 + 0.5 - at[1]).powi(2);
            let near = depth.and_then(|(d, grows)| {
                let z = f64::from(f32::from_le_bytes(read(d, i)?));
                Some(if *grows { z } else { -z })
            });
            let key = (d2, -near.unwrap_or(0.0));
            if best.is_none_or(|(k, _)| key.0 < k.0 || (key.0 == k.0 && key.1 < k.1)) {
                best = Some((key, p));
            }
        }
    }
    let (_, p) = best?;
    picks
        .iter()
        .find(|(_, v)| *v == p)
        .map(|(id, _)| id.clone())
}

fn srgb_decode(c: u8) -> f64 {
    let c = f64::from(c) / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn srgb_encode(c: f64) -> u8 {
    let c = if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    };
    (c * 255.0).round().clamp(0.0, 255.0) as u8
}

/// A sub-sample's pixels: its final bytes and its linear target.
struct Part {
    bytes: Option<Vec<u8>>,
    linear: Option<Vec<u8>>,
}

impl Part {
    fn of(d: &session3::Drawn) -> Part {
        Part {
            bytes: d.bytes.clone(),
            linear: d.targets.as_ref().map(|(l, _)| l.clone()),
        }
    }
}

/// The frame as the weighted mean of its sub-samples, in index order (#419): the linear
/// target's values, and the final BGRA bytes averaged in linear light. A frame of one sample is
/// that sample as drawn.
fn mean(drawn: &mut session3::Drawn, parts: &[(f64, &Part)]) {
    if parts.len() < 2 {
        if let Some((_, d)) = parts.first() {
            drawn.bytes.clone_from(&d.bytes);
            if let (Some((l, _)), Some(dl)) = (drawn.targets.as_mut(), &d.linear) {
                l.clone_from(dl);
            }
        }
        return;
    }
    let total: f64 = parts.iter().map(|(w, _)| w).sum();
    if let Some((linear, _)) = drawn.targets.as_mut() {
        let mut acc = vec![0f64; linear.len() / 4];
        for (w, s) in parts {
            if let Some(l) = &s.linear {
                for (a, b) in acc.iter_mut().zip(l.as_chunks::<4>().0) {
                    *a += w * f64::from(f32::from_le_bytes(*b));
                }
            }
        }
        *linear = acc
            .iter()
            .flat_map(|v| ((v / total) as f32).to_le_bytes())
            .collect();
    }
    if let Some(bytes) = drawn.bytes.as_mut() {
        let mut acc = vec![0f64; bytes.len()];
        for (w, s) in parts {
            if let Some(b) = &s.bytes {
                for (i, (a, c)) in acc.iter_mut().zip(b).enumerate() {
                    // Alpha averages as coverage, the color channels in linear light.
                    *a += w * if i % 4 == 3 {
                        f64::from(*c)
                    } else {
                        srgb_decode(*c)
                    };
                }
            }
        }
        for (i, (out, a)) in bytes.iter_mut().zip(acc).enumerate() {
            *out = if i % 4 == 3 {
                (a / total).round().clamp(0.0, 255.0) as u8
            } else {
                srgb_encode(a / total)
            };
        }
    }
}

pub(crate) fn png(rgba: &[u8], size: [u32; 2]) -> Result<Vec<u8>, Value> {
    let mut out = Vec::new();
    image::codecs::png::PngEncoder::new_with_quality(
        &mut out,
        image::codecs::png::CompressionType::Fast,
        image::codecs::png::FilterType::Sub,
    )
    .write_image(rgba, size[0], size[1], image::ExtendedColorType::Rgba8)
    .map_err(|e| refused("not_written", e.to_string()))?;
    Ok(out)
}

/// Writes a BGRA frame under `out` as an RGBA PNG named by its SHA-256; returns the name.
pub(crate) fn write_final(out: &str, bgra: &[u8], size: [u32; 2]) -> Result<String, Value> {
    let mut rgba = bgra.to_vec();
    for p in rgba.as_chunks_mut::<4>().0 {
        p.swap(0, 2);
    }
    write_named(out, &png(&rgba, size)?, "png")
}

/// Each pick ID with the item it stands for.
pub(crate) fn picks_json(picks: &[(String, u32)]) -> Value {
    Value::Object(
        picks
            .iter()
            .map(|(id, p)| (p.to_string(), json!(id)))
            .collect(),
    )
}

/// Writes `bytes` under `out`, named by their SHA-256 with `ext`; returns the name.
/// A lens dirt PNG from the call's assets (#418): each pixel's value its red channel ÷ 255.
fn dirt_png(
    assets: &BTreeMap<String, std::path::PathBuf>,
    sha: &str,
) -> Result<deep_canvas_effects::interp::Image, Value> {
    let path = "look/bloom/dirt/texture";
    let file = assets
        .get(sha)
        .ok_or_else(|| refused("asset_missing", path))?;
    let bytes = std::fs::read(file).map_err(|_| refused("asset_missing", path))?;
    let img = image::load_from_memory(&bytes)
        .map_err(|_| refused("out_of_range", path))?
        .to_rgba8();
    let mut out = deep_canvas_effects::interp::Image::new(img.width(), img.height());
    for (p, px) in out.px.iter_mut().zip(img.pixels()) {
        let d = f64::from(px.0[0]) / 255.0;
        *p = [d, d, d, 1.0];
    }
    Ok(out)
}

/// The dirt image as the bloom's mix reads it at each pixel of a `size` frame, stretched over it:
/// f32 RGBA with d in red, green and blue.
fn dirt_target(dirt: &deep_canvas_effects::interp::Image, size: [u32; 2]) -> Vec<u8> {
    let mut out = Vec::with_capacity((size[0] * size[1] * 16) as usize);
    for y in 0..size[1] {
        for x in 0..size[0] {
            let uv = [
                (f64::from(x) + 0.5) / f64::from(size[0]),
                (f64::from(y) + 0.5) / f64::from(size[1]),
            ];
            let d = dirt.sample(uv)[0] as f32;
            for v in [d, d, d, 1.0] {
                out.extend_from_slice(&v.to_le_bytes());
            }
        }
    }
    out
}

pub(crate) fn write_named(out: &str, bytes: &[u8], ext: &str) -> Result<String, Value> {
    let name = hex(bytes);
    std::fs::write(
        std::path::Path::new(out).join(format!("{name}.{ext}")),
        bytes,
    )
    .map_err(|e| refused("not_written", e.to_string()))?;
    Ok(name)
}

/// Each label's glyphs, with their places in the core's glyph atlas, and the pages they sample,
/// each written as an 8-bit grayscale PNG of its alpha named by its SHA-256.
fn labels_json(scene: &Scene, out: &str) -> Result<(Value, Value), Value> {
    let mut labels = Vec::new();
    let mut sampled = BTreeSet::new();
    for l in scene.layers.iter().flat_map(|layer| &layer.labels) {
        let glyphs: Vec<Value> = l
            .glyphs
            .iter()
            .map(|g| {
                let atlas = g.atlas.map(|a| {
                    sampled.insert(a.page);
                    json!({"page": a.page, "x": a.x, "y": a.y, "w": a.w, "h": a.h, "raster": g.raster})
                });
                json!({
                    "font": format!("crates/deep-text/fonts/{}", g.file), "size": g.size, "id": g.id,
                    "x": g.x, "y": g.y, "grapheme": g.grapheme, "atlas": atlas,
                })
            })
            .collect();
        labels.push(json!({"item": l.id, "glyphs": glyphs}));
    }
    let mut pages = Vec::new();
    for page in sampled {
        let bytes = &scene.pages[page as usize].bytes;
        let mut png = Vec::new();
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(bytes, PAGE, PAGE, image::ExtendedColorType::L8)
            .map_err(|e| refused("not_written", e.to_string()))?;
        pages.push(json!({"page": page, "png": write_named(out, &png, "png")?}));
    }
    Ok((json!(labels), json!(pages)))
}

/// The frames a call draws, in order: `frames` of them from `from`, each seek jumping once.
fn frame_order(from: u64, frames: u64, seeks: &[(u64, u64)]) -> Vec<u64> {
    let mut left: Vec<(u64, u64)> = seeks.to_vec();
    let mut n = from;
    let mut order = Vec::with_capacity(frames as usize);
    for _ in 0..frames {
        order.push(n);
        n = match left.iter().position(|(after, _)| *after == n) {
            Some(k) => left.remove(k).1,
            None => n + 1,
        };
    }
    order
}

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    match run(app, out, call) {
        Ok(v) | Err(v) => v,
    }
}

fn run(app: &mut App, out: &str, call: &Value) -> Result<Value, Value> {
    // The cold report's build time runs from here to the first frame's scene, less the view's
    // opening, which compiles (#428).
    let started = std::time::Instant::now();
    let mut args = parse(call)?;
    // A document that names packs draws as the check lowers it, the call's packs installed
    // first (#429).
    let packs = install(&args.packs)?;
    let packed = args.doc["packs"].as_array().is_some_and(|p| !p.is_empty());
    let mut lowered_doc = if packed {
        Some(lowered(&args.doc, &packs)?)
    } else {
        None
    };
    let noop = app.backend == Backend::Noop;
    if noop && !args.clicks.is_empty() {
        return Err(refused(
            "bad_input",
            "a click reads the object-ID target, which the noop backend doesn't draw",
        ));
    }
    // Status can show in a view3d call exactly when the document has a status binding (the
    // status-color rule's first case); then its data roles keep the look's distance (#382).
    let mut bindings = status::bindings(&args.doc)?;
    let bound = !bindings.is_empty();
    // The planted guard runs (and shows a legend) where status can't show: the bug AC1 catches.
    let shows = bound || app.planted == Some(Planted::GuardEverywhere);
    let status = if shows {
        let status = args
            .status
            .clone()
            .ok_or_else(|| refused("status_unmapped", "look: status"))?;
        if bound {
            if let Some(r) =
                status::clash(&args.doc, &args.look_json, &args.look, &status, &args.theme)
            {
                return Err(r);
            }
        }
        Some(status)
    } else {
        None
    };
    let size = args.size;
    let timings = args.timings && !noop;
    let opening = std::time::Instant::now();
    let opened = session3::open_doc(app, size, timings, shows, &args.doc)?;
    session3::surface(app, args.surface)?;
    if args.cull_on_cpu {
        session3::cull_on_cpu(app);
    }
    let opening = opening.elapsed();
    let mut build_ms = None;
    let (ui, fx) = (opened.ui.clone(), opened.fx.clone());
    // What the view compiled as it opened, before its first frame (#854).
    let mut cold = args.cold.then(|| (session3::pipelines(app), Value::Null));
    let mut text = status::Text::default();
    let mut report = (Value::Array(Vec::new()), Value::Array(Vec::new()));
    let mut moved: Option<u32> = None;
    let doc_seed = args.doc["seed"].as_u64().unwrap_or(0);
    if let Some(w) = &args.window {
        deep_app::gpu_view::watch(&ui);
        app.window(w.size)?;
        let win = app.window.as_ref().expect("opened above");
        let mut p = win.paint.borrow_mut();
        p.page = (32, vec![w.page]);
        p.view = w.view;
        p.size = size;
        p.card = None;
        p.waits_on_gpu = false;
        p.overlays.clear();
        p.pairs_newest = app.planted == Some(Planted::PairsNewestSlot);
        p.ui = Some(ui.clone());
    }
    let mut labels = Labels::new();
    labels.fixed_em = app.planted == Some(Planted::LabelMask);
    let mut frames = Vec::new();
    // Whether any frame drew an object's outline.
    let mut strokes = false;
    // Held slots, each with the frame whose present releases it.
    let mut held: Vec<(u64, usize)> = Vec::new();
    let wants_targets = ["linear", "ids", "pre_tone"]
        .iter()
        .any(|t| args.targets.contains(*t));
    // The bloom's lens dirt (#418): a PNG the assets name, its red channel ÷ 255, or seeded, made
    // once for the whole call; and as the `dirt` target, sampled at each pixel of the frame.
    let dirt = match args.look_json["bloom"]["dirt"]["texture"].as_str() {
        Some("seeded") | None => None,
        Some(sha) => Some(Arc::new(dirt_png(&args.assets, sha)?)),
    };
    let mut dirt_file: Option<String> = None;
    let mut levels = Levels::new(
        std::mem::take(&mut args.docs),
        app.planted == Some(Planted::LoadsEverything),
    );
    // An asset's bytes by hash, and a JSON glTF's external files as `<sha>/<uri>` (#423).
    let (assets, uris) = (args.assets.clone(), args.uris.clone());
    let read = move |key: &str| -> Option<Vec<u8>> {
        let sha = match key.split_once('/') {
            Some((gltf, uri)) => uris.get(gltf)?.get(uri)?.as_str(),
            None => key,
        };
        std::fs::read(assets.get(sha)?).ok()
    };
    // Each scene import's report, and every image's path by hash for the decode worker.
    let mut map_paths = args.assets.clone();
    let import_report = crate::textures::imports(
        &args.doc,
        &read,
        &args.licenses,
        args.store.as_ref(),
        &mut map_paths,
    )?;
    let mut receipt = Value::Null;
    // Level of detail and the light cut, chosen from each frame's view (#425).
    let mut selection = crate::lod::Selection::new(app.planted);
    let drawn_scale = if args.surface.scale < 1.0 && !noop {
        args.surface.scale
    } else {
        1.0
    };
    // Whether the key sun drew its cascades in any frame: the shadow pass the reply lists (#424).
    let mut casts = false;
    // #419: the document's reading holds, its worlds' bakes (whose step hashes the reply reports),
    // the samples a live view holds while it settles at rest, and the viewer's session state.
    let mut holds = deep_canvas_scene3d::samples::holds(&args.doc);
    let mut worlds: BTreeMap<String, deep_canvas_scene3d::fixtures::World> = BTreeMap::new();
    for (id, item) in args.doc["items"].as_object().into_iter().flatten() {
        if item["kind"] == "fixture.world@1" {
            let w =
                deep_canvas_scene3d::fixtures::bake(&item["params"], &format!("items/{id}/params"))
                    .map_err(|r| refused(r.code, r.path))?;
            worlds.insert(id.clone(), w);
        }
    }
    let mut settle: Vec<(f64, Part)> = Vec::new();
    let mut settled_on: Option<Scene> = None;
    let mut hover: Option<String> = None;
    let mut viewer_selection: Vec<String> = Vec::new();
    let result = (|| -> Result<(), Value> {
        // The lights the policy last left out: a change is reported once, by ID (#421).
        let mut left_out: Vec<String> = Vec::new();
        let mut dropped: Vec<String> = Vec::new();
        for n in frame_order(args.from, args.frames, &args.seeks) {
            let frame_started = std::time::Instant::now();
            // A seek applies every patch up to the frame it opens at.
            let mut patched = false;
            for (k, (frame, writer, ops)) in args.patches.iter().enumerate() {
                if *frame == n || (n == args.from && *frame < n) {
                    apply_patch(&mut args.doc, writer, ops, k)?;
                    patched = true;
                }
            }
            // Viewer-only input (#419): the hover and selection are session state; a readout's
            // text changes as its template's bound value would.
            for (frame, v) in &args.viewer {
                if *frame != n && !(n == args.from && *frame < n) {
                    continue;
                }
                if let Some(h) = v.get("hover") {
                    hover = h.as_str().map(str::to_string);
                }
                if let Some(sel) = v.get("selection").and_then(Value::as_array) {
                    viewer_selection = sel
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect();
                }
                if let (Some(item), Some(text)) = (
                    v.pointer("/readout/item").and_then(Value::as_str),
                    v.pointer("/readout/text"),
                ) {
                    let at = format!("/items/{item}/params/template");
                    match args.doc.pointer_mut(&at) {
                        Some(slot) => *slot = text.clone(),
                        None => {
                            return Err(refused("bad_input", format!("viewer: readout {item}")));
                        }
                    }
                    patched = true;
                }
            }
            if patched {
                holds = deep_canvas_scene3d::samples::holds(&args.doc);
            }
            // The patched document's bindings are the ones drawn (a slice op can't add or
            // remove one, only leave one dangling, which refuses), and its roles keep the
            // distance.
            if patched {
                if packed {
                    lowered_doc = Some(lowered(&args.doc, &packs)?);
                }
                bindings = status::bindings(&args.doc)?;
                if let Some(status) = status.as_ref().filter(|_| bound) {
                    if let Some(r) =
                        status::clash(&args.doc, &args.look_json, &args.look, status, &args.theme)
                    {
                        return Err(r);
                    }
                }
            }
            let t = (n * FLICKS_PER_SECOND / args.fps) as i64;
            levels.collect();
            let (mut composed, resident) =
                levels.compose(lowered_doc.as_ref().unwrap_or(&args.doc));
            if !args.hidden.is_empty() {
                composed = without_layers(&composed, &args.hidden);
            }
            let outlines = &pack_sealed()?.outlines;
            let mut scene =
                evaluate_sourced(&composed, t, &args.look, &mut labels, &read, outlines)
                    .map_err(|r| refused(r.code, r.path))?;
            if build_ms.is_none() {
                build_ms = Some(started.elapsed().saturating_sub(opening).as_secs_f64() * 1e3);
            }
            let values = if args.evaluate.is_empty() {
                None
            } else {
                Some(values_at(&composed, t, &args.evaluate)?)
            };
            // Its maps, made ready in the decode worker once per run and held to the
            // document's decoded-image cap (#423).
            let (texels, made) = crate::textures::prepare(app, &scene, &map_paths)?;
            scene.texels = texels;
            // Over a window's flat page the view shows the page where nothing draws, so what it
            // lays over the page (a shadow catcher's alpha) composites in linear light (#424).
            if let Some(w) = &args.window {
                scene.ground = w.page;
            }
            // The view's cutaway, in session state, over the document's (#424).
            if let Some(c) = &args.cutaway {
                let look = &args.look;
                let cut = deep_canvas_scene3d::cut::cutaway(
                    "view",
                    c,
                    "cutaway",
                    |r| {
                        look.role(r).map(|c| {
                            c.map(|v| deep_canvas::color::srgb_decode(f64::from(v) / 255.0))
                        })
                    },
                    look.basis == deep_canvas_scene3d::look::Basis::Physical,
                )
                .map_err(|r| refused(r.code, r.path))?;
                scene.set_cutaway(Some(cut));
            }
            if n == args.from {
                receipt = made;
            }
            // A particles@1 count past its class's limit is refused, never clamped (#420).
            let class = args.doc.pointer("/budget/class").and_then(Value::as_str);
            if let Some(path) = effects::count_refusal(&scene, class) {
                return Err(refused("out_of_range", path));
            }
            // #420 AC6's wrong programs: mesh edges unwelded, or drawn over their faces.
            scene.plant_edges(
                app.planted == Some(Planted::EdgesUnwelded),
                app.planted == Some(Planted::EdgesSkipDepth),
            );
            let (choices, cut) = selection.apply(&mut scene, drawn_scale, noop);
            // Each mesh-edge line's segments, in world metres, as `counts` reports them.
            let edge_segments: Map<String, Value> = scene
                .layers
                .iter()
                .flat_map(|l| &l.lines)
                .filter(|l| l.edges.is_some())
                .map(|l| {
                    (
                        l.id.clone(),
                        json!(l.segments.iter().map(|s| [s.a, s.b]).collect::<Vec<_>>()),
                    )
                })
                .collect();
            // A stroke binding draws its outline around the object, exact (#386).
            if let Some(status) = status.as_ref().filter(|_| bound) {
                status::strokes(&mut scene, status, &bindings, &args.states)?;
            }
            strokes |= scene
                .layers
                .iter()
                .flat_map(|l| &l.solids)
                .any(|s| s.stroke.is_some());
            let scene = Arc::new(scene);
            let selected = levels.select(&composed, &scene);
            let settled = levels.settle(&selected);
            let seeding = match app.planted {
                Some(Planted::NoiseFromFrameCounter) => {
                    effects::Seeding::FrameCounter(n - args.from)
                }
                Some(Planted::NoiseFromClock) => effects::Seeding::Clock,
                _ => effects::Seeding::Item,
            };
            // #420 AC1's wrong program steps the operators' clock from the last frame drawn,
            // so a seek starts it again at zero; the shipped one reads t itself.
            let fx_t = match app.planted {
                Some(Planted::ParticlesIntegrate) => (n - args.from) as f64 / args.fps as f64,
                _ => n as f64 / args.fps as f64,
            };
            let settings = effects::settings(
                &scene,
                &args.look_json,
                &args.look,
                &args.selection,
                fx_t,
                doc_seed,
                seeding,
            );
            let mut settings = settings;
            if dirt.is_some() {
                settings.dirt = dirt.clone();
            }
            if args.targets.contains("dirt") && dirt_file.is_none() {
                if let Some(d) = &settings.dirt {
                    dirt_file = Some(write_named(out, &dirt_target(d, size), "f32")?);
                }
            }
            {
                let mut fx = lock(&fx);
                fx.settings = settings;
            }
            if args.look.drawn.is_some() {
                let assets = Map::new();
                *lock(&opened.drawn) =
                    crate::drawn::frame3(&args.doc, &args.look, &assets, &scene, app.planted)?;
            }
            let label_report = if args.labels {
                Some(labels_json(&scene, out)?)
            } else {
                None
            };
            if let Some(win) = app.window.as_ref().filter(|_| args.window.is_some()) {
                let pictures = scene.overlays.iter().filter_map(overlay_picture).collect();
                let mut p = win.paint.borrow_mut();
                p.overlays.insert(n, pictures);
                p.current = n;
            }
            let delay = if args.latency.is_empty() {
                0
            } else {
                args.latency[(n as usize) % args.latency.len()]
            };
            let capture = args.capture.wants(n);
            let clicks: Vec<[f64; 2]> = args
                .clicks
                .iter()
                .filter(|(f, _)| *f == n)
                .map(|(_, at)| *at)
                .collect();
            let read_targets = (capture && wants_targets || !clicks.is_empty()) && !noop;
            // The planted wrong program reads the one pixel under the pointer (#424).
            let margin = if app.planted == Some(Planted::SinglePixelPick) {
                0
            } else {
                args.hit_margin
            };
            if let (Some(status), Some(stage)) = (&status, &opened.stage) {
                let (layer, marks, legend) = status::layer(
                    &scene,
                    &args.look,
                    args.look.role("ink").unwrap_or([0, 0, 0]),
                    status,
                    &bindings,
                    &args.states,
                    &mut text,
                )?;
                let distance = match app.planted {
                    Some(Planted::GuardHalfDistance) => status.min_distance / 2.0,
                    _ => status.min_distance,
                };
                let mode = match app.planted {
                    Some(Planted::GuardToGrey) => Mode::Grey,
                    _ => Mode::Line,
                };
                let mut st = lock(stage);
                st.guard = Some(status::guard_of(status, distance, mode));
                st.layer = Some(layer);
                if n == args.from {
                    report = (marks, legend);
                }
            }
            let evaluated = scene.clone();
            // The pipelines compiled while drawing this frame, for `counts` (#424).
            let compiled_before = session3::pipelines(app).len();
            // #419: the frame's sub-samples (Look: samples; Motion blur). Each is the pure
            // evaluation at its own time with its own offset, both from its index alone.
            let looks = &args.look.samples;
            let fps = args.fps as f64;
            let in_hold = holds.iter().any(|(a, b)| t >= *a && t <= *b);
            // `vary: time` spreads the look's own samples over a 180° shutter (Look: samples).
            let time_only = deep_canvas_scene3d::samples::Blur {
                samples: 1,
                ..Default::default()
            };
            let blur = args
                .look
                .blur
                .as_ref()
                .or(looks.vary.time.then_some(&time_only))
                .filter(|_| !in_hold && !noop);
            let shutter = blur.map_or(0.0, |b| b.shutter_s(fps) * FLICKS_PER_SECOND as f64);
            let edges = (
                app.planted == Some(Planted::EdgesUnwelded),
                app.planted == Some(Planted::EdgesSkipDepth),
            );
            let at_time = |tk: i64, labels: &mut Labels| -> Result<Scene, Value> {
                let mut sc = evaluate_sourced(&composed, tk, &args.look, labels, &read, outlines)
                    .map_err(|r| refused(r.code, r.path))?;
                sc.texels.clone_from(&scene.texels);
                sc.ground = scene.ground;
                sc.set_cutaway(scene.cutaway.clone());
                sc.plant_edges(edges.0, edges.1);
                if let Some(status) = status.as_ref().filter(|_| bound) {
                    status::strokes(&mut sc, status, &bindings, &args.states)?;
                }
                Ok(sc)
            };
            // A live view at rest (its frame draws as the one before it does) with `settle`
            // adds samples frame by frame until it holds the export's.
            let settling_view = !args.export && looks.settle && !noop;
            let at_rest = settling_view && {
                let prev = at_time(
                    t - (FLICKS_PER_SECOND as f64 / fps).round() as i64,
                    &mut labels,
                )?;
                blur::draws_same(&prev, &scene)
            };
            if app.planted == Some(Planted::SettleResetsEachFrame)
                || !at_rest
                || settled_on
                    .as_ref()
                    .is_some_and(|s| !blur::draws_same(s, &scene))
            {
                settle.clear();
            }
            let pixel = if args.export {
                looks.export
            } else if at_rest {
                (settle.len() as u32 + 1).min(looks.export)
            } else {
                looks.live
            };
            // Motion blur by samples: its shutter times, unless nothing travels half a pixel.
            let mut notices: Vec<Value> = Vec::new();
            let mut blur_n = 0;
            let mut timed: Vec<Scene> = Vec::new();
            if let Some(b) =
                blur.filter(|b| b.method == deep_canvas_scene3d::samples::Method::Samples)
            {
                let mut n_b = b.samples;
                if !args.export {
                    if let Some(cap) = b.preview_cap.filter(|c| *c < n_b) {
                        n_b = cap;
                        notices.push(json!({"code": "motion_blur_capped", "samples": cap}));
                    }
                }
                let n_all = n_b.max(pixel);
                let plan = deep_canvas_scene3d::samples::plan(n_all, pixel, looks, true);
                let times: Vec<i64> = plan
                    .iter()
                    .map(|s| t + (s.time * shutter).round() as i64)
                    .collect();
                for tk in &times {
                    let mut sc = at_time(*tk, &mut labels)?;
                    if app.planted == Some(Planted::SamplerHoldsCamera) {
                        sc.camera = scene.camera.clone();
                    }
                    // `exclude`: those items keep their frame-time evaluation.
                    for l in sc.layers.iter_mut() {
                        for s in l.solids.iter_mut().filter(|s| b.exclude.contains(&s.id)) {
                            if let Some(f) = scene
                                .layers
                                .iter()
                                .flat_map(|l| &l.solids)
                                .find(|f| f.id == s.id)
                            {
                                *s = f.clone();
                            }
                        }
                    }
                    timed.push(sc);
                }
                let moves = match (timed.first(), timed.last()) {
                    (Some(a), Some(z)) if b.adaptive => blur::travel(a, z) >= 0.5,
                    (Some(a), Some(z)) => !blur::draws_same(a, z),
                    _ => false,
                };
                if moves {
                    blur_n = n_all;
                    // #419 AC5's wrong program steps each world to each sample's time.
                    if app.planted == Some(Planted::SamplerStepsWorld) {
                        for w in worlds.values_mut() {
                            for tk in &times {
                                let x = *tk as f64 / FLICKS_PER_SECOND as f64 * w.step_hz;
                                let k = (x.floor().max(0.0) as usize).min(w.states.len() - 1);
                                let dt = (x - k as f64) / w.step_hz;
                                w.states[k] = w.step(&w.states[k], dt);
                            }
                        }
                    }
                } else {
                    timed.clear();
                }
            }
            let n_all = if blur_n > 0 { blur_n } else { pixel };
            let plan = deep_canvas_scene3d::samples::plan(n_all, pixel, looks, blur_n > 0);
            let velocity_on =
                blur.is_some_and(|b| b.method == deep_canvas_scene3d::samples::Method::Velocity);
            // Motion blur by velocity: the renderer's velocity target reads the evaluations at
            // t ± s/2, never an earlier frame.
            let mut moving = scene.clone();
            if let (true, Some(b)) = (velocity_on, blur) {
                let open = at_time(t - (shutter / 2.0).round() as i64, &mut labels)?;
                let close = at_time(t + (shutter / 2.0).round() as i64, &mut labels)?;
                let pairing = match app.planted {
                    Some(Planted::VelocityFromTransform) => blur::Pairing::TransformOnly,
                    Some(Planted::VelocityPairsByIndex) => blur::Pairing::ByIndex,
                    _ => blur::Pairing::Shipped,
                };
                let (motion, topology) = blur::motion(&scene, &open, &close, pairing, b);
                for item in &topology {
                    notices.push(json!({"code": "velocity_topology", "item": item}));
                }
                let mut sc = (*scene).clone();
                sc.motion = Some(Arc::new(motion));
                moving = Arc::new(sc);
            }
            let noise_from_frame = app.planted == Some(Planted::SoftNoiseFromFrame);
            let sub_scene = |k: usize| -> Arc<Scene> {
                let mut sc = if timed.is_empty() {
                    (*moving).clone()
                } else {
                    timed[k].clone()
                };
                sc.jitter = plan[k].offset;
                // Under samples per frame the point on the light moves with the sample's index
                // (#446; Light policy: soft shadows).
                sc.sample_turn = (plan.len() > 1).then(|| {
                    deep_canvas_scene3d::samples::r2(k as u32 + 13)[0] * std::f64::consts::TAU
                });
                if noise_from_frame {
                    sc.sample_turn = Some(n as f64 * 2.399963);
                }
                Arc::new(sc)
            };
            // The viewer's marks draw over the frame, never in it: its selection, hover and
            // readouts, from one more draw at sample 0 laid over the resolved frame.
            let mut over_selection = args.selection.clone();
            over_selection.extend(viewer_selection.iter().cloned());
            over_selection.extend(hover.iter().cloned());
            let overlay = !scene.readouts.is_empty() || over_selection.len() > args.selection.len();
            let mut drawn_over = None;
            if overlay {
                let mut sc = (*sub_scene(0)).clone();
                let readouts = std::mem::take(&mut sc.readouts);
                match sc.layers.first_mut() {
                    Some(l) => l.labels.extend(readouts),
                    None => sc.layers.push(deep_canvas_scene3d::scene::Layer3 {
                        labels: readouts,
                        ..Default::default()
                    }),
                }
                let plain = lock(&fx).settings.clone();
                let mut with = plain.clone();
                with.selection = effects::settings(
                    &scene,
                    &args.look_json,
                    &args.look,
                    &over_selection,
                    fx_t,
                    doc_seed,
                    effects::Seeding::Item,
                )
                .selection;
                lock(&fx).settings = with;
                let d = session3::draw(
                    app,
                    &opened,
                    Arc::new(sc),
                    args.look.clone(),
                    n,
                    0,
                    false,
                    false,
                );
                lock(&fx).settings = plain;
                drawn_over = Some(d?);
                let _ = ui.latch();
            }
            // The samples drawn now: all but sample 0 first, then sample 0, the frame's own draw;
            // or, settling, the one sample this frame adds (sample 0 again once settled).
            let settling_now = at_rest && !args.export;
            let new_k: usize = if settling_now {
                settle.len().min(n_all as usize - 1)
            } else {
                0
            };
            let mut subs: Vec<(f64, Part)> = Vec::new();
            if !settling_now {
                for k in 1..n_all as usize {
                    subs.push((
                        plan[k].weight,
                        Part::of(&session3::draw(
                            app,
                            &opened,
                            sub_scene(k),
                            args.look.clone(),
                            n,
                            0,
                            true,
                            false,
                        )?),
                    ));
                    // Shown and passed over, so its slot frees for the next.
                    let _ = ui.latch();
                }
            }
            // A frame's CPU: its evaluation, up to handing the scene to the render side.
            let cpu_ms = frame_started.elapsed().as_secs_f64() * 1e3;
            let mut drawn = session3::draw(
                app,
                &opened,
                sub_scene(if settling_now && settle.len() < n_all as usize {
                    new_k
                } else {
                    0
                }),
                args.look.clone(),
                n,
                delay,
                read_targets || overlay,
                shows && n == args.from,
            )?;
            let plain0 = drawn.bytes.clone();
            if settling_now {
                if settle.len() < n_all as usize {
                    settle.push((plan[new_k].weight, Part::of(&drawn)));
                    settled_on = Some((*scene).clone());
                }
                let parts: Vec<(f64, &Part)> = settle.iter().map(|(w, d)| (*w, d)).collect();
                mean(&mut drawn, &parts);
            } else if !subs.is_empty() {
                let first = Part::of(&drawn);
                let mut parts: Vec<(f64, &Part)> = vec![(plan[0].weight, &first)];
                parts.extend(subs.iter().map(|(w, d)| (*w, d)));
                mean(&mut drawn, &parts);
            }
            let drawn_samples = if settling_now {
                settle.len() as u32
            } else {
                n_all
            };
            let samples_report = json!({
                "drawn": drawn_samples,
                "settling": settling_now && drawn_samples < looks.export,
            });
            let scene_bytes = drawn.bytes.clone();
            // The viewer's marks laid over the resolved frame where they drew.
            if let (Some(over), Some(plain), Some(bytes)) =
                (&drawn_over, &plain0, drawn.bytes.as_mut())
            {
                if let Some(ob) = &over.bytes {
                    for ((o, p), b) in ob
                        .as_chunks::<4>()
                        .0
                        .iter()
                        .zip(plain.as_chunks::<4>().0)
                        .zip(bytes.as_chunks_mut::<4>().0)
                    {
                        if o != p {
                            *b = *o;
                        }
                    }
                }
            }
            casts |= !drawn.counts.shadow_maps.is_empty();
            let compiled: Vec<&'static str> = session3::pipelines(app)
                .into_iter()
                .skip(compiled_before)
                .collect();
            if n == args.from {
                moved = drawn.moved;
                // The first frame is settled once drawn: its time from the spawn, then which
                // pipelines it compiled.
                if let Some((before, report)) = cold.as_mut() {
                    let ms = since_spawn_ms();
                    let pipelines: Vec<Value> = session3::pipelines(app)
                        .into_iter()
                        .map(|p| json!({"name": p, "on_first_frame": !before.contains(&p)}))
                        .collect();
                    *report =
                        json!({"since_spawn_ms": ms, "pipelines": pipelines, "build_ms": build_ms});
                }
            }
            // A material operator that can't draw refuses the frame, never drawn without it.
            if let Some((op, why)) = drawn.counts.operators_refused.first() {
                return Err(refused("operator_compile", format!("{op}: {why}")));
            }
            if delay > 0 {
                held.push((n + delay, drawn.slot));
            }
            // A held slot turns ready when the frame its hold names is presented.
            let due: Vec<usize> = held
                .iter()
                .filter(|(f, _)| *f == n)
                .map(|(_, s)| *s)
                .collect();
            held.retain(|(f, _)| *f != n);
            if !due.is_empty() {
                app.worker.call(move |state| {
                    if let Some(s) = state.scene3d.as_mut() {
                        for slot in due {
                            s.view.release(slot);
                        }
                    }
                });
            }
            let mut frame = Map::new();
            frame.insert("frame".into(), json!(n));
            frame.insert("settled".into(), json!(settled));
            frame.insert("samples".into(), samples_report);
            if !notices.is_empty() {
                frame.insert("notices".into(), json!(notices));
            }
            frame.insert("resident".into(), json!(resident));
            if let Some(values) = values {
                frame.insert("values".into(), values);
            }
            if let Some(bytes) = drawn.gpu_bytes {
                frame.insert("gpu_bytes".into(), json!(bytes));
            }
            let (frame_seq, window_name) = match (&args.window, app.window.as_ref()) {
                (Some(_), Some(win)) => {
                    win.present(&mut app.cx);
                    let shown = win.paint.borrow().shown;
                    let name = if capture {
                        let image = win
                            .capture(&mut app.cx)
                            .map_err(|e| refused("no_capture", e))?;
                        Some(write_named(
                            out,
                            &png(image.as_raw(), [image.width(), image.height()])?,
                            "png",
                        )?)
                    } else {
                        None
                    };
                    (shown, name)
                }
                _ => (ui.latch().map(|(_, f)| f), None),
            };
            frame.insert("frame_seq".into(), json!(frame_seq.unwrap_or(n)));
            frame.insert(
                "pixel_hash".into(),
                json!(drawn.bytes.as_ref().map(|b| hex(b))),
            );
            if capture {
                if let (Some(bgra), true) = (&drawn.bytes, args.targets.contains("final")) {
                    frame.insert("final".into(), json!(write_final(out, bgra, size)?));
                }
                // The frame before the viewer's marks (#419).
                if let (Some(bgra), true) = (&scene_bytes, args.targets.contains("scene")) {
                    frame.insert("scene".into(), json!(write_final(out, bgra, size)?));
                }
                if let (Some(pre), true) = (&drawn.pre_tone, args.targets.contains("pre_tone")) {
                    frame.insert("pre_tone".into(), json!(write_named(out, pre, "f32")?));
                }
                if let Some(name) = &dirt_file {
                    frame.insert("dirt".into(), json!(name));
                }
                if !args.read.is_empty() {
                    // Each operator output as it stood when this frame drew (#483).
                    let (keys, fx2, dir) = (args.read.clone(), fx.clone(), out.to_string());
                    let read = app.worker.call(move |state| -> Result<Value, Value> {
                        let device = state.gpu.device();
                        let fx = lock(&fx2);
                        let ops = fx.docops.as_ref().ok_or_else(|| {
                            refused(
                                "bad_input",
                                "read names an operator output, and the document runs no operator",
                            )
                        })?;
                        let mut m = serde_json::Map::new();
                        for k in &keys {
                            m.insert(
                                k.clone(),
                                crate::opframe::read_one(
                                    &device,
                                    ops,
                                    &Default::default(),
                                    k,
                                    &dir,
                                )?,
                            );
                        }
                        Ok(Value::Object(m))
                    })?;
                    frame.insert("read".into(), read);
                }
                if let Some((linear, ids)) = &drawn.targets {
                    if args.targets.contains("linear") {
                        frame.insert("linear".into(), json!(write_named(out, linear, "f32")?));
                    }
                    if args.targets.contains("ids") {
                        frame.insert(
                            "ids".into(),
                            json!(write_named(out, &png(ids, size)?, "png")?),
                        );
                        frame.insert("picks".into(), picks_json(&drawn.picks));
                    }
                }
                if let Some(name) = window_name {
                    frame.insert("window".into(), json!(name));
                }
            }
            if let Some((labels, pages)) = label_report {
                frame.insert("labels".into(), labels);
                frame.insert("pages".into(), pages);
            }
            // Per-pixel items that ran out of room at the class's cap drew sorted (#424).
            if drawn.counts.fragments_capped {
                frame
                    .entry("notices")
                    .or_insert_with(|| json!([]))
                    .as_array_mut()
                    .expect("a list")
                    .push(json!({"code": "fragments_capped", "fragments": drawn.counts.fragments}));
            }
            // Lights the budget left out, and shadows it dropped, reported once per change.
            let c = &drawn.counts;
            if c.lights_left_out != left_out || c.shadows_dropped != dropped {
                left_out.clone_from(&c.lights_left_out);
                dropped.clone_from(&c.shadows_dropped);
                let notice =
                    json!({"code": "lights_over_budget", "lights": left_out, "shadows": dropped});
                frame
                    .entry("notices")
                    .or_insert_with(|| json!([]))
                    .as_array_mut()
                    .expect("a list")
                    .push(notice);
            }
            if args.counts {
                let c = &drawn.counts;
                let encoded: Vec<Value> = c
                    .encoded
                    .iter()
                    .map(|(batch, items)| json!({"batch": batch, "items": items}))
                    .collect();
                frame.insert("encoded".into(), json!(encoded));
                frame.insert("replayed".into(), json!(c.replayed));
                frame.insert("instances_written".into(), json!(c.instances_written));
                frame.insert("cpu_culled".into(), json!(c.cpu_culled));
                frame.insert("counts_read_back".into(), json!(c.counts_read_back));
                let draws: Vec<Value> = c
                    .indirect
                    .iter()
                    .map(|(item, view, batch)| json!({"item": item, "view": view, "batch": batch}))
                    .collect();
                frame.insert("indirect_draws".into(), json!(draws));
                frame.insert("meshes_built".into(), json!(c.meshes_built));
                frame.insert("compiled".into(), json!(compiled));
                frame.insert("segments".into(), Value::Object(edge_segments));
            }
            if args.lod {
                frame.insert("lod".into(), crate::lod::rows(&choices));
            }
            if args.cull_report && capture && !noop {
                let mut rows = Vec::new();
                for r in session3::kept(app) {
                    let bytes: Vec<u8> = r.ids.iter().flat_map(|w| w.to_le_bytes()).collect();
                    let kept = write_named(out, &bytes, "u32")?;
                    rows.push(json!({
                        "item": r.item, "view": r.view, "batch": r.batch,
                        "count": r.ids.len(), "kept": kept,
                    }));
                }
                frame.insert("cull".into(), json!(rows));
            }
            if args.light_cut {
                frame.insert("light_cut".into(), crate::lod::cut_json(&evaluated, &cut));
            }
            if args.masks && capture && !noop {
                let mut rows = Vec::new();
                for c in choices.iter().filter(|c| c.bands.len() == 2) {
                    let (Some(level), Some(&(_, key))) =
                        (c.blend, drawn.picks.iter().find(|(id, _)| *id == c.item))
                    else {
                        continue;
                    };
                    for (pass, size, bytes) in session3::masks(app, key, level) {
                        let file = write_named(out, &bytes, "u8")?;
                        rows.push(
                            json!({"item": c.item, "pass": pass, "size": size, "file": file}),
                        );
                    }
                }
                frame.insert("masks".into(), json!(rows));
            }
            if args.cascades {
                // Each shadow map the key sun draws: its key, which holds the planes that cut its
                // casters, and its texel in m (#424).
                let maps: Vec<Value> = drawn
                    .counts
                    .shadow_maps
                    .iter()
                    .enumerate()
                    .map(|(i, (key, texel, clip))| {
                        let drawn = drawn.counts.cascades_drawn.contains(&(i as u32));
                        json!({"key": format!("{key:016x}"), "texel_m": texel, "clip": clip, "drawn": drawn})
                    })
                    .collect();
                frame.insert(
                    "cascades".into(),
                    json!({"splits": drawn.counts.cascade_splits, "maps": maps}),
                );
            }
            if args.shadows {
                let counts = &drawn.counts;
                let mut passes = counts.cascades_drawn.len() as u32;
                let maps: Vec<Value> = counts
                    .local_maps
                    .iter()
                    .map(|m| {
                        passes += if m.drawn { m.faces } else { 0 };
                        let kind = match m.faces {
                            1 => "spot",
                            5 => "area",
                            _ => "point",
                        };
                        json!({"light": m.light, "kind": kind, "key": format!("{:016x}", m.key), "drawn": m.drawn})
                    })
                    .collect();
                frame.insert("shadows".into(), json!({"passes": passes, "maps": maps}));
            }
            if let Some((gpu_ms, passes)) = &drawn.timing {
                frame.insert("gpu_ms".into(), json!(gpu_ms));
                frame.insert("cpu_ms".into(), json!(cpu_ms));
                frame.insert("passes_ms".into(), json!(passes));
            }
            if !clicks.is_empty() {
                let ids = drawn.targets.as_ref().map(|(_, ids)| ids.as_slice());
                let answered: Vec<Value> = clicks
                    .iter()
                    .map(|at| {
                        let p = ids.and_then(|ids| {
                            pick(
                                &evaluated,
                                ids,
                                drawn.depth.as_ref(),
                                &drawn.picks,
                                size,
                                *at,
                                margin,
                            )
                        });
                        json!({"at": at, "pick": p})
                    })
                    .collect();
                frame.insert("clicks".into(), json!(answered));
            }
            frames.push(Value::Object(frame));
        }
        Ok(())
    })();
    if args.window.is_some() {
        deep_app::gpu_view::unwatch(&ui);
        if let Some(win) = app.window.as_ref() {
            let mut p = win.paint.borrow_mut();
            p.ui = None;
            p.overlays.clear();
        }
    }
    session3::close(app);
    // An over-cap document is refused, its imports still reported: the import comes before the
    // count it makes (#423).
    if let Err(mut r) = result {
        if args.imports && r["code"] == "over_budget" {
            r["imports"] = json!(import_report);
        }
        return Err(r);
    }
    // The frame's passes in order: the shadow map when a sun casts, geometry, the effects and
    // the output.
    let effects = lock(&fx);
    let mut passes = Vec::new();
    if effects.settings.shadow.is_some() || casts {
        passes.push(json!({"name": SHADOW_PASS, "reads": [], "writes": ["shadow"]}));
    }
    passes.push(json!({"name": GEOMETRY_PASS, "reads": [], "writes": ["linear", "ids", "depth"]}));
    for p in effects.passes() {
        passes.push(
            json!({"name": p.name, "reads": p.reads, "writes": p.writes, "operator": p.operator}),
        );
    }
    passes.push(json!({"name": OUTPUT_PASS, "reads": ["linear"], "writes": ["final"]}));
    // Below internal scale 1, the guard writes the internal frame, the upscale and sharpen
    // return it to full size, and thin lines, outlines and status colors draw after them,
    // depth-tested (#386); the planted status colors draw before the upscale.
    let below = args.surface.scale < 1.0 && !noop;
    let early = below && app.planted == Some(Planted::StatusBeforeUpscale);
    if shows {
        passes.push(json!({"name": GUARD_PASS, "reads": ["final"], "writes": ["final"]}));
    }
    let colors = json!({"name": COLORS_PASS, "reads": ["final", "depth"], "writes": ["final"]});
    if shows && early {
        passes.push(colors.clone());
    }
    if below {
        passes.push(json!({"name": UPSCALE_PASS, "reads": ["final"], "writes": ["upscaled"]}));
        passes.push(json!({"name": SHARPEN_PASS, "reads": ["upscaled"], "writes": ["final"]}));
    }
    if strokes || below {
        passes.push(json!({"name": OUTLINE_PASS, "reads": ["depth"], "writes": ["final"]}));
    }
    if shows && !early {
        passes.push(colors);
    }
    let status_report = status::report(
        shows,
        "document",
        status.as_ref().map(|s| s.min_distance),
        shows.then_some(moved),
        report.0,
        report.1,
    );
    let internal = if below {
        surface::scaled(size, args.surface.scale)
    } else {
        size
    };
    let drew = json!({
        "internal_scale": if below { args.surface.scale } else { 1.0 },
        "upscale": if below { args.surface.upscale.name() } else { "none" },
        "sharpen": args.surface.sharpen,
        "size_px": size, "internal_px": internal,
    });
    let mut reply = json!({
        "frames": frames, "passes": passes, "status": status_report, "surface": drew,
        "layers": layers_report(&args.doc, &args.hidden),
    });
    if !worlds.is_empty() {
        reply["worlds"] = Value::Object(
            worlds
                .iter()
                .map(|(id, w)| (id.clone(), json!({"step_hashes": w.hashes()})))
                .collect(),
        );
    }
    if args.imports {
        reply["imports"] = json!(import_report);
    }
    if args.receipt {
        reply["receipt"] = receipt;
    }
    if let Some((_, report)) = cold {
        reply["cold"] = report;
    }
    if timings {
        reply["profiler"] =
            json!({"name": "wgpu-profiler", "version": env!("DEEP_WGPU_PROFILER_VERSION")});
    }
    Ok(reply)
}
