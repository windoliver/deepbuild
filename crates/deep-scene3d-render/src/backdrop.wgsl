// Issue #503: a 360° video behind the scene (canvas primitives: Sky `sky@1`: environment), drawn
// in the sky's place, first in the geometry pass, at the far plane, writing no depth and no object
// ID. Each pixel's centre ray, turned back by the environment's rotation about +Y as its lookups
// are (scene3d.wgsl's `env_dir`), falls on the equirectangular frame as an HDR environment's does
// (env.wgsl's `equirect`: u from −Z turning toward +X, v from the zenith). The four texels around
// it load in linear light (the frame is an sRGB texture) and mix bilinearly in f32, u wrapping and
// v clamped, times the environment's intensity.

struct Backdrop {
    // Clip to world, for each pixel's view ray.
    inv: mat4x4<f32>,
    // The eye, w 1 for perspective.
    eye: vec4<f32>,
    // The view's forward direction, every ray of an orthographic view; w the far plane's depth.
    forward: vec4<f32>,
    // The target's width and height in px, the intensity, and the rotation in rad.
    k: vec4<f32>,
};

@group(3) @binding(0) var<uniform> b: Backdrop;
@group(3) @binding(1) var frame: texture_2d<f32>;

const PI: f32 = 3.14159265358979;

struct Targets {
    @location(0) color: vec4<f32>,
    @location(1) id: vec2<u32>,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let x = f32(i32(i & 1u) * 4 - 1);
    let y = f32(i32(i >> 1u) * 4 - 1);
    return vec4<f32>(x, y, b.forward.w, 1.0);
}

// The view ray through pixel `px` of this target.
fn ray(px: vec2<f32>) -> vec3<f32> {
    if b.eye.w < 0.5 {
        return normalize(b.forward.xyz);
    }
    let ndc = vec2<f32>(px.x / b.k.x * 2.0 - 1.0, 1.0 - px.y / b.k.y * 2.0);
    let p = b.inv * vec4<f32>(ndc, 0.5, 1.0);
    return normalize(p.xyz / p.w - b.eye.xyz);
}

// Texel (x, y) in linear light: x wraps around the sphere and y clamps at the poles.
fn texel(x: i32, y: i32, size: vec2<i32>) -> vec3<f32> {
    let u = ((x % size.x) + size.x) % size.x;
    return textureLoad(frame, vec2<i32>(u, clamp(y, 0, size.y - 1)), 0).rgb;
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> Targets {
    let d = ray(pos.xy);
    let c = cos(b.k.w);
    let s = sin(b.k.w);
    let e = vec3<f32>(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
    let uv = vec2<f32>(atan2(e.x, -e.z) / (2.0 * PI) + 0.5, acos(clamp(e.y, -1.0, 1.0)) / PI);
    let size = vec2<i32>(textureDimensions(frame));
    let at = uv * vec2<f32>(size) - 0.5;
    let i = vec2<i32>(floor(at));
    let f = at - floor(at);
    let top = mix(texel(i.x, i.y, size), texel(i.x + 1, i.y, size), f.x);
    let low = mix(texel(i.x, i.y + 1, size), texel(i.x + 1, i.y + 1, size), f.x);
    return Targets(vec4<f32>(mix(top, low, f.y) * b.k.z, 1.0), vec2<u32>(0u, 0u));
}
