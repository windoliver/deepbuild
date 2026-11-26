//! An assistive client of a window nobody can see (#3232 rests on it). GPUI gives the platform a frame's tree when it
//! draws the frame, and a display asks for no frame of a covered or minimized window. Here a window is drawn only when
//! something asks, as the app a person runs draws it (#1546), and no display asks, so each draw is one the window made
//! for its client. tests/unseen-window.test.mjs runs this, and reads the real app from outside its process.

use std::{cell::Cell, rc::Rc, sync::Arc, time::Duration};

use gpui_kit::{
    accessibility_tree, accesskit::Live, activate_accessibility, div, px, size, AnyWindowHandle,
    AppContext as _, Context, Entity, HeadlessAppContext, InteractiveElement as _, IntoElement,
    NoopTextSystem, Render, Role, StatefulInteractiveElement as _, Window, WindowVisibility,
};

/// A window whose one node is a polite live region, which asks for its next frame where it moves.
struct Says {
    line: String,
    moves: bool,
    drawn: Rc<Cell<usize>>,
}

impl Render for Says {
    fn render(&mut self, window: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        self.drawn.set(self.drawn.get() + 1);
        if self.moves {
            window.request_animation_frame();
        }
        let line = self.line.clone();
        div()
            .id("says")
            .role(Role::Label)
            .a11y_synthetic_children(move |tree| {
                let node = tree.parent_node();
                node.set_value(line);
                node.set_live(Live::Polite);
            })
    }
}

struct Unseen {
    cx: HeadlessAppContext,
    window: AnyWindowHandle,
    says: Entity<Says>,
    drawn: Rc<Cell<usize>>,
}

impl Unseen {
    /// The window, opened and drawn, then hidden.
    fn open(moves: bool) -> Unseen {
        let mut cx = HeadlessAppContext::new(Arc::new(NoopTextSystem::new()));
        let drawn = Rc::new(Cell::new(0));
        let counted = drawn.clone();
        let window = cx
            .open_window(size(px(200.), px(100.)), |_, cx| {
                cx.new(|_| Says {
                    line: "opened".into(),
                    moves,
                    drawn: counted,
                })
            })
            .expect("the window opens");
        let says = cx
            .update_window(window.into(), |_, window, _| {
                window.root::<Says>().flatten().expect("the window's root")
            })
            .unwrap();
        cx.draw_on_request();
        cx.run_until_parked();
        cx.simulate_visibility_change(window.into(), WindowVisibility::Hidden);
        let mut unseen = Unseen {
            cx,
            window: window.into(),
            says,
            drawn,
        };
        unseen.passes(Duration::from_secs(1));
        unseen.drawn.set(0);
        unseen
    }

    fn passes(&mut self, time: Duration) {
        self.cx.run_until_parked();
        self.cx.advance_clock(time);
        self.cx.run_until_parked();
    }

    fn say(&mut self, line: &str) {
        let says = self.says.clone();
        self.cx
            .update_window(self.window, |_, _, cx| {
                says.update(cx, |says, cx| {
                    says.line = line.into();
                    cx.notify();
                })
            })
            .unwrap();
        self.cx.run_until_parked();
    }

    /// The draws since the last call.
    fn draws(&self) -> usize {
        self.drawn.replace(0)
    }
}

/// The live region's value as the platform holds it, `None` while it holds no tree of the window's.
fn heard() -> Option<String> {
    let tree = accessibility_tree()?;
    tree.nodes.iter().find_map(|node| node.value.clone())
}

#[test]
fn a_client_is_given_a_hidden_windows_tree_and_each_change_to_it() {
    let mut unseen = Unseen::open(false);
    assert!(activate_accessibility());
    unseen.cx.run_until_parked();
    assert_eq!(heard().as_deref(), Some("opened"), "the tree it asked for");
    unseen.passes(Duration::from_secs(1));
    assert_eq!(unseen.draws(), 1, "the tree is drawn once");

    unseen.say("2 asks need you");
    assert_eq!(heard().as_deref(), Some("2 asks need you"), "a change");
    unseen.passes(Duration::from_secs(1));
    assert_eq!(
        unseen.draws(),
        1,
        "a change is drawn once, so it is announced once"
    );
}

#[test]
fn a_hidden_window_with_nothing_new_is_not_drawn_for_its_client() {
    let mut unseen = Unseen::open(true);
    assert!(activate_accessibility());
    unseen.passes(Duration::from_secs(1));
    assert_eq!(unseen.draws(), 1, "the tree it asked for");
    // It asked for its next frame as it was drawn, and no display gives it one.
    for _ in 0..60 {
        unseen.passes(Duration::from_secs(1));
    }
    assert_eq!(unseen.draws(), 0);
}

#[test]
fn a_hidden_window_is_not_drawn_while_no_client_asked_for_its_tree() {
    let mut unseen = Unseen::open(false);
    for line in 0..20 {
        unseen.say(&format!("line {line}"));
        unseen.passes(Duration::from_secs(1));
    }
    assert_eq!((unseen.draws(), heard()), (0, None));
}

#[test]
fn a_burst_of_changes_to_a_hidden_window_is_drawn_ten_times_a_second_and_ends_on_the_last() {
    let mut unseen = Unseen::open(false);
    assert!(activate_accessibility());
    unseen.passes(Duration::from_secs(1));
    unseen.draws();
    for line in 0..1000 {
        unseen.say(&format!("line {line}"));
        unseen.passes(Duration::from_millis(1));
    }
    unseen.passes(Duration::from_secs(1));
    let draws = unseen.draws();
    assert!(
        (9..=11).contains(&draws),
        "{draws} draws of 1,000 changes in a second"
    );
    assert_eq!(heard().as_deref(), Some("line 999"));
}

#[test]
fn a_window_shown_again_is_drawn_anew_and_only_when_its_display_asks() {
    let mut unseen = Unseen::open(false);
    assert!(activate_accessibility());
    unseen.passes(Duration::from_secs(1));
    let visible = WindowVisibility::Visible;
    unseen.cx.simulate_visibility_change(unseen.window, visible);
    unseen.passes(Duration::from_secs(1));
    unseen.draws();
    // Nothing changed since the hidden draw, and the frame a person sees is still one drawn for them.
    assert!(unseen.cx.request_frame(unseen.window));
    assert_eq!(unseen.draws(), 1, "the first frame seen");
    unseen.say("2 asks need you");
    unseen.passes(Duration::from_secs(1));
    assert_eq!(unseen.draws(), 0, "a change, before the display asks");
}
