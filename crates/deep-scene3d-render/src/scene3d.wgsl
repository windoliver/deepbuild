// Issue #378: scene3d's draws into the linear and object-ID targets, and the output pass.
// Pixels are y down from the top left; a fragment's position is its pixel centre.

struct Frame {
    clip: mat4x4<f32>,
    right: vec4<f32>,
    up: vec4<f32>,
    // width, height, the focal length in px (perspective) or px per m, and 1 for perspective.
    viewport: vec4<f32>,
    light: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;

struct Targets {
    @location(0) color: vec4<f32>,
    @location(1) id: u32,
};

fn srgb_decode(c: vec3<f32>) -> vec3<f32> {
    let lo = c / 12.92;
    let hi = pow((c + 0.055) / 1.055, vec3<f32>(2.4));
    return select(hi, lo, c <= vec3<f32>(0.04045));
}

fn paint(color: u32) -> vec3<f32> {
    return srgb_decode(unpack4x8unorm(color).rgb);
}

fn to_px(c: vec4<f32>) -> vec2<f32> {
    let ndc = c.xy / c.w;
    return vec2<f32>((ndc.x * 0.5 + 0.5) * frame.viewport.x, (0.5 - ndc.y * 0.5) * frame.viewport.y);
}

// A pixel position back to clip space at the depth and w of `c`.
fn from_px(p: vec2<f32>, c: vec4<f32>) -> vec4<f32> {
    let ndc = vec2<f32>(p.x / frame.viewport.x * 2.0 - 1.0, 1.0 - p.y / frame.viewport.y * 2.0);
    return vec4<f32>(ndc * c.w, c.z, c.w);
}

fn px_per_m(c: vec4<f32>) -> f32 {
    if frame.viewport.w > 0.5 {
        return frame.viewport.z / c.w;
    }
    return frame.viewport.z;
}

// The quad's corner for vertex `vi` of two triangles: (0 or 1, 0 or 1).
fn corner(vi: u32) -> vec2<f32> {
    var c = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
        vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
    );
    return c[vi];
}

const OFF: vec4<f32> = vec4<f32>(2.0, 2.0, 2.0, 1.0);

// ---- objects: unit meshes under their instance's 3×4 world matrix

struct MeshOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) @interpolate(flat) color: u32,
    @location(2) @interpolate(flat) pick: u32,
};

@vertex
fn mesh_vs(
    @location(0) p: vec3<f32>,
    @location(1) n: vec3<f32>,
    @location(2) r0: vec4<f32>,
    @location(3) r1: vec4<f32>,
    @location(4) r2: vec4<f32>,
    @location(5) color: u32,
    @location(6) pick: u32,
) -> MeshOut {
    var out: MeshOut;
    let world = vec3<f32>(dot(r0.xyz, p) + r0.w, dot(r1.xyz, p) + r1.w, dot(r2.xyz, p) + r2.w);
    out.pos = frame.clip * vec4<f32>(world, 1.0);
    out.normal = vec3<f32>(dot(r0.xyz, n), dot(r1.xyz, n), dot(r2.xyz, n));
    out.color = color;
    out.pick = pick;
    return out;
}

@fragment
fn mesh_fs(in: MeshOut) -> Targets {
    let n = normalize(in.normal);
    let facing = max(dot(n, frame.light.xyz), 0.0);
    // A sun (w > 0) lights by its illuminance over an ambient quarter; with none, the view's own
    // key light.
    let lit = select(0.45 + 0.55 * facing, 0.25 + 0.75 * frame.light.w * facing, frame.light.w > 0.0);
    return Targets(vec4<f32>(paint(in.color) * lit, 1.0), in.pick);
}

// ---- lines: one instanced quad per segment, its width and caps in the fragment

struct LineOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) @interpolate(flat) a: vec2<f32>,
    @location(1) @interpolate(flat) b: vec2<f32>,
    @location(2) @interpolate(flat) r: vec2<f32>,
    @location(3) @interpolate(flat) alpha: vec2<f32>,
    @location(4) @interpolate(flat) color: u32,
    @location(5) @interpolate(flat) pick: u32,
};

@vertex
fn line_vs(
    @builtin(vertex_index) vi: u32,
    @location(0) a: vec4<f32>,
    @location(1) b: vec4<f32>,
    @location(2) color: u32,
    @location(3) pick: u32,
    @location(4) flags: u32,
) -> LineOut {
    var out: LineOut;
    let ca = frame.clip * vec4<f32>(a.xyz, 1.0);
    let cb = frame.clip * vec4<f32>(b.xyz, 1.0);
    out.color = color;
    out.pick = pick;
    if ca.w <= 0.0 || cb.w <= 0.0 {
        out.pos = OFF;
        return out;
    }
    let pa = to_px(ca);
    let pb = to_px(cb);
    var w = vec2<f32>(a.w, b.w);
    if (flags & 1u) != 0u {
        w = w * vec2<f32>(px_per_m(ca), px_per_m(cb));
    }
    // A width under one device px draws at one px, its alpha scaled by the width.
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
    let k = corner(vi);
    let end = select(pa - dir * reach, pb + dir * reach, k.x > 0.5);
    let side = select(-reach, reach, k.y > 0.5);
    out.pos = from_px(end + nrm * side, select(ca, cb, k.x > 0.5));
    return out;
}

@fragment
fn line_fs(in: LineOut) -> Targets {
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
    let alpha = cov * mix(in.alpha.x, in.alpha.y, t);
    return Targets(vec4<f32>(paint(in.color) * alpha, alpha), select(0u, in.pick, cov >= 0.5));
}

// ---- points: a disc, square or diamond in px or m about the point's projection

struct PointOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) @interpolate(flat) c: vec2<f32>,
    @location(1) @interpolate(flat) r: f32,
    @location(2) @interpolate(flat) color: u32,
    @location(3) @interpolate(flat) pick: u32,
    @location(4) @interpolate(flat) shape: u32,
};

@vertex
fn point_vs(
    @builtin(vertex_index) vi: u32,
    @location(0) p: vec4<f32>,
    @location(1) color: u32,
    @location(2) pick: u32,
    @location(3) flags: u32,
) -> PointOut {
    var out: PointOut;
    let c = frame.clip * vec4<f32>(p.xyz, 1.0);
    out.color = color;
    out.pick = pick;
    out.shape = (flags >> 1u) & 3u;
    if c.w <= 0.0 {
        out.pos = OFF;
        return out;
    }
    var size = p.w;
    if (flags & 1u) != 0u {
        size = size * px_per_m(c);
    }
    out.c = to_px(c);
    out.r = size * 0.5;
    let k = corner(vi) * 2.0 - 1.0;
    out.pos = from_px(out.c + k * (out.r + 1.0), c);
    return out;
}

@fragment
fn point_fs(in: PointOut) -> Targets {
    let q = in.pos.xy - in.c;
    var dist = length(q);
    if in.shape == 1u {
        dist = max(abs(q.x), abs(q.y));
    } else if in.shape == 2u {
        dist = (abs(q.x) + abs(q.y)) * 0.70710678;
    }
    let cov = clamp(in.r + 0.5 - dist, 0.0, 1.0);
    if cov <= 0.0 {
        discard;
    }
    return Targets(vec4<f32>(paint(in.color) * cov, cov), select(0u, in.pick, cov >= 0.5));
}

// ---- labels: a quad per glyph from the core's glyph atlas, in a label that faces the camera,
// stays upright or keeps its axes

@group(1) @binding(0) var atlas: texture_2d_array<f32>;
@group(1) @binding(1) var atlas_sampler: sampler;

struct TextOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) @interpolate(flat) color: u32,
    @location(2) @interpolate(flat) pick: u32,
    @location(3) @interpolate(flat) page: u32,
};

@vertex
fn text_vs(
    @builtin(vertex_index) vi: u32,
    @location(0) p: vec4<f32>,
    @location(1) rect: vec4<f32>,
    @location(2) uv: vec4<f32>,
    @location(3) ax_r: vec4<f32>,
    @location(4) ax_u: vec4<f32>,
    @location(5) color: u32,
    @location(6) pick: u32,
    @location(7) flags: u32,
) -> TextOut {
    var out: TextOut;
    let k = corner(vi);
    out.uv = mix(uv.xy, uv.zw, k);
    out.color = color;
    out.pick = pick;
    out.page = flags >> 3u;
    let c = frame.clip * vec4<f32>(p.xyz, 1.0);
    if c.w <= 0.0 {
        out.pos = OFF;
        return out;
    }
    // The glyph's corner from the label's centre, in its size space: x right, y down.
    let offset = (rect.xy + k * rect.zw) * p.w;
    if (flags & 1u) == 0u {
        // In px: the label stays its size on screen about its projection.
        out.pos = from_px(to_px(c) + offset, c);
        return out;
    }
    let facing = (flags >> 1u) & 3u;
    var right = frame.right.xyz;
    var up = frame.up.xyz;
    if facing == 1u {
        let flat_right = vec3<f32>(frame.right.x, 0.0, frame.right.z);
        right = select(vec3<f32>(1.0, 0.0, 0.0), normalize(flat_right), dot(flat_right, flat_right) > 1e-12);
        up = vec3<f32>(0.0, 1.0, 0.0);
    } else if facing == 2u {
        right = ax_r.xyz;
        up = ax_u.xyz;
    }
    out.pos = frame.clip * vec4<f32>(p.xyz + right * offset.x - up * offset.y, 1.0);
    return out;
}

@fragment
fn text_fs(in: TextOut) -> Targets {
    let a = textureSample(atlas, atlas_sampler, in.uv, in.page).r;
    if a <= 0.002 {
        discard;
    }
    return Targets(vec4<f32>(paint(in.color) * a, a), select(0u, in.pick, a >= 0.5));
}
