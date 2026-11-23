// Issue #971 (Look `look@1`: tone mapping, `local`): the local tone map, in linear light after
// the exposure and before the tone curve. Log2 luminance about middle grey splits into a base and
// a detail. The base is an edge-aware smoothing on a pyramid: the first level's cells hold the
// two levels of their four 2 × 2 blocks of pixels, those under the middle of their range and the
// rest, each with its share of the cell, and each coarser level's those of the 2 × 2 cells
// below, down to the coarsest. A grid then holds, for each coarsest cell and each step up the
// stops, what that cell's levels weigh for a pixel at those stops: a level counts where it holds
// about half its cell, weighed by how far it lies from them. Each pixel reads the grid across
// the cells about it and up its own stops, which is the joint bilateral upsample. The base is
// compressed toward middle grey and the detail scaled; color keeps its ratios to luminance.
// Everything is a function of this frame.

struct Local {
    // The exposure's linear scale; 1 ÷ (2 sigma²), in stops; the strength and the detail.
    exposure: f32,
    range: f32,
    strength: f32,
    detail: f32,
    // The planted wrong upsample: 1 gives every tap a range weight of 1.
    blind: u32,
    // The side in px of the coarsest level's cells, and the stops between two of the grid's steps.
    cell: f32,
    apart: f32,
    _pad: u32,
};

@group(0) @binding(0) var<uniform> local: Local;
// The linear image the output pass would read, before the exposure.
@group(0) @binding(1) var source: texture_2d<f32>;
// A level's cells: the lower level's stops in r and the higher's in g, their shares in b and a.
@group(0) @binding(2) var fine: texture_2d<f32>;
@group(0) @binding(3) var coarse: texture_2d<f32>;
// The level a step of the pyramid writes.
@group(0) @binding(4) var into: texture_storage_2d<rgba16float, write>;
// Reads a 2 × 2 block of the image as its mean, and the grid between its cells and its steps.
@group(0) @binding(5) var between: sampler;
// The grid: across, the coarsest cells; up, stops from −REACH, `apart` a step. In g, what the
// cell's levels weigh for a pixel at those stops; in r, that times how far each lies above them.
@group(0) @binding(6) var weighed: texture_storage_3d<rgba16float, write>;
@group(0) @binding(7) var grid: texture_3d<f32>;

const MIDDLE_GREY: f32 = 0.18;
// How far from middle grey a pixel's stops reach, so black has a finite log (local_tone.rs's).
const REACH: f32 = 16.0;
// A level counts in full where it holds half its cell, and not at all under two fifths of it.
const FEW: f32 = 0.4;
const HALF: f32 = 0.5;
// What the plain blur of the cells about a pixel weighs, and what the pixel's own stops weigh,
// so a pixel no level is like is compressed by its own stops and a flat part stays flat.
const BLUR: f32 = 2e-3;
const OWN: f32 = 2e-2;

@vertex
fn local_vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    let x = f32((vi << 1u) & 2u);
    let y = f32(vi & 2u);
    return vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

// An exposed linear color's luminance in stops about middle grey.
fn stops(c: vec3<f32>) -> f32 {
    let l = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)) * local.exposure;
    return clamp(log2(max(l, 1e-30) / MIDDLE_GREY), -REACH, REACH);
}

// Up to eight weighted levels as two: those under the middle of their range, and the rest. A
// level with no share counts for nothing.
fn split(m0: vec4<f32>, q0: vec4<f32>, m1: vec4<f32>, q1: vec4<f32>) -> vec4<f32> {
    let far = vec4<f32>(REACH);
    let has0 = q0 > vec4<f32>(0.0);
    let has1 = q1 > vec4<f32>(0.0);
    let least = min(select(far, m0, has0), select(far, m1, has1));
    let most = max(select(-far, m0, has0), select(-far, m1, has1));
    let lo = min(min(least.x, least.y), min(least.z, least.w));
    let hi = max(max(most.x, most.y), max(most.z, most.w));
    let middle = vec4<f32>(0.5 * (lo + hi));
    let low0 = select(vec4<f32>(0.0), q0, m0 < middle);
    let low1 = select(vec4<f32>(0.0), q1, m1 < middle);
    let high0 = q0 - low0;
    let high1 = q1 - low1;
    let ones = vec4<f32>(1.0);
    let share = vec2<f32>(dot(low0, ones) + dot(low1, ones), dot(high0, ones) + dot(high1, ones));
    let sum = vec2<f32>(dot(low0, m0) + dot(low1, m1), dot(high0, m0) + dot(high1, m1));
    let high = sum.y / share.y;
    let low = select(high, sum.x / share.x, share.x > 0.0);
    return vec4<f32>(low, high, share / (share.x + share.y));
}

// The 2 × 2 block of the image about `at`, in px: its mean's stops and a share of 1, or nothing
// off the image.
fn block(at: vec2<f32>) -> vec2<f32> {
    let dims = vec2<f32>(textureDimensions(source));
    if any(at > dims) {
        return vec2<f32>(0.0);
    }
    return vec2<f32>(stops(textureSampleLevel(source, between, at / dims, 0.0).rgb), 1.0);
}

// The first level: each cell from the four 2 × 2 blocks of the 4 × 4 pixels under it.
@compute @workgroup_size(8, 8)
fn first(@builtin(global_invocation_id) id: vec3<u32>) {
    if any(id.xy >= textureDimensions(into)) {
        return;
    }
    let corner = vec2<f32>(id.xy) * 4.0;
    let a = block(corner + vec2<f32>(1.0, 1.0));
    let b = block(corner + vec2<f32>(3.0, 1.0));
    let c = block(corner + vec2<f32>(1.0, 3.0));
    let d = block(corner + vec2<f32>(3.0, 3.0));
    let stopped = vec4<f32>(a.x, b.x, c.x, d.x);
    let shares = vec4<f32>(a.y, b.y, c.y, d.y);
    textureStore(into, id.xy, split(stopped, shares, vec4<f32>(0.0), vec4<f32>(0.0)));
}

// A cell of the level below, or nothing off it.
fn under(at: vec2<u32>) -> vec4<f32> {
    if any(at >= textureDimensions(fine)) {
        return vec4<f32>(0.0);
    }
    return textureLoad(fine, at, 0);
}

// One level coarser: each cell from the levels of the 2 × 2 cells under it.
@compute @workgroup_size(8, 8)
fn reduce(@builtin(global_invocation_id) id: vec3<u32>) {
    if any(id.xy >= textureDimensions(into)) {
        return;
    }
    let corner = id.xy * 2u;
    let a = under(corner);
    let b = under(corner + vec2<u32>(1u, 0u));
    let c = under(corner + vec2<u32>(0u, 1u));
    let d = under(corner + vec2<u32>(1u, 1u));
    let lows = vec4<f32>(a.r, b.r, c.r, d.r);
    let highs = vec4<f32>(a.g, b.g, c.g, d.g);
    textureStore(into, id.xy, split(lows, vec4<f32>(a.b, b.b, c.b, d.b), highs, vec4<f32>(a.a, b.a, c.a, d.a)));
}

// The grid: for a coarsest cell and a step up the stops, what the cell's levels weigh for a
// pixel at those stops, each by whether it counts in its cell and by its distance from them,
// with the cell's plain mean at its small weight; and that times how far each lies above them.
@compute @workgroup_size(4, 4, 4)
fn weigh(@builtin(global_invocation_id) id: vec3<u32>) {
    if any(id >= textureDimensions(weighed)) {
        return;
    }
    let cell = textureLoad(coarse, id.xy, 0);
    let v = f32(id.z) * local.apart - REACH;
    let d = vec2<f32>(v) - cell.rg;
    let alike = select(exp(-d * d * local.range), vec2<f32>(1.0), local.blind == 1u);
    let w = smoothstep(vec2<f32>(FEW), vec2<f32>(HALF), cell.ba) * alike;
    let above = dot(w, cell.rg - vec2<f32>(v)) + BLUR * (dot(cell.rg, cell.ba) - v);
    textureStore(weighed, id, vec4<f32>(above, w.x + w.y + BLUR, 0.0, 0.0));
}

// The image with its base compressed toward middle grey and its detail scaled: each pixel's
// color times one gain, so its ratios to luminance hold.
@fragment
fn apply_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    let c = textureLoad(source, vec2<i32>(p.xy), 0);
    let v = stops(c.rgb);
    // The grid across the cells about the pixel and up its own stops: how far its base lies
    // above it, its own stops counted at their small weight.
    let at = vec3<f32>(p.xy / local.cell, (v + REACH) / local.apart + 0.5);
    let held = textureSampleLevel(grid, between, at / vec3<f32>(textureDimensions(grid)), 0.0);
    let lean = held.r / (held.g + OWN);
    // base × (1 − strength) + detail × (v − base), less v.
    let gain = exp2((1.0 - local.strength - local.detail) * lean - local.strength * v);
    return vec4<f32>(c.rgb * gain, c.a);
}
