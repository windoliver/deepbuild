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

// Project a ray point: pixel position, ray depth and the visible surface's depth. Missing depth
// is zero, including offscreen points. The march and its crossing refinement use the same test.
fn ray_depth(s: vec3<f32>) -> vec4<f32> {
    let c = ao.clip * vec4<f32>(s, 1.0);
    if c.w <= 1e-6 {
        return vec4<f32>(0.0);
    }
    let ndc = c.xy / c.w;
    let at = vec2<f32>((ndc.x * 0.5 + 0.5) * ao.size.x, (0.5 - ndc.y * 0.5) * ao.size.y);
    if at.x < 0.0 || at.y < 0.0 || at.x >= ao.size.x || at.y >= ao.size.y {
        return vec4<f32>(0.0);
    }
    return vec4<f32>(at, c.z / c.w, textureLoad(depth_t, vec2<i32>(at), 0));
}

// One direction contributes once, if a surface intersects it before the radius. March the whole
// segment, refine depth crossings, then verify the local plane's hit against the depth buffer.
// This keeps thin occluders thin, and catches their near-edge-on faces without a view-dependent
// depth thickness. A depth discontinuity alone is not an intersection.
fn blocked(p: vec3<f32>, n: vec3<f32>, dir: vec3<f32>, radius: f32) -> bool {
    let stride = radius / 16.0;
    let bias = radius * 0.005;
    let start = p + n * bias;
    for (var step = 1u; step <= 16u; step++) {
        var hi = f32(step) * stride;
        var lo = hi - stride;
        var sample = ray_depth(start + dir * hi);
        if sample.w <= 0.0 || sample.w <= sample.z {
            continue;
        }
        // A stride can pass over a face seen edge-on. Find its first depth crossing before
        // using a normal; the endpoint may already project onto a different face.
        for (var j = 0u; j < 5u; j++) {
            let mid = (lo + hi) * 0.5;
            let probe = ray_depth(start + dir * mid);
            if probe.w > 0.0 && probe.w > probe.z {
                hi = mid;
                sample = probe;
            } else {
                lo = mid;
            }
        }
        let q_px = vec2<i32>(sample.xy);
        let q = world_at(q_px, sample.w);
        if dot(q - p, n) <= bias {
            continue;
        }
        let nq = normalize(textureLoad(normal_t, q_px, 0).xyz);
        let slope = dot(dir, nq);
        if abs(slope) <= 1e-5 {
            continue;
        }
        let t = dot(q - start, nq) / slope;
        // A surface first seen after a pixel boundary can intersect an earlier part of the
        // ray. Accept either side: a visible exit face also proves the direction was blocked.
        if t <= 0.0 || t > radius {
            continue;
        }
        let hit = start + dir * t;
        let hc = ao.clip * vec4<f32>(hit, 1.0);
        if hc.w <= 1e-6 {
            continue;
        }
        let hn = hc.xy / hc.w;
        let ha = vec2<f32>((hn.x * 0.5 + 0.5) * ao.size.x, (0.5 - hn.y * 0.5) * ao.size.y);
        if ha.x < 0.0 || ha.y < 0.0 || ha.x >= ao.size.x || ha.y >= ao.size.y {
            continue;
        }
        let hp = vec2<i32>(ha);
        let hd = textureLoad(depth_t, hp, 0);
        if hd > 0.0 && abs(dot(world_at(hp, hd) - hit, nq)) <= bias {
            return true;
        }
    }
    return false;
}

fn visibility(p: vec3<f32>, n: vec3<f32>, px: vec2<i32>) -> f32 {
    // R2 offset by this pixel's Hilbert index, never by frame number or history.
    let jitter = fract(vec2<f32>(0.5) + f32(hilbert(vec2<u32>(px))) * vec2<f32>(0.7548776662, 0.5698402910));
    let tbn = basis(n);
    let count = ao.opts.x;
    var occluded = 0.0;
    for (var i = 0u; i < count; i++) {
        let a = fract(jitter.x + f32(i) * 0.7548776662);
        let b = fract(jitter.y + f32(i) * 0.5698402910);
        let phi = 6.2831853 * a;
        // Cosine-weighted directions: the average is irradiance visibility, not solid angle.
        let cos_t = sqrt(1.0 - b);
        let sin_t = sqrt(1.0 - cos_t * cos_t);
        let dir = tbn * vec3<f32>(sin_t * cos(phi), sin_t * sin(phi), cos_t);
        occluded += select(0.0, 1.0, blocked(p, n, dir, ao.size.z));
    }
    return clamp(1.0 - ao.size.w * occluded / f32(count), 0.0, 1.0);
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
    let v = visibility(p, n, px);
    return vec4<f32>(v, touch, v, 1.0);
}

// One edge-aware 5 × 5 binomial blur: neighbours on the same surface (near its tangent plane,
// with a similar normal) only. Weight nearby pixels more, so a one-sided kernel at a wall does
// not move the contact's reading out along the floor, especially at half resolution.
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
            let taps = array<f32, 5>(1.0, 4.0, 6.0, 4.0, 1.0);
            let w = taps[u32(x + 2)] * taps[u32(y + 2)];
            sum += textureLoad(raw_t, q_px, 0).r * w;
            weight += w;
        }
    }
    let v = select(1.0, sum / weight, weight > 0.0);
    return vec4<f32>(v, textureLoad(raw_t, px, 0).g, v, 1.0);
}
