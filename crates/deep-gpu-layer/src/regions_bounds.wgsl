// #463: where each look of a 3D frame's mix gets a share of the frame, read on the frame's own
// view depths by the composite's own `seen` and `covered`: per look index, the least and greatest
// px x and y of every pixel a region of that look covers, so the look's render can be drawn
// inside them alone.

@group(0) @binding(7) var<storage, read_write> bounds: array<atomic<u32>, 16>;

@compute @workgroup_size(8, 8)
fn cs_bounds(@builtin(global_invocation_id) id: vec3<u32>) {
    if f32(id.x) >= frame.size.x || f32(id.y) >= frame.size.y {
        return;
    }
    let pos = vec2<f32>(id.xy) + vec2<f32>(0.5);
    let hit = view_z(vec2<i32>(id.xy));
    for (var i = 0u; i < frame.counts.y; i = i + 1u) {
        let r = regions[i];
        let v = seen(r, pos.x, pos.y, hit);
        if !v.ok {
            continue;
        }
        if covered(r, v.sd, v.p, v.k, v.block_sd) > 0.0 {
            let j = r.tag.y * 4u;
            atomicMin(&bounds[j], id.x);
            atomicMin(&bounds[j + 1u], id.y);
            atomicMax(&bounds[j + 2u], id.x);
            atomicMax(&bounds[j + 3u], id.y);
        }
    }
}
