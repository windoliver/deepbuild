//! The `view3d` call (issue #378; tests/acceptance/378/README.md, The view3d call): a document's
//! 3D writer layers drawn by scene3d's render module through a GPU-layer view, frame n at
//! t = n ÷ fps on a virtual clock, with the writers' patches applied before the frames they name.
//! With a window, the view sits over a flat page and its 2D writer layers anchored to 3D items
//! draw over it from the evaluated data of the `frame_seq` the shown slot carries. Items that
//! open deeper documents by reference load them as they come on screen (#383), and with
//! `timings` each frame reports its GPU time and the GPU memory the device holds. A moving live
//! view draws through frame history's window (#173, `history`).

mod history;
mod views;

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use deep_canvas::document::{apply_ops, check_packed, writer_layer, Issue, Packs, Writing};
use deep_canvas_marks::look::Status;
use deep_canvas_scene3d::label::PAGE;
use deep_canvas_scene3d::look::Look3;
use deep_canvas_scene3d::module::{GEOMETRY_PASS, OUTPUT_PASS};
use deep_canvas_scene3d::scene::{Labels, Scene};
use deep_gpu::device::Backend;
use deep_scene3d_render::status::{Mode, COLORS_PASS, GUARD_PASS};
use deep_scene3d_render::SHADOW_PASS;
use image::ImageEncoder as _;
use serde_json::{json, Map, Value};

use crate::frames::{hex, Capture};
use crate::levels::Levels;
use crate::liveview::surface_of;
use crate::particles::evaluate_sourced;
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
    /// The shell's question card over the view (#177).
    card: Option<crate::window::Card>,
}

mod parse;
pub(crate) use parse::*;

/// #462's planted `status_in_look`: the status map of the look a render draws in, where it has
/// one of its own; `None` for the shipped program, which draws the document's.
fn in_look_status(
    planted: Option<Planted>,
    look_json: &Value,
) -> Result<Option<deep_canvas_marks::look::Status>, Value> {
    if planted != Some(Planted::StatusInLook) {
        return Ok(None);
    }
    status::status_of(look_json)
}

pub fn call(app: &mut App, out: &str, call: &Value) -> Value {
    match run(app, out, call) {
        Ok(v) | Err(v) => v,
    }
}

fn run(app: &mut App, out: &str, call: &Value) -> Result<Value, Value> {
    run_view(app, out, call, &mut None)
}

/// [`run`]; `sub` is a view overlay's own run, which keeps its frames (#506).
fn run_view(
    app: &mut App,
    out: &str,
    call: &Value,
    sub: &mut Option<views::Sub>,
) -> Result<Value, Value> {
    // The cold report's build time runs from here to the first frame's scene, less the view's
    // opening, which compiles (#428).
    let started = std::time::Instant::now();
    let mut args = parse(call, app.planted)?;
    // #462: the looks shots and regions name, and the document's shots that name them.
    let mut named = crate::regions::looks_of(call, Some(&args.theme))?;
    // #462: under reduced motion every look's motifs hold still.
    let reduced_motion = call["reduced_motion"] == true;
    args.look.reduced_motion = reduced_motion;
    for n in named.values_mut() {
        n.look.reduced_motion = reduced_motion;
    }
    let mut timeline = crate::regions::Timeline::of(&args.doc, |n| named.get(n).map(|x| &x.json))?;
    // #466: each operator transition's pass, checked and its reveal placed, before any frame.
    let by_progress = app.planted == Some(Planted::MosaicRevealByProgress);
    let op_passes = crate::op_transition::passes(call, &args.doc, timeline.as_mut(), by_progress)?;
    // #463: each look's operator finish, the document's (`None`) and each named one's, checked
    // and compiled before any frame.
    let finishes = {
        let manifests = crate::op_transition::manifests(call)?;
        let of = |json: &Value, look: &Look3| {
            let roles = look
                .roles
                .iter()
                .map(|(k, c)| (k.clone(), c.map(|v| f64::from(v) / 255.0)))
                .collect();
            crate::look_ops::of(json, &manifests, &roles)
        };
        let mut f = BTreeMap::from([(None, of(&args.look_json, &args.look)?)]);
        for (name, n) in &named {
            f.insert(Some(name.clone()), of(&n.json, &n.look)?);
        }
        f
    };
    // #463: a look's operator finish over a render's bytes (BGRA), status boxes kept, its GPU
    // time added to the frame's.
    let finish = |app: &App,
                  key: &crate::regions::Key,
                  bytes: &mut Vec<u8>,
                  size: [u32; 2],
                  timing: Option<&mut (f64, BTreeMap<String, f64>)>,
                  profiler: Option<deep_scene3d_render::Profiler>,
                  keep: &[[f64; 4]]|
     -> Result<(), Value> {
        // #422's planted draws_black leaves nothing in the final target, the finish's either.
        let black = app.planted == Some(Planted::DrawsBlack);
        let Some(f) = finishes.get(key).filter(|f| !f.is_empty() && !black) else {
            return Ok(());
        };
        let prefix = key.as_ref().map_or_else(String::new, |k| format!("{k}/"));
        let ms = f.apply(app, profiler, &prefix, bytes, size, keep, true)?;
        if let (Some(ms), Some((gpu_ms, passes))) = (ms, timing) {
            *gpu_ms += ms;
            passes.insert(format!("{prefix}look.finish"), ms);
        }
        Ok(())
    };
    // A document that names packs draws as the check lowers it, the call's packs installed
    // first (#429).
    let packs = install(&args.packs)?;
    // A material operator bound where it can't run is refused before anything draws (#431).
    let broken = deep_canvas_effects::module::binding_refusals(&args.doc);
    if !broken.is_empty() {
        return Err(json!({"code": "refused", "issues": broken}));
    }
    // #506: insets and view overlays the check refuses, each naming its items.
    let broken = deep_canvas_scene3d::inset::refusals(&args.doc);
    if !broken.is_empty() {
        return Err(json!({"code": "refused", "issues": broken}));
    }
    // #506: each view overlay drawn by its own run before this view opens.
    let shown = match sub {
        None => views::run_all(app, out, call, &args.doc, args.size, &args.look)?,
        Some(_) => Vec::new(),
    };
    let mut drawn_k = 0usize;
    // #508: a film effect's params out of range refuse the call, naming the field; a plume's and
    // an airflow's particles are written beside them, drawn as any particles item.
    let broken = deep_canvas_effects::effect::issues(&args.doc);
    if !broken.is_empty() {
        return Err(json!({"code": "refused", "issues": broken}));
    }
    deep_canvas_effects::effect::lower(&mut args.doc);
    crate::physics::bake(&mut args.doc, &call["tracks"])?;
    crate::particles::refuse(&args.doc, app.planted)?;
    // The frames the call draws and how each is reached (#173), the ones logic runs at first.
    let reached = history::order(args.from, args.frames, &args.seeks, &args.history, args.fps);
    let order: Vec<u64> = reached.iter().map(|(n, _)| *n).collect();
    let mut baked = crate::fed::bake(&args.doc, &args.assets, (&order, args.fps), app.planted)?;
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
            // #462: every look a shot or region draws keeps the document's status distance.
            for n in named.values() {
                if let Some(r) = status::clash(&args.doc, &n.json, &n.look, &status, &args.theme) {
                    return Err(r);
                }
            }
        }
        Some(status)
    } else {
        None
    };
    let size = args.size;
    let timings = args.timings && !noop;
    let opening = std::time::Instant::now();
    // Frame history's temporal upscale rebuilds the pixels from one sample each (#173).
    let upscales = args.look.history.mode == deep_canvas_scene3d::history::Mode::Upscale;
    let samples = (upscales && !args.export).then_some(1);
    let opened = session3::open_doc(app, size, timings, shows, &args.doc, samples)?;
    session3::surface(app, args.surface)?;
    if args.cull_on_cpu {
        session3::cull_on_cpu(app);
    }
    session3::set_occlusion(app, !args.occlusion_off);
    // The core targets the document's operators read, built only then (#431); the planted core
    // builds both for every frame.
    let builds_all = app.planted == Some(Planted::BuildsUnreadTargets);
    // #458: naming the velocity target in `targets` is a read of it.
    let want = deep_scene3d_render::targets::Want {
        velocity: builds_all
            || args.targets.contains("velocity")
            || deep_canvas_effects::module::reads_core(&args.doc, "velocity"),
        emission: builds_all || deep_canvas_effects::module::reads_core(&args.doc, "emission"),
    };
    session3::core_targets(app, want)?;
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
        p.card = w.card.clone();
        p.hdr = false;
        p.waits_on_gpu = false;
        p.overlays.clear();
        p.pairs_newest = app.planted == Some(Planted::PairsNewestSlot);
        p.ui = Some(ui.clone());
    }
    let mut labels = Labels::new();
    // #226: what the axes' deform mapped, kept between frames; the planted host keeps nothing.
    let memo = std::cell::RefCell::new(deep_canvas_scene3d::contributed::Memo::default());
    let mut axes_mapped: Vec<String> = Vec::new();
    labels.fixed_em = app.planted == Some(Planted::LabelMask);
    let mut frames = Vec::new();
    // Whether any frame drew an object's outline.
    let mut strokes = false;
    // Held slots, each with the frame whose present releases it.
    let mut held: Vec<(u64, usize)> = Vec::new();
    let wants_targets = [
        "linear",
        "ids",
        "pre_tone",
        "backdrop",
        "depth",
        "reflection",
        "foam",
        "normal",
        "coc",
        "checks",
        "velocity",
    ]
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
    // #428's planted import: dispersion dropped from each report and drawn as 0.
    let drops_dispersion = app.planted == Some(Planted::DropsDispersion);
    let import_report = crate::textures::imports(
        &args.doc,
        &read,
        &args.licenses,
        args.store.as_ref(),
        &mut map_paths,
        drops_dispersion,
    )?;
    let mut receipt = Value::Null;
    let mut videos = crate::video::Session::new(map_paths.clone(), args.fps, args.export);
    // #506: the pictures insets draw, in the look's roles, their images from the assets.
    let mut pictures = crate::insets::Pictures::new(
        &args.assets,
        args.look.roles.clone(),
        app.planted == Some(Planted::InsetPremultipliedAsStraight),
    );
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
    // #173: frame history while the live view moves, your hand's turn, and each frame's
    // 128-bit pixel hash where the determinism check reads it.
    let mut hist = match args.export || noop {
        true => None,
        false => history::Run::of(&args.look, args.history.cap(), args.fps, app.planted)?,
    };
    let mut azimuth = 0.0;
    let mut hashes: BTreeMap<u64, String> = BTreeMap::new();
    // The scene the session drew last, which #431's planted velocity target reads.
    let mut last_drawn: Option<Arc<Scene>> = None;
    let mut hover: Option<String> = None;
    let mut viewer_selection: Vec<String> = Vec::new();
    // #462: at most two looks in one frame outside a transition window, checked before any
    // frame draws; status draws in the document's look whatever look a shot or region takes.
    if let Some(tl) = &timeline {
        let outlines = deep_canvas_scene3d::contributed::Fills::of(
            pack_sealed()?,
            crate::axes::plant_name(app.planted),
        );
        tl.check(|t| {
            let sc = evaluate_sourced(&args.doc, t, &args.look, &mut labels, &read, outlines)?;
            Ok((crate::regions::Seen::Camera(sc.camera), sc.volumes))
        })?;
    }
    let (doc_look, doc_look_json) = (args.look.clone(), args.look_json.clone());
    // #462's planted strokes: the camera the frame before drew through.
    let mut last_camera: Option<deep_canvas_scene3d::scene::Camera> = None;
    let result = (|| -> Result<(), Value> {
        // The lights the policy last left out: a change is reported once, by ID (#421).
        let mut left_out: Vec<String> = Vec::new();
        let mut dropped: Vec<String> = Vec::new();
        // #1640's wrong programs for mesh-edge lines, by their planted names.
        let edge_plant = match app.planted {
            Some(Planted::CreaseBelowAngle) => Some("crease_below_angle"),
            Some(Planted::EdgesDeriveEveryFrame) => Some("edges_derive_every_frame"),
            Some(Planted::EdgesDashOtherSpace) => Some("edges_dash_other_space"),
            _ => None,
        };
        for &(n, reach) in &reached {
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
                deep_canvas_effects::effect::lower(&mut args.doc);
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
                        status::clash(&args.doc, &doc_look_json, &doc_look, status, &args.theme)
                    {
                        return Err(r);
                    }
                }
            }
            let t = (n * FLICKS_PER_SECOND / args.fps) as i64;
            // #462: the frame's sides; its first side's look draws the frame's own render.
            let sides = timeline.as_ref().map(|tl| tl.sides(t));
            if let Some(sides) = &sides {
                let base = sides[0].look.map(|l| &named[l]);
                args.look = base.map_or_else(|| doc_look.clone(), |n| n.look.clone());
                args.look_json = base.map_or_else(|| doc_look_json.clone(), |n| n.json.clone());
            }
            levels.collect();
            let (mut composed, resident) =
                levels.compose(lowered_doc.as_ref().unwrap_or(&args.doc));
            if !args.hidden.is_empty() {
                composed = without_layers(&composed, &args.hidden);
            }
            deep_canvas_physics::written::write(&mut composed, t);
            baked.settle(&mut composed, t);
            let mut frame_extra = Map::new();
            if app.planted == Some(Planted::AxesModMapsEveryFrame) {
                *memo.borrow_mut() = Default::default();
            }
            let plant = crate::axes::plant_name(app.planted);
            let outlines = deep_canvas_scene3d::contributed::Fills {
                memo: Some(&memo),
                ..deep_canvas_scene3d::contributed::Fills::of(pack_sealed()?, plant)
            };
            let mut scene =
                evaluate_sourced(&composed, t, &args.look, &mut labels, &read, outlines)?;
            // #450: mesh particles draw through an instancer's columns, read off the scene.
            if let Some(fed) =
                crate::particles::meshes(&composed, &scene, t as f64 / 705_600_000.0, app.planted)?
            {
                scene = evaluate_sourced(&fed, t, &args.look, &mut labels, &read, outlines)?;
            }
            axes_mapped = memo.borrow_mut().take_mapped();
            if args.axes {
                let axes = crate::axes::report(&scene, &composed, t, plant)?;
                frame_extra.insert("axes".into(), axes);
            }
            if !args.world.is_empty() {
                frame_extra.insert("world".into(), crate::axes::world(&scene, &args.world));
            }
            if drops_dispersion {
                scene.plant_drops_dispersion();
            }
            let selected = (&mut args.selection, &mut viewer_selection);
            let presented = crate::fed::framed(&mut scene, &composed, t, selected, app.planted);
            if build_ms.is_none() {
                build_ms = Some(started.elapsed().saturating_sub(opening).as_secs_f64() * 1e3);
            }
            // #173: the determinism check's played side evaluates every frame, drawing one.
            if args.history.draw_only.is_some_and(|d| d != n) {
                continue;
            }
            // Your hand's orbit, view input in session state (#173).
            azimuth = history::hand(&args.history, n, args.from, azimuth);
            history::turn(&composed, &mut scene, t, azimuth)?;
            let values = if args.evaluate.is_empty() {
                None
            } else {
                let at = (&read as deep_canvas_scene3d::scene::Assets<'_>, app.planted);
                Some(crate::fed::values(
                    &composed,
                    &scene,
                    t,
                    &args.evaluate,
                    at,
                )?)
            };
            // #468: the call's world points through the camera this frame draws.
            let projected = (!args.project.is_empty()).then(|| {
                let at = |p: &[f64; 3]| scene.camera.project(*p).map(|q| json!([q[0], q[1]]));
                Value::Array(
                    args.project
                        .iter()
                        .map(|p| at(p).unwrap_or(Value::Null))
                        .collect(),
                )
            });
            // Its maps, made ready in the decode worker once per run and held to the
            // document's decoded-image cap (#423), and its videos' frames at t there (#503).
            let (texels, made) = crate::textures::prepare(app, &composed, &scene, &map_paths)?;
            scene.texels = videos.at(app, &composed, n, &scene, texels)?;
            pictures.paint(&mut scene)?;
            videos.clouds(app, &fx, &scene)?;
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
            // #420 AC6's wrong programs: mesh edges unwelded, or drawn over their faces.
            scene.plant_edges(
                app.planted == Some(Planted::EdgesUnwelded),
                app.planted == Some(Planted::EdgesSkipDepth),
                edge_plant,
            );
            // #268's wrong field: the shore measured from each item's centre.
            if app.planted == Some(Planted::ShoreFieldFromCentre) {
                scene
                    .plant_shore_from_centre(&composed)
                    .map_err(|r| refused(r.code, r.path))?;
            }
            // #2017's planted plate: each tile shades from its level's own vertex normals.
            if app.planted == Some(Planted::TerrainShadesOwnLevelNormals) {
                deep_canvas_scene3d::terrain::plant_level_normals(&mut scene);
            }
            let tiles = args
                .ground_points
                .as_ref()
                .map(|(item, _)| crate::lod::tiles_of(&scene, item));
            let (choices, cut) = selection.apply(&mut scene, drawn_scale, noop);
            // #506's planted core: a view overlay shaded with the main view's light cut.
            if let (Some(s), Some(Planted::OneLightCutPerFrame)) = (sub.as_ref(), app.planted) {
                let main =
                    evaluate_sourced(&s.main, t, &args.look, &mut Labels::new(), &read, outlines)?;
                scene.light_cut = Some(deep_canvas_scene3d::light::policy(
                    &scene.lights,
                    &main.camera,
                ));
            }
            // How many times this frame derived each mesh-edge line's edge set (#1640).
            let edge_sets_derived: Map<String, Value> = scene
                .layers
                .iter()
                .flat_map(|l| &l.lines)
                .filter_map(|l| Some((l.id.clone(), json!(u32::from(l.edges.as_ref()?.derived)))))
                .collect();
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
                .chain(crate::fed::segments(&scene, &composed))
                .collect();
            // A stroke binding draws its outline around the object, exact (#386).
            if let Some(status) = status.as_ref().filter(|_| bound) {
                status::strokes(&mut scene, status, &bindings, &args.states)?;
            }
            // #166: each mirror part's lookup, read back as the `reflection` target.
            scene.read_reflection = args.targets.contains("reflection");
            // #268: the water's foam share, read back as the `foam` target.
            scene.read_foam = args.targets.contains("foam");
            // #968: the water's shaded normal, read back as the `normal` target.
            scene.read_normal = args.targets.contains("normal");
            let shore = (args.shore)
                .then(|| {
                    let w = scene.water.as_ref()?;
                    let f = w.shore.as_ref()?.field.clone()?;
                    Some((w.material.clone(), f))
                })
                .flatten();
            let rings = (args.rings).then(|| {
                scene.water.as_ref().map_or(Vec::new(), |w| {
                    w.rings()
                        .into_iter()
                        .map(|r| json!({"part": r.part, "drop": r.drop, "at": r.at, "born": r.born, "radius": r.radius}))
                        .collect::<Vec<_>>()
                })
            });
            strokes |= scene
                .layers
                .iter()
                .flat_map(|l| &l.solids)
                .any(|s| s.stroke.is_some());
            // #450: the planted trail, then each asked trail as it draws.
            crate::trails::plant(&mut scene, app.planted, t);
            let trails = crate::trails::report(&scene, &call["trails"]);
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
                // #508's wrong program: the film effects' clock is the wall clock, its
                // milliseconds read as seconds, so an effect that holds still between strikes
                // (an arc at 12 a second) still moves between any two draws.
                Some(Planted::EffectReadsWallClock) => {
                    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH);
                    now.map_or(0.0, |d| (d.as_millis() % 1_000_000) as f64)
                }
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
            // #462: the strokes the frame lays, reported where asked; the planted twin draws and
            // reports them where the previous frame's camera put their anchors.
            let mut stroke_rows = None;
            if let Some(s) = &args.look.strokes {
                let planted = app.planted == Some(Planted::StrokesFromPreviousFrame);
                let place = match (&last_camera, planted) {
                    (Some(c), true) => c.clone(),
                    _ => scene.camera.clone(),
                };
                let laid = deep_canvas_scene3d::strokes::lay(&scene, s, &place);
                if planted {
                    settings.strokes = Some(Arc::new(effects::gpu_strokes(&laid)));
                }
                stroke_rows = Some(laid);
            }
            last_camera = Some(scene.camera.clone());
            let particles =
                crate::particles::frame(&mut settings, &args.doc, &scene, fx_t, call, app.planted)?;
            // #508: each film effect's footprint this frame, and each plume's haze over its own.
            let footprints = crate::particles::effects(
                &mut settings,
                &args.doc,
                &scene,
                fx_t,
                app.planted,
                seeding,
            )?;
            settings.checks = args.capture.wants(n) && args.targets.contains("checks") && !noop;
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
                // #506: each overlay frame drawn whole (its text and images too) for GPUI to
                // paint over the view, straight BGRA on a whole pixel.
                let mut shown = Vec::new();
                for (_, at, picture) in pictures.frames(&composed, &scene.overlays)? {
                    let (w, h) = picture.dimensions();
                    let mut bgra = picture.as_raw().clone();
                    crate::insets::straight(&mut bgra);
                    for px in bgra.as_chunks_mut::<4>().0 {
                        px.swap(0, 2);
                    }
                    let Some(frame) = image::RgbaImage::from_raw(w, h, bgra) else {
                        continue;
                    };
                    shown.push(OverlayPicture {
                        at,
                        size: [
                            w.min(u32::from(u16::MAX)) as u16,
                            h.min(u32::from(u16::MAX)) as u16,
                        ],
                        image: Arc::new(gpui_kit::RenderImage::new([image::Frame::new(frame)])),
                    });
                }
                // #468: each overlay's leader over it.
                for l in scene.overlays.iter().filter_map(|o| o.leader.as_ref()) {
                    shown.extend(
                        deep_canvas_scene3d::overlay::leader_picture(l).and_then(|p| {
                            let mut bgra = p.rgba;
                            for px in bgra.as_chunks_mut::<4>().0 {
                                px.swap(0, 2);
                            }
                            let (w, h) = (u32::from(p.size[0]), u32::from(p.size[1]));
                            let image = image::RgbaImage::from_raw(w, h, bgra)?;
                            Some(OverlayPicture {
                                at: p.at,
                                size: p.size,
                                image: Arc::new(gpui_kit::RenderImage::new([image::Frame::new(
                                    image,
                                )])),
                            })
                        }),
                    );
                }
                let pictures = shown;
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
            // #177: whether this frame presents through the HDR surface, and the headroom it
            // rolls off to; an export, a render-back or a golden never does.
            let hdr_headroom = if args.export {
                crate::hdr::export_headroom(app.planted)
            } else {
                args.hdr.frame(n, scene.sky.is_some(), app.planted)
            };
            if !noop {
                crate::hdr::present(app, hdr_headroom, size)?;
            }
            if let Some(win) = app.window.as_ref() {
                win.paint.borrow_mut().hdr = hdr_headroom.is_some() && !args.export;
            }
            // The planted wrong program reads the one pixel under the pointer (#424).
            let margin = if app.planted == Some(Planted::SinglePixelPick) {
                0
            } else {
                args.hit_margin
            };
            if let (Some(status), Some(stage)) = (&status, &opened.stage) {
                // #462's planted twin draws status in the look under it, its own status map.
                let own = in_look_status(app.planted, &args.look_json)?;
                let (layer, marks, legend) = status::layer(
                    &scene,
                    &doc_look,
                    doc_look.role("ink").unwrap_or([0, 0, 0]),
                    own.as_ref().unwrap_or(status),
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
                edge_plant,
            );
            let at_time = |tk: i64, labels: &mut Labels| -> Result<Scene, Value> {
                let mut sc = evaluate_sourced(&composed, tk, &args.look, labels, &read, outlines)?;
                if drops_dispersion {
                    sc.plant_drops_dispersion();
                }
                sc.texels.clone_from(&scene.texels);
                sc.ground = scene.ground;
                sc.set_cutaway(scene.cutaway.clone());
                sc.plant_edges(edges.0, edges.1, edges.2);
                if let Some(status) = status.as_ref().filter(|_| bound) {
                    status::strokes(&mut sc, status, &bindings, &args.states)?;
                }
                Ok(sc)
            };
            // A live view at rest (its frame draws as the one before it does) with `settle`
            // adds samples frame by frame until it holds the export's; frame history turns settle
            // on, and while the view moves draws through its window instead (#173).
            let settling_view = !args.export && (looks.settle || hist.is_some()) && !noop;
            let planned = match hist.as_mut() {
                Some(h) => {
                    let mut still = |tk: i64, step: i64| -> Result<bool, Value> {
                        let before = at_time(tk - step, &mut labels)?;
                        Ok(blur::draws_same(&before, &at_time(tk, &mut labels)?))
                    };
                    Some(h.plan(t, reach, azimuth, &mut still)?)
                }
                None => None,
            };
            let windowed = planned
                .as_ref()
                .is_some_and(|(_, p)| !matches!(p, deep_canvas_scene3d::history::Plan::Plain));
            let at_rest = match &planned {
                Some(_) => settling_view && !windowed && reach != history::Reach::Scrub,
                None => {
                    settling_view && {
                        let prev = at_time(
                            t - (FLICKS_PER_SECOND as f64 / fps).round() as i64,
                            &mut labels,
                        )?;
                        blur::draws_same(&prev, &scene)
                    }
                }
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
            // The core's velocity target (#431): the evaluations at t ± s/2 an operator reads,
            // never an earlier frame, the shutter the look's or 180° without one; the planted
            // target reads the scene the session drew last instead.
            if want.velocity {
                let s = args
                    .look
                    .blur
                    .as_ref()
                    .map_or(0.5 / fps, |b| b.shutter_s(fps));
                let half = (s * FLICKS_PER_SECOND as f64 / 2.0).round() as i64;
                let previous = last_drawn
                    .as_ref()
                    .filter(|_| app.planted == Some(Planted::VelocityFromPreviousFrame));
                let (open, close) = match previous {
                    Some(prev) => ((**prev).clone(), (*scene).clone()),
                    None => (
                        at_time(t - half, &mut labels)?,
                        at_time(t + half, &mut labels)?,
                    ),
                };
                let (motion, _) = blur::motion(
                    &scene,
                    &open,
                    &close,
                    blur::Pairing::Shipped,
                    &Default::default(),
                );
                let mut sc = (*moving).clone();
                sc.velocity = Some(Arc::new(motion));
                moving = Arc::new(sc);
            }
            last_drawn = Some(scene.clone());
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
                deep_scene3d_render::readouts_as_labels(&mut sc);
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
            if !settling_now && !windowed {
                for (k, step) in plan[..n_all as usize].iter().enumerate().skip(1) {
                    subs.push((
                        step.weight,
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
            // #462: each other look the frame's sides draw, rendered after the frame's own (#463).
            let mut others: Vec<(crate::regions::Key, Vec<u8>)> = Vec::new();
            // #463: what the other sides' renders spent on the GPU, by look, counted in the frame.
            let mut others_ms: BTreeMap<String, f64> = BTreeMap::new();
            // Their passes, each by look, for the frame's report.
            let mut others_passes: BTreeMap<String, f64> = BTreeMap::new();
            let keep: Vec<[f64; 4]> = opened
                .stage
                .as_ref()
                .and_then(|st| lock(st).layer.as_ref().map(|l| l.covers.clone()))
                .unwrap_or_default();
            // A frame's CPU: its evaluation, up to handing the scene to the render side.
            let cpu_ms = frame_started.elapsed().as_secs_f64() * 1e3;
            // #506's planted cores: a view overlay drawn after the main view in the same frame,
            // keeping the backdrop copy or the mirror's picture that one left.
            let keeps = match app.planted {
                Some(Planted::OneBackdropPerFrame) => [true, false],
                Some(Planted::OneMirrorPerFrame) => [false, true],
                _ => [false, false],
            };
            let keeping = sub.is_some() && keeps.contains(&true);
            let anchored = scene.overlays.clone();
            if let (Some(s), true) = (sub.as_ref(), keeping) {
                let mut main = s.main.clone();
                main["size"] = json!(size);
                let mut first =
                    evaluate_sourced(&main, t, &args.look, &mut Labels::new(), &read, outlines)?;
                first.texels.clone_from(&scene.texels);
                session3::draw(
                    app,
                    &opened,
                    Arc::new(first),
                    args.look.clone(),
                    n,
                    0,
                    false,
                    false,
                )?;
                session3::keep_first(app, keeps[0], keeps[1]);
            }
            let mut drawn = match (hist.as_mut(), &planned) {
                (Some(h), Some((_, plan))) if windowed => {
                    // Each window frame is the evaluation at its own grid step, drawn as any
                    // frame at that step is, so a frame reached by a seek equals one played.
                    let mut frame_at = |_: &mut App, tk: i64| -> Result<Arc<Scene>, Value> {
                        let mut sc = at_time(tk, &mut labels)?;
                        history::turn(&composed, &mut sc, tk, azimuth)?;
                        let _ = selection.apply(&mut sc, drawn_scale, noop);
                        let mut settings = effects::settings(
                            &sc,
                            &args.look_json,
                            &args.look,
                            &args.selection,
                            tk as f64 / FLICKS_PER_SECOND as f64,
                            doc_seed,
                            effects::Seeding::Item,
                        );
                        if dirt.is_some() {
                            settings.dirt = dirt.clone();
                        }
                        lock(&fx).settings = settings;
                        Ok(Arc::new(sc))
                    };
                    let read = (read_targets || overlay, shows && n == args.from);
                    h.draw(
                        app,
                        &opened,
                        &args.look,
                        n,
                        plan,
                        args.surface,
                        &mut frame_at,
                        read,
                    )?
                }
                _ => session3::draw(
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
                )?,
            };
            // The frame's wall time, from its start (before a seek's restore) until its pixels
            // are read back (#252).
            let wall_ms = frame_started.elapsed().as_secs_f64() * 1e3;
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
            // #463: the frame's own look's operator finish, and the other sides' GPU time.
            if let Some(bytes) = drawn.bytes.as_mut() {
                let key = sides.as_ref().and_then(|s| s[0].look.map(str::to_string));
                let profiler = opened.profiler.clone();
                finish(
                    app,
                    &key,
                    bytes,
                    size,
                    drawn.timing.as_mut(),
                    profiler,
                    &keep,
                )?;
            }
            // #463: each other look the frame's sides draw, after the frame's own: a region's look
            // inside the bounds where its regions cover pixels of the frame's own depth (grown by
            // what its finish and effects read around a pixel), not at all where they cover none,
            // and a side's own look whole.
            let mut region_mix = None;
            let mut region_depth = None;
            // Where any look but the frame's own has a share, px, when no side's own look but
            // the first mixes in: the composite runs inside it alone.
            let mut region_within: Option<[u32; 4]> = None;
            if let (Some(sides), false) = (&sides, noop) {
                let base_key = sides[0].look.map(str::to_string);
                let seen = crate::regions::Seen::Camera(scene.camera.clone());
                let keys: Vec<crate::regions::Key> =
                    crate::regions::keys_in_view(sides, &seen, &scene.volumes)?
                        .into_iter()
                        .filter(|k| *k != base_key)
                        .collect();
                let mut found = Vec::new();
                if let (Some(tl), false) = (&timeline, keys.is_empty()) {
                    let depth = session3::view_depth(app)?
                        .filter(|d| d.len() == 4 * size[0] as usize * size[1] as usize);
                    let mix = crate::regions::mix(
                        tl,
                        sides,
                        &seen,
                        &scene.volumes,
                        t,
                        app.planted == Some(Planted::RegionSidesClipIndependently),
                    )?;
                    if let Some(z) = depth.clone() {
                        let m = mix.clone();
                        found = app
                            .worker
                            .call(move |state| {
                                let d = state.gpu.device();
                                crate::regions::bounds_read_back(
                                    &d.device,
                                    &d.queue,
                                    state.regions.get_or_insert_with(Default::default),
                                    &m,
                                    &z,
                                    size,
                                )
                            })
                            .map_err(|e| refused("render_failed", e))?;
                    }
                    region_mix = Some(mix);
                    region_depth = depth;
                }
                if sides.len() == 1 {
                    let mut union: Option<[u32; 4]> = None;
                    for b in found.iter().flatten() {
                        union = Some(union.map_or(*b, |u| {
                            [
                                u[0].min(b[0]),
                                u[1].min(b[1]),
                                u[2].max(b[2]),
                                u[3].max(b[3]),
                            ]
                        }));
                    }
                    region_within = union.map(|u| [u[0], u[1], u[2] + 1 - u[0], u[3] + 1 - u[1]]);
                }
                for key in keys {
                    let whole = sides.iter().any(|s| s.look.map(str::to_string) == key);
                    let at = region_mix
                        .as_ref()
                        .and_then(|m: &crate::regions::Mix| m.keys.iter().position(|k| *k == key))
                        .and_then(|j| found.get(j).copied());
                    let crop = match (whole, at) {
                        (false, Some(None)) => continue,
                        (false, Some(Some(b))) => Some(crop_share(b, size)),
                        _ => None,
                    };
                    let (look_k, json_k) = match &key {
                        Some(l) => (named[l].look.clone(), named[l].json.clone()),
                        None => (doc_look.clone(), doc_look_json.clone()),
                    };
                    let mut sc =
                        evaluate_sourced(&composed, t, &look_k, &mut labels, &read, outlines)?;
                    sc.camera = scene.camera.clone();
                    sc.texels.clone_from(&scene.texels);
                    if args.window.is_some() {
                        sc.ground = scene.ground;
                    }
                    sc.set_cutaway(scene.cutaway.clone());
                    sc.crop = crop;
                    if let Some(status) = status.as_ref().filter(|_| bound) {
                        status::strokes(&mut sc, status, &bindings, &args.states)?;
                    }
                    let mut settings = effects::settings(
                        &sc,
                        &json_k,
                        &look_k,
                        &args.selection,
                        fx_t,
                        doc_seed,
                        effects::Seeding::Item,
                    );
                    if dirt.is_some() {
                        settings.dirt = dirt.clone();
                    }
                    // A glow's or ambient occlusion's blur reads past any margin: such a look draws
                    // whole.
                    if settings.bloom.is_some() || look_k.ao.is_some() {
                        sc.crop = None;
                    }
                    let kept_fx = std::mem::replace(&mut lock(&fx).settings, settings);
                    let drawn_k =
                        crate::drawn::frame3(&args.doc, &look_k, &Map::new(), &sc, app.planted)?;
                    let kept_drawn = std::mem::replace(&mut *lock(&opened.drawn), drawn_k);
                    let mut kept_layer = None;
                    if let (Some(own), Some(stage), Some(status)) = (
                        in_look_status(app.planted, &json_k)?,
                        &opened.stage,
                        &status,
                    ) {
                        let _ = status;
                        let (layer, _, _) = status::layer(
                            &sc,
                            &doc_look,
                            doc_look.role("ink").unwrap_or([0, 0, 0]),
                            &own,
                            &bindings,
                            &args.states,
                            &mut text,
                        )?;
                        kept_layer = Some(lock(stage).layer.replace(layer));
                    }
                    let d = session3::draw(app, &opened, Arc::new(sc), look_k, n, 0, false, false);
                    let _ = ui.latch();
                    lock(&fx).settings = kept_fx;
                    *lock(&opened.drawn) = kept_drawn;
                    if let (Some(kept), Some(stage)) = (kept_layer, &opened.stage) {
                        lock(stage).layer = kept;
                    }
                    let d = d?;
                    let mut timing = d.timing;
                    if let Some(mut bytes) = d.bytes {
                        let profiler = opened.profiler.clone();
                        finish(
                            app,
                            &key,
                            &mut bytes,
                            size,
                            timing.as_mut(),
                            profiler,
                            &keep,
                        )?;
                        others.push((key.clone(), bytes));
                    }
                    if let Some((ms, passes)) = timing {
                        let name = key.as_deref().unwrap_or("document");
                        others_ms.insert(format!("{name}/look"), ms);
                        others_passes
                            .extend(passes.into_iter().map(|(p, v)| (format!("{name}/{p}"), v)));
                    }
                }
            }
            if let Some((gpu_ms, passes)) = drawn.timing.as_mut() {
                *gpu_ms += others_ms.values().sum::<f64>();
                passes.extend(others_ms);
                passes.extend(others_passes);
            }
            // #462: the frame mixed from its looks' renders by their coverage, on the device.
            let operator = timeline
                .as_ref()
                .and_then(|tl| tl.operator_at(t))
                .and_then(|(w, p)| {
                    Some((format!("transition/{}", w.id), op_passes.get(&w.id)?, p))
                });
            // #468: the transition's declared cost this frame, by its pass's label.
            let mut op_declared = None;
            if let (Some((label, tr, p)), Some(sides), Some(bytes)) =
                (operator, &sides, drawn.bytes.as_mut())
            {
                // #466: the pass over the outgoing side's finished render and the incoming one's,
                // on the GPU, its time counted in the frame's (#468).
                let incoming = sides
                    .get(1)
                    .and_then(|s| others.iter().find(|(k, _)| k.as_deref() == s.look))
                    .map(|(_, b)| b.clone())
                    .unwrap_or_else(|| bytes.clone());
                let outgoing = std::mem::take(bytes);
                let (out, ms) = crate::op_transition::draw(
                    app,
                    opened.profiler.clone(),
                    &label,
                    tr,
                    outgoing,
                    incoming,
                    p,
                    size,
                )?;
                *bytes = out;
                if let (Some(ms), Some((gpu_ms, passes))) = (ms, drawn.timing.as_mut()) {
                    *gpu_ms += ms;
                    passes.insert(label.clone(), ms);
                }
                op_declared = Some((label, tr.declared_ms(size)));
            } else if let (Some(sides), Some(bytes)) = (&sides, drawn.bytes.as_mut()) {
                if let (false, Some(mix)) = (others.is_empty(), region_mix.take()) {
                    // #463: the frame's own depth, read before the other sides drew.
                    let depth = region_depth.take();
                    let base_key = sides[0].look.map(str::to_string);
                    let renders: Vec<Vec<u8>> = mix
                        .keys
                        .iter()
                        .map(|k| match others.iter().find(|(o, _)| o == k) {
                            Some((_, b)) if *k != base_key => b.clone(),
                            _ => bytes.clone(),
                        })
                        .collect();
                    let profiler = opened.profiler.clone();
                    let (mixed, ms) = app
                        .worker
                        .call(move |state| {
                            let d = state.gpu.device();
                            let refs: Vec<&[u8]> = renders.iter().map(Vec::as_slice).collect();
                            crate::regions::mix_read_back(
                                &d.device,
                                &d.queue,
                                state.regions.get_or_insert_with(Default::default),
                                &mix,
                                &refs,
                                depth.as_deref(),
                                size,
                                profiler,
                                region_within,
                            )
                        })
                        .map_err(|e| refused("render_failed", e))?;
                    *bytes = mixed;
                    // #463: the composite's GPU time counts in the frame's.
                    if let (Some(ms), Some((gpu_ms, passes))) = (ms, drawn.timing.as_mut()) {
                        *gpu_ms += ms;
                        passes.insert(crate::regions::COMPOSITE_PASS.into(), ms);
                    }
                }
            }
            if keeping {
                session3::keep_first(app, false, false);
            }
            let scene_bytes = drawn.bytes.clone();
            // The viewer's marks laid over the resolved frame where they drew.
            if let (Some(over), Some(plain), Some(bytes)) =
                (&drawn_over, &plain0, drawn.bytes.as_mut())
            {
                if let Some(ob) = &over.bytes {
                    deep_scene3d_render::lay_over(bytes, ob, plain);
                }
            }
            // #506: each view overlay's frame over its rect; a view overlay's own run keeps its
            // frames for its host.
            if let Some(bytes) = drawn.bytes.as_mut() {
                pictures.frames_over(&composed, &anchored, bytes, size)?;
                leaders_over(&anchored, bytes, size);
                views::composite(&shown, drawn_k, bytes, size);
                if let Some(s) = sub.as_mut() {
                    s.keep(bytes)?;
                }
            }
            drawn_k += 1;
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
                    let ms = crate::spawn::since_spawn_ms();
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
            frame.extend(frame_extra);
            frame.insert("frame".into(), json!(n));
            frame.insert("settled".into(), json!(settled));
            // What each stepped operator's carried output holds as this frame drew (#252).
            let fx2 = fx.clone();
            let carried = app
                .worker
                .call(move |_| lock(&fx2).docops.as_ref().map(|o| o.carried()));
            if let Some(c) = carried.filter(|c| c.as_object().is_some_and(|m| !m.is_empty())) {
                frame.insert("carried".into(), c);
            }
            if args.timings {
                frame.insert("wall_ms".into(), json!(wall_ms));
                // #538: each fed instancer's and overlaid plate's upload time this frame.
                frame.insert("upload_ms".into(), json!(drawn.counts.upload_ms));
            }
            frame.insert("samples".into(), samples_report);
            if args.overlays {
                let rows: Vec<Value> = anchored
                    .iter()
                    .map(|o| {
                        let mut row = json!({"id": o.id, "at": o.origin});
                        // #468: where its leader ends, or null while it hides.
                        if let Some(l) = &o.leader {
                            let to = l.points.as_ref().and_then(|p| p.last());
                            row["leader"] = to.map_or(Value::Null, |to| json!({"to": to}));
                        }
                        row
                    })
                    .collect();
                frame.insert("overlays".into(), Value::Array(rows));
            }
            frame.insert(
                "history".into(),
                match (&hist, &planned) {
                    (Some(h), Some((k, plan))) => h.report(t, *k, plan),
                    _ => history::plain(t),
                },
            );
            if let (true, Some(bytes)) = (args.history.hashes(app.planted), &drawn.bytes) {
                let hash = history::hash128(app, bytes, size)?;
                frame.insert("pixel_hash128".into(), json!(hash));
                hashes.insert(n, hash);
            }
            if !notices.is_empty() {
                frame.insert("notices".into(), json!(notices));
            }
            frame.insert("resident".into(), json!(resident));
            if !args.sway.is_empty() {
                let rows: Map<String, Value> =
                    session3::sway(app, scene.clone(), args.sway.clone())
                        .into_iter()
                        .map(|(id, gust, positions)| {
                            (id, json!({"gust": gust, "positions": positions}))
                        })
                        .collect();
                frame.insert("sway".into(), Value::Object(rows));
            }
            if let Some(values) = values {
                frame.insert("values".into(), values);
            }
            if let Some(p) = projected {
                frame.insert("projected".into(), p);
            }
            frame.extend(particles.map(|p| ("particles".to_string(), p)));
            if call["footprints"] == true {
                frame.insert("footprints".into(), Value::Object(footprints));
            }
            frame.extend(trails.map(|p| ("trails".to_string(), p)));
            if call["strokes"] == true {
                let rows: Vec<Value> = stroke_rows
                    .iter()
                    .flatten()
                    .map(|d| json!({"id": d.id, "item": d.item, "anchor": d.anchor, "at": d.at}))
                    .collect();
                frame.insert("strokes".into(), Value::Array(rows));
            }
            frame.insert("selection".into(), presented);
            if let Some(bytes) = drawn.gpu_bytes {
                frame.insert("gpu_bytes".into(), json!(bytes));
            }
            // #177: the HDR surface's frame, and with the planted export, the SDR frame taken from
            // it.
            let hdr_texels = hdr_headroom.and_then(|_| crate::hdr::read(app));
            if args.export {
                if let (Some(t), Some(b)) = (&hdr_texels, drawn.bytes.as_mut()) {
                    crate::hdr::to_sdr(t, b);
                }
            }
            let live_hdr = hdr_texels.as_ref().filter(|_| !args.export);
            if let Some(h) = live_hdr.and(hdr_headroom) {
                crate::hdr::shown(h);
            }
            frame.insert(
                "hdr".into(),
                json!({"state": if live_hdr.is_some() { "on" } else { "off" },
                       "headroom": live_hdr.and(hdr_headroom).unwrap_or(1.0)}),
            );
            let (frame_seq, window_name) = match (&args.window, app.window.as_ref()) {
                (Some(w), Some(win)) => {
                    win.present(&mut app.cx);
                    let shown = win.paint.borrow().shown;
                    let name = if capture {
                        let image = win
                            .capture(&mut app.cx)
                            .map_err(|e| refused("no_capture", e))?;
                        if args.targets.contains("window_linear") {
                            let under = live_hdr.map(|t| (&t[..], w.view, size));
                            let linear = crate::hdr::composite(&image, under, app.planted);
                            frame.insert(
                                "window_linear".into(),
                                json!(write_named(out, &linear, "f32")?),
                            );
                        }
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
            if let (true, true, Some(bgra)) =
                (capture, args.targets.contains("surface"), &drawn.bytes)
            {
                let surface = crate::hdr::surface_json(out, live_hdr.map(|t| &t[..]), bgra)?;
                frame.insert("surface".into(), surface);
            }
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
                // The opaque scene's copy, each mip a file of its own (#431).
                if let (Some(levels), true) = (&drawn.backdrop, args.targets.contains("backdrop")) {
                    let mut rows = Vec::new();
                    for (size, texels) in levels {
                        rows.push(json!({"size": size, "file": write_named(out, texels, "f32")?}));
                    }
                    if let Some(first) = rows.first().cloned() {
                        frame.insert("backdrop".into(), json!({"format": "rgba16float", "size": first["size"], "file": first["file"], "levels": rows}));
                    }
                }
                if let (Some(pre), true) = (&drawn.pre_tone, args.targets.contains("pre_tone")) {
                    frame.insert("pre_tone".into(), json!(write_named(out, pre, "f32")?));
                }
                if let Some(name) = &dirt_file {
                    frame.insert("dirt".into(), json!(name));
                }
                // #166: the view-axis depth and each mirror part's lookup.
                if let (Some(d), true) = (&drawn.view_depth, args.targets.contains("depth")) {
                    frame.insert("depth".into(), json!(write_named(out, d, "f32")?));
                }
                if let (Some(r), true) = (&drawn.reflection, args.targets.contains("reflection")) {
                    frame.insert("reflection".into(), json!(write_named(out, r, "f32")?));
                }
                if let Some(rings) = &rings {
                    frame.insert("rings".into(), json!(rings));
                }
                if let (Some(f), true) = (&drawn.foam, args.targets.contains("foam")) {
                    frame.insert("foam".into(), json!(write_named(out, f, "f32")?));
                }
                if let (Some(n), true) = (&drawn.normal, args.targets.contains("normal")) {
                    frame.insert("normal".into(), json!(write_named(out, n, "f32")?));
                }
                // #458: the core's velocity target as the frame built it, two f32 a pixel.
                if let (Some(v), true) = (&drawn.velocity, args.targets.contains("velocity")) {
                    frame.insert("velocity".into(), json!(write_named(out, v, "f32")?));
                }
                // #468: each pixel's signed circle of confusion, f32.
                if let (Some(c), true) = (&drawn.coc, args.targets.contains("coc")) {
                    frame.insert("coc".into(), json!(write_named(out, c, "f32")?));
                }
                if let Some((material, f)) = &shore {
                    let bytes: Vec<u8> = f.cells.iter().flat_map(|c| c.to_le_bytes()).collect();
                    frame.insert(
                        "shore".into(),
                        json!({
                            "material": material,
                            "key": f.key,
                            "field": write_named(out, &bytes, "bin")?,
                            "bake_ms": f.bake_ms,
                        }),
                    );
                }
                if !args.read.is_empty() {
                    // Each operator output as it stood when this frame drew (#483), and each point
                    // set's points in its item's space (#503).
                    let (keys, fx2, dir) = (args.read.clone(), fx.clone(), out.to_string());
                    let models = crate::video::models(&evaluated);
                    let read = app.worker.call(move |state| -> Result<Value, Value> {
                        let device = state.gpu.device();
                        let fx = lock(&fx2);
                        let ops = fx.docops.as_ref().ok_or_else(|| {
                            refused(
                                "bad_input",
                                "read names an operator output, and the document runs no operator",
                            )
                        });
                        let points =
                            |k: &str| crate::video::read_points(&device, &fx, k, &models, &dir);
                        let mut m = serde_json::Map::new();
                        for k in &keys {
                            if let Some(r) = points(k) {
                                m.insert(k.clone(), r?);
                                continue;
                            }
                            let ops = ops.as_ref().map_err(Value::clone)?;
                            let mut r = crate::opframe::read_one(
                                &device,
                                ops,
                                &Default::default(),
                                k,
                                &dir,
                            )?;
                            // The class its writer computes, which a golden compares it under (#252).
                            let item = k.split_once('.').map_or(k.as_str(), |(i, _)| i);
                            if let (Some(o), Some(c)) = (r.as_object_mut(), ops.class_of(item)) {
                                o.insert("class".into(), json!(c.name()));
                            }
                            m.insert(k.clone(), r);
                        }
                        Ok(Value::Object(m))
                    })?;
                    frame.insert("read".into(), read);
                }
                // #508: what a check reads back from the frame, each as raw rows named by their
                // SHA-256: the color where the document's operators read the chain (before any
                // display-only pass), the object IDs and the view-axis depth.
                if args.targets.contains("checks") && !noop {
                    let fx2 = fx.clone();
                    let color = app
                        .worker
                        .call(move |state| lock(&fx2).read_checks(&state.gpu.device()));
                    let mut checks = Map::new();
                    let parts = [
                        ("color", color.as_deref()),
                        ("ids", drawn.targets.as_ref().map(|(_, ids)| ids.as_slice())),
                        ("depth", drawn.view_depth.as_deref()),
                    ];
                    for (name, bytes) in parts {
                        if let Some(b) = bytes {
                            checks.insert(name.into(), json!(write_named(out, b, "bin")?));
                        }
                    }
                    frame.insert("checks".into(), Value::Object(checks));
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
            // A light response's negative or non-finite return, once per operator and time (#485).
            for (op, t) in &drawn.counts.light_response_range {
                frame
                    .entry("notices")
                    .or_insert_with(|| json!([]))
                    .as_array_mut()
                    .expect("a list")
                    .push(json!({"code": "light_response.range", "op": op, "t": t}));
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
                frame.insert("element_uploads".into(), json!(c.element_uploads));
                frame.insert("row_uploads".into(), crate::fed::rows(&composed, c));
                frame.insert("cpu_culled".into(), json!(c.cpu_culled));
                frame.insert("counts_read_back".into(), json!(c.counts_read_back));
                let draws: Vec<Value> = c
                    .indirect
                    .iter()
                    .map(|(item, view, batch)| json!({"item": item, "view": view, "batch": batch}))
                    .collect();
                frame.insert("indirect_draws".into(), json!(draws));
                // #1636: each draw of a mesh the main view's color pass issues.
                let draws: Vec<Value> = (c.draws.iter())
                    .map(|(of, mesh, material, instances)| {
                        json!({"pass": "color", "of": of, "mesh": mesh, "material": material,
                            "instances": instances})
                    })
                    .collect();
                frame.insert("draws".into(), json!(draws));
                frame.insert("meshes_built".into(), json!(c.meshes_built));
                frame.insert("axes_mapped".into(), json!(axes_mapped));
                frame.insert(
                    "terrain_tiles_selected".into(),
                    json!(selection.tiles_selected),
                );
                frame.insert("compiled".into(), json!(compiled));
                frame.insert("segments".into(), Value::Object(edge_segments));
                frame.insert("edge_sets_derived".into(), Value::Object(edge_sets_derived));
            }
            if args.lod {
                frame.insert("lod".into(), crate::lod::rows(&choices));
            }
            if let (Some((item, at)), Some(tiles)) = (&args.ground_points, &tiles) {
                frame.insert(
                    "ground_points".into(),
                    crate::lod::ground_points(item, at, tiles, &choices),
                );
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
                // #1637: the whole items each pass drew.
                let mut items = Vec::new();
                for (view, kept) in session3::kept_items(app) {
                    let file =
                        write_named(out, &serde_json::to_vec(&kept).unwrap_or_default(), "json")?;
                    items.push(json!({"view": view, "count": kept.len(), "kept": file}));
                }
                frame.insert("kept_items".into(), json!(items));
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
                // #508: the film effects' passes at the size the effects drew.
                let fx_size = match args.surface.scale < 1.0 {
                    true => surface::scaled(size, args.surface.scale),
                    false => size,
                };
                let effects_declared = lock(&fx).declared_ms(fx_size);
                let declared: serde_json::Map<String, Value> = drawn
                    .declared
                    .iter()
                    .map(|(k, v)| (k.to_string(), json!(v)))
                    .chain(
                        effects_declared
                            .iter()
                            .map(|(k, v)| (k.to_string(), json!(v))),
                    )
                    .chain(op_declared.map(|(k, v)| (k, json!(v))))
                    .collect();
                frame.insert("declared_ms".into(), Value::Object(declared));
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
                        // #1976: where the ray through the pointer meets the picked item.
                        let mut hit = p.as_deref().map_or_else(Vec::new, |p| {
                            deep_canvas_scene3d::hit::hits(&evaluated, *at, &[p])
                        });
                        if app.planted == Some(Planted::HitFromDepth) {
                            depth_hits(&mut hit, &evaluated.camera, drawn.view_depth.as_deref(), size, *at);
                        }
                        let hit: Vec<Value> = hit
                            .iter()
                            .map(|h| {
                                json!({"item": h.item, "sub": h.sub, "point": h.point, "normal": h.normal, "distance": h.distance})
                            })
                            .collect();
                        json!({"at": at, "pick": p, "hit": hit})
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
    let (msaa, render_targets) = session3::render_targets(app);
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
    // A view that drew through frame history's window reports its render scale (#173).
    let (scale, upscale) = hist
        .as_ref()
        .and_then(history::Run::surface)
        .unwrap_or(if below {
            (args.surface.scale, args.surface.upscale.name())
        } else {
            (1.0, "none")
        });
    let drew = json!({
        "internal_scale": scale,
        "upscale": upscale,
        "sharpen": args.surface.sharpen,
        "size_px": size, "internal_px": internal, "msaa": msaa,
    });
    let mut reply = json!({
        "frames": frames, "passes": passes, "status": status_report, "surface": drew,
        "render_targets": render_targets,
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
    if let Some(at_times) = &args.history.determinism {
        let planted = app.planted == Some(Planted::DeterminismHashesLiveView);
        reply["determinism"] = history::determinism(
            app,
            out,
            call,
            at_times,
            args.fps,
            (planted, &hashes, azimuth),
        )?;
    }
    Ok(reply)
}
