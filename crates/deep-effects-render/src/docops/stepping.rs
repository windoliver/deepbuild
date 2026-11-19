use super::*;

impl DocOps {
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
                .and_then(|c| match &c.prev {
                    Held::Buffer(b) => Some(b.clone()),
                    Held::Texture(_) => None,
                }),
            _ => None,
        }
    }

    /// The texture a stepped operator's texture input binds (#1993): a carried output as the
    /// previous step left it, or one a stepped operator wrote earlier in the step.
    fn texture_in(&self, from: &From) -> Option<wgpu::TextureView> {
        let tex = match from {
            From::Previous { op, output } => self
                .stepping
                .as_ref()?
                .carried
                .iter()
                .find(|c| c.item == *op && c.output == *output)
                .and_then(|c| match &c.prev {
                    Held::Texture(t) => Some(t),
                    Held::Buffer(_) => None,
                })?,
            From::Target { op, output } => &self.textures.get(&(op.clone(), output.clone()))?.tex,
            _ => return None,
        };
        Some(tex.create_view(&Default::default()))
    }

    /// After a lost device (#1993): the carried state, built again on the device that replaced
    /// it, is stepped from the start across the frames that follow.
    pub fn rebuild_after_loss(&mut self) {
        if let Some(st) = self.stepping.as_mut() {
            st.rebuilding = true;
        }
    }

    /// Whether the last frame planned drew before the carried state reached its step (#1993):
    /// the frame reports settling.
    pub fn settling(&self) -> bool {
        self.stepping.as_ref().is_some_and(|st| st.behind)
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
        let shown = if self.hooks.steps_per_frame {
            st.at.map_or(0, |a| a + 1)
        } else {
            (t * rate + 1e-6).floor().max(0.0) as u64
        };
        // After a lost device the state is stepped again from the start, REBUILD steps a frame,
        // and a frame drawn before it reaches the frame's step reports settling (#1993).
        if st.rebuilding && self.hooks.restore_from_clear {
            st.at = shown.checked_sub(1);
            st.rebuilding = false;
        }
        let reach = st.at.map_or(REBUILD - 1, |a| a + REBUILD);
        st.rebuilding &= reach < shown;
        let target = if st.rebuilding { reach } else { shown };
        st.behind = st.rebuilding;
        let mut parts = Vec::new();
        let kern = (!self.textures.is_empty()).then(|| self.kernels(device));
        let current = |c: &Carried| {
            let key = (c.item.clone(), c.output.clone());
            match self.textures.get(&key) {
                Some(t) => Held::Texture(t.tex.clone()),
                None => Held::Buffer(self.storage[&key].clone()),
            }
        };
        // An output set back to zeros: a buffer cleared, a texture filled (#1993).
        let zeroed = |key: &(String, String)| match (self.textures.get(key), &kern) {
            (Some(t), Some(k)) => {
                Part::StepFill(Arc::new(k.2.fill(d, &t.tex, &t.out.format, [0.0; 4])))
            }
            _ => Part::StepClear(self.storage[key].clone()),
        };
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
                    parts.push(b.copy_to(&current(c)));
                }
                st.at = Some(s);
                st.restored = Some((s, target - s));
            }
            _ if behind => {
                for c in &st.carried {
                    parts.push(zeroed(&(c.item.clone(), c.output.clone())));
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
                parts.push(current(c).copy_to(&c.prev));
            }
            // What a channel input reads is its value at the step's own time (#1993), so an input
            // track's entry lands on one step however the frames fall.
            let at_step = (self.program.is_some() && !self.hooks.live_inputs)
                .then(|| self.channel_values(step as f64 / rate));
            for &k in &order {
                let op = &self.ops[k];
                let runner = op.runner.clone().expect("built");
                let c = &runner.compiled.checked;
                // Storage it doesn't carry starts each step at its declared clear value, and a
                // texture it doesn't carry at zeros (#1993).
                for (n, _) in c.op.textures.iter().filter(|(_, t)| t.carry.is_none()) {
                    parts.push(zeroed(&(op.item.clone(), n.clone())));
                }
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
                let mut values = interp::inputs(c, at_step.as_ref().unwrap_or(params), roles);
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
                let Some(read) = c
                    .textures
                    .iter()
                    .map(|n| self.texture_in(&c.op.inputs[n].from))
                    .collect::<Option<Vec<wgpu::TextureView>>>()
                else {
                    continue;
                };
                let written: Vec<wgpu::TextureView> =
                    c.op.textures
                        .keys()
                        .map(|n| {
                            self.textures[&(op.item.clone(), n.clone())]
                                .tex
                                .create_view(&wgpu::TextureViewDescriptor {
                                    base_mip_level: 0,
                                    mip_level_count: Some(1),
                                    ..Default::default()
                                })
                        })
                        .collect();
                let (g0, g1, keep) = runner.bind_with(
                    d,
                    &f,
                    [1, 1],
                    &values,
                    &read.iter().collect::<Vec<_>>(),
                    &all,
                    &written.iter().collect::<Vec<_>>(),
                );
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
            let alternate = self.hooks.alternate_checkpoints;
            for (k, c) in st.carried.iter_mut().enumerate() {
                // The planted ring copies every second output a step late, under the others' step.
                let Some(step) = step.checked_sub(u64::from(alternate && k % 2 == 1)) else {
                    continue;
                };
                let due = if every_one {
                    step % u64::from(c.carry.every) == 0
                } else {
                    step % c.spacing == 0 && c.bytes <= c.carry.budget
                };
                if !due || c.ring.iter().any(|(s, _)| *s == step) {
                    continue;
                }
                let state = current(c);
                let b = state.like(d, "carried checkpoint");
                taken.push(state.copy_to(&b));
                let at = c.ring.partition_point(|(s, _)| *s < step);
                c.ring.insert(at, (step, b));
            }
            if !every_one {
                thin_together(&mut st.carried);
            }
            parts.extend(taken);
        }
        if let Some(st) = self.stepping.as_mut() {
            st.at = Some(target.max(st.at.unwrap_or(0)));
        }
        parts
    }
}
