// Ambient occlusion (#418; ao.wgsl): its blurred result and settings, read only by the solids.
struct Ao {
    clip: mat4x4<f32>,
    inv: mat4x4<f32>,
    size: vec4<f32>,
    // Samples, multi-bounce, specular, and 1 with ao on.
    opts: vec4<u32>,
    scale: vec4<f32>,
    contact: vec4<f32>,
    steps: vec4<u32>,
};

@group(2) @binding(0) var ao_t: texture_2d<f32>;
@group(2) @binding(1) var<uniform> ao: Ao;
@group(2) @binding(2) var ao_depth: texture_depth_2d;

// The ambient term's visibility at this pixel, brightened by the surface's albedo with
// multi-bounce on (Jimenez's fit); 1 with ao off.
// The key light's contact shadow here (#446), 1 with none.
fn contact_at(pos: vec2<f32>) -> f32 {
    if ao.steps.x == 0u {
        return 1.0;
    }
    let dims = textureDimensions(ao_t);
    return textureLoad(ao_t, min(vec2<u32>(pos * ao.scale.xy), dims - vec2<u32>(1u)), 0).g;
}

// Reconstruct half-size visibility at the shaded point, not a neighbour's texel centre.
// Bilinear weights are admitted only on this surface: no floor/wall visibility bleed at a seam.
fn visibility_at(pos: vec2<f32>, p: vec3<f32>, n: vec3<f32>) -> f32 {
    let dims = vec2<i32>(textureDimensions(ao_t));
    if all(ao.scale.xy >= vec2<f32>(1.0)) {
        return textureLoad(ao_t, min(vec2<i32>(pos), dims - vec2<i32>(1)), 0).r;
    }
    let centre = pos * ao.scale.xy - vec2<f32>(0.5);
    let base = vec2<i32>(floor(centre));
    let f = fract(centre);
    var sum = 0.0;
    var weight = 0.0;
    for (var y = 0; y < 2; y++) {
        for (var x = 0; x < 2; x++) {
            let at = clamp(base + vec2<i32>(x, y), vec2<i32>(0), dims - vec2<i32>(1));
            let d = textureLoad(ao_depth, at, 0);
            if d <= 0.0 {
                continue;
            }
            let uv = (vec2<f32>(at) + vec2<f32>(0.5)) / ao.size.xy;
            let qh = ao.inv * vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, d, 1.0);
            if abs(dot(qh.xyz / qh.w - p, n)) > ao.size.z * 0.01 {
                continue;
            }
            let w = select(1.0 - f.x, f.x, x == 1) * select(1.0 - f.y, f.y, y == 1);
            sum += textureLoad(ao_t, at, 0).r * w;
            weight += w;
        }
    }
    if weight > 1e-6 {
        return sum / weight;
    }
    // A curved or subpixel receiver may have no matching half-size surface. Preserve the
    // nearest measured visibility rather than inventing a fully open hemisphere.
    return textureLoad(ao_t, clamp(vec2<i32>(pos * ao.scale.xy), vec2<i32>(0), dims - vec2<i32>(1)), 0).r;
}

fn occlusion(pos: vec2<f32>, p: vec3<f32>, n: vec3<f32>, albedo: vec3<f32>) -> vec3<f32> {
    if ao.opts.w == 0u {
        return vec3<f32>(1.0);
    }
    let v = visibility_at(pos, p, n);
    if ao.opts.y == 0u {
        return vec3<f32>(v);
    }
    let a = 2.0404 * albedo - 0.3324;
    let b = -4.7951 * albedo + 0.6417;
    let c = 2.7552 * albedo + 0.6903;
    return min(max(vec3<f32>(v), ((v * a + b) * v + c) * v), vec3<f32>(1.0));
}
