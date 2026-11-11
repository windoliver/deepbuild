//! A flat target's hit area, as the scope's press reads it: its rect, and for a row whose shape
//! isn't its rect, the exact outline the host hands in beside it (#536: a hex cell's hexagon,
//! Mark set: hex grid), with the edges it owns, so a point on an edge or a vertex two outlines
//! share hits exactly one of them.

use serde_json::Value;

use crate::document::member;

/// A convex outline in page u, its points in order, and whether each edge, from point i to point
/// i + 1, is the target's own.
pub(crate) type Area = Option<(Vec<[f64; 2]>, Vec<bool>)>;

pub(crate) fn within(r: [f64; 4], p: [f64; 2]) -> bool {
    p[0] >= r[0] && p[1] >= r[1] && p[0] <= r[0] + r[2] && p[1] <= r[1] + r[3]
}

/// A target's `params.hull: {points: [[x, y]], owns: [bool]}`; `None` without one.
pub(crate) fn read(params: Option<&Value>) -> Area {
    let hull = member(params?, "hull")?;
    let pair = |q: &Value| Some([q.get(0)?.as_f64()?, q.get(1)?.as_f64()?]);
    let points = member(hull, "points")?.as_array()?.iter().map(pair);
    let owns = member(hull, "owns")?.as_array()?.iter().map(Value::as_bool);
    Some((points.collect::<Option<_>>()?, owns.collect::<Option<_>>()?))
}

/// Whether `p` lies in the area: inside every edge, or on edges the area owns; a target with no
/// area holds what its rect holds.
pub(crate) fn held(area: &Area, p: [f64; 2]) -> bool {
    let Some((points, owns)) = area else {
        return true;
    };
    let n = points.len();
    let edge = |i: usize| (points[i], points[(i + 1) % n]);
    let winding: f64 = (0..n)
        .map(|i| {
            let (a, b) = edge(i);
            a[0] * b[1] - b[0] * a[1]
        })
        .sum::<f64>()
        .signum();
    (0..n).all(|i| {
        let (a, b) = edge(i);
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        // The signed distance from the edge, positive inside.
        let side = winding * (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / crate::ops::hypot(dx, dy);
        side > 1e-9 || (side >= -1e-9 && owns.get(i).copied().unwrap_or(true))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// #536: a hexagon's inside hits, a point on an edge or a vertex hits only where the area owns
    /// every edge it lies on, and a point in its rect's corner misses.
    #[test]
    fn an_area_holds_its_inside_and_the_edges_it_owns() {
        // The pointy 32 × 28 hexagon about (48, 21), owning edges 0, 4 and 5 (+x, down-left and
        // down-right), as the host hands it in.
        let area = read(Some(&json!({"hull": {
            "points": [[64, 28], [64, 14], [48, 7], [32, 14], [32, 28], [48, 35]],
            "owns": [true, false, false, false, true, true],
        }})));
        assert!(held(&area, [48.0, 21.0]));
        assert!(held(&area, [64.0, 21.0]), "on the owned +x edge");
        assert!(!held(&area, [32.0, 21.0]), "on the −x edge it doesn't own");
        assert!(held(&area, [56.0, 31.5]), "on the owned down-right edge");
        assert!(
            !held(&area, [56.0, 10.5]),
            "on the up-right edge it doesn't own"
        );
        assert!(
            held(&area, [48.0, 35.0]),
            "the vertex between two owned edges"
        );
        assert!(
            !held(&area, [64.0, 14.0]),
            "a vertex on an edge it doesn't own"
        );
        assert!(
            !held(&area, [34.0, 9.0]),
            "its rect's corner, outside the hexagon"
        );
        assert!(
            held(&None, [34.0, 9.0]),
            "a target with no area holds its whole rect"
        );
    }
}
