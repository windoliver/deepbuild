// The closed-form particle kernel (#449; canvas primitives: Particles `particles@1`). Slot e's
// particle at t is a closed form of its age, its index and the item's seed, written as the
// draw's columns: position, age over life (−1 when no particle of the slot is alive), velocity.
// It mirrors deep_canvas_effects::particles (eval, solve, regions, bursts, turbulence,
// heightmap) step for step in f32; the uniform's layout is particles::pack's. Nothing is read
// from an earlier frame.

struct U { w: array<vec4<u32>, 32> }

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> tab: array<u32>;
@group(0) @binding(2) var<storage, read_write> inst: array<f32>;
// The surface a `follow` item rides on, its vertices as evaluated at this frame's t.
@group(0) @binding(3) var<storage, read> now: array<f32>;

const TAU: f32 = 6.283185307179586;
const PI: f32 = 3.141592653589793;
const NO_DRAG: f32 = 1e-4;
const NEWTON: u32 = 8u;
const MARCH: u32 = 16u;
const EMPTY: f32 = -1e29;
const FAR: f32 = 3.0e38;

fn uf(s: u32, k: u32) -> f32 { return bitcast<f32>(u.w[s][k]); }
fn uu(s: u32, k: u32) -> u32 { return u.w[s][k]; }
fn uv3(s: u32) -> vec3<f32> { return vec3<f32>(uf(s, 0u), uf(s, 1u), uf(s, 2u)); }
fn tf(i: u32) -> f32 { return bitcast<f32>(tab[i]); }
fn tv3(i: u32) -> vec3<f32> { return vec3<f32>(tf(i), tf(i + 1u), tf(i + 2u)); }

fn hash1(x: u32) -> u32 {
    let s = x * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}
fn hash2(a: u32, b: u32) -> u32 { return hash1(hash1(a) ^ b); }
fn hash3(a: u32, b: u32, c: u32) -> u32 { return hash1(hash2(a, b) ^ c); }
fn hash4(a: u32, b: u32, c: u32, d: u32) -> u32 { return hash1(hash3(a, b, c) ^ d); }
fn draw(h: u32, k: u32) -> f32 { return f32(hash1(hash2(h, k)) >> 8u) * 5.9604645e-8; }

// ---- the arc ----

struct Arc { x0: vec3<f32>, v0: vec3<f32>, g: vec3<f32>, d: f32 }

fn first_order() -> bool { return (uu(24u, 2u) & 1u) != 0u; }

// (k1, k2, e^(−d a)); 1 − e^(−x) and its second-order remainder by series where they cancel.
fn ks(arc: Arc, a: f32) -> vec3<f32> {
    let d = arc.d;
    if (d < NO_DRAG) { return vec3<f32>(a, 0.5 * a * a, 1.0); }
    let x = d * a;
    if (first_order()) {
        return vec3<f32>(a - 0.5 * d * a * a, 0.5 * a * a - d * a * a * a / 6.0, 1.0 - x);
    }
    var gone: f32;
    var rest: f32; // (x − gone) ÷ x²
    if (x < 0.25) {
        gone = x * (1.0 - x * (0.5 - x * (1.0 / 6.0 - x * (1.0 / 24.0 - x * (1.0 / 120.0 - x * (1.0 / 720.0 - x / 5040.0))))));
        rest = 0.5 - x * (1.0 / 6.0 - x * (1.0 / 24.0 - x * (1.0 / 120.0 - x * (1.0 / 720.0 - x / 5040.0))));
    } else {
        gone = 1.0 - exp(-x);
        rest = (x - gone) / (x * x);
    }
    return vec3<f32>(gone / d, a * a * rest, 1.0 - gone);
}
fn arc_at(arc: Arc, a: f32) -> vec3<f32> { let k = ks(arc, a); return arc.x0 + arc.v0 * k.x + arc.g * k.y; }
fn arc_vel(arc: Arc, a: f32) -> vec3<f32> { let k = ks(arc, a); return arc.v0 * k.z + arc.g * k.x; }

// s(a) = σ (n·x(a) − offset)
struct Along { s0: f32, b: f32, g: f32, d: f32 }
fn along_s(l: Along, a: f32) -> f32 {
    let k = ks(Arc(vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0), l.d), a);
    return l.s0 + l.b * k.x + l.g * k.y;
}
fn along_ds(l: Along, a: f32) -> f32 {
    if (l.d < NO_DRAG) { return l.b + l.g * a; }
    let k = ks(Arc(vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0), l.d), a);
    return l.b * k.z + l.g * k.x;
}

// The first a in (0, hi] where s falls to 0, or −1.
fn first_root(l: Along, hi: f32) -> f32 {
    if (l.d < NO_DRAG) {
        let c = 0.5 * l.g;
        var r0 = -1.0;
        var r1 = -1.0;
        if (c == 0.0) {
            if (l.b != 0.0) { r0 = -l.s0 / l.b; }
        } else {
            let disc = l.b * l.b - 4.0 * c * l.s0;
            if (disc < 0.0) { return -1.0; }
            let sq = sqrt(disc);
            let q = -0.5 * (l.b + select(-sq, sq, l.b >= 0.0));
            if (q != 0.0) { r0 = q / c; r1 = l.s0 / q; } else { r0 = 0.0; }
        }
        var best = -1.0;
        let tol = 1e-6 * (1.0 + abs(l.b));
        if (r0 > 0.0 && r0 <= hi && l.b + l.g * r0 <= tol) { best = r0; }
        if (r1 > 0.0 && r1 <= hi && l.b + l.g * r1 <= tol && (best < 0.0 || r1 < best)) { best = r1; }
        return best;
    }
    let d = l.d;
    let curve = l.g - d * l.b;
    var cuts = array<f32, 3>(0.0, hi, hi);
    var n = 2u;
    if (curve != 0.0) {
        let e = l.g / curve;
        if (e > 0.0 && e < 1.0) {
            let turn = -log(e) / d;
            if (turn < hi) { cuts[1] = turn; cuts[2] = hi; n = 3u; }
        }
    }
    for (var i = 0u; i + 1u < n; i++) {
        let lo = cuts[i];
        let up = cuts[i + 1u];
        let slo = along_s(l, lo);
        let sup = along_s(l, up);
        if (!(slo > 0.0 && sup <= 0.0)) { continue; }
        if (sup == 0.0) { return up; }
        var x = select(lo, up, sup * curve > 0.0);
        for (var k = 0u; k < NEWTON; k++) {
            let f = along_s(l, x);
            let df = along_ds(l, x);
            if (df == 0.0 || f == 0.0) { break; }
            x = clamp(x - f / df, lo, up);
        }
        return x;
    }
    return -1.0;
}

// The first time in (0, hi] the arc meets the plane moving against its normal (particles stay
// where n·p ≥ offset); `on`: it starts on the plane, having just bounced off it.
fn plane_root(arc: Arc, n: vec3<f32>, off: f32, on: bool, hi: f32) -> f32 {
    var l = Along(dot(n, arc.x0) - off, dot(n, arc.v0), dot(n, arc.g), arc.d);
    if (on) { l.s0 = 0.0; }
    return first_root(l, hi);
}

// The first time in (0, hi] the arc crosses the plane either way.
fn crossing(arc: Arc, n: vec3<f32>, off: f32, hi: f32) -> f32 {
    let s0 = dot(n, arc.x0) - off;
    var side = sign(s0);
    if (s0 == 0.0) { side = sign(dot(n, arc.v0)); }
    if (side == 0.0) { return -1.0; }
    return first_root(Along(side * s0, side * dot(n, arc.v0), side * dot(n, arc.g), arc.d), hi);
}

// ---- the landing map ----

struct Height { h: f32, dx: f32, dz: f32, ok: bool }

fn map_cell(i: u32, j: u32) -> f32 { return tf(uu(18u, 3u) + j * uu(20u, 0u) + i); }

fn map_height(x: f32, z: f32) -> Height {
    let x0 = uf(19u, 0u);
    let z0 = uf(19u, 1u);
    let cell = uf(19u, 2u);
    let nx = uu(20u, 0u);
    let nz = uu(20u, 1u);
    var out = Height(0.0, 0.0, 0.0, false);
    if (!(x >= x0 && x <= x0 + f32(nx) * cell && z >= z0 && z <= z0 + f32(nz) * cell)) { return out; }
    let gx = clamp((x - x0) / cell - 0.5, 0.0, f32(nx - 1u));
    let gz = clamp((z - z0) / cell - 0.5, 0.0, f32(nz - 1u));
    let i0 = min(u32(floor(gx)), max(nx, 2u) - 2u);
    let j0 = min(u32(floor(gz)), max(nz, 2u) - 2u);
    let i1 = min(i0 + 1u, nx - 1u);
    let j1 = min(j0 + 1u, nz - 1u);
    let fx = gx - f32(i0);
    let fz = gz - f32(j0);
    let h00 = map_cell(i0, j0);
    let h10 = map_cell(i1, j0);
    let h01 = map_cell(i0, j1);
    let h11 = map_cell(i1, j1);
    if (h00 < EMPTY || h10 < EMPTY || h01 < EMPTY || h11 < EMPTY) { return out; }
    // Across a cliff the read steps at the midpoint between centres (heightmap.rs).
    let low = min(min(h00, h10), min(h01, h11));
    let high = max(max(h00, h10), max(h01, h11));
    if (high - low > 2.0 * cell) {
        let near_x = fx < 0.5;
        out.h = select(select(h11, h01, near_x), select(h10, h00, near_x), fz < 0.5);
        out.ok = true;
        return out;
    }
    let a = mix(h00, h10, fx);
    let b = mix(h01, h11, fx);
    out.h = mix(a, b, fz);
    out.dx = select(0.0, mix(h10 - h00, h11 - h01, fz) / cell, i1 > i0);
    out.dz = select(0.0, mix(h01 - h00, h11 - h10, fx) / cell, j1 > j0);
    out.ok = true;
    return out;
}

// The arc's height above the map at a and its rate; ok false outside.
fn above(arc: Arc, a: f32) -> vec3<f32> {
    let p = arc_at(arc, a);
    let v = arc_vel(arc, a);
    let m = map_height(p.x, p.z);
    if (!m.ok) { return vec3<f32>(FAR, 0.0, 0.0); }
    return vec3<f32>(p.y - m.h, v.y - m.dx * v.x - m.dz * v.z, 1.0);
}

fn map_normal(p: vec3<f32>) -> vec3<f32> {
    let m = map_height(p.x, p.z);
    var n = vec3<f32>(0.0, 1.0, 0.0);
    if (m.ok) { n = normalize(vec3<f32>(-m.dx, 1.0, -m.dz)); }
    return n;
}

// The first landing in (0, hi], as (a, found).
fn ground_hit(arc: Arc, hi: f32, on: bool) -> vec2<f32> {
    let top = uf(19u, 3u);
    let bottom = uf(20u, 2u);
    var start = 0.0;
    if (arc.x0.y > top) {
        start = plane_root(arc, vec3<f32>(0.0, 1.0, 0.0), top, false, hi);
        if (start < 0.0) { return vec2<f32>(0.0, 0.0); }
    }
    let floor_y = bottom - 1e-6 * (1.0 + abs(bottom));
    var end = plane_root(arc, vec3<f32>(0.0, 1.0, 0.0), floor_y, false, hi);
    if (end < 0.0) { end = hi; }
    if (end <= start) { return vec2<f32>(0.0, 0.0); }
    let stride = (end - start) / f32(MARCH);
    var prev = start;
    var k0 = 0u;
    if (on && start == 0.0) { k0 = 1u; }
    for (var k = k0; k <= MARCH; k++) {
        let a = start + stride * f32(k);
        let f = above(arc, a);
        if (!(f.z > 0.0 && f.x <= 0.0)) { prev = a; continue; }
        if (k == k0) { return vec2<f32>(a, 1.0); }
        var x = a;
        for (var i = 0u; i < NEWTON; i++) {
            let g = above(arc, x);
            if (g.z == 0.0 || g.x == 0.0 || g.y == 0.0) { break; }
            x = clamp(x - g.x / g.y, prev, a);
        }
        return vec2<f32>(x, 1.0);
    }
    return vec2<f32>(0.0, 0.0);
}

// ---- kill ----

fn keeps(x: vec3<f32>) -> bool {
    let kind = uu(8u, 2u);
    if (kind == 0u) { return true; }
    var inside: bool;
    if (kind == 1u) {
        let lo = uv3(15u);
        let hi = uv3(16u);
        inside = all(x >= lo) && all(x <= hi);
    } else {
        inside = dot(uv3(15u), x) <= uf(15u, 3u);
    }
    return inside == (uu(8u, 3u) != 0u);
}

fn kill_exit(arc: Arc, hi: f32) -> f32 {
    let kind = uu(8u, 2u);
    if (kind == 0u) { return -1.0; }
    var times = array<f32, 6>(-1.0, -1.0, -1.0, -1.0, -1.0, -1.0);
    if (kind == 2u) {
        times[0] = crossing(arc, uv3(15u), uf(15u, 3u), hi);
    } else {
        let lo = uv3(15u);
        let up = uv3(16u);
        for (var i = 0u; i < 3u; i++) {
            var n = vec3<f32>(0.0);
            n[i] = 1.0;
            times[2u * i] = crossing(arc, n, lo[i], hi);
            times[2u * i + 1u] = crossing(arc, n, up[i], hi);
        }
    }
    var best = -1.0;
    for (var i = 0u; i < 6u; i++) {
        let a = times[i];
        if (a < 0.0 || (best >= 0.0 && a >= best)) { continue; }
        let after = min(a + 1e-6 * (1.0 + a), hi);
        if (!keeps(arc_at(arc, after))) { best = a; }
    }
    return best;
}

// ---- the path ----

struct Path { pos: vec3<f32>, vel: vec3<f32>, alive: bool }

fn reflect_v(v: vec3<f32>, n: vec3<f32>, e: f32, fr: f32) -> vec3<f32> {
    let vn = n * dot(v, n);
    return (v - vn) * (1.0 - fr) - vn * e;
}

fn ballistic(first: Arc, age: f32, life: f32) -> Path {
    let planes = uu(7u, 0u);
    let max_contacts = uu(7u, 1u);
    let rest_last = uu(7u, 2u) != 0u;
    let restitution = uf(7u, 3u);
    let friction = uf(8u, 0u);
    let land = uu(8u, 1u);
    var arc = first;
    var start = 0.0;
    var contacts = 0u;
    var on_plane = 99u;
    var on_ground = false;
    if (!keeps(first.x0)) { return Path(vec3<f32>(0.0), vec3<f32>(0.0), false); }
    for (var seg = 0u; seg < 6u; seg++) {
        let hi = life - start;
        var best = -1.0;
        var what = 0u; // 1 plane, 2 ground, 3 killed
        var which = 0u;
        for (var k = 0u; k < planes; k++) {
            let p = u.w[9u + k];
            let a = plane_root(arc, vec3<f32>(bitcast<f32>(p.x), bitcast<f32>(p.y), bitcast<f32>(p.z)), bitcast<f32>(p.w), on_plane == k, hi);
            if (a >= 0.0 && (best < 0.0 || a < best)) { best = a; what = 1u; which = k; }
        }
        if (land != 0u) {
            let g = ground_hit(arc, hi, on_ground);
            if (g.y > 0.0 && (best < 0.0 || g.x < best)) { best = g.x; what = 2u; }
        }
        let kx = kill_exit(arc, hi);
        if (kx >= 0.0 && (best < 0.0 || kx < best)) { best = kx; what = 3u; }
        let local = age - start;
        if (best < 0.0 || best > local) {
            return Path(arc_at(arc, local), arc_vel(arc, local), true);
        }
        let at = arc_at(arc, best);
        let v = arc_vel(arc, best);
        if (what == 3u) { return Path(vec3<f32>(0.0), vec3<f32>(0.0), false); }
        var n: vec3<f32>;
        var fate = 3u; // 1 rest, 2 die, 3 bounce
        if (what == 1u) {
            let p = u.w[9u + which];
            n = vec3<f32>(bitcast<f32>(p.x), bitcast<f32>(p.y), bitcast<f32>(p.z));
        } else {
            n = map_normal(at);
            fate = land;
        }
        contacts += 1u;
        var ends = 0u;
        if (fate == 3u) {
            if (contacts >= max_contacts) { ends = select(2u, 1u, rest_last); }
        } else {
            ends = fate;
        }
        if (ends == 2u) { return Path(vec3<f32>(0.0), vec3<f32>(0.0), false); }
        if (ends == 1u) { return Path(at, vec3<f32>(0.0), true); }
        on_plane = select(99u, which, what == 1u);
        on_ground = what == 2u;
        arc = Arc(at, reflect_v(v, n, restitution, friction), arc.g, arc.d);
        start += best;
    }
    return Path(arc_at(arc, age - start), arc_vel(arc, age - start), true);
}

// ---- where it's born ----

fn rim(r: f32, th: f32, y: f32) -> vec3<f32> { return vec3<f32>(r * cos(th), y, r * sin(th)); }
fn direction(a: f32, b: f32) -> vec3<f32> {
    let zz = 2.0 * a - 1.0;
    let ss = sqrt(max(1.0 - zz * zz, 0.0));
    let ph = TAU * b;
    return vec3<f32>(ss * cos(ph), zz, ss * sin(ph));
}

fn region(shape: u32, surface: bool, s: vec3<f32>, r5: f32, r6: f32, r7: f32, r12: f32) -> vec3<f32> {
    switch shape {
        case 1u: { return rim(select(sqrt(r5) * s.x, s.x, surface), TAU * r6, 0.0); }
        case 2u: {
            let d = direction(r6, r7);
            return d * select(pow(r5, 1.0 / 3.0) * s.x, s.x, surface);
        }
        case 4u: {
            if (!surface) { return vec3<f32>((r5 - 0.5) * s.x, (r6 - 0.5) * s.y, (r7 - 0.5) * s.z); }
            let areas = vec3<f32>(s.y * s.z, s.x * s.z, s.x * s.y);
            var pick = r12 * 2.0 * (areas.x + areas.y + areas.z);
            var face = 5u;
            for (var f = 0u; f < 6u; f++) {
                if (pick < areas[f / 2u]) { face = f; break; }
                pick -= areas[f / 2u];
            }
            let sg = select(-0.5, 0.5, face % 2u == 0u);
            let a = r5 - 0.5;
            let b = r6 - 0.5;
            switch face / 2u {
                case 0u: { return vec3<f32>(sg * s.x, a * s.y, b * s.z); }
                case 1u: { return vec3<f32>(a * s.x, sg * s.y, b * s.z); }
                default: { return vec3<f32>(a * s.x, b * s.y, sg * s.z); }
            }
        }
        case 5u: {
            var rr: f32;
            if (surface) { rr = select(s.y, s.x, r12 * (s.x + s.y) < s.x); }
            else { rr = sqrt(s.y * s.y + r5 * (s.x * s.x - s.y * s.y)); }
            return rim(rr, TAU * r6, 0.0);
        }
        case 6u: {
            if (!surface) { return rim(sqrt(r5) * s.x, TAU * r6, (r7 - 0.5) * s.y); }
            let side = TAU * s.x * s.y;
            let cap = PI * s.x * s.x;
            let pick = r12 * (side + 2.0 * cap);
            if (pick < side) { return rim(s.x, TAU * r6, (r7 - 0.5) * s.y); }
            return rim(sqrt(r5) * s.x, TAU * r6, select(-0.5 * s.y, 0.5 * s.y, pick < side + cap));
        }
        case 7u: {
            var tube: f32;
            var ball: f32;
            if (surface) { tube = TAU * s.x * s.y; ball = 4.0 * PI * s.x * s.x; }
            else { tube = PI * s.x * s.x * s.y; ball = 4.0 / 3.0 * PI * s.x * s.x * s.x; }
            if (r12 * (tube + ball) < tube) {
                return rim(select(sqrt(r5) * s.x, s.x, surface), TAU * r6, (r7 - 0.5) * s.y);
            }
            let d = direction(r6, r7);
            let br = select(pow(r5, 1.0 / 3.0) * s.x, s.x, surface);
            let end = select(-0.5 * s.y, 0.5 * s.y, d.y >= 0.0);
            return vec3<f32>(d.x * br, d.y * br + end, d.z * br);
        }
        default: { return vec3<f32>(0.0); }
    }
    return vec3<f32>(0.0);
}

fn curve_point(i: u32) -> vec3<f32> { return tv3(uu(22u, 1u) + 3u * i); }
// The curve at u ∈ [0, 1] (xyz) and its unit tangent, packed as two vectors.
fn curve_at(uu_: f32) -> array<vec3<f32>, 2> {
    let n = uu(24u, 3u);
    if (n < 2u) { return array<vec3<f32>, 2>(curve_point(0u), vec3<f32>(0.0)); }
    let last = f32(n - 1u);
    let x = clamp(uu_, 0.0, 1.0) * last;
    let fl = min(floor(x), last - 1.0);
    let f = x - fl;
    let p0 = curve_point(u32(fl));
    let p1 = curve_point(u32(fl) + 1u);
    let d = p1 - p0;
    let l = length(d);
    var tan = vec3<f32>(0.0);
    if (l > 0.0) { tan = d / l; }
    return array<vec3<f32>, 2>(p0 + d * f, tan);
}

// ---- a mesh's surface ----

fn surf_pick(h: u32) -> u32 {
    let n = uu(26u, 2u);
    let x = hash1(hash2(h, 13u));
    if (uu(27u, 3u) != 0u) { return x % max(n, 1u); }
    // The first entry of the cumulative area table at or past x.
    var lo = 0u;
    var hi = n;
    let base = uu(26u, 1u);
    while (lo < hi) {
        let mid = (lo + hi) / 2u;
        if (tab[base + mid] < x) { lo = mid + 1u; } else { hi = mid; }
    }
    return min(lo, max(n, 1u) - 1u);
}

fn surf_corner(tri: u32, k: u32) -> u32 { return tab[uu(26u, 0u) + 3u * tri + k]; }

// The point of weights w on triangle tri in pose p.
fn surf_in_pose(tri: u32, w: vec3<f32>, p: u32) -> vec3<f32> {
    let stride = 1u + 3u * uu(27u, 1u);
    let base = uu(26u, 3u) + p * stride + 1u;
    return tv3(base + 3u * surf_corner(tri, 0u)) * w.x + tv3(base + 3u * surf_corner(tri, 1u)) * w.y
        + tv3(base + 3u * surf_corner(tri, 2u)) * w.z;
}

fn pose_time(p: u32) -> f32 { return tf(uu(26u, 3u) + p * (1u + 3u * uu(27u, 1u))); }

// The point at time tau: exact at a pose's time, linear between the poses about it.
fn surf_point(tri: u32, w: vec3<f32>, tau: f32) -> vec3<f32> {
    let n = uu(27u, 0u);
    var i = 0u;
    for (var j = 1u; j < n; j++) { if (pose_time(j) <= tau) { i = j; } }
    let a = surf_in_pose(tri, w, i);
    if (i + 1u >= n) { return a; }
    let t0 = pose_time(i);
    let f = clamp((tau - t0) / (pose_time(i + 1u) - t0), 0.0, 1.0);
    if (f == 0.0) { return a; }
    return a + (surf_in_pose(tri, w, i + 1u) - a) * f;
}

fn surf_normal(tri: u32, tau: f32) -> vec3<f32> {
    let a = surf_point(tri, vec3<f32>(1.0, 0.0, 0.0), tau);
    let b = surf_point(tri, vec3<f32>(0.0, 1.0, 0.0), tau);
    let c = surf_point(tri, vec3<f32>(0.0, 0.0, 1.0), tau);
    let n = cross(b - a, c - a);
    if (length(n) > 0.0) { return normalize(n); }
    return vec3<f32>(0.0, 1.0, 0.0);
}

fn surf_now(tri: u32, w: vec3<f32>) -> vec3<f32> {
    let p = vec3<u32>(surf_corner(tri, 0u), surf_corner(tri, 1u), surf_corner(tri, 2u)) * 3u;
    let v = array<vec3<f32>, 3>(
        vec3<f32>(now[p.x], now[p.x + 1u], now[p.x + 2u]),
        vec3<f32>(now[p.y], now[p.y + 1u], now[p.y + 2u]),
        vec3<f32>(now[p.z], now[p.z + 1u], now[p.z + 2u]),
    );
    return v[0] * w.x + v[1] * w.y + v[2] * w.z;
}

// ---- the particle ----

struct Birth { gen: u32, age: f32, h: u32, at: vec3<f32>, push: vec3<f32>, ok: bool }

fn burst_slot(e: u32, t: f32) -> Birth {
    var out = Birth(0u, 0.0, 0u, vec3<f32>(0.0), vec3<f32>(0.0), false);
    let base = uu(18u, 1u);
    let rows = uu(18u, 2u);
    let n = max(uu(0u, 2u), 1u);
    // Rows born by t.
    var lo = 0u;
    var hi = rows;
    while (lo < hi) {
        let mid = (lo + hi) / 2u;
        if (tf(base + mid * 16u) <= t) { lo = mid + 1u; } else { hi = mid; }
    }
    if (lo == 0u) { return out; }
    let total = tab[base + (lo - 1u) * 16u + 12u] + tab[base + (lo - 1u) * 16u + 11u];
    if (total == 0u || total - 1u < e) { return out; }
    let g = e + n * ((total - 1u - e) / n);
    // The row holding particle g: the first whose first + count passes g.
    var a = 0u;
    var b = rows;
    while (a < b) {
        let mid = (a + b) / 2u;
        let r = base + mid * 16u;
        if (tab[r + 12u] + tab[r + 11u] <= g) { a = mid + 1u; } else { b = mid; }
    }
    let r = base + a * 16u;
    let j = g - tab[r + 12u];
    let inherit = vec2<f32>(uf(21u, 0u), uf(21u, 1u));
    out.gen = a;
    out.age = t - tf(r);
    out.h = hash4(uu(0u, 3u), j, a, 0xb0b5u);
    out.at = tv3(r + 1u);
    out.push = tv3(r + 4u) * (inherit.x * tf(r + 7u)) + tv3(r + 8u) * inherit.y;
    out.ok = true;
    return out;
}

fn rate_slot(e: u32) -> Birth {
    var out = Birth(0u, 0.0, 0u, uv3(1u), vec3<f32>(0.0), false);
    let count = uu(0u, 2u);
    let rate = uf(1u, 3u);
    if ((rate <= 0.0 && uu(25u, 1u) == 0u) || count == 0u) { return out; }
    let n_int = uu(21u, 2u);
    // Word 3 is one past the last birth the span allows; none when it is 0.
    let bound = uu(21u, 3u);
    if (bound == 0u) { return out; }
    let last = min(n_int, bound - 1u);
    if (last < e) { return out; }
    let gen = (last - e) / count;
    let k = e + gen * count;
    out.gen = gen;
    out.age = (f32(n_int - k) + uf(22u, 0u)) / rate;
    let pieces = uu(25u, 1u);
    if (pieces > 0u) {
        // A keyed rate: when the emitted count reached k, from the piece holding it.
        let base = uu(25u, 0u);
        var i = 0u;
        for (var j = 1u; j < pieces; j++) { if (tf(base + 4u * j + 1u) <= f32(k)) { i = j; } }
        let p = base + 4u * i;
        let need = f32(k) - tf(p + 1u);
        var dt: f32;
        if (abs(tf(p + 3u)) < 1e-12) { dt = need / tf(p + 2u); }
        else { dt = 2.0 * need / (tf(p + 2u) + sqrt(max(tf(p + 2u) * tf(p + 2u) + 2.0 * tf(p + 3u) * need, 0.0))); }
        out.age = uf(0u, 0u) - (tf(p) + dt);
    }
    out.h = hash3(uu(0u, 3u), e, gen);
    out.ok = true;
    return out;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let e = gid.x + uu(0u, 1u);
    let count = uu(0u, 2u);
    if (e >= count) { return; }
    let base = e * 8u;
    let t = uf(0u, 0u);
    var b: Birth;
    if (uu(20u, 3u) != 0u) { b = burst_slot(e, t); } else { b = rate_slot(e); }
    // The planted emitter that hides every particle from its span's end on.
    if ((uu(24u, 2u) & 2u) != 0u && t >= uf(2u, 0u)) { b.ok = false; }
    for (var k = 0u; k < 8u; k++) { inst[base + k] = 0.0; }
    inst[base + 3u] = -1.0;
    if (!b.ok) { return; }
    let h = b.h;
    let life = mix(uf(2u, 1u), uf(2u, 2u), draw(h, 1u));
    let age = b.age;
    if (age >= life) { return; }
    let r5 = draw(h, 5u);
    let r6 = draw(h, 6u);
    let r7 = draw(h, 7u);
    let r12 = draw(h, 12u);
    let shape = uu(2u, 3u);
    let origin = uv3(1u);
    var on_curve = vec3<f32>(0.0);
    if (shape == 3u) { on_curve = curve_at(r5)[0] - origin; }
    var birth = b.at + region(shape, uu(4u, 0u) != 0u, uv3(3u), r5, r6, r7, r12) + on_curve;
    // On a mesh's surface: a triangle by area, a uniform point on it as evaluated at the birth,
    // and what the particle inherits there.
    var tri = 0u;
    let sw = vec3<f32>(1.0 - sqrt(r5), sqrt(r5) * (1.0 - r6), sqrt(r5) * r6);
    var push = b.push;
    if (shape == 8u) {
        tri = surf_pick(h);
        let born = t - age;
        birth = surf_point(tri, sw, born);
        push = surf_normal(tri, born) * uf(21u, 0u);
        var w0 = born - uf(28u, 0u);
        var w1 = born + uf(28u, 0u);
        var ok = uu(28u, 1u) == 0u;
        if (uu(20u, 3u) != 0u) {
            let row = uu(18u, 1u) + b.gen * 16u;
            w0 = tf(row + 13u);
            w1 = tf(row + 14u);
            ok = tab[row + 15u] != 0u;
        }
        if (ok && w1 > w0) { push += (surf_point(tri, sw, w1) - surf_point(tri, sw, w0)) / (w1 - w0) * uf(21u, 1u); }
    }
    var pos: vec3<f32>;
    var vel: vec3<f32>;
    let motion = uu(4u, 1u);
    if (motion == 0u) {
        var v0: vec3<f32>;
        if (uu(4u, 2u) == 1u) {
            v0 = uv3(5u);
        } else {
            let s = mix(uf(5u, 0u), uf(5u, 1u), draw(h, 2u));
            let az = TAU * draw(h, 3u);
            let cu = 1.0 - 0.6 * draw(h, 4u);
            let su = sqrt(max(1.0 - cu * cu, 0.0));
            v0 = vec3<f32>(su * cos(az), cu, su * sin(az)) * s;
        }
        let p = ballistic(Arc(birth, v0 + push, uv3(6u), uf(4u, 3u)), age, life);
        if (!p.alive) { return; }
        pos = p.pos;
        vel = p.vel;
    } else if (motion == 1u) {
        let l = max(uf(22u, 2u), 1e-6);
        var s0 = 0.0;
        if (shape == 3u) { s0 = r5 * uf(22u, 2u); }
        let c = curve_at((s0 + uf(22u, 3u) * age) / l);
        pos = c[0];
        vel = c[1] * uf(22u, 3u);
    } else if (motion == 2u) {
        let axis = uv3(23u);
        var k = vec3<f32>(0.0);
        if (length(axis) > 0.0) { k = normalize(axis); }
        let spin = uf(23u, 3u);
        let rel = birth - origin;
        let ang = spin * age;
        let rot = rel * cos(ang) + cross(k, rel) * sin(ang) + k * (dot(k, rel) * (1.0 - cos(ang)));
        pos = origin + rot;
        vel = cross(k, rot) * spin;
    } else {
        let amp = uf(24u, 0u);
        let w = TAU * uf(24u, 1u);
        pos = birth;
        for (var i = 0u; i < 3u; i++) {
            let x = w * age + TAU * draw(h, 8u + i);
            pos[i] += amp * sin(x);
            vel[i] = amp * w * cos(x);
        }
    }
    if (motion != 0u && !keeps(pos)) { return; }
    // Follow: its place on its triangle, on the surface as evaluated at t, its motion from there.
    if (shape == 8u && uu(27u, 2u) != 0u) { pos = surf_now(tri, sw) + (pos - birth); }
    let strength = uf(17u, 0u);
    let paths = uu(17u, 1u);
    if (strength != 0.0 && paths > 0u) {
        let steps = uu(17u, 2u);
        let travel = uf(17u, 3u);
        let p = hash1(hash2(h, 11u)) % paths;
        let row0 = uu(18u, 0u) + 3u * p * steps;
        if (steps < 2u) {
            pos += tv3(row0) * strength;
        } else {
            let last = f32(steps - 1u);
            let raw = age / travel * last;
            let s = clamp(raw, 0.0, last);
            let k = min(u32(floor(s)), steps - 2u);
            let f = s - f32(k);
            let a = tv3(row0 + 3u * k);
            let c = tv3(row0 + 3u * k + 3u);
            pos += (a + (c - a) * f) * strength;
            if (raw >= 0.0 && raw < last) { vel += (c - a) * (last / travel) * strength; }
        }
    }
    inst[base + 0u] = pos.x;
    inst[base + 1u] = pos.y;
    inst[base + 2u] = pos.z;
    inst[base + 3u] = age / life;
    inst[base + 4u] = vel.x;
    inst[base + 5u] = vel.y;
    inst[base + 6u] = vel.z;
}
