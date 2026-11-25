//! Issue #3257: the mips of a map whose alpha is drawn. Color is the mean of the four texels above
//! weighted by their alpha, in linear light, so what a file stores under its transparent texels
//! never mixes into an edge. A blend keeps the box's mean alpha. A mask keeps, at each level, the
//! share of level 0 its cutoff keeps: averaged alpha isn't coverage at a cutoff. All of it is
//! integers and pinned libm, so every machine and the web player make the same bytes.

/// A whole share in fixed point: a power of 4, so the box's mean of shares is exact 15 levels down.
const ONE: u32 = 1 << 30;

/// Whether a texel of alpha `a` is kept at `cutoff`, as the shader compares them.
pub fn kept(a: u8, cutoff: f32) -> bool {
    f32::from(a) / 255.0 >= cutoff
}

/// The alphas a kept and a dropped texel store below level 0: the same distance either side of
/// the cutoff, as far apart as 0 and 1 allow, so a filtered fetch crosses it halfway between them.
fn alphas(cutoff: f32) -> [u8; 2] {
    let c = f64::from(cutoff).clamp(0.0, 1.0);
    let reach = c.min(1.0 - c);
    let code = |a: f64| (a * 255.0).round() as u8;
    let least = (0..=255).find(|a| kept(*a, cutoff)).unwrap_or(255);
    [
        code(c + reach).max(least),
        code(c - reach).min(least.saturating_sub(1)),
    ]
}

/// Which texels of a level `w` wide a mask keeps, each texel's `share` the part of the level-0
/// texels under it that are kept. Row by row, each the other way from the one above, a texel is
/// kept once its share and what was carried to it reach 3/8 of a texel and a quarter of its own
/// share; 13/16 of what is then over or owed goes to the texel after it in the walk, and 3/16 to
/// the one below the texel before it, so the count kept follows the shares everywhere. A texel over
/// nothing kept is never kept and one over nothing dropped never dropped; they pass it all on.
fn walk(share: &[u32], w: usize) -> Vec<bool> {
    const WHOLE: i64 = ONE as i64;
    let h = share.len() / w;
    let mut keep = vec![false; share.len()];
    // What is carried to each texel of this row, and of the one below.
    let (mut row, mut below) = (vec![0i64; w], vec![0i64; w]);
    for y in 0..h {
        let x = |i: usize| if y % 2 == 0 { i } else { w - 1 - i };
        for i in 0..w {
            let own = i64::from(share[y * w + x(i)]);
            let due = own + row[x(i)];
            let k = own == WHOLE || (own > 0 && due >= WHOLE * 3 / 8 + own / 4);
            keep[y * w + x(i)] = k;
            let left = due - if k { WHOLE } else { 0 };
            let behind = if y + 1 < h { (left * 3) >> 4 } else { 0 };
            below[x(i.saturating_sub(1))] += behind;
            match i + 1 < w {
                true => row[x(i + 1)] += left - behind,
                false => below[x(i)] += left - behind,
            }
        }
        std::mem::swap(&mut row, &mut below);
        below.fill(0);
    }
    keep
}

/// sRGB codes as 16-bit linear light, and back to the nearest code.
fn linear_light() -> ([u64; 256], Vec<u8>) {
    let linear = |code: f64| {
        let c = code / 255.0;
        let l = match c <= 0.04045 {
            true => c / 12.92,
            false => libm::pow((c + 0.055) / 1.055, 2.4),
        };
        l * 65_535.0
    };
    let mut codes = vec![0u8; 1 << 16];
    for code in 1..=255u8 {
        codes[linear(f64::from(code) - 0.5).ceil() as usize..].fill(code);
    }
    (
        std::array::from_fn(|c| linear(c as f64).round() as u64),
        codes,
    )
}

/// `top` (sRGB color and alpha) and every level below it, with the share of each that `cutoff`
/// keeps where a mask samples it. Edge texels repeat on an odd side, as in every chain.
pub fn chain([w, h]: [u32; 2], top: Vec<u8>, cutoff: Option<f32>) -> (Vec<u8>, Option<Vec<f32>>) {
    let (linear, codes) = linear_light();
    let texels = top.as_chunks::<4>().0;
    // What weighs each texel's color, its alpha: a mask's own, 16 bits below a code and rounded up,
    // never the two it stores. And the share of level 0 kept under each texel.
    let mut weight: Vec<u32> = texels.iter().map(|p| u32::from(p[3]) << 16).collect();
    let keeps = |p: &[u8; 4]| cutoff.is_some_and(|c| kept(p[3], c));
    let mut share: Vec<u32> = texels.iter().map(|p| ONE * u32::from(keeps(p))).collect();
    let part = |n: usize, of: usize| n as f32 / of as f32;
    let mut shares = vec![part(
        texels.iter().filter(|p| keeps(p)).count(),
        texels.len(),
    )];
    let mut data = top.clone();
    let (mut lw, mut lh, mut level) = (w as usize, h as usize, top);
    while lw > 1 || lh > 1 {
        let (nw, nh) = ((lw / 2).max(1), (lh / 2).max(1));
        // The four texels of the level above, under a texel of this one.
        let above = |i: usize| {
            let (x, y) = (2 * (i % nw), 2 * (i / nw));
            [(0, 0), (1, 0), (0, 1), (1, 1)]
                .map(|(dx, dy)| (y + dy).min(lh - 1) * lw + (x + dx).min(lw - 1))
        };
        let mut next = vec![0u8; nw * nh * 4];
        for (i, p) in next.as_chunks_mut::<4>().0.iter_mut().enumerate() {
            let four = above(i);
            let weights = four.map(|k| u64::from(weight[k]));
            let (weights, all) = match weights.iter().sum() {
                0 => ([1; 4], 4),
                all => (weights, all),
            };
            for (c, out) in p[..3].iter_mut().enumerate() {
                let of = |(k, w): (usize, u64)| w * linear[usize::from(level[k * 4 + c])];
                let sum: u64 = four.into_iter().zip(weights).map(of).sum();
                *out = codes[((sum + all / 2) / all) as usize];
            }
            let alpha = four.map(|k| f32::from(level[k * 4 + 3]) / 255.0);
            p[3] = (alpha.iter().sum::<f32>() / 4.0 * 255.0).round() as u8;
        }
        let mean = |of: &[u32], i: usize, up: u64| {
            let sum: u64 = above(i).iter().map(|k| u64::from(of[*k])).sum();
            ((sum + up) >> 2) as u32
        };
        match cutoff {
            Some(c) => {
                weight = (0..nw * nh).map(|i| mean(&weight, i, 3)).collect();
                share = (0..nw * nh).map(|i| mean(&share, i, 0)).collect();
                let [hi, lo] = alphas(c);
                let keep = walk(&share, nw);
                for (p, k) in next.as_chunks_mut::<4>().0.iter_mut().zip(&keep) {
                    p[3] = if *k { hi } else { lo };
                }
                shares.push(part(keep.iter().filter(|k| **k).count(), keep.len()));
            }
            None => {
                let texels = next.as_chunks::<4>().0;
                weight = texels.iter().map(|p| u32::from(p[3]) << 16).collect();
            }
        }
        data.extend_from_slice(&next);
        (lw, lh, level) = (nw, nh, next);
    }
    (data, cutoff.map(|_| shares))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A `n` × `n` map, opaque green on a one-texel line every 8 texels each way and transparent
    /// magenta between.
    fn fence(n: usize, at: [usize; 2]) -> Vec<u8> {
        let line = |v: usize, k: usize| v % 8 == at[k];
        (0..n * n)
            .flat_map(|i| match line(i % n, 0) || line(i / n, 1) {
                true => [40, 160, 60, 255],
                false => [255, 0, 255, 0],
            })
            .collect()
    }

    /// Each level of `data` as its side and its texels, largest first.
    fn levels(n: usize, data: &[u8]) -> Vec<(usize, &[[u8; 4]])> {
        let (mut side, mut rest, mut out) = (n, data.as_chunks::<4>().0, Vec::new());
        while !rest.is_empty() {
            let (level, more) = rest.split_at(side * side);
            out.push((side, level));
            (side, rest) = ((side / 2).max(1), more);
        }
        out
    }

    /// Wherever its lines lie, the fence's levels down to 16 texels keep its share whole and in
    /// each quadrant, and every kept texel is the line's own green.
    #[test]
    fn a_masks_levels_keep_their_coverage_in_place_and_their_own_color() {
        for at in (0..64).map(|k| [k % 8, k / 8]) {
            let (data, shares) = chain([256, 256], fence(256, at), Some(0.5));
            let shares = shares.unwrap();
            for (l, (side, level)) in levels(256, &data).into_iter().enumerate() {
                let on = |x: usize, y: usize| kept(level[y * side + x][3], 0.5);
                let all = (0..side * side).filter(|i| on(i % side, i / side)).count();
                assert_eq!(shares[l], all as f32 / (side * side) as f32);
                for p in level.iter().filter(|p| kept(p[3], 0.5)) {
                    assert_eq!(p[..3], [40, 160, 60], "{at:?} level {l}");
                }
                if (1..=4).contains(&l) {
                    assert!(
                        (f64::from(shares[l]) - 0.234_375).abs() < 0.01,
                        "{at:?} {l}"
                    );
                    let half = side / 2;
                    for q in 0..4 {
                        let [qx, qy] = [q % 2 * half, q / 2 * half];
                        let cells = (0..half * half).map(|i| (qx + i % half, qy + i / half));
                        let n = cells.filter(|(x, y)| on(*x, *y)).count() as f64;
                        let want = 0.234_375 * (half * half) as f64;
                        assert!((n - want).abs() <= 1.0, "{at:?} {l} {q}: {n} of {want}");
                    }
                }
            }
        }
    }

    #[test]
    fn the_two_alphas_sit_either_side_of_the_cutoff() {
        assert_eq!(alphas(0.5), [255, 0]);
        assert_eq!(alphas(0.3), [153, 0]);
        assert_eq!(alphas(0.75), [255, 128]);
        for k in 1..=1000u16 {
            let c = f32::from(k) / 1000.0;
            let [hi, lo] = alphas(c);
            assert!(kept(hi, c) && !kept(lo, c), "{c}: {hi} {lo}");
        }
    }

    /// A blend's levels keep the box's mean alpha, and their color is the opaque texels' alone.
    #[test]
    fn a_blends_color_is_weighted_by_its_alpha() {
        let (data, shares) = chain([256, 256], fence(256, [0, 0]), None);
        assert!(shares.is_none());
        let level = levels(256, &data)[1].1;
        assert_eq!(level[0], [40, 160, 60, 191]);
        assert_eq!(level[1], [40, 160, 60, 128]);
        assert_eq!(level[128 + 1], [255, 0, 255, 0]);
    }
}
