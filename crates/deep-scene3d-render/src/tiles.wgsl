
// Shadow tiles (#2034; Light policy: local shadows): a local light's faces as tiles of one atlas,
// each `Local` holding its tile side in size.z, its first slot in info.y (a face's slot is that
// plus its face), and in size.w the planted filter sized in the tile's own texels. The filter's
// width is fixed in world units, as a map of `lights.local_size.x` texels would size it, so a tile
// that changes size changes a shadow's softness as little as it can.

// A Z-order index's even bits, packed.
fn unzip(v: u32) -> u32 {
    var x = v & 0x55555555u;
    x = (x | (x >> 1u)) & 0x33333333u;
    x = (x | (x >> 2u)) & 0x0f0f0f0fu;
    x = (x | (x >> 4u)) & 0x00ff00ffu;
    x = (x | (x >> 8u)) & 0x0000ffffu;
    return x;
}

// Slot `slot`'s top-left texel in the atlas at tile side `size` (tiles.rs's `origin`).
fn tile_origin(size: f32, slot: u32) -> vec2<f32> {
    return vec2<f32>(f32(unzip(slot)), f32(unzip(slot >> 1u))) * size;
}

// A comparison of `z` at `uv` in face slot `slot`'s tile, kept half a texel inside it so no tap
// reads a neighbour's.
fn tile_cmp(l: Local, uv: vec2<f32>, z: f32, slot: i32) -> f32 {
    let size = l.size.z;
    let at = clamp(uv * size, vec2<f32>(0.5), vec2<f32>(size - 0.5));
    let o = tile_origin(size, u32(slot));
    return textureSampleCompareLevel(local_maps, shadow_cmp, (o + at) / lights.local_size.y, 0, z);
}

// The depth a tile holds at `uv`'s texel.
fn tile_depth(l: Local, uv: vec2<f32>, slot: i32) -> f32 {
    let size = l.size.z;
    let at = clamp(vec2<i32>(uv * size), vec2<i32>(0), vec2<i32>(i32(size) - 1));
    return textureLoad(local_maps, at + vec2<i32>(tile_origin(size, u32(slot))), 0, 0);
}

// Castaño's 9-tap filter over a grid of `size` texels across the tile, each tap in its tile.
fn tile_castano(l: Local, uv: vec2<f32>, z: f32, slot: i32, size: f32) -> f32 {
    let at = uv * size;
    let base = floor(at + 0.5);
    let f = at + 0.5 - base;
    let o = (base - 0.5) / size;
    let w0 = 4.0 - 3.0 * f;
    let w1 = vec2<f32>(7.0);
    let w2 = 1.0 + 3.0 * f;
    let u0 = (3.0 - 2.0 * f) / w0 - 2.0;
    let u1 = (3.0 + f) / w1;
    let u2 = f / w2 + 2.0;
    var sum = 0.0;
    for (var j = 0; j < 3; j++) {
        let wv = select(select(w2.y, w1.y, j == 1), w0.y, j == 0);
        let v = select(select(u2.y, u1.y, j == 1), u0.y, j == 0);
        for (var i = 0; i < 3; i++) {
            let wu = select(select(w2.x, w1.x, i == 1), w0.x, i == 0);
            let u = select(select(u2.x, u1.x, i == 1), u0.x, i == 0);
            sum += wu * wv * tile_cmp(l, o + vec2<f32>(u, v) / size, z, slot);
        }
    }
    return sum / 144.0;
}

// A tiled local light's visibility at `world`: `local_lit`'s filters, their widths in world
// units and their taps in the atlas.
fn tile_lit(l: Local, world: vec3<f32>, n: vec3<f32>, px: vec2<f32>) -> f32 {
    let to = world - l.pos.xyz;
    let dist = max(length(to), 1e-4);
    let ray = to / dist;
    // The tile's own texel biases the point; the filter's is fixed in world units.
    let texel = 2.0 * l.info.z * dist / l.size.z;
    let fixed = 2.0 * l.info.z * dist / lights.local_size.x;
    let bias = 1e-5;
    let p = world + n * 1.5 * texel - ray * texel;
    let t = local_tap(l, p);
    if !inside_map(t) {
        return 1.0;
    }
    // The planted twin sizes its filter in the tile's own texels.
    let grid = select(lights.local_size.x, l.size.z, l.size.w > 0.5);
    var lit = 1.0;
    if lights.soft.x > 0.5 && lights.soft.x < 1.5 {
        lit = tile_castano(l, t.uv, t.z - bias, t.layer, grid);
    } else if lights.soft.x < 0.5 {
        let h = 0.5 / grid;
        lit = 0.0;
        lit += tile_cmp(l, t.uv + vec2<f32>(-h, -h), t.z - bias, t.layer);
        lit += tile_cmp(l, t.uv + vec2<f32>(h, -h), t.z - bias, t.layer);
        lit += tile_cmp(l, t.uv + vec2<f32>(-h, h), t.z - bias, t.layer);
        lit += tile_cmp(l, t.uv + vec2<f32>(h, h), t.z - bias, t.layer);
        lit *= 0.25;
    } else {
        let b = onb(ray);
        let lo = max(fixed, texel);
        let most = max(lights.soft.w * fixed, lo);
        let turn = disk_turn(px);
        let r = l.size.x;
        let search = clamp(r * (dist - l.info.x) / dist, lo, most);
        let taps = u32(lights.soft.y);
        var sum = 0.0;
        var found = 0.0;
        for (var j = 0u; j < taps; j++) {
            let v = vogel(j, taps, turn) * search;
            let q = local_tap(l, on_plane(p, b[0] * v.x + b[1] * v.y, n, ray));
            let d = tile_depth(l, q.uv, q.layer);
            if d < q.z - bias {
                sum += local_distance(l, d);
                found += 1.0;
            }
        }
        if found > 0.5 {
            let blocker = sum / found;
            var radius = clamp(r * max(dist - blocker, 0.0) / blocker, lo, most);
            if l.size.w > 0.5 {
                radius *= texel / fixed;
            }
            let count = u32(lights.soft.z);
            lit = 0.0;
            for (var j = 0u; j < count; j++) {
                let v = vogel(j, count, turn) * radius;
                let q = local_tap(l, on_plane(p, b[0] * v.x + b[1] * v.y, n, ray));
                lit += tile_cmp(l, q.uv, q.z - bias, q.layer);
            }
            lit /= f32(count);
        }
    }
    return mix(1.0, lit, l.size.y);
}
