//! Compositing in linear light, inside a 3D writer layer (Frame and group: blend modes).

use super::*;

fn decode(c: u8) -> f64 {
    deep_canvas::color::srgb_decode(f64::from(c) / 255.0)
}

fn encode(v: f64) -> u8 {
    (deep_canvas::color::srgb_encode(v.clamp(0.0, 1.0)) * 255.0).round() as u8
}

/// A straight sRGB-encoded pixel as linear light, premultiplied.
fn lin(p: &image::Rgba<u8>) -> [f64; 4] {
    let a = f64::from(p[3]) / 255.0;
    [decode(p[0]) * a, decode(p[1]) * a, decode(p[2]) * a, a]
}

/// `source` (straight sRGB-encoded) composited into `acc` (linear light, premultiplied) at
/// `alpha`, in `mode`.
fn blend_into(acc: &mut [[f64; 4]], source: &image::RgbaImage, alpha: f64, mode: Blend) {
    for (d, p) in acc.iter_mut().zip(source.pixels()) {
        let s = lin(p).map(|v| v * alpha);
        let (ab, as_) = (d[3], s[3]);
        if mode == Blend::Add {
            *d = [0, 1, 2, 3].map(|i| (d[i] + s[i]).min(1.0));
            continue;
        }
        if as_ == 0.0 {
            continue;
        }
        let un = |c: &[f64; 4], a: f64| {
            [0, 1, 2].map(|i| if a > 0.0 { (c[i] / a).min(1.0) } else { 0.0 })
        };
        let number = deep_canvas::blend::index(mode.name()).unwrap_or(0);
        let b = deep_canvas::blend::mix(number, un(d, ab), un(&s, as_));
        let mut out = [0.0; 4];
        for i in 0..3 {
            out[i] = s[i] * (1.0 - ab) + d[i] * (1.0 - as_) + as_ * ab * b[i];
        }
        out[3] = as_ + ab * (1.0 - as_);
        *d = out;
    }
}

/// A 3D writer layer's 2D `marks` over its 3D pixels `base`, every composite in linear light:
/// each run of marks outside a blended group drawn by Vello CPU and laid over source-over, and
/// each blended group's content blended in its mode.
pub fn over(
    base: &image::RgbaImage,
    marks: &[&Drawn],
    size: [u32; 2],
) -> Result<image::RgbaImage, Value> {
    let mut acc: Vec<[f64; 4]> = base.pixels().map(lin).collect();
    let picture =
        |run: Vec<Drawn>| layer::vello(&run.into_iter().map(Arc::new).collect::<Vec<_>>(), size);
    let mut i = 0;
    while i < marks.len() {
        let found = marks[i..].iter().enumerate().find_map(|(k, d)| {
            d.scopes.iter().enumerate().find_map(|(at, s)| match s {
                Scope::Opacity {
                    item,
                    alpha,
                    blend: Some(b),
                    ..
                } => Some((i + k, at, item.clone(), *alpha, *b)),
                _ => None,
            })
        });
        let (start, end) = match &found {
            Some((start, _, group, ..)) => (
                *start,
                marks[*start..]
                    .iter()
                    .position(|d| !d.scopes.iter().any(|s| s.item() == group))
                    .map_or(marks.len(), |n| start + n),
            ),
            None => (marks.len(), marks.len()),
        };
        if start > i {
            let before = picture(marks[i..start].iter().map(|d| (*d).clone()).collect())?;
            blend_into(&mut acc, &before, 1.0, Blend::Normal);
        }
        if let Some((_, at, _, alpha, blend)) = found {
            let inside = marks[start..end]
                .iter()
                .map(|d| Drawn {
                    scopes: d.scopes[at + 1..].to_vec(),
                    ..(*d).clone()
                })
                .collect();
            blend_into(&mut acc, &picture(inside)?, alpha, blend);
        }
        i = end;
    }
    let mut out = image::RgbaImage::new(size[0], size[1]);
    for (o, p) in out.pixels_mut().zip(&acc) {
        let a = p[3];
        if a > 0.0 {
            *o = image::Rgba([
                encode(p[0] / a),
                encode(p[1] / a),
                encode(p[2] / a),
                (a * 255.0).round() as u8,
            ]);
        }
    }
    Ok(out)
}
