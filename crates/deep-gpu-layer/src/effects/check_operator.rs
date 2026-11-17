use super::*;

/// The planted core that skips the check: an operator that carries shader text in a field runs
/// it as written, as a full-screen pass, on naga, a pipeline and the GPU.
pub(super) fn unchecked(device: &Device, op: &Value, reached: &mut Reached) -> Option<String> {
    let text = op
        .as_object()?
        .iter()
        .find_map(|(k, v)| (k == "wgsl").then(|| v.as_str()).flatten())?;
    let vs = "@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> { let p = vec2<f32>(f32((vi << 1u) & 2u), f32(vi & 2u)); return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0); }\n";
    let source = format!("{vs}{text}");
    if validate(&source).is_err() {
        return None;
    }
    reached.naga = true;
    let d = &device.device;
    let module = d.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some("unchecked"),
        source: wgpu::ShaderSource::Wgsl(source.into()),
    });
    let pipeline = d.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some("unchecked"),
        layout: None,
        vertex: wgpu::VertexState {
            module: &module,
            entry_point: Some("vs"),
            compilation_options: Default::default(),
            buffers: &[],
        },
        fragment: Some(wgpu::FragmentState {
            module: &module,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            targets: &[Some(wgpu::ColorTargetState {
                format: LINEAR,
                blend: None,
                write_mask: wgpu::ColorWrites::ALL,
            })],
        }),
        primitive: Default::default(),
        depth_stencil: None,
        multisample: Default::default(),
        multiview_mask: None,
        cache: None,
    });
    reached.pipeline = true;
    let out = output(d, "unchecked output", [64, 64]);
    let mut enc = d.create_command_encoder(&Default::default());
    {
        let view = out.create_view(&Default::default());
        let mut pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("unchecked"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: &view,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            ..Default::default()
        });
        pass.set_pipeline(&pipeline);
        pass.draw(0..3, 0..1);
    }
    device.queue.submit([enc.finish()]);
    reached.gpu = true;
    Some("ran as written".into())
}

/// `check_operator`: the core's check, and only if it passes, the core's WGSL through naga, a
/// pipeline and one run on the GPU.
pub fn check_operator(app: &mut App, out: &str, call: &Value) -> Value {
    let out = out.to_string();
    let assets: BTreeMap<String, PathBuf> = call["assets"]
        .as_object()
        .map(|a| {
            a.iter()
                .filter_map(|(k, v)| Some((k.clone(), PathBuf::from(v.as_str()?))))
                .collect()
        })
        .unwrap_or_default();
    let skips = app.planted == Some(Planted::SkipsOperatorCheck);
    let (emit_options, mut check_options) = operator_plants(app.planted);
    // The class the check's limits apply under, as a document's budget class (#431).
    check_options.wide_fetches = matches!(call["class"].as_str(), Some("showpiece" | "export"));
    // A composed pass that calls the shipped blur compiles into its parts (#432).
    if let Some(parts) = deep_canvas_effects::fusion::split_blur(&call["operator"]) {
        return check_parts(app, parts, assets, emit_options, check_options);
    }
    // The packs' step functions `use@1` calls, inlined before the check (#431).
    let functions = match pack_functions(&call["packs"]) {
        Ok(f) => f,
        Err(e) => return e,
    };
    // #466: a pack's operator as its pack.json holds it carries `grow`, which the pack check
    // takes off before the operator check reads the graph.
    let mut operator = call["operator"].clone();
    if operator["origin"] == "pack" {
        if let Some(o) = operator.as_object_mut() {
            o.remove("grow");
        }
    }
    let op = match graph::inline_functions(&operator, &functions, !check_options.no_divergence_rule)
    {
        Ok(op) => op,
        Err(issues) => {
            return json!({"outcome": "refused", "issues": issues.iter().map(graph::Issue::to_json).collect::<Vec<_>>(), "reached": {"naga": false, "pipeline": false, "gpu": false}})
        }
    };
    let reference_size = call["reference"]["size"]
        .as_array()
        .filter(|s| s.len() == 2)
        .and_then(|s| Some([s[0].as_u64()? as u32, s[1].as_u64()? as u32]));
    let ui_thread = std::thread::current().name().unwrap_or("main").to_string();
    app.worker.call(move |state| {
        let device = state.gpu.device();
        let mut reached = Reached::default();
        if skips && unchecked(&device, &op, &mut reached).is_some() {
            return json!({"outcome": "accepted", "issues": [], "reached": {"naga": reached.naga, "pipeline": reached.pipeline, "gpu": reached.gpu}});
        }
        // The check alone, timed, for the computed class and the estimate.
        let started = std::time::Instant::now();
        let alone = graph::read(&op).and_then(|o| check::check_with(&o, check_options));
        let check_ms = started.elapsed().as_secs_f64() * 1e3;
        let started = std::time::Instant::now();
        let result = compile_planted(&op, &assets, emit_options, check_options);
        let compile_ms = (started.elapsed().as_secs_f64() * 1e3 - check_ms).max(0.0);
        let thread = std::thread::current()
            .name()
            .unwrap_or("render")
            .to_string();
        let mut extra = serde_json::Map::new();
        if let Ok(c) = &alone {
            extra.insert("class".into(), json!(c.class.name()));
            extra.insert("estimate_ns".into(), json!(c.estimate));
        }
        extra.insert(
            "timing".into(),
            json!({"check_ms": check_ms, "compile_ms": compile_ms, "thread": thread, "ui_thread": ui_thread}),
        );
        let (outcome, issues) = match result {
            Err(issues) => {
                // A refusal from naga's validation means the module reached naga.
                reached.naga = issues.iter().any(|i| i.code == "operator_compile");
                ("refused", issues.iter().map(graph::Issue::to_json).collect::<Vec<_>>())
            }
            Ok(c) => {
                reached.naga = true;
                match run_once(&device, &c, &mut reached) {
                    Ok(()) => {
                        // Drawn once by the step harness at `size`, on this GPU and through the
                        // f64 interpreter (#431).
                        if let Some(size) = reference_size {
                            match reference_of(&device, &c, &assets, size, &out) {
                                Ok(r) => {
                                    extra.insert("reference".into(), r);
                                }
                                Err(e) => return e,
                            }
                        }
                        ("accepted", Vec::new())
                    }
                    Err(e) => ("refused", vec![graph::Issue::at_path("operator_compile", "", e).to_json()]),
                }
            }
        };
        let mut reply = json!({"outcome": outcome, "issues": issues, "reached": {"naga": reached.naga, "pipeline": reached.pipeline, "gpu": reached.gpu}});
        if let Value::Object(o) = &mut reply {
            o.extend(extra);
        }
        reply
    })
}

/// A composed pass split around the shipped blur (#432), each part checked, written, validated
/// and run once as a pass of its own: its steps' parts costed by their estimate, the blur's at
/// what the calibration run measured; the operator's estimate is the parts' sum.
pub(super) fn check_parts(
    app: &mut App,
    parts: Vec<deep_canvas_effects::fusion::Part>,
    assets: BTreeMap<String, PathBuf>,
    emit_options: deep_canvas_effects::emit::Options,
    check_options: check::CheckOptions,
) -> Value {
    app.worker.call(move |state| {
        let device = state.gpu.device();
        let mut reached = Reached::default();
        let mut rows = Vec::new();
        let mut total = 0.0;
        for p in &parts {
            let c = match compile_planted(&p.graph, &assets, emit_options, check_options) {
                Ok(c) => c,
                Err(issues) => {
                    let issues: Vec<Value> = issues
                        .iter()
                        .map(|i| {
                            let mut j = i.to_json();
                            j["part"] = json!(p.of);
                            j
                        })
                        .collect();
                    return json!({"outcome": "refused", "issues": issues, "reached": {"naga": reached.naga, "pipeline": reached.pipeline, "gpu": reached.gpu}});
                }
            };
            reached.naga = true;
            if let Err(e) = run_once(&device, &c, &mut reached) {
                let issue = graph::Issue::at_path("operator_compile", "", e).to_json();
                return json!({"outcome": "refused", "issues": [issue], "reached": {"naga": reached.naga, "pipeline": reached.pipeline, "gpu": reached.gpu}});
            }
            let measured = deep_canvas_effects::shipped::BLUR_MEASURED_NS_PER_PX
                .iter()
                .find(|(name, _)| *name == p.of)
                .map(|(_, ns)| *ns);
            let estimate = measured.unwrap_or(c.checked.estimate);
            total += estimate;
            rows.push(json!({
                "of": p.of, "steps": p.steps, "fetches": c.checked.fetches, "estimate_ns": estimate,
                "cost": if measured.is_some() { "measured" } else { "estimated" },
            }));
        }
        json!({
            "outcome": "accepted", "issues": [], "parts": rows, "estimate_ns": total,
            "reached": {"naga": reached.naga, "pipeline": reached.pipeline, "gpu": reached.gpu},
        })
    })
}
