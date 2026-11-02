// Issue #378: scene3d's output pass: exposure, the tone map and the sRGB encode, from the linear
// target into the slot. It's the one pass that writes the final frame.

struct Tone {
    exposure: f32,
    map: u32,
    white: f32,
    contrast: f32,
    // 0 encodes once; the planted outputs: 1 encodes twice, 2 not at all.
    encode: u32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
};

@group(0) @binding(0) var linear_target: texture_2d<f32>;
@group(0) @binding(1) var<uniform> tone: Tone;

@vertex
fn out_vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    let x = f32((vi << 1u) & 2u);
    let y = f32(vi & 2u);
    return vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

fn srgb_encode(x: vec3<f32>) -> vec3<f32> {
    let v = clamp(x, vec3<f32>(0.0), vec3<f32>(1.0));
    let lo = v * 12.92;
    let hi = 1.055 * pow(v, vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(hi, lo, v <= vec3<f32>(0.0031308));
}

fn filmic(x: vec3<f32>) -> vec3<f32> {
    let v = max(x, vec3<f32>(0.0));
    return clamp((v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
}

fn agx_curve(x: f32) -> f32 {
    let c = tone.contrast;
    let white = tone.white;
    if !(x > 0.0) {
        return 0.0;
    }
    let a = (1.0 / 0.18 - 1.0) * pow(0.18, c);
    if x <= 0.18 {
        let xc = pow(x, c);
        return xc / (xc + a);
    }
    if x >= white {
        return 1.0;
    }
    let s = pow(0.18, c) + a;
    let k = c * pow(0.18, c - 1.0) * a / (s * s);
    let w = k * (white - 0.18) * (white - 0.18) / 0.82;
    let d = x - 0.18;
    return 0.18 + k * d * (1.0 + d / w) / (1.0 + k * d / 0.82);
}

fn agx(x: vec3<f32>) -> vec3<f32> {
    let inset = mat3x3<f32>(
        0.856627153315983, 0.137318972929847, 0.11189821299995,
        0.0951212405381588, 0.761241990602591, 0.0767994186031903,
        0.0482516061458583, 0.101439036467562, 0.811302368396859,
    );
    let outset = mat3x3<f32>(
        1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
        -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
        -0.016493938717834573, -0.016493938717834257, 1.2519364065950405,
    );
    let v = inset * max(x, vec3<f32>(0.0));
    let curved = vec3<f32>(agx_curve(v.r), agx_curve(v.g), agx_curve(v.b));
    return clamp(outset * curved, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn neutral(x: vec3<f32>) -> vec3<f32> {
    let start = 0.8 - 0.04;
    let desat = 0.15;
    let m = min(x.r, min(x.g, x.b));
    let offset = select(0.04, m - 6.25 * m * m, m < 0.08);
    var c = x - offset;
    let peak = max(c.r, max(c.g, c.b));
    if peak < start {
        return clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    }
    let d = 1.0 - start;
    let new_peak = 1.0 - d * d / (peak + d - start);
    c = c * (new_peak / peak);
    let g = 1.0 - 1.0 / (desat * (peak - new_peak) + 1.0);
    return clamp(mix(c, vec3<f32>(new_peak), g), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn out_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(finish(textureLoad(linear_target, vec2<i32>(p.xy), 0).rgb), 1.0);
}

// A linear value through the exposure, the tone map and the sRGB encode.
fn finish(value: vec3<f32>) -> vec3<f32> {
    let linear = value * tone.exposure;
    var mapped = clamp(linear, vec3<f32>(0.0), vec3<f32>(1.0));
    if tone.map == 1u {
        mapped = filmic(linear);
    } else if tone.map == 2u {
        mapped = agx(linear);
    } else if tone.map == 3u {
        mapped = neutral(linear);
    }
    var encoded = srgb_encode(mapped);
    if tone.encode == 1u {
        encoded = srgb_encode(encoded);
    } else if tone.encode == 2u {
        encoded = mapped;
    }
    return encoded;
}
