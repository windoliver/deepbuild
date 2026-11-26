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
use deep_images::animated::Animation;
use deep_images::{Images, Key, Refused, Store};
use serde_json::{json, Map, Value};
use vello_cpu::Pixmap;

use crate::refused;

/// An image as [`Kept::pixmap`] draws it: its pixmap, its size in px and the rect it covers.
type Drawn = (Arc<Pixmap>, [u32; 2], [f64; 4]);

/// The most the levels a frame draws may hold, B (Image `image@1`: cost).
pub const CAP: u64 = 64 << 20;

pub use deep_images::Plant;

/// A `session`'s wrong program, by its name: #417 AC2's look switch that empties every node
/// cache, or one of #3467's decode workers, which the live decode worker knows by these names.
pub fn session_plant(name: &str) -> Option<&'static str> {
    [
        "look_switch_rebuilds",
        "keeps_base_start_rule",
        "starts_every_request_at_key_frame",
        "answers_picture_kept_for_another",
        "keeps_every_picture",
    ]
    .into_iter()
    .find(|p| *p == name)
}

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
        frame: 0,
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

/// #2053: each lit image's normal page in `frame`, read from `store` (see [`paged`]).
pub fn pages(
    frame: &mut deep_canvas_marks::scene::Frame,
    store: Option<&Path>,
) -> Result<(), Value> {
    for layer in &mut frame.layers {
        for i in 0..layer.marks.len() {
            if let Some(d) = paged(&layer.marks[i], store)? {
                layer.marks.set(i, Arc::new(d));
            }
        }
    }
    Ok(())
}

/// #2053: `d` with its normal page read, when it is a lit image whose run's light names one: read
/// from `store` as stored at its full size and placed where the image draws. A page the store
/// lacks is refused naming the image's `normal`, and one whose size isn't its image's naming both
/// sizes, as the check refuses it.
pub fn paged(
    d: &deep_canvas_marks::scene::Drawn,
    store: Option<&Path>,
) -> Result<Option<deep_canvas_marks::scene::Drawn>, Value> {
    use deep_canvas_marks::light::Normals;
    use deep_canvas_marks::scene::{Mark, Scope};
    let Mark::Image {
        item,
        asset,
        bounds,
        fit,
        crop,
        turn,
        ..
    } = &d.mark
    else {
        return Ok(None);
    };
    let light_at = |s: &Scope| match s {
        Scope::Opacity {
            effect: Some(e), ..
        } => e.light.clone(),
        _ => None,
    };
    let unread = d.scopes.iter().position(|s| {
        light_at(s).is_some_and(|l| l.page.as_ref().is_some_and(|p| p.normals.is_none()))
    });
    let Some(at) = unread else {
        return Ok(None);
    };
    let light = light_at(&d.scopes[at]).expect("found above");
    let page = light.page.as_ref().expect("found above");
    let store = store_of(store);
    let field = format!("items/{item}/params/normal");
    let missing = || refused("asset_missing", &format!("{field}: {}", page.asset));
    let image = deep_images::hash_of(asset).ok_or_else(|| refusal_missing(asset, item))?;
    let image = images()
        .size(&store, &image)
        .map_err(|r| refusal(r, asset, item, false))?;
    let hash = deep_images::hash_of(&page.asset).ok_or_else(missing)?;
    let size = images().size(&store, &hash).map_err(|r| match r.code {
        "asset_missing" | "asset_mismatch" => missing(),
        code => refused(code, &field),
    })?;
    if size != image {
        return Err(refused(
            "out_of_range",
            &format!("{field}: {}", sizes(size, image)),
        ));
    }
    let key = Key {
        hash,
        crop: [0, 0, size[0], size[1]],
        flip: 0,
        level: 0,
        frame: 0,
    };
    let level = images().wait(&store, key).map_err(|_| missing())?;
    // Where the image draws: its crop fitted in its box, turned about the box's centre.
    let cut = deep_images::crop_px(*crop, image)
        .ok_or_else(|| refused("out_of_range", &format!("items/{item}/params/crop")))?;
    let to = fit.fitted(*bounds, [cut[2], cut[3]]);
    let [a, b, c, dd, e, f] = deep_canvas_marks::turn::turn_of(*bounds, *turn);
    let det = a * dd - b * c;
    let inv = [
        dd / det,
        -b / det,
        -c / det,
        a / det,
        (c * f - dd * e) / det,
        (b * e - a * f) / det,
    ];
    // The frame's u to the image's px, which are the page's texels.
    let k = [f64::from(cut[2]) / to[2], f64::from(cut[3]) / to[3]];
    let back = [
        k[0] * inv[0],
        k[1] * inv[1],
        k[0] * inv[2],
        k[1] * inv[3],
        f64::from(cut[0]) + k[0] * (inv[4] - to[0]),
        f64::from(cut[1]) + k[1] * (inv[5] - to[1]),
    ];
    let (sin, cos) = deep_canvas_marks::turn::sin_cos(*turn);
    let normals = Normals {
        size,
        texels: level.rgba.clone(),
        back,
        turn: [sin, cos],
    };
    let mut lit = (*light).clone();
    if let Some(p) = lit.page.as_mut() {
        p.normals = Some(Arc::new(normals));
    }
    let mut out = d.clone();
    if let Scope::Opacity {
        effect: Some(effect),
        ..
    } = &mut out.scopes[at]
    {
        let mut e = (**effect).clone();
        e.light = Some(Arc::new(lit));
        *effect = Arc::new(e);
    }
    Ok(Some(out))
}

/// An image whose asset isn't a sha256, refused as a missing one.
fn refusal_missing(asset: &str, item: &str) -> Value {
    let r = Refused {
        code: "asset_missing",
        on_crop: false,
    };
    refusal(r, asset, item, false)
}

/// #2053: each image of `doc` whose `normal` page's pixel size isn't its own, refused naming both
/// sizes. A page or an image the store can't read is left to the drawing, which refuses it.
pub fn page_issues(
    doc: &Map<String, Value>,
    store: Option<&Path>,
) -> Vec<deep_canvas::document::Issue> {
    let store = store_of(store);
    let size = |asset: &str| images().size(&store, &deep_images::hash_of(asset)?).ok();
    let items = doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten();
    let mut out = Vec::new();
    for (id, item) in items {
        let Some(page) = deep_canvas_marks::light::normal_of(item) else {
            continue;
        };
        let image = item.pointer("/params/asset").and_then(Value::as_str);
        let (Some(page), Some(image)) = (size(page), image.and_then(size)) else {
            continue;
        };
        if page != image {
            out.push(deep_canvas::document::Issue::error(
                "normal_page_size",
                id,
                format!("items/{id}/params/normal"),
                json!({"page": page, "image": image}),
                &sizes(page, image),
            ));
        }
    }
    out
}

/// #2053: a page's size and its image's, as a refusal names them.
pub fn sizes(page: [u32; 2], image: [u32; 2]) -> String {
    format!(
        "the page is {} × {} px and its image {} × {} px",
        page[0], page[1], image[0], image[1]
    )
}

/// The store a request names, as the service reads it; with none, a store that holds nothing.
pub fn store_of(store: Option<&Path>) -> Arc<Store> {
    Arc::new(Store::flat(store.unwrap_or(Path::new("/dev/null"))))
}

/// #1489: an image item's `frames` over an animation, read as a video's are (Image `image@1`:
/// video frames): start, in and rate on the document's clock, and whether it loops or, past its
/// end, holds its first frame.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Timing {
    start: i64,
    r#in: i64,
    rate: (i64, i64),
    looped: bool,
    hold_first: bool,
}

impl Timing {
    pub fn of(doc: &Value, frames: &Value) -> Timing {
        use deep_canvas_media::doc::{rate, time};
        Timing {
            start: time(doc, frames.get("start")).unwrap_or(0),
            r#in: time(doc, frames.get("in")).unwrap_or(0),
            rate: rate(frames.get("rate")).unwrap_or((1, 1)),
            looped: frames.get("loop").and_then(Value::as_bool).unwrap_or(false),
            hold_first: frames.get("hold").and_then(Value::as_str) == Some("first"),
        }
    }

    /// The frame `animation` shows at `t`, the one its delays put at source time in + (t − start)
    /// × rate (the first before start), and the document time the next frame starts at, if one
    /// ever does.
    pub fn frame(&self, animation: &Animation, t: i64) -> (u32, Option<i64>) {
        let (start, r#in, (p, q)) = (self.start, self.r#in, self.rate);
        let src = deep_canvas_media::frames::source_time(t.max(start), start, r#in, (p, q));
        let k = animation.frame_at(src, self.looped, self.hold_first);
        // Back in document time: start + (src − in) ÷ rate, rounded up.
        let next = (animation.next_change(src, self.looped, self.hold_first)).map(|n| {
            let rel = i128::from(n - r#in) * i128::from(q);
            let p = i128::from(p.max(1));
            (i128::from(start) + (rel + p - 1).div_euclid(p)) as i64
        });
        (k as u32, next)
    }
}

/// #1489: an animated image item: its asset's hash, the animation's probe and the item's timing.
pub type Animated = ([u8; 32], Arc<Animation>, Timing);

/// #1489: each image item of `doc` with `frames` whose asset is an animation, by its ID. An asset
/// the service can't read or decode is refused, naming it.
pub fn animated_items(doc: &Value, store: &Store) -> Result<BTreeMap<String, Animated>, Value> {
    let mut out = BTreeMap::new();
    for (id, item) in doc
        .get("items")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
    {
        let (Some(frames), Some(asset)) = (
            item.pointer("/params/frames"),
            item.pointer("/params/asset").and_then(Value::as_str),
        ) else {
            continue;
        };
        let Some(hash) = deep_images::hash_of(asset).filter(|_| item["kind"] == "image@1") else {
            continue;
        };
        let probed = images().animation(store, &hash);
        if let Some(animation) = probed.map_err(|r| refusal(r, asset, id, false))? {
            out.insert(id.clone(), (hash, animation, Timing::of(doc, frames)));
        }
    }
    Ok(out)
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
    /// #1489: the frame each animated image item shows in the frame drawn, by its ID.
    pub frames: HashMap<String, u32>,
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
        let mut ask = ask(&store, asset, (crop, tile), (bounds, fit), scale, item)?;
        ask.key.frame = self.frames.get(item).copied().unwrap_or(0);
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

    /// A frame starts: the request's wrong program, and (#1489) the frame each animated image item
    /// of `doc` shows at `t` (none when an asset can't be read: drawing it refuses it).
    pub fn start(
        &mut self,
        plant: Plant,
        (doc, store, t): (&Map<String, Value>, Option<&Path>, i64),
    ) {
        self.plant = plant;
        self.frames.clear();
        let store = self.store(store);
        let animated = animated_items(&Value::Object(doc.clone()), &store).unwrap_or_default();
        for (id, (_, animation, timing)) in animated {
            self.frames.insert(id, timing.frame(&animation, t).0);
        }
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
