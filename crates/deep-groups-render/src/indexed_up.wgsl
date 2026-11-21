// Issue #464: the indexed basis's upscale: each frame pixel shows its target pixel's resolved
// color by nearest, never interpolating. The planted light_after_upscale adds the light marks here,
// at the frame's own resolution, after the resolve and the upscale: the wrong program its twin
// catches.

struct Prim {
    kind: u32,
    index: u32,
    alpha: u32,
    first: u32,
    count: u32,
    r: u32,
    r_inner: u32,
    light: u32,
}

struct Params {
    w: u32,
    h: u32,
    prims: u32,
    ground: u32,
    flags: u32,
    light_max: u32,
    scale: u32,
    palette: u32,
}

const FLAG_LIGHT: u32 = 2u;
const FLAG_LIGHT_AFTER: u32 = 16u;
const NO_LIGHT: u32 = 0xffffffffu;

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> resolved: array<u32>;
@group(0) @binding(2) var<storage, read> prims: array<Prim>;
@group(0) @binding(3) var<storage, read> edges: array<vec4<i32>>;
@group(0) @binding(4) var<storage, read> indices: array<u32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
    let xy = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(xy * 2.0 - 1.0, 0.0, 1.0);
}

fn channel(c: u32, k: u32) -> u32 {
    return (c >> (8u * k)) & 0xffu;
}

@fragment
fn fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    let px = vec2<u32>(p.xy);
    let t = min(px / P.scale, vec2<u32>(P.w - 1u, P.h - 1u));
    var c = resolved[t.y * P.w + t.x];
    if (P.flags & (FLAG_LIGHT | FLAG_LIGHT_AFTER)) == (FLAG_LIGHT | FLAG_LIGHT_AFTER) {
        // The frame pixel's centre in the target's fixed point.
        let at = vec2<i32>((vec2<u32>(px) * 16u + vec2<u32>(8u)) / P.scale);
        var light = vec3<u32>(0u);
        for (var k = 0u; k < P.prims; k = k + 1u) {
            let m = prims[k];
            if m.light == NO_LIGHT || m.kind != 1u {
                continue;
            }
            let d = at - edges[m.first].xy;
            let r = i32(m.r);
            if d.x * d.x + d.y * d.y <= r * r {
                light = light + vec3<u32>(channel(m.light, 0u), channel(m.light, 1u), channel(m.light, 2u));
            }
        }
        let lit = min(light, vec3<u32>(P.light_max));
        c = min(channel(c, 0u) + lit.x, 255u) | (min(channel(c, 1u) + lit.y, 255u) << 8u)
            | (min(channel(c, 2u) + lit.z, 255u) << 16u);
    }
    return vec4<f32>(f32(channel(c, 0u)), f32(channel(c, 1u)), f32(channel(c, 2u)), 255.0) / 255.0;
}
