//! A stream's color as the probe reports it, and the written rule for what it isn't tagged with
//! (the #498 issue's Scope): an unspecified matrix, primaries, transfer or range is assumed BT.709
//! and limited range at heights of 720 and over and BT.601 below, and named in `assumed`. RGB
//! conversion uses the matrix and range the probe gives, tagged or assumed.

use serde_json::{json, Value};

/// The H.264 sequence parameter set's colour description: (primaries, transfer, matrix) when its
/// VUI carries one, and its full-range flag when it carries a video signal type.
pub struct Signal {
    pub description: Option<(u8, u8, u8)>,
    pub full_range: Option<bool>,
}

/// An Exp-Golomb bit reader over a NAL unit's payload, emulation prevention bytes removed.
struct Bits {
    data: Vec<u8>,
    at: usize,
}

impl Bits {
    fn new(nal: &[u8]) -> Bits {
        let mut data = Vec::with_capacity(nal.len());
        let mut zeros = 0;
        for &b in nal {
            if zeros >= 2 && b == 3 {
                zeros = 0;
                continue;
            }
            zeros = if b == 0 { zeros + 1 } else { 0 };
            data.push(b);
        }
        Bits { data, at: 0 }
    }
    fn bit(&mut self) -> Option<u32> {
        let byte = self.data.get(self.at / 8)?;
        let b = (byte >> (7 - self.at % 8)) & 1;
        self.at += 1;
        Some(b as u32)
    }
    fn bits(&mut self, n: u32) -> Option<u32> {
        (0..n).try_fold(0, |v, _| Some(v << 1 | self.bit()?))
    }
    fn ue(&mut self) -> Option<u32> {
        let mut zeros = 0;
        while self.bit()? == 0 {
            zeros += 1;
            if zeros > 31 {
                return None;
            }
        }
        Some((1u32 << zeros) - 1 + self.bits(zeros)?)
    }
    fn se(&mut self) -> Option<i32> {
        let k = self.ue()?;
        Some(if k & 1 == 1 {
            k.div_ceil(2) as i32
        } else {
            -((k / 2) as i32)
        })
    }
}

/// The first SPS of an `avcC` body.
pub fn avc_sps(avcc: &[u8]) -> Option<&[u8]> {
    let n = (*avcc.get(5)? & 0x1f) as usize;
    if n == 0 {
        return None;
    }
    let len = crate::mp4::be16(avcc.get(6..8)?) as usize;
    avcc.get(8..8 + len)
}

/// What an H.264 SPS (with its NAL header) says of its video signal.
pub fn h264_signal(sps: &[u8]) -> Option<Signal> {
    let mut b = Bits::new(sps.get(1..)?);
    let profile = b.bits(8)?;
    b.bits(16)?;
    b.ue()?;
    if matches!(
        profile,
        100 | 110 | 122 | 244 | 44 | 83 | 86 | 118 | 128 | 138 | 139 | 134 | 135
    ) {
        let chroma = b.ue()?;
        if chroma == 3 {
            b.bit()?;
        }
        b.ue()?;
        b.ue()?;
        b.bit()?;
        if b.bit()? == 1 {
            for i in 0..if chroma == 3 { 12 } else { 8 } {
                if b.bit()? == 1 {
                    let size = if i < 6 { 16 } else { 64 };
                    let (mut last, mut next) = (8i32, 8i32);
                    for _ in 0..size {
                        if next != 0 {
                            next = (last + b.se()? + 256) % 256;
                        }
                        last = if next == 0 { last } else { next };
                    }
                }
            }
        }
    }
    b.ue()?;
    match b.ue()? {
        0 => {
            b.ue()?;
        }
        1 => {
            b.bit()?;
            b.se()?;
            b.se()?;
            for _ in 0..b.ue()? {
                b.se()?;
            }
        }
        _ => {}
    }
    b.ue()?;
    b.bit()?;
    b.ue()?;
    b.ue()?;
    if b.bit()? == 0 {
        b.bit()?;
    }
    b.bit()?;
    if b.bit()? == 1 {
        for _ in 0..4 {
            b.ue()?;
        }
    }
    let mut signal = Signal {
        description: None,
        full_range: None,
    };
    if b.bit()? == 0 {
        return Some(signal);
    }
    if b.bit()? == 1 && b.bits(8)? == 255 {
        b.bits(32)?;
    }
    if b.bit()? == 1 {
        b.bit()?;
    }
    if b.bit()? == 1 {
        b.bits(3)?;
        signal.full_range = Some(b.bit()? == 1);
        if b.bit()? == 1 {
            signal.description = Some((b.bits(8)? as u8, b.bits(8)? as u8, b.bits(8)? as u8));
        }
    }
    Some(signal)
}

fn primaries(v: u16) -> Option<&'static str> {
    Some(match v {
        1 => "bt709",
        5 => "bt470bg",
        6 | 7 => "smpte170m",
        9 => "bt2020",
        12 => "p3",
        _ => return None,
    })
}

fn transfer(v: u16) -> Option<&'static str> {
    Some(match v {
        1 => "bt709",
        6 => "smpte170m",
        14 | 15 => "bt2020",
        13 => "srgb",
        16 => "pq",
        18 => "hlg",
        _ => return None,
    })
}

fn matrix(v: u16) -> Option<&'static str> {
    Some(match v {
        0 => "rgb",
        1 => "bt709",
        5 | 6 => "bt601",
        9 => "bt2020",
        _ => return None,
    })
}

/// The probe's `color` for a stream of `height` lines: each field as tagged, else as the rule
/// assumes it, named in `assumed`. With `bt601_always` (the planted wrong decoder) an untagged
/// matrix is BT.601 at every height.
pub fn describe(
    tags: (Option<u16>, Option<u16>, Option<u16>),
    full_range: Option<bool>,
    height: u32,
    bt601_always: bool,
) -> Value {
    let hd = height >= 720;
    let mut assumed = Vec::new();
    let mut pick = |name: &'static str, tagged: Option<&'static str>, rule: &'static str| {
        tagged.unwrap_or_else(|| {
            assumed.push(name);
            rule
        })
    };
    let rule = if hd { "bt709" } else { "bt601" };
    let p = pick("primaries", tags.0.and_then(primaries), rule);
    let t = pick("transfer", tags.1.and_then(transfer), rule);
    let m_rule = if bt601_always { "bt601" } else { rule };
    let m = pick("matrix", tags.2.and_then(matrix), m_rule);
    let r = pick(
        "range",
        full_range.map(|f| if f { "full" } else { "limited" }),
        "limited",
    );
    json!({"primaries": p, "transfer": t, "matrix": m, "range": r, "assumed": assumed})
}

/// 8-bit 4:2:0 planes (Y, then Cb, then Cr) to BGRA8 by `matrix` and `range` as the probe names
/// them; chroma is sampled at the nearest site.
pub fn i420_to_bgra(planes: &[u8], w: usize, h: usize, matrix: &str, range: &str) -> Vec<u8> {
    let (kr, kb) = match matrix {
        "bt601" => (0.299, 0.114),
        "bt2020" => (0.2627, 0.0593),
        _ => (0.2126, 0.0722),
    };
    let (y0, ys, cs) = match range {
        "full" => (0.0, 255.0, 255.0),
        _ => (16.0, 219.0, 224.0),
    };
    let (cw, ch) = (w.div_ceil(2), h.div_ceil(2));
    let (yp, rest) = planes.split_at(w * h);
    let (up, vp) = rest.split_at(cw * ch);
    let mut out = vec![0u8; w * h * 4];
    let q = |v: f64| (v * 255.0).round().clamp(0.0, 255.0) as u8;
    for row in 0..h {
        for col in 0..w {
            let y = (yp[row * w + col] as f64 - y0) / ys;
            let c = (row / 2) * cw + col / 2;
            let cb = (up[c] as f64 - 128.0) / cs;
            let cr = (vp[c] as f64 - 128.0) / cs;
            let r = y + 2.0 * (1.0 - kr) * cr;
            let b = y + 2.0 * (1.0 - kb) * cb;
            let g = (y - kr * r - kb * b) / (1.0 - kr - kb);
            let o = (row * w + col) * 4;
            out[o..o + 4].copy_from_slice(&[q(b), q(g), q(r), 255]);
        }
    }
    out
}
