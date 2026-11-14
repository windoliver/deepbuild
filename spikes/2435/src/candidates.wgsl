// Spike #2435, candidates: rays straight down through a layer of alpha-masked triangles onto an
// opaque floor. An answer is the hit instance's custom data in the top byte (1 floor, 2 layer) and,
// for the layer, the primitive below it; 0 is the sky.
enable wgpu_ray_query;

struct Params {
    form: u32,  // 0 the candidate loop, 1 queries forced opaque that start again past a failed candidate
    plant: u32, // 1 ends a ray when a candidate fails its test
    count: u32,
    pad: u32,
}

@group(0) @binding(0) var acc: acceleration_structure;
@group(0) @binding(1) var<storage, read> points: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> answers: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

const FLOOR: u32 = 1u;
const LAYER: u32 = 2u;
const TRIANGLE: u32 = 1u;
const DOWN: vec3<f32> = vec3<f32>(0.0, 0.0, -1.0);

// The layer's alpha mask passes the half of each triangle nearer its second vertex than its third.
fn passes(b: vec2<f32>) -> bool {
    return b.x > b.y;
}

fn answer(kind: u32, custom: u32, prim: u32) -> u32 {
    if (kind == 0u) {
        return 0u;
    }
    if (custom == FLOOR) {
        return FLOOR << 24u;
    }
    return (custom << 24u) | prim;
}

fn candidate_loop(o: vec3<f32>) -> u32 {
    var rq: ray_query;
    rayQueryInitialize(&rq, acc, RayDesc(RAY_FLAG_NONE, 0xFFu, 0.0, 10.0, o, DOWN));
    while (rayQueryProceed(&rq)) {
        let c = rayQueryGetCandidateIntersection(&rq);
        if (c.kind == TRIANGLE) {
            if (passes(c.barycentrics)) {
                rayQueryConfirmIntersection(&rq);
            } else if (params.plant == 1u) {
                rayQueryTerminate(&rq);
            }
        }
    }
    let h = rayQueryGetCommittedIntersection(&rq);
    return answer(h.kind, h.instance_custom_data, h.primitive_index);
}

fn opaque_restart(o: vec3<f32>) -> u32 {
    var tmin = 0.0;
    // Declared once: Metal's intersection query can be reset but never assigned, as a declaration
    // inside the loop would be each time round.
    var rq: ray_query;
    for (var i = 0u; i < 16u; i = i + 1u) {
        rayQueryInitialize(&rq, acc, RayDesc(RAY_FLAG_FORCE_OPAQUE, 0xFFu, tmin, 10.0, o, DOWN));
        while (rayQueryProceed(&rq)) {}
        let h = rayQueryGetCommittedIntersection(&rq);
        if (h.kind == 0u) {
            return 0u;
        }
        if (h.instance_custom_data != LAYER || passes(h.barycentrics)) {
            return answer(h.kind, h.instance_custom_data, h.primitive_index);
        }
        if (params.plant == 1u) {
            return 0u;
        }
        tmin = h.t + max(h.t * 1e-5, 1e-6);
    }
    return 0u;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.count) {
        return;
    }
    let o = vec3<f32>(points[i], 2.0);
    if (params.form == 0u) {
        answers[i] = candidate_loop(o);
    } else {
        answers[i] = opaque_restart(o);
    }
}
