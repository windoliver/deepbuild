// #2513: render.exposure's measure as one reduction over a frame's pre-tone image and object-ID
// pass. Each workgroup writes the px it read, those over white and under black, and the sum of
// their luminances' log2 in steps of 2^-24 as a 64-bit integer, so the sum is exact and no order
// of adding changes it.

struct Query {
    size: vec2<u32>,
    // 1: every px; else those whose pick's bit is set in `picks`.
    every: u32,
    words: u32,
    exposure: f32,
    white: f32,
    black: f32,
    floor_at: f32,
    weights: vec4<f32>,
};

struct Partial {
    px: u32,
    over: u32,
    under: u32,
    lo: u32,
    hi: i32,
};

@group(0) @binding(0) var pre_tone: texture_2d<f32>;
@group(0) @binding(1) var ids: texture_2d<u32>;
@group(0) @binding(2) var<uniform> q: Query;
@group(0) @binding(3) var<storage, read> picks: array<u32>;
@group(0) @binding(4) var<storage, read_write> partials: array<Partial>;

const GROUP: u32 = 256u;
const STEPS: f32 = 16777216.0;

var<workgroup> px_s: array<u32, 256>;
var<workgroup> over_s: array<u32, 256>;
var<workgroup> under_s: array<u32, 256>;
var<workgroup> lo_s: array<u32, 256>;
var<workgroup> hi_s: array<i32, 256>;

fn chosen(pick: u32) -> bool {
    if (q.every == 1u) {
        return true;
    }
    let w = pick >> 5u;
    return w < q.words && ((picks[w] >> (pick & 31u)) & 1u) == 1u;
}

// log2 of a positive, finite, normal x in steps of 2^-24: its exponent exactly, and its mantissa,
// brought within [√½, √2], through log2, which is accurate to 2^-22 there even under fast math.
fn log2_steps(x: f32) -> i32 {
    let bits = bitcast<u32>(x);
    var k = i32((bits >> 23u) & 0xffu) - 127;
    var m = bitcast<f32>((bits & 0x007fffffu) | 0x3f800000u);
    if (m > 1.4142135) {
        m = m * 0.5;
        k = k + 1;
    }
    return k * 16777216 + i32(round(log2(m) * STEPS));
}

@compute @workgroup_size(256)
fn reduce(
    @builtin(local_invocation_index) li: u32,
    @builtin(workgroup_id) wg: vec3<u32>,
    @builtin(num_workgroups) groups: vec3<u32>,
) {
    let n = q.size.x * q.size.y;
    let stride = groups.x * GROUP;
    var px = 0u;
    var over = 0u;
    var under = 0u;
    var lo = 0u;
    var hi = 0;
    for (var i = wg.x * GROUP + li; i < n; i = i + stride) {
        let at = vec2<u32>(i % q.size.x, i / q.size.x);
        if (!chosen(textureLoad(ids, at, 0).r)) {
            continue;
        }
        let rgb = textureLoad(pre_tone, at, 0).rgb * q.exposure;
        let most = max(rgb.r, max(rgb.g, rgb.b));
        let lum = dot(q.weights.rgb, rgb);
        px = px + 1u;
        over = over + select(0u, 1u, most > q.white);
        under = under + select(0u, 1u, most < q.black);
        // The floor where the luminance falls under it or isn't a number; the largest finite
        // f32 for an infinite one.
        let v = log2_steps(select(q.floor_at, min(lum, 3.0e38), lum > q.floor_at));
        let sum = lo + bitcast<u32>(v);
        hi = hi + select(0, 1, sum < lo) + select(0, -1, v < 0);
        lo = sum;
    }
    px_s[li] = px;
    over_s[li] = over;
    under_s[li] = under;
    lo_s[li] = lo;
    hi_s[li] = hi;
    workgroupBarrier();
    for (var s = GROUP / 2u; s > 0u; s = s >> 1u) {
        if (li < s) {
            px_s[li] = px_s[li] + px_s[li + s];
            over_s[li] = over_s[li] + over_s[li + s];
            under_s[li] = under_s[li] + under_s[li + s];
            let sum = lo_s[li] + lo_s[li + s];
            hi_s[li] = hi_s[li] + hi_s[li + s] + select(0, 1, sum < lo_s[li]);
            lo_s[li] = sum;
        }
        workgroupBarrier();
    }
    if (li == 0u) {
        partials[wg.x] = Partial(px_s[0], over_s[0], under_s[0], lo_s[0], hi_s[0]);
    }
}
