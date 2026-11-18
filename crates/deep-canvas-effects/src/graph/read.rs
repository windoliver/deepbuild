use super::*;

/// Reads an operator. Refuses shader text in a field of its own (`operator_source`), unknown
/// fields and malformed parts (`operator_type`) before any later check runs.
pub fn read(v: &Value) -> Result<Operator, Vec<Issue>> {
    // A call to a step function scene3d ships, such as core.bump@1, is inlined first (#486), on
    // every path that reads an operator.
    if calls_shipped(&v["steps"]) {
        return read(&inline_functions(v, &Functions::new(), true)?);
    }
    let mut issues = Vec::new();
    let Some(o) = v.as_object() else {
        return Err(vec![Issue::new(
            "operator_type",
            "an operator is an object",
        )]);
    };
    for k in o.keys() {
        if CODE_FIELDS.contains(&k.as_str()) {
            issues.push(Issue::at_path(
                "operator_source",
                k,
                "an operator carries no shader text: write it as steps, or as a WGSL-subset source asset the core lowers to steps",
            ));
        } else if !FIELDS.contains(&k.as_str()) {
            issues.push(Issue::at_path(
                "operator_type",
                k,
                "not a field of an operator",
            ));
        }
    }
    let source = match o.get("source") {
        None => None,
        // A source names an asset; its text is never in the operator.
        Some(s) => match s.get("wgsl").and_then(Value::as_str) {
            Some(asset) if !asset.contains('\n') && !asset.contains(';') && asset.len() <= 128 => {
                Some(asset.to_string())
            }
            _ => {
                issues.push(Issue::at_path(
                    "operator_source",
                    "source/wgsl",
                    "source names a WGSL-subset asset by its ID, never inline text",
                ));
                None
            }
        },
    };
    let id = o
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let kind = match o.get("kind").and_then(Value::as_str) {
        Some("material") => Kind::Material,
        Some("pass") => Kind::Pass,
        Some("compute") => Kind::Compute,
        _ => {
            issues.push(Issue::at_path(
                "operator_type",
                "kind",
                "kind is material, pass or compute",
            ));
            Kind::Pass
        }
    };
    let about = o
        .get("about")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if about.is_empty() || about.chars().count() > 400 {
        issues.push(Issue::at_path(
            "operator_type",
            "about",
            "about is required, at most 400 chars",
        ));
    }
    let mut inputs = BTreeMap::new();
    if let Some(i) = o.get("inputs").and_then(Value::as_object) {
        for (name, v) in i {
            if !ident(name) {
                issues.push(Issue::at_path(
                    "operator_type",
                    &format!("inputs/{name}"),
                    "an input's name is an identifier",
                ));
            } else if let Some(input) = input(name, v, &mut issues) {
                inputs.insert(name.clone(), input);
            }
        }
    }
    let steps = match (o.get("steps"), &source) {
        (Some(s), _) => steps(s, &mut issues),
        (None, Some(_)) => BTreeMap::new(),
        (None, None) => {
            issues.push(Issue::at_path(
                "operator_type",
                "steps",
                "an operator has steps or a source",
            ));
            BTreeMap::new()
        }
    };
    // Each role a `role@1` step names is an input of the operator, theme-resolved like `from:
    // {role}`; a status role is refused by the check, naming the step.
    let mut roles = Vec::new();
    let mut splines = Vec::new();
    let mut backdrop = false;
    let mut stack: Vec<&BTreeMap<String, Step>> = vec![&steps];
    while let Some(st) = stack.pop() {
        for s in st.values() {
            if s.op == "role@1" {
                if let Some(n) = s.fields.get("name").and_then(Value::as_str) {
                    roles.push(n.to_string());
                }
            }
            if s.op == "backdrop@1" {
                backdrop = true;
            }
            if s.op == "spline@1" {
                let points = s.fields.get("points").cloned().unwrap_or(Value::Null);
                if let Some(slots) = spline_slots(&points) {
                    splines.push((spline_input(&points), slots));
                }
            }
            if let Some(b) = &s.body {
                stack.push(&b.steps);
            }
            if let Some(it) = &s.iterate {
                stack.push(&it.steps);
            }
        }
    }
    if backdrop {
        inputs.entry(BACKDROP_INPUT.into()).or_insert(Input {
            ty: Ty::Tex(Tex::Float),
            from: From::Target {
                op: "core".into(),
                output: "backdrop".into(),
            },
            range: None,
            default: None,
        });
    }
    for (name, slots) in splines {
        inputs.entry(name).or_insert(Input {
            ty: Ty::Arr(Sc::F32, 4, SPLINE_SLOTS),
            from: From::Spline(slots),
            range: None,
            default: None,
        });
    }
    for name in roles {
        inputs.entry(role_input(&name)).or_insert(Input {
            ty: Ty::V(Sc::F32, 3),
            from: From::Role(name),
            range: None,
            default: None,
        });
    }
    let mut outputs = BTreeMap::new();
    let mut storage = BTreeMap::new();
    let mut instances = BTreeMap::new();
    let mut textures = BTreeMap::new();
    let mut blend = Blend::Replace;
    if let Some(out) = o.get("outputs").and_then(Value::as_object) {
        for (name, v) in out {
            if name == "blend" {
                blend = match v.as_str() {
                    Some("replace") => Blend::Replace,
                    Some("over") => Blend::Over,
                    Some("add") => Blend::Add,
                    Some("multiply") => Blend::Multiply,
                    Some("screen") => Blend::Screen,
                    _ => {
                        issues.push(Issue::at_path(
                            "operator_type",
                            "outputs/blend",
                            "blend is replace, over, add, multiply or screen",
                        ));
                        Blend::Replace
                    }
                };
                continue;
            }
            if let Some((t, dim3)) = v
                .get("texture")
                .map(|t| (t, false))
                .or_else(|| v.get("texture3d").map(|t| (t, true)))
            {
                let path = format!("outputs/{name}");
                let format = t.get("format").and_then(Value::as_str).unwrap_or("");
                let size: Vec<u32> = t
                    .get("size")
                    .and_then(Value::as_array)
                    .map(|a| {
                        a.iter()
                            .filter_map(Value::as_u64)
                            .map(|n| n as u32)
                            .collect()
                    })
                    .unwrap_or_default();
                let mips = t.get("mips").and_then(Value::as_bool).unwrap_or(false);
                let dims = if dim3 { 3 } else { 2 };
                if !TEXTURE_FORMATS.contains(&format) || size.len() != dims {
                    issues.push(Issue::at_path(
                        "operator_type",
                        &path,
                        format!(
                            "a texture output is {{format: {}, size: [{dims} sizes]}}",
                            TEXTURE_FORMATS.join(" | ")
                        ),
                    ));
                    continue;
                }
                textures.insert(
                    name.clone(),
                    TexOut {
                        format: format.into(),
                        size: [size[0], size[1], if dim3 { size[2] } else { 1 }],
                        dim3,
                        mips,
                    },
                );
                continue;
            }
            if let Some(i) = v.get("instances") {
                instances.insert(
                    name.clone(),
                    InstancesOut {
                        instancer: i
                            .get("instancer")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .into(),
                        columns: i
                            .get("columns")
                            .and_then(Value::as_array)
                            .map(|a| {
                                a.iter()
                                    .filter_map(Value::as_str)
                                    .map(String::from)
                                    .collect()
                            })
                            .unwrap_or_default(),
                        count: i.get("count").and_then(Value::as_str).map(String::from),
                    },
                );
                continue;
            }
            // A readback (exact only, ≤ 64 KiB) is storage the CPU reads back a frame late.
            if let Some(s) = v.get("storage").or_else(|| v.get("readback")) {
                if v.get("readback").is_some()
                    && s.get("bytes").and_then(Value::as_u64).unwrap_or(0) > 65_536
                {
                    issues.push(Issue::at_path(
                        "operator_limit",
                        &format!("outputs/{name}"),
                        "a readback holds at most 64 KiB",
                    ));
                }
                let sc = s.get("type").and_then(Value::as_str).and_then(Ty::parse);
                // Carried state (#252): `carry: {every: steps ≥ 1, budget: bytes}`.
                let carry = v.get("carry").map(|c| {
                    let every = c
                        .get("every")
                        .and_then(Value::as_u64)
                        .and_then(|e| u32::try_from(e).ok());
                    match (every, c.get("budget").and_then(Value::as_u64)) {
                        (Some(every @ 1..), Some(budget)) => Some(Carry { every, budget }),
                        _ => {
                            issues.push(Issue::at_path(
                                "operator_type",
                                &format!("outputs/{name}/carry"),
                                "carry is {every: steps, at least 1, budget: bytes}",
                            ));
                            None
                        }
                    }
                });
                let carry = carry.flatten();
                match (sc, s.get("count").and_then(Value::as_u64)) {
                    (Some(Ty::V(sc, 1)), Some(count)) => {
                        storage.insert(
                            name.clone(),
                            StorageOut {
                                sc,
                                count: count as u32,
                                from: v.get("from").map(arg),
                                clear: s.get("clear").and_then(Value::as_u64).unwrap_or(0) as u32,
                                carry,
                            },
                        );
                    }
                    _ => issues.push(Issue::at_path(
                        "operator_type",
                        &format!("outputs/{name}"),
                        "storage is {type: a scalar, count}",
                    )),
                }
                continue;
            }
            match v.get("from").unwrap_or(v) {
                // A source's output names only its type; the source gives its value.
                Value::Object(_) if source.is_some() => {}
                from => {
                    outputs.insert(name.clone(), arg(from));
                }
            }
        }
    }
    let declared = match o.get("determinism").and_then(Value::as_str) {
        None => None,
        Some("exact") => Some(Class::Exact),
        Some("same_machine") => Some(Class::SameMachine),
        Some("live_only") => Some(Class::LiveOnly),
        Some(other) => {
            issues.push(Issue::at_path(
                "operator_type",
                "determinism",
                format!("{other} is not a class"),
            ));
            None
        }
    };
    match o.get("fuse") {
        None | Some(Value::Null) => {}
        Some(Value::String(f)) if f == "pixel_wise" || f == "none" => {}
        Some(other) => issues.push(Issue::at_path(
            "operator_type",
            "fuse",
            format!("fuse is pixel_wise or none, not {other}"),
        )),
    }
    let fallback = match o.get("fallback").and_then(Value::as_str) {
        None | Some("look") => Fallback::Look,
        Some("none") => Fallback::None,
        Some(other) => {
            issues.push(Issue::at_path(
                "operator_type",
                "fallback",
                format!("fallback is none or look, not {other}"),
            ));
            Fallback::Look
        }
    };
    let cost = o
        .get("cost")
        .and_then(|c| c.get("ns_per_px").or_else(|| c.get("ns_per_element")))
        .and_then(Value::as_f64);
    let size = match o.get("resolution") {
        None => Size::Half,
        Some(Value::String(s)) => match s.as_str() {
            "full" => Size::Full,
            "half" => Size::Half,
            "quarter" => Size::Quarter,
            _ => {
                issues.push(Issue::at_path(
                    "operator_type",
                    "resolution",
                    "resolution is full, half or quarter",
                ));
                Size::Half
            }
        },
        Some(Value::Object(r)) => Size::Of {
            input: r.get("of").and_then(Value::as_str).unwrap_or("").into(),
            scale: r.get("scale").and_then(Value::as_f64).unwrap_or(1.0),
        },
        Some(_) => {
            issues.push(Issue::at_path(
                "operator_type",
                "resolution",
                "resolution is full, half or quarter",
            ));
            Size::Half
        }
    };
    // An indirect dispatch (#484): `elements: {from: <op>.<output>, max}`, its count an input.
    let counted_by = o.get("elements").filter(|e| e.is_object());
    let elements = counted_by.map_or(o.get("elements"), |e| e.get("max"));
    let counted = counted_by.is_some();
    if let Some(e) = counted_by {
        match e
            .get("from")
            .and_then(Value::as_str)
            .and_then(|f| f.split_once('.'))
        {
            Some((op, output)) => {
                inputs.insert(
                    DISPATCH_COUNT.to_string(),
                    Input {
                        ty: Ty::Storage(Sc::U32, 1),
                        from: From::Storage {
                            op: op.into(),
                            output: output.into(),
                            previous: false,
                        },
                        range: None,
                        default: None,
                    },
                );
            }
            None => issues.push(Issue::at_path(
                "operator_type",
                "elements",
                "an indirect dispatch's from is <op>.<output>",
            )),
        }
    }
    // A stepped operator (#252): `stepped: {rate}`, steps a second of document time.
    let stepped = match o.get("stepped") {
        None => None,
        Some(st) => match st
            .get("rate")
            .and_then(Value::as_u64)
            .and_then(|r| u32::try_from(r).ok())
        {
            Some(r @ 1..=1000) => Some(r),
            _ => {
                issues.push(Issue::at_path(
                    "operator_type",
                    "stepped",
                    "stepped is {rate: steps a second, 1 to 1,000}",
                ));
                None
            }
        },
    };
    let origin = match o.get("origin").and_then(Value::as_str) {
        Some("shipped") => Origin::Shipped,
        Some("pack") => Origin::Pack,
        _ => Origin::Composed,
    };
    let uses = o
        .get("uses")
        .and_then(Value::as_array)
        .map(|u| {
            u.iter()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    let responses = read_responses(o, kind, &inputs, &id, &mut issues);
    if !issues.is_empty() {
        return Err(issues);
    }
    Ok(Operator {
        responses,
        id,
        kind,
        about,
        inputs,
        steps,
        outputs,
        storage,
        textures,
        instances,
        blend,
        declared,
        fallback,
        cost,
        size,
        elements: elements.and_then(Value::as_u64).unwrap_or(0) as u32,
        counted,
        stepped,
        workgroup: o.get("workgroup").and_then(Value::as_u64).unwrap_or(64) as u32,
        source,
        uses,
        origin,
        chain: o
            .get("chain")
            .and_then(Value::as_str)
            .unwrap_or("effects")
            .into(),
        order: o
            .get("order")
            .and_then(Value::as_str)
            .unwrap_or("a0")
            .into(),
    })
}
