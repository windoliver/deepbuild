//! Function tables (canvas primitives: Driver: tables; Channel and key: table eases): `{x, y,
//! mode: linear | monotone}`, 2 to 4,096 points, x strictly increasing, every value finite,
//! read by `table(name, x)` and held at its ends. `monotone` is Fritsch and Carlson's piecewise
//! cubic, which keeps each segment between its two knots' values, as `linear` does, so a table's
//! interval form over a range is exact from its knots.

use serde_json::Value;

use crate::interval::Iv;

/// The most points a table holds.
pub const MAX_POINTS: usize = 4096;

/// How a table reads between its knots.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode {
    Linear,
    Monotone,
}

/// A checked function table.
#[derive(Clone, Debug, PartialEq)]
pub struct Table {
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    pub mode: Mode,
    /// Each knot's tangent, for `monotone`.
    m: Vec<f64>,
}

/// Why a table is refused: what breaks, and where (`x[2]`, `y[1]`, the cap), with the index, the
/// cap, the knot or the endpoint it names as a number.
#[derive(Clone, Debug, PartialEq)]
pub struct Refusal {
    pub at: String,
    pub why: String,
    pub index: Option<usize>,
    pub cap: Option<usize>,
    pub knot: Option<usize>,
    pub endpoint: Option<f64>,
}

impl std::fmt::Display for Refusal {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.at, self.why)
    }
}

impl Refusal {
    /// As a refusal names it: where, why and the number it names, for the table `name`.
    pub fn to_json(&self, name: &str) -> Value {
        let mut out = serde_json::json!({"table": name, "at": self.at, "why": self.why});
        let mut put = |k: &str, v: Option<Value>| {
            if let Some(v) = v {
                out[k] = v;
            }
        };
        put("index", self.index.map(Value::from));
        put("cap", self.cap.map(Value::from));
        put("knot", self.knot.map(Value::from));
        put("endpoint", self.endpoint.map(Value::from));
        out
    }

    fn index(mut self, i: usize) -> Refusal {
        self.index = Some(i);
        self
    }
}

fn refuse(at: impl Into<String>, why: impl Into<String>) -> Refusal {
    Refusal {
        at: at.into(),
        why: why.into(),
        index: None,
        cap: None,
        knot: None,
        endpoint: None,
    }
}

fn over_cap(key: &str, n: usize) -> Refusal {
    Refusal {
        cap: Some(MAX_POINTS),
        ..refuse(
            key,
            format!("holds {n} points, past the cap of {MAX_POINTS}"),
        )
    }
}

/// The numbers of `v[key]`: a list of numbers, or `{"f64": <base64>}`, the little-endian f64
/// bytes a data asset holds, so a NaN can reach the check. Any that isn't a finite number is
/// refused, naming its index.
fn numbers(v: &Value, key: &str) -> Result<Vec<f64>, Refusal> {
    let list: Vec<Option<f64>> = match v.get(key) {
        Some(Value::Array(list)) => list.iter().map(Value::as_f64).collect(),
        Some(Value::Object(o)) => {
            let Some(bytes) = o
                .get("f64")
                .and_then(Value::as_str)
                .and_then(crate::base64::decode)
            else {
                return Err(refuse(key, "is not base64 f64 bytes"));
            };
            if bytes.len() % 8 != 0 {
                return Err(refuse(key, "holds bytes that are not whole f64s"));
            }
            let (whole, _) = bytes.as_chunks::<8>();
            whole.iter().map(|c| Some(f64::from_le_bytes(*c))).collect()
        }
        _ => return Err(refuse(key, "is not a list of numbers")),
    };
    if list.len() > MAX_POINTS {
        return Err(over_cap(key, list.len()));
    }
    list.iter()
        .enumerate()
        .map(|(i, n)| match n {
            Some(f) if f.is_finite() => Ok(*f),
            _ => Err(refuse(
                format!("{key}[{i}]"),
                format!("index {i} is not a finite number"),
            )
            .index(i)),
        })
        .collect()
}

impl Table {
    /// A table from its document form, checked: refused naming the index that breaks it, or
    /// the cap.
    ///
    /// JSON has no NaN, so a NaN or an infinity is written as the string `"NaN"`, `"inf"` or
    /// `"-inf"` (or null), and refused as not finite.
    pub fn parse(v: &Value) -> Result<Table, Refusal> {
        let x = numbers(v, "x")?;
        let y = numbers(v, "y")?;
        let mode = match v.get("mode").and_then(Value::as_str) {
            None | Some("linear") => Mode::Linear,
            Some("monotone") => Mode::Monotone,
            Some(m) => {
                return Err(refuse(
                    "mode",
                    format!("`{m}` is neither linear nor monotone"),
                ))
            }
        };
        Table::new(x, y, mode)
    }

    pub fn new(x: Vec<f64>, y: Vec<f64>, mode: Mode) -> Result<Table, Refusal> {
        if x.len() > MAX_POINTS || y.len() > MAX_POINTS {
            return Err(over_cap("x", x.len().max(y.len())));
        }
        if x.len() != y.len() {
            return Err(refuse(
                "y",
                format!("holds {} values for {} x", y.len(), x.len()),
            ));
        }
        if x.len() < 2 {
            return Err(refuse("x", "holds fewer than 2 points"));
        }
        for (i, v) in x.iter().chain(&y).enumerate() {
            if !v.is_finite() {
                let (k, i) = if i < x.len() {
                    ("x", i)
                } else {
                    ("y", i - x.len())
                };
                return Err(
                    refuse(format!("{k}[{i}]"), format!("index {i} is not finite")).index(i),
                );
            }
        }
        if let Some(i) = (1..x.len()).find(|&i| x[i] <= x[i - 1]) {
            return Err(refuse(
                format!("x[{i}]"),
                format!("index {i}: x {} doesn't increase past {}", x[i], x[i - 1]),
            )
            .index(i));
        }
        let m = match mode {
            Mode::Linear => Vec::new(),
            Mode::Monotone => tangents(&x, &y),
        };
        Ok(Table { x, y, mode, m })
    }

    /// The table's value at `t`, held at its ends.
    pub fn at(&self, t: f64) -> f64 {
        let n = self.x.len();
        if t.is_nan() {
            return t;
        }
        if t <= self.x[0] {
            return self.y[0];
        }
        if t >= self.x[n - 1] {
            return self.y[n - 1];
        }
        // The segment [x[i], x[i + 1]) holding t.
        let i = self.x.partition_point(|&k| k <= t) - 1;
        let (x0, x1, y0, y1) = (self.x[i], self.x[i + 1], self.y[i], self.y[i + 1]);
        let h = x1 - x0;
        let s = (t - x0) / h;
        let v = match self.mode {
            Mode::Linear => y0 + (y1 - y0) * s,
            Mode::Monotone => {
                let (s2, s3) = (s * s, s * s * s);
                let h00 = 2.0 * s3 - 3.0 * s2 + 1.0;
                let h10 = s3 - 2.0 * s2 + s;
                let h01 = -2.0 * s3 + 3.0 * s2;
                let h11 = s3 - s2;
                h00 * y0 + h10 * h * self.m[i] + h01 * y1 + h11 * h * self.m[i + 1]
            }
        };
        // Each segment stays between its knots' values; rounding never takes it past them.
        v.clamp(y0.min(y1), y0.max(y1))
    }

    /// The interval form over `r`: the least and greatest of its values at r's ends and at every
    /// knot between, which is exact, since each segment stays between its knots' values.
    pub fn bound(&self, r: Iv) -> Iv {
        if r.is_empty() {
            return r;
        }
        let mut out = Iv::point(self.at(r.lo)).hull(Iv::point(self.at(r.hi)));
        let first = self.x.partition_point(|&k| k < r.lo);
        for i in first..self.x.len() {
            if self.x[i] > r.hi {
                break;
            }
            out = out.hull(Iv::point(self.y[i]));
        }
        out
    }

    /// The least and greatest knot values.
    pub fn extremes(&self) -> (f64, f64) {
        self.y
            .iter()
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &v| {
                (lo.min(v), hi.max(v))
            })
    }
}

/// Fritsch and Carlson's tangents: the secants' harmonic blend, 0 at a local extremum, each
/// limited so the segment's cubic stays monotone and so between its knots.
fn tangents(x: &[f64], y: &[f64]) -> Vec<f64> {
    let n = x.len();
    let d: Vec<f64> = (0..n - 1)
        .map(|i| (y[i + 1] - y[i]) / (x[i + 1] - x[i]))
        .collect();
    let mut m = vec![0.0; n];
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for i in 1..n - 1 {
        m[i] = if d[i - 1] * d[i] <= 0.0 {
            0.0
        } else {
            (d[i - 1] + d[i]) / 2.0
        };
    }
    for i in 0..n - 1 {
        if d[i] == 0.0 {
            m[i] = 0.0;
            m[i + 1] = 0.0;
            continue;
        }
        let (a, b) = (m[i] / d[i], m[i + 1] / d[i]);
        if a < 0.0 {
            m[i] = 0.0;
        }
        if b < 0.0 {
            m[i + 1] = 0.0;
        }
        let (a, b) = (a.max(0.0), b.max(0.0));
        let s = a * a + b * b;
        if s > 9.0 {
            let tau = 3.0 / crate::ops::sqrt(s);
            m[i] = tau * a * d[i];
            m[i + 1] = tau * b * d[i];
        }
    }
    m
}

/// An ease table's `overshoot`: `none` (its knots never decrease), or the range every knot lies in.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Overshoot {
    None,
    Within(f64, f64),
}

/// How far an ease table's ends may sit from 0 and 1.
pub const EASE_END_TOLERANCE: f64 = 1e-9;

/// An ease table: a function table over [0, 1], 0 at 0 and 1 at 1 within 1e-9, monotone or
/// within its declared overshoot (Channel and key: table eases).
#[derive(Clone, Debug, PartialEq)]
pub struct EaseTable {
    pub table: Table,
    pub overshoot: Overshoot,
}

impl EaseTable {
    /// An ease table from its document form, checked: a broken table is refused naming its
    /// index, and an ease that misses an end, dips while monotone or passes its overshoot is
    /// refused naming the endpoint or the knot.
    pub fn parse(v: &Value) -> Result<EaseTable, Refusal> {
        let e = EaseTable::unchecked(v)?;
        e.check_ends()?;
        e.check_shape()?;
        Ok(e)
    }

    /// The table and its overshoot as written, its ease's own rules unchecked (`ease@1`'s kit
    /// checks each apart).
    pub fn unchecked(v: &Value) -> Result<EaseTable, Refusal> {
        let table = Table::parse(v)?;
        let overshoot = match v.get("overshoot") {
            None | Some(Value::Null) => Overshoot::None,
            Some(Value::String(s)) if s == "none" => Overshoot::None,
            Some(Value::Array(r)) if r.len() == 2 => match (r[0].as_f64(), r[1].as_f64()) {
                (Some(a), Some(b)) if a <= b => Overshoot::Within(a, b),
                _ => return Err(refuse("overshoot", "is not a range [min, max]")),
            },
            Some(_) => {
                return Err(refuse(
                    "overshoot",
                    "is neither none nor a range [min, max]",
                ))
            }
        };
        Ok(EaseTable { table, overshoot })
    }

    /// 0 at 0 and 1 at 1, each within 1e-9; else refused naming the endpoint.
    pub fn check_ends(&self) -> Result<(), Refusal> {
        let t = &self.table;
        let (start, end) = (t.at(0.0), t.at(1.0));
        let endpoint = |x: f64, why: String| Refusal {
            endpoint: Some(x),
            ..refuse(format!("endpoint {x}"), why)
        };
        if start.abs() > EASE_END_TOLERANCE {
            return Err(endpoint(
                0.0,
                format!("the ease reads {start} at 0, not 0 within {EASE_END_TOLERANCE}"),
            ));
        }
        if (end - 1.0).abs() > EASE_END_TOLERANCE {
            return Err(endpoint(
                1.0,
                format!("the ease reads {end} at 1, not 1 within {EASE_END_TOLERANCE}"),
            ));
        }
        Ok(())
    }

    /// Its knots never decrease under `overshoot: none`, and lie inside a declared overshoot;
    /// else refused naming the knot.
    pub fn check_shape(&self) -> Result<(), Refusal> {
        let t = &self.table;
        let knot = |i: usize, why: String| Refusal {
            knot: Some(i),
            ..refuse(format!("knot {i}"), why)
        };
        match self.overshoot {
            Overshoot::None => {
                if let Some(i) = (1..t.y.len()).find(|&i| t.y[i] < t.y[i - 1]) {
                    return Err(knot(
                        i,
                        format!(
                            "knot {i} dips to {} below {} while the ease is declared monotone",
                            t.y[i],
                            t.y[i - 1]
                        ),
                    ));
                }
            }
            Overshoot::Within(lo, hi) => {
                if let Some(i) = (0..t.y.len()).find(|&i| t.y[i] < lo || t.y[i] > hi) {
                    return Err(knot(
                        i,
                        format!(
                            "knot {i} reads {}, past the declared overshoot [{lo}, {hi}]",
                            t.y[i]
                        ),
                    ));
                }
            }
        }
        Ok(())
    }

    /// The ease at progress `x` in [0, 1].
    pub fn at(&self, x: f64) -> f64 {
        self.table.at(x.clamp(0.0, 1.0))
    }

    /// The least and greatest the ease reads over [0, 1]: from its knots, which bound it exactly.
    pub fn extremes(&self) -> (f64, f64) {
        let b = self.table.bound(Iv::new(0.0, 1.0));
        (b.lo, b.hi)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_linear_table_reads_between_its_knots_and_holds_its_ends() {
        let t = Table::parse(&json!({"x": [0, 1, 2, 4], "y": [0, 1, 1.5, 1.75]})).unwrap();
        assert_eq!(t.at(3.0), 1.625);
        assert_eq!(t.at(-1.0), 0.0);
        assert_eq!(t.at(5.0), 1.75);
        assert_eq!(t.bound(Iv::new(0.5, 3.0)), Iv::new(0.5, 1.625));
    }

    #[test]
    fn a_monotone_table_stays_between_each_pair_of_knots() {
        let t = Table::parse(
            &json!({"x": [0, 1, 2, 3, 4], "y": [0, 3, 2.5, 2.6, 10], "mode": "monotone"}),
        )
        .unwrap();
        for i in 0..4 {
            let (lo, hi) = (t.y[i].min(t.y[i + 1]), t.y[i].max(t.y[i + 1]));
            for k in 0..=1000 {
                let v = t.at(t.x[i] + (t.x[i + 1] - t.x[i]) * k as f64 / 1000.0);
                assert!(lo <= v && v <= hi, "segment {i} at {k}: {v}");
            }
        }
    }

    #[test]
    fn broken_tables_are_refused_naming_where() {
        let e = Table::parse(&json!({"x": [0, 2, 1], "y": [0, 1, 2]})).unwrap_err();
        assert_eq!(e.at, "x[2]");
        let e = Table::parse(&json!({"x": [0, 1, 2], "y": [0, "NaN", 2]})).unwrap_err();
        assert_eq!(e.at, "y[1]");
        let big: Vec<f64> = (0..4097).map(f64::from).collect();
        let e = Table::parse(&json!({"x": big, "y": big})).unwrap_err();
        assert!(e.why.contains("4096"), "{e}");
    }

    #[test]
    fn ease_tables_hold_their_ends_and_their_overshoot() {
        let v = json!({"x": [0, 0.3, 1], "y": [0, -0.1, 1], "overshoot": [-0.1, 1]});
        let e = EaseTable::parse(&v).unwrap();
        assert_eq!(e.extremes(), (-0.1, 1.0));
        let mut mono = v.clone();
        mono["overshoot"] = json!("none");
        assert_eq!(EaseTable::parse(&mono).unwrap_err().at, "knot 1");
        let short = json!({"x": [0, 0.5, 1], "y": [0, 0.5, 0.98]});
        assert_eq!(EaseTable::parse(&short).unwrap_err().at, "endpoint 1");
    }
}
