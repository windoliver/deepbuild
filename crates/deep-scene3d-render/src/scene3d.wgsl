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

// The object ID as two 16-bit halves: the multisampled ID target's format (#1173), which the
// resolve pass joins again.
struct Targets {
    @location(0) color: vec4<f32>,
    @location(1) id: vec2<u32>,
};

fn targets(color: vec4<f32>, id: u32) -> Targets {
    return Targets(color, vec2<u32>(id & 0xffffu, id >> 16u));
}

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
    // A spot's cos outer and cos inner; z: 1 + its local shadow, 0 for none; w: its receiver
    // set's bit (f32 bits), 0 for every part (#446).
    cone: vec4<f32>,
    // An area's half axes across its face, a point's or a spot's own unit axes; right.w: 1 for a
    // disk; up.w: 1 + its IES table's layer, 0 for none (#446).
    right: vec4<f32>,
    up: vec4<f32>,
};

// A shadowed local light's map (#446; Light policy: local shadows).
struct Local {
    // A spot's world to clip; a cube's world to its frame's axes, in the rotation's rows.
    clip: mat4x4<f32>,
    // xyz: the light; w: its map's far plane.
    pos: vec4<f32>,
    // Its near plane, its first layer, tan of half a map's field, and 1 for a cube.
    info: vec4<f32>,
    // The light's radius in m, and the share of its shadow the policy keeps.
    size: vec4<f32>,
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
    // Each cascade's depth range in m (#446).
    depths: vec4<f32>,
    // Soft shadows (#446; Light policy: soft shadows): x: 0 the tent, 1 Castaño's 9-tap filter,
    // 2 PCSS; y and z: the blocker and filter taps; w: the most a penumbra spreads, in texels.
    soft: vec4<f32>,
    // x: tan of half the key sun's angle; y: 1 with a contact shadow; z: 1 when a sample index
    // turns the disk, w its angle in radians (under samples per frame).
    key: vec4<f32>,
    // Each local map's side in texels in x.
    local_size: vec4<f32>,
    // x: 1 with a light grid; y and z: its far and near planes.
    grid: vec4<f32>,
    locals: array<Local, 12>,
    items: array<Light, 32>,
};

@group(1) @binding(0) var<uniform> lights: Lights;
// 32 × 32 entries, cos(view) across and roughness down, two to a vec4: (A, B) with the
// directional albedo F0·A + F90·B of the specular lobe.
// The DFG table, then the sheen lobe's albedo table four to an entry (#428).
@group(1) @binding(1) var<uniform> dfg: array<vec4<f32>, 1024>;
// The key sun's cascades (#422), one layer each (a texel's stand-in before one is drawn).
@group(1) @binding(2) var shadow_map: texture_depth_2d_array;
// Every local shadow map's layers (#446).
@group(1) @binding(14) var local_maps: texture_depth_2d_array;
// The IES tables, one layer each, and their sampler, wrapping in azimuth (#446).
@group(1) @binding(15) var ies_tables: texture_2d_array<f32>;
@group(1) @binding(16) var ies_sampler: sampler;
// The light grid's cells (#446; clusters.rs): each a bit per shaded light that reaches it.
@group(1) @binding(17) var<storage, read> light_grid: array<u32>;

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
    // x: 1 when the background shows the environment; y: its blur's roughness; z, w: its ground's
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
// The blurred background's own cubes (#426), from and to: one mip at the blur's roughness.
@group(1) @binding(18) var env_bg: texture_cube<f32>;
@group(1) @binding(19) var env_bg_to: texture_cube<f32>;
// The cascades' depth comparison: lit where the point lies no deeper than the map holds.
@group(1) @binding(7) var shadow_cmp: sampler_comparison;

// #422's planted shading: one F0 premixed from metallic; no multiple-scattering compensation;
// compensation on environment light only.
const NO_RECEIVE: u32 = 2u;
const PREMIX: u32 = 1u;
const NO_COMP: u32 = 2u;
const ENV_COMP_ONLY: u32 = 4u;

const PI: f32 = 3.14159265;
const TAU: f32 = 6.2831853;
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

// A material's extra lobes (#428), as lib.rs's `lobe_entry` packs them: sheen color and
// roughness; anisotropy, its rotation, diffuse roughness and retroreflection; translucency's
// color and wrap (< 0 for thin); transmission, ior, dispersion and thickness; attenuation per m
// and iridescence's weight; the film's ior and nm, the flakes' weight and size; the flakes'
// color and cos tilt; the flake seed.
struct LobeEntry {
    v: array<vec4<f32>, 8>,
};
@group(1) @binding(12) var<uniform> lobe_table: array<LobeEntry, 512>;
// The opaque scene's copy with mips, which transmission samples (#428).
@group(1) @binding(13) var opaque: texture_2d<f32>;

// Whether this pipeline shades extra lobes (#432: one pipeline per feature set): the opaque
// solids' plain pipelines are made with it off, so their lobe code folds away, and a part with
// lobes draws through the pipeline made with it on.
override LOBES: bool = true;

// The part's lobes' entry, 0 for none.
fn lobe_index(in: MeshOut) -> u32 {
    return select(0u, in.op.w >> 16u, LOBES);
}

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
fn adjusted(c0: vec3<f32>, k0: u32) -> vec3<f32> {
    // The lobe table's index rides above the adjust's (#428).
    let k = k0 & 0xffffu;
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
    // Its band's mask inside a margin (#425); and the part's rotation as a unit quaternion's
    // vector (its w ≥ 0, two 16-bit snorm pairs), which flakes read (#428).
    @location(14) @interpolate(flat) mask: vec4<u32>,
    // Its normal in its mesh's own space; its material operator's time (f32 bits), seed and the
    // item's opacity (f32 bits), which a material operator reads (#429).
    @location(12) object_n: vec3<f32>,
    @location(13) @interpolate(flat) op: vec4<u32>,
};

// A model's rotation and scale from its columns (#428): the rotation of its axes made
// orthonormal, as a unit quaternion's vector with w ≥ 0, and cbrt |det|.
fn part_of(c0: vec3<f32>, c1: vec3<f32>, c2: vec3<f32>) -> vec4<f32> {
    let x = normalize(c0);
    let y = normalize(c1 - x * dot(x, c1));
    let z = cross(x, y) * select(-1.0, 1.0, dot(cross(c0, c1), c2) >= 0.0);
    let tr = x.x + y.y + z.z;
    var q: vec4<f32>;
    if tr > 0.0 {
        let k = 0.5 / sqrt(tr + 1.0);
        q = vec4<f32>((y.z - z.y) * k, (z.x - x.z) * k, (x.y - y.x) * k, 0.25 / k);
    } else if x.x > y.y && x.x > z.z {
        let k = 2.0 * sqrt(1.0 + x.x - y.y - z.z);
        q = vec4<f32>(0.25 * k, (y.x + x.y) / k, (z.x + x.z) / k, (y.z - z.y) / k);
    } else if y.y > z.z {
        let k = 2.0 * sqrt(1.0 + y.y - x.x - z.z);
        q = vec4<f32>((y.x + x.y) / k, 0.25 * k, (z.y + y.z) / k, (z.x - x.z) / k);
    } else {
        let k = 2.0 * sqrt(1.0 + z.z - x.x - y.y);
        q = vec4<f32>((z.x + x.z) / k, (z.y + y.z) / k, 0.25 * k, (x.y - y.x) / k);
    }
    q = normalize(q) * select(-1.0, 1.0, q.w >= 0.0);
    return vec4<f32>(q.xyz, pow(abs(dot(c0, cross(c1, c2))), 1.0 / 3.0));
}

// A solid's record as storage (the renderer's `SolidRecord`), which a culled batch's vertex stage
// reads by the row its cull kept (#484).
struct Element {
    r0: vec4<f32>,
    r1: vec4<f32>,
    r2: vec4<f32>,
    color: u32,
    pick: u32,
    flags: u32,
    tie: u32,
    emission: vec4<f32>,
    base: vec4<f32>,
    surface: vec4<f32>,
    specular: vec4<f32>,
    op: vec4<u32>,
}
@group(4) @binding(0) var<storage, read> elements: array<Element>;

// The planted wrong object-ID pass: a row's place in the compacted list taken as its element.
const IDS_BY_PLACE: bool = false;

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
    return mesh_out(p, n, Element(r0, r1, r2, color, pick, flags, tie, emission, base, surface, specular, op), uv, tangent);
}

@vertex
fn mesh_row_vs(
    @location(0) p: vec3<f32>,
    @location(1) n: vec3<f32>,
    @location(2) row: u32,
    @location(13) uv: vec4<f32>,
    @location(14) tangent: vec4<f32>,
    @builtin(instance_index) place: u32,
) -> MeshOut {
    var e = elements[row];
    if IDS_BY_PLACE {
        e.pick = elements[place].pick;
    }
    return mesh_out(p, n, e, uv, tangent);
}

fn mesh_out(p: vec3<f32>, n: vec3<f32>, e: Element, uv: vec4<f32>, tangent: vec4<f32>) -> MeshOut {
    let r0 = e.r0;
    let r1 = e.r1;
    let r2 = e.r2;
    let color = e.color;
    let pick = e.pick;
    let flags = e.flags;
    let tie = e.tie;
    let emission = e.emission;
    let base = e.base;
    let surface = e.surface;
    let specular = e.specular;
    let op = e.op;
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
    // Where the device has no unclipped depth, what lies before the near plane lands on it.
    if frame.light.w < -1.5 {
        out.pos.z = max(out.pos.z, 0.0);
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
    out.mask.x = tie >> MASK_SHIFT;
    let rank = tie & RANK;
    if frame.light.w >= 0.0 && rank > 0u {
        let cos_t = max(abs(dot(cof, normalize(cross(frame.up.xyz, frame.right.xyz)))), 1.0 / 64.0);
        let slope = sqrt(1.0 - cos_t * cos_t) / cos_t / max(frame.viewport.z, 1.0);
        // 2⁻²² a rank is two f32 steps of depth: enough to part an exact tie, and small enough
        // that a thin part 0.05 mm in front of another on a 200 m range stays in front (#428).
        let k = f32(rank) * (2.384e-7 + slope / 64.0);
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
    let part = part_of(c0, c1, c2);
    out.mask = vec4<u32>(out.mask.x, pack2x16snorm(part.xy), pack2x16snorm(vec2<f32>(part.z, 0.0)), 0u);
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
            // Toksvig's spread is the normals under the pixel's footprint: where the map is
            // magnified, a texel or less a pixel, a shorter normal is only the bilinear blend of
            // neighbouring texels, so the lobe keeps its width (#428).
            let size = vec2<f32>(textureDimensions(map_normal));
            let foot = max(length(map_d(2u, g[0]) * size), length(map_d(2u, g[1]) * size));
            spread = mix(1.0, clamp(length(c), 1e-3, 1.0), clamp(foot - 1.0, 0.0, 1.0));
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
    // Its lobes' entry (#428), 0 for none; the anisotropy's direction and the flake's normal in
    // the world, each set only where its lobe is on.
    k: u32,
    t: vec3<f32>,
    flake: vec3<f32>,
    // The sheen lobe's albedo at the view, read once a pixel (#428).
    sheen_ev: f32,
    // The flake lobe's α², widened where a cell is smaller than the pixel's footprint.
    flake_a2: f32,
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
    // #428's planted wrong program drops the specular color.
    return min(0.08 * s.level, 1.0) * select(s.specular, vec3<f32>(1.0), planted(P_SPECULAR_COLOR));
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

// ---- the extra lobes (#428; Material): each read only where its part's lobe entry turns it on.

fn lobe(k: u32, i: u32) -> vec4<f32> {
    return lobe_table[k - 1u].v[i];
}

// A part's whole lobe entry, read once where a function needs most of it.
fn entry_of(k: u32) -> array<vec4<f32>, 8> {
    return lobe_table[k - 1u].v;
}

fn max3(c: vec3<f32>) -> f32 {
    return max(c.r, max(c.g, c.b));
}

// Charlie's sheen distribution and Estevez and Kulla's visibility, as KHR_materials_sheen
// gives them, at α = sheen roughness².
fn sheen_d(nh: f32, a: f32) -> f32 {
    let inv = 1.0 / a;
    let sin2 = max(1.0 - nh * nh, 1e-7);
    return (2.0 + inv) * pow(sin2, 0.5 * inv) / (2.0 * PI);
}

fn sheen_l(x: f32, a: f32) -> f32 {
    let t = (1.0 - a) * (1.0 - a);
    let p = mix(21.5473, 25.3245, t);
    let q = mix(3.82987, 3.32435, t);
    let r = mix(0.19823, 0.16801, t);
    let u = mix(-1.97760, -1.27393, t);
    let w = mix(-4.32054, -4.85967, t);
    return p / (1.0 + q * pow(x, r)) + u * x + w;
}

// Λ(c), with L(0.5) given: it is the same for both directions.
fn sheen_lambda(c: f32, a: f32, l5: f32) -> f32 {
    return exp(select(2.0 * l5 - sheen_l(1.0 - c, a), sheen_l(c, a), c < 0.5));
}

fn sheen_v(nv: f32, nl: f32, a: f32) -> f32 {
    let l5 = sheen_l(0.5, a);
    return clamp(1.0 / ((1.0 + sheen_lambda(nv, a, l5) + sheen_lambda(nl, a, l5)) * 4.0 * nv * nl), 0.0, 1.0);
}

// The sheen lobe's directional albedo at (cos view, sheen roughness), bilinear, from the table
// after the DFG's.
fn sheen_e(nv: f32, rough: f32) -> f32 {
    let x = clamp(nv * 63.0, 0.0, 63.0);
    let y = clamp(rough * 31.0, 0.0, 31.0);
    let x0 = u32(floor(x));
    let y0 = u32(floor(y));
    let x1 = min(x0 + 1u, 63u);
    let y1 = min(y0 + 1u, 31u);
    let fx = x - f32(x0);
    let fy = y - f32(y0);
    let a = mix(sheen_at(y0 * 64u + x0), sheen_at(y0 * 64u + x1), fx);
    let b = mix(sheen_at(y1 * 64u + x0), sheen_at(y1 * 64u + x1), fx);
    return mix(a, b, fy);
}

fn sheen_at(i: u32) -> f32 {
    // A dot with a one-hot lane, not a dynamic component index, which spills to memory.
    let lane = vec4<f32>(vec4<u32>(0u, 1u, 2u, 3u) == vec4<u32>(i & 3u));
    return dot(dfg[512u + (i >> 2u)], lane);
}

// The anisotropic GGX distribution and height-correlated visibility (KHR_materials_anisotropy),
// at α along the tangent `at` and along the bitangent `ab`.
fn ggx_aniso(n: vec3<f32>, t: vec3<f32>, b: vec3<f32>, h: vec3<f32>, at: f32, ab: f32) -> f32 {
    let a2 = at * ab;
    let f = vec3<f32>(ab * dot(t, h), at * dot(b, h), a2 * dot(n, h));
    let w2 = a2 / max(dot(f, f), 1e-12);
    return a2 * w2 * w2 / PI;
}

fn vis_aniso(n: vec3<f32>, t: vec3<f32>, b: vec3<f32>, v: vec3<f32>, l: vec3<f32>, at: f32, ab: f32) -> f32 {
    let nv = max(dot(n, v), 1e-4);
    let nl = max(dot(n, l), 1e-4);
    let gv = nl * length(vec3<f32>(at * dot(t, v), ab * dot(b, v), nv));
    let gl = nv * length(vec3<f32>(at * dot(t, l), ab * dot(b, l), nl));
    return clamp(0.5 / max(gv + gl, 1e-6), 0.0, 1e6);
}

// The thin film's Fresnel (KHR_materials_iridescence; Belcour and Barla): a film of `film_ior`
// and `nm` nanometres over a base of reflectance `f0`, at the cosine `c1` outside it.
fn ior_to_f0(t: f32, i: f32) -> f32 {
    let r = (t - i) / (t + i);
    return r * r;
}

fn sensitivity(opd: f32, shift: vec3<f32>) -> vec3<f32> {
    let phase = 2.0 * PI * opd * 1.0e-9;
    let val = vec3<f32>(5.4856e-13, 4.4201e-13, 5.2481e-13);
    let pos = vec3<f32>(1.6810e+06, 1.7953e+06, 2.2084e+06);
    let vr = vec3<f32>(4.3278e+09, 9.3046e+09, 6.6121e+09);
    var xyz = val * sqrt(2.0 * PI * vr) * cos(pos * phase + shift) * exp(-phase * phase * vr);
    xyz.x += 9.7470e-14 * sqrt(2.0 * PI * 4.5282e+09) * cos(2.2399e+06 * phase + shift.x)
        * exp(-4.5282e+09 * phase * phase);
    xyz = xyz / 1.0685e-7;
    return vec3<f32>(
        3.2404542 * xyz.x - 1.5371385 * xyz.y - 0.4985314 * xyz.z,
        -0.9692660 * xyz.x + 1.8760108 * xyz.y + 0.0415560 * xyz.z,
        0.0556434 * xyz.x - 0.2040259 * xyz.y + 1.0572252 * xyz.z,
    );
}

fn iridescence(film_ior0: f32, c1: f32, nm: f32, f0: vec3<f32>) -> vec3<f32> {
    let film_ior = mix(1.0, film_ior0, smoothstep(0.0, 0.03, nm));
    let sin2 = (1.0 / film_ior) * (1.0 / film_ior) * (1.0 - c1 * c1);
    let cos2sq = 1.0 - sin2;
    if cos2sq < 0.0 {
        return vec3<f32>(1.0);
    }
    let c2 = sqrt(cos2sq);
    let r0 = ior_to_f0(film_ior, 1.0);
    let r12 = r0 + (1.0 - r0) * pow(1.0 - c1, 5.0);
    let t121 = 1.0 - r12;
    let phi12 = select(0.0, PI, film_ior < 1.0);
    let phi21 = PI - phi12;
    let sf0 = sqrt(clamp(f0, vec3<f32>(0.0), vec3<f32>(0.9999)));
    let base_ior = (1.0 + sf0) / (1.0 - sf0);
    let rb = (base_ior - film_ior) / (base_ior + film_ior);
    let r1 = rb * rb;
    let r23 = r1 + (1.0 - r1) * pow(1.0 - c2, 5.0);
    let phi23 = select(vec3<f32>(0.0), vec3<f32>(PI), base_ior < vec3<f32>(film_ior));
    let opd = 2.0 * film_ior * nm * c2;
    let phi = vec3<f32>(phi21) + phi23;
    let r123 = clamp(r12 * r23, vec3<f32>(1e-5), vec3<f32>(0.9999));
    let rr = sqrt(r123);
    let rs = t121 * t121 * r23 / (1.0 - r123);
    var out = r12 + rs;
    var cm = rs - t121;
    for (var m = 1; m <= 2; m++) {
        cm = cm * rr;
        out += cm * 2.0 * sensitivity(f32(m) * opd, f32(m) * phi);
    }
    return max(out, vec3<f32>(0.0));
}

// Energy-preserving Oren-Nayar (KHR_materials_diffuse_roughness; Portsmouth et al.'s EON), per
// unit illuminance: its single-scattering FON lobe with the multiple scattering it loses.
const FON_1: f32 = 0.5 - 2.0 / (3.0 * PI);
const FON_2: f32 = 2.0 / 3.0 - 28.0 / (15.0 * PI);

// FON's directional albedo, exact (Portsmouth et al.).
fn fon_e(mu0: f32, r: f32) -> f32 {
    let mu = clamp(mu0, 1e-7, 1.0);
    let af = 1.0 / (1.0 + FON_1 * r);
    let si = sqrt(max(1.0 - mu * mu, 0.0));
    let g = si * (acos(mu) - si * mu) + (2.0 / 3.0) * ((si / mu) * (1.0 - si * si * si) - si);
    return af + r * af / PI * g;
}

// f_EON(ρ, r; l, v) about n, without the cosine; `ms` false leaves FON's single scattering.
fn eon(rho: vec3<f32>, r: f32, n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, ms: bool) -> vec3<f32> {
    let mi = dot(n, l);
    let mo = dot(n, v);
    let sv = dot(l, v) - mi * mo;
    let st = select(sv, sv / max(mi, mo), sv > 0.0);
    let af = 1.0 / (1.0 + FON_1 * r);
    let ss = rho / PI * af * (1.0 + r * st);
    if !ms {
        return ss;
    }
    let avg = af * (1.0 + FON_2 * r);
    let rho_ms = rho * rho * avg / (1.0 - rho * (1.0 - avg));
    return ss + rho_ms / PI * max(1e-7, 1.0 - fon_e(mo, r)) * max(1e-7, 1.0 - fon_e(mi, r)) / max(1e-7, 1.0 - avg);
}

// EON's directional albedo at the view: what the environment's diffuse light is scaled by.
fn eon_albedo(rho: vec3<f32>, r: f32, mu: f32) -> vec3<f32> {
    let af = 1.0 / (1.0 + FON_1 * r);
    let ef = fon_e(mu, r);
    let avg = af * (1.0 + FON_2 * r);
    let rho_ms = rho * rho * avg / (1.0 - rho * (1.0 - avg));
    return rho * ef + rho_ms * (1.0 - ef);
}

// #428's planted wrong programs, bits of the lights' planted word.
const P_ABSORPTION_FIXED: u32 = 16u;
const P_ROUGHNESS_IGNORED: u32 = 32u;
const P_DISPERSION_ONCE: u32 = 64u;
const P_SPECULAR_COLOR: u32 = 128u;
const P_FILM_400: u32 = 256u;
const P_LAMBERT: u32 = 512u;
const P_FON: u32 = 1024u;
const P_RETRO: u32 = 2048u;
const P_FLAKES_BY_PIXEL: u32 = 4096u;

fn planted(bit: u32) -> bool {
    return (lights.count.z & bit) != 0u;
}

// The dielectric's F0 per channel before its weight (KHR_materials_ior and _specular:
// min(F0(ior) × specular color, 1)), and its weight, glTF's specular strength (2 × level).
fn lobe_f0(s: Surface) -> vec3<f32> {
    let ior = lobe(s.k, 3u).y;
    let r = (ior - 1.0) / (ior + 1.0);
    let color = select(s.specular, vec3<f32>(1.0), planted(P_SPECULAR_COLOR));
    return min(r * r * color, vec3<f32>(1.0));
}

fn lobe_weight(s: Surface) -> f32 {
    return 2.0 * s.level;
}

// The specular lobe's D × V at view `vv`, isotropic or stretched along s.t (KHR_materials_
// anisotropy: αt = mix(α, 1, strength²), αb = α).
fn spec_d_vis(n: vec3<f32>, vv: vec3<f32>, l: vec3<f32>, s: Surface, a2: f32) -> f32 {
    let h = normalize(l + vv);
    let nl = max(dot(n, l), 1e-4);
    let nv = max(dot(n, vv), 1e-4);
    let x = lobe(s.k, 1u).x;
    if x != 0.0 {
        let a = sqrt(a2);
        let at = a + (1.0 - a) * x * x;
        let b = cross(n, s.t);
        return ggx_aniso(n, s.t, b, h, at, max(a, 1e-4)) * vis_aniso(n, s.t, b, vv, l, at, max(a, 1e-4));
    }
    let vis = 0.5 / max(nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2), 1e-6);
    return ggx(max(dot(n, h), 0.0), a2) * vis;
}

fn schlick3(f0: vec3<f32>, c: f32) -> vec3<f32> {
    let m = 1.0 - clamp(c, 0.0, 1.0);
    let m2 = m * m;
    return f0 + (1.0 - f0) * (m2 * m2 * m);
}

// glTF's BRDF with every extra lobe the part's entry turns on, per unit illuminance and times
// |n·l| (thin translucency reads light from behind through its mirror direction, wrap reaches
// past the shadow line): the metal and the dielectric (KHR_materials_specular's fresnel_mix,
// its iridescent twin by weight) mixed by metallic; the diffuse Lambert or EON, less what
// transmission and translucency take; retroreflection's mirrored-view lobe mixed in by its
// amount; sheen over all of it with its albedo scaling; the flakes mixed in by weight; the coat.
fn extra_lobes(n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, s: Surface, a2: f32, dfg_v: vec2<f32>) -> vec3<f32> {
    let k = s.k;
    let nl_raw = dot(n, l);
    let nv = max(dot(n, v), 1e-4);
    let L = entry_of(k);
    let sheen = L[0];
    let x1 = L[1];
    let tr = L[2];
    let t3 = L[3];
    let film = L[5];
    let irid = L[4].w;
    let amount = L[7].y;
    let thin = tr.w < 0.0;
    let wrap = max(tr.w, 0.0);
    let back = nl_raw < 0.0;
    let lit_wrap = !thin && amount > 0.0 && nl_raw > -wrap;
    if back && !((thin && amount > 0.0) || lit_wrap) {
        return vec3<f32>(0.0);
    }
    // A light behind a thin part shades through its mirror direction.
    let ls = select(l, l - n * (2.0 * nl_raw), back && thin);
    let nl = max(abs(nl_raw), 1e-4);
    let h = normalize(ls + v);
    let vh = max(dot(v, h), 0.0);
    let retro = select(x1.w, 0.0, planted(P_RETRO));
    var dv = 0.0;
    var dvm = 0.0;
    var vhr = 0.0;
    if !back {
        dv = spec_d_vis(n, v, ls, s, a2);
        if retro > 0.0 {
            let vm = normalize(2.0 * dot(n, v) * n - v);
            vhr = max(dot(vm, normalize(ls + vm)), 0.0);
            dvm = spec_d_vis(n, vm, ls, s, a2);
        }
    }
    let w = lobe_weight(s);
    let f0 = lobe_f0(s);
    let fs = schlick3(f0, vh);
    var fd = w * fs;
    if retro > 0.0 {
        fd = w * mix(fs, schlick3(f0, vhr), retro);
    }
    // The diffuse, times its cosine: Lambert or EON, less transmission's and translucency's
    // shares; the light thin translucency lets through; wrap's share past the shadow line,
    // normalized so it reflects no more than Lambert.
    let keep = 1.0 - t3.x;
    var diffuse = vec3<f32>(0.0);
    if back && thin {
        diffuse = tr.rgb * amount / PI * nl * keep;
    } else {
        var lam = s.base / PI;
        if x1.z > 0.0 && !planted(P_LAMBERT) {
            lam = eon(s.base, x1.z, n, v, ls, !planted(P_FON));
        }
        let front = lam * max(nl_raw, 0.0);
        if thin {
            diffuse = front * (1.0 - amount) * keep;
        } else {
            let wrapped = max((nl_raw + wrap) / ((1.0 + wrap) * (1.0 + wrap)), 0.0);
            diffuse = (front * (1.0 - amount) + s.base / PI * tr.rgb * amount * wrapped) * keep;
        }
    }
    let off = (lights.count.z & (NO_COMP | ENV_COMP_ONLY)) != 0u;
    let comp_d = compensation(w * f0, dfg_v, off);
    var lobe_d = dv * fs;
    var lobe_m = dv * schlick3(s.base, vh);
    if retro > 0.0 {
        lobe_d = mix(lobe_d, dvm * schlick3(f0, vhr), retro);
        lobe_m = mix(lobe_m, dvm * schlick3(s.base, vhr), retro);
    }
    var dielectric = (1.0 - max3(fd)) * diffuse + w * lobe_d * comp_d * nl;
    if irid > 0.0 {
        let nm = select(film.y, 400.0, planted(P_FILM_400));
        let fi = iridescence(film.x, vh, nm, f0);
        let layer = (1.0 - max3(fi)) * diffuse + fi * dv * compensation(fi, dfg_v, off) * nl;
        dielectric = mix(dielectric, layer, irid);
    }
    let metal = lobe_m * compensation(s.base, dfg_v, off) * nl;
    var out = mix(dielectric, metal, s.metallic);
    if max3(sheen.rgb) > 0.0 {
        let e = max3(sheen.rgb);
        let scale = min(1.0 - e * s.sheen_ev, 1.0 - e * sheen_e(nl, sheen.w));
        var f_sheen = vec3<f32>(0.0);
        if !back {
            let a = max(sheen.w, 1e-3) * max(sheen.w, 1e-3);
            f_sheen = sheen.rgb * sheen_d(max(dot(n, h), 0.0), a) * sheen_v(nv, nl, a) * nl;
        }
        out = f_sheen + out * scale;
    }
    // Flakes under the coat: a metal of their color through GGX at the coat's roughness, mixed in
    // by weight.
    if film.z > 0.0 && !back {
        let fl = s.flake;
        let fa2 = s.flake_a2;
        let fnh = max(dot(fl, h), 0.0);
        let fnl = max(dot(fl, ls), 0.0);
        let fnv = max(dot(fl, v), 1e-4);
        let col = lobe(k, 6u).rgb;
        let fvis = 0.5 / max(fnl * sqrt(fnv * fnv * (1.0 - fa2) + fa2) + fnv * sqrt(fnl * fnl * (1.0 - fa2) + fa2), 1e-6);
        let flake = schlick3(col, vh) * ggx(fnh, fa2) * fvis * fnl;
        out = mix(out, flake, film.z);
    }
    if s.coat > 0.0 && !back {
        let ca = max(s.coat_rough * s.coat_rough, 0.002);
        let fc = (0.04 + 0.96 * pow(1.0 - vh, 5.0)) * s.coat;
        let coat = ggx(max(dot(n, h), 0.0), ca * ca) * 0.25 / max(vh * vh, 1e-4) * fc;
        out = out * (1.0 - fc) + vec3<f32>(coat) * nl;
    }
    return out;
}

// The light a transmissive part lets through at a pixel (#428; KHR_materials_transmission,
// _volume and _dispersion, as the glTF Sample Viewer draws them): the view ray refracted at
// `ior` through the part's thickness (times its scale), the opaque scene's copy read where it
// leaves, trilinearly at level log2(its larger side) × roughness × clamp(2·ior − 2, 0, 1),
// attenuated by Beer-Lambert along that path, times what the surface's Fresnel at n·v lets in
// and its base color. With dispersion each channel refracts at its own IOR.
fn transmitted(in: MeshOut, n: vec3<f32>, v: vec3<f32>, s: Surface) -> vec3<f32> {
    let t3 = lobe(s.k, 3u);
    let sigma = lobe(s.k, 4u).rgb;
    let size = vec2<f32>(textureDimensions(opaque));
    let rough = select(clamp(s.rough, 0.0, 1.0), 0.0, planted(P_ROUGHNESS_IGNORED));
    let lod = log2(max(size.x, size.y)) * rough * clamp(t3.y * 2.0 - 2.0, 0.0, 1.0);
    let spread = select((t3.y - 1.0) * 0.025 * t3.z, 0.0, planted(P_DISPERSION_ONCE));
    let thickness = t3.w;
    let path = select(thickness, 0.02, planted(P_ABSORPTION_FIXED));
    let px = in.pos.xy / vec2<f32>(frame.viewport.xy);
    var out = vec3<f32>(0.0);
    let channels = select(1u, 3u, spread > 0.0);
    for (var c = 0u; c < channels; c++) {
        let ior = t3.y + spread * (f32(c) - 1.0);
        var uv = px;
        if thickness > 0.0 {
            let r = refract(-v, n, 1.0 / ior);
            if dot(r, r) > 0.0 {
                let exit = frame.clip * vec4<f32>(in.world + normalize(r) * thickness, 1.0);
                uv = (exit.xy / exit.w) * vec2<f32>(0.5, -0.5) + 0.5;
            }
        }
        let seen = textureSampleLevel(opaque, env_sampler, uv, lod).rgb;
        if channels == 1u {
            out = seen;
        } else {
            out[c] = seen[c];
        }
    }
    let f = lobe_weight(s) * schlick3(lobe_f0(s), max(dot(n, v), 0.0));
    return t3.x * (1.0 - max3(f)) * s.base * exp(-sigma * path) * out;
}

// Duff et al.'s orthonormal basis about unit n.
fn onb(n: vec3<f32>) -> array<vec3<f32>, 2> {
    let sg = select(-1.0, 1.0, n.z >= 0.0);
    let a = -1.0 / (sg + n.z);
    let b = n.x * n.y * a;
    return array<vec3<f32>, 2>(
        vec3<f32>(1.0 + sg * n.x * n.x * a, sg * b, -sg * n.x),
        vec3<f32>(b, sg + n.y * n.y * a, -n.y),
    );
}

// A unit quaternion's rotation of `v`.
fn rotate_q(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
    let t = 2.0 * cross(q.xyz, v);
    return v + q.w * t + cross(q.xyz, t);
}

// A part's anisotropy direction and flake normal at a pixel (#428): the tangent along uv0's u,
// turned by the rotation; and the flake of the cell of its own space that holds the pixel,
// tilted from the shading normal in the part's own space by hash(its seed, the cell).
fn with_lobes(in: MeshOut, n: vec3<f32>, s0: Surface) -> Surface {
    var s = s0;
    if s.k == 0u {
        return s;
    }
    let x1 = lobe(s.k, 1u);
    if x1.x != 0.0 {
        var t = in.tangent.xyz - n * dot(n, in.tangent.xyz);
        if dot(t, t) < 1e-12 {
            // No tangent: uv0's u direction from its derivatives.
            let dp = dpdx(in.world);
            let dq = dpdy(in.world);
            let du = dpdx(in.uv.xy);
            let dv = dpdy(in.uv.xy);
            t = dp * dv.y - dq * du.y;
            t = t - n * dot(n, t);
        }
        t = normalize(t + vec3<f32>(1e-9, 0.0, 0.0));
        let b = cross(n, t) * select(1.0, -1.0, in.tangent.w < 0.0);
        // A negative strength stretches across the tangent instead.
        let r = x1.y + select(0.0, 0.5 * PI, x1.x < 0.0);
        s.t = normalize(t * cos(r) + b * sin(r));
    }
    let sheen = lobe(s.k, 0u);
    if max3(sheen.rgb) > 0.0 {
        let v = select(normalize(lights.view.xyz), normalize(lights.view.xyz - in.world), lights.view.w > 0.5);
        s.sheen_ev = sheen_e(max(dot(n, v), 1e-4), sheen.w);
    }
    let film = lobe(s.k, 5u);
    if film.z > 0.0 {
        var cell = vec3<i32>(floor(in.local / film.w));
        if planted(P_FLAKES_BY_PIXEL) {
            cell = vec3<i32>(vec2<i32>(in.pos.xy / 8.0), 0);
        }
        let seed = bitcast<u32>(lobe(s.k, 7u).x);
        let u1 = hash3(cell, seed);
        let u2 = hash3(cell, seed + 1u);
        let ct = 1.0 - u1 * (1.0 - lobe(s.k, 6u).w);
        let st = sqrt(max(1.0 - ct * ct, 0.0));
        let phi = 2.0 * PI * u2;
        let qv = vec3<f32>(unpack2x16snorm(in.mask.y), unpack2x16snorm(in.mask.z).x);
        let q = vec4<f32>(qv, sqrt(max(1.0 - dot(qv, qv), 0.0)));
        let qi = vec4<f32>(-q.xyz, q.w);
        let np = normalize(rotate_q(qi, n));
        let tb = onb(np);
        let fp = tb[0] * (st * cos(phi)) + tb[1] * (st * sin(phi)) + np * ct;
        // Where a cell is smaller than the pixel's footprint, the flake fades toward the shading
        // normal and its lobe widens by the spread of the tilts (the mean of sin² θ with cos θ
        // uniform from cos tilt to 1), so far paint reads as a smooth metallic sheen.
        let foot = max(length(dpdx(in.local)), length(dpdy(in.local)));
        let wide = clamp(foot / film.w - 1.0, 0.0, 1.0);
        let c = lobe(s.k, 6u).w;
        let spread = 1.0 - (1.0 + c + c * c) / 3.0;
        let ca = max(s.coat_rough * s.coat_rough, 0.002);
        s.flake = normalize(mix(rotate_q(q, fp), n, wide));
        s.flake_a2 = min(ca * ca + wide * 2.0 * spread, 1.0);
    }
    return s;
}

// #446's planted wrong program: the filter disk sized in the cascade's own texels.
const FILTER_IN_TEXELS: u32 = 0x40000000u;

// The fixed Vogel disk's tap `i` of `n` (#446), turned by `turn`.
fn vogel(i: u32, n: u32, turn: f32) -> vec2<f32> {
    let r = sqrt((f32(i) + 0.5) / f32(n));
    let a = f32(i) * 2.399963 + turn;
    return r * vec2<f32>(cos(a), sin(a));
}

// How the disk turns at a pixel: an integer hash of the pixel, the same every frame, or under
// samples per frame by the sample's index, so the point on the light moves with the sample.
fn disk_turn(px: vec2<f32>) -> f32 {
    if lights.key.z > 0.5 {
        return lights.key.w;
    }
    return f32(band_hash(vec2<u32>(px), 0x5bd1e995u) & 0xffffu) * (TAU / 65536.0);
}

// Where a shadow map's tap lands: its uv, its depth and its layer.
struct Tap {
    uv: vec2<f32>,
    z: f32,
    layer: i32,
};

// A sample in a cube's frame: which face holds `d`, and its coordinates there (shadow.rs's FACES).
fn cube_tap(l: Local, world: vec3<f32>) -> Tap {
    let o = world - l.pos.xyz;
    let d = vec3<f32>(dot(l.clip[0].xyz, o), dot(l.clip[1].xyz, o), dot(l.clip[2].xyz, o));
    let a = abs(d);
    var face = 0;
    var m = a.x;
    var st = vec2<f32>(select(d.z, -d.z, d.x > 0.0), d.y);
    if a.x < a.y || a.x < a.z {
        if a.y >= a.z {
            face = 3;
            m = a.y;
            st = vec2<f32>(d.x, select(d.z, -d.z, d.y > 0.0));
            if d.y > 0.0 {
                face = 2;
            }
        } else {
            face = 5;
            m = a.z;
            st = vec2<f32>(select(-d.x, d.x, d.z > 0.0), d.y);
            if d.z > 0.0 {
                face = 4;
            }
        }
    } else if d.x <= 0.0 {
        face = 1;
    }
    let near = l.info.x;
    let far = l.pos.w;
    let z = far / (far - near) * (1.0 - near / max(m, near));
    return Tap(st / max(m, 1e-6) * vec2<f32>(0.5, -0.5) + 0.5, z, i32(l.info.y) + face);
}

// A local map's tap of `world`.
fn local_tap(l: Local, world: vec3<f32>) -> Tap {
    if l.info.w > 0.5 {
        return cube_tap(l, world);
    }
    let c = l.clip * vec4<f32>(world, 1.0);
    if c.w <= 0.0 {
        return Tap(vec2<f32>(-1.0), 0.0, i32(l.info.y));
    }
    return Tap(c.xy / c.w * vec2<f32>(0.5, -0.5) + 0.5, c.z / c.w, i32(l.info.y));
}

// The distance along a local map's axis that its depth `z` stands for.
fn local_distance(l: Local, z: f32) -> f32 {
    let near = l.info.x;
    let far = l.pos.w;
    return near * far / max(far - z * (far - near), 1e-6);
}

fn cascade_tap(i: u32, world: vec3<f32>) -> Tap {
    let c = lights.cascades[i] * vec4<f32>(world, 1.0);
    return Tap(c.xy * vec2<f32>(0.5, -0.5) + 0.5, c.z, i32(i));
}

fn inside_map(t: Tap) -> bool {
    return all(t.uv >= vec2<f32>(0.0)) && all(t.uv <= vec2<f32>(1.0)) && t.z <= 1.0;
}

// Where a disk tap lands on the receiver's plane, along the light's ray, so a wide disk on a
// slanted face compares each tap with the face's own depth there.
fn on_plane(p: vec3<f32>, o: vec3<f32>, n: vec3<f32>, ray: vec3<f32>) -> vec3<f32> {
    let c = dot(n, ray);
    if abs(c) < 0.1 {
        return p + o;
    }
    return p + o - ray * (dot(n, o) / c);
}

// Castaño's 9-tap filter (2013): a 5 × 5 texel tent in nine bilinear comparisons.
fn castano(map: texture_depth_2d_array, uv: vec2<f32>, z: f32, layer: i32, size: f32) -> f32 {
    let at = uv * size;
    let base = floor(at + 0.5);
    let f = at + 0.5 - base;
    let o = (base - 0.5) / size;
    let w0 = 4.0 - 3.0 * f;
    let w1 = vec2<f32>(7.0);
    let w2 = 1.0 + 3.0 * f;
    let u0 = (3.0 - 2.0 * f) / w0 - 2.0;
    let u1 = (3.0 + f) / w1;
    let u2 = f / w2 + 2.0;
    var sum = 0.0;
    for (var j = 0; j < 3; j++) {
        let wv = select(select(w2.y, w1.y, j == 1), w0.y, j == 0);
        let v = select(select(u2.y, u1.y, j == 1), u0.y, j == 0);
        for (var i = 0; i < 3; i++) {
            let wu = select(select(w2.x, w1.x, i == 1), w0.x, i == 0);
            let u = select(select(u2.x, u1.x, i == 1), u0.x, i == 0);
            sum += wu * wv * textureSampleCompareLevel(map, shadow_cmp, o + vec2<f32>(u, v) / size, layer, z);
        }
    }
    return sum / 144.0;
}

// The key sun's visibility at `world` from cascade `i`: PCSS (a blocker search, then a disk the
// penumbra sizes), Castaño's filter, or the share of a 3 × 3 texel neighbourhood that doesn't
// block it, the point first biased by `curved` (1 outside the cascade).
fn cascade_lit(i: u32, world: vec3<f32>, n: vec3<f32>, curved: bool, px: vec2<f32>) -> f32 {
    // A flat face is biased toward the sun, by a texel plus 1.5 texels of its slope to the light,
    // so the point keeps its own place in the map: the shadow's edge lands where the casters put
    // it, and a cut face beside a kept edge isn't shadowed by that edge (#424). A smooth-shaded
    // curved face is pushed along its normal by a texel and a half instead: its facets lie off
    // the surface its normal describes, steeper to the light than the normal says, and a bias by
    // the normal's slope draws hatched stripes across the ones that graze the sun (#1297).
    let c = clamp(dot(n, frame.light.xyz), 0.05, 1.0);
    let slope = min(sqrt(1.0 - c * c) / c, 4.0);
    let toward = frame.light.xyz * (1.0 + 1.5 * slope);
    let p = world + select(toward, n * 1.5, curved) * lights.texels[i];
    let t = cascade_tap(i, p);
    if !inside_map(t) {
        return 1.0;
    }
    let size = f32(textureDimensions(shadow_map).x);
    let z = t.z - 1e-4;
    if lights.soft.x > 1.5 {
        return cascade_pcss(i, p, n, t, size, px);
    }
    if lights.soft.x > 0.5 {
        return castano(shadow_map, t.uv, z, i32(i), size);
    }
    // Four bilinear comparisons half a texel apart: a 3 × 3 texel tent.
    let texel = 0.5 / size;
    var lit = 0.0;
    lit += textureSampleCompareLevel(shadow_map, shadow_cmp, t.uv + vec2<f32>(-texel, -texel), i32(i), z);
    lit += textureSampleCompareLevel(shadow_map, shadow_cmp, t.uv + vec2<f32>(texel, -texel), i32(i), z);
    lit += textureSampleCompareLevel(shadow_map, shadow_cmp, t.uv + vec2<f32>(-texel, texel), i32(i), z);
    lit += textureSampleCompareLevel(shadow_map, shadow_cmp, t.uv + vec2<f32>(texel, texel), i32(i), z);
    return lit * 0.25;
}

// The sun's PCSS: the blockers within what the sun's disk can reach, their mean distance above
// the point, and a disk that distance sizes, so a shadow hardens where it touches its caster.
fn cascade_pcss(i: u32, p: vec3<f32>, n: vec3<f32>, t: Tap, size: f32, px: vec2<f32>) -> f32 {
    let ray = -frame.light.xyz;
    let b = onb(ray);
    let texel = lights.texels[i];
    let most = lights.soft.w * texel;
    let k = lights.key.x;
    let range = lights.depths[i];
    let turn = disk_turn(px);
    let search = clamp(t.z * range * k, texel, most);
    let taps = u32(lights.soft.y);
    var sum = 0.0;
    var found = 0.0;
    for (var j = 0u; j < taps; j++) {
        let v = vogel(j, taps, turn) * search;
        let q = cascade_tap(i, on_plane(p, b[0] * v.x + b[1] * v.y, n, ray));
        let at = clamp(vec2<i32>(q.uv * size), vec2<i32>(0), vec2<i32>(i32(size) - 1));
        let d = textureLoad(shadow_map, at, i, 0);
        if d < q.z - 1e-4 {
            sum += q.z - d;
            found += 1.0;
        }
    }
    if found < 0.5 {
        return 1.0;
    }
    var radius = clamp(sum / found * range * k, texel, most);
    if (lights.count.z & FILTER_IN_TEXELS) != 0u {
        radius *= texel / lights.texels[0];
    }
    let count = u32(lights.soft.z);
    var lit = 0.0;
    for (var j = 0u; j < count; j++) {
        let v = vogel(j, count, turn) * radius;
        let q = cascade_tap(i, on_plane(p, b[0] * v.x + b[1] * v.y, n, ray));
        if !inside_map(q) {
            lit += 1.0;
            continue;
        }
        lit += textureSampleCompareLevel(shadow_map, shadow_cmp, q.uv, q.layer, q.z - 1e-4);
    }
    return lit / f32(count);
}

// A local light's visibility at `world` (#446; Light policy: local shadows): PCSS over a disk
// its radius sizes, its taps read wherever each lands, so a disk crosses a cube's faces; the
// tent without soft shadows.
fn local_lit(l: Local, world: vec3<f32>, n: vec3<f32>, px: vec2<f32>) -> f32 {
    let to = world - l.pos.xyz;
    let dist = max(length(to), 1e-4);
    let ray = to / dist;
    let size = lights.local_size.x;
    let texel = 2.0 * l.info.z * dist / size;
    let bias = 1e-5;
    let p = world + n * 1.5 * texel - ray * texel;
    let t = local_tap(l, p);
    if !inside_map(t) {
        return 1.0;
    }
    var lit = 1.0;
    if lights.soft.x > 0.5 && lights.soft.x < 1.5 {
        lit = castano(local_maps, t.uv, t.z - bias, t.layer, size);
    } else if lights.soft.x < 0.5 {
        let h = 0.5 / size;
        lit = 0.0;
        lit += textureSampleCompareLevel(local_maps, shadow_cmp, t.uv + vec2<f32>(-h, -h), t.layer, t.z - bias);
        lit += textureSampleCompareLevel(local_maps, shadow_cmp, t.uv + vec2<f32>(h, -h), t.layer, t.z - bias);
        lit += textureSampleCompareLevel(local_maps, shadow_cmp, t.uv + vec2<f32>(-h, h), t.layer, t.z - bias);
        lit += textureSampleCompareLevel(local_maps, shadow_cmp, t.uv + vec2<f32>(h, h), t.layer, t.z - bias);
        lit *= 0.25;
    } else {
        let b = onb(ray);
        let most = lights.soft.w * texel;
        let turn = disk_turn(px);
        let r = l.size.x;
        let search = clamp(r * (dist - l.info.x) / dist, texel, most);
        let taps = u32(lights.soft.y);
        var sum = 0.0;
        var found = 0.0;
        for (var j = 0u; j < taps; j++) {
            let v = vogel(j, taps, turn) * search;
            let q = local_tap(l, on_plane(p, b[0] * v.x + b[1] * v.y, n, ray));
            let at = clamp(vec2<i32>(q.uv * size), vec2<i32>(0), vec2<i32>(i32(size) - 1));
            let d = textureLoad(local_maps, at, q.layer, 0);
            if d < q.z - bias {
                sum += local_distance(l, d);
                found += 1.0;
            }
        }
        if found > 0.5 {
            let blocker = sum / found;
            let radius = clamp(r * max(dist - blocker, 0.0) / blocker, texel, most);
            let count = u32(lights.soft.z);
            lit = 0.0;
            for (var j = 0u; j < count; j++) {
                let v = vogel(j, count, turn) * radius;
                let q = local_tap(l, on_plane(p, b[0] * v.x + b[1] * v.y, n, ray));
                lit += textureSampleCompareLevel(local_maps, shadow_cmp, q.uv, q.layer, q.z - bias);
            }
            lit /= f32(count);
        }
    }
    return mix(1.0, lit, l.size.y);
}

// An IES table's value toward `w` from a light, unit along its axis and across it (#446).
fn ies_at(layer: u32, axis: vec3<f32>, right: vec3<f32>, up: vec3<f32>, w: vec3<f32>) -> f32 {
    let v = acos(clamp(dot(w, axis), -1.0, 1.0)) / PI;
    let u = fract(atan2(dot(w, up), dot(w, right)) / TAU + 1.0);
    return textureSampleLevel(ies_tables, ies_sampler, vec2<f32>(u, v), i32(layer), 0.0).r;
}

// The key sun's visibility at `world` (#422): the cascade its view depth falls in, blended with
// the next across the last tenth of its range when fade is on; 1 past the last cascade.
fn lit_share(world: vec3<f32>, n: vec3<f32>, curved: bool, px: vec2<f32>) -> f32 {
    let count = lights.count.w;
    if count == 0u {
        return 1.0;
    }
    let d = dot(world - lights.view.xyz, lights.forward.xyz);
    for (var i = 0u; i < count; i++) {
        let far = lights.splits[i];
        if d <= far {
            let lit = cascade_lit(i, world, n, curved, px);
            let near = select(0.0, lights.splits[max(i, 1u) - 1u], i > 0u);
            let edge = far - 0.1 * (far - near);
            if lights.forward.w > 0.5 && d > edge {
                var next = 1.0;
                if i + 1u < count {
                    next = cascade_lit(i + 1u, world, n, curved, px);
                }
                return mix(lit, next, (d - edge) / max(far - edge, 1e-6));
            }
            return lit;
        }
    }
    return 1.0;
}

// Which of the shaded lights reach a fragment: a bit each, by the policy's order.
fn cluster_at(px: vec2<f32>, world: vec3<f32>) -> u32 {
    if lights.grid.x < 0.5 {
        return 0xffffffffu;
    }
    let z = max(dot(world - lights.view.xyz, lights.forward.xyz), lights.grid.z);
    let slice = min(u32(log(z / lights.grid.z) / log(lights.grid.y / lights.grid.z) * 24.0), 23u);
    let x = min(u32(px.x / frame.viewport.x * 16.0), 15u);
    let y = min(u32(px.y / frame.viewport.y * 9.0), 8u);
    return light_grid[(slice * 9u + y) * 16u + x];
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
    var s = Surface(in.base.rgb, in.surface.x, in.surface.y, in.surface.z, in.specular.rgb, in.surface.w, in.specular.w,
        lobe_index(in), vec3<f32>(0.0), vec3<f32>(0.0), 0.0, 0.0);
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

fn direct(in: MeshOut, n: vec3<f32>, s: Surface, spread: f32, curved: bool) -> Direct {
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
    let a2 = clamp(max(rough * rough * rough * rough, min(2.0 * dn, 0.18)) + min(tok, 1.0), 0.0, 1.0);
    let dfg_v = dfg_at(max(dot(n, v), 1e-4), rough);
    let catches = (in.flags & CATCH) != 0u;
    var out = vec3<f32>(0.0);
    var total = 0.0;
    var removed = 0.0;
    let reach = cluster_at(in.pos.xy, in.world);
    for (var i = 0u; i < lights.count.x; i++) {
        if (reach >> i & 1u) == 0u {
            continue;
        }
        let li = lights.items[i];
        // A light skips what its receivers don't hold (#446): a material's `color` word holds the
        // receiver sets it belongs to.
        let only = bitcast<u32>(li.cone.w);
        if only != 0u && (in.color & only) == 0u {
            continue;
        }
        var add = vec3<f32>(0.0);
        let table = u32(li.up.w);
        if li.pos.w > 2.5 {
            add = area_light(li, in.world, n, v, s, a2, dfg_v);
            if table > 0u {
                let w = normalize(in.world - li.pos.xyz);
                add = add * ies_at(table - 1u, li.dir.xyz, normalize(li.right.xyz), normalize(li.up.xyz), w);
            }
        } else {
            var l = -li.dir.xyz;
            var e = li.color.rgb;
            if li.pos.w > 0.5 {
                let d = li.pos.xyz - in.world;
                let d2 = dot(d, d);
                l = d * inverseSqrt(d2);
                let fade = clamp(1.0 - pow(d2 / (li.dir.w * li.dir.w), 2.0), 0.0, 1.0);
                e = e * fade * fade / max(d2, li.color.w * li.color.w);
                if table > 0u {
                    // A spot clips its table at its cone, whose values keep its flux inside it.
                    e = e * ies_at(table - 1u, li.dir.xyz, li.right.xyz, li.up.xyz, -l);
                    if li.pos.w > 1.5 && dot(-l, li.dir.xyz) < li.cone.x {
                        e = vec3<f32>(0.0);
                    }
                } else if li.pos.w > 1.5 {
                    let t = clamp((dot(-l, li.dir.xyz) - li.cone.x) / max(li.cone.y - li.cone.x, 1e-4), 0.0, 1.0);
                    e = e * t * t;
                }
            }
            let nl = dot(n, l);
            if s.k != 0u {
                add = extra_lobes(n, v, l, s, a2, dfg_v) * e;
            } else if nl > 0.0 {
                let b = lobes(n, v, l, s, a2, dfg_v);
                add = (b.diffuse + b.spec) * e * nl;
            }
        }
        // The key sun's cascades shadow what receives (#422); a catcher keeps the light and
        // reports the share its shadow removes.
        var lit = 1.0;
        if lights.count.y == i + 1u && (in.flags & NO_RECEIVE) == 0u {
            lit = lit_share(in.world, n, curved, in.pos.xy) * contact_at(in.pos.xy);
        }
        let local = u32(li.cone.z);
        if local > 0u && (in.flags & NO_RECEIVE) == 0u && any(add > vec3<f32>(0.0)) {
            lit = local_lit(lights.locals[local - 1u], in.world, n, in.pos.xy);
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
    contact: vec4<f32>,
    steps: vec4<u32>,
};

@group(2) @binding(0) var ao_t: texture_2d<f32>;
@group(2) @binding(1) var<uniform> ao: Ao;

// The ambient term's visibility at this pixel, brightened by the surface's albedo with
// multi-bounce on (Jimenez's fit); 1 with ao off.
// The key light's contact shadow here (#446), 1 with none.
fn contact_at(pos: vec2<f32>) -> f32 {
    if ao.steps.x == 0u {
        return 1.0;
    }
    let dims = textureDimensions(ao_t);
    return textureLoad(ao_t, min(vec2<u32>(pos * ao.scale.xy), dims - vec2<u32>(1u)), 0).g;
}

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
    return mesh(in, front);
}

// The object ID whole, for a pass drawn after the resolve into its one-sample target (#1173).
struct Resolved {
    @location(0) color: vec4<f32>,
    @location(1) id: u32,
};

// A transmissive part (#428), drawn over the resolved opaque scene.
@fragment
fn glass_fs(in: MeshOut, @builtin(front_facing) front: bool) -> Resolved {
    let t = mesh(in, front);
    return Resolved(t.color, t.id.x | (t.id.y << 16u));
}

fn mesh(in: MeshOut, front: bool) -> Targets {
    // The texture coordinates' derivatives, while every pixel of the quad still runs (#423).
    let g = array<vec4<f32>, 2>(dpdx(in.uv), dpdy(in.uv));
    // Derivatives first, while every pixel of the quad still runs: the face's normal in its
    // part's own space, which a pattern reads.
    let local_n = normalize(cross(dpdx(in.local), dpdy(in.local)) + vec3<f32>(0.0, 1e-9, 0.0));
    let shaded = shade(in, front, local_n, g, false);
    if !band_keeps(vec2<u32>(in.pos.xy), in.pick, in.mask.x) {
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
    // Whether its interpolated normal turns across the triangle: a smooth-shaded curved face,
    // never a flat one or a cap (the cascades' bias, #1297).
    let dn = dpdx(in.normal) * dpdx(in.normal) + dpdy(in.normal) * dpdy(in.normal);
    let curved = dn.x + dn.y + dn.z > 1e-10;
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
                    return targets(vec4<f32>(0.0), in.pick);
                }
                discard;
            }
            alpha = 1.0;
        }
        let facing = m.n;
        let s = with_lobes(in, facing, m.s);
        if (in.flags & UNLIT) != 0u {
            return targets(see_through(adjusted(s.base + m.emission, in.op.w), alpha, mode), in.pick);
        }
        let d = direct(in, facing, s, m.spread, curved);
        // A shadow catcher writes black, as opaque as the share of light its shadow removes, at
        // its strength.
        if (in.flags & CATCH) != 0u {
            return targets(vec4<f32>(0.0, 0.0, 0.0, d.removed * alpha * in.base.w), in.pick);
        }
        if keyed && lights.count.x == 0u && frame.sky_top.w <= 0.0 && env.k.x <= 0.0 {
            let key = 0.45 * occlusion(in.pos.xy, s.base) + 0.55 * max(dot(facing, frame.light.xyz), 0.0);
            let unlit = fogged(adjusted(s.base * key + in.emission.rgb, in.op.w), in.world);
            return targets(see_through(unlit, alpha, mode), in.pick);
        }
        var ambient: vec3<f32>;
        if env.k.x > 0.0 {
            ambient = env_light(in, facing, s);
        } else {
            ambient = sky_light(in, facing, s);
        }
        // A map's occlusion scales the ambient term alone (#423).
        var through = vec3<f32>(0.0);
        if s.k != 0u && lobe(s.k, 3u).x > 0.0 {
            let v = select(normalize(lights.view.xyz), normalize(lights.view.xyz - in.world), lights.view.w > 0.5);
            through = transmitted(in, facing, v, s);
        }
        let lit = fogged(adjusted(d.color + ambient * m.occlusion + m.emission + through, in.op.w), in.world);
        return targets(see_through(lit, alpha, mode), in.pick);
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
        direct = direct * lit_share(in.world, n, curved, in.pos.xy) * contact_at(in.pos.xy);
    }
    let albedo = paint(in.color);
    let lit = ambient * occlusion(in.pos.xy, albedo) + vec3<f32>(direct);
    let a = in.emission.w;
    return targets(vec4<f32>(fogged(adjusted(albedo * lit + in.emission.rgb, in.op.w), in.world) * a, a), in.pick);
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
    return targets(vec4<f32>(0.0), 0u);
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
    return targets(acc, 0u);
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
// face seen through the cut, drawn half a pixel's depth slope nearer the eye (never past its plane),
// so a coplanar front face of a neighbouring part never hides it, while a front face of its own
// part in front of it still does. Half, not less: the one depth a fragment writes holds for every
// sample it covers, and a neighbour's face is tested at each sample, up to 0.375 px from the
// pixel's centre at 4× (#1173).
struct CutTargets {
    @location(0) color: vec4<f32>,
    @location(1) id: vec2<u32>,
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
                depth = max(in.pos.z - 0.5 * slope, plane);
            } else {
                depth = min(in.pos.z + 0.5 * slope, plane);
            }
            depth = clamp(depth, 0.0, 1.0);
        }
    }
    let t = shade(in, front, local_n, g, false);
    // A band inside its margin keeps only its mask's pixels (#425), after shading.
    if !band_keeps(vec2<u32>(in.pos.xy), in.pick, in.mask.x) {
        discard;
    }
    return CutTargets(t.color, t.id, depth);
}

// The shadow passes' fragment stage: what a cutaway removes casts nothing (#424), and a band
// inside its margin casts only its mask's texels (#425).
@fragment
fn shadow_fs(in: MeshOut) {
    if ((in.flags & CUT) != 0u && cut_hides(in.world))
        || !band_keeps(vec2<u32>(in.pos.xy), in.pick, in.mask.x) {
        discard;
    }
}

// A mask-alpha caster's fragment stage (#432: a caster kind of its own): what its alpha test
// removes in the view casts nothing either.
@fragment
fn shadow_mask_fs(in: MeshOut) {
    if ((in.flags & CUT) != 0u && cut_hides(in.world))
        || !band_keeps(vec2<u32>(in.pos.xy), in.pick, in.mask.x)
        || (((in.flags >> 7u) & 3u) == MASK && in.emission.w < ALPHA_CUTOFF) {
        discard;
    }
}

// The ao prepass (#418): an opaque solid's world normal; its depth goes to the prepass's own
// depth target.
// The core's emission target (#431): the emitted radiance of an opaque solid where it shows, its
// emission map applied, before fog, adjust and bloom; see-through solids and what a cutaway
// removes write none.
@fragment
fn emission_fs(in: MeshOut) -> @location(0) vec4<f32> {
    let g = array<vec4<f32>, 2>(dpdx(in.uv), dpdy(in.uv));
    if in.emission.w < 1.0 || ((in.flags & CUT) != 0u && cut_hides(in.world))
        || !band_keeps(vec2<u32>(in.pos.xy), in.pick, in.mask.x) {
        discard;
    }
    var e = in.emission.rgb;
    if (in.flags & MAPS) != 0u && has_map(4u) {
        e = e * fetch(4u, map_emission, sampler_emission, in.uv, g).rgb;
    }
    return vec4<f32>(e, 1.0);
}

@fragment
fn ao_normal_fs(in: MeshOut) -> @location(0) vec4<f32> {
    // A see-through solid writes no occlusion depth, nor what a cutaway removes (#424); a band
    // keeps only its mask's pixels (#425).
    if in.emission.w < 1.0 || ((in.flags & CUT) != 0u && cut_hides(in.world))
        || !band_keeps(vec2<u32>(in.pos.xy), in.pick, in.mask.x) {
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
    if s.k != 0u {
        return ambient_lobes(in, n, v, s, false);
    }
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
    if s.k != 0u {
        return ambient_lobes(in, n, v, s, true) * env.k.z;
    }
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

// The ambient light along `d` at roughness `rough`: the environment's prefiltered radiance, or
// the sky's, its average over the hemisphere for a rough lobe.
fn ambient_along(d: vec3<f32>, n: vec3<f32>, rough: f32, from_env: bool) -> vec3<f32> {
    if from_env {
        return env_radiance(d, rough * env.k.y);
    }
    return mix(sky_at(d), sky_at(n), rough * rough);
}

// The ambient irradiance ÷ π facing `n` and facing −n, in one pass over the coefficients: the
// first band's terms change sign with the direction.
fn ambient_irradiance2(n: vec3<f32>, from_env: bool) -> array<vec3<f32>, 2> {
    if !from_env {
        return array<vec3<f32>, 2>(sky_at(n), sky_at(-n));
    }
    let d = env_dir(n);
    let w = env.m.x;
    let c = array<vec3<f32>, 9>(
        mix(env.sh[0].rgb, env.sh_to[0].rgb, w), mix(env.sh[1].rgb, env.sh_to[1].rgb, w),
        mix(env.sh[2].rgb, env.sh_to[2].rgb, w), mix(env.sh[3].rgb, env.sh_to[3].rgb, w),
        mix(env.sh[4].rgb, env.sh_to[4].rgb, w), mix(env.sh[5].rgb, env.sh_to[5].rgb, w),
        mix(env.sh[6].rgb, env.sh_to[6].rgb, w), mix(env.sh[7].rgb, env.sh_to[7].rgb, w),
        mix(env.sh[8].rgb, env.sh_to[8].rgb, w),
    );
    let odd = 0.488603 * (c[1] * d.y + c[2] * d.z + c[3] * d.x);
    let even = 0.282095 * c[0]
        + 1.092548 * (c[4] * (d.x * d.y) + c[5] * (d.y * d.z) + c[7] * (d.x * d.z))
        + 0.315392 * (3.0 * d.z * d.z - 1.0) * c[6]
        + 0.546274 * (d.x * d.x - d.y * d.y) * c[8];
    return array<vec3<f32>, 2>(max(even + odd, vec3<f32>(0.0)), max(even - odd, vec3<f32>(0.0)));
}

// The environment's or the sky's light on a part with extra lobes (#428), as `env_light` and
// `sky_light` shade the base lobes: the diffuse by its irradiance (EON's albedo for rough
// diffuse, the back's irradiance through thin translucency), the specular through the DFG table
// with its Fresnel replaced by the film's and its mirror ray bent toward the anisotropy, sheen
// by its albedo over both, and the flakes' mirror rays mixed in by weight.
fn ambient_lobes(in: MeshOut, n: vec3<f32>, v: vec3<f32>, s: Surface, from_env: bool) -> vec3<f32> {
    let k = s.k;
    let rough = clamp(s.rough, 0.045, 1.0);
    let nv = max(dot(n, v), 1e-4);
    let dfg_v = dfg_at(nv, rough);
    let off = from_env && (lights.count.z & NO_COMP) != 0u;
    let L = entry_of(k);
    let x1 = L[1];
    let tr = L[2];
    let film = L[5];
    let irid = L[4].w;
    let amount = L[7].y;
    let f0 = lobe_weight(s) * lobe_f0(s);
    var e = f0 * dfg_v.x + lobe_weight(s) * dfg_v.y;
    var metal = s.base * dfg_v.x + dfg_v.y;
    if irid > 0.0 {
        let albedo = dfg_v.x + dfg_v.y;
        e = mix(e, iridescence(film.x, nv, film.y, f0) * albedo, irid);
        metal = mix(metal, iridescence(film.x, nv, film.y, s.base) * albedo, irid);
    }
    let spec = mix(e * compensation(f0, dfg_v, off), metal * compensation(s.base, dfg_v, off), s.metallic);
    var r = reflect(-v, n);
    if x1.x != 0.0 {
        // The mirror ray bent toward the stretched lobe (KHR_materials_anisotropy's bent normal).
        let ab = cross(s.t, v);
        let an = cross(ab, s.t);
        let bend = 1.0 - abs(x1.x) * (1.0 - rough);
        r = reflect(-v, normalize(mix(an, n, bend * bend * bend * bend)));
    }
    var rho = s.base * (1.0 - s.metallic) * (1.0 - L[3].x);
    if x1.z > 0.0 && !planted(P_LAMBERT) {
        // FON alone keeps only its single scattering's albedo (the planted wrong program).
        rho = select(eon_albedo(rho, x1.z, nv), rho * fon_e(nv, x1.z), planted(P_FON));
    }
    // The diffuse keeps what the compensated specular doesn't take, so a part never reflects
    // more than it receives, F0 1 included.
    let taken = min(e * compensation(f0, dfg_v, off), vec3<f32>(1.0));
    let irr = ambient_irradiance2(n, from_env);
    var diffuse = rho * (1.0 - max3(taken)) * irr[0];
    if tr.w < 0.0 {
        diffuse = diffuse * (1.0 - amount)
            + (1.0 - s.metallic) * tr.rgb * amount * (1.0 - max3(taken)) * irr[1];
    }
    diffuse = diffuse * occlusion(in.pos.xy, rho);
    var out = diffuse + spec * ambient_along(r, n, rough, from_env);
    let sheen = L[0];
    if max3(sheen.rgb) > 0.0 {
        let a = s.sheen_ev;
        out = out * (1.0 - max3(sheen.rgb) * a) + sheen.rgb * a * irr[0];
    }
    if film.z > 0.0 {
        let fv = max(dot(s.flake, v), 1e-4);
        let col = lobe(k, 6u).rgb;
        let cr = max(sqrt(sqrt(s.flake_a2)), 0.045);
        let fd = dfg_at(fv, cr);
        let flake = (col * fd.x + fd.y) * compensation(col, fd, off);
        out = mix(out, flake * ambient_along(reflect(-v, s.flake), s.flake, cr, from_env), film.z);
    }
    return out;
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
    @location(6) @interpolate(flat) joined: u32,
    // A mesh-edge line's dash and gap in its size space (#1640), 0 for none; for a line in m,
    // the segment's length in m and its ends' clip w, so the dash follows the segment in depth.
    @location(7) @interpolate(flat) dash: vec2<f32>,
    @location(8) @interpolate(flat) metres: vec3<f32>,
};

@vertex
fn line_vs(
    @builtin(vertex_index) vi: u32,
    @location(0) a: vec4<f32>,
    @location(1) b: vec4<f32>,
    @location(2) color: u32,
    @location(3) pick: u32,
    @location(4) flags: u32,
    @location(5) dash: u32,
) -> LineOut {
    var out: LineOut;
    let ca = frame.clip * vec4<f32>(a.xyz, 1.0);
    let cb = frame.clip * vec4<f32>(b.xyz, 1.0);
    out.color = color;
    out.pick = pick;
    out.joined = (flags >> 3u) & 1u;
    out.dash = unpack2x16float(dash);
    out.metres = vec3<f32>(0.0);
    if (flags & 16u) != 0u {
        out.metres = vec3<f32>(length(b.xyz - a.xyz), ca.w, cb.w);
    } else {
        out.dash = out.dash * frame.px.x;
    }
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
    // Dashed from the segment's start: along it in px, or in m through its depth.
    if in.dash.x > 0.0 && in.dash.y > 0.0 {
        var along = t * sqrt(l2);
        if in.metres.x > 0.0 {
            let wa = in.metres.y;
            let wb = in.metres.z;
            along = in.metres.x * (t / wb) / ((1.0 - t) / wa + t / wb);
        }
        if along - floor(along / (in.dash.x + in.dash.y)) * (in.dash.x + in.dash.y) >= in.dash.x {
            discard;
        }
    }
    // A joined line's pieces meet end to end: a cap's soft edge would show a seam at each joint.
    if in.joined != 0u && cov < 1.0 && (t <= 0.0 || t >= 1.0) {
        discard;
    }
    let alpha = cov * mix(in.alpha.x, in.alpha.y, t);
    return targets(vec4<f32>(paint(in.color) * alpha, alpha), select(0u, in.pick, cov >= 0.5));
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
    return targets(vec4<f32>(paint(in.color) * cov, cov), select(0u, in.pick, cov >= 0.5));
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
    return targets(vec4<f32>(paint(in.color) * shown, shown), select(0u, in.pick, a >= 0.5));
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
    if env.bg.y > 0.0 {
        let e = env_dir(dir);
        let a = textureSampleLevel(env_bg, env_sampler, e, 0.0).rgb;
        let b = textureSampleLevel(env_bg_to, env_sampler, e, 0.0).rgb;
        return select(a, mix(a, b, env.m.x), env.m.x > 0.0) * env.k.z;
    }
    return env_radiance(dir, 0.0) * env.k.z;
}

@fragment
fn sky_fs(@builtin(position) pos: vec4<f32>) -> Targets {
    return targets(vec4<f32>(background(view_ray(pos.xy)), 1.0), 0u);
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
    return targets(vec4<f32>(c * alpha, alpha), 0u);
}

