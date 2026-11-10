// #166: Material: water. Two steps after the geometry and the mirror's view:
//
// 1. `mesh_vs` / `ids_fs`: each water part's rest mesh, moved in the vertex stage by up to four
//    trochoidal waves in closed form of rest position and t, drawn into the geometry pass's
//    multisampled object-ID and depth targets as any solid is, its depth the surface's at the
//    pixel's centre; the IDs and depth are then resolved again.
// 2. `full_vs` / `shade_fs`: at each pixel whose resolved ID is a water part, the rest point under
//    the surface there, the normal bent by the waves, the ripples' seeded noise, the rain's rings
//    and the wake; the bed behind it from copies of the opaque scene's color and depth, tinted by
//    exp(−d ÷ depth) toward the absorption color; and the mirror's picture, its lookup moved along
//    the bent normal by up to `distort` px, mixed in by Fresnel times the mirror's strength.
//
// Every term is a function of t and the seed; nothing is read from an earlier frame.

struct Params {
    clip: mat4x4<f32>,
    // The inverse of `clip`, from the depth target's NDC back to the world.
    unclip: mat4x4<f32>,
    // The drawn part's model, rows.
    model: array<vec4<f32>, 3>,
    // xyz: the eye; w: t in s.
    eye: vec4<f32>,
    // Each wave: its heading (x, z), k and ω; then its amplitude and steepness.
    dirs: array<vec4<f32>, 4>,
    amps: array<vec4<f32>, 4>,
    // x: how many waves; y: the ripples' scale in m; z: their strength; w: the slots a ring lives
    // back.
    counts: vec4<f32>,
    // xy: the ripples' drift in m/s (x, z); z: rain drops per m² per s; w: the rain's cell in m.
    drift: vec4<f32>,
    // rgb: the absorption color, linear; w: its depth in m.
    absorption: vec4<f32>,
    // x: distort in px; y: foam's threshold; z: 2 × the camera's centre x ÷ the width (the
    // mirror's flip); w: the mirror's strength (0 with none).
    look: vec4<f32>,
    // xyz: toward the sun; w: its radiance off a white surface facing it (E ÷ π).
    sun: vec4<f32>,
    // rgb: the sky's ambient radiance; w: the rain's slot in s.
    ambient: vec4<f32>,
    // x: the wake's points; y: their spacing in s; z: its span in s; w: the planted foam.
    wake: vec4<f32>,
    // x: the drawn part's pick ID; y: depth grows nearer (1) or not; z: the seed; w: how many
    // part IDs `parts` holds.
    pick: vec4<u32>,
    parts: array<vec4<u32>, 2>,
    // #268: the shore's field. [0]: its origin (x, z), 1 ÷ cell and the outline distance's reach;
    // [1]: foam's width, strength and breakup, and shade; [2]: calm's near and far, the
    // footprint's reach, and 1 when the water has a shore.
    shore: array<vec4<f32>, 3>,
    // Its cells along x and z, and the planted calm that ignores it.
    shore_dims: vec4<u32>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var bed_color: texture_2d<f32>;
// The bed's depth, as the depth target held it before the water (`bed_fs` copies it).
@group(0) @binding(2) var bed_depth: texture_2d<f32>;
@group(0) @binding(3) var picture: texture_2d<f32>;
@group(0) @binding(4) var filtered: sampler;
@group(0) @binding(5) var<storage, read> path: array<vec2<f32>>;
// #166's planted foam: a running value kept from frame to frame.
@group(0) @binding(6) var<storage, read_write> kept: array<f32>;
@group(0) @binding(7) var ids: texture_2d<u32>;
@group(0) @binding(8) var depth: texture_depth_2d;
// #268: the shore's field, a cell a texel: the outline's distance in the low 16 bits over its
// reach, the footprint's signed distance in the high 16, offset by half.
@group(0) @binding(9) var field: texture_2d<u32>;
// Each sample's ID and depth, for the pixels on a water edge (water.rs reads them as plain
// textures at one sample).
@group(2) @binding(0) var ids_ms: texture_multisampled_2d<u32>;
@group(2) @binding(1) var depth_ms: texture_depth_multisampled_2d;
const SAMPLES: i32 = 4;

struct Waved {
    offset: vec3<f32>,
    // The surface's tangents along rest x and rest z.
    tx: vec3<f32>,
    tz: vec3<f32>,
    // The horizontal map's compression at a crest: 0 flat, 1 at a cusp.
    steep: f32,
};

// #268: the shore's field at a point on the water at rest, bilinear over the cells' centres:
// the distance to the nearest outline where an item meets the water, and the signed distance to
// the footprint of what stands above it (negative under it).
struct Shore {
    d: f32,
    c: f32,
};

fn shore_cell(i: vec2<i32>) -> vec2<f32> {
    let n = vec2<i32>(params.shore_dims.xy) - 1;
    let v = textureLoad(field, clamp(i, vec2<i32>(0), n), 0).r;
    return vec2<f32>(
        f32(v & 0xffffu) / 65535.0 * params.shore[0].w,
        (f32(v >> 16u) / 65535.0 - 0.5) * 2.0 * params.shore[2].z,
    );
}

fn shore_at(x: vec2<f32>) -> Shore {
    let g = (x - params.shore[0].xy) * params.shore[0].z - 0.5;
    let i = vec2<i32>(floor(g));
    let f = g - floor(g);
    let v = mix(
        mix(shore_cell(i), shore_cell(i + vec2<i32>(1, 0)), f.x),
        mix(shore_cell(i + vec2<i32>(0, 1)), shore_cell(i + vec2<i32>(1, 1)), f.x),
        f.y,
    );
    return Shore(v.x, v.y);
}

// Each wave's amplitude's share at a distance d from the shore: mix(near, 1, smoothstep(0, far,
// d)), 1 with no shore.
fn calm(d: f32) -> f32 {
    if params.shore[2].w < 0.5 || params.shore_dims.z == 1u {
        return 1.0;
    }
    return mix(params.shore[2].x, 1.0, smoothstep(0.0, params.shore[2].y, d));
}

fn calm_at(x: vec2<f32>) -> f32 {
    if params.shore[2].w < 0.5 {
        return 1.0;
    }
    return calm(shore_at(x).d);
}

// The waves at rest point x and t, each amplitude scaled by `scale` (the shore's calm).
fn waves_scaled(x: vec2<f32>, t: f32, scale: f32) -> Waved {
    var w: Waved;
    w.offset = vec3<f32>(0.0);
    w.tx = vec3<f32>(1.0, 0.0, 0.0);
    w.tz = vec3<f32>(0.0, 0.0, 1.0);
    w.steep = 0.0;
    let n = u32(params.counts.x);
    for (var i = 0u; i < n; i++) {
        let d = params.dirs[i].xy;
        let k = params.dirs[i].z;
        let omega = params.dirs[i].w;
        let a = params.amps[i].x * scale;
        let s = params.amps[i].y;
        let th = k * dot(d, x) - omega * t;
        let c = cos(th);
        let sn = sin(th);
        // Lifted by A cos θ, moved by −s A sin θ along its heading.
        w.offset += vec3<f32>(-s * a * d.x * sn, a * c, -s * a * d.y * sn);
        let ka = k * a;
        w.tx += vec3<f32>(-s * ka * d.x * d.x * c, -ka * d.x * sn, -s * ka * d.x * d.y * c);
        w.tz += vec3<f32>(-s * ka * d.x * d.y * c, -ka * d.y * sn, -s * ka * d.y * d.y * c);
        w.steep += s * ka * max(c, 0.0);
    }
    return w;
}

struct MeshOut {
    @builtin(position) pos: vec4<f32>,
    // The clip z and w at a sample the triangle covers (the pixel's centre when it covers that).
    @location(0) @interpolate(perspective, centroid) zw: vec2<f32>,
};

@vertex
fn mesh_vs(@location(0) p: vec3<f32>) -> MeshOut {
    let world0 = vec3<f32>(
        dot(params.model[0], vec4<f32>(p, 1.0)),
        dot(params.model[1], vec4<f32>(p, 1.0)),
        dot(params.model[2], vec4<f32>(p, 1.0)),
    );
    let w = waves_scaled(world0.xz, params.eye.w, calm_at(world0.xz));
    var o: MeshOut;
    o.pos = params.clip * vec4<f32>(world0 + w.offset, 1.0);
    o.zw = o.pos.zw;
    return o;
}

struct Ids {
    @location(0) id: vec2<u32>,
    // The surface's depth at the pixel's centre, for every sample it covers.
    @builtin(frag_depth) depth: f32,
};

@fragment
fn ids_fs(in: MeshOut) -> Ids {
    let id = params.pick.x;
    // A triangle that covers a sample but not the centre, seen edge-on, would carry its plane far
    // from the surface to reach the centre: past 0.5% of the depth, its depth is the one at a
    // sample it covers.
    let inside = in.zw.x / in.zw.y;
    let off = abs(in.pos.z - inside) > 0.005 * max(abs(inside), 1e-6);
    return Ids(vec2<u32>(id & 0xffffu, id >> 16u), select(in.pos.z, inside, off));
}

@vertex
fn full_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(uv * 2.0 - 1.0, 0.0, 1.0);
}

// The rain's hash (water.rs's `hash`, bit for bit).
fn hash(a: u32) -> u32 {
    var h = a * 0x9e3779b9u;
    h = (h ^ (h >> 16u)) * 0x7feb352du;
    h = (h ^ (h >> 15u)) * 0x846ca68bu;
    return h ^ (h >> 16u);
}

fn hash3(x: i32, y: i32, z: u32) -> u32 {
    return hash(bitcast<u32>(x) ^ hash(bitcast<u32>(y) ^ hash(z ^ params.pick.z)));
}

fn unit(h: u32) -> f32 {
    return f32(h >> 8u) / 16777216.0;
}

// Value noise's gradient at p, by the seed: what the ripples bend the normal by.
fn noise_grad(p: vec2<f32>) -> vec2<f32> {
    let i = floor(p);
    let f = p - i;
    let u = f * f * (3.0 - 2.0 * f);
    let du = 6.0 * f * (1.0 - f);
    let c = vec2<i32>(i);
    let a = unit(hash3(c.x, c.y, 0x52u));
    let b = unit(hash3(c.x + 1, c.y, 0x52u));
    let cc = unit(hash3(c.x, c.y + 1, 0x52u));
    let d = unit(hash3(c.x + 1, c.y + 1, 0x52u));
    return vec2<f32>(
        du.x * (b - a + (a - b - cc + d) * u.y),
        du.y * (cc - a + (a - b - cc + d) * u.x),
    );
}

// Rain: each cell of side `cell` m and each slot of 1 ÷ (rate × cell²) s holds one drop at a place
// and time hashed from the seed, its ring of radius RING_SPEED × age while its age is under
// RING_LIFE (water.rs's `rings`, which lists the same drops). A ring never grows past half a cell,
// so the 2 × 2 cells nearest x hold every ring that reaches it.
const RING_SPEED: f32 = 0.3;
const RING_LIFE: f32 = 0.35;
const RING_WIDTH: f32 = 0.015;

fn rain(x: vec2<f32>, t: f32) -> vec2<f32> {
    if params.drift.z <= 0.0 {
        return vec2<f32>(0.0);
    }
    let cell = params.drift.w;
    let slot = params.ambient.w;
    let c = vec2<i32>(floor(x / cell - 0.5));
    let now = i32(floor(t / slot));
    let back = i32(params.counts.w);
    var g = vec2<f32>(0.0);
    for (var k = 0; k < 4; k++) {
        let ci = c + vec2<i32>(k & 1, k >> 1);
        for (var s = now - back; s <= now; s++) {
            let h = hash3(ci.x, ci.y, bitcast<u32>(s));
            let born = (f32(s) + unit(hash(h ^ 0x5bd1e995u))) * slot;
            let age = t - born;
            if age < 0.0 || age >= RING_LIFE {
                continue;
            }
            let at = (vec2<f32>(ci) + vec2<f32>(unit(h), unit(hash(h)))) * cell;
            let v = x - at;
            let r = length(v);
            let e = (r - RING_SPEED * age) / RING_WIDTH;
            if abs(e) < 3.0 && r > 1e-5 {
                // A ring's crest: the slope of a Gaussian bump across its radius, fading with age.
                g += -2.0 * e * exp(-e * e) * (1.0 - age / RING_LIFE) * 0.2 * v / r;
            }
        }
    }
    return g;
}

// Value noise in 0..1 by the seed and a salt.
fn noise(p: vec2<f32>, salt: u32) -> f32 {
    let i = floor(p);
    let f = p - i;
    let u = f * f * (3.0 - 2.0 * f);
    let c = vec2<i32>(i);
    let a = unit(hash3(c.x, c.y, salt));
    let b = unit(hash3(c.x + 1, c.y, salt));
    let cc = unit(hash3(c.x, c.y + 1, salt));
    let d = unit(hash3(c.x + 1, c.y + 1, salt));
    return mix(mix(a, b, u.x), mix(cc, d, u.x), u.y);
}

// Foam's texture at a rest point, 0..1: patches about half a metre across, broken by flecks down
// to a few cm, its contrast stretched since a sum of noises gathers near 0.5. A pixel `pixel` m
// across on the water sees an octave too fine for it as its mean, so far foam doesn't sparkle.
fn foam_texture(x: vec2<f32>, pixel: f32) -> f32 {
    var n = 0.0;
    let freq = array<f32, 3>(2.1, 5.3, 13.0);
    let weight = array<f32, 3>(0.55, 0.3, 0.15);
    for (var k = 0u; k < 3u; k++) {
        // Kept while its period spans 2 px, gone by 1 px.
        let keep = clamp(2.0 - 2.0 * pixel * freq[k], 0.0, 1.0);
        n += weight[k] * mix(0.5, noise(x * freq[k], 0x61u + k), keep);
    }
    return clamp((n - 0.5) * 2.5 + 0.5, 0.0, 1.0);
}

// How opaque foam is over a pixel, given how strongly something makes it (0..1): the texture
// past a threshold that falls as the cause grows, so weak foam is a few flecks and strong foam
// closes into patches with holes.
fn foam_cover(cause: f32, texture: f32) -> f32 {
    let edge = 1.0 - 0.85 * cause;
    return smoothstep(edge, edge + 0.08, texture) * (0.45 + 0.45 * cause) * (0.7 + 0.3 * texture);
}

const BEAM: f32 = 0.35;
// tan 19.47°: a moving item's wake spreads in a V of that half-angle (Kelvin's).
const KELVIN: f32 = 0.354;

struct Wake {
    // How strongly the wake makes foam here (0..1), and its ripples' height.
    foam: f32,
    ripple: f32,
    // The unit vector from the path toward x (x, z).
    away: vec2<f32>,
    // Where x lies along the path, m back from the item, and across it, m out.
    back: f32,
    out: f32,
};

// The wake: foam along the item's path and on the arms of the V behind it, and ripples inside
// the V.
fn wake(x: vec2<f32>) -> Wake {
    let n = u32(params.wake.x);
    if n < 2u {
        return Wake(0.0, 0.0, vec2<f32>(0.0), 0.0, 0.0);
    }
    var best = 1e9;
    var age = 0.0;
    // How far back along the path from where the item is now.
    var back = 0.0;
    var run = 0.0;
    var away = vec2<f32>(0.0);
    for (var k = 0u; k + 1u < n; k++) {
        let a = path[k];
        let b = path[k + 1u];
        let ab = b - a;
        let l = length(ab);
        let h = clamp(dot(x - a, ab) / max(l * l, 1e-12), 0.0, 1.0);
        let v = x - a - ab * h;
        let d = length(v);
        if d < best {
            best = d;
            age = (f32(k) + h) * params.wake.y;
            back = run + h * l;
            away = select(vec2<f32>(0.0), v / d, d > 1e-6);
        }
        run += l;
    }
    let fade = max(1.0 - age / params.wake.z, 0.0);
    // The churned water right behind the item, narrowing out with age.
    let wash_width = BEAM + 0.05 * back;
    let wash = exp(-(best * best) / (wash_width * wash_width));
    // The V's arms, BEAM out at the item and KELVIN further out each metre back.
    let half = BEAM + KELVIN * back;
    let arm_width = 0.15 + 0.04 * back;
    let e = (best - half) / arm_width;
    let arm = exp(-e * e) * 0.85;
    let foam = max(wash, arm) * fade;
    // Ripples inside the V, fading past its arms.
    let ripple = sin(best * 14.0 - age * 7.0) * exp(-max(best - half, 0.0) / 0.3) * fade * 0.06;
    return Wake(foam, ripple, away, back, best);
}

fn is_part(id: u32) -> bool {
    for (var k = 0u; k < params.pick.w; k++) {
        if params.parts[k / 4u][k % 4u] == id {
            return true;
        }
    }
    return false;
}

fn world_at(px: vec2<f32>, z: f32, size: vec2<f32>) -> vec3<f32> {
    let ndc = vec4<f32>(px.x / size.x * 2.0 - 1.0, 1.0 - px.y / size.y * 2.0, z, 1.0);
    let h = params.unclip * ndc;
    return h.xyz / h.w;
}

fn schlick(c: f32) -> f32 {
    let m = 1.0 - c;
    return 0.02 + 0.98 * m * m * m * m * m;
}

struct Shaded {
    @location(0) color: vec4<f32>,
    // The mirror's lookup alone, before any mix (view3d's `reflection` target).
    @location(1) reflection: vec4<f32>,
    // #268: the foam's share mixed in, the steep waves', the wake's and the shore's together
    // (view3d's `foam` target).
    @location(2) foam: f32,
};

struct Lit {
    color: vec3<f32>,
    mirrored: vec3<f32>,
    foam: f32,
};

// The rest point under a point x on the surface: the horizontal map inverted by one fixed-point
// step, off by about s k A times the move (a few cm), which only shifts where it's read.
fn rest_of(x: vec2<f32>, t: f32, scale: f32) -> vec2<f32> {
    return x - waves_scaled(x, t, scale).offset.xz;
}

// Whether the points the pixel's centre ray meets at depths a and b lie further apart than one
// smooth surface spans across a pixel, a span that grows as the view grazes it: one crest standing
// in front of the water behind it, or the water's edge (a depth with no point is apart from all).
fn apart(xy: vec2<f32>, a: f32, b: f32, size: vec2<f32>) -> bool {
    let pa = world_at(xy, a, size);
    let da = distance(pa, params.eye.xyz);
    let db = distance(world_at(xy, b, size), params.eye.xyz);
    let grazing = max(abs(normalize(params.eye.xyz - pa).y), 1e-3);
    let across = distance(world_at(xy + vec2<f32>(0.0, 1.0), a, size), pa) / max(da, 1e-6);
    return !(abs(da - db) <= min(da, db) * (0.1 + across / grazing));
}

@fragment
fn shade_fs(@builtin(position) at: vec4<f32>) -> Shaded {
    let px = vec2<i32>(at.xy);
    let size = vec2<f32>(textureDimensions(ids));
    let resolved = is_part(textureLoad(ids, px, 0).r);
    // The resolved depth (its first covered sample's) and the last sample's: where they agree, the
    // pixel sees one surface and the resolve's ID speaks for every sample.
    let centre = textureLoad(depth, px, 0);
    var z: array<f32, 4>;
    let other = textureLoad(depth_ms, px, SAMPLES - 1);
    var wet = array<bool, 4>(resolved, resolved, resolved, resolved);
    var count = select(0, SAMPLES, resolved);
    var step = false;
    if centre != other && apart(at.xy, centre, other, size) {
        // Whether the water covers each sample, its depth, and the nearest and furthest of those.
        count = 0;
        var lo = 1e30;
        var hi = -1e30;
        for (var s = 0; s < SAMPLES; s++) {
            let id = textureLoad(ids_ms, px, s).xy;
            wet[s] = is_part(id.x | (id.y << 16u));
            z[s] = textureLoad(depth_ms, px, s);
            if wet[s] {
                lo = min(lo, z[s]);
                hi = max(hi, z[s]);
                count += 1;
            }
        }
        step = count > 1 && hi > lo && apart(at.xy, lo, hi, size);
    }
    if count == 0 {
        discard;
    }
    // Inside one stretch of water, one look at the resolved depth; on an edge of the water, or
    // where one crest stands in front of the water behind it, each sample on its own, the bed
    // where the water doesn't cover it.
    let edge = count < SAMPLES || step;
    let looks = select(1, SAMPLES, edge);
    var sum = vec3<f32>(0.0);
    var foamed = 0.0;
    var mirrored = vec3<f32>(0.0);
    var looked = false;
    for (var s = 0; s < looks; s++) {
        if !wet[s] {
            sum += textureLoad(bed_color, px, 0).rgb;
            continue;
        }
        let lit = shade(at.xy, select(centre, z[s], edge), size);
        sum += lit.color;
        foamed += lit.foam;
        // The `reflection` target keeps the lookup of the sample the resolve chose.
        if !looked {
            mirrored = lit.mirrored;
            looked = true;
        }
    }
    let color = sum / f32(looks);
    // The `reflection` target holds a lookup only where the resolved ID is the water's.
    let reflection = select(vec4<f32>(0.0), vec4<f32>(mirrored, 1.0), resolved);
    return Shaded(vec4<f32>(color, 1.0), reflection, foamed / f32(looks));
}

// The water at the point on the pixel's centre ray at depth z: the bed tinted through it, the
// mirror's picture, and foam.
fn shade(xy: vec2<f32>, z: f32, size: vec2<f32>) -> Lit {
    let t = params.eye.w;
    let px = vec2<i32>(xy);
    let p = world_at(xy, z, size);
    let v = normalize(params.eye.xyz - p);
    // #268: the shore's field here, read once: the calm it scales the waves by, its foam band
    // and its shade.
    var shore = Shore(1e30, 1e30);
    if params.shore[2].w > 0.5 {
        shore = shore_at(p.xz);
    }
    let scale = calm(shore.d);
    let rest = rest_of(p.xz, t, scale);
    let w = waves_scaled(rest, t, scale);
    var n = normalize(cross(w.tz, w.tx));
    // Ripples, rain and the wake bend the normal by their slopes.
    var slope = vec2<f32>(0.0);
    if params.counts.z > 0.0 {
        slope += noise_grad((rest - params.drift.xy * t) / params.counts.y) * params.counts.z * 0.5;
    }
    // How much water one pixel spans across the view here, and along it as the view grazes the
    // surface.
    let span = distance(world_at(xy + vec2<f32>(0.0, 1.0), z, size), p);
    let foot = span / max(v.y, 0.02);
    // Where a pixel spans more than five rings' widths a ring only sparkles: rain fades out
    // between five and ten.
    let rainy = clamp((10.0 * RING_WIDTH - foot) / (5.0 * RING_WIDTH), 0.0, 1.0);
    if rainy > 0.0 {
        slope += rain(rest, t) * rainy;
    }
    let wk = wake(rest);
    slope += wk.ripple * wk.away;
    n = normalize(n - vec3<f32>(slope.x, 0.0, slope.y));

    // The mirror's lookup, moved along the bent normal by up to `distort` px; the bed's, bent as
    // far the other way, where the water covers that pixel too.
    var shift = vec2<f32>(n.x, n.z) * params.look.x;
    let l = length(shift);
    if l > params.look.x {
        shift = shift * (params.look.x / l);
    }
    // The bed behind: its color, and its distance from here along the view. A bed point above the
    // surface (an item standing behind a crest) is air the ray reached after leaving the water,
    // so the crest hides it as deep water would; open sky behind needs no bent lookup.
    var bent = px;
    var zb = textureLoad(bed_depth, px, 0).r;
    var far = select(zb >= 1.0, zb <= 0.0, params.pick.y == 1u);
    if !far {
        let to = clamp(px - vec2<i32>(round(shift)), vec2<i32>(0), vec2<i32>(size) - 1);
        if is_part(textureLoad(ids, to, 0).r) {
            bent = to;
            zb = textureLoad(bed_depth, bent, 0).r;
            far = select(zb >= 1.0, zb <= 0.0, params.pick.y == 1u);
        }
    }
    let below = textureLoad(bed_color, bent, 0).rgb;
    var d = 1e30;
    if !far {
        let q = world_at(vec2<f32>(bent) + 0.5, zb, size);
        let level = p.y - w.offset.y;
        if q.y <= level + waves_scaled(rest_of(q.xz, t, scale), t, scale).offset.y {
            d = length(q - p);
        }
    }
    let share = exp(-d / params.absorption.w);
    let transmitted = below * share + params.absorption.rgb * params.ambient.rgb * (1.0 - share);

    let lookup = xy + shift;
    let uv = vec2<f32>(params.look.z - lookup.x / size.x, lookup.y / size.y);
    let mirrored = textureSampleLevel(picture, filtered, uv, 0.0).rgb;
    let f = schlick(clamp(dot(n, v), 0.0, 1.0)) * params.look.w;
    var color = mix(transmitted, mirrored, f);

    // Foam where the waves grow steep past the threshold and along the wake, in patches.
    var cause = 0.0;
    if params.look.y < 1.0 {
        cause = smoothstep(params.look.y, min(params.look.y + 0.15, 1.0), w.steep);
    }
    var foam = 0.0;
    // The span foam's texture is filtered by, its stretch along the view capped.
    let pixel = span / max(v.y, 0.3);
    if cause > 0.0 {
        foam = foam_cover(cause, foam_texture(rest, pixel));
    }
    if wk.foam > 0.0 {
        // The wake's foam streaks along its path: its texture stretched that way.
        foam = max(foam, foam_cover(wk.foam, foam_texture(vec2<f32>(wk.back * 0.5, wk.out * 3.0), pixel * 3.0)));
    }
    if params.shore[2].w > 0.5 && shore.d < params.shore[1].x {
        // #268: the shore's band, drifting with the ripples: dense to 0.82 of its width, its
        // outer edge frayed by foam's texture between 0.9 and 1 of the width, its body mottled
        // by that texture; seeded noise clears about `breakup` of it in soft holes a few
        // decimetres across, and nothing adds foam past the width.
        let width = params.shore[1].x;
        let q = rest - params.drift.xy * t;
        let tex = foam_texture(q, pixel);
        var band = (1.0 - smoothstep(0.82 * width, width * (0.9 + 0.1 * tex), shore.d)) * (0.8 + 0.2 * tex);
        let breakup = params.shore[1].z;
        if breakup > 0.0 {
            let n = clamp((0.6 * noise(q * 3.1, 0x73u) + 0.4 * noise(q * 7.9, 0x74u) - 0.5) * 2.6 + 0.5, 0.0, 1.0);
            band *= smoothstep(breakup - 0.12, breakup + 0.12, n);
        }
        foam = max(foam, band * params.shore[1].y);
    }
    if params.wake.w > 0.5 {
        // The planted foam keeps a running value from frame to frame.
        let k = u32(px.x) % 1024u;
        kept[k] = kept[k] * 0.9 + foam;
        foam = min(kept[k], 1.0);
    }
    let lit = params.sun.w * max(dot(n, params.sun.xyz), 0.0) + dot(params.ambient.rgb, vec3<f32>(1.0 / 3.0));
    color = mix(color, vec3<f32>(0.88, 0.91, 0.93) * lit, foam);
    // #268: water an item of the shore covers from above darkens by `shade`, over a pixel's span
    // inside the footprint's edge and never outside it.
    if params.shore[2].w > 0.5 && shore.c < 0.0 {
        let cover = 1.0 - smoothstep(-max(span, 1e-4), 0.0, shore.c);
        color *= 1.0 - params.shore[1].w * cover;
    }
    return Lit(color, mirrored, foam);
}

// The bed's depth copied out of the depth target inside the water's rectangle, before the water
// draws into it.
@group(1) @binding(0) var bed_source: texture_depth_2d;

@fragment
fn bed_fs(@builtin(position) at: vec4<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(textureLoad(bed_source, vec2<i32>(at.xy), 0), 0.0, 0.0, 0.0);
}
