// Issue #462: a look's strokes on surfaces, one instanced quad a stroke. The CPU lays each
// stroke on a surface from stable IDs and gives its centre in frame px, its anchor (drawn a hair
// toward the eye, the depth it tests), its angle on screen, its length and width in px, its
// linear color and its seed; the quad lies over the linear target only where the scene's depth
// holds the stroke's own surface (reversed Z, so the nearer has the larger depth): never over
// something nearer, and never past its surface's silhouette onto the ground or a farther surface.
// A soft-ended dab with bristle streaks along its length. Written for this module; nothing here is
// ported.

struct Draw {
    clip: mat4x4<f32>,
    // The view's width and height in px, and 1 for a perspective view.
    view: vec4<f32>,
};

struct Dab {
    // Its centre in px, its angle in radians and its seed in [0, 1).
    at: vec4<f32>,
    // Its anchor, world m.
    near: vec4<f32>,
    // Its length and width in px.
    dims: vec4<f32>,
    // Its linear color and opacity.
    color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var<storage, read> dabs: array<Dab>;
@group(0) @binding(2) var scene_depth: texture_depth_2d;

struct Out {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) seed: f32,
    // The stroke's own depth, which the scene's must match where it paints.
    @location(3) depth: f32,
};

@vertex
fn vs(@builtin(vertex_index) v: u32, @builtin(instance_index) i: u32) -> Out {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, 1.0),
    );
    let d = dabs[i];
    let c = corners[v];
    let along = vec2<f32>(cos(d.at.z), sin(d.at.z));
    let across = vec2<f32>(-along.y, along.x);
    let px = d.at.xy + along * (c.x * 0.5 * d.dims.x) + across * (c.y * 0.5 * d.dims.y);
    let clip = draw.clip * vec4<f32>(d.near.xyz, 1.0);
    let z = clamp(clip.z / clip.w, 0.0, 1.0);
    var o: Out;
    o.pos = vec4<f32>(px.x / draw.view.x * 2.0 - 1.0, 1.0 - px.y / draw.view.y * 2.0, z, 1.0);
    o.depth = z;
    o.uv = c;
    o.color = d.color;
    o.seed = d.at.w;
    return o;
}

fn hash(x: f32) -> f32 {
    return fract(sin(x * 12.9898) * 43758.5453);
}

@fragment
fn fs(i: Out) -> @location(0) vec4<f32> {
    // Its own surface only: the scene's depth here within 2% of the stroke's distance (reversed
    // Z goes as 1 / distance in perspective; an orthographic view's is linear).
    let scene = textureLoad(scene_depth, vec2<i32>(floor(i.pos.xy)), 0);
    var off = abs(scene - i.depth) > 0.002;
    if (draw.view.z > 0.5) {
        off = abs(scene / max(i.depth, 1e-12) - 1.0) > 0.02;
    }
    if (off) {
        discard;
    }
    // A dab: round at the ends, its bristles light and dark streaks along its length.
    let r = length(vec2<f32>(i.uv.x, i.uv.y));
    let body = 1.0 - smoothstep(0.7, 1.0, r);
    let lane = floor((i.uv.y * 0.5 + 0.5) * 7.0);
    let bristle = 0.7 + 0.3 * hash(lane + i.seed * 97.0);
    let tail = 1.0 - 0.35 * smoothstep(0.2, 1.0, i.uv.x);
    let a = clamp(i.color.a * body * bristle * tail, 0.0, 1.0);
    return vec4<f32>(i.color.rgb * a, a);
}
