use super::*;

impl DocOps {
    pub fn empty() -> DocOps {
        DocOps {
            ops: Vec::new(),
            storage: BTreeMap::new(),
            textures: BTreeMap::new(),
            collections: BTreeMap::new(),
            targets: BTreeMap::new(),
            drawn: BTreeMap::new(),
            plans: BTreeMap::new(),
            early: BTreeSet::new(),
            counted: BTreeMap::new(),
            clears: BTreeMap::new(),
            blit: None,
            kernels: None,
            doc_seed: 0,
            program: None,
            hooks: Hooks::default(),
            params: BTreeMap::new(),
            within: BTreeMap::new(),
            core: BTreeMap::new(),
            stepping: None,
            clock: None,
        }
    }

    /// The document's pass and compute operators, checked, written and built on `device`. Items
    /// the check refuses are left out (the document's check refuses the document first); one in
    /// `fail` builds from a module the device rejects, the test hook of `operator_compile`.
    pub fn new(
        device: &Device,
        doc: &Value,
        options: Options,
        planted: CheckOptions,
        fail: &[String],
    ) -> DocOps {
        Self::with(
            device,
            doc,
            options,
            planted,
            fail,
            Hooks::default(),
            BTreeMap::new(),
        )
    }

    /// [`DocOps::new`] under `hooks`, with `core` the core's storage inputs by name (#483:
    /// check_operator's `data`).
    pub fn with(
        device: &Device,
        doc: &Value,
        options: Options,
        planted: CheckOptions,
        fail: &[String],
        hooks: Hooks,
        core: BTreeMap<String, wgpu::Buffer>,
    ) -> DocOps {
        let mut pool = Pool::default();
        Self::pooled(
            device,
            doc,
            options,
            planted,
            fail,
            hooks,
            core,
            &mut pool,
            &Fusing::default(),
        )
    }

    /// [`DocOps::with`], its pipelines from the session's `pool` and its chain fused as
    /// `fusing` says (#432).
    #[allow(clippy::too_many_arguments)]
    pub fn pooled(
        device: &Device,
        doc: &Value,
        options: Options,
        planted: CheckOptions,
        fail: &[String],
        hooks: Hooks,
        core: BTreeMap<String, wgpu::Buffer>,
        pool: &mut Pool,
        fusing: &Fusing,
    ) -> DocOps {
        let mut out = DocOps::empty();
        // Each item's graph and compiled form, until the chain is fused and its pipelines made.
        let mut builds: BTreeMap<String, (Value, Compiled)> = BTreeMap::new();
        out.hooks = hooks;
        out.doc_seed = doc["seed"].as_u64().unwrap_or(0);
        for (name, b) in core {
            out.storage.insert(("core".into(), name), b);
        }
        let mut items: Vec<(&String, &Value)> =
            doc["items"].as_object().into_iter().flatten().collect();
        items.sort_by(|a, b| a.0.cmp(b.0));
        let mut follows: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut channels = false;
        // A pass a group names runs on the group's target, never in the view's chain.
        let in_groups: Vec<&str> = items
            .iter()
            .flat_map(|(_, i)| i["params"]["passes"].as_array().into_iter().flatten())
            .filter_map(|p| p["op"].as_str())
            .collect();
        for (id, item) in items {
            let Some(json) = operator_of(id, item) else {
                continue;
            };
            if in_groups.contains(&id.as_str()) {
                continue;
            }
            let Ok(compiled) = compile_planted(&json, &BTreeMap::new(), options, planted) else {
                continue;
            };
            let c = &compiled.checked;
            if c.op.kind == Kind::Material {
                continue;
            }
            channels |=
                c.op.inputs
                    .values()
                    .any(|i| matches!(i.from, From::Channel(_)));
            follows.insert(id.clone(), reads_items(c));
            let structural =
                c.op.steps
                    .values()
                    .any(|s| deep_canvas_effects::table::multi_dispatch(&s.op));
            let declared_ns = c.op.cost.unwrap_or(c.estimate);
            let mut op = Op {
                item: id.clone(),
                members: vec![(id.clone(), 1.0)],
                member_ns: vec![declared_ns],
                key: 0,
                kind: c.op.kind,
                class: c.class,
                fallback: c.op.fallback,
                declared_ns,
                order: c.op.order.clone(),
                runner: None,
                failed: None,
                mark: mark_of(id),
                iterates: Vec::new(),
                structural,
                stepped: c.op.stepped.is_some(),
                fused: None,
                format: LINEAR,
            };
            let d = &device.device;
            for it in &c.iterates {
                let body = Compiled {
                    checked: (*it.body).clone(),
                    wgsl: deep_canvas_effects::emit::pass(&it.body, options),
                };
                let format = texture_format(&it.format);
                op.iterates.push(IterRun {
                    step: it.step.clone(),
                    count: it.count,
                    index: it.index.clone(),
                    scale: scale_of(&it.size),
                    format,
                    runner: pool.runner(d, body, format, std::slice::from_ref(id)).1,
                });
            }
            builds.insert(id.clone(), (json.clone(), compiled.clone()));
            // A stepped operator (#252) steps with the document's one fixed-step clock, and binds
            // storage only.
            if let Some(rate) = c.op.stepped {
                let st = out.stepping.get_or_insert_with(|| Stepping {
                    rate,
                    carried: Vec::new(),
                    at: None,
                    restored: None,
                });
                if st.rate != rate {
                    op.failed = Some(format!("{id} steps {rate} times a second, and the document's stepped operators step {} times", st.rate));
                } else if !c.textures.is_empty() || !c.op.textures.is_empty() {
                    op.failed = Some(format!(
                        "{id} is stepped, and a stepped operator reads and writes storage only"
                    ));
                }
            }
            if op.kind == Kind::Compute {
                for (name, s) in &c.op.storage {
                    let buffer = || {
                        d.create_buffer(&wgpu::BufferDescriptor {
                            label: Some("operator storage"),
                            size: u64::from(s.count.max(1)) * 4,
                            usage: wgpu::BufferUsages::STORAGE
                                | wgpu::BufferUsages::COPY_SRC
                                | wgpu::BufferUsages::COPY_DST,
                            mapped_at_creation: false,
                        })
                    };
                    if let (Some(carry), Some(st)) =
                        (s.carry, out.stepping.as_mut().filter(|_| op.stepped))
                    {
                        st.carried.push(Carried {
                            item: id.clone(),
                            output: name.clone(),
                            prev: buffer(),
                            bytes: u64::from(s.count.max(1)) * 4,
                            carry,
                            spacing: u64::from(carry.every),
                            ring: Vec::new(),
                        });
                    }
                    out.storage.insert((id.clone(), name.clone()), buffer());
                }
                for (name, t) in &c.op.textures {
                    let levels = if t.mips {
                        crate::mips::levels([t.size[0], t.size[1]])
                    } else {
                        1
                    };
                    let tex = d.create_texture(&wgpu::TextureDescriptor {
                        label: Some("operator texture"),
                        size: wgpu::Extent3d {
                            width: t.size[0],
                            height: t.size[1],
                            depth_or_array_layers: t.size[2],
                        },
                        mip_level_count: levels,
                        sample_count: 1,
                        dimension: if t.dim3 {
                            wgpu::TextureDimension::D3
                        } else {
                            wgpu::TextureDimension::D2
                        },
                        format: texture_format(&t.format),
                        usage: wgpu::TextureUsages::STORAGE_BINDING
                            | wgpu::TextureUsages::TEXTURE_BINDING
                            | wgpu::TextureUsages::COPY_SRC,
                        view_formats: &[],
                    });
                    out.textures.insert(
                        (id.clone(), name.clone()),
                        OutTex {
                            tex,
                            out: t.clone(),
                            chain: None,
                            made: false,
                        },
                    );
                }
            }
            out.ops.push(op);
        }
        if channels {
            out.program = doc.as_object().and_then(|m| Program::compile(m).ok());
        }
        out.early = feeders(doc);
        // Compute first, each after what it reads; then passes by their order key, then ID.
        let mut placed: Vec<String> = Vec::new();
        let mut computes: Vec<String> = out
            .ops
            .iter()
            .filter(|o| o.kind == Kind::Compute)
            .map(|o| o.item.clone())
            .collect();
        while !computes.is_empty() {
            let ready = computes
                .iter()
                .position(|c| {
                    follows[c]
                        .iter()
                        .all(|f| placed.contains(f) || !computes.contains(f))
                })
                .unwrap_or(0);
            placed.push(computes.remove(ready));
        }
        let rank = |o: &Op| {
            placed
                .iter()
                .position(|p| *p == o.item)
                .unwrap_or(usize::MAX)
        };
        out.ops.sort_by(|a, b| {
            (a.kind != Kind::Compute, rank(a), &a.order, &a.item).cmp(&(
                b.kind != Kind::Compute,
                rank(b),
                &b.order,
                &b.item,
            ))
        });
        if !fusing.off {
            out.fuse(&builds, fail, options, planted, fusing);
        }
        out.precise(&builds);
        // Each operator's pipeline, from the pool; the device checks each one new to it.
        for op in &mut out.ops {
            let Some(built) = op_build(op, &builds) else {
                continue;
            };
            let mut built = built;
            if fail.contains(&op.item) {
                // The hook: the device gets a module it rejects, after the check passed.
                built.wgsl.push_str("\nfn rejected_by_the_device( {\n");
            }
            let d = &device.device;
            let scope = deep_gpu::device::push_scope(d, wgpu::ErrorFilter::Validation);
            let members: Vec<String> = op.members.iter().map(|m| m.0.clone()).collect();
            let (key, runner) = pool.runner(d, built, op.format, &members);
            match block(scope.pop()) {
                Some(e) => op.failed = Some(e.to_string()),
                None => {
                    op.key = key;
                    op.runner = Some(runner);
                }
            }
        }
        out
    }

    /// Fuses each run of adjacent pixel-wise passes into one operator (pass fusion), its members
    /// in order; a run whose fused graph the check refuses stays apart.
    pub(super) fn fuse(
        &mut self,
        builds: &BTreeMap<String, (Value, Compiled)>,
        fail: &[String],
        options: Options,
        planted: CheckOptions,
        fusing: &Fusing,
    ) {
        let eligible = |o: &Op| {
            o.kind == Kind::Pass
                && !o.structural
                && !o.stepped
                && o.iterates.is_empty()
                && o.failed.is_none()
                && !fail.contains(&o.item)
                && builds.contains_key(&o.item)
        };
        let ops = std::mem::take(&mut self.ops);
        let mut segment: Vec<Op> = Vec::new();
        let flush = |segment: &mut Vec<Op>, out: &mut Vec<Op>| {
            let chain: Vec<(String, Value)> = segment
                .iter()
                .map(|o| (o.item.clone(), builds[&o.item].0.clone()))
                .collect();
            let runs = deep_canvas_effects::fusion::runs(&chain, &fusing.apart);
            let mut taken: Vec<Option<Op>> = segment.drain(..).map(Some).collect();
            for run in runs {
                let fused = (run.len() > 1)
                    .then(|| {
                        let members: Vec<(String, Value)> =
                            run.iter().map(|&k| chain[k].clone()).collect();
                        let g = deep_canvas_effects::fusion::fuse(&members)?;
                        compile_planted(&g, &BTreeMap::new(), options, planted).ok()
                    })
                    .flatten();
                match fused {
                    Some(c) => {
                        let parts: Vec<Op> = run
                            .iter()
                            .map(|&k| taken[k].take().expect("once"))
                            .collect();
                        let total: f64 = parts.iter().map(|o| o.declared_ns).sum();
                        let mut first = parts.into_iter();
                        let mut op = first.next().expect("a run of two or more");
                        let rest: Vec<Op> = first.collect();
                        let mut members = vec![(op.item.clone(), op.declared_ns)];
                        members.extend(rest.iter().map(|o| (o.item.clone(), o.declared_ns)));
                        let names: Vec<&str> = members.iter().map(|m| m.0.as_str()).collect();
                        op.mark = mark_of(&names.join("+"));
                        op.member_ns = members.iter().map(|m| m.1).collect();
                        op.members = members
                            .iter()
                            .map(|(i, ns)| {
                                (
                                    i.clone(),
                                    if total > 0.0 {
                                        ns / total
                                    } else {
                                        1.0 / names.len() as f64
                                    },
                                )
                            })
                            .collect();
                        op.declared_ns = total;
                        op.class = c.checked.class;
                        op.fused = Some(c);
                        out.push(op);
                    }
                    None => out.extend(run.iter().map(|&k| taken[k].take().expect("once"))),
                }
            }
        };
        let mut out = Vec::with_capacity(ops.len());
        for op in ops {
            let joins = eligible(&op)
                && segment
                    .last()
                    .is_none_or(|l: &Op| builds[&l.item].0["chain"] == builds[&op.item].0["chain"]);
            if !joins {
                flush(&mut segment, &mut out);
            }
            if eligible(&op) {
                segment.push(op);
            } else {
                out.push(op);
            }
        }
        flush(&mut segment, &mut out);
        self.ops = out;
    }

    /// Which passes write a full-precision target: a pass at full resolution, drawn alone, whose
    /// target no other operator reads by name and whose next pass only loads the frame's color.
    pub(super) fn precise(&mut self, builds: &BTreeMap<String, (Value, Compiled)>) {
        let compiled = |o: &Op| op_build(o, builds);
        let named: BTreeSet<String> = builds
            .values()
            .flat_map(|(_, c)| reads_items(&c.checked))
            .collect();
        let passes: Vec<usize> = (0..self.ops.len())
            .filter(|&k| self.ops[k].kind == Kind::Pass)
            .collect();
        for w in passes.windows(2) {
            let (k, j) = (w[0], w[1]);
            let (Some(a), Some(b)) = (compiled(&self.ops[k]), compiled(&self.ops[j])) else {
                continue;
            };
            let loads = b.checked.textures.iter().all(|n| {
                let core_color = matches!(&b.checked.op.inputs[n].from, From::Target { op, output } if op == "core" && output == "color");
                !core_color || crate::runner::only_loaded(&b.checked, n)
            });
            let o = &self.ops[k];
            let alone = !o.structural && !o.stepped && o.iterates.is_empty();
            let full = a.checked.op.size == Size::Full;
            if loads && alone && full && !o.members.iter().any(|(m, _)| named.contains(m)) {
                self.ops[k].format = wgpu::TextureFormat::Rgba32Float;
            }
        }
    }

    /// The pipeline key and members of the operator pass timed under `mark`, each member with its
    /// share of the pass's cost (Operator cost and limits: a fused pass split by declared shares).
    pub fn pass_of(&self, mark: &str) -> Option<(u128, &[(String, f64)])> {
        self.ops
            .iter()
            .find(|o| o.mark == mark && o.kind != Kind::Compute && o.runner.is_some())
            .map(|o| (o.key, o.members.as_slice()))
    }

    /// The operator that runs `item`, its declared ns per pixel and its share of that operator's
    /// pass.
    pub fn member(&self, item: &str) -> Option<(&Op, f64, f64)> {
        self.ops.iter().find_map(|o| {
            let k = o.members.iter().position(|m| m.0 == item)?;
            Some((o, o.member_ns[k], o.members[k].1))
        })
    }

    /// Each instances output with a count: the rows its compact step keeps and that count, which
    /// the instancer draws from (#484).
    pub fn sources(&self) -> Vec<deep_scene3d_render::cull::Source> {
        let mut out = Vec::new();
        for op in &self.ops {
            let Some(runner) = &op.runner else { continue };
            let o = &runner.compiled.checked.op;
            for i in o.instances.values() {
                let Some(step) = &i.count else { continue };
                let buffer = |port: &str| {
                    let want = graph::Arg::Ref(step.clone(), Some(port.to_string()));
                    let (name, _) = o
                        .storage
                        .iter()
                        .find(|(_, s)| s.from.as_ref() == Some(&want))?;
                    self.storage.get(&(op.item.clone(), name.clone())).cloned()
                };
                if let (Some(rows), Some(count)) = (buffer("out"), buffer("count")) {
                    out.push(deep_scene3d_render::cull::Source {
                        instancer: i.instancer.clone(),
                        rows,
                        count,
                    });
                }
            }
        }
        out
    }

    /// The issues of operators whose pipelines the device rejected.
    pub fn issues(&self) -> Vec<Value> {
        self.ops.iter().filter_map(compile_issue).collect()
    }

    pub(super) fn kernels(&mut self, device: &Device) -> Arc<(Structural, Mips, Fills)> {
        self.kernels
            .get_or_insert_with(|| {
                let d = &device.device;
                Arc::new((Structural::new(d), Mips::new(d), Fills::new(d)))
            })
            .clone()
    }

    pub(super) fn texture(
        device: &Device,
        label: &str,
        size: [u32; 2],
        format: wgpu::TextureFormat,
    ) -> wgpu::Texture {
        device.device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: size[0].max(1),
                height: size[1].max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT
                | wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        })
    }

    /// A target of `size` the operators keep under `key`, made again when the size changes.
    pub(super) fn target(
        &mut self,
        device: &Device,
        key: String,
        size: [u32; 2],
    ) -> wgpu::TextureView {
        self.target_of(device, key, size, LINEAR)
    }

    pub(super) fn target_of(
        &mut self,
        device: &Device,
        key: String,
        size: [u32; 2],
        format: wgpu::TextureFormat,
    ) -> wgpu::TextureView {
        if self
            .targets
            .get(&key)
            .is_none_or(|t| t.0 != size || t.1.format() != format)
        {
            let t = Self::texture(device, "operator target", size, format);
            self.targets.insert(key.clone(), (size, t));
        }
        self.targets[&key].1.create_view(&Default::default())
    }

    pub(super) fn blit_runner(&mut self, device: &Device) -> Arc<Runner> {
        self.blit
            .get_or_insert_with(|| {
                let c = compile_with(&blit(), &BTreeMap::new(), Options::default())
                    .expect("the blit checks");
                Arc::new(Runner::new(&device.device, c, LINEAR))
            })
            .clone()
    }

    /// The blit of `from` into `to` at `size`, sampled, to record later.
    pub(super) fn blit_rec(
        &mut self,
        device: &Device,
        from: &wgpu::TextureView,
        to: wgpu::TextureView,
        size: [u32; 2],
    ) -> Blit {
        let runner = self.blit_runner(device);
        let (g0, g1, keep) = runner.bind(
            &device.device,
            &Frame::default(),
            size,
            &BTreeMap::new(),
            &[from],
            &[],
        );
        Blit {
            runner,
            groups: (g0, g1),
            _keep: keep,
            to,
        }
    }

    /// Draws `from` into `to` at `size`, sampled.
    pub fn blit_into(
        &mut self,
        device: &Device,
        encoder: &mut wgpu::CommandEncoder,
        from: &wgpu::TextureView,
        to: &wgpu::TextureView,
        size: [u32; 2],
    ) {
        self.blit_rec(device, from, to.clone(), size)
            .record(encoder);
    }

    /// A compute operator's storage output (or the core's storage input `name` under "core").
    pub fn buffer_of(&self, item: &str, output: &str) -> Option<&wgpu::Buffer> {
        self.storage.get(&(item.to_string(), output.to_string()))
    }

    /// An operator item's computed determinism class.
    pub fn class_of(&self, item: &str) -> Option<Class> {
        self.ops.iter().find(|o| o.item == item).map(|o| o.class)
    }

    /// A compute operator's texture output.
    pub fn texture_of(&self, item: &str, output: &str) -> Option<&OutTex> {
        self.textures.get(&(item.to_string(), output.to_string()))
    }

    /// The target a pass operator drew into in the last frame planned.
    pub fn drawn_of(&self, item: &str) -> Option<&wgpu::Texture> {
        self.targets.get(self.drawn.get(item)?).map(|t| &t.1)
    }

    /// The parameter values a frame at `t` s feeds the operators' channel inputs, by path.
    pub(super) fn channel_values(&self, t: f32) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        let Some(program) = &self.program else {
            return out;
        };
        let mut state = program.state();
        let at = (f64::from(t) * 705_600_000.0).round() as i64;
        program.evaluate(at, Validity::Full, &mut state);
        for op in &self.ops {
            let Some(r) = &op.runner else { continue };
            for input in r.compiled.checked.op.inputs.values() {
                let From::Channel(path) = &input.from else {
                    continue;
                };
                let parts: Vec<&str> = path.split('/').collect();
                if let ["items", owner, field @ ..] = parts.as_slice() {
                    let field: Vec<String> = field.iter().map(|f| f.to_string()).collect();
                    let slot = program.slot_of(owner, &field);
                    if let Some(v) = slot.and_then(|k| state.slots.get(k)) {
                        out.insert(path.clone(), json!(v));
                    }
                }
            }
        }
        out
    }

    /// The view a pass's texture input reads this frame.
    #[allow(clippy::too_many_arguments)]
    pub(super) fn view_of(
        &self,
        from: &From,
        src: &wgpu::TextureView,
        ids: Option<&wgpu::TextureView>,
        depth: Option<&wgpu::TextureView>,
        iterated: &BTreeMap<String, wgpu::TextureView>,
        passes: &BTreeMap<String, wgpu::TextureView>,
    ) -> wgpu::TextureView {
        match from {
            From::Target { op, output } if op == "core" && output == "object_id" => {
                ids.cloned().unwrap_or_else(|| src.clone())
            }
            From::Target { op, output } if op == "core" && output == "depth" => {
                depth.cloned().unwrap_or_else(|| src.clone())
            }
            From::Target { op, output }
                if op == "core" && self.core.contains_key(output.as_str()) =>
            {
                self.core[output.as_str()].clone()
            }
            From::Target { op, output } | From::Texture3d { op, output, .. } => {
                if let Some(v) = self.collections.get(&(op.clone(), output.clone())) {
                    v.clone()
                } else if let Some(t) = self.textures.get(&(op.clone(), output.clone())) {
                    t.tex.create_view(&Default::default())
                } else if let Some(v) = iterated.get(op) {
                    v.clone()
                } else if let Some(v) = passes.get(op) {
                    v.clone()
                } else {
                    src.clone()
                }
            }
            _ => src.clone(),
        }
    }

    /// The multi-dispatch plan of a compute operator, made once its buffers are known.
    pub(super) fn plan_of(
        &mut self,
        device: &Device,
        item: &str,
        c: &Checked,
    ) -> Option<(Option<Arc<Pre>>, Arc<Plan>)> {
        if let Some(p) = self.plans.get(item) {
            return Some(p.clone());
        }
        let k = self.kernels(device);
        let d = &device.device;
        let (id, s) = c.op.steps.iter().next()?;
        let input = |port: &str| -> Option<wgpu::Buffer> {
            let Some(graph::Arg::Ref(name, None)) = s.args.get(port) else {
                return None;
            };
            match &c.op.inputs.get(name)?.from {
                From::Storage {
                    op,
                    output,
                    previous: false,
                } => self.storage.get(&(op.clone(), output.clone())).cloned(),
                _ => None,
            }
        };
        let output = |port: Option<&str>| -> Option<wgpu::Buffer> {
            let (name, _) = c.op.storage.iter().find(|(_, o)| {
                matches!(&o.from, Some(graph::Arg::Ref(st, p)) if st == id && p.as_deref() == port)
            })?;
            self.storage.get(&(item.to_string(), name.clone())).cloned()
        };
        let scratch = |n: u32| {
            d.create_buffer(&wgpu::BufferDescriptor {
                label: Some("structural scratch"),
                size: u64::from(n.max(1)) * 4,
                usage: wgpu::BufferUsages::STORAGE
                    | wgpu::BufferUsages::COPY_SRC
                    | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            })
        };
        let count = |len: u32| match s.args.get("count") {
            Some(graph::Arg::Lit(v)) => v.as_u64().unwrap_or(u64::from(len)) as u32,
            _ => len,
        };
        let made = match s.op.as_str() {
            "scan@1" => {
                let src = input("in")?;
                let n = (src.size() / 4) as u32;
                let dst = output(None).unwrap_or_else(|| scratch(n));
                (
                    None,
                    k.0.scan(
                        d,
                        &src,
                        &dst,
                        n.min(c.op.storage.values().next().map_or(n, |o| o.count)),
                    ),
                )
            }
            "compact@1" => {
                let (src, flag) = (input("in")?, input("flag")?);
                let n = count((src.size() / 4) as u32);
                let out = output(Some("out")).unwrap_or_else(|| scratch(n));
                let cnt = output(Some("count")).unwrap_or_else(|| scratch(1));
                if self.hooks.compact_by_atomic {
                    let pre = Pre::append(d, &src, &flag, &out, &cnt, n);
                    // The counter's plan clears what the step writes and runs nothing more.
                    let clear = k.0.scan(d, &scratch(1), &cnt, 0);
                    (Some(Arc::new(pre)), clear)
                } else {
                    (None, k.0.compact(d, &src, &flag, &out, &cnt, n))
                }
            }
            _ => {
                let (keys, vals) = (input("keys")?, input("values")?);
                let n = count((keys.size() / 4) as u32);
                let vo = output(None).unwrap_or_else(|| scratch(n));
                let ko = scratch(n);
                if self.hooks.ties_decreasing {
                    let (rk, rv) = (scratch(n), scratch(n));
                    let pre = Pre::reverse(d, &[(&keys, &rk), (&vals, &rv)], n);
                    (
                        Some(Arc::new(pre)),
                        k.0.sort_by_key(d, &rk, &rv, &ko, &vo, n),
                    )
                } else {
                    (None, k.0.sort_by_key(d, &keys, &vals, &ko, &vo, n))
                }
            }
        };
        let made = (made.0, Arc::new(made.1));
        self.plans.insert(item.to_string(), made.clone());
        Some(made)
    }

    /// The buffer a storage input binds: the output an operator wrote earlier in the frame or
    /// step, or with `previous`, a carried output as the previous step left it (#252).
    pub(super) fn storage_in(&self, from: &From) -> Option<wgpu::Buffer> {
        match from {
            From::Storage {
                op,
                output,
                previous: false,
            } => self.storage.get(&(op.clone(), output.clone())).cloned(),
            From::Storage {
                op,
                output,
                previous: true,
            } => self
                .stepping
                .as_ref()?
                .carried
                .iter()
                .find(|c| c.item == *op && c.output == *output)
                .map(|c| c.prev.clone()),
            _ => None,
        }
    }

    /// What each carried output holds after the last frame planned (#252): the step, its ring's
    /// bytes, budget and checkpoints, and the checkpoint a seek restored with the steps it then
    /// ran, by `<item>.<output>`.
    pub fn carried(&self) -> Value {
        let Some(st) = &self.stepping else {
            return json!({});
        };
        let mut m = serde_json::Map::new();
        for c in &st.carried {
            let mut row = json!({
                "step": st.at,
                "ring": {
                    "bytes": c.held(),
                    "budget": c.carry.budget,
                    "checkpoints": c.ring.iter().map(|(s, _)| *s).collect::<Vec<_>>(),
                },
            });
            if let Some((from, steps)) = st.restored {
                row["restored"] = json!({"from": from, "steps": steps});
            }
            m.insert(format!("{}.{}", c.item, c.output), row);
        }
        Value::Object(m)
    }

    /// The stepped operators' work for the frame at `frame` (#252; canvas primitives: Carried
    /// state): the frame shows step ⌊t × rate⌋, so the carried state steps from the step it holds
    /// to that one, every stepped operator once a step in dependency order, each step reading the
    /// last through `prev`. A frame behind the state it holds (a seek back), or with a checkpoint
    /// nearer it than that state, restores the nearest checkpoint at or before it that every
    /// carried output holds, or else starts again from step 0. After each step a carried output
    /// takes a checkpoint on its ring's spacing, and the ring thins to its budget.
    pub(super) fn steps(
        &mut self,
        device: &Device,
        frame: &Frame,
        params: &BTreeMap<String, Value>,
        roles: &BTreeMap<String, [f64; 3]>,
    ) -> Vec<Part> {
        let Some(mut st) = self.stepping.take() else {
            return Vec::new();
        };
        let d = &device.device;
        let rate = f64::from(st.rate);
        let t = self.clock.unwrap_or(f64::from(frame.t));
        // The step the frame shows; the small term keeps an exact quotient from flooring under.
        let target = if self.hooks.steps_per_frame {
            st.at.map_or(0, |a| a + 1)
        } else {
            (t * rate + 1e-6).floor().max(0.0) as u64
        };
        let mut parts = Vec::new();
        let current = |c: &Carried| self.storage[&(c.item.clone(), c.output.clone())].clone();
        st.restored = None;
        let behind = st.at.is_some_and(|a| target < a);
        let nearest = st.carried.first().and_then(|first| {
            first.ring.iter().rev().map(|(s, _)| *s).find(|s| {
                *s <= target
                    && st
                        .carried
                        .iter()
                        .all(|c| c.ring.iter().any(|(x, _)| x == s))
            })
        });
        match nearest {
            Some(s) if behind || st.at.is_none_or(|a| s > a) => {
                for c in &st.carried {
                    let (_, b) = c
                        .ring
                        .iter()
                        .find(|(x, _)| *x == s)
                        .expect("held by every output");
                    parts.push(Part::StepCopy(b.clone(), current(c)));
                }
                st.at = Some(s);
                st.restored = Some((s, target - s));
            }
            _ if behind => {
                for c in &st.carried {
                    parts.push(Part::StepClear(current(c)));
                }
                st.at = None;
            }
            _ => {}
        }
        let order: Vec<usize> = (0..self.ops.len())
            .filter(|&k| {
                self.ops[k].stepped && self.ops[k].failed.is_none() && self.ops[k].runner.is_some()
            })
            .collect();
        let first = st.at.map_or(0, |a| a + 1);
        self.stepping = Some(st);
        for step in first..=target {
            // A long run of steps (a seek's, or a cold start's) goes to the GPU in submissions of
            // its own, a chunk at a time, before the frame's: one command buffer holding hundreds of
            // steps outlasts the GPU's limit for one. The frame records the last few.
            if target - step >= IN_FRAME && (step - first) % CHUNK == 0 && !parts.is_empty() {
                submit(device, std::mem::take(&mut parts));
            }
            let st = self.stepping.as_ref().expect("taken back above");
            for c in &st.carried {
                parts.push(Part::StepCopy(current(c), c.prev.clone()));
            }
            for &k in &order {
                let op = &self.ops[k];
                let runner = op.runner.clone().expect("built");
                let c = &runner.compiled.checked;
                // Storage it doesn't carry starts each step at its declared clear value.
                for (n, out) in c.op.storage.iter().filter(|(_, o)| o.carry.is_none()) {
                    let key = (op.item.clone(), n.clone());
                    parts.push(Part::StepClear(self.storage[&key].clone()));
                    if out.clear != 0 {
                        let words: Vec<u8> =
                            std::iter::repeat_n(out.clear.to_le_bytes(), out.count.max(1) as usize)
                                .flatten()
                                .collect();
                        let from = d.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                            label: Some("operator clear"),
                            contents: &words,
                            usage: wgpu::BufferUsages::COPY_SRC,
                        });
                        parts.push(Part::StepCopy(from, self.storage[&key].clone()));
                    }
                }
                let mut f = *frame;
                f.seed = item_seed(self.doc_seed, &op.item);
                f.t = (step as f64 / rate) as f32;
                let mut values = interp::inputs(c, params, roles);
                for (n, i) in &c.op.inputs {
                    if i.from == From::Step {
                        values.insert(n.clone(), Val::N(Sc::U32, vec![step as f64]));
                    }
                }
                let Some(ins) = c
                    .storage_inputs
                    .iter()
                    .map(|n| self.storage_in(&c.op.inputs[n].from))
                    .collect::<Option<Vec<wgpu::Buffer>>>()
                else {
                    continue;
                };
                let outs: Vec<wgpu::Buffer> =
                    c.op.storage
                        .keys()
                        .map(|n| self.storage[&(op.item.clone(), n.clone())].clone())
                        .collect();
                let all: Vec<&wgpu::Buffer> = ins.iter().chain(&outs).collect();
                let (g0, g1, keep) = runner.bind_with(d, &f, [1, 1], &values, &[], &all, &[]);
                parts.push(Part::Dispatch(
                    runner.clone(),
                    (g0, g1),
                    keep,
                    c.op.elements,
                ));
            }
            let every_one = self.hooks.keeps_every_checkpoint;
            let mut taken = Vec::new();
            let st = self.stepping.as_mut().expect("taken back above");
            for c in &mut st.carried {
                let due = if every_one {
                    step % u64::from(c.carry.every) == 0
                } else {
                    step % c.spacing == 0 && c.bytes <= c.carry.budget
                };
                if !due || c.ring.iter().any(|(s, _)| *s == step) {
                    continue;
                }
                let b = d.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("carried checkpoint"),
                    size: c.bytes,
                    usage: wgpu::BufferUsages::COPY_SRC | wgpu::BufferUsages::COPY_DST,
                    mapped_at_creation: false,
                });
                taken.push((c.item.clone(), c.output.clone(), b.clone()));
                let at = c.ring.partition_point(|(s, _)| *s < step);
                c.ring.insert(at, (step, b));
                if !every_one {
                    c.thin();
                }
            }
            for (item, output, b) in taken {
                parts.push(Part::StepCopy(self.storage[&(item, output)].clone(), b));
            }
        }
        if let Some(st) = self.stepping.as_mut() {
            st.at = Some(target.max(st.at.unwrap_or(0)));
        }
        parts
    }

    /// Plans the frame's operators over `color`, the frame's linear color at `size` (`ids` and
    /// `depth` its other targets): compute operators first, then each pass reading the color so
    /// far into a target of its own at its resolution, returned to full size when below it.
    /// `resolution(item)` gives each operator's resolution (0 for off); in a `canonical` render a
    /// live-only operator draws its fallback. Returns a row per operator, the recordings in order
    /// (bound now, recorded into the frame's encoder later), and the color the last pass writes,
    /// if one draws.
    #[allow(clippy::too_many_arguments)]
    pub fn plan(
        &mut self,
        device: &Device,
        color: &wgpu::TextureView,
        ids: Option<&wgpu::TextureView>,
        depth: Option<&wgpu::TextureView>,
        size: [u32; 2],
        frame: &Frame,
        roles: &BTreeMap<String, [f64; 3]>,
        resolution: &dyn Fn(&str) -> f64,
        canonical: bool,
    ) -> (Vec<Row>, Vec<Rec>, Option<wgpu::TextureView>) {
        let mut rows = Vec::new();
        let mut recs = Vec::new();
        let mut cur: Option<wgpu::TextureView> = None;
        let params = self.channel_values(frame.t);
        let mut passes: BTreeMap<String, wgpu::TextureView> = BTreeMap::new();
        let marker = self.hooks.marker;
        let clear = !self.hooks.no_clear;
        // Every stepped operator steps once, together, in the place of the first (#252).
        let mut steps = Some(self.steps(device, frame, &params, roles));
        for k in 0..self.ops.len() {
            let op = &self.ops[k];
            // A full-precision target is drawn at full size: its reader loads it texel for texel.
            let res = match resolution(&op.item) {
                r if op.format == LINEAR || r <= 0.0 => r,
                _ => 1.0,
            };
            let format = op.format;
            let mut drew = if op.failed.is_some() || (canonical && op.class == Class::LiveOnly) {
                Drew::Fallback
            } else if res <= 0.0 {
                Drew::Off
            } else {
                Drew::Operator
            };
            let item = op.item.clone();
            let op_members = op.members.clone();
            let kind = op.kind;
            let mark = op.mark;
            let runner = op.runner.clone();
            let structural = op.structural;
            let stepped = op.stepped;
            // The steps record whatever this frame draws: the carried state already counts them,
            // and a stepped operator's state never steps down (#252).
            if stepped {
                if let Some(parts) = steps.take().filter(|p| !p.is_empty()) {
                    recs.push(Rec { mark, parts });
                }
            } else if drew == Drew::Operator {
                let runner = runner.expect("built");
                // Lent from this frame's own handle on the runner: the checked graph is only read.
                let c = &runner.compiled.checked;
                let mut f = *frame;
                f.seed = item_seed(self.doc_seed, &item);
                let mut own_params = params.clone();
                if op_members.len() > 1 {
                    // A fused pass reads each member's params under its member's prefix.
                    for (j, (m, _)) in op_members.iter().enumerate() {
                        let p = deep_canvas_effects::fusion::prefix(j);
                        own_params.extend(
                            self.params
                                .get(m)
                                .into_iter()
                                .flatten()
                                .map(|(k, v)| (format!("{p}{k}"), v.clone())),
                        );
                    }
                } else {
                    own_params.extend(
                        self.params
                            .get(&item)
                            .into_iter()
                            .flatten()
                            .map(|(k, v)| (k.clone(), v.clone())),
                    );
                }
                let values = interp::inputs(c, &own_params, roles);
                let storage: Option<Vec<wgpu::Buffer>> = c
                    .storage_inputs
                    .iter()
                    .map(|n| self.storage_in(&c.op.inputs[n].from))
                    .collect();
                let mut parts = Vec::new();
                match (kind, storage) {
                    (_, None) => drew = Drew::Fallback,
                    (Kind::Compute, Some(_)) if structural => {
                        match self.plan_of(device, &item, c) {
                            Some((pre, plan)) => {
                                parts.push(Part::Clears(plan.clone()));
                                if let Some(pre) = pre {
                                    parts.push(Part::Pre(pre));
                                }
                                if !self.hooks.compact_by_atomic
                                    || !c.op.steps.values().any(|s| s.op == "compact@1")
                                {
                                    parts.push(Part::Plan(plan));
                                }
                            }
                            None => drew = Drew::Fallback,
                        }
                    }
                    (Kind::Compute, Some(storage)) => {
                        let outs: Vec<wgpu::Buffer> =
                            c.op.storage
                                .keys()
                                .map(|n| self.storage[&(item.clone(), n.clone())].clone())
                                .collect();
                        let kern = self.kernels(device);
                        // Every output starts the frame at its declared clear value, 0 (under the
                        // test hook, first filled with the pool's marker).
                        for b in &outs {
                            parts.push(Part::ClearBuffer(b.clone()));
                        }
                        for (n, s) in c.op.storage.iter().filter(|(_, s)| s.clear != 0) {
                            let key = (item.clone(), n.clone());
                            let words = vec![s.clear; s.count.max(1) as usize];
                            let bytes: Vec<u8> =
                                words.iter().flat_map(|w| w.to_le_bytes()).collect();
                            let from = self.clears.entry(key.clone()).or_insert_with(|| {
                                device.device.create_buffer_init(
                                    &wgpu::util::BufferInitDescriptor {
                                        label: Some("operator clear"),
                                        contents: &bytes,
                                        usage: wgpu::BufferUsages::COPY_SRC,
                                    },
                                )
                            });
                            parts.push(Part::CopyBuffer(from.clone(), self.storage[&key].clone()));
                        }
                        let mut views = Vec::new();
                        let mut chains = Vec::new();
                        let names: Vec<String> = c.op.textures.keys().cloned().collect();
                        for n in &names {
                            let key = (item.clone(), n.clone());
                            let t = self.textures.get_mut(&key).expect("made");
                            if let Some(m) = marker {
                                parts.push(Part::Fill(Arc::new(kern.2.fill(
                                    &device.device,
                                    &t.tex,
                                    &t.out.format,
                                    m,
                                ))));
                            }
                            if clear {
                                parts.push(Part::Fill(Arc::new(kern.2.fill(
                                    &device.device,
                                    &t.tex,
                                    &t.out.format,
                                    [0.0; 4],
                                ))));
                            }
                            views.push(t.tex.create_view(&wgpu::TextureViewDescriptor {
                                base_mip_level: 0,
                                mip_level_count: Some(1),
                                ..Default::default()
                            }));
                            if t.out.mips
                                && !self.hooks.level0_only
                                && !(self.hooks.old_key && t.made)
                            {
                                let chain = t
                                    .chain
                                    .get_or_insert_with(|| {
                                        Arc::new(kern.1.chain(&device.device, &t.tex))
                                    })
                                    .clone();
                                t.made = true;
                                chains.push(chain);
                            }
                        }
                        let all: Vec<&wgpu::Buffer> = storage.iter().chain(&outs).collect();
                        let tex_views: Vec<wgpu::TextureView> = c
                            .textures
                            .iter()
                            .map(|n| {
                                self.view_of(
                                    &c.op.inputs[n].from,
                                    color,
                                    ids,
                                    depth,
                                    &BTreeMap::new(),
                                    &passes,
                                )
                            })
                            .collect();
                        let trefs: Vec<&wgpu::TextureView> = tex_views.iter().collect();
                        let vrefs: Vec<&wgpu::TextureView> = views.iter().collect();
                        let (g0, g1, keep) = runner.bind_with(
                            &device.device,
                            &f,
                            [1, 1],
                            &values,
                            &trefs,
                            &all,
                            &vrefs,
                        );
                        // An indirect dispatch: the GPU writes its arguments from its count.
                        let count = c
                            .storage_inputs
                            .iter()
                            .position(|n| n == graph::DISPATCH_COUNT)
                            .and_then(|k| storage.get(k))
                            .filter(|_| c.op.counted && !self.hooks.dispatch_without_guard);
                        match count {
                            Some(count) => {
                                let d = &device.device;
                                let (plan, buffer) =
                                    self.counted.entry(item.clone()).or_insert_with(|| {
                                        let buffer = d.create_buffer(&wgpu::BufferDescriptor {
                                            label: Some("operator indirect dispatch"),
                                            size: 12,
                                            usage: wgpu::BufferUsages::STORAGE
                                                | wgpu::BufferUsages::INDIRECT,
                                            mapped_at_creation: false,
                                        });
                                        let plan = kern.0.dispatch_args(
                                            d,
                                            count,
                                            &buffer,
                                            c.op.workgroup,
                                            c.op.elements,
                                        );
                                        (Arc::new(plan), buffer)
                                    });
                                parts.push(Part::Plan(plan.clone()));
                                parts.push(Part::DispatchIndirect(
                                    runner.clone(),
                                    (g0, g1),
                                    keep,
                                    buffer.clone(),
                                ));
                            }
                            None => parts.push(Part::Dispatch(
                                runner.clone(),
                                (g0, g1),
                                keep,
                                c.op.elements,
                            )),
                        }
                        parts.extend(chains.into_iter().map(Part::Mips));
                    }
                    (_, Some(storage)) => {
                        let src = cur.clone().unwrap_or_else(|| color.clone());
                        let own = [
                            ((f64::from(size[0]) * res).round() as u32).max(1),
                            ((f64::from(size[1]) * res).round() as u32).max(1),
                        ];
                        let srefs: Vec<&wgpu::Buffer> = storage.iter().collect();
                        // Each iterate step's runs over its two ping-pong targets (#483): run k
                        // reads the last run's output as `prev`, run 0 the target's clear value.
                        let mut iterated: BTreeMap<String, wgpu::TextureView> = BTreeMap::new();
                        let iters: Vec<(
                            String,
                            u32,
                            String,
                            f64,
                            wgpu::TextureFormat,
                            Arc<Runner>,
                        )> = self.ops[k]
                            .iterates
                            .iter()
                            .map(|it| {
                                (
                                    it.step.clone(),
                                    it.count,
                                    it.index.clone(),
                                    it.scale,
                                    it.format,
                                    it.runner.clone(),
                                )
                            })
                            .collect();
                        for (step, count, index, scale, format, body) in iters {
                            let isize = [
                                ((f64::from(size[0]) * scale).round() as u32).max(1),
                                ((f64::from(size[1]) * scale).round() as u32).max(1),
                            ];
                            let t: Vec<wgpu::TextureView> = (0..2)
                                .map(|j| {
                                    self.target_of(
                                        device,
                                        format!("{item}:{step}:{j}"),
                                        isize,
                                        format,
                                    )
                                })
                                .collect();
                            for v in &t {
                                if let Some(m) = marker {
                                    parts.push(Part::ClearTarget(v.clone(), m));
                                }
                                if clear {
                                    parts.push(Part::ClearTarget(v.clone(), [0.0; 4]));
                                }
                            }
                            let bc = &body.compiled.checked;
                            let mut last = 1usize;
                            for run in 0..count {
                                let (prev, into) = if self.hooks.feeds_first && run > 0 {
                                    (0usize, 1usize)
                                } else {
                                    (last, 1 - last)
                                };
                                let mut bv = interp::inputs(bc, &own_params, roles);
                                bv.insert(index.clone(), Val::N(Sc::U32, vec![f64::from(run)]));
                                let views: Vec<wgpu::TextureView> = bc
                                    .textures
                                    .iter()
                                    .map(|n| {
                                        if n == "prev" {
                                            t[prev].clone()
                                        } else {
                                            self.view_of(
                                                &bc.op.inputs[n].from,
                                                &src,
                                                ids,
                                                depth,
                                                &iterated,
                                                &passes,
                                            )
                                        }
                                    })
                                    .collect();
                                let refs: Vec<&wgpu::TextureView> = views.iter().collect();
                                let (g0, g1, keep) =
                                    body.bind(&device.device, &f, isize, &bv, &refs, &[]);
                                parts.push(Part::Draw(
                                    body.clone(),
                                    (g0, g1),
                                    keep,
                                    t[into].clone(),
                                    None,
                                ));
                                last = into;
                            }
                            iterated.insert(format!("{}.{step}", c.op.id), t[last].clone());
                        }
                        let views: Vec<wgpu::TextureView> = c
                            .textures
                            .iter()
                            .map(|n| {
                                self.view_of(
                                    &c.op.inputs[n].from,
                                    &src,
                                    ids,
                                    depth,
                                    &iterated,
                                    &passes,
                                )
                            })
                            .collect();
                        let refs: Vec<&wgpu::TextureView> = views.iter().collect();
                        // Each pass writes a target of its own, never the one it reads.
                        let key = format!("{item}:{k}");
                        let into = self.target_of(device, key.clone(), own, format);
                        self.drawn.insert(item.clone(), key);
                        let (g0, g1, keep) =
                            runner.bind(&device.device, &f, own, &values, &refs, &srefs);
                        let within = self.within.get(&item).map(|&r| {
                            let at = |v: u32, of: u32, to: u32| {
                                (f64::from(v) * f64::from(to) / f64::from(of)).ceil() as u32
                            };
                            let (x, y) = (r[0] * own[0] / size[0], r[1] * own[1] / size[1]);
                            let w = at(r[0] + r[2], size[0], own[0]).min(own[0]) - x;
                            [x, y, w, at(r[1] + r[3], size[1], own[1]).min(own[1]) - y]
                        });
                        parts.push(Part::Draw(
                            runner.clone(),
                            (g0, g1),
                            keep,
                            into.clone(),
                            within,
                        ));
                        let blit = (own != size).then(|| {
                            let full = self.target(device, format!("{item}:{k}:full"), size);
                            self.blit_rec(device, &into, full, size)
                        });
                        let shown = blit.as_ref().map_or_else(|| into.clone(), |b| b.to.clone());
                        passes.insert(item.clone(), shown.clone());
                        cur = Some(shown);
                        if let Some(b) = blit {
                            parts.push(Part::Blit(b));
                        }
                    }
                }
                if drew == Drew::Operator {
                    recs.push(Rec { mark, parts });
                }
            }
            for (m, _) in &op_members {
                rows.push(Row {
                    item: m.clone(),
                    resolution: if drew == Drew::Operator { res } else { 0.0 },
                    drew,
                });
            }
        }
        (rows, recs, cur)
    }
}
