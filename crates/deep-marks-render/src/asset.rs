//! Assets read from the request's content-addressed store by their sha256 and checked against that
//! hash: an image, decoded and cropped (Image `image@1`), and a mark set column's sidecar data
//! (Mark set and columns: `data: base64 | sidecar sha256`). A document never names a path.

use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use deep_canvas_marks::key::sha256_hex;
use deep_canvas_marks::paint::Adjust;
use image::{ImageError, ImageReader, RgbaImage};
use serde_json::{json, Map, Value};
use vello_cpu::Pixmap;

use crate::refused;

/// The most a document holds decoded, resampled copies included (Image `image@1`: cost).
pub const CAP: u64 = 64 << 20;

/// The longest side a decode takes, px: Vello's pixmaps and GPUI's sprites take a 16-bit side.
const SIDE: u32 = u16::MAX as u32;

/// The images this process has read from a store, and decoded, so far (#1485: `frames` reports
/// each vsync's).
pub static READS: AtomicU64 = AtomicU64::new(0);
pub static DECODES: AtomicU64 = AtomicU64::new(0);

/// #1485's wrong programs on an image's decode, its cap and its upload.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Plant {
    #[default]
    None,
    /// AC1's: the asset decoded whole first, then the cap applied.
    DecodesBeforeHeader,
    /// AC2's: the cap counts only resampled copies, so a linear image never reaches it.
    CapCountsCopiesOnly,
    /// AC4's: the raster path reads and decodes the asset at every draw.
    DecodesPerDraw,
    /// AC5's: Vello GPU uploads each image at every draw and frees it after.
    UploadsPerFrame,
}

impl Plant {
    /// The plant a request's `planted` names, if it names one of these.
    pub fn named(name: &str) -> Option<Plant> {
        Some(match name {
            "decodes_before_header" => Plant::DecodesBeforeHeader,
            "cap_counts_copies_only" => Plant::CapCountsCopiesOnly,
            "decodes_per_draw" => Plant::DecodesPerDraw,
            "uploads_per_frame" => Plant::UploadsPerFrame,
            _ => return None,
        })
    }
}

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

/// The bytes of `hash` in the store, checked against it, if it holds them: a vector's SVG (#398).
pub fn bytes(store: Option<&Path>, hash: &str) -> Option<Vec<u8>> {
    read(store, hash, "").ok()
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

/// Every mark set column of `doc` that reads a table, inlined from the evidence store
/// (`deep_marks_vello::tables`).
pub fn tables(doc: &mut Map<String, Value>, evidence: Option<&Path>) -> Result<(), Value> {
    deep_marks_vello::tables::tables(doc, evidence).map_err(|r| refused(r.code, &r.path))
}

/// The asset's pixels, straight RGBA, cropped to `crop` (`[x, y, w, h]` in image pixels). Its
/// header is read first: an image with a side past the decode cap, or whose `w × h × 4` bytes
/// pass the `remaining` budget, is refused `over_budget`, naming the asset, before its pixels are
/// allocated (Image `image@1`).
pub fn decoded(
    store: Option<&Path>,
    asset: &str,
    crop: Option<[f64; 4]>,
    item: &str,
    remaining: u64,
    plant: Plant,
) -> Result<RgbaImage, Value> {
    let path = format!("items/{item}/params/asset");
    let bytes = read(store, asset, &path)?;
    READS.fetch_add(1, Ordering::Relaxed);
    let undecodable = |_: ImageError| refused("asset_undecodable", &path);
    if plant == Plant::DecodesBeforeHeader {
        let rgba = image::load_from_memory(&bytes)
            .map_err(undecodable)?
            .to_rgba8();
        DECODES.fetch_add(1, Ordering::Relaxed);
        if u64::from(rgba.width()) * u64::from(rgba.height()) * 4 > remaining {
            return Err(refused("over_budget", &path));
        }
        return cropped(rgba, crop, item);
    }
    let reader = || ImageReader::new(Cursor::new(&bytes[..])).with_guessed_format();
    let (w, h) = reader()
        .map_err(|e| undecodable(ImageError::IoError(e)))?
        .into_dimensions()
        .map_err(undecodable)?;
    if w > SIDE || h > SIDE || u64::from(w) * u64::from(h) * 4 > remaining {
        return Err(refused("over_budget", &path));
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(SIDE);
    limits.max_image_height = Some(SIDE);
    limits.max_alloc = Some(remaining);
    let mut decoder = reader().map_err(|e| undecodable(ImageError::IoError(e)))?;
    decoder.limits(limits);
    let decoded = decoder.decode().map_err(|e| match e {
        ImageError::Limits(_) => refused("over_budget", &path),
        e => undecodable(e),
    })?;
    DECODES.fetch_add(1, Ordering::Relaxed);
    cropped(decoded.into_rgba8(), crop, item)
}

/// `rgba` cut to `crop`, `[x, y, w, h]` in image pixels.
fn cropped(mut rgba: RgbaImage, crop: Option<[f64; 4]>, item: &str) -> Result<RgbaImage, Value> {
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

/// An image kept by its store, hash and crop.
type KeptKey = (Option<PathBuf>, String, [u64; 4]);

/// A decoded image and the pixmap last made from it, at the opacity and adjust it was made with.
struct KeptImage {
    straight: Arc<RgbaImage>,
    made: Option<(f64, Adjust, Arc<Pixmap>)>,
}

/// Decoded images kept across a presentation's frames by store, hash and crop (Image `image@1`:
/// decoded once), each frame's within the document's cap; a frame lets go of what it didn't draw.
#[derive(Default)]
pub struct Kept {
    images: HashMap<KeptKey, KeptImage>,
    drawn: HashSet<KeptKey>,
    /// #1485's wrong program on the decode or the cap, if planted.
    pub plant: Plant,
}

impl Kept {
    /// The image's premultiplied pixmap at `opacity` and `adjust`, and its size: its asset read
    /// and decoded the first time a frame draws it, and the pixmap made again only when the
    /// opacity or the adjust changes.
    pub fn pixmap(
        &mut self,
        store: Option<&Path>,
        asset: &str,
        crop: Option<[f64; 4]>,
        (opacity, adjust): (f64, &Adjust),
        item: &str,
    ) -> Result<(Arc<Pixmap>, [u32; 2]), Value> {
        let key: KeptKey = (
            store.map(Path::to_path_buf),
            asset.to_string(),
            crop.map_or([u64::MAX; 4], |c| c.map(f64::to_bits)),
        );
        if self.plant == Plant::DecodesPerDraw {
            self.images.remove(&key);
        }
        if !self.images.contains_key(&key) {
            let held: u64 = (self.drawn.iter())
                .filter_map(|k| self.images.get(k))
                .map(|i| i.straight.as_raw().len() as u64)
                .sum();
            let held = if self.plant == Plant::CapCountsCopiesOnly {
                0
            } else {
                held
            };
            let straight = decoded(
                store,
                asset,
                crop,
                item,
                CAP.saturating_sub(held),
                self.plant,
            )?;
            self.images.insert(
                key.clone(),
                KeptImage {
                    straight: Arc::new(straight),
                    made: None,
                },
            );
        }
        self.drawn.insert(key.clone());
        let kept = self.images.get_mut(&key).expect("inserted above");
        let (w, h) = kept.straight.dimensions();
        let (Ok(pw), Ok(ph)) = (u16::try_from(w), u16::try_from(h)) else {
            return Err(refused(
                "asset_undecodable",
                &format!("items/{item}/params/asset"),
            ));
        };
        match &kept.made {
            Some((o, a, pixmap)) if *o == opacity && a == adjust => Ok((pixmap.clone(), [w, h])),
            _ => {
                let rgba = kept.straight.as_raw().clone();
                let pixmap = Arc::new(deep_marks_vello::image(rgba, [pw, ph], opacity, adjust));
                kept.made = Some((opacity, adjust.clone(), pixmap.clone()));
                Ok((pixmap, [w, h]))
            }
        }
    }

    /// A frame is drawn: every image it didn't draw is let go.
    pub fn frame_ended(&mut self) {
        let drawn = std::mem::take(&mut self.drawn);
        self.images.retain(|k, _| drawn.contains(k));
    }
}
