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
use crate::dynamics::{Compressor, CompressorSpec, CompressorState, Limiter, LimiterSpec, LimiterState};
use crate::emitter::{self, Cone, Distance, Model};
use crate::eq;
use crate::reverb::{self, Reverb};
use crate::ring::Ring;
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

pub struct Strip {
    pub id: String,
    pub source: Arc<Source>,
    pub start: i64,
    pub r#in: i64,
    pub out: i64,
    pub rate: (i64, i64),
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
}

impl Strip {
    /// The auto span: (out − in) ÷ rate, or to the transport's end for a looping strip.
    pub fn auto_span(start: i64, r#in: i64, out: i64, rate: (i64, i64), looped: bool, end: i64) -> i64 {
        if looped {
            return (end - start).max(0);
        }
        ((out - r#in) as i128 * rate.1 as i128 / rate.0.max(1) as i128) as i64
    }

    /// The source time at `rel` flicks into the strip, wrapped by the loop region.
    pub fn source_at(&self, rel: i64) -> i64 {
        let src = self.r#in as i128 + (rel as i128 * self.rate.0 as i128).div_euclid(self.rate.1.max(1) as i128);
        let src = src as i64;
        if !self.looped {
            return src;
        }
        let (ls, le) = self.source.loop_region.unwrap_or((0, self.source.duration()));
        if le <= ls || src < le {
            return src;
        }
        ls + (src - ls).rem_euclid(le - ls)
    }

    /// Whether the strip's end is its source's own end, where it needs no fade.
    fn ends_at_source_end(&self) -> bool {
        let dur = self.source.duration();
        let end = self.r#in as i128 + (self.span as i128 * self.rate.0 as i128).div_euclid(self.rate.1.max(1) as i128);
        let end = end as i64;
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
        let (mut fi, ci) = self.fade_in.map_or((0, Curve::EqualPower), |f| (f.length, f.curve));
        let (mut fo, co) = self.fade_out.map_or((0, Curve::EqualPower), |f| (f.length, f.curve));
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
            latency[b] = arrival[b] + buses[b].processors.iter().map(|p| p.kind.latency(rate)).sum::<i64>();
            for &j in &feeds[b] {
                arrival[j] = arrival[j].max(latency[b]);
            }
        }
        Ok(Mix { rate, strips, buses, order, master, arrival, latency })
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
}

/// A processor as it runs.
enum Unit {
    Eq(eq::Eq),
    Reverb(Reverb),
    Compressor(Compressor),
    Limiter(Limiter),
    Delay(Delay),
    Pitch(Pitch),
}

#[derive(Clone)]
enum UnitState {
    Eq(eq::State),
    Reverb(reverb::State),
    Compressor(CompressorState),
    Limiter(LimiterState),
    Delay(DelayState),
    Pitch(PitchState),
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
        }
    }
}

impl Unit {
    fn new(kind: &ProcKind, rate: i64, planted: &Planted) -> Unit {
        match kind {
            ProcKind::Eq(bands) => Unit::Eq(eq::Eq::new(bands, rate)),
            ProcKind::Reverb(spec) => Unit::Reverb(Reverb::new(*spec, rate)),
            ProcKind::Compressor(spec, _) => Unit::Compressor(Compressor::new(*spec, rate, planted.hard_knee)),
            ProcKind::Limiter(spec) => Unit::Limiter(Limiter::new(*spec, rate, planted.limiter_sample_peaks)),
            ProcKind::Delay(spec) => Unit::Delay(Delay::new(*spec, rate)),
            ProcKind::Pitch(spec) => Unit::Pitch(Pitch::new(*spec, rate, planted.pitch_ignores_semitones)),
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
        }
    }
    fn set(&mut self, s: &UnitState, planted: &Planted) {
        match (self, s) {
            (Unit::Eq(e), UnitState::Eq(s)) => e.state.clone_from(s),
            (Unit::Reverb(r), UnitState::Reverb(s)) => {
                r.state = if planted.restores_without_tail { s.without_tail() } else { s.clone() }
            }
            (Unit::Compressor(c), UnitState::Compressor(s)) => c.state = *s,
            (Unit::Limiter(l), UnitState::Limiter(s)) => l.state.clone_from(s),
            (Unit::Delay(d), UnitState::Delay(s)) => {
                d.state = if planted.delay_empties_at_seek { s.emptied() } else { s.clone() }
            }
            (Unit::Pitch(p), UnitState::Pitch(s)) => p.state.clone_from(s),
            _ => {}
        }
    }
    /// Its tail, in flicks: to −120 dBFS for a reverb and a delay, its line for a limiter and a
    /// pitch shifter, none for an eq or a compressor.
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
        Line { buf: vec![0.0; 2 * frames.max(0) as usize], at: 0 }
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
        self.lines.iter().map(|l| 4 * l.buf.len() + 8).sum::<usize>() + self.end.bytes()
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
            sends.push(bus.sends.iter().map(|s| line(delay(mix.arrival[s.to] - mix.latency[b]))).collect());
        }
        let mut keys = Vec::new();
        for &b in &mix.order {
            let mut before = 0;
            for p in &mix.buses[b].processors {
                keys.push(match p.kind {
                    ProcKind::Compressor(_, Some(k)) => Some((k, line(delay(mix.arrival[b] + before - mix.latency[k])))),
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
            lead: if comp { mix.latency[mix.master] + end } else { end },
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
    taps: Vec<sha2::Sha256>,
}

impl Player {
    pub fn new(mix: Arc<Mix>, planted: Planted) -> Player {
        let mut units = Vec::new();
        let mut rings = Vec::new();
        for (b, p) in mix.processors() {
            units.push((b, p.id.clone(), p.every.max(1), Unit::new(&p.kind, mix.rate, &planted)));
            rings.push(Ring::new(p.budget.unwrap_or(RING_BUDGET), planted.ring_drops_oldest));
        }
        let n = 2 * BLOCK as usize;
        let edges = Edges::new(&mix, &planted);
        let lead = edges.lead;
        let mut p = Player {
            outs: vec![vec![0.0; n]; units.len()],
            taps: units.iter().map(|_| sha2::Sha256::default()).collect(),
            buses: vec![vec![0.0; n]; mix.buses.len()],
            lines: edges.lengths.iter().map(|l| Line::new(*l)).collect(),
            end: Limiter::new(LimiterSpec::default(), mix.rate, planted.limiter_sample_peaks),
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
        };
        p.seek_graph(lead);
        p.take_taps();
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
            self.read += n;
            at += n;
        }
    }

    /// Each processor's ID and the SHA-256 of its output read since the last call.
    pub fn take_taps(&mut self) -> Vec<(String, String)> {
        use sha2::Digest;
        let ids = self.units.iter().map(|u| u.1.clone());
        let taps = self.taps.iter_mut().map(|t| {
            let d = std::mem::take(t).finalize();
            d.iter().map(|b| format!("{b:02x}")).collect::<String>()
        });
        ids.zip(taps).collect()
    }

    /// Moves to `sample`: restores the latest checkpoint at or before it that every processor's
    /// ring holds, renders forward from there and returns what each processor did.
    pub fn seek(&mut self, sample: i64) -> Vec<(String, Sought)> {
        self.seek_graph(sample + self.edges.lead)
    }

    /// Moves the graph, which runs `lead` samples ahead of what is heard, to `sample`.
    fn seek_graph(&mut self, sample: i64) -> Vec<(String, Sought)> {
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
            .collect();
        let second = best.and_then(|b| b.into_iter().min()).filter(|s| {
            self.own.get(*s).is_some()
                && self
                    .rings
                    .iter()
                    .zip(&self.units)
                    .all(|(r, u)| s % u.2 == 0 && r.get(s / u.2).is_some())
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
                (s * rate).div_euclid(BLOCK) + i64::from((s * rate).rem_euclid(BLOCK) != 0)
            }
            None => {
                let mix = self.mix.clone();
                for (u, (_, p)) in self.units.iter_mut().zip(mix.processors()) {
                    u.3 = Unit::new(&p.kind, rate, &self.planted);
                }
                self.lines = self.edges.lengths.iter().map(|l| Line::new(*l)).collect();
                self.end = Limiter::new(LimiterSpec::default(), rate, self.planted.limiter_sample_peaks);
                0
            }
        };
        self.block = from_block;
        while self.block < target {
            self.render_block();
        }
        self.render_block();
        self.read = 2 * (sample - target * BLOCK) as usize;
        let sought = Sought {
            restored: second.map(|s| s * FLICKS),
            rendered_from: second.unwrap_or(0) * FLICKS,
        };
        self.units.iter().map(|u| (u.1.clone(), sought)).collect()
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

    /// The whole second whose checkpoint block `k` is, if any: the first block boundary at or
    /// after each whole second.
    fn second_of(&self, k: i64) -> Option<i64> {
        let rate = self.mix.rate;
        let s = (k * BLOCK).div_euclid(rate);
        (k == 0 || s * rate > (k - 1) * BLOCK).then_some(s)
    }

    fn render_block(&mut self) {
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
                let st = Own { lines: self.lines.clone(), end: self.end.state.clone() };
                let bytes = st.bytes();
                self.own.put(s, k * BLOCK, st, bytes);
            }
        }
        let mix = self.mix.clone();
        let step = mix.step();
        for b in &mut self.buses {
            b.iter_mut().for_each(|x| *x = 0.0);
        }
        for s in &mix.strips {
            // A bus's strips arrive as late as its latest input.
            let t0 = (k * BLOCK - self.edges.strips[s.bus]) * step;
            if s.start + s.span <= t0 || s.start >= t0 + BLOCK * step {
                continue;
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
            let mono = s.source.channels == 1;
            let out = &mut self.buses[s.bus];
            for i in 0..BLOCK {
                let t = t0 + i * step;
                let gain_t = if self.planted.holds_gain_per_block { t0 } else { t };
                let env = s.envelope(t, gain_t, fades);
                if env == 0.0 {
                    continue;
                }
                let x = i as f64 / BLOCK as f64;
                let g = env * (eg0 + (eg1 - eg0) * x);
                let p = pan.0 + (pan.1 - pan.0) * x;
                let (l, r) = s.source.read(s.source_at(t - s.start));
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
        for &b in &mix.order {
            let bus = &mix.buses[b];
            let mut block = std::mem::take(&mut self.buses[b]);
            for (u, ((ub, _, _, unit), o)) in self.units.iter_mut().zip(self.outs.iter_mut()).enumerate() {
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
            for f in block.as_chunks_mut::<2>().0 {
                let (l, r) = balance(f[0], f[1], bus.pan);
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
                let tap = if send.pre && !self.planted.sends_tap_post { &self.pre } else { &block };
                let g = amp(send.gain_db);
                for (e, x) in self.edge.iter_mut().zip(tap) {
                    *e = (f64::from(*x) * g) as f32;
                }
                self.lines[l].pass(&mut self.edge);
                for (d, x) in self.buses[send.to].iter_mut().zip(&self.edge) {
                    *d += x;
                }
            }
            self.buses[b] = block;
        }
        // The master ends in its true-peak limiter, after its gain and pan.
        self.buf.copy_from_slice(&self.buses[mix.master]);
        self.end.process(&mut self.buf);
        self.read = 0;
        self.block = k + 1;
    }

    /// An emitter's gain and pan at `t`.
    fn emit_gain(&self, e: &Emit, t: i64) -> (f64, f64) {
        let p = (e.place)(t);
        let d = [p.source[0] - p.listener[0], p.source[1] - p.listener[1], p.source[2] - p.listener[2]];
        let dist = ops::sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        let model = if self.planted.inverse_only { Model::Inverse } else { e.distance.model };
        let g = emitter::distance_gain(&e.distance, dist, model)
            * emitter::cone_gain(&e.cone, p.forward, p.source, p.listener, self.planted.cone_reversed);
        // W3C PannerNode's equal-power azimuth: in the listener's horizontal plane, a source behind
        // pans as its mirror in front, and the pan is azimuth ÷ 90°.
        let ahead = [p.right[2], 0.0, -p.right[0]];
        let x = d[0] * p.right[0] + d[2] * p.right[2];
        let z = d[0] * ahead[0] + d[2] * ahead[2];
        let pan = if x == 0.0 && z == 0.0 {
            0.0
        } else {
            let az = ops::deg(ops::atan2(x, z));
            let az = if az > 90.0 { 180.0 - az } else if az < -90.0 { -180.0 - az } else { az };
            az / 90.0
        };
        (g, pan)
    }
}

/// A stereo pan of a stereo signal (W3C StereoPannerNode).
fn balance(l: f32, r: f32, pan: f64) -> (f32, f32) {
    if pan == 0.0 {
        return (l, r);
    }
    let pan = pan.clamp(-1.0, 1.0);
    if pan <= 0.0 {
        let x = (pan + 1.0) * ops::PI / 2.0;
        ((l as f64 + r as f64 * ops::cos(x)) as f32, (r as f64 * ops::sin(x)) as f32)
    } else {
        let x = pan * ops::PI / 2.0;
        ((l as f64 * ops::cos(x)) as f32, (r as f64 + l as f64 * ops::sin(x)) as f32)
    }
}
