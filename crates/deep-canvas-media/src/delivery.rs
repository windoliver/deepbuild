//! Issue #502: delivery loudness profiles (canvas primitives: Loudness and caption profiles). A
//! profile is a named set of targets on the loudness bake's readings. An export reaches its
//! integrated target with one static gain, the target less the master's integrated loudness,
//! ahead of the master's true-peak limiter, and at most one correction; a reading outside the
//! profile fails with its numbers, and so does a loudness range the gain changed while the
//! limiter never cut, which only a gain that moves can do.
//!
//! #157: the streaming and podcast rows, streaming's lower ceiling above −14 LUFS, R 128's
//! short-form rule, and the limiter ceiling an export sets from its profile and codec.

use crate::analysis::loudness::Loudness;

/// A value as its page gives it, the page, and the date it was read.
pub type Source = (&'static str, &'static str, &'static str);

/// A shipped loudness profile: its targets and where each value was read.
pub struct Profile {
    pub name: &'static str,
    /// Integrated loudness: the target, LUFS, and its tolerance either way, LU.
    pub integrated: Option<(f64, f64)>,
    /// The highest true peak, dBTP.
    pub true_peak: Option<f64>,
    pub sources: &'static [Source],
    /// #157: a lower true-peak ceiling for a reading louder than a level.
    pub louder: Option<Louder>,
    /// #157: the highest short-term loudness of a short programme.
    pub short_form: Option<ShortForm>,
}

/// #157: above `integrated` LUFS, the true peak is held under `true_peak` dBTP instead.
pub struct Louder {
    pub integrated: f64,
    pub true_peak: f64,
    pub source: Source,
}

/// #157: a programme up to `seconds` long keeps its short-term loudness at or under `max_s` LUFS.
pub struct ShortForm {
    pub seconds: f64,
    pub max_s: f64,
    pub source: Source,
}

/// The pages the #157 rows were read from.
const SHORT_FORM: &str = "EBU R 128 s1 version 3 (August 2020), recommendation d and Definitions";
const STREAMING: &str = "Spotify for Artists, Loudness normalization";
const PODCAST: &str = "Apple Podcasts for Creators, Audio requirements: Best practices, Audio levels";

pub const PROFILES: [Profile; 4] = [
    Profile {
        name: "r128",
        integrated: Some((-23.0, 0.2)),
        true_peak: Some(-1.0),
        sources: &[
            ("Programme Loudness normalised to −23.0 LUFS, with ±0.2 LU allowed for measurement errors", "EBU R 128 version 5.0 (November 2023), recommendations h and i", "2026-11-10"),
            ("the True Peak Level of a programme shall not exceed −1 dBTP", "EBU R 128 version 5.0 (November 2023), recommendation m", "2026-11-10"),
        ],
        louder: None,
        short_form: Some(ShortForm {
            seconds: 120.0,
            max_s: -18.0,
            source: ("the Short-term Loudness Level shall not exceed −18.0 LUFS; short-form content is a programme of up to approximately 2 minutes", SHORT_FORM, "2026-11-11"),
        }),
    },
    Profile {
        name: "streaming",
        integrated: Some((-14.0, 1.0)),
        true_peak: Some(-1.0),
        sources: &[
            ("Target the loudness level of your master at -14dB integrated LUFS", STREAMING, "2026-11-11"),
            ("keep it below -1dB TP (True Peak) max", STREAMING, "2026-11-11"),
        ],
        louder: Some(Louder {
            integrated: -14.0,
            true_peak: -2.0,
            source: ("If your master is louder than -14dB integrated LUFS, keep True Peak below -2dB", STREAMING, "2026-11-11"),
        }),
        short_form: None,
    },
    Profile {
        name: "podcast",
        integrated: Some((-16.0, 1.0)),
        true_peak: Some(-1.0),
        sources: &[
            ("overall loudness around -16 dB LKFS, with a +/- 1 dB tolerance", PODCAST, "2026-11-11"),
            ("the true-peak value doesn't exceed -1 dB FS", PODCAST, "2026-11-11"),
        ],
        louder: None,
        short_form: None,
    },
    Profile { name: "none", integrated: None, true_peak: None, sources: &[], louder: None, short_form: None },
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
    /// #157: for `max_s`, when the loudest short-term window begins, in seconds.
    pub at: Option<f64>,
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

    /// #157: the true-peak ceiling, dBTP, for a reading at `integrated` LUFS.
    fn ceiling(&self, integrated: f64) -> Option<f64> {
        let ceiling = self.true_peak?;
        Some(match &self.louder {
            Some(l) if integrated > l.integrated => ceiling.min(l.true_peak),
            _ => ceiling,
        })
    }

    /// Each of `read`'s readings that lies outside the profile: its integrated loudness, its true
    /// peak under the ceiling at that loudness, and (#157) for a short programme its short-term
    /// maximum, named with when its loudest 3 s begin. The programme's length is the bake's: one
    /// short-term entry per 10 ms.
    pub fn misses(&self, read: &Loudness) -> Vec<Miss> {
        let mut out = Vec::new();
        if let Some((target, tolerance)) = self.integrated {
            if !self.holds(read.integrated) {
                out.push(Miss { measure: "integrated", reading: read.integrated, target, tolerance, at: None });
            }
        }
        if let Some(ceiling) = self.ceiling(read.integrated) {
            if read.true_peak > ceiling {
                out.push(Miss { measure: "true_peak", reading: read.true_peak, target: ceiling, tolerance: 0.0, at: None });
            }
        }
        if let Some(s) = &self.short_form {
            let seconds = read.short_term.len() as f64 / 100.0;
            if seconds <= s.seconds && read.short_term_max > s.max_s {
                // Entry k is the 3 s window ending at (k + 1) × 10 ms.
                let at = read.short_term.iter().position(|v| *v == read.short_term_max).map(|k| ((k + 1) as f64 / 100.0 - 3.0).max(0.0));
                out.push(Miss { measure: "max_s", reading: read.short_term_max, target: s.max_s, tolerance: 0.0, at });
            }
        }
        out
    }

    /// #157: the export's limiter ceiling, dBTP: the profile's true-peak ceiling at its integrated
    /// target, less the true-peak meter's worst under-read at `oversample` (0.69 dB at 4×, 0.17 dB
    /// at 8×, as the limiter rounds its factor) and less `codec`'s margin (0.5 dB for `aac` at
    /// 256 kb/s until measured on the reference encoder, 0 for `pcm`). `None` for a profile with no
    /// ceiling, or a codec with no margin.
    pub fn limiter_ceiling(&self, oversample: u32, codec: &str) -> Option<f64> {
        let under_read = if oversample >= 8 { 0.17 } else { 0.69 };
        let margin = match codec {
            "aac" => 0.5,
            "pcm" => 0.0,
            _ => return None,
        };
        let at = self.integrated.map_or(f64::NEG_INFINITY, |(target, _)| target);
        Some(self.ceiling(at)? - under_read - margin)
    }
}

/// The loudness range comparison: with one static gain and a limiter that never cut, the
/// delivered range is the master's pre-gain range.
pub fn range_kept(before: f64, delivered: f64, limiter_cut: bool) -> Option<Miss> {
    (!limiter_cut && (delivered - before).abs() > LRA_KEPT)
        .then_some(Miss { measure: "lra", reading: delivered, target: before, tolerance: LRA_KEPT, at: None })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analysis::loudness::measure;
    use deep_canvas::ops;

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

    /// #157: a stereo 1 kHz tone at `quiet` dBFS for `seconds`, with its 3 s from 30 s at `loud`
    /// dBFS: at 1 kHz a stereo tone's loudness in LUFS is its level in dBFS.
    fn programme(seconds: usize, quiet: f64, loud: f64) -> Loudness {
        const RATE: usize = 48_000;
        let period: Vec<f64> = (0..48).map(|i| ops::sin(ops::TAU * i as f64 / 48.0)).collect();
        let (q, l) = (ops::pow(10.0, quiet / 20.0), ops::pow(10.0, loud / 20.0));
        let mut x = Vec::with_capacity(2 * seconds * RATE);
        for i in 0..seconds * RATE {
            let a = if (30 * RATE..33 * RATE).contains(&i) { l } else { q };
            let v = (a * period[i % 48]) as f32;
            x.extend([v, v]);
        }
        measure(&x, &[1.0, 1.0], RATE as i64, 1)
    }

    /// The level, dBFS, that puts a 60 s programme with 3 s at `loud` at −23 LUFS integrated.
    fn quiet_for(loud: f64) -> f64 {
        10.0 * ops::log10((60.0 * ops::pow(10.0, -2.3) - 3.0 * ops::pow(10.0, loud / 10.0)) / 57.0)
    }

    #[test]
    fn a_short_r128_programme_whose_loudest_3_s_read_7_lu_over_fails_naming_max_s_and_when() {
        let read = programme(60, quiet_for(-16.0), -16.0);
        assert!((read.integrated + 23.0).abs() <= 0.1, "integrated {}", read.integrated);
        let found = profile("r128").unwrap().misses(&read);
        assert_eq!(found.iter().map(|m| m.measure).collect::<Vec<_>>(), ["max_s"], "{found:?}");
        let m = &found[0];
        assert!((m.reading + 16.0).abs() <= 0.1 && m.target == -18.0, "{m:?}");
        assert!(m.at.is_some_and(|t| (t - 30.0).abs() < 0.015), "the loudest 3 s begin at 30 s: {m:?}");
        // 4.5 LU over its integrated loudness, the same film passes.
        let read = programme(60, quiet_for(-18.5), -18.5);
        assert!((read.integrated + 23.0).abs() <= 0.1, "integrated {}", read.integrated);
        assert_eq!(profile("r128").unwrap().misses(&read), []);
    }

    #[test]
    fn past_2_minutes_r128_holds_no_short_term_maximum() {
        let read = programme(121, -23.2, -16.0);
        assert!(profile("r128").unwrap().misses(&read).iter().all(|m| m.measure != "max_s"));
    }

    #[test]
    fn streaming_holds_minus_1_dbtp_and_minus_2_above_minus_14_lufs() {
        let streaming = profile("streaming").unwrap();
        assert_eq!(streaming.gain(-20.0), Some(6.0));
        let at = |integrated, peak| streaming.misses(&read(integrated, peak)).iter().map(|m| (m.measure, m.reading, m.target)).collect::<Vec<_>>();
        assert_eq!(at(-14.0, -0.7), [("true_peak", -0.7, -1.0)]);
        assert_eq!(at(-13.5, -1.5), [("true_peak", -1.5, -2.0)]);
        assert_eq!(at(-13.5, -2.0), []);
        assert_eq!(at(-14.0, -1.0), []);
        assert_eq!(at(-15.0, -3.0), []);
        assert_eq!(at(-15.1, -3.0).first().map(|m| m.0), Some("integrated"));
    }

    #[test]
    fn podcast_holds_minus_16_within_1_lu_under_minus_1_dbtp() {
        let podcast = profile("podcast").unwrap();
        assert!(podcast.misses(&read(-15.0, -1.0)).is_empty());
        assert_eq!(podcast.misses(&read(-14.9, -0.9)).iter().map(|m| m.measure).collect::<Vec<_>>(), ["integrated", "true_peak"]);
    }

    #[test]
    fn the_limiter_sits_under_the_ceiling_by_the_meters_under_read_and_the_codec_margin() {
        let near = |a: Option<f64>, b: f64| a.is_some_and(|a| (a - b).abs() < 1e-9);
        let streaming = profile("streaming").unwrap();
        assert!(near(streaming.limiter_ceiling(8, "aac"), -1.67), "{:?}", streaming.limiter_ceiling(8, "aac"));
        assert!(near(streaming.limiter_ceiling(4, "aac"), -2.19));
        assert!(near(profile("r128").unwrap().limiter_ceiling(8, "pcm"), -1.17));
        assert_eq!(profile("none").unwrap().limiter_ceiling(8, "aac"), None);
    }

    #[test]
    fn a_rule_a_row_holds_under_a_condition_has_its_own_dated_source() {
        for p in &PROFILES {
            let sources = p.louder.iter().map(|l| l.source).chain(p.short_form.iter().map(|s| s.source));
            for (value, page, read) in sources {
                assert!(!value.is_empty() && !page.is_empty() && read.len() == 10, "{}", p.name);
            }
        }
        assert!(profile("streaming").unwrap().louder.is_some() && profile("r128").unwrap().short_form.is_some());
    }

    #[test]
    fn a_range_that_moved_under_an_idle_limiter_names_lra() {
        assert_eq!(range_kept(12.0, 11.95, false), None);
        assert_eq!(range_kept(12.0, 10.6, false).map(|m| m.measure), Some("lra"));
        assert_eq!(range_kept(12.0, 10.6, true), None);
    }
}
