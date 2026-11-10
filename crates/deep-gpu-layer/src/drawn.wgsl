// A drawn look's passes (canvas primitives: Look `look@1`: paper; drawn fills; light; Paint: noise
// fill). `paper` draws the ground from the paper field; `medium` lays one item's coverage through
// its fill or line; `relief` shades a finished layer from a height field. What a pixel shows is a
// pure function of where it lands on the page, the seeds and the zoom, never of playback. In a 2D
// layer colors are premultiplied and sRGB-encoded; in a 3D layer, premultiplied linear light.

struct U {
    // Pixel to field: scale in x, offset in yz, zoom in w.
    m: vec4<f32>,
    size: vec2<f32>,
    // The tile's side in u at one `scale`: an image's in its pixels, a kind's in teeth.
    span: vec2<f32>,
    // scale px, depth, texels per tooth, 1 when fine octaves fade.
    tooth: vec4<f32>,
    ground: vec4<f32>,
    color: vec4<f32>,
    box_: vec4<f32>,
    a: vec4<f32>,
    b: vec4<f32>,
    c: vec4<f32>,
    d: vec4<f32>,
    // Light toward, on the page: x, y; sin elevation; dry.
    light: vec4<f32>,
    // Pressure, or -1; relief strength; seed offset in the grain's u.
    press: vec4<f32>,
    // Medium kind, item seed, the count of `list`, flags: 1 there's a tooth, 2 a 3D surface, 4
    // linear light.
    kind: vec4<u32>,
    list: array<vec4<f32>, 64>,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var tile: texture_2d<f32>;
@group(0) @binding(2) var wrap: sampler;
@group(0) @binding(3) var grain: texture_2d<f32>;
@group(0) @binding(4) var cover: texture_2d<f32>;
@group(0) @binding(5) var soft: texture_2d<f32>;
@group(0) @binding(6) var clamped: sampler;
@group(0) @binding(7) var resist: texture_2d<f32>;

// The grain's side in teeth and texels, as deep_canvas_drawn::tooth builds it.
const GRAIN_TEETH: f32 = 64.0;
const GRAIN_PER_TOOTH: f32 = 8.0;
const TAU: f32 = 6.28318530718;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn field_at(px: vec2<f32>) -> vec2<f32> {
    return px * u.m.x + u.m.yz;
}

fn hash1(x: u32) -> u32 {
    let s = x * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}

fn rand(x: u32) -> f32 {
    return f32(hash1(x) >> 8u) * 5.9604645e-8;
}

fn hash2(c: vec2<i32>, s: u32) -> u32 {
    return hash1(hash1(s ^ u32(c.x)) ^ u32(c.y));
}

fn smooth01(x: f32) -> f32 {
    let t = clamp(x, 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

fn decode(v: vec3<f32>) -> vec3<f32> {
    return select(pow((v + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4)), v / 12.92, v <= vec3<f32>(0.04045));
}

fn encode(v: vec3<f32>) -> vec3<f32> {
    return select(1.055 * pow(max(v, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - 0.055, v * 12.92, v <= vec3<f32>(0.0031308));
}

// The tooth's tile at `p` u, teeth `scale` u across, at the mip one screen pixel covers.
fn read(p: vec2<f32>, scale: f32) -> f32 {
    let texels_per_px = u.tooth.z / max(scale * u.m.w, 1e-3);
    return textureSampleLevel(tile, wrap, p / (scale * u.span), max(log2(texels_per_px), 0.0)).r;
}

// The grain's four channels at `p`, teeth `scale` u across.
fn fine(p: vec2<f32>, scale: f32) -> vec4<f32> {
    let texels_per_px = GRAIN_PER_TOOTH / max(scale * u.m.w, 1e-3);
    return textureSampleLevel(grain, wrap, p / (scale * GRAIN_TEETH), max(log2(texels_per_px), 0.0));
}

// The tooth at `p`. Each octave is a fixed pattern on the page, half the size and a fifth the weight
// of the one before: it fades in over the octave of zoom before it, and out three octaves after, so
// detail neither swims nor pops and most of the field outlives any step of a zoom. At zoom 1 the
// tooth is the design's scale alone; zooming out, each coarser octave takes over from the last.
fn tooth_at(p: vec2<f32>) -> f32 {
    let scale = u.tooth.x;
    let z = log2(max(u.m.w, 1e-3));
    if (u.tooth.w > 0.5) {
        // Fine detail fades toward a mean tooth instead of bringing in finer octaves.
        return 1.0 - u.tooth.y * (1.0 - mix(read(p, scale), 0.5, smooth01(z)));
    }
    let k = i32(floor(z));
    var sum = 0.0;
    var weights = 0.0;
    for (var l = min(k - 3, 0); l <= k + 1; l++) {
        let level = f32(l);
        let last = select(0.0, 3.0, l >= 0);
        let w = smooth01(z - level + 1.0) * (1.0 - smooth01(z - level - last)) * pow(0.2, level);
        if (w > 0.0) {
            sum += w * read(p, scale * pow(0.5, level));
            weights += w;
        }
    }
    return 1.0 - u.tooth.y * (1.0 - sum / max(weights, 1e-6));
}

// Page-space distance to the segment a to b.
fn to_segment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
    let d = b - a;
    return length(p - a - d * clamp(dot(p - a, d) / max(dot(d, d), 1e-6), 0.0, 1.0));
}

@fragment
fn paper(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    return sheet_at(field_at(at.xy));
}

fn sheet_at(p: vec2<f32>) -> vec4<f32> {
    let h = tooth_at(p);
    let g = fine(p, 32.0);
    var c = u.ground.rgb;
    // A tooth shades the sheet a little: pits catch less light than peaks.
    c *= 1.0 - u.a.x * (1.0 - h);
    // Stains: at most one soft ring a cell, seeded, in their role.
    if (u.a.y > 0.0) {
        let q = p / u.a.y;
        let cell = vec2<i32>(floor(q));
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                let id = cell + vec2<i32>(x, y);
                let s = hash2(id, u.kind.y);
                let center = (vec2<f32>(id) + vec2<f32>(rand(s), rand(s ^ 77u))) * u.a.y;
                let r = u.a.z * (0.5 + 0.5 * rand(s ^ 15u));
                let d = length(p - center) / r + (g.y - 0.5) * 0.5;
                let ring = smoothstep(1.0, 0.65, d) * (0.4 + 0.6 * smoothstep(0.3, 0.8, d));
                c = mix(c, u.light.rgb, ring * 0.22);
            }
        }
    }
    // The sheet repeats along the world, so a long dolly stays on paper.
    let sheet = p - floor(p / u.size) * u.size;
    var i = 0u;
    // Folds and creases: dark along their line.
    for (var n = 0u; n < u.kind.x; n++) {
        let s = u.list[i];
        let k = u.list[i + 1u];
        i += 2u;
        c *= 1.0 - k.x * smoothstep(k.y, 0.0, to_segment(sheet, s.xy, s.zw));
    }
    // Foxing: rust specks where the cells run close.
    if (u.b.x > 0.0) {
        let speck = smoothstep(0.26, 0.04, fine(p, 32.0).z) * smoothstep(0.4, 0.75, g.y);
        c = mix(c, c * vec3<f32>(0.82, 0.66, 0.46), speck * u.b.x);
    }
    // Craquelure: thin dark lines where two cells meet.
    if (u.b.z > 0.0) {
        c *= 1.0 - u.b.z * smoothstep(0.05, 0.015, fine(p, u.b.y).x);
    }
    // A plate mark: a pressed rectangle's edge, inset from the sheet.
    if (u.c.y > 0.0) {
        let inner = abs(sheet - u.size * 0.5) - (u.size * 0.5 - vec2<f32>(u.c.x));
        c *= 1.0 - 0.3 * u.c.y * smoothstep(3.0, 0.0, abs(max(inner.x, inner.y)));
    }
    // Tarnish: a ramp creeping in from the sheet's edge.
    if (u.d.x > 0.0) {
        let edge = min(min(sheet.x, sheet.y), min(u.size.x - sheet.x, u.size.y - sheet.y)) + (g.y - 0.5) * u.d.x;
        let t = smoothstep(u.d.x, 0.0, edge);
        c = mix(c, mix(u.box_.rgb, u.color.rgb, t), t * 0.7);
    }
    // Tape: pale strips over the sheet.
    for (var n = 0u; n < u.kind.z; n++) {
        let r = u.list[i];
        i += 1u;
        let inside = step(r.x, sheet.x) * step(sheet.x, r.x + r.z) * step(r.y, sheet.y) * step(sheet.y, r.y + r.w);
        c = mix(c, vec3<f32>(0.93, 0.86, 0.66), inside * 0.45);
    }
    // A backlit screen: dim but for the pools of light its lamps throw through it.
    let lamps = u32(u.d.z);
    if (lamps > 0u) {
        var glow = vec3<f32>(0.0);
        for (var n = 0u; n < lamps; n++) {
            let d = length(p - u.list[i].xy) / 320.0;
            glow += decode(u.list[i + 1u].rgb) / (1.0 + d * d);
            i += 2u;
        }
        c = encode(decode(c) * (0.3 + 0.8 * glow));
    }
    if ((u.kind.w & 4u) != 0u) {
        c = decode(c);
    }
    return vec4<f32>(c, 1.0);
}

fn load(px: vec2<f32>) -> vec4<f32> {
    let hi = vec2<f32>(textureDimensions(cover)) - 1.0;
    return textureLoad(cover, vec2<i32>(clamp(px, vec2<f32>(0.0), hi)), 0);
}

fn blurred(px: vec2<f32>) -> f32 {
    // A surface has no coverage edge of its own to blur.
    if ((u.kind.w & 2u) != 0u) {
        return 1.0;
    }
    return textureSampleLevel(soft, clamped, px / u.size, 0.0).a;
}

// How lit a pixel is, 0..1: a 2D item's dome under the look's light, or a 3D surface's own light.
fn tone_at(px: vec2<f32>, c: vec4<f32>) -> f32 {
    if ((u.kind.w & 2u) != 0u) {
        return clamp(luma(c.rgb) / max(luma(u.color.rgb), 0.02), 0.0, 1.0);
    }
    let q = (px - u.box_.xy - u.box_.zw * 0.5) / max(u.box_.zw * 0.5, vec2<f32>(1.0));
    return clamp(0.5 + 0.5 * dot(q, u.light.xy), 0.0, 1.0);
}

fn luma(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn rotated(p: vec2<f32>, deg: f32) -> vec2<f32> {
    let r = radians(deg);
    let c = cos(r);
    let s = sin(r);
    return vec2<f32>(c * p.x + s * p.y, -s * p.x + c * p.y);
}

// Round dots a seeded lattice holds: `density` of its cells, radii r0 to r1 px, stretched along `deg`.
fn dots(p: vec2<f32>, r0: f32, r1: f32, density: f32, deg: f32, seed: u32) -> f32 {
    let size = max(r1 * 4.0, 4.0);
    let cell = vec2<i32>(floor(p / size));
    var best = 0.0;
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let id = cell + vec2<i32>(x, y);
            let s = hash2(id, seed);
            if (rand(s) >= density) {
                continue;
            }
            let center = (vec2<f32>(id) + vec2<f32>(rand(s ^ 3u), rand(s ^ 5u))) * size;
            let r = mix(r0, r1, rand(s ^ 7u));
            let d = rotated(p - center, deg) / vec2<f32>(1.6, 1.0);
            best = max(best, smoothstep(r + 0.7, r - 0.7, length(d)));
        }
    }
    return best;
}

fn ink(px: vec2<f32>, c0: vec4<f32>, q: vec2<f32>) -> f32 {
    var a = c0.a;
    let spread = u.b.z;
    if (spread > 0.0) {
        for (var k = 0; k < 8; k++) {
            let t = f32(k) * TAU / 8.0;
            a = max(a, load(px + vec2<f32>(cos(t), sin(t)) * spread).a);
        }
    }
    let g = fine(q, 8.0);
    if (u.b.w > 1.5) {
        // Ragged: the edge breaks where the fine grain falls.
        let e = 1.0 - load(px + (g.yw - 0.5) * 8.0).a;
        a *= 1.0 - e * smoothstep(0.4, 0.6, g.w);
    }
    a *= 1.0 - u.a.z * smoothstep(0.45, 0.72, fine(q, u.a.y / 4.0).y);
    a *= 1.0 - smoothstep(u.a.w * 0.5, u.a.w * 0.25, fine(q, 3.0).z);
    let along = rotated(q, u.b.x);
    a *= 1.0 - u.b.y * smoothstep(0.55, 0.75, fine(vec2<f32>(along.x * 0.05, along.y * 0.8), 4.0).w);
    return a * u.a.x;
}

fn squeezed(px: vec2<f32>) -> f32 {
    // A squeezed edge prints darker: the share of a ring of neighbors outside the shape.
    var out = 0.0;
    for (var k = 0; k < 6; k++) {
        let t = f32(k) * TAU / 6.0;
        out += 1.0 - load(px + vec2<f32>(cos(t), sin(t)) * 3.0).a;
    }
    return clamp(out / 3.0, 0.0, 1.0);
}

fn wash(px: vec2<f32>, q: vec2<f32>, h: f32) -> f32 {
    let g = fine(q, 10.0);
    var at = px;
    if (u.b.y > 0.5) {
        at += (g.yw - 0.5) * u.b.x * 2.0;
    }
    let s = blurred(at);
    var a = max(load(at).a, smoothstep(0.1, 0.6, s));
    // Pigment pools toward the edge, and settles into the tooth's pits.
    var density = 0.62 + 0.38 * u.a.x * (1.0 - s) * 2.0;
    density *= 1.0 + u.a.y * (0.5 - h);
    if ((u.kind.w & 2u) != 0u) {
        // A surface has no edge to pool toward, so its pigment drifts in slow patches.
        density *= 0.7 + 0.6 * fine(q, 30.0).y;
    }
    let n = u32(u.a.z);
    for (var k = 0u; k < n; k++) {
        let center = u.box_.xy + vec2<f32>(rand(u.kind.y + k * 2u), rand(u.kind.y + k * 2u + 1u)) * u.box_.zw;
        let d = length(px - center) / (u.a.w * 0.5) + (g.y - 0.5) * 0.9;
        density *= 1.0 - 0.14 * smoothstep(1.0, 0.5, d) + 0.1 * smoothstep(0.14, 0.0, abs(d - 1.0));
    }
    a *= 1.0 - textureLoad(resist, vec2<i32>(px), 0).a;
    return a * clamp(density, 0.0, 1.0);
}

fn stripe(p: vec2<f32>, deg: f32, jitter: f32) -> f32 {
    let gap = u.a.y;
    let s = rotated(p, deg).y + jitter;
    let d = abs(fract(s / gap + 0.5) - 0.5) * gap;
    return smoothstep(u.a.z * 0.5 + 0.5, u.a.z * 0.5 - 0.5, d);
}

fn hatch(px: vec2<f32>, c0: vec4<f32>, p: vec2<f32>) -> f32 {
    var q = p;
    let g = fine(p, 12.0);
    let follow = u.b.x;
    // A little grain in the tone, so a band of hatching frays instead of ending on a ruled edge.
    let tone = tone_at(px, c0) + (g.y - 0.5) * 0.14;
    var passes = 1u;
    var cross = u.a.w > 0.5;
    let bands = u32(u.b.y);
    if (bands > 0u) {
        passes = 0u;
        for (var k = 0u; k < bands; k++) {
            let band = u.list[k];
            if (tone < band.x) {
                passes = u32(band.y);
                cross = band.z > 0.5;
                break;
            }
        }
    }
    var a = 0.0;
    if (follow > 1.5) {
        q += (g.yw - 0.5) * u.a.y * 6.0;
    }
    for (var k = 0u; k < passes; k++) {
        let deg = u.a.x + f32(k) * 17.0;
        let inside = blurred(px);
        if (follow > 0.5 && follow < 1.5 && (u.kind.w & 2u) == 0u && inside < 0.97) {
            // Outline: contour lines of the shape's blurred coverage, so they follow its form.
            let d = abs(fract(inside * 160.0 / u.a.y + f32(k) * 0.37 + 0.5) - 0.5) * u.a.y;
            a = max(a, smoothstep(u.a.z * 0.5 + 0.5, u.a.z * 0.5 - 0.5, d));
        } else {
            a = max(a, stripe(q, deg, (g.w - 0.5) * 1.5));
        }
        if (cross) {
            a = max(a, stripe(q, deg + 90.0, (g.z - 0.5) * 1.5));
        }
    }
    if (u.b.w > 0.0 && passes == 0u) {
        a = max(a, dots(p, u.b.z * 0.5, u.b.z, u.b.w, 0.0, u.kind.y));
    }
    return a * c0.a;
}

// One corner's gradient in 4D, dotted with the offset from it.
fn corner4(c: vec4<i32>, d: vec4<f32>, s: u32) -> f32 {
    let h = hash1(hash1(hash1(hash1(s ^ u32(c.x)) ^ u32(c.y)) ^ u32(c.z)) ^ u32(c.w));
    let g = vec4<f32>(f32(h & 255u), f32((h >> 8u) & 255u), f32((h >> 16u) & 255u), f32(h >> 24u)) / 127.5 - 1.0;
    return dot(g, d);
}

// Gradient noise on a 4D lattice, about -1..1; `lattice` reads the corners' own values instead.
fn noise4(p: vec4<f32>, s: u32, lattice: bool) -> f32 {
    let i = floor(p);
    let f = p - i;
    let c = vec4<i32>(i);
    let w = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    var sum = 0.0;
    for (var k = 0; k < 16; k++) {
        let o = vec4<i32>(k & 1, (k >> 1) & 1, (k >> 2) & 1, (k >> 3) & 1);
        let b = vec4<f32>(o);
        let weight = mix(1.0 - w.x, w.x, b.x) * mix(1.0 - w.y, w.y, b.y) * mix(1.0 - w.z, w.z, b.z) * mix(1.0 - w.w, w.w, b.w);
        if (lattice) {
            let q = c + o;
            sum += weight * (rand(hash2(q.xy, s) ^ hash2(q.zw, s + 1u)) * 2.0 - 1.0);
        } else {
            sum += weight * corner4(c + o, f - b, s);
        }
    }
    return sum;
}

fn noise_fill(p0: vec2<f32>) -> vec3<f32> {
    let seed = u32(u.d.z);
    var p = (p0 - u.b.zw) / u.a.x;
    p = vec2<f32>(p.x * u.c.x + p.y * u.c.y, -p.x * u.c.y + p.y * u.c.x);
    p.y *= u.a.y;
    var v = 0.0;
    let kind = u32(u.d.x);
    if (kind == 2u) {
        let cell = vec2<i32>(floor(p));
        var near = 9.0;
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                let id = cell + vec2<i32>(x, y);
                let s = hash2(id, seed);
                let t = TAU * rand(s) + u.d.w;
                let at = vec2<f32>(id) + 0.5 + 0.35 * vec2<f32>(cos(t), sin(t));
                near = min(near, length(p - at));
            }
        }
        v = clamp(near, 0.0, 1.0);
    } else {
        var amp = 1.0;
        var norm = 0.0;
        var q = vec4<f32>(p, u.c.zw);
        for (var k = 0u; k < u32(u.a.z); k++) {
            let n = noise4(q, seed + k, kind == 3u);
            v += amp * select(n, abs(n) * 2.0 - 1.0, kind == 1u);
            norm += amp;
            amp *= u.a.w * 1.2;
            q *= 2.0;
        }
        v = 0.5 + 0.5 * clamp(1.6 * v / norm, -1.0, 1.0);
    }
    v = clamp((v - 0.5) * u.b.x + 0.5 + u.b.y, 0.0, 1.0);
    let t = v * 15.0;
    let k = min(u32(t), 14u);
    return mix(u.list[k].rgb, u.list[k + 1u].rgb, t - f32(k));
}

// Paint: dither fill: the 4 × 4 Bayer matrix, deep_canvas_marks::print's BAYER4, and its 8 × 8.
const BAYER4: array<u32, 16> = array<u32, 16>(0u, 8u, 2u, 10u, 12u, 4u, 14u, 6u, 3u, 11u, 1u, 9u, 15u, 7u, 13u, 5u);

fn bayer(c: vec2<i32>, n: u32) -> u32 {
    let x = u32(((c.x % 8) + 8) % 8);
    let y = u32(((c.y % 8) + 8) % 8);
    let b = BAYER4[(y % 4u) * 4u + x % 4u];
    if (n == 4u) {
        return b;
    }
    return 4u * b + select(select(3u, 1u, x >= 4u), select(0u, 2u, x >= 4u), y < 4u);
}

// An ordered dither between adjacent stops: a pixel takes the next stop where its matrix entry,
// read at its world (or frame) pixel, is below the step of its gradient or tone. The step and the
// entry are integers, so every GPU draws the same pixels, and nothing reads time.
fn dither_fill(px: vec2<f32>, c0: vec4<f32>) -> vec3<f32> {
    let world = px * u.a.x + u.a.yz;
    let n = u32(u.b.x);
    let seg = u32(u.b.y) - 1u;
    var v = (px.x - u.box_.x) / max(u.box_.z, 1e-6);
    if (u.b.z > 0.5) {
        v = tone_at(px, c0);
    }
    let along = clamp(v, 0.0, 1.0) * f32(seg);
    let j = min(u32(floor(along)), seg - 1u);
    let step = u32(floor((along - f32(j)) * f32(n * n)));
    let at = vec2<i32>(floor(select(world, px, u.b.w > 0.5)));
    return select(u.list[j].rgb, u.list[j + 1u].rgb, bayer(at, n) < step);
}

fn dabs(p: vec2<f32>, h: f32) -> vec4<f32> {
    let size = 1.0 / sqrt(max(u.a.x, 1e-6));
    var out = vec4<f32>(0.0);
    let flow = fine(p, 40.0).y * TAU;
    for (var layer = 0u; layer < u32(u.a.w); layer++) {
        let cell = vec2<i32>(floor(p / size));
        for (var y = -1; y <= 1; y++) {
            for (var x = -1; x <= 1; x++) {
                let id = cell + vec2<i32>(x, y);
                let s = hash2(id, u.kind.y + layer * 31u);
                let center = (vec2<f32>(id) + vec2<f32>(rand(s), rand(s ^ 3u))) * size;
                let len = mix(u.a.y, u.a.z, rand(s ^ 5u));
                let d = rotated(p - center, degrees(flow) + rand(s ^ 9u) * 40.0);
                let body = smoothstep(1.0, 0.8, length(d / vec2<f32>(len * 0.5, len * 0.16)));
                if (body > out.a) {
                    let pick = u32(rand(s ^ 11u) * u.b.x);
                    out = vec4<f32>(u.list[min(pick, u32(u.b.x) - 1u)].rgb, body);
                }
            }
        }
    }
    return out;
}

// Lamps add light in proportion to a collection's transmission, in linear light, filtered by its
// own hue and never past white, so the light is exactly proportional to the transmission.
fn lit(px: vec2<f32>, c0: vec4<f32>) -> vec4<f32> {
    if (c0.a <= 0.0) {
        return c0;
    }
    let base = decode(clamp(c0.rgb / c0.a, vec3<f32>(0.0), vec3<f32>(1.0)));
    let hue = base / max(max(base.r, max(base.g, base.b)), 1e-4);
    var light = vec3<f32>(0.0);
    for (var k = 0u; k < u32(u.a.y); k++) {
        let lamp = u.list[k * 2u];
        let d = length(px - lamp.xy) / 400.0;
        light += decode(u.list[k * 2u + 1u].rgb) * hue / (1.0 + d * d);
    }
    let room = min(light, vec3<f32>(1.0) - base);
    return vec4<f32>(encode(base + room * u.a.x) * c0.a, c0.a);
}

fn shade(px: vec2<f32>, c0: vec4<f32>, p: vec2<f32>) -> vec4<f32> {
    let kind = u.kind.x;
    let q = p + u.press.zw;
    let has_tooth = (u.kind.w & 1u) != 0u;
    let h = select(1.0, tooth_at(p), has_tooth);
    var out = c0;
    let rgb = u.color.rgb;
    switch kind {
        case 1u: {
            out = vec4<f32>(rgb, 1.0) * ink(px, c0, q);
            if (u.b.w > 0.5 && u.b.w < 1.5) {
                out = vec4<f32>(out.rgb * (1.0 - 0.35 * squeezed(px)), out.a);
            }
        }
        case 2u: {
            out = vec4<f32>(rgb, 1.0) * wash(px, q, h);
        }
        case 3u: {
            var a = dots(p, u.a.x, u.a.y, u.a.z, u.a.w, u.kind.y) * c0.a;
            if (u.b.x > 0.5) {
                a *= step(tone_at(px, c0), 0.5);
            }
            out = vec4<f32>(rgb, 1.0) * a;
        }
        case 4u: {
            out = vec4<f32>(rgb, 1.0) * hatch(px, c0, p);
        }
        case 5u: {
            var n = p;
            if (u.d.y > 0.5) {
                n = px;
            }
            let c = noise_fill(n);
            out = vec4<f32>(select(c, decode(c), (u.kind.w & 4u) != 0u), 1.0) * c0.a;
        }
        case 9u: {
            let c = dither_fill(px, c0);
            out = vec4<f32>(select(c, decode(c), (u.kind.w & 4u) != 0u), 1.0) * c0.a;
        }
        case 6u: {
            let d = dabs(p, h);
            out = vec4<f32>(select(d.rgb, decode(d.rgb), (u.kind.w & 4u) != 0u), 1.0) * d.a * c0.a;
        }
        default: {}
    }
    var k = 1.0;
    if (has_tooth && u.light.w > 0.0) {
        k *= 1.0 - u.light.w * (1.0 - smoothstep(0.3, 0.6, h));
    }
    if (has_tooth && u.press.x >= 0.0) {
        k *= smooth01(h - (1.0 - u.press.x));
    }
    return out * k;
}

@fragment
fn medium(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let px = at.xy;
    let c0 = textureLoad(cover, vec2<i32>(px), 0);
    if (u.kind.x == 7u) {
        return lit(px, c0);
    }
    return shade(px, c0, field_at(px));
}

// `relief` reads the height field by its slope against the light, in the layer's own space.
fn height(px: vec2<f32>) -> f32 {
    if (u.kind.x == 1u) {
        return load(px).a;
    }
    return tooth_at(field_at(px));
}

@fragment
fn relief(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let px = at.xy;
    let c = textureLoad(cover, vec2<i32>(px), 0);
    if (c.a <= 0.0) {
        return c;
    }
    let dx = height(px + vec2<f32>(1.0, 0.0)) - height(px - vec2<f32>(1.0, 0.0));
    let dy = height(px + vec2<f32>(0.0, 1.0)) - height(px - vec2<f32>(0.0, 1.0));
    let n = normalize(vec3<f32>(-dx, -dy, 0.5));
    let l = vec3<f32>(u.light.xy * sqrt(1.0 - u.light.z * u.light.z), u.light.z);
    let shade = mix(1.0, dot(n, l) / max(u.light.z, 0.05), u.press.y);
    return vec4<f32>(c.rgb * clamp(shade, 0.0, 2.0), c.a);
}

// `blit` resamples `soft` into a target of its own size: a collection target at its resolution.
@fragment
fn blit(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    return textureSampleLevel(soft, clamped, at.xy / u.m.yz, 0.0);
}

// In 3D a medium lays over the lit surface of the one item `v.ids.x` names, and the paper shows
// where nothing draws. The field lies on the surface: a point's two longest axes, in u.
struct V {
    inv: mat4x4<f32>,
    // The eye, and the target's px to the frame's in w.
    eye: vec4<f32>,
    ids: vec4<u32>,
    // A rim's direction toward it, its width as a share of a turn, in `rim.w`; its color follows.
    rim: vec4<f32>,
    rim_color: vec4<f32>,
}

@group(1) @binding(0) var<uniform> v: V;
@group(1) @binding(1) var object_ids: texture_2d<u32>;
@group(1) @binding(2) var depth3: texture_depth_2d;

const U_PER_METER: f32 = 300.0;

fn world_at(px: vec2<f32>, depth: f32) -> vec3<f32> {
    let ndc = vec2<f32>(px.x / u.size.x * 2.0 - 1.0, 1.0 - px.y / u.size.y * 2.0);
    let w = v.inv * vec4<f32>(ndc, depth, 1.0);
    return w.xyz / w.w;
}

fn on_surface(w: vec3<f32>, n: vec3<f32>) -> vec2<f32> {
    let a = abs(n);
    if (a.y >= a.x && a.y >= a.z) {
        return w.xz * U_PER_METER;
    }
    if (a.x >= a.z) {
        return w.zy * U_PER_METER;
    }
    return w.xy * U_PER_METER;
}

@fragment
fn copy3(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    return textureLoad(cover, vec2<i32>(at.xy), 0);
}

// Where nothing draws, the paper: its field on the plane z = 0 where each ray lands.
@fragment
fn paper3(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let ix = vec2<i32>(at.xy);
    if (textureLoad(object_ids, ix, 0).r != 0u) {
        discard;
    }
    let far = world_at(at.xy, 1e-3) - v.eye.xyz;
    let t = -v.eye.z / select(far.z, -1e-3, abs(far.z) < 1e-3);
    let p = (v.eye.xyz + far * abs(t)).xy * U_PER_METER;
    return sheet_at(vec2<f32>(p.x, -p.y));
}

@fragment
fn medium3(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let ix = vec2<i32>(at.xy);
    let lit3 = vec4<f32>(textureLoad(cover, ix, 0).rgb, 1.0);
    let w = world_at(at.xy, textureLoad(depth3, ix, 0));
    let n = normalize(cross(dpdx(w), dpdy(w)));
    if (textureLoad(object_ids, ix, 0).r != v.ids.x) {
        discard;
    }
    if (u.kind.x == 8u) {
        // A rim: the surface's edge, leaning toward its direction, in its role.
        let view = normalize(v.eye.xyz - w);
        let edge = pow(1.0 - abs(dot(n, view)), 3.0);
        let toward = max(dot(n, v.rim.xyz), 0.0);
        return vec4<f32>(mix(lit3.rgb, v.rim_color.rgb, clamp(edge * toward * v.rim.w, 0.0, 1.0)), 1.0);
    }
    let p = on_surface(w, n);
    let s = shade(at.xy, lit3, p);
    // The ground takes the surface's light, so what a medium leaves bare reads as lit paper.
    let light = luma(lit3.rgb) / max(luma(u.color.rgb), 0.02);
    let bare = u.ground.rgb * (1.0 - 0.35 * (1.0 - select(1.0, tooth_at(p), (u.kind.w & 1u) != 0u)));
    if (u.kind.x == 6u) {
        return vec4<f32>(lit3.rgb * (1.0 - s.a) + s.rgb * min(light, 1.5), 1.0);
    }
    if (u.kind.x == 0u) {
        return vec4<f32>(bare * min(light, 1.5) * (1.0 - s.a) + s.rgb, 1.0);
    }
    return vec4<f32>((bare * (1.0 - s.a) + s.rgb) * min(light, 1.5), 1.0);
}

// A collection's target in 3D: its pressure, or full coverage, where its item draws.
@fragment
fn target3(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    if (textureLoad(object_ids, vec2<i32>(at.xy * v.eye.w), 0).r != v.ids.x) {
        discard;
    }
    let value = u.press.x;
    return vec4<f32>(value, value, value, 1.0);
}
