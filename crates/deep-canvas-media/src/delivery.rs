//! Issue #502: delivery loudness profiles (canvas primitives: Loudness and caption profiles). A
//! profile is a named set of targets on the loudness bake's readings. An export reaches its
//! integrated target with one static gain, the target less the master's integrated loudness,
//! ahead of the master's true-peak limiter, and at most one correction; a reading outside the
//! profile fails with its numbers, and so does a loudness range the gain changed while the
//! limiter never cut, which only a gain that moves can do.

use crate::analysis::loudness::Loudness;

/// A shipped loudness profile: its targets and where each value was read.
pub struct Profile {
    pub name: &'static str,
    /// Integrated loudness: the target, LUFS, and its tolerance either way, LU.
    pub integrated: Option<(f64, f64)>,
    /// The highest true peak, dBTP.
    pub true_peak: Option<f64>,
    pub sources: &'static [(&'static str, &'static str, &'static str)],
}

pub const PROFILES: [Profile; 2] = [
    Profile {
        name: "r128",
        integrated: Some((-23.0, 0.2)),
        true_peak: Some(-1.0),
        sources: &[
            ("Programme Loudness normalised to −23.0 LUFS, with ±0.2 LU allowed for measurement errors", "EBU R 128 version 5.0 (November 2023), recommendations h and i", "2026-11-10"),
            ("the True Peak Level of a programme shall not exceed −1 dBTP", "EBU R 128 version 5.0 (November 2023), recommendation m", "2026-11-10"),
        ],
    },
    Profile { name: "none", integrated: None, true_peak: None, sources: &[] },
];

/// The profile named `name`.
pub fn profile(name: &str) -> Option<&'static Profile> {
    PROFILES.iter().find(|p| p.name == name)
}

/// How far a pre-gain and a delivered loudness range may differ when the limiter never cut, LU.
pub const LRA_KEPT: f64 = 0.1;

/// A reading outside its profile.
#[derive(Clone, Debug, PartialEq)]
pub struct Miss {
    /// `integrated`, `true_peak` or `lra`.
    pub measure: &'static str,
    pub reading: f64,
    /// What it is held to: the target, the ceiling, or the pre-gain range.
    pub target: f64,
    pub tolerance: f64,
}

impl Profile {
    /// The static gain, dB, that takes a master measured at `integrated` to the target: `None`
    /// for a profile with no target, or a master with no loudness to move.
    pub fn gain(&self, integrated: f64) -> Option<f64> {
        let (target, _) = self.integrated?;
        integrated.is_finite().then_some(target - integrated)
    }

    /// Whether `integrated` is inside the profile.
    pub fn holds(&self, integrated: f64) -> bool {
        self.integrated.is_none_or(|(target, tolerance)| (integrated - target).abs() <= tolerance)
    }

    /// Each of `read`'s readings that lies outside the profile.
    pub fn misses(&self, read: &Loudness) -> Vec<Miss> {
        let mut out = Vec::new();
        if let Some((target, tolerance)) = self.integrated {
            if !self.holds(read.integrated) {
                out.push(Miss { measure: "integrated", reading: read.integrated, target, tolerance });
            }
        }
        if let Some(ceiling) = self.true_peak {
            if read.true_peak > ceiling {
                out.push(Miss { measure: "true_peak", reading: read.true_peak, target: ceiling, tolerance: 0.0 });
            }
        }
        out
    }
}

/// The loudness range comparison: with one static gain and a limiter that never cut, the
/// delivered range is the master's pre-gain range.
pub fn range_kept(before: f64, delivered: f64, limiter_cut: bool) -> Option<Miss> {
    (!limiter_cut && (delivered - before).abs() > LRA_KEPT)
        .then_some(Miss { measure: "lra", reading: delivered, target: before, tolerance: LRA_KEPT })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(integrated: f64, true_peak: f64) -> Loudness {
        Loudness {
            momentary: Vec::new(),
            short_term: Vec::new(),
            momentary_max: integrated,
            short_term_max: integrated,
            integrated,
            range: 0.0,
            sample_peak: true_peak,
            true_peak,
        }
    }

    #[test]
    fn r128_takes_a_master_to_minus_23_and_holds_it_within_0_2_lu_under_minus_1_dbtp() {
        let r128 = profile("r128").unwrap();
        assert_eq!(r128.gain(-30.5), Some(7.5));
        assert_eq!(r128.gain(f64::NEG_INFINITY), None);
        assert!(r128.misses(&read(-23.2, -1.0)).is_empty());
        assert_eq!(r128.misses(&read(-22.7, -3.0)).iter().map(|m| m.measure).collect::<Vec<_>>(), ["integrated"]);
        assert_eq!(r128.misses(&read(-23.0, -0.9)).iter().map(|m| m.measure).collect::<Vec<_>>(), ["true_peak"]);
    }

    #[test]
    fn none_holds_no_target_and_applies_no_gain() {
        let none = profile("none").unwrap();
        assert_eq!(none.gain(-30.5), None);
        assert!(none.misses(&read(-3.0, 2.0)).is_empty());
        assert!(profile("r128v3").is_none());
    }

    #[test]
    fn every_target_a_row_holds_has_a_source_with_the_date_it_was_read() {
        for p in &PROFILES {
            let targets = usize::from(p.integrated.is_some()) + usize::from(p.true_peak.is_some());
            assert_eq!(p.sources.len(), targets, "{}", p.name);
            assert!(p.sources.iter().all(|(value, page, read)| !value.is_empty() && !page.is_empty() && read.len() == 10), "{}", p.name);
        }
    }

    #[test]
    fn a_range_that_moved_under_an_idle_limiter_names_lra() {
        assert_eq!(range_kept(12.0, 11.95, false), None);
        assert_eq!(range_kept(12.0, 10.6, false).map(|m| m.measure), Some("lra"));
        assert_eq!(range_kept(12.0, 10.6, true), None);
    }
}
