//! Issue #502: ducking (canvas primitives: Ducking). A bus's gain follows speech spans by a law
//! of t alone, so it seeks as it plays: spans closer than `merge_gap` merge, the gain falls in a
//! straight line in amplitude from 1 at start − attack to depth at the start, stays there to the
//! end + hold and rises in a straight line to 1 over release. Where two spans' ramps overlap the
//! lower gain holds.

use crate::mix::amp;

#[derive(Clone, Debug)]
pub struct Duck {
    /// The merged spans, (start, end) in flicks, in time order and apart.
    spans: Vec<(i64, i64)>,
    /// The gain at depth, as an amplitude.
    depth: f64,
    attack: i64,
    hold: i64,
    release: i64,
}

impl Duck {
    /// Times in flicks, `depth_db` in dB. Two spans merge when the second starts less than
    /// `merge_gap` after the first ends.
    pub fn new(spans: &[(i64, i64)], depth_db: f64, attack: i64, hold: i64, release: i64, merge_gap: i64) -> Duck {
        let mut sorted: Vec<(i64, i64)> = spans.iter().map(|(s, e)| (*s, (*e).max(*s))).collect();
        sorted.sort_unstable();
        let mut merged: Vec<(i64, i64)> = Vec::new();
        for (s, e) in sorted {
            match merged.last_mut() {
                Some(last) if s - last.1 < merge_gap => last.1 = last.1.max(e),
                _ => merged.push((s, e)),
            }
        }
        Duck { spans: merged, depth: amp(depth_db), attack: attack.max(0), hold: hold.max(0), release: release.max(0) }
    }

    /// One span's gain at `t`.
    fn span_gain(&self, (s, e): (i64, i64), t: i64) -> f64 {
        let (down, up) = (s - self.attack, e + self.hold);
        if t <= down || t >= up + self.release {
            1.0
        } else if t < s {
            1.0 + (self.depth - 1.0) * ((t - down) as f64 / self.attack as f64)
        } else if t <= up {
            self.depth
        } else {
            self.depth + (1.0 - self.depth) * ((t - up) as f64 / self.release as f64)
        }
    }

    /// The gain at `t`, as an amplitude: 1 away from every span.
    pub fn at(&self, t: i64) -> f64 {
        // The spans whose ramps hold t: both edges rise with the index, since merged spans lie apart.
        let first = self.spans.partition_point(|sp| sp.1 + self.hold + self.release <= t);
        let end = self.spans.partition_point(|sp| sp.0 - self.attack < t);
        self.spans
            .get(first..end)
            .unwrap_or_default()
            .iter()
            .fold(1.0, |g, sp| g.min(self.span_gain(*sp, t)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::FLICKS;

    const MS: i64 = FLICKS / 1000;

    fn duck(spans: &[(i64, i64)]) -> Duck {
        Duck::new(spans, -12.0, 200 * MS, 300 * MS, 800 * MS, 800 * MS)
    }

    #[test]
    fn the_gain_is_at_depth_from_the_spans_start_and_the_ramp_starts_attack_earlier() {
        let d = duck(&[(2_000 * MS, 3_000 * MS)]);
        let depth = amp(-12.0);
        assert_eq!(d.at(1_800 * MS), 1.0);
        assert!(d.at(1_800 * MS + 1) < 1.0);
        assert!((d.at(1_900 * MS) - (1.0 + depth) / 2.0).abs() < 1e-12);
        assert!(d.at(2_000 * MS - 1) > depth);
        assert_eq!(d.at(2_000 * MS), depth);
        assert_eq!(d.at(3_300 * MS), depth);
        assert!((d.at(3_700 * MS) - (1.0 + depth) / 2.0).abs() < 1e-12);
        assert_eq!(d.at(4_100 * MS), 1.0);
    }

    #[test]
    fn spans_closer_than_the_merge_gap_merge_and_others_keep_the_lower_gain() {
        // 0.5 s apart: one span, at depth across the gap.
        let d = duck(&[(1_000 * MS, 2_000 * MS), (2_500 * MS, 3_000 * MS)]);
        assert_eq!(d.spans, [(1_000 * MS, 3_000 * MS)]);
        assert_eq!(d.at(2_250 * MS), amp(-12.0));
        // 0.9 s apart: two spans; the second's attack starts while the first still releases.
        let d = duck(&[(1_000 * MS, 2_000 * MS), (2_900 * MS, 3_500 * MS)]);
        assert_eq!(d.spans.len(), 2);
        let release = d.span_gain((1_000 * MS, 2_000 * MS), 2_800 * MS);
        let attack = d.span_gain((2_900 * MS, 3_500 * MS), 2_800 * MS);
        assert!(release < 1.0 && attack < 1.0 && release != attack);
        assert_eq!(d.at(2_800 * MS), release.min(attack));
    }
}
