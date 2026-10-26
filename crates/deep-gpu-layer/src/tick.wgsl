// The `tick` call's load (issue #379): a full-screen pass whose fragment loops `loops` times, so
// one submission takes about the GPU time the call asks for.

@group(0) @binding(0) var<uniform> loops: vec4u;

@vertex
fn full(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
    let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn spin(@builtin(position) p: vec4f) -> @location(0) vec4f {
    var x = fract(p.x * 0.001 + p.y * 0.002);
    for (var i = 0u; i < loops.x; i++) {
        x = fract(x * 3.7 + 0.1234);
    }
    return vec4f(x, x, x, 1.0);
}
