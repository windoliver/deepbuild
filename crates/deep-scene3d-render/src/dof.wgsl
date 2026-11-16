// Effect: dof (#468): depth of field over the linear image, before bloom and the tone map.
//
// `prepare`: each pixel's signed circle of confusion (its diameter in px: negative nearer than the
// focus, positive past it, a tilt band's blur folded in by magnitude) and its view depth; a bright
// out-of-focus point keeps in the image only what its neighbours show, the light it stands out by
// leaving for the scatter. `tiles`: each 16 × 16 tile's largest circle, how far a gather there looks.
// `scatter`: each such point spreads its light over the aperture's shape (a disc, or a polygon of
// `blades` sides) normalized by the coverage the shape lays on the frame's pixels, so its energy
// holds; sums are fixed point, so they don't depend on the order points land in. `gather`: every
// pixel gathers `taps` samples on a golden-angle spiral rotated by a hash of the pixel; a sample
// counts where its own circle reaches the pixel, and a sample farther than the pixel never spreads
// past the pixel's own circle, so far never blurs over a sharper near pixel; the scatter's light is
// added under the same rule. Nothing reads an earlier frame.

struct Params {
    // w, h, 1 ÷ w, 1 ÷ h
    size: vec4<f32>,
    // near, far, 1 for an orthographic camera, the focus distance in m
    cam: vec4<f32>,
    // k (perspective: CoC px = k |d − s| ÷ d), ortho_coc (px per m), max_coc (px), taps
    coc: vec4<f32>,
    // the band: a point on its centre line, the line's unit normal
    band_at: vec4<f32>,
    // the band: width, feather, amount (px), 1 when there is a band
    band: vec4<f32>,
    // blades (0 round), the planted flags, the exposure scale, the tiles across
    bokeh: vec4<f32>,
};

@group(0) @binding(0) var<uniform> params: Params;

const PI: f32 = 3.14159265358979;
const GOLDEN: f32 = 2.39996322972865;
const TILE: i32 = 16;
// The scatter's fixed point: 1 ÷ 1024 of linear light.
const FIXED: f32 = 1024.0;
// Planted: a circle of confusion linear in |d − s|, matched at 10 m (#468 AC6's wrong program).
const LINEAR_COC: u32 = 1u;

fn view_depth(d: f32) -> f32 {
    if params.cam.z > 0.5 {
        // Orthographic, reversed: depth = (far − vz) ÷ (far − near).
        return params.cam.y - d * (params.cam.y - params.cam.x);
    }
    // Perspective, reversed with an infinite far plane: depth = near ÷ vz.
    if d <= 0.0 {
        return 1e30;
    }
    return params.cam.x / d;
}

fn band_blur(p: vec2<f32>) -> f32 {
    if params.band.w < 0.5 {
        return 0.0;
    }
    let off = abs(dot(p - params.band_at.xy, params.band_at.zw)) - params.band.x / 2.0;
    if off <= 0.0 {
        return 0.0;
    }
    var u = 1.0;
    if params.band.y > 0.0 {
        u = min(off / params.band.y, 1.0);
    }
    return params.band.z * u * u * (3.0 - 2.0 * u);
}

// The signed CoC diameter in px at view depth `z` and frame px `p`.
fn coc_at(z: f32, p: vec2<f32>) -> f32 {
    let s = params.cam.w;
    var lens = 0.0;
    if params.cam.z > 0.5 {
        lens = params.coc.y * (z - s);
    } else if z >= 1e29 {
        lens = params.coc.x;
    } else if (u32(params.bokeh.y) & LINEAR_COC) != 0u {
        // The planted twin: linear in |d − s|, equal to the physical CoC at 10 m.
        lens = params.coc.x * (z - s) / 10.0;
    } else {
        lens = params.coc.x * (z - s) / max(z, 1e-6);
    }
    let size = min(max(abs(lens), band_blur(p)), params.coc.z);
    return select(size, -size, lens < 0.0);
}

fn luminance(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

// The aperture's radius toward angle `a` for a shape of circumradius `r`.
fn shape_radius(r: f32, a: f32) -> f32 {
    let n = params.bokeh.x;
    if n < 2.5 {
        return r;
    }
    let sector = 2.0 * PI / n;
    let local = a - floor(a / sector) * sector - sector / 2.0;
    return r * cos(PI / n) / cos(local);
}

// How much of the pixel at offset `o` from a point's centre its shape of circumradius `r` covers: a
// one-pixel ramp across the shape's edge.
fn coverage(o: vec2<f32>, r: f32) -> f32 {
    let edge = shape_radius(r, atan2(o.y, o.x));
    return clamp(edge - length(o) + 0.5, 0.0, 1.0);
}

@group(0) @binding(1) var depth: texture_depth_2d;
@group(0) @binding(2) var linear: texture_2d<f32>;

// What the pixel at `p` stands out by over the darkest pixel on the ring 2 px about it, when it is a
// bright point out of focus (its circle at least 2 px across, its light past the display's white):
// the light the scatter spreads, so a light a few pixels across spreads whole. Zero for every
// other pixel.
fn excess(p: vec2<i32>, c: f32) -> vec3<f32> {
    if abs(c) < 2.0 {
        return vec3<f32>(0.0);
    }
    let size = vec2<i32>(params.size.xy);
    let color = textureLoad(linear, p, 0).rgb;
    let exposure = params.bokeh.z;
    if luminance(color) * exposure < 1.0 {
        return vec3<f32>(0.0);
    }
    var floor = color;
    for (var j = -2; j <= 2; j += 2) {
        for (var i = -2; i <= 2; i += 2) {
            if i == 0 && j == 0 {
                continue;
            }
            let q = clamp(p + vec2<i32>(i, j), vec2<i32>(0), size - 1);
            let c = textureLoad(linear, q, 0).rgb;
            floor = select(floor, c, luminance(c) < luminance(floor));
        }
    }
    let e = max(color - floor, vec3<f32>(0.0));
    return select(vec3<f32>(0.0), e, luminance(e) * exposure >= 0.5);
}

@group(0) @binding(3) var base_out: texture_storage_2d<rgba16float, write>;
@group(0) @binding(4) var coc_out: texture_storage_2d<rg32float, write>;

@compute @workgroup_size(8, 8)
fn prepare(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = vec2<u32>(params.size.xy);
    if id.x >= size.x || id.y >= size.y {
        return;
    }
    let p = vec2<i32>(id.xy);
    // The nearest depth about the pixel: an antialiased edge, whose colour is partly the nearer
    // surface's, keeps that surface's circle, so a sharp object's edge never bleeds into the
    // blur behind it.
    var z = 1e30;
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let q = clamp(p + vec2<i32>(i, j), vec2<i32>(0), vec2<i32>(size) - 1);
            z = min(z, view_depth(textureLoad(depth, q, 0)));
        }
    }
    let c = coc_at(z, vec2<f32>(id.xy) + 0.5);
    textureStore(coc_out, p, vec4<f32>(c, z, 0.0, 0.0));
    let color = textureLoad(linear, p, 0);
    textureStore(base_out, p, vec4<f32>(color.rgb - excess(p, c), color.a));
}

@group(0) @binding(5) var coc_in: texture_2d<f32>;
@group(0) @binding(6) var tiles_out: texture_storage_2d<r32float, write>;

var<workgroup> largest: array<f32, 256>;

@compute @workgroup_size(16, 16)
fn tiles(@builtin(workgroup_id) tile: vec3<u32>, @builtin(local_invocation_index) k: u32, @builtin(global_invocation_id) id: vec3<u32>) {
    let size = vec2<u32>(params.size.xy);
    var c = 0.0;
    if id.x < size.x && id.y < size.y {
        c = abs(textureLoad(coc_in, vec2<i32>(id.xy), 0).x);
    }
    largest[k] = c;
    workgroupBarrier();
    for (var step = 128u; step > 0u; step = step >> 1u) {
        if k < step {
            largest[k] = max(largest[k], largest[k + step]);
        }
        workgroupBarrier();
    }
    if k == 0u {
        textureStore(tiles_out, vec2<i32>(tile.xy), vec4<f32>(largest[0], 0.0, 0.0, 0.0));
    }
}

// Each pixel's scattered light, rgb, in fixed point.
@group(0) @binding(7) var<storage, read_write> scattered: array<atomic<u32>>;

@compute @workgroup_size(8, 8)
fn scatter(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = vec2<i32>(params.size.xy);
    let p = vec2<i32>(id.xy);
    if p.x >= size.x || p.y >= size.y {
        return;
    }
    let own = textureLoad(coc_in, p, 0).xy;
    let e = excess(p, own.x);
    if all(e == vec3<f32>(0.0)) {
        return;
    }
    let r = abs(own.x) / 2.0;
    let reach = i32(ceil(r + 1.0));
    // The coverage the shape lays on the frame's pixels, so the light it adds sums to the excess.
    var laid = 0.0;
    for (var j = -reach; j <= reach; j++) {
        for (var i = -reach; i <= reach; i++) {
            let q = p + vec2<i32>(i, j);
            if q.x >= 0 && q.y >= 0 && q.x < size.x && q.y < size.y {
                laid += coverage(vec2<f32>(f32(i), f32(j)), r);
            }
        }
    }
    let unit = e / max(laid, 1e-6) * FIXED;
    let w = u32(size.x);
    for (var j = -reach; j <= reach; j++) {
        for (var i = -reach; i <= reach; i++) {
            let q = p + vec2<i32>(i, j);
            if q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y {
                continue;
            }
            // A nearer pixel takes the point's light only as far as its own circle reaches.
            let there = textureLoad(coc_in, q, 0).xy;
            var rq = r;
            if there.y < own.y {
                rq = min(r, abs(there.x) / 2.0);
            }
            let cover = coverage(vec2<f32>(f32(i), f32(j)), rq);
            if cover <= 0.0 {
                continue;
            }
            let at = (u32(q.y) * w + u32(q.x)) * 3u;
            let add = vec3<u32>(round(unit * cover));
            atomicAdd(&scattered[at], add.x);
            atomicAdd(&scattered[at + 1u], add.y);
            atomicAdd(&scattered[at + 2u], add.z);
        }
    }
}

@group(0) @binding(8) var base_in: texture_2d<f32>;
@group(0) @binding(9) var tiles_in: texture_2d<f32>;
@group(0) @binding(10) var resolved: texture_storage_2d<rgba16float, write>;

fn hash(p: vec2<u32>) -> u32 {
    var h = (p.x * 0x8da6b343u) ^ (p.y * 0xd8163841u);
    h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
    h = (h ^ (h >> 12u)) * 0x297a2d39u;
    return h ^ (h >> 15u);
}

// One sample `o` px from pixel `p` (at view depth `z0`, its circle's radius `r0`) standing for
// `share` px of the frame: its light times its weight, and the weight, where its circle reaches the
// pixel: each pixel it stands for spreads over its circle's area. Far never spreads over a sharper
// near pixel: past the pixel, a sample's circle is limited to the pixel's own.
fn tap(p: vec2<i32>, o: vec2<f32>, z0: f32, r0: f32, share: f32) -> vec4<f32> {
    let size = vec2<i32>(params.size.xy);
    let q = clamp(p + vec2<i32>(round(o)), vec2<i32>(0), size - 1);
    let s = textureLoad(coc_in, q, 0).xy;
    var rq = abs(s.x) / 2.0;
    if s.y > z0 {
        rq = min(rq, r0);
    }
    // The sample's shape toward the pixel, from the sample's centre.
    let cover = clamp(shape_radius(rq, atan2(-o.y, -o.x)) - length(o) + 0.5, 0.0, 1.0);
    if cover <= 0.0 {
        return vec4<f32>(0.0);
    }
    let w = share * cover / max(PI * rq * rq, 1.0);
    return vec4<f32>(textureLoad(base_in, q, 0).rgb * w, w);
}

@compute @workgroup_size(8, 8)
fn gather(@builtin(global_invocation_id) id: vec3<u32>) {
    let size = vec2<i32>(params.size.xy);
    let p = vec2<i32>(id.xy);
    if p.x >= size.x || p.y >= size.y {
        return;
    }
    let own = textureLoad(coc_in, p, 0).xy;
    let r0 = abs(own.x) / 2.0;
    let z0 = own.y;
    let centre = textureLoad(base_in, p, 0);
    let at = (u32(p.y) * u32(size.x) + u32(p.x)) * 3u;
    let spread = vec3<f32>(
        f32(atomicLoad(&scattered[at])),
        f32(atomicLoad(&scattered[at + 1u])),
        f32(atomicLoad(&scattered[at + 2u])),
    ) / FIXED;
    // How far to look: the largest circle in the 3 × 3 tiles about this one, no less than the
    // pixel's own and no more than max_coc.
    let tile = p / TILE;
    let across = vec2<i32>(i32(params.bokeh.w), (size.y + TILE - 1) / TILE);
    var largest = abs(own.x);
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let t = clamp(tile + vec2<i32>(i, j), vec2<i32>(0), across - 1);
            largest = max(largest, textureLoad(tiles_in, t, 0).x);
        }
    }
    let reach = min(largest, params.coc.z) / 2.0;
    if reach < 0.5 {
        textureStore(resolved, p, vec4<f32>(centre.rgb + spread, centre.a));
        return;
    }
    let w0 = 1.0 / max(PI * r0 * r0, 1.0);
    var sum = centre.rgb * w0;
    var weight = w0;
    // The eight neighbours first, so a circle of a pixel or two spreads alike at every pixel;
    // then the spiral, rotated by the pixel's hash.
    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            if i != 0 || j != 0 {
                let t = tap(p, vec2<f32>(f32(i), f32(j)), z0, r0, 1.0);
                sum += t.rgb;
                weight += t.a;
            }
        }
    }
    let n = u32(params.coc.w);
    let turn = f32(hash(id.xy)) * (2.0 * PI / 4294967296.0);
    // The spiral covers the ring from the neighbours out to `reach`, each tap an equal share of it.
    let inner = 1.5;
    let ring = max(reach * reach - inner * inner, 0.0);
    let share = PI * ring / f32(n);
    for (var k = 0u; k < n; k++) {
        let r = sqrt(inner * inner + ring * (f32(k) + 0.5) / f32(n));
        let a = f32(k) * GOLDEN + turn;
        let t = tap(p, vec2<f32>(cos(a), sin(a)) * r, z0, r0, share);
        sum += t.rgb;
        weight += t.a;
    }
    textureStore(resolved, p, vec4<f32>(sum / weight + spread, centre.a));
}
