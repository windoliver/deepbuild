// #1634's planted pass (`cluster_arrival_order`), after fill.wgsl's lines above its own pass:
// one invocation per light appends it to every cell its range reaches, at the place an atomic
// counter hands it, so a cell's list is in the order its lights arrived, which no two runs share.
@compute @workgroup_size(64)
fn arrive(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= params.count.x {
        return;
    }
    let light = reach[id.x];
    let span = spans[id.x];
    let cap = params.count.y;
    for (var cell = 0u; cell < CELLS; cell++) {
        if !within(span, place(cell)) || !reaches(bounds(cell), light.at) {
            continue;
        }
        atomicAdd(&report[cell], 1u);
        let base = cell * (2u + 2u * cap);
        let k = atomicAdd(&lists[base], 1u);
        if k < cap {
            atomicStore(&lists[base + 2u + k], light.score.z);
            atomicStore(&lists[base + 2u + cap + k], bitcast<u32>(1.0));
        }
    }
}
