use super::*;

/// A pass's params as its graph reads them in a group (Pack: fx@1 named operators): each param
/// in px, given or defaulted, scaled to the target's px, so a px is a px at design size at every
/// scale; and `bounds`, the group's own bounds as a uv rect of the target, which a graph that
/// places a centre, a pivot or an edge measures from, never from the frame.
fn placed(
    stage: &Value,
    given: &Map<String, Value>,
    bounds: [f64; 4],
    zoom: f64,
    size: [u32; 2],
    wrong: Option<(Planted, &str, Clock)>,
) -> BTreeMap<String, Value> {
    let mut params: BTreeMap<String, Value> = given.clone().into_iter().collect();
    // `--planted`: a blur that reads its radius as px of the scaled target, a twirl that measures
    // from the frame, and a slice_shift whose step is one video frame, so the frame number seeds it.
    let (zoom, bounds) = match wrong {
        Some((Planted::BlurRadiusInDevicePx, "blur@1", _)) => (1.0, bounds),
        Some((Planted::TwirlCenterFromFrameOrigin, "fx.twirl@1", _)) => {
            (zoom, [0.0, 0.0, f64::from(size[0]), f64::from(size[1])])
        }
        _ => (zoom, bounds),
    };
    if let Some((Planted::SliceShiftSeededByFrame, "fx.slice_shift@1", clock)) = wrong {
        let (n, d) = clock.frame_rate;
        params.insert(
            "step".into(),
            json!((FLICKS * f64::from(d) / f64::from(n)).round()),
        );
    }
    let scaled = |v: &Value| match v {
        Value::Array(a) => Value::Array(a.iter().map(|x| json!(num(x) * zoom)).collect()),
        v => json!(num(v) * zoom),
    };
    for (name, input) in stage["inputs"].as_object().into_iter().flatten() {
        let Some(param) = input["from"]["param"].as_str() else {
            continue;
        };
        if input["unit"] == "px" {
            // A channel's value is already a number here: the params are the pass's at t.
            if let Some(v) = given.get(param).or(input.get("default")) {
                params.insert(param.to_string(), scaled(v));
            }
        }
        if name == "bounds" && param == "bounds" {
            let (w, h) = (f64::from(size[0]), f64::from(size[1]));
            let [x, y, bw, bh] = bounds;
            params.insert(param.into(), json!([x / w, y / h, bw / w, bh / h]));
        }
    }
    params
}

fn num(v: &Value) -> f64 {
    v.as_f64().unwrap_or(0.0)
}

/// How a group's pass is written: onto a half-float target, rounded to the nearest half float.
fn emit() -> EmitOptions {
    EmitOptions {
        nearest_half: true,
        ..EmitOptions::default()
    }
}

/// `--planted`: `graph` as one of #161's wrong programs writes it, for the operator it names.
/// Each adds steps after the shipped graph's own and takes the color from them.
fn wrong(planted: Option<Planted>, op: &str, graph: &mut Value) {
    let (steps, color): (Value, &str) = match (planted, op) {
        // Inverts the premultiplied values and keeps the alpha, at every texel.
        (Some(Planted::InvertOnPremultiplied), "fx.invert@1") => (
            json!({"w_flip": {"op": "mul@1", "args": {"a": "w_c", "b": [-1.0, -1.0, -1.0, 1.0]}},
                "w_out": {"op": "add@1", "args": {"a": "w_flip", "b": [1.0, 1.0, 1.0, 0.0]}}}),
            "w_out",
        ),
        // The same, but only where the alpha is under 1/16; the shipped operator elsewhere.
        (Some(Planted::InvertWithoutAlphaGuard), "fx.invert@1") => (
            json!({"w_flip": {"op": "mul@1", "args": {"a": "w_c", "b": [-1.0, -1.0, -1.0, 1.0]}},
                "w_bare": {"op": "add@1", "args": {"a": "w_flip", "b": [1.0, 1.0, 1.0, 0.0]}},
                "w_a": {"op": "split@1", "args": {"x": "w_c", "pick": "a"}},
                "w_low": {"op": "lt@1", "args": {"a": "w_a", "b": 0.0625}},
                "w_out": {"op": "select@1", "args": {"f": graph["outputs"]["color"], "t": "w_bare", "cond": "w_low"}}}),
            "w_out",
        ),
        // A keyed texel keeps its rgb and takes the keyed alpha.
        (Some(Planted::KeyKeepsColorAtAlpha0), "fx.linear_color_key@1") => (
            json!({"w_rgb": {"op": "split@1", "args": {"x": "w_c", "pick": "rgb"}},
                "w_a": {"op": "split@1", "args": {"x": graph["outputs"]["color"], "pick": "a"}},
                "w_out": {"op": "compose@1", "args": {"x": "w_rgb", "y": "w_a"}}}),
            "w_out",
        ),
        _ => return,
    };
    let own = &mut graph["steps"];
    own["w_uv"] = json!({"op": "screen_uv@1"});
    own["w_c"] = json!({"op": "sample@1", "args": {"tex": "src", "uv": "w_uv", "lod": 0.0}});
    for (id, step) in steps.as_object().into_iter().flatten() {
        own[id] = step.clone();
    }
    graph["outputs"]["color"] = json!(color);
    // The added steps cost more than the shipped graph declares.
    graph["cost"]["ns_per_px"] = json!(num(&graph["cost"]["ns_per_px"]) * 4.0);
}

impl Groups {
    /// A group's passes on `color`, in the space its layer composites in.
    pub(super) fn passes(
        &mut self,
        x: &mut Run<'_>,
        group: &str,
        e: &Effect,
        bounds: [f64; 4],
        color: &wgpu::TextureView,
    ) -> Result<(wgpu::TextureView, f64), Value> {
        let other = matches!(
            (x.planted, x.space),
            (Some(Planted::PassLinearIn2d), Space::Encoded)
                | (Some(Planted::PassEncodedIn3d), Space::Linear)
        );
        if other {
            self.in_other_space(x, group, e, bounds, color)
        } else {
            self.run_passes(x, group, e, bounds, color)
        }
    }

    /// A group's passes in order on `color`, each on the last one's result, each within the
    /// group's bounds grown by the grows so far: the result and the whole grow.
    fn run_passes(
        &mut self,
        x: &mut Run<'_>,
        group: &str,
        e: &Effect,
        bounds: [f64; 4],
        color: &wgpu::TextureView,
    ) -> Result<(wgpu::TextureView, f64), Value> {
        let mut items = Map::new();
        let mut scales = BTreeMap::new();
        let mut params = BTreeMap::new();
        let mut within = BTreeMap::new();
        let mut grow = 0.0;
        let mut collections = BTreeMap::new();
        // The target's px per u: a pass's px are px at design size (Pack: fx@1 named operators).
        let zoom = x.options.zoom;
        let device_bounds = bounds.map(|v| v * zoom);
        for (i, p) in e.passes.iter().enumerate() {
            let at = format!("items/{group}/params/passes/{i}/op");
            let mut graph = pass_graph(&p.op, p.item.as_ref(), &p.params, x.packs)
                .map_err(|code| refused(code, &at))?;
            grow += p.grow.unwrap_or(graph.grow);
            self.ran.push(p.op.clone());
            graph
                .stages
                .iter_mut()
                .for_each(|g| wrong(x.planted, &p.op, g));
            let clock = x.clock;
            let plant = x.planted.map(|w| (w, p.op.as_str(), clock));
            for (j, stage) in graph.stages.iter().enumerate() {
                compile_with(stage, &BTreeMap::new(), emit())
                    .map_err(|issues| refused(issues[0].code, &at))?;
                for read in target_reads(stage) {
                    let view = self.target_of(x, &read)?;
                    let key = (format!("{COLLECTION}{}", read.collection), read.output);
                    collections.insert(key, view);
                }
                let id = format!("{group}#pass{i}.{j}");
                scales.insert(id.clone(), scale_of(stage));
                let own = placed(stage, &p.params, device_bounds, zoom, x.size, plant);
                params.insert(id.clone(), own);
                if x.planted != Some(Planted::GroupPassPastGrow) {
                    within.insert(id.clone(), px(device_bounds, grow * zoom, x.size));
                }
                items.insert(id, json!({"kind": "gpu.pass@1", "params": stage}));
            }
        }
        // Operators read a filterable target.
        let input = self.take(x.device, x.size, LINEAR);
        let mix = Mix {
            mode: REPLACE,
            ..Mix::over(color, x.size)
        };
        self.composite(x.device, &input, mix, x.size);
        let color = &input.create_view(&Default::default());
        let doc = json!({"seed": x.clock.seed, "items": items});
        let key = doc.to_string();
        let device = x.device;
        let stale = self.ops.get(group).is_none_or(|(k, _)| *k != key);
        if stale {
            let ops = DocOps::new(device, &doc, emit(), Default::default(), &[]);
            self.ops.insert(group.to_string(), (key, ops));
        }
        let (_, ops) = self.ops.get_mut(group).expect("built above");
        ops.params = params;
        ops.within = within;
        ops.collections = collections;
        let frame = Frame {
            t: (x.clock.t as f64 / FLICKS) as f32,
            ..Frame::default()
        };
        let resolution = |item: &str| scales.get(item).copied().unwrap_or(0.5);
        let (_, recs, shown) = ops.plan(
            device,
            color,
            None,
            None,
            x.size,
            &frame,
            x.roles,
            &resolution,
            x.canonical,
        );
        let mut encoder = device.device.create_command_encoder(&Default::default());
        let mut times = Profiled::new(None);
        for r in &recs {
            r.record(&mut encoder, &mut times);
        }
        device.queue.submit([encoder.finish()]);
        let shown = shown.unwrap_or_else(|| color.clone());
        deep_gpu::spans::done_with(&shown);
        Ok((shown, grow))
    }

    /// `--planted`: [`Groups::passes`] in the other space, each way by the compositor's own
    /// two conversions.
    fn in_other_space(
        &mut self,
        x: &mut Run<'_>,
        group: &str,
        e: &Effect,
        bounds: [f64; 4],
        color: &wgpu::TextureView,
    ) -> Result<(wgpu::TextureView, f64), Value> {
        let d = &x.device.device;
        let (size, device) = (x.size, x.device);
        let encoded = |this: &mut Groups, from: &wgpu::TextureView| {
            let t = target(d, size, ACC);
            let mut encoder = d.create_command_encoder(&Default::default());
            let v = t.create_view(&Default::default());
            this.resolve(d, &mut encoder, from, &v, ACC, Space::Linear);
            device.queue.submit([encoder.finish()]);
            v
        };
        let decoded = |this: &mut Groups, from: &wgpu::TextureView| {
            let t = target(d, size, ACC);
            let mix = Mix {
                decode: true,
                ..Mix::over(from, size)
            };
            this.composite(device, &t, mix, size);
            t.create_view(&Default::default())
        };
        let linear_in_2d = x.space == Space::Encoded;
        let there = if linear_in_2d {
            decoded(self, color)
        } else {
            encoded(self, color)
        };
        let (passed, grow) = self.run_passes(x, group, e, bounds, &there)?;
        let back = if linear_in_2d {
            encoded(self, &passed)
        } else {
            decoded(self, &passed)
        };
        Ok((back, grow))
    }
}
