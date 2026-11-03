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
    // x: how many lights; y: 1 + the light the shadow map is of, 0 for none.
    count: vec4<u32>,
    // World to the shadow map's clip space (depth 0 nearest the light).
    shadow: mat4x4<f32>,
    items: array<Light, 32>,
};

@group(1) @binding(0) var<uniform> lights: Lights;
// 32 × 32 entries, cos(view) across and roughness down, two to a vec4: (A, B) with the
// directional albedo F0·A + F90·B of the specular lobe.
@group(1) @binding(1) var<uniform> dfg: array<vec4<f32>, 512>;
// The key light's shadow map, which a shadow catcher reads (a texel's stand-in before one is
// drawn).
@group(1) @binding(2) var shadow_map: texture_depth_2d;

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

struct MeshOut {
    @builtin(position) pos: vec4<f32>,
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
) -> MeshOut {
    var out: MeshOut;
    out.emission = emission;
    let world = vec3<f32>(dot(r0.xyz, p) + r0.w, dot(r1.xyz, p) + r1.w, dot(r2.xyz, p) + r2.w);
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
    if frame.light.w >= 0.0 && tie > 0u {
        let cos_t = max(abs(dot(cof, normalize(cross(frame.up.xyz, frame.right.xyz)))), 1.0 / 64.0);
        let slope = sqrt(1.0 - cos_t * cos_t) / cos_t / max(frame.viewport.z, 1.0);
        let k = f32(tie) * (1.0e-6 + slope / 64.0);
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
    return out;
}

// The DFG table at (cos view, roughness), bilinear.
fn dfg_at(nv: f32, rough: f32) -> vec2<f32> {
    let x = clamp(nv * 32.0 - 0.5, 0.0, 31.0);
    let y = clamp(rough * 32.0 - 0.5, 0.0, 31.0);
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

fn lobes(n: vec3<f32>, v: vec3<f32>, l: vec3<f32>, s: Surface, a2: f32, dfg_v: vec2<f32>) -> Lobes {
    let f0 = mix(min(0.08 * s.level, 1.0) * s.specular, s.base, s.metallic);
    let f90 = mix(min(2.0 * s.level, 1.0), 1.0, s.metallic);
    let h = normalize(l + v);
    let nh = max(dot(n, h), 0.0);
    let nl = max(dot(n, l), 1e-4);
    let nv = max(dot(n, v), 1e-4);
    let vh = max(dot(v, h), 0.0);
    let fc5 = pow(1.0 - vh, 5.0);
    let f = f0 + (f90 - f0) * fc5;
    let vis = 0.5 / max(nl * sqrt(nv * nv * (1.0 - a2) + a2) + nv * sqrt(nl * nl * (1.0 - a2) + a2), 1e-6);
    let single = ggx(nh, a2) * vis * f;
    // Kulla-Conty's and Fdez-Agüera's compensation: the energy single scattering loses, back.
    let albedo = max(dfg_v.x + dfg_v.y, 1e-4);
    var spec = single * (1.0 + f0 * (1.0 / albedo - 1.0));
    // What the specular lobe reflects at this view leaves the diffuse.
    let e = f0 * dfg_v.x + f90 * dfg_v.y;
    var diffuse = s.base * (1.0 - s.metallic) * (1.0 - e) / PI;
    if s.coat > 0.0 {
        let ca = max(s.coat_rough * s.coat_rough, 0.002);
        let fc = (0.04 + 0.96 * fc5) * s.coat;
        let coat = ggx(nh, ca * ca) * 0.25 / max(vh * vh, 1e-4) * fc;
        diffuse = diffuse * (1.0 - fc);
        spec = spec * (1.0 - fc) + vec3<f32>(coat);
    }
    return Lobes(diffuse, spec);
}

// The key light's visibility at `world`: the share of a 3 × 3 texel neighbourhood of the shadow
// map that doesn't block it (1 outside the map).
fn lit_share(world: vec3<f32>) -> f32 {
    let lp = lights.shadow * vec4<f32>(world, 1.0);
    let uv = lp.xy * vec2<f32>(0.5, -0.5) + 0.5;
    if any(uv < vec2<f32>(0.0)) || any(uv > vec2<f32>(1.0)) {
        return 1.0;
    }
    let size = vec2<f32>(textureDimensions(shadow_map));
    let px = vec2<i32>(floor(uv * size));
    var lit = 0.0;
    for (var y = -1; y <= 1; y++) {
        for (var x = -1; x <= 1; x++) {
            let at = clamp(px + vec2<i32>(x, y), vec2<i32>(0), vec2<i32>(size) - 1);
            lit += select(0.0, 1.0, textureLoad(shadow_map, at, 0) >= lp.z - 0.002);
        }
    }
    return lit / 9.0;
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

fn direct(in: MeshOut, n: vec3<f32>, s: Surface) -> Direct {
    let v = select(normalize(lights.view.xyz), normalize(lights.view.xyz - in.world), lights.view.w > 0.5);
    let rough = clamp(s.rough, 0.045, 1.0);
    // Geometric specular antialiasing (Kaplanyan): the normal's change across the pixel widens
    // the lobe.
    let dn = dot(dpdx(n), dpdx(n)) + dot(dpdy(n), dpdy(n));
    let a2 = clamp(rough * rough * rough * rough + min(0.5 * dn, 0.18), 0.0, 1.0);
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
        out += add;
        if catches {
            let y = dot(add, vec3<f32>(0.2126, 0.7152, 0.0722));
            total += y;
            if lights.count.y == i + 1u {
                removed += y * (1.0 - lit_share(in.world));
            }
        }
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

@fragment
fn mesh_fs(in: MeshOut, @builtin(front_facing) front: bool) -> Targets {
    let n = normalize(in.normal);
    // Derivatives first, while every pixel of the quad still runs: the face's normal in its
    // part's own space, which a pattern reads.
    let local_n = normalize(cross(dpdx(in.local), dpdy(in.local)) + vec3<f32>(0.0, 1e-9, 0.0));
    if (in.flags & MATERIAL) != 0u {
        // Its back faces are culled; a negative determinant turns its winding over.
        if (front == ((in.flags & MIRRORED) != 0u)) && (in.flags & DOUBLE_SIDED) == 0u {
            discard;
        }
        let mode = (in.flags >> 7u) & 3u;
        // Its coverage: the material's alpha times the item's opacity (#418).
        let alpha = in.emission.w;
        if mode == MASK && alpha < ALPHA_CUTOFF {
            discard;
        }
        let facing = select(-n, n, front != ((in.flags & MIRRORED) != 0u));
        let s = surface_of(in, local_n);
        if (in.flags & UNLIT) != 0u {
            return Targets(see_through(s.base + in.emission.rgb, alpha, mode), in.pick);
        }
        let d = direct(in, facing, s);
        // A shadow catcher writes black, as opaque as the share of light its shadow removes, at
        // its strength.
        if (in.flags & CATCH) != 0u {
            return Targets(vec4<f32>(0.0, 0.0, 0.0, d.removed * alpha * in.base.w), in.pick);
        }
        let ambient = sky_light(in, facing, s);
        return Targets(see_through(d.color + ambient + in.emission.rgb, alpha, mode), in.pick);
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
    let albedo = paint(in.color);
    let lit = ambient * occlusion(in.pos.xy, albedo) + vec3<f32>(direct);
    let a = in.emission.w;
    return Targets(vec4<f32>((albedo * lit + in.emission.rgb) * a, a), in.pick);
}

// The ao prepass (#418): an opaque solid's world normal; its depth goes to the prepass's own
// depth target.
@fragment
fn ao_normal_fs(in: MeshOut) -> @location(0) vec4<f32> {
    // A see-through solid writes no occlusion depth.
    if in.emission.w < 1.0 {
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
    let f0 = mix(min(0.08 * s.level, 1.0) * s.specular, s.base, s.metallic);
    let f90 = mix(min(2.0 * s.level, 1.0), 1.0, s.metallic);
    let e = f0 * dfg_v.x + f90 * dfg_v.y;
    let spec = e * (1.0 + f0 * (1.0 / max(dfg_v.x + dfg_v.y, 1e-4) - 1.0));
    let r = reflect(-v, n);
    // A rough lobe sees the sky's average over the hemisphere, as a diffuse one does.
    let reflected = mix(sky_at(r), sky_at(n), rough * rough);
    let diffuse = s.base * (1.0 - s.metallic) * (1.0 - e);
    return diffuse * sky_at(n) * occlusion(in.pos.xy, diffuse) + spec * reflected;
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
    return Targets(vec4<f32>(paint(in.color) * a, a), select(0u, in.pick, a >= 0.5));
}
