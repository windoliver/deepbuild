use super::*;

/// Answers a `path` line: one frame per time, in order; `built` holds the digests this process
/// built so far, so a frame says whether it rebuilt or reused the item's tessellation.
pub fn path_answer(
    req: PathRequest,
    built: &mut std::collections::BTreeSet<deep_canvas_marks::key::ContentKey>,
) -> Value {
    let mut run = || -> Result<Value, Value> {
        let program = Program::compile(&req.doc).map_err(|r| refused(r.code, &r.path))?;
        let (palette, ty): (scene::Palette, scene::Type) = match &req.look {
            Some(look) => (
                palette_of(look, crate::Theme::Light).clone(),
                crate::type_of(look, crate::Theme::Light).clone(),
            ),
            None => {
                let mut palette = scene::Palette::new();
                palette.insert("ground".into(), [255, 255, 255]);
                any_roles(&Value::Object(req.doc.clone()), &mut palette);
                (palette, scene::Type::default())
            }
        };
        let (palette, ty) = (&palette, &ty);
        let mut frames = Vec::with_capacity(req.times.len());
        // #2031: a lit group's light list as the frame before took it (the planted evaluator's).
        let mut before: Option<Value> = None;
        for &t in &req.times {
            // #223: what the warps map is counted until the frame reports it, the evaluation's
            // placing pass included, which carries them first (the line's first frame from before
            // its check, which draws the document); the scene's build then finds them kept.
            deep_canvas_marks::warp::time_with(req.timing.then_some(clock_ms as fn() -> f64));
            // #223: a path function lowered and each warp's vars bound at t, as a frame draws them.
            let placed = if crate::formulas::has_formulas(&req.doc) || has_warp(&req.doc) {
                crate::formulas::evaluated(&req.doc, t, &req.vectors, &Default::default())?.0
            } else {
                crate::place::evaluated(&req.doc, &program, t, &req.vectors)?
            };
            let items = deep_canvas_vector::lower_items(
                &placed,
                &req.vectors,
                deep_canvas_vector::Write::Honest,
            );
            // #467: a parallax group's frame is its offset at t.
            if let Some(o) = deep_canvas_marks::fields::group_offset(&req.doc, &items, &req.item, t)
                .map_err(|r| refused(r.code, &r.path))?
            {
                frames.push(json!({"t": t, "parallax": {"offset": o}}));
                continue;
            }
            // #2031: a lit group's frame is its light list evaluated at t.
            if let Some(light) = items
                .get(&req.item)
                .and_then(deep_canvas_marks::light::evaluated)
            {
                let shown = match (&before, req.planted == Planted::LightStaleList) {
                    (Some(kept), true) => kept.clone(),
                    _ => light.clone(),
                };
                before = Some(light);
                frames.push(json!({"t": t, "light": shown}));
                continue;
            }
            // The build alone is timed: the item through its ops, its heads and its digest (a
            // first pass over the frame only when an attachment needs other items' boxes).
            let started = std::time::Instant::now();
            let report =
                scene::path_report(&req.doc, &items, (palette, ty), &req.item, req.planted)
                    .map_err(|r| refused(r.code, &r.path))?
                    .ok_or_else(|| refused("ref_unresolved", &format!("items/{}", req.item)))?;
            let ms = started.elapsed().as_secs_f64() * 1000.0;
            let mapped = deep_canvas_marks::warp::take_mapped();
            let rebuilt = built.insert(report.digest);
            let subpaths: Vec<Value> = report
                .placed
                .iter()
                .flat_map(|v| subpaths_of(v, [0.0, 0.0]))
                .collect();
            let mut frame = json!({
                "t": t,
                "subpaths": subpaths,
                "segments": report.segments,
                "declared": report.declared,
                "tessellation": report.digest.hex(),
                "rebuilt": rebuilt,
            });
            if let Some(copies) = &report.copies {
                let lag = report.built.as_ref().map_or(0, |b| b.lag);
                frame["copies"] = Value::Array(
                    copies
                        .iter()
                        .map(|(m, opacity, k)| {
                            json!({"transform": m, "opacity": opacity, "t": t - (*k as i64) * lag})
                        })
                        .collect(),
                );
            }
            if !report.ends.is_empty() {
                let mut ends = Map::new();
                for h in &report.ends {
                    // #223: the head's drawn outline, its corners in document u.
                    let outline: Vec<[f64; 2]> = h
                        .verbs
                        .iter()
                        .filter_map(|v| match *v {
                            deep_canvas_marks::path::Verb::Move(p)
                            | deep_canvas_marks::path::Verb::Line(p)
                            | deep_canvas_marks::path::Verb::Quad(_, p)
                            | deep_canvas_marks::path::Verb::Cubic(_, _, p) => Some(p),
                            deep_canvas_marks::path::Verb::Close => None,
                        })
                        .collect();
                    ends.insert(
                        h.at.to_string(),
                        json!({"kind": h.kind, "tip": h.tip, "angle": h.angle, "length": h.length, "width": h.width, "outline": outline}),
                    );
                }
                frame["ends"] = Value::Object(ends);
            }
            if !req.anchors.is_empty() {
                let whole: Vec<deep_canvas_marks::path::Verb> =
                    report.placed.iter().flatten().copied().collect();
                let mut anchors = Map::new();
                for name in &req.anchors {
                    let value = if name == "#length" {
                        json!(deep_canvas_marks::pathops::length(&whole))
                    } else if let Some(f) = name
                        .strip_prefix("#at:")
                        .and_then(|f| f.parse::<f64>().ok())
                    {
                        match deep_canvas_marks::pathops::at(&whole, f) {
                            Some((p, angle)) => json!({"point": p, "angle": angle}),
                            None => Value::Null,
                        }
                    } else {
                        Value::Null
                    };
                    anchors.insert(name.clone(), value);
                }
                frame["anchors"] = Value::Object(anchors);
            }
            if !report.columns.is_empty() {
                frame["columns"] = json!(report.columns);
            }
            if req.timing {
                frame["build_ms"] = json!(if rebuilt { ms } else { 0.0 });
                // #223: the points a warp over the item mapped this frame and the time it took.
                if let Some((points, warp_ms)) = mapped {
                    frame["warp_points"] = json!(points);
                    frame["warp_ms"] = json!(warp_ms);
                }
            }
            deep_canvas_marks::warp::time_with(None);
            frames.push(frame);
        }
        Ok(json!({"ok": true, "frames": frames}))
    };
    match run() {
        Ok(v) | Err(v) => v,
    }
}
