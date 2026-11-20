//! #1489: a live view's animated image items: the frame each shows at t, held under reduced
//! motion, and the frame each drew and the bytes its animation holds, as `frames` and `live` report
//! them.

use std::collections::{BTreeMap, HashMap, HashSet};

use deep_canvas_motion::program::Program;
use deep_images::Store;
use serde_json::{json, Map, Value};

use super::in_view;

/// A revision's animated image items and what the presented frame did with them.
#[derive(Default)]
pub(super) struct Anims {
    /// Each one: its asset's hash, the animation's probe and the item's timing.
    pub items: BTreeMap<String, crate::asset::Animated>,
    /// The frame each one in view asks for on the presented frame, and the frame it drew (none
    /// yet while its first is made).
    pub asked: HashMap<String, u32>,
    pub drawn: HashMap<String, Option<u32>>,
    /// Under reduced motion, the frame each holds.
    held: HashMap<String, u32>,
    /// The bytes each animation holds, by its hash, read once a report.
    bytes: HashMap<[u8; 32], u64>,
    /// The ones no channel moves, neither a parent nor a child, and whether each meets the region
    /// the window last showed, so a frame at the same region reads no item to say.
    still: HashSet<String>,
    seen: (Option<[f64; 4]>, HashMap<String, bool>),
}

impl Anims {
    /// The animated image items of a revision, each asset probed once.
    pub fn compile(
        doc: &Map<String, Value>,
        store: &Store,
        program: &Program,
    ) -> Result<Anims, Value> {
        let items = crate::asset::animated_items(&Value::Object(doc.clone()), store)?;
        let parents: HashSet<&str> = (doc.get("items").and_then(Value::as_object))
            .into_iter()
            .flat_map(|items| items.values())
            .filter_map(|i| i.get("parent")?.as_str())
            .collect();
        let written: HashSet<usize> = program.fields.iter().filter_map(|f| f.item).collect();
        let still = (program.items.iter().enumerate())
            .filter(|(i, id)| {
                items.contains_key(*id)
                    && !written.contains(i)
                    && !parents.contains(id.as_str())
                    && doc
                        .get("items")
                        .and_then(|d| d.get(*id)?.get("parent"))
                        .is_none()
            })
            .map(|(_, id)| id.clone())
            .collect();
        Ok(Anims {
            items,
            still,
            ..Anims::default()
        })
    }

    /// The frame each item in the window's `region` shows at `t`: the one its delays put there,
    /// or under reduced motion the one the view first showed. The document time the first of them
    /// changes frame, if any does.
    pub fn frame(
        &mut self,
        items: &Map<String, Value>,
        region: Option<[f64; 4]>,
        t: i64,
        reduced: bool,
    ) -> Option<i64> {
        if self.items.is_empty() {
            return None;
        }
        let view = region.map(|[.., w, h]| [0.0, 0.0, w, h]);
        if self.seen.0 != region {
            self.seen = (region, HashMap::new());
        }
        let mut until: Option<i64> = None;
        for (id, (_, animation, timing)) in &self.items {
            let shown = match self.seen.1.get(id) {
                Some(seen) => *seen,
                None => {
                    let seen = (items.get(id)).is_some_and(|i| view.is_none_or(|v| in_view(i, v)));
                    if self.still.contains(id) {
                        self.seen.1.insert(id.clone(), seen);
                    }
                    seen
                }
            };
            if !shown {
                self.asked.remove(id);
                self.drawn.remove(id);
                continue;
            }
            // Reduced motion holds the frame the view first showed, and nothing re-arms the clock.
            let (k, next) = match (reduced, self.held.get(id)) {
                (true, Some(k)) => (*k, None),
                (true, None) => {
                    let k = timing.frame(animation, t).0;
                    self.held.insert(id.clone(), k);
                    (k, None)
                }
                (false, _) => timing.frame(animation, t),
            };
            match self.asked.get_mut(id) {
                Some(f) => *f = k,
                None => {
                    self.asked.insert(id.clone(), k);
                }
            }
            // A frame drawn by waiting for its level draws the frame it asked for.
            match self.drawn.get_mut(id) {
                Some(d) => *d = Some(k),
                None => {
                    self.drawn.insert(id.clone(), Some(k));
                }
            }
            until = [until, next].into_iter().flatten().min();
        }
        until
    }

    /// The frame `item` asks for on the presented frame, 0 for a still picture.
    pub fn asked(&self, item: &str) -> u32 {
        self.asked.get(item).copied().unwrap_or(0)
    }

    /// `item` drew `frame` (none while nothing of it is made).
    pub fn drew(&mut self, item: &str, frame: Option<u32>) {
        if let Some(d) = self.drawn.get_mut(item) {
            *d = frame;
        }
    }

    /// Each animated item on the presented frame: the frame it asked for, the frame it drew
    /// (`null` while none is made), and the bytes of pixels its animation holds.
    pub fn report(&mut self) -> Value {
        if self.asked.is_empty() {
            return json!({});
        }
        crate::asset::images().animations_held(&mut self.bytes);
        let out: Map<String, Value> = (self.asked.iter())
            .map(|(id, asked)| {
                let drawn = self.drawn.get(id).copied().flatten();
                let held = (self.items.get(id))
                    .and_then(|(hash, ..)| self.bytes.get(hash))
                    .copied()
                    .unwrap_or(0);
                (
                    id.clone(),
                    json!({"asked": asked, "drawn": drawn, "held": held}),
                )
            })
            .collect();
        Value::Object(out)
    }

    /// Whether an animated item on the presented frame drew another frame than it asked.
    pub fn settling(&self) -> bool {
        (self.asked.iter()).any(|(id, k)| self.drawn.get(id) != Some(&Some(*k)))
    }
}
