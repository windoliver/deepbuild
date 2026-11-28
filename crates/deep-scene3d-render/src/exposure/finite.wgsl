
struct Params {
    size: vec2<u32>,
    last_writer: u32,
    rotate: u32,
};

@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var ids: texture_2d<u32>;
@group(0) @binding(2) var<uniform> p: Params;
@group(0) @binding(3) var<storage, read_write> found: array<atomic<u32>, 2>;

var<workgroup> part: atomic<u32>;
var<workgroup> least: atomic<u32>;

@compute @workgroup_size(16, 16)
fn count(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_index) li: u32,
) {
    if (li == 0u) {
        atomicStore(&part, 0u);
        atomicStore(&least, 0xffffffffu);
    }
    workgroupBarrier();
    if (all(gid.xy < p.size)) {
        let at = vec2<u32>((gid.x + p.rotate) % p.size.x, gid.y);
        let bits = bitcast<vec4<u32>>(textureLoad(image, vec2<i32>(at), 0));
        let exponent = vec4<u32>(0x7f800000u);
        if (any((bits & exponent) == exponent)) {
            atomicAdd(&part, 1u);
            let pick = textureLoad(ids, vec2<i32>(at), 0).x;
            if (p.last_writer == 1u) {
                atomicStore(&found[1], pick);
            } else {
                atomicMin(&least, pick);
            }
        }
    }
    workgroupBarrier();
    if (li == 0u) {
        let n = atomicLoad(&part);
        if (n != 0u) {
            atomicAdd(&found[0], n);
            if (p.last_writer != 1u) {
                atomicMin(&found[1], atomicLoad(&least));
            }
        }
    }
}
