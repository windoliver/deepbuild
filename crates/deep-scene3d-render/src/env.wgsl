// The environment's prefilter (#422; canvas primitives: Sky `sky@1`: environment): one face and
// one mip of the cube at a time, from an equirectangular radiance image with its own mips. Mip m
// holds the GGX lobe at roughness m ÷ (mips − 1) around each texel's direction (n = v = r),
// importance sampled with each sample's lookup level from its solid angle (filtered importance
// sampling), so a uniform environment stays exactly uniform at every roughness.

struct Params {
    // x: the face, y: the mip, z: the lookups' level bias (1 for lighting's cube, 0 for the
    // blurred background's, which holds the lobe itself to 1 code value), w: samples per texel.
    at: vec4<u32>,
    // x: the roughness, y: this mip's face size in px, z and w: the source's size in px.
    k: vec4<f32>,
};

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
@group(0) @binding(2) var<uniform> p: Params;

const PI: f32 = 3.14159265;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let x = f32(i32(i & 1u) * 4 - 1);
    let y = f32(i32(i >> 1u) * 4 - 1);
    return vec4<f32>(x, y, 0.0, 1.0);
}

// A cube face's direction at (u, v) in −1..1, v down, in the GPU's cube convention.
fn face_dir(face: u32, u: f32, v: f32) -> vec3<f32> {
    switch face {
        case 0u: { return normalize(vec3<f32>(1.0, -v, -u)); }
        case 1u: { return normalize(vec3<f32>(-1.0, -v, u)); }
        case 2u: { return normalize(vec3<f32>(u, 1.0, v)); }
        case 3u: { return normalize(vec3<f32>(u, -1.0, -v)); }
        case 4u: { return normalize(vec3<f32>(u, -v, 1.0)); }
        default: { return normalize(vec3<f32>(-u, -v, -1.0)); }
    }
}

// Where `d` falls on the equirectangular image: u from −Z turning toward +X, v from the zenith.
fn equirect(d: vec3<f32>) -> vec2<f32> {
    let u = atan2(d.x, -d.z) / (2.0 * PI) + 0.5;
    let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
    return vec2<f32>(u, v);
}

fn radiance(d: vec3<f32>, lod: f32) -> vec3<f32> {
    return textureSampleLevel(src, smp, equirect(d), lod).rgb;
}

fn hammersley(i: u32, n: u32) -> vec2<f32> {
    return vec2<f32>((f32(i) + 0.5) / f32(n), f32(reverseBits(i)) / 4294967296.0);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = p.k.y;
    let uv = pos.xy / size * 2.0 - 1.0;
    let n = face_dir(p.at.x, uv.x, uv.y);
    // One source texel's solid angle at the equator, the lookups' unit.
    let texel = 4.0 * PI / (p.k.z * p.k.w);
    let rough = p.k.x;
    if rough <= 0.0 {
        let cube = 4.0 * PI / (6.0 * size * size);
        return vec4<f32>(radiance(n, max(0.5 * log2(cube / texel), 0.0)), 1.0);
    }
    let a = rough * rough;
    let a2 = a * a;
    // A frame around n.
    let up = select(vec3<f32>(0.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), abs(n.y) > 0.999);
    let tx = normalize(cross(up, n));
    let ty = cross(n, tx);
    let count = p.at.w;
    var sum = vec3<f32>(0.0);
    var weight = 0.0;
    for (var i = 0u; i < count; i++) {
        let xi = hammersley(i, count);
        let phi = 2.0 * PI * xi.x;
        let cos_t = sqrt((1.0 - xi.y) / (1.0 + (a2 - 1.0) * xi.y));
        let sin_t = sqrt(1.0 - cos_t * cos_t);
        let h = tx * (sin_t * cos(phi)) + ty * (sin_t * sin(phi)) + n * cos_t;
        let l = 2.0 * dot(n, h) * h - n;
        let nl = dot(n, l);
        if nl > 0.0 {
            // With n = v, the sample's pdf over l is D(h) ÷ 4.
            let dd = cos_t * cos_t * (a2 - 1.0) + 1.0;
            let pdf = a2 / (PI * dd * dd) / 4.0;
            let omega = 1.0 / (f32(count) * pdf);
            let lod = max(0.5 * log2(omega / texel) + f32(p.at.z), 0.0);
            sum += radiance(l, lod) * nl;
            weight += nl;
        }
    }
    return vec4<f32>(sum / max(weight, 1e-6), 1.0);
}
