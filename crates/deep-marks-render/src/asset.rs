//! Assets read from the request's content-addressed store by their sha256 and checked against that
//! hash: an image, through the one image service's levels (Image `image@1`, #1486), and a mark set
//! column's sidecar data
//! (Mark set and columns: `data: base64 | sidecar sha256`). A document never names a path.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use deep_canvas_marks::key::sha256_hex;
use deep_canvas_marks::paint::Adjust;
use deep_canvas_marks::scene::{AtlasCell, ImageFit};
use deep_images::{Images, Key, Refused, Store};
use serde_json::{Map, Value};
use vello_cpu::Pixmap;

use crate::refused;

/// An image as [`Kept::pixmap`] draws it: its pixmap, its size in px and the rect it covers.
type Drawn = (Arc<Pixmap>, [u32; 2], [f64; 4]);

/// The most the levels a frame draws may hold, B (Image `image@1`: cost).
pub const CAP: u64 = 64 << 20;

pub use deep_images::Plant;

/// The process's one image service (#1486): every image path asks it for levels.
pub fn images() -> &'static Images {
    deep_images::shared()
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

/// #1965: every code item of `doc` whose `raw` is an asset (`{asset: sha256}`, the form bytes that
/// aren't UTF-8 take), read from the store, checked and kept beside the hash as `base64`, which the
/// code's readers take as its raw bytes.
pub fn raws(doc: &mut Map<String, Value>, store: Option<&Path>) -> Result<(), Value> {
    let Some(Value::Object(items)) = doc.get_mut("items") else {
        return Ok(());
    };
    for (id, item) in items.iter_mut() {
        let Some(Value::Object(raw)) = item.pointer_mut("/params/raw") else {
            continue;
        };
        let Some(hash) = raw.get("asset").and_then(Value::as_str).map(str::to_string) else {
            continue;
        };
        let bytes = read(store, &hash, &format!("items/{id}/params/raw"))?;
        raw.insert(
            "base64".into(),
            Value::String(deep_canvas::base64::encode(&bytes)),
        );
    }
    Ok(())
}

/// Every mark set column of `doc` that reads a table, inlined from the evidence store
/// (`deep_marks_vello::tables`).
pub fn tables(doc: &mut Map<String, Value>, evidence: Option<&Path>) -> Result<(), Value> {
    deep_marks_vello::tables::tables(doc, evidence).map_err(|r| refused(r.code, &r.path))
}

/// An image mark as the service asks for it: its key at the level its drawn size takes, the rect
/// its fit draws it in, u, and its level's bytes.
pub struct Ask {
    pub key: Key,
    pub to: [f64; 4],
    pub bytes: u64,
}

/// A refusal naming the image's asset field the way #1485 named it: a missing or mismatched asset
/// with its hash, any other on the field alone.
pub fn refusal(r: Refused, asset: &str, item: &str, tile: bool) -> Value {
    let set = item.split('#').next().unwrap_or(item);
    match r.code {
        "out_of_range" if tile => {
            refused("out_of_range", &format!("items/{set}/params/columns/tile"))
        }
        _ if r.on_crop => refused("out_of_range", &format!("items/{item}/params/crop")),
        code @ ("asset_missing" | "asset_mismatch") => {
            refused(code, &format!("items/{item}/params/asset: {asset}"))
        }
        code => refused(code, &format!("items/{item}/params/asset")),
    }
}

/// Resolves an image mark to its request: the asset's size from its header (refused there when
/// it couldn't be decoded within the caps), its crop or atlas cell in whole pixels, the rect its
/// fit draws it in, and the level it takes drawn at `scale` device px per u.
pub fn ask(
    store: &Store,
    asset: &str,
    (crop, tile): (Option<[f64; 4]>, Option<&AtlasCell>),
    (bounds, fit): ([f64; 4], ImageFit),
    scale: f64,
    item: &str,
) -> Result<Ask, Value> {
    let no = |r: Refused| refusal(r, asset, item, tile.is_some());
    let hash = deep_images::hash_of(asset).ok_or_else(|| {
        no(Refused {
            code: "asset_missing",
            on_crop: false,
        })
    })?;
    let size = images().size(store, &hash).map_err(no)?;
    let (cut, flip) = match tile {
        Some(tile) => {
            let cell = tile
                .rect(size)
                .map(|r| r.map(|v| v as u32))
                .ok_or_else(|| {
                    no(Refused {
                        code: "out_of_range",
                        on_crop: false,
                    })
                })?;
            (cell, tile.flip)
        }
        None => (
            deep_images::crop_px(crop, size).ok_or_else(|| {
                no(Refused {
                    code: "out_of_range",
                    on_crop: true,
                })
            })?,
            0,
        ),
    };
    let mut key = Key {
        hash,
        crop: cut,
        flip,
        level: 0,
    };
    let shown = key.shown();
    let to = fit.fitted(bounds, shown);
    key.level = deep_images::level_for(shown, [to[2] * scale, to[3] * scale]);
    let [w, h] = deep_images::level_size(shown, key.level);
    Ok(Ask {
        key,
        to,
        bytes: u64::from(w) * u64::from(h) * 4,
    })
}

/// The store a request names, as the service reads it; with none, a store that holds nothing.
pub fn store_of(store: Option<&Path>) -> Arc<Store> {
    Arc::new(Store::flat(store.unwrap_or(Path::new("/dev/null"))))
}

/// What one painter draws of the service's levels: each level's premultiplied pixmap at an
/// opacity and adjust, made once and kept while frames draw it, and the bytes of the levels a
/// frame draws, held within [`CAP`].
#[derive(Default)]
pub struct Kept {
    made: HashMap<Key, (f64, Adjust, Arc<Pixmap>)>,
    drawn: HashSet<Key>,
    drawn_bytes: u64,
    store: Option<(Option<PathBuf>, Arc<Store>)>,
    /// #1486: the level each image item this frame drew was drawn at.
    pub levels: BTreeMap<String, u8>,
    /// #1485's wrong program on the decode or the cap, if planted.
    pub plant: Plant,
}

impl Kept {
    fn store(&mut self, store: Option<&Path>) -> Arc<Store> {
        match &self.store {
            Some((path, kept)) if path.as_deref() == store => kept.clone(),
            _ => {
                let kept = store_of(store);
                self.store = Some((store.map(Path::to_path_buf), kept.clone()));
                kept
            }
        }
    }

    /// The image's premultiplied pixmap at `opacity` and `adjust`, the size of its level and the
    /// rect its fit draws it in: the level the service makes for its drawn size at `scale`,
    /// waited for, since a painter's frame draws every picture whole. A level whose bytes would
    /// take what this frame draws past [`CAP`] is refused, naming the asset.
    #[allow(clippy::too_many_arguments)]
    pub fn pixmap(
        &mut self,
        store: Option<&Path>,
        asset: &str,
        (crop, tile): (Option<[f64; 4]>, Option<&AtlasCell>),
        (opacity, adjust): (f64, &Adjust),
        (bounds, fit, scale): ([f64; 4], ImageFit, f64),
        item: &str,
    ) -> Result<Drawn, Value> {
        let store = self.store(store);
        let ask = ask(&store, asset, (crop, tile), (bounds, fit), scale, item)?;
        self.levels.insert(item.to_string(), ask.key.level);
        if self.drawn.insert(ask.key) {
            if self.plant != Plant::CapCountsCopiesOnly && self.drawn_bytes + ask.bytes > CAP {
                return Err(refused(
                    "over_budget",
                    &format!("items/{item}/params/asset"),
                ));
            }
            self.drawn_bytes += ask.bytes;
        }
        if self.plant == Plant::DecodesPerDraw {
            self.made.remove(&ask.key);
        }
        if let Some((o, a, pixmap)) = self.made.get(&ask.key) {
            if *o == opacity && a == adjust {
                let level = deep_images::level_size(ask.key.shown(), ask.key.level);
                return Ok((pixmap.clone(), level, ask.to));
            }
        }
        let level = images()
            .wait(&store, ask.key)
            .map_err(|r| refusal(r, asset, item, tile.is_some()))?;
        let [w, h] = level.size;
        let (Ok(pw), Ok(ph)) = (u16::try_from(w), u16::try_from(h)) else {
            return Err(refused(
                "asset_undecodable",
                &format!("items/{item}/params/asset"),
            ));
        };
        let pixmap = Arc::new(deep_marks_vello::image(
            level.rgba.clone(),
            [pw, ph],
            opacity,
            adjust,
        ));
        self.made
            .insert(ask.key, (opacity, adjust.clone(), pixmap.clone()));
        Ok((pixmap, level.size, ask.to))
    }

    /// A frame is drawn: every pixmap it didn't draw is let go, and the next frame's budget starts
    /// empty.
    pub fn frame_ended(&mut self) {
        let drawn = std::mem::take(&mut self.drawn);
        self.made.retain(|k, _| drawn.contains(k));
        self.drawn_bytes = 0;
        self.levels.clear();
    }
}
