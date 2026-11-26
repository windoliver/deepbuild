//! Issue #3234: what a taste call judges is the pictures its evidence lists by hash: stills, a sheet's cells, a film's
//! contact sheet and the two sides of a before and after. The ask is pinned to that evidence, a manifest
//! `{"pictures": [{"sha256", "size": [w, h]}]}` in the evidence store, or to a document revision whose canonical document
//! lists them so; the document's next `doc.patched` is a picture replaced under the card. The option that
//! accepts arms only once each picture was drawn whole inside the window, at no less than half its pixel size, for the
//! arming interval; the answer's record says, for each, whether it was shown, the largest scale it was drawn whole at
//! and how long it was drawn whole.
//!
//! The tracking is pure: the view reports what each frame drew and the shell's tick passes the time, so it adds no
//! timer of its own, and the replica drives it on the virtual clock.

use std::{cell::RefCell, collections::HashMap, sync::Arc};

use gpui_kit::RenderImage;
use serde_json::{json, Value};

use crate::arming::ARM_AFTER;

/// The least scale a picture counts as shown at: half its pixel size. The half is drafted (#3234).
pub const HALF: f64 = 0.5;

/// One picture a taste call judges, by its hash, with its own size in pixels.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Listed {
    pub hash: String,
    pub size: [u32; 2],
}

/// How one frame drew a picture: the scale it was drawn at (drawn device pixels over its own) and whether it lay whole
/// inside the window and its scroll area.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Drawn {
    pub scale: f64,
    pub whole: bool,
}

/// What a picture's presentation has seen so far.
#[derive(Clone, Debug, PartialEq)]
struct Seen {
    listed: Listed,
    shown: bool,
    /// The largest scale it was drawn whole at.
    largest: f64,
    /// Its time drawn whole, closed stretches only.
    ms: u64,
    /// Since when it has been drawn whole, at any scale, and whole at half its size or more.
    whole_since: Option<u64>,
    half_since: Option<u64>,
}

impl Seen {
    fn new(listed: Listed) -> Seen {
        Seen {
            listed,
            shown: false,
            largest: 0.,
            ms: 0,
            whole_since: None,
            half_since: None,
        }
    }

    fn tick(&mut self, now: u64) {
        if self
            .half_since
            .is_some_and(|since| now >= since + ARM_AFTER)
        {
            self.shown = true;
        }
    }

    fn on_screen(&self, now: u64) -> u64 {
        self.ms
            + self
                .whole_since
                .map_or(0, |since| now.saturating_sub(since))
    }
}

/// The pictures one card judges, in the order their evidence lists them.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Pictures {
    seen: Vec<Seen>,
}

impl Pictures {
    pub fn new(listed: &[Listed]) -> Pictures {
        Pictures {
            seen: listed.iter().cloned().map(Seen::new).collect(),
        }
    }

    /// Those of `listed` not shown yet.
    pub fn left(&self, listed: &[Listed]) -> usize {
        listed
            .iter()
            .filter(|listed| {
                !self
                    .seen
                    .iter()
                    .any(|seen| seen.listed == **listed && seen.shown)
            })
            .count()
    }

    /// The list read again while the card shows: a picture whose hash is new counts as not shown, and one that kept
    /// its hash keeps what it saw.
    pub fn relist(&mut self, listed: &[Listed]) {
        let mut was = std::mem::take(&mut self.seen);
        self.seen = listed
            .iter()
            .map(
                |listed| match was.iter().position(|seen| seen.listed == *listed) {
                    Some(at) => was.swap_remove(at),
                    None => Seen::new(listed.clone()),
                },
            )
            .collect();
    }

    /// What a frame drew at `now`, by hash, its best draw of each; a listed picture the frame didn't draw is off
    /// screen. `half` is the least scale that counts as shown.
    pub fn frame(&mut self, drawn: &HashMap<String, Drawn>, half: f64, now: u64) {
        for seen in &mut self.seen {
            seen.tick(now);
            let this = drawn.get(&seen.listed.hash).filter(|d| d.whole);
            match this {
                Some(d) => {
                    seen.largest = seen.largest.max(d.scale);
                    seen.whole_since.get_or_insert(now);
                }
                None => {
                    if let Some(since) = seen.whole_since.take() {
                        seen.ms += now.saturating_sub(since);
                    }
                }
            }
            if this.is_some_and(|d| d.scale >= half) {
                seen.half_since.get_or_insert(now);
            } else {
                seen.half_since = None;
            }
        }
    }

    /// Time passed to `now`: a picture drawn whole at half its size or more for the arming interval counts as shown.
    pub fn tick(&mut self, now: u64) {
        for seen in &mut self.seen {
            seen.tick(now);
        }
    }

    /// The answer's entries at `now` for `listed`, in its order: whether each was shown, the largest scale it was
    /// drawn whole at and the milliseconds it was drawn whole. `all_shown` is #3234's planted recorder.
    pub fn record(&self, listed: &[Listed], now: u64, all_shown: bool) -> Vec<Value> {
        listed
            .iter()
            .map(|listed| {
                let seen = self.seen.iter().find(|seen| seen.listed == *listed);
                json!({
                    "sha256": listed.hash,
                    "shown": all_shown || seen.is_some_and(|seen| seen.shown),
                    "scale": seen.map_or(0., |seen| (seen.largest * 1000.).round() / 1000.),
                    "ms": seen.map_or(0, |seen| seen.on_screen(now)),
                })
            })
            .collect()
    }
}

/// The manifest a taste ask's pin names: an evidence pin's own hash, or for a pin to `doc:<id>@<rev>` the canonical
/// document of that document's newest recorded revision, the `doc.patched` with the highest `rev`, held under its
/// `hash`. A newer revision is how a picture is replaced under a presented card.
fn manifest_of<'a>(events: &'a [Value], ask: &'a Value) -> Option<&'a str> {
    let pin = &ask["data"]["pinned_to"];
    let at = pin["ref"].as_str()?;
    if pin["kind"] == "evidence" {
        return Some(at);
    }
    let doc = pinned_doc(pin)?;
    events
        .iter()
        .filter(|event| event["kind"] == "doc.patched" && event["data"]["doc"] == doc)
        .filter_map(|event| {
            Some((
                event["data"]["rev"].as_u64()?,
                event["data"]["hash"].as_str()?,
            ))
        })
        .max_by_key(|(rev, _)| *rev)
        .map(|(_, hash)| hash)
}

/// The document `doc:<id>` a pin to one of its revisions, `doc:<id>@<rev>`, names; none for another pin.
pub fn pinned_doc(pin: &Value) -> Option<&str> {
    let at = pin["ref"]
        .as_str()
        .filter(|_| pin["kind"] == "doc_revision")?;
    at.rsplit_once('@')
        .map(|(doc, _)| doc)
        .filter(|doc| doc.starts_with("doc:"))
}

thread_local! {
    /// Each manifest read, by its hash: the store holds content by hash, so a manifest never changes.
    static MANIFESTS: RefCell<HashMap<String, Vec<Listed>>> = RefCell::new(HashMap::new());
    /// Each picture decoded, by its hash, for the card to draw.
    static DECODED: RefCell<HashMap<String, Option<Arc<RenderImage>>>> = RefCell::new(HashMap::new());
}

/// The file the evidence store holds under `sha256`.
fn stored(sha256: &str) -> Option<std::path::PathBuf> {
    let (head, rest) = (sha256.get(..2)?, sha256.get(2..)?);
    Some(crate::hub::root().join("evidence").join(head).join(rest))
}

/// The pictures a taste ask (`ask.created`) judges: those its pin's manifest lists, in its order; none for another
/// kind, or a pin that names no such manifest.
pub fn of(events: &[Value], ask: &Value) -> Vec<Listed> {
    if ask["data"]["kind"] != "taste" {
        return Vec::new();
    }
    let Some(manifest) = manifest_of(events, ask) else {
        return Vec::new();
    };
    MANIFESTS.with(|kept| {
        if let Some(listed) = kept.borrow().get(manifest) {
            return listed.clone();
        }
        let listed = stored(manifest)
            .and_then(|path| std::fs::read(path).ok())
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .map(|manifest| listed(&manifest))
            .unwrap_or_default();
        kept.borrow_mut()
            .insert(manifest.to_owned(), listed.clone());
        listed
    })
}

/// A manifest's pictures, kept as if the store had been read.
#[cfg(test)]
pub(crate) fn keep(manifest: &str, listed: Vec<Listed>) {
    MANIFESTS.with(|kept| kept.borrow_mut().insert(manifest.to_owned(), listed));
}

/// A manifest's pictures; one with an entry that names no hash and size lists none.
fn listed(manifest: &Value) -> Vec<Listed> {
    let entries = manifest["pictures"].as_array().cloned().unwrap_or_default();
    let read = |picture: &Value| {
        let hash = picture["sha256"]
            .as_str()
            .filter(|h| h.len() == 64 && h.bytes().all(|b| b.is_ascii_hexdigit()))?;
        let side = |i: usize| picture["size"].get(i)?.as_u64().filter(|v| *v > 0);
        Some(Listed {
            hash: hash.to_owned(),
            size: [side(0)? as u32, side(1)? as u32],
        })
    };
    entries
        .iter()
        .map(read)
        .collect::<Option<_>>()
        .unwrap_or_default()
}

/// A picture as GPUI paints it, decoded from the evidence store once; `None` for one that doesn't decode.
pub fn image(sha256: &str) -> Option<Arc<RenderImage>> {
    DECODED.with(|decoded| {
        decoded
            .borrow_mut()
            .entry(sha256.to_owned())
            .or_insert_with(|| decode(sha256))
            .clone()
    })
}

fn decode(sha256: &str) -> Option<Arc<RenderImage>> {
    let bytes = std::fs::read(stored(sha256)?).ok()?;
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(64 << 20);
    reader.limits(limits);
    let mut rgba = reader.decode().ok()?.into_rgba8();
    // GPUI paints BGRA.
    for p in rgba.as_chunks_mut::<4>().0 {
        p.swap(0, 2);
    }
    Some(Arc::new(RenderImage::new([image::Frame::new(rgba)])))
}
