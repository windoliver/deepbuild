//! What a session's frames hold of decoded pictures (#1485, #1486) and their gauges (#1431): a session's sprites by
//! level and opacity (`images`), its copies placed off whole pixels (`placed`) and its resampled copies (`resampled`),
//! their decoded pictures in the heap. Each is held while the frame on screen or the one before draws it; a frame that
//! would hold more entries than the bound refuses the image, as one past the byte cap is.

use std::sync::Arc;

use deep_canvas::gauge::{Gauge, Place};
use gpui_kit::*;
use serde_json::Value;

use super::{ResampleKey, Session};
use crate::refused;

pub static IMAGES: Gauge = Gauge::new("Session::images", Place::Heap, 4_096, 2 * crate::asset::CAP);
pub static PLACED: Gauge = Gauge::new("Session::placed", Place::Heap, 4_096, 2 * crate::asset::CAP);
pub static RESAMPLED: Gauge =
    Gauge::new("Session::resampled", Place::Heap, 4_096, crate::asset::CAP);

/// The bytes a decoded picture holds.
pub(super) fn picture_bytes(image: &RenderImage) -> u64 {
    image.as_bytes(0).map_or(0, |b| b.len() as u64)
}

/// Whether a session's holder of `gauge` has room for one more entry.
pub(super) fn room(len: usize, gauge: &Gauge) -> bool {
    (len as u64) < gauge.bound.entries
}

/// A session's pictures leave its gauges with it.
impl Drop for Session {
    fn drop(&mut self) {
        let sum = |images: &mut dyn Iterator<Item = &Arc<RenderImage>>| {
            images.fold((0, 0), |(n, b), i| (n + 1, b + picture_bytes(i)))
        };
        let (n, b) = sum(&mut self.images.values().map(|(i, _)| i));
        IMAGES.sub(n, b);
        let (n, b) = sum(&mut self.placed.values().map(|(i, ..)| i));
        PLACED.sub(n, b);
        let (n, b) = sum(&mut self.resampled.values());
        RESAMPLED.sub(n, b);
    }
}

/// The bytes of a `[w, h]` RGBA picture.
pub(super) fn bytes([w, h]: [u32; 2]) -> u64 {
    u64::from(w) * u64::from(h) * 4
}

/// What the frame draws held: its levels and its resampled copies; #1485 AC2's wrong program
/// counts only the copies.
pub(super) fn held(session: &Session) -> u64 {
    let levels = match session.plant {
        crate::asset::Plant::CapCountsCopiesOnly => 0,
        _ => session.drawn_bytes,
    };
    levels + session.resampled.keys().map(|k| bytes(k.2)).sum::<u64>()
}

/// An image's copy resampled to its drawn size, made once and then reused. The copies and the
/// levels a frame draws hold at most `asset::CAP`: a copy past it is refused, naming the image's
/// asset.
pub(super) fn resampled(
    session: &mut Session,
    key: &ResampleKey,
    source: &RenderImage,
    size: [u32; 2],
    (item, asset): (&str, &str),
) -> Result<Arc<RenderImage>, Value> {
    if let Some(found) = session.resampled.get(key) {
        return Ok(found.clone());
    }
    // Named as a missing asset is: the field and the asset's hash.
    let path = format!("items/{item}/params/asset: {asset}");
    let to = key.2;
    if held(session) + bytes(to) > crate::asset::CAP || !room(session.resampled.len(), &RESAMPLED) {
        return Err(refused("over_budget", &path));
    }
    let narrow = |[w, h]: [u32; 2]| Some([u16::try_from(w).ok()?, u16::try_from(h).ok()?]);
    let (Some(from16), Some(to16), Some(bgra)) = (narrow(size), narrow(to), source.as_bytes(0))
    else {
        return Err(refused("asset_undecodable", &path));
    };
    let mut rgba = bgra.to_vec();
    rgba.as_chunks_mut::<4>()
        .0
        .iter_mut()
        .for_each(|px| px.swap(0, 2));
    let mut out = deep_marks_vello::resample(rgba, from16, key.1, to16);
    out.as_chunks_mut::<4>()
        .0
        .iter_mut()
        .for_each(|px| px.swap(0, 2));
    let frame = image::RgbaImage::from_raw(to[0], to[1], out)
        .ok_or_else(|| refused("asset_undecodable", &path))?;
    let copy = Arc::new(RenderImage::new([image::Frame::new(frame)]));
    session.resamples += 1;
    RESAMPLED.add(1, picture_bytes(&copy));
    session.resampled.insert(*key, copy.clone());
    Ok(copy)
}
