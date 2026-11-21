// One composite of the GPU layer's group compositor (canvas primitives: Frame and group: blend
// modes; passes; backdrop): the source over a copy of what its writer layer drew before it, in the
// space the layer composites in, written back within the group's bounds.

struct Mix {
    mode: u32,
    // 1: `src` is an 8-bit picture of sRGB-encoded premultiplied pixels, to linear light first.
    // 2: the source replaces the backdrop inside `cover`'s alpha (a backdrop group).
    // 4: dancing: the hash takes the frame index.
    // 8: `src` holds straight colors.
    flags: u32,
    alpha: f32,
    seed: u32,
    frame: u32,
}

@group(0) @binding(0) var<uniform> m: Mix;
@group(0) @binding(1) var back: texture_2d<f32>;
@group(0) @binding(2) var src: texture_2d<f32>;
@group(0) @binding(3) var cover: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn decode(v: vec3<f32>) -> vec3<f32> {
    return select(pow((v + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4)), v / 12.92, v <= vec3<f32>(0.04045));
}

fn hash1(x: u32) -> u32 {
    let s = x * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}

@fragment
fn fs(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let ix = vec2<i32>(at.xy);
    let b = textureLoad(back, ix, 0);
    var s = textureLoad(src, ix, 0);
    if ((m.flags & 8u) != 0u) {
        s = vec4<f32>(s.rgb * s.a, s.a);
    }
    if ((m.flags & 1u) != 0u && s.a > 0.0) {
        s = vec4<f32>(decode(clamp(s.rgb / s.a, vec3<f32>(0.0), vec3<f32>(1.0))) * s.a, s.a);
    }
    // A matte: the source's coverage, its alpha or its luma in linear light or on encoded values.
    if ((m.flags & 16u) != 0u) {
        let c = textureLoad(cover, ix, 0);
        var coverage = c.a;
        if ((m.flags & 64u) == 0u && c.a > 0.0) {
            let u = clamp(c.rgb / c.a, vec3<f32>(0.0), vec3<f32>(1.0));
            let layer_linear = (m.flags & 256u) != 0u;
            let want_encoded = (m.flags & 32u) != 0u;
            var v = u;
            if (want_encoded && layer_linear) {
                v = encode(u);
            } else if (!want_encoded && !layer_linear) {
                v = decode(u);
            }
            coverage = dot(v, vec3<f32>(0.2126, 0.7152, 0.0722)) * c.a;
        } else if ((m.flags & 64u) == 0u) {
            coverage = 0.0;
        }
        if ((m.flags & 128u) != 0u) {
            coverage = 1.0 - coverage;
        }
        let t = s * coverage;
        return t + b * (1.0 - t.a);
    }
    if ((m.flags & 2u) != 0u) {
        return mix(b, s, textureLoad(cover, ix, 0).a * m.alpha);
    }
    if (m.mode == 28u) {
        return s;
    }
    // Dissolve keeps a pixel where its hash is under the group's opacity.
    if (m.mode == 27u) {
        var h = hash1(hash1(hash1(m.seed) ^ u32(ix.x)) ^ u32(ix.y));
        if ((m.flags & 4u) != 0u) {
            h = hash1(h ^ m.frame);
        }
        if (f32(hash1(h) >> 8u) * 5.9604644775390625e-8 >= m.alpha) {
            return b;
        }
        return s + b * (1.0 - s.a);
    }
    s *= m.alpha;
    if (m.mode == 16u) {
        return min(b + s, vec4<f32>(1.0));
    }
    if (s.a <= 0.0) {
        return b;
    }
    let ub = select(vec3<f32>(0.0), clamp(b.rgb / b.a, vec3<f32>(0.0), vec3<f32>(1.0)), b.a > 0.0);
    let us = clamp(s.rgb / s.a, vec3<f32>(0.0), vec3<f32>(1.0));
    let rgb = s.rgb * (1.0 - b.a) + b.rgb * (1.0 - s.a) + s.a * b.a * blend_mix(m.mode, ub, us);
    return vec4<f32>(rgb, s.a + b.a * (1.0 - s.a));
}

// The finished layer into its target: premultiplied, sRGB-encoded.
fn encode(v: vec3<f32>) -> vec3<f32> {
    return select(1.055 * pow(v, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055), v * 12.92, v <= vec3<f32>(0.0031308));
}

@fragment
fn resolve(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let s = textureLoad(src, vec2<i32>(at.xy), 0);
    if (s.a <= 0.0) {
        return s;
    }
    var c = clamp(s.rgb / s.a, vec3<f32>(0.0), vec3<f32>(1.0));
    if ((m.flags & 1u) != 0u) {
        c = encode(c);
    }
    if ((m.flags & 2u) != 0u) {
        return vec4<f32>(c, s.a);
    }
    return vec4<f32>(c * s.a, s.a);
}
