use super::*;

/// #2013: every `rest_on` of `which` that names `on`, solved from where the items stand and
/// written into `items`, a rest whose `on` another rest's owner is among after that one. What
/// can't be solved is in `problems`: an `on` that names nothing (`ref_unresolved`), an owner
/// with no true shape (`out_of_range`), rests in a loop (`cycle`) and no support within
/// `max_drop` (`no_support`); its owner stays where it was.
pub(super) fn rest(
    map: &Map<String, Value>,
    program: &Program,
    items: &mut Items<'_>,
    seconds: f64,
    which: Rests,
    problems: &mut Vec<Refused>,
) -> Rested {
    use deep_canvas_motion::doc::Kind;
    let mut out = Rested::new();
    let mut left: Vec<(&str, &str, &deep_canvas_motion::doc::RestOn, f64, f64)> = program
        .motion
        .constraints
        .iter()
        .filter_map(|c| match &c.kind {
            Kind::RestOn {
                on: Some(r),
                offset,
                max_drop,
                ..
            } => Some((c.id.as_str(), c.owner.as_str(), r, *offset, *max_drop)),
            _ => None,
        })
        .collect();
    if left.is_empty() {
        return out;
    }
    left.sort_by(|a, b| a.0.cmp(b.0));
    let doc = Value::Object(map.clone());
    let members = |items: &Items<'_>, on: &str| -> Option<Vec<String>> {
        if items.contains_key(on) {
            return Some(vec![on.to_string()]);
        }
        let list = map
            .get("collections")?
            .get(on)?
            .get("members")?
            .as_array()?;
        let mut ids: Vec<String> = list
            .iter()
            .filter_map(|m| m.as_str().map(str::to_string))
            .collect();
        ids.sort();
        ids.dedup();
        Some(ids)
    };
    let mut moving: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    while !left.is_empty() {
        // The first rest, by ID, whose `on` holds no owner still to be rested.
        let ready = left.iter().position(|(_, owner, r, _, _)| {
            members(items, &r.on).is_none_or(|m| {
                !m.iter()
                    .any(|x| x != owner && left.iter().any(|l| l.1 == x))
            })
        });
        let Some(k) = ready else {
            for (id, ..) in &left {
                problems.push(Refused {
                    code: "cycle",
                    path: format!("constraints/{id}/on"),
                });
            }
            break;
        };
        let (id, owner, r, offset, max_drop) = left.remove(k);
        // `on: ID | collection | ground`: an item or a collection by that name before the ground
        // plane, so a plate whose ID is `ground` is rested on as itself (#2014).
        let on_ids = match members(items, &r.on) {
            Some(m) => Some(m),
            None if r.on == "ground" => None,
            None => {
                problems.push(Refused {
                    code: "ref_unresolved",
                    path: format!("constraints/{id}/on"),
                });
                continue;
            }
        };
        let moved = moves(items, program, owner)
            || on_ids
                .iter()
                .flatten()
                .any(|x| moves(items, program, x) || moving.contains(x));
        if moved {
            moving.insert(owner.to_string());
        }
        if matches!(
            (which, moved),
            (Rests::Still, true) | (Rests::Moving, false)
        ) {
            continue;
        }
        let shapes_of = |x: &str| -> Vec<deep_canvas::geometry_audit::Shape> {
            let Some(item) = items.get(x) else {
                return Vec::new();
            };
            crate::shapes::of(&doc, x, item, &world(items, x), seconds)
                .ok()
                .flatten()
                .map_or_else(Vec::new, |(s, _)| s)
        };
        let own = shapes_of(owner);
        let Some((pos, rot, _)) = items.at_of(owner).filter(|_| !own.is_empty()) else {
            problems.push(Refused {
                code: "out_of_range",
                path: format!("constraints/{id}/owner"),
            });
            continue;
        };
        let on: Option<Vec<_>> = on_ids.map(|ids| {
            ids.iter()
                .filter(|x| x.as_str() != owner)
                .flat_map(|x| shapes_of(x))
                .collect()
        });
        let parent = items
            .get(owner)
            .and_then(|i| i.get("parent"))
            .and_then(Value::as_str)
            .map(|p| {
                items
                    .assemblies
                    .get(p)
                    .copied()
                    .unwrap_or_else(|| world(items, p))
            });
        let origin = match &parent {
            Some(p) => apply(p, pos),
            None => pos,
        };
        let solved = crate::rest::solve(&crate::rest::Rest {
            own: &own,
            origin,
            on: on.as_deref(),
            axis: r.axis,
            align: r.align,
            bounds: r.bounds,
            offset,
            max_drop,
        });
        let Some(solved) = solved else {
            problems.push(Refused {
                code: "no_support",
                path: format!("constraints/{id}"),
            });
            continue;
        };
        // The move and the turn in the owner's parent's space.
        let (by, turn) = match &parent {
            Some(p) => {
                let inv = crate::cut::inverse(p);
                let pr = rotation_of(p);
                let t = solved.turn.map(|m| {
                    let mut out = [[0.0; 3]; 3];
                    for i in 0..3 {
                        for j in 0..3 {
                            out[i][j] = (0..3)
                                .map(|a| (0..3).map(|b| pr[a][i] * m[a][b] * pr[b][j]).sum::<f64>())
                                .sum();
                        }
                    }
                    out
                });
                (turn(&inv, solved.by), t)
            }
            None => (solved.by, solved.turn),
        };
        let new_pos = [pos[0] + by[0], pos[1] + by[1], pos[2] + by[2]];
        let new_rot = turn.map(|m| {
            let own = rotation_of(&local_of([0.0; 3], rot, [1.0; 3], [1.0; 3]));
            let mut r = [[0.0; 3]; 3];
            for i in 0..3 {
                for j in 0..3 {
                    r[i][j] = (0..3).map(|a| m[i][a] * own[a][j]).sum();
                }
            }
            euler_of(&r)
        });
        items
            .rested
            .insert(owner.to_string(), (new_pos, new_rot.unwrap_or(rot)));
        out.insert(owner.to_string(), (new_pos, new_rot));
    }
    out
}

/// #2013: the document's `rest_on`s on true shapes solved at `t` (flicks), each owner with its
/// own position and rotation, and what couldn't be solved.
pub fn rested_at(doc: &Value, t: i64, which: Rests) -> Result<(Rested, Vec<Refused>), Refused> {
    let Some(map) = doc.as_object() else {
        return refused("out_of_range", "");
    };
    let program = Program::compile(map).map_err(|r| Refused {
        code: r.code,
        path: r.path,
    })?;
    Ok(rested_with(map, &program, t, which))
}

/// [`rested_at`] of a document whose motion program is compiled already.
pub fn rested_with(
    map: &Map<String, Value>,
    program: &Program,
    t: i64,
    which: Rests,
) -> (Rested, Vec<Refused>) {
    let mut state = program.state();
    program.evaluate_local(t, eval::Validity::Full, &mut state);
    let empty = Map::new();
    let doc_items = map
        .get("items")
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let written = eval::written(map, program, &state);
    let mut items = Items::new(doc_items, &written, &state, program);
    let mut problems = Vec::new();
    let seconds = t as f64 / deep_canvas::camera::FLICKS_PER_SECOND as f64;
    let out = rest(map, program, &mut items, seconds, which, &mut problems);
    (out, problems)
}

impl Index<&str> for Items<'_> {
    type Output = Value;

    fn index(&self, id: &str) -> &Value {
        self.get(id).expect("an item of the document")
    }
}

pub(crate) fn origin(m: &Affine3) -> Vec3 {
    [m[0][3], m[1][3], m[2][3]]
}

pub(crate) fn paint(look: &Look3, params: &Value, path: &str) -> Result<[u8; 3], Refused> {
    // #149: a noise fill's first stop, or a line's own role, or the ink a named fill leaves out.
    let drawn = params
        .pointer("/paint/fill/noise/stops/0/role")
        .or_else(|| {
            params
                .pointer("/paint/fill/role")
                .is_none()
                .then(|| params.pointer("/paint/stroke/role"))
                .flatten()
        });
    if let Some(c) = drawn.and_then(Value::as_str).and_then(|r| look.role(r)) {
        return Ok(c);
    }
    let role = params
        .get("paint")
        .and_then(|p| p.get("fill"))
        .and_then(|f| f.get("role"))
        .and_then(Value::as_str);
    match role.and_then(|r| look.role(r)) {
        Some(c) => Ok(c),
        None => refused("ref_unresolved", format!("{path}/paint/fill/role")),
    }
}

/// A solid's `paint.stroke {role, width}`: an outline around a box or a built mesh (a recipe's
/// parts among them, #173); a cylinder's or a sphere's isn't drawn yet, so it's refused rather
/// than left out.
pub(super) fn stroke(
    look: &Look3,
    params: &Value,
    shape: Shape,
    path: &str,
) -> Result<Option<Stroke>, Refused> {
    let Some(st) = params.get("paint").and_then(|p| p.get("stroke")) else {
        return Ok(None);
    };
    if !matches!(shape, Shape::Box | Shape::Built(_)) {
        return refused("stroke_shape", format!("{path}/paint/stroke"));
    }
    let Some(color) = st
        .get("role")
        .and_then(Value::as_str)
        .and_then(|r| look.role(r))
    else {
        return refused("ref_unresolved", format!("{path}/paint/stroke/role"));
    };
    let width = match st.get("width") {
        None => 1.0,
        Some(w) => match num(Some(w)).filter(|w| *w > 0.0) {
            Some(w) => w,
            None => return refused("out_of_range", format!("{path}/paint/stroke/width")),
        },
    };
    Ok(Some(Stroke {
        color,
        width,
        exact: false,
    }))
}

pub(super) fn order_key(item: &Value) -> &str {
    item.get("order").and_then(Value::as_str).unwrap_or("")
}

/// An entry of a line's `points`: a point, or an item's evaluated anchor (its origin).
/// A line's point in its own frame: written, or an item's (`ID#anchor`'s) evaluated world point
/// at t carried into the line's frame by the inverse of its `model` (#468), so it stays on the
/// part it names.
pub(super) fn point_of(
    items: &Items<'_>,
    v: &Value,
    path: &str,
    model: &Affine3,
) -> Result<Vec3, Refused> {
    if let Some(p) = vec3(Some(v)) {
        return Ok(p);
    }
    let Some(handle) = v.as_str() else {
        return refused("out_of_range", path);
    };
    let Some(p) = anchor_point(items, handle) else {
        return refused("ref_unresolved", path);
    };
    Ok(apply(&crate::cut::inverse(model), p))
}

/// A `mark.text@1`'s label at the world `m` (#226: a module's marks draw theirs through it too).
pub(crate) fn label(
    id: &str,
    params: &Value,
    path: &str,
    m: &Affine3,
    look: &Look3,
    labels: &mut Labels,
) -> Result<Label, Refused> {
    let text = params.get("text").and_then(Value::as_str).unwrap_or("");
    let font = params.get("font").and_then(Value::as_str).unwrap_or("body");
    let Some(role) = Role::parse(font) else {
        return refused("out_of_range", format!("{path}/font"));
    };
    let facing = match params.get("facing").and_then(Value::as_str) {
        None | Some("camera") => Facing::Camera,
        Some("upright") => Facing::Upright,
        Some("fixed") => Facing::Fixed,
        Some(_) => return refused("out_of_range", format!("{path}/facing")),
    };
    let world_space = params.get("size_space").and_then(Value::as_str) == Some("world");
    let size = num(params.get("size")).unwrap_or(if world_space { 0.25 } else { 13.0 });
    // A screen-size label's run is a 2D text's of that text, font and size.
    let run_size = if world_space {
        WORLD_EM_PX
    } else {
        size as f32
    };
    let (run_box, glyphs) = labels.run(text, role, run_size);
    let shaped_at = glyphs.first().map_or(run_size, |g| g.size);
    let to_em = size / f64::from(shaped_at);
    Ok(Label {
        id: id.to_string(),
        text: text.to_string(),
        role,
        glyphs,
        bounds: run_box,
        pos: origin(m),
        em: size,
        quad: [run_box[0] * to_em, run_box[1] * to_em],
        world: world_space,
        facing,
        axes: [
            normalize(turn(m, [1.0, 0.0, 0.0])),
            normalize(turn(m, [0.0, 1.0, 0.0])),
        ],
        color: paint(look, params, path)?,
    })
}

pub(crate) fn line(
    items: &Items<'_>,
    id: &str,
    params: &Value,
    look: &Look3,
    (map, t): (&Map<String, Value>, i64),
) -> Result<Line, Refused> {
    let path = format!("items/{id}/params");
    let model = world(items, id);
    // #537: points that read a logic array, each with whether it hides.
    let (points, hidden) = match crate::points::of(map, id, params, t)? {
        Some(read) => read,
        None => (
            params
                .get("points")
                .and_then(Value::as_array)
                .map_or(Ok(Vec::new()), |list| {
                    list.iter()
                        .enumerate()
                        .map(|(i, v)| point_of(items, v, &format!("{path}/points/{i}"), &model))
                        .collect::<Result<Vec<_>, _>>()
                })?,
            Vec::new(),
        ),
    };
    // #149: a named line's width and its profile along the line.
    let named = params.pointer("/paint/stroke/line").and_then(Value::as_str);
    let drawn_line = match (named, look.drawn.as_ref()) {
        (Some(name), Some(d)) => d.line(name).map_err(|r| Refused {
            code: r.code,
            path: r.path,
        })?,
        _ => None,
    };
    let written = points.len();
    let written_points: Vec<Vec3> = points.iter().map(|p| apply(&model, *p)).collect();
    let (points, along) = match drawn_line.as_ref().and_then(|l| l.profile.as_ref()) {
        Some(p) => profiled_points(&points, p),
        None => {
            let flat = vec![1.0; points.len()];
            (points, flat)
        }
    };
    let n = points.len();
    let base = drawn_line.as_ref().and_then(|l| l.width);
    let widths: Vec<f64> = match params.get("width") {
        None | Some(Value::Null) => along.iter().map(|k| base.unwrap_or(1.5) * k).collect(),
        Some(Value::Array(w)) if w.len() == written => {
            let w = w
                .iter()
                .map(|x| num(Some(x)).filter(|&x| x >= 0.0))
                .collect::<Option<Vec<_>>>()
                .map_or_else(|| refused("out_of_range", format!("{path}/width")), Ok)?;
            // A profile multiplies each point's own width, at the written point it grew from.
            let at = |i: usize| i * written.saturating_sub(1) / n.saturating_sub(1).max(1);
            (0..n).map(|i| w[at(i)] * along[i]).collect()
        }
        Some(v) => match num(Some(v)).filter(|&x| x >= 0.0) {
            Some(w) => along.iter().map(|k| w * k).collect(),
            None => return refused("out_of_range", format!("{path}/width")),
        },
    };
    let mode = params
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("strip");
    let Some(pairs) = crate::points::segments(mode, n) else {
        return refused("out_of_range", format!("{path}/mode"));
    };
    // A point that can't narrow hides each segment that meets it, which keeps its record.
    let hides = |i: usize| n == written && hidden.get(i) == Some(&true);
    let segments = pairs
        .into_iter()
        .map(|(a, b)| Segment {
            a: apply(&model, points[a]),
            b: apply(&model, points[b]),
            wa: widths[a],
            wb: widths[b],
            hidden: hides(a) || hides(b),
        })
        .collect();
    Ok(Line {
        id: id.to_string(),
        segments,
        world: params.get("size_space").and_then(Value::as_str) == Some("world"),
        color: paint(look, params, &path)?,
        edges: None,
        over: false,
        joined: drawn_line.is_some(),
        dash: [0.0; 2],
        dash_world: false,
        cap: crate::points::cap(params, &path)?,
        trail: None,
        points: written_points,
    })
}

/// A line's stroke modifiers at `seconds`, in its declared order (Modifier: `dash`, `outline`,
/// `boil`, and `build` on a stroke): each edits the line's segments while its `while` holds
/// (`drawing` while a build on the line is mid-progress, `moving` while a channel moves the
/// line's `at`); an outline is a wider line drawn under it, which this returns.
pub(super) fn strokes(
    map: &Map<String, Value>,
    id: &str,
    item: &Value,
    line: &mut Line,
    look: &Look3,
    seconds: f64,
) -> Result<Vec<Line>, Refused> {
    let list = item.get("modifiers").and_then(Value::as_array);
    let Some(list) = list.filter(|l| !l.is_empty()) else {
        return Ok(Vec::new());
    };
    let on = |m: &Value| crate::stack::enabled(m);
    let num = |m: &Value, f: &str, d: f64| -> Option<f64> {
        match m.pointer(&format!("/params/{f}")) {
            None => Some(d),
            Some(v) => v.as_f64().filter(|x| x.is_finite()),
        }
    };
    let drawing = list.iter().any(|m| {
        on(m)
            && m.get("kind").and_then(Value::as_str) == Some("mod.build@1")
            && num(m, "to", 1.0)
                .is_some_and(|to| to < 1.0 && to > num(m, "from", 0.0).unwrap_or(0.0))
    });
    let at = format!("items/{id}/at");
    let moving = ["channels", "drivers"].iter().any(|section| {
        map.get(*section)
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
            .any(|(_, c)| {
                c.get("target")
                    .and_then(Value::as_str)
                    .is_some_and(|t| t.starts_with(&at))
            })
    });
    let mut under = Vec::new();
    for (k, m) in list.iter().enumerate() {
        let path = |f: &str| format!("items/{id}/modifiers/{k}/{f}");
        let kind = m.get("kind").and_then(Value::as_str).unwrap_or("");
        // #226: a module's deform moved the line's points before it was drawn.
        if crate::contributed::named(kind) {
            continue;
        }
        if !crate::stack::STROKE.contains(&kind) {
            return refused("out_of_range", path("kind"));
        }
        if !on(m) {
            continue;
        }
        let holds = match m.get("while").and_then(Value::as_str).unwrap_or("always") {
            "always" => true,
            "drawing" => drawing,
            "moving" => moving,
            _ => return refused("out_of_range", path("while")),
        };
        if !holds {
            continue;
        }
        let bad = |f: &str| Refused {
            code: "out_of_range",
            path: path(&format!("params/{f}")),
        };
        match kind {
            "mod.build@1" => {
                let (from, to) = (
                    num(m, "from", 0.0).ok_or_else(|| bad("from"))?,
                    num(m, "to", 1.0).ok_or_else(|| bad("to"))?,
                );
                if !(0.0..=1.0).contains(&from) || !(0.0..=1.0).contains(&to) {
                    return Err(bad("to"));
                }
                let total = stroke_length(&line.segments);
                line.segments = cut(&line.segments, from.min(to) * total, from.max(to) * total);
            }
            "mod.dash@1" => {
                let (dash, gap) = (
                    num(m, "dash", 0.1).ok_or_else(|| bad("dash"))?,
                    num(m, "gap", 0.05).ok_or_else(|| bad("gap"))?,
                );
                if dash <= 0.0 || gap < 0.0 {
                    return Err(bad("dash"));
                }
                let total = stroke_length(&line.segments);
                let mut out = Vec::new();
                let mut s = 0.0;
                while s < total && out.len() < 100_000 {
                    out.extend(cut(&line.segments, s, (s + dash).min(total)));
                    s += dash + gap;
                }
                line.segments = out;
            }
            "mod.boil@1" => {
                let (amount, hz) = (
                    num(m, "amount", 0.01).ok_or_else(|| bad("amount"))?,
                    num(m, "hz", 8.0).ok_or_else(|| bad("hz"))?,
                );
                if hz <= 0.0 {
                    return Err(bad("hz"));
                }
                // Stepped at hz: one draw per step, the same for every frame in it.
                let step = (seconds * hz).floor() as i64 as u64;
                let seed = crate::stack::seed_of(id, m);
                let jitter = |p: Vec3, j: u64| -> Vec3 {
                    let n = |axis: u64| {
                        crate::stack::unit_noise(seed ^ step.wrapping_mul(0x9e37), 3 * j + axis)
                    };
                    [
                        p[0] + amount * n(0),
                        p[1] + amount * n(1),
                        p[2] + amount * n(2),
                    ]
                };
                for (j, seg) in line.segments.iter_mut().enumerate() {
                    seg.a = jitter(seg.a, 2 * j as u64);
                    seg.b = jitter(seg.b, 2 * j as u64 + 1);
                }
            }
            "mod.outline@1" => {
                let width = num(m, "width", 2.0)
                    .filter(|w| *w > 0.0)
                    .ok_or_else(|| bad("width"))?;
                let role = m
                    .pointer("/params/role")
                    .and_then(Value::as_str)
                    .unwrap_or("ground");
                let Some(color) = look.role(role) else {
                    return refused("ref_unresolved", path("params/role"));
                };
                let mut wide = line.clone();
                for seg in &mut wide.segments {
                    seg.wa += 2.0 * width;
                    seg.wb += 2.0 * width;
                }
                wide.color = color;
                under.push(wide);
            }
            _ => {}
        }
    }
    Ok(under)
}

/// A stroke's length: its segments' in turn.
pub(super) fn stroke_length(segments: &[Segment]) -> f64 {
    segments.iter().map(|s| dist(s.a, s.b)).sum()
}

pub(super) fn dist(a: Vec3, b: Vec3) -> f64 {
    sqrt(
        (b[0] - a[0]) * (b[0] - a[0])
            + (b[1] - a[1]) * (b[1] - a[1])
            + (b[2] - a[2]) * (b[2] - a[2]),
    )
}

/// The part of a stroke from `s0` to `s1` metres along it.
pub(super) fn cut(segments: &[Segment], s0: f64, s1: f64) -> Vec<Segment> {
    let lerp = |a: Vec3, b: Vec3, f: f64| {
        [
            a[0] + (b[0] - a[0]) * f,
            a[1] + (b[1] - a[1]) * f,
            a[2] + (b[2] - a[2]) * f,
        ]
    };
    let mut out = Vec::new();
    let mut at = 0.0;
    for seg in segments {
        let len = dist(seg.a, seg.b);
        let (from, to) = ((s0 - at).max(0.0), (s1 - at).min(len));
        if to > from && len > 0.0 {
            let (fa, fb) = (from / len, to / len);
            out.push(Segment {
                a: lerp(seg.a, seg.b, fa),
                b: lerp(seg.a, seg.b, fb),
                wa: seg.wa + (seg.wb - seg.wa) * fa,
                wb: seg.wa + (seg.wb - seg.wa) * fb,
                hidden: seg.hidden,
            });
        }
        at += len;
    }
    out
}

/// A builder's or building kind's mesh after its stack, or why it can't be built.
pub(crate) fn mesh_of(
    doc: &Value,
    id: &str,
    item: &Value,
    t: f64,
    outlines: Outlines<'_>,
) -> Result<crate::geom::Mesh, Refused> {
    let kind = item.get("kind").and_then(Value::as_str).unwrap_or("");
    let built = if crate::building::KINDS.contains(&kind) {
        crate::building::build(doc, id, item)
    } else {
        let run = crate::stack::Run {
            outlines: outlines.outlines.to_vec(),
            fills: outlines.module.to_vec(),
            planted: outlines.planted.map(str::to_string),
            ..Default::default()
        };
        crate::build::built(doc, id, item, &run, t).map(|b| b.mesh.unwrap_or_default())
    };
    built.map_err(|path| match path.split_once(crate::builders::CODED) {
        Some((code, at)) => Refused {
            code: crate::build::code_of(code),
            path: at.to_string(),
        },
        None => Refused {
            code: "out_of_range",
            path: format!("items/{id}/{path}"),
        },
    })
}

/// A line of the edges of the mesh `edges.of` builds (Marks in 3D: mesh edges).
#[allow(clippy::too_many_arguments)]
pub(super) fn edge_line(
    doc: &Value,
    items: &Items<'_>,
    id: &str,
    params: &Value,
    look: &Look3,
    seconds: f64,
    outlines: Outlines<'_>,
    assets: Option<Assets<'_>>,
) -> Result<Line, Refused> {
    let path = format!("items/{id}/params");
    let edges = &params["edges"];
    let of = edges.get("of").and_then(Value::as_str).unwrap_or("");
    let target = of.split('#').next().unwrap_or("");
    let Some(item) = items.get(target) else {
        return refused("ref_unresolved", format!("{path}/edges/of"));
    };
    let kind = match crate::geom::EdgeKind::read(edges) {
        Ok(kind) => kind,
        Err(field) => return refused("out_of_range", format!("{path}/edges/{field}")),
    };
    let width = match params.get("width") {
        None | Some(Value::Null) => 1.5,
        Some(v) => match num(Some(v)).filter(|w| *w >= 0.0) {
            Some(w) => w,
            None => return refused("out_of_range", format!("{path}/width")),
        },
    };
    // Its dash and gap in its size space; one length dashes as long as it gaps.
    let dash = match params.get("dash") {
        None | Some(Value::Null) => [0.0; 2],
        Some(v) => match v
            .as_array()
            .map(|a| a.iter().map(|x| num(Some(x))).collect())
        {
            Some(Some::<Vec<f64>>(d))
                if d.iter().all(|x| *x >= 0.0) && matches!(d.len(), 1 | 2) =>
            {
                [d[0], d[d.len() - 1]]
            }
            _ => return refused("out_of_range", format!("{path}/dash")),
        },
    };
    let mut mesh = match (item.get("kind").and_then(Value::as_str), assets) {
        // A glTF asset's mesh, read as its solid is (#1640).
        (Some("mesh.asset@1"), Some(read)) => {
            asset_mesh(read, target, item.get("params").unwrap_or(&Value::Null))?.0
        }
        _ => mesh_of(doc, target, item, seconds, outlines)?,
    };
    if let Some((_, part)) = of.split_once('#') {
        let Some(tris) = mesh
            .parts
            .get(part)
            .or_else(|| mesh.closed.get(part).map(|c| &c.0))
            .cloned()
        else {
            return refused("ref_unresolved", format!("{path}/edges/of"));
        };
        let mut only = crate::geom::Mesh {
            positions: mesh.positions.clone(),
            normals: mesh.normals.clone(),
            ..Default::default()
        };
        for t in tris {
            let k = 3 * t as usize;
            only.indices.extend(&mesh.indices[k..k + 3]);
            only.faces.push(mesh.faces[t as usize]);
        }
        mesh = only;
    }
    let (list, derived) = match kind {
        crate::geom::EdgeKind::Crease { angle, border } => mesh.crease_set(angle, border, None),
        _ => (Arc::new(mesh.edge_list(kind, None)), true),
    };
    let source = EdgesOf {
        mesh: Arc::new(mesh),
        kind,
        model: world(items, target),
        width,
        list,
        derived,
    };
    let world = params.get("size_space").and_then(Value::as_str) == Some("world");
    Ok(Line {
        id: id.to_string(),
        segments: source.segments(true),
        world,
        color: paint(look, params, &path)?,
        edges: Some(Arc::new(source)),
        over: false,
        joined: false,
        dash,
        dash_world: world,
        cap: Default::default(),
        trail: None,
        points: Vec::new(),
    })
}
