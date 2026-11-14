//! #1183: a driver var that reads a logic item's output, `<logic ID>.<name>` (Logic `logic@1`:
//! "its own arrays, read as `<logic ID>.<name>`"), from the bake its host wrote into the
//! document's `arrays`, as the core's column view maps it at t (`deep_canvas::columns::map`): a
//! scalar f64 output, held from each step that changed it, or with `interpolate: linear` blended
//! through its step from the value before it, a step late. Folded once at compile, so a frame
//! reads it without allocating.

use deep_canvas::interval::Iv;
use serde_json::Value;

/// A baked scalar output: the step length in flicks, whether it blends, and each step that wrote
/// it with the value written, in step order.
#[derive(Clone, Debug, PartialEq)]
pub struct Read {
    every: i64,
    linear: bool,
    steps: Vec<(i64, f64)>,
}

impl Read {
    /// The bake's `column`, or `None` where it isn't one scalar f64.
    pub fn of(column: &Value) -> Option<Read> {
        if column.get("type")? != "f64" || column.get("count")?.as_u64() != Some(1) {
            return None;
        }
        let mut steps = Vec::new();
        for s in column.get("steps")?.as_array()? {
            let step = s.get("step")?.as_i64()?;
            for run in s
                .get("values")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                if run.get(0).and_then(Value::as_u64) == Some(0) {
                    let v = run.get(1).and_then(|v| v.get(0)).and_then(Value::as_f64);
                    steps.push((step, v?));
                }
            }
        }
        steps.sort_by_key(|s| s.0);
        Some(Read {
            every: column.get("every")?.as_i64()?.max(1),
            linear: column.get("linear").and_then(Value::as_bool) == Some(true),
            steps,
        })
    }

    /// Its value at document time `t` (flicks): 0 before its first write.
    pub fn at(&self, t: i64) -> f64 {
        let k = t.div_euclid(self.every);
        let i = self.steps.partition_point(|s| s.0 <= k);
        let Some(&(step, v)) = i.checked_sub(1).map(|i| &self.steps[i]) else {
            return 0.0;
        };
        if !(self.linear && step == k) {
            return v;
        }
        let before = i.checked_sub(2).map_or(0.0, |j| self.steps[j].1);
        before + (t - k * self.every) as f64 / self.every as f64 * (v - before)
    }

    /// #204: its step, in flicks.
    pub fn every(&self) -> i64 {
        self.every
    }

    /// Every value it takes: the hull of 0 and what it wrote.
    pub(crate) fn bound(&self) -> Iv {
        self.steps
            .iter()
            .fold(Iv::point(0.0), |b, s| Iv::new(b.lo.min(s.1), b.hi.max(s.1)))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn column(linear: bool) -> Value {
        json!({"type": "f64", "count": 1, "every": 100, "linear": linear, "steps": [
            {"step": 0, "changed": [[0, 1]], "values": [[0, [8.8146e-9]]]},
            {"step": 3, "changed": [[0, 1]], "values": [[0, [-8.8146e-9]]]},
            {"step": 5, "changed": [[0, 1]], "values": [[0, [2.0]]]}
        ]})
    }

    #[test]
    fn a_frame_reads_the_output_as_the_column_view_maps_it() {
        for linear in [false, true] {
            let c = column(linear);
            let read = Read::of(&c).expect("one scalar f64");
            for t in (0..800).step_by(7) {
                let mapped = deep_canvas::columns::map(&c, t, None, false).expect("a column");
                assert_eq!(read.at(t), mapped.values[0], "linear {linear} at {t}");
            }
        }
    }

    #[test]
    fn only_one_scalar_f64_is_read_and_its_bound_holds_every_value() {
        assert!(Read::of(&json!({"type": "vec3", "count": 1, "every": 1, "steps": []})).is_none());
        assert!(Read::of(&json!({"type": "f64", "count": 4, "every": 1, "steps": []})).is_none());
        let b = Read::of(&column(false)).expect("a column").bound();
        assert_eq!((b.lo, b.hi), (-8.8146e-9, 2.0));
    }
}
