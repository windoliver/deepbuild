// The GPU surface's upscale below internal scale 1 (issue #386; canvas primitives: GPU surface):
// an edge-adaptive spatial upscale to full size, or the bilinear stretch it is measured against,
// then a contrast-adaptive sharpen. Each reads only this frame.

struct VOut {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn full(@builtin(vertex_index) i: u32) -> VOut {
    let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    var o: VOut;
    o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
    o.uv = vec2f(p.x, 1.0 - p.y);
    return o;
}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;

// The view's `upscale: bilinear`: a plain stretch, what the edge-adaptive upscale is measured
// against.
@fragment
fn bilinear(v: VOut) -> @location(0) vec4f {
    return textureSampleLevel(src, smp, v.uv, 0.0);
}

fn texel(p: vec2i, dims: vec2i) -> vec4f {
    return textureLoad(src, clamp(p, vec2i(0), dims - 1), 0);
}

fn luma(c: vec4f) -> f32 {
    return dot(c.rgb, vec3f(0.299, 0.587, 0.114));
}

// Lanczos-2 at squared distance r2, zero past 2, by a polynomial in r2 that keeps its zeros at
// 1 and 2.
fn lanczos2(r2: f32) -> f32 {
    let r = min(r2, 4.0);
    let b = 0.4 * r - 1.0;
    let c = 0.25 * r - 1.0;
    return (25.0 / 16.0 * b * b - 9.0 / 16.0) * c * c;
}

// Edge-adaptive, in linear light (where the frame's coverage was blended; `src` is the frame's
// sRGB view, so a load decodes): a Lanczos-2 over the 12 texels around the sample (a 4 × 4 block
// less its corners), turned to the local edge, narrowed across it and widened along it by how
// strong the edge is, and held to the range of the four nearest texels so it never rings. Where
// the edge isn't one straight line (small glyphs, corners), by the coherence of the texels'
// gradients, it eases to a bilinear blend of the four nearest. Written out tap by tap: arrays
// indexed in loops spill on some GPUs.

// One cell's gradient between four texels' lumas, as the structure tensor's terms.
fn cell(a: f32, b: f32, c: f32, d: f32) -> vec3f {
    let e = vec2f(b - a + d - c, c - a + d - b) * 0.5;
    return vec3f(e.x * e.x, e.x * e.y, e.y * e.y);
}

// What every sample between the same four nearest texels shares: the 12 texels and their lumas,
// the four nearest's range, and how far the coherence of their gradients lets the sample sharpen.
struct Near {
    c01: vec4f,
    c02: vec4f,
    c10: vec4f,
    c11: vec4f,
    c12: vec4f,
    c13: vec4f,
    c20: vec4f,
    c21: vec4f,
    c22: vec4f,
    c23: vec4f,
    c31: vec4f,
    c32: vec4f,
    l01: f32,
    l02: f32,
    l10: f32,
    l11: f32,
    l12: f32,
    l13: f32,
    l20: f32,
    l21: f32,
    l22: f32,
    l23: f32,
    l31: f32,
    l32: f32,
    lo: vec4f,
    hi: vec4f,
    contrast: f32,
    sharpness: f32,
};

fn near(i: vec2i, dims: vec2i) -> Near {
    var n: Near;
    n.c01 = texel(i + vec2i(0, -1), dims);
    n.c02 = texel(i + vec2i(1, -1), dims);
    n.c10 = texel(i + vec2i(-1, 0), dims);
    n.c11 = texel(i + vec2i(0, 0), dims);
    n.c12 = texel(i + vec2i(1, 0), dims);
    n.c13 = texel(i + vec2i(2, 0), dims);
    n.c20 = texel(i + vec2i(-1, 1), dims);
    n.c21 = texel(i + vec2i(0, 1), dims);
    n.c22 = texel(i + vec2i(1, 1), dims);
    n.c23 = texel(i + vec2i(2, 1), dims);
    n.c31 = texel(i + vec2i(0, 2), dims);
    n.c32 = texel(i + vec2i(1, 2), dims);
    n.l01 = luma(n.c01);
    n.l02 = luma(n.c02);
    n.l10 = luma(n.c10);
    n.l11 = luma(n.c11);
    n.l12 = luma(n.c12);
    n.l13 = luma(n.c13);
    n.l20 = luma(n.c20);
    n.l21 = luma(n.c21);
    n.l22 = luma(n.c22);
    n.l23 = luma(n.c23);
    n.l31 = luma(n.c31);
    n.l32 = luma(n.c32);
    // The structure tensor over the five cells between them that hold no corner, and its
    // coherence: 1 along one straight edge, 0 where gradients turn every way.
    let jt = cell(n.l01, n.l02, n.l11, n.l12)
        + cell(n.l10, n.l11, n.l20, n.l21)
        + cell(n.l11, n.l12, n.l21, n.l22)
        + cell(n.l12, n.l13, n.l22, n.l23)
        + cell(n.l21, n.l22, n.l31, n.l32);
    let trace = jt.x + jt.z;
    let spread = sqrt((jt.x - jt.z) * (jt.x - jt.z) + 4.0 * jt.y * jt.y);
    let coherence = select(0.0, (spread / trace) * (spread / trace), trace > 1e-8);
    n.sharpness = smoothstep(0.2, 0.7, coherence);
    n.lo = min(min(n.c11, n.c12), min(n.c21, n.c22));
    n.hi = max(max(n.c11, n.c12), max(n.c21, n.c22));
    let lo4 = min(min(n.l11, n.l12), min(n.l21, n.l22));
    let hi4 = max(max(n.l11, n.l12), max(n.l21, n.l22));
    n.contrast = clamp((hi4 - lo4) * 2.0, 0.0, 1.0);
    return n;
}

// Whether the four nearest texels are one color: every sample between them is then that color
// (the edge-adaptive sample is held to their range), so it skips the rest. Most of a frame is.
fn flat(c11: vec4f, c12: vec4f, c21: vec4f, c22: vec4f) -> bool {
    return all(min(min(c11, c12), min(c21, c22)) == max(max(c11, c12), max(c21, c22)));
}

// The sample at `f` past texel i, in linear light.
fn resolve(n: Near, f: vec2f) -> vec4f {
    // The gradient where the sample falls, by central differences at the four nearest texels.
    let g = (1.0 - f.x) * (1.0 - f.y) * vec2f(n.l12 - n.l10, n.l21 - n.l01)
        + f.x * (1.0 - f.y) * vec2f(n.l13 - n.l11, n.l22 - n.l02)
        + (1.0 - f.x) * f.y * vec2f(n.l22 - n.l20, n.l31 - n.l11)
        + f.x * f.y * vec2f(n.l23 - n.l21, n.l32 - n.l12);
    let len2 = dot(g, g);
    let across = select(vec2f(1.0, 0.0), g * inverseSqrt(len2), len2 > 1e-8);
    let edge = n.contrast * clamp(len2 * 8.0, 0.0, 1.0);
    // A tap at offset d weighs lanczos2(dot(d, a)² + dot(d, b)²): a across the edge, narrowed,
    // and b along it, widened.
    let a = across * (1.0 + 0.4 * edge);
    let b = vec2f(-across.y, across.x) * (1.0 - 0.3 * edge);
    let d01 = vec2f(0.0, -1.0) - f;
    let d02 = vec2f(1.0, -1.0) - f;
    let d10 = vec2f(-1.0, 0.0) - f;
    let d11 = vec2f(0.0, 0.0) - f;
    let d12 = vec2f(1.0, 0.0) - f;
    let d13 = vec2f(2.0, 0.0) - f;
    let d20 = vec2f(-1.0, 1.0) - f;
    let d21 = vec2f(0.0, 1.0) - f;
    let d22 = vec2f(1.0, 1.0) - f;
    let d23 = vec2f(2.0, 1.0) - f;
    let d31 = vec2f(0.0, 2.0) - f;
    let d32 = vec2f(1.0, 2.0) - f;
    let w01 = lanczos2(dot(d01, a) * dot(d01, a) + dot(d01, b) * dot(d01, b));
    let w02 = lanczos2(dot(d02, a) * dot(d02, a) + dot(d02, b) * dot(d02, b));
    let w10 = lanczos2(dot(d10, a) * dot(d10, a) + dot(d10, b) * dot(d10, b));
    let w11 = lanczos2(dot(d11, a) * dot(d11, a) + dot(d11, b) * dot(d11, b));
    let w12 = lanczos2(dot(d12, a) * dot(d12, a) + dot(d12, b) * dot(d12, b));
    let w13 = lanczos2(dot(d13, a) * dot(d13, a) + dot(d13, b) * dot(d13, b));
    let w20 = lanczos2(dot(d20, a) * dot(d20, a) + dot(d20, b) * dot(d20, b));
    let w21 = lanczos2(dot(d21, a) * dot(d21, a) + dot(d21, b) * dot(d21, b));
    let w22 = lanczos2(dot(d22, a) * dot(d22, a) + dot(d22, b) * dot(d22, b));
    let w23 = lanczos2(dot(d23, a) * dot(d23, a) + dot(d23, b) * dot(d23, b));
    let w31 = lanczos2(dot(d31, a) * dot(d31, a) + dot(d31, b) * dot(d31, b));
    let w32 = lanczos2(dot(d32, a) * dot(d32, a) + dot(d32, b) * dot(d32, b));
    let sum = w01 * n.c01
        + w02 * n.c02
        + w10 * n.c10
        + w11 * n.c11
        + w12 * n.c12
        + w13 * n.c13
        + w20 * n.c20
        + w21 * n.c21
        + w22 * n.c22
        + w23 * n.c23
        + w31 * n.c31
        + w32 * n.c32;
    let wsum = w01
        + w02
        + w10
        + w11
        + w12
        + w13
        + w20
        + w21
        + w22
        + w23
        + w31
        + w32;
    let sharp = clamp(sum / max(wsum, 1e-4), n.lo, n.hi);
    let soft = mix(mix(n.c11, n.c12, f.x), mix(n.c21, n.c22, f.x), f.y);
    return mix(soft, sharp, n.sharpness);
}

// Any internal size: a sample per pixel. The target is the upscaled frame's sRGB view: the write
// encodes.
@fragment
fn upscale(v: VOut) -> @location(0) vec4f {
    let dims = vec2i(textureDimensions(src));
    let t = v.uv * vec2f(dims) - 0.5;
    let i = vec2i(floor(t));
    let f = t - floor(t);
    let c11 = texel(i, dims);
    let c12 = texel(i + vec2i(1, 0), dims);
    let c21 = texel(i + vec2i(0, 1), dims);
    let c22 = texel(i + vec2i(1, 1), dims);
    if flat(c11, c12, c21, c22) {
        return c11;
    }
    return resolve(near(i, dims), f);
}

@group(1) @binding(0) var upscaled: texture_storage_2d<rgba8unorm, write>;

// Linear light to sRGB, which a storage write doesn't do.
fn encode(c: vec4f) -> vec4f {
    let curve = 1.055 * pow(c.rgb, vec3f(1.0 / 2.4)) - 0.055;
    return vec4f(select(curve, c.rgb * 12.92, c.rgb <= vec3f(0.0031308)), c.a);
}

fn put(p: vec2i, c: vec4f) {
    if all(p >= vec2i(0)) && all(p < vec2i(textureDimensions(upscaled))) {
        textureStore(upscaled, p, c);
    }
}

// Exactly half the size: pixels 2i + 1 and 2i + 2 fall 1/4 and 3/4 past texel i on each axis,
// so the four of them share one `near` and are written together, sRGB-encoded here.
@compute @workgroup_size(8, 8)
fn upscale_half(@builtin(global_invocation_id) id: vec3u) {
    let dims = vec2i(textureDimensions(src));
    let i = vec2i(id.xy) - 1;
    if any(i >= dims) {
        return;
    }
    let p = 2 * i + 1;
    let c11 = texel(i, dims);
    let c12 = texel(i + vec2i(1, 0), dims);
    let c21 = texel(i + vec2i(0, 1), dims);
    let c22 = texel(i + vec2i(1, 1), dims);
    if flat(c11, c12, c21, c22) {
        let c = encode(c11);
        put(p, c);
        put(p + vec2i(1, 0), c);
        put(p + vec2i(0, 1), c);
        put(p + vec2i(1, 1), c);
        return;
    }
    let n = near(i, dims);
    put(p, encode(resolve(n, vec2f(0.25, 0.25))));
    put(p + vec2i(1, 0), encode(resolve(n, vec2f(0.75, 0.25))));
    put(p + vec2i(0, 1), encode(resolve(n, vec2f(0.25, 0.75))));
    put(p + vec2i(1, 1), encode(resolve(n, vec2f(0.75, 0.75))));
}

@group(1) @binding(0) var<uniform> amount: vec4f;

// Contrast-adaptive: each pixel pushed away from its four neighbours by up to `amount`, less
// where the neighbourhood is already near black or full, and never past its range, so a flat area
// and a hard edge stay as they are.
@fragment
fn sharpen(v: VOut) -> @location(0) vec4f {
    let dims = vec2i(textureDimensions(src));
    let p = vec2i(v.pos.xy);
    let c = texel(p, dims);
    let n = texel(p + vec2i(0, -1), dims);
    let s = texel(p + vec2i(0, 1), dims);
    let w = texel(p + vec2i(-1, 0), dims);
    let e = texel(p + vec2i(1, 0), dims);
    let lo = min(c.rgb, min(min(n.rgb, s.rgb), min(w.rgb, e.rgb)));
    let hi = max(c.rgb, max(max(n.rgb, s.rgb), max(w.rgb, e.rgb)));
    if all(lo == hi) {
        return c;
    }
    let room = clamp(min(lo, vec3f(c.a) - hi) / max(hi, vec3f(1e-4)), vec3f(0.0), vec3f(1.0));
    let k = -0.2 * amount.x * sqrt(room);
    let sharp = (c.rgb + k * (n.rgb + s.rgb + w.rgb + e.rgb)) / (1.0 + 4.0 * k);
    return vec4f(clamp(sharp, lo, hi), c.a);
}
