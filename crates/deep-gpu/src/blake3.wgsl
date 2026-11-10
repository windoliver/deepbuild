// BLAKE3 of a frame (issue #501). One BGRA8 pixel, read as a little-endian u32, is one message
// word; a block is 16 words and a chunk 16 blocks. `chunk` hashes each chunk of the frame to its
// 8-word chaining value; `parent`, dispatched once per tree level, joins the nodes in pairs and
// carries an odd last node up unchanged. The last compression of the frame carries ROOT, and its
// 8 words are the digest.

// The planted wrong program: a parent compresses (right, left).
override joins_right_left: bool = false;

// `chunk`: the frame's words. `parent`: the nodes of the level it reads.
@group(0) @binding(0) var<uniform> count: u32;
@group(0) @binding(1) var<storage, read> src: array<u32>;
@group(0) @binding(2) var<storage, read_write> dst: array<u32>;

const IV = array<u32, 8>(
    0x6A09E667u, 0xBB67AE85u, 0x3C6EF372u, 0xA54FF53Au,
    0x510E527Fu, 0x9B05688Cu, 0x1F83D9ABu, 0x5BE0CD19u,
);
const CHUNK_START = 1u;
const CHUNK_END = 2u;
const PARENT = 4u;
const ROOT = 8u;
const CHUNK_WORDS = 256u;

// The compression's state and its message block.
var<private> v: array<u32, 16>;
var<private> m: array<u32, 16>;

fn rotr(x: u32, n: u32) -> u32 {
    return (x >> n) | (x << (32u - n));
}

fn g(a: u32, b: u32, c: u32, d: u32, x: u32, y: u32) {
    v[a] = v[a] + v[b] + x;
    v[d] = rotr(v[d] ^ v[a], 16u);
    v[c] = v[c] + v[d];
    v[b] = rotr(v[b] ^ v[c], 12u);
    v[a] = v[a] + v[b] + y;
    v[d] = rotr(v[d] ^ v[a], 8u);
    v[c] = v[c] + v[d];
    v[b] = rotr(v[b] ^ v[c], 7u);
}

// Compresses the block in `m` (which it permutes) under `cv`: the new chaining value.
fn compress(cv: array<u32, 8>, counter: u32, block_len: u32, flags: u32) -> array<u32, 8> {
    v = array<u32, 16>(
        cv[0], cv[1], cv[2], cv[3], cv[4], cv[5], cv[6], cv[7],
        IV[0], IV[1], IV[2], IV[3], counter, 0u, block_len, flags,
    );
    for (var round = 0u; round < 7u; round++) {
        g(0u, 4u, 8u, 12u, m[0], m[1]);
        g(1u, 5u, 9u, 13u, m[2], m[3]);
        g(2u, 6u, 10u, 14u, m[4], m[5]);
        g(3u, 7u, 11u, 15u, m[6], m[7]);
        g(0u, 5u, 10u, 15u, m[8], m[9]);
        g(1u, 6u, 11u, 12u, m[10], m[11]);
        g(2u, 7u, 8u, 13u, m[12], m[13]);
        g(3u, 4u, 9u, 14u, m[14], m[15]);
        m = array<u32, 16>(
            m[2], m[6], m[3], m[10], m[7], m[0], m[4], m[13],
            m[1], m[11], m[12], m[5], m[9], m[14], m[15], m[8],
        );
    }
    return array<u32, 8>(
        v[0] ^ v[8], v[1] ^ v[9], v[2] ^ v[10], v[3] ^ v[11],
        v[4] ^ v[12], v[5] ^ v[13], v[6] ^ v[14], v[7] ^ v[15],
    );
}

// One invocation per chunk: its chaining value into `dst`.
@compute @workgroup_size(64)
fn chunk(@builtin(global_invocation_id) id: vec3<u32>) {
    let chunks = (count + CHUNK_WORDS - 1u) / CHUNK_WORDS;
    if id.x >= chunks {
        return;
    }
    let first = id.x * CHUNK_WORDS;
    let words = min(count - first, CHUNK_WORDS);
    let blocks = (words + 15u) / 16u;
    var cv = IV;
    for (var b = 0u; b < blocks; b++) {
        // The last block carries its real length and zero padding.
        let len = min(words - b * 16u, 16u);
        for (var k = 0u; k < 16u; k++) {
            if k < len {
                m[k] = src[first + b * 16u + k];
            } else {
                m[k] = 0u;
            }
        }
        var flags = 0u;
        if b == 0u {
            flags |= CHUNK_START;
        }
        if b == blocks - 1u {
            flags |= CHUNK_END;
            if chunks == 1u {
                flags |= ROOT;
            }
        }
        cv = compress(cv, id.x, len * 4u, flags);
    }
    for (var k = 0u; k < 8u; k++) {
        dst[id.x * 8u + k] = cv[k];
    }
}

// One invocation per node of the level above `src`'s: a pair's parent, or the odd last node.
@compute @workgroup_size(64)
fn parent(@builtin(global_invocation_id) id: vec3<u32>) {
    if id.x >= (count + 1u) / 2u {
        return;
    }
    let left = id.x * 16u;
    if id.x * 2u + 1u == count {
        for (var k = 0u; k < 8u; k++) {
            dst[id.x * 8u + k] = src[left + k];
        }
        return;
    }
    let swap = select(0u, 8u, joins_right_left);
    for (var k = 0u; k < 8u; k++) {
        m[k] = src[left + swap + k];
        m[k + 8u] = src[left + 8u - swap + k];
    }
    var flags = PARENT;
    if count == 2u {
        flags |= ROOT;
    }
    let cv = compress(IV, 0u, 64u, flags);
    for (var k = 0u; k < 8u; k++) {
        dst[id.x * 8u + k] = cv[k];
    }
}
