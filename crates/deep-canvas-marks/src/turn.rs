//! #535: a picture turned about its centre: a free atlas row by its `angle`, and an `image@1`
//! item by `at.rot`'s z, one rule for the marks, their extents and both 2D painters.

/// The sine and cosine of `deg` degrees, exact at quarter turns.
pub fn sin_cos(deg: f64) -> (f64, f64) {
    let quarter = deg / 90.0;
    if quarter.fract() == 0.0 {
        return [(0.0, 1.0), (1.0, 0.0), (0.0, -1.0), (-1.0, 0.0)]
            [quarter.rem_euclid(4.0) as usize];
    }
    let r = deep_canvas::ops::rad(deg);
    (deep_canvas::ops::sin(r), deep_canvas::ops::cos(r))
}

/// The affine `[a, b, c, d, e, f]` (x′ = a x + c y + e, y′ = b x + d y + f) that turns `deg`
/// degrees about the centre of `bounds`.
pub fn turn_of([x, y, w, h]: [f64; 4], deg: f64) -> [f64; 6] {
    let (s, c) = sin_cos(deg);
    let (cx, cy) = (x + w / 2.0, y + h / 2.0);
    [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]
}

/// A box holding `bounds` turned `deg` degrees about its centre: `bounds` itself unturned.
pub fn turned_box(bounds: [f64; 4], deg: f64) -> [f64; 4] {
    if deg == 0.0 {
        return bounds;
    }
    let [x, y, w, h] = bounds;
    let [a, b, c, d, e, f] = turn_of(bounds, deg);
    let corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]
        .map(|[px, py]| [a * px + c * py + e, b * px + d * py + f]);
    let (lo, hi) = corners.iter().fold(
        ([f64::INFINITY; 2], [f64::NEG_INFINITY; 2]),
        |(lo, hi), p| {
            (
                [lo[0].min(p[0]), lo[1].min(p[1])],
                [hi[0].max(p[0]), hi[1].max(p[1])],
            )
        },
    );
    [lo[0], lo[1], hi[0] - lo[0], hi[1] - lo[1]]
}

/// `bounds` with its centre turned `deg` degrees about `origin`, the box that then turns `deg`
/// about its own centre: a box turned about a point.
pub fn about(bounds: [f64; 4], origin: [f64; 2], deg: f64) -> [f64; 4] {
    let ((s, c), [x, y, w, h]) = (sin_cos(deg), bounds);
    let d = [x + w / 2.0 - origin[0], y + h / 2.0 - origin[1]];
    let centre = [
        origin[0] + c * d[0] - s * d[1],
        origin[1] + s * d[0] + c * d[1],
    ];
    [centre[0] - w / 2.0, centre[1] - h / 2.0, w, h]
}
