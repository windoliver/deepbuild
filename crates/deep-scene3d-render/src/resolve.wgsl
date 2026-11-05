// Issue #1173: the geometry pass draws into multisampled targets; its color resolves in the pass,
// and this pass resolves its object IDs and depth before anything reads them. Each takes the
// pixel's first sample, so an ID is never a blend of two items and a depth is one a surface had.
// The IDs come as two 16-bit halves (the multisampled ID format) and leave as one u32.

@group(0) @binding(0) var ids_ms: texture_multisampled_2d<u32>;
@group(0) @binding(1) var depth_ms: texture_depth_multisampled_2d;

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
    let id = textureLoad(ids_ms, at, 0).xy;
    return Resolved(id.x | (id.y << 16u), textureLoad(depth_ms, at, 0));
}

// The planted resolve_accumulates_frames: the view's previous resolved frame, which the pipeline
// blends in at half.
@group(0) @binding(2) var previous: texture_2d<f32>;

@fragment
fn previous_fs(@builtin(position) p: vec4<f32>) -> @location(0) vec4<f32> {
    return textureLoad(previous, vec2<i32>(p.xy), 0);
}
