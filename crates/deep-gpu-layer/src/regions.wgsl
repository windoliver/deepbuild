// #462: the look regions' composite (canvas primitives: Look `look@1`: regions and edges; Cost:
// "each look renders its side offscreen, then one composite pass"). Each look's render of the
// whole frame is mixed per pixel by its coverage, which sums to one: per side of the frame, the
// side's own look covers everything, and each of its regions in view passes coverage from what
// lies under it to its own look across its mask's boundary as seen, shaped by its edge (straight,
// torn, pixel or brush) and seeded from the region. Inside a transition window the two sides mix
// by the transition's progress. In 3D the boundary is measured at the world point each pixel sees
// (from the depth target), in 2D at the page point in u; an edge's noise lives on that point, so
// an orbit or a push never makes it swim. `DEPTH` is the depth binding and `view_z` reads a
// pixel's view depth from it: a renderer's own depth target, or view depths read back.

struct Frame {
    // 3D: the camera as `Camera::unproject` reads it: eye (w: perspective), right (w: scale in
    // px), up (w: near), forward (w: an orthographic view's far), centre and roll (cos, sin).
    eye: vec4<f32>,
    right: vec4<f32>,
    up: vec4<f32>,
    forward: vec4<f32>,
    view: vec4<f32>,
    // 2D: u = px * page.x + page.yz; page.w px per u.
    page: vec4<f32>,
    // Output px (xy), depth texels per output px (zw).
    size: vec4<f32>,
    // Each side's look (its texture's index) and weight.
    sides: vec4<f32>,
    // Mode (0: 3D, 1: 2D), regions, sides, planted twin.
    counts: vec4<u32>,
}

struct Region {
    // World (or page) to the mask's unit volume, by rows.
    inv0: vec4<f32>,
    inv1: vec4<f32>,
    inv2: vec4<f32>,
    // Axis lengths (xyz); shape in w: 0 box, 1 cylinder, 2 sphere.
    lens: vec4<f32>,
    // The mask's centre, where a pixel on open ground measures it.
    centre: vec4<f32>,
    // Edge (0 straight, 1 torn, 2 pixel, 3 brush), look, side, seed's low bits.
    tag: vec4<u32>,
    // Seed's high bits.
    seed_hi: vec4<u32>,
    // Width in px.
    params: vec4<f32>,
}

@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var<storage, read> regions: array<Region>;
@group(0) @binding(2) var look0: texture_2d<f32>;
@group(0) @binding(3) var look1: texture_2d<f32>;
@group(0) @binding(4) var look2: texture_2d<f32>;
@group(0) @binding(5) var look3: texture_2d<f32>;
@group(0) @binding(6) var depth: DEPTH;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn mix32(v: u32) -> u32 {
    var x = v;
    x = x ^ (x >> 16u);
    x = x * 0x7feb352du;
    x = x ^ (x >> 15u);
    x = x * 0x846ca68bu;
    x = x ^ (x >> 16u);
    return x;
}

// A fixed hash of (seed, cell) to [0, 1).
fn hash(seed: vec2<u32>, c: vec3<i32>) -> f32 {
    var h = mix32(seed.x ^ 0x9e3779b9u) ^ mix32(seed.y + 0x85ebca6bu);
    h = mix32(h ^ bitcast<u32>(c.x));
    h = mix32(h ^ (bitcast<u32>(c.y) * 0x27d4eb2du));
    h = mix32(h ^ (bitcast<u32>(c.z) * 0x165667b1u));
    return f32(h >> 8u) / 16777216.0;
}

// Value noise in [-1, 1], smooth between lattice points.
fn noise(seed: vec2<u32>, p: vec3<f32>) -> f32 {
    let i = floor(p);
    let u = p - i;
    let f = u * u * (3.0 - 2.0 * u);
    let c = vec3<i32>(i);
    var out = 0.0;
    for (var k = 0u; k < 8u; k = k + 1u) {
        let o = vec3<u32>(k & 1u, (k >> 1u) & 1u, (k >> 2u) & 1u);
        let w = select(1.0 - f.x, f.x, o.x == 1u)
            * select(1.0 - f.y, f.y, o.y == 1u)
            * select(1.0 - f.z, f.z, o.z == 1u);
        out = out + w * hash(seed, c + vec3<i32>(o));
    }
    return out * 2.0 - 1.0;
}

fn fbm(seed: vec2<u32>, p: vec3<f32>) -> f32 {
    var out = 0.0;
    for (var o = 0u; o < 3u; o = o + 1u) {
        let k = f32(1u << o);
        out = out + noise(vec2<u32>(seed.x + o, seed.y), p * k) / k;
    }
    return out / 1.75;
}

fn local(r: Region, p: vec3<f32>) -> vec3<f32> {
    let q = vec4<f32>(p, 1.0);
    return vec3<f32>(dot(r.inv0, q), dot(r.inv1, q), dot(r.inv2, q));
}

fn boxed(d: vec3<f32>) -> f32 {
    let inside = max(d.x, max(d.y, d.z));
    if inside <= 0.0 {
        return inside;
    }
    return length(max(d, vec3<f32>(0.0)));
}

// The signed distance from p to the mask's surface, in its units, negative inside.
fn signed_distance(r: Region, p: vec3<f32>) -> f32 {
    let q = local(r, p);
    let l = r.lens.xyz;
    let shape = u32(r.lens.w);
    if shape == 2u {
        let s = (l.x + l.y + l.z) / 3.0;
        return length(q) * s - 0.5 * s;
    }
    if shape == 1u {
        let radial = (length(q.xz) - 0.5) * (l.x + l.z) / 2.0;
        let along = (abs(q.y) - 0.5) * l.y;
        let inside = max(radial, along);
        if inside <= 0.0 {
            return inside;
        }
        return length(max(vec2<f32>(radial, along), vec2<f32>(0.0)));
    }
    return boxed((abs(q) - 0.5) * l);
}

// What one region covers of a pixel, 0 to 1: sd its signed distance in px (negative inside), p
// the point the pixel sees, k px per unit there, block_sd the distance at its block's centre.
fn covered(r: Region, sd: f32, p: vec3<f32>, k: f32, block_sd: f32) -> f32 {
    let w = max(r.params.x, 1.0);
    let seed = vec2<u32>(r.tag.w, r.seed_hi.x);
    let at = p * k / (1.5 * w);
    switch r.tag.x {
        case 1u: {
            let tear = 0.5 * w * fbm(seed, at)
                + 0.12 * w * noise(vec2<u32>(seed.x ^ 0xf1bu, seed.y), at * 7.0);
            return clamp(0.5 - (sd + tear) / 1.5, 0.0, 1.0);
        }
        case 2u: {
            return select(0.0, 1.0, block_sd < 0.0);
        }
        case 3u: {
            let streak = noise(
                vec2<u32>(seed.x ^ 0xb7u, seed.y),
                vec3<f32>(at.x * 0.5, at.y * 4.0, at.z * 0.5),
            );
            let soft = max(0.25 * w, 1.0);
            return clamp(0.5 - (sd + 0.4 * w * fbm(seed, at) + 0.2 * w * streak) / soft, 0.0, 1.0);
        }
        default: {
            return clamp(0.5 - sd, 0.0, 1.0);
        }
    }
}

fn perspective() -> bool {
    return frame.eye.w > 0.5;
}

// The world point at frame px (x, y) and depth z along the forward axis (`Camera::unproject`).
fn unproject(x: f32, y: f32, z: f32) -> vec3<f32> {
    let c = frame.view.z;
    let sn = frame.view.w;
    let dx = x - frame.view.x;
    let dy = y - frame.view.y;
    let rx = dx * c + dy * sn;
    let ry = -dx * sn + dy * c;
    let s = select(frame.right.w, frame.right.w / z, perspective());
    return frame.eye.xyz + frame.right.xyz * (rx / s) - frame.up.xyz * (ry / s)
        + frame.forward.xyz * z;
}

// Px per m at depth z (`Camera::px_per_m`).
fn px_per_m(z: f32) -> f32 {
    return select(frame.right.w, frame.right.w / max(z, 1e-9), perspective());
}

// The view depth of a reversed-Z depth target's value, 0 where nothing drew.
fn from_depth(d: f32) -> f32 {
    if !(d > 0.0) {
        return 0.0;
    }
    if perspective() {
        return frame.up.w / d;
    }
    return frame.forward.w - d * (frame.forward.w - frame.up.w);
}

// What a pixel sees of a region: its point, px per unit there, and its signed distance in px at
// its centre and at the centre of its block (a pixel edge's steps).
struct Seen {
    p: vec3<f32>,
    k: f32,
    sd: f32,
    block_sd: f32,
    ok: bool,
}

fn seen(r: Region, x: f32, y: f32, hit: f32) -> Seen {
    var out: Seen;
    let block = max(round(r.params.x / 4.0), 2.0);
    let bx = floor((x - 0.5) / block) * block + block / 2.0;
    let by = floor((y - 0.5) / block) * block + block / 2.0;
    if frame.counts.x == 1u {
        out.p = vec3<f32>(vec2<f32>(x, y) * frame.page.x + frame.page.yz, 0.0);
        out.k = frame.page.w;
        out.sd = signed_distance(r, out.p) * out.k;
        let bp = vec3<f32>(vec2<f32>(bx, by) * frame.page.x + frame.page.yz, 0.0);
        out.block_sd = signed_distance(r, bp) * out.k;
        out.ok = true;
        return out;
    }
    // On open ground, the point at the mask's own depth.
    var z = hit;
    if !(z > 0.0) {
        z = dot(r.centre.xyz - frame.eye.xyz, frame.forward.xyz);
    }
    out.ok = z > 0.0;
    if !out.ok {
        return out;
    }
    out.p = unproject(x, y, z);
    out.k = px_per_m(z);
    out.sd = signed_distance(r, out.p) * out.k;
    out.block_sd = signed_distance(r, unproject(bx, by, z)) * out.k;
    return out;
}

fn render(j: u32, px: vec2<i32>) -> vec4<f32> {
    switch j {
        case 1u: { return textureLoad(look1, px, 0); }
        case 2u: { return textureLoad(look2, px, 0); }
        case 3u: { return textureLoad(look3, px, 0); }
        default: { return textureLoad(look0, px, 0); }
    }
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = vec2<i32>(floor(pos.xy));
    let hit = view_z(vec2<i32>(floor(pos.xy * frame.size.zw)));
    var share = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
    for (var s = 0u; s < frame.counts.z; s = s + 1u) {
        let base = u32(select(frame.sides.x, frame.sides.z, s == 1u));
        let weight = select(frame.sides.y, frame.sides.w, s == 1u);
        var c = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
        c[base] = 1.0;
        for (var i = 0u; i < frame.counts.y; i = i + 1u) {
            let r = regions[i];
            if r.tag.z != s {
                continue;
            }
            let v = seen(r, pos.x, pos.y, hit);
            if !v.ok {
                continue;
            }
            let m = covered(r, v.sd, v.p, v.k, v.block_sd);
            var keep = 1.0 - m;
            if frame.counts.w == 1u {
                // The planted twin: what lies under keeps only what its own copy of the edge,
                // moved half the width outward, leaves outside.
                let half = r.params.x / 2.0;
                keep = 1.0 - covered(r, v.sd - half, v.p, v.k, v.block_sd - half);
            }
            for (var j = 0u; j < 4u; j = j + 1u) {
                c[j] = c[j] * keep;
            }
            c[r.tag.y] = c[r.tag.y] + m;
        }
        for (var j = 0u; j < 4u; j = j + 1u) {
            share[j] = share[j] + weight * c[j];
        }
    }
    var out = vec4<f32>(0.0);
    for (var j = 0u; j < 4u; j = j + 1u) {
        if share[j] != 0.0 {
            out = out + share[j] * render(j, px);
        }
    }
    return out;
}
