// The test render module `test.scene@1` (issue #377): a scene's regions drawn exactly. Each region
// is one draw clipped to its rect by the scissor; the fragment computes its fill from the pixel's
// integer position, so every byte is the one the scene's format gives. Colors are BGRA bytes,
// premultiplied, written as they are (the slot holds sRGB-encoded values).

struct Region {
    // x, y of the region's unclipped origin in frame px.
    origin: vec2<i32>,
    // 0 color, 1 ramp, 2 stamp, 3 texture.
    kind: u32,
    // ramp: step; stamp: bits; texture: width.
    a: u32,
    // ramp: 1 for bgra (alpha follows the ramp); stamp: cell.
    b: u32,
    // ramp (bgr): alpha; stamp: the frame number.
    c: u32,
    _pad: vec2<u32>,
    // color, or the stamp's one; BGRA bytes.
    one: vec4<u32>,
    // the stamp's zero.
    zero: vec4<u32>,
};

@group(0) @binding(0) var<storage, read> regions: array<Region>;
@group(0) @binding(1) var<storage, read> texels: array<u32>;

struct Out {
    @builtin(position) position: vec4<f32>,
    @location(0) @interpolate(flat) region: u32,
};

@vertex
fn region_vertex(@builtin(vertex_index) i: u32, @builtin(instance_index) region: u32) -> Out {
    let uv = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return Out(vec4(uv * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0), region);
}

fn bgra(px: vec4<u32>) -> vec4<f32> {
    return vec4<f32>(f32(px.z), f32(px.y), f32(px.x), f32(px.w)) / 255.0;
}

@fragment
fn region_fragment(in: Out) -> @location(0) vec4<f32> {
    let r = regions[in.region];
    let p = vec2<i32>(floor(in.position.xy));
    let dx = u32(p.x - r.origin.x);
    let dy = u32(p.y - r.origin.y);
    switch r.kind {
        case 1u: {
            let v = min(255u, dx / r.a);
            if (r.b == 1u) {
                return bgra(vec4(v, v, v, v));
            }
            return bgra(vec4(v, v, v, r.c));
        }
        case 2u: {
            let k = dx / r.b;
            let value = r.c % (1u << r.a);
            if (k < r.a && ((value >> (r.a - 1u - k)) & 1u) == 1u) {
                return bgra(r.one);
            }
            return bgra(r.zero);
        }
        case 3u: {
            let t = texels[dy * r.a + dx];
            return bgra(vec4(t & 255u, (t >> 8u) & 255u, (t >> 16u) & 255u, t >> 24u));
        }
        default: {
            return bgra(r.one);
        }
    }
}
