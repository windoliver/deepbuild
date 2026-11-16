
// ---- #1383: the terrain plates' cover (canvas primitives: Builder plate: terrain),
// concatenated after scene3d.wgsl. `covers` (cover.rs) holds the plates' count and the maps'
// count, a table of COVER_PLATE words a plate (its pick, cols, rows, a sample's bytes, the word
// its weights start at, its size along X and Z, its entries' count, then COVER_ENTRY words an
// entry), a table of COVER_MAP words a map, each plate's signed distances to where an entry holds
// (a byte per entry and per modify with a `where` of its own, over the entry's span, each sample's
// run padded to whole words) and each map's RGBA8 sRGB texels with their mips. The distances of the
// triangle under a pixel are mixed before its blend crosses them, so an edge runs smooth between
// samples. Everything is read as the CPU's `Cover::reading` reads it.
@group(1) @binding(22) var<storage, read> covers: array<u32>;

const COVER_HEAD: u32 = 2u;
const COVER_ENTRY: u32 = 21u;
const COVER_PLATE: u32 = 92u;
const COVER_MAP: u32 = 4u;
// Above 35° of slope `auto` samples triplanar; triplanar weights are |n|^(1.5 × sharpness 2).
const COVER_AUTO_COS: f32 = 0.81915204;
const COVER_POWER: f32 = 3.0;
const COVER_DUST: vec3<f32> = vec3<f32>(0.6, 0.53, 0.43);
// #1383's planted wrong programs, bits of the lights' planted word: an auto or triplanar entry
// sampled by the ground's (x, z) at every slope; triplanar weights from the shading normal.
const P_COVER_PLANAR: u32 = 33554432u;
const P_COVER_SHADED: u32 = 67108864u;

// The plate whose solid is `pick`: the word its table entry starts at, or none.
fn cover_plate(pick: u32) -> u32 {
    for (var p = 0u; p < covers[0]; p = p + 1u) {
        let e = COVER_HEAD + p * COVER_PLATE;
        if covers[e] == pick {
            return e;
        }
    }
    return 0xffffffffu;
}

// The three samples of the triangle under `local` and their shares, as the drawn surface splits a
// cell (from its (c, r + 1) corner to its (c + 1, r) one).
struct CoverAt {
    s: vec3<u32>,
    k: vec3<f32>,
};

fn cover_at(e: u32, local: vec3<f32>) -> CoverAt {
    let cols = covers[e + 1u];
    let rows = covers[e + 2u];
    let size = vec2<f32>(bitcast<f32>(covers[e + 5u]), bitcast<f32>(covers[e + 6u]));
    let n = vec2<f32>(f32(cols - 1u), f32(rows - 1u));
    let g = clamp((local.xz / size + 0.5) * n, vec2<f32>(0.0), n);
    let c = min(vec2<u32>(floor(g)), vec2<u32>(cols - 2u, rows - 2u));
    let f = g - vec2<f32>(c);
    let s = c.y * cols + c.x;
    if f.x + f.y <= 1.0 {
        return CoverAt(vec3<u32>(s, s + 1u, s + cols), vec3<f32>(1.0 - f.x - f.y, f.x, f.y));
    }
    return CoverAt(vec3<u32>(s + cols + 1u, s + cols, s + 1u), vec3<f32>(f.x + f.y - 1.0, 1.0 - f.x, 1.0 - f.y));
}

// Byte `b` of sample `s`.
fn cover_byte(e: u32, s: u32, b: u32) -> f32 {
    let wps = (covers[e + 3u] + 3u) / 4u;
    let w = covers[covers[e + 4u] + s * wps + b / 4u];
    return f32((w >> (8u * (b % 4u))) & 255u);
}

// The weight byte `b` gives under the pixel: its samples' distances mixed over the triangle, then
// crossing from 0 to 1 over `blend` m (the entry at word q), a hard edge at 0.
fn cover_weight(e: u32, at: CoverAt, b: u32, q: u32) -> f32 {
    let byte = at.k.x * cover_byte(e, at.s.x, b) + at.k.y * cover_byte(e, at.s.y, b) + at.k.z * cover_byte(e, at.s.z, b);
    let d = (byte - 127.5) / 127.5 * bitcast<f32>(covers[q + 20u]);
    let blend = bitcast<f32>(covers[q + 19u]);
    if blend > 0.0 {
        return smoothstep(0.0, 1.0, 0.5 + d / blend);
    }
    return select(0.0, 1.0, d >= 0.0);
}

// A map's mip `level`: its width, height and the word its texels start at.
fn cover_level(m: u32, level: u32) -> vec3<u32> {
    var w = covers[m];
    var h = covers[m + 1u];
    var at = covers[m + 3u];
    for (var l = 0u; l < level; l = l + 1u) {
        at = at + w * h;
        w = max(w / 2u, 1u);
        h = max(h / 2u, 1u);
    }
    return vec3<u32>(w, h, at);
}

fn cover_linear(c: vec3<f32>) -> vec3<f32> {
    return select(pow((c + 0.055) / 1.055, vec3<f32>(2.4)), c / 12.92, c <= vec3<f32>(0.04045));
}

// A texel of a mip, the map repeating.
fn cover_fetch(l: vec3<u32>, p: vec2<i32>) -> vec4<f32> {
    let size = vec2<i32>(l.xy);
    let q = vec2<u32>(((p % size) + size) % size);
    let c = unpack4x8unorm(covers[l.z + q.y * l.x + q.x]);
    return vec4<f32>(cover_linear(c.rgb), c.a);
}

// A mip at `uv`, bilinear.
fn cover_bilinear(l: vec3<u32>, uv: vec2<f32>) -> vec4<f32> {
    let t = uv * vec2<f32>(l.xy) - 0.5;
    let i = vec2<i32>(floor(t));
    let f = t - floor(t);
    let a = mix(cover_fetch(l, i), cover_fetch(l, i + vec2<i32>(1, 0)), f.x);
    let b = mix(cover_fetch(l, i + vec2<i32>(0, 1)), cover_fetch(l, i + vec2<i32>(1, 1)), f.x);
    return mix(a, b, f.y);
}

// Map `m` at `uv`, between the two mips about `lod`.
fn cover_sample(m: u32, uv: vec2<f32>, lod: f32) -> vec4<f32> {
    let top = f32(max(covers[m + 2u], 1u) - 1u);
    let l = clamp(lod, 0.0, top);
    let l0 = u32(floor(l));
    let l1 = min(l0 + 1u, u32(top));
    return mix(cover_bilinear(cover_level(m, l0), uv), cover_bilinear(cover_level(m, l1), uv), l - f32(l0));
}

// `uv` through an entry's map transform (two rows at word q).
fn cover_uv(q: u32, uv: vec2<f32>) -> vec2<f32> {
    let u = vec3<f32>(bitcast<f32>(covers[q]), bitcast<f32>(covers[q + 1u]), bitcast<f32>(covers[q + 2u]));
    let v = vec3<f32>(bitcast<f32>(covers[q + 3u]), bitcast<f32>(covers[q + 4u]), bitcast<f32>(covers[q + 5u]));
    return vec2<f32>(dot(u, vec3<f32>(uv, 1.0)), dot(v, vec3<f32>(uv, 1.0)));
}

// The triplanar weights for `n`: |n|^p, summing to 1.
fn cover_triplanar(n: vec3<f32>) -> vec3<f32> {
    let a = pow(abs(n), vec3<f32>(COVER_POWER));
    return a / max(a.x + a.y + a.z, 1e-30);
}

// `s` under the cover of the solid `pick` at `local` (its own space, m): each entry's material
// (its map's texels times its factors, after its modifies) mixed over what lies under it by its
// weight there, before any light. `geometric` is the face's normal in its own space, `shaded`
// the interpolated one, `uv0` its first texture coordinate and `world` where it is.
fn covered(s0: Surface, pick: u32, local: vec3<f32>, world: vec3<f32>, uv0: vec2<f32>, geometric: vec3<f32>, shaded: vec3<f32>) -> Surface {
    var s = s0;
    if covers[0] == 0u {
        return s;
    }
    let e = cover_plate(pick);
    if e == 0xffffffffu {
        return s;
    }
    let at = cover_at(e, local);
    let gn = normalize(geometric);
    let weigh = select(gn, normalize(shaded), planted(P_COVER_SHADED));
    let tw = cover_triplanar(weigh);
    // A pixel's footprint on the ground, m: the eye's distance over the focal length in px (or
    // one over px per m), widened as the ground turns from the view.
    let v = select(normalize(lights.view.xyz), normalize(lights.view.xyz - world), lights.view.w > 0.5);
    let px = select(1.0, distance(lights.view.xyz, world), frame.viewport.w > 0.5) / max(frame.viewport.z, 1e-6);
    let footprint = px / max(abs(dot(v, gn)), 0.25);
    let maps_at = COVER_HEAD + covers[0] * COVER_PLATE;
    for (var k = 0u; k < covers[e + 7u]; k = k + 1u) {
        let q = e + 8u + k * COVER_ENTRY;
        let w = cover_weight(e, at, k, q);
        if w <= 0.0 {
            continue;
        }
        var base = vec3<f32>(bitcast<f32>(covers[q]), bitcast<f32>(covers[q + 1u]), bitcast<f32>(covers[q + 2u]));
        var rough = bitcast<f32>(covers[q + 3u]);
        let metal = bitcast<f32>(covers[q + 4u]);
        let map = covers[q + 6u];
        if map != 0xffffffffu {
            let m = maps_at + map * COVER_MAP;
            let scale = length(vec2<f32>(bitcast<f32>(covers[q + 7u]), bitcast<f32>(covers[q + 10u])));
            let lod = log2(max(footprint * f32(covers[m]) * scale, 1e-6));
            let projection = covers[q + 5u];
            let tri = projection == 1u || (projection == 2u && abs(gn.y) < COVER_AUTO_COS);
            var t: vec4<f32>;
            if tri && planted(P_COVER_PLANAR) {
                t = cover_sample(m, cover_uv(q + 7u, local.xz), lod);
            } else if tri {
                t = tw.x * cover_sample(m, cover_uv(q + 7u, vec2<f32>(local.z, -local.y)), lod)
                    + tw.y * cover_sample(m, cover_uv(q + 7u, local.xz), lod)
                    + tw.z * cover_sample(m, cover_uv(q + 7u, vec2<f32>(local.x, -local.y)), lod);
            } else {
                t = cover_sample(m, cover_uv(q + 7u, uv0), lod);
            }
            base = base * t.rgb;
        }
        for (var j = 0u; j < 2u; j = j + 1u) {
            let kind = covers[q + 13u + 3u * j];
            if kind == 0u {
                continue;
            }
            let slot = covers[q + 15u + 3u * j];
            var a = clamp(bitcast<f32>(covers[q + 14u + 3u * j]), 0.0, 1.0);
            if slot != 255u {
                a = a * cover_weight(e, at, slot, q);
            }
            if kind == 1u {
                base = base * (1.0 - 0.3 * a);
                rough = rough * (1.0 - 0.5 * a);
            } else {
                base = mix(base, COVER_DUST, 0.5 * a);
                rough = mix(rough, 1.0, 0.5 * a);
            }
        }
        s.base = mix(s.base, base, w);
        s.rough = mix(s.rough, rough, w);
        s.metallic = mix(s.metallic, metal, w);
    }
    return s;
}
