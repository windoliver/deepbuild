// Spike #2435, ties: rays up from a point on a diffuse floor toward a glowing panel and a masked
// decal on the same four vertices. An instance's custom data lists the layers it holds, first in its
// low byte: 1 the panel (opaque, emitting), 2 the decal (opaque where x >= 0, clear where x < 0),
// 3 the floor. An answer is the layer that answers, or 0 for the sky.
enable wgpu_ray_query;

struct Params {
    count: u32,
    pad: u32,
    origin: vec2<f32>,
}

@group(0) @binding(0) var acc: acceleration_structure;
@group(0) @binding(1) var<storage, read> dirs: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> answers: array<u32>;
@group(0) @binding(3) var<uniform> params: Params;

const PANEL: u32 = 1u;
const DECAL: u32 = 2u;
const FLOOR: u32 = 3u;
const TRIANGLE: u32 = 1u;

fn resolve(layers: u32, p: vec3<f32>) -> u32 {
    for (var k = 0u; k < 4u; k = k + 1u) {
        let layer = (layers >> (8u * k)) & 0xFFu;
        if (layer == PANEL || layer == FLOOR) {
            return layer;
        }
        if (layer == DECAL && p.x >= 0.0) {
            return DECAL;
        }
    }
    return 0u;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= params.count) {
        return;
    }
    let o = vec3<f32>(params.origin, 0.0);
    let d = dirs[i].xyz;
    var rq: ray_query;
    rayQueryInitialize(&rq, acc, RayDesc(RAY_FLAG_NONE, 0xFFu, 1e-4, 100.0, o, d));
    while (rayQueryProceed(&rq)) {
        let c = rayQueryGetCandidateIntersection(&rq);
        if (c.kind == TRIANGLE && resolve(c.instance_custom_data, o + c.t * d) != 0u) {
            rayQueryConfirmIntersection(&rq);
        }
    }
    let h = rayQueryGetCommittedIntersection(&rq);
    var a = 0u;
    if (h.kind != 0u) {
        a = resolve(h.instance_custom_data, o + h.t * d);
    }
    answers[i] = a;
}
