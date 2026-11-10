// The core's cull (issue #484; canvas primitives: Instance `instance@1`): each element's bounds
// against a view's six clip planes, conservatively, one flag a row. `compact` then keeps the
// flagged rows in index order and writes their count, which the batch's indirect draw takes, so
// no count reaches the CPU. An instances output's batch tests only what its compact step kept.

struct Params {
    planes: array<vec4<f32>, 6>,
    // The prototype's bounds, in its own space.
    lo: vec4<f32>,
    hi: vec4<f32>,
    n: u32,
    // 1: the planted cull that tests each element's center alone.
    centers: u32,
    // 1: the planted compaction, which flags rows from the last to the first.
    reversed: u32,
    // 1: the planted draw that takes row r as element r.
    row_as_element: u32,
}

// The rows of a solid's record (the renderer's `SolidRecord`), whose first 48 B are its model.
struct Element {
    rows: array<vec4<f32>, 3>,
    rest: array<vec4<f32>, 6>,
}

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> elements: array<Element>;
@group(0) @binding(2) var<storage, read_write> flags: array<u32>;

// A record and a plane reach here rounded to f32 from f64, and the sum below rounds again. 32 ulps
// of the sum's largest terms covers them, so the kept set always holds the f64 test's.
const SLACK: f32 = 1.9073486e-6;

// An instances output's compact step: its kept elements and their count; each element's row in
// this batch, or NONE; each kept place's row, which `compact` then keeps where it's flagged.
@group(0) @binding(3) var<storage, read> kept: array<u32>;
@group(0) @binding(4) var<storage, read> kept_count: array<u32>;
@group(0) @binding(5) var<storage, read> row_of: array<u32>;
@group(0) @binding(6) var<storage, read_write> places: array<u32>;

const NONE: u32 = 0xffffffffu;

fn in_view(i: u32) -> u32 {
    let r = elements[i].rows;
    let c = (p.lo.xyz + p.hi.xyz) * 0.5;
    let h = (p.hi.xyz - p.lo.xyz) * 0.5;
    let at = vec3<f32>(dot(r[0].xyz, c) + r[0].w, dot(r[1].xyz, c) + r[1].w, dot(r[2].xyz, c) + r[2].w);
    let reach = vec3<f32>(dot(abs(r[0].xyz), h), dot(abs(r[1].xyz), h), dot(abs(r[2].xyz), h));
    let whole = vec3<f32>(
        dot(abs(r[0].xyz), abs(c)) + abs(r[0].w),
        dot(abs(r[1].xyz), abs(c)) + abs(r[1].w),
        dot(abs(r[2].xyz), abs(c)) + abs(r[2].w),
    ) + reach;
    var keep = 1u;
    for (var k = 0u; k < 6u; k++) {
        let q = p.planes[k];
        let a = abs(q.xyz);
        var d = dot(q.xyz, at) + q.w;
        if p.centers == 0u {
            d += dot(a, reach) + SLACK * (dot(a, whole) + abs(q.w));
        }
        if d < 0.0 {
            keep = 0u;
        }
    }
    return keep;
}

@compute @workgroup_size(256)
fn cull(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if i < p.n {
        flags[select(i, p.n - 1u - i, p.reversed != 0u)] = in_view(i);
    }
}

@compute @workgroup_size(256)
fn cull_kept(@builtin(global_invocation_id) id: vec3<u32>) {
    let r = id.x;
    if r >= p.n {
        return;
    }
    var keep = 0u;
    if r < kept_count[0] {
        let element = select(kept[r], r, p.row_as_element != 0u);
        if element < arrayLength(&row_of) && row_of[element] != NONE {
            places[r] = row_of[element];
            keep = in_view(row_of[element]);
        }
    }
    flags[r] = keep;
}

// Occlusion from this frame's depth (issue #1637; canvas primitives: Instance `instance@1`): the
// camera's frustum list, tested against a depth pyramid built from this frame's prepass of the
// occluders it kept. Depth is reversed (larger is nearer, 0 where nothing drew), so a pyramid texel
// holds the farthest depth under it, and a row is hidden only when its bounds' nearest corner lies
// behind the farthest occluder over every pixel its bounds can reach.

struct Occlusion {
    clip: mat4x4<f32>,
    // The frame's size in px; the pyramid's levels; 1: the planted test of centres alone.
    size: vec2<f32>,
    levels: u32,
    centre: u32,
}

@group(0) @binding(7) var<storage, read> list: array<u32>;
@group(0) @binding(8) var<storage, read> list_count: array<u32>;
@group(1) @binding(0) var<uniform> o: Occlusion;
@group(1) @binding(1) var pyramid: texture_2d<f32>;

// A corner's depth reaches here from f32 records through the same transform the vertex stage
// runs, but on its own path: 2^-12 of it covers the difference.
const DEPTH_SLACK: f32 = 2.4414062e-4;

fn shown(i: u32) -> u32 {
    let r = elements[i].rows;
    let place = mat4x4<f32>(
        vec4<f32>(r[0].x, r[1].x, r[2].x, 0.0),
        vec4<f32>(r[0].y, r[1].y, r[2].y, 0.0),
        vec4<f32>(r[0].z, r[1].z, r[2].z, 0.0),
        vec4<f32>(r[0].w, r[1].w, r[2].w, 1.0),
    );
    let to_clip = o.clip * place;
    let dims = vec2<i32>(textureDimensions(pyramid, 0));
    if o.centre != 0u {
        let q = to_clip * vec4<f32>((p.lo.xyz + p.hi.xyz) * 0.5, 1.0);
        if q.w <= 0.0 {
            return 1u;
        }
        let ndc = q.xyz / q.w;
        let px = vec2<i32>(vec2<f32>((ndc.x * 0.5 + 0.5), (0.5 - ndc.y * 0.5)) * o.size);
        let t = textureLoad(pyramid, clamp(px, vec2<i32>(0), dims - 1), 0).r;
        return select(1u, 0u, ndc.z < t);
    }
    var nearest = 0.0;
    var lo = vec2<f32>(3.4e38);
    var hi = vec2<f32>(-3.4e38);
    for (var k = 0u; k < 8u; k++) {
        let corner = select(p.lo.xyz, p.hi.xyz, vec3<bool>((k & 1u) != 0u, (k & 2u) != 0u, (k & 4u) != 0u));
        let q = to_clip * vec4<f32>(corner, 1.0);
        // A corner at or behind the eye's plane: its bounds can reach any pixel.
        if q.w <= 1e-6 {
            return 1u;
        }
        let ndc = q.xyz / q.w;
        nearest = max(nearest, ndc.z);
        let px = vec2<f32>((ndc.x * 0.5 + 0.5), (0.5 - ndc.y * 0.5)) * o.size;
        lo = min(lo, px);
        hi = max(hi, px);
    }
    // Every pixel the bounds can reach, one more each side for rounding.
    let a = clamp(vec2<i32>(floor(lo)) - 1, vec2<i32>(0), dims - 1);
    let b = clamp(vec2<i32>(floor(hi)) + 1, vec2<i32>(0), dims - 1);
    var level = 0u;
    while level + 1u < o.levels && any(((b >> vec2<u32>(level)) - (a >> vec2<u32>(level))) > vec2<i32>(3)) {
        level++;
    }
    let size = vec2<i32>(textureDimensions(pyramid, level));
    let a2 = min(a >> vec2<u32>(level), size - 1);
    let b2 = min(b >> vec2<u32>(level), size - 1);
    var farthest = 3.4e38;
    for (var y = a2.y; y <= b2.y; y++) {
        for (var x = a2.x; x <= b2.x; x++) {
            farthest = min(farthest, textureLoad(pyramid, vec2<i32>(x, y), i32(level)).r);
        }
    }
    return select(1u, 0u, nearest * (1.0 + DEPTH_SLACK) < farthest);
}

// Each row of the view's frustum list: flagged when it may show. `compact` keeps the flagged
// rows in their order.
@compute @workgroup_size(256)
fn occlude(@builtin(global_invocation_id) id: vec3<u32>) {
    let r = id.x;
    if r >= arrayLength(&flags) {
        return;
    }
    var keep = 0u;
    if r < list_count[0] {
        keep = shown(list[r]);
    }
    flags[r] = keep;
}
