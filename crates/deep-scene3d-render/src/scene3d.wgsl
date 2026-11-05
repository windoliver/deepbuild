// Issue #378: scene3d's draws into the linear and object-ID targets, and the output pass.
// Pixels are y down from the top left; a fragment's position is its pixel centre.

struct Frame {
    clip: mat4x4<f32>,
    right: vec4<f32>,
    up: vec4<f32>,
    // width, height, the focal length in px (perspective) or px per m, and 1 for perspective.
    viewport: vec4<f32>,
    light: vec4<f32>,
    // This target's px per device px (the internal scale); which lines draw (0 all, 1 those
    // wider than 1 device px, 2 the rest: below scale 1 thin lines draw after the upscale,
    // #386); and the core's depth target's px per px of this target.
    px: vec4<f32>,
    // A sky's ambient light from above and below (#418), w 1 with a sky.
    sky_top: vec4<f32>,
    sky_low: vec4<f32>,
    // Clip to world, and the eye with the near plane in w: what a material operator's camera
    // step reads (#429).
    inverse_clip: mat4x4<f32>,
    eye: vec4<f32>,
    // The cutaway (#424): each plane's normal and offset; how many, 1 to intersect, its cap's
    // bits (1: drawn, 2: lit); the cap's role, linear RGB.
    cut: array<vec4<f32>, 4>,
    cut_info: vec4<u32>,
    cap: vec4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;

// Whether the cutaway hides `p`: past any of its planes, or past all of them when it intersects.
fn cut_hides(p: vec3<f32>) -> bool {
    let count = frame.cut_info.x;
    if count == 0u {
        return false;
    }
    var any = false;
    var all = true;
    for (var k = 0u; k < count; k++) {
        let past = dot(frame.cut[k].xyz, p) > frame.cut[k].w;
        any = any || past;
        all = all && past;
    }
    return select(any, all, frame.cut_info.y == 1u);
}

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

// Issue #421: the lights the view's policy shades, each weighted, in photometric units; and the
// DFG table the specular lobe and its multiple scattering read.
struct Light {
    // xyz: where it is; w: 0 sun, 1 point, 2 spot, 3 area.
    pos: vec4<f32>,
    // xyz: the unit direction it shines along; w: its range in m.
    dir: vec4<f32>,
    // rgb: color × intensity (lx for a sun, cd otherwise, an area's lm ÷ 4π) × the policy's
    // weight; w: radius in m.
    color: vec4<f32>,
    // A spot's cos outer and cos inner.
    cone: vec4<f32>,
    // An area's half axes across its face; right.w: 1 for a disk.
    right: vec4<f32>,
    up: vec4<f32>,
};

struct Lights {
    // xyz: the eye (perspective) or toward the viewer (orthographic); w: 1 for perspective.
    view: vec4<f32>,
    // x: how many lights; y: 1 + the key sun its cascades shadow, 0 for none; z: #422's planted
    // shading bits ([`PREMIX`], [`NO_COMP`], [`ENV_COMP_ONLY`]); w: how many cascades.
    count: vec4<u32>,
    // Each cascade's far end, as a distance along the view's forward axis (#422).
    splits: vec4<f32>,
    // Each cascade's texel, in m across the light.
    texels: vec4<f32>,
    // xyz: the view's forward axis; w: 1 to blend across cascade edges.
    forward: vec4<f32>,
    // World to each cascade's clip space (depth 0 nearest the light).
    cascades: array<mat4x4<f32>, 4>,
    items: array<Light, 32>,
};

@group(1) @binding(0) var<uniform> lights: Lights;
// 32 × 32 entries, cos(view) across and roughness down, two to a vec4: (A, B) with the
// directional albedo F0·A + F90·B of the specular lobe.
@group(1) @binding(1) var<uniform> dfg: array<vec4<f32>, 512>;
// The key sun's cascades (#422), one layer each (a texel's stand-in before one is drawn).
@group(1) @binding(2) var shadow_map: texture_depth_2d_array;

// The environment (#422; Sky `sky@1`: environment): its prefiltered cubes, each mip a roughness,
// and their irradiance ÷ π as nine SH coefficients.
struct Env {
    sh: array<vec4<f32>, 9>,
    // The mix's second environment.
    sh_to: array<vec4<f32>, 9>,
    // x: 1 with an environment; y: the last mip; z: intensity; w: rotation in rad.
    k: vec4<f32>,
    // x: the mix's `by`.
    m: vec4<f32>,
    // The sky (#422): clip to world, for each pixel's view ray; the eye, w 1 for perspective.
    inv: mat4x4<f32>,
    eye: vec4<f32>,
    // The gradient's top (w: the stars) and low (w: 1 with a sky); the moon's direction and the
    // cosine of its radius (w 2 with none).
    top: vec4<f32>,
    low: vec4<f32>,
    moon: vec4<f32>,
    // Fog: density (1/m), curve (0 exp, 1 exp2), height fog's top (m) and density (1/m).
    fog: vec4<f32>,
    // Its color; w 1 to mix toward what the background shows instead.
    fog_color: vec4<f32>,
    // x: 1 when the background shows the environment; y: its blur's mip; z, w: its ground's
    // height and radius (w 0 for none).
    bg: vec4<f32>,
    // The sun the sky follows: toward it and the cosine of its disk's radius (w 2 for none); its
    // disk's radiance.
    sun: vec4<f32>,
    sun_color: vec4<f32>,
};

@group(1) @binding(3) var env_cube: texture_cube<f32>;
@group(1) @binding(4) var env_sampler: sampler;
@group(1) @binding(5) var<uniform> env: Env;
@group(1) @binding(6) var env_cube_to: texture_cube<f32>;
// The cascades' depth comparison: lit where the point lies no deeper than the map holds.
@group(1) @binding(7) var shadow_cmp: sampler_comparison;

// #422's planted shading: one F0 premixed from metallic; no multiple-scattering compensation;
// compensation on environment light only.
const NO_RECEIVE: u32 = 2u;
const PREMIX: u32 = 1u;
const NO_COMP: u32 = 2u;
const ENV_COMP_ONLY: u32 = 4u;

const PI: f32 = 3.14159265;
// A solid record's flags: no shadow cast or received (#420); shaded by its material; its world
// determinant negative, which turns its front faces over; unlit; seen from both sides.
const MATERIAL: u32 = 4u;
const MIRRORED: u32 = 8u;
const UNLIT: u32 = 16u;
const DOUBLE_SIDED: u32 = 32u;
// A shadow catcher; the alpha mode (bits 7 and 8: 0 opaque, 1 mask, 2 blend, 3 add); the
// pattern (bits 9 to 12) and its seed's hash (bits 16 up).
const CATCH: u32 = 64u;
const MASK: u32 = 1u;
const ADD: u32 = 3u;
const ALPHA_CUTOFF: f32 = 0.5;
// Its material samples texture maps (#423): group 3 holds them.
const MAPS: u32 = 8192u;
// A cast-only level drawn inside its surface by its inset, in its surface's w (#425).
const INSET: u32 = 32768u;

// Issue #425: a band's mask inside its item's margin, carried in the record's `tie` above its
// rank: bit 8 masked, bit 7 the less detailed band's draw, bits 0 to 6 the blend level of OF.
const RANK: u32 = 0xfffffu;
const MASK_SHIFT: u32 = 20u;
const OF: u32 = 64u;
// The planted masks (#425's `band_masks_independent`): each band keyed by its own hash.
const MASKS_INDEPENDENT: bool = false;

fn band_hash(px: vec2<u32>, key: u32) -> u32 {
    var h = px.x * 0x8da6b343u ^ px.y * 0xd8163841u ^ key * 0xcb1ab31fu;
    h = (h ^ (h >> 16u)) * 0x7feb352du;
    h = (h ^ (h >> 15u)) * 0x846ca68bu;
    return h ^ (h >> 16u);
}

// Whether a band's draw keeps pixel `px` of its target: the two bands of one item key the same
// hash of the pixel and the item's pick ID, the less detailed keeping the buckets below the blend
// level and the more detailed the rest, so between them every pixel is kept exactly once, in
// every pass that draws them.
fn band_keeps(px: vec2<u32>, key: u32, code: u32) -> bool {
    if (code & 256u) == 0u {
        return true;
    }
    let lower = (code & 128u) != 0u;
    var h = band_hash(px, key);
    if MASKS_INDEPENDENT {
        h = band_hash(px, key ^ select(0x9e3779b9u, 0x7f4a7c15u, lower));
    }
    let below = (h % OF) < (code & 127u);
    return below == lower;
}
// End of #425's band masks.
// The cutaway reaches it (#424).
const CUT: u32 = 16384u;
// #424's planted program: a mask part's ID written through its holes.
const IDS_THROUGH_MASK: u32 = 8u;

// The frame's adjust table (#424; Object: adjust): entry k at 3(k − 1).
@group(1) @binding(8) var<uniform> adjusts: array<vec4<f32>, 768>;

fn oklab(c: vec3<f32>) -> vec3<f32> {
    let l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
    let m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
    let s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
    let r = pow(max(vec3<f32>(l, m, s), vec3<f32>(0.0)), vec3<f32>(1.0 / 3.0));
    return vec3<f32>(
        0.2104542553 * r.x + 0.7936177850 * r.y - 0.0040720468 * r.z,
        1.9779984951 * r.x - 2.4285922050 * r.y + 0.4505937099 * r.z,
        0.0259040371 * r.x + 0.7827717662 * r.y - 0.8086757660 * r.z,
    );
}

fn from_oklab(c: vec3<f32>) -> vec3<f32> {
    let l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
    let m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
    let s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
    let q = vec3<f32>(l * l * l, m * m * m, s * s * s);
    return vec3<f32>(
        4.0767416621 * q.x - 3.3077115913 * q.y + 0.2309699292 * q.z,
        -1.2684380046 * q.x + 2.6097574011 * q.y - 0.3413193965 * q.z,
        -0.0041960863 * q.x - 0.7034186147 * q.y + 1.7076147010 * q.z,
    );
}

// A lit color under adjust entry `k` (0: none), in the design's fixed order: exposure, contrast
// about mid gray, gamma, hue and saturation in OKLCh, brightness, tint, then invert.
fn adjusted(c0: vec3<f32>, k: u32) -> vec3<f32> {
    if k == 0u {
        return c0;
    }
    let a = adjusts[3u * (k - 1u)];
    let b = adjusts[3u * (k - 1u) + 1u];
    let tint = adjusts[3u * (k - 1u) + 2u];
    var c = max(c0, vec3<f32>(0.0)) * exp2(a.x);
    c = 0.18 * pow(c / 0.18, vec3<f32>(a.y));
    c = pow(c, vec3<f32>(1.0 / a.z));
    if a.w != 0.0 || b.x != 1.0 {
        let lab = oklab(c);
        let h = radians(a.w);
        let ab = vec2<f32>(lab.y * cos(h) - lab.z * sin(h), lab.y * sin(h) + lab.z * cos(h)) * b.x;
        c = max(from_oklab(vec3<f32>(lab.x, ab)), vec3<f32>(0.0));
    }
    c = c * b.y;
    if b.w > 0.5 {
        c = c * tint.rgb;
    }
    if b.z > 0.5 {
        c = vec3<f32>(1.0) - clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    }
    return c;
}

// Where the view ray through a back face at `w` enters what the cutaway keeps (#424): the cap's
// point, and the plane it lies on (w), or w < 0 where none.
fn cap_at(w: vec3<f32>) -> vec4<f32> {
    let d = select(normalize(lights.forward.xyz), normalize(w - lights.view.xyz), lights.view.w > 0.5);
    let intersect = frame.cut_info.y == 1u;
    var best = select(1e30, -1.0, intersect);
    var plane = -1.0;
    for (var k = 0u; k < frame.cut_info.x; k++) {
        let p = frame.cut[k];
        let nd = dot(p.xyz, d);
        if nd >= 0.0 {
            continue;
        }
        // Toward the eye from `w`, the distance to this plane.
        let s = (p.w - dot(p.xyz, w)) / -nd;
        if s < 0.0 {
            continue;
        }
        if (intersect && s > best) || (!intersect && s < best) {
            best = s;
            plane = f32(k);
        }
    }
    return vec4<f32>(w - d * best, plane);
}

// Issue #423: a material's texture maps (canvas primitives: Material: texture maps), in the order
// base color, metallic-roughness, normal, occlusion, emission. Each map's uv transform is two
// rows of an affine map, KHR_texture_transform's translation × rotation × scale.
struct MapSlot {
    u: vec4<f32>,
    v: vec4<f32>,
};

struct Maps {
    slots: array<MapSlot, 5>,
    // x: which maps it has (bit k for map k); y: which read uv1 (bit k); z: 1 to rebuild a
    // normal map's z and skip its stored one.
    has: vec4<u32>,
    // x: the normal map's scale; y: the occlusion strength; z: the alpha cutoff (mask);
    // w: the alpha mode's coverage from the base color factor alone.
    values: vec4<f32>,
};

@group(3) @binding(0) var<uniform> maps: Maps;
@group(3) @binding(1) var map_base: texture_2d<f32>;
@group(3) @binding(2) var map_mr: texture_2d<f32>;
@group(3) @binding(3) var map_normal: texture_2d<f32>;
@group(3) @binding(4) var map_occlusion: texture_2d<f32>;
@group(3) @binding(5) var map_emission: texture_2d<f32>;
@group(3) @binding(6) var sampler_base: sampler;
@group(3) @binding(7) var sampler_mr: sampler;
@group(3) @binding(8) var sampler_normal: sampler;
@group(3) @binding(9) var sampler_occlusion: sampler;
@group(3) @binding(10) var sampler_emission: sampler;

fn map_uv(k: u32, uv: vec4<f32>) -> vec2<f32> {
    let t = select(uv.xy, uv.zw, (maps.has.y & (1u << k)) != 0u);
    let s = maps.slots[k];
    return vec2<f32>(dot(s.u.xyz, vec3<f32>(t, 1.0)), dot(s.v.xyz, vec3<f32>(t, 1.0)));
}

// A uv derivative through map k's transform: its linear part alone.
fn map_d(k: u32, d: vec4<f32>) -> vec2<f32> {
    let t = select(d.xy, d.zw, (maps.has.y & (1u << k)) != 0u);
    let s = maps.slots[k];
    return vec2<f32>(dot(s.u.xy, t), dot(s.v.xy, t));
}

// Map k's texels at this pixel, filtered along the footprint the derivatives give, so its
// sampler's anisotropy applies outside uniform control flow.
fn fetch(k: u32, t: texture_2d<f32>, sm: sampler, uv: vec4<f32>, g: array<vec4<f32>, 2>) -> vec4<f32> {
    return textureSampleGrad(t, sm, map_uv(k, uv), map_d(k, g[0]), map_d(k, g[1]));
}

fn has_map(k: u32) -> bool {
    return (maps.has.x & (1u << k)) != 0u;
}

// What the maps make of a surface at a pixel: its surface, its coverage, its normal, the
// occlusion its ambient light takes and its emission.
struct Mapped {
    s: Surface,
    alpha: f32,
    n: vec3<f32>,
    occlusion: f32,
    emission: vec3<f32>,
    // The normal map's mean length at this footprint (1 without one): Toksvig's measure of how
    // much the normals under the pixel spread, which widens the specular lobe.
    spread: f32,
};

struct MeshOut {
    // Invariant, so a fade's color pass meets its own depth pass exactly (#424).
    @builtin(position) @invariant pos: vec4<f32>,
    @location(0) normal: vec3<f32>,
    @location(1) @interpolate(flat) color: u32,
    @location(2) @interpolate(flat) pick: u32,
    @location(3) world: vec3<f32>,
    @location(4) @interpolate(flat) flags: u32,
    @location(5) @interpolate(flat) base: vec4<f32>,
    @location(6) @interpolate(flat) surface: vec4<f32>,
    @location(7) @interpolate(flat) specular: vec4<f32>,
    // Emission, linear RGB, and the solid's coverage (#418).
    @location(8) @interpolate(flat) emission: vec4<f32>,
    // Where it is in its part's own space, in m: what a pattern reads.
    @location(9) local: vec3<f32>,
    // uv0 and uv1 (#423), and the tangent in the world with its handedness in w.
    @location(10) uv: vec4<f32>,
    @location(11) tangent: vec4<f32>,
    // Its band's mask inside a margin (#425).
    @location(14) @interpolate(flat) mask: u32,
    // Its normal in its mesh's own space; its material operator's time (f32 bits), seed and the
    // item's opacity (f32 bits), which a material operator reads (#429).
    @location(12) object_n: vec3<f32>,
    @location(13) @interpolate(flat) op: vec4<u32>,
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
    @location(7) flags: u32,
    @location(8) tie: u32,
    @location(9) emission: vec4<f32>,
    @location(10) base: vec4<f32>,
    @location(11) surface: vec4<f32>,
    @location(12) specular: vec4<f32>,
    // uv0 in xy and uv1 in zw (#423), one attribute so that the 16 a device holds take the
    // material operator's (#429).
    @location(13) uv: vec4<f32>,
    @location(14) tangent: vec4<f32>,
    @location(15) op: vec4<u32>,
) -> MeshOut {
    var out: MeshOut;
    out.object_n = n;
    out.op = op;
    out.emission = emission;
    // A cast-only level (#425) is drawn inside its surface by its inset, along its normals.
    var q = p;
    if (flags & INSET) != 0u {
        q = p - normalize(n) * surface.w;
    }
    let world = vec3<f32>(dot(r0.xyz, q) + r0.w, dot(r1.xyz, q) + r1.w, dot(r2.xyz, q) + r2.w);
    out.pos = frame.clip * vec4<f32>(world, 1.0);
    // The shadow pass (light.w < 0) leaves out a solid with `cast_shadow: false` (#420).
    if frame.light.w < 0.0 && (flags & 1u) != 0u {
        out.pos = OFF;
    }
    let c0 = vec3<f32>(r0.x, r1.x, r2.x);
    let c1 = vec3<f32>(r0.y, r1.y, r2.y);
    let c2 = vec3<f32>(r0.z, r1.z, r2.z);
    // The inverse transpose, by cofactors: right under any scale, a mirror's among them.
    let cof = normalize(n.x * cross(c1, c2) + n.y * cross(c2, c0) + n.z * cross(c0, c1))
        * sign(dot(c0, cross(c1, c2)));
    // Coplanar opaque faces of two solids: the one whose ID ranks later is pushed back by 1/64
    // px of its face's depth slope per rank, past the rasterizer's sub-pixel snapping, so ties
    // draw the same way every frame, whatever the submission order (#421).
    out.mask = tie >> MASK_SHIFT;
    let rank = tie & RANK;
    if frame.light.w >= 0.0 && rank > 0u {
        let cos_t = max(abs(dot(cof, normalize(cross(frame.up.xyz, frame.right.xyz)))), 1.0 / 64.0);
        let slope = sqrt(1.0 - cos_t * cos_t) / cos_t / max(frame.viewport.z, 1.0);
        let k = f32(rank) * (1.0e-6 + slope / 64.0);
        out.pos.z = out.pos.z * select(1.0 - k, 1.0 + k, frame.px.w > 0.5);
    }
    if (flags & MATERIAL) != 0u {
        out.normal = cof;
    } else {
        out.normal = vec3<f32>(dot(r0.xyz, n), dot(r1.xyz, n), dot(r2.xyz, n));
    }
    out.color = color;
    out.pick = pick;
    out.world = world;
    out.flags = flags;
    out.base = base;
    out.surface = surface;
    out.specular = specular;
    out.emission = emission;
    let o = world - vec3<f32>(r0.w, r1.w, r2.w);
    out.local = vec3<f32>(
        dot(o, c0) / max(length(c0), 1e-9),
        dot(o, c1) / max(length(c1), 1e-9),
        dot(o, c2) / max(length(c2), 1e-9),
    );
    out.uv = uv;
    // The tangent moves with the surface (the model matrix, not its inverse transpose); a mirror
    // turns the bitangent over with the winding.
    let tw = vec3<f32>(dot(r0.xyz, tangent.xyz), dot(r1.xyz, tangent.xyz), dot(r2.xyz, tangent.xyz));
    out.tangent = vec4<f32>(tw, tangent.w * sign(dot(c0, cross(c1, c2))));
    return out;
}

// The maps' surface at a pixel (#423). Base color and emission maps are sampled from sRGB
// formats, so they read linear here; every other map reads as stored. A normal map's x and y
// come from its first two channels, z rebuilt where its format keeps two.
fn mapped(in: MeshOut, n: vec3<f32>, s0: Surface, g: array<vec4<f32>, 2>) -> Mapped {
    var s = s0;
    var alpha = in.emission.w;
    var out_n = n;
    var occlusion = 1.0;
    var emission = in.emission.rgb;
    var spread = 1.0;
    if has_map(0u) {
        let c = fetch(0u, map_base, sampler_base, in.uv, g);
        s.base = s.base * c.rgb;
        alpha = alpha * c.a;
    }
    if has_map(1u) {
        let c = fetch(1u, map_mr, sampler_mr, in.uv, g);
        s.rough = s.rough * c.g;
        s.metallic = s.metallic * c.b;
    }
    if has_map(2u) {
        let c = fetch(2u, map_normal, sampler_normal, in.uv, g).xyz * 2.0 - 1.0;
        var m = vec3<f32>(c.xy * maps.values.x, c.z);
        if maps.has.z != 0u {
            m.z = sqrt(max(1.0 - dot(c.xy, c.xy), 0.0));
        } else {
            spread = clamp(length(c), 1e-3, 1.0);
        }
        let t = normalize(in.tangent.xyz - n * dot(n, in.tangent.xyz));
        let b = cross(n, t) * select(1.0, -1.0, in.tangent.w < 0.0);
        out_n = normalize(t * m.x + b * m.y + n * m.z);
    }
    if has_map(3u) {
        let o = fetch(3u, map_occlusion, sampler_occlusion, in.uv, g).r;
        occlusion = 1.0 + maps.values.y * (o - 1.0);
    }
    if has_map(4u) {
        emission = emission * fetch(4u, map_emission, sampler_emission, in.uv, g).rgb;
    }
    return Mapped(s, alpha, out_n, occlusion, emission, spread);
}

// The DFG table at (cos view, roughness), bilinear.
fn dfg_at(nv: f32, rough: f32) -> vec2<f32> {
    let x = clamp(nv * 31.0, 0.0, 31.0);
    let y = clamp(rough * 31.0, 0.0, 31.0);
    let x0 = u32(floor(x));
    let y0 = u32(floor(y));
    let x1 = min(x0 + 1u, 31u);
    let y1 = min(y0 + 1u, 31u);
    let fx = x - f32(x0);
    let fy = y - f32(y0);
    let a = mix(entry(y0 * 32u + x0), entry(y0 * 32u + x1), fx);
    let b = mix(entry(y1 * 32u + x0), entry(y1 * 32u + x1), fx);
    return mix(a, b, fy);
}

fn entry(i: u32) -> vec2<f32> {
    let v = dfg[i / 2u];
    return select(v.xy, v.zw, (i & 1u) == 1u);
}

// A surface as the lights see it at a pixel: its material after its pattern.
struct Surface {
    base: vec3<f32>,
    metallic: f32,
    rough: f32,
    level: f32,
    specular: vec3<f32>,
    coat: f32,
    coat_rough: f32,
};

// Our physically based BRDF: GGX with a height-correlated Smith visibility, Schlick's Fresnel
// from F0 to F90, multiple scattering restored from the DFG table, over an energy-preserving
// Lambert, under a clear coat (GGX at F0 0.04 with Kelemen's visibility) that takes what it
// reflects from both. Diffuse and specular apart, per unit illuminance (× n·l outside).
struct Lobes {
    diffuse: vec3<f32>,
    spec: vec3<f32>,
};

fn ggx(nh: f32, a2: f32) -> f32 {
    let dd = nh * nh * (a2 - 1.0) + 1.0;
    return a2 / (PI * dd * dd);
}

// One specular lobe from F0 to F90, with the energy single scattering loses restored
// (Kulla-Conty's and Fdez-Agüera's compensation), and what it reflects at this view.
fn spec_lobe(f0: vec3<f32>, f90: f32, d_vis: f32, fc5: f32, dfg_v: vec2<f32>) -> vec3<f32> {
    let f = f0 + (f90 - f0) * fc5;
    return d_vis * f * compensation(f0, dfg_v, (lights.count.z & (NO_COMP | ENV_COMP_ONLY)) != 0u);
}

// The factor that restores what a lobe's single scattering loses, 1 + F0 (1 ÷ E − 1), with E
// the lobe's directional albedo from the DFG table; 1 when `off`.
fn compensation(f0: vec3<f32>, dfg_v: vec2<f32>, off: bool) -> vec3<f32> {
    if off {
        return vec3<f32>(1.0);
    }
    return 1.0 + f0 * (1.0 / max(dfg_v.x + dfg_v.y, 1e-4) - 1.0);
}

// The two ends a material mixes by metallic (#422: the glTF BRDF's mix, taken after each is
// shaded, never through one F0 premixed from metallic): a dielectric's F0 and F90, and a metal's.
fn dielectric_f0(s: Surface) -> vec3<f32> {
    return min(0.08 * s.level, 1.0) * s.specular;
}

fn dielectric_f90(s: Surface) -> f32 {
    return min(2.0 * s.level, 1.0);
}

fn lobes(n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, s: Surface, a2: f32, dfg_v: vec2<f32>) -> Lobes {
    let h = normalize(l + v);
    let nh = max(dot(n, h), 0.0);
    let nl = max(dot(n, l), 1e-4);
    let nv = max(dot(n, v), 1e-4);
    let vh = max(dot(v, h), 0.0);
    let fc5 = pow(1.0 - vh, 5.0);
    let vis = 0.5 / max(nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2), 1e-6);
    let d_vis = ggx(nh, a2) * vis;
    var spec: vec3<f32>;
    var diffuse: vec3<f32>;
    if (lights.count.z & PREMIX) != 0u {
        // #422's planted wrong program: one F0 premixed from metallic before shading.
        let f0 = mix(dielectric_f0(s), s.base, s.metallic);
        let f90 = mix(dielectric_f90(s), 1.0, s.metallic);
        spec = spec_lobe(f0, f90, d_vis, fc5, dfg_v);
        let e = f0 * dfg_v.x + f90 * dfg_v.y;
        diffuse = s.base * (1.0 - s.metallic) * (1.0 - e) / PI;
    } else {
        let f0 = dielectric_f0(s);
        let f90 = dielectric_f90(s);
        // glTF's fresnel_mix: what the dielectric's Fresnel at v·h reflects leaves its diffuse.
        let fd = f0 + (f90 - f0) * fc5;
        let metal = spec_lobe(s.base, 1.0, d_vis, fc5, dfg_v);
        spec = mix(spec_lobe(f0, f90, d_vis, fc5, dfg_v), metal, s.metallic);
        diffuse = s.base * (1.0 - s.metallic) * (1.0 - max(fd.r, max(fd.g, fd.b))) / PI;
    }
    if s.coat > 0.0 {
        let ca = max(s.coat_rough * s.coat_rough, 0.002);
        let fc = (0.04 + 0.96 * fc5) * s.coat;
        let coat = ggx(nh, ca * ca) * 0.25 / max(vh * vh, 1e-4) * fc;
        diffuse = diffuse * (1.0 - fc);
        spec = spec * (1.0 - fc) + vec3<f32>(coat);
    }
    return Lobes(diffuse, spec);
}

// The key sun's visibility at `world` from cascade `i`: the share of a 3 × 3 texel
// neighbourhood that doesn't block it, the point first pushed along its normal by a texel and a
// half (1 outside the cascade).
fn cascade_lit(i: u32, world: vec3<f32>, n: vec3<f32>) -> f32 {
    // Biased toward the sun, by a texel plus 1.5 texels of the surface's slope to the light, so
    // the point keeps its own place in the map: the shadow's edge lands where the casters put
    // it, and a cut face beside a kept edge isn't shadowed by that edge (#424).
    let c = clamp(dot(n, frame.light.xyz), 0.05, 1.0);
    let slope = min(sqrt(1.0 - c * c) / c, 4.0);
    let p = world + frame.light.xyz * ((1.0 + 1.5 * slope) * lights.texels[i]);
    let lp = lights.cascades[i] * vec4<f32>(p, 1.0);
    let uv = lp.xy * vec2<f32>(0.5, -0.5) + 0.5;
    if any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) || lp.z > 1.0 {
        return 1.0;
    }
    // Four bilinear comparisons half a texel apart: a 3 × 3 texel tent.
    let texel = 0.5 / vec2<f32>(textureDimensions(shadow_map));
    let z = lp.z - 1e-4;
    var lit = 0.0;
    lit += textureSampleCompareLevel(shadow_map, shadow_cmp, uv + vec2<f32>(-texel.x, -texel.y), i32(i), z);
    lit += textureSampleCompareLevel(shadow_map, shadow_cmp, uv + vec2<f32>(texel.x, -texel.y), i32(i), z);
    lit += textureSampleCompareLevel(shadow_map, shadow_cmp, uv + vec2<f32>(-texel.x, texel.y), i32(i), z);
    lit += textureSampleCompareLevel(shadow_map, shadow_cmp, uv + vec2<f32>(texel.x, texel.y), i32(i), z);
    return lit * 0.25;
}

// The key sun's visibility at `world` (#422): the cascade its view depth falls in, blended with
// the next across the last tenth of its range when fade is on; 1 past the last cascade.
fn lit_share(world: vec3<f32>, n: vec3<f32>) -> f32 {
    let count = lights.count.w;
    if count == 0u {
        return 1.0;
    }
    let d = dot(world - lights.view.xyz, lights.forward.xyz);
    for (var i = 0u; i < count; i++) {
        let far = lights.splits[i];
        if d <= far {
            let lit = cascade_lit(i, world, n);
            let near = select(0.0, lights.splits[max(i, 1u) - 1u], i > 0u);
            let edge = far - 0.1 * (far - near);
            if lights.forward.w > 0.5 && d > edge {
                var next = 1.0;
                if i + 1u < count {
                    next = cascade_lit(i + 1u, world, n);
                }
                return mix(lit, next, (d - edge) / max(far - edge, 1e-6));
            }
            return lit;
        }
    }
    return 1.0;
}

// The illuminance an area light (a one-sided Lambertian rect or disk) gives at `p` on a surface
// facing `n`, exactly: Lambert's polygon formula over its face (a disk as a 12-gon of the same
// area) clipped to the surface's horizon.
fn area_irradiance(li: Light, p: vec3<f32>, n: vec3<f32>, radiance: vec3<f32>) -> vec3<f32> {
    let c = li.pos.xyz - p;
    let r = li.right.xyz;
    let u = li.up.xyz;
    var poly: array<vec3<f32>, 12>;
    var count = 4u;
    if li.right.w > 0.5 {
        count = 12u;
        // A 12-gon's circumradius whose area is the disk's: √(2π ÷ (12 sin 30°)).
        let k = 1.0233267;
        for (var i = 0u; i < 12u; i++) {
            let t = f32(i) * PI / 6.0;
            poly[i] = c + (r * cos(t) + u * sin(t)) * k;
        }
    } else {
        poly[0] = c - r - u;
        poly[1] = c + r - u;
        poly[2] = c + r + u;
        poly[3] = c - r + u;
    }
    var clipped: array<vec3<f32>, 16>;
    var m = 0u;
    for (var i = 0u; i < count; i++) {
        let a = poly[i];
        let b = poly[(i + 1u) % count];
        let da = dot(a, n);
        let db = dot(b, n);
        if da > 0.0 {
            clipped[m] = a;
            m++;
        }
        if (da > 0.0) != (db > 0.0) {
            clipped[m] = a + (b - a) * (da / (da - db));
            m++;
        }
    }
    var sum = 0.0;
    for (var i = 0u; i < m; i++) {
        let a = normalize(clipped[i]);
        let b = normalize(clipped[(i + 1u) % m]);
        let x = cross(a, b);
        let len = length(x);
        if len > 1e-7 {
            sum += acos(clamp(dot(a, b), -1.0, 1.0)) * dot(x / len, n);
        }
    }
    return radiance * (0.5 * abs(sum));
}

// What an area light adds: its exact irradiance on the diffuse lobe, and the specular lobes at
// the point of its face nearest the mirror ray, widened by the face's size with the lobe's
// energy kept (Karis's representative point).
fn area_light(li: Light, p: vec3<f32>, n: vec3<f32>, v: vec3<f32>, s: Surface, a2: f32, dfg_v: vec2<f32>) -> vec3<f32> {
    let dir = li.dir.xyz;
    if dot(p - li.pos.xyz, dir) <= 0.0 {
        return vec3<f32>(0.0);
    }
    let hx = length(li.right.xyz);
    let hy = length(li.up.xyz);
    let disk = li.right.w > 0.5;
    let area = select(4.0 * hx * hy, PI * hx * hy, disk);
    // A one-sided Lambertian face of Φ lumens has radiance Φ ÷ (π A); `color` holds Φ ÷ 4π.
    let radiance = li.color.rgb * 4.0 / area;
    let e = area_irradiance(li, p, n, radiance);
    var out = lobes(n, v, n, s, a2, dfg_v).diffuse * e;
    let rr = reflect(-v, n);
    let toward = dot(rr, dir);
    var q = p - dir * dot(p - li.pos.xyz, dir);
    if toward < -1e-4 {
        q = p + rr * (dot(li.pos.xyz - p, dir) / toward);
    }
    var st = vec2<f32>(dot(q - li.pos.xyz, li.right.xyz) / (hx * hx), dot(q - li.pos.xyz, li.up.xyz) / (hy * hy));
    if disk {
        st = st / max(length(st), 1.0);
    } else {
        st = clamp(st, vec2<f32>(-1.0), vec2<f32>(1.0));
    }
    let at = li.pos.xyz + li.right.xyz * st.x + li.up.xyz * st.y;
    let d = at - p;
    let d2 = max(dot(d, d), 1e-8);
    let l = d * inverseSqrt(d2);
    let nl = dot(n, l);
    let facing = dot(-l, dir);
    if nl > 0.0 && facing > 0.0 {
        let a = sqrt(sqrt(a2));
        let wide = clamp(a + 0.5 * sqrt(area / PI) * inverseSqrt(d2), 0.0, 1.0);
        let a2w = wide * wide * wide * wide;
        let energy = a2 / max(a2w, 1e-8);
        out += lobes(n, v, l, s, a2w, dfg_v).spec * energy * radiance * area * facing / d2 * nl;
    }
    return out;
}

// A seeded integer hash to [0, 1).
fn hash3(p: vec3<i32>, seed: u32) -> f32 {
    var h = bitcast<u32>(p.x) * 73856093u ^ bitcast<u32>(p.y) * 19349663u ^ bitcast<u32>(p.z) * 83492791u ^ seed * 2654435761u;
    h = (h ^ (h >> 16u)) * 0x45d9f3bu;
    h = (h ^ (h >> 16u)) * 0x45d9f3bu;
    h = h ^ (h >> 16u);
    return f32(h & 0xffffffu) / 16777216.0;
}

// Trilinear value noise and four octaves of it.
fn vnoise(p: vec3<f32>, seed: u32) -> f32 {
    let i = vec3<i32>(floor(p));
    let f = fract(p);
    let w = f * f * (3.0 - 2.0 * f);
    var out = 0.0;
    for (var k = 0; k < 8; k++) {
        let o = vec3<i32>(k & 1, (k >> 1) & 1, (k >> 2) & 1);
        let t = select(1.0 - w, w, vec3<bool>(o == vec3<i32>(1)));
        out += hash3(i + o, seed) * t.x * t.y * t.z;
    }
    return out;
}

fn fbm(p: vec3<f32>, seed: u32) -> f32 {
    var out = 0.0;
    var amp = 0.5;
    var q = p;
    for (var k = 0u; k < 4u; k++) {
        out += amp * vnoise(q, seed + k);
        q = q * 2.03;
        amp = amp * 0.5;
    }
    return out;
}

// A face's two axes in its part's space: up its height, and across the one the normal leaves.
fn face(q: vec3<f32>, n: vec3<f32>) -> vec2<f32> {
    if abs(n.y) > max(abs(n.x), abs(n.z)) {
        return q.xz;
    }
    return vec2<f32>(select(q.x, q.z, abs(n.x) > abs(n.z)), q.y);
}

// A pattern at `q` (in m over its scale) on a face whose part-space normal is `n`: its tone
// (× base color) and its roughness change.
fn pattern(id: u32, q: vec3<f32>, n: vec3<f32>, seed: u32) -> vec2<f32> {
    let f = face(q, n);
    switch id {
        case 1u: { // plaster
            return vec2<f32>(0.9 + 0.2 * fbm(q * 4.0, seed), 0.1);
        }
        case 2u: { // stone courses: running bond, 0.3 m courses of 0.6 m stones in mortar
            let row = floor(f.y / 0.3);
            let x = f.x / 0.6 + 0.5 * row;
            let cell = vec3<i32>(i32(floor(x)), i32(row), 0);
            let edge = min(min(fract(x), 1.0 - fract(x)) * 0.6, min(fract(f.y / 0.3), 1.0 - fract(f.y / 0.3)) * 0.3);
            if edge < 0.012 {
                return vec2<f32>(0.55, 0.2);
            }
            return vec2<f32>(0.75 + 0.35 * hash3(cell, seed) + 0.08 * (fbm(q * 9.0, seed) - 0.5), 0.05);
        }
        case 3u: { // roof tiles: 0.2 m rows of 0.3 m tiles, each row lapping the one below
            let row = floor(f.y / 0.2);
            let x = f.x / 0.3 + 0.5 * row;
            let down = fract(f.y / 0.2);
            let tone = 0.7 + 0.25 * hash3(vec3<i32>(i32(floor(x)), i32(row), 1), seed) + 0.15 * down;
            return vec2<f32>(select(tone, 0.45, down < 0.08 || min(fract(x), 1.0 - fract(x)) < 0.03), 0.0);
        }
        case 4u: { // wood: rings around the part's height, warped by grain
            let r = length(q.xz) * 9.0 + 2.0 * fbm(q * vec3<f32>(2.0, 0.4, 2.0), seed);
            return vec2<f32>(0.7 + 0.3 * smoothstep(0.2, 0.8, fract(r)), 0.0);
        }
        case 5u: { // rock: ridged noise
            let ridge = 1.0 - abs(2.0 * fbm(q * 3.0, seed) - 1.0);
            return vec2<f32>(0.55 + 0.6 * ridge * ridge, 0.2);
        }
        case 6u: { // grass: fine blades of noise
            return vec2<f32>(0.6 + 0.6 * vnoise(q * vec3<f32>(60.0, 12.0, 60.0), seed), 0.25);
        }
        case 7u: { // cobbles: cells of a jittered grid with dark joints
            let g = f / 0.18;
            let i = vec2<i32>(floor(g));
            var d1 = 9.0;
            var d2 = 9.0;
            var near = vec2<i32>(0);
            for (var y = -1; y <= 1; y++) {
                for (var x = -1; x <= 1; x++) {
                    let c = i + vec2<i32>(x, y);
                    let at = vec2<f32>(c) + vec2<f32>(hash3(vec3<i32>(c, 2), seed), hash3(vec3<i32>(c, 3), seed));
                    let d = length(g - at);
                    if d < d1 {
                        d2 = d1;
                        d1 = d;
                        near = c;
                    } else if d < d2 {
                        d2 = d;
                    }
                }
            }
            if d2 - d1 < 0.12 {
                return vec2<f32>(0.4, 0.2);
            }
            return vec2<f32>(0.7 + 0.35 * hash3(vec3<i32>(near, 4), seed), 0.0);
        }
        case 8u: { // glass curtain: 1.5 × 3.5 m panes between mullions
            let g = abs(fract(f / vec2<f32>(1.5, 3.5) + 0.5) - 0.5) * vec2<f32>(1.5, 3.5);
            if min(g.x, g.y) < 0.05 {
                return vec2<f32>(0.35, 0.3);
            }
            return vec2<f32>(1.0, -0.45);
        }
        case 9u: { // concrete: soft mottling and pores
            let pore = select(1.0, 0.6, hash3(vec3<i32>(floor(q * 220.0)), seed) > 0.985);
            return vec2<f32>((0.9 + 0.15 * (fbm(q * 6.0, seed) - 0.5)) * pore, 0.05);
        }
        case 10u: { // asphalt: speckled aggregate
            return vec2<f32>(0.7 + 0.6 * (vnoise(q * 90.0, seed) - 0.5) + 0.2 * (fbm(q * 3.0, seed) - 0.5), 0.15);
        }
        default: {
            return vec2<f32>(1.0, 0.0);
        }
    }
}

fn surface_of(in: MeshOut, local_n: vec3<f32>) -> Surface {
    var s = Surface(in.base.rgb, in.surface.x, in.surface.y, in.surface.z, in.specular.rgb, in.surface.w, in.specular.w);
    let id = (in.flags >> 9u) & 15u;
    if id != 0u {
        let t = pattern(id, in.local / max(in.base.w, 1e-6), local_n, in.flags >> 16u);
        s.base = s.base * t.x;
        s.rough = clamp(s.rough + t.y, 0.0, 1.0);
    }
    return s;
}

// Every shaded light's direct light on the surface, and the share of it the key light's shadow
// removes (for a catcher).
struct Direct {
    color: vec3<f32>,
    removed: f32,
};

fn direct(in: MeshOut, n: vec3<f32>, s: Surface, spread: f32) -> Direct {
    let v = select(normalize(lights.view.xyz), normalize(lights.view.xyz - in.world), lights.view.w > 0.5);
    let rough = clamp(s.rough, 0.045, 1.0);
    // Geometric specular antialiasing (Kaplanyan): the normal's change across the pixel widens
    // the lobe.
    let dn = dot(dpdx(n), dpdx(n)) + dot(dpdy(n), dpdy(n));
    // The lobe is never narrower than the pixel's footprint in slope space (#422): a lobe under a
    // pixel wide is point-sampled at pixel centers, and a mirror's sun loses up to a fifth of its
    // light between them. A rough lobe is left exactly as it is.
    // Toksvig's (#423): a normal map's normals that spread under the pixel shorten their mean,
    // and the lobe widens by the vMF lobe that mean fits, α² += 2 ÷ κ, κ = (3l − l³) ÷ (1 − l²).
    let l = spread;
    let tok = select(0.0, 2.0 * (1.0 - l * l) / max(3.0 * l - l * l * l, 1e-4), l < 0.9999);
    let a2 = clamp(max(rough * rough * rough * rough, min(dn, 0.18)) + min(tok, 1.0), 0.0, 1.0);
    let dfg_v = dfg_at(max(dot(n, v), 1e-4), rough);
    let catches = (in.flags & CATCH) != 0u;
    var out = vec3<f32>(0.0);
    var total = 0.0;
    var removed = 0.0;
    for (var i = 0u; i < lights.count.x; i++) {
        let li = lights.items[i];
        var add = vec3<f32>(0.0);
        if li.pos.w > 2.5 {
            add = area_light(li, in.world, n, v, s, a2, dfg_v);
        } else {
            var l = -li.dir.xyz;
            var e = li.color.rgb;
            if li.pos.w > 0.5 {
                let d = li.pos.xyz - in.world;
                let d2 = dot(d, d);
                l = d * inverseSqrt(d2);
                let fade = clamp(1.0 - pow(d2 / (li.dir.w * li.dir.w), 2.0), 0.0, 1.0);
                e = e * fade * fade / max(d2, li.color.w * li.color.w);
                if li.pos.w > 1.5 {
                    let t = clamp((dot(-l, li.dir.xyz) - li.cone.x) / max(li.cone.y - li.cone.x, 1e-4), 0.0, 1.0);
                    e = e * t * t;
                }
            }
            let nl = dot(n, l);
            if nl > 0.0 {
                let b = lobes(n, v, l, s, a2, dfg_v);
                add = (b.diffuse + b.spec) * e * nl;
            }
        }
        // The key sun's cascades shadow what receives (#422); a catcher keeps the light and
        // reports the share its shadow removes.
        var lit = 1.0;
        if lights.count.y == i + 1u && (in.flags & NO_RECEIVE) == 0u {
            lit = lit_share(in.world, n);
        }
        if catches {
            let y = dot(add, vec3<f32>(0.2126, 0.7152, 0.0722));
            total += y;
            removed += y * (1.0 - lit);
        } else {
            add = add * lit;
        }
        out += add;
    }
    return Direct(out, select(0.0, removed / total, total > 0.0));
}

// Ambient occlusion (#418; ao.wgsl): its blurred result and settings, read only by the solids.
struct Ao {
    clip: mat4x4<f32>,
    inv: mat4x4<f32>,
    size: vec4<f32>,
    // Samples, multi-bounce, specular, and 1 with ao on.
    opts: vec4<u32>,
    scale: vec4<f32>,
};

@group(2) @binding(0) var ao_t: texture_2d<f32>;
@group(2) @binding(1) var<uniform> ao: Ao;

// The ambient term's visibility at this pixel, brightened by the surface's albedo with
// multi-bounce on (Jimenez's fit); 1 with ao off.
fn occlusion(pos: vec2<f32>, albedo: vec3<f32>) -> vec3<f32> {
    if ao.opts.w == 0u {
        return vec3<f32>(1.0);
    }
    let dims = textureDimensions(ao_t);
    let at = min(vec2<u32>(pos * ao.scale.xy), dims - vec2<u32>(1u));
    let v = textureLoad(ao_t, at, 0).r;
    if ao.opts.y == 0u {
        return vec3<f32>(v);
    }
    let a = 2.0404 * albedo - 0.3324;
    let b = -4.7951 * albedo + 0.6417;
    let c = 2.7552 * albedo + 0.6903;
    return min(max(vec3<f32>(v), ((v * a + b) * v + c) * v), vec3<f32>(1.0));
}

// A band inside its item's margin keeps only its mask's pixels (#425), discarded after shading
// so every derivative the shading takes still sees the whole quad.
@fragment
fn mesh_fs(in: MeshOut, @builtin(front_facing) front: bool) -> Targets {
    // The texture coordinates' derivatives, while every pixel of the quad still runs (#423).
    let g = array<vec4<f32>, 2>(dpdx(in.uv), dpdy(in.uv));
    // Derivatives first, while every pixel of the quad still runs: the face's normal in its
    // part's own space, which a pattern reads.
    let local_n = normalize(cross(dpdx(in.local), dpdy(in.local)) + vec3<f32>(0.0, 1e-9, 0.0));
    let shaded = shade(in, front, local_n, g, false);
    if !band_keeps(vec2<u32>(in.pos.xy), in.pick, in.mask) {
        discard;
    }
    return shaded;
}

// `keyed`: with no light, no sky and no environment, a material takes the view's own key light, as
// a solid without a material does; only a material operator's solid asks for it (#429).
fn shade(in0: MeshOut, front: bool, local_n: vec3<f32>, g: array<vec4<f32>, 2>, keyed: bool) -> Targets {
    var in = in0;
    // A cutaway hides what lies past its planes (#424); with a cap, a back face seen through the
    // cut shades as the cut face: a matte surface of the cap's role on its plane, facing along
    // its normal, or the role itself under cap_light: flat.
    let cut = (in.flags & CUT) != 0u && frame.cut_info.x > 0u;
    if cut && cut_hides(in.world) {
        discard;
    }
    if cut && (frame.cut_info.z & 1u) != 0u && front == ((in.flags & MIRRORED) != 0u) {
        let c = cap_at(in.world);
        if c.w < 0.0 {
            discard;
        }
        in.world = c.xyz;
        in.normal = -frame.cut[u32(c.w)].xyz;
        in.base = vec4<f32>(frame.cap.rgb, 1.0);
        in.surface = vec4<f32>(0.0, 1.0, 0.0, 0.0);
        in.specular = vec4<f32>(1.0, 1.0, 1.0, 0.03);
        in.emission = vec4<f32>(0.0, 0.0, 0.0, 1.0);
        in.flags = (in.flags & (NO_RECEIVE | CUT)) | MATERIAL | DOUBLE_SIDED
            | select(UNLIT, 0u, (frame.cut_info.z & 2u) != 0u);
    }
    let n = normalize(in.normal);
    if (in.flags & MATERIAL) != 0u {
        // Its back faces are culled; a negative determinant turns its winding over.
        if (front == ((in.flags & MIRRORED) != 0u)) && (in.flags & DOUBLE_SIDED) == 0u {
            discard;
        }
        let mode = (in.flags >> 7u) & 3u;
        let geometric = select(-n, n, front != ((in.flags & MIRRORED) != 0u));
        var m = Mapped(surface_of(in, local_n), in.emission.w, geometric, 1.0, in.emission.rgb, 1.0);
        var cutoff = ALPHA_CUTOFF;
        if (in.flags & MAPS) != 0u {
            m = mapped(in, geometric, m.s, g);
            cutoff = maps.values.z;
        }
        // Its coverage: the material's alpha (times its base color map's) times the item's
        // opacity (#418). A mask with maps keeps its coverage here, from the map.
        var alpha = m.alpha;
        if mode == MASK {
            if alpha < cutoff {
                // The planted wrong program writes the part's ID through its hole.
                if (lights.count.z & IDS_THROUGH_MASK) != 0u {
                    return Targets(vec4<f32>(0.0), in.pick);
                }
                discard;
            }
            alpha = 1.0;
        }
        let s = m.s;
        let facing = m.n;
        if (in.flags & UNLIT) != 0u {
            return Targets(see_through(adjusted(s.base + m.emission, in.op.w), alpha, mode), in.pick);
        }
        let d = direct(in, facing, s, m.spread);
        // A shadow catcher writes black, as opaque as the share of light its shadow removes, at
        // its strength.
        if (in.flags & CATCH) != 0u {
            return Targets(vec4<f32>(0.0, 0.0, 0.0, d.removed * alpha * in.base.w), in.pick);
        }
        if keyed && lights.count.x == 0u && frame.sky_top.w <= 0.0 && env.k.x <= 0.0 {
            let key = 0.45 * occlusion(in.pos.xy, s.base) + 0.55 * max(dot(facing, frame.light.xyz), 0.0);
            let unlit = fogged(adjusted(s.base * key + in.emission.rgb, in.op.w), in.world);
            return Targets(see_through(unlit, alpha, mode), in.pick);
        }
        var ambient: vec3<f32>;
        if env.k.x > 0.0 {
            ambient = env_light(in, facing, s);
        } else {
            ambient = sky_light(in, facing, s);
        }
        // A map's occlusion scales the ambient term alone (#423).
        let lit = fogged(adjusted(d.color + ambient * m.occlusion + m.emission, in.op.w), in.world);
        return Targets(see_through(lit, alpha, mode), in.pick);
    }
    let facing = max(dot(n, frame.light.xyz), 0.0);
    // A sun (w > 0) lights by its illuminance over an ambient quarter; with none, the view's own
    // key light. Under a sky (#418) the ambient is the sky's, from above to below by the normal,
    // and only a sun lights directly. Ambient occlusion scales the ambient term alone, never the
    // direct light or the emission.
    var ambient = vec3<f32>(select(0.45, 0.25, frame.light.w > 0.0));
    var direct = select(0.55 * facing, 0.75 * frame.light.w * facing, frame.light.w > 0.0);
    if frame.sky_top.w > 0.0 {
        ambient = mix(frame.sky_low.rgb, frame.sky_top.rgb, n.y * 0.5 + 0.5);
        direct = select(0.0, frame.light.w * facing, frame.light.w > 0.0);
    }
    // Under the key sun's cascades (#422) a painted solid is shadowed as a material is.
    if lights.count.w > 0u && (in.flags & NO_RECEIVE) == 0u {
        direct = direct * lit_share(in.world, n);
    }
    let albedo = paint(in.color);
    let lit = ambient * occlusion(in.pos.xy, albedo) + vec3<f32>(direct);
    let a = in.emission.w;
    return Targets(vec4<f32>(fogged(adjusted(albedo * lit + in.emission.rgb, in.op.w), in.world) * a, a), in.pick);
}

// ---- the per-pixel resolve (#424; Object: see-through order): a per-pixel item's fragments
// join per-pixel lists in its writer layer, then one pass composites each pixel's by depth.

struct OitInfo {
    // Fragments written this frame (past `capacity` none is kept); the room; the target's width.
    count: atomic<u32>,
    capacity: u32,
    width: u32,
    pad: u32,
};

// Each pixel's list head (a node's index + 1, 0 for none); the nodes: premultiplied RGBA as
// halves, the depth's bits, the next node; the count.
@group(1) @binding(9) var<storage, read_write> oit_heads: array<atomic<u32>>;
@group(1) @binding(10) var<storage, read_write> oit_nodes: array<vec4<u32>>;
@group(1) @binding(11) var<storage, read_write> oit_info: OitInfo;

// The most fragments one pixel composites in depth order; any past them blend in behind them.
const OIT_LAYERS: u32 = 8u;

@fragment
fn oit_fs(in0: MeshOut, @builtin(front_facing) front: bool) -> Targets {
    let g = array<vec4<f32>, 2>(dpdx(in0.uv), dpdy(in0.uv));
    let local_n = normalize(cross(dpdx(in0.local), dpdy(in0.local)) + vec3<f32>(0.0, 1e-9, 0.0));
    var in = in0;
    in.flags = in.flags | DOUBLE_SIDED;
    let t = shade(in, front, local_n, g, false);
    let i = atomicAdd(&oit_info.count, 1u);
    if i < oit_info.capacity {
        let px = vec2<u32>(in.pos.xy);
        let prev = atomicExchange(&oit_heads[px.y * oit_info.width + px.x], i + 1u);
        oit_nodes[i] = vec4<u32>(pack2x16float(t.color.rg), pack2x16float(t.color.ba), bitcast<u32>(in.pos.z), prev);
    }
    return Targets(vec4<f32>(0.0), 0u);
}

// Each pixel's fragments, farthest first, over what's behind them; nothing when the frame ran
// out of room, where the per-pixel items draw sorted instead. The kept layers stay packed (two
// halves a word) so the pass holds few registers.
@fragment
fn oit_resolve_fs(@builtin(position) pos: vec4<f32>) -> Targets {
    if atomicLoad(&oit_info.count) > oit_info.capacity {
        discard;
    }
    let px = vec2<u32>(pos.xy);
    var at = atomicLoad(&oit_heads[px.y * oit_info.width + px.x]);
    if at == 0u {
        discard;
    }
    // Nearest first, as a depth key that grows toward the eye (reversed Z; the planted forward Z
    // turned over).
    let forward = frame.px.w > 0.5;
    var key: array<f32, 8>;
    var color: array<vec2<u32>, 8>;
    var n = 0u;
    var tail = vec4<f32>(0.0);
    var guard = 0u;
    while at != 0u && guard < 1048576u {
        let node = oit_nodes[at - 1u];
        var k = bitcast<f32>(node.z);
        if forward {
            k = -k;
        }
        var c = node.xy;
        if n == OIT_LAYERS {
            // Full: the farthest of the kept layers and this one, whichever is farther, blends in
            // behind the rest.
            if k > key[n - 1u] {
                let far = color[n - 1u];
                n -= 1u;
                tail = tail + vec4<f32>(unpack2x16float(far.x), unpack2x16float(far.y)) * (1.0 - tail.a);
            } else {
                tail = tail + vec4<f32>(unpack2x16float(c.x), unpack2x16float(c.y)) * (1.0 - tail.a);
                at = node.w;
                guard += 1u;
                continue;
            }
        }
        // Insert by key, nearest first.
        var j = n;
        while j > 0u && key[j - 1u] < k {
            key[j] = key[j - 1u];
            color[j] = color[j - 1u];
            j -= 1u;
        }
        key[j] = k;
        color[j] = c;
        n += 1u;
        at = node.w;
        guard += 1u;
    }
    var acc = tail;
    for (var i = n; i > 0u; i--) {
        let c = vec4<f32>(unpack2x16float(color[i - 1u].x), unpack2x16float(color[i - 1u].y));
        acc = c + acc * (1.0 - c.a);
    }
    return Targets(acc, 0u);
}

// A per-pixel item drawn sorted, only in a frame whose fragments ran out of room.
@fragment
fn oit_fallback_fs(in: MeshOut, @builtin(front_facing) front: bool) -> Targets {
    let g = array<vec4<f32>, 2>(dpdx(in.uv), dpdy(in.uv));
    let local_n = normalize(cross(dpdx(in.local), dpdy(in.local)) + vec3<f32>(0.0, 1e-9, 0.0));
    if atomicLoad(&oit_info.count) <= oit_info.capacity {
        discard;
    }
    return shade(in, front, local_n, g, false);
}

// A frame with a capped cutaway draws its solids through this entry (#424): a cap shades the back
// face seen through the cut, drawn an eighth of a pixel's depth slope nearer the eye (never past its plane),
// so a coplanar front face of a neighbouring part never hides it, while a front face of its own
// part in front of it still does.
struct CutTargets {
    @location(0) color: vec4<f32>,
    @location(1) id: u32,
    @builtin(frag_depth) depth: f32,
};

@fragment
fn mesh_cut_fs(in: MeshOut, @builtin(front_facing) front: bool) -> CutTargets {
    let g = array<vec4<f32>, 2>(dpdx(in.uv), dpdy(in.uv));
    let local_n = normalize(cross(dpdx(in.local), dpdy(in.local)) + vec3<f32>(0.0, 1e-9, 0.0));
    let slope = fwidth(in.pos.z);
    var depth = in.pos.z;
    let back = front == ((in.flags & MIRRORED) != 0u);
    if (in.flags & CUT) != 0u && frame.cut_info.x > 0u && (frame.cut_info.z & 1u) != 0u && back {
        let c = cap_at(in.world);
        if c.w >= 0.0 {
            let clip = frame.clip * vec4<f32>(c.xyz, 1.0);
            let plane = clip.z / clip.w;
            // Nearer is larger under reversed Z, smaller under the planted forward Z.
            if frame.px.w > 0.5 {
                depth = max(in.pos.z - 0.125 * slope, plane);
            } else {
                depth = min(in.pos.z + 0.125 * slope, plane);
            }
            depth = clamp(depth, 0.0, 1.0);
        }
    }
    let t = shade(in, front, local_n, g, false);
    // A band inside its margin keeps only its mask's pixels (#425), after shading.
    if !band_keeps(vec2<u32>(in.pos.xy), in.pick, in.mask) {
        discard;
    }
    return CutTargets(t.color, t.id, depth);
}

// The shadow passes' fragment stage: what a cutaway removes casts nothing (#424), and a band
// inside its margin casts only its mask's texels (#425).
@fragment
fn shadow_fs(in: MeshOut) {
    if ((in.flags & CUT) != 0u && cut_hides(in.world))
        || !band_keeps(vec2<u32>(in.pos.xy), in.pick, in.mask) {
        discard;
    }
}

// The ao prepass (#418): an opaque solid's world normal; its depth goes to the prepass's own
// depth target.
@fragment
fn ao_normal_fs(in: MeshOut) -> @location(0) vec4<f32> {
    // A see-through solid writes no occlusion depth, nor what a cutaway removes (#424); a band
    // keeps only its mask's pixels (#425).
    if in.emission.w < 1.0 || ((in.flags & CUT) != 0u && cut_hides(in.world))
        || !band_keeps(vec2<u32>(in.pos.xy), in.pick, in.mask) {
        discard;
    }
    return vec4<f32>(normalize(in.normal), 1.0);
}

// A sky's ambient light (#418) on a material: its diffuse share by the normal under ambient
// occlusion, and its specular share from the mirror direction through the DFG table with the
// multiple scattering restored, so rough metal under the sky keeps its brightness. None without
// a sky.
fn sky_light(in: MeshOut, n: vec3<f32>, s: Surface) -> vec3<f32> {
    if frame.sky_top.w <= 0.0 {
        return vec3<f32>(0.0);
    }
    let v = select(normalize(lights.view.xyz), normalize(lights.view.xyz - in.world), lights.view.w > 0.5);
    let rough = clamp(s.rough, 0.045, 1.0);
    let dfg_v = dfg_at(max(dot(n, v), 1e-4), rough);
    let albedo = max(dfg_v.x + dfg_v.y, 1e-4);
    let f0 = dielectric_f0(s);
    let e = f0 * dfg_v.x + dielectric_f90(s) * dfg_v.y;
    let metal = s.base * dfg_v.x + dfg_v.y;
    var spec = mix(e * (1.0 + f0 * (1.0 / albedo - 1.0)), metal * (1.0 + s.base * (1.0 / albedo - 1.0)), s.metallic);
    let r = reflect(-v, n);
    // A rough lobe sees the sky's average over the hemisphere, as a diffuse one does.
    let reflected = mix(sky_at(r), sky_at(n), rough * rough);
    let diffuse = s.base * (1.0 - s.metallic) * (1.0 - e);
    return diffuse * sky_at(n) * occlusion(in.pos.xy, diffuse) + spec * reflected;
}

// The environment's light on a material (#422): its irradiance by the normal on the diffuse
// lobe under ambient occlusion, and its prefiltered radiance along the mirror direction at the
// lobe's roughness on the specular lobes, each through the DFG table with the multiple
// scattering restored, the dielectric and metal lobes shaded apart and mixed by metallic.
fn env_light(in: MeshOut, n: vec3<f32>, s: Surface) -> vec3<f32> {
    let v = select(normalize(lights.view.xyz), normalize(lights.view.xyz - in.world), lights.view.w > 0.5);
    let rough = clamp(s.rough, 0.045, 1.0);
    let dfg_v = dfg_at(max(dot(n, v), 1e-4), rough);
    let off = (lights.count.z & NO_COMP) != 0u;
    let f0 = dielectric_f0(s);
    let e = f0 * dfg_v.x + dielectric_f90(s) * dfg_v.y;
    var spec: vec3<f32>;
    if (lights.count.z & PREMIX) != 0u {
        let pf0 = mix(f0, s.base, s.metallic);
        let pf90 = mix(dielectric_f90(s), 1.0, s.metallic);
        spec = (pf0 * dfg_v.x + pf90 * dfg_v.y) * compensation(pf0, dfg_v, off);
    } else {
        let metal = (s.base * dfg_v.x + dfg_v.y) * compensation(s.base, dfg_v, off);
        spec = mix(e * compensation(f0, dfg_v, off), metal, s.metallic);
    }
    let diffuse = s.base * (1.0 - s.metallic) * (1.0 - e);
    let r = reflect(-v, n);
    let lod = rough * env.k.y;
    return (diffuse * env_irradiance(n) * occlusion(in.pos.xy, diffuse) + spec * env_radiance(r, lod)) * env.k.z;
}

// A direction turned into the environment's own frame: back by its rotation about +Y.
fn env_dir(d: vec3<f32>) -> vec3<f32> {
    let c = cos(env.k.w);
    let s = sin(env.k.w);
    return vec3<f32>(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
}

// The prefiltered radiance along `d` at mip `lod`, mixed toward the second environment by `by`.
fn env_radiance(d: vec3<f32>, lod: f32) -> vec3<f32> {
    let e = env_dir(d);
    let a = textureSampleLevel(env_cube, env_sampler, e, lod).rgb;
    if env.m.x <= 0.0 {
        return a;
    }
    return mix(a, textureSampleLevel(env_cube_to, env_sampler, e, lod).rgb, env.m.x);
}

// The irradiance ÷ π a surface facing `n` gets, from the nine coefficients.
fn env_irradiance(n: vec3<f32>) -> vec3<f32> {
    let d = env_dir(n);
    let b0 = 0.282095;
    let b = array<f32, 9>(
        b0,
        0.488603 * d.y,
        0.488603 * d.z,
        0.488603 * d.x,
        1.092548 * d.x * d.y,
        1.092548 * d.y * d.z,
        0.315392 * (3.0 * d.z * d.z - 1.0),
        1.092548 * d.x * d.z,
        0.546274 * (d.x * d.x - d.y * d.y),
    );
    var a = vec3<f32>(0.0);
    var t = vec3<f32>(0.0);
    for (var k = 0u; k < 9u; k++) {
        a += env.sh[k].rgb * b[k];
        t += env.sh_to[k].rgb * b[k];
    }
    return max(mix(a, t, env.m.x), vec3<f32>(0.0));
}

// The sky's ambient light along `d`, from below to above.
fn sky_at(d: vec3<f32>) -> vec3<f32> {
    return mix(frame.sky_low.rgb, frame.sky_top.rgb, d.y * 0.5 + 0.5);
}

// A material's color into the linear target: opaque and mask parts whole, a blend part
// premultiplied by its alpha, an add part's color times alpha with no coverage of its own.
fn see_through(c: vec3<f32>, alpha: f32, mode: u32) -> vec4<f32> {
    if mode == ADD {
        return vec4<f32>(c * alpha, 0.0);
    }
    if mode == 2u {
        return vec4<f32>(c * alpha, alpha);
    }
    return vec4<f32>(c, 1.0);
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
    } else {
        w = w * frame.px.x;
    }
    let thin = max(w.x, w.y) <= frame.px.x;
    if (frame.px.y == 1.0 && thin) || (frame.px.y == 2.0 && !thin) {
        out.pos = OFF;
        return out;
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
    // A mesh-edge line (#420): a hair toward the camera under reversed Z, so the faces it
    // outlines don't hide it while a face in front still does; the planted one skips depth.
    if (flags & 2u) != 0u {
        out.pos.z = out.pos.z * 1.01;
    }
    if (flags & 4u) != 0u {
        out.pos.z = out.pos.w;
    }
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
    var size = p.w * frame.px.x;
    if (flags & 1u) != 0u {
        size = p.w * px_per_m(c);
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
    @location(4) @interpolate(flat) later: u32,
};

// A glyph whose color the label pass draws after the upscale (#1174): here it writes only the
// label's depth and pick.
const LATER: u32 = 256u;

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
    out.page = (flags >> 3u) & 31u;
    out.later = flags & LATER;
    let c = frame.clip * vec4<f32>(p.xyz, 1.0);
    if c.w <= 0.0 {
        out.pos = OFF;
        return out;
    }
    // The glyph's corner from the label's centre, in its size space: x right, y down.
    let offset = (rect.xy + k * rect.zw) * p.w;
    if (flags & 1u) == 0u {
        // In px: the label stays its size on screen about its projection.
        out.pos = from_px(to_px(c) + offset * frame.px.x, c);
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
    let shown = select(a, 0.0, in.later != 0u);
    return Targets(vec4<f32>(paint(in.color) * shown, shown), select(0u, in.pick, a >= 0.5));
}

// ---- the sky (#422): drawn first, behind everything, and what fog mixes toward

@vertex
fn sky_vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let x = f32(i32(i & 1u) * 4 - 1);
    let y = f32(i32(i >> 1u) * 4 - 1);
    // The far plane: 0 under reversed Z, 1 under the planted forward Z.
    return vec4<f32>(x, y, frame.px.w, 1.0);
}

// The view ray through pixel `px` of this target.
fn view_ray(px: vec2<f32>) -> vec3<f32> {
    let ndc = vec2<f32>(px.x / frame.viewport.x * 2.0 - 1.0, 1.0 - px.y / frame.viewport.y * 2.0);
    if env.eye.w < 0.5 {
        return normalize(lights.forward.xyz);
    }
    let p = env.inv * vec4<f32>(ndc, 0.5, 1.0);
    return normalize(p.xyz / p.w - env.eye.xyz);
}

fn star(d: vec3<f32>, density: f32) -> f32 {
    let cell = vec3<i32>(floor(d * 160.0));
    var h = 0x9e3779b9u;
    for (var k = 0u; k < 3u; k++) {
        h = h ^ bitcast<u32>(cell[k]);
        h = h * 0x85ebca6bu;
        h = h ^ (h >> 13u);
    }
    let r = f32(h % 10000u) / 10000.0;
    let cut = density * 0.02;
    return select(0.0, 0.5 + 2.0 * r / max(cut, 1e-9), r < cut);
}

// The sky's own fields along `d`: the gradient, the moon and the stars (env.rs's
// `sky_radiance`).
fn sky_fields(d: vec3<f32>) -> vec3<f32> {
    var c = mix(env.low.rgb, env.top.rgb, sqrt(max(d.y, 0.0)));
    if env.moon.w <= 1.0 && dot(d, env.moon.xyz) >= env.moon.w {
        let k = max(1.0, 4.0 * max(env.top.r, max(env.top.g, env.top.b)));
        c = vec3<f32>(k * 0.95, k * 0.97, k);
    }
    if env.top.w > 0.0 && d.y > 0.0 {
        c += vec3<f32>(star(d, env.top.w));
    }
    if env.sun.w <= 1.0 && dot(d, env.sun.xyz) >= env.sun.w {
        c = env.sun_color.rgb;
    }
    return c;
}

// What the background shows along `d` from the eye: the environment (on its ground when it has
// one, at its blur) or the sky's own fields.
fn background(d: vec3<f32>) -> vec3<f32> {
    if env.bg.x < 0.5 {
        return sky_fields(d);
    }
    var dir = d;
    if env.bg.w > 0.0 {
        let c = vec3<f32>(0.0, env.bg.z, 0.0);
        let o = env.eye.xyz - c;
        let b = dot(o, d);
        let t = -b + sqrt(max(b * b - (dot(o, o) - env.bg.w * env.bg.w), 0.0));
        var p = env.eye.xyz + d * t;
        if p.y < 0.0 && d.y < 0.0 {
            p = env.eye.xyz + d * (-env.eye.y / d.y);
        }
        dir = normalize(p - c);
    }
    return env_radiance(dir, env.bg.y) * env.k.z;
}

@fragment
fn sky_fs(@builtin(position) pos: vec4<f32>) -> Targets {
    return Targets(vec4<f32>(background(view_ray(pos.xy)), 1.0), 0u);
}

// Fog on a lit surface at `world` (#422; Sky `sky@1` and its height fog): the distance fog by
// its curve, and the mist below the height fog's top along the ray's length beneath it, mixed
// toward the fog's color or what the background shows along the ray.
fn fogged(c: vec3<f32>, world: vec3<f32>) -> vec3<f32> {
    if env.low.w < 0.5 || (env.fog.x <= 0.0 && env.fog.w <= 0.0) {
        return c;
    }
    let ray = world - env.eye.xyz;
    let dist = length(ray);
    let a = env.fog.x * dist;
    var keep = select(exp(-a), exp(-a * a), env.fog.y > 0.5);
    if env.fog.w > 0.0 {
        // The share of the ray below the top, from the eye to the surface.
        let y0 = env.eye.y;
        let y1 = world.y;
        var below = 0.0;
        if y0 <= env.fog.z && y1 <= env.fog.z {
            below = 1.0;
        } else if y0 <= env.fog.z || y1 <= env.fog.z {
            let cross = (env.fog.z - y0) / (y1 - y0);
            below = select(1.0 - cross, cross, y0 <= env.fog.z);
        }
        keep *= exp(-env.fog.w * dist * below);
    }
    var tint = env.fog_color.rgb;
    if env.fog_color.w > 0.5 {
        tint = background(ray / max(dist, 1e-6));
    }
    return mix(tint, c, keep);
}

// ---- puffs (#422; Puff `puff@1`): soft cloud sprites, back to front after the solids

struct PuffOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) q: vec2<f32>,
    @location(1) world: vec3<f32>,
    @location(2) @interpolate(flat) center: vec4<f32>,
    @location(3) @interpolate(flat) shape: vec4<f32>,
    @location(4) @interpolate(flat) light: vec4<f32>,
};

@vertex
fn puff_vs(
    @builtin(vertex_index) vi: u32,
    // xyz: where it is; w: its radius.
    @location(0) center: vec4<f32>,
    // Aspect, density, brightness and its seed.
    @location(1) shape: vec4<f32>,
    // Phase, shade, near fade, and bit 0: lit by the sun, bit 1: by the sky.
    @location(2) light: vec4<f32>,
) -> PuffOut {
    var out: PuffOut;
    let c = corner(vi) * 2.0 - 1.0;
    let world = center.xyz + frame.right.xyz * (c.x * center.w * shape.x) + frame.up.xyz * (c.y * center.w);
    out.pos = frame.clip * vec4<f32>(world, 1.0);
    out.q = c;
    out.world = world;
    out.center = center;
    out.shape = shape;
    out.light = light;
    return out;
}

@fragment
fn puff_fs(in: PuffOut) -> Targets {
    let r2 = dot(in.q, in.q);
    if r2 >= 1.0 {
        discard;
    }
    // Lumps from the puff's seed, the same in every frame: two crossed waves at phases its
    // seed's hash sets.
    let h = hash3(vec3<i32>(i32(in.shape.w), 7, 13), 422u);
    let lump = 1.0 + 0.25 * sin(in.q.x * 4.1 + h * 6.28318) * sin(in.q.y * 3.7 + h * 17.0);
    var alpha = clamp(in.shape.y * (1.0 - r2) * (1.0 - r2) * lump, 0.0, 1.0);
    if alpha < 0.002 {
        discard;
    }
    let eye = lights.view.xyz;
    let dist = length(in.center.xyz - eye) - in.center.w;
    if in.light.z > 0.0 {
        alpha *= clamp(dist / in.light.z, 0.0, 1.0);
    }
    // The sphere's normal under the sprite, facing the eye.
    let back = -normalize(cross(frame.right.xyz, frame.up.xyz));
    let n = normalize(frame.right.xyz * in.q.x + frame.up.xyz * in.q.y - back * sqrt(1.0 - r2));
    let flags = u32(in.light.w);
    var c = vec3<f32>(0.0);
    if (flags & 1u) != 0u && frame.light.w > 0.0 {
        let l = frame.light.xyz;
        let lit = mix(1.0, max(dot(n, l), 0.0) * 0.8 + 0.2, in.light.y);
        // Brighter toward the sun by a forward-scattering phase.
        let toward = max(dot(normalize(in.world - eye), l), 0.0);
        let phase = 1.0 + in.light.x * 3.0 * pow(toward, 8.0);
        c += vec3<f32>(frame.light.w * lit * phase);
    }
    if (flags & 2u) != 0u {
        if env.k.x > 0.0 {
            c += env_irradiance(n) * env.k.z;
        } else if frame.sky_top.w > 0.0 {
            c += mix(frame.sky_low.rgb, frame.sky_top.rgb, n.y * 0.5 + 0.5);
        }
    }
    c = fogged(c * in.shape.z * 0.9, in.world);
    return Targets(vec4<f32>(c * alpha, alpha), 0u);
}

