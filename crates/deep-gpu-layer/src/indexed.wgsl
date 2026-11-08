// Issue #464: the indexed basis's operator (canvas primitives: Look `look@1`: indexed basis). Each
// target pixel takes the palette index of the last mark whose outline holds its center, in
// fixed point at 1/16 of a target pixel, integers only, so it is exact on every GPU. A see-through
// mark draws by the 4 × 4 ordered threshold anchored to target pixels, or is blended after the
// palette resolve in 8-bit integers; `blend: add` marks write the light target, added after the
// resolve and never onto a protected index. Its only outputs are each pixel's index and its
// resolved color, written at the invocation's own index.

struct Prim {
    // 0 a filled outline (its edges), 1 a disc or ring, 2 a stroke one target pixel wide.
    kind: u32,
    // The palette index it writes.
    index: u32,
    // Its opacity, 0..255.
    alpha: u32,
    // Its edges: the first and how many; a disc's center is edge `first`'s start.
    first: u32,
    count: u32,
    // A disc's radius and inner radius, fixed point.
    r: u32,
    r_inner: u32,
    // A light mark's RGB, packed 0x00BBGGRR, or 0xffffffff for an ordinary mark.
    light: u32,
}

struct Params {
    // The index target's size.
    w: u32,
    h: u32,
    prims: u32,
    ground: u32,
    // FLAG_*.
    flags: u32,
    // The light target's saturation.
    light_max: u32,
    // The upscale's factor.
    scale: u32,
    palette: u32,
}

const FLAG_BLEND: u32 = 1u;
const FLAG_LIGHT: u32 = 2u;
// The planted programs (#464's twins).
const FLAG_PARTIAL: u32 = 4u;
const FLAG_FULL_OPACITY: u32 = 8u;
const FLAG_LIGHT_AFTER: u32 = 16u;
const NO_LIGHT: u32 = 0xffffffffu;
const NONE: u32 = 0xffffffffu;
const ONE: i32 = 16;

@group(0) @binding(0) var<uniform> P: Params;
@group(0) @binding(1) var<storage, read> prims: array<Prim>;
@group(0) @binding(2) var<storage, read> edges: array<vec4<i32>>;
// Each index's color, packed 0x00BBGGRR, with bit 24 set on a protected index.
@group(0) @binding(3) var<storage, read> palette: array<u32>;
@group(0) @binding(4) var<storage, read_write> indices: array<u32>;
@group(0) @binding(5) var<storage, read_write> resolved: array<u32>;

fn floor_div(a: i32, b: i32) -> i32 {
    var q = a / b;
    if (a % b) != 0 && ((a < 0) != (b < 0)) {
        q = q - 1;
    }
    return q;
}

// Whether the point `c` (fixed point) lies inside the outline of `p`, by its nonzero winding.
fn inside_outline(p: Prim, c: vec2<i32>) -> bool {
    var winding = 0;
    for (var k = 0u; k < p.count; k = k + 1u) {
        let e = edges[p.first + k];
        let left = (e.z - e.x) * (c.y - e.y) - (c.x - e.x) * (e.w - e.y);
        if e.y <= c.y {
            if e.w > c.y && left > 0 {
                winding = winding + 1;
            }
        } else if e.w <= c.y && left < 0 {
            winding = winding - 1;
        }
    }
    return winding != 0;
}

fn inside_disc(p: Prim, c: vec2<i32>) -> bool {
    let e = edges[p.first];
    let d = c - e.xy;
    let d2 = d.x * d.x + d.y * d.y;
    let r = i32(p.r);
    let ri = i32(p.r_inner);
    return d2 <= r * r && (ri == 0 || d2 > ri * ri);
}

// A stroke one target pixel wide steps one pixel along its major axis: in each column (or row)
// its segment spans, the pixel holding the line at that column's center.
fn on_stroke(p: Prim, px: vec2<i32>, spread: i32) -> bool {
    for (var k = 0u; k < p.count; k = k + 1u) {
        var e = edges[p.first + k];
        let dx = abs(e.z - e.x);
        let dy = abs(e.w - e.y);
        var a = px.x;
        var b = px.y;
        if dy > dx {
            e = e.yxwz;
            a = px.y;
            b = px.x;
        }
        if e.z < e.x {
            e = e.zwxy;
        }
        let ca = a * ONE + ONE / 2;
        if ca < e.x || ca > e.z {
            continue;
        }
        let run = e.z - e.x;
        if run == 0 {
            if floor_div(e.y, ONE) == b {
                return true;
            }
            continue;
        }
        let num = e.y * run + (ca - e.x) * (e.w - e.y);
        let lo = floor_div(num - spread * run, run * ONE);
        let hi = floor_div(num + spread * run, run * ONE);
        if b >= lo && b <= hi {
            return true;
        }
    }
    return false;
}

// Whether mark `p` covers target pixel `px`: its center inside, or with the planted rasterizer
// any of nine points across the pixel.
fn covers(p: Prim, px: vec2<i32>, partial: bool) -> bool {
    if p.kind == 2u {
        return on_stroke(p, px, select(0, ONE / 2, partial));
    }
    let base = px * ONE;
    for (var k = 0u; k < 9u; k = k + 1u) {
        var at = base + vec2<i32>(ONE / 2);
        if partial {
            at = base + vec2<i32>(i32(k % 3u) * 7 + 1, i32(k / 3u) * 7 + 1);
        } else if k > 0u {
            break;
        }
        var hit: bool;
        if p.kind == 1u {
            hit = inside_disc(p, at);
        } else {
            hit = inside_outline(p, at);
        }
        if hit {
            return true;
        }
    }
    return false;
}

fn protected_index(i: u32) -> bool {
    return i < P.palette && (palette[i] & 0x1000000u) != 0u;
}

fn channel(c: u32, k: u32) -> u32 {
    return (c >> (8u * k)) & 0xffu;
}

const BAYER: array<u32, 16> = array<u32, 16>(0u, 8u, 2u, 10u, 12u, 4u, 14u, 6u, 3u, 11u, 1u, 9u, 15u, 7u, 13u, 5u);

@compute @workgroup_size(8, 8)
fn index_main(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= P.w || id.y >= P.h {
        return;
    }
    let px = vec2<i32>(id.xy);
    let partial = (P.flags & FLAG_PARTIAL) != 0u;
    let light_on = (P.flags & FLAG_LIGHT) != 0u && (P.flags & FLAG_LIGHT_AFTER) == 0u;
    var idx = P.ground;
    var over = NONE;
    var light = vec3<u32>(0u);
    for (var k = 0u; k < P.prims; k = k + 1u) {
        let p = prims[k];
        if p.light != NO_LIGHT {
            if light_on && covers(p, px, partial) {
                light = light + vec3<u32>(channel(p.light, 0u), channel(p.light, 1u), channel(p.light, 2u));
            }
            continue;
        }
        if !covers(p, px, partial) {
            continue;
        }
        var a = p.alpha;
        if (P.flags & FLAG_FULL_OPACITY) != 0u {
            a = 255u;
        }
        if a >= 255u {
            idx = p.index;
            over = NONE;
        } else if !protected_index(idx) {
            if (P.flags & FLAG_BLEND) != 0u {
                over = (p.index << 8u) | a;
            } else if BAYER[(id.y % 4u) * 4u + id.x % 4u] < (a * 16u + 127u) / 255u {
                idx = p.index;
                over = NONE;
            }
        }
    }
    let at = id.y * P.w + id.x;
    indices[at] = idx;
    var color = palette[min(idx, P.palette - 1u)] & 0xffffffu;
    if over != NONE && !protected_index(idx) {
        let src = palette[min(over >> 8u, P.palette - 1u)];
        let a = over & 0xffu;
        var mixed = 0u;
        for (var c = 0u; c < 3u; c = c + 1u) {
            mixed = mixed | (((a * channel(src, c) + (255u - a) * channel(color, c) + 127u) / 255u) << (8u * c));
        }
        color = mixed;
    }
    if light_on && !protected_index(idx) {
        let lit = min(light, vec3<u32>(P.light_max));
        var sum = 0u;
        for (var c = 0u; c < 3u; c = c + 1u) {
            sum = sum | (min(channel(color, c) + lit[c], 255u) << (8u * c));
        }
        color = sum;
    }
    resolved[at] = color;
}
