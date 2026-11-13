//! Follow channels (canvas primitives: Follow): a channel that follows a source holding constant
//! between its changes. Each segment between changes is solved in closed form from the state at
//! its start, and the segments are built once per source, so a frame is a binary search and one
//! closed form however the playhead got there: nothing steps from an earlier frame.

use deep_canvas::grammar::FLICKS_PER_SECOND;
use deep_canvas::interval::Iv;

use crate::curve::Bezier;
use crate::spring::Spring;
use deep_canvas::ease::Named;

/// How a transition moves from where the value is to its new target.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Along {
    Linear,
    Ease(Named),
    Bezier(Bezier),
}

impl Along {
    fn at(&self, u: f64) -> f64 {
        match self {
            Along::Linear => u,
            Along::Ease(e) => e.at(u),
            Along::Bezier(b) => b.solve(u).y,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Model {
    /// Toward the target at rate (target − value) ÷ tau, with tau_up while rising and tau_down
    /// while falling.
    FirstOrder {
        tau_up: f64,
        tau_down: f64,
    },
    Spring(Spring),
    /// Toward the target at `max` per second, then held.
    RateLimit {
        max: f64,
    },
    /// From the value at the change to the new target over `span` flicks.
    Transition {
        span: i64,
        along: Along,
    },
}

/// What a follow channel follows: keys, each held until the next, or a control's value, which
/// changes only at the input track's entries.
#[derive(Clone, Debug, PartialEq)]
pub enum Source {
    Keys(Vec<(i64, f64)>),
    Control(String),
}

/// A follow channel as the document writes it (Follow: `follow: {source, model, outputs}`).
#[derive(Clone, Debug, PartialEq)]
pub struct Spec {
    pub source: Source,
    pub model: Model,
    /// Whether `rate` and `integral` are among its outputs.
    pub rate: bool,
    pub integral: bool,
}

/// The value, its rate (per second) and its running integral (value × seconds) at one time.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Out {
    pub value: f64,
    pub rate: f64,
    pub integral: f64,
}

/// One segment: from a change of the source to the next, with the state it starts in.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    pub t: i64,
    pub target: f64,
    pub start: Out,
}

/// A follow channel's segments over its source's changes, built once per source.
#[derive(Clone, Debug, PartialEq)]
pub struct Follow {
    pub model: Model,
    pub segments: Vec<Segment>,
}

fn seconds(flicks: i64) -> f64 {
    flicks as f64 / FLICKS_PER_SECOND as f64
}

impl Follow {
    /// Segments from `initial` at rest, then each `(t, value)` change of the source in time
    /// order, each starting from the state the previous one reaches at its flick.
    pub fn new(model: Model, initial: f64, changes: &[(i64, f64)]) -> Follow {
        Follow::with(model, initial, changes, false)
    }

    /// [`Follow::new`]; with `restart`, the planted transition that starts each change from the
    /// old target rather than from where the value is.
    pub fn with(model: Model, initial: f64, changes: &[(i64, f64)], restart: bool) -> Follow {
        let mut segments = vec![Segment {
            t: i64::MIN,
            target: initial,
            start: Out {
                value: initial,
                rate: 0.0,
                integral: 0.0,
            },
        }];
        for &(t, target) in changes {
            let last = segments[segments.len() - 1];
            let start = if last.t == i64::MIN {
                // At rest before the first change; the integral counts from time 0.
                Out {
                    value: initial,
                    rate: 0.0,
                    integral: initial * seconds(t),
                }
            } else {
                let mut at = solve(model, &last, t);
                if restart {
                    at.value = last.target;
                }
                at
            };
            segments.push(Segment { t, target, start });
        }
        Follow { model, segments }
    }

    /// The state at `t`: the segment that owns it by binary search, then its closed form.
    pub fn at(&self, t: i64) -> Out {
        let s = &self.segments[self.owner(t)];
        if s.t == i64::MIN {
            return Out {
                value: s.start.value,
                rate: 0.0,
                integral: s.start.value * seconds(t),
            };
        }
        solve(self.model, s, t)
    }
}

impl Follow {
    fn owner(&self, t: i64) -> usize {
        self.segments
            .partition_point(|s| s.t <= t)
            .saturating_sub(1)
    }

    /// #504: the earliest time after `t` at which the value may differ: the next flick while a
    /// segment moves, the next change otherwise, `None` once nothing changes again.
    pub fn next_change(&self, t: i64) -> Option<i64> {
        let i = self.owner(t);
        let s = &self.segments[i];
        let moving = s.t != i64::MIN
            && match self.model {
                Model::Transition { span, .. } => t - s.t < span && s.start.value != s.target,
                Model::RateLimit { max } => {
                    seconds(t - s.t) < (s.start.value - s.target).abs() / max
                }
                _ => s.start.value != s.target || s.start.rate != 0.0,
            };
        if moving {
            return Some(t + 1);
        }
        self.segments.get(i + 1).map(|s| s.t)
    }

    /// #504: the value's bound over the flicks `[a, b]`, given its values there: the hull of the
    /// two where the model moves monotonely inside one segment (a transition by its ease's
    /// interval form); `None` where a change falls inside, or a spring may turn.
    pub fn window(&self, a: i64, b: i64, at_a: f64, at_b: f64) -> Option<Iv> {
        let i = self.owner(a);
        if self.segments.get(i + 1).is_some_and(|n| n.t <= b) {
            return None;
        }
        let s = &self.segments[i];
        let ends = Iv::new(at_a.min(at_b), at_a.max(at_b));
        if s.t == i64::MIN {
            return Some(ends);
        }
        match self.model {
            Model::FirstOrder { .. } | Model::RateLimit { .. } => Some(ends),
            Model::Spring(_) => None,
            Model::Transition { span, along } => {
                if span <= 0 {
                    return Some(ends);
                }
                let u = Iv::new(
                    ((a - s.t) as f64 / span as f64).clamp(0.0, 1.0),
                    ((b - s.t) as f64 / span as f64).clamp(0.0, 1.0),
                );
                let w = match along {
                    Along::Linear => u,
                    Along::Ease(e) => e.bound(u),
                    Along::Bezier(z) => Iv::new(0f64.min(z.y1).min(z.y2), 1f64.max(z.y1).max(z.y2)),
                };
                let (x0, x1) = (s.start.value, s.target);
                let (p, q) = (x0 + (x1 - x0) * w.lo, x0 + (x1 - x0) * w.hi);
                let e = 4.0 * f64::EPSILON * x0.abs().max(x1.abs()).max(1.0);
                Some(Iv::new(p.min(q) - e, p.max(q) + e).hull(ends))
            }
        }
    }

    /// The planted stepper: from the previous frame's state toward the target now, as if
    /// nothing changed between, so how the playhead got here changes the value.
    pub fn step_from(&self, last: Option<(i64, Out)>, t: i64) -> Out {
        let Some((at, out)) = last else {
            return self.at(t);
        };
        let target = self.segments[self.owner(t)].target;
        solve(
            self.model,
            &Segment {
                t: at,
                target,
                start: out,
            },
            t,
        )
    }
}

/// The state `t` reaches inside segment `s`.
fn solve(model: Model, s: &Segment, t: i64) -> Out {
    let dt = seconds(t - s.t);
    let (x0, v0, i0, target) = (s.start.value, s.start.rate, s.start.integral, s.target);
    let e0 = x0 - target;
    match model {
        Model::Spring(spring) => {
            let m = spring.at(e0, v0, dt);
            Out {
                value: target + m.e,
                rate: m.rate,
                integral: i0 + target * dt + spring.integral(e0, v0, dt),
            }
        }
        Model::FirstOrder { tau_up, tau_down } => {
            let tau = if target > x0 { tau_up } else { tau_down };
            let k = deep_canvas::ops::exp(-dt / tau);
            Out {
                value: target + e0 * k,
                rate: -e0 / tau * k,
                integral: i0 + target * dt + e0 * tau * (1.0 - k),
            }
        }
        Model::RateLimit { max } => {
            let reach = e0.abs() / max;
            let dir = if e0 > 0.0 { -1.0 } else { 1.0 };
            if dt < reach {
                Out {
                    value: x0 + dir * max * dt,
                    rate: dir * max,
                    integral: i0 + x0 * dt + 0.5 * dir * max * dt * dt,
                }
            } else {
                let moving = x0 * reach + 0.5 * dir * max * reach * reach;
                Out {
                    value: target,
                    rate: 0.0,
                    integral: i0 + moving + target * (dt - reach),
                }
            }
        }
        Model::Transition { span, along } => {
            let into = t - s.t;
            if into >= span {
                Out {
                    value: target,
                    rate: 0.0,
                    integral: 0.0,
                }
            } else {
                let u = into as f64 / span as f64;
                Out {
                    value: x0 + (target - x0) * along.at(u),
                    rate: 0.0,
                    integral: 0.0,
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: i64 = FLICKS_PER_SECOND;

    #[test]
    fn a_transition_interrupted_midway_starts_from_where_the_value_is() {
        let model = Model::Transition {
            span: S / 5,
            along: Along::Ease(deep_canvas::ease::named("out_cubic", None).unwrap()),
        };
        let f = Follow::new(model, 17.0, &[(S, 47.0), (S + S / 10, 17.0)]);
        assert_eq!(f.at(S).value, 17.0);
        assert_eq!(f.segments[2].start.value, 43.25);
        assert_eq!(f.at(S + S / 5).value, 20.28125);
        assert_eq!(f.at(S + 3 * S / 10).value, 17.0);
    }
}
