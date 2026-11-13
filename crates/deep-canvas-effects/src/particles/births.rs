//! Births under a rate a channel keys (Particles `particles@1`: an emitter whose rate falls to 0
//! stops births only). The emitted count n(t) = ∫₀ᵗ rate is built at check from the channel's
//! keys, piece by piece (a held key keeps its rate, a linear one ramps to the next), and the
//! k-th particle is born when n reaches k. Particles already born keep their birth times, so a
//! rate that falls to 0 ends births while each particle lives out its own life.

use serde_json::Value;

/// The emitted count as pieces: from `t0` (s), with `n0` born before it, at a rate `r0` per
/// second changing by `slope` per second.
#[derive(Clone, Debug, PartialEq)]
pub struct Births {
    pub pieces: Vec<[f64; 4]>,
}

impl Births {
    /// The births of item `id` when a channel keys its `emit.rate`; none otherwise.
    pub fn of(doc: &Value, id: &str) -> Option<Births> {
        let target = format!("items/{id}/params/emit/rate");
        let channel = doc["channels"]
            .as_object()?
            .values()
            .find(|c| c["target"] == target.as_str())?;
        let mut keys: Vec<(f64, f64, bool)> = channel["keys"]
            .as_object()?
            .values()
            .filter_map(|k| {
                let t = match &k["t"] {
                    Value::Number(n) => n.as_f64()?,
                    Value::String(text) => super::spec::seconds(doc, text).ok()?,
                    _ => return None,
                };
                let v = k["value"].as_f64()?;
                Some((t, v.max(0.0), k["interp"] == "hold"))
            })
            .collect();
        keys.sort_by(|a, b| a.0.total_cmp(&b.0));
        let first = keys.first()?;
        let mut pieces = vec![[0.0, 0.0, first.1, 0.0]];
        for (i, k) in keys.iter().enumerate() {
            let slope = match keys.get(i + 1) {
                Some(next) if !k.2 && next.0 > k.0 => (next.1 - k.1) / (next.0 - k.0),
                _ => 0.0,
            };
            if k.0 <= 0.0 {
                pieces[0] = [0.0, 0.0, k.1, slope];
                continue;
            }
            let n0 = Self::count(pieces.last().expect("one piece"), k.0);
            pieces.push([k.0, n0, k.1, slope]);
        }
        Some(Births { pieces })
    }

    fn count(p: &[f64; 4], t: f64) -> f64 {
        let dt = t - p[0];
        p[1] + p[2] * dt + 0.5 * p[3] * dt * dt
    }

    /// Particles emitted by t.
    pub fn n(&self, t: f64) -> f64 {
        let k = self.pieces.partition_point(|p| p[0] <= t).max(1) - 1;
        Self::count(&self.pieces[k], t.max(0.0))
    }

    /// When the emitted count reaches `k`.
    pub fn time_of(&self, k: f64) -> f64 {
        let i = self.pieces.partition_point(|p| p[1] <= k).max(1) - 1;
        let p = self.pieces[i];
        let need = k - p[1];
        if p[3].abs() < 1e-12 {
            return p[0] + need / p[2];
        }
        // r0 dt + slope dt² ÷ 2 = need, the root where the count first reaches it.
        let disc = (p[2] * p[2] + 2.0 * p[3] * need).max(0.0);
        p[0] + 2.0 * need / (p[2] + deep_canvas::ops::sqrt(disc))
    }
}
