// Issue #173: frame history's resolve. Each output pixel is carried into every frame of the window
// through that frame's own camera and the moving parts' poses at both times, never a vector kept
// from an earlier frame. At the display's own size each older frame gives its bilinear estimate
// there, kept where the frame saw a depth the current frame's neighbourhood holds and clamped to
// that neighbourhood in YCoCg; below it each sample is carried to where its surface lies now,
// weighted by its distance to the pixel and kept unless something nearer covers it now. A reactive
// part counts at t alone. The result is written at display size, sRGB-encoded, with the display's
// depth for line marks drawn after it.

struct Entry {
    // The world at the frame's own time to its clip, jittered as it rendered.
    clip: mat4x4<f32>,
    // A texel of the frame (its clip position and depth) back to the clip at t, unjittered:
    // where the surface it saw lies now, for a part that didn't move.
    back: mat4x4<f32>,
    // Its layer, its near plane, 1 for a perspective view, and 0.
    info: vec4<f32>,
    // Its jitter in render px, right and down.
    jitter: vec4<f32>,
};

struct Resolve {
    // Clip at t, unjittered, to world at t.
    inverse: mat4x4<f32>,
    // Render width and height, display width and height.
    sizes: vec4<f32>,
    // Frames in the window (the last is the frame at t), depth test, clamp, and the filter's
    // width in display px below the display's own size.
    flags: vec4<f32>,
    entries: array<Entry, 17>,
};

@group(0) @binding(0) var<uniform> r: Resolve;
// Each window frame as its output pass wrote it, read through an sRGB view: linear light.
@group(0) @binding(1) var color: texture_2d_array<f32>;
@group(0) @binding(2) var depth: texture_depth_2d_array;
// Each window frame's pick IDs.
@group(0) @binding(3) var ids: texture_2d_array<u32>;
// Each pick's moving slot (from 1; 0 stays still) shifted left once, its reactive flag in bit 0.
@group(0) @binding(4) var<storage, read> picks: array<u32>;
// For moving slot s and window frame e, two matrices: that frame's clip times the part's carry
// from t, and the frame's texel back to the clip at t through the part's carry to t.
@group(0) @binding(5) var<storage, read> carried: array<mat4x4<f32>>;
// Gathers a window frame's 2 × 2 texels, clamped at its edge.
@group(0) @binding(6) var taps: sampler;

@vertex
fn resolve_vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    let x = f32((vi << 1u) & 2u);
    let y = f32(vi & 2u);
    return vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

fn srgb_encode(x: vec3<f32>) -> vec3<f32> {
    let v = clamp(x, vec3<f32>(0.0), vec3<f32>(1.0));
    let lo = v * 12.92;
    let hi = 1.055 * pow(v, vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(hi, lo, v <= vec3<f32>(0.0031308));
}

fn ycocg(c: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(
        0.25 * c.r + 0.5 * c.g + 0.25 * c.b,
        0.5 * c.r - 0.5 * c.b,
        -0.25 * c.r + 0.5 * c.g - 0.25 * c.b,
    );
}

fn rgb(c: vec3<f32>) -> vec3<f32> {
    return vec3<f32>(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}

// A window over `width` display px, centred, in both directions: a Gaussian through a four-term
// Blackman-Harris window's values at a quarter and half its reach (0.68 and 0.22), cut at the reach,
// so a sample costs one exp2 rather than six cosines.
fn weight(d: vec2<f32>, width: f32) -> f32 {
    let x = 2.0 * d / width;
    if any(abs(x) >= vec2<f32>(1.0)) {
        return 0.0;
    }
    return exp2(-8.8 * dot(x, x));
}

// A pick's slot and reactive flag; 0 for none.
fn part(id: u32) -> u32 {
    if id < arrayLength(&picks) {
        return picks[id];
    }
    return 0u;
}

fn render_size() -> vec2<i32> {
    return vec2<i32>(r.sizes.xy);
}

fn texel_ok(t: vec2<i32>) -> bool {
    let s = render_size();
    return all(t >= vec2<i32>(0)) && all(t < s);
}

// The resolved colour, and the depth at t of the nearest surface the window saw inside the pixel:
// the display's own depth, which line marks drawn after the resolve are tested against.
struct Resolved {
    @location(0) color: vec4<f32>,
    @builtin(frag_depth) depth: f32,
};

@fragment
fn resolve_fs(@builtin(position) frag: vec4<f32>) -> Resolved {
    let n = i32(r.flags.x);
    let now = r.entries[n - 1];
    let layer_now = i32(now.info.x);
    let to_render = r.sizes.xy / r.sizes.zw;
    let to_display = r.sizes.zw / r.sizes.xy;
    let width = r.flags.w;
    // The pixel's centre in the render target's unjittered px, and the texel at t whose sample
    // lies nearest it (texel i samples unjittered i + ½ − jitter).
    let at = frag.xy * to_render;
    let i = vec2<i32>(floor(at + now.jitter.xy));
    let ic = clamp(i, vec2<i32>(0), render_size() - 1);
    let d0 = textureLoad(depth, ic, layer_now, 0);
    let info = part(textureLoad(ids, ic, layer_now, 0).x);
    let reactive = (info & 1u) != 0u;
    let slot = info >> 1u;
    // The pixel's centre in clip space at t; a depth takes it back to the world (homogeneous: a
    // point at infinity keeps w 0).
    let ndc = vec2<f32>(at.x / r.sizes.x * 2.0 - 1.0, 1.0 - at.y / r.sizes.y * 2.0);
    // The current frame's neighbourhood: its colours in YCoCg, and the depths it holds. A window
    // frame's sample counts only if its surface lies within that depth range there (so what an
    // edge mixes stays, and what a part uncovered, nearer than anything now around it, goes).
    // The neighbourhood is the texels whose samples lie within 1.5 px of the pixel's centre, on
    // both sides of it whatever the jitter, never the nearest texel's own; at the frame's edge it
    // slides inside, so a thin part along the edge never fills it and rejects all else.
    var lo = vec3<f32>(1e30);
    var hi = vec3<f32>(-1e30);
    var near = d0;
    var far = d0;
    // At the display's own size the frame at t gives its estimate from these texels too, weighed
    // over 4 px: where the older frames hold nothing (what enters the view), the pixel then follows
    // its surface rather than the one sample the frame's jitter puts nearest it.
    let own_size = all(r.sizes.xy == r.sizes.zw);
    var own = vec3<f32>(0.0);
    var own_w = 0.0;
    let corner = clamp(vec2<i32>(floor(at + now.jitter.xy - 1.5)), vec2<i32>(0), max(render_size() - 4, vec2<i32>(0)));
    for (var y = 0; y < 4; y++) {
        for (var x = 0; x < 4; x++) {
            let t = clamp(corner + vec2<i32>(x, y), vec2<i32>(0), render_size() - 1);
            let linear = textureLoad(color, t, layer_now, 0).rgb;
            if own_size {
                let w = weight((vec2<f32>(t) + 0.5 - now.jitter.xy - at) * to_display, 4.0);
                own += w * linear;
                own_w += w;
            }
            let c = ycocg(linear);
            lo = min(lo, c);
            hi = max(hi, c);
            let z = textureLoad(depth, t, layer_now, 0);
            near = max(near, z);
            far = min(far, z);
        }
    }
    var sum = vec3<f32>(0.0);
    var total = 0.0;
    var nearest = -1.0;
    // Below the display's size, the nearest surface any window sample shows inside the pixel at t.
    var front = -1.0;
    // The filter's reach in render px, and the texels across it a frame's block reads.
    let reach = 0.5 * width * to_render;
    let m = vec2<i32>(ceil(2.0 * reach));
    // A clip position at t to its offset from the pixel's centre in display px.
    let scale = vec2<f32>(0.5 * r.sizes.z, -0.5 * r.sizes.w);
    let offset = (0.5 * r.sizes.xy - at) * to_display;
    // The pixel's centre at t back in the world at depth 0, and the world a unit of depth adds: a
    // frame's clip of the pixel's centre at any depth is its clip of those two.
    let world = r.inverse * vec4<f32>(ndc, 0.0, 1.0);
    let world_z = r.inverse[2];
    // At the display's own size each older frame gives one estimate, its bilinear interpolation at
    // the pixel's centre: a tent one px wide over its jittered samples, so the window's frames
    // together sample the pixel. A lower scale weighs each sample by where it lies at t instead, so
    // the window rebuilds detail finer than one frame holds. There one sample a texel can't bound
    // what lies between its samples (a pattern on the texel grid reads all one value in a frame),
    // so neither the frame at t's colours nor its depths judge the others: a first pass finds the
    // nearest surface the window shows inside the pixel, and a sample behind it is one something
    // covers now. What moved away was carried to where it is now; a reactive part counts at t alone.
    let sweeps = select(2, 1, own_size);
    for (var sweep = 0; sweep < sweeps; sweep++) {
    for (var e = 0; e < n; e++) {
        if reactive && e != n - 1 {
            continue;
        }
        let entry = r.entries[e];
        var k = entry.clip;
        var back = entry.back;
        if slot != 0u && e != n - 1 {
            let at_slot = ((slot - 1u) * u32(n) + u32(e)) * 2u;
            k = carried[at_slot];
            back = carried[at_slot + 1u];
        }
        if own_size && e == n - 1 {
            if own_w > 0.0 {
                sum += own / own_w;
                total += 1.0;
            }
            continue;
        }
        let q0 = k * world;
        let qz = k * world_z;
        let layer = i32(entry.info.x);
        if own_size {
            // Through the nearest surface around the pixel, so an edge moves with its nearer
            // side and what lies behind it never brings that side's old place along.
            let q = q0 + qz * near;
            if entry.info.z > 0.5 && q.w <= 0.0 {
                continue;
            }
            let p = vec2<f32>((q.x / q.w * 0.5 + 0.5) * r.sizes.x, (0.5 - q.y / q.w * 0.5) * r.sizes.y) - 0.5;
            let base = floor(p);
            let f = p - base;
            let uv = (base + 1.0) / r.sizes.xy;
            // The 2 × 2 texels from `base` in gather order: (0, 1), (1, 1), (1, 0), (0, 0); a texel
            // past the frame's edge weighs nothing.
            let bi = vec2<i32>(base);
            let xs = vec4<i32>(bi.x, bi.x + 1, bi.x + 1, bi.x);
            let ys = vec4<i32>(bi.y + 1, bi.y + 1, bi.y, bi.y);
            let s = render_size();
            let inside = (xs >= vec4<i32>(0)) & (xs < vec4<i32>(s.x)) & (ys >= vec4<i32>(0)) & (ys < vec4<i32>(s.y));
            var w = select(vec4<f32>(0.0), vec4<f32>((1.0 - f.x) * f.y, f.x * f.y, f.x * (1.0 - f.y), (1.0 - f.x) * (1.0 - f.y)), inside);
            if r.flags.y > 0.5 {
                // The neighbourhood's depth range at t, as this frame saw those depths at the
                // pixel's centre: a texel outside it saw what the frame at t doesn't hold there.
                let qf = q0 + qz * far;
                let zn = q.z / q.w;
                let zf = qf.z / qf.w;
                let hi_z = max(zn, zf);
                let lo_z = min(zn, zf);
                let slack_e = 0.003 * hi_z + 1e-7;
                let seen = textureGather(depth, taps, uv, layer);
                w = select(vec4<f32>(0.0), w, (seen >= vec4<f32>(lo_z - slack_e)) & (seen <= vec4<f32>(hi_z + slack_e)));
            }
            let fw = dot(w, vec4<f32>(1.0));
            if fw > 0.0 {
                let red = textureGather(0, color, taps, uv, layer);
                let green = textureGather(1, color, taps, uv, layer);
                let blue = textureGather(2, color, taps, uv, layer);
                var c = vec3<f32>(dot(w, red), dot(w, green), dot(w, blue)) / fw;
                if r.flags.z > 0.5 && e != n - 1 {
                    c = rgb(clamp(ycocg(c), lo, hi));
                }
                sum += fw * c;
                total += fw;
            }
            continue;
        }
        // Where the pixel's centre was in this frame at the depths its neighbourhood holds (its
        // own, the nearest and the farthest), so the samples of both sides of an edge are read
        // whatever surface the frame at t sampled there: up to three blocks, each the texels whose
        // samples lie within the filter's reach of it.
        var b0 = vec2<i32>(0);
        var b1 = vec2<i32>(0);
        var b2 = vec2<i32>(0);
        var blocks = 0;
        for (var c = 0; c < 3; c++) {
            let z = select(select(far, near, c == 1), d0, c == 0);
            if c > 0 && z == d0 {
                continue;
            }
            let q = q0 + qz * z;
            if entry.info.z > 0.5 && q.w <= 0.0 {
                continue;
            }
            let pos = vec2<f32>((q.x / q.w * 0.5 + 0.5) * r.sizes.x, (0.5 - q.y / q.w * 0.5) * r.sizes.y);
            let b = vec2<i32>(floor(pos - 0.5 - reach)) + 1;
            if (blocks > 0 && all(b == b0)) || (blocks > 1 && all(b == b1)) {
                continue;
            }
            if blocks == 0 {
                b0 = b;
            } else if blocks == 1 {
                b1 = b;
            } else {
                b2 = b;
            }
            blocks += 1;
        }
        // A texel's clip position at t is linear in its index: back × (x, y, depth, 1) with x and y
        // from the index, so each row adds its index's column and each texel its own and its
        // depth's. Its offset from the pixel in display px is then that position's, scaled.
        let along = back[0] * (2.0 / r.sizes.x);
        let down = back[1] * (-2.0 / r.sizes.y);
        let origin = back[3] + back[0] * (1.0 / r.sizes.x - 1.0) + back[1] * (1.0 - 1.0 / r.sizes.y);
        for (var j = 0; j < blocks; j++) {
            let base = select(select(b2, b1, j == 1), b0, j == 0);
            for (var y = 0; y < m.y; y++) {
                let row = origin + down * f32(base.y + y);
                for (var x = 0; x < m.x; x++) {
                    let t = base + vec2<i32>(x, y);
                    if j > 0 {
                        let o0 = t - b0;
                        let o1 = t - b1;
                        if (all(o0 >= vec2<i32>(0)) && all(o0 < m)) || (j > 1 && all(o1 >= vec2<i32>(0)) && all(o1 < m)) {
                            continue;
                        }
                    }
                    if !texel_ok(t) {
                        continue;
                    }
                    // The texel's sample weighs by where the surface it saw lies at t, so a
                    // surface that moved otherwise than the pixel's (another part, or the sky
                    // behind) lands where it is now, never on this pixel.
                    let seen = textureLoad(depth, t, layer, 0);
                    var b = row + along * f32(t.x) + back[2] * seen;
                    if e != n - 1 {
                        // A sample of another part is carried back through its own poses; a
                        // reactive part's counts at t alone.
                        let own = part(textureLoad(ids, t, layer, 0).x);
                        if (own & 1u) != 0u {
                            continue;
                        }
                        if (own >> 1u) != slot {
                            var m = entry.back;
                            if (own >> 1u) != 0u {
                                m = carried[(((own >> 1u) - 1u) * u32(n) + u32(e)) * 2u + 1u];
                            }
                            let tc = vec2<f32>(t) + 0.5;
                            b = m * vec4<f32>(tc.x / r.sizes.x * 2.0 - 1.0, 1.0 - tc.y / r.sizes.y * 2.0, seen, 1.0);
                        }
                    }
                    if entry.info.z > 0.5 && b.w <= 0.0 {
                        continue;
                    }
                    let to_w = 1.0 / b.w;
                    let d = b.xy * (scale * to_w) + offset;
                    let zb = b.z * to_w;
                    if sweep == 0 {
                        // The display's depth takes the nearest surface within a px of the
                        // pixel, so a part thinner than a frame's texel still covers a line mark
                        // behind it, as at the display's own size.
                        if all(abs(d) < vec2<f32>(1.0)) {
                            nearest = max(nearest, zb);
                        }
                        // Well inside the pixel: a sample on its edge belongs to the neighbour
                        // as much as to it.
                        if all(abs(d) < vec2<f32>(0.35)) {
                            front = max(front, zb);
                        }
                        continue;
                    }
                    let w = weight(d, width);
                    // Reversed depth, larger is nearer, with a slack of 0.3%.
                    if w <= 0.0 || (r.flags.y > 0.5 && front >= 0.0 && zb < front * 0.997 - 1e-7) {
                        continue;
                    }
                    sum += w * textureLoad(color, t, layer, 0).rgb;
                    total += w;
                }
            }
        }
    }
    }
    var out = textureLoad(color, ic, layer_now, 0).rgb;
    if total > 1e-4 {
        out = sum / total;
    }
    if nearest < 0.0 {
        // No sample near the pixel (or the display's own size): the frame at t's own depth, where
        // the pixel's centre lies.
        let c = now.back * vec4<f32>(ndc + 2.0 * vec2<f32>(now.jitter.x, -now.jitter.y) / r.sizes.xy, d0, 1.0);
        nearest = select(0.0, c.z / c.w, c.w > 0.0);
    }
    return Resolved(vec4<f32>(srgb_encode(out), 1.0), clamp(nearest, 0.0, 1.0));
}
