
// ---- #537: the terrain overlays (canvas primitives: Builder plate: terrain overlays),
// concatenated after scene3d.wgsl. `tints` holds a table, then each overlay's cells. Word 0 is the
// overlays' count; then TINT_WORDS words an overlay: its plate's pick ID, cols, rows, the word its
// cells start at, origin x and z, its cell's side and its opacity (f32 bits), and 16 roles as
// packed sRGB, alpha 0 for `none`. The cells are one byte each, row-major, each row padded to
// whole words.
@group(1) @binding(20) var<storage, read> tints: array<u32>;

const TINT_WORDS: u32 = 24u;

// The cover's base color at `local` (the part's own space, m) of the solid `pick`, mixed toward
// each of its overlays' roles there by the overlay's opacity, in order: read at the nearest cell,
// never filtered, before any light.
fn tinted(base: vec3<f32>, pick: u32, local: vec3<f32>) -> vec3<f32> {
    var c = base;
    for (var k = 0u; k < tints[0]; k = k + 1u) {
        let e = 1u + k * TINT_WORDS;
        if tints[e] != pick {
            continue;
        }
        let size = vec2<u32>(tints[e + 1u], tints[e + 2u]);
        let origin = vec2<f32>(bitcast<f32>(tints[e + 4u]), bitcast<f32>(tints[e + 5u]));
        let at = floor((local.xz - origin) / bitcast<f32>(tints[e + 6u]));
        if any(at < vec2<f32>(0.0)) || any(at >= vec2<f32>(size)) {
            continue;
        }
        let cell = vec2<u32>(at);
        let word = tints[tints[e + 3u] + cell.y * ((size.x + 3u) / 4u) + cell.x / 4u];
        let v = (word >> (8u * (cell.x % 4u))) & 255u;
        if v >= 16u {
            continue;
        }
        let role = tints[e + 8u + v];
        if (role >> 24u) != 0u {
            c = mix(c, paint(role), bitcast<f32>(tints[e + 7u]));
        }
    }
    return c;
}
