//! The blend formulas (canvas primitives: Frame and group: blend modes): `B(Cb, Cs)` for every
//! mode by its place in [`MODES`], as WGSL for the GPU layer's composite and the `blend@1` step,
//! and in f64 for the step's evaluation and for compositing in linear light on the CPU. The W3C
//! modes follow the W3C Compositing and Blending formulas; the other eleven are this file's.

/// The WGSL of `blend_mix(mode, b, s)`.
pub const WGSL: &str = include_str!("blend.wgsl");

/// Every mode a group takes, in the order `blend_mix` numbers them.
pub const MODES: [&str; 28] = [
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color_dodge",
    "color_burn",
    "hard_light",
    "soft_light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
    "add",
    "subtract",
    "divide",
    "linear_burn",
    "linear_dodge",
    "linear_light",
    "vivid_light",
    "pin_light",
    "hard_mix",
    "darker_color",
    "lighter_color",
    "dissolve",
];

/// The number of the first of the eleven modes only the GPU layer draws.
pub const FIRST_GPU_ONLY: u32 = 17;

/// `mode`'s number.
pub fn index(mode: &str) -> Option<u32> {
    MODES.iter().position(|m| *m == mode).map(|i| i as u32)
}

/// The number of a mode the `blend@1` step takes: every mode but dissolve.
pub fn step_mode(mode: &str) -> Option<u32> {
    index(mode).filter(|_| mode != "dissolve")
}

fn lum(c: [f64; 3]) -> f64 {
    0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2]
}

fn clip(c: [f64; 3]) -> [f64; 3] {
    let l = lum(c);
    let (n, x) = (c[0].min(c[1]).min(c[2]), c[0].max(c[1]).max(c[2]));
    let mut out = c;
    if n < 0.0 {
        out = out.map(|v| l + (v - l) * l / (l - n));
    }
    if x > 1.0 {
        out = out.map(|v| l + (v - l) * (1.0 - l) / (x - l));
    }
    out
}

fn set_lum(c: [f64; 3], l: f64) -> [f64; 3] {
    let d = l - lum(c);
    clip(c.map(|v| v + d))
}

fn sat(c: [f64; 3]) -> f64 {
    c[0].max(c[1]).max(c[2]) - c[0].min(c[1]).min(c[2])
}

fn set_sat(c: [f64; 3], s: f64) -> [f64; 3] {
    let (lo, hi) = (c[0].min(c[1]).min(c[2]), c[0].max(c[1]).max(c[2]));
    if hi <= lo {
        return [0.0; 3];
    }
    c.map(|v| (v - lo) * s / (hi - lo))
}

fn hard(b: f64, s: f64) -> f64 {
    if s <= 0.5 {
        b * 2.0 * s
    } else {
        let t = 2.0 * s - 1.0;
        b + t - b * t
    }
}

fn dodge(b: f64, s: f64) -> f64 {
    if b == 0.0 {
        0.0
    } else if s >= 1.0 {
        1.0
    } else {
        (b / (1.0 - s)).min(1.0)
    }
}

fn burn(b: f64, s: f64) -> f64 {
    if b >= 1.0 {
        1.0
    } else if s <= 0.0 {
        0.0
    } else {
        1.0 - ((1.0 - b) / s).min(1.0)
    }
}

fn soft(b: f64, s: f64) -> f64 {
    if s <= 0.5 {
        b - (1.0 - 2.0 * s) * b * (1.0 - b)
    } else {
        let d = if b <= 0.25 {
            ((16.0 * b - 12.0) * b + 4.0) * b
        } else {
            b.sqrt()
        };
        b + (2.0 * s - 1.0) * (d - b)
    }
}

fn vivid(b: f64, s: f64) -> f64 {
    if s <= 0.5 {
        burn(b, 2.0 * s)
    } else {
        dodge(b, 2.0 * s - 1.0)
    }
}

fn divide(b: f64, s: f64) -> f64 {
    if s <= 0.0 {
        if b <= 0.0 {
            0.0
        } else {
            1.0
        }
    } else {
        (b / s).min(1.0)
    }
}

fn pin(b: f64, s: f64) -> f64 {
    if s <= 0.5 {
        b.min(2.0 * s)
    } else {
        b.max(2.0 * s - 1.0)
    }
}

/// `B(Cb, Cs)` of mode number `mode` on straight colors.
pub fn mix(mode: u32, b: [f64; 3], s: [f64; 3]) -> [f64; 3] {
    let each = |f: &dyn Fn(f64, f64) -> f64| [0, 1, 2].map(|i| f(b[i], s[i]));
    match mode {
        1 => each(&|b, s| b * s),
        2 => each(&|b, s| b + s - b * s),
        3 => each(&|b, s| hard(s, b)),
        4 => each(&f64::min),
        5 => each(&f64::max),
        6 => each(&dodge),
        7 => each(&burn),
        8 => each(&hard),
        9 => each(&soft),
        10 => each(&|b, s| (b - s).abs()),
        11 => each(&|b, s| b + s - 2.0 * b * s),
        12 => set_lum(set_sat(s, sat(b)), lum(b)),
        13 => set_lum(set_sat(b, sat(s)), lum(b)),
        14 => set_lum(s, lum(b)),
        15 => set_lum(b, lum(s)),
        16 | 20 => each(&|b, s| (b + s).min(1.0)),
        17 => each(&|b, s| (b - s).max(0.0)),
        18 => each(&divide),
        19 => each(&|b, s| (b + s - 1.0).max(0.0)),
        21 => each(&|b, s| (b + 2.0 * s - 1.0).clamp(0.0, 1.0)),
        22 => each(&vivid),
        23 => each(&pin),
        24 => each(&|b, s| if b + s >= 1.0 { 1.0 } else { 0.0 }),
        25 if lum(s) < lum(b) => s,
        26 if lum(s) > lum(b) => s,
        25 | 26 => b,
        _ => s,
    }
}
