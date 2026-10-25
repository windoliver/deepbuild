//! The CPU reference the conformance run checks the handoff against (README: The scene format):
//! a scene's frame computed byte for byte from the scene alone, and the checks the conformance
//! fixture makes of window captures. It shares no code with the GPU path.

use crate::scene::{Fill, Region, Scene};

fn paint(buf: &mut [u8], size: [u32; 2], region: &Region, n: u64) {
    let [w, h] = size.map(i64::from);
    let [rx, ry, rw, rh] = region.rect_at(n, size);
    let (x0, y0, x1, y1) = (rx.max(0), ry.max(0), (rx + rw).min(w), (ry + rh).min(h));
    for y in y0..y1 {
        for x in x0..x1 {
            let px: [u8; 4] = match region.fill {
                Fill::Color(c) => c,
                Fill::Ramp { step, bgra, alpha } => {
                    let v = ((x - rx) / i64::from(step)).min(255) as u8;
                    if bgra {
                        [v; 4]
                    } else {
                        [v, v, v, alpha]
                    }
                }
                Fill::Stamp {
                    bits,
                    cell,
                    one,
                    zero,
                } => {
                    let k = (x - rx) / i64::from(cell);
                    let value = n % (1u64 << bits);
                    if k < i64::from(bits) && (value >> (i64::from(bits) - 1 - k)) & 1 == 1 {
                        one
                    } else {
                        zero
                    }
                }
                Fill::Texture { .. } => {
                    let (tx, ty) = (x - rx, y - ry);
                    [
                        (tx & 255) as u8,
                        (ty & 255) as u8,
                        ((tx ^ ty) & 255) as u8,
                        255,
                    ]
                }
            };
            let o = ((y * w + x) * 4) as usize;
            buf[o..o + 4].copy_from_slice(&px);
        }
    }
}

/// Frame `n` of a scene of regions at `size`, as BGRA8 premultiplied rows with no padding.
pub fn frame(scene: &Scene, n: u64, size: [u32; 2]) -> Vec<u8> {
    let mut buf = Vec::with_capacity((size[0] * size[1] * 4) as usize);
    for _ in 0..size[0] * size[1] {
        buf.extend_from_slice(&scene.background);
    }
    for r in &scene.regions {
        paint(&mut buf, size, r, n);
    }
    buf
}

/// A window capture, RGBA rows.
pub struct Image<'a> {
    pub size: [u32; 2],
    pub rgba: &'a [u8],
}

impl Image<'_> {
    fn rgb(&self, x: u32, y: u32) -> [u8; 3] {
        let o = ((y * self.size[0] + x) * 4) as usize;
        [self.rgba[o], self.rgba[o + 1], self.rgba[o + 2]]
    }
}

/// Where the slot isn't opaque, the window must hold the f64 premultiplied over of the slot onto
/// the page, within one code value: the problems, by region.
pub fn over_problems(
    scene: &Scene,
    n: u64,
    size: [u32; 2],
    window: &Image,
    page: &Image,
) -> Vec<String> {
    let slot = frame(scene, n, size);
    let [vx, vy] = scene.view;
    let mut problems = Vec::new();
    for r in &scene.regions {
        let [rx, ry, rw, rh] = r.rect_at(n, size);
        let (mut off, mut total) = (0u64, 0u64);
        for y in ry.max(0)..(ry + rh).min(i64::from(size[1])) {
            for x in rx.max(0)..(rx + rw).min(i64::from(size[0])) {
                let o = ((y * i64::from(size[0]) + x) * 4) as usize;
                let a = slot[o + 3];
                if a == 255 {
                    continue;
                }
                total += 1;
                let (wx, wy) = (vx + x as u32, vy + y as u32);
                let (got, under) = (window.rgb(wx, wy), page.rgb(wx, wy));
                // The slot is BGRA; the capture RGB.
                let s = [slot[o + 2], slot[o + 1], slot[o]];
                let bad = (0..3).any(|c| {
                    let want = (f64::from(s[c]) + f64::from(under[c]) * (1. - f64::from(a) / 255.))
                        .min(255.);
                    (f64::from(got[c]) - want).abs() > 1.
                });
                off += u64::from(bad);
            }
        }
        if total > 0 && off > 0 {
            problems.push(format!(
                "{}: {off} of {total} pixels off the premultiplied over",
                r.name
            ));
        }
    }
    problems
}

/// Where frame `n`'s slot is opaque the window shows it exactly, and outside the view's rect at
/// that size it shows the page exactly; anything else is a stale or torn frame.
pub fn stale_problems(
    scene: &Scene,
    n: u64,
    size: [u32; 2],
    window: &Image,
    page: &Image,
) -> Vec<String> {
    let slot = frame(scene, n, size);
    let [vx, vy] = scene.view;
    let mut inside = 0u64;
    for y in 0..size[1] {
        for x in 0..size[0] {
            let o = ((y * size[0] + x) * 4) as usize;
            if slot[o + 3] != 255 {
                continue;
            }
            if window.rgb(vx + x, vy + y) != [slot[o + 2], slot[o + 1], slot[o]] {
                inside += 1;
            }
        }
    }
    let mut outside = 0u64;
    for y in 0..window.size[1] {
        for x in 0..window.size[0] {
            let within = x >= vx && x < vx + size[0] && y >= vy && y < vy + size[1];
            if !within && window.rgb(x, y) != page.rgb(x, y) {
                outside += 1;
            }
        }
    }
    let mut problems = Vec::new();
    if inside > 0 {
        problems.push(format!(
            "frame {n}: {inside} opaque slot pixels differ in the window"
        ));
    }
    if outside > 0 {
        problems.push(format!(
            "frame {n}: {outside} pixels outside the view differ from the page"
        ));
    }
    problems
}
