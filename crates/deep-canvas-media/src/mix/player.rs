use super::*;

impl Player {
    pub fn new(mix: Arc<Mix>, planted: Planted) -> Player {
        Player::built(mix, planted, false)
    }

    /// #509: a player that keeps each bus's power bake from sample 0 as it renders: one entry per
    /// bus, then one for the strips that play straight on the master.
    pub fn tapped(mix: Arc<Mix>, planted: Planted) -> Player {
        Player::built(mix, planted, true)
    }

    /// The power bakes [`Player::tapped`] keeps.
    pub fn power(&self) -> Option<&[crate::analysis::loudness::Power]> {
        self.power.as_deref()
    }

    /// Each bus's ID, and the index of the bus its output feeds.
    pub fn routes(&self) -> Vec<(String, Option<usize>)> {
        self.mix
            .buses
            .iter()
            .map(|b| (b.id.clone(), b.out))
            .collect()
    }

    pub(super) fn built(mix: Arc<Mix>, planted: Planted, tapped: bool) -> Player {
        let mut units = Vec::new();
        let mut rings = Vec::new();
        for (b, p) in mix.processors() {
            units.push((
                b,
                p.id.clone(),
                p.every.max(1),
                Unit::new(&p.kind, mix.rate, &planted),
            ));
            rings.push(Ring::new(
                p.budget.unwrap_or(RING_BUDGET),
                planted.ring_drops_oldest,
            ));
        }
        let n = 2 * BLOCK as usize;
        let (mix_buses, rate) = (mix.buses.len(), mix.rate);
        let synths = mix
            .strips
            .iter()
            .enumerate()
            .filter_map(|(i, s)| {
                s.synth.as_ref().map(|sp| {
                    (
                        i,
                        crate::synth::play::Live::new(
                            sp,
                            mix.rate,
                            planted.synth_ring_drops_oldest,
                        ),
                    )
                })
            })
            .collect();
        let synth_taps = mix
            .strips
            .iter()
            .filter_map(|s| s.synth.as_ref().map(|sp| (s, sp)))
            .map(|(s, sp)| {
                sp.preset
                    .nodes
                    .iter()
                    .map(|n| (format!("{}/{}", s.id, n.id), sha2::Sha256::default()))
                    .collect()
            })
            .collect();
        let edges = Edges::new(&mix, &planted);
        let lead = edges.lead;
        let mut p = Player {
            outs: vec![vec![0.0; n]; units.len()],
            taps: units.iter().map(|_| sha2::Sha256::default()).collect(),
            buses: vec![vec![0.0; n]; mix.buses.len()],
            lines: edges.lengths.iter().map(|l| Line::new(*l)).collect(),
            end: Limiter::new(
                LimiterSpec::default(),
                mix.rate,
                planted.limiter_sample_peaks,
            ),
            end_spec: LimiterSpec::default(),
            own: Ring::new(RING_BUDGET, planted.ring_drops_oldest),
            edges,
            mix,
            units,
            rings,
            block: 0,
            buf: vec![0.0; n],
            pre: vec![0.0; n],
            edge: vec![0.0; n],
            read: n,
            planted,
            synth_taps,
            synths,
            clock: None,
            around: vec![0.0; n],
            delivery: 1.0,
            power: tapped.then(|| {
                (0..=mix_buses)
                    .map(|_| crate::analysis::loudness::Power::new(rate, 2))
                    .collect()
            }),
            added: Vec::new(),
        };
        p.seek_graph(lead);
        p.take_taps();
        p.end.cut = false;
        p
    }

    /// Fills `out` (interleaved stereo) from the current position, adding each processor's output
    /// over the same samples to its tap.
    pub fn read(&mut self, out: &mut [f32]) {
        use sha2::Digest;
        let mut at = 0;
        while at < out.len() {
            if self.read >= self.buf.len() {
                self.render_block();
            }
            let n = (self.buf.len() - self.read).min(out.len() - at);
            out[at..at + n].copy_from_slice(&self.buf[self.read..self.read + n]);
            for (tap, o) in self.taps.iter_mut().zip(&self.outs) {
                for x in &o[self.read..self.read + n] {
                    tap.update(x.to_le_bytes());
                }
            }
            for (taps, (_, live)) in self.synth_taps.iter_mut().zip(&self.synths) {
                for ((_, tap), o) in taps.iter_mut().zip(&live.nodes) {
                    for x in &o[self.read / 2..(self.read + n) / 2] {
                        tap.update(x.to_le_bytes());
                    }
                }
            }
            self.read += n;
            at += n;
        }
    }

    /// #525: the strips a live play has added so far, in place of those it added before; a strip
    /// sounds only in blocks rendered after it is added.
    pub fn set_added(&mut self, strips: Vec<Strip>) {
        self.added = strips;
    }

    /// #525: how far past the sample read next the graph has rendered, at most, in samples: a
    /// strip must be added before the play reads within this of its start.
    pub fn ahead(&self) -> i64 {
        self.edges.lead + BLOCK
    }

    /// #157: sets the master's end limiter to an export's ceiling, dBTP (a profile's
    /// `limiter_ceiling`), in place of the limiter's default; like `delivery`, before the export
    /// seeks.
    pub fn set_ceiling(&mut self, dbtp: f64) {
        self.end_spec.ceiling = dbtp;
        self.end = Limiter::new(
            self.end_spec,
            self.mix.rate,
            self.planted.limiter_sample_peaks,
        );
    }

    /// #502: whether the master's end limiter has cut since the last seek.
    pub fn limited(&self) -> bool {
        self.end.cut
    }

    /// Each processor's ID and the SHA-256 of its output read since the last call.
    pub fn take_taps(&mut self) -> Vec<(String, String)> {
        use sha2::Digest;
        let hex = |t: &mut sha2::Sha256| {
            let d = std::mem::take(t).finalize();
            d.iter().map(|b| format!("{b:02x}")).collect::<String>()
        };
        let ids = self.units.iter().map(|u| u.1.clone());
        let mut out: Vec<(String, String)> = ids.zip(self.taps.iter_mut().map(hex)).collect();
        for (id, t) in self.synth_taps.iter_mut().flatten() {
            out.push((id.clone(), hex(t)));
        }
        out
    }

    /// Moves to `sample`: restores the latest checkpoint at or before it that every processor's
    /// ring holds, renders forward from there and returns what each processor did.
    pub fn seek(&mut self, sample: i64) -> Vec<(String, Sought)> {
        let sought = self.seek_graph(sample + self.edges.lead);
        self.end.cut = false;
        // #204: the planted grid starts at the seek, each synth reading its params that far off it.
        let shift = if self.planted.synth_grid_at_seek {
            (sample + self.edges.lead).rem_euclid(BLOCK) * self.mix.step()
        } else {
            0
        };
        for (_, live) in &mut self.synths {
            live.shift = shift;
        }
        sought
    }

    /// Moves the graph, which runs `lead` samples ahead of what is heard, to `sample`.
    pub(super) fn seek_graph(&mut self, sample: i64) -> Vec<(String, Sought)> {
        let target = sample.div_euclid(BLOCK);
        // Each ring's latest checkpoint at or before the seek; the earliest of those is where
        // the chain can restore together (the rings' grids nest, so the others hold it too).
        let own = self.own.at_or_before(target * BLOCK).map(|(slot, _)| slot);
        let best: Option<Vec<i64>> = self
            .rings
            .iter()
            .zip(&self.units)
            .map(|(r, u)| r.at_or_before(target * BLOCK).map(|(slot, _)| slot * u.2))
            .chain(std::iter::once(own))
            .chain(
                self.synths
                    .iter()
                    .map(|(_, l)| l.ring.at_or_before(target * BLOCK).map(|(slot, _)| slot)),
            )
            .collect();
        let second = best.and_then(|b| b.into_iter().min()).filter(|s| {
            self.own.get(*s).is_some()
                && self
                    .rings
                    .iter()
                    .zip(&self.units)
                    .all(|(r, u)| s % u.2 == 0 && r.get(s / u.2).is_some())
                && self.synths.iter().all(|(_, l)| l.ring.get(*s).is_some())
        });
        let rate = self.mix.rate;
        let from_block = match second {
            Some(s) => {
                for ((_, _, every, unit), ring) in self.units.iter_mut().zip(&self.rings) {
                    if let Some(st) = ring.get(s / *every) {
                        unit.set(st, &self.planted);
                    }
                }
                if let Some(o) = self.own.get(s) {
                    self.lines.clone_from(&o.lines);
                    self.end.state.clone_from(&o.end);
                }
                for (_, live) in &mut self.synths {
                    if let Some(st) = live.ring.get(s).cloned() {
                        live.restore(&st);
                    }
                }
                (s * rate).div_euclid(BLOCK) + i64::from((s * rate).rem_euclid(BLOCK) != 0)
            }
            None => {
                let mix = self.mix.clone();
                for (u, (_, p)) in self.units.iter_mut().zip(mix.processors()) {
                    u.3 = Unit::new(&p.kind, rate, &self.planted);
                }
                self.lines = self.edges.lengths.iter().map(|l| Line::new(*l)).collect();
                self.end = Limiter::new(self.end_spec, rate, self.planted.limiter_sample_peaks);
                for (i, live) in &mut self.synths {
                    if let Some(sp) = &mix.strips[*i].synth {
                        live.reset(sp, rate);
                    }
                }
                0
            }
        };
        self.block = from_block;
        // #1163: a jump pre-rolls its tails; the planted reverb starts it without its tail, as it
        // restores a checkpoint without one, at the block where the first sample heard leaves
        // the reverb (every path is held back `lead` samples after it).
        let tailless = target > from_block && self.planted.restores_without_tail;
        let heard = (sample - self.edges.lead).div_euclid(BLOCK).max(from_block);
        while self.block <= target {
            if tailless && self.block == heard {
                for (.., unit) in &mut self.units {
                    if let Unit::Reverb(r) = unit {
                        r.state = r.state.without_tail();
                    }
                }
            }
            self.render_block();
        }
        self.read = 2 * (sample - target * BLOCK) as usize;
        let sought = Sought {
            restored: second.map(|s| s * FLICKS),
            rendered_from: second.unwrap_or(0) * FLICKS,
        };
        let synths = self
            .synths
            .iter()
            .map(|(i, _)| (self.mix.strips[*i].id.clone(), sought));
        self.units
            .iter()
            .map(|u| (u.1.clone(), sought))
            .chain(synths)
            .collect()
    }

    /// Each processor's report.
    pub fn reports(&self) -> Vec<Report> {
        let rate = self.mix.rate;
        self.units
            .iter()
            .zip(&self.rings)
            .zip(self.mix.processors())
            .map(|(((_, id, every, unit), ring), (_, p))| Report {
                id: id.clone(),
                kind: p.kind.name(),
                tail: unit.tail(&p.kind, rate),
                latency: p.kind.latency(rate),
                budget: ring.budget(),
                bytes: ring.bytes(),
                peak: ring.peak(),
                spacing: ring.every() * every * FLICKS,
                checkpoints: ring
                    .kept()
                    .into_iter()
                    .map(|(slot, b)| (slot * every * FLICKS, b))
                    .collect(),
            })
            .collect()
    }

    /// #204: each synth strip's report: its preset, voices, derived tail, ring, and the host clock's
    /// reading of what its voices took to render.
    pub fn synth_reports(&self) -> Vec<SynthReport> {
        self.synths
            .iter()
            .filter_map(|(i, live)| {
                let s = &self.mix.strips[*i];
                let sp = s.synth.as_ref()?;
                Some(SynthReport {
                    id: s.id.clone(),
                    preset: sp.name.clone(),
                    voices: sp.keys.len(),
                    tail: sp.tail,
                    spent: live.spent,
                    ring: Report {
                        id: s.id.clone(),
                        kind: "synth",
                        tail: sp.tail,
                        latency: 0,
                        budget: live.ring.budget(),
                        bytes: live.ring.bytes(),
                        peak: live.ring.peak(),
                        spacing: live.ring.every() * FLICKS,
                        checkpoints: live
                            .ring
                            .kept()
                            .into_iter()
                            .map(|(slot, b)| (slot * FLICKS, b))
                            .collect(),
                    },
                })
            })
            .collect()
    }

    /// #204: renders forward from where it is to graph sample `to` without output, filling the
    /// checkpoint rings (a synth's bake at check).
    pub fn bake(&mut self, to: i64) {
        while self.block * BLOCK < to {
            self.render_block();
        }
    }

    /// The whole second whose checkpoint block `k` is, if any: the first block boundary at or
    /// after each whole second.
    pub(super) fn second_of(&self, k: i64) -> Option<i64> {
        let rate = self.mix.rate;
        let s = (k * BLOCK).div_euclid(rate);
        (k == 0 || s * rate > (k - 1) * BLOCK).then_some(s)
    }

    pub(super) fn render_block(&mut self) {
        let k = self.block;
        if let Some(s) = self.second_of(k) {
            for ((_, _, every, unit), ring) in self.units.iter().zip(self.rings.iter_mut()) {
                if s % every == 0 && ring.wants(s / every) {
                    let st = unit.state();
                    let bytes = st.bytes();
                    ring.put(s / every, k * BLOCK, st, bytes);
                }
            }
            if self.own.wants(s) {
                let st = Own {
                    lines: self.lines.clone(),
                    end: self.end.state.clone(),
                };
                let bytes = st.bytes();
                self.own.put(s, k * BLOCK, st, bytes);
            }
            for (_, live) in &mut self.synths {
                if live.ring.wants(s) {
                    let st = live.checkpoint();
                    let bytes = st.bytes();
                    live.ring.put(s, k * BLOCK, st, bytes);
                }
            }
        }
        let mix = self.mix.clone();
        let step = mix.step();
        for b in &mut self.buses {
            b.iter_mut().for_each(|x| *x = 0.0);
        }
        self.around.iter_mut().for_each(|x| *x = 0.0);
        let added = std::mem::take(&mut self.added);
        let mut live_at = 0;
        for (si, s) in mix.strips.iter().chain(&added).enumerate() {
            // A bus's strips arrive as late as its latest input.
            let t0 = (k * BLOCK - self.edges.strips[s.bus]) * step;
            // A synth's voices are the mix's own strips'; a strip added live (#525) plays none.
            let synth = match &s.synth {
                Some(sp) if si < mix.strips.len() => {
                    while self.synths[live_at].0 != si {
                        live_at += 1;
                    }
                    Some((sp, live_at))
                }
                _ => None,
            };
            if s.start + s.span <= t0 || s.start >= t0 + BLOCK * step {
                if let Some((_, l)) = synth {
                    self.synths[l].1.silent();
                }
                continue;
            }
            if let Some((sp, l)) = synth {
                // The planted steal takes on the stolen voice's filters as it starts.
                if let (false, Some(victim)) = (self.synths[l].1.started, sp.inherits) {
                    if let Some(v) = self.synths.iter().position(|(i, _)| *i == victim) {
                        let (a, b) = if v < l {
                            let (x, y) = self.synths.split_at_mut(l);
                            (&mut y[0].1, &x[v].1)
                        } else {
                            let (x, y) = self.synths.split_at_mut(v);
                            (&mut x[l].1, &y[0].1)
                        };
                        if let (Some(a), Some(b)) = (a.voices.first_mut(), b.voices.first()) {
                            a.keep_filters_of(b);
                        }
                    }
                }
                let part = self.planted.synth_block_64.then_some(64);
                let before = self.clock.as_ref().map(|c| c());
                self.synths[l].1.block(sp, t0, step, s.start, part);
                if let (Some(c), Some(t)) = (&self.clock, before) {
                    self.synths[l].1.spent += c().saturating_sub(t);
                }
            }
            let fades = s.fade_lengths();
            let (eg0, eg1, pan) = match &s.emitter {
                Some(e) => {
                    let (g0, p0) = self.emit_gain(e, t0);
                    let (g1, p1) = self.emit_gain(e, t0 + BLOCK * step);
                    (g0, g1, (p0, p1))
                }
                None => (1.0, 1.0, (s.pan, s.pan)),
            };
            let mono = s.source.channels == 1 || synth.is_some();
            let out = if synth.is_some() && self.planted.synth_around_master {
                &mut self.around
            } else {
                &mut self.buses[s.bus]
            };
            for i in 0..BLOCK {
                let t = t0 + i * step;
                let gain_t = if self.planted.holds_gain_per_block {
                    t0
                } else {
                    t
                };
                let env = s.envelope(t, gain_t, fades);
                if env == 0.0 {
                    continue;
                }
                let x = i as f64 / BLOCK as f64;
                let g = env * (eg0 + (eg1 - eg0) * x);
                let p = pan.0 + (pan.1 - pan.0) * x;
                let (l, r) = match synth {
                    Some((_, li)) => {
                        let x = self.synths[li].1.out[i as usize] as f32;
                        (x, x)
                    }
                    None => s.source.read(s.source_at(t - s.start)),
                };
                let (gl, gr) = if mono || s.emitter.is_some() {
                    let (pl, pr) = emitter::pan_gains(p);
                    let m = if mono { l } else { (l + r) * 0.5 };
                    ((m as f64 * pl * g) as f32, (m as f64 * pr * g) as f32)
                } else {
                    let (a, b) = balance(l, r, p);
                    ((a as f64 * g) as f32, (b as f64 * g) as f32)
                };
                out[2 * i as usize] += gl;
                out[2 * i as usize + 1] += gr;
            }
        }
        self.added = added;
        if let Some(power) = self.power.as_mut() {
            let at = k * BLOCK - self.edges.strips[mix.master];
            power[mix.buses.len()].push(at, &self.buses[mix.master]);
        }
        for &b in &mix.order {
            let bus = &mix.buses[b];
            let mut block = std::mem::take(&mut self.buses[b]);
            for (u, ((ub, _, _, unit), o)) in
                self.units.iter_mut().zip(self.outs.iter_mut()).enumerate()
            {
                if *ub != b {
                    continue;
                }
                match self.edges.keys[u] {
                    Some((kb, l)) => {
                        self.edge.copy_from_slice(&self.buses[kb]);
                        self.lines[l].pass(&mut self.edge);
                        unit.process(&mut block, Some(&self.edge));
                    }
                    None => unit.process(&mut block, None),
                }
                o.copy_from_slice(&block);
            }
            if bus.sends.iter().any(|s| s.pre) {
                self.pre.copy_from_slice(&block);
            }
            let g = if bus.mute { 0.0 } else { amp(bus.gain_db) };
            // A sample's duck is read at the time of the sound it scales: its place in the
            // graph less the bus's latency.
            let t0 = (k * BLOCK - mix.latency[b]) * step;
            for (i, f) in block.as_chunks_mut::<2>().0.iter_mut().enumerate() {
                let (l, r) = balance(f[0], f[1], bus.pan);
                let g = match &bus.duck {
                    Some(d) => g * d.at(t0 + i as i64 * step),
                    None => g,
                };
                f[0] = (l as f64 * g) as f32;
                f[1] = (r as f64 * g) as f32;
            }
            if let Some(o) = bus.out {
                match self.edges.out[b] {
                    Some(l) => {
                        self.edge.copy_from_slice(&block);
                        self.lines[l].pass(&mut self.edge);
                        for (d, x) in self.buses[o].iter_mut().zip(&self.edge) {
                            *d += x;
                        }
                    }
                    None => {
                        for (d, x) in self.buses[o].iter_mut().zip(&block) {
                            *d += x;
                        }
                    }
                }
            }
            for (send, &l) in bus.sends.iter().zip(&self.edges.sends[b]) {
                let tap = if send.pre && !self.planted.sends_tap_post {
                    &self.pre
                } else {
                    &block
                };
                let g = amp(send.gain_db);
                for (e, x) in self.edge.iter_mut().zip(tap) {
                    *e = (f64::from(*x) * g) as f32;
                }
                self.lines[l].pass(&mut self.edge);
                for (d, x) in self.buses[send.to].iter_mut().zip(&self.edge) {
                    *d += x;
                }
            }
            if let Some(power) = self.power.as_mut() {
                power[b].push(k * BLOCK - mix.latency[b], &block);
            }
            self.buses[b] = block;
        }
        // The master ends in its true-peak limiter, after its gain and pan.
        self.buf.copy_from_slice(&self.buses[mix.master]);
        if self.delivery != 1.0 {
            for x in &mut self.buf {
                *x = (f64::from(*x) * self.delivery) as f32;
            }
        }
        self.end.process(&mut self.buf);
        if self.planted.synth_around_master {
            for (o, x) in self.buf.iter_mut().zip(&self.around) {
                *o += x;
            }
        }
        self.read = 0;
        self.block = k + 1;
    }

    /// An emitter's gain and pan at `t`.
    pub(super) fn emit_gain(&self, e: &Emit, t: i64) -> (f64, f64) {
        let p = (e.place)(t);
        let d = [
            p.source[0] - p.listener[0],
            p.source[1] - p.listener[1],
            p.source[2] - p.listener[2],
        ];
        let dist = ops::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        let model = if self.planted.inverse_only {
            Model::Inverse
        } else {
            e.distance.model
        };
        let g = emitter::distance_gain(&e.distance, dist, model)
            * emitter::cone_gain(
                &e.cone,
                p.forward,
                p.source,
                p.listener,
                self.planted.cone_reversed,
            );
        // W3C PannerNode's equal-power azimuth: in the listener's horizontal plane, a source behind
        // pans as its mirror in front, and the pan is azimuth ÷ 90°.
        let ahead = [p.right[2], 0.0, -p.right[0]];
        let x = d[0] * p.right[0] + d[2] * p.right[2];
        let z = d[0] * ahead[0] + d[2] * ahead[2];
        let pan = if x == 0.0 && z == 0.0 {
            0.0
        } else {
            let az = ops::deg(ops::atan2(x, z));
            let az = if az > 90.0 {
                180.0 - az
            } else if az < -90.0 {
                -180.0 - az
            } else {
                az
            };
            az / 90.0
        };
        (g, pan)
    }
}
