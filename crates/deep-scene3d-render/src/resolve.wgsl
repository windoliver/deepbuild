// Issue #1173: the geometry pass draws into multisampled targets; its color resolves in the pass,
// and this pass resolves its object IDs and depth before anything reads them. Both come from the
// pixel's first sample an item covers (else its first), so an ID is never a blend of two items, a
// depth is one a surface had, and an empty ID means no item touches the pixel: its resolved color
// is the background's alone. The IDs come as two 16-bit halves (the multisampled ID format) and
// leave as one u32.

@group(0) @binding(0) var ids_ms: texture_multisampled_2d<u32>;
@group(0) @binding(1) var depth_ms: texture_depth_multisampled_2d;

// The targets' sample count; the single-sample variant reads 1.
const SAMPLES: i32 = 4;

struct Resolved {
    @location(0) id: u32,
    @builtin(frag_depth) depth: f32,
};

@vertex
fn resolve_vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4<f32> {
    let x = f32((vi << 1u) & 2u);
    let y = f32(vi & 2u);
    return vec4<f32>(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}

@fragment
fn resolve_fs(@builtin(position) p: vec4<f32>) -> Resolved {
    let at = vec2<i32>(p.xy);
    var s = 0;
    for (var i = 0; i < SAMPLES; i++) {
        if any(textureLoad(ids_ms, at, i).xy != vec2<u32>(0u)) {
            s = i;
            break;
        }
    }
    let id = textureLoad(ids_ms, at, s).xy;
    return Resolved(id.x | (id.y << 16u), textureLoad(depth_ms, at, s));
}

// The planted resolve_accumulates_frames: the view's previous resolved frame, which the pipeline
// blends in at half.
@group(0) @binding(2) var previous: texture_2d<f32>;

@fragment
fn previous_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    return textureLoad(previous, vec2<i32>(p.xy), 0);
}
