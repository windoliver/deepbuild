//! The mix (canvas primitives: Strip and track, Bus, Processor, Emitter): strips on tracks summed
//! into buses per 128-sample block in topological order, a bus's processors run in order, and the
//! processors' state checkpointed on a grid so a seek restores a checkpoint and renders forward:
//! seek equals play bit for bit on one build and architecture. Gain is a-rate, evaluated per
//! sample from the sample's own time, so a strip that starts mid-block starts at its exact sample.
//! The same player feeds the live transport and an export, so the live mix is the export's.
//!
//! #1818: buses send to buses and a compressor reads a key bus, both edges of the order; each
//! bus delays its inputs to the latest of their latencies, the master ends in a true-peak
//! limiter after its gain and pan, and the player renders ahead by the master's latency, so a
//! strip at t is heard at t.

use std::sync::Arc;

use deep_canvas::ops;

use crate::delay::{Delay, DelaySpec, DelayState, Pitch, PitchSpec, PitchState};
use crate::dynamics::{
    Compressor, CompressorSpec, CompressorState, Limiter, LimiterSpec, LimiterState,
};
use crate::emitter::{self, Cone, Distance, Model};
use crate::eq;
use crate::reverb::{self, Reverb};
use crate::ring::Ring;
use crate::shape::{
    Crush, CrushSpec, CrushState, Modulate, ModulateSpec, ModulateState, Shaper, ShaperSpec,
};
use crate::FLICKS;

/// One audio block (canvas primitives: Blocks).
pub const BLOCK: i64 = 128;
/// The shortest fade a strip that starts or stops inside its source gets: 5 ms.
pub const MIN_FADE: i64 = FLICKS / 200;

/// A decoded asset: interleaved f32 frames at `rate`.
pub struct Source {
    pub rate: i64,
    pub channels: usize,
    pub samples: Vec<f32>,
    /// The asset's loop points, in source flicks.
    pub loop_region: Option<(i64, i64)>,
}

impl Source {
    pub fn frames(&self) -> i64 {
        (self.samples.len() / self.channels.max(1)) as i64
    }

    /// The source's length in flicks.
    pub fn duration(&self) -> i64 {
        (self.frames() as i128 * FLICKS as i128 / self.rate.max(1) as i128) as i64
    }

    fn frame(&self, i: i64) -> (f32, f32) {
        if i < 0 || i >= self.frames() {
            return (0.0, 0.0);
        }
        let at = i as usize * self.channels;
        match self.channels {
            1 => (self.samples[at], self.samples[at]),
            _ => (self.samples[at], self.samples[at + 1]),
        }
    }

    /// The source at `src` flicks, linearly interpolated between its frames.
    fn read(&self, src: i64) -> (f32, f32) {
        let p = src as i128 * self.rate as i128;
        let i = p.div_euclid(FLICKS as i128) as i64;
        let frac = p.rem_euclid(FLICKS as i128);
        let a = self.frame(i);
        if frac == 0 {
            return a;
        }
        let b = self.frame(i + 1);
        let f = (frac as f64 / FLICKS as f64) as f32;
        (a.0 + (b.0 - a.0) * f, a.1 + (b.1 - a.1) * f)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Curve {
    Linear,
    EqualPower,
    Exp,
}

impl Curve {
    /// The fade-in gain at progress `x` in [0, 1].
    pub fn rise(self, x: f64) -> f64 {
        let x = x.clamp(0.0, 1.0);
        match self {
            Curve::Linear => x,
            Curve::EqualPower => ops::sin(x * ops::PI / 2.0),
            Curve::Exp => x * x,
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct Fade {
    pub length: i64,
    pub curve: Curve,
}

#[derive(Clone, Debug)]
pub enum Gain {
    Db(f64),
    /// Keys (flicks of t, dB, linear to the next): the left key owns its segment, linear in
    /// amplitude or held; held before the first key and after the last; −∞ dB is silence.
    Keys(Vec<(i64, f64, bool)>),
}

pub fn amp(db: f64) -> f64 {
    if db == f64::NEG_INFINITY {
        0.0
    } else {
        ops::pow(10.0, db / 20.0)
    }
}

impl Gain {
    fn at(&self, t: i64) -> f64 {
        match self {
            Gain::Db(db) => amp(*db),
            Gain::Keys(keys) => {
                let k = keys.partition_point(|(kt, _, _)| *kt <= t);
                match (k.checked_sub(1).map(|i| keys[i]), keys.get(k)) {
                    (None, Some(b)) => amp(b.1),
                    (Some(a), None) => amp(a.1),
                    (Some(a), Some(b)) if a.2 => {
                        let x = (t - a.0) as f64 / (b.0 - a.0).max(1) as f64;
                        amp(a.1) + (amp(b.1) - amp(a.1)) * x
                    }
                    (Some(a), Some(_)) => amp(a.1),
                    (None, None) => 1.0,
                }
            }
        }
    }
}

/// Where an emitter's item and the listener (the camera) are at t.
#[derive(Clone, Copy, Debug)]
pub struct Place {
    pub source: [f64; 3],
    pub forward: [f64; 3],
    pub listener: [f64; 3],
    /// The listener's right, for the pan.
    pub right: [f64; 3],
}

#[derive(Clone)]
pub struct Emit {
    pub id: String,
    pub distance: Distance,
    pub cone: Cone,
    pub place: Arc<dyn Fn(i64) -> Place + Send + Sync>,
}

#[derive(Clone)]
pub struct Strip {
    pub id: String,
    pub source: Arc<Source>,
    pub start: i64,
    pub r#in: i64,
    pub out: i64,
    pub rate: (i64, i64),
    /// #155: a ramp from `rate` at the strip's start (a tape stop or start).
    pub ramp: Option<Ramp>,
    pub gain: Gain,
    pub pan: f64,
    pub fade_in: Option<Fade>,
    pub fade_out: Option<Fade>,
    pub looped: bool,
    /// How long it plays, resolved (auto already applied).
    pub span: i64,
    pub bus: usize,
    /// Spans of t where `enabled` is false.
    pub disabled: Vec<(i64, i64)>,
    pub emitter: Option<Emit>,
    /// #204: a synth plays in place of the source (its span already holds the synth's tail).
    pub synth: Option<Arc<crate::synth::play::Spec>>,
}

/// #155: a strip's rate ramp (Strip and track: generator sources and rate ramps): from the
/// strip's rate at its start to `to` over `over` flicks, linear or exponential in the rate, and
/// `to` after. The source time is the exact integral of the rate, so a seek reads what a play
/// does, and the read resamples per sample, so pitch follows as tape's does.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Ramp {
    pub to: (i64, i64),
    pub over: i64,
    pub exp: bool,
}

impl Ramp {
    /// The source flicks travelled `rel` flicks in from rate `from`: ∫ rate over [0, rel],
    /// floored. Linear: r₀u + (r₁ − r₀)u² ÷ 2T for u ≤ T, in exact rationals; exp:
    /// r₀T(k^(u ÷ T) − 1) ÷ ln k with k = r₁ ÷ r₀; then r₁ a flick past T.
    pub fn travel(&self, from: (i64, i64), rel: i64) -> i128 {
        let (a, b) = (from.0 as i128, from.1.max(1) as i128);
        let (c, d) = (self.to.0 as i128, self.to.1.max(1) as i128);
        let t = self.over.max(1) as i128;
        let rel = rel as i128;
        let u = rel.clamp(0, t);
        let after = (rel - t).max(0);
        if rel < 0 {
            return (rel * a).div_euclid(b);
        }
        if !self.exp || a * d == c * b {
            // [2adTu + (cb − ad)u² + 2bcT·after] ÷ 2bdT
            let num = 2 * a * d * t * u + (c * b - a * d) * u * u + 2 * b * c * t * after;
            return num.div_euclid(2 * b * d * t);
        }
        let (r0, r1) = (a as f64 / b as f64, c as f64 / d as f64);
        let k = r1 / r0;
        let ramped = r0 * t as f64 * (ops::pow(k, u as f64 / t as f64) - 1.0) / ops::log(k);
        (ramped + r1 * after as f64).floor() as i128
    }

    /// How long a strip of `length` source flicks plays: until the ramp has read it all, or
    /// to the ramp's end when it stops (rate 0) first.
    pub fn span(&self, from: (i64, i64), length: i64) -> i64 {
        let length = length.max(0) as i128;
        if self.travel(from, self.over) >= length {
            let (mut lo, mut hi) = (0i64, self.over);
            while lo < hi {
                let mid = lo + (hi - lo) / 2;
                if self.travel(from, mid) >= length {
                    hi = mid;
                } else {
                    lo = mid + 1;
                }
            }
            return lo;
        }
        if self.to.0 <= 0 {
            return self.over;
        }
        let left = length - self.travel(from, self.over);
        let (p, q) = (self.to.0 as i128, self.to.1.max(1) as i128);
        self.over + (left * q + p - 1).div_euclid(p) as i64
    }
}

impl Strip {
    /// The auto span: (out − in) ÷ rate, or to the transport's end for a looping strip.
    pub fn auto_span(
        start: i64,
        r#in: i64,
        out: i64,
        rate: (i64, i64),
        looped: bool,
        end: i64,
    ) -> i64 {
        if looped {
            return (end - start).max(0);
        }
        ((out - r#in) as i128 * rate.1 as i128 / rate.0.max(1) as i128) as i64
    }

    /// The source flicks the strip has travelled `rel` flicks in, before any loop wraps it.
    fn travel(&self, rel: i64) -> i128 {
        match &self.ramp {
            Some(r) => r.travel(self.rate, rel),
            None => (rel as i128 * self.rate.0 as i128).div_euclid(self.rate.1.max(1) as i128),
        }
    }

    /// The source time at `rel` flicks into the strip, wrapped by the loop region.
    pub fn source_at(&self, rel: i64) -> i64 {
        let src = (self.r#in as i128 + self.travel(rel)) as i64;
        if !self.looped {
            return src;
        }
        let (ls, le) = self
            .source
            .loop_region
            .unwrap_or((0, self.source.duration()));
        if le <= ls || src < le {
            return src;
        }
        ls + (src - ls).rem_euclid(le - ls)
    }

    /// Whether the strip's end is its source's own end, where it needs no fade.
    fn ends_at_source_end(&self) -> bool {
        let dur = self.source.duration();
        let end = (self.r#in as i128 + self.travel(self.span)) as i64;
        if !self.looped {
            return end >= dur;
        }
        let (ls, le) = self.source.loop_region.unwrap_or((0, dur));
        if le <= ls || end <= le {
            return end == dur;
        }
        le == dur && (end - ls).rem_euclid(le - ls) == 0
    }

    fn fade_lengths(&self) -> (i64, Curve, i64, Curve) {
        let (mut fi, ci) = self
            .fade_in
            .map_or((0, Curve::EqualPower), |f| (f.length, f.curve));
        let (mut fo, co) = self
            .fade_out
            .map_or((0, Curve::EqualPower), |f| (f.length, f.curve));
        if self.r#in != 0 {
            fi = fi.max(MIN_FADE);
        }
        if !self.ends_at_source_end() {
            fo = fo.max(MIN_FADE);
        }
        (fi, ci, fo, co)
    }

    /// The strip's gain envelope at `t`: its gain at `gain_t`, its fades and its disabled spans.
    fn envelope(&self, t: i64, gain_t: i64, fades: (i64, Curve, i64, Curve)) -> f64 {
        let rel = t - self.start;
        if rel < 0 || rel >= self.span {
            return 0.0;
        }
        let mut g = self.gain.at(gain_t);
        let (fi, ci, fo, co) = fades;
        if fi > 0 && rel < fi {
            g *= ci.rise(rel as f64 / fi as f64);
        }
        if fo > 0 && rel >= self.span - fo {
            g *= co.rise((self.span - rel) as f64 / fo as f64);
        }
        for (a, b) in &self.disabled {
            if t >= *a && t < *b {
                return 0.0;
            }
            if t < *a && t >= a - MIN_FADE {
                g *= Curve::EqualPower.rise((a - t) as f64 / MIN_FADE as f64);
            }
            if t >= *b && t < b + MIN_FADE {
                g *= Curve::EqualPower.rise((t - b) as f64 / MIN_FADE as f64);
            }
        }
        g
    }
}

#[derive(Clone, Debug)]
pub enum ProcKind {
    Eq(Vec<eq::Band>),
    Reverb(reverb::Spec),
    /// The compressor and the index of its key bus, if it names one.
    Compressor(CompressorSpec, Option<usize>),
    Limiter(LimiterSpec),
    Delay(DelaySpec),
    Pitch(PitchSpec),
    /// #155: Processor: shaper, crush and modulate.
    Shaper(ShaperSpec),
    Crush(CrushSpec),
    Modulate(ModulateSpec),
}

impl ProcKind {
    pub fn name(&self) -> &'static str {
        match self {
            ProcKind::Eq(_) => "eq",
            ProcKind::Reverb(_) => "reverb",
            ProcKind::Compressor(..) => "compressor",
            ProcKind::Limiter(_) => "limiter",
            ProcKind::Delay(_) => "delay",
            ProcKind::Pitch(_) => "pitch",
            ProcKind::Shaper(_) => "shaper",
            ProcKind::Crush(_) => "crush",
            ProcKind::Modulate(_) => "modulate",
        }
    }

    /// Its latency at `rate`, in samples.
    pub fn latency(&self, rate: i64) -> i64 {
        match self {
            ProcKind::Limiter(s) => s.latency(rate) as i64,
            ProcKind::Pitch(s) => (Pitch::samples(s, rate) / 2) as i64,
            _ => 0,
        }
    }
}

#[derive(Clone, Debug)]
pub struct Proc {
    pub id: String,
    pub kind: ProcKind,
    /// `checkpoint_every`, in whole seconds.
    pub every: i64,
    /// The ring's byte budget, if forced.
    pub budget: Option<usize>,
}

/// A bus's send (canvas primitives: Bus, `sends`).
#[derive(Clone, Debug)]
pub struct BusSend {
    pub id: String,
    /// Index of the bus it adds into.
    pub to: usize,
    pub gain_db: f64,
    /// Tapped after the bus's processors and before its gain, pan and mute; else after them.
    pub pre: bool,
}

pub struct Bus {
    pub id: String,
    pub gain_db: f64,
    pub pan: f64,
    pub mute: bool,
    pub processors: Vec<Proc>,
    /// Index of the bus it feeds, or `None` for the master.
    pub out: Option<usize>,
    pub sends: Vec<BusSend>,
    /// #502: the ducking entry that targets it (Ducking), multiplied into its gain per sample.
    pub duck: Option<crate::duck::Duck>,
}

impl Bus {
    /// The key buses its compressors read.
    fn keys(&self) -> impl Iterator<Item = usize> + '_ {
        self.processors.iter().filter_map(|p| match p.kind {
            ProcKind::Compressor(_, k) => k,
            _ => None,
        })
    }
}

pub struct Mix {
    pub rate: i64,
    pub strips: Vec<Strip>,
    pub buses: Vec<Bus>,
    order: Vec<usize>,
    master: usize,
    /// Per bus, in samples: the latest latency among its inputs, and its output's.
    arrival: Vec<i64>,
    latency: Vec<i64>,
}

impl Mix {
    /// A mix, or the bus a cycle runs through.
    pub fn new(rate: i64, strips: Vec<Strip>, buses: Vec<Bus>) -> Result<Mix, String> {
        let n = buses.len();
        let master = buses.iter().position(|b| b.out.is_none()).ok_or("master")?;
        for (i, b) in buses.iter().enumerate() {
            let (mut at, mut hops) = (i, 0);
            while let Some(o) = buses[at].out {
                at = o;
                hops += 1;
                if hops > n {
                    return Err(b.id.clone());
                }
            }
        }
        let depth = |mut i: usize| {
            let mut d = 0;
            while let Some(o) = buses[i].out {
                i = o;
                d += 1;
            }
            d
        };
        // Topological over `out`, sends and keys: a bus before every bus it feeds, sends to or
        // keys, the deepest ready bus first and then the lowest index, which without sends or
        // keys is the order by depth alone.
        let mut feeds: Vec<Vec<usize>> = vec![Vec::new(); n];
        for (i, b) in buses.iter().enumerate() {
            feeds[i].extend(b.out);
            feeds[i].extend(b.sends.iter().map(|s| s.to));
            for k in b.keys() {
                feeds[k].push(i);
            }
        }
        let mut waits = vec![0usize; n];
        for f in &feeds {
            for &j in f {
                waits[j] += 1;
            }
        }
        let mut order = Vec::with_capacity(n);
        let mut done = vec![false; n];
        while order.len() < n {
            let next = (0..n)
                .filter(|&i| !done[i] && waits[i] == 0)
                .min_by_key(|&i| (std::cmp::Reverse(depth(i)), i));
            let Some(i) = next else {
                let stuck = (0..n).find(|&i| !done[i]).unwrap_or(0);
                return Err(buses[stuck].id.clone());
            };
            done[i] = true;
            order.push(i);
            for &j in &feeds[i] {
                waits[j] -= 1;
            }
        }
        // Latencies, in order: a bus's inputs arrive at the latest of theirs.
        let (mut arrival, mut latency) = (vec![0i64; n], vec![0i64; n]);
        for &b in &order {
            latency[b] = arrival[b]
                + buses[b]
                    .processors
                    .iter()
                    .map(|p| p.kind.latency(rate))
                    .sum::<i64>();
            for &j in &feeds[b] {
                arrival[j] = arrival[j].max(latency[b]);
            }
        }
        Ok(Mix {
            rate,
            strips,
            buses,
            order,
            master,
            arrival,
            latency,
        })
    }

    /// Flicks per sample.
    pub fn step(&self) -> i64 {
        FLICKS / self.rate
    }

    /// Every processor, in bus order: its bus and itself.
    pub fn processors(&self) -> impl Iterator<Item = (usize, &Proc)> {
        self.order
            .iter()
            .flat_map(move |b| self.buses[*b].processors.iter().map(move |p| (*b, p)))
    }
}

/// Wrong programs the media acceptance tests plant.
#[derive(Clone, Copy, Debug, Default)]
pub struct Planted {
    /// A reverb restores its checkpoint without its tail (silent delay lines).
    pub restores_without_tail: bool,
    /// Past its budget the ring drops its oldest checkpoint instead of doubling its spacing.
    pub ring_drops_oldest: bool,
    /// The mixer holds a strip's gain for a block.
    pub holds_gain_per_block: bool,
    /// The emitter always uses the inverse distance model.
    pub inverse_only: bool,
    /// The cone takes its angle from source minus listener.
    pub cone_reversed: bool,
    /// #1818: every limiter, the master's too, reads sample peaks only.
    pub limiter_sample_peaks: bool,
    /// #1818: the compressor's curve has a hard knee.
    pub hard_knee: bool,
    /// #1818: the mix compensates no latency.
    pub no_latency_compensation: bool,
    /// #1818: the pitch processor ignores its semitones.
    pub pitch_ignores_semitones: bool,
    /// #1818: every send taps post.
    pub sends_tap_post: bool,
    /// #1818: a delay empties its line when a seek restores it.
    pub delay_empties_at_seek: bool,
    /// #204: synth strips reach the output after the master's limiter.
    pub synth_around_master: bool,
    /// #204: a synth's block grid starts at each seek, not at the graph's sample 0.
    pub synth_grid_at_seek: bool,
    /// #204: past its budget a synth's ring drops its oldest checkpoint.
    pub synth_ring_drops_oldest: bool,
    /// #204: an export renders its synths on 64-sample blocks.
    pub synth_block_64: bool,
}

/// A processor as it runs.
enum Unit {
    Eq(eq::Eq),
    Reverb(Reverb),
    Compressor(Compressor),
    Limiter(Limiter),
    Delay(Delay),
    Pitch(Pitch),
    Shaper(Shaper),
    Crush(Crush),
    Modulate(Modulate),
}

#[derive(Clone)]
enum UnitState {
    Eq(eq::State),
    Reverb(reverb::State),
    Compressor(CompressorState),
    Limiter(LimiterState),
    Delay(DelayState),
    Pitch(PitchState),
    /// A shaper keeps nothing.
    Shaper,
    Crush(CrushState),
    Modulate(ModulateState),
}

impl UnitState {
    fn bytes(&self) -> usize {
        match self {
            UnitState::Eq(s) => s.len() * 16,
            UnitState::Reverb(s) => s.bytes(),
            UnitState::Compressor(_) => 16,
            UnitState::Limiter(s) => s.bytes(),
            UnitState::Delay(s) => s.bytes(),
            UnitState::Pitch(s) => s.bytes(),
            UnitState::Shaper => 0,
            UnitState::Crush(_) => 24,
            UnitState::Modulate(s) => s.bytes(),
        }
    }
}

impl Unit {
    fn new(kind: &ProcKind, rate: i64, planted: &Planted) -> Unit {
        match kind {
            ProcKind::Eq(bands) => Unit::Eq(eq::Eq::new(bands, rate)),
            ProcKind::Reverb(spec) => Unit::Reverb(Reverb::new(*spec, rate)),
            ProcKind::Compressor(spec, _) => {
                Unit::Compressor(Compressor::new(*spec, rate, planted.hard_knee))
            }
            ProcKind::Limiter(spec) => {
                Unit::Limiter(Limiter::new(*spec, rate, planted.limiter_sample_peaks))
            }
            ProcKind::Delay(spec) => Unit::Delay(Delay::new(*spec, rate)),
            ProcKind::Pitch(spec) => {
                Unit::Pitch(Pitch::new(*spec, rate, planted.pitch_ignores_semitones))
            }
            ProcKind::Shaper(spec) => Unit::Shaper(Shaper::new(*spec)),
            ProcKind::Crush(spec) => Unit::Crush(Crush::new(*spec, rate)),
            ProcKind::Modulate(spec) => Unit::Modulate(Modulate::new(spec, rate)),
        }
    }
    fn process(&mut self, block: &mut [f32], key: Option<&[f32]>) {
        match self {
            Unit::Eq(e) => e.process(block),
            Unit::Reverb(r) => r.process(block),
            Unit::Compressor(c) => c.process(block, key),
            Unit::Limiter(l) => l.process(block),
            Unit::Delay(d) => d.process(block),
            Unit::Pitch(p) => p.process(block),
            Unit::Shaper(u) => u.process(block),
            Unit::Crush(u) => u.process(block),
            Unit::Modulate(u) => u.process(block),
        }
    }
    fn state(&self) -> UnitState {
        match self {
            Unit::Eq(e) => UnitState::Eq(e.state.clone()),
            Unit::Reverb(r) => UnitState::Reverb(r.state.clone()),
            Unit::Compressor(c) => UnitState::Compressor(c.state),
            Unit::Limiter(l) => UnitState::Limiter(l.state.clone()),
            Unit::Delay(d) => UnitState::Delay(d.state.clone()),
            Unit::Pitch(p) => UnitState::Pitch(p.state.clone()),
            Unit::Shaper(_) => UnitState::Shaper,
            Unit::Crush(u) => UnitState::Crush(u.state),
            Unit::Modulate(u) => UnitState::Modulate(u.state.clone()),
        }
    }
    fn set(&mut self, s: &UnitState, planted: &Planted) {
        match (self, s) {
            (Unit::Eq(e), UnitState::Eq(s)) => e.state.clone_from(s),
            (Unit::Reverb(r), UnitState::Reverb(s)) => {
                r.state = if planted.restores_without_tail {
                    s.without_tail()
                } else {
                    s.clone()
                }
            }
            (Unit::Compressor(c), UnitState::Compressor(s)) => c.state = *s,
            (Unit::Limiter(l), UnitState::Limiter(s)) => l.state.clone_from(s),
            (Unit::Delay(d), UnitState::Delay(s)) => {
                d.state = if planted.delay_empties_at_seek {
                    s.emptied()
                } else {
                    s.clone()
                }
            }
            (Unit::Pitch(p), UnitState::Pitch(s)) => p.state.clone_from(s),
            (Unit::Crush(u), UnitState::Crush(s)) => u.state = *s,
            (Unit::Modulate(u), UnitState::Modulate(s)) => u.state.clone_from(s),
            _ => {}
        }
    }
    /// Its tail, in flicks: to −120 dBFS for a reverb and a delay, its line for a limiter and a
    /// pitch shifter, its largest delay for modulate, none for an eq, a compressor, a shaper or
    /// a crush.
    fn tail(&self, kind: &ProcKind, rate: i64) -> i64 {
        let samples = |n: i64| {
            let f = n as i128 * FLICKS as i128;
            (f / rate as i128 + i128::from(f % rate as i128 != 0)) as i64
        };
        match (self, kind) {
            (Unit::Reverb(r), _) => (r.tail_seconds() * FLICKS as f64).ceil() as i64,
            (_, ProcKind::Limiter(s)) => samples(s.latency(rate) as i64),
            (_, ProcKind::Delay(s)) => samples(Delay::tail(s, rate)),
            (_, ProcKind::Pitch(s)) => samples(Pitch::samples(s, rate) as i64),
            (_, ProcKind::Modulate(s)) => samples(Modulate::tail(s, rate)),
            _ => 0,
        }
    }
}

/// A delay line on an edge into a bus: interleaved stereo frames.
#[derive(Clone)]
struct Line {
    buf: Vec<f32>,
    at: usize,
}

impl Line {
    fn new(frames: i64) -> Line {
        Line {
            buf: vec![0.0; 2 * frames.max(0) as usize],
            at: 0,
        }
    }

    /// Delays `block` in place by the line's length.
    fn pass(&mut self, block: &mut [f32]) {
        let n = self.buf.len() / 2;
        if n == 0 {
            return;
        }
        for f in block.as_chunks_mut::<2>().0 {
            let at = 2 * self.at;
            std::mem::swap(&mut self.buf[at], &mut f[0]);
            std::mem::swap(&mut self.buf[at + 1], &mut f[1]);
            self.at = (self.at + 1) % n;
        }
    }
}

/// The mix's own state, kept on the processors' grid beside theirs: its edges' delay lines and
/// the master's end limiter.
#[derive(Clone)]
struct Own {
    lines: Vec<Line>,
    end: LimiterState,
}

impl Own {
    fn bytes(&self) -> usize {
        self.lines
            .iter()
            .map(|l| 4 * l.buf.len() + 8)
            .sum::<usize>()
            + self.end.bytes()
    }
}

/// The default ring budget of one processor: 64 MiB.
pub const RING_BUDGET: usize = 64 << 20;

/// What one processor's last seek did: the checkpoint it restored (as t, flicks; `None` when it
/// rendered from the transport's start) and the time it rendered forward from.
#[derive(Clone, Copy, Debug)]
pub struct Sought {
    pub restored: Option<i64>,
    pub rendered_from: i64,
}

/// A processor's report: its kind, tail, latency and ring.
pub struct Report {
    pub id: String,
    pub kind: &'static str,
    pub tail: i64,
    pub latency: i64,
    pub budget: usize,
    pub bytes: usize,
    pub peak: usize,
    /// Its spacing, in flicks, and each checkpoint's t and bytes.
    pub spacing: i64,
    pub checkpoints: Vec<(i64, usize)>,
}

/// #204: a synth strip's report.
pub struct SynthReport {
    pub id: String,
    pub preset: String,
    pub voices: usize,
    pub tail: i64,
    /// The host clock's units its voices took to render.
    pub spent: u64,
    pub ring: Report,
}

/// Where each edge's delay line is, and how far a bus's strips are delayed.
struct Edges {
    /// Per bus: its `out` edge's line, when it delays.
    out: Vec<Option<usize>>,
    /// Per bus: each send's line.
    sends: Vec<Vec<usize>>,
    /// Per processor: its key bus and that edge's line.
    keys: Vec<Option<(usize, usize)>>,
    /// Per bus: its strips' delay, in samples.
    strips: Vec<i64>,
    /// Each line's length, in frames.
    lengths: Vec<i64>,
    /// How far the player renders ahead: the master's latency and its end limiter's.
    lead: i64,
}

impl Edges {
    fn new(mix: &Mix, planted: &Planted) -> Edges {
        let rate = mix.rate;
        let comp = !planted.no_latency_compensation;
        let delay = |d: i64| if comp { d.max(0) } else { 0 };
        let mut lengths = Vec::new();
        let mut line = |frames: i64| {
            lengths.push(frames);
            lengths.len() - 1
        };
        let mut out = Vec::new();
        let mut sends = Vec::new();
        for (b, bus) in mix.buses.iter().enumerate() {
            out.push(bus.out.and_then(|o| {
                let d = delay(mix.arrival[o] - mix.latency[b]);
                (d > 0).then(|| line(d))
            }));
            sends.push(
                bus.sends
                    .iter()
                    .map(|s| line(delay(mix.arrival[s.to] - mix.latency[b])))
                    .collect(),
            );
        }
        let mut keys = Vec::new();
        for &b in &mix.order {
            let mut before = 0;
            for p in &mix.buses[b].processors {
                keys.push(match p.kind {
                    ProcKind::Compressor(_, Some(k)) => {
                        Some((k, line(delay(mix.arrival[b] + before - mix.latency[k]))))
                    }
                    _ => None,
                });
                before += p.kind.latency(rate);
            }
        }
        let end = LimiterSpec::default().latency(rate) as i64;
        Edges {
            out,
            sends,
            keys,
            strips: mix.arrival.iter().map(|a| delay(*a)).collect(),
            lengths,
            lead: if comp {
                mix.latency[mix.master] + end
            } else {
                end
            },
        }
    }
}

/// A mix played from a position: what both the live transport and an export render through.
pub struct Player {
    pub mix: Arc<Mix>,
    units: Vec<(usize, String, i64, Unit)>,
    rings: Vec<Ring<UnitState>>,
    edges: Edges,
    lines: Vec<Line>,
    end: Limiter,
    /// #157: the end limiter's spec: its defaults, or an export's ceiling.
    end_spec: LimiterSpec,
    own: Ring<Own>,
    /// The next block to render.
    block: i64,
    /// The master's rendered block, each processor's output over it, and how much has been read.
    buf: Vec<f32>,
    outs: Vec<Vec<f32>>,
    read: usize,
    buses: Vec<Vec<f32>>,
    /// A bus's block after its processors (a pre send's tap), and an edge's delayed copy.
    pre: Vec<f32>,
    edge: Vec<f32>,
    planted: Planted,
    /// #204: each synth strip's index and its voice as it plays.
    synths: Vec<(usize, crate::synth::play::Live)>,
    /// #204: each synth strip's node taps, `<strip ID>/<node ID>`, by its place in `synths`.
    synth_taps: Vec<Vec<(String, sha2::Sha256)>>,
    /// #204: a host's clock, read around each synth block for its report; never for its sound.
    pub clock: Option<Arc<dyn Fn() -> u64 + Send + Sync>>,
    /// #204: what the planted synths routed around the master add after its limiter.
    around: Vec<f32>,
    taps: Vec<sha2::Sha256>,
    /// #502: an export's delivery gain, as an amplitude, on the master ahead of its end limiter.
    pub delivery: f64,
    /// #509: each bus's power bake, its output after its fader and ducking, then the master's own
    /// strips; made only by [`Player::tapped`].
    power: Option<Vec<crate::analysis::loudness::Power>>,
    /// #525: strips a live play adds as it goes, rendered after the mix's own, in their order.
    added: Vec<Strip>,
}

mod player;

/// A stereo pan of a stereo signal (W3C StereoPannerNode).
fn balance(l: f32, r: f32, pan: f64) -> (f32, f32) {
    if pan == 0.0 {
        return (l, r);
    }
    let pan = pan.clamp(-1.0, 1.0);
    if pan <= 0.0 {
        let x = (pan + 1.0) * ops::PI / 2.0;
        (
            (l as f64 + r as f64 * ops::cos(x)) as f32,
            (r as f64 * ops::sin(x)) as f32,
        )
    } else {
        let x = pan * ops::PI / 2.0;
        (
            (l as f64 * ops::cos(x)) as f32,
            (r as f64 + l as f64 * ops::sin(x)) as f32,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::loudness::measure;

    /// #157: the true peak (8×) of 2 s of a 997 Hz stereo tone at 0 dBFS through a bare master,
    /// with the export's ceiling set or not.
    fn master_true_peak(ceiling: Option<f64>) -> f64 {
        let rate = 48_000;
        let n = 2 * rate as usize;
        let samples: Vec<f32> = (0..n)
            .flat_map(|i| {
                let v = ops::sin(ops::TAU * 997.0 * i as f64 / rate as f64) as f32;
                [v, v]
            })
            .collect();
        let source = Arc::new(Source {
            rate,
            channels: 2,
            samples,
            loop_region: None,
        });
        let span = source.duration();
        let strip = Strip {
            id: "tone".into(),
            source,
            start: 0,
            r#in: 0,
            out: span,
            rate: (1, 1),
            ramp: None,
            gain: Gain::Db(0.0),
            pan: 0.0,
            fade_in: None,
            fade_out: None,
            looped: false,
            span,
            bus: 0,
            disabled: Vec::new(),
            emitter: None,
            synth: None,
        };
        let master = Bus {
            id: "master".into(),
            gain_db: 0.0,
            pan: 0.0,
            mute: false,
            processors: Vec::new(),
            out: None,
            sends: Vec::new(),
            duck: None,
        };
        let mut player = Player::new(
            Arc::new(Mix::new(rate, vec![strip], vec![master]).unwrap()),
            Planted::default(),
        );
        if let Some(c) = ceiling {
            player.set_ceiling(c);
        }
        player.seek(0);
        let mut out = vec![0f32; 2 * n];
        player.read(&mut out);
        measure(&out, &[1.0, 1.0], rate, 8).true_peak
    }

    #[test]
    fn an_exports_ceiling_holds_the_masters_true_peak_under_it() {
        let set = master_true_peak(Some(-1.67));
        assert!(
            set <= -1.67 + 0.05,
            "with the export's ceiling of −1.67 dBTP the master reads {set} dBTP"
        );
        let default = master_true_peak(None);
        assert!(
            default <= -1.0 + 0.05 && default > -1.67 + 0.05,
            "without it the master reads {default} dBTP"
        );
    }
}
