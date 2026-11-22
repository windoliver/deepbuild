//! The frame's captured targets (#2360: moved out of `run_view` whole): each one the call asks for written
//! beside its output and named in the frame's report.

use std::sync::{Arc, Mutex};

use deep_canvas_scene3d::shore::Field;
use deep_effects_render::frame::Effects;

use super::*;
use crate::session3::Drawn;

/// Writes the targets a captured frame's call asks for and names each in `frame`, as `run_view`
/// does for a frame `args.capture` wants.
#[allow(clippy::too_many_arguments)]
pub(super) fn captured(
    frame: &mut Map<String, Value>,
    app: &App,
    out: &str,
    size: [u32; 2],
    args: &Args,
    drawn: &Drawn,
    scene: &Scene,
    scene_bytes: &Option<Vec<u8>>,
    dirt_file: &Option<String>,
    rings: &Option<Vec<Value>>,
    shore: &Option<(String, Arc<Field>)>,
    fx: &Arc<Mutex<Effects>>,
    evaluated: &Scene,
    noop: bool,
    window_name: Option<String>,
) -> Result<(), Value> {
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
    // #971: the linear values the tone curve reads: that image after the look's
    // local tone map, the exposure and the grade's white balance.
    if let (Some(pre), true) = (
        drawn.toned.as_ref().or(drawn.pre_tone.as_ref()),
        args.targets.contains("pre_curve"),
    ) {
        let scale = scene.exposure.unwrap_or(args.look.exposure);
        let balance = args.look.grade.white_balance();
        let read: Vec<u8> = pre
            .as_chunks::<16>()
            .0
            .iter()
            .flat_map(|p| {
                let c = |k: usize| f32::from_le_bytes([p[k], p[k + 1], p[k + 2], p[k + 3]]);
                let lit = [0, 4, 8].map(|k| f64::from(c(k)) * scale);
                let rgb = deep_canvas_marks::finish::mul(&balance, lit);
                let e = |x: f64| (x as f32).to_le_bytes();
                [e(rgb[0]), e(rgb[1]), e(rgb[2]), c(12).to_le_bytes()].concat()
            })
            .collect();
        frame.insert("pre_curve".into(), json!(write_named(out, &read, "f32")?));
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
    // #458: what a relation reads beside these: the solids' normals, and the linear
    // image the tone map reads, after exposure.
    if let (Some(n), true) = (
        &drawn.geometry_normal,
        app.relation_reads.contains("geometry_normal"),
    ) {
        frame.insert("geometry_normal".into(), json!(write_named(out, n, "f32")?));
    }
    if let (Some(pre), true) = (&drawn.pre_tone, app.relation_reads.contains("exposed")) {
        // The planted output pass exposes after the tone map, so what the tone map
        // reads isn't exposed.
        let scale = if app.planted == Some(Planted::ExposureAfterToneMap) {
            1.0
        } else {
            scene.exposure.unwrap_or(args.look.exposure)
        };
        let exposed: Vec<u8> = pre
            .as_chunks::<16>()
            .0
            .iter()
            .flat_map(|p| {
                let c = |k: usize| f32::from_le_bytes([p[k], p[k + 1], p[k + 2], p[k + 3]]);
                let e = |k: usize| ((f64::from(c(k)) * scale) as f32).to_le_bytes();
                [e(0), e(4), e(8), c(12).to_le_bytes()].concat()
            })
            .collect();
        frame.insert("exposed".into(), json!(write_named(out, &exposed, "f32")?));
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
            let points = |k: &str| crate::video::read_points(&device, &fx, k, &models, &dir);
            let mut m = serde_json::Map::new();
            for k in &keys {
                if let Some(r) = points(k) {
                    m.insert(k.clone(), r?);
                    continue;
                }
                let ops = ops.as_ref().map_err(Value::clone)?;
                let mut r = crate::opframe::read_one(&device, ops, &Default::default(), k, &dir)?;
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
    Ok(())
}
