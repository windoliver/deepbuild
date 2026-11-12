
// ---- #537: a line's butt or square ends (Marks in 3D: lines `cap`)

// A line fragment's coverage at `p`, `round` its coverage with round ends, `t` its place along the
// segment, clamped. The record's cap bits: 1 the segment's start is a free end of the line, 2 its
// end is, 4 the ends are square. Past such an end the round cap is cut: coverage by the distance
// along the segment's direction, a butt end at the point, a square end half the width past it.
fn capped(in: LineOut, p: vec2<f32>, t: f32, round: f32) -> f32 {
    let d = in.b - in.a;
    let len = length(d);
    if len < 1e-6 || (in.caps & 3u) == 0u {
        return round;
    }
    let dir = d / len;
    let along = dot(p - in.a, dir);
    var past = 0.0;
    if (in.caps & 1u) != 0u && along < 0.0 {
        past = -along;
    } else if (in.caps & 2u) != 0u && along > len {
        past = along - len;
    } else {
        return round;
    }
    let r = mix(in.r.x, in.r.y, t);
    let across = abs(dot(p - in.a, vec2<f32>(-dir.y, dir.x)));
    let ext = select(0.0, r, (in.caps & 4u) != 0u);
    return min(clamp(r + 0.5 - across, 0.0, 1.0), clamp(ext + 0.5 - past, 0.0, 1.0));
}
