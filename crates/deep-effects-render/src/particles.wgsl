// Issue #380: the core's instanced draw of a particles@1 item's instance columns, which its
// shipped compute operator wrote this frame: one sprite per live particle, sized in px, its color
// the item's roles over its life, added to the linear target where it shows in front of the
// scene (reversed Z, so a nearer sprite has the larger depth). Issue #420: its size and opacity
// over life, up to four color stops mixed in OKLab, and its draw: a dot, a spark, a puff (shaded
// at half resolution unless `full`) or a streak along its velocity. Issue #1173: a half-resolution
// puff draws into a half-size target, hidden where the scene's depth is nearer, which a filtered
// upsample adds to the linear target. Written for this module; nothing here is ported.

struct Draw {
    clip: mat4x4<f32>,
    // The view's width and height in px, a size scale in px, and an opacity scale.
    view: vec4<f32>,
    // Its size at birth and at death, its opacity at birth and at death.
    life: vec4<f32>,
    // Its draw (0 dot, 1 spark, 2 puff, 3 streak, 4 ribbon), half-resolution shading, its stop
    // count, and the planted block copy (#1173).
    kind: vec4<f32>,
    // A ribbon's (#450): the item's count, its segments, its width in px, its taper and its fade.
    ribbon: vec4<f32>,
    ribbon_fade: vec4<f32>,
    // Each color stop's place in life, and its linear color.
    at: vec4<f32>,
    colors: array<vec4<f32>, 4>,
};

@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var<storage, read> inst: array<f32>;
// The half-resolution draw's: the scene's depth; the upsample's: the half-size target.
@group(0) @binding(2) var scene_depth: texture_depth_2d;
@group(0) @binding(3) var half_target: texture_2d<f32>;
@group(0) @binding(4) var half_sampler: sampler;

struct Out {
    @builtin(position) pos: vec4<f32>,
    @location(0) at: vec2<f32>,
    @location(1) life: f32,
    // The sprite's centre and half extents in px, for the planted block copy.
    @location(2) centre: vec2<f32>,
    @location(3) half_px: vec2<f32>,
    // A ribbon segment's alpha by its fade (#450); 1 for every other draw.
    @location(4) alpha: f32,
    // A ribbon's newest segment (#450): its far end in px (its near end, the particle, in
    // `centre`, its radii at both ends in `half_px`), and 1, so it shades as a capsule rounded at
    // the particle and a still particle draws a dot; 0 for every other draw.
    @location(5) tail: vec2<f32>,
    @location(6) head: f32,
};

// One row of the columns: its place and its age over its life.
fn row(r: u32) -> vec4<f32> {
    let b = r * 8u;
    return vec4<f32>(inst[b], inst[b + 1u], inst[b + 2u], inst[b + 3u]);
}

// A ribbon's segment j of particle e (#450): the quad between its rows j and j + 1, which the
// kernel wrote back along its length, `count` rows apart, hidden unless the particle (row j = 0)
// is alive; its width tapers and its alpha fades with j ÷ segments.
fn ribbon_vs(vi: u32, ii: u32, k: vec2<f32>) -> Out {
    var out: Out;
    let count = u32(draw.ribbon.x);
    let segments = draw.ribbon.y;
    let e = ii % count;
    let j = ii / count;
    let head = row(e);
    let a = row(j * count + e);
    let b = row((j + 1u) * count + e);
    let ca = draw.clip * vec4<f32>(a.xyz, 1.0);
    let cb = draw.clip * vec4<f32>(b.xyz, 1.0);
    out.at = vec2<f32>(0.0, k.y);
    out.life = head.w;
    out.alpha = 1.0;
    if head.w < 0.0 || a.w < 0.0 || b.w < 0.0 || ca.w <= 0.0 || cb.w <= 0.0 {
        out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
        return out;
    }
    let u = (f32(j) + select(0.0, 1.0, k.x > 0.0)) / segments;
    let half_px = 0.5 * max(draw.ribbon.z * pow(1.0 - u, draw.ribbon.w), 1.0);
    out.alpha = pow(1.0 - u, draw.ribbon_fade.x);
    let pa = ca.xy / ca.w * 0.5 * draw.view.xy;
    let pb = cb.xy / cb.w * 0.5 * draw.view.xy;
    var ax = vec2<f32>(1.0, 0.0);
    if length(pb - pa) > 1e-3 {
        ax = normalize(pb - pa);
    }
    let c = select(ca, cb, k.x > 0.0);
    // The newest segment reaches a head's radius past both ends, so its round head shows, and a
    // particle that stands still (both ends one point) draws as a dot.
    let first = j == 0u;
    let r_head = 0.5 * max(draw.ribbon.z, 1.0);
    let reach = max(half_px, select(0.0, r_head, first));
    let along = ax * k.x * select(0.0, r_head, first);
    let across = vec2<f32>(-ax.y, ax.x) * k.y * reach;
    out.pos = vec4<f32>(c.xy + (across + along) * 2.0 / draw.view.xy * c.w, c.z, c.w);
    out.centre = (vec2<f32>(0.5, -0.5) * ca.xy / ca.w + 0.5) * draw.view.xy;
    out.tail = (vec2<f32>(0.5, -0.5) * cb.xy / cb.w + 0.5) * draw.view.xy;
    out.half_px = vec2<f32>(r_head, 0.5 * max(draw.ribbon.z * pow(1.0 - 1.0 / segments, draw.ribbon.w), 1.0));
    out.head = select(0.0, 1.0, first);
    return out;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    );
    let k = corners[vi];
    if draw.kind.x == 4.0 {
        return ribbon_vs(vi, ii, k);
    }
    let base = ii * 8u;
    let p = vec3<f32>(inst[base], inst[base + 1u], inst[base + 2u]);
    let life = inst[base + 3u];
    let v = vec3<f32>(inst[base + 4u], inst[base + 5u], inst[base + 6u]);
    var out: Out;
    out.at = k;
    out.life = life;
    out.alpha = 1.0;
    out.head = 0.0;
    let c = draw.clip * vec4<f32>(p, 1.0);
    if life < 0.0 || c.w <= 0.0 {
        out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
        return out;
    }
    let l = clamp(life, 0.0, 1.0);
    let size = mix(draw.life.x, draw.life.y, l) * draw.view.z;
    let half_px = 0.5 * max(size, 1.0);
    // Across the view in px: a streak runs along where its velocity takes it in a 30th of a s.
    var ax = vec2<f32>(1.0, 0.0);
    var ext = vec2<f32>(half_px, half_px);
    if draw.kind.x == 3.0 {
        let c2 = draw.clip * vec4<f32>(p + v * (1.0 / 30.0), 1.0);
        if c2.w > 0.0 {
            let d = (c2.xy / c2.w - c.xy / c.w) * 0.5 * draw.view.xy;
            let len = length(d);
            if len > 1e-3 {
                ax = d / len;
                ext = vec2<f32>(max(0.5 * len, half_px), half_px);
            }
        }
    }
    let across = vec2<f32>(-ax.y, ax.x);
    let off = ax * k.x * ext.x + across * k.y * ext.y;
    let ndc = off * 2.0 / draw.view.xy;
    out.pos = vec4<f32>(c.xy + ndc * c.w, c.z, c.w);
    out.centre = (c.xy / c.w * vec2<f32>(0.5, -0.5) + 0.5) * draw.view.xy;
    out.half_px = ext;
    return out;
}

fn cbrt(x: f32) -> f32 {
    return sign(x) * pow(abs(x), 1.0 / 3.0);
}

fn to_oklab(c: vec3<f32>) -> vec3<f32> {
    let l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    let m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    let s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
    let l_ = cbrt(l);
    let m_ = cbrt(m);
    let s_ = cbrt(s);
    return vec3<f32>(
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    );
}

fn from_oklab(c: vec3<f32>) -> vec3<f32> {
    let l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
    let m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
    let s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
    let l = l_ * l_ * l_;
    let m = m_ * m_ * m_;
    let s = s_ * s_ * s_;
    return vec3<f32>(
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    );
}

/// The color at `l` of its life: the stops' colors mixed in OKLab between the two about it.
fn color_at(l: f32) -> vec3<f32> {
    let n = i32(draw.kind.z);
    var lo = 0;
    for (var i = 1; i < 4; i++) {
        if i < n && draw.at[i] <= l {
            lo = i;
        }
    }
    let hi = min(lo + 1, n - 1);
    let a = draw.at[lo];
    let b = draw.at[hi];
    var f = 0.0;
    if b > a {
        f = clamp((l - a) / (b - a), 0.0, 1.0);
    }
    let mixed = mix(to_oklab(draw.colors[lo].rgb), to_oklab(draw.colors[hi].rgb), f);
    return max(from_oklab(mixed), vec3<f32>(0.0));
}

@fragment
fn fs(in: Out) -> @location(0) vec4<f32> {
    var at = in.at;
    // A ribbon's newest segment (#450): its distance to the segment over its radius there, the
    // end at the particle round, the far end left to the next segment.
    if in.head > 0.5 {
        let d = in.tail - in.centre;
        let l2 = dot(d, d);
        var t = 0.0;
        if l2 > 1e-6 {
            t = dot(in.pos.xy - in.centre, d) / l2;
            if t > 1.0 {
                discard;
            }
        }
        let s = clamp(t, 0.0, 1.0);
        let r = mix(in.half_px.x, in.half_px.y, s);
        at = vec2<f32>(0.0, length(in.pos.xy - (in.centre + d * s)) / max(r, 1e-3));
    }
    // The planted block copy (#1173): a puff shaded once per 2 × 2 px block, that value written
    // to all four.
    if draw.kind.w > 0.5 {
        let block = floor(in.pos.xy * 0.5) * 2.0 + 1.0;
        at = (block - in.centre) / max(in.half_px, vec2<f32>(1.0));
    }
    return shade(in, at);
}

// A half-size pixel of a half-resolution puff, times the share of the four full-size pixels under
// it where the puff is in front of the scene (reversed Z).
@fragment
fn half_fs(in: Out) -> @location(0) vec4<f32> {
    let full = vec2<i32>(floor(in.pos.xy)) * 2;
    let last = vec2<i32>(textureDimensions(scene_depth)) - 1;
    var shown = 0.0;
    for (var i = 0; i < 4; i++) {
        let p = min(full + vec2<i32>(i & 1, i >> 1u), last);
        shown += select(0.0, 0.25, in.pos.z >= textureLoad(scene_depth, p, 0));
    }
    return shade(in, in.at) * shown;
}

@vertex
fn upsample_vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    let x = f32((vi << 1u) & 2u);
    let y = f32(vi & 2u);
    return vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

// The half-size target filtered up to this full-size pixel: a full-size pixel's centre is half a
// half-size texel's coordinate.
@fragment
fn upsample_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    let uv = p.xy * 0.5 / vec2<f32>(textureDimensions(half_target));
    return textureSampleLevel(half_target, half_sampler, uv, 0.0);
}

fn shade(in: Out, at: vec2<f32>) -> vec4<f32> {
    let r2 = dot(at, at);
    if r2 > 1.0 {
        discard;
    }
    let l = clamp(in.life, 0.0, 1.0);
    var shape = (1.0 - r2) * (1.0 - r2);
    if draw.kind.x == 1.0 {
        // A spark: a hard bright core.
        shape = exp(-12.0 * r2);
    } else if draw.kind.x == 2.0 {
        // A puff: a wide soft gaussian, faint.
        shape = 0.35 * exp(-3.0 * r2);
    } else if draw.kind.x >= 3.0 {
        // A streak or a ribbon: soft across, full along.
        shape = (1.0 - at.y * at.y) * in.alpha;
    }
    let fade = mix(draw.life.z, draw.life.w, l) * (1.0 - l);
    return vec4<f32>(color_at(l) * shape * fade * draw.view.w, 0.0);
}
