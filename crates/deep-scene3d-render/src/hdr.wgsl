// Issue #177 (GPU surface: HDR output): the HDR surface's frame, in extended linear sRGB. Joined to
// output.wgsl, whose `finish` and `finish_linear` it runs. It reads the finished SDR slot, after
// every pass that draws over the scene, and decodes it to linear light; where the scene alone
// wrote a pixel (the status layer doesn't cover it and the slot holds the output's own value),
// the tone curve rolled off to the display's headroom adds what lies above the SDR curve. So mid
// tones keep the slot's values, and status colors, labels and outlines keep their exact SDR ones.

struct Hdr {
    headroom: f32,
    // How far, in 8-bit steps, the slot may sit from the output's own value: the deband's
    // amplitude and one step of rounding.
    tolerance: f32,
    // The internal frame's size over the slot's, below scale 1.
    scale: vec2<f32>,
    // The planted wrong passes: 1 clips at 1, 2 clips at the headroom, 3 scales the whole curve,
    // 4 scales what drew over the scene (status colors among it).
    plant: u32,
};

@group(0) @binding(3) var slot: texture_2d<f32>;
@group(0) @binding(4) var<uniform> hdr: Hdr;

fn srgb_decode(c: vec3<f32>) -> vec3<f32> {
    let lo = c / 12.92;
    let hi = pow((c + 0.055) / 1.055, vec3<f32>(2.4));
    return select(hi, lo, c <= vec3<f32>(0.04045));
}

@fragment
fn hdr_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    let shown = textureLoad(slot, vec2<i32>(p.xy), 0);
    let decoded = srgb_decode(shown.rgb);
    let dims = textureDimensions(covered);
    let at = min(vec2<u32>(p.xy), dims - vec2<u32>(1u));
    let under = select(0.0, textureLoad(covered, at, 0).r, all(dims > vec2<u32>(1u)));
    if under == 0.0 && hdr.plant == 3u {
        return vec4<f32>(decoded * hdr.headroom, shown.a);
    }
    if under > 0.0 || hdr.plant == 1u {
        if hdr.plant == 4u {
            return vec4<f32>(decoded * hdr.headroom, shown.a);
        }
        return vec4<f32>(decoded, shown.a);
    }
    let lit = textureLoad(linear_target, vec2<i32>(floor(p.xy * hdr.scale)), 0).rgb;
    // The SDR curve once: what the output wrote, and what lies above it at the headroom.
    let sdr_linear = finish_linear(lit, 1.0);
    let same = all(abs(round(srgb_encode(sdr_linear) * 255.0) - round(shown.rgb * 255.0))
        <= vec3<f32>(hdr.tolerance));
    if !same {
        // Something drew over the scene here (status colors, labels, outlines).
        return vec4<f32>(select(decoded, decoded * hdr.headroom, hdr.plant == 4u), shown.a);
    }
    var above = finish_linear(lit, hdr.headroom) - sdr_linear;
    if hdr.plant == 2u {
        let exposed = lit * tone.exposure;
        above = select(vec3<f32>(0.0), min(exposed, vec3<f32>(hdr.headroom)) - sdr_linear, exposed > vec3<f32>(0.18));
    }
    return vec4<f32>(decoded + above, shown.a);
}
