// Spike #2435, build order: one ray down through the added mesh (invocation 0) and one through the
// first mesh (invocation 1). An answer is the hit instance's custom data (1 the first mesh, 2 the
// added one), or 0 for the sky.
enable wgpu_ray_query;

@group(0) @binding(0) var acc: acceleration_structure;
@group(0) @binding(1) var<storage, read_write> answers: array<u32>;

@compute @workgroup_size(2)
fn main(@builtin(local_invocation_index) i: u32) {
    let x = select(0.75, 0.25, i == 1u);
    var rq: ray_query;
    rayQueryInitialize(&rq, acc, RayDesc(RAY_FLAG_FORCE_OPAQUE, 0xFFu, 0.0, 10.0, vec3<f32>(x, 0.5, 1.0), vec3<f32>(0.0, 0.0, -1.0)));
    while (rayQueryProceed(&rq)) {}
    let h = rayQueryGetCommittedIntersection(&rq);
    answers[i] = select(0u, h.instance_custom_data, h.kind != 0u);
}
