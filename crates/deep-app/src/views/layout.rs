//! Which panel fills each region of the window (moved out of views.rs whole, #3292).

use gpui_kit::base::dock::{DockAreaState, DockPlacement, DockState, PanelInfo, PanelState};

use super::*;

/// Which panel fills each region of the window (#1461): the list on the left, and the pages it opens on the right.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Layout {
    /// The list.
    pub sidebar: String,
    /// The pages, by panel name; `active` is drawn. No tab strip is drawn over them.
    pub center: Vec<String>,
    pub active: usize,
    /// The session's line, drawn on a session's page.
    pub line: String,
    /// The list's first section: the shipped Needs you, or a view that replaces it and passed `needs-you@1`.
    pub needs_you: String,
}

impl Layout {
    /// The app's window with `needs-you`, `session`, `home` or `rules` showing, so a replica draws the app's tree
    /// (#1454). `needs-you` and `sidebar` open on what the window opens on: the first open ask, else the latest
    /// project. Any other name is a mistake, not a view.
    pub fn shipped(view: &str) -> Self {
        let active = match view {
            "needs-you" | "home" | "sidebar" => HOME,
            "session" => SESSION,
            "rules" => RULES,
            other => {
                panic!("{other} is not a shipped view; the shipped views are {SHIPPED_VIEWS:?} and home")
            }
        };
        let center: Vec<String> = [HOME, SESSION, AGENTS, RULES].map(str::to_owned).into();
        Self {
            sidebar: SIDEBAR.into(),
            active: center.iter().position(|name| name == active).unwrap_or(0),
            center,
            line: LINE.into(),
            needs_you: NEEDS_YOU.into(),
        }
    }

    /// The app's window (#1172, #1461): the list, and the pages, with the first-launch page first while setup hasn't
    /// finished, or a mounted panel's view first.
    pub fn app(panel: bool) -> Self {
        let mut center: Vec<String> = [HOME, SESSION, AGENTS].map(str::to_owned).into();
        if panel {
            center.insert(0, EXTENSION.into());
        } else if crate::setup::needed() {
            center.insert(0, WELCOME.into());
        }
        Self {
            sidebar: SIDEBAR.into(),
            center,
            active: 0,
            line: LINE.into(),
            needs_you: NEEDS_YOU.into(),
        }
    }

    /// The window's two regions: the list docked left, the pages beside it, and nothing docked anywhere else.
    pub fn state(&self) -> DockAreaState {
        let tabs = |names: &[String], active: usize| PanelState {
            panel_name: "TabPanel".into(), // copy-exception: the dock's panel name, an identity
            children: names.iter().map(PanelState::new).collect(),
            info: PanelInfo::tabs(active),
        };
        DockAreaState {
            version: None,
            center: tabs(&self.center, self.active),
            left_dock: Some(DockState::new(
                tabs(std::slice::from_ref(&self.sidebar), 0),
                DockPlacement::Left,
                sizes().sidebar,
                true,
            )),
            right_dock: None,
            bottom_dock: None,
        }
    }
}
