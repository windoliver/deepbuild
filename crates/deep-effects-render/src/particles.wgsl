// Issue #380: the core's instanced draw of a particles@1 item's instance columns, which its
// shipped compute operator wrote this frame: one dot per live particle, sized in px, its color
// the item's roles mixed over its life, added to the linear target where it shows in front of
// the scene (reversed Z, so a nearer dot has the larger depth). Written for this module; nothing
// here is ported.

struct Draw {
    clip: mat4x4<f32>,
    // The view's width and height in px, the dot's size in px, and its opacity.
    view: vec4<f32>,
    // Linear colors at birth and at death; w unused.
    from_color: vec4<f32>,
    to_color: vec4<f32>,
};

@group(0) @binding(0) var<uniform> draw: Draw;
@group(0) @binding(1) var<storage, read> inst: array<f32>;

struct Out {
    @builtin(position) pos: vec4<f32>,
    @location(0) at: vec2<f32>,
    @location(1) life: f32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> Out {
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0, 1.0),
    );
    let k = corners[vi];
    let base = ii * 4u;
    let p = vec3<f32>(inst[base], inst[base + 1u], inst[base + 2u]);
    let life = inst[base + 3u];
    var out: Out;
    out.at = k;
    out.life = life;
    let c = draw.clip * vec4<f32>(p, 1.0);
    if life < 0.0 || c.w <= 0.0 {
        out.pos = vec4<f32>(2.0, 2.0, 2.0, 1.0);
        return out;
    }
    let half_px = 0.5 * draw.view.z;
    let ndc = k * half_px * 2.0 / draw.view.xy;
    out.pos = vec4<f32>(c.xy + ndc * c.w, c.z, c.w);
    return out;
}

@fragment
fn fs(in: Out) -> @location(0) vec4<f32> {
    let r2 = dot(in.at, in.at);
    if r2 > 1.0 {
        discard;
    }
    let soft = (1.0 - r2) * (1.0 - r2);
    let fade = 1.0 - clamp(in.life, 0.0, 1.0);
    let color = mix(draw.from_color.rgb, draw.to_color.rgb, clamp(in.life, 0.0, 1.0));
    return vec4<f32>(color * soft * fade * draw.view.w, 0.0);
}
