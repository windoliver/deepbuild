// Issue #378: scene3d's output pass: exposure, the tone map and the sRGB encode, from the linear
// target into the slot. It's the one pass that writes the final frame. Issue #418: the finish in
// it, each effect an identity at its default: the white balance before the curve, the ASC CDL and
// saturation after it, and the deband dither after the encode, just before the target quantizes.

struct Tone {
    exposure: f32,
    map: u32,
    white: f32,
    contrast: f32,
    // 0 encodes once; the planted outputs: 1 encodes twice, 2 not at all.
    encode: u32,
    // The deband's amplitude in 8-bit steps, 0 with it off.
    deband: f32,
    saturation: f32,
    // 1 applies the grade (white balance and CDL); 0 skips it, the identity.
    graded: u32,
    // The white balance's rows on linear sRGB.
    wb0: vec4<f32>,
    wb1: vec4<f32>,
    wb2: vec4<f32>,
    slope: vec4<f32>,
    offset: vec4<f32>,
    power: vec4<f32>,
};

@group(0) @binding(0) var linear_target: texture_2d<f32>;
@group(0) @binding(1) var<uniform> tone: Tone;
// What the passes after the finish draw over the frame (status marks and the legend): the
// deband leaves those pixels undithered (#418). One clear texel when nothing does.
@group(0) @binding(2) var covered: texture_2d<f32>;

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

// The deband's integer hash of a pixel and a lane (lowbias32), as finish.rs has it.
fn hash(x: u32, y: u32, lane: u32) -> u32 {
    var h = x * 0x8da6b343u + y * 0xd8163841u + lane * 0xcb1ab31fu;
    h = h ^ (h >> 16u);
    h = h * 0x7feb352du;
    h = h ^ (h >> 15u);
    h = h * 0x846ca68bu;
    h = h ^ (h >> 16u);
    return h;
}

// A triangular dither of `tone.deband` 8-bit steps at pixel `p`, in (−deband, deband) steps.
fn dither(p: vec2<u32>) -> f32 {
    let a = f32(hash(p.x, p.y, 0u) >> 8u) / 16777216.0;
    let b = f32(hash(p.x, p.y, 1u) >> 8u) / 16777216.0;
    return (a + b - 1.0) * tone.deband;
}

@fragment
fn out_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    var encoded = finish(textureLoad(linear_target, vec2<i32>(p.xy), 0).rgb);
    if tone.deband > 0.0 {
        let dims = textureDimensions(covered);
        let at = min(vec2<u32>(p.xy), dims - vec2<u32>(1u));
        let under = select(0.0, textureLoad(covered, at, 0).r, all(dims > vec2<u32>(1u)));
        if under == 0.0 {
            encoded = encoded + vec3<f32>(dither(vec2<u32>(p.xy)) / 255.0);
        }
    }
    return vec4<f32>(encoded, 1.0);
}

fn cdl(x: vec3<f32>) -> vec3<f32> {
    let v = pow(clamp(x * tone.slope.rgb + tone.offset.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), tone.power.rgb);
    let l = dot(v, vec3<f32>(0.2126, 0.7152, 0.0722));
    return vec3<f32>(l) + tone.saturation * (v - vec3<f32>(l));
}

// The look's tone curve on an exposed linear value, into [0, 1].
fn tone_curve(linear: vec3<f32>) -> vec3<f32> {
    if tone.map == 1u {
        return filmic(linear);
    } else if tone.map == 2u {
        return agx(linear);
    } else if tone.map == 3u {
        return neutral(linear);
    }
    return clamp(linear, vec3<f32>(0.0), vec3<f32>(1.0));
}

// The `tone` call (#418): the curve alone over an input, before any encode; alpha passes through.
@fragment
fn tone_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    let v = textureLoad(linear_target, vec2<i32>(p.xy), 0);
    var linear = v.rgb;
    if tone.graded == 1u {
        linear = vec3<f32>(dot(tone.wb0.xyz, linear), dot(tone.wb1.xyz, linear), dot(tone.wb2.xyz, linear));
    }
    var mapped = tone_curve(linear);
    if tone.graded == 1u {
        mapped = clamp(cdl(mapped), vec3<f32>(0.0), vec3<f32>(1.0));
    }
    return vec4<f32>(mapped, v.a);
}

// A linear value through the exposure, the white balance, the tone map, the CDL and the sRGB
// encode.
fn finish(value: vec3<f32>) -> vec3<f32> {
    var linear = value * tone.exposure;
    if tone.graded == 1u {
        linear = vec3<f32>(dot(tone.wb0.xyz, linear), dot(tone.wb1.xyz, linear), dot(tone.wb2.xyz, linear));
    }
    var mapped = tone_curve(linear);
    if tone.graded == 1u {
        mapped = clamp(cdl(mapped), vec3<f32>(0.0), vec3<f32>(1.0));
    }
    var encoded = srgb_encode(mapped);
    if tone.encode == 1u {
        encoded = srgb_encode(encoded);
    } else if tone.encode == 2u {
        encoded = mapped;
    }
    return encoded;
}
