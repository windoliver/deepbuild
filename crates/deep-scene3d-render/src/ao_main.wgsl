// #2516 wrong program: the visibility loop from main at 1c4d1f0e2, unchanged.
// Only --planted ao_main_loop / ao_full_radius select it; the shared prepass and blur stay real.
fn visibility(p: vec3<f32>, n: vec3<f32>, px: vec2<i32>) -> f32 {
    let radius = ao.size.z;
    let bias = 0.02 * radius;
    // The R2 sequence offset by the pixel's Hilbert index: a fixed pattern, never a frame's.
    let jitter = fract(vec2<f32>(0.5) + f32(hilbert(vec2<u32>(px))) * vec2<f32>(0.7548776662, 0.5698402910));
    let tbn = basis(n);
    let count = ao.opts.x;
    var occluded = 0.0;
    for (var i = 0u; i < count; i++) {
        let a = fract(jitter.x + f32(i) * 0.7548776662);
        let b = fract(jitter.y + f32(i) * 0.5698402910);
        let phi = 6.2831853 * a;
        // Cosine-weighted, kept off the tangent plane.
        let cos_t = max(sqrt(1.0 - b), 0.15);
        let sin_t = sqrt(1.0 - cos_t * cos_t);
        let k = (f32(i) + 0.5) / f32(count);
        let len = radius * mix(0.15, 1.0, k * k);
        let s = p + n * bias + tbn * vec3<f32>(sin_t * cos(phi), sin_t * sin(phi), cos_t) * len;
        let c = ao.clip * vec4<f32>(s, 1.0);
        if c.w <= 1e-6 {
            continue;
        }
        let ndc = c.xy / c.w;
        let at = vec2<f32>((ndc.x * 0.5 + 0.5) * ao.size.x, (0.5 - ndc.y * 0.5) * ao.size.y);
        if at.x < 0.0 || at.y < 0.0 || at.x >= ao.size.x || at.y >= ao.size.y {
            continue;
        }
        let q_px = vec2<i32>(at);
        let dq = textureLoad(depth_t, q_px, 0);
        if dq <= 0.0 || dq <= c.z / c.w {
            continue;
        }
        // A surface in front of the sample occludes only when it rises above this one's tangent
        // plane, so a flat surface never darkens itself.
        let q = world_at(q_px, dq);
        if dot(q - p, n) <= bias {
            continue;
        }
        let dist = length(q - p);
        occluded += clamp((2.0 * radius - dist) / radius, 0.0, 1.0);
    }
    let v = clamp(1.0 - ao.size.w * occluded / f32(count), 0.0, 1.0);
    return v;
}
