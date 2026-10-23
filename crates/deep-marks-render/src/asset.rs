//! Assets read from the request's content-addressed store by their sha256 and checked against that
//! hash: an image, decoded and cropped (Image `image@1`), and a mark set column's sidecar data
//! (Mark set and columns: `data: base64 | sidecar sha256`). A document never names a path.

use std::path::Path;

use deep_canvas_marks::key::sha256_hex;
use image::RgbaImage;
use serde_json::{Map, Value};

use crate::refused;

/// The bytes of `hash` in the store, checked against it; `path` names the field that asked.
fn read(store: Option<&Path>, hash: &str, path: &str) -> Result<Vec<u8>, Value> {
    let Some(store) = store else {
        return Err(refused("asset_missing", &format!("{path}: {hash}")));
    };
    let bytes = std::fs::read(store.join(hash))
        .map_err(|_| refused("asset_missing", &format!("{path}: {hash}")))?;
    if sha256_hex(&bytes) != hash {
        return Err(refused("asset_mismatch", &format!("{path}: {hash}")));
    }
    Ok(bytes)
}

/// Every mark set column of `doc` whose `data` is `{sidecar: sha256}`, read from the store, checked
/// and written in place as the base64 the column would otherwise carry.
pub fn sidecars(doc: &mut Map<String, Value>, store: Option<&Path>) -> Result<(), Value> {
    let Some(Value::Object(items)) = doc.get_mut("items") else {
        return Ok(());
    };
    for (id, item) in items.iter_mut() {
        if item.get("kind").and_then(Value::as_str) != Some("marks@1") {
            continue;
        }
        let Some(Value::Object(columns)) = item.pointer_mut("/params/columns") else {
            continue;
        };
        for (name, column) in columns.iter_mut() {
            let Some(data) = column.get_mut("data") else {
                continue;
            };
            let Some(hash) = data
                .get("sidecar")
                .and_then(Value::as_str)
                .map(str::to_string)
            else {
                continue;
            };
            let path = format!("items/{id}/params/columns/{name}/data");
            *data = Value::String(deep_canvas::base64::encode(&read(store, &hash, &path)?));
        }
    }
    Ok(())
}

/// The asset's pixels, straight RGBA, cropped to `crop` (`[x, y, w, h]` in image pixels).
pub fn decoded(
    store: Option<&Path>,
    asset: &str,
    crop: Option<[f64; 4]>,
    item: &str,
) -> Result<RgbaImage, Value> {
    let path = format!("items/{item}/params/asset");
    let bytes = read(store, asset, &path)?;
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
