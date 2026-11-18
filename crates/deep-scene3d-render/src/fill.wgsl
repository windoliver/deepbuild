// The fill lights' clusters (issue #1634; canvas primitives: Light and the light policy). One
// invocation fills one cell of the policy's grid: it walks the view's fill lights in the policy's
// order (score bucket, then ID) and lists the ones whose range reaches the cell, so a cell's list
// is in that order whatever ran first and a frame stays a function of the view. Past the
// cluster's cap it keeps the first of them, dims the ones within the policy's margin of the first
// it drops, and reports the cell with every light that reached it.

struct Params {
    // xy: the frame's centre in px; z: px per m at 1 m (perspective) or per m; w: 1 for
    // perspective.
    lens: vec4<f32>,
    // xy: the roll's cos and sin; zw: a tile's size in px.
    roll: vec4<f32>,
    // x: the grid's near plane; y: its far plane; z: the policy's margin.
    depth: vec4<f32>,
    // x: how many lights; y: a cluster's most; z: 1 for the planted cap, which weighs every
    // light it keeps at 1.
    count: vec4<u32>,
};

struct Reach {
    // xyz: the light in view space (x right, y up, z along the view); w: its range in m.
    at: vec4<f32>,
    // Its score as m × 2^e: x the 32 bits of m in [2^31, 2^32), y the exponent, biased; z: its
    // place in the policy's order, which only the planted pass reads.
    score: vec4<u32>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> reach: array<Reach>;
// Each cell's list (scene3d.wgsl's `fill_lists`): how many it holds and how many reached it,
// then the lights by their place in `reach`, then each one's weight (f32 bits).
@group(0) @binding(2) var<storage, read_write> lists: array<u32>;
// Each cell's count of the lights that reached it, then a bit per light for each cell past its
// cap.
@group(0) @binding(3) var<storage, read_write> report: array<u32>;

// Each light's span (fill.rs: `span`): the tiles and slices its range can reach, bounded on the
// CPU, so a cell runs a light's own test only inside it. From the low bits: its first and last
// tile column and row, four bits each, then its first and last slice, five bits each. Then, from
// `BY_CELL`, where each cell's lights start among the ones after them, and those lights, two to
// a word: the ones whose span holds the cell, in the policy's order.
@group(0) @binding(4) var<storage, read> spans: array<u32>;
const BY_CELL: u32 = 2048u;

const TILES: vec2<u32> = vec2<u32>(16u, 9u);
const SLICES: u32 = 24u;
const CELLS: u32 = 3456u;
const WORDS: u32 = 64u;
const NONE: u32 = 0xffffffffu;

// A slice's near depth: by a fixed ratio from the near plane to the far one in a perspective
// view (clusters.rs), in even steps in an orthographic one.
fn slice_near(s: u32) -> f32 {
    let t = f32(s) / f32(SLICES);
    if params.lens.w > 0.5 {
        return params.depth.x * pow(params.depth.y / params.depth.x, t);
    }
    return mix(params.depth.x, params.depth.y, t);
}

// Where frame px `p` at depth `z` is across the view: Camera::unproject, in the view's axes.
fn across(p: vec2<f32>, z: f32) -> vec2<f32> {
    let d = p - params.lens.xy;
    let x = d.x * params.roll.x + d.y * params.roll.y;
    let y = d.y * params.roll.x - d.x * params.roll.y;
    let s = select(params.lens.z, params.lens.z / z, params.lens.w > 0.5);
    return vec2<f32>(x, -y) / s;
}

// A kept light's weight beside the first light its cluster dropped: (score − cut) ÷ (cut ×
// margin), from 0 to 1. In whole numbers until the last division, so a weight is the same to
// one part in ten million however the floats round.
fn weight(score: vec2<u32>, cut: vec2<u32>) -> f32 {
    var over = 0.0;
    if score.y == cut.y {
        if score.x <= cut.x {
            return 0.0;
        }
        over = f32(score.x - cut.x) / f32(cut.x);
    } else if score.y == cut.y + 1u {
        // One stop up: 2m − c, halved to stay in 32 bits.
        let half = cut.x >> 1u;
        over = f32(score.x - half) / f32(half);
    } else {
        return select(0.0, 1.0, score.y > cut.y);
    }
    return clamp(over / params.depth.z, 0.0, 1.0);
}

// A cell's box in view space, around its eight corners.
struct Bounds {
    lo: vec3<f32>,
    hi: vec3<f32>,
};

fn bounds(cell: u32) -> Bounds {
    let tile = vec2<u32>(cell % TILES.x, (cell / TILES.x) % TILES.y);
    let s = cell / (TILES.x * TILES.y);
    let z0 = slice_near(s);
    let z1 = slice_near(s + 1u);
    let p0 = vec2<f32>(tile) * params.roll.zw;
    let p1 = p0 + params.roll.zw;
    var lo = vec2<f32>(3.0e38);
    var hi = vec2<f32>(-3.0e38);
    for (var k = 0u; k < 8u; k++) {
        let p = vec2<f32>(select(p0.x, p1.x, (k & 1u) != 0u), select(p0.y, p1.y, (k & 2u) != 0u));
        let v = across(p, select(z0, z1, (k & 4u) != 0u));
        lo = min(lo, v);
        hi = max(hi, v);
    }
    return Bounds(vec3<f32>(lo, z0), vec3<f32>(hi, z1));
}

// A cell's tile column, tile row and slice.
fn place(cell: u32) -> vec3<u32> {
    return vec3<u32>(cell % TILES.x, (cell / TILES.x) % TILES.y, cell / (TILES.x * TILES.y));
}

// Whether a light's span holds the cell at `at`.
fn within(span: u32, at: vec3<u32>) -> bool {
    return at.x >= (span & 15u) && at.x <= ((span >> 4u) & 15u)
        && at.y >= ((span >> 8u) & 15u) && at.y <= ((span >> 12u) & 15u)
        && at.z >= ((span >> 16u) & 31u) && at.z <= ((span >> 21u) & 31u);
}

// Whether a light's range reaches a cell's box.
fn reaches(b: Bounds, l: vec4<f32>) -> bool {
    let d = max(max(b.lo - l.xyz, l.xyz - b.hi), vec3<f32>(0.0));
    return dot(d, d) <= l.w * l.w;
}

// ASSIGN
@compute @workgroup_size(64)
fn assign(@builtin(global_invocation_id) id: vec3<u32>) {
    let cell = id.x;
    if cell >= CELLS {
        return;
    }
    let cap = params.count.y;
    let base = cell * (2u + 2u * cap);
    // Its lights: the ones whose span holds it, two to a word.
    let lights = BY_CELL + CELLS + 1u;
    let first = spans[BY_CELL + cell];
    let last = spans[BY_CELL + cell + 1u];
    // A cell no light's span holds lists none, and needs no box.
    if first == last {
        lists[base] = 0u;
        lists[base + 1u] = 0u;
        report[cell] = 0u;
        return;
    }
    let b = bounds(cell);
    var kept = 0u;
    var total = 0u;
    var cut = NONE;
    for (var k = first; k < last; k++) {
        let i = (spans[lights + (k >> 1u)] >> ((k & 1u) * 16u)) & 0xffffu;
        if !reaches(b, reach[i].at) {
            continue;
        }
        if kept < cap {
            lists[base + 2u + kept] = i;
            kept++;
        } else if cut == NONE {
            cut = i;
        }
        total++;
    }
    lists[base] = kept;
    lists[base + 1u] = total;
    for (var k = 0u; k < kept; k++) {
        var w = 1.0;
        if cut != NONE && params.count.z == 0u {
            w = weight(reach[lists[base + 2u + k]].score.xy, reach[cut].score.xy);
        }
        lists[base + 2u + cap + k] = bitcast<u32>(w);
    }
    report[cell] = total;
    // Past its cap, a bit for every light that reached it, walked once more.
    if total > cap {
        let word = CELLS + cell * WORDS;
        for (var k = 0u; k < WORDS; k++) {
            report[word + k] = 0u;
        }
        for (var k = first; k < last; k++) {
            let i = (spans[lights + (k >> 1u)] >> ((k & 1u) * 16u)) & 0xffffu;
            if reaches(b, reach[i].at) {
                report[word + (i >> 5u)] |= 1u << (i & 31u);
            }
        }
    }
}
