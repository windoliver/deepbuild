//! Our own FLAC reader (#154; canvas primitives: Decode worker, "FLAC and Opus always decode
//! through our own decoders"): every subframe type (constant, verbatim, fixed and LPC
//! predictors), the stereo decorrelation modes and wasted bits, to f32 as sample ÷ 2^(depth − 1).
//! A score stem's loop region rides in its Vorbis comment as `LOOPSTART` and `LOOPLENGTH` in
//! samples, and is read as the asset's loop points.

pub struct Flac {
    pub rate: u32,
    pub channels: u16,
    /// Frames (samples per channel).
    pub frames: u64,
    /// `(start, end)` in samples, from the Vorbis comment.
    pub loop_region: Option<(u64, u64)>,
    /// Every sample, interleaved.
    pub samples: Vec<f32>,
}

struct Bits<'a> {
    b: &'a [u8],
    pos: usize,
}

impl Bits<'_> {
    fn get(&mut self, n: u32) -> Option<u64> {
        let mut v = 0u64;
        for _ in 0..n {
            let byte = *self.b.get(self.pos >> 3)?;
            v = (v << 1) | u64::from((byte >> (7 - (self.pos & 7))) & 1);
            self.pos += 1;
        }
        Some(v)
    }
    fn signed(&mut self, n: u32) -> Option<i64> {
        if n == 0 {
            return Some(0);
        }
        let v = self.get(n)? as i64;
        Some(if v >= 1 << (n - 1) { v - (1 << n) } else { v })
    }
    fn unary(&mut self) -> Option<u64> {
        let mut q = 0;
        while self.get(1)? == 0 {
            q += 1;
        }
        Some(q)
    }
    fn align(&mut self) {
        self.pos = (self.pos + 7) & !7;
    }
}

fn residual(r: &mut Bits, n: usize, order: usize, out: &mut [i64]) -> Option<()> {
    let method = r.get(2)?;
    let (pbits, escape) = if method == 1 { (5, 31) } else { (4, 15) };
    let parts = 1usize << r.get(4)?;
    let mut at = order;
    for k in 0..parts {
        let count = if k == 0 {
            (n / parts).checked_sub(order)?
        } else {
            n / parts
        };
        let param = r.get(pbits)? as u32;
        if param == escape {
            let bits = r.get(5)? as u32;
            for _ in 0..count {
                *out.get_mut(at)? = r.signed(bits)?;
                at += 1;
            }
        } else {
            for _ in 0..count {
                let u = (r.unary()? << param) | r.get(param)?;
                *out.get_mut(at)? = if u & 1 == 1 {
                    -((u >> 1) as i64) - 1
                } else {
                    (u >> 1) as i64
                };
                at += 1;
            }
        }
    }
    Some(())
}

fn subframe(r: &mut Bits, n: usize, bps: u32) -> Option<Vec<i64>> {
    r.get(1)?;
    let kind = r.get(6)? as usize;
    let mut wasted = 0;
    if r.get(1)? == 1 {
        wasted = 1;
        while r.get(1)? == 0 {
            wasted += 1;
        }
    }
    let b = bps.checked_sub(wasted)?;
    let mut x = vec![0i64; n];
    match kind {
        0 => {
            let v = r.signed(b)?;
            x.fill(v);
        }
        1 => {
            for v in x.iter_mut() {
                *v = r.signed(b)?;
            }
        }
        8..=12 => {
            let order = kind - 8;
            for v in x.iter_mut().take(order) {
                *v = r.signed(b)?;
            }
            residual(r, n, order, &mut x)?;
            let c: &[i64] = [&[][..], &[1], &[2, -1], &[3, -3, 1], &[4, -6, 4, -1]][order];
            for i in order..n {
                let p: i64 = c.iter().enumerate().map(|(j, k)| k * x[i - 1 - j]).sum();
                x[i] += p;
            }
        }
        32..=63 => {
            let order = kind - 31;
            for v in x.iter_mut().take(order) {
                *v = r.signed(b)?;
            }
            let precision = r.get(4)? as u32 + 1;
            let shift = r.signed(5)?;
            let coef = (0..order)
                .map(|_| r.signed(precision))
                .collect::<Option<Vec<_>>>()?;
            residual(r, n, order, &mut x)?;
            for i in order..n {
                let p: i64 = coef.iter().enumerate().map(|(j, k)| k * x[i - 1 - j]).sum();
                x[i] += if shift >= 0 { p >> shift } else { p << -shift };
            }
        }
        _ => return None,
    }
    if wasted > 0 {
        x.iter_mut().for_each(|v| *v <<= wasted);
    }
    Some(x)
}

/// The `KEY=value` comments of a Vorbis comment block's body, keys upper-cased.
fn comments(b: &[u8]) -> Vec<(String, String)> {
    let le = |p: usize| Some(u32::from_le_bytes(b.get(p..p + 4)?.try_into().ok()?) as usize);
    let mut out = Vec::new();
    let Some(vendor) = le(0) else { return out };
    let mut p = 4 + vendor;
    let Some(count) = le(p) else { return out };
    p += 4;
    for _ in 0..count {
        let Some(len) = le(p) else { break };
        p += 4;
        let Some(text) = b.get(p..p + len).and_then(|t| std::str::from_utf8(t).ok()) else {
            break;
        };
        p += len;
        if let Some((k, v)) = text.split_once('=') {
            out.push((k.to_ascii_uppercase(), v.to_string()));
        }
    }
    out
}

pub fn parse(b: &[u8]) -> Option<Flac> {
    if !b.starts_with(b"fLaC") {
        return None;
    }
    let mut at = 4;
    let (mut rate, mut nch, mut bps, mut total) = (0u32, 0usize, 0u32, 0u64);
    let mut tags = Vec::new();
    loop {
        let head = *b.get(at)?;
        let len =
            u32::from_be_bytes([0, *b.get(at + 1)?, *b.get(at + 2)?, *b.get(at + 3)?]) as usize;
        let body = at + 4;
        match head & 0x7f {
            0 => {
                let mut r = Bits {
                    b,
                    pos: (body + 10) * 8,
                };
                rate = r.get(20)? as u32;
                nch = r.get(3)? as usize + 1;
                bps = r.get(5)? as u32 + 1;
                total = r.get(36)?;
            }
            4 => tags = comments(b.get(body..body + len)?),
            _ => {}
        }
        at = body + len;
        if head & 0x80 != 0 {
            break;
        }
    }
    if rate == 0 || bps > 32 {
        return None;
    }
    let mut chans: Vec<Vec<i64>> = vec![Vec::with_capacity(total as usize); nch];
    while (chans[0].len() as u64) < total && at < b.len() {
        let mut r = Bits { b, pos: at * 8 };
        if r.get(14)? != 0x3ffe {
            return None;
        }
        r.get(2)?;
        let bs = r.get(4)?;
        let rc = r.get(4)?;
        let cc = r.get(4)? as usize;
        let sc = r.get(3)? as usize;
        r.get(1)?;
        let mut lead = r.get(8)? as u8;
        while lead & 0x80 != 0 {
            lead <<= 1;
            if lead & 0x80 != 0 {
                r.get(8)?;
            }
        }
        let n = match bs {
            1 => 192,
            2..=5 => 576 << (bs - 2),
            6 => r.get(8)? as usize + 1,
            7 => r.get(16)? as usize + 1,
            8..=15 => 256 << (bs - 8),
            _ => return None,
        };
        match rc {
            12 => {
                r.get(8)?;
            }
            13 | 14 => {
                r.get(16)?;
            }
            _ => {}
        }
        r.get(8)?;
        let fbps = [bps, 8, 12, 0, 16, 20, 24, 32][sc];
        let fbps = if fbps == 0 { bps } else { fbps };
        let channels = if cc >= 8 { 2 } else { cc + 1 };
        if channels != nch {
            return None;
        }
        let mut subs = Vec::with_capacity(nch);
        for c in 0..nch {
            let extra =
                u32::from((cc == 8 && c == 1) || (cc == 9 && c == 0) || (cc == 10 && c == 1));
            subs.push(subframe(&mut r, n, fbps + extra)?);
        }
        match cc {
            8 => (0..n).for_each(|i| subs[1][i] = subs[0][i] - subs[1][i]),
            9 => (0..n).for_each(|i| subs[0][i] += subs[1][i]),
            10 => (0..n).for_each(|i| {
                let s = subs[1][i];
                let m = (subs[0][i] << 1) | (s & 1);
                subs[0][i] = (m + s) >> 1;
                subs[1][i] = (m - s) >> 1;
            }),
            _ => {}
        }
        let keep = n.min((total - chans[0].len() as u64) as usize);
        for (c, s) in subs.into_iter().enumerate() {
            chans[c].extend_from_slice(&s[..keep]);
        }
        r.align();
        r.get(16)?;
        at = r.pos / 8;
    }
    let frames = chans[0].len();
    let scale = (1u64 << (bps - 1)) as f32;
    let mut samples = Vec::with_capacity(frames * nch);
    for i in 0..frames {
        for ch in &chans {
            samples.push(ch[i] as f32 / scale);
        }
    }
    let tag = |k: &str| {
        tags.iter()
            .find(|(key, _)| key == k)
            .and_then(|(_, v)| v.trim().parse::<u64>().ok())
    };
    let loop_region = match (tag("LOOPSTART"), tag("LOOPLENGTH")) {
        (Some(s), Some(l)) if l > 0 => Some((s, s + l)),
        _ => None,
    };
    Some(Flac {
        rate,
        channels: nch as u16,
        frames: frames as u64,
        loop_region,
        samples,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A stereo 24-bit file the score renderer's encoder wrote: three samples a channel, the
    /// left one fixed-predicted, the right one constant, with a loop region of [1, 3).
    #[test]
    fn reads_samples_and_loop_points() {
        let file = include_bytes!("flac_fixture.flac");
        let f = parse(file).expect("a FLAC file");
        assert_eq!((f.rate, f.channels, f.frames), (48_000, 2, 3));
        assert_eq!(f.loop_region, Some((1, 3)));
        let s = 8_388_608.0;
        assert_eq!(
            f.samples,
            vec![
                1.0 / s,
                -5.0 / s,
                -8_388_608.0 / s,
                -5.0 / s,
                8_388_607.0 / s,
                -5.0 / s
            ]
        );
    }
}
