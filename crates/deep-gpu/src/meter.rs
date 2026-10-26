//! The meter and the degrade ladder (issue #379; canvas primitives: Meter and degrade ladder). A
//! frame's GPU time is the time its passes cover, each pass charged only the part of its interval
//! after every earlier pass's ends; each writer layer keeps a 120-frame ring of its charges and a
//! ladder that steps it, and only it, down after 30 consecutive frames over its class's frame
//! limit and back up 120 frames after the view changes. Nothing here allocates per frame.

use deep_canvas::budget::Limits;

/// The ladder, top to bottom: the climb rungs above the class's base (the last listed is climbed
/// first), the base, then the run-time rungs in the order they're taken.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Rung {
    Shadows2x,
    FullResEffects,
    Samples4Moving,
    Scale1Moving,
    Base,
    EffectsOff,
    LodDown,
    InternalScaleDown,
    Hz30,
    Freeze,
    Placeholder,
}

pub const LADDER: [Rung; 11] = [
    Rung::Shadows2x,
    Rung::FullResEffects,
    Rung::Samples4Moving,
    Rung::Scale1Moving,
    Rung::Base,
    Rung::EffectsOff,
    Rung::LodDown,
    Rung::InternalScaleDown,
    Rung::Hz30,
    Rung::Freeze,
    Rung::Placeholder,
];

impl Rung {
    pub fn name(self) -> &'static str {
        match self {
            Rung::Shadows2x => "shadows_2x",
            Rung::FullResEffects => "full_res_effects",
            Rung::Samples4Moving => "samples_4_moving",
            Rung::Scale1Moving => "scale_1_moving",
            Rung::Base => "base",
            Rung::EffectsOff => "effects_off",
            Rung::LodDown => "lod_down",
            Rung::InternalScaleDown => "internal_scale_down",
            Rung::Hz30 => "30hz",
            Rung::Freeze => "freeze",
            Rung::Placeholder => "placeholder",
        }
    }

    pub fn parse(name: &str) -> Option<Rung> {
        LADDER.into_iter().find(|r| r.name() == name)
    }

    fn index(self) -> usize {
        self as usize
    }

    /// One rung down, or none past the last.
    fn down(self) -> Option<Rung> {
        LADDER.get(self.index() + 1).copied()
    }

    /// One rung up, or none past the base: the climb above it needs coefficients measured on
    /// this machine at setup (R6), which the meter doesn't have yet.
    fn up(self) -> Option<Rung> {
        (self > Rung::Base).then(|| LADDER[self.index() - 1])
    }

    pub fn effects(self) -> bool {
        self < Rung::EffectsOff
    }

    pub fn lod_down(self) -> bool {
        self >= Rung::LodDown
    }

    /// The internal scale at this rung over the class's base scale, never below 0.5.
    pub fn scale(self, base: f64) -> f64 {
        if self >= Rung::InternalScaleDown {
            (base * 0.5).max(SCALE_FLOOR)
        } else {
            base
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reason {
    Initial,
    Headroom,
    FrameHealth,
    Battery,
    You,
}

impl Reason {
    pub fn name(self) -> &'static str {
        match self {
            Reason::Initial => "initial",
            Reason::Headroom => "headroom",
            Reason::FrameHealth => "frame_health",
            Reason::Battery => "battery",
            Reason::You => "you",
        }
    }
}

/// Consecutive presented frames over the limit that step a layer down.
pub const DOWN_AFTER: u32 = 30;
/// Consecutive frames under it, once climbing is allowed, that step it up.
pub const UP_AFTER: u32 = 120;
/// Below this battery level, discharging, the ladder steps down once and stops climbing.
pub const LOW_BATTERY: f64 = 30.0;
pub const RING: usize = 120;
/// The most passes one frame's meter reads.
pub const MAX_PASSES: usize = 64;

/// One ladder change: from (none for the first), to, and why.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Step {
    pub from: Option<Rung>,
    pub to: Rung,
    pub reason: Reason,
}

/// The wrong ladders, each reachable only through a binary's `--planted`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Planted {
    /// Steps on the first slow frame.
    pub steps_on_first_slow_frame: bool,
    /// Steps two rungs at a time.
    pub skips_a_rung: bool,
}

/// One writer layer's ladder: the degrade level, a transition table stepped frame by frame.
#[derive(Clone, Debug)]
pub struct Ladder {
    rung: Rung,
    reason: Reason,
    over: u32,
    under: u32,
    /// The view changed since the last frame-health drop, so the rung may be climbed.
    view_changed: bool,
    battery_low: bool,
    planted: Planted,
}

impl Ladder {
    /// A layer's ladder at its class's base, and its first change.
    pub fn new(planted: Planted) -> (Ladder, Step) {
        let ladder = Ladder {
            rung: Rung::Base,
            reason: Reason::Initial,
            over: 0,
            under: 0,
            view_changed: false,
            battery_low: false,
            planted,
        };
        let step = Step {
            from: None,
            to: Rung::Base,
            reason: Reason::Initial,
        };
        (ladder, step)
    }

    pub fn rung(&self) -> Rung {
        self.rung
    }

    pub fn reason(&self) -> Reason {
        self.reason
    }

    fn go(&mut self, to: Rung, reason: Reason) -> Option<Step> {
        if to == self.rung {
            return None;
        }
        let step = Step {
            from: Some(self.rung),
            to,
            reason,
        };
        self.rung = to;
        self.reason = reason;
        self.over = 0;
        self.under = 0;
        Some(step)
    }

    fn below(&self, rungs: usize) -> Option<Rung> {
        let mut at = self.rung;
        for _ in 0..rungs {
            at = at.down()?;
        }
        Some(at)
    }

    /// One presented frame's charges against the layer's share, its class's frame limits: a
    /// step down after 30 consecutive frames over, a climb after 120 under once allowed.
    pub fn frame(&mut self, gpu_ms: f64, cpu_ms: f64, limits: &Limits) -> Option<Step> {
        let over =
            limits.gpu_ms.is_some_and(|l| gpu_ms > l) || limits.cpu_ms.is_some_and(|l| cpu_ms > l);
        if over {
            self.over += 1;
            self.under = 0;
            let after = if self.planted.steps_on_first_slow_frame {
                1
            } else {
                DOWN_AFTER
            };
            if self.over >= after {
                let rungs = if self.planted.skips_a_rung { 2 } else { 1 };
                let to = self.below(rungs).or_else(|| self.below(1))?;
                let step = self.go(to, Reason::FrameHealth);
                self.view_changed = false;
                return step;
            }
            return None;
        }
        self.over = 0;
        if self.climbs() {
            self.under += 1;
            if self.under >= UP_AFTER {
                let to = self.rung.up()?;
                return self.go(to, Reason::Headroom);
            }
        }
        None
    }

    /// Whether the rung may be climbed now: below the base, not on a low battery, not held by
    /// you, and, after a drop, only once the view has changed.
    fn climbs(&self) -> bool {
        self.rung.up().is_some()
            && !self.battery_low
            && self.reason != Reason::You
            && (self.view_changed || !matches!(self.reason, Reason::FrameHealth | Reason::Battery))
    }

    /// The view changed during this frame: climbing may start, counted from the next frame.
    pub fn view_changed(&mut self) {
        self.view_changed = true;
        self.under = 0;
    }

    /// A battery reading: falling below 30% while discharging steps one rung down and stops
    /// climbing until it's back.
    pub fn battery(&mut self, percent: f64, discharging: bool) -> Option<Step> {
        let low = discharging && percent < LOW_BATTERY;
        let was = std::mem::replace(&mut self.battery_low, low);
        if low && !was {
            let to = self.below(1)?;
            return self.go(to, Reason::Battery);
        }
        None
    }

    /// You set the rung.
    pub fn set(&mut self, to: Rung) -> Option<Step> {
        self.go(to, Reason::You)
    }

    /// One rung down for `reason`, whatever this layer's own frames say: the planted ladder that
    /// steps every writer when one steps.
    pub fn step_down(&mut self, reason: Reason) -> Option<Step> {
        let to = self.below(1)?;
        self.go(to, reason)
    }
}

/// A frame's GPU time: the length of the union of its passes' intervals.
pub fn covered(intervals: &[[f64; 2]]) -> f64 {
    // A copy sorted by start, on the stack: a frame has far fewer than 64 passes.
    let mut total = 0.0;
    let mut sorted = [[0.0f64; 2]; MAX_PASSES];
    let n = intervals.len().min(sorted.len());
    sorted[..n].copy_from_slice(&intervals[..n]);
    let s = &mut sorted[..n];
    // Unstable: the stable sort allocates.
    s.sort_unstable_by(|a, b| a[0].total_cmp(&b[0]));
    let (mut start, mut end) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
    for &[a, b] in s.iter().filter(|[a, b]| b > a) {
        if a > end {
            if end > start {
                total += end - start;
            }
            start = a;
            end = b;
        } else {
            end = end.max(b);
        }
    }
    if end > start {
        total += end - start;
    }
    total
}

/// Each pass's charge, in submission order: the part of its interval after every earlier pass's
/// interval ends.
pub fn charges(intervals: &[[f64; 2]], out: &mut [f64]) {
    let mut latest = f64::NEG_INFINITY;
    for (i, &[a, b]) in intervals.iter().enumerate() {
        out[i] = (b - a.max(latest)).max(0.0);
        latest = latest.max(b);
    }
}

/// The newest 120 frames' charged GPU ms, oldest first when read.
#[derive(Clone, Debug)]
pub struct Ring {
    values: [f64; RING],
    next: usize,
    len: usize,
}

impl Default for Ring {
    fn default() -> Self {
        Ring {
            values: [0.0; RING],
            next: 0,
            len: 0,
        }
    }
}

impl Ring {
    pub fn push(&mut self, ms: f64) {
        self.values[self.next] = ms;
        self.next = (self.next + 1) % RING;
        self.len = (self.len + 1).min(RING);
    }

    pub fn oldest_first(&self) -> impl Iterator<Item = f64> + '_ {
        let start = (self.next + RING - self.len) % RING;
        (0..self.len).map(move |i| self.values[(start + i) % RING])
    }
}

/// A live 3D view's GPU memory estimated from its formats before it shows (GPU surface: "the
/// check's memory estimate counts the slots, the HDR slots and frame history"), in bytes.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Estimate {
    pub scale: f64,
    /// Frames in the history window, 0 without history.
    pub history: u32,
    pub slots: u64,
    pub hdr_slots: u64,
    /// The linear, object-ID and depth targets at the internal scale.
    pub targets: u64,
    /// Below scale 1: the internal-size output and the full-size target between the upscale's
    /// two passes.
    pub upscale: u64,
    pub frame_history: u64,
    /// Effect targets at the internal scale.
    pub effects: u64,
}

impl Estimate {
    pub fn bytes(&self) -> u64 {
        self.slots
            + self.hdr_slots
            + self.targets
            + self.upscale
            + self.frame_history
            + self.effects
    }
}

/// What a view's estimate is made of.
#[derive(Clone, Copy, Debug)]
pub struct Shape {
    pub size: [u32; 2],
    pub slots: u32,
    /// HDR output's slots (an XDR display); headless, none.
    pub hdr: bool,
    pub effects: bool,
}

/// The lowest internal scale and history window a live view may take.
pub const SCALE_FLOOR: f64 = 0.5;
pub const HISTORY_FLOOR: u32 = 2;
/// The share of the cap a fit may estimate: the rest is left for buffers, pipelines and padding
/// the estimate doesn't itemize.
const FIT_SHARE: f64 = 0.95;

pub fn estimate(view: &Shape, scale: f64, history: u32) -> Estimate {
    let full = u64::from(view.size[0]) * u64::from(view.size[1]);
    let internal = (f64::from(view.size[0]) * scale).round().max(1.0) as u64
        * (f64::from(view.size[1]) * scale).round().max(1.0) as u64;
    Estimate {
        scale,
        history,
        slots: u64::from(view.slots) * full * 4,
        hdr_slots: if view.hdr {
            u64::from(view.slots) * full * 8
        } else {
            0
        },
        targets: internal * (8 + 4 + 4),
        upscale: if scale < 1.0 {
            internal * 4 + full * 4
        } else {
            0
        },
        frame_history: u64::from(history) * internal * 8,
        effects: if view.effects { internal * 8 } else { 0 },
    }
}

/// The internal scale and history window that fit `cap`: the class's base scale first, then
/// shorter windows, then lower scales down to 0.5 with a 2-frame window; past that, the floor's
/// estimate as the refusal.
pub fn fit(view: &Shape, base_scale: f64, history: u32, cap: u64) -> Result<Estimate, Estimate> {
    let windows: Vec<u32> = if history == 0 {
        vec![0]
    } else {
        (HISTORY_FLOOR.min(history)..=history).rev().collect()
    };
    let scales = [base_scale, 0.75, SCALE_FLOOR];
    let room = (cap as f64 * FIT_SHARE) as u64;
    let mut last = estimate(view, SCALE_FLOOR, *windows.last().expect("one window"));
    for scale in scales.into_iter().filter(|s| *s <= base_scale) {
        for &w in &windows {
            let e = estimate(view, scale, w);
            if e.bytes() <= room {
                return Ok(e);
            }
            last = e;
        }
    }
    Err(last)
}

#[cfg(test)]
mod tests {
    use super::*;
    use deep_canvas::budget::Class;

    #[test]
    fn a_full_screen_showpiece_fits_by_its_window_and_one_that_cant_is_refused() {
        let view = |size| Shape {
            size,
            slots: 3,
            hdr: false,
            effects: false,
        };
        let cap = Class::Showpiece.limits().gpu_bytes;
        let e = fit(&view([3456, 2234]), 0.5, 8, cap).unwrap();
        assert!(e.history >= 2 && e.history < 8 && e.bytes() < cap, "{e:?}");
        let refused = fit(&view([8192, 8192]), 0.5, 8, cap).unwrap_err();
        assert_eq!((refused.scale, refused.history), (0.5, 2));
        assert!(refused.slots > cap);
    }

    fn run(
        ladder: &mut Ladder,
        frames: std::ops::RangeInclusive<u32>,
        ms: f64,
    ) -> Vec<(u32, Step)> {
        let l = Class::WorkProduct.limits();
        frames
            .filter_map(|f| ladder.frame(ms, 0.0, &l).map(|s| (f, s)))
            .collect()
    }

    #[test]
    fn thirty_frames_over_step_down_one_rung_and_the_count_restarts() {
        let (mut l, _) = Ladder::new(Planted::default());
        let steps = run(&mut l, 1..=75, 3.0);
        let at: Vec<(u32, Rung)> = steps.iter().map(|(f, s)| (*f, s.to)).collect();
        assert_eq!(at, vec![(30, Rung::EffectsOff), (60, Rung::LodDown)]);
        assert!(
            run(&mut l, 76..=700, 1.0).is_empty(),
            "no climb while the view is still"
        );
        l.view_changed();
        let up = run(&mut l, 701..=900, 1.0);
        assert_eq!(
            up.first().map(|(f, s)| (*f, s.to, s.reason)),
            Some((820, Rung::EffectsOff, Reason::Headroom))
        );
    }

    #[test]
    fn one_slow_frame_moves_nothing() {
        let (mut l, _) = Ladder::new(Planted::default());
        assert!(run(&mut l, 1..=149, 1.0).is_empty());
        assert!(run(&mut l, 150..=150, 3.0).is_empty());
        assert!(run(&mut l, 151..=300, 1.0).is_empty());
    }

    #[test]
    fn a_low_battery_steps_down_once_and_stops_the_climb() {
        let (mut l, _) = Ladder::new(Planted::default());
        run(&mut l, 1..=45, 3.0);
        assert_eq!(
            l.battery(25.0, true).map(|s| (s.to, s.reason)),
            Some((Rung::LodDown, Reason::Battery))
        );
        assert!(l.battery(25.0, true).is_none());
        l.view_changed();
        assert!(run(&mut l, 46..=700, 1.0).is_empty());
    }

    #[test]
    fn covered_time_is_the_union_and_charges_follow_earlier_ends() {
        let iv = [[0.0, 2.0], [1.0, 3.0], [3.5, 4.0]];
        assert_eq!(covered(&iv), 3.5);
        let mut c = [0.0; 3];
        charges(&iv, &mut c);
        assert_eq!(c, [2.0, 1.0, 0.5]);
    }

    #[test]
    fn the_ring_keeps_the_newest_120() {
        let mut r = Ring::default();
        for i in 0..300 {
            r.push(f64::from(i));
        }
        let v: Vec<f64> = r.oldest_first().collect();
        assert_eq!((v.len(), v[0], v[119]), (120, 180.0, 299.0));
    }
}
