// The shipped multi-dispatch steps (issue #483; canvas primitives: Step and the closed step list:
// structural steps), reviewed with the app: an exclusive scan(add), a compaction in index order
// and a stable LSD radix sort by a u32 key. Every result depends only on the inputs: integer adds
// wrap and are associative, each element's place comes from prefix sums over index order, and no
// result reads an atomic's returned value (the histogram's workgroup counters are read only after
// a barrier, when every add has landed). Each entry point is its own pipeline; a tile is 1,024
// elements, 4 per invocation in index order.

struct Params {
    // Elements this dispatch covers.
    n: u32,
    // The radix pass's bit offset (sort), or 1 to read each input as a flag (scan).
    arg: u32,
    // Tiles in the sort's pass (the histogram's row length).
    tiles: u32,
    _pad: u32,
}

@group(0) @binding(0) var<uniform> p: Params;

const WG: u32 = 256u;
const PER: u32 = 4u;
const TILE: u32 = 1024u;
// The sort's tile: 8 elements an invocation.
const SPER: u32 = 8u;
const STILE: u32 = 2048u;

// ---- scan: a tile's exclusive prefix sum, its total into `sums` ----

@group(0) @binding(1) var<storage, read> scan_src: array<u32>;
@group(0) @binding(2) var<storage, read_write> scan_dst: array<u32>;
@group(0) @binding(3) var<storage, read_write> scan_sums: array<u32>;

var<workgroup> sh: array<u32, 256>;

@compute @workgroup_size(256)
fn scan_tile(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3<u32>) {
    let base = wg.x * TILE + t * PER;
    var own: array<u32, 4>;
    var sum = 0u;
    for (var j = 0u; j < PER; j++) {
        let i = base + j;
        var x = 0u;
        if (i < p.n) {
            x = scan_src[i];
            if (p.arg == 1u) {
                x = select(0u, 1u, x != 0u);
            }
        }
        own[j] = sum;
        sum += x;
    }
    sh[t] = sum;
    workgroupBarrier();
    for (var off = 1u; off < WG; off <<= 1u) {
        var add = 0u;
        if (t >= off) {
            add = sh[t - off];
        }
        workgroupBarrier();
        sh[t] += add;
        workgroupBarrier();
    }
    let before = sh[t] - sum;
    for (var j = 0u; j < PER; j++) {
        let i = base + j;
        if (i < p.n) {
            scan_dst[i] = before + own[j];
        }
    }
    if (t == WG - 1u) {
        scan_sums[wg.x] = sh[t];
    }
}

// ---- scan: each tile's prefix, from the scanned totals, added in ----

@group(0) @binding(1) var<storage, read> add_sums: array<u32>;
@group(0) @binding(2) var<storage, read_write> add_dst: array<u32>;

@compute @workgroup_size(256)
fn scan_add(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3<u32>) {
    let k = add_sums[wg.x];
    let base = wg.x * TILE + t * PER;
    for (var j = 0u; j < PER; j++) {
        let i = base + j;
        if (i < p.n) {
            add_dst[i] += k;
        }
    }
}

// ---- compact: each tile's count of flagged elements ----
//
// A compaction's tile is 2,048 elements, 8 per invocation. The tiles' counts are scanned by the
// scan above, and the scatter below rescans its tile's flags, so each element's place is used where
// it's computed.

const CPER: u32 = 8u;
const CTILE: u32 = 2048u;

@group(0) @binding(1) var<storage, read> cnt_flag: array<u32>;
@group(0) @binding(2) var<storage, read_write> cnt_sums: array<u32>;

var<workgroup> cmp_sh: array<u32, 256>;
var<workgroup> cmp_group: array<u32, 16>;

@compute @workgroup_size(256)
fn compact_count(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3<u32>) {
    var c = 0u;
    for (var j = 0u; j < CPER; j++) {
        let i = wg.x * CTILE + j * WG + t;
        if (i < p.n) {
            c += select(0u, 1u, cnt_flag[i] != 0u);
        }
    }
    cmp_sh[t] = c;
    workgroupBarrier();
    if (t < 16u) {
        var s = 0u;
        for (var k = 0u; k < 16u; k++) {
            s += cmp_sh[t * 16u + k];
        }
        cmp_group[t] = s;
    }
    workgroupBarrier();
    if (t == 0u) {
        var s = 0u;
        for (var k = 0u; k < 16u; k++) {
            s += cmp_group[k];
        }
        cnt_sums[wg.x] = s;
    }
}

// ---- compact: each flagged element to its place, the tile's start plus its flags' scan ----

@group(0) @binding(1) var<storage, read> cmp_src: array<u32>;
@group(0) @binding(2) var<storage, read> cmp_flag: array<u32>;
@group(0) @binding(3) var<storage, read> cmp_start: array<u32>;
@group(0) @binding(4) var<storage, read_write> cmp_out: array<u32>;
@group(0) @binding(5) var<storage, read_write> cmp_count: array<u32>;

@compute @workgroup_size(256)
fn compact_scatter(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3<u32>) {
    // Invocation t's 8 consecutive elements; bit j of `keep` is element j's flag.
    let base = wg.x * CTILE + t * CPER;
    var keep = 0u;
    var c = 0u;
    for (var j = 0u; j < CPER; j++) {
        let i = base + j;
        if (i < p.n) {
            if (cmp_flag[i] != 0u) {
                keep |= 1u << j;
                c += 1u;
            }
        }
    }
    cmp_sh[t] = c;
    workgroupBarrier();
    if (t < 16u) {
        var s = 0u;
        for (var k = 0u; k < 16u; k++) {
            s += cmp_sh[t * 16u + k];
        }
        cmp_group[t] = s;
    }
    workgroupBarrier();
    let g = t >> 4u;
    var at = cmp_start[wg.x];
    for (var k = 0u; k < 16u; k++) {
        at += select(0u, cmp_group[k], k < g);
        at += select(0u, cmp_sh[g * 16u + k], g * 16u + k < t);
    }
    for (var j = 0u; j < CPER; j++) {
        let i = base + j;
        if ((keep & (1u << j)) != 0u) {
            cmp_out[at] = cmp_src[i];
            at += 1u;
        }
        if (i == p.n - 1u) {
            cmp_count[0] = at;
        }
    }
}

// ---- sort: one radix pass's digit counts per tile, as each digit's start in the tile ----
//
// A pass sorts by an 8-bit digit. A tile's keys are counted in coalesced order (the count doesn't
// depend on order) into 4 copies of the tile's 256 counters, 16-bit halves of a word (a tile's
// count never passes 2,048), each invocation adding to the copy its index picks: the adds are
// sums, so the counts read after the barrier are the same whatever order the adds landed in. The
// tile's exclusive scan of its counts (each digit's start in the tile) goes to `hist_start`,
// digit-major, and the starts of the digit's two 4-bit halves, low then high, to `hist_nib`.

@group(0) @binding(1) var<storage, read> hist_keys: array<u32>;
@group(0) @binding(2) var<storage, read_write> hist_start: array<u32>;
@group(0) @binding(3) var<storage, read_write> hist_nib: array<u32>;

var<workgroup> hist_copies: array<atomic<u32>, 512>;
var<workgroup> hist_count: array<u32, 256>;
var<workgroup> hist_group: array<u32, 32>;

@compute @workgroup_size(256)
fn sort_hist(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3<u32>) {
    atomicStore(&hist_copies[t], 0u);
    atomicStore(&hist_copies[WG + t], 0u);
    workgroupBarrier();
    // Copy c of the counter word w (digits 2w and 2w + 1) is word w * 4 + c.
    let c = t & 3u;
    for (var j = 0u; j < SPER; j++) {
        let i = wg.x * STILE + j * WG + t;
        if (i < p.n) {
            let d = (hist_keys[i] >> p.arg) & 255u;
            atomicAdd(&hist_copies[(d >> 1u) * 4u + c], 1u << ((d & 1u) * 16u));
        }
    }
    workgroupBarrier();
    // Digit t's count: its word's 4 copies summed, read in a rotated order.
    let w = t >> 1u;
    var sum = 0u;
    for (var k = 0u; k < 4u; k++) {
        sum += atomicLoad(&hist_copies[w * 4u + ((k + w) & 3u)]);
    }
    hist_count[t] = (sum >> ((t & 1u) * 16u)) & 0xffffu;
    workgroupBarrier();
    // Sums of 16 digits in a row (0..15), and of the digits with each low half (16..31).
    if (t < 16u) {
        var s = 0u;
        for (var k = 0u; k < 16u; k++) {
            s += hist_count[t * 16u + k];
        }
        hist_group[t] = s;
    } else if (t < 32u) {
        var s = 0u;
        for (var k = 0u; k < 16u; k++) {
            s += hist_count[k * 16u + t - 16u];
        }
        hist_group[t] = s;
    }
    workgroupBarrier();
    let g = t >> 4u;
    var start = 0u;
    for (var k = 0u; k < 16u; k++) {
        start += select(0u, hist_group[k], k < g);
        start += select(0u, hist_count[g * 16u + k], g * 16u + k < t);
    }
    hist_start[t * p.tiles + wg.x] = start;
    if (t < 16u) {
        var low = 0u;
        for (var k = 0u; k < 16u; k++) {
            low += select(0u, hist_group[16u + k], k < t);
        }
        hist_nib[wg.x * 32u + t] = low;
    }
    if ((t & 15u) == 0u) {
        hist_nib[wg.x * 32u + 16u + g] = start;
    }
}

// ---- sort: one radix pass's offsets ----
//
// A workgroup a digit: over the tiles in order, each digit's count in a tile is the difference of
// its start and the next digit's (the tile's count after the last), and the digit's place in the
// output is the starts of every smaller digit in every tile plus its counts in earlier tiles. Each
// (digit, tile) gets that place less the digit's start in the tile, so a key's output index is
// that plus its index in the tile sorted by digit.

@group(0) @binding(1) var<storage, read> off_start: array<u32>;
@group(0) @binding(2) var<storage, read_write> off_out: array<u32>;

var<workgroup> off_count: array<u32, 256>;
var<workgroup> off_below: array<u32, 256>;
var<workgroup> off_group: array<u32, 32>;

fn sort_tile_count(i: u32, d: u32) -> u32 {
    let a = off_start[d * p.tiles + i];
    var b = min(STILE, p.n - i * STILE);
    if (d < 255u) {
        b = off_start[(d + 1u) * p.tiles + i];
    }
    return b - a;
}

@compute @workgroup_size(256)
fn sort_offsets(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3<u32>) {
    let d = wg.x;
    let per = (p.tiles + WG - 1u) / WG;
    let lo = t * per;
    let hi = min(lo + per, p.tiles);
    var count = 0u;
    var below = 0u;
    for (var i = lo; i < hi; i++) {
        count += sort_tile_count(i, d);
        below += off_start[d * p.tiles + i];
    }
    off_count[t] = count;
    off_below[t] = below;
    workgroupBarrier();
    if (t < 16u) {
        var s = 0u;
        for (var k = 0u; k < 16u; k++) {
            s += off_count[t * 16u + k];
        }
        off_group[t] = s;
    } else if (t < 32u) {
        var s = 0u;
        for (var k = 0u; k < 16u; k++) {
            s += off_below[(t - 16u) * 16u + k];
        }
        off_group[t] = s;
    }
    workgroupBarrier();
    let g = t >> 4u;
    var at = 0u;
    for (var k = 0u; k < 16u; k++) {
        at += off_group[16u + k];
        at += select(0u, off_group[k], k < g);
        at += select(0u, off_count[g * 16u + k], g * 16u + k < t);
    }
    for (var i = lo; i < hi; i++) {
        off_out[d * p.tiles + i] = at - off_start[d * p.tiles + i];
        at += sort_tile_count(i, d);
    }
}

// ---- sort: one radix pass's stable scatter ----
//
// Each invocation holds 8 consecutive keys of the tile. The tile is sorted by the pass's digit in
// shared memory by two stable splits on its 4-bit halves, low then high. A split gives each key its
// place from its half's start in the tile (`hist_nib`), the counts of its half among earlier
// invocations' keys (an exclusive scan of per-invocation counts) and among its own earlier keys.
// The first split moves the keys; the second stages them sorted and records, for each place after
// the first, the place after the second, through which each value is staged from its index. Keys
// and then values are written out coalesced, each to its (digit, tile) offset plus its place. Keys
// past the count sort last as 0xffffffff and aren't written. Every word of workgroup memory is
// written before it's read (the pipeline skips zeroing it).

@group(0) @binding(1) var<storage, read> sc_keys: array<u32>;
@group(0) @binding(2) var<storage, read> sc_vals: array<u32>;
@group(0) @binding(3) var<storage, read> sc_offsets: array<u32>;
@group(0) @binding(4) var<storage, read> sc_nib: array<u32>;
@group(0) @binding(5) var<storage, read_write> sc_keys_out: array<u32>;
@group(0) @binding(6) var<storage, read_write> sc_vals_out: array<u32>;

// 13,440 bytes in all. The tile in shared memory; while a split counts, its counts instead
// (`sort_split`).
var<workgroup> sc_stage: array<u32, 2048>;
// Each digit's offset less its start in the tile.
var<workgroup> sc_offs: array<u32, 256>;
// For each place after the first split, the place after the second: 16 bits, two a word.
var<workgroup> sc_moved: array<u32, 1024>;
// The starts of each low half, then of each high half, in the tile.
var<workgroup> sc_nibs: array<u32, 32>;

// Where a split's counts sit in `sc_stage`. Rows: each invocation's counts of the 16 halves, a
// byte each, four words: word k holds the halves k's bits pick. Scanned in segments of 4
// invocations: each segment's total (bytes), each 8 segments' totals and each segment's exclusive
// prefix (16-bit, two words each).
const ROWS: u32 = 0u;
const SEG: u32 = 1024u;
const GROUP: u32 = 1280u;
const SEGP: u32 = 1344u;

// The places in the tile of an invocation's 8 halves (in index order) after a stable split by
// them; `first` picks the low (0) or high (16) half's starts in `sc_nibs`.
fn sort_split(t: u32, dig: array<u32, 8>, first: u32) -> array<u32, 8> {
    // Counts as nibbles (a count here is at most 8): halves 0..7 in `lo`, 8..15 in `hi`.
    var lo = 0u;
    var hi = 0u;
    var within: array<u32, 8>;
    for (var j = 0u; j < SPER; j++) {
        let d = dig[j];
        let s = (d & 7u) * 4u;
        let up = d >= 8u;
        within[j] = (select(lo, hi, up) >> s) & 15u;
        lo += select(1u << s, 0u, up);
        hi += select(0u, 1u << s, up);
    }
    // Half d's byte: word ((d >> 3) << 1) | (d & 1), byte (d >> 1) & 3.
    sc_stage[ROWS + t] = lo & 0x0f0f0f0fu;
    sc_stage[ROWS + WG + t] = (lo >> 4u) & 0x0f0f0f0fu;
    sc_stage[ROWS + 2u * WG + t] = hi & 0x0f0f0f0fu;
    sc_stage[ROWS + 3u * WG + t] = (hi >> 4u) & 0x0f0f0f0fu;
    workgroupBarrier();
    // Invocation t scans word t >> 6 of segment t & 63 (4 invocations; a byte stays under 33).
    let at = (t >> 6u) * WG + (t & 63u) * 4u;
    let r0 = sc_stage[ROWS + at];
    let r1 = sc_stage[ROWS + at + 1u];
    let r2 = sc_stage[ROWS + at + 2u];
    let r3 = sc_stage[ROWS + at + 3u];
    sc_stage[ROWS + at] = 0u;
    sc_stage[ROWS + at + 1u] = r0;
    sc_stage[ROWS + at + 2u] = r0 + r1;
    sc_stage[ROWS + at + 3u] = r0 + r1 + r2;
    sc_stage[SEG + t] = r0 + r1 + r2 + r3;
    workgroupBarrier();
    // Sums of 8 segments in a row, in 16-bit fields (even bytes, odd bytes).
    if (t < 32u) {
        var even = 0u;
        var odd = 0u;
        for (var i = 0u; i < 8u; i++) {
            let v = sc_stage[SEG + t * 8u + i];
            even += v & 0x00ff00ffu;
            odd += (v >> 8u) & 0x00ff00ffu;
        }
        sc_stage[GROUP + 2u * t] = even;
        sc_stage[GROUP + 2u * t + 1u] = odd;
    }
    workgroupBarrier();
    // And the word's earlier segments: whole groups of 8, then the segments before it in its own.
    let s = t & 63u;
    let word = (t >> 6u) * 8u;
    let g0 = t >> 3u;
    var even = 0u;
    var odd = 0u;
    for (var i = 0u; i < 7u; i++) {
        let take = i < (s >> 3u);
        even += select(0u, sc_stage[GROUP + 2u * (word + i)], take);
        odd += select(0u, sc_stage[GROUP + 2u * (word + i) + 1u], take);
        let v = select(0u, sc_stage[SEG + (g0 << 3u) + i], i < (s & 7u));
        even += v & 0x00ff00ffu;
        odd += (v >> 8u) & 0x00ff00ffu;
    }
    sc_stage[SEGP + 2u * t] = even;
    sc_stage[SEGP + 2u * t + 1u] = odd;
    workgroupBarrier();
    var place: array<u32, 8>;
    for (var j = 0u; j < SPER; j++) {
        let d = dig[j];
        let k = ((d >> 3u) << 1u) | (d & 1u);
        let b = (d >> 1u) & 3u;
        let own = (sc_stage[ROWS + k * WG + t] >> (8u * b)) & 0xffu;
        let seg = (sc_stage[SEGP + 2u * (k * 64u + (t >> 2u)) + (b & 1u)] >> (16u * (b >> 1u))) & 0xffffu;
        place[j] = sc_nibs[first + d] + seg + own + within[j];
    }
    // Every count read before the tile is written over them.
    workgroupBarrier();
    return place;
}

@compute @workgroup_size(256)
fn sort_scatter(@builtin(local_invocation_index) t: u32, @builtin(workgroup_id) wg: vec3<u32>) {
    let base = wg.x * STILE;
    let valid = min(STILE, p.n - base);
    if (t < 32u) {
        sc_nibs[t] = sc_nib[wg.x * 32u + t];
    }
    let offset = sc_offsets[t * p.tiles + wg.x];
    var key: array<u32, 8>;
    var dig: array<u32, 8>;
    for (var j = 0u; j < SPER; j++) {
        let l = t * SPER + j;
        key[j] = 0xffffffffu;
        if (l < valid) {
            key[j] = sc_keys[base + l];
        }
        dig[j] = (key[j] >> p.arg) & 15u;
    }
    let first = sort_split(t, dig, 0u);
    for (var j = 0u; j < SPER; j++) {
        sc_stage[first[j]] = key[j];
    }
    workgroupBarrier();
    for (var j = 0u; j < SPER; j++) {
        key[j] = sc_stage[t * SPER + j];
        dig[j] = (key[j] >> (p.arg + 4u)) & 15u;
    }
    // Every key read before the counts are written over them.
    workgroupBarrier();
    let second = sort_split(t, dig, 16u);
    // The keys sorted, and each place after the first split's place after the second, two a word.
    for (var j = 0u; j < SPER; j++) {
        sc_stage[second[j]] = key[j];
    }
    for (var i = 0u; i < 4u; i++) {
        sc_moved[t * 4u + i] = second[2u * i] | (second[2u * i + 1u] << 16u);
    }
    sc_offs[t] = offset;
    workgroupBarrier();
    var dst: array<u32, 8>;
    for (var j = 0u; j < SPER; j++) {
        let q = j * WG + t;
        let k = sc_stage[q];
        dst[j] = sc_offs[(k >> p.arg) & 255u] + q;
        if (q < valid) {
            sc_keys_out[dst[j]] = k;
        }
    }
    workgroupBarrier();
    for (var j = 0u; j < SPER; j++) {
        let l = t * SPER + j;
        if (l < valid) {
            let place = (sc_moved[first[j] >> 1u] >> ((first[j] & 1u) * 16u)) & 0xffffu;
            sc_stage[place] = sc_vals[base + l];
        }
    }
    workgroupBarrier();
    for (var j = 0u; j < SPER; j++) {
        let q = j * WG + t;
        if (q < valid) {
            sc_vals_out[dst[j]] = sc_stage[q];
        }
    }
}

// ---- an indirect dispatch's arguments (#484): the workgroups its count needs, capped at `max` ----
//
// `n` holds the workgroup's invocations and `arg` the dispatch's max, so the count never reaches
// the CPU.

@group(0) @binding(1) var<storage, read> args_count: array<u32>;
@group(0) @binding(2) var<storage, read_write> args_out: array<u32>;

@compute @workgroup_size(1)
fn dispatch_args() {
    let count = min(args_count[0], p.arg);
    args_out[0] = count / p.n + select(0u, 1u, count % p.n != 0u);
    args_out[1] = 1u;
    args_out[2] = 1u;
}
