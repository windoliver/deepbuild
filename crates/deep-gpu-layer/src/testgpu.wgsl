// The test canvas module `test.gpu` (issue #379, test-meter builds only): a textured 1 m quad, a
// generated mesh, and `test.burn`, whose fragment loops `loops` times per pixel.

struct Frame {
    clip: mat4x4<f32>,
};

@group(0) @binding(0) var<uniform> frame: Frame;
@group(1) @binding(0) var tex: texture_2d<f32>;
@group(1) @binding(1) var smp: sampler;

struct QOut {
    @builtin(position) pos: vec4f,
    @location(0) uv: vec2f,
};

@vertex
fn quad_vs(@builtin(vertex_index) i: u32, @location(1) at: vec4f) -> QOut {
    var corners = array<vec2f, 6>(
        vec2f(0.0, 0.0), vec2f(1.0, 0.0), vec2f(0.0, 1.0),
        vec2f(0.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0),
    );
    let c = corners[i];
    var o: QOut;
    o.pos = frame.clip * vec4f(at.xyz + vec3f(c.x - 0.5, c.y - 0.5, 0.0), 1.0);
    o.uv = vec2f(c.x, 1.0 - c.y);
    return o;
}

@fragment
fn quad_fs(v: QOut) -> @location(0) vec4f {
    return vec4f(textureSample(tex, smp, v.uv).rgb, 1.0);
}

struct MOut {
    @builtin(position) pos: vec4f,
    @location(0) color: vec3f,
};

@vertex
fn mesh_vs(@location(0) p: vec4f, @location(1) at: vec4f) -> MOut {
    var o: MOut;
    o.pos = frame.clip * vec4f(at.xyz + p.xyz, 1.0);
    o.color = vec3f(p.w, 0.5, 1.0 - p.w);
    return o;
}

@fragment
fn mesh_fs(v: MOut) -> @location(0) vec4f {
    return vec4f(v.color, 1.0);
}
