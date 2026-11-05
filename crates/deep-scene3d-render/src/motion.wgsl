// Motion blur by velocity (#419; canvas primitives: Motion blur: velocity). A velocity target from
// the evaluations at t − s/2 and t + s/2, never an earlier frame; then tile-max and neighbor-max
// velocities and a gather with fixed taps, offset by a pixel hash, into the linear target.

struct U {
    clip_t: mat4x4<f32>,
    clip_o: mat4x4<f32>,
    clip_c: mat4x4<f32>,
    // The view's forward axis and −forward·eye: a world point's view depth.
    fwd: vec4<f32>,
    // Width, height, taps, the travel cap in px.
    size: vec4<f32>,
    // Tile px, tiles across, tiles down.
    tile: vec4<u32>,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var vel: texture_2d<f32>;
@group(0) @binding(2) var tiles_out: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var tiles_in: texture_2d<f32>;
@group(0) @binding(4) var near_out: texture_storage_2d<rgba32float, write>;
@group(0) @binding(5) var near_in: texture_2d<f32>;
@group(0) @binding(6) var lin: texture_2d<f32>;
@group(0) @binding(7) var out: texture_storage_2d<rgba16float, write>;

struct In {
    @location(0) p_t: vec3<f32>,
    @location(1) p_o: vec3<f32>,
    @location(2) p_c: vec3<f32>,
    @location(3) t0: vec4<f32>,
    @location(4) t1: vec4<f32>,
    @location(5) t2: vec4<f32>,
    @location(6) o0: vec4<f32>,
    @location(7) o1: vec4<f32>,
    @location(8) o2: vec4<f32>,
    @location(9) c0: vec4<f32>,
    @location(10) c1: vec4<f32>,
    @location(11) c2: vec4<f32>,
}

struct Out {
    @builtin(position) pos: vec4<f32>,
    @location(0) o: vec4<f32>,
    @location(1) c: vec4<f32>,
    @location(2) z: f32,
}

fn place(r0: vec4<f32>, r1: vec4<f32>, r2: vec4<f32>, p: vec3<f32>) -> vec4<f32> {
    let q = vec4<f32>(p, 1.0);
    return vec4<f32>(dot(r0, q), dot(r1, q), dot(r2, q), 1.0);
}

@vertex
fn vs(i: In) -> Out {
    let wt = place(i.t0, i.t1, i.t2, i.p_t);
    var o: Out;
    o.pos = u.clip_t * wt;
    o.o = u.clip_o * place(i.o0, i.o1, i.o2, i.p_o);
    o.c = u.clip_c * place(i.c0, i.c1, i.c2, i.p_c);
    o.z = dot(u.fwd.xyz, wt.xyz) + u.fwd.w;
    return o;
}

fn to_px(c: vec4<f32>) -> vec2<f32> {
    let n = c.xy / c.w;
    return vec2<f32>((n.x * 0.5 + 0.5) * u.size.x, (0.5 - n.y * 0.5) * u.size.y);
}

// rg: the pixel's travel over the shutter in px, capped; b: its view depth; a: 1 where drawn.
@fragment
fn fs(i: Out) -> @location(0) vec4<f32> {
    var v = to_px(i.c) - to_px(i.o);
    let l = length(v);
    if (l > u.size.w) {
        v = v * (u.size.w / l);
    }
    return vec4<f32>(v, i.z, 1.0);
}

// Half the travel: the shutter is centred on the frame's time.
fn half_at(p: vec2<i32>) -> vec2<f32> {
    return textureLoad(vel, p, 0).xy * 0.5;
}

var<workgroup> lanes: array<vec2<f32>, 64>;

// One workgroup per tile: 64 lanes each take every 64th pixel of it, then fold to the longest.
@compute @workgroup_size(64)
fn tile(@builtin(workgroup_id) w: vec3<u32>, @builtin(local_invocation_index) l: u32) {
    let n = i32(u.tile.x);
    let size = vec2<i32>(u.size.xy);
    var best = vec2<f32>(0.0);
    for (var k = i32(l); k < n * n; k += 64) {
        let p = vec2<i32>(w.xy) * n + vec2<i32>(k % n, k / n);
        if (p.x < size.x && p.y < size.y) {
            let h = half_at(p);
            if (length(h) > length(best)) {
                best = h;
            }
        }
    }
    lanes[l] = best;
    workgroupBarrier();
    for (var stride = 32u; stride > 0u; stride = stride / 2u) {
        if (l < stride && length(lanes[l + stride]) > length(lanes[l])) {
            lanes[l] = lanes[l + stride];
        }
        workgroupBarrier();
    }
    if (l == 0u) {
        textureStore(tiles_out, vec2<i32>(w.xy), vec4<f32>(lanes[0], 0.0, 0.0));
    }
}

@compute @workgroup_size(1)
fn near(@builtin(global_invocation_id) g: vec3<u32>) {
    if (g.x >= u.tile.y || g.y >= u.tile.z) {
        return;
    }
    var best = vec2<f32>(0.0);
    for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
            let t = vec2<i32>(g.xy) + vec2<i32>(dx, dy);
            if (t.x < 0 || t.y < 0 || t.x >= i32(u.tile.y) || t.y >= i32(u.tile.z)) {
                continue;
            }
            let m = textureLoad(tiles_in, t, 0).xy;
            if (length(m) > length(best)) {
                best = m;
            }
        }
    }
    textureStore(near_out, vec2<i32>(g.xy), vec4<f32>(best, 0.0, 0.0));
}

// A fixed hash of a pixel in [−½, ½): the taps' offset, never the frame number.
fn hash(x: u32, y: u32) -> f32 {
    var h = (x * 0x8da6b343u) ^ (y * 0xd8163841u);
    h = h ^ (h >> 13u);
    h = h * 0x5bd1e995u;
    h = h ^ (h >> 15u);
    return f32(h) / 4294967296.0 - 0.5;
}

const MAX_TAPS: u32 = 64u;

// At each of `taps` shutter times the pixel shows the nearest surface that some candidate's
// motion, traced back from the pixel to the frame's time, lands on while moving as it does; where
// none does, what lies behind: the pixel itself if it stays, else the farthest still candidate.
// Candidates that move alike (within a hundredth of a pixel) trace the same way, so each distinct
// velocity is traced once.
@compute @workgroup_size(8, 8)
fn gather(@builtin(global_invocation_id) g: vec3<u32>) {
    let size = vec2<i32>(u.size.xy);
    let p = vec2<i32>(g.xy);
    if (p.x >= size.x || p.y >= size.y) {
        return;
    }
    let here = textureLoad(lin, p, 0);
    let vn = textureLoad(near_in, p / i32(u.tile.x), 0).xy;
    if (length(vn) < 0.5) {
        textureStore(out, p, here);
        return;
    }
    let taps = min(u32(u.size.z), MAX_TAPS);
    let j = hash(g.x, g.y);
    let vx = textureLoad(vel, p, 0);
    let stays = length(vx.xy) < 0.5;
    var speeds: array<vec2<f32>, 65>;
    var n = 1u;
    speeds[0] = vx.xy;
    // What lies behind: the farthest candidate that stays, else the farthest.
    var behind = p;
    var behind_z = select(1e9, vx.z, vx.w > 0.0);
    var still = stays;
    for (var k = 0u; k < taps; k++) {
        let s = -1.0 + 2.0 * (f32(k) + 0.5 + j) / f32(taps);
        let q = vec2<i32>(floor(vec2<f32>(p) + 0.5 + vn * s));
        if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y || all(q == p)) {
            continue;
        }
        let c = textureLoad(vel, q, 0);
        let z = select(1e9, c.z, c.w > 0.0);
        let st = length(c.xy) < 0.5;
        if ((st && !still) || (st == still && z > behind_z)) {
            behind = q;
            behind_z = z;
            still = st;
        }
        var seen = false;
        for (var m = 0u; m < n; m++) {
            if (distance(speeds[m], c.xy) < 0.01) {
                seen = true;
                break;
            }
        }
        if (!seen) {
            speeds[n] = c.xy;
            n++;
        }
    }
    var sum = vec3<f32>(0.0);
    for (var s = 0u; s < taps; s++) {
        let tau = (f32(s) + 0.5) / f32(taps) - 0.5;
        var best = vec2<i32>(-1);
        var best_z = 0.0;
        for (var m = 0u; m < n; m++) {
            let v = speeds[m];
            let at = floor(vec2<f32>(p) + 0.5 - v * tau);
            if (at.x < 0.0 || at.y < 0.0 || at.x >= u.size.x || at.y >= u.size.y) {
                continue;
            }
            let q = vec2<i32>(at);
            let found = textureLoad(vel, q, 0);
            let z = select(1e9, found.z, found.w > 0.0);
            if (length(found.xy - v) <= max(1.0, 0.25 * length(v)) && (best.x < 0 || z < best_z)) {
                best = q;
                best_z = z;
            }
        }
        var shown = best;
        if (best.x < 0) {
            shown = select(behind, p, stays);
        }
        sum += textureLoad(lin, shown, 0).rgb;
    }
    textureStore(out, p, vec4<f32>(sum / f32(taps), here.a));
}
