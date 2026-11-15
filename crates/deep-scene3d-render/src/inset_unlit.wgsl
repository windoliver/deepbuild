// #506: the unlit projected insets, drawn after tone mapping and the grade into the display
// slot (sRGB-encoded values), on the pixels whose resolved depth and object ID belong to each
// inset's surfaces; inset.wgsl follows. Their stored codes land as they are, so a data layer
// shows its legend's colors whatever the light or the exposure.

struct Unlit {
    // Clip (with depth) to world, column-major.
    to_world: mat4x4<f32>,
    // The resolved targets' size over the slot's.
    scale: vec4<f32>,
};

@group(0) @binding(0) var<uniform> unlit: Unlit;
@group(0) @binding(1) var ids: texture_2d<u32>;
@group(0) @binding(2) var depth: texture_depth_2d;
@group(0) @binding(3) var<storage, read> insets: array<u32>;

@vertex
fn unlit_vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    let x = f32((vi << 1u) & 2u);
    let y = f32(vi & 2u);
    return vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

fn world_at(px: vec2<f32>, size: vec2<f32>, d: f32) -> vec3<f32> {
    let ndc = vec2<f32>(px.x / size.x * 2.0 - 1.0, 1.0 - px.y / size.y * 2.0);
    let w = unlit.to_world * vec4<f32>(ndc, d, 1.0);
    return w.xyz / w.w;
}

@fragment
fn unlit_fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let size = vec2<f32>(textureDimensions(ids));
    let at = vec2<i32>(pos.xy * unlit.scale.xy);
    let pick = textureLoad(ids, at, 0).x;
    if pick == 0u {
        discard;
    }
    let px = vec2<f32>(at) + vec2<f32>(0.5);
    let d = textureLoad(depth, at, 0);
    let p = world_at(px, size, d);
    // The surface's normal from its neighbours' depths, along the steeper-free side.
    let px1 = world_at(px + vec2<f32>(1.0, 0.0), size, textureLoad(depth, at + vec2<i32>(1, 0), 0));
    let px0 = world_at(px - vec2<f32>(1.0, 0.0), size, textureLoad(depth, at - vec2<i32>(1, 0), 0));
    let py1 = world_at(px + vec2<f32>(0.0, 1.0), size, textureLoad(depth, at + vec2<i32>(0, 1), 0));
    let py0 = world_at(px - vec2<f32>(0.0, 1.0), size, textureLoad(depth, at - vec2<i32>(0, 1), 0));
    let dx = select(px1 - p, p - px0, length(p - px0) < length(px1 - p));
    let dy = select(py1 - p, p - py0, length(p - py0) < length(py1 - p));
    var n = normalize(cross(dy, dx));
    var c = vec4<f32>(0.0);
    for (var k = 0u; k < insets[0]; k = k + 1u) {
        if (insets[4u + k * INSET_WORDS + 16u] & INSET_UNLIT) == 0u {
            continue;
        }
        // Face the cast: a normal from screen space has no side.
        let e = 4u + k * INSET_WORDS;
        let v = vec3<f32>(inset_f(e + 22u), inset_f(e + 23u), inset_f(e + 24u));
        let toward = select(-v, normalize(v - p), (insets[e + 16u] & INSET_FROM_EYE) != 0u);
        let s = inset_at(k, pick, p, select(-n, n, dot(n, toward) >= 0.0));
        // Premultiplied over, so a pixel an inset covers whole lands on its stored code.
        c = vec4<f32>(s.rgb * s.a + c.rgb * (1.0 - s.a), s.a + c.a * (1.0 - s.a));
    }
    if c.a <= 0.0 {
        discard;
    }
    return c;
}
