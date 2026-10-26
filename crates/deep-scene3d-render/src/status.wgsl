// Issue #382: the status guard and the status colors, the two passes after the finish (canvas
// primitives: Status guard; The status-color rule).
//
// The guard reads the finished frame (display-referred, sRGB-encoded, f32) and writes the slot: a
// pixel within the look's distance (OKLab ΔE) of a status color moves along the line from the
// nearest status color through it to the distance, gamut-clipped, and is checked again against
// every status color; a pixel the clip keeps inside tries the lighter direction, then the grey
// axis. The status colors then composite the status layer (marks and legend, premultiplied) over
// the slot, so their pixels are exact and nothing the frame drew covers them.

struct Guard {
    // Each status color in OKLab (xyz); `count` of them are set.
    colors: array<vec4<f32>, 9>,
    count: u32,
    min_distance: f32,
    // 0: the guard; 1: the planted guard that maps every clashing pixel to grey OKLab (0.80, 0, 0).
    mode: u32,
    // 1 when the target is an 8-bit slot: the moved pixel is checked as the slot will hold it,
    // rounded to 8-bit codes, so the quantization can't put it back inside the distance.
    quantize: u32,
};

@group(0) @binding(0) var finished: texture_2d<f32>;
@group(0) @binding(1) var<uniform> guard: Guard;
@group(0) @binding(2) var<storage, read_write> moved: atomic<u32>;

@vertex
fn full_vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    let x = f32((vi << 1u) & 2u);
    let y = f32(vi & 2u);
    return vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

fn srgb_decode(v: vec3<f32>) -> vec3<f32> {
    let c = clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
    let lo = c / 12.92;
    let hi = pow((c + 0.055) / 1.055, vec3<f32>(2.4));
    return select(hi, lo, c <= vec3<f32>(0.04045));
}

fn srgb_encode(x: vec3<f32>) -> vec3<f32> {
    let v = clamp(x, vec3<f32>(0.0), vec3<f32>(1.0));
    let lo = v * 12.92;
    let hi = 1.055 * pow(v, vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(hi, lo, v <= vec3<f32>(0.0031308));
}

fn cbrt(x: f32) -> f32 {
    return sign(x) * pow(abs(x), 1.0 / 3.0);
}

// Björn Ottosson's OKLab, from linear sRGB.
fn to_oklab(c: vec3<f32>) -> vec3<f32> {
    let l = cbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
    let m = cbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
    let s = cbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
    return vec3<f32>(
        0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
    );
}

fn from_oklab(lab: vec3<f32>) -> vec3<f32> {
    let l_ = lab.x + 0.3963377774 * lab.y + 0.2158037573 * lab.z;
    let m_ = lab.x - 0.1055613458 * lab.y - 0.0638541728 * lab.z;
    let s_ = lab.x - 0.0894841775 * lab.y - 1.2914855480 * lab.z;
    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;
    return vec3<f32>(
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    );
}

// The nearest status color's index and its distance.
fn nearest(lab: vec3<f32>) -> vec2<f32> {
    var best = 1e9;
    var at = 0.0;
    for (var i = 0u; i < guard.count; i++) {
        let d = distance(lab, guard.colors[i].xyz);
        if d < best {
            best = d;
            at = f32(i);
        }
    }
    return vec2<f32>(at, best);
}

@fragment
fn guard_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    let px = textureLoad(finished, vec2<i32>(p.xy), 0);
    let enc = clamp(px.rgb, vec3<f32>(0.0), vec3<f32>(1.0));
    var lin = srgb_decode(enc);
    var lab = to_oklab(lin);
    var n = nearest(lab);
    let min_d = guard.min_distance;
    if guard.count == 0u || n.y >= min_d {
        return vec4<f32>(enc, px.a);
    }
    atomicAdd(&moved, 1u);
    for (var i = 0; i < 16; i++) {
        n = nearest(lab);
        if n.y >= min_d {
            break;
        }
        let s = guard.colors[u32(n.x)].xyz;
        if guard.mode == 1u {
            lab = vec3<f32>(0.8, 0.0, 0.0);
        } else {
            var dir: vec3<f32>;
            if i < 8 {
                // Along the line from the nearest status color through the pixel; a pixel on the
                // color itself has no direction, so it goes lighter.
                if n.y > 1e-6 {
                    dir = (lab - s) / n.y;
                } else {
                    dir = vec3<f32>(1.0, 0.0, 0.0);
                }
            } else if i < 12 {
                // The clip kept it inside: lighter.
                dir = vec3<f32>(1.0, 0.0, 0.0);
            } else {
                // Still inside: toward the grey axis.
                dir = normalize(vec3<f32>(0.8, 0.0, 0.0) - s);
            }
            // A hair past the distance, so the f32 round trip through the clip lands at or beyond
            // it; a retry steps further: past what an 8-bit rounding moves a color when the
            // target quantizes, else by another hair.
            let retry = select(min_d * 1e-4, 0.002, guard.quantize == 1u) * f32(i);
            lab = s + dir * (min_d * (1.0 + 1e-4) + retry);
        }
        // Gamut clip: each linear channel to [0, 1]; then check again from the clipped color, as
        // the slot will hold it when it quantizes.
        lin = clamp(from_oklab(lab), vec3<f32>(0.0), vec3<f32>(1.0));
        if guard.quantize == 1u {
            lin = srgb_decode(round(srgb_encode(lin) * 255.0) / 255.0);
        }
        lab = to_oklab(lin);
    }
    return vec4<f32>(srgb_encode(lin), px.a);
}

// The status layer: marks and the legend, premultiplied RGBA at the slot's size, composited
// over the slot by the pipeline's blend (one over).
@group(0) @binding(0) var layer: texture_2d<f32>;

@fragment
fn colors_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    return textureLoad(layer, vec2<i32>(p.xy), 0);
}
