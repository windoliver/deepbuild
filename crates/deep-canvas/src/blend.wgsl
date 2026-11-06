// The blend formulas (canvas primitives: Frame and group: blend modes), the WGSL `blend::mix`
// matches: `blend_mix(mode, b, s)` is B(Cb, Cs) on straight colors, `mode` an index of `MODES`.

fn blend_lum(c: vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.3, 0.59, 0.11));
}

fn blend_clip(c: vec3<f32>) -> vec3<f32> {
    let l = blend_lum(c);
    let n = min(c.x, min(c.y, c.z));
    let x = max(c.x, max(c.y, c.z));
    var out = c;
    if (n < 0.0) {
        out = vec3<f32>(l) + (out - vec3<f32>(l)) * l / (l - n);
    }
    if (x > 1.0) {
        out = vec3<f32>(l) + (out - vec3<f32>(l)) * (1.0 - l) / (x - l);
    }
    return out;
}

fn blend_set_lum(c: vec3<f32>, l: f32) -> vec3<f32> {
    return blend_clip(c + vec3<f32>(l - blend_lum(c)));
}

fn blend_sat(c: vec3<f32>) -> f32 {
    return max(c.x, max(c.y, c.z)) - min(c.x, min(c.y, c.z));
}

fn blend_set_sat(c: vec3<f32>, s: f32) -> vec3<f32> {
    let lo = min(c.x, min(c.y, c.z));
    let hi = max(c.x, max(c.y, c.z));
    if (hi <= lo) {
        return vec3<f32>(0.0);
    }
    return (c - vec3<f32>(lo)) * s / (hi - lo);
}

fn blend_hard(b: f32, s: f32) -> f32 {
    if (s <= 0.5) {
        return b * 2.0 * s;
    }
    let t = 2.0 * s - 1.0;
    return b + t - b * t;
}

fn blend_dodge(b: f32, s: f32) -> f32 {
    if (b == 0.0) {
        return 0.0;
    }
    if (s >= 1.0) {
        return 1.0;
    }
    return min(b / (1.0 - s), 1.0);
}

fn blend_burn(b: f32, s: f32) -> f32 {
    if (b >= 1.0) {
        return 1.0;
    }
    if (s <= 0.0) {
        return 0.0;
    }
    return 1.0 - min((1.0 - b) / s, 1.0);
}

fn blend_soft(b: f32, s: f32) -> f32 {
    if (s <= 0.5) {
        return b - (1.0 - 2.0 * s) * b * (1.0 - b);
    }
    var d = sqrt(b);
    if (b <= 0.25) {
        d = ((16.0 * b - 12.0) * b + 4.0) * b;
    }
    return b + (2.0 * s - 1.0) * (d - b);
}

fn blend_vivid(b: f32, s: f32) -> f32 {
    if (s <= 0.5) {
        return blend_burn(b, 2.0 * s);
    }
    return blend_dodge(b, 2.0 * s - 1.0);
}

fn blend_divide(b: f32, s: f32) -> f32 {
    if (s <= 0.0) {
        return select(1.0, 0.0, b <= 0.0);
    }
    return min(b / s, 1.0);
}

fn blend_pin(b: f32, s: f32) -> f32 {
    if (s <= 0.5) {
        return min(b, 2.0 * s);
    }
    return max(b, 2.0 * s - 1.0);
}

// One channel of the separable modes.
fn blend_one(mode: u32, b: f32, s: f32) -> f32 {
    switch mode {
        case 1u: { return b * s; }
        case 2u: { return b + s - b * s; }
        case 3u: { return blend_hard(s, b); }
        case 4u: { return min(b, s); }
        case 5u: { return max(b, s); }
        case 6u: { return blend_dodge(b, s); }
        case 7u: { return blend_burn(b, s); }
        case 8u: { return blend_hard(b, s); }
        case 9u: { return blend_soft(b, s); }
        case 10u: { return abs(b - s); }
        case 11u: { return b + s - 2.0 * b * s; }
        case 16u, 20u: { return min(b + s, 1.0); }
        case 17u: { return max(b - s, 0.0); }
        case 18u: { return blend_divide(b, s); }
        case 19u: { return max(b + s - 1.0, 0.0); }
        case 21u: { return clamp(b + 2.0 * s - 1.0, 0.0, 1.0); }
        case 22u: { return blend_vivid(b, s); }
        case 23u: { return blend_pin(b, s); }
        case 24u: { return select(0.0, 1.0, b + s >= 1.0); }
        default: { return s; }
    }
}

fn blend_mix(mode: u32, b: vec3<f32>, s: vec3<f32>) -> vec3<f32> {
    switch mode {
        case 12u: { return blend_set_lum(blend_set_sat(s, blend_sat(b)), blend_lum(b)); }
        case 13u: { return blend_set_lum(blend_set_sat(b, blend_sat(s)), blend_lum(b)); }
        case 14u: { return blend_set_lum(s, blend_lum(b)); }
        case 15u: { return blend_set_lum(b, blend_lum(s)); }
        case 25u: { return select(b, s, blend_lum(s) < blend_lum(b)); }
        case 26u: { return select(b, s, blend_lum(s) > blend_lum(b)); }
        default: {
            return vec3<f32>(blend_one(mode, b.x, s.x), blend_one(mode, b.y, s.y), blend_one(mode, b.z, s.z));
        }
    }
}
