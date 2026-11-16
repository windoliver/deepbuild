use super::*;

impl Program {
    /// Whether constraint `k` is a `look_at` whose aim has no heading.
    pub(super) fn aims_nowhere(&self, k: usize, slots: &[f64]) -> bool {
        let c = &self.constraints[k];
        let (doc::Kind::LookAt { .. }, Some((i, group))) =
            (&self.motion.constraints[k].kind, c.other)
        else {
            return false;
        };
        let other = match group {
            None => pose(&self.world(slots, i), 0),
            Some(_) => pose(slots, i * TRANSFORM),
        };
        crate::constraint::aimless(&pose(slots, c.owner * TRANSFORM), other.pos)
    }

    /// Channel `c`'s first component's rate per second at `doc_t`, a remapped item's by its
    /// remaps' derivatives.
    pub(super) fn channel_rate(&self, c: usize, doc_t: i64) -> f64 {
        let channel = &self.motion.channels[c];
        let motion = &self.motion;
        let start = motion.transport.start;
        let shown = self
            .quantize
            .map_or(doc_t, |rate| crate::eval::grid(doc_t, rate));
        let mut t = shown;
        let mut scale = 1.0;
        for r in motion
            .remaps
            .iter()
            .filter(|r| motion.applies(r, &channel.target.owner))
        {
            scale *= r.rate(t - start);
            t = start + r.child(t - start);
        }
        let mut out = [0.0; 4];
        let width = self.channels[c].1.min(4);
        channel.rate(t, &mut out[..width]);
        out[0] * scale
    }

    /// Placement `p`'s first target's rate per second, per clip channel: the segment's derivative
    /// times the placement's rate times the remap's derivative.
    pub fn placement_rates(&self, p: usize, doc_t: i64) -> Vec<(String, Vec<f64>)> {
        let placement = &self.motion.placements[p];
        let Some(clip) = self.motion.clip(&placement.clip) else {
            return Vec::new();
        };
        let at = self.timeline(doc_t);
        let delay = placement.bindings.first().map_or(0, |b| b.delay);
        let (local, scale) = match placement.local_after(&self.motion, at, delay) {
            Some(l) => (l.local, placement.rate_after(&self.motion, at, delay)),
            None => (0, 0.0),
        };
        clip.channels
            .iter()
            .map(|c| {
                let mut out = vec![0.0; c.curve.keys.first().map_or(1, |k| k.value.len())];
                c.rate(local, &mut out);
                out.iter_mut().for_each(|v| *v *= scale);
                (c.id.clone(), out)
            })
            .collect()
    }

    /// Placement `p`'s weight at timeline position `at`, in its run from `start`: its influence by
    /// its switch and its fades.
    pub(super) fn weight(&self, p: usize, start: i64, at: i64) -> f64 {
        let placement = &self.motion.placements[p];
        let b = &placement.blending;
        let influence = match &b.influence {
            doc::Influence::Value(v) => *v,
            doc::Influence::Keys(curve) => {
                let mut v = [0.0];
                curve.sample_into(at, &mut v);
                v[0]
            }
            doc::Influence::Control(control) => {
                let last = self
                    .options
                    .input
                    .iter()
                    .filter(|e| e.control == *control && e.t <= at)
                    .max_by_key(|e| e.key());
                last.and_then(|e| e.value.as_f64()).unwrap_or_else(|| {
                    self.motion
                        .control_defaults
                        .iter()
                        .find(|(id, _)| id == control)
                        .map_or(0.0, |c| c.1)
                })
            }
        };
        let influence = b
            .switch
            .as_ref()
            .map_or(influence, |s| influence * s.weight(at));
        if b.fade_in == 0 && b.fade_out == 0 {
            return influence;
        }
        let end = start + placement.active_span(&self.motion);
        let ramp = |d: i64, span: i64| {
            if span == 0 {
                1.0
            } else {
                (d as f64 / span as f64).clamp(0.0, 1.0)
            }
        };
        influence * ramp(at - start, b.fade_in) * ramp(end - at, b.fade_out)
    }

    /// The item a slot belongs to: its transform's, or the field's item.
    pub(super) fn item_of(&self, slot: usize) -> String {
        if slot < self.items.len() * TRANSFORM {
            return self.items[slot / TRANSFORM].clone();
        }
        if let Some(a) = self
            .assemblies
            .iter()
            .find(|a| (a.slot..a.slot + 2).contains(&slot))
        {
            return format!("assemblies/{}", a.id);
        }
        self.fields
            .iter()
            .find(|f| (f.slot..f.slot + f.width).contains(&slot))
            .and_then(|f| f.item)
            .map_or_else(String::new, |i| self.items[i].clone())
    }

    /// Constraint `k`'s reads and writes, as slots.
    pub(super) fn constraint_slots(&self, k: usize) -> (Vec<usize>, Vec<usize>) {
        use doc::Kind;
        let c = &self.constraints[k];
        let own = c.owner * TRANSFORM;
        let other = match c.other {
            Some((i, None)) => self.world_slots(i),
            Some((i, Some(g))) => groups(i * TRANSFORM, &[g]),
            None => Vec::new(),
        };
        let (reads, writes) = match &self.motion.constraints[k].kind {
            // #2013: solved at check outside the program, so no step of a frame reads or writes.
            Kind::RestOn { on: Some(_), .. } => (vec![], vec![]),
            Kind::ChildOf { .. } => (groups(own, &[0, 1, 2]), groups(own, &[0, 1, 2])),
            Kind::LookAt { .. } => (groups(own, &[0, 1]), groups(own, &[1])),
            Kind::Copy { what, .. } => (vec![], groups(own, &[what.group()])),
            Kind::Distance { .. } => (groups(own, &[0]), groups(own, &[0])),
            Kind::Reach2 { .. } => {
                let [lower, end] = c.chain.map(|i| i * TRANSFORM);
                (
                    [
                        groups(own, &[0, 1, 2]),
                        groups(lower, &[0, 1]),
                        groups(end, &[0]),
                    ]
                    .concat(),
                    [groups(own, &[1, 2]), groups(lower, &[1])].concat(),
                )
            }
            Kind::FollowPath { .. }
            | Kind::RestOn { .. }
            | Kind::SpringChain { .. }
            | Kind::FollowTip { .. } => (
                [
                    groups(own, &[0, 1]),
                    c.table.iter().filter_map(|t| t.from).collect(),
                ]
                .concat(),
                groups(own, &[0, 1]),
            ),
        };
        ([other, reads].concat(), writes)
    }

    /// The slots an item's world pose reads: its own nine and each ancestor's.
    pub(super) fn world_slots(&self, i: usize) -> Vec<usize> {
        let mut out = groups(i * TRANSFORM, &[0, 1, 2]);
        let mut at = i;
        while let Some(&(_, p)) = self.parents.iter().find(|(c, _)| *c == at) {
            out.extend(groups(p * TRANSFORM, &[0, 1, 2]));
            at = p;
        }
        out
    }

    /// Item `i`'s world pose from the slots: its own, under each ancestor's (child-of parenting).
    pub(super) fn world(&self, slots: &[f64], i: usize) -> [f64; TRANSFORM] {
        let mut out = [0.0; TRANSFORM];
        out.copy_from_slice(&slots[i * TRANSFORM..(i + 1) * TRANSFORM]);
        if let Some(&(_, p)) = self.parents.iter().find(|(c, _)| *c == i) {
            let parent = self.world(slots, p);
            let mut both = [0.0; 2 * TRANSFORM];
            both[..TRANSFORM].copy_from_slice(&parent);
            both[TRANSFORM..].copy_from_slice(&out);
            parent_to(&mut both, 1, 0);
            out.copy_from_slice(&both[TRANSFORM..]);
        }
        out
    }

    /// Orders every write per component (crate::schedule), refusing a loop with `cycle`
    /// naming its entries; `whole_items` is the planted scheduler that orders whole items.
    pub(crate) fn schedule(&mut self, whole_items: bool) -> Result<(), Refused> {
        use crate::schedule::{Node, Stage};
        let mut steps = Vec::new();
        let mut nodes = Vec::new();
        let mut push = |step: Step, node: Node| {
            steps.push(step);
            nodes.push(node);
        };
        // Mixes first on their paths, so replace, add and multiply apply over them.
        for (m, mix) in self.mixes.iter().enumerate() {
            let entry = format!("placements/{}", self.motion.placements[mix.members[0].0].id);
            push(
                Step::Mix(m),
                Node {
                    entry,
                    item: self.item_of(mix.slot),
                    stage: Stage::Channels,
                    reads: vec![],
                    writes: (mix.slot..mix.slot + mix.width).collect(),
                },
            );
        }
        for (c, &(slot, width)) in self.channels.iter().enumerate() {
            let entry = format!("channels/{}", self.motion.channels[c].id);
            push(
                Step::Channel(c),
                Node {
                    entry,
                    item: self.item_of(slot),
                    stage: Stage::Channels,
                    reads: vec![],
                    writes: (slot..slot + width).collect(),
                },
            );
        }
        // The other blends by writer layer, then order, then time: never by how the document
        // happens to list them.
        let mut ranked: Vec<usize> = (0..self.placements.len()).collect();
        ranked.sort_by_key(|&p| {
            let placement = &self.motion.placements[p];
            (&placement.rank, placement.start, &placement.id)
        });
        for p in ranked {
            let writes = &self.placements[p];
            if self.motion.placements[p].blending.blend == doc::Blend::Mix {
                continue;
            }
            for (w, write) in writes.iter().enumerate() {
                let entry = format!("placements/{}", self.motion.placements[p].id);
                let slots = (write.slot..write.slot + write.width.min(4)).collect();
                push(
                    Step::Write(p, w),
                    Node {
                        entry,
                        item: self.item_of(write.slot),
                        stage: Stage::Channels,
                        reads: vec![],
                        writes: slots,
                    },
                );
            }
        }
        for (d, (slot, ops)) in self.drivers.iter().enumerate() {
            let reads = ops
                .iter()
                .flat_map(|op| match op {
                    Op::Var(s) => vec![*s],
                    Op::World(i, _) => self.world_slots(*i),
                    Op::Core(c) => self.cores[*c]
                        .inputs
                        .iter()
                        .flat_map(|input| match input {
                            CoreInput::Slot(s) => vec![*s],
                            CoreInput::World(i, _) => self.world_slots(*i),
                            _ => vec![],
                        })
                        .collect(),
                    _ => vec![],
                })
                .collect();
            let entry = format!("drivers/{}", self.motion.drivers[d].id);
            push(
                Step::Driver(d),
                Node {
                    entry,
                    item: self.item_of(*slot),
                    stage: Stage::Driver,
                    reads,
                    writes: vec![*slot],
                },
            );
        }
        for (l, (first, _)) in self.limits.iter().enumerate() {
            let slots: Vec<usize> = (*first..first + 3).collect();
            let entry = format!("constraints/{}", self.motion.limits[l].id);
            push(
                Step::Limit(l),
                Node {
                    entry,
                    item: self.item_of(*first),
                    stage: Stage::Constraints,
                    reads: slots.clone(),
                    writes: slots,
                },
            );
        }
        for k in 0..self.constraints.len() {
            let (reads, writes) = self.constraint_slots(k);
            let entry = format!("constraints/{}", self.motion.constraints[k].id);
            let item = self.items[self.constraints[k].owner].clone();
            push(
                Step::Constraint(k),
                Node {
                    entry,
                    item,
                    stage: Stage::Constraints,
                    reads,
                    writes,
                },
            );
        }
        let order = crate::schedule::order(&nodes, whole_items).map_err(|cycle| Refused {
            code: "cycle",
            path: cycle
                .iter()
                .map(|&i| format!("{} ({})", nodes[i].entry, nodes[i].item))
                .collect::<Vec<_>>()
                .join(" → "),
            detail: None,
        })?;
        self.order = order.iter().map(|&i| steps[i]).collect();
        // The order by item and stage: an item's transform composes before its first
        // constraint, or after its last write when it has none.
        let mut names: Vec<String> = Vec::new();
        // Each item's last place in the order, found in one pass.
        let mut last: std::collections::BTreeMap<&str, usize> = Default::default();
        for (at, &i) in order.iter().enumerate() {
            last.insert(nodes[i].item.as_str(), at);
        }
        let mut composed = std::collections::BTreeSet::new();
        for (at, &i) in order.iter().enumerate() {
            let node = &nodes[i];
            if node.stage == Stage::Constraints && composed.insert(node.item.clone()) {
                names.push(format!("{}.transform", node.item));
            }
            names.push(format!("{}.{}", node.item, node.stage.name()));
            if last.get(node.item.as_str()) == Some(&at) && composed.insert(node.item.clone()) {
                names.push(format!("{}.transform", node.item));
            }
        }
        names.dedup();
        self.order_names = names;
        Ok(())
    }

    /// A driver past the six functions, compiled through the core's closed function list over
    /// its vars, its hard range checked against its bound.
    pub(super) fn core_driver(
        &self,
        doc: &Map<String, Value>,
        driver: &doc::Driver,
        vars: &[(&str, Var)],
        path: &str,
    ) -> Result<Core, Refused> {
        let mut scope = self.options.scope.clone();
        let controls = doc.get("controls").and_then(Value::as_object);
        let mut inputs_of: Vec<(&str, CoreInput)> = vars
            .iter()
            .map(|(n, v)| {
                (
                    *n,
                    match *v {
                        Var::Slot(s) => CoreInput::Slot(s),
                        Var::World(i, k) => CoreInput::World(i, k),
                    },
                )
            })
            .collect();
        let lists: Vec<&str> = driver
            .inputs
            .iter()
            .filter(|(_, i)| matches!(i, doc::DriverInput::List(_)))
            .map(|(n, _)| n.as_str())
            .collect();
        let refused = |code: &'static str, why: String| Refused {
            code,
            path: format!("{path}/expr"),
            detail: Some(Box::new(json!({"driver": driver.id, "why": why}))),
        };
        let frame_rate = doc
            .get("transport")
            .and_then(|t| t.get("frame_rate"))
            .and_then(Value::as_array)
            .and_then(|r| Some((r.first()?.as_u64()? as u32, r.get(1)?.as_u64()? as u32)))
            .unwrap_or_default();
        let time = deep_canvas::grammar::TimeContext {
            frame_rate,
            ..Default::default()
        };
        let (text, lagged) =
            crate::lag::rewrite(&driver.text, &time).map_err(|r| refused(r.code, r.why))?;
        let (text, found) =
            crate::occurrence::rewrite(&text, &lists).map_err(|r| refused(r.code, r.why))?;
        for f in &found {
            let Some((_, doc::DriverInput::List(filter))) =
                driver.inputs.iter().find(|(n, _)| *n == f.list)
            else {
                continue;
            };
            let fields: Vec<&str> = f.field.first().map(String::as_str).into_iter().collect();
            let entries = self
                .occurrences(filter, doc, &format!("drivers/{}", driver.id), &fields)?
                .ok_or_else(|| Refused {
                    code: "ref_unresolved",
                    path: format!("{path}/vars/{}/list", f.list),
                    detail: Some(Box::new(json!({"driver": driver.id, "list": filter.list}))),
                })?;
            // Occurrences read on the driver's clock, from the transport's start as `time` reads.
            let start = self.motion.transport.start;
            let entries = entries
                .into_iter()
                .map(|o| crate::occurrence::Occurrence {
                    t: o.t.saturating_sub(start),
                    end: o.end.saturating_sub(start),
                    ..o
                })
                .collect();
            // Inputs after t don't exist yet, so nothing looks ahead on a list they feed.
            if f.function == "next" && filter.list.starts_with("input.") {
                return Err(refused(
                    "look_ahead_on_input",
                    format!(
                        "drivers/{}: next({}) looks ahead on {}, which the input track feeds",
                        driver.id, f.list, filter.list
                    ),
                ));
            }
            let list =
                crate::occurrence::filtered(filter, entries).map_err(|r| refused(r.code, r.why))?;
            let read = crate::occurrence::read_of(f, &list).map_err(|r| refused(r.code, r.why))?;
            if read.needs_fallback() && driver.fallback.is_none() {
                return Err(refused("fallback_missing", format!("drivers/{}: {}({}) has no match before its first, so the driver needs a fallback", driver.id, f.function, f.list)));
            }
            inputs_of.push((f.name.as_str(), CoreInput::Occurrence(Arc::new(read))));
        }
        for (name, input) in &driver.inputs {
            let input = match input {
                doc::DriverInput::List(_) => continue,
                doc::DriverInput::Array(array) => {
                    // #497: a stepping module's array has no steps after t yet, as the input
                    // track has no entries after t, so a lag or smooth that looks ahead through it
                    // is refused; motion reads a logic output its host baked (#1183) and, of the
                    // other arrays, only a spectrum's bands (#503).
                    if lagged.iter().any(|l| l.var == *name && l.dt < 0) {
                        return Err(refused("look_ahead_on_array", format!("lag({name}) looks ahead through the array `{array}`, which a stepping module writes step by step")));
                    }
                    // #1183, #1164: a logic output its host baked, or one element of it.
                    if let Some(read) = doc
                        .get("arrays")
                        .and_then(|a| crate::array::Read::of_var(a, array))
                    {
                        inputs_of.push((name.as_str(), CoreInput::Array(Arc::new(read))));
                        continue;
                    }
                    let why = "motion's drivers read only a logic item's scalar f64 output or one element of an i32 or f64 one, baked into the document, or a spectrum's bands";
                    let detail = Some(Box::new(
                        json!({"driver": driver.id, "array": array, "why": why}),
                    ));
                    let read = crate::occurrence::band(doc, array, self.motion.transport.start);
                    CoreInput::Occurrence(Arc::new(read.ok_or(Refused {
                        code: "ref_unresolved",
                        path: format!("{path}/vars/{name}"),
                        detail,
                    })?))
                }
                doc::DriverInput::Time => CoreInput::Time,
                doc::DriverInput::Hover(key) => {
                    crate::hover::read(&self.motion.control_defaults, key)
                }
                doc::DriverInput::Rate(id) => {
                    let Some(c) = self.motion.channels.iter().position(|c| c.id == *id) else {
                        return Err(Refused {
                            code: "ref_unresolved",
                            path: format!("{path}/vars/{name}"),
                            detail: None,
                        });
                    };
                    CoreInput::Rate(c)
                }
                doc::DriverInput::Remap(id, progress) => {
                    let Some(r) = self.motion.remaps.iter().position(|r| r.id == *id) else {
                        return Err(Refused {
                            code: "ref_unresolved",
                            path: format!("{path}/vars/{name}"),
                            detail: None,
                        });
                    };
                    CoreInput::Remap(r, *progress)
                }
                doc::DriverInput::Control(id)
                    if let Some((entries, default, range)) = controls.and_then(|c| {
                        crate::present::choice_read(c.get(id)?, id, &self.options.input)
                    }) =>
                {
                    scope.maxes.insert(name.clone(), range.1);
                    CoreInput::Control {
                        entries,
                        ramps: Vec::new(),
                        default,
                        range,
                    }
                }
                doc::DriverInput::Control(id) => {
                    let c = controls.and_then(|c| c.get(id));
                    // #542: a scroll control's range is its `scroll.range`, in steps.
                    let range = c
                        .and_then(|c| c.get("range").or_else(|| c.pointer("/scroll/range")))
                        .and_then(Value::as_array);
                    let (Some(c), Some([lo, hi])) = (c, range.map(Vec::as_slice)) else {
                        return Err(Refused {
                            code: "ref_unresolved",
                            path: format!("{path}/vars/{name}"),
                            detail: None,
                        });
                    };
                    let (lo, hi) = (lo.as_f64().unwrap_or(0.0), hi.as_f64().unwrap_or(0.0));
                    // A range written high to low holds no value.
                    if lo > hi {
                        return Err(Refused {
                            code: "out_of_range",
                            path: format!("controls/{id}/range"),
                            detail: None,
                        });
                    }
                    scope.maxes.insert(name.clone(), hi);
                    let mut track: Vec<&Entry> = self
                        .options
                        .input
                        .iter()
                        .filter(|e| e.control == *id)
                        .collect();
                    track.sort_by_key(|e| e.key());
                    let entries: Vec<(i64, i64, f64)> = track
                        .into_iter()
                        .filter_map(|e| Some((e.t, e.seq, e.value.as_f64()?)))
                        .collect();
                    let ramps = self.ramps.iter().filter(|r| r.control == *id);
                    CoreInput::Control {
                        entries,
                        ramps: ramps.map(|r| (r.t, r.seq, r.end, r.to)).collect(),
                        default: c.get("default").and_then(Value::as_f64).unwrap_or(lo),
                        range: (lo, hi),
                    }
                }
            };
            inputs_of.push((name.as_str(), input));
        }
        for l in &lagged {
            let Some((_, input)) = inputs_of.iter().find(|(n, _)| *n == l.var) else {
                return Err(refused(
                    "ref_unresolved",
                    format!("lag reads `{}`, which is not one of its vars", l.var),
                ));
            };
            let input = match input {
                CoreInput::Control { .. } if l.dt < 0 => {
                    let id = driver.inputs.iter().find_map(|(n, i)| match i {
                        doc::DriverInput::Control(c) if *n == l.var => Some(c.as_str()),
                        _ => None,
                    });
                    return Err(refused("look_ahead_on_control", format!("lag({}) looks ahead through the control `{}`, which the input track feeds", l.var, id.unwrap_or_default())));
                }
                CoreInput::Slot(_) | CoreInput::Time | CoreInput::Control { .. } => input.clone(),
                _ => return Err(refused("lag_unsupported", format!("lag({}) reads a number, bound value, list or live simulation, which draws once", l.var))),
            };
            inputs_of.push((l.name.as_str(), CoreInput::Lag(Box::new(input), l.dt)));
        }
        if self.options.planted == Planted::TableFormSamples8 {
            scope.planted = Some(deep_canvas::expr::Planted::TableFormSamples8);
        }
        if self.options.planted == Planted::CellsSeededFromT {
            scope.planted = Some(deep_canvas::expr::Planted::CellsSeededFromT);
            if !inputs_of.iter().any(|(n, _)| *n == "t") {
                inputs_of.push(("t", CoreInput::Time));
            }
        }
        let expr = Expr::compile(&text, &scope, DRIVER_OPS).map_err(|r| Refused {
            code: "bad_doc",
            path: format!("{path}/expr"),
            detail: Some(Box::new(json!({"call": r.call, "why": r.why}))),
        })?;
        let mut inputs = Vec::new();
        for name in &expr.vars {
            let Some((_, input)) = inputs_of.iter().find(|(n, _)| n == name) else {
                return Err(Refused {
                    code: "ref_unresolved",
                    path: format!("{path}/expr"),
                    detail: Some(Box::new(json!({"name": name}))),
                });
            };
            inputs.push(input.clone());
        }
        let core = Core {
            expr: Arc::new(expr),
            inputs,
            fallback: driver.fallback,
        };
        if let Some((lo, hi)) = driver.range {
            let b = self.core_bound(&core);
            if !(b.lo >= lo && b.hi <= hi) {
                return Err(Refused {
                    code: "out_of_range",
                    path: format!(
                        "{path}: its bound [{}, {}] leaves the range [{lo}, {hi}]",
                        b.lo, b.hi
                    ),
                    detail: Some(Box::new(
                        json!({"driver": driver.id, "bound": [b.lo, b.hi]}),
                    )),
                });
            }
        }
        Ok(core)
    }

    /// A core driver's value over the slots at `doc_t`.
    pub(super) fn evaluate_core(
        &self,
        c: usize,
        slots: &[f64],
        doc_t: i64,
        t_run: i64,
        validity: Validity,
    ) -> f64 {
        let core = &self.cores[c];
        // The document's time from the transport's start, held to its span, the range its
        // bound reads.
        let transport = &self.motion.transport;
        let t = doc_t
            .saturating_sub(transport.start)
            .clamp(0, transport.span.unwrap_or(i64::MAX));
        let mut vals = [0.0f64; DRIVER_OPS];
        // Each time a lag reaches, evaluated once: the program again at t − dt, nothing kept.
        let mut earlier: Vec<(i64, State)> = Vec::new();
        for (v, input) in vals.iter_mut().zip(&core.inputs) {
            *v = match input {
                CoreInput::Lag(inner, dt) => match &**inner {
                    CoreInput::Slot(s) => {
                        let i = match earlier.iter().position(|e| e.0 == *dt) {
                            Some(i) => i,
                            None => {
                                let mut state = self.state();
                                state.nested = true;
                                self.run(t_run - dt, validity, &mut state, |_, _, _| {});
                                earlier.push((*dt, state));
                                earlier.len() - 1
                            }
                        };
                        earlier[i].1.slots[*s]
                    }
                    CoreInput::Time => {
                        let at = (doc_t - dt)
                            .saturating_sub(transport.start)
                            .clamp(0, transport.span.unwrap_or(i64::MAX));
                        at as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64
                    }
                    CoreInput::Control {
                        entries,
                        ramps,
                        default,
                        range,
                    } => control_at(entries, ramps, *default, t_run - dt).clamp(range.0, range.1),
                    _ => f64::NAN,
                },
                CoreInput::Array(read) => read.at(doc_t),
                CoreInput::Occurrence(read) => match read.at(t) {
                    Some(v) => v,
                    None => return core.fallback.unwrap_or(f64::NAN),
                },
                CoreInput::Slot(s) => slots[*s],
                CoreInput::World(i, k) => self.world(slots, *i)[*k],
                CoreInput::Time => t as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64,
                CoreInput::Rate(c) => self.channel_rate(*c, doc_t),
                CoreInput::Remap(r, progress) => {
                    let parent = self.remap_parent(*r, doc_t);
                    let remap = &self.motion.remaps[*r];
                    if *progress {
                        remap.progress(parent)
                    } else {
                        f64::from(u8::from(remap.active(parent)))
                    }
                }
                // A control's value, held to its declared range.
                CoreInput::Control {
                    entries,
                    ramps,
                    default,
                    range,
                } => control_at(entries, ramps, *default, t_run).clamp(range.0, range.1),
            };
        }
        let v = core.expr.eval_num(&vals[..core.inputs.len()]);
        match core.fallback {
            Some(fallback) if !v.is_finite() => fallback,
            _ => v,
        }
    }

    /// Each mark set whose `rows` read an occurrence list, its filter applied once.
    pub(super) fn occurrence_rows(
        &self,
        doc: &Map<String, Value>,
        items: &Map<String, Value>,
        controls: Option<&Map<String, Value>>,
    ) -> Result<Vec<crate::rows::RowList>, Refused> {
        let mut out = Vec::new();
        for (id, item) in items {
            if item.get("kind").and_then(Value::as_str) != Some("marks@1") {
                continue;
            }
            let Some(rows) = item.get("params").and_then(|p| p.get("rows")) else {
                continue;
            };
            let path = format!("items/{id}/params/rows");
            let bad = |code, at: &str| Refused {
                code,
                path: format!("{path}{at}"),
                detail: None,
            };
            let Some(rows) = rows.as_object() else {
                return Err(bad("bad_doc", ""));
            };
            let from = rows.get("from").and_then(Value::as_object);
            let filter = doc::filter_of(
                from.ok_or(bad("bad_doc", "/from"))?,
                &format!("{path}/from"),
            )?;
            // The payload fields its columns name.
            let fields: Vec<&str> = rows
                .get("columns")
                .and_then(Value::as_object)
                .into_iter()
                .flatten()
                .filter_map(|(_, c)| c.as_str())
                .collect();
            let entries = self
                .occurrences(&filter, doc, &format!("items/{id}"), &fields)?
                .ok_or(bad("ref_unresolved", "/from/list"))?;
            let list = crate::occurrence::filtered(&filter, entries).map_err(|r| Refused {
                code: r.code,
                path: format!("{path}/from: {}", r.why),
                detail: None,
            })?;
            let control = |name: &str| {
                let c = controls?.get(name)?;
                let default = c.get("default").and_then(Value::as_f64).unwrap_or(0.0);
                let entries = self.options.input.iter().filter(|e| e.control == name);
                Some((
                    entries
                        .filter_map(|e| Some((e.t, e.value.as_f64()?)))
                        .collect(),
                    default,
                ))
            };
            out.push(crate::rows::RowList::read(id, rows, list, control)?);
        }
        Ok(out)
    }

    /// The occurrences a list names: `markers.<kind>`, or `input.<control>`, the input track's
    /// entries for a control in the track's order, each a match whose payload is `{value,
    /// player}`, so a `where` can count one player's (#497).
    ///
    /// A logic item's `<logic ID>.occurrences` reads the rows its bake left in the document's
    /// `occurrences` (#544), after `reader`'s kinds and payload `fields` are checked against the
    /// item's `emits`: a name it doesn't declare is refused `occurrence.undeclared`, from the
    /// document alone, so before any step runs.
    pub(crate) fn occurrences(
        &self,
        filter: &crate::occurrence::Filter,
        doc: &Map<String, Value>,
        reader: &str,
        fields: &[&str],
    ) -> Result<Option<Vec<crate::occurrence::Occurrence>>, Refused> {
        use crate::occurrence::Occurrence;
        if let Some(emits) = logic_emits(doc, &filter.list) {
            if self.options.planted != Planted::AcceptsUndeclaredOccurrence {
                undeclared(&emits, filter, reader, fields)?;
            }
            let rows = doc
                .get("occurrences")
                .and_then(|o| o.get(&filter.list))
                .and_then(Value::as_array);
            let id = |r: &Value, k: &str| {
                r.get(k)
                    .map(|v| v.as_str().map_or_else(|| v.to_string(), str::to_string))
            };
            return Ok(Some(
                rows.into_iter()
                    .flatten()
                    .filter_map(|r| {
                        let kind = r.get("kind")?.as_str()?;
                        let declared = emits.get(kind)?.get("fields").and_then(Value::as_object);
                        let payload: Map<String, Value> = declared
                            .into_iter()
                            .flatten()
                            .filter_map(|(n, _)| Some((n.clone(), r.get(n)?.clone())))
                            .collect();
                        let t = r.get("t")?.as_i64()?;
                        Some(Occurrence {
                            t,
                            end: t,
                            a: id(r, "a"),
                            b: id(r, "b"),
                            kind: kind.to_string(),
                            tags: Vec::new(),
                            payload: Value::Object(payload),
                        })
                    })
                    .collect(),
            ));
        }
        // #1918: a world's rows come from its bake, through the column view.
        let world = self
            .world_of(&filter.list)
            .map(|_| crate::occurrence::baked(doc, &filter.list));
        Ok(world.or_else(|| self.listed(filter, doc.get("controls").and_then(Value::as_object))))
    }

    pub(super) fn listed(
        &self,
        filter: &crate::occurrence::Filter,
        controls: Option<&Map<String, Value>>,
    ) -> Option<Vec<crate::occurrence::Occurrence>> {
        use crate::occurrence::Occurrence;
        // A list names a marker kind or a declared control; any other would read empty forever.
        if let Some(kind) = filter.list.strip_prefix("markers.") {
            if !doc::MARKER_KINDS.contains(&kind) {
                return None;
            }
            return Some(
                self.motion
                    .markers
                    .iter()
                    .filter(|m| m.kind == kind)
                    .map(|m| Occurrence {
                        t: m.start,
                        end: m.end,
                        a: Some(m.id.clone()),
                        b: None,
                        kind: m.kind.clone(),
                        tags: m.tags.clone(),
                        payload: m.payload.clone(),
                    })
                    .collect(),
            );
        }
        let control = filter.list.strip_prefix("input.")?;
        if !controls.is_some_and(|c| c.contains_key(control)) {
            return None;
        }
        let mut entries: Vec<&Entry> = self
            .options
            .input
            .iter()
            .filter(|e| e.control == control)
            .collect();
        entries.sort_by_key(|e| e.key());
        Some(
            entries
                .into_iter()
                .map(|e| Occurrence {
                    t: e.t,
                    end: e.t,
                    a: None,
                    b: None,
                    kind: "input".into(),
                    tags: Vec::new(),
                    payload: json!({"value": e.value, "player": e.player}),
                })
                .collect(),
        )
    }

    /// A core driver's bound from its interval form: time over the span, each control over its
    /// declared range (Control sweep), each slot a channel writes over that channel's bound.
    pub(super) fn core_bound(&self, core: &Core) -> Iv {
        let span = self.motion.transport.span.map_or(f64::INFINITY, |s| {
            s as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64
        });
        self.core_bound_in(core, Iv::new(0.0, span))
    }

    /// #493: what slot `s` holds over the document times `time` (seconds), from its writer's
    /// interval form: a core driver's over that time, a lone channel's whole bound, or the base
    /// where nothing writes it; `None` where no form bounds it (another writer, or a channel the
    /// forms don't settle). A driver's form may be unbounded there: a pole the caller refuses.
    pub fn slot_bound_over(&self, s: usize, time: Iv) -> Option<Iv> {
        if let Some((_, ops)) = self.drivers.iter().rev().find(|(slot, _)| *slot == s) {
            return match ops.as_slice() {
                [Op::Core(i)] => Some(self.core_bound_in(&self.cores[*i], time)),
                _ => None,
            };
        }
        (!self.writes(s..s + 1)).then(|| Iv::point(self.base[s]))
    }

    /// #405: whether channels alone write slot `s` (keys over time, with no driver, follow,
    /// placement, limit or constraint), so at one time it holds one value whatever a control is.
    pub fn time_only(&self, s: usize) -> bool {
        !(self.follows.contains(&s)
            || self.staggered.iter().any(|x| x.slot == s)
            || self
                .placements
                .iter()
                .flatten()
                .any(|w| (w.slot..w.slot + w.width).contains(&s))
            || self.drivers.iter().any(|(slot, _)| *slot == s)
            || self
                .limits
                .iter()
                .any(|(first, _)| (*first..first + 3).contains(&s))
            || (0..self.constraints.len()).any(|k| self.constraint_slots(k).1.contains(&s)))
    }

    /// #405: what slot `s` holds over the flicks `[a, b]`, given its values at both ends: a
    /// driver's bound over that time, a lone channel's window, or the base where nothing writes
    /// it; `None` where no form bounds it.
    pub fn slot_window(&self, s: usize, a: i64, b: i64, at_a: f64, at_b: f64) -> Option<Iv> {
        // #504: a take-apart share, the hull of its ends inside one move of its follow.
        if let Some(x) = self.staggered.iter().find(|x| x.slot == s) {
            return x
                .follow
                .window(a, b, at_a, at_b)
                .map(|iv| iv.meet(Iv::new(0.0, 1.0)));
        }
        let lone: Vec<usize> = (0..self.channels.len())
            .filter(|&c| (self.channels[c].0..self.channels[c].0 + self.channels[c].1).contains(&s))
            .collect();
        // A window reads a channel's first component, so only a one-wide channel has one.
        if let ([c], true) = (lone.as_slice(), self.time_only(s)) {
            if self.channels[*c].1 != 1 {
                return None;
            }
            let ch = &self.motion.channels[*c];
            return channel_bound(ch).map(|_| channel_window(ch, a, b, at_a, at_b));
        }
        let f = deep_canvas::grammar::FLICKS_PER_SECOND as f64;
        self.slot_bound_over(s, Iv::new(a as f64 / f, b as f64 / f))
    }

    /// #493: the key times of the channels that write slot `s`, where a channel's monotone
    /// segments reach their extremes.
    pub fn slot_key_times(&self, s: usize) -> Vec<i64> {
        self.channels
            .iter()
            .zip(&self.motion.channels)
            .filter(|((slot, width), _)| (*slot..slot + width).contains(&s))
            .flat_map(|(_, c)| c.curve.keys.iter().map(|k| k.t))
            .collect()
    }

    /// A core driver's bound with time over `time`.
    pub(super) fn core_bound_in(&self, core: &Core, time: Iv) -> Iv {
        let span = self.motion.transport.span.map_or(f64::INFINITY, |s| {
            s as f64 / deep_canvas::grammar::FLICKS_PER_SECOND as f64
        });
        let f = deep_canvas::grammar::FLICKS_PER_SECOND as f64;
        let vars: Vec<Iv> = core
            .inputs
            .iter()
            .map(|input| match input {
                CoreInput::Time => time,
                CoreInput::Control {
                    entries,
                    ramps,
                    default,
                    range,
                } => self.control_in((entries, ramps), *default, *range, time, span),
                CoreInput::Slot(s) => self.slot_bound(*s),
                CoreInput::World(..) | CoreInput::Rate(_) => Iv::ENTIRE,
                CoreInput::Remap(..) => Iv::new(0.0, 1.0),
                CoreInput::Occurrence(read) => read.bound(span),
                CoreInput::Array(read) => read.bound(),
                CoreInput::Lag(inner, dt) => match &**inner {
                    CoreInput::Slot(s) => self.slot_bound(*s),
                    CoreInput::Control {
                        entries,
                        ramps,
                        default,
                        range,
                    } => {
                        let back = *dt as f64 / f;
                        self.control_in(
                            (entries, ramps),
                            *default,
                            *range,
                            Iv::new(time.lo - back, time.hi - back),
                            span,
                        )
                    }
                    _ => Iv::new(0.0, span),
                },
            })
            .collect();
        let b = core.expr.bound_num(&vars);
        match core.fallback {
            Some(f) => Iv::new(b.lo.min(f), b.hi.max(f)),
            None => b,
        }
    }

    /// #504: a control's value over the document times `time` (seconds; `span` the document's):
    /// inside a window, with entries on the track, the hull of its value as the window opens and
    /// each entry inside it, so a replayed sweep is bounded between its entries; over the whole
    /// document (the hard-range check's) or with no entries, its declared range. The window is
    /// widened by a flick each way, past the rounding of its seconds.
    pub(super) fn control_in(
        &self,
        (entries, ramps): (&Entries, &Ramps),
        default: f64,
        range: (f64, f64),
        time: Iv,
        span: f64,
    ) -> Iv {
        let whole = time.lo <= 0.0 && time.hi >= span;
        if entries.is_empty() || whole || self.options.planted == Planted::ReplayBoundsWholeRange {
            return Iv::new(range.0, range.1);
        }
        let f = deep_canvas::grammar::FLICKS_PER_SECOND as f64;
        let start = self.motion.transport.start as f64;
        // A window reaching the document's ends reaches what the clock reads past them.
        let lo = if time.lo <= 0.0 {
            f64::NEG_INFINITY
        } else {
            (start + time.lo * f).floor() - 1.0
        };
        let hi = if time.hi >= span {
            f64::INFINITY
        } else {
            (start + time.hi * f).ceil() + 1.0
        };
        let i = entries.partition_point(|e| (e.0 as f64) < lo);
        let open = i.checked_sub(1).map_or(default, |i| entries[i].2);
        let held = |v: f64| Iv::point(v.clamp(range.0, range.1));
        let stepped = entries[i..]
            .iter()
            .take_while(|e| e.0 as f64 <= hi)
            .fold(held(open), |b, e| b.hull(held(e.2)));
        // #903: a ramp under way in the window may reach its end's value.
        let under_way = |r: &&(i64, i64, i64, f64)| r.0 as f64 <= hi && r.2 as f64 >= lo;
        let reached = ramps.iter().filter(under_way);
        reached.fold(stepped, |b, r| b.hull(held(r.3)))
    }

    /// The bound of what slot `s` holds: its base value when nothing writes it, a channel's
    /// bound when one channel writes it, otherwise unbounded.
    pub(super) fn slot_bound(&self, s: usize) -> Iv {
        let by: Vec<usize> = (0..self.channels.len())
            .filter(|&c| {
                let (slot, width) = self.channels[c];
                (slot..slot + width).contains(&s)
            })
            .collect();
        // Any write but the channels' (a placement's clip, a follow, a driver, a constraint)
        // leaves the slot unbounded here.
        let others = self.follows.contains(&s)
            || self.staggered.iter().any(|x| x.slot == s)
            || self
                .placements
                .iter()
                .flatten()
                .any(|w| (w.slot..w.slot + w.width).contains(&s))
            || self.drivers.iter().any(|(slot, _)| *slot == s)
            || self
                .limits
                .iter()
                .any(|(first, _)| (*first..first + 3).contains(&s))
            || (0..self.constraints.len()).any(|k| self.constraint_slots(k).1.contains(&s));
        match by.as_slice() {
            [] if !self.writes(s..s + 1) => Iv::point(self.base[s]),
            [c] if !others => channel_bound(&self.motion.channels[*c])
                .map_or(Iv::ENTIRE, |(lo, hi)| Iv::new(lo, hi)),
            _ => Iv::ENTIRE,
        }
    }

    /// Each channel's and each driver's bound (`None` where the forms don't settle it), the
    /// bound the hard-range check reads.
    pub fn bounds(&self) -> (Bounds, Bounds) {
        let channels = self
            .motion
            .channels
            .iter()
            .map(|c| (c.id.clone(), channel_bound(c)))
            .collect();
        let drivers = self
            .motion
            .drivers
            .iter()
            .zip(&self.drivers)
            .map(|(d, (_, ops))| {
                let b = match ops.as_slice() {
                    [Op::Core(i)] => Some(self.core_bound(&self.cores[*i])),
                    _ => None,
                };
                (d.id.clone(), b.filter(Iv::is_bounded).map(|b| (b.lo, b.hi)))
            })
            .collect();
        (channels, drivers)
    }

    /// Runs constraint `k` on the slots, mixing what it writes by its influence.
    pub(super) fn constrain(&self, k: usize, slots: &mut [f64]) -> (u64, f64) {
        use crate::constraint as cs;
        use doc::Kind;
        let c = &self.constraints[k];
        let spec = &self.motion.constraints[k];
        let own_at = c.owner * TRANSFORM;
        let own = pose(slots, own_at);
        let other = match c.other {
            Some((i, None)) => pose(&self.world(slots, i), 0),
            Some((i, Some(_))) => pose(slots, i * TRANSFORM),
            None => own,
        };
        let mut ops = cs::Ops::default();
        let mut extra: Option<(usize, f64)> = None;
        let mut stretch = f64::NAN;
        let solved = match &spec.kind {
            Kind::ChildOf { .. } => cs::child_of(&other, &own, &mut ops),
            Kind::LookAt { .. } => cs::look_at(&own, other.pos, &mut ops),
            Kind::Copy { what, .. } => cs::copy(&own, *what, &other, &mut ops),
            Kind::Distance { min, max, .. } => cs::distance(&own, other.pos, *min, *max, &mut ops),
            Kind::FollowPath {
                fraction,
                orient,
                offset,
                ..
            } => match &c.table {
                Some(read) => cs::follow_path(
                    &own,
                    &read.table,
                    read.fraction(fraction, slots),
                    *orient,
                    *offset,
                    &mut ops,
                ),
                None => own,
            },
            Kind::FollowTip { offset, rotate, .. } => cs::follow_tip(
                &own,
                [other.pos[0], other.pos[1]],
                other.rot[2],
                *offset,
                *rotate,
                &mut ops,
            ),
            Kind::RestOn {
                ground,
                bottom,
                offset,
                max_drop,
                on: None,
            } => cs::rest_on(&own, *bottom, *ground, *offset, *max_drop, &mut ops).unwrap_or(own),
            // #2013: a rest on true shapes is solved at check by the module that holds them.
            Kind::RestOn { on: Some(_), .. } => own,
            Kind::SpringChain { .. } => own,
            Kind::Reach2 { bend, cartoon, .. } => {
                let [lower, end] = c.chain.map(|i| pose(slots, i * TRANSFORM));
                let length = |p: &cs::Pose| deep_canvas::ops::hypot(p.pos[0], p.pos[1]);
                let r = cs::reach2(
                    [own.pos[0], own.pos[1]],
                    [length(&lower), length(&end)],
                    [other.pos[0], other.pos[1]],
                    *bend,
                    *cartoon,
                    &mut ops,
                );
                // The lower bone's turn is its own, after the upper bone's.
                extra = Some((c.chain[0] * TRANSFORM + 5, r.lower - r.upper));
                stretch = r.stretch;
                let mut out = own;
                out.rot[2] = r.upper;
                out.scale = [r.stretch, r.stretch, own.scale[2] * r.stretch];
                out
            }
        };
        let w = spec.influence;
        let (_, writes) = self.constraint_slots(k);
        let after = [solved.pos, solved.rot, solved.scale].concat();
        for s in writes
            .iter()
            .filter(|s| (own_at..own_at + TRANSFORM).contains(s))
        {
            let v = after[s - own_at];
            slots[*s] += w * (v - slots[*s]);
        }
        if let Some((slot, v)) = extra {
            slots[slot] += w * (v - slots[slot]);
        }
        (ops.0, stretch)
    }
}
