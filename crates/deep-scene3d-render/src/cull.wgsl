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
