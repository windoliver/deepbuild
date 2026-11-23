// #269: a grid image rebuilt on the GPU, the same sums in the same f32 order as the CPU's rebuild
// (deep-canvas-marks `grid_image::pixel`), so the two agree within one 8-bit level. The grid is a
// byte a cell, four to a word, each row `stride` words. `scatter` first writes the rows a frame
// uploads from the staged ones; `main` then rebuilds the image from the grid. Each pixel's
// centre is read in cells; `nearest` takes its cell's class; `smooth` rebuilds each class's share
// by the Catmull-Rom cubic over the 4 × 4 cells around it, takes the largest (ties to the lower
// class) and blends toward the runner-up over `edge` px. Class 16 is a value past the roles: it
// draws nothing in its cell.

struct U {
    cols: u32,
    rows: u32,
    width: u32,
    height: u32,
    px: vec2<f32>,
    edge: f32,
    // 0 nearest, 1 smooth.
    sample: u32,
    // The planted path that takes the pixel's cell's role before rebuilding: 1.
    planted: u32,
    // Words a row of the grid takes.
    stride: u32,
    // Rows staged this frame.
    staged: u32,
    pad: u32,
    colors: array<vec4<f32>, 17>,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read_write> cells: array<u32>;
@group(0) @binding(2) var out: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<storage, read> staged: array<u32>;
@group(0) @binding(4) var<storage, read> rows: array<u32>;

const OUT: u32 = 16u;

fn class_at(x: i32, y: i32) -> u32 {
    let cx = u32(clamp(x, 0, i32(u.cols) - 1));
    let cy = u32(clamp(y, 0, i32(u.rows) - 1));
    return (cells[cy * u.stride + cx / 4u] >> (8u * (cx % 4u))) & 0xffu;
}

// One word of a staged row into its row of the grid: x a word, y a staged row.
@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= u.stride || id.y >= u.staged) {
        return;
    }
    cells[rows[id.y] * u.stride + id.x] = staged[id.y * u.stride + id.x];
}

fn weights(t: f32) -> vec4<f32> {
    let t2 = t * t;
    let t3 = t * t * t;
    return vec4<f32>(
        -0.5 * t3 + t2 - 0.5 * t,
        1.5 * t3 - 2.5 * t2 + 1.0,
        -1.5 * t3 + 2.0 * t2 + 0.5 * t,
        0.5 * t3 - 0.5 * t2,
    );
}

fn slopes(t: f32) -> vec4<f32> {
    let t2 = t * t;
    return vec4<f32>(
        -1.5 * t2 + 2.0 * t - 0.5,
        4.5 * t2 - 5.0 * t,
        -4.5 * t2 + 4.0 * t + 0.5,
        1.5 * t2 - t,
    );
}

fn smooth_at(uu: f32, vv: f32) -> vec4<f32> {
    let fx = uu - 0.5;
    let fy = vv - 0.5;
    let ix = floor(fx);
    let iy = floor(fy);
    let wx = weights(fx - ix);
    let wy = weights(fy - iy);
    let dx = slopes(fx - ix);
    let dy = slopes(fy - iy);
    if (u.planted == 1u) {
        // The planted path: the pixel's own cell's role first, then that role's share alone,
        // antialiased against nothing.
        let own = class_at(i32(floor(uu)), i32(floor(vv)));
        var s = 0.0;
        var sx = 0.0;
        var sy = 0.0;
        for (var b = 0; b < 4; b++) {
            for (var a = 0; a < 4; a++) {
                if (class_at(i32(ix) + a - 1, i32(iy) + b - 1) == own) {
                    s += wx[a] * wy[b];
                    sx += dx[a] * wy[b];
                    sy += wx[a] * dy[b];
                }
            }
        }
        let gxx = 2.0 * sx / u.px.x;
        let gyy = 2.0 * sy / u.px.y;
        let slope = sqrt(gxx * gxx + gyy * gyy);
        var cover = 1.0;
        if (slope > 1e-6 && u.edge > 0.0) {
            cover = clamp(0.5 + (2.0 * s - 1.0) / slope / u.edge, 0.0, 1.0);
        }
        return u.colors[own] * cover;
    }
    var share: array<f32, 17>;
    var gx: array<f32, 17>;
    var gy: array<f32, 17>;
    var present = 0u;
    for (var b = 0; b < 4; b++) {
        for (var a = 0; a < 4; a++) {
            let k = class_at(i32(ix) + a - 1, i32(iy) + b - 1);
            share[k] += wx[a] * wy[b];
            gx[k] += dx[a] * wy[b];
            gy[k] += wx[a] * dy[b];
            present |= 1u << k;
        }
    }
    var first = 99u;
    var second = 99u;
    for (var k = 0u; k <= OUT; k++) {
        if (((present >> k) & 1u) == 0u) {
            continue;
        }
        if (first == 99u || share[k] > share[first]) {
            second = first;
            first = k;
        } else if (second == 99u || share[k] > share[second]) {
            second = k;
        }
    }
    if (second == 99u || u.edge <= 0.0) {
        return u.colors[first];
    }
    let d = share[first] - share[second];
    let sx = (gx[first] - gx[second]) / u.px.x;
    let sy = (gy[first] - gy[second]) / u.px.y;
    let slope = sqrt(sx * sx + sy * sy);
    var k = 1.0;
    if (slope > 1e-6) {
        k = clamp(0.5 + d / slope / u.edge, 0.0, 1.0);
    }
    return u.colors[first] * k + u.colors[second] * (1.0 - k);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= u.width || id.y >= u.height) {
        return;
    }
    let uu = (f32(id.x) + 0.5) / u.px.x;
    let vv = (f32(id.y) + 0.5) / u.px.y;
    let own = class_at(i32(floor(uu)), i32(floor(vv)));
    var c: vec4<f32>;
    if (u.sample == 0u || own == OUT) {
        c = u.colors[own];
    } else {
        c = smooth_at(uu, vv);
    }
    textureStore(out, vec2<i32>(id.xy), c);
}
