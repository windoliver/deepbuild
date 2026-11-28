//! DeepBuild patch (windoliver/deepbuild#1482): a cached view keeps its accessibility nodes. GPUI builds the tree
//! again each frame from the elements it prepaints, and a cached view it reuses prepaints nothing, so for that frame
//! the view's nodes, their action listeners and the focus they held left the tree. A cached view now keeps what its
//! subtree added the last time it drew, and gives it back when it's reused, node for node with a frame that drew it.

use accesskit::NodeId;

use super::A11y;
use crate::{Bounds, FocusId, Pixels};

/// Where the tree stood as a cached view's subtree began to draw.
pub(crate) struct Start {
    nodes: usize,
    children: usize,
}

/// What a cached view's subtree added to the tree the last time it drew.
pub(crate) struct Kept {
    /// Its top nodes, the children it gave the node it sits in, in order.
    top: Vec<NodeId>,
    /// Every node it added, as the tree finalized them.
    nodes: Vec<(NodeId, accesskit::Node)>,
    focusable: Vec<(NodeId, FocusId)>,
    bounds: Vec<(NodeId, Bounds<Pixels>)>,
    active_descendant: Option<NodeId>,
}

#[cfg(feature = "test-support")]
thread_local! {
    static PLAIN: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// A replica's planted wrong program: reuse a cached view as GPUI did before this patch, keeping none of its nodes.
#[cfg(feature = "test-support")]
pub fn reuse_plainly(on: bool) {
    PLAIN.with(|plain| plain.set(on));
}

fn plain() -> bool {
    #[cfg(feature = "test-support")]
    return PLAIN.with(std::cell::Cell::get);
    #[cfg(not(feature = "test-support"))]
    false
}

impl A11y {
    /// Whether a cached view may be reused: always while no assistive tech reads the tree, else only when it kept
    /// the nodes its subtree added.
    pub(crate) fn can_reuse(&self, kept: &Option<Kept>) -> bool {
        !self.is_active() || kept.is_some() || plain()
    }

    /// Where the tree stands as a cached view's subtree begins to draw, while assistive tech reads it.
    pub(crate) fn start_kept(&self) -> Option<Start> {
        self.is_active().then(|| Start {
            nodes: self.nodes.all_nodes.len(),
            children: (self.nodes.nodes_stack.last()).map_or(0, |node| node.children().len()),
        })
    }

    /// What the subtree added since it began.
    pub(crate) fn kept_since(&self, start: Option<Start>) -> Option<Kept> {
        let start = start?;
        let nodes = (self.nodes.all_nodes.get(start.nodes..))
            .unwrap_or_default()
            .to_vec();
        let top = self.nodes.nodes_stack.last().map_or_else(Vec::new, |node| {
            (node.children().get(start.children..))
                .unwrap_or_default()
                .to_vec()
        });
        let has = |id: &NodeId| nodes.iter().any(|(node, _)| node == id);
        Some(Kept {
            focusable: (nodes.iter())
                .filter_map(|(id, _)| self.focus_ids.get(id).map(|focus| (*id, *focus)))
                .collect(),
            bounds: (nodes.iter())
                .filter_map(|(id, _)| self.node_bounds.get(id).map(|bounds| (*id, *bounds)))
                .collect(),
            active_descendant: self.nodes.active_descendant.filter(has),
            top,
            nodes,
        })
    }

    /// Gives a reused cached view's nodes back to the tree, with the action listeners they had the frame before and
    /// the focus if one of them holds it.
    pub(crate) fn give_back(&mut self, kept: &Option<Kept>, focused: Option<FocusId>) {
        let Some(kept) = kept.as_ref().filter(|_| self.is_active() && !plain()) else {
            return;
        };
        if kept.nodes.iter().any(|(id, _)| self.nodes.has_node(*id)) {
            return;
        }
        (self.nodes.seen_ids).extend(kept.nodes.iter().map(|(id, _)| *id));
        if let Some(parent) = self.nodes.nodes_stack.last_mut() {
            for id in &kept.top {
                parent.push_child(*id);
            }
        }
        self.nodes.all_nodes.extend(kept.nodes.iter().cloned());
        self.node_bounds.extend(kept.bounds.iter().copied());
        for (id, focus) in &kept.focusable {
            self.focus_ids.insert(*id, *focus);
            if focused == Some(*focus) {
                self.set_focus(*id);
            }
        }
        if let Some(id) = kept.active_descendant {
            self.nodes.set_active_descendant(id);
        }
        for (id, _) in &kept.nodes {
            if let Some(listeners) = self.kept_listeners.remove(id) {
                self.action_listeners.insert(*id, listeners);
            }
        }
    }
}
