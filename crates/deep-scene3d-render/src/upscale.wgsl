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
    if r2 >= 4.0 {
        return 0.0;
    }
    let b = 0.4 * r2 - 1.0;
    let c = 0.25 * r2 - 1.0;
    return (25.0 / 16.0 * b * b - 9.0 / 16.0) * c * c;
}

// Edge-adaptive, in linear light (where the frame's coverage was blended; `src` is the frame's
// sRGB view, so a load decodes): a Lanczos-2 over the 12 texels around the sample (a 4 × 4 block less its corners), turned to
// the local edge, narrowed across it and widened along it by how strong the edge is, and held to
// the range of the four nearest texels so it never rings. Where the edge isn't one straight line
// (small glyphs, corners), by the coherence of the texels' gradients, it eases to a bilinear
// blend of the four nearest. Written out tap by tap: arrays indexed in loops spill on some GPUs.

// One cell's gradient between four texels' lumas, as the structure tensor's terms.
fn cell(a: f32, b: f32, c: f32, d: f32) -> vec3f {
    let e = vec2f(b - a + d - c, c - a + d - b) * 0.5;
    return vec3f(e.x * e.x, e.x * e.y, e.y * e.y);
}

// A tap's weight at offset `d` from the sample, in the edge's frame.
fn weight(d: vec2f, across: vec2f, squeeze: f32, stretch: f32) -> f32 {
    let u = dot(d, across) * squeeze;
    let s = (d.y * across.x - d.x * across.y) * stretch;
    return lanczos2(u * u + s * s);
}

@fragment
fn upscale(v: VOut) -> @location(0) vec4f {
    let dims = vec2i(textureDimensions(src));
    let t = v.uv * vec2f(dims) - 0.5;
    let i = vec2i(floor(t));
    let f = t - floor(t);
    let c01 = texel(i + vec2i(0, -1), dims);
    let c02 = texel(i + vec2i(1, -1), dims);
    let c10 = texel(i + vec2i(-1, 0), dims);
    let c11 = texel(i + vec2i(0, 0), dims);
    let c12 = texel(i + vec2i(1, 0), dims);
    let c13 = texel(i + vec2i(2, 0), dims);
    let c20 = texel(i + vec2i(-1, 1), dims);
    let c21 = texel(i + vec2i(0, 1), dims);
    let c22 = texel(i + vec2i(1, 1), dims);
    let c23 = texel(i + vec2i(2, 1), dims);
    let c31 = texel(i + vec2i(0, 2), dims);
    let c32 = texel(i + vec2i(1, 2), dims);
    let l01 = luma(c01);
    let l02 = luma(c02);
    let l10 = luma(c10);
    let l11 = luma(c11);
    let l12 = luma(c12);
    let l13 = luma(c13);
    let l20 = luma(c20);
    let l21 = luma(c21);
    let l22 = luma(c22);
    let l23 = luma(c23);
    let l31 = luma(c31);
    let l32 = luma(c32);
    // The gradient where the sample falls, by central differences at the four nearest texels.
    let g = (1.0 - f.x) * (1.0 - f.y) * vec2f(l12 - l10, l21 - l01)
        + f.x * (1.0 - f.y) * vec2f(l13 - l11, l22 - l02)
        + (1.0 - f.x) * f.y * vec2f(l22 - l20, l31 - l11)
        + f.x * f.y * vec2f(l23 - l21, l32 - l12);
    // The structure tensor over the five cells between them that hold no corner, and its
    // coherence: 1 along one straight edge, 0 where gradients turn every way.
    let jt = cell(l01, l02, l11, l12)
        + cell(l10, l11, l20, l21)
        + cell(l11, l12, l21, l22)
        + cell(l12, l13, l22, l23)
        + cell(l21, l22, l31, l32);
    let trace = jt.x + jt.z;
    let spread = sqrt((jt.x - jt.z) * (jt.x - jt.z) + 4.0 * jt.y * jt.y);
    let coherence = select(0.0, (spread / trace) * (spread / trace), trace > 1e-8);
    let len2 = dot(g, g);
    var across = vec2f(1.0, 0.0);
    if len2 > 1e-8 {
        across = g * inverseSqrt(len2);
    }
    let lo4 = min(min(l11, l12), min(l21, l22));
    let hi4 = max(max(l11, l12), max(l21, l22));
    let edge = clamp((hi4 - lo4) * 2.0, 0.0, 1.0) * clamp(len2 * 8.0, 0.0, 1.0);
    let squeeze = 1.0 + 0.4 * edge;
    let stretch = 1.0 - 0.3 * edge;
    let w01 = weight(vec2f(0.0, -1.0) - f, across, squeeze, stretch);
    let w02 = weight(vec2f(1.0, -1.0) - f, across, squeeze, stretch);
    let w10 = weight(vec2f(-1.0, 0.0) - f, across, squeeze, stretch);
    let w11 = weight(vec2f(0.0, 0.0) - f, across, squeeze, stretch);
    let w12 = weight(vec2f(1.0, 0.0) - f, across, squeeze, stretch);
    let w13 = weight(vec2f(2.0, 0.0) - f, across, squeeze, stretch);
    let w20 = weight(vec2f(-1.0, 1.0) - f, across, squeeze, stretch);
    let w21 = weight(vec2f(0.0, 1.0) - f, across, squeeze, stretch);
    let w22 = weight(vec2f(1.0, 1.0) - f, across, squeeze, stretch);
    let w23 = weight(vec2f(2.0, 1.0) - f, across, squeeze, stretch);
    let w31 = weight(vec2f(0.0, 2.0) - f, across, squeeze, stretch);
    let w32 = weight(vec2f(1.0, 2.0) - f, across, squeeze, stretch);
    let sum = w01 * c01
        + w02 * c02
        + w10 * c10
        + w11 * c11
        + w12 * c12
        + w13 * c13
        + w20 * c20
        + w21 * c21
        + w22 * c22
        + w23 * c23
        + w31 * c31
        + w32 * c32;
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
    let lo = min(min(c11, c12), min(c21, c22));
    let hi = max(max(c11, c12), max(c21, c22));
    let sharp = clamp(sum / max(wsum, 1e-4), lo, hi);
    let soft = mix(mix(c11, c12, f.x), mix(c21, c22, f.x), f.y);
    // The target is the upscaled frame's sRGB view: the write encodes.
    return mix(soft, sharp, smoothstep(0.2, 0.7, coherence));
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
    let room = clamp(min(lo, vec3f(c.a) - hi) / max(hi, vec3f(1e-4)), vec3f(0.0), vec3f(1.0));
    let k = -0.2 * amount.x * sqrt(room);
    let sharp = (c.rgb + k * (n.rgb + s.rgb + w.rgb + e.rgb)) / (1.0 + 4.0 * k);
    return vec4f(clamp(sharp, lo, hi), c.a);
}
