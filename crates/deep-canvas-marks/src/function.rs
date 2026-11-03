//! A path drawn from a formula (canvas primitives: Path `path@1`: function, issue #490): `fn:
//! {y, over: [a, b], samples: adaptive | n}` in place of `d`. The expression is the core's closed
//! function list; with `samples: adaptive` each segment splits until the expression's interval
//! form shows the curve within 0.5 px (the path's units) of its chord, at most 2,000 points. A
//! non-finite sample breaks the curve; a stretch the bound can't settle within the points draws
//! from its samples as an estimate, with a notice naming its x range.

use deep_canvas::expr::{Expr, Nothing};
use deep_canvas::interval::Iv;
use serde_json::Value;

/// The most points a path function draws.
pub const MAX_POINTS: usize = 2000;
/// How far the drawn line may sit from the curve, in the path's units.
const TOLERANCE: f64 = 0.5;
/// The most nodes a path function's expression takes once its sums expand.
const CAP: usize = 512;

/// A path function's drawing: its sub-paths, and the x ranges it drew as estimates.
#[derive(Clone, Debug, PartialEq)]
pub struct Drawn {
    pub subpaths: Vec<Vec<[f64; 2]>>,
    pub estimates: Vec<[f64; 2]>,
}

/// Why a path function is refused: the field, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Refusal {
    pub field: &'static str,
    pub why: String,
}

fn refuse(field: &'static str, why: impl Into<String>) -> Refusal {
    Refusal {
        field,
        why: why.into(),
    }
}

/// `fn`'s drawing.
pub fn draw(f: &Value) -> Result<Drawn, Refusal> {
    let Some(text) = f.get("y").and_then(Value::as_str) else {
        return Err(refuse("y", "a path function's y is an expression over x"));
    };
    let over = f.get("over").and_then(Value::as_array);
    let (a, b) = match over.map(Vec::as_slice) {
        Some([a, b]) => match (a.as_f64(), b.as_f64()) {
            (Some(a), Some(b)) if a < b && a.is_finite() && b.is_finite() => (a, b),
            _ => return Err(refuse("over", "over is [a, b], finite, with a < b")),
        },
        _ => return Err(refuse("over", "over is [a, b]")),
    };
    let expr = Expr::compile(text, &Nothing, CAP).map_err(|r| refuse("y", r.to_string()))?;
    if let Some(n) = expr.vars.iter().find(|n| *n != "x") {
        return Err(refuse("y", format!("`{n}` is no var of the path function")));
    }
    let x_of = |x: f64| -> Vec<f64> { expr.vars.iter().map(|_| x).collect() };
    let y = |x: f64| expr.eval_num(&x_of(x));
    let bound = |lo: f64, hi: f64| expr.bound_num(&expr.vars.iter().map(|_| Iv::new(lo, hi)).collect::<Vec<_>>());
    let (xs, estimates) = match f.get("samples") {
        None => adaptive(a, b, &y, &bound),
        Some(Value::String(s)) if s == "adaptive" => adaptive(a, b, &y, &bound),
        Some(v) => match v.as_u64() {
            Some(n) if (2..=MAX_POINTS as u64).contains(&n) => {
                let n = n as usize;
                let xs = (0..n).map(|i| a + (b - a) * i as f64 / (n - 1) as f64).collect();
                (xs, Vec::new())
            }
            _ => return Err(refuse("samples", "samples is adaptive or 2 to 2,000")),
        },
    };
    // A non-finite sample breaks the curve rather than drawing a wall.
    let mut subpaths: Vec<Vec<[f64; 2]>> = Vec::new();
    let mut run: Vec<[f64; 2]> = Vec::new();
    for x in xs {
        let v = if x.is_nan() { f64::NAN } else { y(x) };
        if v.is_finite() {
            run.push([x, v]);
        } else if !run.is_empty() {
            subpaths.push(std::mem::take(&mut run));
        }
    }
    if !run.is_empty() {
        subpaths.push(run);
    }
    Ok(Drawn {
        subpaths,
        estimates,
    })
}

/// The adaptive samples over [a, b], each segment split until its bound settles it within the
/// tolerance, level by level so the points spread over the whole range, and the stretches left
/// as estimates once the points run out. A NaN in the samples marks a break.
fn adaptive(
    a: f64,
    b: f64,
    y: &dyn Fn(f64) -> f64,
    bound: &dyn Fn(f64, f64) -> Iv,
) -> (Vec<f64>, Vec<[f64; 2]>) {
    // A segment is settled when its bound's width is within the tolerance: the curve then lies
    // within it of any chord between its ends' values. One that holds no finite value breaks.
    let settled = |lo: f64, hi: f64| {
        let r = bound(lo, hi);
        r.is_empty() || (r.is_bounded() && r.width() <= TOLERANCE)
    };
    // Each segment, in order, and whether it is done: settled, or a jump.
    let mut segs: Vec<(f64, f64, bool)> = vec![(a, b, settled(a, b))];
    let mut breaks: Vec<f64> = Vec::new();
    loop {
        let open: Vec<usize> = (0..segs.len()).filter(|&i| !segs[i].2).collect();
        // Each split adds one point; past the budget, the last level splits the widest open
        // segments it still can.
        let room = MAX_POINTS.saturating_sub(segs.len() + 1);
        if open.is_empty() || room == 0 {
            break;
        }
        let mut split = vec![false; segs.len()];
        let mut widest = open.clone();
        widest.sort_by(|&i, &j| (segs[j].1 - segs[j].0).total_cmp(&(segs[i].1 - segs[i].0)));
        for &i in widest.iter().take(room) {
            split[i] = true;
        }
        let mut next = Vec::with_capacity(segs.len() + room.min(open.len()));
        for (i, &(lo, hi, done)) in segs.iter().enumerate() {
            if !split[i] {
                next.push((lo, hi, done));
                continue;
            }
            let mid = 0.5 * (lo + hi);
            // Split down to adjacent floats and still unsettled: a jump (floor, a comparison, a
            // pole), which breaks the curve rather than drawing a wall.
            if mid <= lo || mid >= hi {
                breaks.push(hi);
                next.push((lo, hi, true));
                continue;
            }
            next.push((lo, mid, settled(lo, mid)));
            next.push((mid, hi, settled(mid, hi)));
        }
        if open.len() > room {
            segs = next;
            break;
        }
        segs = next;
    }
    let mut xs = vec![a];
    let mut estimates: Vec<[f64; 2]> = Vec::new();
    for &(lo, hi, done) in &segs {
        if !done && y(lo).is_finite() && y(hi).is_finite() {
            match estimates.last_mut() {
                Some(e) if e[1] == lo => e[1] = hi,
                _ => estimates.push([lo, hi]),
            }
            // A stretch whose bound is unbounded may hold a pole between its samples: it
            // breaks the curve rather than drawing a wall across it.
            if !bound(lo, hi).is_bounded() {
                breaks.push(hi);
            }
        }
        if breaks.contains(&hi) {
            xs.push(f64::NAN);
        }
        xs.push(hi);
    }
    (xs, estimates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sinc_draws_as_one_sub_path_with_no_estimate() {
        let d = draw(&json!({"y": "sinc(x)", "over": [-10, 10]})).unwrap();
        assert_eq!(d.subpaths.len(), 1);
        assert!(d.estimates.is_empty());
        assert!(d.subpaths[0].len() <= MAX_POINTS);
    }

    #[test]
    fn a_jump_breaks_the_curve_with_no_estimate() {
        let d = draw(&json!({"y": "floor(x)", "over": [0.5, 1.5]})).unwrap();
        assert_eq!(d.subpaths.len(), 2);
        assert!(d.estimates.is_empty());
    }

    #[test]
    fn a_pole_leaves_points_for_both_sides() {
        let d = draw(&json!({"y": "1 / x", "over": [-3, 3]})).unwrap();
        assert_eq!(d.subpaths.len(), 2, "{:?}", d.subpaths.iter().map(Vec::len).collect::<Vec<_>>());
        assert!(d.subpaths.iter().all(|s| s.len() > 100));
    }

    #[test]
    fn a_pole_off_the_samples_breaks_the_curve() {
        let d = draw(&json!({"y": "1 / (x - 0.1)", "over": [-3, 3]})).unwrap();
        assert!(d.subpaths.len() >= 2);
        // No drawn segment jumps across the pole.
        for s in &d.subpaths {
            assert!(s.windows(2).all(|w| (w[0][0] - 0.1) * (w[1][0] - 0.1) >= 0.0), "a wall across x = 0.1");
        }
    }

    #[test]
    fn a_curve_spends_its_whole_budget() {
        let d = draw(&json!({"y": "x", "over": [-300, 300]})).unwrap();
        let points: usize = d.subpaths.iter().map(Vec::len).sum();
        assert!(points > 1900, "{points}");
        let unsettled: f64 = d.estimates.iter().map(|e| e[1] - e[0]).sum();
        assert!(unsettled < 600.0, "{unsettled}");
    }

    #[test]
    fn a_pole_breaks_the_curve() {
        let d = draw(&json!({"y": "1 / x", "over": [-1, 1], "samples": 101})).unwrap();
        assert_eq!(d.subpaths.len(), 2);
    }
}
