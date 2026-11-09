// DeepBuild patch (windoliver/deepbuild#377): stitched after shaders.metal by build.rs, so nothing here conflicts with it.

// DeepBuild patch (windoliver/deepbuild#377): a BGRA surface with alpha, premultiplied, read
// texel for texel (its size is the surface's bounds in device pixels) and drawn with source
// factor one, so light beyond an object (color where alpha is 0) still shows.
fragment float4 surface_bgra_fragment(SurfaceFragmentInput input [[stage_in]],
                                      texture2d<float> bgra_texture
                                      [[texture(SurfaceInputIndex_YTexture)]]) {
  constexpr sampler texture_sampler(mag_filter::nearest, min_filter::nearest);
  return bgra_texture.sample(texture_sampler, input.texture_position);
}

// DeepBuild patch (windoliver/deepbuild#377): the planted twin, which divides alpha out and is
// blended as straight alpha, so it loses whatever the slot holds where alpha is 0.
fragment float4 surface_bgra_divided_fragment(SurfaceFragmentInput input [[stage_in]],
                                              texture2d<float> bgra_texture
                                              [[texture(SurfaceInputIndex_YTexture)]]) {
  constexpr sampler texture_sampler(mag_filter::nearest, min_filter::nearest);
  float4 color = bgra_texture.sample(texture_sampler, input.texture_position);
  if (color.a <= 0.0) {
    return float4(0.0, 0.0, 0.0, 0.0);
  }
  return float4(color.rgb / color.a, color.a);
}

// DeepBuild patch (windoliver/deepbuild#391): the sRGB transfer curve, exactly as IEC 61966-2-1
// defines it, for the exact gradient mode.
float3 srgb_to_linear_exact(float3 color) {
  float3 low = color / 12.92;
  float3 high = pow((color + 0.055) / 1.055, float3(2.4));
  return select(high, low, color <= 0.04045);
}

float3 linear_to_srgb_exact(float3 color) {
  color = clamp(color, 0.0, 1.0);
  float3 low = color * 12.92;
  float3 high = 1.055 * pow(color, float3(1.0 / 2.4)) - 0.055;
  return select(high, low, color <= 0.0031308);
}

// DeepBuild patch (windoliver/deepbuild#391): Oklab through the sRGB curve, with a signed cube root.
float4 srgb_to_oklab_exact(float4 color) {
  float3 lin = srgb_to_linear_exact(color.rgb);

  float l = 0.4122214708 * lin.r + 0.5363325363 * lin.g + 0.0514459929 * lin.b;
  float m = 0.2119034982 * lin.r + 0.6806995451 * lin.g + 0.1073969566 * lin.b;
  float s = 0.0883024619 * lin.r + 0.2817188376 * lin.g + 0.6299787005 * lin.b;

  float l_ = sign(l) * pow(abs(l), 1.0 / 3.0);
  float m_ = sign(m) * pow(abs(m), 1.0 / 3.0);
  float s_ = sign(s) * pow(abs(s), 1.0 / 3.0);

  return float4(
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    color.a
  );
}

float4 oklab_to_srgb_exact(float4 color) {
  float l_ = color.r + 0.3963377774 * color.g + 0.2158037573 * color.b;
  float m_ = color.r - 0.1055613458 * color.g - 0.0638541728 * color.b;
  float s_ = color.r - 0.0894841775 * color.g - 1.2914855480 * color.b;

  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;

  float3 linear_rgb = float3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );

  return float4(linear_to_srgb_exact(linear_rgb), color.a);
}

// DeepBuild patch (windoliver/deepbuild#391): the exact gradient mode mixes the premultiplied stops and divides the
// alpha back out, in Oklab, with no dither.
float4 exact_gradient_mix(float4 color0, float4 color1, float t) {
  float4 oklab_color = mix(color0, color1, t);
  if (oklab_color.a > 0.0) {
    oklab_color.rgb /= oklab_color.a;
  }
  return oklab_color;
}

// DeepBuild patch (windoliver/deepbuild#1434): chrome layers. A composite draws a premultiplied
// source (a layer's offscreen target, texel for texel, or an effect's output, scaled) over
// `drawn`, its clip's rounded shape at `bounds` with `radii`, and a soft edge `edge` px wide.
struct ChromeComposite {
  Bounds_ScaledPixels bounds;
  Bounds_ScaledPixels drawn;
  Corners_ScaledPixels radii;
  float opacity;
  float edge;
  uint texel_for_texel;
  uint pad;
  float2 source_origin;
  float2 pad2;
};

struct ChromeVertexOutput {
  float4 position [[position]];
  float2 pixel;
};

vertex ChromeVertexOutput chrome_vertex(uint unit_vertex_id [[vertex_id]],
                                        constant float2 *unit_vertices [[buffer(0)]],
                                        constant ChromeComposite *composite [[buffer(1)]],
                                        constant Size_DevicePixels *viewport_size [[buffer(2)]]) {
  float2 unit_vertex = unit_vertices[unit_vertex_id];
  Bounds_ScaledPixels drawn = composite->drawn;
  float2 pixel = unit_vertex * float2(drawn.size.width, drawn.size.height) +
                 float2(drawn.origin.x, drawn.origin.y);
  return ChromeVertexOutput{to_device_position(unit_vertex, drawn, viewport_size), pixel};
}

fragment float4 chrome_fragment(ChromeVertexOutput input [[stage_in]],
                                constant ChromeComposite *composite [[buffer(1)]],
                                texture2d<float> source [[texture(0)]]) {
  float distance = quad_sdf(input.pixel, composite->bounds, composite->radii);
  float coverage = composite->edge > 0.0 ? saturate(-distance / composite->edge)
                                         : saturate(0.5 - distance);
  float4 color;
  if (composite->texel_for_texel != 0) {
    color = source.read(uint2(input.pixel - composite->source_origin));
  } else {
    constexpr sampler linear_sampler(mag_filter::linear, min_filter::linear,
                                     address::clamp_to_edge);
    Bounds_ScaledPixels drawn = composite->drawn;
    float2 uv = (input.pixel - float2(drawn.origin.x, drawn.origin.y)) /
                float2(drawn.size.width, drawn.size.height);
    color = source.sample(linear_sampler, uv);
  }
  return color * (composite->opacity * coverage);
}

// DeepBuild patch (windoliver/deepbuild#1434): a backdrop read at half or a quarter scale: each
// output pixel is the mean of the `step` × `step` block of the target under it.
struct ChromeDownsample {
  uint2 origin;
  uint step;
  uint pad;
};

vertex float4 chrome_fullscreen_vertex(uint vertex_id [[vertex_id]]) {
  float2 p = float2((vertex_id << 1) & 2, vertex_id & 2);
  return float4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
}

fragment float4 chrome_downsample_fragment(float4 position [[position]],
                                           constant ChromeDownsample *downsample [[buffer(0)]],
                                           texture2d<float> target [[texture(0)]]) {
  uint step = downsample->step;
  uint2 base = downsample->origin + uint2(position.xy) * step;
  uint2 last = uint2(target.get_width() - 1, target.get_height() - 1);
  float4 sum = float4(0.0);
  for (uint y = 0; y < step; y++) {
    for (uint x = 0; x < step; x++) {
      sum += target.read(min(base + uint2(x, y), last));
    }
  }
  return sum / float(step * step);
}

// DeepBuild patch (windoliver/deepbuild#499): a video frame's NV12 planes, Y and CbCr, converted
// to R'G'B' by the transform the pixel buffer's own tags give (its matrix and its range), not the
// stock fragment's full-range BT.601. The code values go out as they are, with no transfer step.
fragment float4 surface_ycbcr_fragment(SurfaceFragmentInput input [[stage_in]],
                                       texture2d<float> y_texture
                                       [[texture(SurfaceInputIndex_YTexture)]],
                                       texture2d<float> cb_cr_texture
                                       [[texture(SurfaceInputIndex_CbCrTexture)]],
                                       constant float4x4 *transform [[buffer(0)]]) {
  constexpr sampler texture_sampler(mag_filter::linear, min_filter::linear);
  float4 ycbcr = float4(
      y_texture.sample(texture_sampler, input.texture_position).r,
      cb_cr_texture.sample(texture_sampler, input.texture_position).rg, 1.0);
  float4 rgb = *transform * ycbcr;
  return float4(clamp(rgb.rgb, 0.0, 1.0), 1.0);
}
