// The core's mip step for a compute texture's output (issue #483; canvas primitives: Operator
// output): each level a 2 × 2 box of the one above, in f32, stored in the output's format.

@group(0) @binding(0) var above: texture_2d<f32>;
@group(0) @binding(1) var below: texture_storage_2d<FORMAT, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
    let size = textureDimensions(below);
    if (g.x >= size.x || g.y >= size.y) {
        return;
    }
    let top = textureDimensions(above) - vec2<u32>(1u);
    let p = g.xy * 2u;
    let s = textureLoad(above, min(p, top), 0)
        + textureLoad(above, min(p + vec2<u32>(1u, 0u), top), 0)
        + textureLoad(above, min(p + vec2<u32>(0u, 1u), top), 0)
        + textureLoad(above, min(p + vec2<u32>(1u, 1u), top), 0);
    textureStore(below, g.xy, s * 0.25);
}
