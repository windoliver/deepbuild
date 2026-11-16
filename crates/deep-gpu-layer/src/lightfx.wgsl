// #2031: a lit group's lit children, lit at each pixel (canvas primitives: Frame and group
// `frame@1`, `group@1`). deep-canvas-marks' light.rs is the CPU reference: a light's reach is
// (1 − (d ÷ range)²)² inside its range, and a pixel's color is decoded to linear light,
// multiplied by ambient plus the sum of energy × reach × color, clamped to 1 and encoded once.
// `src` holds the children drawn alone, premultiplied in the layer's space.

struct Light {
    // at.x, at.y and range in px, energy.
    at: vec4<f32>,
    // The color in linear light.
    color: vec4<f32>,
}

struct U {
    ambient: f32,
    count: u32,
    // 1: the layer composites in linear light; 2: a linear falloff; 4: a sum in encoded space.
    flags: u32,
    pad: u32,
    lights: array<Light, 16>,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var src: texture_2d<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn decode(v: vec3<f32>) -> vec3<f32> {
    return select(pow((v + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4)), v / 12.92, v <= vec3<f32>(0.04045));
}

fn encode(v: vec3<f32>) -> vec3<f32> {
    return select(1.055 * pow(v, vec3<f32>(1.0 / 2.4)) - 0.055, v * 12.92, v <= vec3<f32>(0.0031308));
}

fn space_out(v: vec3<f32>) -> vec3<f32> {
    let c = clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
    if ((u.flags & 1u) != 0u) {
        return c;
    }
    return encode(c);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let c = textureLoad(src, vec2<i32>(pos.xy), 0);
    if (c.a <= 0.0) {
        return c;
    }
    let rgb = min(c.rgb / c.a, vec3<f32>(1.0));
    var lin = rgb;
    if ((u.flags & 1u) == 0u) {
        lin = decode(rgb);
    }
    var sum = vec3<f32>(u.ambient);
    var apart = space_out(lin * u.ambient);
    for (var i = 0u; i < u.count; i = i + 1u) {
        let l = u.lights[i];
        let d = pos.xy - l.at.xy;
        var reach = 0.0;
        if (l.at.z > 0.0) {
            let q = dot(d, d) / (l.at.z * l.at.z);
            if (q < 1.0) {
                reach = (1.0 - q) * (1.0 - q);
                if ((u.flags & 2u) != 0u) {
                    reach = 1.0 - sqrt(q);
                }
            }
        }
        let term = l.at.w * reach * l.color.rgb;
        sum = sum + term;
        apart = apart + space_out(lin * term);
    }
    var out = space_out(lin * sum);
    if ((u.flags & 4u) != 0u) {
        out = clamp(apart, vec3<f32>(0.0), vec3<f32>(1.0));
    }
    return vec4<f32>(out * c.a, c.a);
}
