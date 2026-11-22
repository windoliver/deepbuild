//! The world's `solver` (World and backend): its contact frequency and damping, its speed cap, its
//! thresholds, its sleep and, #2308, `length_unit`, the length a backend scales its own lengths by.

use serde_json::Value;

use super::Reader;

#[derive(Clone, Debug, PartialEq)]
pub struct Sleep {
    pub on: bool,
    pub speed: f64,
    pub time: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Solver {
    pub contact_hz: f64,
    pub contact_damping: f64,
    pub max_speed: f64,
    pub restitution_threshold: f64,
    pub hit_threshold: f64,
    pub sleep: Sleep,
    pub ccd: bool,
    pub length_unit: f64,
}

/// #2309: the stiffest contact a step settles, Hz: (step rate × substeps) ÷ 6.
pub fn most_contact_hz(step_rate: f64, substeps: f64) -> f64 {
    step_rate * substeps / 6.0
}

impl Reader {
    /// The solver; unwritten, `contact_hz` is the lower of 30 Hz and `most` (#2309).
    pub(super) fn solver(&mut self, v: &Value, most: f64) -> Solver {
        let p = "solver";
        let s = &self.obj(
            v,
            p,
            &[
                "contact_hz",
                "contact_damping",
                "max_speed",
                "restitution_threshold",
                "hit_threshold",
                "sleep",
                "ccd",
                "length_unit",
            ],
        );
        let sl = &self.obj(
            s.get("sleep").unwrap_or(&Value::Null),
            "solver/sleep",
            &["on", "speed", "time"],
        );
        let hz = most.min(30.0);
        Solver {
            contact_hz: self.num(s, "contact_hz", p, hz, f64::MIN_POSITIVE, f64::MAX),
            contact_damping: self.num(s, "contact_damping", p, 10.0, 0.0, f64::MAX),
            max_speed: self.num(s, "max_speed", p, 400.0, f64::MIN_POSITIVE, f64::MAX),
            restitution_threshold: self.num(s, "restitution_threshold", p, 0.0, 0.0, f64::MAX),
            hit_threshold: self.num(s, "hit_threshold", p, 1.0, 0.0, f64::MAX),
            sleep: Sleep {
                on: self.flag(sl, "on", "solver/sleep", true),
                speed: self.num(sl, "speed", "solver/sleep", 0.05, 0.0, f64::MAX),
                time: self.num(sl, "time", "solver/sleep", 0.5, 0.0, f64::MAX),
            },
            ccd: self.flag(s, "ccd", p, true),
            length_unit: self.num(s, "length_unit", p, 1.0, f64::MIN_POSITIVE, 1.0),
        }
    }
}
