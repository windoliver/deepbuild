use super::*;

pub(super) fn placed(
    ctx: &ItemCtx<'_>,
    id: &String,
    item: &Value,
) -> Result<Option<Placed>, Refused> {
    let path = format!("items/{id}");
    if item.get("visible") == Some(&Value::Bool(false)) {
        return Ok(None);
    }
    let Some(layer) = item.get("layer").and_then(Value::as_str) else {
        return refuse("bad_doc", format!("{path}/layer"));
    };
    let params = object_or_empty(item.get("params"));
    let place = Place::of(item);
    let pos = place.offset;
    let paint = object_or_empty(params.get("paint"));
    let fill = paint.get("fill").and_then(Value::as_object);
    let stroke = paint.get("stroke").and_then(Value::as_object);
    let paint_path = format!("{path}/params/paint");
    let center = || {
        let c = params.get("center");
        let at = if item.get("kind").and_then(Value::as_str) == Some("circle@1") {
            circle_center(c)
        } else {
            pair(c)
        };
        at.ok_or(Refused {
            code: "bad_doc",
            path: format!("{path}/params/center"),
        })
    };
    let path_data = || -> Result<(String, Vec<Verb>), Refused> {
        // #490: a path function in place of `d`, drawn from its samples; its text keys it.
        if let Some(f) = params.get("fn") {
            return Ok((format!("fn:{f}"), fn_verbs(f, &path)?));
        }
        let Some(Value::String(d)) = params.get("d") else {
            return refuse("bad_doc", format!("{path}/params/d"));
        };
        let verbs = path::parse(d).ok_or(Refused {
            code: "bad_path_data",
            path: format!("{path}/params/d"),
        })?;
        Ok((d.clone(), verbs))
    };
    // R1's rect, circle and path draw an item that only moves, in the paint R1 knows.
    // Issue #160: a path with ops, ends, an attachment or a bend, or a stroke that tapers or
    // waves, is an outline the R1 marks can't draw.
    // #466: a path's build draws a share of its strokes, which R1's marks can't.
    let kinetic = ["ops", "ends", "attach", "bend", "width", "opacity", "build"]
        .iter()
        .any(|k| params.get(*k).is_some_and(|v| !v.is_null()))
        || stroke.is_some_and(|s| s.contains_key("taper") || s.contains_key("wave"))
        || paint.get("shade").is_some_and(|v| !v.is_null())
        || joined_under(ctx, id, "opacity").is_some();
    // #223: under a group's warp, an outline is carried point by point, which R1 can't draw.
    let warp = warp_over(ctx, id)?;
    let kinetic = kinetic || warp.is_some();
    // #149: a lamp of a backlit screen is light, and draws nothing of its own.
    if let Some(look) = &ctx.ty.drawn {
        let lamps = look.light.as_ref().and_then(|l| l.back.as_ref());
        if lamps.is_some_and(|b| b.lamps.iter().any(|l| l == id)) {
            return Ok(None);
        }
    }
    // A look dresses an item it lights or lays strokes on, or that names its fills and lines.
    let dressing = ctx.ty.drawn.as_ref().filter(|look| {
        let names = |side: &str, keys: [&str; 2]| {
            let p = paint.get(side).and_then(Value::as_object);
            p.is_some_and(|p| keys.iter().any(|k| p.contains_key(*k)))
        };
        look.light.is_some()
            || look.strokes.is_some()
            || names("fill", ["fill", "noise"])
            || names("fill", ["dither", "dither"])
            || names("stroke", ["line", "line"])
    });
    let kinetic = kinetic || dressing.is_some();
    let r1 = place.moves() && r1_paint(paint) && !kinetic;
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
    let adjust = Adjust::read(item, ctx.palette, id)?;
    let mut after: Vec<Mark> = Vec::new();
    // The rows a transform left below full opacity, each through its own pass.
    let mut fades: BTreeMap<String, f64> = BTreeMap::new();
    // #1966: how far a code item's gutter reaches left of its text, inside its mask.
    let mut reach = 0.0;
    let mut marks: Vec<Mark> = match kind {
        // A scale draws only its legend. A mask and a group draw nothing themselves, and a
        // camera is the view a document is seen through, not a mark (#378: a 3D figure's
        // camera). A graph, a salience level and a sheet are the graph, record and sheet
        // modules' (#388), which lay them out and draw nothing yet.
        "scale@1" => match data::legend(id, item, ctx.items, ctx.palette, pos)? {
            legend if legend.is_empty() => return Ok(None),
            legend => legend,
        },
        "group@1" if params.get("outline").is_some_and(|o| !o.is_null()) => {
            let (under, slits) = union_outline(ctx, id, params, &path)?;
            after = slits;
            under
        }
        // A backdrop group with no children covers the frame it sits in.
        "group@1" if childless_backdrop(id, item, ctx.items) => {
            let inside = (0..ctx.items.len()).try_fold(item, |at, _| {
                let frame = at
                    .get("parent")
                    .and_then(Value::as_str)
                    .and_then(|p| ctx.items.get(p));
                match frame {
                    Some(f) if f.get("kind").and_then(Value::as_str) == Some("frame@1") => Err(f),
                    Some(f) => Ok(f),
                    None => Ok(at),
                }
            });
            let bounds = match inside {
                Err(f) => Place::of(f).rect(frame_box(id, f)?),
                Ok(_) => [0.0, 0.0, ctx.size[0], ctx.size[1]],
            };
            vec![Mark::Rect {
                item: id.clone(),
                bounds,
                radius: 0.0,
                fill: Fill::Solid([255, 255, 255]),
            }]
        }
        // A logic item (#544) steps and emits occurrences, and a score (#154) sounds: neither draws.
        // A readout (#419, #1183) draws over the frame, in scene3d's view; so do an anchored
        // overlay frame and a view overlay, and an inset draws in scene3d's frame (#506).
        "mask@1" | "matte@1" | "group@1" | "camera@1" | "graph@1" | "salience@1" | "sheet@1"
        | "axes3d@1" | "logic@1" | "score.music@1" | "overlay.text@1" | "overlay.frame@1"
        | "overlay.view@1" | "inset@1" => return Ok(None),
        "star@1" => {
            let p = |k: &str| num(params.get(k));
            let star = Star {
                center: center()?,
                points: p("points").unwrap_or(5.0),
                outer_r: p("outer_r").unwrap_or(0.0),
                inner_r: p("inner_r").unwrap_or(0.0),
                outer_round: p("outer_round").unwrap_or(0.0),
                inner_round: p("inner_round").unwrap_or(0.0),
                polygon: params.get("polygon") == Some(&Value::Bool(true)),
            };
            let verbs = star.verbs(&format!("{path}/params"))?;
            {
                let built = build_path(ctx, id, verbs, params, paint, place)?;
                ctx.paints.shapes(id, &built, place, paint, &paint_path)?
            }
        }
        "frame@1" if stroke.is_some() => {
            // A stroked frame draws as a stroked rect does.
            let radius = num(params.get("radius")).unwrap_or(0.0);
            let verbs = outline::rect(frame_box(id, item)?, radius);
            vec![ctx.paints.shape_with(
                id,
                verbs,
                place,
                paint,
                &paint_path,
                (Vec::new(), Vec::new()),
            )?]
        }
        "frame@1" => {
            // A frame draws its background, then a grid's rules (#233); its overflow mask scopes
            // its children.
            let mut out = Vec::new();
            if let Some(fill) = fill {
                let (bounds, radius) =
                    (place.rect(frame_box(id, item)?), num(params.get("radius")));
                let fill = ctx.paints.paint(
                    id,
                    fill,
                    &format!("{paint_path}/fill"),
                    bounds,
                    Place::NONE,
                    false,
                )?;
                out.push(Mark::Rect {
                    item: id.clone(),
                    bounds,
                    radius: radius.unwrap_or(0.0),
                    fill,
                });
            }
            let rules = crate::grid_rules::rules(id, params, ctx.items);
            for [a, b] in rules.lines {
                let [a, b] = [a, b].map(|p| {
                    <[f64; 2]>::try_from(&place.rect([p[0], p[1], 0.0, 0.0])[..2]).unwrap_or(p)
                });
                let color = role(
                    ctx.palette,
                    Some(&rules.role),
                    &format!("{path}/params/rules/role"),
                )?;
                out.push(crate::ticks::line(
                    format!("{id}#rule"),
                    a,
                    b,
                    rules.width,
                    color,
                ));
            }
            if out.is_empty() {
                return Ok(None);
            }
            out
        }
        "circle@1" if params.get("arc").is_some() => {
            let center = center()?;
            let arc = params.get("arc");
            let (Some(from), Some(to)) = (
                num(arc.and_then(|a| a.get("from"))),
                num(arc.and_then(|a| a.get("to"))),
            ) else {
                return refuse("bad_doc", format!("{path}/params/arc"));
            };
            let close = match (fill.is_some(), ctx.planted) {
                (false, _) => outline::Close::Open,
                (true, Planted::ArcClosedAlongChord) => outline::Close::Chord,
                (true, _) => outline::Close::Filled,
            };
            let verbs = outline::arc(
                center,
                num(params.get("r")).unwrap_or(0.0),
                num(params.get("inner_r")).unwrap_or(0.0),
                from,
                to,
                close,
            );
            {
                let built = build_path(ctx, id, verbs, params, paint, place)?;
                ctx.paints.shapes(id, &built, place, paint, &paint_path)?
            }
        }
        "path@1"
            if !r1
                || [fill, stroke]
                    .iter()
                    .flatten()
                    .any(|p| p.contains_key("gradient") || p.contains_key("steps")) =>
        {
            let (_, verbs) = path_data()?;
            let verbs = attached(ctx, verbs, params, &path)?;
            // #466: a build draws its strokes on in turn, and its fill when its fill says, as
            // `path_report` and `<item>.build` read it.
            let build = crate::build::read(params).map_err(|f| Refused {
                code: "out_of_range",
                path: format!("{path}/params/{f}"),
            })?;
            let verbs = match &build {
                Some(b) => b.drawn(&verbs, id),
                None => verbs,
            };
            let unfilled = build
                .as_ref()
                .filter(|b| !b.fills())
                .map(|_| without_fill(params));
            let paint = unfilled
                .as_ref()
                .map_or(paint, |p| object_or_empty(p.get("paint")));
            let built = build_path(ctx, id, verbs, params, paint, place)?;
            ctx.paints.shapes(id, &built, place, paint, &paint_path)?
        }
        "rect@1" | "circle@1"
            if !r1
                || kinetic
                || stroke.is_some()
                || (kind == "circle@1" && fill.is_some_and(|f| !f.contains_key("role"))) =>
        {
            let verbs = if kind == "rect@1" {
                let Some(b) = four(params.get("box")) else {
                    return refuse("bad_doc", format!("{path}/params/box"));
                };
                outline::rect(b, num(params.get("radius")).unwrap_or(0.0))
            } else {
                let center = center()?;
                outline::circle(
                    center,
                    num(params.get("r")).unwrap_or(0.0),
                    num(params.get("inner_r")).unwrap_or(0.0),
                )
            };
            if fill.is_none() && stroke.is_none() {
                return Ok(None);
            }
            {
                let built = build_path(ctx, id, verbs, params, paint, place)?;
                ctx.paints.shapes(id, &built, place, paint, &paint_path)?
            }
        }
        "marks@1" if crate::atlas::is_atlas(params) => {
            let rows = data::rows(
                id,
                item,
                ctx.items,
                ctx.row_readings
                    .get(id.as_str())
                    .unwrap_or(&data::BoundRows::new()),
            )?;
            crate::atlas::marks(id, params, &rows, pos, ctx.planted)?
        }
        "marks@1" => {
            let drawing = data::mark_set(
                id,
                item,
                ctx.items,
                ctx.palette,
                pos,
                ctx.row_readings
                    .get(id.as_str())
                    .unwrap_or(&data::BoundRows::new()),
            )?;
            fades = drawing.fades;
            drawing.marks
        }
        "vector_field@1" => crate::vector_field::marks(
            id,
            item,
            ctx.items,
            ctx.palette,
            pos,
            crate::vector_field::Method::Rk4,
        )?,
        "axis@1" => {
            let channels = ctx.paints.doc.get("channels");
            let drawing = data::axis(id, item, (ctx.items, channels), ctx.palette, pos, ctx.size)?;
            fades = drawing.fades;
            drawing.marks
        }
        "series@1" => {
            let how = match ctx.planted {
                Planted::DecimateFirstLast => data::Decimate::FirstLast,
                Planted::DecimateMinMax => data::Decimate::MinMax,
                _ => data::Decimate::M4,
            };
            data::series(id, item, ctx.palette, pos, how)?
        }
        "image@1" => {
            let Some(Value::String(asset)) = params.get("asset") else {
                return refuse("bad_doc", format!("{path}/params/asset"));
            };
            if asset.len() != 64 || !asset.bytes().all(|b| b.is_ascii_hexdigit()) {
                return refuse("bad_asset", format!("{path}/params/asset"));
            }
            if params
                .get("alt")
                .and_then(Value::as_str)
                .is_none_or(str::is_empty)
            {
                return refuse("alt_missing", format!("{path}/params/alt"));
            }
            let Some(bounds) = four(params.get("box")) else {
                return refuse("bad_doc", format!("{path}/params/box"));
            };
            let fit = match params.get("fit").and_then(Value::as_str) {
                None | Some("contain") => ImageFit::Contain,
                Some("cover") => ImageFit::Cover,
                Some("fill") => ImageFit::Fill,
                Some("none") => ImageFit::None,
                Some(_) => return refuse("bad_doc", format!("{path}/params/fit")),
            };
            let sampling = match params.get("sampling") {
                None => ImageSampling::Linear,
                Some(Value::String(s)) if s == "linear" => ImageSampling::Linear,
                Some(Value::String(s)) if s == "nearest" => ImageSampling::Nearest,
                Some(Value::String(s)) if s == "cubic" => ImageSampling::Cubic,
                Some(_) => return refuse("bad_doc", format!("{path}/params/sampling")),
            };
            // #535: `at.rot`'s z (degrees) turns the image about its origin.
            let turn = num(item.pointer("/at/rot/2")).unwrap_or(0.0);
            let origin = place.offset;
            vec![Mark::Image {
                item: id.clone(),
                asset: asset.to_ascii_lowercase(),
                bounds: crate::turn::about(place.rect(bounds), origin, turn),
                fit,
                sampling,
                crop: four(params.get("crop")),
                opacity: num(params.get("opacity")).unwrap_or(1.0).clamp(0.0, 1.0),
                adjust: Adjust::default(),
                tile: None,
                turn,
            }]
        }
        "text@1" => {
            // #223: under a warp a text moves by its anchor and keeps its glyphs.
            let origin = match &warp {
                Some((_, w)) => w.1.back(pos).map(|g| w.1.at(w.0.point(g))).unwrap_or(pos),
                None => pos,
            };
            let drawn = text_marks(ctx, id, params, &path, origin, fill)?;
            fades.extend(drawn.fades);
            reach = drawn.reach;
            drawn.marks
        }
        _ => vec![match kind {
            "rect@1" => {
                let Some(Value::Array(b)) = params.get("box") else {
                    return refuse("bad_doc", format!("{path}/params/box"));
                };
                let b: Option<Vec<f64>> = b.iter().map(|v| num(Some(v))).collect();
                let Some([x, y, w, h]) = b.as_deref().and_then(|b| <[f64; 4]>::try_from(b).ok())
                else {
                    return refuse("bad_doc", format!("{path}/params/box"));
                };
                let Some(fill) = fill else { return Ok(None) };
                let bounds = [x + pos[0], y + pos[1], w, h];
                Mark::Rect {
                    item: id.clone(),
                    bounds,
                    radius: num(params.get("radius")).unwrap_or(0.0),
                    fill: ctx.paints.paint(
                        id,
                        fill,
                        &format!("{paint_path}/fill"),
                        bounds,
                        Place::NONE,
                        false,
                    )?,
                }
            }
            "circle@1" => {
                let center = center()?;
                let Some(fill) = fill else { return Ok(None) };
                Mark::Circle {
                    item: id.clone(),
                    center: [center[0] + pos[0], center[1] + pos[1]],
                    r: num(params.get("r")).unwrap_or(0.0),
                    inner_r: num(params.get("inner_r")).unwrap_or(0.0),
                    color: role(
                        ctx.palette,
                        fill.get("role"),
                        &format!("{path}/params/paint/fill/role"),
                    )?,
                }
            }
            "path@1" => {
                let (d, verbs) = path_data()?;
                // One color per path in R1: the stroke's role, else the fill's.
                let color_role = stroke
                    .and_then(|s| s.get("role"))
                    .or(fill.and_then(|f| f.get("role")));
                let color = role(ctx.palette, color_role, &format!("{path}/params/paint"))?;
                Mark::Path {
                    item: id.clone(),
                    d,
                    geometry: Geometry {
                        verbs,
                        stroke: stroke.map(|s| num(s.get("width")).unwrap_or(1.0)),
                        fill: fill.is_some(),
                    },
                    offset: pos,
                    color,
                }
            }
            // A 2D layer's pass runs on the target of a group that names it, and draws nothing.
            "gpu.pass@1" => return Ok(None),
            _ => return refuse("module_missing", format!("{path}/kind: {kind}")),
        }],
    };
    let order = item.get("order").and_then(Value::as_str).unwrap_or("");
    let mut scopes = ctx.scopes.get(id).cloned().unwrap_or_default();
    if childless_backdrop(id, item, ctx.items) {
        scopes.extend(ancestor_scope(id, item, ctx.items, ctx.palette)?);
    }
    // Masked text draws whole, clipped to its box: its width, and its height or its line limit's;
    // a code item's gutter (#1966) inside it, left of its text.
    let text = marks.iter().find_map(|m| match m {
        Mark::Text {
            item, spec, origin, ..
        } if item == id => Some((spec, origin)),
        _ => None,
    });
    if let (Some((spec, origin)), "text@1") = (text, kind) {
        let side = |k: &str| params.get("box").and_then(|b| num(b.get(k)));
        let lines = spec
            .max_lines
            .zip(spec.shaper_spec())
            .map(|(n, s)| f64::from(n) * f64::from(s.line_height()));
        if let (true, Some(w), Some(h)) = (spec.mask, side("w"), side("h").or(lines)) {
            scopes.push(Scope::Clip {
                item: format!("{id}#box"),
                rect: [origin[0] - reach, origin[1], w + reach, h],
                radius: 0.0,
            });
        }
    }
    if adjust.opacity < 1.0 {
        scopes.push(Scope::Opacity {
            item: format!("{id}#adjust"),
            alpha: adjust.opacity,
            blend: None,
            effect: None,
        });
    }
    let clip = clip_of(&scopes);
    if !adjust.is_identity() {
        marks.iter_mut().for_each(|m| m.adjust(&adjust));
    }
    let drawn = |marks: Vec<Mark>| -> Vec<Arc<Drawn>> {
        marks
            .into_iter()
            .map(|mark| {
                let mut scopes = scopes.clone();
                if let Some(alpha) = fades.get(mark.item()) {
                    scopes.push(Scope::Opacity {
                        item: format!("{}#fade", mark.item()),
                        alpha: *alpha,
                        blend: None,
                        effect: None,
                    });
                }
                Arc::new(Drawn { mark, clip, scopes })
            })
            .collect()
    };
    // A shade (Paint: shade, #160) draws between the shape's fill and its stroke, clipped to it.
    let shade = paint::Shade::read(
        ctx.palette,
        paint.get("shade"),
        &format!("{paint_path}/shade"),
    )?;
    let drawn_marks = match (&shade, dressing) {
        (None, Some(look)) => {
            let dress = crate::drawn::Dress {
                look,
                doc: ctx.paints.doc,
                items: ctx.items,
                palette: ctx.palette,
                first_rim: ctx.ty.first_rim,
                flat_ink: ctx.ty.flat_ink,
            };
            crate::drawn::dress(&dress, id, paint, marks)?
                .into_iter()
                .map(|(mark, inner)| {
                    let mut all = scopes.clone();
                    all.extend(inner);
                    Arc::new(Drawn {
                        mark,
                        clip,
                        scopes: all,
                    })
                })
                .collect()
        }
        (None, None) => drawn(marks),
        (Some(shade), _) => marks
            .into_iter()
            .flat_map(|mark| shaded(id, mark, shade, &scopes, clip))
            .collect(),
    };
    // #467: paint built from the item's coverage: a drop, a glow, an inner shade, bevel, satin.
    let light = ctx.ty.drawn.as_ref().and_then(|l| l.light.as_ref()).map_or(
        crate::fx::Light::default(),
        |l| crate::fx::Light {
            dir: l.dir,
            elevation: l.elevation,
        },
    );
    let mut fx = crate::fx::Fx::read(ctx.palette, paint, &paint_path, light)?;
    // #1653: halos on a text, or on each row of a set of texts.
    let set_of_texts =
        kind == "marks@1" && params.get("mark").and_then(Value::as_str) == Some("text");
    let halos = if kind == "text@1" || set_of_texts {
        crate::fx::halos(
            ctx.palette,
            params.get("halo"),
            &format!("{path}/params/halo"),
        )?
    } else {
        Vec::new()
    };
    let drawn_marks = if set_of_texts && !halos.is_empty() {
        let only = crate::fx::Fx {
            halos,
            ..crate::fx::Fx::default()
        };
        let rows = with_fx(id, &fx, drawn_marks);
        rows.into_iter()
            .flat_map(|d| {
                let row = d.mark.item().to_string();
                with_fx(&row, &only, vec![d])
            })
            .collect()
    } else {
        fx.halos = halos;
        with_fx(id, &fx, drawn_marks)
    };
    Ok(Some(Placed {
        keys: Vec::new(),
        layer: layer.to_string(),
        order: order.to_string(),
        rank: rank_of(ctx.items, id, item),
        after: drawn(after),
        drawn: drawn_marks,
    }))
}

/// `mark` in one color, every span of a text included.
pub(super) fn recolored(mark: &Mark, c: Rgb) -> Mark {
    let mut m = mark.clone();
    match &mut m {
        Mark::Rect { fill, .. } => *fill = Fill::Solid(c),
        Mark::Circle { color, .. } | Mark::Path { color, .. } => *color = c,
        Mark::Shape { fill, stroke, .. } => {
            fill.iter_mut().for_each(|(f, a)| {
                *f = Fill::Solid(c);
                *a = 1.0;
            });
            stroke.iter_mut().for_each(|l| {
                l.paint = Fill::Solid(c);
                l.opacity = 1.0;
            });
        }
        Mark::Text {
            color, runs, role, ..
        } => {
            *color = c;
            *role = None;
            runs.iter_mut().for_each(|r| r.color = c);
        }
        Mark::Image { .. } => {}
    }
    m
}

/// `mark` moved by `d` u, renamed `item`.
pub(super) fn moved(mark: &Mark, d: [f64; 2], name: &str) -> Mark {
    let shift = |p: [f64; 2]| [p[0] + d[0], p[1] + d[1]];
    let mut m = mark.clone();
    match &mut m {
        Mark::Rect { item, bounds, .. } | Mark::Image { item, bounds, .. } => {
            *item = name.to_string();
            bounds[0] += d[0];
            bounds[1] += d[1];
        }
        Mark::Circle { item, center, .. } => {
            *item = name.to_string();
            *center = shift(*center);
        }
        Mark::Path { item, offset, .. } => {
            *item = name.to_string();
            *offset = shift(*offset);
        }
        Mark::Text { item, origin, .. } => {
            *item = name.to_string();
            *origin = shift(*origin);
        }
        Mark::Shape { item, verbs, .. } => {
            *item = name.to_string();
            for v in verbs.iter_mut() {
                *v = match *v {
                    Verb::Move(p) => Verb::Move(shift(p)),
                    Verb::Line(p) => Verb::Line(shift(p)),
                    Verb::Quad(a, b) => Verb::Quad(shift(a), shift(b)),
                    Verb::Cubic(a, b, c) => Verb::Cubic(shift(a), shift(b), shift(c)),
                    Verb::Close => Verb::Close,
                };
            }
        }
    }
    m
}
