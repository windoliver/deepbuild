// The core's fill of a compute texture output (#483): every texel set to one value, the output's
// declared clear value at the start of each frame (or, under the test hook, the pool's marker).

struct Fill { v: vec4<f32> };
@group(0) @binding(0) var<uniform> fill: Fill;
@group(0) @binding(1) var tex: texture_storage_DIM<FORMAT, write>;

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
    let size = textureDimensions(tex);
    if (any(g.SWZ >= size)) {
        return;
    }
    textureStore(tex, g.SWZ, VALUE);
}
