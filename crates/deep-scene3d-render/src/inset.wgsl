// ---- #506: projected insets (canvas primitives: Inset: projected), concatenated after
// scene3d.wgsl and before the unlit pass's own shader. `insets` holds word 0 the count (at most
// 8), then INSET_WORDS words an inset from word 4: its world-to-box matrix (16 f32, column-major),
// its flags, the word its texels start at, its width and height in texels, the word its `onto`
// pick list starts at and that list's length, the cast's direction (or its eye, under
// INSET_FROM_EYE) as 3 f32, its fade's widths in u and v, the cosine of its fade angle and its
// opacity. Texels are straight-alpha sRGB codes, one RGBA8 word each, row by row.

const INSET_WORDS: u32 = 32u;
const INSET_UNLIT: u32 = 1u;
const INSET_ALL: u32 = 2u;
const INSET_FROM_EYE: u32 = 4u;

fn inset_f(k: u32) -> f32 {
    return bitcast<f32>(insets[k]);
}

fn inset_lands(e: u32, pick: u32) -> bool {
    if (insets[e + 16u] & INSET_ALL) != 0u {
        return true;
    }
    let first = insets[e + 20u];
    for (var k = 0u; k < insets[e + 21u]; k = k + 1u) {
        if insets[first + k] == pick {
            return true;
        }
    }
    return false;
}

fn inset_texel(e: u32, x: i32, y: i32) -> vec4<f32> {
    let size = vec2<i32>(i32(insets[e + 18u]), i32(insets[e + 19u]));
    let at = clamp(vec2<i32>(x, y), vec2<i32>(0), size - vec2<i32>(1));
    return unpack4x8unorm(insets[insets[e + 17u] + u32(at.y * size.x + at.x)]);
}

// The texels at `uv` filtered bilinearly in their stored codes, so equal neighbours read back
// exactly; never mipmapped.
fn inset_sample(e: u32, uv: vec2<f32>) -> vec4<f32> {
    let size = vec2<f32>(f32(insets[e + 18u]), f32(insets[e + 19u]));
    let p = uv * size - vec2<f32>(0.5);
    let i = vec2<i32>(floor(p));
    let f = p - floor(p);
    let a = mix(inset_texel(e, i.x, i.y), inset_texel(e, i.x + 1, i.y), f.x);
    let b = mix(inset_texel(e, i.x, i.y + 1), inset_texel(e, i.x + 1, i.y + 1), f.x);
    return mix(a, b, f.y);
}

// Inset `k`'s color at world point `p` with normal `n` on solid `pick`: its stored codes and its
// weight, 0 outside its box or `onto`.
fn inset_at(k: u32, pick: u32, p: vec3<f32>, n: vec3<f32>) -> vec4<f32> {
    let e = 4u + k * INSET_WORDS;
    if !inset_lands(e, pick) {
        return vec4<f32>(0.0);
    }
    var m: mat4x4<f32>;
    for (var c = 0u; c < 4u; c = c + 1u) {
        m[c] = vec4<f32>(inset_f(e + c * 4u), inset_f(e + c * 4u + 1u), inset_f(e + c * 4u + 2u), inset_f(e + c * 4u + 3u));
    }
    let q = m * vec4<f32>(p, 1.0);
    if q.w <= 0.0 {
        return vec4<f32>(0.0);
    }
    let b = q.xyz / q.w;
    if any(b < vec3<f32>(0.0)) || any(b > vec3<f32>(1.0)) {
        return vec4<f32>(0.0);
    }
    var w = 1.0;
    let edge = vec2<f32>(inset_f(e + 25u), inset_f(e + 26u));
    if edge.x > 0.0 {
        w = min(w, saturate(min(b.x, 1.0 - b.x) / edge.x));
    }
    if edge.y > 0.0 {
        w = min(w, saturate(min(b.y, 1.0 - b.y) / edge.y));
    }
    let v = vec3<f32>(inset_f(e + 22u), inset_f(e + 23u), inset_f(e + 24u));
    let d = select(v, normalize(p - v), (insets[e + 16u] & INSET_FROM_EYE) != 0u);
    let turned = dot(normalize(n), -d);
    let ca = inset_f(e + 27u);
    if turned < ca {
        w = w * saturate(turned / max(ca, 1e-4));
    }
    let t = inset_sample(e, b.xy);
    return vec4<f32>(t.rgb, t.a * w * inset_f(e + 28u));
}
