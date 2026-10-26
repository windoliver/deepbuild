// `test.burn` (issue #379, test-meter builds only): its fragment loops `loops` times per pixel.

@group(0) @binding(0) var<uniform> burn: vec4u;

@vertex
fn full(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn burn_fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
    var x = fract(sin(dot(p.xy, vec2f(12.9898, 78.233))) * 43758.5453);
    for (var i = 0u; i < burn.x; i++) {
        x = fract(x * 3.7 + 0.1234);
    }
    return vec4f(x * 0.02, x * 0.02, x * 0.02, 0.0);
}
