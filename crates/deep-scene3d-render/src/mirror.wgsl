// #465: Material: mirror. The mirrored pass's picture laid over the mirror's parts in the linear
// target, before the effects, bloom and tone mapping: at each pixel whose object ID is one of the
// mirror's parts, the picture at (2 × centre x − x, y), blurred by `blur`, mixed over the part's
// own shading by `strength`.

struct Params {
    // x: 2 × the camera's centre x ÷ the frame's width; y: strength; z: the blur's radius in the
    // picture's texels; w: how many part IDs follow.
    flip: vec4<f32>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var picture: texture_2d<f32>;
@group(0) @binding(2) var filtered: sampler;
@group(0) @binding(3) var ids: texture_2d<u32>;
@group(0) @binding(4) var<storage, read> parts: array<u32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
}

fn is_part(id: u32) -> bool {
    let n = u32(params.flip.w);
    for (var k = 0u; k < n; k++) {
        if parts[k] == id {
            return true;
        }
    }
    return false;
}

@fragment
fn fs(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    let px = vec2<i32>(at.xy);
    if !is_part(textureLoad(ids, px, 0).r) {
        discard;
    }
    let size = vec2<f32>(textureDimensions(ids));
    let uv = vec2<f32>(params.flip.x - at.x / size.x, at.y / size.y);
    let texel = 1.0 / vec2<f32>(textureDimensions(picture));
    let r = params.flip.z;
    var sum = vec3<f32>(0.0);
    var weight = 0.0;
    // A 3 × 3 grid of filtered taps over the blur's radius, a single tap with none.
    let taps = select(0, 1, r > 0.0);
    for (var j = -taps; j <= taps; j++) {
        for (var i = -taps; i <= taps; i++) {
            let o = vec2<f32>(f32(i), f32(j)) * r * texel;
            sum += textureSampleLevel(picture, filtered, uv + o, 0.0).rgb;
            weight += 1.0;
        }
    }
    let s = params.flip.y;
    return vec4<f32>(sum / weight * s, s);
}
