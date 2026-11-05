// Issue #386: line marks 1 device px or thinner and objects' outlines, drawn into the slot after
// the upscale and sharpen at display size, each fragment depth-tested against the core's depth
// target. Joined to output.wgsl, whose `finish` a line's color goes through; a status outline
// draws its color exact.

struct LineFrame {
    clip: mat4x4<f32>,
    right: vec4<f32>,
    up: vec4<f32>,
    viewport: vec4<f32>,
    light: vec4<f32>,
    px: vec4<f32>,
};

@group(1) @binding(0) var<uniform> line_frame: LineFrame;
@group(1) @binding(1) var core_depth: texture_depth_2d;

// A record's flags: its width is in m; its color is a status color, drawn exact; it isn't
// depth-tested (the planted status_without_depth); it's an object's outline, which draws at any
// width, where a layer's line draws here only when 1 device px or thinner.
const WORLD: u32 = 1u;
const EXACT: u32 = 2u;
const UNTESTED: u32 = 4u;
const OUTLINED: u32 = 8u;

struct OutlineOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) @interpolate(flat) a: vec2<f32>,
    @location(1) @interpolate(flat) b: vec2<f32>,
    @location(2) @interpolate(flat) r: vec2<f32>,
    @location(3) @interpolate(flat) alpha: vec2<f32>,
    @location(4) @interpolate(flat) color: u32,
    @location(5) @interpolate(flat) flags: u32,
};

fn line_px(c: vec4<f32>) -> vec2<f32> {
    let ndc = c.xy / c.w;
    let v = line_frame.viewport;
    return vec2<f32>((ndc.x * 0.5 + 0.5) * v.x, (0.5 - ndc.y * 0.5) * v.y);
}

fn line_clip(p: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let v = line_frame.viewport;
    let ndc = vec2<f32>(p.x / v.x * 2.0 - 1.0, 1.0 - p.y / v.y * 2.0);
    return vec4<f32>(ndc * c.w, c.z, c.w);
}

fn line_px_per_m(c: vec4<f32>) -> f32 {
    return select(line_frame.viewport.z, line_frame.viewport.z / c.w, line_frame.viewport.w > 0.5);
}

const AWAY: vec4<f32> = vec4<f32>(2.0, 2.0, 2.0, 1.0);

@vertex
fn outline_vs(
    @builtin(vertex_index) vi: u32,
    @location(0) a: vec4<f32>,
    @location(1) b: vec4<f32>,
    @location(2) color: u32,
    @location(3) pick: u32,
    @location(4) flags: u32,
) -> OutlineOut {
    var out: OutlineOut;
    let ca = line_frame.clip * vec4<f32>(a.xyz, 1.0);
    let cb = line_frame.clip * vec4<f32>(b.xyz, 1.0);
    out.color = color;
    out.flags = flags;
    if ca.w <= 0.0 || cb.w <= 0.0 {
        out.pos = AWAY;
        return out;
    }
    let pa = line_px(ca);
    let pb = line_px(cb);
    var w = vec2<f32>(a.w, b.w) * line_frame.px.x;
    if (flags & WORLD) != 0u {
        w = vec2<f32>(a.w * line_px_per_m(ca), b.w * line_px_per_m(cb));
    }
    // A layer's lines: only those 1 device px or thinner draw here.
    if (flags & OUTLINED) == 0u && max(w.x, w.y) > line_frame.px.x {
        out.pos = AWAY;
        return out;
    }
    out.alpha = min(w, vec2<f32>(1.0));
    out.r = max(w, vec2<f32>(1.0)) * 0.5;
    out.a = pa;
    out.b = pb;
    let reach = max(out.r.x, out.r.y) + 1.0;
    let d = pb - pa;
    let len = length(d);
    var dir = vec2<f32>(1.0, 0.0);
    if len > 1e-6 {
        dir = d / len;
    }
    let nrm = vec2<f32>(-dir.y, dir.x);
    let corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
        vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
    );
    let k = corners[vi];
    let end = select(pa - dir * reach, pb + dir * reach, k.x > 0.5);
    let side = select(-reach, reach, k.y > 0.5);
    out.pos = line_clip(end + nrm * side, select(ca, cb, k.x > 0.5));
    return out;
}

// Whether the core's depth target holds something nearer than `z` (reversed Z: larger is nearer)
// over the texels this pixel falls between: the farthest of them decides, so a line along an
// object's silhouette shows over what's behind it.
fn hidden(p: vec2<f32>, z: f32) -> bool {
    let dims = vec2<i32>(textureDimensions(core_depth));
    let q = p * line_frame.px.z - 0.5;
    let i = vec2<i32>(floor(q));
    var far = 1.0;
    for (var y = 0; y < 2; y++) {
        for (var x = 0; x < 2; x++) {
            let t = clamp(i + vec2<i32>(x, y), vec2<i32>(0), dims - 1);
            far = min(far, textureLoad(core_depth, t, 0));
        }
    }
    if line_frame.px.w > 0.5 {
        // The planted forward Z: smaller is nearer.
        var near = 0.0;
        for (var y = 0; y < 2; y++) {
            for (var x = 0; x < 2; x++) {
                let t = clamp(i + vec2<i32>(x, y), vec2<i32>(0), dims - 1);
                near = max(near, textureLoad(core_depth, t, 0));
            }
        }
        return z > near * 1.005 + 1e-6;
    }
    return z < far * 0.995 - 1e-7;
}

@fragment
fn outline_fs(in: OutlineOut) -> @location(0) vec4<f32> {
    let p = in.pos.xy;
    let d = in.b - in.a;
    let l2 = dot(d, d);
    var t = 0.0;
    if l2 > 1e-12 {
        t = clamp(dot(p - in.a, d) / l2, 0.0, 1.0);
    }
    let dist = length(p - (in.a + d * t));
    let cov = clamp(mix(in.r.x, in.r.y, t) + 0.5 - dist, 0.0, 1.0);
    if cov <= 0.0 {
        discard;
    }
    if (in.flags & UNTESTED) == 0u && hidden(p, in.pos.z) {
        discard;
    }
    let alpha = cov * mix(in.alpha.x, in.alpha.y, t);
    let c = unpack4x8unorm(in.color).rgb;
    var shown = c;
    if (in.flags & EXACT) == 0u {
        let lo = c / 12.92;
        let hi = pow((c + 0.055) / 1.055, vec3<f32>(2.4));
        shown = finish(select(hi, lo, c <= vec3<f32>(0.04045)));
    }
    return vec4<f32>(shown * alpha, alpha);
}
