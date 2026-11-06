// Issue #418: ambient occlusion (Look `look@1`: ao). The prepass's depth and normals (scene3d.wgsl's
// `ao_normal_fs`, opaque solids only) give each pixel's visibility over a hemisphere of `radius`
// metres, sampled in a fixed Hilbert R2 pattern, then one edge-aware blur; nothing reads an
// earlier frame. The mesh shader scales only its ambient term by the result.

struct Ao {
    // World to clip and back, column-major (reversed Z).
    clip: mat4x4<f32>,
    inv: mat4x4<f32>,
    // The AO targets' width and height, the radius in metres and the strength.
    size: vec4<f32>,
    // Samples, multi-bounce, specular, and 1 with ao on.
    opts: vec4<u32>,
    // AO px per px of the frame's targets.
    scale: vec4<f32>,
    // Toward the key light and the contact shadow's length in m; its samples in steps.x (#446).
    contact: vec4<f32>,
    steps: vec4<u32>,
};

@group(0) @binding(0) var depth_t: texture_depth_2d;
@group(0) @binding(1) var normal_t: texture_2d<f32>;
@group(0) @binding(2) var<uniform> ao: Ao;
@group(0) @binding(3) var raw_t: texture_2d<f32>;

@vertex
fn ao_vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    let x = f32((vi << 1u) & 2u);
    let y = f32(vi & 2u);
    return vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

fn world_at(p: vec2<i32>, d: f32) -> vec3<f32> {
    let ndc = vec2<f32>(
        (f32(p.x) + 0.5) / ao.size.x * 2.0 - 1.0,
        1.0 - (f32(p.y) + 0.5) / ao.size.y * 2.0,
    );
    let w = ao.inv * vec4<f32>(ndc, d, 1.0);
    return w.xyz / w.w;
}

// The pixel's index along a Hilbert curve over a 64 × 64 tile.
fn hilbert(p: vec2<u32>) -> u32 {
    let n = 64u;
    var x = p.x % n;
    var y = p.y % n;
    var d = 0u;
    var s = n / 2u;
    loop {
        if s == 0u {
            break;
        }
        let rx = select(0u, 1u, (x & s) > 0u);
        let ry = select(0u, 1u, (y & s) > 0u);
        d += s * s * ((3u * rx) ^ ry);
        if ry == 0u {
            if rx == 1u {
                x = n - 1u - x;
                y = n - 1u - y;
            }
            let t = x;
            x = y;
            y = t;
        }
        s = s / 2u;
    }
    return d;
}

fn basis(n: vec3<f32>) -> mat3x3<f32> {
    let a = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(n.y) > 0.9);
    let t = normalize(cross(a, n));
    let b = cross(n, t);
    return mat3x3<f32>(t, b, n);
}

// The key light's contact shadow (#446; Light policy: soft shadows): a fixed march over the
// prepass's depth toward the light for its short length. A surface blocks the ray only within two
// steps of it: further in front, the ray passes behind that surface as the camera sees it. A hit
// reads darker the nearer it is, so a contact shadow fades out along the march.
fn contact(p: vec3<f32>, n: vec3<f32>) -> f32 {
    let count = ao.steps.x;
    let span = ao.contact.w;
    let stride = span / f32(max(count, 1u));
    let start = p + n * stride * 0.5;
    for (var i = 0u; i < count; i++) {
        let s = start + ao.contact.xyz * stride * (f32(i) + 0.5);
        let c = ao.clip * vec4<f32>(s, 1.0);
        if c.w <= 1e-6 {
            return 1.0;
        }
        let ndc = c.xy / c.w;
        let at = vec2<f32>((ndc.x * 0.5 + 0.5) * ao.size.x, (0.5 - ndc.y * 0.5) * ao.size.y);
        if at.x < 0.0 || at.y < 0.0 || at.x >= ao.size.x || at.y >= ao.size.y {
            return 1.0;
        }
        let q_px = vec2<i32>(at);
        let dq = textureLoad(depth_t, q_px, 0);
        if dq > c.z / c.w {
            if distance(world_at(q_px, dq), s) < 2.0 * stride {
                return (f32(i) + 0.5) / f32(count);
            }
        }
    }
    return 1.0;
}

@fragment
fn ao_fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = vec2<i32>(pos.xy);
    let d = textureLoad(depth_t, px, 0);
    // Nothing drawn here: reversed Z clears depth to 0.
    if d <= 0.0 {
        return vec4<f32>(1.0);
    }
    let n = normalize(textureLoad(normal_t, px, 0).xyz);
    let p = world_at(px, d);
    let touch = select(1.0, contact(p, n), ao.steps.x > 0u);
    if ao.size.w <= 0.0 {
        return vec4<f32>(1.0, touch, 1.0, 1.0);
    }
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
    return vec4<f32>(v, touch, v, 1.0);
}

// One edge-aware 5 × 5 blur: neighbours on the same surface (near its tangent plane, with a
// similar normal) only.
@fragment
fn blur_fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let px = vec2<i32>(pos.xy);
    let d = textureLoad(depth_t, px, 0);
    if d <= 0.0 {
        return vec4<f32>(1.0);
    }
    let n = normalize(textureLoad(normal_t, px, 0).xyz);
    let p = world_at(px, d);
    let dims = vec2<i32>(textureDimensions(raw_t));
    let tol = 0.1 * ao.size.z;
    var sum = 0.0;
    var weight = 0.0;
    for (var y = -2; y <= 2; y++) {
        for (var x = -2; x <= 2; x++) {
            let q_px = px + vec2<i32>(x, y);
            if q_px.x < 0 || q_px.y < 0 || q_px.x >= dims.x || q_px.y >= dims.y {
                continue;
            }
            let dq = textureLoad(depth_t, q_px, 0);
            if dq <= 0.0 {
                continue;
            }
            let nq = normalize(textureLoad(normal_t, q_px, 0).xyz);
            let q = world_at(q_px, dq);
            if abs(dot(q - p, n)) > tol || dot(nq, n) < 0.9 {
                continue;
            }
            sum += textureLoad(raw_t, q_px, 0).r;
            weight += 1.0;
        }
    }
    let v = select(1.0, sum / weight, weight > 0.0);
    return vec4<f32>(v, textureLoad(raw_t, px, 0).g, v, 1.0);
}
