use super::*;

/// An operator with iterate steps (#483): each body checked as a pass of its own, which reads only
/// the operator's own inputs, `prev` and its index, then the operator with each iterate step in
/// its place as a texture input, costed as its count of passes over its body.
fn check_iterating(op: &Operator, options: CheckOptions) -> Result<Checked, Vec<Issue>> {
    let mut outer = op.clone();
    let mut iterates = Vec::new();
    let (mut extra, mut floor) = (0.0, Class::Exact);
    for (id, s) in &op.steps {
        let Some(it) = s.iterate.as_deref() else {
            continue;
        };
        let refuse = |code: &'static str, m: String| Err(vec![Issue::at_step(code, id, m)]);
        if op.kind != Kind::Pass {
            return refuse(
                "operator_kind_rule",
                format!("iterate is a pass step, not a {} one", op.kind.name()),
            );
        }
        if it.count == 0 || it.count > MAX_ITERATE {
            return refuse(
                "operator_limit",
                format!("iterate runs 1 to {MAX_ITERATE} times, not {}", it.count),
            );
        }
        if let Some((inner, _)) = first_iterate(&it.steps) {
            return Err(vec![Issue {
                path: Some(format!("steps/{id}/body/steps/{inner}")),
                ..Issue::at_step(
                    "operator_limit",
                    inner,
                    format!("iterate never nests: {inner} is an iterate inside the iterate {id}"),
                )
            }]);
        }
        if !PING_PONG.contains(&it.format.as_str()) {
            return refuse(
                "operator_type",
                format!(
                    "a ping-pong target is {}, not {}",
                    PING_PONG.join(" or "),
                    it.format
                ),
            );
        }
        let mut read = BTreeSet::new();
        reads_of(&it.steps, &it.outputs, &mut read);
        let mut inputs = BTreeMap::new();
        for name in &read {
            if let Some(input) = op.inputs.get(name) {
                if let From::Target { op: from, .. } = &input.from {
                    if from != "core" {
                        return Err(vec![Issue {
                            step: Some(id.clone()),
                            ..Issue::at_path(
                                "operator_kind_rule",
                                &format!("inputs/{name}"),
                                format!("the body of {id} reads {name}, {from}'s target: a body reads only its operator's own inputs and prev"),
                            )
                        }]);
                    }
                }
                inputs.insert(name.clone(), input.clone());
            } else if op.steps.contains_key(name) && !it.steps.contains_key(name) {
                return refuse("operator_kind_rule", format!("the body of {id} reads the step {name}, outside it: a body reads only its operator's own inputs and prev"));
            }
        }
        let key = format!("{}.{id}", op.id);
        let tex = |output: &str| graph::Input {
            ty: Ty::Tex(Tex::Float),
            from: From::Target {
                op: key.clone(),
                output: output.into(),
            },
            range: None,
            default: None,
        };
        inputs.insert("prev".into(), tex("prev"));
        inputs.insert(
            it.index.clone(),
            graph::Input {
                ty: Ty::U32,
                from: From::Param(it.index.clone()),
                range: None,
                default: None,
            },
        );
        let body = Operator {
            id: key.clone(),
            kind: Kind::Pass,
            about: op.about.clone(),
            inputs,
            steps: it.steps.clone(),
            outputs: it.outputs.clone(),
            storage: BTreeMap::new(),
            textures: BTreeMap::new(),
            instances: BTreeMap::new(),
            blend: graph::Blend::Replace,
            declared: None,
            fallback: op.fallback,
            cost: None,
            size: it.resolution.clone(),
            elements: 0,
            counted: false,
            stepped: None,
            workgroup: 64,
            source: None,
            uses: Vec::new(),
            origin: Origin::Shipped,
            chain: op.chain.clone(),
            order: op.order.clone(),
            responses: BTreeMap::new(),
        };
        let checked = check_with(&body, options)?;
        extra += it.count as f64 * checked.estimate;
        floor = floor.max(checked.class);
        outer.steps.remove(id);
        outer.inputs.insert(id.clone(), tex("color"));
        iterates.push(Iterated {
            step: id.clone(),
            count: it.count as u32,
            index: it.index.clone(),
            format: it.format.clone(),
            size: it.resolution.clone(),
            body: Box::new(checked),
        });
    }
    let mut c = check_inner(&outer, options, extra, floor)?;
    c.iterates = iterates;
    Ok(c)
}

/// [`check`], under the planted wrong programs `options` turns on.
pub fn check_with(op: &Operator, options: CheckOptions) -> Result<Checked, Vec<Issue>> {
    if !op.responses.is_empty() {
        return check_answering(op, options);
    }
    if op.steps.values().any(|s| s.iterate.is_some()) {
        return check_iterating(op, options);
    }
    check_inner(op, options, 0.0, Class::Exact)
}

/// The type of the light loop's response `name`, its radiance: scene3d's entry of `gpu.output@1`.
fn response_type(name: &str) -> Option<&'static str> {
    deep_canvas_scene3d::gpu::RESPONSES
        .iter()
        .any(|r| r.0 == name)
        .then_some("vec3<f32>")
}

/// A material with light responses (#485; Operator output: light response): each response runs
/// the whole check as a material operator of its own, a refusal named under its field; the
/// operator's estimate counts `light`'s once for each light a pixel's cluster may hold and
/// `ambient`'s once, and its class is at best theirs.
fn check_answering(op: &Operator, options: CheckOptions) -> Result<Checked, Vec<Issue>> {
    let mut extra = 0.0;
    let mut floor = Class::Exact;
    let mut responses = BTreeMap::new();
    let mut issues = Vec::new();
    for (name, r) in &op.responses {
        match check_with(r, options) {
            Ok(c) => {
                let calls = if name == "light" {
                    deep_canvas_scene3d::light::SHADED as f64
                } else {
                    1.0
                };
                extra += c.estimate * calls;
                floor = floor.max(c.class);
                responses.insert(name.clone(), c);
            }
            Err(e) => issues.extend(e.into_iter().map(|mut i| {
                i.path = Some(match i.path.take() {
                    Some(p) => format!("{name}/{p}"),
                    None => name.clone(),
                });
                i
            })),
        }
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    let mut outer = op.clone();
    outer.responses.clear();
    let mut c = if outer.steps.values().any(|s| s.iterate.is_some()) {
        let mut c = check_iterating(&outer, options)?;
        c.estimate += extra;
        c.class = c.class.max(floor);
        c
    } else {
        check_inner(&outer, options, extra, floor)?
    };
    c.op.responses = op.responses.clone();
    c.responses = responses;
    Ok(c)
}

/// The check over an operator with no iterate step left: `extra` ns its iterates' runs cost and
/// `floor` the least class their bodies allow.
fn check_inner(
    op: &Operator,
    options: CheckOptions,
    extra: f64,
    floor: Class,
) -> Result<Checked, Vec<Issue>> {
    if op.source.is_some() {
        return Err(vec![Issue::at_path(
            "operator_source",
            "source",
            "a WGSL-subset source reaches the check only once the front end has lowered it to steps",
        )]);
    }
    let mut ctx = Ctx {
        op,
        types: BTreeMap::new(),
        inexact: None,
        affine: BTreeMap::new(),
        uniform: BTreeSet::new(),
        options,
        weight: 0.0,
        fetches: 0,
        body_order: BTreeMap::new(),
        accs: Vec::new(),
    };
    let mut issues = Vec::new();
    stepped_rules(op, &mut issues);
    let mut textures = Vec::new();
    let mut storage_inputs = Vec::new();
    for (name, input) in &op.inputs {
        let path = format!("inputs/{name}");
        if op.steps.contains_key(name) {
            issues.push(Issue::at_path(
                "operator_type",
                &path,
                "an input and a step share a name",
            ));
        }
        if matches!(input.ty, Ty::Tex(_))
            != matches!(input.from, From::Target { .. } | From::Asset(_))
            || matches!(input.ty, Ty::Tex3(_)) != matches!(input.from, From::Texture3d { .. })
        {
            issues.push(Issue::at_path(
                "operator_type",
                &path,
                "a texture input reads a target, and a texture3d input a 3D texture, and only they do",
            ));
        }
        // A 3D texture is read only in the frame that wrote it (structural steps, #483).
        if let From::Texture3d {
            op: from,
            output,
            previous: true,
        } = &input.from
        {
            issues.push(Issue::at_path(
                "operator_kind_rule",
                &path,
                format!("{name} reads {from}.{output} from an earlier frame: a 3D texture is read only by later operators in the frame that wrote it, never kept to the next"),
            ));
        }
        match input.ty {
            Ty::Tex(_) | Ty::Tex3(_) => textures.push(name.clone()),
            Ty::Storage(..) => storage_inputs.push(name.clone()),
            _ => {}
        }
        let why = if input_class(&input.from) != Class::Exact {
            Some(match &input.from {
                From::Target { output, .. } => {
                    format!("it reads the {output} target, which the GPU rasterized")
                }
                From::Port => format!("it reads {name}, which the light loop computes"),
                _ => "it reads time".to_string(),
            })
        } else if matches!(input.ty, Ty::V(Sc::F32, _) | Ty::Mat(_)) {
            Some(format!("it is a {}", input.ty.wgsl()))
        } else {
            None
        };
        if let (Some(why), None) = (why, &ctx.inexact) {
            ctx.inexact = Some(Why::Input(path.clone(), why));
        }
        ctx.types.insert(name.clone(), input.ty.clone());
    }
    if textures.len() > MAX_TEXTURES {
        issues.push(Issue::at_path(
            "operator_limit",
            "inputs",
            format!("{} textures, past {MAX_TEXTURES}", textures.len()),
        ));
    }
    if op.kind == Kind::Compute {
        if op.elements == 0 || op.elements > MAX_ELEMENTS {
            issues.push(Issue::at_path(
                "operator_limit",
                "elements",
                format!("elements is 1 to {MAX_ELEMENTS}"),
            ));
        }
        if ![64, 128, 256].contains(&op.workgroup) {
            issues.push(Issue::at_path(
                "operator_type",
                "workgroup",
                "workgroup is 64, 128 or 256",
            ));
        }
        // An instances output draws what a compact step of this operator kept (#484): the step's
        // rows and its count are storage outputs, which the draw reads.
        for (name, i) in &op.instances {
            let path = format!("outputs/{name}");
            if !i.columns.is_empty() {
                issues.push(Issue::at_path(
                    "operator_type",
                    &path,
                    "an instances output draws the instancer's own columns; it writes none yet",
                ));
            }
            let held = |port: &str| {
                let want = Arg::Ref(i.count.clone().unwrap_or_default(), Some(port.to_string()));
                op.storage.values().any(|o| o.from.as_ref() == Some(&want))
            };
            let compact = i
                .count
                .as_ref()
                .and_then(|c| op.steps.get(c))
                .is_some_and(|s| s.op == "compact@1");
            if i.instancer.is_empty() || !compact || !held("out") || !held("count") {
                issues.push(Issue::at_path(
                    "operator_type",
                    &path,
                    "instances is {instancer, columns, count: a compact step whose out and count are storage outputs}",
                ));
            }
        }
        if op.storage.is_empty() && op.textures.is_empty() {
            issues.push(Issue::at_path(
                "operator_type",
                "outputs",
                "a compute operator writes storage or a texture",
            ));
        }
    }
    for (name, t) in &op.textures {
        let path = format!("outputs/{name}");
        if op.kind != Kind::Compute {
            issues.push(Issue::at_path(
                "operator_type",
                &path,
                "only a compute operator writes a texture output",
            ));
        }
        // Integers don't average, and r32float isn't filterable on every adapter.
        if t.mips && !matches!(t.format.as_str(), "rgba16float" | "rgba8unorm") {
            issues.push(Issue::at_path(
                "operator_type",
                &path,
                format!(
                    "mips: true takes rgba16float or rgba8unorm, not {}",
                    t.format
                ),
            ));
        }
        let cap = if t.dim3 { MAX_TEXTURE3D } else { MAX_TEXTURE2D };
        if t.size.iter().any(|&n| n == 0 || n > cap) {
            issues.push(Issue::at_path(
                "operator_limit",
                &path,
                format!(
                    "a {} output is 1 to {cap} texels a side",
                    if t.dim3 { "texture3d" } else { "texture" }
                ),
            ));
        }
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    let mut scope = BTreeSet::new();
    // A light response runs inside the light loop, where pixels diverge (#485).
    let answers = op.inputs.values().any(|i| i.from == From::Port);
    let order = ctx
        .graph(&op.steps, &mut scope, 0, 1, answers)
        .map_err(|e| vec![e])?;
    let total: usize = order.len() + ctx.body_order.values().map(Vec::len).sum::<usize>();
    if total > 2048 {
        return Err(vec![Issue::at_path(
            "operator_limit",
            "steps",
            format!("{total} steps inlined, past 2,048"),
        )]);
    }
    let cap = match (op.kind, options.wide_fetches) {
        (Kind::Material, true) => max_fetches(Kind::Pass),
        (kind, _) => max_fetches(kind),
    };
    if ctx.fetches > cap {
        return Err(vec![Issue::at_path(
            "operator_limit",
            "steps",
            format!(
                "{} fetches per invocation, past {cap} in a {} operator{}",
                ctx.fetches,
                op.kind.name(),
                if op.kind == Kind::Material && !options.wide_fetches {
                    " outside the showpiece and export classes"
                } else {
                    ""
                }
            ),
        )]);
    }
    // #483: a multi-dispatch step runs over whole buffers, so it runs alone: its operator holds
    // only such steps, reading storage, and each storage output takes one's result.
    let multi = op.steps.values().any(|s| table::multi_dispatch(&s.op));
    if multi {
        if let Some((id, s)) = op.steps.iter().find(|(_, s)| !table::multi_dispatch(&s.op)) {
            return Err(vec![Issue::at_step(
                "operator_kind_rule",
                id,
                format!("{} can't share an operator with a sort, a scan or a compaction, which run over whole buffers: write it in an operator before or after", s.op),
            )]);
        }
    }
    for (name, so) in &op.storage {
        let path = format!("outputs/{name}");
        match &so.from {
            Some(a) => match ctx.ty_of(&scope, a, name) {
                Ok(Ty::Storage(sc, n)) if sc == so.sc && n >= so.count => {}
                Ok(t) => issues.push(Issue::at_path(
                    "operator_type",
                    &path,
                    format!(
                        "{name} is storage of {} {}, so it takes such storage, not {}",
                        so.count,
                        so.sc.wgsl(),
                        t.wgsl()
                    ),
                )),
                Err(mut e) => {
                    e.step = None;
                    e.path = Some(path);
                    issues.push(e);
                }
            },
            None if multi => issues.push(Issue::at_path(
                "operator_type",
                &path,
                format!("{name} takes from: a sort's, a scan's or a compaction's result"),
            )),
            None => {}
        }
    }
    for (name, a) in &op.outputs {
        let path = format!("outputs/{name}");
        // Today's outputs are the core's entries of gpu.output@1 (#200); a material's lobes,
        // occlusion and normal are scene3d's (#486).
        let scene3d = (op.kind == Kind::Material)
            .then(|| deep_canvas_scene3d::gpu::output_type(name))
            .flatten();
        // A light response's one output, its radiance, takes the response's name (#485).
        let scene3d = scene3d.or_else(|| answers.then(|| response_type(name)).flatten());
        let want = match deep_canvas::registry::core_lists::output_type(op.kind.name(), name)
            .or(scene3d)
        {
            Some("vec4<f32>") => Ty::V(Sc::F32, 4),
            Some("vec3<f32>") => Ty::V(Sc::F32, 3),
            Some("vec2<f32>") => Ty::V(Sc::F32, 2),
            Some("f32") => Ty::F32,
            _ => {
                issues.push(Issue::at_path(
                    "operator_type",
                    &path,
                    format!("a {} operator has no output {name}", op.kind.name()),
                ));
                continue;
            }
        };
        match ctx.ty_of(&scope, a, name) {
            Ok(t) if unify(&want, &t).map(concrete).as_ref() == Ok(&want) => {}
            Ok(t) => issues.push(Issue::at_path(
                "operator_type",
                &path,
                format!("{name} is {}, not {}", t.wgsl(), want.wgsl()),
            )),
            Err(mut e) => {
                e.step = None;
                e.path = Some(path);
                issues.push(e);
            }
        }
    }
    if op.kind == Kind::Pass && !op.outputs.contains_key("color") {
        issues.push(Issue::at_path(
            "operator_type",
            "outputs/color",
            "a pass writes color",
        ));
    }
    if !issues.is_empty() {
        return Err(issues);
    }
    let class = if ctx.inexact.is_none() {
        Class::Exact
    } else {
        Class::SameMachine
    }
    .max(floor);
    // State a stepped operator carries between frames repeats only on the machine that stepped
    // it, whatever its steps are (#252).
    let class = match op.stepped {
        Some(_) if options.carried_exact => Class::Exact,
        Some(_) => class.max(Class::SameMachine),
        None => class,
    };
    if let Some(d) = op.declared {
        if d < class && !options.declared_class {
            let (step, path, why) = match ctx.inexact.clone() {
                Some(Why::Step(s, w)) => (Some(s), None, w),
                Some(Why::Input(p, w)) => (None, Some(p), w),
                None => (None, Some("determinism".to_string()), String::new()),
            };
            return Err(vec![Issue {
                step,
                path,
                ..Issue::new(
                    "not_exact",
                    format!(
                        "{} is declared {}, but its steps and inputs make it {}: {why}",
                        op.id,
                        d.name(),
                        class.name()
                    ),
                )
            }]);
        }
    }
    // A live-only operator draws its fallback in every canonical render; a material with no
    // fallback would leave its parts undrawn there.
    if op.declared == Some(Class::LiveOnly)
        && op.kind == Kind::Material
        && op.fallback == Fallback::None
    {
        return Err(vec![Issue {
            item: Some(op.id.clone()),
            ..Issue::at_path(
                "live_only_canonical",
                "fallback",
                format!(
                    "{} is declared live_only with fallback none: canonical renders, render-back, exports and goldens would draw nothing for it",
                    op.id
                ),
            )
        }]);
    }
    let estimate = ctx.weight * NS_PER_UNIT + f64::from(ctx.fetches) * NS_PER_FETCH + extra;
    match op.cost {
        None if op.origin != Origin::Shipped => {
            return Err(vec![Issue::at_path(
                "operator_type",
                "cost",
                "a composed operator declares its cost",
            )]);
        }
        Some(c) if !(c.is_finite() && c >= 0.0) => {
            return Err(vec![Issue::at_path(
                "operator_type",
                "cost",
                "cost is a finite number ≥ 0",
            )]);
        }
        Some(c) if estimate > c * 1.25 => {
            return Err(vec![Issue::at_path(
                "cost_understated",
                "cost",
                format!("estimated {estimate:.4} ns, more than 25% over the declared {c}"),
            )]);
        }
        _ => {}
    }
    Ok(Checked {
        op: op.clone(),
        order,
        body_order: ctx.body_order,
        types: ctx.types,
        class: if options.declared_class {
            op.declared.unwrap_or(class)
        } else {
            op.declared.map_or(class, |d| d.max(class))
        },
        estimate,
        fetches: ctx.fetches,
        textures,
        storage_inputs,
        iterates: Vec::new(),
        responses: BTreeMap::new(),
    })
}
