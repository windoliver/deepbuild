//! The over-class fix's choice (issue #1937): a scene over its class is fixed by the set of
//! candidate patches that changes the kept subject least while its measured gains reach the
//! budget. Each candidate is scored by its measured cost delta and by the share of the subject's
//! pixels whose OKLab differs by more than 0.02 in a render-back; sets are tried by least summed
//! share, and the one named is re-measured together. A prediction more than 25% off its
//! measurement is an estimate. A set changing the subject by more than 5% is only offered.

use deep_canvas::color::{srgb_to_oklab, Srgb};

/// The OKLab distance past which a subject pixel counts as changed.
pub const CHANGED: f64 = 0.02;
/// The subject share past which a set is offered as a choice, never applied.
pub const ASK_OVER: f64 = 0.05;
/// How far a prediction may be from its measurement before it is marked an estimate.
pub const PREDICTION: f64 = 0.25;
/// The most candidates the choice weighs (2⁸ − 1 sets).
pub const MOST: usize = 8;

/// The share of the subject's pixels whose OKLab distance between `before` and `after` exceeds
/// [`CHANGED`]. Both pictures are RGBA8 in encoded sRGB, `ids` the object-ID target of `before`,
/// one per pixel; `subject` says which IDs are the subject's. None when no pixel is the subject's.
pub fn share(
    before: &[u8],
    after: &[u8],
    ids: &[u32],
    subject: impl Fn(u32) -> bool,
) -> Option<f64> {
    let lab = |p: &[u8]| {
        let c = |v: u8| f64::from(v) / 255.0;
        srgb_to_oklab(Srgb {
            r: c(p[0]),
            g: c(p[1]),
            b: c(p[2]),
        })
    };
    let (mut seen, mut changed) = (0usize, 0usize);
    for ((a, b), &id) in before
        .as_chunks::<4>()
        .0
        .iter()
        .zip(after.as_chunks::<4>().0)
        .zip(ids)
    {
        if !subject(id) {
            continue;
        }
        seen += 1;
        let (a, b) = (lab(a), lab(b));
        let d = ((a.l - b.l).powi(2) + (a.a - b.a).powi(2) + (a.b - b.b).powi(2)).sqrt();
        changed += usize::from(d > CHANGED);
    }
    (seen > 0).then(|| changed as f64 / seen as f64)
}

/// Whether a predicted delta is more than [`PREDICTION`] of its measured delta away from it.
pub fn estimate(predicted_ms: f64, measured_ms: f64) -> bool {
    (predicted_ms - measured_ms).abs() > PREDICTION * measured_ms.abs()
}

/// Every set of candidates whose summed measured delta reaches `over_ms`, least summed share
/// first, then fewest candidates, then by candidate order. Each candidate is `(delta_ms, share)`;
/// one with no measured delta or share joins no set. Only the first [`MOST`] are weighed.
pub fn order(scored: &[(Option<f64>, Option<f64>)], over_ms: f64) -> Vec<Vec<usize>> {
    let n = scored.len().min(MOST);
    let mut sets: Vec<(f64, Vec<usize>)> = (1u32..1 << n)
        .filter_map(|mask| {
            let set: Vec<usize> = (0..n).filter(|i| mask & (1 << i) != 0).collect();
            let (mut delta, mut share) = (0.0, 0.0);
            for &i in &set {
                let (Some(d), Some(s)) = scored[i] else {
                    return None;
                };
                delta += d;
                share += s;
            }
            (delta >= over_ms).then_some((share, set))
        })
        .collect();
    sets.sort_by(|(sa, a), (sb, b)| {
        sa.total_cmp(sb)
            .then(a.len().cmp(&b.len()))
            .then_with(|| a.cmp(b))
    });
    sets.into_iter().map(|(_, set)| set).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const GREY: [u8; 4] = [128, 128, 128, 255];
    const DARK: [u8; 4] = [40, 40, 40, 255];

    fn picture(px: &[[u8; 4]]) -> Vec<u8> {
        px.concat()
    }

    #[test]
    fn share_counts_only_changed_subject_pixels() {
        let before = picture(&[GREY, GREY, GREY, GREY, GREY]);
        // Pixel 1 (subject) and pixel 4 (not the subject) change.
        let after = picture(&[GREY, DARK, GREY, GREY, DARK]);
        let ids = [7, 7, 7, 7, 9];
        assert_eq!(share(&before, &after, &ids, |id| id == 7), Some(0.25));
        assert_eq!(share(&before, &before, &ids, |id| id == 7), Some(0.0));
        assert_eq!(share(&before, &after, &ids, |id| id == 3), None);
    }

    #[test]
    fn share_counts_a_change_only_past_the_threshold() {
        // One sRGB step on mid grey is about 0.003 in OKLab, well under 0.02; forty steps are far
        // over it. Find the smallest step over 0.02 and check it and the one below.
        let lab = |v: u8| {
            srgb_to_oklab(Srgb {
                r: f64::from(v) / 255.0,
                g: f64::from(v) / 255.0,
                b: f64::from(v) / 255.0,
            })
            .l
        };
        let step = (1u8..=60)
            .find(|s| (lab(128 + s) - lab(128)).abs() > CHANGED)
            .unwrap();
        let ids = [1];
        let over = [128 + step, 128 + step, 128 + step, 255];
        let under = [128 + step - 1, 128 + step - 1, 128 + step - 1, 255];
        assert_eq!(share(&GREY, &over, &ids, |_| true), Some(1.0));
        assert_eq!(share(&GREY, &under, &ids, |_| true), Some(0.0));
    }

    #[test]
    fn estimate_is_more_than_a_quarter_off() {
        assert!(!estimate(4.0, 5.0));
        assert!(estimate(3.0, 5.0));
        assert!(estimate(6.5, 5.0));
        assert!(!estimate(0.0, 0.0));
        assert!(estimate(1.0, 0.0));
    }

    /// The fixture's shape: the key light's shadow alone reaches the budget but changes 30% of
    /// the subject; the two fills together reach it changing almost nothing.
    #[test]
    fn order_names_the_least_change_that_reaches() {
        let scored = [
            (Some(5.0), Some(0.30)),
            (Some(2.5), Some(0.004)),
            (Some(2.5), Some(0.0)),
            (None, Some(0.0)),
        ];
        let sets = order(&scored, 4.0);
        assert_eq!(sets[0], vec![1, 2]);
        assert_eq!(sets[1], vec![0]);
        assert!(sets.iter().all(|s| !s.contains(&3)));
        assert!(order(&scored, 11.0).is_empty());
    }

    /// Against brute force over seeded inputs: exactly the reaching sets, by summed share.
    #[test]
    fn order_matches_brute_force() {
        let mut z = 0x9E37_79B9_7F4A_7C15u64;
        let mut next = || {
            z ^= z << 13;
            z ^= z >> 7;
            z ^= z << 17;
            (z >> 11) as f64 / (1u64 << 53) as f64
        };
        for _ in 0..200 {
            let n = 1 + (next() * MOST as f64) as usize;
            let scored: Vec<_> = (0..n)
                .map(|_| {
                    (
                        if next() < 0.1 {
                            None
                        } else {
                            Some(next() * 4.0)
                        },
                        Some(next()),
                    )
                })
                .collect();
            let over = next() * 6.0;
            let sets = order(&scored, over);
            let sum = |s: &[usize], f: fn(&(Option<f64>, Option<f64>)) -> f64| {
                s.iter().map(|&i| f(&scored[i])).sum::<f64>()
            };
            let reach = (1u32..1 << n).filter(|m| {
                let s: Vec<usize> = (0..n).filter(|i| m & (1 << i) != 0).collect();
                s.iter().all(|&i| scored[i].0.is_some()) && sum(&s, |c| c.0.unwrap_or(0.0)) >= over
            });
            assert_eq!(sets.len(), reach.count());
            for w in sets.windows(2) {
                assert!(sum(&w[0], |c| c.1.unwrap()) <= sum(&w[1], |c| c.1.unwrap()));
            }
        }
    }
}
