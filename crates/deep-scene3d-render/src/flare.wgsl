// #465: Effect: flare. From lights, `visible` measures each source's share of its projected disc
// the frame's depth shows unoccluded (one reduction, a workgroup per source); from emissive pixels,
// `tiles` sums each tile's pixels at or above the level and `pick` keeps the brightest 16 tiles as
// the sources, each at its pixels' light-weighted centroid (one reduction). Then one
// instanced draw adds each source's halo, streak arms, starburst spikes and ghosts into the linear
// target before tone mapping, each a quad over just the pixels it reaches, scaled by that share
// and by the share of its fade disc inside the frame. Nothing reads an earlier frame, so seeking
// equals playing.

const LN100: f32 = 4.605170186;

struct Source {
    // xy: projected point in frame px; z: the projected disc's radius in px; w: its depth as the
    // depth target stores it.
    at: vec4<f32>,
    // rgb: the flare's linear color at unit shape (the source's exposed radiance × its disc's
    // area × intensity × tint); w: the share of its fade disc (the halo's grown by its own)
    // inside the frame.
    color: vec4<f32>,
}

struct Params {
    // x, y: the frame's size in px; z: sources; w: ghosts.
    frame: vec4<f32>,
    // x: streak arms; y: streak length in px; z: anamorphic (1) or not; w: starburst spikes.
    streak: vec4<f32>,
    // x: the halo's radius in px; y: the depth test's sense (1: depth grows nearer); z: the
    // planted occlusion-blind flare (1); w: the planted fixed ghosts (1).
    halo: vec4<f32>,
    // x: the emissive level's luminance; y: 1 when the sources are emissive pixels; z: their
    // light's scale (exposure × intensity × the flare's gain).
    emissive: vec4<f32>,
    // rgb: the tint, linear.
    tint: vec4<f32>,
    sources: array<Source, 16>,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var depth: texture_depth_2d;
@group(0) @binding(2) var<storage, read_write> shares: array<atomic<u32>, 32>;

// Each source's disc, a 16 × 16 grid over its bounding square: the samples inside the disc and
// inside the frame, and those whose depth isn't nearer than the source's.
@compute @workgroup_size(16, 16)
fn visible(@builtin(workgroup_id) g: vec3<u32>, @builtin(local_invocation_id) l: vec3<u32>) {
    let k = g.x;
    if k >= u32(params.frame.z) {
        return;
    }
    let s = params.sources[k];
    let o = (vec2<f32>(l.xy) + 0.5) / 16.0 * 2.0 - 1.0;
    if dot(o, o) > 1.0 {
        return;
    }
    let p = s.at.xy + o * s.at.z;
    let size = params.frame.xy;
    if p.x < 0.0 || p.y < 0.0 || p.x >= size.x || p.y >= size.y {
        return;
    }
    atomicAdd(&shares[2u * k], 1u);
    let d = textureLoad(depth, vec2<i32>(p), 0);
    let nearer = select((d < s.at.w), (d > s.at.w), params.halo.y > 0.5);
    if !nearer || params.halo.z > 0.5 {
        atomicAdd(&shares[2u * k + 1u], 1u);
    }
}

// The emissive pixels' reduction: the linear image, each tile's sums, and the sources it finds.
@group(0) @binding(4) var<storage, read_write> found_rw: array<Source, 16>;
@group(0) @binding(5) var image: texture_2d<f32>;
@group(0) @binding(6) var<storage, read_write> tiles: array<vec4<f32>, 288>;

const TILES: vec2<u32> = vec2<u32>(16u, 9u);
var<workgroup> rgbn: array<vec4<f32>, 256>;
var<workgroup> lxy: array<vec4<f32>, 256>;

// One tile of the frame (a 16 × 9 grid), a workgroup each: the sum of its pixels' linear color and
// their count, and of their luminance and luminance-weighted position, over pixels at the level.
@compute @workgroup_size(16, 16)
fn emitted(@builtin(workgroup_id) g: vec3<u32>, @builtin(local_invocation_index) li: u32) {
    let size = vec2<u32>(params.frame.xy);
    let span = (size + TILES - 1u) / TILES;
    let lo = g.xy * span;
    let hi = min(lo + span, size);
    var a = vec4<f32>(0.0);
    var b = vec4<f32>(0.0);
    for (var y = lo.y + li / 16u; y < hi.y; y += 16u) {
        for (var x = lo.x + li % 16u; x < hi.x; x += 16u) {
            let c = textureLoad(image, vec2<i32>(vec2<u32>(x, y)), 0).rgb;
            let l = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
            if l >= params.emissive.x {
                a += vec4<f32>(c, 1.0);
                b += vec4<f32>(l, l * (f32(x) + 0.5), l * (f32(y) + 0.5), 0.0);
            }
        }
    }
    rgbn[li] = a;
    lxy[li] = b;
    workgroupBarrier();
    for (var step = 128u; step > 0u; step >>= 1u) {
        if li < step {
            rgbn[li] += rgbn[li + step];
            lxy[li] += lxy[li + step];
        }
        workgroupBarrier();
    }
    if li == 0u {
        let t = g.y * TILES.x + g.x;
        tiles[2u * t] = rgbn[0];
        tiles[2u * t + 1u] = lxy[0];
    }
}

// The brightest 16 tiles as the sources, brightest first; a tile with nothing at the level adds
// no light.
@compute @workgroup_size(1)
fn pick() {
    var taken: array<bool, 144>;
    for (var k = 0u; k < 16u; k++) {
        var best = 0u;
        var most = -1.0;
        for (var t = 0u; t < 144u; t++) {
            let l = tiles[2u * t + 1u].x;
            if !taken[t] && l > most {
                most = l;
                best = t;
            }
        }
        taken[best] = true;
        let a = tiles[2u * best];
        let b = tiles[2u * best + 1u];
        var s: Source;
        if b.x > 0.0 {
            s.at = vec4<f32>(b.y / b.x, b.z / b.x, sqrt(a.w / 3.14159265), 0.0);
            s.color = vec4<f32>(a.rgb * params.emissive.z * params.tint.rgb, 1.0);
        }
        found_rw[k] = s;
    }
}

@group(0) @binding(3) var<storage, read> counted: array<u32, 32>;
@group(0) @binding(7) var<storage, read> found: array<Source, 16>;

fn source(k: u32) -> Source {
    if params.emissive.y > 0.5 {
        return found[k];
    }
    return params.sources[k];
}

// A source's components, one instance each: the halo, six arms, 32 spikes, eight ghosts.
const PER_SOURCE: u32 = 47u;
const ARM0: u32 = 1u;
const SPIKE0: u32 = 7u;
const GHOST0: u32 = 39u;
// Where an arm or spike starts from its source: it rises over this many px, so arms meeting at
// the source never stack, and each arm's peak is its own.
const RISE: f32 = 10.0;

// A ghost's place along the line through the source and the frame's centre (1 at the source, 0 at
// the centre), its radius as a share of the frame's height, and its weight.
const GHOSTS = array<vec3<f32>, 8>(
    vec3<f32>(-0.45, 0.060, 0.30),
    vec3<f32>(-1.10, 0.110, 0.20),
    vec3<f32>(0.35, 0.035, 0.25),
    vec3<f32>(-0.20, 0.025, 0.35),
    vec3<f32>(-0.75, 0.080, 0.15),
    vec3<f32>(0.60, 0.050, 0.20),
    vec3<f32>(-1.50, 0.140, 0.10),
    vec3<f32>(-0.05, 0.018, 0.40),
);

struct Drawn {
    @builtin(position) at: vec4<f32>,
    // The source and the component.
    @location(0) @interpolate(flat) which: vec2<u32>,
    // The source's weight: its unoccluded share times its fade disc's share inside the frame.
    @location(1) @interpolate(flat) weight: f32,
}

fn share(k: u32) -> f32 {
    let total = counted[2u * k];
    return select(f32(counted[2u * k + 1u]) / f32(max(total, 1u)), 1.0, total == 0u);
}

// An arm's or spike's direction: arms at equal angles from 0°, spikes from 90°.
fn direction(c: u32) -> vec2<f32> {
    var t = 0.0;
    if c < SPIKE0 {
        t = 6.28318531 * f32(c - ARM0) / params.streak.x;
    } else {
        t = 1.57079633 + 6.28318531 * f32(c - SPIKE0) / params.streak.w;
    }
    return vec2<f32>(cos(t), -sin(t));
}

fn ghost_at(g: u32, source: vec2<f32>) -> vec2<f32> {
    let centre = params.frame.xy * 0.5;
    if params.halo.w > 0.5 {
        return centre + GHOSTS[g].x * vec2<f32>(0.25 * params.frame.x, 0.0);
    }
    return centre + GHOSTS[g].x * (source - centre);
}

// An arm's length and its Gaussian's width across, in px.
fn reach(c: u32) -> vec2<f32> {
    if c < SPIKE0 {
        return vec2<f32>(params.streak.y, select(2.5, 0.7, params.streak.z > 0.5));
    }
    return vec2<f32>(0.25 * params.frame.y, 1.0);
}

@vertex
fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Drawn {
    var out: Drawn;
    let k = i / PER_SOURCE;
    let c = i % PER_SOURCE;
    out.which = vec2<u32>(k, c);
    out.at = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    let s = source(k);
    out.weight = share(k) * s.color.w;
    let on = (c == 0u && params.halo.x > 0.0)
        || (c >= ARM0 && c < SPIKE0 && c - ARM0 < u32(params.streak.x) && params.streak.y > RISE)
        || (c >= SPIKE0 && c < GHOST0 && c - SPIKE0 < u32(params.streak.w))
        || (c >= GHOST0 && c - GHOST0 < u32(params.frame.w));
    if !on || out.weight <= 0.0 {
        return out;
    }
    let corners = array<vec2<f32>, 6>(vec2(0.0, 0.0), vec2(1.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 0.0), vec2(1.0, 1.0), vec2(0.0, 1.0));
    let q = corners[v];
    var p = vec2<f32>(0.0);
    if c == 0u {
        let r = params.halo.x * 1.5;
        p = s.at.xy + (q * 2.0 - 1.0) * r;
    } else if c < GHOST0 {
        let dir = direction(c);
        let side = vec2<f32>(-dir.y, dir.x);
        let rs = reach(c);
        // Past 1.6 × its length an arm is below a thousandth of its peak.
        p = s.at.xy + dir * mix(-2.0, 1.6 * rs.x, q.x) + side * (q.y * 2.0 - 1.0) * (4.0 * rs.y + 1.0);
    } else {
        let g = c - GHOST0;
        p = ghost_at(g, s.at.xy) + (q * 2.0 - 1.0) * (GHOSTS[g].y * params.frame.y + 1.0);
    }
    out.at = vec4<f32>(p.x / params.frame.x * 2.0 - 1.0, 1.0 - p.y / params.frame.y * 2.0, 0.0, 1.0);
    return out;
}

// A soft disc of radius r: 1 inside, falling to 0 over its last fifth, normalized to unit area.
fn disc(d: f32, r: f32) -> f32 {
    let edge = 1.0 - smoothstep(0.8 * r, r, d);
    return edge / (0.82 * 3.14159265 * r * r);
}

// An arm along unit `dir`: rising over RISE px, then exp falling to 1% of that at `len`, a Gaussian
// of `sigma` px across, normalized to about unit area.
fn arm(d: vec2<f32>, dir: vec2<f32>, len: f32, sigma: f32) -> f32 {
    let along = dot(d, dir);
    let across = d.x * dir.y - d.y * dir.x;
    let rise = smoothstep(0.0, RISE, along);
    let fall = exp(-LN100 * max(along - RISE, 0.0) / (len - RISE));
    let cross = exp(-across * across / (2.0 * sigma * sigma));
    return rise * fall * cross / ((len - RISE) / LN100 * sigma * 2.5066283);
}

@fragment
fn fs(in: Drawn) -> @location(0) vec4<f32> {
    let k = in.which.x;
    let c = in.which.y;
    let s = source(k);
    let d = in.at.xy - s.at.xy;
    var shape = 0.0;
    if c == 0u {
        // The halo: a soft ring at its radius, a tenth of it wide.
        let r = params.halo.x;
        let ring = (length(d) - r) / (0.1 * r);
        shape = 0.25 * exp(-ring * ring) / (2.0 * 3.14159265 * r * 0.1 * r * 1.7725);
    } else if c < SPIKE0 {
        let rs = reach(c);
        shape = 0.25 / params.streak.x * arm(d, direction(c), rs.x, rs.y);
    } else if c < GHOST0 {
        let rs = reach(c);
        shape = 0.1 / params.streak.w * arm(d, direction(c), rs.x, rs.y);
    } else {
        let g = c - GHOST0;
        shape = GHOSTS[g].z * disc(length(in.at.xy - ghost_at(g, s.at.xy)), GHOSTS[g].y * params.frame.y);
    }
    return vec4<f32>(s.color.rgb * in.weight * shape, 0.0);
}
