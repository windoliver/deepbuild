// ---- #506: the lit projected insets in the solids' shading, concatenated after scene3d.wgsl.
@group(1) @binding(21) var<storage, read> insets: array<u32>;

// The surface's base color (linear) with each lit inset over it in order: an exact no-op on a
// pixel no inset reaches.
fn projected(base: vec3<f32>, pick: u32, p: vec3<f32>, n: vec3<f32>) -> vec3<f32> {
    var c = base;
    for (var k = 0u; k < insets[0]; k = k + 1u) {
        if (insets[4u + k * INSET_WORDS + 16u] & INSET_UNLIT) != 0u {
            continue;
        }
        let s = inset_at(k, pick, p, n);
        if s.a > 0.0 {
            c = mix(c, srgb_decode(s.rgb), s.a);
        }
    }
    return c;
}
