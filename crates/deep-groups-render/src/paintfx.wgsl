// #467: paint built from a mark's coverage (canvas primitives: Paint: drop; Paint: shade, kind
// inner; Paint: glow, bevel and satin). Each entry point is one step of deep-canvas-marks' fx.rs,
// the CPU reference, in the same f32 arithmetic, over a crop of the frame held in buffers: `a`,
// `b` and `c` in, `o` out. `cov` reads the coverage from the group's target; `paint` writes the
// part's premultiplied color, rows k.w px apart.

struct U {
    size: vec2<u32>,
    origin: vec2<u32>,
    f: vec4<f32>,
    g: vec4<f32>,
    k: vec4<u32>,
}

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> a: array<f32>;
@group(0) @binding(2) var<storage, read> b: array<f32>;
@group(0) @binding(3) var<storage, read> c: array<f32>;
@group(0) @binding(4) var<storage, read_write> o: array<f32>;
@group(0) @binding(5) var<storage, read_write> rgba: array<vec4<f32>>;
@group(0) @binding(6) var coverage: texture_2d<f32>;

fn at(x: i32, y: i32) -> f32 {
    if (x < 0 || y < 0 || x >= i32(u.size.x) || y >= i32(u.size.y)) {
        return 0.0;
    }
    return a[u32(y) * u.size.x + u32(x)];
}

fn sample(x: f32, y: f32) -> f32 {
    let fx = x - 0.5;
    let fy = y - 0.5;
    let x0 = floor(fx);
    let y0 = floor(fy);
    let tx = fx - x0;
    let ty = fy - y0;
    let ix = i32(x0);
    let iy = i32(y0);
    let top = at(ix, iy) * (1.0 - tx) + at(ix + 1, iy) * tx;
    let bottom = at(ix, iy + 1) * (1.0 - tx) + at(ix + 1, iy + 1) * tx;
    return top * (1.0 - ty) + bottom * ty;
}

fn index(id: vec3<u32>) -> i32 {
    if (id.x >= u.size.x || id.y >= u.size.y) {
        return -1;
    }
    return i32(id.y * u.size.x + id.x);
}

@compute @workgroup_size(8, 8)
fn cov(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = index(id);
    if (i < 0) { return; }
    o[i] = textureLoad(coverage, vec2<i32>(u.origin + id.xy), 0).a;
}

// f.xy: the move in px.
@compute @workgroup_size(8, 8)
fn shift(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = index(id);
    if (i < 0) { return; }
    o[i] = sample(f32(id.x) + 0.5 - u.f.x, f32(id.y) + 0.5 - u.f.y);
}

// f.x: the radius in px; k.x: 1 along x, 0 along y. The 31 weights are exp(-2u²), normalized.
@compute @workgroup_size(8, 8)
fn blur(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = index(id);
    if (i < 0) { return; }
    let cx = f32(id.x) + 0.5;
    let cy = f32(id.y) + 0.5;
    var total = 0.0;
    for (var t = 0; t < 31; t++) {
        let v = (f32(t) - 15.0) / 15.0;
        total += exp(-2.0 * v * v);
    }
    var sum = 0.0;
    for (var t = 0; t < 31; t++) {
        let v = (f32(t) - 15.0) / 15.0;
        let w = exp(-2.0 * v * v) / total;
        let off = u.f.x * (f32(t) - 15.0) / 15.0;
        var s: f32;
        if (u.k.x == 1u) {
            s = sample(cx + off, cy);
        } else {
            s = sample(cx, cy + off);
        }
        sum += s * w;
    }
    o[i] = sum;
}

// f.x: the disc's radius in px.
@compute @workgroup_size(8, 8)
fn dilate(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = index(id);
    if (i < 0) { return; }
    let r = u.f.x;
    let reach = i32(ceil(r));
    var most = 0.0;
    for (var dy = -reach; dy <= reach; dy++) {
        for (var dx = -reach; dx <= reach; dx++) {
            if (f32(dx * dx + dy * dy) <= r * r) {
                most = max(most, at(i32(id.x) + dx, i32(id.y) + dy));
            }
        }
    }
    o[i] = most;
}

// o = a × f.x + f.y
@compute @workgroup_size(8, 8)
fn lin(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = index(id);
    if (i < 0) { return; }
    o[i] = a[i] * u.f.x + u.f.y;
}

// The outside moved away from the light: f.xy toward the light × offset.
@compute @workgroup_size(8, 8)
fn outside_moved(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = index(id);
    if (i < 0) { return; }
    o[i] = 1.0 - sample(f32(id.x) + 0.5 + u.f.x, f32(id.y) + 0.5 + u.f.y);
}

// o = clamp(a × b × f.x)
@compute @workgroup_size(8, 8)
fn mul(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = index(id);
    if (i < 0) { return; }
    o[i] = clamp(a[i] * b[i] * u.f.x, 0.0, 1.0);
}

// A glow from the blurred source `a` and the coverage `b`: k.x 0 outer, 1 inner from the edge,
// 2 inner from the center; f.x its opacity.
@compute @workgroup_size(8, 8)
fn glow(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = index(id);
    if (i < 0) { return; }
    let s = a[i];
    let cv = b[i];
    var v: f32;
    if (u.k.x == 0u) {
        v = s * (1.0 - cv);
    } else if (u.k.x == 1u) {
        v = s * cv;
    } else {
        v = (1.0 - s) * cv;
    }
    o[i] = clamp(v * u.f.x, 0.0, 1.0);
}

// The signed distance to the coverage's edge out to f.x px, positive inside.
@compute @workgroup_size(8, 8)
fn distance(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = index(id);
    if (i < 0) { return; }
    let reach = u.f.x;
    let r = i32(ceil(reach)) + 1;
    let cv = a[i];
    let inside = cv >= 0.5;
    var best = reach + 1.0;
    for (var dy = -r; dy <= r; dy++) {
        for (var dx = -r; dx <= r; dx++) {
            let other = at(i32(id.x) + dx, i32(id.y) + dy);
            if ((other >= 0.5) != inside) {
                best = min(best, sqrt(f32(dx * dx + dy * dy)));
            }
        }
    }
    var edge: f32;
    if (best <= 1.0) {
        edge = abs(cv - 0.5);
    } else {
        edge = best - 0.5;
    }
    let d = min(edge, reach + 1.0);
    if (inside) {
        o[i] = d;
    } else {
        o[i] = -d;
    }
}

fn ramp(v: f32, size: f32) -> f32 {
    return clamp(v / size, 0.0, 1.0);
}

fn shaped(v: f32) -> f32 {
    if (u.k.y == 1u) {
        return v;
    }
    return v * v * (3.0 - 2.0 * v);
}

// A bevel's height from the distance `a`: k.x its shape (0 inner, 1 outer, 2 emboss, 3 pillow),
// k.y 1 for chisel; f.x its size in px.
@compute @workgroup_size(8, 8)
fn height(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = index(id);
    if (i < 0) { return; }
    let s = a[i];
    let size = u.f.x;
    var h: f32;
    switch u.k.x {
        case 0u: { h = shaped(ramp(s, size)); }
        case 1u: { h = shaped(ramp(s + size, size)); }
        case 2u: { h = shaped(ramp(s + size, size) * 0.5 + ramp(s, size) * 0.5); }
        default: {
            if (s >= 0.0) { h = shaped(ramp(s, size)); } else { h = shaped(ramp(-s, size)); }
        }
    }
    o[i] = h;
}

// The height `a` lit, over the coverage `b`: f.xyz the light, f.w the slope's scale; g.x the
// opacity; k.x the shape, k.z 1 for the highlight and 0 for the shadow.
@compute @workgroup_size(8, 8)
fn lit(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = index(id);
    if (i < 0) { return; }
    let x = i32(id.x);
    let y = i32(id.y);
    let hx = (at(x + 1, y) - at(x - 1, y)) * 0.5;
    let hy = (at(x, y + 1) - at(x, y - 1)) * 0.5;
    let k = u.f.w;
    let n = vec3<f32>(-hx * k, -hy * k, 1.0);
    let len = sqrt(n.x * n.x + n.y * n.y + 1.0);
    let lz = u.f.z;
    let l = (n.x * u.f.x + n.y * u.f.y + lz) / len - lz;
    let cv = b[i];
    var region: f32;
    switch u.k.x {
        case 0u: { region = cv; }
        case 1u: { region = 1.0 - cv; }
        default: { region = 1.0; }
    }
    var v: f32;
    if (u.k.z == 1u) {
        v = clamp(l / max(1.0 - lz, 1e-3), 0.0, 1.0);
    } else {
        v = clamp(-l / max(lz, 1e-3), 0.0, 1.0);
    }
    o[i] = v * u.g.x * region;
}

// Satin from the two moved and blurred copies `a` and `b` over the coverage `c`: k.x 1 inverted;
// f.x the opacity.
@compute @workgroup_size(8, 8)
fn satin(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = index(id);
    if (i < 0) { return; }
    let d = abs(a[i] - b[i]);
    var v = d;
    if (u.k.x == 1u) {
        v = 1.0 - d;
    }
    o[i] = clamp(v * c[i] * u.f.x, 0.0, 1.0);
}

// The part in its color, premultiplied: f.xyz the color, from the alpha `a` quantized as the CPU
// reference's 8-bit picture is.
@compute @workgroup_size(8, 8)
fn paint(@builtin(global_invocation_id) id: vec3<u32>) {
    let i = index(id);
    if (i < 0) { return; }
    let v = a[i];
    rgba[id.y * u.k.w + id.x] = vec4<f32>(u.f.xyz * v, v);
}
