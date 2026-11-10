// The determinism check's pixel hash (issue #1897): a frame's texture, copied into a buffer with
// its rows padded, reduced to 128 bits on the GPU, integers only. Each of four lanes hashes a
// pixel's words with its index by hash@1's PCG permutation and adds it into the lane's sum, so
// the result is the same in any order and on every GPU, and it moves when a pixel changes or two
// unequal pixels swap.

// The planted wrong program: each pixel hashed without its index, the lanes XORed.
override without_position: bool = false;

struct Params {
    // Pixels in the frame.
    count: u32,
    // Words per pixel: 1 for rgba8, 2 for rgba16float.
    words: u32,
    // Invocations dispatched, the stride of each one's walk.
    threads: u32,
    // Pixels in a row.
    width: u32,
    // Words in a padded row of the copy.
    stride: u32,
    pad0: u32,
    pad1: u32,
    pad2: u32,
    // Each lane's seed, from the frame's size and format.
    seeds: vec4<u32>,
}

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var<storage, read> src: array<u32>;
@group(0) @binding(2) var<storage, read_write> sums: array<atomic<u32>, 4>;

var<workgroup> part: array<atomic<u32>, 4>;

fn hash1(x: u32) -> u32 {
    let s = x * 747796405u + 2891336453u;
    let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
    return (w >> 22u) ^ w;
}

fn lane(seed: u32, i: u32) -> u32 {
    let at = (i / p.width) * p.stride + (i % p.width) * p.words;
    var h = select(hash1(seed ^ i), seed, without_position);
    for (var k = 0u; k < p.words; k++) {
        h = hash1(h ^ src[at + k]);
    }
    return h;
}

@compute @workgroup_size(256)
fn main(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_index) li: u32,
) {
    var acc = vec4<u32>(0u);
    for (var i = gid.x; i < p.count; i += p.threads) {
        for (var l = 0u; l < 4u; l++) {
            let h = lane(p.seeds[l], i);
            acc[l] = select(acc[l] + h, acc[l] ^ h, without_position);
        }
    }
    for (var l = 0u; l < 4u; l++) {
        if without_position {
            atomicXor(&part[l], acc[l]);
        } else {
            atomicAdd(&part[l], acc[l]);
        }
    }
    workgroupBarrier();
    if li == 0u {
        for (var l = 0u; l < 4u; l++) {
            let v = atomicLoad(&part[l]);
            if without_position {
                atomicXor(&sums[l], v);
            } else {
                atomicAdd(&sums[l], v);
            }
        }
    }
}
