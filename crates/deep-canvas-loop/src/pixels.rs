//! What the loop's pixel checks share (#1938): the frames a host drew, read through the
//! object-ID pass, in pinned f64 math.

use std::collections::BTreeMap;

use deep_canvas::registry::Frame;

use crate::scene;

/// BT.709's weights of linear R, G and B in luminance, as WCAG's.
pub const WEIGHTS: [f64; 3] = [0.2126, 0.7152, 0.0722];

/// Relative luminance of linear RGB (BT.709, as WCAG's).
pub fn luminance(rgb: [f64; 3]) -> f64 {
    WEIGHTS[0] * rgb[0] + WEIGHTS[1] * rgb[1] + WEIGHTS[2] * rgb[2]
}

/// Relative luminance of an sRGB-encoded px.
pub fn encoded_luminance(rgb: [u8; 3]) -> f64 {
    let lin = rgb.map(|c| deep_canvas::color::srgb_decode(f64::from(c) / 255.0));
    luminance(lin)
}

/// WCAG's contrast ratio of two relative luminances.
pub fn ratio(a: f64, b: f64) -> f64 {
    (a.max(b) + 0.05) / (a.min(b) + 0.05)
}

/// The picks of `items` (each a whole item or its parts) among `picks`, sorted.
pub fn picks_of(picks: &BTreeMap<u32, String>, items: &[String]) -> Vec<u32> {
    picks
        .iter()
        .filter(|(_, id)| items.iter().any(|k| scene::is_of(id, k)))
        .map(|(p, _)| *p)
        .collect()
}

/// Which px of `frame` draw any of `items` (each a whole item or its parts), by the ID pass.
pub fn mask(frame: &Frame, items: &[String]) -> Vec<bool> {
    let of = picks_of(&frame.picks, items);
    frame
        .ids
        .iter()
        .map(|p| of.binary_search(p).is_ok())
        .collect()
}

/// The shown px `i`, sRGB.
pub fn shown(frame: &Frame, i: usize) -> [u8; 3] {
    let p = &frame.rgba[i * 4..i * 4 + 3];
    [p[0], p[1], p[2]]
}

/// The median of `values` (sorted in place); 0 for none.
pub fn median(values: &mut [f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(f64::total_cmp);
    values[values.len() / 2]
}

/// The box `[x0, y0, x1, y1]` (inclusive px) of the set px of `mask`, on a frame `w` wide.
pub fn bounds(mask: &[bool], w: usize) -> Option<[usize; 4]> {
    let mut b: Option<[usize; 4]> = None;
    for (i, _) in mask.iter().enumerate().filter(|(_, m)| **m) {
        let (x, y) = (i % w, i / w);
        b = Some(match b {
            None => [x, y, x, y],
            Some([x0, y0, x1, y1]) => [x0.min(x), y0.min(y), x1.max(x), y1.max(y)],
        });
    }
    b
}

/// Whether the frame's buffers hold its size: a frame that doesn't is unreadable. Its light is
/// its linear image, or the host's reduction of it (#2513).
pub fn whole(frame: &Frame) -> bool {
    let n = frame.size[0] as usize * frame.size[1] as usize;
    let light = frame.linear.len() == n * 4 || frame.reduce.is_some();
    n > 0 && frame.ids.len() == n && frame.rgba.len() == n * 4 && light
}
