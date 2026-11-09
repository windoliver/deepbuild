//! A channel's keys and how a segment between two of them mixes (canvas primitives: Channel and
//! key). The left key owns its segment; time is exact flicks and progress is computed in f64;
//! values mix per component, which for a color channel is in its OKLab space.

use deep_canvas::grammar::FLICKS_PER_SECOND;
use std::sync::Arc;

use deep_canvas::table::EaseTable;

use crate::quat;
use crate::spring::Spring;

/// The Bézier timing solver's step count: Newton steps, each replaced by a bisection step where
/// |dx/ds| < 1e-6 or Newton would leave the bracket, with no early exit.
pub const BEZIER_STEPS: u32 = 12;

/// How a key's segment, to the next key, mixes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Interp {
    Hold,
    Linear,
    /// Handles normalized over the segment: x over its span, clamped to [0, 1]; y over its value
    /// change, free.
    Bezier {
        x1: f64,
        y1: f64,
        x2: f64,
        y2: f64,
    },
    /// A damped spring toward the next key's value from this key's, starting at the key's
    /// `velocity`, in closed form; the next key's value shows from its time on.
    Spring(Spring),
    /// A first-party entry of `ease@1`.
    Ease(deep_canvas::ease::Entry),
    /// A pack's ease table, an entry of `ease@1`, held in the key's `table`.
    Table,
    /// Handles computed at check from the neighboring keys (Channel and key: auto tangents),
    /// each `smoothness` of the span long; with `clamp`, a local extreme is flat and no handle
    /// passes the next key's value, so no span overshoots its keys.
    Auto { clamp: bool, smoothness: f64 },
    /// A cubic Hermite through the neighboring keys.
    CatmullRom,
    /// `quantize(n, jump)`: n steps across the segment, on exact flicks.
    Quantize { n: u32, jump: Jump },
}

/// Where a quantized step lands, as CSS `steps()` defines (Channel and key: quantize jump).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Jump {
    Start,
    #[default]
    End,
    None,
    Both,
}

impl Jump {
    pub fn parse(name: &str) -> Option<Jump> {
        Some(match name {
            "start" => Jump::Start,
            "end" => Jump::End,
            "none" => Jump::None,
            "both" => Jump::Both,
            _ => return None,
        })
    }

    /// The stepped progress after `done` whole steps of `n`, clamped to [0, 1].
    pub fn progress(self, done: i64, n: u32) -> f64 {
        let (done, n) = (done as f64, f64::from(n));
        let u = match self {
            Jump::End => done / n,
            Jump::Start => (done + 1.0) / n,
            Jump::None => done / (n - 1.0),
            Jump::Both => (done + 1.0) / (n + 1.0),
        };
        u.clamp(0.0, 1.0)
    }
}

/// Whole steps of `n` done `x` flicks into a `span`: exact, so a step lands on one flick at every
/// display rate.
pub fn steps_done(x: i64, span: i64, n: u32) -> i64 {
    (i128::from(x) * i128::from(n)).div_euclid(i128::from(span)) as i64
}

/// One key: its time in flicks, its value's components and the interpolation it owns.
#[derive(Clone, Debug, PartialEq)]
pub struct Key {
    pub id: String,
    pub t: i64,
    pub value: Vec<f64>,
    pub interp: Interp,
    /// Each component's rate as a spring segment starts, per second (`velocity`, 0 when absent).
    pub velocity: Vec<f64>,
    /// An auto or Catmull-Rom segment's slopes, per component, in value per unit of the
    /// segment's progress: at this key and at the next. Computed by [`Curve::new`].
    pub slopes: Vec<[f64; 2]>,
    /// A `Table` key's ease table: its `<pack>.<name>`, and the table once the program resolves
    /// it from the document's packs.
    pub table: Option<(String, Option<Arc<EaseTable>>)>,
    /// A quat channel's key: the arc its segment turns on.
    pub turns: Option<quat::Arc>,
    /// #494: a vec or path key's `travel`, with each point's width and each sub-path's count.
    pub travel: Option<Arc<Travels>>,
}

/// A key's `travel` and the shape of its value: `dim` components a point, `subs` points a sub-path.
#[derive(Clone, Debug, PartialEq)]
pub struct Travels {
    pub travel: crate::travel::Travel,
    pub dim: usize,
    pub subs: Vec<usize>,
}

impl Key {
    pub fn new(id: &str, t: i64, value: Vec<f64>, interp: Interp) -> Key {
        Key {
            id: id.to_string(),
            t,
            value,
            interp,
            velocity: Vec::new(),
            slopes: Vec::new(),
            table: None,
            turns: None,
            travel: None,
        }
    }

    /// The ease a key's segment follows, when it follows one: a named ease or its ease table.
    pub fn ease_at(&self, u: f64) -> Option<f64> {
        match self.interp {
            Interp::Ease(e) => Some(e.ease.at(u)),
            Interp::Table => Some(match &self.table {
                Some((_, Some(t))) => t.at(u),
                _ => u,
            }),
            _ => None,
        }
    }

    /// The least and greatest share of the value change the key's ease reads over its segment,
    /// from its interval form; `None` for a key that follows no ease.
    pub fn ease_extremes(&self) -> Option<(f64, f64)> {
        match self.interp {
            Interp::Ease(e) => Some(e.ease.extremes()),
            Interp::Table => match &self.table {
                Some((_, Some(t))) => Some(t.extremes()),
                _ => Some((0.0, 1.0)),
            },
            _ => None,
        }
    }
}

/// How a channel reads before its first key or after its last (Channel and key: `extrapolate`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Extrapolate {
    #[default]
    Hold,
    Linear,
    Cycle,
    PingPong,
    /// Each cycle adds the last key's value minus the first's.
    CycleOffset,
}

/// A channel's value at a time, with the Bézier solver's step count for that sample.
#[derive(Clone, Debug, PartialEq)]
pub struct Sample {
    pub value: Vec<f64>,
    pub iterations: u32,
}

/// The keys of one channel, sorted by time, then by ID, so two keys on one flick make a
/// right-continuous jump.
#[derive(Clone, Debug, PartialEq)]
pub struct Curve {
    pub keys: Vec<Key>,
    pub before: Extrapolate,
    pub after: Extrapolate,
}

impl Curve {
    pub fn new(keys: Vec<Key>) -> Curve {
        Curve::extrapolated(keys, Extrapolate::Hold, Extrapolate::Hold)
    }

    /// Keys sorted, with every auto and Catmull-Rom segment's slopes computed from its keys'
    /// neighbors, so one key's change reaches only the spans its neighbors touch.
    pub fn extrapolated(mut keys: Vec<Key>, before: Extrapolate, after: Extrapolate) -> Curve {
        keys.sort_by(|a, b| a.t.cmp(&b.t).then_with(|| a.id.cmp(&b.id)));
        let width = keys.first().map_or(0, |k| k.value.len());
        let tangents: Vec<Vec<f64>> = (0..keys.len())
            .map(|i| (0..width).map(|c| tangent(&keys, i, c)).collect())
            .collect();
        for i in 0..keys.len().saturating_sub(1) {
            if !matches!(keys[i].interp, Interp::Auto { .. } | Interp::CatmullRom) {
                continue;
            }
            let span = (keys[i + 1].t - keys[i].t) as f64;
            keys[i].slopes = (0..width)
                .map(|c| [tangents[i][c] * span, tangents[i + 1][c] * span])
                .collect();
        }
        Curve { keys, before, after }
    }

    /// The index of the key that owns `t`: the last at or before it, or `None` before the first.
    pub fn owner(&self, t: i64) -> Option<usize> {
        let after = self.keys.partition_point(|k| k.t <= t);
        after.checked_sub(1)
    }

    /// The index of the key after the one that owns `t`, when its segment moves toward it.
    pub fn next(&self, t: i64) -> Option<usize> {
        let i = self.owner(t)?;
        let (a, b) = (&self.keys[i], self.keys.get(i + 1)?);
        moves(a, b).then_some(i + 1)
    }

    /// The value at `t` into `out`, one slot per component, with no allocation; returns the
    /// Bézier solver's step count. Before the first key and after the last it extrapolates as
    /// `before` and `after` say.
    pub fn sample_into(&self, t: i64, out: &mut [f64]) -> u32 {
        let (Some(first), Some(last)) = (self.keys.first(), self.keys.last()) else {
            return 0;
        };
        let (t0, t1) = (first.t, last.t);
        let side = if t < t0 { self.before } else { self.after };
        if (t < t0 || t > t1) && t1 > t0 && side != Extrapolate::Hold {
            let span = t1 - t0;
            let k = (t - t0).div_euclid(span);
            let into = (t - t0).rem_euclid(span);
            match side {
                Extrapolate::Linear => {
                    let (end, at) = if t < t0 { (first, t0) } else { (last, t1) };
                    let slope = self.end_slope(t < t0);
                    let dt = (t - at) as f64;
                    for (c, o) in out.iter_mut().enumerate() {
                        *o = end.value[c] + slope[c.min(slope.len() - 1)] * dt;
                    }
                    return 0;
                }
                Extrapolate::Cycle => return self.inside(t0 + into, out),
                Extrapolate::PingPong => {
                    let back = k.rem_euclid(2) == 1;
                    return self.inside(if back { t1 - into } else { t0 + into }, out);
                }
                Extrapolate::CycleOffset => {
                    let steps = self.inside(t0 + into, out);
                    for (c, o) in out.iter_mut().enumerate() {
                        *o += k as f64 * (last.value[c] - first.value[c]);
                    }
                    return steps;
                }
                Extrapolate::Hold => {}
            }
        }
        self.inside(t, out)
    }

    /// Each component's rate at `t`, per second: the segment's derivative, right-continuous, 0 on
    /// a hold or a step and beyond a held end. Linear segments are exact; the rest take a central
    /// difference over one flick either side, of the closed-form value.
    pub fn rate_into(&self, t: i64, out: &mut [f64]) {
        out.fill(0.0);
        let Some((a, b)) = self.owner(t).and_then(|i| Some((&self.keys[i], self.keys.get(i + 1)?))) else {
            return;
        };
        match a.interp {
            Interp::Hold | Interp::Quantize { .. } => {}
            Interp::Linear if a.turns.is_none() && a.travel.is_none() => {
                let span = (b.t - a.t) as f64 / FLICKS_PER_SECOND as f64;
                for (c, o) in out.iter_mut().enumerate() {
                    *o = (b.value[c] - a.value[c]) / span;
                }
            }
            _ => {
                // A step of 1e-5 of the segment: wide enough for an f64's rounding, and second
                // order all the way to the keys, so a key's own flick reads as well as any.
                let span = b.t - a.t;
                let h = (span / 100_000).max(1);
                let width = out.len();
                let values = |at: i64| {
                    let mut v = [0.0; 4];
                    segment_into(a, b, at, &mut v[..width]);
                    v
                };
                let dt = h as f64 / FLICKS_PER_SECOND as f64;
                let slope = |c: usize| {
                    if t - h >= a.t && t + h < b.t {
                        (values(t + h)[c] - values(t - h)[c]) / (2.0 * dt)
                    } else if t + 2 * h < b.t {
                        (4.0 * values(t + h)[c] - 3.0 * values(t)[c] - values(t + 2 * h)[c]) / (2.0 * dt)
                    } else if t - 2 * h >= a.t {
                        (3.0 * values(t)[c] - 4.0 * values(t - h)[c] + values(t - 2 * h)[c]) / (2.0 * dt)
                    } else {
                        0.0
                    }
                };
                for (c, o) in out.iter_mut().enumerate() {
                    *o = slope(c);
                }
            }
        }
    }

    /// The keyed value at `t`, held before the first key and after the last.
    fn inside(&self, t: i64, out: &mut [f64]) -> u32 {
        let held = |k: &Key, out: &mut [f64]| {
            out.iter_mut().zip(&k.value).for_each(|(o, v)| *o = *v);
            0
        };
        let Some(i) = self.owner(t) else {
            return self.keys.first().map_or(0, |k| held(k, out));
        };
        let a = &self.keys[i];
        let Some(b) = self.keys.get(i + 1) else {
            return held(a, out);
        };
        segment_into(a, b, t, out)
    }

    /// Each component's slope, per flick, at the first key (`start`) or the last.
    fn end_slope(&self, start: bool) -> [f64; 4] {
        let mut out = [0.0; 4];
        let n = self.keys.len();
        if n < 2 {
            return out;
        }
        let (a, b) = (&self.keys[if start { 0 } else { n - 2 }], &self.keys[if start { 1 } else { n - 1 }]);
        let span = (b.t - a.t) as f64;
        for (c, o) in out.iter_mut().enumerate().take(a.value.len()) {
            *o = match a.interp {
                Interp::Hold => 0.0,
                Interp::Auto { .. } | Interp::CatmullRom => {
                    a.slopes.get(c).map_or(0.0, |s| s[usize::from(!start)] / span)
                }
                _ => (b.value[c] - a.value[c]) / span,
            };
        }
        out
    }

    /// The earliest time after `t` at which the value may differ from its value at `t`: the next
    /// flick inside a segment that moves, the next key's time otherwise, `None` once nothing
    /// changes again.
    pub fn next_change(&self, t: i64) -> Option<i64> {
        if self.keys.len() > 1 {
            let (t0, t1) = (self.keys[0].t, self.keys[self.keys.len() - 1].t);
            let side = if t < t0 { self.before } else { self.after };
            if (t < t0 || t >= t1) && side != Extrapolate::Hold {
                return Some(t + 1);
            }
        }
        let Some(i) = self.owner(t) else {
            return self.keys.first().map(|k| k.t);
        };
        let a = &self.keys[i];
        let b = self.keys.get(i + 1)?;
        if moves(a, b) {
            Some(t + 1)
        } else {
            Some(b.t)
        }
    }
}

/// Key `i`'s tangent for component `c`, in value per flick, as an auto or Catmull-Rom segment
/// reads it: from its two neighbors; flat at an end and, for a clamped auto key, at a local
/// extreme, and short enough that no handle passes either neighbor's value.
fn tangent(keys: &[Key], i: usize, c: usize) -> f64 {
    let (Some(prev), Some(next)) = (i.checked_sub(1).map(|p| &keys[p]), keys.get(i + 1)) else {
        return 0.0;
    };
    let k = &keys[i];
    let (before, here, after) = (prev.value[c], k.value[c], next.value[c]);
    let slope = (after - before) / (next.t - prev.t) as f64;
    // The interpolation that reads this tangent: the key's own, or the one into it.
    let clamp = match (prev.interp, k.interp) {
        (_, Interp::Auto { clamp, smoothness }) | (Interp::Auto { clamp, smoothness }, _) => {
            Some((clamp, smoothness))
        }
        _ => None,
    };
    let Some((true, smoothness)) = clamp else {
        return slope;
    };
    if (here - before) * (after - here) <= 0.0 {
        return 0.0;
    }
    // A handle `smoothness` of a span long rises slope · smoothness · span: never past the key
    // at its other end.
    let s = smoothness.max(1e-9);
    let room_in = (here - before).abs() / (s * (k.t - prev.t) as f64);
    let room_out = (after - here).abs() / (s * (next.t - k.t) as f64);
    slope.signum() * slope.abs().min(room_in).min(room_out)
}

/// Whether a segment's value changes across its span (it may still jump at its end).
fn moves(a: &Key, b: &Key) -> bool {
    match a.interp {
        Interp::Hold => false,
        // A spring with a velocity moves even toward its own value.
        Interp::Spring(_) => a.value != b.value || a.velocity.iter().any(|v| *v != 0.0),
        _ => a.value != b.value,
    }
}

/// The value inside the segment `a → b` at `t`, with `a.t <= t < b.t`.
pub fn segment(a: &Key, b: &Key, t: i64) -> Sample {
    let mut value = vec![0.0; a.value.len()];
    let iterations = segment_into(a, b, t, &mut value);
    Sample { value, iterations }
}

/// [`segment`] into `out`, with no allocation; returns the Bézier solver's step count.
pub fn segment_into(a: &Key, b: &Key, t: i64, out: &mut [f64]) -> u32 {
    let mix = |w: f64, out: &mut [f64]| {
        if let Some(arc) = a.turns {
            out.copy_from_slice(&quat::blend(arc, quat::of(&a.value), quat::of(&b.value), w));
            return;
        }
        if let Some(t) = &a.travel {
            t.travel.mix(&a.value, &b.value, w, t.dim, &t.subs, out);
            return;
        }
        for ((o, &va), &vb) in out.iter_mut().zip(&a.value).zip(&b.value) {
            *o = va + (vb - va) * w;
        }
    };
    // At its own time a key shows its own value, bit for bit, whatever it interpolates by; a
    // quantize's first step may start past it.
    if t == a.t && !matches!(a.interp, Interp::Quantize { .. }) {
        out.iter_mut().zip(&a.value).for_each(|(o, v)| *o = *v);
        return 0;
    }
    let u = (t - a.t) as f64 / (b.t - a.t) as f64;
    match a.interp {
        Interp::Hold => {
            out.iter_mut().zip(&a.value).for_each(|(o, v)| *o = *v);
            0
        }
        Interp::Linear => {
            mix(u, out);
            0
        }
        Interp::Quantize { n, jump } => {
            let done = steps_done(t - a.t, b.t - a.t, n);
            mix(jump.progress(done, n), out);
            0
        }
        Interp::Bezier { x1, y1, x2, y2 } => {
            let solved = Bezier::new(x1, y1, x2, y2).solve(u);
            mix(solved.y, out);
            solved.steps
        }
        Interp::Ease(_) | Interp::Table => {
            mix(a.ease_at(u).unwrap_or(u), out);
            0
        }
        Interp::Spring(spring) => {
            let seconds = (t - a.t) as f64 / FLICKS_PER_SECOND as f64;
            for (c, o) in out.iter_mut().enumerate() {
                let (va, vb) = (a.value[c], b.value[c]);
                let v0 = a.velocity.get(c).copied().unwrap_or(0.0);
                *o = vb + spring.at(va - vb, v0, seconds).e;
            }
            0
        }
        Interp::Auto { smoothness, clamp } => {
            // A Bézier in time and value: x handles at smoothness and 1 − smoothness of the span,
            // y handles along each key's slope.
            let s = smoothness.clamp(0.0, 1.0);
            let solved = Bezier::new(s, 0.0, 1.0 - s, 1.0).solve(u);
            for (c, o) in out.iter_mut().enumerate() {
                let [ma, mb] = a.slopes.get(c).copied().unwrap_or([0.0; 2]);
                let (va, vb) = (a.value[c], b.value[c]);
                // Offsets from the first key, so a flat span is its value bit for bit.
                let d = vb - va;
                let v = va + bernstein(0.0, ma * s, d - mb * s, d, solved.s);
                // Clamped handles keep the curve between its keys; rounding may not pass them.
                *o = if clamp { v.clamp(va.min(vb), va.max(vb)) } else { v };
            }
            solved.steps
        }
        Interp::CatmullRom => {
            let (h00, h10, h01, h11) = (
                (1.0 + 2.0 * u) * (1.0 - u) * (1.0 - u),
                u * (1.0 - u) * (1.0 - u),
                u * u * (3.0 - 2.0 * u),
                u * u * (u - 1.0),
            );
            for (c, o) in out.iter_mut().enumerate() {
                let [ma, mb] = a.slopes.get(c).copied().unwrap_or([0.0; 2]);
                *o = h00 * a.value[c] + h10 * ma + h01 * b.value[c] + h11 * mb;
            }
            0
        }
    }
}

/// The cubic Bernstein form over four control values at parameter `s`.
fn bernstein(p0: f64, p1: f64, p2: f64, p3: f64, s: f64) -> f64 {
    let r = 1.0 - s;
    r * r * r * p0 + 3.0 * r * r * s * p1 + 3.0 * r * s * s * p2 + s * s * s * p3
}

/// How a change of state moves over its span (#417, the look's `time.state.interp`; #489's
/// transition follow): an `ease@1` name or a Bézier, from a share of the span to a share of the way.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Ease {
    Linear,
    InCubic,
    OutCubic,
    InOutCubic,
    Bezier(Bezier),
}

impl Ease {
    /// The `ease@1` names motion lands, as written.
    pub const NAMES: [(&'static str, Ease); 4] = [
        ("linear", Ease::Linear),
        ("in_cubic", Ease::InCubic),
        ("out_cubic", Ease::OutCubic),
        ("in_out_cubic", Ease::InOutCubic),
    ];

    /// The share of the way at `u` of the span, `u` clamped to [0, 1] (the cubics as CSS and
    /// Penner name them).
    pub fn at(&self, u: f64) -> f64 {
        let u = u.clamp(0.0, 1.0);
        match *self {
            Ease::Linear => u,
            Ease::InCubic => u * u * u,
            Ease::OutCubic => {
                let r = 1.0 - u;
                1.0 - r * r * r
            }
            Ease::InOutCubic => deep_canvas::camera::ease_in_out_cubic(u),
            Ease::Bezier(b) => b.solve(u).y,
        }
    }
}

/// A damped spring's displacement from its target, released from rest at 1, after `seconds`, in
/// closed form in all three damping regimes (ω0 = 2π · `freq_hz`, ζ = `damping_ratio`).
pub fn spring_from_rest(freq_hz: f64, damping_ratio: f64, seconds: f64) -> f64 {
    Spring::from_freq(freq_hz, damping_ratio)
        .at(1.0, 0.0, seconds)
        .e
}

/// A cubic Bézier timing curve from (0, 0) to (1, 1) through its two handles.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Bezier {
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
}

/// A solved sample: the curve parameter, its y, and the steps the solver ran.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Solved {
    pub s: f64,
    pub y: f64,
    pub steps: u32,
}

/// The cubic `3(1−s)²s·p1 + 3(1−s)s²·p2 + s³` and its derivative, in f64.
fn cubic(p1: f64, p2: f64, s: f64) -> f64 {
    let c = 3.0 * p1;
    let b = 3.0 * (p2 - p1) - c;
    let a = 1.0 - c - b;
    ((a * s + b) * s + c) * s
}

fn cubic_slope(p1: f64, p2: f64, s: f64) -> f64 {
    let c = 3.0 * p1;
    let b = 3.0 * (p2 - p1) - c;
    let a = 1.0 - c - b;
    (3.0 * a * s + 2.0 * b) * s + c
}

impl Bezier {
    /// Handles with x clamped to [0, 1], so x never runs backwards in s.
    pub fn new(x1: f64, y1: f64, x2: f64, y2: f64) -> Bezier {
        Bezier {
            x1: x1.clamp(0.0, 1.0),
            y1,
            x2: x2.clamp(0.0, 1.0),
            y2,
        }
    }

    pub fn x(&self, s: f64) -> f64 {
        cubic(self.x1, self.x2, s)
    }

    pub fn y(&self, s: f64) -> f64 {
        cubic(self.y1, self.y2, s)
    }

    /// Solves x(s) = `u` for u in [0, 1]: an 11-sample table brackets s, then exactly
    /// [`BEZIER_STEPS`] steps, each Newton's unless the slope is under 1e-6 or Newton leaves the
    /// bracket, when it bisects; the bracket narrows at every step, so the result stays inside it.
    pub fn solve(&self, u: f64) -> Solved {
        let u = u.clamp(0.0, 1.0);
        let mut lo = 0.0;
        let mut hi = 1.0;
        for k in 1..=10 {
            let s = f64::from(k) / 10.0;
            if self.x(s) <= u {
                lo = s;
            } else {
                hi = s;
                break;
            }
        }
        let (x_lo, x_hi) = (self.x(lo), self.x(hi));
        let mut s = if x_hi > x_lo {
            lo + (u - x_lo) / (x_hi - x_lo) * (hi - lo)
        } else {
            0.5 * (lo + hi)
        };
        for _ in 0..BEZIER_STEPS {
            let f = self.x(s) - u;
            if f < 0.0 {
                lo = s;
            } else if f > 0.0 {
                hi = s;
            }
            let slope = cubic_slope(self.x1, self.x2, s);
            let newton = s - f / slope;
            // A converged Newton step lands on the bracket's end it just set: that stays.
            s = if f == 0.0 {
                s
            } else if slope.abs() < 1e-6 || !(newton >= lo && newton <= hi) {
                0.5 * (lo + hi)
            } else {
                newton
            };
        }
        Solved {
            s,
            y: self.y(s),
            steps: BEZIER_STEPS,
        }
    }

    /// The handles of each half when the curve is cut at parameter `s` (de Casteljau), each
    /// renormalized to its own part: the left over (0, 0)–(x(s), y(s)), the right over (x(s),
    /// y(s))–(1, 1). A part with no value change keeps its y handles as they are.
    pub fn split(&self, s: f64) -> (Bezier, Bezier) {
        let lerp = |a: (f64, f64), b: (f64, f64)| (a.0 + (b.0 - a.0) * s, a.1 + (b.1 - a.1) * s);
        let p0 = (0.0, 0.0);
        let p1 = (self.x1, self.y1);
        let p2 = (self.x2, self.y2);
        let p3 = (1.0, 1.0);
        let l1 = lerp(p0, p1);
        let m = lerp(p1, p2);
        let r2 = lerp(p2, p3);
        let l2 = lerp(l1, m);
        let r1 = lerp(m, r2);
        let cut = lerp(l2, r1);
        let over = |p: (f64, f64), from: (f64, f64), to: (f64, f64)| {
            let x = (p.0 - from.0) / (to.0 - from.0);
            let dy = to.1 - from.1;
            let y = if dy == 0.0 {
                p.1 - from.1
            } else {
                (p.1 - from.1) / dy
            };
            (x, y)
        };
        let (a1, a2) = (over(l1, p0, cut), over(l2, p0, cut));
        let (b1, b2) = (over(r1, cut, p3), over(r2, cut, p3));
        (
            Bezier::new(a1.0, a1.1, a2.0, a2.1),
            Bezier::new(b1.0, b1.1, b2.0, b2.1),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_spring_from_rest_starts_at_one_with_no_speed_and_decays() {
        for z in [0.5, 1.0, 2.0] {
            assert!((spring_from_rest(2.0, z, 0.0) - 1.0).abs() < 1e-15);
            let a = spring_from_rest(2.0, z, 1e-6);
            assert!((1.0 - a).abs() < 1e-6, "ζ {z}: starts at rest, {a}");
            assert!(spring_from_rest(2.0, z, 3.0).abs() < 1e-3, "ζ {z}: settles");
        }
    }

    #[test]
    fn a_solved_bezier_lands_on_its_x() {
        let b = Bezier::new(0.42, 0.0, 0.58, 1.0);
        for k in 0..=100 {
            let u = f64::from(k) / 100.0;
            let solved = b.solve(u);
            assert!(
                (b.x(solved.s) - u).abs() < 1e-14,
                "u {u}: x {}",
                b.x(solved.s)
            );
        }
    }

    #[test]
    fn a_newton_step_that_converges_on_the_bracket_end_is_kept() {
        // A subdivision curve at 3.3 s: Newton lands exactly on the end it just set.
        let b = Bezier::new(1.0 / 12.0, 2.0, 1.0, -1.0);
        let u = 1_622_880_000.0 / 8_467_200_000.0;
        let solved = b.solve(u);
        assert!((b.x(solved.s) - u).abs() < 1e-15, "x {}", b.x(solved.s) - u);
    }
}
