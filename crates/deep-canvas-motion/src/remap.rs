//! Time remaps (canvas primitives: Time remap): parent time to child time, compiled at check to
//! pieces in closed form, so a frame reads one piece however the playhead got there. Each piece
//! floors to a whole flick; a `ramp`'s child time is the integral of its eased rate, never a sum
//! per frame. `hitstop` reads its matches in child time, and `replay` starts only while none runs.

use deep_canvas::ease::{Family, Named, Side};
use deep_canvas::grammar::FLICKS_PER_SECOND;

use crate::curve::Curve;

/// A rate as a whole fraction, so a long span stays exact.
pub type Ratio = (i64, i64);

/// How one piece runs from its start.
#[derive(Clone, Debug, PartialEq)]
pub enum Piece {
    Line(Ratio),
    /// The rate eases from `from` to `to` over `over` flicks.
    Ramp {
        from: f64,
        to: f64,
        over: i64,
        ease: Named,
    },
    /// A channel from parent flicks to child flicks.
    Map(Curve),
}

/// One piece: from parent time `t` it starts at child time `c`; inside a hold or a replay it
/// carries the span `.active` and `.progress` read.
#[derive(Clone, Debug, PartialEq)]
pub struct Seg {
    pub t: i64,
    pub c: i64,
    pub piece: Piece,
    pub active: Option<(i64, i64)>,
}

impl Seg {
    fn line(t: i64, c: i64, rate: Ratio) -> Seg {
        Seg { t, c, piece: Piece::Line(rate), active: None }
    }

    fn inside(self, from: i64, to: i64) -> Seg {
        Seg { active: Some((from, to)), ..self }
    }
}

/// A preset that needs the document's occurrences, resolved once its markers are.
#[derive(Clone, Debug, PartialEq)]
pub enum Pending {
    Hitstop {
        at: Vec<i64>,
        on: Option<crate::occurrence::Filter>,
        hold: i64,
        rejoin: bool,
    },
    Replay {
        on: crate::occurrence::Filter,
        before: i64,
        after: i64,
        rate: Ratio,
    },
    Scrub {
        control: String,
    },
}

/// A time remap and what it targets: a placement, a recipe instance or the `document`.
#[derive(Clone, Debug, PartialEq)]
pub struct Remap {
    pub id: String,
    pub target: String,
    pub segs: Vec<Seg>,
    pub pending: Option<Pending>,
    pub clamp: bool,
}

fn floor_mul(x: i64, (num, den): Ratio) -> i64 {
    let v = (i128::from(x) * i128::from(num)).div_euclid(i128::from(den));
    i64::try_from(v).unwrap_or(if v < 0 { i64::MIN } else { i64::MAX })
}

/// The share of the rate's change `∫₀ᵘ ease` has reached: exact for the eases a ramp names most,
/// a fixed 8-point Gauss–Legendre rule on each half for the rest. Never a sum over frames.
fn integral(ease: Named, u: f64) -> f64 {
    let quad = |x: f64| x * x;
    match ease {
        Named::Penner(Family::Quad, Side::InOut) => {
            if u < 0.5 {
                2.0 * u * quad(u) / 3.0
            } else {
                let r = 1.0 - u;
                u - 0.5 + 2.0 * r * quad(r) / 3.0
            }
        }
        _ => {
            let half = u.min(0.5);
            gauss(&ease, 0.0, half) + if u > 0.5 { gauss(&ease, 0.5, u) } else { 0.0 }
        }
    }
}

fn gauss(ease: &Named, a: f64, b: f64) -> f64 {
    const X: [f64; 4] = [0.183_434_642_495_649_8, 0.525_532_409_916_329, 0.796_666_477_413_626_7, 0.960_289_856_497_536_3];
    const W: [f64; 4] = [0.362_683_783_378_362, 0.313_706_645_877_887_3, 0.222_381_034_453_374_5, 0.101_228_536_290_376_26];
    let (mid, half) = ((a + b) / 2.0, (b - a) / 2.0);
    let sum: f64 = X.iter().zip(W).map(|(x, w)| w * (ease.at(mid + half * x) + ease.at(mid - half * x))).sum();
    sum * half
}

impl Seg {
    fn child(&self, t: i64) -> i64 {
        let x = t - self.t;
        match &self.piece {
            Piece::Line(rate) => self.c + floor_mul(x, *rate),
            Piece::Ramp { from, to, over, ease } => {
                let u = (x as f64 / *over as f64).clamp(0.0, 1.0);
                let share = from * u + (to - from) * integral(*ease, u);
                self.c + (*over as f64 * share).floor() as i64
            }
            Piece::Map(curve) => {
                let mut v = [0.0];
                curve.sample_into(t, &mut v);
                v[0].floor() as i64
            }
        }
    }

    fn rate(&self, t: i64) -> f64 {
        match &self.piece {
            Piece::Line((num, den)) => *num as f64 / *den as f64,
            Piece::Ramp { from, to, over, ease } => {
                let u = ((t - self.t) as f64 / *over as f64).clamp(0.0, 1.0);
                from + (to - from) * ease.at(u)
            }
            Piece::Map(curve) => {
                let mut v = [0.0];
                curve.rate_into(t, &mut v);
                v[0] / FLICKS_PER_SECOND as f64
            }
        }
    }
}

impl Remap {
    fn seg(&self, t: i64) -> Option<&Seg> {
        let i = self.segs.partition_point(|s| s.t <= t);
        i.checked_sub(1).map(|i| &self.segs[i])
    }

    /// The child time at parent time `t`; before the first piece, the parent's.
    pub fn child(&self, t: i64) -> i64 {
        self.seg(t).map_or(t, |s| s.child(t))
    }

    /// The child time's rate at `t`, per parent second.
    pub fn rate(&self, t: i64) -> f64 {
        self.seg(t).map_or(1.0, |s| s.rate(t))
    }

    /// `.active`: inside a hold or a replay.
    pub fn active(&self, t: i64) -> bool {
        self.seg(t).is_some_and(|s| s.active.is_some())
    }

    /// `.progress`: how far through the running hold or replay, 0 outside one.
    pub fn progress(&self, t: i64) -> f64 {
        self.seg(t)
            .and_then(|s| s.active)
            .map_or(0.0, |(from, to)| (t - from) as f64 / (to - from) as f64)
    }

    /// Whether child time can pass the parent's anywhere, the look-ahead the check refuses beside
    /// inputs: at either end of a piece, at a mapped key, or from the last piece on.
    pub fn runs_ahead(&self) -> bool {
        if matches!(self.pending, Some(Pending::Scrub { .. })) {
            return true;
        }
        let ahead = |s: &Seg, t: i64| t >= 0 && s.child(t) > t;
        self.segs.iter().enumerate().any(|(i, s)| {
            let keys = match &s.piece {
                Piece::Map(curve) => curve.keys.iter().any(|k| ahead(s, k.t)),
                _ => false,
            };
            let end = self.segs.get(i + 1).is_some_and(|n| ahead(s, n.t - 1));
            keys || end || ahead(s, s.t.max(0))
        }) || self.segs.last().is_some_and(|s| s.rate(s.t.max(0)) > 1.0)
    }
}

/// `reverse` over `span`: child time runs back from it, held at the ends.
pub fn reverse(span: i64) -> Vec<Seg> {
    vec![
        Seg::line(i64::MIN / 2, span, (0, 1)),
        Seg::line(0, span, (-1, 1)),
        Seg::line(span, 0, (0, 1)),
    ]
}

/// `hold_at {at, for}`: child time holds at `at` for `len`, then runs on behind by `len`.
pub fn hold_at(at: i64, len: i64) -> Vec<Seg> {
    vec![Seg::line(at, at, (0, 1)), Seg::line(at + len, at, (1, 1))]
}

/// `ramp {from, to, at, over, ease}`: the rate is `from` up to `at`, eases to `to` over `over`, then
/// stays `to`; child time is that rate's integral.
pub fn ramp(from: Ratio, to: Ratio, at: i64, over: i64, ease: Named) -> Vec<Seg> {
    let r = |(n, d): Ratio| n as f64 / d as f64;
    let start = floor_mul(at, from);
    let piece = Piece::Ramp { from: r(from), to: r(to), over, ease };
    let eased = Seg { t: at, c: start, piece, active: None };
    let end = eased.child(at + over);
    vec![Seg::line(0, 0, from), eased, Seg::line(at + over, end, to)]
}

/// `hitstop`, `then: lag`: each match in child time holds for `hold`, and child time runs on
/// behind by every hold so far; two matches on one flick hold once.
pub fn hitstop_lag(matches: &[i64], hold: i64) -> Vec<Seg> {
    let mut segs = Vec::new();
    let mut shift = 0;
    for m in unique(matches) {
        let t = m + shift;
        segs.push(Seg::line(t, m, (0, 1)).inside(t, t + hold));
        shift += hold;
        segs.push(Seg::line(t + hold, m, (1, 1)));
    }
    segs
}

/// The planted `then: lag` that matches in parent time: each hold starts at its match's parent
/// flick, wherever child time has got to.
pub fn hitstop_lag_in_parent_time(matches: &[i64], hold: i64) -> Vec<Seg> {
    let mut segs = Vec::new();
    let mut shift = 0;
    for t in unique(matches) {
        segs.push(Seg::line(t, t - shift, (0, 1)).inside(t, t + hold));
        segs.push(Seg::line(t + hold, t - shift, (1, 1)));
        shift += hold;
    }
    segs
}

/// The planted ramp: child time as the sum of the rate times the frame step, held between frames.
pub fn summed_per_frame(remap: &Remap, step: i64, end: i64) -> Vec<Seg> {
    let mut sum = 0.0;
    (0..=end / step)
        .map(|k| {
            let seg = Seg::line(k * step, sum as i64, (0, 1));
            sum += remap.rate(k * step) * step as f64;
            seg
        })
        .collect()
}

/// `hitstop`, `then: rejoin`: after each hold child time runs at twice its parent's rate until it
/// meets parent time; a match during that run starts a new hold.
pub fn hitstop_rejoin(matches: &[i64], hold: i64) -> Vec<Seg> {
    let mut segs = Vec::new();
    // Where child time last left a hold, parent and child, and the parent time it meets again.
    let mut behind: Option<(i64, i64, i64)> = None;
    for m in unique(matches) {
        let t = match behind {
            Some((_, _, meet)) if meet <= m => {
                segs.push(Seg::line(meet, meet, (1, 1)));
                m
            }
            Some((left, c, _)) => left + (m - c + 1).div_euclid(2),
            None => m,
        };
        segs.push(Seg::line(t, m, (0, 1)).inside(t, t + hold));
        segs.push(Seg::line(t + hold, m, (2, 1)));
        behind = Some((t + hold, m, 2 * (t + hold) - m));
    }
    if let Some((_, _, meet)) = behind {
        segs.push(Seg::line(meet, meet, (1, 1)));
    }
    segs
}

fn unique(matches: &[i64]) -> Vec<i64> {
    let mut list = matches.to_vec();
    list.sort_unstable();
    list.dedup();
    list
}

/// `replay`: at each occurrence that comes while none runs, child time jumps back by `before` and
/// runs at `rate` until it reaches `after` past the occurrence, then shows parent time again. An
/// entry of `ends`, a document-class input, ends a running replay at once.
pub fn replay(occurrences: &[i64], ends: &[i64], before: i64, after: i64, rate: Ratio) -> Vec<Seg> {
    let mut segs = Vec::new();
    let mut free = i64::MIN;
    for tc in unique(occurrences) {
        if tc < free {
            continue;
        }
        let run = i128::from(before + after) * i128::from(rate.1);
        let num = i128::from(rate.0);
        let end = tc + i64::try_from((run + num - 1).div_euclid(num)).unwrap_or(i64::MAX / 2);
        let end = ends.iter().copied().filter(|e| *e > tc && *e < end).min().unwrap_or(end);
        segs.push(Seg::line(tc, tc - before, rate).inside(tc, end));
        segs.push(Seg::line(end, end, (1, 1)));
        free = end;
    }
    segs
}

/// `scrub {control}`: child time is the control's value in seconds, held between its entries.
pub fn scrub(entries: &[(i64, f64)], default: f64) -> Vec<Seg> {
    let flicks = |v: f64| (v * FLICKS_PER_SECOND as f64).floor() as i64;
    std::iter::once(Seg::line(i64::MIN / 2, flicks(default), (0, 1)))
        .chain(entries.iter().map(|&(t, v)| Seg::line(t, flicks(v), (0, 1))))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: i64 = FLICKS_PER_SECOND;

    fn at(segs: Vec<Seg>) -> Remap {
        Remap { id: "r".into(), target: "p".into(), segs, pending: None, clamp: true }
    }

    fn secs(s: f64) -> i64 {
        (s * S as f64).round() as i64
    }

    #[test]
    fn a_hitstop_rejoin_catches_up_and_a_match_in_the_run_starts_a_new_hold() {
        let r = at(hitstop_rejoin(&[S, 2 * S], secs(0.14)));
        for (t, c) in [(1.07, 1.0), (1.2, 1.12), (1.5, 1.5), (2.1, 2.0), (2.21, 2.14), (3.0, 3.0)] {
            assert_eq!(r.child(secs(t)), secs(c), "{t}");
        }
        // Held at 1.0 until 1.4, then twice the rate from there: a match at child 1.1 lands in
        // the run at parent 1.45.
        let r = at(hitstop_rejoin(&[S, secs(1.1)], secs(0.4)));
        assert_eq!(r.child(secs(1.45)), secs(1.1));
        assert!(r.active(secs(1.5)));
        assert_eq!(r.child(secs(1.85)), secs(1.1));
    }

    #[test]
    fn a_ramp_reads_its_integral_for_any_ease() {
        let quad = Named::Penner(Family::Quad, Side::InOut);
        let r = at(ramp((12, 5), (1, 4), secs(1.2), secs(0.7), quad));
        assert!((r.child(secs(1.55)) as f64 / S as f64 - 3.594_583).abs() < 1e-6);
        let smooth = at(ramp((12, 5), (1, 4), secs(1.2), secs(0.7), Named::Smoothstep));
        // Smoothstep over the whole ramp averages one half, as in_out_quad does.
        assert!((smooth.child(secs(1.9)) as f64 / S as f64 - 3.8075).abs() < 1e-6);
    }
}
