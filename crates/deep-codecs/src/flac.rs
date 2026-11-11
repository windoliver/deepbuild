//! #503: our own FLAC decoder (RFC 9639), for every FLAC file the worker reads: STREAMINFO, then
//! frames of CONSTANT, VERBATIM, FIXED and LPC subframes with wasted bits, Rice residuals and
//! stereo decorrelation. Samples are held in i64, so a 32-bit stream's 33-bit side channel
//! decodes exactly.

/// What STREAMINFO says of a stream.
pub struct Info {
    pub rate: u32,
    pub channels: u32,
    pub bits: u32,
    /// Frames (samples per channel) in the stream; 0 when it doesn't say.
    pub frames: u64,
}

/// STREAMINFO's 34-byte body.
pub fn info(b: &[u8]) -> Option<Info> {
    let v = u64::from_be_bytes(b.get(10..18)?.try_into().ok()?);
    Some(Info {
        rate: (v >> 44) as u32,
        channels: ((v >> 41) & 7) as u32 + 1,
        bits: ((v >> 36) & 31) as u32 + 1,
        frames: v & 0xf_ffff_ffff,
    })
}

/// A native FLAC file (after `fLaC`): its STREAMINFO body and the bytes of its frames.
pub fn native(data: &[u8]) -> Option<(&[u8], &[u8])> {
    let (mut at, mut streaminfo) = (4, None);
    loop {
        let head = data.get(at..at + 4)?;
        let len = usize::from(head[1]) << 16 | usize::from(head[2]) << 8 | usize::from(head[3]);
        if head[0] & 0x7f == 0 {
            streaminfo = data.get(at + 4..at + 4 + len);
        }
        at += 4 + len;
        if head[0] & 0x80 != 0 {
            return Some((streaminfo?, data.get(at..)?));
        }
    }
}

/// An MSB-first bit reader that answers `None` past the end.
struct Bits<'a> {
    b: &'a [u8],
    at: usize,
}

impl Bits<'_> {
    /// The next 64 bits from `at`, zeros past the end, and how many of them are the data's.
    fn peek(&self) -> (u64, usize) {
        let i = self.at / 8;
        let mut w = [0u8; 8];
        let end = (i + 8).min(self.b.len());
        w[..end.saturating_sub(i)].copy_from_slice(self.b.get(i..end).unwrap_or_default());
        (u64::from_be_bytes(w) << (self.at % 8), 64 - self.at % 8)
    }

    fn read(&mut self, n: u32) -> Option<u64> {
        if n == 0 {
            return Some(0);
        }
        if self.at + n as usize > self.b.len() * 8 {
            return None;
        }
        let v = if n <= 56 {
            self.peek().0 >> (64 - n)
        } else {
            let hi = self.read(n - 32)?;
            return Some(hi << 32 | self.read(32)?);
        };
        self.at += n as usize;
        Some(v)
    }

    fn signed(&mut self, n: u32) -> Option<i64> {
        let v = self.read(n)?;
        Some(if n == 0 {
            0
        } else {
            ((v << (64 - n)) as i64) >> (64 - n)
        })
    }

    /// The count of zeros before the next one.
    fn unary(&mut self) -> Option<u64> {
        let mut zeros = 0u64;
        loop {
            let (w, valid) = self.peek();
            let z = w.leading_zeros() as usize;
            if z < valid {
                if self.at + z + 1 > self.b.len() * 8 {
                    return None;
                }
                self.at += z + 1;
                return Some(zeros + z as u64);
            }
            if self.at + valid > self.b.len() * 8 {
                return None;
            }
            self.at += valid;
            zeros += valid as u64;
        }
    }
}

/// Every frame in `data` (one frame, or a native file's frames back to back), interleaved, as
/// integers at their depth. Decoding stops at bytes that don't start a frame.
pub fn decode(info: &Info, data: &[u8]) -> Result<Vec<i32>, String> {
    let mut out = Vec::new();
    let mut at = 0;
    while data
        .get(at..at + 2)
        .is_some_and(|s| s[0] == 0xff && s[1] & 0xfe == 0xf8)
    {
        at += frame(info, &data[at..], &mut out)
            .ok_or_else(|| format!("a FLAC frame at byte {at} doesn't decode"))?;
    }
    Ok(out)
}

/// One frame at `b`'s start, appended to `out`; its length in bytes.
fn frame(info: &Info, b: &[u8], out: &mut Vec<i32>) -> Option<usize> {
    let mut r = Bits { b, at: 16 };
    let (size, rate, assignment, depth) = (r.read(4)?, r.read(4)?, r.read(4)?, r.read(3)?);
    r.read(1)?;
    // The coded frame or sample number, UTF-8 style: its first byte's leading ones count it.
    let first = r.read(8)? as u8;
    r.read(8 * first.leading_ones().saturating_sub(1))?;
    let block = match size {
        1 => 192,
        2..=5 => 576 << (size - 2),
        6 => r.read(8)? + 1,
        7 => r.read(16)? + 1,
        8..=15 => 256 << (size - 8),
        _ => return None,
    } as usize;
    match rate {
        12 => r.read(8)?,
        13 | 14 => r.read(16)?,
        15 => return None,
        _ => 0,
    };
    r.read(8)?;
    let bits = match depth {
        0 => info.bits,
        1 => 8,
        2 => 12,
        4 => 16,
        5 => 20,
        6 => 24,
        7 => 32,
        _ => return None,
    };
    let channels = match assignment {
        0..=7 => assignment as usize + 1,
        8..=10 => 2,
        _ => return None,
    };
    // The side channel carries one bit more: the second of left/side and mid/side, the first
    // of side/right.
    let side = match assignment {
        8 | 10 => Some(1),
        9 => Some(0),
        _ => None,
    };
    let mut planes = Vec::with_capacity(channels);
    for c in 0..channels {
        planes.push(subframe(&mut r, block, bits + u32::from(side == Some(c)))?);
    }
    let (a, rest) = planes.split_at_mut(1);
    match assignment {
        8 => a[0]
            .iter()
            .zip(rest[0].iter_mut())
            .for_each(|(l, s)| *s = l - *s),
        9 => a[0]
            .iter_mut()
            .zip(rest[0].iter())
            .for_each(|(s, r)| *s += r),
        10 => a[0].iter_mut().zip(rest[0].iter_mut()).for_each(|(m, s)| {
            let mid = (*m << 1) | (*s & 1);
            (*m, *s) = ((mid + *s) >> 1, (mid - *s) >> 1);
        }),
        _ => {}
    }
    out.extend((0..block).flat_map(|i| planes.iter().map(move |p| p[i] as i32)));
    // Byte-aligned, then the frame's CRC-16.
    Some(r.at.div_ceil(8) + 2)
}

/// One subframe of `block` samples at `bits` bits.
fn subframe(r: &mut Bits, block: usize, bits: u32) -> Option<Vec<i64>> {
    if r.read(1)? != 0 {
        return None;
    }
    let kind = r.read(6)? as usize;
    let wasted = match r.read(1)? {
        1 => r.unary()? as u32 + 1,
        _ => 0,
    };
    let bits = bits.checked_sub(wasted)?;
    let mut s = Vec::with_capacity(block);
    match kind {
        0 => s.resize(block, r.signed(bits)?),
        1 => {
            for _ in 0..block {
                s.push(r.signed(bits)?);
            }
        }
        8..=12 => {
            let order = kind - 8;
            for _ in 0..order {
                s.push(r.signed(bits)?);
            }
            residual(r, block, order, &mut s)?;
            const FIXED: [&[i64]; 5] = [&[], &[1], &[2, -1], &[3, -3, 1], &[4, -6, 4, -1]];
            predict(&mut s, order, FIXED[order], 0);
        }
        32..=63 => {
            let order = kind - 31;
            for _ in 0..order {
                s.push(r.signed(bits)?);
            }
            let precision = r.read(4)? as u32 + 1;
            if precision == 16 {
                return None;
            }
            let shift = r.signed(5)?;
            let coefs: Vec<i64> = (0..order)
                .map(|_| r.signed(precision))
                .collect::<Option<_>>()?;
            residual(r, block, order, &mut s)?;
            predict(&mut s, order, &coefs, u32::try_from(shift).ok()?);
        }
        _ => return None,
    }
    if wasted > 0 {
        s.iter_mut().for_each(|v| *v <<= wasted);
    }
    Some(s)
}

/// Rice-coded residuals for the samples after the warm-up, appended to `s`.
fn residual(r: &mut Bits, block: usize, order: usize, s: &mut Vec<i64>) -> Option<()> {
    let param_bits = match r.read(2)? {
        0 => 4,
        1 => 5,
        _ => return None,
    };
    let partitions = r.read(4)? as u32;
    let per = block >> partitions;
    for p in 0..1usize << partitions {
        let count = if p == 0 { per.checked_sub(order)? } else { per };
        let k = r.read(param_bits)? as u32;
        if k == (1 << param_bits) - 1 {
            let raw = r.read(5)? as u32;
            for _ in 0..count {
                s.push(r.signed(raw)?);
            }
            continue;
        }
        for _ in 0..count {
            let u = r.unary()? << k | r.read(k)?;
            s.push((u >> 1) as i64 ^ -((u & 1) as i64));
        }
    }
    (s.len() == block).then_some(())
}

/// Adds each sample's prediction from the `order` before it (shifted right by `shift`) to its
/// residual.
fn predict(s: &mut [i64], order: usize, coefs: &[i64], shift: u32) {
    for i in order..s.len() {
        let p: i64 = coefs
            .iter()
            .enumerate()
            .map(|(j, c)| c * s[i - 1 - j])
            .sum();
        s[i] += p >> shift;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fields of the given widths, MSB first, padded to a byte.
    fn bits(fields: &[(u64, u32)]) -> Vec<u8> {
        let (mut out, mut acc, mut n) = (Vec::new(), 0u128, 0);
        for (v, w) in fields {
            acc = (acc << w) | (u128::from(*v) & ((1 << w) - 1));
            n += w;
            while n >= 8 {
                out.push((acc >> (n - 8)) as u8);
                n -= 8;
                acc &= (1 << n) - 1;
            }
        }
        if n > 0 {
            out.push((acc << (8 - n)) as u8);
        }
        out
    }

    #[test]
    fn a_32_bit_streams_33_bit_side_channel_decodes_exactly() {
        let (left, right) = ([i32::MIN, 5], [i32::MAX, -7]);
        let side = |k: usize| (i64::from(left[k]) - i64::from(right[k])) as u64;
        // A two-sample left/side frame of 32-bit VERBATIM subframes, the side one 33 bits.
        let head = [
            (0xfff8, 16),
            (6, 4),
            (0, 4),
            (8, 4),
            (7, 3),
            (0, 1),
            (0, 8),
            (1, 8),
            (0, 8),
        ];
        let left_sub = [
            (2, 8),
            (left[0] as u32 as u64, 32),
            (left[1] as u32 as u64, 32),
        ];
        let side_sub = [(2, 8), (side(0), 33), (side(1), 33)];
        let frame = [
            bits(&[&head[..], &left_sub, &side_sub].concat()),
            vec![0, 0],
        ]
        .concat();
        let info = Info {
            rate: 44_100,
            channels: 2,
            bits: 32,
            frames: 2,
        };
        assert_eq!(decode(&info, &frame), Ok(vec![i32::MIN, i32::MAX, 5, -7]));
    }
}
