//! Issue #467: the 2D fields films need (canvas primitives: Frame and group: y sort; Frame and
//! group: parallax). Each is closed form in t and the camera pose, so seeking equals playing.

use serde_json::{Map, Value};

use crate::scene::{num, Refused};

/// How far a looping parallax band may be from a whole number of repeats over the span, in u.
pub const LOOP_TOLERANCE: f64 = 1e-3;

/// The most copies a repeat draws per axis.
pub const MAX_REPEAT_COUNT: u64 = 8;

/// `parallax {rate, repeat, repeat_count, drift, origin}` on a group.
#[derive(Clone, Debug, PartialEq)]
pub struct Parallax {
    pub rate: [f64; 2],
    /// Per axis, the repeat in u; `None` on an axis that doesn't repeat.
    pub repeat: [Option<f64>; 2],
    pub repeat_count: u64,
    pub drift: [f64; 2],
    pub origin: [f64; 2],
}

fn pair(v: Option<&Value>, default: [f64; 2], path: &str) -> Result<[f64; 2], Refused> {
    match v {
        None | Some(Value::Null) => Ok(default),
        Some(Value::Array(l)) if l.len() == 2 => match (num(l.first()), num(l.get(1))) {
            (Some(a), Some(b)) => Ok([a, b]),
            _ => Err(bad(path)),
        },
        Some(_) => Err(bad(path)),
    }
}

fn bad(path: &str) -> Refused {
    Refused {
        code: "bad_doc",
        path: path.to_string(),
    }
}

impl Parallax {
    /// A group's `params.parallax`, or `None`.
    pub fn read(id: &str, params: &Map<String, Value>) -> Result<Option<Parallax>, Refused> {
        let path = format!("items/{id}/params/parallax");
        let p = match params.get("parallax") {
            None | Some(Value::Null) => return Ok(None),
            Some(Value::Object(p)) => p,
            Some(_) => return Err(bad(&path)),
        };
        let at = |f: &str| format!("{path}/{f}");
        let repeat = match p.get("repeat") {
            None | Some(Value::Null) => [None, None],
            Some(Value::String(s)) if s == "none" => [None, None],
            v => {
                let r = pair(v, [0.0, 0.0], &at("repeat"))?;
                if r.iter().any(|v| *v < 0.0) {
                    return Err(Refused {
                        code: "out_of_range",
                        path: at("repeat"),
                    });
                }
                r.map(|v| (v > 0.0).then_some(v))
            }
        };
        let repeat_count = match p.get("repeat_count") {
            None | Some(Value::Null) => 1,
            Some(v) => v.as_u64().ok_or_else(|| bad(&at("repeat_count")))?,
        };
        if repeat_count == 0 || repeat_count > MAX_REPEAT_COUNT {
            return Err(Refused {
                code: "out_of_range",
                path: at("repeat_count"),
            });
        }
        Ok(Some(Parallax {
            rate: pair(p.get("rate"), [1.0, 1.0], &at("rate"))?,
            repeat,
            repeat_count,
            drift: pair(p.get("drift"), [0.0, 0.0], &at("drift"))?,
            origin: pair(p.get("origin"), [0.0, 0.0], &at("origin"))?,
        }))
    }

    /// The offset before any wrap: origin + camera × (1 − rate) + drift × t, in u.
    pub fn unwrapped(&self, camera: [f64; 2], t_seconds: f64) -> [f64; 2] {
        [0, 1].map(|i| {
            self.origin[i] + camera[i] * (1.0 - self.rate[i]) + self.drift[i] * t_seconds
        })
    }

    /// The group's offset at t: [`Parallax::unwrapped`] wrapped by repeat with a floored modulo.
    pub fn offset(&self, camera: [f64; 2], t_seconds: f64) -> [f64; 2] {
        let o = self.unwrapped(camera, t_seconds);
        [0, 1].map(|i| match self.repeat[i] {
            Some(r) => o[i] - r * (o[i] / r).floor(),
            None => o[i],
        })
    }

    /// Over a looping span of `span` seconds, each repeating axis's jump at the wrap: how far the
    /// band's travel is from a whole number of repeats, in u. Empty when it drifts on no axis
    /// that repeats.
    pub fn loop_jumps(&self, span: f64) -> Vec<(usize, f64)> {
        let mut out = Vec::new();
        for i in 0..2 {
            let Some(r) = self.repeat[i] else { continue };
            let travel = self.drift[i] * span;
            let jump = (travel - r * (travel / r).round()).abs();
            out.push((i, jump));
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn band(repeat: f64, drift: f64) -> Parallax {
        let params = json!({"parallax": {"repeat": [repeat, 0], "drift": [drift, 0]}});
        Parallax::read("g", params.as_object().unwrap())
            .unwrap()
            .unwrap()
    }

    #[test]
    fn a_band_that_travels_whole_repeats_has_no_jump_and_one_that_doesnt_does() {
        let cloud = band(170.0, 170.0 / 4.7);
        assert!(cloud.loop_jumps(4.7)[0].1 < LOOP_TOLERANCE);
        let marquee = band(881.0, -183.5);
        let jump = marquee.loop_jumps(4.8)[0].1;
        assert!((jump - 0.2).abs() < 1e-6, "{jump}");
    }
}
