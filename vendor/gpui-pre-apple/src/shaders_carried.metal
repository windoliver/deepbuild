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
