// The export's 4:2:0 conversion (issue #518), integers only so every GPU gives the same planes: a
// frame's BGRA8 words, the ones blake3 hashes, become NV12's Y plane and its interleaved CbCr
// plane by the fixed-point BT.709 limited-range formula of frame_checks' `nv12`, never through a
// float. Both planes are rows of `stride` words, the Y rows first; a row's bytes past the width
// are zero.

// The planted wrong program: a block's chroma rounded down, not to nearest.
override chroma_rounds_down: bool = false;

struct Layout {
    // Pixels in a row and rows in the frame, both even.
    width: u32,
    height: u32,
    // Words in a row of either plane.
    stride: u32,
    pad0: u32,
}

@group(0) @binding(0) var<uniform> lay: Layout;
@group(0) @binding(1) var<storage, read> frame: array<u32>;
@group(0) @binding(2) var<storage, read_write> planes: array<u32>;

// One invocation writes one word of a Y row: four pixels' Y = 16 + ((47R + 157G + 16B + 128) >> 8).
@compute @workgroup_size(256)
fn luma(@builtin(global_invocation_id) gid: vec3<u32>) {
    if gid.x >= lay.stride {
        return;
    }
    var out = 0u;
    for (var k = 0u; k < 4u; k++) {
        let x = gid.x * 4u + k;
        if x < lay.width {
            let w = frame[gid.y * lay.width + x];
            let y = 16u + ((47u * ((w >> 16u) & 0xffu) + 157u * ((w >> 8u) & 0xffu)
                + 16u * (w & 0xffu) + 128u) >> 8u);
            out |= y << (8u * k);
        }
    }
    planes[gid.y * lay.stride + gid.x] = out;
}

// One invocation writes one word of a CbCr row: two 2x2 blocks, each from the sums SR, SG, SB of
// its four pixels, Cb = 128 + ((-26SR - 86SG + 112SB + 512) >> 10) and Cr = 128 + ((112SR - 102SG
// - 10SB + 512) >> 10), the shift a floor.
@compute @workgroup_size(256)
fn chroma(@builtin(global_invocation_id) gid: vec3<u32>) {
    if gid.x >= lay.stride {
        return;
    }
    let half = select(512, 0, chroma_rounds_down);
    var out = 0u;
    for (var k = 0u; k < 2u; k++) {
        let x = (gid.x * 2u + k) * 2u;
        if x < lay.width {
            let top = gid.y * 2u * lay.width + x;
            var sr = 0;
            var sg = 0;
            var sb = 0;
            for (var i = 0u; i < 4u; i++) {
                let w = frame[top + (i & 1u) + (i >> 1u) * lay.width];
                sr += i32((w >> 16u) & 0xffu);
                sg += i32((w >> 8u) & 0xffu);
                sb += i32(w & 0xffu);
            }
            let cb = u32(128 + ((-26 * sr - 86 * sg + 112 * sb + half) >> 10u));
            let cr = u32(128 + ((112 * sr - 102 * sg - 10 * sb + half) >> 10u));
            out |= (cb | (cr << 8u)) << (16u * k);
        }
    }
    planes[(lay.height + gid.y) * lay.stride + gid.x] = out;
}
