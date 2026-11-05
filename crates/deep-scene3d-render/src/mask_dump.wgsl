// #425's mask report: at every pixel of a pass's target, which of an item's two bands keep it,
// by the same `band_keeps` its draws call (bit 0 the more detailed, bit 1 the less).
struct MaskDump {
    key: u32,
    code: u32,
    pad0: u32,
    pad1: u32,
};
@group(0) @binding(0) var<uniform> dump: MaskDump;

@vertex
fn dump_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

@fragment
fn dump_fs(@builtin(position) pos: vec4<f32>) -> @location(0) u32 {
    let px = vec2<u32>(pos.xy);
    let upper = band_keeps(px, dump.key, dump.code & ~128u);
    let lower = band_keeps(px, dump.key, dump.code | 128u);
    return select(0u, 1u, upper) | select(0u, 2u, lower);
}
