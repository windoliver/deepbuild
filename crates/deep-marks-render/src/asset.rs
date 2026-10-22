//! An image asset read from the request's content-addressed store by its sha256, checked against
//! that hash, decoded and cropped (Image `image@1`). A document never names a path.

use std::path::Path;

use deep_canvas_marks::key::sha256_hex;
use image::RgbaImage;
use serde_json::Value;

use crate::refused;

/// The asset's pixels, straight RGBA, cropped to `crop` (`[x, y, w, h]` in image pixels).
pub fn decoded(
    store: Option<&Path>,
    asset: &str,
    crop: Option<[f64; 4]>,
    item: &str,
) -> Result<RgbaImage, Value> {
    let path = format!("items/{item}/params/asset");
    let Some(store) = store else {
        return Err(refused("asset_missing", &format!("{path}: {asset}")));
    };
    let bytes = std::fs::read(store.join(asset))
        .map_err(|_| refused("asset_missing", &format!("{path}: {asset}")))?;
    if sha256_hex(&bytes) != asset {
        return Err(refused("asset_mismatch", &format!("{path}: {asset}")));
    }
    let decoded =
        image::load_from_memory(&bytes).map_err(|_| refused("asset_undecodable", &path))?;
    let mut rgba = decoded.to_rgba8();
    if let Some([x, y, w, h]) = crop {
        let (iw, ih) = rgba.dimensions();
        let (x, y) = (x.max(0.0) as u32, y.max(0.0) as u32);
        let (w, h) = (
            (w.max(1.0) as u32).min(iw.saturating_sub(x)),
            (h.max(1.0) as u32).min(ih.saturating_sub(y)),
        );
        if w == 0 || h == 0 {
            return Err(refused(
                "out_of_range",
                &format!("items/{item}/params/crop"),
            ));
        }
        rgba = image::imageops::crop_imm(&rgba, x, y, w, h).to_image();
    }
    Ok(rgba)
}
