// #2031: a lit group's lit children, lit at each pixel (canvas primitives: Frame and group
// `frame@1`, `group@1`). deep-canvas-marks' light.rs is the CPU reference: a light's reach is
// (1 − (d ÷ range)²)² inside its range, and a pixel's color is decoded to linear light,
// multiplied by ambient plus the sum of energy × reach × color, clamped to 1 and encoded once.
// `src` holds the children drawn alone, premultiplied in the layer's space.
// #2032: a light is left out where an occluding outline shadows the pixel: the straight segment
// from the pixel to the light crosses an outline the pixel isn't inside (deep-canvas-marks'
// shadow.rs, the CPU reference, whose bins these are), at four points of the pixel, so a
// shadow's edge is antialiased over 1 px.
// #2053: in a run that holds an image with a `normal` page, each point light's term is multiplied
// by max(0, N·L) ÷ L.z, which is max(0, N·v) ÷ v.z for v = (at − pixel, height): N the page's
// nearest texel, red and green as c × 2 − 1 with +y toward the image's top, z rebuilt, turned
// with the image. A sun's height is 0 and it reads the page as flat.

struct Light {
    // at.x, at.y and range in px, energy.
    at: vec4<f32>,
    // The color in linear light; w: 1 where it casts shadows.
    color: vec4<f32>,
}

// What a light that casts shadows reads beside its `Light`.
struct Caster {
    // A sun's direction, the way its shadows run; then, across its rays, where its first bin
    // starts in px and its bins a px.
    rays: vec4<f32>,
    // x: where its bins' offsets start in `words`; y: where its bins' bounds start in `bounds`;
    // z: 1 for a sun.
    bins: vec4<u32>,
}

struct U {
    ambient: f32,
    count: u32,
    // 1: the layer composites in linear light; 2: a linear falloff; 4: a sum in encoded space;
    // 8: a pixel inside an outline is shadowed by it; 16: a shadow removes ambient too; 32: a
    // shadow's edge isn't antialiased; 64: the run is a paged image; 128: its green read the
    // other way up; 256: N·L alone, not ÷ L.z; 512: its normals left unturned.
    flags: u32,
    pad: u32,
    lights: array<Light, 16>,
    casters: array<Caster, 16>,
    // Each light's height in px, four to a vec4; 0 for a sun.
    heights: array<vec4<f32>, 4>,
    // From px to the page's texels: x′ = a x + c y + e, y′ = b x + d y + f, as (a, b, c, d) and
    // (e, f, sin, cos) of the image's turn.
    page: array<vec4<f32>, 2>,
    // The page's size in texels.
    page_size: vec4<u32>,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var src: texture_2d<f32>;
// Each occluder segment's ends in px, a.xy then b.xy.
@group(0) @binding(2) var<storage, read> segs: array<vec4<f32>>;
// Each casting light's 1025 bin offsets, then its 1024 bins' corners, then its bins: per outline
// a word with RUN set and its winding number round the light plus 32768, then its segments'
// indices. A bin holds every segment a pixel centred in it can meet at any of its points. A
// bin's corner is the segment its split starts from, twice, plus 1 where the outline lies on
// the side a ray reads as 0 or more.
@group(0) @binding(3) var<storage, read> words: array<u32>;
// #2844: each casting light's bins' zones, px from a point light or along a sun's rays: nearer
// than x nothing in the bin blocks a pixel; from y on an outline blocks all of it; and from z to
// w a pixel is behind one outline's silhouette and nothing else, blocked on the outline's side
// of the ray through the bin's corner.
@group(0) @binding(4) var<storage, read> bounds: array<vec4<f32>>;
// What the layer drew before the group, where the pass lays the lit children over it.
@group(0) @binding(5) var back: texture_2d<f32>;
// #2053: the run's normal page, as stored.
@group(0) @binding(6) var normals: texture_2d<f32>;

const BINS: f32 = 1024.0;
const RUN: u32 = 0x80000000u;
// How far from its centre a pixel is tested at most, with room for what f32 loses.
const FOOT: f32 = 0.46;
// The least part of its two products a side is, 2^-20, for its sign to be sure in f32.
const SURE: f32 = 0.00000095367431640625;

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

// The share of light `i` that reaches the pixel at `p`, as shadow.rs's `share` has it: the part
// of the pixel's four points the light isn't blocked at, each tested against its bin's segments.
fn share(i: u32, p: vec2<f32>) -> f32 {
    let rays = u.casters[i].rays;
    let bins = u.casters[i].bins;
    let at = u.lights[i].at.xy;
    let far = bins.z != 0u;
    var bin = 0u;
    var key = 0.0;
    if (far) {
        let b = (rays.x * p.y - rays.y * p.x - rays.z) * rays.w;
        if (!(b >= 0.0 && b < BINS)) {
            return 1.0;
        }
        bin = u32(b);
        key = dot(rays.xy, p);
    } else {
        let v = p - at;
        let s = abs(v.x) + abs(v.y);
        if (s == 0.0) {
            return 1.0;
        }
        let t = v.x / s;
        bin = min(u32(select(3.0 + t, 1.0 - t, v.y >= 0.0) * (BINS / 4.0)), u32(BINS) - 1u);
        key = length(v);
    }
    let bound = bounds[bins.y + bin];
    // Past an outline's near side a pixel is inside it, which the planted pass shadows.
    if (key + FOOT <= bound.x && (u.flags & 8u) == 0u) {
        return 1.0;
    }
    if (key - FOOT >= bound.y) {
        return 0.0;
    }
    // The four points, or the centre four times for an edge with no antialiasing.
    let spread = select(1.0, 0.0, (u.flags & 32u) != 0u);
    let x = vec4<f32>(p.x) + spread * vec4<f32>(-0.2, 0.4, -0.4, 0.2);
    let y = vec4<f32>(p.y) + spread * vec4<f32>(-0.4, -0.2, 0.2, 0.4);
    var dx = vec4<f32>(-rays.x);
    var dy = vec4<f32>(-rays.y);
    if (!far) {
        dx = vec4<f32>(at.x) - x;
        dy = vec4<f32>(at.y) - y;
    }
    let inside_too = vec4<bool>((u.flags & 8u) != 0u);
    let none = vec4<i32>(0);
    let zero = vec4<f32>(0.0);
    if (key - FOOT >= bound.z && key + FOOT <= bound.w) {
        // Behind one silhouette alone: lit where the corner lies on the outline's side of the
        // ray. A point as near the corner's ray as f32 can tell is left to the segments.
        let corner = words[bins.x + u32(BINS) + 1u + bin];
        let s = segs[corner >> 1u];
        let ax = vec4<f32>(s.x) - x;
        let ay = vec4<f32>(s.y) - y;
        let sa = dx * ay - dy * ax;
        if (all(abs(sa) > (abs(dx * ay) + abs(dy * ax)) * SURE)) {
            let lit = (sa >= zero) == vec4<bool>((corner & 1u) != 0u);
            return dot(select(vec4<f32>(0.0), vec4<f32>(0.25), lit), vec4<f32>(1.0));
        }
    }
    var k = words[bins.x + bin];
    let end = words[bins.x + bin + 1u];
    var crossings = none;
    var wind = none;
    var blocked = vec4<bool>(false);
    while (k < end) {
        let w = words[k];
        k = k + 1u;
        if ((w & RUN) != 0u) {
            blocked = blocked | ((crossings > none) & ((wind == none) | inside_too));
            if (all(blocked)) {
                return 0.0;
            }
            crossings = none;
            wind = vec4<i32>(i32(w & 0xffffu) - 32768);
            continue;
        }
        let s = segs[w];
        let ax = vec4<f32>(s.x) - x;
        let ay = vec4<f32>(s.y) - y;
        let bx = vec4<f32>(s.z) - x;
        let by = vec4<f32>(s.w) - y;
        let sa = dx * ay - dy * ax;
        let sb = dx * by - dy * bx;
        // The crossing is num ÷ den of the way from the point to the light.
        let den = sb - sa;
        let num = ax * by - ay * bx;
        let up = (den > zero);
        let ahead = select((num < zero), (num > zero), up);
        let before = select((num > den), (num < den), up) | vec4<bool>(far);
        let hit = ((sa >= zero) != (sb >= zero)) & ahead & before;
        crossings = crossings + select(none, vec4<i32>(1), hit);
        wind = wind + select(none, select(vec4<i32>(-1), vec4<i32>(1), up), hit);
    }
    blocked = blocked | ((crossings > none) & ((wind == none) | inside_too));
    return dot(select(vec4<f32>(0.25), vec4<f32>(0.0), blocked), vec4<f32>(1.0));
}

// #2053: the page's normal at `p` (px) in the frame's axes, y down; w 0 off the page.
fn normal_at(p: vec2<f32>) -> vec4<f32> {
    let m = u.page[0];
    let o = u.page[1];
    let t = vec2<f32>(m.x * p.x + m.z * p.y + o.x, m.y * p.x + m.w * p.y + o.y);
    let size = vec2<f32>(u.page_size.xy);
    if (!(t.x >= 0.0 && t.y >= 0.0 && t.x < size.x && t.y < size.y)) {
        return vec4<f32>(0.0);
    }
    let c = textureLoad(normals, vec2<i32>(floor(t)), 0);
    var xy = vec2<f32>(c.r, c.g) * 2.0 - 1.0;
    if ((u.flags & 128u) != 0u) {
        xy.y = -xy.y;
    }
    let n = normalize(vec3<f32>(xy, sqrt(max(0.0, 1.0 - dot(xy, xy)))));
    // +y toward the image's top edge is -y in the frame.
    let v = vec2<f32>(n.x, -n.y);
    if ((u.flags & 512u) != 0u) {
        return vec4<f32>(v, n.z, 1.0);
    }
    let s = o.z;
    let k = o.w;
    return vec4<f32>(k * v.x - s * v.y, s * v.x + k * v.y, n.z, 1.0);
}

// The pixel at `pos` lit; `casts`: some light of the list casts shadows.
fn lit(pos: vec4<f32>, casts: bool) -> vec4<f32> {
    let c = textureLoad(src, vec2<i32>(pos.xy), 0);
    if (c.a <= 0.0) {
        return c;
    }
    let rgb = min(c.rgb / c.a, vec3<f32>(1.0));
    var lin = rgb;
    if ((u.flags & 1u) == 0u) {
        lin = decode(rgb);
    }
    let planted_sum = (u.flags & 4u) != 0u;
    var sum = vec3<f32>(u.ambient);
    var apart = vec3<f32>(0.0);
    if (planted_sum) {
        apart = space_out(lin * u.ambient);
    }
    // The share of ambient a planted shadow leaves.
    var ambient_kept = 1.0;
    var n = vec4<f32>(0.0);
    if ((u.flags & 64u) != 0u) {
        n = normal_at(pos.xy);
    }
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
        // #2844: a light out of reach adds nothing, and casts nothing to test.
        if (casts && reach == 0.0) {
            continue;
        }
        var term = l.at.w * reach * l.color.rgb;
        let h = u.heights[i / 4u][i % 4u];
        if (n.w != 0.0 && h > 0.0 && reach > 0.0) {
            let v = vec3<f32>(l.at.xy - pos.xy, h);
            let lit_by = max(0.0, dot(n.xyz, v));
            if ((u.flags & 256u) != 0u) {
                term = term * (lit_by / length(v));
            } else {
                term = term * (lit_by / h);
            }
        }
        if (casts && reach > 0.0 && l.color.w != 0.0) {
            let part = share(i, pos.xy);
            term = term * part;
            ambient_kept = ambient_kept * part;
        }
        sum = sum + term;
        if (planted_sum) {
            apart = apart + space_out(lin * term);
        }
    }
    if ((u.flags & 16u) != 0u) {
        sum = sum - vec3<f32>(u.ambient * (1.0 - ambient_kept));
    }
    var out = space_out(lin * sum);
    if (planted_sum) {
        out = clamp(apart, vec3<f32>(0.0), vec3<f32>(1.0));
    }
    return vec4<f32>(out * c.a, c.a);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return lit(pos, false);
}

@fragment
fn fs_cast(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return lit(pos, true);
}

// The lit pixel `s` over what the layer drew before it, as the group compositor lays a group
// with no blend mode at full opacity (groups.wgsl).
fn over(s: vec4<f32>, pos: vec4<f32>) -> vec4<f32> {
    let b = textureLoad(back, vec2<i32>(pos.xy), 0);
    if (s.a <= 0.0) {
        return b;
    }
    let ub = select(vec3<f32>(0.0), clamp(b.rgb / b.a, vec3<f32>(0.0), vec3<f32>(1.0)), b.a > 0.0);
    let us = clamp(s.rgb / s.a, vec3<f32>(0.0), vec3<f32>(1.0));
    let rgb = s.rgb * (1.0 - b.a) + b.rgb * (1.0 - s.a) + s.a * b.a * us;
    return vec4<f32>(rgb, s.a + b.a * (1.0 - s.a));
}

@fragment
fn fs_over(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return over(lit(pos, false), pos);
}

@fragment
fn fs_cast_over(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return over(lit(pos, true), pos);
}
