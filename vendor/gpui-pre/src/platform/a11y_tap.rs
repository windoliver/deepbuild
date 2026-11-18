//! DeepBuild patch (windoliver/deepbuild#1482): the accessibility tree a test window's platform holds. A test window
//! has no adapter, so a replica asks for one as an assistive client would (`activate_accessibility`) and reads the
//! last tree GPUI sent (`accessibility_tree`), node by node in tree order.

use std::{cell::RefCell, collections::HashMap};

use accesskit::{Action, TreeUpdate};

use crate::A11yCallbacks;

const ACTIONS: [Action; 22] = [
    Action::Click,
    Action::Focus,
    Action::Blur,
    Action::Collapse,
    Action::Expand,
    Action::CustomAction,
    Action::Decrement,
    Action::Increment,
    Action::HideTooltip,
    Action::ShowTooltip,
    Action::ReplaceSelectedText,
    Action::ScrollDown,
    Action::ScrollLeft,
    Action::ScrollRight,
    Action::ScrollUp,
    Action::ScrollIntoView,
    Action::ScrollToPoint,
    Action::SetScrollOffset,
    Action::SetTextSelection,
    Action::SetSequentialFocusNavigationStartingPoint,
    Action::SetValue,
    Action::ShowContextMenu,
];

#[derive(Default)]
struct Tap {
    activation: Option<Box<dyn Fn() -> Option<TreeUpdate> + Send>>,
    last: Option<TreeUpdate>,
}

thread_local! {
    static TAP: RefCell<Tap> = RefCell::new(Tap::default());
}

/// A node of the tree a test window's platform holds.
#[derive(Clone, Debug, PartialEq)]
pub struct TappedNode {
    /// The node's id.
    pub id: u64,
    /// The node's role, as accesskit names it.
    pub role: String,
    /// Its name.
    pub name: Option<String>,
    /// Its value.
    pub value: Option<String>,
    /// Its bounds, `[x, y, width, height]`.
    pub bounds: Option<[f64; 4]>,
    /// The actions it takes, sorted by name.
    pub actions: Vec<String>,
    /// Its children, in order.
    pub children: Vec<u64>,
}

/// The tree a test window's platform holds: the focused node and every node, the root first, depth first.
#[derive(Clone, Debug, PartialEq)]
pub struct TappedTree {
    /// The focused node's id.
    pub focus: u64,
    /// Every node reachable from the root.
    pub nodes: Vec<TappedNode>,
}

pub(crate) fn init(callbacks: A11yCallbacks) {
    TAP.with(|tap| tap.borrow_mut().activation = Some(callbacks.activation));
}

pub(crate) fn update(update: TreeUpdate) {
    TAP.with(|tap| tap.borrow_mut().last = Some(update));
}

/// Connects an assistive client to the window: GPUI builds each frame's tree from the next on. False when no window
/// took the adapter (accessibility is off for the app).
pub fn activate_accessibility() -> bool {
    TAP.with(|tap| match &tap.borrow().activation {
        Some(activation) => {
            activation();
            true
        }
        None => false,
    })
}

/// The tree of the last frame GPUI sent, if a client is connected and a frame was sent since.
pub fn accessibility_tree() -> Option<TappedTree> {
    TAP.with(|tap| {
        let tap = tap.borrow();
        let update = tap.last.as_ref()?;
        let at: HashMap<_, _> = update.nodes.iter().map(|(id, node)| (id.0, node)).collect();
        let root = update.tree.as_ref()?.root.0;
        let (mut nodes, mut stack) = (Vec::new(), vec![root]);
        while let Some(id) = stack.pop() {
            let Some(node) = at.get(&id) else { continue };
            let bounds = node
                .bounds()
                .map(|b| [b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0]);
            let mut actions: Vec<String> = ACTIONS
                .iter()
                .filter(|a| node.supports_action(**a))
                .map(|a| format!("{a:?}"))
                .collect();
            actions.sort();
            let children: Vec<u64> = node.children().iter().map(|c| c.0).collect();
            stack.extend(children.iter().rev());
            nodes.push(TappedNode {
                id,
                role: format!("{:?}", node.role()),
                name: node.label().map(str::to_owned),
                value: node.value().map(str::to_owned),
                bounds,
                actions,
                children,
            });
        }
        Some(TappedTree {
            focus: update.focus.0,
            nodes,
        })
    })
}
