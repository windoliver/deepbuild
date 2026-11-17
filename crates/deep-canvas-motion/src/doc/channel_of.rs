use super::*;

/// A follow channel's `follow` on held keys or a control's value (#489): its source, its model
/// and its outputs. A `follow` naming `source.control` and its option `values` is #417's.
pub(super) fn follow_spec_of(
    f: &Map<String, Value>,
    ctx: &Ctx,
    path: &str,
) -> Result<follow::Spec, Refused> {
    let source = match f.get("source") {
        Some(Value::String(s)) => match s
            .strip_prefix("controls/")
            .and_then(|r| r.strip_suffix("/value"))
        {
            Some(id) if !id.is_empty() => follow::Source::Control(id.to_string()),
            _ => return refuse("bad_path", format!("{path}/source")),
        },
        Some(Value::Object(o)) => {
            let Some(Value::Object(keys)) = o.get("keys") else {
                return refuse("bad_doc", format!("{path}/source"));
            };
            let mut list = Vec::new();
            for (kid, k) in keys {
                let kpath = format!("{path}/source/keys/{kid}");
                // The source holds between its changes: a key that moves is a varying source.
                match k.get("interp").and_then(Value::as_str) {
                    None | Some("hold") => {}
                    Some(_) => return refuse("varying_source", kpath),
                }
                list.push((
                    time_of(k.get("t"), ctx, &format!("{kpath}/t"))?,
                    number(k.get("value"), &format!("{kpath}/value"))?,
                ));
            }
            list.sort_by_key(|(t, _)| *t);
            if list.is_empty() {
                return refuse("bad_doc", format!("{path}/source/keys"));
            }
            follow::Source::Keys(list)
        }
        _ => return refuse("bad_doc", format!("{path}/source")),
    };
    let Some(Value::Object(m)) = f.get("model") else {
        return refuse("bad_doc", format!("{path}/model"));
    };
    let mpath = format!("{path}/model");
    let positive = |o: &Map<String, Value>, k: &str, d: Option<f64>| -> Result<f64, Refused> {
        let v = match (o.get(k), d) {
            (None, Some(d)) => d,
            (v, _) => number(v, &format!("{mpath}/{k}"))?,
        };
        if v > 0.0 {
            Ok(v)
        } else {
            refuse("out_of_range", format!("{mpath}/{k}"))
        }
    };
    let model = if let Some(Value::Object(s)) = m.get("spring") {
        follow::Model::Spring(spring_of(s, &format!("{mpath}/spring"))?)
    } else if let Some(Value::Object(o)) = m.get("first_order") {
        let tau = o.get("tau").and_then(Value::as_f64);
        follow::Model::FirstOrder {
            tau_up: positive(o, "tau_up", tau)?,
            tau_down: positive(o, "tau_down", tau)?,
        }
    } else if let Some(Value::Object(o)) = m.get("rate_limit") {
        follow::Model::RateLimit {
            max: positive(o, "max", None)?,
        }
    } else if let Some(Value::Object(o)) = m.get("transition") {
        let span = seconds_of(o.get("span"), ctx, &format!("{mpath}/transition/span"))?;
        if span <= 0 {
            return refuse("out_of_range", format!("{mpath}/transition/span"));
        }
        let along = match interp_of(o.get("interp"), &format!("{mpath}/transition/interp"))? {
            Interp::Ease(e) => follow::Along::Ease(e.ease),
            Interp::Bezier { x1, y1, x2, y2 } => {
                follow::Along::Bezier(crate::curve::Bezier::new(x1, y1, x2, y2))
            }
            Interp::Linear => follow::Along::Linear,
            _ => return refuse("bad_interp", format!("{mpath}/transition/interp")),
        };
        follow::Model::Transition { span, along }
    } else {
        return refuse("bad_doc", mpath);
    };
    let outputs: Vec<&str> = match f.get("outputs") {
        None => vec!["value"],
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).collect(),
        Some(_) => return refuse("bad_doc", format!("{path}/outputs")),
    };
    if let Some(bad) = outputs
        .iter()
        .find(|o| !matches!(**o, "value" | "rate" | "integral"))
    {
        return refuse("bad_doc", format!("{path}/outputs/{bad}"));
    }
    let (rate, integral) = (outputs.contains(&"rate"), outputs.contains(&"integral"));
    if matches!(model, follow::Model::Transition { .. }) && (rate || integral) {
        return refuse("bad_doc", format!("{path}/outputs"));
    }
    Ok(follow::Spec {
        source,
        model,
        rate,
        integral,
    })
}

/// The code a `per_loop` on a document that doesn't loop is refused with.
pub const PER_LOOP_NO_LOOP: &str = "per_loop_no_loop";

/// One modifier: `{wave: {...}}`, `{noise: {...}}`, `{pulse: {...}}` or `{limits: {...}}`, or
/// the same with its kind in `kind`; each takes an `influence` (1).
pub(super) fn modifier_of(
    m: &Value,
    ctx: &Ctx,
    transport: &Transport,
    path: &str,
    channel: &str,
    // The channel's id when its times are on the timeline (not in a clip), for the literal notice.
    placed: Option<&str>,
) -> Result<Modifier, Refused> {
    let Value::Object(m) = m else {
        return refuse("bad_doc", path);
    };
    let (kind, body, at) = match m.get("kind").and_then(Value::as_str) {
        Some(k) => (k.to_string(), m, path.to_string()),
        None => match m.iter().find(|(k, v)| v.is_object() && *k != "influence") {
            Some((k, Value::Object(b))) => (k.clone(), b, format!("{path}/{k}")),
            _ => return refuse("bad_doc", path),
        },
    };
    let num = |k: &str, d: f64| -> Result<f64, Refused> {
        match body.get(k) {
            None => Ok(d),
            v => number(v, &format!("{at}/{k}")),
        }
    };
    let rate = || -> Result<Rate, Refused> {
        match body.get("per_loop") {
            Some(v) => {
                let n = v.as_u64().filter(|n| (1..=u64::from(u16::MAX)).contains(n));
                let Some(n) = n else {
                    return refuse("out_of_range", format!("{at}/per_loop"));
                };
                let span = match (transport.wrap, transport.span) {
                    (true, Some(span)) => span,
                    _ => return refuse(PER_LOOP_NO_LOOP, channel),
                };
                Ok(Rate::PerLoop { n: n as u16, span })
            }
            None if body.contains_key("period") => {
                let p = num("period", 1.0)?;
                if p <= 0.0 {
                    return refuse("out_of_range", format!("{at}/period"));
                }
                Ok(Rate::Hz(1.0 / p))
            }
            None => Ok(Rate::Hz(num("frequency", 1.0)?)),
        }
    };
    let kind = match kind.as_str() {
        "wave" => ModKind::Wave {
            amplitude: num("amplitude", 1.0)?,
            rate: rate()?,
            phase: num("phase", 0.0)?,
            offset: num("offset", 0.0)?,
        },
        "noise" => ModKind::Noise {
            amplitude: num("amplitude", 1.0)?,
            rate: rate()?,
            seed: match body.get("seed") {
                None => 0,
                Some(v) => v
                    .as_u64()
                    .map_or_else(|| refuse("out_of_range", format!("{at}/seed")), Ok)?,
            },
        },
        "quantize" => {
            let hz = num("hz", 0.0)?;
            if hz <= 0.0 {
                return refuse("out_of_range", format!("{at}/hz"));
            }
            ModKind::Quantize {
                hz,
                jump: jump_of(body.get("jump"), &format!("{at}/jump"))?,
            }
        }
        "limits" => {
            let (min, max) = (num("min", f64::MIN)?, num("max", f64::MAX)?);
            // Limits written upside down hold no value.
            if min > max {
                return refuse("out_of_range", format!("{at}/min"));
            }
            ModKind::Limits { min, max }
        }
        "pulse" => {
            let shape = match body.get("shape") {
                None => Shape::ThereAndBack,
                Some(Value::String(s)) if s == "there_and_back" => Shape::ThereAndBack,
                Some(Value::String(s)) if s == "pause" => Shape::Pause(1.0 / 3.0),
                Some(Value::String(s)) if s == "wiggle" => Shape::Wiggle(2.0),
                Some(Value::Object(o)) if o.contains_key("pause") => Shape::Pause(
                    o["pause"]
                        .get("share")
                        .and_then(Value::as_f64)
                        .unwrap_or(1.0 / 3.0),
                ),
                Some(Value::Object(o)) if o.contains_key("wiggle") => Shape::Wiggle(
                    o["wiggle"]
                        .get("count")
                        .and_then(Value::as_f64)
                        .unwrap_or(2.0),
                ),
                Some(_) => return refuse("bad_doc", format!("{at}/shape")),
            };
            let ease = match body.get("ease") {
                None => ease::named("sigmoid", Some(10.0)).unwrap_or(Named::Smoothstep),
                Some(e) => named_of(e, &format!("{at}/ease"))?,
            };
            ModKind::Pulse {
                at: match placed {
                    Some(id) => placed_time_of(body.get("at"), ctx, &format!("{at}/at"), id)?,
                    None => time_of(body.get("at"), ctx, &format!("{at}/at"))?,
                },
                span: time_of(body.get("span"), ctx, &format!("{at}/span"))?,
                amount: num("amount", 1.0)?,
                shape,
                ease,
            }
        }
        _ => return refuse("bad_doc", format!("{path}/kind")),
    };
    let influence = match m.get("influence").or_else(|| body.get("influence")) {
        None => 1.0,
        v => number(v, &format!("{path}/influence"))?,
    };
    Ok(Modifier { kind, influence })
}

pub(crate) fn channel_of(
    id: &str,
    c: &Map<String, Value>,
    in_clip: bool,
    ctx: &Ctx,
    transport: &Transport,
    path: &str,
    labels: &mut Vec<String>,
) -> Result<Channel, Refused> {
    let Some(Value::String(target)) = c.get("target") else {
        return refuse("bad_path", format!("{path}/target"));
    };
    let target = target_of(target, in_clip, &format!("{path}/target"))?;
    let ty = match c.get("type").and_then(Value::as_str) {
        Some("f32") | None => ValueType::F32,
        Some("color") => match c.get("space").and_then(Value::as_str) {
            Some("oklab") | None => ValueType::Color,
            _ => return refuse("bad_space", format!("{path}/space")),
        },
        Some("vec2" | "vec3") => ValueType::Vec,
        Some("quat") => ValueType::Quat,
        Some("angle") => ValueType::Angle,
        Some("bool") => ValueType::Bool,
        Some("enum") => ValueType::Enum,
        Some("path") => ValueType::Path,
        _ => return refuse("bad_type", format!("{path}/type")),
    };
    let width = match c.get("type").and_then(Value::as_str) {
        Some("vec2") => 2,
        Some("quat") => 4,
        Some("color" | "vec3") => 3,
        _ => 1,
    };
    let absolute = match (ty, c.get("space").and_then(Value::as_str)) {
        (ValueType::Angle, Some("absolute")) => true,
        (ValueType::Angle, None | Some("shortest")) => false,
        (ValueType::Angle, Some(_)) => return refuse("bad_space", format!("{path}/space")),
        _ => false,
    };
    let range = match c.get("range") {
        None => None,
        Some(Value::Array(r)) if r.len() == 2 => {
            let (lo, hi) = (
                number(r.first(), &format!("{path}/range/0"))?,
                number(r.get(1), &format!("{path}/range/1"))?,
            );
            if lo > hi {
                return refuse("out_of_range", format!("{path}/range"));
            }
            Some((lo, hi))
        }
        Some(_) => return refuse("bad_doc", format!("{path}/range")),
    };
    if c.get("mode").and_then(Value::as_str) == Some("follow") {
        if in_clip || ty != ValueType::F32 {
            return refuse("bad_doc", format!("{path}/mode"));
        }
        let Some(Value::Object(f)) = c.get("follow") else {
            return refuse("bad_doc", format!("{path}/follow"));
        };
        return Ok(Channel {
            id: id.to_string(),
            target,
            ty,
            curve: Curve::new(Vec::new()),
            modifiers: Vec::new(),
            follow: Some(follow_spec_of(f, ctx, &format!("{path}/follow"))?),
            range,
            glide: None,
            path: None,
            named: None,
        });
    }
    let mut keys = Vec::new();
    let mut path_shapes: Vec<(String, Option<crate::morph::Shape>, Option<String>)> = Vec::new();
    // #468: keys on a dof's focus may name items (a focus pull), eased in_out_cubic by default.
    let focus = !in_clip && ty == ValueType::F32 && target.field == ["params", "dof", "focus"];
    let mut named: Vec<(String, FocusKey)> = Vec::new();
    let strict = match (ty, c.get("morph").and_then(Value::as_str), c.get("morph")) {
        (_, _, None) => false,
        (ValueType::Path, Some("match"), _) => false,
        (ValueType::Path, Some("strict"), _) => true,
        _ => return refuse("bad_doc", format!("{path}/morph")),
    };
    // A frame's layout is a channel target: its keys may glide, the value itself held.
    let glides = !in_clip && ty == ValueType::Enum && target.field == ["params", "layout"];
    let mut glide: Vec<Key> = Vec::new();
    let Some(Value::Object(map)) = c.get("keys") else {
        return refuse("bad_doc", format!("{path}/keys"));
    };
    for (kid, key) in map {
        let kpath = format!("{path}/keys/{kid}");
        let Value::Object(key) = key else {
            return refuse("bad_doc", kpath);
        };
        let t = if in_clip {
            time_of(key.get("t"), ctx, &format!("{kpath}/t"))?
        } else {
            placed_time_of(
                key.get("t"),
                ctx,
                &format!("{kpath}/t"),
                &format!("{id}/{kid}"),
            )?
        };
        let value = match (ty, key.get("value")) {
            (ValueType::F32, Some(Value::String(item))) if focus && !item.is_empty() => {
                named.push((kid.clone(), FocusKey::Item(item.clone())));
                vec![0.0]
            }
            (ValueType::F32 | ValueType::Angle, v) => {
                let x = number(v, &format!("{kpath}/value"))?;
                if focus {
                    named.push((kid.clone(), FocusKey::At(x)));
                }
                vec![x]
            }
            (ValueType::Bool, Some(Value::Bool(b))) => vec![if *b { 1.0 } else { 0.0 }],
            (ValueType::Enum, Some(Value::String(s))) => {
                let i = labels.iter().position(|l| l == s).unwrap_or_else(|| {
                    labels.push(s.clone());
                    labels.len() - 1
                });
                vec![i as f64]
            }
            (ValueType::Color | ValueType::Vec | ValueType::Quat, Some(Value::Array(parts)))
                if parts.len() == width =>
            {
                parts
                    .iter()
                    .enumerate()
                    .map(|(i, p)| number(Some(p), &format!("{kpath}/value/{i}")))
                    .collect::<Result<_, _>>()?
            }
            // #494: a path key's value is an SVG path string, or another item's path by `of`.
            (ValueType::Path, Some(v)) => {
                match v.get("of").and_then(Value::as_str) {
                    Some(of) if !in_clip => {
                        path_shapes.push((kid.clone(), None, Some(of.to_string())))
                    }
                    Some(_) => return refuse("out_of_range", format!("{kpath}/value")),
                    None => match crate::morph::of_value(v) {
                        Some(shape) => path_shapes.push((kid.clone(), Some(shape), None)),
                        None => return refuse("bad_path", format!("{kpath}/value")),
                    },
                }
                Vec::new()
            }
            _ => return refuse("out_of_range", format!("{kpath}/value")),
        };
        let mut interp = match (ty, key.get("interp")) {
            (ValueType::Bool | ValueType::Enum, None) => Interp::Hold,
            (_, None) if focus => Interp::Ease(ease::Entry::opened(
                ease::named("in_out_cubic", None).expect("a first-party ease"),
            )),
            (_, v) => interp_of(v, &format!("{kpath}/interp"))?,
        };
        if glides {
            if matches!(
                interp,
                Interp::Spring(_) | Interp::Auto { .. } | Interp::CatmullRom | Interp::Table
            ) {
                return refuse("bad_interp", format!("{kpath}/interp"));
            }
            glide.push(Key::new(kid, t, Vec::new(), interp));
            interp = Interp::Hold;
        }
        if matches!(ty, ValueType::Bool | ValueType::Enum) && interp != Interp::Hold {
            return refuse("bad_interp", format!("{kpath}/interp"));
        }
        if matches!(
            interp,
            Interp::Spring(_) | Interp::Auto { .. } | Interp::CatmullRom
        ) && ty != ValueType::F32
        {
            return refuse("bad_interp", format!("{kpath}/interp"));
        }
        let mut k = Key::new(kid, t, value, interp);
        k.turns = (ty == ValueType::Quat).then_some(ctx.arc);
        // #494: a vec key's travel; a path key's takes its sub-paths once they're matched.
        if let Some(v) = key.get("travel") {
            let travel = crate::travel::Travel::of(v).map_err(|f| Refused {
                code: "bad_doc",
                path: if f.is_empty() {
                    format!("{kpath}/travel")
                } else {
                    format!("{kpath}/travel/{f}")
                },
                detail: None,
            })?;
            match (ty, travel) {
                (_, None) => {}
                (ValueType::Vec | ValueType::Path, Some(travel)) => {
                    k.travel = Some(Arc::new(crate::curve::Travels {
                        travel,
                        dim: width,
                        subs: vec![1],
                    }));
                }
                _ => return refuse("bad_doc", format!("{kpath}/travel")),
            }
        }
        if interp == Interp::Table {
            let name = key
                .get("interp")
                .and_then(|i| i.pointer("/ease/table"))
                .and_then(Value::as_str);
            k.table = name.map(|n| (n.to_string(), None));
        }
        // A spring key's starting rate, per component, in value per second.
        k.velocity = match key.get("velocity") {
            None => Vec::new(),
            Some(Value::Array(list)) => list
                .iter()
                .enumerate()
                .map(|(i, v)| number(Some(v), &format!("{kpath}/velocity/{i}")))
                .collect::<Result<_, _>>()?,
            v => vec![number(v, &format!("{kpath}/velocity"))?],
        };
        keys.push(k);
    }
    let (before, after) = extrapolate_of(c.get("extrapolate"), &format!("{path}/extrapolate"))?;
    let modifiers = match c.get("modifiers") {
        None => Vec::new(),
        Some(Value::Array(list)) => list
            .iter()
            .enumerate()
            .map(|(i, m)| {
                let at = format!("{path}/modifiers/{i}");
                modifier_of(m, ctx, transport, &at, path, (!in_clip).then_some(id))
            })
            .collect::<Result<_, _>>()?,
        Some(_) => return refuse("bad_doc", format!("{path}/modifiers")),
    };
    let stepping = modifiers
        .iter()
        .all(|m| matches!(m.kind, ModKind::Quantize { .. }));
    if (!modifiers.is_empty() && !stepping) && ty != ValueType::F32 {
        return refuse("bad_doc", format!("{path}/modifiers"));
    }
    keys.sort_by(|a, b| a.t.cmp(&b.t).then_with(|| a.id.cmp(&b.id)));
    // #468: a focus pull's keys stand for their index; each one's distance is taken at t.
    let named = named
        .iter()
        .any(|(_, n)| matches!(n, FocusKey::Item(_)))
        .then(|| {
            keys.iter_mut()
                .enumerate()
                .map(|(i, k)| {
                    k.value = vec![i as f64];
                    named
                        .iter()
                        .find(|(kid, _)| *kid == k.id)
                        .map_or(FocusKey::At(0.0), |(_, n)| n.clone())
                })
                .collect::<Vec<_>>()
        });
    match ty {
        // q and −q are one rotation: each key takes the sign nearest the key before it.
        ValueType::Quat if ctx.arc == quat::Arc::Short => {
            for i in 1..keys.len() {
                let aligned = quat::aligned(quat::of(&keys[i].value), quat::of(&keys[i - 1].value));
                keys[i].value = aligned.to_vec();
            }
        }
        // Each key takes the turn nearest the key before it, so a segment goes the short way.
        ValueType::Angle if !absolute => {
            for i in 1..keys.len() {
                let (a, b) = (keys[i - 1].value[0], keys[i].value[0]);
                keys[i].value[0] = a + (b - a + 180.0).rem_euclid(360.0) - 180.0;
            }
        }
        _ => {}
    }
    let path_keys = if ty == ValueType::Path {
        let mut keyed = PathKeys {
            strict,
            structure: Vec::new(),
            shapes: Vec::new(),
            of: Vec::new(),
        };
        for (i, k) in keys.iter().enumerate() {
            let Some((_, shape, of)) = path_shapes.iter().find(|(kid, ..)| *kid == k.id) else {
                continue;
            };
            keyed.shapes.push(shape.clone());
            if let Some(of) = of {
                keyed.of.push((i, of.clone()));
            }
        }
        if keyed.of.is_empty() {
            match_path(id, &mut keyed, &mut keys, path)?;
        }
        Some(keyed)
    } else {
        None
    };
    Ok(Channel {
        id: id.to_string(),
        target,
        ty,
        path: path_keys,
        curve: Curve::extrapolated(keys, before, after),
        modifiers,
        follow: None,
        range,
        named,
        glide: glides.then(|| {
            glide.sort_by_key(|k| k.t);
            let keys = glide
                .into_iter()
                .enumerate()
                .map(|(i, k)| Key::new(&k.id, k.t, vec![i as f64], k.interp))
                .collect();
            Curve::extrapolated(keys, Extrapolate::Hold, Extrapolate::Hold)
        }),
    })
}

/// #494: a path channel's keys put on one structure once every key's shape is known: equal
/// structures as they are, others matched (Channel and key: path), or refused under
/// `morph: strict`, naming the channel. Each key's value becomes its flat points and its travel
/// learns the sub-paths.
pub fn match_path(
    id: &str,
    keyed: &mut PathKeys,
    keys: &mut [Key],
    path: &str,
) -> Result<(), Refused> {
    let shapes: Vec<crate::morph::Shape> = keyed
        .shapes
        .iter()
        .map(|s| s.clone().unwrap_or_default())
        .collect();
    let Some(first) = shapes.first() else {
        return Ok(());
    };
    let same = shapes
        .iter()
        .all(|s| crate::morph::structure(s) == crate::morph::structure(first));
    if !same && keyed.strict {
        return Err(Refused {
            code: "morph_strict",
            path: format!("{path}/keys"),
            detail: Some(Box::new(
                serde_json::json!({"channel": id, "why": "its path keys differ in point or sub-path counts, and morph is strict"}),
            )),
        });
    }
    let matched = if same {
        shapes
    } else {
        crate::morph::matched_all(&shapes)
    };
    keyed.structure = crate::morph::structure(&matched[0]);
    let subs: Vec<usize> = keyed.structure.iter().map(|(n, _)| *n).collect();
    for (k, shape) in keys.iter_mut().zip(&matched) {
        k.value = crate::morph::flat(shape);
        if let Some(t) = &mut k.travel {
            *t = Arc::new(crate::curve::Travels {
                travel: t.travel.clone(),
                dim: 2,
                subs: subs.clone(),
            });
        }
    }
    Ok(())
}

/// A channel's `extrapolate`: one mode for both sides, or `{before, after}`; hold when absent.
pub(super) fn extrapolate_of(
    value: Option<&Value>,
    path: &str,
) -> Result<(Extrapolate, Extrapolate), Refused> {
    let one = |v: Option<&Value>, path: &str| match v.and_then(Value::as_str) {
        None | Some("hold") => Ok(Extrapolate::Hold),
        Some("linear") => Ok(Extrapolate::Linear),
        Some("cycle") => Ok(Extrapolate::Cycle),
        Some("ping_pong") => Ok(Extrapolate::PingPong),
        Some("cycle_offset") => Ok(Extrapolate::CycleOffset),
        Some(_) => refuse("bad_doc", path),
    };
    match value {
        None => Ok((Extrapolate::Hold, Extrapolate::Hold)),
        Some(Value::Object(o)) => Ok((
            one(o.get("before"), &format!("{path}/before"))?,
            one(o.get("after"), &format!("{path}/after"))?,
        )),
        v => {
            let both = one(v, path)?;
            Ok((both, both))
        }
    }
}

pub(super) fn extend_of(value: Option<&Value>, path: &str) -> Result<Extend, Refused> {
    match value.and_then(Value::as_str) {
        None => Ok(Extend::None),
        Some("none") => Ok(Extend::None),
        Some("hold") => Ok(Extend::Hold),
        Some(_) => refuse("bad_doc", path),
    }
}

/// The frame rate the time literals resolve against: `transport.frame_rate` as `p/q` text or a
/// `[p, q]` pair, 60/1 when absent.
pub(crate) fn frame_rate_of(transport: Option<&Map<String, Value>>) -> Result<(u32, u32), Refused> {
    let Some(t) = transport.filter(|t| t.contains_key("frame_rate")) else {
        return Ok((60, 1));
    };
    // The core's reading of the field (`[p, q]` or `"p/q"`); the whole-flick rule is the
    // core's check, so here only a non-rate is refused.
    match deep_canvas::document::frame_rate_of(&Value::Object(t.clone())) {
        Some((p, q)) if p > 0 && q > 0 => Ok((p, q)),
        _ => refuse("bad_rate", "transport/frame_rate"),
    }
}

/// Reads a document's motion.
pub fn read(doc: &Map<String, Value>) -> Result<Motion, Refused> {
    read_with(doc, false, quat::Arc::Short)
}

/// Reads a document's motion, its constant tempo sections' beats in f32 seconds when
/// `f32_beats` (the planted twin of #491 AC1).
pub fn read_with(
    doc: &Map<String, Value>,
    f32_beats: bool,
    arc: quat::Arc,
) -> Result<Motion, Refused> {
    let transport_map = match doc.get("transport") {
        None | Some(Value::Null) => None,
        Some(Value::Object(t)) => Some(t),
        Some(_) => return refuse("bad_doc", "transport"),
    };
    let frame_rate = frame_rate_of(transport_map)?;
    let mut ctx = Ctx::of(frame_rate);
    ctx.arc = arc;
    ctx.tempo = Tempo::read(doc, &ctx.time, f32_beats)?;
    let (markers, firsts) = markers_of(doc, &mut ctx)?;
    let reduce_holds = transport_map
        .and_then(|t| t.get("reduced_motion"))
        .and_then(Value::as_str)
        != Some("slow");
    let holds = doc.get("profile").and_then(Value::as_str) != Some("film")
        && transport_map
            .and_then(|t| t.get("reduced_motion"))
            .and_then(Value::as_str)
            != Some("slow");
    let transport = match transport_map {
        None => Transport {
            start: 0,
            span: None,
            wrap: false,
            ping_pong: false,
            holds,
            reduce_holds,
        },
        Some(t) => {
            let start = match t.get("start") {
                None => 0,
                v => time_of(v, &ctx, "transport/start")?,
            };
            let span = match t.get("span") {
                None => None,
                Some(Value::String(s)) if s == "auto" || s == "open" => None,
                v => Some(time_of(v, &ctx, "transport/span")?),
            };
            let (wrap, ping_pong) = match t.get("loop").and_then(Value::as_str) {
                None | Some("none") => (false, false),
                Some("wrap") => (true, false),
                Some("ping_pong") => (false, true),
                Some(_) => return refuse("bad_doc", "transport/loop"),
            };
            // An open span has no end to wrap at: its loop must be none (Transport).
            if (wrap || ping_pong) && t.get("span").and_then(Value::as_str) == Some("open") {
                return refuse("bad_doc", "transport/loop");
            }
            if (wrap || ping_pong) && span.is_none_or(|s| s <= 0) {
                return refuse("bad_time", "transport/span");
            }
            Transport {
                start,
                span,
                wrap,
                ping_pong,
                holds,
                reduce_holds,
            }
        }
    };
    let cameras = cameras_of(doc)?;
    let (controls, shots, mut follows) = controls_of(doc, &cameras, &ctx)?;
    let seed = match doc.get("seed") {
        None => fnv1a(doc.get("id").and_then(Value::as_str).unwrap_or("")),
        Some(v) => match v.as_u64() {
            Some(seed) => seed,
            None => return refuse("out_of_range", "seed"),
        },
    };
    let mut labels = Vec::new();
    let mut channels = Vec::new();
    let mut staggers = Vec::new();
    for (id, c) in section(doc, "channels")? {
        // #417's follow names a toggle or stages control and its options' values; #489's
        // follows held keys or a control's value path.
        let names_control = c
            .get("follow")
            .and_then(|f| f.get("source"))
            .is_some_and(|s| s.get("control").is_some());
        let staggered = c.get("follow").and_then(|f| f.get("stagger")).is_some();
        if names_control && staggered {
            return refuse("bad_doc", format!("channels/{id}/follow/stagger"));
        }
        if names_control {
            follows.push(follow_of(id, c, doc, &controls, &ctx)?);
            continue;
        }
        // #504: a follow whose stagger's targets are assemblies is a take-apart, writing each
        // target's apart share; its target is `assemblies/apart`, those shares, or none. Any
        // other target of its own follows the source unstaggered, as any follow does. #508: a
        // follow on `assemblies/apart` with no stagger takes every assembly apart at once.
        let apart = c.get("target").and_then(Value::as_str) == Some("assemblies/apart");
        if let (true, Some(Value::Object(f))) = (staggered || apart, c.get("follow")) {
            staggers.push(take_apart_of(id, f, doc, &ctx, seed)?);
            if c.get("target")
                .is_none_or(|t| t.as_str() == Some("assemblies/apart"))
            {
                continue;
            }
        }
        let path = format!("channels/{id}");
        channels.push(channel_of(
            id,
            c,
            false,
            &ctx,
            &transport,
            &path,
            &mut labels,
        )?);
    }
    let mut clips = Vec::new();
    for (id, c) in section(doc, "clips")? {
        let path = format!("clips/{id}");
        let mut list = Vec::new();
        for (cid, ch) in section(c, "channels")? {
            list.push(channel_of(
                cid,
                ch,
                true,
                &ctx,
                &transport,
                &format!("{path}/channels/{cid}"),
                &mut labels,
            )?);
        }
        let last = list
            .iter()
            .filter_map(|c| c.curve.keys.last().map(|k| k.t))
            .max()
            .unwrap_or(0);
        let span = match c.get("span") {
            None => last,
            Some(Value::String(s)) if s == "auto" => last,
            v => time_of(v, &ctx, &format!("{path}/span"))?,
        };
        if span <= 0 {
            return refuse("bad_time", format!("{path}/span"));
        }
        clips.push(Clip {
            id: id.clone(),
            span,
            channels: list,
        });
    }
    let mut raw = Vec::new();
    for (id, p) in section(doc, "placements")? {
        raw.push(placement_of(
            id,
            p,
            &clips,
            &ctx,
            doc.get("layers").and_then(Value::as_object),
        )?);
    }
    let mut placements = resolve_series(raw, &clips, seed)?;
    let cuts = cuts_of(doc, &mut placements, &clips)?;
    let parents = parents_of(doc)?;
    let mut drivers = Vec::new();
    for (id, d) in section(doc, "drivers")? {
        drivers.push(driver_of(id, d)?);
    }
    let remaps = remaps_of(doc, &transport, &ctx, &mut placements, &clips)?;
    let mut control_defaults = Vec::new();
    for (id, c) in section(doc, "controls")? {
        let default = match c.get("default") {
            Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
            Some(Value::Bool(b)) => f64::from(u8::from(*b)),
            _ => 0.0,
        };
        control_defaults.push((id.clone(), default));
        control_defaults.extend(crate::hover::defaults(id, c));
    }
    let mut limits = Vec::new();
    let mut constraints = Vec::new();
    for (id, c) in section(doc, "constraints")? {
        // #225: a kind the core gives another module is that module's to solve.
        let other = c
            .get("kind")
            .and_then(Value::as_str)
            .and_then(deep_canvas::registry::core_lists::constraint_owner)
            .is_some();
        if let Some(limit) = limit_of(id, c)? {
            limits.push(limit);
        } else if !other {
            constraints.push(constraint_of(id, c)?);
        }
    }
    Ok(Motion {
        transport,
        channels,
        follows,
        staggers,
        controls,
        shots,
        cameras,
        drivers,
        limits,
        constraints,
        control_defaults,
        clips,
        placements,
        markers,
        firsts,
        parents,
        cuts,
        frame_rate,
        labels,
        remaps,
        worlds: section(doc, "worlds")?
            .into_iter()
            .map(|(id, w)| {
                (
                    id.clone(),
                    w.get("inputs")
                        .and_then(Value::as_object)
                        .is_some_and(|i| !i.is_empty()),
                )
            })
            .collect(),
        notices: ctx.notices.take(),
    })
}
