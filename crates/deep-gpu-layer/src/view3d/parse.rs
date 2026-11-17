use super::*;

pub(super) struct Args {
    pub(super) doc: Value,
    pub(super) look: Look3,
    /// The look as given: its bloom and ground grid turn effects on (#380).
    pub(super) look_json: Value,
    /// The session's selection, whose items draw their outlines (#380).
    pub(super) selection: Vec<String>,
    /// The first frame latched: the session opens there, a seek (#380).
    pub(super) from: u64,
    /// Each frame's GPU time and each pass's, from wgpu-profiler (#380).
    pub(super) timings: bool,
    pub(super) size: [u32; 2],
    pub(super) frames: u64,
    pub(super) fps: u64,
    /// `(frame, writer, ops)`, in the call's order.
    pub(super) patches: Vec<(u64, String, Value)>,
    pub(super) targets: BTreeSet<String>,
    pub(super) capture: Capture,
    /// #166: each captured frame lists the rain rings alive on each water part.
    pub(super) rings: bool,
    /// #268: each captured frame reports the water's shore field: its key, bytes and bake time.
    pub(super) shore: bool,
    /// Operator outputs each captured frame reads back (#483).
    pub(super) read: Vec<String>,
    /// `cull: "cpu"`: the document drawn from the CPU's f64 cull, the reference a GPU frame is
    /// judged against (#484).
    pub(super) cull_on_cpu: bool,
    /// Each captured frame reports what each culled list kept (#484).
    pub(super) cull_report: bool,
    /// `occlusion: "off"`: the camera's lists culled by the frustum alone (#1637).
    pub(super) occlusion_off: bool,
    /// `(after, to)`: right after frame `after` draws, the session jumps to frame `to` (#484).
    pub(super) seeks: Vec<(u64, u64)>,
    pub(super) window: Option<Window3>,
    pub(super) latency: Vec<u64>,
    pub(super) counts: bool,
    /// `ground_points: {item, at: [[x, z]]}`: each frame reports the height a terrain plate draws
    /// at each point, with its tile and level (#2017).
    pub(super) ground_points: Option<(String, Vec<[f64; 2]>)>,
    /// The glTF files `mesh.asset@1` items name, by sha256 (#420), and the images a material's
    /// maps or a glTF name (#423).
    pub(super) assets: std::collections::BTreeMap<String, std::path::PathBuf>,
    /// A JSON glTF's external buffers and images: `{glTF sha → {uri → sha}}` (#423).
    pub(super) uris: BTreeMap<String, BTreeMap<String, String>>,
    /// An asset's license, by its hash (#423).
    pub(super) licenses: BTreeMap<String, Value>,
    /// The evidence store an import keeps each texture in, by hash (#423).
    pub(super) store: Option<std::path::PathBuf>,
    /// Report each scene import and the maps' receipt (#423).
    pub(super) imports: bool,
    pub(super) receipt: bool,
    /// The documents an item may open by reference, by doc handle.
    pub(super) docs: BTreeMap<String, std::path::PathBuf>,
    /// Report each label's glyphs and the atlas pages they sample (#381).
    pub(super) labels: bool,
    /// `(frame, at)`: a click at `at` view px while frame n is presented (#671).
    pub(super) clicks: Vec<(u64, [f64; 2])>,
    /// The selection's hit margin in px (#424; Selection: `hit.margin`), 3 unless the call says.
    pub(super) hit_margin: i64,
    /// A `cutaway@1`'s params as a view input in session state, applied to every frame (#424).
    pub(super) cutaway: Option<Value>,
    /// The record's state for each status binding's source (#382).
    pub(super) states: BTreeMap<String, String>,
    /// Report the first frame as a cold start: when it settled, from this process's spawn, and
    /// which pipelines it compiled (#854).
    pub(super) cold: bool,
    /// The theme the look's roles and status map resolve in (#382).
    pub(super) theme: String,
    /// The look's status map, when it has one (#382).
    pub(super) status: Option<Status>,
    /// The GPU surface the view draws through (#386).
    pub(super) surface: Surface,
    /// The pack folders installed before the document's check, by `owner/name` (#429), or
    /// `deepbuild/<name>` when the call names only the folder (#422).
    pub(super) packs: Vec<(Option<String>, std::path::PathBuf)>,
    /// The paths whose evaluated values each frame reports (#429).
    pub(super) evaluate: Vec<String>,
    /// #468: world points each frame projects through the camera it draws, as `projected`.
    pub(super) project: Vec<[f64; 3]>,
    /// The items whose drawn vertices and sway gust each frame reports, read back from the GPU
    /// (#2016).
    pub(super) sway: Vec<String>,
    /// #226: each frame reports the 3D axes' ticks, and the drawn vertices of these items.
    pub(super) axes: bool,
    pub(super) world: Vec<String>,
    /// Writer layers not visible in this session, which draw, light and cast nothing (#422).
    pub(super) hidden: BTreeSet<String>,
    /// Each frame reports the key sun's cascade splits (#422).
    pub(super) cascades: bool,
    /// Each frame reports its shadow passes and local maps (#446).
    pub(super) shadows: bool,
    /// Each frame reports its level-of-detail rows and its light cut, and each captured frame
    /// its band masks (#425).
    pub(super) lod: bool,
    pub(super) light_cut: bool,
    /// #506: each frame reports where its anchored overlays draw; #468: and where each one's
    /// leader ends.
    pub(super) overlays: bool,
    pub(super) masks: bool,
    /// The view's class (#419): an export draws every frame with all of the look's export
    /// samples and never settles; the live view draws its live samples while moving.
    pub(super) export: bool,
    /// Viewer-only input in session state, from the frame each names (#419): `{pointer, hover,
    /// selection, readout}`, never a document revision.
    pub(super) viewer: Vec<(u64, Value)>,
    /// #173: the frame cap, stalls, scrubs, your hand's orbit and the determinism check.
    pub(super) history: history::Inputs,
    /// #177: the view's HDR output, `hdr` and the stub display.
    pub(super) hdr: crate::hdr::Hdr,
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
pub(super) fn without_layers(doc: &Value, hidden: &BTreeSet<String>) -> Value {
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
pub(super) fn layers_report(doc: &Value, hidden: &BTreeSet<String>) -> Value {
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
pub(super) fn pack_sealed() -> Result<&'static deep_canvas::registry::Sealed, Value> {
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

pub(super) fn parse(call: &Value, planted: Option<Planted>) -> Result<Args, Value> {
    let bad = |what: &str| refused("bad_input", what);
    let path = call["doc"].as_str().ok_or_else(|| bad("doc is a path"))?;
    let text = std::fs::read_to_string(path).map_err(|e| bad(&format!("doc: {e}")))?;
    let mut doc: Value = serde_json::from_str(&text).map_err(|e| bad(&format!("doc: {e}")))?;
    let theme = status::theme_of(call)?;
    // #463: a look by ID is one of the call's packs' looks.
    let look_def = match &call["look"] {
        Value::String(id) => {
            let manifests = crate::op_transition::manifests(call)?;
            crate::look_ops::pack_def(id, &manifests, planted).ok_or_else(|| {
                refused(
                    "look_unknown",
                    format!("look: {id} isn't a look of the call's packs"),
                )
            })?
        }
        v => v.clone(),
    };
    let look_json = status::themed(&look_def, &theme);
    let look = Look3::read(&look_json).map_err(|e| bad(&format!("look: {e}")))?;
    let status = status::status_of(&look_json)?;
    let states = status::states(call).ok_or_else(|| bad("states maps handles to states"))?;
    let size = pair(&call["size"])
        .filter(|s| s[0] > 0 && s[1] > 0)
        .ok_or_else(|| bad("size is [w, h]"))?;
    if let Some(d) = doc.as_object_mut() {
        d.insert("size".into(), json!(size));
        // #508: an input track applied to the document's controls on the frame clock, as a played
        // form carries it inline (the motion module reads `track`).
        if let Some(track) = call.get("track").filter(|t| !t.is_null()) {
            d.insert("track".into(), track.clone());
        }
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
    let mut targets = call["targets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect::<BTreeSet<_>>();
    // #508: a capture that names no targets keeps each captured frame's final picture.
    if call.get("targets").is_none() && call.get("capture").is_some() {
        targets.insert("final".into());
    }
    if targets.iter().any(|t| {
        !matches!(
            t.as_str(),
            "final"
                | "linear"
                | "ids"
                | "pre_tone"
                | "dirt"
                | "scene"
                | "backdrop"
                | "depth"
                | "reflection"
                | "foam"
                | "normal"
                | "coc"
                | "checks"
                | "surface"
                | "window_linear"
        )
    }) {
        return Err(bad(
            "targets are final, linear, ids, pre_tone, dirt, scene, backdrop, depth, reflection, foam, normal, coc, surface, window_linear and checks",
        ));
    }
    // A render-back draws as an export does, through the view your hand turned (#173).
    let export = match call["class"].as_str() {
        None | Some("live") => false,
        Some("export" | "render_back") => true,
        Some(_) => return Err(bad("class is live, export or render_back")),
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
                (Some(size), Some(view), Some(page)) => Some(Window3 {
                    size,
                    view,
                    page,
                    card: crate::frames::card_of(w),
                }),
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
    let mut project = Vec::new();
    for p in call["project"].as_array().into_iter().flatten() {
        match p
            .as_array()
            .map(|a| a.iter().map(Value::as_f64).collect::<Option<Vec<_>>>())
        {
            Some(Some(v)) if v.len() == 3 => project.push([v[0], v[1], v[2]]),
            _ => return Err(bad("project lists world points [x, y, z]")),
        }
    }
    let mut sway = Vec::new();
    for id in call["sway"].as_array().into_iter().flatten() {
        match id.as_str() {
            Some(id) => sway.push(id.to_string()),
            None => return Err(bad("sway lists item IDs")),
        }
    }
    let world = call["world"].as_array().into_iter().flatten();
    let world: Option<Vec<String>> = world.map(|v| v.as_str().map(str::to_string)).collect();
    Ok(Args {
        axes: call["axes"].as_bool().unwrap_or(false),
        world: world.ok_or_else(|| bad("world lists item IDs"))?,
        packs,
        evaluate,
        project,
        sway,
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
        rings: call["rings"].as_bool().unwrap_or(false),
        shore: call["shore"].as_bool().unwrap_or(false),
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
        occlusion_off: match call["occlusion"].as_str() {
            None => false,
            Some("off") => true,
            Some(_) => return Err(refused("bad_input", "occlusion is \"off\" when it's given")),
        },
        seeks: call["seeks"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|s| Some((s["after"].as_u64()?, s["to"].as_u64()?)))
            .collect(),
        window,
        latency,
        counts: call["counts"].as_bool().unwrap_or(false),
        ground_points: match &call["ground_points"] {
            Value::Null => None,
            g => {
                let item = g["item"].as_str();
                let at: Option<Vec<[f64; 2]>> = g["at"].as_array().and_then(|a| {
                    a.iter()
                        .map(|p| Some([p.get(0)?.as_f64()?, p.get(1)?.as_f64()?]))
                        .collect()
                });
                match (item, at) {
                    (Some(item), Some(at)) => Some((item.to_string(), at)),
                    _ => return Err(bad("ground_points is {item, at: [[x, z]]}")),
                }
            }
        },
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
        overlays: call["overlays"].as_bool().unwrap_or(false),
        masks: call["masks"].as_bool().unwrap_or(false),
        export,
        viewer,
        history: history::inputs(call)?,
        hdr: crate::hdr::Hdr::parse(call)?,
    })
}

/// The packs a call installs (#429): each folder read as deep-show's pack store reads one
/// (`pack.json`, its `id` set to `owner/name`, each recipe file it names inlined) and admitted
/// through the pack check once.
pub(super) fn install(packs: &[(Option<String>, std::path::PathBuf)]) -> Result<Packs, Value> {
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

pub(super) fn issues_refused(issues: &[Issue]) -> Value {
    json!({"code": "refused", "issues": issues.iter().map(Issue::to_json).collect::<Vec<_>>()})
}

/// A document that names packs, as the check lowers it: its recipe instances expanded into their
/// derived items and their channels; refused with the check's issues when nothing expanded
/// (#429). A payload without the stored fields (#422's castle) still draws its expansion.
pub(super) fn lowered(doc: &Value, packs: &Packs) -> Result<Value, Value> {
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

/// What a click at `at` view px picks in a frame (canvas primitives: Selection, Spatial index):
/// the topmost 2D overlay whose shapes cover it, else the item the object-ID target holds there,
/// else nothing.
///
/// In 3D a pick reads the (2 × margin + 1)² window of the object-ID target around the pointer:
/// the drawn ID nearest the pointer, ties by depth, nearest the camera first (#424; Selection:
/// `hit.margin`), so a 1 px line or a point is pickable as in 2D.
pub(super) fn pick(
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

/// #1976's planted depth reader: each hit's point put back from the depth target, the view-axis
/// depth at the pointer's pixel unprojected through the pointer, as a hit must never be.
pub(super) fn depth_hits(
    hits: &mut [deep_canvas_scene3d::hit::Hit],
    cam: &deep_canvas_scene3d::scene::Camera,
    depth: Option<&[u8]>,
    size: [u32; 2],
    at: [f64; 2],
) {
    let i = at[1].floor() as usize * size[0] as usize + at[0].floor() as usize;
    let Some(z) = depth.and_then(|d| d.get(i * 4..i * 4 + 4)) else {
        return;
    };
    let p = cam.unproject(
        at[0],
        at[1],
        f64::from(f32::from_le_bytes([z[0], z[1], z[2], z[3]])),
    );
    let o = if cam.perspective {
        cam.eye
    } else {
        cam.unproject(at[0], at[1], 0.0)
    };
    for h in hits {
        h.point = p;
        h.distance = (0..3).map(|k| (p[k] - o[k]).powi(2)).sum::<f64>().sqrt();
    }
}

pub(super) fn srgb_decode(c: u8) -> f64 {
    let c = f64::from(c) / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

pub(super) fn srgb_encode(c: f64) -> u8 {
    let c = if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    };
    (c * 255.0).round().clamp(0.0, 255.0) as u8
}

/// A sub-sample's pixels: its final bytes and its linear target.
pub(super) struct Part {
    pub(super) bytes: Option<Vec<u8>>,
    pub(super) linear: Option<Vec<u8>>,
}

impl Part {
    pub(super) fn of(d: &session3::Drawn) -> Part {
        Part {
            bytes: d.bytes.clone(),
            linear: d.targets.as_ref().map(|(l, _)| l.clone()),
        }
    }
}

/// The frame as the weighted mean of its sub-samples, in index order (#419): the linear
/// target's values, and the final BGRA bytes averaged in linear light. A frame of one sample is
/// that sample as drawn.
pub(super) fn mean(drawn: &mut session3::Drawn, parts: &[(f64, &Part)]) {
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
pub(super) fn dirt_png(
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
pub(super) fn dirt_target(dirt: &deep_canvas_effects::interp::Image, size: [u32; 2]) -> Vec<u8> {
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
/// #468: each overlay's leader over the frame `bgra` (`size` px, premultiplied BGRA), its straight
/// RGBA picture laid on by its coverage.
pub(super) fn leaders_over(
    overlays: &[deep_canvas_scene3d::scene::Overlay],
    bgra: &mut [u8],
    size: [u32; 2],
) {
    for l in overlays.iter().filter_map(|o| o.leader.as_ref()) {
        let Some(p) = deep_canvas_scene3d::overlay::leader_picture(l) else {
            continue;
        };
        let w = i64::from(p.size[0]);
        for (k, s) in p.rgba.as_chunks::<4>().0.iter().enumerate() {
            let (dx, dy) = (p.at[0] + k as i64 % w, p.at[1] + k as i64 / w);
            let a = u32::from(s[3]);
            if a == 0 || dx < 0 || dy < 0 || dx >= i64::from(size[0]) || dy >= i64::from(size[1]) {
                continue;
            }
            let o = ((dy * i64::from(size[0]) + dx) * 4) as usize;
            let d = &mut bgra[o..o + 4];
            let over = |src: u8, dst: u8| {
                ((u32::from(src) * a + u32::from(dst) * (255 - a) + 127) / 255) as u8
            };
            d[0] = over(s[2], d[0]);
            d[1] = over(s[1], d[1]);
            d[2] = over(s[0], d[2]);
            d[3] = over(255, d[3]);
        }
    }
}

pub(super) fn labels_json(scene: &Scene, out: &str) -> Result<(Value, Value), Value> {
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

/// How far past the pixels a region's look covers its render still draws, px: what its finish
/// and effects read around a pixel (#463).
pub(super) const CROP_MARGIN: u32 = 48;

/// #463: a look's covered px rectangle (`[x0, y0, x1, y1]`, inclusive) grown by [`CROP_MARGIN`],
/// as the share of a `size` frame its render draws inside (Scene::crop).
pub(super) fn crop_share(b: [u32; 4], size: [u32; 2]) -> [f64; 4] {
    let lo = |v: u32| f64::from(v.saturating_sub(CROP_MARGIN));
    let hi = |v: u32| f64::from(v + 1 + CROP_MARGIN);
    let (w, h) = (f64::from(size[0]), f64::from(size[1]));
    [
        (lo(b[0]) / w).min(1.0),
        (lo(b[1]) / h).min(1.0),
        (hi(b[2]) / w).min(1.0),
        (hi(b[3]) / h).min(1.0),
    ]
}
