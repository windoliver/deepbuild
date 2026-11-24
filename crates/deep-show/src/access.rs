//! Issue #376: a panel's accessibility read as data, the way a replica compares it (Rules every
//! primitive follows: Accessible). The tree has one node per part and control, each with its
//! name and role, and an announcement is made for a readout only in a frame where its text
//! differs from what was last said for it: redrawing it unchanged says nothing, and the planted
//! twin that announces every frame is what the criterion's check fails. The tree and the
//! readouts are deep-play's (#1045), so the web player keeps the tree the app gives its
//! accessibility seam: they hold exactly the items the panel draws ([`crate::shared::draws`], less
//! what the view hides), so an item that doesn't draw is never in it or announced.

use std::collections::BTreeMap;

use deep_canvas_motion::program::Program;
use serde_json::{json, Value};

pub(crate) use deep_play::access::{data_at, readouts, tree, tree_with};

use crate::hub::{Hub, Planted};

/// What a presented frame's view hides.
pub(crate) fn hidden_of(frame: &Value) -> Vec<String> {
    frame["hidden"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_string)
        .collect()
}

impl Hub<'_> {
    /// `see`: the panel's accessibility tree as of now and every announcement it made so far.
    /// The announcements come from the frames the panel presented (`presented`): a readout is
    /// announced at the vsync of each frame where its text differs from what was last said for
    /// it, so a change speaks once and an unchanged redraw not at all. One the view hides keeps
    /// what was said, so showing it again unchanged says nothing; one that leaves the document
    /// is forgotten.
    pub fn see(&mut self, panel: &str) -> Value {
        self.settle_focus(panel);
        let presented = self.presented(panel);
        let (Some(frames), Some(doc)) = (
            presented.get("frames").and_then(Value::as_array),
            self.panel_doc(panel),
        ) else {
            return presented;
        };
        let every_frame = self.scenario.planted == Some(Planted::AnnouncesEveryFrame);
        let mut by_rev: BTreeMap<u64, Option<(Value, Option<Program>)>> = BTreeMap::new();
        let mut said: BTreeMap<String, String> = BTreeMap::new();
        let mut announcements = Vec::new();
        for frame in frames {
            let (Some(vsync), Some(rev)) = (frame["vsync"].as_i64(), frame["rev"].as_u64()) else {
                continue;
            };
            let Some((revision, program)) = by_rev
                .entry(rev)
                .or_insert_with(|| {
                    // #504: the revision played, so a readout shows what the input track moved.
                    let d = self.played(&doc, &self.revision(&doc, rev)?);
                    let p = d.as_object().and_then(|m| Program::compile(m).ok());
                    Some((d, p))
                })
                .as_ref()
            else {
                continue;
            };
            let hidden = hidden_of(frame);
            said.retain(|id, _| {
                id.starts_with("card/") || revision.pointer(&format!("/items/{id}")).is_some()
            });
            // The readout as this frame shows it: its keyed values at the frame's time.
            let t = frame["t"].as_i64().unwrap_or(vsync);
            let shown = data_at(revision, program.as_ref(), t);
            for (id, text) in readouts(&shown, &hidden) {
                // A readout first shown is read with the tree; only a change is announced.
                let changed = said.get(&id).is_some_and(|was| was != &text);
                if every_frame || changed {
                    announcements.push(json!({"t": vsync, "id": id, "text": text}));
                }
                said.insert(id, text);
            }
        }
        // #3236: with its tables inlined, so a mark set's value comes from the rows it draws.
        let mut tree = match (self.scopes.get(panel), self.shown_with_tables(panel)) {
            (Some(s), Some(shown)) => tree_with(&shown, &s.scope.hidden(&shown), &self.record()),
            _ => Vec::new(),
        };
        // The planted tree: each set's value as the document's first revision held it.
        if self.scenario.module_planted.as_deref()
            == Some(deep_canvas_marks::data::holds::TREE_KEEPS_VALUE)
        {
            let first = self.currents(&doc).into_iter().map(|(_, r)| r).min();
            if let Some(mut first) = first.and_then(|r| self.revision(&doc, r)) {
                let _ = self.inline_tables(&mut first);
                let kept = tree_with(&first, &[], &self.record());
                for n in &mut tree {
                    let was = kept.iter().find(|k| k["id"] == n["id"]);
                    if let (Some(v), Some(_)) = (was.and_then(|k| k.get("value")), n.get("value")) {
                        n["value"] = v.clone();
                    }
                }
            }
        }
        // #539: each landing of a pick control's roving focus, by its row's label, in time order.
        announcements.extend(
            self.scopes
                .get(panel)
                .map(|s| s.picks.said.clone())
                .unwrap_or_default(),
        );
        announcements.sort_by_key(|a| a["t"].as_i64());
        json!({"tree": tree, "announcements": announcements})
    }
}
