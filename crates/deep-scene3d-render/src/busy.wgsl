// Issue #383: the planted slow_gpu_frame twin's pass, never in a shipped frame: a full-screen
// triangle whose fragments spin long enough to keep the GPU busy past 10 ms of its timestamped
// time at a window's size.

@vertex
fn busy_vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    let x = f32((vi << 1u) & 2u);
    let y = f32(vi & 2u);
    return vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

@fragment
fn busy_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    var x = p.x * 0.001 + p.y * 0.0007;
    for (var i = 0u; i < 4096u; i = i + 1u) {
        x = fract(sin(x * 12.9898 + f32(i)) * 43758.5453);
    }
    return vec4<f32>(x, x, x, 1.0);
}
