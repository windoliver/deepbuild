// The export's per-frame checks (issue #157), integers only so every GPU gives the same numbers.
// `stats` reduces a frame, the BGRA8 words blake3 hashes, to its dark-pixel count, its luma
// histogram and its byte difference from another frame; `nonfinite` counts a float render
// target's non-finite texels by their raw bits; `derive` makes a redrawn frame's luma and alpha
// planes and `compare` scores a decoded plane against them, SSE exact and SSIM per 8x8 block.
// Sums wider than 32 bits are a low and a high word: whoever's add wraps the low word carries one.
// Each entry point binds from 0 in its own variables.

// The planted wrong program: the difference sum drops its carry, a 32-bit sum.
override carry_dropped: bool = false;

// A colour channel as it shows over black: c*a/255, rounded.
fn premul(c: u32, a: u32) -> u32 {
    return (c * a + 127u) / 255u;
}

// Byte `i % 4` of a little-endian word.
fn byte_of(word: u32, i: u32) -> u32 {
    return (word >> ((i & 3u) * 8u)) & 0xffu;
}

struct Stats {
    // Pixels in the frame.
    count: u32,
    // Invocations dispatched, the stride of each one's walk.
    threads: u32,
    pad0: u32,
    pad1: u32,
}

@group(0) @binding(0) var<uniform> st: Stats;
@group(0) @binding(1) var<storage, read> frame: array<u32>;
@group(0) @binding(2) var<storage, read> other: array<u32>;
// The dark count, the difference sum's low and high words, a pad, then the 256 luma bins.
@group(0) @binding(3) var<storage, read_write> sums: array<atomic<u32>, 260>;

var<workgroup> dark_part: atomic<u32>;
var<workgroup> diff_part: atomic<u32>;
var<workgroup> bins: array<atomic<u32>, 256>;

@compute @workgroup_size(256)
fn stats(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_index) li: u32,
) {
    var dark = 0u;
    var diff = 0u;
    for (var i = gid.x; i < st.count; i += st.threads) {
        let w = frame[i];
        let a = w >> 24u;
        // 10,000 times the Rec. 709 luma of the pixel over black, in 8-bit steps.
        let s = 2126u * premul((w >> 16u) & 0xffu, a) + 7152u * premul((w >> 8u) & 0xffu, a)
            + 722u * premul(w & 0xffu, a);
        // Below 153,000: the blank guard's f64 rule puts the sum 153,000 itself above 0.06.
        dark += select(0u, 1u, s < 153000u);
        atomicAdd(&bins[(s + 5000u) / 10000u], 1u);
        let v = other[i];
        for (var k = 0u; k < 32u; k += 8u) {
            let x = (w >> k) & 0xffu;
            let y = (v >> k) & 0xffu;
            diff += max(x, y) - min(x, y);
        }
    }
    atomicAdd(&dark_part, dark);
    atomicAdd(&diff_part, diff);
    workgroupBarrier();
    let n = atomicLoad(&bins[li]);
    if n != 0u {
        atomicAdd(&sums[4u + li], n);
    }
    if li == 0u {
        atomicAdd(&sums[0], atomicLoad(&dark_part));
        let d = atomicLoad(&diff_part);
        let low = atomicAdd(&sums[1], d);
        if low + d < low && !carry_dropped {
            atomicAdd(&sums[2], 1u);
        }
    }
}

struct Texels {
    // Texels in the texture.
    count: u32,
    // Texels in a row.
    width: u32,
    // Words in a padded row of the copy.
    stride: u32,
    // Words per texel.
    words: u32,
    // 1 when each word holds two f16 components.
    halves: u32,
    threads: u32,
    pad0: u32,
    pad1: u32,
}

@group(0) @binding(0) var<uniform> tx: Texels;
@group(0) @binding(1) var<storage, read> texels: array<u32>;
// The non-finite texels, then the complement of the lowest such texel's index (0: none).
@group(0) @binding(2) var<storage, read_write> found: array<atomic<u32>, 2>;

var<workgroup> found_part: atomic<u32>;
var<workgroup> first_part: atomic<u32>;

// Whether every float in a word is finite: an exponent of all ones is an infinity or a NaN.
fn finite_word(x: u32) -> bool {
    if tx.halves != 0u {
        return (x & 0x7c00u) != 0x7c00u && (x & 0x7c000000u) != 0x7c000000u;
    }
    return (x & 0x7f800000u) != 0x7f800000u;
}

@compute @workgroup_size(256)
fn nonfinite(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_index) li: u32,
) {
    var n = 0u;
    var first = 0u;
    for (var i = gid.x; i < tx.count; i += tx.threads) {
        let at = (i / tx.width) * tx.stride + (i % tx.width) * tx.words;
        var ok = true;
        for (var k = 0u; k < tx.words; k++) {
            ok = ok && finite_word(texels[at + k]);
        }
        if !ok {
            n += 1u;
            first = max(first, ~i);
        }
    }
    atomicAdd(&found_part, n);
    atomicMax(&first_part, first);
    workgroupBarrier();
    if li == 0u {
        atomicAdd(&found[0], atomicLoad(&found_part));
        atomicMax(&found[1], atomicLoad(&first_part));
    }
}

struct Derive {
    // Groups of four pixels in the frame.
    quads: u32,
    threads: u32,
    // The words where this reference's luma and alpha planes start.
    luma: u32,
    alpha: u32,
    // 1 when the colour is premultiplied before its luma.
    premultiplied: u32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
}

@group(0) @binding(0) var<uniform> dv: Derive;
@group(0) @binding(1) var<storage, read> raw: array<u32>;
@group(0) @binding(2) var<storage, read_write> planes: array<u32>;

// NV12's Y of an 8-bit colour.
fn luma(c: vec3<u32>) -> u32 {
    return 16u + ((47u * c.x + 157u * c.y + 16u * c.z + 128u) >> 8u);
}

@compute @workgroup_size(256)
fn derive(@builtin(global_invocation_id) gid: vec3<u32>) {
    for (var q = gid.x; q < dv.quads; q += dv.threads) {
        var y = 0u;
        var a = 0u;
        for (var k = 0u; k < 4u; k++) {
            let w = raw[q * 4u + k];
            let al = w >> 24u;
            var c = vec3<u32>((w >> 16u) & 0xffu, (w >> 8u) & 0xffu, w & 0xffu);
            if dv.premultiplied != 0u {
                c = (c * al + 127u) / 255u;
            }
            y |= luma(c) << (8u * k);
            a |= al << (8u * k);
        }
        planes[dv.luma + q] = y;
        planes[dv.alpha + q] = a;
    }
}

struct Blocks {
    width: u32,
    height: u32,
    // 8x8 blocks in a row, the last one narrower when the width isn't a multiple of 8.
    across: u32,
    // Blocks in the plane.
    count: u32,
    // References compared, at most three.
    refs: u32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
    // Each compared reference plane's first word.
    bases: vec4<u32>,
}

@group(0) @binding(0) var<uniform> bk: Blocks;
@group(0) @binding(1) var<storage, read> decoded: array<u32>;
@group(0) @binding(2) var<storage, read> kept: array<u32>;
// Per reference: the SSE's low and high words, then the fixed-point SSIM sum's.
@group(0) @binding(3) var<storage, read_write> scores: array<atomic<u32>, 12>;

// A workgroup takes 32 blocks, an invocation one row of one: per block and reference, the sums
// of p, q, p^2, q^2, pq and (p - q)^2, exact (at most 64 * 255 * 255).
var<workgroup> block_sums: array<atomic<u32>, 576>;
var<workgroup> sse_part: array<atomic<u32>, 3>;
var<workgroup> ssim_part: array<atomic<u32>, 3>;

const C1 = 6.5025;
const C2 = 58.5225;
// A block's SSIM s adds round((s + 1) * 2^20).
const ONE = 1048576.0;

@compute @workgroup_size(256)
fn compare(
    @builtin(workgroup_id) wid: vec3<u32>,
    @builtin(local_invocation_index) li: u32,
) {
    let local = li / 8u;
    let b = wid.x * 32u + local;
    let x0 = (b % bk.across) * 8u;
    let y0 = (b / bk.across) * 8u;
    let x1 = min(x0 + 8u, bk.width);
    let y = y0 + li % 8u;
    if b < bk.count && y < bk.height {
        for (var r = 0u; r < bk.refs; r++) {
            var s = array<u32, 6>();
            for (var x = x0; x < x1; x++) {
                let i = y * bk.width + x;
                let p = byte_of(decoded[i >> 2u], i);
                let q = byte_of(kept[bk.bases[r] + (i >> 2u)], i);
                let d = max(p, q) - min(p, q);
                s[0] += p;
                s[1] += q;
                s[2] += p * p;
                s[3] += q * q;
                s[4] += p * q;
                s[5] += d * d;
            }
            let at = (local * 3u + r) * 6u;
            for (var k = 0u; k < 6u; k++) {
                atomicAdd(&block_sums[at + k], s[k]);
            }
        }
    }
    workgroupBarrier();
    if li % 8u == 0u && b < bk.count {
        let n = (x1 - x0) * (min(y0 + 8u, bk.height) - y0);
        let nf = f32(n);
        let n2 = nf * nf;
        for (var r = 0u; r < bk.refs; r++) {
            let at = (local * 3u + r) * 6u;
            let sx = atomicLoad(&block_sums[at]);
            let sy = atomicLoad(&block_sums[at + 1u]);
            let sxx = atomicLoad(&block_sums[at + 2u]);
            let syy = atomicLoad(&block_sums[at + 3u]);
            let sxy = atomicLoad(&block_sums[at + 4u]);
            atomicAdd(&sse_part[r], atomicLoad(&block_sums[at + 5u]));
            // n^2 times the variances and covariance, exact, then f32.
            let mx = f32(sx) / nf;
            let my = f32(sy) / nf;
            let vx = f32(n * sxx - sx * sx) / n2;
            let vy = f32(n * syy - sy * sy) / n2;
            let cxy = f32(i32(n * sxy) - i32(sx * sy)) / n2;
            let s = ((2.0 * mx * my + C1) * (2.0 * cxy + C2))
                / ((mx * mx + my * my + C1) * (vx + vy + C2));
            atomicAdd(&ssim_part[r], u32(round((clamp(s, -1.0, 1.0) + 1.0) * ONE)));
        }
    }
    workgroupBarrier();
    if li == 0u {
        for (var r = 0u; r < bk.refs; r++) {
            let e = atomicLoad(&sse_part[r]);
            let low = atomicAdd(&scores[4u * r], e);
            if low + e < low {
                atomicAdd(&scores[4u * r + 1u], 1u);
            }
            let s = atomicLoad(&ssim_part[r]);
            let low_s = atomicAdd(&scores[4u * r + 2u], s);
            if low_s + s < low_s {
                atomicAdd(&scores[4u * r + 3u], 1u);
            }
        }
    }
}
