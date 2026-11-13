//! What scene evaluation derives once per content key and keeps for later frames and documents:
//! #1640's crease sets, #425's proxies, IES tables by hash, #268's shore fields, #2017's terrain
//! tiles, and the labels' shaped runs (#856). The host owns it and lends it to evaluation through [`Labels`](crate::scene::Labels),
//! which every evaluation already takes; a host that evaluates through several `Labels` shares
//! one memo between them. Each entry is a pure function of its key, so an evaluation reads the
//! same from a cold memo as from a warm one.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use crate::geom::V3;
use crate::ies::Distribution;
use crate::lod::Level;
use crate::shore::Field;
use crate::terrain::Tile;

/// The derived values, by content key; each kept as its reader bounds it.
#[derive(Default)]
pub struct Memo {
    /// Crease sets by their key (positions, triangles, angle and `border`), at most 64.
    pub(crate) creases: Mutex<BTreeMap<[u8; 16], Arc<Vec<[V3; 2]>>>>,
    /// Proxies by (mesh hash, ratio bits, error bits).
    pub(crate) proxies: Mutex<BTreeMap<(u64, u64, u64), Option<Level>>>,
    /// IES tables by the hash of their bytes.
    pub(crate) ies: Mutex<BTreeMap<String, Arc<Distribution>>>,
    /// Shore fields, the oldest first, at most [`crate::shore::KEPT`].
    pub(crate) shore: Mutex<Vec<Arc<Field>>>,
    /// A plate's tiles by (mesh hash, tile cells, levels), the oldest first, at most 4.
    pub(crate) tiles: Mutex<Vec<((u64, usize, usize), Arc<Vec<Tile>>)>>,
    /// The shaped-run cache the labels' shapers keep their runs in.
    pub(crate) text: Arc<deep_text::RunCache>,
}
