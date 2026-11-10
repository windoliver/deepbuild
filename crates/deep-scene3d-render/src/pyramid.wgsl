// The depth pyramid (issue #1637; canvas primitives: Instance `instance@1`), built each frame from
// that frame's prepass of the camera's occluders. Depth is reversed (larger is nearer, 0 where
// nothing drew), so each texel keeps the farthest depth under it.

// The pyramid's first level: the farthest depth over each pixel's samples.
@group(0) @binding(0) var prepass_ms: texture_depth_multisampled_2d;
@group(0) @binding(1) var level_out: texture_storage_2d<r32float, write>;
@group(0) @binding(2) var level_in: texture_2d<f32>;
@group(0) @binding(3) var prepass_one: texture_depth_2d;

@compute @workgroup_size(8, 8)
fn pyramid_first_ms(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = textureDimensions(level_out);
    if id.x >= dims.x || id.y >= dims.y {
        return;
    }
    var m = 3.4e38;
    for (var s = 0u; s < textureNumSamples(prepass_ms); s++) {
        m = min(m, textureLoad(prepass_ms, vec2<u32>(id.xy), i32(s)));
    }
    textureStore(level_out, vec2<u32>(id.xy), vec4<f32>(m, 0.0, 0.0, 0.0));
}

@compute @workgroup_size(8, 8)
fn pyramid_first(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = textureDimensions(level_out);
    if id.x >= dims.x || id.y >= dims.y {
        return;
    }
    let m = textureLoad(prepass_one, vec2<u32>(id.xy), 0);
    textureStore(level_out, vec2<u32>(id.xy), vec4<f32>(m, 0.0, 0.0, 0.0));
}

// Each next level halves, rounding down as mips do: texel j holds the farthest of 2j and 2j + 1
// below it, and the last texel of a row or column also the one an odd size leaves over, so the
// texel min(x >> l, size - 1) always covers pixel x.
@compute @workgroup_size(8, 8)
fn pyramid_down(@builtin(global_invocation_id) id: vec3<u32>) {
    let dims = textureDimensions(level_out);
    if id.x >= dims.x || id.y >= dims.y {
        return;
    }
    let below = vec2<u32>(textureDimensions(level_in));
    let at = vec2<u32>(id.xy) * 2u;
    let end = select(min(at + 1u, below - 1u), below - 1u, vec2<u32>(id.xy) == dims - 1u);
    var m = 3.4e38;
    for (var y = at.y; y <= end.y; y++) {
        for (var x = at.x; x <= end.x; x++) {
            m = min(m, textureLoad(level_in, vec2<u32>(x, y), 0).r);
        }
    }
    textureStore(level_out, vec2<u32>(id.xy), vec4<f32>(m, 0.0, 0.0, 0.0));
}
