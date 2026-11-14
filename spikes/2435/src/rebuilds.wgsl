// Spike #2435, rebuilds: a sheet of triangles posed anew each frame, as a pre-skin writes positions
// for every pass, then one ray per pixel at 1080p, and 10,000 rays down for the update check.
enable wgpu_ray_query;

struct Pose {
    cols: u32,
    rows: u32,
    frame: u32,
    pad: u32,
}

@group(0) @binding(0) var<storage, read_write> verts: array<f32>;
@group(0) @binding(1) var<uniform> pose: Pose;

@compute @workgroup_size(64)
fn pose_main(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= (pose.cols + 1u) * (pose.rows + 1u)) {
        return;
    }
    let x = f32(i % (pose.cols + 1u)) / f32(pose.cols);
    let y = f32(i / (pose.cols + 1u)) / f32(pose.rows);
    let ph = f32(pose.frame) * 0.05;
    verts[3u * i] = x;
    verts[3u * i + 1u] = y;
    verts[3u * i + 2u] = 0.1 * sin(12.0 * x + ph) * cos(9.0 * y - 0.7 * ph);
}

@group(0) @binding(2) var acc: acceleration_structure;
@group(0) @binding(3) var<storage, read_write> depth: array<f32>;

const WIDTH: u32 = 1920u;
const HEIGHT: u32 = 1080u;

@compute @workgroup_size(8, 8)
fn trace_main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= WIDTH || id.y >= HEIGHT) {
        return;
    }
    let uv = (vec2<f32>(id.xy) + 0.5) / vec2<f32>(f32(WIDTH), f32(HEIGHT)) - 0.5;
    let d = normalize(vec3<f32>(uv.x * 1.2 * f32(WIDTH) / f32(HEIGHT), uv.y * 1.2, -1.0));
    var rq: ray_query;
    rayQueryInitialize(&rq, acc, RayDesc(RAY_FLAG_FORCE_OPAQUE, 0xFFu, 0.0, 10.0, vec3<f32>(0.5, 0.5, 1.5), d));
    while (rayQueryProceed(&rq)) {}
    let h = rayQueryGetCommittedIntersection(&rq);
    depth[id.y * WIDTH + id.x] = select(-1.0, h.t, h.kind != 0u);
}

@group(0) @binding(4) var<storage, read> points: array<vec2<f32>>;
@group(0) @binding(5) var<storage, read_write> hits: array<vec2<u32>>;

@compute @workgroup_size(64)
fn probe_main(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = id.x;
    if (i >= arrayLength(&points)) {
        return;
    }
    var rq: ray_query;
    rayQueryInitialize(&rq, acc, RayDesc(RAY_FLAG_FORCE_OPAQUE, 0xFFu, 0.0, 10.0, vec3<f32>(points[i], 1.0), vec3<f32>(0.0, 0.0, -1.0)));
    while (rayQueryProceed(&rq)) {}
    let h = rayQueryGetCommittedIntersection(&rq);
    hits[i] = select(vec2<u32>(0xFFFFFFFFu, 0xFFFFFFFFu), vec2<u32>(bitcast<u32>(h.t), h.primitive_index), h.kind != 0u);
}
