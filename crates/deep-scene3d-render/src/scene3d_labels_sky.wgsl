// ---- labels: a quad per glyph from the core's glyph atlas, in a label that faces the camera,
// stays upright or keeps its axes

@group(2) @binding(0) var atlas: texture_2d_array<f32>;
@group(2) @binding(1) var atlas_sampler: sampler;

struct TextOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) @interpolate(flat) color: u32,
    @location(2) @interpolate(flat) pick: u32,
    @location(3) @interpolate(flat) page: u32,
    @location(4) @interpolate(flat) later: u32,
    // Where the fragment is in the world, and whether the sky's fog applies to it (#1992).
    @location(5) world: vec3<f32>,
    @location(6) @interpolate(flat) fog: u32,
};

// A glyph whose color the label pass draws after the upscale (#1174): here it writes only the
// label's depth and pick.
const LATER: u32 = 256u;
// A label the sky's fog applies to, which draws here whatever its size space.
const FOG: u32 = 512u;

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
    out.fog = flags & FOG;
    out.world = p.xyz;
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
    out.world = p.xyz + right * offset.x - up * offset.y;
    out.pos = frame.clip * vec4<f32>(out.world, 1.0);
    return out;
}

@fragment
fn text_fs(in: TextOut) -> Targets {
    let a = textureSample(atlas, atlas_sampler, in.uv, in.page).r;
    if a <= 0.002 {
        discard;
    }
    let shown = select(a, 0.0, in.later != 0u) * unpack4x8unorm(in.color).a;
    var c = paint(in.color);
    if in.fog != 0u {
        c = fogged(c, in.world);
    }
    return targets(vec4<f32>(c * shown, shown), select(0u, in.pick, a >= 0.5));
}

// ---- image marks (#1992): a picture on one quad, placed and turned as a label's glyph is

@group(2) @binding(2) var mark_image: texture_2d<f32>;

@fragment
fn image_fs(in: TextOut) -> Targets {
    let t = textureSample(mark_image, atlas_sampler, in.uv);
    if t.a <= 0.002 {
        discard;
    }
    var c = t.rgb;
    if in.fog != 0u {
        c = fogged(c, in.world);
    }
    return targets(vec4<f32>(c * t.a, t.a), select(0u, in.pick, t.a >= 0.5));
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
// one, at its blur) or the sky's own fields, at the background's own intensity, which scales
// nothing the environment lights (#1992).
fn background(d: vec3<f32>) -> vec3<f32> {
    if env.bg.x < 0.5 {
        return sky_fields(d) * env.range.z;
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
        return select(a, mix(a, b, env.m.x), env.m.x > 0.0) * env.k.z * env.range.z;
    }
    return env_radiance(dir, 0.0) * env.k.z * env.range.z;
}

@fragment
fn sky_fs(@builtin(position) pos: vec4<f32>) -> Targets {
    return targets(vec4<f32>(background(view_ray(pos.xy)), 1.0), 0u);
}

// Fog on a lit surface or a mark at `world` (#422, #1992; Sky `sky@1` and its height fog): the
// distance fog by its curve, over the distance from the eye whatever the curve, and the mist
// below the height fog's top along the ray's length beneath it, mixed toward the fog's color or
// what the background shows along the ray.
fn fogged(c: vec3<f32>, world: vec3<f32>) -> vec3<f32> {
    let ramp = env.fog.y > 1.5;
    if env.low.w < 0.5 || (env.fog.x <= 0.0 && env.fog.w <= 0.0 && !ramp) {
        return c;
    }
    let ray = world - env.eye.xyz;
    let dist = length(ray);
    let a = env.fog.x * dist;
    var keep = select(exp(-a), exp(-a * a), env.fog.y > 0.5);
    if ramp {
        keep = 1.0 - clamp((dist - env.range.x) / (env.range.y - env.range.x), 0.0, 1.0);
    }
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

