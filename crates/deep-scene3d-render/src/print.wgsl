// Issue #464: the look's print finish as one pass (canvas primitives: Look `look@1`: separations
// and print finishes): the frame printed as ink separations, the tone curve, grain, print wear,
// the vignette and the screen, each pixel-wise and fused, every value from hash(the frame index
// at its rate, the document seed). It reads the frame the output wrote (sRGB-encoded) and never an
// earlier frame. Status colors draw after it.

struct Sep {
    // The ink, sRGB-encoded; w: 1 overprints by multiply, 0 knocks out.
    ink: vec4<f32>,
    // Angle (radians), pitch (anchor px), spot (0 solid, 1 round, 2 line, 3 square), anchor
    // (0 frame, 1 sheet, 2 plate).
    screen: vec4<f32>,
    // The registration offset in frame px.
    offset: vec4<f32>,
}

struct Params {
    // w, h, the plate's px per frame px (1 ÷ zoom), unused.
    size: vec4<f32>,
    // A frame pixel's place on the plate: plate = p × size.z + world.xy.
    world: vec4<f32>,
    // x: what runs (FLAG_*), y: the document seed, z: separations, w: unused.
    flags: vec4<u32>,
    // The grain's, the wear's and the screen's frame index at their rates.
    steps: vec4<u32>,
    // Amount, cell size px, midtones (1) or flat (0), unused.
    grain: vec4<f32>,
    // Inner, outer, amount, hood (1) or round (0).
    vignette: vec4<f32>,
    // The vignette's color (encoded); w: radius over the short half-axis in px (aspect round).
    vcolor: vec4<f32>,
    // The flicker's gain, the weave in px (x, y), the hair's chance.
    wear: vec4<f32>,
    // Scratches: fewest, most, width px, life in steps.
    wear2: vec4<f32>,
    // Dust: density, size px; the gate's corner radius and softness px.
    wear3: vec4<f32>,
    // The tone curve: white, contrast, toe, shoulder.
    tone: vec4<f32>,
    // The tone curve's black (encoded); w: unused.
    black: vec4<f32>,
    // Scanlines, mask (0 none, 1 aperture, 2 shadow, 3 slot), curvature, convergence px.
    screen: vec4<f32>,
    // Bleed, noise, unused, unused.
    screen2: vec4<f32>,
    // The ground (encoded), where a 3D surface printed as a separation leaves paper.
    ground: vec4<f32>,
    seps: array<Sep, 4>,
}

const FLAG_SEPS: u32 = 1u;
const FLAG_GRAIN: u32 = 2u;
const FLAG_VIGNETTE: u32 = 4u;
const FLAG_WEAR: u32 = 8u;
const FLAG_TONE: u32 = 16u;
const FLAG_SCREEN: u32 = 32u;
// A 3D frame: a separation's coverage is its role's surfaces, from the object IDs.
const FLAG_IDS: u32 = 64u;

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var cov0: texture_2d<f32>;
@group(0) @binding(2) var cov1: texture_2d<f32>;
@group(0) @binding(3) var cov2: texture_2d<f32>;
@group(0) @binding(4) var cov3: texture_2d<f32>;
@group(0) @binding(5) var ids: texture_2d<u32>;
@group(0) @binding(6) var<uniform> P: Params;
// Each object ID's separations, one bit each (FLAG_IDS).
@group(0) @binding(7) var<storage, read> masks: array<u32>;

const TAU: f32 = 6.283185307179586;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
}

// deep_canvas_marks::print::hash3.
fn hash3(a: u32, b: u32, c: u32) -> u32 {
    var x = a ^ (b * 0x9e3779b9u) ^ (c * 0x85ebca6bu);
    x = x ^ (x >> 16u);
    x = x * 0x7feb352du;
    x = x ^ (x >> 15u);
    x = x * 0x846ca68bu;
    x = x ^ (x >> 16u);
    return x;
}

fn unit(a: u32, b: u32, c: u32) -> f32 {
    return f32(hash3(a, b, c) >> 8u) / 16777216.0;
}

fn srgb_decode(v: vec3<f32>) -> vec3<f32> {
    let c = clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
    return select(pow((c + 0.055) / 1.055, vec3<f32>(2.4)), c / 12.92, c <= vec3<f32>(0.04045));
}

fn srgb_encode(v: vec3<f32>) -> vec3<f32> {
    let c = clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
    return select(1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3<f32>(0.0031308));
}

fn texel(t: texture_2d<f32>, at: vec2<i32>) -> vec4<f32> {
    let d = vec2<i32>(textureDimensions(t)) - vec2<i32>(1);
    return textureLoad(t, clamp(at, vec2<i32>(0), d), 0);
}

// A bilinear read at `s` (frame px, texel centres at +0.5), exactly the texel at a centre.
fn fetch(t: texture_2d<f32>, s: vec2<f32>) -> vec4<f32> {
    let f = s - 0.5;
    let i = vec2<i32>(floor(f));
    let w = f - floor(f);
    let a = mix(texel(t, i), texel(t, i + vec2<i32>(1, 0)), w.x);
    let b = mix(texel(t, i + vec2<i32>(0, 1)), texel(t, i + vec2<i32>(1, 1)), w.x);
    return mix(a, b, w.y);
}

// The frame at `s` on the paper: a 2D frame's marks are premultiplied over transparent.
fn paper(s: vec2<f32>) -> vec3<f32> {
    let v = fetch(src, s);
    return v.rgb + P.ground.rgb * (1.0 - v.a);
}

fn coverage_of(k: u32, s: vec2<f32>) -> f32 {
    if (P.flags.x & FLAG_IDS) != 0u {
        let d = vec2<i32>(textureDimensions(ids)) - vec2<i32>(1);
        let id = textureLoad(ids, clamp(vec2<i32>(floor(s)), vec2<i32>(0), d), 0).r;
        if id >= arrayLength(&masks) {
            return 0.0;
        }
        return f32((masks[id] >> k) & 1u);
    }
    switch k {
        case 0u: { return fetch(cov0, s).a; }
        case 1u: { return fetch(cov1, s).a; }
        case 2u: { return fetch(cov2, s).a; }
        default: { return fetch(cov3, s).a; }
    }
}

// How much of the pixel a separation's screen inks at coverage `c`, the pixel at `a` in its
// anchor's px, `aa` anchor px a frame px.
fn screened(sep: Sep, c: f32, a: vec2<f32>, aa: f32) -> f32 {
    let spot = u32(sep.screen.z);
    if spot == 0u || c <= 0.0 {
        return c;
    }
    if c >= 1.0 {
        return 1.0;
    }
    let pitch = sep.screen.y;
    let ca = cos(sep.screen.x);
    let sa = sin(sep.screen.x);
    let u = vec2<f32>(ca * a.x + sa * a.y, -sa * a.x + ca * a.y) / pitch;
    let d = u - floor(u) - 0.5;
    var inside: f32;
    if spot == 2u {
        inside = c * 0.5 * pitch - abs(d.y) * pitch;
    } else if spot == 3u {
        inside = sqrt(c) * 0.5 * pitch - max(abs(d.x), abs(d.y)) * pitch;
    } else if c <= 0.5 {
        // A round dot of the coverage's area at the cell's centre…
        inside = sqrt(c / 3.141592653589793) * pitch - length(d) * pitch;
    } else {
        // …and past half, round holes at its corners.
        let h = sqrt((1.0 - c) / 3.141592653589793) * pitch;
        inside = length(vec2<f32>(0.5) - abs(d)) * pitch - h;
    }
    return clamp(inside / aa + 0.5, 0.0, 1.0);
}

fn tone_curve(x: vec3<f32>) -> vec3<f32> {
    var v = vec3<f32>(0.5) + (x - vec3<f32>(0.5)) * P.tone.y;
    let toe = P.tone.z;
    if toe > 0.0 {
        v = select(v, toe * exp((v - vec3<f32>(toe)) / toe), v < vec3<f32>(toe));
    }
    let sh = P.tone.w;
    if sh > 0.0 {
        let k = 1.0 - sh;
        v = select(v, vec3<f32>(1.0) - sh * exp((vec3<f32>(k) - v) / sh), v > vec3<f32>(k));
    }
    v = clamp(v, vec3<f32>(0.0), vec3<f32>(1.0));
    return P.black.rgb + (vec3<f32>(P.tone.x) - P.black.rgb) * v;
}

// Grain's weight by luminance: 1 at 0.18, falling off over 0.8 of a stop with `midtones`.
fn grain_weight(y: f32) -> f32 {
    if P.grain.z == 0.0 {
        return 1.0;
    }
    let stops = log2(max(y, 1e-6) / 0.18) / 0.8;
    return exp(-0.5 * stops * stops);
}

// Print wear's marks at frame pixel `p`: the share of light each leaves (1 none).
fn worn(p: vec2<f32>) -> f32 {
    let w = P.size.x;
    let h = P.size.y;
    let n = P.steps.y;
    let seed = P.flags.y;
    var keep = 1.0;
    // Scratches, each living `life` steps.
    let most = u32(P.wear2.y);
    if most > 0u {
        let life = max(u32(P.wear2.w), 1u);
        let g = n / life;
        let fewest = u32(P.wear2.x);
        let count = fewest + hash3(g, seed, 0x51u) % (most - fewest + 1u);
        for (var j = 0u; j < count; j = j + 1u) {
            let x = unit(g, seed, 0x60u + j) * w + (f32(n % life) - 0.5 * f32(life)) * 0.3;
            let half_w = 0.5 * max(P.wear2.z, 0.5);
            let d = abs(p.x - x);
            keep = keep * mix(0.55, 1.0, clamp(d - half_w + 0.5, 0.0, 1.0));
        }
    }
    // Dust: at most one speck to a cell, at its density per 100 × 100 px.
    let density = P.wear3.x;
    if density > 0.0 {
        let size = max(P.wear3.y, 0.5);
        let cell = max(size * 8.0, 4.0);
        let c = vec2<u32>(floor(p / cell));
        let k = hash3(c.x, c.y ^ (n * 0x2545f491u), seed);
        if f32(k >> 8u) / 16777216.0 < density * cell * cell / 10000.0 {
            let at = (vec2<f32>(c) + vec2<f32>(unit(k, 1u, 2u), unit(k, 3u, 4u))) * cell;
            keep = keep * mix(0.2, 1.0, clamp(length(p - at) - 0.5 * size + 0.5, 0.0, 1.0));
        }
    }
    // A hair on the gate, by its chance each step.
    if P.wear.w > 0.0 && unit(n, seed, 0x71u) < P.wear.w {
        let y0 = unit(n, seed, 0x72u) * h;
        let amp = (0.05 + 0.1 * unit(n, seed, 0x73u)) * h;
        let f = TAU / (w * (0.3 + 0.5 * unit(n, seed, 0x74u)));
        let x0 = unit(n, seed, 0x75u) * w;
        let reach = 0.25 * w;
        if abs(p.x - x0) < reach {
            let y = y0 + amp * sin(f * (p.x - x0));
            keep = keep * mix(0.3, 1.0, clamp(abs(p.y - y) - 0.4, 0.0, 1.0));
        }
    }
    // The rounded gate.
    let r = P.wear3.z;
    let soft = max(P.wear3.w, 0.5);
    if r > 0.0 || P.wear3.w > 0.0 {
        let q = abs(p - 0.5 * vec2<f32>(w, h)) - (0.5 * vec2<f32>(w, h) - vec2<f32>(r));
        let outside = length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
        keep = keep * clamp(-outside / soft, 0.0, 1.0);
    }
    return keep;
}

struct Printed {
    final_color: vec4<f32>,
    linear: vec4<f32>,
}

fn print(frag: vec2<f32>) -> Printed {
    let size = P.size.xy;
    let half = 0.5 * size;
    var s = frag;
    let screen_on = (P.flags.x & FLAG_SCREEN) != 0u;
    var off_frame = false;
    // The CRT's barrel: frame point q shows the picture at q × (1 + k|q|²).
    if screen_on && P.screen.z > 0.0 {
        let q = (frag - half) / half;
        let p = q * (1.0 + P.screen.z * dot(q, q));
        off_frame = any(abs(p) > vec2<f32>(1.0));
        s = half + p * half;
    }
    if (P.flags.x & FLAG_WEAR) != 0u {
        s = s - P.wear.yz;
    }
    var c = paper(s);
    if screen_on && P.screen.w != 0.0 {
        c.r = paper(s + vec2<f32>(P.screen.w, 0.0)).r;
        c.b = paper(s - vec2<f32>(P.screen.w, 0.0)).b;
    }
    if screen_on && P.screen2.x > 0.0 {
        let spread = (paper(s - vec2<f32>(2.0, 0.0)) + paper(s - vec2<f32>(1.0, 0.0))
            + paper(s + vec2<f32>(1.0, 0.0)) + paper(s + vec2<f32>(2.0, 0.0))) * 0.25;
        c = mix(c, spread, P.screen2.x);
    }
    // The separations, in order, onto the paper.
    if (P.flags.x & FLAG_SEPS) != 0u {
        if (P.flags.x & FLAG_IDS) != 0u {
            for (var k = 0u; k < P.flags.z; k = k + 1u) {
                if coverage_of(k, s) > 0.0 {
                    c = P.ground.rgb;
                }
            }
        }
        for (var k = 0u; k < P.flags.z; k = k + 1u) {
            let sep = P.seps[k];
            let at = s - sep.offset.xy;
            let cov = coverage_of(k, at);
            var a = at;
            var aa = 1.0;
            if sep.screen.w == 2.0 {
                a = at * P.size.z + P.world.xy;
                aa = P.size.z;
            }
            let inked = screened(sep, cov, a, aa);
            if sep.ink.w == 1.0 {
                c = c * mix(vec3<f32>(1.0), sep.ink.rgb, inked);
            } else {
                c = mix(c, sep.ink.rgb, inked);
            }
        }
    }
    if (P.flags.x & FLAG_TONE) != 0u {
        c = tone_curve(c);
    }
    // Light: grain and print wear in linear light.
    let linear_on = (P.flags.x & (FLAG_GRAIN | FLAG_WEAR)) != 0u;
    if linear_on {
        var lin = srgb_decode(c);
        if (P.flags.x & FLAG_GRAIN) != 0u {
            let cell = vec2<u32>(floor(frag / max(P.grain.y, 1.0)));
            let n = (unit(hash3(cell.x, cell.y, P.flags.y), P.steps.x, 0x6a09e667u) - 0.5) * 3.4641016151377544;
            let y = dot(lin, vec3<f32>(0.2126, 0.7152, 0.0722));
            lin = lin * max(0.0, 1.0 + P.grain.x * grain_weight(y) * n);
        }
        if (P.flags.x & FLAG_WEAR) != 0u {
            lin = lin * P.wear.x * worn(frag);
        }
        c = srgb_encode(lin);
    }
    if (P.flags.x & FLAG_VIGNETTE) != 0u {
        let d = frag - half;
        var r: f32;
        if P.vcolor.w > 0.0 {
            r = length(d) / P.vcolor.w;
        } else if P.vignette.w == 1.0 {
            r = max(abs(d.x) / half.x, abs(d.y) / half.y);
        } else {
            r = length(d / half);
        }
        let k = P.vignette.z * smoothstep(P.vignette.x, P.vignette.y, r);
        c = mix(c, P.vcolor.rgb, k);
    }
    if screen_on {
        let lines = P.screen.x;
        let mask = u32(P.screen.y);
        // The tube is driven brighter to make up for the light its mask and scanlines take.
        let gain = select(1.0, 1.6, mask != 0u) * select(1.0, 1.25, lines > 0.0);
        c = min(c * gain, vec3<f32>(1.0));
        if lines > 0.0 {
            let period = size.y / lines;
            let phase = frag.y / period - 0.5;
            c = c * (1.0 - 0.5 * (0.5 + 0.5 * cos(TAU * phase)));
        }
        if mask != 0u {
            let px = vec2<u32>(frag);
            var lit = px.x % 3u;
            if mask == 2u {
                lit = (px.x + 2u * (px.y % 2u)) % 3u;
            } else if mask == 3u {
                lit = (px.x + select(0u, 1u, (px.y / 3u + px.x / 3u) % 2u == 1u)) % 3u;
            }
            var m = vec3<f32>(0.25);
            m[lit] = 1.0;
            c = c * m;
        }
        if P.screen2.y > 0.0 {
            let px = vec2<u32>(frag);
            c = c + vec3<f32>(P.screen2.y * (unit(hash3(px.x, px.y, P.flags.y), P.steps.z, 0x3c6ef372u) - 0.5));
        }
        if off_frame {
            c = vec3<f32>(0.0);
        }
    }
    c = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    var out: Printed;
    out.final_color = vec4<f32>(c, 1.0);
    out.linear = vec4<f32>(srgb_decode(c), 1.0);
    return out;
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    return print(p.xy).final_color;
}

struct Both {
    @location(0) final_color: vec4<f32>,
    @location(1) linear: vec4<f32>,
}

@fragment
fn fs_linear(@builtin(position) p: vec4<f32>) -> Both {
    let printed = print(p.xy);
    var out: Both;
    out.final_color = printed.final_color;
    out.linear = printed.linear;
    return out;
}
