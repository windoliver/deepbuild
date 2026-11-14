// Issue #1174: screen-size labels, drawn into the slot after the upscale and sharpen at display
// size as 2D text is: the label's box's top left snapped to the device pixel grid, each glyph's
// quad in whole pixels off it, read texel for texel from the core's atlas (never filtered, so no glyph
// bleeds into its neighbour), its coverage applied over the sRGB-encoded slot as Vello composites,
// and its color exact. Each fragment is depth-tested against the core's depth target, as the
// geometry pass tested the label, which wrote its depth and pick there. Joined to output.wgsl and
// outline.wgsl, whose frame and depth test it shares.

@group(2) @binding(0) var label_atlas: texture_2d_array<f32>;

// A record's flags: its size is in m (those draw in the geometry pass).
const LABEL_WORLD: u32 = 1u;

struct LabelOut {
    @builtin(position) pos: vec4<f32>,
    // The glyph quad's top-left in device px, and its first texel on its page, as a share of it.
    @location(0) @interpolate(flat) corner: vec2<f32>,
    @location(1) @interpolate(flat) uv: vec2<f32>,
    @location(2) @interpolate(flat) color: u32,
    @location(3) @interpolate(flat) page: u32,
};

@vertex
fn label_vs(
    @builtin(vertex_index) vi: u32,
    @location(0) p: vec4<f32>,
    @location(1) rect: vec4<f32>,
    @location(2) uv: vec4<f32>,
    @location(3) ax_r: vec4<f32>,
    @location(4) ax_u: vec4<f32>,
    @location(5) color: u32,
    @location(6) pick: u32,
    @location(7) flags: u32,
) -> LabelOut {
    var out: LabelOut;
    out.color = color;
    out.page = (flags >> 3u) & 31u;
    let c = line_frame.clip * vec4<f32>(p.xyz, 1.0);
    if c.w <= 0.0 || (flags & LABEL_WORLD) != 0u {
        out.pos = AWAY;
        return out;
    }
    let corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
        vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0),
    );
    // The glyph's quad is in whole pixels at this size off the label's centre less the fraction
    // of its half box, which lands its box's top left on a pixel corner (label.rs).
    let anchor = round(line_px(c) - vec2<f32>(ax_r.w, ax_u.w));
    let top_left = anchor + round(rect.xy * p.w);
    let size = round(rect.zw * p.w);
    out.corner = top_left;
    out.uv = uv.xy;
    out.pos = line_clip(top_left + corners[vi] * size, c);
    return out;
}

@fragment
fn label_fs(in: LabelOut) -> @location(0) vec4<f32> {
    let first = round(in.uv * vec2<f32>(textureDimensions(label_atlas).xy));
    let t = vec2<i32>(first + floor(in.pos.xy - in.corner));
    let a = textureLoad(label_atlas, t, i32(in.page), 0).r * unpack4x8unorm(in.color).a;
    if a <= 0.0 || hidden(in.pos.xy, in.pos.z) {
        discard;
    }
    return vec4<f32>(unpack4x8unorm(in.color).rgb * a, a);
}
