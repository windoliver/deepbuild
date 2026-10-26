// A live view's own passes (issue #379): below internal scale 1, the upscale's two passes (an
// edge-adaptive upscale to full size, then a sharpen of 0.2); frame history's resolve over its
// window; and the additive composite of an effect target into the linear target.

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

// Bilinear, with each tap pulled toward the nearer texel where the four disagree most, so an edge
// stays an edge.
@fragment
fn upscale(v: VOut) -> @location(0) vec4f {
    let dims = vec2f(textureDimensions(src));
    let t = v.uv * dims - 0.5;
    let f = fract(t);
    let base = (floor(t) + 0.5) / dims;
    let d = 1.0 / dims;
    let a = textureSampleLevel(src, smp, base, 0.0);
    let b = textureSampleLevel(src, smp, base + vec2f(d.x, 0.0), 0.0);
    let c = textureSampleLevel(src, smp, base + vec2f(0.0, d.y), 0.0);
    let e = textureSampleLevel(src, smp, base + d, 0.0);
    let spread = max(length(a - e), length(b - c));
    let k = clamp(spread * 2.0, 0.0, 1.0);
    let w = mix(f, round(f), k * 0.5);
    return mix(mix(a, b, w.x), mix(c, e, w.x), w.y);
}

@fragment
fn sharpen(v: VOut) -> @location(0) vec4f {
    let dims = vec2i(textureDimensions(src));
    let p = vec2i(v.pos.xy);
    let c = textureLoad(src, p, 0);
    let n = textureLoad(src, clamp(p + vec2i(0, -1), vec2i(0), dims - 1), 0);
    let s = textureLoad(src, clamp(p + vec2i(0, 1), vec2i(0), dims - 1), 0);
    let w = textureLoad(src, clamp(p + vec2i(-1, 0), vec2i(0), dims - 1), 0);
    let e = textureLoad(src, clamp(p + vec2i(1, 0), vec2i(0), dims - 1), 0);
    let sharp = c.rgb + 0.2 * (4.0 * c.rgb - n.rgb - s.rgb - w.rgb - e.rgb);
    return vec4f(clamp(sharp, vec3f(0.0), vec3f(c.a)), c.a);
}

@group(0) @binding(0) var history: texture_2d_array<f32>;
@group(0) @binding(1) var<uniform> filled: vec4u;

// The window's frames, averaged.
@fragment
fn resolve(v: VOut) -> @location(0) vec4f {
    let p = vec2i(v.pos.xy);
    var sum = vec4f(0.0);
    for (var i = 0u; i < filled.x; i++) {
        sum += textureLoad(history, p, i, 0);
    }
    return sum / f32(max(filled.x, 1u));
}

@fragment
fn composite(v: VOut) -> @location(0) vec4f {
    return textureSampleLevel(src, smp, v.uv, 0.0);
}
