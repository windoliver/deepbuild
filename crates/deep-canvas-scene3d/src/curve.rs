//! Curve `curve@1` (canvas primitives: Curve; issue #420): a polyline or a Catmull-Rom spline
//! through its points, open or closed, sampled into the polyline a tube sweeps along and a
//! `curve_deform` bends by, with its arc length.

use serde_json::Value;

use crate::geom::{add, length, scale, sub, unit, V3};

/// Samples per span of a Catmull-Rom curve.
pub const SAMPLES: usize = 8;

/// A curve as sampled: its points (a closed curve doesn't repeat its first) and whether it closes.
#[derive(Clone, Debug, PartialEq)]
pub struct Sampled {
    pub points: Vec<V3>,
    pub closed: bool,
}

fn v3(v: &Value) -> Option<V3> {
    let a = v.as_array().filter(|a| a.len() == 3)?;
    Some([a[0].as_f64()?, a[1].as_f64()?, a[2].as_f64()?])
}

/// A list of points, or `None` when it isn't one.
pub fn points(v: &Value) -> Option<Vec<V3>> {
    v.as_array()?.iter().map(v3).collect()
}

/// A `curve@1` item's params sampled, or why not (the path of the bad field).
pub fn sample(params: &Value) -> Result<Sampled, &'static str> {
    let pts = params
        .get("points")
        .and_then(points)
        .filter(|p| p.len() >= 2)
        .ok_or("params/points")?;
    let closed = params
        .get("closed")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let mode = params
        .get("mode")
        .and_then(Value::as_str)
        .unwrap_or("linear");
    let points = match mode {
        "linear" => pts,
        "catmull_rom" => catmull_rom(&pts, closed),
        _ => return Err("params/mode"),
    };
    Ok(Sampled { points, closed })
}

fn catmull_rom(p: &[V3], closed: bool) -> Vec<V3> {
    let n = p.len();
    let at = |k: isize| -> V3 {
        if closed {
            p[k.rem_euclid(n as isize) as usize]
        } else {
            p[k.clamp(0, n as isize - 1) as usize]
        }
    };
    let spans = if closed { n } else { n - 1 };
    let mut out = Vec::new();
    for s in 0..spans as isize {
        let (p0, p1, p2, p3) = (at(s - 1), at(s), at(s + 1), at(s + 2));
        for k in 0..SAMPLES {
            let t = k as f64 / SAMPLES as f64;
            let (t2, t3) = (t * t, t * t * t);
            let mut q = [0.0; 3];
            for d in 0..3 {
                q[d] = 0.5
                    * (2.0 * p1[d]
                        + (p2[d] - p0[d]) * t
                        + (2.0 * p0[d] - 5.0 * p1[d] + 4.0 * p2[d] - p3[d]) * t2
                        + (3.0 * p1[d] - 3.0 * p0[d] + p3[d] - p2[d]) * t3);
            }
            out.push(q);
        }
    }
    if !closed {
        out.push(p[n - 1]);
    }
    out
}

impl Sampled {
    /// Its polyline, closed back to the start when it closes.
    fn polyline(&self) -> Vec<V3> {
        let mut out = self.points.clone();
        if self.closed {
            out.push(self.points[0]);
        }
        out
    }

    /// Its arc length.
    pub fn length(&self) -> f64 {
        self.polyline()
            .windows(2)
            .map(|w| length(sub(w[1], w[0])))
            .sum()
    }

    /// The point and unit tangent at arc length `s`, past either end along its end's tangent.
    pub fn at(&self, s: f64) -> (V3, V3) {
        let line = self.polyline();
        let mut left = s;
        for (k, w) in line.windows(2).enumerate() {
            let d = length(sub(w[1], w[0]));
            let last = k + 2 == line.len();
            if left <= d || last {
                let tangent = unit(sub(w[1], w[0]));
                return (add(w[0], scale(tangent, left)), tangent);
            }
            left -= d;
        }
        (line[0], [1.0, 0.0, 0.0])
    }
}
