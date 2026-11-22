//! Issue #1801: each asset a document draws, sized from its file in the evidence store, so the
//! meter's estimate holds its bytes on the device and its vertices (canvas primitives: The cost
//! model; Image `image@1`, Cost: w × h × 4 B, × 1.33 with mipmaps; Material: texture maps). Only
//! the headers are read: a PNG's IHDR, a glTF binary's JSON chunk. An asset the store lacks, or
//! a format neither header gives, has no size, and the estimate leaves it out as before.

use std::collections::BTreeMap;
use std::path::Path;

use deep_canvas::cost::{AssetSize, Sizes};
use deep_canvas::refs::{refs, Name};
use deep_canvas::registry::Sealed;
use serde_json::Value;

use crate::hub::Hub;

/// A mesh's vertex on the device, as the 3D renderer uploads it (#3016): position, normal, color,
/// two uv sets and a tangent, 15 f32s.
const VERTEX_BYTES: f64 = 60.0;
/// An index on the device.
const INDEX_BYTES: f64 = 4.0;
/// A full mip chain adds a third.
const MIPS: f64 = 4.0 / 3.0;

impl Hub<'_> {
    /// The sizes of the assets `doc`'s items name, by SHA-256, each file read once a run.
    pub(crate) fn asset_sizes(&mut self, doc: &Value) -> Sizes {
        of(
            doc,
            &self.startup.sealed,
            &self.scenario.evidence,
            &mut self.media.sizes,
        )
    }
}

/// The sizes of the assets `doc`'s items name in the build `sealed`, read from the evidence store
/// at `root` through `known`, which keeps each file's size by its hash; a file the store doesn't
/// hold yet is read again on the next call.
pub(crate) fn of(
    doc: &Value,
    sealed: &Sealed,
    root: &Path,
    known: &mut BTreeMap<String, Option<AssetSize>>,
) -> Sizes {
    let mut out = Sizes::new();
    for r in refs(doc, sealed) {
        let Name::Asset(sha) = r.name else { continue };
        if out.contains_key(&sha) {
            continue;
        }
        let size = match known.get(&sha) {
            Some(size) => *size,
            None => match crate::evidence::read(root, &sha) {
                Some(bytes) => {
                    let size = png(&bytes).or_else(|| glb(&bytes));
                    known.insert(sha.clone(), size);
                    size
                }
                None => None,
            },
        };
        if let Some(size) = size {
            out.insert(sha, size);
        }
    }
    out
}

/// A PNG's pixels, as RGBA8 decoded and with its mips on the device.
fn png(bytes: &[u8]) -> Option<AssetSize> {
    if bytes.len() < 24 || &bytes[..8] != b"\x89PNG\r\n\x1a\n" || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let side = |at: usize| u32::from_be_bytes(bytes[at..at + 4].try_into().expect("4 bytes"));
    let decoded = f64::from(side(16)) * f64::from(side(20)) * 4.0;
    Some(AssetSize {
        bytes: decoded * MIPS,
        decoded,
        vertices: 0.0,
    })
}

/// A glTF binary's triangle primitives: their vertices and indices, every mesh's.
fn glb(bytes: &[u8]) -> Option<AssetSize> {
    if bytes.len() < 20 || &bytes[..4] != b"glTF" || &bytes[16..20] != b"JSON" {
        return None;
    }
    let length = u32::from_le_bytes(bytes[12..16].try_into().ok()?) as usize;
    let doc: Value = serde_json::from_slice(bytes.get(20..20 + length)?).ok()?;
    let count = |i: &Value| -> Option<f64> {
        let i = usize::try_from(i.as_u64()?).ok()?;
        doc.get("accessors")?.get(i)?.get("count")?.as_f64()
    };
    let (mut vertices, mut indices) = (0.0, 0.0);
    for prim in doc
        .get("meshes")?
        .as_array()?
        .iter()
        .filter_map(|m| m.get("primitives")?.as_array())
        .flatten()
        .filter(|p| p.get("mode").and_then(Value::as_u64).unwrap_or(4) == 4)
    {
        let n = prim.pointer("/attributes/POSITION").and_then(count)?;
        vertices += n;
        indices += prim.get("indices").and_then(count).unwrap_or(n);
    }
    let size = vertices * VERTEX_BYTES + indices * INDEX_BYTES;
    Some(AssetSize {
        bytes: size,
        decoded: size,
        vertices,
    })
}
