// Issue #427: deep_show's 3D diagnostic views (canvas primitives: Render-back: diagnostic modes),
// drawn in place of the look on the offscreen copy. Colors here are sRGB-encoded and written as
// they are: the look's ground and ink, greys between them, and one false-color ramp whose stops
// stay clear of every status color.

struct Light {
    // xyz position, w range (a negative range reaches everywhere).
    pos: vec4<f32>,
    // xyz the direction it shines, w cos of a spot's outer half angle (−2 for no cone).
    dir: vec4<f32>,
};

struct U {
    clip: mat4x4<f32>,
    eye: vec4<f32>,
    forward: vec4<f32>,
    // xyz toward the key light, unit.
    light: vec4<f32>,
    // x the view, y lights, z cascades, w 1 with a cluster grid.
    mode: vec4<u32>,
    // Each cascade's far end along the view axis.
    splits: vec4<f32>,
    // x the deviation ramp's top in m, y the grid's far plane, z its near plane, w the overdraw
    // ramp's top.
    misc: vec4<f32>,
    viewport: vec4<f32>,
    ground: vec4<f32>,
    ink: vec4<f32>,
    lights: array<Light, 32>,
};

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> grid: array<u32>;

const PLAIN: u32 = 0u;
const CASCADES: u32 = 2u;
const LIGHTS: u32 = 3u;
const TINTED: u32 = 4u;
const CHECKER: u32 = 6u;
const DEVIATION: u32 = 7u;

// The false-color ramp, 0 to 1: deep violet, blue, teal, lime, yellow (a viridis-like run whose
// stops and mixes keep away from the status colors).
fn ramp(t: f32) -> vec3<f32> {
    var stops = array<vec3<f32>, 5>(
        vec3<f32>(68.0, 1.0, 84.0),
        vec3<f32>(59.0, 82.0, 139.0),
        vec3<f32>(33.0, 145.0, 140.0),
        vec3<f32>(94.0, 201.0, 98.0),
        vec3<f32>(253.0, 231.0, 37.0),
    );
    let x = clamp(t, 0.0, 1.0) * 4.0;
    let i = min(u32(floor(x)), 3u);
    return mix(stops[i], stops[i + 1u], x - f32(i)) / 255.0;
}

struct VIn {
    @location(0) pos: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) value: f32,
    @location(4) color: vec3<f32>,
};

struct VOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) world: vec3<f32>,
    @location(1) normal: vec3<f32>,
    @location(2) uv: vec2<f32>,
    @location(3) value: f32,
    @location(4) color: vec3<f32>,
};

@vertex
fn solid_vs(v: VIn) -> VOut {
    var o: VOut;
    o.clip = u.clip * vec4<f32>(v.pos, 1.0);
    o.world = v.pos;
    o.normal = v.normal;
    o.uv = v.uv;
    o.value = v.value;
    o.color = v.color;
    return o;
}

struct FOut {
    @location(0) color: vec4<f32>,
    // What the view counts at the pixel: lights reaching it, or the cascade that holds it.
    @location(1) value: vec4<f32>,
};

fn shade(n: vec3<f32>, facing: bool) -> f32 {
    var m = normalize(n);
    if !facing {
        m = -m;
    }
    return 0.5 + 0.5 * max(dot(m, u.light.xyz), 0.0);
}

fn reaching(world: vec3<f32>, px: vec2<f32>) -> u32 {
    if u.mode.w == 1u {
        let z = max(dot(world - u.eye.xyz, u.forward.xyz), u.misc.z);
        let slice = min(u32(log(z / u.misc.z) / log(u.misc.y / u.misc.z) * 24.0), 23u);
        let x = min(u32(px.x / u.viewport.x * 16.0), 15u);
        let y = min(u32(px.y / u.viewport.y * 9.0), 8u);
        return countOneBits(grid[(slice * 9u + y) * 16u + x]);
    }
    var n = 0u;
    for (var i = 0u; i < u.mode.y; i++) {
        let l = u.lights[i];
        if l.pos.w < 0.0 {
            n += 1u;
            continue;
        }
        let d = world - l.pos.xyz;
        let r = length(d);
        if r > l.pos.w {
            continue;
        }
        if l.dir.w > -1.5 && r > 0.0 && dot(d / r, l.dir.xyz) < l.dir.w {
            continue;
        }
        n += 1u;
    }
    return n;
}

@fragment
fn solid_fs(v: VOut, @builtin(front_facing) facing: bool) -> FOut {
    var o: FOut;
    let s = shade(v.normal, facing);
    let mode = u.mode.x;
    var c = v.color * s;
    var value = 0.0;
    if mode == CASCADES {
        let n = u.mode.z;
        var k = n;
        let z = dot(v.world - u.eye.xyz, u.forward.xyz);
        for (var i = 0u; i < n; i++) {
            if z <= u.splits[i] {
                k = i;
                break;
            }
        }
        if k < n {
            c = ramp((f32(k) + 0.5) / f32(n)) * s;
        }
        value = f32(k);
    } else if mode == LIGHTS {
        let n = reaching(v.world, v.clip.xy);
        // A frame walks up to 8 lights without a cluster grid; 8 or more reads at the top.
        c = ramp(f32(n) / 8.0) * s;
        if n == 0u {
            c = v.color * s;
        }
        value = f32(n);
    } else if mode == CHECKER {
        // Two roles, 8 cells per uv0 unit, each cell darkening along +u so a mirrored island's
        // marks run the other way.
        let cell = floor(v.uv * 8.0);
        let odd = (i32(cell.x) + i32(cell.y)) & 1;
        let a = mix(u.ground.rgb, u.ink.rgb, 0.12);
        let b = mix(u.ground.rgb, u.ink.rgb, 0.55);
        let base = select(a, b, odd == 1);
        let along = fract(v.uv.x * 8.0);
        c = base * (1.0 - 0.18 * along) * (0.75 + 0.25 * s);
    } else if mode == DEVIATION {
        if v.value >= 0.0 {
            c = ramp(v.value / max(u.misc.x, 1e-12)) * (0.8 + 0.2 * s);
        }
        value = v.value;
    }
    o.color = vec4<f32>(c, 1.0);
    o.value = vec4<f32>(value, 0.0, 0.0, 1.0);
    return o;
}

// Overdraw: every fragment of every surface adds one, depth ignored.
@fragment
fn count_fs(v: VOut) -> @location(0) vec4<f32> {
    return vec4<f32>(1.0, 0.0, 0.0, 0.0);
}

struct Full {
    @builtin(position) clip: vec4<f32>,
};

@vertex
fn full_vs(@builtin(vertex_index) i: u32) -> Full {
    var o: Full;
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    o.clip = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

@group(1) @binding(0) var counts: texture_2d<f32>;

// The overdraw count through the ramp, the ground where nothing drew.
@fragment
fn overdraw_fs(f: Full) -> @location(0) vec4<f32> {
    let n = textureLoad(counts, vec2<i32>(f.clip.xy), 0).r;
    if n < 0.5 {
        return vec4<f32>(u.ground.rgb, 1.0);
    }
    return vec4<f32>(ramp((n - 1.0) / max(u.misc.w - 1.0, 1.0)), 1.0);
}

@group(1) @binding(1) var shadows: texture_depth_2d_array;

// The key sun's cascades laid out as tiles, two across: each texel's depth from the light as a
// grey between ink (near the light) and ground (far), framed by its cascade's ramp color.
@fragment
fn atlas_fs(f: Full) -> @location(0) vec4<f32> {
    let n = u.mode.z;
    let across = select(1u, 2u, n > 1u);
    let rows = (n + across - 1u) / across;
    let side = min(u.viewport.x / f32(across), u.viewport.y / f32(max(rows, 1u)));
    let cell = vec2<u32>(floor(f.clip.xy / side));
    let k = cell.y * across + cell.x;
    if n == 0u || cell.x >= across || k >= n {
        return vec4<f32>(u.ground.rgb, 1.0);
    }
    let local = (f.clip.xy - vec2<f32>(cell) * side) / side;
    if any(local < vec2<f32>(0.02)) || any(local > vec2<f32>(0.98)) {
        return vec4<f32>(ramp((f32(k) + 0.5) / f32(n)), 1.0);
    }
    let dims = vec2<f32>(textureDimensions(shadows));
    let d = textureLoad(shadows, vec2<i32>(local * dims), i32(k), 0);
    return vec4<f32>(mix(u.ink.rgb, u.ground.rgb, clamp(d, 0.0, 1.0)), 1.0);
}

struct LIn {
    @builtin(vertex_index) i: u32,
    @location(0) a: vec3<f32>,
    @location(1) b: vec3<f32>,
    @location(2) color: vec3<f32>,
    @location(3) width: f32,
};

struct LOut {
    @builtin(position) clip: vec4<f32>,
    @location(0) color: vec3<f32>,
};

// One segment as a screen-space quad `width` px across, both ends in front of the eye.
@vertex
fn line_vs(l: LIn) -> LOut {
    let ca = u.clip * vec4<f32>(l.a, 1.0);
    let cb = u.clip * vec4<f32>(l.b, 1.0);
    let half = u.viewport.xy * 0.5;
    let sa = ca.xy / ca.w * half;
    let sb = cb.xy / cb.w * half;
    var dir = sb - sa;
    if length(dir) < 1e-6 {
        dir = vec2<f32>(1.0, 0.0);
    }
    let perp = normalize(vec2<f32>(-dir.y, dir.x));
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(0.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(0.0, 1.0),
    );
    let k = corners[l.i];
    let c = mix(ca, cb, k.x);
    var o: LOut;
    o.clip = vec4<f32>(c.xy + perp * k.y * l.width * 0.5 / half * c.w, c.z, c.w);
    o.color = l.color;
    return o;
}

@fragment
fn line_fs(l: LOut) -> FOut {
    var o: FOut;
    o.color = vec4<f32>(l.color, 1.0);
    o.value = vec4<f32>(0.0);
    return o;
}
