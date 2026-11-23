
// ---- Object: hidden view (#290): an item drawn again where nearer surfaces hide it, after the
// resolve, into the one-sample linear target.

// The core's depth and object-ID targets, as the resolve and the glass left them.
@group(4) @binding(1) var core_depth: texture_depth_2d;
@group(4) @binding(2) var core_ids: texture_2d<u32>;
// Each pick ID's item among this frame's hidden views, 1 up; 0 for a part of none of them.
@group(4) @binding(3) var<storage, read> hidden_items: array<u32>;

// The planted hidden_view_draws_where_visible: the view also draws where its item shows.
const HIDDEN_WHERE_SHOWN: bool = false;

// The planted hidden_view_without_own_depth: its depth pass keeps the item's farthest hidden
// layer, so a layer that isn't hidden writes nothing.
const HIDDEN_STACKS: bool = false;

// Its depth pass, into a depth target of its own, which keeps the item's nearest surface. That
// surface is hidden where the core's depth target holds a nearer surface and its object-ID
// target names another item: there it writes its own depth, which the blended draw then tests
// equal. Where it isn't hidden it writes the nearest depth there is, so it still wins the pixel
// from the item's farther layers and no layer draws there: an item that shows never draws
// twice. What a cutaway removes, a band's mask leaves out, a material's back faces and a mask's
// holes (by the material's own alpha) write nothing. It reads the frame and those two targets
// alone.
@fragment
fn hidden_depth_fs(in: MeshOut, @builtin(front_facing) front: bool) -> @builtin(frag_depth) f32 {
    if ((in.flags & CUT) != 0u && cut_hides(in.world))
        || !band_keeps(vec2<u32>(in.pos.xy), in.pick, in.mask.x) {
        discard;
    }
    if (in.flags & MATERIAL) != 0u {
        if (front == ((in.flags & MIRRORED) != 0u)) && (in.flags & DOUBLE_SIDED) == 0u {
            discard;
        }
        if ((in.flags >> 7u) & 3u) == MASK && in.emission.w < ALPHA_CUTOFF {
            discard;
        }
    }
    let px = vec2<i32>(in.pos.xy);
    let held = textureLoad(core_depth, px, 0);
    // Reversed Z grows toward the eye; the planted forward Z the other way.
    let forward = frame.px.w > 0.5;
    let nearer = (!forward && (held > in.pos.z)) || (forward && (in.pos.z > held));
    // A part of the record's own item shows here, whichever of its parts or elements it is.
    let id = textureLoad(core_ids, px, 0).x;
    let shown = id < arrayLength(&hidden_items) && hidden_items[id] == hidden_items[in.pick];
    if HIDDEN_WHERE_SHOWN || (nearer && !shown) {
        return in.pos.z;
    }
    if HIDDEN_STACKS {
        discard;
    }
    return select(1.0, 0.0, forward);
}

// That surface, tested equal against its depth pass, in its own shading at the view's opacity
// (the record's op.z).
@fragment
fn hidden_fs(in: MeshOut, @builtin(front_facing) front: bool) -> @location(0) vec4<f32> {
    let drawn = mesh(in, front);
    return drawn.color * bitcast<f32>(in.op.z);
}

// The planted hidden_view_writes_ids: the item's object ID wherever its hidden view draws.
@fragment
fn hidden_ids_fs(in: MeshOut, @builtin(front_facing) front: bool) -> @location(0) u32 {
    _ = mesh(in, front);
    return in.pick;
}
