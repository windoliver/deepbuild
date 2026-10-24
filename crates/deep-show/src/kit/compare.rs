//! Two images judged under a tolerance class (issue #138; technical design: the parity suite):
//! within N code values on P% of pixels, a ceiling no pixel may pass, and a bound on the pixels
//! off in any small window, so a small defect in one place, such as a wrong status dot or a
//! missing glyph, can't hide inside the share. A pixel is off when any channel differs by more
//! than `within`. (Skia Gold's fuzzy and sample-area matchers check the same two bounds.)

use std::path::Path;

use serde_json::{json, Value};

use crate::hub::{Hub, Planted};

/// A tolerance class.
#[derive(Clone, Copy, Debug)]
pub struct Tolerance {
    pub within: u8,
    /// The share of pixels that must be within, in percent.
    pub on: f64,
    pub ceiling: Option<u8>,
    /// `(size, off)`: at most `off` pixels off in any `size` × `size` window.
    pub window: Option<(u32, u32)>,
}

impl Tolerance {
    /// Exact: every pixel equal.
    pub const EXACT: Tolerance = Tolerance {
        within: 0,
        on: 100.0,
        ceiling: Some(0),
        window: None,
    };

    pub fn read(v: &Value) -> Option<Tolerance> {
        let within = u8::try_from(v.get("within")?.as_u64()?).ok()?;
        let on = v.get("on")?.as_f64()?;
        let ceiling = match v.get("ceiling") {
            None => None,
            Some(c) => Some(u8::try_from(c.as_u64()?).ok()?),
        };
        let window = match v.get("window") {
            None => None,
            Some(w) => Some((
                u32::try_from(w.get("size")?.as_u64()?).ok()?,
                u32::try_from(w.get("off")?.as_u64()?).ok()?,
            )),
        };
        Some(Tolerance {
            within,
            on,
            ceiling,
            window,
        })
    }
}

/// What a comparison found.
#[derive(Clone, Debug, PartialEq)]
pub struct Judged {
    pub pass: bool,
    pub off: u64,
    pub allowed: u64,
    /// The first pixel past the ceiling, in row-major order: `(x, y, delta)`.
    pub first_past_ceiling: Option<(u32, u32, u8)>,
    /// The first window holding more pixels off than its bound: `(x, y, size, off)`.
    pub window: Option<(u32, u32, u32, u32)>,
}

impl Judged {
    pub fn to_json(&self) -> Value {
        json!({
            "verdict": if self.pass { "PASS" } else { "FAIL" },
            "off": self.off,
            "allowed": self.allowed,
            "first_past_ceiling": self.first_past_ceiling.map(|(x, y, d)| json!({"x": x, "y": y, "delta": d})),
            "window": self.window.map(|(x, y, size, off)| json!({"x": x, "y": y, "size": size, "off": off})),
        })
    }
}

/// Judges two RGBA images of one size. With `share_only`, the planted comparator, only the
/// share is checked.
pub fn judge(
    w: u32,
    h: u32,
    expected: &[u8],
    actual: &[u8],
    t: &Tolerance,
    share_only: bool,
) -> Judged {
    let n = (w as usize) * (h as usize);
    let mut off_map = vec![false; n];
    let mut off = 0u64;
    let mut first_past_ceiling = None;
    let pixels = expected
        .as_chunks::<4>()
        .0
        .iter()
        .zip(actual.as_chunks::<4>().0);
    for (i, (e, a)) in pixels.enumerate().take(n) {
        let delta = e
            .iter()
            .zip(a)
            .map(|(x, y)| x.abs_diff(*y))
            .max()
            .unwrap_or(0);
        if delta > t.within {
            off_map[i] = true;
            off += 1;
        }
        if let Some(ceiling) = t.ceiling {
            if delta > ceiling && first_past_ceiling.is_none() {
                first_past_ceiling =
                    Some(((i % w as usize) as u32, (i / w as usize) as u32, delta));
            }
        }
    }
    let allowed = ((100.0 - t.on) / 100.0 * n as f64 + 1e-9).floor().max(0.0) as u64;
    // The densest window: a summed-area table over the pixels off, every window position.
    let mut window = None;
    if let Some((size, bound)) = t.window.filter(|_| off > 0) {
        let (wu, hu) = (w as usize, h as usize);
        let mut sat = vec![0u32; (wu + 1) * (hu + 1)];
        for y in 0..hu {
            let mut row = 0u32;
            for x in 0..wu {
                row += u32::from(off_map[y * wu + x]);
                sat[(y + 1) * (wu + 1) + x + 1] = sat[y * (wu + 1) + x + 1] + row;
            }
        }
        let s = (size as usize).min(wu).min(hu).max(1);
        'scan: for y in 0..=(hu - s) {
            for x in 0..=(wu - s) {
                let at = |yy: usize, xx: usize| sat[yy * (wu + 1) + xx];
                let count = at(y + s, x + s) + at(y, x) - at(y, x + s) - at(y + s, x);
                if count > bound {
                    window = Some((x as u32, y as u32, s as u32, count));
                    break 'scan;
                }
            }
        }
    }
    if share_only {
        return Judged {
            pass: off <= allowed,
            off,
            allowed,
            first_past_ceiling: None,
            window: None,
        };
    }
    Judged {
        pass: off <= allowed && first_past_ceiling.is_none() && window.is_none(),
        off,
        allowed,
        first_past_ceiling,
        window,
    }
}

/// An 8-bit RGBA PNG's size and pixels.
pub fn read_png(path: &Path) -> Option<(u32, u32, Vec<u8>)> {
    let img = image::open(path).ok()?.to_rgba8();
    let (w, h) = img.dimensions();
    Some((w, h, img.into_raw()))
}

impl<'a> Hub<'a> {
    /// `{"call": "compare_images"}`.
    pub fn compare_images(&self, expected: &Path, actual: &Path, tolerance: &Value) -> Value {
        let (Some(t), Some((w, h, e)), Some((w2, h2, a))) = (
            Tolerance::read(tolerance),
            read_png(expected),
            read_png(actual),
        ) else {
            return json!({"outcome": "refused", "code": "out_of_range"});
        };
        if (w, h) != (w2, h2) {
            return json!({"verdict": "FAIL", "off": u64::from(w) * u64::from(h), "allowed": 0,
                          "first_past_ceiling": null, "window": null, "reason": "size"});
        }
        judge(w, h, &e, &a, &t, self.planted(Planted::ChecksShareOnly)).to_json()
    }
}
