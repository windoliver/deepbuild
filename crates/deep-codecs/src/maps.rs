//! Issue #423: a material's texture maps, made ready for the GPU in the decode worker (canvas
//! primitives: Material: texture maps). A KTX2 map (Basis Universal ETC1S or UASTC) is transcoded
//! once to a block format the GPU samples directly, chosen by the map's role, never the file's
//! tag: base color and emission to BC7 in sRGB, a normal map to BC5, a single-channel map to BC4,
//! other data maps to linear BC7; RGBA8 where the adapter has no BC, or where the map's size isn't
//! whole 4 × 4 blocks or it lacks its full mip chain. A PNG or JPEG map decodes to RGBA8 with its
//! mips made here, base color and emission filtered in linear light. Every map is kept by the hash
//! of its source, its format and the transcoder's version, so a second load transcodes nothing.

use serde_json::{json, Value};

/// The transcoder a block map's key names.
pub const TRANSCODER: &str = "basisu_c_sys 0.9.1";

/// What a map is for: its role decides its format and how its texels decode.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Role {
    /// Base color and emission: sRGB.
    Color,
    /// A tangent-space normal map: two channels, z rebuilt in shading.
    Normal,
    /// One channel, such as an occlusion map of its own.
    Single,
    /// Every other data map (metallic-roughness, ORM): linear.
    Data,
}

impl Role {
    pub fn read(word: &str) -> Option<Role> {
        Some(match word {
            "base_color" | "emission" | "color" => Role::Color,
            "normal" | "normal_map" => Role::Normal,
            "single" | "occlusion" => Role::Single,
            "metallic_roughness" | "data" | "orm" => Role::Data,
            _ => return None,
        })
    }
}

/// A map ready to upload: its format's name (as wgpu spells it), size, mip count and every mip's
/// texels end to end, largest first.
pub struct Ready {
    pub format: &'static str,
    pub size: [u32; 2],
    pub mips: u32,
    pub data: Vec<u8>,
}

impl Ready {
    /// The bytes the device holds.
    pub fn bytes(&self) -> u64 {
        self.data.len() as u64
    }

    pub fn json(&self) -> Value {
        json!({"format": self.format, "size": self.size, "mips": self.mips, "bytes": self.bytes()})
    }
}

/// A full chain's mip count for a `w` × `h` map.
pub fn full_chain(w: u32, h: u32) -> u32 {
    32 - w.max(h).max(1).leading_zeros()
}

/// Whether `data` is a KTX2 container.
pub fn is_ktx2(data: &[u8]) -> bool {
    data.starts_with(&[
        0xAB, b'K', b'T', b'X', b' ', b'2', b'0', 0xBB, b'\r', b'\n', 0x1A, b'\n',
    ])
}

/// `data` made ready for role `role` on an adapter that has BC formats (`bc`) or not; a PNG or
/// JPEG decodes as stored, whatever gamma or ICC profile it carries, except under the planted
/// `gamma` that applies a PNG's gAMA (#423 AC4's wrong program).
pub fn ready(data: &[u8], role: Role, bc: bool, gamma: bool) -> Result<Ready, String> {
    if is_ktx2(data) {
        return transcode(data, role, bc);
    }
    let img = image::load_from_memory(data)
        .map_err(|e| format!("an unreadable image: {e}"))?
        .into_rgba8();
    let (w, h) = img.dimensions();
    let mut px = img.into_raw();
    if let Some(g) = gamma.then(|| png_gamma(data)).flatten() {
        // The planted decoder's display correction: stored^(1 ÷ (gAMA × 2.2)).
        let e = 1.0 / (g * 2.2);
        for p in px.as_chunks_mut::<4>().0 {
            for c in &mut p[..3] {
                *c = ((f64::from(*c) / 255.0).powf(e) * 255.0).round() as u8;
            }
        }
    }
    Ok(rgba8(w, h, px, role == Role::Color))
}

/// A PNG's gAMA value, if it has one.
fn png_gamma(data: &[u8]) -> Option<f64> {
    let mut at = 8;
    while at + 12 <= data.len() {
        let len = u32::from_be_bytes(data[at..at + 4].try_into().ok()?) as usize;
        if &data[at + 4..at + 8] == b"gAMA" && len == 4 {
            let v = u32::from_be_bytes(data[at + 8..at + 12].try_into().ok()?);
            return Some(f64::from(v) / 100_000.0);
        }
        at += 12 + len;
    }
    None
}

fn transcode(data: &[u8], role: Role, bc: bool) -> Result<Ready, String> {
    use basisu_c_sys::extra::{
        basisu_transcoder_init, BasisuTranscoder, ChannelType, SupportedTextureCompression,
    };
    use basisu_c_sys::TranscodeTargetFormat as T;
    basisu_transcoder_init();
    let t = BasisuTranscoder::new(data, SupportedTextureCompression::all(), ChannelType::Auto)
        .map_err(|e| format!("a KTX2 the transcoder can't read: {e}"))?;
    let info = t.get_info();
    let blocks = info.width % 4 == 0 && info.height % 4 == 0;
    let chain = info.levels == full_chain(info.width, info.height);
    let srgb = role == Role::Color;
    if !(bc && blocks && chain) {
        let img = t
            .transcode(Some(T::RGBA32), Some(false))
            .map_err(|e| format!("a KTX2 the transcoder can't read: {e}"))?;
        // Its top level alone; the mips are made here, as for a PNG.
        let top = (info.width * info.height * 4) as usize;
        let mut px = img.data;
        px.truncate(top);
        return Ok(rgba8(info.width, info.height, px, srgb));
    }
    let (target, format) = match role {
        Role::Color => (T::Bc7Rgba, "bc7-rgba-unorm-srgb"),
        Role::Normal => (T::Bc5Rg, "bc5-rg-unorm"),
        Role::Single => (T::Bc4R, "bc4-r-unorm"),
        Role::Data => (T::Bc7Rgba, "bc7-rgba-unorm"),
    };
    // Basis Universal's BC5 takes x from red and y from alpha, its own normal-map layout (UASTC's
    // RRRG, or ETC1S with an alpha slice). A normal map that keeps y in green, as its data format
    // descriptor says, is decoded and its red and green encoded as BC5 here.
    if role == Role::Normal && !xy_in_red_alpha(data) {
        let img = t
            .transcode(Some(T::RGBA32), Some(false))
            .map_err(|e| format!("a KTX2 the transcoder can't read: {e}"))?;
        let mut out = Vec::new();
        let mut at = 0;
        for level in 0..info.levels {
            let (w, h) = ((info.width >> level).max(1), (info.height >> level).max(1));
            let len = (w * h * 4) as usize;
            let px = img
                .data
                .get(at..at + len)
                .ok_or("a KTX2 level past its data")?;
            bc5(px, w, h, &mut out);
            at += len;
        }
        return Ok(Ready {
            format,
            size: [info.width, info.height],
            mips: info.levels,
            data: out,
        });
    }
    let img = t
        .transcode(Some(target), Some(srgb))
        .map_err(|e| format!("a KTX2 the transcoder can't read: {e}"))?;
    Ok(Ready {
        format,
        size: [info.width, info.height],
        mips: info.levels,
        data: img.data,
    })
}

/// Whether a KTX2's data format descriptor puts a two-channel map's y in alpha: UASTC whose
/// first sample is RRRG, or ETC1S with a second (alpha) slice.
fn xy_in_red_alpha(data: &[u8]) -> bool {
    let u32_at = |at: usize| {
        data.get(at..at + 4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
    };
    let Some(dfd) = u32_at(48).map(|d| d as usize) else {
        return false;
    };
    let model = data.get(dfd + 12).copied();
    let channel = |k: usize| data.get(dfd + 28 + 16 * k + 3).map(|c| c & 15);
    match model {
        Some(166) => channel(0) == Some(5),
        Some(163) => channel(1) == Some(15),
        _ => false,
    }
}

/// One BC4 block of 16 values: its two endpoints and 3-bit indices into the 8 values between
/// them, each value's nearest.
fn bc4(v: &[u8; 16], out: &mut Vec<u8>) {
    let (hi, lo) = (*v.iter().max().unwrap(), *v.iter().min().unwrap());
    let palette: Vec<f32> = (0..8)
        .map(|i| match i {
            0 => f32::from(hi),
            1 => f32::from(lo),
            i => ((8 - i) as f32 * f32::from(hi) + (i - 1) as f32 * f32::from(lo)) / 7.0,
        })
        .collect();
    let mut bits = 0u64;
    for (k, x) in v.iter().enumerate() {
        let best = if hi == lo {
            0
        } else {
            (0..8)
                .min_by(|a, b| {
                    (palette[*a] - f32::from(*x))
                        .abs()
                        .total_cmp(&(palette[*b] - f32::from(*x)).abs())
                })
                .unwrap()
        };
        bits |= (best as u64) << (3 * k);
    }
    out.push(hi);
    out.push(lo);
    out.extend_from_slice(&bits.to_le_bytes()[..6]);
}

/// RGBA8 texels' red and green as BC5 blocks, edge texels repeated to fill a block.
fn bc5(px: &[u8], w: u32, h: u32, out: &mut Vec<u8>) {
    for by in 0..h.div_ceil(4) {
        for bx in 0..w.div_ceil(4) {
            for c in 0..2 {
                let v: [u8; 16] = std::array::from_fn(|k| {
                    let x = (bx * 4 + k as u32 % 4).min(w - 1);
                    let y = (by * 4 + k as u32 / 4).min(h - 1);
                    px[((y * w + x) * 4) as usize + c]
                });
                bc4(&v, out);
            }
        }
    }
}

fn to_linear(c: u8) -> f32 {
    let c = f32::from(c) / 255.0;
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn from_linear(c: f32) -> u8 {
    let c = if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    };
    (c * 255.0).round().clamp(0.0, 255.0) as u8
}

/// RGBA8 texels with their full mip chain, each level a 2 × 2 box of the one above (edge texels
/// repeated on an odd side); an sRGB map's color channels averaged in linear light.
fn rgba8(w: u32, h: u32, top: Vec<u8>, srgb: bool) -> Ready {
    let mips = full_chain(w, h);
    let mut data = top.clone();
    let (mut lw, mut lh, mut level) = (w, h, top);
    for _ in 1..mips {
        let (nw, nh) = ((lw / 2).max(1), (lh / 2).max(1));
        let mut next = vec![0u8; (nw * nh * 4) as usize];
        for y in 0..nh {
            for x in 0..nw {
                for c in 0..4 {
                    let mut sum = 0.0;
                    for (dx, dy) in [(0, 0), (1, 0), (0, 1), (1, 1)] {
                        let sx = (2 * x + dx).min(lw - 1);
                        let sy = (2 * y + dy).min(lh - 1);
                        let v = level[((sy * lw + sx) * 4 + c) as usize];
                        sum += if srgb && c < 3 {
                            to_linear(v)
                        } else {
                            f32::from(v) / 255.0
                        };
                    }
                    let avg = sum / 4.0;
                    next[((y * nw + x) * 4 + c) as usize] = if srgb && c < 3 {
                        from_linear(avg)
                    } else {
                        (avg * 255.0).round() as u8
                    };
                }
            }
        }
        data.extend_from_slice(&next);
        (lw, lh, level) = (nw, nh, next);
    }
    Ready {
        format: if srgb {
            "rgba8unorm-srgb"
        } else {
            "rgba8unorm"
        },
        size: [w, h],
        mips,
        data,
    }
}
