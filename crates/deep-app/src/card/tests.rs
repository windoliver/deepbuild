//! A picture a taste call judges, drawn while the window is hidden, isn't one you were shown (#3234): GPUI draws a hidden
//! window for an assistive client that asked for its tree (vendor/gpui-pre, `unseen`).
use gpui_kit::{point, px, size, AppContext as _, Bounds, Empty, TestAppContext, WindowVisibility};

use super::{Card, Controller};
use crate::arming::{Slot, ARM_AFTER};

fn left_after_a_draw(
    cx: &mut TestAppContext,
    visibility: WindowVisibility,
) -> Option<(usize, usize)> {
    let (manifest, hash) = ("a".repeat(64), "b".repeat(64));
    let listed = crate::pictures::Listed {
        hash: hash.clone(),
        size: [100, 100],
    };
    crate::pictures::keep(&manifest, vec![listed]);
    let asked = serde_json::json!([{"kind": "ask.created", "id": "T", "session": "S", "log_pos": 1, "data": {
        "kind": "taste", "question": "Keep it?", "recommended": "yes", "default": "yes", "key": "k", "deadline": 4_000_000_000_000_u64,
        "options": [{"id": "yes", "label": "Keep it", "decision": "none"}, {"id": "no", "label": "Send back", "decision": "none"}],
        "pinned_to": {"kind": "evidence", "ref": manifest},
    }}]);
    let slot = Slot {
        rect: [0, 0, 1000, 1000],
        visible: [0, 0, 1000, 1000],
    };
    let now = crate::views::now();
    let events = asked.as_array().unwrap();
    let controller = Controller::present(events, "ask:T", now, slot, Default::default()).unwrap();
    assert_eq!(controller.left(), Some((1, 1)));
    let window = cx.add_window(|_, _| Empty);
    let card = cx.new(|cx| {
        Card::new(
            "Keep it?".into(),
            Vec::new(),
            Bounds::default(),
            Some(controller),
            cx,
        )
    });
    cx.simulate_window_visibility_change(window.into(), visibility);
    let whole = Bounds::new(point(px(0.), px(0.)), size(px(100.), px(100.)));
    cx.update_window(window.into(), |_, window, cx| {
        card.update(cx, |card, cx| {
            card.pictures.borrow_mut().push((hash, whole));
            card.frame_drawn(window, cx);
            let controller = card.controller.as_mut().unwrap();
            controller.tick(crate::views::now() + ARM_AFTER);
            controller.left()
        })
    })
    .unwrap()
}

#[gpui_kit::test]
fn a_picture_drawn_in_a_window_you_can_see_counts_as_shown(cx: &mut TestAppContext) {
    assert_eq!(
        left_after_a_draw(cx, WindowVisibility::Visible),
        Some((0, 1))
    );
}

#[gpui_kit::test]
fn a_picture_drawn_in_a_hidden_window_does_not(cx: &mut TestAppContext) {
    assert_eq!(
        left_after_a_draw(cx, WindowVisibility::Hidden),
        Some((1, 1))
    );
}
