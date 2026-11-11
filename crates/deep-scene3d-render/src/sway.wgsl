// #2016: Modifier: sway on the GPU. Each swaying solid keeps its mesh's rest vertices and weights
// on the device; at every frame this pass writes the vertices it draws from those and its
// per-instance params alone, so nothing is rebuilt and nothing is read from an earlier frame.
//
// A vertex moves along the wind, in the world, by amount × weight × lean, with weight in [0, 1]
// and lean = (1 − strength) × sin(2π hz t + phase) + strength × gust, in [−1, 1]: no vertex moves
// more than amount. gust is noise at the solid's place less the wind's velocity × t, seeded by the
// document, so a gust rolls downwind at the wind's speed: a cubic B-spline over values in [−1, 1]
// on a lattice `scale` m apart, whose length scale is about `scale` and whose slope along an axis
// is at most 1 ÷ scale, so neighbours d m apart differ in gust by at most d ÷ scale.

struct Params {
    // The solid's model, rows: its place is the w column.
    rows: array<vec4<f32>, 3>,
    // Its model's linear part inverted, rows: a world move in the mesh's own space.
    inverse: array<vec4<f32>, 3>,
    // xz: where the wind blows toward, a unit vector; y: its speed in m/s; w: the gusts' scale.
    wind: vec4<f32>,
    // x: amount in m; y: hz; z: the phase in radians; w: the gusts' strength.
    sway: vec4<f32>,
    // x: t in s.
    time: vec4<f32>,
    // x: the vertex count; y, z: the document's seed, low and high words.
    counts: vec4<u32>,
};

// Floats per vertex: position, normal, uv0, uv1 and the tangent (mesh.rs).
const FLOATS: u32 = 14u;
const TAU: f32 = 6.283185307179586;

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> rest: array<f32>;
@group(0) @binding(2) var<storage, read> weights: array<f32>;
@group(0) @binding(3) var<storage, read_write> moved: array<f32>;
// The gust at the solid's place, which a check reads back.
@group(0) @binding(4) var<storage, read_write> reading: array<f32>;

// A lattice point's value in [−1, 1].
fn lattice(x: i32, z: i32) -> f32 {
    var h = (bitcast<u32>(x) * 0x8da6b343u) ^ (bitcast<u32>(z) * 0xd8163841u);
    h = h ^ (params.counts.y * 0xcb1ab31fu) ^ (params.counts.z * 0x9e3779b9u);
    h = (h ^ (h >> 16u)) * 0x7feb352du;
    h = (h ^ (h >> 15u)) * 0x846ca68bu;
    h = h ^ (h >> 16u);
    return f32(h >> 8u) / 8388607.5 - 1.0;
}

// The cubic B-spline's four weights at f in [0, 1): non-negative and summing to 1.
fn spline(f: f32) -> vec4<f32> {
    let g = 1.0 - f;
    return vec4<f32>(
        g * g * g,
        3.0 * f * f * f - 6.0 * f * f + 4.0,
        -3.0 * f * f * f + 3.0 * f * f + 3.0 * f + 1.0,
        f * f * f,
    ) / 6.0;
}

// The noise at q (in lattice units): the 4 × 4 lattice values around it, weighted.
fn noise(q: vec2<f32>) -> f32 {
    let c = floor(q);
    let wx = spline(q.x - c.x);
    let wz = spline(q.y - c.y);
    let i = vec2<i32>(c) - vec2<i32>(1, 1);
    var sum = 0.0;
    for (var a = 0; a < 4; a++) {
        var row = 0.0;
        for (var b = 0; b < 4; b++) {
            row += wx[b] * lattice(i.x + b, i.y + a);
        }
        sum += wz[a] * row;
    }
    return sum;
}

// The gust and the lean at the solid's place at t.
fn lean() -> vec2<f32> {
    let place = vec2<f32>(params.rows[0].w, params.rows[2].w);
    let d = params.wind.xz;
    let t = params.time.x;
    let gust = noise((place - d * (params.wind.y * t)) / params.wind.w);
    let s = params.sway.w;
    let slow = sin(TAU * fract(params.sway.y * t) + params.sway.z);
    return vec2<f32>(gust, clamp((1.0 - s) * slow + s * gust, -1.0, 1.0));
}

// The solid's gust and lean, worked once per workgroup.
var<workgroup> shared_lean: vec2<f32>;

@compute @workgroup_size(64)
fn sway(@builtin(global_invocation_id) id: vec3<u32>, @builtin(local_invocation_index) local: u32) {
    if local == 0u {
        shared_lean = lean();
    }
    workgroupBarrier();
    let k = id.x;
    let l = shared_lean;
    if k == 0u {
        reading[0] = l.x;
    }
    if k >= params.counts.x {
        return;
    }
    let o = k * FLOATS;
    for (var j = 0u; j < FLOATS; j++) {
        moved[o + j] = rest[o + j];
    }
    let w = vec3<f32>(params.wind.x, 0.0, params.wind.z) * (params.sway.x * clamp(weights[k], 0.0, 1.0) * l.y);
    moved[o] += dot(params.inverse[0].xyz, w);
    moved[o + 1u] += dot(params.inverse[1].xyz, w);
    moved[o + 2u] += dot(params.inverse[2].xyz, w);
}
